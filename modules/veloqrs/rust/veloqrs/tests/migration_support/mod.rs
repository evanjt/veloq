//! Shared seeding for migration tests.
//!
//! Every released 0.3.0 to 0.3.8 shipped `user_version = 12`. Tests that want to
//! reproduce the upgrade a live user actually takes need a database that is
//! genuinely at that version, built from the migrations that shipped rather than
//! from a hand-copied list that drifts silently.
//!
//! `seed_at_version` applies a prefix of `PersistentEngine::migration_scripts()`,
//! the same vector `init_schema` runs, so a seed can never disagree with the
//! production chain.

#![allow(dead_code)]

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};
use std::path::Path;
use veloqrs::PersistentEngine;

/// Highest migration number the crate ships. A seed above this is a bug in the
/// caller, not something to clamp silently.
pub fn latest_version() -> u32 {
    PersistentEngine::migration_scripts().len() as u32
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
    let scripts = PersistentEngine::migration_scripts();
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

/// The app-level version in `schema_info`, or `None` where the table or the row
/// is absent, which is every database older than 012.
pub fn app_schema_version(conn: &Connection) -> Option<u32> {
    conn.query_row(
        "SELECT value FROM schema_info WHERE key = 'schema_version'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse().ok())
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

    stmt.query_map([], |row| row.get::<_, String>(0))
        .expect("query sqlite_master")
        .collect::<Result<Vec<_>, _>>()
        .expect("read table names")
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

/// One row or value a table rebuild failed to carry across its migration.
#[derive(Debug, Clone, PartialEq)]
pub struct CarryLoss {
    /// The migration's number, 1-based like `user_version`.
    pub migration: usize,
    pub table: String,
    /// The shared column whose values moved, `None` for a loss of whole rows.
    pub column: Option<String>,
    pub what: String,
}

impl std::fmt::Display for CarryLoss {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.column {
            Some(column) => write!(
                f,
                "migration {} {}.{}: {}",
                self.migration, self.table, column, self.what
            ),
            None => write!(
                f,
                "migration {} {}: {}",
                self.migration, self.table, self.what
            ),
        }
    }
}

/// Every row or shared value a table rebuild in `scripts` failed to carry.
///
/// Two in-memory databases walk the chain one migration at a time. The shape
/// database stays empty and finds the rebuilds: a table present before and
/// after step `n` whose `rootpage` moved was dropped and created again under
/// its name, which is what a create-copy-drop-rename does, while `ADD COLUMN`,
/// `DROP COLUMN` and `RENAME COLUMN` rewrite in place and keep the page. Before
/// step `n` the data database gets one row from `fill` in each table step `n`
/// rebuilds, and every row in it is compared, as a multiset projected onto the
/// columns shared before and after, with what the step left.
///
/// A rebuilt table with no row to carry is itself a loss, so the check never
/// passes for want of data. The detector cannot see a bare `DROP TABLE x;
/// CREATE TABLE x` that copies nothing and reuses the freed page; a script
/// like that discards its rows on purpose.
pub fn rebuild_losses(
    scripts: &[&'static str],
    fill: &dyn Fn(&Connection, &str),
) -> Vec<CarryLoss> {
    let mut shape = Connection::open_in_memory().expect("open shape database");
    let mut data = Connection::open_in_memory().expect("open data database");
    let mut losses = Vec::new();

    for n in 1..=scripts.len() {
        // Auto-vacuum moves root pages on any drop, and the detector rests on
        // a page moving only when its table is created again.
        let auto_vacuum: i64 = shape
            .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
            .expect("read auto_vacuum");
        assert_eq!(auto_vacuum, 0, "auto_vacuum is on before migration {n}");

        let before = root_pages(&shape);
        apply_through(&mut shape, scripts, n);
        let after = root_pages(&shape);

        let mut carried = Vec::new();
        for (table, page) in &before {
            if after.get(table).is_some_and(|moved| moved != page) {
                fill(&data, table);
                let columns = columns_of(&data, table);
                let rows = rows_of(&data, table, &columns);
                carried.push((table.clone(), columns, rows));
            }
        }

        apply_through(&mut data, scripts, n);

        for (table, columns, rows) in carried {
            let loss = |column: Option<&str>, what: String| CarryLoss {
                migration: n,
                table: table.clone(),
                column: column.map(str::to_string),
                what,
            };
            if rows.is_empty() {
                losses.push(loss(None, "rebuilt with no row to carry".to_string()));
                continue;
            }

            let kept = columns_of(&data, &table);
            let shared: Vec<usize> = (0..columns.len())
                .filter(|&i| kept.contains(&columns[i]))
                .collect();
            let shared_names: Vec<String> = shared.iter().map(|&i| columns[i].clone()).collect();
            let was: Vec<Vec<String>> = rows
                .into_iter()
                .map(|row| shared.iter().map(|&i| row[i].clone()).collect())
                .collect();
            let now = rows_of(&data, &table, &shared_names);

            if was.len() != now.len() {
                losses.push(loss(
                    None,
                    format!("{} rows became {}", was.len(), now.len()),
                ));
                continue;
            }
            let mut moved_column = false;
            for (at, name) in shared_names.iter().enumerate() {
                let column = |rows: &[Vec<String>]| -> Vec<String> {
                    let mut values: Vec<String> = rows.iter().map(|row| row[at].clone()).collect();
                    values.sort();
                    values
                };
                let (was_values, now_values) = (column(&was), column(&now));
                if was_values != now_values {
                    moved_column = true;
                    losses.push(loss(
                        Some(name),
                        format!("{was_values:?} became {now_values:?}"),
                    ));
                }
            }
            if !moved_column && was != now {
                losses.push(loss(None, "the same values sit in other rows".to_string()));
            }
        }
    }
    losses
}

/// Apply migration `n` to a connection already holding `1..n`.
fn apply_through(conn: &mut Connection, scripts: &[&'static str], n: usize) {
    let prefix: Vec<M> = scripts[..n].iter().copied().map(M::up).collect();
    Migrations::new(prefix)
        .to_latest(conn)
        .unwrap_or_else(|e| panic!("apply migration {n}: {e}"));
}

/// Each user table's root page, which moves when the table is created again.
fn root_pages(conn: &Connection) -> std::collections::BTreeMap<String, i64> {
    let mut stmt = conn
        .prepare(
            "SELECT name, rootpage FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .expect("prepare root page query");
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("query root pages")
        .collect::<Result<_, _>>()
        .expect("read root pages")
}

/// Every row of `table` over `columns`, each value in a form that sorts and
/// compares exactly, the rows sorted so two snapshots compare as multisets.
fn rows_of(conn: &Connection, table: &str, columns: &[String]) -> Vec<Vec<String>> {
    if columns.is_empty() {
        let count = row_count(conn, table).unwrap_or(0);
        return vec![Vec::new(); count as usize];
    }
    let list: Vec<String> = columns.iter().map(|c| format!("\"{c}\"")).collect();
    let mut stmt = conn
        .prepare(&format!("SELECT {} FROM \"{table}\"", list.join(", ")))
        .unwrap_or_else(|e| panic!("read {table}: {e}"));
    let mut rows: Vec<Vec<String>> = stmt
        .query_map([], |row| {
            (0..columns.len())
                .map(|i| {
                    row.get::<_, rusqlite::types::Value>(i)
                        .map(|v| format!("{v:?}"))
                })
                .collect()
        })
        .expect("query rows")
        .collect::<Result<_, _>>()
        .expect("read rows");
    rows.sort();
    rows
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

/// The released v12 dump with every demo key rewritten to a signed-in shape.
///
/// `census_candidates` skips `demo-` keys, so the shipped fixture reaches the
/// census reconcile with nothing to compare. This gives every distinct demo
/// key an invented server-style key of the same byte length, `i` and then
/// zero-padded digits from a counter over the sorted keys, in the quoted text
/// and in the hex of every `X'…'` blob. Same length keeps each bincode length
/// prefix inside the route group and section blobs valid. The athlete becomes
/// the invented `i900001`.
///
/// Built in memory and never written to `tests/fixtures/`: the dump stays the
/// captured bytes and every key here is invented. Panics when a `demo-` key
/// survives in either form, so a missed site fails here rather than leaving a
/// row the census rule skips.
pub fn signed_in_v12_fixture() -> String {
    const DEMO: &str = include_str!("../fixtures/v12_demo.sql");
    const DEMO_HEX: &str = "64656d6f2d";

    // The header comment describes the capture in words, not keys.
    let mut sql: String = DEMO
        .lines()
        .filter(|line| !line.starts_with("--"))
        .flat_map(|line| [line, "\n"])
        .collect();

    let mut keys: Vec<&str> = DEMO
        .match_indices("demo-")
        .map(|(at, _)| {
            let tail = &DEMO[at..];
            let end = tail
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
                .unwrap_or(tail.len());
            &tail[..end]
        })
        .filter(|key| key.len() > "demo-".len())
        .collect();
    keys.sort_unstable();
    keys.dedup();

    let mut renamed: Vec<(&str, String)> = keys
        .iter()
        .enumerate()
        .map(|(n, key)| (*key, format!("i{:0width$}", n + 1, width = key.len() - 1)))
        .collect();
    // Longest first, so a key that is a prefix of another never splits it.
    renamed.sort_by_key(|(key, _)| std::cmp::Reverse(key.len()));

    let hex = |text: &str| -> String { text.bytes().map(|b| format!("{b:02x}")).collect() };
    for (key, invented) in &renamed {
        assert_eq!(
            key.len(),
            invented.len(),
            "{invented} changes the key length"
        );
        sql = sql
            .replace(key, invented)
            .replace(&hex(key), &hex(invented));
    }

    sql = sql
        .replace(
            "INSERT INTO settings VALUES('__athlete_id','demo',",
            "INSERT INTO settings VALUES('__athlete_id','i900001',",
        )
        .replace("{\"id\":\"demo\",", "{\"id\":\"i900001\",");

    assert!(!sql.contains("demo-"), "a demo key survives as text");
    assert!(!sql.contains(DEMO_HEX), "a demo key survives inside a blob");
    assert!(
        !sql.contains("'demo'") && !sql.contains("\"demo\""),
        "the demo athlete survives"
    );
    sql
}
