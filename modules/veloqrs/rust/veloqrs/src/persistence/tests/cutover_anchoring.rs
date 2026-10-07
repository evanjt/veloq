//! The athlete's own 0.3.x sections, accepted or trimmed, carry no reference
//! triple. The cutover places each on a stored track and writes a ledger row.

use crate::persistence::PersistentEngine;
use crate::persistence::codec;
use rusqlite::params;
use tempfile::TempDir;
use tracematch::GpsPoint;

fn ride(longitude: f64) -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.000_1,
            longitude,
            elevation: None,
        })
        .collect()
}

/// A schema-12 shaped row: a line, no triple, no source.
fn insert_unanchored(
    engine: &PersistentEngine,
    id: &str,
    line: &[GpsPoint],
    representative: &str,
    accepted: bool,
    trimmed: bool,
) {
    engine
        .db
        .execute(
            "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_json, polyline_blob,
                  distance_meters, representative_activity_id, created_at,
                  is_user_defined, original_polyline_json)
             VALUES (?, 'auto', ?, 'Ride', NULL, ?, 400.0, ?, '2026-01-01T00:00:00Z', ?, ?)",
            params![
                id,
                format!("Name of {id}"),
                codec::serialize_track_points(line),
                representative,
                accepted as i64,
                trimmed.then_some("[]"),
            ],
        )
        .expect("insert the section");
}

fn triple(
    engine: &PersistentEngine,
    id: &str,
) -> (Option<String>, Option<u32>, Option<u32>, Option<String>) {
    engine
        .db
        .query_row(
            "SELECT representative_activity_id, rep_start_index, rep_end_index, geometry_source
             FROM sections WHERE id = ?",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("the row")
}

fn line_of(engine: &PersistentEngine, id: &str) -> Vec<GpsPoint> {
    engine.stored_section_polyline(id).expect("the line")
}

fn anchored_events(engine: &PersistentEngine, id: &str) -> Vec<serde_json::Value> {
    let mut stmt = engine
        .db
        .prepare("SELECT details FROM section_history WHERE section_id = ? AND kind = 'reference_anchored'")
        .expect("prepare");
    stmt.query_map([id], |row| row.get::<_, String>(0))
        .expect("query")
        .map(|d| serde_json::from_str(&d.expect("details")).expect("json"))
        .collect()
}

fn library(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("anchor.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .add_activity("a1".into(), ride(7.0), "Ride".into())
        .expect("add_activity");
    engine
}

/// Scenario: an accepted row whose line is a verbatim slice of its representative.
/// Expected behaviour: the triple is written, the drawn line is untouched, and
/// one event says it did not move.
#[test]
fn a_verbatim_slice_is_anchored_without_moving() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir);
    let slice = ride(7.0)[10..30].to_vec();
    insert_unanchored(&engine, "s_a", &slice, "a1", true, false);

    assert_eq!(engine.anchor_user_owned_references().expect("pass"), 1);

    assert_eq!(
        triple(&engine, "s_a"),
        (Some("a1".into()), Some(10), Some(30), Some("exact".into()))
    );
    assert_eq!(line_of(&engine, "s_a"), slice);
    let events = anchored_events(&engine, "s_a");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["moved"], false);
    assert_eq!(events[0]["activity"], "a1");
    assert_eq!(events[0]["start_index"], 10);
    assert_eq!(events[0]["end_index"], 30);
}

/// Scenario: a trimmed row whose line is an averaged line a few metres off the track.
/// Expected behaviour: the line becomes the track's slice between the nearest
/// points, and the event says it moved.
#[test]
fn an_averaged_line_is_replaced_by_the_track_slice() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir);
    let near: Vec<GpsPoint> = ride(7.000_02)[10..30].to_vec();
    insert_unanchored(&engine, "s_b", &near, "a1", false, true);

    assert_eq!(engine.anchor_user_owned_references().expect("pass"), 1);

    assert_eq!(
        triple(&engine, "s_b"),
        (Some("a1".into()), Some(10), Some(30), Some("exact".into()))
    );
    assert_eq!(line_of(&engine, "s_b"), ride(7.0)[10..=29].to_vec());
    let events = anchored_events(&engine, "s_b");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["moved"], true);
}

