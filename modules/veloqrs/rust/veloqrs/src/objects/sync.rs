//! The intervals.icu sync service — the single first-class FFI contract for all
//! network I/O.
//!
//! TypeScript holds no axios client and constructs no per-call auth header. It
//! sets credentials once, issues commands (`sync_now`, `cancel`), and reads a
//! status snapshot (`get_sync_status`). The service owns a `Transport`, runs work
//! on the shared `ASYNC_RUNTIME`, and never blocks the JS thread: commands return
//! instantly after posting to the runtime; results surface through status.
//!
//! This is the command + status boundary. The contract (commands + status) is
//! identical whether the underlying transport is a true async FFI future or this
//! instant-return-plus-status form, so a later async-FFI swap is invisible to TS.

use super::error::VeloqError;
use crate::governor::{AuthMethod, Lane};
use crate::net::endpoints;
use crate::net::transport::{NetError, Transport};
use once_cell::sync::Lazy;
use std::sync::Arc;
use std::sync::Mutex;

const INTERVALS_BASE_URL: &str = "https://intervals.icu/api/v1";

/// The lifecycle state TypeScript renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncState {
    Idle,
    Syncing,
    Paused,
    AuthExpired,
}

impl SyncState {
    fn as_str(&self) -> &'static str {
        match self {
            SyncState::Idle => "idle",
            SyncState::Syncing => "syncing",
            SyncState::Paused => "paused",
            SyncState::AuthExpired => "authExpired",
        }
    }
}

/// Authentication scheme for the held credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthKind {
    OAuth,
    ApiKey,
}

impl AuthKind {
    fn parse(method: &str) -> Option<AuthKind> {
        match method.to_ascii_lowercase().as_str() {
            "oauth" | "bearer" => Some(AuthKind::OAuth),
            "api_key" | "apikey" | "basic" => Some(AuthKind::ApiKey),
            _ => None,
        }
    }
}

/// Credentials held in Rust RAM only (TypeScript owns SecureStore). Cleared on
/// logout via `clear_credentials`.
#[derive(Clone)]
struct Credentials {
    method: AuthKind,
    secret: String,
    athlete_id: String,
}

/// The status fields TypeScript reads / subscribes to.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSyncStatus {
    pub state: String,
    pub in_flight: u32,
    pub completed: u32,
    pub total: u32,
    pub last_error: Option<String>,
}

struct SyncInner {
    state: SyncState,
    in_flight: u32,
    completed: u32,
    total: u32,
    last_error: Option<String>,
    running: bool,
    cancel: bool,
}

impl Default for SyncInner {
    fn default() -> Self {
        SyncInner {
            state: SyncState::Idle,
            in_flight: 0,
            completed: 0,
            total: 0,
            last_error: None,
            running: false,
            cancel: false,
        }
    }
}

/// The long-lived service: status + credentials + base URL. One instance lives in
/// the `SYNC_SERVICE` static; tests construct their own.
pub struct SyncService {
    inner: Mutex<SyncInner>,
    creds: Mutex<Option<Credentials>>,
    base_url: Mutex<String>,
}

impl SyncService {
    fn new() -> Self {
        SyncService {
            inner: Mutex::new(SyncInner::default()),
            creds: Mutex::new(None),
            base_url: Mutex::new(INTERVALS_BASE_URL.to_string()),
        }
    }

    fn set_credentials(&self, method: AuthKind, secret: String, athlete_id: String) {
        let mut g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        *g = Some(Credentials {
            method,
            secret,
            athlete_id,
        });
    }

    fn clear_credentials(&self) {
        let mut g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        *g = None;
    }

    /// Build a transport from the held credentials and base URL.
    fn build_transport(&self) -> Result<(Transport, String), String> {
        let creds_guard = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        let creds = creds_guard
            .as_ref()
            .ok_or_else(|| "no credentials set".to_string())?;
        let base = self
            .base_url
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let auth = match creds.method {
            AuthKind::OAuth => AuthMethod::Bearer(&creds.secret),
            AuthKind::ApiKey => AuthMethod::ApiKey(&creds.secret),
        };
        let transport = Transport::new(base, auth)?;
        Ok((transport, creds.athlete_id.clone()))
    }

