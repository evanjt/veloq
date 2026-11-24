//! Garmin's rides, pulled onto the device.
//!
//! A pass asks Garmin for the activities since a stored watermark, with an
//! overlap because Garmin dates are the athlete's local days and inclusive,
//! downloads the original of each one the device does not already hold
//! complete, and stores it through [`super::ingest`]. Behind that, a backfill
//! walks back a month at a time from the first window to the oldest ride, and
//! checkpoints the month it has finished, so a kill resumes at the next one
//! and a month that was part way is listed again with its stored rides
//! skipped.
//!
//! All of the pass's state is in settings rows that never travel in a backup:
//! the originals they describe are on this device. The pass runs on a thread
//! of its own, never holding the engine across a request. Garmin's pace and
//! its refusals are the Garmin lane's business (`governor`): a refusal ends
//! the request deferred, the pass waits the hold out and goes on.

use super::ingest::{IngestError, Ingested};
use super::wire::ListedActivity;
use super::{GarminClient, GarminError, dispatch};
use crate::net::transport::NetError;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};

/// The local day a pass last listed through.
pub(crate) const WATERMARK: &str = "veloq-garmin-pull-watermark";
/// The first day the backfill has finished: everything from here to the
/// watermark's window has been listed and its rides stored.
pub(crate) const CURSOR: &str = "veloq-garmin-backfill-cursor";
/// The local day of the oldest ride Garmin lists: where the backfill ends.
pub(crate) const FLOOR: &str = "veloq-garmin-backfill-floor";
/// Present once the backfill has reached the oldest ride.
pub(crate) const BACKFILL_DONE: &str = "veloq-garmin-backfill-done";
/// Rides this device has stored from Garmin's originals.
pub(crate) const STORED: &str = "veloq-garmin-pulled";

/// Rides whose original did not download or store, each with the passes that
/// have found it so: `id=passes,id=passes`.
pub(crate) const SKIPPED: &str = "veloq-garmin-pull-skipped";

/// The settings rows a pass keeps, which a record backup leaves out.
pub(crate) const SETTING_KEYS: [&str; 6] =
    [WATERMARK, CURSOR, FLOOR, BACKFILL_DONE, STORED, SKIPPED];

/// The first day Garmin could hold a ride, from which the whole history is
/// listed.
const HISTORY_START: &str = "2000-01-01";

/// Days a pass looks back from its watermark. Garmin lists by the day a ride
/// started, and a ride can be uploaded days after it, so the window is wide.
/// Rides already held are not downloaded again.
const OVERLAP_DAYS: i64 = 30;

/// Days the first pass lists; the backfill continues from before them.
const FIRST_WINDOW_DAYS: i64 = 30;

/// Downloads that fail one after another before the pass stops: Garmin is
/// answering errors, and every further ride would only add to them.
const FAILURES_TO_STOP: u32 = 5;

/// Passes that find a ride's original unobtainable before it is given up. A
/// file that never decodes would otherwise hold the checkpoints for good.
const SKIPS_TO_GIVE_UP: u32 = 3;

/// The longest one sleep in a hold runs, so a stop is heard within it.
const WAIT_STEP: std::time::Duration = std::time::Duration::from_secs(30);

/// Why a pass ended before it walked everything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Halt {
    /// Stopped by the athlete or by the key going away.
    Cancelled,
    /// Garmin asked for a pause; nothing is sent before `until`.
    Paused { until: DateTime<Utc> },
    /// Garmin refused the key. Nothing more is asked until a new one is pasted.
    KeyRejected,
    /// Garmin could not be reached, or kept answering errors.
    Unreachable,
    /// The library the pass writes into is gone or not yet known.
    Unstorable,
}

/// Where the pull stands, for the settings screen to show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullState {
    Idle,
    Running,
    Paused { until: DateTime<Utc> },
    Done,
    Stopped(Halt),
}

static STATE: LazyLock<Mutex<PullState>> = LazyLock::new(|| Mutex::new(PullState::Idle));
static ACTIVE: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static RESUME_NOW: AtomicBool = AtomicBool::new(false);

