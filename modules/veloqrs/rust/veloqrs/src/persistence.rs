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

#[cfg(feature = "persistence")]
use std::collections::HashMap;

#[cfg(feature = "persistence")]
use std::sync::mpsc;

#[cfg(feature = "persistence")]
use std::sync::atomic::{AtomicU32, Ordering};

#[cfg(feature = "persistence")]
use std::sync::Arc;

#[cfg(feature = "persistence")]
use std::thread;

#[cfg(feature = "persistence")]
use rusqlite::{Connection, Result as SqlResult, params};

#[cfg(feature = "persistence")]
use rstar::{AABB, RTree, RTreeObject};

#[cfg(feature = "persistence")]
use crate::{
    ActivityMatchInfo, ActivityMetrics, Bounds, DirectionStats, FrequentSection, GpsPoint,
    MatchConfig, RouteGroup, RoutePerformance, RoutePerformanceResult, RouteSignature,
    SectionConfig, SectionLap, SectionPerformanceRecord, SectionPerformanceResult, SectionPortion,
    geo_utils,
};

#[cfg(feature = "persistence")]
use lru::LruCache;

// ============================================================================
// Types
// ============================================================================

/// Lightweight activity metadata kept always in memory.
#[cfg(feature = "persistence")]
#[derive(Debug, Clone)]
pub struct ActivityMetadata {
    pub id: String,
    pub sport_type: String,
    pub bounds: Bounds,
}

/// Bounds wrapper for R-tree spatial indexing.
#[cfg(feature = "persistence")]
#[derive(Debug, Clone)]
pub struct ActivityBoundsEntry {
    pub activity_id: String,
    pub bounds: Bounds,
}

#[cfg(feature = "persistence")]
impl RTreeObject for ActivityBoundsEntry {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            [self.bounds.min_lng, self.bounds.min_lat],
            [self.bounds.max_lng, self.bounds.max_lat],
        )
    }
}

/// Lightweight section metadata for list views (no polyline data).
/// Used to avoid loading full section data with polylines when only summary info is needed.
#[cfg(feature = "persistence")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, uniffi::Record)]
pub struct SectionSummary {
    /// Unique section ID
    pub id: String,
    /// Custom name (user-defined, None if not set)
    pub name: Option<String>,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// Number of times this section was visited
    pub visit_count: u32,
    /// Section length in meters
    pub distance_meters: f64,
    /// Number of activities that traverse this section
    pub activity_count: u32,
    /// Confidence score (0.0-1.0)
    pub confidence: f64,
    /// Detection scale (e.g., "neighborhood", "city")
    pub scale: Option<String>,
    /// Bounding box for map display
    pub bounds: Option<crate::FfiBounds>,
}

/// Lightweight group metadata for list views.
/// Used to avoid loading full group data with activity ID arrays when only summary info is needed.
#[cfg(feature = "persistence")]
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
}

/// Complete activity data for map display.
/// Contains both spatial bounds and metadata for filtering and display.
#[cfg(feature = "persistence")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, uniffi::Record)]
pub struct MapActivityComplete {
    /// Activity ID
    #[serde(rename = "activityId")]
    pub activity_id: String,
    /// Sport type ("Run", "Ride", etc.)
    #[serde(rename = "sportType")]
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
#[cfg(feature = "persistence")]
#[derive(Debug, Clone)]
pub struct SectionDetectionProgress {
    /// Current phase: "loading", "building_rtrees", "finding_overlaps", "clustering", "building_sections", "postprocessing"
    pub phase: Arc<std::sync::Mutex<String>>,
    /// Number of items completed in current phase
    pub completed: Arc<AtomicU32>,
    /// Total items in current phase
    pub total: Arc<AtomicU32>,
}

#[cfg(feature = "persistence")]
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

#[cfg(feature = "persistence")]
impl Default for SectionDetectionProgress {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle for background section detection.
#[cfg(feature = "persistence")]
pub struct SectionDetectionHandle {
    receiver: mpsc::Receiver<Vec<FrequentSection>>,
    /// Shared progress state
    pub progress: SectionDetectionProgress,
}

#[cfg(feature = "persistence")]
impl SectionDetectionHandle {
    /// Check if detection is complete (non-blocking).
    pub fn try_recv(&self) -> Option<Vec<FrequentSection>> {
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
    pub fn recv(self) -> Option<Vec<FrequentSection>> {
        self.receiver.recv().ok()
    }
}

/// Result of matching an activity track against existing sections.
/// This is used for incremental section updates when a new activity is added.
///
/// Note: overlap_points is not included because Vec<GpsPoint> can't be
/// exported via UniFFI. Use start_index/end_index to extract from original track.
#[cfg(feature = "persistence")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, uniffi::Record)]
pub struct ActivitySectionMatch {
    /// Section ID that was matched
    pub section_id: String,
    /// Section name (if set)
    pub section_name: Option<String>,
    /// Distance of the overlapping portion in meters
    pub overlap_distance: f64,
    /// Start index in the original track
    pub start_index: u32,
    /// End index in the original track
    pub end_index: u32,
    /// Match quality (0.0 to 1.0)
    pub match_quality: f64,
    /// Whether the activity goes in the same direction as the section
    pub same_direction: bool,
}

/// Internal version of ActivitySectionMatch that includes overlap points.
/// Used within Rust code but not exposed via FFI.
#[cfg(feature = "persistence")]
#[derive(Debug, Clone)]
struct ActivitySectionMatchInternal {
    pub section_id: String,
    pub section_name: Option<String>,
    pub overlap_points: Vec<GpsPoint>,
    pub overlap_distance: f64,
    pub start_index: u32,
    pub end_index: u32,
    pub match_quality: f64,
    pub same_direction: bool,
}

// ============================================================================
// Helper Functions for Background Threads
// ============================================================================

/// Generate current timestamp in ISO 8601 format.
/// Uses Unix epoch time since chrono is not a dependency.
#[cfg(feature = "persistence")]
fn current_timestamp_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();

    let secs = duration.as_secs();

    // Convert to ISO 8601 format (simplified, always UTC)
    // Format: YYYY-MM-DDTHH:MM:SSZ
    let days_since_epoch = secs / 86400;
    let secs_today = secs % 86400;
    let hours = secs_today / 3600;
    let mins = (secs_today % 3600) / 60;
    let secs_final = secs_today % 60;

    // Calculate year, month, day from days since epoch (1970-01-01)
    // This is a simplified calculation
    let mut days = days_since_epoch as i64;
    let mut year = 1970;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }

    let mut month = 1;
    let days_in_months: [i64; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    for &dim in &days_in_months {
        if days < dim {
            break;
        }
        days -= dim;
        month += 1;
    }

    let day = days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, mins, secs_final
    )
}

#[cfg(feature = "persistence")]
fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Compute Average Minimum Distance (AMD) between two traces.
/// For each point in trace1, find minimum distance to any point in trace2.
/// AMD = average of these minimum distances.
/// Used for medoid calculation in section updates.
#[cfg(feature = "persistence")]
fn compute_amd(trace1: &[GpsPoint], trace2: &[GpsPoint]) -> f64 {
    if trace1.is_empty() || trace2.is_empty() {
        return f64::MAX;
    }

    // Sample points for efficiency (every 5th point)
    let step = 5.max(1);
    let mut total_min_dist = 0.0;
    let mut count = 0;

    for (i, p1) in trace1.iter().enumerate() {
        if i % step != 0 {
            continue;
        }

        let min_dist = trace2
            .iter()
            .map(|p2| geo_utils::haversine_distance(p1, p2))
            .fold(f64::MAX, f64::min);

        total_min_dist += min_dist;
        count += 1;
    }

    if count == 0 {
        f64::MAX
    } else {
        total_min_dist / count as f64
    }
}

/// Load route groups from SQLite database.
/// Used by background threads that have their own DB connection.
#[cfg(feature = "persistence")]
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
#[cfg(feature = "persistence")]
pub struct PersistentRouteEngine {
    /// Database connection
    db: Connection,

    /// Database path (for spawning background threads)
    db_path: String,

    /// Tier 1: Always in memory (lightweight ~80 bytes per activity)
    activity_metadata: HashMap<String, ActivityMetadata>,

    /// In-memory R-tree for fast viewport queries
    spatial_index: RTree<ActivityBoundsEntry>,

    /// Tier 2: LRU cached signatures (200 max = ~2MB)
    signature_cache: LruCache<String, RouteSignature>,

    /// Tier 2: LRU cached consensus routes (50 max)
    consensus_cache: LruCache<String, Vec<GpsPoint>>,

    /// Tier 2: LRU cached sections for single-item lookups (50 max = ~5MB)
    section_cache: LruCache<String, FrequentSection>,

    /// Tier 2: LRU cached groups for single-item lookups (100 max = ~1MB)
    group_cache: LruCache<String, RouteGroup>,

    /// Cached route groups (loaded from DB)
    groups: Vec<RouteGroup>,

    /// Per-activity match info: route_id -> Vec<ActivityMatchInfo>
    activity_matches: HashMap<String, Vec<ActivityMatchInfo>>,

    /// Activity metrics for performance calculations
    activity_metrics: HashMap<String, ActivityMetrics>,

    /// Time streams for section performance calculations (activity_id -> cumulative times at each GPS point)
    time_streams: HashMap<String, Vec<u32>>,

    /// Cached sections (loaded from DB)
    sections: Vec<FrequentSection>,

    /// Dirty tracking
    groups_dirty: bool,
    sections_dirty: bool,

    /// Configuration
    match_config: MatchConfig,
    section_config: SectionConfig,
}

#[cfg(feature = "persistence")]
impl PersistentRouteEngine {
    // ========================================================================
    // Initialization
    // ========================================================================

