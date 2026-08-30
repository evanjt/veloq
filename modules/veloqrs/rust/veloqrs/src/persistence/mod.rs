//! # Persistent Route Engine
//!
//! Memory-efficient route engine that stores data in SQLite with tiered loading.
//!
//! ## Memory Tiers
//!
//! 1. **Always loaded** (~80KB for 1000 activities):
//!    - Activity IDs, sport types, bounds
//!    - In-memory R-tree spatial index
//!
//! 2. **LRU cached** (~2MB max):
//!    - Route signatures (200 entry cache)
//!    - Consensus routes (50 entry cache)
//!
//! 3. **On-demand** (0 memory baseline):
//!    - Full GPS tracks (only loaded for section detection)
//!
//! 4. **Persisted results** (~100KB):
//!    - Computed route groups
//!    - Detected sections

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, RwLock};

use crate::sections::SectionSummary;
use crate::{
    ActivityMatchInfo, ActivityMetrics, Bounds, FrequentSection, GpsPoint, MatchConfig, RouteGroup,
    RouteSignature, SectionConfig, SectionEvidenceCache, SectionPerformanceResult,
};
use lru::LruCache;
use once_cell::sync::Lazy;
use rstar::{AABB, RTree, RTreeObject};
use rusqlite::{Connection, Result as SqlResult};

mod activities;
pub use activities::{
    ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNAVAILABLE, ELEVATION_STATE_UNKNOWN,
    ElevationStateCounts,
};
/// On-disk blob format. Public so diagnostics that open a database file
/// directly decode it the same way the engine wrote it.
pub mod codec;
pub mod cutover;
pub(crate) mod export;
mod fitness;
mod indicators;
pub(crate) mod records;
mod route_identity;
mod routes;
mod schema;
mod screens;
pub mod sections;
pub use sections::conditioning::{DetectionSuspendGuard, detection_suspended, suspend_detection};
pub mod settings;
pub use settings::settings_keys;
pub mod bodies;
mod strength;
pub use strength::FitOutcome;
mod tiles;
pub mod wellness;

// ============================================================================
// Name Translation Support
// ============================================================================

/// Translations for auto-generated route/section names.
/// Set by TypeScript with i18n values.
pub(crate) struct NameTranslations {
    pub(crate) route_word: String,
    pub(crate) section_word: String,
}

impl Default for NameTranslations {
    fn default() -> Self {
        Self {
            route_word: "Route".to_string(),
            section_word: "Section".to_string(),
        }
    }
}

/// Global storage for name translations, set from TypeScript.
pub(crate) static NAME_TRANSLATIONS: Lazy<RwLock<NameTranslations>> =
    Lazy::new(|| RwLock::new(NameTranslations::default()));

/// Get the current route word for name generation.
fn get_route_word() -> String {
    NAME_TRANSLATIONS
        .read()
        .map(|t| t.route_word.clone())
        .unwrap_or_else(|_| "Route".to_string())
}

/// Get the current section word for name generation.
fn get_section_word() -> String {
    NAME_TRANSLATIONS
        .read()
        .map(|t| t.section_word.clone())
        .unwrap_or_else(|_| "Section".to_string())
}

/// Great-circle distance in metres, over geo's IUGG mean earth radius.
pub(crate) fn haversine_distance_meters(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    use geo::{Distance, Haversine, Point};
    Haversine::distance(Point::new(lng1, lat1), Point::new(lng2, lat2))
}

fn bounds_center_distance_meters(
    bounds: Option<&crate::FfiBounds>,
    user_lat: f64,
    user_lng: f64,
) -> f64 {
    let Some(bounds) = bounds else {
        return f64::INFINITY;
    };

    let center_lat = (bounds.min_lat + bounds.max_lat) / 2.0;
    let center_lng = (bounds.min_lng + bounds.max_lng) / 2.0;

    haversine_distance_meters(user_lat, user_lng, center_lat, center_lng)
}

#[derive(Debug, Clone)]
pub struct ActivityMetadata {
    pub id: String,
    pub sport_type: String,
    pub bounds: Bounds,
}

/// Bounds wrapper for R-tree spatial indexing.
#[derive(Debug, Clone)]
pub struct ActivityBoundsEntry {
    pub activity_id: String,
    pub bounds: Bounds,
}

impl RTreeObject for ActivityBoundsEntry {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            [self.bounds.min_lng, self.bounds.min_lat],
            [self.bounds.max_lng, self.bounds.max_lat],
        )
    }
}

/// Lightweight group metadata for list views.
/// Used to avoid loading full group data with activity ID arrays when only summary info is needed.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, uniffi::Record)]
pub struct GroupSummary {
    /// Unique group ID
    pub group_id: String,
    /// Representative activity ID
    pub representative_id: String,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// Number of activities in this group
    pub activity_count: u32,
    /// Custom name (user-defined, None if not set)
    pub custom_name: Option<String>,
    /// Bounding box for map display
    pub bounds: Option<crate::FfiBounds>,
    /// All sport types present in this group's activities
    pub sport_types: Vec<String>,
}

/// Complete activity data for map display.
/// Contains both spatial bounds and metadata for filtering and display.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, uniffi::Record)]
pub struct MapActivityComplete {
    /// Activity ID
    pub activity_id: String,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// Bounding box for map display
    pub bounds: crate::FfiBounds,
    /// Start date as Unix timestamp (seconds since epoch)
    pub date: i64,
    /// Activity name
    pub name: String,
    /// Total distance in meters
    pub distance: f64,
    /// Total duration in seconds (moving time)
    pub duration: u32,
}

/// Progress state for section detection, shared between threads.

#[derive(Debug, Clone)]
pub struct SectionDetectionProgress {
    /// Current phase: "loading", "analyzing", "building_rtrees",
    /// "finding_overlaps", "clustering", "postprocessing", "saving",
    /// "complete"
    pub phase: Arc<std::sync::Mutex<String>>,
    /// Number of items completed in current phase
    pub completed: Arc<AtomicU32>,
    /// Total items in current phase
    pub total: Arc<AtomicU32>,
}

impl SectionDetectionProgress {
    pub fn new() -> Self {
        Self {
            phase: Arc::new(std::sync::Mutex::new("loading".to_string())),
            completed: Arc::new(AtomicU32::new(0)),
            total: Arc::new(AtomicU32::new(0)),
        }
    }

    pub fn set_phase(&self, phase: &str, total: u32) {
        *self.phase.lock().unwrap_or_else(|e| e.into_inner()) = phase.to_string();
        self.completed.store(0, Ordering::SeqCst);
        self.total.store(total, Ordering::SeqCst);
    }

    pub fn increment(&self) {
        self.completed.fetch_add(1, Ordering::SeqCst);
    }

    pub fn get_phase(&self) -> String {
        self.phase.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn get_completed(&self) -> u32 {
        self.completed.load(Ordering::SeqCst)
    }

    pub fn get_total(&self) -> u32 {
        self.total.load(Ordering::SeqCst)
    }

    /// Phase-weighted overall percent (0–100).
    ///
    /// Weights are tuned to wall-clock shares so the progress bar advances
    /// roughly linearly. `finding_overlaps` dominates at ~55%.
    pub fn get_percent(&self) -> u32 {
        let phase = self.get_phase();
        let completed = self.get_completed();
        let total = self.get_total();
        let fraction = if total > 0 {
            (completed as f64 / total as f64).min(1.0)
        } else {
            0.0
        };

        let (accumulated, weight) = match phase.as_str() {
            "loading" => (0.0, 0.04),
            "analyzing" => (0.04, 0.01),
            "building_rtrees" => (0.05, 0.10),
            "finding_overlaps" => (0.15, 0.55),
            "clustering" => (0.70, 0.05),
            "postprocessing" => (0.75, 0.10),
            "saving" => (0.85, 0.08),
            "recomputing_indicators" => (0.93, 0.04),
            "complete" => (1.0, 0.0),
            _ => return 50,
        };
        let pct = (accumulated + weight * fraction) * 100.0;
        (pct.round() as u32).min(100)
    }
}

impl tracematch::DetectionProgressCallback for SectionDetectionProgress {
    fn on_phase(&self, phase: tracematch::DetectionPhase, total: u32) {
        self.set_phase(phase.as_str(), total);
    }

    fn on_progress(&self) {
        self.increment();
    }
}

impl Default for SectionDetectionProgress {
    fn default() -> Self {
        Self::new()
    }
}

/// The Unified detector's evidence cache after a fold, plus the id set it now
/// reflects. Carried out-of-band from the section result so the legacy
/// detectors need no channel change. The cache-aware apply stores it on the
/// engine only after `apply_sections` succeeds, so the cache can never get
/// ahead of the applied catalogue.
pub struct CacheUpdate {
    /// The per-(sport, cluster) evidence after routing this fold's new
    /// activities. Becomes the engine's `section_evidence_cache` on success.
    pub cache: SectionEvidenceCache,
    /// The activity ids the cache now folds, an engine-side shadow of the
    /// cache's per-cluster membership (tracematch does not expose it). Becomes
    /// `cache_folded_ids` on success and drives the next detect's new-id set.
    pub folded_ids: HashSet<String>,
    /// A mid-fold snapshot (memos and grids stripped, dirty clusters
    /// marked), persisted while the run is polled so a killed run resumes
    /// from it. Never applied as a result.
    pub checkpoint: bool,
    /// Boundary records of the clusters this detect recomputed. A fork
    /// record names the activities its branch collected, which the ledger
    /// attaches to a change at that join as what was around it.
    pub boundaries: Vec<tracematch::BoundaryRecord>,
}

/// Handle for background section detection.

pub struct SectionDetectionHandle {
    receiver: mpsc::Receiver<(Vec<FrequentSection>, Vec<String>)>,
    /// The final cache update, when a checkpoint drain met it first.
    final_update: std::sync::Mutex<Option<CacheUpdate>>,
    /// Out-of-band channel for the Unified detector's evidence-cache update.
    /// The worker sends this BEFORE the section result on `receiver`, so a
    /// `Ready`/`recv` on the main channel guarantees the cache is already
    /// available to `take_cache`. The legacy detectors and the no-new-activities
    /// short-circuit never send here, so `take_cache` returns None and the
    /// caller leaves the engine cache untouched.
    cache_receiver: mpsc::Receiver<CacheUpdate>,
    /// Shared progress state
    pub progress: SectionDetectionProgress,
}

/// Non-blocking poll result that distinguishes a still-running worker from
/// one that died without sending (panic, early abort). Collapsing the two
/// into "running" leaves the handle installed forever: no new detection can
/// start and sections/routes silently stop updating for the whole session.
pub enum WorkerPoll<T> {
    Ready(T),
    Running,
    Died,
}

impl SectionDetectionHandle {
    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_state(&self) -> WorkerPoll<(Vec<FrequentSection>, Vec<String>)> {
        match self.receiver.try_recv() {
            Ok(v) => WorkerPoll::Ready(v),
            Err(mpsc::TryRecvError::Empty) => WorkerPoll::Running,
            Err(mpsc::TryRecvError::Disconnected) => WorkerPoll::Died,
        }
    }

    /// Get current progress.
    pub fn get_progress(&self) -> (String, u32, u32) {
        (
            self.progress.get_phase(),
            self.progress.get_completed(),
            self.progress.get_total(),
        )
    }

