//! Activity indicators: materialized PR and trend badges.
//!
//! Computed once after sync/detection, stored in `activity_indicators` table.
//! Feed card rendering reads from this table — no on-demand computation needed.

use rusqlite::{params, Result as SqlResult};
use std::collections::HashMap;

use super::PersistentRouteEngine;

impl PersistentRouteEngine {
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

        let tx = self.db.unchecked_transaction()?;
        tx.execute("DELETE FROM activity_indicators", [])?;

        let section_count = self.compute_section_indicators(&tx, now)?;
        let route_count = self.compute_route_indicators(&tx, now)?;

        tx.commit()?;

        log::info!(
            "tracematch: [indicators] Recomputed {} section + {} route indicators",
            section_count,
            route_count
        );

        Ok(())
    }

    /// Compute section PRs and trends, insert into activity_indicators.
    /// Returns total number of indicators inserted.
    fn compute_section_indicators(
        &self,
        tx: &rusqlite::Transaction,
        now: i64,
    ) -> SqlResult<usize> {
        // Effective time: use lap_time if available, otherwise estimate from
        // activity duration proportional to section distance.
        // This handles the common case where lap_time is NULL (not yet populated
        // from time streams) while still producing useful indicators.
        let effective_time_expr =
            "COALESCE(sa.lap_time,
                      CASE WHEN a.distance_meters > 0 AND sa.distance_meters > 0
                           THEN a.duration_secs * (sa.distance_meters / a.distance_meters)
                           ELSE NULL END)";

        // Get all (section_id, direction) pairs with 2+ non-excluded traversals
        let pair_sql = format!(
            "SELECT sa.section_id, sa.direction, COUNT(*) as cnt
             FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             JOIN activities a ON a.id = sa.activity_id
             WHERE sa.excluded = 0
               AND {} IS NOT NULL
               AND s.disabled = 0
               AND s.superseded_by IS NULL
             GROUP BY sa.section_id, sa.direction
             HAVING cnt >= 2",
            effective_time_expr
        );

        let mut pair_stmt = tx.prepare(&pair_sql)?;

        let pairs: Vec<(String, String)> = pair_stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
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

        // For each (section, direction) pair: query traversals ordered by date
        let traversal_sql = format!(
            "SELECT sa.activity_id, {} as effective_time
             FROM section_activities sa
             JOIN activities a ON a.id = sa.activity_id
             WHERE sa.section_id = ?
               AND sa.direction = ?
               AND sa.excluded = 0
             ORDER BY a.start_date ASC",
            effective_time_expr
        );
        let mut traversal_stmt = tx.prepare(&traversal_sql)?;

        for (section_id, direction) in &pairs {
            let traversals: Vec<(String, f64)> = traversal_stmt
                .query_map(params![section_id, direction], |row| {
                    let time: Option<f64> = row.get(1)?;
                    Ok((row.get::<_, String>(0)?, time.unwrap_or(0.0)))
                })?
                .filter_map(|r| r.ok())
                .filter(|(_, t)| *t > 0.0)
                .collect();

            if traversals.len() < 2 {
                continue;
            }

            // Find the global best (minimum lap_time)
            let best_time = traversals
                .iter()
                .map(|(_, t)| *t)
                .fold(f64::MAX, f64::min);

            let section_name = section_names
                .get(section_id)
                .cloned()
                .unwrap_or_default();

            // Compute running-average trend for each traversal
            let mut running_sum = 0.0f64;
            let mut count = 0u32;

            for (activity_id, lap_time) in &traversals {
                let is_pr = (*lap_time - best_time).abs() < 0.001; // float epsilon

                let trend: i8 = if count == 0 {
                    0
                } else {
                    let avg = running_sum / count as f64;
                    if *lap_time < avg * 0.98 {
                        1 // 2%+ faster
                    } else if *lap_time > avg * 1.02 {
                        -1 // 2%+ slower
                    } else {
                        0
                    }
                };

                // PR forces trend to 1 (improving by definition)
                let effective_trend = if is_pr { 1 } else { trend };

                if is_pr {
                    // Insert PR indicator
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

                if trend != 0 {
                    // Insert trend indicator (even for PR activities — they get both)
                    insert_stmt.execute(params![
                        activity_id,
                        "section_trend",
                        section_id,
                        &section_name,
                        direction,
                        lap_time,
                        effective_trend,
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
    fn compute_route_indicators(
        &self,
        tx: &rusqlite::Transaction,
        now: i64,
    ) -> SqlResult<usize> {
        if self.groups.is_empty() {
            return Ok(0);
        }

        // Load route names
        let mut route_names: HashMap<String, String> = HashMap::new();
        if let Ok(mut stmt) = tx.prepare("SELECT route_id, custom_name FROM route_names") {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for r in rows.flatten() {
                    route_names.insert(r.0, r.1);
                }
            }
        }

        let mut insert_stmt = tx.prepare(
            "INSERT OR REPLACE INTO activity_indicators
             (activity_id, indicator_type, target_id, target_name, direction, lap_time, trend, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )?;

        let mut total = 0;

        for group in &self.groups {
            // Collect (activity_id, moving_time, date) sorted by date
            let mut members: Vec<(&str, f64, i64)> = group
                .activity_ids
                .iter()
                .filter_map(|id| {
                    let m = self.activity_metrics.get(id)?;
                    if m.moving_time > 0 {
                        Some((id.as_str(), m.moving_time as f64, m.date))
                    } else {
                        None
                    }
                })
                .collect();
            members.sort_by_key(|m| m.2);

            // Need at least 2 members for meaningful PR/trends
            if members.len() < 2 {
                continue;
            }

            let route_name = route_names
                .get(&group.group_id)
                .cloned()
                .unwrap_or_default();

            let best_time = members
                .iter()
                .map(|(_, dur, _)| *dur)
                .fold(f64::MAX, f64::min);

            let mut running_sum = 0.0f64;
            let mut count = 0u32;

            for (activity_id, dur, _) in &members {
                let is_pr = (*dur - best_time).abs() < 0.5; // routes use moving_time (integer seconds)

                let trend: i8 = if count == 0 {
                    0
                } else {
                    let avg = running_sum / count as f64;
                    if *dur < avg * 0.98 {
                        1
                    } else if *dur > avg * 1.02 {
                        -1
                    } else {
                        0
                    }
                };

                let effective_trend = if is_pr { 1 } else { trend };

                if is_pr {
                    insert_stmt.execute(params![
                        activity_id,
                        "route_pr",
                        &group.group_id,
                        &route_name,
                        "same",
                        dur,
                        effective_trend,
                        now,
                    ])?;
                    total += 1;
                }

                if trend != 0 {
                    insert_stmt.execute(params![
                        activity_id,
                        "route_trend",
                        &group.group_id,
                        &route_name,
                        "same",
                        dur,
                        effective_trend,
                        now,
                    ])?;
                    total += 1;
                }

                running_sum += dur;
                count += 1;
            }
        }

        Ok(total)
    }

    /// Load section names from the sections table.
    fn load_section_names(
        &self,
        conn: &rusqlite::Connection,
    ) -> SqlResult<HashMap<String, String>> {
        let mut stmt = conn.prepare(
            "SELECT id, name FROM sections WHERE name IS NOT NULL AND disabled = 0",
        )?;
        let mut names = HashMap::new();
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for r in rows.flatten() {
            names.insert(r.0, r.1);
        }
        Ok(names)
    }

    /// Read pre-computed indicators for a batch of activity IDs.
    /// This is the fast path — just a table read, no computation.
    pub fn get_activity_indicators(
        &self,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivityIndicator> {
        if activity_ids.is_empty() {
            return vec![];
        }

        let placeholders: String = activity_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT activity_id, indicator_type, target_id, target_name, direction, lap_time, trend
             FROM activity_indicators
             WHERE activity_id IN ({})",
            placeholders
        );

        let mut stmt = match self.db.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("tracematch: [indicators] read failed: {}", e);
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
                log::warn!("tracematch: [indicators] query failed: {}", e);
                vec![]
            }
        }
    }

    /// Read pre-computed indicators for a single activity.
    pub fn get_indicators_for_activity(
        &self,
        activity_id: &str,
    ) -> Vec<crate::FfiActivityIndicator> {
        let mut stmt = match self.db.prepare(
            "SELECT activity_id, indicator_type, target_id, target_name, direction, lap_time, trend
             FROM activity_indicators
             WHERE activity_id = ?",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        match stmt.query_map([activity_id], |row| {
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
            Err(_) => vec![],
        }
    }
}
