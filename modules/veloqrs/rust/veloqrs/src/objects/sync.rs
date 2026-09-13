//! The intervals.icu sync service - the single first-class FFI contract for all
//! network I/O.
//!
//! TypeScript holds no axios client and constructs no per-call auth header. It
//! sets credentials once, issues commands (`sync_now`, `cancel`), and reads a
//! status snapshot (`get_sync_status`). The service owns a `Transport`, runs work
//! on the shared `ASYNC_RUNTIME`, and never blocks the JS thread: commands return
//! instantly after posting to the runtime; results surface through status.
//!
//! Reads follow that command + status boundary. Writes cannot: whether a
//! recording was accepted, rejected or merely delayed decides what happens to
//! the file on the device, and the caller needs that answer inline. So the
//! upload verbs are async and resolve to an `FfiCallOutcome` the caller branches
//! on, while still running their I/O on the shared runtime.

use super::error::VeloqError;
use super::observer;
use super::start::FfiStartOutcome;
#[cfg(test)]
use crate::governor;
use crate::governor::{AuthMethod, Lane};
use crate::net::endpoints;
use crate::net::transport::{NetError, Transport};
use crate::net::types::{ActivityRecord, ManualActivityBody};
use crate::persistence::PersistentEngine;
use crate::persistence::attempts::{Claim, JobKey, Release, now_ms};
use crate::persistence::bodies::CurveKind;
use rusqlite::Result as SqlResult;
use std::sync::Arc;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

const INTERVALS_BASE_URL: &str = "https://intervals.icu/api/v1";

/// The lifecycle state TypeScript renders.
///
/// Crosses as an enum: the word was stringified here and spelt again in a
/// TypeScript mirror, and every reader only ever branches on it. Wire order
/// is declaration order, so append and never reorder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum SyncState {
    Idle = 1,
    Syncing = 2,
    Paused = 3,
    AuthExpired = 4,
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
    pub state: SyncState,
    pub in_flight: u32,
    pub completed: u32,
    pub total: u32,
    pub last_error: Option<String>,
    /// Which kind of failure the message describes, so the banner can render a
    /// translated line rather than the engine's own English.
    pub last_error_reason: Option<FfiSyncErrorReason>,
}

/// Why the last sync failed, as the kind the banner branches on.
///
/// The message beside it stays, because it carries the detail a bug report
/// needs, but it is never the thing an athlete reads. A locale table keyed on
/// the message would break the first time one is reworded, so the classifying
/// happens here, where the engine already knows which case it is in.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiSyncErrorReason {
    /// The credential was refused, 401.
    Unauthorized = 1,
    /// The server asked for a pause, 429, and the retries ran out.
    RateLimited = 2,
    /// The server answered, and with something the sync could not use: a
    /// non-success status, or a body that did not deserialise.
    Server = 3,
    /// The server was never reached. A dead radio, a captive portal, a timeout.
    Network = 4,
    /// A file on the device could not be read. Not a network failure.
    Storage = 5,
    /// There is nothing to sync with: no credential is stored, or the base URL
    /// will not build a transport.
    NotConfigured = 6,
    /// The sync stopped in a way it has no case for, including a panic.
    Internal = 7,
}

/// A terminal failure: the kind, and the message that describes it.
///
/// The two travel together because every site that knows one knows the other,
/// and passing them separately is how they drift apart.
#[derive(Debug, Clone)]
pub struct SyncFailure {
    pub reason: FfiSyncErrorReason,
    pub message: String,
}

impl SyncFailure {
    pub fn new(reason: FfiSyncErrorReason, message: impl Into<String>) -> Self {
        SyncFailure {
            reason,
            message: message.into(),
        }
    }

    /// The rejected credential, spelt the one way `useSyncAuthExpiry` reads.
    pub fn unauthorized() -> Self {
        SyncFailure::new(FfiSyncErrorReason::Unauthorized, "unauthorized")
    }
}

impl From<&NetError> for SyncFailure {
    fn from(e: &NetError) -> Self {
        let reason = match e {
            NetError::Unauthorized => FfiSyncErrorReason::Unauthorized,
            NetError::RateLimited => FfiSyncErrorReason::RateLimited,
            NetError::Http { .. } | NetError::Decode(_) => FfiSyncErrorReason::Server,
            NetError::Transport(_) => FfiSyncErrorReason::Network,
            NetError::Io(_) => FfiSyncErrorReason::Storage,
        };
        SyncFailure::new(reason, e.to_string())
    }
}

/// How a call ended, as the kind the caller branches on.
///
/// A closed set crossing as an enum rather than a word, so TypeScript compares
/// against a generated member and not a string it spelt itself. The wire
/// carries the variant's position, so the order here is the contract: append,
/// never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiCallKind {
    /// The server accepted the call.
    Ok = 1,
    /// The credential was refused, 401.
    Unauthorized = 2,
    /// The server asked for a pause, 429, and the retries ran out.
    RateLimited = 3,
    /// Any other status the server answered with.
    Http = 4,
    /// No response reached the server.
    Network = 5,
    /// A failure that never left the device: no credentials, an unreadable
    /// file, a body that would not serialize.
    Internal = 6,
}

/// The outcome of a write, or of a credential check.
///
/// Failures come back as data rather than as a thrown error, because the caller
/// has to branch on the status: a 403 asks for write permission, a 5xx waits for
/// the queue's next attempt, and a 400 parks the recording for the athlete to
/// look at. Getting that wrong costs someone a ride, so the classification is
/// explicit here rather than inferred from an error message downstream.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiCallOutcome {
    pub kind: FfiCallKind,
    /// The id the call produced or confirmed, when `kind` is `Ok`.
    pub id: Option<String>,
    /// The status the server answered with, when it answered at all.
    pub status: Option<u16>,
    /// The server's own message, when the body carried one.
    pub detail: Option<String>,
    /// Diagnostic text. Always present.
    pub message: String,
}

impl FfiCallOutcome {
    fn ok(id: Option<String>) -> Self {
        FfiCallOutcome {
            kind: FfiCallKind::Ok,
            id,
            status: None,
            detail: None,
            message: "ok".to_string(),
        }
    }

    /// A failure that never reached the network: no credentials, an unreadable
    /// file, a body that would not serialize.
    fn internal(message: impl Into<String>) -> Self {
        FfiCallOutcome {
            kind: FfiCallKind::Internal,
            id: None,
            status: None,
            detail: None,
            message: message.into(),
        }
    }

    fn from_error(e: &NetError) -> Self {
        let message = e.to_string();
        let (kind, status, detail) = match e {
            NetError::Unauthorized => (FfiCallKind::Unauthorized, Some(401), None),
            NetError::RateLimited => (FfiCallKind::RateLimited, Some(429), None),
            NetError::Http { status, body } => {
                (FfiCallKind::Http, Some(*status), server_detail(body))
            }
            NetError::Transport(_) => (FfiCallKind::Network, None, None),
            // A decode or file failure is local. Calling it a network error
            // would queue the item for a connectivity retry that cannot help.
            NetError::Decode(_) | NetError::Io(_) => (FfiCallKind::Internal, None, None),
        };
        FfiCallOutcome {
            kind,
            id: None,
            status,
            detail,
            message,
        }
    }
}

/// How long a body may be and still be worth showing someone. Past this it is
/// an error page rather than a message.
const MAX_DETAIL_LEN: usize = 500;

/// The user-facing part of an error body: a `message` or `error` field if the
/// body is JSON, otherwise the body itself when it is short enough to read.
fn server_detail(body: &str) -> Option<String> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        for key in ["message", "error"] {
            if let Some(found) = value.get(key) {
                return Some(match found {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                });
            }
        }
    }
    let trimmed = body.trim();
    (!trimmed.is_empty() && trimmed.len() < MAX_DETAIL_LEN).then(|| trimmed.to_string())
}

/// A manual activity entry: an activity with no file behind it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiManualActivity {
    pub activity_type: String,
    pub name: String,
    pub start_date_local: String,
    pub elapsed_time: i64,
    pub moving_time: Option<i64>,
    pub distance: Option<f64>,
    pub total_elevation_gain: Option<f64>,
    pub average_heartrate: Option<f64>,
    pub description: Option<String>,
    /// Unset counts as false, so an entry is only ever flagged deliberately.
    pub trainer: Option<bool>,
    /// Unset counts as false.
    pub commute: Option<bool>,
}

impl FfiManualActivity {
    fn into_body(self) -> ManualActivityBody {
        ManualActivityBody {
            activity_type: self.activity_type,
            name: self.name,
            start_date_local: self.start_date_local,
            elapsed_time: self.elapsed_time,
            moving_time: self.moving_time,
            distance: self.distance,
            total_elevation_gain: self.total_elevation_gain,
            average_heartrate: self.average_heartrate,
            description: self.description,
            trainer: self.trainer.unwrap_or(false),
            commute: self.commute.unwrap_or(false),
        }
    }
}

struct SyncInner {
    state: SyncState,
    in_flight: u32,
    completed: u32,
    total: u32,
    last_error: Option<String>,
    last_error_reason: Option<FfiSyncErrorReason>,
    running: bool,
    cancel: bool,
    /// A credential the profile confirmed as rejected. Set by the park and
    /// cleared only by a credential change, so the running sync's own
    /// terminal transition cannot write `Idle` over it and nothing new
    /// begins on the dead token.
    auth_expired: bool,
}

impl Default for SyncInner {
    fn default() -> Self {
        SyncInner {
            state: SyncState::Idle,
            in_flight: 0,
            completed: 0,
            total: 0,
            last_error: None,
            last_error_reason: None,
            running: false,
            cancel: false,
            auth_expired: false,
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
        {
            let mut g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
            *g = Some(Credentials {
                method,
                secret,
                athlete_id,
            });
        }
        // A credential the athlete just gave is not the one that was
        // rejected, so the park is released here and nowhere else.
        self.release_auth_park();
    }

    fn clear_credentials(&self) {
        {
            let mut g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
            *g = None;
        }
        // A sign-out leaves nothing to be rejected, and the next sign-in must
        // not find the park still standing.
        self.release_auth_park();
        // A running sync built its transport before it spawned, with the token
        // already baked in, so clearing the credential does not stop it on its
        // own. Stop the dispatch as well, or the signed-out athlete's next step
        // still goes out and still writes what it fetches.
        self.request_cancel();
    }

    /// Whether `athlete_id` is still the athlete this device is signed in as.
    ///
    /// A sync carries the athlete it was started for and re-asks between steps,
    /// so a sign-out or a second athlete signing in stops the run rather than
    /// letting it write one athlete's data into the other's database. No
    /// credential at all authorises nobody.
    fn still_signed_in(&self, athlete_id: &str) -> bool {
        let g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        g.as_ref().is_some_and(|c| c.athlete_id == athlete_id)
    }

    /// The `Authorization` header value for the held credential, if any.
    /// Only the credential tests read this: the app resolves headers through
    /// `current_transport`.
    #[cfg(test)]
    fn auth_header(&self) -> Option<String> {
        let g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        g.as_ref().map(|c| match c.method {
            AuthKind::OAuth => governor::format_auth_header(AuthMethod::Bearer(&c.secret)),
            AuthKind::ApiKey => governor::format_auth_header(AuthMethod::ApiKey(&c.secret)),
        })
    }

    /// The athlete id the held credential belongs to, if any.
    #[cfg(test)]
    fn athlete_id(&self) -> Option<String> {
        let g = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        g.as_ref().map(|c| c.athlete_id.clone())
    }

    /// Build a transport from the held credentials and base URL.
    fn build_transport(&self) -> Result<(Transport, String), SyncFailure> {
        let creds_guard = self.creds.lock().unwrap_or_else(|e| e.into_inner());
        let creds = creds_guard.as_ref().ok_or_else(|| {
            SyncFailure::new(FfiSyncErrorReason::NotConfigured, "no credentials set")
        })?;
        let base = self
            .base_url
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let auth = match creds.method {
            AuthKind::OAuth => AuthMethod::Bearer(&creds.secret),
            AuthKind::ApiKey => AuthMethod::ApiKey(&creds.secret),
        };
        let transport = Transport::new(base, auth)
            .map_err(|e| SyncFailure::new(FfiSyncErrorReason::NotConfigured, e))?;
        Ok((transport, creds.athlete_id.clone()))
    }

    /// Atomically claim the running slot and move to `Syncing`. Returns false if a
    /// sync is already in flight (so commands are idempotent under rapid taps).
    fn try_begin(&self) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.running || inner.auth_expired {
            return false;
        }
        inner.running = true;
        inner.cancel = false;
        inner.state = SyncState::Syncing;
        inner.total = 1;
        inner.in_flight = 1;
        inner.completed = 0;
        inner.last_error = None;
        inner.last_error_reason = None;
        true
    }

    /// Claim the slot and build the transport, naming why when either refuses.
    ///
    /// The two refusals are opposite situations, a slot held for a moment and a
    /// credential that is not there, and the caller's only sane reaction to
    /// them differs. Deciding it here keeps both starts honest and keeps the
    /// verdict out of the FFI methods, which cannot be tested without the
    /// global service.
    fn try_start(&self) -> Result<(Transport, String), FfiStartOutcome> {
        if !self.try_begin() {
            return Err(FfiStartOutcome::Busy);
        }
        match self.build_transport() {
            Ok(pair) => Ok(pair),
            Err(e) => {
                self.finish(SyncState::Idle, Some(e), false);
                Err(FfiStartOutcome::NotConfigured)
            }
        }
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
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.completed = (inner.completed + 1).min(inner.total);
        }
        observer::notify(|o| o.sync_progress());
    }

    /// Terminal transition for a finished job. The one place a job ends, so it
    /// is the one place the settle is announced.
    pub fn finish(&self, state: SyncState, failure: Option<SyncFailure>, success: bool) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            // A park outlives whatever was running when it landed. Without
            // this the interrupted run's own tail wrote `Idle` over it and
            // the athlete was never told the session was gone.
            if inner.auth_expired && state != SyncState::AuthExpired {
                inner.running = false;
                inner.in_flight = 0;
                drop(inner);
                observer::notify(|o| o.sync_settled());
                return;
            }
            inner.state = state;
            inner.running = false;
            inner.in_flight = 0;
            if success {
                inner.completed = inner.total;
            }
            inner.last_error_reason = failure.as_ref().map(|f| f.reason);
            inner.last_error = failure.map(|f| f.message);
        }
        observer::notify(|o| o.sync_settled());
    }

    /// Park the service on a credential the profile confirmed as rejected.
    ///
    /// The running slot is released, since nothing more will succeed on this
    /// token, but the latch is what keeps the state: a sync that was already
    /// mid-step reaches its own `finish` afterwards, and that call used to
    /// overwrite `AuthExpired` with `Idle`.
    pub fn park_auth_expired_now(&self) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.auth_expired = true;
        }
        self.finish(
            SyncState::AuthExpired,
            Some(SyncFailure::unauthorized()),
            false,
        );
    }

    /// Release the park. Only a credential change does this.
    fn release_auth_park(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.auth_expired = false;
        if inner.state == SyncState::AuthExpired {
            inner.state = SyncState::Idle;
        }
    }

    /// Soft cancel: flag the loop so it stops dispatching new work. An in-flight
    /// request is allowed to finish.
    pub(crate) fn request_cancel(&self) {
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

    pub fn snapshot(&self) -> FfiSyncStatus {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        FfiSyncStatus {
            state: inner.state,
            in_flight: inner.in_flight,
            completed: inner.completed,
            total: inner.total,
            last_error: inner.last_error.clone(),
            last_error_reason: inner.last_error_reason,
        }
    }
}

