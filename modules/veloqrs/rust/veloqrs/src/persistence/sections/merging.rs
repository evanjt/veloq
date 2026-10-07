//! Section merging: user-initiated merges and merge candidates.

use rusqlite::Result as SqlResult;

use super::super::PersistentEngine;
use super::haversine_distance;
use super::is_section_handle;

impl PersistentEngine {
    /// Find merge candidates for a section.
    /// Returns sections with >30% polyline overlap or close centers with similar distances.
    pub fn get_merge_candidates(&self, section_id: &str) -> Vec<crate::FfiMergeCandidate> {
        self.ensure_named_overlay();
        let names = self.named_overlay_cached_names();
        pooled::merge_candidates(&self.db, section_id, &names)
    }

    /// The donor rides a merge into `primary_id` would leave out: those with
    /// no pass over the primary's line. Writes nothing, and runs the matcher
    /// the merge itself runs, so the list and the merge cannot disagree.
    pub fn merge_preview(
        &self,
        primary_id: &str,
        secondary_id: &str,
    ) -> SqlResult<Vec<crate::FfiMergeDropped>> {
        pooled::merge_preview_with(&self.db, &self.section_config, primary_id, secondary_id)
    }

    /// Merge two sections: rebuilds the primary's traversals against its own
    /// line over the rides of both, recomputes bounds and distance, deletes
    /// secondary. A donor ride with no pass over the primary's line leaves the
    /// section and stays in the library.
    /// Returns the primary section ID on success.
    pub fn merge_user_sections(
        &mut self,
        primary_id: &str,
        secondary_id: &str,
    ) -> SqlResult<String> {
        self.merge_user_sections_reporting(primary_id, secondary_id)
            .map(|(kept, _departed)| kept)
    }

