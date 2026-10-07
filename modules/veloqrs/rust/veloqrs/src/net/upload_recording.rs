//! One recording's upload, from the begin to the effort, in Rust.
//!
//! The upload schedule runs this for each due ride, and the review save and
//! Upload now run it through `RecordingManager::upload_recording`. Each run
//! holds the engine install it read when it started: a restore or a wipe that
//! lands while the request is in flight moves the install on, and every write
//! after that is refused rather than landing in the library that replaced it.
//!
//! The order is the one the queue has always used: the owner check, the body
//! check, the begin, the request, the transition the answer names, then the
//! three writes that follow a landed upload. Those three are best effort, since
//! the server holds the activity by then, and each has a sweep that finishes
//! it on a later pass.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::mpsc;
use std::sync::{LazyLock, Mutex};

use serde::Deserialize;

use crate::net::types::ManualActivityBody;
use crate::objects::observer::{Announcement, notify};
use crate::objects::sync::{FfiCallKind, FfiCallOutcome};
use crate::persistence::recordings::UploadTransition;
use crate::persistence::{FfiRecordingEntry, PersistentEngine, with_persistent_engine_for};

/// What one attempt at a ride's upload came to. The review screen branches on
/// it, and the drain stops on every outcome but a settled ride.
///
/// The wire carries the variant's position, so the order is the contract:
/// append, never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiUploadOutcome {
    /// intervals.icu took the ride.
    Uploaded = 1,
    /// The grant lacks write permission. Every other ride would meet it too.
    PermissionBlocked = 2,
    /// The credential was refused. The ride waits with its attempts intact.
    AuthExpired = 3,
    /// A rejection retrying the same bytes cannot fix. The ride parks.
    Rejected = 4,
    /// A failure worth another attempt once the backoff has run.
    Retriable = 5,
    /// The request never reached intervals.icu.
    Network = 6,
    /// The FIT, or a manual entry's body, is not on the device.
    Missing = 7,
    /// The ride belongs to an athlete other than the one signed in, or to
    /// nobody, and is held for its own athlete.
    OtherAthlete = 8,
    /// The ride was not pending, or another run holds it: nothing was sent.
    NotStarted = 9,
}

impl FfiUploadOutcome {
    /// Whether the drain goes on to the next ride. A ride that landed or
    /// parked is settled; anything else would meet the next ride the same way,
    /// or is waiting on a backoff that applies to it alone.
    pub fn drain_continues(self) -> bool {
        matches!(self, Self::Uploaded | Self::Rejected | Self::Missing)
    }
}

/// One upload's outcome and the detail the athlete is shown for a failure.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiUploadResult {
    pub outcome: FfiUploadOutcome,
    pub error_detail: Option<String>,
}

impl FfiUploadResult {
    fn bare(outcome: FfiUploadOutcome) -> Self {
        Self {
            outcome,
            error_detail: None,
        }
    }

    fn with(outcome: FfiUploadOutcome, detail: String) -> Self {
        Self {
            outcome,
            error_detail: Some(detail),
        }
    }
}

/// What the sequence asks of intervals.icu and of the credential held. The
/// schedule and the export hand in the live one; a test hands in a fake.
pub(crate) trait Uplink {
    /// The athlete whose credential the engine holds, `None` when it holds none.
    fn signed_in(&self) -> Option<String>;
    /// Post the ride's FIT, streamed from its path.
    fn send_file(&self, ride: &FfiRecordingEntry) -> FfiCallOutcome;
    /// Post a manual entry's body.
    fn send_manual(&self, ride: &FfiRecordingEntry, body: ManualActivityBody) -> FfiCallOutcome;
    /// Set the effort on the activity the upload created.
    fn send_rpe(&self, intervals_id: &str, rpe: u32) -> FfiCallOutcome;
}

/// The uplink the app runs: the held credential and the shared transport.
/// Every request blocks the calling thread, which is the schedule's worker or
/// the thread the export spawned, never the JavaScript thread.
pub(crate) struct Live;

impl Uplink for Live {
    fn signed_in(&self) -> Option<String> {
        crate::objects::sync::signed_in_athlete()
    }

