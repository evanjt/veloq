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

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::Arc;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Result as SqlResult;

use super::coverage::RangeCoverage;
use super::error::{VeloqError, with_reader};
use super::library::LibraryCoverage;
use super::observer;
use super::observer::Announcement;
use super::start::{FfiStartOutcome, FfiStartResult};
#[cfg(test)]
use crate::governor;
use crate::governor::{AuthMethod, Lane};
use crate::net::endpoints;
use crate::net::offline_prefetch::{CURVE_DAYS, CURVE_KEYS, CurveKey, curve_window};
use crate::net::transport::{NetError, Transport};
use crate::net::types::{ActivityRecord, ManualActivityBody};
use crate::persistence::PersistentEngine;
use crate::persistence::attempts::{Claim, JobKey, Release, now_ms};
use crate::persistence::bodies::CurveKind;

use super::record_dependency::fetch_owed_record_activities;

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

/// What making a date range available offline will cost, for the surface that
/// asks before it starts.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiOfflineEstimate {
    /// Activities stored in the range.
    pub activities: u32,
    /// Their moving seconds, which the byte figure scales on.
    pub moving_seconds: f64,
    /// Requests the pass will make.
    pub requests: u32,
    /// Bytes it will pull, as response bodies.
    pub bytes: f64,
}

/// The status fields TypeScript reads / subscribes to.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSyncStatus {
    pub state: SyncState,
    pub in_flight: u32,
    pub completed: u32,
    pub total: u32,
    /// Activities the running per-activity step has handled, of
    /// `step_items_total`. Both are zero for a step that is not a walk over
    /// activities, and between steps.
    pub step_items_done: u32,
    /// Activities the running per-activity step owes, read when it began.
    pub step_items_total: u32,
    /// Which endpoint the run is on, or `None` when nothing is running. The
    /// counters beside it count steps, so this is the only field that says
    /// what the sync is actually doing.
    pub step: Option<FfiSyncStep>,
    pub last_error: Option<String>,
    /// Which kind of failure the message describes, so the banner can render a
    /// translated line rather than the engine's own English.
    pub last_error_reason: Option<FfiSyncErrorReason>,
    /// When a run last finished clean, as a millisecond RFC 3339 instant in
    /// UTC. Read from the settings row each time, so a wipe or a restore is
    /// reflected with no copy to clear. `None` before any clean run.
    pub last_success_at: Option<String>,
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
    /// The engine went away while the run was going: a restore, or clear and
    /// sync. Whatever the run had fetched had nowhere to land, so the run is
    /// a failure however many steps had already succeeded.
    EngineClosed = 8,
}

/// Which endpoint a running sync is on, so the line an athlete reads names the
/// work rather than a counter.
///
/// The step is the engine's to report. `completed` counts steps that landed,
/// so a label derived from it in TypeScript lags by one for every step that
/// failed, and goes wrong outright the first time the order moves.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiSyncStep {
    /// The athlete profile: FTP, zones, the name on the settings screen.
    Athlete = 1,
    /// Per-sport settings, which the zone charts read.
    SportSettings = 2,
    /// A year of wellness rows.
    Wellness = 3,
    /// What the account holds against what is stored, which the window step
    /// reads to know what is still owed.
    Census = 4,
    /// The newest owed window, the step a first launch waits on: the standby
    /// lifts the moment its rows land.
    Activities = 5,
    /// The power and pace curves every fitness range charts.
    Curves = 6,
    /// Interval and lap bodies for the activities that have none.
    IntervalBodies = 7,
    /// The rest of the library, behind the profile slice. Its own step because
    /// it is the backfill rather than the thing the standby is waiting on.
    RemainingActivities = 8,
    /// The newest few activities by count, ahead of every window. The step a
    /// first launch actually waits on, since the window behind it spans the
    /// whole library.
    FirstActivities = 9,
    /// The older activities a restored backup names, fetched by id so its
    /// pins, cuts and history can land without waiting for the window.
    RecordActivities = 10,
    /// Planned workouts and notes in the forward calendar window.
    Calendar = 11,
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
            NetError::Io(_) | NetError::Storage(_) => FfiSyncErrorReason::Storage,
            NetError::EngineClosed => FfiSyncErrorReason::EngineClosed,
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
    /// The credential held belongs to a different athlete than the one the
    /// call was made for, so nothing was sent.
    OtherAthlete = 7,
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
            NetError::Decode(_)
            | NetError::Io(_)
            | NetError::Storage(_)
            | NetError::EngineClosed => (FfiCallKind::Internal, None, None),
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

struct SyncInner {
    state: SyncState,
    in_flight: u32,
    completed: u32,
    total: u32,
    step_items_done: u32,
    step_items_total: u32,
    step: Option<FfiSyncStep>,
    last_error: Option<String>,
    last_error_reason: Option<FfiSyncErrorReason>,
    /// The install the running job claimed its slot against, so a clean finish
    /// stamps the library it ran for and never one that replaced it.
    install: Option<u64>,
    running: bool,
    cancel: bool,
    /// A credential the profile confirmed as rejected. Set by the park and
    /// cleared only by a credential change, so the running sync's own
    /// terminal transition cannot write `Idle` over it and nothing new
    /// begins on the dead token.
    auth_expired: bool,
    /// What the running job was asked to do, kept so an interrupt can hand
    /// it back.
    running_request: Option<SyncRequest>,
    /// A restart waiting for the interrupted run to settle.
    resume: Option<PendingResume>,
}

/// What a sync was started for: the default pass, or one date window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SyncRequest {
    Full,
    Window { oldest: String, newest: String },
}

/// A run cut short by a partial clear, and whose athlete it belonged to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Interrupted {
    pub(crate) request: SyncRequest,
    athlete_id: String,
}

struct PendingResume {
    athlete_id: String,
    start: Box<dyn FnOnce() + Send>,
}

impl Default for SyncInner {
    fn default() -> Self {
        SyncInner {
            state: SyncState::Idle,
            in_flight: 0,
            completed: 0,
            total: 0,
            step_items_done: 0,
            step_items_total: 0,
            step: None,
            last_error: None,
            last_error_reason: None,
            install: None,
            running: false,
            cancel: false,
            auth_expired: false,
            running_request: None,
            resume: None,
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
    #[cfg(test)]
    fn try_begin(&self) -> bool {
        self.claim_slot().is_ok()
    }

    /// Claim the slot, or name why not: a parked credential or a held slot.
    ///
    /// Both are read under the one lock that claims. Read apart, a park
    /// landing between the two reads would answer `Busy` for a credential
    /// that no retry brings back.
    #[cfg(test)]
    fn claim_slot(&self) -> Result<(), FfiStartOutcome> {
        self.claim_slot_for(SyncRequest::Full)
    }

    fn claim_slot_for(&self, request: SyncRequest) -> Result<(), FfiStartOutcome> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.auth_expired {
            return Err(FfiStartOutcome::NotConfigured);
        }
        if inner.running {
            return Err(FfiStartOutcome::Busy);
        }
        inner.running = true;
        inner.install = Some(crate::persistence::engine_install());
        inner.running_request = Some(request);
        inner.cancel = false;
        inner.state = SyncState::Syncing;
        inner.total = 1;
        inner.in_flight = 1;
        inner.completed = 0;
        inner.last_error = None;
        inner.last_error_reason = None;
        Ok(())
    }

    /// Claim the slot and build the transport, naming why when either refuses.
    ///
    /// The two refusals are opposite situations, a slot held for a moment and a
    /// credential that is not there, and the caller's only sane reaction to
    /// them differs. Deciding it here keeps both starts honest and keeps the
    /// verdict out of the FFI methods, which cannot be tested without the
    /// global service.
    #[cfg(test)]
    fn try_start(&self) -> Result<(Transport, String), FfiStartOutcome> {
        self.try_start_for(SyncRequest::Full)
    }

    fn try_start_for(&self, request: SyncRequest) -> Result<(Transport, String), FfiStartOutcome> {
        self.claim_slot_for(request)?;
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
        inner.step = None;
        inner.step_items_done = 0;
        inner.step_items_total = 0;
        inner.in_flight = 1;
    }

    /// Name the step about to run, for the line that says what is happening.
    ///
    /// Set on entry rather than on completion, because the step an athlete is
    /// waiting on is the one in flight, not the one that just landed.
    fn begin_step(&self, step: FfiSyncStep) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.step = Some(step);
            inner.step_items_done = 0;
            inner.step_items_total = 0;
        }
        observer::notify(Announcement::SyncProgress);
    }

    /// Report how many activities the running step has handled of how many it
    /// owes, so a step that walks the library for minutes shows how far along
    /// it is.
    fn set_step_items(&self, done: u32, total: u32) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.step_items_done = done;
            inner.step_items_total = total;
        }
        observer::notify(Announcement::SyncProgress);
    }

    /// Advance the completed counter by one step.
    fn complete_step(&self) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.completed = (inner.completed + 1).min(inner.total);
        }
        observer::notify(Announcement::SyncProgress);
    }

    /// Terminal transition for a finished job. The one place a job ends, so it
    /// is the one place the settle is announced.
    pub fn finish(&self, state: SyncState, failure: Option<SyncFailure>, success: bool) {
        let stamp;
        let resume = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.running_request = None;
            let install = inner.install.take();
            let resume = inner.resume.take();
            // A park outlives whatever was running when it landed. Without
            // this the interrupted run's own tail wrote `Idle` over it and
            // the athlete was never told the session was gone.
            if inner.auth_expired && state != SyncState::AuthExpired {
                inner.running = false;
                inner.in_flight = 0;
                inner.step = None;
                drop(inner);
                observer::notify(Announcement::SyncSettled);
                return;
            }
            stamp = install.filter(|_| success && failure.is_none() && state == SyncState::Idle);
            inner.state = state;
            inner.running = false;
            inner.in_flight = 0;
            inner.step = None;
            inner.step_items_done = 0;
            inner.step_items_total = 0;
            if success {
                inner.completed = inner.total;
            }
            inner.last_error_reason = failure.as_ref().map(|f| f.reason);
            inner.last_error = failure.map(|f| f.message);
            // A parked credential starts nothing, so a waiting restart goes
            // with it.
            resume.filter(|_| !inner.auth_expired)
        };
        // After the service lock is released, since the engine lock is taken,
        // and before the settle is announced so a read on it sees the time.
        if let Some(install) = stamp {
            stamp_last_success(install);
        }
        observer::notify(Announcement::SyncSettled);
        if let Some(resume) = resume
            && self.still_signed_in(&resume.athlete_id)
        {
            (resume.start)();
        }
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

    /// Cancel as `request_cancel` does and hand back what was running, or
    /// `None` when nothing was. A partial clear calls this so the run it cuts
    /// short can be started again once the wipe has ended.
    pub(crate) fn interrupt(&self) -> Option<Interrupted> {
        let running = {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.running_request.clone()
        };
        let athlete_id = self.athlete_id();
        self.request_cancel();
        Some(Interrupted {
            request: running?,
            athlete_id: athlete_id?,
        })
    }

    /// Start again what `interrupt` cut short, once the wipe has ended.
    ///
    /// Starts nothing when the athlete signed out or changed, or when the
    /// credential is parked as rejected. While the cancelled run still holds
    /// the slot the start is parked and `finish` runs it, so the run it
    /// replaces cannot refuse it as busy.
    pub(crate) fn resume_after_clear(
        &self,
        interrupted: Interrupted,
        start: impl FnOnce() + Send + 'static,
    ) {
        if !self.still_signed_in(&interrupted.athlete_id) {
            return;
        }
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.auth_expired {
                return;
            }
            if inner.running {
                inner.resume = Some(PendingResume {
                    athlete_id: interrupted.athlete_id,
                    start: Box::new(start),
                });
                return;
            }
        }
        start();
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
            step_items_done: inner.step_items_done,
            step_items_total: inner.step_items_total,
            step: inner.step,
            last_error: inner.last_error.clone(),
            last_error_reason: inner.last_error_reason,
            last_success_at: read_last_success_at(),
        }
    }
}

/// The row a clean finish writes, from the read pool so it never waits on a
/// step holding the write lock.
fn read_last_success_at() -> Option<String> {
    crate::objects::error::with_reader(|conn| {
        crate::persistence::settings::setting_from(
            conn,
            crate::persistence::settings_keys::SYNC_LAST_SUCCESS_AT,
        )
        .ok()
        .flatten()
    })
    .ok()
    .flatten()
}

/// Record now as the last clean finish, against the install the run began on.
/// A closed engine or an install a wipe has moved past writes nothing.
fn stamp_last_success(install: u64) {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let written = crate::persistence::with_persistent_engine_for(install, |engine| {
        engine.set_setting(
            crate::persistence::settings_keys::SYNC_LAST_SUCCESS_AT,
            &now,
        )
    });
    if let Some(Err(e)) = written {
        log::warn!("veloqrs: [Sync] could not record the last clean sync: {e}");
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
/// state=Syncing and `claim_slot()` refuses every later sync for the session.
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

/// The id a URL upstream needs for a stored activity.
///
/// The key is ours; `intervals_id` is the server's. They are equal for every
/// row an older build stored, and a caller can name an activity no row claims,
/// so an unknown one falls back to the key it was given.
pub(crate) async fn upstream_id(install: u64, activity_id: &str) -> Option<String> {
    let key = activity_id.to_string();
    let stored = crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
        engine.intervals_id(&key)
    })
    .await
    .flatten();
    resolve_upstream(activity_id, stored)
}

/// The id a URL may name for `activity_id`, given the intervals id stored for
/// it. A device-minted key that no upload has named has no id upstream, so it
/// is never turned into a URL.
fn resolve_upstream(activity_id: &str, stored: Option<String>) -> Option<String> {
    match stored {
        Some(id) => Some(id),
        None if crate::persistence::activities::is_local_activity_key(activity_id) => None,
        None => Some(activity_id.to_string()),
    }
}

#[cfg(test)]
mod upstream_resolution_tests {
    use super::resolve_upstream;

    #[test]
    fn a_local_key_with_no_stored_server_id_names_nothing_upstream() {
        assert_eq!(resolve_upstream("local-ab12", None), None);
    }

    #[test]
    fn a_local_key_resolves_to_the_server_id_recorded_for_it() {
        assert_eq!(
            resolve_upstream("local-ab12", Some("i77".to_string())),
            Some("i77".to_string())
        );
    }

    #[test]
    fn a_server_key_with_no_row_falls_back_to_itself() {
        assert_eq!(resolve_upstream("i5", None), Some("i5".to_string()));
    }
}

/// `store_body_or_fail` with the outcome dropped, for tests that only read the
/// count or the announcement it leaves behind.
#[cfg(test)]
async fn store_body<F>(install: u64, kind: &'static str, activity_id: String, write: F)
where
    F: FnOnce(&mut PersistentEngine) -> SqlResult<()> + Send + 'static,
{
    let _ = store_body_or_fail(install, kind, activity_id, write).await;
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
///
/// The outcome is the caller's: a refused write is `NetError::Storage`, and an
/// absent engine is `EngineClosed`.
///
/// A step whose write found no engine used to count as a success: the run
/// reported `Idle` with no error and the health row stamped `lastSuccessAt`,
/// so a clear-and-sync or a restore mid-run left the athlete told the library
/// was fresh as of now while every remaining write had been dropped.
async fn store_body_or_fail<F>(
    install: u64,
    kind: &'static str,
    activity_id: String,
    write: F,
) -> Result<(), NetError>
where
    F: FnOnce(&mut PersistentEngine) -> SqlResult<()> + Send + 'static,
{
    let stored = crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
        write(engine).map_err(|e| {
            log::warn!("[Sync] {} store failed: {}", kind, e);
            e.to_string()
        })
    })
    .await;
    match stored {
        Some(Ok(())) => {
            BODIES_STORED.fetch_add(1, Ordering::Relaxed);
            observer::notify(Announcement::BodyStored {
                kind: kind.to_string(),
                activity_id,
            });
            Ok(())
        }
        // The write reached the engine and the engine refused it. Counting
        // that as a step that landed is what stamped `lastSuccessAt` on a run
        // whose page is not in the library.
        Some(Err(message)) => Err(NetError::Storage(format!("{kind} store failed: {message}"))),
        // No engine answered, so nothing was even attempted.
        None => {
            discarded(kind, &activity_id);
            Err(NetError::EngineClosed)
        }
    }
}

/// Store one activity's `time` stream, then tell whoever is waiting for it.
///
/// The announcement is made after the engine lock is released, and only when
/// the write landed in SQLite: a cold start has nowhere to put the stream, and a screen
/// told it had arrived would read a gap that is still there.
pub(crate) async fn store_time_stream(install: u64, activity_id: String, times: Vec<u32>) {
    let id = activity_id.clone();
    let stored = crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
        engine.set_time_streams_flat(&[id], &times, &[0])
    })
    .await;
    if let Some(persisted) = stored {
        if persisted.is_empty() {
            log::warn!("time_stream store failed for {activity_id}: not persisted");
        } else {
            observer::notify(Announcement::TimeStreamsStored(persisted));
        }
    } else {
        discarded("time_stream", &activity_id);
    }
}

/// How many leftover time streams are asked for at once, by the sync tail and by the
/// on-demand pass alike.
///
/// Only activities outside the stream retention window reach here: a widened
/// fetch carries `time` with the track and stores it there. The governor paces
/// the requests either way, so this bounds the memory a chunk holds rather
/// than the rate.
pub(crate) const TIME_STREAM_CONCURRENCY: usize = 25;

