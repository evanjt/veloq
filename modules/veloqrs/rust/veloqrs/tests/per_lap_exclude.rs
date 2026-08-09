//! Per-lap exclusion (E6): an exclusion targets a junction row, not an
//! activity. Excluding one lap of an interval session removes exactly that
//! traversal from counts and the performance panel, and the whole-activity
//! excluded list only names activities with no included rows left.
//!
//! Run: `cargo test --test per_lap_exclude -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

struct Setup {
    engine: PersistentRouteEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();
    let engine = PersistentRouteEngine::new(&path_str).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
}

fn insert_activity(db: &Connection, id: &str) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                  start_date, name, distance_meters, duration_secs)
         VALUES (?1, 'Run', 46.0, 46.1, 7.0, 7.1, 1700000000, ?1, 1000.0, 300)",
        params![id],
    )
    .expect("insert activity");
    db.execute(
        "INSERT INTO activity_metrics (activity_id, name, date, distance,
                                       moving_time, elapsed_time, elevation_gain, sport_type)
         VALUES (?1, ?1, 1700000000, 1000.0, 300, 300, 10.0, 'Run')",
        params![id],
    )
    .expect("insert metrics");
}

fn insert_section(db: &Connection, id: &str) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version,
                               bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                               created_at, updated_at)
         VALUES (?1, 'auto', ?1, 'Run', '[]', 500.0, 0, 1,
                 46.0, 46.01, 7.0, 7.01, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id],
    )
    .expect("insert section");
}

fn insert_lap(db: &Connection, section_id: &str, activity_id: &str, start_index: u32) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, lap_pace, excluded)
         VALUES (?1, ?2, 'same', ?3, ?3 + 50, 500.0, 120.0, 4.2, 0)",
        params![section_id, activity_id, start_index],
    )
    .expect("insert lap");
}

fn visit_count(db: &Connection, section_id: &str) -> i64 {
    db.query_row(
        "SELECT visit_count FROM sections WHERE id = ?",
        params![section_id],
        |r| r.get(0),
    )
    .expect("visit_count read")
}

/// Three laps and one excluded row: the activity still has included
/// traversals, so it is not an excluded activity.
#[test]
fn an_activity_with_one_excluded_lap_is_not_a_fully_excluded_activity() {
    let s = setup();
    insert_activity(&s.raw, "laps");
    insert_section(&s.raw, "sec");
    insert_lap(&s.raw, "sec", "laps", 0);
    insert_lap(&s.raw, "sec", "laps", 100);
    insert_lap(&s.raw, "sec", "laps", 200);

    s.raw
        .execute(
            "UPDATE section_activities SET excluded = 1
             WHERE section_id = 'sec' AND activity_id = 'laps' AND start_index = 100",
            [],
        )
        .expect("exclude one row");

    assert_eq!(
        s.engine.get_excluded_activity_ids("sec"),
        Vec::<String>::new(),
        "an activity with included laps left must not read as excluded"
    );

    s.raw
        .execute(
            "UPDATE section_activities SET excluded = 1
             WHERE section_id = 'sec' AND activity_id = 'laps'",
            [],
        )
        .expect("exclude all rows");

    assert_eq!(
        s.engine.get_excluded_activity_ids("sec"),
        vec!["laps".to_string()],
        "an activity with every row excluded is an excluded activity"
    );
}

/// Excluding one lap removes exactly that traversal: the count drops by
/// one, the pair appears in the per-lap read, and include restores it.
#[test]
fn excluding_one_lap_keeps_the_other_traversals() {
    let s = setup();
    let mut engine = s.engine;
    insert_activity(&s.raw, "laps");
    insert_activity(&s.raw, "single");
    insert_section(&s.raw, "sec");
    insert_lap(&s.raw, "sec", "laps", 0);
    insert_lap(&s.raw, "sec", "laps", 100);
    insert_lap(&s.raw, "sec", "laps", 200);
    insert_lap(&s.raw, "sec", "single", 0);
    assert_eq!(visit_count(&s.raw, "sec"), 4);

    engine.exclude_section_lap("sec", "laps", 100).unwrap();

    assert_eq!(
        visit_count(&s.raw, "sec"),
        3,
        "one traversal leaves the count"
    );
    assert_eq!(
        engine.get_excluded_section_laps("sec"),
        vec![("laps".to_string(), 100)],
        "the excluded pair is readable per lap"
    );
    assert_eq!(
        engine.get_excluded_activity_ids("sec"),
        Vec::<String>::new(),
        "a partial exclusion is not a whole-activity exclusion"
    );

    engine.include_section_lap("sec", "laps", 100).unwrap();
    assert_eq!(
        visit_count(&s.raw, "sec"),
        4,
        "include restores the traversal"
    );
    assert_eq!(
        engine.get_excluded_section_laps("sec"),
        Vec::<(String, u32)>::new()
    );
}

/// Whole-activity exclude still takes every lap with it, and reads as a
/// fully excluded activity.
#[test]
fn whole_activity_exclude_still_takes_every_lap() {
    let s = setup();
    let mut engine = s.engine;
    insert_activity(&s.raw, "laps");
    insert_section(&s.raw, "sec");
    insert_lap(&s.raw, "sec", "laps", 0);
    insert_lap(&s.raw, "sec", "laps", 100);

    engine.exclude_activity_from_section("sec", "laps").unwrap();

    assert_eq!(visit_count(&s.raw, "sec"), 0);
    assert_eq!(
        engine.get_excluded_activity_ids("sec"),
        vec!["laps".to_string()]
    );
    assert_eq!(
        engine.get_excluded_section_laps("sec").len(),
        2,
        "both rows carry the flag"
    );
}
