//! Scenario: `PRAGMA user_version` claims more migrations ran than did, so the
//! pass skips the file that creates a table and reaches the one that alters it.
//! The private corpus carries this shape, and so does any dev-era database that
//! was stamped by a build whose migration list has since been squashed.
//!
//! Expected behaviour: the open refuses before the migration pass, naming both
//! version records and the tables the pragma implies but the file does not
//! hold. It repairs nothing. Until this landed the failure was whatever the
//! first assumed table happened to be, `no such table: recordings` at 25 and
//! `no such table: main.activity_metrics` at 27, which says nothing about the
//! version records that caused it.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn open(path: &std::path::Path) -> Result<(), String> {
    PersistentEngine::new(path.to_str().unwrap())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn stamp_pragma(conn: &Connection, version: u32) {
    conn.pragma_update(None, "user_version", version)
        .expect("stamp user_version");
}

/// The shape that reached `025_recordings.sql`: tables at 13, pragma at 25.
#[test]
fn an_overstated_pragma_names_both_versions_and_the_missing_tables() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 13);
        stamp_app_schema_version(&conn, 21);
        stamp_pragma(&conn, 25);
    }

    let err = open(&path).expect_err("an overstated pragma must not open");

    assert!(err.contains("user_version 25"), "names the pragma: {err}");
    assert!(
        err.contains("schema_info 21"),
        "names the app record: {err}"
    );
    assert!(err.contains("recordings"), "names a missing table: {err}");
    assert!(
        !err.contains("no such table"),
        "the migration pass must not have been reached: {err}"
    );
}

/// The same shape one migration further on, which fails on a different table
/// and was the half of this the item first missed.
#[test]
fn an_overstated_pragma_past_the_metrics_index_is_refused_too() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 13);
        stamp_pragma(&conn, 27);
    }

    let err = open(&path).expect_err("an overstated pragma must not open");
    assert!(err.contains("user_version 27"), "names the pragma: {err}");
}

/// An app record above the pragma is the ordinary shape of a file a later
/// build opened, and it does not excuse tables the pragma implies: seeded at
/// 13, the pragma claims 25 and the app record 40.
#[test]
fn an_app_version_above_an_overstated_pragma_is_still_diagnosed() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 13);
        stamp_app_schema_version(&conn, 40);
        stamp_pragma(&conn, 25);
    }

    let err = open(&path).expect_err("an overstated pragma must not open");

    assert!(err.contains("user_version 25"), "names the pragma: {err}");
    assert!(
        err.contains("schema_info 40"),
        "names the app record: {err}"
    );
    assert!(err.contains("recordings"), "names a missing table: {err}");
    assert!(
        !err.contains("no such table"),
        "the migration pass must not have been reached: {err}"
    );
}

/// A table a later migration drops can be absent from a file whose pragma
/// understates it, so its absence says nothing about an overstatement. The
/// tables are at the latest version, the pragma at 12 and the app record at
/// 12 too, so no comparison of the two records stands in for the check.
#[test]
fn a_table_a_later_migration_drops_is_not_claimed_missing() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let latest = latest_version();
    {
        let conn = seed_at_version(&path, latest);
        stamp_app_schema_version(&conn, 12);
        stamp_pragma(&conn, 12);
    }

    let err = open(&path).expect_err("a pragma behind the tables still fails");
    assert!(
        !err.contains("user_version 12 implies"),
        "the overstatement guard must not claim this one: {err}"
    );
}

/// The guard must not fire on the upgrade every live install takes.
#[test]
fn the_released_floor_still_opens() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 12);
        stamp_app_schema_version(&conn, 12);
    }

    open(&path).expect("the 12 to latest upgrade must still open");
}

/// Nor on a pragma that understates: every table the prefix names is present,
/// so there is nothing to diagnose here and the existing duplicate-column
/// failure is what that case gets.
#[test]
fn a_pragma_behind_the_tables_is_not_this_failure() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let latest = latest_version();
    {
        let conn = seed_at_version(&path, latest);
        stamp_pragma(&conn, 12);
    }

    let err = open(&path).expect_err("a pragma behind the tables still fails");
    assert!(
        !err.contains("user_version 12 implies"),
        "the overstatement guard must not claim this one: {err}"
    );
}

/// A fresh file has no pragma and no tables, and must open.
#[test]
fn a_fresh_install_opens() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    open(&dir.path().join("routes.db")).expect("a fresh install must open");
}
