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
//! Run: `cargo test --test section -p veloqrs -- section_reference_reanchor::`

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
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                  representative_activity_id, rep_start_index, rep_end_index, geometry_source)
             VALUES ('s1', 'Section 1', 'Ride', 'auto', ?, ?, ?, datetime('now'),
                     ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, 'exact')",
            params![
                blob,
                distance,
                members.len() as u32,
                anchor,
                a_start,
                a_end,
                anchor,
                a_start,
                a_end + 1
            ],
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
        .reanchor_section_reference("s1", "gone", None)
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
        .reanchor_section_reference("s1", "gone", None)
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
            .reanchor_section_reference("s1", "gone", None)
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
            .reanchor_section_reference("s1", "gone", None)
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
        .reanchor_section_reference("s1", "gone", None)
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

fn reference_of(conn: &Connection) -> (Option<String>, Option<u32>, Option<u32>, Option<String>) {
    conn.query_row(
        "SELECT representative_activity_id, rep_start_index, rep_end_index, geometry_source
         FROM sections WHERE id = 's1'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .expect("read the reference triple")
}

/// The reference triple is what the line rebuilds from, so it moves with the
/// anchor, and its end is half-open where the anchor's is inclusive.
#[test]
fn the_reference_triple_follows_the_new_anchor_half_open() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_section(
        &dir,
        "gone",
        &[("gone", 10, 40, 1000.0), ("close", 12, 42, 1000.0)],
    );

    engine
        .reanchor_section_reference("s1", "gone", None)
        .expect("re-anchor");

    assert_eq!(
        reference_of(&conn(&dir)),
        (
            Some("close".to_string()),
            Some(12),
            Some(43),
            Some("exact".to_string())
        )
    );
}

/// The outgoing line names a stream the census deletes straight after, so it
/// has to survive as stored points, and the new version has to revert cleanly.
#[test]
fn the_outgoing_line_survives_the_delete_and_the_new_version_reverts_whole() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_section(
        &dir,
        "gone",
        &[("gone", 10, 40, 1000.0), ("close", 12, 42, 1000.0)],
    );
    let old_line = engine.get_gps_track("gone").expect("track")[10..=40].to_vec();
    let new_line = engine.get_gps_track("close").expect("track")[12..=42].to_vec();

    engine
        .reanchor_section_reference("s1", "gone", None)
        .expect("re-anchor");
    engine.remove_activity("gone").expect("delete");

    let versions = engine.section_geometry_versions("s1");
    let recovered = versions
        .iter()
        .filter_map(|v| engine.section_geometry_polyline("s1", v.version))
        .any(|line| line == old_line);
    assert!(recovered, "no stored version holds the outgoing line");

    let newest = versions.iter().map(|v| v.version).max().expect("a version");
    engine
        .revert_section_to_version("s1", newest)
        .expect("revert to the re-anchor version");
    assert_eq!(reference_of(&conn(&dir)).2, Some(43));
    let reverted = engine.get_section("s1").expect("section").polyline;
    assert_eq!(reverted, new_line);

    conn(&dir)
        .execute(
            "UPDATE sections SET polyline_blob = NULL WHERE id = 's1'",
            [],
        )
        .expect("clear the cache");
    let rebuilt = engine.get_section("s1").expect("section").polyline;
    assert_eq!(rebuilt, new_line, "the triple rebuilds the whole line");
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
        .reanchor_section_reference("s1", "gone", None)
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

/// The same ride stored twice: once under the key the device minted when it
/// was saved, and once by the sync under the id the server gave it, before
/// the upload's answer said they are one.
fn engine_with_uploaded_twin(
    dir: &TempDir,
    section_type: &str,
    members: &[&str],
    synced_track: Vec<GpsPoint>,
) -> (PersistentEngine, String) {
    let provisional = veloqrs::mint_local_activity_id();
    let path = db_path(dir);
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    engine
        .add_activity(provisional.clone(), track(0.0), "Ride".into())
        .expect("store the saved ride");
    engine
        .add_activity("i9".to_string(), synced_track, "Ride".into())
        .expect("store the server's copy");
    assert_eq!(engine.intervals_id(&provisional), None, "still provisional");

    let polyline = track(0.0)[10..=40].to_vec();
    let blob = veloqrs::persistence::codec::serialize_track_points(&polyline);
    let source = (section_type == "custom").then_some(provisional.as_str());
    conn(dir)
        .execute(
            "INSERT INTO sections
                 (id, name, sport_type, section_type, polyline_blob, distance_meters,
                  visit_count, created_at, source_activity_id, start_index, end_index,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                  representative_activity_id, rep_start_index, rep_end_index, geometry_source)
             VALUES ('s1', 'Hill', 'Ride', ?, ?, 1000.0, ?, datetime('now'),
                     ?, 10, 40, 0, 0, 0, 0, ?, 10, 41, 'exact')",
            params![
                section_type,
                blob,
                members.len() as u32,
                source,
                provisional
            ],
        )
        .expect("seed the section");
    for member in members {
        let id = if *member == "provisional" {
            provisional.as_str()
        } else {
            member
        };
        conn(dir)
            .execute(
                "INSERT INTO section_activities
                     (section_id, activity_id, start_index, end_index, distance_meters, excluded)
                 VALUES ('s1', ?, 10, 40, 1000.0, 0)",
                params![id],
            )
            .expect("seed a member");
    }
    // The version the athlete named, cut from the saved ride's stream.
    engine
        .record_section_geometry("s1", &polyline, true, Some((&provisional, 10, 41)))
        .expect("record the version cut from the saved ride");
    (engine, provisional)
}

