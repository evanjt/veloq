//! Section merging: user-initiated merges and merge candidates.

use rusqlite::Result as SqlResult;

use super::super::{PersistentRouteEngine, get_section_word};
use super::haversine_distance;

impl PersistentRouteEngine {
    /// Find merge candidates for a section.
    /// Returns sections with >30% polyline overlap or close centers with similar distances.
    pub fn get_merge_candidates(&self, section_id: &str) -> Vec<crate::FfiMergeCandidate> {
        // Get the query section's data
        let query_data: Option<(f64, f64, f64, String)> = self
            .db
            .query_row(
                "SELECT (COALESCE(bounds_min_lat, 0) + COALESCE(bounds_max_lat, 0)) / 2.0,
                        (COALESCE(bounds_min_lng, 0) + COALESCE(bounds_max_lng, 0)) / 2.0,
                        distance_meters, sport_type
                 FROM sections WHERE id = ? AND bounds_min_lat IS NOT NULL",
                rusqlite::params![section_id],
                |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, f64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .ok();

        let (center_lat, center_lng, query_dist, _query_sport) = match query_data {
            Some(d) => d,
            None => return vec![],
        };

        let query_polyline = self.get_section_polyline(section_id);
        if query_polyline.len() < 4 {
            return vec![];
        }

        // Find nearby sections (within 300m center distance)
        let mut stmt = match self.db.prepare(
            "SELECT s.id, s.name, s.sport_type, s.distance_meters,
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
                    row.get::<_, String>(2)?,         // sport_type
                    row.get::<_, f64>(3)?,            // distance_meters
                    row.get::<_, u32>(4)?,            // visit_count
                    row.get::<_, f64>(5)?,            // center_lat
                    row.get::<_, f64>(6)?,            // center_lng
                ))
            })
            .ok();

        let mut candidates: Vec<crate::FfiMergeCandidate> = Vec::new();

        self.ensure_named_overlay();
        let corridor_names = self.named_overlay_cached_names();
        if let Some(rows) = rows {
            for row in rows.flatten() {
                let (id, name, sport_type, distance_meters, visit_count, lat, lng) = row;
                // Corridor names outrank generated row names on auto sections.
                let name = corridor_names.get(&id).cloned().or(name);

                let center_dist = haversine_distance(center_lat, center_lng, lat, lng);
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
                let candidate_polyline = self.get_section_polyline(&id);
                let overlap = if candidate_polyline.len() >= 4 {
                    super::super::compute_polyline_overlap(
                        query_polyline.clone(),
                        candidate_polyline,
                        50.0, // 50m threshold
                    )
                } else {
                    0.0
                };

                if overlap >= 0.3 {
                    candidates.push(crate::FfiMergeCandidate {
                        section_id: id,
                        name,
                        sport_type,
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

    /// Merge two sections: moves all traversals from secondary into primary,
    /// recomputes consensus polyline, deletes secondary.
    /// Returns the primary section ID on success.
    pub fn merge_user_sections(
        &mut self,
        primary_id: &str,
        secondary_id: &str,
    ) -> SqlResult<String> {
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

        // Both rows become user-owned by the merge: land any resolved
        // corridor names on the rows first (before the transaction borrows
        // the connection), so the primary keeps its name and the secondary's
        // can propagate through the inheritance block below.
        self.adopt_corridor_name(primary_id);
        self.adopt_corridor_name(secondary_id);

        if !primary_exists || !secondary_exists {
            return Err(rusqlite::Error::InvalidParameterName(
                "One or both sections do not exist".to_string(),
            ));
        }

        let tx = self.db.unchecked_transaction()?;

        // Inherit name from secondary if primary has no user-set name
        let primary_name: Option<String> = tx
            .query_row(
                "SELECT name FROM sections WHERE id = ?",
                rusqlite::params![primary_id],
                |row| row.get(0),
            )
            .ok();

        if primary_name.is_none() {
            if let Ok(Some(sec_name)) = tx.query_row(
                "SELECT name FROM sections WHERE id = ?",
                rusqlite::params![secondary_id],
                |row| row.get::<_, Option<String>>(0),
            ) {
                let section_word = get_section_word();
                // Check if it's NOT auto-generated
                let is_auto = [
                    "Ride",
                    "Run",
                    "Hike",
                    "Walk",
                    "Swim",
                    "VirtualRide",
                    "VirtualRun",
                ]
                .iter()
                .any(|sport| {
                    let prefix = format!("{} {} ", sport, section_word);
                    sec_name.starts_with(&prefix) && sec_name[prefix.len()..].parse::<u32>().is_ok()
                });
                if !is_auto {
                    tx.execute(
                        "UPDATE sections SET name = ? WHERE id = ?",
                        rusqlite::params![&sec_name, primary_id],
                    )?;
                }
            }
        }

        // A merge is durable user intent: mark the primary user-defined so the
        // detection wipe spares it and B2 suppression keeps auto detection from
        // re-emitting (and colliding on) its ground on the next resync.
        tx.execute(
            "UPDATE sections SET is_user_defined = 1 WHERE id = ?",
            rusqlite::params![primary_id],
        )?;

        // Move secondary's activities to primary
        tx.execute(
            "UPDATE OR IGNORE section_activities SET section_id = ? WHERE section_id = ?",
            rusqlite::params![primary_id, secondary_id],
        )?;
        // Delete remaining duplicates
        tx.execute(
            "DELETE FROM section_activities WHERE section_id = ?",
            rusqlite::params![secondary_id],
        )?;

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

        // Delete secondary section
        tx.execute(
            "DELETE FROM sections WHERE id = ?",
            rusqlite::params![secondary_id],
        )?;

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
            "tracematch: [merge] Merged section {} into {} ({} activities)",
            secondary_id,
            primary_id,
            merged_outings
        );

        Ok(primary_id.to_string())
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
