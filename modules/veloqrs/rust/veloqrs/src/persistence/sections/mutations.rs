//! Section mutations: create, rename, reference, delete, activity matching.
//!
//! Covers create/save operations, reference-activity selection (including complex
//! auto-vs-custom matching logic), junction-table additions, rename, delete, and
//! the activity-to-section matching helpers used by the editing submodule.

use super::{compute_section_portions, forced_portions};
use crate::persistence::PersistentEngine;
use crate::sections::{BatchAttachSummary, CreateSectionParams, IndexActivitySummary, SectionType};
use crate::sections::{LapCarry, assign_carried_exclusions};
use rusqlite::{OptionalExtension, params};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use tracematch::matching::calculate_route_distance;
use tracematch::{GpsPoint, SectionPortion};

/// The athlete's decisions on a section's junction rows, read before a
/// rebuild deletes the rows that carry them. `full` holds activities with
/// every row excluded; `partial` holds per-lap state: the `start_index` of
/// every row, excluded and included. `forced` holds the rides attached by
/// hand, which the rebuild re-cuts at the relaxed bar.
#[derive(Default)]
pub(super) struct UserDecisions {
    pub(super) full: Vec<String>,
    pub(super) partial: Vec<(String, LapCarry)>,
    pub(super) forced: Vec<String>,
}

impl PersistentEngine {
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

        // Determine section type based on whether source_activity_id is provided
        let (section_type, id_prefix) = if params.source_activity_id.is_some() {
            (SectionType::Custom, "custom")
        } else {
            (SectionType::Auto, "auto")
        };

        // The trailing number disambiguates draws that share a millisecond.
        let mut id = String::new();
        for n in 0..100_000u32 {
            let candidate = format!("{}_{}__{:05}", id_prefix, ts, n);
            let taken: bool = self
                .db
                .query_row(
                    "SELECT 1 FROM sections WHERE id = ?",
                    params![candidate],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| format!("Failed to check section id: {}", e))?
                .is_some();
            if !taken {
                id = candidate;
                break;
            }
        }
        if id.is_empty() {
            return Err(format!(
                "Failed to create section: every id for millisecond {} is taken",
                ts
            ));
        }
        let created_at = chrono::Utc::now().to_rfc3339();
        let polyline_blob = crate::persistence::codec::serialize_track_points(&params.polyline);

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

        // A cut from a stored ride is a slice of that ride, and the reference
        // triple is what a reader re-slices from. Without it the blob is the
        // only copy of a line the source activity still holds. The caller's
        // range is inclusive, the map hands `slice(start, end + 1)` to the
        // polyline above, while the triple is half-open, so the end moves on
        // by one crossing over. A range that spans one point is not a line and
        // indexes nothing worth rebuilding.
        let spans_a_line = matches!(
            (params.start_index, params.end_index),
            (Some(start), Some(end)) if end > start
        );
        let reference = crate::persistence::sections::geometry::reference(
            params.source_activity_id.as_deref(),
            params.start_index.filter(|_| spans_a_line),
            params
                .end_index
                .filter(|_| spans_a_line)
                .map(|end| end.saturating_add(1)),
        );
        let geometry_source = if reference.is_some() {
            crate::persistence::sections::SOURCE_EXACT
        } else {
            crate::persistence::sections::SOURCE_CONSENSUS
        };

