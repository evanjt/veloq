//! Heatmap tile generation for PersistentEngine.
//!
//! Tile generation runs on a background thread with its own SQLite connection,
//! following the same pattern as section detection. The engine mutex is held
//! only briefly to extract metadata (db_path, tiles_path, activity bounds).

use super::codec::TrackRead;
use super::{PersistentEngine, TileGenerationHandle};
use crate::objects::observer::Announcement;
use crate::tiles;
use log::info;
use rayon::prelude::*;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, RwLock};
use tracematch::{Bounds, GpsPoint};

/// Tile format version - increment when tile size, zoom range, or rendering changes.
/// Triggers automatic cache clear + regeneration on app upgrade.
const TILE_FORMAT_VERSION: &str = "7";

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

/// A hold the next tile pass waits on just before it draws, so a test can land
/// a cancel on a pass in flight without racing it. Built only for the
/// synthetic test lane.
#[cfg(feature = "synthetic")]
static TILE_PASS_HOLD: std::sync::Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>> =
    std::sync::Mutex::new(None);

/// The test's side of [`hold_next_tile_pass`]. Dropping it releases the pass,
/// so a failed assertion never leaves the worker waiting.
#[cfg(feature = "synthetic")]
#[doc(hidden)]
pub struct TilePassHold {
    reached: mpsc::Receiver<()>,
    release: mpsc::Sender<()>,
}

