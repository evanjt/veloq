//! The lap-time backfill fills a portion's time from its activity's stream.
//! A portion whose activity has no stream cannot be filled by it, and asking
//! again on every launch is work the answer never changes.
//!
//! Run: `cargo test --test lap_time_backfill_scope -p veloqrs`

use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn track() -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

/// One section over two activities, both portions without a lap time.
/// Neither activity has a stream until a test gives it one.
fn open(path: &Path) -> PersistentEngine {
    PersistentEngine::new(path.to_str().unwrap()).expect("engine")
}

fn conn(path: &Path) -> Connection {
    Connection::open(path).expect("raw open")
}

fn seed(dir: &TempDir) -> PathBuf {
    let path = dir.path().join("backfill.db");
    let mut engine = open(&path);
    for id in ["streamed", "bare"] {
        engine
            .add_activity(id.into(), track(), "Ride".into())
            .expect("add activity");
    }
    drop(engine);

    let db = conn(&path);
    db.execute(
        "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_json, distance_meters,
                  representative_activity_id, created_at, is_user_defined,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('s1', 'auto', 'S', 'Ride', '[]', 900.0, 'streamed',
                     '2026-01-01T00:00:00Z', 0, 46.0, 46.1, 7.0, 7.1)",
        [],
    )
    .expect("insert section");
    for id in ["streamed", "bare"] {
        db.execute(
            "INSERT INTO section_activities
                     (section_id, activity_id, start_index, end_index, distance_meters, lap_time)
                 VALUES ('s1', ?, 0, 21, 900.0, NULL)",
            params![id],
        )
        .expect("insert portion");
    }
    path
}

fn lap_time(db: &Connection, activity_id: &str) -> Option<f64> {
    db.query_row(
        "SELECT lap_time FROM section_activities WHERE activity_id = ?",
        params![activity_id],
        |row| row.get(0),
    )
    .expect("portion row")
}

#[test]
fn a_portion_with_no_stream_is_not_examined() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let mut engine = open(&path);

    assert_eq!(
        engine.backfill_section_performance_cache(),
        0,
        "portions no stream can resolve were still examined"
    );
    assert_eq!(lap_time(&db, "bare"), None);
}

#[test]
fn a_portion_whose_stream_has_landed_is_filled() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let mut engine = open(&path);
    let times: Vec<u32> = (0..40).collect();
    engine.set_time_streams_flat(&["streamed".into()], &times, &[0]);

    // The portion runs 0..21 half-open, so it holds twenty-one points and
    // spans twenty seconds of a one-second-per-point stream.
    assert_eq!(lap_time(&db, "streamed"), Some(20.0));
    assert_eq!(lap_time(&db, "bare"), None);
}

#[test]
fn only_the_streamed_portion_is_examined_once_a_stream_lands() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let mut engine = open(&path);
    let times: Vec<u32> = (0..40).collect();
    db.execute(
        "INSERT INTO time_streams (activity_id, times, point_count) VALUES ('streamed', ?, 40)",
        params![veloqrs::persistence::codec::serialize(&times).expect("encode")],
    )
    .expect("store the stream");

    assert_eq!(engine.backfill_section_performance_cache(), 1);
    // The portion runs 0..21 half-open, so it holds twenty-one points and
    // spans twenty seconds of a one-second-per-point stream.
    assert_eq!(lap_time(&db, "streamed"), Some(20.0));
    assert_eq!(lap_time(&db, "bare"), None);
}

#[test]
fn a_filled_portion_is_not_examined_again() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let mut engine = open(&path);
    let times: Vec<u32> = (0..40).collect();
    engine.set_time_streams_flat(&["streamed".into()], &times, &[0]);

    assert_eq!(engine.backfill_section_performance_cache(), 0);
}

#[test]
fn an_excluded_portion_is_never_examined() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let mut engine = open(&path);
    let times: Vec<u32> = (0..40).collect();
    db.execute("UPDATE section_activities SET excluded = 1", [])
        .expect("exclude both");
    db.execute(
        "INSERT INTO time_streams (activity_id, times, point_count) VALUES ('streamed', ?, 40)",
        params![veloqrs::persistence::codec::serialize(&times).expect("encode")],
    )
    .expect("store the stream");

    assert_eq!(engine.backfill_section_performance_cache(), 0);
}

/// Scenario: every released 0.3.x stored the raw `time` series, longer
/// than its track by the samples the `latlng` mask drops, and the lap times
/// computed off it are wrong. The sync now refetches such a stream, but the
/// backfill only ever filled `NULL` rows, so the wrong values would stand.
///
/// Expected behaviour: a stream that actually moved takes its activity's lap
/// times with it.
#[test]
fn a_replaced_stream_recomputes_the_lap_times_it_already_wrote() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let mut engine = open(&path);

    // The pre-mask shape: one sample per second, but forty-three of them for a
    // forty-point track, so the traversal is timed off the wrong window.
    let misaligned: Vec<u32> = (0..43).map(|i| i * 2).collect();
    db.execute(
        "INSERT INTO time_streams (activity_id, times, point_count) VALUES ('streamed', ?, 43)",
        params![veloqrs::persistence::codec::serialize(&misaligned).expect("encode")],
    )
    .expect("store the stream");
    db.execute(
        "UPDATE section_activities SET lap_time = 40.0, lap_pace = 22.5
         WHERE activity_id = 'streamed'",
        [],
    )
    .expect("the wrong value the old stream produced");

    // What the mask-reduced fetch answers: one per point, one second apart.
    let aligned: Vec<u32> = (0..40).collect();
    engine.set_time_streams_flat(&["streamed".into()], &aligned, &[0]);

    assert_eq!(
        lap_time(&db, "streamed"),
        Some(20.0),
        "the replaced stream must take the lap time it already wrote with it"
    );
}

/// A stream that did not move leaves the lap times alone, so a routine sync
/// re-storing the same series costs nothing.
#[test]
fn an_unchanged_stream_leaves_the_lap_times_where_they_are() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let mut engine = open(&path);
    let times: Vec<u32> = (0..40).collect();
    engine.set_time_streams_flat(&["streamed".into()], &times, &[0]);
    assert_eq!(lap_time(&db, "streamed"), Some(20.0));

    db.execute(
        "UPDATE section_activities SET lap_time = 99.0 WHERE activity_id = 'streamed'",
        [],
    )
    .unwrap();
    engine.set_time_streams_flat(&["streamed".into()], &times, &[0]);

    assert_eq!(
        lap_time(&db, "streamed"),
        Some(99.0),
        "nothing moved, so nothing was recomputed"
    );
}
