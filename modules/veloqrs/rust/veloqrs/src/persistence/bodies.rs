//! Untyped intervals.icu payloads fetched on demand: power and pace curves,
//! activity intervals, and calendar events.
//!
//! Each is stored as the body the server sent, keyed by whatever parameters
//! produced it. The screens read fields no Rust type models, and a curve only
//! means anything alongside the sport, window and gap flag it was computed
//! for, so a typed row would be both lossy and ambiguous.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

use super::PersistentEngine;
use super::fitness::derivations::pooled::SYNC_PACE_WINDOW_DAYS;
use super::streams::FROM_THE_TRACK;

pub(crate) mod pooled {
    use super::*;

    pub(crate) fn stream_body(
        conn: &Connection,
        activity_id: &str,
        types: &str,
    ) -> SqlResult<(Option<String>, bool)> {
        let cached: Option<(String, Option<i64>)> = conn
            .query_row(
                "SELECT raw, updated_at FROM stream_bodies WHERE activity_id = ? AND types = ?",
                params![activity_id, types],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((raw, stamped)) = cached {
            let stale = stamped
                .is_none_or(|at| chrono::Utc::now().timestamp() - at >= STREAM_BODY_TOUCH_SECS);
            return Ok((Some(raw), stale));
        }
        Ok((reconstruct_stream_body(conn, activity_id, types), false))
    }

    pub(crate) fn reconstruct_stream_body(
        conn: &Connection,
        activity_id: &str,
        types: &str,
    ) -> Option<String> {
        let wanted: Vec<&str> = types.split(',').filter(|kind| !kind.is_empty()).collect();
        if wanted.is_empty() {
            return None;
        }
        let stored = crate::persistence::streams::pooled::activity_streams(conn, activity_id)
            .unwrap_or_default();
        let available = |kind: &&str| {
            FROM_THE_TRACK.contains(kind) || stored.iter().any(|item| &item.kind.as_str() == kind)
        };
        if !wanted.iter().all(available) {
            return None;
        }
        let items = if wanted.iter().any(|kind| FROM_THE_TRACK.contains(kind)) {
            let points = crate::persistence::activities::pooled::gps_track(conn, activity_id)?;
            if points.is_empty() {
                return None;
            }
            let mut items = track_series(&points, &wanted);
            append_time_series(conn, activity_id, points.len(), &wanted, &mut items);
            append_stored_series(activity_id, points.len(), &wanted, &stored, &mut items)?;
            items
        } else {
            wanted
                .iter()
                .filter_map(|kind| {
                    stored
                        .iter()
                        .find(|item| &item.kind.as_str() == kind)
                        .cloned()
                })
                .collect()
        };
        serde_json::to_string(&items).ok()
    }

    fn track_series(
        points: &[crate::GpsPoint],
        wanted: &[&str],
    ) -> Vec<crate::net::types::StreamDto> {
        let mut items = Vec::new();
        if wanted.contains(&"latlng") {
            items.push(crate::net::types::StreamDto {
                kind: "latlng".to_string(),
                data: points.iter().map(|point| Some(point.latitude)).collect(),
                data2: Some(points.iter().map(|point| Some(point.longitude)).collect()),
            });
        }
        // A point does not record which altitude form the ingest preferred.
        if (wanted.contains(&"altitude") || wanted.contains(&"fixed_altitude"))
            && points.iter().any(|point| point.elevation.is_some())
        {
            items.push(crate::net::types::StreamDto {
                kind: "altitude".to_string(),
                data: points.iter().map(|point| point.elevation).collect(),
                data2: None,
            });
        }
        items
    }

    fn append_time_series(
        conn: &Connection,
        activity_id: &str,
        point_count: usize,
        wanted: &[&str],
        items: &mut Vec<crate::net::types::StreamDto>,
    ) {
        if !wanted.contains(&"time") {
            return;
        }
        let Some(times) = crate::persistence::activities::pooled::time_stream(conn, activity_id)
        else {
            return;
        };
        if times.len() != point_count {
            log::warn!(
                "[Streams] {} series time carries {} samples against {} track points, no scrubber",
                activity_id,
                times.len(),
                point_count
            );
            return;
        }
        items.push(crate::net::types::StreamDto {
            kind: "time".to_string(),
            data: times.iter().map(|time| Some(f64::from(*time))).collect(),
            data2: None,
        });
    }

    fn append_stored_series(
        activity_id: &str,
        point_count: usize,
        wanted: &[&str],
        stored: &[crate::net::types::StreamDto],
        items: &mut Vec<crate::net::types::StreamDto>,
    ) -> Option<()> {
        for kind in wanted {
            if FROM_THE_TRACK.contains(kind) {
                continue;
            }
            let item = stored.iter().find(|item| &item.kind.as_str() == kind)?;
            if item.data.len() != point_count {
                log::warn!(
                    "[Streams] {} series {} carries {} samples against {} track points, selection not served",
                    activity_id,
                    kind,
                    item.data.len(),
                    point_count
                );
                return None;
            }
            items.push(item.clone());
        }
        Some(())
    }

    pub(crate) fn interval_body(conn: &Connection, activity_id: &str) -> SqlResult<Option<String>> {
        conn.query_row(
            "SELECT raw FROM interval_bodies WHERE activity_id = ?",
            params![activity_id],
            |row| row.get(0),
        )
        .optional()
    }

    /// The stored curve with the time it was fetched, or `None` when that
    /// combination has never been fetched.
    pub(crate) fn stored_curve(
        conn: &Connection,
        kind: CurveKind,
        sport: &str,
        days: i64,
        gap: bool,
    ) -> SqlResult<Option<FfiStoredCurve>> {
        conn.query_row(
            "SELECT raw, updated_at FROM curve_bodies
                 WHERE kind = ? AND sport = ? AND days = ? AND gap = ?",
            params![kind.as_str(), sport, days, gap as i64],
            |row| {
                Ok(FfiStoredCurve {
                    raw: row.get(0)?,
                    fetched_at: row.get(1)?,
                })
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
    }

    /// Calendar event bodies over an inclusive window, oldest first.
    pub(crate) fn calendar_event_bodies(
        conn: &Connection,
        oldest_ts: i64,
        newest_ts: i64,
    ) -> SqlResult<Vec<String>> {
        let mut stmt = conn.prepare(
            "SELECT raw FROM calendar_event_bodies
             WHERE date >= ? AND date <= ?
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map(params![oldest_ts, newest_ts], |r| r.get::<_, String>(0))?;
        rows.collect()
    }
}

#[cfg(test)]
#[path = "tests/bodies_pooled.rs"]
mod pooled_tests;

/// Which curve a body belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurveKind {
    Power,
    Pace,
}

impl CurveKind {
    fn as_str(self) -> &'static str {
        match self {
            CurveKind::Power => "power",
            CurveKind::Pace => "pace",
        }
    }
}

/// A stored curve and when it was fetched.
///
/// The two travel together because a curve drawn offline says nothing about
/// its own age, and reading the time as a second call would be a second FFI
/// hop on a screen that already makes one per mount.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStoredCurve {
    /// The body the server sent, unparsed.
    pub raw: String,
    /// Epoch seconds at the fetch that stored it.
    pub fetched_at: f64,
}

/// The bodies an activity still lacks, as `newest_activities_owing_bodies`
/// reports them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BodiesOwed {
    pub activity_id: String,
    pub detail: bool,
    pub streams: bool,
    pub intervals: bool,
    /// A cached full stream body carries GPS but no durable track is stored,
    /// so the body is held and still has to be ingested.
    pub track: bool,
    /// The activity's sport, which the track stored with its streams is filed under.
    pub sport_type: String,
}

