//! Section mutations: create, rename, reference, delete, save, activity matching.
//!
//! Covers create/save operations, reference-activity selection (including complex
//! auto-vs-custom matching logic), junction-table additions, rename, delete, and
//! the activity-to-section matching helpers used by the editing submodule.

use super::super::{
    BatchAttachSummary, CreateSectionParams, IndexActivitySummary, Section, SectionType,
};
use super::compute_section_portions;
use crate::persistence::PersistentRouteEngine;
use crate::sections::assign_carried_exclusions;
use rusqlite::params;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tracematch::matching::calculate_route_distance;
use tracematch::{GpsPoint, SectionPortion};

/// A section's exclusion state, read before a junction rebuild deletes the
/// rows that carry it. `full` holds activities with every row excluded;
/// `partial` holds per-lap state keyed by the excluded rows' own
/// `start_index` values.
#[derive(Default)]
pub(super) struct ExclusionSnapshot {
    pub(super) full: Vec<String>,
    pub(super) partial: Vec<(String, Vec<u32>)>,
}

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
        // The perf LRU serves excluded=0 queries; a stale entry makes the
        // exclusion look like a no-op on the performance panel.
        self.invalidate_perf_cache();
        Ok(())
    }

    /// Exclude one traversal (junction row) from a section's analysis,
    /// addressed by its start index. The activity's other laps keep counting.
    pub fn exclude_section_lap(
        &mut self,
        section_id: &str,
        activity_id: &str,
        start_index: u32,
    ) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE section_activities SET excluded = 1
                 WHERE section_id = ? AND activity_id = ? AND start_index = ?",
                params![section_id, activity_id, start_index],
            )
            .map_err(|e| format!("Failed to exclude lap: {}", e))?;
        self.refresh_section_in_memory(section_id);
        self.invalidate_section_cache(section_id);
        self.invalidate_perf_cache();
        Ok(())
    }

    /// Re-include a previously excluded traversal.
    pub fn include_section_lap(
        &mut self,
        section_id: &str,
        activity_id: &str,
        start_index: u32,
    ) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE section_activities SET excluded = 0
                 WHERE section_id = ? AND activity_id = ? AND start_index = ?",
                params![section_id, activity_id, start_index],
            )
            .map_err(|e| format!("Failed to include lap: {}", e))?;
        self.refresh_section_in_memory(section_id);
        self.invalidate_section_cache(section_id);
        self.invalidate_perf_cache();
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
        self.invalidate_perf_cache();
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
        let polyline_blob = crate::persistence::codec::serialize_points(&params.polyline)
            .map_err(|e| format!("Failed to encode polyline: {}", e))?;

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
                    id, section_type, name, sport_type, polyline_json, polyline_blob, distance_meters,
                    representative_activity_id, source_activity_id, start_index, end_index,
                    created_at, is_user_defined,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    id,
                    section_type.as_str(),
                    params.name,
                    params.sport_type,
                    crate::persistence::codec::NO_POLYLINE_JSON,
                    polyline_blob,
                    params.distance_meters,
                    params.source_activity_id.as_ref(),
                    params.source_activity_id,
                    params.start_index,
                    params.end_index,
                    created_at,
                    1,
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

        // Cache the new custom section in memory so the in-memory matcher
        // (index_new_activity) can add future activities to it, and so
        // get_sections() reflects it without a reload.
        self.refresh_section_in_memory(&id);

        // Refresh the materialized activity_indicators table so feed cards
        // pick up section_pr / section_trend chips for the new section without
        // requiring an app restart.
        if let Err(e) = self.recompute_activity_indicators() {
            log::warn!(
                "tracematch: [create_section] indicator recompute failed: {}",
                e
            );
        }

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
        // The row becomes user-owned: the resolved corridor name (if any)
        // moves onto it and the intent retires, before the flag flip hides
        // the row from resolution.
        self.adopt_corridor_name(section_id);
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
        // The section is now a durable intent row; the registry relinquishes it
        // so auto detection stops re-emitting (and colliding on) its ground.
        self.section_identity_relinquish(section_id);
        self.drop_section_pin(section_id);
        Ok(())
    }

    /// Accept all current auto-detected sections.
    pub fn accept_all_sections(&mut self) -> Result<u32, String> {
        // Land every resolved corridor name on its row before the bulk
        // promotion hides those rows from resolution.
        let named: Vec<String> = self
            .get_named_corridors()
            .into_iter()
            .filter(|c| c.primary)
            .filter_map(|c| c.section_id)
            .collect();
        for id in &named {
            self.adopt_corridor_name(id);
        }
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
        // Every managed auto section is now durable; reseed so the registry holds
        // only the (now empty) non-user-defined set and carries none of them.
        self.section_identity_reseed();
        Ok(count as u32)
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
        // Every branch below promotes the row to user-defined; the resolved
        // corridor name lands on the row first so the promotion keeps it.
        self.adopt_corridor_name(section_id);
        // Verify activity exists and get its track
        let track = self
            .get_gps_track(activity_id)
            .ok_or_else(|| format!("Activity not found: {}", activity_id))?;

        // Get current section to determine type and indices
        let (start_index, end_index, section_type): (Option<u32>, Option<u32>, String) = {
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

        let updated_at = chrono::Utc::now().to_rfc3339();

        if section_type == "custom" {
            // For custom sections, update polyline from new activity's track using indices
            let start = start_index.unwrap_or(0) as usize;
            let end = end_index.unwrap_or(track.len() as u32) as usize;
            let polyline: Vec<GpsPoint> = track
                .get(start..end.min(track.len()))
                .unwrap_or(&[])
                .to_vec();

            let polyline_blob = crate::persistence::codec::serialize_points(&polyline)
                .map_err(|e| format!("Failed to encode polyline: {}", e))?;
            let distance = calculate_route_distance(&polyline);
            let bounds = tracematch::geo_utils::compute_bounds(&polyline);

            self.db
                .execute(
                    "UPDATE sections SET
                        representative_activity_id = ?,
                        source_activity_id = ?,
                        polyline_json = ?,
                        polyline_blob = ?,
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
                        crate::persistence::codec::NO_POLYLINE_JSON,
                        polyline_blob,
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
                self.stored_section_polyline(section_id).unwrap_or_default();

            if current_polyline.is_empty() {
                return Err("Section has no polyline to match against".to_string());
            }

            let current_distance = calculate_route_distance(&current_polyline);

            let portions = compute_section_portions(
                activity_id,
                &track,
                &current_polyline,
                &self.section_config,
            );
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
                    // The polyline_json column no longer carries geometry on new
                    // rows, so serialise the decoded current polyline.
                    let original_json = serde_json::to_string(&current_polyline)
                        .map_err(|e| format!("Failed to backup original polyline: {}", e))?;
                    self.db
                        .execute(
                            "UPDATE sections SET original_polyline_json = ? WHERE id = ?",
                            params![original_json, section_id],
                        )
                        .map_err(|e| format!("Failed to backup original polyline: {}", e))?;
                }

                let polyline_blob = crate::persistence::codec::serialize_points(&new_polyline)
                    .map_err(|e| format!("Failed to encode polyline: {}", e))?;
                let bounds = tracematch::geo_utils::compute_bounds(&new_polyline);

                self.db
                    .execute(
                        "UPDATE sections SET
                            representative_activity_id = ?,
                            polyline_json = ?,
                            polyline_blob = ?,
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
                            crate::persistence::codec::NO_POLYLINE_JSON,
                            polyline_blob,
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
            let polyline: Vec<GpsPoint> =
                self.stored_section_polyline(section_id).unwrap_or_default();

            let portions =
                compute_section_portions(activity_id, &track, &polyline, &self.section_config);
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

        // Setting a reference promotes an auto section to user-defined; relinquish
        // it from the registry so detection stops re-emitting its (edited) ground.
        self.drop_section_pin(section_id);
        self.section_identity_relinquish(section_id);

        Ok(())
    }

    /// Re-match activities against an updated section polyline.
    /// Checks all previously-associated activities and keeps only those that still overlap.
    pub(super) fn rematch_section_activities(
        &mut self,
        section_id: &str,
        new_polyline: &[GpsPoint],
    ) -> Result<(), String> {
        // ALL members, excluded ones included: the flag is a user
        // decision and must survive the rebuild, not vanish with the rows.
        let exclusions = self.capture_exclusions(section_id);
        let mut activity_ids = self.get_section_activity_ids(section_id);
        activity_ids.extend(exclusions.full.iter().cloned());

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
                for portion in
                    compute_section_portions(aid, &track, new_polyline, &self.section_config)
                {
                    self.add_section_activity_with_portion(section_id, &portion)?;
                }
            }
        }
        self.reapply_exclusions(section_id, &exclusions)?;

        Ok(())
    }

    /// Manually attach one activity to one section, for the activity
    /// screen's "should have matched" affordance. Relaxed bars (2.5x
    /// proximity, 40% quality) because the user has already asserted the
    /// match. Idempotent: a pair that already holds junction rows is left
    /// alone — detection's per-lap rows must not gain a stacked duplicate
    /// at a different start index.
    pub fn rematch_activity_to_section(
        &mut self,
        activity_id: &str,
        section_id: &str,
    ) -> Result<bool, String> {
        let track = match self.get_gps_track(activity_id) {
            Some(t) if t.len() >= 3 => t,
            _ => return Ok(false),
        };
        let polyline = match self.get_sections().iter().find(|s| s.id == section_id) {
            Some(s) if !s.polyline.is_empty() => s.polyline.clone(),
            _ => return Ok(false),
        };
        let existing: i64 = self
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_activities WHERE section_id = ? AND activity_id = ?",
                params![section_id, activity_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if existing > 0 {
            return Ok(true);
        }

        let threshold = self.section_config.proximity_threshold * 2.5;
        let spans = tracematch::sections::optimized::find_all_section_spans_in_route(
            &track, &polyline, threshold,
        );
        let best = spans
            .into_iter()
            .filter(|(_, _, quality, _)| *quality >= 0.4)
            .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
        let Some((start, end, _quality, same_dir)) = best else {
            return Ok(false);
        };
        let portion = &track[start..end.min(track.len())];
        let distance = tracematch::matching::calculate_route_distance(portion);
        let direction = if same_dir {
            tracematch::Direction::Same
        } else {
            tracematch::Direction::Reverse
        };
        self.insert_section_activity(
            section_id,
            activity_id,
            &direction,
            start as u32,
            end as u32,
            distance,
        )?;
        self.refresh_section_in_memory(section_id);
        self.invalidate_section_cache(section_id);
        self.drop_section_pin(section_id);
        self.invalidate_perf_cache();
        Ok(true)
    }

    /// Restore exclusions after a junction rebuild. Fully excluded
    /// activities flag every new row. A partially excluded activity carries
    /// its per-lap state onto the nearest rebuilt row by `start_index`, so
    /// the small index shifts a geometry edit causes are absorbed; a lap
    /// further than half the smallest gap between adjacent rebuilt rows is
    /// dropped rather than guessed. An excluded activity that no longer
    /// matches the new line has no rows, and nothing to carry.
    pub(super) fn reapply_exclusions(
        &self,
        section_id: &str,
        snapshot: &ExclusionSnapshot,
    ) -> Result<(), String> {
        for aid in &snapshot.full {
            self.db
                .execute(
                    "UPDATE section_activities SET excluded = 1 WHERE section_id = ? AND activity_id = ?",
                    params![section_id, aid],
                )
                .map_err(|e| format!("Failed to reapply exclusion: {}", e))?;
        }
        for (aid, carried_starts) in &snapshot.partial {
            let rebuilt: Vec<u32> = {
                let mut stmt = self
                    .db
                    .prepare(
                        "SELECT start_index FROM section_activities
                         WHERE section_id = ? AND activity_id = ? ORDER BY start_index",
                    )
                    .map_err(|e| format!("Failed to read rebuilt laps: {}", e))?;
                stmt.query_map(params![section_id, aid], |row| row.get(0))
                    .map_err(|e| format!("Failed to read rebuilt laps: {}", e))?
                    .filter_map(|r| r.ok())
                    .collect()
            };
            for start in assign_carried_exclusions(carried_starts, &rebuilt) {
                self.db
                    .execute(
                        "UPDATE section_activities SET excluded = 1
                         WHERE section_id = ? AND activity_id = ? AND start_index = ?",
                        params![section_id, aid, start],
                    )
                    .map_err(|e| format!("Failed to reapply lap exclusion: {}", e))?;
            }
        }
        Ok(())
    }

    /// Read a section's exclusion state before a junction rebuild deletes
    /// the rows that carry it.
    pub(super) fn capture_exclusions(&self, section_id: &str) -> ExclusionSnapshot {
        let any: bool = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM section_activities
                 WHERE section_id = ? AND excluded = 1)",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !any {
            return ExclusionSnapshot::default();
        }
        let mut rows: Vec<(String, u32, bool)> = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT activity_id, start_index, excluded FROM section_activities
             WHERE section_id = ? ORDER BY activity_id, start_index",
        ) {
            if let Ok(mapped) = stmt.query_map(params![section_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? != 0))
            }) {
                rows.extend(mapped.filter_map(|r| r.ok()));
            }
        }
        let mut snapshot = ExclusionSnapshot::default();
        let mut i = 0;
        while i < rows.len() {
            let aid = rows[i].0.clone();
            let mut starts = Vec::new();
            let mut count = 0usize;
            while i < rows.len() && rows[i].0 == aid {
                if rows[i].2 {
                    starts.push(rows[i].1);
                }
                count += 1;
                i += 1;
            }
            if starts.is_empty() {
                continue;
            }
            if starts.len() == count {
                snapshot.full.push(aid);
            } else {
                snapshot.partial.push((aid, starts));
            }
        }
        snapshot
    }

    /// Cheap post-ingest indexing for one freshly downloaded activity: match it
    /// against existing sections, insert junction rows with portions, regroup
    /// incrementally, and refresh indicators. Does NOT create new sections - a
    /// genuinely new repeated stretch waits for the next full detection run.
    ///
    /// Cost is O(1 activity × M sections) plus an incremental regroup, so it
    /// fits inside a background push handler where a full O(N²) detection
    /// cannot.
    pub fn index_new_activity(
        &mut self,
        activity_id: &str,
    ) -> Result<IndexActivitySummary, String> {
        let mut summary = IndexActivitySummary::default();
        let (matched, portions) = self.attach_activity_junctions(activity_id)?;
        summary.matched_sections = matched;
        summary.inserted_portions = portions;

        // Ingest marked groups dirty, so this takes the incremental regroup
        // path and places the new activity in a route group. recompute_groups
        // also refreshes activity indicators at its end.
        if self.groups_dirty {
            self.get_groups();
            summary.regrouped = true;
            summary.indicators_recomputed = true;
        } else if summary.inserted_portions > 0 {
            match self.recompute_activity_indicators() {
                Ok(()) => summary.indicators_recomputed = true,
                Err(e) => log::warn!(
                    "tracematch: [index_new_activity] indicator recompute failed: {}",
                    e
                ),
            }
        }

        log::info!(
            "tracematch: [index_new_activity] {} matched {} sections ({} portions, regrouped={})",
            activity_id,
            summary.matched_sections,
            summary.inserted_portions,
            summary.regrouped
        );

        Ok(summary)
    }

    /// Junction-matching core of the attach tier: match one activity against
    /// the existing catalogue and (re)write its junction rows with portions.
    /// Never creates sections and never regroups - callers own the tail.
    /// Returns (matched section count, inserted portion count).
    fn attach_activity_junctions(&mut self, activity_id: &str) -> Result<(u32, u32), String> {
        let track = match self.get_gps_track(activity_id) {
            Some(t) if t.len() >= 3 => t,
            _ => return Ok((0, 0)),
        };

        let sport_type = self.sport_of_activity(activity_id);
        let pooled = self.section_config.pool_sports;

        // Every section's passes up front: get_sections() borrows the
        // in-memory Vec, and the insert loop below needs &mut self. The
        // matcher is detection's own, so the rows attach writes are the
        // rows a re-detect over the same pool would write.
        let matched: Vec<(String, Vec<SectionPortion>)> = self
            .get_sections()
            .iter()
            .filter(|section| {
                // Mirror detection's partition, or attach builds a
                // catalogue a re-detect disagrees with.
                pooled || sport_type.as_ref().is_none_or(|s| &section.sport_type == s)
            })
            .map(|section| {
                (
                    section.id.clone(),
                    compute_section_portions(
                        activity_id,
                        &track,
                        &section.polyline,
                        &self.section_config,
                    ),
                )
            })
            .filter(|(_, portions)| !portions.is_empty())
            .collect();

        let mut matched_sections = 0;
        let mut inserted_portions = 0;
        for (section_id, portions) in &matched {
            matched_sections += 1;

            // Replace any rows a previous run (or a later full detection) left
            // for this pair, so near-duplicate start_index rows can't stack up.
            // The exclusion state is a user decision and rides across the
            // rewrite (whole snapshot: reapplying untouched pairs is a no-op).
            let exclusions = self.capture_exclusions(section_id);
            self.db
                .execute(
                    "DELETE FROM section_activities WHERE section_id = ? AND activity_id = ?",
                    params![section_id, activity_id],
                )
                .map_err(|e| format!("Failed to clear section_activities: {}", e))?;

            for portion in portions {
                self.insert_section_activity(
                    section_id,
                    activity_id,
                    &portion.direction,
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                )?;
                inserted_portions += 1;
            }
            self.reapply_exclusions(section_id, &exclusions)?;
            self.refresh_section_in_memory(section_id);
            self.invalidate_section_cache(section_id);
            self.invalidate_perf_cache();
        }

        Ok((matched_sections, inserted_portions))
    }

    /// Per-add half of the attach tier: junction rows for one just-stored
    /// activity, errors logged (ingest must not abort on one bad track).
    /// Returns (matched sections, inserted portions).
    pub fn attach_stored_activity(&mut self, activity_id: &str) -> (u32, u32) {
        match self.attach_activity_junctions(activity_id) {
            Ok(counts) => counts,
            Err(e) => {
                log::warn!("tracematch: [attach] {} failed: {}", activity_id, e);
                (0, 0)
            }
        }
    }

    /// Batch tail of the attach tier: one regroup (ingest marks groups
    /// dirty) or, failing that, one indicator recompute when any junction
    /// rows landed. Returns (regrouped, indicators_recomputed).
    pub fn attach_finalize(&mut self, inserted_portions: u32) -> (bool, bool) {
        if self.groups_dirty {
            self.get_groups();
            (true, true)
        } else if inserted_portions > 0 {
            match self.recompute_activity_indicators() {
                Ok(()) => (false, true),
                Err(e) => {
                    log::warn!("tracematch: [attach] indicator recompute failed: {}", e);
                    (false, false)
                }
            }
        } else {
            (false, false)
        }
    }

    /// Attach tier of the two-tier ingest: junction rows for every stored
    /// activity in the batch, then ONE regroup/indicator tail. Visits, laps,
    /// and PRs read from the junction table are current the moment this
    /// returns; new sections wait for the conditioning run.
    pub fn attach_new_activities(&mut self, activity_ids: &[String]) -> BatchAttachSummary {
        let mut summary = BatchAttachSummary::default();
        for id in activity_ids {
            let (matched, portions) = self.attach_stored_activity(id);
            if matched > 0 {
                summary.attached_activities += 1;
                summary.inserted_portions += portions;
            }
        }

        let (regrouped, indicators) = self.attach_finalize(summary.inserted_portions);
        summary.regrouped = regrouped;
        summary.indicators_recomputed = indicators;

        log::info!(
            "tracematch: [attach] {}/{} activities attached ({} portions, regrouped={})",
            summary.attached_activities,
            activity_ids.len(),
            summary.inserted_portions,
            summary.regrouped
        );
        summary
    }

    /// Match activities against a section polyline, adding any that overlap
    /// (≥3 points) to the junction table. Pooled, every activity is a
    /// candidate: a section's sport names it, it does not fence it.
    pub fn match_activities_to_section(
        &mut self,
        section_id: &str,
        polyline: &[GpsPoint],
        sport_type: &str,
    ) -> Result<u32, String> {
        if polyline.is_empty() {
            return Ok(0);
        }

        let activity_ids = if self.section_config.pool_sports {
            self.get_activity_ids()
        } else {
            self.get_activity_ids_by_sport(sport_type)
        };

        if activity_ids.is_empty() {
            return Ok(0);
        }

        log::info!(
            "tracematch: [match_activities_to_section] Checking {} activities against section {} (sport_type '{}')",
            activity_ids.len(),
            section_id,
            sport_type
        );

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
                let portions = compute_section_portions(aid, track, polyline, &self.section_config);
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
        // Drop the polyline backup with the demotion: the catalogue save
        // wipes only backup-free auto rows before re-inserting from
        // memory, so a demoted row still carrying its backup collides.
        self.db
            .execute(
                "UPDATE sections SET is_user_defined = 0, original_polyline_json = NULL WHERE id = ?",
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
        // Record the durable delete intent BEFORE the row is gone, so the deleted
        // corridor stays deleted across a resync (invariant 6). A missing section
        // is a no-op here, so nothing is stranded if the DELETE below finds none.
        self.record_section_intent(section_id, "deleted");

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

        // Remove from in-memory cache and relinquish from the identity registry so
        // a later detect neither carries nor re-mints the removed section.
        self.remove_section_from_memory(section_id);
        self.drop_section_pin(section_id);
        self.section_identity_relinquish(section_id);

        // Drop the now-orphaned section_pr / section_trend rows from the
        // materialized indicators table so feed cards stop showing chips
        // for a section the user just removed.
        if let Err(e) = self.recompute_activity_indicators() {
            log::warn!(
                "tracematch: [delete_section] indicator recompute failed: {}",
                e
            );
        }

        Ok(())
    }

    /// Save a section (insert or update).
    /// Used by section detection to persist auto-detected sections.
    pub fn save_section(&mut self, section: &Section) -> Result<(), String> {
        let polyline_blob = crate::persistence::codec::serialize_points(&section.polyline)
            .map_err(|e| format!("Failed to encode polyline: {}", e))?;
        let point_density_blob = match section.point_density.as_ref() {
            Some(pd) => Some(
                crate::persistence::codec::serialize(pd)
                    .map_err(|e| format!("Failed to encode point density: {}", e))?,
            ),
            None => None,
        };

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
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    polyline_blob, point_density_blob
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    section.id,
                    section.section_type.as_str(),
                    section.name,
                    section.sport_type,
                    crate::persistence::codec::NO_POLYLINE_JSON,
                    section.distance_meters,
                    section.representative_activity_id,
                    section.confidence,
                    section.observation_count,
                    section.average_spread,
                    None::<String>, // point_density_json: legacy column, blob is authoritative
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
                    polyline_blob,
                    point_density_blob,
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
