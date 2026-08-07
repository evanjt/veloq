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
}
