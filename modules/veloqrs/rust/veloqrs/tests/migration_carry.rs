//! Scenario: a migration rebuilds a table by create-copy-drop-rename, naming
//! the columns of its `INSERT ... SELECT` by hand.
//!
//! Expected behaviour: every row the table held before the rebuild is there
//! after it, with the same value in every column the two shapes share. The
//! schema golden owns the shape; this owns the rows and values across a
//! rebuild.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use rusqlite::types::Value;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use veloqrs::PersistentEngine;

/// A deliberate change of a shared value across a rebuild:
/// `(migration, table, column, reason)`. Every entry carries its reason.
const ALLOWED: &[(usize, &str, &str, &str)] = &[];

/// What a column takes when its declared type and foreign keys cannot say.
enum Given {
    /// One of the values a CHECK list allows.
    Text(&'static str),
    /// A key into a parent row that a copy filters on but no FK declares.
    Key(&'static str, &'static str),
}

const OVERRIDES: &[(&str, &str, Given)] = &[
    ("section_intents", "kind", Given::Text("named")),
    ("sections", "section_type", Given::Text("custom")),
    (
        "section_activities",
        "activity_id",
        Given::Key("activities", "id"),
    ),
];

/// Fills a table with one row in which every column holds a value that is
/// neither null nor its default, so a copy that drops a column or lets it fall
/// back to its default shows. Parent rows are filled first and referenced.
struct Filler<'a> {
    overrides: &'a [(&'a str, &'a str, Given)],
    next: Cell<i64>,
}

struct ColumnInfo {
    cid: i64,
    name: String,
    declared: String,
    pk: i64,
}

impl<'a> Filler<'a> {
    fn new(overrides: &'a [(&'a str, &'a str, Given)]) -> Self {
        Self {
            overrides,
            next: Cell::new(0),
        }
    }

    fn fill(&self, conn: &Connection, table: &str) {
        self.fill_row(conn, table, 0);
    }

    fn fill_row(&self, conn: &Connection, table: &str, depth: usize) -> HashMap<String, Value> {
        assert!(depth < 8, "filling {table} recursed through its parents");
        let k = self.next.get();
        self.next.set(k + 1);

        let columns = column_info(conn, table);
        let keys = foreign_keys(conn, table);
        let mut parents: HashMap<i64, HashMap<String, Value>> = HashMap::new();
        let mut row: Vec<(String, Value)> = Vec::new();

        for column in &columns {
            let given = self
                .overrides
                .iter()
                .find(|(t, c, _)| *t == table && *c == column.name)
                .map(|(_, _, given)| given);
            let value = match given {
                Some(Given::Text(text)) => Value::Text((*text).to_string()),
                Some(Given::Key(parent, to)) => self
                    .fill_row(conn, parent, depth + 1)
                    .remove(*to)
                    .unwrap_or_else(|| panic!("{parent} has no column {to}")),
                None => match keys.iter().find(|key| key.from == column.name) {
                    Some(key) => {
                        let parent = parents
                            .entry(key.id)
                            .or_insert_with(|| self.fill_row(conn, &key.parent, depth + 1));
                        let to = key
                            .to
                            .clone()
                            .unwrap_or_else(|| primary_key(conn, &key.parent));
                        parent
                            .get(&to)
                            .cloned()
                            .unwrap_or_else(|| panic!("{}.{to} was not filled", key.parent))
                    }
                    None => typed_value(table, column, k),
                },
            };
            row.push((column.name.clone(), value));
        }

        let names: Vec<String> = row.iter().map(|(name, _)| format!("\"{name}\"")).collect();
        let marks = vec!["?"; row.len()].join(", ");
        let sql = format!(
            "INSERT INTO \"{table}\" ({}) VALUES ({marks})",
            names.join(", ")
        );
        let values: Vec<&Value> = row.iter().map(|(_, value)| value).collect();
        conn.execute(&sql, rusqlite::params_from_iter(values))
            .unwrap_or_else(|e| {
                panic!("fill {table}: {e}; add an override for the column SQLite refused")
            });
        row.into_iter().collect()
    }
}

/// A value of the column's declared type, salted by table, column and row so
/// no two columns or rows share one and none equals a default.
fn typed_value(table: &str, column: &ColumnInfo, k: i64) -> Value {
    let salt = format!("{table}.{}", column.name)
        .bytes()
        .fold(0i64, |hash, b| (hash * 31 + i64::from(b)) % 997);
    let declared = column.declared.to_ascii_uppercase();
    if declared.contains("INT") {
        Value::Integer(7001 + salt + 1000 * k)
    } else if declared.contains("CHAR") || declared.contains("CLOB") || declared.contains("TEXT") {
        Value::Text(format!("carry-{table}-{}-{k}", column.name))
    } else if declared.contains("BLOB") || declared.is_empty() {
        let mut bytes = vec![0xc0, 0xff, 0xee];
        bytes.extend_from_slice(&k.to_be_bytes());
        bytes.extend_from_slice(&column.cid.to_be_bytes());
        Value::Blob(bytes)
    } else if declared.contains("REAL") || declared.contains("FLOA") || declared.contains("DOUB") {
        Value::Real(0.25 + salt as f64 + 1000.0 * k as f64)
    } else {
        Value::Integer(7001 + salt + 1000 * k)
    }
}

fn column_info(conn: &Connection, table: &str) -> Vec<ColumnInfo> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{table}\")"))
        .expect("prepare table_info");
    stmt.query_map([], |row| {
        Ok(ColumnInfo {
            cid: row.get(0)?,
            name: row.get(1)?,
            declared: row.get(2)?,
            pk: row.get(5)?,
        })
    })
    .expect("query table_info")
    .collect::<Result<_, _>>()
    .expect("read table_info")
}

