//! Activity indicators: materialised PR and trend badges.
//!
//! Computed once after sync/detection, stored in `activity_indicators` table.
//! Feed card rendering reads from this table - no on-demand computation needed.

use rusqlite::{Result as SqlResult, params};
use std::collections::HashMap;

use super::{PersistentEngine, codec};

/// A traversal has to beat, or miss, the running average by this fraction
/// before the feed card calls it a move. Matches the section ranking deadband.
const TREND_DEADBAND: f64 = 0.02;

/// Bump this when the indicator computation algorithm changes.
/// On next read, a version mismatch triggers a full clean recompute.
const INDICATOR_ALGORITHM_VERSION: i32 = 5;

impl PersistentEngine {
    /// Recompute all activity indicators (PRs and trends) from scratch.
    ///
    /// Called after:
    /// - `apply_sections()` (section detection finished)
    /// - Route grouping completes
    /// - Activity exclude/include changes
    /// - Data expansion (more history synced)
    ///
    /// Algorithm:
    /// 1. Clear the table
    /// 2. For each (section, direction) pair: find PR + compute per-activity trends
    /// 3. For each route group: find PR + compute per-activity trends
    /// 4. Bulk-insert all indicators
    pub fn recompute_activity_indicators(&self) -> SqlResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        // Step 0: Backfill any NULL lap_time values from time_streams.
        // This ensures section_activities has real recorded times wherever possible,
        // so the indicator computation uses actual data instead of estimates.
        let backfilled = self.backfill_null_lap_times()?;
        if backfilled > 0 {
            log::info!(
                "veloqrs: [indicators] Backfilled lap_time for {} section portions from time streams",
                backfilled
            );
        }

        let tx = self.db.unchecked_transaction()?;
        tx.execute("DELETE FROM activity_indicators", [])?;

        // Section indicators only - route highlights are computed inline
        // from in-memory groups + activity_metrics (no table needed).
        let section_count = self.compute_section_indicators(&tx, now)?;

