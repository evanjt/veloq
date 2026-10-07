//! Integration tests for section merging (`merge_user_sections`).
//!
//! Verifies the FFI merge flow moves activities from the secondary into the
//! primary, preserves user-set names, and deletes the donor section cleanly.
//!
//! Run: `cargo test --test app -p veloqrs -- merge_sections::`

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

fn section_name(db: &Connection, section_id: &str) -> Option<String> {
    db.query_row(
        "SELECT name FROM sections WHERE id = ?",
        params![section_id],
        |row| row.get(0),
    )
    .expect("section name")
}

#[test]
fn merge_inherits_a_user_name_over_a_generated_primary_name() {
    let mut s = setup();
    insert_section(&s.raw, "primary", Some("Section 3"));
    insert_section(&s.raw, "donor", Some("Col du Pillon"));

    s.engine
        .merge_user_sections("primary", "donor")
        .expect("merge");

    assert_eq!(
        section_name(&s.raw, "primary").as_deref(),
        Some("Col du Pillon")
    );
    assert!(!section_exists(&s.raw, "donor"));
}

#[test]
fn merge_does_not_inherit_a_generated_donor_name() {
    let mut s = setup();
    insert_section(&s.raw, "primary", Some("Section 3"));
    insert_section(&s.raw, "donor", Some("Section 4"));

    s.engine
        .merge_user_sections("primary", "donor")
        .expect("merge");

    assert_eq!(
        section_name(&s.raw, "primary").as_deref(),
        Some("Section 3")
    );
}

fn name_auto_donor(s: &mut Setup) {
    let line: Vec<tracematch::GpsPoint> = (0..40)
        .map(|i| tracematch::GpsPoint::new(46.0 + f64::from(i) * 0.0001, 7.0))
        .collect();
    s.raw
        .execute(
            "UPDATE sections SET polyline_json = ?, bounds_min_lat = 46.0,
                    bounds_max_lat = 46.004, bounds_min_lng = 7.0, bounds_max_lng = 7.0
             WHERE id = 'donor'",
            params![serde_json::to_string(&line).expect("line JSON")],
        )
        .expect("donor line");
    s.engine
        .set_section_name("donor", Some("Col du Pillon"))
        .expect("name donor");
    assert_eq!(s.engine.get_named_corridors().len(), 1);
}

#[test]
fn merge_keeps_the_name_from_an_auto_donor_intent() {
    let mut s = setup();
    insert_section(&s.raw, "primary", Some("Section 3"));
    insert_section(&s.raw, "donor", Some("Section 4"));
    name_auto_donor(&mut s);

    s.engine
        .merge_user_sections("primary", "donor")
        .expect("merge");

    assert_eq!(
        section_name(&s.raw, "primary").as_deref(),
        Some("Col du Pillon")
    );
    assert!(!section_exists(&s.raw, "donor"));
}

#[test]
fn refused_merge_keeps_the_auto_donor_intent() {
    let mut s = setup();
    insert_section(&s.raw, "donor", Some("Section 4"));
    name_auto_donor(&mut s);
    let intent_id = s.engine.get_named_corridors()[0].intent_id.clone();

    assert!(s.engine.merge_user_sections("missing", "donor").is_err());

    assert!(section_exists(&s.raw, "donor"));
    let corridors = s.engine.get_named_corridors();
    assert_eq!(corridors.len(), 1);
    assert_eq!(corridors[0].intent_id, intent_id);
    assert_eq!(corridors[0].name, "Col du Pillon");
}