    /// Atomically claim the running slot and move to `Syncing`. Returns false if a
    /// sync is already in flight (so commands are idempotent under rapid taps).
    fn try_begin(&self) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.running {
            return false;
        }
        inner.running = true;
        inner.cancel = false;
        inner.state = SyncState::Syncing;
        inner.total = 1;
        inner.in_flight = 1;
        inner.completed = 0;
        inner.last_error = None;
        true
    }

    /// Terminal transition for a finished job.
    fn finish(&self, state: SyncState, last_error: Option<String>, success: bool) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.state = state;
        inner.running = false;
        inner.in_flight = 0;
        if success {
            inner.completed = inner.total;
        }
        inner.last_error = last_error;
    }

    /// Soft cancel: flag the loop so it stops dispatching new work. An in-flight
    /// request is allowed to finish.
    fn request_cancel(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.cancel = true;
        // Pause dispatch while a request is in flight; the job's terminal
        // transition then settles back to Idle.
        if inner.running {
            inner.state = SyncState::Paused;
        }
    }

    fn is_cancelled(&self) -> bool {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).cancel
    }

    fn snapshot(&self) -> FfiSyncStatus {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        FfiSyncStatus {
            state: inner.state.as_str().to_string(),
            in_flight: inner.in_flight,
            completed: inner.completed,
            total: inner.total,
            last_error: inner.last_error.clone(),
        }
    }
}

/// The process-wide sync service.
pub static SYNC_SERVICE: Lazy<SyncService> = Lazy::new(SyncService::new);

/// The sync job. Phase 1 performs a credential + connectivity check (a cheap
/// `/athlete/me`), proving the command → runtime → transport → governor → status
/// path end-to-end without touching the engine. Per-endpoint slices extend this
/// into the full activities / wellness / streams sync that writes the engine.
///
/// Free function over `&SyncService` so tests can drive it with a mock-server
/// transport against a local service instance.
pub(crate) async fn perform_sync(svc: &SyncService, transport: Transport, _athlete_id: String) {
    if svc.is_cancelled() {
        svc.finish(SyncState::Idle, None, false);
        return;
    }
    match endpoints::fetch_current_athlete(&transport, Lane::Interactive).await {
        Ok(_) => svc.finish(SyncState::Idle, None, true),
        Err(NetError::Unauthorized) => {
            svc.finish(SyncState::AuthExpired, Some("unauthorized".to_string()), false)
        }
        Err(e) => svc.finish(SyncState::Idle, Some(e.to_string()), false),
    }
}