impl PersistentEngine {
    /// Store a curve body under the parameters that produced it.
    pub fn set_curve_body(
        &self,
        kind: CurveKind,
        sport: &str,
        days: i64,
        gap: bool,
        raw: &str,
    ) -> SqlResult<()> {
        let transaction = self.db.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO curve_bodies (kind, sport, days, gap, raw, updated_at)
             VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
             ON CONFLICT(kind, sport, days, gap) DO UPDATE SET
                raw = excluded.raw,
                updated_at = excluded.updated_at",
            params![kind.as_str(), sport, days, gap as i64, raw],
        )?;
        if kind == CurveKind::Pace
            && days == SYNC_PACE_WINDOW_DAYS
            && !gap
            && matches!(sport, "Run" | "Swim")
            && let Some((date, speed, d_prime, r2)) = pace_snapshot(raw, sport)
        {
            transaction.execute(
                "INSERT OR REPLACE INTO pace_history
                 (date, sport_type, critical_speed, d_prime, r2, window_days)
                 VALUES (?, ?, ?, ?, ?, ?)",
                params![date, sport, speed, d_prime, r2, days],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// The stored curve with the time it was fetched, or `None` when that
    /// combination has never been fetched. Callers treat `None` as "ask for
    /// it", not as "no data".
    ///
    /// Keyed by kind, sport, window and gap flag: a curve only means anything
    /// alongside the ones it was computed for, and so does its age.
    pub fn get_stored_curve(
        &self,
        kind: CurveKind,
        sport: &str,
        days: i64,
        gap: bool,
    ) -> SqlResult<Option<FfiStoredCurve>> {
        pooled::stored_curve(&self.db, kind, sport, days, gap)
    }

    /// Store an activity's interval body.
    pub fn set_interval_body(&self, activity_id: &str, raw: &str) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO interval_bodies (activity_id, raw, updated_at)
             VALUES (?, ?, strftime('%s', 'now'))
             ON CONFLICT(activity_id) DO UPDATE SET
                raw = excluded.raw,
                updated_at = excluded.updated_at",
            params![activity_id, raw],
        )?;
        Ok(())
    }

    /// An activity's stored interval body, or `None` if never fetched.
    pub fn get_interval_body(&self, activity_id: &str) -> SqlResult<Option<String>> {
        pooled::interval_body(&self.db, activity_id)
    }

    /// Every activity in the library with no interval body, newest first, except a
    /// device-minted key no upload has given a server id: upstream has no such
    /// activity to ask for.
    ///
    /// The sync's prefetch queue, derived rather than stored: an id that was
    /// fetched has a row and leaves the queue, so a killed pass resumes by
    /// re-deriving the same list and needs no checkpoint.
    pub fn activities_missing_interval_bodies(&self) -> SqlResult<Vec<String>> {
        let mut stmt = self.db.prepare(
            "SELECT m.activity_id FROM activity_metrics m
             LEFT JOIN interval_bodies b ON b.activity_id = m.activity_id
             WHERE b.activity_id IS NULL
               AND (m.activity_id NOT LIKE 'local-%'
                    OR EXISTS (SELECT 1 FROM activities a
                               WHERE a.id = m.activity_id AND a.intervals_id IS NOT NULL)
                    OR EXISTS (SELECT 1 FROM activity_bodies ab
                               WHERE ab.activity_id = m.activity_id
                                 AND ab.intervals_id IS NOT NULL))
             ORDER BY m.date DESC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    /// What each of the newest `limit` activities still lacks for a screen that
    /// opens with no network: the detail body, the detail stream set and the
    /// interval body. Newest first, and an activity with nothing owed is left
    /// out.
    ///
    /// The detail form is told from the list form by `icu_athlete_id`, the key
    /// only `GET /activity/{id}` carries. The stream set is answered by
    /// [`Self::read_stream_body`], so one the track and series stores can
    /// rebuild whole is not fetched again. A cached stream body that carries a
    /// `latlng` series while `gps_tracks` has no row for the activity is owed
    /// its ingestion, since the raw body cache evicts and the track must not
    /// depend on it.
    pub fn newest_activities_owing_bodies(
        &self,
        limit: usize,
        stream_types: &str,
    ) -> SqlResult<Vec<BodiesOwed>> {
        let mut stmt = self.db.prepare(
            "SELECT m.activity_id,
                    NOT EXISTS (SELECT 1 FROM activity_bodies b
                                 WHERE b.activity_id = m.activity_id
                                   AND json_valid(b.raw)
                                   AND COALESCE(json_extract(b.raw, '$.icu_athlete_id'), '') != ''),
                    NOT EXISTS (SELECT 1 FROM interval_bodies i
                                 WHERE i.activity_id = m.activity_id),
                    m.sport_type,
                    EXISTS (SELECT 1 FROM stream_bodies s
                             WHERE s.activity_id = m.activity_id
                               AND s.types = ?1
                               AND instr(s.raw, '\"latlng\"') > 0)
                    AND NOT EXISTS (SELECT 1 FROM gps_tracks g
                                     WHERE g.activity_id = m.activity_id)
               FROM activity_metrics m
              ORDER BY m.date DESC, m.activity_id
              LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![stream_types, limit as i64], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, bool>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, bool>(4)?,
                ))
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        let mut owed = Vec::new();
        for (activity_id, detail, intervals, sport_type, cached_gps) in rows {
            let streams = self.read_stream_body(&activity_id, stream_types)?.is_none();
            let track = cached_gps && !streams;
            if detail || streams || intervals || track {
                owed.push(BodiesOwed {
                    activity_id,
                    detail,
                    streams,
                    intervals,
                    track,
                    sport_type,
                });
            }
        }
        Ok(owed)
    }

    /// Replace the calendar events in a window. Events are deleted upstream as
    /// well as added, so the window is cleared first: an upsert alone would
    /// leave a cancelled workout on the calendar forever.
    pub fn replace_calendar_events(
        &mut self,
        oldest_ts: i64,
        newest_ts: i64,
        rows: &[(String, i64, String)],
    ) -> SqlResult<()> {
        let tx = self.db.transaction()?;
        tx.execute(
            "DELETE FROM calendar_event_bodies WHERE date >= ? AND date <= ?",
            params![oldest_ts, newest_ts],
        )?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO calendar_event_bodies (event_id, date, raw, updated_at)
                 VALUES (?, ?, ?, strftime('%s', 'now'))
                 ON CONFLICT(event_id) DO UPDATE SET
                    date = excluded.date,
                    raw = excluded.raw,
                    updated_at = excluded.updated_at",
            )?;
            for (event_id, date, raw) in rows {
                stmt.execute(params![event_id, date, raw])?;
            }
        }
        tx.commit()
    }

    /// Calendar event bodies over an inclusive window, oldest first.
    pub fn get_calendar_event_bodies(
        &self,
        oldest_ts: i64,
        newest_ts: i64,
    ) -> SqlResult<Vec<String>> {
        pooled::calendar_event_bodies(&self.db, oldest_ts, newest_ts)
    }
}

fn pace_snapshot(raw: &str, sport: &str) -> Option<(i64, f64, Option<f64>, Option<f64>)> {
    let curve = super::curves::parse_pace_curve(raw, sport, 0)?;
    let speed = curve.critical_speed.filter(|speed| *speed > 0.0)?;
    let end = curve.end_date.as_deref()?.get(..10)?;
    let date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
        .ok()?
        .and_hms_opt(0, 0, 0)?
        .and_utc()
        .timestamp();
    Some((date, speed, curve.d_prime, curve.r2))
}

