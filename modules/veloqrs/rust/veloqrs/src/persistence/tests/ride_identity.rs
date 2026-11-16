//! Scenario: rides reach the library from different sources and the same ride
//! must not be stored twice.
//!
//! Expected behaviour: a file with the same device serial number and creation
//! time as a stored row is that row, whatever its start; a file without a
//! device match is the row that started within a minute with the same sport;
//! a start 61 s away, another sport, or two candidates is no single row.

use super::{Existing, RideIdentity, existing_ride_for, record};
use crate::persistence::PersistentEngine;

fn engine() -> PersistentEngine {
    PersistentEngine::in_memory().expect("in-memory engine")
}

fn body(engine: &PersistentEngine, key: &str, start: i64, sport: &str) {
    engine
        .db
        .execute(
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, ?2, ?3)",
            rusqlite::params![key, start, format!(r#"{{"type":"{sport}"}}"#)],
        )
        .unwrap();
}

fn ride(start: i64, sport: &str) -> RideIdentity {
    RideIdentity {
        device_serial: None,
        created_unix: None,
        start_local: start,
        sport: sport.to_string(),
    }
}

fn on_device(mut identity: RideIdentity, serial: u64, created: i64) -> RideIdentity {
    identity.device_serial = Some(serial);
    identity.created_unix = Some(created);
    identity
}

const START: i64 = 1_773_479_000;

#[test]
fn a_start_within_a_minute_with_the_same_sport_is_the_row() {
    let engine = engine();
    body(&engine, "i1", START, "Ride");

    for offset in [0, 60, -60] {
        assert_eq!(
            existing_ride_for(&engine.db, &ride(START + offset, "Ride")).unwrap(),
            Existing::One("i1".into()),
            "{offset} s away"
        );
    }
    assert_eq!(
        existing_ride_for(&engine.db, &ride(START + 61, "Ride")).unwrap(),
        Existing::Nothing
    );
    assert_eq!(
        existing_ride_for(&engine.db, &ride(START - 61, "Ride")).unwrap(),
        Existing::Nothing
    );
    assert_eq!(
        existing_ride_for(&engine.db, &ride(START, "VirtualRide")).unwrap(),
        Existing::Nothing,
        "another sport is another ride"
    );
}

#[test]
fn the_same_device_pair_is_the_row_whatever_the_start() {
    let engine = engine();
    body(&engine, "src-file-a", START, "Ride");
    body(&engine, "src-file-b", START + 10_000, "Ride");
    let held = on_device(ride(START, "Ride"), 3_912_345_678, 1_773_470_000);
    record(&engine.db, "src-file-a", &held).unwrap();

    let copy = on_device(ride(START + 5_000, "Run"), 3_912_345_678, 1_773_470_000);
    assert_eq!(
        existing_ride_for(&engine.db, &copy).unwrap(),
        Existing::One("src-file-a".into())
    );
    let other_creation = on_device(ride(START + 5_000, "Run"), 3_912_345_678, 1_773_470_001);
    assert_eq!(
        existing_ride_for(&engine.db, &other_creation).unwrap(),
        Existing::Nothing,
        "one half of the pair is not the pair"
    );
}

#[test]
fn a_file_without_a_device_match_falls_back_to_the_start() {
    let engine = engine();
    body(&engine, "src-file-a", START, "Ride");
    record(
        &engine.db,
        "src-file-a",
        &on_device(ride(START, "Ride"), 111, 222),
    )
    .unwrap();

    let re_encoded = on_device(ride(START + 3, "Ride"), 999, 888);
    assert_eq!(
        existing_ride_for(&engine.db, &re_encoded).unwrap(),
        Existing::One("src-file-a".into())
    );
}

#[test]
fn two_candidates_link_nothing() {
    let engine = engine();
    body(&engine, "i1", START, "Ride");
    body(&engine, "i2", START + 30, "Ride");

    assert_eq!(
        existing_ride_for(&engine.db, &ride(START + 10, "Ride")).unwrap(),
        Existing::Ambiguous(vec!["i1".into(), "i2".into()])
    );
}

#[test]
fn a_row_follows_its_body_and_goes_with_it() {
    let engine = engine();
    body(&engine, "i1", START, "Ride");
    engine
        .db
        .execute(
            "UPDATE activity_bodies SET date = ?1, raw = '{\"type\":\"Run\"}' WHERE activity_id = 'i1'",
            [START + 7_200],
        )
        .unwrap();

    assert_eq!(
        existing_ride_for(&engine.db, &ride(START, "Ride")).unwrap(),
        Existing::Nothing
    );
    assert_eq!(
        existing_ride_for(&engine.db, &ride(START + 7_200, "Run")).unwrap(),
        Existing::One("i1".into())
    );

    engine
        .db
        .execute("DELETE FROM activity_bodies WHERE activity_id = 'i1'", [])
        .unwrap();
    assert_eq!(
        existing_ride_for(&engine.db, &ride(START + 7_200, "Run")).unwrap(),
        Existing::Nothing
    );
}

#[test]
fn a_body_that_is_not_json_has_a_start_and_no_sport() {
    let engine = engine();
    engine
        .db
        .execute(
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES ('odd', ?1, 'not json')",
            [START],
        )
        .expect("the body stores");

    assert_eq!(
        existing_ride_for(&engine.db, &ride(START, "Ride")).unwrap(),
        Existing::Nothing
    );
}
