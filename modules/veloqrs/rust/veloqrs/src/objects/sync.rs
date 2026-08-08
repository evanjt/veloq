//! The intervals.icu sync service - the single first-class FFI contract for all
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
use crate::governor::{self, AuthMethod, Lane};
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

    /// The `Authorization` header value for the held credential, if any.
    fn auth_header(&self) -> Option<String> {
        let g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        g.as_ref().map(|c| match c.method {
            AuthKind::OAuth => governor::format_auth_header(AuthMethod::Bearer(&c.secret)),
            AuthKind::ApiKey => governor::format_auth_header(AuthMethod::ApiKey(&c.secret)),
        })
    }

    /// The athlete id the held credential belongs to, if any.
    fn athlete_id(&self) -> Option<String> {
        let g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        g.as_ref().map(|c| c.athlete_id.clone())
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

    /// Declare how many steps the job will run, so a poll of the status shows
    /// real progress instead of a single opaque unit.
    fn begin_steps(&self, total: u32) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.total = total;
        inner.completed = 0;
        inner.in_flight = 1;
    }

    /// Advance the completed counter by one step.
    fn complete_step(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.completed = (inner.completed + 1).min(inner.total);
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

/// The `Authorization` header for the process-wide credential, or `None` before
/// TypeScript has called `set_credentials`. Every Rust I/O path resolves its
/// header here rather than accepting one across FFI.
pub fn current_auth_header() -> Option<String> {
    SYNC_SERVICE.auth_header()
}

/// The athlete id the process-wide credential belongs to.
pub fn current_athlete_id() -> Option<String> {
    SYNC_SERVICE.athlete_id()
}

/// How many days of wellness one full sync pulls. The widest range the fitness
/// screens offer is a year; the extra days are slack so the oldest day of a
/// '1y' window still resolves when the app runs past midnight without resyncing.
const WELLNESS_DAYS: i64 = 370;

/// The steps `perform_sync` runs, for the progress counters TypeScript polls.
const SYNC_STEPS: u32 = 3;

/// The sync job: fetch the profile slice and write it into SQLite. Every step
/// is independent, so one failing endpoint does not cost the others their data.
/// A 401 is terminal, because no later step can succeed with a dead credential.
///
/// Free function over `&SyncService` so tests can drive it with a mock-server
/// transport against a local service instance.
pub(crate) async fn perform_sync(svc: &SyncService, transport: Transport, athlete_id: String) {
    if svc.is_cancelled() {
        svc.finish(SyncState::Idle, None, false);
        return;
    }
    svc.begin_steps(SYNC_STEPS);

    let mut last_error: Option<String> = None;

    macro_rules! step {
        ($body:expr) => {
            if svc.is_cancelled() {
                svc.finish(SyncState::Idle, last_error, false);
                return;
            }
            match $body {
                Ok(()) => svc.complete_step(),
                Err(NetError::Unauthorized) => {
                    svc.finish(
                        SyncState::AuthExpired,
                        Some("unauthorized".to_string()),
                        false,
                    );
                    return;
                }
                // A failed step is not a completed one, so the counter stays
                // an honest count of what actually landed in SQLite.
                Err(e) => last_error = Some(e.to_string()),
            }
        };
    }

    step!(sync_athlete(&transport, &athlete_id).await);
    step!(sync_sport_settings(&transport, &athlete_id).await);
    step!(sync_wellness(&transport, &athlete_id, WELLNESS_DAYS, Lane::Backfill).await);

    let success = last_error.is_none();
    svc.finish(SyncState::Idle, last_error, success);
}

/// Persist the athlete profile body.
async fn sync_athlete(transport: &Transport, athlete_id: &str) -> Result<(), NetError> {
    let body = endpoints::fetch_athlete_body(transport, athlete_id, Lane::Interactive).await?;
    crate::persistence::with_persistent_engine(|engine| engine.set_athlete_profile(&body));
    Ok(())
}

/// Persist the sport settings body.
async fn sync_sport_settings(transport: &Transport, athlete_id: &str) -> Result<(), NetError> {
    let body =
        endpoints::fetch_sport_settings_body(transport, athlete_id, Lane::Interactive).await?;
    crate::persistence::with_persistent_engine(|engine| engine.set_sport_settings(&body));
    Ok(())
}

/// Persist the trailing `days` of wellness, typed columns plus the untyped body
/// per day. The upsert is keyed on date, so a narrow refresh window merges into
/// a previously stored wide one instead of replacing it.
async fn sync_wellness(
    transport: &Transport,
    athlete_id: &str,
    days: i64,
    lane: Lane,
) -> Result<(), NetError> {
    let newest = chrono::Local::now().date_naive();
    let oldest = newest - chrono::Duration::days(days);
    let days = endpoints::fetch_wellness_with_bodies(
        transport,
        athlete_id,
        &oldest.to_string(),
        &newest.to_string(),
        lane,
    )
    .await?;
    if days.is_empty() {
        return Ok(());
    }

    let rows: Vec<crate::persistence::wellness::WellnessRow> = days
        .into_iter()
        .map(|(r, body)| crate::persistence::wellness::WellnessRow {
            date: r.id,
            ctl: r.ctl,
            atl: r.atl,
            ramp_rate: r.ramp_rate,
            hrv: r.hrv,
            resting_hr: r.resting_hr,
            weight: r.weight,
            sleep_secs: r.sleep_secs.map(|s| s as i64),
            sleep_score: r.sleep_score,
            soreness: r.soreness,
            fatigue: r.fatigue,
            stress: r.stress,
            mood: r.mood,
            motivation: r.motivation,
            raw: Some(body),
        })
        .collect();

    // `with_persistent_engine` takes a blocking write lock the synchronous FFI
    // entry points also hold. Parking a runtime worker on it would stall every
    // other in-flight request, so the upsert runs on the blocking pool.
    let _ = tokio::task::spawn_blocking(move || {
        crate::persistence::with_persistent_engine(|engine| {
            if let Err(e) = engine.upsert_wellness(&rows) {
                log::warn!("[Sync] wellness upsert failed: {}", e);
            }
        });
    })
    .await;
    Ok(())
}

/// The refresh window for a user-initiated or foreground wellness sync. Only
/// the last fortnight can have changed in a way the screens show, and the
/// upsert merges it into whatever the full sync already stored.
const WELLNESS_REFRESH_DAYS: i64 = 14;

/// The targeted wellness refresh: one step, interactive lane, narrow window.
/// Shares the whole status, cancellation and auth-expiry machinery with
/// `perform_sync` so TypeScript observes it through the same snapshot.
pub(crate) async fn perform_wellness_sync(
    svc: &SyncService,
    transport: Transport,
    athlete_id: String,
    days: i64,
) {
    if svc.is_cancelled() {
        svc.finish(SyncState::Idle, None, false);
        return;
    }
    svc.begin_steps(1);

    match sync_wellness(&transport, &athlete_id, days, Lane::Interactive).await {
        Ok(()) => {
            svc.complete_step();
            svc.finish(SyncState::Idle, None, true);
        }
        Err(NetError::Unauthorized) => svc.finish(
            SyncState::AuthExpired,
            Some("unauthorized".to_string()),
            false,
        ),
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
                    // Release the running slot even if perform_sync panics
                    // (tokio catches the panic, but a skipped finish() would
                    // leave state=Syncing and try_begin() refusing every
                    // future sync for the session).
                    struct FinishGuard;
                    impl Drop for FinishGuard {
                        fn drop(&mut self) {
                            if std::thread::panicking() {
                                SYNC_SERVICE.finish(
                                    SyncState::Idle,
                                    Some("sync task panicked".to_string()),
                                    false,
                                );
                            }
                        }
                    }
                    let _guard = FinishGuard;
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

    /// Refresh just the trailing wellness window. Same contract as `sync_now`:
    /// returns instantly, false if a sync is already running or credentials are
    /// missing. This is what foreground and pull-to-refresh call, so CTL/ATL
    /// move without paying for a full profile sync.
    fn sync_wellness_now(&self, days: u32) -> Result<bool, VeloqError> {
        if !SYNC_SERVICE.try_begin() {
            return Ok(false);
        }
        match SYNC_SERVICE.build_transport() {
            Ok((transport, athlete_id)) => {
                let days = if days == 0 {
                    WELLNESS_REFRESH_DAYS
                } else {
                    days as i64
                };
                crate::runtime::spawn(async move {
                    // Same reasoning as sync_now: a skipped finish() would wedge
                    // try_begin() in Syncing for the rest of the session.
                    struct FinishGuard;
                    impl Drop for FinishGuard {
                        fn drop(&mut self) {
                            if std::thread::panicking() {
                                SYNC_SERVICE.finish(
                                    SyncState::Idle,
                                    Some("wellness sync task panicked".to_string()),
                                    false,
                                );
                            }
                        }
                    }
                    let _guard = FinishGuard;
                    perform_wellness_sync(&SYNC_SERVICE, transport, athlete_id, days).await;
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

    /// Answer every endpoint the profile slice fetches with `status`.
    fn mock_profile_slice(server: &MockServer, status: u16) {
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(status)
                .json_body(json!({"id": "i1", "name": "x"}));
        });
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/sport-settings");
            then.status(status).json_body(json!([]));
        });
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/wellness");
            then.status(status).json_body(json!([]));
        });
    }

    #[test]
    fn successful_sync_returns_to_idle_completed() {
        let server = MockServer::start();
        mock_profile_slice(&server, 200);
        let svc = SyncService::new();
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, "idle");
        assert_eq!(s.total, SYNC_STEPS);
        assert_eq!(s.completed, SYNC_STEPS);
        assert_eq!(s.in_flight, 0);
        assert!(s.last_error.is_none());
    }

    #[test]
    fn unauthorized_sync_moves_to_auth_expired() {
        let server = MockServer::start();
        mock_profile_slice(&server, 401);
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
        mock_profile_slice(&server, 500);
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
    fn one_failing_endpoint_does_not_cost_the_others() {
        // Steps are independent, so a broken sport-settings response must not
        // stop the athlete profile and wellness from landing.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/sport-settings");
            then.status(500);
        });
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/wellness");
            then.status(200).json_body(json!([]));
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
        assert_eq!(s.completed, SYNC_STEPS - 1);
        assert!(s.last_error.is_some());
    }

    #[test]
    fn targeted_wellness_sync_runs_one_step_and_asks_for_the_narrow_window() {
        let server = MockServer::start();
        let wellness = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/wellness");
            then.status(200).json_body(json!([]));
        });
        let profile = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(200).json_body(json!({"id": "i1"}));
        });

        let svc = SyncService::new();
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_wellness_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
            WELLNESS_REFRESH_DAYS,
        ));

        wellness.assert();
        // The point of the targeted command: it does not pay for the rest of
        // the profile slice.
        profile.assert_hits(0);

        let s = svc.snapshot();
        assert_eq!(s.state, "idle");
        assert_eq!(s.total, 1);
        assert_eq!(s.completed, 1);
        assert!(s.last_error.is_none());
    }

    #[test]
    fn targeted_wellness_sync_surfaces_an_expired_credential() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/wellness");
            then.status(401);
        });

        let svc = SyncService::new();
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_wellness_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
            WELLNESS_REFRESH_DAYS,
        ));

        let s = svc.snapshot();
        assert_eq!(s.state, "authExpired");
        assert_eq!(s.last_error.as_deref(), Some("unauthorized"));
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
    fn auth_header_matches_the_held_scheme() {
        let svc = SyncService::new();
        assert!(svc.auth_header().is_none());
        assert!(svc.athlete_id().is_none());

        svc.set_credentials(AuthKind::OAuth, "tok".into(), "i9".into());
        assert_eq!(svc.auth_header().as_deref(), Some("Bearer tok"));
        assert_eq!(svc.athlete_id().as_deref(), Some("i9"));

        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i9".into());
        assert_eq!(
            svc.auth_header(),
            Some(governor::format_auth_header(AuthMethod::ApiKey("secret")))
        );

        svc.clear_credentials();
        assert!(svc.auth_header().is_none());
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
        assert!(
            svc.is_cancelled(),
            "the flag survives until the next begin consumes it"
        );
        assert!(svc.try_begin());
        assert!(
            !svc.is_cancelled(),
            "a fresh begin clears the prior cancellation"
        );
    }

    #[test]
    fn auth_expired_recovers_on_next_begin() {
        // After a 401 the service rests in authExpired. Once TypeScript re-auths
        // and issues sync_now again, try_begin moves it back into syncing.
        let server = MockServer::start();
        mock_profile_slice(&server, 401);
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
