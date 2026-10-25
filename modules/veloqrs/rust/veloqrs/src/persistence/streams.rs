//! The durable per-activity stream store.
//!
//! `stream_bodies` is a cache of the raw payloads the server sent, with a
//! ceiling, so a fifty-first activity evicts the fiftieth. This is the store
//! the athlete sizes instead: one row per activity and series, packed with the
//! quantised codec, held for as long as the retention window says.
//!
//! It holds the series a track cannot. Coordinates, elevation and time already
//! live in `gps_tracks` and `time_streams` and are reconstructed from there, so
//! storing them again would pay twice for the same samples. An activity with no
//! track has nothing to reconstruct from, so its rows keep the server's own
//! sample index and carry the `time` series that addresses it ([`SeriesIndex`]).

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

use super::{PersistentEngine, codec};
use crate::net::intervals::endpoints::DEFAULT_STREAM_TYPES;
use crate::net::types::StreamDto;

/// What is kept when the athlete has never chosen: everything.
///
/// This was ninety days, set against the size of the raw JSON. The codec packs
/// it about ten times smaller: a 1,595-activity library measures 17.0 MB for
/// everything against 1.2 MB for ninety days, so the window was discarding the
/// cadence, heart rate and power of every older activity to save about 16 MB.
/// Those are the samples route matching compares attempts with, so the default
/// keeps them and the athlete narrows it if they want the space.
pub const DEFAULT_STREAM_RETENTION_DAYS: Option<i64> = None;

/// The athlete's retention window, in days. Zero means keep everything, which
/// is what "no hard ceiling" comes to when the window is opened all the way.
pub const STREAM_RETENTION_DAYS_KEY: &str = "__stream_retention_days";

pub(crate) mod pooled {
    use super::*;

    pub(crate) fn activity_streams(
        conn: &Connection,
        activity_id: &str,
    ) -> SqlResult<Vec<StreamDto>> {
        let mut stmt = conn.prepare(
            "SELECT kind, data FROM activity_streams WHERE activity_id = ? ORDER BY kind",
        )?;
        let rows = stmt.query_map(params![activity_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
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

    pub(crate) fn retention_days(conn: &Connection) -> Option<i64> {
        let raw = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![STREAM_RETENTION_DAYS_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
            .and_then(|v| v.trim().parse::<i64>().ok());
        match raw {
            Some(0) => None,
            Some(days) if days > 0 => Some(days),
            _ => DEFAULT_STREAM_RETENTION_DAYS,
        }
    }

    pub(crate) fn store_bytes(conn: &Connection) -> SqlResult<i64> {
        conn.query_row(
            "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM activity_streams",
            [],
            |r| r.get(0),
        )
    }

    pub(crate) fn backfill_remaining(conn: &Connection, attempt_limit: u32) -> SqlResult<usize> {
        let window = retention_days(conn);
        let count: i64 = conn.query_row(
            &stream_gap_count_sql(),
            params![attempt_limit, window],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as usize)
    }

    /// Which of `ids` the stream backfill owes an ask, through the same rows as
    /// its queue, so a track another pass asks for whole is one this pass
    /// would have asked for anyway.
    pub(crate) fn owed_among(
        conn: &Connection,
        ids: &[String],
        attempt_limit: u32,
    ) -> SqlResult<std::collections::HashSet<String>> {
        let window = retention_days(conn);
        let mut owed = std::collections::HashSet::new();
        for chunk in ids.chunks(500) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!("SELECT a.id {STREAM_GAP_FROM_WHERE} AND a.id IN ({placeholders})");
            let mut values: Vec<rusqlite::types::Value> = vec![
                i64::from(attempt_limit).into(),
                window.map_or(rusqlite::types::Value::Null, Into::into),
            ];
            values.extend(chunk.iter().map(|id| id.clone().into()));
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(values), |row| {
                row.get::<_, String>(0)
            })?;
            for row in rows {
                owed.insert(row?);
            }
        }
        Ok(owed)
    }

    /// The queue's length and what it would download, read through the same
    /// rows as the count so the two cannot describe different queues.
    ///
    /// An activity whose stored body lists requested series is counted as
    /// those series times its samples: the clock's sample count, else the
    /// track's, else its moving seconds. One with no body, no list, or a list
    /// naming nothing requested is counted as moving seconds for the flat rate,
    /// so it is never priced at nothing.
    pub(crate) fn backfill_estimate(
        conn: &Connection,
        attempt_limit: u32,
    ) -> SqlResult<BackfillEstimate> {
        let window = retention_days(conn);
        let (count, series_samples, unlisted_seconds): (i64, i64, i64) = conn.query_row(
            &format!(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN listed > 0 THEN listed * samples END), 0),
                        COALESCE(SUM(CASE WHEN listed > 0 THEN 0 ELSE moving END), 0)
                   FROM (SELECT
                           (SELECT COUNT(*)
                              FROM activity_bodies ab,
                                   json_each(CASE WHEN json_valid(ab.raw) THEN ab.raw END,
                                             '$.stream_types') st
                             WHERE ab.activity_id = a.id
                               AND st.type = 'text'
                               AND instr(',' || ?3 || ',', ',' || st.value || ',') > 0)
                             AS listed,
                           COALESCE((SELECT t.point_count FROM time_streams t
                                      WHERE t.activity_id = a.id),
                                    g.point_count,
                                    (SELECT m.moving_time FROM activity_metrics m
                                      WHERE m.activity_id = a.id),
                                    0) AS samples,
                           COALESCE((SELECT m.moving_time FROM activity_metrics m
                                      WHERE m.activity_id = a.id), 0) AS moving
                         {STREAM_GAP_FROM_WHERE})"
            ),
            params![attempt_limit, window, DEFAULT_STREAM_TYPES],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        Ok(BackfillEstimate {
            owed: count.max(0) as usize,
            series_samples: series_samples.max(0) as u64,
            unlisted_seconds: unlisted_seconds.max(0) as u64,
        })
    }
}

/// What the owed stream queue holds, in the units its price is set in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BackfillEstimate {
    /// Activities owed.
    pub owed: usize,
    /// The requested series each listed activity's body names, times its
    /// samples, summed.
    pub series_samples: u64,
    /// Moving seconds of the activities whose body names no requested series.
    pub unlisted_seconds: u64,
}