fn set_state(state: PullState) {
    *STATE.lock().unwrap_or_else(|e| e.into_inner()) = state;
}

/// The pull's state in this process.
pub fn state() -> PullState {
    STATE.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// What a pass reads and writes on the device.
pub(crate) trait PullStore: Send + Sync {
    fn setting(&self, key: &str) -> Option<String>;
    fn set_setting(&self, key: &str, value: &str);
    /// Which of `ids` the device holds complete: stored from Garmin's
    /// original, or served in full by intervals.icu. Read in one query per
    /// window, off the engine's write lock.
    fn completed(&self, ids: &[i64]) -> HashSet<i64>;
    /// Store one original. Its scores, the curves and the fitness series are
    /// owed to the window it belongs to, which settles them with
    /// [`PullStore::finish`] once it has walked.
    fn ingest(&self, listed: &ListedActivity, fit: &[u8]) -> Result<Ingested, IngestError>;
    /// Work out what the rides stored since the last call owe the library,
    /// once for all of them.
    fn finish(&self, keys: &[String]);
    /// Tell the athlete of a ride stored in a window that has finished, when
    /// it is news.
    fn announce(&self, listed: &ListedActivity);
}

/// The library open at one install.
pub(crate) struct InstallStore(pub(crate) u64);

impl PullStore for InstallStore {
    fn setting(&self, key: &str) -> Option<String> {
        crate::objects::error::with_reader(|conn| {
            crate::persistence::settings::setting_from(conn, key)
                .ok()
                .flatten()
        })
        .ok()
        .flatten()
    }

    fn set_setting(&self, key: &str, value: &str) {
        let written =
            crate::persistence::with_persistent_engine_for(self.0, |e| e.set_setting(key, value));
        if !matches!(written, Some(Ok(()))) {
            log::warn!("veloqrs: [garmin] a pull setting did not store: {key}");
        }
    }

    fn completed(&self, ids: &[i64]) -> HashSet<i64> {
        let held = crate::objects::error::with_reader(held_garmin_ids).ok();
        let held = held.and_then(Result::ok).unwrap_or_default();
        ids.iter().copied().filter(|id| held.contains(id)).collect()
    }

    fn ingest(&self, listed: &ListedActivity, fit: &[u8]) -> Result<Ingested, IngestError> {
        use crate::persistence::settings::settings_keys::GARMIN_UPLOAD;
        let keep_for_upload = self.setting(GARMIN_UPLOAD).as_deref() == Some("true");
        super::ingest::ingest_original_in_batch(self.0, listed, fit, keep_for_upload, false)
    }

    fn finish(&self, keys: &[String]) {
        if !super::ingest::finish_batch_for(self.0, keys) {
            log::warn!("veloqrs: [garmin] a window's rides were not settled: the engine closed");
        }
    }

    fn announce(&self, listed: &ListedActivity) {
        if !crate::push::is_recent_ride(listed.start_time_gmt.as_deref(), Utc::now()) {
            return;
        }
        let key = crate::persistence::origin::garmin_source_key(listed.activity_id);
        crate::push::ready_stored_ride(self.0, &key);
        crate::push::announce_pulled_ride(
            self.0,
            &key,
            listed.activity_name.as_deref().unwrap_or_default(),
        );
    }
}

/// Every Garmin activity id the library holds complete: the originals stored
/// under a Garmin key, and the activities intervals.icu serves in full that it
/// imported from Garmin. An activity it holds back as an empty stub is not
/// complete, which is what the original is downloaded to fill.
pub(crate) fn held_garmin_ids(conn: &rusqlite::Connection) -> rusqlite::Result<HashSet<i64>> {
    let prefix = crate::persistence::origin::GARMIN_KEY_PREFIX;
    let mut held = HashSet::new();
    let mut stored = conn.prepare_cached(
        "SELECT activity_id FROM activity_bodies WHERE substr(activity_id, 1, ?1) = ?2",
    )?;
    let rows = stored.query_map(rusqlite::params![prefix.len() as i64, prefix], |row| {
        row.get::<_, String>(0)
    })?;
    for key in rows {
        if let Some(id) = key?.strip_prefix(prefix).and_then(|id| id.parse().ok()) {
            held.insert(id);
        }
    }
    let mut served = conn.prepare_cached(
        "SELECT CAST(json_extract(b.raw, '$.external_id') AS TEXT)
         FROM activity_bodies b
         WHERE json_valid(b.raw)
           AND json_extract(b.raw, '$.source') = 'GARMIN_CONNECT'
           AND NOT EXISTS (SELECT 1 FROM activity_held_back h WHERE h.activity_id = b.activity_id)",
    )?;
    let rows = served.query_map([], |row| row.get::<_, Option<String>>(0))?;
    for external in rows {
        if let Some(id) = external?.and_then(|id| id.parse().ok()) {
            held.insert(id);
        }
    }
    Ok(held)
}

fn date_setting(store: &dyn PullStore, key: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(&store.setting(key)?, "%Y-%m-%d").ok()
}

fn set_date(store: &dyn PullStore, key: &str, day: NaiveDate) {
    store.set_setting(key, &day.format("%Y-%m-%d").to_string());
}

/// What the pull has done, read from the settings rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Progress {
    /// Originals stored from Garmin.
    pub stored: u32,
    /// The first day the backfill has finished, `None` before the first pass.
    pub reached: Option<NaiveDate>,
    /// Whether the backfill has passed the oldest ride.
    pub backfill_done: bool,
}

