//! Writes the small library a released build leaves on disk, for the upgrade
//! fixture of that release.
//!
//! Run it from a checkout of the release tag, so the schema, the hooks and the
//! stored encodings are the ones that shipped, then dump the database as that
//! release's fixture and add the version `.dump` leaves out:
//!
//!   cargo run -p veloqrs --example released_library -- /tmp/library.db
//!   sqlite3 /tmp/library.db 'PRAGMA wal_checkpoint(TRUNCATE)'
//!   { sqlite3 /tmp/library.db .dump; echo 'PRAGMA user_version=N;'; } \
//!     > tests/fixtures/vN_library.sql
//!
//! Then add the release to `RELEASES` in `tests/migration_support/mod.rs`.
//! The library holds what an athlete loses on a bad upgrade: activities with
//! tracks and metrics, a renamed auto section with a pinned version, a named
//! custom section, a custom section retired into the auto one with its
//! history, a named route group with its matches, and settings. Every id and
//! name is invented, since the fixture is committed to a public repository.

use rusqlite::{Connection, params};
use veloqrs::sections::CreateSectionParams;
use veloqrs::{FfiActivityMetrics, GpsPoint, PersistentEngine};

/// A gently climbing line of `count` points, one every ~8 m.
fn line(lat: f64, lng: f64, count: usize, elevation: f64) -> Vec<GpsPoint> {
    (0..count)
        .map(|i| {
            let mut point = GpsPoint::new(lat + i as f64 * 0.00002, lng + i as f64 * 0.0001);
            point.elevation = Some(elevation + i as f64 * 0.5);
            point
        })
        .collect()
}

fn metrics(id: &str, name: &str, date: i64, sport: &str) -> FfiActivityMetrics {
    FfiActivityMetrics {
        activity_id: id.to_string(),
        name: name.to_string(),
        date: date as f64,
        distance: 1200.0,
        moving_time: 240,
        elapsed_time: 260,
        elevation_gain: 30.0,
        avg_hr: Some(142),
        avg_power: Some(210),
        sport_type: sport.to_string(),
        training_load: Some(18.0),
        ftp: Some(250),
    }
}

fn section(
    sport: &str,
    polyline: Vec<GpsPoint>,
    distance_meters: f64,
    name: Option<&str>,
    source: Option<(&str, u32, u32)>,
) -> CreateSectionParams {
    CreateSectionParams {
        sport_type: sport.to_string(),
        polyline,
        distance_meters,
        name: name.map(str::to_string),
        source_activity_id: source.map(|(id, _, _)| id.to_string()),
        start_index: source.map(|(_, start, _)| start),
        end_index: source.map(|(_, _, end)| end),
    }
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: released_library <output.db>");
    if std::path::Path::new(&path).exists() {
        panic!("{path} exists; the library is written into a new file");
    }

    let mut engine = PersistentEngine::new(&path).expect("open engine");
    let ride = line(46.2, 7.35, 120, 500.0);
    let run = line(46.25, 7.40, 80, 600.0);
    for id in ["lib-ride-1", "lib-ride-2", "lib-ride-3"] {
        engine
            .add_activity(id.to_string(), ride.clone(), "Ride".to_string())
            .expect("add ride");
    }
    engine
        .add_activity("lib-run-1".to_string(), run.clone(), "Run".to_string())
        .expect("add run");
    engine
        .set_activity_metrics_extended(vec![
            metrics("lib-ride-1", "Morning loop", 1_761_000_000, "Ride"),
            metrics("lib-ride-2", "Lunch loop", 1_761_086_400, "Ride"),
            metrics("lib-ride-3", "Evening loop", 1_761_172_800, "Ride"),
            metrics("lib-run-1", "Lakeside run", 1_761_259_200, "Run"),
        ])
        .expect("set metrics");

    let portion = ride[20..80].to_vec();
    let auto = engine
        .create_section(section("Ride", portion.clone(), 470.0, None, None))
        .expect("create auto section");
    let retired = engine
        .create_section(section(
            "Ride",
            portion,
            470.0,
            Some("Old drag"),
            Some(("lib-ride-1", 20, 80)),
        ))
        .expect("create the section to retire");
    let custom = engine
        .create_section(section(
            "Run",
            run[10..60].to_vec(),
            390.0,
            Some("Lake sprint"),
            Some(("lib-run-1", 10, 60)),
        ))
        .expect("create custom section");

    // Detection writes an auto section as not user defined, which is what lets
    // the custom one retire into it.
    Connection::open(&path)
        .expect("open writer")
        .execute(
            "UPDATE sections SET is_user_defined = 0, confidence = 0.9, observation_count = 3
             WHERE id = ?1",
            params![auto],
        )
        .expect("mark the auto section detected");
    engine
        .prefer_section(&auto, &retired)
        .expect("retire the custom section");
    engine
        .set_section_name(&auto, Some("Vineyard climb"))
        .expect("name the auto section");
    engine
        .pin_section_geometry(&auto, 1)
        .expect("pin the auto section");
    engine
        .set_setting("__detector_cutover", "unified-1")
        .expect("cutover done");
    engine
        .set_setting("unit_system", "metric")
        .expect("unit setting");
    engine
        .set_setting("__athlete_id", "demo")
        .expect("athlete setting");
    drop(engine);

    let raw = Connection::open(&path).expect("open writer");
    for (id, lap) in [
        ("lib-ride-1", 61.0),
        ("lib-ride-2", 58.5),
        ("lib-ride-3", 63.2),
    ] {
        raw.execute(
            "INSERT OR REPLACE INTO section_activities (section_id, activity_id, direction,
                start_index, end_index, distance_meters, lap_time, lap_pace, excluded, coverage)
             VALUES (?1, ?2, 'same', 20, 80, 470.0, ?3, ?4, 0, 1.0)",
            params![auto, id, lap, 470.0 / lap],
        )
        .expect("ride traversal");
    }
    raw.execute(
        "INSERT OR REPLACE INTO section_activities (section_id, activity_id, direction,
            start_index, end_index, distance_meters, lap_time, lap_pace, excluded, coverage)
         VALUES (?1, 'lib-run-1', 'same', 10, 60, 390.0, 95.0, 4.1, 0, 1.0)",
        params![custom],
    )
    .expect("run traversal");
    raw.execute(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng, activity_count)
         VALUES ('lib-route-1', 'lib-ride-1',
                 '[\"lib-ride-1\",\"lib-ride-2\",\"lib-ride-3\"]', 'Ride',
                 46.2, 46.2024, 7.35, 7.3619, 3)",
        [],
    )
    .expect("route group");
    for (id, percentage) in [
        ("lib-ride-1", 100.0),
        ("lib-ride-2", 97.5),
        ("lib-ride-3", 96.0),
    ] {
        raw.execute(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
             VALUES ('lib-route-1', ?1, ?2, 'same')",
            params![id, percentage],
        )
        .expect("route match");
    }
    drop(raw);

    let mut engine = PersistentEngine::new(&path).expect("reopen engine");
    engine
        .set_route_name("lib-route-1", Some("Vineyard loop"))
        .expect("name the route");
    // Loading numbers the routes, as the first launch after a sync does.
    engine.load().expect("load the library");
    println!("wrote {path}: auto {auto}, retired {retired}, custom {custom}");
}