/// The rows the stream backfill still has to ask about, shared by the queue
/// and its count so the two cannot disagree. `?1` is the attempt limit and
/// `?2` the retention window in days, or NULL when it is unbounded.
///
/// An activity is a candidate when its track is stored, or when it has none and
/// the census says upstream holds a series for it. An activity upstream holds
/// a track for that this device has not stored yet belongs to the track fetch,
/// which widens for it.
///
/// Whether a row is upstream is `origin::intervals_upstream` over
/// `activities.intervals_id` alone, so a key minted here whose id sits only on
/// its body waits. Demo rows are in, since that function names them: demo mode
/// holds no credential and runs no backfill, so they cost nothing.
pub(crate) const STREAM_GAP_FROM_WHERE: &str = "FROM activities a
               LEFT JOIN gps_tracks g ON g.activity_id = a.id
               LEFT JOIN activity_stream_backfill b ON b.activity_id = a.id
              WHERE (g.activity_id IS NOT NULL
                     OR EXISTS (
                        SELECT 1 FROM activity_census c
                         WHERE c.intervals_id IN (a.id, a.intervals_id)
                           AND c.has_series = 1 AND c.has_latlng = 0))
                AND NOT EXISTS (
                        SELECT 1 FROM activity_streams s WHERE s.activity_id = a.id)
                AND ((a.id NOT LIKE 'local-%' AND a.id NOT LIKE 'src-%')
                     OR a.intervals_id IS NOT NULL)
                AND COALESCE(b.attempts, 0) < ?1
                AND NOT EXISTS (
                        SELECT 1 FROM activity_held_back hb WHERE hb.activity_id = a.id)
                AND (?2 IS NULL
                     OR (a.start_date IS NOT NULL
                         AND a.start_date >= strftime('%s', 'now') - ?2 * 86400))";

/// The queue read, in the order the athlete watches it fill.
pub(crate) fn stream_gap_queue_sql() -> String {
    format!(
        "SELECT a.id, g.point_count {STREAM_GAP_FROM_WHERE}
              ORDER BY a.start_date IS NULL, a.start_date DESC, a.id"
    )
}

/// The count read: no order, so it never materialises the rows to sort them.
pub(crate) fn stream_gap_count_sql() -> String {
    format!("SELECT COUNT(*) {STREAM_GAP_FROM_WHERE}")
}

/// Series that come out of the track and its time stream rather than out of
/// this store. The writers skip them for an activity with a track, since
/// storing them would hold the same samples twice, and the reader rebuilds them
/// from the track without looking for a stored copy. Anything outside this set
/// only arrives as a fetched body.
pub const FROM_THE_TRACK: [&str; 4] = ["latlng", "altitude", "fixed_altitude", "time"];

/// Whether the fetches that stock an activity with a track ask upstream for
/// `kind`. The wide sync and the stream pass both ask for the whole
/// [`DEFAULT_STREAM_TYPES`] set and store every non-empty series in the
/// answer, so for an activity they stocked, a series in that set with no row
/// is one upstream does not hold. A series outside it was never asked about.
pub(crate) fn stocking_asks_for(kind: &str) -> bool {
    DEFAULT_STREAM_TYPES.split(',').any(|asked| asked == kind)
}

/// The index one activity's stored series are addressed by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeriesIndex {
    /// The stored track's points, `latlng`'s mask applied. The track and its
    /// time stream answer [`FROM_THE_TRACK`], so none of those is stored.
    Track,
    /// The server's own samples, for an activity with no track. Its `time`
    /// series is stored with the rest, and a `time` row is what marks an
    /// activity's rows as in this index: the track index never stores one.
    Samples,
}

/// The rows one activity's response becomes: each series the index does not
/// already answer, packed with the quantised codec. In the track index that is
/// everything outside [`FROM_THE_TRACK`]; in the server's samples it is every
/// series but coordinates, which an activity with no track has none of. An
/// empty series is left out, because a row of nothing would report the
/// activity as stocked.
///
/// This is the one place the packing rule lives, so a diagnostic that sizes
/// the store measures exactly what the store writes.
pub fn pack_activity_streams(raw: &[StreamDto], index: SeriesIndex) -> Vec<(&str, Vec<u8>, usize)> {
    raw.iter()
        .filter(|s| !s.data.is_empty())
        .filter(|s| match index {
            SeriesIndex::Track => !FROM_THE_TRACK.contains(&s.kind.as_str()),
            SeriesIndex::Samples => s.kind != "latlng",
        })
        .map(|s| {
            let blob = codec::encode_series(&s.data, codec::series_scale(&s.kind));
            (s.kind.as_str(), blob, s.data.len())
        })
        .collect()
}

/// One activity the stream backfill owes an ask, with the track length the
/// answer has to match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamGap {
    pub activity_id: String,
    /// Samples the stored track holds. A response that covers a different
    /// number is a re-processed activity, not this one's series. `None` for
    /// an activity with no track, whose series stay in the server's own
    /// sample index.
    pub point_count: Option<usize>,
}

/// The window decision on its own, so a caller filtering a whole sync reads
/// the setting once and takes the clock once rather than doing both per row.
///
/// `days` is `None` for keep everything, which is [`PersistentEngine::stream_retention_days`]'s
/// own reading of an unset or unusable setting.
pub fn inside_stream_window_at(days: Option<i64>, now: i64, start_date: Option<i64>) -> bool {
    let Some(days) = days else {
        return true;
    };
    let Some(start) = start_date else {
        return false;
    };
    start >= now - days * 86_400
}

