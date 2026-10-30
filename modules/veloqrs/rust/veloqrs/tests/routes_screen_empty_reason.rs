//! An empty routes or sections list says why it is empty.
//!
//! Scenario: libraries whose catalogues hold nothing for different reasons:
//! only indoor sessions, outdoor rides that never repeat, rides no detect has
//! seen yet, and rides whose detect waits on elevation.
//!
//! Expected behaviour: the routes screen read names the reason for each list,
//! with the repeat threshold when detection found nothing, and names none once
//! the catalogue holds something to show.
//!
//! Run: `cargo test --test app -p veloqrs -- routes_screen_empty_reason::`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::ELEVATION_STATE_FETCHED;
use veloqrs::{
    ActivityMetrics, FfiCatalogueEmptyReason, FfiDetectionHold, FfiRoutesScreenQuery,
    PersistentEngine,
};

const NOW: i64 = 1_750_000_000;
const DAY: i64 = 86_400;

/// A line of about 1.3 km, longer than the shortest route, in its own place so
/// no two seeds share a path.
fn track(seed: usize) -> Vec<GpsPoint> {
    let base_lat = 46.0 + seed as f64 * 0.05;
    (0..40)
        .map(|i| GpsPoint {
            latitude: base_lat + i as f64 * 0.0003,
            longitude: 7.0,
            elevation: Some(500.0 + i as f64),
        })
        .collect()
}

fn metric(id: &str, day: i64, sport: &str) -> ActivityMetrics {
    ActivityMetrics {
        activity_id: id.to_string(),
        name: id.to_string(),
        date: NOW - day * DAY,
        distance: 20_000.0,
        moving_time: 3_600,
        elapsed_time: 3_700,
        elevation_gain: 0.0,
        avg_hr: Some(140),
        avg_power: Some(200),
        sport_type: sport.to_string(),
        training_load: Some(60.0),
        ftp: Some(250),
        power_zone_times: None,
        hr_zone_times: None,
    }
}

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("engine")
}

/// Outdoor rides with their tracks stored, their elevation already answered so
/// the backfill owes nothing.
fn add_rides(engine: &mut PersistentEngine, rides: &[(&str, usize)]) {
    for (i, (id, seed)) in rides.iter().enumerate() {
        engine
            .add_activity(id.to_string(), track(*seed), "Ride".into())
            .expect("add ride");
        engine
            .set_activity_metrics(vec![metric(id, i as i64, "Ride")])
            .expect("ride metrics");
    }
    let answered: Vec<(String, u8)> = rides
        .iter()
        .map(|(id, _)| (id.to_string(), ELEVATION_STATE_FETCHED))
        .collect();
    engine
        .record_elevation_state(&answered)
        .expect("record elevation");
}

fn mark_detected(engine: &mut PersistentEngine, ids: &[&str]) {
    let ids: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
    engine
        .save_processed_activity_ids(&ids)
        .expect("mark detected");
}

fn query() -> FfiRoutesScreenQuery {
    FfiRoutesScreenQuery {
        min_group_activity_count: 2,
        ..FfiRoutesScreenQuery::default()
    }
}

#[test]
fn a_library_of_indoor_sessions_reads_as_having_no_gps_activities() {
    let _serial = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .set_activity_metrics(vec![
            metric("trainer-1", 1, "VirtualRide"),
            metric("trainer-2", 2, "VirtualRide"),
            metric("pool-1", 3, "Swim"),
        ])
        .expect("indoor metrics");

    let screen = engine.get_routes_screen_data(query());

    assert_eq!(
        screen.group_empty_reason,
        Some(FfiCatalogueEmptyReason::NoGpsActivities)
    );
    assert_eq!(
        screen.section_empty_reason,
        Some(FfiCatalogueEmptyReason::NoGpsActivities)
    );
}

