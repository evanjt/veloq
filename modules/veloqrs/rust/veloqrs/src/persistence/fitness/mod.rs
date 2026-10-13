//! Fitness core: activity-metric storage and cached athlete/sport settings.
//!
//! Derived fitness data (trends, aggregates, calendars, highlights) lives in
//! [`derivations`]. Route and section performance queries live in
//! [`performances`], and the stale-PR selection in [`stale_pr`].

pub(crate) mod derivations;
pub(crate) mod performances;
pub(crate) mod stale_pr;

use crate::ActivityMetrics;
use rusqlite::{OptionalExtension, Result as SqlResult, params};
use std::collections::BTreeSet;

use super::PersistentEngine;

/// The zone columns an activity row carries, for heart rate and for power
/// alike. intervals.icu defines seven of each, held in `power_z1..power_z7`
/// and `hr_z1..hr_z7`. Every writer, reader and name list is sized by this, so
/// the names shipped beside the seconds never outnumber them.
pub(crate) const ZONE_COLUMNS: usize = 7;

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

impl PersistentEngine {
    // ========================================================================
    // Activity Metrics & Route Performances
    // ========================================================================

    /// Set activity metrics for performance calculations.
    /// This persists the metrics to the database and keeps them in memory.
    ///
    /// The row is written whole, stats and zone columns included. A page write
    /// that listed only the core columns replaced the row and emptied the
    /// rest, so a training load stored earlier did not survive the next sync.
    /// Also maintains the heatmap from the stored rows.
    pub fn set_activity_metrics(&mut self, metrics: Vec<ActivityMetrics>) -> SqlResult<()> {
        if metrics.is_empty() {
            return Ok(());
        }
        let rows: Vec<&ActivityMetrics> = metrics.iter().collect();

        self.db.execute_batch("BEGIN IMMEDIATE")?;

        let result = self.write_activity_metrics(&rows, false);
        let unplaced = match result {
            Ok(unplaced) => {
                super::commit_write_txn(&self.db)?;
                unplaced
            }
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        };

        if unplaced > 0 {
            log::info!(
                "veloqrs: [fitness] {unplaced} of {} metrics rows had no activity row to write \
                 distance and duration onto; the next open backfills them",
                rows.len()
            );
        }

        for m in metrics {
            self.activity_metrics.insert(m.activity_id.clone(), m);
        }
        self.invalidate_perf_cache();

        Ok(())
    }

    /// The test seed path: writes rows built as the record the screen reads
    /// return. Those carry no zone seconds, so every zone column is replaced
    /// with NULL; nothing in production writes through it.
    pub fn set_activity_metrics_extended(
        &mut self,
        metrics: Vec<crate::FfiActivityMetrics>,
    ) -> SqlResult<()> {
        self.set_activity_metrics(metrics.into_iter().map(ActivityMetrics::from).collect())
    }