impl PersistentEngine {
    /// The retention window in days, or `None` for keep everything. An unset,
    /// unparseable or negative value reads as the default, which keeps
    /// everything: a setting nobody can read must not silently start deleting
    /// an athlete's history.
    pub fn stream_retention_days(&self) -> Option<i64> {
        pooled::retention_days(&self.db)
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

    /// Whether an activity's start date is inside the retention window, which
    /// is what decides whether its sync downloads every series or only the
    /// three the track needs.
    ///
    /// An unknown date is outside it. On a first sync no activity has a date
    /// yet, and widening on a guess would download thirteen series apiece for
    /// a whole library and hand most of them straight to the prune. An undated
    /// activity the athlete opens is still stocked by the detail screen's own
    /// fetch, because the prune keeps a row with no start date. A dated
    /// activity outside the window is not: the fetch writes it and the same
    /// call's prune takes it straight back out, which is the window doing what
    /// it was set to do. The screen still draws it, off the cached body.
    pub fn inside_stream_window(&self, start_date: Option<i64>) -> bool {
        inside_stream_window_at(
            self.stream_retention_days(),
            chrono::Utc::now().timestamp(),
            start_date,
        )
    }

    /// Store the series of one activity, in its track's index, replacing
    /// whatever it held. Series the track already answers are skipped, and an
    /// empty series is not stored at all: a row of nothing would report the
    /// activity as stocked and stop the fetch that would fill it.
    pub fn store_activity_streams(&self, activity_id: &str, raw: &[StreamDto]) -> SqlResult<()> {
        self.store_streams_in(activity_id, raw, SeriesIndex::Track)
    }

    /// Store the series of an activity with no track, in the server's own
    /// sample index, `time` among them. `raw` is what
    /// [`crate::net::types::trackless_series`] kept.
    pub fn store_trackless_streams(&self, activity_id: &str, raw: &[StreamDto]) -> SqlResult<()> {
        self.store_streams_in(activity_id, raw, SeriesIndex::Samples)
    }

    fn store_streams_in(
        &self,
        activity_id: &str,
        raw: &[StreamDto],
        index: SeriesIndex,
    ) -> SqlResult<()> {
        // One transaction for the body. A series per autocommit paid an fsync
        // apiece under the engine lock, and the prune paid another, so an
        // activity with four series held every screen read out five times.
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match self.write_activity_streams(activity_id, raw, index) {
            Ok(()) => super::commit_write_txn(&self.db)?,
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
        Ok(())
    }

    /// The write itself, with no transaction of its own, so a caller that is
    /// already inside one commits the streams alongside its own rows.
    pub(super) fn write_activity_streams(
        &self,
        activity_id: &str,
        raw: &[StreamDto],
        index: SeriesIndex,
    ) -> SqlResult<()> {
        let packed = pack_activity_streams(raw, index);
        if index == SeriesIndex::Track && !packed.is_empty() {
            // Rows in the server's index are addressed against other samples,
            // so none of them may stay beside these. An activity stored
            // without a track that later gains one is the case: its rows would
            // otherwise be read against the track's points. The other way
            // round needs nothing, since a server-index write is only made for
            // an activity with no track to have indexed anything by.
            self.db.execute(
                "DELETE FROM activity_streams WHERE activity_id = ?1
                   AND EXISTS (SELECT 1 FROM activity_streams
                                WHERE activity_id = ?1 AND kind = 'time')",
                params![activity_id],
            )?;
        }
        for (kind, blob, samples) in packed {
            self.db.execute(
                "INSERT INTO activity_streams (activity_id, kind, data, sample_count, updated_at)
                 VALUES (?, ?, ?, ?, strftime('%s', 'now'))
                 ON CONFLICT(activity_id, kind) DO UPDATE SET
                    data = excluded.data,
                    sample_count = excluded.sample_count,
                    updated_at = excluded.updated_at",
                params![activity_id, kind, blob, samples as i64],
            )?;
            // A new series may cover the traversals the old one left empty.
            let cleared = match kind {
                "heartrate" => "hr_empty",
                "watts" => "power_empty",
                _ => continue,
            };
            self.db.execute(
                &format!("UPDATE section_activities SET {cleared} = 0 WHERE activity_id = ? AND {cleared} = 1"),
                params![activity_id],
            )?;
        }
        // The prune runs on the way out, so an activity outside the window is
        // written and deleted inside this one call. That is deliberate: the
        // window is the athlete's storage budget, and exempting whatever was
        // written last would only keep it until the next write, which is a
        // lifetime nobody can reason about. What the athlete sees is served
        // from `stream_bodies` instead.
        self.prune_streams_outside_retention()?;
        Ok(())
    }

    /// The stored series of one activity, in the order they were written.
    ///
    /// A blob that will not decode is dropped rather than returned empty: an
    /// empty series reads downstream as "the ride had no power", which is a
    /// different claim from "this row is unreadable".
    pub fn load_activity_streams(&self, activity_id: &str) -> SqlResult<Vec<StreamDto>> {
        pooled::activity_streams(&self.db, activity_id)
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

    /// One activity the stream backfill still has to ask about: what the sync
    /// would have widened for today and has no stored series for.
    ///
    /// Derived on every call rather than held anywhere, so an interrupted pass
    /// resumes with no bookkeeping and an activity the athlete's detail screen
    /// stocked in the meantime leaves the queue on its own.
    ///
    /// The window is applied here in SQL rather than through
    /// [`Self::inside_stream_window`] per row, so narrowing the window narrows
    /// the queue in the same breath. An undated activity is in the queue only
    /// when the window is unbounded, which is the same rule the sync widens by.
    ///
    /// An activity with no track is listed when the census says upstream holds
    /// a series for it, with no `point_count`: its series keep the server's
    /// own index.
    ///
    /// `point_count` rides along because the fetch has to check the series it
    /// gets back still covers the track it will be addressed against. Newest
    /// first, so an athlete watching the progress sees the activities they
    /// care about most fill in first.
    pub fn activities_missing_streams(&self, attempt_limit: u32) -> SqlResult<Vec<StreamGap>> {
        let window = self.stream_retention_days();
        let mut stmt = self.db.prepare(&stream_gap_queue_sql())?;
        let rows = stmt.query_map(params![attempt_limit, window], |row| {
            Ok(StreamGap {
                activity_id: row.get(0)?,
                point_count: row.get::<_, Option<i64>>(1)?.map(|n| n.max(0) as usize),
            })
        })?;
        rows.collect()
    }

    /// How many activities the stream backfill still has to ask about.
    pub fn stream_backfill_remaining(&self, attempt_limit: u32) -> SqlResult<usize> {
        pooled::backfill_remaining(&self.db, attempt_limit)
    }

    /// Count one ask that settled nothing against an activity, so an activity
    /// upstream carries no extra series for eventually leaves the queue.
    ///
    /// An ask that stored something never reaches here: the stored rows are
    /// what take it out of the queue, and they say more than a count could.
    pub fn record_stream_backfill_attempt(&self, activity_id: &str) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO activity_stream_backfill (activity_id, attempts, updated_at)
             VALUES (?, 1, strftime('%s', 'now'))
             ON CONFLICT(activity_id) DO UPDATE SET
                attempts = attempts + 1,
                updated_at = excluded.updated_at",
            params![activity_id],
        )?;
        Ok(())
    }

    /// Record that an answer to the full series ask carried nothing this store
    /// keeps, as if the stream backfill had asked `attempt_limit` times. The
    /// pass would ask the same question and get the same answer, so it leaves
    /// the queue rather than costing another request.
    pub fn settle_stream_backfill(&self, activity_id: &str, attempt_limit: u32) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO activity_stream_backfill (activity_id, attempts, updated_at)
             VALUES (?1, ?2, strftime('%s', 'now'))
             ON CONFLICT(activity_id) DO UPDATE SET
                attempts = MAX(attempts, excluded.attempts),
                updated_at = excluded.updated_at",
            params![activity_id, attempt_limit],
        )?;
        Ok(())
    }

    /// Drop every stored series of one activity. A track about to be replaced
    /// by one of another length takes its series with it, since they address
    /// the points it is losing.
    pub fn drop_activity_streams(&self, activity_id: &str) -> SqlResult<()> {
        self.db.execute(
            "DELETE FROM activity_streams WHERE activity_id = ?1",
            params![activity_id],
        )?;
        Ok(())
    }

    /// Store what one streams answer carried for an activity with a stored
    /// track: its series and its clock, both in the track's index space, in
    /// one transaction. Returns whether the clock was stored.
    ///
    /// `clock` is stored only when it covers exactly the stored points, since
    /// a section times a traversal by indexing it with the track's own
    /// indices. An empty clock records that upstream has none, the zero-length
    /// row the clock pass writes, and only where no clock is stored yet.
    /// `None` leaves the clock alone. An activity with no stored track has
    /// nothing to address the series against, so nothing is written.
    pub fn store_track_series(
        &mut self,
        activity_id: &str,
        streams: &[StreamDto],
        clock: Option<&[u32]>,
    ) -> SqlResult<bool> {
        let points = self
            .track_point_counts(&[activity_id.to_string()])
            .get(activity_id)
            .copied();
        let Some(points) = points else {
            return Ok(false);
        };
        self.write_track_series(activity_id, streams, clock, points, |_| Ok(false))
    }

    /// The write behind [`Self::store_track_series`], with a write of the
    /// caller's own made inside the same transaction first. `alongside`
    /// answers whether it moved what the climb bests are measured from.
    /// `points` is the length the track has once `alongside` has run.
    pub(super) fn write_track_series(
        &mut self,
        activity_id: &str,
        streams: &[StreamDto],
        clock: Option<&[u32]>,
        points: usize,
        alongside: impl FnOnce(&Connection) -> SqlResult<bool>,
    ) -> SqlResult<bool> {
        let times = clock.unwrap_or_default();
        let clock_fits = !times.is_empty() && times.len() == points;
        let none_upstream =
            clock.is_some_and(|t| t.is_empty()) && self.load_time_stream(activity_id).is_none();
        if !times.is_empty() && !clock_fits {
            log::warn!(
                "veloqrs: [Streams] {activity_id} clock covers {} samples, the track {points}, not storing it",
                times.len()
            );
        }
        let clock_moved =
            clock_fits && self.load_time_stream(activity_id).as_deref() != Some(times);
        super::climb_bests::in_write_txn(&self.db, |conn| {
            let climbs_moved = alongside(conn)?;
            if !streams.is_empty() {
                self.write_activity_streams(activity_id, streams, SeriesIndex::Track)?;
            }
            if clock_fits || none_upstream {
                self.store_time_stream(activity_id, times)?;
            }
            if clock_moved {
                // The lap times the old clock produced must not survive it.
                self.clear_lap_times_for(&[activity_id.to_string()]);
            }
            if climbs_moved || clock_moved {
                super::climb_bests::refresh(conn, activity_id)?;
            }
            Ok(())
        })?;
        if clock_fits {
            self.time_streams
                .put(activity_id.to_string(), times.to_vec());
            if clock_moved {
                // The lift veto reads the clock, so a cut made without it
                // has to be made again.
                self.evict_processed_activity_ids(&[activity_id.to_string()]);
            }
            self.invalidate_perf_cache();
        }
        Ok(clock_fits)
    }

    /// Bytes the stream store holds, for the settings readout.
    pub fn stream_store_bytes(&self) -> SqlResult<i64> {
        pooled::store_bytes(&self.db)
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

    /// Scenario: a sync filters every fetched activity through the retention
    /// window. The setting and the clock are now read once for the batch, so
    /// the decision is pinned here on its own.
    #[test]
    fn the_window_decision_reads_a_day_boundary_the_same_way_whoever_asks() {
        use super::inside_stream_window_at;
        let now = 1_700_000_000;
        let edge = now - 90 * 86_400;

        assert!(inside_stream_window_at(Some(90), now, Some(edge)));
        assert!(inside_stream_window_at(Some(90), now, Some(edge + 1)));
        assert!(!inside_stream_window_at(Some(90), now, Some(edge - 1)));
    }

    /// No window keeps everything, an undated activity is outside any window,
    /// and a zero window keeps only activities starting now.
    #[test]
    fn the_window_decision_keeps_everything_when_there_is_no_window() {
        use super::inside_stream_window_at;
        let now = 1_700_000_000;

        assert!(inside_stream_window_at(None, now, Some(0)));
        assert!(inside_stream_window_at(None, now, None));
        assert!(!inside_stream_window_at(Some(90), now, None));
        assert!(inside_stream_window_at(Some(0), now, Some(now)));
        assert!(!inside_stream_window_at(Some(0), now, Some(now - 1)));
    }

    /// Scenario: the retention prune runs on the way out of every stream write,
    /// inside the per-activity write hold, and its subquery selects on
    /// `activities.start_date`.
    ///
    /// Expected behaviour: that selection is served by an index. Without one
    /// SQLite scans the whole `activities` table once per stored activity, so a
    /// 500-activity sync into a 5,000-activity library scans 2.5 million rows
    /// it does not need, all of it holding the lock every screen read waits on.
    #[test]
    fn the_retention_prune_does_not_scan_every_activity() {
        let (_dir, engine) = engine();

        let plan: Vec<String> = engine
            .db
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM activities
                 WHERE start_date IS NOT NULL
                   AND start_date < strftime('%s', 'now') - ? * 86400",
            )
            .unwrap()
            .query_map(params![90i64], |r| r.get::<_, String>(3))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(
            plan.iter().any(|step| step.contains("start_date")),
            "the prune reads start_date without an index on it: {plan:?}"
        );
        assert!(
            !plan.iter().any(|step| step.starts_with("SCAN activities")),
            "the prune scans the whole activities table: {plan:?}"
        );
    }

    // Scenario: the window was set against the raw JSON size and the codec packs
    // it about ten times smaller, so ninety days was throwing away the per-sample
    // series route matching is the reason for keeping.
    //
    // Expected behaviour: an athlete who has never chosen keeps everything, and
    // one who has chosen keeps exactly what they chose.
    #[test]
    fn an_athlete_who_never_chose_keeps_every_series() {
        let (_dir, engine) = engine();
        activity_aged(&engine, "old", 4000);
        engine
            .store_activity_streams("old", &[series("watts", &[Some(1.0)])])
            .unwrap();

        assert!(
            engine.inside_stream_window(Some(0)),
            "a 1970 activity is inside an unbounded window"
        );
        assert_eq!(engine.prune_streams_outside_retention().unwrap(), 0);
        assert_eq!(engine.stored_stream_kinds("old").unwrap(), vec!["watts"]);
    }

    /// Give an activity a stored track, which is what makes it a candidate:
    /// the backfill only asks about activities the sync already ingested.
    fn track(engine: &PersistentEngine, id: &str, points: usize) {
        engine
            .db
            .execute(
                "INSERT INTO gps_tracks (activity_id, track_data, point_count) VALUES (?, X'00', ?)",
                params![id, points as i64],
            )
            .unwrap();
    }

    /// Scenario: the default retention window used to be ninety days, so every
    /// activity older than that synced with only the three series the track
    /// needs. Widening the default fixes the next sync and nothing about the
    /// library already on the device.
    ///
    /// Expected behaviour: the backfill queue names exactly the activities with
    /// no stored series, and nothing it already has them for.
    #[test]
    fn the_queue_names_only_activities_with_no_stored_series() {
        let (_dir, engine) = engine();
        activity_aged(&engine, "bare", 400);
        track(&engine, "bare", 120);
        activity_aged(&engine, "stocked", 300);
        track(&engine, "stocked", 90);
        engine
            .store_activity_streams("stocked", &[series("watts", &[Some(1.0)])])
            .unwrap();

        let queue = engine.activities_missing_streams(3).unwrap();

        assert_eq!(
            queue,
            vec![StreamGap {
                activity_id: "bare".to_string(),
                point_count: Some(120),
            }]
        );
    }

    /// Record what the census says about each activity: whether upstream
    /// holds a track for it and whether it carries a series beyond one.
    fn census(engine: &mut PersistentEngine, rows: &[(&str, bool, bool)]) {
        let entries: Vec<crate::net::types::ActivityCensusEntry> = rows
            .iter()
            .map(
                |(id, has_latlng, has_series)| crate::net::types::ActivityCensusEntry {
                    id: id.to_string(),
                    start_date_local: Some("2026-09-01T08:00:00".to_string()),
                    has_latlng: *has_latlng,
                    has_series: *has_series,
                    ..Default::default()
                },
            )
            .collect();
        engine.record_activity_census("i0", &entries).unwrap();
    }

    /// Scenario: inside the window sit a strength session the census says
    /// carries heart rate and no track, a session it says carries nothing, a
    /// ride with its track stored, and a ride whose track has not landed yet.
    ///
    /// Expected behaviour: the queue lists the strength session, with no track
    /// length to match, beside the stored ride, and not the empty session or
    /// the ride the track fetch still owes. The count agrees, and storing the
    /// session's series takes it out.
    #[test]
    fn the_queue_lists_a_trackless_activity_only_when_upstream_holds_a_series_for_it() {
        let (_dir, mut engine) = engine();
        for id in ["i1", "i2", "i3", "i4"] {
            activity_aged(&engine, id, 10);
        }
        track(&engine, "i3", 50);
        census(
            &mut engine,
            &[
                ("i1", false, true),
                ("i2", false, false),
                ("i3", true, true),
                ("i4", true, true),
            ],
        );

        let mut queue = engine.activities_missing_streams(3).unwrap();
        queue.sort_by(|a, b| a.activity_id.cmp(&b.activity_id));

        assert_eq!(
            queue,
            vec![
                StreamGap {
                    activity_id: "i1".to_string(),
                    point_count: None,
                },
                StreamGap {
                    activity_id: "i3".to_string(),
                    point_count: Some(50),
                },
            ]
        );
        assert_eq!(engine.stream_backfill_remaining(3).unwrap(), 2);

        engine
            .set_stream_body(
                "i1",
                "heartrate,time",
                r#"[{"type":"time","data":[0,1]},{"type":"heartrate","data":[90,91]}]"#,
            )
            .unwrap();
        assert_eq!(
            engine
                .activities_missing_streams(3)
                .unwrap()
                .iter()
                .map(|g| g.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["i3"]
        );
    }

    /// A trackless activity is matched by the id upstream knows it by, so a
    /// session recorded on the device and uploaded later joins the queue under
    /// the census row its upload named.
    #[test]
    fn a_trackless_recording_joins_the_queue_through_its_intervals_id() {
        let (_dir, mut engine) = engine();
        activity_aged(&engine, "local-gym", 10);
        engine
            .db
            .execute(
                "UPDATE activities SET intervals_id = 'i7' WHERE id = 'local-gym'",
                [],
            )
            .unwrap();
        census(&mut engine, &[("i7", false, true)]);

        let queue = engine.activities_missing_streams(3).unwrap();

        assert_eq!(
            queue,
            vec![StreamGap {
                activity_id: "local-gym".to_string(),
                point_count: None,
            }]
        );
    }

    /// Scenario: the ask before a large download sizes the queue.
    ///
    /// Expected behaviour: the count is the queue's own, and the moving
    /// seconds are summed over exactly those activities.
    #[test]
    fn the_estimate_sums_moving_seconds_over_the_queue_only() {
        let (_dir, engine) = engine();
        for (id, secs) in [("a", 600), ("b", 1800), ("stocked", 9000)] {
            activity_aged(&engine, id, 10);
            track(&engine, id, 10);
            engine
                .db
                .execute(
                    "INSERT INTO activity_metrics
                         (activity_id, name, date, distance, moving_time, elapsed_time,
                          elevation_gain, sport_type)
                     VALUES (?, 'r', 0, 0, ?, ?, 0, 'Ride')",
                    params![id, secs, secs],
                )
                .unwrap();
        }
        engine
            .store_activity_streams("stocked", &[series("heartrate", &[Some(120.0)])])
            .unwrap();

        assert_eq!(
            pooled::backfill_estimate(&engine.db, 3).unwrap(),
            BackfillEstimate {
                owed: 2,
                series_samples: 0,
                unlisted_seconds: 2400
            }
        );
    }

    /// The bytes the ask quotes for a queue of one owed activity: a 3,000 s
    /// track recorded at `points` samples, whose stored body is `raw`.
    fn priced_alone(points: usize, raw: Option<&str>) -> u64 {
        let (_dir, engine) = engine();
        activity_aged(&engine, "owed", 10);
        track(&engine, "owed", points);
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics
                     (activity_id, name, date, distance, moving_time, elapsed_time,
                      elevation_gain, sport_type)
                 VALUES ('owed', 'r', 0, 0, 3000, 3000, 0, 'Run')",
                [],
            )
            .unwrap();
        if let Some(raw) = raw {
            engine
                .db
                .execute(
                    "INSERT INTO activity_bodies (activity_id, date, raw) VALUES ('owed', 0, ?)",
                    params![raw],
                )
                .unwrap();
        }
        let (owed, bytes) = crate::net::stream_backfill::queue_estimate(&engine.db).unwrap();
        assert_eq!(owed, 1);
        bytes
    }

    /// Scenario: the ask before a large download prices a library of runs
    /// carrying power beside strength sessions carrying a heart rate, of the
    /// same length.
    ///
    /// Expected behaviour: each activity is priced by the requested series its
    /// stored body lists and the samples it holds, so the run costs at least
    /// three times the session; a body that lists nothing requested, or no
    /// body at all, falls back to the flat rate rather than to nothing.
    #[test]
    fn the_estimate_prices_each_activity_by_the_series_it_lists() {
        use crate::net::stream_backfill::WIRE_BYTES_PER_MOVING_SECOND;
        let flat = 3000 * WIRE_BYTES_PER_MOVING_SECOND;
        let power = priced_alone(
            3000,
            Some(
                r#"{"stream_types":["time","distance","latlng","velocity_smooth","heartrate",
                    "watts","altitude","fixed_altitude","cadence","grade_smooth","temp",
                    "w_bal","respiration"]}"#,
            ),
        );
        let strength = priced_alone(
            3000,
            Some(r#"{"stream_types":["time","heartrate","temp"]}"#),
        );

        assert!(strength > 0);
        assert!(
            power >= 3 * strength,
            "twelve requested series priced {power}, three priced {strength}"
        );
        assert_eq!(priced_alone(3000, None), flat, "no body");
        assert_eq!(priced_alone(3000, Some("{}")), flat, "no list");
        assert_eq!(
            priced_alone(3000, Some(r#"{"stream_types":["respiration"]}"#)),
            flat,
            "a list naming nothing requested"
        );
        assert_eq!(priced_alone(3000, Some("not json")), flat, "a garbled body");
    }

    /// Scenario: two runs of the same length and series, one recorded every
    /// second and one with smart recording.
    ///
    /// Expected behaviour: the price follows the samples the track holds, so
    /// the run with a third of the samples costs a third as much.
    #[test]
    fn the_estimate_prices_the_samples_the_track_holds() {
        let body = r#"{"stream_types":["time","latlng","heartrate","altitude"]}"#;
        let every_second = priced_alone(3000, Some(body));
        let smart = priced_alone(1000, Some(body));

        assert_eq!(every_second, 3 * smart);
    }

    /// Scenario: a recorded ride with a track is saved under a `local-` key
    /// and has not uploaded.
    ///
    /// Expected behaviour: the queue and its count leave it out until an
    /// intervals id is recorded for it.
    #[test]
    fn a_local_recording_with_no_server_id_is_not_in_the_stream_queue() {
        let (_dir, engine) = engine();
        for id in ["i1", "local-unsent", "local-sent"] {
            activity_aged(&engine, id, 10);
            track(&engine, id, 10);
        }
        engine
            .db
            .execute(
                "UPDATE activities SET intervals_id = 'i2' WHERE id = 'local-sent'",
                [],
            )
            .unwrap();

        let queue = engine.activities_missing_streams(3).unwrap();

        let mut ids: Vec<&str> = queue.iter().map(|g| g.activity_id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["i1", "local-sent"]);
        assert_eq!(engine.stream_backfill_remaining(3).unwrap(), 2);
    }

    /// The queue is derived, so a pass that stored half its batch and died
    /// resumes on what is left rather than starting over.
    #[test]
    fn a_stored_activity_leaves_the_queue_without_any_bookkeeping() {
        let (_dir, engine) = engine();
        for id in ["a", "b"] {
            activity_aged(&engine, id, 400);
            track(&engine, id, 10);
        }
        assert_eq!(engine.stream_backfill_remaining(3).unwrap(), 2);

        engine
            .store_activity_streams("a", &[series("heartrate", &[Some(120.0)])])
            .unwrap();

        let queue = engine.activities_missing_streams(3).unwrap();
        assert_eq!(
            queue
                .iter()
                .map(|g| g.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["b"],
            "the stored activity is out of the queue, the other is still in it"
        );
    }

    #[test]
    fn counting_the_stream_queue_does_not_sort_but_reading_it_does() {
        let (_dir, engine) = engine();
        let plan = |sql: String| {
            let mut stmt = engine
                .db
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepares");
            let rows = stmt
                .query_map(params![3, 90], |row| row.get::<_, String>(3))
                .expect("plan reads")
                .collect::<SqlResult<Vec<String>>>()
                .expect("rows read");
            rows.join(" | ")
        };

        let count = plan(stream_gap_count_sql());
        let queue = plan(stream_gap_queue_sql());

        assert!(!count.contains("TEMP B-TREE"), "the count sorts: {count}");
        assert!(
            queue.contains("TEMP B-TREE"),
            "the queue lost its order: {queue}"
        );
    }

    #[test]
    fn test_backfill_remaining_attempt_retention_edges() {
        let (_dir, engine) = engine();
        for (id, start_date) in [
            ("recent", 4_000_000_000i64),
            ("old", 0),
            ("stocked", 4_000_000_000),
            ("retired", 4_000_000_000),
        ] {
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                     VALUES (?1, 'Ride', 0, 0, 0, 0, ?2)",
                    params![id, start_date],
                )
                .expect("activity");
            track(&engine, id, 10);
        }
        engine
            .store_activity_streams("stocked", &[series("watts", &[Some(1.0)])])
            .expect("stocked stream");
        for _ in 0..3 {
            engine
                .record_stream_backfill_attempt("retired")
                .expect("attempt");
        }

        for days in [0, 90] {
            engine.set_stream_retention_days(days).expect("retention");
            for limit in [0, 3, 4] {
                assert_eq!(
                    pooled::backfill_remaining(&engine.db, limit).expect("count"),
                    engine
                        .activities_missing_streams(limit)
                        .expect("queue")
                        .len(),
                    "retention {days}, attempt limit {limit}"
                );
            }
        }
    }

    /// An athlete who narrowed the window is asking for less on disk, so the
    /// backfill must not download what the prune would delete on arrival.
    #[test]
    fn a_narrow_window_backfills_nothing_outside_it() {
        let (_dir, engine) = engine();
        activity_aged(&engine, "recent", 10);
        track(&engine, "recent", 10);
        activity_aged(&engine, "ancient", 400);
        track(&engine, "ancient", 10);
        engine.set_stream_retention_days(90).unwrap();

        let queue = engine.activities_missing_streams(3).unwrap();

        assert_eq!(
            queue
                .iter()
                .map(|g| g.activity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["recent"]
        );
    }

    /// An undated activity is widened by the sync only when the window is
    /// unbounded. The queue applies the same rule, or the backfill would
    /// download series the prune leaves alone but the sync never asked for.
    #[test]
    fn an_undated_activity_follows_the_same_rule_the_sync_widens_by() {
        let (_dir, engine) = engine();
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES ('undated', 'Ride', 0, 0, 0, 0)",
                [],
            )
            .unwrap();
        track(&engine, "undated", 10);

        assert_eq!(
            engine.stream_backfill_remaining(3).unwrap(),
            1,
            "unbounded window: the sync widens for it, so the backfill asks"
        );

        engine.set_stream_retention_days(90).unwrap();

        assert_eq!(
            engine.stream_backfill_remaining(3).unwrap(),
            0,
            "a window the activity's date cannot be checked against excludes it"
        );
    }

    /// Scenario: a ride recorded with no sensors carries no series beyond the
    /// track, so every pass asks about it, stores nothing, and offers it again.
    ///
    /// Expected behaviour: the asks are counted and the activity retires, so a
    /// library of such rides lets a pass end rather than never draining.
    #[test]
    fn an_activity_upstream_never_answers_for_retires_out_of_the_queue() {
        let (_dir, engine) = engine();
        activity_aged(&engine, "sensorless", 400);
        track(&engine, "sensorless", 10);

        for _ in 0..3 {
            assert_eq!(engine.stream_backfill_remaining(3).unwrap(), 1);
            engine.record_stream_backfill_attempt("sensorless").unwrap();
        }

        assert_eq!(
            engine.stream_backfill_remaining(3).unwrap(),
            0,
            "three asks that settled nothing is upstream's position, not a bad afternoon"
        );
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

    /// Scenario: the bulk sync decides per activity whether to download every
    /// series or only the three the track needs.
    ///
    /// Expected behaviour: inside the window it widens, outside it does not,
    /// and an activity whose date the caller does not know is treated as
    /// outside. Widening on a guess is how a first sync downloads thirteen
    /// series apiece and hands twelve of them to the prune.
    #[test]
    fn the_window_decides_which_activities_the_sync_widens_for() {
        let (_dir, engine) = engine();
        engine.set_stream_retention_days(90).unwrap();
        let now = chrono::Utc::now().timestamp();

        assert!(engine.inside_stream_window(Some(now - 10 * 86_400)));
        assert!(!engine.inside_stream_window(Some(now - 200 * 86_400)));
        assert!(!engine.inside_stream_window(None));
    }

    #[test]
    fn a_window_opened_all_the_way_widens_for_everything_including_an_unknown_date() {
        let (_dir, engine) = engine();
        engine.set_stream_retention_days(0).unwrap();

        assert!(engine.inside_stream_window(Some(0)));
        assert!(engine.inside_stream_window(None));
    }

    /// The boundary belongs inside the window, so an activity exactly at the
    /// retention age is still widened rather than falling through the gap
    /// between "kept" and "downloaded".
    #[test]
    fn the_edge_of_the_window_is_inside_it() {
        let (_dir, engine) = engine();
        // The default keeps everything, so this needs a window of its own.
        engine.set_stream_retention_days(90).unwrap();
        let now = chrono::Utc::now().timestamp();
        let edge = now - 90 * 86_400;

        assert!(engine.inside_stream_window(Some(edge + 1)));
        assert!(!engine.inside_stream_window(Some(edge - 1)));
    }

    /// Scenario: the athlete opens an activity whose `latlng` carries a null
    /// sample. The sync path masks those samples out before storing, so every
    /// stored series shares the index space the track is stored in, and the
    /// detail screen's `set_stream_body` writes over the same rows.
    ///
    /// Expected behaviour: both writers store the same thing. A row written by
    /// the detail screen in the server's index space is offset from the track
    /// by the number of dropped samples, and every lap slice over it is wrong
    /// by that much, silently.
    #[test]
    fn the_detail_screen_stores_the_same_index_space_the_sync_does() {
        let (_dir, engine) = engine();
        let body = serde_json::json!([
            {"type": "latlng",
             "data": [46.1, null, 46.3],
             "data2": [7.1, null, 7.3]},
            {"type": "watts", "data": [100, 200, 300]},
        ])
        .to_string();

        engine.set_stream_body("a1", "watts", &body).unwrap();

        let stored: (Vec<u8>, i64) = engine
            .db
            .query_row(
                "SELECT data, sample_count FROM activity_streams
                 WHERE activity_id = 'a1' AND kind = 'watts'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("the detail screen stored a watts row");

        let response: Vec<StreamDto> = serde_json::from_str(&body).unwrap();
        engine
            .store_activity_streams("a2", &crate::net::types::storable_series(&response))
            .unwrap();
        let synced: (Vec<u8>, i64) = engine
            .db
            .query_row(
                "SELECT data, sample_count FROM activity_streams
                 WHERE activity_id = 'a2' AND kind = 'watts'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("the sync stored a watts row");

        assert_eq!(
            stored.1, 2,
            "the null coordinate must take its sample with it"
        );
        assert_eq!(
            stored, synced,
            "the two writers disagree about what is stored"
        );
    }

    /// A series that does not fit the coordinates is not storable at all, and
    /// a writer that trusts its caller stores it anyway.
    #[test]
    fn a_series_that_does_not_fit_the_coordinates_is_refused() {
        let (_dir, engine) = engine();
        let body = serde_json::json!([
            {"type": "latlng", "data": [46.1, 46.2, 46.3], "data2": [7.1, 7.2, 7.3]},
            {"type": "watts", "data": [100, 200]},
        ])
        .to_string();

        engine.set_stream_body("a1", "watts", &body).unwrap();

        let rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM activity_streams
                 WHERE activity_id = 'a1' AND kind = 'watts'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0, "a misaligned series must not be stored");
    }

    /// Scenario: an in-window activity is synced, so its response carried
    /// every series and the storing loop put the extra ones away.
    ///
    /// Expected behaviour: a later read of power and heart rate is served
    /// from the store, with no fetch and no body cached for it.
    #[test]
    fn a_wide_sync_leaves_power_and_heart_rate_readable_without_a_fetch() {
        let (_dir, engine) = engine();
        let response = vec![
            StreamDto {
                kind: "latlng".into(),
                data: vec![Some(46.1), None, Some(46.3)],
                data2: Some(vec![Some(7.1), None, Some(7.3)]),
            },
            series("watts", &[Some(100.0), Some(200.0), Some(300.0)]),
            series("heartrate", &[Some(140.0), Some(150.0), Some(160.0)]),
        ];

        engine
            .store_activity_streams("a1", &crate::net::types::storable_series(&response))
            .unwrap();

        let body = engine
            .read_stream_body("a1", "watts,heartrate")
            .unwrap()
            .expect("the store answers the selection");
        let served: Vec<StreamDto> = serde_json::from_str(&body).unwrap();

        // The dropped coordinate takes its samples with it, so the stored
        // series are in the index space the track is stored in.
        assert_eq!(
            served
                .iter()
                .find(|s| s.kind == "watts")
                .map(|s| s.data.clone()),
            Some(vec![Some(100.0), Some(300.0)])
        );
        assert_eq!(
            served
                .iter()
                .find(|s| s.kind == "heartrate")
                .map(|s| s.data.clone()),
            Some(vec![Some(140.0), Some(160.0)])
        );
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
    fn the_default_window_keeps_everything() {
        let (_dir, engine) = engine();
        assert_eq!(
            engine.stream_retention_days(),
            DEFAULT_STREAM_RETENTION_DAYS
        );
        assert_eq!(engine.stream_retention_days(), None);
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
    fn a_window_nobody_can_read_falls_back_to_the_default() {
        let (_dir, engine) = engine();
        for bad in ["", "  ", "not a number", "-5"] {
            engine.set_setting(STREAM_RETENTION_DAYS_KEY, bad).unwrap();
            assert_eq!(
                engine.stream_retention_days(),
                DEFAULT_STREAM_RETENTION_DAYS,
                "a window of {bad:?} should read as the default"
            );
        }
    }

    #[test]
    fn the_window_evicts_oldest_first_and_keeps_the_newest() {
        let (_dir, engine) = engine();
        engine.set_stream_retention_days(90).unwrap();
        activity_aged(&engine, "recent", 10);
        activity_aged(&engine, "edge", 80);
        activity_aged(&engine, "old", 200);
        for id in ["recent", "edge", "old"] {
            engine
                .store_activity_streams(id, &[series("watts", &[Some(1.0)])])
                .unwrap();
        }

        // The 90-day window already dropped the 200-day activity on write.
        assert!(engine.stored_stream_kinds("old").unwrap().is_empty());
        assert!(!engine.stored_stream_kinds("edge").unwrap().is_empty());
        assert!(!engine.stored_stream_kinds("recent").unwrap().is_empty());

        // Shrinking it takes the next oldest and leaves the newest alone.
        engine.set_stream_retention_days(30).unwrap();
        assert!(engine.stored_stream_kinds("edge").unwrap().is_empty());
        assert!(!engine.stored_stream_kinds("recent").unwrap().is_empty());
    }

    /// Scenario: the detail screen's fetch writes an out-of-window activity's
    /// series through `write_activity_streams`, whose own prune then deletes
    /// them before the call returns.
    ///
    /// Expected behaviour: the durable store holds nothing for it, which is
    /// the window doing its job, and the screen is still served from the
    /// cached body rather than showing a gap.
    #[test]
    fn opening_an_old_activity_does_not_stock_the_durable_store() {
        let (_dir, engine) = engine();
        engine.set_stream_retention_days(90).unwrap();
        activity_aged(&engine, "old", 400);
        let body = r#"[{"type":"heartrate","data":[140.0,142.0]}]"#;

        engine.set_stream_body("old", "heartrate", body).unwrap();

        assert!(engine.stored_stream_kinds("old").unwrap().is_empty());
        assert_eq!(
            engine
                .read_stream_body("old", "heartrate")
                .unwrap()
                .as_deref(),
            Some(body)
        );
    }

    /// The same fetch for an activity inside the window does stock it, so the
    /// test above is measuring the window and not a broken write path.
    #[test]
    fn opening_a_recent_activity_stocks_the_durable_store() {
        let (_dir, engine) = engine();
        activity_aged(&engine, "recent", 10);

        engine
            .set_stream_body(
                "recent",
                "heartrate",
                r#"[{"type":"heartrate","data":[140.0]}]"#,
            )
            .unwrap();

        assert_eq!(
            engine.stored_stream_kinds("recent").unwrap(),
            vec!["heartrate"]
        );
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

    /// A body's series were written one autocommit each, so four series was
    /// four fsyncs under the engine lock and the prune a fifth.
    #[test]
    fn a_body_of_series_is_one_commit() {
        let (_dir, engine) = engine();
        let commits = super::super::commit_counter::watch(&engine);

        engine
            .store_activity_streams(
                "a1",
                &[
                    series("watts", &[Some(100.0), Some(200.0)]),
                    series("heartrate", &[Some(140.0), Some(150.0)]),
                    series("cadence", &[Some(80.0), Some(82.0)]),
                    series("velocity_smooth", &[Some(8.0), Some(8.5)]),
                ],
            )
            .unwrap();

        assert_eq!(super::super::commit_counter::count(&commits), 1);
        assert_eq!(engine.stored_stream_kinds("a1").unwrap().len(), 4);
    }

    #[test]
    fn a_second_write_of_the_same_body_is_one_commit() {
        let (_dir, engine) = engine();
        let body = [
            series("watts", &[Some(100.0), Some(200.0)]),
            series("heartrate", &[Some(140.0), Some(150.0)]),
        ];
        engine.store_activity_streams("a1", &body).unwrap();

        let commits = super::super::commit_counter::watch(&engine);
        engine.store_activity_streams("a1", &body).unwrap();

        assert_eq!(super::super::commit_counter::count(&commits), 1);
    }

    /// Nothing to write is still one prune per call, never one per skipped
    /// series.
    #[test]
    fn a_body_with_nothing_storable_is_one_commit_per_call() {
        let (_dir, engine) = engine();
        let commits = super::super::commit_counter::watch(&engine);

        engine.store_activity_streams("a1", &[]).unwrap();
        engine
            .store_activity_streams(
                "a1",
                &[
                    series("latlng", &[Some(1.0)]),
                    series("altitude", &[Some(2.0)]),
                    series("watts", &[]),
                ],
            )
            .unwrap();

        assert_eq!(super::super::commit_counter::count(&commits), 2);
        assert!(engine.stored_stream_kinds("a1").unwrap().is_empty());
    }

    /// A failing row rolls the whole call back rather than leaving the ones
    /// before it committed.
    #[test]
    fn a_failed_write_leaves_no_series_behind() {
        let (_dir, engine) = engine();
        engine
            .db
            .execute_batch("DROP TABLE activity_streams")
            .unwrap();

        let err = engine.store_activity_streams(
            "a1",
            &[
                series("watts", &[Some(100.0)]),
                series("heartrate", &[Some(140.0)]),
            ],
        );

        assert!(err.is_err());
        // The rollback ran, so the connection is not left inside a
        // transaction and the next writer can begin its own.
        assert!(engine.db.is_autocommit());
    }
}
