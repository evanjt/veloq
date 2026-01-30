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

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use rusqlite::{Connection, Result as SqlResult, params};
use rusqlite_migration::{Migrations, M};
use rstar::{AABB, RTree, RTreeObject};
use crate::{
    ActivityMatchInfo, ActivityMetrics, Bounds, DirectionStats, FrequentSection, GpsPoint,
    MatchConfig, RouteGroup, RoutePerformance, RoutePerformanceResult, RouteSignature,
    SectionConfig, SectionLap, SectionPerformanceRecord, SectionPerformanceResult, SectionPortion,
    geo_utils,
};
use lru::LruCache;
use chrono::Utc;

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

/// Lightweight section metadata for list views (no polyline data).
/// Used to avoid loading full section data with polylines when only summary info is needed.

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

#[derive(Debug, Clone)]
pub struct SectionDetectionProgress {
    /// Current phase: "loading", "building_rtrees", "finding_overlaps", "clustering", "building_sections", "postprocessing"
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


impl Default for SectionDetectionProgress {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle for background section detection.

pub struct SectionDetectionHandle {
    receiver: mpsc::Receiver<Vec<FrequentSection>>,
    /// Shared progress state
    pub progress: SectionDetectionProgress,
}


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

#[derive(Debug, Clone)]
struct ActivitySectionMatchInternal {
    pub section_id: String,
    pub section_name: Option<String>,
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


fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Compute Average Minimum Distance (AMD) between two traces.
/// For each point in trace1, find minimum distance to any point in trace2.
/// AMD = average of these minimum distances.
/// Used for medoid calculation in section updates.

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


impl PersistentRouteEngine {
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

    /// Current schema version for app-level tracking.
    /// This is separate from rusqlite_migration and tracks the overall schema state.
    const SCHEMA_VERSION: i32 = 2; // v0.1.0 schema

    /// Get the database migrations.
    /// Each migration is applied in order, tracked in `__rusqlite_migrations` table.
    fn migrations() -> Migrations<'static> {
        Migrations::new(vec![
            // M1: Initial schema (uses IF NOT EXISTS for compatibility with pre-migration databases)
            M::up(include_str!("migrations/001_initial_schema.sql")),
            // M2: Unified sections table (migrates blob-based sections to column-based)
            M::up(include_str!("migrations/002_unified_sections.sql")),
            // M3: Drop legacy section_names table (names now in sections.name column)
            M::up(include_str!("migrations/003_drop_section_names.sql")),
        ])
    }

    /// Initialize the database schema using migrations.
    fn init_schema(conn: &mut Connection) -> SqlResult<()> {
        // Create schema_info table if not exists (for app-level version tracking)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_info (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Get current schema version (0 if not set = pre-0.1.0 database)
        let current_version: i32 = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        log::info!(
            "tracematch: [Schema] Current version: {}, Target version: {}",
            current_version,
            Self::SCHEMA_VERSION
        );

        // Handle pre-migration databases: if tables exist but no migration state,
        // we need to migrate the old blob-based sections before running migrations
        if current_version < 2 {
            Self::migrate_legacy_sections(conn)?;

            // Migrate legacy section_names table if it exists (must run before SQL migrations)
            Self::migrate_legacy_section_names(conn)?;
        }

        // Run all pending migrations
        Self::migrations()
            .to_latest(conn)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(
                std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
            )))?;

        // Post-migration: add columns that may be missing from older schemas
        Self::migrate_schema(conn)?;

        // Update schema version
        conn.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('schema_version', ?)",
            params![Self::SCHEMA_VERSION.to_string()],
        )?;

