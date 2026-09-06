//! A section's line is a triple into one stored stream, so when the activity
//! it points at leaves intervals.icu the line has to be re-anchored before the
//! row goes.
//!
//! The replacement is a lookup, not a match: `section_activities` already
//! holds every member's own slice. Re-anchor first, because that table
//! cascades on `activities(id)` and the delete would take the candidate list
//! with it.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test section_reference_reanchor -p veloqrs`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn db_path(dir: &TempDir) -> std::path::PathBuf {
    dir.path().join("routes.db")
}

/// A second handle on the same file, for seeding rows the engine has no
/// setter for and for reading what it wrote.
fn conn(dir: &TempDir) -> Connection {
    Connection::open(db_path(dir)).expect("open the database directly")
}

fn track(offset: f64) -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0 + offset,
            elevation: None,
        })
        .collect()
}

/// A section anchored to `anchor`, with `members` as its rows, each carrying
/// its own slice of its own track.
fn engine_with_section(
    dir: &TempDir,
    anchor: &str,
    members: &[(&str, u32, u32, f64)],
) -> PersistentEngine {
    let path = db_path(dir);
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    for (i, (id, _, _, _)) in members.iter().enumerate() {
        engine
            .add_activity((*id).to_string(), track(i as f64 * 0.0001), "Ride".into())
            .expect("store activity");
    }

    let (_, a_start, a_end, distance) = members
        .iter()
        .find(|(id, _, _, _)| id == &anchor)
        .expect("the anchor is a member");
    let polyline = engine.get_gps_track(anchor).expect("anchor track")
        [*a_start as usize..=*a_end as usize]
        .to_vec();
    let blob = veloqrs::persistence::codec::serialize_track_points(&polyline);

    conn(dir)
        .execute(
            "INSERT INTO sections
                 (id, name, sport_type, section_type, polyline_blob, distance_meters,
                  visit_count, created_at, source_activity_id, start_index, end_index,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('s1', 'Section 1', 'Ride', 'auto', ?, ?, ?, datetime('now'),
                     ?, ?, ?, 0, 0, 0, 0)",
            params![blob, distance, members.len() as u32, anchor, a_start, a_end],
        )
        .expect("seed the section");
    let seed = conn(dir);
    for (id, start, end, member_distance) in members {
        seed.execute(
            "INSERT INTO section_activities
                     (section_id, activity_id, start_index, end_index, distance_meters, excluded)
                 VALUES ('s1', ?, ?, ?, ?, 0)",
            params![id, start, end, member_distance],
        )
        .expect("seed a member");
    }
    engine
}

fn anchor_of(conn: &Connection) -> (Option<String>, Option<u32>, Option<u32>) {
    conn.query_row(
        "SELECT source_activity_id, start_index, end_index FROM sections WHERE id = 's1'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .expect("read the anchor")
}

#[test]
fn the_reference_moves_to_the_member_whose_pass_is_closest_in_length() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_section(
        &dir,
        "gone",
        &[
            ("gone", 10, 40, 1000.0),
            ("far", 5, 20, 400.0),
            ("close", 12, 42, 990.0),
        ],
    );

    let moved = engine
        .reanchor_section_reference("s1", "gone")
        .expect("re-anchor");

    assert_eq!(moved.as_deref(), Some("close"));
    let (activity, start, end) = anchor_of(&conn(&dir));
    assert_eq!(activity.as_deref(), Some("close"));
    assert_eq!((start, end), (Some(12), Some(42)));
}

/// Deterministic and reproducible: two members equally close break on the id.
#[test]
fn a_tie_breaks_on_the_activity_id() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_section(
        &dir,
        "gone",
        &[
            ("gone", 10, 40, 1000.0),
            ("zulu", 1, 31, 900.0),
            ("alpha", 2, 32, 1100.0),
        ],
    );

    let moved = engine
        .reanchor_section_reference("s1", "gone")
        .expect("re-anchor");

    assert_eq!(
        moved.as_deref(),
        Some("alpha"),
        "100 m either side, so the id decides"
    );
}

/// A member the user excluded is not a candidate: it is not a pass the
/// section counts.
#[test]
fn an_excluded_member_is_never_the_new_reference() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_section(
        &dir,
        "gone",
        &[("gone", 10, 40, 1000.0), ("dropped", 12, 42, 1000.0)],
    );
    conn(&dir)
        .execute(
            "UPDATE section_activities SET excluded = 1 WHERE activity_id = 'dropped'",
            [],
        )
        .expect("exclude");

    assert_eq!(
        engine
            .reanchor_section_reference("s1", "gone")
            .expect("call"),
        None,
        "nothing left to anchor to"
    );
    assert_eq!(
        anchor_of(&conn(&dir)).0.as_deref(),
        Some("gone"),
        "the anchor is left alone so the caller can protect the row"
    );
}

/// A section whose only visit was the vanished activity has nothing to
/// re-anchor to, and today's behaviour stands: the row is protected.
#[test]
fn a_section_with_no_other_member_is_left_alone() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_section(&dir, "gone", &[("gone", 10, 40, 1000.0)]);

    assert_eq!(
        engine
            .reanchor_section_reference("s1", "gone")
            .expect("call"),
        None
    );
    assert_eq!(anchor_of(&conn(&dir)).0.as_deref(), Some("gone"));
}

/// The line the section carries after the move is the new member's own slice,
/// and the one before it stays recoverable.
#[test]
fn the_line_becomes_the_new_members_own_slice_and_the_old_one_is_kept() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_section(
        &dir,
        "gone",
        &[("gone", 10, 40, 1000.0), ("close", 12, 42, 1000.0)],
    );

    engine
        .reanchor_section_reference("s1", "gone")
        .expect("re-anchor");

    let expected = engine.get_gps_track("close").expect("track")[12..=42].to_vec();
    let stored = engine.get_section("s1").expect("section").polyline;
    assert_eq!(stored.len(), expected.len());
    assert_eq!(stored.first(), expected.first());
    assert_eq!(stored.last(), expected.last());

    let versions: i64 = conn(&dir)
        .query_row(
            "SELECT count(*) FROM section_geometry WHERE section_id = 's1'",
            [],
            |row| row.get(0),
        )
        .expect("count versions");
    assert!(
        versions >= 1,
        "the move is a stored version, so the prior line is recoverable"
    );
}

/// The athlete can read why the line moved: which activity was the reference,
/// which replaced it, and the cause.
#[test]
fn the_move_is_written_into_the_ledger_with_both_ids() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_section(
        &dir,
        "gone",
        &[("gone", 10, 40, 1000.0), ("close", 12, 42, 1000.0)],
    );

    engine
        .reanchor_section_reference("s1", "gone")
        .expect("re-anchor");

    let (kind, details): (String, Option<String>) = conn(&dir)
        .query_row(
            "SELECT kind, details FROM section_history
             WHERE section_id = 's1' ORDER BY id DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read the ledger");

    assert_eq!(kind, "reference_reanchored");
    let details = details.expect("the entry names both activities");
    let parsed: serde_json::Value = serde_json::from_str(&details).expect("json details");
    assert_eq!(parsed["from"].as_str(), Some("gone"));
    assert_eq!(parsed["to"].as_str(), Some("close"));
    assert_eq!(parsed["cause"].as_str(), Some("activity_removed"));
}
