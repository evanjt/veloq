//! `clear()` is the logout path. Everything it misses is one athlete's data
//! shown to the next, and nothing cascades: only three tables carry an
//! activity foreign key. So the list of tables cannot be maintained by hand
//! against a schema that keeps growing. This drives it from `sqlite_master`.
//!
//! `settings` and `schema_info` survive on purpose. Every other table empties.

use std::collections::HashMap;

use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const SURVIVORS: [&str; 2] = ["settings", "schema_info"];

fn tables(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .expect("read schema");
    let names: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .expect("query")
        .map(|r| r.expect("name"))
        .collect();
    names
        .into_iter()
        .filter(|n| !SURVIVORS.contains(&n.as_str()))
        .collect()
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM \"{table}\""), [], |r| {
        r.get(0)
    })
    .unwrap_or_else(|e| panic!("count {table}: {e}"))
}

/// Column to the first value its CHECK constraint allows. An arbitrary
/// string does not satisfy `CHECK(kind IN (...))`, and a table can carry two
/// such constraints wanting different values, so this reads them per column.
/// The scan is per CHECK expression, not per line, because one of them spans
/// several lines.
fn checked_values(conn: &Connection, table: &str) -> HashMap<String, String> {
    let ddl: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
            params![table],
            |r| r.get(0),
        )
        .unwrap_or_default();
    let mut out = HashMap::new();
    let bytes: Vec<char> = ddl.chars().collect();
    let mut i = 0;
    while let Some(found) = ddl[i..].find("CHECK") {
        let open = match ddl[i + found..].find('(') {
            Some(o) => i + found + o,
            None => break,
        };
        let mut depth = 0;
        let mut close = open;
        for (j, c) in bytes.iter().enumerate().skip(open) {
            match c {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        close = j;
                        break;
                    }
                }
                _ => {}
            }
        }
        let expr: String = bytes[open + 1..close].iter().collect();
        let column: String = expr
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .find(|t| !t.is_empty())
            .unwrap_or_default()
            .to_string();
        if let Some(value) = expr.split('\'').nth(1)
            && !column.is_empty()
        {
            out.insert(column, value.to_string());
        }
        i = close.max(i + found + 5);
    }
    out
}

/// One row in `table`, satisfying whatever CHECK constraints it carries.
fn seed(conn: &Connection, table: &str) {
    let checks = checked_values(conn, table);
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{table}\")"))
        .unwrap_or_else(|e| panic!("table_info {table}: {e}"));
    let cols: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
        .and_then(|rows| rows.collect())
        .unwrap_or_else(|e| panic!("columns of {table}: {e}"));
    let names: Vec<String> = cols.iter().map(|(n, _)| format!("\"{n}\"")).collect();
    let values: Vec<String> = cols
        .iter()
        .map(|(name, ty)| {
            let ty = ty.to_uppercase();
            if ty.contains("INT") {
                "1".to_string()
            } else if ty.contains("REAL") || ty.contains("FLOA") || ty.contains("DOUB") {
                "1.0".to_string()
            } else if ty.contains("BLOB") || ty.is_empty() {
                "x'00'".to_string()
            } else {
                let text = checks.get(name).map(String::as_str).unwrap_or("x");
                format!("'{}'", text.replace('\'', "''"))
            }
        })
        .collect();
    // A table that cannot be seeded fails here rather than being skipped,
    // or the wipe assertion below proves nothing about it.
    conn.execute(
        &format!(
            "INSERT INTO \"{table}\" ({}) VALUES ({})",
            names.join(", "),
            values.join(", ")
        ),
        [],
    )
    .unwrap_or_else(|e| panic!("could not seed {table}: {e}"));
}

#[test]
fn clear_wipes_every_table() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("clear.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");

    let conn = Connection::open(&path).expect("second connection");
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .expect("relax foreign keys for synthetic rows");

    let tables = tables(&conn);
    assert!(tables.len() > 20, "schema looks unmigrated: {tables:?}");
    for table in tables.iter().map(String::as_str).chain(SURVIVORS) {
        seed(&conn, table);
        assert!(count(&conn, table) > 0, "{table} was not seeded");
    }

    engine.clear().expect("clear");

    let survived: Vec<&String> = tables.iter().filter(|t| count(&conn, t) > 0).collect();
    assert!(
        survived.is_empty(),
        "clear() left rows behind, so the next athlete inherits them: {survived:?}"
    );
    for table in SURVIVORS {
        assert!(
            count(&conn, table) > 0,
            "{table} is meant to survive clear()"
        );
    }
}
