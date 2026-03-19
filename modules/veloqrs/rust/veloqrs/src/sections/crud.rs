//! Section CRUD operations.
//!
//! Unified database operations for all sections (both auto and custom).
//! All sections are stored in a single `sections` table with a `section_type` discriminator.

use super::{CreateSectionParams, Section, SectionSummary, SectionType};
use crate::persistence::PersistentRouteEngine;
use rusqlite::params;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tracematch::matching::calculate_route_distance;
use tracematch::sections::{build_rtree, find_all_track_portions};
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
                visit_count: 0, // Set below via get_section_visit_count()
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
            "SELECT DISTINCT section_id FROM section_activities WHERE activity_id = ? AND excluded = 0"
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
            // Reuse get_section() for consistent loading
            if let Some(section) = self.get_section(&section_id) {
                sections.push(section);
            }
        }

        sections
    }

    /// Get activity IDs for a section from the junction table (deduplicated).
    fn get_section_activity_ids(&self, section_id: &str) -> Vec<String> {
        // JOIN activity_metrics to filter by sport type — prevents cross-sport contamination
        let sport_type: Option<String> = self.db.query_row(
            "SELECT sport_type FROM sections WHERE id = ?",
            params![section_id],
            |row| row.get(0),
        ).ok();

        let query = match &sport_type {
            Some(_) => "SELECT DISTINCT sa.activity_id FROM section_activities sa
                         JOIN activity_metrics am ON sa.activity_id = am.activity_id
                         WHERE sa.section_id = ?1 AND am.sport_type = ?2 AND sa.excluded = 0",
            None => "SELECT DISTINCT activity_id FROM section_activities WHERE section_id = ?1 AND excluded = 0",
        };

        let mut stmt = match self.db.prepare(query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        match &sport_type {
            Some(st) => stmt.query_map(params![section_id, st], |row| row.get(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
            None => stmt.query_map(params![section_id], |row| row.get(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
        }
    }

    /// Get total visit count (number of traversals/laps) for a section.
    fn get_section_visit_count(&self, section_id: &str) -> u32 {
        // JOIN activity_metrics to filter by sport type — prevents cross-sport contamination
        self.db
            .query_row(
                "SELECT COUNT(*) FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 JOIN sections s ON sa.section_id = s.id
                 WHERE sa.section_id = ? AND am.sport_type = s.sport_type AND sa.excluded = 0",
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
                        representative_activity_id, created_at, confidence, scale,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                 FROM sections WHERE section_type = '{}'",
                st.as_str()
            ),
            None => "SELECT id, section_type, name, sport_type, distance_meters,
                            representative_activity_id, created_at, confidence, scale,
                            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                     FROM sections"
                .to_string(),
        };

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;

            // Count activities from junction table
            let visit_count = self.get_section_activity_count(&id);

            let bounds = match (
                row.get::<_, Option<f64>>(9)?,
                row.get::<_, Option<f64>>(10)?,
                row.get::<_, Option<f64>>(11)?,
                row.get::<_, Option<f64>>(12)?,
            ) {
                (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) => {
                    Some(crate::FfiBounds { min_lat, max_lat, min_lng, max_lng })
                }
                _ => None,
            };

            Ok(SectionSummary {
                id,
                section_type: row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "auto".to_string()),
                name: row.get(2)?,
                sport_type: row.get(3)?,
                distance_meters: row.get(4)?,
                visit_count,
                activity_count: visit_count,
                representative_activity_id: row.get(5)?,
                confidence: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                scale: row.get(8)?,
                bounds,
                created_at: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            })
        });

        match rows {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Get activity count for a section (sport-type filtered).
    fn get_section_activity_count(&self, section_id: &str) -> u32 {
        self.db
            .query_row(
                "SELECT COUNT(*) FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 JOIN sections s ON sa.section_id = s.id
                 WHERE sa.section_id = ? AND am.sport_type = s.sport_type AND sa.excluded = 0",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    /// Exclude an activity from a section's analysis.
    /// Sets the `excluded` flag to 1 on the junction table row(s).
    pub fn exclude_activity_from_section(&mut self, section_id: &str, activity_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE section_activities SET excluded = 1 WHERE section_id = ? AND activity_id = ?",
                params![section_id, activity_id],
            )
            .map_err(|e| format!("Failed to exclude activity: {}", e))?;
        self.refresh_section_in_memory(section_id);
        self.invalidate_section_cache(section_id);
        Ok(())
    }

    /// Re-include a previously excluded activity in a section's analysis.
    /// Sets the `excluded` flag back to 0 on the junction table row(s).
    pub fn include_activity_in_section(&mut self, section_id: &str, activity_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE section_activities SET excluded = 0 WHERE section_id = ? AND activity_id = ?",
                params![section_id, activity_id],
            )
            .map_err(|e| format!("Failed to include activity: {}", e))?;
        self.refresh_section_in_memory(section_id);
        self.invalidate_section_cache(section_id);
        Ok(())
    }

    /// Get activity IDs that are excluded from a section.
    pub fn get_excluded_activity_ids(&self, section_id: &str) -> Vec<String> {
        let mut stmt = match self.db.prepare(
            "SELECT DISTINCT activity_id FROM section_activities WHERE section_id = ? AND excluded = 1"
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map(params![section_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
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

        // Compute bounds from polyline
        let (bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng) =
            if params.polyline.len() >= 2 {
                let bounds = tracematch::geo_utils::compute_bounds(&params.polyline);
                (Some(bounds.min_lat), Some(bounds.max_lat), Some(bounds.min_lng), Some(bounds.max_lng))
            } else {
                (None, None, None, None)
            };

        self.db
            .execute(
                "INSERT INTO sections (
                    id, section_type, name, sport_type, polyline_json, distance_meters,
                    representative_activity_id, source_activity_id, start_index, end_index,
                    created_at, is_user_defined,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                    1, // is_user_defined = true for manually created sections
                    bounds_min_lat,
                    bounds_max_lat,
                    bounds_min_lng,
                    bounds_max_lng,
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
            let distance = calculate_route_distance(&polyline);
            let bounds = tracematch::geo_utils::compute_bounds(&polyline);

            self.db
                .execute(
                    "UPDATE sections SET
                        representative_activity_id = ?,
                        source_activity_id = ?,
                        polyline_json = ?,
                        distance_meters = ?,
                        is_user_defined = 1,
                        updated_at = ?,
                        bounds_min_lat = ?,
                        bounds_max_lat = ?,
                        bounds_min_lng = ?,
                        bounds_max_lng = ?
                     WHERE id = ?",
                    params![activity_id, activity_id, polyline_json, distance, updated_at,
                            bounds.min_lat, bounds.max_lat, bounds.min_lng, bounds.max_lng, section_id],
                )
                .map_err(|e| format!("Failed to update section: {}", e))?;
        } else {
            // For auto sections, extract the section-matching portion from the new activity's track
            let current_polyline: Vec<GpsPoint> =
                serde_json::from_str(&current_polyline_json).unwrap_or_default();

            if current_polyline.is_empty() {
                return Err("Section has no polyline to match against".to_string());
            }

            // Compute all traversals (laps) for the new reference activity
            let portions = compute_section_portions(activity_id, &track, &current_polyline);
            if portions.is_empty() {
                return Err(format!(
                    "Activity {} does not overlap sufficiently with section {}",
                    activity_id, section_id
                ));
            }

            // Use the first portion's indices to extract the new polyline
            let first = &portions[0];
            let start = first.start_index as usize;
            let end = (first.end_index as usize + 1).min(track.len());
            let new_polyline: Vec<GpsPoint> = track[start..end].to_vec();

            let polyline_json =
                serde_json::to_string(&new_polyline).unwrap_or_else(|_| "[]".to_string());
            let distance = calculate_route_distance(&new_polyline);
            let bounds = tracematch::geo_utils::compute_bounds(&new_polyline);

            self.db
                .execute(
                    "UPDATE sections SET
                        representative_activity_id = ?,
                        polyline_json = ?,
                        distance_meters = ?,
                        is_user_defined = 1,
                        updated_at = ?,
                        bounds_min_lat = ?,
                        bounds_max_lat = ?,
                        bounds_min_lng = ?,
                        bounds_max_lng = ?
                     WHERE id = ?",
                    params![activity_id, polyline_json, distance, updated_at,
                            bounds.min_lat, bounds.max_lat, bounds.min_lng, bounds.max_lng, section_id],
                )
                .map_err(|e| format!("Failed to update section reference: {}", e))?;

            // Re-match all activities against the new polyline
            self.rematch_section_activities(section_id, &new_polyline)?;

            // Add the new reference activity with proper portion details (all laps)
            // (rematch only includes previously-associated activities)
            for portion in &portions {
                self.add_section_activity_with_portion(section_id, portion)?;
            }
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

            let portions = compute_section_portions(activity_id, &track, &polyline);
            if portions.is_empty() {
                // Fallback for custom sections - the source activity should always match
                self.add_section_activity(section_id, activity_id)?;
            } else {
                for portion in &portions {
                    self.add_section_activity_with_portion(section_id, portion)?;
                }
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

        // Re-add only activities that still match, with full portion details (all laps)
        for aid in &activity_ids {
            if let Some(track) = self.get_gps_track(aid) {
                for portion in compute_section_portions(aid, &track, new_polyline) {
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

        // Compute full portion details for each matching activity (all laps)
        for aid in &activity_ids {
            if let Some(track) = track_map.get(aid) {
                let portions = compute_section_portions(aid, track, polyline);
                if !portions.is_empty() {
                    for portion in &portions {
                        self.add_section_activity_with_portion(section_id, portion)?;
                    }
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
        let trimmed_json =
            serde_json::to_string(&trimmed).unwrap_or_else(|_| "[]".to_string());
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

    /// Check if a section has original (pre-trim) bounds that can be restored.
    pub fn has_original_bounds(&self, section_id: &str) -> bool {
        self.db
            .query_row(
                "SELECT original_polyline_json IS NOT NULL FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(false)
    }

    /// Get the representative activity's full GPS track for section expansion.
    /// Returns the track + the indices where the current section starts/ends within it.
    /// Used by the UI to let users extend section bounds beyond the current polyline.
    pub fn get_section_extension_track(
        &self,
        section_id: &str,
    ) -> Result<(Vec<GpsPoint>, u32, u32), String> {
        // Load section data: representative activity ID + current polyline
        let (rep_id, polyline_json): (Option<String>, String) = self
            .db
            .query_row(
                "SELECT representative_activity_id, polyline_json FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| format!("Section not found: {}", section_id))?;

        let rep_id = rep_id.ok_or_else(|| "Section has no representative activity".to_string())?;

        // Load the representative activity's full GPS track
        let track = self
            .get_gps_track(&rep_id)
            .ok_or_else(|| format!("GPS track not found for activity: {}", rep_id))?;

        if track.len() < 3 {
            return Err("Representative activity track too short".to_string());
        }

        let polyline: Vec<GpsPoint> = serde_json::from_str(&polyline_json)
            .map_err(|e| format!("Failed to parse polyline: {}", e))?;

        if polyline.len() < 2 {
            return Err("Section polyline too short".to_string());
        }

        // Find where the section starts/ends in the representative activity's track
        // Use find_all_track_portions with a generous threshold to locate the section
        let portions = find_all_track_portions(&track, &polyline, 100.0);

        if portions.is_empty() {
            // Fallback: use nearest-point matching for start and end
            let ref_tree = build_rtree(&track);
            let start_query = [polyline[0].latitude, polyline[0].longitude];
            let end_query = [
                polyline[polyline.len() - 1].latitude,
                polyline[polyline.len() - 1].longitude,
            ];

            let start_idx = ref_tree
                .nearest_neighbor(&start_query)
                .map(|p| p.idx as u32)
                .unwrap_or(0);
            let end_idx = ref_tree
                .nearest_neighbor(&end_query)
                .map(|p| p.idx as u32)
                .unwrap_or(track.len() as u32 - 1);

            let (s, e) = if start_idx <= end_idx {
                (start_idx, end_idx)
            } else {
                (end_idx, start_idx)
            };
            return Ok((track, s, e));
        }

        // Use the first (longest) matching portion
        let best = portions
            .iter()
            .max_by_key(|(s, e, _)| e - s)
            .unwrap();
        Ok((track, best.0 as u32, best.1 as u32))
    }

    /// Expand section bounds by replacing the polyline with a new one (can be larger than original).
    /// Backs up the original polyline on first edit (preserves true original across multiple edits).
    /// Re-matches all activities against the new polyline.
    pub fn expand_section_bounds(
        &mut self,
        section_id: &str,
        new_polyline_json: &str,
    ) -> Result<(), String> {
        let new_polyline: Vec<GpsPoint> = serde_json::from_str(new_polyline_json)
            .map_err(|e| format!("Failed to parse new polyline: {}", e))?;

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
        let bounds = tracematch::geo_utils::compute_bounds(&new_polyline);
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
                    new_polyline_json,
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

        // Compute bounds from polyline
        let (bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng) =
            if section.polyline.len() >= 2 {
                let bounds = tracematch::geo_utils::compute_bounds(&section.polyline);
                (Some(bounds.min_lat), Some(bounds.max_lat), Some(bounds.min_lng), Some(bounds.max_lng))
            } else {
                (None, None, None, None)
            };

        self.db
            .execute(
                "INSERT OR REPLACE INTO sections (
                    id, section_type, name, sport_type, polyline_json, distance_meters,
                    representative_activity_id, confidence, observation_count, average_spread,
                    point_density_json, scale, version, is_user_defined, stability,
                    source_activity_id, start_index, end_index, created_at, updated_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                    section.updated_at,
                    bounds_min_lat,
                    bounds_max_lat,
                    bounds_min_lng,
                    bounds_max_lng,
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

/// Compute all traversals (laps) of an activity over a section polyline.
/// Uses the tracematch lap-splitting algorithm.
fn compute_section_portions(
    activity_id: &str,
    track: &[GpsPoint],
    section_polyline: &[GpsPoint],
) -> Vec<SectionPortion> {
    let traversals = find_all_track_portions(track, section_polyline, 50.0);

    traversals
        .into_iter()
        .map(|(start_idx, end_idx, direction)| {
            let distance = calculate_route_distance(&track[start_idx..end_idx]);
            SectionPortion {
                activity_id: activity_id.to_string(),
                start_index: start_idx as u32,
                end_index: end_idx as u32,
                distance_meters: distance,
                direction,
            }
        })
        .collect()
}
