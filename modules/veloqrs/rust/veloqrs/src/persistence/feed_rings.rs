//! The feed's new-activity rings: which activities are new to the athlete,
//! decided once here and handed to the screen as a set of ids.
//!
//! The state is one device-local settings row. An activity is new when the
//! feed has been closed before, it started after the newest start the last
//! close saw (or it has already been shown), the athlete has not dismissed it,
//! and its first showing was under a day ago. Nothing rings on the first open
//! of a library, after a clear or after a restore, because none of those has a
//! marker.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use super::PersistentEngine;
use super::settings::{setting_from, settings_keys};

/// How long a ring stays once the feed first showed it, in seconds.
pub const RING_LIFETIME_SECS: i64 = 24 * 60 * 60;

/// What the feed tells the engine about its own use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedSeen {
    Opened,
    Dismissed { activity_ids: Vec<String> },
    Closed,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeedRings {
    /// The newest `activities.start_date` at the last close. Absent until the
    /// library has had one.
    #[serde(default)]
    pub seen_through: Option<i64>,
    /// Activity id to the unix second the feed first showed its ring.
    #[serde(default)]
    pub shown: BTreeMap<String, i64>,
    /// Activities the athlete dismissed since the last close.
    #[serde(default)]
    pub dismissed: BTreeSet<String>,
}

/// The ids that ring, newest first. `candidates` holds `(id, start_date)` for
/// every activity that started after the marker plus every id in `shown`.
pub fn new_activity_ids(state: &FeedRings, candidates: &[(String, i64)], now: i64) -> Vec<String> {
    let Some(seen_through) = state.seen_through else {
        return Vec::new();
    };
    let mut ids: Vec<&(String, i64)> = candidates
        .iter()
        .filter(|(id, start)| {
            !state.dismissed.contains(id)
                && (*start > seen_through || state.shown.contains_key(id))
                && state
                    .shown
                    .get(id)
                    .is_none_or(|stamp| now - stamp < RING_LIFETIME_SECS)
        })
        .collect();
    ids.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ids.into_iter().map(|(id, _)| id.clone()).collect()
}

/// The state after `event`. `newest_start` is the newest start in the library,
/// or none when it is empty.
pub fn apply_feed_seen(
    mut state: FeedRings,
    event: &FeedSeen,
    candidates: &[(String, i64)],
    newest_start: Option<i64>,
    now: i64,
) -> FeedRings {
    match event {
        FeedSeen::Opened => {
            if state.seen_through.is_none() {
                state.seen_through = newest_start;
            } else {
                stamp_unstamped(&mut state, candidates, now);
            }
        }
        FeedSeen::Dismissed { activity_ids } => {
            for id in activity_ids {
                state.shown.remove(id);
                state.dismissed.insert(id.clone());
            }
        }
        FeedSeen::Closed => {
            stamp_unstamped(&mut state, candidates, now);
            let still_new: BTreeSet<String> = new_activity_ids(&state, candidates, now)
                .into_iter()
                .collect();
            state.shown.retain(|id, _| still_new.contains(id));
            if newest_start.is_some() {
                state.seen_through = newest_start;
            }
            state.dismissed.clear();
        }
    }
    state
}

fn stamp_unstamped(state: &mut FeedRings, candidates: &[(String, i64)], now: i64) {
    for id in new_activity_ids(state, candidates, now) {
        state.shown.entry(id).or_insert(now);
    }
}

fn load(conn: &Connection) -> FeedRings {
    setting_from(conn, settings_keys::FEED_RINGS)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn candidates(conn: &Connection, state: &FeedRings) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut out = BTreeMap::new();
    if let Some(seen_through) = state.seen_through {
        let mut stmt =
            conn.prepare_cached("SELECT id, start_date FROM activities WHERE start_date > ?1")?;
        for row in stmt.query_map(params![seen_through], |r| Ok((r.get(0)?, r.get(1)?)))? {
            let (id, start): (String, i64) = row?;
            out.insert(id, start);
        }
    }
    let mut stmt = conn.prepare_cached(
        "SELECT start_date FROM activities WHERE id = ?1 AND start_date IS NOT NULL",
    )?;
    for id in state.shown.keys() {
        if let Ok(start) = stmt.query_row(params![id], |r| r.get::<_, i64>(0)) {
            out.insert(id.clone(), start);
        }
    }
    Ok(out.into_iter().collect())
}

fn newest_start(conn: &Connection) -> rusqlite::Result<Option<i64>> {
    conn.query_row("SELECT MAX(start_date) FROM activities", [], |r| r.get(0))
}

