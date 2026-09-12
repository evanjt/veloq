//! An athlete who unmarks a section as a lift has to keep it unmarked. `is_lift`
//! is derived, and the enrichment pass re-`UPDATE`s the column from the
//! detector's own answer on every run, so an unflag written to the column comes
//! back at the next detect. The durable record is an intent, which is the table
//! that outlives a catalogue rebuild.
//!
//! Run: `cargo test --test section_lift_intent -p veloqrs`

mod migration_support;

use migration_support::seed_at_version;
use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    path: std::path::PathBuf,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("lift.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        path,
        _tmp: tmp,
    }
}

fn ride() -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0005, 7.0))
        .collect()
}

/// A section the detector has stamped as a lift.
fn a_flagged_section(s: &mut Setup) -> String {
    let track = ride();
    s.engine
        .add_activity(
            "act_lift".to_string(),
            track.clone(),
            "Snowboard".to_string(),
        )
        .expect("add activity");
    let slice = track[4..=12].to_vec();
    let id = s
        .engine
        .create_section(CreateSectionParams {
            sport_type: "Snowboard".to_string(),
            polyline: slice.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&slice),
            name: Some("The drag lift".to_string()),
            source_activity_id: Some("act_lift".to_string()),
            start_index: Some(4),
            end_index: Some(12),
        })
        .expect("create section");
    s.raw
        .execute("UPDATE sections SET is_lift = 1 WHERE id = ?", params![id])
        .expect("stamp the flag");
    id
}

fn is_lift(db: &Connection, id: &str) -> i64 {
    db.query_row(
        "SELECT is_lift FROM sections WHERE id = ?",
        params![id],
        |row| row.get(0),
    )
    .expect("section row")
}

fn lift_intents(db: &Connection) -> i64 {
    db.query_row(
        "SELECT count(*) FROM section_intents WHERE kind = 'lift'",
        [],
        |row| row.get(0),
    )
    .expect("intent count")
}

#[test]
fn unflagging_a_lift_clears_the_column_and_records_the_intent() {
    let mut s = setup();
    let id = a_flagged_section(&mut s);

    s.engine.set_section_is_lift(&id, false).expect("unflag");

    assert_eq!(is_lift(&s.raw, &id), 0, "the column still says lift");
    assert_eq!(lift_intents(&s.raw), 1, "nothing durable was written");
}

/// The whole point: the enrichment pass must not stamp over the athlete.
#[test]
fn an_unflagged_section_stays_unflagged_when_enrichment_runs_again() {
    let mut s = setup();
    let id = a_flagged_section(&mut s);
    s.engine.set_section_is_lift(&id, false).expect("unflag");

    s.engine
        .restamp_lift_flag_for_test(&id, true)
        .expect("enrichment pass");

    assert_eq!(is_lift(&s.raw, &id), 0, "the enrichment pass overwrote it");
}

/// A section the detector does not call a lift is left alone by the same pass,
/// so the intent narrows the write rather than freezing the column.
#[test]
fn a_section_with_no_intent_still_takes_the_detectors_answer() {
    let mut s = setup();
    let id = a_flagged_section(&mut s);

    s.engine
        .restamp_lift_flag_for_test(&id, true)
        .expect("enrichment pass");

    assert_eq!(is_lift(&s.raw, &id), 1);
}

/// Re-flagging is the undo, and it has to take the intent with it or the
/// section can never be a lift again.
#[test]
fn re_flagging_removes_the_intent() {
    let mut s = setup();
    let id = a_flagged_section(&mut s);
    s.engine.set_section_is_lift(&id, false).expect("unflag");

    s.engine.set_section_is_lift(&id, true).expect("re-flag");

    assert_eq!(is_lift(&s.raw, &id), 1);
    assert_eq!(lift_intents(&s.raw), 0, "the intent outlived the re-flag");
}