    /// Wait for detection to complete (blocking).
    pub fn recv(self) -> Option<(Vec<FrequentSection>, Vec<String>)> {
        self.receiver.recv().ok()
    }

    /// Take the Unified detector's evidence-cache update, if any. Only the
    /// Unified path sends one; the legacy detectors and the short-circuit do
    /// not, so this returns None and the caller leaves the engine cache as-is.
    /// Call only after the main result is `Ready`/recv'd, the worker sends the
    /// cache first, so by then it is present.
    pub fn take_cache(&self) -> Option<CacheUpdate> {
        if let Some(u) = self
            .final_update
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            return Some(u);
        }
        while let Ok(u) = self.cache_receiver.try_recv() {
            if !u.checkpoint {
                return Some(u);
            }
        }
        None
    }

    /// The newest checkpoint the worker has sent since the last drain, or
    /// None. A final update met on the way is kept for [`take_cache`].
    pub fn take_checkpoint(&self) -> Option<CacheUpdate> {
        let mut latest = None;
        while let Ok(u) = self.cache_receiver.try_recv() {
            if u.checkpoint {
                latest = Some(u);
            } else {
                *self.final_update.lock().unwrap_or_else(|e| e.into_inner()) = Some(u);
                break;
            }
        }
        latest
    }

    /// Block for the section result AND collect the evidence-cache update in one
    /// call (the cutover and harness path; the background poller uses
    /// `poll_state` + `take_cache`). `recv()` blocks until the worker has sent
    /// the main result, which it does AFTER the cache, so by then every update
    /// the run produced is already queued.
    ///
    /// The worker sends the authoritative update LAST, behind any number of
    /// throttled mid-fold checkpoints, so a single `try_recv` would hand back
    /// the FIRST checkpoint: clusters still dirty, `leaves` stripped, and
    /// `folded_ids` already claiming the whole pool. Adopting that as final
    /// makes the next detect compute `pool - folded = {}` and reload the whole
    /// pool anyway, and loses every fork attribution, since a checkpoint
    /// carries no `boundaries`. So drain to the first non-checkpoint update,
    /// and fall back to the newest checkpoint only when the run ended without
    /// one.
    pub fn recv_with_cache(
        self,
    ) -> (
        Option<(Vec<FrequentSection>, Vec<String>)>,
        Option<CacheUpdate>,
    ) {
        let main = self.receiver.recv().ok();
        let stashed = self
            .final_update
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        let cache = stashed.or_else(|| {
            let mut newest_checkpoint = None;
            loop {
                match self.cache_receiver.try_recv() {
                    Ok(u) if u.checkpoint => newest_checkpoint = Some(u),
                    Ok(u) => return Some(u),
                    Err(_) => return newest_checkpoint,
                }
            }
        });
        (main, cache)
    }
}

/// Handle for background heatmap tile generation with progress tracking.
pub struct TileGenerationHandle {
    receiver: mpsc::Receiver<u32>,
    /// Number of tiles generated so far (updated atomically by background thread)
    pub generated: Arc<AtomicU32>,
    /// Total tiles to process
    pub total: Arc<AtomicU32>,
}

impl TileGenerationHandle {
    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_state(&self) -> WorkerPoll<u32> {
        match self.receiver.try_recv() {
            Ok(v) => WorkerPoll::Ready(v),
            Err(mpsc::TryRecvError::Empty) => WorkerPoll::Running,
            Err(mpsc::TryRecvError::Disconnected) => WorkerPoll::Died,
        }
    }

    /// Block until generation completes, returning the tiles-generated count.
    /// Test and bench path; production uses `poll_state()` via the HeatmapManager poll loop.
    pub fn recv_blocking(&self) -> Option<u32> {
        self.receiver.recv().ok()
    }

    /// Get current progress: (generated, total)
    pub fn get_progress(&self) -> (u32, u32) {
        (
            self.generated.load(Ordering::SeqCst),
            self.total.load(Ordering::SeqCst),
        )
    }
}

#[cfg(test)]
mod worker_poll_tests {
    use super::*;

    /// Scenario: the detection worker dies (panic, early abort) without
    /// sending a result. Expected behaviour: poll_state reports Died so the
    /// caller can clear the handle, never Running, which wedged detection
    /// for the rest of the session.
    #[test]
    fn dead_worker_reports_died_not_running() {
        let (tx, rx) = mpsc::channel::<(Vec<FrequentSection>, Vec<String>)>();
        let (_cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        let handle = SectionDetectionHandle {
            receiver: rx,
            final_update: std::sync::Mutex::new(None),
            cache_receiver: cache_rx,
            progress: SectionDetectionProgress::new(),
        };

        assert!(matches!(handle.poll_state(), WorkerPoll::Running));
        drop(tx);
        assert!(matches!(handle.poll_state(), WorkerPoll::Died));
    }

    #[test]
    fn finished_worker_reports_ready_then_died() {
        let (tx, rx) = mpsc::channel::<(Vec<FrequentSection>, Vec<String>)>();
        let (_cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        let handle = SectionDetectionHandle {
            receiver: rx,
            final_update: std::sync::Mutex::new(None),
            cache_receiver: cache_rx,
            progress: SectionDetectionProgress::new(),
        };

        tx.send((Vec::new(), vec!["a1".to_string()])).unwrap();
        drop(tx);
        assert!(matches!(handle.poll_state(), WorkerPoll::Ready(_)));
        // Channel now drained and disconnected; callers clear the handle on
        // Ready so this state is never polled again in production.
        assert!(matches!(handle.poll_state(), WorkerPoll::Died));
    }
}

// ============================================================================
// Helper Functions for Background Threads
// ============================================================================

/// Load route groups from SQLite database.
/// Used by background threads that have their own DB connection.

fn load_groups_from_db(conn: &Connection) -> Vec<RouteGroup> {
    let mut stmt = match conn.prepare(
        "SELECT id, representative_id, activity_ids, sport_type,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                activity_ids_blob
         FROM route_groups",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::warn!(
                "tracematch: [load_groups_from_db] Failed to prepare statement: {:?}",
                e
            );
            return Vec::new();
        }
    };

    let groups: Vec<RouteGroup> = stmt
        .query_map([], |row| {
            let activity_ids: Vec<String> = if let Ok(Some(blob)) = row.get::<_, Option<Vec<u8>>>(8)
            {
                codec::deserialize(&blob).unwrap_or_default()
            } else {
                let json: String = row.get(2)?;
                serde_json::from_str(&json).unwrap_or_default()
            };

            let bounds = match (
                row.get::<_, Option<f64>>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, Option<f64>>(6)?,
                row.get::<_, Option<f64>>(7)?,
            ) {
                (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) => Some(Bounds {
                    min_lat,
                    max_lat,
                    min_lng,
                    max_lng,
                }),
                _ => None,
            };

            Ok(RouteGroup {
                group_id: row.get(0)?,
                representative_id: row.get(1)?,
                activity_ids,
                sport_type: row.get(3)?,
                bounds,
                custom_name: None, // Custom names loaded separately if needed
                best_time: None,
                avg_time: None,
                best_pace: None,
                best_activity_id: None,
            })
        })
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    groups
}

// ============================================================================
// Persistent Route Engine
// ============================================================================

/// Memory-efficient route engine with SQLite persistence.
///
/// Only loads lightweight metadata into memory. Signatures are LRU cached,
/// and GPS tracks are loaded on-demand only when needed for section detection.

pub struct PersistentRouteEngine {
    /// Database connection
    pub(crate) db: Connection,

    /// Database path (for spawning background threads)
    db_path: String,

    /// Tier 1: Always in memory (lightweight ~80 bytes per activity)
    pub(crate) activity_metadata: HashMap<String, ActivityMetadata>,

    /// In-memory R-tree for fast viewport queries
    spatial_index: RTree<ActivityBoundsEntry>,

    /// Tier 2: LRU cached signatures (200 max = ~2MB)
    /// `Arc` avoids cloning the full `RouteSignature` (points vec + metadata)
    /// on every cache hit - callers that only read through a reference pay
    /// nothing, and callers that need ownership clone once instead of twice.
    signature_cache: LruCache<String, Arc<RouteSignature>>,

    /// Tier 2: LRU cached consensus routes (50 max).
    /// `Arc` avoids cloning the full `Vec<GpsPoint>` on every read - cache hits
    /// just bump the refcount and callers either consume a clone of the inner
    /// data or iterate via `&*arc`.
    consensus_cache: LruCache<String, Arc<Vec<GpsPoint>>>,

    /// Tier 2: LRU cached sections for single-item lookups (50 max = ~5MB)
    section_cache: LruCache<String, FrequentSection>,

    /// Tier 2: LRU cached groups for single-item lookups (100 max = ~1MB)
    group_cache: LruCache<String, RouteGroup>,

    /// Cached route groups (loaded from DB). Since B2 their `group_id` is a stable
    /// assign-once id carried by `route_identity`, not the churning Union-Find root.
    groups: Vec<RouteGroup>,

    /// Assign-once route identity registry (B2 step 3). Owns the stable route id
    /// over time and carries it (plus the representative) onto the recomputed
    /// group by member overlap. In-memory pre-B4; reseeded from the DB on open.
    route_identity: route_identity::RouteIdentity,

    /// Per-activity match info: route_id -> Vec<ActivityMatchInfo>
    activity_matches: HashMap<String, Vec<ActivityMatchInfo>>,

    /// Activity metrics for performance calculations
    pub(crate) activity_metrics: HashMap<String, ActivityMetrics>,

    /// Tier 2: LRU cached time streams for section performance calculations
    /// (activity_id -> cumulative times at each GPS point). Bounded so a large
    /// activity history doesn't grow this cache without limit; misses reload
    /// from the `time_streams` SQLite table.
    time_streams: LruCache<String, Vec<u32>>,

    /// Cached sections (loaded from DB). Since B2 this is the identity-stable,
    /// hysteresis-DAMPED visible catalogue the app renders, not the raw detection
    /// batch, `sections::SectionIdentity` remaps ids and debounces churn between
    /// the worker's raw catalogue and this field.
    sections: Vec<FrequentSection>,

    /// Sections a custom section has replaced. They stay in `sections` because
    /// supersession only hides: the ground is still a detection prior, and
    /// dropping it would re-mint it under a new id on the next detect. Held in
    /// memory so the read-lock views can hide them without touching `self.db`.
    superseded_ids: std::collections::HashSet<String>,

    /// Named-corridor resolution: display name per visible section plus the
    /// full corridor listing. A pure function of DB state, refreshed lazily
    /// behind `named_overlay_stamp`, the connection's `total_changes()`
    /// counter at last compute, so any write through this connection
    /// invalidates it and no mutation site needs remembering. Sync-honest
    /// under the engine's `unsafe impl Sync`: the refresh queries `self.db`
    /// and so belongs to the write-lock class like every other db method;
    /// read-lock paths may only read the cached map through the inner lock.
    pub(crate) named_overlay: std::sync::RwLock<sections::NamedOverlay>,
    pub(crate) named_overlay_stamp: std::sync::atomic::AtomicI64,

