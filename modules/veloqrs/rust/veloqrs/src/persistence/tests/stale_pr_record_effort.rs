//! Scenario: the stale-PR sheet states the record effort's power, which the
//! traversal row stored when the record was matched.
//!
//! Expected behaviour: the read takes the traversal of the record's activity
//! at the record's time, carries no power for a ride without a power stream,
//! and finds nothing for a time no complete traversal holds.

use rusqlite::params;

use super::sections::ranking::pooled::record_effort;
use crate::persistence::PersistentEngine;

fn library() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().expect("engine");
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters)
             VALUES ('col', 'auto', 'Col', 'Ride', '[]', 2000.0)",
            [],
        )
        .unwrap();
    for (activity, direction, start, lap_time, distance, power) in [
        ("a1", "same", 0, 300.0, 2010.0, Some(251.5)),
        ("a1", "same", 900, 320.0, 2005.0, Some(240.0)),
        ("a2", "same", 0, 310.0, 1995.0, None),
        ("a3", "partial", 0, 290.0, 900.0, Some(400.0)),
    ] {
        engine
            .db
            .execute(
                "INSERT OR IGNORE INTO activities (id, sport_type, min_lat, max_lat, min_lng,
                     max_lng, start_date, name, distance_meters, duration_secs)
                 VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, 1700000000, ?1, 5000.0, 900)",
                params![activity],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, avg_power)
                 VALUES ('col', ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    activity,
                    direction,
                    start,
                    start + 100,
                    distance,
                    lap_time,
                    power
                ],
            )
            .unwrap();
    }
    engine
}

#[test]
fn the_record_traversal_carries_its_power_and_distance() {
    let engine = library();
    let effort = record_effort(&engine.db, "col", "a1", 300.0).expect("the record lap");
    assert_eq!(effort.avg_power, Some(251.5));
    assert_eq!(effort.distance_meters, 2010.0);
}

#[test]
fn a_ride_with_no_power_stream_carries_none() {
    let engine = library();
    let effort = record_effort(&engine.db, "col", "a2", 310.0).expect("the lap");
    assert_eq!(effort.avg_power, None);
}

#[test]
fn a_fragment_or_another_time_is_not_the_record() {
    let engine = library();
    assert!(record_effort(&engine.db, "col", "a3", 290.0).is_none());
    assert!(record_effort(&engine.db, "col", "a1", 299.0).is_none());
}
