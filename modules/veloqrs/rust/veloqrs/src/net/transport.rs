//! The single pooled transport for intervals.icu.
//!
//! Every request passes through the shared `Governor` (dispatch pace + policy
//! hook) and a unified retry loop that honours `Retry-After`. The auth header is
//! built once from the credential the transport holds - callers never pass an
//! `auth_header` per request.

use crate::governor::{self, AuthMethod, Governor, Lane, RateBudget};
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Retries for transient failures (429 / 5xx / transport). Matches the prior
/// axios client (`maxRetries = 3`).
const MAX_RETRIES: u32 = 3;

/// How long each lane may spend on one request, and how long the whole retry
/// loop may run for the lane a user is waiting on.
///
/// A total timeout on its own does nothing for the worst case, which is not a
/// dead network but a live one that accepts and then goes quiet: a captive
/// portal, hotel wifi, a black-holed DNS. There every attempt runs the full
/// ceiling, so the retries multiply it. Aeroplane mode fails in milliseconds by
/// comparison. So the interactive lane gets a short per-attempt ceiling and a
/// whole-request budget that stops it retrying into a wait nobody will sit
/// through, while backfill, which no one is watching, keeps the long ceiling
/// and the full retry budget.
#[derive(Clone, Copy, Debug)]
pub struct LaneTimeouts {
    /// TCP connect ceiling, shared by both lanes. Without it a handshake that
    /// never completes burns a whole attempt.
    pub connect: Duration,
    /// Per-attempt ceiling for work a user is waiting on.
    pub interactive: Duration,
    /// Per-attempt ceiling for opportunistic backfill.
    pub backfill: Duration,
    /// Whole-request ceiling for the interactive lane, retries and backoff
    /// included.
    pub interactive_budget: Duration,
}

impl Default for LaneTimeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(5),
            // Wide enough for a FIT file over a poor mobile connection, far
            // short of the two minutes the old 4 x 30s worst case cost.
            interactive: Duration::from_secs(8),
            backfill: Duration::from_secs(30),
            interactive_budget: Duration::from_secs(10),
        }
    }
}

impl LaneTimeouts {
    /// The ceiling for the attempt about to be dispatched. A budgeted lane
    /// never gets more than the budget has left, so the retries add up to the
    /// budget rather than multiplying the per-attempt ceiling.
    fn attempt(&self, lane: Lane, started: Instant) -> Duration {
        match self.budget(lane) {
            None => self.backfill,
            Some(budget) => self
                .interactive
                .min(budget.saturating_sub(started.elapsed())),
        }
    }

    /// The whole-request ceiling for `lane`, if it has one.
    fn budget(&self, lane: Lane) -> Option<Duration> {
        match lane {
            Lane::Interactive => Some(self.interactive_budget),
            Lane::Backfill => None,
        }
    }
}