    /// Assign-once section identity registry + hysteresis debounce (B2). Owns the
    /// stable opaque id over time and damps the non-monotone batch into the
    /// visible `sections` above. In-memory pre-B4; reseeded from the DB on open.
    identity: sections::SectionIdentity,

    /// The last RAW detection catalogue applied, before the identity + hysteresis
    /// remap. `sections` is the DAMPED view the app renders; this is the B1
    /// convergence truth (order-free, tracks the batch every step) the parity
    /// gates compare against. The two DIFFER by design: the damped view can hold a
    /// section a debounced dissolve has not yet retired, so it lags the raw batch
    /// by up to `k` steps. In-memory only. `None` until a detect has applied in
    /// this process: an applied EMPTY batch is a known answer, not an absence,
    /// so the two must stay distinguishable.
    raw_sections: Option<Vec<FrequentSection>>,

    /// Activities that have been through section detection (persisted in SQLite)
    processed_activity_ids: HashSet<String>,

    /// In-memory per-(sport, cluster) evidence for the Unified incremental
    /// detector. Holds each cluster's last catalogue so a sync recomputes only
    /// the cluster(s) a new activity touches (O(touched-cluster), not O(pool)).
    /// Persisted in `evidence_cache` beside the config digest it was folded
    /// under, so a restart resumes warm; an unreadable or stale row leaves the
    /// engine cold, which is what every engine did before the row existed.
    /// Only the Unified detection path reads or writes it; the legacy detectors
    /// never touch it. Moves in lockstep with `cache_folded_ids`.
    section_evidence_cache: SectionEvidenceCache,
    /// The boundary records of the detect being applied, held only for the
    /// duration of one apply so the event emitter can read them.
    fork_records: Vec<tracematch::BoundaryRecord>,

    /// The activity ids `section_evidence_cache` has folded, an engine-side
    /// shadow of the cache's per-cluster membership (tracematch does not expose
    /// it). Drives which ids a detect routes as "new": `pool − cache_folded_ids`.
    /// Empty ⇒ the cache is cold ⇒ the next detect cold-rebatches every cluster.
    /// Cleared together with the cache at every invalidation point so the two can
    /// never disagree, and persisted in the same row for the same reason.
    cache_folded_ids: HashSet<String>,

    /// A `clear_processed_activity_ids` whose DELETE failed, usually a
    /// `SQLITE_BUSY` outliving the 5 s timeout. The config that provoked the
    /// clear is already persisted, so the processed set now disagrees with the
    /// base detection would re-derive under. The next detect retries the clear
    /// before it reads the set.
    pending_processed_clear: bool,

    /// Dirty tracking
    pub(crate) groups_dirty: bool,
    sections_dirty: bool,

    /// Configuration
    pub(crate) match_config: MatchConfig,
    pub(crate) section_config: SectionConfig,

    /// Path for heatmap tile output (set from JS at init)
    pub(crate) heatmap_tiles_path: Option<String>,

    /// Small LRU cache for get_section_performances, keyed by section id (+ sport
    /// filter). A section detail load calls it twice for the same section (buckets
    /// + calendar); navigating between a handful of sections keeps them all warm
    /// where the old single entry evicted on every hop.
    perf_cache: LruCache<String, SectionPerformanceResult>,
}

impl PersistentRouteEngine {
    /// Invalidate the performance cache.
    /// Call after any mutation that affects sections, time streams, or activity metrics.
    pub(crate) fn invalidate_perf_cache(&mut self) {
        self.perf_cache.clear();
    }

    /// Drop the Unified evidence cache (and its folded-id shadow) so the next
    /// detect cold-rebatches every cluster from the current DB state. Called at
    /// every point the detection base changes out from under the cache: config
    /// change, activity mutation/removal, and the section-clearing paths. The
    /// cache holds no queryable member ids and cannot surgically drop one
    /// activity's cluster, so any such change clears the whole cache; the next
    /// detect rebuilds it from the real pool. Clearing the two fields together
    /// is what stops the cache from ever disagreeing with the applied catalogue.
    /// How many activity ids the evidence cache has folded. Zero means the
    /// next detect cold-rebatches every cluster. Exposed so a test can tell a
    /// warm restart from a cold one without timing it.
    #[doc(hidden)]
    pub fn evidence_cache_folded_count(&self) -> usize {
        self.cache_folded_ids.len()
    }