struct ForeignKey {
    id: i64,
    parent: String,
    from: String,
    to: Option<String>,
}

fn foreign_keys(conn: &Connection, table: &str) -> Vec<ForeignKey> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA foreign_key_list(\"{table}\")"))
        .expect("prepare foreign_key_list");
    stmt.query_map([], |row| {
        Ok(ForeignKey {
            id: row.get(0)?,
            parent: row.get(2)?,
            from: row.get(3)?,
            to: row.get(4)?,
        })
    })
    .expect("query foreign_key_list")
    .collect::<Result<_, _>>()
    .expect("read foreign_key_list")
}

/// The single primary key column a foreign key with no named column points at.
fn primary_key(conn: &Connection, table: &str) -> String {
    let keys: Vec<String> = column_info(conn, table)
        .into_iter()
        .filter(|column| column.pk > 0)
        .map(|column| column.name)
        .collect();
    assert_eq!(
        keys.len(),
        1,
        "{table} has no single primary key to point at"
    );
    keys.into_iter().next().unwrap()
}

#[test]
fn every_rebuild_in_the_chain_carries_its_rows_and_values() {
    let filler = Filler::new(OVERRIDES);
    let rebuilt = RefCell::new(Vec::new());
    let losses: Vec<String> =
        rebuild_losses(&PersistentEngine::migration_scripts(), &|conn, table| {
            rebuilt.borrow_mut().push(table.to_string());
            filler.fill(conn, table);
        })
        .into_iter()
        .filter(|loss| {
            !ALLOWED.iter().any(|(migration, table, column, _)| {
                loss.migration == *migration
                    && loss.table == *table
                    && loss.column.as_deref() == Some(*column)
            })
        })
        .map(|loss| loss.to_string())
        .collect();
    assert!(
        losses.is_empty(),
        "rebuilds lost data:\n{}",
        losses.join("\n")
    );

    // Tables the chain is known to rebuild, so a detector gone blind fails here
    // rather than passing with nothing compared.
    let rebuilt = rebuilt.into_inner();
    for table in ["section_activities", "section_intents", "pace_history"] {
        assert!(
            rebuilt.iter().any(|t| t == table),
            "{table} was not seen rebuilt: {rebuilt:?}"
        );
    }
}

const TRAIL_LOG: &str = "CREATE TABLE trail_log (id TEXT PRIMARY KEY, note TEXT, grade REAL);";

fn invented_chain(rebuild: &'static str) -> Vec<CarryLoss> {
    let filler = Filler::new(&[]);
    rebuild_losses(&[TRAIL_LOG, rebuild], &|conn, table| {
        filler.fill(conn, table);
        filler.fill(conn, table);
    })
}

#[test]
fn a_rebuild_that_carries_everything_reports_nothing() {
    let losses = invented_chain(
        "CREATE TABLE trail_log_next (id TEXT PRIMARY KEY, note TEXT, grade REAL, surface TEXT);
         INSERT INTO trail_log_next (id, note, grade) SELECT id, note, grade FROM trail_log;
         DROP TABLE trail_log;
         ALTER TABLE trail_log_next RENAME TO trail_log;",
    );
    assert_eq!(losses, Vec::new());
}

#[test]
fn a_rebuild_that_drops_a_value_is_reported() {
    let losses = invented_chain(
        "CREATE TABLE trail_log_next (id TEXT PRIMARY KEY, note TEXT, grade REAL);
         INSERT INTO trail_log_next (id, note, grade) SELECT id, NULL, grade FROM trail_log;
         DROP TABLE trail_log;
         ALTER TABLE trail_log_next RENAME TO trail_log;",
    );
    let columns: Vec<(usize, &str, Option<&str>)> = losses
        .iter()
        .map(|loss| (loss.migration, loss.table.as_str(), loss.column.as_deref()))
        .collect();
    assert_eq!(columns, vec![(2, "trail_log", Some("note"))], "{losses:?}");
}

#[test]
fn a_rebuild_that_loses_rows_is_reported() {
    let losses = invented_chain(
        "CREATE TABLE trail_log_next (id TEXT PRIMARY KEY, note TEXT, grade REAL);
         INSERT INTO trail_log_next (id, note, grade)
             SELECT id, note, grade FROM trail_log WHERE grade > 1000;
         DROP TABLE trail_log;
         ALTER TABLE trail_log_next RENAME TO trail_log;",
    );
    assert_eq!(losses.len(), 1, "{losses:?}");
    assert_eq!(
        (losses[0].migration, losses[0].table.as_str()),
        (2, "trail_log")
    );
    assert_eq!(losses[0].column, None, "{losses:?}");
    assert!(losses[0].what.contains("2 rows"), "{}", losses[0]);
}

#[test]
fn a_rebuilt_table_with_nothing_to_carry_is_reported() {
    let losses = rebuild_losses(
        &[
            TRAIL_LOG,
            "CREATE TABLE trail_log_next (id TEXT PRIMARY KEY, note TEXT, grade REAL);
             DROP TABLE trail_log;
             ALTER TABLE trail_log_next RENAME TO trail_log;",
        ],
        &|_, _| {},
    );
    assert_eq!(losses.len(), 1, "{losses:?}");
    assert!(losses[0].what.contains("no row"), "{}", losses[0]);
}

#[test]
fn a_change_made_in_place_is_not_a_rebuild() {
    let losses = rebuild_losses(
        &[
            TRAIL_LOG,
            "ALTER TABLE trail_log ADD COLUMN surface TEXT;
             ALTER TABLE trail_log RENAME COLUMN note TO remark;
             ALTER TABLE trail_log DROP COLUMN grade;",
        ],
        &|_, table| panic!("{table} was taken for a rebuild"),
    );
    assert_eq!(losses, Vec::new());
}