/// The process-wide sync service.
pub static SYNC_SERVICE: LazyLock<SyncService> = LazyLock::new(SyncService::new);

/// Ask the credential again, on an endpoint a live one always answers.
///
/// One 401 is not evidence. intervals.icu answers 403 for the wrong resource
/// and 401 only for a credential it will not accept, so a second 401 from the
/// profile is the server saying so twice. Anything else, a 200, a 5xx, a
/// timeout or a connection that never opened, says nothing about the
/// credential and so confirms nothing.
///
/// The request goes straight to the transport rather than through a step, so
/// its own 401 cannot re-enter [`park_auth_expired`] and recurse.
async fn credential_is_rejected(transport: &Transport, athlete_id: &str) -> bool {
    matches!(
        endpoints::fetch_athlete_body(transport, athlete_id, Lane::Interactive).await,
        Err(NetError::Unauthorized)
    )
}

/// Park the service on a rejected credential, once the rejection is confirmed.
///
/// Every 401 the app sees ends here, whatever raised it: a sync step, an
/// on-demand fetch, a write, or the elevation backfill. A **confirmed**
/// rejection signs the athlete out and keeps the database, and this state is
/// what `useSyncAuthExpiry` reads to do it, so a caller that reports its own
/// failure instead leaves the dead session standing.
///
/// An unconfirmed 401 leaves the state alone and the caller reports its own
/// error, so a single refusal never signs anybody out.
pub async fn park_auth_expired(transport: &Transport, athlete_id: &str) {
    if credential_is_rejected(transport, athlete_id).await {
        SYNC_SERVICE.park_auth_expired_now();
    } else {
        log::info!("[Sync] a 401 was not confirmed by the profile, the session stands");
    }
}

/// Releases the running slot when a sync task unwinds.
///
/// Tokio catches the panic, so without this the skipped `finish()` leaves
/// state=Syncing and `try_begin()` refuses every later sync for the session.
pub(crate) struct FinishGuard;

impl Drop for FinishGuard {
    fn drop(&mut self) {
        if std::thread::panicking() {
            SYNC_SERVICE.finish(
                SyncState::Idle,
                Some(SyncFailure::new(
                    FfiSyncErrorReason::Internal,
                    "sync task panicked",
                )),
                false,
            );
        }
    }
}

/// How many on-demand bodies have landed in SQLite this session.
///
/// The observer is what wakes a waiting reader. This is the reconciliation
/// behind it: a body stored between engine init and the observer registering
/// announces to nobody, and the count is the only record that it landed.
static BODIES_STORED: AtomicU64 = AtomicU64::new(0);

/// The count a cold start reads to catch a body stored before it was listening.
pub fn bodies_stored() -> u64 {
    BODIES_STORED.load(Ordering::Relaxed)
}

/// How many fetched bodies had nowhere to land this session.
///
/// The engine answers `None` when it is not there: destroyed, or not yet
/// initialised. That is not a write that failed, it is bytes that came off the
/// network and were dropped, and counting it with the failures would hide it.
static BODIES_DISCARDED: AtomicU64 = AtomicU64::new(0);

/// The count of fetched bodies dropped for want of an engine to write them to.
/// The running total rides on the warning `discarded` writes, so nothing in
/// the crate reads it back except the tests that prove it moves.
#[cfg(test)]
pub(crate) fn bodies_discarded() -> u64 {
    BODIES_DISCARDED.load(Ordering::Relaxed)
}

/// Write one on-demand body, then announce it once it is actually in SQLite.
///
/// Only a successful write announces. A failed store leaves nothing for a
/// reader to find, so waking it would cost an FFI read for a body that is
/// still absent. `activity_id` is empty for a body keyed by something else,
/// such as a curve keyed by sport and window.
///
/// The observer is called after the engine lock is released, since the binding
/// blocks this thread until JavaScript returns.
/// The id a URL upstream needs for a stored activity.
///
/// The key is ours; `intervals_id` is the server's. They are equal for every
/// row an older build stored, and a caller can name an activity no row claims,
/// so an unknown one falls back to the key it was given.
pub(crate) async fn upstream_id(activity_id: &str) -> String {
    let key = activity_id.to_string();
    crate::persistence::with_persistent_engine_blocking(move |engine| engine.intervals_id(&key))
        .await
        .flatten()
        .unwrap_or_else(|| activity_id.to_string())
}

