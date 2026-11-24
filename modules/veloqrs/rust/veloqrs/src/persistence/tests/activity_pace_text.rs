//! Scenario: the activity screen prints a run's section laps, its history
//! sparkline and its summary speeds as pace, and a ride's as speed.
//!
//! Expected behaviour: a pace sport's encounter carries the lap pace and one
//! pace text per history entry in both unit systems, and its summary carries
//! the shown average and the maximum the same way; a ride carries none, so the
//! screen prints its speed.

use std::collections::BTreeMap;

use rusqlite::params;

use super::activity_summary;
use crate::PersistentEngine;
use crate::persistence::fitness::derivations::pooled::activity_section_encounters;

fn seed(engine: &PersistentEngine, sport: &str) {
    let polyline =
        "[{\"latitude\":46.2,\"longitude\":7.3},{\"latitude\":46.21,\"longitude\":7.31}]";
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('sec', 'auto', 'Lantern loop', ?, ?, 3000.0, 0, 1, '2026-01-01T00:00:00Z',
                46.2, 46.21, 7.3, 7.31)",
            params![sport, polyline],
        )
        .unwrap();
    for (id, date, lap_time) in [
        ("old", 1_735_689_600_i64, 1000.0),
        ("new", 1_735_776_000, 600.0),
    ] {
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, start_date, min_lat, max_lat, min_lng, max_lng)
                 VALUES (?, ?, ?, 46.2, 46.21, 7.3, 7.31)",
                params![id, sport, date],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics (activity_id, name, date, distance,
                    moving_time, elapsed_time, elevation_gain, sport_type)
                 VALUES (?, ?, ?, 3000.0, 600, 600, 10.0, ?)",
                params![id, id, date, sport],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                    start_index, end_index, distance_meters, lap_time, lap_pace)
                 VALUES ('sec', ?, 'same', 0, 100, 3000.0, ?, 3000.0 / ?)",
                params![id, lap_time, lap_time],
            )
            .unwrap();
    }
}

fn encounter(sport: &str) -> crate::ffi_types::FfiSectionEncounter {
    let engine = PersistentEngine::in_memory().expect("engine");
    seed(&engine, sport);
    let mut found = activity_section_encounters(&engine.db, "new", &BTreeMap::new());
    assert_eq!(found.len(), 1, "one section encountered");
    found.remove(0)
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_run_encounter_carries_its_lap_and_history_pace_text() {
    let run = encounter("Run");

    assert_eq!(run.lap_pace_metric_text.as_deref(), Some("3:20"));
    assert_eq!(run.lap_pace_imperial_text.as_deref(), Some("5:22"));
    assert_eq!(run.history_pace_metric_texts, ["5:33", "3:20"]);
    assert_eq!(run.history_pace_imperial_texts, ["8:56", "5:22"]);
    assert_eq!(run.history_times, [1000.0, 600.0]);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_ride_encounter_carries_no_pace_text() {
    let ride = encounter("Ride");

    assert_eq!(ride.lap_pace_metric_text, None);
    assert_eq!(ride.lap_pace_imperial_text, None);
    assert!(ride.history_pace_metric_texts.is_empty());
    assert!(ride.history_pace_imperial_texts.is_empty());
}

const BODY: &str = r#"{"moving_time": 1500, "elapsed_time": 1800,
    "average_speed": 2.5, "max_speed": 4.0}"#;

#[test]
fn the_shown_average_is_distance_over_moving_time_and_reads_as_pace_on_foot() {
    let run = activity_summary(Some(BODY), "Run", 5000.0, 1700);

    assert_eq!(run.shown_average_speed, Some(5000.0 / 1500.0));
    assert_eq!(run.shown_average_pace_metric_text.as_deref(), Some("5:00"));
    assert_eq!(
        run.shown_average_pace_imperial_text.as_deref(),
        Some("8:03")
    );
    assert_eq!(run.max_pace_metric_text.as_deref(), Some("4:10"));
    assert_eq!(run.max_pace_imperial_text.as_deref(), Some("6:42"));
}

#[test]
fn the_stored_average_stands_only_without_a_distance_over_time() {
    let run = activity_summary(Some(r#"{"average_speed": 2.5}"#), "Run", 0.0, 0);

    assert_eq!(run.shown_average_speed, Some(2.5));
    assert_eq!(run.shown_average_pace_metric_text.as_deref(), Some("6:40"));
    assert_eq!(run.max_pace_metric_text, None, "no maximum was stored");

    let none = activity_summary(None, "Run", 5000.0, 0);
    assert_eq!(none.shown_average_speed, None);
    assert_eq!(none.shown_average_pace_metric_text, None);
}

#[test]
fn a_ride_summary_carries_speeds_and_no_pace_text() {
    let ride = activity_summary(Some(BODY), "Ride", 5000.0, 1700);

    assert_eq!(ride.shown_average_speed, Some(5000.0 / 1500.0));
    assert_eq!(ride.shown_average_pace_metric_text, None);
    assert_eq!(ride.max_pace_metric_text, None);
    assert_eq!(ride.max_speed, Some(4.0));
}
