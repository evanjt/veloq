//! Fitness data: activity metrics, aggregate queries, performances, athlete profile.

use crate::{
    ActivityMetrics, Direction, DirectionStats, RoutePerformance, RoutePerformanceResult,
    SectionLap, SectionPerformanceRecord, SectionPerformanceResult,
};
use chrono::{DateTime, Datelike};
use rusqlite::{Result as SqlResult, params};
use std::collections::HashMap;

use super::PersistentRouteEngine;

impl PersistentRouteEngine {
    // ========================================================================
    // Activity Metrics & Route Performances
    // ========================================================================

    /// Get all activity IDs that have metrics stored (GPS and non-GPS).
    pub fn get_activity_metric_ids(&self) -> Vec<String> {
        self.activity_metrics.keys().cloned().collect()
    }

    /// Set activity metrics for performance calculations.
    /// This persists the metrics to the database and keeps them in memory.
    pub fn set_activity_metrics(&mut self, metrics: Vec<ActivityMetrics>) -> SqlResult<()> {
        // Insert or replace in database (core fields only, no extended metrics)
        {
            let mut stmt = self.db.prepare(
                "INSERT OR REPLACE INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, avg_hr, avg_power, sport_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;

            for m in &metrics {
                stmt.execute(params![
                    &m.activity_id,
                    &m.name,
                    m.date,
                    m.distance,
                    m.moving_time,
                    m.elapsed_time,
                    m.elevation_gain,
                    m.avg_hr.map(|v| v as i32),
                    m.avg_power.map(|v| v as i32),
                    &m.sport_type,
                ])?;
            }
        }

        // Update in-memory cache
        for m in metrics {
            self.activity_metrics.insert(m.activity_id.clone(), m);
        }
        self.invalidate_perf_cache();

        Ok(())
    }

    /// Set activity metrics with extended fields (training load, FTP, zone times).
    /// Persists all fields to the database. Extended fields are only used for SQL aggregate queries.
    /// Also maintains performance caches (zone sums, FTP history, heatmap intensity).
    pub fn set_activity_metrics_extended(
        &mut self,
        metrics: Vec<crate::FfiActivityMetrics>,
    ) -> SqlResult<()> {
        {
            let mut stmt = self.db.prepare(
                "INSERT OR REPLACE INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, avg_hr, avg_power, sport_type,
                  training_load, ftp, power_zone_times, hr_zone_times,
                  power_z1, power_z2, power_z3, power_z4, power_z5, power_z6, power_z7,
                  hr_z1, hr_z2, hr_z3, hr_z4, hr_z5)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;

            for m in &metrics {
                // Use zone times directly for cache columns
                let power_zones: Vec<f64> = m
                    .power_zone_times
                    .as_ref()
                    .map(|v| v.iter().map(|&s| s as f64).collect())
                    .unwrap_or_else(|| vec![0.0; 7]);
                let hr_zones: Vec<f64> = m
                    .hr_zone_times
                    .as_ref()
                    .map(|v| v.iter().map(|&s| s as f64).collect())
                    .unwrap_or_else(|| vec![0.0; 5]);

                // Serialize to JSON for SQLite TEXT column (backwards compatible)
                let power_json: Option<String> = m
                    .power_zone_times
                    .as_ref()
                    .map(|v| {
                        serde_json::to_string(v)
                            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
                    })
                    .transpose()?;
                let hr_json: Option<String> = m
                    .hr_zone_times
                    .as_ref()
                    .map(|v| {
                        serde_json::to_string(v)
                            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
                    })
                    .transpose()?;

                stmt.execute(params![
                    &m.activity_id,
                    &m.name,
                    m.date,
                    m.distance,
                    m.moving_time,
                    m.elapsed_time,
                    m.elevation_gain,
                    m.avg_hr.map(|v| v as i32),
                    m.avg_power.map(|v| v as i32),
                    &m.sport_type,
                    m.training_load,
                    m.ftp.map(|v| v as i32),
                    power_json.as_deref(),
                    hr_json.as_deref(),
                    // Zone cache columns
                    power_zones.get(0).unwrap_or(&0.0),
                    power_zones.get(1).unwrap_or(&0.0),
                    power_zones.get(2).unwrap_or(&0.0),
                    power_zones.get(3).unwrap_or(&0.0),
                    power_zones.get(4).unwrap_or(&0.0),
                    power_zones.get(5).unwrap_or(&0.0),
                    power_zones.get(6).unwrap_or(&0.0),
                    hr_zones.get(0).unwrap_or(&0.0),
                    hr_zones.get(1).unwrap_or(&0.0),
                    hr_zones.get(2).unwrap_or(&0.0),
                    hr_zones.get(3).unwrap_or(&0.0),
                    hr_zones.get(4).unwrap_or(&0.0),
                ])?;

                // Update FTP history cache if FTP is present
                if let Some(ftp) = m.ftp {
                    self.db.execute(
                        "INSERT OR REPLACE INTO ftp_history (date, ftp, activity_id, sport_type)
                         VALUES (?, ?, ?, ?)",
                        params![m.date, ftp as i32, &m.activity_id, &m.sport_type],
                    )?;
                }

                // Update heatmap intensity cache
                let date_str = chrono::DateTime::from_timestamp(m.date, 0)
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();
                let intensity = match m.moving_time {
                    t if t > 7200 => 4,
                    t if t > 5400 => 3,
                    t if t > 3600 => 2,
                    t if t > 0 => 1,
                    _ => 0,
                };

                // Use UPSERT to update max intensity for the date
                self.db.execute(
                    "INSERT INTO activity_heatmap (date, intensity, max_duration, activity_count)
                     VALUES (?, ?, ?, 1)
                     ON CONFLICT(date) DO UPDATE SET
                         intensity = MAX(intensity, excluded.intensity),
                         max_duration = MAX(max_duration, excluded.max_duration),
                         activity_count = activity_count + 1",
                    params![date_str, intensity, m.moving_time as i64],
                )?;
            }
        }

        // Update in-memory cache (core fields only)
        for m in metrics {
            let core: ActivityMetrics = m.into();
            self.activity_metrics.insert(core.activity_id.clone(), core);
        }
        self.invalidate_perf_cache();

        Ok(())
    }

    /// Get activity metrics for a specific activity.
    pub fn get_activity_metrics(&self, activity_id: &str) -> Option<&ActivityMetrics> {
        self.activity_metrics.get(activity_id)
    }

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

    // =========================================================================
    // Athlete Profile & Sport Settings Cache
    // =========================================================================

    /// Store athlete profile JSON blob for instant startup rendering.
    pub fn set_athlete_profile(&self, json: &str) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let _ = self.db.execute(
            "INSERT OR REPLACE INTO athlete_profile (id, data, updated_at) VALUES ('current', ?1, ?2)",
            rusqlite::params![json, now],
        );
    }

