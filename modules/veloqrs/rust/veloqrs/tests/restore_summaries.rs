//! The restore list (`get_all_section_summaries`) must describe a section the
//! same way the canonical summaries read does. It is a separate code path, so
//! a field it derives differently is a field the hidden-sections sheet lies
//! about.
//!
//! Run: `cargo test --test restore_summaries -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();
    let engine = PersistentEngine::new(&path_str).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
}

fn insert_activity(db: &Connection, id: &str, sport: &str) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                  start_date, name, distance_meters, duration_secs)
         VALUES (?1, ?2, 46.0, 46.1, 7.0, 7.1, 1700000000, ?1, 1000.0, 300)",
        params![id, sport],
    )
    .expect("insert activity");
    db.execute(
        "INSERT INTO activity_metrics (activity_id, name, date, distance,
                                       moving_time, elapsed_time, elevation_gain, sport_type)
         VALUES (?1, ?1, 1700000000, 1000.0, 300, 300, 10.0, ?2)",
        params![id, sport],
    )
    .expect("insert metrics");
}

fn insert_section(db: &Connection, id: &str, sport: &str) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version,
                               bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                               created_at, updated_at)
         VALUES (?1, 'auto', ?1, ?2, '[]', 500.0, 0, 1,
                 46.0, 46.01, 7.0, 7.01, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id, sport],
    )
    .expect("insert section");
}

fn insert_traversal(db: &Connection, section_id: &str, activity_id: &str) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, excluded)
         VALUES (?1, ?2, 'same', 0, 0, 500.0, 0)",
        params![section_id, activity_id],
    )
    .expect("insert traversal");
}

/// A cross-sport section reports every sport on the restore list, exactly as
/// the canonical summaries path derives it from the junction.
#[test]
fn restore_list_carries_every_sport() {
    let s = setup();
    insert_activity(&s.raw, "ride1", "Ride");
    insert_activity(&s.raw, "run1", "Run");
    insert_section(&s.raw, "sec", "Ride");
    insert_traversal(&s.raw, "sec", "ride1");
    insert_traversal(&s.raw, "sec", "run1");

    let canonical = s
        .engine
        .get_section_summaries()
        .into_iter()
        .find(|x| x.id == "sec")
        .expect("canonical summary");
    let mut canonical_sports = canonical.sport_types.clone();
    canonical_sports.sort();
    assert_eq!(
        canonical_sports,
        vec!["Ride".to_string(), "Run".to_string()],
        "canonical path lost a sport; fixture broken"
    );

    let restore = s
        .engine
        .get_all_section_summaries(None)
        .into_iter()
        .find(|x| x.id == "sec")
        .expect("restore summary");
    let mut restore_sports = restore.sport_types.clone();
    restore_sports.sort();
    assert_eq!(
        restore_sports, canonical_sports,
        "restore list disagrees with the canonical summaries on sport_types"
    );
}
