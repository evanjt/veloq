//! Scenario: a library holding a live strength session, from before sessions
//! kept heart rate readings, is opened by this build.
//!
//! Expected behaviour: the upgrade keeps the session and its sets, and a
//! reading taken afterwards is still there when the library is opened again.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::strength_live::LiveEdit;

fn reopen(path: &Path) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open");
    engine.load().expect("load");
    engine
}

#[test]
fn an_upgrade_keeps_a_live_session_and_it_then_keeps_heart_rate() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    {
        let conn = seed_at_version(&path, 94);
        assert!(!tables_at(&conn).contains(&"strength_session_heart_rate".to_string()));
        conn.execute_batch(
            "INSERT INTO strength_sessions (id, kind, started_at, created_at)
                 VALUES ('now', 'live', 900, 900);
             INSERT INTO strength_session_exercises (session_id, position, exercise_category, exercise_name)
                 VALUES ('now', 0, 0, 1);
             INSERT INTO strength_session_sets (session_id, exercise_position, set_index, reps, done)
                 VALUES ('now', 0, 0, 10, 0);",
        )
        .unwrap();
    }

    let engine = reopen(&path);
    {
        let conn = Connection::open(&path).unwrap();
        assert_eq!(user_version(&conn), latest_version());
        assert_eq!(row_count(&conn, "strength_session_sets"), Some(1));
        assert_eq!(row_count(&conn, "strength_session_heart_rate"), Some(0));
    }
    let live = engine.live_strength_session().unwrap().unwrap();
    assert!(live.heart_rate.is_empty());

    assert!(engine.record_live_heart_rate(120, 1_000).unwrap());
    engine
        .edit_live_strength_session(&LiveEdit::StartRest, 1_001)
        .unwrap();
    drop(engine);

    let live = reopen(&path).live_strength_session().unwrap().unwrap();
    assert_eq!(live.heart_rate.len(), 1);
    assert_eq!(live.average_heart_rate(), Some(120));
}
