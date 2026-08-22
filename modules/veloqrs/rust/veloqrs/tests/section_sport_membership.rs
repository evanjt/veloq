//! Scenario: one corridor travelled by both a ride and a run, detected pooled.
//! Expected behaviour: the ground is ONE neutral section that lists under both
//! sports, while every effort comparison stays inside a single sport.
//!
//! This gates the query layer, not the detector. Invariant 2 says
//! `section.sport_type` is a derived attribute of one ground, so a filter that
//! reads it as a key hides a section from a sport that genuinely traverses it,
//! and a ranking that reads it compares a run's lap against a ride's.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test section_sport_membership`

#![cfg(feature = "synthetic")]

use std::collections::BTreeSet;

use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::scenarios::LifecycleActivity;
use tracematch::{DetectionMethod, SectionConfig};
use veloqrs::PersistentRouteEngine;

const RIDE: &str = "Ride";
const RUN: &str = "Run";

/// A gently bending road, densified at ~10 m, that a road could actually take.
fn road() -> Vec<GpsPoint> {
    let (base_lat, base_lng) = (46.0_f64, 7.0_f64);
    let m_lat = 111_320.0_f64;
    let m_lng = m_lat * base_lat.to_radians().cos();
    let waypoints: [(f64, f64); 5] = [
        (0.0, 0.0),
        (250.0, 40.0),
        (480.0, -30.0),
        (700.0, 50.0),
        (900.0, 0.0),
    ];
    let mut path: Vec<(f64, f64)> = Vec::new();
    for w in waypoints.windows(2) {
        let (ax, ay) = w[0];
        let (bx, by) = w[1];
        let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
        let steps = (len / 10.0).ceil().max(1.0) as usize;
        for s in 0..steps {
            let t = s as f64 / steps as f64;
            path.push((ax + (bx - ax) * t, ay + (by - ay) * t));
        }
    }
    path.push(waypoints[4]);
    path.iter()
        .enumerate()
        .map(|(i, &(x, y))| {
            GpsPoint::with_elevation(
                base_lat + y / m_lat,
                base_lng + x / m_lng,
                300.0 + 0.4 * i as f64,
            )
        })
        .collect()
}

/// One pass over `road`, wobbled perpendicular so passes braid rather than
/// coincide. Starts sit three days apart so support counts distinct occasions.
fn pass(idx: usize, sport: &str) -> LifecycleActivity {
    let wobble = ((idx % 5) as f64 - 2.0) * 1.5;
    let m_lat = 111_320.0_f64;
    let pts = road()
        .into_iter()
        .map(|p| {
            GpsPoint::with_elevation(
                p.latitude + wobble / m_lat,
                p.longitude,
                p.elevation.unwrap_or(300.0),
            )
        })
        .collect();
    LifecycleActivity {
        id: format!("{}_{idx:03}", sport.to_lowercase()),
        sport_type: sport.to_string(),
        start_date_unix: 1_600_000_000 + idx as i64 * 3 * 86_400,
        gps_points: pts,
    }
}

fn pooled_engine() -> (PersistentRouteEngine, TempDir) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sport.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    engine.set_section_config(SectionConfig {
        detection_method: DetectionMethod::Unified,
        pool_sports: true,
        ..SectionConfig::default()
    });
    (engine, dir)
}

fn ingest(engine: &mut PersistentRouteEngine, activities: &[LifecycleActivity]) {
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
}

fn detect(engine: &mut PersistentRouteEngine) {
    let handle = engine.detect_sections_background();
    let (sections, processed) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
}

/// A pool both sports travel: six rides and six runs over the same road.
fn shared_road_engine() -> (PersistentRouteEngine, TempDir) {
    let (mut engine, dir) = pooled_engine();
    let mut pool: Vec<LifecycleActivity> = (0..6).map(|i| pass(i, RIDE)).collect();
    pool.extend((6..12).map(|i| pass(i, RUN)));
    ingest(&mut engine, &pool);
    detect(&mut engine);
    (engine, dir)
}

