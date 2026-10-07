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
//! 2. **LRU cached**, each bounded by entry count:
//!    - Route signatures (200 entry cache)
//!    - Route groups (100 entry cache)
//!    - Sections (50 entry cache)
//!    - Time streams (200 entry cache)
//!    - Section performances (64 entry cache)
//!
//! 3. **On-demand** (0 memory baseline):
//!    - Full GPS tracks (only loaded for section detection)
//!
//! 4. **Persisted results** (~100KB):
//!    - Computed route groups
//!    - Detected sections

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, RwLock};

#[cfg(test)]
use crate::GpsPoint;
use crate::objects::error::VeloqError;
use crate::sections::SectionSummary;
use crate::{
    ActivityMatchInfo, ActivityMetrics, Bounds, FrequentSection, MatchConfig, RouteGroup,
    RouteSignature, SectionConfig, SectionEvidenceCache, SectionPerformanceResult,
};
use lru::LruCache;
use rstar::{AABB, RTree, RTreeObject};
use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};
use std::sync::LazyLock;

/// How many section performance results the engine keeps warm.
///
/// The insights bundle asks about every section travelled in the recent window,
/// once for the record loop and again through the per-sport ranked lists. On the
/// athlete's own library, 152 sections, that working set is 23 and the whole
/// bundle computes each of them exactly once. At eight entries nothing of it
/// survives to the next call, so reopening the tab recomputed all 23; the cache
/// was sized for hopping between a few section screens, not for a bundle.
///
/// Sixty-four covers the measured working set nearly threefold. A result
/// serialises to about 8 KB, so a full cache is around 500 KB, against 1.2 MB
/// for the whole library's worth.
const PERF_CACHE_ENTRIES: std::num::NonZeroUsize = match std::num::NonZeroUsize::new(64) {
    Some(n) => n,
    None => unreachable!(),
};

pub(crate) mod activities;
pub mod attempts;
pub(crate) mod climb_bests;
pub use activities::{
    DerivedClear, ELEVATION_SOURCE_CORRECTED, ELEVATION_SOURCE_DEVICE, ELEVATION_SOURCE_RECORDED,
    ELEVATION_SOURCE_UNKNOWN, ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNAVAILABLE,
    ELEVATION_STATE_UNKNOWN, ELEVATION_STATE_UNREACHABLE, ElevationSeries, ElevationStateCounts,
    SourceSettled, TRACK_FAILURE_LIMIT, TrackRefusalKind, elevation_source_of,
    mint_local_activity_id,
};
/// On-disk blob format. Public so diagnostics that open a database file
/// directly decode it the same way the engine wrote it.
pub mod codec;
pub mod cutover;
pub(crate) mod export;
pub mod feed_rings;
pub(crate) mod file_lock;
pub use export::{ExportPrivacyPreview, SuggestedHome};
pub(crate) mod fitness;
pub(crate) mod indicators;
pub mod job_runs;
#[cfg(feature = "lock-trace")]
pub mod lock_trace;
pub mod read_cache;
pub mod read_pool;
pub(crate) mod record_backup;
pub(crate) mod record_restore;
pub mod recordings;
pub(crate) mod records;
pub use recordings::{FfiRecordingEntry, MAX_AUTO_RETRIES};
pub mod route_grouping_preview;
mod route_identity;
pub(crate) mod route_lines;
pub(crate) mod routes;
mod schema;
pub use schema::SUPPORTED_SCHEMA_VERSION;
pub(crate) mod screens;
pub mod sections;
pub use sections::SectionNameError;
pub use sections::conditioning::{DetectionSuspendGuard, detection_suspended, suspend_detection};
pub mod settings;
pub mod streams;
pub use bodies::BodiesOwed;
pub use streams::StreamGap;
pub mod tables;
pub use settings::settings_keys;
pub mod bodies;
pub mod curves;
pub(crate) mod strength;
pub use strength::FitOutcome;
pub mod tiles;
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
pub(crate) static NAME_TRANSLATIONS: LazyLock<RwLock<NameTranslations>> =
    LazyLock::new(|| RwLock::new(NameTranslations::default()));

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

/// Great-circle distance in metres, for callers holding loose coordinates
/// rather than points. The formula is tracematch's, which is the one the
/// detector cuts with.
pub(crate) fn haversine_distance_meters(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let point = |latitude, longitude| crate::GpsPoint {
        latitude,
        longitude,
        elevation: None,
    };
    tracematch::geo_utils::haversine_distance(&point(lat1, lng1), &point(lat2, lng2))
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
    /// Where the ride began, from the signature's own stored start point.
    ///
    /// The map draws a marker per activity and wants the start, not the middle
    /// of the bounding box. Holding it here is what lets the map screen answer
    /// with it: the page used to place every marker on its bounds centre, then
    /// move all of them once the signatures finished loading, which is two
    /// uploads and two cluster indexes per mount. `None` for an activity with
    /// no signature yet, where the bounds centre is still the best guess.
    pub start_point: Option<(f64, f64)>,
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
    /// Number of activities in this group
    pub activity_count: u32,
    /// Custom name (user-defined, None if not set)
    pub custom_name: Option<String>,
    /// Bounding box for map display
    pub bounds: Option<crate::FfiBounds>,
    /// All sport types present in this group's activities
    pub sport_types: Vec<String>,
    /// The representative activity's distance in metres, 0 when it has no
    /// metrics row. The routes list shows the same figure.
    pub distance_meters: f64,
}

/// Complete activity data for map display.
/// Contains both spatial bounds and metadata for filtering and display.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, uniffi::Record)]
pub struct MapActivityComplete {
    /// Activity ID
    pub activity_id: String,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// Whether the sport is recorded in a simulated world, so its track is not
    /// where the athlete rides.
    pub is_virtual: bool,
    /// Bounding box for map display
    pub bounds: crate::FfiBounds,
    /// Where the ride began, for the marker. `None` leaves the caller the
    /// bounds centre, which is where every marker used to start out before the
    /// signatures finished loading and moved it.
    pub start_lat: Option<f64>,
    pub start_lng: Option<f64>,
    /// Start date as Unix timestamp (seconds since epoch)
    pub date: f64,
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
    /// Current phase: "loading", "analyzing", "saving", "diffing"
    /// (preview only), "complete"
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

    pub fn set_progress(&self, completed: usize, total: usize) {
        self.total
            .store(total.min(u32::MAX as usize) as u32, Ordering::SeqCst);
        self.completed
            .store(completed.min(u32::MAX as usize) as u32, Ordering::SeqCst);
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
    /// The fold occupies the share between loading and saving.
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
            "analyzing" => (0.04, 0.81),
            "saving" => (0.85, 0.08),
            "recomputing_indicators" => (0.93, 0.04),
            // Preview only: the detect is already done and the catalogues are
            // being compared, so the bar sits near the end rather than falling
            // through to the unknown-phase 50.
            "diffing" => (0.97, 0.03),
            "complete" => (1.0, 0.0),
            _ => return 50,
        };
        let pct = (accumulated + weight * fraction) * 100.0;
        (pct.round() as u32).min(100)
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

/// The newest mid-fold checkpoint, and only the newest.
///
/// A checkpoint is a clone of the whole catalogue plus the folded-id set of the
/// entire pool. Sent down the result channel they queued one every two seconds
/// for the length of a run nobody polls, which on a cold `force_redetect` is
/// hundreds of copies held until the apply frees the lot. Only the newest is
/// ever wanted: an older one describes less of the same fold. So the worker
/// overwrites rather than appends, and the memory is one checkpoint whether or
/// not anything is polling. Its two state bits handshake worker completion
/// with slot installation, in either order.
#[derive(Default)]
pub struct CheckpointSlot(
    std::sync::Mutex<Option<CacheUpdate>>,
    AtomicU8,
    AtomicU64,
    AtomicBool,
    AtomicU64,
);

impl CheckpointSlot {
    /// Replace whatever is held. Never blocks the fold for a reader.
    pub fn put(&self, update: CacheUpdate) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(update);
    }

    /// Take the held checkpoint, leaving the slot empty.
    pub fn take(&self) -> Option<CacheUpdate> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).take()
    }

    /// Record that this worker owns the shared detection slot.
    pub fn mark_installed(self: &Arc<Self>, install: u64) {
        self.2.store(install, Ordering::Release);
        if self.1.fetch_or(1, Ordering::SeqCst) & 2 != 0 {
            crate::objects::detection::settle_finished_worker(self);
        }
    }

    /// The engine installation that owns this run.
    pub fn install(&self) -> u64 {
        self.2.load(Ordering::Acquire)
    }

    /// Mark this run as the owner of the detection attempt key.
    pub fn mark_detect_claimed(&self) {
        self.3.store(true, Ordering::Release);
    }

    /// Whether this run may settle the detection attempt key.
    pub fn detect_claimed(&self) -> bool {
        self.3.load(Ordering::Acquire)
    }

    /// Identity of the detection run holding this slot.
    pub fn run_id(&self) -> u64 {
        self.4.load(Ordering::Acquire)
    }

    pub(crate) fn mark_run_id(&self, run_id: u64) {
        self.4.store(run_id, Ordering::Release);
    }

    /// Release a self-applying run after its result channel has closed.
    pub fn mark_worker_finished(self: &Arc<Self>) {
        if self.1.fetch_or(2, Ordering::SeqCst) & 1 != 0 {
            crate::objects::detection::settle_finished_worker(self);
        }
    }
}

/// What a detection worker hands back: the sections it found and the ids of
/// the activities it read.
type DetectionOutput = (Vec<FrequentSection>, Vec<String>);

/// Handle for background section detection.
pub struct SectionDetectionHandle {
    receiver: mpsc::Receiver<DetectionOutput>,
    /// The final cache update, when a checkpoint drain met it first.
    final_update: std::sync::Mutex<Option<CacheUpdate>>,
    /// Out-of-band channel for the detector's evidence-cache update.
    /// The worker sends this BEFORE the section result on `receiver`, so a
    /// `Ready`/`recv` on the main channel guarantees the cache is already
    /// available to `take_cache`. The no-new-activities short-circuit does not
    /// send here, so `take_cache` returns None and the
    /// caller leaves the engine cache untouched.
    cache_receiver: mpsc::Receiver<CacheUpdate>,
    /// The newest mid-fold checkpoint. Off the channel on purpose: a run the
    /// follower never polls would otherwise queue one every two seconds.
    checkpoint: Arc<CheckpointSlot>,
    /// Shared progress state
    pub progress: SectionDetectionProgress,
    /// Set by a self-applying worker once its own apply has landed. Present
    /// only for the runs that apply on the worker, so the poll knows whether
    /// the message on `receiver` is a result to save or a run already saved.
    worker_applied: Option<Arc<AtomicBool>>,
    /// Raised by `request_cancel`, read by the worker between stages.
    cancel: Arc<AtomicBool>,
}