async fn store_body<F>(kind: &'static str, activity_id: String, write: F)
where
    F: FnOnce(&mut PersistentEngine) -> SqlResult<()> + Send + 'static,
{
    let stored =
        crate::persistence::with_persistent_engine_blocking(move |engine| match write(engine) {
            Ok(()) => true,
            Err(e) => {
                log::warn!("[Sync] {} store failed: {}", kind, e);
                false
            }
        })
        .await;
    if landed(stored) {
        BODIES_STORED.fetch_add(1, Ordering::Relaxed);
        observer::notify(|o| o.body_stored(kind.to_string(), activity_id));
    } else if stored.is_none() {
        // A write that failed already logged its SQL error. This is the other
        // half: no engine answered, so nothing was even attempted.
        discarded(kind, &activity_id);
    }
}

/// Store one activity's `time` stream, then tell whoever is waiting for it.
///
/// The announcement is made after the engine lock is released, and only when
/// the write landed: a cold start has nowhere to put the stream, and a screen
/// told it had arrived would read a gap that is still there.
pub(crate) async fn store_time_stream(activity_id: String, times: Vec<u32>) {
    let id = activity_id.clone();
    let stored = crate::persistence::with_persistent_engine_blocking(move |engine| {
        engine.set_time_streams_flat(&[id], &times, &[0]);
    })
    .await;
    if stored.is_some() {
        observer::notify(|o| o.time_streams_stored(vec![activity_id]));
    } else {
        discarded("time_stream", &activity_id);
    }
}

/// Whether a store attempt put a body where a reader can find it. `None` is a
/// cold start with nowhere to write, `Some(false)` is a write that failed.
fn landed(stored: Option<bool>) -> bool {
    stored == Some(true)
}

/// Record a fetched body that had no engine to be written to.
///
/// The engine answers `None` when it is gone or not yet up, and the caller
/// cannot tell that from a write nobody asked for. Both the count and the line
/// exist so the loss is visible: the request was made, the bytes came back and
/// they were dropped.
pub(crate) fn discarded(kind: &str, activity_id: &str) {
    let total = BODIES_DISCARDED.fetch_add(1, Ordering::Relaxed) + 1;
    log::warn!(
        "[Sync] {kind} discarded, no engine to store it in: {activity_id} ({total} this session)"
    );
}

/// Run an on-demand fetch unless one with the same key is already running.
///
/// The key is a lease on the attempt store rather than a process-local set.
/// A set a restart empties cannot tell a fetch that was in flight when the app
/// died from a key nobody ever asked for, so a job that died holding one used
/// to be invisibly free and a key that kept failing was re-admitted the
/// instant it landed. Both are now the store's answer: the lease is a
/// generation the engine mints at init, and a failure backs the key off.
///
/// The refusals are four opposite answers rather than one `false`. No
/// credential never becomes one by asking again. A key already in flight stops
/// being held the moment that job lands. A key backing off lands on its own
/// schedule. And a start before the engine opens is early, not refused.
pub(crate) fn spawn_once<F, Fut>(key: JobKey, job: F) -> FfiStartOutcome
where
    F: FnOnce(Transport, String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<(), NetError>> + Send,
{
    spawn_once_at(key, now_ms, job)
}

/// The start itself, with the clock handed in.
///
/// Split out the way `drain_queue_with` and `re_ask_with` are: the backoff is
/// a pure function of the attempt count, and a test that has to spend the
/// ladder to read it asserts on wall clock, which this suite has failed on
/// twice under load. The clock is read twice, once for the claim and once for
/// the release, because the release genuinely happens later.
fn spawn_once_at<F, Fut, C>(key: JobKey, clock: C, job: F) -> FfiStartOutcome
where
    F: FnOnce(Transport, String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<(), NetError>> + Send,
    C: Fn() -> i64 + Send + 'static,
{
    let now = clock();
    let Ok((transport, athlete_id)) = SYNC_SERVICE.build_transport() else {
        return FfiStartOutcome::NotConfigured;
    };
    let claim = crate::persistence::with_persistent_engine(|engine| engine.claim_job(&key, now));
    match claim {
        // The lease lives in the engine, so a start before it opens is early
        // rather than refused for a reason that will never lift.
        None => return FfiStartOutcome::NotReady,
        Some(Err(e)) => {
            log::warn!("[Sync] could not claim {}: {}", key.as_str(), e);
            return FfiStartOutcome::NotReady;
        }
        Some(Ok(Claim::InFlight)) => return FfiStartOutcome::Busy,
        // Not `Busy`: nothing else holds the key, the last attempt failed and
        // this one would too. `Held` is the taxonomy's answer for work a stage
        // that does finish is keeping back, and it is retryable.
        Some(Ok(Claim::BackingOff { until })) => {
            log::info!("[Sync] {} is backing off until {}", key.as_str(), until);
            return FfiStartOutcome::Held;
        }
        Some(Ok(Claim::Taken)) => {}
    }

    crate::runtime::spawn(async move {
        // Release the key even if the job panics, or that resource could
        // never be requested again for the rest of the session. A panic is a
        // failed attempt and backs off, which is why the guard starts on
        // `Failed` and the success path has to say otherwise.
        struct ReleaseGuard<C: Fn() -> i64> {
            key: JobKey,
            release: Release,
            clock: C,
        }
        impl<C: Fn() -> i64> Drop for ReleaseGuard<C> {
            fn drop(&mut self) {
                let release = std::mem::replace(&mut self.release, Release::Done);
                let at = (self.clock)();
                crate::persistence::with_persistent_engine(|engine| {
                    if let Err(e) = engine.release_job(&self.key, release, at) {
                        log::warn!("[Sync] could not release {}: {}", self.key.as_str(), e);
                    }
                });
            }
        }
        let mut guard = ReleaseGuard {
            key,
            release: Release::failed(FfiStartOutcome::Failed, Some("the job did not return")),
            clock,
        };

        // Kept back for the confirmation: the job consumes both, and the
        // confirmation has to ask on the same credential that was refused.
        let (confirm_on, confirm_for) = (transport.clone(), athlete_id.clone());
        // The transport was built before the spawn, so it still carries a token
        // the athlete may have signed out of by the time the job is polled.
        if !SYNC_SERVICE.still_signed_in(&confirm_for) {
            log::info!("[Sync] dropping an on-demand fetch for an athlete who has signed out");
            // Nothing was asked for, so nothing failed. A backoff here would
            // hold the key against the athlete who signs in next.
            guard.release = Release::Done;
            return;
        }
        guard.release = match job(transport, athlete_id).await {
            Ok(()) => Release::Done,
            Err(NetError::Unauthorized) => {
                park_auth_expired(&confirm_on, &confirm_for).await;
                Release::failed(FfiStartOutcome::NotConfigured, Some("unauthorized"))
            }
            Err(e) => {
                log::warn!("[Sync] on-demand fetch failed: {}", e);
                Release::failed(FfiStartOutcome::Failed, Some(&e.to_string()))
            }
        };
    });
    FfiStartOutcome::Started
}

/// A transport built from the process-wide credential, so every outbound
/// request in the app shares one client, pool, governor and retry policy.
/// `None` before TypeScript has called `set_credentials`.
/// Stand a credential up for a test, so a code path that declines without one
/// can be reached. Returns a guard that clears it again on drop: the service
/// is process-wide, and a credential left behind would change what every test
/// after it sees.
#[cfg(test)]
pub(crate) fn test_credentials() -> TestCredentials {
    SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "test-secret".to_string(), "1".to_string());
    TestCredentials
}

#[cfg(test)]
pub(crate) struct TestCredentials;

#[cfg(test)]
impl Drop for TestCredentials {
    fn drop(&mut self) {
        SYNC_SERVICE.clear_credentials();
    }
}

/// Set the process-wide credential from a native handler, which reached Rust
/// without JavaScript and so without `SyncManager`.
///
/// Its own function rather than the `SyncManager` method because that method is
/// part of the UniFFI surface and a JNI caller has no object to call it on. The
/// method name is the same on purpose: one credential slot, two doors.
pub fn set_credentials_from_native(
    method: &str,
    secret: &str,
    athlete_id: &str,
) -> Result<(), String> {
    let kind = AuthKind::parse(method).ok_or_else(|| format!("unknown auth method: {method}"))?;
    SYNC_SERVICE.set_credentials(kind, secret.to_string(), athlete_id.to_string());
    Ok(())
}

pub fn current_transport() -> Option<Result<Transport, String>> {
    current_session().map(|r| r.map(|(t, _athlete)| t))
}

/// The transport and the athlete it belongs to, for a caller that has to ask
/// on the athlete's own resources. `None` before TypeScript has called
/// `set_credentials`.
pub fn current_session() -> Option<Result<(Transport, String), String>> {
    let creds_present = SYNC_SERVICE
        .creds
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some();
    if !creds_present {
        return None;
    }
    Some(SYNC_SERVICE.build_transport().map_err(|e| e.message))
}

/// Drive a request on the shared runtime and await its outcome.
///
/// The work is spawned rather than awaited in place for two reasons: this future
/// is polled by the foreign executor, which is not a tokio context, and the JS
/// thread has to stay free while a large FIT goes up.
async fn run_on_runtime<Fut>(job: Fut) -> FfiCallOutcome
where
    Fut: std::future::Future<Output = Result<Option<String>, NetError>> + Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    crate::runtime::spawn(async move {
        let _ = tx.send(job.await);
    });
    match rx.await {
        Ok(Ok(id)) => FfiCallOutcome::ok(id),
        Ok(Err(e)) => FfiCallOutcome::from_error(&e),
        // The task died without answering. Report it as local rather than as a
        // network failure: nothing is known about whether the write landed.
        Err(_) => FfiCallOutcome::internal("the request ended without reporting"),
    }
}

/// Run a write against the held credential.
async fn run_write<F, Fut>(job: F) -> FfiCallOutcome
where
    F: FnOnce(Transport, String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<Option<String>, NetError>> + Send + 'static,
{
    let (transport, athlete_id) = match SYNC_SERVICE.build_transport() {
        Ok(pair) => pair,
        Err(e) => return FfiCallOutcome::internal(e.message),
    };
    // Kept back for the confirmation, for the same reason as `spawn_once`.
    let (confirm_on, confirm_for) = (transport.clone(), athlete_id.clone());
    // A write refused for a dead credential parks the service, so an upload
    // reaches the same session-expiry path a failed sync already does. The
    // confirmation goes inside the spawn with the job: awaited out here it
    // would reach the transport from the foreign executor, which is not a
    // tokio context, and panic rather than park.
    run_on_runtime(async move {
        let result = job(transport, athlete_id).await;
        if matches!(result, Err(NetError::Unauthorized)) {
            park_auth_expired(&confirm_on, &confirm_for).await;
        }
        result
    })
    .await
}

/// How many days of wellness one sync pulls. Matches the widest range the
/// fitness screens offer, so a range change never needs a fresh request.
const WELLNESS_DAYS: i64 = 365;

/// How many days of activities one sync pulls. Matches the default range the
/// settings slider starts at, so the number the app says it holds is the
/// number it downloaded. The slider widens it beyond this through
/// `sync_activities_window`; that expansion is still TypeScript's job.
const ACTIVITY_DAYS: i64 = 90;

/// The curve windows every screen asks for. The five fitness periods
/// (`src/shared/app/period.ts`), the two hook defaults, 42 for a pace curve
/// and 365 for a power one, and 3650 for Best Efforts All-time. A curve is
/// cached verbatim under `(kind, sport, days, gap)`, so a window nobody
/// fetched while online is a blank chart offline.
const CURVE_DAYS: &[i64] = &[7, 30, 42, 90, 180, 365, 3650];

/// The steps `perform_sync` runs, for the progress counters TypeScript polls.
const SYNC_STEPS: u32 = 6;

/// The sync job: fetch the profile slice and write it into SQLite. Every step
/// is independent, so one failing endpoint does not cost the others their data.
/// A 401 is terminal, because no later step can succeed with a dead credential.
///
/// Free function over `&SyncService` so tests can drive it with a mock-server
/// transport against a local service instance.
pub(crate) async fn perform_sync(svc: &SyncService, transport: Transport, athlete_id: String) {
    if svc.is_cancelled() || !svc.still_signed_in(&athlete_id) {
        svc.finish(SyncState::Idle, None, false);
        return;
    }
    svc.begin_steps(SYNC_STEPS);

    let mut last_error: Option<SyncFailure> = None;

    macro_rules! step {
        ($body:expr) => {
            if svc.is_cancelled() || !svc.still_signed_in(&athlete_id) {
                svc.finish(SyncState::Idle, last_error, false);
                return;
            }
            match $body {
                Ok(()) => svc.complete_step(),
                // The loop parks itself rather than calling
                // `park_auth_expired`: it holds its own service, which under
                // test is not the process-wide one, and it owes a terminal
                // finish either way.
                Err(NetError::Unauthorized) => {
                    if credential_is_rejected(&transport, &athlete_id).await {
                        svc.finish(
                            SyncState::AuthExpired,
                            Some(SyncFailure::unauthorized()),
                            false,
                        );
                    } else {
                        svc.finish(
                            SyncState::Idle,
                            Some(SyncFailure::from(&NetError::Unauthorized)),
                            false,
                        );
                    }
                    return;
                }
                // A failed step is not a completed one, so the counter stays
                // an honest count of what actually landed in SQLite.
                Err(e) => last_error = Some(SyncFailure::from(&e)),
            }
        };
    }

    step!(sync_athlete(&transport, &athlete_id).await);
    step!(sync_sport_settings(&transport, &athlete_id).await);
    step!(sync_wellness(&transport, &athlete_id).await);
    step!(sync_activities(&transport, &athlete_id, &|| svc.is_cancelled()).await);
    step!(sync_activity_history_summary(&transport, &athlete_id).await);
    step!(sync_curves(&transport, &athlete_id, &|| svc.is_cancelled()).await);

    let success = last_error.is_none();
    svc.finish(SyncState::Idle, last_error, success);
}

/// The window job: fetch and store one date window of activities.
///
/// Free function over `&SyncService` for the same reason `perform_sync` is one,
/// so a test can drive the whole job against a local service instead of the
/// process-wide one.
pub(crate) async fn perform_window_sync(
    svc: &SyncService,
    transport: Transport,
    athlete_id: String,
    oldest: &str,
    newest: &str,
) {
    if svc.is_cancelled() || !svc.still_signed_in(&athlete_id) {
        svc.finish(SyncState::Idle, None, false);
        return;
    }
    svc.begin_steps(1);
    let cancelled = || svc.is_cancelled();
    match sync_activity_window(&transport, &athlete_id, oldest, newest, &cancelled).await {
        Ok(WindowOutcome::Stored) => {
            svc.complete_step();
            svc.finish(SyncState::Idle, None, true);
        }
        // Nothing was written, so the step did not complete and the job did
        // not succeed. Reporting it as one is what let the status say the
        // window landed while the state machine said cancelled.
        Ok(WindowOutcome::Abandoned) => svc.finish(SyncState::Idle, None, false),
        Err(NetError::Unauthorized) => {
            if credential_is_rejected(&transport, &athlete_id).await {
                svc.finish(
                    SyncState::AuthExpired,
                    Some(SyncFailure::unauthorized()),
                    false,
                );
            } else {
                svc.finish(
                    SyncState::Idle,
                    Some(SyncFailure::from(&NetError::Unauthorized)),
                    false,
                );
            }
        }
        Err(e) => svc.finish(SyncState::Idle, Some(SyncFailure::from(&e)), false),
    }
}

/// Persist the athlete profile body.
async fn sync_athlete(transport: &Transport, athlete_id: &str) -> Result<(), NetError> {
    let body = endpoints::fetch_athlete_body(transport, athlete_id, Lane::Interactive).await?;
    crate::persistence::with_persistent_engine_blocking(move |engine| {
        engine.set_athlete_profile(&body)
    })
    .await;
    Ok(())
}

/// Persist the sport settings body.
async fn sync_sport_settings(transport: &Transport, athlete_id: &str) -> Result<(), NetError> {
    let body =
        endpoints::fetch_sport_settings_body(transport, athlete_id, Lane::Interactive).await?;
    crate::persistence::with_persistent_engine_blocking(move |engine| {
        engine.set_sport_settings(&body)
    })
    .await;
    Ok(())
}

/// `start_date_local` as epoch seconds. intervals.icu sends local wall-clock
/// with no zone, which is how the rest of the app already treats it.
fn start_date_to_timestamp(start_date_local: Option<&str>) -> Option<i64> {
    let raw = start_date_local?;
    let trimmed = raw.split('.').next().unwrap_or(raw);
    chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S")
        .ok()
        .map(|dt| dt.and_utc().timestamp())
}

/// Persist the activity list: aggregate metrics for Rust, plus the untyped
/// body per activity for the screens. No GPS required, so activities that
/// never reach the `activities` table still show up in the feed.
async fn sync_activities(
    transport: &Transport,
    athlete_id: &str,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<(), NetError> {
    let newest = chrono::Local::now().date_naive();
    let oldest = newest - chrono::Duration::days(ACTIVITY_DAYS);
    // The outcome is dropped because the loop's own gate owns the terminal
    // state: an abandoned window is followed by a step check that finishes
    // the job unsuccessfully, so reporting it twice would say nothing new.
    let outcome = sync_activity_window(
        transport,
        athlete_id,
        &oldest.to_string(),
        &newest.to_string(),
        cancelled,
    )
    .await?;
    // After the window, so a page whose metrics write failed a moment ago is
    // repaired by the same sync rather than by the next one. Nothing was
    // written for an abandoned window, so there is nothing new to repair.
    if outcome == WindowOutcome::Stored {
        repair_missing_activity_metrics().await;
    }
    Ok(())
}

/// One activity's metrics row from the record the page carried. The stats
/// fields ride the same response, so the row is complete when it is written
/// and nothing has to read the body back to fill it in.
fn activity_metrics_row(record: ActivityRecord, date: i64) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: record.id,
        name: record.name.unwrap_or_default(),
        date,
        distance: record.distance.unwrap_or(0.0),
        moving_time: record.moving_time.unwrap_or(0).max(0) as u32,
        elapsed_time: record.elapsed_time.unwrap_or(0).max(0) as u32,
        elevation_gain: record.total_elevation_gain.unwrap_or(0.0),
        avg_hr: record.average_heartrate.map(|v| v.round() as u16),
        avg_power: record
            .icu_average_watts
            .or(record.average_watts)
            .map(|v| v.round() as u16),
        sport_type: record.activity_type.unwrap_or_else(|| "Ride".to_string()),
        training_load: record.icu_training_load,
        ftp: record.icu_ftp.map(|v| v.round().max(0.0) as u16),
        power_zone_times: record.icu_zone_times.map(|zones| {
            zones
                .iter()
                .map(|z| z.secs.unwrap_or(0).max(0) as u32)
                .collect()
        }),
        hr_zone_times: record
            .icu_hr_zone_times
            .map(|zones| zones.iter().map(|&s| s.max(0) as u32).collect()),
    }
}

/// What a window sync did with the page it asked for. A job that was cancelled
/// wrote nothing, so its caller owes a terminal state that does not read as a
/// success.
#[derive(Debug, PartialEq, Eq)]
enum WindowOutcome {
    Stored,
    Abandoned,
}

/// Persist one date window of activities. The default sync covers 90 days; the
/// feed asks for older windows as the reader scrolls past it.
async fn sync_activity_window(
    transport: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<WindowOutcome, NetError> {
    if cancelled() {
        return Ok(WindowOutcome::Abandoned);
    }
    let items = endpoints::fetch_activities_with_bodies(
        transport,
        athlete_id,
        oldest,
        newest,
        true,
        Lane::Backfill,
    )
    .await?;
    if items.is_empty() {
        return Ok(WindowOutcome::Stored);
    }
    // The cancel is soft, so the page in flight was allowed to finish, but
    // writing it is not part of that bargain: the state machine moved to
    // Paused when the athlete stopped the sync, and rows landing after that
    // is what makes the UI lie.
    if cancelled() {
        return Ok(WindowOutcome::Abandoned);
    }

    // The server names the activity by its own id; the row it belongs to is
    // keyed by ours. They are equal for every row an older build stored, so
    // an id nothing claims stays the key it arrived as. Matching on the
    // column instead is what stops an activity the device minted and later
    // uploaded from being stored a second time.
    let named: Vec<String> = items.iter().map(|(record, _)| record.id.clone()).collect();
    let local = crate::persistence::with_persistent_engine_blocking(move |engine| {
        engine.local_ids_for_intervals_ids(&named)
    })
    .await
    .unwrap_or_default();

    let mut bodies = Vec::with_capacity(items.len());
    let mut metrics = Vec::with_capacity(items.len());
    for (mut record, body) in items {
        let Some(date) = start_date_to_timestamp(record.start_date_local.as_deref()) else {
            // Without a start time the row cannot be windowed or ordered, and
            // a fabricated one would sort into the wrong week.
            continue;
        };
        if let Some(key) = local.get(&record.id) {
            record.id = key.clone();
        }
        bodies.push((record.id.clone(), date, body));
        metrics.push(activity_metrics_row(record, date));
    }

    crate::persistence::with_persistent_engine_blocking(move |engine| {
        if let Err(e) = engine.upsert_activity_bodies(&bodies) {
            log::warn!("[Sync] activity body upsert failed: {}", e);
        }
        if let Err(e) = engine.set_activity_metrics(metrics) {
            metrics_write_failed(&e);
        }
    })
    .await;
    Ok(WindowOutcome::Stored)
}

/// How many page metrics writes have failed this session.
///
/// The page write warns and carries on rather than failing, so before this
/// counter nothing said whether the loss ever happens in the field. The
/// running total rides on the warning, which is the only reader outside the
/// test that proves it moves.
static METRICS_WRITES_FAILED: AtomicU64 = AtomicU64::new(0);

/// The count of page metrics writes that failed this session.
#[cfg(test)]
pub(crate) fn metrics_writes_failed() -> u64 {
    METRICS_WRITES_FAILED.load(Ordering::Relaxed)
}

/// Record a page whose metrics write failed while its bodies landed.
fn metrics_write_failed(e: &rusqlite::Error) {
    let total = METRICS_WRITES_FAILED.fetch_add(1, Ordering::Relaxed) + 1;
    log::warn!("[Sync] activity metrics upsert failed ({total} this session): {e}");
}

/// Fill the metrics rows of activities that hold a body and nothing else, and
/// answer how many were written.
///
/// `sync_activity_window` writes both tables in one closure and warns rather
/// than failing when the metrics half does not land, so an activity can keep
/// its body and lose its row. It is then absent from every aggregate reading
/// `activity_metrics`, which is the whole Health tab, until a later window
/// happens to carry it again. The body is the payload the row was built from,
/// so the repair needs no network.
///
/// Once per sync, not once per page: the ordinary answer is an empty list, and
/// the TypeScript pass this replaces read every stored id back over the FFI on
/// every `activities` announcement and filtered a whole-library parsed array
/// against it.
async fn repair_missing_activity_metrics() -> usize {
    let orphans = crate::persistence::with_persistent_engine_blocking(|engine| {
        engine.activity_bodies_without_metrics()
    })
    .await
    .and_then(|r| r.ok())
    .unwrap_or_default();
    if orphans.is_empty() {
        return 0;
    }

    let mut metrics = Vec::with_capacity(orphans.len());
    for (activity_id, date, raw) in orphans {
        // One unreadable payload is not the sweep's problem: failing here
        // would leave every other activity out of the Health tab.
        let Ok(mut record) = serde_json::from_str::<ActivityRecord>(&raw) else {
            log::warn!("[Sync] metrics repair could not read the body for {activity_id}");
            continue;
        };
        // The body is keyed by the local id, and the payload carries the
        // intervals one. They differ for an activity the device minted and
        // later uploaded, and the row belongs to the key.
        record.id = activity_id;
        metrics.push(activity_metrics_row(record, date));
    }
    if metrics.is_empty() {
        return 0;
    }

    let filled = metrics.len();
    let stored = crate::persistence::with_persistent_engine_blocking(move |engine| {
        engine.set_activity_metrics(metrics)
    })
    .await;
    match stored {
        Some(Ok(())) => {
            // No announcement of its own: the repair runs inside the activity
            // step, and `sync_settled` at the end of the job is what wakes the
            // screens that read `activity_metrics`.
            log::info!("[Sync] metrics repair filled {filled} activities");
            filled
        }
        Some(Err(e)) => {
            metrics_write_failed(&e);
            0
        }
        None => 0,
    }
}

/// Midnight for a YYYY-MM-DD day, as epoch seconds.
fn day_start_timestamp(day: &str) -> Option<i64> {
    start_date_to_timestamp(Some(&format!("{}T00:00:00", day)))
}

/// Settings key holding the athlete's first-ever activity date.
pub const OLDEST_ACTIVITY_DATE_KEY: &str = "oldest_activity_date";

/// Settings key holding the per-year activity counts, as a `{"YYYY": n}` JSON
/// object. The history slider gates a large widening on it.
pub const ACTIVITY_YEAR_COUNTS_KEY: &str = "activity_year_counts";

/// Fetch every power and pace curve the screens can ask for.
///
/// The curve is the one body no other step pulls: `usePowerCurve` and
/// `usePaceCurve` fetch a window the first time it is opened, so a range the
/// athlete never visited online reads as "No power data" offline rather than
/// as a range nobody downloaded. Best Efforts All-time is the clearest case,
/// because 3650 is a window nothing else ever asks for.
///
/// Backfill lane, so the whole sweep steps aside for a tapped screen. Roughly
/// forty small bodies at three sports, replacing what is stored: the hooks
/// hold their query for ever and leave freshness to a sync, so this is the
/// thing that refreshes them.
async fn sync_curves(
    transport: &Transport,
    athlete_id: &str,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<(), NetError> {
    let sports = crate::persistence::with_persistent_engine_blocking(|engine| {
        engine.get_available_sport_types()
    })
    .await
    .unwrap_or_default();
    if sports.is_empty() {
        return Ok(());
    }

    let mut last_error: Option<NetError> = None;

    for sport in &sports {
        for &days in CURVE_DAYS {
            if cancelled() {
                return Ok(());
            }
            let window = format!("{}d", days);

            match endpoints::fetch_power_curve_body(
                transport,
                athlete_id,
                sport,
                &window,
                Lane::Backfill,
            )
            .await
            {
                Ok(body) => {
                    let sport = sport.clone();
                    store_body("power_curve", String::new(), move |engine| {
                        engine.set_curve_body(CurveKind::Power, &sport, days, false, &body)
                    })
                    .await;
                }
                Err(NetError::Unauthorized) => return Err(NetError::Unauthorized),
                Err(e) => last_error = Some(e),
            }

            // Gradient-adjusted pace is a row of its own, and only running has
            // one, so a switch flipped offline would otherwise replace a
            // working chart with an empty one.
            let gaps: &[bool] = if sport == "Run" {
                &[false, true]
            } else {
                &[false]
            };
            for &gap in gaps {
                if cancelled() {
                    return Ok(());
                }
                match endpoints::fetch_pace_curve_body(
                    transport,
                    athlete_id,
                    sport,
                    &window,
                    gap,
                    Lane::Backfill,
                )
                .await
                {
                    Ok(body) => {
                        let sport = sport.clone();
                        store_body("pace_curve", String::new(), move |engine| {
                            engine.set_curve_body(CurveKind::Pace, &sport, days, gap, &body)
                        })
                        .await;
                    }
                    Err(NetError::Unauthorized) => return Err(NetError::Unauthorized),
                    Err(e) => last_error = Some(e),
                }
            }
        }
    }

    match last_error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Persist the athlete's history summary. It spans all history, not the synced
/// window, so the timeline slider knows how far back it may reach and how much
/// a widening would download. One request answers both.
async fn sync_activity_history_summary(
    transport: &Transport,
    athlete_id: &str,
) -> Result<(), NetError> {
    let today = chrono::Local::now().date_naive().to_string();
    let summary =
        endpoints::fetch_activity_history_summary(transport, athlete_id, &today, Lane::Backfill)
            .await?;

    // The same pull that answers the timeline slider is the census. A request
    // that errored never reaches here, and an empty list is indistinguishable
    // from an athlete who deleted everything, so the reconcile refuses one.
    let census = summary.ids.clone();
    if !census.is_empty() {
        crate::persistence::with_persistent_engine_blocking(move |engine| {
            let removed = engine.reconcile_against_census(&census);
            if !removed.is_empty() {
                log::info!(
                    "[Sync] {} activities left intervals.icu and were removed",
                    removed.len()
                );
            }
        })
        .await;
    }

    let Some(oldest) = summary.oldest else {
        // No activities at all: nothing to record, and writing an empty
        // counts object would read as a real answer of zero everywhere.
        return Ok(());
    };
    let counts = match serde_json::to_string(&summary.counts_by_year) {
        Ok(json) => json,
        Err(e) => {
            log::warn!("[Sync] year counts encode failed: {}", e);
            String::new()
        }
    };
    crate::persistence::with_persistent_engine_blocking(move |engine| {
        if let Err(e) = engine.set_setting(OLDEST_ACTIVITY_DATE_KEY, &oldest) {
            log::warn!("[Sync] oldest activity date write failed: {}", e);
        }
        if !counts.is_empty() {
            if let Err(e) = engine.set_setting(ACTIVITY_YEAR_COUNTS_KEY, &counts) {
                log::warn!("[Sync] year counts write failed: {}", e);
            }
        }
    })
    .await;
    Ok(())
}

/// Persist a year of wellness, typed columns plus the untyped body per day.
async fn sync_wellness(transport: &Transport, athlete_id: &str) -> Result<(), NetError> {
    let newest = chrono::Local::now().date_naive();
    let oldest = newest - chrono::Duration::days(WELLNESS_DAYS);
    let days = endpoints::fetch_wellness_with_bodies(
        transport,
        athlete_id,
        &oldest.to_string(),
        &newest.to_string(),
        Lane::Backfill,
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

    // Through `store_body` for the announcement: nothing else says wellness
    // landed, so the three screens that read it were woken by the `activities`
    // channel, which fires per synced page while wellness is written once. The
    // activity id is empty because wellness is a day and not an activity; the
    // kind is what a reader filters on.
    store_body("wellness", String::new(), move |engine| {
        engine.upsert_wellness(&rows)
    })
    .await;
    Ok(())
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

    /// Start a sync. Returns instantly, naming whether the job started and, if
    /// not, whether asking again later would. Work runs on the shared runtime;
    /// observe progress via `get_sync_status`.
    fn sync_now(&self) -> Result<FfiStartOutcome, VeloqError> {
        let (transport, athlete_id) = match SYNC_SERVICE.try_start() {
            Ok(pair) => pair,
            Err(refusal) => return Ok(refusal),
        };
        crate::runtime::spawn(async move {
            let _guard = FinishGuard;
            perform_sync(&SYNC_SERVICE, transport, athlete_id).await;
        });
        Ok(FfiStartOutcome::Started)
    }

    /// Fetch and store one date window of activities. Returns instantly,
    /// naming whether the job started and, if not, whether asking again later
    /// would. The feed calls this for windows the default sync misses.
    fn sync_activities_window(
        &self,
        oldest: String,
        newest: String,
    ) -> Result<FfiStartOutcome, VeloqError> {
        let (transport, athlete_id) = match SYNC_SERVICE.try_start() {
            Ok(pair) => pair,
            Err(refusal) => return Ok(refusal),
        };
        crate::runtime::spawn(async move {
            let _guard = FinishGuard;
            perform_window_sync(&SYNC_SERVICE, transport, athlete_id, &oldest, &newest).await;
        });
        Ok(FfiStartOutcome::Started)
    }

    /// Fetch and store a power curve for a sport and window. The outcome says
    /// why it did not start: `Busy` while the same curve is being fetched,
    /// `Held` while a failed one backs off, `NotConfigured` with no credential.
    fn sync_power_curve(&self, sport: String, days: i64) -> FfiStartOutcome {
        spawn_once(
            JobKey::new("power", &[&sport, &days.to_string()]),
            move |transport, athlete_id| async move {
                let body = endpoints::fetch_power_curve_body(
                    &transport,
                    &athlete_id,
                    &sport,
                    &format!("{}d", days),
                    Lane::Interactive,
                )
                .await?;
                store_body("power_curve", String::new(), move |engine| {
                    engine.set_curve_body(CurveKind::Power, &sport, days, false, &body)
                })
                .await;
                Ok(())
            },
        )
    }

    /// Fetch and store a pace curve. `gap` asks for gradient-adjusted pace and
    /// is only honoured for running.
    fn sync_pace_curve(&self, sport: String, days: i64, gap: bool) -> FfiStartOutcome {
        spawn_once(
            JobKey::new("pace", &[&sport, &days.to_string(), &gap.to_string()]),
            move |transport, athlete_id| async move {
                let body = endpoints::fetch_pace_curve_body(
                    &transport,
                    &athlete_id,
                    &sport,
                    &format!("{}d", days),
                    gap,
                    Lane::Interactive,
                )
                .await?;
                store_body("pace_curve", String::new(), move |engine| {
                    engine.set_curve_body(CurveKind::Pace, &sport, days, gap, &body)
                })
                .await;
                Ok(())
            },
        )
    }

    /// Fetch and store an activity's work/recovery intervals.
    fn sync_activity_intervals(&self, activity_id: String) -> FfiStartOutcome {
        spawn_once(
            JobKey::new("intervals", &[&activity_id]),
            move |transport, _athlete_id| async move {
                let upstream = upstream_id(&activity_id).await;
                let body =
                    endpoints::fetch_intervals_body(&transport, &upstream, Lane::Interactive)
                        .await?;
                store_body("intervals", activity_id.clone(), move |engine| {
                    engine.set_interval_body(&activity_id, &body)
                })
                .await;
                Ok(())
            },
        )
    }

    /// Fetch and store the calendar events in a date window, replacing what
    /// was there so an event cancelled upstream disappears here too.
    fn sync_calendar_events(&self, oldest: String, newest: String) -> FfiStartOutcome {
        spawn_once(
            JobKey::new("calendar", &[&oldest, &newest]),
            move |transport, athlete_id| async move {
                let items = endpoints::fetch_calendar_events_bodies(
                    &transport,
                    &athlete_id,
                    &oldest,
                    &newest,
                    Lane::Interactive,
                )
                .await?;
                let rows: Vec<(String, i64, String)> = items
                    .into_iter()
                    .filter_map(|(id, start, raw)| {
                        start_date_to_timestamp(Some(&start)).map(|ts| (id, ts, raw))
                    })
                    .collect();
                let (Some(oldest_ts), Some(newest_ts)) = (
                    day_start_timestamp(&oldest),
                    day_start_timestamp(&newest).map(|t| t + 86_399),
                ) else {
                    return Ok(());
                };
                store_body("calendar", String::new(), move |engine| {
                    engine.replace_calendar_events(oldest_ts, newest_ts, &rows)
                })
                .await;
                Ok(())
            },
        )
    }

    /// Fetch and store an activity's streams for a series selection. The
    /// types string is the cache key, so callers must pass it consistently.
    fn sync_activity_streams(&self, activity_id: String, types: String) -> FfiStartOutcome {
        spawn_once(
            JobKey::new("streams", &[&activity_id, &types]),
            move |transport, _athlete_id| async move {
                let upstream = upstream_id(&activity_id).await;
                let body =
                    endpoints::fetch_streams_body(&transport, &upstream, &types, Lane::Interactive)
                        .await?;
                store_body("streams", activity_id.clone(), move |engine| {
                    engine.set_stream_body(&activity_id, &types, &body)
                })
                .await;
                Ok(())
            },
        )
    }

    /// Fetch and store an activity's full detail body, replacing the lighter
    /// row the list sync wrote.
    fn sync_activity_detail(&self, activity_id: String) -> FfiStartOutcome {
        spawn_once(
            JobKey::new("detail", &[&activity_id]),
            move |transport, _athlete_id| async move {
                let upstream = upstream_id(&activity_id).await;
                let body = endpoints::fetch_activity_body(&transport, &upstream, Lane::Interactive)
                    .await?;
                let date = serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .and_then(|v| {
                        v.get("start_date_local")
                            .and_then(|d| d.as_str())
                            .and_then(|d| start_date_to_timestamp(Some(d)))
                    });
                let Some(date) = date else {
                    return Ok(());
                };
                store_body("activity_detail", activity_id.clone(), move |engine| {
                    engine.upsert_activity_bodies(&[(activity_id.clone(), date, body)])
                })
                .await;
                Ok(())
            },
        )
    }

    /// Fetch and store the `time` streams the section-performance maths needs.
    /// Activities that already have one are skipped, so a repeat call over the
    /// same list costs nothing.
    fn sync_time_streams(&self, activity_ids: Vec<String>) -> FfiStartOutcome {
        if activity_ids.is_empty() {
            // Nothing was asked for, so refusing is the right answer and will
            // stay the right answer.
            return FfiStartOutcome::NotOwed;
        }
        let key = JobKey::over("timestreams", &activity_ids);
        spawn_once(key, move |transport, _athlete_id| async move {
            let missing = crate::persistence::with_persistent_engine_blocking(move |engine| {
                engine.get_activities_missing_time_streams(&activity_ids)
            })
            .await
            .unwrap_or_default();

            for activity_id in missing {
                let upstream = upstream_id(&activity_id).await;
                match endpoints::fetch_time_stream(&transport, &upstream, Lane::Backfill).await {
                    // An empty answer is stored too, as a zero-length row. This
                    // lane asked for exactly one thing and upstream said there
                    // is none, so the row records that the question was put.
                    // Dropping it left the activity named by
                    // `get_activities_missing_time_streams` on every pass for
                    // the life of the install, and left the section screens
                    // waiting out `TIME_STREAM_TIMEOUT_MS` for an announcement
                    // that never came.
                    Ok(times) => {
                        store_time_stream(activity_id, times).await;
                    }
                    // One activity without streams must not stop the batch;
                    // the section list would stay stuck on "loading".
                    Err(NetError::Unauthorized) => return Err(NetError::Unauthorized),
                    Err(e) => log::warn!("[Sync] time stream {} failed: {}", activity_id, e),
                }
            }
            Ok(())
        })
    }

    /// Upload a recorded activity file.
    ///
    /// The FIT streams from `file_path`, so a long ride never crosses FFI as
    /// bytes and never lands in memory. The call resolves when the server has
    /// answered; failures come back as an outcome, not as a thrown error.
    async fn upload_activity(
        &self,
        file_path: String,
        filename: String,
        name: Option<String>,
        paired_event_id: Option<i64>,
    ) -> FfiCallOutcome {
        run_write(move |transport, athlete_id| async move {
            endpoints::upload_activity(
                &transport,
                &athlete_id,
                &file_path,
                &filename,
                name.as_deref(),
                paired_event_id,
                Lane::Interactive,
            )
            .await
        })
        .await
    }

    /// Answer whether intervals.icu still holds the activity an upload created.
    ///
    /// A 200 from the upload says the server took the bytes, not that the ride
    /// survived: it can be rejected, deduplicated against an existing activity
    /// or lost afterwards, and the device's copy is the only other one. So the
    /// recording is not deleted until this reads the activity back. `Ok` means
    /// present, `Http` with 404 means gone, and everything else means unknown,
    /// which is not an answer and must not be treated as one.
    ///
    /// It goes through `run_write` for the credential handling rather than for
    /// the verb: a confirmation refused for a dead credential parks the service
    /// exactly as a refused upload does.
    async fn confirm_activity_uploaded(&self, intervals_id: String) -> FfiCallOutcome {
        run_write(move |transport, _athlete_id| async move {
            endpoints::fetch_activity_body(&transport, &intervals_id, Lane::Backfill)
                .await
                .map(|_| Some(intervals_id))
        })
        .await
    }

    /// Create an activity with no file behind it, for indoor entries.
    async fn create_manual_activity(&self, activity: FfiManualActivity) -> FfiCallOutcome {
        run_write(move |transport, athlete_id| async move {
            endpoints::create_activity(
                &transport,
                &athlete_id,
                &activity.into_body(),
                Lane::Interactive,
            )
            .await
        })
        .await
    }

    /// Check a credential against `/athlete/me` and report the athlete it
    /// belongs to. Login confirms a key this way before committing it, so the
    /// credential under test is deliberately not the one the service holds.
    async fn validate_credentials(&self, method: String, secret: String) -> FfiCallOutcome {
        let Some(kind) = AuthKind::parse(&method) else {
            return FfiCallOutcome::internal(format!("unknown auth method: {}", method));
        };
        let base = SYNC_SERVICE
            .base_url
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let auth = match kind {
            AuthKind::OAuth => AuthMethod::Bearer(&secret),
            AuthKind::ApiKey => AuthMethod::ApiKey(&secret),
        };
        let transport = match Transport::new(base, auth) {
            Ok(t) => t,
            Err(e) => return FfiCallOutcome::internal(e),
        };
        // A rejected candidate is not an expired session, so unlike a write
        // this deliberately leaves the service state alone.
        run_on_runtime(async move {
            endpoints::fetch_current_athlete(&transport, Lane::Interactive)
                .await
                .map(|athlete| Some(athlete.id))
        })
        .await
    }

    /// Soft-cancel the running sync.
    fn cancel(&self) {
        SYNC_SERVICE.request_cancel();
    }

    /// Current status snapshot.
    fn get_sync_status(&self) -> FfiSyncStatus {
        SYNC_SERVICE.snapshot()
    }

    /// How many on-demand bodies have landed in SQLite this session.
    ///
    /// An on-demand fetch settles on a Rust thread with no way to reach the
    /// TypeScript listener map, so a reader waiting on a body watches this and
    /// fans a change out over the engine channel when it moves.
    fn bodies_stored(&self) -> u64 {
        bodies_stored()
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
        assert_eq!(s.state, SyncState::Idle);
        assert_eq!(s.in_flight, 0);
        assert!(s.last_error.is_none());
    }

    /// Scenario: the process-local key set `spawn_once` used to hold is gone,
    /// and every question it answered is answered by the attempt store.
    ///
    /// Expected behaviour: a key this generation holds is `Busy`, exactly as
    /// before. A key a dead process left claimed is free, which the `HashSet`
    /// could never say because a restart emptied it. And a key that keeps
    /// failing backs off instead of being re-admitted the instant it lands.
    mod leases {
        use super::*;
        use crate::persistence::attempts::{JobKey, attempt_backoff_ms};
        use crate::persistence::with_persistent_engine;
        use crate::test_globals::{init_global_engine, serial_global_state};
        use std::sync::atomic::AtomicI64;

        fn key() -> JobKey {
            JobKey::new("detail", &["a1"])
        }

        /// Wait for the spawned job to give its lease back. The release runs
        /// on the runtime rather than on this thread, so the only honest
        /// signal is the row itself.
        fn drain_spawned() {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                let settled = with_persistent_engine(|engine| {
                    engine
                        .job_attempt(&key())
                        .expect("read")
                        .is_none_or(|row| row.lease_gen == 0)
                })
                .expect("engine");
                if settled {
                    return;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "the spawned job never released its lease"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }

        /// A claim taken without spawning anything, the way a job in flight
        /// holds one.
        fn hold(key: &JobKey, now: i64) {
            with_persistent_engine(|engine| engine.claim_job(key, now).expect("claim"))
                .expect("engine");
        }

        #[test]
        fn a_key_this_generation_holds_is_busy_and_a_missing_credential_is_not() {
            let _serial = serial_global_state();
            let _tmp = init_global_engine("leases.db");
            SYNC_SERVICE.clear_credentials();

            let refused = spawn_once_at(
                key(),
                || 1_000,
                |_transport, _athlete| async { Ok::<(), NetError>(()) },
            );
            assert_eq!(
                refused,
                FfiStartOutcome::NotConfigured,
                "no credential is not a busy key"
            );
            assert!(!refused.is_retryable());

            let _creds = test_credentials();
            hold(&key(), 1_000);

            let busy = spawn_once_at(
                key(),
                || 1_001,
                |_transport, _athlete| async { Ok::<(), NetError>(()) },
            );
            assert_eq!(
                busy,
                FfiStartOutcome::Busy,
                "a key already in flight is not a missing credential"
            );
            assert!(busy.is_retryable());
        }

        /// The whole reason the set moved onto the store. A fetch that was in
        /// flight when the app died left a claimed row behind, and the next
        /// launch has to see it as free. A `HashSet` a restart empties cannot
        /// tell that from a key nobody ever asked for.
        #[test]
        fn a_key_a_dead_process_left_claimed_is_free_after_a_restart() {
            let _serial = serial_global_state();
            let _tmp = init_global_engine("leases.db");
            let _creds = test_credentials();

            hold(&key(), 1_000);
            assert_eq!(
                spawn_once_at(key(), || 1_001, |_t, _a| async { Ok::<(), NetError>(()) }),
                FfiStartOutcome::Busy
            );

            with_persistent_engine(|engine| engine.mint_lease_generation().expect("mint"))
                .expect("engine");

            assert_eq!(
                spawn_once_at(key(), || 1_002, |_t, _a| async { Ok::<(), NetError>(()) }),
                FfiStartOutcome::Started,
                "a lease from a process that is gone stranded the key"
            );
        }

        /// The backoff is the store's, a pure function of the attempt count,
        /// so the ladder is read rather than spent. No `Instant` here.
        #[test]
        fn a_key_that_keeps_failing_waits_longer_each_time() {
            let _serial = serial_global_state();
            let _tmp = init_global_engine("leases.db");
            let _creds = test_credentials();

            let clock = Arc::new(AtomicI64::new(1_000));
            let mut waits = Vec::new();
            for _ in 0..3 {
                let tick = Arc::clone(&clock);
                assert_eq!(
                    spawn_once_at(
                        key(),
                        move || tick.load(Ordering::SeqCst),
                        |_t, _a| async {
                            Err::<(), NetError>(NetError::Http {
                                status: 500,
                                body: "upstream".to_string(),
                            })
                        }
                    ),
                    FfiStartOutcome::Started
                );
                drain_spawned();

                let tick = Arc::clone(&clock);
                let held = spawn_once_at(
                    key(),
                    move || tick.load(Ordering::SeqCst),
                    |_t, _a| async { Ok::<(), NetError>(()) },
                );
                assert_eq!(
                    held,
                    FfiStartOutcome::Held,
                    "a key that just failed was re-admitted"
                );
                assert!(held.is_retryable());

                let row = with_persistent_engine(|engine| {
                    engine.job_attempt(&key()).expect("read").expect("a row")
                })
                .expect("engine");
                waits.push(attempt_backoff_ms(row.attempts - 1));
                clock.fetch_add(attempt_backoff_ms(row.attempts - 1), Ordering::SeqCst);
            }

            assert_eq!(waits, vec![1_000, 2_000, 4_000]);
        }

        /// `ReleaseGuard` held the key against a panicking job before the move
        /// and has to keep holding it, or the resource could never be asked
        /// for again.
        #[test]
        fn a_job_that_panics_gives_the_lease_back() {
            let _serial = serial_global_state();
            let _tmp = init_global_engine("leases.db");
            let _creds = test_credentials();

            assert_eq!(
                spawn_once_at(
                    key(),
                    || 1_000,
                    |_t, _a| async {
                        panic!("the job blew up");
                    }
                ),
                FfiStartOutcome::Started
            );
            drain_spawned();

            let row = with_persistent_engine(|engine| engine.job_attempt(&key()).expect("read"))
                .expect("engine");
            let row = row.expect("a panicking job still records its attempt");
            assert_eq!(
                row.lease_gen, 0,
                "a panic left the key leased, so nothing can ask for it again"
            );
            assert_eq!(
                row.attempts, 1,
                "a panic is a failed attempt, and backs off"
            );
        }

        /// Work that lands is forgotten, so the next ask is admitted rather
        /// than waiting behind a row nobody needs.
        #[test]
        fn work_that_lands_leaves_the_key_free() {
            let _serial = serial_global_state();
            let _tmp = init_global_engine("leases.db");
            let _creds = test_credentials();

            assert_eq!(
                spawn_once_at(key(), || 1_000, |_t, _a| async { Ok::<(), NetError>(()) }),
                FfiStartOutcome::Started
            );
            drain_spawned();

            assert!(
                with_persistent_engine(|engine| engine.job_attempt(&key()).expect("read"))
                    .expect("engine")
                    .is_none()
            );
            assert_eq!(
                spawn_once_at(key(), || 1_001, |_t, _a| async { Ok::<(), NetError>(()) }),
                FfiStartOutcome::Started
            );
        }

        /// The engine is where the lease lives, so a start before it opens is
        /// early rather than refused for a reason that will not lift.
        #[test]
        fn a_start_before_the_engine_opens_is_not_ready() {
            let _serial = serial_global_state();
            crate::persistence::clear_persistent_engine();
            let _creds = test_credentials();

            let outcome = spawn_once_at(key(), || 1_000, |_t, _a| async { Ok::<(), NetError>(()) });
            assert_eq!(outcome, FfiStartOutcome::NotReady);
            assert!(outcome.is_retryable());
        }

        /// `timestreams` was the one unbounded key: `activity_ids.join(",")`
        /// wrote every id into a `TEXT PRIMARY KEY`. Two lists that differ
        /// still have to differ as keys.
        #[test]
        fn two_time_stream_lists_take_two_keys() {
            let one: Vec<String> = (0..500).map(|i| format!("a{i}")).collect();
            let mut other = one.clone();
            other.push("a500".to_string());

            let first = JobKey::over("timestreams", &one);
            let second = JobKey::over("timestreams", &other);

            assert_ne!(first.as_str(), second.as_str());
            assert!(
                first.as_str().len() < 80 && second.as_str().len() < 80,
                "the key is the count and a hash, not the list"
            );
        }
    }

    #[test]
    fn try_begin_is_exclusive() {
        let svc = SyncService::new();
        assert!(svc.try_begin());
        assert_eq!(svc.snapshot().state, SyncState::Syncing);
        // Second begin while running is rejected.
        assert!(!svc.try_begin());
    }

    #[test]
    fn try_start_names_a_held_slot_apart_from_a_missing_credential() {
        let svc = SyncService::new();
        // No credential: refusing is correct and will stay correct.
        assert_eq!(
            svc.try_start().err(),
            Some(FfiStartOutcome::NotConfigured),
            "a missing credential is not a busy slot"
        );
        assert!(!FfiStartOutcome::NotConfigured.is_retryable());
        // The failed attempt must not leave the slot claimed.
        assert_eq!(svc.snapshot().state, SyncState::Idle);

        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        let (_transport, athlete) = svc.try_start().expect("a configured start is accepted");
        assert_eq!(athlete, "i1");

        // Now the slot is held, which is the opposite situation and used to
        // reach the caller as the same `false`.
        assert_eq!(
            svc.try_start().err(),
            Some(FfiStartOutcome::Busy),
            "a held slot is not a missing credential"
        );
        assert!(FfiStartOutcome::Busy.is_retryable());
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
        // The oldest-date step hits the same path with a different window, so
        // one mock covers both activity pulls.
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(status).json_body(json!([]));
        });
    }

    #[test]
    fn successful_sync_returns_to_idle_completed() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        mock_profile_slice(&server, 200);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, SyncState::Idle);
        assert_eq!(s.total, SYNC_STEPS);
        assert_eq!(s.completed, SYNC_STEPS);
        assert_eq!(s.in_flight, 0);
        assert!(s.last_error.is_none());
    }

    #[test]
    fn unauthorized_sync_moves_to_auth_expired() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        mock_profile_slice(&server, 401);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, SyncState::AuthExpired);
        assert_eq!(s.completed, 0);
        assert_eq!(s.last_error.as_deref(), Some("unauthorized"));
    }

    /// Scenario: the sync step is refused but the credential still works.
    ///
    /// Expected behaviour: one 401 is not evidence, so the confirmation on the
    /// profile answers 200 and the session stands. The step reports its own
    /// error, which is what a caller sees for any other failed step.
    #[test]
    fn an_unconfirmed_401_leaves_the_session_standing() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        // The profile is the confirmation endpoint, so it answers, and the
        // step after it is the one that is refused.
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/sport-settings");
            then.status(401);
        });
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(
            s.state,
            SyncState::Idle,
            "a single 401 signed the athlete out with a working credential"
        );
        assert_eq!(s.completed, 1, "the profile step landed and still counts");
    }

    /// A credential the server rejects twice is dead, and only then.
    #[test]
    fn the_profile_confirms_a_rejected_credential() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(401);
        });
        assert!(crate::runtime::block_on(credential_is_rejected(
            &transport_to(server.base_url()),
            "i1"
        )));
    }

    /// A credential the profile answers is alive, whatever else refused it.
    #[test]
    fn a_profile_that_answers_is_not_a_rejection() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        assert!(!crate::runtime::block_on(credential_is_rejected(
            &transport_to(server.base_url()),
            "i1"
        )));
    }

    /// A server that is broken says nothing about the credential, so it is not
    /// a confirmation either. Nor is a transport that never connects.
    #[test]
    fn only_a_second_401_confirms_a_rejection() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(500);
        });
        assert!(!crate::runtime::block_on(credential_is_rejected(
            &transport_to(server.base_url()),
            "i1"
        )));

        // A port nothing is listening on: the request fails before any status.
        assert!(!crate::runtime::block_on(credential_is_rejected(
            &transport_to("http://127.0.0.1:1".to_string()),
            "i1"
        )));
    }

    #[test]
    fn server_error_records_error_but_returns_idle() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        mock_profile_slice(&server, 500);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, SyncState::Idle);
        // Every step that reached the server failed. The curve sweep is the
        // one that did not: it reads its sports from the engine, there is no
        // engine here, and a sweep with nothing to fetch has not failed.
        assert_eq!(s.completed, 1);
        assert!(s.last_error.is_some());
    }

    /// Scenario: the banner has to name the failure in the athlete's language,
    /// and a free string written by the engine cannot be translated.
    ///
    /// Expected behaviour: every terminal failure carries a reason from the
    /// closed set beside its message, and a clean settle carries none.
    #[test]
    fn a_rejected_credential_settles_with_the_unauthorized_reason() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        mock_profile_slice(&server, 401);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        assert_eq!(
            svc.snapshot().last_error_reason,
            Some(FfiSyncErrorReason::Unauthorized)
        );
    }

    #[test]
    fn a_server_error_settles_with_the_server_reason() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        mock_profile_slice(&server, 500);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        assert_eq!(
            svc.snapshot().last_error_reason,
            Some(FfiSyncErrorReason::Server)
        );
    }

    #[test]
    fn an_unreachable_host_settles_with_the_network_reason() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to("http://127.0.0.1:1".to_string()),
            "i1".into(),
        ));
        assert_eq!(
            svc.snapshot().last_error_reason,
            Some(FfiSyncErrorReason::Network)
        );
    }

    #[test]
    fn parking_on_a_rejected_credential_carries_the_reason() {
        let svc = SyncService::new();
        svc.finish(
            SyncState::AuthExpired,
            Some(SyncFailure::unauthorized()),
            false,
        );
        let s = svc.snapshot();
        assert_eq!(s.last_error.as_deref(), Some("unauthorized"));
        assert_eq!(s.last_error_reason, Some(FfiSyncErrorReason::Unauthorized));
    }

    #[test]
    fn missing_credentials_settle_with_the_not_configured_reason() {
        let svc = SyncService::new();
        let reason = match svc.build_transport() {
            Ok(_) => panic!("a service with no credentials built a transport"),
            Err(e) => e.reason,
        };
        assert_eq!(reason, FfiSyncErrorReason::NotConfigured);
    }

    #[test]
    fn a_clean_settle_carries_no_reason() {
        let svc = SyncService::new();
        svc.finish(SyncState::Idle, None, true);
        assert_eq!(svc.snapshot().last_error_reason, None);
    }

    /// A reason that survives the second failure of a different kind: the
    /// status holds the last one, not the first.
    #[test]
    fn the_reason_moves_with_the_message() {
        let svc = SyncService::new();
        svc.finish(
            SyncState::AuthExpired,
            Some(SyncFailure::unauthorized()),
            false,
        );
        svc.finish(
            SyncState::Idle,
            Some(SyncFailure::from(&NetError::RateLimited)),
            false,
        );
        assert_eq!(
            svc.snapshot().last_error_reason,
            Some(FfiSyncErrorReason::RateLimited)
        );
    }

    /// Scenario: a sync builds its transport, with the bearer token baked in,
    /// before it spawns. The athlete then signs out, or a second athlete signs
    /// in on the same device, while that sync is still walking its steps.
    ///
    /// Expected behaviour: the run stops at the next step. It does not keep
    /// fetching on a credential nobody holds any more and it does not write
    /// the signed-out athlete's data into the new athlete's database.
    #[test]
    fn a_sync_stops_when_the_credential_is_cleared_under_it() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        let hit = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        let transport = transport_to(server.base_url());
        assert!(svc.try_begin());
        svc.clear_credentials();

        crate::runtime::block_on(perform_sync(&svc, transport, "i1".into()));

        hit.assert_hits(0);
        assert_eq!(svc.snapshot().state, SyncState::Idle);
    }

    #[test]
    fn a_sync_stops_when_another_athlete_signs_in_under_it() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        let hit = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        let transport = transport_to(server.base_url());
        assert!(svc.try_begin());
        svc.set_credentials(AuthKind::ApiKey, "other".into(), "i2".into());

        crate::runtime::block_on(perform_sync(&svc, transport, "i1".into()));

        hit.assert_hits(0);
        assert_eq!(svc.snapshot().state, SyncState::Idle);
    }

    #[test]
    fn a_sync_for_the_athlete_who_is_still_signed_in_runs() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        mock_profile_slice(&server, 200);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        let transport = transport_to(server.base_url());
        assert!(svc.try_begin());

        crate::runtime::block_on(perform_sync(&svc, transport, "i1".into()));

        let s = svc.snapshot();
        assert_eq!(s.state, SyncState::Idle);
        assert!(s.completed > 0, "the run walked no steps");
    }

    /// Signing out has to stop the dispatch as well as fail the check, so a
    /// step already in flight is not followed by another one.
    #[test]
    fn clearing_the_credential_cancels_a_running_sync() {
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        assert!(!svc.is_cancelled());

        svc.clear_credentials();

        assert!(svc.is_cancelled());
    }

    /// The check is on the athlete, not on whether any credential exists, so a
    /// service that never had one does not read as still authorised.
    #[test]
    fn a_service_with_no_credential_authorises_nobody() {
        let svc = SyncService::new();
        assert!(!svc.still_signed_in("i1"));
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.still_signed_in("i1"));
        assert!(!svc.still_signed_in("i2"));
    }

    #[test]
    fn one_failing_endpoint_does_not_cost_the_others() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
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
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200).json_body(json!([]));
        });

        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, SyncState::Idle);
        assert_eq!(s.completed, SYNC_STEPS - 1);
        assert!(s.last_error.is_some());
    }

    #[test]
    fn cancel_before_run_skips_work() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        svc.request_cancel();
        assert!(svc.is_cancelled());
        assert_eq!(svc.snapshot().state, SyncState::Paused);
        // A mock that would panic the assertion if hit is unnecessary: a cancelled
        // job finishes without dispatching. Point at an unroutable base; the job
        // must not touch it.
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to("http://127.0.0.1:1".into()),
            "i1".into(),
        ));
        assert_eq!(svc.snapshot().state, SyncState::Idle);
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
    fn the_metrics_row_carries_the_stats_the_page_fetched() {
        let record: ActivityRecord = serde_json::from_value(json!({
            "id": "a1",
            "name": "Ride",
            "type": "Ride",
            "start_date_local": "2026-01-02T08:00:00",
            "moving_time": 3600,
            "icu_training_load": 88.0,
            "icu_ftp": 250.4,
            "icu_zone_times": [{"id": "Z1", "secs": 10}, {"id": "Z2", "secs": 20}],
            "icu_hr_zone_times": [11, 22],
        }))
        .expect("record");

        let row = activity_metrics_row(record, 1_767_340_800);

        assert_eq!(row.training_load, Some(88.0));
        assert_eq!(row.ftp, Some(250));
        assert_eq!(row.power_zone_times, Some(vec![10, 20]));
        assert_eq!(row.hr_zone_times, Some(vec![11, 22]));
    }

    #[test]
    fn an_activity_with_no_stats_leaves_them_unset() {
        let record: ActivityRecord = serde_json::from_value(json!({
            "id": "a2",
            "start_date_local": "2026-01-02T08:00:00",
        }))
        .expect("record");

        let row = activity_metrics_row(record, 1_767_340_800);

        assert_eq!(row.training_load, None);
        assert_eq!(row.ftp, None);
        assert_eq!(row.power_zone_times, None);
        assert_eq!(row.hr_zone_times, None);
        assert_eq!(row.sport_type, "Ride");
    }

    // A zone series in a shape we do not model is worth less than the
    // activity, so it is dropped rather than failing the whole page.
    #[test]
    fn an_unmodelled_zone_shape_does_not_cost_the_page_its_metrics() {
        let record: ActivityRecord = serde_json::from_value(json!({
            "id": "a3",
            "start_date_local": "2026-01-02T08:00:00",
            "icu_training_load": 42.0,
            "icu_zone_times": 120,
            "icu_hr_zone_times": "nope",
        }))
        .expect("record");

        let row = activity_metrics_row(record, 1_767_340_800);

        assert_eq!(row.training_load, Some(42.0));
        assert_eq!(row.power_zone_times, None);
        assert_eq!(row.hr_zone_times, None);
    }

    #[test]
    fn default_activity_sync_covers_ninety_days() {
        // The slider's own default is 90 days, so the sync that runs without
        // it must ask for the same window, not a year.
        let server = MockServer::start();
        let today = chrono::Local::now().date_naive();
        let oldest = (today - chrono::Duration::days(90)).to_string();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", oldest.as_str())
                .query_param("newest", today.to_string());
            then.status(200).json_body(json!([]));
        });

        crate::runtime::block_on(sync_activities(
            &transport_to(server.base_url()),
            "i1",
            &|| false,
        ))
        .expect("default sync");
        mock.assert();
    }

    /// Scenario: nothing announced wellness, so the three screens that read it
    /// were woken by the `activities` channel instead. That channel fires per
    /// synced page, measured five times in the first 4.5 s of a launch, and
    /// wellness is written once, so each of them re-read and re-parsed its whole
    /// window four times for nothing. A `1y` range is 365 bodies.
    ///
    /// Expected behaviour: one announcement, after the write, naming wellness.
    #[test]
    fn a_wellness_sync_announces_itself_once() {
        let _guard = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/wellness");
            then.status(200)
                .json_body(json!([{"id": "2026-03-01", "ctl": 50.0, "atl": 40.0}]));
        });
        let recorder = crate::objects::observer::recorder::Recorder::new();
        crate::objects::observer::set_observer(Some(recorder.clone()));

        crate::runtime::block_on(sync_wellness(&transport_to(server.base_url()), "i1"))
            .expect("wellness sync");

        crate::objects::observer::set_observer(None);
        assert_eq!(
            recorder
                .events()
                .iter()
                .filter(|e| e.starts_with("body_stored:wellness"))
                .count(),
            1,
            "one announcement per sync, the events were: {:?}",
            recorder.events()
        );
    }

    /// A page the server answered with nothing stored nothing, so there is
    /// nothing to wake a reader for. An announcement on an empty page would
    /// re-read every range for no change, which is the cost being removed.
    #[test]
    fn an_empty_wellness_page_announces_nothing() {
        let _guard = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::seeded_global_engine();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/wellness");
            then.status(200).json_body(json!([]));
        });
        let recorder = crate::objects::observer::recorder::Recorder::new();
        crate::objects::observer::set_observer(Some(recorder.clone()));

        crate::runtime::block_on(sync_wellness(&transport_to(server.base_url()), "i1"))
            .expect("wellness sync");

        crate::objects::observer::set_observer(None);
        assert!(
            !recorder
                .events()
                .iter()
                .any(|e| e.starts_with("body_stored:wellness")),
            "the events were: {:?}",
            recorder.events()
        );
    }

    #[test]
    fn default_wellness_sync_still_covers_a_year() {
        // Narrowing activities must not narrow wellness: the fitness plots
        // read a year and refetching on every range change is what the
        // wider window exists to avoid.
        let server = MockServer::start();
        let today = chrono::Local::now().date_naive();
        let oldest = (today - chrono::Duration::days(365)).to_string();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/wellness")
                .query_param("oldest", oldest.as_str())
                .query_param("newest", today.to_string());
            then.status(200).json_body(json!([]));
        });

        crate::runtime::block_on(sync_wellness(&transport_to(server.base_url()), "i1"))
            .expect("wellness sync");
        mock.assert();
    }

    #[test]
    fn a_window_older_than_the_default_still_reaches_the_api() {
        // The 90-day default only sets where the sync starts. Everything
        // older arrives through the expansion path, so narrowing the default
        // must not be able to read as losing history.
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", "2019-01-01")
                .query_param("newest", "2019-12-31");
            then.status(200).json_body(json!([]));
        });

        crate::runtime::block_on(sync_activity_window(
            &transport_to(server.base_url()),
            "i1",
            "2019-01-01",
            "2019-12-31",
            &|| false,
        ))
        .expect("expansion window");
        mock.assert();
    }

    /// The fitness plot marks an eFTP change, which intervals.icu reports per
    /// activity as the accepted rolling value and its delta. The estimate
    /// alone cannot stand in: two rides on one day report 168 and 93 W
    /// against a rolling 155.
    #[test]
    fn the_window_sync_asks_for_the_rolling_eftp_pair() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .matches(|req| {
                    let fields = req
                        .query_params
                        .as_ref()
                        .and_then(|q| q.iter().find(|(k, _)| k == "fields"))
                        .map(|(_, v)| v.split(',').map(str::to_string).collect::<Vec<_>>())
                        .unwrap_or_default();
                    fields.iter().any(|f| f == "icu_rolling_ftp")
                        && fields.iter().any(|f| f == "icu_rolling_ftp_delta")
                        && fields.iter().any(|f| f == "icu_pm_ftp_watts")
                });
            then.status(200).json_body(json!([]));
        });

        crate::runtime::block_on(sync_activity_window(
            &transport_to(server.base_url()),
            "i1",
            "2026-01-01",
            "2026-01-31",
            &|| false,
        ))
        .expect("window");
        mock.assert();
    }

    #[test]
    fn activity_window_sync_stores_bodies_and_metrics() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", "2025-01-01")
                .query_param("newest", "2025-01-31");
            then.status(200).json_body(json!([
                {"id": "a1", "type": "Ride", "name": "Loop",
                 "start_date_local": "2025-01-15T08:30:00", "distance": 28400.0}
            ]));
        });

        crate::runtime::block_on(sync_activity_window(
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            &|| false,
        ))
        .expect("window sync");
        mock.assert();
    }

    /// Expected behaviour: a cancel that lands before the job runs stops the
    /// request, not just the write. The state machine is already `Paused` by
    /// then, so a request that still goes out spends the athlete's data on a
    /// sync they stopped.
    #[test]
    fn a_window_cancelled_before_it_starts_never_asks_the_api() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200)
                .json_body(json!([{"id": "a1", "type": "Ride", "name": "Loop",
                                   "start_date_local": "2025-01-15T08:30:00"}]));
        });

        let outcome = crate::runtime::block_on(sync_activity_window(
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            &|| true,
        ))
        .expect("a cancelled window is not an error");

        assert_eq!(outcome, WindowOutcome::Abandoned);
        mock.assert_hits(0);
    }

    /// Expected behaviour: the cancel is soft, so the request in flight is
    /// allowed to finish, but what it carried is not written. Writing it is
    /// what let the library keep filling after the UI said cancelled.
    #[test]
    fn a_window_cancelled_in_flight_stores_nothing_it_fetched() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200)
                .json_body(json!([{"id": "a1", "type": "Ride", "name": "Loop",
                                   "start_date_local": "2025-01-15T08:30:00",
                                   "distance": 28400.0}]));
        });

        // False at the gate before the request, true at the gate before the
        // write: the cancel arrived while the page was in flight.
        let checks = std::sync::atomic::AtomicU32::new(0);
        let cancelled = || checks.fetch_add(1, std::sync::atomic::Ordering::Relaxed) > 0;

        let outcome = crate::runtime::block_on(sync_activity_window(
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            &cancelled,
        ))
        .expect("a cancelled window is not an error");

        assert_eq!(outcome, WindowOutcome::Abandoned);
        mock.assert_hits(1);
        assert!(
            checks.load(std::sync::atomic::Ordering::Relaxed) >= 2,
            "the write ran without asking whether the job was still wanted"
        );
    }

    /// Expected behaviour: a cancelled job settles unsuccessfully, so the
    /// status does not claim the window landed while the state machine was
    /// moved to `Paused` by the cancel.
    #[test]
    fn a_cancelled_window_job_does_not_settle_as_a_success() {
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        svc.request_cancel();

        // An unroutable base stands in for a mock that would fail the test if
        // it were hit: a cancelled job must not dispatch at all.
        crate::runtime::block_on(perform_window_sync(
            &svc,
            transport_to("http://127.0.0.1:1".into()),
            "i1".into(),
            "2025-01-01",
            "2025-01-31",
        ));

        let s = svc.snapshot();
        assert_eq!(s.state, SyncState::Idle);
        assert_eq!(s.completed, 0, "a cancelled job completed a step");
        assert!(s.last_error.is_none(), "a cancel is not a failure");
    }

    #[test]
    fn activity_without_a_start_time_is_skipped() {
        // A row with no start time cannot be windowed or ordered, and a
        // fabricated timestamp would sort it into the wrong week.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200)
                .json_body(json!([{"id": "a1", "type": "Ride"}]));
        });

        crate::runtime::block_on(sync_activity_window(
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            &|| false,
        ))
        .expect("window sync tolerates the gap");
    }

    #[test]
    fn start_date_parsing_handles_the_intervals_shapes() {
        assert_eq!(
            start_date_to_timestamp(Some("2025-01-15T08:30:00")),
            Some(1_736_929_800)
        );
        // Fractional seconds are trimmed rather than failing the row.
        assert_eq!(
            start_date_to_timestamp(Some("2025-01-15T08:30:00.000")),
            start_date_to_timestamp(Some("2025-01-15T08:30:00"))
        );
        assert_eq!(start_date_to_timestamp(None), None);
        assert_eq!(start_date_to_timestamp(Some("not a date")), None);
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
        assert_eq!(svc.snapshot().state, SyncState::Syncing);
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
    fn write_failures_carry_the_status_the_caller_branches_on() {
        // These five mappings decide whether a recording is retried, parked or
        // sent back for a permission upgrade.
        let unauthorized = FfiCallOutcome::from_error(&NetError::Unauthorized);
        assert_eq!(unauthorized.kind, FfiCallKind::Unauthorized);
        assert_eq!(unauthorized.status, Some(401));

        let limited = FfiCallOutcome::from_error(&NetError::RateLimited);
        assert_eq!(limited.kind, FfiCallKind::RateLimited);
        assert_eq!(limited.status, Some(429));

        let forbidden = FfiCallOutcome::from_error(&NetError::Http {
            status: 403,
            body: r#"{"error":"No permission"}"#.to_string(),
        });
        assert_eq!(forbidden.kind, FfiCallKind::Http);
        assert_eq!(forbidden.status, Some(403));
        assert_eq!(forbidden.detail.as_deref(), Some("No permission"));

        let offline = FfiCallOutcome::from_error(&NetError::Transport("dns".to_string()));
        assert_eq!(offline.kind, FfiCallKind::Network);
        assert_eq!(offline.status, None);

        // A missing file is local, not a connectivity problem: queuing it for a
        // network retry would wait forever on a file that will not appear.
        let missing = FfiCallOutcome::from_error(&NetError::Io("no such file".to_string()));
        assert_eq!(missing.kind, FfiCallKind::Internal);
        assert_eq!(missing.status, None);
    }

    #[test]
    fn a_successful_write_reports_the_created_id() {
        let ok = FfiCallOutcome::ok(Some("i999".to_string()));
        assert_eq!(ok.kind, FfiCallKind::Ok);
        assert_eq!(ok.id.as_deref(), Some("i999"));
        assert!(ok.status.is_none());
    }

    #[test]
    fn server_detail_prefers_the_message_the_server_wrote() {
        assert_eq!(
            server_detail(r#"{"message":"Bad request"}"#).as_deref(),
            Some("Bad request")
        );
        assert_eq!(
            server_detail(r#"{"error":"Invalid activity"}"#).as_deref(),
            Some("Invalid activity")
        );
        assert_eq!(
            server_detail("Internal error").as_deref(),
            Some("Internal error")
        );
        assert_eq!(server_detail("   ").as_deref(), None);
        // An error page is not a message worth showing.
        assert_eq!(server_detail(&"x".repeat(600)), None);
    }

    #[test]
    fn a_manual_entry_is_only_flagged_when_it_says_so() {
        let entry = FfiManualActivity {
            activity_type: "Yoga".to_string(),
            name: "Evening".to_string(),
            start_date_local: "2026-08-05T18:00:00".to_string(),
            elapsed_time: 1800,
            moving_time: None,
            distance: None,
            total_elevation_gain: None,
            average_heartrate: None,
            description: None,
            trainer: None,
            commute: None,
        };
        let body = entry.into_body();
        assert!(!body.trainer);
        assert!(!body.commute);
        // An unset optional is omitted rather than sent as null.
        let json = serde_json::to_value(&body).unwrap();
        assert!(json.get("distance").is_none());
        assert_eq!(json["type"], "Yoga");
    }

    /// The only test that touches the process-wide `SYNC_SERVICE`: `FinishGuard`
    /// is wired to it, not to a caller-supplied service.
    #[test]
    fn a_panicking_sync_task_releases_the_running_slot() {
        assert!(SYNC_SERVICE.try_begin());
        assert_eq!(SYNC_SERVICE.snapshot().state, SyncState::Syncing);

        let outcome = std::panic::catch_unwind(|| {
            let _guard = FinishGuard;
            panic!("perform_sync blew up");
        });
        assert!(outcome.is_err());

        let s = SYNC_SERVICE.snapshot();
        assert_eq!(
            s.state,
            SyncState::Idle,
            "a wedged slot never returns to idle"
        );
        assert_eq!(s.last_error.as_deref(), Some("sync task panicked"));
        assert!(
            SYNC_SERVICE.try_begin(),
            "every later sync for the session is refused without the guard"
        );
        SYNC_SERVICE.finish(SyncState::Idle, None, false);
    }

    #[test]
    fn auth_expired_recovers_on_next_begin() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        // After a 401 the service rests in authExpired. Once TypeScript re-auths
        // and issues sync_now again, try_begin moves it back into syncing.
        let server = MockServer::start();
        mock_profile_slice(&server, 401);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            transport_to(server.base_url()),
            "i1".into(),
        ));
        assert_eq!(svc.snapshot().state, SyncState::AuthExpired);
        assert!(svc.try_begin());
        assert_eq!(svc.snapshot().state, SyncState::Syncing);
    }
}

