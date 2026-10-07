//! Scenario: an activity's track and time stream land through the writers the
//! sync uses, in either order, and are later spliced, re-stored and removed.
//!
//! Expected behaviour: a climbing activity holds one row per window length
//! that `best_climb_windows` measures on its stored track and stream, any other
//! activity holds none, and the rows follow every write that moves either
//! input and no write that does not.

use super::*;
use crate::GpsPoint;
use crate::metrics::vertical_power::{CLIMB_WINDOWS_S, best_climb_windows};
use crate::persistence::PersistentEngine;

/// Long enough that every stored window fits.
const POINTS: u32 = 1300;

/// Flat, then a rep of `rep_m` metres over 15 s from t=40, then flat again.
fn hill_rep(rep_m: f64) -> impl Fn(u32) -> f64 {
    move |t| match t {
        0..=40 => 100.0,
        41..=55 => 100.0 + rep_m * f64::from(t - 40) / 15.0,
        _ => 100.0 + rep_m,
    }
}

fn track(elevation: impl Fn(u32) -> f64) -> Vec<GpsPoint> {
    (0..POINTS)
        .map(|t| GpsPoint::with_elevation(46.0, 7.0 + f64::from(t) * 0.00003, elevation(t)))
        .collect()
}

fn store_track(engine: &mut PersistentEngine, id: &str, sport: &str, points: Vec<GpsPoint>) {
    engine
        .add_activities_batch(vec![(id.to_string(), points, sport.to_string())])
        .unwrap();
}

fn store_stream(engine: &mut PersistentEngine, id: &str, points: u32) {
    let times: Vec<u32> = (0..points).collect();
    engine.store_time_streams_flat(&[id.to_string()], &times, &[0]);
}

type Row = (u32, usize, usize, f64);

fn rows(engine: &PersistentEngine, id: &str) -> Vec<Row> {
    engine
        .db
        .prepare(
            "SELECT window_s, start_idx, end_idx, vam FROM activity_climb_bests
             WHERE activity_id = ? ORDER BY window_s",
        )
        .unwrap()
        .query_map([id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// What `best_climb_windows` gives on the track and stream as stored.
fn expected(engine: &PersistentEngine, id: &str) -> Vec<Row> {
    let elevation: Vec<Option<f64>> = engine
        .get_gps_track(id)
        .unwrap()
        .iter()
        .map(|p| p.elevation)
        .collect();
    let time = engine.load_time_stream(id).unwrap();
    best_climb_windows(&time, &elevation, &CLIMB_WINDOWS_S)
        .into_iter()
        .flatten()
        .map(|b| (b.window_s, b.start, b.end, b.vam))
        .collect()
}

fn fifteen_second_vam(rows: &[Row]) -> f64 {
    rows.iter().find(|row| row.0 == 15).unwrap().3
}

#[test]
fn a_run_holds_a_row_per_window_matching_the_computation() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_track(&mut engine, "rep", "Run", track(hill_rep(10.0)));
    assert!(rows(&engine, "rep").is_empty(), "no stream yet, no rows");

    store_stream(&mut engine, "rep", POINTS);

    let stored = rows(&engine, "rep");
    assert_eq!(stored.len(), CLIMB_WINDOWS_S.len());
    assert_eq!(stored, expected(&engine, "rep"));
    let rep = stored[0];
    assert_eq!((rep.0, rep.1, rep.2), (15, 40, 55));
    assert!(
        (rep.3 - 10.0 / 15.0 * 3600.0).abs() < 1.0,
        "15 s vam {}",
        rep.3
    );
}

#[test]
fn a_virtual_ride_holds_no_rows() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_track(&mut engine, "zwift", "VirtualRide", track(hill_rep(10.0)));
    store_stream(&mut engine, "zwift", POINTS);

    assert!(rows(&engine, "zwift").is_empty());
}

#[test]
fn a_stream_one_point_short_holds_no_rows() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_track(&mut engine, "short", "Run", track(hill_rep(10.0)));
    store_stream(&mut engine, "short", POINTS - 1);

    assert!(rows(&engine, "short").is_empty());
}

#[test]
fn a_track_replaced_under_its_stream_moves_the_rows() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_track(&mut engine, "rep", "Run", track(|_| 100.0));
    store_stream(&mut engine, "rep", POINTS);
    assert_eq!(fifteen_second_vam(&rows(&engine, "rep")), 0.0);

    store_track(&mut engine, "rep", "Run", track(hill_rep(10.0)));
    let climbed = rows(&engine, "rep");
    assert_eq!(climbed, expected(&engine, "rep"));
    assert!(fifteen_second_vam(&climbed) > 2000.0);

    // A longer track no longer lines up with the stream it had.
    let mut longer = track(hill_rep(10.0));
    longer.push(GpsPoint::with_elevation(46.0, 7.1, 110.0));
    store_track(&mut engine, "rep", "Run", longer);
    assert!(rows(&engine, "rep").is_empty());
}

#[test]
fn a_sport_change_on_an_identical_track_moves_the_rows() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_track(&mut engine, "rep", "VirtualRun", track(hill_rep(10.0)));
    store_stream(&mut engine, "rep", POINTS);
    assert!(rows(&engine, "rep").is_empty());

    store_track(&mut engine, "rep", "Run", track(hill_rep(10.0)));

    assert_eq!(rows(&engine, "rep"), expected(&engine, "rep"));
    assert_eq!(rows(&engine, "rep").len(), CLIMB_WINDOWS_S.len());
}

