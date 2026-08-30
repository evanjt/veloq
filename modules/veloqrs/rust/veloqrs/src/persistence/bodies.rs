//! Untyped intervals.icu payloads fetched on demand: power and pace curves,
//! activity intervals, and calendar events.
//!
//! Each is stored as the body the server sent, keyed by whatever parameters
//! produced it. The screens read fields no Rust type models, and a curve only
//! means anything alongside the sport, window and gap flag it was computed
//! for, so a typed row would be both lossy and ambiguous.

use rusqlite::{Result as SqlResult, params};

use super::PersistentRouteEngine;

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

impl PersistentRouteEngine {
    /// Store a curve body under the parameters that produced it.
    pub fn set_curve_body(
        &self,
        kind: CurveKind,
        sport: &str,
        days: i64,
        gap: bool,
        raw: &str,
    ) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO curve_bodies (kind, sport, days, gap, raw, updated_at)
             VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
             ON CONFLICT(kind, sport, days, gap) DO UPDATE SET
                raw = excluded.raw,
                updated_at = excluded.updated_at",
            params![kind.as_str(), sport, days, gap as i64, raw],
        )?;
        Ok(())
    }

    /// The stored curve body, or `None` when that combination has never been
    /// fetched. Callers treat `None` as "ask for it", not as "no data".
    pub fn get_curve_body(
        &self,
        kind: CurveKind,
        sport: &str,
        days: i64,
        gap: bool,
    ) -> SqlResult<Option<String>> {
        self.db
            .query_row(
                "SELECT raw FROM curve_bodies
                 WHERE kind = ? AND sport = ? AND days = ? AND gap = ?",
                params![kind.as_str(), sport, days, gap as i64],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
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
        self.db
            .query_row(
                "SELECT raw FROM interval_bodies WHERE activity_id = ?",
                params![activity_id],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
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
        let mut stmt = self.db.prepare(
            "SELECT raw FROM calendar_event_bodies
             WHERE date >= ? AND date <= ?
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map(params![oldest_ts, newest_ts], |r| r.get::<_, String>(0))?;
        rows.collect()
    }
}

/// Series a stored track and time stream can serve without a fetch. Anything
/// outside this set only ever arrives as a body from intervals.icu.
const RECONSTRUCTABLE: [&str; 4] = ["altitude", "fixed_altitude", "latlng", "time"];

/// How many stream payloads to keep. Streams are 100-500KB each, so this is a
/// cache with a ceiling, not a mirror of the athlete's history.
const MAX_STREAM_BODIES: i64 = 50;

impl PersistentRouteEngine {
    /// Store a stream payload for an activity and series selection, then drop
    /// the least recently used ones beyond the cache ceiling.
    pub fn set_stream_body(&self, activity_id: &str, types: &str, raw: &str) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO stream_bodies (activity_id, types, raw, updated_at)
             VALUES (?, ?, ?, strftime('%s', 'now'))
             ON CONFLICT(activity_id, types) DO UPDATE SET
                raw = excluded.raw,
                updated_at = excluded.updated_at",
            params![activity_id, types, raw],
        )?;
        self.db.execute(
            "DELETE FROM stream_bodies WHERE rowid NOT IN (
                 SELECT rowid FROM stream_bodies ORDER BY updated_at DESC, rowid DESC LIMIT ?
             )",
            params![MAX_STREAM_BODIES],
        )?;
        Ok(())
    }

    /// The read order for a series selection: the cached server body first,
    /// then a reconstruction from the points and times the ingest already
    /// stored. `None` means nothing on device can answer it, which is what
    /// makes the caller fetch.
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
        let wanted: Vec<&str> = types.split(',').filter(|t| !t.is_empty()).collect();
        if wanted.is_empty() || !wanted.iter().all(|t| RECONSTRUCTABLE.contains(t)) {
            return None;
        }

        // Both series ride the `latlng` mask the ingest applied, so the stored
        // points are the index space every other series is addressed in.
        let points = match self.track(activity_id) {
            crate::persistence::codec::TrackRead::Present(points) if !points.is_empty() => points,
            _ => return None,
        };

        let mut items: Vec<crate::net::types::StreamDto> = Vec::with_capacity(wanted.len());

        if wanted.contains(&"latlng") {
            items.push(crate::net::types::StreamDto {
                kind: "latlng".to_string(),
                data: points.iter().map(|p| Some(p.latitude)).collect(),
                data2: Some(points.iter().map(|p| Some(p.longitude)).collect()),
            });
        }

        // The ingest asked for both altitude forms and stored whichever
        // `parse_streams` preferred, so a point carries one elevation and no
        // record of which form it came from. It goes back as `altitude`:
        // naming it `fixed_altitude` would claim a correction the stored point
        // cannot evidence, and nothing downstream reads the distinction.
        //
        // An ingest that could not trust the altitude kept the track and
        // dropped it, so a track with no elevation anywhere has no profile to
        // serve. Emitting zeroes would draw a ride at sea level.
        if (wanted.contains(&"altitude") || wanted.contains(&"fixed_altitude"))
            && points.iter().any(|p| p.elevation.is_some())
        {
            items.push(crate::net::types::StreamDto {
                kind: "altitude".to_string(),
                data: points.iter().map(|p| p.elevation).collect(),
                data2: None,
            });
        }

        // A time stream is fetched separately, so its length is evidence
        // rather than a guarantee. One that disagrees with the points is not
        // in this index space, and a scrubber on the wrong index space moves
        // the cursor to the wrong place on the map.
        if wanted.contains(&"time")
            && let Some(times) = self.load_time_stream(activity_id)
            && times.len() == points.len()
        {
            items.push(crate::net::types::StreamDto {
                kind: "time".to_string(),
                data: times.iter().map(|t| Some(f64::from(*t))).collect(),
                data2: None,
            });
        }

        serde_json::to_string(&items).ok()
    }

    /// A stored stream payload, or `None` when this activity and series
    /// selection has not been fetched or has aged out of the cache.
    ///
    /// A hit stamps `updated_at`, which is what makes the ceiling an LRU: an
    /// activity the athlete keeps opening outlives one fetched once and never
    /// looked at again. Without the stamp the order is write order, so the
    /// activity on screen is evicted while a stale neighbour survives.
    pub fn get_stream_body(&self, activity_id: &str, types: &str) -> SqlResult<Option<String>> {
        let hit: Option<String> = self
            .db
            .query_row(
                "SELECT raw FROM stream_bodies WHERE activity_id = ? AND types = ?",
                params![activity_id, types],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        if hit.is_some() {
            self.db.execute(
                "UPDATE stream_bodies SET updated_at = strftime('%s', 'now')
                 WHERE activity_id = ? AND types = ?",
                params![activity_id, types],
            )?;
        }
        Ok(hit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn engine() -> (TempDir, PersistentRouteEngine) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();
        (dir, engine)
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
                .get_curve_body(CurveKind::Pace, "Run", 42, false)
                .unwrap()
                .as_deref(),
            Some("plain")
        );
        assert_eq!(
            engine
                .get_curve_body(CurveKind::Pace, "Run", 42, true)
                .unwrap()
                .as_deref(),
            Some("gap-adjusted")
        );
        assert_eq!(
            engine
                .get_curve_body(CurveKind::Power, "Ride", 42, false)
                .unwrap()
                .as_deref(),
            Some("watts")
        );
        // A window that was never fetched reads as absent, not as empty data.
        assert!(
            engine
                .get_curve_body(CurveKind::Pace, "Run", 90, false)
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
                .get_curve_body(CurveKind::Power, "Ride", 90, false)
                .unwrap()
                .as_deref(),
            Some("new")
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

    #[test]
    fn stream_bodies_stay_under_the_cache_ceiling() {
        let (_dir, engine) = engine();
        for i in 0..(MAX_STREAM_BODIES + 10) {
            engine
                .set_stream_body(&format!("a{}", i), "time", "payload")
                .unwrap();
        }

        let count: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM stream_bodies", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, MAX_STREAM_BODIES, "streams are a bounded cache");

        // The most recent write survives the prune.
        assert!(
            engine
                .get_stream_body(&format!("a{}", MAX_STREAM_BODIES + 9), "time")
                .unwrap()
                .is_some()
        );
    }

    /// Backdate every stored stream to a distinct second so eviction order is
    /// the read order rather than a tie broken by rowid.
    fn age_streams(engine: &PersistentRouteEngine) {
        engine
            .db
            .execute(
                "UPDATE stream_bodies SET updated_at = 1600000000 + rowid",
                [],
            )
            .unwrap();
    }

    fn stored_ids(engine: &PersistentRouteEngine) -> Vec<String> {
        let mut stmt = engine
            .db
            .prepare("SELECT activity_id FROM stream_bodies ORDER BY activity_id")
            .unwrap();
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<SqlResult<Vec<_>>>()
            .unwrap();
        rows
    }

    #[test]
    fn reading_a_stream_body_saves_it_from_eviction() {
        let (_dir, engine) = engine();
        for i in 0..MAX_STREAM_BODIES {
            engine
                .set_stream_body(&format!("a{}", i), "time", "payload")
                .unwrap();
        }
        age_streams(&engine);

        // The oldest write is read, which is what makes a cache an LRU: the
        // athlete just opened that activity, so it is the last thing to drop.
        assert!(engine.get_stream_body("a0", "time").unwrap().is_some());

        engine.set_stream_body("new", "time", "payload").unwrap();

        let ids = stored_ids(&engine);
        assert_eq!(ids.len() as i64, MAX_STREAM_BODIES);
        assert!(ids.contains(&"a0".to_string()), "the read row must survive");
        assert!(
            !ids.contains(&"a1".to_string()),
            "the least recently read row is the one that goes"
        );
    }

    #[test]
    fn a_second_read_keeps_the_row_at_the_head() {
        let (_dir, engine) = engine();
        for i in 0..MAX_STREAM_BODIES {
            engine
                .set_stream_body(&format!("a{}", i), "time", "payload")
                .unwrap();
        }
        age_streams(&engine);

        engine.get_stream_body("a0", "time").unwrap();
        engine.get_stream_body("a0", "time").unwrap();
        engine.set_stream_body("new", "time", "payload").unwrap();

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
    fn the_ceiling_is_reached_without_evicting() {
        let (_dir, engine) = engine();
        for i in 0..MAX_STREAM_BODIES {
            engine
                .set_stream_body(&format!("a{}", i), "time", "payload")
                .unwrap();
        }
        assert_eq!(stored_ids(&engine).len() as i64, MAX_STREAM_BODIES);
        assert!(engine.get_stream_body("a0", "time").unwrap().is_some());
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
}
