//! Schema parity test: a fresh-install database and a v0.2.x-migrated
//! database must produce **identical** SQLite schemas.
//!
//! Catches the class of bug where a consolidated migration (012_v030.sql)
//! drifts from the equivalent CREATE TABLE / CREATE INDEX statements in
//! `persistence/schema.rs`, so users on different upgrade paths end up with
//! subtly different table definitions, default values, indexes, or
//! constraints. The drift typically goes unnoticed until a query that
//! depends on the divergent column starts behaving differently in
//! production.
//!
//! How it works
//! ------------
//! Build two databases:
//!   - `fresh`: empty file → `PersistentRouteEngine::new` runs all 12
//!     migrations in order.
//!   - `migrated`: seed migrations 1–11 (the schema shipped at v0.2.0–v0.2.2)
//!     then open `PersistentRouteEngine`, which applies migration 12.
//! For every user-table in `sqlite_master`, diff:
//!   - `PRAGMA table_info(<table>)` — column names, types, defaults, NOT NULL
//!     flags, primary-key positions.
//!   - `PRAGMA index_list(<table>)` — index names, uniqueness, origin.
//!   - `PRAGMA foreign_key_list(<table>)` — FK relationships.
//! Any divergence fails the test.

use rusqlite::{Connection, Result as SqlResult};
use rusqlite_migration::{M, Migrations};
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

// ----------------------------------------------------------------------------
// Setup helpers
// ----------------------------------------------------------------------------

/// Build a v0.2.x-shaped database (migrations 1–11 only) at `path`. Mirrors
/// the helper in `migration_v02x_to_current.rs` but kept local so the two
/// tests are independently maintainable.
fn seed_v02x_db(path: &Path) -> SqlResult<()> {
    let mut conn = Connection::open(path)?;
    let v02x = Migrations::new(vec![
        M::up(include_str!("../src/migrations/001_initial_schema.sql")),
        M::up(include_str!("../src/migrations/002_unified_sections.sql")),
        M::up(include_str!("../src/migrations/003_drop_section_names.sql")),
        M::up(include_str!(
            "../src/migrations/004_extend_activity_metrics.sql"
        )),
        M::up(include_str!("../src/migrations/005_profile_and_settings.sql")),
        M::up(include_str!("../src/migrations/006_processed_activities.sql")),
        M::up(include_str!(
            "../src/migrations/007_cache_section_performances.sql"
        )),
        M::up(include_str!(
            "../src/migrations/008_cache_all_performance_metrics.sql"
        )),
        M::up(include_str!("../src/migrations/009_section_bounds_cache.sql")),
        M::up(include_str!(
            "../src/migrations/010_route_groups_activity_count.sql"
        )),
        M::up(include_str!("../src/migrations/011_pace_history.sql")),
    ]);
    v02x.to_latest(&mut conn).expect("apply v0.2.x migrations");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO schema_info(key, value) VALUES ('schema_version', '7')",
        [],
    )?;
    Ok(())
}

fn open_fresh() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("fresh.db");
    {
        let _engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("fresh engine");
    }
    let conn = Connection::open(&path).expect("reopen fresh");
    (dir, conn)
}

fn open_migrated() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("migrated.db");
    seed_v02x_db(&path).expect("seed v0.2.x");
    {
        let _engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("migrated engine");
    }
    let conn = Connection::open(&path).expect("reopen migrated");
    (dir, conn)
}

// ----------------------------------------------------------------------------
// Diff helpers
// ----------------------------------------------------------------------------

/// One row of `PRAGMA table_info(<table>)`. Compared structurally so a
/// difference at any field fails the test.
#[derive(Debug, PartialEq, Eq)]
struct ColumnInfo {
    cid: i64,
    name: String,
    type_: String,
    notnull: i64,
    dflt_value: Option<String>,
    pk: i64,
}

fn table_info(conn: &Connection, table: &str) -> Vec<ColumnInfo> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info('{}')", table))
        .expect("prepare table_info");
    let rows = stmt
        .query_map([], |r| {
            Ok(ColumnInfo {
                cid: r.get(0)?,
                name: r.get(1)?,
                type_: r.get(2)?,
                notnull: r.get(3)?,
                dflt_value: r.get(4)?,
                pk: r.get(5)?,
            })
        })
        .expect("query table_info")
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();
    rows
}

#[derive(Debug, PartialEq, Eq)]
struct IndexInfo {
    name: String,
    unique_flag: i64,
    origin: String,
    partial: i64,
}

fn index_list(conn: &Connection, table: &str) -> Vec<IndexInfo> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA index_list('{}')", table))
        .expect("prepare index_list");
    let mut rows = stmt
        .query_map([], |r| {
            Ok(IndexInfo {
                name: r.get(1)?,
                unique_flag: r.get(2)?,
                origin: r.get(3)?,
                partial: r.get(4)?,
            })
        })
        .expect("query index_list")
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();
    // Auto-indexes (origin "u" for UNIQUE constraints, "pk" for primary keys)
    // and explicit indexes (origin "c") all matter for parity. Sort by name
    // so order-of-creation differences don't cause spurious failures.
    rows.sort_by(|a, b| a.name.cmp(&b.name));
    rows
}