    pub(crate) fn invalidate_evidence_cache(&mut self) {
        self.section_evidence_cache = SectionEvidenceCache::new();
        self.cache_folded_ids.clear();
        self.clear_persisted_evidence_cache();
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    /// Create a new persistent engine with the given database path.
    pub fn new(db_path: &str) -> SqlResult<Self> {
        let mut db = Connection::open(db_path)?;
        // Background threads (detection, backfill, tiles) open their own
        // connections. Without a busy timeout their writes make this
        // connection's queries fail SQLITE_BUSY immediately, which surfaces
        // as intermittent empty reads in the app during sync.
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        Self::init_schema(&mut db)?;

        Ok(Self {
            db,
            db_path: db_path.to_string(),
            activity_metadata: HashMap::new(),
            spatial_index: RTree::new(),
            signature_cache: LruCache::new(std::num::NonZeroUsize::new(200).unwrap()),
            consensus_cache: LruCache::new(std::num::NonZeroUsize::new(50).unwrap()),
            section_cache: LruCache::new(std::num::NonZeroUsize::new(50).unwrap()),
            group_cache: LruCache::new(std::num::NonZeroUsize::new(100).unwrap()),
            groups: Vec::new(),
            route_identity: route_identity::RouteIdentity::default(),
            activity_matches: HashMap::new(),
            activity_metrics: HashMap::new(),
            time_streams: LruCache::new(std::num::NonZeroUsize::new(200).unwrap()),
            sections: Vec::new(),
            superseded_ids: HashSet::new(),
            named_overlay: std::sync::RwLock::new(sections::NamedOverlay::default()),
            named_overlay_stamp: std::sync::atomic::AtomicI64::new(-1),
            identity: sections::SectionIdentity::default(),
            raw_sections: None,
            processed_activity_ids: HashSet::new(),
            section_evidence_cache: SectionEvidenceCache::new(),
            fork_records: Vec::new(),
            cache_folded_ids: HashSet::new(),
            pending_processed_clear: false,
            groups_dirty: false,
            sections_dirty: false,
            match_config: MatchConfig::default(),
            section_config: SectionConfig::default(),
            heatmap_tiles_path: None,
            perf_cache: LruCache::new(std::num::NonZeroUsize::new(8).unwrap()),
        })
    }

    /// Create an in-memory database (for testing).
    pub fn in_memory() -> SqlResult<Self> {
        Self::new(":memory:")
    }

    /// Load all metadata and groups from the database.
    ///
    /// Each loader runs independently: one failing (a bad row, a transient
    /// SQLITE_BUSY) must not abort the rest, or the engine comes up with an
    /// arbitrarily truncated view of the data. Corruption errors propagate
    /// so the caller can quarantine the file.
    pub fn load(&mut self) -> SqlResult<()> {
        let outcomes = [
            ("metadata", self.load_metadata()),
            ("groups", self.load_groups()),
            ("sections", self.load_sections()),
            ("processed_activity_ids", self.load_processed_activity_ids()),
            ("activity_metrics", self.load_activity_metrics()),
            (
                "match_strictness",
                self.load_match_strictness_from_settings(),
            ),
            ("section_config", self.load_section_config_from_settings()),
        ];
        let mut first_error: Option<rusqlite::Error> = None;
        for (name, result) in outcomes {
            if let Err(e) = result {
                log::error!(
                    "tracematch: [PersistentEngine] load: {} failed: {}",
                    name,
                    e
                );
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
        }
        let loaded_whole = first_error.is_none();
        if let Some(e) = first_error {
            if is_corruption_error(&e) {
                return Err(e);
            }
        }

        // Adopt the evidence cache the last apply left behind, so a restart
        // does not cold-rebatch the whole pool to reach the catalogue already
        // in SQLite. Runs after `section_config` load: the row is keyed by the
        // config digest and is a miss under any other config.
        if loaded_whole {
            self.restore_evidence_cache();
        }

        // Read the cutover token and set the pending flag. Nothing slow.
        self.check_cutover_state();

        // B2: seed the identity registry from the sections just loaded so an
        // existing install adopts its current ids as stable seeds. The evidence
        // cache stays cold (the next detect cold-rebatches), but identity is
        // preserved: a resync carries the seeded ids onto their surviving ground
        // rather than re-deriving them. Must run after both `sections` and
        // `metadata` load so it sees the managed catalogue and the activity set.
        // B4: prefer the persisted registry blob (exact debounce + tombstone
        // state) and fall back to reseeding from the DB rows for a fresh or
        // pre-B4 install.
        // A reseed off a truncated `sections` (a loader error this function
        // deliberately continues past) stays in memory, so the next open reseeds
        // from the whole catalogue instead of restoring the truncation.
        if !self.section_identity_restore() {
            self.section_identity_reseed();
            if loaded_whole {
                self.section_identity_persist();
            }
        }

        // B2 step 3 + B4: same for routes, restore the persisted registry
        // (mint counter + seniority), else adopt the loaded group_ids as stable
        // seeds. Must run after `groups` load.
        if !self.route_identity_restore() {
            self.route_identity_reseed();
        }

        // Backfill activities.duration_secs from activity_metrics.moving_time.
        // Route highlights need duration_secs to compute trends/PRs, but it was
        // historically not populated. This ensures it's always available at startup.
        let backfilled = self
            .db
            .execute(
                "UPDATE activities SET duration_secs = (
                SELECT moving_time FROM activity_metrics
                WHERE activity_metrics.activity_id = activities.id
            )
            WHERE duration_secs IS NULL
              AND EXISTS (
                SELECT 1 FROM activity_metrics
                WHERE activity_metrics.activity_id = activities.id
              )",
                [],
            )
            .unwrap_or(0);
        if backfilled > 0 {
            log::info!(
                "tracematch: [PersistentEngine] Backfilled duration_secs for {} activities",
                backfilled
            );
        }

        // If activities exist but none are marked as processed (migration cleared the table),
        // mark sections as dirty so re-detection runs with the updated algorithm.
        if !self.activity_metadata.is_empty() && self.processed_activity_ids.is_empty() {
            log::info!(
                "tracematch: [PersistentEngine] {} activities but no processed IDs - marking sections dirty for re-detection",
                self.activity_metadata.len()
            );
            self.sections_dirty = true;
        }

        // Warm the named-corridor overlay so read-lock listings (which may not
        // refresh it themselves) start correct rather than empty. One EXISTS
        // probe when no names exist.
        self.ensure_named_overlay();

        // Indicator population is handled lazily via version check in get_activity_indicators().
        // No need to populate here - first read triggers recompute if version mismatches.

        Ok(())
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /// Read-only access to the active `match_config.min_match_percentage`.
    /// Exposed so integration tests can verify persisted strictness without
    /// needing crate-private access to the whole `MatchConfig`.
    pub fn match_config_min_match_percentage(&self) -> f64 {
        self.match_config.min_match_percentage
    }

    /// Read-only access to the active `match_config.endpoint_threshold`.
    pub fn match_config_endpoint_threshold(&self) -> f64 {
        self.match_config.endpoint_threshold
    }

    /// Read-only accessors for `section_config` fields. Mirror the
    /// MatchConfig getters above so integration tests can verify
    /// persisted SectionConfig without crate-private access.
    pub fn get_section_config(&self) -> SectionConfig {
        self.section_config.clone()
    }

    pub fn section_config_proximity_threshold(&self) -> f64 {
        self.section_config.proximity_threshold
    }
    pub fn section_config_min_section_length(&self) -> f64 {
        self.section_config.min_section_length
    }
    pub fn section_config_min_activities(&self) -> u32 {
        self.section_config.min_activities
    }

    /// Set section configuration.
    pub fn set_section_config(&mut self, config: SectionConfig) {
        // A config identical to the active one is a NO-OP. The TS init path
        // re-sends the persisted config on every launch (GlobalDataSync applies
        // the strictness preset whenever detectionStrictness != 60), so without
        // this guard every launch would clear the processed set and force a full
        // re-detect for any user who has ever moved the strictness slider. Only a
        // GENUINE change runs the re-analysis tail below. Equality is exact, but
        // the config round-trips through the settings table as the same f64/u32
        // strings, so a re-sent config compares equal.
        if config == self.section_config {
            return;
        }

        // Persist the user's chosen detection params alongside MatchConfig
        // strictness so a fresh engine load reflects the same choices without
        // a TS round-trip. set_setting errors are logged but not propagated:
        // in-memory state is still updated, and the strictness loader's
        // missing-keys fallback handles any failure.
        if let Err(e) = self.set_setting(
            settings_keys::SECTION_PROXIMITY_THRESHOLD,
            &config.proximity_threshold.to_string(),
        ) {
            log::warn!(
                "tracematch: [set_section_config] failed to persist proximity_threshold: {}",
                e
            );
        }
        if let Err(e) = self.set_setting(
            settings_keys::SECTION_MIN_LENGTH,
            &config.min_section_length.to_string(),
        ) {
            log::warn!(
                "tracematch: [set_section_config] failed to persist min_section_length: {}",
                e
            );
        }
        if let Err(e) = self.set_setting(
            settings_keys::SECTION_MIN_ACTIVITIES,
            &config.min_activities.to_string(),
        ) {
            log::warn!(
                "tracematch: [set_section_config] failed to persist min_activities: {}",
                e
            );
        }
        // Persist the WHOLE config so a restart restores every field, not just the
        // four slider keys above. This is what makes the TS launch re-apply a true
        // no-op (see the SECTION_CONFIG_JSON key doc); the loader prefers it.
        match serde_json::to_string(&config) {
            Ok(json) => {
                if let Err(e) = self.set_setting(settings_keys::SECTION_CONFIG_JSON, &json) {
                    log::warn!(
                        "tracematch: [set_section_config] failed to persist config blob: {}",
                        e
                    );
                }
            }
            Err(e) => log::warn!(
                "tracematch: [set_section_config] failed to serialise config blob: {}",
                e
            ),
        }

        self.section_config = config;
        // R6 freshness: a config change alters what detection would find, so the
        // whole library must be re-analysed. The processed set is insert-only and
        // would otherwise short-circuit the next detect on the seen activities;
        // clearing it forces a full re-detect under the new config.
        self.clear_processed_activity_ids();
        self.sections_dirty = true;
        // A config change invalidates the debounce, not the identities: the
        // registry is rebuilt from the catalogue so ids carry, and the next fold
        // applies the new params' answer in one step.
        self.section_identity_reseed_decisive();
    }

    // ========================================================================
    // Debug Utilities
    // ========================================================================

    /// Clone an activity N times for scale testing.
    /// Copies activity metadata and metrics with synthetic IDs.
    /// Copies all section_activities entries for the source activity.
    /// Does NOT copy GPS tracks (saves memory).
    /// Returns the number of clones created.
    pub fn debug_clone_activity(&mut self, source_id: &str, count: u32) -> u32 {
        let mut created = 0u32;

        // Check source exists in metadata
        let source_meta = match self.activity_metadata.get(source_id) {
            Some(m) => m.clone(),
            None => return 0,
        };

        // Get source metrics if available
        let source_metrics = self.activity_metrics.get(source_id).cloned();

        // Get section_activities entries for source
        let section_entries: Vec<(String, String, i32, i32, f64, Option<f64>, Option<f64>)> = self
            .db
            .prepare(
                "SELECT section_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace
                 FROM section_activities WHERE activity_id = ?",
            )
            .and_then(|mut stmt| {
                stmt.query_map([source_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i32>(2)?,
                        row.get::<_, i32>(3)?,
                        row.get::<_, f64>(4)?,
                        row.get::<_, Option<f64>>(5)?,
                        row.get::<_, Option<f64>>(6)?,
                    ))
                })
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_else(|e| {
                log::warn!("tracematch: debug_clone_activity section query failed: {e:?}");
                Vec::new()
            });

        // Use epoch millis to ensure unique IDs across invocations
        let batch_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);

        for n in 0..count {
            let clone_id = format!("{}_clone_{}_{}", source_id, batch_ts, n);

            // Skip if clone already exists
            if self.activity_metadata.contains_key(&clone_id) {
                continue;
            }

            // Insert activity record; without it the clone doesn't exist, so
            // skip the dependent inserts rather than counting a phantom clone.
            if let Err(e) = self.db.execute(
                "INSERT OR IGNORE INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES (?, ?, ?, ?, ?, ?)",
                rusqlite::params![
                    clone_id,
                    source_meta.sport_type,
                    source_meta.bounds.min_lat,
                    source_meta.bounds.max_lat,
                    source_meta.bounds.min_lng,
                    source_meta.bounds.max_lng,
                ],
            ) {
                log::warn!("tracematch: debug_clone_activity activity insert failed: {e:?}");
                continue;
            }

            // Insert activity metrics if available
            if let Some(ref metrics) = source_metrics {
                if let Err(e) = self.db.execute(
                    "INSERT OR IGNORE INTO activity_metrics
                     (activity_id, name, date, distance, moving_time, elapsed_time,
                      elevation_gain, avg_hr, avg_power, sport_type)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    rusqlite::params![
                        clone_id,
                        metrics.name,
                        metrics.date,
                        metrics.distance,
                        metrics.moving_time,
                        metrics.elapsed_time,
                        metrics.elevation_gain,
                        metrics.avg_hr,
                        metrics.avg_power,
                        metrics.sport_type,
                    ],
                ) {
                    log::warn!("tracematch: debug_clone_activity metrics insert failed: {e:?}");
                }

                // Add to in-memory metrics
                let mut clone_metrics = metrics.clone();
                clone_metrics.activity_id = clone_id.clone();
                self.activity_metrics
                    .insert(clone_id.clone(), clone_metrics);
            }

            // Copy section_activities entries including cached performance
            for (section_id, direction, start_idx, end_idx, distance, lap_time, lap_pace) in
                &section_entries
            {
                if let Err(e) = self.db.execute(
                    "INSERT OR IGNORE INTO section_activities
                     (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    rusqlite::params![
                        section_id,
                        clone_id,
                        direction,
                        start_idx,
                        end_idx,
                        distance,
                        lap_time,
                        lap_pace
                    ],
                ) {
                    log::warn!("tracematch: debug_clone_activity section insert failed: {e:?}");
                }
            }

            // Add to in-memory metadata
            self.activity_metadata.insert(
                clone_id.clone(),
                ActivityMetadata {
                    id: clone_id,
                    sport_type: source_meta.sport_type.clone(),
                    bounds: source_meta.bounds,
                },
            );

            created += 1;
        }

        // Rebuild spatial index if we added any clones
        if created > 0 {
            let entries: Vec<ActivityBoundsEntry> = self
                .activity_metadata
                .values()
                .map(|m| ActivityBoundsEntry {
                    activity_id: m.id.clone(),
                    bounds: m.bounds,
                })
                .collect();
            self.spatial_index = rstar::RTree::bulk_load(entries);
        }

        created
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    /// Get engine statistics.
    pub fn stats(&self) -> PersistentEngineStats {
        // Count GPS tracks in database
        let gps_track_count: u32 = self
            .db
            .query_row("SELECT COUNT(*) FROM gps_tracks", [], |row| row.get(0))
            .unwrap_or(0);

        // Get oldest and newest activity dates from activity_metrics table (always has dates)
        let (oldest_date, newest_date): (Option<i64>, Option<i64>) = self
            .db
            .query_row(
                "SELECT MIN(date), MAX(date) FROM activity_metrics",
                [],
                |row| Ok((row.get(0).ok(), row.get(1).ok())),
            )
            .unwrap_or((None, None));

        PersistentEngineStats {
            activity_count: self.activity_metadata.len() as u32,
            signature_cache_size: self.signature_cache.len() as u32,
            consensus_cache_size: self.consensus_cache.len() as u32,
            group_count: self.groups.len() as u32,
            section_count: self.sections.len() as u32,
            groups_dirty: self.groups_dirty,
            sections_dirty: self.sections_dirty,
            gps_track_count,
            oldest_date,
            newest_date,
        }
    }

    /// Get all data needed by the Routes screen in a single call.
    /// Returns group summaries with consensus polylines, section summaries with polylines,
    /// and aggregate counts/stats - all in one mutex acquisition.
    /// Supports pagination via limit/offset for both groups and sections.
    pub fn get_routes_screen_data(
        &mut self,
        group_limit: u32,
        group_offset: u32,
        section_limit: u32,
        section_offset: u32,
        min_group_activity_count: u32,
        prioritize_nearest_groups: bool,
        prioritize_nearest_sections: bool,
        user_lat: f64,
        user_lng: f64,
    ) -> crate::FfiRoutesScreenData {
        let has_user_location = user_lat.is_finite() && user_lng.is_finite();

        // Get date range from activity_metrics
        let (oldest_date, newest_date): (Option<i64>, Option<i64>) = self
            .db
            .query_row(
                "SELECT MIN(date), MAX(date) FROM activity_metrics",
                [],
                |row| Ok((row.get(0).ok(), row.get(1).ok())),
            )
            .unwrap_or((None, None));

        // Get group summaries, filter by min activity count, sort by activity_count DESC, apply limit/offset
        let mut raw_summaries = self.get_group_summaries();
        if min_group_activity_count > 0 {
            raw_summaries.retain(|g| g.activity_count >= min_group_activity_count);
        }
        if prioritize_nearest_groups && has_user_location {
            raw_summaries.sort_by(|a, b| {
                let dist_a = bounds_center_distance_meters(a.bounds.as_ref(), user_lat, user_lng);
                let dist_b = bounds_center_distance_meters(b.bounds.as_ref(), user_lat, user_lng);
                dist_a
                    .partial_cmp(&dist_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| b.activity_count.cmp(&a.activity_count))
            });
        } else {
            raw_summaries.sort_by(|a, b| b.activity_count.cmp(&a.activity_count));
        }
        let total_groups = raw_summaries.len();
        let paged_summaries: Vec<_> = raw_summaries
            .into_iter()
            .skip(group_offset as usize)
            .take(group_limit as usize)
            .collect();
        let has_more_groups = total_groups > (group_offset as usize + paged_summaries.len());

        // Batch-load representative polylines from signatures table (1 query instead of N)
        let rep_ids: Vec<&str> = paged_summaries
            .iter()
            .map(|g| g.representative_id.as_str())
            .collect();
        let rep_polylines = self.get_representative_polylines_batch(&rep_ids);

        let groups: Vec<crate::FfiGroupWithPolyline> = paged_summaries
            .into_iter()
            .map(|g| {
                let encoded_polyline = rep_polylines
                    .get(&g.representative_id)
                    .cloned()
                    .unwrap_or_default();
                let distance_meters = self
                    .activity_metrics
                    .get(&g.representative_id)
                    .map(|m| m.distance)
                    .unwrap_or(0.0);
                crate::FfiGroupWithPolyline {
                    group_id: g.group_id,
                    representative_id: g.representative_id,
                    sport_type: g.sport_type,
                    activity_count: g.activity_count,
                    custom_name: g.custom_name,
                    bounds: g.bounds,
                    distance_meters,
                    encoded_polyline,
                    sport_types: g.sport_types,
                }
            })
            .collect();

        // Get section summaries, sort by visit_count DESC, apply limit/offset
        let mut raw_sections = self.get_section_summaries();
        if prioritize_nearest_sections && has_user_location {
            raw_sections.sort_by(|a, b| {
                let dist_a = bounds_center_distance_meters(a.bounds.as_ref(), user_lat, user_lng);
                let dist_b = bounds_center_distance_meters(b.bounds.as_ref(), user_lat, user_lng);
                dist_a
                    .partial_cmp(&dist_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| b.visit_count.cmp(&a.visit_count))
            });
        } else {
            raw_sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));
        }
        let total_sections = raw_sections.len();
        let paged_sections: Vec<_> = raw_sections
            .into_iter()
            .skip(section_offset as usize)
            .take(section_limit as usize)
            .collect();
        let has_more_sections = total_sections > (section_offset as usize + paged_sections.len());

        // Batch-load section polylines (1 query instead of N)
        let section_ids: Vec<&str> = paged_sections.iter().map(|s| s.id.as_str()).collect();
        let section_polylines = self.get_section_polylines_batch(&section_ids);

        let sections: Vec<crate::FfiSectionWithPolyline> = paged_sections
            .into_iter()
            .map(|s| {
                let encoded_polyline = section_polylines.get(&s.id).cloned().unwrap_or_default();
                crate::FfiSectionWithPolyline {
                    id: s.id,
                    name: s.name,
                    sport_type: s.sport_type.clone(),
                    visit_count: s.visit_count,
                    distance_meters: s.distance_meters,
                    activity_count: s.activity_count,
                    confidence: s.confidence,
                    scale: s.scale,
                    bounds: s.bounds,
                    encoded_polyline,
                    sport_types: s.sport_types,
                    is_user_defined: s.is_user_defined,
                    disabled: s.disabled,
                    superseded_by: s.superseded_by,
                    elevation_gain_m: s.elevation_gain_m,
                    elevation_loss_m: s.elevation_loss_m,
                    avg_grade_percent: s.avg_grade_percent,
                    max_grade_percent: s.max_grade_percent,
                    klass: s.klass,
                    is_lift: s.is_lift,
                    rank_score: s.rank_score,
                    sport_rank_score: s.sport_rank_score,
                }
            })
            .collect();

        let activity_count = self.activity_metadata.len() as u32;

        crate::FfiRoutesScreenData {
            activity_count,
            group_count: total_groups as u32,
            section_count: total_sections as u32,
            oldest_date,
            newest_date,
            groups,
            sections,
            has_more_groups,
            has_more_sections,
            groups_dirty: self.groups_dirty,
        }
    }
}

/// Statistics for the persistent engine.

#[derive(Debug, Clone, uniffi::Record)]
pub struct PersistentEngineStats {
    pub activity_count: u32,
    pub signature_cache_size: u32,
    pub consensus_cache_size: u32,
    pub group_count: u32,
    pub section_count: u32,
    pub groups_dirty: bool,
    pub sections_dirty: bool,
    pub gps_track_count: u32,
    /// Oldest activity date (Unix timestamp in seconds), or None if no activities
    pub oldest_date: Option<i64>,
    /// Newest activity date (Unix timestamp in seconds), or None if no activities
    pub newest_date: Option<i64>,
}

// ============================================================================
// Global Singleton for FFI
// ============================================================================

/// Global persistent engine instance.
///
/// This singleton allows FFI calls to access a shared persistent engine
/// without passing state back and forth across the FFI boundary.
///
/// Uses `RwLock` so the common case - read-only queries against in-memory
/// state - can run concurrently across threads. Mutations acquire the write
/// lock and therefore serialise.
///
/// # Safety invariant
///
/// `PersistentRouteEngine` contains a `rusqlite::Connection`, which is
/// `Send + !Sync`. We `unsafe impl Sync` (below) because callers are
/// required to access the connection only through the **write** lock:
/// every FFI method that touches SQLite goes through `with_persistent_engine`
/// / `with_engine` (write), which guarantees exclusive access. The read
/// lock (`with_persistent_engine_read` / `with_engine_read`) is only valid
/// for closures that do not dereference `self.db`; those closures take
/// `&PersistentRouteEngine` but must stay on pure-memory `&self` methods.

pub static PERSISTENT_ENGINE: Lazy<RwLock<Option<PersistentRouteEngine>>> =
    Lazy::new(|| RwLock::new(None));

// SAFETY: see invariant above. All SQLite operations go through the write
// lock, which provides exclusive `&mut` access; read-lock callers only touch
// `&self` methods that don't dereference `self.db`.
unsafe impl Sync for PersistentRouteEngine {}

/// Acquire the **write** lock on the global persistent engine.
///
/// Required for any closure that needs `&mut PersistentRouteEngine` -
/// includes all mutation FFIs (`add_*`, `set_*`, `save_*`, `clear_*`,
/// `apply_*`, `remove_*`, `detect_*`) plus read-looking helpers that
/// mutate LRU caches (`get_signature`, `get_group_by_id`,
/// `get_section_by_id`, `get_consensus_route`, `get_section_performances`,
/// `get_groups`) **and any closure that touches `self.db`** (the read lock
/// is memory-only - see safety invariant above).
pub fn with_persistent_engine<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut PersistentRouteEngine) -> R,
{
    // Poison recovery: builds unwind on panic, and refusing a poisoned lock
    // here would disable the engine for the rest of the session.
    let mut guard = PERSISTENT_ENGINE.write().unwrap_or_else(|e| e.into_inner());
    guard.as_mut().map(f)
}

