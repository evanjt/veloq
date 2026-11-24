//! Scenario: the record screen's nearby read runs again each time the fix moves a grid
//! cell, over a library of routes and sections that each carry many attempts.
//!
//! Expected behaviour: nothing is asserted beyond the read returning a full page of places of
//! both kinds; the test prints the wall time of one read and the statements it issues, on a
//! file-backed library of ten routes and six sections of a hundred attempts each, 1,600
//! activities. Run in release, on a quiet machine, twice:
//!   cargo test --release -p veloqrs nearby_routes_cost -- --nocapture --ignored

use crate::poison::Recover;
use std::hint::black_box;
use std::sync::Mutex;
use std::time::Instant;

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::persistence::nearby_routes::pooled::nearby_places;
use crate::persistence::nearby_routes::{ALL_KINDS, LineAsk, NEARBY_LIMIT, NearbyKind};

const FIX_LAT: f64 = 46.0;
const FIX_LNG: f64 = 7.0;
const METRES_PER_DEGREE: f64 = 111_320.0;
const ROUTES: usize = 10;
const SECTIONS: usize = 6;
const ATTEMPTS: usize = 100;

static STATEMENTS: Mutex<usize> = Mutex::new(0);

fn count(_sql: &str) {
    *STATEMENTS.lock_recover() += 1;
}

fn track(lat: f64, lng: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: lat + i as f64 * 0.0001,
            longitude: lng,
            elevation: None,
        })
        .collect()
}

fn metrics(id: &str, moving_time: u32) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: id.to_string(),
        name: id.to_string(),
        date: 1_700_000_000,
        distance: 20_000.0,
        moving_time,
        elapsed_time: moving_time,
        elevation_gain: 100.0,
        avg_hr: Some(140),
        avg_power: Some(200),
        sport_type: "Ride".to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

/// The moving time of the `i`th attempt, spread over fifteen minutes.
fn lap_time(i: usize) -> u32 {
    3_000 + (i as u32 * 37) % 900
}

fn add_route(engine: &mut PersistentEngine, id: &str, north_metres: f64) {
    let lat = FIX_LAT + north_metres / METRES_PER_DEGREE;
    let members: Vec<String> = (0..ATTEMPTS).map(|i| format!("{id}-{i:03}")).collect();
    let batch = members
        .iter()
        .map(|m| (m.clone(), track(lat, FIX_LNG), "Ride".to_string()))
        .collect();
    engine.add_activities_batch(batch).expect("add activities");
    engine
        .set_activity_metrics(
            members
                .iter()
                .enumerate()
                .map(|(i, m)| metrics(m, lap_time(i)))
                .collect(),
        )
        .expect("metrics");
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count, bounds_min_lat, bounds_max_lat,
                                       bounds_min_lng, bounds_max_lng)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                members[0],
                serde_json::to_string(&members).unwrap(),
                "Ride",
                ATTEMPTS as i64,
                lat,
                lat + 0.02,
                FIX_LNG,
                FIX_LNG
            ],
        )
        .expect("insert group");
    for m in &members {
        engine
            .db
            .execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                 VALUES (?1, ?2, 0.95, 'same')",
                params![id, m],
            )
            .expect("insert match");
    }
}

/// A section of `ATTEMPTS` laps whose start lies `north_metres` north of the fix.
fn add_section(engine: &mut PersistentEngine, id: &str, north_metres: f64) {
    let lat = FIX_LAT + north_metres / METRES_PER_DEGREE;
    let line = track(lat, FIX_LNG);
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_blob,
                                   distance_meters, elevation_gain_m, visit_count,
                                   bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?1, 'auto', ?2, 'Ride', ?3, 2000.0, 40.0, ?4, ?5, ?6, ?7, ?7)",
            params![
                id,
                format!("{id} climb"),
                crate::persistence::codec::serialize_track_points(&line),
                ATTEMPTS as i64,
                lat,
                lat + 0.02,
                FIX_LNG
            ],
        )
        .expect("insert section");
    let laps: Vec<String> = (0..ATTEMPTS).map(|i| format!("{id}-{i:03}")).collect();
    engine
        .add_activities_batch(
            laps.iter()
                .map(|a| (a.clone(), line.clone(), "Ride".to_string()))
                .collect(),
        )
        .expect("add activities");
    engine
        .set_activity_metrics(
            laps.iter()
                .enumerate()
                .map(|(i, a)| metrics(a, lap_time(i)))
                .collect(),
        )
        .expect("metrics");
    for (i, activity) in laps.iter().enumerate() {
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, start_index, end_index,
                                                 distance_meters, lap_time)
                 VALUES (?1, ?2, 0, 199, 2000.0, ?3)",
                params![id, activity, lap_time(i)],
            )
            .expect("insert lap");
    }
}

#[test]
#[ignore = "a timing, run by hand in release"]
fn nearby_routes_cost() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    // Routes and sections alternate every 60 m, so the nearest page of the read holds both.
    for i in 0..ROUTES {
        add_route(&mut engine, &format!("r{i:02}"), i as f64 * 120.0);
    }
    for i in 0..SECTIONS {
        add_section(&mut engine, &format!("s{i:02}"), i as f64 * 120.0 + 60.0);
    }

    // Cold: the first read after the library is built.
    let start = Instant::now();
    let routes = black_box(nearby_places(
        &engine.db,
        FIX_LAT,
        FIX_LNG,
        "Ride",
        ALL_KINDS,
        None,
        LineAsk::default(),
    ));
    let cold = start.elapsed();
    assert_eq!(routes.len(), NEARBY_LIMIT);
    assert!(routes.iter().any(|p| p.kind == NearbyKind::Section));
    assert!(routes.iter().any(|p| p.kind == NearbyKind::Route));

    let mut warm = Vec::new();
    for _ in 0..20 {
        let start = Instant::now();
        black_box(nearby_places(
            &engine.db,
            FIX_LAT,
            FIX_LNG,
            "Ride",
            ALL_KINDS,
            None,
            LineAsk::default(),
        ));
        warm.push(start.elapsed());
    }
    warm.sort();

    *STATEMENTS.lock_recover() = 0;
    crate::test_trace::trace_statements!(engine.db, count);
    black_box(nearby_places(
        &engine.db,
        FIX_LAT,
        FIX_LNG,
        "Ride",
        ALL_KINDS,
        None,
        LineAsk::default(),
    ));
    crate::test_trace::untrace(&mut engine.db);
    let statements = *STATEMENTS.lock_recover();

    println!(
        "nearby_routes_cost: {ROUTES} routes and {SECTIONS} sections x {ATTEMPTS} attempts, file-backed\n  cold {:.2} ms\n  warm median {:.2} ms, min {:.2} ms, max {:.2} ms (20 reads)\n  statements per read {statements}",
        cold.as_secs_f64() * 1e3,
        warm[warm.len() / 2].as_secs_f64() * 1e3,
        warm[0].as_secs_f64() * 1e3,
        warm[warm.len() - 1].as_secs_f64() * 1e3,
    );
}