/// What a poll that observes completion still has to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerApply {
    /// Nothing was applied on the worker: the caller applies the result it
    /// received, which is what every blocking consumer does.
    Caller,
    /// The worker applied its own result before reporting finished, so the
    /// message on the channel is a completion signal and nothing more.
    Landed,
    /// The worker was to apply and could not. Its result went with the
    /// attempt, so the caller must report the failure rather than save the
    /// empty message left behind.
    Failed,
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
    /// Ask the run to stop. Cooperative: the worker checks between stages and
    /// after each cluster the fold cuts, so a cancel ends the fold at its next
    /// cluster boundary and discards the run rather than saving a partial
    /// catalogue. The grouping call is atomic, so a cancel that lands inside it
    /// does not shorten it.
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Whether this run has been asked to stop.
    pub fn cancel_requested(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// Whether this run applied its own result. Only meaningful once the
    /// main channel has answered `Ready`: the worker sets the flag before it
    /// sends.
    pub fn worker_apply(&self) -> WorkerApply {
        match &self.worker_applied {
            None => WorkerApply::Caller,
            Some(flag) if flag.load(Ordering::SeqCst) => WorkerApply::Landed,
            Some(_) => WorkerApply::Failed,
        }
    }

    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_state(&self) -> WorkerPoll<DetectionOutput> {
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

    /// Wait for detection to complete, or for the phase it ended in.
    ///
    /// A run sends nothing when it was refused before it started, when the
    /// worker could not open its database, and when it died. None of those is
    /// a catalogue, and a caller that read the absence as an empty one
    /// reported a run that never happened as a verdict about the library. So
    /// the phase travels in the `Err`, rather than being left on `progress`
    /// for a caller to have cloned before this consumed the handle.
    pub fn recv(self) -> Result<DetectionOutput, String> {
        let progress = self.progress.clone();
        self.receiver.recv().map_err(|_| progress.get_phase())
    }

    /// Take the detector's evidence-cache update, if any. The short-circuit
    /// sends none, leaving the engine cache as-is.
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

    /// The newest checkpoint the worker has left, or None. The slot holds one,
    /// so this is a take rather than a drain and the channel is untouched.
    pub fn take_checkpoint(&self) -> Option<CacheUpdate> {
        self.checkpoint.take()
    }

    /// The slot this run writes its checkpoints into.
    ///
    /// Handed out so a follower can hold on to the one run it started and tell
    /// it from whatever occupies the slot later, which no id on the handle
    /// would do any better.
    pub fn checkpoint_slot(&self) -> Arc<CheckpointSlot> {
        Arc::clone(&self.checkpoint)
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
    /// and fall back to the checkpoint slot only when the run ended without
    /// one.
    pub fn recv_with_cache(self) -> (Option<DetectionOutput>, Option<CacheUpdate>) {
        let (state, cache) = self.recv_state_with_cache();
        match state {
            WorkerPoll::Ready(v) => (Some(v), cache),
            _ => (None, cache),
        }
    }

    /// The same read, keeping the one distinction `recv_with_cache` throws
    /// away: a worker that died without sending against a run with nothing to
    /// report.
    ///
    /// A panic inside the fold drops the sender, and `recv().ok()` then answers
    /// `None`, which every caller treats as an empty catalogue and applies. The
    /// previous catalogue stands and nothing says the detect never happened.
    /// `poll_state` has reported `Died` since the failover work; this is the
    /// blocking read catching up with it.
    ///
    /// `Running` is never returned: the read blocks until the channel answers
    /// one way or the other.
    pub fn recv_state_with_cache(self) -> (WorkerPoll<DetectionOutput>, Option<CacheUpdate>) {
        self.recv_state_with_cache_within(None)
    }

    /// The same read, giving up after `limit` and answering `Running`.
    ///
    /// A worker that hangs rather than dies never closes its channel, so the
    /// unbounded read above waits for the life of the process and whatever the
    /// caller holds is held with it. `None` is the unbounded read, for callers
    /// that are the worker's only reader and have nothing to release.
    ///
    /// `Running` is the honest answer for an expiry: the run may still be going,
    /// and its checkpoints are on disk for the next launch to resume from.
    pub fn recv_state_with_cache_within(
        &self,
        limit: Option<std::time::Duration>,
    ) -> (WorkerPoll<DetectionOutput>, Option<CacheUpdate>) {
        let received = match limit {
            Some(limit) => self
                .receiver
                .recv_timeout(limit)
                .map_err(|e| matches!(e, std::sync::mpsc::RecvTimeoutError::Timeout)),
            None => self.receiver.recv().map_err(|_| false),
        };
        let main = match received {
            Ok(v) => WorkerPoll::Ready(v),
            Err(true) => WorkerPoll::Running,
            Err(false) => WorkerPoll::Died,
        };
        let stashed = self
            .final_update
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        let cache = stashed
            .or_else(|| {
                loop {
                    match self.cache_receiver.try_recv() {
                        Ok(u) if u.checkpoint => continue,
                        Ok(u) => return Some(u),
                        Err(_) => return None,
                    }
                }
            })
            .or_else(|| self.checkpoint.take());
        (main, cache)
    }
}

/// Handle for a background wipe of the derived catalogue.
///
/// Its own type rather than a reuse of `BackupHandle`: the two occupy
/// different slots and a poll must never read the wrong one.
pub struct ClearHandle {
    receiver: mpsc::Receiver<Result<(), String>>,
}

impl ClearHandle {
    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_state(&self) -> WorkerPoll<Result<(), String>> {
        match self.receiver.try_recv() {
            Ok(v) => WorkerPoll::Ready(v),
            Err(mpsc::TryRecvError::Empty) => WorkerPoll::Running,
            Err(mpsc::TryRecvError::Disconnected) => WorkerPoll::Died,
        }
    }

    /// Block until the wipe reports, or until its thread dies without doing so.
    ///
    /// For a caller that is already off the JS thread and has nothing to do
    /// until the answer arrives. A poll loop in its place is the same wait plus
    /// an interval nobody chose.
    pub fn wait(self) -> Result<(), String> {
        self.receiver
            .recv()
            .unwrap_or_else(|_| Err("Clear thread died without a result".to_string()))
    }
}

/// Handle for a background wipe of everything the engine can re-derive.
///
/// Its own type rather than a reuse of `ClearHandle`: it carries the counts the
/// clear-cache screen reports, and the two occupy different slots.
pub struct DerivedClearHandle {
    receiver: mpsc::Receiver<Result<activities::DerivedClear, String>>,
}

impl DerivedClearHandle {
    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_state(&self) -> WorkerPoll<Result<activities::DerivedClear, String>> {
        match self.receiver.try_recv() {
            Ok(v) => WorkerPoll::Ready(v),
            Err(mpsc::TryRecvError::Empty) => WorkerPoll::Running,
            Err(mpsc::TryRecvError::Disconnected) => WorkerPoll::Died,
        }
    }

    /// Block until the wipe reports what it removed, or until its thread dies
    /// without doing so.
    pub fn wait(self) -> Result<activities::DerivedClear, String> {
        self.receiver
            .recv()
            .unwrap_or_else(|_| Err("Clear thread died without a result".to_string()))
    }
}

/// Empty what the engine can re-derive, on a background thread.
///
/// 734 ms on a 750-activity library, the worst of the three wipes, and it sits
/// behind the clear-cache button. The write lock is still taken, what moves off
/// the calling thread is the wait.
pub fn clear_derived_background() -> DerivedClearHandle {
    let install = engine_install();
    let (tx, rx) = mpsc::channel();
    crate::threads::spawn_named("veloq-clear", move || {
        let result = wipe_with_persistent_engine_for(install, |engine| {
            engine.clear_derived().map_err(|e| format!("{}", e))
        })
        .unwrap_or_else(|| Err("Engine is not initialised".to_string()));
        tx.send(result).ok();
    });
    DerivedClearHandle { receiver: rx }
}

/// Wipe every table on a background thread, then the heatmap tiles.
///
/// 401 ms on a 750-activity library. The caller re-opens the engine after
/// this, and that re-open must stay ordered against the wipe rather than
/// racing it, which is what waiting on the handle gives it.
///
/// `heatmap_tiles_dir` is where the app keeps the tiles whether or not the
/// heatmap is on. The engine knows the path only once the heatmap is turned on
/// in this process, and the login screen wipes before that, so the caller
/// names it. The path in force is wiped too, when it is somewhere else.
pub fn clear_all_background(heatmap_tiles_dir: Option<String>) -> ClearHandle {
    let install = engine_install();
    let (tx, rx) = mpsc::channel();
    crate::threads::spawn_named("veloq-clear", move || {
        let result = wipe_with_persistent_engine_for(install, |engine| {
            let in_force = engine.heatmap_tiles_path().map(std::path::PathBuf::from);
            engine
                .clear()
                .map(|()| in_force)
                .map_err(|e| format!("{}", e))
        })
        .unwrap_or_else(|| Err("Engine is not initialised".to_string()));
        // Out here because the lock is released: a full set is tens of
        // thousands of files, and every reader would otherwise wait out the
        // walk. A wipe that failed keeps the library, so it keeps its tiles.
        let result = result.and_then(|in_force| {
            let mut dirs: Vec<std::path::PathBuf> = heatmap_tiles_dir
                .map(std::path::PathBuf::from)
                .into_iter()
                .collect();
            dirs.extend(in_force.filter(|dir| !dirs.contains(dir)));
            tiles::wipe_tile_sets(&dirs)
        });
        tx.send(result).ok();
    });
    ClearHandle { receiver: rx }
}

/// Handle for a background database backup.
pub struct BackupHandle {
    receiver: mpsc::Receiver<Result<(), String>>,
}

impl BackupHandle {
    /// A handle around a channel the caller already owns. Test path: it is
    /// how a worker that died without sending is staged.
    #[cfg(test)]
    pub fn from_receiver(receiver: mpsc::Receiver<Result<(), String>>) -> Self {
        Self { receiver }
    }

    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_state(&self) -> WorkerPoll<Result<(), String>> {
        match self.receiver.try_recv() {
            Ok(v) => WorkerPoll::Ready(v),
            Err(mpsc::TryRecvError::Empty) => WorkerPoll::Running,
            Err(mpsc::TryRecvError::Disconnected) => WorkerPoll::Died,
        }
    }

    /// Block until the copy finishes, returning its outcome.
    /// Test and bench path; production polls.
    pub fn recv_blocking(&self) -> Option<Result<(), String>> {
        self.receiver.recv().ok()
    }
}

/// Handle for a background heatmap cache-size walk.
///
/// The walk is linear in cached tiles and reads nothing but the filesystem,
/// so it takes no engine lock and no connection. What it does take is time:
/// 40,061 tiles measured 170 ms on the CPH2653, and the mount that asks for
/// it has 100 ms for the whole screen.
pub struct CacheSizeHandle {
    receiver: mpsc::Receiver<u64>,
}

impl CacheSizeHandle {
    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_state(&self) -> WorkerPoll<u64> {
        match self.receiver.try_recv() {
            Ok(v) => WorkerPoll::Ready(v),
            Err(mpsc::TryRecvError::Empty) => WorkerPoll::Running,
            Err(mpsc::TryRecvError::Disconnected) => WorkerPoll::Died,
        }
    }

    /// Block until the walk finishes. Test and bench path; production polls.
    pub fn recv_blocking(&self) -> Option<u64> {
        self.receiver.recv().ok()
    }
}

/// Start a cache-size walk on its own thread.
pub fn walk_cache_size_background(base_path: String, walk: fn(&str) -> u64) -> CacheSizeHandle {
    let (tx, rx) = mpsc::channel();
    crate::threads::spawn_named("veloq-du", move || {
        tx.send(walk(&base_path)).ok();
    });
    CacheSizeHandle { receiver: rx }
}

/// Handle for a background bulk export.
pub struct BulkExportHandle {
    receiver: mpsc::Receiver<Result<export::BulkExportResult, String>>,
    progress: std::sync::Arc<export::BulkExportProgress>,
}

impl BulkExportHandle {
    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_state(&self) -> WorkerPoll<Result<export::BulkExportResult, String>> {
        match self.receiver.try_recv() {
            Ok(v) => WorkerPoll::Ready(v),
            Err(mpsc::TryRecvError::Empty) => WorkerPoll::Running,
            Err(mpsc::TryRecvError::Disconnected) => WorkerPoll::Died,
        }
    }

    /// Tracks visited so far, and how many the export expects to visit.
    pub fn progress(&self) -> (u32, u32) {
        self.progress.read()
    }

    /// The counters themselves, for a progress read that outlives this handle
    /// being moved onto the thread that awaits it.
    pub fn progress_handle(&self) -> std::sync::Arc<export::BulkExportProgress> {
        std::sync::Arc::clone(&self.progress)
    }

    /// Block until the export finishes, returning its outcome.
    /// Test and bench path; production polls.
    pub fn recv_blocking(&self) -> Option<Result<export::BulkExportResult, String>> {
        self.receiver.recv().ok()
    }
}

/// Finished runs for the slot's tests. The synthetic lane gets them too,
/// because an integration test can only stand a worker-applied run in the
/// shared slot through one of these.
#[cfg(any(test, feature = "synthetic"))]
impl SectionDetectionHandle {
    /// A finished run whose worker apply never landed, for the poll's
    /// failure path: the channel carries the empty message the worker sends
    /// after it applies, and the flag says the apply did not happen.
    #[doc(hidden)]
    pub fn finished_without_its_worker_apply() -> Self {
        let (tx, rx) = mpsc::channel();
        let (cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        tx.send((Vec::new(), Vec::new())).ok();
        drop(tx);
        drop(cache_tx);
        SectionDetectionHandle {
            receiver: rx,
            final_update: Mutex::new(None),
            cache_receiver: cache_rx,
            checkpoint: Arc::new(CheckpointSlot::default()),
            progress: SectionDetectionProgress::new(),
            worker_applied: Some(Arc::new(AtomicBool::new(false))),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    #[doc(hidden)]
    pub fn finished_after_worker_apply() -> Self {
        let handle = Self::finished_without_its_worker_apply();
        handle
            .worker_applied
            .as_ref()
            .expect("self-applying handle")
            .store(true, Ordering::SeqCst);
        handle
    }
}

#[cfg(test)]
impl SectionDetectionHandle {
    /// A worker that hangs rather than dies: it holds its sender, so the
    /// channel neither answers nor closes. The sender is returned so the test
    /// keeps it alive; dropping it would make this a dead worker instead.
    pub(crate) fn worker_that_never_answers() -> (
        Self,
        mpsc::Sender<DetectionOutput>,
        mpsc::Sender<CacheUpdate>,
    ) {
        let (tx, rx) = mpsc::channel();
        let (cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        let handle = SectionDetectionHandle {
            receiver: rx,
            final_update: Mutex::new(None),
            cache_receiver: cache_rx,
            checkpoint: Arc::new(CheckpointSlot::default()),
            progress: SectionDetectionProgress::new(),
            worker_applied: None,
            cancel: Arc::new(AtomicBool::new(false)),
        };
        (handle, tx, cache_tx)
    }
}

/// A stop the athlete asked for, checked by a background pass at its own safe
/// points.
///
/// The house shape for cancelling detached work. A pass owns one, its handle
/// holds a clone, and cancelling is one atomic store: no channel to drain, no
/// lock for the worker to contend on, and no way for a cancel to arrive
/// half-applied. It latches, so a second cancel is not an un-cancel, and a
/// pass that has already finished simply ignores it.
///
/// Where the safe points are is the pass's own decision, and the only rule is
/// that state a later pass depends on must be left as if this one never ran.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<std::sync::atomic::AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ask the pass to stop. Latching, and safe from any thread.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    /// Whether a stop has been asked for.
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Every tile sweep that is running, so a cancel reaches all of them.
///
/// A sweep is detached and returns no handle, so unlike the tile pass it has
/// nowhere of its own to keep its token. One slot held one, and two sweeps are
/// reachable at once: `add_activities_batch` spawns one for new and mutated
/// activities, the removal path spawns another, and the elevation backfill
/// stores through the same batch while a GPS sync stores its own. The second
/// spawn overwrote the first, so the first swept its whole bounds list with
/// nobody able to stop it, and whichever thread ended first cleared the slot.
///
/// A set rather than a guard refusing the second sweep. Refusing it would drop
/// the invalidation that sweep was spawned to do, and the tiles it would have
/// taken stay on disk claiming ground that has changed.
static TILE_SWEEPS: LazyLock<Mutex<Vec<(u64, SweepScope, CancelToken)>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

/// What a registration is scoped to. Production has one library and every
/// sweep belongs to it. Lib tests share the process and run in parallel, and
/// the ones that add activities spawn sweeps without any guard, so a test's
/// cancel reaches only the sweeps registered from its own thread.
#[derive(PartialEq)]
struct SweepScope(#[cfg(test)] std::thread::ThreadId);

fn current_sweep_scope() -> SweepScope {
    SweepScope(
        #[cfg(test)]
        std::thread::current().id(),
    )
}

static NEXT_TILE_SWEEP_ID: AtomicU64 = AtomicU64::new(0);

/// One sweep's place in [`TILE_SWEEPS`]. Dropping it takes that sweep's
/// registration and leaves every sibling's, so a sweep that ends cannot make
/// another unstoppable.
pub struct TileSweepRegistration {
    id: u64,
    token: CancelToken,
}

impl TileSweepRegistration {
    /// The token the sweep checks at its safe points.
    pub fn token(&self) -> CancelToken {
        self.token.clone()
    }
}

impl Drop for TileSweepRegistration {
    fn drop(&mut self) {
        if let Ok(mut sweeps) = TILE_SWEEPS.lock() {
            sweeps.retain(|(id, _, _)| *id != self.id);
        }
    }
}

/// Register a sweep about to start. Hold the registration for as long as the
/// sweep runs.
pub fn register_tile_sweep() -> TileSweepRegistration {
    let id = NEXT_TILE_SWEEP_ID.fetch_add(1, Ordering::SeqCst);
    let token = CancelToken::new();
    if let Ok(mut sweeps) = TILE_SWEEPS.lock() {
        sweeps.push((id, current_sweep_scope(), token.clone()));
    }
    TileSweepRegistration { id, token }
}

/// Stop every sweep that is running. Answers whether there was one, so the
/// caller can tell a cancel that reached something from one that did not.
///
/// The registrations stay: each sweep takes its own when it winds down, and
/// taking them here would leave a still-running sweep unreachable by a second
/// cancel, which is the bug this replaced.
pub fn cancel_tile_sweeps() -> bool {
    let Ok(sweeps) = TILE_SWEEPS.lock() else {
        return false;
    };
    let scope = current_sweep_scope();
    let mut reached = false;
    for (_, owner, token) in sweeps.iter() {
        if *owner == scope {
            token.cancel();
            reached = true;
        }
    }
    reached
}

/// Handle for background heatmap tile generation with progress tracking.
pub struct TileGenerationHandle {
    receiver: mpsc::Receiver<u32>,
    /// Number of tiles generated so far (updated atomically by background thread)
    pub generated: Arc<AtomicU32>,
    /// Total tiles to process
    pub total: Arc<AtomicU32>,
    /// The stop this pass checks. Cancelling costs a stale heatmap the next
    /// pass redraws, which is why the dirty marker survives a cancelled run.
    cancel: CancelToken,
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

    /// Ask the pass to stop at its next tile.
    pub fn cancel(&self) {
        self.cancel.cancel();
    }

    /// Whether this pass was asked to stop. True from the moment `cancel` is
    /// called, whether or not the worker has noticed yet.
    pub fn was_cancelled(&self) -> bool {
        self.cancel.is_cancelled()
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
        let (tx, rx) = mpsc::channel::<DetectionOutput>();
        let (_cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        let handle = SectionDetectionHandle {
            receiver: rx,
            final_update: std::sync::Mutex::new(None),
            cache_receiver: cache_rx,
            checkpoint: Arc::new(CheckpointSlot::default()),
            progress: SectionDetectionProgress::new(),
            worker_applied: None,
            cancel: Arc::new(AtomicBool::new(false)),
        };

        assert!(matches!(handle.poll_state(), WorkerPoll::Running));
        drop(tx);
        assert!(matches!(handle.poll_state(), WorkerPoll::Died));
    }

    #[test]
    fn finished_worker_reports_ready_then_died() {
        let (tx, rx) = mpsc::channel::<DetectionOutput>();
        let (_cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        let handle = SectionDetectionHandle {
            receiver: rx,
            final_update: std::sync::Mutex::new(None),
            cache_receiver: cache_rx,
            checkpoint: Arc::new(CheckpointSlot::default()),
            progress: SectionDetectionProgress::new(),
            worker_applied: None,
            cancel: Arc::new(AtomicBool::new(false)),
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
// Persistent Route Engine
// ============================================================================

/// Memory-efficient route engine with SQLite persistence.
///
/// Only loads lightweight metadata into memory. Signatures are LRU cached,
/// and GPS tracks are loaded on-demand only when needed for section detection.
pub struct PersistentEngine {
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

    /// Tier 2: LRU cached sections for single-item lookups (50 max = ~5MB)
    section_cache: LruCache<String, FrequentSection>,

    /// Cached route groups (loaded from DB). Their `group_id` is a stable
    /// assign-once id carried by `route_identity`, not the churning Union-Find root.
    groups: Vec<RouteGroup>,

    /// Assign-once route identity registry. Owns the stable route id over time
    /// and carries it (plus the representative) onto the recomputed group by
    /// member overlap. Restored from its persisted blob on open, or reseeded
    /// from the loaded groups when there is none.
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

    /// Cached sections (loaded from DB). This is the identity-stable,
    /// hysteresis-DAMPED visible catalogue the app renders, not the raw detection
    /// batch, `sections::SectionIdentity` remaps ids and debounces churn between
    /// the worker's raw catalogue and this field.
    sections: Vec<FrequentSection>,

    /// Sections a custom section has replaced. They stay in `sections` because
    /// supersession only hides: the ground is still a detection prior, and
    /// dropping it would re-mint it under a new id on the next detect. Held in
    /// memory so the memory-only views can hide them without touching `self.db`.
    superseded_ids: std::collections::HashSet<String>,

    /// Named-corridor resolution: display name per visible section plus the
    /// full corridor listing. A pure function of DB state, refreshed lazily
    /// behind `named_overlay_stamp`, the connection's `total_changes()`
    /// counter at last compute, so any write through this connection
    /// invalidates it and no mutation site needs remembering. The refresh
    /// queries `self.db` and so runs under the engine lock like every other db
    /// method. The `RwLock` here is the engine's own, over the map and not
    /// over the engine, and it stays.
    pub(crate) named_overlay: std::sync::RwLock<sections::NamedOverlay>,
    pub(crate) named_overlay_stamp: std::sync::atomic::AtomicI64,

    /// Assign-once section identity registry + hysteresis debounce. Owns the
    /// stable opaque id over time and damps the non-monotone batch into the
    /// visible `sections` above. Restored from its persisted blob on open, or
    /// reseeded from the loaded sections when there is none.
    identity: sections::SectionIdentity,

    /// The last RAW detection catalogue applied, before the identity + hysteresis
    /// remap. `sections` is the DAMPED view the app renders; this is the
    /// convergence truth (order-free, tracks the batch every step) the parity
    /// gates compare against. The two DIFFER by design: the damped view can hold a
    /// section a debounced dissolve has not yet retired, so it lags the raw batch
    /// by up to `k` steps. In-memory only. `None` until a detect has applied in
    /// this process: an applied EMPTY batch is a known answer, not an absence,
    /// so the two must stay distinguishable.
    raw_sections: Option<Vec<FrequentSection>>,

    /// Activities that have been through section detection (persisted in SQLite)
    processed_activity_ids: HashSet<String>,

    /// In-memory per-(sport, cluster) evidence for the incremental
    /// detector. Holds each cluster's last catalogue so a sync recomputes only
    /// the cluster(s) a new activity touches (O(touched-cluster), not O(pool)).
    /// Persisted in `evidence_cache` beside the config digest it was folded
    /// under, so a restart resumes warm; an unreadable or stale row leaves the
    /// engine cold, which is what every engine did before the row existed.
    /// Moves in lockstep with `cache_folded_ids`.
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
    /// Counts every time the grouping was marked stale. A run compares it with
    /// the value it captured at spawn to tell a store made while it ran from the
    /// stale flag it was started to clear.
    pub(crate) groups_dirty_epoch: u64,
    /// The committed route catalogue `groups` was read from or written as. A
    /// background regroup captures it at spawn and commits only over that one.
    pub(crate) group_generation: u64,

    /// The route word the in-memory groups' shown names were composed in.
    pub(crate) route_names_word: String,
    sections_dirty: bool,

    /// Configuration
    pub(crate) match_config: MatchConfig,
    pub(crate) section_config: SectionConfig,

    /// Path for heatmap tile output (set from JS at init)
    pub(crate) heatmap_tiles_path: Option<String>,

    /// LRU cache for get_section_performances, keyed by section id (+ sport
    /// filter). A section detail load calls it twice for the same section (buckets
    /// and calendar); navigating between a handful of sections keeps them all warm
    /// where the old single entry evicted on every hop.
    ///
    /// Sized for a whole insights bundle rather than a handful of screens, so
    /// reopening the tab is free. See [`PERF_CACHE_ENTRIES`].
    perf_cache: LruCache<String, SectionPerformanceResult>,

    /// Full computations of `get_section_performances_filtered`, cache hits
    /// excluded. Exposed so a test can tell a skipped section from a computed
    /// one without timing it.
    perf_computations: u64,

    /// The external-write token this engine's tiers already speak for.
    ///
    /// Zero until the first `load`, which is correct: an engine that has just
    /// read the file speaks for whatever the file said, and a handler that
    /// wrote before the app launched has its rows in that read already.
    seen_external_write_token: u64,
}

/// The pragmas a connection that writes has to set for itself.
///
/// `journal_mode` is a property of the database file, so one connection
/// converts it for every other. `synchronous` is a property of the connection,
/// and a background writer that skips it goes on paying the full fsync pair
/// WAL was taken to avoid, on its own thread, invisibly. NORMAL under WAL
/// risks losing the last commits to a power cut, never a corrupt file, which
/// is the trade this database makes.
pub(crate) fn apply_write_pragmas(conn: &Connection) -> SqlResult<()> {
    conn.pragma_update(None, "synchronous", "NORMAL")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EngineOpenMode {
    Foreground,
    Push,
}

/// Commit a write transaction, rolling it back if SQLite leaves it open.
pub(crate) fn commit_write_txn(conn: &Connection) -> SqlResult<()> {
    if let Err(error) = conn.execute_batch("COMMIT") {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(error);
    }
    Ok(())
}

static GROUPS_DIRTY_FOR_READERS: AtomicBool = AtomicBool::new(false);
static SECTIONS_DIRTY_FOR_READERS: AtomicBool = AtomicBool::new(false);
static SIGNATURE_CACHE_LEN_FOR_READERS: AtomicU32 = AtomicU32::new(0);

/// Copy the facts that live only in engine memory to where a pooled reader
/// can see them. Called each time the write lock is let go, so a reader sees
/// them as of the last write that finished.
fn publish_for_readers(engine: &PersistentEngine) {
    GROUPS_DIRTY_FOR_READERS.store(engine.groups_dirty, Ordering::Release);
    SECTIONS_DIRTY_FOR_READERS.store(engine.sections_dirty, Ordering::Release);
    SIGNATURE_CACHE_LEN_FOR_READERS.store(engine.signature_cache.len() as u32, Ordering::Release);
}

pub(crate) fn groups_dirty_for_readers() -> bool {
    GROUPS_DIRTY_FOR_READERS.load(Ordering::Acquire)
}

impl PersistentEngine {
    pub(crate) fn set_groups_dirty(&mut self, dirty: bool) {
        self.groups_dirty = dirty;
        if dirty {
            self.groups_dirty_epoch += 1;
        }
    }
    /// Invalidate the performance cache.
    /// Call after any mutation that affects sections, time streams, or activity metrics.
    /// Run one editor's whole write inside a transaction, rolling back if any
    /// step of it fails.
    ///
    /// The section editors took no transaction at all: `trim_section` updated
    /// `sections`, deleted the junction rows, then re-matched, and an error in
    /// the re-match left the section holding its new polyline with zero
    /// traversals. A `Transaction` cannot be used here because it borrows the
    /// connection for as long as it lives and every editor needs `&mut self`
    /// while it runs, so the statements are issued directly and this holds the
    /// arms.
    pub(crate) fn in_write_txn<T>(
        &mut self,
        work: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        let nested = !self.db.is_autocommit();
        self.db
            .execute_batch(if nested {
                "SAVEPOINT veloq_nested_write"
            } else {
                "BEGIN IMMEDIATE"
            })
            .map_err(|e| format!("Failed to open the write transaction: {}", e))?;
        match work(self) {
            Ok(value) => {
                if nested {
                    if let Err(error) = self
                        .db
                        .execute_batch("RELEASE SAVEPOINT veloq_nested_write")
                    {
                        let _ = self.db.execute_batch(
                            "ROLLBACK TO SAVEPOINT veloq_nested_write; RELEASE SAVEPOINT veloq_nested_write",
                        );
                        return Err(format!("Failed to commit: {}", error));
                    }
                } else {
                    self.refresh_section_rank_inputs();
                    commit_write_txn(&self.db).map_err(|e| format!("Failed to commit: {}", e))?;
                }
                Ok(value)
            }
            Err(e) => {
                let _ = self.db.execute_batch(if nested {
                    "ROLLBACK TO SAVEPOINT veloq_nested_write; RELEASE SAVEPOINT veloq_nested_write"
                } else {
                    "ROLLBACK"
                });
                Err(e)
            }
        }
    }

    /// Bring the stored ranking inputs up to the traversals a write just
    /// changed. A failure leaves the sections marked, and a read recomputes
    /// those itself, so it costs speed and never a wrong answer.
    pub(crate) fn refresh_section_rank_inputs(&self) {
        if let Err(e) = sections::ranking::pooled::refresh_rank_inputs(&self.db) {
            log::warn!("veloqrs: [RankedSections] refreshing the stored inputs failed: {e}");
        }
    }

    pub(crate) fn invalidate_perf_cache(&mut self) {
        self.perf_cache.clear();
    }

    /// Empty every LRU on the engine.
    ///
    /// Each is keyed by an id and filled on a miss, so emptying one costs the
    /// next read its recompute and nothing else. Used where the tiers behind
    /// them have been reloaded and an entry may describe rows that are gone.
    pub(crate) fn clear_memory_caches(&mut self) {
        self.signature_cache.clear();
        self.section_cache.clear();
        self.time_streams.clear();
        self.perf_cache.clear();
    }

    /// How many section performance results have been computed in full.
    #[doc(hidden)]
    pub fn performance_computations(&self) -> u64 {
        self.perf_computations + fitness::performances::pooled::computations() as u64
    }

    pub(crate) fn note_performance_computation(&mut self) {
        self.perf_computations += 1;
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
        self.forget_evidence_cache_in_memory();
        self.clear_persisted_evidence_cache();
    }

    /// Empty the evidence tiers after their persisted row has been deleted.
    pub(crate) fn forget_evidence_cache_in_memory(&mut self) {
        self.section_evidence_cache = SectionEvidenceCache::new();
        self.cache_folded_ids.clear();
    }

    // ========================================================================
    // Initialisation
    // ========================================================================

    /// Create a new persistent engine with the given database path.
    pub fn new(db_path: &str) -> SqlResult<Self> {
        Self::open(db_path, EngineOpenMode::Foreground)
    }

    /// Open a push handler's connection without changing foreground launch state.
    pub fn new_for_push(db_path: &str) -> SqlResult<Self> {
        Self::open(db_path, EngineOpenMode::Push)
    }

    fn open(db_path: &str, mode: EngineOpenMode) -> SqlResult<Self> {
        // Before any FFI call can reach a `par_iter`, since the pool takes its
        // names when it is built and cannot be renamed after.
        crate::threads::name_cpu_pool();

        let mut db = Connection::open(db_path)?;
        // Background threads (detection, backfill, tiles) open their own
        // connections. Without a busy timeout their writes make this
        // connection's queries fail SQLITE_BUSY immediately, which surfaces
        // as intermittent empty reads in the app during sync.
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        // The mode belongs to the file, so converting it here converts it for
        // every connection that opens it afterwards, this launch or any later
        // one. An existing rollback database is converted in place on the open
        // that follows the upgrade.
        db.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))?;
        apply_write_pragmas(&db)?;
        Self::init_schema(&mut db)?;

        let engine = Self {
            db,
            db_path: db_path.to_string(),
            activity_metadata: HashMap::new(),
            spatial_index: RTree::new(),
            signature_cache: LruCache::new(std::num::NonZeroUsize::new(200).unwrap()),
            section_cache: LruCache::new(std::num::NonZeroUsize::new(50).unwrap()),
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
            groups_dirty_epoch: 0,
            group_generation: 0,
            route_names_word: String::new(),
            sections_dirty: false,
            match_config: MatchConfig::default(),
            section_config: SectionConfig::default(),
            heatmap_tiles_path: None,
            perf_cache: LruCache::new(PERF_CACHE_ENTRIES),
            perf_computations: 0,
            seen_external_write_token: 0,
        };

        // A ride is marked `uploading` before its request goes out, so a kill
        // strands the row where neither retry path looks. This is the one
        // moment per launch where nothing can be in flight.
        if mode == EngineOpenMode::Foreground {
            if let Err(e) = engine.release_stranded_uploads(attempts::now_ms()) {
                log::warn!(
                    "veloqrs: [PersistentEngine] could not release stranded uploads: {}",
                    e
                );
            }

            // Before anything can read a badge, and once. The version is a build
            // constant, so the open is the only moment it can have moved.
            engine.recompute_indicators_if_stale();
        }

        Ok(engine)
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
    /// The token the file carries, or zero when no handler has written one.
    ///
    /// Read off the engine's own connection, so it sees whatever another
    /// process has already committed.
    pub fn external_write_token(&self) -> u64 {
        self.get_setting(crate::persistence::settings::settings_keys::EXTERNAL_WRITE_TOKEN)
            .ok()
            .flatten()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0)
    }

    /// Say that this process wrote rows another engine may be holding stale
    /// copies of.
    ///
    /// One statement, so two handlers cannot lose each other's bump. The
    /// `INSERT` seeds the row at one on an install that has never had a push,
    /// which is every install before this ships.
    pub fn note_external_write(&mut self) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, '1', strftime('%s', 'now'))
             ON CONFLICT(key) DO UPDATE SET
                value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
                updated_at = excluded.updated_at",
            rusqlite::params![crate::persistence::settings::settings_keys::EXTERNAL_WRITE_TOKEN],
        )?;
        // This engine's own write, so its tiers already carry the rows and it
        // owes itself no reload. On Android the handler runs in the app's
        // process against this very engine, and without this every push would
        // cost the foreground a reload for rows it had already taken.
        self.seen_external_write_token = self.external_write_token();
        Ok(())
    }

    /// Record one native push run, and trim the table to the newest `kept`.
    ///
    /// The insert and the trim are one statement pair rather than a trigger:
    /// a trigger on insert fires again on its own delete, and the table is
    /// written by a push handler whose whole budget is a few seconds.
    pub fn record_push_run(
        &mut self,
        activity_id: &str,
        outcome: &str,
        detail: Option<&str>,
        kept: i64,
    ) -> SqlResult<()> {
        let tx = self.db.transaction()?;
        tx.execute(
            "INSERT INTO push_runs (ts, activity_id, outcome, detail)
             VALUES (strftime('%s', 'now'), ?, ?, ?)",
            rusqlite::params![activity_id, outcome, detail],
        )?;
        tx.execute(
            "DELETE FROM push_runs WHERE id NOT IN
                 (SELECT id FROM push_runs ORDER BY ts DESC, id DESC LIMIT ?)",
            rusqlite::params![kept],
        )?;
        tx.commit()
    }

    /// Take whatever another process wrote since this engine last looked, and
    /// say whether there was anything to take.
    ///
    /// The comparison is the whole point: a foreground that reloaded on every
    /// resume would pay `load_sections` for nothing on the common resume, and
    /// one that reloaded on a flag would lose a push that landed between the
    /// read and the clear.
    pub fn take_external_writes(&mut self) -> bool {
        let token = self.external_write_token();
        if token == self.seen_external_write_token {
            return false;
        }
        if let Err(e) = self.reload_external_writes() {
            log::warn!("veloqrs: [PersistentEngine] reload after an external write: {e}");
        }
        // Advanced whether or not every loader succeeded: a failed loader is
        // logged and retried on the next push rather than on every resume from
        // here to the end of the process.
        self.seen_external_write_token = token;
        true
    }

    /// Re-read the tiers another process can have changed, and nothing else.
    ///
    /// A push handler fetches a body, stores a track, writes the metrics row
    /// and indexes the activity against the catalogue. On Android it does that
    /// through this same engine and the tiers are consistent; on iOS the
    /// notification service extension is a second process against the same
    /// file, so a foreground engine that was alive throughout holds tiers that
    /// predate every one of those rows and nothing says so.
    ///
    /// Deliberately not `load`. Measured on the S22's own 29.2 MB library in a debug app build, so
    /// read the ratios and not the milliseconds: the
    /// five loaders here are 23.9 ms of `load`'s 39.8 ms, of which
    /// `load_sections` alone is 22.3 ms, and the memory saving is 0.7 MB of
    /// 7.7, which is not the reason. The reason is that `load` is not a
    /// read: after the loaders it checks the cutover token, reseeds and
    /// persists two identity registries, and runs an `UPDATE` over the whole
    /// activities table. Doing that on every push would reseed identity and
    /// write under the engine lock for rows that did not move.
    ///
    /// The three settings loaders are left out for the same reason they cost
    /// nothing: a handler writes no config, so re-reading it would only risk
    /// overwriting a slider the athlete moved while the push was in flight.
    ///
    /// A loader that fails is logged and the rest still run, the way `load`
    /// treats them, because a half-refreshed tier is nearer the truth than a
    /// stale one. The evidence cache is restored last and only when all five
    /// succeeded, since it is keyed on the catalogue they just replaced.
    pub fn reload_external_writes(&mut self) -> SqlResult<()> {
        let metadata = self.load_metadata();
        let groups = self.load_groups_with_registry();
        let outcomes = [
            ("metadata", metadata),
            ("groups", groups),
            ("sections", self.load_sections()),
            ("processed_activity_ids", self.load_processed_activity_ids()),
            ("activity_metrics", self.load_activity_metrics()),
        ];
        let mut first_error: Option<rusqlite::Error> = None;
        for (name, result) in outcomes {
            if let Err(e) = result {
                log::error!("veloqrs: [PersistentEngine] reload: {} failed: {}", name, e);
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
        }
        // Every read behind the ladder and the screens is computed from the
        // tiers just replaced, so a cache kept across them answers for rows
        // that are gone.
        self.clear_memory_caches();
        if first_error.is_none() {
            self.restore_evidence_cache();
        }
        match first_error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    pub fn load(&mut self) -> SqlResult<()> {
        self.load_in_mode(EngineOpenMode::Foreground)
    }

    /// `load` for a push handler's engine. The metadata backfill and the
    /// identity registry write are repairs the next foreground open makes, and
    /// a push has a few seconds and no need of either.
    pub fn load_for_push(&mut self) -> SqlResult<()> {
        self.load_in_mode(EngineOpenMode::Push)
    }

    fn load_in_mode(&mut self, mode: EngineOpenMode) -> SqlResult<()> {
        // Before the groups: whether they stand is a question about the rule
        // they were made under, and the rule is what this loads.
        let match_strictness = self.load_match_strictness_from_settings();
        let outcomes = [
            ("metadata", self.load_metadata()),
            ("groups", self.load_groups()),
            ("sections", self.load_sections()),
            ("processed_activity_ids", self.load_processed_activity_ids()),
            ("activity_metrics", self.load_activity_metrics()),
            ("match_strictness", match_strictness),
            ("section_config", self.load_section_config_from_settings()),
        ];
        let mut first_error: Option<rusqlite::Error> = None;
        for (name, result) in outcomes {
            if let Err(e) = result {
                log::error!("veloqrs: [PersistentEngine] load: {} failed: {}", name, e);
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
        }
        let loaded_whole = first_error.is_none();
        if mode == EngineOpenMode::Foreground {
            self.refresh_section_rank_inputs();
            // After the groups load, which numbers any route that has no
            // number yet. A library upgraded with stored groups has no layer.
            if let Err(e) = route_lines::ensure_current(&self.db) {
                log::warn!("veloqrs: [PersistentEngine] route line layer: {}", e);
            }
        }
        // The tiers now speak for the file as it stands, handler writes and
        // all, so nothing read here is owed a reload.
        self.seen_external_write_token = self.external_write_token();
        if let Some(e) = first_error
            && is_corruption_error(&e)
        {
            return Err(e);
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

        // Prefer the persisted registry blob (exact debounce + tombstone
        // state). Failing that, seed the identity registry from the sections
        // just loaded so an existing install adopts its current ids as stable
        // seeds. The evidence cache stays cold (the next detect cold-rebatches),
        // but identity is preserved: a resync carries the seeded ids onto their
        // surviving ground rather than re-deriving them. Must run after both
        // `sections` and `metadata` load so it sees the managed catalogue and
        // the activity set.
        // A reseed off a truncated `sections` (a loader error this function
        // deliberately continues past) stays in memory, so the next open reseeds
        // from the whole catalogue instead of restoring the truncation.
        if !self.section_identity_restore() {
            self.section_identity_reseed();
            if loaded_whole && mode == EngineOpenMode::Foreground {
                self.section_identity_persist();
            }
        }

        // Same for routes: restore the persisted registry (mint counter +
        // seniority), else adopt the loaded group_ids as stable seeds. Must run
        // after `groups` load.
        if !self.route_identity_restore() {
            self.route_identity_reseed();
        }

        // Repair for libraries written before the activity write filled these
        // itself. The fitness import remains authoritative.
        let backfilled = if mode == EngineOpenMode::Foreground {
            self.fill_activity_metadata_from_metrics(None).unwrap_or(0)
        } else {
            0
        };
        if backfilled > 0 {
            log::info!(
                "veloqrs: [PersistentEngine] Backfilled activity metadata for {} activities",
                backfilled
            );
        }

        // If activities exist but none are marked as processed (migration cleared the table),
        // mark sections as dirty so re-detection runs with the updated algorithm.
        if !self.activity_metadata.is_empty() && self.processed_activity_ids.is_empty() {
            log::info!(
                "veloqrs: [PersistentEngine] {} activities but no processed IDs - marking sections dirty for re-detection",
                self.activity_metadata.len()
            );
            self.sections_dirty = true;
        }

        // Warm the named-corridor overlay so memory-only listings (which may not
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
    #[doc(hidden)]
    pub fn match_config_min_match_percentage(&self) -> f64 {
        self.match_config.min_match_percentage
    }

    /// Read-only access to the active `match_config.endpoint_threshold`.
    #[doc(hidden)]
    pub fn match_config_endpoint_threshold(&self) -> f64 {
        self.match_config.endpoint_threshold
    }

    /// Read-only accessors for `section_config` fields. Mirror the
    /// MatchConfig getters above so integration tests can verify
    /// persisted SectionConfig without crate-private access.
    pub fn get_section_config(&self) -> SectionConfig {
        self.section_config.clone()
    }

    #[doc(hidden)]
    pub fn section_config_proximity_threshold(&self) -> f64 {
        self.section_config.proximity_threshold
    }
    #[doc(hidden)]
    pub fn section_config_min_section_length(&self) -> f64 {
        self.section_config.min_section_length
    }
    #[doc(hidden)]
    pub fn section_config_min_activities(&self) -> u32 {
        self.section_config.min_activities
    }

    /// Set section configuration.
    ///
    /// Refused with `CutoverOwed` while the detector cutover is owed: the flip
    /// resets the config to the defaults, so a value written now would be
    /// reported as saved and then replaced.
    pub fn set_section_config(
        &mut self,
        config: SectionConfig,
    ) -> Result<(), sections::DetectionRefusal> {
        // A config identical to the active one is a NO-OP. The TS init path
        // re-sends the persisted config on every launch (GlobalDataSync applies
        // the strictness preset whenever detectionStrictness != 60), so without
        // this guard every launch would clear the processed set and force a full
        // re-detect for any user who has ever moved the strictness slider. Only a
        // GENUINE change runs the re-analysis tail below. Equality is exact, but
        // the config round-trips through the settings table as the same f64/u32
        // strings, so a re-sent config compares equal.
        if config == self.section_config {
            return Ok(());
        }
        if self.cutover_is_owed() {
            return Err(sections::DetectionRefusal::CutoverOwed);
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
                "veloqrs: [set_section_config] failed to persist proximity_threshold: {}",
                e
            );
        }
        if let Err(e) = self.set_setting(
            settings_keys::SECTION_MIN_LENGTH,
            &config.min_section_length.to_string(),
        ) {
            log::warn!(
                "veloqrs: [set_section_config] failed to persist min_section_length: {}",
                e
            );
        }
        if let Err(e) = self.set_setting(
            settings_keys::SECTION_MIN_ACTIVITIES,
            &config.min_activities.to_string(),
        ) {
            log::warn!(
                "veloqrs: [set_section_config] failed to persist min_activities: {}",
                e
            );
        }
        // Persist the WHOLE config so a restart restores every field, not just the
        // three slider keys above. This is what makes the TS launch re-apply a true
        // no-op (see the SECTION_CONFIG_JSON key doc); the loader prefers it.
        match serde_json::to_string(&config) {
            Ok(json) => {
                if let Err(e) = self.set_setting(settings_keys::SECTION_CONFIG_JSON, &json) {
                    log::warn!(
                        "veloqrs: [set_section_config] failed to persist config blob: {}",
                        e
                    );
                }
            }
            Err(e) => log::warn!(
                "veloqrs: [set_section_config] failed to serialise config blob: {}",
                e
            ),
        }

        self.section_config = config;
        // A config change alters what detection would find, so the
        // whole library must be re-analysed. The processed set is insert-only and
        // would otherwise short-circuit the next detect on the seen activities;
        // clearing it forces a full re-detect under the new config.
        self.clear_processed_activity_ids();
        self.sections_dirty = true;
        // A config change invalidates the debounce, not the identities: the
        // registry is rebuilt from the catalogue so ids carry, and the next fold
        // applies the new params' answer in one step.
        self.section_identity_reseed_decisive();
        Ok(())
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
        // section id, direction, start, end, distance, lap time, lap pace
        type EntryRow = (String, String, i32, i32, f64, Option<f64>, Option<f64>);
        let section_entries: Vec<EntryRow> = self
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
                log::warn!("veloqrs: debug_clone_activity section query failed: {e:?}");
                Vec::new()
            });

        // Written through the one metrics writer after the loop, so the clones
        // reach the heatmap and their activity rows as a synced row does.
        let mut clone_metrics: Vec<ActivityMetrics> = Vec::new();

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
                log::warn!("veloqrs: debug_clone_activity activity insert failed: {e:?}");
                continue;
            }

            if let Some(ref metrics) = source_metrics {
                clone_metrics.push(ActivityMetrics {
                    activity_id: clone_id.clone(),
                    ..metrics.clone()
                });
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
                    log::warn!("veloqrs: debug_clone_activity section insert failed: {e:?}");
                }
            }

            // Add to in-memory metadata
            self.activity_metadata.insert(
                clone_id.clone(),
                ActivityMetadata {
                    id: clone_id,
                    sport_type: source_meta.sport_type.clone(),
                    bounds: source_meta.bounds,
                    start_point: source_meta.start_point,
                },
            );

            created += 1;
        }

        if let Err(e) = self.set_activity_metrics(clone_metrics) {
            log::warn!("veloqrs: debug_clone_activity metrics write failed: {e:?}");
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
        let mut stats = pooled_stats(&self.db);
        stats.activity_count = self.activity_metadata.len() as u32;
        stats.signature_cache_size = self.signature_cache.len() as u32;
        stats.group_count = self.groups.len() as u32;
        stats.section_count = self.sections.len() as u32;
        stats.groups_dirty = self.groups_dirty;
        stats.sections_dirty = self.sections_dirty;
        stats
    }

    /// The routes screen read on the engine's own connection, which sees its
    /// own writes and its own `groups_dirty`. The assembly is the pooled one
    /// the export takes, so a test through here runs what production runs.
    pub fn get_routes_screen_data(
        &self,
        query: crate::FfiRoutesScreenQuery,
    ) -> crate::FfiRoutesScreenData {
        routes_screen_data(&self.db, query, self.groups_dirty)
    }
}

/// Engine statistics from committed rows, and from the values published each
/// time the write lock was let go for the two flags and the cache length that
/// exist only in memory. The counts are the rows the engine's catalogues load
/// from, so they equal its own while no write is in flight.
pub(crate) fn pooled_stats(conn: &Connection) -> PersistentEngineStats {
    let count = |sql: &str| -> u32 { conn.query_row(sql, [], |row| row.get(0)).unwrap_or(0) };
    let (oldest_date, newest_date): (Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT MIN(date), MAX(date) FROM activity_metrics",
            [],
            |row| Ok((row.get(0).ok(), row.get(1).ok())),
        )
        .unwrap_or((None, None));
    PersistentEngineStats {
        activity_count: count("SELECT COUNT(*) FROM activities"),
        library_count: count("SELECT COUNT(*) FROM activity_metrics"),
        signature_cache_size: SIGNATURE_CACHE_LEN_FOR_READERS.load(Ordering::Acquire),
        group_count: count("SELECT COUNT(*) FROM route_groups"),
        section_count: count("SELECT COUNT(*) FROM sections"),
        groups_dirty: groups_dirty_for_readers(),
        sections_dirty: SECTIONS_DIRTY_FOR_READERS.load(Ordering::Acquire),
        gps_track_count: count("SELECT COUNT(*) FROM gps_tracks"),
        oldest_date: oldest_date.map(|v| v as f64),
        newest_date: newest_date.map(|v| v as f64),
        activity_window_oldest: held_window_oldest(conn),
    }
}

/// The held window for the athlete the library is stored for. With no athlete
/// the window is the default one, as a legacy fallback read off the stored
/// bodies would name a library nobody has signed in to.
fn held_window_oldest(conn: &Connection) -> String {
    let athlete: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![settings_keys::ATHLETE_ID],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    activities::pooled::activity_window_oldest(conn, athlete.as_deref().unwrap_or(""))
}

/// The committed catalogue for the routes screen. A deferred regroup is
/// announced through the engine's reader-visible dirty flag.
pub(crate) fn pooled_routes_screen_data(
    conn: &Connection,
    query: crate::FfiRoutesScreenQuery,
) -> crate::FfiRoutesScreenData {
    routes_screen_data(conn, query, groups_dirty_for_readers())
}

/// Every group and section the catalogue holds, then the search, the filters
/// and the order, and only then the page.
fn routes_screen_data(
    conn: &Connection,
    query: crate::FfiRoutesScreenQuery,
    groups_dirty: bool,
) -> crate::FfiRoutesScreenData {
    let (oldest_date, newest_date): (Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT MIN(date), MAX(date) FROM activity_metrics",
            [],
            |row| Ok((row.get(0).ok(), row.get(1).ok())),
        )
        .unwrap_or((None, None));
    let group_page = pooled_route_group_page(conn, &query);
    let section_page = pooled_route_section_page(conn, &query);
    let activity_count = activities::pooled::activity_count(conn).unwrap_or(0);
    crate::FfiRoutesScreenData {
        activity_count,
        group_count: group_page.total_count,
        section_count: section_page.total_count,
        oldest_date: oldest_date.map(|date| date as f64),
        newest_date: newest_date.map(|date| date as f64),
        groups: group_page.groups,
        sections: section_page.sections,
        has_more_groups: group_page.has_more,
        has_more_sections: section_page.has_more,
        groups_dirty,
        filtered_group_count: group_page.filtered_count,
        filtered_section_count: section_page.filtered_count,
        unaccepted_auto_count: section_page.unaccepted_auto_count,
        accepted_auto_count: section_page.accepted_auto_count,
        custom_count: section_page.custom_count,
        retired_count: section_page.retired_count,
        available_sport_types: read_cache::sport_types(|| {
            screens::pooled::available_sport_types(conn)
        }),
    }
}

struct PooledGroupPage {
    groups: Vec<crate::FfiGroupWithPolyline>,
    total_count: u32,
    filtered_count: u32,
    has_more: bool,
}

fn pooled_route_group_page(
    conn: &Connection,
    query: &crate::FfiRoutesScreenQuery,
) -> PooledGroupPage {
    let min_group_activity_count = query.min_group_activity_count;
    let group_needle = query.group_search.trim().to_lowercase();
    let group_sort = query.group_sort;
    let group_offset = query.group_offset;
    let group_limit = query.group_limit;
    let user_lat = query.user_lat;
    let user_lng = query.user_lng;
    // Every group the catalogue holds, then the search and the minimum
    // activity count, then the order, and only then the page. Doing any of
    // it after the page would order fifty rows and call it the library.
    // Only a search and the name order read the shown name of every group, so
    // any other list reads names for its page alone.
    let reads_names = !group_needle.is_empty() || matches!(group_sort, crate::FfiGroupSort::Name);
    let mut raw_summaries = routes::pooled::group_keys(
        conn,
        matches!(group_sort, crate::FfiGroupSort::Distance),
        reads_names,
    );
    if let Some(sport) = query.group_sport_type.as_deref() {
        routes::pooled::fill_page_details(conn, &mut raw_summaries);
        raw_summaries.retain(|g| in_sport(&g.sport_types, sport));
    }
    let total_groups = raw_summaries.len();
    if min_group_activity_count > 0 {
        raw_summaries.retain(|g| g.activity_count >= min_group_activity_count);
    }
    if !group_needle.is_empty() {
        raw_summaries.retain(|g| {
            g.custom_name
                .as_deref()
                .is_some_and(|n| n.to_lowercase().contains(&group_needle))
        });
    }
    // The representative's distance is what the list shows, so it is what
    // the distance order has to read, and the summary carries it.
    sort_pooled_groups(&mut raw_summaries, group_sort, user_lat, user_lng);
    let filtered_group_count = raw_summaries.len();
    let paged_summaries: Vec<_> = raw_summaries
        .into_iter()
        .skip(group_offset as usize)
        .take(group_limit as usize)
        .collect();
    let has_more_groups = filtered_group_count > (group_offset as usize + paged_summaries.len());

    let mut paged_summaries = paged_summaries;
    if !reads_names {
        routes::pooled::name_groups(conn, &mut paged_summaries);
    }
    routes::pooled::fill_page_details(conn, &mut paged_summaries);
    let groups = pooled_group_rows(conn, paged_summaries);

    PooledGroupPage {
        groups,
        total_count: total_groups as u32,
        filtered_count: filtered_group_count as u32,
        has_more: has_more_groups,
    }
}

fn pooled_group_rows(
    conn: &Connection,
    paged_summaries: Vec<GroupSummary>,
) -> Vec<crate::FfiGroupWithPolyline> {
    // Batch-load representative polylines from signatures table (1 query instead of N)
    let rep_ids: Vec<&str> = paged_summaries
        .iter()
        .map(|g| g.representative_id.as_str())
        .collect();
    let rep_polylines = routes::pooled::representative_polylines(conn, &rep_ids);

    let groups: Vec<crate::FfiGroupWithPolyline> = paged_summaries
        .into_iter()
        .map(|g| {
            let encoded_polyline = rep_polylines
                .get(&g.representative_id)
                .cloned()
                .unwrap_or_default();
            crate::FfiGroupWithPolyline {
                group_id: g.group_id,
                representative_id: g.representative_id,
                activity_count: g.activity_count,
                custom_name: g.custom_name,
                bounds: g.bounds,
                distance_meters: g.distance_meters,
                encoded_polyline,
                sport_types: g.sport_types,
            }
        })
        .collect();

    groups
}

struct PooledSectionPage {
    sections: Vec<crate::FfiSectionWithPolyline>,
    total_count: u32,
    filtered_count: u32,
    has_more: bool,
    unaccepted_auto_count: u32,
    accepted_auto_count: u32,
    custom_count: u32,
    retired_count: u32,
}

fn pooled_route_section_page(
    conn: &Connection,
    query: &crate::FfiRoutesScreenQuery,
) -> PooledSectionPage {
    let section_needle = query.section_search.trim().to_lowercase();
    let section_sort = query.section_sort;
    let section_filters = &query.section_filters;
    let section_offset = query.section_offset;
    let section_limit = query.section_limit;
    let within_sport = query.section_sport_type.is_some();
    let user_lat = query.user_lat;
    let user_lng = query.user_lng;
    // Removed sections are listed too, behind the Removed filter, so the
    // catalogue total counts only the visible ones. The catalogue is read for
    // the columns the filters and the order need, and only the page is read
    // in full.
    // Only a search and the name order read the shown name of every section,
    // so any other list builds names for its page alone.
    let reads_names =
        !section_needle.is_empty() || matches!(section_sort, crate::FfiSectionSort::Name);
    let all_names = reads_names.then(|| sections::named::pooled::overlay_names(conn));
    let mut raw_sections = sections::queries::pooled::section_list_keys(conn, all_names.as_deref());
    if let Some(sport) = query.section_sport_type.as_deref() {
        raw_sections.retain(|s| in_sport(&s.sport_types, sport));
    }
    let total_sections = raw_sections
        .iter()
        .filter(|s| !s.disabled && s.superseded_by.is_none())
        .count();

    let (unaccepted_auto_count, accepted_auto_count, custom_count, retired_count) =
        pooled_section_counts(conn, &raw_sections);

    raw_sections.retain(|s| !section_filters_hide(section_filters, s));
    if !section_needle.is_empty() {
        raw_sections.retain(|s| {
            s.name
                .as_deref()
                .is_some_and(|n| n.to_lowercase().contains(&section_needle))
        });
    }
    sort_pooled_sections(
        &mut raw_sections,
        section_sort,
        within_sport,
        user_lat,
        user_lng,
    );
    // A removed section follows every visible one, in the same order.
    raw_sections.sort_by_key(|s| s.disabled || s.superseded_by.is_some());
    let filtered_section_count = raw_sections.len();
    let page_ids: Vec<&str> = raw_sections
        .iter()
        .skip(section_offset as usize)
        .take(section_limit as usize)
        .map(|s| s.id.as_str())
        .collect();
    let has_more_sections = filtered_section_count > (section_offset as usize + page_ids.len());
    let page_names;
    let names = match all_names.as_deref() {
        Some(names) => names,
        None => {
            page_names = sections::named::pooled::overlay_names_for(conn, &page_ids);
            &page_names
        }
    };
    let paged_sections =
        sections::queries::pooled::section_summaries_by_ids(conn, &page_ids, names);

    let sections = pooled_section_rows(conn, paged_sections, query.section_sport_type.as_deref());

    PooledSectionPage {
        sections,
        total_count: total_sections as u32,
        filtered_count: filtered_section_count as u32,
        has_more: has_more_sections,
        unaccepted_auto_count,
        accepted_auto_count,
        custom_count,
        retired_count,
    }
}

/// Whether a group or section recorded in `sport_types` belongs to `sport`.
fn in_sport(sport_types: &[String], sport: &str) -> bool {
    sport_types.iter().any(|s| s == sport)
}

fn pooled_section_counts(conn: &Connection, summaries: &[SectionSummary]) -> (u32, u32, u32, u32) {
    // The four counters are the catalogue's, not the page's, so they are
    // taken before anything is hidden or paged.
    let mut unaccepted_auto_count: u32 = 0;
    let mut accepted_auto_count: u32 = 0;
    let mut custom_count: u32 = 0;
    let retired_count = conn.query_row(
            "SELECT COUNT(*) FROM sections WHERE section_type = 'auto' AND (disabled = 1 OR superseded_by IS NOT NULL)",
            [],
            |row| row.get(0),
        ).unwrap_or(0);
    for s in summaries {
        if is_visible_auto(s) {
            if s.is_user_defined {
                accepted_auto_count += 1;
            } else {
                unaccepted_auto_count += 1;
            }
        }
        if s.section_type == "custom" {
            custom_count += 1;
        }
    }

    (
        unaccepted_auto_count,
        accepted_auto_count,
        custom_count,
        retired_count,
    )
}

fn pooled_section_rows(
    conn: &Connection,
    paged_sections: Vec<SectionSummary>,
    selected_sport: Option<&str>,
) -> Vec<crate::FfiSectionWithPolyline> {
    // Batch-load section polylines (1 query instead of N)
    let section_ids: Vec<&str> = paged_sections.iter().map(|s| s.id.as_str()).collect();
    let section_polylines = sections::pooled::section_polylines(conn, &section_ids);
    let latest_is_record = sections::pooled::sections_where_latest_is_record(conn, &section_ids);
    let trends = sections::ranking::pooled::page_trends(conn, &section_ids, selected_sport);

    let sections: Vec<crate::FfiSectionWithPolyline> = paged_sections
        .into_iter()
        .map(|s| {
            let encoded_polyline = section_polylines.get(&s.id).cloned().unwrap_or_default();
            let latest_is_record = latest_is_record.contains(&s.id);
            let trend = trends.get(&s.id).copied();
            crate::FfiSectionWithPolyline {
                id: s.id,
                name: s.name,
                section_type: s.section_type,
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
                latest_is_record,
                trend,
            }
        })
        .collect();

    sections
}

fn sort_pooled_sections(
    sections: &mut [SectionSummary],
    section_sort: crate::FfiSectionSort,
    within_sport: bool,
    user_lat: f64,
    user_lng: f64,
) {
    let has_user_location = user_lat.is_finite() && user_lng.is_finite();
    match section_sort {
        crate::FfiSectionSort::Nearby if has_user_location => {
            sections.sort_by(|a, b| {
                let dist_a = bounds_center_distance_meters(a.bounds.as_ref(), user_lat, user_lng);
                let dist_b = bounds_center_distance_meters(b.bounds.as_ref(), user_lat, user_lng);
                dist_a
                    .partial_cmp(&dist_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| b.visit_count.cmp(&a.visit_count))
            });
        }
        crate::FfiSectionSort::Signature => {
            // A section the engine has not ranked sorts last, which is what
            // the list did with -1.
            let score = |s: &SectionSummary| -> f64 {
                let pooled = s.rank_score;
                if within_sport {
                    s.sport_rank_score.or(pooled).unwrap_or(-1.0)
                } else {
                    pooled.unwrap_or(-1.0)
                }
            };
            sections.sort_by(|a, b| {
                score(b)
                    .partial_cmp(&score(a))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
        crate::FfiSectionSort::Distance => {
            sections.sort_by(|a, b| {
                b.distance_meters
                    .partial_cmp(&a.distance_meters)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
        // The name the list shows, which is the id where there is none,
        // folded so case does not split the alphabet.
        crate::FfiSectionSort::Name => {
            sections.sort_by_cached_key(|s| {
                (
                    name_sort_key(s.name.as_deref().unwrap_or(&s.id)),
                    s.id.clone(),
                )
            });
        }
        _ => sections.sort_by(|a, b| {
            b.visit_count
                .cmp(&a.visit_count)
                .then_with(|| a.id.cmp(&b.id))
        }),
    }
}

/// The key a Name sort orders by: lowercase with Latin accents removed, so
/// "Épalinges" sorts among the E names and case does not split the alphabet.
fn name_sort_key(name: &str) -> String {
    name.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'à'..='å' | 'ā' | 'ă' | 'ą' => 'a',
            'ç' | 'ć' | 'č' => 'c',
            'ď' | 'đ' => 'd',
            'è'..='ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
            'ğ' => 'g',
            'ì'..='ï' | 'ī' | 'į' | 'ı' => 'i',
            'ł' => 'l',
            'ñ' | 'ń' | 'ň' => 'n',
            'ò'..='ö' | 'ø' | 'ō' | 'ő' => 'o',
            'ř' => 'r',
            'ś' | 'š' | 'ş' => 's',
            'ť' | 'ţ' => 't',
            'ù'..='ü' | 'ū' | 'ů' | 'ű' | 'ų' => 'u',
            'ý' | 'ÿ' => 'y',
            'ź' | 'ż' | 'ž' => 'z',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod name_sort_key_tests {
    use super::name_sort_key;

    #[test]
    fn orders_mixed_case_and_accented_names_alphabetically() {
        let mut names = ["Zurich loop", "alpine climb", "Épalinges drag", "Östersund"];
        names.sort_by_key(|n| name_sort_key(n));
        assert_eq!(
            names,
            ["alpine climb", "Épalinges drag", "Östersund", "Zurich loop"]
        );
    }
}

fn sort_pooled_groups(
    groups: &mut [GroupSummary],
    sort: crate::FfiGroupSort,
    user_lat: f64,
    user_lng: f64,
) {
    match sort {
        crate::FfiGroupSort::Nearby if user_lat.is_finite() && user_lng.is_finite() => {
            groups.sort_by(|a, b| {
                let a_distance =
                    bounds_center_distance_meters(a.bounds.as_ref(), user_lat, user_lng);
                let b_distance =
                    bounds_center_distance_meters(b.bounds.as_ref(), user_lat, user_lng);
                a_distance
                    .partial_cmp(&b_distance)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| b.activity_count.cmp(&a.activity_count))
            });
        }
        crate::FfiGroupSort::Distance => groups.sort_by(|a, b| {
            b.distance_meters
                .partial_cmp(&a.distance_meters)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.group_id.cmp(&b.group_id))
        }),
        crate::FfiGroupSort::Name => groups.sort_by_cached_key(|g| {
            (
                name_sort_key(g.custom_name.as_deref().unwrap_or(&g.group_id)),
                g.group_id.clone(),
            )
        }),
        _ => groups.sort_by_key(|group| std::cmp::Reverse(group.activity_count)),
    }
}

/// Statistics for the persistent engine.

#[derive(Debug, Clone, uniffi::Record)]
pub struct PersistentEngineStats {
    /// Activities with a mirrored GPS-backed row.
    pub activity_count: u32,
    /// Activities in the library, with or without GPS: what the athlete holds.
    pub library_count: u32,
    pub signature_cache_size: u32,
    pub group_count: u32,
    pub section_count: u32,
    pub groups_dirty: bool,
    pub sections_dirty: bool,
    pub gps_track_count: u32,
    /// Oldest activity date (Unix timestamp in seconds), or None if no activities
    pub oldest_date: Option<f64>,
    /// Newest activity date (Unix timestamp in seconds), or None if no activities
    pub newest_date: Option<f64>,
    /// The oldest date the athlete has asked the device to hold, as `YYYY-MM-DD`.
    /// Unlike `oldest_date` it leaves out activities kept only because a
    /// section or record names them.
    pub activity_window_oldest: String,
}

// ============================================================================
// Global Singleton for FFI
// ============================================================================

/// Global persistent engine instance.
///
/// This singleton allows FFI calls to access a shared persistent engine
/// without passing state back and forth across the FFI boundary.
///
/// A `Mutex`, not an `RwLock`: nothing holds a shared `&PersistentEngine` any
/// more. Every caller that reaches the engine gets `&mut` under this lock, and
/// a read that only needs SQLite goes to `read_pool::with_read_conn`, which
/// opens against the same database, takes no engine lock at all, and so
/// neither waits on the writer nor shares a connection with it. That path sees
/// committed rows only, never the engine's in-memory tier and never a write
/// still in flight.
///
/// That is also why `PersistentEngine` needs no `unsafe impl Sync`. It holds a
/// `rusqlite::Connection`, which is `Send + !Sync`, and the impl existed only
/// so a read guard could hand out `&PersistentEngine` across threads. With no
/// such guard the compiler carries the invariant a hand-written lint used to:
/// a shared borrow of the engine will not compile.
pub static PERSISTENT_ENGINE: LazyLock<Mutex<Option<PersistentEngine>>> =
    LazyLock::new(|| Mutex::new(None));

/// Serialises lifecycle decisions with init, including a push that arrives
/// while a restore has closed the engine.
static ENGINE_LIFECYCLE: Mutex<()> = Mutex::new(());
static RESTORE_CLOSING: AtomicBool = AtomicBool::new(false);

pub fn close_for_restore() {
    let _lifecycle = ENGINE_LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
    RESTORE_CLOSING.store(true, Ordering::Release);
    let mut engine = PERSISTENT_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    *engine = None;
    ENGINE_INSTALL.fetch_add(1, Ordering::AcqRel);
    drop(engine);
    read_pool::close();
}

/// Which install of the process-wide engine is open, counted from one.
///
/// A cancel is cooperative, so a worker already past its last check reaches
/// its write whatever `destroy` did, and `with_persistent_engine` hands it
/// whichever database is open by then. A restore is the case that hurts: the
/// file at the same path is a different library, so the path cannot tell them
/// apart, and the lease generation cannot either because it lives in the file
/// and a restored backup carries its own.
///
/// This counter lives in the process. It is bumped every time a database is
/// installed below, so a worker that captured it at spawn and hands it back
/// through [`with_persistent_engine_for`] is refused the moment the engine it
/// started against is no longer the one open.
static ENGINE_INSTALL: AtomicU64 = AtomicU64::new(0);

/// The install a worker starting now belongs to. Zero before the first open,
/// which no install ever equals, so a stamp taken before one is refused.
pub fn engine_install() -> u64 {
    ENGINE_INSTALL.load(Ordering::Acquire)
}

/// Invalidate work captured before an account wipe starts.
pub fn invalidate_engine_install() {
    {
        let _lifecycle = ENGINE_LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
        let _guard = PERSISTENT_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
        ENGINE_INSTALL.fetch_add(1, Ordering::AcqRel);
    }
    #[cfg(test)]
    run_after_invalidate();
}

/// Work a test starts once the install has moved and both locks are free,
/// which for a clear is the window between its retire and its wipe.
#[cfg(test)]
type AfterInvalidate = Box<dyn FnOnce() + Send>;

#[cfg(test)]
pub(crate) static AFTER_INVALIDATE: Mutex<Option<AfterInvalidate>> = Mutex::new(None);

/// Work a test runs once a clear's wipe has committed and before the install
/// moves, with the wipe's locks still held.
#[cfg(test)]
pub(crate) static AFTER_WIPE: Mutex<Option<AfterInvalidate>> = Mutex::new(None);

#[cfg(test)]
fn run_after_invalidate() {
    run_hook(&AFTER_INVALIDATE);
}

#[cfg(test)]
fn run_hook(slot: &Mutex<Option<AfterInvalidate>>) {
    let hook = slot.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(hook) = hook {
        hook();
    }
}

/// Run a clear's wipe for a job that started against `install`, and move the
/// install before the write lock is released.
///
/// The clear retired the running jobs when it began, but a detection started
/// between that retire and this lock captures the install the retire left
/// open, together with a snapshot of the catalogue about to go, and its save
/// would pass the install check after the wipe. Moving the install again
/// inside the same hold refuses that run. The lifecycle lock is held across
/// the wipe's commit and the move, so a worker's check and commit in
/// `worker_write` lands wholly before the wipe or is refused after it.
pub(crate) fn wipe_with_persistent_engine_for<F, R>(install: u64, f: F) -> Option<R>
where
    F: FnOnce(&mut PersistentEngine) -> R,
{
    let _lifecycle = ENGINE_LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
    with_persistent_engine_for(install, |engine| {
        let result = f(engine);
        #[cfg(test)]
        run_hook(&AFTER_WIPE);
        ENGINE_INSTALL.fetch_add(1, Ordering::AcqRel);
        result
    })
}

/// Put the memory tiers back in step with SQLite after a panic under the write
/// lock.
///
/// SQLite rolls a dropped transaction back. `activity_metadata`, the spatial
/// index, `groups`, `sections`, the identity registries and the six LRUs do not
/// go with it, so a panic between a memory write and its row write leaves the
/// two disagreeing and every later read through the recovered lock serves a
/// catalogue the database does not hold.
///
/// This is the load `initWithPath` runs, about 130 ms on a 490-activity
/// library, paid once by whoever takes the lock next rather than by the call
/// that panicked. Chosen over reordering the memory and row writes at every
/// mutation site, which is many more places to keep right.
fn reload_after_poison(engine: &mut PersistentEngine) {
    log::warn!("veloqrs: [Engine] write lock was poisoned; reloading the memory tiers from SQLite");
    if let Err(e) = engine.load() {
        log::error!(
            "veloqrs: [Engine] could not reload the memory tiers after a poison: {:?}",
            e
        );
    }
    // The loaders refill what they own; nothing refills a cache, so each is
    // emptied and warms again from the reloaded tiers.
    engine.clear_memory_caches();
}

/// Close the process-wide engine, so a test can exercise the path a caller
/// takes before init has run. Every fixture that opens one takes
/// `serial_global_state` first, so this cannot land under another test.
#[cfg(test)]
pub(crate) fn clear_persistent_engine() {
    *PERSISTENT_ENGINE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    RESTORE_CLOSING.store(false, Ordering::Release);
    read_pool::close();
}

/// Acquire the **write** lock on the global persistent engine.
///
/// For a mutation (`add_*`, `set_*`, `save_*`, `clear_*`, `apply_*`,
/// `remove_*`, `detect_*`) and for a read that needs engine memory: the
/// in-memory tiers, the configs, or a lookup that fills an engine LRU. A read
/// of committed rows alone goes to `read_pool::with_read_conn`, which the
/// export layer reaches as `with_reader`, and takes no engine lock.
#[track_caller]
pub fn with_persistent_engine<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut PersistentEngine) -> R,
{
    with_persistent_engine_at(std::panic::Location::caller(), f)
}

/// The write-lock take itself, keyed by the call site that asked for it.
///
/// `caller` is only read by the `lock-trace` feature, which times the wait
/// and the hold per site so the lock can be measured rather than argued about.
pub fn with_persistent_engine_at<F, R>(
    caller: &'static std::panic::Location<'static>,
    f: F,
) -> Option<R>
where
    F: FnOnce(&mut PersistentEngine) -> R,
{
    #[cfg(not(feature = "lock-trace"))]
    let _ = caller;
    #[cfg(feature = "lock-trace")]
    let mut timing = lock_trace::Timing::begin(caller);
    // Poison recovery: builds unwind on panic, and refusing a poisoned lock
    // here would disable the engine for the rest of the session. The data is
    // taken back, and the tiers the panic left ahead of SQLite are reloaded
    // once per panic, by the first caller through.
    let mut guard = match PERSISTENT_ENGINE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            let mut guard = poisoned.into_inner();
            if let Some(engine) = guard.as_mut() {
                reload_after_poison(engine);
            }
            PERSISTENT_ENGINE.clear_poison();
            guard
        }
    };
    #[cfg(feature = "lock-trace")]
    timing.acquired();
    guard.as_mut().map(|engine| {
        follow_group_commit_off_engine(engine);
        let result = f(engine);
        publish_for_readers(engine);
        result
    })
}

/// The one point the engine catches up with a route group write the
/// background regroup committed on its own connection, before the caller reads
/// memory. Every reader of the in-memory catalogue sits behind the lock, so
/// none of them needs a check of its own.
fn follow_group_commit_off_engine(engine: &mut PersistentEngine) {
    if route_identity::take_group_commit_off_engine() {
        engine.follow_committed_groups();
    }
}

/// `with_persistent_engine` for a job that started against one install.
///
/// `install` is what [`engine_install`] answered when the job began. A run
/// that outlived its library, which is what a restore or a Clear and Sync
/// mid-detection leaves, is refused here rather than writing a catalogue
/// computed from the old database into the new one. `None` is the same answer
/// a closed engine gives, so a caller already handling that handles this.
#[track_caller]
pub fn with_persistent_engine_for<F, R>(install: u64, f: F) -> Option<R>
where
    F: FnOnce(&mut PersistentEngine) -> R,
{
    let caller = std::panic::Location::caller();
    with_persistent_engine_at(caller, |engine| {
        // Read under the lock the install is written under, so the answer
        // belongs to the engine this closure was handed.
        let open = ENGINE_INSTALL.load(Ordering::Acquire);
        if open != install {
            log::warn!(
                "veloqrs: [Engine] discarding work from install {} against install {}",
                install,
                open
            );
            return None;
        }
        Some(f(engine))
    })
    .flatten()
}

/// Run a best-effort mutation only when the original engine is immediately available.
pub(crate) fn try_with_persistent_engine_for<F, R>(install: u64, f: F) -> Option<R>
where
    F: FnOnce(&mut PersistentEngine) -> R,
{
    let mut guard = match PERSISTENT_ENGINE.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::WouldBlock) => return None,
        Err(std::sync::TryLockError::Poisoned(poisoned)) => {
            let mut guard = poisoned.into_inner();
            if let Some(engine) = guard.as_mut() {
                reload_after_poison(engine);
            }
            PERSISTENT_ENGINE.clear_poison();
            guard
        }
    };
    if ENGINE_INSTALL.load(Ordering::Acquire) != install {
        return None;
    }
    guard.as_mut().map(|engine| {
        follow_group_commit_off_engine(engine);
        let result = f(engine);
        publish_for_readers(engine);
        result
    })
}

/// `with_persistent_engine` for async callers, off the async workers.
///
/// The engine lock is a blocking `Mutex` and the closure runs SQLite, so taking
/// it directly from an `async fn` parks one of the runtime's worker threads for
/// the whole transaction. There are only eight (`runtime.rs`), and a sync pass
/// takes this lock once per page, so enough concurrent passes starve the pool
/// and unrelated network work stops being polled. `spawn_blocking` moves the
/// wait onto the pool tokio keeps for exactly this.
///
/// The closure is `'static`, so callers hand it owned data rather than a
/// borrow of a local.
///
/// A plain `fn` returning the future rather than an `async fn`, so
/// `#[track_caller]` names the awaiting site and not this function.
#[track_caller]
pub fn with_persistent_engine_blocking<F, R>(f: F) -> impl std::future::Future<Output = Option<R>>
where
    F: FnOnce(&mut PersistentEngine) -> R + Send + 'static,
    R: Send + 'static,
{
    let caller = std::panic::Location::caller();
    async move {
        match crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || with_persistent_engine_at(caller, f))
            .await
        {
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
}

/// `with_persistent_engine_blocking` for a worker that belongs to one install.
///
/// The async sync passes are the same hazard as the detection apply: a page
/// fetched against one library must not be written into the database a restore
/// installed while the request was in flight. `None` is the same answer a
/// closed engine gives, so a caller already handling that handles this.
#[track_caller]
pub fn with_persistent_engine_blocking_for<F, R>(
    install: u64,
    f: F,
) -> impl std::future::Future<Output = Option<R>>
where
    F: FnOnce(&mut PersistentEngine) -> R + Send + 'static,
    R: Send + 'static,
{
    let caller = std::panic::Location::caller();
    async move {
        match crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                with_persistent_engine_at(caller, |engine| {
                    // Read under the lock the install is written under, so the
                    // answer belongs to the engine this closure was handed.
                    let open = ENGINE_INSTALL.load(Ordering::Acquire);
                    if open != install {
                        log::warn!(
                            "veloqrs: [Engine] discarding work from install {} against install {}",
                            install,
                            open
                        );
                        return None;
                    }
                    Some(f(engine))
                })
                .flatten()
            })
            .await
        {
            Ok(result) => result,
            Err(e) => {
                log::warn!("[Engine] blocking engine call failed: {e}");
                None
            }
        }
    }
}

/// SQLite error codes that mean the file itself is unusable, as opposed
/// to a transient I/O or logic error.
pub(crate) fn is_corruption_error(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseCorrupt) | Some(rusqlite::ErrorCode::NotADatabase)
    )
}

/// Whether the file at this path can be a SQLite database at all.
///
/// Every SQLite database opens with the 16 bytes `SQLite format 3\0`. Absent
/// and zero-length without a populated WAL are new: SQLite creates the file on
/// open and writes the header on the first write. A zero-length main file with
/// a populated WAL is damaged, since a fresh database cannot have written a
/// log before its first page. Other bytes with the wrong header are not a
/// database, whatever a log beside them could rebuild.
///
/// The check exists because inferring corruption from a failed open stops
/// working under WAL: SQLite rebuilds the schema out of a healthy log beside a
/// ruined main file, the open succeeds, the load returns cleanly, and the
/// athlete's library reads as zero activities with nothing said. Sixteen bytes
/// cost nothing against a launch budget of 200 ms, and an unreadable file is
/// treated as new rather than corrupt so a permissions failure still takes the
/// open path that reports it. An intact header does not prove its later pages
/// are sound. Damage there reaches the open and load paths instead.
pub(crate) fn file_can_be_a_database(path: &str) -> bool {
    use std::io::Read;
    const HEADER: &[u8; 16] = b"SQLite format 3\0";

    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return true,
    };
    let mut head = [0u8; 16];
    let mut read = 0;
    while read < head.len() {
        match file.read(&mut head[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => return true,
        }
    }
    if read == 0 {
        return std::fs::metadata(format!("{path}-wal"))
            .map(|meta| meta.len() == 0)
            .unwrap_or(true);
    }
    read == head.len() && &head == HEADER
}

/// SQLite failures caused by contention or unavailable storage. They must not
/// quarantine a healthy library.
pub(crate) fn is_transient_open_error(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy)
            | Some(rusqlite::ErrorCode::DatabaseLocked)
            | Some(rusqlite::ErrorCode::CannotOpen)
            | Some(rusqlite::ErrorCode::DiskFull)
            | Some(rusqlite::ErrorCode::SystemIoFailure)
            | Some(rusqlite::ErrorCode::ReadOnly)
    )
}

// ============================================================================
// Internal helpers used by UniFFI Object implementations
// ============================================================================

pub mod persistent_engine_ffi {
    use super::*;
    use crate::objects::init::{FfiInitOutcome, record_init_outcome};
    use log::info;

    /// Guards one-time installation of the Rust panic hook.
    static PANIC_HOOK_INIT: std::sync::Once = std::sync::Once::new();

    fn panic_log_line(
        time: chrono::DateTime<chrono::Utc>,
        thread: &str,
        location: &str,
        message: &str,
    ) -> String {
        format!(
            "{} [{}] panic at {}: {}",
            time.to_rfc3339(),
            thread,
            location,
            message
        )
    }

    /// Install a process-wide panic hook that logs before the crate unwinds.
    /// The default hook still runs, and the file is read by hand from the
    /// device. Write errors are ignored.
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
                    let thread = std::thread::current();
                    let line = panic_log_line(
                        chrono::Utc::now(),
                        thread.name().unwrap_or("unnamed"),
                        &location,
                        &message,
                    );
                    let _ = writeln!(file, "{line}");
                }
                default_hook(info);
            }));
        });
    }

    /// How the last init in this process ended, for the banner to translate.
    pub use crate::objects::init::last_init_outcome;

    /// Initialise the persistent engine with a database path.
    /// Called by VeloqEngine::create() - not exported via FFI directly.
    /// The bare `bool` is "is the engine usable"; `last_init_outcome` carries
    /// why it is not.
    pub fn persistent_engine_init(db_path: String) -> bool {
        let opened = persistent_engine_init_without_owed_work(db_path);
        if opened {
            crate::net::elevation_backfill::start_owed_work();
        }
        opened
    }

    /// Open the library and start nothing, for a caller that drives the owed
    /// elevation backfill and detector cutover by hand from a known state.
    pub fn persistent_engine_init_without_owed_work(db_path: String) -> bool {
        let _lifecycle = ENGINE_LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
        persistent_engine_init_locked(db_path, EngineOpenMode::Foreground)
    }

    /// Open once under the lifecycle lock. A native push may cold-start the
    /// engine, but cannot reopen it after JavaScript began replacing the file.
    pub fn open_if_closed(db_path: String, owner_reopen: bool) -> Option<bool> {
        let opened = open_if_closed_with_mode(db_path, owner_reopen, EngineOpenMode::Foreground);
        if opened == Some(true) {
            crate::net::elevation_backfill::start_owed_work();
        }
        opened
    }

    /// Open a push handler's engine once without foreground launch recovery.
    /// A failed open leaves the live database in place for its owner.
    pub fn open_for_push_if_closed(db_path: String) -> Option<bool> {
        open_if_closed_with_mode(db_path, false, EngineOpenMode::Push)
    }

    fn open_if_closed_with_mode(
        db_path: String,
        owner_reopen: bool,
        mode: EngineOpenMode,
    ) -> Option<bool> {
        let _lifecycle = ENGINE_LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
        if owner_reopen {
            RESTORE_CLOSING.store(false, Ordering::Release);
        } else if RESTORE_CLOSING.load(Ordering::Acquire) {
            return None;
        }
        if PERSISTENT_ENGINE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
        {
            return Some(false);
        }
        persistent_engine_init_locked(db_path, mode).then_some(true)
    }

    fn persistent_engine_init_locked(db_path: String, mode: EngineOpenMode) -> bool {
        crate::init_logging();
        install_panic_hook(&db_path);
        info!(
            "veloqrs: [PersistentEngine] Initialising with db: {}",
            db_path
        );

        if let Some(parent) = std::path::Path::new(&db_path).parent()
            && !parent.exists()
        {
            if let Err(e) = std::fs::create_dir_all(parent) {
                log::error!(
                    "veloqrs: [PersistentEngine] Failed to create directory {:?}: {}",
                    parent,
                    e
                );
                return record_init_outcome(FfiInitOutcome::StorageUnavailable);
            }
            info!(
                "veloqrs: [PersistentEngine] Created parent directory: {:?}",
                parent
            );
        }

        // Another process can reach the same App Group file while this one
        // upgrades it. Hold a sibling-file lock before reading user_version so
        // the second opener sees the version the first one committed.
        let lock_path = format!("{db_path}.init.lock");
        let init_file = match std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&lock_path)
        {
            Ok(file) => file,
            Err(e) => {
                log::error!("veloqrs: [PersistentEngine] Could not open init lock: {e}");
                return record_init_outcome(FfiInitOutcome::StorageUnavailable);
            }
        };
        if let Err(e) = file_lock::lock_exclusive(&init_file) {
            log::error!("veloqrs: [PersistentEngine] Could not lock database init: {e}");
            return record_init_outcome(FfiInitOutcome::StorageUnavailable);
        }

        // Read the file before opening it. Under WAL a ruined main file beside
        // an intact log opens cleanly and loads cleanly, and the library reads
        // as zero activities, so the open cannot be the only thing that decides
        // whether the file is a database.
        let mut engine = if !file_can_be_a_database(&db_path) {
            log::error!(
                "veloqrs: [PersistentEngine] '{}' carries no SQLite header",
                db_path
            );
            if mode == EngineOpenMode::Push {
                return record_init_outcome(FfiInitOutcome::StorageUnavailable);
            }
            match reopen_after_quarantine(&db_path) {
                Some(engine) => engine,
                None => return record_init_outcome(FfiInitOutcome::StorageUnavailable),
            }
        } else {
            let opened = match mode {
                EngineOpenMode::Foreground => PersistentEngine::new(&db_path),
                EngineOpenMode::Push => PersistentEngine::new_for_push(&db_path),
            };
            match opened {
                Ok(engine) => engine,
                Err(e) => {
                    log::error!(
                        "veloqrs: [PersistentEngine] Failed to open database '{}': {:?}",
                        db_path,
                        e
                    );
                    if let Some(outcome) = schema::refused_outcome(&e) {
                        // The schema check refused the version records, not the
                        // bytes. A newer database is healthy and an overstated
                        // one is a diagnosis, so quarantining either would move
                        // the athlete's library aside for a fault no fresh file
                        // fixes.
                        return record_init_outcome(outcome);
                    }
                    if is_transient_open_error(&e) {
                        // The next launch (or the banner retry) can succeed on the
                        // same file. Quarantining here would discard a healthy
                        // cache over lock contention.
                        //
                        // Busy and locked can clear on retry. The others need
                        // storage or permissions to change before opening again.
                        return record_init_outcome(
                            if matches!(
                                e.sqlite_error_code(),
                                Some(rusqlite::ErrorCode::CannotOpen)
                                    | Some(rusqlite::ErrorCode::DiskFull)
                                    | Some(rusqlite::ErrorCode::SystemIoFailure)
                                    | Some(rusqlite::ErrorCode::ReadOnly)
                            ) {
                                FfiInitOutcome::StorageUnavailable
                            } else {
                                FfiInitOutcome::Busy
                            },
                        );
                    }
                    if mode == EngineOpenMode::Push {
                        return record_init_outcome(FfiInitOutcome::StorageUnavailable);
                    }
                    // Corruption or a deterministic open/migration failure: the
                    // same file would fail every launch, bricking the engine
                    // permanently. Quarantine and start fresh.
                    match reopen_after_quarantine(&db_path) {
                        Some(engine) => engine,
                        None => return record_init_outcome(FfiInitOutcome::StorageUnavailable),
                    }
                }
            }
        };

        let loaded = match mode {
            EngineOpenMode::Foreground => engine.load(),
            EngineOpenMode::Push => engine.load_for_push(),
        };
        if let Err(e) = loaded {
            if is_corruption_error(&e) {
                log::error!(
                    "veloqrs: [PersistentEngine] Corruption while loading '{}': {:?}",
                    db_path,
                    e
                );
                if mode == EngineOpenMode::Push {
                    return record_init_outcome(FfiInitOutcome::StorageUnavailable);
                }
                // Close the connection before the quarantine rename.
                drop(engine);
                engine = match reopen_after_quarantine(&db_path) {
                    Some(engine) => engine,
                    None => return record_init_outcome(FfiInitOutcome::StorageUnavailable),
                };
                if let Err(reload_error) = engine.load() {
                    log::error!(
                        "veloqrs: [PersistentEngine] Could not load salvaged data after quarantine: {:?}",
                        reload_error
                    );
                }
            } else {
                info!(
                    "veloqrs: [PersistentEngine] Warning: Failed to load existing data: {:?}",
                    e
                );
            }
        }

        // Exactly one mint per process, and it is what frees every lease the
        // last one left behind. A generation costs no clock, so a process that
        // was killed mid-fetch strands nothing: `attempts::claim_job` reads
        // any row from an earlier generation as free.
        if mode == EngineOpenMode::Foreground {
            match engine.mint_lease_generation() {
                Ok(generation) => info!(
                    "veloqrs: [PersistentEngine] Lease generation {}",
                    generation
                ),
                // A store that cannot mint holds no leases anybody claimed, so the
                // run goes on with the generation it has rather than refusing to
                // open over bookkeeping.
                Err(e) => log::warn!(
                    "veloqrs: [PersistentEngine] Could not mint a lease generation: {:?}",
                    e
                ),
            }
        }

        let mut guard = PERSISTENT_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
        publish_for_readers(&engine);
        *guard = Some(engine);
        // Under the same lock as the install, so a worker taking the lock next
        // reads the counter that belongs to the engine it was handed.
        ENGINE_INSTALL.fetch_add(1, Ordering::AcqRel);
        PERSISTENT_ENGINE.clear_poison();
        // After the engine, so the pool never points at a database no engine
        // has opened, and after the quarantine rename for the same reason.
        read_pool::bind(&db_path);
        info!("veloqrs: [PersistentEngine] Initialised successfully");

        record_init_outcome(FfiInitOutcome::Opened)
    }

    /// Move an unusable database aside and open a fresh one in its place.
    ///
    /// A file that cannot be opened or migrated would otherwise brick every
    /// engine-backed feature on every launch. The file also holds athlete
    /// records and handset recordings, so salvage every readable owned row
    /// before the next sync refills the replaceable data. Keep one quarantined
    /// generation for recovery from anything the damaged file could not read.
    fn reopen_after_quarantine(db_path: &str) -> Option<PersistentEngine> {
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
                            "veloqrs: [PersistentEngine] Could not quarantine '{}': {}",
                            src,
                            e
                        );
                        return None;
                    }
                }
            }
        }
        log::warn!(
            "veloqrs: [PersistentEngine] Quarantined unusable database to '{}.corrupt-{}', starting fresh",
            db_path,
            ts
        );

        match PersistentEngine::new(db_path) {
            Ok(engine) => {
                // Detector output is a re-derivable cache; the ledger and the
                // user's own rows are not. Whatever the quarantined file still
                // yields comes across.
                let quarantined_path = format!("{}.corrupt-{}", db_path, ts);
                // Opening a zero-page database makes SQLite discard its WAL.
                // Preserve that log as evidence; it is the only surviving
                // content when the main file was truncated to zero bytes.
                let salvaged = if std::fs::metadata(&quarantined_path)
                    .map(|meta| meta.len() == 0)
                    .unwrap_or(false)
                {
                    sections::SalvageCounts::default()
                } else {
                    engine.salvage_ledger_from(&quarantined_path)
                };
                // The warning below is the whole record today, and release
                // keeps it where nobody reads it. This is the same fact where
                // the app can ask for it.
                crate::objects::quarantine::record_quarantine(&salvaged);
                log::warn!(
                    "veloqrs: [PersistentEngine] Salvaged {} history rows, {} geometry versions, {} pins, {} user sections, {} intents, {} recordings, {} route names from the quarantined database",
                    salvaged.history,
                    salvaged.geometry,
                    salvaged.pins,
                    salvaged.sections,
                    salvaged.intents,
                    salvaged.recordings,
                    salvaged.route_names
                );
                Some(engine)
            }
            Err(e) => {
                log::error!(
                    "veloqrs: [PersistentEngine] Fresh database after quarantine also failed: {:?}",
                    e
                );
                None
            }
        }
    }

    /// Handle for tracking background section detection progress.
    /// Used by DetectionManager.
    pub static SECTION_DETECTION_HANDLE: LazyLock<Mutex<Option<SectionDetectionHandle>>> =
        LazyLock::new(|| Mutex::new(None));

    pub static TILE_GENERATION_HANDLE: LazyLock<Mutex<Option<TileGenerationHandle>>> =
        LazyLock::new(|| Mutex::new(None));

    /// Handle for the running database backup, if any.
    pub static BACKUP_HANDLE: LazyLock<Mutex<Option<BackupHandle>>> =
        LazyLock::new(|| Mutex::new(None));

    /// Handle for the running bulk export, if any.
    pub static BULK_EXPORT_HANDLE: LazyLock<Mutex<Option<BulkExportHandle>>> =
        LazyLock::new(|| Mutex::new(None));

    /// Handle for the running heatmap cache-size walk, if any.
    pub static CACHE_SIZE_HANDLE: LazyLock<Mutex<Option<CacheSizeHandle>>> =
        LazyLock::new(|| Mutex::new(None));

    /// The figure the last walk produced. Three mount effects poll for one
    /// walk, and only the first poll to observe completion gets the message
    /// off the channel, so the other two read the figure from here or read
    /// nothing at all. Cleared by `clear_tiles`, which makes it wrong.
    pub static CACHE_SIZE_LAST: LazyLock<Mutex<Option<u64>>> = LazyLock::new(|| Mutex::new(None));

    /// Handle for the running derived-catalogue wipe, if any.
    pub static CLEAR_HANDLE: LazyLock<Mutex<Option<ClearHandle>>> =
        LazyLock::new(|| Mutex::new(None));

    /// Handle for the running clear-cache wipe, if any.
    pub static CLEAR_DERIVED_HANDLE: LazyLock<Mutex<Option<DerivedClearHandle>>> =
        LazyLock::new(|| Mutex::new(None));

    #[cfg(test)]
    mod panic_log_tests {
        #[test]
        fn panic_line_identifies_time_thread_and_location() {
            let time = chrono::DateTime::parse_from_rfc3339("2026-09-30T14:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc);
            assert_eq!(
                super::panic_log_line(time, "fetch-worker", "worker.rs:3:2", "failed"),
                "2026-09-30T14:00:00+00:00 [fetch-worker] panic at worker.rs:3:2: failed"
            );
        }
    }
}