/// The same fixtures are asserted in `src/__tests__/lib/startDateParity.test.ts`.
/// A change to either parser fails on both sides rather than drifting.
#[cfg(test)]
mod start_date_parity_tests {
    use super::start_date_to_timestamp;

    const FIXTURES: [(&str, i64); 5] = [
        ("2026-08-22T18:30:00", 1787423400),
        ("2026-01-01T00:00:00", 1767225600),
        ("2026-12-31T23:59:59", 1798761599),
        ("2026-06-15T12:00:00.000", 1781524800),
        ("2024-02-29T06:45:30", 1709189130),
    ];

    #[test]
    fn matches_the_typescript_parser() {
        for (input, expected) in FIXTURES {
            assert_eq!(
                start_date_to_timestamp(Some(input)),
                Some(expected),
                "{input}"
            );
        }
    }

    #[test]
    fn rejects_missing_or_unparseable_input() {
        assert_eq!(start_date_to_timestamp(None), None);
        assert_eq!(start_date_to_timestamp(Some("")), None);
        assert_eq!(start_date_to_timestamp(Some("not a date")), None);
    }
}

/// An on-demand body lands on a Rust thread that cannot reach the listener map.
///
/// Scenario: an activity screen opens for the first time, asks for its
/// intervals, and the fetch succeeds. The observer is what wakes the query
/// that asked, and the count is the cold-start reconciliation behind it, so
/// these pin both to what actually reached SQLite.
#[cfg(test)]
mod body_count_tests {
    use super::*;
    use crate::objects::observer::{EngineObserver, set_observer};
    use crate::test_globals::serial_global_state;
    use httpmock::prelude::*;
    use serde_json::json;
    use std::time::{Duration, Instant};
    use tempfile::TempDir;

