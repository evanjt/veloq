//! Heatmap tile generation for PersistentEngine.
//!
//! Tile generation runs on a background thread with its own SQLite connection,
//! following the same pattern as section detection. The engine mutex is held
//! only briefly to extract metadata (db_path, tiles_path, activity bounds).

use super::attempts::{Claim, JobKey, Release, now_ms};
use super::codec::TrackRead;
use super::{PersistentEngine, TileGenerationHandle};
use crate::objects::observer::Announcement;
use crate::tiles;
use log::info;
use rayon::prelude::*;
use rusqlite::Connection;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, RwLock, TryLockError};
use std::time::{Duration, Instant};
use tracematch::{Bounds, GpsPoint};

/// Tile format version - increment when tile size, zoom range, or rendering changes.
/// Triggers automatic cache clear + regeneration on app upgrade.
pub(crate) const TILE_FORMAT_VERSION: &str = "10";

/// The bytes on disk the tiles drawn on request may hold. About 8,000 deep
/// tiles of one 4 KiB block each, which is on the order of a hundred distinct
/// views at the deepest zooms.
pub(crate) const DEEP_TILE_BUDGET: u64 = 32 * 1024 * 1024;

/// A smaller budget a test sets, so it can pass it without drawing 32 MiB.
#[cfg(any(test, feature = "synthetic"))]
static DEEP_TILE_BUDGET_OVERRIDE: AtomicU64 = AtomicU64::new(0);

/// Hold the tiles drawn on request under `bytes` rather than
/// [`DEEP_TILE_BUDGET`], or under it again with `None`.
#[cfg(any(test, feature = "synthetic"))]
#[doc(hidden)]
pub fn set_deep_tile_budget(bytes: Option<u64>) {
    DEEP_TILE_BUDGET_OVERRIDE.store(bytes.unwrap_or(0), Ordering::Release);
}

fn deep_tile_budget() -> u64 {
    #[cfg(any(test, feature = "synthetic"))]
    {
        let set = DEEP_TILE_BUDGET_OVERRIDE.load(Ordering::Acquire);
        if set > 0 {
            return set;
        }
    }
    DEEP_TILE_BUDGET
}

/// Marker file written to the tiles directory when new data arrives.
/// Cleared after tile generation completes. Prevents redundant generation on app restart.
pub(crate) const DIRTY_MARKER: &str = ".dirty";

/// Number of unreadable activities named individually in the log.
const CORRUPT_ID_LOG_CAP: usize = 20;

/// Ids whose stored track did not decode on the last run, kept beside the tile
/// version. A tile drawn while an activity was unreadable is short that
/// activity, and `tile_exists` would serve it forever, so the next run redraws
/// the tiles those activities reach whether or not they are readable again.
const CORRUPT_RECORD: &str = "corrupt-activities.json";

/// Distinguishes two marks written inside the same clock tick.
static DIRTY_TOKEN: AtomicU64 = AtomicU64::new(0);

/// The ground sweeps changed since the last complete pass, one span a line.
/// Present only while every mark since that pass was a sweep.
const SWEPT_RECORD: &str = "swept-tiles";

/// Serialises every write to the dirty marker and the swept record, so a
/// sweep can tell whether the marker standing was its own kind of mark.
static MARK_GATE: Mutex<()> = Mutex::new(());

fn mark_gate() -> MutexGuard<'static, ()> {
    MARK_GATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Where a held pass waits.
#[cfg(any(test, feature = "synthetic"))]
#[derive(Clone, Copy, PartialEq)]
enum HoldPoint {
    /// Tiles scheduled, none drawn.
    BeforeDrawing,
    /// Inside the first tile a worker reaches, past its cancel check and
    /// before its save: the tile a cancel cannot stop.
    InTile,
}

/// Both sides of a hold the pass takes, and where it waits.
#[cfg(any(test, feature = "synthetic"))]
type Hold = (mpsc::Sender<()>, mpsc::Receiver<()>);

/// A hold the next tile pass waits on, so a test can land a cancel or a wipe
/// on a pass in flight without racing it. Built only for the synthetic test
/// lane.
#[cfg(any(test, feature = "synthetic"))]
static TILE_PASS_HOLD: std::sync::Mutex<Option<(Hold, HoldPoint)>> = std::sync::Mutex::new(None);

/// The test's side of [`hold_next_tile_pass`],
/// [`hold_next_tile_pass_inside_a_tile`] and [`hold_next_tile_draw`].
/// Dropping it releases the pass or the draw, so a failed assertion never
/// leaves the worker waiting.
#[cfg(any(test, feature = "synthetic"))]
#[doc(hidden)]
pub struct TilePassHold {
    reached: mpsc::Receiver<()>,
    release: mpsc::Sender<()>,
}

#[cfg(any(test, feature = "synthetic"))]
impl TilePassHold {
    /// Block until the pass reaches its hold: its tiles scheduled, or its
    /// first tile drawn and not yet saved. A tile drawn on request holds with
    /// its tracks read and nothing drawn.
    /// Panics when the pass ended without getting there.
    pub fn wait_until_reached(&self) {
        self.reached
            .recv()
            .expect("the pass ended before it reached the hold");
    }

    /// Let the pass draw.
    pub fn release(self) {
        let _ = self.release.send(());
    }
}

/// Hold the next tile pass started in this process just before it draws.
#[cfg(any(test, feature = "synthetic"))]
#[doc(hidden)]
pub fn hold_next_tile_pass() -> TilePassHold {
    hold_next_tile_pass_at(HoldPoint::BeforeDrawing)
}

/// Hold the next tile pass inside its first tile, after the cancel check and
/// before the save, so the tile is in flight whatever is cancelled meanwhile.
#[cfg(any(test, feature = "synthetic"))]
#[doc(hidden)]
pub fn hold_next_tile_pass_inside_a_tile() -> TilePassHold {
    hold_next_tile_pass_at(HoldPoint::InTile)
}

#[cfg(any(test, feature = "synthetic"))]
fn hold_next_tile_pass_at(point: HoldPoint) -> TilePassHold {
    let (reached_tx, reached_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    *TILE_PASS_HOLD.lock().unwrap_or_else(|e| e.into_inner()) =
        Some(((reached_tx, release_rx), point));
    TilePassHold {
        reached: reached_rx,
        release: release_tx,
    }
}

/// The running tile pass's stop, or `None` when no pass is on a thread in this
/// process. There is one handle slot, so a second pass would drop the first's
/// handle while both workers wrote the same tile files, and a wipe needs the
/// one token that reaches the worker actually drawing.
static TILE_PASS: Mutex<Option<super::CancelToken>> = Mutex::new(None);

/// A wipe holds this exclusively from before stopping a pass until every set
/// is marked. A pass claims and a tile drawn on request is written under a
/// shared hold, so neither waits on the other and neither lands inside a wipe.
static TILE_WIPE_GATE: RwLock<()> = RwLock::new(());

/// Wipes begun in this process, so a tile drawn on request can tell a wipe ran
/// while it drew though the wipe has since ended.
static TILE_WIPES: AtomicU64 = AtomicU64::new(0);

/// Signalled when the pass in [`TILE_PASS`] ends.
static TILE_PASS_ENDED: Condvar = Condvar::new();

#[derive(Clone, PartialEq, Eq)]
struct TilePassRetry {
    path: String,
    install: u64,
}

static TILE_PASS_RETRY: Mutex<Option<TilePassRetry>> = Mutex::new(None);

fn tile_pass_retry() -> MutexGuard<'static, Option<TilePassRetry>> {
    TILE_PASS_RETRY.lock().unwrap_or_else(|e| e.into_inner())
}

fn schedule_tile_pass_retry(engine: &PersistentEngine) {
    let Some(path) = engine.heatmap_tiles_path().map(str::to_string) else {
        return;
    };
    let mut pending = tile_pass_retry();
    let spawn = pending.is_none();
    *pending = Some(TilePassRetry {
        path,
        install: super::engine_install(),
    });
    drop(pending);
    if spawn {
        crate::threads::spawn_background("veloq-tileretry", run_tile_pass_retry);
    }
}

fn run_tile_pass_retry() {
    loop {
        std::thread::sleep(Duration::from_millis(100));
        let Some(target) = tile_pass_retry().clone() else {
            return;
        };
        if !request_pass(Some(&target.path), target.install) {
            continue;
        }
        let mut pending = tile_pass_retry();
        if pending.as_ref() == Some(&target) {
            *pending = None;
            return;
        }
    }
}

/// How long a wipe waits for a running pass to end. The pass checks its stop
/// between tiles and a tile is tens of milliseconds, but the track load before
/// the first check cannot be left, and on a large library it is seconds.
const TILE_PASS_STOP_WAIT: Duration = Duration::from_secs(30);

fn tile_pass_slot() -> MutexGuard<'static, Option<super::CancelToken>> {
    TILE_PASS.lock().unwrap_or_else(|e| e.into_inner())
}

/// The attempt-store identity of the one tile pass.
fn tile_pass_key() -> JobKey {
    JobKey::new("tile_pass", &[])
}

/// Holds the tile-pass lease in the attempt store and registers the pass's
/// stop in [`TILE_PASS`]. Release is structural, so a panic in the pass cannot
/// leave tile generation unstartable, and it reads as a failure so the key
/// backs off.
///
/// The store is the owner of "a pass is running". The slot carries only the
/// token a wipe needs to stop the pass, and it also covers a pass that
/// outlives the engine install its lease was written under.
struct TilePassGuard {
    install: u64,
    /// The database the lease was written to, which is the claiming engine's
    /// and not always the installed one's.
    db_path: String,
}

impl Drop for TilePassGuard {
    fn drop(&mut self) {
        let release = if std::thread::panicking() {
            Release::failed(
                crate::objects::start::FfiStartOutcome::Failed,
                Some("the tile pass panicked"),
            )
        } else {
            Release::Done
        };
        // Before the slot empties, so a wipe that sees it empty finds the key
        // free too.
        let at = now_ms();
        let in_installed = super::with_persistent_engine_for(self.install, |engine| {
            if engine.db_path != self.db_path {
                return false;
            }
            if let Err(e) = engine.release_job(&tile_pass_key(), release.clone(), at) {
                log::warn!("[heatmap] Could not release the tile pass: {e}");
            }
            true
        })
        .unwrap_or(false);
        // A pass started on an engine that is not the installed one holds its
        // lease in that engine's database, and left there the key reads as in
        // flight for good. An install that moved means the library was wiped
        // or replaced, and the lease went with it.
        if !in_installed
            && super::engine_install() == self.install
            && let Some(_write) = super::suspension::begin_write()
        {
            let released = Connection::open(&self.db_path).and_then(|db| {
                db.busy_timeout(Duration::from_secs(5))?;
                super::attempts::release_job_in(&db, &tile_pass_key(), release, at)
            });
            if let Err(e) = released {
                log::warn!("[heatmap] Could not release the tile pass: {e}");
            }
        }
        *tile_pass_slot() = None;
        TILE_PASS_ENDED.notify_all();
    }
}

impl TilePassGuard {
    /// Claim the pass for one that stops on `cancel`, or `None` when a pass
    /// already holds it, the key is backing off after a failure, or a wipe is
    /// under way.
    fn claim(engine: &PersistentEngine, cancel: &super::CancelToken) -> Option<Self> {
        let _gate = match TILE_WIPE_GATE.try_read() {
            Ok(gate) => gate,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return None,
        };
        let mut slot = tile_pass_slot();
        if slot.is_some() {
            return None;
        }
        match engine.claim_job(&tile_pass_key(), now_ms()) {
            Ok(Claim::Taken) => {}
            Ok(Claim::InFlight) => return None,
            Ok(Claim::BackingOff { until }) => {
                info!("[heatmap] The tile pass is backing off until {until}");
                return None;
            }
            Err(e) => {
                if matches!(
                    e.sqlite_error_code(),
                    Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
                ) {
                    schedule_tile_pass_retry(engine);
                }
                log::warn!("[heatmap] Could not claim the tile pass: {e}");
                return None;
            }
        }
        *slot = Some(cancel.clone());
        Some(TilePassGuard {
            install: super::engine_install(),
            db_path: engine.db_path.clone(),
        })
    }
}

