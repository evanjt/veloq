//! Scenario: the record screen and the watch list the saved routes and sections around the
//! athlete's fix.
//!
//! Expected behaviour: the read returns the routes and sections of the sport's family whose start
//! lies within the radius, nearest start first, each with its length, best time and line, capped
//! at the limit; the followed route comes back wherever it lies; an empty library returns
//! nothing.

use std::hint::black_box;
use std::sync::Mutex;

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::persistence::nearby_routes::{
    ALL_KINDS, LineAsk, NEARBY_LIMIT, NearbyKind, NearbyPlace, pooled::nearby_places,
};

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

fn read(engine: &PersistentEngine, sport: &str) -> Vec<NearbyPlace> {
    nearby_places(
        &engine.db,
        FIX_LAT,
        FIX_LNG,
        sport,
        ALL_KINDS,
        None,
        LineAsk::default(),
    )
}

static STATEMENTS: Mutex<usize> = Mutex::new(0);

fn count(_sql: &str) {
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()) += 1;
}

fn statements_of_read(engine: &mut PersistentEngine) -> usize {
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()) = 0;
    crate::test_trace::trace_statements!(engine.db, count);
    black_box(read(engine, "Ride"));
    crate::test_trace::untrace(&mut engine.db);
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

    let ids: Vec<&str> = routes.iter().map(|r| r.id.as_str()).collect();
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
        rides.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        ["ride"]
    );
    assert_eq!(
        runs.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
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
    assert_eq!(routes[0].id, "r00");
}

#[test]
fn the_limit_counts_only_the_kinds_asked_for() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    for i in 0..NEARBY_LIMIT {
        add_route(
            &mut engine,
            &format!("r{i:02}"),
            800.0 + i as f64 * 50.0,
            "Ride",
            [1_800, 1_700],
        );
    }
    for (i, north) in [100.0, 200.0, 300.0].into_iter().enumerate() {
        add_section(
            &mut engine,
            &format!("climb{i}"),
            north,
            &[(80.0, 1_695_000_000)],
        );
    }

    let routes = nearby_places(
        &engine.db,
        FIX_LAT,
        FIX_LNG,
        "Ride",
        &[NearbyKind::Route],
        None,
        LineAsk::default(),
    );
    assert_eq!(routes.len(), NEARBY_LIMIT);
    assert!(routes.iter().all(|r| r.kind == NearbyKind::Route));
    assert_eq!(routes[0].id, "r00");

    let both = read(&engine, "Ride");
    assert_eq!(both.len(), NEARBY_LIMIT);
    assert_eq!(
        both.iter()
            .filter(|p| p.kind == NearbyKind::Section)
            .count(),
        3
    );
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

    let without = nearby_places(
        &engine.db,
        FIX_LAT,
        FIX_LNG,
        "Ride",
        ALL_KINDS,
        None,
        LineAsk::default(),
    );
    let with = nearby_places(
        &engine.db,
        FIX_LAT,
        FIX_LNG,
        "Ride",
        ALL_KINDS,
        Some("faraway"),
        LineAsk::default(),
    );

    assert!(without.iter().all(|r| r.id != "faraway"));
    assert_eq!(with.len(), NEARBY_LIMIT + 1);
    let followed = with.last().unwrap();
    assert_eq!(followed.id, "faraway");
    assert_eq!(followed.best_time_seconds, Some(1_400));
    assert!(followed.away_meters > 5_000.0);
    assert!(!followed.offered);
    assert!(with[..NEARBY_LIMIT].iter().all(|r| r.offered));
}

#[test]
fn a_section_that_starts_nearer_than_a_route_comes_first_and_both_are_offered() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    // The box of this route reaches the fix, its start is 1.5 km south of it.
    add_long_route(&mut engine, "long", -1_500.0, 100.0);
    add_section(&mut engine, "climb", 300.0, &[(80.0, 1_695_000_000)]);

    let places = read(&engine, "Ride");

    let ids: Vec<&str> = places.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["climb", "long"]);
    assert!(places.iter().all(|p| p.offered));
}

#[test]
fn the_followed_route_is_not_offered_when_it_starts_beyond_the_radius_by_its_start() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    // The box reaches the fix, the start is 5 km south of it.
    add_long_route(&mut engine, "long", -5_000.0, 100.0);

    assert!(read(&engine, "Ride").is_empty());
    let followed = nearby_places(
        &engine.db,
        FIX_LAT,
        FIX_LNG,
        "Ride",
        ALL_KINDS,
        Some("long"),
        LineAsk::default(),
    );
    assert_eq!(followed.len(), 1);
    assert_eq!(followed[0].id, "long");
    assert!(!followed[0].offered);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_followed_route_that_is_not_there_adds_nothing() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_route(&mut engine, "near", 0.0, "Ride", [1_800, 1_700]);

    let routes = nearby_places(
        &engine.db,
        FIX_LAT,
        FIX_LNG,
        "Ride",
        ALL_KINDS,
        Some("gone"),
        LineAsk::default(),
    );

    assert_eq!(routes.len(), 1);
}