#[test]
fn merge_moves_activities_to_primary_and_deletes_secondary() {
    let mut s = setup();
    for id in ["a1", "a2", "a3"] {
        add_ride(&mut s, id, straight_track(46.000, 46.006));
    }

    insert_section(&s.raw, "primary", Some("Main Climb"));
    insert_section(&s.raw, "donor", Some("Other Climb"));
    give_line(&s, "primary", &straight_track(46.000, 46.006));
    give_line(&s, "donor", &straight_track(46.000, 46.006));

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
    // Both sections already contain a1, merging should not blow up and
    // the primary should end up with a single row for a1.
    let mut s = setup();
    for id in ["a1", "a2"] {
        add_ride(&mut s, id, straight_track(46.000, 46.006));
    }

    insert_section(&s.raw, "primary", None);
    insert_section(&s.raw, "donor", None);
    give_line(&s, "primary", &straight_track(46.000, 46.006));
    give_line(&s, "donor", &straight_track(46.000, 46.006));

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

fn straight_track(from_lat: f64, to_lat: f64) -> Vec<tracematch::GpsPoint> {
    let steps = ((to_lat - from_lat) / 0.0001).round() as i32;
    (0..=steps)
        .map(|i| tracematch::GpsPoint::new(from_lat + f64::from(i) * 0.0001, 7.0))
        .collect()
}

fn give_line(s: &Setup, section_id: &str, line: &[tracematch::GpsPoint]) {
    s.raw
        .execute(
            "UPDATE sections SET polyline_json = ?, bounds_min_lat = ?,
                    bounds_max_lat = ?, bounds_min_lng = 7.0, bounds_max_lng = 7.0
             WHERE id = ?",
            params![
                serde_json::to_string(line).expect("line JSON"),
                line.first().unwrap().latitude,
                line.last().unwrap().latitude,
                section_id
            ],
        )
        .expect("section line");
}

fn add_ride(s: &mut Setup, id: &str, track: Vec<tracematch::GpsPoint>) {
    s.engine
        .add_activity(id.to_string(), track, "Ride".to_string())
        .expect("add activity");
}

fn insert_traversal_at(db: &Connection, section_id: &str, activity_id: &str, start: i64) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, excluded)
         VALUES (?1, ?2, 'same', ?3, ?4, 300.0, 0)",
        params![section_id, activity_id, start, start + 30],
    )
    .expect("insert traversal");
}

fn rows_for(db: &Connection, section_id: &str, activity_id: &str) -> u32 {
    db.query_row(
        "SELECT COUNT(*) FROM section_activities WHERE section_id = ? AND activity_id = ?",
        params![section_id, activity_id],
        |row| row.get(0),
    )
    .expect("count rows")
}

/// A ride crossing both sections is held by each at its own start index.
/// Expected behaviour: after the merge the primary holds one row for that
/// pass, matched against the primary's own line, and a ride confined to the
/// donor's ground leaves the section but stays in the library.
fn overlapping_pair() -> Setup {
    let mut s = setup();
    insert_section(&s.raw, "primary", Some("Main Climb"));
    insert_section(&s.raw, "donor", Some("Other Climb"));
    give_line(&s, "primary", &straight_track(46.000, 46.006));
    give_line(&s, "donor", &straight_track(46.003, 46.009));
    add_ride(&mut s, "both", straight_track(46.000, 46.009));
    add_ride(&mut s, "donor_only", straight_track(46.0075, 46.0095));
    insert_traversal_at(&s.raw, "primary", "both", 0);
    insert_traversal_at(&s.raw, "donor", "both", 30);
    insert_traversal_at(&s.raw, "donor", "donor_only", 0);
    s
}

#[test]
fn merge_keeps_one_row_per_pass_for_a_ride_on_both_sections() {
    let mut s = overlapping_pair();

    s.engine
        .merge_user_sections("primary", "donor")
        .expect("merge");

    assert_eq!(rows_for(&s.raw, "primary", "both"), 1);
    let visits: i64 = s
        .raw
        .query_row(
            "SELECT visit_count FROM sections WHERE id = 'primary'",
            [],
            |r| r.get(0),
        )
        .expect("visit count");
    assert_eq!(visits, 1);
}

#[test]
fn merge_drops_a_donor_ride_that_never_touches_the_primary_line() {
    let mut s = overlapping_pair();

    s.engine
        .merge_user_sections("primary", "donor")
        .expect("merge");

    assert_eq!(rows_for(&s.raw, "primary", "donor_only"), 0);
    let kept: i64 = s
        .raw
        .query_row(
            "SELECT COUNT(*) FROM activities WHERE id = 'donor_only'",
            [],
            |r| r.get(0),
        )
        .expect("activity row");
    assert_eq!(kept, 1, "the ride stays in the library");
}

#[test]
fn merge_preview_lists_the_donor_rides_the_merge_would_drop() {
    let s = overlapping_pair();

    let dropped = s.engine.merge_preview("primary", "donor").expect("preview");

    let ids: Vec<&str> = dropped.iter().map(|d| d.activity_id.as_str()).collect();
    assert_eq!(ids, vec!["donor_only"]);
    assert_eq!(
        count_activities(&s.raw, "donor"),
        2,
        "preview writes nothing"
    );
    let reverse = s.engine.merge_preview("donor", "primary").expect("preview");
    assert!(reverse.iter().all(|d| d.activity_id != "both"));
}
