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
use std::thread;

#[cfg(feature = "persistence")]
use rusqlite::{params, Connection, Result as SqlResult};

#[cfg(feature = "persistence")]
use rstar::{RTree, RTreeObject, AABB};

#[cfg(feature = "persistence")]
use crate::{
    geo_utils, Bounds, FrequentSection, GpsPoint, MatchConfig, RouteGroup, RouteSignature,
    SectionConfig, ActivityMatchInfo, ActivityMetrics, RoutePerformance, RoutePerformanceResult,
};

#[cfg(feature = "persistence")]
use crate::lru_cache::LruCache;

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

/// Handle for background section detection.
#[cfg(feature = "persistence")]
pub struct SectionDetectionHandle {
    receiver: mpsc::Receiver<Vec<FrequentSection>>,
}

#[cfg(feature = "persistence")]
impl SectionDetectionHandle {
    /// Check if detection is complete (non-blocking).
    pub fn try_recv(&self) -> Option<Vec<FrequentSection>> {
        self.receiver.try_recv().ok()
    }

    /// Wait for detection to complete (blocking).
    pub fn recv(self) -> Option<Vec<FrequentSection>> {
        self.receiver.recv().ok()
    }
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

    /// Cached route groups (loaded from DB)
    groups: Vec<RouteGroup>,

    /// Per-activity match info: route_id -> Vec<ActivityMatchInfo>
    activity_matches: HashMap<String, Vec<ActivityMatchInfo>>,

    /// Activity metrics for performance calculations
    activity_metrics: HashMap<String, ActivityMetrics>,

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
            signature_cache: LruCache::new(200),
            consensus_cache: LruCache::new(50),
            groups: Vec::new(),
            activity_matches: HashMap::new(),
            activity_metrics: HashMap::new(),
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
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
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

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities(sport_type);
            CREATE INDEX IF NOT EXISTS idx_activities_bounds ON activities(min_lat, max_lat, min_lng, max_lng);
            CREATE INDEX IF NOT EXISTS idx_groups_sport ON route_groups(sport_type);
            CREATE INDEX IF NOT EXISTS idx_activity_matches_route ON activity_matches(route_id);

