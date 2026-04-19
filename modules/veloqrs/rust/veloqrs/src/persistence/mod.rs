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
    RouteSignature, SectionConfig, SectionPerformanceResult,
};
use lru::LruCache;
use once_cell::sync::Lazy;
use rstar::{AABB, RTree, RTreeObject};
use rusqlite::{Connection, Result as SqlResult};

mod activities;
pub(crate) mod export;
mod fitness;
mod indicators;
mod routes;
mod schema;
mod sections;
mod settings;
mod strength;
mod tiles;
pub(crate) mod wellness;

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

fn haversine_distance_meters(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    const EARTH_RADIUS_M: f64 = 6_371_000.0;

    let dlat = (lat2 - lat1).to_radians();
    let dlng = (lng2 - lng1).to_radians();
    let lat1 = lat1.to_radians();
    let lat2 = lat2.to_radians();

    let a = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());

    EARTH_RADIUS_M * c
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
    /// Current phase: "loading", "building_rtrees", "finding_overlaps",
    /// "clustering", "postprocessing", "saving", "complete"
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
        *self.phase.lock().unwrap() = phase.to_string();
        self.completed.store(0, Ordering::SeqCst);
        self.total.store(total, Ordering::SeqCst);
    }

    pub fn increment(&self) {
        self.completed.fetch_add(1, Ordering::SeqCst);
    }

    pub fn get_phase(&self) -> String {
        self.phase.lock().unwrap().clone()
    }

    pub fn get_completed(&self) -> u32 {
        self.completed.load(Ordering::SeqCst)
    }

    pub fn get_total(&self) -> u32 {
        self.total.load(Ordering::SeqCst)
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

/// Wrapper that injects a "clustering" phase between FindingOverlaps and Postprocessing.
///
/// tracematch reports three phases: BuildingRtrees, FindingOverlaps, Postprocessing.
/// Between FindingOverlaps and Postprocessing, significant work happens (clustering,
/// medoid selection, consensus computation) with no progress reporting. This wrapper
/// intercepts the Postprocessing phase transition and briefly reports "clustering"
/// before forwarding Postprocessing, giving the TypeScript side a finer-grained view.
pub struct ClusteringAwareProgress {
    inner: SectionDetectionProgress,
}

impl ClusteringAwareProgress {
    pub fn new(inner: SectionDetectionProgress) -> Self {
        Self { inner }
    }
}

impl tracematch::DetectionProgressCallback for ClusteringAwareProgress {
    fn on_phase(&self, phase: tracematch::DetectionPhase, total: u32) {
        match phase {
            tracematch::DetectionPhase::Postprocessing => {
                // Before entering postprocessing, signal that clustering just finished.
                // Set clustering phase as "complete" (1/1) so TypeScript sees it at 100%
                // of the clustering range before transitioning to postprocessing.
                self.inner.set_phase("clustering", 1);
                self.inner.increment(); // 1/1 = complete
                // Now forward the real postprocessing phase
                self.inner.set_phase(phase.as_str(), total);
            }
            _ => {
                self.inner.set_phase(phase.as_str(), total);
            }
        }
    }

    fn on_progress(&self) {
        self.inner.increment();
    }
}

/// Handle for background section detection.

pub struct SectionDetectionHandle {
    receiver: mpsc::Receiver<(Vec<FrequentSection>, Vec<String>)>,
    /// Shared progress state
    pub progress: SectionDetectionProgress,
}

impl SectionDetectionHandle {
    /// Check if detection is complete (non-blocking).
    /// Returns (sections, all_activity_ids_in_detection_run).
    pub fn try_recv(&self) -> Option<(Vec<FrequentSection>, Vec<String>)> {
        self.receiver.try_recv().ok()
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
    /// Check if generation is complete (non-blocking). Returns tiles generated count.
    pub fn try_recv(&self) -> Option<u32> {
        self.receiver.try_recv().ok()
    }

    /// Get current progress: (generated, total)
    pub fn get_progress(&self) -> (u32, u32) {
        (
            self.generated.load(Ordering::SeqCst),
            self.total.load(Ordering::SeqCst),
        )
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
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
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
            let activity_ids_json: String = row.get(2)?;
            let activity_ids: Vec<String> =
                serde_json::from_str(&activity_ids_json).unwrap_or_default();

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
    signature_cache: LruCache<String, RouteSignature>,

    /// Tier 2: LRU cached consensus routes (50 max).
    /// `Arc` avoids cloning the full `Vec<GpsPoint>` on every read — cache hits
    /// just bump the refcount and callers either consume a clone of the inner
    /// data or iterate via `&*arc`.
    consensus_cache: LruCache<String, Arc<Vec<GpsPoint>>>,

    /// Tier 2: LRU cached sections for single-item lookups (50 max = ~5MB)
    section_cache: LruCache<String, FrequentSection>,

    /// Tier 2: LRU cached groups for single-item lookups (100 max = ~1MB)
    group_cache: LruCache<String, RouteGroup>,

    /// Cached route groups (loaded from DB)
    groups: Vec<RouteGroup>,

    /// Per-activity match info: route_id -> Vec<ActivityMatchInfo>
    activity_matches: HashMap<String, Vec<ActivityMatchInfo>>,

    /// Activity metrics for performance calculations
    pub(crate) activity_metrics: HashMap<String, ActivityMetrics>,

    /// Time streams for section performance calculations (activity_id -> cumulative times at each GPS point)
    time_streams: HashMap<String, Vec<u32>>,

    /// Cached sections (loaded from DB)
    sections: Vec<FrequentSection>,

    /// Activities that have been through section detection (persisted in SQLite)
    processed_activity_ids: HashSet<String>,

    /// Dirty tracking
    groups_dirty: bool,
    sections_dirty: bool,

    /// Configuration
    match_config: MatchConfig,
    pub(crate) section_config: SectionConfig,

    /// Path for heatmap tile output (set from JS at init)
    pub(crate) heatmap_tiles_path: Option<String>,

    /// Single-entry cache for get_section_performances (avoids redundant computation
    /// when buckets + calendar both call it for the same section on detail load)
    perf_cache_section_id: Option<String>,
    perf_cache_result: Option<SectionPerformanceResult>,
}

impl PersistentRouteEngine {
    /// Invalidate the single-entry performance cache.
    /// Call after any mutation that affects sections, time streams, or activity metrics.
    fn invalidate_perf_cache(&mut self) {
        self.perf_cache_section_id = None;
        self.perf_cache_result = None;
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    /// Create a new persistent engine with the given database path.
    pub fn new(db_path: &str) -> SqlResult<Self> {
        let mut db = Connection::open(db_path)?;
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
            activity_matches: HashMap::new(),
            activity_metrics: HashMap::new(),
            time_streams: HashMap::new(),
            sections: Vec::new(),
            processed_activity_ids: HashSet::new(),
            groups_dirty: false,
            sections_dirty: false,
            match_config: MatchConfig::default(),
            section_config: SectionConfig::default(),
            heatmap_tiles_path: None,
            perf_cache_section_id: None,
            perf_cache_result: None,
        })
    }

    /// Create an in-memory database (for testing).
    pub fn in_memory() -> SqlResult<Self> {
        Self::new(":memory:")
    }

    /// Load all metadata and groups from the database.
    pub fn load(&mut self) -> SqlResult<()> {
        self.load_metadata()?;
        self.load_groups()?;
        self.load_sections()?;
        self.load_processed_activity_ids()?;
        self.load_activity_metrics()?;

        // Backfill activities.duration_secs from activity_metrics.moving_time.
        // Route highlights need duration_secs to compute trends/PRs, but it was
        // historically not populated. This ensures it's always available at startup.
        let backfilled = self.db.execute(
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
        ).unwrap_or(0);
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
                "tracematch: [PersistentEngine] {} activities but no processed IDs — marking sections dirty for re-detection",
                self.activity_metadata.len()
            );
            self.sections_dirty = true;
        }

        // Indicator population is handled lazily via version check in get_activity_indicators().
        // No need to populate here — first read triggers recompute if version mismatches.

        Ok(())
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /// Set match configuration (invalidates computed groups).
    pub fn set_match_config(&mut self, config: MatchConfig) {
        self.match_config = config;
        self.signature_cache.clear(); // Signatures depend on config
        self.groups_dirty = true;
        self.sections_dirty = true;
    }

    /// Set section configuration.
    pub fn set_section_config(&mut self, config: SectionConfig) {
        self.section_config = config;
        self.sections_dirty = true;
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
            .unwrap_or_default();

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

            // Insert activity record
            let _ = self.db.execute(
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
            );

            // Insert activity metrics if available
            if let Some(ref metrics) = source_metrics {
                let _ = self.db.execute(
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
                );

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
                let _ = self.db.execute(
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
                );
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
    /// and aggregate counts/stats — all in one mutex acquisition.
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
                let consensus_polyline = rep_polylines
                    .get(&g.representative_id)
                    .cloned()
                    .unwrap_or_default();
                // Look up distance from representative activity's metrics
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
                    consensus_polyline,
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
                let polyline = section_polylines.get(&s.id).cloned().unwrap_or_default();
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
                    polyline,
                    sport_types: s.sport_types,
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

pub static PERSISTENT_ENGINE: Lazy<Mutex<Option<PersistentRouteEngine>>> =
    Lazy::new(|| Mutex::new(None));

/// Get a lock on the global persistent engine.

pub fn with_persistent_engine<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut PersistentRouteEngine) -> R,
{
    let mut guard = PERSISTENT_ENGINE.lock().ok()?;
    guard.as_mut().map(f)
}

// ============================================================================
// Internal helpers used by UniFFI Object implementations
// ============================================================================

pub mod persistent_engine_ffi {
    use super::*;
    use log::info;

    /// Initialize the persistent engine with a database path.
    /// Called by VeloqEngine::create() — not exported via FFI directly.
    pub fn persistent_engine_init(db_path: String) -> bool {
        crate::init_logging();
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

        match PersistentRouteEngine::new(&db_path) {
            Ok(mut engine) => {
                if let Err(e) = engine.load() {
                    info!(
                        "tracematch: [PersistentEngine] Warning: Failed to load existing data: {:?}",
                        e
                    );
                }

                let mut guard = PERSISTENT_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
                *guard = Some(engine);
                info!("tracematch: [PersistentEngine] Initialized successfully");
                true
            }
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to initialize with path '{}': {:?}",
                    db_path,
                    e
                );
                false
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

    // Approximate threshold in degrees (rough: 1 degree ≈ 111km at equator)
    // Use a generous buffer and verify with haversine
    let threshold_deg = threshold_meters / 111_000.0 * 1.5; // 1.5x safety factor

    let mut matched = 0u32;
    for chunk in coords_a.chunks_exact(2) {
        let lat_a = chunk[0];
        let lng_a = chunk[1];

        let envelope = AABB::from_corners(
            [lat_a - threshold_deg, lng_a - threshold_deg],
            [lat_a + threshold_deg, lng_a + threshold_deg],
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
    fn test_create_engine() {
        let engine = PersistentRouteEngine::in_memory().unwrap();
        assert_eq!(engine.activity_count(), 0);
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
        let temp_path = "/tmp/test_route_engine.db";

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

        // Cleanup
        std::fs::remove_file(temp_path).ok();
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
            version: 1,
            updated_at: None,
            created_at: Some("2026-01-28T00:00:00Z".to_string()),
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

        // Verify initial state (from DATABASE, not in-memory cache)
        let db_section = engine
            .get_section("sec_cycling_1")
            .expect("Section should exist");
        assert_eq!(
            db_section.representative_activity_id,
            Some("activity-1".to_string())
        );
        assert!(!db_section.is_user_defined);

        // Set activity-2 as the new reference
        let result = engine.set_section_reference("sec_cycling_1", "activity-2");
        assert!(
            result.is_ok(),
            "set_section_reference should succeed for auto-detected sections"
        );

        // Verify the reference was changed (from DATABASE)
        let db_section = engine
            .get_section("sec_cycling_1")
            .expect("Section should exist");
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

        // Verify initial state from DATABASE (not in-memory cache)
        let db_section = engine
            .get_section("sec_cycling_auto")
            .expect("Section should exist in DB");
        assert_eq!(
            db_section.polyline.len(),
            50,
            "Initial section should have 50 points"
        );
        let initial_distance = compute_test_polyline_distance(&db_section.polyline);

        // Set the LONG activity as the new reference
        let result = engine.set_section_reference("sec_cycling_auto", "activity-long");
        assert!(result.is_ok());

        // CRITICAL ASSERTION: Read from DATABASE after update
        let db_section = engine
            .get_section("sec_cycling_auto")
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

        // Set reference to activity-1 (marks as user_defined)
        engine
            .set_section_reference("sec_cycling_consensus", "activity-1")
            .unwrap();

        // Verify it's now user-defined (from DATABASE)
        let db_section = engine
            .get_section("sec_cycling_consensus")
            .expect("Section should exist");
        assert!(
            db_section.is_user_defined,
            "Section should be user-defined after set_section_reference"
        );

        // Now reset the reference
        let result = engine.reset_section_reference("sec_cycling_consensus");
        assert!(result.is_ok());

        // CRITICAL ASSERTION: After reset, read from DATABASE
        let db_section = engine
            .get_section("sec_cycling_consensus")
            .expect("Section should exist");

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

        // Get initial state from DB
        let db_section_before = engine
            .get_section("sec_integrity")
            .expect("Section should exist");
        let initial_distance = db_section_before.distance_meters;

        // Set reference to the longer activity
        engine
            .set_section_reference("sec_integrity", "activity-long")
            .unwrap();

        // Read from DATABASE after update
        let db_section = engine
            .get_section("sec_integrity")
            .expect("Section should exist");

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

        // Verify initial state: all 3 activities are associated
        let db_section = engine
            .get_section("sec_rematch_test")
            .expect("Section should exist");
        assert_eq!(
            db_section.activity_ids.len(),
            3,
            "Initial section should have 3 activities"
        );

        // Set activity-1 as reference (this triggers re-matching)
        engine
            .set_section_reference("sec_rematch_test", "activity-1")
            .unwrap();

        // After re-matching, only activities 1 and 2 should remain (they overlap)
        // Activity 3 should be removed (it's in a completely different area)
        let db_section = engine
            .get_section("sec_rematch_test")
            .expect("Section should exist");

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
}
