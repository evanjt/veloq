//! Section merging: cross-sport auto-merge, user-initiated merges, merge candidates.

use rusqlite::{Result as SqlResult, params};
use std::collections::HashMap;

use super::super::{PersistentRouteEngine, get_section_word};
use super::haversine_distance;

impl PersistentRouteEngine {
    /// Merge sections that overlap geographically across different sport types.
    /// Two sections are candidates for merge if:
    /// - They are both auto-detected (not user-created)
    /// - They have different sport types
    /// - Their bounds centers are within 200m (Haversine)
    /// - Their distances are within 25% of each other
    ///
    /// The primary section (most activities) absorbs the secondary's activities.
    pub fn merge_cross_sport_sections(&mut self) -> SqlResult<()> {
        // Load all auto sections with bounds
        let sections: Vec<(String, String, f64, f64, f64, u32)> = {
            let mut stmt = self.db.prepare(
                "SELECT s.id, s.sport_type, s.distance_meters,
                        (COALESCE(s.bounds_min_lat, 0) + COALESCE(s.bounds_max_lat, 0)) / 2.0,
                        (COALESCE(s.bounds_min_lng, 0) + COALESCE(s.bounds_max_lng, 0)) / 2.0,
                        (SELECT COUNT(*) FROM section_activities sa WHERE sa.section_id = s.id AND sa.excluded = 0)
                 FROM sections s
                 WHERE s.section_type = 'auto' AND s.original_polyline_json IS NULL
                   AND s.bounds_min_lat IS NOT NULL"
            )?;
            stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?, // id
                    row.get::<_, String>(1)?, // sport_type
                    row.get::<_, f64>(2)?,    // distance_meters
                    row.get::<_, f64>(3)?,    // center_lat
                    row.get::<_, f64>(4)?,    // center_lng
                    row.get::<_, u32>(5)?,    // activity_count
                ))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        if sections.len() < 2 {
            return Ok(());
        }

        // Find merge candidates: different sport types, close centers, similar distances
        let mut merge_pairs: Vec<(usize, usize)> = Vec::new();
        for i in 0..sections.len() {
            for j in (i + 1)..sections.len() {
                let (_, ref sport_i, dist_i, lat_i, lng_i, _) = sections[i];
                let (_, ref sport_j, dist_j, lat_j, lng_j, _) = sections[j];

                // Skip same sport type
                if sport_i == sport_j {
                    continue;
                }

                // Check distance similarity (within 25%)
                let max_dist = dist_i.max(dist_j);
                let min_dist = dist_i.min(dist_j);
                if max_dist > 0.0 && (max_dist - min_dist) / max_dist > 0.25 {
                    continue;
                }

                // Haversine distance between centers
                let center_distance = haversine_distance(lat_i, lng_i, lat_j, lng_j);
                if center_distance > 200.0 {
                    continue;
                }

                merge_pairs.push((i, j));
            }
        }

        if merge_pairs.is_empty() {
            return Ok(());
        }

        log::info!(
            "tracematch: [merge_cross_sport] Found {} cross-sport merge candidates",
            merge_pairs.len()
        );

        // Build merge groups using union-find
        let mut parent: Vec<usize> = (0..sections.len()).collect();
        fn find(parent: &mut [usize], i: usize) -> usize {
            if parent[i] != i {
                parent[i] = find(parent, parent[i]);
            }
            parent[i]
        }
        for &(i, j) in &merge_pairs {
            let pi = find(&mut parent, i);
            let pj = find(&mut parent, j);
            if pi != pj {
                // Merge into the one with more activities
                if sections[pi].5 >= sections[pj].5 {
                    parent[pj] = pi;
                } else {
                    parent[pi] = pj;
                }
            }
        }

        // Group sections by their root
        let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
        for i in 0..sections.len() {
            let root = find(&mut parent, i);
            groups.entry(root).or_default().push(i);
        }

        let tx = self.db.unchecked_transaction()?;

