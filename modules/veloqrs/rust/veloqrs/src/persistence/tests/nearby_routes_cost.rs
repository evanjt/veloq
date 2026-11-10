//! Scenario: the record screen's nearby-routes read runs again each time the fix moves a grid
//! cell, over a library whose routes each carry many attempts.
//!
//! Expected behaviour: nothing is asserted; the test prints the wall time of one read and the
//! statements it issues, on a file-backed library of ten routes of a hundred attempts each.
//! Run in release, on a quiet machine, twice:
//!   cargo test --release -p veloqrs nearby_routes_cost -- --nocapture --ignored

use std::hint::black_box;
use std::sync::Mutex;
use std::time::Instant;

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::persistence::nearby_routes::pooled::recording_nearby_routes;

const FIX_LAT: f64 = 46.0;
const FIX_LNG: f64 = 7.0;
const METRES_PER_DEGREE: f64 = 111_320.0;
const ROUTES: usize = 10;
const ATTEMPTS: usize = 100;

static STATEMENTS: Mutex<usize> = Mutex::new(0);

fn count(_sql: &str) {
    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()) += 1;
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
                .map(|(i, m)| metrics(m, 3_000 + (i as u32 * 37) % 900))
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

#[test]
#[ignore = "a timing, run by hand in release"]
fn nearby_routes_cost() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    for i in 0..ROUTES {
        add_route(&mut engine, &format!("r{i:02}"), i as f64 * 120.0);
    }

    // Cold: the first read after the library is built.
    let start = Instant::now();
    let routes = black_box(recording_nearby_routes(
        &engine.db, FIX_LAT, FIX_LNG, "Ride", None,
    ));
    let cold = start.elapsed();
    assert_eq!(routes.len(), ROUTES);

    let mut warm = Vec::new();
    for _ in 0..20 {
        let start = Instant::now();
        black_box(recording_nearby_routes(
            &engine.db, FIX_LAT, FIX_LNG, "Ride", None,
        ));
        warm.push(start.elapsed());
    }
    warm.sort();

    *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()) = 0;
    crate::test_trace::trace_statements!(engine.db, count);
    black_box(recording_nearby_routes(
        &engine.db, FIX_LAT, FIX_LNG, "Ride", None,
    ));
    crate::test_trace::untrace(&engine.db);
    let statements = *STATEMENTS.lock().unwrap_or_else(|e| e.into_inner());

    println!(
        "nearby_routes_cost: {ROUTES} routes x {ATTEMPTS} attempts, file-backed\n  cold {:.2} ms\n  warm median {:.2} ms, min {:.2} ms, max {:.2} ms (20 reads)\n  statements per read {statements}",
        cold.as_secs_f64() * 1e3,
        warm[warm.len() / 2].as_secs_f64() * 1e3,
        warm[0].as_secs_f64() * 1e3,
        warm[warm.len() - 1].as_secs_f64() * 1e3,
    );
}
