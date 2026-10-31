//! Scenario: an upgrader's library is mostly old rides, and the cutover has to
//! start once the rides the app shows first have their elevation, not once
//! the whole library has.
//!
//! Expected behaviour: the slice is the newest tracks inside ninety days of
//! the newest one, no more than the upgrade day's share, and the library is
//! ready for the cut when none of them is still unknown.

use super::*;
use crate::governor::UPGRADE_DAY_BACKFILL_SHARE;
use crate::persistence::{
    ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNAVAILABLE, ELEVATION_STATE_UNKNOWN,
};
use tempfile::TempDir;

const DAY: i64 = 86_400;
const NEWEST: i64 = 1_700_000_000;

struct Track {
    id: String,
    age_days: i64,
    state: u8,
}

fn track(id: &str, age_days: i64, state: u8) -> Track {
    Track {
        id: id.to_string(),
        age_days,
        state,
    }
}

fn library(tracks: &[Track]) -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("slice.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine opens");
    let tx = engine.db.unchecked_transaction().expect("transaction");
    for t in tracks {
        tx.execute(
            "INSERT INTO activities
                (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
             VALUES (?1, 'Ride', 0, 0, 0, 0, ?2)",
            params![t.id, NEWEST - t.age_days * DAY],
        )
        .expect("activity row inserts");
        tx.execute(
            "INSERT INTO gps_tracks (activity_id, track_data, point_count, elevation_state)
             VALUES (?1, X'00', 0, ?2)",
            params![t.id, i64::from(t.state)],
        )
        .expect("track row inserts");
    }
    tx.commit().expect("commit");
    (dir, engine)
}

fn decide(engine: &PersistentEngine, id: &str, state: u8) {
    engine
        .db
        .execute(
            "UPDATE gps_tracks SET elevation_state = ?2 WHERE activity_id = ?1",
            params![id, i64::from(state)],
        )
        .expect("state updates");
}

fn ready(engine: &PersistentEngine) -> bool {
    cutover_slice_ready(&engine.db).expect("slice reads")
}

/// Twenty-five tracks inside the window, the rest well outside it.
fn sixty(slice_state: u8) -> Vec<Track> {
    (0..60)
        .map(|i| {
            if i < 25 {
                track(&format!("r{i}"), i * 3, slice_state)
            } else {
                track(&format!("r{i}"), 200 + i, ELEVATION_STATE_UNKNOWN)
            }
        })
        .collect()
}

#[test]
fn a_library_is_ready_once_the_newest_ninety_days_are_decided() {
    let (_dir, engine) = library(&sixty(ELEVATION_STATE_FETCHED));

    assert!(ready(&engine), "the old rides do not hold the cut");
    assert_eq!(
        pooled_elevation_backfill_remaining(&engine.db).expect("count"),
        35,
        "and the queue they sit in is still owed"
    );
}

#[test]
fn one_track_of_the_slice_still_unknown_holds_the_cut() {
    let (_dir, engine) = library(&sixty(ELEVATION_STATE_FETCHED));
    decide(&engine, "r24", ELEVATION_STATE_UNKNOWN);

    assert!(!ready(&engine));

    decide(&engine, "r24", ELEVATION_STATE_UNAVAILABLE);
    assert!(ready(&engine), "a track upstream cannot elevate is decided");
}

#[test]
fn the_window_ends_ninety_days_before_the_newest_track() {
    let (_dir, engine) = library(&[
        track("newest", 0, ELEVATION_STATE_FETCHED),
        track("on_the_edge", 90, ELEVATION_STATE_UNKNOWN),
        track("past_it", 91, ELEVATION_STATE_UNKNOWN),
    ]);
    assert!(!ready(&engine), "ninety days back is inside the slice");

    decide(&engine, "on_the_edge", ELEVATION_STATE_FETCHED);
    assert!(ready(&engine), "ninety-one days back is not");
}

#[test]
fn the_window_is_measured_from_the_newest_track_and_not_from_the_clock() {
    // An athlete who stopped riding years ago still has a newest slice.
    let (_dir, engine) = library(&[
        track("last", 0, ELEVATION_STATE_UNKNOWN),
        track("before", 30, ELEVATION_STATE_FETCHED),
    ]);

    assert!(!ready(&engine), "the newest ride is owed");
    decide(&engine, "last", ELEVATION_STATE_FETCHED);
    assert!(ready(&engine));
}