    /// Records the bodies it is told about, as `kind:activity_id`.
    struct Bodies {
        seen: Mutex<Vec<String>>,
    }

    impl Bodies {
        fn record() -> Arc<Self> {
            let recorder = Arc::new(Self {
                seen: Mutex::new(Vec::new()),
            });
            set_observer(Some(recorder.clone()));
            recorder
        }

        fn seen(&self) -> Vec<String> {
            self.seen.lock().unwrap_or_else(|e| e.into_inner()).clone()
        }

        /// Wait for an announcement, since the fetch settles on the runtime.
        fn reaches(&self, count: usize) -> bool {
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if self.seen().len() >= count {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            false
        }
    }

    impl EngineObserver for Bodies {
        fn sync_progress(&self) {}
        fn sync_settled(&self) {}
        fn body_stored(&self, kind: String, activity_id: String) {
            self.seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(format!("{kind}:{activity_id}"));
        }
        fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
        fn gps_track_stored(&self, _activity_id: String) {}
        fn fit_parsed(&self, _activity_id: String) {}
        fn detection_applied(&self) {}
        fn tiles_generated(&self) {}
        fn backfill_phase(&self, _phase: String) {}
        fn preview_phase(&self, _phase: String) {}
        fn cutover_settled(&self) {}
        fn preview_finished(&self) {}
    }