        // Stamp the algorithm version so we don't recompute until it changes
        tx.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('indicator_version', ?)",
            params![INDICATOR_ALGORITHM_VERSION.to_string()],
        )?;

        tx.commit()?;

        log::info!(
            "veloqrs: [indicators] Recomputed {} section indicators (v{})",
            section_count,
            INDICATOR_ALGORITHM_VERSION
        );

        Ok(())
    }

    /// Compute section PRs and trends, insert into activity_indicators.
    /// Returns total number of indicators inserted.
    fn compute_section_indicators(&self, tx: &rusqlite::Transaction, now: i64) -> SqlResult<usize> {
        // Effective time: use lap_time if available, otherwise estimate from
        // activity duration proportional to section distance.
        // This handles the common case where lap_time is NULL (not yet populated
        // from time streams) while still producing useful indicators.
        let effective_time_expr = "COALESCE(sa.lap_time,
                      CASE WHEN a.distance_meters > 0 AND sa.distance_meters > 0
                           THEN a.duration_secs * (sa.distance_meters / a.distance_meters)
                           ELSE NULL END)";

        // Pairs with 2+ non-excluded activities. Counting rows would let one
        // lapped session qualify against itself.
        //
        // PR completeness rules (apply to both the pair list AND the per-pair
        // traversal scan below):
        //  - Skip "partial" direction rows. A partial overlap only covers part
        //    of the section, so its lap_time is for that fragment, not a full
        //    traversal. Without this filter, a 200m partial of a 2km section
        //    can show up as a "PR" of 1:24 in feed badges.
        //  - Skip rows that span too little of the section, the same rule
        //    `covers_enough_for_record` applies in Rust, written once here as
        //    `COMPLETE_TRAVERSAL_SQL` so the two cannot drift.
        //  - Group by sport. A record and a trend are earned against the same
        //    sport's efforts, so shared ground carries one of each per sport.
        let complete = crate::persistence::records::complete_traversal_sql();
        let pair_sql = format!(
            "SELECT sa.section_id, sa.direction, a.sport_type, COUNT(DISTINCT sa.activity_id) as cnt
             FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             JOIN activities a ON a.id = sa.activity_id
             WHERE sa.excluded = 0
               AND {} IS NOT NULL
               AND s.disabled = 0
               AND s.superseded_by IS NULL
               AND sa.direction != 'partial'
               AND ({complete})
             GROUP BY sa.section_id, sa.direction, a.sport_type
             HAVING cnt >= 2",
            effective_time_expr,
            complete = complete
        );

        let mut pair_stmt = tx.prepare(&pair_sql)?;

        let pairs: Vec<(String, String, String)> = pair_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        if pairs.is_empty() {
            return Ok(0);
        }

        // Load section names once
        let section_names = self.load_section_names(tx)?;

        let mut insert_stmt = tx.prepare(
            "INSERT OR REPLACE INTO activity_indicators
             (activity_id, indicator_type, target_id, target_name, direction, lap_time, trend, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )?;

        let mut total = 0;

        // For each (section, direction, sport) group: traversals ordered by date.
        // Same completeness filter as the pair query above so the per-traversal
        // best matches what `get_section_performances_filtered` produces.
        let traversal_sql = format!(
            "SELECT sa.activity_id, {} as effective_time
             FROM section_activities sa
             JOIN activities a ON a.id = sa.activity_id
             JOIN sections s ON s.id = sa.section_id
             WHERE sa.section_id = ?
               AND sa.direction = ?
               AND a.sport_type = ?
               AND sa.excluded = 0
               AND sa.direction != 'partial'
               AND ({complete})
             ORDER BY a.start_date ASC",
            effective_time_expr,
            complete = complete
        );
        let mut traversal_stmt = tx.prepare(&traversal_sql)?;

        for (section_id, direction, sport_type) in &pairs {
            let passes: Vec<(String, f64)> = traversal_stmt
                .query_map(params![section_id, direction, sport_type], |row| {
                    let time: Option<f64> = row.get(1)?;
                    Ok((row.get::<_, String>(0)?, time.unwrap_or(0.0)))
                })?
                .filter_map(|r| r.ok())
                .filter(|(_, t)| *t > 0.0)
                .collect();

            // One badge per activity, earned by its fastest pass. The indicator
            // key is `(activity_id, indicator_type, target_id, direction)`, and
            // the running average below compares activities, not laps. First
            // appearance sets the order, keeping the sequence chronological.
            let mut traversals: Vec<(String, f64)> = Vec::new();
            let mut seen: HashMap<&str, usize> = HashMap::new();
            for (activity_id, time) in &passes {
                match seen.get(activity_id.as_str()) {
                    Some(&i) => {
                        if *time < traversals[i].1 {
                            traversals[i].1 = *time;
                        }
                    }
                    None => {
                        seen.insert(activity_id.as_str(), traversals.len());
                        traversals.push((activity_id.clone(), *time));
                    }
                }
            }

            if traversals.len() < 2 {
                continue;
            }

            // Find the global best (minimum lap_time)
            let best_time = traversals.iter().map(|(_, t)| *t).fold(f64::MAX, f64::min);

            let section_name = section_names.get(section_id).cloned().unwrap_or_default();

            // Compute running-average trend for each traversal
            let mut running_sum = 0.0f64;
            let mut count = 0u32;

            for (activity_id, lap_time) in &traversals {
                let is_pr = crate::persistence::records::is_personal_record(*lap_time, best_time);

                let trend: i8 = if count == 0 {
                    0
                } else {
                    let avg = running_sum / count as f64;
                    crate::trend::classify_time(avg, *lap_time, TREND_DEADBAND).unwrap_or(0)
                };

                // PR forces trend to 1 (improving by definition)
                let effective_trend = if is_pr { 1 } else { trend };

                if is_pr {
                    insert_stmt.execute(params![
                        activity_id,
                        "section_pr",
                        section_id,
                        &section_name,
                        direction,
                        lap_time,
                        effective_trend,
                        now,
                    ])?;
                    total += 1;
                }

                if is_pr || trend != 0 {
                    insert_stmt.execute(params![
                        activity_id,
                        "section_trend",
                        section_id,
                        &section_name,
                        direction,
                        lap_time,
                        trend, // original trend, not effective_trend
                        now,
                    ])?;
                    total += 1;
                }

                running_sum += lap_time;
                count += 1;
            }
        }

        Ok(total)
    }

    /// Compute route PRs and trends, insert into activity_indicators.
    /// Returns total number of indicators inserted.
    /// Load section names from the sections table.
    fn load_section_names(
        &self,
        conn: &rusqlite::Connection,
    ) -> SqlResult<HashMap<String, String>> {
        let mut stmt =
            conn.prepare("SELECT id, name FROM sections WHERE name IS NOT NULL AND disabled = 0")?;
        let mut names = HashMap::new();
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for r in rows.flatten() {
            names.insert(r.0, r.1);
        }
        // Corridor names outrank generated row names on auto sections, so the
        // section-PR chips and notification bodies built from these show what
        // the user actually called the section.
        self.ensure_named_overlay();
        for (id, name) in self
            .named_overlay
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .by_section
            .iter()
        {
            names.insert(id.clone(), name.clone());
        }
        Ok(names)
    }

    /// Read pre-computed indicators for a batch of activity IDs.
    /// Version check: if the stored algorithm version doesn't match the current
    /// constant, triggers a full clean recompute before returning results.
    pub fn get_activity_indicators(
        &self,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivityIndicator> {
        if activity_ids.is_empty() {
            return vec![];
        }

        // Version-based invalidation: recompute if algorithm changed
        let stored_version: i32 = self
            .db
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = 'indicator_version'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if stored_version < INDICATOR_ALGORITHM_VERSION {
            log::info!(
                "veloqrs: [indicators] Version mismatch (stored={}, current={}) - recomputing",
                stored_version,
                INDICATOR_ALGORITHM_VERSION
            );
            if let Err(e) = self.recompute_activity_indicators() {
                log::warn!("veloqrs: [indicators] Recomputation failed: {}", e);
            }
        }

        let placeholders: String = activity_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT activity_id, indicator_type, target_id, target_name, direction, lap_time, trend
             FROM activity_indicators
             WHERE activity_id IN ({})",
            placeholders
        );

        let mut stmt = match self.db.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("veloqrs: [indicators] read failed: {}", e);
                return vec![];
            }
        };

        let params: Vec<&dyn rusqlite::types::ToSql> = activity_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        match stmt.query_map(params.as_slice(), |row| {
            Ok(crate::FfiActivityIndicator {
                activity_id: row.get(0)?,
                indicator_type: row.get(1)?,
                target_id: row.get(2)?,
                target_name: row.get(3)?,
                direction: row.get(4)?,
                lap_time: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                trend: row.get(6)?,
            })
        }) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                log::warn!("veloqrs: [indicators] query failed: {}", e);
                vec![]
            }
        }
    }

    /// Backfill NULL lap_time values in section_activities from time_streams.
    /// Time streams store cumulative timestamps at each GPS point index, so
    /// lap_time = times[end_index] - times[start_index].
    /// Returns the number of rows updated.
    fn backfill_null_lap_times(&self) -> SqlResult<usize> {
        // Find all section_activities rows with NULL lap_time that have valid indices
        let portions: Vec<(String, String, u32, u32, f64)> = self
            .db
            .prepare(
                "SELECT sa.section_id, sa.activity_id, sa.start_index, sa.end_index, sa.distance_meters
                 FROM section_activities sa
                 WHERE sa.lap_time IS NULL
                   AND sa.start_index > 0
                   AND sa.end_index > sa.start_index",
            )?
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        if portions.is_empty() {
            return Ok(0);
        }

        // Collect unique activity IDs that need time streams
        let activity_ids: std::collections::HashSet<String> = portions
            .iter()
            .map(|(_, aid, _, _, _)| aid.clone())
            .collect();

        // Load time streams for those activities
        let mut time_streams: HashMap<String, Vec<u32>> = HashMap::new();
        for activity_id in &activity_ids {
            if let Ok(stream) = self.db.query_row(
                "SELECT times FROM time_streams WHERE activity_id = ?",
                [activity_id],
                |row| {
                    let bytes: Vec<u8> = row.get(0)?;
                    let times: Vec<u32> =
                        codec::deserialize(&bytes).map_err(|_| rusqlite::Error::InvalidQuery)?;
                    Ok(times)
                },
            ) {
                time_streams.insert(activity_id.clone(), stream);
            }
        }

        if time_streams.is_empty() {
            return Ok(0);
        }

        // One commit for the pass: each row on its own is its own fsync under
        // the engine write lock, and a library has thousands of them.
        let tx = self.db.unchecked_transaction()?;
        let mut updated = 0usize;
        {
            let mut update_stmt = tx.prepare(
                "UPDATE section_activities
                 SET lap_time = ?, lap_pace = ?
                 WHERE section_id = ? AND activity_id = ? AND start_index = ?",
            )?;
            for (section_id, activity_id, start_idx, end_idx, distance) in &portions {
                let (lap_time, lap_pace) = super::sections::compute_lap_time_from_stream(
                    time_streams.get(activity_id).map(Vec::as_slice),
                    *start_idx,
                    *end_idx,
                    *distance,
                );
                let (Some(lap_time), Some(lap_pace)) = (lap_time, lap_pace) else {
                    continue;
                };
                update_stmt.execute(params![
                    lap_time,
                    lap_pace,
                    section_id,
                    activity_id,
                    start_idx
                ])?;
                updated += 1;
            }
        }
        tx.commit()?;

        Ok(updated)
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::params;

    use super::super::commit_counter;
    use super::PersistentEngine;
    use tracematch::GpsPoint;

    /// One activity with a time stream, in `sections` sections, each portion
    /// with no lap time yet.
    fn engine_with_null_laps(sections: usize) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let coords: Vec<GpsPoint> = (0..8)
            .map(|i| GpsPoint {
                latitude: 46.2 + i as f64 * 0.001,
                longitude: 7.3,
                elevation: None,
            })
            .collect();
        engine
            .add_activity("a1".to_string(), coords, "Ride".to_string())
            .unwrap();
        engine
            .store_time_stream("a1", &[0, 10, 20, 30, 40, 50, 60, 70])
            .unwrap();
        for s in 0..sections {
            let sid = format!("s{s}");
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                     VALUES (?, 'auto', ?, 'Ride', '[]', 400.0, 0, 1, '2026-01-01T00:00:00Z',
                        46.2, 46.21, 7.3, 7.31)",
                    params![sid, format!("Section {s}")],
                )
                .unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters)
                     VALUES (?, 'a1', 'same', 1, 5, 400.0)",
                    params![sid],
                )
                .unwrap();
        }
        engine
    }

    fn null_lap_times(engine: &PersistentEngine) -> i64 {
        engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_activities WHERE lap_time IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    /// Every lap was its own autocommit and its own fsync under the engine
    /// write lock. The whole pass is one transaction.
    #[test]
    fn backfilling_many_laps_is_one_commit() {
        let engine = engine_with_null_laps(12);
        let commits = commit_counter::watch(&engine);

        assert_eq!(engine.backfill_null_lap_times().unwrap(), 12);

        assert_eq!(commit_counter::count(&commits), 1);
        assert_eq!(null_lap_times(&engine), 0);
        let lap_time: f64 = engine
            .db
            .query_row(
                "SELECT lap_time FROM section_activities WHERE section_id = 's3'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lap_time, 30.0); // times[4] - times[1], the end is half-open
    }

    /// A portion that runs to the last point of its activity carries the
    /// stream's length as its half-open end, and gets a time like any other.
    #[test]
    fn a_portion_ending_on_the_last_point_gets_a_time() {
        let engine = engine_with_null_laps(1);
        engine
            .db
            .execute(
                "UPDATE section_activities SET end_index = 8 WHERE section_id = 's0'",
                [],
            )
            .unwrap();

        assert_eq!(engine.backfill_null_lap_times().unwrap(), 1);

        let lap_time: f64 = engine
            .db
            .query_row(
                "SELECT lap_time FROM section_activities WHERE section_id = 's0'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lap_time, 60.0); // times[7] - times[1]
    }

    /// A second pass finds nothing and writes nothing.
    #[test]
    fn backfilling_nothing_commits_nothing() {
        let engine = engine_with_null_laps(3);
        engine.backfill_null_lap_times().unwrap();
        let commits = commit_counter::watch(&engine);

        assert_eq!(engine.backfill_null_lap_times().unwrap(), 0);

        assert_eq!(commit_counter::count(&commits), 0);
    }

    /// A portion whose activity has no stream stays NULL, and the pass still
    /// commits once for the ones it could resolve.
    #[test]
    fn a_streamless_portion_stays_null_inside_the_one_commit() {
        let mut engine = engine_with_null_laps(4);
        engine
            .add_activity(
                "a2".to_string(),
                vec![
                    GpsPoint {
                        latitude: 46.3,
                        longitude: 7.4,
                        elevation: None,
                    },
                    GpsPoint {
                        latitude: 46.31,
                        longitude: 7.41,
                        elevation: None,
                    },
                ],
                "Ride".to_string(),
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                    start_index, end_index, distance_meters)
                 VALUES ('s0', 'a2', 'same', 1, 5, 400.0)",
                [],
            )
            .unwrap();
        let commits = commit_counter::watch(&engine);

        assert_eq!(engine.backfill_null_lap_times().unwrap(), 4);

        assert_eq!(commit_counter::count(&commits), 1);
        assert_eq!(null_lap_times(&engine), 1);
    }
}