    fn send_file(&self, ride: &FfiRecordingEntry) -> FfiCallOutcome {
        crate::runtime::block_on(crate::objects::sync::send_activity_file(
            ride.athlete_id.clone(),
            ride.fit_path.clone(),
            file_upload_name(ride),
            ride.id.clone(),
            Some(ride.name.clone()),
            ride.notes.clone(),
            ride.paired_event_id.map(crate::ffi_types::int_from_wire),
        ))
    }

    fn send_manual(&self, ride: &FfiRecordingEntry, body: ManualActivityBody) -> FfiCallOutcome {
        crate::runtime::block_on(crate::objects::sync::send_manual_activity(
            ride.athlete_id.clone(),
            body,
        ))
    }

    fn send_rpe(&self, intervals_id: &str, rpe: u32) -> FfiCallOutcome {
        crate::runtime::block_on(crate::objects::sync::send_activity_rpe(
            intervals_id.to_string(),
            rpe,
        ))
    }
}

fn file_upload_name(ride: &FfiRecordingEntry) -> String {
    format!("{}.fit", ride.id)
}

/// A manual entry's body as the entry screen stored it: the request's own
/// field names, with the times in seconds as the screen measured them.
#[derive(Deserialize)]
struct StoredManualBody {
    #[serde(rename = "type")]
    activity_type: String,
    name: String,
    start_date_local: String,
    elapsed_time: f64,
    moving_time: Option<f64>,
    distance: Option<f64>,
    total_elevation_gain: Option<f64>,
    average_heartrate: Option<f64>,
    description: Option<String>,
    trainer: Option<bool>,
    commute: Option<bool>,
}

impl From<StoredManualBody> for ManualActivityBody {
    fn from(stored: StoredManualBody) -> Self {
        ManualActivityBody {
            activity_type: stored.activity_type,
            name: stored.name,
            start_date_local: stored.start_date_local,
            elapsed_time: stored.elapsed_time.round() as i64,
            moving_time: stored.moving_time.map(|t| t.round() as i64),
            distance: stored.distance,
            total_elevation_gain: stored.total_elevation_gain,
            average_heartrate: stored.average_heartrate,
            description: stored.description,
            trainer: stored.trainer.unwrap_or(false),
            commute: stored.commute.unwrap_or(false),
        }
    }
}

/// The body a manual entry holds, `None` when the device cannot produce it.
fn read_manual_body(ride: &FfiRecordingEntry) -> Option<ManualActivityBody> {
    let path = ride.streams_path.as_deref()?;
    let text = std::fs::read_to_string(crate::net::transport::strip_file_scheme(path)).ok()?;
    let stored: StoredManualBody = serde_json::from_str(&text).ok()?;
    Some(stored.into())
}

fn fit_on_disk(ride: &FfiRecordingEntry) -> bool {
    Path::new(crate::net::transport::strip_file_scheme(&ride.fit_path)).is_file()
}

/// What a request's answer means for the ride.
#[derive(Debug, PartialEq)]
enum Verdict {
    Landed(Option<String>),
    OtherAthlete,
    PermissionBlocked,
    AuthExpired(String),
    Network(String),
    Retriable(String),
    Rejected(String),
}

/// Read the request's answer. A 403 is a missing write grant whatever else the
/// answer says, and only a request that never reached the server is a network
/// failure: a refused, rate-limited or locally failed write is not, and holding
/// one for the connection would wait on a change that cannot help it.
fn classify(answer: &FfiCallOutcome) -> Verdict {
    let detail = || {
        answer
            .detail
            .clone()
            .unwrap_or_else(|| answer.message.clone())
    };
    match (answer.kind, answer.status) {
        (FfiCallKind::Ok, _) => Verdict::Landed(answer.id.clone()),
        (FfiCallKind::OtherAthlete, _) => Verdict::OtherAthlete,
        (_, Some(403)) => Verdict::PermissionBlocked,
        (_, Some(401)) => Verdict::AuthExpired(detail()),
        (FfiCallKind::Network, _) => Verdict::Network(answer.message.clone()),
        (_, None) => Verdict::Retriable(detail()),
        (_, Some(status)) if status >= 500 || status == 408 || status == 429 => {
            Verdict::Retriable(detail())
        }
        (_, Some(_)) => Verdict::Rejected(detail()),
    }
}