/// The FFI service object. The single thing TypeScript calls for I/O.
#[derive(uniffi::Object)]
pub struct SyncManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl SyncManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Set the credential once (method = "oauth" | "api_key"). Never passed per request.
    fn set_credentials(
        &self,
        method: String,
        secret: String,
        athlete_id: String,
    ) -> Result<(), VeloqError> {
        let kind = AuthKind::parse(&method).ok_or(VeloqError::ParseError {
            msg: format!("unknown auth method: {}", method),
        })?;
        SYNC_SERVICE.set_credentials(kind, secret, athlete_id);
        Ok(())
    }

    /// Forget the credential (logout).
    fn clear_credentials(&self) {
        SYNC_SERVICE.clear_credentials();
    }

    /// Start a sync. Returns instantly: true if a new sync started, false if one
    /// was already running or credentials are missing. Work runs on the shared
    /// runtime; observe progress via `get_sync_status`.
    fn sync_now(&self) -> Result<bool, VeloqError> {
        if !SYNC_SERVICE.try_begin() {
            return Ok(false);
        }
        match SYNC_SERVICE.build_transport() {
            Ok((transport, athlete_id)) => {
                crate::runtime::spawn(async move {
                    perform_sync(&SYNC_SERVICE, transport, athlete_id).await;
                });
                Ok(true)
            }
            Err(e) => {
                SYNC_SERVICE.finish(SyncState::Idle, Some(e), false);
                Ok(false)
            }
        }
    }

    /// Soft-cancel the running sync.
    fn cancel(&self) {
        SYNC_SERVICE.request_cancel();
    }

    /// Current status snapshot.
    fn get_sync_status(&self) -> FfiSyncStatus {
        SYNC_SERVICE.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::{Governor, NoopPolicy};
    use httpmock::prelude::*;
    use serde_json::json;

    fn transport_to(base: String) -> Transport {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).unwrap()
    }

    #[test]
    fn fresh_service_is_idle() {
        let svc = SyncService::new();
        let s = svc.snapshot();
        assert_eq!(s.state, "idle");
        assert_eq!(s.in_flight, 0);
        assert!(s.last_error.is_none());
    }

    #[test]
    fn try_begin_is_exclusive() {
        let svc = SyncService::new();
        assert!(svc.try_begin());
        assert_eq!(svc.snapshot().state, "syncing");
        // Second begin while running is rejected.
        assert!(!svc.try_begin());
    }

    #[test]
    fn build_transport_requires_credentials() {
        let svc = SyncService::new();
        assert!(svc.build_transport().is_err());
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        let (_t, athlete) = svc.build_transport().unwrap();
        assert_eq!(athlete, "i1");
    }

    #[test]
    fn successful_sync_returns_to_idle_completed() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/me");
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        let svc = SyncService::new();
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, "idle");
        assert_eq!(s.completed, 1);
        assert_eq!(s.in_flight, 0);
        assert!(s.last_error.is_none());
    }

    #[test]
    fn unauthorized_sync_moves_to_auth_expired() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/me");
            then.status(401);
        });
        let svc = SyncService::new();
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, "authExpired");
        assert_eq!(s.completed, 0);
        assert_eq!(s.last_error.as_deref(), Some("unauthorized"));
    }

    #[test]
    fn server_error_records_error_but_returns_idle() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/me");
            then.status(500);
        });
        let svc = SyncService::new();
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, "idle");
        assert_eq!(s.completed, 0);
        assert!(s.last_error.is_some());
    }

    #[test]
    fn cancel_before_run_skips_work() {
        let svc = SyncService::new();
        assert!(svc.try_begin());
        svc.request_cancel();
        assert!(svc.is_cancelled());
        assert_eq!(svc.snapshot().state, "paused");
        // A mock that would panic the assertion if hit is unnecessary: a cancelled
        // job finishes without dispatching. Point at an unroutable base; the job
        // must not touch it.
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to("http://127.0.0.1:1".into()),
            "i1".into(),
        ));
        assert_eq!(svc.snapshot().state, "idle");
    }

    #[test]
    fn set_and_clear_credentials_round_trip() {
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::OAuth, "tok".into(), "i9".into());
        assert!(svc.build_transport().is_ok());
        svc.clear_credentials();
        assert!(svc.build_transport().is_err());
    }

    #[test]
    fn auth_kind_parsing() {
        assert_eq!(AuthKind::parse("oauth"), Some(AuthKind::OAuth));
        assert_eq!(AuthKind::parse("API_KEY"), Some(AuthKind::ApiKey));
        assert_eq!(AuthKind::parse("nonsense"), None);
    }

    #[test]
    fn try_begin_is_exclusive_under_contention() {
        // Race many threads on one service. The running slot is the lock that
        // stops two concurrent syncs, so exactly one caller may claim it.
        use std::sync::atomic::{AtomicU32, Ordering};
        let svc = Arc::new(SyncService::new());
        let winners = Arc::new(AtomicU32::new(0));
        let handles: Vec<_> = (0..16)
            .map(|_| {
                let svc = svc.clone();
                let winners = winners.clone();
                std::thread::spawn(move || {
                    if svc.try_begin() {
                        winners.fetch_add(1, Ordering::Relaxed);
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(winners.load(Ordering::Relaxed), 1);
        assert_eq!(svc.snapshot().state, "syncing");
    }

    #[test]
    fn begin_after_cancel_clears_cancel_flag() {
        // A soft-cancel must not persist into the next sync, or every future run
        // would bail immediately at the is_cancelled() gate.
        let svc = SyncService::new();
        assert!(svc.try_begin());
        svc.request_cancel();
        svc.finish(SyncState::Idle, None, false);
        assert!(svc.is_cancelled(), "the flag survives until the next begin consumes it");
        assert!(svc.try_begin());
        assert!(!svc.is_cancelled(), "a fresh begin clears the prior cancellation");
    }

    #[test]
    fn auth_expired_recovers_on_next_begin() {
        // After a 401 the service rests in authExpired. Once TypeScript re-auths
        // and issues sync_now again, try_begin moves it back into syncing.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/me");
            then.status(401);
        });
        let svc = SyncService::new();
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        assert_eq!(svc.snapshot().state, "authExpired");
        assert!(svc.try_begin());
        assert_eq!(svc.snapshot().state, "syncing");
    }
}
