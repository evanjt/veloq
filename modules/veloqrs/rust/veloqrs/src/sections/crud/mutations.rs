//! Section mutations: create, rename, reference, delete, save, activity matching.
//!
//! Covers create/save operations, reference-activity selection (including complex
//! auto-vs-custom matching logic), junction-table additions, rename, delete, and
//! the activity-to-section matching helpers used by the editing submodule.

use super::super::{CreateSectionParams, Section, SectionType};
use super::{compute_section_portions, compute_section_portions_strict};
use crate::persistence::PersistentRouteEngine;
use rusqlite::params;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tracematch::matching::calculate_route_distance;
use tracematch::{GpsPoint, SectionPortion};

impl PersistentRouteEngine {
    /// Exclude an activity from a section's analysis.
    /// Sets the `excluded` flag to 1 on the junction table row(s).
    pub fn exclude_activity_from_section(
        &mut self,
        section_id: &str,
        activity_id: &str,
    ) -> Result<(), String> {
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
    pub fn include_activity_in_section(
        &mut self,
        section_id: &str,
        activity_id: &str,
    ) -> Result<(), String> {
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
                (
                    Some(bounds.min_lat),
                    Some(bounds.max_lat),
                    Some(bounds.min_lng),
                    Some(bounds.max_lng),
                )
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
    pub fn add_section_activity(
        &mut self,
        section_id: &str,
        activity_id: &str,
    ) -> Result<(), String> {
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

    /// Accept (pin) an auto-detected section so it survives re-detection
    /// and its consensus polyline stops evolving.
    pub fn accept_section(&mut self, section_id: &str) -> Result<(), String> {
        let updated_at = chrono::Utc::now().to_rfc3339();
        let rows = self
            .db
            .execute(
                "UPDATE sections SET is_user_defined = 1, updated_at = ? WHERE id = ?",
                params![updated_at, section_id],
            )
            .map_err(|e| format!("Failed to accept section: {}", e))?;
        if rows == 0 {
            return Err(format!("Section not found: {}", section_id));
        }
        self.mark_section_accepted_in_memory(section_id);
        self.invalidate_section_cache(section_id);
        Ok(())
    }

    /// Accept all current auto-detected sections.
    pub fn accept_all_sections(&mut self) -> Result<u32, String> {
        let updated_at = chrono::Utc::now().to_rfc3339();
        let count = self
            .db
            .execute(
                "UPDATE sections SET is_user_defined = 1, updated_at = ?
                 WHERE section_type = 'auto' AND is_user_defined = 0 AND disabled = 0",
                params![updated_at],
            )
            .map_err(|e| format!("Failed to accept sections: {}", e))?;
        self.mark_all_auto_sections_accepted();
        self.invalidate_all_section_caches();
        Ok(count as u32)
    }

    /// Rename a section. Auto-promotes to accepted if it's an auto-detected section.
    pub fn rename_section(&mut self, section_id: &str, name: &str) -> Result<(), String> {
        let updated_at = chrono::Utc::now().to_rfc3339();

        let rows = self
            .db
            .execute(
                "UPDATE sections SET name = ?, is_user_defined = 1, updated_at = ? WHERE id = ?",
                params![name, updated_at, section_id],
            )
            .map_err(|e| format!("Failed to rename section: {}", e))?;

        if rows == 0 {
            return Err(format!("Section not found: {}", section_id));
        }

        self.invalidate_section_cache(section_id);
        self.update_section_name_in_memory(section_id, name);
        self.mark_section_accepted_in_memory(section_id);

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

            let polyline_json =
                serde_json::to_string(&polyline).unwrap_or_else(|_| "[]".to_string());
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
                    params![
                        activity_id,
                        activity_id,
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
        } else {
            // For auto sections, extract the section-matching portion from the new activity's track
            let current_polyline: Vec<GpsPoint> =
                serde_json::from_str(&current_polyline_json).unwrap_or_default();

            if current_polyline.is_empty() {
                return Err("Section has no polyline to match against".to_string());
            }

            let current_distance = calculate_route_distance(&current_polyline);

            // Use strict matching (30m threshold, gap tolerance 1) to avoid
            // including parallel roads or large non-matching spans
            let portions = compute_section_portions_strict(activity_id, &track, &current_polyline);
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
            let new_distance = calculate_route_distance(&new_polyline);

            log::info!(
                "tracematch: [set_section_reference] section={} activity={} \
                 track_points={} portion_points={} current_distance={:.0}m new_distance={:.0}m",
                section_id,
                activity_id,
                track.len(),
                new_polyline.len(),
                current_distance,
                new_distance,
            );

            // Sanity check: if extracted portion is > 3x the original section length,
            // the matching likely went wrong (e.g. parallel road included). In that case,
            // only update the representative_activity_id without replacing the polyline.
            let max_allowed_distance = current_distance * 3.0;
            if new_distance > max_allowed_distance {
                log::warn!(
                    "tracematch: [set_section_reference] Extracted portion ({:.0}m) exceeds 3x \
                     original section length ({:.0}m). Keeping original polyline, only updating \
                     representative_activity_id.",
                    new_distance,
                    current_distance,
                );

                self.db
                    .execute(
                        "UPDATE sections SET
                            representative_activity_id = ?,
                            is_user_defined = 1,
                            updated_at = ?
                         WHERE id = ?",
                        params![activity_id, updated_at, section_id],
                    )
                    .map_err(|e| format!("Failed to update section reference: {}", e))?;
            } else {
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

                let polyline_json =
                    serde_json::to_string(&new_polyline).unwrap_or_else(|_| "[]".to_string());
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
                        params![
                            activity_id,
                            polyline_json,
                            new_distance,
                            updated_at,
                            bounds.min_lat,
                            bounds.max_lat,
                            bounds.min_lng,
                            bounds.max_lng,
                            section_id
                        ],
                    )
                    .map_err(|e| format!("Failed to update section reference: {}", e))?;

                // Re-match all activities against the new polyline
                self.rematch_section_activities(section_id, &new_polyline)?;
            }

            // Add the new reference activity with proper portion details (all laps)
            // (rematch only includes previously-associated activities)
            for portion in &portions {
                self.add_section_activity_with_portion(section_id, portion)?;
            }
        }

        // For custom sections, add the reference activity with portion details
        if section_type == "custom" {
            // Get the updated polyline for custom section
            let polyline_json: String = self
                .db
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
    pub(super) fn rematch_section_activities(
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
                (
                    Some(bounds.min_lat),
                    Some(bounds.max_lat),
                    Some(bounds.min_lng),
                    Some(bounds.max_lng),
                )
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