    /// Create a new persistent engine with the given database path.
    pub fn new(db_path: &str) -> SqlResult<Self> {
        let db = Connection::open(db_path)?;
        Self::init_schema(&db)?;

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
            groups_dirty: false,
            sections_dirty: false,
            match_config: MatchConfig::default(),
            section_config: SectionConfig::default(),
        })
    }

    /// Create an in-memory database (for testing).
    pub fn in_memory() -> SqlResult<Self> {
        Self::new(":memory:")
    }

    /// Initialize the database schema.
    fn init_schema(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(
            r#"
            -- Activity metadata (always loaded)
            CREATE TABLE IF NOT EXISTS activities (
                id TEXT PRIMARY KEY,
                sport_type TEXT NOT NULL,
                min_lat REAL NOT NULL,
                max_lat REAL NOT NULL,
                min_lng REAL NOT NULL,
                max_lng REAL NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                -- Extended metadata for map display (added 2026-01-25)
                start_date INTEGER,           -- Unix timestamp (seconds)
                name TEXT,                    -- Activity name
                distance_meters REAL,         -- Total distance in meters
                duration_secs INTEGER         -- Total duration in seconds
            );

            -- Signatures stored separately (LRU cached)
            CREATE TABLE IF NOT EXISTS signatures (
                activity_id TEXT PRIMARY KEY,
                points BLOB NOT NULL,
                start_point_lat REAL NOT NULL,
                start_point_lng REAL NOT NULL,
                end_point_lat REAL NOT NULL,
                end_point_lng REAL NOT NULL,
                total_distance REAL NOT NULL,
                point_count INTEGER NOT NULL,
                FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
            );

            -- Full GPS tracks (loaded on-demand only)
            CREATE TABLE IF NOT EXISTS gps_tracks (
                activity_id TEXT PRIMARY KEY,
                track_data BLOB NOT NULL,
                point_count INTEGER NOT NULL,
                FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
            );

            -- Computed route groups (persisted)
            CREATE TABLE IF NOT EXISTS route_groups (
                id TEXT PRIMARY KEY,
                representative_id TEXT NOT NULL,
                activity_ids TEXT NOT NULL,
                sport_type TEXT NOT NULL,
                bounds_min_lat REAL,
                bounds_max_lat REAL,
                bounds_min_lng REAL,
                bounds_max_lng REAL
            );

            -- Detected sections (persisted as JSON blob for simplicity)
            CREATE TABLE IF NOT EXISTS sections (
                id TEXT PRIMARY KEY,
                data BLOB NOT NULL
            );

            -- Unification: Add section_type discriminator
            ALTER TABLE sections ADD COLUMN section_type TEXT DEFAULT 'auto';
            UPDATE sections SET section_type = 'custom' WHERE id LIKE 'custom_%';
            CREATE INDEX IF NOT EXISTS idx_sections_type ON sections(section_type);

            -- Junction table for section-activity relationships
            -- Enables O(1) lookup of sections by activity ID
            CREATE TABLE IF NOT EXISTS section_activities (
                section_id TEXT NOT NULL,
                activity_id TEXT NOT NULL,
                PRIMARY KEY (section_id, activity_id),
                FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
            );

            -- Custom route names (user-defined)
            CREATE TABLE IF NOT EXISTS route_names (
                route_id TEXT PRIMARY KEY,
                custom_name TEXT NOT NULL
            );

            -- Custom section names (user-defined)
            CREATE TABLE IF NOT EXISTS section_names (
                section_id TEXT PRIMARY KEY,
                custom_name TEXT NOT NULL
            );

            -- Per-activity match info within route groups
            CREATE TABLE IF NOT EXISTS activity_matches (
                route_id TEXT NOT NULL,
                activity_id TEXT NOT NULL,
                match_percentage REAL NOT NULL,
                direction TEXT NOT NULL,
                PRIMARY KEY (route_id, activity_id)
            );

            -- Activity metrics for performance calculations
            CREATE TABLE IF NOT EXISTS activity_metrics (
                activity_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                date INTEGER NOT NULL,
                distance REAL NOT NULL,
                moving_time INTEGER NOT NULL,
                elapsed_time INTEGER NOT NULL,
                elevation_gain REAL NOT NULL,
                avg_hr INTEGER,
                avg_power INTEGER,
                sport_type TEXT NOT NULL
            );

            -- Custom sections (user-created)
            CREATE TABLE IF NOT EXISTS custom_sections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                polyline_json TEXT NOT NULL,
                source_activity_id TEXT NOT NULL,
                start_index INTEGER NOT NULL,
                end_index INTEGER NOT NULL,
                sport_type TEXT NOT NULL,
                distance_meters REAL NOT NULL,
                created_at TEXT NOT NULL
            );

            -- Custom section matches (supports multiple traversals per activity)
            CREATE TABLE IF NOT EXISTS custom_section_matches (
                section_id TEXT NOT NULL,
                activity_id TEXT NOT NULL,
                start_index INTEGER NOT NULL,
                end_index INTEGER NOT NULL,
                direction TEXT NOT NULL,
                distance_meters REAL NOT NULL,
                PRIMARY KEY (section_id, activity_id, start_index),
                FOREIGN KEY (section_id) REFERENCES custom_sections(id) ON DELETE CASCADE
            );

            -- Time streams for section performance calculations
            -- Stores cumulative seconds at each GPS point
            CREATE TABLE IF NOT EXISTS time_streams (
                activity_id TEXT PRIMARY KEY,
                times BLOB NOT NULL,
                point_count INTEGER NOT NULL,
                FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
            );

            -- Overlap cache for section detection
            -- Caches pairwise overlap results to avoid O(N²) recalculation
            -- activity_a < activity_b lexicographically to avoid duplicates
            CREATE TABLE IF NOT EXISTS overlap_cache (
                activity_a TEXT NOT NULL,
                activity_b TEXT NOT NULL,
                has_overlap INTEGER NOT NULL,
                overlap_data BLOB,
                computed_at INTEGER NOT NULL,
                PRIMARY KEY (activity_a, activity_b)
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities(sport_type);
            CREATE INDEX IF NOT EXISTS idx_activities_bounds ON activities(min_lat, max_lat, min_lng, max_lng);
            CREATE INDEX IF NOT EXISTS idx_groups_sport ON route_groups(sport_type);
            CREATE INDEX IF NOT EXISTS idx_activity_matches_route ON activity_matches(route_id);
            CREATE INDEX IF NOT EXISTS idx_custom_section_matches_section ON custom_section_matches(section_id);
            CREATE INDEX IF NOT EXISTS idx_overlap_cache_a ON overlap_cache(activity_a);
            CREATE INDEX IF NOT EXISTS idx_overlap_cache_b ON overlap_cache(activity_b);
            CREATE INDEX IF NOT EXISTS idx_section_activities_activity ON section_activities(activity_id);

            -- Enable foreign keys
            PRAGMA foreign_keys = ON;
        "#,
        )?;

        // Run migrations for existing databases
        Self::migrate_schema(conn)?;

        Ok(())
    }

    /// Migrate schema for existing databases (add new columns if missing).
    fn migrate_schema(conn: &Connection) -> SqlResult<()> {
        // Check if start_date column exists
        let has_start_date: bool = conn
            .prepare("SELECT start_date FROM activities LIMIT 0")
            .is_ok();

        if !has_start_date {
            // Add new columns to activities table
            conn.execute_batch(
                r#"
                ALTER TABLE activities ADD COLUMN start_date INTEGER;
                ALTER TABLE activities ADD COLUMN name TEXT;
                ALTER TABLE activities ADD COLUMN distance_meters REAL;
                ALTER TABLE activities ADD COLUMN duration_secs INTEGER;
                "#,
            )?;
            log::info!("[PersistentEngine] Migrated activities table: added metadata columns");
        }

        // Migrate custom_section_matches to support multiple traversals per activity
        // Old schema: PRIMARY KEY (section_id, activity_id)
        // New schema: PRIMARY KEY (section_id, activity_id, start_index)
        Self::migrate_custom_section_matches(conn)?;

        Ok(())
    }

    /// Migrate custom_section_matches table to support multiple traversals per activity.
    fn migrate_custom_section_matches(conn: &Connection) -> SqlResult<()> {
        // Check if table exists at all
        let table_exists: bool = conn
            .prepare("SELECT 1 FROM custom_section_matches LIMIT 0")
            .is_ok();

        if !table_exists {
            return Ok(()); // Table will be created with new schema
        }

        // Check the primary key structure by looking at table info
        // If start_index is NOT part of the primary key, we need to migrate
        let mut stmt = conn.prepare("PRAGMA table_info(custom_section_matches)")?;
        let columns: Vec<(String, i32)> = stmt
            .query_map([], |row| {
                let name: String = row.get(1)?;
                let pk: i32 = row.get(5)?; // pk column (0 = not pk, >0 = pk position)
                Ok((name, pk))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Check if start_index has pk > 0
        let start_index_is_pk = columns
            .iter()
            .any(|(name, pk)| name == "start_index" && *pk > 0);

        if start_index_is_pk {
            return Ok(()); // Already migrated
        }

        log::info!(
            "[PersistentEngine] Migrating custom_section_matches to support multiple traversals"
        );

        // Recreate table with new schema
        conn.execute_batch(
            r#"
            -- Create new table with updated primary key
            CREATE TABLE custom_section_matches_new (
                section_id TEXT NOT NULL,
                activity_id TEXT NOT NULL,
                start_index INTEGER NOT NULL,
                end_index INTEGER NOT NULL,
                direction TEXT NOT NULL,
                distance_meters REAL NOT NULL,
                PRIMARY KEY (section_id, activity_id, start_index),
                FOREIGN KEY (section_id) REFERENCES custom_sections(id) ON DELETE CASCADE
            );

            -- Don't copy existing data - we want to re-match with the new multi-traversal logic
            -- Old matches only had one traversal per activity, new logic finds all traversals

            -- Drop old table and rename new one
            DROP TABLE custom_section_matches;
            ALTER TABLE custom_section_matches_new RENAME TO custom_section_matches;

            -- Recreate index
            CREATE INDEX IF NOT EXISTS idx_custom_section_matches_section
            ON custom_section_matches(section_id);
            "#,
        )?;

        log::info!("[PersistentEngine] Migration complete: custom_section_matches cleared for re-matching with multi-traversal support");

        Ok(())
    }

    /// Load all metadata and groups from the database.
    pub fn load(&mut self) -> SqlResult<()> {
        self.load_metadata()?;
        self.load_groups()?;
        self.load_sections()?;
        self.load_activity_metrics()?;
        Ok(())
    }

    /// Load activity metadata into memory (lightweight).
    fn load_metadata(&mut self) -> SqlResult<()> {
        self.activity_metadata.clear();

        let mut stmt = self
            .db
            .prepare("SELECT id, sport_type, min_lat, max_lat, min_lng, max_lng FROM activities")?;

        let entries: Vec<ActivityBoundsEntry> = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let sport_type: String = row.get(1)?;
                let bounds = Bounds {
                    min_lat: row.get(2)?,
                    max_lat: row.get(3)?,
                    min_lng: row.get(4)?,
                    max_lng: row.get(5)?,
                };

                self.activity_metadata.insert(
                    id.clone(),
                    ActivityMetadata {
                        id: id.clone(),
                        sport_type,
                        bounds,
                    },
                );

                Ok(ActivityBoundsEntry {
                    activity_id: id,
                    bounds,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        self.spatial_index = RTree::bulk_load(entries);
        Ok(())
    }

    /// Load route groups from database.
    fn load_groups(&mut self) -> SqlResult<()> {
        self.groups.clear();

        // Scope the statement to release the borrow before load_route_names
        {
            let mut stmt = self.db.prepare(
                "SELECT id, representative_id, activity_ids, sport_type,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                 FROM route_groups",
            )?;

            self.groups = stmt
                .query_map([], |row| {
                    let activity_ids_json: String = row.get(2)?;
                    let activity_ids: Vec<String> =
                        serde_json::from_str(&activity_ids_json).unwrap_or_default();

                    let bounds =
                        if let (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) = (
                            row.get::<_, Option<f64>>(4)?,
                            row.get::<_, Option<f64>>(5)?,
                            row.get::<_, Option<f64>>(6)?,
                            row.get::<_, Option<f64>>(7)?,
                        ) {
                            Some(Bounds {
                                min_lat,
                                max_lat,
                                min_lng,
                                max_lng,
                            })
                        } else {
                            None
                        };

                    Ok(RouteGroup {
                        group_id: row.get(0)?,
                        representative_id: row.get(1)?,
                        activity_ids,
                        sport_type: row.get(3)?,
                        bounds,
                        custom_name: None, // Will be loaded separately from route_names table
                        // Performance stats populated by engine when metrics are available
                        best_time: None,
                        avg_time: None,
                        best_pace: None,
                        best_activity_id: None,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
        }

        // Load custom names and apply to groups
        self.load_route_names()?;

        // Load activity matches
        self.load_activity_matches()?;

        // If we have groups but no match info, force recompute to populate match percentages
        // This handles databases created before match percentage tracking was added
        let groups_count = self.groups.len();
        let matches_count = self.activity_matches.len();
        log::info!(
            "tracematch: load_groups: {} groups, {} activity_matches entries",
            groups_count,
            matches_count
        );

        if !self.groups.is_empty() && self.activity_matches.is_empty() {
            log::info!(
                "tracematch: Forcing groups recompute: groups exist but activity_matches is empty"
            );
            self.groups_dirty = true;
        } else {
            self.groups_dirty = false;
        }
        Ok(())
    }

    /// Load activity match info from the database.
    fn load_activity_matches(&mut self) -> SqlResult<()> {
        self.activity_matches.clear();

        let mut stmt = self.db.prepare(
            "SELECT route_id, activity_id, match_percentage, direction FROM activity_matches",
        )?;

        let matches: Vec<(String, ActivityMatchInfo)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ActivityMatchInfo {
                        activity_id: row.get(1)?,
                        match_percentage: row.get(2)?,
                        direction: row.get(3)?,
                    },
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Group by route_id
        for (route_id, match_info) in matches {
            self.activity_matches
                .entry(route_id)
                .or_default()
                .push(match_info);
        }

        Ok(())
    }

    /// Load activity metrics from the database.
    fn load_activity_metrics(&mut self) -> SqlResult<()> {
        self.activity_metrics.clear();

        let mut stmt = self.db.prepare(
            "SELECT activity_id, name, date, distance, moving_time, elapsed_time,
                    elevation_gain, avg_hr, avg_power, sport_type
             FROM activity_metrics",
        )?;

        let metrics_iter = stmt.query_map([], |row| {
            Ok(ActivityMetrics {
                activity_id: row.get(0)?,
                name: row.get(1)?,
                date: row.get(2)?,
                distance: row.get(3)?,
                moving_time: row.get(4)?,
                elapsed_time: row.get(5)?,
                elevation_gain: row.get(6)?,
                avg_hr: row.get::<_, Option<i32>>(7)?.map(|v| v as u16),
                avg_power: row.get::<_, Option<i32>>(8)?.map(|v| v as u16),
                sport_type: row.get(9)?,
            })
        })?;

        for m in metrics_iter.flatten() {
            self.activity_metrics.insert(m.activity_id.clone(), m);
        }

        Ok(())
    }

    /// Load custom route names and apply them to groups.
    fn load_route_names(&mut self) -> SqlResult<()> {
        let mut stmt = self
            .db
            .prepare("SELECT route_id, custom_name FROM route_names")?;

        let names: HashMap<String, String> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Apply names to groups
        for group in &mut self.groups {
            if let Some(name) = names.get(&group.group_id) {
                group.custom_name = Some(name.clone());
            }
        }

        Ok(())
    }

    /// Load sections from database.
    fn load_sections(&mut self) -> SqlResult<()> {
        self.sections.clear();

        // First check how many rows are in the table
        let count: i64 = self
            .db
            .query_row("SELECT COUNT(*) FROM sections", [], |row| row.get(0))
            .unwrap_or(0);
        log::info!(
            "tracematch: [PersistentEngine] Loading sections: {} rows in DB",
            count
        );

        let mut stmt = self.db.prepare("SELECT id, data FROM sections")?;

        self.sections = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let data_blob: Vec<u8> = row.get(1)?;
                let section: FrequentSection =
                    serde_json::from_slice(&data_blob).unwrap_or_else(|e| {
                        log::info!(
                            "tracematch: [PersistentEngine] Failed to deserialize section {}: {:?}",
                            id,
                            e
                        );
                        // Return a default/empty section if deserialization fails
                        FrequentSection {
                            id: String::new(),
                            name: None,
                            sport_type: String::new(),
                            polyline: vec![],
                            representative_activity_id: String::new(),
                            activity_ids: vec![],
                            activity_portions: vec![],
                            route_ids: vec![],
                            visit_count: 0,
                            distance_meters: 0.0,
                            activity_traces: std::collections::HashMap::new(),
                            confidence: 0.0,
                            observation_count: 0,
                            average_spread: 0.0,
                            point_density: vec![],
                            scale: None,
                            // Evolution fields
                            version: 1,
                            is_user_defined: false,
                            created_at: None,
                            updated_at: None,
                            stability: 0.0,
                        }
                    });
                Ok(section)
            })?
            .filter_map(|r| r.ok())
            .filter(|s: &FrequentSection| !s.id.is_empty())
            .collect();

        log::info!(
            "tracematch: [PersistentEngine] Loaded {} sections into memory (from {} in DB)",
            self.sections.len(),
            count
        );

        // Log section IDs for debugging
        if !self.sections.is_empty() {
            let section_ids: Vec<&str> = self.sections.iter().take(10).map(|s| s.id.as_str()).collect();
            log::info!(
                "tracematch: [PersistentEngine] First {} section IDs: {:?}",
                section_ids.len(),
                section_ids
            );
        }

        self.sections_dirty = false;
        Ok(())
    }

    // ========================================================================
    // Activity Management
    // ========================================================================

    /// Add an activity with its GPS coordinates.
    pub fn add_activity(
        &mut self,
        id: String,
        coords: Vec<GpsPoint>,
        sport_type: String,
    ) -> SqlResult<()> {
        let bounds = Bounds::from_points(&coords).unwrap_or(Bounds {
            min_lat: 0.0,
            max_lat: 0.0,
            min_lng: 0.0,
            max_lng: 0.0,
        });

        // Create signature
        let signature = RouteSignature::from_points(&id, &coords, &self.match_config);

        // Store to database
        self.store_activity(&id, &sport_type, &bounds)?;
        self.store_gps_track(&id, &coords)?;
        if let Some(sig) = &signature {
            self.store_signature(&id, sig)?;
            // Also cache it since we just computed it
            self.signature_cache.put(id.clone(), sig.clone());
        }

        // Update in-memory state
        let metadata = ActivityMetadata {
            id: id.clone(),
            sport_type,
            bounds,
        };
        self.activity_metadata.insert(id.clone(), metadata);

        // Rebuild spatial index (could be optimized with incremental insert)
        self.rebuild_spatial_index();

        // Mark computed results as dirty
        self.groups_dirty = true;
        self.sections_dirty = true;

        Ok(())
    }

    /// Add an activity from flat coordinate buffer.
    pub fn add_activity_flat(
        &mut self,
        id: String,
        flat_coords: &[f64],
        sport_type: String,
    ) -> SqlResult<()> {
        let coords: Vec<GpsPoint> = flat_coords
            .chunks_exact(2)
            .map(|chunk| GpsPoint::new(chunk[0], chunk[1]))
            .collect();
        self.add_activity(id, coords, sport_type)
    }

    /// Remove an activity.
    pub fn remove_activity(&mut self, id: &str) -> SqlResult<()> {
        // Remove from database (cascade deletes signature and track)
        self.db
            .execute("DELETE FROM activities WHERE id = ?", params![id])?;

        // Remove from memory
        self.activity_metadata.remove(id);
        self.signature_cache.pop(&id.to_string());
        self.consensus_cache.clear(); // Invalidate all consensus since groups may change

        self.rebuild_spatial_index();

        self.groups_dirty = true;
        self.sections_dirty = true;

        Ok(())
    }

    /// Clear all data.
    pub fn clear(&mut self) -> SqlResult<()> {
        self.db.execute_batch(
            "DELETE FROM sections;
             DELETE FROM route_groups;
             DELETE FROM gps_tracks;
             DELETE FROM signatures;
             DELETE FROM activities;
             DELETE FROM activity_metrics;
             DELETE FROM activity_matches;
             DELETE FROM time_streams;
             DELETE FROM overlap_cache;",
        )?;

        self.activity_metadata.clear();
        self.activity_metrics.clear();
        self.spatial_index = RTree::new();
        self.signature_cache.clear();
        self.consensus_cache.clear();
        self.groups.clear();
        self.sections.clear();
        self.groups_dirty = false;
        self.sections_dirty = false;

        Ok(())
    }

    /// Remove activities older than the specified retention period.
    ///
    /// This cleans up old activities and their associated data (GPS tracks, signatures)
    /// to prevent unbounded database growth. Cascade deletes handle related data automatically.
    ///
    /// # Arguments
    /// * `retention_days` - Number of days to retain activities (0 = keep all, 30-365 for cleanup)
    ///
    /// # Returns
    /// * `Ok(deleted_count)` - Number of activities deleted
    /// * `Err(...)` - Database error
    ///
    /// # Side Effects
    /// * Marks groups and sections as dirty for re-computation
    /// * Reloads metadata from database
    ///
    /// # Example
    /// ```no_run
    /// # use veloqrs::persistence::PersistentRouteEngine;
    /// # let mut engine: PersistentRouteEngine = unsafe { std::mem::zeroed() };
    /// // Delete activities older than 90 days
    /// let deleted = engine.cleanup_old_activities(90).unwrap();
    /// println!("Deleted {} old activities", deleted);
    ///
    /// // Keep all activities (retention_days = 0)
    /// let deleted = engine.cleanup_old_activities(0).unwrap();
    /// assert_eq!(deleted, 0);
    /// ```
    pub fn cleanup_old_activities(&mut self, retention_days: u32) -> SqlResult<u32> {
        // If retention_days is 0, keep all activities
        if retention_days == 0 {
            log::info!(
                "tracematch: [PersistentEngine] Cleanup skipped: retention period is 0 (keep all)"
            );
            return Ok(0);
        }

        // Calculate cutoff timestamp (current time - retention period)
        let cutoff_seconds = retention_days as i64 * 24 * 60 * 60;

        // Delete old activities (cascade will handle signatures, GPS tracks, matches)
        let deleted = self.db.execute(
            "DELETE FROM activities WHERE created_at < (strftime('%s', 'now') - ?)",
            params![cutoff_seconds],
        )?;

        // If any activities were deleted, reload metadata and mark for re-computation
        if deleted > 0 {
            // Clear affected caches
            self.signature_cache.clear();
            self.consensus_cache.clear();

            // Reload metadata from database
            self.load_metadata()?;

            // Mark groups and sections as dirty since activities changed
            self.groups_dirty = true;
            self.sections_dirty = true;

            log::info!(
                "tracematch: [PersistentEngine] Cleaned up {} activities older than {} days",
                deleted,
                retention_days
            );
        }

        Ok(deleted as u32)
    }

    /// Force re-computation of route groups and sections.
    ///
    /// This should be called when historical activities are added (e.g., cache expansion)
    /// to improve route quality with the new data. The next call to `get_groups()` or
    /// `get_sections()` will trigger re-computation with the expanded dataset.
    ///
    /// # Example
    /// ```no_run
    /// # use veloqrs::persistence::PersistentRouteEngine;
    /// # let mut engine: PersistentRouteEngine = unsafe { std::mem::zeroed() };
    /// // User expanded cache from 90 days to 1 year
    /// engine.mark_for_recomputation();
    /// // Next access to groups/sections will re-compute with improved data
    /// let groups = engine.get_groups();
    /// ```
    pub fn mark_for_recomputation(&mut self) {
        if !self.groups_dirty && !self.sections_dirty {
            self.groups_dirty = true;
            self.sections_dirty = true;
            log::info!("tracematch: [PersistentEngine] Marked for re-computation (cache expanded)");
    }

    // ========================================================================
    // Unified Section Types and Functions
    // ========================================================================

    /// Get all sections (both auto and custom) with optional filtering.
    /// Single unified query replacing get_sections_json() and get_custom_sections_json().
    pub fn get_sections_unified(
        &self,
        sport_type: Option<&str>,
        min_visits: Option<u32>,
        include_matches: bool,
    ) -> Vec<UnifiedSection> {
        let mut result = Vec::new();

        let mut sql = String::from(
            "SELECT id, section_type, name, polyline_json, sport_type, distance_meters,
                    source_activity_id, start_index, end_index, visit_count,
                    representative_activity_id, confidence, observation_count, average_spread,
                    point_density, scale, version, is_user_defined, stability,
                    created_at, updated_at, route_ids
             FROM sections"
        );

        let mut params = Vec::new();

        if let Some(sport) = sport_type {
            sql.push_str(" WHERE sport_type = ?");
            params.push(sport.to_string());
        }

        if let Some(min) = min_visits {
            if sql.contains("WHERE") {
                sql.push_str(" AND visit_count >= ?");
            } else {
                sql.push_str(" WHERE visit_count >= ?");
            }
            params.push(min.to_string());
        }

        let mut stmt = self.db.prepare(&sql).ok()?;

        while let Ok(row) = stmt.next() {
            let polyline_json: String = row.get(6).ok().unwrap_or_default();
            let polyline: Vec<GpsPoint> = serde_json::from_str(&polyline_json)
                .unwrap_or_default();

            let point_density: Option<Vec<u32>> = row.get(15).ok()
                .and_then(|pd: String| serde_json::from_str(&pd).ok());

            let route_ids: Option<Vec<String>> = row.get(20).ok()
                .and_then(|rids: String| serde_json::from_str(&rids).ok());

            let mut section = UnifiedSection {
                id: row.get(0).ok().unwrap_or_default(),
                section_type: row.get::<String>(1).ok()
                    .and_then(|st| match st.as_str() {
                        "auto" => Some(SectionType::Auto),
                        "custom" => Some(SectionType::Custom),
                        _ => None,
                    })
                    .unwrap_or(SectionType::Auto),
                name: row.get::<String>(2).ok(),
                polyline,
                sport_type: row.get(8).ok().unwrap_or_default(),
                distance_meters: row.get(9).ok().unwrap_or(0.0),
                source_activity_id: row.get::<String>(10).ok(),
                start_index: row.get::<u32>(11).ok(),
                end_index: row.get::<u32>(12).ok(),
                visit_count: row.get(13).ok().unwrap_or(0),
                representative_activity_id: row.get::<String>(14).ok(),
                confidence: row.get::<f64>(15).ok(),
                observation_count: row.get::<u32>(16).ok(),
                average_spread: row.get::<f64>(17).ok(),
                point_density,
                scale: row.get::<String>(19).ok(),
                version: row.get::<u32>(21).ok().unwrap_or(0),
                is_user_defined: row.get::<i64>(22).ok().unwrap_or(0) != 0,
                stability: row.get::<f64>(23).ok(),
                created_at: row.get(24).ok().unwrap_or_default(),
                updated_at: row.get::<String>(25).ok(),
                route_ids,
                activity_portions: if include_matches {
                    self.get_section_activities(&row.get::<String>(0).ok().unwrap_or_default())
                } else {
                    None
                },
            };

            result.push(section);
        }

        result
    }

    /// Get activity portions for a section.
    fn get_section_activities(&self, section_id: &str) -> Option<Vec<SectionPortion>> {
        let mut stmt = self.db.prepare(
            "SELECT activity_id, start_index, end_index, direction, distance_meters
             FROM section_activities WHERE section_id = ? ORDER BY activity_id"
        ).ok()?;

        let mut portions = Vec::new();
        while let Ok(row) = stmt.next() {
            portions.push(SectionPortion {
                activity_id: row.get(0).ok().unwrap_or_default(),
                start_index: row.get(1).ok().unwrap_or(0),
                end_index: row.get(2).ok().unwrap_or(0),
                distance_meters: row.get(3).ok().unwrap_or(0.0),
                direction: row.get::<String>(4).ok().unwrap_or("same".to_string()),
            });
        }

        Some(portions)
    }

    /// Get a single section by ID (works for both auto and custom).
    pub fn get_section_by_id_unified(&self, section_id: &str) -> Option<UnifiedSection> {
        let sections = self.get_sections_unified(None, None, false);
        sections.into_iter().find(|s| s.id == section_id)
    }

    /// Create a section (works for both auto and custom).
    /// For custom: user provides start/end indices
    /// For auto: engine detects automatically
    pub fn create_section_unified(
        &mut self,
        params: CreateSectionParams,
    ) -> Result<String, String> {
        let id = if params.source_activity_id.is_some() {
            format!("custom_{}", chrono_timestamp())
        } else {
            format!("section_{}", generate_hash())
        };

        let section_type = if params.source_activity_id.is_some() {
            SectionType::Custom
        } else {
            SectionType::Auto
        };

        let polyline_json = serde_json::to_string(&params.polyline)
            .map_err(|e| format!("Failed to serialize polyline: {}", e))?;

        let point_density_json = params.point_density
            .map(|pd| serde_json::to_string(pd).ok())
            .flatten();

        let route_ids_json = params.route_ids
            .map(|rids| serde_json::to_string(rids).ok())
            .flatten();

        self.db.execute(
            "INSERT INTO sections (id, section_type, name, polyline_json, sport_type,
                                  distance_meters, source_activity_id, start_index, end_index,
                                  visit_count, created_at, point_density, route_ids)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
            params![
                &id,
                match section_type {
                    SectionType::Auto => "auto",
                    SectionType::Custom => "custom",
                },
                params.name,
                &polyline_json,
                &params.sport_type,
                params.distance_meters,
                params.source_activity_id,
                params.start_index,
                params.end_index,
                current_timestamp_iso(),
                point_density_json,
                route_ids_json,
            ],
        )?;

        Ok(id)
    }

    /// Create section parameters.
    #[derive(Debug, Clone)]
    pub struct CreateSectionParams {
        pub sport_type: String,
        pub polyline: Vec<GpsPoint>,
        pub distance_meters: f64,
        pub name: Option<String>,
        pub source_activity_id: Option<String>,
        pub start_index: Option<u32>,
        pub end_index: Option<u32>,
        pub point_density: Option<Vec<u32>>,
        pub route_ids: Option<Vec<String>>,
    }

    /// Remove or disable section based on type.
    /// Custom sections: DELETE from database
    /// Auto sections: Optionally disable (or delete entirely)
    pub fn remove_or_disable_section(
        &mut self,
        section_id: &str,
        disable_only: bool,
    ) -> Result<(), String> {
        let section = self
            .get_section_by_id_unified(section_id)
            .ok_or_else(|| format!("Section {} not found", section_id))?;

        match section.section_type {
            SectionType::Custom => {
                self.db.execute("DELETE FROM sections WHERE id = ?", params![section_id])?;
                self.db.execute("DELETE FROM section_names WHERE section_id = ?", params![section_id])?;
                self.db.execute("DELETE FROM section_activities WHERE section_id = ?", params![section_id])?;
            }
            SectionType::Auto => {
                if disable_only {
                    self.db.execute(
                        "INSERT OR REPLACE INTO disabled_sections (section_id) VALUES (?)",
                        params![section_id],
                    )?;
                } else {
                    self.db.execute("DELETE FROM sections WHERE id = ?", params![section_id])?;
                    self.db.execute("DELETE FROM section_names WHERE section_id = ?", params![section_id])?;
                    self.db.execute("DELETE FROM section_activities WHERE section_id = ?", params![section_id])?;
                }
            }
        }

        Ok(())
    }
}

// ============================================================================
// Global Singleton for FFI
// ============================================================================
// Global Singleton for FFI
// ============================================================================

#[cfg(feature = "persistence")]
use std::sync::Mutex;

#[cfg(feature = "persistence")]
use once_cell::sync::Lazy;

/// Global persistent engine instance.
///
/// This singleton allows FFI calls to access a shared persistent engine
/// without passing state back and forth across the FFI boundary.
#[cfg(feature = "persistence")]
pub static PERSISTENT_ENGINE: Lazy<Mutex<Option<PersistentRouteEngine>>> =
    Lazy::new(|| Mutex::new(None));

/// Get a lock on the global persistent engine.
#[cfg(feature = "persistence")]
pub fn with_persistent_engine<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut PersistentRouteEngine) -> R,
{
    let mut guard = PERSISTENT_ENGINE.lock().ok()?;
    guard.as_mut().map(f)
}

// ============================================================================
// FFI Exports for Persistent Engine
// ============================================================================

#[cfg(all(feature = "ffi", feature = "persistence"))]
pub mod persistent_engine_ffi {
    use super::*;
    use log::info;

    /// Initialize the persistent engine with a database path.
    /// Call this once at app startup before any other persistent engine functions.
    #[uniffi::export]
    pub fn persistent_engine_init(db_path: String) -> bool {
        crate::init_logging();
        info!(
            "tracematch: [PersistentEngine] Initializing with db: {}",
            db_path
        );

        match PersistentRouteEngine::new(&db_path) {
            Ok(mut engine) => {
                // Load existing data
                if let Err(e) = engine.load() {
                    info!(
                        "tracematch: [PersistentEngine] Warning: Failed to load existing data: {:?}",
                        e
                    );
                }

                let mut guard = PERSISTENT_ENGINE.lock().unwrap();
                *guard = Some(engine);
                info!("tracematch: [PersistentEngine] Initialized successfully");
                true
            }
            Err(e) => {
                info!(
                    "tracematch: [PersistentEngine] Failed to initialize: {:?}",
                    e
                );
                false
            }
        }
    }

    /// Check if the persistent engine is initialized.
    #[uniffi::export]
    pub fn persistent_engine_is_initialized() -> bool {
        PERSISTENT_ENGINE
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    /// Clear all persistent engine state.
    #[uniffi::export]
    pub fn persistent_engine_clear() {
        if let Some(()) = with_persistent_engine(|e| {
            e.clear().ok();
        }) {
            info!("tracematch: [PersistentEngine] Cleared");
        }
    }

    /// Remove activities older than the specified retention period.
    ///
    /// This prevents unbounded database growth by cleaning up old activities.
    /// Cascade deletes automatically remove associated GPS tracks, signatures,
    /// and match data. Groups and sections are marked for re-computation.
    ///
    /// # Arguments
    /// * `retention_days` - Number of days to retain (0 = keep all, 30-365 for cleanup)
    ///
    /// # Returns
    /// Number of activities deleted, or 0 if retention_days is 0
    #[uniffi::export]
    pub fn persistent_engine_cleanup_old_activities(retention_days: u32) -> u32 {
        with_persistent_engine(|e| match e.cleanup_old_activities(retention_days) {
            Ok(count) => {
                if retention_days > 0 && count > 0 {
                    info!(
                        "tracematch: [PersistentEngine] Cleanup completed: {} activities removed",
                        count
                    );
                }
                count
            }
            Err(e) => {
                log::error!("tracematch: [PersistentEngine] Cleanup failed: {:?}", e);
                0
            }
        })
        .unwrap_or(0)
    }

    /// Mark route engine for re-computation.
    ///
    /// Call this when historical activities are added (e.g., cache expansion)
    /// to trigger re-computation of route groups and sections with the new data.
    #[uniffi::export]
    pub fn persistent_engine_mark_for_recomputation() {
        with_persistent_engine(|e| {
            e.mark_for_recomputation();
            info!("tracematch: [PersistentEngine] Marked for re-computation");
        });
    }

    /// Add activities from flat coordinate buffers.
    /// Coordinates are [lat1, lng1, lat2, lng2, ...] for each activity.
    #[uniffi::export]
    pub fn persistent_engine_add_activities(
        activity_ids: Vec<String>,
        all_coords: Vec<f64>,
        offsets: Vec<u32>,
        sport_types: Vec<String>,
    ) {
        info!(
            "tracematch: [PersistentEngine] Adding {} activities ({} coords)",
            activity_ids.len(),
            all_coords.len() / 2
        );

        with_persistent_engine(|engine| {
            for (i, id) in activity_ids.iter().enumerate() {
                let start = offsets[i] as usize;
                let end = offsets
                    .get(i + 1)
                    .map(|&o| o as usize)
                    .unwrap_or(all_coords.len() / 2);

                let coords: Vec<crate::GpsPoint> = (start..end)
                    .filter_map(|j| {
                        let idx = j * 2;
                        if idx + 1 < all_coords.len() {
                            Some(crate::GpsPoint::new(all_coords[idx], all_coords[idx + 1]))
                        } else {
                            None
                        }
                    })
                    .collect();

                let sport = sport_types.get(i).cloned().unwrap_or_default();
                engine.add_activity(id.clone(), coords, sport).ok();
            }
        });
    }

    /// Remove activities by ID.
    #[uniffi::export]
    pub fn persistent_engine_remove_activities(activity_ids: Vec<String>) {
        info!(
            "tracematch: [PersistentEngine] Removing {} activities",
            activity_ids.len()
        );
        with_persistent_engine(|engine| {
            for id in &activity_ids {
                engine.remove_activity(id).ok();
            }
        });
    }

    /// Get all activity IDs.
    #[uniffi::export]
    pub fn persistent_engine_get_activity_ids() -> Vec<String> {
        with_persistent_engine(|e| e.get_activity_ids()).unwrap_or_default()
    }

    /// Get activity count.
    #[uniffi::export]
    pub fn persistent_engine_get_activity_count() -> u32 {
        with_persistent_engine(|e| e.activity_count() as u32).unwrap_or(0)
    }

    /// Get all activity bounds info as JSON for map display.
    #[uniffi::export]
    pub fn persistent_engine_get_all_activity_bounds_json() -> String {
        with_persistent_engine(|e| e.get_all_activity_bounds_json())
            .unwrap_or_else(|| "[]".to_string())
    }

    /// Get route groups as JSON.
    #[uniffi::export]
    pub fn persistent_engine_get_groups_json() -> String {
        with_persistent_engine(|e| e.get_groups_json()).unwrap_or_else(|| "[]".to_string())
    }

    /// Set a custom name for a route.
    /// Pass empty string to clear the custom name.
    #[uniffi::export]
    pub fn persistent_engine_set_route_name(route_id: String, name: String) {
        let name_opt = if name.is_empty() {
            None
        } else {
            Some(name.as_str())
        };
        with_persistent_engine(|e| {
            e.set_route_name(&route_id, name_opt).ok();
        });
    }

    /// Get the custom name for a route.
    /// Returns empty string if no custom name is set.
    #[uniffi::export]
    pub fn persistent_engine_get_route_name(route_id: String) -> String {
        with_persistent_engine(|e| e.get_route_name(&route_id))
            .flatten()
            .unwrap_or_default()
    }

    /// Get all custom route names as JSON.
    #[uniffi::export]
    pub fn persistent_engine_get_all_route_names_json() -> String {
        with_persistent_engine(|e| {
            serde_json::to_string(&e.get_all_route_names()).unwrap_or_else(|_| "{}".to_string())
        })
        .unwrap_or_else(|| "{}".to_string())
    }

    /// Set a custom name for a section.
    /// Pass empty string to clear the custom name.
    #[uniffi::export]
    pub fn persistent_engine_set_section_name(section_id: String, name: String) {
        let name_opt = if name.is_empty() {
            None
        } else {
            Some(name.as_str())
        };
        with_persistent_engine(|e| {
            e.set_section_name(&section_id, name_opt).ok();
        });
    }

    /// Get the custom name for a section.
    /// Returns empty string if no custom name is set.
    #[uniffi::export]
    pub fn persistent_engine_get_section_name(section_id: String) -> String {
        with_persistent_engine(|e| e.get_section_name(&section_id))
            .flatten()
            .unwrap_or_default()
    }

    /// Get all custom section names as JSON.
    #[uniffi::export]
    pub fn persistent_engine_get_all_section_names_json() -> String {
        with_persistent_engine(|e| {
            serde_json::to_string(&e.get_all_section_names()).unwrap_or_else(|_| "{}".to_string())
        })
        .unwrap_or_else(|| "{}".to_string())
    }

    /// Set activity metrics for performance calculations.
    #[uniffi::export]
    pub fn persistent_engine_set_activity_metrics(metrics: Vec<crate::FfiActivityMetrics>) {
        with_persistent_engine(|e| {
            let metrics: Vec<ActivityMetrics> = metrics.into_iter().map(|m| m.into()).collect();
            e.set_activity_metrics(metrics).ok();
        });
    }

    /// Set time streams for activities from flat buffer.
    /// Time streams are cumulative seconds at each GPS point, used for section performance calculations.
    /// Parameters:
    /// - activity_ids: Vec of activity IDs
    /// - all_times: Flat array of all time values concatenated
    /// - offsets: Start offset for each activity's times in all_times (length = activity_ids.len() + 1)
    #[uniffi::export]
    pub fn persistent_engine_set_time_streams_flat(
        activity_ids: Vec<String>,
        all_times: Vec<u32>,
        offsets: Vec<u32>,
    ) {
        with_persistent_engine(|e| {
            e.set_time_streams_flat(&activity_ids, &all_times, &offsets);
        });
    }

    /// Check which activities are missing cached time streams.
    /// Returns activity IDs that need to be fetched from the API.
    #[uniffi::export]
    pub fn persistent_engine_get_activities_missing_time_streams(
        activity_ids: Vec<String>,
    ) -> Vec<String> {
        with_persistent_engine(|e| e.get_activities_missing_time_streams(&activity_ids))
            .unwrap_or(activity_ids)
    }

    /// Get section performances as JSON.
    /// Returns accurate time-based section traversal data.
    #[uniffi::export]
    pub fn persistent_engine_get_section_performances_json(section_id: String) -> String {
        with_persistent_engine(|e| {
            let result = e.get_section_performances(&section_id);
            serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"{"records":[],"best_record":null}"#.to_string())
        })
        .unwrap_or_else(|| r#"{"records":[],"best_record":null}"#.to_string())
    }

    /// Get route performances as JSON.
    #[uniffi::export]
    pub fn persistent_engine_get_route_performances_json(
        route_group_id: String,
        current_activity_id: Option<String>,
    ) -> String {
        with_persistent_engine(|e| {
            // Ensure groups are recomputed if dirty (this populates activity_matches)
            let _ = e.get_groups();
            e.get_route_performances_json(&route_group_id, current_activity_id.as_deref())
        })
        .unwrap_or_else(|| "{}".to_string())
    }

    /// Get sections as JSON.
    #[uniffi::export]
    pub fn persistent_engine_get_sections_json() -> String {
        with_persistent_engine(|e| e.get_sections_json()).unwrap_or_else(|| "[]".to_string())
    }

    /// Get all sections with optional type filter.
    /// Single unified query replacing get_sections_json() and get_custom_sections_json().
    pub fn get_sections_with_type(
        &self,
        section_type: Option<&str>,
    ) -> Vec<crate::FfiFrequentSection> {
        let mut sql = String::from(
            "SELECT id, name, sport_type, polyline, distance_meters,
                representative_activity_id, activity_ids, visit_count, confidence,
                observation_count, average_spread, point_density, scale, version,
                is_user_defined, stability, created_at, updated_at, route_ids
         FROM sections"
        );

        let mut params = Vec::new();

        if let Some(st) = section_type {
            sql.push_str(" WHERE section_type = ?");
            params.push(st.to_string());
        }

        let mut stmt = self.db.prepare(&sql).ok()?;
        let mut result = Vec::new();

        while let Ok(row) = stmt.next() {
            let data_blob: String = row.get(11).ok().unwrap_or_default();

            let section = crate::FfiFrequentSection {
                id: row.get(0).ok().unwrap_or_default(),
                name: row.get(1).ok(),
                sport_type: row.get(2).ok().unwrap_or_default(),
                polyline: serde_json::from_str(&data_blob).unwrap_or_default(),
                distance_meters: row.get(3).ok().unwrap_or(0.0),
                representative_activity_id: row.get(4).ok().unwrap_or_default(),
                activity_ids: serde_json::from_str(
                        &row.get::<String>(5).ok().unwrap_or_default()
                    ).unwrap_or_default(),
                visit_count: row.get(6).ok().unwrap_or(0),
                confidence: row.get(7).ok(),
                observation_count: row.get(8).ok(),
                average_spread: row.get(9).ok(),
                point_density: serde_json::from_str(
                        &row.get::<String>(10).ok().unwrap_or_default()
                    ).ok(),
                scale: row.get::<String>(11).ok(),
                version: row.get::<u32>(12).ok().unwrap_or(0),
                is_user_defined: row.get::<i64>(13).ok().unwrap_or(0) != 0,
                stability: row.get::<f64>(14).ok(),
                created_at: row.get(15).ok().unwrap_or_default(),
                updated_at: row.get::<String>(16).ok(),
                route_ids: serde_json::from_str(
                        &row.get::<String>(17).ok().unwrap_or_default()
                    ).ok(),
            };

            result.push(section);
        }

        result
    }

    /// Get section count by type.
    pub fn get_section_count_by_type(&self, section_type: Option<&str>) -> u32 {
        let mut sql = String::from("SELECT COUNT(*) FROM sections");

        let mut params = Vec::new();

        if let Some(st) = section_type {
            sql.push_str(" WHERE section_type = ?");
            params.push(st.to_string());
        }

        self.db
            .prepare(&sql)
            .ok()?
            .query_row(params.as_slice(), |row| row.get(0))
            .unwrap_or(0)
    }

    /// Create a section (works for both auto and custom).
    /// For custom: user provides source_activity_id
    /// For auto: engine creates automatically (source_activity_id = None)
    pub fn create_section_unified(
        &mut self,
        params: CreateSectionParams,
    ) -> Result<String, String> {
        let id = if let Some(src_id) = &params.source_activity_id {
            format!("custom_{}", chrono_timestamp())
        } else {
            format!("section_{}", generate_hash())
        };

        let section_type = if params.source_activity_id.is_some() {
            "custom"
        } else {
            "auto"
        };

        let polyline_json = serde_json::to_string(&params.polyline)
            .map_err(|e| format!("Failed to serialize polyline: {}", e))?;

        self.db.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json, distance_meters,
                                  source_activity_id, visit_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            params![
                &id,
                section_type,
                params.name.unwrap_or_default(),
                &params.sport_type,
                &polyline_json,
                params.distance_meters,
                &params.source_activity_id,
                current_timestamp_iso(),
            ],
        )?;

        Ok(id)
    }

    /// Create section parameters.
    #[derive(Debug, Clone)]
    pub struct CreateSectionParams {
        pub sport_type: String,
        pub polyline: Vec<GpsPoint>,
        pub distance_meters: f64,
        pub name: Option<String>,
        pub source_activity_id: Option<String>,
    }
}

        self.db
            .prepare(&sql)
            .ok()?
            .query_row(params.as_slice(), |row| row.get(0))
            .unwrap_or(0)
    }

    /// Get sections for a specific activity as JSON.
    /// Uses junction table for O(1) lookup instead of deserializing all sections.
    #[uniffi::export]
    pub fn persistent_engine_get_sections_for_activity(activity_id: String) -> String {
        with_persistent_engine(|e| {
            let sections = e.get_sections_for_activity(&activity_id);
            serde_json::to_string(&sections).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    /// Get group count directly from SQLite (no data loading).
    #[uniffi::export]
    pub fn persistent_engine_get_group_count() -> u32 {
        with_persistent_engine(|e| e.get_group_count()).unwrap_or(0)
    }

    /// Get lightweight section summaries without polyline data.
    #[uniffi::export]
    pub fn persistent_engine_get_section_summaries_json() -> String {
        with_persistent_engine(|e| {
            let summaries = e.get_section_summaries();
            serde_json::to_string(&summaries).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    /// Get section summaries filtered by sport type.
    #[uniffi::export]
    pub fn persistent_engine_get_section_summaries_for_sport_json(sport_type: String) -> String {
        with_persistent_engine(|e| {
            let summaries = e.get_section_summaries_for_sport(&sport_type);
            serde_json::to_string(&summaries).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    /// Get lightweight group summaries without full activity ID lists.
    #[uniffi::export]
    pub fn persistent_engine_get_group_summaries_json() -> String {
        with_persistent_engine(|e| {
            let summaries = e.get_group_summaries();
            serde_json::to_string(&summaries).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    /// Get a single section by ID (full data with polyline).
    #[uniffi::export]
    pub fn persistent_engine_get_section_by_id_json(section_id: String) -> Option<String> {
        with_persistent_engine(|e| {
            e.get_section_by_id(&section_id)
                .and_then(|s| serde_json::to_string(&s).ok())
        })
        .flatten()
    }

    /// Get a single group by ID (full data with activity IDs).
    #[uniffi::export]
    pub fn persistent_engine_get_group_by_id_json(group_id: String) -> Option<String> {
        with_persistent_engine(|e| {
            e.get_group_by_id(&group_id)
                .and_then(|g| serde_json::to_string(&g).ok())
        })
        .flatten()
    }

    /// Get section polyline only (flat coordinates for map rendering).
    #[uniffi::export]
    pub fn persistent_engine_get_section_polyline(section_id: String) -> Vec<f64> {
        with_persistent_engine(|e| e.get_section_polyline(&section_id)).unwrap_or_default()
    }

    /// Query activities in viewport.
    #[uniffi::export]
    pub fn persistent_engine_query_viewport(
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
    ) -> Vec<String> {
        with_persistent_engine(|e| {
            e.query_viewport(&Bounds {
                min_lat,
                max_lat,
                min_lng,
                max_lng,
            })
        })
        .unwrap_or_default()
    }

    /// Get consensus route for a group as flat coordinates.
    #[uniffi::export]
    pub fn persistent_engine_get_consensus_route(group_id: String) -> Vec<f64> {
        with_persistent_engine(|e| {
            e.get_consensus_route(&group_id)
                .map(|points| {
                    points
                        .iter()
                        .flat_map(|p| vec![p.latitude, p.longitude])
                        .collect()
                })
                .unwrap_or_default()
        })
        .unwrap_or_default()
    }

    /// Get GPS track for an activity as flat coordinates.
    #[uniffi::export]
    pub fn persistent_engine_get_gps_track(activity_id: String) -> Vec<f64> {
        with_persistent_engine(|e| {
            e.get_gps_track(&activity_id)
                .map(|points| {
                    points
                        .iter()
                        .flat_map(|p| vec![p.latitude, p.longitude])
                        .collect()
                })
                .unwrap_or_default()
        })
        .unwrap_or_default()
    }

    /// Get simplified GPS track for an activity as flat coordinates.
    /// Uses Douglas-Peucker algorithm to reduce points for fast map rendering.
    /// Tolerance of 0.00005 (~5m) gives good visual fidelity with ~50-200 points.
    #[uniffi::export]
    pub fn persistent_engine_get_simplified_gps_track(activity_id: String) -> Vec<f64> {
        with_persistent_engine(|e| {
            e.get_gps_track(&activity_id)
                .map(|points| {
                    // Use Douglas-Peucker simplification
                    let simplified = crate::algorithms::douglas_peucker(&points, 0.00005);
                    simplified
                        .iter()
                        .flat_map(|p| vec![p.latitude, p.longitude])
                        .collect()
                })
                .unwrap_or_default()
        })
        .unwrap_or_default()
    }

    /// Get engine statistics.
    #[uniffi::export]
    pub fn persistent_engine_get_stats() -> Option<PersistentEngineStats> {
        with_persistent_engine(|e| e.stats())
    }

    // ========================================================================
    // Background Section Detection
    // ========================================================================

    /// Handle for tracking background section detection progress.
    /// Store this and poll with persistent_engine_poll_sections().
    static SECTION_DETECTION_HANDLE: Lazy<Mutex<Option<SectionDetectionHandle>>> =
        Lazy::new(|| Mutex::new(None));

    /// Start section detection in the background.
    /// Returns true if detection was started, false if already running or engine not initialized.
    #[uniffi::export]
    pub fn persistent_engine_start_section_detection(sport_filter: Option<String>) -> bool {
        // Check if already running
        {
            let handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();
            if handle_guard.is_some() {
                info!("tracematch: [PersistentEngine] Section detection already running");
                return false;
            }
        }

        // Start detection
        let handle = with_persistent_engine(|e| e.detect_sections_background(sport_filter));

        if let Some(h) = handle {
            let mut handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();
            *handle_guard = Some(h);
            info!("tracematch: [PersistentEngine] Section detection started");
            true
        } else {
            info!("tracematch: [PersistentEngine] Failed to start section detection");
            false
        }
    }

    /// Poll for section detection completion.
    /// Returns:
    /// - "running" if detection is still in progress
    /// - "complete" if detection finished and sections were applied
    /// - "idle" if no detection is running
    /// - "error" if detection failed
    #[uniffi::export]
    pub fn persistent_engine_poll_sections() -> String {
        let mut handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();

        if handle_guard.is_none() {
            return "idle".to_string();
        }

        // Try to receive results
        let result = handle_guard.as_ref().unwrap().try_recv();

        match result {
            Some(sections) => {
                // Detection complete - apply results
                let applied = with_persistent_engine(|e| e.apply_sections(sections).ok());

                // Clear the handle
                *handle_guard = None;

                if applied.is_some() {
                    // Also match custom sections against all activities
                    with_persistent_engine(|e| {
                        let custom_sections = e.get_custom_sections();
                        if !custom_sections.is_empty() {
                            let activity_ids = e.get_activity_ids();
                            let config = crate::CustomSectionMatchConfig::default();
                            info!(
                                "tracematch: [PersistentEngine] Matching {} custom sections against {} activities",
                                custom_sections.len(),
                                activity_ids.len()
                            );
                            for section in &custom_sections {
                                e.match_custom_section_against_activities(
                                    &section.id,
                                    &activity_ids,
                                    &config,
                                );
                            }
                        }
                    });

                    info!("tracematch: [PersistentEngine] Section detection complete");
                    "complete".to_string()
                } else {
                    "error".to_string()
                }
            }
            None => {
                // Still running
                "running".to_string()
            }
        }
    }

    /// Get current section detection progress.
    /// Returns JSON with format: {"phase": "finding_overlaps", "completed": 45, "total": 120}
    /// Returns empty JSON "{}" if no detection is running.
    #[uniffi::export]
    pub fn persistent_engine_get_section_detection_progress() -> String {
        let handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();

        if let Some(handle) = handle_guard.as_ref() {
            let (phase, completed, total) = handle.get_progress();
            format!(
                r#"{{"phase":"{}","completed":{},"total":{}}}"#,
                phase, completed, total
            )
        } else {
            "{}".to_string()
        }
    }

    /// Cancel any running section detection.
    #[uniffi::export]
    pub fn persistent_engine_cancel_section_detection() {
        let mut handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();
        if handle_guard.is_some() {
            *handle_guard = None;
            info!("tracematch: [PersistentEngine] Section detection cancelled");
        }
    }

    /// Detect potential sections using GPS tracks from SQLite.
    /// This eliminates the N+1 FFI call pattern - single call, all loading internal.
    /// Returns JSON array of potential sections.
    #[uniffi::export]
    pub fn persistent_engine_detect_potentials(sport_filter: Option<String>) -> String {
        with_persistent_engine(|e| {
            // Get activity IDs (optionally filtered by sport)
            let activity_ids: Vec<String> = if let Some(ref sport) = sport_filter {
                e.activity_metadata
                    .values()
                    .filter(|m| &m.sport_type == sport)
                    .map(|m| m.id.clone())
                    .collect()
            } else {
                e.activity_metadata.keys().cloned().collect()
            };

            if activity_ids.is_empty() {
                return "[]".to_string();
            }

            // Load tracks from SQLite
            let mut tracks: Vec<(String, Vec<GpsPoint>)> = Vec::new();
            for id in &activity_ids {
                if let Some(track) = e.get_gps_track(id) {
                    if track.len() >= 4 {
                        tracks.push((id.clone(), track));
                    }
                }
            }

            if tracks.is_empty() {
                return "[]".to_string();
            }

            // Build sport type map
            let sport_map: HashMap<String, String> = e
                .activity_metadata
                .values()
                .map(|m| (m.id.clone(), m.sport_type.clone()))
                .collect();

            // Create config with potentials enabled and lower threshold
            // Clone section_config BEFORE get_groups() to avoid borrow conflict
            let config = SectionConfig {
                include_potentials: true,
                min_activities: 1, // Low threshold to find potential sections
                ..e.section_config.clone()
            };

            // Get existing groups (after config is cloned)
            let groups = e.get_groups();

            log::info!(
                "tracematch: [PersistentEngine] Detecting potentials from {} tracks",
                tracks.len()
            );

            // Run detection
            let result = tracematch::sections::detect_sections_multiscale(
                &tracks,
                &sport_map,
                &groups,
                &config,
            );

            log::info!(
                "tracematch: [PersistentEngine] Found {} potential sections",
                result.potentials.len()
            );

            serde_json::to_string(&result.potentials).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    // ========================================================================
    // Custom Section FFI
    // ========================================================================

    /// Add a custom section from JSON.
    #[uniffi::export]
    pub fn persistent_engine_add_custom_section(section_json: String) -> bool {
        let section: crate::CustomSection = match serde_json::from_str(&section_json) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to parse custom section: {:?}",
                    e
                );
                return false;
            }
        };

        let section_id = section.id.clone();

        let added = with_persistent_engine(|e| match e.add_custom_section(&section) {
            Ok(success) => {
                info!(
                    "tracematch: [PersistentEngine] Added custom section: {}",
                    section.id
                );
                success
            }
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to add custom section: {:?}",
                    e
                );
                false
            }
        })
        .unwrap_or(false);

        // If section was added successfully, immediately match it against all activities
        if added {
            with_persistent_engine(|e| {
                let activity_ids = e.get_activity_ids();
                if !activity_ids.is_empty() {
                    let config = crate::CustomSectionMatchConfig::default();
                    let matches = e.match_custom_section_against_activities(
                        &section_id,
                        &activity_ids,
                        &config,
                    );
                    info!(
                        "tracematch: [PersistentEngine] Matched custom section {} against {} activities, found {} matches",
                        section_id,
                        activity_ids.len(),
                        matches.len()
                    );
                }
            });
        }

        added
    }

    /// Create a custom section from activity indices.
    /// Loads GPS track from SQLite internally - no coordinate transfer needed.
    /// Returns JSON: `{"ok": true, "section": {...}}` on success,
    /// or `{"ok": false, "error": "message"}` on failure.
    #[uniffi::export]
    pub fn persistent_engine_create_section_from_indices(
        activity_id: String,
        start_index: u32,
        end_index: u32,
        sport_type: String,
        name: Option<String>,
    ) -> String {
        let result = with_persistent_engine(|e| {
            e.create_custom_section_from_indices(
                &activity_id,
                start_index,
                end_index,
                &sport_type,
                name.as_deref(),
            )
        });

        match result {
            Some(Ok(section)) => {
                let section_id = section.id.clone();
                info!(
                    "tracematch: [PersistentEngine] Created section from indices: {} ({}→{} of {})",
                    section_id, start_index, end_index, activity_id
                );

                // Match against all activities
                with_persistent_engine(|e| {
                    let activity_ids = e.get_activity_ids();
                    if !activity_ids.is_empty() {
                        let config = crate::CustomSectionMatchConfig::default();
                        let matches = e.match_custom_section_against_activities(
                            &section_id,
                            &activity_ids,
                            &config,
                        );
                        info!(
                            "tracematch: [PersistentEngine] Matched section {} against {} activities, found {} matches",
                            section_id,
                            activity_ids.len(),
                            matches.len()
                        );
                    }
                });

                // Return success result with section data
                serde_json::json!({
                    "ok": true,
                    "section": section
                }).to_string()
            }
            Some(Err(e)) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to create section from indices: {}",
                    e
                );
                // Return error result with message
                serde_json::json!({
                    "ok": false,
                    "error": e
                }).to_string()
            }
            None => {
                log::error!("tracematch: [PersistentEngine] Engine not initialized");
                serde_json::json!({
                    "ok": false,
                    "error": "Engine not initialized"
                }).to_string()
            }
        }
    }

    /// Remove a custom section.
    #[uniffi::export]
    pub fn persistent_engine_remove_custom_section(section_id: String) -> bool {
        with_persistent_engine(|e| match e.remove_custom_section(&section_id) {
            Ok(success) => {
                info!(
                    "tracematch: [PersistentEngine] Removed custom section: {}",
                    section_id
                );
                success
            }
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to remove custom section: {:?}",
                    e
                );
                false
            }
        })
        .unwrap_or(false)
    }

    /// Get all custom sections as JSON.
    #[uniffi::export]
    pub fn persistent_engine_get_custom_sections_json() -> String {
        with_persistent_engine(|e| e.get_custom_sections_json()).unwrap_or_else(|| "[]".to_string())
    }

    /// Match a custom section against activities.
    /// Returns JSON array of matches.
    #[uniffi::export]
    pub fn persistent_engine_match_custom_section(
        section_id: String,
        activity_ids: Vec<String>,
    ) -> String {
        let config = crate::CustomSectionMatchConfig::default();

        with_persistent_engine(|e| {
            let matches =
                e.match_custom_section_against_activities(&section_id, &activity_ids, &config);
            serde_json::to_string(&matches).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    /// Get matches for a custom section.
    /// Returns JSON array of matches.
    #[uniffi::export]
    pub fn persistent_engine_get_custom_section_matches(section_id: String) -> String {
        with_persistent_engine(|e| {
            let matches = e.get_custom_section_matches(&section_id);
            serde_json::to_string(&matches).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    // ========================================================================
    // Section Reference (Medoid) Management
    // ========================================================================

    /// Set the reference activity for a section.
    /// This marks the section as user-defined and prevents automatic medoid recalculation.
    ///
    /// Returns true if successful, false if the section or activity was not found.
    #[uniffi::export]
    pub fn persistent_engine_set_section_reference(
        section_id: String,
        activity_id: String,
    ) -> bool {
        with_persistent_engine(|e| {
            // Debug: Log state before attempting
            let section_count = e.sections.len();
            let section_exists = e.sections.iter().any(|s| s.id == section_id);
            let activity_in_section = e
                .sections
                .iter()
                .find(|s| s.id == section_id)
                .map(|s| s.activity_ids.contains(&activity_id))
                .unwrap_or(false);
            info!(
                "tracematch: [SetReference] Attempting: section={}, activity={}, sections_in_memory={}, section_found={}, activity_in_section={}",
                section_id, activity_id, section_count, section_exists, activity_in_section
            );

            match e.set_section_reference(&section_id, &activity_id) {
                Ok(()) => {
                    info!(
                        "tracematch: [PersistentEngine] Set section {} reference to {}",
                        section_id, activity_id
                    );
                    true
                }
                Err(err) => {
                    info!(
                        "tracematch: [PersistentEngine] Failed to set section reference: {}",
                        err
                    );
                    false
                }
            }
        })
        .unwrap_or_else(|| {
            info!("tracematch: [SetReference] FAILED: Engine not initialized or lock failed");
            false
        })
    }

    /// Reset a section's reference to automatic medoid calculation.
    /// This clears the user-defined flag and recalculates the medoid.
    ///
    /// Returns true if successful, false if the section was not found.
    #[uniffi::export]
    pub fn persistent_engine_reset_section_reference(section_id: String) -> bool {
        with_persistent_engine(|e| {
            match e.reset_section_reference(&section_id) {
                Ok(()) => {
                    info!(
                        "tracematch: [PersistentEngine] Reset section {} reference to automatic",
                        section_id
                    );
                    true
                }
                Err(err) => {
                    info!(
                        "tracematch: [PersistentEngine] Failed to reset section reference: {}",
                        err
                    );
                    false
                }
            }
        })
        .unwrap_or(false)
    }

    /// Get the reference (medoid) activity ID for a section.
    /// Returns the activity ID or None if the section is not found.
    #[uniffi::export]
    pub fn persistent_engine_get_section_reference(section_id: String) -> Option<String> {
        with_persistent_engine(|e| {
            e.sections
                .iter()
                .find(|s| s.id == section_id)
                .map(|s| s.representative_activity_id.clone())
        })
        .flatten()
    }

    /// Check if a section's reference was user-defined (vs automatic).
    #[uniffi::export]
    pub fn persistent_engine_is_section_reference_user_defined(section_id: String) -> bool {
        with_persistent_engine(|e| {
            e.sections
                .iter()
                .find(|s| s.id == section_id)
                .map(|s| s.is_user_defined)
                .unwrap_or(false)
        })
        .unwrap_or(false)
    }

    /// Match an activity to existing sections and add it to all matching ones.
    /// This is the main entry point for incremental section updates.
    ///
    /// Returns the number of sections the activity was added to.
    #[uniffi::export]
    pub fn persistent_engine_match_and_add_activity_to_sections(activity_id: String) -> u32 {
        with_persistent_engine(|e| {
            // Get the activity's GPS track
            let track = match e.get_gps_track(&activity_id) {
                Some(t) => t,
                None => {
                    info!(
                        "tracematch: [PersistentEngine] No GPS track for activity {}",
                        activity_id
                    );
                    return 0;
                }
            };

            let count = e.match_and_add_activity_to_sections(&activity_id, &track);
            info!(
                "tracematch: [PersistentEngine] Activity {} added to {} sections",
                activity_id, count
            );
            count
        })
        .unwrap_or(0)
    }

    /// Extract the GPS trace for an activity that overlaps with a section polyline.
    /// Returns a flat array of [lat, lng, lat, lng, ...] or empty if no overlap.
    #[uniffi::export]
    pub fn persistent_engine_extract_section_trace(
        activity_id: String,
        section_polyline_json: String,
    ) -> Vec<f64> {
        with_persistent_engine(|engine| {
            // Parse the section polyline
            let polyline: Vec<GpsPoint> = match serde_json::from_str(&section_polyline_json) {
                Ok(p) => p,
                Err(_) => return vec![],
            };

            if polyline.len() < 2 {
                return vec![];
            }

            // Load the activity's GPS track
            let track = match engine.get_gps_track(&activity_id) {
                Some(t) => t,
                None => return vec![],
            };

            if track.len() < 3 {
                return vec![];
            }

            // Build a track map with just this activity
            let mut track_map = std::collections::HashMap::new();
            track_map.insert(activity_id.clone(), track);

            // Use the existing trace extraction algorithm
            let traces = tracematch::sections::extract_all_activity_traces(
                std::slice::from_ref(&activity_id),
                &polyline,
                &track_map,
            );

            // Get the trace for this activity
            match traces.get(&activity_id) {
                Some(trace) => {
                    // Flatten to [lat, lng, lat, lng, ...]
                    trace
                        .iter()
                        .flat_map(|p| vec![p.latitude, p.longitude])
                        .collect()
                }
                None => vec![],
            }
        })
        .unwrap_or_default()
    }

    // ========================================================================
    // Engine-Centric Data Functions (Performance Optimization)
    // ========================================================================

    /// Lightweight activity data for map display within a viewport.
    /// Returns only the fields needed for rendering: id, sport_type, bounds.
    #[derive(Debug, Clone, serde::Serialize, uniffi::Record)]
    pub struct MapActivityData {
        pub activity_id: String,
        pub sport_type: String,
        pub bounds: crate::FfiBounds,
    }

    /// Get all activities with complete data for map display.
    /// Joins metadata (bounds) with metrics (name, date, distance) in a single call.
    /// Much faster than fetching separately and merging in JS.
    #[uniffi::export]
    pub fn persistent_engine_get_all_map_activities_complete() -> Vec<MapActivityComplete> {
        with_persistent_engine(|e| {
            e.activity_metadata
                .iter()
                .filter_map(|(id, meta)| {
                    // Join with metrics to get name, date, distance
                    let metrics = e.activity_metrics.get(id)?;
                    Some(MapActivityComplete {
                        activity_id: id.clone(),
                        name: metrics.name.clone(),
                        sport_type: meta.sport_type.clone(),
                        date: metrics.date,
                        distance: metrics.distance,
                        duration: metrics.moving_time,
                        bounds: meta.bounds.into(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
    }

    /// Get activities filtered by date range and optionally by sport types.
    /// Performs filtering in Rust for maximum efficiency.
    ///
    /// Arguments:
    /// - start_date: Unix timestamp (seconds) for start of range
    /// - end_date: Unix timestamp (seconds) for end of range
    /// - sport_types_json: JSON array of sport types to include, or empty string for all
    #[uniffi::export]
    pub fn persistent_engine_get_map_activities_filtered(
        start_date: i64,
        end_date: i64,
        sport_types_json: String,
    ) -> Vec<MapActivityComplete> {
        with_persistent_engine(|e| {
            // Parse sport types filter (empty = all types)
            let sport_filter: Option<std::collections::HashSet<String>> = if sport_types_json.is_empty() {
                None
            } else {
                serde_json::from_str::<Vec<String>>(&sport_types_json)
                    .ok()
                    .map(|v| v.into_iter().collect())
            };

            e.activity_metadata
                .iter()
                .filter_map(|(id, meta)| {
                    // Join with metrics
                    let metrics = e.activity_metrics.get(id)?;

                    // Filter by date range
                    if metrics.date < start_date || metrics.date > end_date {
                        return None;
                    }

                    // Filter by sport type if specified
                    if let Some(ref filter) = sport_filter {
                        if !filter.contains(&meta.sport_type) {
                            return None;
                        }
                    }

                    Some(MapActivityComplete {
                        activity_id: id.clone(),
                        name: metrics.name.clone(),
                        sport_type: meta.sport_type.clone(),
                        date: metrics.date,
                        distance: metrics.distance,
                        duration: metrics.moving_time,
                        bounds: meta.bounds.into(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
    }

    /// Get activities within a viewport, returning minimal data for map rendering.
    /// More efficient than loading full activity metrics.
    #[uniffi::export]
    pub fn persistent_engine_get_map_activities_in_viewport(
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
    ) -> Vec<MapActivityData> {
        with_persistent_engine(|e| {
            let viewport = Bounds { min_lat, max_lat, min_lng, max_lng };
            let activity_ids = e.query_viewport(&viewport);

            activity_ids
                .iter()
                .filter_map(|id| {
                    let meta = e.activity_metadata.get(id)?;
                    Some(MapActivityData {
                        activity_id: id.clone(),
                        sport_type: meta.sport_type.clone(),
                        bounds: meta.bounds.into(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
    }

    /// Get recent activities with metrics, sorted by date descending.
    /// Efficient for Feed screen - pre-computed, no client-side iteration needed.
    #[uniffi::export]
    pub fn persistent_engine_get_recent_activities_json(limit: u32) -> String {
        with_persistent_engine(|e| {
            // Get all activity metrics and sort by date descending
            let mut metrics: Vec<&ActivityMetrics> = e.activity_metrics.values().collect();
            metrics.sort_by(|a, b| b.date.cmp(&a.date));

            // Take only the requested limit
            let recent: Vec<_> = metrics
                .into_iter()
                .take(limit as usize)
                .map(|m| crate::FfiActivityMetrics::from(m.clone()))
                .collect();

            serde_json::to_string(&recent).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    /// Get total count of activities with metrics stored in the engine.
    #[uniffi::export]
    pub fn persistent_engine_get_metrics_count() -> u32 {
        with_persistent_engine(|e| e.activity_metrics.len() as u32).unwrap_or(0)
    }

    /// Get all activity bounds as a vector of MapActivityData.
    /// Useful for map rendering - returns all activities with minimal data.
    #[uniffi::export]
    pub fn persistent_engine_get_all_map_activities() -> Vec<MapActivityData> {
        with_persistent_engine(|e| {
            e.activity_metadata
                .iter()
                .map(|(id, meta)| MapActivityData {
                    activity_id: id.clone(),
                    sport_type: meta.sport_type.clone(),
                    bounds: meta.bounds.into(),
                })
                .collect()
        })
        .unwrap_or_default()
    }

    // ========================================================================
    // Polyline Encoding FFI (Google Polyline Algorithm)
    // ~60% size reduction vs raw [lat,lng] arrays
    // ========================================================================

    /// Encode flat coordinates [lat, lng, lat, lng, ...] to Google polyline string.
    /// Precision: 5 decimal places (standard for GPS).
    #[uniffi::export]
    pub fn encode_coordinates_to_polyline(coords: Vec<f64>) -> String {
        use geo::LineString;

        if coords.len() < 4 || coords.len() % 2 != 0 {
            return String::new();
        }

        // Convert to geo::LineString (expects (x, y) = (lng, lat) order)
        let line: LineString<f64> = coords
            .chunks(2)
            .map(|chunk| (chunk[1], chunk[0])) // (lng, lat)
            .collect();

        polyline::encode_coordinates(line, 5).unwrap_or_default()
    }

    /// Decode Google polyline string to flat coordinates [lat, lng, lat, lng, ...].
    #[uniffi::export]
    pub fn decode_polyline_to_coordinates(encoded: String) -> Vec<f64> {
        if encoded.is_empty() {
            return Vec::new();
        }

        polyline::decode_polyline(&encoded, 5)
            .map(|line| {
                line.coords()
                    .flat_map(|c| vec![c.y, c.x]) // (lat, lng) from (x, y)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get GPS track as encoded polyline string.
    /// Much smaller than flat coordinate arrays.
    #[uniffi::export]
    pub fn persistent_engine_get_gps_track_encoded(activity_id: String) -> String {
        use geo::LineString;

        with_persistent_engine(|e| {
            e.get_gps_track(&activity_id).map(|track| {
                let line: LineString<f64> = track
                    .iter()
                    .map(|p| (p.longitude, p.latitude))
                    .collect();
                polyline::encode_coordinates(line, 5).unwrap_or_default()
            })
        })
        .flatten()
        .unwrap_or_default()
    }

    /// Get section polyline as encoded string.
    #[uniffi::export]
    pub fn persistent_engine_get_section_polyline_encoded(section_id: String) -> String {
        use geo::LineString;

        with_persistent_engine(|e| {
            // Try auto-detected sections first
            if let Some(section) = e.sections.iter().find(|s| s.id == section_id) {
                let line: LineString<f64> = section
                    .polyline
                    .iter()
                    .map(|p| (p.longitude, p.latitude))
                    .collect();
                return Some(polyline::encode_coordinates(line, 5).unwrap_or_default());
            }

            // Try custom sections
            if let Some(section) = e.get_custom_section(&section_id) {
                let line: LineString<f64> = section
                    .polyline
                    .iter()
                    .map(|p| (p.longitude, p.latitude))
                    .collect();
                return Some(polyline::encode_coordinates(line, 5).unwrap_or_default());
            }

            None
        })
        .flatten()
        .unwrap_or_default()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(all(test, feature = "persistence"))]
mod tests {
    use super::*;

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
                .enumerate()
                .map(|(i, aid)| crate::SectionPortion {
                    activity_id: aid.clone(),
                    start_index: 0,
                    end_index: 49,
                    distance_meters: 5000.0,
                    direction: "same".to_string(),
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
            scale: Some("medium".to_string()),
            version: 1,
            is_user_defined: false,
            created_at: Some("2026-01-28T00:00:00Z".to_string()),
            updated_at: None,
            stability: 0.7,
        }
    }

    /// Test: set_section_reference works for auto-detected (FrequentSection) sections
    #[test]
    fn test_set_section_reference_autodetected_section() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Add two activities with the same route
        let coords = sample_coords();
        engine
            .add_activity("activity-1".to_string(), coords.clone(), "cycling".to_string())
            .unwrap();
        engine
            .add_activity("activity-2".to_string(), coords.clone(), "cycling".to_string())
            .unwrap();

        // Create and apply a FrequentSection with activity-1 as the representative
        let section = create_test_frequent_section(
            "sec_cycling_1",
            "activity-1",
            vec!["activity-1".to_string(), "activity-2".to_string()],
            coords.clone(),
        );
        engine.apply_sections(vec![section]).unwrap();

        // Verify initial state
        let sections = engine.get_sections();
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].representative_activity_id, "activity-1");
        assert!(!sections[0].is_user_defined);

        // Set activity-2 as the new reference
        let result = engine.set_section_reference("sec_cycling_1", "activity-2");
        assert!(result.is_ok(), "set_section_reference should succeed for auto-detected sections");

        // Verify the reference was changed
        let sections = engine.get_sections();
        assert_eq!(sections[0].representative_activity_id, "activity-2");
        assert!(sections[0].is_user_defined);
        assert_eq!(sections[0].version, 2);
    }

    /// Test: set_section_reference works for custom sections (unified implementation)
    #[test]
    fn test_set_section_reference_custom_section() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();

        // Add activities
        let coords = sample_coords();
        engine
            .add_activity("activity-1".to_string(), coords.clone(), "cycling".to_string())
            .unwrap();
        engine
            .add_activity("activity-2".to_string(), coords.clone(), "cycling".to_string())
            .unwrap();

        // Create a CustomSection
        let custom_section = crate::CustomSection {
            id: "custom_1234567890_abc".to_string(),
            name: "My Custom Section".to_string(),
            polyline: coords.clone(),
            source_activity_id: "activity-1".to_string(),
            start_index: 0,
            end_index: 49,
            sport_type: "cycling".to_string(),
            distance_meters: 5000.0,
            created_at: "2026-01-28T00:00:00Z".to_string(),
        };
        engine.add_custom_section(&custom_section).unwrap();

        // Set activity-2 as the new reference - THIS SHOULD WORK
        let result = engine.set_section_reference("custom_1234567890_abc", "activity-2");
        assert!(
            result.is_ok(),
            "set_section_reference should work for custom sections after unification"
        );

        // Verify the reference was changed
        let custom_sections = engine.get_custom_sections();
        assert_eq!(custom_sections.len(), 1);
        assert_eq!(
            custom_sections[0].source_activity_id, "activity-2",
            "Custom section's source_activity_id should be updated"
        );
    }
}