/// Stop the running tile pass and wait up to `wait` for its worker to end.
///
/// A cancel alone is not enough before a delete: the worker reads it between
/// tiles, so a tile in flight is saved after the cancel, and a delete that
/// went first leaves it on disk. An error when the pass is still running at
/// the end of the wait, since deleting under it would be that leak.
fn stop_tile_pass(wait: Duration) -> Result<(), String> {
    // Whichever pass holds the slot at each wakeup is stopped, not only the
    // one found first: another may claim it the moment that one ends.
    let (slot, _) = TILE_PASS_ENDED
        .wait_timeout_while(tile_pass_slot(), wait, |running| match running {
            Some(cancel) => {
                cancel.cancel();
                true
            }
            None => false,
        })
        .unwrap_or_else(|e| e.into_inner());
    if slot.is_some() {
        return Err(format!(
            "A heatmap tile pass did not stop within {} s, so its tiles were not removed",
            wait.as_secs()
        ));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn finish_test_tile_pass() {
    loop {
        stop_tile_pass(TILE_PASS_STOP_WAIT).expect("a tile pass did not stop after its test");
        let parked = super::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(handle) = parked {
            handle.recv_blocking();
            continue;
        }
        if tile_pass_slot().is_none() && tile_pass_retry().is_none() {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// Counts the tiles of the first band as the workers finish them, and says
/// once when the last of them is on disk.
///
/// A source reload is the only thing that makes the map ask again for a tile
/// it was told was missing, so the screen's tiles are visible only from the
/// next announcement. Held back to the end of the pass, that is the length of
/// the whole sweep whatever the viewport holds; sent when the first band is
/// done, it is the length of that band.
struct FirstBandDrawn {
    remaining: AtomicU32,
}

impl FirstBandDrawn {
    /// Waits on `size` tiles. A band that is empty or is the whole pass has no
    /// early moment: the end of the pass announces it.
    fn new(size: usize, total: usize) -> Self {
        let waits = size > 0 && size < total;
        Self {
            remaining: AtomicU32::new(if waits { size as u32 } else { 0 }),
        }
    }

    /// True for exactly one call: the one that finishes the band.
    fn tile_done(&self, in_first_band: bool) -> bool {
        in_first_band
            && self
                .remaining
                .try_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_sub(1))
                .is_ok_and(|before| before == 1)
    }
}

/// Every activity's track, placed on the map, plus the ones whose stored blob
/// did not decode.
struct LoadedTracks {
    tracks: LoadedTracksById,
    corrupt: Vec<(String, String)>,
}

/// What one background tile run produced. `corrupt` is the number of
/// activities whose stored track did not decode, so the caller can tell a
/// complete tile set from one drawn over part of the library.
#[derive(Debug, Default, Clone, Copy)]
struct TileGeneration {
    generated: u32,
    corrupt: usize,
    /// The athlete stopped it. The counts are what it managed, not what it
    /// owed, so nothing downstream may read a cancelled run as a finished one.
    cancelled: bool,
}

/// What the map's tile reader needs, readable without the engine lock.
///
/// The WebView's request interceptor runs on a background thread with no
/// JavaScript context and no business taking the engine's lock: a tile the map
/// is drawing would then queue behind whatever a sync is writing. It needs the
/// tiles directory to read a drawn tile, and to draw a deep one it has not got
/// it needs the database and every activity's bounds. A new value is
/// published whole whenever the path or the catalogue changes, so a reader
/// holding the old one can tell, by identity, that what it drew from moved.
static HEATMAP_SOURCE: RwLock<Option<Arc<HeatmapSource>>> = RwLock::new(None);

struct HeatmapSource {
    dir: String,
    db_path: String,
    bounds: Arc<rstar::RTree<super::ActivityBoundsEntry>>,
}

fn publish_heatmap_source(source: Option<HeatmapSource>) {
    let source = source.map(Arc::new);
    match HEATMAP_SOURCE.write() {
        Ok(mut held) => *held = source,
        Err(poisoned) => *poisoned.into_inner() = source,
    }
}

fn heatmap_source() -> Option<Arc<HeatmapSource>> {
    match HEATMAP_SOURCE.read() {
        Ok(held) => held.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

/// Where the athlete is looking, so the pass can draw that ground first.
///
/// Latitude, longitude and the zoom the camera is at. The pass otherwise
/// writes every zoom in full before the next one, so on a fresh install the
/// deepest tiles it draws of the viewport on screen are behind the whole
/// lower sweep. Set from the map when the camera settles and cleared when it
/// leaves, and read once per pass, so a camera that moves mid-pass changes
/// the next one rather than this one.
static TILE_PRIORITY: RwLock<Option<(f64, f64, u8)>> = RwLock::new(None);

/// Draw the ground around this point, at this zoom, before the rest.
pub fn set_tile_priority(latitude: f64, longitude: f64, zoom: u8) {
    let value =
        (latitude.is_finite() && longitude.is_finite()).then_some((latitude, longitude, zoom));
    match TILE_PRIORITY.write() {
        Ok(mut held) => *held = value,
        Err(poisoned) => *poisoned.into_inner() = value,
    }
}

/// Forget it: no screen is waiting on any particular ground.
pub fn clear_tile_priority() {
    match TILE_PRIORITY.write() {
        Ok(mut held) => *held = None,
        Err(poisoned) => *poisoned.into_inner() = None,
    }
}

fn tile_priority() -> Option<(f64, f64, u8)> {
    match TILE_PRIORITY.read() {
        Ok(held) => *held,
        Err(poisoned) => *poisoned.into_inner(),
    }
}

/// Tiles either side of the centre tile, at the zoom on screen, that count as
/// on screen. The heatmap is a 256-point raster, so a phone held upright shows
/// about two tiles across and four down: two each way covers it in either
/// orientation, from the centre the camera reports alone.
const PRIORITY_WINDOW_TILES: f64 = 2.0;

/// How late a tile may be drawn: 0 is the window on screen at the zoom it is
/// showing and one either side, 1 is the same window at another zoom, 2 is
/// everything else.
///
/// The window is the centre tile and [`PRIORITY_WINDOW_TILES`] round it at the
/// zoom shown, carried to every other zoom as the same ground. Three bands
/// and not a distance, because a distance orders tiles the athlete cannot see
/// as finely as the ones they can, and the point is only to get the screen
/// drawn first. A camera deeper than the pass draws counts as at the pass's
/// deepest zoom: the map draws its own zoom on request, and the pass's part
/// of the screen is the ground below it.
fn priority_rank(coord: (u8, u32, u32), priority: Option<(f64, f64, u8)>) -> u8 {
    let Some((lat, lon, zoom)) = priority else {
        return 0;
    };
    let zoom = zoom.min(tiles::HeatmapConfig::DEFAULT.pass_max_zoom);
    let (z, x, y) = coord;
    // In world units, where the whole map is 0 to 1 each way, so tiles at any
    // zoom compare with the window drawn at the zoom shown.
    let shown = 2f64.powi(i32::from(zoom));
    let span = |centre: f64| {
        (
            (centre - PRIORITY_WINDOW_TILES) / shown,
            (centre + PRIORITY_WINDOW_TILES + 1.0) / shown,
        )
    };
    let (west, east) = span(crate::tiles::lon_to_tile_x(lon, zoom).floor());
    let (north, south) = span(crate::tiles::lat_to_tile_y(lat, zoom).floor());
    let tiles = 2f64.powi(i32::from(z));
    let (x, y) = (f64::from(x), f64::from(y));
    let covers = x / tiles < east
        && (x + 1.0) / tiles > west
        && y / tiles < south
        && (y + 1.0) / tiles > north;
    if !covers {
        return 2;
    }
    // One zoom either side: a double-tap lands on the next one, and drawing it
    // with the one on screen is what keeps the step sharp.
    if z.abs_diff(zoom) <= 1 { 0 } else { 1 }
}

/// The lowest zoom a missing tile is drawn at when the map asks for it: the
/// first zoom the pass leaves undrawn.
///
/// Deep tiles are most of the tree and each holds only the tracks that pass
/// through it, so one is drawn in the time the map waits for it. A shallower
/// tile holds more of the library the higher it goes, so a miss there stays a
/// hole the pass fills.
pub const ON_REQUEST_MIN_ZOOM: u8 = ON_REQUEST_ZOOMS.0;

/// The zooms drawn on request, read off the one heatmap configuration.
const ON_REQUEST_ZOOMS: (u8, u8) = {
    let config = tiles::HeatmapConfig::DEFAULT;
    (config.pass_max_zoom + 1, config.max_zoom)
};

/// One heatmap tile's PNG bytes, or `None` when the athlete has the heatmap
/// off, the tile holds no heat, or it is shallower than
/// [`ON_REQUEST_MIN_ZOOM`] and the pass has not drawn it yet.
///
/// A deep tile no pass has drawn is drawn here, from the stored tracks whose
/// bounds reach it, and written for the next read. A miss is not a failure:
/// heatmap tiles are generated from local GPS rather than fetched, so "not
/// drawn yet" is the ordinary answer and the caller turns it into a 404.
pub fn heatmap_tile_bytes(z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
    let wipes = TILE_WIPES.load(Ordering::Acquire);
    let source = heatmap_source()?;
    let base = Path::new(&source.dir);
    let deep = on_request_zooms().contains(&z);
    if let Some(drawn) = read_drawn_tile(base, z, x, y) {
        if deep {
            super::deep_tiles::tile_read(base, on_request_zooms(), (z, x, y));
        }
        return drawn;
    }
    if !deep {
        return None;
    }
    count_on_request(|c| c.misses += 1);
    // A second ask for a tile being drawn waits for that draw and reads what
    // it wrote, rather than drawing the same tile again beside it.
    let _flight = TileDraw::claim((z, x, y));
    if let Some(drawn) = read_drawn_tile(base, z, x, y) {
        super::deep_tiles::tile_read(base, on_request_zooms(), (z, x, y));
        return drawn;
    }
    let png = draw_tile_on_request(&source, z, x, y)?;
    match keep_tile_drawn_on_request(&source, wipes, (z, x, y), png.as_deref()) {
        Kept::Written | Kept::NotWritten => png,
        Kept::Withdrawn => None,
    }
}

fn on_request_zooms() -> std::ops::RangeInclusive<u8> {
    ON_REQUEST_ZOOMS.0..=ON_REQUEST_ZOOMS.1
}

/// What the set holds for a tile: `Some(Some(bytes))` drawn with heat,
/// `Some(None)` drawn and empty, `None` never drawn.
fn read_drawn_tile(base: &Path, z: u8, x: u32, y: u32) -> Option<Option<Vec<u8>>> {
    let path = base
        .join(z.to_string())
        .join(x.to_string())
        .join(format!("{}.png", y));
    if let Ok(bytes) = std::fs::read(path) {
        return Some((!bytes.is_empty()).then_some(bytes));
    }
    tiles::tile_exists(base, z, x, y).then_some(None)
}

/// Draw one tile from the tracks that reach it, as the pass draws it.
/// `Some(None)` when no heat falls in it, `None` when the tracks could not be
/// read.
fn draw_tile_on_request(source: &HeatmapSource, z: u8, x: u32, y: u32) -> Option<Option<Vec<u8>>> {
    let reaching = activities_reaching_tile(&source.bounds, z, x, y);
    count_on_request(|c| c.tracks_loaded += reaching.len());
    let tracks = if reaching.is_empty() {
        LoadedTracksById::new()
    } else {
        with_track_reader(&source.db_path, |conn| {
            bulk_load_tracks(conn, &reaching).tracks
        })?
    };
    // The pass gives a tile the tracks whose walk at its zoom holds it, and
    // the same set here keeps the two draws of one tile the same picture.
    let drawn: Vec<&tiles::ProjectedTrack> = tracks
        .values()
        .filter(|track| !track.is_empty() && track.tiles_along(z).contains(&(x, y)))
        .map(|track| track.as_ref())
        .collect();
    #[cfg(any(test, feature = "synthetic"))]
    {
        let held = TILE_DRAW_HOLD
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some((reached, release)) = held {
            let _ = reached.send(());
            let _ = release.recv();
        }
    }
    count_on_request(|c| c.draws += 1);
    Some(tiles::draw_heatmap_tile(z, x, y, &drawn))
}

/// The activities whose bounds can put ink in a tile: the tile is inside the
/// box's tile range with the one-tile halo a point's stroke can bleed into.
fn activities_reaching_tile(
    index: &rstar::RTree<super::ActivityBoundsEntry>,
    z: u8,
    x: u32,
    y: u32,
) -> Vec<(String, Bounds)> {
    // The tile and every neighbour, which is the widest a reach can be, read
    // off the index; the exact reach is tested on what that returns.
    let west = tiles::tile_x_to_lon(f64::from(x.saturating_sub(1)), z);
    let east = tiles::tile_x_to_lon(f64::from(x) + 2.0, z);
    let north = tiles::tile_y_to_lat(f64::from(y.saturating_sub(1)), z);
    let south = tiles::tile_y_to_lat(f64::from(y) + 2.0, z);
    let around = rstar::AABB::from_corners([west, south], [east, north]);
    index
        .locate_in_envelope_intersecting(&around)
        .filter(|entry| {
            let b = &entry.bounds;
            let reach =
                tiles::reach_range_for_bounds(b.min_lat, b.max_lat, b.min_lng, b.max_lng, z);
            x >= reach.x0 && x <= reach.x1 && y >= reach.y0 && y <= reach.y1
        })
        .map(|entry| (entry.activity_id.clone(), entry.bounds))
        .collect()
}

/// A read-only connection to `db_path`: the pool's when it is bound to that
/// database, else one of the draw's own.
fn with_track_reader<R>(db_path: &str, f: impl FnOnce(&Connection) -> R) -> Option<R> {
    if super::read_pool::binding().is_some_and(|(_, bound)| bound == db_path) {
        return super::read_pool::with_read_conn(f);
    }
    match super::read_pool::open_reader(db_path) {
        Ok(conn) => Some(f(&conn)),
        Err(e) => {
            log::warn!("[heatmap] Could not open the tracks to draw a tile: {e}");
            None
        }
    }
}

/// What became of a tile drawn on request.
enum Kept {
    Written,
    /// The catalogue moved while it was drawn, so it may be short a track or
    /// hold a removed one. It is shown, and drawn again on the next ask.
    NotWritten,
    /// The heatmap was turned off, moved or wiped while it was drawn.
    Withdrawn,
}

/// Write a tile drawn on request, unless what it was drawn from is gone.
///
/// Under the wipe gate, so a wipe cannot start between the check and the
/// write, and against the wipe count, so one that ran during the draw is seen
/// though it has ended. A sweep runs after the catalogue it changes is
/// published, so a write made before that publish is swept with the rest.
fn keep_tile_drawn_on_request(
    drawn_from: &Arc<HeatmapSource>,
    wipes: u64,
    (z, x, y): TileKey,
    png: Option<&[u8]>,
) -> Kept {
    let _gate = match TILE_WIPE_GATE.try_read() {
        Ok(gate) => gate,
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        Err(TryLockError::WouldBlock) => return Kept::Withdrawn,
    };
    if TILE_WIPES.load(Ordering::Acquire) != wipes {
        return Kept::Withdrawn;
    }
    let Some(now) = heatmap_source() else {
        return Kept::Withdrawn;
    };
    if now.dir != drawn_from.dir {
        return Kept::Withdrawn;
    }
    if !Arc::ptr_eq(&now, drawn_from) {
        return Kept::NotWritten;
    }
    let base = Path::new(&drawn_from.dir);
    let written = match png {
        Some(png) => tiles::save_tile(base, z, x, y, png),
        None => tiles::mark_tile_empty(base, z, x, y),
    };
    match written {
        Ok(()) => {
            // Under the wipe gate, so an eviction never runs beside a clear.
            super::deep_tiles::tile_drawn(base, on_request_zooms(), (z, x, y), deep_tile_budget());
            Kept::Written
        }
        Err(e) => {
            log::warn!("[heatmap] Could not keep the tile drawn on request: {e}");
            Kept::NotWritten
        }
    }
}

/// The deep tiles being drawn on request, one draw each.
static TILE_DRAWS: Mutex<BTreeSet<TileKey>> = Mutex::new(BTreeSet::new());

/// Signalled when a draw in [`TILE_DRAWS`] ends.
static TILE_DRAW_ENDED: Condvar = Condvar::new();

/// The one draw of a tile under way, held until it is written or given up.
struct TileDraw(TileKey);

impl TileDraw {
    /// Wait out a draw of `key` already under way, then take it.
    fn claim(key: TileKey) -> Self {
        let held = TILE_DRAWS.lock().unwrap_or_else(|e| e.into_inner());
        let mut held = TILE_DRAW_ENDED
            .wait_while(held, |drawing| drawing.contains(&key))
            .unwrap_or_else(|e| e.into_inner());
        held.insert(key);
        TileDraw(key)
    }
}

impl Drop for TileDraw {
    fn drop(&mut self) {
        TILE_DRAWS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
        TILE_DRAW_ENDED.notify_all();
    }
}

/// What the on-request draw did, so a test can count it rather than time it.
/// Counted only in the test lanes.
#[doc(hidden)]
#[derive(Debug, Default, Clone, Copy)]
pub struct OnRequestCounts {
    /// Asks for a deep tile the set did not hold.
    pub misses: usize,
    /// Tiles drawn.
    pub draws: usize,
    /// Tracks read from the database to draw them.
    pub tracks_loaded: usize,
}

#[cfg(any(test, feature = "synthetic"))]
static ON_REQUEST_COUNTS: Mutex<OnRequestCounts> = Mutex::new(OnRequestCounts {
    misses: 0,
    draws: 0,
    tracks_loaded: 0,
});

/// The on-request work since the last call.
#[cfg(any(test, feature = "synthetic"))]
#[doc(hidden)]
pub fn take_on_request_counts() -> OnRequestCounts {
    std::mem::take(&mut *ON_REQUEST_COUNTS.lock().unwrap_or_else(|e| e.into_inner()))
}

#[cfg(any(test, feature = "synthetic"))]
fn count_on_request(add: impl FnOnce(&mut OnRequestCounts)) {
    add(&mut ON_REQUEST_COUNTS.lock().unwrap_or_else(|e| e.into_inner()));
}

#[cfg(not(any(test, feature = "synthetic")))]
fn count_on_request(_: impl FnOnce(&mut OnRequestCounts)) {}

/// A hold the next on-request draw waits on, its tracks read and nothing
/// drawn, so a test can put a second ask beside it.
#[cfg(any(test, feature = "synthetic"))]
static TILE_DRAW_HOLD: Mutex<Option<Hold>> = Mutex::new(None);

/// Hold the next tile drawn on request before it draws.
#[cfg(any(test, feature = "synthetic"))]
#[doc(hidden)]
pub fn hold_next_tile_draw() -> TilePassHold {
    let (reached_tx, reached_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    *TILE_DRAW_HOLD.lock().unwrap_or_else(|e| e.into_inner()) = Some((reached_tx, release_rx));
    TilePassHold {
        reached: reached_rx,
        release: release_tx,
    }
}

impl PersistentEngine {
    /// Check whether heatmap tiles need (re)generation.
    /// Returns true if the dirty marker exists or no version file is present (first time / cache cleared).
    pub fn is_heatmap_dirty(&self) -> bool {
        let Some(ref path) = self.heatmap_tiles_path else {
            return false;
        };
        let base = Path::new(path);
        // No version file → first time or OS cleared cache → needs generation
        if !base.join("version.txt").exists() {
            return true;
        }
        // Dirty marker present → new data arrived since last generation
        base.join(DIRTY_MARKER).exists()
    }

    /// Mark heatmap tiles as needing regeneration.
    /// Writes a `.dirty` marker file in the tiles directory.
    pub fn mark_heatmap_dirty(&self) {
        let Some(ref path) = self.heatmap_tiles_path else {
            return;
        };
        write_dirty_marker(Path::new(path));
    }

    /// Set the filesystem path where heatmap tiles are stored.
    /// Called once from JS at engine init time.
    /// If the engine already has activities and tiles are stale, spawns background generation.
    pub fn set_heatmap_tiles_path(&mut self, path: String) {
        info!("[heatmap] Tiles path set to: {}", path);
        self.heatmap_tiles_path = Some(path.clone());
        self.publish_heatmap_source();

        // Check tile format version - clear stale tiles on upgrade
        let version_file = Path::new(&path).join("version.txt");
        let current_version = std::fs::read_to_string(&version_file).unwrap_or_default();
        if current_version.trim() != TILE_FORMAT_VERSION {
            info!(
                "[heatmap] Tile format changed ({:?} → {}), clearing stale tiles",
                current_version.trim(),
                TILE_FORMAT_VERSION
            );
            let cleared = match tiles::clear_all_tiles(Path::new(&path)) {
                Ok(_) => true,
                Err(e) => {
                    log::warn!("[heatmap] {}", e);
                    false
                }
            };
            if let Err(e) = std::fs::create_dir_all(&path) {
                log::warn!(
                    "[heatmap] Failed to create tiles directory {:?}: {}",
                    path,
                    e
                );
            }
            // Stamp the version only once the old set is gone, so a clear that
            // failed is retried on the next launch rather than read as current.
            if cleared && let Err(e) = std::fs::write(&version_file, TILE_FORMAT_VERSION) {
                log::warn!(
                    "[heatmap] Failed to write version file {:?}: {}",
                    version_file,
                    e
                );
            }
            // Format changed - mark dirty so generation runs
            self.mark_heatmap_dirty();
        }

        // The deep tiles held are counted afresh from the tree, off the
        // caller, which is the JS thread at launch.
        super::deep_tiles::forget();
        let seeded = PathBuf::from(&path);
        crate::threads::spawn_background("veloq-deeptiles", move || {
            if heatmap_source().is_some_and(|source| Path::new(&source.dir) == seeded) {
                super::deep_tiles::seed(&seeded, on_request_zooms());
            }
        });

        // Only generate if tiles are stale (new data, format change, first time, or cache cleared).
        // Skips the expensive tile enumeration + file-existence checks on normal app restart.
        if !self.activity_metadata.is_empty() && self.is_heatmap_dirty() {
            info!("[heatmap] Tiles are stale - spawning background generation");
            self.start_tile_pass();
        } else if !self.activity_metadata.is_empty() {
            info!("[heatmap] Tiles are up to date - skipping generation");
        }
    }

    /// Every activity's bounding box, for a pass that works off where the
    /// athlete rides rather than off their tracks.
    ///
    /// Cloned under the lock in microseconds, the way the heatmap pass takes
    /// its own snapshot: neither pass holds the engine while it works.
    pub fn activity_bounds(&self) -> Vec<Bounds> {
        self.activity_metadata.values().map(|m| m.bounds).collect()
    }

    /// Start a pass over the catalogue as it stands and park its handle where
    /// the poll and the progress read it. Every pass the engine starts comes
    /// through here, and a thread that holds no engine asks through
    /// [`request_tile_pass`].
    ///
    /// Answers whether one started. A refusal while a pass runs costs nothing:
    /// whatever asked marked the set first, and the running pass sees the mark
    /// move and runs again when it ends.
    pub fn start_tile_pass(&self) -> bool {
        let Some(handle) = self.generate_tiles_background() else {
            return false;
        };
        *super::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        true
    }

    /// Spawn background tile generation. Extracts metadata while holding &self
    /// (microseconds), then releases. The heavy work runs on a separate thread
    /// with its own SQLite connection.
    ///
    /// Returns None if no tiles path is configured, no activities exist, or a
    /// pass is already running. The engine spawns one at load when the set is
    /// stale, the sync when it stores tracks and each sweep when it ends, so
    /// they overlap on the ordinary shape of a cold launch that then syncs.
    /// Callers go through [`Self::start_tile_pass`] or [`request_tile_pass`],
    /// which park the handle.
    pub fn generate_tiles_background(&self) -> Option<TileGenerationHandle> {
        let requested = Instant::now();
        let tiles_path = self.heatmap_tiles_path.clone()?;
        let db_path = self.db_path.clone();

        if self.activity_metadata.is_empty() {
            return None;
        }

        let cancel = super::CancelToken::new();
        let Some(pass) = TilePassGuard::claim(self, &cancel) else {
            info!("[heatmap] A tile pass is already running - not starting another");
            return None;
        };

        // Extract all activity (id, bounds) pairs from in-memory metadata.
        // The background thread uses IDs to bulk-load GPS tracks and bounds
        // for an early tile/bounds intersection filter.
        let activities: Vec<(String, Bounds)> = self
            .activity_metadata
            .iter()
            .map(|(id, m)| (id.clone(), m.bounds))
            .collect();

        let (tx, rx) = mpsc::channel();
        let generated_counter = Arc::new(AtomicU32::new(0));
        let total_counter = Arc::new(AtomicU32::new(0));
        let gen_clone = generated_counter.clone();
        let total_clone = total_counter.clone();
        let worker_cancel = cancel.clone();
        let elapsed_nanos = Arc::new(AtomicU64::new(0));
        let worker_elapsed = elapsed_nanos.clone();

        // Captured before the pass so a sweep that marks the set dirty while
        // it runs is not cleared by it.
        let (started_on, swept) = read_dirty_state(Path::new(&tiles_path));
        // The engine this pass drew for, so the pass that follows it is asked
        // of the same one and not of a library signed in since.
        let install = super::engine_install();

        crate::threads::spawn_background("veloq-tiles", move || {
            let mut remarked = false;
            let generated = {
                // The slot is held for the generation itself, and released
                // structurally, so a panic anywhere in the pass still frees it.
                let _pass = pass;
                let run = background_generate_tiles(
                    &db_path,
                    &tiles_path,
                    &activities,
                    &gen_clone,
                    &total_clone,
                    &worker_cancel,
                    swept.as_ref(),
                );
                // The pass ran, so the marker clears. Holding it for an
                // unreadable activity would re-run the whole pass at every
                // launch for as long as the row stays bad. The redraw the
                // incomplete tiles need is carried by the corrupt record
                // instead, which is scoped to the tiles those activities reach.
                //
                // A cancelled pass is the exception, and it must be: it left
                // ground undrawn on purpose, so clearing the marker would make
                // the heatmap permanently half-drawn.
                if run.cancelled {
                    info!(
                        "[heatmap] Pass cancelled after {} tiles, the set stays dirty",
                        run.generated
                    );
                } else {
                    remarked = clear_dirty_marker(&tiles_path, started_on);
                }
                if run.corrupt > 0 {
                    log::error!(
                        "[heatmap] Tile set is incomplete: {} activities were unreadable. The tiles they reach are redrawn on the next run.",
                        run.corrupt
                    );
                }
                run.generated
            };
            // Stored before the follow-up request and the count, so whoever
            // reads the count finds it, and before any wait on the receiver.
            worker_elapsed.store(
                u64::try_from(requested.elapsed().as_nanos()).unwrap_or(u64::MAX),
                Ordering::SeqCst,
            );
            // Something was stored, swept or removed while this pass worked,
            // and it planned from the library before that. The pass asked for
            // then was refused, so this is the one that asks again, from the
            // catalogue as it is now. Asked before the count is sent, so a
            // caller that waits out this pass finds the next one already in
            // the handle slot rather than an idle engine.
            if remarked {
                info!("[heatmap] The set changed during the pass, drawing it again");
                request_tile_pass(&tiles_path, install);
            }
            // The slot is free before the count is sent, so a caller that
            // blocks on the receiver and then asks for another pass is not
            // refused by the one it just waited out.
            tx.send(generated).ok();
            // The worker owns no engine lock, so the announcement is safe to
            // make from here. A screen waiting on the pass hears it instead of
            // draining this receiver on a timer.
            crate::objects::observer::notify(Announcement::TilesGenerated);
        });

        Some(TileGenerationHandle {
            receiver: rx,
            generated: generated_counter,
            total: total_counter,
            elapsed_nanos,
            cancel,
        })
    }

    /// Disable heatmap tile generation by clearing the tiles path.
    /// Prevents regeneration on next sync.
    pub fn clear_heatmap_tiles_path(&mut self) {
        info!("[heatmap] Tiles path cleared - generation disabled");
        self.heatmap_tiles_path = None;
        publish_heatmap_source(None);
        super::deep_tiles::forget();
    }

    /// Hand the map's tile reader the tiles path, the database and the
    /// catalogue's bounds as they stand. An engine with the heatmap off
    /// publishes nothing, so a second engine opened on a copy of the library
    /// cannot point the reader at the copy.
    pub(super) fn publish_heatmap_source(&self) {
        let Some(dir) = self.heatmap_tiles_path.clone() else {
            return;
        };
        publish_heatmap_source(Some(HeatmapSource {
            dir,
            db_path: self.db_path.clone(),
            bounds: Arc::clone(&self.spatial_index),
        }));
    }

    /// The tiles path in force, or `None` when the athlete has the heatmap off.
    pub fn heatmap_tiles_path(&self) -> Option<&str> {
        self.heatmap_tiles_path.as_deref()
    }
}

/// Ids whose track did not decode on the last run. An absent or unreadable
/// record reads as none, which costs one redraw of nothing.
fn read_corrupt_record(base: &Path) -> Vec<String> {
    std::fs::read_to_string(base.join(CORRUPT_RECORD))
        .ok()
        .and_then(|body| serde_json::from_str::<Vec<String>>(&body).ok())
        .unwrap_or_default()
}

/// Store the ids whose track did not decode on this run. A run with nothing
/// unreadable removes the record, so a repaired library stops paying for it.
fn write_corrupt_record(base: &Path, ids: &[String]) {
    let path = base.join(CORRUPT_RECORD);
    if ids.is_empty() {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::warn!("[heatmap] Failed to clear the corrupt record: {}", e),
        }
        return;
    }
    let mut sorted: Vec<&str> = ids.iter().map(|id| id.as_str()).collect();
    sorted.sort_unstable();
    match serde_json::to_string(&sorted) {
        Ok(body) => {
            if let Err(e) = std::fs::write(&path, body) {
                log::warn!("[heatmap] Failed to write the corrupt record: {}", e);
            }
        }
        Err(e) => log::warn!("[heatmap] Failed to encode the corrupt record: {}", e),
    }
}

/// Whether an activity's bounding box reaches a tile. Bounds are all an
/// unreadable activity leaves behind, so the swept track coverage is not
/// available and the box is the widest the redraw can be.
fn bounds_reach_tile(bounds: &Bounds, z: u8, x: u32, y: u32) -> bool {
    let x0 = tiles::lon_to_tile_x(bounds.min_lng, z).floor();
    let x1 = tiles::lon_to_tile_x(bounds.max_lng, z).floor();
    // Tile y grows southwards, so the northern edge gives the lower index.
    let y0 = tiles::lat_to_tile_y(bounds.max_lat, z).floor();
    let y1 = tiles::lat_to_tile_y(bounds.min_lat, z).floor();
    let (x, y) = (x as f64, y as f64);
    x >= x0 && x <= x1 && y >= y0 && y <= y1
}

/// Stop any tile pass, then remove every tile in each of `dirs` and mark the
/// emptied sets owed a draw.
///
/// For a wipe, and through [`clear_tile_set`] for Clear cache and turning the
/// heatmap off. The tiles draw a library that no longer exists, and a dirty
/// pass only fills tiles that are missing, so a mark alone leaves every tile
/// outside the next library's ground on disk for the map to serve. The
/// corrupt record goes too: it names the wiped library's activities, and a
/// pass over an empty set draws every activity again. A pass still drawing
/// would write into the emptied set, so it is stopped and waited out first.
///
/// An error when a pass would not stop, a set could not be inspected or
/// emptied, or its dirty mark could not be written. Every set is attempted.
///
/// It walks the whole set, so the caller runs it with the engine lock
/// released.
pub(crate) fn wipe_tile_sets(dirs: &[PathBuf]) -> Result<(), String> {
    wipe_tile_sets_within(dirs, TILE_PASS_STOP_WAIT)
}

fn wipe_tile_sets_within(dirs: &[PathBuf], wait: Duration) -> Result<(), String> {
    wipe_tile_sets_within_after_stop(dirs, wait, || {})
}

fn wipe_tile_sets_within_after_stop(
    dirs: &[PathBuf],
    wait: Duration,
    after_stop: impl FnOnce(),
) -> Result<(), String> {
    let _gate = TILE_WIPE_GATE.write().unwrap_or_else(|e| e.into_inner());
    TILE_WIPES.fetch_add(1, Ordering::AcqRel);
    // A wipe drew a library that is gone and a clear was asked for, so the
    // set is owed a draw either way.
    let mut failed = Vec::new();
    let stopped = match stop_tile_pass(wait) {
        Ok(()) => true,
        Err(e) => {
            failed.push(e);
            false
        }
    };
    if stopped {
        after_stop();
    }
    for dir in dirs {
        match std::fs::metadata(dir) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => failed.push(format!(
                "Could not inspect the heatmap tiles at {}: {}",
                dir.display(),
                e
            )),
        }
        if stopped {
            match tiles::clear_all_tiles(dir) {
                Ok(removed) => info!("[heatmap] Wipe removed {} zoom levels of tiles", removed),
                Err(e) => failed.push(e),
            }
            write_corrupt_record(dir, &[]);
        }
        super::deep_tiles::forget();
        if let Err(e) = try_write_dirty_marker(dir) {
            failed.push(e);
        }
    }
    if failed.is_empty() {
        Ok(())
    } else {
        Err(failed.join("; "))
    }
}

/// Clear cache and turning the heatmap off: the wipe's stop-then-delete for
/// the one set at `base_path`.
///
/// A pass still drawing would put back the tiles it had in flight, and the
/// dirty pass after skips a tile that exists, so that heat would stay however
/// the library changed. An error when a tile could not be removed or its set
/// could not be marked, so the settings screen does not report an incomplete clear.
///
/// It waits out a pass and walks the whole set, so it runs off the JS thread
/// and with the engine lock released.
pub fn clear_tile_set(base_path: &Path) -> Result<(), String> {
    wipe_tile_sets(&[base_path.to_path_buf()])
}

/// Start a pass from a thread that holds no engine: a sweep that has just
/// deleted tiles, or a pass that ended on a set changed under it.
///
/// Asked of the engine of `install` and only while `tiles_path` is still its
/// set: an athlete who turned the heatmap off, or a library signed in since,
/// is owed nothing. Takes the engine lock for the microseconds the pass needs
/// to snapshot the catalogue.
pub(crate) fn request_tile_pass(tiles_path: &str, install: u64) {
    request_pass(Some(tiles_path), install);
}

/// Start a pass after a partial clear's wipe has ended, when the engine has a
/// tiles path and its set is dirty. The wipe cancelled any running pass and
/// can have removed activities, so nothing else would redraw the heatmap until
/// the next launch. A clean set, or a heatmap that is off, starts nothing.
pub(crate) fn request_tile_pass_if_dirty(install: u64) {
    request_pass(None, install);
}

fn request_pass(tiles_path: Option<&str>, install: u64) -> bool {
    if let Some(tiles_path) = tiles_path {
        let mut held = deferred_passes();
        if held.depth > 0 {
            held.owed = Some((tiles_path.to_string(), install));
            return true;
        }
    }
    super::with_persistent_engine_for(install, |engine| {
        let wanted = match tiles_path {
            Some(path) => engine.heatmap_tiles_path() == Some(path) && engine.is_heatmap_dirty(),
            None => engine.is_heatmap_dirty(),
        };
        if wanted {
            engine.start_tile_pass()
        } else {
            true
        }
    })
    .unwrap_or(true)
}

/// Pass requests held back while a sync stores, and the last one owed.
struct DeferredPasses {
    depth: u32,
    owed: Option<(String, u64)>,
}

static DEFERRED_PASSES: Mutex<DeferredPasses> = Mutex::new(DeferredPasses {
    depth: 0,
    owed: None,
});

fn deferred_passes() -> MutexGuard<'static, DeferredPasses> {
    DEFERRED_PASSES.lock().unwrap_or_else(|e| e.into_inner())
}

/// Holds back the passes sweeps and finished passes ask for, until dropped.
///
/// A sync stores one activity at a time and each store sweeps, so every
/// sweep's end asking for a pass would chain passes through the whole
/// download, each reloading every track and redrawing the home tiles the next
/// store deletes again. The sync starts one pass at its end instead. Dropping
/// this asks for the last pass that was held back, which a pass the sync
/// already started refuses and covers. Drop it with no engine lock held.
pub(crate) struct TilePassDeferral(());

impl Drop for TilePassDeferral {
    fn drop(&mut self) {
        let owed = {
            let mut held = deferred_passes();
            held.depth = held.depth.saturating_sub(1);
            if held.depth > 0 {
                return;
            }
            held.owed.take()
        };
        if let Some((tiles_path, install)) = owed {
            request_tile_pass(&tiles_path, install);
        }
    }
}

/// Hold back every requested pass until the returned value drops.
pub(crate) fn defer_tile_passes() -> TilePassDeferral {
    deferred_passes().depth += 1;
    TilePassDeferral(())
}

/// Mark the tile set as needing regeneration. Each mark carries its own token
/// so a run can tell the mark it started on from one that arrived while it was
/// working.
fn write_dirty_marker(base: &Path) {
    if let Err(e) = try_write_dirty_marker(base) {
        log::warn!("[heatmap] {}", e);
    }
}

fn try_write_dirty_marker(base: &Path) -> Result<(), String> {
    let _gate = mark_gate();
    // A mark that is not a sweep may stand for ground no sweep named, so the
    // record of swept ground no longer says what is owed.
    remove_swept_record(base);
    write_marker_unlocked(base)
}

fn remove_swept_record(base: &Path) {
    if let Err(e) = std::fs::remove_file(base.join(SWEPT_RECORD))
        && e.kind() != std::io::ErrorKind::NotFound
    {
        log::warn!("[heatmap] Failed to clear the swept record: {}", e);
    }
}

fn write_marker_unlocked(base: &Path) -> Result<(), String> {
    std::fs::create_dir_all(base).map_err(|e| {
        format!(
            "Could not create heatmap tiles directory at {} for dirty marker: {}",
            base.display(),
            e
        )
    })?;
    let token = DIRTY_TOKEN.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::fs::write(base.join(DIRTY_MARKER), format!("{}-{}", nanos, token)).map_err(|e| {
        format!(
            "Could not mark heatmap tiles at {} dirty: {}",
            base.display(),
            e
        )
    })
}

/// Mark the set dirty for ground a sweep deleted, and record that ground so the
/// pass that follows plans only it.
///
/// The record exists only while every mark since the last complete pass was a
/// sweep. A set already dirty with no record was marked for some other reason
/// (a cold start, a wipe, a format change), and stays owed in full.
pub(crate) fn mark_tiles_swept(tiles_path: &str, spans: &[tiles::TileSpan]) {
    let base = Path::new(tiles_path);
    let _gate = mark_gate();
    let record = base.join(SWEPT_RECORD);
    let owed_in_full = base.join(DIRTY_MARKER).exists() && !record.exists();
    if !owed_in_full && !spans.is_empty() {
        use std::io::Write;
        let mut lines = String::new();
        for s in spans {
            lines.push_str(&format!("{} {} {} {} {}\n", s.z, s.x0, s.x1, s.y0, s.y1));
        }
        let written = std::fs::create_dir_all(base)
            .and_then(|()| {
                std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&record)
            })
            .and_then(|mut f| f.write_all(lines.as_bytes()));
        if let Err(e) = written {
            // Without the record the pass plans in full, which is slower and
            // never wrong.
            log::warn!("[heatmap] Failed to record the swept ground: {}", e);
            remove_swept_record(base);
        }
    }
    if let Err(e) = write_marker_unlocked(base) {
        log::warn!("[heatmap] {}", e);
    }
}

/// The ground sweeps changed since the last complete pass.
#[derive(Debug, Default)]
struct SweptGround {
    tiles: BTreeMap<u8, BTreeSet<(u32, u32)>>,
    boxes: Vec<tiles::TileSpan>,
}

impl SweptGround {
    fn read(base: &Path) -> Option<Self> {
        let body = std::fs::read_to_string(base.join(SWEPT_RECORD)).ok()?;
        let mut ground = Self::default();
        for line in body.lines() {
            let n: Vec<u32> = line.split(' ').filter_map(|v| v.parse().ok()).collect();
            let [z, x0, x1, y0, y1] = n[..] else {
                // A torn line means the record cannot be trusted.
                return None;
            };
            let span = tiles::TileSpan {
                z: z as u8,
                x0,
                x1,
                y0,
                y1,
            };
            if x0 == x1 && y0 == y1 {
                ground.tiles.entry(span.z).or_default().insert((x0, y0));
            } else {
                ground.boxes.push(span);
            }
        }
        Some(ground)
    }

    fn holds(&self, z: u8, x: u32, y: u32) -> bool {
        self.tiles.get(&z).is_some_and(|t| t.contains(&(x, y)))
            || self
                .boxes
                .iter()
                .any(|b| b.z == z && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)
    }

    /// Whether any swept tile at `range.z` lies inside the range.
    fn reaches(&self, range: &tiles::TileSpan) -> bool {
        let in_tiles = self.tiles.get(&range.z).is_some_and(|t| {
            t.range((range.x0, 0)..=(range.x1, u32::MAX))
                .any(|&(_, y)| y >= range.y0 && y <= range.y1)
        });
        in_tiles
            || self.boxes.iter().any(|b| {
                b.z == range.z
                    && b.x0 <= range.x1
                    && b.x1 >= range.x0
                    && b.y0 <= range.y1
                    && b.y1 >= range.y0
            })
    }
}

/// The standing mark and the swept record, read together so a sweep cannot land
/// between them.
fn read_dirty_state(base: &Path) -> (Option<String>, Option<SweptGround>) {
    let _gate = mark_gate();
    let token = read_dirty_token(base);
    let swept = token.as_ref().and_then(|_| SweptGround::read(base));
    (token, swept)
}

/// The token of the mark currently standing, or None when the set is clean.
fn read_dirty_token(base: &Path) -> Option<String> {
    std::fs::read_to_string(base.join(DIRTY_MARKER)).ok()
}

/// Remove the dirty marker after a successful generation run, but only the
/// mark that run started on. A sweep that deletes tiles marks the set dirty,
/// and clearing that mark would strand the ground it deleted, and at low zoom
/// one activity's bounds cover the whole library, which is how the pyramid
/// emptied below z12.
///
/// Answers whether a mark arrived during the run, which is the set changing
/// under a pass that planned before it: that ground is owed another pass.
fn clear_dirty_marker(tiles_path: &str, started_on: Option<String>) -> bool {
    let base = Path::new(tiles_path);
    let _gate = mark_gate();
    let standing = read_dirty_token(base);
    if standing.is_none() {
        return false;
    }
    if standing != started_on {
        info!("[heatmap] Set was re-marked during the run, leaving it dirty");
        return true;
    }
    if let Err(e) = std::fs::remove_file(base.join(DIRTY_MARKER))
        && e.kind() != std::io::ErrorKind::NotFound
    {
        log::warn!("[heatmap] Failed to clear dirty marker: {}", e);
    }
    remove_swept_record(base);
    false
}

type LoadedTracksById = HashMap<String, Arc<tiles::ProjectedTrack>>;
type TileKey = (u8, u32, u32);
type Tracks = Vec<Arc<tiles::ProjectedTrack>>;

/// Which tracks reach which tiles, and how many tracks were swept to find out,
/// counted once per track and zoom.
///
/// With `swept` it plans only the ground sweeps changed: a track is swept at a
/// zoom only when its reach holds a swept tile, and only swept tiles are kept,
/// each with every track that reaches it, since all of those are swept too.
fn plan_tiles(
    activities: &[(String, Bounds)],
    tracks_by_id: &LoadedTracksById,
    config: &tiles::HeatmapConfig,
    swept: Option<&SweptGround>,
) -> (HashMap<TileKey, Tracks>, usize) {
    let mut tile_tracks: HashMap<TileKey, Tracks> = HashMap::new();
    let mut sweeps = 0usize;
    for (id, bounds) in activities {
        let Some(track) = tracks_by_id.get(id) else {
            continue;
        };
        if track.is_empty() {
            continue;
        }
        for z in config.min_zoom..=config.pass_max_zoom {
            if let Some(ground) = swept {
                let reach = tiles::reach_range_for_bounds(
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    z,
                );
                if !ground.reaches(&reach) {
                    continue;
                }
            }
            sweeps += 1;
            for coord in track.tiles_along(z) {
                if swept.is_some_and(|ground| !ground.holds(z, coord.0, coord.1)) {
                    continue;
                }
                tile_tracks
                    .entry((z, coord.0, coord.1))
                    .or_default()
                    .push(Arc::clone(track));
            }
        }
    }
    (tile_tracks, sweeps)
}

/// Generate heatmap tiles on a background thread.
/// Opens its own SQLite connection - does NOT touch PERSISTENT_ENGINE.
///
/// Pipeline (rewritten for Tier 1.1/1.3):
/// 1. Bulk-load every activity's GPS track and place it on the map once.
/// 2. Iterate activities × zooms, using polyline-swept tile enumeration to
///    build a `(z,x,y) → [Arc<track>]` map.
/// 3. Filter out tiles that already exist on disk (incremental safeguard).
/// 4. Parallel-generate each tile (rayon) + write PNG.
///
/// Strictly better than the old per-tile loop: GPS tracks are deserialized
/// once instead of once-per-tile, empty bbox tiles are never enumerated, and
/// the slow rasterisation+PNG encode parallelises across cores.
fn background_generate_tiles(
    db_path: &str,
    tiles_path: &str,
    activities: &[(String, Bounds)],
    generated_counter: &AtomicU32,
    total_counter: &AtomicU32,
    cancel: &super::CancelToken,
    swept: Option<&SweptGround>,
) -> TileGeneration {
    let start = std::time::Instant::now();
    let base = Path::new(tiles_path);
    let config = tiles::HeatmapConfig::default();
    // Taken at the start, so a pass that returns before drawing drops it and
    // the waiting test hears that rather than hanging.
    #[cfg(any(test, feature = "synthetic"))]
    let (hold, hold_in_tile) = match TILE_PASS_HOLD
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        Some((hold, HoldPoint::BeforeDrawing)) => (Some(hold), Mutex::new(None)),
        Some((hold, HoldPoint::InTile)) => (None, Mutex::new(Some(hold))),
        None => (None, Mutex::new(None)),
    };

    if activities.is_empty() {
        return TileGeneration::default();
    }

    // Open own SQLite connection (same pattern as section detection).
    let conn = match Connection::open(db_path) {
        Ok(c) => {
            let _ = crate::persistence::apply_write_pragmas(&c);
            c
        }
        Err(e) => {
            log::error!("[heatmap] Failed to open database: {}", e);
            return TileGeneration::default();
        }
    };

    // --- Phase 1: bulk-load all GPS tracks into an Arc cache ----------------
    let previously_corrupt = read_corrupt_record(base);
    let load_started = std::time::Instant::now();
    let LoadedTracks {
        tracks: tracks_by_id,
        corrupt,
    } = bulk_load_tracks(&conn, activities);
    let load_ms = load_started.elapsed().as_millis();

    // Only a repaired track needs its ground redrawn. A track still unreadable
    // contributed nothing to the tiles that exist, which therefore still hold
    // the heat it laid down while it was readable, and redrawing without it
    // would drop that heat rather than restore it.
    let unreadable_now: HashSet<&str> = corrupt.iter().map(|(id, _)| id.as_str()).collect();
    let stale_ids: HashSet<&str> = previously_corrupt
        .iter()
        .map(|id| id.as_str())
        .filter(|id| !unreadable_now.contains(id))
        .collect();
    let stale_bounds: Vec<&Bounds> = activities
        .iter()
        .filter(|(id, _)| stale_ids.contains(id.as_str()))
        .map(|(_, bounds)| bounds)
        .collect();

    for (id, reason) in corrupt.iter().take(CORRUPT_ID_LOG_CAP) {
        log::error!(
            "[heatmap] activity {} omitted from the tile set, track unreadable: {}",
            id,
            reason
        );
    }
    if corrupt.len() > CORRUPT_ID_LOG_CAP {
        log::error!(
            "[heatmap] {} further activities omitted, tracks unreadable",
            corrupt.len() - CORRUPT_ID_LOG_CAP
        );
    }
    if !corrupt.is_empty() {
        log::error!(
            "[heatmap] {} of {} activities missing from the tile set: the heatmap is incomplete",
            corrupt.len(),
            activities.len()
        );
    }

    // The first safe point: the load is the longest stretch that cannot be
    // interrupted, and nothing has been written yet, so stopping here leaves
    // the tile set exactly as the pass found it.
    if cancel.is_cancelled() {
        return TileGeneration {
            cancelled: true,
            ..TileGeneration::default()
        };
    }

    // --- Phase 2: build (z,x,y) → [Arc<track>] via polyline sweep ------------
    let plan_started = std::time::Instant::now();
    // Unreadable tracks owe a redraw of ground no sweep recorded.
    let swept = swept.filter(|_| previously_corrupt.is_empty());
    let (tile_tracks, _) = plan_tiles(activities, &tracks_by_id, &config, swept);
    let plan_ms = plan_started.elapsed().as_millis();

    // --- Phase 3: filter existing, sort for deterministic progress ----------
    // A tile an unreadable activity reaches is redrawn even when it exists,
    // because what is on disk was drawn while that activity was missing.
    let mut redrawn = 0u32;
    let mut pending: Vec<(TileKey, Tracks)> = tile_tracks
        .into_iter()
        .filter(|(coord, _)| {
            if !tiles::tile_exists(base, coord.0, coord.1, coord.2) {
                return true;
            }
            let stale = stale_bounds
                .iter()
                .any(|bounds| bounds_reach_tile(bounds, coord.0, coord.1, coord.2));
            if stale {
                redrawn += 1;
            }
            stale
        })
        .collect();
    if redrawn > 0 {
        info!(
            "[heatmap] Redrawing {} existing tiles reached by {} repaired activities",
            redrawn,
            stale_bounds.len()
        );
    }
    // The viewport first, then the rest by zoom. Deterministic either way,
    // which keeps progress reporting stable across runs: otherwise HashMap
    // iteration order shuffles `processed_counter` deltas.
    let priority = tile_priority();
    pending.sort_unstable_by_key(|(coord, _)| {
        (priority_rank(*coord, priority), coord.0, coord.1, coord.2)
    });

    let total = pending.len() as u32;
    total_counter.store(total, Ordering::SeqCst);
    // The screen's tiles sort first, so they are the leading run of rank 0.
    // Without a camera every tile is rank 0 and there is no band to speak of.
    let first_band = if priority.is_some() {
        pending.partition_point(|(coord, _)| priority_rank(*coord, priority) == 0)
    } else {
        0
    };
    let first_band_drawn = FirstBandDrawn::new(first_band, pending.len());

    if total == 0 {
        write_corrupt_record(
            base,
            &corrupt.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(),
        );
        info!(
            "[heatmap] Background: nothing to generate (load={}ms plan={}ms)",
            load_ms, plan_ms
        );
        return TileGeneration {
            generated: 0,
            corrupt: corrupt.len(),
            cancelled: false,
        };
    }

    info!(
        "[heatmap] Background: generating {} tiles for {} activities z{}-{} (load={}ms plan={}ms)",
        total,
        activities.len(),
        config.min_zoom,
        config.pass_max_zoom,
        load_ms,
        plan_ms,
    );

    #[cfg(any(test, feature = "synthetic"))]
    if let Some((reached, release)) = hold {
        let _ = reached.send(());
        let _ = release.recv();
    }

    // --- Phase 4: parallel rasterise + save ---------------------------------
    // Each worker owns its own refs; the placed tracks are shared through their
    // Arc rather than cloned across threads. No SQLite connection inside workers.
    // Each run of tiles a worker takes is drawn in one canvas, so its buffers are
    // made per run rather than per tile, and freed when the pass ends.
    let generated = AtomicU32::new(0);
    let processed = AtomicU32::new(0);

    pending.par_iter().enumerate().for_each_init(
        tiles::TileCanvas::new,
        |canvas, (index, (coord, arcs))| {
            // Per tile, not per batch: a tile is tens of milliseconds and a whole
            // pass is minutes, so this is where a cancel actually lands. A tile
            // already written stays written, which is correct: the marker below
            // is what tells the next pass the rest is still owed.
            if cancel.is_cancelled() {
                return;
            }
            // Each rayon worker leaves the gap while the athlete is touching
            // the screen, which gives the cores back to the thread drawing it.
            crate::net::pacing::pause();
            if cancel.is_cancelled() {
                return;
            }
            #[cfg(any(test, feature = "synthetic"))]
            {
                let held = hold_in_tile
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take();
                if let Some((reached, release)) = held {
                    let _ = reached.send(());
                    let _ = release.recv();
                }
            }
            let tracks: Vec<&tiles::ProjectedTrack> = arcs.iter().map(|a| a.as_ref()).collect();
            match tiles::draw_heatmap_tile_on(canvas, coord.0, coord.1, coord.2, &tracks) {
                Some(png_data) => {
                    if tiles::save_tile(base, coord.0, coord.1, coord.2, &png_data).is_ok() {
                        generated.fetch_add(1, Ordering::Relaxed);
                    }
                }
                // Nothing reached this tile. Say so on disk, or the existence
                // check cannot tell it from ground that has never been drawn and
                // schedules it again on every pass for as long as the library
                // exists. It is not counted as generated: nothing was drawn.
                None => {
                    let _ = tiles::mark_tile_empty(base, coord.0, coord.1, coord.2);
                }
            }
            let done = processed.fetch_add(1, Ordering::Relaxed) + 1;
            generated_counter.store(done, Ordering::SeqCst);
            if first_band_drawn.tile_done(index < first_band) {
                crate::objects::observer::notify(Announcement::TilesGenerated);
            }
        },
    );

    let generated = generated.load(Ordering::SeqCst);

    // A cancelled pass records nothing and leaves the previous record standing,
    // for the reason the comment below gives: the record claims the tiles it
    // guards are drawn, and a stopped pass did not draw them.
    if cancel.is_cancelled() {
        info!(
            "[heatmap] Background: cancelled after {} tiles / {} scheduled, {}ms",
            generated,
            total,
            start.elapsed().as_millis()
        );
        return TileGeneration {
            generated,
            corrupt: corrupt.len(),
            cancelled: true,
        };
    }

    // Recorded only once the tiles it guards are on disk. A run killed before
    // this point leaves the previous record standing, so the next run still
    // knows which ground is owed a redraw.
    write_corrupt_record(
        base,
        &corrupt.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(),
    );

    info!(
        "[heatmap] Background: generated {} tiles / {} scheduled, total wall time {}ms",
        generated,
        total,
        start.elapsed().as_millis()
    );
    TileGeneration {
        generated,
        corrupt: corrupt.len(),
        cancelled: false,
    }
}

/// Bulk-load every activity's GPS track in chunked `IN (...)` queries.
/// Returns a map from activity_id to its track placed on the map, and the ids whose
/// stored track did not decode. Each chunk is placed before the next is read, so
/// the decoded points held at once are one chunk's rather than the library's. An unreadable track is omitted rather than
/// mapped to an empty one: the map must not claim to hold a track it could
/// not read.
fn bulk_load_tracks(conn: &Connection, activities: &[(String, Bounds)]) -> LoadedTracks {
    // SQLite's default parameter limit is 999; chunk well under that so the
    // query never fails for large corpora.
    const CHUNK: usize = 500;
    load_tracks_in_chunks(conn, activities, CHUNK)
}

fn load_tracks_in_chunks(
    conn: &Connection,
    activities: &[(String, Bounds)],
    chunk_len: usize,
) -> LoadedTracks {
    let mut tracks = LoadedTracksById::with_capacity(activities.len());
    let mut corrupt: Vec<(String, String)> = Vec::new();

    for chunk in activities.chunks(chunk_len) {
        let placeholders: String = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
            placeholders
        );

        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[heatmap] bulk-load prepare failed: {}", e);
                continue;
            }
        };

        let ids: Vec<&str> = chunk.iter().map(|(id, _)| id.as_str()).collect();
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            let id: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob))
        });

        let rows = match rows {
            Ok(r) => r,
            Err(e) => {
                log::error!("[heatmap] bulk-load query failed: {}", e);
                continue;
            }
        };

        let mut decoded: Vec<(String, Vec<GpsPoint>)> = Vec::with_capacity(chunk.len());
        for row in rows {
            let Ok((id, blob)) = row else { continue };
            match TrackRead::from_blob(&blob) {
                TrackRead::Present(track) => decoded.push((id, track)),
                TrackRead::Missing => {}
                TrackRead::Corrupt(reason) => corrupt.push((id, reason)),
            }
        }

        #[cfg(test)]
        tiles::work::held_decoded(decoded.iter().map(|(_, track)| track.len()).sum());
        // Placed on the map once here, so neither the plan nor the draw
        // projects a point again. The decoded points are dropped as each track
        // is placed.
        tracks.par_extend(
            decoded
                .into_par_iter()
                .map(|(id, track)| (id, Arc::new(tiles::ProjectedTrack::new(&track)))),
        );
    }

    LoadedTracks { tracks, corrupt }
}

