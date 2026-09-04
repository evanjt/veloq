//! Elevation on the ingest path.
//!
//! Per-point elevation has two consumers in the unified detector. The lift veto
//! raises no candidate unless at least two points carry one. The level test in
//! the same-traffic pass segmenter treats a missing elevation as the same level,
//! so absence merges stacked ground rather than leaving it undecided.
//!
//! Expected behaviour: a stored track round-trips its elevation, and a lift
//! candidate needs point elevation to be raised.

use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentEngine};

const METRES_PER_DEGREE_LAT: f64 = 111_132.0;

/// A straight climbing line: 100 points, 10 m apart, 50 percent grade. Clears
/// `lift_span_m` 300, `lift_min_grade` 0.22 and `lift_min_straight` 0.975 with
/// margin, so a tunables change moves the veto threshold without turning the
/// elevation assertion below red.
fn climbing_line(with_elevation: bool) -> Vec<GpsPoint> {
    let step = 10.0 / METRES_PER_DEGREE_LAT;
    (0..100)
        .map(|i| {
            let lat = 46.0 + i as f64 * step;
            if with_elevation {
                GpsPoint::with_elevation(lat, 7.0, 1000.0 + i as f64 * 5.0)
            } else {
                GpsPoint::new(lat, 7.0)
            }
        })
        .collect()
}

#[test]
fn stored_track_round_trips_elevation() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("engine.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    engine
        .add_activity(
            "climb-1".to_string(),
            climbing_line(true),
            "Ride".to_string(),
        )
        .unwrap();

    let loaded = engine.get_gps_track("climb-1").unwrap();
    assert_eq!(loaded.len(), 100);
    assert_eq!(loaded[0].elevation, Some(1000.0));
    assert_eq!(loaded[99].elevation, Some(1495.0));
}

#[test]
fn lift_detection_needs_point_elevation() {
    assert!(
        !tracematch::lift_spans(&climbing_line(true), None).is_empty(),
        "a straight 50 percent line with elevation is a lift candidate"
    );
    assert!(
        tracematch::lift_spans(&climbing_line(false), None).is_empty(),
        "the same geometry without elevation raises no candidate"
    );
}

#[test]
fn a_track_without_elevation_still_stores() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("engine.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    engine
        .add_activity(
            "flat-1".to_string(),
            climbing_line(false),
            "Ride".to_string(),
        )
        .unwrap();

    let loaded = engine.get_gps_track("flat-1").unwrap();
    assert_eq!(loaded.len(), 100);
    assert!(loaded.iter().all(|p| p.elevation.is_none()));
}

#[test]
fn a_track_with_elevation_gaps_stores_the_gaps_as_absent() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("engine.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    let mut points = climbing_line(true);
    points[10].elevation = None;
    points[11].elevation = None;

    engine
        .add_activity("mixed-1".to_string(), points, "Ride".to_string())
        .unwrap();

    let loaded = engine.get_gps_track("mixed-1").unwrap();
    assert_eq!(loaded.len(), 100);
    assert_eq!(loaded[9].elevation, Some(1045.0));
    assert_eq!(loaded[10].elevation, None);
    assert_eq!(loaded[11].elevation, None);
    assert_eq!(loaded[12].elevation, Some(1060.0));
}