/// How much raw payload to keep, in bytes rather than rows: fifty rows is
/// 5 MB of one athlete's streams and 25 MB of another's, so a row count is not
/// a ceiling. The durable series behind these bodies live in
/// `activity_streams` and are sized by the athlete instead, which is what lets
/// this stay small: it is a hot cache of exactly what the server sent, not the
/// history.
const MAX_STREAM_BODY_BYTES: i64 = 8 * 1024 * 1024;

/// How stale a cache hit's stamp has to be before the read moves it to the
/// front of the eviction order.
///
/// The stamp is what makes the ceiling an LRU, but stamping on every hit makes
/// a read an autocommit write: it needs the engine's write lock and rewrites
/// `idx_stream_bodies_updated`, on the activity-open path and once a scrub
/// frame. An hour is coarse enough that a screen reading the same
/// body repeatedly writes once, and fine enough that the eviction order still
/// reflects which activities the athlete actually opens.
const STREAM_BODY_TOUCH_SECS: i64 = 3600;

impl PersistentEngine {
    /// Store a stream payload for an activity and series selection.
    ///
    /// The body goes in the cache and its series go in the durable store, so a
    /// payload evicted from here is still answerable from the device. A body
    /// that will not parse is still cached: it is what the server sent, and
    /// refusing to cache it would refetch it on every open.
    pub fn set_stream_body(&self, activity_id: &str, types: &str, raw: &str) -> SqlResult<()> {
        // One transaction for the body, the series it parses into and the two
        // sweeps that follow. Each was its own autocommit, so one activity's
        // streams cost six fsyncs under the engine lock.
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match self.write_stream_body(activity_id, types, raw) {
            Ok(()) => super::commit_write_txn(&self.db)?,
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
        Ok(())
    }

    fn write_stream_body(&self, activity_id: &str, types: &str, raw: &str) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO stream_bodies (activity_id, types, raw, updated_at)
             VALUES (?, ?, ?, strftime('%s', 'now'))
             ON CONFLICT(activity_id, types) DO UPDATE SET
                raw = excluded.raw,
                updated_at = excluded.updated_at",
            params![activity_id, types, raw],
        )?;
        match serde_json::from_str::<Vec<crate::net::types::StreamDto>>(raw) {
            // A body carrying coordinates goes through the same mask the sync
            // uses, or this writer stores the server's index space over rows
            // the track addresses. A body without them carries no mask
            // to apply, and `storable_series` answers empty for one, so it is
            // stored as it arrived.
            Ok(parsed) => {
                let masked;
                let to_store = if parsed.iter().any(|s| s.kind == "latlng") {
                    masked = crate::net::types::storable_series(&parsed);
                    &masked
                } else {
                    &parsed
                };
                self.write_activity_streams(activity_id, to_store)?;
            }
            Err(e) => log::warn!(
                "veloqrs: [Streams] {} body for {} did not parse, caching it unstored: {}",
                types,
                activity_id,
                e
            ),
        }
        self.trim_stream_bodies_to_budget()?;
        Ok(())
    }

    /// Drop least recently used bodies until the cache is inside its byte
    /// budget, always keeping the most recent one. A single payload larger than
    /// the whole budget would otherwise delete itself the moment it was
    /// written, and the activity it belongs to would refetch forever.
    fn trim_stream_bodies_to_budget(&self) -> SqlResult<()> {
        self.db.execute(
            "DELETE FROM stream_bodies WHERE rowid IN (
                 SELECT rowid FROM (
                     SELECT rowid,
                            SUM(LENGTH(raw)) OVER (
                                ORDER BY updated_at DESC, rowid DESC
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                            ) AS running,
                            ROW_NUMBER() OVER (ORDER BY updated_at DESC, rowid DESC) AS rank
                     FROM stream_bodies
                 )
                 WHERE running > ? AND rank > 1
             )",
            params![MAX_STREAM_BODY_BYTES],
        )?;
        Ok(())
    }

    /// The read order for a series selection: the cached server body first,
    /// then a reconstruction from what the device already holds, which is the
    /// track, its time stream and the durable series store. `None` means
    /// nothing on device can answer it, which is what makes the caller fetch.
    ///
    /// The reconstruction is not a second cache. It is the same data in the
    /// shape the charts read, so it is rebuilt per call and never written
    /// back: storing it would evict a real body to hold a copy of the track.
    pub fn read_stream_body(&self, activity_id: &str, types: &str) -> SqlResult<Option<String>> {
        if let Some(cached) = self.get_stream_body(activity_id, types)? {
            return Ok(Some(cached));
        }
        Ok(self.reconstruct_stream_body(activity_id, types))
    }

    /// Rebuild a stream body from `gps_tracks` and `time_streams`, or `None`
    /// when the selection asks for a series neither holds.
    ///
    /// Answering a selection only in part would be worse than answering none
    /// of it: the detail screen treats any body as "stocked" and stops
    /// fetching, so an athlete would lose their power and heart rate to a
    /// reconstruction that never had them. A selection is served whole or not
    /// at all.
    fn reconstruct_stream_body(&self, activity_id: &str, types: &str) -> Option<String> {
        pooled::reconstruct_stream_body(&self.db, activity_id, types)
    }

    /// A stored stream payload, or `None` when this activity and series
    /// selection has not been fetched or has aged out of the cache.
    ///
    /// A hit stamps `updated_at`, which is what makes the ceiling an LRU: an
    /// activity the athlete keeps opening outlives one fetched once and never
    /// looked at again. Without the stamp the order is write order, so the
    /// activity on screen is evicted while a stale neighbour survives.
    ///
    /// The stamp is only rewritten once the stored one is
    /// `STREAM_BODY_TOUCH_SECS` old, because the write is what costs: stamping
    /// every hit made a read need the engine's write lock and rewrite
    /// `idx_stream_bodies_updated`, once per activity open and once a scrub
    /// frame.
    pub fn get_stream_body(&self, activity_id: &str, types: &str) -> SqlResult<Option<String>> {
        // The stamp comes back with the payload, so deciding whether to touch
        // costs nothing beyond the read that was happening anyway.
        let hit: Option<(String, Option<i64>)> = self
            .db
            .query_row(
                "SELECT raw, updated_at FROM stream_bodies WHERE activity_id = ? AND types = ?",
                params![activity_id, types],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        let Some((raw, stamped)) = hit else {
            return Ok(None);
        };
        // A row with no stamp cannot be ordered, so it is touched to give it
        // one rather than left to sort as the oldest thing in the cache.
        let stale =
            stamped.is_none_or(|at| chrono::Utc::now().timestamp() - at >= STREAM_BODY_TOUCH_SECS);
        if stale {
            self.db.execute(
                "UPDATE stream_bodies SET updated_at = strftime('%s', 'now')
                 WHERE activity_id = ? AND types = ?",
                params![activity_id, types],
            )?;
        }
        Ok(Some(raw))
    }

    pub(crate) fn try_touch_stream_body(&self, activity_id: &str, types: &str) -> SqlResult<()> {
        self.db.busy_timeout(std::time::Duration::ZERO)?;
        let touched = self.db.execute(
            "UPDATE stream_bodies SET updated_at = strftime('%s', 'now')
             WHERE activity_id = ? AND types = ?
               AND (updated_at IS NULL OR updated_at <= strftime('%s', 'now') - ?)",
            params![activity_id, types, STREAM_BODY_TOUCH_SECS],
        );
        self.db.busy_timeout(std::time::Duration::from_secs(5))?;
        touched.map(|_| ())
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

    /// The stamp for one cached body, or None when the row is not there.
    fn stamp_of(engine: &PersistentEngine, activity_id: &str, types: &str) -> Option<i64> {
        engine
            .db
            .query_row(
                "SELECT updated_at FROM stream_bodies WHERE activity_id = ? AND types = ?",
                params![activity_id, types],
                |r| r.get(0),
            )
            .ok()
    }

    /// What a reconstructed stream body costs against a cached one, measured
    /// rather than estimated. The shape that matters is the one the activity
    /// screen opens with: a few thousand track points across five series.
    ///
    /// Ignored by default: it is a measurement, not an assertion.
    /// Run: `cargo test --release -p veloqrs --lib bodies::tests::what_a_reconstruction_costs -- --ignored --nocapture`
    #[test]
    #[ignore = "a measurement; run it deliberately"]
    fn what_a_reconstruction_costs_against_a_cached_body() {
        use crate::net::types::StreamDto;

        const TYPES: &str = "latlng,time,heartrate,watts,altitude";

        // `storable_series` masks the lot against the latlng index space, so
        // coordinates have to be real ones or the mask drops most of the track
        // and every other series is then refused as misaligned.
        fn series(kind: &str, points: usize) -> StreamDto {
            if kind == "latlng" {
                return StreamDto {
                    kind: kind.to_string(),
                    data: (0..points).map(|i| Some(46.0 + i as f64 * 1e-5)).collect(),
                    data2: Some((0..points).map(|i| Some(7.0 + i as f64 * 1e-5)).collect()),
                };
            }
            StreamDto {
                kind: kind.to_string(),
                data: (0..points).map(|i| Some(i as f64 * 1.5)).collect(),
                data2: None,
            }
        }

        println!("points  body_bytes  cached_ms  reconstructed_ms  ratio");
        for &points in &[1_000usize, 4_000, 10_000] {
            let (_dir, mut engine) = engine();
            // The reconstruction reads the track first, so the activity has to
            // be on disk before its series mean anything.
            engine
                .add_activity(
                    "a1".to_string(),
                    (0..points)
                        .map(|i| tracematch::GpsPoint {
                            latitude: 46.0 + i as f64 * 1e-5,
                            longitude: 7.0 + i as f64 * 1e-5,
                            elevation: Some(500.0 + i as f64 * 0.01),
                        })
                        .collect(),
                    "Ride".to_string(),
                )
                .expect("add_activity");
            // The ingest may simplify the track, and a series whose sample
            // count disagrees with the stored points is refused whole, so the
            // body is built at the length that actually landed.
            let stored_points = match engine.track("a1") {
                crate::persistence::codec::TrackRead::Present(p) => p.len(),
                _ => panic!("the track did not store"),
            };
            let body = serde_json::to_string(
                &["latlng", "time", "heartrate", "watts", "altitude"]
                    .iter()
                    .map(|k| series(k, stored_points))
                    .collect::<Vec<_>>(),
            )
            .expect("encode");

            // `set_stream_body` caches the body and writes the durable series
            // the reconstruction reads, so one call seeds both paths.
            engine.set_stream_body("a1", TYPES, &body).expect("seed");

            let cached = median_ms(|| {
                engine
                    .get_stream_body("a1", TYPES)
                    .expect("read")
                    .expect("cached")
                    .len()
            });
            let probe = engine.reconstruct_stream_body("a1", TYPES);
            assert!(
                probe.is_some(),
                "the reconstruction refused the selection at {stored_points} points"
            );
            let rebuilt = median_ms(|| {
                engine
                    .reconstruct_stream_body("a1", TYPES)
                    .map(|s| s.len())
                    .unwrap_or(0)
            });

            println!(
                "{stored_points:>6}  {:>10}  {cached:>9.2}  {rebuilt:>16.2}  {:>5.1}x",
                body.len(),
                rebuilt / cached.max(f64::MIN_POSITIVE)
            );
        }
    }

    /// Median of five, so one scheduling hiccup does not become the number.
    fn median_ms(mut run: impl FnMut() -> usize) -> f64 {
        let mut runs: Vec<f64> = (0..5)
            .map(|_| {
                let start = std::time::Instant::now();
                let n = run();
                assert!(n > 0, "the read answered nothing");
                start.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        runs.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
        runs[2]
    }

    /// Scenario: the activity screen reads a cached stream body, once a scrub
    /// frame.
    ///
    /// Expected behaviour: a read of a body already stamped inside the touch
    /// interval writes nothing. Stamping on every hit turns a read that could
    /// run on a pooled reader into an autocommit write that serialises with the
    /// sync, and rewrites `idx_stream_bodies_updated` with it.
    #[test]
    fn a_freshly_stamped_body_is_not_restamped_on_every_read() {
        let (_dir, engine) = engine();
        engine.set_stream_body("a1", "time", "body").unwrap();

        // A few minutes back, so it is well inside the interval but not the
        // same second `strftime('%s','now')` would write. Comparing against a
        // stamp taken this second proves nothing: the restamp lands on the
        // value it started from and the assertion holds either way.
        let fresh = chrono::Utc::now().timestamp() - 300;
        engine
            .db
            .execute(
                "UPDATE stream_bodies SET updated_at = ? WHERE activity_id = ? AND types = ?",
                params![fresh, "a1", "time"],
            )
            .unwrap();

        assert_eq!(
            engine.get_stream_body("a1", "time").unwrap().as_deref(),
            Some("body")
        );

        assert_eq!(
            stamp_of(&engine, "a1", "time"),
            Some(fresh),
            "the read restamped a body that was already inside the interval"
        );
    }

    /// Expected behaviour: the stamp is still what orders the eviction, so a
    /// read of a body older than the interval does move it to the front. The
    /// point of the interval is to stop the write, not to stop the LRU.
    #[test]
    fn a_stale_body_is_restamped_so_it_outlives_an_untouched_neighbour() {
        let (_dir, engine) = engine();
        engine.set_stream_body("a1", "time", "body").unwrap();
        let stale = chrono::Utc::now().timestamp() - STREAM_BODY_TOUCH_SECS - 60;
        engine
            .db
            .execute(
                "UPDATE stream_bodies SET updated_at = ? WHERE activity_id = ? AND types = ?",
                params![stale, "a1", "time"],
            )
            .unwrap();

        engine.get_stream_body("a1", "time").unwrap();

        let now = stamp_of(&engine, "a1", "time").expect("the body survived the read");
        assert!(
            now > stale,
            "a body outside the interval was not moved to the front: {now} is not past {stale}"
        );
    }

    #[test]
    fn a_stored_42_day_pace_body_records_the_curve_end_date() {
        let (_dir, engine) = engine();
        let body = r#"{"list":[{"end_date_local":"2026-08-20T18:30:00",
            "paceModels":[{"type":"CS","criticalSpeed":4.2,"dPrime":180,"r2":0.97}]}]}"#;

        for sport in ["Run", "Swim"] {
            engine
                .set_curve_body(CurveKind::Pace, sport, 42, false, body)
                .expect("store curve");
        }
        engine
            .set_curve_body(CurveKind::Pace, "Run", 42, false, body)
            .expect("store same curve again");

        for sport in ["Run", "Swim"] {
            let (count, date, speed, d_prime, r2): (i64, i64, f64, f64, f64) = engine
                .db
                .query_row(
                    "SELECT COUNT(*), date, critical_speed, d_prime, r2 FROM pace_history
                     WHERE sport_type = ? AND window_days = 42",
                    [sport],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    },
                )
                .expect("snapshot");
            assert_eq!(count, 1);
            assert_eq!(date, 1_787_184_000);
            assert_eq!((speed, d_prime, r2), (4.2, 180.0, 0.97));
            assert_eq!(engine.get_pace_trend(sport).latest_pace, Some(4.2));
        }
    }

    #[test]
    fn curve_bodies_are_keyed_by_every_parameter() {
        let (_dir, engine) = engine();

        engine
            .set_curve_body(CurveKind::Pace, "Run", 42, false, "plain")
            .unwrap();
        engine
            .set_curve_body(CurveKind::Pace, "Run", 42, true, "gap-adjusted")
            .unwrap();
        engine
            .set_curve_body(CurveKind::Power, "Ride", 42, false, "watts")
            .unwrap();

        // The gap flag and the kind each select a different body, so a screen
        // toggling GAP never reads the plain curve.
        assert_eq!(
            engine
                .get_stored_curve(CurveKind::Pace, "Run", 42, false)
                .unwrap()
                .map(|curve| curve.raw)
                .as_deref(),
            Some("plain")
        );
        assert_eq!(
            engine
                .get_stored_curve(CurveKind::Pace, "Run", 42, true)
                .unwrap()
                .map(|curve| curve.raw)
                .as_deref(),
            Some("gap-adjusted")
        );
        assert_eq!(
            engine
                .get_stored_curve(CurveKind::Power, "Ride", 42, false)
                .unwrap()
                .map(|curve| curve.raw)
                .as_deref(),
            Some("watts")
        );
        // A window that was never fetched reads as absent, not as empty data.
        assert!(
            engine
                .get_stored_curve(CurveKind::Pace, "Run", 90, false)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn refetching_a_curve_replaces_it() {
        let (_dir, engine) = engine();
        engine
            .set_curve_body(CurveKind::Power, "Ride", 90, false, "old")
            .unwrap();
        engine
            .set_curve_body(CurveKind::Power, "Ride", 90, false, "new")
            .unwrap();
        assert_eq!(
            engine
                .get_stored_curve(CurveKind::Power, "Ride", 90, false)
                .unwrap()
                .map(|curve| curve.raw)
                .as_deref(),
            Some("new")
        );
    }

    /// Scenario: a curve drawn offline was fetched weeks ago and the header has
    /// nothing to date it with, because the read answers the body alone while
    /// the column has been written since `015_curve_interval_calendar_bodies`.
    #[test]
    fn a_stored_curve_answers_when_it_was_fetched() {
        let (_dir, engine) = engine();
        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        engine
            .set_curve_body(CurveKind::Power, "Ride", 90, false, "watts")
            .unwrap();

        let stored = engine
            .get_stored_curve(CurveKind::Power, "Ride", 90, false)
            .unwrap()
            .expect("the curve was just written");
        assert_eq!(stored.raw, "watts");
        assert!(stored.fetched_at >= before as f64);
    }

    #[test]
    fn a_curve_that_was_never_fetched_answers_nothing() {
        let (_dir, engine) = engine();

        assert!(
            engine
                .get_stored_curve(CurveKind::Pace, "Run", 42, false)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn a_refetch_moves_the_fetched_time_with_the_body() {
        let (_dir, engine) = engine();
        engine
            .set_curve_body(CurveKind::Power, "Ride", 90, false, "old")
            .unwrap();
        let first = engine
            .get_stored_curve(CurveKind::Power, "Ride", 90, false)
            .unwrap()
            .unwrap();

        engine
            .set_curve_body(CurveKind::Power, "Ride", 90, false, "new")
            .unwrap();
        let second = engine
            .get_stored_curve(CurveKind::Power, "Ride", 90, false)
            .unwrap()
            .unwrap();

        assert_eq!(second.raw, "new");
        assert!(second.fetched_at >= first.fetched_at);
    }

    #[test]
    fn the_fetched_time_is_keyed_the_same_way_the_body_is() {
        let (_dir, engine) = engine();
        engine
            .set_curve_body(CurveKind::Pace, "Run", 42, false, "plain")
            .unwrap();

        assert!(
            engine
                .get_stored_curve(CurveKind::Pace, "Run", 42, true)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn stream_bodies_are_keyed_by_series_selection() {
        let (_dir, engine) = engine();

        engine
            .set_stream_body("a1", "latlng,altitude", "preview")
            .unwrap();
        engine.set_stream_body("a1", "time", "just-time").unwrap();

        // A latlng preview and a full chart pull are different payloads for
        // the same activity, so one must never be served for the other.
        assert_eq!(
            engine
                .get_stream_body("a1", "latlng,altitude")
                .unwrap()
                .as_deref(),
            Some("preview")
        );
        assert_eq!(
            engine.get_stream_body("a1", "time").unwrap().as_deref(),
            Some("just-time")
        );
        assert!(engine.get_stream_body("a1", "watts").unwrap().is_none());
    }

    /// A quarter of the budget, so four bodies fit and the fifth evicts. Sized
    /// off the constant rather than a literal, or a change to the budget would
    /// leave the test asserting nothing.
    fn quarter_budget_body() -> String {
        "x".repeat((MAX_STREAM_BODY_BYTES / 4) as usize)
    }

    fn cached_bytes(engine: &PersistentEngine) -> i64 {
        engine
            .db
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(raw)), 0) FROM stream_bodies",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn stream_bodies_stay_under_the_byte_budget() {
        let (_dir, engine) = engine();
        let body = quarter_budget_body();
        for i in 0..6 {
            engine
                .set_stream_body(&format!("a{}", i), "time", &body)
                .unwrap();
        }

        assert!(
            cached_bytes(&engine) <= MAX_STREAM_BODY_BYTES,
            "the cache is bounded by bytes, not by rows"
        );
        // The most recent write survives the prune.
        assert!(engine.get_stream_body("a5", "time").unwrap().is_some());
    }

    #[test]
    fn one_body_larger_than_the_whole_budget_is_still_kept() {
        let (_dir, engine) = engine();
        let huge = "x".repeat((MAX_STREAM_BODY_BYTES + 1024) as usize);
        engine.set_stream_body("a1", "time", &huge).unwrap();

        // Evicting it would refetch it on every open, which is worse than
        // holding one oversized payload.
        assert!(engine.get_stream_body("a1", "time").unwrap().is_some());
    }

    /// Backdate every stored stream to a distinct second so eviction order is
    /// the read order rather than a tie broken by rowid.
    fn age_streams(engine: &PersistentEngine) {
        engine
            .db
            .execute(
                "UPDATE stream_bodies SET updated_at = 1600000000 + rowid",
                [],
            )
            .unwrap();
    }

    fn stored_ids(engine: &PersistentEngine) -> Vec<String> {
        let mut stmt = engine
            .db
            .prepare("SELECT activity_id FROM stream_bodies ORDER BY activity_id")
            .unwrap();

        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<SqlResult<Vec<_>>>()
            .unwrap()
    }

    #[test]
    fn reading_a_stream_body_saves_it_from_eviction() {
        let (_dir, engine) = engine();
        let body = quarter_budget_body();
        for i in 0..4 {
            engine
                .set_stream_body(&format!("a{}", i), "time", &body)
                .unwrap();
        }
        age_streams(&engine);

        // The oldest write is read, which is what makes a cache an LRU: the
        // athlete just opened that activity, so it is the last thing to drop.
        assert!(engine.get_stream_body("a0", "time").unwrap().is_some());

        engine.set_stream_body("new", "time", &body).unwrap();

        let ids = stored_ids(&engine);
        assert!(ids.contains(&"a0".to_string()), "the read row must survive");
        assert!(
            !ids.contains(&"a1".to_string()),
            "the least recently read row is the one that goes"
        );
    }

    #[test]
    fn a_second_read_keeps_the_row_at_the_head() {
        let (_dir, engine) = engine();
        let body = quarter_budget_body();
        for i in 0..4 {
            engine
                .set_stream_body(&format!("a{}", i), "time", &body)
                .unwrap();
        }
        age_streams(&engine);

        engine.get_stream_body("a0", "time").unwrap();
        engine.get_stream_body("a0", "time").unwrap();
        engine.set_stream_body("new", "time", &body).unwrap();

        assert!(engine.get_stream_body("a0", "time").unwrap().is_some());
    }

    #[test]
    fn a_missed_read_stores_nothing() {
        let (_dir, engine) = engine();
        engine.set_stream_body("a1", "time", "payload").unwrap();

        assert!(engine.get_stream_body("absent", "time").unwrap().is_none());
        assert!(engine.get_stream_body("a1", "watts").unwrap().is_none());

        // A miss must not mint a row, or the cache fills with empty keys and
        // evicts the payloads it was built to hold.
        assert_eq!(stored_ids(&engine), vec!["a1".to_string()]);
    }

    #[test]
    fn the_budget_is_reached_without_evicting() {
        let (_dir, engine) = engine();
        let body = quarter_budget_body();
        for i in 0..4 {
            engine
                .set_stream_body(&format!("a{}", i), "time", &body)
                .unwrap();
        }
        assert_eq!(stored_ids(&engine).len(), 4);
        assert!(engine.get_stream_body("a0", "time").unwrap().is_some());
    }

    /// Scenario: a fifty-first activity evicts the fiftieth, so the athlete
    /// loses a stream they already paid to fetch.
    /// Expected behaviour: the raw body is a cache and may go, but the series
    /// themselves are stored, so the read still answers from the device.
    #[test]
    fn a_stored_series_survives_the_body_cache_ceiling() {
        let (_dir, engine) = engine();
        let body =
            r#"[{"type":"watts","data":[100,110,120]},{"type":"heartrate","data":[140,141,142]}]"#;
        engine
            .set_stream_body("a0", "watts,heartrate", body)
            .unwrap();
        for i in 1..=60 {
            engine
                .set_stream_body(&format!("a{}", i), "watts,heartrate", body)
                .unwrap();
        }

        let served = engine
            .read_stream_body("a0", "watts,heartrate")
            .unwrap()
            .expect("a stream must outlive the body cache");
        let parsed: Vec<crate::net::types::StreamDto> = serde_json::from_str(&served).unwrap();
        let watts = parsed.iter().find(|s| s.kind == "watts").unwrap();
        assert_eq!(watts.data, vec![Some(100.0), Some(110.0), Some(120.0)]);
        let hr = parsed.iter().find(|s| s.kind == "heartrate").unwrap();
        assert_eq!(hr.data, vec![Some(140.0), Some(141.0), Some(142.0)]);
    }

    /// A narrow selection must never be served for a wide one. The body cache
    /// keys on the selection, and the durable store answers only a selection
    /// every series of which it holds.
    #[test]
    fn a_narrow_store_never_answers_a_wide_selection() {
        let (_dir, engine) = engine();
        engine
            .set_stream_body("a1", "watts", r#"[{"type":"watts","data":[100,110]}]"#)
            .unwrap();

        assert!(engine.read_stream_body("a1", "watts").unwrap().is_some());
        // heartrate was never fetched, so the pair is unanswerable and the
        // caller must go and get it.
        assert!(
            engine
                .read_stream_body("a1", "watts,heartrate")
                .unwrap()
                .is_none()
        );
    }

    /// A stored series is addressed positionally against the track, so one that
    /// disagrees with it is not in the same index space and must not be served
    /// beside it.
    #[test]
    fn a_series_that_disagrees_with_the_track_is_not_served_with_it() {
        let (_dir, engine) = engine();
        let points = vec![
            crate::GpsPoint {
                latitude: 1.0,
                longitude: 2.0,
                elevation: Some(10.0),
            },
            crate::GpsPoint {
                latitude: 1.1,
                longitude: 2.1,
                elevation: Some(11.0),
            },
        ];
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES ('a1', 'Ride', 0, 0, 0, 0)",
                [],
            )
            .unwrap();
        engine.store_gps_track("a1", &points).unwrap();
        engine
            .store_activity_streams(
                "a1",
                &[crate::net::types::StreamDto {
                    kind: "watts".to_string(),
                    data: vec![Some(100.0), Some(110.0), Some(120.0)],
                    data2: None,
                }],
            )
            .unwrap();

        assert!(
            engine
                .read_stream_body("a1", "latlng,watts")
                .unwrap()
                .is_none()
        );
        // The same series alone is still servable: nothing is being addressed
        // against the track there.
        assert!(engine.read_stream_body("a1", "watts").unwrap().is_some());
    }

    /// The reader keeps carrying a misaligned series and the writer does not
    /// refuse it, on one condition: the drop is never silent. Two sites here
    /// drop one, and a warning is the only evidence an athlete's missing chart
    /// would ever leave.
    #[test]
    fn a_misaligned_stored_series_is_dropped_out_loud() {
        crate::test_log::capturing();
        let (_dir, engine) = engine();
        seed_two_point_track(&engine, "loud-watts");
        engine
            .store_activity_streams(
                "loud-watts",
                &[crate::net::types::StreamDto {
                    kind: "watts".to_string(),
                    data: vec![Some(100.0), Some(110.0), Some(120.0)],
                    data2: None,
                }],
            )
            .unwrap();

        assert!(
            engine
                .read_stream_body("loud-watts", "latlng,watts")
                .unwrap()
                .is_none(),
            "the behaviour is unchanged: the pair is still not served"
        );
        let said = crate::test_log::warnings_with("loud-watts");
        assert_eq!(
            said.len(),
            1,
            "one warning naming the activity, the series and both lengths: {said:?}"
        );
        assert!(
            said[0].contains("watts") && said[0].contains('3') && said[0].contains('2'),
            "the warning has to carry the kind and both lengths: {}",
            said[0]
        );
    }

    /// The time guard drops only the scrubber and serves the rest, so the
    /// detail screen gets a body with no cursor and, until now, no reason.
    #[test]
    fn a_misaligned_time_stream_is_dropped_out_loud() {
        crate::test_log::capturing();
        let (_dir, engine) = engine();
        seed_two_point_track(&engine, "loud-time");
        engine.store_time_stream("loud-time", &[0, 1, 2]).unwrap();

        let body = engine
            .read_stream_body("loud-time", "latlng,time")
            .unwrap()
            .expect("the track still serves");
        assert!(
            !body.contains("\"time\""),
            "the behaviour is unchanged: the misaligned clock is left out"
        );
        let said = crate::test_log::warnings_with("loud-time");
        assert_eq!(said.len(), 1, "one warning: {said:?}");
        assert!(
            said[0].contains("time") && said[0].contains('3') && said[0].contains('2'),
            "the warning has to carry the kind and both lengths: {}",
            said[0]
        );
    }

    /// A time stream whose blob will not decode leaves the clock out of the
    /// body on both read paths, and both say why.
    #[test]
    fn an_undecodable_time_stream_is_dropped_out_loud() {
        crate::test_log::capturing();
        let (_dir, engine) = engine();
        seed_two_point_track(&engine, "garbled-time");
        engine
            .db
            .execute(
                "INSERT INTO time_streams (activity_id, times, point_count) VALUES ('garbled-time', x'ff', 2)",
                [],
            )
            .unwrap();

        let pooled =
            crate::persistence::activities::pooled::time_stream(&engine.db, "garbled-time");
        assert!(pooled.is_none());
        let locked = engine.load_time_stream("garbled-time");
        assert!(locked.is_none());
        let said = crate::test_log::errors_with("time_streams garbled-time");
        assert_eq!(
            said.len(),
            2,
            "both paths log, naming the table and id: {said:?}"
        );
    }

    /// A two-point track under `id`, the shortest thing both reader guards
    /// measure a series against.
    fn seed_two_point_track(engine: &PersistentEngine, id: &str) {
        let points = vec![
            crate::GpsPoint {
                latitude: 1.0,
                longitude: 2.0,
                elevation: Some(10.0),
            },
            crate::GpsPoint {
                latitude: 1.1,
                longitude: 2.1,
                elevation: Some(11.0),
            },
        ];
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES (?, 'Ride', 0, 0, 0, 0)",
                [id],
            )
            .unwrap();
        engine.store_gps_track(id, &points).unwrap();
    }

    #[test]
    fn clearing_empties_the_stream_store() {
        let (_dir, mut engine) = engine();
        engine
            .set_stream_body("a1", "watts", r#"[{"type":"watts","data":[1]}]"#)
            .unwrap();
        assert!(!engine.stored_stream_kinds("a1").unwrap().is_empty());

        engine.clear().unwrap();
        assert!(engine.stored_stream_kinds("a1").unwrap().is_empty());
    }

    #[test]
    fn interval_bodies_round_trip() {
        let (_dir, engine) = engine();
        assert!(engine.get_interval_body("a1").unwrap().is_none());

        engine.set_interval_body("a1", r#"{"id":"a1"}"#).unwrap();
        assert_eq!(
            engine.get_interval_body("a1").unwrap().as_deref(),
            Some(r#"{"id":"a1"}"#)
        );
    }

    fn metric(id: &str, date: i64) -> crate::types::ActivityMetrics {
        crate::types::ActivityMetrics {
            activity_id: id.to_string(),
            name: id.to_string(),
            date,
            distance: 1000.0,
            moving_time: 600,
            elapsed_time: 600,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }
    }

    /// Scenario: the sync derives its interval prefetch queue from SQLite
    /// rather than storing one, so a pass that was killed halfway resumes by
    /// re-deriving what is still missing.
    #[test]
    fn the_interval_queue_is_what_has_no_body_yet_newest_first() {
        let (_dir, mut engine) = engine();
        engine
            .set_activity_metrics(vec![
                metric("older", 1_700_000_000),
                metric("newer", 1_700_100_000),
                metric("fetched", 1_700_200_000),
            ])
            .unwrap();
        engine.set_interval_body("fetched", "{}").unwrap();

        assert_eq!(
            engine.activities_missing_interval_bodies().unwrap(),
            vec!["newer".to_string(), "older".to_string()],
            "a body already stored leaves the queue, and the newest ride is asked for first"
        );
    }

    /// Scenario: a recording the device saved has a `local-` key and a
    /// metrics row, and no server has named it.
    ///
    /// Expected behaviour: the interval queue leaves it out until an upload
    /// records the server's id, tracked or trackless, and keeps every server
    /// row.
    #[test]
    fn the_interval_queue_leaves_out_a_local_recording_no_server_has_named() {
        let (_dir, mut engine) = engine();
        engine
            .set_activity_metrics(vec![
                metric("i100", 1_700_000_000),
                metric("local-unsent", 1_700_100_000),
                metric("local-tracked", 1_700_200_000),
                metric("local-trackless", 1_700_300_000),
            ])
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, intervals_id)
                 VALUES ('local-tracked', 'Ride', 0, 0, 0, 0, 'i200')",
                [],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO activity_bodies (activity_id, date, raw, updated_at, intervals_id)
                 VALUES ('local-trackless', 1700300000, '{}', 0, 'i300')",
                [],
            )
            .unwrap();

        assert_eq!(
            engine.activities_missing_interval_bodies().unwrap(),
            vec![
                "local-trackless".to_string(),
                "local-tracked".to_string(),
                "i100".to_string()
            ]
        );
    }

    #[test]
    fn replacing_a_calendar_window_drops_cancelled_events() {
        let (_dir, mut engine) = engine();
        engine
            .replace_calendar_events(
                1_700_000_000,
                1_700_600_000,
                &[
                    ("e1".to_string(), 1_700_100_000, "first".to_string()),
                    ("e2".to_string(), 1_700_200_000, "second".to_string()),
                ],
            )
            .unwrap();
        assert_eq!(
            engine
                .get_calendar_event_bodies(1_700_000_000, 1_700_600_000)
                .unwrap()
                .len(),
            2
        );

        // The second sync no longer carries e2, so it must disappear rather
        // than linger as a workout the athlete already cancelled.
        engine
            .replace_calendar_events(
                1_700_000_000,
                1_700_600_000,
                &[("e1".to_string(), 1_700_100_000, "first".to_string())],
            )
            .unwrap();
        assert_eq!(
            engine
                .get_calendar_event_bodies(1_700_000_000, 1_700_600_000)
                .unwrap(),
            vec!["first".to_string()]
        );
    }

    #[test]
    fn calendar_events_outside_the_replaced_window_survive() {
        let (_dir, mut engine) = engine();
        engine
            .replace_calendar_events(
                1_600_000_000,
                1_600_100_000,
                &[("old".to_string(), 1_600_050_000, "kept".to_string())],
            )
            .unwrap();
        engine
            .replace_calendar_events(
                1_700_000_000,
                1_700_600_000,
                &[("new".to_string(), 1_700_100_000, "fresh".to_string())],
            )
            .unwrap();

        assert_eq!(
            engine
                .get_calendar_event_bodies(1_600_000_000, 1_600_100_000)
                .unwrap(),
            vec!["kept".to_string()]
        );
    }

    // Reconstruction from `gps_tracks` and `time_streams`. Every ingested
    // activity already has its points on device, so a preview that misses the
    // body cache has no reason to pay for the same bytes twice.

    fn elevated_track(n: usize) -> Vec<crate::GpsPoint> {
        (0..n)
            .map(|i| {
                crate::GpsPoint::with_elevation(
                    46.2 + i as f64 * 0.001,
                    7.35 + i as f64 * 0.001,
                    100.0 + i as f64,
                )
            })
            .collect()
    }

    fn series<'a>(
        items: &'a [crate::net::types::StreamDto],
        kind: &str,
    ) -> Option<&'a crate::net::types::StreamDto> {
        items.iter().find(|s| s.kind == kind)
    }

    fn parse_body(raw: &str) -> Vec<crate::net::types::StreamDto> {
        serde_json::from_str(raw).expect("reconstruction is an intervals.icu stream array")
    }

    #[test]
    fn a_preview_reads_from_the_stored_track_when_no_body_was_cached() {
        let (_dir, mut engine) = engine();
        engine
            .add_activity("a1".to_string(), elevated_track(4), "cycling".to_string())
            .unwrap();

        let raw = engine
            .read_stream_body("a1", "altitude,latlng")
            .unwrap()
            .expect("an ingested track can serve its own preview");
        let items = parse_body(&raw);

        let source = elevated_track(4);
        let latlng = series(&items, "latlng").expect("latlng");
        let lngs = latlng
            .data2
            .as_deref()
            .expect("latlng carries lng in data2");
        assert_eq!(latlng.data.len(), source.len());
        assert_eq!(lngs.len(), source.len());

        // The track codec quantises to 1e-6 deg and 0.1 m, so the guarantee is
        // that a revert restores the line a rider followed, not the stored f64.
        let altitude = series(&items, "altitude").expect("altitude");
        for (i, p) in source.iter().enumerate() {
            assert!((latlng.data[i].unwrap() - p.latitude).abs() <= 1e-6);
            assert!((lngs[i].unwrap() - p.longitude).abs() <= 1e-6);
            assert!((altitude.data[i].unwrap() - p.elevation.unwrap()).abs() <= 0.05);
        }
    }

    #[test]
    fn a_cached_body_wins_over_the_reconstruction() {
        let (_dir, mut engine) = engine();
        engine
            .add_activity("a1".to_string(), elevated_track(4), "cycling".to_string())
            .unwrap();
        engine
            .set_stream_body("a1", "altitude,latlng", "what-the-server-sent")
            .unwrap();

        // The server body carries samples the track dropped, so it outranks a
        // reconstruction even though both answer the same selection.
        assert_eq!(
            engine
                .read_stream_body("a1", "altitude,latlng")
                .unwrap()
                .as_deref(),
            Some("what-the-server-sent")
        );
    }

    #[test]
    fn a_selection_the_track_cannot_serve_reads_as_absent() {
        let (_dir, mut engine) = engine();
        engine
            .add_activity("a1".to_string(), elevated_track(4), "cycling".to_string())
            .unwrap();

        // `DETAIL_STREAM_TYPES` as `streamTypesKey` sorts it. Power and heart
        // rate are not in the track, and serving a partial body would tell the
        // detail screen it is stocked and stop the fetch, so the whole
        // selection reads as absent instead.
        assert!(
            engine
                .read_stream_body(
                    "a1",
                    "altitude,cadence,distance,fixed_altitude,ga_velocity,grade_smooth,\
                     heartrate,latlng,temp,time,velocity_smooth,w_bal,watts"
                )
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn the_reconstruction_carries_time_when_it_indexes_the_same_samples() {
        let (_dir, mut engine) = engine();
        engine
            .add_activity("a1".to_string(), elevated_track(4), "cycling".to_string())
            .unwrap();
        engine.set_time_streams_flat(&["a1".to_string()], &[0, 5, 10, 15], &[0]);

        let raw = engine
            .read_stream_body("a1", "latlng,time")
            .unwrap()
            .unwrap();
        let items = parse_body(&raw);
        assert_eq!(
            series(&items, "time").expect("time").data,
            vec![Some(0.0), Some(5.0), Some(10.0), Some(15.0)]
        );
    }

    #[test]
    fn a_time_stream_of_the_wrong_length_is_dropped_rather_than_misaligned() {
        let (_dir, mut engine) = engine();
        engine
            .add_activity("a1".to_string(), elevated_track(4), "cycling".to_string())
            .unwrap();
        engine.set_time_streams_flat(&["a1".to_string()], &[0, 5], &[0]);

        let raw = engine
            .read_stream_body("a1", "latlng,time")
            .unwrap()
            .unwrap();
        let items = parse_body(&raw);
        // A scrubber on the wrong index space is worse than no scrubber, but
        // the line still draws.
        assert!(series(&items, "time").is_none());
        assert!(series(&items, "latlng").is_some());
    }

    #[test]
    fn a_track_with_no_elevation_serves_the_line_without_a_profile() {
        let (_dir, mut engine) = engine();
        let flat: Vec<crate::GpsPoint> = (0..4)
            .map(|i| crate::GpsPoint::new(46.2 + i as f64 * 0.001, 7.35))
            .collect();
        engine
            .add_activity("a1".to_string(), flat, "cycling".to_string())
            .unwrap();

        let raw = engine
            .read_stream_body("a1", "altitude,latlng")
            .unwrap()
            .unwrap();
        let items = parse_body(&raw);
        assert!(series(&items, "latlng").is_some());
        // The ingest drops an elevation it cannot trust and keeps the track.
        // An empty profile would read as sea level all the way.
        assert!(series(&items, "altitude").is_none());
    }

    #[test]
    fn a_corrected_altitude_selection_is_served_as_plain_altitude() {
        let (_dir, mut engine) = engine();
        engine
            .add_activity("a1".to_string(), elevated_track(4), "cycling".to_string())
            .unwrap();

        let raw = engine
            .read_stream_body("a1", "fixed_altitude,latlng")
            .unwrap()
            .unwrap();
        let items = parse_body(&raw);
        // The stored point cannot say which form its elevation came from, so
        // the profile is served under the name that claims nothing.
        assert!(series(&items, "fixed_altitude").is_none());
        assert_eq!(series(&items, "altitude").expect("altitude").data.len(), 4);
    }

    #[test]
    fn an_activity_with_no_stored_track_has_nothing_to_reconstruct() {
        let (_dir, engine) = engine();
        assert!(
            engine
                .read_stream_body("never-ingested", "altitude,latlng")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn the_reconstruction_does_not_displace_the_cache_ceiling() {
        let (_dir, mut engine) = engine();
        engine
            .add_activity("a1".to_string(), elevated_track(4), "cycling".to_string())
            .unwrap();
        engine.read_stream_body("a1", "altitude,latlng").unwrap();
        engine.read_stream_body("a1", "altitude,latlng").unwrap();

        // Reconstruction is free to recompute, so writing it back would evict
        // a real server body to store something already on disk.
        let rows: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM stream_bodies", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }

    /// The body row, each parsed series and the two sweeps were separate
    /// autocommits, so one activity's streams was six fsyncs under the
    /// engine lock.
    #[test]
    fn storing_a_stream_body_is_one_commit() {
        let (_dir, engine) = engine();
        let raw = r#"[{"type":"watts","data":[100,200]},
                      {"type":"heartrate","data":[140,150]},
                      {"type":"cadence","data":[80,82]}]"#;
        let commits = super::super::commit_counter::watch(&engine);

        engine
            .set_stream_body("a1", "watts,heartrate,cadence", raw)
            .unwrap();

        assert_eq!(super::super::commit_counter::count(&commits), 1);
        assert_eq!(engine.stored_stream_kinds("a1").unwrap().len(), 3);
    }

    #[test]
    fn a_second_body_for_the_same_activity_is_one_commit() {
        let (_dir, engine) = engine();
        let raw = r#"[{"type":"watts","data":[100,200]}]"#;
        engine.set_stream_body("a1", "watts", raw).unwrap();

        let commits = super::super::commit_counter::watch(&engine);
        engine.set_stream_body("a1", "watts", raw).unwrap();

        assert_eq!(super::super::commit_counter::count(&commits), 1);
    }

    /// A body that will not parse is still cached, and the cache write is the
    /// only commit.
    #[test]
    fn an_unparseable_body_is_one_commit_and_still_cached() {
        let (_dir, engine) = engine();
        let commits = super::super::commit_counter::watch(&engine);

        engine.set_stream_body("a1", "watts", "not json").unwrap();

        assert_eq!(super::super::commit_counter::count(&commits), 1);
        assert_eq!(
            engine.get_stream_body("a1", "watts").unwrap().as_deref(),
            Some("not json")
        );
    }
}
