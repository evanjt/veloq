//! Scenario: a watch guides a rider over a saved section or route and needs its line, start,
//! length, best time and the best pass's splits from one read.
//!
//! Expected behaviour: the line is simplified to the tolerance with each kept vertex carrying its
//! own elevation, a corner larger than the tolerance survives, and the splits are ten and sum to
//! the best time.

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::persistence::guide_payload::guide_payload;
use crate::persistence::nearby_routes::NearbyKind;

const LAT: f64 = 46.0;
const LNG: f64 = 7.0;
const METRES_PER_DEGREE: f64 = 111_320.0;
const POINTS: usize = 1_000;
const SPACING_M: f64 = 3.0;
const DOGLEG_AT_M: f64 = 1_500.0;
const DOGLEG_M: f64 = 30.0;

/// A line due east with one triangular detour north, peaking [`DOGLEG_M`] off the line, and an
/// elevation that rises with the distance along it.
fn dogleg_line() -> Vec<GpsPoint> {
    let lng_metres = METRES_PER_DEGREE * LAT.to_radians().cos();
    (0..POINTS)
        .map(|i| {
            let east = i as f64 * SPACING_M;
            let off =
                (DOGLEG_M - (east - (DOGLEG_AT_M + DOGLEG_M / 2.0)).abs()).clamp(0.0, DOGLEG_M);
            GpsPoint {
                latitude: LAT + off / METRES_PER_DEGREE,
                longitude: LNG + east / lng_metres,
                elevation: Some(400.0 + east / 10.0),
            }
        })
        .collect()
}

fn metrics(id: &str, moving_time: u32) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: id.to_string(),
        name: id.to_string(),
        date: 1_700_000_000,
        distance: 3_000.0,
        moving_time,
        elapsed_time: moving_time,
        elevation_gain: 100.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Run".to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

/// A section along the dogleg line, passed once per entry of `laps` (seconds), each pass at an
/// even pace of one sample a second scaled so the pass takes that long.
fn engine_with_section(laps: &[u32]) -> PersistentEngine {
    let line = dogleg_line();
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_blob,
                                   distance_meters, elevation_gain_m, visit_count)
             VALUES ('s1', 'auto', 'Hill', 'Run', ?1, 2997.0, 100.0, ?2)",
            params![
                crate::persistence::codec::serialize_track_points(&line),
                laps.len() as i64
            ],
        )
        .expect("insert section");
    for (i, &seconds) in laps.iter().enumerate() {
        let id = format!("act-{i}");
        engine
            .add_activity(id.clone(), line.clone(), "Run".to_string())
            .expect("add activity");
        engine
            .set_activity_metrics(vec![metrics(&id, seconds)])
            .expect("metrics");
        let times: Vec<u32> = (0..POINTS as u32)
            .map(|k| (f64::from(k) * f64::from(seconds) / (POINTS as f64 - 1.0)).round() as u32)
            .collect();
        engine.store_time_streams_flat(std::slice::from_ref(&id), &times, &[0]);
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, start_index, end_index,
                                                 distance_meters, lap_time)
                 VALUES ('s1', ?1, 0, ?2, 2997.0, ?3)",
                params![id, POINTS as i64, f64::from(seconds)],
            )
            .expect("insert lap");
    }
    engine
}

#[test]
fn a_dogleg_survives_the_tolerance_with_elevation_and_the_splits_sum_to_the_best_time() {
    let engine = engine_with_section(&[1_000, 900, 950]);
    let payload =
        guide_payload(&engine.db, NearbyKind::Section, "s1", 5.0).expect("section is read");

    assert!(
        payload.line.len() < 40,
        "kept {} points",
        payload.line.len()
    );
    let peak = LAT + DOGLEG_M / METRES_PER_DEGREE;
    assert!(
        payload
            .line
            .iter()
            .any(|p| (p.latitude - peak).abs() * METRES_PER_DEGREE < 1.0),
        "the dogleg's vertex is kept"
    );
    assert!(payload.line.iter().all(|p| p.elevation.is_some()));
    let elevations: Vec<f64> = payload.line.iter().filter_map(|p| p.elevation).collect();
    assert!(
        elevations.windows(2).all(|w| w[0] < w[1]),
        "each vertex keeps its own elevation"
    );
    assert_eq!(payload.start.latitude, payload.line[0].latitude);

    assert_eq!(payload.best_time_seconds, Some(900));
    assert_eq!(payload.splits.len(), 10);
    assert_eq!(payload.splits.iter().sum::<u32>(), 900);
    assert!(
        payload.splits.iter().all(|&split| split.abs_diff(90) <= 5),
        "{:?}",
        payload.splits
    );
    assert_eq!(payload.name, "Hill");
    assert_eq!(payload.distance_meters, 2_997.0);
}

#[test]
fn a_section_with_no_timed_pass_has_a_line_and_no_best_or_splits() {
    let engine = engine_with_section(&[]);
    let payload = guide_payload(&engine.db, NearbyKind::Section, "s1", 5.0).expect("read");
    assert!(payload.best_time_seconds.is_none());
    assert!(payload.splits.is_empty());
    assert!(payload.line.len() >= 2);
}

#[test]
fn a_missing_section_reads_as_nothing() {
    let engine = engine_with_section(&[900]);
    assert!(guide_payload(&engine.db, NearbyKind::Section, "gone", 5.0).is_none());
}

#[test]
fn a_route_carries_its_best_attempts_splits_and_the_representative_line() {
    let line = dogleg_line();
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let members = ["r-0".to_string(), "r-1".to_string()];
    for (member, seconds) in members.iter().zip([1_200_u32, 1_100]) {
        engine
            .add_activity(member.clone(), line.clone(), "Run".to_string())
            .expect("add activity");
        engine
            .set_activity_metrics(vec![metrics(member, seconds)])
            .expect("metrics");
        let times: Vec<u32> = (0..POINTS as u32)
            .map(|k| (f64::from(k) * f64::from(seconds) / (POINTS as f64 - 1.0)).round() as u32)
            .collect();
        engine.store_time_streams_flat(std::slice::from_ref(member), &times, &[0]);
    }
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count)
             VALUES ('route', 'r-0', ?1, 'Run', 2)",
            params![serde_json::to_string(&members).unwrap()],
        )
        .expect("insert group");

    let payload = guide_payload(&engine.db, NearbyKind::Route, "route", 5.0).expect("route");

    assert_eq!(payload.best_time_seconds, Some(1_100));
    assert_eq!(payload.splits.len(), 10);
    assert_eq!(payload.splits.iter().sum::<u32>(), 1_100);
    assert!(payload.line.len() < 40);
    assert!(payload.line.iter().all(|p| p.elevation.is_some()));
}
