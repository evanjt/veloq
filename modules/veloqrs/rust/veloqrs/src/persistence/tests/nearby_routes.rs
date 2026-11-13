//! Scenario: the record screen draws and lists the saved routes around the athlete's fix.
//!
//! Expected behaviour: the read returns the routes of the sport's family whose bounding box lies
//! within the radius, nearest first, each with its length, best time and line, capped at the
//! limit; an empty library returns nothing.

use std::hint::black_box;
use std::sync::Mutex;

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::persistence::nearby_routes::{NEARBY_LIMIT, pooled::recording_nearby_routes};

const FIX_LAT: f64 = 46.0;
const FIX_LNG: f64 = 7.0;
// One degree of latitude in metres, as the read measures it.
const METRES_PER_DEGREE: f64 = 111_320.0;

fn track(lat: f64, lng: f64) -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint {
            latitude: lat + i as f64 * 0.0001,
            longitude: lng,
            elevation: None,
        })
        .collect()
}

fn metrics(id: &str, sport: &str, distance: f64, moving_time: u32) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: id.to_string(),
        name: id.to_string(),
        date: 1_700_000_000,
        distance,
        moving_time,
        elapsed_time: moving_time,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: sport.to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

/// A route of two attempts whose line starts `north_metres` north of the fix.
fn add_route(
    engine: &mut PersistentEngine,
    id: &str,
    north_metres: f64,
    sport: &str,
    times: [u32; 2],
) {
    add_route_of(engine, id, north_metres, sport, &times);
}

/// A route with one attempt per entry of `times`, its line `north_metres` north of the fix.
fn add_route_of(
    engine: &mut PersistentEngine,
    id: &str,
    north_metres: f64,
    sport: &str,
    times: &[u32],
) {
    let lat = FIX_LAT + north_metres / METRES_PER_DEGREE;
    let members: Vec<String> = (0..times.len()).map(|i| format!("{id}-{i:03}")).collect();
    for member in &members {
        engine
            .add_activity(member.clone(), track(lat, FIX_LNG), sport.to_string())
            .expect("add activity");
    }
    engine
        .set_activity_metrics(
            members
                .iter()
                .zip(times)
                .map(|(member, &time)| metrics(member, sport, 5_000.0, time))
                .collect(),
        )
        .expect("metrics");
    let bounds = (lat, lat + 0.0019, FIX_LNG, FIX_LNG);
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count, bounds_min_lat, bounds_max_lat,
                                       bounds_min_lng, bounds_max_lng)
             VALUES (?1, ?2, ?3, ?4, 2, ?5, ?6, ?7, ?8)",
            params![
                id,
                members[0],
                serde_json::to_string(&members).unwrap(),
                sport,
                bounds.0,
                bounds.1,
                bounds.2,
                bounds.3
            ],
        )
        .expect("insert group");
}

fn read(engine: &PersistentEngine, sport: &str) -> Vec<crate::ffi_types::FfiNearbyRoute> {
    recording_nearby_routes(&engine.db, FIX_LAT, FIX_LNG, sport, None)
}

static STATEMENTS: Mutex<usize> = Mutex::new(0);

fn count(_sql: &str) {
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()) += 1;
}

fn statements_of_read(engine: &PersistentEngine) -> usize {
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()) = 0;
    crate::test_trace::trace_statements!(engine.db, count);
    black_box(read(engine, "Ride"));
    crate::test_trace::untrace(&engine.db);
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner())
}

/// A library of the nearest [`NEARBY_LIMIT`] routes, each with `attempts` attempts.
fn library(attempts: usize) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    for i in 0..NEARBY_LIMIT {
        add_route_of(
            &mut engine,
            &format!("r{i:02}"),
            i as f64 * 50.0,
            "Ride",
            &std::iter::repeat_n(1_800, attempts).collect::<Vec<_>>(),
        );
    }
    engine
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_library_has_no_nearby_routes() {
    let engine = PersistentEngine::in_memory().expect("engine");
    assert!(read(&engine, "Ride").is_empty());
}

