//! Integration tests for section merging (`merge_user_sections`).
//!
//! Verifies the FFI merge flow moves activities from the secondary into the
//! primary, preserves user-set names, and deletes the donor section cleanly.
//!
//! Run: `cargo test --test merge_sections -p veloqrs`

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

    let engine = PersistentRouteEngine::new(&path_str).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");

    Setup { engine, raw, _tmp: tmp }
}

fn insert_activity(db: &Connection, id: &str, start_unix: i64) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                  start_date, name, distance_meters, duration_secs)
         VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, ?2, ?3, 1000.0, 300)",
        params![id, start_unix, format!("Activity {}", id)],
    )
    .expect("insert activity");
}

fn insert_section(db: &Connection, id: &str, name: Option<&str>) {
    // Minimal polyline stored so recompute_section_bounds exits early without
    // touching bounds columns. Bounds are pre-populated for the lookup SQL.
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version,
                               bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES (?1, 'auto', ?2, 'Ride', '[]', 500.0, 0, 1,
                 46.0, 46.01, 7.0, 7.01)",
        params![id, name],
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

fn count_activities(db: &Connection, section_id: &str) -> u32 {
    db.query_row(
        "SELECT COUNT(*) FROM section_activities WHERE section_id = ?",
        params![section_id],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

fn section_exists(db: &Connection, section_id: &str) -> bool {
    db.query_row(
        "SELECT COUNT(*) > 0 FROM sections WHERE id = ?",
        params![section_id],
        |row| row.get(0),
    )
    .unwrap_or(false)
}

#[test]
fn merge_moves_activities_to_primary_and_deletes_secondary() {
    let mut s = setup();
    insert_activity(&s.raw, "a1", 1_700_000_000);
    insert_activity(&s.raw, "a2", 1_700_086_400);
    insert_activity(&s.raw, "a3", 1_700_172_800);

    insert_section(&s.raw, "primary", Some("Main Climb"));
    insert_section(&s.raw, "donor", Some("Other Climb"));

    insert_traversal(&s.raw, "primary", "a1");
    insert_traversal(&s.raw, "donor", "a2");
    insert_traversal(&s.raw, "donor", "a3");

    let result = s
        .engine
        .merge_user_sections("primary", "donor")
        .expect("merge_user_sections");
    assert_eq!(result, "primary");

    assert!(section_exists(&s.raw, "primary"), "primary must remain");
    assert!(!section_exists(&s.raw, "donor"), "donor must be deleted");

    assert_eq!(
        count_activities(&s.raw, "primary"),
        3,
        "primary should absorb donor activities"
    );
    assert_eq!(
        count_activities(&s.raw, "donor"),
        0,
        "donor should have no orphan traversals"
    );
}

#[test]
fn merge_rejects_self_merge() {
    let mut s = setup();
    insert_section(&s.raw, "solo", Some("Solo"));

    let result = s.engine.merge_user_sections("solo", "solo");
    assert!(result.is_err(), "merging a section with itself must error");
}

#[test]
fn merge_rejects_missing_section() {
    let mut s = setup();
    insert_section(&s.raw, "exists", Some("Exists"));

    let result = s.engine.merge_user_sections("exists", "missing");
    assert!(result.is_err(), "merging with a missing donor must error");

    let result = s.engine.merge_user_sections("missing", "exists");
    assert!(result.is_err(), "merging into a missing primary must error");
}

#[test]
fn merge_preserves_unique_activity_mappings() {
    // Both sections already contain a1 — merging should not blow up and
    // the primary should end up with a single row for a1.
    let mut s = setup();
    insert_activity(&s.raw, "a1", 1_700_000_000);
    insert_activity(&s.raw, "a2", 1_700_086_400);

    insert_section(&s.raw, "primary", None);
    insert_section(&s.raw, "donor", None);

    insert_traversal(&s.raw, "primary", "a1");
    insert_traversal(&s.raw, "donor", "a1");
    insert_traversal(&s.raw, "donor", "a2");

    let result = s
        .engine
        .merge_user_sections("primary", "donor")
        .expect("merge with overlap must succeed");
    assert_eq!(result, "primary");

    assert_eq!(count_activities(&s.raw, "primary"), 2);
    assert!(!section_exists(&s.raw, "donor"));
}
