//! The durable per-activity stream store.
//!
//! `stream_bodies` is a cache of the raw payloads the server sent, with a
//! ceiling, so a fifty-first activity evicts the fiftieth. This is the store
//! the athlete sizes instead: one row per activity and series, packed with the
//! quantised codec, held for as long as the retention window says.
//!
//! It holds the series a track cannot. Coordinates, elevation and time already
//! live in `gps_tracks` and `time_streams` and are reconstructed from there, so
//! storing them again would pay twice for the same samples.

use rusqlite::{Result as SqlResult, params};

use super::{PersistentEngine, codec};
use crate::net::types::StreamDto;

/// Days of stream history kept when the athlete has never chosen. `Q31` set
/// this: ninety days, and the athlete can widen it without a ceiling.
pub const DEFAULT_STREAM_RETENTION_DAYS: i64 = 90;

/// The athlete's retention window, in days. Zero means keep everything, which
/// is what "no hard ceiling" comes to when the window is opened all the way.
pub const STREAM_RETENTION_DAYS_KEY: &str = "__stream_retention_days";

/// Series that come out of the track and its time stream rather than out of
/// this store. Writing them here would hold the same samples twice.
const FROM_THE_TRACK: [&str; 4] = ["latlng", "altitude", "fixed_altitude", "time"];

impl PersistentEngine {
    /// The retention window in days, or `None` for keep everything. An unset,
    /// unparseable or negative value reads as the default rather than as
    /// unlimited: a corrupt setting must not silently turn the store into an
    /// unbounded one.
    pub fn stream_retention_days(&self) -> Option<i64> {
        let raw = self
            .get_setting(STREAM_RETENTION_DAYS_KEY)
            .ok()
            .flatten()
            .and_then(|v| v.trim().parse::<i64>().ok());
        match raw {
            Some(0) => None,
            Some(d) if d > 0 => Some(d),
            _ => Some(DEFAULT_STREAM_RETENTION_DAYS),
        }
    }

    /// Set the retention window. Zero keeps everything; anything negative is
    /// refused rather than clamped, because a caller passing one is confused
    /// about the units and would otherwise get an unbounded store.
    pub fn set_stream_retention_days(&self, days: i64) -> SqlResult<()> {
        if days < 0 {
            return Ok(());
        }
        self.set_setting(STREAM_RETENTION_DAYS_KEY, &days.to_string())?;
        self.prune_streams_outside_retention()?;
        Ok(())
    }

    /// Store the series of one activity, replacing whatever it held. Series the
    /// track already answers are skipped, and an empty series is not stored at
    /// all: a row of nothing would report the activity as stocked and stop the
    /// fetch that would fill it.
    pub fn store_activity_streams(&self, activity_id: &str, raw: &[StreamDto]) -> SqlResult<()> {
        for s in raw {
            if FROM_THE_TRACK.contains(&s.kind.as_str()) || s.data.is_empty() {
                continue;
            }
            let scale = codec::series_scale(&s.kind);
            let blob = codec::encode_series(&s.data, scale);
            self.db.execute(
                "INSERT INTO activity_streams (activity_id, kind, data, sample_count, updated_at)
                 VALUES (?, ?, ?, ?, strftime('%s', 'now'))
                 ON CONFLICT(activity_id, kind) DO UPDATE SET
                    data = excluded.data,
                    sample_count = excluded.sample_count,
                    updated_at = excluded.updated_at",
                params![activity_id, s.kind, blob, s.data.len() as i64],
            )?;
        }
        self.prune_streams_outside_retention()?;
        Ok(())
    }