/// The pull's progress in the library open now.
pub fn progress_now() -> Progress {
    progress(&InstallStore(0))
}

pub(crate) fn progress(store: &dyn PullStore) -> Progress {
    progress_from(&|key| store.setting(key))
}

fn progress_from(setting: &dyn Fn(&str) -> Option<String>) -> Progress {
    Progress {
        stored: setting(STORED).and_then(|n| n.parse().ok()).unwrap_or(0),
        reached: setting(CURSOR).and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok()),
        backfill_done: setting(BACKFILL_DONE).is_some(),
    }
}

/// The pull as the settings screen reads it: the process's state with the
/// checkpoints on this device. `None` while no Garmin key is held, since the
/// pull is not the athlete's then.
pub(crate) fn screen_read(conn: &rusqlite::Connection) -> Option<crate::FfiGarminPull> {
    crate::objects::garmin_key::GARMIN_KEY.client()?;
    let seen = progress_from(&|key| {
        crate::persistence::settings::setting_from(conn, key)
            .ok()
            .flatten()
    });
    Some(report(&state(), &seen))
}

/// [`PullState`] and [`Progress`] as the one record the screen shows.
pub(crate) fn report(state: &PullState, seen: &Progress) -> crate::FfiGarminPull {
    use crate::{FfiGarminHalt, FfiGarminPullPhase};
    let (phase, resume_at, halt) = match state {
        PullState::Idle => (FfiGarminPullPhase::Idle, None, None),
        PullState::Running => (FfiGarminPullPhase::Running, None, None),
        PullState::Done => (FfiGarminPullPhase::Done, None, None),
        PullState::Paused { until } => (
            FfiGarminPullPhase::Paused,
            Some(crate::WholeNumber(until.timestamp_millis())),
            None,
        ),
        PullState::Stopped(halt) => (
            FfiGarminPullPhase::Stopped,
            None,
            match halt {
                Halt::KeyRejected => Some(FfiGarminHalt::KeyRejected),
                Halt::Unstorable => Some(FfiGarminHalt::Unstorable),
                Halt::Unreachable | Halt::Cancelled | Halt::Paused { .. } => {
                    Some(FfiGarminHalt::Unreachable)
                }
            },
        ),
    };
    crate::FfiGarminPull {
        phase,
        resume_at,
        halt,
        stored: seen.stored,
        reached_month: seen.reached.map(|d| d.format("%Y-%m").to_string()),
        backfill_done: seen.backfill_done,
    }
}

/// Whether an intervals.icu activity body says Garmin supplied it.
pub(crate) fn body_is_from_garmin(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|body| body.get("source")?.as_str().map(|s| s == "GARMIN_CONNECT"))
        .unwrap_or(false)
}

