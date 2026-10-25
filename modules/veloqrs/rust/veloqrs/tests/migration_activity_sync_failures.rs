//! Scenario: a library from before the per-activity sync failure table is
//! opened by this build, once from the schema a released build shipped and
//! once from the one just before the table arrived, holding a ride.
//!
//! Expected behaviour: the table exists and is empty, so no activity is marked
//! as failed, and the failure verbs work on the upgraded file.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(seed_at_version(&path, version));

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert!(
        tables_at(&conn).contains(&"activity_sync_failures".to_string()),
        "the table arrives with the upgrade from v{version}"
    );
    assert_eq!(row_count(&conn, "activity_sync_failures"), Some(0));
    let columns = columns_of(&conn, "activity_sync_failures");
    for column in ["activity_id", "message", "failed_at"] {
        assert!(columns.contains(&column.to_string()), "{columns:?}");
    }
}

#[test]
fn an_upgrade_from_the_released_schema_marks_no_activity_failed() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_table_marks_no_activity_failed() {
    upgrade_from(73);
}
