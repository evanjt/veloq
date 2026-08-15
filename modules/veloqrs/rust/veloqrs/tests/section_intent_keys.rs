//! `section_intents` is keyed on (id, kind), so one section carries at most
//! one intent per kind and intents of different kind never overwrite each
//! other.

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;
use veloqrs::sections::CreateSectionParams;

fn polyline() -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint::new(46.2 + i as f64 * 0.0005, 7.35))
        .collect()
}

fn open() -> (TempDir, PersistentRouteEngine, String) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("intents.db");
    let db_path = path.to_str().unwrap().to_string();
    let engine = PersistentRouteEngine::new(&db_path).expect("engine");
    (dir, engine, db_path)
}

fn create(engine: &mut PersistentRouteEngine) -> String {
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: polyline(),
            distance_meters: 1_100.0,
            name: None,
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .expect("create section")
}

fn kinds_for(conn: &Connection, id: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT kind FROM section_intents WHERE id = ? ORDER BY kind")
        .expect("prepare");
    stmt.query_map([id], |row| row.get(0))
        .expect("query")
        .flatten()
        .collect()
}

/// Disabling then deleting one section leaves both intents standing. Under the
/// old `id`-only key the delete rewrote the disable row in place.
#[test]
fn disable_then_delete_keeps_both_intents() {
    let (_dir, mut engine, db_path) = open();
    let id = create(&mut engine);

    engine.disable_section(&id).expect("disable");
    engine.delete_section(&id).expect("delete");
    drop(engine);

    let conn = Connection::open(&db_path).expect("reopen");
    assert_eq!(
        kinds_for(&conn, &id),
        vec!["deleted".to_string(), "disabled".to_string()],
        "both intents must survive on one section id"
    );
}

/// Re-disabling the same section updates its own row rather than stacking a
/// second one: the key still enforces one intent per kind.
#[test]
fn repeat_disable_updates_in_place() {
    let (_dir, mut engine, db_path) = open();
    let id = create(&mut engine);

    engine.disable_section(&id).expect("disable");
    engine.enable_section(&id).expect("enable");
    engine.disable_section(&id).expect("disable again");
    drop(engine);

    let conn = Connection::open(&db_path).expect("reopen");
    assert_eq!(kinds_for(&conn, &id), vec!["disabled".to_string()]);
}

/// A named intent and a suppression intent coexist on one id. Named rows carry
/// minted `ni_` ids today, so this is the key's guarantee rather than a path
/// production reaches.
#[test]
fn named_and_disabled_coexist_on_one_id() {
    let (_dir, engine, db_path) = open();
    drop(engine);

    let conn = Connection::open(&db_path).expect("reopen");
    for kind in ["named", "disabled"] {
        conn.execute(
            "INSERT INTO section_intents (id, kind, polyline_json, name) VALUES (?, ?, '[]', ?)",
            rusqlite::params!["shared_id", kind, kind],
        )
        .expect("insert intent");
    }

    assert_eq!(
        kinds_for(&conn, "shared_id"),
        vec!["disabled".to_string(), "named".to_string()]
    );
}

/// The upgrade hook rebuilds an `id`-only table without losing the name and
/// sport columns the named-corridor shape carries.
#[test]
fn upgrade_widens_key_and_keeps_named_columns() {
    let (_dir, engine, db_path) = open();
    drop(engine);

    {
        let conn = Connection::open(&db_path).expect("reopen");
        conn.execute_batch(
            "DROP TABLE section_intents;
             CREATE TABLE section_intents (
                 id TEXT PRIMARY KEY,
                 kind TEXT NOT NULL CHECK(kind IN ('disabled', 'deleted', 'named')),
                 polyline_json TEXT NOT NULL,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 name TEXT,
                 sport_type TEXT
             );
             INSERT INTO section_intents (id, kind, polyline_json, name, sport_type)
                 VALUES ('ni_old', 'named', '[]', 'Col des Planches', 'Ride');",
        )
        .expect("install old shape");
    }

    let engine = PersistentRouteEngine::new(&db_path).expect("reopen engine");
    drop(engine);

    let conn = Connection::open(&db_path).expect("reopen");
    let (name, sport): (String, String) = conn
        .query_row(
            "SELECT name, sport_type FROM section_intents WHERE id = 'ni_old'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("named row survives the rebuild");
    assert_eq!(name, "Col des Planches");
    assert_eq!(sport, "Ride");

    conn.execute(
        "INSERT INTO section_intents (id, kind, polyline_json) VALUES ('ni_old', 'disabled', '[]')",
        [],
    )
    .expect("widened key admits a second kind");
}