/// The engine, only while it is still the install this run started under.
fn under<R>(install: u64, f: impl FnOnce(&mut PersistentEngine) -> R) -> Option<R> {
    with_persistent_engine_for(install, f)
}

/// Apply one transition under the install, and answer whether it was written.
fn moved(install: u64, id: &str, transition: UploadTransition, now_ms: i64) -> bool {
    under(install, |e| e.transition_recording(id, &transition, now_ms))
        .and_then(Result::ok)
        .is_some_and(|answer| answer.applied)
}

/// Hold every ride that is not the signed-in athlete's, this one included.
/// With nobody signed in there is nobody to hold it from, and it waits as it is.
fn hold_for_its_athlete(install: u64, signed_in: Option<&str>) {
    if let Some(athlete) = signed_in
        && let Some(Err(err)) = under(install, |e| e.hold_recordings_of_other_athletes(athlete))
    {
        log::warn!("veloqrs: [upload] could not hold another athlete's rides: {err}");
    }
}

/// Upload one ride under the install open now. `manual` is the athlete asking
/// for it, from the review save or Upload now: a parked ride is requeued first,
/// and its backoff does not apply.
pub(crate) fn upload_ride(
    id: &str,
    manual: bool,
    uplink: &dyn Uplink,
    now_ms: &dyn Fn() -> i64,
) -> FfiUploadResult {
    let install = crate::persistence::engine_install();
    let result = upload_ride_under(install, id, manual, uplink, now_ms);
    notify(Announcement::RecordingsChanged);
    result
}

fn upload_ride_under(
    install: u64,
    id: &str,
    manual: bool,
    uplink: &dyn Uplink,
    now_ms: &dyn Fn() -> i64,
) -> FfiUploadResult {
    use FfiUploadOutcome as O;

    let Some(ride) = under(install, |e| e.get_recording(id))
        .and_then(Result::ok)
        .flatten()
    else {
        return FfiUploadResult::bare(O::NotStarted);
    };

    // Before anything is read or written: another athlete's ride is theirs to
    // settle, and an unstamped one has no owner to upload for.
    let signed_in = uplink.signed_in();
    if ride.athlete_id.is_none() || ride.athlete_id != signed_in {
        hold_for_its_athlete(install, signed_in.as_deref());
        return FfiUploadResult::bare(O::OtherAthlete);
    }

    // A ride that landed or began sending since the athlete asked is not sent
    // again; the athlete hears how that run ends instead.
    if manual && !moved(install, id, UploadTransition::Requeue, now_ms()) {
        return join_or_read(install, id);
    }

    // A manual entry has no file, so the FIT check is not asked about one: it
    // would find nothing and park the entry, which nothing requeues.
    let install_f = install as f64;
    let missing = |error: &str| {
        let rejected = UploadTransition::Rejected {
            install: install_f,
            error: error.to_string(),
        };
        moved(install, id, rejected, now_ms());
        FfiUploadResult::with(O::Missing, error.to_string())
    };
    let manual_body = if ride.kind == "manual" {
        match read_manual_body(&ride) {
            Some(body) => Some(body),
            None => return missing("Manual entry body missing on device"),
        }
    } else {
        if !fit_on_disk(&ride) {
            return missing("FIT file missing on device");
        }
        None
    };

    // A refused begin means the ride is not pending, or another run has it:
    // sending now would upload one ride twice.
    let Some(flight) = Flight::begin(install, id, now_ms) else {
        return if manual {
            join_or_read(install, id)
        } else {
            FfiUploadResult::bare(O::NotStarted)
        };
    };
    let result = send_and_settle(install, &ride, manual_body, uplink, now_ms);
    flight.land(&result);
    result
}

/// The rides a run has begun and not yet settled, each with whoever is waiting
/// to hear how it ends.
///
/// Saving a ride wakes the schedule, which usually begins it before the review
/// save asks, and the athlete is owed that run's outcome rather than being told
/// nothing started.
static IN_FLIGHT: LazyLock<Mutex<HashMap<String, Vec<mpsc::Sender<FfiUploadResult>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn in_flight() -> std::sync::MutexGuard<'static, HashMap<String, Vec<mpsc::Sender<FfiUploadResult>>>>
{
    IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner())
}