/// A failed request, classified so the service can react (e.g. `Unauthorized`
/// drives the `authExpired` status).
#[derive(Debug)]
pub enum NetError {
    /// 401 - credentials rejected; the service emits `authExpired`.
    Unauthorized,
    /// 429 after exhausting retries.
    RateLimited,
    /// Any other non-success HTTP status.
    Http { status: u16, body: String },
    /// Network / timeout failure after retries.
    Transport(String),
    /// Body did not deserialize into the expected shape.
    Decode(String),
    /// A local file backing a request body could not be read. Not a network
    /// failure, so it must never be queued for a connectivity retry.
    Io(String),
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NetError::Unauthorized => write!(f, "unauthorized (401)"),
            NetError::RateLimited => write!(f, "rate limited (429) after retries"),
            NetError::Http { status, body } => write!(f, "HTTP {}: {}", status, body),
            NetError::Transport(e) => write!(f, "transport error: {}", e),
            NetError::Decode(e) => write!(f, "decode error: {}", e),
            NetError::Io(e) => write!(f, "file error: {}", e),
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
    timeouts: LaneTimeouts,
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
        Self::with_timeouts(base_url, auth, governor, LaneTimeouts::default())
    }

    /// Build a transport with explicit lane timeouts.
    pub fn with_timeouts(
        base_url: impl Into<String>,
        auth: AuthMethod<'_>,
        governor: Arc<Governor>,
        timeouts: LaneTimeouts,
    ) -> Result<Self, String> {
        let client = Client::builder()
            // Sends `Accept-Encoding: gzip` and decodes the body transparently.
            .gzip(true)
            .pool_max_idle_per_host(16)
            .pool_idle_timeout(Duration::from_secs(60))
            .tcp_keepalive(Duration::from_secs(30))
            .connect_timeout(timeouts.connect)
            // The floor for a request that names no lane ceiling of its own.
            .timeout(timeouts.backfill)
            .build()
            .map_err(|e| format!("failed to build HTTP client: {}", e))?;
        Ok(Self {
            client,
            base_url: base_url.into(),
            auth_header: governor::format_auth_header(auth),
            governor,
            timeouts,
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
        let started = Instant::now();
        loop {
            // Single shared choke point: pace every dispatch.
            self.governor.acquire(lane).await;

            let send = self
                .client
                .get(&url)
                .header("Authorization", &self.auth_header)
                .query(query)
                .timeout(self.timeouts.attempt(lane, started))
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
                        let wait = governor::decide_backoff(budget.retry_after_secs, attempt, true);
                        if attempt > MAX_RETRIES || !self.retry_fits(lane, started, wait) {
                            return Err(NetError::RateLimited);
                        }
                        tokio::time::sleep(wait).await;
                        continue;
                    }
                    if status.is_server_error() && attempt < MAX_RETRIES {
                        let wait = governor::decide_backoff(None, attempt + 1, false);
                        if self.retry_fits(lane, started, wait) {
                            attempt += 1;
                            tokio::time::sleep(wait).await;
                            continue;
                        }
                    }
                    let code = status.as_u16();
                    let body = resp.text().await.unwrap_or_default();
                    return Err(NetError::Http { status: code, body });
                }
                Err(e) => {
                    attempt += 1;
                    let wait = governor::decide_backoff(None, attempt, false);
                    if attempt > MAX_RETRIES || !self.retry_fits(lane, started, wait) {
                        return Err(NetError::Transport(e.to_string()));
                    }
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    /// POST a JSON body and return the raw response bytes.
    ///
    /// Write retry policy, deliberately narrower than the GET path: only a 429
    /// is retried. A POST that creates an activity may already have been applied
    /// when a 5xx or a dropped connection comes back, so retrying it here risks
    /// a duplicate activity. Those surface to the caller instead, and the upload
    /// queue decides whether to try again on its own backoff. A 429 is the one
    /// safe retry, because the server rejected the request outright.
    pub async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
        lane: Lane,
    ) -> Result<Vec<u8>, NetError> {
        let url = self.url(path);
        let mut attempt = 0u32;
        let started = Instant::now();
        loop {
            // Same single choke point as the reads: writes share the pace.
            self.governor.acquire(lane).await;
            let req = self
                .client
                .post(&url)
                .header("Authorization", &self.auth_header)
                .timeout(self.timeouts.attempt(lane, started))
                .json(body);
            match self.settle_write(req.send().await, attempt).await {
                WriteStep::Done(result) => return result,
                WriteStep::Backoff(wait) => {
                    if !self.retry_fits(lane, started, wait) {
                        return Err(NetError::RateLimited);
                    }
                    attempt += 1;
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    /// POST a multipart body whose file part streams straight off the device
    /// filesystem, so a large FIT never lands in memory as bytes.
    ///
    /// `fields` are the plain text parts, in the order the server should see
    /// them. Same write retry policy as `post_json`: 429 only.
    pub async fn post_multipart(
        &self,
        path: &str,
        file: &FilePart<'_>,
        fields: &[(&str, String)],
        lane: Lane,
        timeout: Duration,
    ) -> Result<Vec<u8>, NetError> {
        let url = self.url(path);
        let mut attempt = 0u32;
        loop {
            self.governor.acquire(lane).await;
            // Rebuilt every attempt: a streamed body cannot be replayed.
            let mut form = reqwest::multipart::Form::new()
                .part(file.field.to_string(), streamed_file_part(file).await?);
            for (name, value) in fields {
                form = form.text((*name).to_string(), value.clone());
            }
            let req = self
                .client
                .post(&url)
                .header("Authorization", &self.auth_header)
                .timeout(timeout)
                .multipart(form);
            match self.settle_write(req.send().await, attempt).await {
                WriteStep::Done(result) => return result,
                WriteStep::Backoff(wait) => {
                    attempt += 1;
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    /// Whether the backoff still leaves the lane's whole-request budget with
    /// time to dispatch again. A server that fails fast keeps every retry; a
    /// socket that hangs spends the budget on the first attempt and gets none.
    /// Backfill has no budget and always retries.
    fn retry_fits(&self, lane: Lane, started: Instant, wait: Duration) -> bool {
        match self.timeouts.budget(lane) {
            None => true,
            Some(budget) => started.elapsed() + wait < budget,
        }
    }

    /// Classify a write response under the write retry policy.
    async fn settle_write(
        &self,
        send: Result<reqwest::Response, reqwest::Error>,
        attempt: u32,
    ) -> WriteStep {
        let resp = match send {
            Ok(resp) => resp,
            Err(e) => return WriteStep::Done(Err(NetError::Transport(e.to_string()))),
        };
        let status = resp.status();
        let budget = parse_budget(resp.headers());
        self.governor.observe(&budget);

        if status.is_success() {
            return WriteStep::Done(
                resp.bytes()
                    .await
                    .map(|b| b.to_vec())
                    .map_err(|e| NetError::Transport(e.to_string())),
            );
        }
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return WriteStep::Done(Err(NetError::Unauthorized));
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            if attempt >= MAX_RETRIES {
                return WriteStep::Done(Err(NetError::RateLimited));
            }
            return WriteStep::Backoff(governor::decide_backoff(
                budget.retry_after_secs,
                attempt + 1,
                true,
            ));
        }
        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();
        WriteStep::Done(Err(NetError::Http { status: code, body }))
    }
}

/// What a write response asks the caller to do next.
enum WriteStep {
    Done(Result<Vec<u8>, NetError>),
    Backoff(Duration),
}

/// A file part sourced from a path on the device rather than from memory.
pub struct FilePart<'a> {
    /// Multipart field name the server expects.
    pub field: &'a str,
    /// Where the file sits on the device. A `file://` URI is accepted, since
    /// that is the form the app's storage layer hands around.
    pub path: &'a str,
    /// The filename recorded against the upload.
    pub filename: &'a str,
}

/// Open a file part and wrap it as a length-known stream. The length keeps the
/// request on `Content-Length` rather than chunked encoding.
async fn streamed_file_part(file: &FilePart<'_>) -> Result<reqwest::multipart::Part, NetError> {
    let path = strip_file_scheme(file.path);
    let handle = tokio::fs::File::open(path)
        .await
        .map_err(|e| NetError::Io(format!("cannot open {}: {}", path, e)))?;
    let len = handle
        .metadata()
        .await
        .map_err(|e| NetError::Io(format!("cannot size {}: {}", path, e)))?
        .len();
    let body = reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(handle));
    reqwest::multipart::Part::stream_with_length(body, len)
        .file_name(file.filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| NetError::Io(e.to_string()))
}

/// Drop a `file://` scheme so an app storage URI opens as a filesystem path.
/// No percent-decoding: the paths that reach here are generated ids under the
/// app's own document directory, never user-typed text.
fn strip_file_scheme(path: &str) -> &str {
    path.strip_prefix("file://").unwrap_or(path)
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
            when.method(GET).path("/athlete/i1").header(
                "authorization",
                &governor::format_auth_header(AuthMethod::ApiKey("secret")),
            );
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
        let mock = server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(401);
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::Unauthorized)));
        // 401 is terminal: credentials won't improve on retry, so dispatch once.
        assert_eq!(mock.hits(), 1);
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
    fn retries_5xx_then_returns_http_error() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/y");
            then.status(503);
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/y", &[], Lane::Interactive));
        // A 5xx is retried with exponential backoff, then surfaced as Http once
        // the retry budget is exhausted (httpmock 0.7 can't sequence a transient
        // 503-then-200, so the give-up path is what we can assert deterministically).
        assert!(matches!(res, Err(NetError::Http { status: 503, .. })));
        assert_eq!(mock.hits(), (MAX_RETRIES + 1) as usize);
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

    #[test]
    fn each_dispatch_passes_through_the_governor() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/p");
            then.status(200).json_body(json!({"ok": true}));
        });
        // A deliberately slow 4 req/s governor (250ms/slot): the second request
        // can only fire after waiting a slot, which proves the transport acquires
        // the shared governor before dispatch rather than sending immediately.
        let gov = Arc::new(Governor::new(4, Box::new(NoopPolicy)));
        let t = Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), gov).unwrap();
        let start = std::time::Instant::now();
        let _: serde_json::Value =
            crate::runtime::block_on(t.get_json("/p", &[], Lane::Interactive)).unwrap();
        let _: serde_json::Value =
            crate::runtime::block_on(t.get_json("/p", &[], Lane::Interactive)).unwrap();
        assert!(
            start.elapsed() >= Duration::from_millis(240),
            "second dispatch was not paced by the governor: {:?}",
            start.elapsed()
        );
        assert_eq!(mock.hits(), 2);
    }

    #[test]
    fn drops_the_file_scheme_from_a_storage_uri() {
        assert_eq!(
            strip_file_scheme("file:///data/rec/1.fit"),
            "/data/rec/1.fit"
        );
        assert_eq!(strip_file_scheme("/data/rec/1.fit"), "/data/rec/1.fit");
    }

    /// A FIT file on disk, plus the handle that keeps it alive for the test.
    fn staged_fit() -> (tempfile::NamedTempFile, String) {
        use std::io::Write;
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&[0x0e, 0x20, 0x00, 0x00, 0x2e, 0x46, 0x49, 0x54])
            .unwrap();
        f.flush().unwrap();
        let path = f.path().to_string_lossy().into_owned();
        (f, path)
    }

    fn upload_parts() -> Vec<(&'static str, String)> {
        vec![
            ("name", "Bern loop".to_string()),
            ("paired_event_id", "4321".to_string()),
            ("device_name", "Veloq".to_string()),
        ]
    }

    #[test]
    fn multipart_streams_the_file_and_names_every_part() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .header(
                    "authorization",
                    governor::format_auth_header(AuthMethod::ApiKey("k")),
                )
                // The field names intervals.icu expects. A rename here silently
                // loses the activity, so each part is asserted by name.
                .body_contains("name=\"file\"")
                .body_contains("filename=\"Morning Ride.fit\"")
                .body_contains("name=\"name\"")
                .body_contains("Bern loop")
                .body_contains("name=\"paired_event_id\"")
                .body_contains("4321")
                .body_contains("name=\"device_name\"")
                .body_contains("Veloq")
                // The streamed bytes arrive intact.
                .body_contains(".FIT");
            then.status(200).json_body(json!({"id": "i999"}));
        });

        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "Morning Ride.fit",
        };
        let body = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &upload_parts(),
            Lane::Interactive,
            Duration::from_secs(60),
        ))
        .unwrap();
        mock.assert();
        assert!(String::from_utf8_lossy(&body).contains("i999"));
    }

    #[test]
    fn multipart_accepts_a_file_scheme_path() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(200).json_body(json!({"id": "i999"}));
        });

        let (_file, path) = staged_fit();
        let uri = format!("file://{}", path);
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &uri,
            filename: "ride.fit",
        };
        crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ))
        .unwrap();
        mock.assert();
    }

    #[test]
    fn multipart_403_surfaces_once_with_its_body() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(403)
                .json_body(json!({"error": "No permission"}));
        });

        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &upload_parts(),
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        match res {
            Err(NetError::Http { status, body }) => {
                assert_eq!(status, 403);
                assert!(body.contains("No permission"));
            }
            other => panic!("expected a 403, got {:?}", other),
        }
        // A rejected upload is dispatched once: the queue owns the retry.
        assert_eq!(mock.hits(), 1);
    }

    #[test]
    fn multipart_429_honours_retry_after_then_gives_up() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(429).header("retry-after", "0");
        });

        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &upload_parts(),
            Lane::Backfill,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::RateLimited)));
        // A 429 was refused outright, so re-sending cannot duplicate anything.
        assert_eq!(mock.hits(), (MAX_RETRIES + 1) as usize);
    }

    #[test]
    fn multipart_5xx_is_not_retried() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(503);
        });

        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::Http { status: 503, .. })));
        // The server may have applied the write before failing, so a blind
        // resend could double-post. One dispatch, then surface.
        assert_eq!(mock.hits(), 1);
    }

    #[test]
    fn multipart_transport_failure_surfaces_immediately() {
        let (_file, path) = staged_fit();
        let t = fast_transport("http://127.0.0.1:1".to_string(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::Transport(_))));
    }

    #[test]
    fn a_missing_file_is_an_io_error_not_a_network_one() {
        // Misreading this as a network failure would queue the upload forever
        // against a file that will never appear.
        let t = fast_transport("http://127.0.0.1:1".to_string(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: "/nonexistent/ride.fit",
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::Io(_))));
    }

    #[test]
    fn post_json_sends_the_body_and_returns_the_response() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .header("authorization", "Bearer tok")
                .json_body(json!({"name": "Yoga", "trainer": false}));
            then.status(200).json_body(json!({"id": "i77"}));
        });
        let t = fast_transport(server.base_url(), AuthMethod::Bearer("tok"));
        let body = crate::runtime::block_on(t.post_json(
            "/athlete/i1/activities",
            &json!({"name": "Yoga", "trainer": false}),
            Lane::Interactive,
        ))
        .unwrap();
        mock.assert();
        assert!(String::from_utf8_lossy(&body).contains("i77"));
    }

    #[test]
    fn post_json_401_is_terminal() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(401);
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res = crate::runtime::block_on(t.post_json(
            "/athlete/i1/activities",
            &json!({}),
            Lane::Interactive,
        ));
        assert!(matches!(res, Err(NetError::Unauthorized)));
        assert_eq!(mock.hits(), 1);
    }

    /// A socket that completes the TCP handshake and then never answers. This
    /// is the captive portal and the hotel wifi, and it is the case a bare
    /// total timeout handles worst.
    struct HangingSocket {
        addr: std::net::SocketAddr,
        connections: Arc<std::sync::atomic::AtomicUsize>,
    }

    fn hanging_socket() -> HangingSocket {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let connections = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = connections.clone();
        std::thread::spawn(move || {
            // Accepted streams are parked, never read and never written, so the
            // client sees a live connection that produces no response.
            let mut parked = Vec::new();
            for stream in listener.incoming().flatten() {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                parked.push(stream);
            }
        });
        HangingSocket { addr, connections }
    }

    fn brisk_timeouts() -> LaneTimeouts {
        LaneTimeouts {
            connect: Duration::from_millis(200),
            interactive: Duration::from_millis(300),
            backfill: Duration::from_millis(300),
            interactive_budget: Duration::from_millis(400),
        }
    }

    fn transport_to(addr: std::net::SocketAddr, timeouts: LaneTimeouts) -> Transport {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        Transport::with_timeouts(
            format!("http://{}", addr),
            AuthMethod::ApiKey("k"),
            gov,
            timeouts,
        )
        .unwrap()
    }

    #[test]
    fn a_hanging_socket_costs_the_interactive_lane_one_attempt_not_four() {
        let socket = hanging_socket();
        let t = transport_to(socket.addr, brisk_timeouts());
        let started = std::time::Instant::now();
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::Transport(_))), "{:?}", res);
        assert_eq!(
            socket.connections.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "a lane a user waits on must not spend its retries on a socket that hangs"
        );
        assert!(
            started.elapsed() < brisk_timeouts().interactive_budget * 3,
            "interactive request outran its budget: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn the_backfill_lane_still_spends_every_retry_on_a_hanging_socket() {
        // Backfill has no user waiting on it, so the retry budget is the point.
        let socket = hanging_socket();
        let t = transport_to(socket.addr, brisk_timeouts());
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Backfill));
        assert!(matches!(res, Err(NetError::Transport(_))), "{:?}", res);
        assert_eq!(
            socket.connections.load(std::sync::atomic::Ordering::SeqCst),
            (MAX_RETRIES + 1) as usize
        );
    }

    #[test]
    fn a_repeated_429_stops_at_the_interactive_budget() {
        // Retry-After is honoured, but not past what the waiting user is owed.
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(429).header("retry-after", "1");
        });
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let t = Transport::with_timeouts(
            server.base_url(),
            AuthMethod::ApiKey("k"),
            gov,
            brisk_timeouts(),
        )
        .unwrap();
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::RateLimited)));
        assert_eq!(
            mock.hits(),
            1,
            "a 1s Retry-After does not fit a 400ms budget"
        );
    }

    #[test]
    fn a_5xx_run_stops_at_the_interactive_budget() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/y");
            then.status(503);
        });
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let t = Transport::with_timeouts(
            server.base_url(),
            AuthMethod::ApiKey("k"),
            gov,
            brisk_timeouts(),
        )
        .unwrap();
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/y", &[], Lane::Interactive));
        // The 503 comes back at once, so the attempt is not what runs out: the
        // 400ms backoff no longer fits the 400ms budget, so the error surfaces
        // instead of being retried into a wait the user is still sitting in.
        assert!(
            matches!(res, Err(NetError::Http { status: 503, .. })),
            "{:?}",
            res
        );
        assert_eq!(mock.hits(), 1);
    }

    #[test]
    fn an_attempt_never_gets_more_than_the_budget_has_left() {
        let t = LaneTimeouts::default();
        let fresh = Instant::now();
        assert_eq!(t.attempt(Lane::Interactive, fresh), t.interactive);
        // Backfill is unbudgeted, so it keeps the long ceiling however long the
        // request has already run.
        assert_eq!(t.attempt(Lane::Backfill, fresh), t.backfill);
        let spent = Instant::now() - (t.interactive_budget - Duration::from_secs(1));
        let left = t.attempt(Lane::Interactive, spent);
        assert!(
            left <= Duration::from_secs(1) && left > Duration::from_millis(900),
            "expected roughly the second the budget had left, got {:?}",
            left
        );
        let overrun = Instant::now() - (t.interactive_budget + Duration::from_secs(1));
        assert_eq!(t.attempt(Lane::Interactive, overrun), Duration::ZERO);
    }

    #[test]
    fn the_shipped_timeouts_bound_what_a_user_can_be_made_to_wait() {
        let t = LaneTimeouts::default();
        assert!(
            t.connect <= Duration::from_secs(5),
            "a connect that never completes must not burn a whole attempt"
        );
        assert!(t.interactive < t.backfill);
        // The old worst case was 4 x 30s of frozen UI. Whatever the numbers
        // become, one interactive request stays inside ten seconds.
        assert!(t.interactive_budget <= Duration::from_secs(10));
        assert!(t.interactive <= t.interactive_budget);
    }
}