#[test]
fn rides_that_never_repeat_read_as_detection_done_with_none_found() {
    let _serial = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    add_rides(&mut engine, &[("ride-a", 0), ("ride-b", 7), ("ride-c", 14)]);
    mark_detected(&mut engine, &["ride-a", "ride-b", "ride-c"]);
    let _ = engine.get_groups();

    let screen = engine.get_routes_screen_data(query());

    assert_eq!(
        screen.group_empty_reason,
        Some(FfiCatalogueEmptyReason::NoneFound { min_activities: 2 })
    );
    assert_eq!(
        screen.section_empty_reason,
        Some(FfiCatalogueEmptyReason::NoneFound {
            min_activities: engine.section_config_min_activities()
        })
    );
}

#[test]
fn rides_no_detect_has_seen_read_as_not_yet_run_with_the_count_waiting() {
    let _serial = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    add_rides(&mut engine, &[("ride-a", 0), ("ride-b", 7), ("ride-c", 14)]);
    mark_detected(&mut engine, &["ride-a"]);

    let screen = engine.get_routes_screen_data(query());

    assert_eq!(
        screen.group_empty_reason,
        Some(FfiCatalogueEmptyReason::NotYetRun { awaiting: 2 })
    );
    assert_eq!(
        screen.section_empty_reason,
        Some(FfiCatalogueEmptyReason::NotYetRun { awaiting: 2 })
    );
}

#[test]
fn rides_waiting_on_elevation_read_as_held_with_the_tracks_owed_while_the_cut_is_owed() {
    let _serial = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    add_rides(&mut engine, &[("ride-a", 0), ("ride-b", 7)]);
    // A third ride whose elevation nobody has asked about yet.
    engine
        .add_activity("ride-c".into(), track(14), "Ride".into())
        .expect("add ride");

    engine
        .set_setting("__detector_cutover", "unified-1-inflight")
        .expect("token");

    let screen = engine.get_routes_screen_data(query());

    let held = Some(FfiCatalogueEmptyReason::Held {
        hold: FfiDetectionHold::ElevationWaiting { remaining: 1 },
    });
    assert_eq!(screen.group_empty_reason, held);
    assert_eq!(screen.section_empty_reason, held);
}

#[test]
fn owed_elevation_after_the_cut_is_progress_and_not_a_hold() {
    let _serial = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    add_rides(&mut engine, &[("ride-a", 0), ("ride-b", 7)]);
    engine
        .add_activity("ride-c".into(), track(14), "Ride".into())
        .expect("add ride");
    engine
        .set_setting("__detector_cutover", "unified-1")
        .expect("token");

    let screen = engine.get_routes_screen_data(query());

    assert_eq!(
        screen.section_empty_reason,
        Some(FfiCatalogueEmptyReason::NotYetRun { awaiting: 3 })
    );
}

#[test]
fn elevation_owed_after_every_ride_was_detected_does_not_hold_an_empty_list() {
    let _serial = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .add_activity("ride-a".into(), track(0), "Ride".into())
        .expect("add ride");
    mark_detected(&mut engine, &["ride-a"]);

    let screen = engine.get_routes_screen_data(query());

    assert_eq!(
        screen.group_empty_reason,
        Some(FfiCatalogueEmptyReason::NoneFound { min_activities: 2 })
    );
}

#[test]
fn a_repeated_route_leaves_the_routes_list_with_no_reason() {
    let _serial = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    add_rides(&mut engine, &[("ride-a", 0), ("ride-b", 0), ("ride-c", 14)]);
    mark_detected(&mut engine, &["ride-a", "ride-b", "ride-c"]);
    let _ = engine.get_groups();

    let screen = engine.get_routes_screen_data(query());

    assert!(
        screen.filtered_group_count > 0,
        "the two rides on one path form a route"
    );
    assert_eq!(screen.group_empty_reason, None);
}

#[test]
fn a_search_that_matches_nothing_is_not_an_empty_catalogue() {
    let _serial = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    add_rides(&mut engine, &[("ride-a", 0), ("ride-b", 0)]);
    mark_detected(&mut engine, &["ride-a", "ride-b"]);
    let _ = engine.get_groups();

    let screen = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        group_search: "no such route".into(),
        group_sport_type: Some("Run".into()),
        ..query()
    });

    assert_eq!(screen.filtered_group_count, 0);
    assert_eq!(screen.group_empty_reason, None);
}