#[cfg(feature = "synthetic")]
impl TilePassHold {
    /// Block until the pass has scheduled its tiles and waits to draw them.
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
#[cfg(feature = "synthetic")]
#[doc(hidden)]
pub fn hold_next_tile_pass() -> TilePassHold {
    let (reached_tx, reached_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    *TILE_PASS_HOLD.lock().unwrap_or_else(|e| e.into_inner()) = Some((reached_tx, release_rx));
    TilePassHold {
        reached: reached_rx,
        release: release_tx,
    }
}

/// Whether a tile pass is on a thread in this process. There is one handle
/// slot, so a second pass drops the first's handle and reports its own
/// progress in place of it, while both workers write the same tile files and
/// each clears the dirty mark against the token it captured before it began.
static TILE_PASS_RUNNING: AtomicBool = AtomicBool::new(false);

/// Holds the single tile-pass slot. Release is structural, so a panic in the
/// pass cannot leave tile generation unstartable for the life of the process.
struct TilePassGuard;

impl Drop for TilePassGuard {
    fn drop(&mut self) {
        TILE_PASS_RUNNING.store(false, Ordering::SeqCst);
    }
}

impl TilePassGuard {
    /// Claim the slot, or `None` when a pass already holds it.
    fn claim() -> Option<Self> {
        TILE_PASS_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| TilePassGuard)
    }
}

/// Every activity's track, plus the ones whose stored blob did not decode.
struct LoadedTracks {
    tracks: HashMap<String, Arc<Vec<GpsPoint>>>,
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

/// The tiles directory, readable without the engine lock.
///
/// The WebView's request interceptor runs on a background thread with no
/// JavaScript context and no business taking the engine's lock: a tile the map
/// is drawing would then queue behind whatever a sync is writing. The path is
/// the only thing it needs, it changes twice in a session, and it is written
/// here beside the field it mirrors.
static HEATMAP_TILES_DIR: RwLock<Option<String>> = RwLock::new(None);

/// Where the athlete is looking, so the pass can draw that ground first.
///
/// Latitude, longitude and the zoom the camera is at. The pass otherwise
/// writes every zoom in full before the next one, so on a fresh install the
/// z14-17 tiles of the viewport on screen are behind the whole lower sweep:
/// 758 of the demo library's 1,508 tiles are z17 alone. Set from the map when
/// the camera settles and cleared when it leaves, and read once per pass, so
/// a camera that moves mid-pass changes the next one rather than this one.
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

/// How late a tile may be drawn: 0 is the viewport at the zoom it is showing,
/// 1 is the same ground at another zoom, 2 is everything else.
///
/// The three bands and not a distance, because a distance orders tiles the
/// athlete cannot see as finely as the ones they can, and the point is only to
/// get the screen drawn first.
fn priority_rank(coord: (u8, u32, u32), priority: Option<(f64, f64, u8)>) -> u8 {
    let Some((lat, lon, zoom)) = priority else {
        return 0;
    };
    let (z, x, y) = coord;
    let covers = crate::tiles::lon_to_tile_x(lon, z).floor() as i64 == x as i64
        && crate::tiles::lat_to_tile_y(lat, z).floor() as i64 == y as i64;
    if !covers {
        return 2;
    }
    // One zoom either side: a double-tap lands on the next one, and drawing it
    // with the one on screen is what keeps the step sharp.
    if z.abs_diff(zoom) <= 1 { 0 } else { 1 }
}

fn publish_tiles_dir(path: Option<String>) {
    match HEATMAP_TILES_DIR.write() {
        Ok(mut held) => *held = path,
        Err(poisoned) => *poisoned.into_inner() = path,
    }
}

/// One heatmap tile's PNG bytes, or `None` when the athlete has the heatmap
/// off, the pass has not drawn that tile yet, or the file is an empty marker.
///
/// A miss is not a failure here: heatmap tiles are generated from local GPS
/// rather than fetched, so "not drawn yet" is the ordinary answer and the
/// caller turns it into a 404.
pub fn heatmap_tile_bytes(z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
    let dir = match HEATMAP_TILES_DIR.read() {
        Ok(held) => held.clone()?,
        Err(poisoned) => poisoned.into_inner().clone()?,
    };
    let path = Path::new(&dir)
        .join(z.to_string())
        .join(x.to_string())
        .join(format!("{}.png", y));

    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() { None } else { Some(bytes) }
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
        publish_tiles_dir(Some(path.clone()));

        // Check tile format version - clear stale tiles on upgrade
        let version_file = Path::new(&path).join("version.txt");
        let current_version = std::fs::read_to_string(&version_file).unwrap_or_default();
        if current_version.trim() != TILE_FORMAT_VERSION {
            info!(
                "[heatmap] Tile format changed ({:?} → {}), clearing stale tiles",
                current_version.trim(),
                TILE_FORMAT_VERSION
            );
            tiles::clear_all_tiles(Path::new(&path));
            if let Err(e) = std::fs::create_dir_all(&path) {
                log::warn!(
                    "[heatmap] Failed to create tiles directory {:?}: {}",
                    path,
                    e
                );
            }
            if let Err(e) = std::fs::write(&version_file, TILE_FORMAT_VERSION) {
                log::warn!(
                    "[heatmap] Failed to write version file {:?}: {}",
                    version_file,
                    e
                );
            }
            // Format changed - mark dirty so generation runs
            self.mark_heatmap_dirty();
        }

        // Only generate if tiles are stale (new data, format change, first time, or cache cleared).
        // Skips the expensive tile enumeration + file-existence checks on normal app restart.
        if !self.activity_metadata.is_empty() && self.is_heatmap_dirty() {
            info!("[heatmap] Tiles are stale - spawning background generation");
            if let Some(handle) = self.generate_tiles_background()
                && let Ok(mut guard) = super::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock()
            {
                *guard = Some(handle);
            }
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

    /// Spawn background tile generation. Extracts metadata while holding &self
    /// (microseconds), then releases. The heavy work runs on a separate thread
    /// with its own SQLite connection.
    ///
    /// Returns None if no tiles path is configured, no activities exist, or a
    /// pass is already running. The engine spawns one at load when the set is
    /// stale and the GPS sync spawns one whenever it stores a track, so the
    /// two overlap on the ordinary shape of a cold launch that then syncs.
    pub fn generate_tiles_background(&self) -> Option<TileGenerationHandle> {
        let tiles_path = self.heatmap_tiles_path.clone()?;
        let db_path = self.db_path.clone();

        if self.activity_metadata.is_empty() {
            return None;
        }

        let Some(pass) = TilePassGuard::claim() else {
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
        let cancel = super::CancelToken::new();
        let worker_cancel = cancel.clone();

        // Captured before the pass so a sweep that marks the set dirty while
        // it runs is not cleared by it.
        let started_on = read_dirty_token(Path::new(&tiles_path));

        crate::threads::spawn_named("veloq-tiles", move || {
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
                    clear_dirty_marker(&tiles_path, started_on);
                }
                if run.corrupt > 0 {
                    log::error!(
                        "[heatmap] Tile set is incomplete: {} activities were unreadable. The tiles they reach are redrawn on the next run.",
                        run.corrupt
                    );
                }
                run.generated
            };
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
            cancel,
        })
    }

    /// Disable heatmap tile generation by clearing the tiles path.
    /// Prevents regeneration on next sync.
    pub fn clear_heatmap_tiles_path(&mut self) {
        info!("[heatmap] Tiles path cleared - generation disabled");
        self.heatmap_tiles_path = None;
        publish_tiles_dir(None);
    }

    /// The tiles path in force, or `None` when the athlete has the heatmap off.
    pub fn heatmap_tiles_path(&self) -> Option<&str> {
        self.heatmap_tiles_path.as_deref()
    }

    /// Clear all heatmap tiles from disk and mark as dirty so they regenerate when re-enabled.
    pub fn clear_heatmap_tiles(&self, base_path: &str) -> u32 {
        let count = tiles::clear_all_tiles(Path::new(base_path));
        if count > 0 {
            self.mark_heatmap_dirty();
        }
        count
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

/// Remove every tile at `dir` and mark the emptied set owed a draw.
///
/// For a wipe. The tiles draw a library that no longer exists, and a dirty
/// pass only fills tiles that are missing, so a mark alone leaves every tile
/// outside the next library's ground on disk for the map to serve. The
/// corrupt record goes too: it names the wiped library's activities.
///
/// It walks the whole set, so the caller runs it with the engine lock
/// released.
pub(crate) fn wipe_tile_set(dir: &Path) {
    if !dir.exists() {
        return;
    }
    let removed = tiles::clear_all_tiles(dir);
    write_corrupt_record(dir, &[]);
    write_dirty_marker(dir);
    info!("[heatmap] Wipe removed {} zoom levels of tiles", removed);
}

/// Mark the tile set at `tiles_path` as needing regeneration, without the
/// engine. Callers that sweep tiles on a detached thread hold only the path.
pub(crate) fn mark_tiles_dirty(tiles_path: &str) {
    write_dirty_marker(Path::new(tiles_path));
}

/// Mark the tile set as needing regeneration. Each mark carries its own token
/// so a run can tell the mark it started on from one that arrived while it was
/// working.
fn write_dirty_marker(base: &Path) {
    if let Err(e) = std::fs::create_dir_all(base) {
        log::warn!(
            "[heatmap] Failed to create tiles directory for dirty marker: {}",
            e
        );
        return;
    }
    let token = DIRTY_TOKEN.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    if let Err(e) = std::fs::write(base.join(DIRTY_MARKER), format!("{}-{}", nanos, token)) {
        log::warn!("[heatmap] Failed to write dirty marker: {}", e);
    }
}

/// The token of the mark currently standing, or None when the set is clean.
fn read_dirty_token(base: &Path) -> Option<String> {
    std::fs::read_to_string(base.join(DIRTY_MARKER)).ok()
}

/// Remove the dirty marker after a successful generation run, but only the
/// mark that run started on. A sweep that deletes tiles marks the set dirty,
/// and clearing that mark would strand the ground it deleted: nothing else
/// regenerates it, and at low zoom one activity's bounds cover the whole
/// library, which is how the pyramid emptied below z12.
fn clear_dirty_marker(tiles_path: &str, started_on: Option<String>) {
    let base = Path::new(tiles_path);
    let Some(started_on) = started_on else {
        return;
    };
    if read_dirty_token(base).as_deref() != Some(started_on.as_str()) {
        info!("[heatmap] Set was re-marked during the run, leaving it dirty");
        return;
    }
    if let Err(e) = std::fs::remove_file(base.join(DIRTY_MARKER))
        && e.kind() != std::io::ErrorKind::NotFound
    {
        log::warn!("[heatmap] Failed to clear dirty marker: {}", e);
    }
}

/// Generate heatmap tiles on a background thread.
/// Opens its own SQLite connection - does NOT touch PERSISTENT_ENGINE.
///
/// Pipeline (rewritten for Tier 1.1/1.3):
/// 1. Bulk-load every activity's GPS track into an in-memory Arc-cache.
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
) -> TileGeneration {
    let start = std::time::Instant::now();
    let base = Path::new(tiles_path);
    let config = tiles::HeatmapConfig::default();
    // Taken at the start, so a pass that returns before drawing drops it and
    // the waiting test hears that rather than hanging.
    #[cfg(feature = "synthetic")]
    let hold = TILE_PASS_HOLD
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();

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
    type TileKey = (u8, u32, u32);
    type Tracks = Vec<Arc<Vec<GpsPoint>>>;
    let mut tile_tracks: HashMap<TileKey, Tracks> = HashMap::new();
    for (id, _bounds) in activities {
        let Some(track) = tracks_by_id.get(id) else {
            continue;
        };
        if track.is_empty() {
            continue;
        }
        for z in config.min_zoom..=config.max_zoom {
            for coord in tiles::tiles_along_track(track, z) {
                tile_tracks
                    .entry((z, coord.0, coord.1))
                    .or_default()
                    .push(Arc::clone(track));
            }
        }
    }
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
        config.max_zoom,
        load_ms,
        plan_ms,
    );

    #[cfg(feature = "synthetic")]
    if let Some((reached, release)) = hold {
        let _ = reached.send(());
        let _ = release.recv();
    }

    // --- Phase 4: parallel rasterise + save ---------------------------------
    // Each worker owns its own refs; Arc<Vec<GpsPoint>> is shared so we don't
    // deep-clone tracks across threads. No SQLite connection inside workers.
    let generated = AtomicU32::new(0);
    let processed = AtomicU32::new(0);

    pending.par_iter().for_each(|(coord, arcs)| {
        // Per tile, not per batch: a tile is tens of milliseconds and a whole
        // pass is minutes, so this is where a cancel actually lands. A tile
        // already written stays written, which is correct: the marker below
        // is what tells the next pass the rest is still owed.
        if cancel.is_cancelled() {
            return;
        }
        // Build a slice-of-slices view without deep-cloning the track data;
        // each `&[GpsPoint]` impls `AsRef<[GpsPoint]>`, matching the
        // generic bound on `generate_heatmap_tile`.
        let slices: Vec<&[GpsPoint]> = arcs.iter().map(|a| a.as_slice()).collect();
        match tiles::generate_heatmap_tile(coord.0, coord.1, coord.2, &slices) {
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
    });

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
/// Returns a map from activity_id → Arc<Vec<GpsPoint>> and the ids whose
/// stored track did not decode. An unreadable track is omitted rather than
/// mapped to an empty one: the map must not claim to hold a track it could
/// not read.
fn bulk_load_tracks(conn: &Connection, activities: &[(String, Bounds)]) -> LoadedTracks {
    // SQLite's default parameter limit is 999; chunk well under that so the
    // query never fails for large corpora.
    const CHUNK: usize = 500;
    let mut tracks: HashMap<String, Arc<Vec<GpsPoint>>> = HashMap::with_capacity(activities.len());
    let mut corrupt: Vec<(String, String)> = Vec::new();

    for chunk in activities.chunks(CHUNK) {
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

        for row in rows {
            let Ok((id, blob)) = row else { continue };
            match TrackRead::from_blob(&blob) {
                TrackRead::Present(track) => {
                    tracks.insert(id, Arc::new(track));
                }
                TrackRead::Missing => {}
                TrackRead::Corrupt(reason) => corrupt.push((id, reason)),
            }
        }
    }

    LoadedTracks { tracks, corrupt }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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

    /// Scenario: the engine spawns a tile pass at load when the set is stale,
    /// and the GPS sync spawns another as soon as it stores a track. There is
    /// one handle slot, so a second pass makes the first unobservable and the
    /// two workers write the same tile files.
    mod one_pass_at_a_time {
        use super::*;
        use crate::test_globals::serial_global_state;

        #[test]
        fn a_second_pass_is_refused_while_one_runs() {
            let _serial = serial_global_state();
            let held = TilePassGuard::claim().expect("the slot was free");

            assert!(
                TilePassGuard::claim().is_none(),
                "a second pass was started beside the first"
            );

            drop(held);
            assert!(
                TilePassGuard::claim().is_some(),
                "the slot did not come back when the pass ended"
            );
        }

        #[test]
        fn a_panicking_pass_releases_the_slot() {
            let _serial = serial_global_state();
            let claimed = TilePassGuard::claim().expect("the slot was free");
            let pass = std::thread::spawn(move || {
                let _held = claimed;
                panic!("background_generate_tiles");
            });
            assert!(pass.join().is_err(), "the pass panicked");

            assert!(
                TilePassGuard::claim().is_some(),
                "a panicked pass left tiles unstartable for the process"
            );
        }
    }
}
