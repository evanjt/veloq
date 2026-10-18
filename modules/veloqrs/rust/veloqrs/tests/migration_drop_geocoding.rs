//! Scenario: a library is opened by this build, once from the schema a
//! released build shipped and once from the one just before place names
//! stopped being asked of a geocoder, holding a typed route name, a geocoded
//! route name, a kept place answer and the geocoding settings.
//!
//! Expected behaviour: the geocoded tables and every geocoding setting are
//! gone, no trigger still writes to them, and the typed name and the
//! athlete's other settings survive.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const GEOCODING_KEYS: [&str; 5] = [
    "__geocoding_enabled",
    "__geocoding_enabled_at",
    "__geocoder_config",
    "__geocoder_refused_until",
    "__place_name_words",
];

fn setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let seeded = seed_at_version(&path, version);
    seeded
        .execute(
            "INSERT INTO route_names (route_id, custom_name) VALUES ('r1', 'Harbour loop')",
            [],
        )
        .unwrap();
    seeded
        .execute(
            "INSERT INTO settings (key, value) VALUES ('units', 'imperial')",
            [],
        )
        .unwrap();
    for key in GEOCODING_KEYS {
        seeded
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, '1')",
                params![key],
            )
            .unwrap();
    }
    let tables = tables_at(&seeded);
    if tables.contains(&"geocoded_names".to_string()) {
        seeded
            .execute(
                "INSERT INTO geocoded_names (kind, item_id, name, queued_at)
                 VALUES ('route', 'r2', 'Quay to Point', 1)",
                [],
            )
            .unwrap();
    }
    if tables.contains(&"geocoded_places".to_string()) {
        seeded
            .execute(
                "INSERT INTO geocoded_places (lat_cell, lng_cell, language, name, answered_at)
                 VALUES (1, 2, 'en-AU', 'Quay', 1)",
                [],
            )
            .unwrap();
    }
    drop(seeded);

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    let tables = tables_at(&conn);
    assert!(
        !tables.contains(&"geocoded_names".to_string()),
        "{tables:?}"
    );
    assert!(
        !tables.contains(&"geocoded_places".to_string()),
        "{tables:?}"
    );
    let triggers: Vec<String> = conn
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(
        triggers.iter().all(|sql| !sql.contains("geocoded")),
        "a trigger still writes to a dropped table after the upgrade from v{version}"
    );
    for key in GEOCODING_KEYS {
        assert_eq!(
            setting(&conn, key),
            None,
            "{key} survives the upgrade from v{version}"
        );
    }
    assert_eq!(setting(&conn, "units").as_deref(), Some("imperial"));
    let typed: String = conn
        .query_row(
            "SELECT custom_name FROM route_names WHERE route_id = 'r1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(typed, "Harbour loop");
}

#[test]
fn an_upgrade_from_the_released_schema_holds_no_geocoding_state() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_drop_clears_the_geocoded_names_and_settings() {
    upgrade_from(72);
}