    /// The stored series of one activity, in the order they were written.
    ///
    /// A blob that will not decode is dropped rather than returned empty: an
    /// empty series reads downstream as "the ride had no power", which is a
    /// different claim from "this row is unreadable".
    pub fn load_activity_streams(&self, activity_id: &str) -> SqlResult<Vec<StreamDto>> {
        let mut stmt = self.db.prepare(
            "SELECT kind, data FROM activity_streams WHERE activity_id = ? ORDER BY kind",
        )?;
        let rows = stmt.query_map(params![activity_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (kind, blob) = row?;
            match codec::decode_series(&blob) {
                Some(data) => out.push(StreamDto {
                    kind,
                    data,
                    data2: None,
                }),
                None => log::warn!(
                    "veloqrs: [Streams] {} series for {} did not decode, dropping it",
                    kind,
                    activity_id
                ),
            }
        }
        Ok(out)
    }

    /// Which of the wanted series this store can answer for an activity.
    pub fn stored_stream_kinds(&self, activity_id: &str) -> SqlResult<Vec<String>> {
        let mut stmt = self
            .db
            .prepare("SELECT kind FROM activity_streams WHERE activity_id = ?")?;
        let rows = stmt.query_map(params![activity_id], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    /// Drop the streams of activities outside the retention window, oldest
    /// first. An activity with no recorded start date is kept: its age is
    /// unknown, and guessing it old would delete newest-first for anyone whose
    /// library predates the column being populated.
    pub fn prune_streams_outside_retention(&self) -> SqlResult<usize> {
        let Some(days) = self.stream_retention_days() else {
            return Ok(0);
        };
        let removed = self.db.execute(
            "DELETE FROM activity_streams WHERE activity_id IN (
                 SELECT id FROM activities
                 WHERE start_date IS NOT NULL
                   AND start_date < strftime('%s', 'now') - ? * 86400
             )",
            params![days],
        )?;
        Ok(removed)
    }

    /// Bytes the stream store holds, for the settings readout.
    pub fn stream_store_bytes(&self) -> SqlResult<i64> {
        self.db.query_row(
            "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM activity_streams",
            [],
            |r| r.get(0),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn engine() -> (TempDir, PersistentEngine) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        (dir, engine)
    }

    fn series(kind: &str, data: &[Option<f64>]) -> StreamDto {
        StreamDto {
            kind: kind.to_string(),
            data: data.to_vec(),
            data2: None,
        }
    }

    /// Insert an activity whose start date is `days_ago` days behind now.
    fn activity_aged(engine: &PersistentEngine, id: &str, days_ago: i64) {
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                 VALUES (?, 'Ride', 0, 0, 0, 0, strftime('%s', 'now') - ? * 86400)",
                params![id, days_ago],
            )
            .unwrap();
    }

    #[test]
    fn a_series_round_trips_through_the_quantised_codec() {
        let (_dir, engine) = engine();
        engine
            .store_activity_streams(
                "a1",
                &[
                    series("watts", &[Some(100.0), Some(0.0), Some(342.0)]),
                    series("velocity_smooth", &[Some(8.25), Some(8.26), Some(0.0)]),
                ],
            )
            .unwrap();

        let loaded = engine.load_activity_streams("a1").unwrap();
        let watts = loaded.iter().find(|s| s.kind == "watts").unwrap();
        assert_eq!(watts.data, vec![Some(100.0), Some(0.0), Some(342.0)]);
        let v = loaded.iter().find(|s| s.kind == "velocity_smooth").unwrap();
        assert_eq!(v.data, vec![Some(8.25), Some(8.26), Some(0.0)]);
    }

    #[test]
    fn a_gap_in_a_series_survives_as_a_gap() {
        let (_dir, engine) = engine();
        engine
            .store_activity_streams(
                "a1",
                &[series("heartrate", &[Some(140.0), None, Some(142.0)])],
            )
            .unwrap();

        let loaded = engine.load_activity_streams("a1").unwrap();
        assert_eq!(loaded[0].data, vec![Some(140.0), None, Some(142.0)]);
    }

    #[test]
    fn a_series_of_nothing_but_gaps_still_reads_at_full_length() {
        let (_dir, engine) = engine();
        engine
            .store_activity_streams("a1", &[series("temp", &[None, None, None])])
            .unwrap();

        let loaded = engine.load_activity_streams("a1").unwrap();
        assert_eq!(loaded[0].data, vec![None, None, None]);
    }

    #[test]
    fn the_track_series_are_not_stored_twice() {
        let (_dir, engine) = engine();
        engine
            .store_activity_streams(
                "a1",
                &[
                    series("latlng", &[Some(1.0)]),
                    series("altitude", &[Some(2.0)]),
                    series("fixed_altitude", &[Some(3.0)]),
                    series("time", &[Some(4.0)]),
                    series("watts", &[Some(5.0)]),
                ],
            )
            .unwrap();

        assert_eq!(engine.stored_stream_kinds("a1").unwrap(), vec!["watts"]);
    }

    #[test]
    fn an_empty_series_is_not_stored() {
        let (_dir, engine) = engine();
        engine
            .store_activity_streams("a1", &[series("watts", &[])])
            .unwrap();

        assert!(engine.stored_stream_kinds("a1").unwrap().is_empty());
    }

    #[test]
    fn refetching_replaces_the_stored_series() {
        let (_dir, engine) = engine();
        engine
            .store_activity_streams("a1", &[series("watts", &[Some(1.0)])])
            .unwrap();
        engine
            .store_activity_streams("a1", &[series("watts", &[Some(9.0), Some(9.0)])])
            .unwrap();

        let loaded = engine.load_activity_streams("a1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].data, vec![Some(9.0), Some(9.0)]);
    }

    #[test]
    fn the_default_window_is_ninety_days() {
        let (_dir, engine) = engine();
        assert_eq!(
            engine.stream_retention_days(),
            Some(DEFAULT_STREAM_RETENTION_DAYS)
        );
    }

    #[test]
    fn zero_days_keeps_everything() {
        let (_dir, engine) = engine();
        engine.set_stream_retention_days(0).unwrap();
        assert_eq!(engine.stream_retention_days(), None);

        activity_aged(&engine, "old", 4000);
        engine
            .store_activity_streams("old", &[series("watts", &[Some(1.0)])])
            .unwrap();
        assert_eq!(engine.stored_stream_kinds("old").unwrap(), vec!["watts"]);
    }

    #[test]
    fn a_corrupt_window_reads_as_the_default_rather_than_as_unlimited() {
        let (_dir, engine) = engine();
        engine
            .set_setting(STREAM_RETENTION_DAYS_KEY, "not a number")
            .unwrap();
        assert_eq!(
            engine.stream_retention_days(),
            Some(DEFAULT_STREAM_RETENTION_DAYS)
        );

        engine.set_setting(STREAM_RETENTION_DAYS_KEY, "-5").unwrap();
        assert_eq!(
            engine.stream_retention_days(),
            Some(DEFAULT_STREAM_RETENTION_DAYS)
        );
    }

    #[test]
    fn the_window_evicts_oldest_first_and_keeps_the_newest() {
        let (_dir, engine) = engine();
        activity_aged(&engine, "recent", 10);
        activity_aged(&engine, "edge", 80);
        activity_aged(&engine, "old", 200);
        for id in ["recent", "edge", "old"] {
            engine
                .store_activity_streams(id, &[series("watts", &[Some(1.0)])])
                .unwrap();
        }

        // The default window already dropped the 200-day activity on write.
        assert!(engine.stored_stream_kinds("old").unwrap().is_empty());
        assert!(!engine.stored_stream_kinds("edge").unwrap().is_empty());
        assert!(!engine.stored_stream_kinds("recent").unwrap().is_empty());

        // Shrinking it takes the next oldest and leaves the newest alone.
        engine.set_stream_retention_days(30).unwrap();
        assert!(engine.stored_stream_kinds("edge").unwrap().is_empty());
        assert!(!engine.stored_stream_kinds("recent").unwrap().is_empty());
    }

    #[test]
    fn an_activity_with_no_start_date_is_kept() {
        let (_dir, engine) = engine();
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES ('undated', 'Ride', 0, 0, 0, 0)",
                [],
            )
            .unwrap();
        engine
            .store_activity_streams("undated", &[series("watts", &[Some(1.0)])])
            .unwrap();
        engine.set_stream_retention_days(1).unwrap();

        assert!(!engine.stored_stream_kinds("undated").unwrap().is_empty());
    }

    #[test]
    fn the_readout_counts_what_is_stored() {
        let (_dir, engine) = engine();
        assert_eq!(engine.stream_store_bytes().unwrap(), 0);

        engine
            .store_activity_streams("a1", &[series("watts", &[Some(1.0); 100])])
            .unwrap();
        assert!(engine.stream_store_bytes().unwrap() > 0);
    }

    #[test]
    fn an_unreadable_blob_is_dropped_rather_than_read_as_empty() {
        let (_dir, engine) = engine();
        engine
            .store_activity_streams("a1", &[series("watts", &[Some(1.0)])])
            .unwrap();
        engine
            .db
            .execute(
                "UPDATE activity_streams SET data = X'DEADBEEF' WHERE activity_id = 'a1'",
                [],
            )
            .unwrap();

        assert!(engine.load_activity_streams("a1").unwrap().is_empty());
    }
}