/// Each route group costs a fixed few statements, and the group listing costs a few more.
/// Anything that grows with the attempts of a route is far above this bound.
const GROUP_LEVEL_SLACK: usize = 10;

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_statements_of_a_read_do_not_grow_with_the_attempts_of_each_route() {
    let few = statements_of_read(&mut library(2));
    let many = statements_of_read(&mut library(50));

    assert!(
        many <= few + GROUP_LEVEL_SLACK,
        "a read over routes of 50 attempts issued {many} statements, against {few} over routes of 2"
    );
}

/// A library of the nearest [`NEARBY_LIMIT`] sections, each with `passes` passes.
fn section_library(passes: usize) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    for i in 0..NEARBY_LIMIT {
        let laps = vec![(1_800.0, 1_700_000_000i64); passes];
        add_section(&mut engine, &format!("s{i:02}"), i as f64 * 50.0, &laps);
    }
    engine
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_statements_of_a_read_do_not_grow_with_the_passes_of_each_section() {
    let few = statements_of_read(&mut section_library(2));
    let many = statements_of_read(&mut section_library(50));

    assert!(
        many <= few + GROUP_LEVEL_SLACK,
        "a read over sections of 50 passes issued {many} statements, against {few} over sections of 2"
    );
}

/// A route whose line runs from `start_north` to `end_north` metres north of the fix, so its box
/// reaches the fix while its start does not.
fn add_long_route(engine: &mut PersistentEngine, id: &str, start_north: f64, end_north: f64) {
    let members = [format!("{id}-000"), format!("{id}-001")];
    let lat0 = FIX_LAT + start_north / METRES_PER_DEGREE;
    let lat1 = FIX_LAT + end_north / METRES_PER_DEGREE;
    let line: Vec<GpsPoint> = (0..=20)
        .map(|i| GpsPoint {
            latitude: lat0 + (lat1 - lat0) * f64::from(i) / 20.0,
            longitude: FIX_LNG,
            elevation: Some(400.0 + f64::from(i)),
        })
        .collect();
    for (member, time) in members.iter().zip([1_900u32, 1_700]) {
        engine
            .add_activity(member.clone(), line.clone(), "Ride".to_string())
            .expect("add activity");
        let mut m = metrics(member, "Ride", 5_000.0, time);
        m.date = if time == 1_900 {
            1_700_000_000
        } else {
            1_700_500_000
        };
        m.elevation_gain = 20.0;
        engine.set_activity_metrics(vec![m]).expect("metrics");
    }
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count, bounds_min_lat, bounds_max_lat,
                                       bounds_min_lng, bounds_max_lng)
             VALUES (?1, ?2, ?3, 'Ride', 2, ?4, ?5, ?6, ?6)",
            params![
                id,
                members[0],
                serde_json::to_string(&members).unwrap(),
                lat0.min(lat1),
                lat0.max(lat1),
                FIX_LNG
            ],
        )
        .expect("insert group");
}

/// A section whose line starts `north_metres` north of the fix, passed once per `laps` entry
/// as (seconds, date).
fn add_section(engine: &mut PersistentEngine, id: &str, north_metres: f64, laps: &[(f64, i64)]) {
    let lat = FIX_LAT + north_metres / METRES_PER_DEGREE;
    let line: Vec<GpsPoint> = (0..20)
        .map(|i| GpsPoint {
            latitude: lat + f64::from(i) * 0.0001,
            longitude: FIX_LNG,
            elevation: Some(500.0 + f64::from(i)),
        })
        .collect();
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_blob,
                                   distance_meters, elevation_gain_m, visit_count,
                                   bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?1, 'auto', ?2, 'Ride', ?3, 210.0, 19.0, ?4, ?5, ?6, ?7, ?7)",
            params![
                id,
                format!("{id} climb"),
                crate::persistence::codec::serialize_track_points(&line),
                laps.len() as i64,
                lat,
                lat + 0.0019,
                FIX_LNG
            ],
        )
        .expect("insert section");
    for (i, &(seconds, date)) in laps.iter().enumerate() {
        let activity = format!("{id}-act-{i}");
        engine
            .add_activity(activity.clone(), line.clone(), "Ride".to_string())
            .expect("add activity");
        let mut m = metrics(&activity, "Ride", 10_000.0, 3_000);
        m.date = date;
        engine.set_activity_metrics(vec![m]).expect("metrics");
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, start_index, end_index,
                                                 distance_meters, lap_time)
                 VALUES (?1, ?2, 0, 19, 210.0, ?3)",
                params![id, activity, seconds],
            )
            .expect("insert lap");
    }
}