    fn init_global_engine() -> TempDir {
        crate::test_globals::init_global_engine("bodies.db")
    }

    /// Point the process-wide service at the mock server with a usable
    /// credential, so `spawn_once` builds a transport that reaches it.
    fn aim_service_at(server: &MockServer) {
        *SYNC_SERVICE
            .base_url
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = server.base_url();
        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "k".into(), "i1".into());
    }

    fn restore_service() {
        SYNC_SERVICE.clear_credentials();
        *SYNC_SERVICE
            .base_url
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = INTERVALS_BASE_URL.to_string();
    }

    /// Wait for the spawned fetch to settle. The job runs on the shared
    /// runtime, so the count is the only thing to watch it by.
    fn count_reaches(target: u64) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if bodies_stored() >= target {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    /// Give a settling fetch time to move the count when it should not, rather
    /// than reading it before the job has even started.
    fn count_stays_at(expected: u64) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if bodies_stored() != expected {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        true
    }

    #[test]
    fn an_intervals_body_that_lands_moves_the_count() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/activity/a1/intervals");
            then.status(200)
                .json_body(json!({"icu_intervals": [{"type": "WORK"}]}));
        });
        aim_service_at(&server);

        let before = bodies_stored();
        assert!(
            SyncManager::new()
                .sync_activity_intervals("a1".into())
                .started()
        );
        assert!(
            count_reaches(before + 1),
            "the interval body reached SQLite but the count never moved"
        );
        mock.assert();
        restore_service();
    }

    #[test]
    fn a_fetch_that_never_lands_leaves_the_count_alone() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a2/intervals");
            then.status(500);
        });
        aim_service_at(&server);

        let before = bodies_stored();
        assert!(
            SyncManager::new()
                .sync_activity_intervals("a2".into())
                .started()
        );
        assert!(
            count_stays_at(before),
            "a failed fetch stored nothing, so there is nothing to wake a reader for"
        );
        restore_service();
    }

    #[test]
    fn an_empty_calendar_window_still_counts_as_a_landing() {
        // Replacing a window with no events is a change: an event cancelled
        // upstream disappears here, and the screen showing it has to be told.
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/events");
            then.status(200).json_body(json!([]));
        });
        aim_service_at(&server);

        let before = bodies_stored();
        assert!(
            SyncManager::new()
                .sync_calendar_events("2026-01-01".into(), "2026-01-31".into())
                .started()
        );
        assert!(
            count_reaches(before + 1),
            "the emptied window never announced itself"
        );
        restore_service();
    }

    #[test]
    fn a_second_body_moves_the_count_again() {
        // One wake per landing. A count that only ever moves once leaves the
        // second screen on an empty chart.
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/b1/intervals");
            then.status(200).json_body(json!({"icu_intervals": []}));
        });
        server.mock(|when, then| {
            when.method(GET).path("/activity/b2/intervals");
            then.status(200).json_body(json!({"icu_intervals": []}));
        });
        aim_service_at(&server);

        let before = bodies_stored();
        let manager = SyncManager::new();
        assert!(manager.sync_activity_intervals("b1".into()).started());
        assert!(count_reaches(before + 1), "the first body never counted");
        assert!(manager.sync_activity_intervals("b2".into()).started());
        assert!(count_reaches(before + 2), "the second body never counted");
        restore_service();
    }

    #[test]
    fn a_write_that_fails_does_not_count() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();

        let before = bodies_stored();
        crate::runtime::block_on(store_body("fixture", String::new(), |_engine| {
            Err(rusqlite::Error::InvalidQuery)
        }));
        assert_eq!(
            bodies_stored(),
            before,
            "a store that failed left nothing for a reader to find"
        );
    }

    /// Scenario: the engine is destroyed while an on-demand fetch is in the
    /// air, so the bytes come back with nowhere to be written.
    ///
    /// Expected behaviour: the loss is counted and named. Both counts staying
    /// still is what made a dropped body and a body nobody asked for look the
    /// same in a log.
    #[test]
    fn a_body_with_no_engine_is_counted_and_named() {
        let _guard = serial_global_state();
        crate::test_log::capturing();
        *crate::persistence::PERSISTENT_ENGINE
            .write()
            .unwrap_or_else(|e| e.into_inner()) = None;

        let stored_before = bodies_stored();
        let discarded_before = bodies_discarded();
        crate::runtime::block_on(store_body("fixture", "gone-body".into(), |_engine| Ok(())));

        assert_eq!(
            bodies_stored(),
            stored_before,
            "nothing landed, so nothing may wake a reader"
        );
        assert_eq!(
            bodies_discarded(),
            discarded_before + 1,
            "the fetch happened and the bytes are gone, so the loss has a count"
        );
        let said = crate::test_log::warnings_with("gone-body");
        assert_eq!(said.len(), 1, "one warning naming the body: {said:?}");
        assert!(
            said[0].contains("fixture"),
            "the warning has to carry the kind: {}",
            said[0]
        );
    }

    /// A time stream is the same loss on a second path, and the scrubber it
    /// feeds is what goes missing.
    #[test]
    fn a_time_stream_with_no_engine_is_counted_and_named() {
        let _guard = serial_global_state();
        crate::test_log::capturing();
        *crate::persistence::PERSISTENT_ENGINE
            .write()
            .unwrap_or_else(|e| e.into_inner()) = None;

        let discarded_before = bodies_discarded();
        crate::runtime::block_on(store_time_stream("gone-stream".into(), vec![0, 1, 2]));

        assert_eq!(
            bodies_discarded(),
            discarded_before + 1,
            "a stream fetched with nowhere to put it is a loss like any other"
        );
        assert_eq!(
            crate::test_log::warnings_with("gone-stream").len(),
            1,
            "one warning naming the stream"
        );
    }

    /// A failed write is not a discard: the engine was there and answered, and
    /// the SQL error is already logged where it happened.
    #[test]
    fn a_failed_write_is_not_counted_as_a_discard() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();

        let before = bodies_discarded();
        crate::runtime::block_on(store_body("fixture", "sql-error".into(), |_engine| {
            Err(rusqlite::Error::InvalidQuery)
        }));
        assert_eq!(
            bodies_discarded(),
            before,
            "the engine answered, so this is a write that failed and not a body with nowhere to go"
        );
    }

    #[test]
    fn a_landed_body_announces_its_kind_and_activity() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/e1/intervals");
            then.status(200).json_body(json!({"icu_intervals": []}));
        });
        aim_service_at(&server);
        let recorder = Bodies::record();

        assert!(
            SyncManager::new()
                .sync_activity_intervals("e1".into())
                .started()
        );
        assert!(
            recorder.reaches(1),
            "the body landed but nothing announced it"
        );
        assert_eq!(recorder.seen(), vec!["intervals:e1"]);

        set_observer(None);
        restore_service();
    }

    #[test]
    fn a_body_with_no_activity_announces_an_empty_id() {
        // A curve is keyed by sport and window, not by activity, so the
        // reader gets the kind and nothing to scope it to.
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/power-curves.json");
            then.status(200).json_body(json!({"list": []}));
        });
        aim_service_at(&server);
        let recorder = Bodies::record();

        assert!(
            SyncManager::new()
                .sync_power_curve("Ride".into(), 42)
                .started()
        );
        assert!(
            recorder.reaches(1),
            "the curve landed but nothing announced it"
        );
        assert_eq!(recorder.seen(), vec!["power_curve:"]);

        set_observer(None);
        restore_service();
    }

    /// Scenario: the curve is cached verbatim under `(kind, sport, days, gap)`
    /// and every screen fetched its own window the first time it was opened,
    /// so a range the athlete never visited online read as "No power data"
    /// offline. Best Efforts All-time is the clearest case: 3650 is a window
    /// nothing else ever asks for.
    ///
    /// Expected behaviour: one sync step pulls every window for every sport
    /// the library carries, and the Run gap variant with them.
    mod curves {
        use super::*;
        use crate::governor::{Governor, NoopPolicy};
        use crate::persistence::bodies::CurveKind;
        use crate::persistence::with_persistent_engine;
        use crate::types::ActivityMetrics;

        fn transport_to(base: String) -> Transport {
            let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
            Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).expect("transport")
        }

        fn metric(id: &str, sport: &str) -> ActivityMetrics {
            ActivityMetrics {
                activity_id: id.to_string(),
                name: format!("{} {}", sport, id),
                date: 1_700_000_000,
                distance: 1000.0,
                moving_time: 600,
                elapsed_time: 600,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: sport.to_string(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }
        }

        fn library_of(sports: &[&str]) {
            let metrics = sports
                .iter()
                .enumerate()
                .map(|(i, sport)| metric(&format!("a{i}"), sport))
                .collect::<Vec<_>>();
            with_persistent_engine(move |engine| {
                engine.set_activity_metrics(metrics).expect("store metrics");
            })
            .expect("engine");
        }

        fn stored(kind: CurveKind, sport: &str, days: i64, gap: bool) -> Option<String> {
            with_persistent_engine(|engine| engine.get_curve_body(kind, sport, days, gap))
                .expect("engine")
                .expect("read")
        }

        fn never_cancelled() -> impl Fn() -> bool + Sync {
            || false
        }

        #[test]
        fn every_window_the_screens_can_ask_for_is_fetched_for_every_sport() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["Ride", "Swim"]);

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/power-curves.json");
                then.status(200).json_body(json!({"list": []}));
            });
            let pace = server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/pace-curves.json");
                then.status(200).json_body(json!({"list": []}));
            });

            let transport = transport_to(server.base_url());
            crate::runtime::block_on(sync_curves(&transport, "i1", &never_cancelled()))
                .expect("the sweep");

            let windows = CURVE_DAYS.len();
            power.assert_hits(windows * 2);
            pace.assert_hits(windows * 2);

            assert!(
                stored(CurveKind::Power, "Ride", 3650, false).is_some(),
                "Best Efforts All-time is the window nothing else fetches"
            );
            assert!(stored(CurveKind::Pace, "Swim", 42, false).is_some());
            restore_service();
        }

        #[test]
        fn running_takes_the_gradient_adjusted_pace_as_a_row_of_its_own() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["Run"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/power-curves.json");
                then.status(200).json_body(json!({"list": []}));
            });
            let gap = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/pace-curves.json")
                    .query_param("gap", "true");
                then.status(200).json_body(json!({"list": ["gap"]}));
            });
            server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/pace-curves.json");
                then.status(200).json_body(json!({"list": []}));
            });

            let transport = transport_to(server.base_url());
            crate::runtime::block_on(sync_curves(&transport, "i1", &never_cancelled()))
                .expect("the sweep");

            gap.assert_hits(CURVE_DAYS.len());
            assert!(
                stored(CurveKind::Pace, "Run", 42, true).is_some(),
                "the gap row is separate, and a switch flipped offline reads it"
            );
            assert!(stored(CurveKind::Pace, "Run", 42, false).is_some());
            restore_service();
        }

        #[test]
        fn an_empty_library_asks_for_nothing() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();

            let server = MockServer::start();
            let any = server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"list": []}));
            });

            let transport = transport_to(server.base_url());
            crate::runtime::block_on(sync_curves(&transport, "i1", &never_cancelled()))
                .expect("the sweep");

            any.assert_hits(0);
        }

        #[test]
        fn a_cancelled_sweep_stops_rather_than_finishing_the_sports() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["Ride"]);

            let server = MockServer::start();
            let any = server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"list": []}));
            });

            let transport = transport_to(server.base_url());
            crate::runtime::block_on(sync_curves(&transport, "i1", &|| true)).expect("the sweep");

            any.assert_hits(0);
        }

        #[test]
        fn a_refused_credential_ends_the_sweep_rather_than_being_carried() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["Ride"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET);
                then.status(401);
            });

            let transport = transport_to(server.base_url());
            let outcome =
                crate::runtime::block_on(sync_curves(&transport, "i1", &never_cancelled()));

            assert!(
                matches!(outcome, Err(NetError::Unauthorized)),
                "a dead credential is terminal, not one more failed window"
            );
        }

        #[test]
        fn one_window_that_fails_does_not_cost_the_others_their_bodies() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["Ride"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("curves", "3650d");
                then.status(500);
            });
            server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"list": []}));
            });

            let transport = transport_to(server.base_url());
            let outcome =
                crate::runtime::block_on(sync_curves(&transport, "i1", &never_cancelled()));

            assert!(outcome.is_err(), "a failed window is not a completed step");
            assert!(
                stored(CurveKind::Power, "Ride", 42, false).is_some(),
                "the windows that landed are still on disk"
            );
            restore_service();
        }
    }

    #[test]
    fn a_write_that_fails_announces_nothing() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let recorder = Bodies::record();

        crate::runtime::block_on(store_body("fixture", String::new(), |_engine| {
            Err(rusqlite::Error::InvalidQuery)
        }));

        assert!(
            recorder.seen().is_empty(),
            "a store that failed left nothing for a woken reader to find"
        );
        set_observer(None);
    }

    #[test]
    fn every_landing_announces_once() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let recorder = Bodies::record();

        crate::runtime::block_on(store_body("fixture", "f1".into(), |_engine| Ok(())));
        crate::runtime::block_on(store_body("fixture", "f2".into(), |_engine| Ok(())));

        assert_eq!(recorder.seen(), vec!["fixture:f1", "fixture:f2"]);
        set_observer(None);
    }

    #[test]
    fn only_a_completed_write_counts_as_a_landing() {
        // `None` is a cold start with nowhere to write and `Some(false)` is a
        // write that failed. Neither leaves a body for a woken reader to find.
        assert!(landed(Some(true)));
        assert!(!landed(Some(false)));
        assert!(!landed(None));
    }
}