/// The walk over the activities missing a `time` stream, with the fetch, the
/// store and the sign-in read handed in so every stop condition can be
/// exercised without a transport.
///
/// The sign-in read is at the boundary and not only before the walk. The
/// transport was built before the job was spawned, so it carries a token the
/// athlete can sign out of part way through: a list of a hundred would
/// otherwise keep fetching on a revoked credential until it was exhausted,
/// spending the governor's budget and writing streams into a library that is
/// about to be cleared. Signing out is not a failure, so the pass ends `Ok`
/// and the job key releases rather than backing off against whoever signs in
/// next.
async fn drain_time_streams_with<S, F, Fut, St, StFut>(
    missing: Vec<String>,
    mut still_signed_in: S,
    mut fetch: F,
    mut store: St,
) -> Result<(), NetError>
where
    S: FnMut() -> bool,
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u32>, NetError>>,
    St: FnMut(String, Vec<u32>) -> StFut,
    StFut: std::future::Future<Output = ()>,
{
    for chunk in missing.chunks(TIME_STREAM_CONCURRENCY) {
        if !still_signed_in() {
            log::info!("[Sync] abandoning a time-stream pass, the athlete has signed out");
            return Ok(());
        }
        // The chunk is fetched together, so a long list costs one round trip
        // per chunk rather than one per activity. A wait on the whole pass
        // is bounded by the chunk count, not the list length.
        let fetched = futures::future::join_all(chunk.iter().map(|activity_id| {
            let request = fetch(activity_id.clone());
            async move { (activity_id.clone(), request.await) }
        }))
        .await;
        let mut unauthorized = false;
        for (activity_id, result) in fetched {
            match result {
                // An empty answer is stored too, as a zero-length row. This lane
                // asked for exactly one thing and upstream said there is none, so
                // the row records that the question was put. Dropping it left the
                // activity named by `get_activities_missing_time_streams` on every
                // pass for the life of the install, and left the section screens
                // waiting out `TIME_STREAM_TIMEOUT_MS` for an announcement that
                // never came.
                Ok(times) => store(activity_id, times).await,
                // One refusal speaks for the chunk: what already came back is
                // kept and nothing further is asked for.
                Err(NetError::Unauthorized) => unauthorized = true,
                // One activity without streams must not stop the batch; the
                // section list would stay stuck on "loading".
                Err(e) => log::warn!("[Sync] time stream {} failed: {}", activity_id, e),
            }
        }
        if unauthorized {
            return Err(NetError::Unauthorized);
        }
    }
    Ok(())
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
pub(crate) fn spawn_once<F, Fut>(key: JobKey, job: F) -> FfiStartResult
where
    F: FnOnce(u64, Transport, String) -> Fut + Send + 'static,
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
fn spawn_once_at<F, Fut, C>(key: JobKey, clock: C, job: F) -> FfiStartResult
where
    F: FnOnce(u64, Transport, String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<(), NetError>> + Send,
    C: Fn() -> i64 + Send + 'static,
{
    let now = clock();
    let Ok((transport, athlete_id)) = SYNC_SERVICE.build_transport() else {
        return FfiStartOutcome::NotConfigured.into();
    };
    // Which library this job belongs to, read on the calling thread, which is
    // the one that holds the engine. The lease and every write the job makes
    // belong to it, and a restore mid-fetch installs another.
    let install = crate::persistence::engine_install();
    let claim = crate::persistence::with_persistent_engine(|engine| engine.claim_job(&key, now));
    match claim {
        // The lease lives in the engine, so a start before it opens is early
        // rather than refused for a reason that will never lift.
        None => return FfiStartOutcome::NotReady.into(),
        Some(Err(e)) => {
            log::warn!("[Sync] could not claim {}: {}", key.as_str(), e);
            return FfiStartOutcome::NotReady.into();
        }
        Some(Ok(Claim::InFlight)) => return FfiStartOutcome::Busy.into(),
        // Not `Busy`: nothing else holds the key, the last attempt failed and
        // this one would too. `Held` is the taxonomy's answer for work a stage
        // that does finish is keeping back, and it is retryable.
        Some(Ok(Claim::BackingOff { until })) => {
            log::info!("[Sync] {} is backing off until {}", key.as_str(), until);
            return FfiStartResult::backing_off(until);
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
            install: u64,
        }
        impl<C: Fn() -> i64> Drop for ReleaseGuard<C> {
            fn drop(&mut self) {
                let release = std::mem::replace(&mut self.release, Release::Done);
                let at = (self.clock)();
                crate::persistence::with_persistent_engine_for(self.install, |engine| {
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
            install,
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
        guard.release = match job(install, transport, athlete_id).await {
            Ok(()) => Release::Done,
            Err(NetError::Unauthorized) => {
                park_auth_expired(&confirm_on, &confirm_for).await;
                Release::failed(FfiStartOutcome::NotConfigured, Some("unauthorized"))
            }
            Err(e) if e.is_network_absent() => {
                log::info!("[Sync] on-demand fetch had no network: {}", e);
                Release::Deferred
            }
            Err(e) => {
                log::warn!("[Sync] on-demand fetch failed: {}", e);
                Release::failed(FfiStartOutcome::Failed, Some(&e.to_string()))
            }
        };
    });
    FfiStartOutcome::Started.into()
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

/// Take the process-wide credential away, for a test of a path that has to
/// decline without one and may run after a test that left one standing.
#[cfg(test)]
pub(crate) fn clear_test_credentials() {
    SYNC_SERVICE.clear_credentials();
}

/// Point every transport the service builds at `base`, so a test can drive a
/// production entry point, and the profile check behind a 401, against a mock.
/// The guard puts the intervals.icu address back on drop. Take
/// `serial_global_state` first: the address is process-wide.
#[cfg(test)]
pub(crate) fn test_base_url(base: String) -> TestBaseUrl {
    *SYNC_SERVICE
        .base_url
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = base;
    TestBaseUrl
}

/// Hold the sync slot as a running default sync would, so a test can clear
/// under it. `SYNC_SERVICE.finish` settles it.
#[cfg(test)]
pub(crate) fn test_hold_sync_slot() {
    SYNC_SERVICE
        .claim_slot_for(SyncRequest::Full)
        .expect("nothing else holds the sync slot");
}

#[cfg(test)]
pub(crate) struct TestBaseUrl;

#[cfg(test)]
impl Drop for TestBaseUrl {
    fn drop(&mut self) {
        *SYNC_SERVICE
            .base_url
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = INTERVALS_BASE_URL.to_string();
    }
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

/// The credential JavaScript hands over once the library is open. Owed work
/// that was waiting on it starts here, so no caller has to remember to ask.
pub(crate) fn give_credentials(
    method: &str,
    secret: String,
    athlete_id: String,
) -> Result<(), VeloqError> {
    let kind = AuthKind::parse(method).ok_or(VeloqError::ParseError {
        msg: format!("unknown auth method: {}", method),
    })?;
    SYNC_SERVICE.set_credentials(kind, secret, athlete_id);
    crate::net::elevation_backfill::start_owed_work();
    Ok(())
}

pub fn current_transport() -> Option<Result<Transport, String>> {
    current_session().map(|r| r.map(|(t, _athlete)| t))
}

pub(crate) fn signed_in_athlete_id() -> Option<String> {
    SYNC_SERVICE.athlete_id()
}

/// Whether the process still holds a credential for this athlete.
pub(crate) fn still_signed_in(athlete_id: &str) -> bool {
    SYNC_SERVICE.still_signed_in(athlete_id)
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

/// Check a credential against `/athlete/me` and report the athlete it belongs
/// to, without storing it.
///
/// A free function because it touches no engine state: the base URL is the
/// process default until something sets it, the runtime is built on first use,
/// and nothing here opens the database. That is what lets a sign-in screen use
/// it on a fresh install, where no engine exists yet.
pub(crate) async fn validate_credentials_detached(
    method: String,
    secret: String,
) -> FfiCallOutcome {
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
    // A rejected candidate is not an expired session, so unlike a write this
    // deliberately leaves the service state alone.
    run_on_runtime(async move {
        endpoints::fetch_current_athlete(&transport, Lane::Interactive)
            .await
            .map(|athlete| Some(athlete.id))
    })
    .await
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

/// The refusal for a post made for one athlete while another is signed in.
///
/// The app checks the owner before it posts, but a sign-in can land in the
/// gap, and the engine posts with whatever credential it holds then. `None`
/// for a ride saved before rides carried their athlete: it has no owner to
/// compare and posts as it always did.
fn athlete_mismatch(held: &str, expected: Option<&str>) -> Option<FfiCallOutcome> {
    let expected = expected?;
    if expected == held {
        return None;
    }
    Some(FfiCallOutcome {
        kind: FfiCallKind::OtherAthlete,
        id: None,
        status: None,
        detail: None,
        message: "the signed-in athlete is not the one this was recorded for".to_string(),
    })
}

/// The athlete whose credential the service holds, `None` when it holds none.
pub(crate) fn signed_in_athlete() -> Option<String> {
    SYNC_SERVICE
        .creds
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|c| c.athlete_id.clone())
}

/// Upload a recorded activity file.
///
/// `expected_athlete_id` is the athlete the ride was recorded for. A
/// different credential held now refuses the call before anything is sent.
///
/// The FIT streams from `file_path`, so a long ride never lands in memory. The
/// call resolves when the server has answered; failures come back as an
/// outcome, not as an error.
pub(crate) async fn send_activity_file(
    expected_athlete_id: Option<String>,
    file_path: String,
    filename: String,
    external_id: String,
    name: Option<String>,
    description: Option<String>,
    paired_event_id: Option<i64>,
) -> FfiCallOutcome {
    run_write_for(
        expected_athlete_id,
        move |transport, athlete_id| async move {
            endpoints::upload_activity(
                &transport,
                &athlete_id,
                &file_path,
                &filename,
                endpoints::UploadDetails {
                    external_id: Some(&external_id),
                    name: name.as_deref(),
                    description: description.as_deref(),
                    paired_event_id,
                },
                Lane::Interactive,
            )
            .await
        },
    )
    .await
}

/// Create an activity with no file behind it, for indoor entries. See
/// `send_activity_file` for `expected_athlete_id`.
pub(crate) async fn send_manual_activity(
    expected_athlete_id: Option<String>,
    activity: ManualActivityBody,
) -> FfiCallOutcome {
    run_write_for(
        expected_athlete_id,
        move |transport, athlete_id| async move {
            endpoints::create_activity(&transport, &athlete_id, &activity, Lane::Interactive).await
        },
    )
    .await
}

/// Set the effort the athlete gave an uploaded ride, as its `icu_rpe`. It names
/// the activity the upload created, so a failure never sends the file again.
pub(crate) async fn send_activity_rpe(intervals_id: String, rpe: u32) -> FfiCallOutcome {
    run_write(move |transport, _athlete_id| async move {
        endpoints::update_activity_rpe(&transport, &intervals_id, rpe, Lane::Interactive)
            .await
            .map(|()| Some(intervals_id))
    })
    .await
}

/// Run a write against the held credential.
async fn run_write<F, Fut>(job: F) -> FfiCallOutcome
where
    F: FnOnce(Transport, String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<Option<String>, NetError>> + Send + 'static,
{
    run_write_for(None, job).await
}

/// Run a write against the held credential, refusing when it belongs to an
/// athlete other than `expected`.
async fn run_write_for<F, Fut>(expected: Option<String>, job: F) -> FfiCallOutcome
where
    F: FnOnce(Transport, String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<Option<String>, NetError>> + Send + 'static,
{
    let (transport, athlete_id) = match SYNC_SERVICE.build_transport() {
        Ok(pair) => pair,
        Err(e) => return FfiCallOutcome::internal(e.message),
    };
    if let Some(refusal) = athlete_mismatch(&athlete_id, expected.as_deref()) {
        return refusal;
    }
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
/// number it downloaded. Every accepted `sync_activities_window` ask widens
/// the window the engine records beyond this.
pub(crate) const ACTIVITY_DAYS: i64 = 90;

/// The steps `perform_sync` runs, for the progress counters TypeScript polls.
/// The activity pull is two of them: the newest owed window ahead of the
/// profile slice, the rest of the library behind it.
const SYNC_STEPS: u32 = 11;

/// The sync job: fetch the profile slice and write it into SQLite. Every step
/// is independent, so one failing endpoint does not cost the others their data.
/// A 401 is terminal, because no later step can succeed with a dead credential.
///
/// Free function over `&SyncService` so tests can drive it with a mock-server
/// transport against a local service instance.
pub(crate) async fn perform_sync(
    svc: &SyncService,
    install: u64,
    transport: Transport,
    athlete_id: String,
) {
    if svc.is_cancelled() || !svc.still_signed_in(&athlete_id) {
        svc.finish(SyncState::Idle, None, false);
        return;
    }
    svc.begin_steps(SYNC_STEPS);

    let mut last_error: Option<SyncFailure> = None;
    let cancelled = || svc.is_cancelled();

    macro_rules! step {
        ($step:expr, $body:expr) => {{
            if svc.is_cancelled() || !svc.still_signed_in(&athlete_id) {
                svc.finish(SyncState::Idle, last_error, false);
                return;
            }
            svc.begin_step($step);
            match $body {
                Ok(()) => {
                    svc.complete_step();
                    true
                }
                // The loop parks itself rather than calling
                // `park_auth_expired`: it holds its own service, which under
                // test is not the process-wide one, and it owes a terminal
                // finish either way. `park_auth_expired_now` is that finish
                // plus the latch, so a confirmed rejection refuses the next
                // `sync_now` rather than letting it spend a round trip on a
                // credential already known to be dead.
                Err(NetError::Unauthorized) => {
                    if credential_is_rejected(&transport, &athlete_id).await {
                        svc.park_auth_expired_now();
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
                Err(e) => {
                    let failure = SyncFailure::from(&e);
                    log::warn!("[Sync] {:?} step failed: {}", $step, failure.message);
                    last_error = Some(SyncFailure::new(
                        failure.reason,
                        format!("{:?}: {}", $step, failure.message),
                    ));
                    false
                }
            }
        }};
    }

    // The census first, because it is the input to everything behind it: the
    // windows ask it what is still owed. A census step that fails leaves them
    // on their fixed range, which is what ran before the census existed, so
    // the activities still land.
    let census_succeeded = step!(
        FfiSyncStep::Census,
        sync_activity_history_summary(install, &transport, &athlete_id).await
    );
    // Then the newest owed window on its own, ahead of the profile slice. The
    // first-launch standby lifts on the first stored activity
    // (`src/features/home/lib/feedEmptyState.ts`), so an endpoint asked for
    // before this one is a round trip the athlete spends on a spinner.
    let plan = owed_activity_windows(&athlete_id, census_succeeded).await;
    let windows = &plan.windows;
    // The newest few by count before any window, because the newest window is
    // the whole library on a first launch and the athlete waits on it.
    step!(
        FfiSyncStep::FirstActivities,
        sync_newest_activities(install, &transport, &athlete_id, windows, &cancelled).await
    );
    let (head, rest) = windows.split_at(windows.len().min(1));
    let spans_days = head.first().is_some_and(|w| w.range.0 != w.range.1);
    let head_landed = step!(
        FfiSyncStep::Activities,
        async {
            sync_activity_windows(install, &transport, &athlete_id, head, &cancelled).await?;
            // A window that is not a count-limited request ahead of this one
            // lands its rows here, so the newest five owe bodies only now. The
            // spanning case was readied behind its own request, and this
            // window has just replaced those detail bodies with list rows.
            if !spans_days {
                ready_newest_activities(install, &transport, &cancelled).await?;
            }
            Ok(())
        }
        .await
    );
    step!(
        FfiSyncStep::Athlete,
        sync_athlete(install, &transport, &athlete_id).await
    );
    step!(
        FfiSyncStep::SportSettings,
        sync_sport_settings(install, &transport, &athlete_id).await
    );
    step!(
        FfiSyncStep::Wellness,
        sync_wellness(install, &transport, &athlete_id).await
    );
    let (oldest, newest) = calendar_window();
    step!(
        FfiSyncStep::Calendar,
        fetch_and_store_calendar(install, &transport, &athlete_id, &oldest, &newest).await
    );
    // The rest of the library behind the profile slice, so a ninety-day
    // backfill does not hold the fitness and health screens on nothing.
    let rest_landed = step!(
        FfiSyncStep::RemainingActivities,
        sync_activity_windows(install, &transport, &athlete_id, rest, &cancelled).await
    );
    // A cancel stops the windows without an error, so it is read here too: a
    // refetch that stopped part way has not brought every body up to the set.
    if head_landed
        && rest_landed
        && !cancelled()
        && let Some(fields) = plan.fields.clone()
    {
        record_activity_fields(install, fields).await;
    }
    step!(
        FfiSyncStep::Curves,
        sync_curves(install, &transport, &athlete_id, &cancelled).await
    );
    step!(
        FfiSyncStep::IntervalBodies,
        sync_interval_bodies(install, &transport, &cancelled, &|done, total| {
            svc.set_step_items(done, total)
        })
        .await
    );
    step!(
        FfiSyncStep::RecordActivities,
        fetch_owed_record_activities(
            install,
            &transport,
            &athlete_id,
            &cancelled,
            &|done, total| { svc.set_step_items(done, total) }
        )
        .await
    );

    let success = last_error.is_none();
    crate::persistence::sections::conditioning::condition_pending_for_install(install);
    svc.finish(SyncState::Idle, last_error, success);
    if success {
        crate::net::stream_backfill::autostart_stream_backfill();
    }
}

/// The window job: fetch and store one date window of activities.
///
/// Free function over `&SyncService` for the same reason `perform_sync` is one,
/// so a test can drive the whole job against a local service instead of the
/// process-wide one.
pub(crate) async fn perform_window_sync(
    svc: &SyncService,
    install: u64,
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
    svc.begin_step(FfiSyncStep::Activities);
    let cancelled = || svc.is_cancelled();
    let owner = athlete_id.clone();
    let from = oldest.to_string();
    let through = newest.to_string();
    let owed = crate::persistence::with_persistent_engine_blocking(move |engine| {
        engine.owed_dates_in_window(&owner, &from, &through)
    })
    .await
    .flatten();
    let windows = owed.map_or_else(
        || vec![(oldest.into(), newest.into())],
        |days| owed_windows(&days),
    );
    let windows: Vec<_> = windows
        .into_iter()
        .map(|range| ActivityWindow {
            range,
            eligible_ids: None,
        })
        .collect();
    match sync_activity_windows(install, &transport, &athlete_id, &windows, &cancelled).await {
        Ok(()) if !svc.is_cancelled() => {
            svc.complete_step();
            svc.finish(SyncState::Idle, None, true);
        }
        Ok(()) => svc.finish(SyncState::Idle, None, false),
        Err(NetError::Unauthorized) => {
            // Latched, for the same reason the step loop latches: one confirmed
            // rejection is the answer for every caller until the credential
            // changes.
            if credential_is_rejected(&transport, &athlete_id).await {
                svc.park_auth_expired_now();
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
async fn sync_athlete(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
) -> Result<(), NetError> {
    let body = endpoints::fetch_athlete_body(transport, athlete_id, Lane::Interactive).await?;
    // A dropped write leaves the previous athlete's profile, FTP and zones
    // standing with nothing to say so, and the step above counts as done. The
    // helper reports all three outcomes, so this needs no mapping of its own.
    store_body_or_fail(install, "athlete profile", String::new(), move |engine| {
        engine.set_athlete_profile(&body)
    })
    .await
}

/// Persist the sport settings body.
async fn sync_sport_settings(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
) -> Result<(), NetError> {
    let body =
        endpoints::fetch_sport_settings_body(transport, athlete_id, Lane::Interactive).await?;
    store_body_or_fail(install, "sport settings", String::new(), move |engine| {
        engine.set_sport_settings(&body)
    })
    .await
}

/// `start_date_local` as epoch seconds. intervals.icu sends local wall-clock
/// with no zone, which is how the rest of the app already treats it.
pub(crate) fn start_date_to_timestamp(start_date_local: Option<&str>) -> Option<i64> {
    let raw = start_date_local?;
    let trimmed = raw.split('.').next().unwrap_or(raw);
    chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S")
        .ok()
        .map(|dt| dt.and_utc().timestamp())
}

/// One requested range and the fetched activity ids it may store.
#[derive(Debug)]
struct ActivityWindow {
    range: (String, String),
    eligible_ids: Option<HashSet<String>>,
}

/// The date windows the activity pull owes, newest first.
///
/// Read after the census step, because the census is its input: it says which
/// days inside the span the device does not already hold. `None` is the
/// census being unable to answer, which is a fresh install or a failed read,
/// and then the fixed window is what runs, exactly as before it existed.
///
/// When the stored bodies were fetched with another field set than this
/// build asks for, the plan also refetches every stored activity once. The
/// census cannot say so: it tracks what changed upstream, and a field the
/// request newly names changed nothing there.
async fn owed_activity_windows(athlete_id: &str, census_succeeded: bool) -> ActivityPlan {
    let newest = chrono::Local::now().date_naive();
    let oldest = newest - chrono::Duration::days(ACTIVITY_DAYS);
    let whole = (oldest.to_string(), newest.to_string());
    let fixed = || ActivityPlan {
        windows: vec![ActivityWindow {
            range: whole.clone(),
            eligible_ids: None,
        }],
        fields: None,
    };
    if !census_succeeded {
        return fixed();
    }

    let owed = {
        let athlete = athlete_id.to_string();
        let (oldest, newest) = whole.clone();
        crate::persistence::with_persistent_engine_blocking(move |engine| {
            let mut dates = engine.owed_dates_in_window(&athlete, &oldest, &newest)?;
            let fetched = engine.fetched_activity_days(&athlete)?;
            let fields = engine
                .get_setting(crate::persistence::settings_keys::ACTIVITY_BODY_FIELDS)
                .map_err(|e| log::warn!("[Sync] field set read failed: {e}"))
                .ok()?;
            dates.sort();
            dates.dedup();
            Some((dates, fetched, fields))
        })
        .await
        .flatten()
    };
    let Some((dates, fetched, stored_fields)) = owed else {
        return fixed();
    };
    let mut old_ids: BTreeMap<String, HashSet<String>> = BTreeMap::new();
    let mut old_changes = BTreeSet::new();
    for (day, id, changed) in &fetched {
        if *day < whole.0 && *changed {
            old_changes.insert(day.clone());
            old_ids.entry(day.clone()).or_default().insert(id.clone());
        }
    }
    let old_changes: Vec<_> = old_changes.into_iter().collect();
    let mut windows: Vec<_> = owed_windows(&dates)
        .into_iter()
        .map(|range| ActivityWindow {
            range,
            eligible_ids: None,
        })
        .collect();
    windows.extend(owed_runs(&old_changes).into_iter().map(|range| {
        let eligible_ids = old_ids
            .range(range.0.clone()..=range.1.clone())
            .flat_map(|(_, ids)| ids.iter().cloned())
            .collect();
        ActivityWindow {
            range,
            eligible_ids: Some(eligible_ids),
        }
    }));
    windows.sort_by(|left, right| right.range.1.cmp(&left.range.1));

    // Behind everything the census owes, so the head is still the newest
    // owed window and a refetch never delays a new ride.
    let current = crate::net::types::stored_activity_fields();
    let fields = (stored_fields.as_deref() != Some(current.as_str())).then_some(current);
    if fields.is_some() {
        let covered: BTreeSet<String> = fetched
            .iter()
            .filter(|(day, id, _)| {
                dates.binary_search(day).is_ok()
                    || old_ids.get(day).is_some_and(|ids| ids.contains(id))
            })
            .map(|(_, id, _)| id.clone())
            .collect();
        windows.extend(refetch_windows(&fetched, &covered));
    }
    ActivityPlan { windows, fields }
}

/// The windows a launch sync asks for, and the field set to record once every
/// one of them has landed.
#[derive(Debug)]
struct ActivityPlan {
    windows: Vec<ActivityWindow>,
    /// The build's field set when the stored bodies were fetched with another,
    /// so the windows include a refetch of every stored activity.
    fields: Option<String>,
}

/// The widest span one refetch window covers, in days.
///
/// The census owes nothing on a library it agrees with, so a refetch is every
/// stored activity at once. One request for all of them would carry the whole
/// history in a single body, and one per run of days would be a request per
/// ride for someone who rides every other day. The launch window is ninety
/// days, so this asks for no more per request than a first launch does.
const REFETCH_SPAN_DAYS: i64 = 90;

/// Windows over every fetched activity not already covered, each limited to
/// the ids it refetches, newest first.
///
/// Limited to those ids because the span also holds activities this device
/// never downloaded, and storing them would mark them fetched without the
/// athlete having asked for that range. A day that does not parse is its own
/// window, as in `owed_runs`.
fn refetch_windows(
    fetched: &[(String, String, bool)],
    covered: &BTreeSet<String>,
) -> Vec<ActivityWindow> {
    let mut days: Vec<(&str, &str)> = fetched
        .iter()
        .filter(|(_, id, _)| !covered.contains(id))
        .map(|(day, id, _)| (day.as_str(), id.as_str()))
        .collect();
    days.sort();
    let mut windows: Vec<ActivityWindow> = Vec::new();
    let mut first: Option<chrono::NaiveDate> = None;
    for (day, id) in days {
        let parsed = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok();
        let continues = match (parsed, first) {
            (Some(today), Some(start)) => (today - start).num_days() < REFETCH_SPAN_DAYS,
            _ => false,
        };
        match windows.last_mut() {
            Some(window) if continues => {
                window.range.1 = day.to_string();
                if let Some(ids) = window.eligible_ids.as_mut() {
                    ids.insert(id.to_string());
                }
            }
            _ => {
                windows.push(ActivityWindow {
                    range: (day.to_string(), day.to_string()),
                    eligible_ids: Some(HashSet::from([id.to_string()])),
                });
                first = parsed;
            }
        }
    }
    windows.reverse();
    windows
}

/// Record that the stored bodies carry `fields`, once every window of the
/// refetch landed. A write that fails leaves the old set, so the next sync
/// refetches again rather than reading as done.
async fn record_activity_fields(install: u64, fields: String) {
    let written = crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
        engine.set_setting(
            crate::persistence::settings_keys::ACTIVITY_BODY_FIELDS,
            &fields,
        )
    })
    .await;
    if let Some(Err(e)) = written {
        log::warn!("[Sync] field set write failed: {e}");
    }
}

/// Persist the given activity windows: aggregate metrics for Rust, plus the
/// untyped body per activity for the screens. No GPS required, so activities
/// that never reach the `activities` table still show up in the feed.
///
/// `perform_sync` calls this twice, the head window and then the rest, so the
/// repair sweep runs per call rather than per sync. The head's rows are what
/// the feed reads first and an activity that lost its metrics row is absent
/// from every aggregate until something fills it. The sweep's ordinary answer
/// is an empty list, so the second call costs one indexed read.
async fn sync_activity_windows(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    windows: &[ActivityWindow],
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<(), NetError> {
    let mut stored = false;
    for window in windows {
        if cancelled() {
            break;
        }
        // The outcome is dropped because the loop's own gate owns the terminal
        // state: an abandoned window is followed by a step check that finishes
        // the job unsuccessfully, so reporting it twice would say nothing new.
        let outcome =
            sync_planned_activity_window(install, transport, athlete_id, window, None, cancelled)
                .await?;
        stored |= outcome == WindowOutcome::Stored;
    }
    // After the windows, so a page whose metrics write failed a moment ago is
    // repaired by the same sync rather than by the next one. Nothing was
    // written for an abandoned window, so there is nothing new to repair.
    if stored {
        repair_missing_activity_metrics(install).await;
        // Here rather than at the settle, because the head window is the whole
        // point of running first: its rows are in SQLite and nothing else in
        // the job will write an activity for as long as the profile slice, the
        // curves and the owed interval bodies take. Announced once per step
        // rather than once per window, since every reader on the `activities`
        // channel re-reads its whole range on one.
        observer::notify(Announcement::ActivitiesStored);
    }
    Ok(())
}

/// How many of the newest activities the first request asks for, by count.
///
/// Five, because that is what fills the feed's first screen, and because the
/// point is a round trip the athlete does not wait out rather than a slice of
/// the library. Everything else about the sync is unchanged behind it: the
/// window that spans these five runs next and upserts the same rows.
///
/// A count is possible at all because the endpoint takes `limit` beside the
/// date range and answers newest first, measured against the real API on
/// 2026-09-20. The head window below is counted in owed days because that is
/// what the census answers in, which was taken at the time to rule a count
/// out entirely.
const FIRST_USE_ACTIVITIES: u32 = 5;

/// The newest few activities, ahead of the window they sit in.
///
/// A fresh install owes one run of days, which collapses to a single window
/// covering the whole library, so the step that lifts the standby was a
/// request for everything. Five minutes into a first launch the OnePlus was
/// still on curves at 6 of 8 with no card on screen.
///
/// Asked for only when the newest owed window spans more than a day. An
/// ordinary launch owes one day, and a count-limited request there would fetch
/// the rows the window is about to fetch anyway, for a second round trip that
/// buys nothing.
async fn sync_newest_activities(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    windows: &[ActivityWindow],
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<(), NetError> {
    // Readiness is owed by the bodies the newest rows still lack, not by the
    // summary windows: a failed body leaves the census advanced, so the next
    // sync owes no window at all and would otherwise never ask again.
    let Some(window) = windows.first().filter(|w| w.range.0 != w.range.1) else {
        return ready_newest_activities(install, transport, cancelled).await;
    };
    let outcome = sync_planned_activity_window(
        install,
        transport,
        athlete_id,
        window,
        Some(FIRST_USE_ACTIVITIES),
        cancelled,
    )
    .await?;
    if outcome == WindowOutcome::Stored {
        // The whole point of the step: the rows are in SQLite and the feed can
        // paint. Everything behind this is minutes on a fresh library.
        repair_missing_activity_metrics(install).await;
        observer::notify(Announcement::ActivitiesStored);
    }
    ready_newest_activities(install, transport, cancelled).await
}

/// The series the detail screen reads, as the key its stored body sits under.
///
/// Sorted and comma-joined exactly as the front end's `streamTypesKey` builds
/// it from `DETAIL_STREAM_TYPES`, which is what makes the body fetched here the
/// one the screen finds. A contract test holds the two together.
const DETAIL_STREAM_TYPES_KEY: &str = "altitude,cadence,distance,fixed_altitude,ga_velocity,\
     grade_smooth,heartrate,latlng,temp,time,velocity_smooth,w_bal,watts";

/// Whether the server's answer ends the wait for a body rather than failing
/// it: the resource does not exist or is gone, and asking again will not
/// change that.
fn is_permanently_unavailable(error: &NetError) -> bool {
    matches!(error, NetError::Http { status, .. } if matches!(*status, 404 | 410))
}

/// The bodies the server has answered 404 or 410 for, by install.
///
/// Nothing is stored for an absent body, so without this every sync would ask
/// for it again for as long as the activity is among the newest. It is kept
/// for the life of the process, which bounds the repeat to one probe per
/// launch, and a wipe moves the install so a new library starts clean.
static KNOWN_ABSENT_BODIES: LazyLock<Mutex<HashSet<AbsentBody>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

type AbsentBody = (u64, String, &'static str);

fn is_known_absent(install: u64, activity_id: &str, kind: &'static str) -> bool {
    KNOWN_ABSENT_BODIES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(&(install, activity_id.to_string(), kind))
}

fn note_known_absent(install: u64, activity_id: &str, kind: &'static str) {
    KNOWN_ABSENT_BODIES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert((install, activity_id.to_string(), kind));
}

/// Bring each of the newest activities to what opens with no network: the
/// detail body, the detail streams (which carry the track) and the intervals.
///
/// Runs inside the first-use step, once the rows have landed and before the
/// window behind them, the profile slice or any bulk request, so an athlete
/// who loses the connection right after the first screen can open any of the
/// five. What each activity lacks is derived from SQLite, so a pass cut short
/// resumes on what is still owed. A successful empty body is stored and counts
/// as ready; a 404 or 410 ends that body's wait and stores nothing. Any other
/// failure leaves the activity's other bodies to be fetched and fails the
/// step, so the next sync asks again.
async fn ready_newest_activities(
    install: u64,
    transport: &Transport,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<(), NetError> {
    let owed = crate::persistence::with_persistent_engine_blocking_for(install, |engine| {
        engine
            .newest_activities_owing_bodies(FIRST_USE_ACTIVITIES as usize, DETAIL_STREAM_TYPES_KEY)
    })
    .await
    .ok_or(NetError::EngineClosed)?
    .map_err(|e| NetError::Storage(format!("first-use queue read failed: {e}")))?;

    let mut last_error: Option<NetError> = None;
    for gap in owed {
        if cancelled() {
            return Ok(());
        }
        let Some(upstream) = upstream_id(install, &gap.activity_id).await else {
            continue;
        };
        let id = gap.activity_id.clone();
        let mut outcomes: Vec<Result<(), NetError>> = Vec::new();
        let absent = |kind: &'static str| is_known_absent(install, &id, kind);
        let mut kinds: Vec<&'static str> = Vec::new();
        if gap.detail && !absent("detail") {
            kinds.push("detail");
            outcomes.push(ready_detail_body(install, transport, &id, &upstream).await);
        }
        if gap.streams && !absent("streams") {
            kinds.push("streams");
            let fetched = endpoints::fetch_streams_body(
                transport,
                &upstream,
                DETAIL_STREAM_TYPES_KEY,
                Lane::Backfill,
            )
            .await;
            outcomes.push(match fetched {
                Ok(body) => {
                    // The track is stored before the body, so a pass cut short
                    // between the two leaves the body owed and the next sync
                    // fetches both again.
                    match ingest_first_use_track(install, &id, &gap.sport_type, &body) {
                        Ok(()) => {
                            let id = id.clone();
                            store_body_or_fail(install, "streams", id.clone(), move |engine| {
                                engine.set_stream_body(&id, DETAIL_STREAM_TYPES_KEY, &body)
                            })
                            .await
                        }
                        Err(e) => Err(e),
                    }
                }
                Err(e) => Err(e),
            });
        }
        if gap.track {
            // The body is held, so no request is made: ingest it so the track
            // does not depend on the raw body cache keeping it.
            kinds.push("track");
            let held = {
                let id = id.clone();
                crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
                    engine.get_stream_body(&id, DETAIL_STREAM_TYPES_KEY)
                })
                .await
            };
            outcomes.push(match held {
                Some(Ok(Some(body))) => {
                    ingest_first_use_track(install, &id, &gap.sport_type, &body)
                }
                Some(Ok(None)) => Ok(()),
                Some(Err(e)) => Err(NetError::Storage(format!(
                    "first-use stream body read failed: {e}"
                ))),
                None => Err(NetError::EngineClosed),
            });
        }
        if gap.intervals && !absent("intervals") {
            kinds.push("intervals");
            let fetched =
                endpoints::fetch_intervals_body(transport, &upstream, Lane::Backfill).await;
            outcomes.push(match fetched {
                Ok(body) => {
                    let id = id.clone();
                    store_body_or_fail(install, "intervals", id.clone(), move |engine| {
                        engine.set_interval_body(&id, &body)
                    })
                    .await
                }
                Err(e) => Err(e),
            });
        }
        for (kind, outcome) in kinds.into_iter().zip(outcomes) {
            match outcome {
                Err(NetError::Unauthorized) => return Err(NetError::Unauthorized),
                Err(e) if is_permanently_unavailable(&e) => note_known_absent(install, &id, kind),
                Err(e) => last_error = Some(e),
                Ok(()) => {}
            }
        }
    }
    match last_error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Store the track, time series and stream series a fetched streams body
/// carries, and attach the activity to the catalogue, so the activity opens
/// with its map and processed detail without the bulk GPS job.
///
/// The raw body cache evicts, so it cannot be where the only copy of the
/// coordinates lives. A body with no track (an indoor ride, one too short to
/// be a line) is a final answer and succeeds with nothing stored; a body that
/// does not decode fails, so the next sync asks again.
fn ingest_first_use_track(
    install: u64,
    activity_id: &str,
    sport_type: &str,
    body: &str,
) -> Result<(), NetError> {
    let result = crate::http::track_from_streams_body(activity_id, body.as_bytes(), true);
    let coords = match crate::ffi::usable_track(&result) {
        Ok(coords) => coords,
        Err(refusal) if crate::ffi::counts_as_failure(&refusal) => {
            return Err(NetError::Storage(format!(
                "first-use streams for {activity_id} did not decode: {refusal:?}"
            )));
        }
        Err(_) => return Ok(()),
    };
    match crate::ffi::store_track(
        install,
        activity_id,
        coords,
        crate::persistence::ElevationSeries::upstream(result.elevation_corrected),
        sport_type.to_string(),
        &result.streams,
        &result.times,
        true,
    ) {
        Some((true, _, _)) => Ok(()),
        Some((false, _, _)) => Err(NetError::Storage(format!(
            "first-use track for {activity_id} was not stored"
        ))),
        None => Err(NetError::EngineClosed),
    }
}

/// Fetch and store one activity's detail body, replacing the list row.
async fn ready_detail_body(
    install: u64,
    transport: &Transport,
    activity_id: &str,
    upstream: &str,
) -> Result<(), NetError> {
    let body = endpoints::fetch_activity_body(transport, upstream, Lane::Backfill).await?;
    let Some(date) = detail_body_date(&body) else {
        return Ok(());
    };
    let id = activity_id.to_string();
    store_body_or_fail(install, "activity_detail", id.clone(), move |engine| {
        engine.store_activity_detail_body(&id, date, &body)
    })
    .await
}

/// The start of an activity's detail body as epoch seconds, or `None` when the
/// body carries no date that parses.
fn detail_body_date(body: &str) -> Option<i64> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("start_date_local")
        .and_then(|d| d.as_str())
        .and_then(|d| start_date_to_timestamp(Some(d)))
}

/// How many of the newest owed days the collapsed case asks for on its own,
/// before the spanning window behind it.
///
/// Counted in owed days rather than calendar days or activities, because the
/// census answers in distinct dates: ten of them is ten to twenty activities
/// for someone who rides most days, and reaches further back for someone who
/// rides monthly. Either way the feed has cards from the first request instead
/// of waiting out the whole span.
const HEAD_OWED_DAYS: usize = 10;

/// The head has to fit inside what the collapse holds, or the index below it
/// walks off the front. Both are compile-time, so this is caught at build time
/// rather than by a runtime branch no test could ever reach.
const _: () = assert!(HEAD_OWED_DAYS < MAX_OWED_WINDOWS);

/// Past this many separate windows, ask for one spanning window instead.
///
/// A library with holes scattered through the year would otherwise be one
/// request per hole, and the request that replaces them is the one the sync
/// made before the census existed. So the scattered case is never worse than
/// today by more than this many requests.
const MAX_OWED_WINDOWS: usize = 30;

/// Group owed days into the fewest windows that cover them, newest first.
///
/// One window per run of consecutive days: an unchanged library asks for
/// nothing, one new ride is a one-day window, and a fresh install is the one
/// window it is today. Days arrive ascending and as `YYYY-MM-DD`; a day that
/// does not parse is its own window rather than being dropped, since the
/// alternative is not downloading it at all.
///
/// The runs come back newest first because the sync walks them in order and
/// the feed reads newest first. Ascending, a fresh install spent its first
/// minutes downloading the oldest end of the 90 days while the top of the
/// feed, which is what the athlete is looking at, filled last.
fn owed_runs(days: &[String]) -> Vec<(String, String)> {
    let mut runs: Vec<(String, String)> = Vec::new();
    let mut last: Option<chrono::NaiveDate> = None;
    for day in days {
        let parsed = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok();
        let continues = match (parsed, last) {
            (Some(today), Some(previous)) => today == previous + chrono::Duration::days(1),
            _ => false,
        };
        match runs.last_mut() {
            Some(run) if continues => run.1 = day.clone(),
            _ => runs.push((day.clone(), day.clone())),
        }
        last = parsed;
    }
    runs.reverse();
    runs
}

fn owed_windows(days: &[String]) -> Vec<(String, String)> {
    let runs = owed_runs(days);
    if runs.len() > MAX_OWED_WINDOWS {
        // The collapse keeps a head. One spanning window meant nothing at all
        // landed until the whole span did, which on a fresh install is the
        // ninety days: a feed of download icons and a zero summary card for as
        // long as that took. The newest owed days come first as their own
        // window, so the feed has cards after the first request, and the rest
        // follows behind it.
        let newest = runs.first().expect("checked non-empty").1.clone();
        let oldest = runs.last().expect("checked non-empty").0.clone();
        let head_start = days[days.len() - HEAD_OWED_DAYS].clone();
        // The remainder ends where the head begins rather than the day before
        // it: one overlapping day costs nothing, and stepping back a day would
        // have to know the calendar to do it.
        return vec![(head_start.clone(), newest), (oldest, head_start)];
    }
    runs
}

#[cfg(test)]
#[path = "tests/sync_window.rs"]
mod sync_window_tests;

/// Seconds in power zones Z1 to Z7, placed by the id the server sent. The series
/// also carries a sweet-spot entry that is not a zone, so a position would put it
/// in a zone slot whenever it is not last. An entry with no id falls back to its
/// position.
fn power_zone_seconds(zones: &[crate::net::types::ZoneTime]) -> Vec<u32> {
    let mut out = vec![0u32; crate::persistence::fitness::ZONE_COLUMNS];
    for (position, zone) in zones.iter().enumerate() {
        let slot = match zone.id.as_deref() {
            Some(id) => id
                .strip_prefix('Z')
                .and_then(|n| n.parse::<usize>().ok())
                .and_then(|n| n.checked_sub(1)),
            None => Some(position),
        };
        if let Some(slot) = slot.filter(|&s| s < out.len()) {
            out[slot] = zone.secs.unwrap_or(0).max(0) as u32;
        }
    }
    out
}

/// One activity's metrics row from the record the page carried. The stats
/// fields ride the same response, so the row is complete when it is written
/// and nothing has to read the body back to fill it in.
pub(crate) fn activity_metrics_row(record: ActivityRecord, date: i64) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: record.id,
        name: record.name.unwrap_or_default(),
        date,
        distance: record.distance.unwrap_or(0.0),
        moving_time: record.moving_time.unwrap_or(0).max(0) as u32,
        elapsed_time: record.elapsed_time.unwrap_or(0).max(0) as u32,
        elevation_gain: record.total_elevation_gain.unwrap_or(0.0),
        avg_hr: record.average_heartrate.map(|v| v.round() as u16),
        avg_power: record.icu_average_watts.map(|v| v.round() as u16),
        sport_type: record.activity_type.unwrap_or_else(|| "Ride".to_string()),
        training_load: record.icu_training_load,
        ftp: record.icu_ftp.map(|v| v.round().max(0.0) as u16),
        power_zone_times: record
            .icu_zone_times
            .map(|zones| power_zone_seconds(&zones)),
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
    /// The window was asked for and the server held nothing in it. The job
    /// did what it was asked, so it is not an abandonment, but no row was
    /// written and nothing reads differently for it: a repair sweep and an
    /// announcement both cost every reader its whole range for no change.
    Empty,
    Abandoned,
}

/// Persist one date window of activities. The default sync covers 90 days; the
/// feed asks for older windows as the reader scrolls past it.
#[cfg(test)]
async fn sync_activity_window(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    limit: Option<u32>,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<WindowOutcome, NetError> {
    let window = ActivityWindow {
        range: (oldest.to_string(), newest.to_string()),
        eligible_ids: None,
    };
    sync_planned_activity_window(install, transport, athlete_id, &window, limit, cancelled).await
}

async fn sync_planned_activity_window(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    window: &ActivityWindow,
    limit: Option<u32>,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<WindowOutcome, NetError> {
    if cancelled() {
        return Ok(WindowOutcome::Abandoned);
    }
    let items = endpoints::fetch_activities_with_bodies(
        transport,
        athlete_id,
        &window.range.0,
        &window.range.1,
        true,
        limit,
        Lane::Backfill,
    )
    .await?;
    if items.is_empty() {
        return Ok(WindowOutcome::Empty);
    }
    // The cancel is soft, so the page in flight was allowed to finish, but
    // writing it is not part of that bargain: the state machine moved to
    // Paused when the athlete stopped the sync, and rows landing after that
    // is what makes the UI lie.
    if cancelled() {
        return Ok(WindowOutcome::Abandoned);
    }
    let items: Vec<_> = items
        .into_iter()
        .filter(|(record, _)| {
            window
                .eligible_ids
                .as_ref()
                .is_none_or(|ids| ids.contains(&record.id))
        })
        .collect();
    if items.is_empty() {
        return Ok(WindowOutcome::Empty);
    }

    // The server names the activity by its own id; the row it belongs to is
    // keyed by ours. They are equal for every row an older build stored, so
    // an id nothing claims stays the key it arrived as. Matching on the
    // column instead is what stops an activity the device minted and later
    // uploaded from being stored a second time.
    let named: Vec<String> = items.iter().map(|(record, _)| record.id.clone()).collect();
    // A lookup that failed reads the same as an id no row claims, so the page
    // is not written at all: storing it under the server's key is what puts a
    // ride the device uploaded into the feed twice.
    let local = crate::persistence::with_persistent_engine_blocking(move |engine| {
        engine.local_ids_for_intervals_ids(&named)
    })
    .await
    .ok_or(NetError::EngineClosed)?
    .map_err(|e| NetError::Storage(format!("activity id reconcile failed: {e}")))?;

    let mut bodies = Vec::with_capacity(items.len());
    let mut metrics = Vec::with_capacity(items.len());
    // The activities that moved the accepted eFTP, which the fitness plot
    // marks. Only a non-zero delta is a change: an activity that merely
    // produced an estimate did not move anything.
    let mut eftp_changes: Vec<(String, i64, f64, f64, String)> = Vec::new();
    // The census names activities by the server's id, and the loop below
    // rewrites `record.id` to the local key, so the mark is taken before that.
    // Only rows that are actually written are marked: one skipped for a missing
    // start date was not stored and does not cover anything.
    let mut fetched: Vec<String> = Vec::with_capacity(items.len());
    for (mut record, body) in items {
        let Some(date) = start_date_to_timestamp(record.start_date_local.as_deref()) else {
            // Without a start time the row cannot be windowed or ordered, and
            // a fabricated one would sort into the wrong week.
            continue;
        };
        fetched.push(record.id.clone());
        if let Some(key) = local.get(&record.id) {
            record.id = key.clone();
        }
        if let (Some(eftp), Some(delta)) = (record.icu_rolling_ftp, record.icu_rolling_ftp_delta)
            && delta != 0.0
            && eftp.is_finite()
            && delta.is_finite()
        {
            eftp_changes.push((
                record.id.clone(),
                date,
                eftp,
                delta,
                record.name.clone().unwrap_or_default(),
            ));
        }
        bodies.push((record.id.clone(), date, body));
        metrics.push(activity_metrics_row(record, date));
    }

    let owner = athlete_id.to_string();
    crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
        engine.store_synced_activity_bodies(&owner, &bodies, &fetched, metrics)?;
        for (id, date, eftp, delta, name) in &eftp_changes {
            if let Err(e) = engine.set_eftp_change(id, *date, *eftp, *delta, name) {
                log::warn!("[Sync] eFTP marker write failed for {id}: {e}");
            }
        }
        Ok::<(), rusqlite::Error>(())
    })
    .await
    .ok_or(NetError::EngineClosed)?
    .map_err(|e| NetError::Storage(format!("activity body upsert failed: {e}")))?;
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
/// Once per activity step, not once per page: the ordinary answer is an empty
/// list, and the TypeScript pass this replaces read every stored id back over
/// the FFI on every `activities` announcement and filtered a whole-library
/// parsed array against it.
async fn repair_missing_activity_metrics(install: u64) -> usize {
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
    let stored = crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
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

fn calendar_window() -> (String, String) {
    let today = chrono::Local::now().date_naive();
    (
        today.to_string(),
        (today + chrono::Duration::days(14)).to_string(),
    )
}

async fn fetch_and_store_calendar(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
) -> Result<(), NetError> {
    let items = endpoints::fetch_calendar_events_bodies(
        transport,
        athlete_id,
        oldest,
        newest,
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
        day_start_timestamp(oldest),
        day_start_timestamp(newest).map(|t| t + 86_399),
    ) else {
        return Err(NetError::Decode("invalid calendar window".into()));
    };
    store_body_or_fail(install, "calendar", String::new(), move |engine| {
        engine.replace_calendar_events(oldest_ts, newest_ts, &rows)
    })
    .await
}

/// Settings key holding the athlete's first-ever activity date.
pub const OLDEST_ACTIVITY_DATE_KEY: &str = "oldest_activity_date";

/// Settings key holding the per-year activity counts, as a `{"YYYY": n}` JSON
/// object. The history slider gates a large widening on it.
pub const ACTIVITY_YEAR_COUNTS_KEY: &str = "activity_year_counts";

#[derive(Clone, Copy)]
struct CurveRequest {
    key: CurveKey,
    days: i64,
}

/// The calendar date part of a `YYYY-MM-DDT...` local timestamp.
fn local_date_of(stamp: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(stamp.get(..10)?, "%Y-%m-%d").ok()
}

/// The local date a stored curve describes up to, and the local dates of the
/// activities its response lists.
///
/// The response's own `end_date_local` is the day the window ends on. A body
/// that carries none falls back to the local date of the fetch.
fn stored_curve_frame(
    raw: &str,
    days: i64,
    fetched_at: f64,
) -> (chrono::NaiveDate, Vec<chrono::NaiveDate>) {
    let parsed: serde_json::Value = serde_json::from_str(raw).unwrap_or_default();
    let windows = parsed.get("list").and_then(|list| list.as_array());
    let window = windows.and_then(|windows| {
        windows
            .iter()
            .find(|window| window.get("days").and_then(|d| d.as_i64()) == Some(days))
            .or_else(|| windows.first())
    });
    let end = window
        .and_then(|window| window.get("end_date_local"))
        .and_then(|end| end.as_str())
        .and_then(local_date_of)
        .unwrap_or_else(|| {
            chrono::DateTime::from_timestamp(fetched_at as i64, 0)
                .map(|at| at.with_timezone(&chrono::Local).date_naive())
                .unwrap_or_default()
        });
    let contributors = parsed
        .get("activities")
        .and_then(|activities| activities.as_object())
        .map(|activities| {
            activities
                .values()
                .filter_map(|activity| activity.get("start_date_local")?.as_str())
                .filter_map(local_date_of)
                .collect()
        })
        .unwrap_or_default();
    (end, contributors)
}

/// Whether an activity on one of `dates` is inside the `days`-day window
/// ending `fetched_end` but outside the one ending `today`, or the reverse.
///
/// A window holds the dates from `end - days` to `end`, both inclusive. A
/// day rollover that moves no listed date across an edge changes nothing.
fn crossed_window_edge(
    dates: &[chrono::NaiveDate],
    days: i64,
    fetched_end: chrono::NaiveDate,
    today: chrono::NaiveDate,
) -> bool {
    let within = |date: chrono::NaiveDate, end: chrono::NaiveDate| {
        date <= end && date >= end - chrono::Duration::days(days)
    };
    dates
        .iter()
        .any(|&date| within(date, fetched_end) != within(date, today))
}

fn curve_requests(engine: &PersistentEngine) -> SqlResult<Vec<CurveRequest>> {
    curve_requests_on(engine, chrono::Local::now().date_naive())
}

/// The curves to fetch, with `today` as the local date the windows end on.
fn curve_requests_on(
    engine: &PersistentEngine,
    today: chrono::NaiveDate,
) -> SqlResult<Vec<CurveRequest>> {
    // A removal counts as an arrival: the server's curves drew the activity
    // that left, and the family's newest body cannot say so.
    let mut arrivals = engine.try_latest_arrival_by_sport()?;
    arrivals.extend(engine.try_curve_removals_by_sport()?);
    let days_by_sport = engine.try_activity_days_by_sport()?;
    let mut requests = Vec::new();
    for &key in CURVE_KEYS {
        let family = crate::sport::family_of(key.sport);
        let mut held = arrivals
            .iter()
            .filter(|(sport, _)| family.contains(&sport.as_str()))
            .peekable();
        if held.peek().is_none() {
            continue;
        }
        let latest = held.filter_map(|(_, arrived)| *arrived).max();
        let family_dates: Vec<chrono::NaiveDate> = days_by_sport
            .iter()
            .filter(|(sport, _)| family.contains(&sport.as_str()))
            .filter_map(|&(_, day)| {
                chrono::NaiveDate::from_num_days_from_ce_opt(719_163 + day as i32)
            })
            .collect();
        for &days in CURVE_DAYS {
            let stored = engine.get_stored_curve(key.kind, key.sport, days, key.gap)?;
            // A body written in the fetch's own second was written before it:
            // the page write runs ahead of this sweep in the same job.
            if let Some(curve) = stored {
                let arrived_since = latest.is_some_and(|arrived| curve.fetched_at < arrived as f64);
                if !arrived_since {
                    let (fetched_end, mut dates) =
                        stored_curve_frame(&curve.raw, days, curve.fetched_at);
                    dates.extend(&family_dates);
                    if !crossed_window_edge(&dates, days, fetched_end, today) {
                        continue;
                    }
                }
            }
            requests.push(CurveRequest { key, days });
        }
    }
    Ok(requests)
}

async fn fetch_curve_body(
    transport: &Transport,
    athlete_id: &str,
    request: CurveRequest,
) -> Result<String, NetError> {
    let window = curve_window(request.days);
    match request.key.kind {
        CurveKind::Power => {
            endpoints::fetch_power_curve_body(
                transport,
                athlete_id,
                request.key.sport,
                &window,
                Lane::Backfill,
            )
            .await
        }
        CurveKind::Pace => {
            endpoints::fetch_pace_curve_body(
                transport,
                athlete_id,
                request.key.sport,
                &window,
                request.key.gap,
                Lane::Backfill,
            )
            .await
        }
    }
}

/// Fetch the screen-read curves whose sport family had an activity arrive,
/// or leave intervals.icu, since the stored curve was fetched.
async fn sync_curves(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<(), NetError> {
    let requests =
        crate::persistence::with_persistent_engine_blocking(|engine| curve_requests(engine))
            .await
            .ok_or(NetError::EngineClosed)?
            .map_err(|e| NetError::Io(format!("curve plan read failed: {}", e)))?;

    let mut last_error: Option<NetError> = None;
    for request in requests {
        if cancelled() {
            return Ok(());
        }
        match fetch_curve_body(transport, athlete_id, request).await {
            Ok(body) => {
                let key = request.key;
                let name = match key.kind {
                    CurveKind::Power => "power_curve",
                    CurveKind::Pace => "pace_curve",
                };
                store_body_or_fail(install, name, String::new(), move |engine| {
                    engine.set_curve_body(key.kind, key.sport, request.days, key.gap, &body)
                })
                .await?;
            }
            Err(NetError::Unauthorized) => return Err(NetError::Unauthorized),
            Err(e) => last_error = Some(e),
        }
    }

    match last_error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// What an activity upstream has no intervals for is stored as.
const NO_INTERVALS_BODY: &str = r#"{"icu_intervals":[]}"#;

/// Fetch the interval body of every activity that has none.
///
/// `sync_activity_intervals` is demand-driven: the detail screen asks the
/// first time it is opened, so an activity never opened online shows no lap
/// table offline and nothing says the laps were simply never downloaded. One
/// request per activity, once, which is what keeps the library as complete
/// offline as it is online.
///
/// The queue is derived from SQLite rather than stored: an id whose body
/// landed leaves it, so a sweep killed halfway resumes by re-deriving what is
/// still missing and needs no checkpoint. Backfill lane, so the sweep steps
/// aside for a tapped screen.
async fn sync_interval_bodies(
    install: u64,
    transport: &Transport,
    cancelled: &(dyn Fn() -> bool + Sync),
    progress: &(dyn Fn(u32, u32) + Sync),
) -> Result<(), NetError> {
    // A failed read must not read as "nothing missing": that would report a
    // sweep that fetched nothing as a success and leave the athlete with an
    // empty lap table and no error anywhere.
    let missing = crate::persistence::with_persistent_engine_blocking(|engine| {
        engine.activities_missing_interval_bodies()
    })
    .await
    .ok_or(NetError::EngineClosed)?
    .map_err(|e| NetError::Io(format!("interval queue read failed: {}", e)))?;

    let mut last_error: Option<NetError> = None;
    let owed = u32::try_from(missing.len()).unwrap_or(u32::MAX);
    progress(0, owed);

    for (index, activity_id) in missing.into_iter().enumerate() {
        if cancelled() {
            return Ok(());
        }
        // Reported when an activity is handled, however it ended, so a run of
        // refused or unresolvable ids still reaches the total.
        let handled = u32::try_from(index + 1).unwrap_or(u32::MAX);
        let Some(upstream) = upstream_id(install, &activity_id).await else {
            progress(handled, owed);
            continue;
        };
        match endpoints::fetch_intervals_body(transport, &upstream, Lane::Backfill).await {
            Ok(body) => {
                let id = activity_id.clone();
                store_body_or_fail(install, "intervals", activity_id, move |engine| {
                    engine.set_interval_body(&id, &body)
                })
                .await?;
            }
            Err(NetError::Unauthorized) => return Err(NetError::Unauthorized),
            // The server answering for this one activity: it has no interval
            // body to give, and the sweep is not failed for it.
            Err(NetError::Http { status, .. }) if matches!(status, 404 | 410 | 422) => {
                log::info!(
                    "[Sync] intervals for {} refused with {}; recorded as none",
                    activity_id,
                    status
                );
                // Stored as an empty body so the queue, which is derived from
                // the missing rows, does not ask for it again on every sync.
                let id = activity_id.clone();
                store_body_or_fail(install, "intervals", activity_id, move |engine| {
                    engine.set_interval_body(&id, NO_INTERVALS_BODY)
                })
                .await?;
            }
            Err(e) => last_error = Some(e),
        }
        progress(handled, owed);
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
    install: u64,
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
    let census = summary.ids();
    let entries = summary.entries.clone();
    let athlete = athlete_id.to_string();
    if !census.is_empty() {
        crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
            // Recorded before the reconcile, so a census that removes rows has
            // already said what it carries: the two read the same pull and the
            // coverage table is what the next sync diffs against.
            engine.record_activity_census(&athlete, &entries)?;
            let removed = engine.reconcile_against_census(&census, &today);
            if !removed.is_empty() {
                log::info!(
                    "[Sync] {} activities left intervals.icu and were removed",
                    removed.len()
                );
            }
            Ok::<(), rusqlite::Error>(())
        })
        .await
        .ok_or(NetError::EngineClosed)?
        .map_err(|e| NetError::Storage(format!("activity census write failed: {e}")))?;
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
    crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
        if let Err(e) = engine.set_setting(OLDEST_ACTIVITY_DATE_KEY, &oldest) {
            log::warn!("[Sync] oldest activity date write failed: {}", e);
        }
        if !counts.is_empty()
            && let Err(e) = engine.set_setting(ACTIVITY_YEAR_COUNTS_KEY, &counts)
        {
            log::warn!("[Sync] year counts write failed: {}", e);
        }
    })
    .await
    .ok_or(NetError::EngineClosed)?;
    Ok(())
}

/// Persist a year of wellness, typed columns plus the untyped body per day.
async fn sync_wellness(
    install: u64,
    transport: &Transport,
    athlete_id: &str,
) -> Result<(), NetError> {
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
    store_body_or_fail(install, "wellness", String::new(), move |engine| {
        engine.upsert_wellness(&rows)
    })
    .await?;
    Ok(())
}

/// The FFI service object. The single thing TypeScript calls for I/O.
#[derive(uniffi::Object)]
pub struct SyncManager {
    pub(crate) _private: (),
}

/// Start the default sync. The one dispatch both the FFI and a resume after
/// a clear go through.
fn start_full_sync() -> FfiStartOutcome {
    let (transport, athlete_id) = match SYNC_SERVICE.try_start_for(SyncRequest::Full) {
        Ok(pair) => pair,
        Err(refusal) => return refusal,
    };
    // Which library this run belongs to, read on this thread rather than
    // on the runtime: a restore installing another database mid-run would
    // otherwise take pages fetched against the old one.
    let install = crate::persistence::engine_install();
    crate::runtime::spawn(async move {
        let _guard = FinishGuard;
        perform_sync(&SYNC_SERVICE, install, transport, athlete_id).await;
    });
    FfiStartOutcome::Started
}

/// Start a sync of one date window, answering `NotOwed` for a window the
/// census holds current.
fn start_window_sync(oldest: String, newest: String) -> FfiStartOutcome {
    if let Some(athlete_id) = SYNC_SERVICE.athlete_id() {
        // Recorded for every ask, including one that answers `NotOwed` or is
        // refused busy. Off this thread: the engine lock can be held by a long
        // write, and this call answers a gesture.
        let asked = (athlete_id.clone(), oldest.clone());
        let install = crate::persistence::engine_install();
        crate::runtime::spawn(async move {
            crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
                if let Err(e) = engine.record_activity_window(&asked.0, &asked.1) {
                    log::warn!("veloqrs: [sync] window record failed: {}", e);
                }
            })
            .await;
        });
        let window = (oldest.clone(), newest.clone());
        match with_reader(move |conn| {
            crate::persistence::activities::pooled::window_is_covered(
                conn,
                &athlete_id,
                &window.0,
                &window.1,
            )
        }) {
            // Early rather than refused: the engine is not open yet, so
            // nothing is known about the window either way.
            Err(_) => return FfiStartOutcome::NotReady,
            Ok(true) => return FfiStartOutcome::NotOwed,
            Ok(false) => {}
        }
    }
    let request = SyncRequest::Window {
        oldest: oldest.clone(),
        newest: newest.clone(),
    };
    let (transport, athlete_id) = match SYNC_SERVICE.try_start_for(request) {
        Ok(pair) => pair,
        Err(refusal) => return refusal,
    };
    let install = crate::persistence::engine_install();
    crate::runtime::spawn(async move {
        let _guard = FinishGuard;
        perform_window_sync(
            &SYNC_SERVICE,
            install,
            transport,
            athlete_id,
            &oldest,
            &newest,
        )
        .await;
    });
    FfiStartOutcome::Started
}

/// Cancel the running sync for a partial clear, handing back what it was.
pub(crate) fn interrupt_sync() -> Option<Interrupted> {
    SYNC_SERVICE.interrupt()
}

/// Start again the sync a partial clear interrupted, once the wipe has ended.
pub(crate) fn resume_sync_after_clear(interrupted: Option<Interrupted>) {
    let Some(interrupted) = interrupted else {
        return;
    };
    let request = interrupted.request.clone();
    SYNC_SERVICE.resume_after_clear(interrupted, move || {
        match request {
            SyncRequest::Full => start_full_sync(),
            SyncRequest::Window { oldest, newest } => start_window_sync(oldest, newest),
        };
    });
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
        give_credentials(&method, secret, athlete_id)
    }

    /// Forget the credential (logout).
    fn clear_credentials(&self) {
        SYNC_SERVICE.clear_credentials();
    }

    /// What making an inclusive date range available offline will cost, in
    /// requests and in bytes, so the athlete is told before they spend it on a
    /// connection that may be metered.
    ///
    /// Read from the moving seconds already stored for the range rather than
    /// from an activity count: per activity the cost spans fifty-fold across a
    /// real library and per moving second it holds to about a third.
    fn offline_estimate(&self, oldest: f64, newest: f64) -> Result<FfiOfflineEstimate, VeloqError> {
        let oldest = crate::ffi_types::int_from_wire(oldest);
        let newest = crate::ffi_types::int_from_wire(newest);
        with_reader(|conn| {
            let (activities, moving_seconds) =
                crate::persistence::activities::pooled::offline_range_totals(conn, oldest, newest)
                    .map_err(|err| VeloqError::Database {
                        msg: format!("{}", err),
                    })?;
            let estimate = crate::net::offline_prefetch::estimate_range(activities, moving_seconds);
            Ok(FfiOfflineEstimate {
                activities: estimate.activities,
                moving_seconds: estimate.moving_seconds as f64,
                requests: estimate.requests,
                bytes: estimate.bytes as f64,
            })
        })?
    }

    /// Start a sync. Returns instantly, naming whether the job started and, if
    /// not, whether asking again later would. Work runs on the shared runtime;
    /// observe progress via `get_sync_status`.
    fn sync_now(&self) -> Result<FfiStartOutcome, VeloqError> {
        Ok(start_full_sync())
    }

    /// What a date range holds: nothing, a download still owed, or every
    /// activity in it local and current.
    ///
    /// A chart that draws an empty axis cannot say why on its own, and saying
    /// "no data" for a range nobody pulled is the collapse this answers. The
    /// read is a count over the census, so it is a screen read and not a sync.
    ///
    /// No credential and no open engine both answer `NotFetched`: nothing is
    /// known about the range either way, and `Empty` would be a claim.
    fn range_coverage(&self, oldest: String, newest: String) -> RangeCoverage {
        let Some(athlete_id) = SYNC_SERVICE.athlete_id() else {
            return RangeCoverage::NotFetched;
        };
        with_reader(move |conn| {
            crate::persistence::activities::pooled::range_coverage(
                conn,
                &athlete_id,
                &oldest,
                &newest,
            )
        })
        .unwrap_or(RangeCoverage::NotFetched)
    }

    /// How much of the signed-in athlete's library is on the device: the
    /// activity pages and the GPS tracks, each as stored against upstream.
    ///
    /// Every progress figure before this one was the current run's own queue,
    /// so a library of 1,598 rides with 400 tracks stored reported "12/12" and
    /// then nothing. This is the window the athlete asked for, counted off the census.
    ///
    /// No credential and no open engine both answer zeros, which every surface
    /// reads as nothing to report: nothing is known about the account, and a
    /// figure would be a claim.
    fn library_coverage(&self) -> LibraryCoverage {
        let Some(athlete_id) = SYNC_SERVICE.athlete_id() else {
            return LibraryCoverage::default();
        };
        with_reader(move |conn| {
            crate::persistence::activities::pooled::library_coverage(conn, &athlete_id)
        })
        .unwrap_or_default()
    }

    /// Fetch and store one date window of activities. Returns instantly,
    /// naming whether the job started and, if not, whether asking again later
    /// would. The feed calls this for windows the default sync misses.
    ///
    /// A window the census says is already local and current answers `NotOwed`
    /// without starting anything. The check is made before the exclusive slot
    /// is claimed, so a window that owes nothing never shows up as a running
    /// sync, and the caller needs no memory of what it has already asked for:
    /// a `Set` a relaunch empties is what made every launch re-download the
    /// pages the feed had already scrolled to.
    fn sync_activities_window(
        &self,
        oldest: String,
        newest: String,
    ) -> Result<FfiStartOutcome, VeloqError> {
        Ok(start_window_sync(oldest, newest))
    }

    /// Fetch and store a power curve for a sport and window. The outcome says
    /// why it did not start: `Busy` while the same curve is being fetched,
    /// `Held` while a failed one backs off, `NotConfigured` with no credential.
    fn sync_power_curve(&self, sport: String, days: f64) -> FfiStartResult {
        let days = crate::ffi_types::int_from_wire(days);
        spawn_once(
            JobKey::new("power", &[&sport, &days.to_string()]),
            move |install, transport, athlete_id| async move {
                let body = endpoints::fetch_power_curve_body(
                    &transport,
                    &athlete_id,
                    &sport,
                    &curve_window(days),
                    Lane::Interactive,
                )
                .await?;
                store_body_or_fail(install, "power_curve", String::new(), move |engine| {
                    engine.set_curve_body(CurveKind::Power, &sport, days, false, &body)
                })
                .await?;
                Ok(())
            },
        )
    }

    /// Fetch and store a pace curve. `gap` asks for gradient-adjusted pace and
    /// is only honoured for running.
    fn sync_pace_curve(&self, sport: String, days: f64, gap: bool) -> FfiStartResult {
        let days = crate::ffi_types::int_from_wire(days);
        spawn_once(
            JobKey::new("pace", &[&sport, &days.to_string(), &gap.to_string()]),
            move |install, transport, athlete_id| async move {
                let body = endpoints::fetch_pace_curve_body(
                    &transport,
                    &athlete_id,
                    &sport,
                    &curve_window(days),
                    gap,
                    Lane::Interactive,
                )
                .await?;
                store_body_or_fail(install, "pace_curve", String::new(), move |engine| {
                    engine.set_curve_body(CurveKind::Pace, &sport, days, gap, &body)
                })
                .await?;
                Ok(())
            },
        )
    }

    /// Fetch and store an activity's work/recovery intervals.
    fn sync_activity_intervals(&self, activity_id: String) -> FfiStartResult {
        spawn_once(
            JobKey::new("intervals", &[&activity_id]),
            move |install, transport, _athlete_id| async move {
                let Some(upstream) = upstream_id(install, &activity_id).await else {
                    return Ok(());
                };
                let body =
                    endpoints::fetch_intervals_body(&transport, &upstream, Lane::Interactive)
                        .await?;
                store_body_or_fail(install, "intervals", activity_id.clone(), move |engine| {
                    engine.set_interval_body(&activity_id, &body)
                })
                .await?;
                Ok(())
            },
        )
    }

    /// Fetch and store the calendar events in a date window, replacing what
    /// was there so an event cancelled upstream disappears here too.
    fn sync_calendar_events(&self, oldest: String, newest: String) -> FfiStartResult {
        spawn_once(
            JobKey::new("calendar", &[&oldest, &newest]),
            move |install, transport, athlete_id| async move {
                fetch_and_store_calendar(install, &transport, &athlete_id, &oldest, &newest).await
            },
        )
    }

    /// Fetch and store an activity's streams for a series selection. The
    /// types string is the cache key, so callers must pass it consistently.
    fn sync_activity_streams(&self, activity_id: String, types: String) -> FfiStartResult {
        spawn_once(
            JobKey::new("streams", &[&activity_id, &types]),
            move |install, transport, _athlete_id| async move {
                let Some(upstream) = upstream_id(install, &activity_id).await else {
                    return Ok(());
                };
                let body =
                    endpoints::fetch_streams_body(&transport, &upstream, &types, Lane::Interactive)
                        .await?;
                store_body_or_fail(install, "streams", activity_id.clone(), move |engine| {
                    engine.set_stream_body(&activity_id, &types, &body)
                })
                .await?;
                Ok(())
            },
        )
    }

    /// Fetch and store an activity's full detail body, replacing the lighter
    /// row the list sync wrote.
    fn sync_activity_detail(&self, activity_id: String) -> FfiStartResult {
        spawn_once(
            JobKey::new("detail", &[&activity_id]),
            move |install, transport, _athlete_id| async move {
                let Some(upstream) = upstream_id(install, &activity_id).await else {
                    return Ok(());
                };
                let body = endpoints::fetch_activity_body(&transport, &upstream, Lane::Interactive)
                    .await?;
                let Some(date) = detail_body_date(&body) else {
                    return Ok(());
                };
                store_body_or_fail(
                    install,
                    "activity_detail",
                    activity_id.clone(),
                    move |engine| engine.store_activity_detail_body(&activity_id, date, &body),
                )
                .await?;
                Ok(())
            },
        )
    }

    /// Fetch and store the `time` streams the section-performance maths needs.
    /// Activities that already have one are skipped, so a repeat call over the
    /// same list costs nothing.
    fn sync_time_streams(&self, activity_ids: Vec<String>) -> FfiStartResult {
        if activity_ids.is_empty() {
            // Nothing was asked for, so refusing is the right answer and will
            // stay the right answer.
            return FfiStartOutcome::NotOwed.into();
        }
        let key = JobKey::over("timestreams", &activity_ids);
        spawn_once(key, move |install, transport, athlete_id| async move {
            let missing =
                crate::persistence::with_persistent_engine_blocking_for(install, move |engine| {
                    engine.get_activities_missing_time_streams(&activity_ids)
                })
                .await
                .unwrap_or_default();
            let mut askable = Vec::with_capacity(missing.len());
            for id in missing {
                if upstream_id(install, &id).await.is_some() {
                    askable.push(id);
                }
            }
            let missing = askable;

            drain_time_streams_with(
                missing,
                || SYNC_SERVICE.still_signed_in(&athlete_id),
                |activity_id| {
                    // Cloned per activity because the walk holds the fetch as
                    // an `FnMut`: the transport is an `Arc` inside, which is
                    // what `spawn_once` clones for the confirmation too.
                    let transport = transport.clone();
                    async move {
                        let Some(upstream) = upstream_id(install, &activity_id).await else {
                            return Err(NetError::Storage(format!(
                                "{activity_id} has no id upstream"
                            )));
                        };
                        endpoints::fetch_time_stream(&transport, &upstream, Lane::Backfill).await
                    }
                },
                |activity_id, times| store_time_stream(install, activity_id, times),
            )
            .await
        })
    }

    /// Set the effort the athlete gave an uploaded ride, as its `icu_rpe`.
    ///
    /// A separate call because the upload takes no effort field. It names the
    /// activity the upload created, so a failure here never sends the file
    /// again: the recording keeps the effort owed and the next pass retries
    /// only this.
    async fn update_activity_rpe(&self, intervals_id: String, rpe: u32) -> FfiCallOutcome {
        send_activity_rpe(intervals_id, rpe).await
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
    fn bodies_stored(&self) -> f64 {
        bodies_stored() as f64
    }
}

#[cfg(test)]
#[path = "tests/sync_coverage.rs"]
mod sync_coverage_tests;

#[cfg(test)]
#[path = "tests/sync_calendar.rs"]
mod sync_calendar_tests;

#[cfg(test)]
#[path = "tests/sync_install_stamp.rs"]
mod sync_install_stamp_tests;

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

    /// Scenario: the athlete signs out part way through a time-stream pass
    /// over a long list. The transport in the job's hand was built before the
    /// spawn, so it still carries the token they signed out of.
    ///
    /// Expected behaviour: the walk stops at the next activity rather than
    /// fetching the rest of the list on a revoked credential.
    mod time_stream_walk {
        use super::*;
        use std::cell::RefCell;

        fn ids(n: usize) -> Vec<String> {
            (0..n).map(|i| format!("a{i}")).collect()
        }

        /// Yields to the executor once, so every future in a chunk is polled
        /// before any of them finishes.
        struct YieldOnce(bool);

        impl std::future::Future for YieldOnce {
            type Output = ();
            fn poll(
                mut self: std::pin::Pin<&mut Self>,
                cx: &mut std::task::Context<'_>,
            ) -> std::task::Poll<()> {
                if self.0 {
                    std::task::Poll::Ready(())
                } else {
                    self.0 = true;
                    cx.waker().wake_by_ref();
                    std::task::Poll::Pending
                }
            }
        }

        #[test]
        fn a_chunk_is_in_flight_together_and_never_more_than_a_chunk() {
            let in_flight = std::cell::Cell::new(0usize);
            let peak = std::cell::Cell::new(0usize);
            let (in_flight, peak) = (&in_flight, &peak);
            let stored = RefCell::new(Vec::new());

            crate::runtime::block_on(drain_time_streams_with(
                ids(TIME_STREAM_CONCURRENCY * 2 + 3),
                || true,
                |_id| async move {
                    in_flight.set(in_flight.get() + 1);
                    peak.set(peak.get().max(in_flight.get()));
                    YieldOnce(false).await;
                    in_flight.set(in_flight.get() - 1);
                    Ok(vec![1u32])
                },
                |activity_id, _| {
                    stored.borrow_mut().push(activity_id);
                    async {}
                },
            ))
            .unwrap();

            assert_eq!(peak.get(), TIME_STREAM_CONCURRENCY);
            assert_eq!(stored.into_inner(), ids(TIME_STREAM_CONCURRENCY * 2 + 3));
        }

        /// The walk, with the sign-in read flipping false after `signed_in_for`
        /// activities. Answers what was fetched and what was stored.
        fn walk_signing_out_after(
            signed_in_for: usize,
        ) -> (Vec<String>, Vec<String>, Result<(), NetError>) {
            let fetched = RefCell::new(Vec::new());
            let stored = RefCell::new(Vec::new());
            let reads = RefCell::new(0usize);

            let outcome = crate::runtime::block_on(drain_time_streams_with(
                ids(TIME_STREAM_CONCURRENCY * 3),
                || {
                    let mut n = reads.borrow_mut();
                    *n += 1;
                    *n <= signed_in_for
                },
                |activity_id| {
                    fetched.borrow_mut().push(activity_id);
                    async { Ok(vec![0u32, 1, 2]) }
                },
                |activity_id, _times| {
                    stored.borrow_mut().push(activity_id);
                    async {}
                },
            ));

            (fetched.into_inner(), stored.into_inner(), outcome)
        }

        #[test]
        fn stops_at_the_chunk_after_the_sign_out() {
            let (fetched, stored, _) = walk_signing_out_after(2);

            let two_chunks = ids(TIME_STREAM_CONCURRENCY * 2);
            assert_eq!(fetched, two_chunks);
            assert_eq!(stored, two_chunks);
        }

        #[test]
        fn calls_a_sign_out_done_rather_than_failed() {
            // A failure backs the job key off, which would hold it against
            // whoever signs in next.
            assert!(walk_signing_out_after(2).2.is_ok());
        }

        #[test]
        fn fetches_nothing_at_all_when_the_sign_out_beat_the_first_read() {
            let (fetched, stored, outcome) = walk_signing_out_after(0);

            assert!(fetched.is_empty());
            assert!(stored.is_empty());
            assert!(outcome.is_ok());
        }

        #[test]
        fn walks_the_whole_list_while_the_athlete_stays_signed_in() {
            let (fetched, stored, outcome) = walk_signing_out_after(usize::MAX);

            assert_eq!(fetched.len(), TIME_STREAM_CONCURRENCY * 3);
            assert_eq!(stored.len(), TIME_STREAM_CONCURRENCY * 3);
            assert!(outcome.is_ok());
        }

        #[test]
        fn reads_the_flag_once_per_chunk_and_not_once_per_pass() {
            // Five chunks, five reads. A pass that read once could not
            // notice a sign-out at all.
            let reads = RefCell::new(0usize);
            crate::runtime::block_on(drain_time_streams_with(
                ids(TIME_STREAM_CONCURRENCY * 5),
                || {
                    *reads.borrow_mut() += 1;
                    true
                },
                |_id| async { Ok(vec![]) },
                |_id, _times| async {},
            ))
            .unwrap();

            assert_eq!(reads.into_inner(), 5);
        }

        #[test]
        fn a_rejected_credential_stops_the_walk_and_says_so() {
            let fetched = RefCell::new(0usize);
            let outcome = crate::runtime::block_on(drain_time_streams_with(
                ids(TIME_STREAM_CONCURRENCY + 5),
                || true,
                |_id| {
                    *fetched.borrow_mut() += 1;
                    async { Err(NetError::Unauthorized) }
                },
                |_id, _times| async {},
            ));

            assert!(matches!(outcome, Err(NetError::Unauthorized)));
            assert_eq!(
                fetched.into_inner(),
                TIME_STREAM_CONCURRENCY,
                "the chunk after the refusal is not asked"
            );
        }

        #[test]
        fn one_activity_without_a_stream_does_not_stop_the_rest() {
            let stored = RefCell::new(Vec::new());
            let outcome = crate::runtime::block_on(drain_time_streams_with(
                ids(3),
                || true,
                |activity_id| async move {
                    if activity_id == "a1" {
                        Err(NetError::Http {
                            status: 500,
                            body: String::new(),
                        })
                    } else {
                        Ok(vec![1u32])
                    }
                },
                |activity_id, _times| {
                    stored.borrow_mut().push(activity_id);
                    async {}
                },
            ));

            assert_eq!(
                stored.into_inner(),
                vec!["a0".to_string(), "a2".to_string()]
            );
            assert!(outcome.is_ok());
        }

        #[test]
        fn an_empty_answer_is_still_stored() {
            // The row records that the question was put, or the activity comes
            // back on every pass for the life of the install.
            let stored = RefCell::new(Vec::new());
            crate::runtime::block_on(drain_time_streams_with(
                ids(1),
                || true,
                |_id| async { Ok(vec![]) },
                |activity_id, times| {
                    stored.borrow_mut().push((activity_id, times));
                    async {}
                },
            ))
            .unwrap();

            assert_eq!(stored.into_inner(), vec![("a0".to_string(), vec![])]);
        }
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
                |_i, _transport, _athlete| async { Ok::<(), NetError>(()) },
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
                |_i, _transport, _athlete| async { Ok::<(), NetError>(()) },
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
                spawn_once_at(
                    key(),
                    || 1_001,
                    |_i, _t, _a| async { Ok::<(), NetError>(()) }
                ),
                FfiStartOutcome::Busy
            );

            with_persistent_engine(|engine| engine.mint_lease_generation().expect("mint"))
                .expect("engine");

            assert_eq!(
                spawn_once_at(
                    key(),
                    || 1_002,
                    |_i, _t, _a| async { Ok::<(), NetError>(()) }
                ),
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
                        |_i, _t, _a| async {
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
                    |_i, _t, _a| async { Ok::<(), NetError>(()) },
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
                assert_eq!(
                    held.retry_at_ms,
                    Some(
                        (row.last_attempt_at.expect("failure time")
                            + attempt_backoff_ms(row.attempts - 1)) as f64
                    ),
                );
                waits.push(attempt_backoff_ms(row.attempts - 1));
                clock.fetch_add(attempt_backoff_ms(row.attempts - 1), Ordering::SeqCst);
            }

            assert_eq!(waits, vec![1_000, 2_000, 4_000]);
        }

        /// A transport failure is the network being absent, not the resource
        /// refusing, so it spends no backoff and the reconnect re-ask is
        /// admitted however many offline asks came before it.
        #[test]
        fn a_key_that_fails_for_want_of_a_network_is_admitted_again_at_once() {
            let _serial = serial_global_state();
            let _tmp = init_global_engine("leases.db");
            let _creds = test_credentials();

            for _ in 0..10 {
                assert_eq!(
                    spawn_once_at(
                        key(),
                        || 1_000,
                        |_i, _t, _a| async {
                            Err::<(), NetError>(NetError::Transport("offline".to_string()))
                        }
                    ),
                    FfiStartOutcome::Started,
                    "an offline failure grew a backoff"
                );
                drain_spawned();
            }

            assert_eq!(
                spawn_once_at(
                    key(),
                    || 1_000,
                    |_i, _t, _a| async { Ok::<(), NetError>(()) }
                ),
                FfiStartOutcome::Started,
                "the reconnect re-ask was held"
            );
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
                    |_i, _t, _a| async {
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
                spawn_once_at(
                    key(),
                    || 1_000,
                    |_i, _t, _a| async { Ok::<(), NetError>(()) }
                ),
                FfiStartOutcome::Started
            );
            drain_spawned();

            assert!(
                with_persistent_engine(|engine| engine.job_attempt(&key()).expect("read"))
                    .expect("engine")
                    .is_none()
            );
            assert_eq!(
                spawn_once_at(
                    key(),
                    || 1_001,
                    |_i, _t, _a| async { Ok::<(), NetError>(()) }
                ),
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

            let outcome = spawn_once_at(
                key(),
                || 1_000,
                |_i, _t, _a| async { Ok::<(), NetError>(()) },
            );
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

    fn counting_start() -> (
        Arc<std::sync::atomic::AtomicU32>,
        impl FnOnce() + Send + 'static,
    ) {
        let started = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let seen = Arc::clone(&started);
        (started, move || {
            seen.fetch_add(1, Ordering::SeqCst);
        })
    }

    fn signed_in_service() -> SyncService {
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        svc
    }

    #[test]
    fn interrupting_an_idle_service_hands_back_nothing() {
        let svc = signed_in_service();
        assert_eq!(svc.interrupt(), None);
    }

    #[test]
    fn a_full_sync_interrupted_and_finished_is_started_again() {
        let svc = signed_in_service();
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        let interrupted = svc.interrupt().expect("a run was in flight");
        assert_eq!(interrupted.request, SyncRequest::Full);
        svc.finish(SyncState::Idle, None, false);
        let (started, start) = counting_start();
        svc.resume_after_clear(interrupted, start);
        assert_eq!(started.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_resume_asked_while_the_run_winds_down_waits_for_its_finish() {
        let svc = signed_in_service();
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        let interrupted = svc.interrupt().expect("a run was in flight");
        let (started, start) = counting_start();
        svc.resume_after_clear(interrupted, start);
        assert_eq!(
            started.load(Ordering::SeqCst),
            0,
            "the cancelled run still holds the slot"
        );
        svc.finish(SyncState::Idle, None, false);
        assert_eq!(started.load(Ordering::SeqCst), 1);
        svc.finish(SyncState::Idle, None, false);
        assert_eq!(started.load(Ordering::SeqCst), 1, "dispatched exactly once");
    }

    #[test]
    fn a_window_sync_resumes_with_the_same_window() {
        let svc = signed_in_service();
        let window = SyncRequest::Window {
            oldest: "2026-01-01".into(),
            newest: "2026-01-31".into(),
        };
        svc.claim_slot_for(window.clone()).expect("claim");
        let interrupted = svc.interrupt().expect("a run was in flight");
        assert_eq!(interrupted.request, window);
    }

    #[test]
    fn a_sign_out_or_another_athlete_between_interrupt_and_resume_starts_nothing() {
        for second_athlete in [None, Some("i2")] {
            let svc = signed_in_service();
            svc.claim_slot_for(SyncRequest::Full).expect("claim");
            let interrupted = svc.interrupt().expect("a run was in flight");
            match second_athlete {
                None => svc.clear_credentials(),
                Some(id) => svc.set_credentials(AuthKind::ApiKey, "other".into(), id.into()),
            }
            svc.finish(SyncState::Idle, None, false);
            let (started, start) = counting_start();
            svc.resume_after_clear(interrupted, start);
            assert_eq!(started.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn a_sign_out_while_a_resume_waits_cancels_it() {
        let svc = signed_in_service();
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        let interrupted = svc.interrupt().expect("a run was in flight");
        let (started, start) = counting_start();
        svc.resume_after_clear(interrupted, start);
        svc.clear_credentials();
        svc.finish(SyncState::Idle, None, false);
        assert_eq!(started.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn an_auth_park_between_interrupt_and_resume_starts_nothing() {
        let svc = signed_in_service();
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        let interrupted = svc.interrupt().expect("a run was in flight");
        svc.park_auth_expired_now();
        let (started, start) = counting_start();
        svc.resume_after_clear(interrupted.clone(), start);
        assert_eq!(started.load(Ordering::SeqCst), 0);

        let svc = signed_in_service();
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        let (started, start) = counting_start();
        svc.resume_after_clear(interrupted, start);
        svc.park_auth_expired_now();
        assert_eq!(
            started.load(Ordering::SeqCst),
            0,
            "a park drops a waiting resume"
        );
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
    fn test_try_start_names_held_and_parked_slots() {
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

        svc.park_auth_expired_now();
        assert_eq!(svc.snapshot().state, SyncState::AuthExpired);
        assert_eq!(svc.try_start().err(), Some(FfiStartOutcome::NotConfigured));
        assert!(!FfiStartOutcome::NotConfigured.is_retryable());
    }

    #[test]
    fn a_park_landing_during_a_start_never_answers_busy() {
        // Nothing here ever holds the slot past its own start: with no
        // credential every begun start ends at once. So the only honest
        // answers are NotConfigured, from the park or the missing credential,
        // and a Busy can only be the park read apart from the claim.
        let svc = Arc::new(SyncService::new());
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let parker = {
            let (svc, stop) = (Arc::clone(&svc), Arc::clone(&stop));
            std::thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    svc.park_auth_expired_now();
                    svc.release_auth_park();
                }
            })
        };
        let busy = (0..200_000)
            .filter(|_| svc.try_start().err() == Some(FfiStartOutcome::Busy))
            .count();
        stop.store(true, Ordering::Relaxed);
        parker.join().expect("parker");
        assert_eq!(busy, 0, "a park is a missing credential, never a held slot");
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
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/events");
            then.status(status).json_body(json!([]));
        });
        // The oldest-date step hits the same path with a different window, so
        // one mock covers both activity pulls.
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(status).json_body(json!([]));
        });
    }

    /// Expected behaviour: the status names the step in flight, not the one
    /// that just landed, and names none once the run is over. `completed` and
    /// `total` count steps, so this is the only field that can say what the
    /// sync is actually fetching.
    #[test]
    fn the_status_names_the_step_in_flight() {
        let svc = SyncService::new();
        svc.begin_steps(SYNC_STEPS);
        assert_eq!(svc.snapshot().step, None, "no step has begun");

        svc.begin_step(FfiSyncStep::Athlete);
        assert_eq!(svc.snapshot().step, Some(FfiSyncStep::Athlete));

        svc.complete_step();
        assert_eq!(
            svc.snapshot().step,
            Some(FfiSyncStep::Athlete),
            "a landed step stands until the next one begins"
        );

        svc.begin_step(FfiSyncStep::Activities);
        assert_eq!(svc.snapshot().step, Some(FfiSyncStep::Activities));

        svc.finish(SyncState::Idle, None, true);
        assert_eq!(svc.snapshot().step, None, "nothing is running");
    }

    /// Every request the mock server answered, in the order it answered them,
    /// for the tests that care where a step sits rather than what it wrote.
    ///
    /// A static rather than a captured handle: `httpmock`'s custom matcher is
    /// a bare `fn` pointer, so it closes over nothing. Every test that reads
    /// it holds `serial_global_state`, which is what keeps two of them out of
    /// each other's log.
    static REQUEST_ORDER: Mutex<Vec<(String, Option<FfiSyncStep>)>> = Mutex::new(Vec::new());

    /// The step beside the name is read from the process-wide service, which
    /// is the only one a bare `fn` matcher can reach. A test driving a local
    /// service records `None` there and reads the names alone.
    fn note_request(step: &str) {
        REQUEST_ORDER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((step.to_string(), SYNC_SERVICE.snapshot().step));
    }

    fn taken_requests() -> Vec<(String, Option<FfiSyncStep>)> {
        std::mem::take(&mut *REQUEST_ORDER.lock().unwrap_or_else(|e| e.into_inner()))
    }

    fn taken_request_order() -> Vec<String> {
        taken_requests().into_iter().map(|(name, _)| name).collect()
    }

    /// Note an activities request under the window it asked for, since the
    /// census and both window pulls share the one path.
    fn note_activities(req: &HttpMockRequest) -> bool {
        let oldest = req
            .query_params
            .as_ref()
            .and_then(|q| q.iter().find(|(k, _)| k == "oldest"))
            .map(|(_, v)| v.as_str())
            .unwrap_or("");
        // The census spans all history and the windows never do, so the
        // sentinel date is what tells the two apart.
        let limit = req
            .query_params
            .as_ref()
            .and_then(|q| q.iter().find(|(k, _)| k == "limit"))
            .map(|(_, v)| v.as_str())
            .unwrap_or("");
        if oldest == "2000-01-01" {
            note_request("census");
        } else if limit.is_empty() {
            note_request(&format!("activities {oldest}"));
        } else {
            note_request(&format!("activities {oldest} limit {limit}"));
        }
        true
    }

    fn note_athlete(_: &HttpMockRequest) -> bool {
        note_request("athlete");
        true
    }

    fn note_sport_settings(_: &HttpMockRequest) -> bool {
        note_request("sport-settings");
        true
    }

    fn note_wellness(_: &HttpMockRequest) -> bool {
        note_request("wellness");
        true
    }

    /// The profile slice again, with every endpoint noting itself as it is
    /// answered. `matches` runs after the path matcher, so a mock only ever
    /// notes a request that was going to it.
    fn mock_ordered_profile_slice(server: &MockServer) {
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1").matches(note_athlete);
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/sport-settings")
                .matches(note_sport_settings);
            then.status(200).json_body(json!([]));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/wellness")
                .matches(note_wellness);
            then.status(200).json_body(json!([]));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .matches(note_activities);
            then.status(200).json_body(json!([]));
        });
    }

    /// Scenario: a first launch. The census owes one run of days, so the plan
    /// collapses to a single window covering the whole span, and the step that
    /// lifts the standby is a request for the entire library. Five minutes in,
    /// the OnePlus was still on curves at 6 of 8 with no card on screen.
    ///
    /// Expected behaviour: the newest few are asked for on their own first,
    /// with a count rather than a date boundary, so the feed has cards after
    /// one round trip. The span behind it runs unchanged.
    #[test]
    fn the_newest_few_are_asked_for_before_the_span_they_sit_in() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_first_use.db");
        let today = chrono::Local::now().date_naive();
        // One run of consecutive owed days, which collapses to one window: the
        // fresh-install shape, where the head window is the whole library.
        let days: Vec<String> = (0..20)
            .map(|i| (today - chrono::Duration::days(i)).to_string())
            .collect();
        let oldest = days.last().expect("days").clone();
        let census: Vec<crate::net::types::ActivityCensusEntry> = days
            .iter()
            .enumerate()
            .map(|(i, date)| crate::net::types::ActivityCensusEntry {
                id: format!("a{i}"),
                start_date_local: Some(format!("{date}T08:30:00")),
                created: Some(format!("{date}T08:00:00Z")),
                icu_sync_date: Some(format!("{date}T09:00:00Z")),
                has_latlng: false,
            })
            .collect();
        crate::persistence::with_persistent_engine(move |engine| {
            engine
                .record_activity_census("i1", &census)
                .expect("census");
        })
        .expect("engine");

        let server = MockServer::start();
        mock_ordered_profile_slice(&server);
        taken_requests();

        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(SYNC_SERVICE.try_begin(), "nothing else holds the sync slot");
        crate::runtime::block_on(perform_sync(
            &SYNC_SERVICE,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        SYNC_SERVICE.clear_credentials();

        let names = taken_request_order();
        assert_eq!(
            names.first().map(String::as_str),
            Some("census"),
            "the census still goes first: {names:?}"
        );
        assert_eq!(
            names.get(1),
            Some(&format!("activities {oldest} limit {FIRST_USE_ACTIVITIES}")),
            "the newest few come before anything else: {names:?}"
        );
        assert_eq!(
            names.get(2),
            Some(&format!("activities {oldest}")),
            "and the span behind them is unchanged: {names:?}"
        );
    }

    /// The five's bodies come before the window behind them, the profile
    /// slice and every bulk request, and the run still completes.
    #[test]
    fn a_first_launch_readies_the_five_before_any_bulk_request() {
        let _guard = crate::test_globals::serial_global_state();
        let _dir = crate::test_globals::init_global_engine("sync_first_use_bodies.db");
        let today = chrono::Local::now().date_naive();
        let days: Vec<String> = (0..20)
            .map(|i| (today - chrono::Duration::days(i)).to_string())
            .collect();
        let oldest = days.last().expect("days").clone();
        let census: Vec<crate::net::types::ActivityCensusEntry> = days
            .iter()
            .enumerate()
            .map(|(i, date)| crate::net::types::ActivityCensusEntry {
                id: format!("r{i}"),
                start_date_local: Some(format!("{date}T08:30:00")),
                created: Some(format!("{date}T08:00:00Z")),
                icu_sync_date: Some(format!("{date}T09:00:00Z")),
                has_latlng: false,
            })
            .collect();
        crate::persistence::with_persistent_engine(move |engine| {
            engine
                .record_activity_census("i1", &census)
                .expect("census");
        })
        .expect("engine");

        let server = MockServer::start();
        let landed: Vec<serde_json::Value> = (0..2)
            .map(|i| {
                json!({"id": format!("r{i}"), "type": "Ride", "name": "Loop",
                       "start_date_local": format!("{}T08:30:00", days[i]),
                       "distance": 9000.0})
            })
            .collect();
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("limit", FIRST_USE_ACTIVITIES.to_string())
                .matches(note_activities);
            then.status(200).json_body(json!(landed));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path_matches(httpmock::Regex::new(r"^/activity/r\d/").expect("pattern"))
                .matches(note_activity_body);
            then.status(200).json_body(json!([]));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path_matches(httpmock::Regex::new(r"^/activity/r\d$").expect("pattern"))
                .matches(note_activity_body);
            then.status(200).json_body(json!({
                "icu_athlete_id": "i1",
                "start_date_local": format!("{}T08:30:00", days[0]),
            }));
        });
        mock_ordered_profile_slice(&server);
        taken_requests();

        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(SYNC_SERVICE.try_begin());
        crate::runtime::block_on(perform_sync(
            &SYNC_SERVICE,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        SYNC_SERVICE.clear_credentials();

        let names = taken_request_order();
        let first_bulk = names
            .iter()
            .position(|n| *n == format!("activities {oldest}"))
            .expect("the window behind the first five still runs");
        let bodies: Vec<usize> = names
            .iter()
            .enumerate()
            .filter(|(_, n)| n.as_str() == "activity-body")
            .map(|(i, _)| i)
            .collect();
        assert_eq!(bodies.len(), 6, "three bodies for each of two: {names:?}");
        assert!(
            bodies.iter().all(|i| *i < first_bulk && *i > 1),
            "after the newest rows, before the bulk window: {names:?}"
        );
        for id in ["r0", "r1"] {
            assert!(
                crate::persistence::with_persistent_engine(|engine| engine.get_interval_body(id))
                    .expect("engine")
                    .expect("read")
                    .is_some(),
                "{id} opens with its laps"
            );
        }
    }

    fn note_activity_body(_: &HttpMockRequest) -> bool {
        note_request("activity-body");
        true
    }

    #[test]
    fn test_census_write_failure_falls_back_to_fixed_window_in_perform_sync() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("census-write-failure.db");
        let today = chrono::Local::now().date_naive();
        let old = (today - chrono::Duration::days(20)).to_string();
        let new = (today - chrono::Duration::days(1)).to_string();
        let oldest = (today - chrono::Duration::days(ACTIVITY_DAYS)).to_string();
        crate::persistence::with_persistent_engine(|engine| {
            engine.record_activity_census(
                "i1",
                &[crate::net::types::ActivityCensusEntry {
                    id: "old".into(),
                    start_date_local: Some(format!("{old}T08:00:00")),
                    created: None,
                    icu_sync_date: Some("v1".into()),
                    has_latlng: false,
                }],
            ).expect("census");
            engine
                .store_synced_activity_bodies(
                    "i1",
                    &[("old".into(), 0, "{}".into())],
                    &["old".into()],
                    vec![crate::ActivityMetrics {
                        activity_id: "old".into(),
                        ..Default::default()
                    }],
                )
                .unwrap();
            engine.db.execute_batch("CREATE TRIGGER reject_new_census BEFORE INSERT ON activity_census WHEN NEW.intervals_id = 'new' BEGIN SELECT RAISE(ABORT, 'census full'); END;").unwrap();
        })
        .unwrap();

        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", "2000-01-01");
            then.status(200).json_body(json!([
                {"id": "old", "type": "Ride", "start_date_local": format!("{old}T08:00:00"), "icu_sync_date": "v1"},
                {"id": "new", "type": "Ride", "start_date_local": format!("{new}T08:00:00"), "icu_sync_date": "v1"}
            ]));
        });
        let whole = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", oldest.clone())
                .query_param("newest", today.to_string());
            then.status(200).json_body(json!([
                {"id": "new", "type": "Ride", "name": "New ride", "start_date_local": format!("{new}T08:00:00")}
            ]));
        });
        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(SYNC_SERVICE.try_begin());
        crate::runtime::block_on(perform_sync(
            &SYNC_SERVICE,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        SYNC_SERVICE.clear_credentials();

        whole.assert_hits(2);
        crate::persistence::with_persistent_engine(|engine| {
            assert!(engine.get_activity_body("new").is_some());
        })
        .unwrap();
    }

    /// The census and the two refetch windows of `upgraded_library`, ahead of
    /// the profile slice. The census agrees with what is stored, so any window
    /// asked for is the refetch.
    fn mock_field_refetch(server: &MockServer, recent: &str, old: &str, old_fails: bool) {
        let census: Vec<_> = [("recent", recent), ("old", old)]
            .into_iter()
            .map(|(id, day)| {
                json!({"id": id, "start_date_local": format!("{day}T08:00:00"), "icu_sync_date": "v1"})
            })
            .collect();
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", "2000-01-01");
            then.status(200).json_body(json!(census));
        });
        if old_fails {
            server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/activities")
                    .query_param("oldest", old.to_string());
                then.status(500);
            });
        }
        let pages: Vec<_> = [("recent", recent), ("old", old)]
            .into_iter()
            .map(|(id, day)| {
                json!({"id": id, "type": "Ride", "name": "Refetched",
                       "start_date_local": format!("{day}T08:00:00"), "decoupling": 4.2})
            })
            .collect();
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .matches(super::sync_window_tests::asks_for_decoupling);
            then.status(200).json_body(json!(pages));
        });
        mock_ordered_profile_slice(server);
    }

    fn run_sync(server: &MockServer) {
        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(SYNC_SERVICE.try_begin());
        crate::runtime::block_on(perform_sync(
            &SYNC_SERVICE,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        SYNC_SERVICE.clear_credentials();
    }

    fn stored_decoupling(id: &str) -> Option<f64> {
        crate::persistence::with_persistent_engine(|engine| {
            let body = engine.get_activity_body(id).expect("stored");
            serde_json::from_str::<serde_json::Value>(&body).unwrap()["decoupling"].as_f64()
        })
        .unwrap()
    }

    fn field_stamp() -> Option<String> {
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .get_setting(crate::persistence::settings_keys::ACTIVITY_BODY_FIELDS)
                .unwrap()
        })
        .unwrap()
    }

    /// Scenario: `decoupling` joined the list request, and an athlete upgrading
    /// with a library the census agrees with owed no window, so the Fitness card
    /// stayed empty for every ride they had not opened.
    ///
    /// Expected behaviour: the launch sync refetches every stored activity,
    /// records the field set, and the sync after asks for no window again.
    #[test]
    fn an_upgraded_library_gains_a_new_field_in_one_sync() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("fields-upgrade.db");
        let today = chrono::Local::now().date_naive();
        let recent = (today - chrono::Duration::days(3)).to_string();
        let old = (today - chrono::Duration::days(365)).to_string();
        super::sync_window_tests::upgraded_library(&recent, &old);
        let server = MockServer::start();
        mock_field_refetch(&server, &recent, &old, false);
        taken_requests();

        run_sync(&server);

        assert_eq!(stored_decoupling("recent"), Some(4.2));
        assert_eq!(stored_decoupling("old"), Some(4.2));
        assert_eq!(
            field_stamp(),
            Some(crate::net::types::stored_activity_fields())
        );
        // The refetch did not move the census marks, so nothing reads as an
        // upstream change and nothing is owed.
        crate::persistence::with_persistent_engine(|engine| {
            assert_eq!(
                engine.owed_dates_in_window("i1", &old, &today.to_string()),
                Some(vec![])
            );
        })
        .unwrap();

        taken_requests();
        run_sync(&server);
        let windows: Vec<_> = taken_request_order()
            .into_iter()
            .filter(|name| name.starts_with("activities"))
            .collect();
        assert!(
            windows.is_empty(),
            "nothing is refetched twice: {windows:?}"
        );
    }

    /// Scenario: the refetch of the year-old window fails.
    ///
    /// Expected behaviour: the field set is not recorded, so the next sync asks
    /// again rather than leaving that body on the old set for good.
    #[test]
    fn a_refetch_that_did_not_land_is_not_recorded() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("fields-refetch-fails.db");
        let today = chrono::Local::now().date_naive();
        let recent = (today - chrono::Duration::days(3)).to_string();
        let old = (today - chrono::Duration::days(365)).to_string();
        super::sync_window_tests::upgraded_library(&recent, &old);
        let server = MockServer::start();
        mock_field_refetch(&server, &recent, &old, true);

        run_sync(&server);

        assert_eq!(stored_decoupling("recent"), Some(4.2));
        assert_eq!(stored_decoupling("old"), None);
        assert_eq!(field_stamp(), None);
        let plan = crate::runtime::block_on(owed_activity_windows("i1", true));
        assert!(
            plan.windows
                .iter()
                .any(|w| w.range == (old.clone(), old.clone()))
        );
    }

    #[test]
    fn a_no_store_sync_resumes_durable_detection_debt() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::seeded_global_engine();
        crate::test_globals::clear_detection_handle();
        let before = crate::persistence::with_persistent_engine(|e| e.get_activity_ids().len())
            .expect("engine");
        assert!(
            crate::persistence::with_persistent_engine(|e| e.detection_owed()).expect("engine")
        );

        let server = MockServer::start();
        mock_ordered_profile_slice(&server);
        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(SYNC_SERVICE.try_begin());
        crate::runtime::block_on(perform_sync(
            &SYNC_SERVICE,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        SYNC_SERVICE.clear_credentials();

        assert_eq!(
            crate::persistence::with_persistent_engine(|e| e.get_activity_ids().len())
                .expect("engine"),
            before,
            "the sync did not store an activity"
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while crate::objects::detection::DetectionManager::new().last_outcome() != "complete"
            && std::time::Instant::now() < deadline
        {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(
            crate::objects::detection::DetectionManager::new().last_outcome(),
            "complete",
            "the Rust sync end must ask for owed detection without new stores"
        );
        crate::test_globals::drain_detection();
    }

    /// Scenario: an ordinary launch with one new ride. The owed plan is a
    /// single day, so a count-limited request would fetch the same rows the
    /// window is about to fetch.
    ///
    /// Expected behaviour: the first-use step asks for nothing, and the window
    /// runs as it always did.
    #[test]
    fn a_single_owed_day_costs_no_extra_request() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_first_use_warm.db");
        let today = chrono::Local::now().date_naive();
        let day = today.to_string();
        let census = vec![crate::net::types::ActivityCensusEntry {
            id: "a0".to_string(),
            start_date_local: Some(format!("{day}T08:30:00")),
            created: Some(format!("{day}T08:00:00Z")),
            icu_sync_date: Some(format!("{day}T09:00:00Z")),
            has_latlng: false,
        }];
        crate::persistence::with_persistent_engine(move |engine| {
            engine
                .record_activity_census("i1", &census)
                .expect("census");
        })
        .expect("engine");

        let server = MockServer::start();
        mock_ordered_profile_slice(&server);
        taken_requests();

        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(SYNC_SERVICE.try_begin(), "nothing else holds the sync slot");
        crate::runtime::block_on(perform_sync(
            &SYNC_SERVICE,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        SYNC_SERVICE.clear_credentials();

        let names = taken_request_order();
        assert!(
            !names.iter().any(|name| name.contains("limit")),
            "no count-limited request for a one-day window: {names:?}"
        );
    }

    /// Scenario: a first launch on a slow connection. The standby lifts on the
    /// first stored activity, so every endpoint asked for ahead of the
    /// activities is a round trip the athlete spends watching a spinner, and
    /// the profile, sport settings and wellness went first.
    ///
    /// Expected behaviour: the census, then the newest owed window on its own,
    /// then the three profile endpoints, then the rest of the library. The
    /// census stays ahead of the windows because it is what says which days
    /// are owed.
    #[test]
    fn the_newest_activities_are_asked_for_before_the_profile_slice() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_order.db");
        let today = chrono::Local::now().date_naive();
        let newest = today.to_string();
        let older = (today - chrono::Duration::days(10)).to_string();
        // Two owed days with a gap between them, so the plan has a head and a
        // remainder for the steps to straddle.
        let census: Vec<crate::net::types::ActivityCensusEntry> = [&newest, &older]
            .iter()
            .enumerate()
            .map(|(i, date)| crate::net::types::ActivityCensusEntry {
                id: format!("a{i}"),
                start_date_local: Some(format!("{date}T08:30:00")),
                created: Some(format!("{date}T08:00:00Z")),
                icu_sync_date: Some(format!("{date}T09:00:00Z")),
                has_latlng: false,
            })
            .collect();
        crate::persistence::with_persistent_engine(move |engine| {
            engine
                .record_activity_census("i1", &census)
                .expect("census");
        })
        .expect("engine");

        let server = MockServer::start();
        mock_ordered_profile_slice(&server);
        taken_request_order();

        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));

        assert_eq!(
            taken_request_order(),
            vec![
                "census".to_string(),
                format!("activities {newest}"),
                "athlete".to_string(),
                "sport-settings".to_string(),
                "wellness".to_string(),
                format!("activities {older}"),
            ]
        );
    }

    /// Scenario: a first launch sits on the standby while the sync walks its
    /// endpoints, which is the run F20 was taken from and the run whose line
    /// said "0 of 7 activities".
    ///
    /// Expected behaviour: the status names the endpoint being fetched, at the
    /// moment it is being fetched. The step is read inside the mock's matcher,
    /// so this is the label an athlete would have been shown rather than a
    /// sample taken somewhere near it.
    #[test]
    fn a_running_sync_names_the_step_it_is_fetching() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_step_order.db");
        let today = chrono::Local::now().date_naive();
        let newest = today.to_string();
        let older = (today - chrono::Duration::days(10)).to_string();
        // Two owed days with a gap between them, so the plan has a head and a
        // remainder and the two activity steps are told apart.
        let census: Vec<crate::net::types::ActivityCensusEntry> = [&newest, &older]
            .iter()
            .enumerate()
            .map(|(i, date)| crate::net::types::ActivityCensusEntry {
                id: format!("a{i}"),
                start_date_local: Some(format!("{date}T08:30:00")),
                created: Some(format!("{date}T08:00:00Z")),
                icu_sync_date: Some(format!("{date}T09:00:00Z")),
                has_latlng: false,
            })
            .collect();
        crate::persistence::with_persistent_engine(move |engine| {
            engine
                .record_activity_census("i1", &census)
                .expect("census");
        })
        .expect("engine");

        let server = MockServer::start();
        mock_ordered_profile_slice(&server);
        taken_requests();

        // The process-wide service, because the matcher that reads the step is
        // a bare `fn` and can reach no other one.
        SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(SYNC_SERVICE.try_begin(), "nothing else holds the sync slot");
        crate::runtime::block_on(perform_sync(
            &SYNC_SERVICE,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));

        assert_eq!(
            taken_requests(),
            vec![
                ("census".to_string(), Some(FfiSyncStep::Census)),
                (
                    format!("activities {newest}"),
                    Some(FfiSyncStep::Activities)
                ),
                ("athlete".to_string(), Some(FfiSyncStep::Athlete)),
                (
                    "sport-settings".to_string(),
                    Some(FfiSyncStep::SportSettings)
                ),
                ("wellness".to_string(), Some(FfiSyncStep::Wellness)),
                (
                    format!("activities {older}"),
                    Some(FfiSyncStep::RemainingActivities)
                ),
            ]
        );
        assert_eq!(
            SYNC_SERVICE.snapshot().step,
            None,
            "the settled run names no step"
        );
        SYNC_SERVICE.clear_credentials();
    }

    /// Scenario: a first launch. Every reader of the `activities` channel was
    /// woken by the settle alone, which on a slow connection is the profile
    /// slice, the rest of the library, the curves and every owed interval body
    /// after the head window's rows are already in SQLite. So the feed held
    /// its standby and the preview fetch had not started.
    ///
    /// Expected behaviour: each activity step announces the rows it stored, so
    /// the head's cards and their previews start on that rather than on the
    /// settle. A step that stored nothing announces nothing.
    #[test]
    fn each_activity_step_announces_its_rows_before_the_sync_settles() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_announce.db");
        let today = chrono::Local::now().date_naive();
        let newest = today.to_string();
        let older = (today - chrono::Duration::days(10)).to_string();
        let census: Vec<crate::net::types::ActivityCensusEntry> = [&newest, &older]
            .iter()
            .enumerate()
            .map(|(i, date)| crate::net::types::ActivityCensusEntry {
                id: format!("a{i}"),
                start_date_local: Some(format!("{date}T08:30:00")),
                created: Some(format!("{date}T08:00:00Z")),
                icu_sync_date: Some(format!("{date}T09:00:00Z")),
                has_latlng: false,
            })
            .collect();
        crate::persistence::with_persistent_engine(move |engine| {
            engine
                .record_activity_census("i1", &census)
                .expect("census");
        })
        .expect("engine");

        let server = MockServer::start();
        // Before the profile slice, because the first mock a request matches
        // is the one that answers it and that slice holds a catch-all for the
        // activities path. Only the head day carries an activity: the
        // remainder window falls through to the empty page, so it stores
        // nothing and owes no announcement.
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", newest.clone())
                .query_param("newest", newest.clone());
            then.status(200).json_body(json!([
                {"id": "a0", "type": "Ride", "name": "Loop",
                 "start_date_local": format!("{newest}T08:30:00"), "distance": 9000.0}
            ]));
        });
        mock_profile_slice(&server, 200);

        let recorder = crate::objects::observer::recorder::Recorder::new();
        crate::objects::observer::set_observer(Some(recorder.clone()));

        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        crate::objects::observer::flush();
        crate::objects::observer::set_observer(None);

        let events = recorder.events();
        let stored = events.iter().position(|e| e == "activities_stored");
        let settled = events.iter().position(|e| e == "sync_settled");
        assert!(
            matches!((stored, settled), (Some(s), Some(t)) if s < t),
            "the head's rows land long before the settle, the events were: {events:?}"
        );
        assert_eq!(
            events.iter().filter(|e| *e == "activities_stored").count(),
            1,
            "the empty remainder window announces nothing: {events:?}"
        );
    }

    #[test]
    fn step_items_are_reported_for_the_running_step_and_cleared_between_steps() {
        let svc = SyncService::new();
        svc.begin_steps(3);
        svc.begin_step(FfiSyncStep::IntervalBodies);
        let s = svc.snapshot();
        assert_eq!((s.step_items_done, s.step_items_total), (0, 0));

        svc.set_step_items(4, 250);
        let s = svc.snapshot();
        assert_eq!((s.step_items_done, s.step_items_total), (4, 250));

        svc.complete_step();
        svc.begin_step(FfiSyncStep::RecordActivities);
        let s = svc.snapshot();
        assert_eq!(
            (s.step_items_done, s.step_items_total),
            (0, 0),
            "the next step does not inherit the last one's count"
        );

        svc.set_step_items(1, 2);
        svc.finish(SyncState::Idle, None, true);
        let s = svc.snapshot();
        assert_eq!((s.step_items_done, s.step_items_total), (0, 0));
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
            crate::persistence::engine_install(),
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

    /// Scenario: the profile write fails, the shape a busy connection or a
    /// constraint takes, here a table that is not there.
    ///
    /// Expected behaviour: the step fails with a storage reason. It used to
    /// count as complete, so the run reported success and every reader kept
    /// the previous athlete's profile, FTP and zones with nothing to say so.
    #[test]
    fn a_failed_profile_write_fails_its_step() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .execute_batch("DROP TABLE athlete_profile")
                .expect("drop");
        })
        .expect("engine");
        let server = MockServer::start();
        mock_profile_slice(&server, 200);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(
            s.completed,
            SYNC_STEPS - 1,
            "the failed step is not counted"
        );
        assert_eq!(s.last_error_reason, Some(FfiSyncErrorReason::Storage));
        assert!(
            s.last_error
                .as_deref()
                .is_some_and(|e| e.contains("athlete profile store failed")),
            "the reason names the write: {:?}",
            s.last_error
        );
        assert!(
            s.last_error
                .as_deref()
                .is_some_and(|e| e.starts_with("Athlete: ")),
            "the failure names the step that ran: {:?}",
            s.last_error
        );
    }

    /// Scenario: the library read fails under a sweep that derives its work
    /// from SQLite. Both sweeps read `activity_metrics`: the curves for the
    /// sports they cover, the intervals for the activities still owed a body.
    ///
    /// Expected behaviour: each reports a storage failure naming its own read.
    /// An empty list used to mean both "nothing to fetch" and "the read
    /// failed", so a sweep fetched nothing and the run still reported success.
    #[test]
    fn a_failed_library_read_fails_the_sweep_that_needed_it() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .execute_batch("DROP TABLE activity_metrics")
                .expect("drop");
        })
        .expect("engine");
        let server = MockServer::start();
        mock_profile_slice(&server, 200);
        let transport = transport_to(server.base_url());

        let curves = crate::runtime::block_on(sync_curves(
            crate::persistence::engine_install(),
            &transport,
            "i1",
            &|| false,
        ));
        assert!(
            matches!(&curves, Err(e) if e.to_string().contains("curve plan read failed")),
            "the reason names the read: {curves:?}"
        );
        assert_eq!(
            curves
                .as_ref()
                .err()
                .map(SyncFailure::from)
                .map(|f| f.reason),
            Some(FfiSyncErrorReason::Storage)
        );

        let intervals = crate::runtime::block_on(sync_interval_bodies(
            crate::persistence::engine_install(),
            &transport,
            &|| false,
            &|_, _| {},
        ));
        assert!(
            matches!(&intervals, Err(e) if e.to_string().contains("interval queue read failed")),
            "the reason names the read: {intervals:?}"
        );
        assert_eq!(
            intervals
                .as_ref()
                .err()
                .map(SyncFailure::from)
                .map(|f| f.reason),
            Some(FfiSyncErrorReason::Storage)
        );
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
            crate::persistence::engine_install(),
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
            crate::persistence::engine_install(),
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
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        let s = svc.snapshot();
        assert_eq!(s.state, SyncState::Idle);
        // Every step that reached the server failed. The four that did not
        // are the ones with nothing to ask for: the two sweeps that derive
        // their work from an empty library, the restored-record fetch, which
        // owes nothing on a library no backup was restored into, and the
        // remainder window, which a census that never landed leaves the head
        // step covering whole.
        assert_eq!(s.completed, 4);
        assert!(s.last_error.is_some());
        // Each failing step asks for the whole ladder, and the test spends
        // none of it.
        let ladder = std::time::Duration::from_millis(400 + 800 + 1600);
        let asked = crate::test_globals::recorded_pause();
        assert!(asked >= ladder, "asked for {asked:?}");
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
            crate::persistence::engine_install(),
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
            crate::persistence::engine_install(),
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
            crate::persistence::engine_install(),
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

        crate::runtime::block_on(perform_sync(
            &svc,
            crate::persistence::engine_install(),
            transport,
            "i1".into(),
        ));

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

        crate::runtime::block_on(perform_sync(
            &svc,
            crate::persistence::engine_install(),
            transport,
            "i1".into(),
        ));

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

        crate::runtime::block_on(perform_sync(
            &svc,
            crate::persistence::engine_install(),
            transport,
            "i1".into(),
        ));

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
            when.method(GET).path("/athlete/i1/events");
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
            crate::persistence::engine_install(),
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
            crate::persistence::engine_install(),
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
        assert_eq!(row.power_zone_times, Some(vec![10, 20, 0, 0, 0, 0, 0]));
        assert_eq!(row.hr_zone_times, Some(vec![11, 22]));
    }

    #[test]
    fn power_zone_seconds_are_read_by_id_so_sweet_spot_never_takes_a_zone_slot() {
        let record: ActivityRecord = serde_json::from_value(json!({
            "id": "a4",
            "start_date_local": "2026-01-02T08:00:00",
            "icu_zone_times": [
                {"id": "SS", "secs": 999},
                {"id": "Z2", "secs": 20},
                {"id": "Z1", "secs": 10},
                {"id": "Z7", "secs": 70},
                {"id": "Z8", "secs": 80},
            ],
        }))
        .expect("record");

        let row = activity_metrics_row(record, 1_767_340_800);

        assert_eq!(row.power_zone_times, Some(vec![10, 20, 0, 0, 0, 0, 70]));
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
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("default_activity_window.db");
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

        let install = crate::persistence::engine_install();
        let transport = transport_to(server.base_url());
        crate::runtime::block_on(async {
            let windows = owed_activity_windows("i1", true).await.windows;
            sync_activity_windows(install, &transport, "i1", &windows, &|| false).await
        })
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

        crate::runtime::block_on(sync_wellness(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
        ))
        .expect("wellness sync");

        crate::objects::observer::flush();
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

        crate::runtime::block_on(sync_wellness(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
        ))
        .expect("wellness sync");

        crate::objects::observer::flush();
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
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("default_wellness_window.db");
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

        crate::runtime::block_on(sync_wellness(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
        ))
        .expect("wellness sync");
        mock.assert();
    }

    #[test]
    fn a_window_older_than_the_default_still_reaches_the_api() {
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("older_activity_window.db");
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
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2019-01-01",
            "2019-12-31",
            None,
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
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("rolling_eftp_window.db");
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
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2026-01-01",
            "2026-01-31",
            None,
            &|| false,
        ))
        .expect("window");
        mock.assert();
    }

    #[test]
    fn activity_window_sync_stores_bodies_and_metrics() {
        // The window writes what it fetched, so it needs a library to write
        // into: without one the step now fails the run rather than reporting
        // a success that stored nothing.
        let _guard = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("window-sync.db");
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
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            None,
            &|| false,
        ))
        .expect("window sync");
        mock.assert();
    }

    /// Scenario: the reconcile that matches a server record against the row
    /// the device already minted for it reads the `activities` table. A failed
    /// read used to answer with an empty map, which reads as "nothing claims
    /// this id" and stores the same ride again under the server's key.
    ///
    /// Expected behaviour: the page is not written at all, and the step fails
    /// so the next sync fetches it again.
    #[test]
    fn a_window_whose_id_reconcile_fails_stores_nothing() {
        let _guard = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("reconcile-fail.db");
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .execute_batch("DROP TABLE activities")
                .expect("drop");
        });
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200).json_body(json!([
                {"id": "a1", "type": "Ride", "name": "Loop",
                 "start_date_local": "2025-01-15T08:30:00", "distance": 28400.0}
            ]));
        });

        let outcome = crate::runtime::block_on(sync_activity_window(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            None,
            &|| false,
        ));

        assert!(
            outcome.is_err(),
            "a reconcile it never got is not a success"
        );
        let stored = crate::runtime::block_on(crate::persistence::with_persistent_engine_blocking(
            |engine| engine.get_activity_body("a1"),
        ))
        .flatten();
        assert!(
            stored.is_none(),
            "the page was written without its reconcile"
        );
    }

    /// Scenario: the activities that moved the accepted eFTP were found in
    /// TypeScript, by reading `icu_rolling_ftp_delta` off every parsed body in
    /// the window on every render of the fitness plot.
    ///
    /// Expected behaviour: the window stores the marker as it stores the
    /// metrics, and an activity that only produced an estimate is not one.
    #[test]
    fn a_window_stores_the_activities_that_moved_the_eftp() {
        let _guard = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("eftp-markers.db");
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200).json_body(json!([
                {"id": "moved", "type": "Ride", "name": "Hill repeats",
                 "start_date_local": "2025-01-15T08:30:00", "distance": 28400.0,
                 "icu_rolling_ftp": 367.0, "icu_rolling_ftp_delta": 20.0},
                {"id": "steady", "type": "Ride", "name": "Commute",
                 "start_date_local": "2025-01-16T08:30:00", "distance": 9000.0,
                 "icu_rolling_ftp": 367.0, "icu_rolling_ftp_delta": 0.0},
                {"id": "silent", "type": "Ride", "name": "Recovery",
                 "start_date_local": "2025-01-17T08:30:00", "distance": 9000.0},
                {"id": "half", "type": "Ride", "name": "Half a pair",
                 "start_date_local": "2025-01-18T08:30:00", "icu_rolling_ftp_delta": 5.0},
                {"id": "undated", "type": "Ride", "name": "No start time",
                 "icu_rolling_ftp": 367.0, "icu_rolling_ftp_delta": 9.0}
            ]));
        });

        crate::runtime::block_on(sync_activity_window(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            None,
            &|| false,
        ))
        .expect("window");

        let markers = crate::runtime::block_on(
            crate::persistence::with_persistent_engine_blocking(|engine| engine.eftp_changes()),
        )
        .unwrap_or_default();

        assert_eq!(
            markers
                .iter()
                .map(|m| m.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["moved"],
            "only a non-zero delta on a dated activity with a rolling value is a change"
        );
        assert_eq!(markers[0].eftp, 367.0);
        assert_eq!(markers[0].delta, 20.0);
        assert_eq!(markers[0].activity_name, "Hill repeats");
    }

    /// Scenario: launch twice and scroll the feed to the same page. The first
    /// launch's process-local `Set` is gone, so the window is asked for again
    /// and a 30-day range already complete in SQLite is downloaded a second
    /// time.
    ///
    /// Expected behaviour: a stored window marks the census rows it wrote at
    /// the version it fetched, and the engine then answers that the window owes
    /// nothing. The mark is the server's id, because the row it is stored under
    /// may be a local key for an activity this device uploaded.
    #[test]
    fn a_stored_window_marks_what_it_fetched_so_the_next_ask_owes_nothing() {
        let _guard = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("window-coverage.db");
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200).json_body(json!([
                {"id": "w1", "type": "Ride", "name": "Loop",
                 "start_date_local": "2025-01-15T08:30:00", "distance": 9000.0},
                {"id": "w2", "type": "Ride", "name": "Commute",
                 "start_date_local": "2025-01-16T08:30:00", "distance": 9000.0}
            ]));
        });
        let census = vec![
            crate::net::types::ActivityCensusEntry {
                id: "w1".into(),
                start_date_local: Some("2025-01-15T08:30:00".into()),
                created: Some("2025-01-15T08:00:00Z".into()),
                icu_sync_date: Some("2025-01-15T09:00:00Z".into()),
                has_latlng: false,
            },
            crate::net::types::ActivityCensusEntry {
                id: "w2".into(),
                start_date_local: Some("2025-01-16T08:30:00".into()),
                created: Some("2025-01-16T08:00:00Z".into()),
                icu_sync_date: Some("2025-01-16T09:00:00Z".into()),
                has_latlng: false,
            },
        ];
        crate::persistence::with_persistent_engine(move |engine| {
            engine
                .record_activity_census("i1", &census)
                .expect("census");
        })
        .expect("engine");

        // Before the window runs the census names two activities the device
        // does not hold, so the window owes the download.
        assert!(
            !crate::persistence::with_persistent_engine(|engine| {
                engine.window_is_covered("i1", "2025-01-01", "2025-01-31")
            })
            .expect("engine"),
            "a window whose activities are not stored owes the download"
        );

        crate::runtime::block_on(sync_activity_window(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            None,
            &|| false,
        ))
        .expect("window");

        assert!(
            crate::persistence::with_persistent_engine(|engine| {
                engine.window_is_covered("i1", "2025-01-01", "2025-01-31")
            })
            .expect("engine"),
            "the window that just stored both activities owes nothing"
        );
        // A neighbouring window is untouched: coverage is per date, not a flag
        // saying a sync has run.
        assert!(
            !crate::persistence::with_persistent_engine(|engine| {
                engine.window_is_covered("i2", "2025-01-01", "2025-01-31")
            })
            .expect("engine"),
            "another athlete's coverage is not this one's"
        );
    }

    /// Scenario: the launch sync asked for a fixed year on every run, whatever
    /// was already in SQLite, and the census that could have said otherwise was
    /// pulled a step later and thrown away.
    ///
    /// Expected behaviour: the window step asks the census what is still owed
    /// and fetches only that. An unchanged library asks for nothing, one new
    /// ride is a one-day window, and a census that cannot answer leaves the
    /// fixed window running.
    mod owed_windows_from_the_census {
        use super::*;

        fn day(offset: i64) -> String {
            (chrono::Local::now().date_naive() - chrono::Duration::days(offset)).to_string()
        }

        fn entry(id: &str, date: &str) -> crate::net::types::ActivityCensusEntry {
            crate::net::types::ActivityCensusEntry {
                id: id.into(),
                start_date_local: Some(format!("{date}T08:30:00")),
                created: Some(format!("{date}T08:00:00Z")),
                icu_sync_date: Some(format!("{date}T09:00:00Z")),
                has_latlng: false,
            }
        }

        /// The activity pull the way `perform_sync` runs it: the plan read
        /// from the census, then every window in it.
        fn sync_owed(server: &MockServer) -> Result<(), NetError> {
            let install = crate::persistence::engine_install();
            let transport = transport_to(server.base_url());
            crate::runtime::block_on(async {
                let windows = owed_activity_windows("i1", true).await.windows;
                sync_activity_windows(install, &transport, "i1", &windows, &|| false).await
            })
        }

        fn record(census: Vec<crate::net::types::ActivityCensusEntry>) {
            crate::persistence::with_persistent_engine(move |engine| {
                engine
                    .record_activity_census("i1", &census)
                    .expect("census");
            })
            .expect("engine");
        }

        /// Store one activity the way a window sync does, so the census row for
        /// it is marked fetched and its body is on disk.
        fn store(server: &MockServer, id: &str, date: &str) {
            let mut mock = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/activities")
                    .query_param("oldest", date.to_string())
                    .query_param("newest", date.to_string());
                then.status(200).json_body(json!([
                    {"id": id, "type": "Ride", "name": "Loop",
                     "start_date_local": format!("{date}T08:30:00"), "distance": 9000.0}
                ]));
            });
            crate::runtime::block_on(sync_activity_window(
                crate::persistence::engine_install(),
                &transport_to(server.base_url()),
                "i1",
                date,
                date,
                None,
                &|| false,
            ))
            .expect("the seeding window");
            mock.delete();
        }

        #[test]
        fn a_library_the_census_agrees_with_asks_for_nothing() {
            let _guard = crate::test_globals::serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("owed-none.db");
            let server = MockServer::start();
            let date = day(3);
            record(vec![entry("a1", &date)]);
            store(&server, "a1", &date);

            let any = server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/activities");
                then.status(200).json_body(json!([]));
            });

            sync_owed(&server).expect("the step");

            any.assert_hits(0);
        }

        #[test]
        fn an_activity_the_device_does_not_hold_is_asked_for_by_its_own_day() {
            let _guard = crate::test_globals::serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("owed-one.db");
            let server = MockServer::start();
            let held = day(9);
            let owed = day(4);
            record(vec![entry("a1", &held), entry("a2", &owed)]);
            store(&server, "a1", &held);

            let one_day = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/activities")
                    .query_param("oldest", owed.clone())
                    .query_param("newest", owed.clone());
                then.status(200).json_body(json!([
                    {"id": "a2", "type": "Ride", "name": "Loop",
                     "start_date_local": format!("{owed}T08:30:00"), "distance": 9000.0}
                ]));
            });
            let anything_else = server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/activities");
                then.status(200).json_body(json!([]));
            });

            sync_owed(&server).expect("the step");

            one_day.assert_hits(1);
            anything_else.assert_hits(0);
        }

        #[test]
        fn a_version_that_moved_upstream_is_asked_for_again() {
            let _guard = crate::test_globals::serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("owed-moved.db");
            let server = MockServer::start();
            let date = day(6);
            record(vec![entry("a1", &date)]);
            store(&server, "a1", &date);

            // The same activity, edited upstream: a later `icu_sync_date`
            // against the one the device came away with.
            let mut moved = entry("a1", &date);
            moved.icu_sync_date = Some(format!("{date}T18:00:00Z"));
            record(vec![moved]);

            let again = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/activities")
                    .query_param("oldest", date.clone())
                    .query_param("newest", date.clone());
                then.status(200).json_body(json!([]));
            });

            sync_owed(&server).expect("the step");

            again.assert_hits(1);
        }

        #[test]
        fn a_census_that_cannot_answer_leaves_the_fixed_window_running() {
            let _guard = crate::test_globals::serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("owed-no-census.db");
            let server = MockServer::start();

            let whole = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/activities")
                    .query_param("oldest", day(ACTIVITY_DAYS))
                    .query_param("newest", day(0));
                then.status(200).json_body(json!([]));
            });

            sync_owed(&server).expect("the step");

            whole.assert_hits(1);
        }

        #[test]
        fn consecutive_days_are_one_window_and_a_gap_starts_another() {
            let windows = owed_windows(&[
                "2025-03-01".to_string(),
                "2025-03-02".to_string(),
                "2025-03-03".to_string(),
                "2025-03-09".to_string(),
            ]);

            assert_eq!(
                windows,
                vec![
                    ("2025-03-09".to_string(), "2025-03-09".to_string()),
                    ("2025-03-01".to_string(), "2025-03-03".to_string()),
                ]
            );
        }

        /// Scenario: a fresh install owes a run two months back and a run from
        /// yesterday. Expected behaviour: the recent run is asked for first,
        /// because the feed reads newest first and that is the end of the
        /// library the athlete watches fill.
        #[test]
        fn the_newest_run_is_asked_for_first() {
            let windows = owed_windows(&[
                "2025-03-01".to_string(),
                "2025-03-02".to_string(),
                "2025-05-09".to_string(),
            ]);

            assert_eq!(
                windows,
                vec![
                    ("2025-05-09".to_string(), "2025-05-09".to_string()),
                    ("2025-03-01".to_string(), "2025-03-02".to_string()),
                ]
            );
        }

        #[test]
        fn nothing_owed_is_no_window_at_all() {
            assert!(owed_windows(&[]).is_empty());
        }

        #[test]
        fn a_month_boundary_is_still_one_run() {
            let windows = owed_windows(&["2025-01-31".to_string(), "2025-02-01".to_string()]);

            assert_eq!(
                windows,
                vec![("2025-01-31".to_string(), "2025-02-01".to_string())]
            );
        }

        /// A library holed through the year would be one request per hole, and
        /// the windows that replace them are capped rather than unbounded. The
        /// head comes first so the feed has cards before the rest lands.
        #[test]
        fn a_library_holed_everywhere_collapses_to_a_head_and_a_remainder() {
            let scattered: Vec<String> = (0..MAX_OWED_WINDOWS + 1)
                .map(|i| {
                    (chrono::NaiveDate::from_ymd_opt(2025, 1, 1).expect("date")
                        + chrono::Duration::days(i as i64 * 3))
                    .to_string()
                })
                .collect();

            let windows = owed_windows(&scattered);

            assert_eq!(windows.len(), 2, "a head and the rest, not one span");
            let newest = scattered.last().expect("scattered");
            let head_start = &scattered[scattered.len() - HEAD_OWED_DAYS];
            assert_eq!(windows[0], (head_start.clone(), newest.clone()));
            assert_eq!(windows[1], (scattered[0].clone(), head_start.clone()));
        }

        /// The head is the newest owed days, whatever the calendar span they
        /// happen to cover: an athlete who rides daily gets ten days of it and
        /// one who rides monthly gets most of a year, and both get cards.
        #[test]
        fn the_head_is_counted_in_owed_days_and_not_in_calendar_days() {
            let sparse: Vec<String> = (0..MAX_OWED_WINDOWS + 1)
                .map(|i| {
                    (chrono::NaiveDate::from_ymd_opt(2025, 1, 1).expect("date")
                        + chrono::Duration::days(i as i64 * 30))
                    .to_string()
                })
                .collect();

            let windows = owed_windows(&sparse);

            let head = &windows[0];
            let start = chrono::NaiveDate::parse_from_str(&head.0, "%Y-%m-%d").expect("start");
            let end = chrono::NaiveDate::parse_from_str(&head.1, "%Y-%m-%d").expect("end");
            assert_eq!((end - start).num_days(), 30 * (HEAD_OWED_DAYS as i64 - 1));
        }

        /// A library with fewer owed runs than the cap is already answered one
        /// run at a time, newest first, so it needs no head of its own.
        #[test]
        fn a_library_under_the_cap_is_left_run_by_run() {
            let few: Vec<String> = (0..5)
                .map(|i| {
                    (chrono::NaiveDate::from_ymd_opt(2025, 1, 1).expect("date")
                        + chrono::Duration::days(i as i64 * 3))
                    .to_string()
                })
                .collect();

            let windows = owed_windows(&few);

            assert_eq!(windows.len(), 5);
            assert_eq!(windows[0], (few[4].clone(), few[4].clone()));
        }

        /// The smallest library that collapses still splits, because the head
        /// is smaller than the cap. The compile-time assertion beside the
        /// constants is what holds that; this is the behaviour it buys.
        #[test]
        fn the_smallest_collapsing_library_still_gets_a_head() {
            let just_over: Vec<String> = (0..MAX_OWED_WINDOWS + 1)
                .map(|i| {
                    (chrono::NaiveDate::from_ymd_opt(2025, 1, 1).expect("date")
                        + chrono::Duration::days(i as i64 * 3))
                    .to_string()
                })
                .collect();

            let windows = owed_windows(&just_over);

            assert_eq!(windows.len(), 2);
            assert_ne!(windows[0].0, windows[1].0, "the head is not the remainder");
        }
    }

    /// Expected behaviour: a cancel that lands before the job runs stops the
    /// request, not just the write. The state machine is already `Paused` by
    /// then, so a request that still goes out spends the athlete's data on a
    /// sync they stopped.
    #[test]
    fn a_window_cancelled_before_it_starts_never_asks_the_api() {
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("cancelled_before_window.db");
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200)
                .json_body(json!([{"id": "a1", "type": "Ride", "name": "Loop",
                                   "start_date_local": "2025-01-15T08:30:00"}]));
        });

        let outcome = crate::runtime::block_on(sync_activity_window(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            None,
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
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("cancelled_in_flight_window.db");
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
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            None,
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
        let _serial = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("cancelled_job_window.db");
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        svc.request_cancel();

        // An unroutable base stands in for a mock that would fail the test if
        // it were hit: a cancelled job must not dispatch at all.
        crate::runtime::block_on(perform_window_sync(
            &svc,
            crate::persistence::engine_install(),
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
        let _guard = crate::test_globals::serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("window-no-start.db");
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200)
                .json_body(json!([{"id": "a1", "type": "Ride"}]));
        });

        crate::runtime::block_on(sync_activity_window(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            None,
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

    /// `FinishGuard` acts on the process-wide `SYNC_SERVICE`, so this test
    /// holds the shared test lock.
    #[test]
    fn a_panicking_sync_task_releases_the_running_slot() {
        let _serial = crate::test_globals::serial_global_state();
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

    /// Scenario: the sync's own step is refused and the confirmation agrees the
    /// credential is dead. Nothing latches, so a `sync_now` arriving before the
    /// sign-out lands starts a fresh run on the same dead credential.
    ///
    /// Expected behaviour: a confirmed rejection parks the service however it
    /// was found, and only a credential change releases it.
    #[test]
    fn a_confirmed_401_from_the_sync_itself_latches_the_park() {
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        let server = MockServer::start();
        mock_profile_slice(&server, 401);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));

        assert_eq!(svc.snapshot().state, SyncState::AuthExpired);
        assert!(
            !svc.try_begin(),
            "a rejected credential may not start another run"
        );
        svc.set_credentials(AuthKind::ApiKey, "fresh".into(), "i1".into());
        assert!(svc.try_begin(), "a new credential releases the park");
    }

    #[test]
    fn auth_expired_recovers_on_next_begin() {
        // `perform_sync` reads the library for its curve sweep, so these
        // drive global engine state even with a local service.
        let _serial = crate::test_globals::serial_global_state();
        let _engine_dir = crate::test_globals::init_global_engine("sync_steps.db");
        // After a 401 the service rests in authExpired and the park is latched.
        // Once TypeScript re-auths, the credential change releases it and
        // sync_now moves it back into syncing. The re-auth is what this test
        // was always describing; it used to be left implicit.
        let server = MockServer::start();
        mock_profile_slice(&server, 401);
        let svc = SyncService::new();
        svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
        assert!(svc.try_begin());
        crate::runtime::block_on(perform_sync(
            &svc,
            crate::persistence::engine_install(),
            transport_to(server.base_url()),
            "i1".into(),
        ));
        assert_eq!(svc.snapshot().state, SyncState::AuthExpired);
        svc.set_credentials(AuthKind::ApiKey, "fresh".into(), "i1".into());
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
    use crate::net::offline_prefetch::ALL_TIME_CURVE_DAYS;
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
        fn activities_stored(&self) {}
        fn body_stored(&self, kind: String, activity_id: String) {
            self.seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(format!("{kind}:{activity_id}"));
        }
        fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
        fn gps_track_stored(&self, _activity_id: String) {}
        fn gps_tracks_mutated(&self, _activity_ids: Vec<String>) {}
        fn fit_parsed(&self, _activity_id: String) {}
        fn detection_applied(&self) {}
        fn tiles_generated(&self) {}
        fn backfill_phase(&self, _phase: String) {}
        fn stream_backfill_phase(&self, _phase: String) {}
        fn preview_phase(&self, _phase: String) {}
        fn cutover_settled(&self) {}
        fn preview_finished(&self) {}
        fn recordings_changed(&self) {}
        fn upload_permission_refused(&self) {}
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

    /// A restore lands while a page is in flight. The write finishes and
    /// stores a body fetched against the old library into the restored one,
    /// which is the detection apply's failing case with a sync in it.
    #[test]
    fn a_body_from_the_library_before_a_restore_is_not_stored() {
        let _guard = serial_global_state();
        let _first = init_global_engine();
        let started_against = crate::persistence::engine_install();

        let _second = init_global_engine();
        assert_ne!(crate::persistence::engine_install(), started_against);

        let before = bodies_stored();
        crate::runtime::block_on(store_body(
            started_against,
            "fixture",
            String::new(),
            |engine| engine.set_athlete_profile("{}"),
        ));

        assert_eq!(
            bodies_stored(),
            before,
            "a body fetched against the old library reached the restored one"
        );
    }

    /// The stamp must not refuse the run it belongs to.
    #[test]
    fn a_body_from_the_library_it_started_against_is_stored() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();

        let before = bodies_stored();
        crate::runtime::block_on(store_body(
            crate::persistence::engine_install(),
            "fixture",
            String::new(),
            |engine| engine.set_athlete_profile("{}"),
        ));

        assert!(bodies_stored() > before, "the write did not land");
    }

    #[test]
    fn a_write_that_fails_does_not_count() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();

        let before = bodies_stored();
        crate::runtime::block_on(store_body(
            crate::persistence::engine_install(),
            "fixture",
            String::new(),
            |_engine| Err(rusqlite::Error::InvalidQuery),
        ));
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
    /// Scenario: Clear and Sync, or a restore, destroys the engine while a
    /// sync is running. Every remaining write was dropped, each step still
    /// answered `Ok`, and `finish` reported the run a success, so the health
    /// row stamped `lastSuccessAt` and told the athlete the library was fresh
    /// as of that moment.
    ///
    /// Expected behaviour: a step whose write found no engine fails the run,
    /// with a reason that names what happened rather than the catch-all.
    #[test]
    fn a_step_that_found_no_engine_fails_the_run() {
        let _guard = serial_global_state();
        *crate::persistence::PERSISTENT_ENGINE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;

        let outcome = crate::runtime::block_on(store_body_or_fail(
            crate::persistence::engine_install(),
            "fixture",
            "no-engine".into(),
            |_engine| Ok(()),
        ));

        assert!(matches!(outcome, Err(NetError::EngineClosed)));
        let failure = SyncFailure::from(&NetError::EngineClosed);
        assert_eq!(failure.reason, FfiSyncErrorReason::EngineClosed);
        assert_eq!(failure.message, "the engine closed during the run");
    }

    /// The same for a step that writes through the engine directly rather
    /// than through `store_body`.
    #[test]
    fn a_direct_step_write_with_no_engine_fails_the_run_too() {
        let _guard = serial_global_state();
        *crate::persistence::PERSISTENT_ENGINE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;

        let answered = crate::runtime::block_on(
            crate::persistence::with_persistent_engine_blocking(|_engine| ()),
        );

        assert!(
            answered.is_none(),
            "no engine answers, which is what the step maps to EngineClosed"
        );
    }

    /// A run that never lost its engine still reports success, or the fix
    /// would have turned every sync into a failure.
    #[test]
    fn a_step_with_an_engine_still_succeeds() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("engine-closed.db");

        let outcome = crate::runtime::block_on(store_body_or_fail(
            crate::persistence::engine_install(),
            "fixture",
            "present".into(),
            |_engine| Ok(()),
        ));

        assert!(outcome.is_ok());
    }

    /// A write that reached the engine and failed in SQL is a third outcome:
    /// not a closed engine, and not a success either. Counting it as one
    /// stamped `lastSuccessAt` on a run whose page never landed.
    #[test]
    fn a_sql_failure_fails_the_step_as_storage_and_not_as_a_closed_engine() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("engine-closed-sql.db");

        let outcome = crate::runtime::block_on(store_body_or_fail(
            crate::persistence::engine_install(),
            "fixture",
            "sql".into(),
            |_engine| Err(rusqlite::Error::ExecuteReturnedResults),
        ));

        let Err(NetError::Storage(message)) = outcome else {
            panic!("a failed write is a storage failure, got {outcome:?}");
        };
        assert!(
            message.contains("fixture"),
            "the failure has to name what did not land: {message}"
        );
    }

    /// The step reports it, so the run that carried it is not a success.
    #[test]
    fn a_failed_store_is_not_counted_as_a_body_stored() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("store-fail-count.db");

        let before = bodies_stored();
        let _ = crate::runtime::block_on(store_body_or_fail(
            crate::persistence::engine_install(),
            "fixture",
            "sql".into(),
            |_engine| Err(rusqlite::Error::ExecuteReturnedResults),
        ));

        assert_eq!(bodies_stored(), before, "a failed write stored nothing");
    }

    /// still is what made a dropped body and a body nobody asked for look the
    /// same in a log.
    #[test]
    fn a_body_with_no_engine_is_counted_and_named() {
        let _guard = serial_global_state();
        crate::test_log::capturing();
        *crate::persistence::PERSISTENT_ENGINE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;

        let stored_before = bodies_stored();
        let discarded_before = bodies_discarded();
        crate::runtime::block_on(store_body(
            crate::persistence::engine_install(),
            "fixture",
            "gone-body".into(),
            |_engine| Ok(()),
        ));

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
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;

        let discarded_before = bodies_discarded();
        crate::runtime::block_on(store_time_stream(
            crate::persistence::engine_install(),
            "gone-stream".into(),
            vec![0, 1, 2],
        ));

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
        crate::runtime::block_on(store_body(
            crate::persistence::engine_install(),
            "fixture",
            "sql-error".into(),
            |_engine| Err(rusqlite::Error::InvalidQuery),
        ));
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

        crate::objects::observer::flush();
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
                .sync_power_curve("Ride".into(), 42.0)
                .started()
        );
        assert!(
            recorder.reaches(1),
            "the curve landed but nothing announced it"
        );
        assert_eq!(recorder.seen(), vec!["power_curve:"]);

        crate::objects::observer::flush();
        set_observer(None);
        restore_service();
    }

    /// Scenario: a curve is fetched and the write is refused.
    ///
    /// Expected behaviour: the key is released as a failed attempt carrying the
    /// storage reason, not forgotten as a success.
    #[test]
    fn a_curve_whose_write_is_refused_releases_as_a_failed_attempt() {
        use crate::persistence::attempts::JobKey;
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/power-curves.json");
            then.status(200).json_body(json!({"list": []}));
        });
        aim_service_at(&server);
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .execute_batch("DROP TABLE curve_bodies")
                .expect("drop");
        })
        .expect("engine");

        assert!(
            SyncManager::new()
                .sync_power_curve("Ride".into(), 42.0)
                .started()
        );
        let key = JobKey::new("power", &["Ride", "42"]);
        let deadline = Instant::now() + Duration::from_secs(10);
        let row = loop {
            let row =
                crate::persistence::with_persistent_engine(|e| e.job_attempt(&key).expect("read"))
                    .expect("engine");
            if let Some(row) = row.filter(|r| r.lease_gen == 0) {
                break Some(row);
            }
            if Instant::now() > deadline {
                break None;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        restore_service();

        let row = row.expect("a refused write left no attempt row behind");
        assert_eq!(row.attempts, 1);
        assert!(
            row.last_error
                .as_deref()
                .is_some_and(|e| e.contains("power_curve store failed")),
            "last_error was {:?}",
            row.last_error
        );
    }

    /// Scenario: interval bodies were fetched only by the detail screen, the
    /// first time it was opened, so an activity never opened online showed no
    /// lap table offline and nothing said the laps had simply never been
    /// downloaded.
    ///
    /// Expected behaviour: one sync step pulls the body of every activity that
    /// has none, and an activity already carrying one is not asked for again.
    mod interval_bodies {
        use super::*;
        use crate::governor::{Governor, NoopPolicy};
        use crate::persistence::with_persistent_engine;
        use crate::types::ActivityMetrics;

        fn transport_to(base: String) -> Transport {
            let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
            Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).expect("transport")
        }

        fn metric(id: &str) -> ActivityMetrics {
            ActivityMetrics {
                activity_id: id.to_string(),
                name: id.to_string(),
                date: 1_700_000_000,
                distance: 1000.0,
                moving_time: 600,
                elapsed_time: 600,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".to_string(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }
        }

        fn library_of(ids: &[&str]) {
            let metrics = ids.iter().map(|id| metric(id)).collect::<Vec<_>>();
            with_persistent_engine(move |engine| {
                engine.set_activity_metrics(metrics).expect("store metrics");
            })
            .expect("engine");
        }

        fn stored(id: &str) -> Option<String> {
            with_persistent_engine(|engine| engine.get_interval_body(id))
                .expect("engine")
                .expect("read")
        }

        fn never_cancelled() -> impl Fn() -> bool + Sync {
            || false
        }

        #[test]
        fn every_activity_without_a_body_is_fetched_once() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["a1", "a2"]);

            let server = MockServer::start();
            let intervals = server.mock(|when, then| {
                when.method(GET).path_matches(
                    httpmock::Regex::new(r"^/activity/a\d/intervals$").expect("pattern"),
                );
                then.status(200)
                    .json_body(json!({"icu_intervals": [{"type": "WORK"}]}));
            });

            let transport = transport_to(server.base_url());
            crate::runtime::block_on(sync_interval_bodies(
                crate::persistence::engine_install(),
                &transport,
                &never_cancelled(),
                &|_, _| {},
            ))
            .expect("the sweep");

            intervals.assert_hits(2);
            assert!(stored("a1").is_some());
            assert!(stored("a2").is_some());
            restore_service();
        }

        #[test]
        fn the_sweep_reports_activities_done_of_activities_owed() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["a1", "a2", "a3"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET).path_matches(
                    httpmock::Regex::new(r"^/activity/a\d/intervals$").expect("pattern"),
                );
                then.status(200)
                    .json_body(json!({"icu_intervals": [{"type": "WORK"}]}));
            });

            let transport = transport_to(server.base_url());
            let reports = std::sync::Mutex::new(Vec::new());
            crate::runtime::block_on(sync_interval_bodies(
                crate::persistence::engine_install(),
                &transport,
                &never_cancelled(),
                &|done, total| reports.lock().unwrap().push((done, total)),
            ))
            .expect("the sweep");

            assert_eq!(
                *reports.lock().unwrap(),
                vec![(0, 3), (1, 3), (2, 3), (3, 3)],
                "the owed count is declared up front, then each fetched body advances it"
            );
            restore_service();
        }

        /// The sweep is a step of the run, not a helper nothing calls: before
        /// this, `perform_sync` had no interval step at all and the body
        /// arrived only when the detail screen asked for it.
        #[test]
        fn a_sync_leaves_no_activity_without_its_interval_body() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["a1"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET).path("/activity/a1/intervals");
                then.status(200)
                    .json_body(json!({"icu_intervals": [{"type": "WORK"}]}));
            });
            server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!([]));
            });

            let svc = SyncService::new();
            svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
            assert!(svc.try_begin());
            crate::runtime::block_on(perform_sync(
                &svc,
                crate::persistence::engine_install(),
                transport_to(server.base_url()),
                "i1".into(),
            ));

            assert!(
                stored("a1").is_some(),
                "the run finished with an activity whose laps were never downloaded"
            );
            restore_service();
        }

        #[test]
        fn an_activity_that_already_has_its_body_is_not_asked_for_again() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["a1", "a2"]);
            with_persistent_engine(|engine| {
                engine.set_interval_body("a1", r#"{"icu_intervals":[]}"#)
            })
            .expect("engine")
            .expect("seed");

            let server = MockServer::start();
            let asked = server.mock(|when, then| {
                when.method(GET).path("/activity/a1/intervals");
                then.status(200).json_body(json!({"icu_intervals": []}));
            });
            server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"icu_intervals": []}));
            });

            let transport = transport_to(server.base_url());
            crate::runtime::block_on(sync_interval_bodies(
                crate::persistence::engine_install(),
                &transport,
                &never_cancelled(),
                &|_, _| {},
            ))
            .expect("the sweep");

            asked.assert_hits(0);
            assert_eq!(
                stored("a1").as_deref(),
                Some(r#"{"icu_intervals":[]}"#),
                "the stored body is left as it is, not refetched over"
            );
            restore_service();
        }

        #[test]
        fn a_cancelled_sync_stops_the_sweep() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["a1"]);

            let server = MockServer::start();
            let any = server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"icu_intervals": []}));
            });

            let transport = transport_to(server.base_url());
            crate::runtime::block_on(sync_interval_bodies(
                crate::persistence::engine_install(),
                &transport,
                &|| true,
                &|_, _| {},
            ))
            .expect("the sweep");

            any.assert_hits(0);
            restore_service();
        }

        #[test]
        fn a_refused_credential_ends_the_sweep_rather_than_being_carried() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["a1", "a2"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET);
                then.status(401);
            });

            let transport = transport_to(server.base_url());
            let outcome = crate::runtime::block_on(sync_interval_bodies(
                crate::persistence::engine_install(),
                &transport,
                &never_cancelled(),
                &|_, _| {},
            ));

            assert!(
                matches!(outcome, Err(NetError::Unauthorized)),
                "a dead credential is terminal, not one more failed activity"
            );
            restore_service();
        }

        #[test]
        fn a_server_that_refuses_every_activity_is_an_answer_not_a_failed_sweep() {
            for status in [404u16, 410, 422] {
                let _guard = serial_global_state();
                let _dir = init_global_engine();
                library_of(&["a1", "a2"]);

                let server = MockServer::start();
                let asked = server.mock(|when, then| {
                    when.method(GET);
                    then.status(status);
                });

                let transport = transport_to(server.base_url());
                let outcome = crate::runtime::block_on(sync_interval_bodies(
                    crate::persistence::engine_install(),
                    &transport,
                    &never_cancelled(),
                    &|_, _| {},
                ));

                assert!(outcome.is_ok(), "{status} for an activity failed the sweep");
                asked.assert_hits(2);
                assert!(
                    stored("a1").is_some(),
                    "{status}: an answered refusal leaves the queue"
                );

                crate::runtime::block_on(sync_interval_bodies(
                    crate::persistence::engine_install(),
                    &transport,
                    &never_cancelled(),
                    &|_, _| {},
                ))
                .expect("the second sweep");
                asked.assert_hits(2);
                restore_service();
            }
        }

        #[test]
        fn one_activity_that_fails_does_not_cost_the_others_their_bodies() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["a1", "a2"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET).path("/activity/a1/intervals");
                then.status(500);
            });
            server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"icu_intervals": []}));
            });

            let transport = transport_to(server.base_url());
            let outcome = crate::runtime::block_on(sync_interval_bodies(
                crate::persistence::engine_install(),
                &transport,
                &never_cancelled(),
                &|_, _| {},
            ));

            assert!(
                outcome.is_err(),
                "a failed activity is not a completed step"
            );
            assert!(
                stored("a2").is_some(),
                "the activities that landed are still on disk"
            );
            assert!(
                stored("a1").is_none(),
                "the one that failed keeps its place in the queue for the next sync"
            );
            restore_service();
        }
    }

    /// Scenario: a first launch lands the newest five activities' rows and the
    /// athlete goes offline. Their detail body, streams and intervals were
    /// fetched only on open, so each opened with no charts, laps or track.
    ///
    /// Expected behaviour: the first-use step fetches the three bodies of each
    /// of the five before any other request, stores a successful empty body, ends
    /// the wait for a body the server answers 404 or 410 for, fails the step on
    /// any other error without skipping the rest, and leaves older activities
    /// to the bulk sweeps.
    mod first_use_readiness {
        use super::*;
        use crate::governor::{Governor, NoopPolicy};
        use crate::persistence::with_persistent_engine;
        use crate::types::ActivityMetrics;

        fn transport_to(base: String) -> Transport {
            let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
            Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).expect("transport")
        }

        /// `count` activities named `r0`, `r1`, ... with `r0` the newest.
        fn library_of(count: i64) {
            let metrics = (0..count)
                .map(|i| ActivityMetrics {
                    activity_id: format!("r{i}"),
                    name: format!("r{i}"),
                    date: 1_700_000_000 - i * 86_400,
                    distance: 1000.0,
                    moving_time: 600,
                    elapsed_time: 600,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Ride".to_string(),
                    training_load: None,
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                })
                .collect::<Vec<_>>();
            with_persistent_engine(move |engine| {
                engine.set_activity_metrics(metrics).expect("store metrics");
            })
            .expect("engine");
        }

        fn run_step(server: &MockServer) -> Result<(), NetError> {
            crate::runtime::block_on(ready_newest_activities(
                crate::persistence::engine_install(),
                &transport_to(server.base_url()),
                &|| false,
            ))
        }

        fn has_intervals(id: &str) -> bool {
            with_persistent_engine(|engine| engine.get_interval_body(id))
                .expect("engine")
                .expect("read")
                .is_some()
        }

        fn has_streams(id: &str) -> bool {
            with_persistent_engine(|engine| engine.get_stream_body(id, DETAIL_STREAM_TYPES_KEY))
                .expect("engine")
                .expect("read")
                .is_some()
        }

        fn has_detail(id: &str) -> bool {
            with_persistent_engine(|engine| engine.get_activity_body(id))
                .expect("engine")
                .is_some_and(|body| body.contains("icu_athlete_id"))
        }

        fn mock_all_bodies(server: &MockServer) {
            server.mock(|when, then| {
                when.method(GET).path_matches(
                    httpmock::Regex::new(r"^/activity/r\d/streams\.json$").expect("pattern"),
                );
                then.status(200).json_body(json!([]));
            });
            server.mock(|when, then| {
                when.method(GET).path_matches(
                    httpmock::Regex::new(r"^/activity/r\d/intervals$").expect("pattern"),
                );
                then.status(200).json_body(json!({"icu_intervals": []}));
            });
            server.mock(|when, then| {
                when.method(GET)
                    .path_matches(httpmock::Regex::new(r"^/activity/r\d$").expect("pattern"));
                then.status(200).json_body(json!({
                    "id": "r",
                    "icu_athlete_id": "i1",
                    "start_date_local": "2026-09-01T08:30:00",
                    "type": "Ride"
                }));
            });
        }

        #[test]
        fn the_newest_five_are_made_ready_and_older_ones_are_left() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(7);
            let server = MockServer::start();
            mock_all_bodies(&server);

            run_step(&server).expect("the step");

            for id in ["r0", "r1", "r2", "r3", "r4"] {
                assert!(has_detail(id), "{id} detail");
                assert!(has_streams(id), "{id} streams: an empty body is ready");
                assert!(has_intervals(id), "{id} intervals: an empty body is ready");
            }
            for id in ["r5", "r6"] {
                assert!(!has_intervals(id), "{id} is beyond the first five");
                assert!(!has_streams(id), "{id} is beyond the first five");
            }
            restore_service();
        }

        /// A streams body of `n` points along a line, with the time series.
        fn gps_streams(n: usize, offset: f64) -> serde_json::Value {
            let lat: Vec<f64> = (0..n).map(|i| 46.0 + offset + i as f64 * 0.0005).collect();
            let lng: Vec<f64> = (0..n).map(|i| 7.0 + offset + i as f64 * 0.0005).collect();
            let time: Vec<usize> = (0..n).collect();
            json!([
                {"type": "latlng", "data": lat, "data2": lng},
                {"type": "time", "data": time},
            ])
        }

        fn stored_track_len(id: &str) -> Option<usize> {
            with_persistent_engine(|engine| engine.get_gps_track(id))
                .expect("engine")
                .map(|points| points.len())
        }

        fn has_signature(id: &str) -> bool {
            with_persistent_engine(|engine| engine.get_signature(id))
                .expect("engine")
                .is_some()
        }

        /// Scenario: the newest five have GPS streams and the athlete goes
        /// offline once the step reports completion. The raw body cache holds
        /// 8 MiB and evicts its oldest entries, so the body is not where the
        /// coordinates can live.
        ///
        /// Expected behaviour: when the step returns, each of the five has a
        /// durable track, its time series and its route signature, with no bulk
        /// request made, and the tracks survive the raw body cache being
        /// overrun.
        #[test]
        fn the_newest_five_have_durable_tracks_when_the_step_completes() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(5);
            let server = MockServer::start();
            for i in 0..5 {
                let id = format!("r{i}");
                server.mock(|when, then| {
                    when.method(GET)
                        .path(format!("/activity/{id}/streams.json"));
                    then.status(200).json_body(gps_streams(40, i as f64 * 0.1));
                });
            }
            server.mock(|when, then| {
                when.method(GET).path_matches(
                    httpmock::Regex::new(r"^/activity/r\d/intervals$").expect("pattern"),
                );
                then.status(200).json_body(json!({"icu_intervals": []}));
            });
            server.mock(|when, then| {
                when.method(GET)
                    .path_matches(httpmock::Regex::new(r"^/activity/r\d$").expect("pattern"));
                then.status(200).json_body(json!({
                    "id": "r",
                    "icu_athlete_id": "i1",
                    "start_date_local": "2026-09-01T08:30:00",
                    "type": "Ride"
                }));
            });

            run_step(&server).expect("the step");

            let overrun = "x".repeat(9 * 1024 * 1024);
            with_persistent_engine(move |engine| {
                engine
                    .set_stream_body("filler", "watts", &format!("[\"{overrun}\"]"))
                    .expect("filler body");
            })
            .expect("engine");

            for id in ["r0", "r1", "r2", "r3", "r4"] {
                assert_eq!(stored_track_len(id), Some(40), "{id} track");
                assert!(has_signature(id), "{id} route signature");
                let missing = with_persistent_engine(|engine| {
                    engine.get_activities_missing_time_streams(&[id.to_string()])
                })
                .expect("engine");
                assert!(missing.is_empty(), "{id} time series");
            }
            restore_service();
        }

        /// Seed an activity with its detail, intervals and a cached full
        /// stream body, the state an interactive stream fetch or an earlier
        /// build leaves, with no durable track.
        fn seed_cached_bodies(id: &str, streams: &serde_json::Value) {
            let id = id.to_string();
            let streams = streams.to_string();
            with_persistent_engine(move |engine| {
                engine
                    .store_activity_detail_body(
                        &id,
                        1_700_000_000,
                        r#"{"id":"r","icu_athlete_id":"i1","type":"Ride"}"#,
                    )
                    .expect("detail");
                engine
                    .set_interval_body(&id, r#"{"icu_intervals":[]}"#)
                    .expect("intervals");
                engine
                    .set_stream_body(&id, DETAIL_STREAM_TYPES_KEY, &streams)
                    .expect("streams");
            })
            .expect("engine");
        }

        /// Scenario: the newest five hold a cached full stream body carrying
        /// GPS and time but no durable track, and no request can be made.
        ///
        /// Expected behaviour: the step ingests each cached body, so the track,
        /// time series and route signature exist and survive the raw body
        /// cache being overrun.
        #[test]
        fn a_cached_stream_body_without_a_track_is_ingested_offline() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(5);
            for i in 0..5 {
                seed_cached_bodies(&format!("r{i}"), &gps_streams(40, i as f64 * 0.1));
            }
            let offline = MockServer::start();
            let any = offline.mock(|when, then| {
                when.method(GET);
                then.status(500);
            });

            run_step(&offline).expect("nothing to fetch, only to ingest");
            any.assert_hits(0);

            let overrun = "x".repeat(9 * 1024 * 1024);
            with_persistent_engine(move |engine| {
                engine
                    .set_stream_body("filler", "watts", &format!("[\"{overrun}\"]"))
                    .expect("filler body");
            })
            .expect("engine");

            for id in ["r0", "r1", "r2", "r3", "r4"] {
                assert_eq!(stored_track_len(id), Some(40), "{id} track");
                assert!(has_signature(id), "{id} route signature");
                let missing = with_persistent_engine(|engine| {
                    engine.get_activities_missing_time_streams(&[id.to_string()])
                })
                .expect("engine");
                assert!(missing.is_empty(), "{id} time series");
            }
            restore_service();
        }

        /// Scenario: a cached body has no GPS, as an indoor ride's does.
        ///
        /// Expected behaviour: nothing is owed for it and no track is made.
        #[test]
        fn a_cached_stream_body_without_gps_owes_no_track() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(1);
            seed_cached_bodies("r0", &json!([{"type": "time", "data": [0, 1, 2]}]));

            let owed = with_persistent_engine(|engine| {
                engine.newest_activities_owing_bodies(5, DETAIL_STREAM_TYPES_KEY)
            })
            .expect("engine")
            .expect("read");

            assert!(owed.is_empty(), "{owed:?}");
            restore_service();
        }

        #[test]
        fn a_second_pass_asks_for_nothing() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(2);
            let server = MockServer::start();
            mock_all_bodies(&server);
            run_step(&server).expect("first pass");

            let quiet = MockServer::start();
            let any = quiet.mock(|when, then| {
                when.method(GET);
                then.status(500);
            });
            run_step(&quiet).expect("a ready library owes nothing");
            any.assert_hits(0);
            restore_service();
        }

        #[test]
        fn an_unavailable_stream_ends_its_wait_and_the_rest_still_land() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(2);
            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET).path("/activity/r0/streams.json");
                then.status(404);
            });
            server.mock(|when, then| {
                when.method(GET).path("/activity/r1/streams.json");
                then.status(410);
            });
            mock_all_bodies(&server);

            run_step(&server).expect("a permanent absence is not a failure");

            assert!(!has_streams("r0"));
            assert!(has_intervals("r0") && has_detail("r0"));
            assert!(has_intervals("r1") && has_detail("r1"));
            restore_service();
        }

        #[test]
        fn a_transient_failure_fails_the_step_without_skipping_the_others() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(2);
            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET).path("/activity/r0/intervals");
                then.status(500);
            });
            mock_all_bodies(&server);

            let outcome = run_step(&server);

            assert!(outcome.is_err(), "a 500 is not a ready activity");
            assert!(!has_intervals("r0"));
            assert!(has_streams("r0") && has_detail("r0"));
            assert!(has_intervals("r1") && has_streams("r1") && has_detail("r1"));
            restore_service();
        }

        fn run_first_use_step(
            server: &MockServer,
            windows: &[ActivityWindow],
        ) -> Result<(), NetError> {
            crate::runtime::block_on(sync_newest_activities(
                crate::persistence::engine_install(),
                &transport_to(server.base_url()),
                "i1",
                windows,
                &|| false,
            ))
        }

        fn one_day_window() -> ActivityWindow {
            ActivityWindow {
                range: ("2026-09-01".to_string(), "2026-09-01".to_string()),
                eligible_ids: None,
            }
        }

        /// Scenario: a body failed on a transient error while the summary
        /// census advanced, so the next sync owes no summary window.
        ///
        /// Expected behaviour: the first-use step still brings the missing body
        /// in, whether the plan has no window or only a single day.
        #[test]
        fn a_body_owed_after_a_failure_is_fetched_when_no_window_is_owed() {
            for windows in [Vec::new(), vec![one_day_window()]] {
                let _guard = serial_global_state();
                let _dir = init_global_engine();
                library_of(2);
                let failing = MockServer::start();
                failing.mock(|when, then| {
                    when.method(GET).path("/activity/r0/intervals");
                    then.status(500);
                });
                mock_all_bodies(&failing);
                assert!(run_step(&failing).is_err());
                assert!(!has_intervals("r0"));

                let recovered = MockServer::start();
                mock_all_bodies(&recovered);
                run_first_use_step(&recovered, &windows).expect("the recovered pass");

                assert!(has_intervals("r0"), "the missing body is fetched");
                restore_service();
            }
        }

        #[test]
        fn an_unavailable_body_is_not_asked_for_again() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(1);
            let server = MockServer::start();
            let gone = server.mock(|when, then| {
                when.method(GET).path("/activity/r0/streams.json");
                then.status(404);
            });
            mock_all_bodies(&server);

            run_step(&server).expect("first pass");
            run_step(&server).expect("second pass");

            gone.assert_hits(1);
            restore_service();
        }

        #[test]
        fn a_rejected_credential_stops_the_step() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(2);
            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET);
                then.status(401);
            });

            assert!(matches!(run_step(&server), Err(NetError::Unauthorized)));
            restore_service();
        }
    }

    /// Scenario: the curve is cached verbatim under `(kind, sport, days, gap)`
    /// and every screen fetched its own window the first time it was opened,
    /// so a range the athlete never visited online read as "No power data"
    /// offline. Best Efforts All-time is the clearest case: the all-time window
    /// is one nothing else ever asks for.
    ///
    /// Expected behaviour: one sync step fills the keys the screens read for
    /// every sport family present, including the Run gap variant.
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
            with_persistent_engine(|engine| engine.get_stored_curve(kind, sport, days, gap))
                .expect("engine")
                .expect("read")
                .map(|curve| curve.raw)
        }

        fn never_cancelled() -> impl Fn() -> bool + Sync {
            || false
        }

        #[test]
        fn a_synced_run_curve_records_one_snapshot_on_its_end_date() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["Run"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/pace-curves.json")
                    .query_param("curves", "42d");
                then.status(200).json_body(json!({"list": [{
                    "end_date_local": "2026-08-20T18:30:00",
                    "days": 42,
                    "paceModels": [{"type": "CS", "criticalSpeed": 4.2,
                                    "dPrime": 180, "r2": 0.97}]
                }]}));
            });
            server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"list": []}));
            });

            let transport = transport_to(server.base_url());
            for _ in 0..2 {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            }

            with_persistent_engine(|engine| {
                let (count, date, speed, d_prime, r2): (i64, i64, f64, f64, f64) = engine
                    .db
                    .query_row(
                        "SELECT COUNT(*), date, critical_speed, d_prime, r2
                         FROM pace_history WHERE sport_type = 'Run' AND window_days = 42",
                        [],
                        |row| {
                            Ok((
                                row.get(0)?,
                                row.get(1)?,
                                row.get(2)?,
                                row.get(3)?,
                                row.get(4)?,
                            ))
                        },
                    )
                    .expect("snapshot");
                assert_eq!(count, 1);
                assert_eq!(date, 1_787_184_000);
                assert_eq!((speed, d_prime, r2), (4.2, 180.0, 0.97));
                assert_eq!(engine.get_pace_trend("Run").latest_pace, Some(4.2));
            })
            .expect("engine");
            restore_service();
        }

        #[test]
        fn variant_sports_sync_canonical_pace_snapshots() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["TrailRun", "OpenWaterSwim"]);

            let server = MockServer::start();
            server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/pace-curves.json")
                    .query_param("curves", "42d");
                then.status(200).json_body(json!({"list": [{
                    "end_date_local": "2026-08-20T18:30:00",
                    "days": 42,
                    "paceModels": [{"type": "CS", "criticalSpeed": 4.2,
                                    "dPrime": 180, "r2": 0.97}]
                }]}));
            });
            server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"list": []}));
            });

            crate::runtime::block_on(sync_curves(
                crate::persistence::engine_install(),
                &transport_to(server.base_url()),
                "i1",
                &never_cancelled(),
            ))
            .expect("variant sweep");

            with_persistent_engine(|engine| {
                for sport in ["Run", "Swim"] {
                    let count: i64 = engine
                        .db
                        .query_row(
                            "SELECT COUNT(*) FROM pace_history
                             WHERE sport_type = ?1 AND window_days = 42",
                            [sport],
                            |row| row.get(0),
                        )
                        .expect("snapshot count");
                    assert_eq!(count, 1, "{sport} variant must leave one snapshot");
                }
            })
            .expect("engine");
            restore_service();
        }

        fn day(text: &str) -> chrono::NaiveDate {
            chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").expect("date")
        }

        /// An activity of `sport` starting at noon local on `date`.
        fn on_day(id: &str, sport: &str, date: &str) -> ActivityMetrics {
            let mut row = metric(id, sport);
            row.date = start_date_to_timestamp(Some(&format!("{date}T12:00:00"))).expect("date");
            row
        }

        /// Every key and window stored as fetched on `fetched` (local), with the
        /// body's window ending that day, and no arrival newer than the fetch.
        fn engine_fetched_on(rows: Vec<ActivityMetrics>, fetched: &str) -> PersistentEngine {
            let mut engine = PersistentEngine::in_memory().expect("engine");
            engine.set_activity_metrics(rows).expect("metrics");
            for &key in CURVE_KEYS {
                for &days in CURVE_DAYS {
                    let body = json!({"list": [{
                        "days": days,
                        "start_date_local": format!("{fetched}T00:00:00"),
                        "end_date_local": format!("{fetched}T00:00:00"),
                    }]});
                    engine
                        .set_curve_body(key.kind, key.sport, days, key.gap, &body.to_string())
                        .expect("store curve");
                }
            }
            engine
        }

        fn due(engine: &PersistentEngine, today: &str) -> Vec<(&'static str, bool, i64)> {
            curve_requests_on(engine, day(today))
                .expect("plan")
                .iter()
                .map(|request| (request.key.sport, request.key.gap, request.days))
                .collect()
        }

        #[test]
        fn an_activity_leaving_a_bounded_window_owes_that_window_only() {
            let engine = engine_fetched_on(
                vec![
                    on_day("old", "VirtualRide", "2026-09-24"),
                    on_day("new", "Ride", "2026-09-30"),
                ],
                "2026-10-01",
            );
            // The window ending on the 1st holds 09-24 (days = 7); the one
            // ending on the 2nd starts at 09-25.
            assert_eq!(due(&engine, "2026-10-01"), vec![]);
            assert_eq!(due(&engine, "2026-10-02"), vec![("Ride", false, 7)]);
            assert_eq!(due(&engine, "2026-10-03"), vec![("Ride", false, 7)]);
        }

        #[test]
        fn a_rollover_that_moves_no_activity_across_an_edge_owes_nothing() {
            let engine = engine_fetched_on(vec![on_day("a", "Ride", "2026-09-30")], "2026-10-01");
            assert_eq!(due(&engine, "2026-10-05"), vec![]);
        }

        #[test]
        fn the_last_in_window_activity_leaving_owes_the_window() {
            let engine = engine_fetched_on(vec![on_day("a", "Ride", "2026-09-28")], "2026-10-01");
            assert_eq!(due(&engine, "2026-10-05"), vec![]);
            assert_eq!(due(&engine, "2026-10-06"), vec![("Ride", false, 7)]);
        }

        #[test]
        fn several_crossings_over_an_offline_gap_owe_each_window_crossed() {
            let engine = engine_fetched_on(
                vec![
                    on_day("a", "Ride", "2026-09-20"),
                    on_day("b", "Ride", "2026-08-20"),
                ],
                "2026-10-01",
            );
            // By the 25th, 09-20 has left the 30-day window and 08-20 the
            // 42-day one, while 90 days still holds both.
            assert_eq!(
                due(&engine, "2026-10-25"),
                vec![("Ride", false, 30), ("Ride", false, 42)]
            );
        }

        #[test]
        fn a_family_with_no_activity_in_either_window_owes_nothing() {
            let engine = engine_fetched_on(vec![on_day("a", "Ride", "2020-01-01")], "2026-10-01");
            assert_eq!(due(&engine, "2026-12-31"), vec![]);
        }

        #[test]
        fn run_and_swim_variants_cross_on_their_own_keys() {
            let engine = engine_fetched_on(
                vec![
                    on_day("r", "TrailRun", "2026-09-24"),
                    on_day("s", "OpenWaterSwim", "2026-09-24"),
                ],
                "2026-10-01",
            );
            assert_eq!(
                due(&engine, "2026-10-02"),
                vec![("Run", false, 7), ("Run", true, 7), ("Swim", false, 7),]
            );
        }

        #[test]
        fn the_body_window_end_decides_the_fetched_day_not_the_utc_fetch_stamp() {
            // The fetch stamp reads as 2026-10-01 in UTC, but the window the
            // server drew ended on the 30th local.
            let engine = engine_fetched_on(vec![on_day("a", "Ride", "2026-09-23")], "2026-09-30");
            engine
                .db
                .execute(
                    "UPDATE curve_bodies SET updated_at = ?1",
                    [start_date_to_timestamp(Some("2026-10-01T00:30:00")).expect("stamp")],
                )
                .expect("restamp");
            // Window ending 09-30 holds 09-23; ending 10-01 does not.
            assert_eq!(due(&engine, "2026-09-30"), vec![]);
            assert_eq!(due(&engine, "2026-10-01"), vec![("Ride", false, 7)]);
        }

        #[test]
        fn a_listed_contributor_outside_the_local_slice_counts_as_an_edge_crossing() {
            let mut engine = PersistentEngine::in_memory().expect("engine");
            engine
                .set_activity_metrics(vec![on_day("local", "Ride", "2026-09-30")])
                .expect("metrics");
            let body = json!({
                "list": [{"days": 7, "end_date_local": "2026-10-01T00:00:00"}],
                "activities": {"far": {"id": "far", "start_date_local": "2026-09-25T08:00:00"}},
            });
            engine
                .set_curve_body(CurveKind::Power, "Ride", 7, false, &body.to_string())
                .expect("store");
            let others = |engine: &PersistentEngine, today| -> Vec<i64> {
                curve_requests_on(engine, day(today))
                    .expect("plan")
                    .iter()
                    .filter(|r| r.key.sport == "Ride" && r.days == 7)
                    .map(|r| r.days)
                    .collect()
            };
            assert_eq!(others(&engine, "2026-10-01"), Vec::<i64>::new());
            assert_eq!(others(&engine, "2026-10-02"), Vec::<i64>::new());
            assert_eq!(others(&engine, "2026-10-03"), vec![7]);
        }

        #[test]
        fn a_curve_never_fetched_is_always_requested() {
            let mut engine = PersistentEngine::in_memory().expect("engine");
            engine
                .set_activity_metrics(vec![on_day("a", "Ride", "2026-09-30")])
                .expect("metrics");
            assert_eq!(
                due(&engine, "2026-10-01")
                    .iter()
                    .filter(|(sport, ..)| *sport == "Ride")
                    .count(),
                CURVE_DAYS.len()
            );
        }

        #[test]
        fn test_sync_curves_refreshes_a_window_an_activity_left_and_then_settles() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            let today = chrono::Local::now().date_naive();
            let edge = (today - chrono::Duration::days(8)).to_string();
            let stored_edge = edge.clone();
            with_persistent_engine(move |engine| {
                engine
                    .set_activity_metrics(vec![on_day("edge", "Ride", &stored_edge)])
                    .expect("store metrics");
            })
            .expect("engine");

            let server = MockServer::start();
            let mut power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
            };

            sync().expect("first sweep");
            power.assert_hits(CURVE_DAYS.len());
            power.delete();

            // Two days later the 8-day-old activity has left the 7-day window
            // it was in at the fetch, and no other window moved.
            stored_so_far_ago(2 * 86_400);
            let mut failing = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride")
                    .query_param("curves", "7d");
                then.status(500);
            });
            sync().expect_err("the refresh fails");
            assert!(failing.hits() >= 1, "the 7-day refresh was attempted");
            failing.delete();

            let refreshed = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            sync().expect("the failed refresh is still owed");
            refreshed.assert_hits(1);
            sync().expect("settled");
            refreshed.assert_hits(1);
            restore_service();
        }

        #[test]
        fn plain_and_variant_sports_plan_one_canonical_pace_curve_each() {
            let mut engine = PersistentEngine::in_memory().expect("engine");
            engine
                .set_activity_metrics(
                    ["Run", "TrailRun", "Swim", "OpenWaterSwim"]
                        .iter()
                        .enumerate()
                        .map(|(i, sport)| metric(&format!("a{i}"), sport))
                        .collect(),
                )
                .expect("metrics");
            let requests = curve_requests(&engine).expect("curve plan");
            for sport in ["Run", "Swim"] {
                assert_eq!(
                    requests
                        .iter()
                        .filter(|request| {
                            request.key.kind == CurveKind::Pace
                                && request.key.sport == sport
                                && request.days == 42
                                && !request.key.gap
                        })
                        .count(),
                    1,
                    "{sport} family must have one canonical snapshot request"
                );
            }
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
            crate::runtime::block_on(sync_curves(
                crate::persistence::engine_install(),
                &transport,
                "i1",
                &never_cancelled(),
            ))
            .expect("the sweep");

            let windows = CURVE_DAYS.len();
            power.assert_hits(windows);
            pace.assert_hits(windows);

            assert!(
                stored(CurveKind::Power, "Ride", ALL_TIME_CURVE_DAYS, false).is_some(),
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
            let power = server.mock(|when, then| {
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
            crate::runtime::block_on(sync_curves(
                crate::persistence::engine_install(),
                &transport,
                "i1",
                &never_cancelled(),
            ))
            .expect("the sweep");

            gap.assert_hits(CURVE_DAYS.len());
            power.assert_hits(0);
            assert!(
                stored(CurveKind::Pace, "Run", 42, true).is_some(),
                "the gap row is separate, and a switch flipped offline reads it"
            );
            assert!(stored(CurveKind::Pace, "Run", 42, false).is_some());
            restore_service();
        }

        #[test]
        fn test_sync_curves_fetches_ride_power_for_virtual_ride() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            library_of(&["VirtualRide", "GravelRide", "Walk", "WeightTraining"]);

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let pace = server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/pace-curves.json");
                then.status(200).json_body(json!({"list": []}));
            });

            let transport = transport_to(server.base_url());
            crate::runtime::block_on(sync_curves(
                crate::persistence::engine_install(),
                &transport,
                "i1",
                &never_cancelled(),
            ))
            .expect("the sweep");

            power.assert_hits(CURVE_DAYS.len());
            pace.assert_hits(0);
            assert!(stored(CurveKind::Power, "Ride", ALL_TIME_CURVE_DAYS, false).is_some());
            restore_service();
        }

        /// Store an activity the way a page write does, metrics and body
        /// together, so its body's `updated_at` is when it arrived here.
        fn arrive(id: &str, sport: &str, date: i64) {
            let mut row = metric(id, sport);
            row.date = date;
            let id = id.to_string();
            with_persistent_engine(move |engine| {
                engine
                    .set_activity_metrics(vec![row])
                    .expect("store metrics");
                engine
                    .upsert_activity_bodies(&[(id, date, "{}".to_string())])
                    .expect("store body");
            })
            .expect("engine");
        }

        /// Move every stored curve's fetch and every stored body's arrival
        /// back, as if all of it happened that long before now. Answers the
        /// 42-day Ride power curve's fetch after the move.
        fn stored_so_far_ago(secs: i64) -> i64 {
            with_persistent_engine(move |engine| {
                for table in ["curve_bodies", "activity_bodies"] {
                    engine
                        .db
                        .execute(
                            &format!("UPDATE {table} SET updated_at = updated_at - ?1"),
                            [secs],
                        )
                        .expect("move back");
                }
                engine
                    .get_stored_curve(CurveKind::Power, "Ride", 42, false)
                    .expect("read curve")
                    .expect("stored curve")
                    .fetched_at as i64
            })
            .expect("engine")
        }

        #[test]
        fn test_sync_curves_waits_for_newer_family_activity() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive("old", "VirtualRide", 1_700_000_000);

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());
            sync();
            power.assert_hits(CURVE_DAYS.len());

            let fetched_at = stored_so_far_ago(3600);
            sync();
            power.assert_hits(CURVE_DAYS.len());

            arrive("newer", "GravelRide", fetched_at + 1);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            restore_service();
        }

        fn ride_power_sweep_hits(retype_to: &str) -> usize {
            let _dir = init_global_engine();
            arrive("a", "Ride", 1_700_000_000);
            arrive("b", "Ride", 1_700_000_100);

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/pace-curves.json");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());
            stored_so_far_ago(60);
            arrive("b", retype_to, 1_700_000_100);
            sync();
            let hits = power.hits();
            restore_service();
            hits
        }

        #[test]
        fn an_activity_retyped_out_of_its_family_refetches_the_old_family() {
            let _guard = serial_global_state();
            assert_eq!(ride_power_sweep_hits("Run"), CURVE_DAYS.len() * 2);
        }

        #[test]
        fn an_activity_retyped_within_its_family_adds_no_extra_sweep() {
            let _guard = serial_global_state();
            assert_eq!(ride_power_sweep_hits("VirtualRide"), CURVE_DAYS.len() * 2);
        }

        #[test]
        fn an_upload_dated_before_the_last_sweep_refetches_its_family() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive("old", "VirtualRide", 1_700_000_000);

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());

            // Started an hour before the last sweep, uploaded after it: a
            // late file, or any start within the offset of an athlete west of
            // UTC, whose local start time reads as earlier than the fetch.
            let fetched_at = stored_so_far_ago(60);
            sync();
            power.assert_hits(CURVE_DAYS.len());
            arrive("late", "Ride", fetched_at - 3600);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            restore_service();
        }

        #[test]
        fn a_reprocessed_activity_refetches_its_family() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive("ride", "Ride", 1_700_000_000);

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());

            // Its `icu_sync_date` moved, so the page write stores the same
            // activity again under its old start time.
            stored_so_far_ago(60);
            sync();
            power.assert_hits(CURVE_DAYS.len());
            arrive("ride", "Ride", 1_700_000_000);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            restore_service();
        }

        #[test]
        fn opening_a_held_activity_online_refetches_no_curve() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive("ride", "Ride", 1_700_000_000);

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());

            // The detail body replaces the list row, but nothing arrived: the
            // server's curves already counted this ride.
            stored_so_far_ago(60);
            with_persistent_engine(|engine| {
                engine
                    .store_activity_detail_body("ride", 1_700_000_000, r#"{"id":"ride"}"#)
                    .expect("store detail");
            })
            .expect("engine");
            sync();
            power.assert_hits(CURVE_DAYS.len());
            restore_service();
        }

        /// Store an activity the census can name, as the page write and the
        /// track write leave one: metrics, body and an `activities` row
        /// carrying its intervals.icu id.
        fn arrive_upstream(id: &str, sport: &str) {
            arrive(id, sport, 1_700_000_000);
            let (id, sport) = (id.to_string(), sport.to_string());
            with_persistent_engine(move |engine| {
                engine
                    .db
                    .execute(
                        "INSERT INTO activities
                         (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                         VALUES (?1, ?1, ?2, 0, 0, 0, 0, 1700000000)",
                        rusqlite::params![id, sport],
                    )
                    .expect("store track row");
            })
            .expect("engine");
        }

        fn reconcile(census: &[&str]) -> Vec<String> {
            let census = census.iter().map(|id| id.to_string()).collect::<Vec<_>>();
            with_persistent_engine(move |engine| {
                engine.reconcile_against_census(&census, "2099-01-01")
            })
            .expect("engine")
        }

        /// Scenario: the athlete deletes a ride with a bogus power spike on
        /// intervals.icu. The census removes it here, but a removal only
        /// lowers the family's newest arrival, so the sweep kept the stored
        /// curve, spike and all, until another ride arrived.
        ///
        /// Expected behaviour: the removal refetches its own family's curves
        /// once, and leaves every other family's alone.
        #[test]
        fn an_activity_removed_upstream_refetches_its_family() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive_upstream("kept", "Ride");
            arrive_upstream("gone", "VirtualRide");
            arrive_upstream("run", "Run");

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let pace = server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/pace-curves.json");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());
            pace.assert_hits(CURVE_DAYS.len() * 2);

            stored_so_far_ago(60);
            assert_eq!(reconcile(&["kept", "run"]), vec!["gone".to_string()]);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            pace.assert_hits(CURVE_DAYS.len() * 2);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            restore_service();
        }

        /// The family's last activity leaves upstream. The stored curve still
        /// draws its efforts, so the sweep asks the server once more, though
        /// the library now holds nothing of that sport.
        #[test]
        fn removing_a_familys_last_activity_refetches_its_curves() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive_upstream("gone", "Ride");
            arrive_upstream("run", "Run");

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            server.mock(|when, then| {
                when.method(GET).path("/athlete/i1/pace-curves.json");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());

            stored_so_far_ago(60);
            assert_eq!(reconcile(&["run"]), vec!["gone".to_string()]);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            restore_service();
        }

        #[test]
        fn a_census_that_removes_nothing_refetches_no_curve() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive_upstream("kept", "Ride");

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());

            stored_so_far_ago(60);
            assert!(reconcile(&["kept"]).is_empty());
            sync();
            power.assert_hits(CURVE_DAYS.len());
            restore_service();
        }

        /// Scenario: the athlete deletes an indoor ride on intervals.icu. It
        /// has no GPS, so no `activities` row, and the census never saw it:
        /// the family's curves kept its efforts for good.
        ///
        /// Expected behaviour: the census removes it and the sweep refetches
        /// its family once.
        #[test]
        fn a_trackless_activity_removed_upstream_refetches_its_family() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive_upstream("kept", "Ride");
            arrive("trainer", "VirtualRide", 1_700_000_000);

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());

            stored_so_far_ago(60);
            assert_eq!(reconcile(&["kept"]), vec!["trainer".to_string()]);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
            restore_service();
        }

        /// The only ride a section was cut from leaves upstream. The row stays
        /// for the section, and the family's curves are refetched once all the
        /// same, not on every census that finds it gone again.
        #[test]
        fn a_departure_kept_for_its_section_refetches_its_family_once() {
            let _guard = serial_global_state();
            let _dir = init_global_engine();
            arrive_upstream("gone", "Ride");
            arrive_upstream("kept", "Ride");
            with_persistent_engine(|engine| {
                engine
                    .db
                    .execute(
                        "INSERT INTO sections
                             (id, name, sport_type, section_type, polyline_blob,
                              distance_meters, visit_count, created_at, source_activity_id,
                              start_index, end_index, bounds_min_lat, bounds_max_lat,
                              bounds_min_lng, bounds_max_lng)
                         VALUES ('s1', 'Section 1', 'Ride', 'custom', x'', 1000.0, 1,
                                 datetime('now'), 'gone', 0, 0, 0, 0, 0, 0)",
                        [],
                    )
                    .expect("store section");
            })
            .expect("engine");

            let server = MockServer::start();
            let power = server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/power-curves.json")
                    .query_param("type", "Ride");
                then.status(200).json_body(json!({"list": []}));
            });
            let transport = transport_to(server.base_url());
            let sync = || {
                crate::runtime::block_on(sync_curves(
                    crate::persistence::engine_install(),
                    &transport,
                    "i1",
                    &never_cancelled(),
                ))
                .expect("the sweep");
            };

            sync();
            power.assert_hits(CURVE_DAYS.len());

            stored_so_far_ago(60);
            assert!(reconcile(&["kept"]).is_empty());
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);

            // The next census finds it gone again, after the refetch.
            stored_so_far_ago(60);
            with_persistent_engine(|engine| {
                engine
                    .db
                    .execute(
                        "UPDATE settings SET value = CAST(value AS INTEGER) - 60
                         WHERE key LIKE '__curve_removed_at:%'",
                        [],
                    )
                    .expect("move stamps back");
            })
            .expect("engine");
            assert!(reconcile(&["kept"]).is_empty());
            sync();
            power.assert_hits(CURVE_DAYS.len() * 2);
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
            crate::runtime::block_on(sync_curves(
                crate::persistence::engine_install(),
                &transport,
                "i1",
                &never_cancelled(),
            ))
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
            crate::runtime::block_on(sync_curves(
                crate::persistence::engine_install(),
                &transport,
                "i1",
                &|| true,
            ))
            .expect("the sweep");

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
            let outcome = crate::runtime::block_on(sync_curves(
                crate::persistence::engine_install(),
                &transport,
                "i1",
                &never_cancelled(),
            ));

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
                    .query_param("curves", "all");
                then.status(500);
            });
            server.mock(|when, then| {
                when.method(GET);
                then.status(200).json_body(json!({"list": []}));
            });

            let transport = transport_to(server.base_url());
            let outcome = crate::runtime::block_on(sync_curves(
                crate::persistence::engine_install(),
                &transport,
                "i1",
                &never_cancelled(),
            ));

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

        crate::runtime::block_on(store_body(
            crate::persistence::engine_install(),
            "fixture",
            String::new(),
            |_engine| Err(rusqlite::Error::InvalidQuery),
        ));
        observer::flush();

        assert!(
            recorder.seen().is_empty(),
            "a store that failed left nothing for a woken reader to find"
        );
        crate::objects::observer::flush();
        set_observer(None);
    }

    #[test]
    fn every_landing_announces_once() {
        let _guard = serial_global_state();
        let _dir = init_global_engine();
        let recorder = Bodies::record();

        crate::runtime::block_on(store_body(
            crate::persistence::engine_install(),
            "fixture",
            "f1".into(),
            |_engine| Ok(()),
        ));
        crate::runtime::block_on(store_body(
            crate::persistence::engine_install(),
            "fixture",
            "f2".into(),
            |_engine| Ok(()),
        ));
        observer::flush();

        assert_eq!(recorder.seen(), vec!["fixture:f1", "fixture:f2"]);
        crate::objects::observer::flush();
        set_observer(None);
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

    /// Scenario: a sign-in lands between the app's owner check and the post,
    /// so the credential the engine holds belongs to a different athlete than
    /// the one the ride was recorded for.
    ///
    /// Expected behaviour: both posting calls refuse before any request leaves.
    #[test]
    fn a_post_for_another_athlete_is_refused_before_it_is_sent() {
        let _guard = serial_global_state();
        let server = MockServer::start();
        let any = server.mock(|when, then| {
            when.any_request();
            then.status(200).json_body(serde_json::json!({"id": "x"}));
        });
        aim_service_at(&server);

        let upload = futures::executor::block_on(send_activity_file(
            Some("i2".into()),
            "/nowhere.fit".into(),
            "ride.fit".into(),
            "ride".into(),
            None,
            None,
            None,
        ));
        let manual = futures::executor::block_on(send_manual_activity(
            Some("i2".into()),
            ManualActivityBody {
                activity_type: "Ride".into(),
                name: "Spin".into(),
                start_date_local: "2026-01-01T07:00:00".into(),
                elapsed_time: 3600,
                moving_time: None,
                distance: None,
                total_elevation_gain: None,
                average_heartrate: None,
                description: None,
                trainer: false,
                commute: false,
            },
        ));

        assert_eq!(upload.kind, FfiCallKind::OtherAthlete);
        assert_eq!(manual.kind, FfiCallKind::OtherAthlete);
        any.assert_hits(0);
        restore_service();
    }

    #[test]
    fn a_post_for_the_held_athlete_or_an_unstamped_ride_is_not_refused() {
        assert!(athlete_mismatch("i1", Some("i1")).is_none());
        assert!(athlete_mismatch("i1", None).is_none());
        assert!(athlete_mismatch("i1", Some("i2")).is_some());
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
    use httpmock::prelude::*;
    use serde_json::json;

    fn transport_to(base: String) -> Transport {
        let governor = std::sync::Arc::new(crate::governor::Governor::new(
            1000,
            Box::new(crate::governor::NoopPolicy),
        ));
        Transport::with_governor(base, AuthMethod::ApiKey("k"), governor).unwrap()
    }

    #[test]
    fn a_detail_body_stores_metrics_with_preferred_power() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("detail_metrics.db");
        let body = json!({
            "id": "upstream-77",
            "name": "Indoor Ride",
            "type": "Ride",
            "start_date_local": "2026-01-02T08:00:00",
            "moving_time": 3600,
            "average_watts": 205,
            "icu_average_watts": 212
        })
        .to_string();

        let row = crate::persistence::with_persistent_engine(|engine| {
            engine
                .store_activity_detail_body("local-77", 1_767_340_800, &body)
                .expect("detail body");
            engine.activity_metrics.get("local-77").cloned()
        })
        .expect("engine")
        .expect("detail metrics");

        assert_eq!(row.avg_power, Some(212));
        assert_eq!(row.activity_id, "local-77");
    }

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

        let filled = crate::runtime::block_on(repair_missing_activity_metrics(
            crate::persistence::engine_install(),
        ));

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

        let filled = crate::runtime::block_on(repair_missing_activity_metrics(
            crate::persistence::engine_install(),
        ));

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

        let filled = crate::runtime::block_on(repair_missing_activity_metrics(
            crate::persistence::engine_install(),
        ));

        assert_eq!(filled, 1, "the readable one");
        let row = crate::persistence::with_persistent_engine(|engine| {
            engine.activity_metrics.get("a80").cloned()
        })
        .expect("engine")
        .expect("the readable row");
        assert_eq!(row.name, "Readable");
    }
    /// A page writes its bodies and metrics in one transaction, so a metrics
    /// failure fails the window and leaves no body without its row.
    #[test]
    fn a_page_whose_metrics_write_fails_stores_no_body() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("metrics_write_failure.db");
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .db
                .execute_batch("DROP TABLE activity_metrics")
                .expect("drop the table the write needs");
        })
        .expect("engine");
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200).json_body(json!([
                {"id": "a81", "type": "Ride", "name": "Loop",
                 "start_date_local": "2025-01-15T08:30:00", "distance": 28400.0}
            ]));
        });

        let outcome = crate::runtime::block_on(sync_activity_window(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            "2025-01-01",
            "2025-01-31",
            None,
            &|| false,
        ));

        assert!(outcome.is_err(), "the page must not report as stored");
        let body =
            crate::persistence::with_persistent_engine(|engine| engine.get_activity_body("a81"))
                .expect("engine");
        assert!(body.is_none(), "the body was written without its metrics");
    }

    /// The repair writes the metrics rows on their own, so a failure there
    /// has no transaction to roll back and only the counter says it happened.
    #[test]
    fn a_failed_repair_metrics_write_is_counted_and_fills_nothing() {
        let _guard = serial_global_state();
        let _tmp = crate::test_globals::init_global_engine("metrics_repair_write_failure.db");
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .upsert_activity_bodies(&[(
                    "a82".to_string(),
                    1_767_340_800,
                    json!({"id": "a82", "name": "Orphan"}).to_string(),
                )])
                .expect("body");
            engine
                .db
                .execute_batch(
                    "CREATE TRIGGER refuse_metrics BEFORE INSERT ON activity_metrics
                     BEGIN SELECT RAISE(ABORT, 'refused'); END",
                )
                .expect("make the write fail with the orphan still listed");
        })
        .expect("engine");
        let before = metrics_writes_failed();

        let filled = crate::runtime::block_on(repair_missing_activity_metrics(
            crate::persistence::engine_install(),
        ));

        assert_eq!(filled, 0);
        assert_eq!(metrics_writes_failed(), before + 1);
    }

    fn last_success_row() -> Option<String> {
        crate::persistence::with_persistent_engine(|engine| {
            engine
                .get_setting(crate::persistence::settings_keys::SYNC_LAST_SUCCESS_AT)
                .expect("read")
        })
        .expect("engine")
    }

    #[test]
    fn a_clean_finish_stamps_the_time_and_the_status_carries_it() {
        let _guard = crate::test_globals::serial_global_state();
        let _dir = crate::test_globals::init_global_engine("sync_last_success.db");
        let svc = SyncService::new();
        assert_eq!(svc.snapshot().last_success_at, None, "no row, no time");

        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        svc.finish(SyncState::Idle, None, true);
        let first = svc.snapshot().last_success_at.expect("stamped");
        assert_eq!(last_success_row().as_deref(), Some(first.as_str()));
        assert!(first.ends_with('Z') && first.len() == 24, "{first}");

        std::thread::sleep(std::time::Duration::from_millis(5));
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        svc.finish(SyncState::Idle, None, true);
        let second = svc.snapshot().last_success_at.expect("stamped");
        assert!(second > first, "{second} should follow {first}");
    }

    #[test]
    fn a_finish_that_is_not_clean_leaves_the_row_as_it_was() {
        let _guard = crate::test_globals::serial_global_state();
        let _dir = crate::test_globals::init_global_engine("sync_last_success_unclean.db");
        let svc = SyncService::new();
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        svc.finish(SyncState::Idle, None, true);
        let stamped = last_success_row().expect("stamped");
        std::thread::sleep(std::time::Duration::from_millis(5));

        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        svc.finish(
            SyncState::Idle,
            Some(SyncFailure::new(FfiSyncErrorReason::Network, "down")),
            false,
        );
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        svc.finish(SyncState::Idle, None, false);
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        svc.finish(
            SyncState::Idle,
            Some(SyncFailure::new(FfiSyncErrorReason::Network, "down")),
            true,
        );
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        svc.park_auth_expired_now();

        assert_eq!(last_success_row(), Some(stamped.clone()));
        assert_eq!(svc.snapshot().last_success_at, Some(stamped));
    }

    #[test]
    fn a_run_that_outlives_its_library_stamps_nothing_in_the_new_one() {
        let _guard = crate::test_globals::serial_global_state();
        let _dir = crate::test_globals::init_global_engine("sync_last_success_wipe.db");
        let svc = SyncService::new();
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        crate::persistence::invalidate_engine_install();
        svc.finish(SyncState::Idle, None, true);
        assert_eq!(last_success_row(), None);
        assert_eq!(svc.snapshot().last_success_at, None);
    }

    #[test]
    fn the_library_wipe_takes_the_time_with_it() {
        let _guard = crate::test_globals::serial_global_state();
        let _dir = crate::test_globals::init_global_engine("sync_last_success_clear.db");
        let svc = SyncService::new();
        svc.claim_slot_for(SyncRequest::Full).expect("claim");
        svc.finish(SyncState::Idle, None, true);
        assert!(svc.snapshot().last_success_at.is_some());

        crate::persistence::with_persistent_engine(|engine| engine.clear().expect("clear"))
            .expect("engine");
        assert_eq!(svc.snapshot().last_success_at, None);
    }
}

#[cfg(test)]
#[path = "tests/record_dependency_auth.rs"]
mod record_dependency_auth;
