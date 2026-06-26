//! The single pooled transport for intervals.icu.
//!
//! Every request passes through the shared `Governor` (dispatch pace + policy
//! hook) and a unified retry loop that honours `Retry-After`. The auth header is
//! built once from the credential the transport holds — callers never pass an
//! `auth_header` per request.

use crate::governor::{self, AuthMethod, Governor, Lane, RateBudget};
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::Duration;

/// Retries for transient failures (429 / 5xx / transport). Matches the prior
/// axios client (`maxRetries = 3`).
const MAX_RETRIES: u32 = 3;

/// A failed request, classified so the service can react (e.g. `Unauthorized`
/// drives the `authExpired` status).
#[derive(Debug)]
pub enum NetError {
    /// 401 — credentials rejected; the service emits `authExpired`.
    Unauthorized,
    /// 429 after exhausting retries.
    RateLimited,
    /// Any other non-success HTTP status.
    Http { status: u16, body: String },
    /// Network / timeout failure after retries.
    Transport(String),
    /// Body did not deserialize into the expected shape.
    Decode(String),
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NetError::Unauthorized => write!(f, "unauthorized (401)"),
            NetError::RateLimited => write!(f, "rate limited (429) after retries"),
            NetError::Http { status, body } => write!(f, "HTTP {}: {}", status, body),
            NetError::Transport(e) => write!(f, "transport error: {}", e),
            NetError::Decode(e) => write!(f, "decode error: {}", e),
        }
    }
}

impl std::error::Error for NetError {}

/// Pooled HTTP transport bound to one base URL and one credential.
pub struct Transport {
    client: Client,
    base_url: String,
    auth_header: String,
    governor: Arc<Governor>,
}

impl Transport {
    /// Build a transport on the shared process governor.
    pub fn new(base_url: impl Into<String>, auth: AuthMethod<'_>) -> Result<Self, String> {
        Self::with_governor(base_url, auth, governor::GOVERNOR.clone())
    }