/// `with_persistent_engine` for async callers, off the async workers.
///
/// The write lock is a blocking `RwLock` and the closure runs SQLite, so taking
/// it directly from an `async fn` parks one of the runtime's worker threads for
/// the whole transaction. There are only eight (`runtime.rs`), and a sync pass
/// takes this lock once per page, so enough concurrent passes starve the pool
/// and unrelated network work stops being polled. `spawn_blocking` moves the
/// wait onto the pool tokio keeps for exactly this.
///
/// The closure is `'static`, so callers hand it owned data rather than a
/// borrow of a local.
pub async fn with_persistent_engine_blocking<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut PersistentRouteEngine) -> R + Send + 'static,
    R: Send + 'static,
{
    match tokio::task::spawn_blocking(move || with_persistent_engine(f)).await {
        Ok(result) => result,
        // The blocking task itself panicked, or the runtime is shutting down.
        // Either way the write did not happen; the caller's other work should
        // not be cancelled with it.
        Err(e) => {
            log::warn!("[Engine] blocking engine call failed: {e}");
            None
        }
    }
}

/// Acquire the **read** lock on the global persistent engine.
///
/// Multiple callers can hold the read lock concurrently. The closure
/// receives `&PersistentRouteEngine`, so any call to a `&mut self` helper
/// fails to compile - that is the point.
///
/// **Safety**: do not call any method that dereferences `self.db` from
/// inside this closure. SQLite access goes through the write lock only.
pub fn with_persistent_engine_read<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&PersistentRouteEngine) -> R,
{
    // Same poison recovery as with_persistent_engine.
    let guard = PERSISTENT_ENGINE.read().unwrap_or_else(|e| e.into_inner());
    guard.as_ref().map(f)
}

/// SQLite error codes that mean the file itself is unusable, as opposed
/// to a transient I/O or logic error.
pub(crate) fn is_corruption_error(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseCorrupt) | Some(rusqlite::ErrorCode::NotADatabase)
    )
}

/// SQLite error codes for failures a later launch can plausibly succeed on
/// (lock contention, a transient open failure). These must not trigger the
/// quarantine failover, which would discard a healthy cache.
pub(crate) fn is_transient_open_error(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy)
            | Some(rusqlite::ErrorCode::DatabaseLocked)
            | Some(rusqlite::ErrorCode::CannotOpen)
    )
}

// ============================================================================
// Internal helpers used by UniFFI Object implementations
// ============================================================================

pub mod persistent_engine_ffi {
    use super::*;
    use log::info;

    /// Guards one-time installation of the Rust panic hook.
    static PANIC_HOOK_INIT: std::sync::Once = std::sync::Once::new();

