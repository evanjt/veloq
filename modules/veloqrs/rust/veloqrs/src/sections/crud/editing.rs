//! Bounds editing, visibility state, imports, and schema initialisation.
//!
//! This submodule covers everything that changes a section's geometry
//! (trim/expand/reset) or its visibility (disable/enable/supersede), plus
//! the one-off schema setup and the AsyncStorage → SQLite migration imports.

use crate::persistence::PersistentRouteEngine;
use rusqlite::params;
use tracematch::GpsPoint;
use tracematch::matching::calculate_route_distance;

impl PersistentRouteEngine {
    /// Initialize the unified sections schema.
    /// Call this during database initialization.
    pub fn init_sections_schema(&self) -> Result<(), String> {
        self.db
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS sections (
                    id TEXT PRIMARY KEY,
                    section_type TEXT NOT NULL CHECK(section_type IN ('auto', 'custom')),
                    name TEXT,
                    sport_type TEXT NOT NULL,
                    polyline_json TEXT NOT NULL,
                    distance_meters REAL NOT NULL,
                    representative_activity_id TEXT,

                    -- Auto-specific fields (nullable for custom)
                    confidence REAL,
                    observation_count INTEGER,
                    average_spread REAL,
                    point_density_json TEXT,
                    scale TEXT,
                    version INTEGER DEFAULT 1,
                    is_user_defined INTEGER DEFAULT 0,
                    stability REAL,

                    -- Custom-specific fields (nullable for auto)
                    source_activity_id TEXT,
                    start_index INTEGER,
                    end_index INTEGER,

                    -- Timestamps
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT,

                    -- Bounds (for map viewport filtering)
                    bounds_min_lat REAL,
                    bounds_max_lat REAL,
                    bounds_min_lng REAL,
                    bounds_max_lng REAL
                );

                -- Junction table for section-activity relationships (with portion details)
                CREATE TABLE IF NOT EXISTS section_activities (
                    section_id TEXT NOT NULL,
                    activity_id TEXT NOT NULL,
                    direction TEXT NOT NULL DEFAULT 'same',
                    start_index INTEGER NOT NULL DEFAULT 0,
                    end_index INTEGER NOT NULL DEFAULT 0,
                    distance_meters REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY (section_id, activity_id, start_index),
                    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_section_activities_activity
                ON section_activities(activity_id);

                CREATE INDEX IF NOT EXISTS idx_sections_type
                ON sections(section_type);

                CREATE INDEX IF NOT EXISTS idx_sections_sport
                ON sections(sport_type);
                "#,
            )
            .map_err(|e| format!("Failed to create sections schema: {}", e))
    }

