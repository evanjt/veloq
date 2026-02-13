//! Section CRUD operations.
//!
//! Unified database operations for all sections (both auto and custom).
//! All sections are stored in a single `sections` table with a `section_type` discriminator.

use super::{CreateSectionParams, Section, SectionSummary, SectionType};
use crate::persistence::PersistentRouteEngine;
use rusqlite::params;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tracematch::{GpsPoint, SectionPortion};

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
                    updated_at TEXT
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

    /// Get sections with optional type filter.
    pub fn get_sections_by_type(&self, section_type: Option<SectionType>) -> Vec<Section> {
        let query = match section_type {
            Some(st) => format!(
                "SELECT id, section_type, name, sport_type, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        source_activity_id, start_index, end_index, created_at, updated_at
                 FROM sections WHERE section_type = '{}'",
                st.as_str()
            ),
            None => "SELECT id, section_type, name, sport_type, polyline_json, distance_meters,
                            representative_activity_id, confidence, observation_count, average_spread,
                            point_density_json, scale, version, is_user_defined, stability,
                            source_activity_id, start_index, end_index, created_at, updated_at
                     FROM sections"
                .to_string(),
        };

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let section_type_str: String = row.get(1)?;
            let polyline_json: String = row.get(4)?;
            let point_density_json: Option<String> = row.get(10)?;

            // Get activity IDs from junction table
            let activity_ids = self.get_section_activity_ids(&id);

            Ok(Section {
                id,
                section_type: SectionType::from_str(&section_type_str).unwrap_or(SectionType::Auto),
                name: row.get(2)?,
                sport_type: row.get(3)?,
                polyline: serde_json::from_str(&polyline_json).unwrap_or_default(),
                distance_meters: row.get(5)?,
                representative_activity_id: row.get(6)?,
                activity_ids,
                visit_count: 0, // Will be set from activity_ids.len()
                confidence: row.get(7)?,
                observation_count: row.get(8)?,
                average_spread: row.get(9)?,
                point_density: point_density_json
                    .and_then(|j| serde_json::from_str(&j).ok()),
                scale: row.get(11)?,
                is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                stability: row.get(14)?,
                version: row.get(12)?,
                updated_at: row.get(19)?,
                source_activity_id: row.get(15)?,
                start_index: row.get(16)?,
                end_index: row.get(17)?,
                created_at: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
                route_ids: None,
            })
        });

        match rows {
            Ok(iter) => iter
                .filter_map(|r| r.ok())
                .map(|mut s| {
                    // Count total traversals (laps), not unique activities
                    s.visit_count = self.get_section_visit_count(&s.id);
                    s
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Get all sections that contain a specific activity.
    /// Uses section_activities junction table for O(1) lookup (was O(N) with full table scan).
    /// 25-50x speedup: 250-570ms → 10-20ms
    pub fn get_sections_for_activity(&self, activity_id: &str) -> Vec<Section> {
        // Query junction table for section IDs (indexed by activity_id)
        let section_ids: Vec<String> = match self.db.prepare(
            "SELECT DISTINCT section_id FROM section_activities WHERE activity_id = ?"
        ) {
            Ok(mut stmt) => stmt
                .query_map([activity_id], |row| row.get(0))
                .ok()
                .map(|iter| iter.flatten().collect())
                .unwrap_or_default(),
            Err(_) => return Vec::new(),
        };

        // Load full section data for each ID
        let mut sections = Vec::new();
        for section_id in section_ids {
            // Reuse get_section_by_id for consistent loading
            if let Some(section) = self.get_section(&section_id) {
                sections.push(section);
            }
        }

        sections
    }

    /// Get activity IDs for a section from the junction table (deduplicated).
    fn get_section_activity_ids(&self, section_id: &str) -> Vec<String> {
        let mut stmt = match self
            .db
            .prepare("SELECT DISTINCT activity_id FROM section_activities WHERE section_id = ?")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        stmt.query_map(params![section_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    /// Get total visit count (number of traversals/laps) for a section.
    fn get_section_visit_count(&self, section_id: &str) -> u32 {
        self.db
            .query_row(
                "SELECT COUNT(*) FROM section_activities WHERE section_id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    /// Get section count by type.
    pub fn get_section_count_by_type(&self, section_type: Option<SectionType>) -> u32 {
        let query = match section_type {
            Some(st) => format!(
                "SELECT COUNT(*) FROM sections WHERE section_type = '{}'",
                st.as_str()
            ),
            None => "SELECT COUNT(*) FROM sections".to_string(),
        };

        self.db
            .query_row(&query, [], |row| row.get(0))
            .unwrap_or(0)
    }

    /// Get section summaries by type (lightweight, no polylines).
    pub fn get_section_summaries_by_type(
        &self,
        section_type: Option<SectionType>,
    ) -> Vec<SectionSummary> {
        let query = match section_type {
            Some(st) => format!(
                "SELECT id, section_type, name, sport_type, distance_meters,
                        representative_activity_id, created_at
                 FROM sections WHERE section_type = '{}'",
                st.as_str()
            ),
            None => "SELECT id, section_type, name, sport_type, distance_meters,
                            representative_activity_id, created_at
                     FROM sections"
                .to_string(),
        };

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let section_type_str: String = row.get(1)?;

            // Count activities from junction table
            let visit_count = self.get_section_activity_count(&id);

            Ok(SectionSummary {
                id,
                section_type: SectionType::from_str(&section_type_str).unwrap_or(SectionType::Auto),
                name: row.get(2)?,
                sport_type: row.get(3)?,
                distance_meters: row.get(4)?,
                representative_activity_id: row.get(5)?,
                visit_count,
                created_at: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            })
        });

        match rows {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Get activity count for a section.
    fn get_section_activity_count(&self, section_id: &str) -> u32 {
        self.db
            .query_row(
                "SELECT COUNT(*) FROM section_activities WHERE section_id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    /// Create a new section.
    pub fn create_section(&mut self, params: CreateSectionParams) -> Result<String, String> {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let rand_suffix: u32 = (ts % 100000) as u32;

        // Determine section type based on whether source_activity_id is provided
        let (section_type, id_prefix) = if params.source_activity_id.is_some() {
            (SectionType::Custom, "custom")
        } else {
            (SectionType::Auto, "auto")
        };

        let id = format!("{}_{}__{:05}", id_prefix, ts, rand_suffix);
        let created_at = chrono::Utc::now().to_rfc3339();
        let polyline_json =
            serde_json::to_string(&params.polyline).unwrap_or_else(|_| "[]".to_string());

        self.db
            .execute(
                "INSERT INTO sections (
                    id, section_type, name, sport_type, polyline_json, distance_meters,
                    representative_activity_id, source_activity_id, start_index, end_index,
                    created_at, is_user_defined
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    id,
                    section_type.as_str(),
                    params.name,
                    params.sport_type,
                    polyline_json,
                    params.distance_meters,
                    params.source_activity_id.as_ref(), // representative = source for custom
                    params.source_activity_id,
                    params.start_index,
                    params.end_index,
                    created_at,
                    1 // is_user_defined = true for manually created sections
                ],
            )
            .map_err(|e| format!("Failed to create section: {}", e))?;

        // Match all activities with same sport type against the new section
        // This ensures custom sections show all traversals, including the source activity
        // with proper portion details (direction, indices, distance)
        let _ = self.match_activities_to_section(&id, &params.polyline, &params.sport_type);

        Ok(id)
    }

    /// Add an activity to a section's activity list with default portion values.
    /// For full portion details, use add_section_activity_with_portion().
    pub fn add_section_activity(&mut self, section_id: &str, activity_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "INSERT OR IGNORE INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters) VALUES (?, ?, 'same', 0, 0, 0)",
                params![section_id, activity_id],
            )
            .map_err(|e| format!("Failed to add section activity: {}", e))?;
        Ok(())
    }

    /// Add an activity to a section's activity list with full portion details.
    pub fn add_section_activity_with_portion(
        &mut self,
        section_id: &str,
        portion: &SectionPortion,
    ) -> Result<(), String> {
        self.db
            .execute(
                "INSERT OR IGNORE INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters) VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    section_id,
                    portion.activity_id,
                    portion.direction.to_string(),
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                ],
            )
            .map_err(|e| format!("Failed to add section activity: {}", e))?;
        Ok(())
    }

    /// Rename a section.
    pub fn rename_section(&mut self, section_id: &str, name: &str) -> Result<(), String> {
        let updated_at = chrono::Utc::now().to_rfc3339();

        let rows = self
            .db
            .execute(
                "UPDATE sections SET name = ?, updated_at = ? WHERE id = ?",
                params![name, updated_at, section_id],
            )
            .map_err(|e| format!("Failed to rename section: {}", e))?;

        if rows == 0 {
            return Err(format!("Section not found: {}", section_id));
        }

        // Invalidate cache so next fetch gets fresh data
        self.invalidate_section_cache(section_id);

        // Update in-memory section for immediate visibility
        self.update_section_name_in_memory(section_id, name);

        Ok(())
    }

    /// Set a new reference activity for a section.
    ///
    /// For **auto-detected sections**: Updates `representative_activity_id` and replaces the
    /// polyline with the new activity's section-matching portion (extracted via spatial overlap).
    ///
    /// For **custom sections**: Updates both the representative and reloads the polyline from
    /// the new activity using the stored start/end indices.
    pub fn set_section_reference(
        &mut self,
        section_id: &str,
        activity_id: &str,
    ) -> Result<(), String> {
        // Verify activity exists and get its track
        let track = self
            .get_gps_track(activity_id)
            .ok_or_else(|| format!("Activity not found: {}", activity_id))?;

        // Get current section to determine type, indices, and current polyline
        let (start_index, end_index, section_type, current_polyline_json): (
            Option<u32>,
            Option<u32>,
            String,
            String,
        ) = {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT start_index, end_index, section_type, polyline_json FROM sections WHERE id = ?",
                )
                .map_err(|e| e.to_string())?;

            stmt.query_row(params![section_id], |row| {
                Ok((
                    row.get::<_, Option<u32>>(0)?,
                    row.get::<_, Option<u32>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|_| format!("Section not found: {}", section_id))?
        };

        let updated_at = chrono::Utc::now().to_rfc3339();

        if section_type == "custom" {
            // For custom sections, update polyline from new activity's track using indices
            let start = start_index.unwrap_or(0) as usize;
            let end = end_index.unwrap_or(track.len() as u32) as usize;
            let polyline: Vec<GpsPoint> = track
                .get(start..end.min(track.len()))
                .unwrap_or(&[])
                .to_vec();

            let polyline_json = serde_json::to_string(&polyline).unwrap_or_else(|_| "[]".to_string());
            let distance = calculate_polyline_distance(&polyline);

            self.db
                .execute(
                    "UPDATE sections SET
                        representative_activity_id = ?,
                        source_activity_id = ?,
                        polyline_json = ?,
                        distance_meters = ?,
                        is_user_defined = 1,
                        updated_at = ?
                     WHERE id = ?",
                    params![activity_id, activity_id, polyline_json, distance, updated_at, section_id],
                )
                .map_err(|e| format!("Failed to update section: {}", e))?;
        } else {
            // For auto sections, extract the section-matching portion from the new activity's track
            let current_polyline: Vec<GpsPoint> =
                serde_json::from_str(&current_polyline_json).unwrap_or_default();

            if current_polyline.is_empty() {
                return Err("Section has no polyline to match against".to_string());
            }

            // Compute portion details for the new reference activity
            let portion = compute_section_portion(activity_id, &track, &current_polyline)
                .ok_or_else(|| format!(
                    "Activity {} does not overlap sufficiently with section {}",
                    activity_id, section_id
                ))?;

            // Use the portion's indices to extract the new polyline
            let start = portion.start_index as usize;
            let end = (portion.end_index as usize + 1).min(track.len());
            let new_polyline: Vec<GpsPoint> = track[start..end].to_vec();

            let polyline_json =
                serde_json::to_string(&new_polyline).unwrap_or_else(|_| "[]".to_string());
            let distance = calculate_polyline_distance(&new_polyline);

            self.db
                .execute(
                    "UPDATE sections SET
                        representative_activity_id = ?,
                        polyline_json = ?,
                        distance_meters = ?,
                        is_user_defined = 1,
                        updated_at = ?
                     WHERE id = ?",
                    params![activity_id, polyline_json, distance, updated_at, section_id],
                )
                .map_err(|e| format!("Failed to update section reference: {}", e))?;

            // Re-match all activities against the new polyline
            self.rematch_section_activities(section_id, &new_polyline)?;

            // Add the new reference activity with proper portion details
            // (rematch only includes previously-associated activities)
            self.add_section_activity_with_portion(section_id, &portion)?;
        }

        // For custom sections, add the reference activity with portion details
        if section_type == "custom" {
            // Get the updated polyline for custom section
            let polyline_json: String = self.db
                .query_row(
                    "SELECT polyline_json FROM sections WHERE id = ?",
                    params![section_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Failed to get section polyline: {}", e))?;
            let polyline: Vec<GpsPoint> = serde_json::from_str(&polyline_json).unwrap_or_default();

            if let Some(portion) = compute_section_portion(activity_id, &track, &polyline) {
                self.add_section_activity_with_portion(section_id, &portion)?;
            } else {
                // Fallback for custom sections - the source activity should always match
                self.add_section_activity(section_id, activity_id)?;
            }
        }

        // Invalidate cache so next fetch gets fresh data
        self.invalidate_section_cache(section_id);

        // Refresh in-memory section (for auto sections)
        self.refresh_section_in_memory(section_id);

        Ok(())
    }

    /// Re-match activities against an updated section polyline.
    /// Checks all previously-associated activities and keeps only those that still overlap.
    fn rematch_section_activities(
        &mut self,
        section_id: &str,
        new_polyline: &[GpsPoint],
    ) -> Result<(), String> {
        // Get current activity IDs for this section
        let activity_ids = self.get_section_activity_ids(section_id);

        if activity_ids.is_empty() || new_polyline.is_empty() {
            return Ok(());
        }

        // Clear existing junction entries for this section
        self.db
            .execute(
                "DELETE FROM section_activities WHERE section_id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to clear section activities: {}", e))?;

        // Re-add only activities that still match, with full portion details
        for aid in &activity_ids {
            if let Some(track) = self.get_gps_track(aid) {
                if let Some(portion) = compute_section_portion(aid, &track, new_polyline) {
                    self.add_section_activity_with_portion(section_id, &portion)?;
                }
            }
        }

        Ok(())
    }

    /// Match all activities with the same sport type against a section polyline.
    /// Adds any activities that overlap (≥3 points) to the junction table.
    /// Used when creating custom sections to find all matching activities.
    pub fn match_activities_to_section(
        &mut self,
        section_id: &str,
        polyline: &[GpsPoint],
        sport_type: &str,
    ) -> Result<u32, String> {
        if polyline.is_empty() {
            return Ok(0);
        }

        // Get all activity IDs with matching sport type
        let activity_ids = self.get_activity_ids_by_sport(sport_type);

        if activity_ids.is_empty() {
            return Ok(0);
        }

        log::info!(
            "tracematch: [match_activities_to_section] Checking {} activities with sport_type '{}'",
            activity_ids.len(),
            sport_type
        );

        // Build track map for all activities with matching sport type
        let mut track_map: HashMap<String, Vec<GpsPoint>> = HashMap::new();
        for aid in &activity_ids {
            if let Some(track) = self.get_gps_track(aid) {
                track_map.insert(aid.to_string(), track);
            }
        }

        let mut match_count: u32 = 0;

        // Compute full portion details for each matching activity
        for aid in &activity_ids {
            if let Some(track) = track_map.get(aid) {
                if let Some(portion) = compute_section_portion(aid, track, polyline) {
                    self.add_section_activity_with_portion(section_id, &portion)?;
                    match_count += 1;
                }
            }
        }

        log::info!(
            "tracematch: [match_activities_to_section] Found {} matching activities for section {}",
            match_count,
            section_id
        );

        Ok(match_count)
    }

    /// Reset a section's reference to automatic (algorithm-selected).
    /// Sets is_user_defined to false.
    pub fn reset_section_reference(&mut self, section_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE sections SET is_user_defined = 0 WHERE id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to reset section reference: {}", e))?;

        // Invalidate cache so next fetch gets fresh data
        self.invalidate_section_cache(section_id);

        // Refresh in-memory section (for auto sections)
        self.refresh_section_in_memory(section_id);

        Ok(())
    }

    /// Delete a section.
    pub fn delete_section(&mut self, section_id: &str) -> Result<(), String> {
        // Junction table entries are deleted via CASCADE
        let rows = self
            .db
            .execute("DELETE FROM sections WHERE id = ?", params![section_id])
            .map_err(|e| format!("Failed to delete section: {}", e))?;

        if rows == 0 {
            return Err(format!("Section not found: {}", section_id));
        }

        // Invalidate cache
        self.invalidate_section_cache(section_id);

        // Remove from in-memory cache
        self.remove_section_from_memory(section_id);

        Ok(())
    }

    /// Get a single section by ID.
    pub fn get_section(&self, section_id: &str) -> Option<Section> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, section_type, name, sport_type, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        source_activity_id, start_index, end_index, created_at, updated_at
                 FROM sections WHERE id = ?",
            )
            .ok()?;

        stmt.query_row(params![section_id], |row| {
            let id: String = row.get(0)?;
            let section_type_str: String = row.get(1)?;
            let polyline_json: String = row.get(4)?;
            let point_density_json: Option<String> = row.get(10)?;

            let activity_ids = self.get_section_activity_ids(&id);
            let visit_count = self.get_section_visit_count(&id);

            Ok(Section {
                id,
                section_type: SectionType::from_str(&section_type_str).unwrap_or(SectionType::Auto),
                name: row.get(2)?,
                sport_type: row.get(3)?,
                polyline: serde_json::from_str(&polyline_json).unwrap_or_default(),
                distance_meters: row.get(5)?,
                representative_activity_id: row.get(6)?,
                activity_ids: activity_ids.clone(),
                visit_count,
                confidence: row.get(7)?,
                observation_count: row.get(8)?,
                average_spread: row.get(9)?,
                point_density: point_density_json.and_then(|j| serde_json::from_str(&j).ok()),
                scale: row.get(11)?,
                is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                stability: row.get(14)?,
                version: row.get(12)?,
                updated_at: row.get(19)?,
                source_activity_id: row.get(15)?,
                start_index: row.get(16)?,
                end_index: row.get(17)?,
                created_at: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
                route_ids: None,
            })
        })
        .ok()
    }

    /// Save a section (insert or update).
    /// Used by section detection to persist auto-detected sections.
    pub fn save_section(&mut self, section: &Section) -> Result<(), String> {
        let polyline_json =
            serde_json::to_string(&section.polyline).unwrap_or_else(|_| "[]".to_string());
        let point_density_json = section
            .point_density
            .as_ref()
            .and_then(|pd| serde_json::to_string(pd).ok());

        self.db
            .execute(
                "INSERT OR REPLACE INTO sections (
                    id, section_type, name, sport_type, polyline_json, distance_meters,
                    representative_activity_id, confidence, observation_count, average_spread,
                    point_density_json, scale, version, is_user_defined, stability,
                    source_activity_id, start_index, end_index, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    section.id,
                    section.section_type.as_str(),
                    section.name,
                    section.sport_type,
                    polyline_json,
                    section.distance_meters,
                    section.representative_activity_id,
                    section.confidence,
                    section.observation_count,
                    section.average_spread,
                    point_density_json,
                    section.scale,
                    section.version.unwrap_or(1),
                    if section.is_user_defined { 1 } else { 0 },
                    section.stability,
                    section.source_activity_id,
                    section.start_index,
                    section.end_index,
                    section.created_at,
                    section.updated_at
                ],
            )
            .map_err(|e| format!("Failed to save section: {}", e))?;

        // Update junction table
        for activity_id in &section.activity_ids {
            self.add_section_activity(&section.id, activity_id)?;
        }

        // Invalidate cache so next fetch gets fresh data
        self.invalidate_section_cache(&section.id);

        Ok(())
    }
}

/// Distance threshold for considering a point "on" the section (meters)
const TRACE_PROXIMITY_THRESHOLD: f64 = 50.0;

/// Minimum points to consider a valid overlap trace
const MIN_TRACE_POINTS: usize = 3;

/// Compute a SectionPortion for an activity's overlap with a section polyline.
/// Returns None if the activity doesn't sufficiently overlap.
fn compute_section_portion(
    activity_id: &str,
    track: &[GpsPoint],
    section_polyline: &[GpsPoint],
) -> Option<SectionPortion> {
    if track.len() < MIN_TRACE_POINTS || section_polyline.len() < 2 {
        return None;
    }

    // Convert threshold from meters to approximate degrees
    let threshold_deg = (TRACE_PROXIMITY_THRESHOLD * 1.2) / 111_000.0;

    // Find the start and end indices of the overlapping portion
    let mut start_index: Option<usize> = None;
    let mut end_index: Option<usize> = None;
    let mut overlap_points: Vec<GpsPoint> = Vec::new();
    let mut gap_count = 0;
    const MAX_GAP: usize = 3;

    for (i, point) in track.iter().enumerate() {
        // Check if point is near any point on the section polyline
        let is_near = section_polyline.iter().any(|sp| {
            let dlat = point.latitude - sp.latitude;
            let dlon = point.longitude - sp.longitude;
            (dlat * dlat + dlon * dlon).sqrt() <= threshold_deg
        });

        if is_near {
            gap_count = 0;
            if start_index.is_none() {
                start_index = Some(i);
            }
            end_index = Some(i);
            overlap_points.push(*point);
        } else {
            gap_count += 1;
            if gap_count <= MAX_GAP && start_index.is_some() {
                overlap_points.push(*point);
                end_index = Some(i);
            } else if gap_count > MAX_GAP && overlap_points.len() >= MIN_TRACE_POINTS {
                // Found a valid sequence, stop here
                break;
            } else if gap_count > MAX_GAP {
                // Reset if we haven't found enough points yet
                start_index = None;
                end_index = None;
                overlap_points.clear();
            }
        }
    }

    // Check if we found a valid overlap
    let start_idx = start_index?;
    let end_idx = end_index?;
    if overlap_points.len() < MIN_TRACE_POINTS {
        return None;
    }

    // Compute direction by comparing trace direction with section direction
    let direction = compute_direction(&overlap_points, section_polyline);

    // Compute distance
    let distance_meters = calculate_polyline_distance(&overlap_points);

    Some(SectionPortion {
        activity_id: activity_id.to_string(),
        start_index: start_idx as u32,
        end_index: end_idx as u32,
        distance_meters,
        direction,
    })
}

/// Determine if the trace travels in the same or reverse direction as the section.
fn compute_direction(trace: &[GpsPoint], section_polyline: &[GpsPoint]) -> tracematch::Direction {
    if trace.len() < 2 || section_polyline.len() < 2 {
        return tracematch::Direction::Same;
    }

    // Compare the direction vectors of trace and section
    let trace_start = &trace[0];
    let trace_end = &trace[trace.len() - 1];
    let section_start = &section_polyline[0];
    let section_end = &section_polyline[section_polyline.len() - 1];

    // Compute dot product of direction vectors to determine if same or opposite direction
    let trace_dx = trace_end.longitude - trace_start.longitude;
    let trace_dy = trace_end.latitude - trace_start.latitude;
    let section_dx = section_end.longitude - section_start.longitude;
    let section_dy = section_end.latitude - section_start.latitude;

    let dot_product = trace_dx * section_dx + trace_dy * section_dy;

    if dot_product >= 0.0 {
        tracematch::Direction::Same
    } else {
        tracematch::Direction::Reverse
    }
}

/// Calculate total distance of a polyline in meters.
fn calculate_polyline_distance(points: &[GpsPoint]) -> f64 {
    if points.len() < 2 {
        return 0.0;
    }

    points
        .windows(2)
        .map(|w| haversine_distance(w[0].latitude, w[0].longitude, w[1].latitude, w[1].longitude))
        .sum()
}

/// Haversine distance between two points in meters.
fn haversine_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6_371_000.0; // Earth's radius in meters

    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();

    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);

    let c = 2.0 * a.sqrt().asin();

    R * c
}