fn activity_exists(conn: &Connection, id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM activities WHERE id = ?)",
        params![id],
        |row| row.get(0),
    )
    .expect("read the activity")
}

fn last_ledger_entry(conn: &Connection) -> (String, serde_json::Value) {
    let (kind, details): (String, Option<String>) = conn
        .query_row(
            "SELECT kind, details FROM section_history
             WHERE section_id = 's1' ORDER BY id DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read the ledger");
    let details = details.map_or(serde_json::Value::Null, |d| {
        serde_json::from_str(&d).expect("json details")
    });
    (kind, details)
}

/// Scenario: the athlete cuts a section from a ride saved on the device, and
/// the upload's answer arrives after the sync already stored the server's copy.
///
/// Expected behaviour: the line moves onto the server's copy before the saved
/// ride is removed, the ledger says so, and the version cut from the saved
/// ride still reads its line.
#[test]
fn an_upload_answer_moves_a_custom_section_onto_the_servers_copy() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, provisional) =
        engine_with_uploaded_twin(&dir, "custom", &["provisional", "i9"], track(0.0));
    let line = track(0.0)[10..=40].to_vec();

    assert!(
        engine
            .record_upload(&provisional, "i9")
            .expect("record the answer")
    );

    let db = conn(&dir);
    assert!(!activity_exists(&db, &provisional), "the duplicate is gone");
    assert_eq!(anchor_of(&db), (Some("i9".to_string()), Some(10), Some(40)));
    assert_eq!(
        reference_of(&db),
        (
            Some("i9".to_string()),
            Some(10),
            Some(41),
            Some("exact".to_string())
        )
    );
    let (kind, details) = last_ledger_entry(&db);
    assert_eq!(kind, "reference_reanchored");
    assert_eq!(details["from"].as_str(), Some(provisional.as_str()));
    assert_eq!(details["to"].as_str(), Some("i9"));
    assert_eq!(
        engine.section_geometry_polyline("s1", 1),
        Some(line),
        "the version cut from the saved ride outlives its stream"
    );
}

/// A detected section carries only the representative triple, and a named
/// one is pinned at a version cut from it.
#[test]
fn an_upload_answer_moves_a_detected_sections_representative_onto_the_servers_copy() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, provisional) =
        engine_with_uploaded_twin(&dir, "auto", &["provisional", "i9"], track(0.0));
    assert!(engine.pin_section_geometry("s1", 1).expect("pin"));

    engine
        .record_upload(&provisional, "i9")
        .expect("record the answer");

    let db = conn(&dir);
    assert!(!activity_exists(&db, &provisional));
    assert_eq!(reference_of(&db).0.as_deref(), Some("i9"));
    assert_eq!(last_ledger_entry(&db).0, "reference_reanchored");
    assert_eq!(
        engine.section_geometry_polyline("s1", 1),
        Some(track(0.0)[10..=40].to_vec()),
        "the pinned version still reads its line"
    );
}

/// The saved ride is the section's only member: the server's copy is not
/// matched yet, but it is the same ride, so it carries the line.
#[test]
fn an_upload_answer_moves_a_sections_only_member_onto_the_servers_copy() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, provisional) =
        engine_with_uploaded_twin(&dir, "custom", &["provisional"], track(0.0));

    engine
        .record_upload(&provisional, "i9")
        .expect("record the answer");

    let db = conn(&dir);
    assert!(!activity_exists(&db, &provisional));
    assert_eq!(anchor_of(&db), (Some("i9".to_string()), Some(10), Some(40)));
    assert_eq!(
        engine.section_geometry_polyline("s1", 1),
        Some(track(0.0)[10..=40].to_vec())
    );
}

/// The server's copy does not hold the line and no other member does, so
/// nothing can carry it: the saved ride is kept, as a ride the census finds
/// gone is kept, and the section still reads from it.
#[test]
fn an_upload_answer_keeps_the_saved_ride_when_nothing_else_can_carry_the_line() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, provisional) =
        engine_with_uploaded_twin(&dir, "custom", &["provisional"], track(0.05));

    assert!(
        !engine
            .record_upload(&provisional, "i9")
            .expect("record the answer"),
        "the duplicate stays, so nothing was settled"
    );

    let db = conn(&dir);
    assert!(
        activity_exists(&db, &provisional),
        "the only stream is kept"
    );
    assert_eq!(anchor_of(&db).0.as_deref(), Some(provisional.as_str()));
    assert!(engine.get_gps_track(&provisional).is_some());
}