/// Scenario: a write is refused with 401 and the foreign caller polls the
/// returned future itself, on a thread that is not a tokio context.
///
/// Expected behaviour: the confirmation reaches the profile, the session parks,
/// and the caller gets an `Unauthorized` outcome rather than a panic.
#[cfg(test)]
mod write_auth_tests {
    use super::*;
    use crate::test_globals::serial_global_state;
    use httpmock::prelude::*;

    fn aim_service_at(server: &MockServer) {
        *SYNC_SERVICE
            .base_url
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = server.base_url();
        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "k".into(), "i1".into());
    }

    fn restore_service() {
        SYNC_SERVICE.clear_credentials();
        SYNC_SERVICE.finish(SyncState::Idle, None, false);
        *SYNC_SERVICE
            .base_url
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = INTERVALS_BASE_URL.to_string();
    }

    /// Run the call the way uniffi's foreign executor does: on a plain thread
    /// that polls the future itself with no tokio runtime entered, so anything
    /// reaching the reactor inline panics instead of working.
    fn off_the_runtime<F>(call: F) -> FfiCallOutcome
    where
        F: FnOnce() -> FfiCallOutcome + Send + 'static,
    {
        std::thread::spawn(call)
            .join()
            .expect("the write panicked instead of reporting the refusal")
    }

    #[test]
    fn a_confirmed_refusal_parks_the_session_when_polled_off_the_runtime() {
        let _guard = serial_global_state();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a9");
            then.status(401);
        });
        let profile = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(401);
        });
        aim_service_at(&server);

        let outcome = off_the_runtime(|| {
            futures::executor::block_on(SyncManager::new().confirm_activity_uploaded("a9".into()))
        });

        assert_eq!(outcome.kind, FfiCallKind::Unauthorized);
        profile.assert();
        assert_eq!(SYNC_SERVICE.snapshot().state, SyncState::AuthExpired);
        restore_service();
    }

    /// Scenario: a token expires while a sync is running. An on-demand fetch
    /// confirms the 401 and parked the service by calling `finish`, which
    /// releases the running slot. A second sync then started on the dead
    /// token, and the first sync's own tail wrote `Idle` over `AuthExpired`,
    /// so the athlete was never told the session was gone.
    ///
    /// Expected behaviour: the park is a latch. It survives the running
    /// sync's own terminal transition, and nothing new begins behind it until
    /// a credential is set or cleared.
    #[test]
    fn a_park_survives_the_running_syncs_own_finish() {
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin(), "a sync is running");

        svc.park_auth_expired_now();
        assert_eq!(svc.snapshot().state, SyncState::AuthExpired);
        assert!(
            !svc.try_begin(),
            "nothing new starts on a credential already rejected"
        );

        // The run that was already going reaches its own end and reports it.
        svc.finish(SyncState::Idle, None, true);
        assert_eq!(
            svc.snapshot().state,
            SyncState::AuthExpired,
            "the parked state is not overwritten by the tail of the run it interrupted"
        );
        assert_eq!(
            svc.snapshot().last_error_reason,
            Some(FfiSyncErrorReason::Unauthorized)
        );
        assert!(!svc.try_begin(), "still parked after the run ended");
    }

    #[test]
    fn a_re_auth_releases_the_park_and_a_sign_out_does_too() {
        for sign_out in [false, true] {
            let svc = SyncService::new();
            svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
            assert!(svc.try_begin());
            svc.park_auth_expired_now();
            svc.finish(SyncState::Idle, None, true);
            assert!(!svc.try_begin());

            if sign_out {
                svc.clear_credentials();
            }
            svc.set_credentials(AuthKind::ApiKey, "fresh".into(), "i1".into());

            assert!(
                svc.try_begin(),
                "a credential the athlete just gave is not the one that was rejected"
            );
            assert_eq!(svc.snapshot().state, SyncState::Syncing);
        }
    }

    #[test]
    fn an_unconfirmed_refusal_leaves_the_session_standing() {
        let _guard = serial_global_state();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a9");
            then.status(401);
        });
        let profile = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(200).body("{}");
        });
        aim_service_at(&server);

        let outcome = off_the_runtime(|| {
            futures::executor::block_on(SyncManager::new().confirm_activity_uploaded("a9".into()))
        });

        assert_eq!(outcome.kind, FfiCallKind::Unauthorized);
        profile.assert();
        assert_ne!(SYNC_SERVICE.snapshot().state, SyncState::AuthExpired);
        restore_service();
    }
}