    /// Install a process-wide panic hook (once) that appends the panic
    /// message + location to `veloq_panic.log` in the DB directory. Under
    /// `panic = "abort"` the process dies before any JS handler runs, so this
    /// file is the only record the JS crash sink (source: 'rust-panic') can
    /// recover on the next launch. Infallible: write errors are ignored.
    fn install_panic_hook(db_path: &str) {
        let log_path = std::path::Path::new(db_path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("veloq_panic.log");

        PANIC_HOOK_INIT.call_once(move || {
            let default_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                use std::io::Write;
                let location = info
                    .location()
                    .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                    .unwrap_or_else(|| "unknown".to_string());
                let message = info.payload().downcast_ref::<&str>().map_or_else(
                    || {
                        info.payload()
                            .downcast_ref::<String>()
                            .cloned()
                            .unwrap_or_else(|| "<non-string panic payload>".to_string())
                    },
                    |s| s.to_string(),
                );
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    let _ = writeln!(file, "panic at {}: {}", location, message);
                }
                default_hook(info);
            }));
        });
    }

    /// Initialize the persistent engine with a database path.
    /// Called by VeloqEngine::create() - not exported via FFI directly.
    pub fn persistent_engine_init(db_path: String) -> bool {
        crate::init_logging();
        install_panic_hook(&db_path);
        info!(
            "tracematch: [PersistentEngine] Initializing with db: {}",
            db_path
        );

        if let Some(parent) = std::path::Path::new(&db_path).parent() {
            if !parent.exists() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    log::error!(
                        "tracematch: [PersistentEngine] Failed to create directory {:?}: {}",
                        parent,
                        e
                    );
                    return false;
                }
                info!(
                    "tracematch: [PersistentEngine] Created parent directory: {:?}",
                    parent
                );
            }
        }

        let mut engine = match PersistentRouteEngine::new(&db_path) {
            Ok(engine) => engine,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to open database '{}': {:?}",
                    db_path,
                    e
                );
                if is_transient_open_error(&e) {
                    // The next launch (or the banner retry) can succeed on the
                    // same file. Quarantining here would discard a healthy
                    // cache over lock contention.
                    return false;
                }
                // Corruption or a deterministic open/migration failure: the
                // same file would fail every launch, bricking the engine
                // permanently. Quarantine and start fresh.
                match reopen_after_quarantine(&db_path) {
                    Some(engine) => engine,
                    None => return false,
                }
            }
        };

        if let Err(e) = engine.load() {
            if is_corruption_error(&e) {
                log::error!(
                    "tracematch: [PersistentEngine] Corruption while loading '{}': {:?}",
                    db_path,
                    e
                );
                // Close the connection before the quarantine rename.
                drop(engine);
                engine = match reopen_after_quarantine(&db_path) {
                    Some(engine) => engine,
                    None => return false,
                };
            } else {
                info!(
                    "tracematch: [PersistentEngine] Warning: Failed to load existing data: {:?}",
                    e
                );
            }
        }

        let mut guard = PERSISTENT_ENGINE.write().unwrap_or_else(|e| e.into_inner());
        *guard = Some(engine);
        info!("tracematch: [PersistentEngine] Initialized successfully");

        true
    }

    /// Move an unusable database aside and open a fresh one in its place.
    ///
    /// The database is a re-derivable cache of intervals.icu data. A file
    /// that cannot be opened or migrated would otherwise brick every
    /// engine-backed feature on every launch, permanently. Renaming it aside
    /// loses only the cache, which the next sync repopulates. The quarantined
    /// copy is kept (one generation) for post-mortem inspection.
    fn reopen_after_quarantine(db_path: &str) -> Option<PersistentRouteEngine> {
        let path = std::path::Path::new(db_path);
        if !path.exists() {
            // Environmental failure (permissions, missing dir). Nothing to
            // quarantine, and a fresh open would fail the same way.
            return None;
        }

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        // Drop older quarantine generations so the data dir cannot grow
        // unbounded across repeated corruption events.
        if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
            let prefix = format!("{}.corrupt-", name.to_string_lossy());
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    if entry.file_name().to_string_lossy().starts_with(&prefix) {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }

        for suffix in ["", "-wal", "-shm"] {
            let src = format!("{}{}", db_path, suffix);
            if !std::path::Path::new(&src).exists() {
                continue;
            }
            let dst = format!("{}.corrupt-{}{}", db_path, ts, suffix);
            match std::fs::rename(&src, &dst) {
                Ok(()) => {}
                // SQLite deletes a stale wal/shm itself when a concurrent
                // connection opens the corrupt file; a sibling that vanished
                // between the exists check and the rename is already gone
                // from the live namespace, which is all quarantine needs.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    // A sibling we can neither move nor remove would sit
                    // beside the fresh database, so removal is the fallback;
                    // only when both fail is the failover abandoned.
                    if suffix.is_empty() || std::fs::remove_file(&src).is_err() {
                        log::error!(
                            "tracematch: [PersistentEngine] Could not quarantine '{}': {}",
                            src,
                            e
                        );
                        return None;
                    }
                }
            }
        }
        log::warn!(
            "tracematch: [PersistentEngine] Quarantined unusable database to '{}.corrupt-{}', starting fresh",
            db_path,
            ts
        );

        match PersistentRouteEngine::new(db_path) {
            Ok(engine) => {
                // Detector output is a re-derivable cache; the ledger and the
                // user's own rows are not. Whatever the quarantined file still
                // yields comes across.
                let salvaged = engine.salvage_ledger_from(&format!("{}.corrupt-{}", db_path, ts));
                log::warn!(
                    "tracematch: [PersistentEngine] Salvaged {} history rows, {} geometry versions, {} pins, {} user sections, {} intents from the quarantined database",
                    salvaged.history,
                    salvaged.geometry,
                    salvaged.pins,
                    salvaged.sections,
                    salvaged.intents
                );
                Some(engine)
            }
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Fresh database after quarantine also failed: {:?}",
                    e
                );
                None
            }
        }
    }

    /// Handle for tracking background section detection progress.
    /// Used by DetectionManager.
    pub static SECTION_DETECTION_HANDLE: Lazy<Mutex<Option<SectionDetectionHandle>>> =
        Lazy::new(|| Mutex::new(None));

    /// Handle for tracking background tile generation.
    pub static TILE_GENERATION_HANDLE: Lazy<Mutex<Option<TileGenerationHandle>>> =
        Lazy::new(|| Mutex::new(None));
}

