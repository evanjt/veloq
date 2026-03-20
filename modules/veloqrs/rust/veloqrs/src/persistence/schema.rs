//! Schema management: migrations, version tracking, and data population.

use std::collections::{HashMap, HashSet};
use rusqlite::{Connection, Result as SqlResult, params};
use rusqlite_migration::{Migrations, M};
use crate::GpsPoint;

use super::PersistentRouteEngine;

impl PersistentRouteEngine {
    /// Current schema version for app-level tracking.
    /// This is separate from rusqlite_migration and tracks the overall schema state.
    pub(super) const SCHEMA_VERSION: i32 = 12; // v0.3.0 schema (route activity exclusion)

    /// Get the database migrations.
    /// Each migration is applied in order, tracked in `__rusqlite_migrations` table.
    pub(super) fn migrations() -> Migrations<'static> {
        Migrations::new(vec![
            // M1: Initial schema (uses IF NOT EXISTS for compatibility with pre-migration databases)
            M::up(include_str!("../migrations/001_initial_schema.sql")),
            // M2: Unified sections table (migrates blob-based sections to column-based)
            M::up(include_str!("../migrations/002_unified_sections.sql")),
            // M3: Drop legacy section_names table (names now in sections.name column)
            M::up(include_str!("../migrations/003_drop_section_names.sql")),
            // M4: Extend activity_metrics with training_load, ftp, zone times for aggregation
            M::up(include_str!("../migrations/004_extend_activity_metrics.sql")),
            // M5: Athlete profile and sport settings cache tables
            M::up(include_str!("../migrations/005_profile_and_settings.sql")),
            // M6: Processed activities tracking for incremental section detection
            M::up(include_str!("../migrations/006_processed_activities.sql")),
            // M7: Cache section performance metrics (lap_time, lap_pace) in section_activities
            M::up(include_str!("../migrations/007_cache_section_performances.sql")),
            // M8: Cache all performance metrics (zone sums, FTP history, heatmap intensity)
            M::up(include_str!("../migrations/008_cache_all_performance_metrics.sql")),
            // M9: Cache section bounding boxes as columns (avoid JSON polyline deserialization)
            M::up(include_str!("../migrations/009_section_bounds_cache.sql")),
            // M10: Cache activity_count on route_groups (avoid JSON parsing for count)
            M::up(include_str!("../migrations/010_route_groups_activity_count.sql")),
            // M11: Pace history cache for running/swimming trend tracking
            M::up(include_str!("../migrations/011_pace_history.sql")),
            // M12: Original polyline backup for section bounds trimming
            M::up(include_str!("../migrations/012_section_original_polyline.sql")),
            // M13: Force re-detection with improved lap splitting algorithm
            M::up(include_str!("../migrations/013_redetect_section_portions.sql")),
            // M14: Force re-detection to clean cross-sport activity associations
            M::up(include_str!("../migrations/014_redetect_cross_sport_fix.sql")),
            // M15: Add excluded flag to section_activities for hiding outlier activities
            M::up(include_str!("../migrations/015_section_activity_excluded.sql")),
            // M16: Add excluded flag to activity_matches for hiding outlier route activities
            M::up(include_str!("../migrations/016_route_activity_excluded.sql")),
        ])
    }

    /// Initialize the database schema using migrations.
    pub(super) fn init_schema(conn: &mut Connection) -> SqlResult<()> {
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

        // Post-migration: populate performance cache if migrating from v2 to v3
        if current_version < 3 && Self::SCHEMA_VERSION >= 3 {
            let needs_population: i64 = conn.query_row(
                "SELECT COUNT(*) FROM section_activities WHERE lap_time IS NULL",
                [],
                |row| row.get(0),
            )?;

            if needs_population > 0 {
                log::info!(
                    "tracematch: [Migration] Populating performance cache for {} section portions...",
                    needs_population
                );
                Self::populate_performance_cache(conn)?;
                log::info!("tracematch: [Migration] Performance cache population complete");
            }
        }

        // Post-migration: populate all performance caches if migrating from v3 to v4
        if current_version < 4 && Self::SCHEMA_VERSION >= 4 {
            log::info!("tracematch: [Migration] Migrating from v3 to v4...");
            Self::populate_all_performance_caches(conn)?;
        }

        // Post-migration: populate section bounds columns if migrating to v5
        if current_version < 5 && Self::SCHEMA_VERSION >= 5 {
            Self::populate_section_bounds(conn)?;
        }

        // Post-migration: backfill activity_count on route_groups if migrating to v6
        if current_version < 6 && Self::SCHEMA_VERSION >= 6 {
            Self::populate_route_group_counts(conn)?;
        }

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
                 direction TEXT NOT NULL DEFAULT 'same',
                 start_index INTEGER NOT NULL DEFAULT 0,
                 end_index INTEGER NOT NULL DEFAULT 0,
                 distance_meters REAL NOT NULL DEFAULT 0,
                 PRIMARY KEY (section_id, activity_id, start_index)
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

            // Migrate activity associations (with default portion values for legacy data)
            for activity_id in activity_ids {
                conn.execute(
                    "INSERT OR IGNORE INTO section_activities_new (section_id, activity_id, direction, start_index, end_index, distance_meters) VALUES (?, ?, 'same', 0, 0, 0)",
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

    /// Populate performance cache for all existing section portions.
    /// Called during migration from schema v2 to v3.
    fn populate_performance_cache(conn: &Connection) -> SqlResult<()> {
        // Get all unique section IDs that need population
        let section_ids: Vec<String> = conn
            .prepare("SELECT DISTINCT section_id FROM section_activities WHERE lap_time IS NULL")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;

        let total_sections = section_ids.len();
        log::info!(
            "tracematch: [Migration] Found {} sections needing performance cache population",
            total_sections
        );

        let mut total_portions = 0;
        let mut populated_portions = 0;

        for (section_idx, section_id) in section_ids.iter().enumerate() {
            if section_idx % 10 == 0 && section_idx > 0 {
                log::info!(
                    "tracematch: [Migration] Progress: {}/{} sections, {} portions populated",
                    section_idx,
                    total_sections,
                    populated_portions
                );
            }

            // Get all portions for this section that need population
            let portions: Vec<(String, u32, u32, f64)> = conn
                .prepare(
                    "SELECT activity_id, start_index, end_index, distance_meters
                     FROM section_activities
                     WHERE section_id = ? AND lap_time IS NULL"
                )?
                .query_map([section_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            total_portions += portions.len();

            // Load time streams for all activities in this section
            let activity_ids: HashSet<String> = portions
                .iter()
                .map(|(id, _, _, _)| id.clone())
                .collect();

            let mut time_streams: HashMap<String, Vec<u32>> = HashMap::new();
            for activity_id in &activity_ids {
                if let Ok(stream) = conn.query_row(
                    "SELECT times FROM time_streams WHERE activity_id = ?",
                    [activity_id],
                    |row| {
                        let bytes: Vec<u8> = row.get(0)?;
                        let times: Vec<u32> = rmp_serde::from_slice(&bytes)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?;
                        Ok(times)
                    },
                ) {
                    time_streams.insert(activity_id.clone(), stream);
                }
            }

            // Calculate and update each portion
            let mut update_stmt = conn.prepare(
                "UPDATE section_activities
                 SET lap_time = ?, lap_pace = ?
                 WHERE section_id = ? AND activity_id = ? AND start_index = ?"
            )?;

            for (activity_id, start_idx, end_idx, distance) in portions {
                // Calculate performance metrics
                let (lap_time, lap_pace) = if let Some(times) = time_streams.get(&activity_id) {
                    let start_idx_usize = start_idx as usize;
                    let end_idx_usize = end_idx as usize;

                    if start_idx_usize < times.len() && end_idx_usize < times.len() {
                        let lap_time = (times[end_idx_usize] as f64 - times[start_idx_usize] as f64).abs();
                        if lap_time > 0.0 {
                            let lap_pace = distance / lap_time;
                            (Some(lap_time), Some(lap_pace))
                        } else {
                            (None, None)
                        }
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                };

                update_stmt.execute(params![
                    lap_time,
                    lap_pace,
                    section_id,
                    activity_id,
                    start_idx,
                ])?;

                if lap_time.is_some() {
                    populated_portions += 1;
                }
            }
        }

        log::info!(
            "tracematch: [Migration] Performance cache population complete: {}/{} portions populated",
            populated_portions,
            total_portions
        );

        Ok(())
    }

    /// Populate section bounds columns from polyline JSON during migration to v5.
    fn populate_section_bounds(conn: &Connection) -> SqlResult<()> {
        let sections: Vec<(String, String)> = conn
            .prepare(
                "SELECT id, polyline_json FROM sections WHERE bounds_min_lat IS NULL"
            )?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        if sections.is_empty() {
            return Ok(());
        }

        log::info!(
            "tracematch: [Migration] Populating bounds for {} sections...",
            sections.len()
        );

        let mut update_stmt = conn.prepare(
            "UPDATE sections SET bounds_min_lat=?, bounds_max_lat=?, bounds_min_lng=?, bounds_max_lng=? WHERE id=?"
        )?;

        let mut populated = 0;
        for (id, polyline_json) in &sections {
            if let Ok(points) = serde_json::from_str::<Vec<GpsPoint>>(polyline_json) {
                if points.len() >= 2 {
                    let bounds = tracematch::geo_utils::compute_bounds(&points);
                    update_stmt.execute(params![
                        bounds.min_lat,
                        bounds.max_lat,
                        bounds.min_lng,
                        bounds.max_lng,
                        id,
                    ])?;
                    populated += 1;
                }
            }
        }

        log::info!(
            "tracematch: [Migration] Populated bounds for {}/{} sections",
            populated,
            sections.len()
        );

        Ok(())
    }

    /// Backfill activity_count column on route_groups from activity_ids JSON.
    fn populate_route_group_counts(conn: &Connection) -> SqlResult<()> {
        let groups: Vec<(String, String)> = conn
            .prepare(
                "SELECT id, activity_ids FROM route_groups WHERE activity_count IS NULL"
            )?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        if groups.is_empty() {
            return Ok(());
        }

        log::info!(
            "tracematch: [Migration] Backfilling activity_count for {} route groups...",
            groups.len()
        );

        let mut update_stmt = conn.prepare(
            "UPDATE route_groups SET activity_count = ? WHERE id = ?"
        )?;

        for (id, activity_ids_json) in &groups {
            let count = serde_json::from_str::<Vec<String>>(activity_ids_json)
                .map(|ids| ids.len() as i64)
                .unwrap_or(0);
            update_stmt.execute(params![count, id])?;
        }

        log::info!(
            "tracematch: [Migration] Backfilled activity_count for {} route groups",
            groups.len()
        );

        Ok(())
    }

    /// Populate all performance caches for migration from schema v3 to v4.
    /// Consolidates zone distributions, FTP history, and heatmap intensity.
    fn populate_all_performance_caches(conn: &Connection) -> SqlResult<()> {
        log::info!("tracematch: [Migration] Populating all performance caches...");

        // Part 1: Zone distribution cache
        log::info!("tracematch: [Migration]   - Populating zone cache from JSON blobs...");
        let mut stmt = conn.prepare(
            "SELECT activity_id, power_zone_times, hr_zone_times FROM activity_metrics
             WHERE power_zone_times IS NOT NULL OR hr_zone_times IS NOT NULL"
        )?;

        let mut update_stmt = conn.prepare(
            "UPDATE activity_metrics
             SET power_z1=?, power_z2=?, power_z3=?, power_z4=?, power_z5=?, power_z6=?, power_z7=?,
                 hr_z1=?, hr_z2=?, hr_z3=?, hr_z4=?, hr_z5=?
             WHERE activity_id=?"
        )?;

        let activities: Vec<(String, Option<String>, Option<String>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        for (id, power_json, hr_json) in activities {
            let power_zones: Vec<f64> = power_json
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(|| vec![0.0; 7]);
            let hr_zones: Vec<f64> = hr_json
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(|| vec![0.0; 5]);

            update_stmt.execute(params![
                power_zones.get(0).unwrap_or(&0.0),
                power_zones.get(1).unwrap_or(&0.0),
                power_zones.get(2).unwrap_or(&0.0),
                power_zones.get(3).unwrap_or(&0.0),
                power_zones.get(4).unwrap_or(&0.0),
                power_zones.get(5).unwrap_or(&0.0),
                power_zones.get(6).unwrap_or(&0.0),
                hr_zones.get(0).unwrap_or(&0.0),
                hr_zones.get(1).unwrap_or(&0.0),
                hr_zones.get(2).unwrap_or(&0.0),
                hr_zones.get(3).unwrap_or(&0.0),
                hr_zones.get(4).unwrap_or(&0.0),
                id,
            ])?;
        }

        // Part 2: FTP history cache
        log::info!("tracematch: [Migration]   - Populating FTP history cache...");
        conn.execute("DELETE FROM ftp_history", [])?;
        conn.execute(
            "INSERT INTO ftp_history (date, ftp, activity_id, sport_type)
             SELECT date, ftp, activity_id, sport_type
             FROM activity_metrics
             WHERE ftp IS NOT NULL
             ORDER BY date DESC",
            []
        )?;

        // Part 3: Heatmap intensity cache
        log::info!("tracematch: [Migration]   - Populating heatmap intensity cache...");
        conn.execute("DELETE FROM activity_heatmap", [])?;
        conn.execute(
            "INSERT INTO activity_heatmap (date, intensity, max_duration, activity_count)
             SELECT
                 date(date, 'unixepoch') as date_str,
                 CASE
                     WHEN MAX(moving_time) > 7200 THEN 4
                     WHEN MAX(moving_time) > 5400 THEN 3
                     WHEN MAX(moving_time) > 3600 THEN 2
                     WHEN MAX(moving_time) > 0 THEN 1
                     ELSE 0
                 END as intensity,
                 MAX(moving_time) as max_duration,
                 COUNT(*) as activity_count
             FROM activity_metrics
             GROUP BY date_str",
            []
        )?;

        log::info!("tracematch: [Migration] All performance caches populated successfully");
        Ok(())
    }
}
