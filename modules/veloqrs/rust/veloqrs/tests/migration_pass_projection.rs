//! Scenario: a library from before a pass could be projected to its gates is
//! opened by this build, once from the schema a released build shipped, once
//! from the one just before the column arrived, and once as a new install.
//!
//! Expected behaviour: `section_activities` carries `projected_m`, and a row
//! that was there before the column reads it as `None`, a pass timed between
//! its gates.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn assert_column_is_empty(conn: &Connection) {
    assert!(
        columns_of(conn, "section_activities").contains(&"projected_m".to_string()),
        "the column arrives with the schema"
    );
    let stored: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE projected_m IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        stored, 0,
        "no row from before the column holds a projection"
    );
}

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(seed_at_version(&path, version));

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert_column_is_empty(&conn);
}

#[test]
fn an_upgrade_from_the_released_schema_reads_every_pass_as_timed_between_its_gates() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_column_reads_every_pass_as_timed_between_its_gates() {
    upgrade_from(77);
}

#[test]
fn a_new_install_has_the_column() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(PersistentEngine::new(path.to_str().unwrap()).expect("create"));

    let conn = Connection::open(&path).unwrap();
    assert_column_is_empty(&conn);
}
