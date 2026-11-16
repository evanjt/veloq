//! Scenario: a library that already holds rides, one of them with a body that
//! is not JSON, is opened by this build, once from the schema the newest
//! release shipped and once from the schema just before the table arrived.
//!
//! Expected behaviour: every stored body has its start and sport in
//! `ride_identity` and no row is lost, a body written afterwards is kept in
//! step and a body deleted afterwards takes its row away, and a ride the
//! library holds is found by the same start with the same sport.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::ride_identity::{Existing, RideIdentity, existing_ride_for};

const START: i64 = 1_773_479_000;

fn identity_of(conn: &Connection, key: &str) -> Option<(i64, Option<String>)> {
    conn.query_row(
        "SELECT start_local, sport FROM ride_identity WHERE activity_id = ?1",
        params![key],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .ok()
}

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    {
        let conn = seed_at_version(&path, version);
        assert!(!tables_at(&conn).contains(&"ride_identity".to_string()));
        for (key, date, raw) in [
            ("i1", START, r#"{"type":"Ride"}"#),
            ("src-file-aa", START + 7_200, r#"{"type":"Run"}"#),
            ("odd", START + 9_000, "not json"),
        ] {
            conn.execute(
                "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, ?2, ?3)",
                params![key, date, raw],
            )
            .unwrap();
        }
    }

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert_eq!(row_count(&conn, "activity_bodies"), Some(3));
    assert_eq!(row_count(&conn, "ride_identity"), Some(3));
    assert_eq!(identity_of(&conn, "i1"), Some((START, Some("Ride".into()))));
    assert_eq!(
        identity_of(&conn, "src-file-aa"),
        Some((START + 7_200, Some("Run".into())))
    );
    assert_eq!(identity_of(&conn, "odd"), Some((START + 9_000, None)));

    let ride = |start: i64, sport: &str| RideIdentity {
        device_serial: None,
        created_unix: None,
        start_local: start,
        sport: sport.into(),
    };
    assert_eq!(
        existing_ride_for(&conn, &ride(START + 30, "Ride")).unwrap(),
        Existing::One("i1".into())
    );
    assert_eq!(
        existing_ride_for(&conn, &ride(START + 61, "Ride")).unwrap(),
        Existing::Nothing
    );

    conn.execute(
        "UPDATE activity_bodies SET date = ?1 WHERE activity_id = 'i1'",
        [START + 3_600],
    )
    .unwrap();
    assert_eq!(
        identity_of(&conn, "i1"),
        Some((START + 3_600, Some("Ride".into())))
    );
    conn.execute("DELETE FROM activity_bodies WHERE activity_id = 'i1'", [])
        .unwrap();
    assert_eq!(identity_of(&conn, "i1"), None);
    assert_eq!(row_count(&conn, "ride_identity"), Some(2));
}

#[test]
fn an_upgrade_from_the_newest_release_gives_every_stored_ride_an_identity() {
    upgrade_from(latest_release().user_version);
}

#[test]
fn an_upgrade_from_the_schema_before_the_table_gives_every_stored_ride_an_identity() {
    upgrade_from(97);
}