        for (_, members) in &groups {
            if members.len() < 2 {
                continue;
            }

            // Primary = member with most activities
            let primary_idx = *members.iter().max_by_key(|&&idx| sections[idx].5).unwrap();
            let primary_id = &sections[primary_idx].0;

            // Check if primary has a user-set name (non-auto-generated)
            let primary_name: Option<String> = tx
                .query_row(
                    "SELECT name FROM sections WHERE id = ?",
                    params![primary_id],
                    |row| row.get(0),
                )
                .ok()
                .flatten();

            for &idx in members {
                if idx == primary_idx {
                    continue;
                }
                let secondary_id = &sections[idx].0;

                // If secondary has a user-set name and primary doesn't, preserve it
                if primary_name.is_none() {
                    if let Ok(Some(sec_name)) = tx.query_row(
                        "SELECT name FROM sections WHERE id = ?",
                        params![secondary_id],
                        |row| row.get::<_, Option<String>>(0),
                    ) {
                        let section_word = get_section_word();
                        // Check if it's NOT auto-generated (doesn't match "{Sport} {Word} {N}" pattern)
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
                            sec_name.starts_with(&prefix)
                                && sec_name[prefix.len()..].parse::<u32>().is_ok()
                        });
                        if !is_auto {
                            tx.execute(
                                "UPDATE sections SET name = ? WHERE id = ?",
                                params![&sec_name, primary_id],
                            )?;
                        }
                    }
                }

                // Move secondary's activities to primary
                tx.execute(
                    "UPDATE OR IGNORE section_activities SET section_id = ? WHERE section_id = ?",
                    params![primary_id, secondary_id],
                )?;
                // Delete any that couldn't be moved (duplicate activity_id + section_id)
                tx.execute(
                    "DELETE FROM section_activities WHERE section_id = ?",
                    params![secondary_id],
                )?;
                // Delete secondary section
                tx.execute("DELETE FROM sections WHERE id = ?", params![secondary_id])?;

                log::info!(
                    "tracematch: [merge_cross_sport] Merged {} ({}) into {} ({})",
                    secondary_id,
                    sections[idx].1,
                    primary_id,
                    sections[primary_idx].1
                );
            }
        }

        tx.commit()?;

        // Reload sections into memory
        self.section_cache.clear();
        self.invalidate_perf_cache();
        self.load_sections()?;

        Ok(())
    }

    /// Find merge candidates for a section.
    /// Returns sections with >30% polyline overlap or close centers with similar distances.
    pub fn get_merge_candidates(
        &self,
        section_id: &str,
    ) -> Vec<crate::FfiMergeCandidate> {
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
                    (SELECT COUNT(*) FROM section_activities sa WHERE sa.section_id = s.id AND sa.excluded = 0),
                    (COALESCE(s.bounds_min_lat, 0) + COALESCE(s.bounds_max_lat, 0)) / 2.0,
                    (COALESCE(s.bounds_min_lng, 0) + COALESCE(s.bounds_max_lng, 0)) / 2.0
             FROM sections s
             WHERE s.id != ? AND s.disabled = 0 AND s.superseded_by IS NULL
               AND s.bounds_min_lat IS NOT NULL",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let rows = stmt
            .query_map(rusqlite::params![section_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,         // id
                    row.get::<_, Option<String>>(1)?,  // name
                    row.get::<_, String>(2)?,         // sport_type
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
                let (id, name, sport_type, distance_meters, visit_count, lat, lng) = row;

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
                    "Ride", "Run", "Hike", "Walk", "Swim", "VirtualRide", "VirtualRun",
                ]
                .iter()
                .any(|sport| {
                    let prefix = format!("{} {} ", sport, section_word);
                    sec_name.starts_with(&prefix)
                        && sec_name[prefix.len()..].parse::<u32>().is_ok()
                });
                if !is_auto {
                    tx.execute(
                        "UPDATE sections SET name = ? WHERE id = ?",
                        rusqlite::params![&sec_name, primary_id],
                    )?;
                }
            }
        }

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

        // visit_count is derived at read-time via COUNT(*) on section_activities —
        // there is no stored visit_count column on sections.
        let visit_count: u32 = tx
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

        log::info!(
            "tracematch: [merge] Merged section {} into {} ({} activities)",
            secondary_id,
            primary_id,
            visit_count
        );

        Ok(primary_id.to_string())
    }

    /// Recompute a section's bounds and distance from its current polyline.
    /// Called after merge to ensure bounds reflect the primary section's polyline.
    fn recompute_section_bounds(&self, section_id: &str) {
        let polyline_json: Option<String> = self
            .db
            .query_row(
                "SELECT polyline_json FROM sections WHERE id = ?",
                rusqlite::params![section_id],
                |row| row.get(0),
            )
            .ok();

        let points: Vec<tracematch::GpsPoint> = polyline_json
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();

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
