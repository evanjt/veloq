//! Integration tests for `get_activity_section_encounters` and PR detection.
//!
//! Strategy: spin up a real PersistentRouteEngine (which runs migrations),
//! then insert fixtures directly via a parallel rusqlite connection. This
//! avoids the slow GPS-detection pipeline while exercising the actual SQL
//! that the production query runs.
//!
//! Run: `cargo test --test encounters -p veloqrs`

use rusqlite::{params, Connection};
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

    // Constructing the engine runs all migrations.
    let engine = PersistentRouteEngine::new(&path_str).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");

    Setup { engine, raw, _tmp: tmp }
}

fn insert_activity(db: &Connection, id: &str, start_date_unix: i64, distance_m: f64, duration_s: i64) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                  start_date, name, distance_meters, duration_secs)
         VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, ?2, ?3, ?4, ?5)",
        params![id, start_date_unix, format!("Activity {}", id), distance_m, duration_s],
    )
    .expect("insert activity");
}

fn insert_section(db: &Connection, id: &str, name: &str, distance_m: f64) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version)
         VALUES (?1, 'auto', ?2, 'Ride', '[]', ?3, 0, 1)",
        params![id, name, distance_m],
    )
    .expect("insert section");
}

fn insert_traversal(
    db: &Connection,
    section_id: &str,
    activity_id: &str,
    direction: &str,
    start_index: i64,
    distance_m: f64,
    lap_time_s: f64,
) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, lap_pace, excluded)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, 0)",
        params![
            section_id,
            activity_id,
            direction,
            start_index,
            distance_m,
            lap_time_s,
            if lap_time_s > 0.0 { distance_m / lap_time_s } else { 0.0 }
        ],
    )
    .expect("insert traversal");
}

// ============================================================================
// Basic shape and field mapping
// ============================================================================

#[test]
fn returns_empty_for_unknown_activity() {
    let setup = setup();
    let result = setup.engine.get_activity_section_encounters("does-not-exist");
    assert!(result.is_empty());
}

#[test]
fn one_section_one_traversal_yields_one_encounter() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 1000.0, 300);
    insert_section(&setup.raw, "s1", "Test Climb", 800.0);
    insert_traversal(&setup.raw, "s1", "a1", "same", 0, 800.0, 240.0);

    let result = setup.engine.get_activity_section_encounters("a1");
    assert_eq!(result.len(), 1);
    let e = &result[0];
    assert_eq!(e.section_id, "s1");
    assert_eq!(e.section_name, "Test Climb");
    assert_eq!(e.direction, "same");
    assert_eq!(e.distance_meters, 800.0);
    assert_eq!(e.lap_time, 240.0);
    assert!(e.is_pr, "single traversal is always its own PR");
    assert_eq!(e.history_times.len(), 1);
    assert_eq!(e.history_activity_ids.len(), 1);
    assert_eq!(e.history_activity_ids[0], "a1");
}

#[test]
fn forward_and_reverse_yield_two_independent_encounters() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 2000.0, 600);
    insert_section(&setup.raw, "s1", "Loop", 500.0);
    insert_traversal(&setup.raw, "s1", "a1", "same", 0, 500.0, 150.0);
    insert_traversal(&setup.raw, "s1", "a1", "reverse", 1000, 500.0, 160.0);

    let result = setup.engine.get_activity_section_encounters("a1");
    assert_eq!(result.len(), 2, "one entry per (section, direction)");

    let same = result.iter().find(|e| e.direction == "same").unwrap();
    let rev = result.iter().find(|e| e.direction == "reverse").unwrap();
    assert_eq!(same.lap_time, 150.0);
    assert_eq!(rev.lap_time, 160.0);
    assert!(same.is_pr);
    assert!(rev.is_pr, "each direction is independently its own PR");
}

#[test]
fn history_arrays_are_aligned_in_length() {
    let setup = setup();
    insert_section(&setup.raw, "s1", "Repeated", 500.0);
    for i in 0..5 {
        let id = format!("a{}", i);
        insert_activity(&setup.raw, &id, 1_700_000_000 + i * 86_400, 500.0, 200);
        insert_traversal(&setup.raw, "s1", &id, "same", 0, 500.0, 200.0 - i as f64);
    }

    let result = setup.engine.get_activity_section_encounters("a4");
    assert_eq!(result.len(), 1);
    let e = &result[0];
    assert_eq!(
        e.history_times.len(),
        e.history_activity_ids.len(),
        "history arrays must be aligned"
    );
    assert_eq!(e.history_times.len(), 5);
    assert_eq!(e.visit_count, 5);
}

#[test]
fn excluded_traversals_are_filtered_out() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 1000.0, 300);
    insert_section(&setup.raw, "s1", "Climb", 800.0);
    insert_traversal(&setup.raw, "s1", "a1", "same", 0, 800.0, 240.0);
    setup
        .raw
        .execute(
            "UPDATE section_activities SET excluded = 1 WHERE activity_id = 'a1'",
            [],
        )
        .expect("update excluded");

    let result = setup.engine.get_activity_section_encounters("a1");
    assert!(result.is_empty(), "excluded traversals must not appear");
}