    /// Trim a section's bounds by slicing its polyline to the given index range.
    /// Backs up the original polyline on first trim (preserves true original across multiple trims).
    /// Re-matches all activities against the new trimmed polyline.
    pub fn trim_section(
        &mut self,
        section_id: &str,
        start_index: u32,
        end_index: u32,
    ) -> Result<(), String> {
        // Load current polyline
        let polyline_json: String = self
            .db
            .query_row(
                "SELECT polyline_json FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .map_err(|_| format!("Section not found: {}", section_id))?;

        let polyline: Vec<GpsPoint> = serde_json::from_str(&polyline_json)
            .map_err(|e| format!("Failed to parse polyline: {}", e))?;

        // Validate indices
        let start = start_index as usize;
        let end = end_index as usize;
        if start >= end {
            return Err("Start index must be less than end index".to_string());
        }
        if end >= polyline.len() {
            return Err(format!(
                "End index {} out of bounds (polyline has {} points)",
                end,
                polyline.len()
            ));
        }
        if end - start + 1 < 5 {
            return Err("Trimmed section must have at least 5 points".to_string());
        }

        // Slice the polyline
        let trimmed: Vec<GpsPoint> = polyline[start..=end].to_vec();

        // Check minimum distance (50m)
        let distance = calculate_route_distance(&trimmed);
        if distance < 50.0 {
            return Err("Trimmed section must be at least 50 meters".to_string());
        }

        // Back up original polyline if not already backed up
        let has_original: bool = self
            .db
            .query_row(
                "SELECT original_polyline_json IS NOT NULL FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !has_original {
            self.db
                .execute(
                    "UPDATE sections SET original_polyline_json = polyline_json WHERE id = ?",
                    params![section_id],
                )
                .map_err(|e| format!("Failed to backup original polyline: {}", e))?;
        }

        // Compute new bounds and distance
        let bounds = tracematch::geo_utils::compute_bounds(&trimmed);
        let trimmed_json = serde_json::to_string(&trimmed).unwrap_or_else(|_| "[]".to_string());
        let updated_at = chrono::Utc::now().to_rfc3339();

        // Update section
        self.db
            .execute(
                "UPDATE sections SET
                    polyline_json = ?,
                    distance_meters = ?,
                    is_user_defined = 1,
                    updated_at = ?,
                    bounds_min_lat = ?,
                    bounds_max_lat = ?,
                    bounds_min_lng = ?,
                    bounds_max_lng = ?
                 WHERE id = ?",
                params![
                    trimmed_json,
                    distance,
                    updated_at,
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    section_id
                ],
            )
            .map_err(|e| format!("Failed to update section: {}", e))?;

        // Re-match activities against new polyline
        // For custom sections, scan ALL activities by sport (not just previously matched)
        let section_type: String = self
            .db
            .query_row(
                "SELECT section_type FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "auto".to_string());

        if section_type == "custom" {
            let sport_type: String = self
                .db
                .query_row(
                    "SELECT sport_type FROM sections WHERE id = ?",
                    params![section_id],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| "Ride".to_string());

            // Clear existing matches first, then scan all activities
            self.db
                .execute(
                    "DELETE FROM section_activities WHERE section_id = ?",
                    params![section_id],
                )
                .map_err(|e| format!("Failed to clear section activities: {}", e))?;
            self.match_activities_to_section(section_id, &trimmed, &sport_type)?;
        } else {
            self.rematch_section_activities(section_id, &trimmed)?;
        }

        // Invalidate caches
        self.invalidate_section_cache(section_id);
        self.refresh_section_in_memory(section_id);

        Ok(())
    }

    /// Reset a section's bounds to the original (pre-trim) polyline.
    /// Restores the backed-up original_polyline_json and re-matches activities.
    /// For auto sections, clears is_user_defined. For custom sections, preserves it.
    pub fn reset_section_bounds(&mut self, section_id: &str) -> Result<(), String> {
        // Load original polyline and section type
        let (original_json, section_type, sport_type): (Option<String>, String, String) = self
            .db
            .query_row(
                "SELECT original_polyline_json, section_type, sport_type FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| format!("Section not found: {}", section_id))?;

        let original_json =
            original_json.ok_or_else(|| "Section has no original bounds to restore".to_string())?;

        let original: Vec<GpsPoint> = serde_json::from_str(&original_json)
            .map_err(|e| format!("Failed to parse original polyline: {}", e))?;

        // Recompute distance and bounds
        let distance = calculate_route_distance(&original);
        let bounds = tracematch::geo_utils::compute_bounds(&original);
        let updated_at = chrono::Utc::now().to_rfc3339();

        // Custom sections are always user-defined; auto sections revert to algorithm-defined
        let is_user_defined = if section_type == "custom" { 1 } else { 0 };

        // Restore polyline and clear original backup
        self.db
            .execute(
                "UPDATE sections SET
                    polyline_json = ?,
                    original_polyline_json = NULL,
                    distance_meters = ?,
                    is_user_defined = ?,
                    updated_at = ?,
                    bounds_min_lat = ?,
                    bounds_max_lat = ?,
                    bounds_min_lng = ?,
                    bounds_max_lng = ?
                 WHERE id = ?",
                params![
                    original_json,
                    distance,
                    is_user_defined,
                    updated_at,
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    section_id
                ],
            )
            .map_err(|e| format!("Failed to restore section bounds: {}", e))?;

        // Re-match activities against restored polyline
        // For custom sections, scan ALL activities by sport (not just previously matched)
        if section_type == "custom" {
            self.db
                .execute(
                    "DELETE FROM section_activities WHERE section_id = ?",
                    params![section_id],
                )
                .map_err(|e| format!("Failed to clear section activities: {}", e))?;
            self.match_activities_to_section(section_id, &original, &sport_type)?;
        } else {
            self.rematch_section_activities(section_id, &original)?;
        }

        // Invalidate caches
        self.invalidate_section_cache(section_id);
        self.refresh_section_in_memory(section_id);

        Ok(())
    }

    /// Expand section bounds by replacing the polyline with a new one (can be larger than original).
    /// Backs up the original polyline on first edit (preserves true original across multiple edits).
    /// Re-matches all activities against the new polyline.
    pub fn expand_section_bounds(
        &mut self,
        section_id: &str,
        new_polyline: &[GpsPoint],
    ) -> Result<(), String> {
        if new_polyline.len() < 5 {
            return Err("Expanded section must have at least 5 points".to_string());
        }

        // Check minimum distance (50m)
        let distance = calculate_route_distance(&new_polyline);
        if distance < 50.0 {
            return Err("Expanded section must be at least 50 meters".to_string());
        }

        // Back up original polyline if not already backed up
        let has_original: bool = self
            .db
            .query_row(
                "SELECT original_polyline_json IS NOT NULL FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !has_original {
            self.db
                .execute(
                    "UPDATE sections SET original_polyline_json = polyline_json WHERE id = ?",
                    params![section_id],
                )
                .map_err(|e| format!("Failed to backup original polyline: {}", e))?;
        }

        // Compute new bounds and distance
        let bounds = tracematch::geo_utils::compute_bounds(new_polyline);
        let updated_at = chrono::Utc::now().to_rfc3339();
        let polyline_json = serde_json::to_string(new_polyline)
            .map_err(|e| format!("Failed to serialize polyline: {}", e))?;

        // Update section
        self.db
            .execute(
                "UPDATE sections SET
                    polyline_json = ?,
                    distance_meters = ?,
                    is_user_defined = 1,
                    updated_at = ?,
                    bounds_min_lat = ?,
                    bounds_max_lat = ?,
                    bounds_min_lng = ?,
                    bounds_max_lng = ?
                 WHERE id = ?",
                params![
                    polyline_json,
                    distance,
                    updated_at,
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    section_id
                ],
            )
            .map_err(|e| format!("Failed to update section: {}", e))?;

        // Re-match activities against new polyline
        let section_type: String = self
            .db
            .query_row(
                "SELECT section_type FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "auto".to_string());

        if section_type == "custom" {
            let sport_type: String = self
                .db
                .query_row(
                    "SELECT sport_type FROM sections WHERE id = ?",
                    params![section_id],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| "Ride".to_string());

            self.db
                .execute(
                    "DELETE FROM section_activities WHERE section_id = ?",
                    params![section_id],
                )
                .map_err(|e| format!("Failed to clear section activities: {}", e))?;
            self.match_activities_to_section(section_id, &new_polyline, &sport_type)?;
        } else {
            self.rematch_section_activities(section_id, &new_polyline)?;
        }

        // Invalidate caches
        self.invalidate_section_cache(section_id);
        self.refresh_section_in_memory(section_id);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Section visibility operations
    // -----------------------------------------------------------------------

    /// Disable a section (hide from all queries except restore UI).
    pub fn disable_section(&mut self, section_id: &str) -> Result<(), String> {
        let rows = self
            .db
            .execute(
                "UPDATE sections SET disabled = 1 WHERE id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to disable section: {}", e))?;
        if rows == 0 {
            return Err(format!("Section not found: {}", section_id));
        }
        self.invalidate_section_cache(section_id);
        self.refresh_section_in_memory(section_id);
        Ok(())
    }

    /// Re-enable a previously disabled section.
    pub fn enable_section(&mut self, section_id: &str) -> Result<(), String> {
        let rows = self
            .db
            .execute(
                "UPDATE sections SET disabled = 0 WHERE id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to enable section: {}", e))?;
        if rows == 0 {
            return Err(format!("Section not found: {}", section_id));
        }
        self.invalidate_section_cache(section_id);
        self.refresh_section_in_memory(section_id);
        Ok(())
    }

    /// Mark an auto section as superseded by a custom section.
    pub fn set_superseded(
        &mut self,
        auto_section_id: &str,
        custom_section_id: &str,
    ) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE sections SET superseded_by = ? WHERE id = ?",
                params![custom_section_id, auto_section_id],
            )
            .map_err(|e| format!("Failed to set superseded: {}", e))?;
        self.invalidate_section_cache(auto_section_id);
        Ok(())
    }

    /// Clear superseded state for all auto sections superseded by a given custom section.
    /// Called when a custom section is deleted.
    pub fn clear_superseded(&mut self, custom_section_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE sections SET superseded_by = NULL WHERE superseded_by = ?",
                params![custom_section_id],
            )
            .map_err(|e| format!("Failed to clear superseded: {}", e))?;
        Ok(())
    }

    /// Import disabled section IDs from AsyncStorage migration.
    pub fn import_disabled_ids(&mut self, ids: &[String]) -> Result<u32, String> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut count = 0u32;
        for id in ids {
            let rows = self
                .db
                .execute("UPDATE sections SET disabled = 1 WHERE id = ?", params![id])
                .map_err(|e| format!("Failed to import disabled: {}", e))?;
            count += rows as u32;
        }
        Ok(count)
    }

    /// Import superseded mappings from AsyncStorage migration.
    pub fn import_superseded_map(&mut self, map: &[(String, Vec<String>)]) -> Result<u32, String> {
        let mut count = 0u32;
        for (custom_id, auto_ids) in map {
            for auto_id in auto_ids {
                let rows = self
                    .db
                    .execute(
                        "UPDATE sections SET superseded_by = ? WHERE id = ?",
                        params![custom_id, auto_id],
                    )
                    .map_err(|e| format!("Failed to import superseded: {}", e))?;
                count += rows as u32;
            }
        }
        Ok(count)
    }
}