/// An R-tree over one polyline, so a run of comparisons against it builds the
/// tree once. `compute_polyline_overlap` is the single-shot wrapper.
pub(crate) struct OverlapIndex {
    rtree: rstar::RTree<[f64; 2]>,
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
}

impl OverlapIndex {
    /// `None` when the polyline has fewer than one whole point.
    pub(crate) fn new(coords: &[f64]) -> Option<Self> {
        if coords.len() < 2 {
            return None;
        }
        let points: Vec<[f64; 2]> = coords
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| [c[0], c[1]])
            .collect();
        let mut min_lat = f64::INFINITY;
        let mut max_lat = f64::NEG_INFINITY;
        let mut min_lng = f64::INFINITY;
        let mut max_lng = f64::NEG_INFINITY;
        for &[lat, lng] in &points {
            min_lat = min_lat.min(lat);
            max_lat = max_lat.max(lat);
            min_lng = min_lng.min(lng);
            max_lng = max_lng.max(lng);
        }
        Some(Self {
            rtree: rstar::RTree::bulk_load(points),
            min_lat,
            max_lat,
            min_lng,
            max_lng,
        })
    }

    /// Fraction of `coords` lying within `threshold_meters` of the indexed line.
    pub(crate) fn fraction_within(&self, coords: &[f64], threshold_meters: f64) -> f64 {
        if coords.len() < 2 {
            return 0.0;
        }
        let total = coords.len() / 2;

        // Threshold in degrees, with a 1.5x buffer; the haversine below is the
        // real test. A degree of longitude shrinks with latitude, so padding
        // both axes by the same amount reaches too little east-west away from
        // the equator. Same form as bboxes_touch in sections/named.rs.
        let pad_lat = threshold_meters / 111_320.0 * 1.5;

        let mut matched = 0u32;
        for chunk in coords.as_chunks::<2>().0 {
            let lat_a = chunk[0];
            let lng_a = chunk[1];
            let pad_lng = pad_lng_degrees(lat_a, threshold_meters);

            let envelope = rstar::AABB::from_corners(
                [lat_a - pad_lat, lng_a - pad_lng],
                [lat_a + pad_lat, lng_a + pad_lng],
            );

            let mut found = false;
            for &[lat_b, lng_b] in self.rtree.locate_in_envelope(&envelope) {
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

        matched as f64 / total as f64
    }

    /// Whether any point of the given bounding box could be close enough to
    /// match. A fraction above zero needs at least one point pair within the
    /// threshold, so a box this far out cannot contribute one and its polyline
    /// never has to be read.
    pub(crate) fn bbox_can_reach(
        &self,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
        threshold_meters: f64,
    ) -> bool {
        let pad_lat = threshold_meters / 111_320.0 * 1.5;
        let pad_lng = pad_lng_degrees(
            self.min_lat
                .abs()
                .max(self.max_lat.abs())
                .max(min_lat.abs())
                .max(max_lat.abs()),
            threshold_meters,
        );
        min_lat <= self.max_lat + pad_lat
            && max_lat >= self.min_lat - pad_lat
            && min_lng <= self.max_lng + pad_lng
            && max_lng >= self.min_lng - pad_lng
    }
}

/// A metre threshold as degrees of longitude at the given latitude, with the
/// same 1.5x buffer the latitude padding carries.
fn pad_lng_degrees(lat: f64, threshold_meters: f64) -> f64 {
    threshold_meters / (111_320.0 * lat.to_radians().cos().max(0.01)) * 1.5
}

/// Compute what fraction of polylineA's points are within `threshold_meters` of any point in polylineB.
/// Both polylines are flat coordinate arrays [lat, lng, lat, lng, ...].
/// Uses an R-tree on polylineB for O(n log m) instead of O(n*m).
/// Returns 0.0-1.0.
///
/// An odd length is refused rather than trimmed. The pairing below is
/// `chunks_exact(2)`, which drops a trailing value without a word, so a caller
/// that flattened one point short got an answer over a line it did not send.
/// Latitude-first order cannot be checked here at all: only an encoded input
/// carries its own order.
#[uniffi::export]
pub fn compute_polyline_overlap(
    coords_a: Vec<f64>,
    coords_b: Vec<f64>,
    threshold_meters: f64,
) -> Result<f64, VeloqError> {
    whole_points("coords_a", &coords_a)?;
    whole_points("coords_b", &coords_b)?;
    Ok(match OverlapIndex::new(&coords_b) {
        Some(index) => index.fraction_within(&coords_a, threshold_meters),
        None => 0.0,
    })
}

/// Refuse a flat coordinate array that is not a whole number of points.
fn whole_points(name: &str, coords: &[f64]) -> Result<(), VeloqError> {
    if !coords.len().is_multiple_of(2) {
        return Err(VeloqError::ParseError {
            msg: format!(
                "{name} length {} is not an even count of lat/lng values",
                coords.len()
            ),
        });
    }
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
#[path = "tests/backfill_activity_metadata.rs"]
mod backfill_activity_metadata_tests;

#[cfg(test)]
#[path = "tests/screen_read_statements.rs"]
mod screen_read_statements;

#[cfg(test)]
#[path = "tests/section_summaries_read_work.rs"]
mod section_summaries_read_work;

#[cfg(test)]
#[path = "tests/production_index_plans.rs"]
mod production_index_plans;

#[cfg(test)]
#[path = "tests/blocking_engine.rs"]
mod blocking_engine;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Direction;

    /// A handle whose worker sent nothing and then died, the shape a panic
    /// inside the fold leaves behind.
    fn handle_with_a_dead_worker() -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        let (cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        drop(tx);
        drop(cache_tx);
        SectionDetectionHandle {
            receiver: rx,
            final_update: std::sync::Mutex::new(None),
            cache_receiver: cache_rx,
            checkpoint: Arc::new(CheckpointSlot::default()),
            progress: SectionDetectionProgress::new(),
            worker_applied: None,
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    /// A worker that panics inside the fold drops its sender without sending,
    /// which reads on the main channel exactly like a run with nothing to
    /// report. The catalogue from the previous detect then stands, and on a
    /// device that is a sync that looks finished and leaves the section list
    /// silently stale.
    #[test]
    fn a_dead_detection_worker_is_not_a_run_that_found_nothing() {
        let (state, cache) = handle_with_a_dead_worker().recv_state_with_cache();

        assert!(
            matches!(state, WorkerPoll::Died),
            "a dead worker must not read as a detect that found nothing"
        );
        assert!(cache.is_none());
    }

    /// `poll_state` has reported a dead worker since the failover work, and the
    /// blocking read is the one that did not.
    #[test]
    fn the_blocking_read_agrees_with_the_poll_about_a_dead_worker() {
        let handle = handle_with_a_dead_worker();

        assert!(matches!(handle.poll_state(), WorkerPoll::Died));
        assert!(matches!(handle.recv_state_with_cache().0, WorkerPoll::Died));
    }

    /// A worker that hangs rather than dies never closes its channel, so the
    /// unbounded read waits for the life of the process. The cutover reads this
    /// holding `CUTOVER_RUNNING`, so every later launch was refused its cutover
    /// until the app was killed.
    #[test]
    fn a_hung_worker_gives_the_read_back_instead_of_keeping_it() {
        let (handle, _tx, _cache_tx) = SectionDetectionHandle::worker_that_never_answers();

        // A read that kept waiting would never return, since the worker never
        // answers and never closes.
        let (state, cache) = crate::test_globals::returns_within(
            std::time::Duration::from_secs(60),
            "the bounded read of a hung worker",
            move || handle.recv_state_with_cache_within(Some(std::time::Duration::from_millis(50))),
        );

        assert!(
            matches!(state, WorkerPoll::Running),
            "a worker still holding its sender is running, not dead"
        );
        assert!(cache.is_none());
    }

    /// A bounded read must still tell a hang from a death, because the cutover
    /// treats them the same way but the log should not.
    #[test]
    fn a_bounded_read_still_calls_a_dead_worker_dead() {
        let (state, _) = handle_with_a_dead_worker()
            .recv_state_with_cache_within(Some(std::time::Duration::from_secs(30)));

        assert!(
            matches!(state, WorkerPoll::Died),
            "a closed channel is a death, however long the ceiling is"
        );
    }

    /// And a worker that answers inside the ceiling is read normally, without
    /// waiting the ceiling out.
    #[test]
    fn a_bounded_read_takes_an_answer_that_arrives_in_time() {
        let (handle, tx, _cache_tx) = SectionDetectionHandle::worker_that_never_answers();
        tx.send((Vec::new(), vec!["a1".to_string()])).expect("send");

        // The ceiling is an hour, so a read that waited it out before taking
        // the answer would outlast the guard.
        let (state, _) = crate::test_globals::returns_within(
            std::time::Duration::from_secs(60),
            "the bounded read of an answer already sent",
            move || handle.recv_state_with_cache_within(Some(std::time::Duration::from_secs(3600))),
        );

        match state {
            WorkerPoll::Ready((_, processed)) => assert_eq!(processed, vec!["a1".to_string()]),
            _ => panic!("the answer that was sent was not read back"),
        }
    }

    fn sample_coords() -> Vec<GpsPoint> {
        (0..50)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278 + i as f64 * 0.0005))
            .collect()
    }

    /// Every SQLite database opens with `SQLite format 3\0`. Absent and empty
    /// are both a fresh install, and a file with bytes and the wrong header is
    /// not a database whatever a log beside it could rebuild from.
    #[test]
    fn a_file_with_no_sqlite_header_is_not_a_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("routes.db");
        let as_str = path.to_string_lossy().into_owned();

        assert!(file_can_be_a_database(&as_str), "absent is new, not broken");

        std::fs::write(&path, b"").unwrap();
        assert!(file_can_be_a_database(&as_str), "empty is new, not broken");

        std::fs::write(&path, b"this is not a database").unwrap();
        assert!(!file_can_be_a_database(&as_str));

        std::fs::write(&path, b"SQLite").unwrap();
        assert!(
            !file_can_be_a_database(&as_str),
            "a truncated header is not a header"
        );

        std::fs::write(&path, b"SQLite format 3\0and then some pages").unwrap();
        assert!(file_can_be_a_database(&as_str));
    }

    #[test]
    fn a_real_database_carries_the_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("routes.db");
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .unwrap();
        drop(conn);

        assert!(file_can_be_a_database(&path.to_string_lossy()));
    }

    #[test]
    fn test_add_activity() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .add_activity("test-1".to_string(), sample_coords(), "cycling".to_string())
            .unwrap();

        assert_eq!(engine.activity_count(), 1);
        assert!(engine.has_activity("test-1"));
    }

    #[test]
    fn test_signature_caching() {
        let mut engine = PersistentEngine::in_memory().unwrap();
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
        let mut engine = PersistentEngine::in_memory().unwrap();
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
            let mut engine = PersistentEngine::new(temp_path).unwrap();
            engine.clear().unwrap();
            engine
                .add_activity("test-1".to_string(), sample_coords(), "cycling".to_string())
                .unwrap();
        }

        // Reload and verify
        {
            let mut engine = PersistentEngine::new(temp_path).unwrap();
            engine.load().unwrap();
            assert_eq!(engine.activity_count(), 1);
            assert!(engine.has_activity("test-1"));
        }
    }

    #[test]
    fn push_load_leaves_the_backfill_and_identity_write_to_the_foreground() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("push_load.db");
        let path = path.to_str().unwrap();
        {
            let mut engine = PersistentEngine::new(path).unwrap();
            engine
                .add_activity("a1".to_string(), sample_coords(), "cycling".to_string())
                .unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                         elapsed_time, elevation_gain, sport_type)
                     VALUES ('a1', 'n', 0, 1, 1, 1, 0, 'Ride')",
                    [],
                )
                .unwrap();
            engine
                .db
                .execute("UPDATE activities SET name = NULL WHERE id = 'a1'", [])
                .unwrap();
            engine.db.execute("DELETE FROM identity_state", []).unwrap();
        }
        let named = |engine: &PersistentEngine| -> bool {
            engine
                .db
                .query_row(
                    "SELECT name IS NOT NULL FROM activities WHERE id = 'a1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
        };
        let identity_rows = |engine: &PersistentEngine| -> i64 {
            engine
                .db
                .query_row("SELECT COUNT(*) FROM identity_state", [], |r| r.get(0))
                .unwrap()
        };

        let mut push = PersistentEngine::new_for_push(path).unwrap();
        push.load_for_push().unwrap();
        assert!(!named(&push));
        assert_eq!(identity_rows(&push), 0);
        drop(push);

        let mut foreground = PersistentEngine::new(path).unwrap();
        foreground.load().unwrap();
        assert!(named(&foreground));
        assert!(identity_rows(&foreground) > 0);
    }

    #[test]
    fn test_grouping() {
        let mut engine = PersistentEngine::in_memory().unwrap();

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
        let mut engine = PersistentEngine::in_memory().unwrap();
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
                    // Half-open, and the whole fifty-point track: the shape a
                    // portion carries when the ride ends on the section.
                    end_index: 50,
                    distance_meters: 5000.0,
                    direction: Direction::Same,
                })
                .collect(),
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
        let mut engine = PersistentEngine::in_memory().unwrap();

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
        let mut engine = PersistentEngine::in_memory().unwrap();

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
        let mut engine = PersistentEngine::in_memory().unwrap();

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
        let mut engine = PersistentEngine::in_memory().unwrap();

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
        let mut engine = PersistentEngine::in_memory().unwrap();

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
        let mut engine = PersistentEngine::in_memory().unwrap();

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
        let mut engine = PersistentEngine::in_memory().unwrap();

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
            // Points 0 to 49 on a 1-second-cadence stream = 49s.
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

    /// Scenario: `fetch_time_stream` has reduced `time` through the `latlng`
    /// mask since 2026-08-16, so a stream stored since then is positional to
    /// the stored track. Every released 0.3.x stored the raw series, which
    /// keeps the samples the coordinate mask drops and is longer than the
    /// track by the number of unfixed ones. On the July export that is 587 of
    /// 733 activities, and the lap times read off them are wrong: 728 laps off
    /// by more than 2 s, p95 22 s, worst 1,043 s.
    ///
    /// Expected behaviour: the same length rule the detector's stream loader
    /// and the scrubber's body builder already apply. A stream whose length
    /// disagrees with its track is not in the track's index space, so it
    /// cannot time a traversal at all.
    #[test]
    fn a_stream_that_is_not_the_track_length_times_nothing() {
        use super::sections::compute_lap_time_from_stream;

        let times: Vec<u32> = vec![0, 10, 20, 30, 40];

        assert_eq!(
            compute_lap_time_from_stream(Some(&times), Some(5), 0, 3, 90.0).0,
            Some(20.0),
            "a stream the length of its track times the traversal"
        );
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), Some(4), 0, 3, 90.0),
            (None, None),
            "one sample longer than the track is the pre-mask shape"
        );
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), Some(6), 0, 3, 90.0),
            (None, None),
            "and shorter is no better"
        );
    }

    /// The track length is not always knowable: an activity whose track row is
    /// gone has none. That is not evidence the stream is misaligned, so the
    /// bounds checks alone stand for it.
    #[test]
    fn an_unknown_track_length_still_times_the_traversal() {
        use super::sections::compute_lap_time_from_stream;

        let times: Vec<u32> = vec![0, 10, 20];
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 0, 3, 90.0).0,
            Some(20.0)
        );
    }

    /// Regression: `compute_lap_time_from_stream` handles the zero-span and
    /// missing-stream edge cases by returning `(None, None)` - never panics
    /// on out-of-bounds indices.
    #[test]
    fn test_compute_lap_time_from_stream_edge_cases() {
        use super::sections::compute_lap_time_from_stream;

        // No stream available.
        assert_eq!(
            compute_lap_time_from_stream(None, None, 0, 5, 100.0),
            (None, None)
        );

        // Zero-duration traversal: `1..1` holds no points at all.
        let times: Vec<u32> = vec![10, 20, 30];
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 1, 1, 100.0),
            (None, None)
        );

        // Out of bounds end_index.
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 0, 99, 100.0),
            (None, None)
        );

        // `0..2` is the points at 0 and 1, so 10s; 100m/10s = 10 m/s.
        let (lap_time, lap_pace) = compute_lap_time_from_stream(Some(&times), None, 0, 2, 100.0);
        assert_eq!(lap_time, Some(10.0));
        assert_eq!(lap_pace, Some(10.0));
    }

    /// `section_activities.end_index` is the half-open end every writer stores,
    /// so a portion that runs to the last point of its activity carries
    /// `end_index == point_count` and has to be timed, not dropped.
    #[test]
    fn lap_time_reads_the_half_open_end() {
        use super::sections::compute_lap_time_from_stream;

        let times: Vec<u32> = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

        // Ends on the last point: `0..10` on a ten-point track.
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 0, times.len() as u32, 90.0),
            (Some(9.0), Some(10.0))
        );

        // Ends one short of it, and is a second shorter for it.
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 0, times.len() as u32 - 1, 90.0).0,
            Some(8.0)
        );

        // A single-point portion spans no time.
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 4, 5, 90.0),
            (None, None)
        );

        // The placeholder row `create_section` writes, before a rescan fills it.
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 0, 0, 0.0),
            (None, None)
        );

        // One past the end of the track is not a lap, however long the stream is.
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 0, times.len() as u32 + 1, 90.0),
            (None, None)
        );

        // A start beyond the stream is not a lap either.
        assert_eq!(
            compute_lap_time_from_stream(Some(&times), None, 20, 25, 90.0),
            (None, None)
        );
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

    /// The crate holds one great-circle formula, tracematch's, and the helper
    /// here is the lat/lng signature over it. Two bodies agreeing today is
    /// what a parity test papers over; one body cannot drift at all.
    #[test]
    fn the_helper_is_tracematchs_formula_exactly() {
        for &(lat1, lng1, lat2, lng2, _) in FIXTURES {
            let point = |lat, lng| tracematch::GpsPoint {
                latitude: lat,
                longitude: lng,
                elevation: None,
            };
            assert_eq!(
                haversine_distance_meters(lat1, lng1, lat2, lng2),
                tracematch::geo_utils::haversine_distance(&point(lat1, lng1), &point(lat2, lng2)),
                "({lat1}, {lng1}) to ({lat2}, {lng2}) took a different formula"
            );
        }
    }

    /// `geo` reaches this crate through tracematch, which owns the formula.
    /// A direct dependency is how a second copy gets written next time.
    #[test]
    fn veloqrs_does_not_depend_on_geo_directly() {
        let manifest = include_str!("../../Cargo.toml");
        let declared = manifest
            .lines()
            .map(str::trim)
            .any(|line| line.starts_with("geo ") || line.starts_with("geo="));
        assert!(!declared, "veloqrs/Cargo.toml still declares `geo`");
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

        let overlap = compute_polyline_overlap(a, b, 50.0).unwrap();
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

        assert!(compute_polyline_overlap(a, b, 50.0).unwrap() > 0.9);
    }

    #[test]
    fn distant_lines_do_not_overlap() {
        let a: Vec<f64> = (0..20)
            .flat_map(|i| vec![55.7, 12.5 + i as f64 * 0.0005])
            .collect();
        let b: Vec<f64> = (0..20)
            .flat_map(|i| vec![55.9, 12.5 + i as f64 * 0.0005])
            .collect();

        assert_eq!(compute_polyline_overlap(a, b, 50.0).unwrap(), 0.0);
    }
}