#[cfg(test)]
#[path = "tests/heatmap_redraw.rs"]
mod heatmap_redraw_tests;

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Twenty short rides in each of two towns 50 km apart.
    fn two_towns() -> (Vec<(String, Bounds)>, LoadedTracksById) {
        let mut activities = Vec::new();
        let mut tracks = HashMap::new();
        for (town, lat, lng) in [("a", 46.23, 7.35), ("b", 46.68, 7.35)] {
            for i in 0..20 {
                let off = f64::from(i) * 0.0004;
                let track: Vec<GpsPoint> = (0..30)
                    .map(|k| GpsPoint::new(lat + off, lng + f64::from(k) * 0.001))
                    .collect();
                let id = format!("{town}{i}");
                activities.push((id.clone(), Bounds::from_points(&track).unwrap()));
                tracks.insert(id, Arc::new(tiles::ProjectedTrack::new(&track)));
            }
        }
        (activities, tracks)
    }

    fn ground_of(track: &[GpsPoint], config: &tiles::HeatmapConfig) -> SweptGround {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        mark_tiles_swept(
            &path,
            &tiles::track_spans(track, config.min_zoom, config.max_zoom),
        );
        SweptGround::read(dir.path()).expect("the sweep left a record")
    }

    /// Scenario: a library is read in three chunks, one row of it unreadable.
    ///
    /// Expected behaviour: the load never holds more decoded points than the
    /// largest chunk carries, since each chunk is placed on the map and its
    /// points dropped before the next is read, and every track is placed as
    /// its stored points place it.
    #[test]
    fn the_load_holds_one_chunk_of_decoded_points_at_a_time() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE gps_tracks (activity_id TEXT PRIMARY KEY, track_data BLOB NOT NULL)",
            [],
        )
        .unwrap();
        let mut activities = Vec::new();
        let mut stored = HashMap::new();
        for i in 0..7u32 {
            let track: Vec<GpsPoint> = (0..20 + 15 * i)
                .map(|k| GpsPoint::new(46.2 + f64::from(i) * 0.01, 7.3 + f64::from(k) * 0.0005))
                .collect();
            let blob = super::super::codec::serialize_track_points(&track);
            let id = format!("ride-{i}");
            conn.execute(
                "INSERT INTO gps_tracks (activity_id, track_data) VALUES (?1, ?2)",
                rusqlite::params![id, blob],
            )
            .unwrap();
            activities.push((id.clone(), Bounds::from_points(&track).unwrap()));
            stored.insert(id, TrackRead::from_blob(&blob).points().to_vec());
        }
        conn.execute(
            "INSERT INTO gps_tracks (activity_id, track_data) VALUES ('broken', ?1)",
            [vec![0xffu8; 9]],
        )
        .unwrap();
        activities.insert(4, ("broken".into(), activities[3].1));

        tiles::work::take_peak_decoded();
        let loaded = load_tracks_in_chunks(&conn, &activities, 3);
        let peak = tiles::work::take_peak_decoded();

        let largest_chunk = activities
            .chunks(3)
            .map(|chunk| {
                chunk
                    .iter()
                    .filter_map(|(id, _)| stored.get(id))
                    .map(Vec::len)
                    .sum::<usize>()
            })
            .max()
            .unwrap();
        let total: usize = stored.values().map(Vec::len).sum();
        assert!(peak > 0, "the load reported nothing held");
        assert!(
            peak <= largest_chunk,
            "{peak} points held decoded at once, the largest chunk holds {largest_chunk} of {total}"
        );
        assert_eq!(loaded.corrupt.len(), 1);
        assert_eq!(loaded.corrupt[0].0, "broken");
        assert_eq!(loaded.tracks.len(), stored.len());
        for (id, points) in &stored {
            let want = tiles::ProjectedTrack::new(points);
            for z in [1, 9, 17] {
                assert_eq!(
                    loaded.tracks[id].tiles_along(z),
                    want.tiles_along(z),
                    "{id} z{z}"
                );
            }
        }
    }

    /// Scenario: one ride is stored in town A and the pass is asked to redraw
    /// what that sweep deleted.
    ///
    /// Expected behaviour: no town-B track is swept at a zoom where its reach
    /// holds no swept tile, and every swept tile gets the tracks a cold pass
    /// gives it.
    #[test]
    fn a_pass_after_one_sweep_plans_only_the_swept_ground() {
        let (mut activities, mut tracks) = two_towns();
        let added: Vec<GpsPoint> = (0..30)
            .map(|k| GpsPoint::new(46.2305, 7.35 + f64::from(k) * 0.001))
            .collect();
        activities.push(("a-new".into(), Bounds::from_points(&added).unwrap()));
        tracks.insert("a-new".into(), Arc::new(tiles::ProjectedTrack::new(&added)));
        let config = tiles::HeatmapConfig::default();
        let ground = ground_of(&added, &config);

        let (cold, cold_sweeps) = plan_tiles(&activities, &tracks, &config, None);
        let (planned, sweeps) = plan_tiles(&activities, &tracks, &config, Some(&ground));

        assert_eq!(cold_sweeps, 41 * usize::from(config.pass_max_zoom));
        let high = tiles::HeatmapConfig {
            min_zoom: 12,
            pass_max_zoom: 17,
            max_zoom: 17,
        };
        let (_, high_sweeps) = plan_tiles(&activities, &tracks, &high, Some(&ground));
        assert!(
            high_sweeps <= 21 * 6,
            "a town-B track was swept at street level"
        );
        let town_b: Vec<_> = activities
            .iter()
            .filter(|(id, _)| id.starts_with('b'))
            .cloned()
            .collect();
        let (_, b_sweeps) = plan_tiles(&town_b, &tracks, &high, Some(&ground));
        assert_eq!(b_sweeps, 0, "a town-B track was swept at street level");
        assert!(sweeps < cold_sweeps);
        assert!(!planned.is_empty());
        for (key, got) in &planned {
            let want = &cold[key];
            assert_eq!(got.len(), want.len(), "tile {key:?} lost a track");
        }
        for key in cold.keys() {
            assert_eq!(
                planned.contains_key(key),
                ground.holds(key.0, key.1, key.2),
                "tile {key:?}"
            );
        }
    }

    /// Scenario: a ride is removed, so its box is swept rather than its track.
    ///
    /// Expected behaviour: the plan covers every tile in the box and sweeps no
    /// track whose reach misses it.
    #[test]
    fn a_removed_box_is_planned_as_its_whole_range() {
        let (activities, tracks) = two_towns();
        let config = tiles::HeatmapConfig::default();
        let removed = &activities[0].1;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        mark_tiles_swept(
            &path,
            &tiles::bounds_spans(
                removed.min_lat,
                removed.max_lat,
                removed.min_lng,
                removed.max_lng,
                config.min_zoom,
                config.max_zoom,
            ),
        );
        let ground = SweptGround::read(dir.path()).unwrap();

        let (cold, _) = plan_tiles(&activities, &tracks, &config, None);
        let (planned, sweeps) = plan_tiles(&activities, &tracks, &config, Some(&ground));

        assert!(sweeps < 40 * usize::from(config.pass_max_zoom));
        for (key, got) in &planned {
            assert_eq!(got.len(), cold[key].len(), "tile {key:?}");
        }
        assert!(planned.keys().any(|k| k.0 == config.pass_max_zoom));
        assert!(
            planned.keys().all(|k| k.0 <= config.pass_max_zoom),
            "the box's deep ground was planned for a pass"
        );
    }

    /// Scenario: a set already owed for another reason, such as a format
    /// change, is then swept by a store.
    ///
    /// Expected behaviour: no record is kept, so the pass plans in full, and a
    /// complete pass clears whatever record there is.
    #[test]
    fn the_swept_record_only_stands_while_every_mark_was_a_sweep() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let path = base.to_string_lossy().into_owned();
        let one = [tiles::TileSpan::tile(10, 1, 2)];

        write_dirty_marker(base);
        mark_tiles_swept(&path, &one);
        assert!(
            read_dirty_state(base).1.is_none(),
            "a full mark kept a record"
        );

        let (token, _) = read_dirty_state(base);
        clear_dirty_marker(&path, token);
        assert!(read_dirty_token(base).is_none());
        mark_tiles_swept(&path, &one);
        let (token, ground) = read_dirty_state(base);
        assert!(ground.unwrap().holds(10, 1, 2));

        mark_tiles_swept(&path, &[tiles::TileSpan::tile(10, 3, 4)]);
        clear_dirty_marker(&path, token);
        let (_, ground) = read_dirty_state(base);
        let ground = ground.expect("a sweep during the pass lost the record");
        assert!(ground.holds(10, 1, 2) && ground.holds(10, 3, 4));

        let (token, _) = read_dirty_state(base);
        clear_dirty_marker(&path, token);
        assert!(read_dirty_state(base).1.is_none());
        write_dirty_marker(base);
        assert!(read_dirty_state(base).1.is_none());
    }

    /// Scenario: a fresh install with the map open on a street-level view
    /// while the pass runs. The pass writes every zoom in full before the
    /// next, so the tiles on screen were behind the whole lower sweep.
    ///
    /// Expected behaviour: the ground the camera is on, at the zoom it is
    /// showing, sorts first; the same ground at other zooms next; everything
    /// else last, in the order it had.
    #[test]
    fn the_viewport_is_drawn_before_the_rest_of_the_sweep() {
        // Sion, where the demo library rides.
        let (lat, lon, zoom) = (46.233, 7.36, 14u8);
        let here = |z: u8| {
            (
                z,
                crate::tiles::lon_to_tile_x(lon, z).floor() as u32,
                crate::tiles::lat_to_tile_y(lat, z).floor() as u32,
            )
        };
        let priority = Some((lat, lon, zoom));

        assert_eq!(priority_rank(here(14), priority), 0, "the zoom on screen");
        assert_eq!(priority_rank(here(13), priority), 0, "and one either side");
        assert_eq!(priority_rank(here(15), priority), 0);
        assert_eq!(priority_rank(here(8), priority), 1, "same ground, far zoom");

        let elsewhere = (14u8, here(14).1 + 40, here(14).2 + 40);
        assert_eq!(priority_rank(elsewhere, priority), 2, "ground nobody is on");
    }

    /// Scenario: a fresh install with the map open at z14 over a town while
    /// the pass runs. A phone screen at z14 spans several tiles each way, and
    /// only the one under the centre was put first, so the rest of the screen
    /// queued behind every lower zoom of the whole library.
    ///
    /// Expected behaviour: a tile two columns from the centre at the zoom on
    /// screen sorts before any lower-zoom tile outside the window.
    #[test]
    fn the_rest_of_the_screen_is_drawn_before_lower_zooms_elsewhere() {
        let (lat, lon, zoom) = (46.233, 7.36, 14u8);
        let centre = (
            zoom,
            crate::tiles::lon_to_tile_x(lon, zoom).floor() as u32,
            crate::tiles::lat_to_tile_y(lat, zoom).floor() as u32,
        );
        let beside = (zoom, centre.1 + 2, centre.2);
        let below = (zoom, centre.1, centre.2 + 2);
        // Geneva at z10, a whole tile column and more from Sion.
        let low_elsewhere = (
            10u8,
            crate::tiles::lon_to_tile_x(6.14, 10).floor() as u32,
            crate::tiles::lat_to_tile_y(46.20, 10).floor() as u32,
        );
        let priority = Some((lat, lon, zoom));
        let mut pending = [low_elsewhere, beside, (1, 0, 0), below, centre];

        pending.sort_unstable_by_key(|coord| {
            (priority_rank(*coord, priority), coord.0, coord.1, coord.2)
        });

        let at = |tile| pending.iter().position(|c| *c == tile).unwrap();
        assert!(
            at(beside) < at(low_elsewhere),
            "a tile on screen waited behind a z10 tile nobody is looking at"
        );
        assert!(at(below) < at(low_elsewhere));
        assert!(at(centre) < at(low_elsewhere));
        assert_eq!(priority_rank(low_elsewhere, priority), 2);
    }

    /// Scenario: the map is open over a town while a fresh library's pass
    /// runs. The screen's tiles are written first, but the map only asks again
    /// when the pass announces, which was at the end of the whole sweep.
    ///
    /// Expected behaviour: the band announces on its last tile and never
    /// before, once, whatever order the workers finish in; the tiles after it
    /// announce nothing; a band that is empty or the whole pass leaves the
    /// announcement to the end of the pass.
    #[test]
    fn the_first_band_announces_once_when_its_last_tile_lands() {
        let band = FirstBandDrawn::new(3, 10);
        assert!(!band.tile_done(true));
        assert!(!band.tile_done(false), "a later tile is not the band");
        assert!(!band.tile_done(true));
        assert!(band.tile_done(true), "the third of three");
        assert!(!band.tile_done(true), "not a second time");

        assert!(!FirstBandDrawn::new(0, 10).tile_done(true), "empty band");
        assert!(!FirstBandDrawn::new(10, 10).tile_done(true), "whole pass");
    }

    /// Scenario: Android killed the process while a pass was writing a tile,
    /// leaving the temp file the write went through.
    ///
    /// Expected behaviour: the temp file is not served.
    #[test]
    fn a_leftover_temp_file_is_not_served() {
        let _serial = crate::test_globals::serial_global_state();
        let tmp = tempfile::tempdir().expect("tempdir");
        let column = tmp.path().join("12").join("1");
        std::fs::create_dir_all(&column).expect("column");
        std::fs::write(column.join("1.png.0.tmp"), b"half a PNG").expect("temp");
        publish_heatmap_source(Some(HeatmapSource {
            dir: tmp.path().to_string_lossy().into_owned(),
            db_path: String::new(),
            bounds: Arc::new(rstar::RTree::new()),
        }));

        let served = heatmap_tile_bytes(12, 1, 1);

        publish_heatmap_source(None);
        assert!(served.is_none(), "a temp file was served as a tile");
    }

    /// Scenario: the map is open at z16 while a fresh library's pass runs.
    /// The pass draws nothing deeper than z14, and a window ranked at z16
    /// put z14 one band down with every other zoom of the same ground.
    ///
    /// Expected behaviour: the z14 ground under the camera, and the zoom
    /// either side of it, sort into the first band.
    #[test]
    fn a_camera_deeper_than_the_pass_puts_the_deepest_drawn_zoom_first() {
        let (lat, lon) = (46.233, 7.36);
        let here = |z: u8| {
            (
                z,
                crate::tiles::lon_to_tile_x(lon, z).floor() as u32,
                crate::tiles::lat_to_tile_y(lat, z).floor() as u32,
            )
        };
        let priority = Some((lat, lon, 16));

        assert_eq!(priority_rank(here(14), priority), 0);
        assert_eq!(priority_rank(here(13), priority), 0);
        assert_eq!(priority_rank(here(8), priority), 1);
        let elsewhere = (14u8, here(14).1 + 40, here(14).2 + 40);
        assert_eq!(priority_rank(elsewhere, priority), 2);
    }

    /// With no camera set nothing is preferred, which is the pass a sync runs
    /// with no map open: every tile ranks the same and the zoom order stands.
    #[test]
    fn no_camera_leaves_the_order_alone() {
        assert_eq!(priority_rank((17, 1, 1), None), 0);
        assert_eq!(priority_rank((1, 0, 0), None), 0);
    }

    /// The whole point, on the list the pass actually sorts.
    #[test]
    fn the_sort_puts_the_viewports_tiles_at_the_front() {
        let (lat, lon) = (46.233, 7.36);
        let tile = |z: u8| {
            (
                z,
                crate::tiles::lon_to_tile_x(lon, z).floor() as u32,
                crate::tiles::lat_to_tile_y(lat, z).floor() as u32,
            )
        };
        let priority = Some((lat, lon, 14));
        let mut pending = [tile(1), tile(17), tile(14), (14, 99, 99), tile(2)];

        pending.sort_unstable_by_key(|coord| {
            (priority_rank(*coord, priority), coord.0, coord.1, coord.2)
        });

        assert_eq!(pending[0], tile(14), "the zoom on screen goes first");
        assert_eq!(
            pending.last(),
            Some(&(14, 99, 99)),
            "and ground nobody is looking at goes last"
        );
    }

    /// Scenario: a tile sweep marks the set dirty while a generation run is
    /// already in flight. Expected behaviour: the run clears only the mark it
    /// started with, so the sweep's mark survives and the deleted tiles are
    /// redrawn on the next pass.
    #[test]
    fn clear_dirty_marker_keeps_a_mark_written_during_the_run() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let path = base.to_str().unwrap().to_string();

        write_dirty_marker(base);
        let token = read_dirty_token(base);

        write_dirty_marker(base);
        clear_dirty_marker(&path, token);

        assert!(
            base.join(DIRTY_MARKER).exists(),
            "a mark written mid-run must outlive the run that did not see it"
        );
    }

    #[test]
    fn clear_dirty_marker_removes_the_mark_the_run_started_with() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let path = base.to_str().unwrap().to_string();

        write_dirty_marker(base);
        let token = read_dirty_token(base);
        clear_dirty_marker(&path, token);

        assert!(!base.join(DIRTY_MARKER).exists());
    }

    #[test]
    fn each_mark_carries_its_own_token() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        write_dirty_marker(base);
        let first = read_dirty_token(base);
        write_dirty_marker(base);
        let second = read_dirty_token(base);

        assert!(first.is_some());
        assert_ne!(first, second);
    }

    /// A run that started on a clean set must not clear a mark that arrived
    /// after it began.
    #[test]
    fn a_run_that_saw_no_mark_clears_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let path = base.to_str().unwrap().to_string();

        let token = read_dirty_token(base);
        assert!(token.is_none());

        write_dirty_marker(base);
        clear_dirty_marker(&path, token);

        assert!(base.join(DIRTY_MARKER).exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_wipe_reports_a_failed_dirty_mark_after_removing_tiles() {
        use std::os::unix::fs::symlink;

        let _serial = crate::test_globals::serial_global_state();
        let tmp = tempfile::tempdir().expect("tempdir");
        let blocked = tmp.path().join("blocked");
        let healthy = tmp.path().join("healthy");
        tiles::save_tile(&blocked, 12, 1, 1, b"old").expect("tile");
        tiles::save_tile(&healthy, 12, 1, 1, b"old").expect("tile");
        symlink("missing/marker", blocked.join(DIRTY_MARKER)).expect("block marker write");

        let outcome = wipe_tile_sets(&[blocked.clone(), healthy.clone()]);

        assert!(outcome.is_err(), "the wipe hid a failed dirty mark");
        assert!(
            !blocked.join("12").exists(),
            "the blocked set was not emptied"
        );
        assert!(
            !healthy.join("12").exists(),
            "the other set was not emptied"
        );
        assert!(
            healthy.join(DIRTY_MARKER).exists(),
            "the other set was not marked"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_wipe_reports_failed_path_inspection_and_attempts_other_sets() {
        use std::os::unix::fs::symlink;

        let _serial = crate::test_globals::serial_global_state();
        let tmp = tempfile::tempdir().expect("tempdir");
        let looping = tmp.path().join("looping");
        let healthy = tmp.path().join("healthy");
        symlink("looping", &looping).expect("looping path");
        tiles::save_tile(&healthy, 12, 1, 1, b"old").expect("tile");

        let outcome = wipe_tile_sets(&[looping, healthy.clone()]);

        assert!(outcome.is_err(), "the wipe hid a failed path inspection");
        assert!(
            !healthy.join("12").exists(),
            "the other set was not emptied"
        );
        assert!(
            healthy.join(DIRTY_MARKER).exists(),
            "the other set was not marked"
        );
    }

    /// Scenario: the engine spawns a tile pass at load when the set is stale,
    /// and the GPS sync spawns another as soon as it stores a track. There is
    /// one handle slot, so a second pass makes the first unobservable and the
    /// two workers write the same tile files.
    mod one_pass_at_a_time {
        use super::*;
        use crate::test_globals::serial_global_state;

        #[test]
        fn test_serial_guard_stops_a_pass_before_releasing_the_global_state() {
            let serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles-serial.db");
            let cancel = crate::persistence::CancelToken::new();
            let pass = claim_pass(&cancel).expect("pass claimed");
            let worker_cancel = cancel.clone();
            let (release, released) = std::sync::mpsc::channel::<()>();
            let worker = std::thread::spawn(move || {
                while !worker_cancel.is_cancelled() {
                    if released.recv_timeout(Duration::from_millis(10)).is_ok() {
                        break;
                    }
                }
                drop(pass);
            });

            drop(serial);
            let stopped = cancel.is_cancelled() && tile_pass_slot().is_none();
            let _ = release.send(());
            worker.join().expect("worker stopped");
            assert!(stopped, "the next test can inherit a running tile pass");
        }

        /// Claim the pass against the process-wide engine, which is the one
        /// the guard releases through.
        fn claim_pass(cancel: &crate::persistence::CancelToken) -> Option<TilePassGuard> {
            crate::persistence::with_persistent_engine(|engine| {
                TilePassGuard::claim(engine, cancel)
            })
            .expect("engine")
        }

        /// Scenario: a tile pass runs and the jobs surface asks the attempt
        /// store what is in flight.
        ///
        /// Expected behaviour: the store reports the pass held while it runs,
        /// forgets it when it ends normally, and backs the key off when the
        /// pass panicked.
        #[test]
        fn the_attempt_store_sees_the_pass_and_backs_off_a_panicked_one() {
            use crate::persistence::attempts::{Claim, attempt_backoff_ms, now_ms};
            let _serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles.db");
            let probe = || {
                crate::persistence::with_persistent_engine(|engine| {
                    engine.claim_job(&tile_pass_key(), now_ms()).expect("claim")
                })
                .expect("engine")
            };
            let claim = claim_pass;

            let held = claim(&crate::persistence::CancelToken::new()).expect("free");
            assert_eq!(probe(), Claim::InFlight, "the store cannot see the pass");
            drop(held);
            assert_eq!(probe(), Claim::Taken, "a finished pass stayed held");
            crate::persistence::with_persistent_engine(|engine| {
                engine
                    .release_job(&tile_pass_key(), Release::Deferred, now_ms())
                    .expect("release")
            });

            let panicked = claim(&crate::persistence::CancelToken::new()).expect("free");
            let worker = std::thread::spawn(move || {
                let _held = panicked;
                panic!("background_generate_tiles");
            });
            assert!(worker.join().is_err());
            let Claim::BackingOff { until } = probe() else {
                panic!("a panicked pass left no backoff");
            };
            assert!(until > now_ms() + attempt_backoff_ms(0) - 5_000);
        }

        #[test]
        fn a_pass_on_another_engine_releases_its_lease() {
            let _serial = serial_global_state();
            let _installed = crate::test_globals::init_global_engine("installed.db");
            let other_dir = tempfile::tempdir().expect("tempdir");
            let db_path = other_dir.path().join("other.db");
            let other = PersistentEngine::new(db_path.to_str().expect("database path"))
                .expect("other engine");
            let key = tile_pass_key();

            let held = TilePassGuard::claim(&other, &crate::persistence::CancelToken::new())
                .expect("the pass starts");
            assert_eq!(
                other.claim_job(&key, now_ms()).expect("claim"),
                Claim::InFlight
            );
            drop(held);

            assert_eq!(
                other.claim_job(&key, now_ms()).expect("claim"),
                Claim::Taken,
                "the pass left its lease on the other engine"
            );
            other
                .release_job(&key, Release::Deferred, now_ms())
                .expect("release");
        }

        #[test]
        fn a_second_pass_is_refused_while_one_runs() {
            let _serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles.db");
            let held =
                claim_pass(&crate::persistence::CancelToken::new()).expect("the slot was free");

            assert!(
                claim_pass(&crate::persistence::CancelToken::new()).is_none(),
                "a second pass was started beside the first"
            );

            drop(held);
            assert!(
                claim_pass(&crate::persistence::CancelToken::new()).is_some(),
                "the slot did not come back when the pass ended"
            );
        }

        #[test]
        fn a_pass_claimed_after_the_stop_cannot_write_after_the_wipe() {
            let _serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles.db");
            let tmp = tempfile::tempdir().expect("tempdir");
            let dir = tmp.path().join("tiles");
            tiles::save_tile(&dir, 12, 1, 1, b"old").expect("old tile");
            let mut slipped = None;

            wipe_tile_sets_within_after_stop(
                std::slice::from_ref(&dir),
                Duration::from_secs(1),
                || slipped = claim_pass(&crate::persistence::CancelToken::new()),
            )
            .expect("wipe");
            if slipped.is_some() {
                tiles::save_tile(&dir, 12, 1, 1, b"old").expect("late tile");
            }

            assert!(
                !dir.join("12").exists(),
                "a pass claimed the slot during the wipe and wrote old tiles afterwards"
            );
            drop(slipped);
            assert!(
                claim_pass(&crate::persistence::CancelToken::new()).is_some(),
                "the wipe left tile generation unavailable"
            );
        }

        #[test]
        fn a_panicking_pass_clears_its_registered_stop() {
            let _serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles.db");
            let claimed =
                claim_pass(&crate::persistence::CancelToken::new()).expect("the slot was free");
            let pass = std::thread::spawn(move || {
                let _held = claimed;
                panic!("background_generate_tiles");
            });
            assert!(pass.join().is_err(), "the pass panicked");

            assert!(
                stop_tile_pass(Duration::from_millis(20)).is_ok(),
                "a panicked pass left its stop registered, so a wipe would wait on it"
            );
        }

        /// Scenario: a wipe lands while a pass is still loading tracks, the
        /// stretch it cannot leave. Deleting under it would let it draw the
        /// old library into the emptied set.
        ///
        /// Expected behaviour: the stop asks the pass to end and fails when it
        /// has not by the end of the wait, and succeeds once it has.
        #[test]
        fn a_stop_fails_while_the_pass_outlives_the_wait() {
            let _serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles.db");
            let cancel = crate::persistence::CancelToken::new();
            let held = claim_pass(&cancel).expect("the slot was free");

            let outcome = stop_tile_pass(Duration::from_millis(20));

            assert!(
                outcome.is_err(),
                "the stop reported a pass still running as ended"
            );
            assert!(cancel.is_cancelled(), "the pass was never asked to stop");
            drop(held);
            assert!(
                stop_tile_pass(Duration::from_millis(20)).is_ok(),
                "the stop failed with no pass running"
            );
        }

        /// Scenario: the stopped pass ends and another claims the slot before
        /// the stop wakes. Waiting for an empty slot left the second running
        /// and failed the wipe at the end of the wait.
        ///
        /// Expected behaviour: the stop cancels whichever pass holds the slot
        /// and returns once none does.
        #[test]
        fn a_stop_also_stops_a_pass_that_claims_the_slot_meanwhile() {
            let _serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles.db");
            let first = crate::persistence::CancelToken::new();
            let held = claim_pass(&first).expect("the slot was free");
            let second = crate::persistence::CancelToken::new();
            let worker_first = first.clone();
            let worker_second = second.clone();
            let db_path =
                crate::persistence::with_persistent_engine(|e| e.db_path.clone()).expect("engine");
            let worker = std::thread::spawn(move || {
                while !worker_first.is_cancelled() {
                    std::thread::yield_now();
                }
                // The first ends and the second takes the slot in one hold of
                // the lock, so the stop cannot wake between them.
                {
                    let mut slot = tile_pass_slot();
                    std::mem::forget(held);
                    *slot = Some(worker_second.clone());
                }
                TILE_PASS_ENDED.notify_all();
                let _second = TilePassGuard {
                    install: crate::persistence::engine_install(),
                    db_path,
                };
                while !worker_second.is_cancelled() {
                    std::thread::yield_now();
                }
            });

            let outcome = stop_tile_pass(Duration::from_secs(10));

            // Ends the worker when the stop missed it, so a failure is a
            // failure rather than a hang.
            second.cancel();
            worker.join().expect("the worker ends");
            assert!(
                outcome.is_ok(),
                "the pass that claimed the slot was never stopped"
            );
        }

        /// Scenario: the wipe's stop runs out while the pass is still going.
        ///
        /// Expected behaviour: nothing is deleted under the pass, and the set
        /// is still marked owed a draw, since the library it draws is gone.
        #[test]
        fn a_wipe_whose_pass_will_not_stop_deletes_nothing_and_marks_the_set() {
            let _serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles.db");
            let tmp = tempfile::TempDir::new().expect("tempdir");
            let dir = tmp.path().join("tiles");
            tiles::save_tile(&dir, 12, 1, 1, b"heat").expect("tile written");
            let held =
                claim_pass(&crate::persistence::CancelToken::new()).expect("the slot was free");

            let outcome =
                wipe_tile_sets_within(std::slice::from_ref(&dir), Duration::from_millis(20));

            drop(held);
            assert!(
                outcome.is_err(),
                "the wipe reported success under a live pass"
            );
            assert!(
                dir.join("12").join("1").join("1.png").exists(),
                "the wipe deleted under a pass that could still write"
            );
            assert!(
                dir.join(DIRTY_MARKER).exists(),
                "the wiped library's set is not marked"
            );
        }

        /// The stop answers when the worker ends, not at the end of its wait.
        #[test]
        fn a_stop_returns_when_the_pass_ends() {
            let _serial = serial_global_state();
            let _tmp = crate::test_globals::init_global_engine("tiles.db");
            let cancel = crate::persistence::CancelToken::new();
            let held = claim_pass(&cancel).expect("the slot was free");
            let worker_cancel = cancel.clone();
            let worker = std::thread::spawn(move || {
                let _held = held;
                while !worker_cancel.is_cancelled() {
                    std::thread::yield_now();
                }
            });

            let outcome = stop_tile_pass(Duration::from_secs(600));

            worker.join().expect("the worker ends");
            assert!(outcome.is_ok(), "the stop failed on a pass that ended");
            assert!(
                claim_pass(&crate::persistence::CancelToken::new()).is_some(),
                "the slot did not come back when the pass ended"
            );
        }
    }
}
