//! Shared seeding for migration tests.
//!
//! Every released 0.3.0 to 0.3.8 shipped `user_version = 12`. Tests that want to
//! reproduce the upgrade a live user actually takes need a database that is
//! genuinely at that version, built from the migrations that shipped rather than
//! from a hand-copied list that drifts silently.
//!
//! `seed_at_version` applies a prefix of `PersistentRouteEngine::migration_scripts()`,
//! the same vector `init_schema` runs, so a seed can never disagree with the
//! production chain.

#![allow(dead_code)]

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};
use std::path::Path;
use veloqrs::PersistentRouteEngine;

/// Highest migration number the crate ships. A seed above this is a bug in the
/// caller, not something to clamp silently.
pub fn latest_version() -> u32 {
    PersistentRouteEngine::migration_scripts().len() as u32
}

/// Build a database at `path` holding exactly migrations `1..=n` and nothing
/// after them, then return an open connection to it.
///
/// `PRAGMA user_version` lands on `n` because rusqlite_migration stamps it as it
/// applies, so the engine opening this file later sees a real vN database and
/// runs the real remaining migrations. `schema_info.schema_version` is stamped
/// too: the app reads it to decide which post-migration hooks to run, and from
/// 012 onward it tracks `user_version` one for one. Seeds below 012 that need
/// the historical divergence (0.2.2 shipped `user_version = 11` while stamping
/// `schema_version = 7`) should call `stamp_app_schema_version` afterwards.
///
/// Panics rather than returning a Result: a seed that cannot be built is a
/// broken test, and a silently skipped precondition would print green.
pub fn seed_at_version(path: &Path, n: u32) -> Connection {
    let scripts = PersistentRouteEngine::migration_scripts();
    assert!(n >= 1, "seed_at_version needs at least migration 1");
    assert!(
        n as usize <= scripts.len(),
        "cannot seed at v{n}, the crate ships {} migrations",
        scripts.len()
    );

    let prefix: Vec<M> = scripts[..n as usize].iter().copied().map(M::up).collect();
    let mut conn = Connection::open(path).expect("open seed database");
    Migrations::new(prefix)
        .to_latest(&mut conn)
        .unwrap_or_else(|e| panic!("apply migrations 1..={n}: {e}"));

    let applied = user_version(&conn);
    assert_eq!(
        applied, n,
        "seeded database must report v{n}, reported v{applied}"
    );

    stamp_app_schema_version(&conn, n);
    conn
}

/// Write the app-level version the released build would have left in
/// `schema_info`. Separate from `seed_at_version` so a test reproducing a
/// version pair that diverged can set its own.
pub fn stamp_app_schema_version(conn: &Connection, version: u32) {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )
    .expect("create schema_info");
    conn.execute(
        "INSERT OR REPLACE INTO schema_info(key, value) VALUES ('schema_version', ?)",
        [version.to_string()],
    )
    .expect("stamp schema_version");
}

/// Sorted user table names, SQLite internals excluded.
pub fn tables_at(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name",
        )
        .expect("prepare sqlite_master query");
    let names = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .expect("query sqlite_master")
        .collect::<Result<Vec<_>, _>>()
        .expect("read table names");
    names
}

pub fn user_version(conn: &Connection) -> u32 {
    conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .expect("read user_version") as u32
}

/// Row count for a table, or None when the table does not exist. Migration
/// tests use it to assert data survived rather than that the schema landed.
pub fn row_count(conn: &Connection, table: &str) -> Option<i64> {
    conn.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |row| {
        row.get(0)
    })
    .ok()
}

/// Column names on a table, empty when the table does not exist.
pub fn columns_of(conn: &Connection, table: &str) -> Vec<String> {
    let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info(\"{table}\")")) else {
        return Vec::new();
    };
    stmt.query_map([], |row| row.get::<_, String>(1))
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

#[test]
fn seeds_land_on_the_requested_version_with_a_growing_table_set() {
    let dir = tempfile::TempDir::new().expect("tempdir");

    let mut previous: Vec<String> = Vec::new();
    for n in [11u32, 12, 16] {
        let conn = seed_at_version(&dir.path().join(format!("v{n}.db")), n);
        assert_eq!(
            user_version(&conn),
            n,
            "seed at v{n} reported another value"
        );

        let tables = tables_at(&conn);
        assert!(
            tables.contains(&"sections".to_string()),
            "v{n} seed is missing the sections table"
        );
        for table in &previous {
            assert!(
                tables.contains(table),
                "table {table} present below v{n} disappeared at v{n}"
            );
        }
        assert!(
            tables.len() > previous.len(),
            "v{n} added no tables over the previous seed"
        );
        previous = tables;
    }
}

#[test]
fn seeding_short_of_the_latest_leaves_later_migrations_unapplied() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let conn = seed_at_version(&dir.path().join("v12.db"), 12);

    // 013 adds it, so a genuine v12 database must not have it yet. Without this
    // the seed could be quietly running the whole chain and every upgrade test
    // built on it would assert nothing.
    assert!(
        !columns_of(&conn, "wellness").contains(&"raw".to_string()),
        "a v12 seed already carries the column migration 013 adds"
    );
    assert!(
        !tables_at(&conn).contains(&"section_history".to_string()),
        "a v12 seed already carries a table migration 017 adds"
    );
}
