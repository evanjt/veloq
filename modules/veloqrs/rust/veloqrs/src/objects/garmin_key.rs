//! The Garmin Personal key the athlete pasted, held in process memory.
//!
//! The key is kept in the device keychain by the app and handed here once the
//! library is open. It is never written to the database, so no backup carries
//! it, and it is never logged. Only the Garmin client reads it, and the client
//! sends it to Garmin's token endpoint and nowhere else.

use std::sync::{Arc, LazyLock, Mutex};

use crate::net::garmin::{GarminClient, GarminError};
use crate::net::transport::NetError;

/// What Garmin said about a key the athlete pasted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum GarminKeyStatus {
    /// Garmin exchanged the key for a token.
    Connected,
    /// Garmin refused the key: deleted, expired or mistyped.
    Rejected,
    /// The text is not a key; Garmin answered 400, or nothing was pasted.
    Malformed,
    /// Garmin could not be reached, so nothing is known about the key.
    Unreachable,
    /// Garmin accepted the key but refused it the account's activities.
    NoActivityAccess,
}

/// The client for the held key, if any.
#[derive(Default)]
pub(crate) struct GarminKeyHolder {
    client: Mutex<Option<Arc<GarminClient>>>,
}

impl GarminKeyHolder {
    /// The client for the held key, for a caller that talks to Garmin with it.
    pub(crate) fn client(&self) -> Option<Arc<GarminClient>> {
        self.client
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub(crate) fn hold(&self, client: GarminClient) {
        *self.client.lock().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(client));
    }

    /// Hold `client` unless one is held already, and say whether it was taken.
    /// The one held keeps the token it has exchanged.
    pub(crate) fn hold_if_absent(&self, client: impl FnOnce() -> GarminClient) -> bool {
        let mut held = self.client.lock().unwrap_or_else(|e| e.into_inner());
        if held.is_some() {
            return false;
        }
        *held = Some(Arc::new(client()));
        true
    }

    pub(crate) fn clear(&self) {
        *self.client.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Ask Garmin whether `pasted` is a key, and hold it only when it is.
    ///
    /// A key Garmin refuses replaces nothing: the key already held keeps
    /// working until the athlete's new one is accepted.
    pub(crate) async fn connect(
        &self,
        pasted: &str,
        make_client: impl FnOnce(String) -> GarminClient,
    ) -> GarminKeyStatus {
        let key = pasted.trim();
        if key.is_empty() {
            return GarminKeyStatus::Malformed;
        }
        let client = make_client(key.to_string());
        match client.check_key(crate::net::garmin::dispatch()).await {
            Ok(()) => match client
                .check_activity_access(crate::net::garmin::dispatch())
                .await
            {
                Ok(()) => {
                    self.hold(client);
                    GarminKeyStatus::Connected
                }
                Err(GarminError::KeyRejected)
                | Err(GarminError::Net(NetError::Http { status: 403, .. })) => {
                    GarminKeyStatus::NoActivityAccess
                }
                Err(GarminError::KeyMalformed) => GarminKeyStatus::Malformed,
                Err(GarminError::Net(_)) => GarminKeyStatus::Unreachable,
            },
            Err(GarminError::KeyRejected) => GarminKeyStatus::Rejected,
            Err(GarminError::KeyMalformed) => GarminKeyStatus::Malformed,
            Err(GarminError::Net(_)) => GarminKeyStatus::Unreachable,
        }
    }
}

pub(crate) static GARMIN_KEY: LazyLock<GarminKeyHolder> = LazyLock::new(Default::default);

/// Validate a pasted key against Garmin and hold it on success.
pub(crate) async fn connect_garmin(pasted: String) -> GarminKeyStatus {
    let (tx, rx) = tokio::sync::oneshot::channel();
    crate::runtime::spawn(async move {
        let _ = tx.send(GARMIN_KEY.connect(&pasted, GarminClient::new).await);
    });
    rx.await.unwrap_or(GarminKeyStatus::Unreachable)
}

/// Hold a key read back from the keychain, unchecked: a launch asks Garmin
/// nothing until a pass needs a token.
pub(crate) fn hold_garmin_key(key: &str) {
    let key = key.trim();
    if !key.is_empty() {
        GARMIN_KEY.hold(GarminClient::new(key));
    }
}

/// Hold a key a native handler read from the keychain, unless the process
/// already holds one: the app's own key is the fresher of the two and has
/// the token it exchanged.
pub(crate) fn hold_garmin_key_if_absent(key: &str) {
    let key = key.trim();
    if !key.is_empty() {
        GARMIN_KEY.hold_if_absent(|| GarminClient::new(key));
    }
}

pub(crate) fn clear_garmin_key() {
    crate::net::garmin::pull::stop();
    GARMIN_KEY.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::{Governor, NoopPolicy};
    use base64::Engine;
    use chrono::{Duration, Utc};
    use httpmock::prelude::*;
    use serde_json::json;

    const TOKEN_PATH: &str = "/personalapitoken-service/personal-api/personal-api-key/token";
    const LIST_PATH: &str = "/activitylist-service/activities/search/activities";

    fn mock_list(server: &MockServer, status: u16) -> httpmock::Mock<'_> {
        server.mock(|when, then| {
            when.method(GET).path(LIST_PATH);
            then.status(status).json_body(json!([]));
        })
    }

