//! Scenario: a library from before strength sessions could be recorded on the
//! phone is opened by this build, once from the schema 0.4.0 shipped and once
//! from the one just before the tables arrived.
//!
//! Expected behaviour: the upgrade keeps every activity and every exercise set
//! and leaves the session tables empty, and a session saved afterwards is still
//! there, with its sets in the library, when the library is opened again.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::strength_sessions::{
    SessionExercise, SessionKind, SessionSet, StrengthSession,
};

const SESSION_TABLES: [&str; 5] = [
    "strength_sessions",
    "strength_session_exercises",
    "strength_session_sets",
    "strength_session_groups",
    "strength_session_rests",
];

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .expect(table)
}

fn reopen(path: &Path) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open");
    engine.load().expect("load");
    engine
}

fn session() -> StrengthSession {
    StrengthSession {
        id: "session-1".to_string(),
        kind: SessionKind::Finished,
        name: None,
        activity_key: Some("local-r1".to_string()),
        intervals_id: None,
        started_at: Some(900),
        ended_at: Some(1_900),
        last_used_at: None,
        created_at: 900,
        exercises: vec![SessionExercise {
            exercise_category: 0,
            exercise_name: Some(1),
            group_no: None,
            rest_secs: None,
            sets: vec![SessionSet {
                reps: Some(8),
                weight_kg: Some(60.0),
                side: Some("left".to_string()),
                done: true,
                ..SessionSet::default()
            }],
        }],
        groups: Vec::new(),
        rests: Vec::new(),
    }
}

fn upgrade_and_record(path: &Path) {
    let before = {
        let conn = Connection::open(path).unwrap();
        for table in SESSION_TABLES {
            assert!(!tables_at(&conn).contains(&table.to_string()), "{table}");
        }
        (
            count(&conn, "activities"),
            count(&conn, "gps_tracks"),
            count(&conn, "exercise_sets"),
            count(&conn, "route_names"),
        )
    };

    let engine = reopen(path);
    {
        let conn = Connection::open(path).unwrap();
        assert_eq!(user_version(&conn), latest_version());
        for table in SESSION_TABLES {
            assert_eq!(count(&conn, table), 0, "{table}");
        }
        assert_eq!(
            (
                count(&conn, "activities"),
                count(&conn, "gps_tracks"),
                count(&conn, "exercise_sets"),
                count(&conn, "route_names"),
            ),
            before,
            "the upgrade lost a row"
        );
    }

    engine.save_strength_session(&session()).unwrap();
    drop(engine);

    let engine = reopen(path);
    assert_eq!(
        engine.get_strength_session("session-1").unwrap(),
        Some(session())
    );
    assert_eq!(engine.get_exercise_sets("local-r1").unwrap().len(), 1);
    let conn = Connection::open(path).unwrap();
    assert_eq!(count(&conn, "exercise_sets"), before.2 + 1);
}

#[test]
fn an_upgrade_from_0_4_0_keeps_every_row_and_takes_a_recorded_session() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let release = RELEASES
        .iter()
        .find(|release| release.name == "0.4.0")
        .expect("the 0.4.0 release row");
    Connection::open(&path)
        .unwrap()
        .execute_batch(release.library.expect("a library fixture"))
        .unwrap();

    upgrade_and_record(&path);
}

#[test]
fn an_upgrade_from_the_newest_release_keeps_every_row_and_takes_a_recorded_session() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    Connection::open(&path)
        .unwrap()
        .execute_batch(latest_release().library.expect("a library fixture"))
        .unwrap();

    upgrade_and_record(&path);
}

#[test]
fn an_upgrade_from_the_schema_before_the_tables_keeps_every_row() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(seed_at_version(&path, latest_version() - 1));

    upgrade_and_record(&path);
}