/// Scenario: the representative's track is not stored, a member's covers the line.
/// Expected behaviour: the row is anchored on the member.
#[test]
fn a_member_carries_a_row_whose_representative_is_absent() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir);
    let slice = ride(7.0)[5..25].to_vec();
    insert_unanchored(&engine, "s_c", &slice, "gone", true, false);
    engine.add_section_activity("s_c", "a1").expect("member");

    assert_eq!(engine.anchor_user_owned_references().expect("pass"), 1);

    assert_eq!(
        triple(&engine, "s_c"),
        (Some("a1".into()), Some(5), Some(25), Some("exact".into()))
    );
}

/// Scenario: no stored track covers the row.
/// Expected behaviour: the row is untouched, owed again, and no event is written.
#[test]
fn a_row_no_track_covers_is_left_alone() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir);
    insert_unanchored(&engine, "s_d", &ride(9.0)[5..25], "a1", true, false);

    assert_eq!(engine.anchor_user_owned_references().expect("pass"), 0);

    assert_eq!(
        triple(&engine, "s_d"),
        (Some("a1".into()), None, None, None)
    );
    assert!(anchored_events(&engine, "s_d").is_empty());
    assert!(crate::persistence::sections::anchoring_owed(&engine.db));
}

/// Scenario: the pass runs twice.
/// Expected behaviour: the second run finds nothing and writes no further event.
#[test]
fn a_second_run_writes_nothing() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir);
    insert_unanchored(&engine, "s_a", &ride(7.0)[10..30], "a1", true, false);
    engine.anchor_user_owned_references().expect("first");

    assert_eq!(engine.anchor_user_owned_references().expect("second"), 0);

    assert_eq!(anchored_events(&engine, "s_a").len(), 1);
    assert!(!crate::persistence::sections::anchoring_owed(&engine.db));
}

/// Scenario: a named row is pinned to its averaged baseline.
/// Expected behaviour: the pin moves to the anchored version, which draws the slice.
#[test]
fn a_pin_on_the_averaged_baseline_moves_to_the_anchored_version() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir);
    let near: Vec<GpsPoint> = ride(7.000_02)[10..30].to_vec();
    insert_unanchored(&engine, "s_b", &near, "a1", true, false);
    engine
        .db
        .execute(
            "INSERT INTO section_geometry (section_id, version, encoding, blob, milestone, source)
             VALUES ('s_b', 1, 'quantised', ?, 1, 'consensus')",
            [codec::encode_polyline(&near)],
        )
        .or_else(|_| {
            engine.db.execute(
                "INSERT INTO section_geometry (section_id, version, blob, milestone, source)
                 VALUES ('s_b', 1, ?, 1, 'consensus')",
                [codec::encode_polyline(&near)],
            )
        })
        .expect("baseline");
    engine
        .db
        .execute(
            "INSERT INTO section_pins (section_id, version) VALUES ('s_b', 1)",
            [],
        )
        .expect("pin");

    engine.anchor_user_owned_references().expect("pass");

    let pinned = engine.pinned_section_version("s_b").expect("still pinned");
    assert_ne!(pinned, 1);
    assert_eq!(
        engine
            .section_geometry_polyline("s_b", pinned)
            .expect("drawn"),
        ride(7.0)[10..=29].to_vec()
    );
}

/// Scenario: a 0.3.x library holding only accepted rows, never flipped.
/// Expected behaviour: the flip is owed, and stops being owed once flipped.
#[test]
fn a_library_of_only_accepted_rows_is_owed_the_flip() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir);
    assert!(!engine.cutover_is_owed());
    insert_unanchored(&engine, "s_a", &ride(7.0)[10..30], "a1", true, false);
    assert!(engine.cutover_is_owed());
}
