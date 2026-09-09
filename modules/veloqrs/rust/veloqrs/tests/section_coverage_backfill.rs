//! Coverage is the share of a section a traversal spans, and it is what the
//! record rule reads. The lap's own track length is not: GPS wobble makes that
//! longer than the section on laps that only cover part of it.
//!
//! Run: `cargo test --test section_coverage_backfill -p veloqrs`

use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

/// Forty points due north, a hundred metres apart in latitude terms.
fn track() -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0009,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

fn open(path: &Path) -> PersistentEngine {
    PersistentEngine::new(path.to_str().unwrap()).expect("engine")
}

fn conn(path: &Path) -> Connection {
    Connection::open(path).expect("raw open")
}

/// One section drawn over the whole track, with a full traversal and a
/// half one. Both carry a length the old rule would wave through.
fn seed(dir: &TempDir) -> PathBuf {
    let path = dir.path().join("coverage.db");
    let mut engine = open(&path);
    for id in ["full", "half"] {
        engine
            .add_activity(id.into(), track(), "Ride".into())
            .expect("add activity");
    }
    let polyline = veloqrs::persistence::codec::serialize_points(&track()).expect("polyline");
    drop(engine);

    let db = conn(&path);
    db.execute(
        "INSERT INTO sections
             (id, section_type, name, sport_type, polyline_blob, distance_meters,
              representative_activity_id, created_at, visit_count,
              bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES ('s1', 'auto', 'S', 'Ride', ?, 3900.0, 'full',
                 '2026-01-01T00:00:00Z', 0, 46.0, 46.1, 7.0, 7.1)",
        params![polyline],
    )
    .expect("insert section");
    // `full` runs the whole line, `half` joins at the midpoint. Both are given
    // the same generous length, which is what the old rule measured.
    db.execute(
        "INSERT INTO section_activities
             (section_id, activity_id, direction, start_index, end_index, distance_meters)
         VALUES ('s1', 'full', 'same', 0, 40, 3900.0)",
        [],
    )
    .expect("insert full portion");
    db.execute(
        "INSERT INTO section_activities
             (section_id, activity_id, direction, start_index, end_index, distance_meters)
         VALUES ('s1', 'half', 'same', 20, 40, 3400.0)",
        [],
    )
    .expect("insert half portion");
    for (id, name) in [("full", "Full lap"), ("half", "Half lap")] {
        db.execute(
            "INSERT INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, sport_type)
             VALUES (?, ?, 1767225600, 3900.0, 390, 390, 0.0, 'Ride')",
            params![id, name],
        )
        .expect("insert metrics");
    }
    path
}

fn coverage(db: &Connection, activity_id: &str) -> Option<f64> {
    db.query_row(
        "SELECT coverage FROM section_activities WHERE activity_id = ?",
        params![activity_id],
        |row| row.get(0),
    )
    .expect("read coverage")
}

#[test]
fn a_portion_is_measured_against_the_section_it_spans() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let mut engine = open(&path);

    assert_eq!(engine.backfill_section_coverage(), 2);

    let full = coverage(&db, "full").expect("full measured");
    let half = coverage(&db, "half").expect("half measured");
    assert!(
        full > 0.97,
        "a whole traversal covers the section, got {full}"
    );
    assert!(
        (0.45..0.55).contains(&half),
        "a traversal from the midpoint covers about half, got {half}"
    );
}

#[test]
fn a_measured_portion_is_not_measured_again() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);

    assert_eq!(engine.backfill_section_coverage(), 2);
    assert_eq!(engine.backfill_section_coverage(), 0);
}

#[test]
fn an_excluded_portion_is_never_measured() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    db.execute(
        "UPDATE section_activities SET excluded = 1 WHERE activity_id = 'half'",
        [],
    )
    .expect("exclude");
    let mut engine = open(&path);

    assert_eq!(engine.backfill_section_coverage(), 1);
    assert_eq!(coverage(&db, "half"), None);
}

/// The whole point of the column: the partial lap is faster over its fragment,
/// and it must not be crowned the section's best.
#[test]
fn a_partial_lap_is_not_the_record_once_coverage_is_measured() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = conn(&path);
    let times: Vec<u32> = (0..40).map(|i| i * 10).collect();
    db.execute(
        "INSERT INTO time_streams (activity_id, times, point_count) VALUES ('full', ?, 40)",
        params![veloqrs::persistence::codec::serialize(&times).expect("encode")],
    )
    .expect("full stream");
    let fast: Vec<u32> = (0..40).collect();
    db.execute(
        "INSERT INTO time_streams (activity_id, times, point_count) VALUES ('half', ?, 40)",
        params![veloqrs::persistence::codec::serialize(&fast).expect("encode")],
    )
    .expect("half stream");

    let mut engine = open(&path);
    engine.backfill_section_performance_cache();
    engine.backfill_section_coverage();

    let perf = engine.get_section_performances("s1");
    let best = perf.best_record.expect("a best record");
    assert_eq!(
        best.activity_id, "full",
        "the fragment is quicker over its own ground, so it must not hold the record"
    );
}