        // Record migration timestamp
        conn.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('last_migration', datetime('now'))",
            [],
        )?;

        log::info!(
            "tracematch: [Schema] Migration complete. Now at version {}",
            Self::SCHEMA_VERSION
        );

        Ok(())
    }

    /// Migrate legacy blob-based sections to the new format.
    /// This runs BEFORE the migration system to handle pre-migration databases.
    ///
    /// SAFE MIGRATION STRATEGY:
    /// 1. Create new tables with _new suffix (don't touch old data)
    /// 2. Copy all data to new tables
    /// 3. Verify data integrity (count matches)
    /// 4. Only then rename tables (atomic operation)
    /// 5. Drop old tables last
    fn migrate_legacy_sections(conn: &Connection) -> SqlResult<()> {
        // Check if sections table exists with old blob-based schema
        let has_old_schema = conn
            .prepare("SELECT data FROM sections LIMIT 0")
            .is_ok();

        if !has_old_schema {
            return Ok(()); // Either new DB or already migrated
        }

        log::info!("tracematch: [Migration] Detected legacy blob-based sections, starting safe migration...");

        // Count original records for validation
        let original_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sections",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        log::info!("tracematch: [Migration] Found {} sections to migrate", original_count);

        // Load old sections from blob format (keep in memory)
        let old_sections: Vec<(String, Vec<String>, serde_json::Value)> = {
            let mut stmt = conn.prepare("SELECT id, data FROM sections")?;
            stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let data_blob: Vec<u8> = row.get(1)?;
                let json: serde_json::Value = serde_json::from_slice(&data_blob)
                    .unwrap_or(serde_json::Value::Null);
                let activity_ids: Vec<String> = json.get("activity_ids")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                Ok((id, activity_ids, json))
            })?
            .filter_map(|r| r.ok())
            .filter(|(id, _, _)| !id.is_empty())
            .collect()
        };

        // Create new tables with _new suffix (preserves old data until verified)
        conn.execute_batch(
            "DROP TABLE IF EXISTS sections_new;
             DROP TABLE IF EXISTS section_activities_new;

             CREATE TABLE sections_new (
                 id TEXT PRIMARY KEY,
                 section_type TEXT NOT NULL CHECK(section_type IN ('auto', 'custom')),
                 name TEXT,
                 sport_type TEXT NOT NULL,
                 polyline_json TEXT NOT NULL,
                 distance_meters REAL NOT NULL,
                 representative_activity_id TEXT,
                 confidence REAL,
                 observation_count INTEGER,
                 average_spread REAL,
                 point_density_json TEXT,
                 scale TEXT,
                 version INTEGER DEFAULT 1,
                 is_user_defined INTEGER DEFAULT 0,
                 stability REAL,
                 source_activity_id TEXT,
                 start_index INTEGER,
                 end_index INTEGER,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT
             );

             CREATE TABLE section_activities_new (
                 section_id TEXT NOT NULL,
                 activity_id TEXT NOT NULL,
                 PRIMARY KEY (section_id, activity_id)
             );"
        )?;

        // Migrate data to new tables
        let mut migrated_count = 0;
        let mut total_associations = 0;

        for (id, activity_ids, json) in &old_sections {
            let polyline_json = json.get("polyline")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "[]".to_string());

            conn.execute(
                "INSERT INTO sections_new (
                    id, section_type, name, sport_type, polyline_json, distance_meters,
                    representative_activity_id, confidence, observation_count, average_spread,
                    point_density_json, scale, version, is_user_defined, stability, created_at
                ) VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                params![
                    id,
                    json.get("name").and_then(|v| v.as_str()),
                    json.get("sport_type").and_then(|v| v.as_str()).unwrap_or(""),
                    polyline_json,
                    json.get("distance_meters").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    json.get("representative_activity_id").and_then(|v| v.as_str()),
                    json.get("confidence").and_then(|v| v.as_f64()),
                    json.get("observation_count").and_then(|v| v.as_u64()).map(|v| v as i64),
                    json.get("average_spread").and_then(|v| v.as_f64()),
                    json.get("point_density").map(|v| v.to_string()),
                    json.get("scale").and_then(|v| v.as_str()),
                    json.get("version").and_then(|v| v.as_u64()).unwrap_or(1) as i64,
                    if json.get("is_user_defined").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 },
                    json.get("stability").and_then(|v| v.as_f64()),
                ],
            )?;
            migrated_count += 1;

            // Migrate activity associations
            for activity_id in activity_ids {
                conn.execute(
                    "INSERT OR IGNORE INTO section_activities_new (section_id, activity_id) VALUES (?, ?)",
                    params![id, activity_id],
                )?;
                total_associations += 1;
            }
        }

        // Verify migration - count must match
        let new_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sections_new",
            [],
            |row| row.get(0),
        )?;

        if new_count != migrated_count as i64 {
            log::error!(
                "tracematch: [Migration] FAILED: Count mismatch! Expected {}, got {}. Rolling back.",
                migrated_count, new_count
            );
            conn.execute_batch(
                "DROP TABLE IF EXISTS sections_new;
                 DROP TABLE IF EXISTS section_activities_new;"
            )?;
            return Err(rusqlite::Error::QueryReturnedNoRows); // Signal failure
        }

        log::info!(
            "tracematch: [Migration] Verified {} sections and {} associations in new tables",
            new_count, total_associations
        );

        // Atomic swap: rename old tables to _old, new tables to final names
        conn.execute_batch(
            "ALTER TABLE sections RENAME TO sections_old;
             ALTER TABLE sections_new RENAME TO sections;
             ALTER TABLE section_activities_new RENAME TO section_activities;

             -- Create indexes on new tables
             CREATE INDEX IF NOT EXISTS idx_section_activities_activity ON section_activities(activity_id);
             CREATE INDEX IF NOT EXISTS idx_sections_type ON sections(section_type);
             CREATE INDEX IF NOT EXISTS idx_sections_sport ON sections(sport_type);

             -- Only drop old table after everything succeeded
             DROP TABLE IF EXISTS sections_old;"
        )?;

        log::info!(
            "tracematch: [Migration] Successfully migrated {} sections to new schema",
            new_count
        );

        Ok(())
    }

    /// Migrate custom section names from legacy section_names table.
    /// This table stored user-overridden names separately from the blob data.
    fn migrate_legacy_section_names(conn: &Connection) -> SqlResult<()> {
        // Check if legacy section_names table exists
        let table_exists = conn
            .prepare("SELECT 1 FROM section_names LIMIT 0")
            .is_ok();

        if !table_exists {
            return Ok(()); // Table doesn't exist, nothing to migrate
        }

        log::info!("tracematch: [Migration] Migrating legacy section_names table...");

        // Update sections with custom names from the legacy table
        let count = conn.execute(
            "UPDATE sections
             SET name = (SELECT custom_name FROM section_names WHERE section_names.section_id = sections.id)
             WHERE name IS NULL
               AND EXISTS (SELECT 1 FROM section_names WHERE section_names.section_id = sections.id)",
            [],
        )?;

        log::info!(
            "tracematch: [Migration] Updated {} sections with custom names",
            count
        );

        // Drop the legacy table
        conn.execute("DROP TABLE IF EXISTS section_names", [])?;

        Ok(())
    }

    /// Post-migration schema updates (add columns to existing tables).
    fn migrate_schema(conn: &Connection) -> SqlResult<()> {
        // Check if start_date column exists in activities
        let has_start_date: bool = conn
            .prepare("SELECT start_date FROM activities LIMIT 0")
            .is_ok();

        if !has_start_date {
            conn.execute_batch(
                "ALTER TABLE activities ADD COLUMN start_date INTEGER;
                 ALTER TABLE activities ADD COLUMN name TEXT;
                 ALTER TABLE activities ADD COLUMN distance_meters REAL;
                 ALTER TABLE activities ADD COLUMN duration_secs INTEGER;"
            )?;
            log::info!("tracematch: [Migration] Added metadata columns to activities table");
        }

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

        // Load activity IDs for each section from junction table
        let section_activity_ids: HashMap<String, Vec<String>> = {
            let mut stmt = self.db.prepare(
                "SELECT section_id, activity_id FROM section_activities ORDER BY section_id"
            )?;
            let mut map: HashMap<String, Vec<String>> = HashMap::new();
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows.flatten() {
                map.entry(row.0).or_default().push(row.1);
            }
            map
        };

        let mut stmt = self.db.prepare(
            "SELECT id, section_type, name, sport_type, polyline_json, distance_meters,
                    representative_activity_id, confidence, observation_count, average_spread,
                    point_density_json, scale, version, is_user_defined, stability,
                    created_at, updated_at
             FROM sections WHERE section_type = 'auto'"
        )?;

        self.sections = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let polyline_json: String = row.get(4)?;
                let point_density_json: Option<String> = row.get(10)?;
                let representative_activity_id: Option<String> = row.get(6)?;

                let polyline: Vec<GpsPoint> = serde_json::from_str(&polyline_json)
                    .unwrap_or_default();
                let point_density: Vec<u32> = point_density_json
                    .and_then(|j| serde_json::from_str(&j).ok())
                    .unwrap_or_default();

                let activity_ids = section_activity_ids.get(&id)
                    .cloned()
                    .unwrap_or_default();
                let visit_count = activity_ids.len() as u32;

                Ok(FrequentSection {
                    id,
                    name: row.get(2)?,
                    sport_type: row.get(3)?,
                    polyline,
                    representative_activity_id: representative_activity_id.unwrap_or_default(),
                    activity_ids,
                    activity_portions: vec![],
                    route_ids: vec![],
                    visit_count,
                    distance_meters: row.get(5)?,
                    activity_traces: std::collections::HashMap::new(),
                    confidence: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                    observation_count: row.get::<_, Option<u32>>(8)?.unwrap_or(0),
                    average_spread: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                    point_density,
                    scale: row.get(11)?,
                    version: row.get::<_, Option<u32>>(12)?.unwrap_or(1),
                    is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                    stability: row.get::<_, Option<f64>>(14)?.unwrap_or(0.0),
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                })
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
    }

    // ========================================================================
    // Database Storage
    // ========================================================================

    fn store_activity(&self, id: &str, sport_type: &str, bounds: &Bounds) -> SqlResult<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![
                id,
                sport_type,
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng
            ],
        )?;
        Ok(())
    }

    /// Update activity metadata (date, name, distance, duration).
    /// Called after GPS sync to add metadata from intervals.icu API.
    pub fn update_activity_metadata(
        &self,
        id: &str,
        start_date: Option<i64>,
        name: Option<&str>,
        distance_meters: Option<f64>,
        duration_secs: Option<i64>,
    ) -> SqlResult<()> {
        self.db.execute(
            "UPDATE activities SET start_date = ?, name = ?, distance_meters = ?, duration_secs = ? WHERE id = ?",
            params![start_date, name, distance_meters, duration_secs, id],
        )?;
        Ok(())
    }

    fn store_gps_track(&self, id: &str, coords: &[GpsPoint]) -> SqlResult<()> {
        let track_data = rmp_serde::to_vec(coords).unwrap_or_default();
        self.db.execute(
            "INSERT OR REPLACE INTO gps_tracks (activity_id, track_data, point_count)
             VALUES (?, ?, ?)",
            params![id, track_data, coords.len() as i64],
        )?;
        Ok(())
    }

    fn store_signature(&self, id: &str, sig: &RouteSignature) -> SqlResult<()> {
        let points_blob = rmp_serde::to_vec(&sig.points).unwrap_or_default();
        self.db.execute(
            "INSERT OR REPLACE INTO signatures (activity_id, points, start_point_lat, start_point_lng, end_point_lat, end_point_lng, total_distance, point_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                points_blob,
                sig.start_point.latitude,
                sig.start_point.longitude,
                sig.end_point.latitude,
                sig.end_point.longitude,
                sig.total_distance,
                sig.points.len() as i64
            ],
        )?;
        Ok(())
    }

    fn rebuild_spatial_index(&mut self) {
        let entries: Vec<ActivityBoundsEntry> = self
            .activity_metadata
            .values()
            .map(|m| ActivityBoundsEntry {
                activity_id: m.id.clone(),
                bounds: m.bounds,
            })
            .collect();
        self.spatial_index = RTree::bulk_load(entries);
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /// Get activity count.
    pub fn activity_count(&self) -> usize {
        self.activity_metadata.len()
    }
    /// Get all activity IDs.
    pub fn get_activity_ids(&self) -> Vec<String> {
        self.activity_metadata.keys().cloned().collect()
    }

    /// Check if an activity exists.
    pub fn has_activity(&self, id: &str) -> bool {
        self.activity_metadata.contains_key(id)
    }

    /// Query activities within a viewport.
    pub fn query_viewport(&self, bounds: &Bounds) -> Vec<String> {
        let search_bounds = AABB::from_corners(
            [bounds.min_lng, bounds.min_lat],
            [bounds.max_lng, bounds.max_lat],
        );

        self.spatial_index
            .locate_in_envelope_intersecting(&search_bounds)
            .map(|b| b.activity_id.clone())
            .collect()
    }

    /// Get all activities with complete metadata for map display.
    /// Queries the database for metadata fields (date, name, distance, duration).
    pub fn get_all_map_activities_complete(&self) -> Vec<MapActivityComplete> {
        let mut stmt = match self.db.prepare(
            "SELECT id, sport_type, min_lat, max_lat, min_lng, max_lng,
                    COALESCE(start_date, 0) as start_date,
                    COALESCE(name, '') as name,
                    COALESCE(distance_meters, 0.0) as distance_meters,
                    COALESCE(duration_secs, 0) as duration_secs
             FROM activities"
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[PersistentEngine] Failed to prepare query: {}", e);
                return Vec::new();
            }
        };

        let results = stmt.query_map([], |row| {
            Ok(MapActivityComplete {
                activity_id: row.get(0)?,
                sport_type: row.get(1)?,
                bounds: crate::FfiBounds {
                    min_lat: row.get(2)?,
                    max_lat: row.get(3)?,
                    min_lng: row.get(4)?,
                    max_lng: row.get(5)?,
                },
                date: row.get(6)?,
                name: row.get(7)?,
                distance: row.get(8)?,
                duration: row.get(9)?,
            })
        });

        match results {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                log::error!("[PersistentEngine] Failed to query activities: {}", e);
                Vec::new()
            }
        }
    }

    /// Get activities filtered by date range and sport types.
    /// - start_ts: Unix timestamp (seconds) for start of range
    /// - end_ts: Unix timestamp (seconds) for end of range
    /// - sport_types: Optional list of sport types to include (empty = all)
    pub fn get_map_activities_filtered(
        &self,
        start_ts: i64,
        end_ts: i64,
        sport_types: &[String],
    ) -> Vec<MapActivityComplete> {
        // Build query based on filters
        let base_query = "SELECT id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                 COALESCE(start_date, 0) as start_date,
                                 COALESCE(name, '') as name,
                                 COALESCE(distance_meters, 0.0) as distance_meters,
                                 COALESCE(duration_secs, 0) as duration_secs
                          FROM activities
                          WHERE (start_date IS NULL OR (start_date >= ? AND start_date <= ?))";

        let query = if sport_types.is_empty() {
            base_query.to_string()
        } else {
            let placeholders = sport_types.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            format!("{} AND sport_type IN ({})", base_query, placeholders)
        };

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[PersistentEngine] Failed to prepare filtered query: {}", e);
                return Vec::new();
            }
        };

        // Build params
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![
            Box::new(start_ts),
            Box::new(end_ts),
        ];
        for sport in sport_types {
            params.push(Box::new(sport.clone()));
        }
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let results = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(MapActivityComplete {
                activity_id: row.get(0)?,
                sport_type: row.get(1)?,
                bounds: crate::FfiBounds {
                    min_lat: row.get(2)?,
                    max_lat: row.get(3)?,
                    min_lng: row.get(4)?,
                    max_lng: row.get(5)?,
                },
                date: row.get(6)?,
                name: row.get(7)?,
                distance: row.get(8)?,
                duration: row.get(9)?,
            })
        });

        match results {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                log::error!("[PersistentEngine] Failed to query filtered activities: {}", e);
                Vec::new()
            }
        }
    }

    /// Get a signature, loading from DB if not cached.
    pub fn get_signature(&mut self, id: &str) -> Option<RouteSignature> {
        // Check cache first
        if let Some(sig) = self.signature_cache.get(&id.to_string()) {
            return Some(sig.clone());
        }

        // Load from database
        let sig = self.load_signature_from_db(id)?;
        self.signature_cache.put(id.to_string(), sig.clone());
        Some(sig)
    }

    fn load_signature_from_db(&self, id: &str) -> Option<RouteSignature> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT points, start_point_lat, start_point_lng, end_point_lat, end_point_lng, total_distance
                 FROM signatures WHERE activity_id = ?",
            )
            .ok()?;

        stmt.query_row(params![id], |row| {
            let points_blob: Vec<u8> = row.get(0)?;
            let points: Vec<GpsPoint> = rmp_serde::from_slice(&points_blob).unwrap_or_default();
            let start_point = GpsPoint::new(row.get(1)?, row.get(2)?);
            let end_point = GpsPoint::new(row.get(3)?, row.get(4)?);
            let total_distance: f64 = row.get(5)?;

            // Compute bounds and center from points
            let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
                min_lat: 0.0,
                max_lat: 0.0,
                min_lng: 0.0,
                max_lng: 0.0,
            });
            let center = bounds.center();

            Ok(RouteSignature {
                activity_id: id.to_string(),
                points,
                total_distance,
                start_point,
                end_point,
                bounds,
                center,
            })
        })
        .ok()
    }

    /// Get GPS track from database (on-demand, never cached).
    pub fn get_gps_track(&self, id: &str) -> Option<Vec<GpsPoint>> {
        let mut stmt = self
            .db
            .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
            .ok()?;

        stmt.query_row(params![id], |row| {
            let track_blob: Vec<u8> = row.get(0)?;
            Ok(rmp_serde::from_slice(&track_blob).unwrap_or_default())
        })
        .ok()
    }

    /// Get all GPS tracks from database for tile generation.
    /// Returns a vector of track point arrays, suitable for heatmap rendering.
    pub fn get_all_tracks(&self) -> Vec<Vec<GpsPoint>> {
        log::info!("[get_all_tracks] Starting query...");

        let mut stmt = match self.db.prepare("SELECT track_data FROM gps_tracks") {
            Ok(s) => s,
            Err(e) => {
                log::error!("[get_all_tracks] Failed to prepare statement: {:?}", e);
                return Vec::new();
            }
        };

        let rows = stmt.query_map([], |row| {
            let track_blob: Vec<u8> = row.get(0)?;
            let blob_len = track_blob.len();
            let track = rmp_serde::from_slice::<Vec<GpsPoint>>(&track_blob).unwrap_or_default();
            log::debug!("[get_all_tracks] Blob {} bytes -> {} points", blob_len, track.len());
            Ok(track)
        });

        match rows {
            Ok(iter) => {
                let mut success_count = 0;
                let mut error_count = 0;
                let mut empty_count = 0;
                let mut total_points = 0usize;
                let mut sample_points: Vec<(f64, f64)> = Vec::new();

                let result: Vec<Vec<GpsPoint>> = iter
                    .filter_map(|r| match r {
                        Ok(track) => {
                            if track.is_empty() {
                                empty_count += 1;
                                None
                            } else {
                                // Sample first few points from first track
                                if success_count == 0 && sample_points.len() < 5 {
                                    for point in track.iter().take(5) {
                                        sample_points.push((point.latitude, point.longitude));
                                    }
                                }
                                total_points += track.len();
                                success_count += 1;
                                Some(track)
                            }
                        }
                        Err(e) => {
                            error_count += 1;
                            log::warn!("[get_all_tracks] Row error: {:?}", e);
                            None
                        }
                    })
                    .collect();

                log::info!(
                    "[get_all_tracks] Results: {} tracks, {} total points, {} errors, {} empty",
                    success_count, total_points, error_count, empty_count
                );

                if !sample_points.is_empty() {
                    log::info!(
                        "[get_all_tracks] Sample points from first track: {:?}",
                        sample_points
                    );
                }

                result
            }
            Err(e) => {
                log::error!("[get_all_tracks] Query failed: {:?}", e);
                Vec::new()
            }
        }
    }

    // ========================================================================
    // Time Streams (for section performance calculations)
    // ========================================================================

    /// Store time stream to database.
    fn store_time_stream(&self, activity_id: &str, times: &[u32]) -> SqlResult<()> {
        let times_blob = rmp_serde::to_vec(times).unwrap_or_default();
        self.db.execute(
            "INSERT OR REPLACE INTO time_streams (activity_id, times, point_count)
             VALUES (?, ?, ?)",
            params![activity_id, times_blob, times.len() as i64],
        )?;
        Ok(())
    }

    /// Load time stream from database.
    fn load_time_stream(&self, activity_id: &str) -> Option<Vec<u32>> {
        let mut stmt = self
            .db
            .prepare("SELECT times FROM time_streams WHERE activity_id = ?")
            .ok()?;

        stmt.query_row(params![activity_id], |row| {
            let times_blob: Vec<u8> = row.get(0)?;
            Ok(rmp_serde::from_slice(&times_blob).unwrap_or_default())
        })
        .ok()
    }

    /// Check which activities are missing time streams (not in memory or SQLite).
    /// Returns list of activity IDs that need to be fetched from the API.
    pub fn get_activities_missing_time_streams(&self, activity_ids: &[String]) -> Vec<String> {
        if activity_ids.is_empty() {
            return Vec::new();
        }

        // First filter out any that are already in memory
        let not_in_memory: Vec<&String> = activity_ids
            .iter()
            .filter(|id| !self.time_streams.contains_key(*id))
            .collect();

        if not_in_memory.is_empty() {
            return Vec::new();
        }

        // Check SQLite for the remaining ones
        let placeholders: Vec<&str> = not_in_memory.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT activity_id FROM time_streams WHERE activity_id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => {
                // On error, return all that aren't in memory
                return not_in_memory.into_iter().cloned().collect();
            }
        };

        // Bind all activity IDs as parameters
        let params: Vec<&dyn rusqlite::ToSql> = not_in_memory
            .iter()
            .map(|s| *s as &dyn rusqlite::ToSql)
            .collect();

        let cached_in_sqlite: std::collections::HashSet<String> = stmt
            .query_map(params.as_slice(), |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        // Return IDs that are NOT in memory AND NOT in SQLite
        not_in_memory
            .into_iter()
            .filter(|id| !cached_in_sqlite.contains(*id))
            .cloned()
            .collect()
    }

    /// Check if a specific activity has a time stream (in memory or SQLite).
    pub fn has_time_stream(&self, activity_id: &str) -> bool {
        // First check memory cache
        if self.time_streams.contains_key(activity_id) {
            return true;
        }
        // Then check SQLite
        let mut stmt = match self
            .db
            .prepare("SELECT 1 FROM time_streams WHERE activity_id = ? LIMIT 1")
        {
            Ok(s) => s,
            Err(_) => return false,
        };
        stmt.exists(params![activity_id]).unwrap_or(false)
    }

    /// Ensure time stream is loaded into memory (from SQLite if needed).
    /// Returns true if the time stream is available.
    fn ensure_time_stream_loaded(&mut self, activity_id: &str) -> bool {
        // Already in memory?
        if self.time_streams.contains_key(activity_id) {
            return true;
        }
        // Try to load from SQLite
        if let Some(times) = self.load_time_stream(activity_id) {
            self.time_streams.insert(activity_id.to_string(), times);
            return true;
        }
        false
    }

    // ========================================================================
    // Route Groups
    // ========================================================================

    /// Get route groups, recomputing if dirty.
    pub fn get_groups(&mut self) -> &[RouteGroup] {
        if self.groups_dirty {
            self.recompute_groups();
        }
        &self.groups
    }

    /// Recompute route groups.
    fn recompute_groups(&mut self) {
        use std::time::Instant;
        let total_start = Instant::now();
        log::info!("[RUST: PERF] recompute_groups: starting...");

        // Phase 1: Load all signatures (this will use cache where possible)
        let sig_start = Instant::now();
        let activity_ids: Vec<String> = self.activity_metadata.keys().cloned().collect();
        let mut signatures = Vec::with_capacity(activity_ids.len());

        for id in &activity_ids {
            if let Some(sig) = self.get_signature(id) {
                signatures.push(sig);
            }
        }
        let sig_ms = sig_start.elapsed().as_millis();

        log::info!(
            "[RUST: PERF] Phase 1 - Load signatures: {} from {} activities in {}ms",
            signatures.len(),
            activity_ids.len(),
            sig_ms
        );

        // Phase 2: Group signatures and capture match info (uses parallel rayon)
        let group_start = Instant::now();
        let result = tracematch::group_signatures_parallel_with_matches(&signatures, &self.match_config);

        let group_ms = group_start.elapsed().as_millis();
        log::info!(
            "[RUST: PERF] Phase 2 - Group signatures: {} groups in {}ms (uses simplified signatures)",
            result.groups.len(),
            group_ms
        );

        self.groups = result.groups;
        self.activity_matches = result.activity_matches;

        // Phase 3: Recalculate match percentages using ORIGINAL GPS tracks (not simplified signatures)
        // This captures actual GPS variation that was smoothed out by Douglas-Peucker
        // NOTE: This is the BOTTLENECK - see PERF logs inside this function
        self.recalculate_match_percentages_from_tracks();

        // Log match info computed
        let total_matches: usize = self.activity_matches.values().map(|v| v.len()).sum();
        log::info!(
            "[RUST: PERF] Phase 3 complete: {} groups with {} total match entries",
            self.groups.len(),
            total_matches
        );

        // Populate sport_type for each group from the representative activity
        for group in &mut self.groups {
            if let Some(meta) = self.activity_metadata.get(&group.representative_id) {
                group.sport_type = if meta.sport_type.is_empty() {
                    "Ride".to_string() // Default for empty sport type
                } else {
                    meta.sport_type.clone()
                };
            } else {
                // Representative activity not found - use default
                group.sport_type = "Ride".to_string();
            }
        }

        // Phase 4: Save to database
        let save_start = Instant::now();
        self.save_groups().ok();
        let save_ms = save_start.elapsed().as_millis();
        self.groups_dirty = false;

        let total_ms = total_start.elapsed().as_millis();
        log::info!("[RUST: PERF] Phase 4 - Save groups: {}ms", save_ms);
        log::info!(
            "[RUST: PERF] recompute_groups TOTAL: {}ms (signatures={}ms + grouping={}ms + AMD_recalc=see_above + save={}ms)",
            total_ms,
            sig_ms,
            group_ms,
            save_ms
        );
    }

    /// Recalculate match percentages using original GPS tracks instead of simplified signatures.
    /// Uses AMD (Average Minimum Distance) for accurate track comparison.
    fn recalculate_match_percentages_from_tracks(&mut self) {
        use crate::matching::{amd_to_percentage, average_min_distance};
        use std::collections::HashMap;
        use std::time::Instant;

        let func_start = Instant::now();

        // PERF ASSESSMENT: This function is a BOTTLENECK
        // - Loads ALL GPS tracks from SQLite (I/O bound)
        // - Does pairwise AMD calculations SEQUENTIALLY (CPU bound, O(n*m) per pair)
        // - Could be parallelized with rayon but requires restructuring
        log::info!(
            "tracematch: [PERF] recalculate_match_percentages: SEQUENTIAL pairwise AMD - {} groups",
            self.groups.len()
        );

        // First pass: collect all activity IDs and load tracks
        // PERF: I/O bound - loads tracks SEQUENTIALLY from SQLite
        let load_start = Instant::now();
        let mut tracks: HashMap<String, Vec<GpsPoint>> = HashMap::new();
        let mut total_points_loaded: usize = 0;

        for group in &self.groups {
            // Load representative track
            if let Some(track) = self.load_gps_track_from_db(&group.representative_id)
                && track.len() >= 2
            {
                total_points_loaded += track.len();
                tracks.insert(group.representative_id.clone(), track);
            }

            // Load all activity tracks in this group
            if let Some(matches) = self.activity_matches.get(&group.group_id) {
                for match_info in matches {
                    if !tracks.contains_key(&match_info.activity_id)
                        && let Some(track) = self.load_gps_track_from_db(&match_info.activity_id)
                        && track.len() >= 2
                    {
                        total_points_loaded += track.len();
                        tracks.insert(match_info.activity_id.clone(), track);
                    }
                }
            }
        }
        let load_ms = load_start.elapsed().as_millis();
        log::info!(
            "[RUST: PERF] Track loading: {} tracks, {} total points in {}ms (SEQUENTIAL I/O)",
            tracks.len(),
            total_points_loaded,
            load_ms
        );

        // Second pass: recalculate match percentages using AMD
        // PERF: CPU bound - O(n*m) distance calculations per pair
        // OPTIMIZATION 1: Skip self-comparisons (activity == representative)
        // OPTIMIZATION 2: Parallelize with rayon
        let calc_start = Instant::now();

        // Collect work items for parallel processing
        let mut work_items: Vec<(String, String, Vec<GpsPoint>, Vec<GpsPoint>)> = Vec::new();
        let mut skipped_self = 0u32;

        for group in &self.groups {
            let rep_track = match tracks.get(&group.representative_id) {
                Some(t) => t,
                None => continue,
            };

            if let Some(matches) = self.activity_matches.get(&group.group_id) {
                for match_info in matches {
                    // OPTIMIZATION: Skip self-comparisons - always 100% match
                    if match_info.activity_id == group.representative_id {
                        skipped_self += 1;
                        continue;
                    }

                    let activity_track = match tracks.get(&match_info.activity_id) {
                        Some(t) => t,
                        None => continue,
                    };

                    work_items.push((
                        group.group_id.clone(),
                        match_info.activity_id.clone(),
                        activity_track.clone(),
                        rep_track.clone(),
                    ));
                }
            }
        }

        log::info!(
            "[RUST: PERF] AMD work: {} pairs to compute, {} self-comparisons skipped",
            work_items.len(),
            skipped_self
        );

        // Parallel AMD calculation using rayon
        use rayon::prelude::*;

        let results: Vec<(String, String, f64, usize, usize)> = work_items
            .par_iter()
            .map(|(group_id, activity_id, activity_track, rep_track)| {
                let amd_1_to_2 = average_min_distance(activity_track, rep_track);
                let amd_2_to_1 = average_min_distance(rep_track, activity_track);
                let avg_amd = (amd_1_to_2 + amd_2_to_1) / 2.0;
                (
                    group_id.clone(),
                    activity_id.clone(),
                    avg_amd,
                    activity_track.len(),
                    rep_track.len(),
                )
            })
            .collect();

        let amd_calculations = (results.len() * 2) as u32;

        // Apply results back to activity_matches
        for (group_id, activity_id, avg_amd, activity_len, rep_len) in results {
            let new_percentage = amd_to_percentage(
                avg_amd,
                self.match_config.perfect_threshold,
                self.match_config.zero_threshold,
            );

            if let Some(matches) = self.activity_matches.get_mut(&group_id)
                && let Some(match_info) = matches.iter_mut().find(|m| m.activity_id == activity_id)
            {
                log::debug!(
                    "tracematch: recalc match % for {}: {:.1}% -> {:.1}% (AMD: {:.1}m, {} vs {} points)",
                    activity_id,
                    match_info.match_percentage,
                    new_percentage,
                    avg_amd,
                    activity_len,
                    rep_len
                );
                match_info.match_percentage = new_percentage;
            }
        }

        let calc_ms = calc_start.elapsed().as_millis();
        let total_ms = func_start.elapsed().as_millis();
        log::info!(
            "[RUST: PERF] AMD calculations: {} calls in {}ms (PARALLEL with rayon)",
            amd_calculations,
            calc_ms
        );
        log::info!(
            "[RUST: PERF] recalculate_match_percentages TOTAL: {}ms (load={}ms + calc={}ms)",
            total_ms,
            load_ms,
            calc_ms
        );
    }

    /// Load original GPS track from database (separate function to avoid borrow issues)
    fn load_gps_track_from_db(&self, activity_id: &str) -> Option<Vec<GpsPoint>> {
        let mut stmt = self
            .db
            .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
            .ok()?;

        stmt.query_row(params![activity_id], |row| {
            let data: Vec<u8> = row.get(0)?;
            Ok(rmp_serde::from_slice(&data).ok())
        })
        .ok()
        .flatten()
    }

    fn save_groups(&self) -> SqlResult<()> {
        // Clear existing groups and matches
        self.db.execute("DELETE FROM route_groups", [])?;
        self.db.execute("DELETE FROM activity_matches", [])?;

        // Insert groups
        let mut stmt = self.db.prepare(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )?;

        for group in &self.groups {
            let activity_ids_json = serde_json::to_string(&group.activity_ids).unwrap_or_default();
            stmt.execute(params![
                group.group_id,
                group.representative_id,
                activity_ids_json,
                group.sport_type,
                group.bounds.map(|b| b.min_lat),
                group.bounds.map(|b| b.max_lat),
                group.bounds.map(|b| b.min_lng),
                group.bounds.map(|b| b.max_lng),
            ])?;
        }

        // Insert activity matches
        let mut match_stmt = self.db.prepare(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
             VALUES (?, ?, ?, ?)",
        )?;

        for (route_id, matches) in &self.activity_matches {
            for m in matches {
                match_stmt.execute(params![
                    route_id,
                    m.activity_id,
                    m.match_percentage,
                    m.direction,
                ])?;
            }
        }

        Ok(())
    }

    /// Get groups as JSON string.
    pub fn get_groups_json(&mut self) -> String {
        let groups = self.get_groups();
        serde_json::to_string(groups).unwrap_or_else(|_| "[]".to_string())
    }

    // ========================================================================
    // Sections (Background Detection)
    // ========================================================================

    /// Get sections (must call detect_sections first or load from DB).
    pub fn get_sections(&self) -> &[FrequentSection] {
        &self.sections
    }

    /// Update a section's name in memory (for immediate visibility after rename).
    pub fn update_section_name_in_memory(&mut self, section_id: &str, name: &str) {
        if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
            section.name = Some(name.to_string());
        }
    }

    /// Get section count directly from SQLite (no data loading).
    /// This is O(1) and doesn't require loading sections into memory.
    pub fn get_section_count(&self) -> u32 {
        self.db
            .query_row("SELECT COUNT(*) FROM sections", [], |row| row.get(0))
            .unwrap_or(0)
    }

    /// Get group count directly from SQLite (no data loading).
    /// This is O(1) and doesn't require loading groups into memory.
    pub fn get_group_count(&self) -> u32 {
        self.db
            .query_row("SELECT COUNT(*) FROM route_groups", [], |row| row.get(0))
            .unwrap_or(0)
    }

    /// Get lightweight section summaries without polyline data.
    /// Queries SQLite and extracts only summary fields, skipping heavy data like
    /// polylines, activityTraces, and pointDensity.
    pub fn get_section_summaries(&self) -> Vec<SectionSummary> {
        // First get activity counts per section from junction table
        let activity_counts: HashMap<String, u32> = {
            let mut stmt = match self.db.prepare(
                "SELECT section_id, COUNT(*) FROM section_activities GROUP BY section_id"
            ) {
                Ok(s) => s,
                Err(_) => return Vec::new(),
            };
            stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)))
                .ok()
                .map(|iter| iter.filter_map(|r| r.ok()).collect())
                .unwrap_or_default()
        };

        let mut stmt = match self.db.prepare(
            "SELECT id, name, sport_type, distance_meters, confidence, scale, polyline_json
             FROM sections"
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to prepare section summaries query: {}",
                    e
                );
                return Vec::new();
            }
        };

        let results: Vec<SectionSummary> = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let polyline_json: String = row.get(6)?;

                // Extract bounds from polyline
                let bounds = serde_json::from_str::<Vec<serde_json::Value>>(&polyline_json)
                    .ok()
                    .and_then(|points| {
                        if points.len() < 2 {
                            return None;
                        }
                        let mut min_lat = f64::MAX;
                        let mut max_lat = f64::MIN;
                        let mut min_lng = f64::MAX;
                        let mut max_lng = f64::MIN;

                        for point in &points {
                            if let (Some(lat), Some(lng)) =
                                (point["latitude"].as_f64(), point["longitude"].as_f64())
                            {
                                min_lat = min_lat.min(lat);
                                max_lat = max_lat.max(lat);
                                min_lng = min_lng.min(lng);
                                max_lng = max_lng.max(lng);
                            }
                        }

                        if min_lat < f64::MAX {
                            Some(crate::FfiBounds {
                                min_lat,
                                max_lat,
                                min_lng,
                                max_lng,
                            })
                        } else {
                            None
                        }
                    });

                let activity_count = activity_counts.get(&id).copied().unwrap_or(0);

                Ok(SectionSummary {
                    id,
                    name: row.get(1)?,
                    sport_type: row.get(2)?,
                    visit_count: activity_count,
                    distance_meters: row.get(3)?,
                    activity_count,
                    confidence: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    scale: row.get(5)?,
                    bounds,
                })
            })
            .ok()
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        log::info!(
            "tracematch: [PersistentEngine] get_section_summaries returned {} summaries",
            results.len()
        );
        results
    }

    /// Get section summaries filtered by sport type.
    pub fn get_section_summaries_for_sport(&self, sport_type: &str) -> Vec<SectionSummary> {
        self.get_section_summaries()
            .into_iter()
            .filter(|s| s.sport_type == sport_type)
            .collect()
    }

    /// Get lightweight group summaries without full activity ID lists.
    pub fn get_group_summaries(&self) -> Vec<GroupSummary> {
        let mut stmt = match self.db.prepare(
            "SELECT id, representative_id, sport_type, activity_ids,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
             FROM route_groups",
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "tracematch: [PersistentEngine] Failed to prepare group summaries query: {}",
                    e
                );
                return Vec::new();
            }
        };

        // Load custom names
        let custom_names = self.get_all_route_names();

        let results: Vec<GroupSummary> = stmt
            .query_map([], |row| {
                let group_id: String = row.get(0)?;
                let representative_id: String = row.get(1)?;
                let sport_type: String = row.get(2)?;
                let activity_ids_json: String = row.get(3)?;

                // Parse activity_ids just to get count
                let activity_count: u32 = serde_json::from_str::<Vec<String>>(&activity_ids_json)
                    .map(|ids| ids.len() as u32)
                    .unwrap_or(0);

                // Build bounds if present
                let bounds = if let (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) = (
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<f64>>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, Option<f64>>(7)?,
                ) {
                    Some(crate::FfiBounds {
                        min_lat,
                        max_lat,
                        min_lng,
                        max_lng,
                    })
                } else {
                    None
                };

                // Look up custom name
                let custom_name = custom_names.get(&group_id).cloned();

                Ok(GroupSummary {
                    group_id,
                    representative_id,
                    sport_type,
                    activity_count,
                    custom_name,
                    bounds,
                })
            })
            .ok()
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        log::info!(
            "tracematch: [PersistentEngine] get_group_summaries returned {} summaries",
            results.len()
        );
        results
    }

    /// Get a single section by ID with LRU caching.
    /// Returns the full FrequentSection with polyline data.
    /// Uses LRU cache to avoid repeated SQLite queries for hot sections.
    pub fn get_section_by_id(&mut self, section_id: &str) -> Option<FrequentSection> {
        // Check LRU cache first
        if let Some(section) = self.section_cache.get(&section_id.to_string()) {
            log::debug!(
                "tracematch: [PersistentEngine] get_section_by_id cache hit for {}",
                section_id
            );
            return Some(section.clone());
        }

        // Get activity IDs from junction table
        let activity_ids: Vec<String> = {
            let mut stmt = match self.db.prepare(
                "SELECT activity_id FROM section_activities WHERE section_id = ?"
            ) {
                Ok(s) => s,
                Err(_) => return None,
            };
            stmt.query_map(params![section_id], |row| row.get(0))
                .ok()?
                .filter_map(|r| r.ok())
                .collect()
        };

        // Query SQLite with new schema
        let result: Option<FrequentSection> = self
            .db
            .query_row(
                "SELECT id, section_type, name, sport_type, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        created_at, updated_at
                 FROM sections WHERE id = ?",
                params![section_id],
                |row| {
                    let id: String = row.get(0)?;
                    let polyline_json: String = row.get(4)?;
                    let point_density_json: Option<String> = row.get(10)?;
                    let representative_activity_id: Option<String> = row.get(6)?;

                    let polyline: Vec<GpsPoint> = serde_json::from_str(&polyline_json)
                        .unwrap_or_default();
                    let point_density: Vec<u32> = point_density_json
                        .and_then(|j| serde_json::from_str(&j).ok())
                        .unwrap_or_default();

                    Ok(FrequentSection {
                        id,
                        name: row.get(2)?,
                        sport_type: row.get(3)?,
                        polyline,
                        representative_activity_id: representative_activity_id.unwrap_or_default(),
                        activity_ids: activity_ids.clone(),
                        activity_portions: vec![],
                        route_ids: vec![],
                        visit_count: activity_ids.len() as u32,
                        distance_meters: row.get(5)?,
                        activity_traces: std::collections::HashMap::new(),
                        confidence: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                        observation_count: row.get::<_, Option<u32>>(8)?.unwrap_or(0),
                        average_spread: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                        point_density,
                        scale: row.get(11)?,
                        version: row.get::<_, Option<u32>>(12)?.unwrap_or(1),
                        is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                        stability: row.get::<_, Option<f64>>(14)?.unwrap_or(0.0),
                        created_at: row.get(15)?,
                        updated_at: row.get(16)?,
                    })
                },
            )
            .ok();

        // Cache for future access
        if let Some(ref section) = result {
            self.section_cache
                .put(section_id.to_string(), section.clone());
            log::info!(
                "tracematch: [PersistentEngine] get_section_by_id found and cached section {}",
                section_id
            );
        } else {
            log::info!(
                "tracematch: [PersistentEngine] get_section_by_id: section {} not found",
                section_id
            );
        }

        result
    }

    /// Invalidate a section in the LRU cache.
    /// Call this after modifying a section to ensure fresh data on next fetch.
    pub fn invalidate_section_cache(&mut self, section_id: &str) {
        self.section_cache.pop(&section_id.to_string());
    }

    /// Get a single group by ID with LRU caching.
    /// Returns the full RouteGroup with activity IDs.
    /// Uses LRU cache to avoid repeated SQLite queries for hot groups.
    pub fn get_group_by_id(&mut self, group_id: &str) -> Option<RouteGroup> {
        // Check LRU cache first
        if let Some(group) = self.group_cache.get(&group_id.to_string()) {
            log::debug!(
                "tracematch: [PersistentEngine] get_group_by_id cache hit for {}",
                group_id
            );
            return Some(group.clone());
        }

        let custom_names = self.get_all_route_names();

        let result: Option<RouteGroup> = self
            .db
            .query_row(
                "SELECT id, representative_id, activity_ids, sport_type,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                 FROM route_groups WHERE id = ?",
                params![group_id],
                |row| {
                    let id: String = row.get(0)?;
                    let representative_id: String = row.get(1)?;
                    let activity_ids_json: String = row.get(2)?;
                    let sport_type: String = row.get(3)?;

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

                    let custom_name = custom_names.get(&id).cloned();

                    Ok(RouteGroup {
                        group_id: id,
                        representative_id,
                        activity_ids,
                        sport_type,
                        bounds,
                        custom_name,
                        best_time: None,
                        avg_time: None,
                        best_pace: None,
                        best_activity_id: None,
                    })
                },
            )
            .ok();

        // Cache for future access
        if let Some(ref group) = result {
            self.group_cache.put(group_id.to_string(), group.clone());
            log::info!(
                "tracematch: [PersistentEngine] get_group_by_id found and cached group {}",
                group_id
            );
        } else {
            log::info!(
                "tracematch: [PersistentEngine] get_group_by_id: group {} not found",
                group_id
            );
        }

        result
    }

    /// Get section polyline only (flat coordinates for map rendering).
    /// Returns [lat1, lng1, lat2, lng2, ...] or empty vec if not found.
    pub fn get_section_polyline(&self, section_id: &str) -> Vec<f64> {
        let result: Option<Vec<f64>> = self
            .db
            .query_row(
                "SELECT polyline_json FROM sections WHERE id = ?",
                params![section_id],
                |row| {
                    let polyline_json: String = row.get(0)?;
                    let points: Vec<serde_json::Value> = match serde_json::from_str(&polyline_json) {
                        Ok(v) => v,
                        Err(e) => {
                            log::error!(
                                "tracematch: get_section_polyline JSON parse error for {}: {}",
                                section_id,
                                e
                            );
                            return Ok(None);
                        }
                    };

                    let coords: Vec<f64> = points
                        .iter()
                        .flat_map(|p| {
                            let lat = p["latitude"].as_f64().unwrap_or(0.0);
                            let lng = p["longitude"].as_f64().unwrap_or(0.0);
                            vec![lat, lng]
                        })
                        .collect();

                    Ok(Some(coords))
                },
            )
            .ok()
            .flatten();

        result.unwrap_or_default()
    }

    /// Start section detection in a background thread.
    ///
    /// Returns a handle that can be polled for completion and progress.
    ///
    /// Note: This method is designed to be non-blocking on the calling thread.
    /// All heavy operations (groups loading, track loading, detection) happen
    /// in the background thread to keep the UI responsive.
    pub fn detect_sections_background(
        &mut self,
        sport_filter: Option<String>,
    ) -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        let db_path = self.db_path.clone();
        let section_config = self.section_config.clone();

        // Create shared progress tracker
        let progress = SectionDetectionProgress::new();
        let progress_clone = progress.clone();

        // Ensure groups are computed before section detection.
        // This is necessary because:
        // 1. Route groups are a core feature - users expect to see their routes
        // 2. Sections need groups to be linked to activities
        // 3. Without groups, the Routes tab shows "0 routes"
        //
        // This call may trigger recomputation if groups_dirty = true (after addActivities).
        // The recomputation loads signatures and runs grouping algorithm.
        // For 54 activities, this typically takes < 1 second.
        if self.groups_dirty {
            log::info!(
                "tracematch: [SectionDetection] Computing route groups before section detection..."
            );
            let start = std::time::Instant::now();
            let _ = self.get_groups(); // This triggers recomputation and saves to DB
            log::info!(
                "tracematch: [SectionDetection] Route groups computed in {:?}",
                start.elapsed()
            );
        }

        // Build sport type map - lightweight, just copying metadata
        let sport_map: HashMap<String, String> = self
            .activity_metadata
            .values()
            .map(|m| (m.id.clone(), m.sport_type.clone()))
            .collect();

        // Filter activity IDs by sport - lightweight
        let activity_ids: Vec<String> = if let Some(ref sport) = sport_filter {
            self.activity_metadata
                .values()
                .filter(|m| &m.sport_type == sport)
                .map(|m| m.id.clone())
                .collect()
        } else {
            self.activity_metadata.keys().cloned().collect()
        };

        // Set initial loading phase
        progress.set_phase("loading", activity_ids.len() as u32);

        thread::spawn(move || {
            log::info!(
                "tracematch: [SectionDetection] Background thread started with {} activity IDs",
                activity_ids.len()
            );

            // Open separate connection for background thread
            let conn = match Connection::open(&db_path) {
                Ok(c) => c,
                Err(e) => {
                    log::info!("tracematch: [SectionDetection] Failed to open DB: {:?}", e);
                    tx.send(Vec::new()).ok();
                    return;
                }
            };

            // Load groups from DB inside the thread (non-blocking on main thread)
            let groups = load_groups_from_db(&conn);
            log::info!(
                "tracematch: [SectionDetection] Loaded {} groups from DB",
                groups.len()
            );

            // Set loading phase with total count
            progress_clone.set_phase("loading", activity_ids.len() as u32);

            // Load GPS tracks from DB with progress updates
            let mut tracks_loaded = 0;
            let mut tracks_empty = 0;
            let tracks: Vec<(String, Vec<GpsPoint>)> = activity_ids
                .iter()
                .filter_map(|id| {
                    progress_clone.increment();
                    let mut stmt = conn
                        .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
                        .ok()?;
                    let track: Vec<GpsPoint> = stmt
                        .query_row(params![id], |row| {
                            let blob: Vec<u8> = row.get(0)?;
                            Ok(rmp_serde::from_slice(&blob).unwrap_or_default())
                        })
                        .ok()?;
                    if track.is_empty() {
                        tracks_empty += 1;
                        return None; // Skip empty tracks
                    }
                    tracks_loaded += 1;
                    Some((id.clone(), track))
                })
                .collect();

            log::info!(
                "tracematch: [SectionDetection] Loaded {} tracks ({} empty/missing) from {} activity IDs",
                tracks_loaded,
                tracks_empty,
                activity_ids.len()
            );

            if tracks.is_empty() {
                log::info!("tracematch: [SectionDetection] No tracks loaded, skipping detection");
                progress_clone.set_phase("complete", 0);
                tx.send(Vec::new()).ok();
                return;
            }

            // Log track point counts for debugging
            let total_points: usize = tracks.iter().map(|(_, t)| t.len()).sum();
            log::info!(
                "tracematch: [SectionDetection] Total GPS points: {}, avg per track: {}",
                total_points,
                total_points / tracks.len().max(1)
            );

            // Detect sections using multi-scale algorithm
            progress_clone.set_phase("detecting", tracks.len() as u32);
            let result = tracematch::sections::detect_sections_multiscale(
                &tracks,
                &sport_map,
                &groups,
                &section_config,
            );

            log::info!(
                "tracematch: [SectionDetection] Detection complete: {} sections, {} potentials",
                result.sections.len(),
                result.potentials.len()
            );

            progress_clone.set_phase("complete", 0);
            tx.send(result.sections).ok();
        });

        SectionDetectionHandle {
            receiver: rx,
            progress,
        }
    }

    /// Apply completed section detection results.
    pub fn apply_sections(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        self.sections = sections;
        self.save_sections()?;
        self.sections_dirty = false;
        Ok(())
    }

    fn save_sections(&self) -> SqlResult<()> {
        // Clear existing auto sections (keep custom sections)
        self.db.execute("DELETE FROM section_activities WHERE section_id IN (SELECT id FROM sections WHERE section_type = 'auto')", [])?;
        self.db.execute("DELETE FROM sections WHERE section_type = 'auto'", [])?;

        // Insert auto-detected sections with new schema
        let mut section_stmt = self.db.prepare(
            "INSERT INTO sections (
                id, section_type, name, sport_type, polyline_json, distance_meters,
                representative_activity_id, confidence, observation_count, average_spread,
                point_density_json, scale, version, is_user_defined, stability, created_at, updated_at
            ) VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )?;
        let mut junction_stmt = self
            .db
            .prepare("INSERT INTO section_activities (section_id, activity_id) VALUES (?, ?)")?;

        for section in &self.sections {
            let polyline_json = serde_json::to_string(&section.polyline)
                .unwrap_or_else(|_| "[]".to_string());
            let point_density_json = if section.point_density.is_empty() {
                None
            } else {
                serde_json::to_string(&section.point_density).ok()
            };
            let created_at = section.created_at.clone()
                .unwrap_or_else(|| Utc::now().to_rfc3339());

            section_stmt.execute(params![
                section.id,
                section.name,
                section.sport_type,
                polyline_json,
                section.distance_meters,
                if section.representative_activity_id.is_empty() {
                    None
                } else {
                    Some(&section.representative_activity_id)
                },
                section.confidence,
                section.observation_count,
                section.average_spread,
                point_density_json,
                section.scale,
                section.version,
                if section.is_user_defined { 1 } else { 0 },
                section.stability,
                created_at,
                section.updated_at,
            ])?;

            // Populate junction table for fast activity-based lookup
            for activity_id in &section.activity_ids {
                junction_stmt.execute(params![section.id, activity_id])?;
            }
        }

        Ok(())
    }

    // ========================================================================
    // Overlap Cache
    // ========================================================================

    /// Order activity IDs lexicographically for consistent cache keys.
    fn order_activity_ids<'a>(id_a: &'a str, id_b: &'a str) -> (&'a str, &'a str) {
        if id_a < id_b {
            (id_a, id_b)
        } else {
            (id_b, id_a)
        }
    }

    /// Get cached overlap result for two activities.
    /// Returns:
    ///   Some(Some(overlap_data)) - cached, has overlap with data
    ///   Some(None) - cached, no overlap exists
    ///   None - not cached, needs computation
    pub fn get_cached_overlap(&self, id_a: &str, id_b: &str) -> Option<Option<Vec<u8>>> {
        let (a, b) = Self::order_activity_ids(id_a, id_b);

        let mut stmt = self
            .db
            .prepare_cached("SELECT has_overlap, overlap_data FROM overlap_cache WHERE activity_a = ? AND activity_b = ?")
            .ok()?;

        match stmt.query_row(params![a, b], |row| {
            let has_overlap: i32 = row.get(0)?;
            let data: Option<Vec<u8>> = row.get(1)?;
            Ok((has_overlap, data))
        }) {
            Ok((1, data)) => Some(data), // Has overlap, return the data (or None if no data stored)
            Ok((0, _)) => Some(None),    // Cached as no overlap
            Ok(_) => Some(None),         // Invalid value, treat as no overlap
            Err(_) => None,              // Not in cache
        }
    }

    /// Store overlap result in cache.
    /// overlap_data should be None if no overlap, Some(serialized_data) if overlap exists.
    pub fn cache_overlap(&self, id_a: &str, id_b: &str, overlap_data: Option<&[u8]>) {
        let (a, b) = Self::order_activity_ids(id_a, id_b);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let has_overlap = if overlap_data.is_some() { 1 } else { 0 };

        let _ = self.db.execute(
            "INSERT OR REPLACE INTO overlap_cache (activity_a, activity_b, has_overlap, overlap_data, computed_at) VALUES (?, ?, ?, ?, ?)",
            params![a, b, has_overlap, overlap_data, now],
        );
    }

    /// Invalidate cached overlaps for an activity (when GPS track changes).
    pub fn invalidate_overlap_cache_for_activity(&self, activity_id: &str) {
        let _ = self.db.execute(
            "DELETE FROM overlap_cache WHERE activity_a = ? OR activity_b = ?",
            params![activity_id, activity_id],
        );
    }

    /// Get count of cached overlaps (for debugging/stats).
    pub fn get_overlap_cache_count(&self) -> u32 {
        self.db
            .query_row("SELECT COUNT(*) FROM overlap_cache", [], |row| row.get(0))
            .unwrap_or(0)
    }

    /// Clear all cached overlaps.
    pub fn clear_overlap_cache(&self) {
        let _ = self.db.execute("DELETE FROM overlap_cache", []);
    }

    // ========================================================================
    // Incremental Section Updates
    // ========================================================================

    /// Match a new activity's track against existing sections.
    /// Returns sections that the activity overlaps with, along with the matching track portion.
    /// This is O(S) where S = number of sections, much faster than full O(N²) re-detection.
    ///
    /// Uses tracematch's find_sections_in_route() which is optimized for this purpose.
    pub fn match_activity_to_sections(
        &self,
        activity_id: &str,
        track: &[GpsPoint],
    ) -> Vec<ActivitySectionMatch> {
        if track.is_empty() || self.sections.is_empty() {
            return vec![];
        }

        // Use internal version and convert to FFI-friendly format
        let internal_matches = self.match_activity_to_sections_internal(activity_id, track);

        let matches: Vec<ActivitySectionMatch> = internal_matches
            .into_iter()
            .map(|m| ActivitySectionMatch {
                section_id: m.section_id,
                section_name: m.section_name,
                overlap_distance: m.overlap_distance,
                start_index: m.start_index,
                end_index: m.end_index,
                match_quality: m.match_quality,
                same_direction: m.same_direction,
            })
            .collect();

        log::info!(
            "tracematch: [IncrementalUpdate] Activity {} matches {} existing sections",
            activity_id,
            matches.len()
        );

        matches
    }

    /// Internal version that returns overlap points for use in add_activity_to_section.
    fn match_activity_to_sections_internal(
        &self,
        activity_id: &str,
        track: &[GpsPoint],
    ) -> Vec<ActivitySectionMatchInternal> {
        if track.is_empty() || self.sections.is_empty() {
            return vec![];
        }

        // Use tracematch's find_sections_in_route - it handles R-tree building and matching
        let raw_matches = tracematch::find_sections_in_route(track, &self.sections, &self.section_config);

        // Convert to internal format with overlap points
        raw_matches
            .into_iter()
            .filter_map(|m| {
                // Skip if activity is already in this section
                let section = self.sections.iter().find(|s| s.id == m.section_id)?;
                if section.activity_ids.contains(&activity_id.to_string()) {
                    return None;
                }

                // Extract the overlapping portion of the track for distance calculation
                let start = m.start_index as usize;
                let end = (m.end_index as usize).min(track.len());
                if start >= end {
                    return None;
                }

                // Compute distance of overlap
                let overlap_distance: f64 = track[start..end]
                    .windows(2)
                    .map(|w| geo_utils::haversine_distance(&w[0], &w[1]))
                    .sum();

                Some(ActivitySectionMatchInternal {
                    section_id: m.section_id,
                    section_name: section.name.clone(),
                    overlap_distance,
                    start_index: m.start_index as u32,
                    end_index: m.end_index as u32,
                    match_quality: m.match_quality,
                    same_direction: m.same_direction,
                })
            })
            .collect()
    }

    /// Add an activity to an existing section and recalculate the medoid.
    /// This is the incremental update path - much faster than full re-detection.
    ///
    /// # Arguments
    /// * `section_id` - The section to add the activity to
    /// * `activity_id` - The activity being added
    /// * `overlap_points` - GPS points from the activity that overlap with the section
    /// * `same_direction` - Whether the activity travels in the same direction as the section
    pub fn add_activity_to_section(
        &mut self,
        section_id: &str,
        activity_id: &str,
        overlap_points: Vec<GpsPoint>,
        same_direction: bool,
    ) -> Result<(), String> {
        // Find the section
        let section = self
            .sections
            .iter_mut()
            .find(|s| s.id == section_id)
            .ok_or_else(|| format!("Section {} not found", section_id))?;

        // Don't modify user-defined sections automatically
        if section.is_user_defined {
            return Err(format!(
                "Section {} is user-defined, cannot auto-update",
                section_id
            ));
        }

        // Check if activity is already in section
        if section.activity_ids.contains(&activity_id.to_string()) {
            return Err(format!(
                "Activity {} already in section {}",
                activity_id, section_id
            ));
        }

        // Add activity
        section.activity_ids.push(activity_id.to_string());
        section.visit_count += 1;

        // Store the activity's trace
        section
            .activity_traces
            .insert(activity_id.to_string(), overlap_points.clone());

        // Compute distance of the overlap
        let overlap_distance: f64 = overlap_points
            .windows(2)
            .map(|w| geo_utils::haversine_distance(&w[0], &w[1]))
            .sum();

        // Add portion metadata
        // Note: start_index/end_index are relative to the overlap, not full track
        let direction = if same_direction { "same" } else { "reverse" }.to_string();
        section.activity_portions.push(SectionPortion {
            activity_id: activity_id.to_string(),
            start_index: 0,
            end_index: overlap_points.len().saturating_sub(1) as u32,
            distance_meters: overlap_distance,
            direction,
        });

        // Recalculate medoid if we have enough traces
        self.recalculate_section_medoid(section_id)?;

        // Update version and timestamp
        if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
            section.version += 1;
            section.updated_at = Some(current_timestamp_iso());
            section.observation_count = section.activity_ids.len() as u32;
        }

        // Save to DB
        self.save_sections()
            .map_err(|e| format!("Failed to save sections: {}", e))?;

        log::info!(
            "tracematch: [IncrementalUpdate] Added activity {} to section {}, now has {} activities",
            activity_id,
            section_id,
            self.sections
                .iter()
                .find(|s| s.id == section_id)
                .map(|s| s.activity_ids.len())
                .unwrap_or(0)
        );

        Ok(())
    }

    /// Recalculate the medoid (most representative trace) for a section.
    /// The medoid is the trace with minimum total AMD to all other traces.
    /// This is cheap: O(N²) pairwise comparisons but N is typically small (≤10 traces per section).
    fn recalculate_section_medoid(&mut self, section_id: &str) -> Result<(), String> {
        // First, extract all the data we need without holding a borrow
        let (is_user_defined, traces_data, old_medoid) = {
            let section = self
                .sections
                .iter()
                .find(|s| s.id == section_id)
                .ok_or_else(|| format!("Section {} not found", section_id))?;

            // Don't recalculate if user manually set the medoid
            if section.is_user_defined {
                return Ok(());
            }

            // Clone the traces data so we can release the borrow
            let traces: Vec<(String, Vec<GpsPoint>)> = section
                .activity_traces
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();

            (
                section.is_user_defined,
                traces,
                section.representative_activity_id.clone(),
            )
        };

        if is_user_defined {
            return Ok(());
        }

        if traces_data.is_empty() {
            return Ok(());
        }

        if traces_data.len() == 1 {
            // Only one trace - it's the medoid by default
            let activity_id = &traces_data[0].0;
            if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                section.representative_activity_id = activity_id.clone();
            }
            return Ok(());
        }

        // For small sets, compute full pairwise AMD
        // For larger sets (>10), use sampling
        let use_sampling = traces_data.len() > 10;
        let sample_size = if use_sampling { 5 } else { traces_data.len() };

        let mut best_activity_id = traces_data[0].0.clone();
        let mut best_total_amd = f64::MAX;

        for (i, (activity_id, trace_i)) in traces_data.iter().enumerate() {
            let mut total_amd = 0.0;

            // Compare to all others (or sample)
            let compare_indices: Vec<usize> = if use_sampling {
                // Sample random indices (excluding self)
                use std::collections::HashSet;
                let mut indices = HashSet::new();
                let mut rng_seed = i as u64;
                while indices.len() < sample_size && indices.len() < traces_data.len() - 1 {
                    rng_seed = rng_seed.wrapping_mul(1103515245).wrapping_add(12345);
                    let idx = (rng_seed as usize) % traces_data.len();
                    if idx != i {
                        indices.insert(idx);
                    }
                }
                indices.into_iter().collect()
            } else {
                (0..traces_data.len()).filter(|&j| j != i).collect()
            };

            for j in compare_indices {
                let trace_j = &traces_data[j].1;
                total_amd += compute_amd(trace_i, trace_j);
            }

            if total_amd < best_total_amd {
                best_total_amd = total_amd;
                best_activity_id = activity_id.clone();
            }
        }

        // Update section with new medoid
        if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
            section.representative_activity_id = best_activity_id.clone();

            if old_medoid != best_activity_id {
                log::info!(
                    "tracematch: [Medoid] Section {} medoid changed: {} -> {}",
                    section_id,
                    old_medoid,
                    best_activity_id
                );
            }
        }

        Ok(())
    }


    // ========================================================================
    // Consensus Routes
    // ========================================================================

    /// Get consensus route for a group, with caching.
    pub fn get_consensus_route(&mut self, group_id: &str) -> Option<Vec<GpsPoint>> {
        // Check cache
        if let Some(consensus) = self.consensus_cache.get(&group_id.to_string()) {
            return Some(consensus.clone());
        }

        // Find the group and extract activity IDs (to release the mutable borrow)
        let activity_ids = {
            let groups = self.get_groups();
            let group = groups.iter().find(|g| g.group_id == group_id)?;
            if group.activity_ids.is_empty() {
                return None;
            }
            group.activity_ids.clone()
        };

        // Get tracks for this group (now we can borrow self again)
        let tracks: Vec<Vec<GpsPoint>> = activity_ids
            .iter()
            .filter_map(|id| self.get_gps_track(id))
            .collect();

        if tracks.is_empty() {
            return None;
        }

        // Compute medoid (most representative track)
        let consensus = self.compute_medoid_track(&tracks);

        // Cache result
        self.consensus_cache
            .put(group_id.to_string(), consensus.clone());

        Some(consensus)
    }

    fn compute_medoid_track(&self, tracks: &[Vec<GpsPoint>]) -> Vec<GpsPoint> {
        if tracks.is_empty() {
            return vec![];
        }
        if tracks.len() == 1 {
            return tracks[0].clone();
        }

        // Find track with minimum total distance to all others
        let mut best_idx = 0;
        let mut best_total_dist = f64::MAX;

        for (i, track_i) in tracks.iter().enumerate() {
            let total_dist: f64 = tracks
                .iter()
                .enumerate()
                .filter(|(j, _)| *j != i)
                .map(|(_, track_j)| self.track_distance(track_i, track_j))
                .sum();

            if total_dist < best_total_dist {
                best_total_dist = total_dist;
                best_idx = i;
            }
        }

        tracks[best_idx].clone()
    }

    fn track_distance(&self, track1: &[GpsPoint], track2: &[GpsPoint]) -> f64 {
        if track1.is_empty() || track2.is_empty() {
            return f64::MAX;
        }

        let sample_size = 20.min(track1.len().min(track2.len()));
        let step1 = track1.len() / sample_size;
        let step2 = track2.len() / sample_size;

        let sampled1: Vec<&GpsPoint> = (0..sample_size).map(|i| &track1[i * step1]).collect();
        let sampled2: Vec<&GpsPoint> = (0..sample_size).map(|i| &track2[i * step2]).collect();

        sampled1
            .iter()
            .map(|p1| {
                sampled2
                    .iter()
                    .map(|p2| geo_utils::haversine_distance(p1, p2))
                    .fold(f64::MAX, f64::min)
            })
            .sum::<f64>()
            / sample_size as f64
    }

    // ========================================================================
    // Route Names
    // ========================================================================

    /// Set a custom name for a route.
    /// Pass None to clear the custom name.
    pub fn set_route_name(&mut self, route_id: &str, name: Option<&str>) -> SqlResult<()> {
        match name {
            Some(n) => {
                self.db.execute(
                    "INSERT OR REPLACE INTO route_names (route_id, custom_name) VALUES (?, ?)",
                    params![route_id, n],
                )?;
                // Update in-memory group
                if let Some(group) = self.groups.iter_mut().find(|g| g.group_id == route_id) {
                    group.custom_name = Some(n.to_string());
                }
            }
            None => {
                self.db.execute(
                    "DELETE FROM route_names WHERE route_id = ?",
                    params![route_id],
                )?;
                // Update in-memory group
                if let Some(group) = self.groups.iter_mut().find(|g| g.group_id == route_id) {
                    group.custom_name = None;
                }
            }
        }
        Ok(())
    }

    /// Get the custom name for a route (if any).
    pub fn get_route_name(&self, route_id: &str) -> Option<String> {
        // Check in-memory groups first
        self.groups
            .iter()
            .find(|g| g.group_id == route_id)
            .and_then(|g| g.custom_name.clone())
    }

    /// Get all custom route names.
    pub fn get_all_route_names(&self) -> HashMap<String, String> {
        self.groups
            .iter()
            .filter_map(|g| {
                g.custom_name
                    .as_ref()
                    .map(|n| (g.group_id.clone(), n.clone()))
            })
            .collect()
    }

    // ========================================================================
    // Section Names
    // ========================================================================

    /// Set the name for a section.
    /// Pass None to clear the name.
    pub fn set_section_name(&mut self, section_id: &str, name: Option<&str>) -> SqlResult<()> {
        match name {
            Some(n) => {
                self.db.execute(
                    "UPDATE sections SET name = ? WHERE id = ?",
                    params![n, section_id],
                )?;
                // Update in-memory section
                if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                    section.name = Some(n.to_string());
                }
            }
            None => {
                self.db.execute(
                    "UPDATE sections SET name = NULL WHERE id = ?",
                    params![section_id],
                )?;
                // Update in-memory section
                if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                    section.name = None;
                }
            }
        }
        Ok(())
    }

    /// Get the name for a section (if any).
    pub fn get_section_name(&self, section_id: &str) -> Option<String> {
        // Check in-memory sections first
        self.sections
            .iter()
            .find(|s| s.id == section_id)
            .and_then(|s| s.name.clone())
    }

    /// Get all section names.
    pub fn get_all_section_names(&self) -> HashMap<String, String> {
        self.sections
            .iter()
            .filter_map(|s| s.name.as_ref().map(|n| (s.id.clone(), n.clone())))
            .collect()
    }

    // ========================================================================
    // Activity Metrics & Route Performances
    // ========================================================================

    /// Set activity metrics for performance calculations.
    /// This persists the metrics to the database and keeps them in memory.
    pub fn set_activity_metrics(&mut self, metrics: Vec<ActivityMetrics>) -> SqlResult<()> {
        // Insert or replace in database
        let mut stmt = self.db.prepare(
            "INSERT OR REPLACE INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time,
              elevation_gain, avg_hr, avg_power, sport_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )?;

        for m in &metrics {
            stmt.execute(params![
                &m.activity_id,
                &m.name,
                m.date,
                m.distance,
                m.moving_time,
                m.elapsed_time,
                m.elevation_gain,
                m.avg_hr.map(|v| v as i32),
                m.avg_power.map(|v| v as i32),
                &m.sport_type,
            ])?;
        }

        // Update in-memory cache
        for m in metrics {
            self.activity_metrics.insert(m.activity_id.clone(), m);
        }

        Ok(())
    }

    /// Get activity metrics for a specific activity.
    pub fn get_activity_metrics(&self, activity_id: &str) -> Option<&ActivityMetrics> {
        self.activity_metrics.get(activity_id)
    }

    /// Set time streams for activities from flat buffer.
    /// Time streams are cumulative seconds at each GPS point, used for section performance calculations.
    /// Persists to SQLite for offline access.
    pub fn set_time_streams_flat(
        &mut self,
        activity_ids: &[String],
        all_times: &[u32],
        offsets: &[u32],
    ) {
        let mut persisted_count = 0;
        for (i, activity_id) in activity_ids.iter().enumerate() {
            let start = offsets[i] as usize;
            let end = offsets
                .get(i + 1)
                .map(|&o| o as usize)
                .unwrap_or(all_times.len());
            let times = all_times[start..end].to_vec();

            // Persist to SQLite for offline access
            if self.store_time_stream(activity_id, &times).is_ok() {
                persisted_count += 1;
            }

            // Also keep in memory for fast access
            self.time_streams.insert(activity_id.clone(), times);
        }
        log::debug!(
            "tracematch: [PersistentEngine] Set time streams for {} activities ({} persisted to SQLite)",
            activity_ids.len(),
            persisted_count
        );
    }

    /// Get section performances with accurate time calculations.
    /// Uses time streams to calculate actual traversal times.
    /// Auto-loads time streams from SQLite if not in memory.
    pub fn get_section_performances(&mut self, section_id: &str) -> SectionPerformanceResult {
        // Find the section (both auto-detected and custom are now in unified sections table)
        let section = match self.sections.iter().find(|s| s.id == section_id) {
            Some(s) => s.clone(),
            None => {
                return SectionPerformanceResult {
                    records: vec![],
                    best_record: None,
                    best_forward_record: None,
                    best_reverse_record: None,
                    forward_stats: None,
                    reverse_stats: None,
                };
            }
        };

        // Auto-load time streams from SQLite for all activities in this section
        let activity_ids: Vec<String> = section
            .activity_portions
            .iter()
            .map(|p| p.activity_id.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        for activity_id in &activity_ids {
            self.ensure_time_stream_loaded(activity_id);
        }

        // Group portions by activity
        let mut portions_by_activity: HashMap<&str, Vec<&crate::SectionPortion>> = HashMap::new();
        for portion in &section.activity_portions {
            portions_by_activity
                .entry(&portion.activity_id)
                .or_default()
                .push(portion);
        }

        // Build performance records
        let mut records: Vec<SectionPerformanceRecord> = portions_by_activity
            .iter()
            .filter_map(|(activity_id, portions)| {
                let metrics = self.activity_metrics.get(*activity_id)?;
                let times = self.time_streams.get(*activity_id)?;

                let laps: Vec<SectionLap> = portions
                    .iter()
                    .enumerate()
                    .filter_map(|(i, portion)| {
                        let start_idx = portion.start_index as usize;
                        let end_idx = portion.end_index as usize;

                        if start_idx >= times.len() || end_idx >= times.len() {
                            return None;
                        }

                        let lap_time = (times[end_idx] as f64 - times[start_idx] as f64).abs();
                        if lap_time <= 0.0 {
                            return None;
                        }

                        let pace = portion.distance_meters / lap_time;

                        Some(SectionLap {
                            id: format!("{}_lap{}", activity_id, i),
                            activity_id: activity_id.to_string(),
                            time: lap_time,
                            pace,
                            distance: portion.distance_meters,
                            direction: portion.direction.clone(),
                            start_index: portion.start_index,
                            end_index: portion.end_index,
                        })
                    })
                    .collect();

                if laps.is_empty() {
                    return None;
                }

                let lap_count = laps.len() as u32;
                let best_time = laps
                    .iter()
                    .map(|l| l.time)
                    .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                    .unwrap_or(0.0);
                let best_pace = laps
                    .iter()
                    .map(|l| l.pace)
                    .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                    .unwrap_or(0.0);
                let avg_time = laps.iter().map(|l| l.time).sum::<f64>() / lap_count as f64;
                let avg_pace = laps.iter().map(|l| l.pace).sum::<f64>() / lap_count as f64;
                let direction = laps
                    .first()
                    .map(|l| l.direction.clone())
                    .unwrap_or_else(|| "same".to_string());
                let section_distance = section.distance_meters;

                Some(SectionPerformanceRecord {
                    activity_id: activity_id.to_string(),
                    activity_name: metrics.name.clone(),
                    activity_date: metrics.date,
                    laps,
                    lap_count,
                    best_time,
                    best_pace,
                    avg_time,
                    avg_pace,
                    direction,
                    section_distance,
                })
            })
            .collect();

        // Sort by date
        records.sort_by_key(|r| r.activity_date);

        // Find best record (fastest time) - overall
        let best_record = records
            .iter()
            .min_by(|a, b| {
                a.best_time
                    .partial_cmp(&b.best_time)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Find best forward record (direction is "same" or "forward")
        let best_forward_record = records
            .iter()
            .filter(|r| r.direction == "same" || r.direction == "forward")
            .min_by(|a, b| {
                a.best_time
                    .partial_cmp(&b.best_time)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Find best reverse record
        let best_reverse_record = records
            .iter()
            .filter(|r| r.direction == "reverse" || r.direction == "backward")
            .min_by(|a, b| {
                a.best_time
                    .partial_cmp(&b.best_time)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Compute forward direction stats
        let forward_records: Vec<_> = records
            .iter()
            .filter(|r| r.direction == "same" || r.direction == "forward")
            .collect();
        let forward_stats = if forward_records.is_empty() {
            None
        } else {
            let count = forward_records.len() as u32;
            let avg_time = forward_records.iter().map(|r| r.best_time).sum::<f64>() / count as f64;
            let last_activity = forward_records
                .iter()
                .max_by(|a, b| a.activity_date.cmp(&b.activity_date))
                .map(|r| r.activity_date);
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity,
                count,
            })
        };

        // Compute reverse direction stats
        let reverse_records: Vec<_> = records
            .iter()
            .filter(|r| r.direction == "reverse" || r.direction == "backward")
            .collect();
        let reverse_stats = if reverse_records.is_empty() {
            None
        } else {
            let count = reverse_records.len() as u32;
            let avg_time = reverse_records.iter().map(|r| r.best_time).sum::<f64>() / count as f64;
            let last_activity = reverse_records
                .iter()
                .max_by(|a, b| a.activity_date.cmp(&b.activity_date))
                .map(|r| r.activity_date);
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity,
                count,
            })
        };

        SectionPerformanceResult {
            records,
            best_record,
            best_forward_record,
            best_reverse_record,
            forward_stats,
            reverse_stats,
        }
    }

    /// Get route performances for all activities in a group.
    /// Uses stored activity_matches for match percentages instead of hardcoding 100%.
    pub fn get_route_performances(
        &self,
        route_group_id: &str,
        current_activity_id: Option<&str>,
    ) -> RoutePerformanceResult {
        // Find the group
        let group = match self.groups.iter().find(|g| g.group_id == route_group_id) {
            Some(g) => g,
            None => {
                log::debug!(
                    "tracematch: get_route_performances: group {} not found",
                    route_group_id
                );
                return RoutePerformanceResult {
                    performances: vec![],
                    best: None,
                    best_forward: None,
                    best_reverse: None,
                    forward_stats: None,
                    reverse_stats: None,
                    current_rank: None,
                };
            }
        };

        // Get match info for this route
        let match_info = self.activity_matches.get(route_group_id);
        log::debug!(
            "tracematch: get_route_performances: group {} has {} activities, match_info: {}",
            route_group_id,
            group.activity_ids.len(),
            match_info.map(|m| m.len()).unwrap_or(0)
        );

        // Build performances from metrics
        let mut performances: Vec<RoutePerformance> = group
            .activity_ids
            .iter()
            .filter_map(|id| {
                let metrics = self.activity_metrics.get(id)?;
                let speed = if metrics.moving_time > 0 {
                    metrics.distance / metrics.moving_time as f64
                } else {
                    0.0
                };

                // Look up match info for this activity (optional - may not exist for old data)
                let match_data =
                    match_info.and_then(|matches| matches.iter().find(|m| m.activity_id == *id));
                let match_percentage = match_data.map(|m| m.match_percentage);
                let direction = match_data
                    .map(|m| m.direction.clone())
                    .unwrap_or_else(|| "same".to_string());

                Some(RoutePerformance {
                    activity_id: id.clone(),
                    name: metrics.name.clone(),
                    date: metrics.date,
                    speed,
                    duration: metrics.elapsed_time,
                    moving_time: metrics.moving_time,
                    distance: metrics.distance,
                    elevation_gain: metrics.elevation_gain,
                    avg_hr: metrics.avg_hr,
                    avg_power: metrics.avg_power,
                    is_current: current_activity_id == Some(id.as_str()),
                    direction,
                    match_percentage,
                })
            })
            .collect();

        // Sort by date (oldest first for charting)
        performances.sort_by_key(|p| p.date);

        // Find best (fastest speed) - overall
        let best = performances
            .iter()
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Find best forward (direction is "same" or "forward")
        let best_forward = performances
            .iter()
            .filter(|p| p.direction == "same" || p.direction == "forward")
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Find best reverse
        let best_reverse = performances
            .iter()
            .filter(|p| p.direction == "reverse" || p.direction == "backward")
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Calculate current rank (1 = fastest)
        let current_rank = current_activity_id.and_then(|current_id| {
            let mut by_speed = performances.clone();
            by_speed.sort_by(|a, b| {
                b.speed
                    .partial_cmp(&a.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            by_speed
                .iter()
                .position(|p| p.activity_id == current_id)
                .map(|idx| (idx + 1) as u32)
        });

        // Compute forward direction stats
        let forward_perfs: Vec<_> = performances
            .iter()
            .filter(|p| p.direction == "same" || p.direction == "forward")
            .collect();
        let forward_stats = if forward_perfs.is_empty() {
            None
        } else {
            let count = forward_perfs.len() as u32;
            let avg_time =
                forward_perfs.iter().map(|p| p.duration as f64).sum::<f64>() / count as f64;
            let last_activity = forward_perfs.iter().max_by_key(|p| p.date).map(|p| p.date);
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity,
                count,
            })
        };

        // Compute reverse direction stats
        let reverse_perfs: Vec<_> = performances
            .iter()
            .filter(|p| p.direction == "reverse" || p.direction == "backward")
            .collect();
        let reverse_stats = if reverse_perfs.is_empty() {
            None
        } else {
            let count = reverse_perfs.len() as u32;
            let avg_time =
                reverse_perfs.iter().map(|p| p.duration as f64).sum::<f64>() / count as f64;
            let last_activity = reverse_perfs.iter().max_by_key(|p| p.date).map(|p| p.date);
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity,
                count,
            })
        };

        RoutePerformanceResult {
            performances,
            best,
            best_forward,
            best_reverse,
            forward_stats,
            reverse_stats,
            current_rank,
        }
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


use std::sync::Mutex;


use once_cell::sync::Lazy;

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

    /// Set the name for a section.
    /// Pass empty string to clear the name.
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

    /// Get the name for a section.
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

    // ========================================================================
    // Non-JSON FFI Functions (Clean FFI Boundary)
    // ========================================================================

    /// Get all custom route names.
    /// Returns a HashMap instead of JSON string.
    #[uniffi::export]
    pub fn persistent_engine_get_all_route_names() -> std::collections::HashMap<String, String> {
        with_persistent_engine(|e| e.get_all_route_names()).unwrap_or_default()
    }

    /// Get all section names.
    /// Returns a HashMap instead of JSON string.
    #[uniffi::export]
    pub fn persistent_engine_get_all_section_names() -> std::collections::HashMap<String, String> {
        with_persistent_engine(|e| e.get_all_section_names()).unwrap_or_default()
    }

    /// Get section performances.
    /// Returns structured data instead of JSON string.
    #[uniffi::export]
    pub fn persistent_engine_get_section_performances(
        section_id: String,
    ) -> crate::FfiSectionPerformanceResult {
        with_persistent_engine(|e| {
            crate::FfiSectionPerformanceResult::from(e.get_section_performances(&section_id))
        })
        .unwrap_or_else(|| crate::FfiSectionPerformanceResult {
            records: vec![],
            best_record: None,
            best_forward_record: None,
            best_reverse_record: None,
            forward_stats: None,
            reverse_stats: None,
        })
    }

    /// Get route performances.
    /// Returns structured data instead of JSON string.
    #[uniffi::export]
    pub fn persistent_engine_get_route_performances(
        route_group_id: String,
        current_activity_id: Option<String>,
    ) -> crate::FfiRoutePerformanceResult {
        with_persistent_engine(|e| {
            // Ensure groups are recomputed if dirty (this populates activity_matches)
            let _ = e.get_groups();
            crate::FfiRoutePerformanceResult::from(
                e.get_route_performances(&route_group_id, current_activity_id.as_deref()),
            )
        })
        .unwrap_or_else(|| crate::FfiRoutePerformanceResult {
            performances: vec![],
            best: None,
            best_forward: None,
            best_reverse: None,
            forward_stats: None,
            reverse_stats: None,
            current_rank: None,
        })
    }

    /// Get section count directly from SQLite (no data loading).
    #[uniffi::export]
    pub fn persistent_engine_get_section_count() -> u32 {
        with_persistent_engine(|e| e.get_section_count()).unwrap_or(0)
    }

    /// Get group count directly from SQLite (no data loading).
    #[uniffi::export]
    pub fn persistent_engine_get_group_count() -> u32 {
        with_persistent_engine(|e| e.get_group_count()).unwrap_or(0)
    }

    /// Get lightweight section summaries without polyline data.
    #[uniffi::export]
    pub fn persistent_engine_get_section_summaries() -> Vec<SectionSummary> {
        with_persistent_engine(|e| e.get_section_summaries()).unwrap_or_default()
    }

    /// Get section summaries filtered by sport type.
    #[uniffi::export]
    pub fn persistent_engine_get_section_summaries_for_sport(sport_type: String) -> Vec<SectionSummary> {
        with_persistent_engine(|e| e.get_section_summaries_for_sport(&sport_type)).unwrap_or_default()
    }

    /// Get lightweight group summaries without full activity ID lists.
    #[uniffi::export]
    pub fn persistent_engine_get_group_summaries() -> Vec<GroupSummary> {
        with_persistent_engine(|e| e.get_group_summaries()).unwrap_or_default()
    }

    /// Get all sections with full data (including polylines).
    #[uniffi::export]
    pub fn persistent_engine_get_sections() -> Vec<crate::FfiFrequentSection> {
        with_persistent_engine(|e| {
            e.get_sections()
                .iter()
                .cloned()
                .map(crate::FfiFrequentSection::from)
                .collect()
        })
        .unwrap_or_default()
    }

    /// Get all route groups.
    #[uniffi::export]
    pub fn persistent_engine_get_groups() -> Vec<crate::FfiRouteGroup> {
        with_persistent_engine(|e| {
            e.get_groups()
                .iter()
                .cloned()
                .map(crate::FfiRouteGroup::from)
                .collect()
        })
        .unwrap_or_default()
    }

    /// Get a single section by ID (full data with polyline).
    #[uniffi::export]
    pub fn persistent_engine_get_section_by_id(section_id: String) -> Option<crate::FfiFrequentSection> {
        with_persistent_engine(|e| {
            e.get_section_by_id(&section_id).map(crate::FfiFrequentSection::from)
        })
        .flatten()
    }

    /// Get a single group by ID (full data with activity IDs).
    #[uniffi::export]
    pub fn persistent_engine_get_group_by_id(group_id: String) -> Option<crate::FfiRouteGroup> {
        with_persistent_engine(|e| {
            e.get_group_by_id(&group_id).map(crate::FfiRouteGroup::from)
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

}