    /// Write metrics within the caller-owned transaction.
    pub(super) fn write_activity_metrics(
        &self,
        metrics: &[&ActivityMetrics],
        strict: bool,
    ) -> SqlResult<usize> {
        let mut unplaced = 0usize;
        (|| -> SqlResult<()> {
            let mut touched_days = BTreeSet::new();
            let mut stmt = self.db.prepare(
                "INSERT OR REPLACE INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, avg_hr, avg_power, sport_type,
                  training_load, ftp,
                  power_z1, power_z2, power_z3, power_z4, power_z5, power_z6, power_z7,
                  hr_z1, hr_z2, hr_z3, hr_z4, hr_z5, hr_z6, hr_z7)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;

            for m in metrics {
                let old_date = self
                    .db
                    .query_row(
                        "SELECT date FROM activity_metrics WHERE activity_id = ?",
                        [&m.activity_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?;
                // A retype out of the sport family leaves the old family's
                // stored curves holding this activity's efforts, and the new
                // type's arrival never refetches them. Within a family the
                // arrival already does.
                let old_sport = self
                    .db
                    .query_row(
                        "SELECT sport_type FROM activity_metrics WHERE activity_id = ?",
                        [&m.activity_id],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .optional()?
                    .flatten();
                if let Some(old) = old_sport
                    && old != m.sport_type
                    && !crate::sport::family_of(&old).contains(&m.sport_type.as_str())
                {
                    self.db.execute(
                        "INSERT INTO settings (key, value, updated_at)
                         VALUES (?1 || ?2, strftime('%s', 'now'), strftime('%s', 'now'))
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                                        updated_at = excluded.updated_at",
                        params![
                            crate::persistence::settings_keys::CURVE_REMOVED_AT_PREFIX,
                            old
                        ],
                    )?;
                }
                let power_zones = zone_seconds(m.power_zone_times.as_deref(), ZONE_COLUMNS);
                let hr_zones = zone_seconds(m.hr_zone_times.as_deref(), ZONE_COLUMNS);

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
                    hr_zones[5],
                    hr_zones[6],
                ])?;

                // Counted rather than discarded. A metrics row that updates no
                // activity means the two tables disagree about which ids exist,
                // which is the ordinary case on a first sync, where the fitness
                // endpoint answers before the activity rows land. Each
                // activity row fills itself from its metrics as it is written;
                // what is worth saying is how many.
                match self.db.execute(
                    "UPDATE activities SET start_date = COALESCE(start_date, ?), name = ?, distance_meters = ?, duration_secs = ? WHERE id = ?",
                    params![m.date, &m.name, m.distance, m.moving_time as i64, &m.activity_id],
                ) {
                    Ok(0) => unplaced += 1,
                    Ok(_) => {}
                    Err(e) => {
                        if strict { return Err(e); }
                        log::warn!(
                            "veloqrs: [fitness] metrics for {} could not reach its activity row: {e}",
                            m.activity_id
                        );
                    }
                }

                if let Some(date) = old_date {
                    touched_days.insert(date.div_euclid(86_400));
                }
                touched_days.insert(m.date.div_euclid(86_400));
            }

            for day in touched_days {
                super::schema::recompute_heatmap_day(&self.db, day * 86_400)?;
            }

            Ok(())
        })()?;
        Ok(unplaced)
    }

    // =========================================================================
    // Athlete Profile & Sport Settings Cache
    // =========================================================================

    /// Store athlete profile JSON blob for instant startup rendering.
    ///
    /// The error is the caller's: a dropped write leaves every reader of the
    /// profile, FTP and zones on the previous athlete's values, and the sync
    /// step above this has to fail rather than stamp a success over them.
    ///
    /// The API key the body carries is removed here, the one writer, since the
    /// table is copied into every backup and nothing reads the key.
    pub fn set_athlete_profile(&self, json: &str) -> SqlResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.db.execute(
            "INSERT OR REPLACE INTO athlete_profile (id, data, updated_at)
             VALUES ('current',
                     CASE WHEN json_valid(?1) THEN json_remove(?1, ?3) ELSE ?1 END,
                     ?2)",
            rusqlite::params![json, now, PROFILE_API_KEY_PATH],
        )?;
        Ok(())
    }

    /// Get cached athlete profile JSON blob. Returns None if not cached.
    pub fn get_athlete_profile(&self) -> Option<String> {
        super::settings::athlete_profile_from(&self.db)
    }

    /// Store sport settings JSON blob for instant startup rendering.
    pub fn set_sport_settings(&self, json: &str) -> SqlResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.db.execute(
            "INSERT OR REPLACE INTO sport_settings (id, data, updated_at) VALUES ('current', ?1, ?2)",
            rusqlite::params![json, now],
        )?;
        Ok(())
    }

    /// Get cached sport settings JSON blob. Returns None if not cached.
    pub fn get_sport_settings(&self) -> Option<String> {
        sport_settings_from(&self.db)
    }
}

