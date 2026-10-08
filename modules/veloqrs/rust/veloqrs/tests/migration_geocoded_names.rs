//! Scenario: a library from before geocoded names were kept is opened by this
//! build, once from the schema a released build shipped and once from the one
//! just before the table arrived, each holding a section.
//!
//! Expected behaviour: the upgrade leaves an empty table and queues nothing,
//! turning geocoding on afterwards queues none of the sections already held,
//! and a section that appears after that is queued once.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn queued(conn: &Connection) -> Vec<(String, String)> {
    let mut stmt = conn
        .prepare("SELECT kind, item_id FROM geocoded_names WHERE named_at IS NULL ORDER BY item_id")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn add_section(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
         VALUES (?1, 'auto', 'Ride', '[]', 1000)",
        params![id],
    )
    .unwrap();
}

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let seeded = seed_at_version(&path, version);
    add_section(&seeded, "held-before");
    drop(seeded);
    assert!(!tables_at(&Connection::open(&path).unwrap()).contains(&"geocoded_names".to_string()));

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    engine.set_geocoding_enabled(true).unwrap();
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert!(
        queued(&conn).is_empty(),
        "an upgrade from v{version} queues nothing that was already held"
    );

    add_section(&conn, "appeared-after");
    add_section(&conn, "appeared-after-2");
    conn.execute("DELETE FROM sections WHERE id = 'appeared-after'", [])
        .unwrap();
    add_section(&conn, "appeared-after");
    assert_eq!(
        queued(&conn),
        vec![
            ("section".to_string(), "appeared-after".to_string()),
            ("section".to_string(), "appeared-after-2".to_string()),
        ],
        "a section first seen after the switch is queued once"
    );
}

#[test]
fn an_upgrade_from_the_released_schema_queues_no_held_section() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_table_queues_no_held_section() {
    upgrade_from(66);
}