/// How a failed Garmin call ends the pass, or `None` when only the ride it
/// was for is lost.
fn halt_of(e: &GarminError) -> Option<Halt> {
    match e {
        GarminError::KeyRejected | GarminError::KeyMalformed => Some(Halt::KeyRejected),
        GarminError::Net(NetError::Unauthorized) => Some(Halt::KeyRejected),
        GarminError::Net(NetError::Deferred { until }) => Some(Halt::Paused { until: *until }),
        GarminError::Net(NetError::RateLimited) => Some(Halt::Paused {
            until: Utc::now() + Duration::minutes(15),
        }),
        GarminError::Net(NetError::Transport(_)) => Some(Halt::Unreachable),
        GarminError::Net(_) => None,
    }
}

fn read_skipped(store: &dyn PullStore) -> HashMap<i64, u32> {
    store
        .setting(SKIPPED)
        .unwrap_or_default()
        .split(',')
        .filter_map(|pair| {
            let (id, passes) = pair.split_once('=')?;
            Some((id.parse().ok()?, passes.parse().ok()?))
        })
        .collect()
}

fn write_skipped(store: &dyn PullStore, skipped: &HashMap<i64, u32>) {
    let mut pairs: Vec<_> = skipped.iter().collect();
    pairs.sort();
    let text: Vec<String> = pairs
        .iter()
        .map(|(id, passes)| format!("{id}={passes}"))
        .collect();
    store.set_setting(SKIPPED, &text.join(","));
}

/// What a window walked.
struct Window {
    /// Whether every ride in it is stored, held, or given up. A window that is
    /// not settled owes a ride, so the checkpoint stays before it.
    settled: bool,
}

/// List `from` to `to` and store the original of each ride not yet held
/// complete. A ride whose original does not download or store is recorded and
/// tried again by later passes, up to [`SKIPS_TO_GIVE_UP`] of them. A ride
/// Garmin holds no FIT for is given up at once, and is not a failed download.
async fn pull_window(
    client: &GarminClient,
    store: &dyn PullStore,
    from: NaiveDate,
    to: NaiveDate,
    cancel: &AtomicBool,
) -> Result<Window, Halt> {
    let day = |d: NaiveDate| d.format("%Y-%m-%d").to_string();
    let listed = match client
        .list_activities(&day(from), &day(to), dispatch())
        .await
    {
        Ok(listed) => listed,
        Err(e) => return Err(halt_of(&e).unwrap_or(Halt::Unreachable)),
    };
    let ids: Vec<i64> = listed.iter().map(|l| l.activity_id).collect();
    let held = store.completed(&ids);
    let mut stored = 0u32;
    let mut stored_keys: Vec<String> = Vec::new();
    let mut stored_rides: Vec<&ListedActivity> = Vec::new();
    let mut failures = 0u32;
    let mut skipped = read_skipped(store);
    let before = skipped.clone();
    let mut settled = true;
    let mut outcome = Ok(());
    for ride in &listed {
        if cancel.load(Ordering::SeqCst) {
            outcome = Err(Halt::Cancelled);
            break;
        }
        if ride.manual_activity == Some(true) || held.contains(&ride.activity_id) {
            skipped.remove(&ride.activity_id);
            continue;
        }
        let passes = skipped.get(&ride.activity_id).copied().unwrap_or(0);
        if passes >= SKIPS_TO_GIVE_UP {
            continue;
        }
        let mut skip = |settled: &mut bool| {
            skipped.insert(ride.activity_id, passes + 1);
            *settled &= passes + 1 >= SKIPS_TO_GIVE_UP;
        };
        let fit = match client.download_original(ride.activity_id, dispatch()).await {
            Ok(Some(fit)) => fit,
            Ok(None) => {
                // Garmin answered and holds no FIT for this ride, so the ride is
                // given up on this pass rather than after the third.
                failures = 0;
                skipped.insert(ride.activity_id, SKIPS_TO_GIVE_UP);
                continue;
            }
            Err(e) => {
                if let Some(halt) = halt_of(&e) {
                    outcome = Err(halt);
                    break;
                }
                log::warn!("veloqrs: [garmin] an original did not download: {e}");
                failures += 1;
                skip(&mut settled);
                if failures >= FAILURES_TO_STOP {
                    outcome = Err(Halt::Unreachable);
                    break;
                }
                continue;
            }
        };
        match store.ingest(ride, &fit) {
            Ok(Ingested::Stored { .. }) => {
                stored += 1;
                stored_keys.push(crate::persistence::origin::garmin_source_key(
                    ride.activity_id,
                ));
                stored_rides.push(ride);
                failures = 0;
                skipped.remove(&ride.activity_id);
            }
            Ok(Ingested::AlreadyStored | Ingested::Linked { .. }) => {
                failures = 0;
                skipped.remove(&ride.activity_id);
            }
            Err(IngestError::EngineClosed) => {
                outcome = Err(Halt::Unstorable);
                break;
            }
            Err(e) => {
                log::warn!("veloqrs: [garmin] an original did not store: {e}");
                skip(&mut settled);
            }
        }
    }
    if skipped != before {
        write_skipped(store, &skipped);
    }
    if !stored_keys.is_empty() {
        store.finish(&stored_keys);
        for ride in &stored_rides {
            store.announce(ride);
        }
    }
    if stored > 0 {
        let before: u32 = store
            .setting(STORED)
            .and_then(|n| n.parse().ok())
            .unwrap_or(0);
        store.set_setting(STORED, &(before + stored).to_string());
    }
    outcome.map(|()| Window { settled })
}