#[test]
fn a_slice_never_holds_more_than_the_upgrade_day_can_fetch() {
    let share = i64::from(UPGRADE_DAY_BACKFILL_SHARE);
    let tracks: Vec<Track> = (0..share + 200)
        .map(|i| {
            let state = if i < share {
                ELEVATION_STATE_FETCHED
            } else {
                ELEVATION_STATE_UNKNOWN
            };
            track(&format!("r{i:03}"), i / 20, state)
        })
        .collect();
    let (_dir, engine) = library(&tracks);

    assert!(
        ready(&engine),
        "the 1,500 newest are decided, the 200 are not asked"
    );

    decide(&engine, "r1499", ELEVATION_STATE_UNKNOWN);
    assert!(
        !ready(&engine),
        "the 1,500th newest is the last one in the slice"
    );
}

#[test]
fn a_library_with_nothing_owed_and_an_empty_one_are_ready() {
    let (_dir, empty) = library(&[]);
    assert!(ready(&empty));

    let (_dir, decided) = library(&[
        track("a", 0, ELEVATION_STATE_FETCHED),
        track("b", 400, ELEVATION_STATE_UNAVAILABLE),
    ]);
    assert!(ready(&decided));
}

#[test]
fn a_recording_upstream_cannot_name_is_not_part_of_the_slice() {
    let (_dir, engine) = library(&[
        track("local-1", 0, ELEVATION_STATE_UNKNOWN),
        track("a", 1, ELEVATION_STATE_FETCHED),
    ]);

    assert!(
        ready(&engine),
        "the queue never asks about it, so it cannot hold the cut"
    );
}

#[test]
fn the_queue_splits_into_the_slice_and_the_rest_in_the_order_it_came() {
    let queue: Vec<(String, String)> = ["a", "b", "c", "d", "e"]
        .iter()
        .map(|id| (id.to_string(), "Ride".to_string()))
        .collect();
    let slice: std::collections::HashSet<String> =
        ["e", "b", "c"].iter().map(|s| s.to_string()).collect();

    let (head, tail) = split_at_slice(&queue, &slice);

    let ids = |part: &[(String, String)]| part.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&head), ["b", "c", "e"]);
    assert_eq!(ids(&tail), ["a", "d"]);
}

/// Scenario: the newest rides are decided and an old one is still owed, and
/// the athlete is signed out, so the download cannot run.
/// Expected behaviour: the library is not ready, since a detect cannot hold
/// the old flat ride out of its pool without a download to wait on. Signed in,
/// it is.
#[test]
fn a_decided_slice_is_ready_to_cut_only_while_the_download_can_run() {
    let _serial = crate::test_globals::serial_global_state();
    let (_dir, engine) = library(&sixty(ELEVATION_STATE_FETCHED));

    crate::objects::clear_test_credentials();
    assert!(!cutover_ready(&engine.db).expect("reads"));

    let _creds = crate::objects::test_credentials();
    assert!(cutover_ready(&engine.db).expect("reads"));

    decide(&engine, "r24", ELEVATION_STATE_UNKNOWN);
    assert!(!cutover_ready(&engine.db).expect("reads"));
    crate::objects::clear_test_credentials();
}

#[test]
fn a_library_with_nothing_owed_is_ready_to_cut_signed_out() {
    let _serial = crate::test_globals::serial_global_state();
    let (_dir, engine) = library(&[track("a", 0, ELEVATION_STATE_FETCHED)]);

    crate::objects::clear_test_credentials();
    assert!(cutover_ready(&engine.db).expect("reads"));
}

/// Scenario: an upgraded library owes elevation for 1,200 tracks, all inside
/// the newest ninety days, and the cutover marks the budget day.
///
/// Expected behaviour: the whole slice is asked for before the first cut, and
/// the upgrade day's share admits a request for each track at one instant with
/// room left.
#[test]
fn an_upgrade_day_draws_the_whole_first_cut_slice_without_a_deferral() {
    use crate::governor::{Admission, Budget, Intent};

    let tracks: Vec<Track> = (0..1_200)
        .map(|i| track(&format!("r{i:04}"), i / 20, ELEVATION_STATE_UNKNOWN))
        .collect();
    let (_dir, engine) = library(&tracks);
    let slice = pooled_cutover_slice(&engine.db).expect("slice reads");
    assert_eq!(slice.len(), 1_200, "every owed track is in the first cut");

    let now = chrono::DateTime::parse_from_rfc3339("2026-10-20T12:00:00Z")
        .expect("fixed time")
        .with_timezone(&chrono::Utc);
    let mut budget = Budget::new(0);
    budget.mark_upgrade_day(now);
    for (n, _) in slice.iter().enumerate() {
        assert_eq!(
            budget.admit(Intent::Backfill, now),
            Admission::Admitted,
            "slice request {n}"
        );
    }
}