/// The intent is in the table that outlives a catalogue rebuild, so it has to
/// survive the wipe that rebuild does.
#[test]
fn the_intent_survives_a_sections_wipe() {
    let mut s = setup();
    let id = a_flagged_section(&mut s);
    s.engine.set_section_is_lift(&id, false).expect("unflag");

    s.raw.execute("DELETE FROM sections", []).expect("wipe");

    assert_eq!(lift_intents(&s.raw), 1);
    let reopened = PersistentEngine::new(s.path.to_str().unwrap()).expect("reopen");
    drop(reopened);
    assert_eq!(lift_intents(&s.raw), 1, "reopening dropped it");
}

/// A durable unflag must not suppress the section the way a disable does: the
/// athlete asked for it to stay, not to go.
#[test]
fn a_lift_intent_does_not_suppress_the_section() {
    let mut s = setup();
    let id = a_flagged_section(&mut s);
    s.engine.set_section_is_lift(&id, false).expect("unflag");

    let section = s.engine.get_section(&id);

    assert!(section.is_some(), "the section went away");
}

/// The upgrade every released install takes is 12 to current, against a database
/// a shipped binary actually wrote. `section_intents` does not exist at 12, so
/// what this proves is that the chain arrives at the widened CHECK.
#[test]
fn the_upgrade_from_a_released_v12_install_arrives_at_the_widened_check() {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("upgrade.db");
    {
        let conn = Connection::open(&path).expect("open");
        conn.execute_batch(include_str!("fixtures/v12_demo.sql"))
            .expect("replay a 0.3.8 database");
    }

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("upgrade");
    drop(engine);

    let db = Connection::open(&path).expect("reopen");
    let sql: String = db
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'section_intents'",
            [],
            |row| row.get(0),
        )
        .expect("the table");
    assert!(sql.contains("'lift'"), "the CHECK was never widened: {sql}");
    db.execute(
        "INSERT INTO section_intents (id, kind, polyline_json, created_at)
         VALUES ('sec_new', 'lift', '[]', datetime('now'))",
        [],
    )
    .expect("the widened CHECK refused a lift intent");
}

/// Widening a CHECK in SQLite is a create-copy-drop-rename, so the real hazard
/// is the copy. An install sitting on the shape before this migration carries
/// live suppression, deletion and naming intents, and every one has to come
/// across with its columns intact.
#[test]
fn the_widening_carries_every_intent_an_install_already_had() {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("prior.db");
    {
        // The shape before this migration, built from the shipped chain rather
        // than a hand-copied list that would drift from it.
        let conn = seed_at_version(&path, 31);
        conn.execute_batch(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
             VALUES ('sec_a', 'disabled', '[{\"latitude\":46.0,\"longitude\":7.0}]',
                     '2026-01-01 00:00:00', NULL, NULL),
                    ('sec_a', 'named', '[]', '2026-01-02 00:00:00', 'Home climb', 'Ride'),
                    ('sec_b', 'deleted', '[]', '2026-01-03 00:00:00', NULL, NULL);",
        )
        .expect("intents the athlete already had");
    }

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("upgrade");
    drop(engine);

    let db = Connection::open(&path).expect("reopen");
    let rows: Vec<(String, String, Option<String>, Option<String>, String)> = db
        .prepare(
            "SELECT id, kind, name, sport_type, created_at FROM section_intents ORDER BY id, kind",
        )
        .expect("prepare")
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows");

    assert_eq!(
        rows,
        vec![
            (
                "sec_a".to_string(),
                "disabled".to_string(),
                None,
                None,
                "2026-01-01 00:00:00".to_string()
            ),
            (
                "sec_a".to_string(),
                "named".to_string(),
                Some("Home climb".to_string()),
                Some("Ride".to_string()),
                "2026-01-02 00:00:00".to_string()
            ),
            (
                "sec_b".to_string(),
                "deleted".to_string(),
                None,
                None,
                "2026-01-03 00:00:00".to_string()
            ),
        ]
    );
}