fn sports_of(engine: &PersistentRouteEngine, section_id: &str) -> BTreeSet<String> {
    engine
        .get_sections()
        .iter()
        .find(|s| s.id == section_id)
        .map(|s| {
            s.activity_portions
                .iter()
                .map(|p| p.activity_id.clone())
                .filter_map(|id| {
                    if id.starts_with("ride") {
                        Some(RIDE.to_string())
                    } else if id.starts_with("run") {
                        Some(RUN.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn shared_ground_lists_under_every_sport_that_travels_it() {
    let (engine, _dir) = shared_road_engine();

    let multi: Vec<String> = engine
        .get_sections()
        .iter()
        .filter(|s| sports_of(&engine, &s.id).len() > 1)
        .map(|s| s.id.clone())
        .collect();
    assert!(
        !multi.is_empty(),
        "pooled detection produced no cross-sport section, so this suite proves nothing"
    );

    let under_ride: BTreeSet<String> = engine
        .get_sections_filtered(Some(RIDE), None)
        .iter()
        .map(|s| s.id.clone())
        .collect();
    let under_run: BTreeSet<String> = engine
        .get_sections_filtered(Some(RUN), None)
        .iter()
        .map(|s| s.id.clone())
        .collect();

    for id in &multi {
        assert!(
            under_ride.contains(id),
            "section {id} is traversed by a ride but is absent from the Ride list"
        );
        assert!(
            under_run.contains(id),
            "section {id} is traversed by a run but is absent from the Run list"
        );
    }
}

#[test]
fn summaries_agree_with_the_in_memory_filter() {
    let (engine, _dir) = shared_road_engine();

    for sport in [RIDE, RUN] {
        let filtered: BTreeSet<String> = engine
            .get_sections_filtered(Some(sport), None)
            .iter()
            .map(|s| s.id.clone())
            .collect();
        let summaries: BTreeSet<String> = engine
            .get_section_summaries_for_sport(sport)
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(
            filtered, summaries,
            "{sport}: the section list and the summary list disagree on membership"
        );
    }
}

/// Seed one section on shared ground: four rides and three runs, all with lap
/// times. Runs are made far slower than rides, so a ranking that mixed the two
/// would report a ride's time as the runs' best.
fn seed_shared_section(db_path: &std::path::Path) {
    let raw = rusqlite::Connection::open(db_path).expect("raw open");
    raw.execute(
        "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
         VALUES ('sec-shared', 'auto', 'Ride', '[]', 1000.0)",
        [],
    )
    .expect("insert section");

    let add = |id: &str, sport: &str, lap: f64, day: i64| {
        raw.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?1, ?2, 46.0, 46.1, 7.0, 7.1)",
            rusqlite::params![id, sport],
        )
        .expect("insert activity");
        raw.execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain, sport_type)
             VALUES (?1, ?1, ?2, 1000.0, 600, 600, 10.0, ?3)",
            rusqlite::params![id, 1_600_000_000_i64 + day * 86_400, sport],
        )
        .expect("insert metrics");
        raw.execute(
            "INSERT INTO section_activities
             (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace)
             VALUES ('sec-shared', ?1, 'same', 0, 10, 1000.0, ?2, 1.0)",
            rusqlite::params![id, lap],
        )
        .expect("insert traversal");
    };

    for i in 0..4 {
        add(&format!("ride-{i}"), RIDE, 100.0 + i as f64, i);
    }
    for i in 0..3 {
        add(&format!("run-{i}"), RUN, 500.0 + i as f64, 10 + i);
    }
}

#[test]
fn ranking_partitions_traversals_by_sport() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("rank.db");
    let engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("engine");
    seed_shared_section(&db_path);

    let ranked = |sport: &str| {
        engine
            .get_ranked_sections(sport, 100)
            .into_iter()
            .find(|r| r.section_id == "sec-shared")
            .unwrap_or_else(|| panic!("{sport}: shared section is absent from the ranking"))
    };

    let ride = ranked(RIDE);
    let run = ranked(RUN);

    assert_eq!(
        ride.traversal_count, 4,
        "Ride must rank its four laps alone"
    );
    assert_eq!(run.traversal_count, 3, "Run must rank its three laps alone");
    assert_eq!(
        ride.best_time_secs, 100.0,
        "Ride's best must come from a ride lap"
    );
    assert_eq!(
        run.best_time_secs, 500.0,
        "Run's best must come from a run lap, not from the faster rides over the same ground"
    );
}

/// A record belongs to the sport that set it. Rides here are five times faster
/// than runs over the same ground, so a pooled best would deny every run a PR
/// forever.
#[test]
fn a_record_is_earned_against_the_same_sport() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("pr.db");
    let engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("engine");
    seed_shared_section(&db_path);
    engine
        .recompute_activity_indicators()
        .expect("recompute_activity_indicators");

    let ids: Vec<String> = (0..4)
        .map(|i| format!("ride-{i}"))
        .chain((0..3).map(|i| format!("run-{i}")))
        .collect();
    let prs: BTreeSet<String> = engine
        .get_activity_indicators(&ids)
        .into_iter()
        .filter(|i| i.indicator_type == "section_pr")
        .map(|i| i.activity_id)
        .collect();

    assert!(
        prs.contains("run-0"),
        "the fastest run set no record: its 500s lap was judged against the rides' 100s over the same ground (PRs: {prs:?})"
    );
    assert!(
        prs.contains("ride-0"),
        "the fastest ride set no record (PRs: {prs:?})"
    );
    assert!(
        !prs.contains("run-1") && !prs.contains("ride-1"),
        "only the fastest effort in each sport is a record (PRs: {prs:?})"
    );
}