#[test]
fn routes_within_the_radius_come_nearest_first_and_the_far_one_is_left_out() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_route(&mut engine, "mid", 800.0, "Ride", [1_800, 1_700]);
    add_route(&mut engine, "near", 100.0, "Ride", [2_000, 2_100]);
    add_route(&mut engine, "far", 5_000.0, "Ride", [1_000, 1_100]);

    let routes = read(&engine, "Ride");

    let ids: Vec<&str> = routes.iter().map(|r| r.group_id.as_str()).collect();
    assert_eq!(ids, ["near", "mid"]);
    assert!(routes[0].away_meters < routes[1].away_meters);
    assert!((routes[1].away_meters - 800.0).abs() < 5.0);
}

#[test]
fn a_route_carries_its_length_best_time_and_line() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_route(&mut engine, "loop", 0.0, "Ride", [1_800, 1_700]);

    let route = read(&engine, "Ride").remove(0);

    assert_eq!(route.distance_meters, 5_000.0);
    assert_eq!(route.best_time_seconds, Some(1_700));
    assert!(!route.encoded_coords.is_empty());
    // A fix inside the box is at distance zero.
    assert_eq!(route.away_meters, 0.0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_route_with_no_timed_attempt_has_no_best_time() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_route(&mut engine, "untimed", 0.0, "Ride", [0, 0]);

    let route = read(&engine, "Ride").remove(0);

    assert_eq!(route.best_time_seconds, None);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn only_routes_of_the_sports_family_are_returned() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_route(&mut engine, "ride", 0.0, "Ride", [1_800, 1_700]);
    add_route(&mut engine, "run", 100.0, "Run", [1_800, 1_700]);

    let rides = read(&engine, "GravelRide");
    let runs = read(&engine, "Run");

    assert_eq!(
        rides
            .iter()
            .map(|r| r.group_id.as_str())
            .collect::<Vec<_>>(),
        ["ride"]
    );
    assert_eq!(
        runs.iter().map(|r| r.group_id.as_str()).collect::<Vec<_>>(),
        ["run"]
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_read_stops_at_the_limit() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    for i in 0..NEARBY_LIMIT + 3 {
        add_route(
            &mut engine,
            &format!("r{i:02}"),
            i as f64 * 50.0,
            "Ride",
            [1_800, 1_700],
        );
    }

    let routes = read(&engine, "Ride");

    assert_eq!(routes.len(), NEARBY_LIMIT);
    assert_eq!(routes[0].group_id, "r00");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_followed_route_is_returned_beyond_the_radius_and_past_the_limit() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    for i in 0..NEARBY_LIMIT {
        add_route(
            &mut engine,
            &format!("r{i:02}"),
            i as f64 * 50.0,
            "Ride",
            [1_800, 1_700],
        );
    }
    add_route(&mut engine, "faraway", 9_000.0, "Ride", [1_500, 1_400]);

    let without = recording_nearby_routes(&engine.db, FIX_LAT, FIX_LNG, "Ride", None);
    let with = recording_nearby_routes(&engine.db, FIX_LAT, FIX_LNG, "Ride", Some("faraway"));

    assert!(without.iter().all(|r| r.group_id != "faraway"));
    assert_eq!(with.len(), NEARBY_LIMIT + 1);
    let followed = with.last().unwrap();
    assert_eq!(followed.group_id, "faraway");
    assert_eq!(followed.best_time_seconds, Some(1_400));
    assert!(followed.away_meters > 5_000.0);
    assert!(!followed.offered);
    assert!(with[..NEARBY_LIMIT].iter().all(|r| r.offered));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_followed_route_that_is_not_there_adds_nothing() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_route(&mut engine, "near", 0.0, "Ride", [1_800, 1_700]);

    let routes = recording_nearby_routes(&engine.db, FIX_LAT, FIX_LNG, "Ride", Some("gone"));

    assert_eq!(routes.len(), 1);
}

/// Each route group costs a fixed few statements, and the group listing costs a few more.
/// Anything that grows with the attempts of a route is far above this bound.
const GROUP_LEVEL_SLACK: usize = 10;

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_statements_of_a_read_do_not_grow_with_the_attempts_of_each_route() {
    let few = statements_of_read(&library(2));
    let many = statements_of_read(&library(50));

    assert!(
        many <= few + GROUP_LEVEL_SLACK,
        "a read over routes of 50 attempts issued {many} statements, against {few} over routes of 2"
    );
}
