//! Fitness core: activity-metric storage and cached athlete/sport settings.
//!
//! Derived fitness data (trends, aggregates, calendars, highlights) lives in
//! [`derivations`]. Route and section performance queries live in [`performances`].

mod derivations;
mod performances;

use crate::ActivityMetrics;
use rusqlite::{Result as SqlResult, params};

use super::PersistentEngine;

/// Zone seconds padded to the column count the row carries. An absent series
/// reads as zero everywhere rather than as a gap the aggregates would skip.
fn zone_seconds(times: Option<&[u32]>, columns: usize) -> Vec<f64> {
    let mut out = vec![0.0; columns];
    if let Some(times) = times {
        for (slot, &secs) in out.iter_mut().zip(times) {
            *slot = secs as f64;
        }
    }
    out
}

/// The zone series as the JSON the row stores, or `None` when there is none.
fn zone_json(times: Option<&[u32]>) -> SqlResult<Option<String>> {
    times
        .map(|v| {
            serde_json::to_string(v)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
        })
        .transpose()
}

impl PersistentEngine {
    // ========================================================================
    // Activity Metrics & Route Performances
    // ========================================================================

    /// Get all activity IDs that have metrics stored (GPS and non-GPS).
    pub fn get_activity_metric_ids(&self) -> Vec<String> {
        self.activity_metrics.keys().cloned().collect()
    }

    /// Set activity metrics for performance calculations.
    /// This persists the metrics to the database and keeps them in memory.
    ///
    /// The row is written whole, stats columns included. A page write that
    /// listed only the core columns replaced the row and emptied the rest, so
    /// a training load stored earlier did not survive the next sync.
    pub fn set_activity_metrics(&mut self, metrics: Vec<ActivityMetrics>) -> SqlResult<()> {
        // One transaction for the page. Row-by-row autocommit paid an fsync
        // per activity under the engine lock, 3 s for a 90-day window on the
        // S22, and every screen read waited it out.
        let tx = self.db.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, avg_hr, avg_power, sport_type,
                  training_load, ftp, power_zone_times, hr_zone_times,
                  power_z1, power_z2, power_z3, power_z4, power_z5, power_z6, power_z7,
                  hr_z1, hr_z2, hr_z3, hr_z4, hr_z5)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;
            let mut ftp_stmt = tx.prepare(
                "INSERT OR REPLACE INTO ftp_history (date, ftp, activity_id, sport_type)
                 VALUES (?, ?, ?, ?)",
            )?;