/// One run's hold on a ride between its begin and its outcome. Dropped without
/// landing, a panic among them, it lets its waiters go with nothing to tell.
struct Flight(String);

impl Flight {
    /// Begin the ride, and mark it in flight in the same step, so a manual call
    /// refused by this begin always finds the run it was refused for.
    fn begin(install: u64, id: &str, now_ms: &dyn Fn() -> i64) -> Option<Self> {
        let mut flights = in_flight();
        if !moved(install, id, UploadTransition::Begin, now_ms()) {
            return None;
        }
        flights.insert(id.to_string(), Vec::new());
        Some(Self(id.to_string()))
    }

    fn land(self, result: &FfiUploadResult) {
        for waiter in in_flight().remove(&self.0).unwrap_or_default() {
            let _ = waiter.send(result.clone());
        }
    }
}

impl Drop for Flight {
    fn drop(&mut self) {
        in_flight().remove(&self.0);
    }
}

/// The outcome of the run that holds the ride, waited for, or when none holds
/// it, what the row says: a ride already uploaded answers so, and anything else
/// was not started by this call.
fn join_or_read(install: u64, id: &str) -> FfiUploadResult {
    let joined = in_flight().get_mut(id).map(|waiters| {
        let (tx, rx) = mpsc::channel();
        waiters.push(tx);
        rx
    });
    if let Some(rx) = joined {
        return rx
            .recv()
            .unwrap_or_else(|_| FfiUploadResult::bare(FfiUploadOutcome::NotStarted));
    }
    let landed = under(install, |e| e.get_recording(id))
        .and_then(Result::ok)
        .flatten()
        .is_some_and(|row| row.upload_status == "uploaded");
    FfiUploadResult::bare(if landed {
        FfiUploadOutcome::Uploaded
    } else {
        FfiUploadOutcome::NotStarted
    })
}

/// Send a begun ride and move it by the transition the answer names.
fn send_and_settle(
    install: u64,
    ride: &FfiRecordingEntry,
    manual_body: Option<ManualActivityBody>,
    uplink: &dyn Uplink,
    now_ms: &dyn Fn() -> i64,
) -> FfiUploadResult {
    use FfiUploadOutcome as O;

    let id = ride.id.as_str();
    let install_f = install as f64;
    let answer = match manual_body {
        Some(body) => uplink.send_manual(ride, body),
        None => uplink.send_file(ride),
    };

    let outcome = |transition: UploadTransition| moved(install, id, transition, now_ms());
    match classify(&answer) {
        Verdict::Landed(intervals_id) => {
            outcome(UploadTransition::Uploaded {
                install: install_f,
                intervals_activity_id: intervals_id.clone(),
            });
            if let Some(intervals_id) = intervals_id {
                after_landing(install, ride, &intervals_id, uplink);
            }
            // Nothing is deleted here. A 200 says the server took the bytes,
            // not that the activity survived, and until it has been read back
            // the FIT on the device is the only copy of the ride.
            FfiUploadResult::bare(O::Uploaded)
        }
        // The engine saw another athlete's credential and sent nothing.
        Verdict::OtherAthlete => {
            hold_for_its_athlete(install, uplink.signed_in().as_deref());
            FfiUploadResult::bare(O::OtherAthlete)
        }
        Verdict::PermissionBlocked => {
            outcome(UploadTransition::PermissionBlocked { install: install_f });
            notify(Announcement::UploadPermissionRefused);
            FfiUploadResult::bare(O::PermissionBlocked)
        }
        // A refused credential is not the ride's fault, so it waits rather than
        // parking. The sign-out the 401 triggers leaves it for its athlete.
        Verdict::AuthExpired(error) => {
            outcome(UploadTransition::HeldForAuth {
                install: install_f,
                error: error.clone(),
            });
            FfiUploadResult::with(O::AuthExpired, error)
        }
        // A transport failure never reached intervals.icu, so it is not an
        // attempt the ride spent.
        Verdict::Network(error) => {
            outcome(UploadTransition::HeldForNetwork {
                install: install_f,
                error: error.clone(),
            });
            FfiUploadResult::with(O::Network, error)
        }
        Verdict::Retriable(error) => {
            outcome(UploadTransition::Failed {
                install: install_f,
                error: error.clone(),
            });
            FfiUploadResult::with(O::Retriable, error)
        }
        // Retrying the same bytes cannot succeed. The ride parks for the
        // athlete with its file kept.
        Verdict::Rejected(error) => {
            outcome(UploadTransition::Rejected {
                install: install_f,
                error: error.clone(),
            });
            FfiUploadResult::with(O::Rejected, error)
        }
    }
}