/// Scenario: a caller hands the engine a flat coordinate array that is not a
/// whole number of points.
///
/// Expected behaviour: the call is refused. `chunks_exact(2)` drops an odd
/// trailing value without a word, so the overlap was computed over one point
/// fewer than the caller sent and the answer looked like a real one.
#[cfg(test)]
mod polyline_overlap_input_tests {
    use super::compute_polyline_overlap;

    fn line(points: usize) -> Vec<f64> {
        (0..points)
            .flat_map(|i| vec![55.7 + i as f64 * 0.0005, 12.5])
            .collect()
    }

    #[test]
    fn an_odd_first_line_is_refused() {
        let mut a = line(20);
        a.push(55.8);
        let err = compute_polyline_overlap(a, line(20), 50.0).unwrap_err();
        assert!(err.to_string().contains("coords_a"), "got {err}");
        assert!(err.to_string().contains("41"), "got {err}");
    }

    #[test]
    fn an_odd_second_line_is_refused() {
        let mut b = line(20);
        b.push(55.8);
        let err = compute_polyline_overlap(line(20), b, 50.0).unwrap_err();
        assert!(err.to_string().contains("coords_b"), "got {err}");
    }

    #[test]
    fn an_empty_line_is_no_overlap_rather_than_an_error() {
        assert_eq!(
            compute_polyline_overlap(Vec::new(), line(20), 50.0).unwrap(),
            0.0
        );
        assert_eq!(
            compute_polyline_overlap(line(20), Vec::new(), 50.0).unwrap(),
            0.0
        );
    }