#[test]
fn a_flatter_splice_lowers_the_short_window() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_track(&mut engine, "rep", "Run", track(hill_rep(10.0)));
    store_stream(&mut engine, "rep", POINTS);
    let before = fifteen_second_vam(&rows(&engine, "rep"));

    let flatter: Vec<f64> = (0..POINTS).map(hill_rep(4.0)).collect();
    assert!(
        engine
            .splice_track_elevation(
                "rep",
                &flatter,
                crate::persistence::ElevationSeries::Corrected
            )
            .unwrap()
    );

    let after = rows(&engine, "rep");
    assert_eq!(after, expected(&engine, "rep"));
    assert!(fifteen_second_vam(&after) < before);
}

#[test]
fn an_identical_restore_rewrites_nothing() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    store_track(&mut engine, "rep", "Run", track(hill_rep(10.0)));
    store_stream(&mut engine, "rep", POINTS);
    let before = rows(&engine, "rep");
    assert_eq!(before.len(), CLIMB_WINDOWS_S.len());

    reset_test_refreshes();
    store_track(&mut engine, "rep", "Run", track(hill_rep(10.0)));
    store_stream(&mut engine, "rep", POINTS);

    assert_eq!(refreshes(), 0);
    assert_eq!(rows(&engine, "rep"), before);
}

#[test]
fn removing_the_activity_removes_its_rows() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    for id in ["kept", "gone", "departed"] {
        store_track(&mut engine, id, "Run", track(hill_rep(10.0)));
        store_stream(&mut engine, id, POINTS);
    }

    engine.remove_activity("gone").unwrap();
    engine.remove_departed_activity("departed").unwrap();

    assert!(rows(&engine, "gone").is_empty());
    assert!(rows(&engine, "departed").is_empty());
    assert_eq!(rows(&engine, "kept").len(), CLIMB_WINDOWS_S.len());
}

/// Scenario: a library upgraded from before the table holds tracks and streams
/// and no rows.
///
/// Expected behaviour: each activity the writer would measure is owed, a pass
/// writes its rows and leaves nothing owed, a second pass does no work, and an
/// activity the writer can never measure is not owed and never keeps a pass going.
fn upgraded_library() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    for id in ["a", "b", "c"] {
        store_track(&mut engine, id, "Run", track(hill_rep(10.0)));
        store_stream(&mut engine, id, POINTS);
    }
    engine
        .db
        .execute("DELETE FROM activity_climb_bests", [])
        .unwrap();
    engine
}

/// Pages until one finds nothing, as the worker does.
fn drain(engine: &PersistentEngine) -> usize {
    let mut attempted = std::collections::HashSet::new();
    let mut total = 0;
    loop {
        let done = engine.backfill_climb_bests_page(&mut attempted, 2).unwrap();
        if done == 0 {
            return total;
        }
        total += done;
    }
}

#[test]
fn a_library_without_rows_owes_each_measurable_activity_until_a_pass_writes_them() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = upgraded_library();
    store_track(&mut engine, "virtual", "VirtualRun", track(hill_rep(10.0)));
    store_stream(&mut engine, "virtual", POINTS);
    store_track(&mut engine, "short", "Run", track(hill_rep(10.0)));
    store_stream(&mut engine, "short", POINTS - 1);
    engine
        .db
        .execute("DELETE FROM activity_climb_bests", [])
        .unwrap();
    assert_eq!(engine.climb_bests_owed().unwrap(), 3);

    assert_eq!(drain(&engine), 3);

    assert_eq!(engine.climb_bests_owed().unwrap(), 0);
    for id in ["a", "b", "c"] {
        assert_eq!(rows(&engine, id), expected(&engine, id));
        assert_eq!(rows(&engine, id).len(), CLIMB_WINDOWS_S.len());
    }
    assert!(rows(&engine, "virtual").is_empty());
    assert!(rows(&engine, "short").is_empty());
}

#[test]
fn a_second_pass_over_a_filled_library_does_no_work() {
    let _serial = crate::test_globals::serial_global_state();
    let engine = upgraded_library();
    assert_eq!(drain(&engine), 3);

    reset_test_refreshes();
    assert_eq!(drain(&engine), 0);
    assert_eq!(refreshes(), 0);
}

#[test]
fn an_activity_that_measures_to_nothing_ends_the_pass() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = upgraded_library();
    let flat_no_elevation: Vec<GpsPoint> = (0..POINTS)
        .map(|t| GpsPoint::new(46.0, 7.0 + f64::from(t) * 0.00003))
        .collect();
    store_track(&mut engine, "bare", "Run", flat_no_elevation);
    store_stream(&mut engine, "bare", POINTS);

    assert_eq!(drain(&engine), 4);
    assert!(rows(&engine, "bare").is_empty());
}

/// Scenario: the engine opens a library that predates the rows, with no
/// credential and Route Matching at its default.
///
/// Expected behaviour: the owed work started at open fills the rows on its own
/// thread, and asking again once nothing is owed starts nothing.
#[test]
fn the_owed_work_at_open_fills_the_rows_without_a_credential() {
    use crate::objects::FfiStartOutcome;
    use crate::persistence::with_persistent_engine;

    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("climb_backfill.db");
    with_persistent_engine(|engine| {
        for id in ["a", "b"] {
            store_track(engine, id, "Run", track(hill_rep(10.0)));
            store_stream(engine, id, POINTS);
        }
        engine
            .db
            .execute("DELETE FROM activity_climb_bests", [])
            .unwrap();
    })
    .unwrap();

    crate::net::elevation_backfill::start_owed_work();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while with_persistent_engine(|engine| engine.climb_bests_owed().unwrap()).unwrap() > 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "the pass never finished"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let filled = with_persistent_engine(|engine| rows(engine, "a").len()).unwrap();
    assert_eq!(filled, CLIMB_WINDOWS_S.len());
    // The thread clears its slot just after the last page, so wait it out.
    while start_backfill() == FfiStartOutcome::Busy {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(start_backfill(), FfiStartOutcome::NotOwed);
}