/// The writes a landed upload owes, each best effort and each finished by a
/// later sweep when it fails: the provisional row gains the server's id, a
/// strength session's sets come out of its own FIT, and the effort goes up.
fn after_landing(install: u64, ride: &FfiRecordingEntry, intervals_id: &str, uplink: &dyn Uplink) {
    // Read again: the save attaches the provisional key after it inserts the
    // ride, and the schedule can begin the ride in between.
    let ride = &under(install, |e| e.get_recording(&ride.id))
        .and_then(Result::ok)
        .flatten()
        .unwrap_or_else(|| ride.clone());

    // The provisional row keeps its key and gains the server's id. Without it
    // the next sync stores the ride again under the server's own key. False
    // from the engine is settled too: the row already carries an id or is gone.
    if let Some(engine_id) = ride.engine_activity_id.as_deref() {
        let reconciled = under(install, |e| {
            e.record_upload(engine_id, intervals_id)?;
            e.set_recording_reconciled(&ride.id)
        });
        if let Some(Err(err)) = reconciled {
            log::warn!(
                "veloqrs: [upload] could not record the upload of {}: {err}",
                ride.id
            );
        }
    }

    // intervals.icu keeps the sets in the file it was handed, so nothing comes
    // back down the sync for them.
    if ride.activity_type == "WeightTraining" {
        let path = crate::net::transport::strip_file_scheme(&ride.fit_path);
        let imported = std::fs::read(path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| {
                crate::objects::strength::import_fit_sets_under(install, intervals_id, &bytes)
                    .map_err(|e| e.to_string())
            });
        match imported {
            Ok(count) => log::info!(
                "veloqrs: [upload] imported {count} strength sets from {}",
                ride.id
            ),
            Err(err) => log::warn!(
                "veloqrs: [upload] strength set import failed for {}: {err}",
                ride.id
            ),
        }
    }

    // The upload takes no effort field, so it goes up as a second request. A
    // failure leaves the ride owing it, and the sweep retries this request
    // alone: sending the file again would make a second activity.
    if let Some(rpe) = ride.rpe.filter(|_| !ride.rpe_sent) {
        if uplink.send_rpe(intervals_id, rpe).kind == FfiCallKind::Ok {
            under(install, |e| e.set_recording_rpe_sent(&ride.id));
        } else {
            log::warn!(
                "veloqrs: [upload] could not set the effort of {}, the sweep retries it",
                ride.id
            );
        }
    }
}

/// Upload every due ride in the order it was recorded, until one answers an
/// outcome the rest would meet too. Each ride is attempted once per drain, so
/// a row a refused write left pending cannot be sent twice in a row.
pub(crate) fn drain(uplink: &dyn Uplink, now_ms: &dyn Fn() -> i64) {
    let install = crate::persistence::engine_install();
    let mut attempted = HashSet::new();
    loop {
        let Some(next) = under(install, |e| e.next_pending_recording(now_ms()))
            .and_then(Result::ok)
            .flatten()
        else {
            return;
        };
        if !attempted.insert(next.id.clone()) {
            return;
        }
        let result = upload_ride_under(install, &next.id, false, uplink, now_ms);
        notify(Announcement::RecordingsChanged);
        if !result.outcome.drain_continues() {
            return;
        }
    }
}

#[cfg(test)]
#[path = "tests/upload_recording.rs"]
mod tests;