    #[test]
    fn a_single_stray_value_is_refused_rather_than_read_as_empty() {
        let err = compute_polyline_overlap(vec![55.7], line(20), 50.0).unwrap_err();
        assert!(err.to_string().contains("coords_a"), "got {err}");
    }
}

/// Counting commits is how a writer proves it holds one transaction rather
/// than one autocommit per row, which under the engine lock is one fsync the
/// JavaScript thread waits out.
#[cfg(test)]
pub(crate) mod commit_counter {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::PersistentEngine;

    pub(crate) fn watch(engine: &PersistentEngine) -> Arc<AtomicUsize> {
        let commits = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&commits);
        engine.db.commit_hook(Some(move || {
            seen.fetch_add(1, Ordering::SeqCst);
            false
        }));
        commits
    }

    pub(crate) fn count(commits: &Arc<AtomicUsize>) -> usize {
        commits.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod detection_progress_percent {
    use super::SectionDetectionProgress;

    /// Every phase a run can enter has to carry a weight. The `_` arm returns
    /// 50 on purpose, for the refusal phases that are not a position in a run
    /// (`suspended`, `cutover_owed`), so a run phase that falls through there
    /// reads as half done wherever it actually is.
    #[test]
    fn every_run_phase_carries_a_weight_of_its_own() {
        let progress = SectionDetectionProgress::new();
        let run_phases = [
            "loading",
            "analyzing",
            "saving",
            "recomputing_indicators",
            "diffing",
            "complete",
        ];

        let mut last = 0;
        for phase in run_phases {
            progress.set_phase(phase, 0);
            let percent = progress.get_percent();
            assert_ne!(
                percent, 50,
                "'{phase}' fell through to the unknown-phase sentinel"
            );
            assert!(
                percent >= last,
                "'{phase}' reads {percent}, behind the phase before it at {last}"
            );
            last = percent;
        }
        assert_eq!(last, 100, "the run ends at 100");
    }

    /// The refusal phases keep the sentinel: they are not a position in a run
    /// and must not pretend to be one.
    #[test]
    fn a_phase_that_is_not_a_run_phase_still_reads_fifty() {
        let progress = SectionDetectionProgress::new();
        for phase in ["suspended", "cutover_owed", "aborted"] {
            progress.set_phase(phase, 0);
            assert_eq!(progress.get_percent(), 50, "'{phase}' is not a run phase");
        }
    }
}

#[cfg(test)]
mod write_pragma_tests {
    /// `PRAGMA synchronous` reads back as an integer: 0 OFF, 1 NORMAL, 2 FULL.
    /// The default is FULL, so a writer that never sets it pays two fsyncs a
    /// commit on whichever thread asked.
    #[test]
    fn write_pragmas_put_a_connection_on_normal_synchronous() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        assert_eq!(
            conn.query_row("PRAGMA synchronous", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            2
        );

        super::apply_write_pragmas(&conn).unwrap();

        assert_eq!(
            conn.query_row("PRAGMA synchronous", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            1
        );
    }
}

/// An auto section the athlete can see: not disabled and not superseded. The
/// two review counters and the hide filters both turn on this.
fn is_visible_auto(s: &SectionSummary) -> bool {
    s.section_type == "auto" && !s.disabled && s.superseded_by.is_none()
}

/// Whether the sections list hides this section. A disabled custom section
/// follows the Removed filter as well as the Custom filter.
fn section_filters_hide(filters: &crate::FfiSectionFilters, s: &SectionSummary) -> bool {
    let visible_auto = is_visible_auto(s);
    let custom = s.section_type == "custom";
    let removed = s.disabled || s.superseded_by.is_some();
    let unaccepted_auto = visible_auto && !s.is_user_defined;

    (custom && filters.hide_custom)
        || (visible_auto && filters.hide_auto)
        || (removed && filters.hide_disabled)
        || (unaccepted_auto && filters.hide_unaccepted)
}

/// What a reload would cost, measured rather than argued.
///
/// A reload has to pick up what another process wrote, and the choice is
/// between a full `load()` and a targeted reload of the tiers a push actually
/// invalidates. `load()` is the only loader there has ever been, and it pulls
/// every section's whole polyline, which is the notification extension's
/// memory risk and which on a resume is a launch-sized cost paid on every
/// push.
///
/// The loaders are `pub(super)`, so this lives in the crate rather than in a
/// bench. Nothing asserts, it prints a table, and it is `#[ignore]`d because
/// it needs a real library:
///
///     VELOQ_DEVICE_DB=/tmp/routes.db \
///       cargo test -p veloqrs --lib --release -- --ignored --nocapture reload_cost
///
/// **Memory needs one process per shape.** Within one process the allocator
/// grows for the first shape and every later one reuses what it freed, so the
/// deltas read as zero and the comparison is a lie. `VELOQ_RELOAD_SHAPE` runs
/// a single shape and reports the process's own peak, `VmHWM`:
///
///     for s in full groups metrics metadata evidence; do
///       VELOQ_RELOAD_SHAPE=$s VELOQ_DEVICE_DB=/tmp/routes.db \
///         cargo test -p veloqrs --lib --release -- --ignored --nocapture reload_cost
///     done
///
/// On the S22, which is where the numbers belong, because the engine budgets
/// are that handset's frame:
///
///     cargo test -p veloqrs --lib --release --no-run --target aarch64-linux-android
///     adb push <the binary> /data/local/tmp/
///     adb shell "cd /data/local/tmp && TMPDIR=/data/local/tmp \
///       VELOQ_DEVICE_DB=/data/local/tmp/routes.db VELOQ_RELOAD_SHAPE=full \
///       ./veloqrs-<hash> --ignored --nocapture reload_cost"
#[cfg(test)]
mod reload_cost {
    use super::*;
    use std::path::PathBuf;
    use std::time::Instant;

    /// This process's peak resident bytes, or 0 where `/proc` is not there.
    ///
    /// The high-water mark rather than the current size, because an allocator
    /// that has already grown hides what a load cost. It is a whole-process
    /// figure, so it is only a measure of one shape when the process ran one.
    fn peak_resident_bytes() -> u64 {
        let Ok(status) = std::fs::read_to_string("/proc/self/status") else {
            return 0;
        };
        for line in status.lines() {
            let Some(rest) = line.strip_prefix("VmHWM:") else {
                continue;
            };
            let kb: u64 = rest
                .split_whitespace()
                .next()
                .and_then(|f| f.parse().ok())
                .unwrap_or(0);
            return kb * 1024;
        }
        0
    }

    /// A copy of the athlete's library, sidecars included, so it is never
    /// migrated or written in place. The library runs under WAL, so the main
    /// file alone leaves out every commit since the last checkpoint and reads
    /// as a smaller library rather than a broken copy.
    fn corpus() -> Option<(tempfile::TempDir, PathBuf)> {
        let Ok(named) = std::env::var("VELOQ_DEVICE_DB") else {
            eprintln!("skipped: no VELOQ_DEVICE_DB, so there is no library to measure");
            return None;
        };
        let src = PathBuf::from(&named);
        if !src.exists() {
            eprintln!("skipped: VELOQ_DEVICE_DB={named} does not exist");
            return None;
        }
        let dir = tempfile::TempDir::new().expect("tempdir");
        let dst = dir.path().join("routes.db");
        std::fs::copy(&src, &dst).expect("copy the library");
        for suffix in ["-wal", "-shm"] {
            let from = PathBuf::from(format!("{}{suffix}", src.display()));
            if from.exists() {
                std::fs::copy(&from, dir.path().join(format!("routes.db{suffix}")))
                    .expect("copy the sidecar");
            }
        }
        Some((dir, dst))
    }

    fn open(path: &std::path::Path) -> PersistentEngine {
        PersistentEngine::new(path.to_str().expect("utf-8")).expect("open")
    }

    fn ms(at: Instant) -> f64 {
        at.elapsed().as_secs_f64() * 1000.0
    }

    /// One shape, one process, so `VmHWM` speaks for it.
    fn run_one_shape(path: &std::path::Path, shape: &str) {
        let at = Instant::now();
        let mut engine = open(path);
        let open_ms = ms(at);
        let at = Instant::now();
        match shape {
            "full" => engine.load().expect("load"),
            "groups" => {
                engine.load_groups().expect("groups");
                engine.load_sections().expect("sections");
            }
            "metrics" => {
                engine.load_groups().expect("groups");
                engine.load_sections().expect("sections");
                engine.load_activity_metrics().expect("metrics");
            }
            "metadata" => engine.load_metadata().expect("metadata"),
            "evidence" => {
                engine.load().expect("load");
                let restored = engine.restore_evidence_cache();
                println!("[reload]   evidence cache restored={restored}");
            }
            other => panic!("unknown VELOQ_RELOAD_SHAPE={other}"),
        }
        let load_ms = ms(at);
        println!(
            "[reload] shape={shape:<9} open={open_ms:7.1}ms load={load_ms:7.1}ms peak_rss={:6.1}MB",
            peak_resident_bytes() as f64 / (1024.0 * 1024.0)
        );
    }

    /// Every loader `load()` runs, in its order, timed on one engine.
    ///
    /// Timing is not confounded the way memory is, so this stays one process:
    /// each loader runs once against a cold tier, which is what a reload would
    /// meet.
    fn run_breakdown(path: &std::path::Path) {
        let mut engine = open(path);
        type Loader = fn(&mut PersistentEngine) -> SqlResult<()>;
        let loaders: [(&str, Loader); 7] = [
            ("metadata", |e| e.load_metadata()),
            ("groups", |e| e.load_groups()),
            ("sections", |e| e.load_sections()),
            ("processed_activity_ids", |e| {
                e.load_processed_activity_ids()
            }),
            ("activity_metrics", |e| e.load_activity_metrics()),
            ("match_strictness", |e| {
                e.load_match_strictness_from_settings()
            }),
            ("section_config", |e| e.load_section_config_from_settings()),
        ];
        let mut total = 0.0;
        for (name, loader) in loaders {
            let at = Instant::now();
            loader(&mut engine).unwrap_or_else(|e| panic!("{name}: {e}"));
            let each = ms(at);
            total += each;
            println!("[reload]   {name:<24} {each:7.1}ms");
        }
        let at = Instant::now();
        let restored = engine.restore_evidence_cache();
        println!(
            "[reload]   {:<24} {:7.1}ms restored={restored}",
            "restore_evidence_cache",
            ms(at)
        );
        println!("[reload]   {:<24} {total:7.1}ms", "seven loaders");
    }

    #[test]
    #[ignore]
    fn reload_cost_against_a_real_library() {
        let Some((_dir, path)) = corpus() else { return };
        let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        println!("[reload] library {:.1}MB", bytes as f64 / (1024.0 * 1024.0));

        match std::env::var("VELOQ_RELOAD_SHAPE") {
            Ok(shape) => run_one_shape(&path, &shape),
            Err(_) => run_breakdown(&path),
        }
    }
}

#[cfg(test)]
#[path = "tests/write_txn.rs"]
mod write_txn_tests;

#[cfg(test)]
mod sport_filter_tests {
    use super::{in_sport, sort_pooled_sections};
    use crate::{FfiSectionSort, SectionSummary};

    fn sports(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_mixed_group_belongs_to_each_of_its_sports() {
        let mixed = sports(&["Ride", "Run"]);
        assert!(in_sport(&mixed, "Run"));
        assert!(in_sport(&mixed, "Ride"));
        assert!(!in_sport(&mixed, "Walk"));
    }

    #[test]
    fn nothing_recorded_matches_no_sport() {
        assert!(!in_sport(&[], "Run"));
    }

    fn ranked(id: &str, pooled: f64, sport: f64) -> SectionSummary {
        SectionSummary {
            id: id.to_string(),
            rank_score: Some(pooled),
            sport_rank_score: Some(sport),
            ..Default::default()
        }
    }

    #[test]
    fn signature_reads_the_sport_rank_only_when_narrowed() {
        let order = |within_sport: bool| {
            let mut list = vec![ranked("a", 0.9, 0.1), ranked("b", 0.2, 0.8)];
            sort_pooled_sections(
                &mut list,
                FfiSectionSort::Signature,
                within_sport,
                f64::NAN,
                f64::NAN,
            );
            list.into_iter().map(|s| s.id).collect::<Vec<_>>()
        };
        assert_eq!(order(false), ["a", "b"]);
        assert_eq!(order(true), ["b", "a"]);
    }

    fn ids(list: Vec<SectionSummary>) -> Vec<String> {
        list.into_iter().map(|s| s.id).collect()
    }

    #[test]
    fn signature_falls_back_to_the_pooled_rank_inside_a_sport() {
        let mut list = vec![
            SectionSummary {
                id: "a".into(),
                rank_score: Some(0.4),
                ..Default::default()
            },
            ranked("b", 0.1, 0.2),
        ];
        sort_pooled_sections(
            &mut list,
            FfiSectionSort::Signature,
            true,
            f64::NAN,
            f64::NAN,
        );
        assert_eq!(ids(list), ["a", "b"]);
    }

    #[test]
    fn signature_puts_an_unranked_section_last_and_breaks_ties_by_id() {
        let mut list = vec![
            ranked("c", 0.5, 0.5),
            SectionSummary {
                id: "unranked".into(),
                ..Default::default()
            },
            ranked("b", 0.9, 0.9),
            ranked("a", 0.9, 0.9),
        ];
        sort_pooled_sections(
            &mut list,
            FfiSectionSort::Signature,
            false,
            f64::NAN,
            f64::NAN,
        );
        assert_eq!(ids(list), ["a", "b", "c", "unranked"]);
    }

    #[test]
    fn distance_orders_longest_first_and_breaks_ties_by_id() {
        let section = |id: &str, distance_meters: f64| SectionSummary {
            id: id.into(),
            distance_meters,
            ..Default::default()
        };
        let mut list = vec![
            section("c", 400.0),
            section("a", 1200.0),
            section("b", 400.0),
        ];
        sort_pooled_sections(
            &mut list,
            FfiSectionSort::Distance,
            false,
            f64::NAN,
            f64::NAN,
        );
        assert_eq!(ids(list), ["a", "b", "c"]);
    }
}
