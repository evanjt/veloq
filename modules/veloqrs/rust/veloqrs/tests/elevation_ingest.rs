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

/// Adding elevation by re-ingesting the whole track replaces the coordinates
/// the catalogue was derived from, so the activity is evicted from the
/// processed set and every section on it is re-derived. Splicing writes the
/// points the device already holds, so nothing is invalidated.
#[test]
fn a_splice_is_not_a_mutation_and_a_re_ingest_is() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("engine.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    let flat = climbing_line(false);
    let elevations: Vec<f64> = (0..flat.len()).map(|i| 1000.0 + i as f64 * 5.0).collect();
    for id in ["spliced", "re-ingested"] {
        engine
            .add_activity(id.to_string(), flat.clone(), "Ride".to_string())
            .unwrap();
    }
    engine
        .save_processed_activity_ids(&["spliced".to_string(), "re-ingested".to_string()])
        .unwrap();
    // The stored track is the quantised one, which is what a splice must
    // reproduce coordinate for coordinate.
    let stored = engine.get_gps_track("spliced").unwrap();

    assert!(
        engine
            .splice_track_elevation("spliced", &elevations)
            .unwrap()
    );
    engine
        .add_activity(
            "re-ingested".to_string(),
            climbing_line(true),
            "Ride".to_string(),
        )
        .unwrap();

    assert!(
        processed(&path, "spliced"),
        "a splice must not re-derive the catalogue"
    );
    assert!(
        !processed(&path, "re-ingested"),
        "a replaced track must re-derive the catalogue"
    );

    let loaded = engine.get_gps_track("spliced").unwrap();
    assert_eq!(loaded.len(), stored.len());
    for (was, now) in stored.iter().zip(&loaded) {
        assert_eq!((was.latitude, was.longitude), (now.latitude, now.longitude));
    }
    assert_eq!(loaded[0].elevation, Some(1000.0));
}

/// A series that is not the length of the stored track is upstream having
/// re-processed the activity. Nothing is written: the caller fetches the whole
/// track instead.
#[test]
fn a_series_of_the_wrong_length_writes_nothing() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("engine.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let flat = climbing_line(false);
    engine
        .add_activity("moved".to_string(), flat.clone(), "Ride".to_string())
        .unwrap();

    let stored = engine.get_gps_track("moved").unwrap();
    let short: Vec<f64> = (0..flat.len() - 1).map(|i| 1000.0 + i as f64).collect();
    assert!(!engine.splice_track_elevation("moved", &short).unwrap());
    assert!(
        !engine
            .splice_track_elevation("never-stored", &[1.0, 2.0])
            .unwrap()
    );

    let loaded = engine.get_gps_track("moved").unwrap();
    assert_eq!(
        loaded, stored,
        "a refused splice must leave the track alone"
    );
}

/// A sample upstream could not fill leaves that point without an elevation,
/// rather than writing a placeholder the detector would read as ground.
#[test]
fn an_unfillable_sample_is_left_without_an_elevation() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("engine.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let flat = climbing_line(false);
    engine
        .add_activity("gappy".to_string(), flat.clone(), "Ride".to_string())
        .unwrap();

    let mut elevations: Vec<f64> = (0..flat.len()).map(|i| 1000.0 + i as f64).collect();
    elevations[7] = f64::NAN;
    assert!(engine.splice_track_elevation("gappy", &elevations).unwrap());

    let loaded = engine.get_gps_track("gappy").unwrap();
    assert_eq!(loaded[6].elevation, Some(1006.0));
    assert_eq!(loaded[7].elevation, None);
    assert_eq!(loaded[8].elevation, Some(1008.0));
}

/// The processed set on a second connection, so an assertion cannot be
/// satisfied by an in-memory value the database never received.
fn processed(path: &std::path::Path, id: &str) -> bool {
    let conn = rusqlite::Connection::open(path).expect("reopen database");
    conn.query_row(
        "SELECT COUNT(*) FROM processed_activities WHERE activity_id = ?1",
        rusqlite::params![id],
        |row| row.get::<_, i64>(0),
    )
    .expect("read processed set")
        > 0
}
