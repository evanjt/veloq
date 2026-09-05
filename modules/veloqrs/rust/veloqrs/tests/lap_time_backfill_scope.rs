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
                 VALUES ('s1', ?, 0, 20, 900.0, NULL)",
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

    // The portion runs 0..20 half-open, so it holds twenty points and spans
    // nineteen seconds of a one-second-per-point stream.
    assert_eq!(lap_time(&db, "streamed"), Some(19.0));
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
    // The portion runs 0..20 half-open, so it holds twenty points and spans
    // nineteen seconds of a one-second-per-point stream.
    assert_eq!(lap_time(&db, "streamed"), Some(19.0));
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