/// One pass: the days since the watermark, then the backfill as far as it
/// goes. `Ok` is everything walked, or stopped short at a window that still
/// owes a ride; a `Halt` leaves the checkpoints where they
/// are, and the next pass goes on from them.
pub(crate) async fn run_pass(
    client: &GarminClient,
    store: &dyn PullStore,
    today: NaiveDate,
    cancel: &AtomicBool,
) -> Result<(), Halt> {
    let from = match date_setting(store, WATERMARK) {
        Some(watermark) => watermark - Duration::days(OVERLAP_DAYS),
        None => today - Duration::days(FIRST_WINDOW_DAYS),
    };
    let recent = pull_window(client, store, from, today, cancel).await?;
    if date_setting(store, WATERMARK).is_none() {
        start_backfill_at(store, from);
    }
    if recent.settled {
        set_date(store, WATERMARK, today);
    }
    backfill(client, store, today, cancel).await
}

/// With no watermark, no window has yet carried the checkpoints forward, so
/// the backfill starts from the window this pass listed. Called only after
/// that window lists, so a pass that halts first leaves the cursor as it was.
fn start_backfill_at(store: &dyn PullStore, from: NaiveDate) {
    set_date(store, CURSOR, from);
}

/// The local day of the oldest ride Garmin holds, from one listing of its
/// whole history. `None` when Garmin lists nothing.
async fn oldest_ride_day(
    client: &GarminClient,
    today: NaiveDate,
) -> Result<Option<NaiveDate>, Halt> {
    let listed = client
        .list_activities(
            HISTORY_START,
            &today.format("%Y-%m-%d").to_string(),
            dispatch(),
        )
        .await
        .map_err(|e| halt_of(&e).unwrap_or(Halt::Unreachable))?;
    Ok(listed
        .iter()
        .filter_map(|l| {
            let local = l.start_time_local.as_deref()?;
            NaiveDate::parse_from_str(local.get(..10)?, "%Y-%m-%d").ok()
        })
        .min())
}

async fn backfill(
    client: &GarminClient,
    store: &dyn PullStore,
    today: NaiveDate,
    cancel: &AtomicBool,
) -> Result<(), Halt> {
    while store.setting(BACKFILL_DONE).is_none() {
        if cancel.load(Ordering::SeqCst) {
            return Err(Halt::Cancelled);
        }
        let Some(reached) = date_setting(store, CURSOR) else {
            return Ok(());
        };
        let floor = match date_setting(store, FLOOR) {
            Some(floor) => floor,
            None => match oldest_ride_day(client, today).await? {
                Some(floor) => {
                    set_date(store, FLOOR, floor);
                    floor
                }
                None => {
                    store.set_setting(BACKFILL_DONE, "1");
                    break;
                }
            },
        };
        let end = reached - Duration::days(1);
        if end < floor {
            store.set_setting(BACKFILL_DONE, "1");
            break;
        }
        let start = end.with_day(1).unwrap_or(end);
        let window = pull_window(client, store, start, end, cancel).await?;
        if !window.settled {
            return Ok(());
        }
        set_date(store, CURSOR, start);
    }
    Ok(())
}

