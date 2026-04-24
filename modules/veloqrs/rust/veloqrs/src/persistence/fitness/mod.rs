//! Fitness core: activity-metric storage and cached athlete/sport settings.
//!
//! Derived fitness data (trends, aggregates, calendars, highlights) lives in
//! [`derivations`]. Route and section performance queries live in [`performances`].

mod derivations;
mod performances;

use crate::ActivityMetrics;
use rusqlite::{Result as SqlResult, params};

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

                // Populate activities table with duration/name for route trend computation
                let _ = self.db.execute(
                    "UPDATE activities SET start_date = COALESCE(start_date, ?), name = ?, distance_meters = ?, duration_secs = ? WHERE id = ?",
                    params![m.date, &m.name, m.distance, m.moving_time as i64, &m.activity_id],
                );

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
}

