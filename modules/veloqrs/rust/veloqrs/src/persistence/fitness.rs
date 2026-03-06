//! Fitness data: activity metrics, aggregate queries, performances, athlete profile.

use std::collections::HashMap;
use rusqlite::{Result as SqlResult, params};
use chrono::{Datelike, DateTime};
use crate::{
    ActivityMetrics, Direction, DirectionStats,
    RoutePerformance, RoutePerformanceResult,
    SectionLap, SectionPerformanceRecord, SectionPerformanceResult,
};

use super::PersistentRouteEngine;

impl PersistentRouteEngine {
    // ========================================================================
    // Activity Metrics & Route Performances
    // ========================================================================

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
    pub fn set_activity_metrics_extended(&mut self, metrics: Vec<crate::FfiActivityMetrics>) -> SqlResult<()> {
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
                let power_zones: Vec<f64> = m.power_zone_times
                    .as_ref()
                    .map(|v| v.iter().map(|&s| s as f64).collect())
                    .unwrap_or_else(|| vec![0.0; 7]);
                let hr_zones: Vec<f64> = m.hr_zone_times
                    .as_ref()
                    .map(|v| v.iter().map(|&s| s as f64).collect())
                    .unwrap_or_else(|| vec![0.0; 5]);

                // Serialize to JSON for SQLite TEXT column (backwards compatible)
                let power_json = m.power_zone_times.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default());
                let hr_json = m.hr_zone_times.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default());

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
                        params![m.date, ftp as i32, &m.activity_id, &m.sport_type]
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
                    params![date_str, intensity, m.moving_time as i64]
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

        self.db.query_row(query, params![sport_type], |row| {
            if zone_type == "power" {
                Ok(vec![
                    row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                    row.get(4)?, row.get(5)?, row.get(6)?
                ])
            } else {
                Ok(vec![
                    row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?
                ])
            }
        }).unwrap_or_default()
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
             LIMIT 20"
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
        let mut stmt = match self.db.prepare(
            "SELECT DISTINCT sport_type FROM activity_metrics ORDER BY sport_type",
        ) {
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
    pub fn get_activity_heatmap(&self, start_date: &str, end_date: &str) -> Vec<crate::FfiHeatmapDay> {
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

    /// Get section performances with accurate time calculations.
    /// Uses time streams to calculate actual traversal times.
    /// Auto-loads time streams from SQLite if not in memory.
    pub fn get_section_performances(&mut self, section_id: &str) -> SectionPerformanceResult {
        let start = std::time::Instant::now();

        // Return cached result if same section (buckets + calendar both call this)
        if self.perf_cache_section_id.as_deref() == Some(section_id) {
            if let Some(ref cached) = self.perf_cache_result {
                log::info!("[PERF] get_section_performances({}) -> cached in {:?}", section_id, start.elapsed());
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
        let mut stmt = match self.db.prepare(
            "SELECT activity_id, direction, start_index, end_index,
                    distance_meters, lap_time, lap_pace
             FROM section_activities
             WHERE section_id = ?
             ORDER BY activity_id, start_index"
        ) {
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

        let portions: Vec<CachedPortion> = match stmt
            .query_map([section_id], |row| {
                Ok(CachedPortion {
                    activity_id: row.get(0)?,
                    direction: row.get(1)?,
                    start_index: row.get(2)?,
                    end_index: row.get(3)?,
                    distance_meters: row.get(4)?,
                    lap_time: row.get(5)?,
                    lap_pace: row.get(6)?,
                })
            })
        {
            Ok(iter) => iter.collect::<Result<Vec<_>, _>>().unwrap_or_default(),
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
                portions.iter().any(|p| p.lap_time.is_none() || p.lap_pace.is_none())
            })
            .map(|(id, _)| id.clone())
            .collect();

        for activity_id in activity_ids_needing_streams {
            if !self.time_streams.contains_key(&activity_id) {
                self.ensure_time_stream_loaded(&activity_id);
            }
        }

        // Build performance records
        let mut records: Vec<SectionPerformanceRecord> = portions_by_activity
            .iter()
            .filter_map(|(activity_id, portions)| {
                let metrics = self.activity_metrics.get(activity_id)?;

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
                        rev_last_date.map_or(record.activity_date, |d: i64| {
                            d.max(record.activity_date)
                        }),
                    );
                    if lap.time < best_rev_time {
                        best_rev_time = lap.time;
                        best_rev_pace = lap.pace;
                        best_rev_record_idx = Some(i);
                    }
                } else {
                    fwd_times.push(lap.time);
                    fwd_last_date = Some(
                        fwd_last_date.map_or(record.activity_date, |d: i64| {
                            d.max(record.activity_date)
                        }),
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

        log::info!("[PERF] get_section_performances({}) -> {} records in {:?}", section_id, result.records.len(), start.elapsed());

        // Cache for reuse by buckets/calendar
        self.perf_cache_section_id = Some(section_id.to_string());
        self.perf_cache_result = Some(result.clone());

        result
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
        let section_distance = perf_result.records.first().map(|r| r.section_distance).unwrap_or(0.0);

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

            let md = year_data.months.entry(month).or_insert_with(|| MonthDirData {
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
                    .map(|(month, md)| {
                        crate::CalendarMonthSummary {
                            month,
                            traversal_count: md.total_count,
                            forward: md.fwd_best.map(|idx| to_dir_best(&all_perfs[idx], md.fwd_count)),
                            reverse: md.rev_best.map(|idx| to_dir_best(&all_perfs[idx], md.rev_count)),
                        }
                    })
                    .collect();

                let year_fwd_best = months.iter()
                    .filter_map(|m| m.forward.as_ref())
                    .min_by(|a, b| a.best_time.partial_cmp(&b.best_time).unwrap_or(std::cmp::Ordering::Equal));
                let year_rev_best = months.iter()
                    .filter_map(|m| m.reverse.as_ref())
                    .min_by(|a, b| a.best_time.partial_cmp(&b.best_time).unwrap_or(std::cmp::Ordering::Equal));

                let fwd_count: u32 = months.iter().filter_map(|m| m.forward.as_ref()).map(|f| f.count).sum();
                let rev_count: u32 = months.iter().filter_map(|m| m.reverse.as_ref()).map(|r| r.count).sum();
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

        let forward_pr = all_perfs
            .iter()
            .filter(|p| !p.is_reverse)
            .min_by(|a, b| a.best_time.partial_cmp(&b.best_time).unwrap_or(std::cmp::Ordering::Equal));
        let reverse_pr = all_perfs
            .iter()
            .filter(|p| p.is_reverse)
            .min_by(|a, b| a.best_time.partial_cmp(&b.best_time).unwrap_or(std::cmp::Ordering::Equal));

        let result = crate::CalendarSummary {
            years,
            forward_pr: forward_pr.map(|p| to_dir_best(p, fwd_total)),
            reverse_pr: reverse_pr.map(|p| to_dir_best(p, rev_total)),
            section_distance,
        };
        log::info!("[PERF] get_section_calendar_summary({}) -> {} years in {:?}", section_id, result.years.len(), start.elapsed());
        Some(result)
    }

    /// Get route performances for all activities in a group.
    /// Uses stored activity_matches for match percentages instead of hardcoding 100%.
    pub fn get_route_performances(
        &self,
        route_group_id: &str,
        current_activity_id: Option<&str>,
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

        // Build performances from metrics + collect metrics for inline return
        let mut performances: Vec<RoutePerformance> = Vec::new();
        let mut metrics_list: Vec<ActivityMetrics> = Vec::new();

        for id in &group.activity_ids {
            if let Some(metrics) = self.activity_metrics.get(id) {
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


}