#[test]
fn places_come_nearest_start_first_and_carry_best_and_last() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    // The box of this route reaches the fix, its start is 1.5 km south of it.
    add_long_route(&mut engine, "long", -1_500.0, 100.0);
    add_section(
        &mut engine,
        "climb",
        300.0,
        &[
            (95.0, 1_690_000_000),
            (80.0, 1_695_000_000),
            (90.0, 1_699_000_000),
        ],
    );

    let places = read(&engine, "Ride");

    let ids: Vec<(&NearbyKind, &str)> = places.iter().map(|p| (&p.kind, p.id.as_str())).collect();
    assert_eq!(
        ids,
        [
            (&NearbyKind::Section, "climb"),
            (&NearbyKind::Route, "long")
        ]
    );
    assert!((places[0].away_meters - 300.0).abs() < 5.0);
    assert!((places[1].away_meters - 1_500.0).abs() < 5.0);

    let section = &places[0];
    assert_eq!(section.name, "climb climb");
    assert_eq!(section.pass_count, 3);
    assert_eq!(section.best_time_seconds, Some(80));
    assert_eq!(section.best_date, Some(crate::WholeNumber(1_695_000_000)));
    assert_eq!(section.last_time_seconds, Some(90));
    assert_eq!(section.last_date, Some(crate::WholeNumber(1_699_000_000)));
    assert_eq!(section.elevation_gain_meters, Some(19.0));

    let route = &places[1];
    assert_eq!(route.pass_count, 2);
    assert_eq!(route.best_time_seconds, Some(1_700));
    assert_eq!(route.last_time_seconds, Some(1_700));
    assert_eq!(route.last_date, Some(crate::WholeNumber(1_700_500_000)));
    assert_eq!(route.elevation_gain_meters, Some(20.0));
}

#[test]
fn a_place_line_is_capped_and_keeps_its_elevation() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_section(&mut engine, "climb", 0.0, &[(80.0, 1_695_000_000)]);

    let place = read(&engine, "Ride").remove(0);
    let line = crate::persistence::codec::decode_polyline(&place.encoded_coords).expect("line");

    assert!(line.len() >= 2);
    assert!(line.iter().all(|p| p.elevation.is_some()));
    assert_eq!(line.first().unwrap().elevation, Some(500.0));
    assert_eq!(line.last().unwrap().elevation, Some(519.0));
}

#[test]
fn a_section_beyond_the_radius_by_its_start_is_left_out() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_section(&mut engine, "far", 5_000.0, &[(80.0, 1_695_000_000)]);

    assert!(read(&engine, "Ride").is_empty());
}

#[test]
fn the_watch_reply_lists_the_section_first_with_its_best_and_last_time() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_long_route(&mut engine, "long", -1_500.0, 100.0);
    add_section(
        &mut engine,
        "climb",
        300.0,
        &[(80.0, 1_695_000_000), (90.0, 1_699_000_000)],
    );

    let text = crate::persistence::nearby_routes::pooled::watch_nearby_json(
        &engine.db, FIX_LAT, FIX_LNG, "Ride",
    );

    let reply: serde_json::Value = serde_json::from_str(&text).expect("reply is JSON");
    assert!(reply["error"].is_null(), "{text}");
    let places = reply["result"]["places"].as_array().expect("places");
    assert_eq!(places[0]["kind"], "section");
    assert_eq!(places[0]["id"], "climb");
    assert_eq!(places[0]["bestTimeSeconds"], 80);
    assert_eq!(places[0]["lastTimeSeconds"], 90);
    assert_eq!(places[1]["id"], "long");
}

#[test]
fn the_watch_reply_over_an_empty_library_is_an_empty_list() {
    let engine = PersistentEngine::in_memory().expect("engine");

    let text = crate::persistence::nearby_routes::pooled::watch_nearby_json(
        &engine.db, FIX_LAT, FIX_LNG, "Ride",
    );

    let reply: serde_json::Value = serde_json::from_str(&text).expect("reply is JSON");
    assert_eq!(reply["result"]["places"], serde_json::json!([]));
}

/// A library of 1,600 activities, ten routes of 160 attempts: the read's work is the statements
/// it issues, and it must stay at the count a library of two attempts per route costs.
#[test]
fn the_watch_read_over_sixteen_hundred_activities_issues_no_more_statements() {
    let few = statements_of_read(&mut library(2));
    let many = statements_of_read(&mut library(160));

    assert!(
        many <= few + GROUP_LEVEL_SLACK,
        "a read over 1,600 activities issued {many} statements, against {few} over 20"
    );
}

/// Scenario: a watch asks for each nearby line capped and packed.
///
/// Expected behaviour: with a cap and `packed`, each place carries `packed_line` decoding to at
/// most the cap and an empty `encoded_coords`; with the default ask the polyline is carried as
/// before and nothing is packed.
#[test]
fn a_nearby_line_is_capped_and_packed_when_asked() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_route(&mut engine, "near", 100.0, "Ride", [1000, 1100]);

    let asked = LineAsk {
        max_points: 5,
        packed: true,
    };
    let places = nearby_places(&engine.db, FIX_LAT, FIX_LNG, "Ride", ALL_KINDS, None, asked);
    assert_eq!(places.len(), 1);
    assert!(places[0].encoded_coords.is_empty());
    let line = crate::persistence::codec::unpack_line(places[0].packed_line.as_ref().unwrap())
        .expect("a packed line");
    assert!(!line.is_empty() && line.len() <= 5, "{}", line.len());

    let plain = read(&engine, "Ride");
    assert!(plain[0].packed_line.is_none());
    assert!(!plain[0].encoded_coords.is_empty());
}
