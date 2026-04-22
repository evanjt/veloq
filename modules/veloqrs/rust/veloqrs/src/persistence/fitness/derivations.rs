//! Fitness derivations: trends, aggregates, calendars, highlights.
//!
//! Built on top of stored activity metrics and section performances — nothing
//! here mutates persisted state, with the exception of `save_pace_snapshot`
//! which records a trend sample.

use chrono::{DateTime, Datelike};
use rusqlite::params;
use std::collections::HashMap;

use super::super::PersistentRouteEngine;

impl PersistentRouteEngine {
    // ========================================================================
    // Aggregate Queries (SQL-based, for dashboard/stats/charts)
    // ========================================================================

    /// Get aggregated stats for a date range: count, total duration, distance, TSS.
    pub fn get_period_stats(&self, start_ts: i64, end_ts: i64) -> crate::FfiPeriodStats {
        self.db
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(moving_time), 0), COALESCE(SUM(distance), 0),
                        COALESCE(SUM(training_load), 0)
                 FROM activity_metrics WHERE date BETWEEN ?1 AND ?2",
                params![start_ts, end_ts],
                |row| {
                    Ok(crate::FfiPeriodStats {
                        count: row.get::<_, i64>(0)? as u32,
                        total_duration: row.get(1)?,
                        total_distance: row.get(2)?,
                        total_tss: row.get(3)?,
                    })
                },
            )
            .unwrap_or(crate::FfiPeriodStats {
                count: 0,
                total_duration: 0,
                total_distance: 0.0,
                total_tss: 0.0,
            })
    }

    /// Get weekly comparison: current week + previous week + FTP trend.
    /// Bundles 3 FFI calls into 1 for 3x reduction in FFI overhead (30ms → 10ms).
    /// Get aggregated zone distribution for a sport type and zone type.
    /// zone_type: "power" | "hr"
    pub fn get_zone_distribution(&self, sport_type: &str, zone_type: &str) -> Vec<f64> {
        // Use cached zone columns for 40-100x speedup (was 50-200ms, now 2-5ms)
        let query = if zone_type == "power" {
            "SELECT
                COALESCE(SUM(power_z1), 0),
                COALESCE(SUM(power_z2), 0),
                COALESCE(SUM(power_z3), 0),
                COALESCE(SUM(power_z4), 0),
                COALESCE(SUM(power_z5), 0),
                COALESCE(SUM(power_z6), 0),
                COALESCE(SUM(power_z7), 0)
             FROM activity_metrics WHERE sport_type = ?"
        } else if zone_type == "hr" {
            "SELECT
                COALESCE(SUM(hr_z1), 0),
                COALESCE(SUM(hr_z2), 0),
                COALESCE(SUM(hr_z3), 0),
                COALESCE(SUM(hr_z4), 0),
                COALESCE(SUM(hr_z5), 0)
             FROM activity_metrics WHERE sport_type = ?"
        } else {
            return Vec::new();
        };

        match self.db.query_row(query, params![sport_type], |row| {
            if zone_type == "power" {
                Ok(vec![
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ])
            } else {
                Ok(vec![
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ])
            }
        }) {
            Ok(result) => result,
            Err(rusqlite::Error::QueryReturnedNoRows) => Vec::new(),
            Err(e) => {
                log::warn!(
                    "[fitness] get_zone_distribution query failed for sport={}, zone={}: {}",
                    sport_type,
                    zone_type,
                    e
                );
                Vec::new()
            }
        }
    }

    /// Get FTP trend: latest and previous FTP values with dates.
    pub fn get_ftp_trend(&self) -> crate::FfiFtpTrend {
        let default = crate::FfiFtpTrend {
            latest_ftp: None,
            latest_date: None,
            previous_ftp: None,
            previous_date: None,
        };

        // Use dedicated FTP history table for 10-30x speedup (was 10-30ms, now <1ms)
        // LIMIT 20 to scan past repeated identical FTP values to find the first different one
        let mut stmt = match self.db.prepare(
            "SELECT ftp, date FROM ftp_history
             ORDER BY date DESC
             LIMIT 20",
        ) {
            Ok(s) => s,
            Err(_) => return default,
        };

        let rows: Vec<(i32, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .ok()
            .map(|iter| iter.flatten().collect())
            .unwrap_or_default();

        if rows.is_empty() {
            return default;
        }

        let latest_ftp = rows[0].0 as u16;
        let latest_date = rows[0].1;

        // Find the first row with a different FTP value
        let previous = rows.iter().find(|(ftp, _)| *ftp as u16 != latest_ftp);

        crate::FfiFtpTrend {
            latest_ftp: Some(latest_ftp),
            latest_date: Some(latest_date),
            previous_ftp: previous.map(|(ftp, _)| *ftp as u16),
            previous_date: previous.map(|(_, date)| *date),
        }
    }

    /// Save a pace (critical speed) snapshot for trend tracking.
    pub fn save_pace_snapshot(
        &self,
        sport_type: &str,
        critical_speed: f64,
        d_prime: Option<f64>,
        r2: Option<f64>,
        date: i64,
    ) {
        let _ = self.db.execute(
            "INSERT OR REPLACE INTO pace_history (date, sport_type, critical_speed, d_prime, r2)
             VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![date, sport_type, critical_speed, d_prime, r2],
        );
    }

    /// Get pace trend: latest and previous distinct critical speed values with dates.
    pub fn get_pace_trend(&self, sport_type: &str) -> crate::FfiPaceTrend {
        let default = crate::FfiPaceTrend {
            latest_pace: None,
            latest_date: None,
            previous_pace: None,
            previous_date: None,
        };

        let mut stmt = match self.db.prepare(
            "SELECT critical_speed, date FROM pace_history
             WHERE sport_type = ?
             ORDER BY date DESC
             LIMIT 20",
        ) {
            Ok(s) => s,
            Err(_) => return default,
        };

        let rows: Vec<(f64, i64)> = stmt
            .query_map(rusqlite::params![sport_type], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .ok()
            .map(|iter| iter.flatten().collect())
            .unwrap_or_default();

        if rows.is_empty() {
            return default;
        }

        let latest_speed = rows[0].0;
        let latest_date = rows[0].1;

        // Find the first row with a meaningfully different critical speed (>0.02 m/s ≈ 1 sec/km)
        let previous = rows
            .iter()
            .find(|(speed, _)| (speed - latest_speed).abs() > 0.02);

        crate::FfiPaceTrend {
            latest_pace: Some(latest_speed),
            latest_date: Some(latest_date),
            previous_pace: previous.map(|(speed, _)| *speed),
            previous_date: previous.map(|(_, date)| *date),
        }
    }

    /// Get distinct sport types from stored activities.
    pub fn get_available_sport_types(&self) -> Vec<String> {
        let mut stmt = match self
            .db
            .prepare("SELECT DISTINCT sport_type FROM activity_metrics ORDER BY sport_type")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        stmt.query_map([], |row| row.get(0))
            .ok()
            .map(|iter| iter.flatten().collect())
            .unwrap_or_default()
    }

    // =========================================================================
    // Heatmap Cache
    // =========================================================================

    /// Get pre-computed daily activity intensity from the heatmap cache.
    /// Returns days within the given date range (YYYY-MM-DD strings).
    pub fn get_activity_heatmap(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Vec<crate::FfiHeatmapDay> {
        let mut stmt = match self.db.prepare(
            "SELECT date, intensity, max_duration, activity_count
             FROM activity_heatmap
             WHERE date BETWEEN ?1 AND ?2
             ORDER BY date",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        stmt.query_map(rusqlite::params![start_date, end_date], |row| {
            Ok(crate::FfiHeatmapDay {
                date: row.get(0)?,
                intensity: row.get::<_, u8>(1)?,
                max_duration: row.get(2)?,
                activity_count: row.get::<_, u32>(3)?,
            })
        })
        .ok()
        .map(|iter| iter.flatten().collect())
        .unwrap_or_default()
    }

    /// Get a calendar-aligned Year > Month performance summary for a section.
    /// Returns full history (no date range filter).
    pub fn get_section_calendar_summary(
        &mut self,
        section_id: &str,
    ) -> Option<crate::CalendarSummary> {
        let start = std::time::Instant::now();
        // Reuse get_section_performances — single source of truth for section times.
        // This ensures calendar values match chart PRs exactly (no proportional estimates
        // for activities without time streams, matching the strict behavior).
        let perf_result = self.get_section_performances(section_id);

        if perf_result.records.is_empty() {
            return None;
        }

        // Get section distance from the first record
        let section_distance = perf_result
            .records
            .first()
            .map(|r| r.section_distance)
            .unwrap_or(0.0);

        fn is_reverse_dir(dir: &str) -> bool {
            matches!(dir, "reverse" | "backward")
        }

        // Each record has laps with per-direction data. Build per-activity, per-direction entries.
        struct DirPerf {
            activity_id: String,
            activity_name: String,
            activity_date: i64,
            best_time: f64,
            best_pace: f64,
            is_reverse: bool,
        }

        let mut all_perfs: Vec<DirPerf> = Vec::new();

        for record in &perf_result.records {
            // Group laps by direction
            let mut fwd_best_time = f64::MAX;
            let mut fwd_best_pace = 0.0f64;
            let mut rev_best_time = f64::MAX;
            let mut rev_best_pace = 0.0f64;
            let mut has_fwd = false;
            let mut has_rev = false;

            for lap in &record.laps {
                if is_reverse_dir(&lap.direction) {
                    has_rev = true;
                    if lap.time < rev_best_time {
                        rev_best_time = lap.time;
                        rev_best_pace = lap.pace;
                    }
                } else {
                    has_fwd = true;
                    if lap.time < fwd_best_time {
                        fwd_best_time = lap.time;
                        fwd_best_pace = lap.pace;
                    }
                }
            }

            if has_fwd {
                all_perfs.push(DirPerf {
                    activity_id: record.activity_id.clone(),
                    activity_name: record.activity_name.clone(),
                    activity_date: record.activity_date,
                    best_time: fwd_best_time,
                    best_pace: fwd_best_pace,
                    is_reverse: false,
                });
            }
            if has_rev {
                all_perfs.push(DirPerf {
                    activity_id: record.activity_id.clone(),
                    activity_name: record.activity_name.clone(),
                    activity_date: record.activity_date,
                    best_time: rev_best_time,
                    best_pace: rev_best_pace,
                    is_reverse: true,
                });
            }
        }

        if all_perfs.is_empty() {
            return None;
        }

        fn to_dir_best(perf: &DirPerf, count: u32) -> crate::CalendarDirectionBest {
            crate::CalendarDirectionBest {
                count,
                best_time: perf.best_time,
                best_pace: perf.best_pace,
                best_activity_id: perf.activity_id.clone(),
                best_activity_name: perf.activity_name.clone(),
                best_activity_date: perf.activity_date,
                is_estimated: false,
            }
        }

        // Group by year, month, and direction
        use std::collections::BTreeMap;
        struct MonthDirData {
            total_count: u32,
            fwd_count: u32,
            fwd_best: Option<usize>,
            rev_count: u32,
            rev_best: Option<usize>,
        }
        struct YearData {
            months: BTreeMap<u32, MonthDirData>,
        }

        let mut years_map: BTreeMap<i32, YearData> = BTreeMap::new();

        for (i, perf) in all_perfs.iter().enumerate() {
            let dt = DateTime::from_timestamp(perf.activity_date, 0)
                .unwrap_or_default()
                .naive_utc();
            let year = dt.year();
            let month = dt.month();

            let year_data = years_map.entry(year).or_insert_with(|| YearData {
                months: BTreeMap::new(),
            });

            let md = year_data
                .months
                .entry(month)
                .or_insert_with(|| MonthDirData {
                    total_count: 0,
                    fwd_count: 0,
                    fwd_best: None,
                    rev_count: 0,
                    rev_best: None,
                });

            md.total_count += 1;
            if perf.is_reverse {
                md.rev_count += 1;
                match md.rev_best {
                    Some(idx) if perf.best_time < all_perfs[idx].best_time => md.rev_best = Some(i),
                    None => md.rev_best = Some(i),
                    _ => {}
                }
            } else {
                md.fwd_count += 1;
                match md.fwd_best {
                    Some(idx) if perf.best_time < all_perfs[idx].best_time => md.fwd_best = Some(i),
                    None => md.fwd_best = Some(i),
                    _ => {}
                }
            }
        }

        // Build result (newest year first)
        let years: Vec<crate::CalendarYearSummary> = years_map
            .into_iter()
            .rev()
            .map(|(year, year_data)| {
                let months: Vec<crate::CalendarMonthSummary> = year_data
                    .months
                    .into_iter()
                    .map(|(month, md)| crate::CalendarMonthSummary {
                        month,
                        traversal_count: md.total_count,
                        forward: md
                            .fwd_best
                            .map(|idx| to_dir_best(&all_perfs[idx], md.fwd_count)),
                        reverse: md
                            .rev_best
                            .map(|idx| to_dir_best(&all_perfs[idx], md.rev_count)),
                    })
                    .collect();

                let year_fwd_best =
                    months
                        .iter()
                        .filter_map(|m| m.forward.as_ref())
                        .min_by(|a, b| {
                            a.best_time
                                .partial_cmp(&b.best_time)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        });
                let year_rev_best =
                    months
                        .iter()
                        .filter_map(|m| m.reverse.as_ref())
                        .min_by(|a, b| {
                            a.best_time
                                .partial_cmp(&b.best_time)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        });

                let fwd_count: u32 = months
                    .iter()
                    .filter_map(|m| m.forward.as_ref())
                    .map(|f| f.count)
                    .sum();
                let rev_count: u32 = months
                    .iter()
                    .filter_map(|m| m.reverse.as_ref())
                    .map(|r| r.count)
                    .sum();
                let traversal_count = months.iter().map(|m| m.traversal_count).sum();

                crate::CalendarYearSummary {
                    year,
                    traversal_count,
                    forward: year_fwd_best.map(|b| crate::CalendarDirectionBest {
                        count: fwd_count,
                        ..b.clone()
                    }),
                    reverse: year_rev_best.map(|b| crate::CalendarDirectionBest {
                        count: rev_count,
                        ..b.clone()
                    }),
                    months,
                }
            })
            .collect();

        // Overall PRs by direction
        let fwd_total: u32 = all_perfs.iter().filter(|p| !p.is_reverse).count() as u32;
        let rev_total: u32 = all_perfs.iter().filter(|p| p.is_reverse).count() as u32;

        let forward_pr = all_perfs.iter().filter(|p| !p.is_reverse).min_by(|a, b| {
            a.best_time
                .partial_cmp(&b.best_time)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let reverse_pr = all_perfs.iter().filter(|p| p.is_reverse).min_by(|a, b| {
            a.best_time
                .partial_cmp(&b.best_time)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let result = crate::CalendarSummary {
            years,
            forward_pr: forward_pr.map(|p| to_dir_best(p, fwd_total)),
            reverse_pr: reverse_pr.map(|p| to_dir_best(p, rev_total)),
            section_distance,
        };
        log::info!(
            "[PERF] get_section_calendar_summary({}) -> {} years in {:?}",
            section_id,
            result.years.len(),
            start.elapsed()
        );
        Some(result)
    }



    /// Get aerobic efficiency trend for a section.
    ///
    /// Queries section_activities for traversals that have both lap_time and avg_hr,
    /// computes HR/pace ratio for each, and performs linear regression to detect
    /// improving aerobic efficiency (declining HR at the same pace).
    ///
    /// Returns None if fewer than 3 data points have both pace and HR data.
    pub fn get_section_efficiency_trend(
        &mut self,
        section_id: &str,
    ) -> Option<crate::FfiEfficiencyTrend> {
        // Get section info for name and distance
        let section = self
            .sections
            .iter()
            .find(|s| s.id == section_id)
            .or_else(|| {
                // Fallback to DB lookup for custom sections
                None
            })?;

        let section_name = section
            .name
            .clone()
            .unwrap_or_else(|| "Section".to_string());
        let section_distance_km = section.distance_meters / 1000.0;

        if section_distance_km <= 0.0 {
            return None;
        }

        // Query section_activities joined with activity_metrics for date,
        // filtering to rows with both lap_time and avg_hr
        let mut stmt = self
            .db
            .prepare(
                "SELECT sa.lap_time, sa.avg_hr, sa.distance_meters, am.date
                 FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.section_id = ?1
                   AND sa.excluded = 0
                   AND sa.lap_time IS NOT NULL
                   AND sa.avg_hr IS NOT NULL
                   AND sa.lap_time > 0
                   AND sa.avg_hr > 0
                 ORDER BY am.date ASC",
            )
            .map_err(|e| {
                log::warn!(
                    "[fitness] get_section_efficiency_trend: prepare failed for section {}: {}",
                    section_id,
                    e
                );
                e
            })
            .ok()?;

        struct EffortRow {
            lap_time: f64,
            avg_hr: f64,
            distance_meters: f64,
            date: i64,
        }

        let rows: Vec<EffortRow> = stmt
            .query_map(rusqlite::params![section_id], |row| {
                Ok(EffortRow {
                    lap_time: row.get(0)?,
                    avg_hr: row.get(1)?,
                    distance_meters: row.get(2)?,
                    date: row.get(3)?,
                })
            })
            .map_err(|e| {
                log::warn!("[fitness] get_section_efficiency_trend: query_map failed for section {}: {}", section_id, e);
                e
            })
            .ok()?
            .filter_map(|r| match r {
                Ok(row) => Some(row),
                Err(e) => {
                    log::warn!("[fitness] get_section_efficiency_trend: skipping corrupt row for section {}: {}", section_id, e);
                    None
                }
            })
            .collect();

        // Need at least 3 data points for a meaningful trend
        if rows.len() < 3 {
            return None;
        }

        // Build efficiency points
        let points: Vec<crate::FfiEfficiencyPoint> = rows
            .iter()
            .filter_map(|row| {
                // Use actual traversal distance for pace calculation
                let distance_km = row.distance_meters / 1000.0;
                if distance_km <= 0.0 {
                    return None;
                }
                let pace_secs_per_km = row.lap_time / distance_km;
                // Sanity check: pace should be reasonable (1 min/km to 30 min/km)
                if pace_secs_per_km < 60.0 || pace_secs_per_km > 1800.0 {
                    return None;
                }
                let hr_pace_ratio = row.avg_hr / pace_secs_per_km;
                Some(crate::FfiEfficiencyPoint {
                    date: row.date,
                    pace_secs_per_km,
                    avg_hr: row.avg_hr,
                    hr_pace_ratio,
                })
            })
            .collect();

        if points.len() < 3 {
            return None;
        }

        // Linear regression on hr_pace_ratio over time
        // x = days since first effort, y = hr_pace_ratio
        let first_date = points[0].date as f64;
        let regression_points: Vec<(f64, f64)> = points
            .iter()
            .map(|p| {
                let days = (p.date as f64 - first_date) / 86400.0;
                (days, p.hr_pace_ratio)
            })
            .collect();

        let (slope, _intercept) = linear_regression(&regression_points);

        // Time range in days
        let time_range_days = regression_points.last().map(|(x, _)| *x).unwrap_or(0.0);

        // Estimate HR change: slope represents change in hr_pace_ratio per day.
        // At the mean pace, HR change ≈ slope * mean_pace * time_range_days
        let mean_pace: f64 =
            points.iter().map(|p| p.pace_secs_per_km).sum::<f64>() / points.len() as f64;
        let hr_change_bpm = slope * mean_pace * time_range_days;

        // Mark as improving if slope is negative enough (threshold: -0.001 per day)
        // This corresponds to roughly -0.03 per month in HR/pace ratio
        let is_improving = slope < -0.001 && points.len() >= 5;

        Some(crate::FfiEfficiencyTrend {
            section_id: section_id.to_string(),
            section_name,
            points,
            trend_slope: slope,
            is_improving,
            hr_change_bpm,
            effort_count: rows.len() as u32,
        })
    }

    // ========================================================================
    // Activity Section Highlights (batch PR detection)
    // ========================================================================

    /// Batch-query section highlights (PRs) for a list of activity IDs.
    /// Now reads from the materialized `activity_indicators` table.
    /// Kept for backwards compatibility — new code should use `get_activity_indicators()`.
    pub fn get_activity_section_highlights(
        &self,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivitySectionHighlight> {
        if activity_ids.is_empty() {
            return vec![];
        }

        // Read from materialized table
        let indicators = self.get_activity_indicators(activity_ids);

        // Also need start_index/end_index from section_activities for map highlighting
        let placeholders: String = activity_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let idx_sql = format!(
            "SELECT activity_id, section_id, start_index, end_index
             FROM section_activities
             WHERE activity_id IN ({}) AND excluded = 0",
            placeholders
        );

        let mut idx_map: HashMap<(String, String), (u32, u32)> = HashMap::new();
        if let Ok(mut stmt) = self.db.prepare(&idx_sql) {
            let params: Vec<&dyn rusqlite::types::ToSql> = activity_ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            if let Ok(rows) = stmt.query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u32>(2)?,
                    row.get::<_, u32>(3)?,
                ))
            }) {
                for r in rows.flatten() {
                    idx_map.insert((r.0, r.1), (r.2, r.3));
                }
            }
        }

        // Convert indicators to the old FfiActivitySectionHighlight format
        // Merge by (activity_id, section_id) — pick PR over trend, best trend wins
        let mut highlight_map: HashMap<(String, String), crate::FfiActivitySectionHighlight> =
            HashMap::new();

        for ind in indicators {
            // Only section indicators
            if ind.indicator_type != "section_pr" && ind.indicator_type != "section_trend" {
                continue;
            }

            let is_pr = ind.indicator_type == "section_pr";
            let (start_index, end_index) = idx_map
                .get(&(ind.activity_id.clone(), ind.target_id.clone()))
                .copied()
                .unwrap_or((0, 0));

            let key = (ind.activity_id.clone(), ind.target_id.clone());
            let entry = highlight_map
                .entry(key)
                .or_insert(crate::FfiActivitySectionHighlight {
                    activity_id: ind.activity_id.clone(),
                    section_id: ind.target_id.clone(),
                    section_name: ind.target_name.clone(),
                    lap_time: ind.lap_time,
                    is_pr,
                    trend: ind.trend,
                    start_index,
                    end_index,
                });

            // PR always wins over trend
            if is_pr && !entry.is_pr {
                entry.is_pr = true;
                entry.trend = 1;
                entry.lap_time = ind.lap_time;
            } else if !entry.is_pr && ind.trend > entry.trend {
                entry.trend = ind.trend;
            }
        }

        highlight_map.into_values().collect()
    }

    /// Batch-query route highlights for a list of activity IDs.
    /// Computes inline from in-memory groups + activity_metrics — no table read.
    pub fn get_activity_route_highlights(
        &self,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivityRouteHighlight> {
        if activity_ids.is_empty() || self.groups.is_empty() {
            return vec![];
        }

        let requested: std::collections::HashSet<&str> = activity_ids.iter().map(|s| s.as_str()).collect();

        // Map activity → group from in-memory groups
        let mut activity_to_group: HashMap<&str, &tracematch::RouteGroup> = HashMap::new();
        for group in &self.groups {
            for aid in &group.activity_ids {
                if requested.contains(aid.as_str()) {
                    activity_to_group.insert(aid.as_str(), group);
                }
            }
        }

        if activity_to_group.is_empty() {
            return vec![];
        }

        // Route names from DB
        let mut route_names: HashMap<String, String> = HashMap::new();
        if let Ok(mut stmt) = self.db.prepare("SELECT route_id, custom_name FROM route_names") {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for r in rows.flatten() {
                    route_names.insert(r.0, r.1);
                }
            }
        }

        // Per-group: compute best time + per-activity trend from activity_metrics.
        // Cache: (best_speed, best_moving_time_secs, per-activity (trend, speed, moving_time_secs))
        let mut group_cache: HashMap<&str, (f64, u32, HashMap<&str, (i8, f64, u32)>)> =
            HashMap::new();
        let mut results = Vec::new();

        for (&aid, group) in &activity_to_group {
            let gid = group.group_id.as_str();

            if !group_cache.contains_key(gid) {
                // Use speed (m/s) = distance / moving_time — matches route detail page ranking
                let mut members: Vec<(&str, f64, u32, i64)> = group
                    .activity_ids
                    .iter()
                    .filter_map(|id| {
                        let m = self.activity_metrics.get(id)?;
                        if m.moving_time > 0 && m.distance > 0.0 {
                            let speed = m.distance / m.moving_time as f64;
                            Some((id.as_str(), speed, m.moving_time, m.date))
                        } else {
                            None
                        }
                    })
                    .collect();
                members.sort_by_key(|m| m.3);

                // Skip singleton routes — need at least 2 attempts for meaningful trends/PRs
                if members.len() < 2 {
                    group_cache.insert(gid, (0.0f64, 0u32, HashMap::new()));
                } else {
                    // Best = highest speed (fastest), track its moving_time for delta math
                    let mut best_speed = 0.0f64;
                    let mut best_moving_time: u32 = 0;
                    let mut trends: HashMap<&str, (i8, f64, u32)> = HashMap::new();
                    let mut sum = 0.0f64;
                    let mut n = 0u32;

                    for (mid, speed, moving_time, _) in &members {
                        // Trend: higher speed = improving (reversed from time)
                        let trend = if n == 0 {
                            0i8
                        } else {
                            let avg = sum / n as f64;
                            if *speed > avg * 1.01 {
                                1
                            }
                            // >1% faster speed
                            else if *speed < avg * 0.99 {
                                -1
                            }
                            // >1% slower speed
                            else {
                                0
                            }
                        };
                        trends.insert(mid, (trend, *speed, *moving_time));
                        sum += speed;
                        n += 1;
                        if *speed > best_speed {
                            best_speed = *speed;
                            best_moving_time = *moving_time;
                        }
                    }

                    group_cache.insert(gid, (best_speed, best_moving_time, trends));
                }
            }

            if let Some((best_speed, best_moving_time, trends)) = group_cache.get(gid) {
                let (trend, speed, moving_time) =
                    trends.get(aid).copied().unwrap_or((0, 0.0, 0));
                // PR = highest speed (within 0.5% tolerance for float comparison)
                let is_pr =
                    speed > 0.0 && *best_speed > 0.0 && (speed - best_speed).abs() / best_speed < 0.005;
                let time_delta_seconds = if moving_time > 0 && *best_moving_time > 0 {
                    Some(moving_time as i32 - *best_moving_time as i32)
                } else {
                    None
                };
                results.push(crate::FfiActivityRouteHighlight {
                    activity_id: aid.to_string(),
                    route_id: gid.to_string(),
                    route_name: route_names.get(gid).cloned().unwrap_or_default(),
                    is_pr,
                    trend,
                    time_delta_seconds,
                });
            }
        }

        results
    }

    /// Get section encounters for an activity: one entry per (section, direction).
    /// Includes this activity's time, PR status, visit count, and sparkline history.
    pub fn get_activity_section_encounters(
        &self,
        activity_id: &str,
    ) -> Vec<crate::ffi_types::FfiSectionEncounter> {
        use crate::ffi_types::FfiSectionEncounter;

        let visible_filter = "s.disabled = 0 AND s.superseded_by IS NULL";

        // Get this activity's traversals with section metadata
        let query = format!(
            "SELECT sa.section_id, COALESCE(s.name, ''), sa.direction,
                    sa.distance_meters, COALESCE(sa.lap_time, 0.0), COALESCE(sa.lap_pace, 0.0)
             FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             WHERE sa.activity_id = ?1 AND sa.excluded = 0 AND {}
             ORDER BY sa.section_id, sa.direction",
            visible_filter
        );

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        struct Traversal {
            section_id: String,
            section_name: String,
            direction: String,
            distance_meters: f64,
            lap_time: f64,
            lap_pace: f64,
        }

        let traversals: Vec<Traversal> = stmt
            .query_map(rusqlite::params![activity_id], |row| {
                Ok(Traversal {
                    section_id: row.get(0)?,
                    section_name: row.get(1)?,
                    direction: row.get(2)?,
                    distance_meters: row.get(3)?,
                    lap_time: row.get(4)?,
                    lap_pace: row.get(5)?,
                })
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        let mut encounters = Vec::new();

        for trav in &traversals {
            // Get history for this (section, direction): all traversals sorted by activity date
            let history_query =
                "SELECT sa.lap_time, sa.activity_id, COALESCE(a.start_date, 0) as act_date
                 FROM section_activities sa
                 LEFT JOIN activities a ON a.id = sa.activity_id
                 WHERE sa.section_id = ?1 AND sa.direction = ?2
                   AND sa.excluded = 0 AND sa.lap_time IS NOT NULL AND sa.lap_time > 0
                 ORDER BY act_date ASC";

            let mut hist_stmt = match self.db.prepare(history_query) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let mut history_times: Vec<f64> = Vec::new();
            let mut history_ids: Vec<String> = Vec::new();
            let mut best_time: f64 = f64::MAX;

            if let Ok(rows) = hist_stmt.query_map(
                rusqlite::params![trav.section_id, trav.direction],
                |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, String>(1)?,
                    ))
                },
            ) {
                for row in rows.flatten() {
                    if row.0 < best_time {
                        best_time = row.0;
                    }
                    history_times.push(row.0);
                    history_ids.push(row.1);
                }
            }
            debug_assert_eq!(history_times.len(), history_ids.len());

            // PR tolerance: 0.5% relative — matches route PR detection behavior
            // and adapts to section length (5s sprint vs 30min climb).
            let is_pr = trav.lap_time > 0.0
                && best_time < f64::MAX
                && ((trav.lap_time - best_time) / best_time).abs() < 0.005;

            encounters.push(FfiSectionEncounter {
                section_id: trav.section_id.clone(),
                section_name: trav.section_name.clone(),
                direction: trav.direction.clone(),
                distance_meters: trav.distance_meters,
                lap_time: trav.lap_time,
                lap_pace: trav.lap_pace,
                is_pr,
                visit_count: history_times.len() as u32,
                history_times,
                history_activity_ids: history_ids,
            });
        }

        encounters
    }
}

/// Simple least-squares linear regression.
/// Returns (slope, intercept) for the best-fit line y = slope*x + intercept.
fn linear_regression(points: &[(f64, f64)]) -> (f64, f64) {
    let n = points.len() as f64;
    if n < 2.0 {
        return (0.0, 0.0);
    }
    let sum_x: f64 = points.iter().map(|(x, _)| x).sum();
    let sum_y: f64 = points.iter().map(|(_, y)| y).sum();
    let sum_xy: f64 = points.iter().map(|(x, y)| x * y).sum();
    let sum_x2: f64 = points.iter().map(|(x, _)| x * x).sum();
    let denom = n * sum_x2 - sum_x * sum_x;
    if denom.abs() < f64::EPSILON {
        return (0.0, sum_y / n);
    }
    let slope = (n * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / n;
    (slope, intercept)
}
