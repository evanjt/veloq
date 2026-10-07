//! `clear()` is the logout path. Everything it misses is one athlete's data
//! shown to the next, and nothing cascades: only three tables carry an
//! activity foreign key. So the list of tables cannot be maintained by hand
//! against a schema that keeps growing. This drives it from `sqlite_master`.
//!
//! What survives is not a list here. It is `TableClass::Meta` and
//! `TableClass::Device` in `persistence::tables`, so a table added next year
//! says whether it survives a logout in the same place it says whether a
//! backup carries it.

use std::collections::HashMap;

use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::tables::{TableClass, tables_of};

fn survivors() -> Vec<&'static str> {
    tables_of(TableClass::Meta)
        .chain(tables_of(TableClass::Device))
        .collect()
}

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
    let survivors = survivors();
    names
        .into_iter()
        .filter(|n| !survivors.contains(&n.as_str()))
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
/// A replace, because seeding another table may already have fired a trigger
/// that wrote this one a row.
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
            "INSERT OR REPLACE INTO \"{table}\" ({}) VALUES ({})",
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
    for table in tables.iter().map(String::as_str).chain(survivors()) {
        seed(&conn, table);
        assert!(count(&conn, table) > 0, "{table} was not seeded");
    }

    engine.clear().expect("clear");

    let survived: Vec<&String> = tables.iter().filter(|t| count(&conn, t) > 0).collect();
    assert!(
        survived.is_empty(),
        "clear() left rows behind, so the next athlete inherits them: {survived:?}"
    );
    for table in survivors() {
        assert!(
            count(&conn, table) > 0,
            "{table} is meant to survive clear()"
        );
    }
}

/// A sign-out keeps every recording on the device and only stops the
/// auto-upload, which the app does by demoting them to `localOnly`. The index
/// used to sit outside the database, so the move into it must not quietly
/// start destroying rides that have reached no server.
#[test]
fn a_logout_keeps_the_recordings_whose_fit_files_stay_on_disk() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("clear.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");

    let conn = Connection::open(&path).expect("second connection");
    seed(&conn, "recordings");
    assert!(count(&conn, "recordings") > 0, "recordings was not seeded");

    engine.clear().expect("clear");

    assert!(
        count(&conn, "recordings") > 0,
        "clear() destroyed a recording the athlete still has the FIT file for"
    );
}

/// Scenario: the athlete signs out and deletes their data, then taps Try Demo
/// without a restart. The open engine still answered the previous athlete's
/// id, so the demo was offered as another account's library.
///
/// Expected behaviour: a clear takes the athlete's id with the library it
/// names, a second clear finds nothing to trip on, and every other setting
/// survives.
#[test]
fn clear_forgets_whose_library_it_was() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("clear.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.set_setting("__athlete_id", "i1").expect("athlete");
    engine
        .set_setting("unit_system", "metric")
        .expect("preference");

    engine.clear().expect("clear");

    assert_eq!(
        engine.get_setting("__athlete_id").expect("read"),
        None,
        "the previous athlete's id outlived the library it names"
    );
    assert_eq!(
        engine.get_setting("unit_system").expect("read").as_deref(),
        Some("metric"),
        "a device setting went with the athlete's id"
    );

    engine.clear().expect("a second clear");

    assert_eq!(engine.get_setting("__athlete_id").expect("read"), None);
    assert_eq!(
        engine.get_setting("unit_system").expect("read").as_deref(),
        Some("metric")
    );
}

/// Scenario: athlete A restores a record that owes activities and still holds
/// records waiting for their ground, then signs out and deletes their data.
///
/// Expected behaviour: every setting that describes A's library goes with it.
/// The pending records carry A's section names and ground, the owed ids would
/// spend B's credential on A's activities, and the answered mark would stop B
/// being offered a record their own device backup brings back.
#[test]
fn clear_forgets_the_record_restore_state() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("clear.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let library_keys = [
        "__record_restore_pending",
        "__record_activities_owed",
        "__record_activities_unavailable",
        "__platform_record_answered",
    ];
    for key in library_keys {
        engine.set_setting(key, "[\"a1\"]").expect("seed");
    }

    engine.clear().expect("clear");

    let survived: Vec<&str> = library_keys
        .into_iter()
        .filter(|key| engine.get_setting(key).expect("read").is_some())
        .collect();
    assert!(
        survived.is_empty(),
        "clear() left the previous library's record state: {survived:?}"
    );
}

/// Scenario: athlete A sets a home for exports and syncs their history, then
/// signs out and deletes their data, and athlete B signs in.
///
/// Expected behaviour: A's home, privacy radius, history span, yearly counts
/// and last sync go with A's library. Left behind, B's export privacy row
/// shows A's home, and B's next record zip carries A's coordinates under B's
/// athlete id.
#[test]
fn clear_forgets_the_athletes_home_and_sync_history() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("clear.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let athlete_keys = [
        "__export_home_lat",
        "__export_home_lng",
        "__export_privacy_radius_m",
        "oldest_activity_date",
        "activity_year_counts",
        "sync.last_success_at",
    ];
    for key in athlete_keys {
        engine.set_setting(key, "athlete-a").expect("seed");
    }

    engine.clear().expect("clear");

    let survived: Vec<&str> = athlete_keys
        .into_iter()
        .filter(|key| engine.get_setting(key).expect("read").is_some())
        .collect();
    assert!(
        survived.is_empty(),
        "clear() left the previous athlete's home and history: {survived:?}"
    );
}

/// Scenario: athlete A's library has spent its one-shot section redetect,
/// then A signs out and deletes their data, and athlete B signs in.
///
/// Expected behaviour: the stamp goes with A's library, so B's library is
/// owed the check again.
#[test]
fn clear_forgets_the_section_health_check_stamp() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("clear.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .set_setting("__section_health_check_done", "1")
        .expect("seed");

    engine.clear().expect("clear");

    assert_eq!(
        engine
            .get_setting("__section_health_check_done")
            .expect("read"),
        None,
        "the previous library's health check stamp outlived it"
    );
}