/// The ids that ring now, read from a connection that holds no engine lock.
pub fn feed_ring_ids(conn: &Connection, now: i64) -> Vec<String> {
    let state = load(conn);
    if state.seen_through.is_none() {
        return Vec::new();
    }
    match candidates(conn, &state) {
        Ok(c) => new_activity_ids(&state, &c, now),
        Err(_) => Vec::new(),
    }
}

impl PersistentEngine {
    /// Record that the feed opened, closed or had rings dismissed. One row is
    /// written.
    pub fn record_feed_seen(&self, event: &FeedSeen, now: i64) -> Result<(), String> {
        let state = load(&self.db);
        let cands = candidates(&self.db, &state).map_err(|e| e.to_string())?;
        let newest = newest_start(&self.db).map_err(|e| e.to_string())?;
        let next = apply_feed_seen(state, event, &cands, newest, now);
        let raw = serde_json::to_string(&next).map_err(|e| e.to_string())?;
        self.set_setting(settings_keys::FEED_RINGS, &raw)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::PersistentEngine;

    const DAY: i64 = RING_LIFETIME_SECS;

    fn cands(starts: &[(&str, i64)]) -> Vec<(String, i64)> {
        starts.iter().map(|(i, s)| (i.to_string(), *s)).collect()
    }

    fn marked(at: i64) -> FeedRings {
        FeedRings {
            seen_through: Some(at),
            ..Default::default()
        }
    }

    #[test]
    fn nothing_is_new_without_a_marker() {
        let c = cands(&[("a", 10), ("b", 20)]);
        assert!(new_activity_ids(&FeedRings::default(), &c, 100).is_empty());
    }

    #[test]
    fn a_marker_flags_exactly_the_activities_after_it() {
        let c = cands(&[("a", 10), ("b", 20), ("c", 30), ("d", 40), ("e", 50)]);
        let got = new_activity_ids(&marked(30), &c, 100);
        assert_eq!(got, vec!["e".to_string(), "d".to_string()]);
    }

    #[test]
    fn a_dismissed_id_is_not_new() {
        let mut s = marked(10);
        s.dismissed.insert("b".into());
        let c = cands(&[("a", 20), ("b", 30)]);
        assert_eq!(new_activity_ids(&s, &c, 100), vec!["a".to_string()]);
    }

    #[test]
    fn a_ring_lives_for_a_day_from_its_stamp() {
        let c = cands(&[("a", 20)]);
        let mut s = marked(10);
        s.shown.insert("a".into(), 1_000_000);
        assert_eq!(new_activity_ids(&s, &c, 1_000_000 + DAY - 3_600).len(), 1);
        assert!(new_activity_ids(&s, &c, 1_000_000 + DAY + 3_600).is_empty());
    }

    #[test]
    fn a_shown_id_stays_new_after_the_marker_passes_it() {
        let c = cands(&[("a", 20)]);
        let mut s = marked(50);
        s.shown.insert("a".into(), 90);
        assert_eq!(new_activity_ids(&s, &c, 100), vec!["a".to_string()]);
    }

    #[test]
    fn opening_with_no_marker_sets_it_and_flags_nothing() {
        let c = cands(&[("a", 10), ("b", 20)]);
        let s = apply_feed_seen(FeedRings::default(), &FeedSeen::Opened, &c, Some(20), 100);
        assert_eq!(s.seen_through, Some(20));
        assert!(new_activity_ids(&s, &c, 100).is_empty());
    }

    #[test]
    fn opening_with_a_marker_stamps_each_new_id_once() {
        let c = cands(&[("a", 20), ("b", 30)]);
        let s = apply_feed_seen(marked(10), &FeedSeen::Opened, &c, Some(30), 100);
        assert_eq!(s.shown.get("a"), Some(&100));
        let s = apply_feed_seen(s, &FeedSeen::Opened, &c, Some(30), 500);
        assert_eq!(s.shown.get("a"), Some(&100));
        assert_eq!(s.seen_through, Some(10));
    }

    #[test]
    fn dismissing_drops_the_stamp_and_hides_the_id() {
        let c = cands(&[("a", 20), ("b", 30)]);
        let s = apply_feed_seen(marked(10), &FeedSeen::Opened, &c, Some(30), 100);
        let s = apply_feed_seen(
            s,
            &FeedSeen::Dismissed {
                activity_ids: vec!["a".into()],
            },
            &c,
            Some(30),
            110,
        );
        assert!(!s.shown.contains_key("a"));
        assert_eq!(new_activity_ids(&s, &c, 120), vec!["b".to_string()]);
    }

    #[test]
    fn closing_keeps_an_unexpired_ring_and_never_revives_a_dismissed_one() {
        let c = cands(&[("a", 20), ("b", 30), ("c", 5)]);
        let mut s = marked(10);
        s.dismissed.insert("b".into());
        let s = apply_feed_seen(s, &FeedSeen::Closed, &c, Some(30), 100);
        assert_eq!(s.seen_through, Some(30));
        assert!(s.dismissed.is_empty());
        assert_eq!(new_activity_ids(&s, &c, 200), vec!["a".to_string()]);
        // Past the marker, outside `shown`, dismissed: it cannot ring again.
        assert!(!s.shown.contains_key("b"));
        assert!(!new_activity_ids(&s, &c, 200).contains(&"b".to_string()));
        assert!(!new_activity_ids(&s, &c, 200).contains(&"c".to_string()));
    }

    #[test]
    fn closing_drops_an_expired_stamp_and_keeps_the_marker_on_an_empty_library() {
        let c = cands(&[("a", 20)]);
        let mut s = marked(10);
        s.shown.insert("a".into(), 0);
        let s = apply_feed_seen(s, &FeedSeen::Closed, &c, Some(20), 2 * DAY);
        assert!(s.shown.is_empty());
        let s = apply_feed_seen(marked(10), &FeedSeen::Closed, &[], None, 100);
        assert_eq!(s.seen_through, Some(10));
        let s = apply_feed_seen(FeedRings::default(), &FeedSeen::Closed, &[], None, 100);
        assert_eq!(s.seen_through, None);
    }

    fn engine_with(starts: &[(&str, i64)]) -> (tempfile::TempDir, PersistentEngine) {
        let dir = tempfile::tempdir().unwrap();
        let engine = PersistentEngine::new(dir.path().join("rings.db").to_str().unwrap()).unwrap();
        for (id, start) in starts {
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                     VALUES (?1, 'Ride', 0, 0, 0, 0, ?2)",
                    params![id, start],
                )
                .unwrap();
        }
        (dir, engine)
    }