/// Compute what fraction of polylineA's points are within `threshold_meters` of any point in polylineB.
/// Both polylines are flat coordinate arrays [lat, lng, lat, lng, ...].
/// Uses an R-tree on polylineB for O(n log m) instead of O(n*m).
/// Returns 0.0-1.0.
#[uniffi::export]
pub fn compute_polyline_overlap(
    coords_a: Vec<f64>,
    coords_b: Vec<f64>,
    threshold_meters: f64,
) -> f64 {
    use rstar::{AABB, RTree};

    if coords_a.len() < 2 || coords_b.len() < 2 {
        return 0.0;
    }

    let points_a_count = coords_a.len() / 2;

    // Build R-tree from polyline B
    let points_b: Vec<[f64; 2]> = coords_b.chunks_exact(2).map(|c| [c[0], c[1]]).collect();
    let rtree = RTree::bulk_load(points_b);

    // Threshold in degrees, with a 1.5x buffer; the haversine below is the real
    // test. A degree of longitude shrinks with latitude, so padding both axes
    // by the same amount reaches too little east-west away from the equator.
    // Same form as bboxes_touch in sections/named.rs.
    let pad_lat = threshold_meters / 111_320.0 * 1.5;

    let mut matched = 0u32;
    for chunk in coords_a.chunks_exact(2) {
        let lat_a = chunk[0];
        let lng_a = chunk[1];
        let pad_lng = threshold_meters / (111_320.0 * lat_a.to_radians().cos().max(0.01)) * 1.5;

        let envelope = AABB::from_corners(
            [lat_a - pad_lat, lng_a - pad_lng],
            [lat_a + pad_lat, lng_a + pad_lng],
        );

        let mut found = false;
        for &[lat_b, lng_b] in rtree.locate_in_envelope(&envelope) {
            let pa = tracematch::GpsPoint {
                latitude: lat_a,
                longitude: lng_a,
                elevation: None,
            };
            let pb = tracematch::GpsPoint {
                latitude: lat_b,
                longitude: lng_b,
                elevation: None,
            };
            let dist = tracematch::geo_utils::haversine_distance(&pa, &pb);
            if dist <= threshold_meters {
                found = true;
                break;
            }
        }
        if found {
            matched += 1;
        }
    }

    matched as f64 / points_a_count as f64
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Direction;

    fn sample_coords() -> Vec<GpsPoint> {
        (0..50)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect()
    }

    #[test]
    fn test_add_activity() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();
        engine
            .add_activity("test-1".to_string(), sample_coords(), "cycling".to_string())
            .unwrap();

        assert_eq!(engine.activity_count(), 1);
        assert!(engine.has_activity("test-1"));
    }

    #[test]
    fn test_signature_caching() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();
        engine
            .add_activity("test-1".to_string(), sample_coords(), "cycling".to_string())
            .unwrap();

        // First access - loads from DB (but was cached on add)
        let sig1 = engine.get_signature("test-1");
        assert!(sig1.is_some());

        // Second access - from cache
        let sig2 = engine.get_signature("test-1");
        assert!(sig2.is_some());
    }

    #[test]
    fn test_viewport_query() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();
        engine
            .add_activity("test-1".to_string(), sample_coords(), "cycling".to_string())
            .unwrap();

        let results = engine.query_viewport(&Bounds {
            min_lat: 51.5,
            max_lat: 51.6,
            min_lng: -0.2,
            max_lng: -0.1,
        });
        assert_eq!(results.len(), 1);

        let results = engine.query_viewport(&Bounds {
            min_lat: 40.0,
            max_lat: 41.0,
            min_lng: -75.0,
            max_lng: -74.0,
        });
        assert!(results.is_empty());
    }

    #[test]
    fn test_persistence() {
        // A per-test directory: a fixed /tmp path collides with any other
        // cargo test process on the machine and flakes inside migrations.
        let dir = tempfile::TempDir::new().unwrap();
        let temp_path = dir.path().join("route_engine.db");
        let temp_path = temp_path.to_str().unwrap();

        // Create and add data
        {
            let mut engine = PersistentRouteEngine::new(temp_path).unwrap();
            engine.clear().unwrap();
            engine
                .add_activity("test-1".to_string(), sample_coords(), "cycling".to_string())
                .unwrap();
        }

        // Reload and verify
        {
            let mut engine = PersistentRouteEngine::new(temp_path).unwrap();
            engine.load().unwrap();
            assert_eq!(engine.activity_count(), 1);
            assert!(engine.has_activity("test-1"));
        }
    }

    #[test]
    fn test_grouping() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Add two identical activities
        engine
            .add_activity("test-1".to_string(), sample_coords(), "cycling".to_string())
            .unwrap();
        engine
            .add_activity("test-2".to_string(), sample_coords(), "cycling".to_string())
            .unwrap();

        let groups = engine.get_groups();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].activity_ids.len(), 2);
    }

    #[test]
    fn test_remove_activity() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();
        engine
            .add_activity("test-1".to_string(), sample_coords(), "cycling".to_string())
            .unwrap();
        engine
            .add_activity("test-2".to_string(), sample_coords(), "cycling".to_string())
            .unwrap();

        engine.remove_activity("test-1").unwrap();

        assert_eq!(engine.activity_count(), 1);
        assert!(!engine.has_activity("test-1"));
        assert!(engine.has_activity("test-2"));
    }

    // ==========================================================================
    // Set Section Reference Tests (TDD for issue: custom sections don't work)
    // ==========================================================================

    /// Helper: Create a minimal FrequentSection for testing
    fn create_test_frequent_section(
        id: &str,
        representative_activity_id: &str,
        activity_ids: Vec<String>,
        polyline: Vec<GpsPoint>,
    ) -> FrequentSection {
        FrequentSection {
            id: id.to_string(),
            name: Some(format!("Test Section {}", id)),
            sport_type: "cycling".to_string(),
            polyline,
            representative_activity_id: representative_activity_id.to_string(),
            representative_range: None,
            activity_ids: activity_ids.clone(),
            activity_portions: activity_ids
                .iter()
                .map(|aid| crate::SectionPortion {
                    activity_id: aid.clone(),
                    start_index: 0,
                    end_index: 49,
                    distance_meters: 5000.0,
                    direction: Direction::Same,
                })
                .collect(),
            route_ids: vec![],
            visit_count: activity_ids.len() as u32,
            distance_meters: 5000.0,
            activity_traces: std::collections::HashMap::new(),
            confidence: 0.8,
            observation_count: activity_ids.len() as u32,
            average_spread: 10.0,
            point_density: vec![activity_ids.len() as u32; 50],
            scale: Some(tracematch::sections::ScaleName::Medium),
            is_user_defined: false,
            stability: 0.0,
            elevation_gain_m: None,
            avg_grade_percent: None,
            version: 1,
            updated_at: None,
            created_at: Some("2026-01-28T00:00:00Z".to_string()),
            enrichment: Default::default(),
            rank: None,
            consensus_state: None,
        }
    }

    /// Test: set_section_reference works for auto-detected (FrequentSection) sections
    #[test]
    fn test_set_section_reference_autodetected_section() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Add two activities with the same route
        let coords = sample_coords();
        engine
            .add_activity(
                "activity-1".to_string(),
                coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();
        engine
            .add_activity(
                "activity-2".to_string(),
                coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();

        // Create and apply a FrequentSection with activity-1 as the representative
        let section = create_test_frequent_section(
            "sec_cycling_1",
            "activity-1",
            vec!["activity-1".to_string(), "activity-2".to_string()],
            coords.clone(),
        );
        engine.apply_sections(vec![section]).unwrap();
        // The registry assigns a stable opaque id; look it up (was "sec_cycling_1").
        let sid = engine.get_sections()[0].id.clone();

        // Verify initial state (from DATABASE, not in-memory cache)
        let db_section = engine.get_section(&sid).expect("Section should exist");
        assert_eq!(
            db_section.representative_activity_id,
            Some("activity-1".to_string())
        );
        assert!(!db_section.is_user_defined);

        // Set activity-2 as the new reference
        let result = engine.set_section_reference(&sid, "activity-2");
        assert!(
            result.is_ok(),
            "set_section_reference should succeed for auto-detected sections"
        );

        // Verify the reference was changed (from DATABASE)
        let db_section = engine.get_section(&sid).expect("Section should exist");
        assert_eq!(
            db_section.representative_activity_id,
            Some("activity-2".to_string())
        );
        assert!(db_section.is_user_defined);
    }

    // ==========================================================================
    // Bug Fix Tests (TDD)
    // ==========================================================================

    /// Bug 1: Setting reference on auto section should extract the section-matching portion,
    /// NOT use the entire activity track.
    ///
    /// The bug was that set_section_reference used `track.clone()` for auto sections,
    /// which replaced the short section polyline with the entire activity track (200 points
    /// instead of ~50).
    ///
    /// The fix extracts only the portion of the new activity that spatially overlaps with
    /// the section, preserving approximately the same geographic extent.
    #[test]
    fn test_set_section_reference_extracts_matching_portion_for_auto_section() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Create a SHORT section polyline (50 points, ~5km)
        let section_coords: Vec<GpsPoint> = (0..50)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect();

        // Create a LONGER activity track (200 points, ~20km) that contains the section
        let long_activity_coords: Vec<GpsPoint> = (0..200)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect();

        // Add activities
        engine
            .add_activity(
                "activity-short".to_string(),
                section_coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();
        engine
            .add_activity(
                "activity-long".to_string(),
                long_activity_coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();

        // Create auto-detected section with the SHORT polyline
        let section = create_test_frequent_section(
            "sec_cycling_auto",
            "activity-short",
            vec!["activity-short".to_string(), "activity-long".to_string()],
            section_coords.clone(),
        );
        engine.apply_sections(vec![section]).unwrap();
        // Registry-assigned stable id (was "sec_cycling_auto").
        let sid = engine.get_sections()[0].id.clone();

        // Verify initial state from DATABASE (not in-memory cache)
        let db_section = engine
            .get_section(&sid)
            .expect("Section should exist in DB");
        assert_eq!(
            db_section.polyline.len(),
            50,
            "Initial section should have 50 points"
        );
        let initial_distance = compute_test_polyline_distance(&db_section.polyline);

        // Set the LONG activity as the new reference
        let result = engine.set_section_reference(&sid, "activity-long");
        assert!(result.is_ok());

        // CRITICAL ASSERTION: Read from DATABASE after update
        let db_section = engine
            .get_section(&sid)
            .expect("Section should exist in DB");

        // Polyline should be approximately the same length (NOT the full 200 points)
        // Allow some variance since spatial extraction may include slightly more/fewer points
        assert!(
            db_section.polyline.len() < 100,
            "BUG: Polyline was corrupted with entire activity track! \
             Expected ~50 points but got {}. Should extract only the section-matching portion.",
            db_section.polyline.len()
        );

        // Distance should be approximately the same (not 4x larger)
        let new_distance = compute_test_polyline_distance(&db_section.polyline);
        let distance_ratio = new_distance / initial_distance;
        assert!(
            distance_ratio > 0.8 && distance_ratio < 1.2,
            "BUG: Distance changed significantly from {} to {}! \
             Expected approximately the same distance after setting new reference.",
            initial_distance,
            new_distance
        );

        // Representative should be updated
        assert_eq!(
            db_section.representative_activity_id,
            Some("activity-long".to_string()),
            "Representative activity should be updated"
        );
    }

    /// Bug 2: Reset reference should clear is_user_defined flag.
    ///
    /// NOTE: Fully regenerating the consensus polyline would require access to activity traces
    /// which are not stored in the database. For now, reset_section_reference only clears the
    /// is_user_defined flag. This is acceptable if Bug 1 is fixed (polyline won't be corrupted).
    #[test]
    fn test_reset_section_reference_clears_user_defined_flag() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Create two activities with slightly different but overlapping routes
        let coords_1: Vec<GpsPoint> = (0..50)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect();
        let coords_2: Vec<GpsPoint> = (0..50)
            .map(|i| {
                GpsPoint::new(
                    51.5074 + i as f64 * 0.001 + 0.0001,
                    -0.1278 + i as f64 * 0.0005,
                )
            })
            .collect();

        engine
            .add_activity(
                "activity-1".to_string(),
                coords_1.clone(),
                "cycling".to_string(),
            )
            .unwrap();
        engine
            .add_activity(
                "activity-2".to_string(),
                coords_2.clone(),
                "cycling".to_string(),
            )
            .unwrap();

        // Create auto-detected section with consensus polyline from both activities
        let consensus_polyline: Vec<GpsPoint> = (0..50)
            .map(|i| {
                // Consensus should be average of both routes
                GpsPoint::new(
                    51.5074 + i as f64 * 0.001 + 0.00005, // midpoint
                    -0.1278 + i as f64 * 0.0005,
                )
            })
            .collect();

        let section = create_test_frequent_section(
            "sec_cycling_consensus",
            "activity-1",
            vec!["activity-1".to_string(), "activity-2".to_string()],
            consensus_polyline.clone(),
        );
        engine.apply_sections(vec![section]).unwrap();
        // Registry-assigned stable id (was "sec_cycling_consensus").
        let sid = engine.get_sections()[0].id.clone();

        // Set reference to activity-1 (marks as user_defined)
        engine.set_section_reference(&sid, "activity-1").unwrap();

        // Verify it's now user-defined (from DATABASE)
        let db_section = engine.get_section(&sid).expect("Section should exist");
        assert!(
            db_section.is_user_defined,
            "Section should be user-defined after set_section_reference"
        );

        // Now reset the reference
        let result = engine.reset_section_reference(&sid);
        assert!(result.is_ok());

        // CRITICAL ASSERTION: After reset, read from DATABASE
        let db_section = engine.get_section(&sid).expect("Section should exist");

        // Should not be user-defined anymore
        assert!(
            !db_section.is_user_defined,
            "BUG: Section should not be user-defined after reset"
        );
    }

    /// Bug 4: Activity traces should be cleared after section save to prevent memory leak.
    /// The bug was that activity_traces in FrequentSection accumulated GPS data and was never cleared.
    #[test]
    fn test_activity_traces_cleared_after_section_save() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Create activities with GPS tracks
        let coords: Vec<GpsPoint> = (0..1000)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.0001, -0.1278 + i as f64 * 0.00005))
            .collect();

        for i in 0..10 {
            engine
                .add_activity(
                    format!("activity-{}", i),
                    coords.clone(),
                    "cycling".to_string(),
                )
                .unwrap();
        }

        // Create section with activity traces populated
        let mut section = create_test_frequent_section(
            "sec_memory_test",
            "activity-0",
            (0..10).map(|i| format!("activity-{}", i)).collect(),
            coords[0..50].to_vec(),
        );

        // Simulate what happens during section detection - traces get populated
        for i in 0..10 {
            section.activity_traces.insert(
                format!("activity-{}", i),
                coords.clone(), // 1000 points each
            );
        }

        // Apply sections (this saves to DB)
        engine.apply_sections(vec![section]).unwrap();

        // CRITICAL ASSERTION: After save, activity_traces should be cleared from in-memory sections
        // to prevent memory leak
        let in_memory_section_traces_empty =
            engine.sections.iter().all(|s| s.activity_traces.is_empty());
        assert!(
            in_memory_section_traces_empty,
            "BUG: Memory leak! activity_traces should be cleared after save. \
             These GPS traces are no longer needed and should be cleared."
        );
    }

    /// Data integrity test: After set_section_reference, stored distance should match polyline.
    /// This verifies that when we extract the matching portion, the distance field is correctly
    /// updated to match the new polyline.
    #[test]
    fn test_section_distance_matches_polyline() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Create section polyline
        let coords: Vec<GpsPoint> = (0..50)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect();

        // Longer activity
        let long_coords: Vec<GpsPoint> = (0..200)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect();

        engine
            .add_activity(
                "activity-short".to_string(),
                coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();
        engine
            .add_activity(
                "activity-long".to_string(),
                long_coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();

        // Create section with CORRECT distance matching the polyline
        let mut section = create_test_frequent_section(
            "sec_integrity",
            "activity-short",
            vec!["activity-short".to_string(), "activity-long".to_string()],
            coords.clone(),
        );
        // Fix the distance to match the actual polyline
        section.distance_meters = compute_test_polyline_distance(&coords);
        engine.apply_sections(vec![section]).unwrap();
        // Registry-assigned stable id (was "sec_integrity").
        let sid = engine.get_sections()[0].id.clone();

        // Get initial state from DB
        let db_section_before = engine.get_section(&sid).expect("Section should exist");
        let initial_distance = db_section_before.distance_meters;

        // Set reference to the longer activity
        engine.set_section_reference(&sid, "activity-long").unwrap();

        // Read from DATABASE after update
        let db_section = engine.get_section(&sid).expect("Section should exist");

        // Distance should be approximately the same (within 20% since we're extracting matching portion)
        let distance_ratio = db_section.distance_meters / initial_distance;
        assert!(
            distance_ratio > 0.8 && distance_ratio < 1.2,
            "Distance changed too much. Before: {}, After: {}",
            initial_distance,
            db_section.distance_meters
        );

        // CRITICAL: Verify stored distance matches computed distance from polyline (data integrity)
        let computed_distance = compute_test_polyline_distance(&db_section.polyline);
        let integrity_diff = (db_section.distance_meters - computed_distance).abs();
        assert!(
            integrity_diff < 10.0, // Allow 10m tolerance
            "Stored distance ({}) doesn't match polyline distance ({})! Data integrity issue.",
            db_section.distance_meters,
            computed_distance
        );
    }

    /// Helper function to compute distance for tests
    fn compute_test_polyline_distance(points: &[GpsPoint]) -> f64 {
        if points.len() < 2 {
            return 0.0;
        }
        points
            .windows(2)
            .map(|w| {
                let dlat = (w[1].latitude - w[0].latitude).to_radians();
                let dlon = (w[1].longitude - w[0].longitude).to_radians();
                let a = (dlat / 2.0).sin().powi(2)
                    + w[0].latitude.to_radians().cos()
                        * w[1].latitude.to_radians().cos()
                        * (dlon / 2.0).sin().powi(2);
                6_371_000.0 * 2.0 * a.sqrt().asin()
            })
            .sum()
    }

    /// Test that set_section_reference re-matches activities against the new polyline.
    /// Activities that no longer overlap should be removed from the junction table.
    #[test]
    fn test_set_section_reference_rematches_activities() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Create section polyline in a specific area
        let section_coords: Vec<GpsPoint> = (0..50)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect();

        // Activity 1: overlaps with section (same area)
        let activity1_coords: Vec<GpsPoint> = (0..60)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect();

        // Activity 2: overlaps with section (same area)
        let activity2_coords: Vec<GpsPoint> = (0..55)
            .map(|i| {
                GpsPoint::new(
                    51.5074 + i as f64 * 0.001,
                    -0.1278 + i as f64 * 0.0005 + 0.0001,
                )
            })
            .collect();

        // Activity 3: does NOT overlap (different area entirely)
        let activity3_coords: Vec<GpsPoint> = (0..50)
            .map(|i| GpsPoint::new(52.5 + i as f64 * 0.001, 0.0 + i as f64 * 0.0005))
            .collect();

        // Add activities
        engine
            .add_activity(
                "activity-1".to_string(),
                activity1_coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();
        engine
            .add_activity(
                "activity-2".to_string(),
                activity2_coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();
        engine
            .add_activity(
                "activity-3".to_string(),
                activity3_coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();

        // Create section with all 3 activities (even though activity-3 doesn't actually overlap)
        let section = create_test_frequent_section(
            "sec_rematch_test",
            "activity-1",
            vec![
                "activity-1".to_string(),
                "activity-2".to_string(),
                "activity-3".to_string(),
            ],
            section_coords.clone(),
        );
        engine.apply_sections(vec![section]).unwrap();
        // Registry-assigned stable id (was "sec_rematch_test").
        let sid = engine.get_sections()[0].id.clone();

        // Verify initial state: all 3 activities are associated
        let db_section = engine.get_section(&sid).expect("Section should exist");
        assert_eq!(
            db_section.activity_ids.len(),
            3,
            "Initial section should have 3 activities"
        );

        // Set activity-1 as reference (this triggers re-matching)
        engine.set_section_reference(&sid, "activity-1").unwrap();

        // After re-matching, only activities 1 and 2 should remain (they overlap)
        // Activity 3 should be removed (it's in a completely different area)
        let db_section = engine.get_section(&sid).expect("Section should exist");

        // Activity-3 should have been removed (doesn't overlap)
        assert!(
            !db_section.activity_ids.contains(&"activity-3".to_string()),
            "Activity-3 should be removed after re-matching (doesn't overlap with section)"
        );

        // Activities 1 and 2 should still be present
        assert!(
            db_section.activity_ids.contains(&"activity-1".to_string()),
            "Activity-1 should still be present after re-matching"
        );
        assert!(
            db_section.activity_ids.contains(&"activity-2".to_string()),
            "Activity-2 should still be present after re-matching"
        );
    }

    /// Regression: a freshly-detected section must have non-NULL `lap_time`/`lap_pace`
    /// in `section_activities` immediately after `apply_sections()` - no lazy
    /// backfill trip on the first `get_section_performances()` call.
    ///
    /// The computation happens inline in `save_sections()` by reading the
    /// time stream (from memory or the DB) for each portion. The lazy
    /// backfill path remains as a fallback for migration edge cases and
    /// for activities whose time streams arrive after detection.
    #[test]
    fn test_lap_time_populated_by_apply_sections() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Two activities sharing the same route.
        let coords = sample_coords();
        engine
            .add_activity(
                "activity-1".to_string(),
                coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();
        engine
            .add_activity(
                "activity-2".to_string(),
                coords.clone(),
                "cycling".to_string(),
            )
            .unwrap();

        // Seed time streams for both activities: 0s..49s at 1s cadence.
        // 50 points means indices 0..=49 are all valid.
        let times: Vec<u32> = (0..50u32).collect();
        let all_times: Vec<u32> = times.iter().chain(times.iter()).copied().collect();
        let offsets: Vec<u32> = vec![0, times.len() as u32];
        engine.set_time_streams_flat(
            &["activity-1".to_string(), "activity-2".to_string()],
            &all_times,
            &offsets,
        );

        // Apply a section spanning the full track (index 0..49).
        let section = create_test_frequent_section(
            "sec_lap_time",
            "activity-1",
            vec!["activity-1".to_string(), "activity-2".to_string()],
            coords,
        );
        engine
            .apply_sections(vec![section])
            .expect("apply_sections");
        // Registry-assigned stable id (was "sec_lap_time").
        let sid = engine.get_sections()[0].id.clone();

        // Read back junction rows directly - do NOT call `get_section_performances`
        // (that path does lazy backfill and would mask a missing inline compute).
        let rows: Vec<(String, Option<f64>, Option<f64>)> = engine
            .db
            .prepare(
                "SELECT activity_id, lap_time, lap_pace
                 FROM section_activities WHERE section_id = ?
                 ORDER BY activity_id",
            )
            .and_then(|mut stmt| {
                stmt.query_map([&sid], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<f64>>(1)?,
                        row.get::<_, Option<f64>>(2)?,
                    ))
                })
                .map(|iter| iter.filter_map(|r| r.ok()).collect())
            })
            .expect("read junction rows");

        assert_eq!(rows.len(), 2, "expected one junction row per portion");
        for (activity_id, lap_time, lap_pace) in &rows {
            assert!(
                lap_time.is_some(),
                "lap_time should be populated during save_sections for {}",
                activity_id
            );
            assert!(
                lap_pace.is_some(),
                "lap_pace should be populated during save_sections for {}",
                activity_id
            );
            // Traversal indices 0..49 on a 1-second-cadence stream = 49s.
            assert!(
                (lap_time.unwrap() - 49.0).abs() < 0.001,
                "expected lap_time ≈ 49s for {}, got {:?}",
                activity_id,
                lap_time
            );
            // Distance 5000m / 49s ≈ 102.04 m/s.
            assert!(
                (lap_pace.unwrap() - (5000.0 / 49.0)).abs() < 0.001,
                "expected lap_pace ≈ distance/time for {}, got {:?}",
                activity_id,
                lap_pace
            );
        }
    }

    /// Regression: `compute_lap_time_from_stream` handles the zero-span and
    /// missing-stream edge cases by returning `(None, None)` - never panics
    /// on out-of-bounds indices.
    #[test]
    fn test_compute_lap_time_from_stream_edge_cases() {
        use super::sections::compute_lap_time_from_stream;

        // No stream available.
        assert_eq!(
            compute_lap_time_from_stream(None, 0, 5, 100.0),
            (None, None)
        );

        // Zero-duration traversal (start == end).
        let times: Vec<u32> = vec![10, 20, 30];
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), 1, 1, 100.0),
            (None, None)
        );

        // Out of bounds end_index.
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), 0, 99, 100.0),
            (None, None)
        );

        // Happy path: indices 0..2 on [10, 20, 30] = 20s; 100m/20s = 5 m/s.
        let (lap_time, lap_pace) = compute_lap_time_from_stream(Some(&times), 0, 2, 100.0);
        assert_eq!(lap_time, Some(20.0));
        assert_eq!(lap_pace, Some(5.0));
    }
}