/// Sleep out `until`, in steps a stop is heard within. `false` when stopped.
async fn wait_out(until: DateTime<Utc>, cancel: &AtomicBool) -> bool {
    let mut left = (until - Utc::now()).to_std().unwrap_or_default();
    while !left.is_zero() {
        if cancel.load(Ordering::SeqCst) {
            return false;
        }
        if RESUME_NOW.swap(false, Ordering::SeqCst) {
            return true;
        }
        let step = left.min(WAIT_STEP);
        crate::governor::pause(step).await;
        left -= step;
    }
    !cancel.load(Ordering::SeqCst)
}

/// [`run_pass`] again after each pause Garmin asks for, until the pull is
/// done or something other than a pause stops it.
pub(crate) async fn run_settled(
    client: &GarminClient,
    store: &dyn PullStore,
    today: impl Fn() -> NaiveDate,
    cancel: &AtomicBool,
) -> Result<(), Halt> {
    loop {
        match run_pass(client, store, today(), cancel).await {
            Err(Halt::Paused { until }) => {
                set_state(PullState::Paused { until });
                if !wait_out(until, cancel).await {
                    return Err(Halt::Cancelled);
                }
                set_state(PullState::Running);
            }
            other => return other,
        }
    }
}

/// Clears the running mark however the pass thread ends.
struct Active;

impl Drop for Active {
    fn drop(&mut self) {
        ACTIVE.store(false, Ordering::SeqCst);
    }
}

/// Start a pass for the library open at `install` on a thread of its own,
/// unless one is running or no key is held. Returns whether one started.
pub(crate) fn start(install: u64) -> bool {
    let Some(client) = crate::objects::garmin_key::GARMIN_KEY.client() else {
        return false;
    };
    if ACTIVE.swap(true, Ordering::SeqCst) {
        return false;
    }
    CANCEL.store(false, Ordering::SeqCst);
    RESUME_NOW.store(false, Ordering::SeqCst);
    set_state(PullState::Running);
    crate::threads::spawn_named("veloq-garmin", move || {
        let _active = Active;
        let end = crate::runtime::block_on(run_settled(
            &client,
            &InstallStore(install),
            || chrono::Local::now().date_naive(),
            &CANCEL,
        ));
        set_state(match end {
            Ok(()) => PullState::Done,
            Err(Halt::Cancelled) => PullState::Idle,
            Err(halt) => PullState::Stopped(halt),
        });
    });
    true
}

/// Whether a pass holds the Garmin lane now, running or paused.
pub(crate) fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

/// Ask a paused pass to go on now rather than at the end of the pause. Garmin's
/// own hold still applies: the next request is deferred again if it has not
/// lifted.
pub(crate) fn request_resume() {
    RESUME_NOW.store(true, Ordering::SeqCst);
}

/// The athlete's pull now: a paused pass goes on at once, and a stopped or
/// idle one starts. Returns whether a pass is running afterwards.
pub(crate) fn pull_now(install: u64) -> bool {
    if matches!(state(), PullState::Paused { .. }) {
        request_resume();
        return true;
    }
    start(install)
}

/// A webhook named `activity_id`: start a pass when the stored body says
/// Garmin supplied it. The pass keeps Garmin's pacing, which the lane owns.
pub(crate) fn pull_for_webhook(install: u64, activity_id: &str) -> bool {
    let from_garmin = crate::objects::error::with_reader(|conn| {
        conn.query_row(
            "SELECT raw FROM activity_bodies WHERE activity_id = ?1",
            [activity_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .is_some_and(|raw| body_is_from_garmin(&raw))
    })
    .unwrap_or(false);
    from_garmin && start(install)
}

/// Stop the pass at its next ride. The checkpoints stay.
pub(crate) fn stop() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests;