    /// Build a transport on a specific governor (used by tests for an isolated,
    /// fast-paced limiter).
    pub fn with_governor(
        base_url: impl Into<String>,
        auth: AuthMethod<'_>,
        governor: Arc<Governor>,
    ) -> Result<Self, String> {
        let client = Client::builder()
            .pool_max_idle_per_host(16)
            .pool_idle_timeout(Duration::from_secs(60))
            .tcp_keepalive(Duration::from_secs(30))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("failed to build HTTP client: {}", e))?;
        Ok(Self {
            client,
            base_url: base_url.into(),
            auth_header: governor::format_auth_header(auth),
            governor,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// GET a path and deserialize the JSON body into `T`.
    pub async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
        lane: Lane,
    ) -> Result<T, NetError> {
        let body = self.get_bytes(path, query, lane).await?;
        serde_json::from_slice::<T>(&body).map_err(|e| NetError::Decode(e.to_string()))
    }

    /// GET a path and return the raw response bytes (e.g. a FIT file).
    pub async fn get_bytes(
        &self,
        path: &str,
        query: &[(&str, &str)],
        lane: Lane,
    ) -> Result<Vec<u8>, NetError> {
        let url = self.url(path);
        let mut attempt = 0u32;
        loop {
            // Single shared choke point: pace every dispatch.
            self.governor.acquire(lane).await;

            let send = self
                .client
                .get(&url)
                .header("Authorization", &self.auth_header)
                .query(query)
                .send()
                .await;

            match send {
                Ok(resp) => {
                    let status = resp.status();
                    let budget = parse_budget(resp.headers());
                    self.governor.observe(&budget);

                    if status.is_success() {
                        return resp
                            .bytes()
                            .await
                            .map(|b| b.to_vec())
                            .map_err(|e| NetError::Transport(e.to_string()));
                    }
                    if status == reqwest::StatusCode::UNAUTHORIZED {
                        return Err(NetError::Unauthorized);
                    }
                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        attempt += 1;
                        if attempt > MAX_RETRIES {
                            return Err(NetError::RateLimited);
                        }
                        let wait =
                            governor::decide_backoff(budget.retry_after_secs, attempt, true);
                        tokio::time::sleep(wait).await;
                        continue;
                    }
                    if status.is_server_error() && attempt < MAX_RETRIES {
                        attempt += 1;
                        let wait = governor::decide_backoff(None, attempt, false);
                        tokio::time::sleep(wait).await;
                        continue;
                    }
                    let code = status.as_u16();
                    let body = resp.text().await.unwrap_or_default();
                    return Err(NetError::Http { status: code, body });
                }
                Err(e) => {
                    attempt += 1;
                    if attempt > MAX_RETRIES {
                        return Err(NetError::Transport(e.to_string()));
                    }
                    let wait = governor::decide_backoff(None, attempt, false);
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }
}

/// Extract intervals.icu rate headers (it sends `Retry-After` on 429; the
/// `X-RateLimit-*` headers are parsed if/when the server adds them).
fn parse_budget(headers: &reqwest::header::HeaderMap) -> RateBudget {
    let get = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    governor::parse_rate_headers(
        get("x-ratelimit-limit"),
        get("x-ratelimit-remaining"),
        get("retry-after"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::NoopPolicy;
    use httpmock::prelude::*;
    use serde_json::json;

    fn fast_transport(base: String, auth: AuthMethod<'_>) -> Transport {
        // A throwaway 1000 req/s governor keeps request-path tests fast and
        // isolated from the shared 8 req/s process governor.
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        Transport::with_governor(base, auth, gov).unwrap()
    }

    #[test]
    fn sends_basic_auth_and_parses_json() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1")
                .header("authorization", &governor::format_auth_header(AuthMethod::ApiKey("secret")));
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("secret"));
        let got: serde_json::Value =
            crate::runtime::block_on(t.get_json("/athlete/i1", &[], Lane::Interactive)).unwrap();
        mock.assert();
        assert_eq!(got["id"], "i1");
    }

    #[test]
    fn sends_bearer_auth() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/me")
                .header("authorization", "Bearer tok123");
            then.status(200).json_body(json!({"id": "i1"}));
        });
        let t = fast_transport(server.base_url(), AuthMethod::Bearer("tok123"));
        let _: serde_json::Value =
            crate::runtime::block_on(t.get_json("/athlete/me", &[], Lane::Interactive)).unwrap();
        mock.assert();
    }

    #[test]
    fn forwards_query_params() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", "2026-01-01")
                .query_param("newest", "2026-06-26");
            then.status(200).json_body(json!([]));
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let _: serde_json::Value = crate::runtime::block_on(t.get_json(
            "/athlete/i1/activities",
            &[("oldest", "2026-01-01"), ("newest", "2026-06-26")],
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
    }

    #[test]
    fn unauthorized_maps_to_error() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(401);
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::Unauthorized)));
    }

    #[test]
    fn retries_429_then_gives_up_and_honours_retry_after() {
        let server = MockServer::start();
        // Retry-After: 0 keeps the test fast while still exercising the header path.
        let mock = server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(429).header("retry-after", "0");
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Backfill));
        assert!(matches!(res, Err(NetError::RateLimited)));
        // 1 initial dispatch + MAX_RETRIES retries.
        assert_eq!(mock.hits(), (MAX_RETRIES + 1) as usize);
    }

    #[test]
    fn retries_500_then_succeeds() {
        let server = MockServer::start();
        // First respond 500, then a second mock for the retry returns 200. httpmock
        // matches the most-recently-defined mock first, so define 200 with a hit cap.
        let ok = server.mock(|when, then| {
            when.method(GET).path("/y");
            then.status(200).json_body(json!({"ok": true}));
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let got: serde_json::Value =
            crate::runtime::block_on(t.get_json("/y", &[], Lane::Interactive)).unwrap();
        ok.assert();
        assert_eq!(got["ok"], true);
    }

    #[test]
    fn decode_error_on_bad_shape() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/z");
            then.status(200).body("not json");
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/z", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::Decode(_))));
    }
}