#[derive(Debug, PartialEq, Eq)]
struct ForeignKeyInfo {
    id: i64,
    seq: i64,
    table: String,
    from: String,
    to: String,
    on_update: String,
    on_delete: String,
    matched: String,
}

fn foreign_key_list(conn: &Connection, table: &str) -> Vec<ForeignKeyInfo> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA foreign_key_list('{}')", table))
        .expect("prepare foreign_key_list");
    stmt.query_map([], |r| {
        Ok(ForeignKeyInfo {
            id: r.get(0)?,
            seq: r.get(1)?,
            table: r.get(2)?,
            from: r.get(3)?,
            to: r.get(4)?,
            on_update: r.get(5)?,
            on_delete: r.get(6)?,
            matched: r.get(7)?,
        })
    })
    .expect("query foreign_key_list")
    .filter_map(|r| r.ok())
    .collect()
}

fn user_tables(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master \
             WHERE type='table' AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .expect("prepare table list");
    stmt.query_map([], |r| r.get::<_, String>(0))
        .expect("query table list")
        .filter_map(|r| r.ok())
        .collect()
}

fn user_indexes(conn: &Connection) -> Vec<(String, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT name, COALESCE(sql, '') FROM sqlite_master \
             WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%' \
             ORDER BY name",
        )
        .expect("prepare index list");
    stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .expect("query index list")
        .filter_map(|r| r.ok())
        .collect()
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

#[test]
fn fresh_and_migrated_have_same_table_set() {
    let (_a, fresh) = open_fresh();
    let (_b, migrated) = open_migrated();

    let fresh_tables = user_tables(&fresh);
    let migrated_tables = user_tables(&migrated);

    assert_eq!(
        fresh_tables, migrated_tables,
        "fresh-install and v0.2.x-migrated databases must share the same set of user tables.\n\
         fresh:    {:?}\n\
         migrated: {:?}",
        fresh_tables, migrated_tables
    );
}

#[test]
fn fresh_and_migrated_have_same_columns_per_table() {
    let (_a, fresh) = open_fresh();
    let (_b, migrated) = open_migrated();

    let mut mismatches = Vec::<String>::new();
    for table in user_tables(&fresh) {
        let fresh_cols = table_info(&fresh, &table);
        let migrated_cols = table_info(&migrated, &table);
        if fresh_cols != migrated_cols {
            mismatches.push(format!(
                "table '{}' diverged:\n  fresh:    {:?}\n  migrated: {:?}",
                table, fresh_cols, migrated_cols
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "schema parity broken on {} table(s):\n\n{}",
        mismatches.len(),
        mismatches.join("\n\n")
    );
}

#[test]
fn fresh_and_migrated_have_same_indexes_per_table() {
    let (_a, fresh) = open_fresh();
    let (_b, migrated) = open_migrated();

    let mut mismatches = Vec::<String>::new();
    for table in user_tables(&fresh) {
        let fresh_idx = index_list(&fresh, &table);
        let migrated_idx = index_list(&migrated, &table);
        if fresh_idx != migrated_idx {
            mismatches.push(format!(
                "indexes on table '{}' diverged:\n  fresh:    {:?}\n  migrated: {:?}",
                table, fresh_idx, migrated_idx
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "index parity broken on {} table(s):\n\n{}",
        mismatches.len(),
        mismatches.join("\n\n")
    );
}

#[test]
fn fresh_and_migrated_have_same_foreign_keys() {
    let (_a, fresh) = open_fresh();
    let (_b, migrated) = open_migrated();

    let mut mismatches = Vec::<String>::new();
    for table in user_tables(&fresh) {
        let fresh_fk = foreign_key_list(&fresh, &table);
        let migrated_fk = foreign_key_list(&migrated, &table);
        if fresh_fk != migrated_fk {
            mismatches.push(format!(
                "foreign keys on table '{}' diverged:\n  fresh:    {:?}\n  migrated: {:?}",
                table, fresh_fk, migrated_fk
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "foreign-key parity broken on {} table(s):\n\n{}",
        mismatches.len(),
        mismatches.join("\n\n")
    );
}

#[test]
fn fresh_and_migrated_have_same_index_definitions() {
    let (_a, fresh) = open_fresh();
    let (_b, migrated) = open_migrated();

    let fresh_idx = user_indexes(&fresh);
    let migrated_idx = user_indexes(&migrated);

    assert_eq!(
        fresh_idx, migrated_idx,
        "index DDL must match between fresh-install and v0.2.x-migrated databases.\n\
         fresh:    {:?}\n\
         migrated: {:?}",
        fresh_idx, migrated_idx
    );
}

#[test]
fn fresh_and_migrated_share_user_version() {
    let (_a, fresh) = open_fresh();
    let (_b, migrated) = open_migrated();

    let fresh_v: i64 = fresh
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    let migrated_v: i64 = migrated
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();

    assert_eq!(fresh_v, migrated_v, "user_version must match");
    assert_eq!(fresh_v, 12, "user_version is 12 after all migrations");
}