    /// The merge, and with the primary section ID the ids of the forced rides
    /// that have no pass over the kept line and so left the section.
    pub fn merge_user_sections_reporting(
        &mut self,
        primary_id: &str,
        secondary_id: &str,
    ) -> SqlResult<(String, Vec<String>)> {
        if primary_id == secondary_id {
            return Err(rusqlite::Error::InvalidParameterName(
                "Cannot merge a section with itself".to_string(),
            ));
        }

        // Validate both sections exist
        let primary_exists: bool = self
            .db
            .query_row(
                "SELECT COUNT(*) > 0 FROM sections WHERE id = ?",
                rusqlite::params![primary_id],
                |row| row.get(0),
            )
            .unwrap_or(false);
        let secondary_exists: bool = self
            .db
            .query_row(
                "SELECT COUNT(*) > 0 FROM sections WHERE id = ?",
                rusqlite::params![secondary_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !primary_exists || !secondary_exists {
            return Err(rusqlite::Error::InvalidParameterName(
                "One or both sections do not exist".to_string(),
            ));
        }

        let mut ride_ids = pooled::section_ride_ids(&self.db, primary_id);
        for id in pooled::section_ride_ids(&self.db, secondary_id) {
            if !ride_ids.contains(&id) {
                ride_ids.push(id);
            }
        }
        let line =
            pooled::merge_target_line(&self.db, &self.section_config, primary_id, &ride_ids)?;
        let (portions, _) =
            pooled::match_rides_to_line(&self.db, &self.section_config, &line, &ride_ids);
        // Exclusions and hand attachments are the athlete's decisions on a
        // ride: they survive the rebuild from whichever section carried them.
        let mut decisions = self.capture_user_decisions(primary_id);
        let donor_decisions = self.capture_user_decisions(secondary_id);
        decisions.full.extend(donor_decisions.full);
        decisions.partial.extend(donor_decisions.partial);
        decisions.forced.extend(donor_decisions.forced);
        decisions.forced.sort();
        decisions.forced.dedup();

        // Both rows become user-owned by the merge: land resolved names on
        // the rows before the transaction borrows the connection.
        self.adopt_corridor_name(primary_id);
        self.adopt_corridor_name(secondary_id);

        let tx = self.db.unchecked_transaction()?;

        // Inherit name from secondary if primary has no user-set name
        let primary_name: Option<String> = tx
            .query_row(
                "SELECT name FROM sections WHERE id = ?",
                rusqlite::params![primary_id],
                |row| row.get(0),
            )
            .ok();

        if primary_name.as_deref().is_none_or(is_section_handle)
            && let Ok(Some(sec_name)) = tx.query_row(
                "SELECT name FROM sections WHERE id = ?",
                rusqlite::params![secondary_id],
                |row| row.get::<_, Option<String>>(0),
            )
            && !is_section_handle(&sec_name)
        {
            tx.execute(
                "UPDATE sections SET name = ? WHERE id = ?",
                rusqlite::params![&sec_name, primary_id],
            )?;
        }

        // A merge is durable user intent: mark the primary user-defined so the
        // detection wipe spares it and suppression keeps auto detection from
        // re-emitting (and colliding on) its ground on the next resync.
        tx.execute(
            "UPDATE sections SET is_user_defined = 1 WHERE id = ?",
            rusqlite::params![primary_id],
        )?;

        tx.execute(
            "DELETE FROM section_activities WHERE section_id IN (?1, ?2)",
            rusqlite::params![primary_id, secondary_id],
        )?;
        for portion in &portions {
            tx.execute(
                "INSERT OR IGNORE INTO section_activities
                 (section_id, activity_id, direction, start_index, end_index, distance_meters)
                 VALUES (?, ?, ?, ?, ?, ?)",
                rusqlite::params![
                    primary_id,
                    portion.activity_id,
                    portion.direction.to_string(),
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                ],
            )?;
        }
        let departed = self
            .restore_user_decisions(primary_id, &line, &decisions)
            .map_err(rusqlite::Error::InvalidParameterName)?;

        // Clear superseded_by on any sections pointing to secondary
        tx.execute(
            "UPDATE sections SET superseded_by = NULL WHERE superseded_by = ?",
            rusqlite::params![secondary_id],
        )?;

        // Outings, for the log line only. The stored sections.visit_count is
        // the junction triggers' business, including the move above.
        let merged_outings: u32 = tx
            .query_row(
                "SELECT COUNT(DISTINCT activity_id) FROM section_activities WHERE section_id = ? AND excluded = 0",
                rusqlite::params![primary_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // Delete secondary section; its number stays with its id
        tx.execute(
            "DELETE FROM sections WHERE id = ?",
            rusqlite::params![secondary_id],
        )?;
        tx.execute(
            "DELETE FROM section_pins WHERE section_id IN (?1, ?2)",
            rusqlite::params![primary_id, secondary_id],
        )?;
        tx.execute(
            "DELETE FROM section_forced_matches WHERE section_id = ?",
            rusqlite::params![secondary_id],
        )?;

        let absorbed = serde_json::json!({ "absorbed": [secondary_id] }).to_string();
        super::history::append_history_on(
            &tx,
            primary_id,
            super::history::KIND_ABSORBED,
            Some(&absorbed),
            None,
            None,
        )?;
        let into = serde_json::json!({ "into": primary_id }).to_string();
        super::history::append_history_on(&tx, secondary_id, "merged", Some(&into), None, None)?;

        tx.commit()?;

        // Recompute bounds from existing polyline
        self.recompute_section_bounds(primary_id);

        // Reload sections into memory
        self.section_cache.clear();
        self.invalidate_perf_cache();
        self.load_sections()?;

        // Identity ownership of both grounds now belongs to the durable primary
        // row: relinquish them from the registry so the next detect neither
        // carries nor debounce-dissolves a ground the DB row now owns.
        self.section_identity_relinquish(primary_id);
        self.section_identity_relinquish(secondary_id);

        log::info!(
            "veloqrs: [merge] Merged section {} into {} ({} activities)",
            secondary_id,
            primary_id,
            merged_outings
        );

        Ok((primary_id.to_string(), departed))
    }

    /// Recompute a section's bounds and distance from its current polyline.
    /// Called after merge to ensure bounds reflect the primary section's polyline.
    fn recompute_section_bounds(&self, section_id: &str) {
        let points: Vec<tracematch::GpsPoint> =
            self.stored_section_polyline(section_id).unwrap_or_default();

        if points.len() < 2 {
            return;
        }

        let distance = tracematch::matching::calculate_route_distance(&points);

        let (mut min_lat, mut max_lat, mut min_lng, mut max_lng) =
            (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in &points {
            min_lat = min_lat.min(p.latitude);
            max_lat = max_lat.max(p.latitude);
            min_lng = min_lng.min(p.longitude);
            max_lng = max_lng.max(p.longitude);
        }

        let _ = self.db.execute(
            "UPDATE sections SET distance_meters = ?,
             bounds_min_lat = ?, bounds_max_lat = ?, bounds_min_lng = ?, bounds_max_lng = ?
             WHERE id = ?",
            rusqlite::params![distance, min_lat, max_lat, min_lng, max_lng, section_id],
        );
    }
}

/// The merge reads over a connection. The engine methods above delegate here
/// rather than carrying a second copy, so a pooled read and the engine's
/// cannot drift.
pub(crate) mod pooled {
    use std::collections::BTreeMap;

    use rusqlite::{Connection, Result as SqlResult};

    /// [`merge_preview_with`] under the section config the settings rows hold,
    /// for a read that holds no engine.
    pub(crate) fn merge_preview(
        conn: &Connection,
        primary_id: &str,
        secondary_id: &str,
    ) -> SqlResult<Vec<crate::FfiMergeDropped>> {
        let config = crate::persistence::settings::section_config_from(conn)?;
        merge_preview_with(conn, &config, primary_id, secondary_id)
    }

    pub(crate) fn merge_preview_with(
        conn: &Connection,
        config: &tracematch::SectionConfig,
        primary_id: &str,
        secondary_id: &str,
    ) -> SqlResult<Vec<crate::FfiMergeDropped>> {
        let donor_rides = section_ride_ids(conn, secondary_id);
        let line = merge_target_line(conn, config, primary_id, &donor_rides)?;
        let (_, unmatched) = match_rides_to_line(conn, config, &line, &donor_rides);
        Ok(unmatched
            .into_iter()
            .map(|activity_id| {
                let (name, start_date) = conn
                    .query_row(
                        "SELECT COALESCE(name, ''), start_date FROM activities WHERE id = ?",
                        rusqlite::params![activity_id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as f64)),
                    )
                    .unwrap_or_default();
                crate::FfiMergeDropped {
                    activity_id,
                    name,
                    start_date,
                }
            })
            .collect())
    }

    /// The line the merged section's rides are matched against. A primary
    /// with no usable line cannot be matched against, so with rides to place
    /// the merge refuses rather than rebuild the junction empty.
    pub(super) fn merge_target_line(
        conn: &Connection,
        config: &tracematch::SectionConfig,
        primary_id: &str,
        ride_ids: &[String],
    ) -> SqlResult<Vec<tracematch::GpsPoint>> {
        let line = super::super::geometry::stored_line(conn, primary_id).unwrap_or_default();
        if !ride_ids.is_empty() && tracematch::PreparedLine::new(&line, config).is_none() {
            return Err(rusqlite::Error::InvalidParameterName(
                "The section kept by a merge has no line to match rides against".to_string(),
            ));
        }
        Ok(line)
    }

    /// Every ride with a junction row on the section, excluded ones included.
    pub(super) fn section_ride_ids(conn: &Connection, section_id: &str) -> Vec<String> {
        let Ok(mut stmt) = conn
            .prepare("SELECT DISTINCT activity_id FROM section_activities WHERE section_id = ?")
        else {
            return Vec::new();
        };
        stmt.query_map(rusqlite::params![section_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    /// Match each ride against one line: every pass it makes over it, and the
    /// rides with none. The one matcher both the preview and the merge use.
    pub(super) fn match_rides_to_line(
        conn: &Connection,
        config: &tracematch::SectionConfig,
        line: &[tracematch::GpsPoint],
        ride_ids: &[String],
    ) -> (Vec<tracematch::SectionPortion>, Vec<String>) {
        let Some(prepared) = tracematch::PreparedLine::new(line, config) else {
            return (Vec::new(), ride_ids.to_vec());
        };
        let mut portions = Vec::new();
        let mut unmatched = Vec::new();
        for id in ride_ids {
            let found = crate::persistence::activities::pooled::gps_track(conn, id)
                .map(|track| prepared.portions(id, &track))
                .unwrap_or_default();
            if found.is_empty() {
                unmatched.push(id.clone());
            } else {
                portions.extend(found);
            }
        }
        (portions, unmatched)
    }

    /// One section's stored line, flattened the way the overlap takes it.
    fn stored_line_flat(conn: &Connection, section_id: &str) -> Vec<f64> {
        match super::super::geometry::stored_line(conn, section_id) {
            Ok(points) => points
                .iter()
                .flat_map(|p| [p.latitude, p.longitude])
                .collect(),
            Err(e) => {
                log::error!("veloqrs: pooled section polyline decode error for {section_id}: {e}");
                Vec::new()
            }
        }
    }

    pub(crate) fn merge_candidates(
        conn: &Connection,
        section_id: &str,
        corridor_names: &BTreeMap<String, String>,
    ) -> Vec<crate::FfiMergeCandidate> {
        // Get the query section's data
        let query_data: Option<(f64, f64, f64)> = conn
            .query_row(
                "SELECT (COALESCE(bounds_min_lat, 0) + COALESCE(bounds_max_lat, 0)) / 2.0,
                        (COALESCE(bounds_min_lng, 0) + COALESCE(bounds_max_lng, 0)) / 2.0,
                        distance_meters
                 FROM sections WHERE id = ? AND bounds_min_lat IS NOT NULL",
                rusqlite::params![section_id],
                |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, f64>(2)?,
                    ))
                },
            )
            .ok();

        let (center_lat, center_lng, query_dist) = match query_data {
            Some(d) => d,
            None => return vec![],
        };

        let query_polyline = stored_line_flat(conn, section_id);
        if query_polyline.len() < 4 {
            return vec![];
        }

        // Find nearby sections (within 300m center distance)
        let mut stmt = match conn.prepare(
            "SELECT s.id, s.name, s.sport_types, s.distance_meters,
                    s.visit_count,
                    (COALESCE(s.bounds_min_lat, 0) + COALESCE(s.bounds_max_lat, 0)) / 2.0,
                    (COALESCE(s.bounds_min_lng, 0) + COALESCE(s.bounds_max_lng, 0)) / 2.0
             FROM sections s
             WHERE s.id != ? AND s.disabled = 0 AND s.superseded_by IS NULL
               AND s.bounds_min_lat IS NOT NULL
             ORDER BY s.id",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let rows = stmt
            .query_map(rusqlite::params![section_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,         // id
                    row.get::<_, Option<String>>(1)?, // name
                    row.get::<_, Option<String>>(2)?, // sport_types
                    row.get::<_, f64>(3)?,            // distance_meters
                    row.get::<_, u32>(4)?,            // visit_count
                    row.get::<_, f64>(5)?,            // center_lat
                    row.get::<_, f64>(6)?,            // center_lng
                ))
            })
            .ok();

        let mut candidates: Vec<crate::FfiMergeCandidate> = Vec::new();

        if let Some(rows) = rows {
            for row in rows.flatten() {
                let (id, name, sport_types, distance_meters, visit_count, lat, lng) = row;
                // Corridor names outrank generated row names on auto sections.
                let name = corridor_names.get(&id).cloned().or(name);

                let center_dist = super::haversine_distance(center_lat, center_lng, lat, lng);
                if center_dist > 300.0 {
                    continue;
                }

                // Check distance similarity (within 30%)
                let max_dist = query_dist.max(distance_meters);
                let min_dist = query_dist.min(distance_meters);
                let dist_ratio = if max_dist > 0.0 {
                    (max_dist - min_dist) / max_dist
                } else {
                    1.0
                };
                if dist_ratio > 0.3 {
                    continue;
                }

                // Compute polyline overlap
                let candidate_polyline = stored_line_flat(conn, &id);
                let overlap = if candidate_polyline.len() >= 4 {
                    // Both lines come off disk already paired, so the
                    // even-length refusal on the FFI entry cannot fire here.
                    crate::persistence::compute_polyline_overlap(
                        query_polyline.clone(),
                        candidate_polyline,
                        tracematch::sections::GROUND_TOL_M,
                    )
                    .unwrap_or(0.0)
                } else {
                    0.0
                };

                if overlap >= 0.3 {
                    candidates.push(crate::FfiMergeCandidate {
                        section_id: id,
                        name,
                        sport_types: crate::persistence::sections::queries::pooled::sport_set(
                            sport_types,
                        ),
                        distance_meters,
                        visit_count,
                        overlap_pct: overlap,
                        center_distance_meters: center_dist,
                    });
                }
            }
        }

        candidates.sort_by(|a, b| {
            b.overlap_pct
                .partial_cmp(&a.overlap_pct)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.section_id.cmp(&b.section_id))
        });
        candidates.truncate(10);
        candidates
    }
}

#[cfg(test)]
#[path = "tests/merge_preview.rs"]
mod merge_preview;
