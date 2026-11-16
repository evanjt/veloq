//! Scenario: a library holding a finished strength session, from before a
//! session kept the plan lines that were not exercises, is opened by this build.
//!
//! Expected behaviour: the upgrade keeps the session with no notes, and a
//! session started from a plan afterwards still has its notes when the library
//! is opened again.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::strength_live::StartFrom;

fn reopen(path: &Path) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open");
    engine.load().expect("load");
    engine
}

/// The schema the migration that adds session notes follows.
const SCHEMA_BEFORE_NOTES: u32 = 96;

#[test]
fn an_upgrade_keeps_a_session_and_a_plan_started_one_keeps_its_notes() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    {
        let conn = seed_at_version(&path, SCHEMA_BEFORE_NOTES);
        assert!(!columns_of(&conn, "strength_sessions").contains(&"notes".to_string()));
        conn.execute_batch(
            "INSERT INTO strength_sessions (id, kind, activity_key, started_at, ended_at, created_at)
                 VALUES ('past', 'finished', 'local-r1', 900, 1900, 900);
             INSERT INTO strength_session_exercises (session_id, position, exercise_category, exercise_name)
                 VALUES ('past', 0, 0, 1);
             INSERT INTO strength_session_sets (session_id, exercise_position, set_index, reps, weight_kg, done, done_at)
                 VALUES ('past', 0, 0, 10, 60.0, 1, 1000);",
        )
        .unwrap();
    }

    let engine = reopen(&path);
    {
        let conn = Connection::open(&path).unwrap();
        assert_eq!(user_version(&conn), latest_version());
        assert_eq!(row_count(&conn, "strength_session_sets"), Some(1));
    }
    let past = engine.get_strength_session("past").unwrap().unwrap();
    assert_eq!(past.exercises[0].sets.len(), 1);
    assert!(past.notes.is_empty());

    engine
        .start_live_strength_session(
            &StartFrom::Plan(vec![
                "Goblet squat 16kg 3x10".to_string(),
                "Mobility 10 min".to_string(),
            ]),
            5_000,
        )
        .unwrap();
    drop(engine);

    let live = reopen(&path).live_strength_session().unwrap().unwrap();
    assert_eq!(live.exercises.len(), 1);
    assert_eq!(live.notes, ["Mobility 10 min"]);
}