#[cfg(test)]
mod metrics_repair_tests {
    use super::*;
    use crate::test_globals::serial_global_state;
    use serde_json::json;

    /// Scenario: `sync_activity_window` writes the bodies and the metrics rows
    /// in one closure and only warns when the metrics write fails, so an
    /// activity can end up with a body and no metrics row. It is then absent
    /// from every aggregate that reads `activity_metrics`, which is the whole
    /// Health tab.
    ///
    /// Expected behaviour: the repair reads the bodies nothing holds metrics
    /// for and fills them from the stored payload, once per sync.
    #[test]
    fn a_body_stored_without_its_metrics_is_repaired_from_the_payload() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("metrics_repair.db");
        let raw = json!({
            "id": "i-77",
            "name": "Morning Ride",
            "type": "Ride",
            "start_date_local": "2026-01-02T08:00:00",
            "distance": 24_000.0,
            "moving_time": 3_600,
            "elapsed_time": 3_900,
            "total_elevation_gain": 310.0,
            "average_heartrate": 142.4,
            "icu_average_watts": 187.6,
            "icu_training_load": 62.0,
        })
        .to_string();
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .upsert_activity_bodies(&[("a77".to_string(), 1_767_340_800, raw)])
                .expect("body");
        })
        .expect("engine");

        let filled = crate::runtime::block_on(repair_missing_activity_metrics());

        assert_eq!(filled, 1, "the one body with no metrics row");
        let row = crate::persistence::with_persistent_engine(|engine| {
            engine.activity_metrics.get("a77").cloned()
        })
        .expect("engine")
        .expect("the repaired row");
        // Keyed by the row the body is stored under, not by the id inside the
        // payload: `sync_activity_window` remaps an uploaded activity's id to
        // the local key before it writes either table.
        assert_eq!(row.activity_id, "a77");
        assert_eq!(row.name, "Morning Ride");
        assert_eq!(row.date, 1_767_340_800);
        assert_eq!(row.moving_time, 3_600);
        assert_eq!(row.avg_hr, Some(142));
        assert_eq!(row.avg_power, Some(188));
        assert_eq!(row.training_load, Some(62.0));
    }

    /// A body that already has its metrics row is not rewritten. The repair
    /// runs on every sync, so a pass that rewrote the whole library would pay
    /// a full `activity_metrics` transaction each time.
    #[test]
    fn the_repair_leaves_a_body_that_already_has_its_metrics_alone() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("metrics_repair_noop.db");
        let raw = json!({
            "id": "a78",
            "name": "From the payload",
            "start_date_local": "2026-01-02T08:00:00",
        })
        .to_string();
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .upsert_activity_bodies(&[("a78".to_string(), 1_767_340_800, raw)])
                .expect("body");
            engine
                .set_activity_metrics(vec![activity_metrics_row(
                    serde_json::from_value(json!({"id": "a78", "name": "Already stored"}))
                        .expect("record"),
                    1_767_340_800,
                )])
                .expect("metrics");
        })
        .expect("engine");

        let filled = crate::runtime::block_on(repair_missing_activity_metrics());

        assert_eq!(filled, 0, "nothing is missing its metrics row");
        let row = crate::persistence::with_persistent_engine(|engine| {
            engine.activity_metrics.get("a78").cloned()
        })
        .expect("engine")
        .expect("the row it already had");
        assert_eq!(row.name, "Already stored");
    }

    /// A body that cannot be parsed back into a record is skipped and the rest
    /// of the sweep still lands. Failing the sweep on one unreadable payload
    /// would leave every other activity absent from the Health tab.
    #[test]
    fn an_unreadable_body_does_not_cost_the_sweep_the_rest() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("metrics_repair_junk.db");
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .upsert_activity_bodies(&[
                    ("a79".to_string(), 1_767_340_800, "not json".to_string()),
                    (
                        "a80".to_string(),
                        1_767_340_800,
                        json!({"id": "a80", "name": "Readable"}).to_string(),
                    ),
                ])
                .expect("bodies");
        })
        .expect("engine");

        let filled = crate::runtime::block_on(repair_missing_activity_metrics());

        assert_eq!(filled, 1, "the readable one");
        let row = crate::persistence::with_persistent_engine(|engine| {
            engine.activity_metrics.get("a80").cloned()
        })
        .expect("engine")
        .expect("the readable row");
        assert_eq!(row.name, "Readable");
    }
    /// The page write warns and carries on rather than failing, so nothing said
    /// whether the loss happens in the field. The counter on the warning is
    /// what says, and the repair runs on the rows it leaves behind.
    #[test]
    fn a_failed_page_metrics_write_is_counted() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("metrics_write_failure.db");
        let before = metrics_writes_failed();
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .execute_batch("DROP TABLE activity_metrics")
                .expect("drop the table the write needs");
            let row = activity_metrics_row(
                serde_json::from_value(json!({"id": "a81"})).expect("record"),
                1_767_340_800,
            );
            if let Err(e) = engine.set_activity_metrics(vec![row]) {
                metrics_write_failed(&e);
            } else {
                panic!("the write must fail with the table gone");
            }
        })
        .expect("engine");

        assert_eq!(metrics_writes_failed(), before + 1);
    }
}