#[cfg(test)]
mod haversine_parity_tests {
    use super::haversine_distance_meters;

    /// Shared with `src/__tests__/lib/haversineParity.test.ts`. Both sides assert
    /// the same fixtures, so a change to either formula or radius fails here and
    /// there rather than drifting into two screens showing different numbers.
    const FIXTURES: &[(f64, f64, f64, f64, f64)] = &[
        (46.2044, 6.1432, 46.5197, 6.6323, 51_359.28),
        (46.2276, 7.3597, 46.2276, 7.3597, 0.0),
        (-37.8136, 144.9631, -33.8688, 151.2093, 713_428.47),
        (0.0, 0.0, 0.0, 1.0, 111_195.08),
        (0.0, 0.0, 1.0, 0.0, 111_195.08),
    ];

    #[test]
    fn distances_match_the_typescript_fixtures() {
        for &(lat1, lng1, lat2, lng2, expected) in FIXTURES {
            let actual = haversine_distance_meters(lat1, lng1, lat2, lng2);
            assert!(
                (actual - expected).abs() < 0.05,
                "({lat1}, {lng1}) to ({lat2}, {lng2}): expected {expected}, got {actual}"
            );
        }
    }

    #[test]
    fn uses_the_iugg_mean_radius() {
        let half_great_circle = haversine_distance_meters(0.0, 0.0, 0.0, 180.0);
        assert!((half_great_circle - 20_015_114.44).abs() < 0.5);
    }
}

#[cfg(test)]
mod polyline_overlap_latitude_tests {
    use super::compute_polyline_overlap;

    /// A degree of longitude is about 111 km at the equator and about 62 km at
    /// 56 N. Padding the search envelope equally on both axes therefore reaches
    /// too little east-west at high latitude, and points inside the threshold
    /// are never handed to the haversine check.
    #[test]
    fn east_west_overlap_is_found_at_nordic_latitudes() {
        // Two north-south lines separated EAST-WEST by 45 m, inside the 50 m
        // threshold. At 55.7 N that is 7.17e-4 degrees of longitude, wider than
        // the 6.76e-4 degrees a latitude-blind envelope reaches, so the old
        // envelope missed every point and the haversine never ran.
        let lat: f64 = 55.7;
        let offset_deg = 45.0 / (111_320.0 * lat.to_radians().cos());

        let a: Vec<f64> = (0..20)
            .flat_map(|i| vec![lat + i as f64 * 0.0005, 12.5])
            .collect();
        let b: Vec<f64> = (0..20)
            .flat_map(|i| vec![lat + i as f64 * 0.0005, 12.5 + offset_deg])
            .collect();

        let overlap = compute_polyline_overlap(a, b, 50.0);
        assert!(
            overlap > 0.9,
            "expected the lines to overlap at latitude {lat}, got {overlap}"
        );
    }

    #[test]
    fn the_same_geometry_overlaps_at_the_equator() {
        // Unchanged by the fix: at the equator the two paddings coincide.
        let offset_deg = 45.0 / 111_320.0;
        let a: Vec<f64> = (0..20).flat_map(|i| vec![i as f64 * 0.0005, 0.0]).collect();
        let b: Vec<f64> = (0..20)
            .flat_map(|i| vec![i as f64 * 0.0005, offset_deg])
            .collect();

        assert!(compute_polyline_overlap(a, b, 50.0) > 0.9);
    }

    #[test]
    fn distant_lines_do_not_overlap() {
        let a: Vec<f64> = (0..20)
            .flat_map(|i| vec![55.7, 12.5 + i as f64 * 0.0005])
            .collect();
        let b: Vec<f64> = (0..20)
            .flat_map(|i| vec![55.9, 12.5 + i as f64 * 0.0005])
            .collect();

        assert_eq!(compute_polyline_overlap(a, b, 50.0), 0.0);
    }
}