    fn rows(engine: &PersistentEngine) -> i64 {
        engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = ?1",
                params![settings_keys::FEED_RINGS],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn the_engine_rings_activities_that_arrive_after_a_close() {
        let (_d, engine) = engine_with(&[("a", 10), ("b", 20)]);
        engine.record_feed_seen(&FeedSeen::Opened, 100).unwrap();
        assert!(
            feed_ring_ids(&engine.db, 100).is_empty(),
            "first open rings nothing"
        );
        engine.record_feed_seen(&FeedSeen::Closed, 110).unwrap();
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                 VALUES ('c', 'Ride', 0, 0, 0, 0, 30)",
                [],
            )
            .unwrap();
        assert_eq!(feed_ring_ids(&engine.db, 120), vec!["c".to_string()]);
        engine.record_feed_seen(&FeedSeen::Opened, 120).unwrap();
        engine.record_feed_seen(&FeedSeen::Closed, 130).unwrap();
        assert_eq!(feed_ring_ids(&engine.db, 140), vec!["c".to_string()]);
        assert!(feed_ring_ids(&engine.db, 120 + DAY + 1).is_empty());
    }

    #[test]
    fn clear_removes_the_marker() {
        let (_d, mut engine) = engine_with(&[("a", 10)]);
        engine.record_feed_seen(&FeedSeen::Opened, 100).unwrap();
        assert_eq!(rows(&engine), 1);
        engine.clear().unwrap();
        assert_eq!(rows(&engine), 0);
    }

    #[test]
    fn a_record_backup_does_not_carry_the_marker() {
        let (_d, engine) = engine_with(&[("a", 10)]);
        engine.record_feed_seen(&FeedSeen::Opened, 100).unwrap();
        let payload = super::super::record_backup::collect_record_payload(&engine.db).unwrap();
        assert!(!payload.entries.iter().any(|r| {
            r.values.get("key").and_then(|v| v.as_str()) == Some(settings_keys::FEED_RINGS)
        }));
    }

    #[test]
    fn a_record_import_leaves_no_marker() {
        let (_d, mut engine) = engine_with(&[("a", 10)]);
        engine.record_feed_seen(&FeedSeen::Opened, 100).unwrap();
        assert_eq!(rows(&engine), 1);
        engine
            .restore_record_json(r#"{"version": 1, "entries": []}"#)
            .unwrap();
        assert_eq!(rows(&engine), 0);
    }
}