/// Where the athlete body carries the athlete's API key.
const PROFILE_API_KEY_PATH: &str = "$.icu_api_key";

/// Remove the API key from a profile stored before the writer dropped it.
///
/// Runs at every open and changes nothing once the row is clean, so the
/// stored stamp stays the sync's. Backups taken before this keep the key.
pub(crate) fn scrub_stored_profile_api_key(conn: &rusqlite::Connection) -> SqlResult<usize> {
    conn.execute(
        "UPDATE athlete_profile SET data = json_remove(data, ?1)
         WHERE json_valid(data) AND json_type(data, ?1) IS NOT NULL",
        [PROFILE_API_KEY_PATH],
    )
}

/// When the stored athlete profile was written, in epoch seconds, if it
/// belongs to `athlete_id` and the sport settings are stored beside it. `None`
/// is a profile the sync still owes: none, another athlete's, one whose body
/// will not parse, or one stored without its sport settings.
pub(crate) fn profile_fetched_at(conn: &rusqlite::Connection, athlete_id: &str) -> Option<i64> {
    conn.query_row(
        "SELECT p.updated_at FROM athlete_profile p
         WHERE p.id = 'current'
           AND json_valid(p.data)
           AND json_extract(p.data, '$.id') = ?1
           AND EXISTS (SELECT 1 FROM sport_settings WHERE id = 'current')",
        rusqlite::params![athlete_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| log::warn!("veloqrs: [profile] fetch time read failed: {e}"))
    .ok()
    .flatten()
}

/// The cached sport settings JSON blob on any connection, None if not cached.
pub(crate) fn sport_settings_from(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT data FROM sport_settings WHERE id = 'current'",
        [],
        |row| row.get(0),
    )
    .ok()
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
    // which on the test handset held every screen read for three seconds a page.
    #[test]
    fn a_page_of_metrics_is_one_commit() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let commits = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&commits);
        engine
            .db
            .commit_hook(Some(move || {
                seen.fetch_add(1, Ordering::SeqCst);
                false
            }))
            .unwrap();

        engine
            .set_activity_metrics((0..50).map(metric).collect())
            .unwrap();

        assert_eq!(commits.load(Ordering::SeqCst), 1);
        assert_eq!(engine.activity_metrics.len(), 50);
    }

    fn extended(i: usize) -> ActivityMetrics {
        let mut m = metric(i);
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

        engine.set_activity_metrics(vec![extended(1)]).unwrap();

        assert_eq!(
            stored_load(&engine, "a1"),
            (Some(88.0), Some(250), Some(30.0))
        );
    }

    #[test]
    fn a_page_write_does_not_erase_stats_already_stored() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine.set_activity_metrics(vec![extended(2)]).unwrap();

        engine.set_activity_metrics(vec![extended(2)]).unwrap();

        assert_eq!(
            stored_load(&engine, "a2"),
            (Some(88.0), Some(250), Some(30.0))
        );
    }

    #[test]
    fn zones_past_the_stored_columns_are_dropped_at_the_write() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let mut m = extended(5);
        m.hr_zone_times = Some(vec![1, 2, 3, 4, 5, 6, 7, 900]);
        engine.set_activity_metrics(vec![m]).unwrap();

        let seconds = derivations::pooled::zone_distribution(&engine.db, "Ride", "hr", 0, i64::MAX);

        assert_eq!(seconds, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]);
        assert_eq!(seconds.len(), ZONE_COLUMNS);
    }

    #[test]
    fn a_page_write_with_no_stats_leaves_the_columns_empty() {
        let mut engine = PersistentEngine::in_memory().unwrap();

        engine.set_activity_metrics(vec![metric(4)]).unwrap();

        assert_eq!(stored_load(&engine, "a4"), (None, None, Some(0.0)));
    }

    /// Scenario: the profile write hits a broken table, the shape a busy
    /// connection or a constraint takes.
    ///
    /// Expected behaviour: the writer says so, so the sync step above it can
    /// fail rather than stamp a success over the previous athlete's values.
    #[test]
    fn a_failed_profile_write_is_reported() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.set_athlete_profile("{\"id\":\"i1\"}").unwrap();

        engine
            .db
            .execute_batch("DROP TABLE athlete_profile")
            .unwrap();

        assert!(engine.set_athlete_profile("{\"id\":\"i2\"}").is_err());
    }

    fn stored_profile(engine: &PersistentEngine) -> serde_json::Value {
        serde_json::from_str(&engine.get_athlete_profile().expect("a stored profile"))
            .expect("stored profile is JSON")
    }

    /// Scenario: the athlete body read with an API key carries the key, and
    /// the profile table is copied into every backup.
    ///
    /// Expected behaviour: the stored profile holds every field but the key.
    #[test]
    fn the_stored_profile_drops_the_api_key_and_keeps_every_other_field() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine
            .set_athlete_profile(
                r#"{"id":"i9","name":"Ola","icu_api_key":"k-secret","sportSettings":[{"ftp":250}],"weight":null}"#,
            )
            .unwrap();

        assert_eq!(
            stored_profile(&engine),
            serde_json::json!({
                "id": "i9",
                "name": "Ola",
                "sportSettings": [{"ftp": 250}],
                "weight": null,
            })
        );
    }

    #[test]
    fn a_profile_with_no_key_set_keeps_every_other_field() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine
            .set_athlete_profile(r#"{"id":"i9","icu_api_key":null}"#)
            .unwrap();
        assert_eq!(stored_profile(&engine), serde_json::json!({"id": "i9"}));

        engine.set_athlete_profile("{}").unwrap();
        assert_eq!(stored_profile(&engine), serde_json::json!({}));

        engine.set_athlete_profile("not json").unwrap();
        assert_eq!(engine.get_athlete_profile().as_deref(), Some("not json"));
    }

    /// Scenario: a database written before the key was stripped still holds
    /// it in the stored profile.
    ///
    /// Expected behaviour: opening the database removes it without a sync,
    /// and a second open finds nothing left to change.
    #[test]
    fn opening_the_database_scrubs_a_stored_api_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profile.db");
        let path = path.to_str().unwrap();

        {
            let engine = PersistentEngine::new(path).unwrap();
            engine
                .db
                .execute(
                    "INSERT OR REPLACE INTO athlete_profile (id, data, updated_at)
                     VALUES ('current', ?1, 7)",
                    [r#"{"id":"i9","icu_api_key":"k-secret","ftp":250}"#],
                )
                .unwrap();
        }

        let engine = PersistentEngine::new(path).unwrap();
        assert_eq!(
            stored_profile(&engine),
            serde_json::json!({"id": "i9", "ftp": 250})
        );
        let updated_at: i64 = engine
            .db
            .query_row("SELECT updated_at FROM athlete_profile", [], |r| r.get(0))
            .unwrap();
        assert_eq!(updated_at, 7, "the scrub is not a sync and keeps the stamp");
        drop(engine);

        let engine = PersistentEngine::new(path).unwrap();
        assert_eq!(
            stored_profile(&engine),
            serde_json::json!({"id": "i9", "ftp": 250})
        );
    }

    #[test]
    fn a_failed_sport_settings_write_is_reported() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.set_sport_settings("{\"ftp\":200}").unwrap();

        engine
            .db
            .execute_batch("DROP TABLE sport_settings")
            .unwrap();

        assert!(engine.set_sport_settings("{\"ftp\":210}").is_err());
    }

    #[test]
    fn a_write_over_the_bridge_stores_stats_and_leaves_the_zone_columns_empty() {
        let mut engine = PersistentEngine::in_memory().unwrap();

        engine
            .set_activity_metrics_extended(vec![crate::FfiActivityMetrics::from(extended(5))])
            .unwrap();

        assert_eq!(
            stored_load(&engine, "a5"),
            (Some(88.0), Some(250), Some(0.0))
        );
    }
}