    fn token() -> String {
        let b64 = |v: serde_json::Value| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string())
        };
        let exp = (Utc::now() + Duration::hours(24)).timestamp();
        format!(
            "{}.{}.sig",
            b64(json!({"alg": "RS256"})),
            b64(json!({"exp": exp}))
        )
    }

    fn maker(server: &MockServer) -> impl FnOnce(String) -> GarminClient + '_ {
        move |key| {
            let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
            GarminClient::with_governor(server.base_url(), key, gov)
        }
    }

    fn connect(holder: &GarminKeyHolder, server: &MockServer, pasted: &str) -> GarminKeyStatus {
        crate::runtime::block_on(holder.connect(pasted, maker(server)))
    }

    #[test]
    fn an_accepted_key_is_held_and_reaches_garmin_trimmed() {
        let server = MockServer::start();
        let exchange = server.mock(|when, then| {
            when.method(POST)
                .path(TOKEN_PATH)
                .header("authorization", "ApiKey pasted-key");
            then.status(200).body(token());
        });
        mock_list(&server, 200);
        let holder = GarminKeyHolder::default();
        assert_eq!(
            connect(&holder, &server, "  pasted-key\n"),
            GarminKeyStatus::Connected
        );
        exchange.assert_calls(1);
        assert!(holder.client().is_some());
    }

    #[test]
    fn connecting_reads_at_most_one_activity_and_asks_nothing_else() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path(TOKEN_PATH);
            then.status(200).body(token());
        });
        let listed = server.mock(|when, then| {
            when.method(GET)
                .path(LIST_PATH)
                .query_param("limit", "1")
                .query_param("start", "0");
            then.status(200).json_body(json!([]));
        });
        let holder = GarminKeyHolder::default();
        assert_eq!(connect(&holder, &server, "k"), GarminKeyStatus::Connected);
        listed.assert_calls(1);
    }

    #[test]
    fn a_key_garmin_accepts_but_refuses_the_activities_has_no_activity_access_and_is_not_held() {
        for refusal in [401, 403] {
            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(POST).path(TOKEN_PATH);
                then.status(200).body(token());
            });
            mock_list(&server, refusal);
            let holder = GarminKeyHolder::default();
            assert_eq!(
                connect(&holder, &server, "k"),
                GarminKeyStatus::NoActivityAccess,
                "status {refusal}"
            );
            assert!(holder.client().is_none());
        }
    }

    #[test]
    fn a_rejected_key_is_not_held() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path(TOKEN_PATH);
            then.status(401);
        });
        let holder = GarminKeyHolder::default();
        assert_eq!(
            connect(&holder, &server, "stale"),
            GarminKeyStatus::Rejected
        );
        assert!(holder.client().is_none());
    }

    #[test]
    fn a_rejected_key_leaves_the_held_one_working() {
        let server = MockServer::start();
        let mut ok = server.mock(|when, then| {
            when.method(POST)
                .path(TOKEN_PATH)
                .header("authorization", "ApiKey good");
            then.status(200).body(token());
        });
        mock_list(&server, 200);
        let holder = GarminKeyHolder::default();
        assert_eq!(
            connect(&holder, &server, "good"),
            GarminKeyStatus::Connected
        );
        ok.delete();
        server.mock(|when, then| {
            when.method(POST).path(TOKEN_PATH);
            then.status(401);
        });
        assert_eq!(connect(&holder, &server, "bad"), GarminKeyStatus::Rejected);
        assert!(holder.client().is_some());
    }

    #[test]
    fn a_400_and_an_empty_paste_are_malformed_and_the_empty_one_sends_nothing() {
        let server = MockServer::start();
        let exchange = server.mock(|when, then| {
            when.method(POST).path(TOKEN_PATH);
            then.status(400);
        });
        let holder = GarminKeyHolder::default();
        assert_eq!(
            connect(&holder, &server, "not a key"),
            GarminKeyStatus::Malformed
        );
        exchange.assert_calls(1);
        assert_eq!(connect(&holder, &server, "   "), GarminKeyStatus::Malformed);
        exchange.assert_calls(1);
        assert!(holder.client().is_none());
    }

    #[test]
    fn an_unreachable_garmin_says_nothing_about_the_key() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path(TOKEN_PATH);
            then.status(500);
        });
        let holder = GarminKeyHolder::default();
        assert_eq!(connect(&holder, &server, "k"), GarminKeyStatus::Unreachable);
        assert!(holder.client().is_none());
    }

    #[test]
    fn clearing_forgets_the_key() {
        let holder = GarminKeyHolder::default();
        holder.hold(GarminClient::new("k"));
        assert!(holder.client().is_some());
        holder.clear();
        assert!(holder.client().is_none());
    }
}
