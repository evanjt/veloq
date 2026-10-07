//! Scenario: a library from before the geocoder kept its answers is opened by
//! this build, once from the schema a released build shipped and once from the
//! one just before the table arrived.
//!
//! Expected behaviour: the upgrade leaves an empty table and geocoding off, so
//! nothing is answered from the device and nothing may be sent until the
//! athlete turns it on. An answer kept after it reads back.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::geocoded_places::{PlaceCell, cached_place, store_place};

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(seed_at_version(&path, version));
    assert!(!tables_at(&Connection::open(&path).unwrap()).contains(&"geocoded_places".to_string()));

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    assert!(
        !engine.geocoding_enabled(),
        "an upgrade from v{version} leaves geocoding off"
    );
    assert_eq!(engine.geocoding_enabled_at().unwrap(), None);
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    let cell = PlaceCell::of(-37.77, 145.01);
    assert_eq!(
        cached_place(&conn, cell, "en-AU").expect("the upgraded file answers"),
        None,
        "an upgrade from v{version} holds no answers"
    );

    store_place(&conn, cell, "en-AU", Some("Northcote"), 1_791_000_000_000).unwrap();
    store_place(
        &conn,
        PlaceCell::of(-38.5, 145.5),
        "en-AU",
        None,
        1_791_000_000_000,
    )
    .unwrap();
    assert_eq!(
        cached_place(&conn, cell, "en-AU").unwrap(),
        Some(Some("Northcote".to_string()))
    );
    assert_eq!(cached_place(&conn, cell, "fr-CH").unwrap(), None);
    assert_eq!(
        cached_place(&conn, PlaceCell::of(-38.5, 145.5), "en-AU").unwrap(),
        Some(None)
    );
}

#[test]
fn an_upgrade_from_the_released_schema_holds_no_places_and_leaves_geocoding_off() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_table_holds_no_places_and_leaves_geocoding_off() {
    upgrade_from(62);
}
