//! Section CRUD operations.
//!
//! Unified database operations for all sections (both auto and custom).
//! All sections are stored in a single `sections` table with a `section_type` discriminator.

use super::{CreateSectionParams, Section, SectionSummary, SectionType};
use crate::persistence::PersistentRouteEngine;
use rusqlite::params;
use std::time::{SystemTime, UNIX_EPOCH};
use tracematch::GpsPoint;

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

                -- Junction table for section-activity relationships
                CREATE TABLE IF NOT EXISTS section_activities (
                    section_id TEXT NOT NULL,
                    activity_id TEXT NOT NULL,
                    PRIMARY KEY (section_id, activity_id),
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
                version: row.get::<_, Option<u32>>(12)?.unwrap_or(1),
                is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                stability: row.get(14)?,
                source_activity_id: row.get(15)?,
                start_index: row.get(16)?,
                end_index: row.get(17)?,
                created_at: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
                updated_at: row.get(19)?,
                route_ids: None, // TODO: Add route_ids junction table if needed
            })
        });

        match rows {
            Ok(iter) => iter
                .filter_map(|r| r.ok())
                .map(|mut s| {
                    s.visit_count = s.activity_ids.len() as u32;
                    s
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Get activity IDs for a section from the junction table.
    fn get_section_activity_ids(&self, section_id: &str) -> Vec<String> {
        let mut stmt = match self
            .db
            .prepare("SELECT activity_id FROM section_activities WHERE section_id = ?")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        stmt.query_map(params![section_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
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

        // Add source activity to junction table if provided
        if let Some(ref activity_id) = params.source_activity_id {
            let _ = self.add_section_activity(&id, activity_id);
        }

        Ok(id)
    }

    /// Add an activity to a section's activity list.
    pub fn add_section_activity(&mut self, section_id: &str, activity_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "INSERT OR IGNORE INTO section_activities (section_id, activity_id) VALUES (?, ?)",
                params![section_id, activity_id],
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

        Ok(())
    }

    /// Set a new reference activity for a section.
    /// This updates the representative_activity_id and reloads the polyline from the activity.
    pub fn set_section_reference(
        &mut self,
        section_id: &str,
        activity_id: &str,
    ) -> Result<(), String> {
        // Load the activity's GPS track
        let track = self
            .get_gps_track(activity_id)
            .ok_or_else(|| format!("Activity not found: {}", activity_id))?;

        // Get current section to determine indices
        let (start_index, end_index, section_type) = {
            let mut stmt = self
                .db
                .prepare("SELECT start_index, end_index, section_type FROM sections WHERE id = ?")
                .map_err(|e| e.to_string())?;

            stmt.query_row(params![section_id], |row| {
                Ok((
                    row.get::<_, Option<u32>>(0)?,
                    row.get::<_, Option<u32>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| format!("Section not found: {}", section_id))?
        };

        // Extract polyline based on section type
        let polyline: Vec<GpsPoint> = if section_type == "custom" {
            // For custom sections, use stored indices
            let start = start_index.unwrap_or(0) as usize;
            let end = end_index.unwrap_or(track.len() as u32) as usize;
            track
                .get(start..end.min(track.len()))
                .unwrap_or(&[])
                .to_vec()
        } else {
            // For auto sections, use the full track (or match against existing polyline)
            // TODO: Implement proper polyline matching for auto sections
            track.clone()
        };

        let polyline_json = serde_json::to_string(&polyline).unwrap_or_else(|_| "[]".to_string());
        let distance = calculate_polyline_distance(&polyline);
        let updated_at = chrono::Utc::now().to_rfc3339();

        // Update section with new reference
        self.db
            .execute(
                "UPDATE sections SET
                    representative_activity_id = ?,
                    polyline_json = ?,
                    distance_meters = ?,
                    updated_at = ?
                 WHERE id = ?",
                params![activity_id, polyline_json, distance, updated_at, section_id],
            )
            .map_err(|e| format!("Failed to update section reference: {}", e))?;

        // For custom sections, also update source_activity_id
        if section_type == "custom" {
            self.db
                .execute(
                    "UPDATE sections SET source_activity_id = ? WHERE id = ?",
                    params![activity_id, section_id],
                )
                .map_err(|e| format!("Failed to update source activity: {}", e))?;
        }

        // Add to junction table
        self.add_section_activity(section_id, activity_id)?;

        // Mark as user-defined
        self.db
            .execute(
                "UPDATE sections SET is_user_defined = 1 WHERE id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to mark section as user-defined: {}", e))?;

        Ok(())
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

            Ok(Section {
                id,
                section_type: SectionType::from_str(&section_type_str).unwrap_or(SectionType::Auto),
                name: row.get(2)?,
                sport_type: row.get(3)?,
                polyline: serde_json::from_str(&polyline_json).unwrap_or_default(),
                distance_meters: row.get(5)?,
                representative_activity_id: row.get(6)?,
                activity_ids: activity_ids.clone(),
                visit_count: activity_ids.len() as u32,
                confidence: row.get(7)?,
                observation_count: row.get(8)?,
                average_spread: row.get(9)?,
                point_density: point_density_json.and_then(|j| serde_json::from_str(&j).ok()),
                scale: row.get(11)?,
                version: row.get::<_, Option<u32>>(12)?.unwrap_or(1),
                is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                stability: row.get(14)?,
                source_activity_id: row.get(15)?,
                start_index: row.get(16)?,
                end_index: row.get(17)?,
                created_at: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
                updated_at: row.get(19)?,
                route_ids: None,
            })
        })
        .ok()
    }

    /// Get sections for a specific activity.
    pub fn get_sections_for_activity(&self, activity_id: &str) -> Vec<Section> {
        let section_ids: Vec<String> = {
            let mut stmt = match self
                .db
                .prepare("SELECT section_id FROM section_activities WHERE activity_id = ?")
            {
                Ok(s) => s,
                Err(_) => return Vec::new(),
            };

            stmt.query_map(params![activity_id], |row| row.get(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default()
        };

        section_ids
            .iter()
            .filter_map(|id| self.get_section(id))
            .collect()
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
                    section.version,
                    if section.is_user_defined { 1 } else { 0 },
                    section.stability,
                    section.source_activity_id,
                    section.start_index,
                    section.end_index,
                    section.created_at,
                    section.updated_at,
                ],
            )
            .map_err(|e| format!("Failed to save section: {}", e))?;

        // Update junction table
        for activity_id in &section.activity_ids {
            self.add_section_activity(&section.id, activity_id)?;
        }

        Ok(())
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