#[test]
fn disabled_sections_are_filtered_out() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 1000.0, 300);
    insert_section(&setup.raw, "s1", "Hidden", 800.0);
    insert_traversal(&setup.raw, "s1", "a1", "same", 0, 800.0, 240.0);
    setup
        .raw
        .execute("UPDATE sections SET disabled = 1 WHERE id = 's1'", [])
        .expect("disable section");

    let result = setup.engine.get_activity_section_encounters("a1");
    assert!(result.is_empty(), "disabled sections must not appear");
}

// ============================================================================
// PR detection (B-1 regression: relative tolerance, not absolute)
// ============================================================================

#[test]
fn pr_short_section_within_relative_tolerance() {
    // 5s sprint section. Best is 4.99s. Diff = 0.01s, relative = 0.2% < 0.5%.
    // Both old (0.5s absolute) and new (0.5% relative) would call this a PR.
    let setup = setup();
    insert_section(&setup.raw, "s1", "Sprint", 50.0);
    insert_activity(&setup.raw, "a_best", 1_700_000_000, 50.0, 5);
    insert_traversal(&setup.raw, "s1", "a_best", "same", 0, 50.0, 4.99);
    insert_activity(&setup.raw, "a_now", 1_700_086_400, 50.0, 5);
    insert_traversal(&setup.raw, "s1", "a_now", "same", 0, 50.0, 5.0);

    let r = setup.engine.get_activity_section_encounters("a_now");
    assert_eq!(r.len(), 1);
    assert!(r[0].is_pr, "5.00s vs best 4.99s (0.2% off) should be PR");
}

#[test]
fn pr_long_section_relative_tolerance_distinguishes_from_absolute() {
    // 30-minute climb (1800s). Best 1799s; this attempt 1800s. Diff = 1s.
    // OLD absolute 0.5s tolerance: 1.0 > 0.5 → NOT PR.
    // NEW relative 0.5%: 1800 * 0.005 = 9.0; diff 1.0 < 9.0 → IS PR.
    // This test fails with the old behavior and passes with the fix.
    let setup = setup();
    insert_section(&setup.raw, "s1", "Long Climb", 5000.0);
    insert_activity(&setup.raw, "a_best", 1_700_000_000, 5000.0, 1800);
    insert_traversal(&setup.raw, "s1", "a_best", "same", 0, 5000.0, 1799.0);
    insert_activity(&setup.raw, "a_now", 1_700_086_400, 5000.0, 1800);
    insert_traversal(&setup.raw, "s1", "a_now", "same", 0, 5000.0, 1800.0);

    let r = setup.engine.get_activity_section_encounters("a_now");
    assert_eq!(r.len(), 1);
    assert!(
        r[0].is_pr,
        "1800.0s vs best 1799.0s on a 30min climb (0.06%) should be PR — proves relative tolerance"
    );
}

#[test]
fn not_pr_when_outside_relative_tolerance() {
    // 100s section. Best 90s, this 100s = 11% slower → not PR.
    let setup = setup();
    insert_section(&setup.raw, "s1", "Section", 500.0);
    insert_activity(&setup.raw, "a_best", 1_700_000_000, 500.0, 100);
    insert_traversal(&setup.raw, "s1", "a_best", "same", 0, 500.0, 90.0);
    insert_activity(&setup.raw, "a_now", 1_700_086_400, 500.0, 110);
    insert_traversal(&setup.raw, "s1", "a_now", "same", 0, 500.0, 100.0);

    let r = setup.engine.get_activity_section_encounters("a_now");
    assert_eq!(r.len(), 1);
    assert!(!r[0].is_pr, "11% slower must not be PR");
}

#[test]
fn pr_independent_per_direction() {
    // PR forward, not PR reverse — direction-aware PR detection.
    let setup = setup();
    insert_section(&setup.raw, "s1", "Loop", 500.0);
    // Older reverse traversal sets the reverse best
    insert_activity(&setup.raw, "a_old", 1_700_000_000, 500.0, 100);
    insert_traversal(&setup.raw, "s1", "a_old", "reverse", 0, 500.0, 80.0);
    // Current activity: forward is its own PR (no other forward), reverse is NOT
    insert_activity(&setup.raw, "a_now", 1_700_086_400, 500.0, 100);
    insert_traversal(&setup.raw, "s1", "a_now", "same", 0, 500.0, 100.0);
    insert_traversal(&setup.raw, "s1", "a_now", "reverse", 100, 500.0, 95.0);

    let r = setup.engine.get_activity_section_encounters("a_now");
    let same = r.iter().find(|e| e.direction == "same").unwrap();
    let rev = r.iter().find(|e| e.direction == "reverse").unwrap();
    assert!(same.is_pr, "forward direction has only this attempt → PR");
    assert!(!rev.is_pr, "reverse 95s vs reverse best 80s (18%) → not PR");
}