            -- Enable foreign keys
            PRAGMA foreign_keys = ON;
        "#,
        )?;
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

        let mut stmt = self.db.prepare(
            "SELECT id, sport_type, min_lat, max_lat, min_lng, max_lng FROM activities",
        )?;

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

                    let bounds = if let (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) = (
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
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
        }

        // Load custom names and apply to groups
        self.load_route_names()?;

        // Load activity matches
        self.load_activity_matches()?;

        self.groups_dirty = false;
        Ok(())
    }

    /// Load activity match info from the database.
    fn load_activity_matches(&mut self) -> SqlResult<()> {
        self.activity_matches.clear();

        let mut stmt = self.db.prepare(
            "SELECT route_id, activity_id, match_percentage, direction FROM activity_matches"
        )?;

        let matches: Vec<(String, ActivityMatchInfo)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ActivityMatchInfo {
                        activity_id: row.get(1)?,
                        match_percentage: row.get(2)?,
                        direction: row.get(3)?,
                    }
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Group by route_id
        for (route_id, match_info) in matches {
            self.activity_matches
                .entry(route_id)
                .or_insert_with(Vec::new)
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
             FROM activity_metrics"
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

        for metrics in metrics_iter {
            if let Ok(m) = metrics {
                self.activity_metrics.insert(m.activity_id.clone(), m);
            }
        }

        Ok(())
    }

    /// Load custom route names and apply them to groups.
    fn load_route_names(&mut self) -> SqlResult<()> {
        let mut stmt = self.db.prepare("SELECT route_id, custom_name FROM route_names")?;

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

        let mut stmt = self.db.prepare("SELECT data FROM sections")?;

        self.sections = stmt
            .query_map([], |row| {
                let data_blob: Vec<u8> = row.get(0)?;
                let section: FrequentSection =
                    serde_json::from_slice(&data_blob).unwrap_or_else(|_| {
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
                        }
                    });
                Ok(section)
            })?
            .filter_map(|r| r.ok())
            .filter(|s: &FrequentSection| !s.id.is_empty()) // Filter out empty sections
            .collect();

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
            self.signature_cache.insert(id.clone(), sig.clone());
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
        self.signature_cache.invalidate(&id.to_string());
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
             DELETE FROM activities;",
        )?;

        self.activity_metadata.clear();
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
    /// # use route_matcher::persistence::PersistentRouteEngine;
    /// # let mut engine = unsafe { std::mem::zeroed() };
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
            log::info!("[PersistentEngine] Cleanup skipped: retention period is 0 (keep all)");
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
                "[PersistentEngine] Cleaned up {} activities older than {} days",
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
    /// # use route_matcher::persistence::PersistentRouteEngine;
    /// # let mut engine = unsafe { std::mem::zeroed() };
    /// // User expanded cache from 90 days to 1 year
    /// engine.mark_for_recomputation();
    /// // Next access to groups/sections will re-compute with improved data
    /// let groups = engine.get_groups();
    /// ```
    pub fn mark_for_recomputation(&mut self) {
        if !self.groups_dirty && !self.sections_dirty {
            self.groups_dirty = true;
            self.sections_dirty = true;
            log::info!("[PersistentEngine] Marked for re-computation (cache expanded)");
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

    /// Get all activity bounds info as JSON for map display.
    /// Returns array of { id, bounds, activity_type, distance }.
    pub fn get_all_activity_bounds_json(&self) -> String {
        #[derive(serde::Serialize)]
        struct BoundsInfo {
            id: String,
            bounds: [[f64; 2]; 2], // [[minLat, minLng], [maxLat, maxLng]]
            activity_type: String,
            distance: f64,
        }

        let infos: Vec<BoundsInfo> = self
            .activity_metadata
            .values()
            .map(|m| {
                // Get distance from metrics if available, otherwise 0
                let distance = self
                    .activity_metrics
                    .get(&m.id)
                    .map(|metrics| metrics.distance)
                    .unwrap_or(0.0);

                BoundsInfo {
                    id: m.id.clone(),
                    bounds: [
                        [m.bounds.min_lat, m.bounds.min_lng],
                        [m.bounds.max_lat, m.bounds.max_lng],
                    ],
                    activity_type: m.sport_type.clone(),
                    distance,
                }
            })
            .collect();

        serde_json::to_string(&infos).unwrap_or_else(|_| "[]".to_string())
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

    /// Get a signature, loading from DB if not cached.
    pub fn get_signature(&mut self, id: &str) -> Option<RouteSignature> {
        // Check cache first
        if let Some(sig) = self.signature_cache.get_cloned(&id.to_string()) {
            return Some(sig);
        }

        // Load from database
        let sig = self.load_signature_from_db(id)?;
        self.signature_cache.insert(id.to_string(), sig.clone());
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
            let points: Vec<GpsPoint> =
                rmp_serde::from_slice(&points_blob).unwrap_or_default();
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
        // Load all signatures (this will use cache where possible)
        let activity_ids: Vec<String> = self.activity_metadata.keys().cloned().collect();
        let mut signatures = Vec::with_capacity(activity_ids.len());

        for id in &activity_ids {
            if let Some(sig) = self.get_signature(id) {
                signatures.push(sig);
            }
        }

        // Group signatures and capture match info
        #[cfg(feature = "parallel")]
        let result = crate::group_signatures_parallel_with_matches(&signatures, &self.match_config);

        #[cfg(not(feature = "parallel"))]
        let result = crate::group_signatures_with_matches(&signatures, &self.match_config);

        self.groups = result.groups;
        self.activity_matches = result.activity_matches;

        // Populate sport_type for each group from the representative activity
        for group in &mut self.groups {
            if let Some(meta) = self.activity_metadata.get(&group.representative_id) {
                group.sport_type = meta.sport_type.clone();
            }
        }

        // Save to database
        self.save_groups().ok();
        self.groups_dirty = false;
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

    /// Get sections as JSON string.
    pub fn get_sections_json(&self) -> String {
        serde_json::to_string(&self.sections).unwrap_or_else(|_| "[]".to_string())
    }

    /// Start section detection in a background thread.
    ///
    /// Returns a handle that can be polled for completion.
    pub fn detect_sections_background(
        &mut self,
        sport_filter: Option<String>,
    ) -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        let db_path = self.db_path.clone();
        let section_config = self.section_config.clone();

        // Get groups first (may trigger recomputation)
        let groups = self.get_groups().to_vec();

        // Build sport type map
        let sport_map: HashMap<String, String> = self
            .activity_metadata
            .values()
            .map(|m| (m.id.clone(), m.sport_type.clone()))
            .collect();

        // Filter activity IDs by sport
        let activity_ids: Vec<String> = if let Some(ref sport) = sport_filter {
            self.activity_metadata
                .values()
                .filter(|m| &m.sport_type == sport)
                .map(|m| m.id.clone())
                .collect()
        } else {
            self.activity_metadata.keys().cloned().collect()
        };

        thread::spawn(move || {
            // Open separate connection for background thread
            let conn = match Connection::open(&db_path) {
                Ok(c) => c,
                Err(_) => {
                    tx.send(Vec::new()).ok();
                    return;
                }
            };

            // Load GPS tracks from DB
            let tracks: Vec<(String, Vec<GpsPoint>)> = activity_ids
                .iter()
                .filter_map(|id| {
                    let mut stmt = conn
                        .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
                        .ok()?;
                    let track: Vec<GpsPoint> = stmt
                        .query_row(params![id], |row| {
                            let blob: Vec<u8> = row.get(0)?;
                            Ok(rmp_serde::from_slice(&blob).unwrap_or_default())
                        })
                        .ok()?;
                    Some((id.clone(), track))
                })
                .collect();

            // Detect sections
            let sections =
                crate::sections::detect_sections_from_tracks(&tracks, &sport_map, &groups, &section_config);

            tx.send(sections).ok();
        });

        SectionDetectionHandle { receiver: rx }
    }

    /// Apply completed section detection results.
    pub fn apply_sections(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        self.sections = sections;
        self.save_sections()?;
        self.sections_dirty = false;
        Ok(())
    }

    fn save_sections(&self) -> SqlResult<()> {
        // Clear existing
        self.db.execute("DELETE FROM sections", [])?;

        // Insert new (serialize entire section as JSON)
        let mut stmt = self.db.prepare("INSERT INTO sections (id, data) VALUES (?, ?)")?;

        for section in &self.sections {
            let data_blob = serde_json::to_vec(section).unwrap_or_default();
            stmt.execute(params![section.id, data_blob])?;
        }

        Ok(())
    }

    // ========================================================================
    // Consensus Routes
    // ========================================================================

    /// Get consensus route for a group, with caching.
    pub fn get_consensus_route(&mut self, group_id: &str) -> Option<Vec<GpsPoint>> {
        // Check cache
        if let Some(consensus) = self.consensus_cache.get_cloned(&group_id.to_string()) {
            return Some(consensus);
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
            .insert(group_id.to_string(), consensus.clone());

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
            .filter_map(|g| g.custom_name.as_ref().map(|n| (g.group_id.clone(), n.clone())))
            .collect()
    }

    // ========================================================================
    // Section Names
    // ========================================================================

    /// Set a custom name for a section.
    /// Pass None to clear the custom name.
    pub fn set_section_name(&mut self, section_id: &str, name: Option<&str>) -> SqlResult<()> {
        match name {
            Some(n) => {
                self.db.execute(
                    "INSERT OR REPLACE INTO section_names (section_id, custom_name) VALUES (?, ?)",
                    params![section_id, n],
                )?;
                // Update in-memory section
                if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                    section.name = Some(n.to_string());
                }
            }
            None => {
                self.db.execute(
                    "DELETE FROM section_names WHERE section_id = ?",
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

    /// Get the custom name for a section (if any).
    pub fn get_section_name(&self, section_id: &str) -> Option<String> {
        // Check in-memory sections first
        self.sections
            .iter()
            .find(|s| s.id == section_id)
            .and_then(|s| s.name.clone())
    }

    /// Get all custom section names.
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
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
            None => return RoutePerformanceResult {
                performances: vec![],
                best: None,
                current_rank: None,
            },
        };

        // Get match info for this route
        let match_info = self.activity_matches.get(route_group_id);

        // Build performances from metrics
        let mut performances: Vec<RoutePerformance> = group.activity_ids
            .iter()
            .filter_map(|id| {
                let metrics = self.activity_metrics.get(id)?;
                let speed = if metrics.moving_time > 0 {
                    metrics.distance / metrics.moving_time as f64
                } else {
                    0.0
                };

                // Look up match info for this activity
                let (match_percentage, direction) = match_info
                    .and_then(|matches| matches.iter().find(|m| m.activity_id == *id))
                    .map(|m| (m.match_percentage, m.direction.clone()))
                    .unwrap_or((100.0, "same".to_string()));

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

        // Find best (fastest speed)
        let best = performances.iter().max_by(|a, b| {
            a.speed.partial_cmp(&b.speed).unwrap_or(std::cmp::Ordering::Equal)
        }).cloned();

        // Calculate current rank (1 = fastest)
        let current_rank = current_activity_id.and_then(|current_id| {
            let mut by_speed = performances.clone();
            by_speed.sort_by(|a, b| {
                b.speed.partial_cmp(&a.speed).unwrap_or(std::cmp::Ordering::Equal)
            });
            by_speed.iter().position(|p| p.activity_id == current_id)
                .map(|idx| (idx + 1) as u32)
        });

        RoutePerformanceResult {
            performances,
            best,
            current_rank,
        }
    }

    /// Get route performances as JSON string.
    pub fn get_route_performances_json(
        &self,
        route_group_id: &str,
        current_activity_id: Option<&str>,
    ) -> String {
        let result = self.get_route_performances(route_group_id, current_activity_id);
        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
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
        PersistentEngineStats {
            activity_count: self.activity_metadata.len() as u32,
            signature_cache_size: self.signature_cache.len() as u32,
            consensus_cache_size: self.consensus_cache.len() as u32,
            group_count: self.groups.len() as u32,
            section_count: self.sections.len() as u32,
            groups_dirty: self.groups_dirty,
            sections_dirty: self.sections_dirty,
        }
    }
}

/// Statistics for the persistent engine.
#[cfg(feature = "persistence")]
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PersistentEngineStats {
    pub activity_count: u32,
    pub signature_cache_size: u32,
    pub consensus_cache_size: u32,
    pub group_count: u32,
    pub section_count: u32,
    pub groups_dirty: bool,
    pub sections_dirty: bool,
}

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
        info!("[PersistentEngine] Initializing with db: {}", db_path);

        match PersistentRouteEngine::new(&db_path) {
            Ok(mut engine) => {
                // Load existing data
                if let Err(e) = engine.load() {
                    info!("[PersistentEngine] Warning: Failed to load existing data: {:?}", e);
                }

                let mut guard = PERSISTENT_ENGINE.lock().unwrap();
                *guard = Some(engine);
                info!("[PersistentEngine] Initialized successfully");
                true
            }
            Err(e) => {
                info!("[PersistentEngine] Failed to initialize: {:?}", e);
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
            info!("[PersistentEngine] Cleared");
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
        with_persistent_engine(|e| {
            match e.cleanup_old_activities(retention_days) {
                Ok(count) => {
                    if retention_days > 0 && count > 0 {
                        info!(
                            "[PersistentEngine] Cleanup completed: {} activities removed",
                            count
                        );
                    }
                    count
                }
                Err(e) => {
                    log::error!("[PersistentEngine] Cleanup failed: {:?}", e);
                    0
                }
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
            info!("[PersistentEngine] Marked for re-computation");
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
            "[PersistentEngine] Adding {} activities ({} coords)",
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
        info!("[PersistentEngine] Removing {} activities", activity_ids.len());
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
        let name_opt = if name.is_empty() { None } else { Some(name.as_str()) };
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
        with_persistent_engine(|e| serde_json::to_string(&e.get_all_route_names()).unwrap_or_else(|_| "{}".to_string()))
            .unwrap_or_else(|| "{}".to_string())
    }

    /// Set a custom name for a section.
    /// Pass empty string to clear the custom name.
    #[uniffi::export]
    pub fn persistent_engine_set_section_name(section_id: String, name: String) {
        let name_opt = if name.is_empty() { None } else { Some(name.as_str()) };
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
        with_persistent_engine(|e| serde_json::to_string(&e.get_all_section_names()).unwrap_or_else(|_| "{}".to_string()))
            .unwrap_or_else(|| "{}".to_string())
    }

    /// Set activity metrics for performance calculations.
    #[uniffi::export]
    pub fn persistent_engine_set_activity_metrics(metrics: Vec<ActivityMetrics>) {
        with_persistent_engine(|e| {
            e.set_activity_metrics(metrics).ok();
        });
    }

    /// Get route performances as JSON.
    #[uniffi::export]
    pub fn persistent_engine_get_route_performances_json(
        route_group_id: String,
        current_activity_id: Option<String>,
    ) -> String {
        with_persistent_engine(|e| {
            e.get_route_performances_json(&route_group_id, current_activity_id.as_deref())
        })
        .unwrap_or_else(|| "{}".to_string())
    }

    /// Get sections as JSON.
    #[uniffi::export]
    pub fn persistent_engine_get_sections_json() -> String {
        with_persistent_engine(|e| e.get_sections_json()).unwrap_or_else(|| "[]".to_string())
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
                info!("[PersistentEngine] Section detection already running");
                return false;
            }
        }

        // Start detection
        let handle = with_persistent_engine(|e| e.detect_sections_background(sport_filter));

        if let Some(h) = handle {
            let mut handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();
            *handle_guard = Some(h);
            info!("[PersistentEngine] Section detection started");
            true
        } else {
            info!("[PersistentEngine] Failed to start section detection");
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
                let applied = with_persistent_engine(|e| {
                    e.apply_sections(sections).ok()
                });

                // Clear the handle
                *handle_guard = None;

                if applied.is_some() {
                    info!("[PersistentEngine] Section detection complete");
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

    /// Cancel any running section detection.
    #[uniffi::export]
    pub fn persistent_engine_cancel_section_detection() {
        let mut handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();
        if handle_guard.is_some() {
            *handle_guard = None;
            info!("[PersistentEngine] Section detection cancelled");
        }
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
}
