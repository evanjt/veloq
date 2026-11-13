//! Scenario: a library holding a finished phone-recorded session, from before
//! a live session kept its position, is opened by this build.
//!
//! Expected behaviour: the upgrade keeps the session and its sets with no
//! position, and a live session started afterwards is still at the set the
//! athlete left it on when the library is opened again.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::strength_live::{LiveEdit, StartFrom};
use veloqrs::persistence::strength_sessions::SessionKind;

fn reopen(path: &Path) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open");
    engine.load().expect("load");
    engine
}

#[test]
fn an_upgrade_keeps_a_recorded_session_and_a_live_one_resumes_at_its_set() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    {
        let conn = seed_at_version(&path, latest_version() - 1);
        assert!(!columns_of(&conn, "strength_sessions").contains(&"current_set".to_string()));
        conn.execute_batch(
            "INSERT INTO strength_sessions (id, kind, activity_key, started_at, ended_at, created_at)
                 VALUES ('past', 'finished', 'local-r1', 900, 1900, 900);
             INSERT INTO strength_session_exercises (session_id, position, exercise_category, exercise_name)
                 VALUES ('past', 0, 0, 1);
             INSERT INTO strength_session_sets
                 (session_id, exercise_position, set_index, reps, weight_kg, done, done_at)
                 VALUES ('past', 0, 0, 10, 60.0, 1, 1000), ('past', 0, 1, 8, 62.5, 1, 1100);",
        )
        .unwrap();
    }

    let engine = reopen(&path);
    {
        let conn = Connection::open(&path).unwrap();
        assert_eq!(user_version(&conn), latest_version());
        assert_eq!(row_count(&conn, "strength_session_sets"), Some(2));
    }
    let past = engine.get_strength_session("past").unwrap().unwrap();
    assert_eq!(past.kind, SessionKind::Finished);
    assert_eq!(past.exercises[0].sets.len(), 2);
    assert_eq!((past.current_exercise, past.current_set), (None, None));
    assert_eq!(past.rest_started_at, None);

    engine
        .start_live_strength_session(&StartFrom::Session("past".to_string()), 5_000)
        .unwrap();
    for edit in [
        LiveEdit::Begin,
        LiveEdit::SelectSet {
            exercise: 0,
            set: 1,
        },
        LiveEdit::StartRest,
    ] {
        engine.edit_live_strength_session(&edit, 5_010).unwrap();
    }
    drop(engine);

    let engine = reopen(&path);
    let live = engine.live_strength_session().unwrap().unwrap();
    assert_eq!(
        (live.current_exercise, live.current_set),
        (Some(0), Some(1))
    );
    assert_eq!(live.rest_started_at, Some(5_010));
    assert_eq!(live.exercises[0].sets[0].reps, Some(10));
}
