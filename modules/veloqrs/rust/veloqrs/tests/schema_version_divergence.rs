//! Scenario: the file carries two version records and nothing reconciles them.
//! `PRAGMA user_version` is what `rusqlite_migration` skips on;
//! `schema_info.schema_version` is what the forward-compatibility refusal reads
//! and is written after the pass. A database whose two records disagree is not
//! hypothetical: the owner's own corpus sits at pragma 25, `schema_info` 21 and
//! tables at 13.
//!
//! Expected behaviour, and it is what this file pins rather than what it wants:
//! each direction of divergence fails in a specific, named way today. This is
//! the guard, not the repair. `B851` is the repair, and when it lands these
//! assertions are where it becomes visible: a test that only said "it fails"
//! would pass just as well after a fix that failed differently.

mod migration_support;

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

/// The control. Both records agree at the released floor, which is the upgrade
/// every live install takes, and it opens.
#[test]
fn the_agreeing_case_opens() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 12);
        stamp_app_schema_version(&conn, 12);
    }

    open(&path).expect("agreeing records must open");
}

/// Ahead: the pragma claims more migrations ran than did, so the pass skips the
/// file that creates a table and reaches the one that alters it. Seeded at 13,
/// stamped to 21, which is the shape the private corpus carries.
#[test]
fn a_pragma_ahead_of_the_tables_fails_on_the_first_assumed_table() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 13);
        stamp_app_schema_version(&conn, 13);
        stamp_pragma(&conn, 21);
    }

    let err = open(&path).expect_err("a pragma ahead of the tables must not open silently");
    assert!(
        err.contains("no such table"),
        "expected a missing-table failure, got: {err}"
    );
}

/// Behind: the pragma claims fewer migrations ran than did, so the pass
/// re-applies files that have already run. `ADD COLUMN` has no `IF NOT EXISTS`
/// in SQLite, which `src/migrations/017_b4_core.sql:72` says outright, so the
/// first re-applied file carrying one fails on a duplicate column.
#[test]
fn a_pragma_behind_the_tables_fails_on_a_duplicate_column() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let latest = latest_version();
    {
        let conn = seed_at_version(&path, latest);
        stamp_app_schema_version(&conn, latest);
        stamp_pragma(&conn, 12);
    }

    let err = open(&path).expect_err("a pragma behind the tables must not open silently");
    assert!(
        err.contains("duplicate column"),
        "expected a duplicate-column failure, got: {err}"
    );
}

/// The one divergence that is already self-healing: the pragma is right, so the
/// pass runs nothing, and `schema_info` is rewritten to the build's own version
/// on the way out. One open repairs it.
#[test]
fn a_stale_schema_info_repairs_itself_in_one_open() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let latest = latest_version();
    {
        let conn = seed_at_version(&path, latest);
        stamp_app_schema_version(&conn, 3);
    }

    open(&path).expect("a stale schema_info must not stop the open");

    let conn = Connection::open(&path).unwrap();
    let stored: i64 = conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .expect("schema_version row");
    assert!(
        stored > 3,
        "the open must rewrite the stale app version, still {stored}"
    );
}

/// The case the item names in its Cover line: no `schema_info` row at all,
/// which is every database older than migration 012. It reads as 0 through the
/// `unwrap_or(0)` at `schema.rs:151`, so the forward-compat refusal must not
/// fire and the open must succeed.
#[test]
fn an_absent_schema_info_row_reads_as_zero_and_opens() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 12);
        conn.execute("DELETE FROM schema_info WHERE key = 'schema_version'", [])
            .expect("clear the app version");
    }

    open(&path).expect("an absent schema_info row must open");
}