        self.in_write_txn(|engine| {
            engine.db.execute(
                "INSERT INTO sections (
                    id, section_type, name, sport_type, polyline_json, polyline_blob, distance_meters,
                    representative_activity_id, source_activity_id, start_index, end_index,
                    rep_start_index, rep_end_index, geometry_source,
                    created_at, is_user_defined,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    &id,
                    section_type.as_str(),
                    params.name.as_deref(),
                    &params.sport_type,
                    crate::persistence::codec::NO_POLYLINE_JSON,
                    polyline_blob,
                    params.distance_meters,
                    params.source_activity_id.as_ref(),
                    params.source_activity_id.as_deref(),
                    params.start_index,
                    params.end_index,
                    reference.map(|(_, start, _)| start),
                    reference.map(|(_, _, end)| end),
                    geometry_source,
                    &created_at,
                    1,
                    bounds_min_lat,
                    bounds_max_lat,
                    bounds_min_lng,
                    bounds_max_lng,
                ],
            )
            .map_err(|e| format!("Failed to create section: {}", e))?;

            engine.match_activities_to_section(&id, &params.polyline, &params.sport_type)?;
            if section_type == SectionType::Custom {
                for auto_id in engine.try_find_superseded_auto_sections(&id, 50.0, 0.8)? {
                    engine.db.execute(
                        "UPDATE sections SET superseded_by = ? WHERE id = ?",
                        params![&id, auto_id],
                    ).map_err(|e| format!("Failed to supersede section: {}", e))?;
                }
            }
            Ok(())
        })?;
        self.refresh_superseded_ids();

        // Cache the new custom section in memory so the in-memory matcher
        // (index_new_activity) can add future activities to it, and so
        // get_sections() reflects it without a reload.
        self.refresh_section_in_memory(&id);

        // Refresh the materialised activity_indicators table so feed cards
        // pick up section_pr / section_trend chips for the new section without
        // requiring an app restart.
        if let Err(e) = self.recompute_indicators_for_section(&id) {
            log::warn!(
                "veloqrs: [create_section] indicator recompute failed: {}",
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
    ///
    /// Each row is timed from the activity's stored time stream and carries
    /// its sensor means at insert, so the indicator pass that follows an edit
    /// reads measured laps. `heartrate` and `power` are the activity's series,
    /// loaded once by the caller for all of its portions.
    pub fn add_section_activity_with_portion(
        &mut self,
        section_id: &str,
        portion: &SectionPortion,
        heartrate: Option<&[Option<f64>]>,
        power: Option<&[Option<f64>]>,
    ) -> Result<(), String> {
        self.insert_section_activity_with_sensors(
            section_id,
            &portion.activity_id,
            &portion.direction,
            portion.start_index,
            portion.end_index,
            portion.distance_meters,
            heartrate,
            power,
        )
    }

    /// Accept (pin) an auto-detected section so it survives re-detection
    /// and its consensus polyline stops evolving.
    pub fn accept_section(&mut self, section_id: &str) -> Result<(), String> {
        self.in_write_txn(|e| e.write_accept_section(section_id))?;
        self.mark_section_accepted_in_memory(section_id);
        self.invalidate_section_cache(section_id);
        // The section is now a durable intent row; the registry relinquishes it
        // so auto detection stops re-emitting (and colliding on) its ground.
        self.section_identity_relinquish(section_id);
        self.drop_section_pin(section_id);
        Ok(())
    }

    fn write_accept_section(&mut self, section_id: &str) -> Result<(), String> {
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
        self.record_edit_event(
            section_id,
            super::history::KIND_ACCEPTED,
            serde_json::json!({}),
            None,
        )
    }

    /// Accept all current auto-detected sections.
    pub fn accept_all_sections(&mut self) -> Result<u32, String> {
        let count = self.in_write_txn(|e| e.write_accept_all_sections())?;
        self.mark_all_auto_sections_accepted();
        self.invalidate_all_section_caches();
        // Every managed auto section is now durable; reseed so the registry holds
        // only the (now empty) non-user-defined set and carries none of them.
        self.section_identity_reseed();
        Ok(count)
    }

    fn write_accept_all_sections(&mut self) -> Result<u32, String> {
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
        self.db
            .execute(
                "DELETE FROM section_pins WHERE section_id IN
                 (SELECT id FROM sections
                  WHERE section_type = 'auto' AND is_user_defined = 0 AND disabled = 0)",
                [],
            )
            .map_err(|e| format!("Failed to drop pins: {}", e))?;
        let accepted: Vec<String> = self
            .db
            .prepare(
                "SELECT id FROM sections
                 WHERE section_type = 'auto' AND is_user_defined = 0 AND disabled = 0",
            )
            .and_then(|mut stmt| stmt.query_map([], |row| row.get(0))?.collect())
            .map_err(|e| format!("Failed to list sections to accept: {}", e))?;
        let updated_at = chrono::Utc::now().to_rfc3339();
        let count = self
            .db
            .execute(
                "UPDATE sections SET is_user_defined = 1, updated_at = ?
                 WHERE section_type = 'auto' AND is_user_defined = 0 AND disabled = 0",
                params![updated_at],
            )
            .map_err(|e| format!("Failed to accept sections: {}", e))?;
        for id in &accepted {
            self.record_edit_event(
                id,
                super::history::KIND_ACCEPTED,
                serde_json::json!({}),
                None,
            )?;
        }
        Ok(count as u32)
    }

    /// Set a new reference activity for a section.
    ///
    /// For **auto-detected sections**: Updates `representative_activity_id` and replaces the
    /// polyline with the new activity's section-matching portion (extracted via spatial overlap).
    ///
    /// For **custom sections**: locates the drawn line on the new activity by geometry,
    /// refuses an activity that does not cover it, and rebuilds the member rows.
    pub fn set_section_reference(
        &mut self,
        section_id: &str,
        activity_id: &str,
    ) -> Result<Vec<String>, String> {
        let done = self.in_write_txn(|e| e.write_set_section_reference(section_id, activity_id));
        self.resync_section_after_edit(section_id, done.is_err());
        done
    }

    fn write_set_section_reference(
        &mut self,
        section_id: &str,
        activity_id: &str,
    ) -> Result<Vec<String>, String> {
        // Every branch below promotes the row to user-defined; the resolved
        // corridor name lands on the row first so the promotion keeps it.
        self.adopt_corridor_name(section_id);
        // Verify activity exists and get its track
        let track = self
            .get_gps_track(activity_id)
            .ok_or_else(|| format!("Activity not found: {}", activity_id))?;

        let section_type: String = self
            .db
            .query_row(
                "SELECT section_type FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .map_err(|_| format!("Section not found: {}", section_id))?;

        let updated_at = chrono::Utc::now().to_rfc3339();
        let mut departed = Vec::new();
        let mut version: Option<i64> = None;

        if section_type == "custom" {
            // The stored indices belong to the activity the line was drawn on,
            // so the drawn line is located on the new activity by geometry. A
            // ride that never covers it is refused: clamping would store some
            // other stretch of road as the athlete's line.
            let drawn: Vec<GpsPoint> = self.stored_section_polyline(section_id).unwrap_or_default();
            if drawn.len() < 2 {
                return Err("Section has no polyline to match against".to_string());
            }
            let portions =
                compute_section_portions(activity_id, &track, &drawn, &self.section_config);
            let Some(first) = portions.first() else {
                return Err(format!(
                    "Activity {} does not overlap sufficiently with section {}",
                    activity_id, section_id
                ));
            };
            // A pass is half-open, while the section's own range is the
            // inclusive one the athlete draws.
            let start = first.start_index;
            let end_exclusive = first.end_index;
            let (lo, hi) = (start as usize, end_exclusive as usize);
            if lo + 1 >= hi || hi > track.len() {
                return Err(format!(
                    "Activity {} does not cover section {}",
                    activity_id, section_id
                ));
            }
            let polyline: Vec<GpsPoint> = track[lo..hi].to_vec();

            // The first line the athlete drew survives the overwrite.
            self.back_up_original_line(section_id, &drawn)?;

            version = Some(
                self.record_section_geometry(
                    section_id,
                    &polyline,
                    true,
                    Some((activity_id, start, end_exclusive)),
                )
                .map_err(|e| format!("Failed to record section geometry: {}", e))?,
            );

            let polyline_blob = crate::persistence::codec::serialize_track_points(&polyline);
            let distance = calculate_route_distance(&polyline);
            let bounds = tracematch::geo_utils::compute_bounds(&polyline);

            self.db
                .execute(
                    "UPDATE sections SET
                        representative_activity_id = ?,
                        source_activity_id = ?,
                        start_index = ?,
                        end_index = ?,
                        rep_start_index = ?,
                        rep_end_index = ?,
                        geometry_source = ?,
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
                        start,
                        end_exclusive - 1,
                        start,
                        end_exclusive,
                        crate::persistence::sections::SOURCE_EXACT,
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

            // Every member is matched against the new line, not the old one.
            departed = self.rebuild_section_junctions(section_id, &polyline)?;
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
            // A pass is half-open, so `end` is the first index past it.
            let end = (first.end_index as usize).min(track.len());
            let new_polyline: Vec<GpsPoint> = track[start..end].to_vec();
            let new_distance = calculate_route_distance(&new_polyline);

            log::info!(
                "veloqrs: [set_section_reference] section={} activity={} \
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
                    "veloqrs: [set_section_reference] Extracted portion ({:.0}m) exceeds 3x \
                     original section length ({:.0}m). Keeping original polyline, only updating \
                     representative_activity_id.",
                    new_distance,
                    current_distance,
                );

                self.db
                    .execute(
                        "UPDATE sections SET
                            representative_activity_id = ?,
                            rep_start_index = NULL,
                            rep_end_index = NULL,
                            geometry_source = ?,
                            is_user_defined = 1,
                            updated_at = ?
                         WHERE id = ?",
                        params![
                            activity_id,
                            crate::persistence::sections::SOURCE_CONSENSUS,
                            updated_at,
                            section_id
                        ],
                    )
                    .map_err(|e| format!("Failed to update section reference: {}", e))?;
            } else {
                self.back_up_original_line(section_id, &current_polyline)?;

                version = Some(
                    self.record_section_geometry(
                        section_id,
                        &new_polyline,
                        true,
                        Some((activity_id, start as u32, end as u32)),
                    )
                    .map_err(|e| format!("Failed to record section geometry: {}", e))?,
                );

                let polyline_blob =
                    crate::persistence::codec::serialize_track_points(&new_polyline);
                let bounds = tracematch::geo_utils::compute_bounds(&new_polyline);

                self.db
                    .execute(
                        "UPDATE sections SET
                            representative_activity_id = ?,
                            rep_start_index = ?,
                            rep_end_index = ?,
                            geometry_source = ?,
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
                            start as u32,
                            end as u32,
                            crate::persistence::sections::SOURCE_EXACT,
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
                departed = self.rematch_section_activities(section_id, &new_polyline)?;
            }

            // Add the new reference activity with proper portion details (all laps)
            // (rematch only includes previously-associated activities). A ride
            // attached by hand already holds the rows its relaxed cut gave it.
            if !self
                .forced_activity_ids(section_id)
                .iter()
                .any(|id| id == activity_id)
            {
                let heartrate = self.load_heartrate_series(activity_id);
                let power = self.load_power_series(activity_id);
                for portion in &portions {
                    self.add_section_activity_with_portion(
                        section_id,
                        portion,
                        heartrate.as_deref(),
                        power.as_deref(),
                    )?;
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
        self.invalidate_perf_cache();
        self.section_identity_relinquish(section_id);

        self.record_edit_event(
            section_id,
            super::history::KIND_REFERENCE_SET,
            serde_json::json!({ "activity_id": activity_id }),
            version,
        )?;

        Ok(departed)
    }

    /// Rebuild a section's junction rows against its new line, the step every
    /// geometry edit ends with. A custom section rescans the library, an auto
    /// section re-cuts the rides it holds. Both carry the athlete's decisions
    /// across and return the rides attached by hand that the new line no
    /// longer reaches.
    pub(super) fn rebuild_section_junctions(
        &mut self,
        section_id: &str,
        polyline: &[GpsPoint],
    ) -> Result<Vec<String>, String> {
        let (section_type, sport_type): (String, String) = self
            .db
            .query_row(
                "SELECT section_type, sport_type FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or_else(|_| ("auto".to_string(), "Ride".to_string()));
        if section_type != "custom" {
            return self.rematch_section_activities(section_id, polyline);
        }
        let decisions = self.capture_user_decisions(section_id);
        self.db
            .execute(
                "DELETE FROM section_activities WHERE section_id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to clear section activities: {}", e))?;
        self.match_activities_to_section(section_id, polyline, &sport_type)?;
        self.restore_user_decisions(section_id, polyline, &decisions)
    }

    /// Re-match activities against an updated section polyline.
    /// Checks all previously-associated activities and keeps only those that
    /// still overlap, and returns the rides attached by hand that left.
    pub(super) fn rematch_section_activities(
        &mut self,
        section_id: &str,
        new_polyline: &[GpsPoint],
    ) -> Result<Vec<String>, String> {
        // ALL members, excluded ones included: the flag is a user
        // decision and must survive the rebuild, not vanish with the rows.
        let decisions = self.capture_user_decisions(section_id);
        let mut activity_ids = self.get_section_activity_ids(section_id);
        activity_ids.extend(decisions.full.iter().cloned());
        activity_ids.extend(decisions.forced.iter().cloned());
        activity_ids.sort();
        activity_ids.dedup();

        if activity_ids.is_empty() || new_polyline.is_empty() {
            return Ok(Vec::new());
        }

        // Clear existing junction entries for this section
        self.db
            .execute(
                "DELETE FROM section_activities WHERE section_id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to clear section activities: {}", e))?;

        // Re-add only activities that still match, with full portion details (all laps)
        if let Some(line) = tracematch::PreparedLine::new(new_polyline, &self.section_config) {
            for aid in activity_ids
                .iter()
                .filter(|id| !decisions.forced.contains(id))
            {
                if let Some(track) = self.get_gps_track(aid) {
                    let heartrate = self.load_heartrate_series(aid);
                    let power = self.load_power_series(aid);
                    for portion in line.portions(aid, &track) {
                        self.add_section_activity_with_portion(
                            section_id,
                            &portion,
                            heartrate.as_deref(),
                            power.as_deref(),
                        )?;
                    }
                }
            }
        }
        self.restore_user_decisions(section_id, new_polyline, &decisions)
    }

    /// Manually attach one activity to one section, for the activity
    /// screen's "should have matched" affordance. The bar relaxes because the
    /// user has already asserted the match: every traversal the forced cut
    /// finds is written, and the attachment is recorded so each later junction
    /// rebuild re-cuts the ride the same way instead of dropping it at the
    /// strict bar. Idempotent: a pair that already holds junction rows is left
    /// alone, detection's per-lap rows must not gain a stacked duplicate at a
    /// different start index.
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

        let portions = forced_portions(activity_id, &track, &polyline, &self.section_config);
        if portions.is_empty() {
            return Ok(false);
        }
        let heartrate = self.load_heartrate_series(activity_id);
        let power = self.load_power_series(activity_id);
        self.in_write_txn(|engine| {
            for portion in &portions {
                engine.add_section_activity_with_portion(
                    section_id,
                    portion,
                    heartrate.as_deref(),
                    power.as_deref(),
                )?;
            }
            engine.record_forced_match(section_id, activity_id)
        })?;
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
    /// further than half the smallest gap between adjacent laps, before the
    /// edit or after it, is dropped rather than guessed, and so is a carry
    /// that would leave every rebuilt row excluded when a lap was included. An excluded activity that no longer
    /// matches the new line has no rows, and nothing to carry.
    pub(super) fn reapply_exclusions(
        &self,
        section_id: &str,
        snapshot: &UserDecisions,
    ) -> Result<(), String> {
        for aid in &snapshot.full {
            self.db
                .execute(
                    "UPDATE section_activities SET excluded = 1 WHERE section_id = ? AND activity_id = ?",
                    params![section_id, aid],
                )
                .map_err(|e| format!("Failed to reapply exclusion: {}", e))?;
        }
        for (aid, carried) in &snapshot.partial {
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
            for start in assign_carried_exclusions(carried, &rebuilt) {
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

    /// Read every decision the athlete made on a section's rows before a
    /// junction rebuild deletes them.
    pub(super) fn capture_user_decisions(&self, section_id: &str) -> UserDecisions {
        let mut decisions = self.capture_exclusions(section_id);
        decisions.forced = self.forced_activity_ids(section_id);
        decisions
    }

    /// The id, name and date of each ride an edit took out of a section, read
    /// from the library so the screen names the ride without a second lookup.
    /// A ride the library no longer holds is left out.
    pub fn departed_rides(&self, activity_ids: &[String]) -> Vec<(String, String, i64)> {
        activity_ids
            .iter()
            .filter_map(|id| {
                crate::persistence::fitness::performances::laps::activity_meta(&self.db, id)
                    .map(|(name, date)| (id.clone(), name, date))
            })
            .collect()
    }

    /// Put the athlete's decisions back after a junction rebuild against
    /// `line`. Each ride attached by hand is cut at the relaxed bar and only
    /// there: whatever the strict pass wrote for it goes, since its passes
    /// start at other indices and one pass would count twice. A ride the
    /// relaxed cut no longer finds loses its rows and its record, and is
    /// returned. Exclusions are reapplied last, onto the rows as they stand.
    pub(super) fn restore_user_decisions(
        &self,
        section_id: &str,
        line: &[GpsPoint],
        decisions: &UserDecisions,
    ) -> Result<Vec<String>, String> {
        let mut departed = Vec::new();
        for aid in &decisions.forced {
            self.db
                .execute(
                    "DELETE FROM section_activities WHERE section_id = ? AND activity_id = ?",
                    params![section_id, aid],
                )
                .map_err(|e| format!("Failed to clear a forced ride's rows: {}", e))?;
            let portions = self
                .get_gps_track(aid)
                .map(|track| forced_portions(aid, &track, line, &self.section_config))
                .unwrap_or_default();
            if portions.is_empty() {
                self.db
                    .execute(
                        "DELETE FROM section_forced_matches WHERE section_id = ? AND activity_id = ?",
                        params![section_id, aid],
                    )
                    .map_err(|e| format!("Failed to drop a forced match: {}", e))?;
                departed.push(aid.clone());
                continue;
            }
            let heartrate = self.load_heartrate_series(aid);
            let power = self.load_power_series(aid);
            for portion in &portions {
                self.insert_section_activity_with_sensors(
                    section_id,
                    aid,
                    &portion.direction,
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                    heartrate.as_deref(),
                    power.as_deref(),
                )?;
            }
            // A merge carries the donor's forced rides onto the section kept.
            self.record_forced_match(section_id, aid)?;
        }
        self.reapply_exclusions(section_id, decisions)?;
        Ok(departed)
    }

    /// Record that the athlete attached a ride to a section by hand. A pair
    /// already recorded keeps the time it was first attached.
    fn record_forced_match(&self, section_id: &str, activity_id: &str) -> Result<(), String> {
        let forced_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.db
            .execute(
                "INSERT OR IGNORE INTO section_forced_matches (section_id, activity_id, forced_at)
                 VALUES (?, ?, ?)",
                params![section_id, activity_id, forced_at],
            )
            .map_err(|e| format!("Failed to record a forced match: {}", e))?;
        Ok(())
    }

    /// The rides attached to a section by hand.
    pub(super) fn forced_activity_ids(&self, section_id: &str) -> Vec<String> {
        self.forced_ids(
            "SELECT activity_id FROM section_forced_matches WHERE section_id = ? ORDER BY activity_id",
            section_id,
        )
    }

    /// The sections a ride was attached to by hand.
    fn forced_section_ids(&self, activity_id: &str) -> Vec<String> {
        self.forced_ids(
            "SELECT section_id FROM section_forced_matches WHERE activity_id = ? ORDER BY section_id",
            activity_id,
        )
    }

    fn forced_ids(&self, sql: &str, key: &str) -> Vec<String> {
        let Ok(mut stmt) = self.db.prepare_cached(sql) else {
            return Vec::new();
        };
        stmt.query_map(params![key], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    /// Read a section's exclusion state before a junction rebuild deletes
    /// the rows that carry it.
    pub(super) fn capture_exclusions(&self, section_id: &str) -> UserDecisions {
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
            return UserDecisions::default();
        }
        let mut rows: Vec<(String, u32, bool)> = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT activity_id, start_index, excluded FROM section_activities
             WHERE section_id = ? ORDER BY activity_id, start_index",
        ) && let Ok(mapped) = stmt.query_map(params![section_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? != 0))
        }) {
            rows.extend(mapped.filter_map(|r| r.ok()));
        }
        let mut snapshot = UserDecisions::default();
        let mut i = 0;
        while i < rows.len() {
            let aid = rows[i].0.clone();
            let mut carry = LapCarry {
                excluded: Vec::new(),
                included: Vec::new(),
            };
            while i < rows.len() && rows[i].0 == aid {
                if rows[i].2 {
                    carry.excluded.push(rows[i].1);
                } else {
                    carry.included.push(rows[i].1);
                }
                i += 1;
            }
            if carry.excluded.is_empty() {
                continue;
            }
            if carry.included.is_empty() {
                snapshot.full.push(aid);
            } else {
                snapshot.partial.push((aid, carry));
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
        // The push path stores its stream through `store_time_streams_flat`,
        // which leaves the backfill owed. One activity, so one scan.
        self.backfill_section_performance_cache();
        let (matched, portions) = self.attach_activity_junctions(activity_id)?;
        summary.matched_sections = matched;
        summary.inserted_portions = portions;

        // Ingest marked groups dirty, so this takes the incremental regroup
        // path (skipped while route matching is off, the groups stay owed) and places the new activity in a route group. recompute_groups
        // also refreshes activity indicators at its end.
        if self.groups_dirty && self.detection_enabled() {
            self.get_groups();
            summary.regrouped = true;
            summary.indicators_recomputed = true;
        } else if summary.inserted_portions > 0 {
            match self.recompute_activity_indicators() {
                Ok(()) => summary.indicators_recomputed = true,
                Err(e) => log::warn!(
                    "veloqrs: [index_new_activity] indicator recompute failed: {}",
                    e
                ),
            }
        }

        log::info!(
            "veloqrs: [index_new_activity] {} matched {} sections ({} portions, regrouped={})",
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
        let forced = self.forced_section_ids(activity_id);

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
                // A section the athlete attached this ride to by hand keeps
                // the rows the relaxed cut gives it.
                let cut = if forced.contains(&section.id) {
                    forced_portions
                } else {
                    compute_section_portions
                };
                (
                    section.id.clone(),
                    cut(activity_id, &track, &section.polyline, &self.section_config),
                )
            })
            .filter(|(_, portions)| !portions.is_empty())
            .collect();

        if matched.is_empty() {
            return Ok((0, 0));
        }

        // Every portion of this activity reads the same series, so it is read
        // once here rather than once per row inside the insert.
        let heartrate = self.load_heartrate_series(activity_id);
        let power = self.load_power_series(activity_id);

        // One transaction for the whole activity. Each statement below used to
        // autocommit with its own fsync, under the write lock every reader
        // waits on, and a sync pays that once per stored activity.
        let result = self.in_write_txn(|engine| {
            let mut matched_sections = 0;
            let mut inserted_portions = 0;
            for (section_id, portions) in &matched {
                matched_sections += 1;

                // Replace any rows a previous run (or a later full detection) left
                // for this pair, so near-duplicate start_index rows can't stack up.
                // The exclusion state is a user decision and rides across the
                // rewrite (whole snapshot: reapplying untouched pairs is a no-op).
                let exclusions = engine.capture_exclusions(section_id);
                engine
                    .db
                    .prepare_cached(
                        "DELETE FROM section_activities WHERE section_id = ? AND activity_id = ?",
                    )
                    .and_then(|mut stmt| stmt.execute(params![section_id, activity_id]))
                    .map_err(|e| format!("Failed to clear section_activities: {}", e))?;

                for portion in portions {
                    engine.insert_section_activity_with_sensors(
                        section_id,
                        activity_id,
                        &portion.direction,
                        portion.start_index,
                        portion.end_index,
                        portion.distance_meters,
                        heartrate.as_deref(),
                        power.as_deref(),
                    )?;
                    inserted_portions += 1;
                }
                engine.reapply_exclusions(section_id, &exclusions)?;
            }

            Ok((matched_sections, inserted_portions))
        });
        for (section_id, _) in &matched {
            self.refresh_section_in_memory(section_id);
            self.invalidate_section_cache(section_id);
        }
        self.invalidate_perf_cache();
        result
    }

    /// Per-add half of the attach tier: junction rows for one just-stored
    /// activity, errors logged (ingest must not abort on one bad track).
    /// Returns (matched sections, inserted portions).
    pub fn attach_stored_activity(&mut self, activity_id: &str) -> (u32, u32) {
        match self.attach_activity_junctions(activity_id) {
            Ok(counts) => counts,
            Err(e) => {
                log::warn!("veloqrs: [attach] {} failed: {}", activity_id, e);
                (0, 0)
            }
        }
    }

    /// The attach a store makes after its track lands.
    ///
    /// While the cutover is owed the junction rows are the 0.3.x evidence the
    /// archive snapshots, so a store that left the track unchanged keeps the
    /// rows of an activity that already has them. A new activity, one with no
    /// rows yet, or a changed track still attaches.
    /// Returns the inserted portion count.
    pub fn attach_after_store(&mut self, activity_id: &str, track_changed: bool) -> u32 {
        if !track_changed && self.cutover_is_owed() && self.activity_has_junction_rows(activity_id)
        {
            return 0;
        }
        self.attach_stored_activity(activity_id).1
    }

    fn activity_has_junction_rows(&self, activity_id: &str) -> bool {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM section_activities WHERE activity_id = ?)",
                [activity_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n == 1)
            .unwrap_or(false)
    }

    /// Batch tail of the attach tier: one regroup (ingest marks groups
    /// dirty) or, failing that, one indicator recompute when any junction
    /// rows landed. Returns (regrouped, indicators_recomputed).
    ///
    /// The lap backfill runs here, once, for whatever streams the batch
    /// landed. `store_time_streams_flat` leaves it owed rather than paying a
    /// whole-table scan per activity under the write lock.
    pub fn attach_finalize(&mut self, inserted_portions: u32) -> (bool, bool) {
        self.backfill_section_performance_cache();
        // With route matching off the groups stay owed rather than rebuilt,
        // so switching it back on regroups once.
        if self.groups_dirty && self.detection_enabled() {
            self.get_groups();
            (true, true)
        } else if inserted_portions > 0 {
            match self.recompute_activity_indicators() {
                Ok(()) => (false, true),
                Err(e) => {
                    log::warn!("veloqrs: [attach] indicator recompute failed: {}", e);
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
            "veloqrs: [attach] {}/{} activities attached ({} portions, regrouped={})",
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

        let mut activity_ids = if self.section_config.pool_sports {
            self.get_activity_ids()
        } else {
            self.get_activity_ids_by_sport(sport_type)
        };

        // Anything whose bounds cannot reach the line produces no portion, so
        // it is dropped before it costs a read. On a library spread across a
        // country that is nearly all of it.
        let near: HashSet<String> = self
            .activities_near_polyline(polyline, self.section_config.proximity_threshold)
            .into_iter()
            .collect();
        activity_ids.retain(|id| near.contains(id));

        if activity_ids.is_empty() {
            return Ok(0);
        }

        log::info!(
            "veloqrs: [match_activities_to_section] Checking {} activities against section {} (sport_type '{}')",
            activity_ids.len(),
            section_id,
            sport_type
        );

        let mut match_count: u32 = 0;

        // One track at a time. Holding every candidate's points at once is a
        // whole second copy of the library in memory for no gain: each is read
        // once and used once.
        let line = tracematch::PreparedLine::new(polyline, &self.section_config);
        for aid in &activity_ids {
            let Some(track) = self.get_gps_track(aid) else {
                continue;
            };
            let portions = line
                .as_ref()
                .map(|l| l.portions(aid, &track))
                .unwrap_or_default();
            if !portions.is_empty() {
                let heartrate = self.load_heartrate_series(aid);
                let power = self.load_power_series(aid);
                for portion in &portions {
                    self.add_section_activity_with_portion(
                        section_id,
                        portion,
                        heartrate.as_deref(),
                        power.as_deref(),
                    )?;
                }
                match_count += 1;
            }
        }

        log::info!(
            "veloqrs: [match_activities_to_section] Found {} matching activities for section {}",
            match_count,
            section_id
        );

        Ok(match_count)
    }

    /// Reset a section's reference to automatic (algorithm-selected).
    /// Sets is_user_defined to false.
    pub fn reset_section_reference(&mut self, section_id: &str) -> Result<Vec<String>, String> {
        let done = self.in_write_txn(|e| e.write_reset_section_reference(section_id));
        self.resync_section_after_edit(section_id, done.is_err());
        done
    }

    fn write_reset_section_reference(&mut self, section_id: &str) -> Result<Vec<String>, String> {
        // A reference change backs the original line up; resetting puts it
        // back the same way a bounds reset does, so "reset to automatic"
        // restores the shape and not only the flag.
        let restored_line = self.has_original_bounds(section_id);
        let departed = if restored_line {
            self.reset_section_bounds(section_id)?
        } else {
            Vec::new()
        };
        // Drop the polyline backup with the demotion: the catalogue save
        // wipes only backup-free auto rows before re-inserting from
        // memory, so a demoted row still carrying its backup collides.
        self.db
            .execute(
                "UPDATE sections SET is_user_defined = 0, original_polyline_blob = NULL,
                     original_polyline_json = NULL WHERE id = ?",
                params![section_id],
            )
            .map_err(|e| format!("Failed to reset section reference: {}", e))?;
        self.drop_section_pin(section_id);

        // Invalidate cache so next fetch gets fresh data
        self.invalidate_section_cache(section_id);
        self.invalidate_perf_cache();

        // Refresh in-memory section (for auto sections)
        self.refresh_section_in_memory(section_id);

        self.section_identity_admit(section_id);

        // The restored line, when there was one, is the bounds reset's version.
        let version = if restored_line {
            self.section_geometry_versions(section_id)
                .last()
                .map(|v| v.version)
        } else {
            None
        };
        self.record_edit_event(
            section_id,
            super::history::KIND_REFERENCE_RESET,
            serde_json::json!({}),
            version,
        )?;

        Ok(departed)
    }

    /// Delete a section.
    pub fn delete_section(&mut self, section_id: &str) -> Result<(), String> {
        let restored = self.in_write_txn(|engine| {
            engine.record_section_intent(section_id, "deleted");
            let rows = engine
                .db
                .execute("DELETE FROM sections WHERE id = ?", params![section_id])
                .map_err(|e| format!("Failed to delete section: {}", e))?;
            if rows == 0 {
                return Err(format!("Section not found: {}", section_id));
            }
            engine
                .db
                .execute(
                    "DELETE FROM section_forced_matches WHERE section_id = ?",
                    params![section_id],
                )
                .map_err(|e| format!("Failed to drop the section's forced matches: {}", e))?;
            let mut stmt = engine
                .db
                .prepare("SELECT id FROM sections WHERE superseded_by = ?")
                .map_err(|e| format!("Failed to find superseded sections: {}", e))?;
            let restored: Vec<String> = stmt
                .query_map(params![section_id], |row| row.get(0))
                .map_err(|e| format!("Failed to find superseded sections: {}", e))?
                .collect::<Result<_, _>>()
                .map_err(|e| format!("Failed to read superseded sections: {}", e))?;
            drop(stmt);
            engine
                .db
                .execute(
                    "UPDATE sections SET superseded_by = NULL WHERE superseded_by = ?",
                    params![section_id],
                )
                .map_err(|e| format!("Failed to restore superseded sections: {}", e))?;
            Ok(restored)
        })?;

        // Invalidate cache
        self.invalidate_section_cache(section_id);
        for id in restored {
            self.invalidate_section_cache(&id);
        }
        self.refresh_superseded_ids();

        // Remove from in-memory cache and relinquish from the identity registry so
        // a later detect neither carries nor re-mints the removed section.
        self.remove_section_from_memory(section_id);
        self.drop_section_pin(section_id);
        self.section_identity_relinquish(section_id);

        // Drop the now-orphaned section_pr / section_trend rows from the
        // materialised indicators table so feed cards stop showing chips
        // for a section the user just removed.
        if let Err(e) = self.recompute_indicators_for_section(section_id) {
            log::warn!(
                "veloqrs: [delete_section] indicator recompute failed: {}",
                e
            );
        }

        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/forced_matches.rs"]
mod forced_matches;

#[cfg(test)]
#[path = "tests/adoption_ledger.rs"]
mod adoption_ledger;

#[cfg(test)]
#[path = "tests/registry_excluded_members.rs"]
mod registry_excluded_members;

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::net::types::StreamDto;
    use crate::persistence::commit_counter;

    /// A straight run of points, long enough that the matcher takes it for a
    /// traversal of a section cut from the same ground.
    fn track() -> Vec<GpsPoint> {
        (0..200)
            .map(|i| GpsPoint {
                latitude: 46.2 + f64::from(i) * 0.0001,
                longitude: 7.3,
                elevation: None,
            })
            .collect()
    }

    /// One activity over ground that `sections` sections already cover.
    fn engine_over_sections(sections: usize) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let points = track();
        engine
            .add_activity("a1".to_string(), points.clone(), "Ride".to_string())
            .unwrap();
        let json = serde_json::to_string(&points).unwrap();
        for s in 0..sections {
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                     VALUES (?, 'auto', ?, 'Ride', ?, 2200.0, 0, 1, '2026-01-01T00:00:00Z',
                        46.2, 46.22, 7.3, 7.3)",
                    params![format!("s{s}"), format!("Section {s}"), json],
                )
                .unwrap();
        }
        engine.load_sections().unwrap();
        engine
    }

    fn drawn_section(engine: &mut PersistentEngine) -> Result<String, String> {
        let points = track();
        engine.create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: points.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&points),
            name: Some("Drawn".to_string()),
            source_activity_id: Some("a1".to_string()),
            start_index: Some(0),
            end_index: Some(199),
        })
    }

    fn lap_times(engine: &PersistentEngine, section_id: &str) -> Vec<Option<f64>> {
        let mut stmt = engine
            .db
            .prepare("SELECT lap_time FROM section_activities WHERE section_id = ?")
            .unwrap();
        stmt.query_map(params![section_id], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    fn with_one_second_stream(engine: &mut PersistentEngine) {
        let times: Vec<u32> = (0..200).collect();
        engine.store_time_streams_flat(&["a1".to_string()], &times, &[0, 200]);
    }

    #[test]
    fn a_drawn_section_rows_carry_the_measured_lap_time() {
        let mut engine = engine_over_sections(0);
        with_one_second_stream(&mut engine);
        let custom = drawn_section(&mut engine).unwrap();

        let laps = lap_times(&engine, &custom);
        assert!(!laps.is_empty());
        assert!(laps.iter().all(|t| t.is_some_and(|t| t > 0.0)), "{laps:?}");
    }

    #[test]
    fn a_rematch_keeps_the_measured_lap_time_on_every_rebuilt_row() {
        let mut engine = engine_over_sections(0);
        with_one_second_stream(&mut engine);
        let custom = drawn_section(&mut engine).unwrap();
        let trimmed = track()[20..180].to_vec();

        engine
            .rematch_section_activities(&custom, &trimmed)
            .unwrap();

        let laps = lap_times(&engine, &custom);
        assert!(!laps.is_empty());
        assert!(laps.iter().all(|t| t.is_some_and(|t| t > 0.0)), "{laps:?}");
    }

    #[test]
    fn a_portion_with_no_stream_is_stored_without_a_lap_time() {
        let mut engine = engine_over_sections(0);
        let custom = drawn_section(&mut engine).unwrap();

        let laps = lap_times(&engine, &custom);
        assert!(!laps.is_empty());
        assert!(laps.iter().all(|t| t.is_none()), "{laps:?}");
    }

    #[test]
    fn drawing_and_deleting_a_section_hides_then_restores_every_covered_auto_section() {
        let mut engine = engine_over_sections(2);
        let custom = drawn_section(&mut engine).unwrap();
        for id in ["s0", "s1"] {
            assert_eq!(
                engine
                    .db
                    .query_row(
                        "SELECT superseded_by FROM sections WHERE id = ?",
                        params![id],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .unwrap(),
                Some(custom.clone()),
            );
            assert!(!engine.get_section_summaries().iter().any(|s| s.id == id));
        }
        engine.delete_section(&custom).unwrap();
        assert!(engine.delete_section(&custom).is_err());
        for id in ["s0", "s1"] {
            assert!(engine.get_section_summaries().iter().any(|s| s.id == id));
            assert!(engine.get_visible_sections().iter().any(|s| s.id == id));
        }
    }

    #[test]
    fn a_failed_supersession_rolls_back_the_draw_and_all_flags() {
        let mut engine = engine_over_sections(2);
        engine.db.execute_batch(
            "CREATE TRIGGER reject_second_supersession BEFORE UPDATE OF superseded_by ON sections
             WHEN NEW.id = 's1' AND NEW.superseded_by IS NOT NULL
             BEGIN SELECT RAISE(FAIL, 'reject'); END",
        ).unwrap();

        assert!(drawn_section(&mut engine).is_err());
        let custom_rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM sections WHERE section_type = 'custom'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let hidden_rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM sections WHERE superseded_by IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((custom_rows, hidden_rows), (0, 0));
    }

    #[test]
    fn an_unreadable_auto_row_is_skipped_and_stays_visible_while_the_draw_supersedes_the_rest() {
        let mut engine = engine_over_sections(2);
        engine
            .db
            .execute(
                "UPDATE sections SET polyline_json = 'invalid' WHERE id = 's0'",
                [],
            )
            .unwrap();

        let custom = drawn_section(&mut engine).unwrap();

        let custom_rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM sections WHERE section_type = 'custom'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(custom_rows, 1);
        let superseded_by = |id: &str| -> Option<String> {
            engine
                .db
                .query_row(
                    "SELECT superseded_by FROM sections WHERE id = ?",
                    params![id],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(superseded_by("s1"), Some(custom.clone()));
        assert_eq!(superseded_by("s0"), None);
        assert!(engine.get_section_summaries().iter().any(|s| s.id == "s0"));
        assert_eq!(
            engine.find_superseded_auto_sections(&custom, 50.0, 0.8),
            vec!["s1".to_string()]
        );
    }

    #[test]
    fn a_catalogue_save_keeps_superseded_auto_sections_hidden() {
        let mut engine = engine_over_sections(2);
        let (_, portions) = engine.attach_activity_junctions("a1").unwrap();
        assert!(portions >= 2);
        engine.load_sections().unwrap();
        let custom = drawn_section(&mut engine).unwrap();

        engine.save_sections().unwrap();

        for id in ["s0", "s1"] {
            let superseded_by: Option<String> = engine
                .db
                .query_row(
                    "SELECT superseded_by FROM sections WHERE id = ?",
                    params![id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(superseded_by, Some(custom.clone()));
            assert!(!engine.get_section_summaries().iter().any(|s| s.id == id));
            assert!(!engine.get_visible_sections().iter().any(|s| s.id == id));
        }
        engine.load_sections().unwrap();
        assert!(["s0", "s1"].iter().all(|id| {
            engine.get_sections().iter().any(|s| s.id == *id)
                && !engine.get_visible_sections().iter().any(|s| s.id == *id)
        }));
    }

    fn superseded_by(engine: &PersistentEngine, id: &str) -> Option<String> {
        engine
            .db
            .query_row(
                "SELECT superseded_by FROM sections WHERE id = ?",
                params![id],
                |row| row.get(0),
            )
            .unwrap()
    }

    /// Scenario: the athlete draws a section over two detected ones, then
    /// clears routes and sections. The re-detect mints the same ground again
    /// under the ids the registry kept.
    ///
    /// Expected behaviour: the drawn section still replaces them, as it did
    /// before the clear, and the hold is spent once it is placed.
    #[test]
    fn a_clear_and_re_detect_keeps_the_auto_sections_a_drawn_one_replaced() {
        let mut engine = engine_over_sections(2);
        engine.attach_activity_junctions("a1").unwrap();
        engine.load_sections().unwrap();
        let custom = drawn_section(&mut engine).unwrap();
        let detected: Vec<tracematch::FrequentSection> = engine
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .cloned()
            .collect();
        assert_eq!(detected.len(), 2);

        engine.clear_routes_and_sections().unwrap();
        engine.sections.extend(detected);
        engine.save_sections().unwrap();

        for id in ["s0", "s1"] {
            assert_eq!(superseded_by(&engine, id), Some(custom.clone()));
            assert!(!engine.get_section_summaries().iter().any(|s| s.id == id));
            assert!(!engine.get_visible_sections().iter().any(|s| s.id == id));
        }

        engine.delete_section(&custom).unwrap();
        engine.save_sections().unwrap();
        for id in ["s0", "s1"] {
            assert_eq!(superseded_by(&engine, id), None);
        }
    }

    /// Scenario: the athlete draws a section over a detected one, a detection
    /// pass drops that ground because its support fell away, and a later pass
    /// mints it again under the same id.
    ///
    /// Expected behaviour: the drawn section still replaces it.
    #[test]
    fn a_detection_pass_that_drops_replaced_ground_keeps_it_replaced_when_it_returns() {
        let mut engine = engine_over_sections(2);
        engine.attach_activity_junctions("a1").unwrap();
        engine.load_sections().unwrap();
        let custom = drawn_section(&mut engine).unwrap();
        let detected: Vec<tracematch::FrequentSection> = engine
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .cloned()
            .collect();
        assert_eq!(detected.len(), 2);

        engine.sections.retain(|s| s.is_user_defined);
        engine.save_sections().unwrap();
        engine.sections.extend(detected);
        engine.save_sections().unwrap();

        for id in ["s0", "s1"] {
            assert_eq!(superseded_by(&engine, id), Some(custom.clone()));
            assert!(!engine.get_section_summaries().iter().any(|s| s.id == id));
        }
    }

    /// Scenario: the same clear, then the athlete deletes the drawn section
    /// before the re-detect lands.
    ///
    /// Expected behaviour: nothing hides the re-detected ground, because the
    /// section that replaced it is gone.
    #[test]
    fn a_held_supersession_whose_drawn_section_is_gone_is_dropped() {
        let mut engine = engine_over_sections(1);
        engine.attach_activity_junctions("a1").unwrap();
        engine.load_sections().unwrap();
        let custom = drawn_section(&mut engine).unwrap();
        let detected: Vec<tracematch::FrequentSection> = engine
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .cloned()
            .collect();

        engine.clear_routes_and_sections().unwrap();
        engine.delete_section(&custom).unwrap();
        engine.sections.extend(detected);
        engine.save_sections().unwrap();

        assert_eq!(superseded_by(&engine, "s0"), None);
        assert!(engine.get_section_summaries().iter().any(|s| s.id == "s0"));
    }

    #[test]
    fn lift_unflag_reaches_memory_cache_and_catalogue_reinsert() {
        let mut engine = engine_over_sections(1);
        engine.attach_activity_junctions("a1").unwrap();
        engine
            .db
            .execute("UPDATE sections SET is_lift = 1 WHERE id = 's0'", [])
            .unwrap();
        engine.load_sections().unwrap();
        assert!(engine.get_section_by_id("s0").unwrap().enrichment.is_lift);

        engine.set_section_is_lift("s0", false).unwrap();

        assert!(
            !engine
                .get_sections()
                .iter()
                .find(|s| s.id == "s0")
                .unwrap()
                .enrichment
                .is_lift
        );
        assert!(!engine.get_section_by_id("s0").unwrap().enrichment.is_lift);
        engine
            .sections
            .iter_mut()
            .find(|s| s.id == "s0")
            .unwrap()
            .enrichment
            .is_lift = true;
        engine.save_sections().unwrap();
        assert!(
            !engine
                .get_sections()
                .iter()
                .find(|s| s.id == "s0")
                .unwrap()
                .enrichment
                .is_lift
        );
        let stored: i64 = engine
            .db
            .query_row("SELECT is_lift FROM sections WHERE id = 's0'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, 0);
    }

    #[test]
    fn lift_unflag_survives_a_failed_rank_after_catalogue_reinsert() {
        let mut engine = engine_over_sections(1);
        engine.attach_activity_junctions("a1").unwrap();
        engine
            .db
            .execute("UPDATE sections SET is_lift = 1 WHERE id = 's0'", [])
            .unwrap();
        engine.load_sections().unwrap();
        engine.set_section_is_lift("s0", false).unwrap();
        engine
            .sections
            .iter_mut()
            .find(|s| s.id == "s0")
            .unwrap()
            .enrichment
            .is_lift = true;
        engine.save_sections().unwrap();
        engine
            .db
            .execute_batch(
                "CREATE TRIGGER reject_rank BEFORE UPDATE OF rank_score ON sections
             BEGIN SELECT RAISE(FAIL, 'reject rank'); END",
            )
            .unwrap();

        assert!(engine.rank_catalogue().is_err());
        let stored: i64 = engine
            .db
            .query_row("SELECT is_lift FROM sections WHERE id = 's0'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, 0);
        assert!(
            !engine
                .get_sections()
                .iter()
                .find(|s| s.id == "s0")
                .unwrap()
                .enrichment
                .is_lift
        );
    }

    /// Scenario: attach ran a DELETE, an INSERT per portion and an UPDATE per
    /// exclusion with no transaction, so each statement autocommitted with its
    /// own fsync, under the write lock, once per activity a sync stored.
    ///
    /// Expected behaviour: one commit for the whole attach.
    #[test]
    fn attaching_an_activity_across_many_sections_commits_once() {
        let mut engine = engine_over_sections(12);
        let commits = commit_counter::watch(&engine);

        let (matched, portions) = engine.attach_activity_junctions("a1").unwrap();

        assert_eq!(matched, 12, "every section covers the same ground");
        assert!(portions >= 12, "each match writes at least one portion");
        assert_eq!(commit_counter::count(&commits), 1);
    }

    #[test]
    fn a_later_junction_failure_leaves_earlier_section_memory_at_the_committed_rows() {
        let mut engine = engine_over_sections(2);
        engine
            .db
            .execute_batch(
                "CREATE TRIGGER fail_second_section BEFORE INSERT ON section_activities
             WHEN NEW.section_id = 's1' BEGIN SELECT RAISE(FAIL, 'second section'); END",
            )
            .unwrap();

        assert!(engine.attach_activity_junctions("a1").is_err());

        let section = engine
            .sections
            .iter()
            .find(|section| section.id == "s0")
            .unwrap();
        assert!(section.activity_ids.is_empty());
        assert!(section.activity_portions.is_empty());
        let rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_activities WHERE section_id = 's0'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
        engine
            .db
            .execute_batch("DROP TRIGGER fail_second_section")
            .unwrap();
        engine.attach_activity_junctions("a1").unwrap();
        let section = engine
            .sections
            .iter()
            .find(|section| section.id == "s0")
            .unwrap();
        assert!(section.activity_ids.contains(&"a1".to_string()));
    }

    /// An activity the matcher finds nothing for writes nothing, so it takes
    /// no transaction either.
    #[test]
    fn an_activity_that_matches_nothing_commits_nothing() {
        let mut engine = engine_over_sections(0);
        let commits = commit_counter::watch(&engine);

        let (matched, portions) = engine.attach_activity_junctions("a1").unwrap();

        assert_eq!((matched, portions), (0, 0));
        assert_eq!(commit_counter::count(&commits), 0);
    }

    /// A straight line the activity runs up and down, so one pass of the
    /// section is one leg and the track carries several.
    fn leg(up: bool) -> Vec<GpsPoint> {
        (0..40)
            .map(|i| {
                let step = if up { i } else { 39 - i };
                GpsPoint {
                    latitude: 46.0 + f64::from(step) * 0.0002,
                    longitude: 7.0,
                    elevation: None,
                }
            })
            .collect()
    }

    static HR_STREAM_READS: AtomicUsize = AtomicUsize::new(0);
    static POWER_STREAM_READS: AtomicUsize = AtomicUsize::new(0);

    fn count_stream_reads(sql: &str) {
        if sql.contains("kind = 'heartrate'") {
            HR_STREAM_READS.fetch_add(1, Ordering::Relaxed);
        }
        if sql.contains("kind = 'watts'") {
            POWER_STREAM_READS.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn the_attach_reads_each_sensor_series_once_for_the_whole_activity() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let points: Vec<GpsPoint> = (0..6).flat_map(|i| leg(i % 2 == 0)).collect();
        let samples = points.len();
        engine
            .add_activity("a1".to_string(), points, "Ride".to_string())
            .unwrap();
        engine
            .store_activity_streams(
                "a1",
                &[
                    StreamDto {
                        kind: "heartrate".to_string(),
                        data: (0..samples).map(|i| Some(100.0 + i as f64)).collect(),
                        data2: None,
                    },
                    StreamDto {
                        kind: "watts".to_string(),
                        data: (0..samples).map(|i| Some(200.0 + i as f64)).collect(),
                        data2: None,
                    },
                ],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES ('s1', 'auto', 'Section 1', 'Ride', ?, 800.0, 0, 1,
                    '2026-01-01T00:00:00Z', 46.0, 46.008, 7.0, 7.0)",
                params![serde_json::to_string(&leg(true)).unwrap()],
            )
            .unwrap();
        engine.load_sections().unwrap();

        HR_STREAM_READS.store(0, Ordering::Relaxed);
        POWER_STREAM_READS.store(0, Ordering::Relaxed);
        engine.db.trace(Some(count_stream_reads));
        let (_, portions) = engine.attach_activity_junctions("a1").unwrap();
        engine.db.trace(None);

        assert!(
            portions >= 2,
            "the track has to pass the section more than once for the count to mean anything, got {portions}"
        );
        assert_eq!(
            HR_STREAM_READS.load(Ordering::Relaxed),
            1,
            "heart rate was read once for {portions} portions"
        );
        assert_eq!(POWER_STREAM_READS.load(Ordering::Relaxed), 1);
    }
}