    /// Get cached athlete profile JSON blob. Returns None if not cached.
    pub fn get_athlete_profile(&self) -> Option<String> {
        self.db
            .query_row(
                "SELECT data FROM athlete_profile WHERE id = 'current'",
                [],
                |row| row.get(0),
            )
            .ok()
    }

    /// Store sport settings JSON blob for instant startup rendering.
    pub fn set_sport_settings(&self, json: &str) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let _ = self.db.execute(
            "INSERT OR REPLACE INTO sport_settings (id, data, updated_at) VALUES ('current', ?1, ?2)",
            rusqlite::params![json, now],
        );
    }

    /// Get cached sport settings JSON blob. Returns None if not cached.
    pub fn get_sport_settings(&self) -> Option<String> {
        self.db
            .query_row(
                "SELECT data FROM sport_settings WHERE id = 'current'",
                [],
                |row| row.get(0),
            )
            .ok()
    }

    /// Set time streams for activities from flat buffer.
    /// Time streams are cumulative seconds at each GPS point, used for section performance calculations.
    /// Persists to SQLite for offline access.
    pub fn set_time_streams_flat(
        &mut self,
        activity_ids: &[String],
        all_times: &[u32],
        offsets: &[u32],
    ) {
        let mut persisted_count = 0;
        for (i, activity_id) in activity_ids.iter().enumerate() {
            let start = offsets[i] as usize;
            let end = offsets
                .get(i + 1)
                .map(|&o| o as usize)
                .unwrap_or(all_times.len());
            let times = all_times[start..end].to_vec();

            // Persist to SQLite for offline access
            if self.store_time_stream(activity_id, &times).is_ok() {
                persisted_count += 1;
            }

            // Also keep in memory for fast access
            self.time_streams.insert(activity_id.clone(), times);
        }
        log::debug!(
            "tracematch: [PersistentEngine] Set time streams for {} activities ({} persisted to SQLite)",
            activity_ids.len(),
            persisted_count
        );
        self.invalidate_perf_cache();
    }

    /// Backfill NULL lap_time/lap_pace in section_activities from available time streams.
    /// Called after sync when new time streams may have been loaded.
    /// This fixes orphaned rows from migration or activities that were synced after section detection.
    pub fn backfill_section_performance_cache(&mut self) {
        let null_portions: Vec<(String, String, u32, u32, f64)> = match self.db.prepare(
            "SELECT section_id, activity_id, start_index, end_index, distance_meters
             FROM section_activities
             WHERE lap_time IS NULL AND excluded = 0",
        ) {
            Ok(mut stmt) => stmt
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                })
                .ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
            Err(_) => return,
        };

        if null_portions.is_empty() {
            return;
        }

        log::info!(
            "tracematch: [Backfill] Found {} section_activities with NULL lap_time, attempting backfill",
            null_portions.len()
        );

        // Load time streams from DB for activities that need backfill
        let activity_ids: std::collections::HashSet<String> = null_portions
            .iter()
            .map(|(_, aid, _, _, _)| aid.clone())
            .collect();

        let mut db_time_streams: HashMap<String, Vec<u32>> = HashMap::new();
        for activity_id in &activity_ids {
            if let Some(ts) = self.time_streams.get(activity_id) {
                db_time_streams.insert(activity_id.clone(), ts.clone());
            } else if let Ok(stream) = self.db.query_row(
                "SELECT times FROM time_streams WHERE activity_id = ?",
                params![activity_id],
                |row| {
                    let bytes: Vec<u8> = row.get(0)?;
                    rmp_serde::from_slice::<Vec<u32>>(&bytes)
                        .map_err(|_| rusqlite::Error::InvalidQuery)
                },
            ) {
                db_time_streams.insert(activity_id.clone(), stream);
            }
        }

        let mut populated = 0u32;
        for (section_id, activity_id, start_idx, end_idx, distance) in &null_portions {
            if let Some(times) = db_time_streams.get(activity_id) {
                let si = *start_idx as usize;
                let ei = *end_idx as usize;
                if si < times.len() && ei < times.len() {
                    let lap_time = (times[ei] as f64 - times[si] as f64).abs();
                    if lap_time > 0.0 {
                        let lap_pace = distance / lap_time;
                        let _ = self.db.execute(
                            "UPDATE section_activities SET lap_time = ?, lap_pace = ?
                             WHERE section_id = ? AND activity_id = ? AND start_index = ?",
                            params![lap_time, lap_pace, section_id, activity_id, start_idx],
                        );
                        populated += 1;
                    }
                }
            }
        }

        if populated > 0 {
            log::info!(
                "tracematch: [Backfill] Populated {}/{} NULL lap_time entries",
                populated,
                null_portions.len()
            );
        }
    }

    /// Get section performances with accurate time calculations.
    /// Uses time streams to calculate actual traversal times.
    /// Auto-loads time streams from SQLite if not in memory.
    pub fn get_section_performances(&mut self, section_id: &str) -> SectionPerformanceResult {
        self.get_section_performances_filtered(section_id, None)
    }

    /// Get section performances filtered by sport type.
    /// When `sport_type_filter` is None, returns all activities.
    /// When set, only returns activities matching that sport type.
    pub fn get_section_performances_filtered(
        &mut self,
        section_id: &str,
        sport_type_filter: Option<&str>,
    ) -> SectionPerformanceResult {
        let start = std::time::Instant::now();

        // Return cached result if same section + filter
        let cache_key = match sport_type_filter {
            Some(st) => format!("{}:{}", section_id, st),
            None => section_id.to_string(),
        };
        if self.perf_cache_section_id.as_deref() == Some(&cache_key) {
            if let Some(ref cached) = self.perf_cache_result {
                log::info!(
                    "[PERF] get_section_performances({}) -> cached in {:?}",
                    cache_key,
                    start.elapsed()
                );
                return cached.clone();
            }
        }

        // Find the section (in-memory for auto, fallback to DB for custom)
        let section = match self.sections.iter().find(|s| s.id == section_id) {
            Some(s) => s.clone(),
            None => match self.get_section_by_id(section_id) {
                Some(s) => s,
                None => {
                    log::warn!("[DEBUG] Section not found: {}", section_id);
                    return SectionPerformanceResult {
                        records: vec![],
                        best_record: None,
                        best_forward_record: None,
                        best_reverse_record: None,
                        forward_stats: None,
                        reverse_stats: None,
                    };
                }
            },
        };

        log::info!(
            "[DEBUG] Section found. activity_portions count: {}",
            section.activity_portions.len()
        );

        // Load portions WITH cached performance metrics from database
        // Optional sport type filter for cross-sport merged sections
        let (query, query_params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
            match sport_type_filter {
                Some(st) => (
                    "SELECT sa.activity_id, sa.direction, sa.start_index, sa.end_index,
                        sa.distance_meters, sa.lap_time, sa.lap_pace
                 FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.section_id = ? AND am.sport_type = ? AND sa.excluded = 0
                 ORDER BY sa.activity_id, sa.start_index"
                        .to_string(),
                    vec![
                        Box::new(section_id.to_string()) as Box<dyn rusqlite::types::ToSql>,
                        Box::new(st.to_string()),
                    ],
                ),
                None => (
                    "SELECT sa.activity_id, sa.direction, sa.start_index, sa.end_index,
                        sa.distance_meters, sa.lap_time, sa.lap_pace
                 FROM section_activities sa
                 WHERE sa.section_id = ? AND sa.excluded = 0
                 ORDER BY sa.activity_id, sa.start_index"
                        .to_string(),
                    vec![Box::new(section_id.to_string()) as Box<dyn rusqlite::types::ToSql>],
                ),
            };
        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[DEBUG] Failed to prepare portion query: {}", e);
                return SectionPerformanceResult {
                    records: vec![],
                    best_record: None,
                    best_forward_record: None,
                    best_reverse_record: None,
                    forward_stats: None,
                    reverse_stats: None,
                };
            }
        };

        struct CachedPortion {
            activity_id: String,
            direction: String,
            start_index: u32,
            end_index: u32,
            distance_meters: f64,
            lap_time: Option<f64>,
            lap_pace: Option<f64>,
        }

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            query_params.iter().map(|p| p.as_ref()).collect();
        let portions: Vec<CachedPortion> = match stmt.query_map(params_refs.as_slice(), |row| {
            Ok(CachedPortion {
                activity_id: row.get(0)?,
                direction: row.get(1)?,
                start_index: row.get(2)?,
                end_index: row.get(3)?,
                distance_meters: row.get(4)?,
                lap_time: row.get(5)?,
                lap_pace: row.get(6)?,
            })
        }) {
            Ok(iter) => match iter.collect::<Result<Vec<_>, _>>() {
                Ok(v) => v,
                Err(e) => {
                    log::error!("[DEBUG] Failed to deserialize portion row: {}", e);
                    return SectionPerformanceResult {
                        records: vec![],
                        best_record: None,
                        best_forward_record: None,
                        best_reverse_record: None,
                        forward_stats: None,
                        reverse_stats: None,
                    };
                }
            },
            Err(e) => {
                log::error!("[DEBUG] Failed to query portions: {}", e);
                return SectionPerformanceResult {
                    records: vec![],
                    best_record: None,
                    best_forward_record: None,
                    best_reverse_record: None,
                    forward_stats: None,
                    reverse_stats: None,
                };
            }
        };

        // Drop the statement to release the borrow on self.db
        drop(stmt);

        // Group portions by activity
        let mut portions_by_activity: HashMap<String, Vec<CachedPortion>> = HashMap::new();
        for portion in portions {
            portions_by_activity
                .entry(portion.activity_id.clone())
                .or_default()
                .push(portion);
        }

        // Pre-load time streams for any activities with cache misses
        // This avoids borrow checker issues when processing records
        let activity_ids_needing_streams: Vec<String> = portions_by_activity
            .iter()
            .filter(|(_, portions)| {
                portions
                    .iter()
                    .any(|p| p.lap_time.is_none() || p.lap_pace.is_none())
            })
            .map(|(id, _)| id.clone())
            .collect();

        for activity_id in activity_ids_needing_streams {
            if !self.time_streams.contains_key(&activity_id) {
                self.ensure_time_stream_loaded(&activity_id);
            }
        }

        // Pre-load activity metadata from DB for activities not in memory
        // This handles activities outside the current sync range that still have section_activities rows
        let mut db_metrics: HashMap<String, (String, i64)> = HashMap::new();
        for activity_id in portions_by_activity.keys() {
            if !self.activity_metrics.contains_key(activity_id) {
                if let Ok((name, date)) = self.db.query_row(
                    "SELECT name, date FROM activity_metrics WHERE activity_id = ?",
                    params![activity_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                ) {
                    db_metrics.insert(activity_id.clone(), (name, date));
                }
            }
        }

        // Build performance records
        let mut records: Vec<SectionPerformanceRecord> = portions_by_activity
            .iter()
            .filter_map(|(activity_id, portions)| {
                // Get activity name and date from in-memory cache or DB fallback
                let (activity_name, activity_date) = if let Some(m) = self.activity_metrics.get(activity_id) {
                    (m.name.clone(), m.date)
                } else if let Some((name, date)) = db_metrics.get(activity_id) {
                    (name.clone(), *date)
                } else {
                    return None;
                };

                let laps: Vec<SectionLap> = portions
                    .iter()
                    .enumerate()
                    .filter_map(|(i, portion)| {
                        // Use cached values if available, otherwise fall back to calculation
                        let (lap_time, lap_pace) = match (portion.lap_time, portion.lap_pace) {
                            (Some(t), Some(p)) => (t, p),
                            _ => {
                                // Fall back to calculation if cache miss
                                // This handles migration edge case or corrupt data
                                // Time stream should already be loaded by pre-loading step above
                                if let Some(times) = self.time_streams.get(activity_id) {
                                    let start_idx = portion.start_index as usize;
                                    let end_idx = portion.end_index as usize;

                                    if start_idx < times.len() && end_idx < times.len() {
                                        let lap_time = (times[end_idx] as f64 - times[start_idx] as f64).abs();
                                        if lap_time > 0.0 {
                                            let lap_pace = portion.distance_meters / lap_time;
                                            (lap_time, lap_pace)
                                        } else {
                                            return None;
                                        }
                                    } else {
                                        return None;
                                    }
                                } else {
                                    log::warn!(
                                        "[DEBUG] No time stream available for {}, lap {} - skipping",
                                        activity_id, i
                                    );
                                    return None;
                                }
                            }
                        };

                        if lap_time <= 0.0 {
                            return None;
                        }

                        Some(SectionLap {
                            id: format!("{}_lap{}", activity_id, i),
                            activity_id: activity_id.to_string(),
                            time: lap_time,
                            pace: lap_pace,
                            distance: portion.distance_meters,
                            direction: portion.direction.clone(),
                            start_index: portion.start_index,
                            end_index: portion.end_index,
                        })
                    })
                    .collect();

                if laps.is_empty() {
                    return None;
                }

                let lap_count = laps.len() as u32;
                // Find the lap with minimum time (best performance)
                // Use both time and pace from the SAME lap for consistency
                let best_lap = laps
                    .iter()
                    .min_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
                let (best_time, best_pace) = best_lap
                    .map(|lap| (lap.time, lap.pace))
                    .unwrap_or((0.0, 0.0));
                let avg_time = laps.iter().map(|l| l.time).sum::<f64>() / lap_count as f64;
                let avg_pace = laps.iter().map(|l| l.pace).sum::<f64>() / lap_count as f64;
                let direction = laps
                    .first()
                    .map(|l| l.direction.clone())
                    .unwrap_or_else(|| "same".to_string());
                let section_distance = section.distance_meters;

                Some(SectionPerformanceRecord {
                    activity_id: activity_id.to_string(),
                    activity_name: activity_name.clone(),
                    activity_date,
                    laps,
                    lap_count,
                    best_time,
                    best_pace,
                    avg_time,
                    avg_pace,
                    direction,
                    section_distance,
                })
            })
            .collect();

        log::info!("[DEBUG] Built {} performance records", records.len());

        // Sort by date
        records.sort_by_key(|r| r.activity_date);

        // Find best record (fastest time) - overall
        let best_record = records
            .iter()
            .min_by(|a, b| {
                a.best_time
                    .partial_cmp(&b.best_time)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Scan all laps across all records to find per-direction bests.
        // This fixes the bug where record-level direction (first lap) and
        // cross-direction best_time gave wrong per-direction PRs.
        let mut best_fwd_time = f64::MAX;
        let mut best_fwd_record_idx: Option<usize> = None;
        let mut best_fwd_pace = 0.0f64;
        let mut best_rev_time = f64::MAX;
        let mut best_rev_record_idx: Option<usize> = None;
        let mut best_rev_pace = 0.0f64;

        let mut fwd_times: Vec<f64> = Vec::new();
        let mut fwd_last_date: Option<i64> = None;
        let mut rev_times: Vec<f64> = Vec::new();
        let mut rev_last_date: Option<i64> = None;

        for (i, record) in records.iter().enumerate() {
            for lap in &record.laps {
                let is_rev = lap.direction == "reverse" || lap.direction == "backward";
                if is_rev {
                    rev_times.push(lap.time);
                    rev_last_date = Some(
                        rev_last_date
                            .map_or(record.activity_date, |d: i64| d.max(record.activity_date)),
                    );
                    if lap.time < best_rev_time {
                        best_rev_time = lap.time;
                        best_rev_pace = lap.pace;
                        best_rev_record_idx = Some(i);
                    }
                } else {
                    fwd_times.push(lap.time);
                    fwd_last_date = Some(
                        fwd_last_date
                            .map_or(record.activity_date, |d: i64| d.max(record.activity_date)),
                    );
                    if lap.time < best_fwd_time {
                        best_fwd_time = lap.time;
                        best_fwd_pace = lap.pace;
                        best_fwd_record_idx = Some(i);
                    }
                }
            }
        }

        // Construct per-direction best records with direction-correct times
        let best_forward_record = best_fwd_record_idx.map(|idx| {
            let mut r = records[idx].clone();
            r.best_time = best_fwd_time;
            r.best_pace = best_fwd_pace;
            r.direction = "same".to_string();
            r
        });

        let best_reverse_record = best_rev_record_idx.map(|idx| {
            let mut r = records[idx].clone();
            r.best_time = best_rev_time;
            r.best_pace = best_rev_pace;
            r.direction = "reverse".to_string();
            r
        });

        // Compute forward direction stats from lap-level data
        let forward_stats = if fwd_times.is_empty() {
            None
        } else {
            let count = fwd_times.len() as u32;
            let avg_time = fwd_times.iter().sum::<f64>() / count as f64;
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity: fwd_last_date,
                count,
            })
        };

        // Compute reverse direction stats from lap-level data
        let reverse_stats = if rev_times.is_empty() {
            None
        } else {
            let count = rev_times.len() as u32;
            let avg_time = rev_times.iter().sum::<f64>() / count as f64;
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity: rev_last_date,
                count,
            })
        };

        let result = SectionPerformanceResult {
            records,
            best_record,
            best_forward_record,
            best_reverse_record,
            forward_stats,
            reverse_stats,
        };

        log::info!(
            "[PERF] get_section_performances({}) -> {} records in {:?}",
            section_id,
            result.records.len(),
            start.elapsed()
        );

        // Cache for reuse by buckets/calendar (includes sport type filter in key)
        self.perf_cache_section_id = Some(cache_key);
        self.perf_cache_result = Some(result.clone());

        result
    }

    /// Get performance records for excluded activities in a section.
    /// Only uses cached lap_time/lap_pace (no time stream fallback).
    /// Returns just the records — no best/stats computation.
    pub fn get_excluded_section_performances(
        &mut self,
        section_id: &str,
    ) -> Vec<SectionPerformanceRecord> {
        // Find section sport type
        let sport_type: String = match self.sections.iter().find(|s| s.id == section_id) {
            Some(s) => s.sport_type.clone(),
            None => match self.db.query_row(
                "SELECT sport_type FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            ) {
                Ok(st) => st,
                Err(_) => return Vec::new(),
            },
        };

        let section_distance: f64 = self
            .sections
            .iter()
            .find(|s| s.id == section_id)
            .map(|s| s.distance_meters)
            .unwrap_or_else(|| {
                self.db
                    .query_row(
                        "SELECT distance_meters FROM sections WHERE id = ?",
                        params![section_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(0.0)
            });

        let mut stmt = match self.db.prepare(
            "SELECT sa.activity_id, sa.direction, sa.start_index, sa.end_index,
                    sa.distance_meters, sa.lap_time, sa.lap_pace
             FROM section_activities sa
             JOIN activity_metrics am ON sa.activity_id = am.activity_id
             WHERE sa.section_id = ? AND am.sport_type = ? AND sa.excluded = 1
             ORDER BY sa.activity_id, sa.start_index",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        struct Portion {
            activity_id: String,
            direction: String,
            start_index: u32,
            end_index: u32,
            distance_meters: f64,
            lap_time: Option<f64>,
            lap_pace: Option<f64>,
        }

        let portions: Vec<Portion> = match stmt.query_map(params![section_id, &sport_type], |row| {
            Ok(Portion {
                activity_id: row.get(0)?,
                direction: row.get(1)?,
                start_index: row.get(2)?,
                end_index: row.get(3)?,
                distance_meters: row.get(4)?,
                lap_time: row.get(5)?,
                lap_pace: row.get(6)?,
            })
        }) {
            Ok(iter) => match iter.collect::<Result<Vec<_>, _>>() {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "[fitness] Failed to deserialize excluded portion row: {}",
                        e
                    );
                    return Vec::new();
                }
            },
            Err(_) => return Vec::new(),
        };
        drop(stmt);

        // Group by activity
        let mut by_activity: HashMap<String, Vec<Portion>> = HashMap::new();
        for p in portions {
            by_activity
                .entry(p.activity_id.clone())
                .or_default()
                .push(p);
        }

        // Pre-load time streams for activities with cache misses
        let activity_ids_needing_streams: Vec<String> = by_activity
            .iter()
            .filter(|(_, portions)| {
                portions
                    .iter()
                    .any(|p| p.lap_time.is_none() || p.lap_pace.is_none())
            })
            .map(|(id, _)| id.clone())
            .collect();

        for activity_id in activity_ids_needing_streams {
            if !self.time_streams.contains_key(&activity_id) {
                self.ensure_time_stream_loaded(&activity_id);
            }
        }

        let mut records: Vec<SectionPerformanceRecord> = by_activity
            .iter()
            .filter_map(|(activity_id, portions)| {
                let metrics = self.activity_metrics.get(activity_id)?;
                let laps: Vec<SectionLap> = portions
                    .iter()
                    .enumerate()
                    .filter_map(|(i, p)| {
                        let (time, pace) = match (p.lap_time, p.lap_pace) {
                            (Some(t), Some(p)) if t > 0.0 => (t, p),
                            _ => {
                                // Fall back to time-stream calculation if cache miss
                                if let Some(times) = self.time_streams.get(activity_id) {
                                    let start_idx = p.start_index as usize;
                                    let end_idx = p.end_index as usize;
                                    if start_idx < times.len() && end_idx < times.len() {
                                        let lap_time =
                                            (times[end_idx] as f64 - times[start_idx] as f64).abs();
                                        if lap_time > 0.0 {
                                            (lap_time, p.distance_meters / lap_time)
                                        } else {
                                            return None;
                                        }
                                    } else {
                                        return None;
                                    }
                                } else {
                                    return None;
                                }
                            }
                        };
                        Some(SectionLap {
                            id: format!("{}_lap{}", activity_id, i),
                            activity_id: activity_id.to_string(),
                            time,
                            pace,
                            distance: p.distance_meters,
                            direction: p.direction.clone(),
                            start_index: p.start_index,
                            end_index: p.end_index,
                        })
                    })
                    .collect();

                if laps.is_empty() {
                    return None;
                }

                let lap_count = laps.len() as u32;
                let best_lap = laps.iter().min_by(|a, b| {
                    a.time
                        .partial_cmp(&b.time)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                let (best_time, best_pace) =
                    best_lap.map(|l| (l.time, l.pace)).unwrap_or((0.0, 0.0));
                let avg_time = laps.iter().map(|l| l.time).sum::<f64>() / lap_count as f64;
                let avg_pace = laps.iter().map(|l| l.pace).sum::<f64>() / lap_count as f64;
                let direction = laps
                    .first()
                    .map(|l| l.direction.clone())
                    .unwrap_or_else(|| "same".to_string());

                Some(SectionPerformanceRecord {
                    activity_id: activity_id.to_string(),
                    activity_name: metrics.name.clone(),
                    activity_date: metrics.date,
                    laps,
                    lap_count,
                    best_time,
                    best_pace,
                    avg_time,
                    avg_pace,
                    direction,
                    section_distance,
                })
            })
            .collect();

        records.sort_by_key(|r| r.activity_date);
        records
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

    /// Get route performances for all activities in a group.
    /// Uses stored activity_matches for match percentages instead of hardcoding 100%.
    pub fn get_route_performances(
        &self,
        route_group_id: &str,
        current_activity_id: Option<&str>,
        sport_type_filter: Option<&str>,
    ) -> RoutePerformanceResult {
        // Find the group
        let group = match self.groups.iter().find(|g| g.group_id == route_group_id) {
            Some(g) => g,
            None => {
                log::debug!(
                    "tracematch: get_route_performances: group {} not found",
                    route_group_id
                );
                return RoutePerformanceResult {
                    performances: vec![],
                    activity_metrics: vec![],
                    best: None,
                    best_forward: None,
                    best_reverse: None,
                    forward_stats: None,
                    reverse_stats: None,
                    current_rank: None,
                };
            }
        };

        // Get match info for this route
        let match_info = self.activity_matches.get(route_group_id);
        log::debug!(
            "tracematch: get_route_performances: group {} has {} activities, match_info: {}",
            route_group_id,
            group.activity_ids.len(),
            match_info.map(|m| m.len()).unwrap_or(0)
        );

        // Get excluded activity IDs for this route
        let excluded_ids = self.get_excluded_route_activity_ids(route_group_id);

        // Build performances from metrics + collect metrics for inline return
        let mut performances: Vec<RoutePerformance> = Vec::new();
        let mut metrics_list: Vec<ActivityMetrics> = Vec::new();

        for id in &group.activity_ids {
            // Skip excluded activities
            if excluded_ids.contains(id) {
                continue;
            }
            if let Some(metrics) = self.activity_metrics.get(id) {
                // Filter by sport type if specified
                if let Some(filter) = sport_type_filter {
                    if metrics.sport_type != filter {
                        continue;
                    }
                }

                let speed = if metrics.moving_time > 0 {
                    metrics.distance / metrics.moving_time as f64
                } else {
                    0.0
                };

                // Look up match info for this activity (optional - may not exist for old data)
                let match_data =
                    match_info.and_then(|matches| matches.iter().find(|m| m.activity_id == *id));
                let match_percentage = match_data.map(|m| m.match_percentage);
                let direction = match_data
                    .map(|m| m.direction.clone())
                    .unwrap_or(Direction::Same);

                performances.push(RoutePerformance {
                    activity_id: id.clone(),
                    name: metrics.name.clone(),
                    date: metrics.date,
                    speed,
                    duration: metrics.elapsed_time,
                    moving_time: metrics.moving_time,
                    distance: metrics.distance,
                    elevation_gain: metrics.elevation_gain,
                    avg_hr: metrics.avg_hr,
                    avg_power: metrics.avg_power,
                    is_current: current_activity_id == Some(id.as_str()),
                    direction: direction.to_string(),
                    match_percentage,
                });

                // Collect metrics for inline return (Issue C optimization)
                metrics_list.push(metrics.clone());
            }
        }

        // Sort by date (oldest first for charting)
        performances.sort_by_key(|p| p.date);

        // Find best (fastest speed) - overall
        let best = performances
            .iter()
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Find best forward (direction is "same" or "forward")
        let best_forward = performances
            .iter()
            .filter(|p| p.direction == "same" || p.direction == "forward")
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Find best reverse
        let best_reverse = performances
            .iter()
            .filter(|p| p.direction == "reverse" || p.direction == "backward")
            .max_by(|a, b| {
                a.speed
                    .partial_cmp(&b.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned();

        // Calculate current rank (1 = fastest)
        let current_rank = current_activity_id.and_then(|current_id| {
            let mut by_speed = performances.clone();
            by_speed.sort_by(|a, b| {
                b.speed
                    .partial_cmp(&a.speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            by_speed
                .iter()
                .position(|p| p.activity_id == current_id)
                .map(|idx| (idx + 1) as u32)
        });

        // Compute forward direction stats
        let forward_perfs: Vec<_> = performances
            .iter()
            .filter(|p| p.direction == "same" || p.direction == "forward")
            .collect();
        let forward_stats = if forward_perfs.is_empty() {
            None
        } else {
            let count = forward_perfs.len() as u32;
            let avg_time =
                forward_perfs.iter().map(|p| p.duration as f64).sum::<f64>() / count as f64;
            let last_activity = forward_perfs.iter().max_by_key(|p| p.date).map(|p| p.date);
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity,
                count,
            })
        };

        // Compute reverse direction stats
        let reverse_perfs: Vec<_> = performances
            .iter()
            .filter(|p| p.direction == "reverse" || p.direction == "backward")
            .collect();
        let reverse_stats = if reverse_perfs.is_empty() {
            None
        } else {
            let count = reverse_perfs.len() as u32;
            let avg_time =
                reverse_perfs.iter().map(|p| p.duration as f64).sum::<f64>() / count as f64;
            let last_activity = reverse_perfs.iter().max_by_key(|p| p.date).map(|p| p.date);
            Some(DirectionStats {
                avg_time: Some(avg_time),
                last_activity,
                count,
            })
        };

        RoutePerformanceResult {
            performances,
            activity_metrics: metrics_list,
            best,
            best_forward,
            best_reverse,
            forward_stats,
            reverse_stats,
            current_rank,
        }
    }

    /// Get route performances for excluded activities only.
    /// Returns a RoutePerformanceResult with only the excluded activities.
    pub fn get_excluded_route_performances(
        &self,
        route_group_id: &str,
        sport_type_filter: Option<&str>,
    ) -> RoutePerformanceResult {
        let group = match self.groups.iter().find(|g| g.group_id == route_group_id) {
            Some(g) => g,
            None => {
                return RoutePerformanceResult {
                    performances: vec![],
                    activity_metrics: vec![],
                    best: None,
                    best_forward: None,
                    best_reverse: None,
                    forward_stats: None,
                    reverse_stats: None,
                    current_rank: None,
                };
            }
        };

        let excluded_ids = self.get_excluded_route_activity_ids(route_group_id);
        if excluded_ids.is_empty() {
            return RoutePerformanceResult {
                performances: vec![],
                activity_metrics: vec![],
                best: None,
                best_forward: None,
                best_reverse: None,
                forward_stats: None,
                reverse_stats: None,
                current_rank: None,
            };
        }

        let match_info = self.activity_matches.get(route_group_id);
        let mut performances: Vec<RoutePerformance> = Vec::new();
        let mut metrics_list: Vec<ActivityMetrics> = Vec::new();

        for id in &group.activity_ids {
            if !excluded_ids.contains(id) {
                continue;
            }
            if let Some(metrics) = self.activity_metrics.get(id) {
                // Filter by sport type if specified
                if let Some(filter) = sport_type_filter {
                    if metrics.sport_type != filter {
                        continue;
                    }
                }

                let speed = if metrics.moving_time > 0 {
                    metrics.distance / metrics.moving_time as f64
                } else {
                    0.0
                };

                let match_data =
                    match_info.and_then(|matches| matches.iter().find(|m| m.activity_id == *id));
                let match_percentage = match_data.map(|m| m.match_percentage);
                let direction = match_data
                    .map(|m| m.direction.clone())
                    .unwrap_or(Direction::Same);

                performances.push(RoutePerformance {
                    activity_id: id.clone(),
                    name: metrics.name.clone(),
                    date: metrics.date,
                    speed,
                    duration: metrics.elapsed_time,
                    moving_time: metrics.moving_time,
                    distance: metrics.distance,
                    elevation_gain: metrics.elevation_gain,
                    avg_hr: metrics.avg_hr,
                    avg_power: metrics.avg_power,
                    is_current: false,
                    direction: direction.to_string(),
                    match_percentage,
                });
                metrics_list.push(metrics.clone());
            }
        }

        performances.sort_by_key(|p| p.date);

        RoutePerformanceResult {
            performances,
            activity_metrics: metrics_list,
            best: None,
            best_forward: None,
            best_reverse: None,
            forward_stats: None,
            reverse_stats: None,
            current_rank: None,
        }
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
    /// Returns one entry per (activity, section) pair that has a recorded lap_time.
    /// `is_pr` is true only when the lap_time equals the global best for that section.
    pub fn get_activity_section_highlights(
        &self,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivitySectionHighlight> {
        if activity_ids.is_empty() {
            return vec![];
        }

        // Step 1: Query section matches for the requested activities.
        // Track whether lap_time is real or estimated — trends only use real times.
        let placeholders: String = activity_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT sa.activity_id, sa.section_id,
                    COALESCE(sa.lap_time,
                             CASE WHEN a.distance_meters > 0 AND sa.distance_meters > 0
                                  THEN a.duration_secs * (sa.distance_meters / a.distance_meters)
                                  ELSE NULL END) as effective_time,
                    CASE WHEN sa.lap_time IS NOT NULL THEN 1 ELSE 0 END as has_real_time
             FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             JOIN activities a ON sa.activity_id = a.id
             WHERE sa.activity_id IN ({})
               AND sa.excluded = 0
               AND s.disabled = 0
               AND s.superseded_by IS NULL",
            placeholders
        );

        let mut stmt = match self.db.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("tracematch: [highlights] prepare failed: {}", e);
                return vec![];
            }
        };

        let params: Vec<&dyn rusqlite::types::ToSql> = activity_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        // (activity_id, section_id, effective_time, has_real_time)
        let rows: Vec<(String, String, f64, bool)> = match stmt.query_map(params.as_slice(), |row| {
            let time: Option<f64> = row.get(2)?;
            let real: i32 = row.get(3)?;
            Ok((row.get(0)?, row.get(1)?, time.unwrap_or(0.0), real != 0))
        }) {
            Ok(mapped) => mapped
                .filter_map(|r| r.ok())
                .filter(|(_, _, t, _)| *t > 0.0)
                .collect(),
            Err(e) => {
                log::warn!("tracematch: [highlights] query failed: {}", e);
                return vec![];
            }
        };

        if rows.is_empty() {
            return vec![];
        }

        // Track which (activity, section) pairs have real vs estimated times
        let mut has_real_time_map: HashMap<(String, String), bool> = HashMap::new();
        for (aid, sid, _, real) in &rows {
            has_real_time_map.insert((aid.clone(), sid.clone()), *real);
        }

        // Step 2: Collect distinct section IDs from the results
        let section_ids: Vec<String> = {
            let mut set = std::collections::HashSet::new();
            for (_, sid, _, _) in &rows {
                set.insert(sid.clone());
            }
            set.into_iter().collect()
        };

        // Step 3: Batch-query global best times per section (using same COALESCE fallback)
        let sec_placeholders: String =
            section_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let best_sql = format!(
            "SELECT sa.section_id, MIN(
                    COALESCE(sa.lap_time,
                             CASE WHEN a.distance_meters > 0 AND sa.distance_meters > 0
                                  THEN a.duration_secs * (sa.distance_meters / a.distance_meters)
                                  ELSE NULL END)) as best_time
             FROM section_activities sa
             JOIN activities a ON sa.activity_id = a.id
             WHERE sa.section_id IN ({})
               AND sa.excluded = 0
             GROUP BY sa.section_id",
            sec_placeholders
        );

        let mut best_stmt = match self.db.prepare(&best_sql) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("tracematch: [highlights] best times query failed: {}", e);
                return vec![];
            }
        };

        let best_params: Vec<&dyn rusqlite::types::ToSql> = section_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        let mut best_times: HashMap<String, f64> = HashMap::new();
        if let Ok(mapped) = best_stmt.query_map(best_params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        }) {
            for r in mapped.flatten() {
                best_times.insert(r.0, r.1);
            }
        }

        // Step 3b: Batch-query all effective times per section ordered by date for trend computation
        let trend_sql = format!(
            "SELECT sa.section_id, sa.activity_id,
                    COALESCE(sa.lap_time,
                             CASE WHEN a.distance_meters > 0 AND sa.distance_meters > 0
                                  THEN a.duration_secs * (sa.distance_meters / a.distance_meters)
                                  ELSE NULL END) as effective_time
             FROM section_activities sa
             JOIN activities a ON sa.activity_id = a.id
             WHERE sa.section_id IN ({})
               AND sa.excluded = 0
             ORDER BY sa.section_id, a.start_date ASC",
            sec_placeholders
        );

        let mut trend_map: HashMap<(String, String), i8> = HashMap::new();
        if let Ok(mut trend_stmt) = self.db.prepare(&trend_sql) {
            let trend_params: Vec<&dyn rusqlite::types::ToSql> = section_ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();

            if let Ok(mapped) = trend_stmt.query_map(trend_params.as_slice(), |row| {
                let time: Option<f64> = row.get(2)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    time.unwrap_or(0.0),
                ))
            }) {
                let mut current_section = String::new();
                let mut running_sum: f64 = 0.0;
                let mut count: u32 = 0;

                for r in mapped.flatten() {
                    let (sid, aid, lt) = r;
                    if lt <= 0.0 {
                        continue;
                    }
                    // Reset running average when switching sections
                    if sid != current_section {
                        current_section = sid.clone();
                        running_sum = 0.0;
                        count = 0;
                    }

                    let trend = if count == 0 {
                        0i8
                    } else {
                        let avg = running_sum / count as f64;
                        if lt < avg * 0.97 {
                            1 // faster (lower time)
                        } else if lt > avg * 1.03 {
                            -1 // slower (higher time)
                        } else {
                            0
                        }
                    };

                    trend_map.insert((aid, sid), trend);
                    running_sum += lt;
                    count += 1;
                }
            }
        }

        // Step 4: Get section names (from the `name` column on the sections table)
        let name_sql = format!(
            "SELECT id, name FROM sections WHERE id IN ({})",
            sec_placeholders
        );

        let mut name_stmt = match self.db.prepare(&name_sql) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("tracematch: [highlights] section names query failed: {}", e);
                return vec![];
            }
        };

        let name_params: Vec<&dyn rusqlite::types::ToSql> = section_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        let mut section_names: HashMap<String, String> = HashMap::new();
        if let Ok(mapped) = name_stmt.query_map(name_params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        }) {
            for r in mapped.flatten() {
                if let Some(name) = r.1 {
                    section_names.insert(r.0, name);
                }
            }
        }

        // Step 5: Build result, comparing each lap_time against global best.
        // Trends are suppressed (set to 0) when using estimated times — estimates
        // from activity_duration × distance_ratio are too inaccurate for trend signals.
        rows.into_iter()
            .map(|(activity_id, section_id, lap_time, _has_real)| {
                let is_pr = best_times
                    .get(&section_id)
                    .map(|&best| (lap_time - best).abs() < 0.001)
                    .unwrap_or(false);

                let section_name = section_names
                    .get(&section_id)
                    .cloned()
                    .unwrap_or_default();

                // Only show trend when we have real lap_time data
                let has_real = has_real_time_map
                    .get(&(activity_id.clone(), section_id.clone()))
                    .copied()
                    .unwrap_or(false);
                let trend = if has_real {
                    trend_map
                        .get(&(activity_id.clone(), section_id.clone()))
                        .copied()
                        .unwrap_or(0)
                } else {
                    0 // suppress trend for estimated times
                };

                crate::FfiActivitySectionHighlight {
                    activity_id,
                    section_id,
                    section_name,
                    lap_time,
                    is_pr,
                    trend,
                }
            })
            .collect()
    }

    /// Batch-query route highlights for a list of activity IDs.
    /// Returns one entry per (activity, route) pair.
    /// `is_pr` is true when this activity's duration is the best across all route attempts.
    /// `trend` compares this attempt's duration against the running average of preceding attempts.
    pub fn get_activity_route_highlights(
        &self,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivityRouteHighlight> {
        if activity_ids.is_empty() {
            return vec![];
        }

        // Step 1: Find which routes the requested activities belong to
        let placeholders: String = activity_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let match_sql = format!(
            "SELECT am.activity_id, am.route_id
             FROM activity_matches am
             WHERE am.activity_id IN ({})
               AND am.excluded = 0",
            placeholders
        );

        let mut match_stmt = match self.db.prepare(&match_sql) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("tracematch: [route_highlights] prepare failed: {}", e);
                return vec![];
            }
        };

        let params: Vec<&dyn rusqlite::types::ToSql> = activity_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        let activity_routes: Vec<(String, String)> =
            match match_stmt.query_map(params.as_slice(), |row| {
                Ok((row.get(0)?, row.get(1)?))
            }) {
                Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
                Err(e) => {
                    log::warn!("tracematch: [route_highlights] query failed: {}", e);
                    return vec![];
                }
            };

        if activity_routes.is_empty() {
            return vec![];
        }

        // Step 2: Collect distinct route IDs
        let route_ids: Vec<String> = {
            let mut set = std::collections::HashSet::new();
            for (_, rid) in &activity_routes {
                set.insert(rid.clone());
            }
            set.into_iter().collect()
        };

        // Step 3: Get route names (custom name from route_names, falling back to empty)
        let route_placeholders: String =
            route_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let mut route_names: HashMap<String, String> = HashMap::new();

        let name_sql = format!(
            "SELECT route_id, custom_name FROM route_names WHERE route_id IN ({})",
            route_placeholders
        );
        if let Ok(mut name_stmt) = self.db.prepare(&name_sql) {
            let name_params: Vec<&dyn rusqlite::types::ToSql> = route_ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            if let Ok(mapped) = name_stmt.query_map(name_params.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for r in mapped.flatten() {
                    route_names.insert(r.0, r.1);
                }
            }
        }

        // Step 4: For each route, query all activity durations ordered by date
        //         to compute trend and PR
        let duration_sql = format!(
            "SELECT am.route_id, am.activity_id, a.duration_secs
             FROM activity_matches am
             JOIN activities a ON am.activity_id = a.id
             WHERE am.route_id IN ({})
               AND am.excluded = 0
               AND a.duration_secs IS NOT NULL
             ORDER BY am.route_id, a.start_date ASC",
            route_placeholders
        );

        // Maps: (activity_id, route_id) -> (trend, duration), and route_id -> best_duration
        let mut trend_map: HashMap<(String, String), i8> = HashMap::new();
        let mut best_durations: HashMap<String, f64> = HashMap::new();
        let mut activity_durations: HashMap<(String, String), f64> = HashMap::new();

        if let Ok(mut dur_stmt) = self.db.prepare(&duration_sql) {
            let dur_params: Vec<&dyn rusqlite::types::ToSql> = route_ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();

            if let Ok(mapped) = dur_stmt.query_map(dur_params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? as f64,
                ))
            }) {
                let mut current_route = String::new();
                let mut running_sum: f64 = 0.0;
                let mut count: u32 = 0;
                let mut min_duration: f64 = f64::MAX;

                for r in mapped.flatten() {
                    let (rid, aid, duration) = r;
                    // Reset when switching routes
                    if rid != current_route {
                        if !current_route.is_empty() {
                            best_durations.insert(current_route.clone(), min_duration);
                        }
                        current_route = rid.clone();
                        running_sum = 0.0;
                        count = 0;
                        min_duration = f64::MAX;
                    }

                    let trend = if count == 0 {
                        0i8
                    } else {
                        let avg = running_sum / count as f64;
                        if duration < avg * 0.97 {
                            1 // faster
                        } else if duration > avg * 1.03 {
                            -1 // slower
                        } else {
                            0
                        }
                    };

                    trend_map.insert((aid.clone(), rid.clone()), trend);
                    activity_durations.insert((aid, rid), duration);
                    running_sum += duration;
                    count += 1;
                    if duration < min_duration {
                        min_duration = duration;
                    }
                }
                // Don't forget the last route
                if !current_route.is_empty() {
                    best_durations.insert(current_route, min_duration);
                }
            }
        }

        // Step 5: Build results for the requested activities only
        activity_routes
            .into_iter()
            .map(|(activity_id, route_id)| {
                let route_name = route_names
                    .get(&route_id)
                    .cloned()
                    .unwrap_or_default();

                let is_pr = match (
                    activity_durations.get(&(activity_id.clone(), route_id.clone())),
                    best_durations.get(&route_id),
                ) {
                    (Some(&dur), Some(&best)) => (dur - best).abs() < 0.001,
                    _ => false,
                };

                let trend = trend_map
                    .get(&(activity_id.clone(), route_id.clone()))
                    .copied()
                    .unwrap_or(0);

                crate::FfiActivityRouteHighlight {
                    activity_id,
                    route_id,
                    route_name,
                    is_pr,
                    trend,
                }
            })
            .collect()
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