            for m in &metrics {
                let power_zones = zone_seconds(m.power_zone_times.as_deref(), 7);
                let hr_zones = zone_seconds(m.hr_zone_times.as_deref(), 5);
                let power_json = zone_json(m.power_zone_times.as_deref())?;
                let hr_json = zone_json(m.hr_zone_times.as_deref())?;

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
                    power_zones[0],
                    power_zones[1],
                    power_zones[2],
                    power_zones[3],
                    power_zones[4],
                    power_zones[5],
                    power_zones[6],
                    hr_zones[0],
                    hr_zones[1],
                    hr_zones[2],
                    hr_zones[3],
                    hr_zones[4],
                ])?;

                // The FTP trend reads its own table, so an FTP that arrives
                // with the page has to land there as well as on the row.
                if let Some(ftp) = m.ftp {
                    ftp_stmt.execute(params![m.date, ftp as i32, &m.activity_id, &m.sport_type])?;
                }
            }
        }
        tx.commit()?;

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
    /// Skips activities whose metrics are already cached with matching date and moving_time.
    pub fn set_activity_metrics_extended(
        &mut self,
        metrics: Vec<crate::FfiActivityMetrics>,
    ) -> SqlResult<()> {
        let new_metrics: Vec<&crate::FfiActivityMetrics> = metrics
            .iter()
            .filter(|m| match self.activity_metrics.get(&m.activity_id) {
                Some(existing) => existing.date != m.date || existing.moving_time != m.moving_time,
                None => true,
            })
            .collect();

        if new_metrics.is_empty() {
            return Ok(());
        }

        self.db.execute_batch("BEGIN IMMEDIATE")?;

        let result = (|| -> SqlResult<()> {
            let mut stmt = self.db.prepare(
                "INSERT OR REPLACE INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, avg_hr, avg_power, sport_type,
                  training_load, ftp, power_zone_times, hr_zone_times,
                  power_z1, power_z2, power_z3, power_z4, power_z5, power_z6, power_z7,
                  hr_z1, hr_z2, hr_z3, hr_z4, hr_z5)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;

            for m in &new_metrics {
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

                if let Some(ftp) = m.ftp {
                    self.db.execute(
                        "INSERT OR REPLACE INTO ftp_history (date, ftp, activity_id, sport_type)
                         VALUES (?, ?, ?, ?)",
                        params![m.date, ftp as i32, &m.activity_id, &m.sport_type],
                    )?;
                }

                let _ = self.db.execute(
                    "UPDATE activities SET start_date = COALESCE(start_date, ?), name = ?, distance_meters = ?, duration_secs = ? WHERE id = ?",
                    params![m.date, &m.name, m.distance, m.moving_time as i64, &m.activity_id],
                );

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

            Ok(())
        })();

        match result {
            Ok(()) => self.db.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        }

        for m in metrics {
            let core: ActivityMetrics = m.into();
            self.activity_metrics.insert(core.activity_id.clone(), core);
        }
        self.invalidate_perf_cache();

        Ok(())
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

    /// Clear cached athlete profile and sport settings blobs without touching
    /// activity / GPS / section data. Used by the lightweight "Sign out" path
    /// where we want to drop the previous user's identity but keep their
    /// synced data so a re-login on the same account is instant.
    pub fn clear_user_profile_caches(&self) {
        let _ = self.db.execute_batch(
            "DELETE FROM athlete_profile;
             DELETE FROM sport_settings;",
        );
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    fn metric(i: usize) -> ActivityMetrics {
        ActivityMetrics {
            activity_id: format!("a{i}"),
            name: "Ride".to_string(),
            date: 1_700_000_000 + i as i64,
            distance: 40_000.0,
            moving_time: 3_600,
            elapsed_time: 3_700,
            elevation_gain: 400.0,
            avg_hr: Some(140),
            avg_power: Some(200),
            sport_type: "Ride".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }
    }

    // Row-by-row autocommit paid an fsync per activity under the engine lock,
    // which on the S22 held every screen read for three seconds a page.
    #[test]
    fn a_page_of_metrics_is_one_commit() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let commits = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&commits);
        engine.db.commit_hook(Some(move || {
            seen.fetch_add(1, Ordering::SeqCst);
            false
        }));

        engine
            .set_activity_metrics((0..50).map(metric).collect())
            .unwrap();

        assert_eq!(commits.load(Ordering::SeqCst), 1);
        assert_eq!(engine.get_activity_metric_ids().len(), 50);
    }

    fn extended(i: usize) -> crate::FfiActivityMetrics {
        let mut m = crate::FfiActivityMetrics::from(metric(i));
        m.training_load = Some(88.0);
        m.ftp = Some(250);
        m.power_zone_times = Some(vec![10, 20, 30, 40, 50, 60, 70]);
        m.hr_zone_times = Some(vec![11, 22, 33, 44, 55]);
        m
    }

    fn stored_load(engine: &PersistentEngine, id: &str) -> (Option<f64>, Option<i64>, Option<f64>) {
        engine
            .db
            .query_row(
                "SELECT training_load, ftp, power_z3 FROM activity_metrics WHERE activity_id = ?",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
    }

    // The sync page is the only writer that sees the stats fields, so a page
    // write that drops them leaves the column empty for the life of the row.
    #[test]
    fn a_page_write_stores_the_stats_it_was_given() {
        let mut engine = PersistentEngine::in_memory().unwrap();

        engine
            .set_activity_metrics(vec![ActivityMetrics::from(extended(1))])
            .unwrap();

        assert_eq!(
            stored_load(&engine, "a1"),
            (Some(88.0), Some(250), Some(30.0))
        );
    }

    #[test]
    fn a_page_write_does_not_erase_stats_already_stored() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .set_activity_metrics_extended(vec![extended(2)])
            .unwrap();

        engine
            .set_activity_metrics(vec![ActivityMetrics::from(extended(2))])
            .unwrap();

        assert_eq!(
            stored_load(&engine, "a2"),
            (Some(88.0), Some(250), Some(30.0))
        );
    }

    // The FTP trend reads its own table, so an FTP written with the page has
    // to reach it or the trend stays empty for every activity ever synced.
    #[test]
    fn a_page_write_records_the_ftp_it_carries() {
        let mut engine = PersistentEngine::in_memory().unwrap();

        engine
            .set_activity_metrics(vec![ActivityMetrics::from(extended(3))])
            .unwrap();
        engine
            .set_activity_metrics(vec![ActivityMetrics::from(extended(3))])
            .unwrap();

        let rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM ftp_history WHERE activity_id = 'a3'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn a_page_write_with_no_stats_leaves_the_columns_empty() {
        let mut engine = PersistentEngine::in_memory().unwrap();

        engine.set_activity_metrics(vec![metric(4)]).unwrap();

        assert_eq!(stored_load(&engine, "a4"), (None, None, Some(0.0)));
        let rows: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM ftp_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn the_ffi_round_trip_keeps_the_stats() {
        let back = crate::FfiActivityMetrics::from(ActivityMetrics::from(extended(5)));

        assert_eq!(back.training_load, Some(88.0));
        assert_eq!(back.ftp, Some(250));
        assert_eq!(
            back.power_zone_times,
            Some(vec![10, 20, 30, 40, 50, 60, 70])
        );
        assert_eq!(back.hr_zone_times, Some(vec![11, 22, 33, 44, 55]));
    }
}
