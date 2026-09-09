//! What the export trim would do, before it is switched on.
//!
//! The radius is meaningless as a number. The athlete needs to know how many
//! of their rides it reaches and how many it would leave out of the archive
//! altogether, and the home itself is a guess the app makes and the athlete
//! confirms. Both are reads over stored endpoints and bounding boxes, so no
//! track blob is decoded to answer either.
//!
//! Synthetic coordinates only.

use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentEngine};

const HOME_LAT: f64 = 46.2333;
const HOME_LNG: f64 = 7.36;

/// Roughly `metres` north of home.
fn north(metres: f64) -> GpsPoint {
    GpsPoint {
        latitude: HOME_LAT + metres / 111_320.0,
        longitude: HOME_LNG,
        elevation: None,
    }
}

fn ride(metres: &[f64]) -> Vec<GpsPoint> {
    metres.iter().map(|m| north(*m)).collect()
}

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    PersistentEngine::new(path.to_str().unwrap()).expect("engine")
}

/// One ride from the door, one from the next suburb, one from another valley.
fn three_rides(dir: &TempDir) -> PersistentEngine {
    let mut engine = engine(dir);
    engine
        .add_activity(
            "door".into(),
            ride(&[10.0, 600.0, 1200.0, 400.0, 8.0]),
            "Ride".into(),
        )
        .expect("door");
    engine
        .add_activity(
            "suburb".into(),
            ride(&[300.0, 1400.0, 2000.0, 900.0, 350.0]),
            "Ride".into(),
        )
        .expect("suburb");
    engine
        .add_activity(
            "away".into(),
            ride(&[5000.0, 6000.0, 7000.0, 5200.0]),
            "Ride".into(),
        )
        .expect("away");
    engine
}

#[test]
fn the_preview_counts_only_the_rides_the_radius_reaches() {
    let dir = TempDir::new().unwrap();
    let engine = three_rides(&dir);

    let preview = engine
        .export_privacy_preview(HOME_LAT, HOME_LNG, 100.0)
        .expect("preview");

    assert_eq!(preview.with_track, 3);
    assert_eq!(preview.touched, 1);
    assert_eq!(preview.dropped, 0);
}

#[test]
fn widening_the_radius_reaches_more_rides() {
    let dir = TempDir::new().unwrap();
    let engine = three_rides(&dir);

    let tight = engine
        .export_privacy_preview(HOME_LAT, HOME_LNG, 100.0)
        .expect("preview");
    let wide = engine
        .export_privacy_preview(HOME_LAT, HOME_LNG, 500.0)
        .expect("preview");

    assert_eq!(tight.touched, 1);
    assert_eq!(wide.touched, 2);
    assert_eq!(wide.with_track, tight.with_track);
}

#[test]
fn the_off_position_reaches_nothing() {
    let dir = TempDir::new().unwrap();
    let engine = three_rides(&dir);

    let preview = engine
        .export_privacy_preview(HOME_LAT, HOME_LNG, 0.0)
        .expect("preview");

    assert_eq!(preview.with_track, 3);
    assert_eq!(preview.touched, 0);
    assert_eq!(preview.dropped, 0);
}

#[test]
fn a_ride_that_never_leaves_the_radius_is_counted_as_dropped() {
    let dir = TempDir::new().unwrap();
    let mut engine = three_rides(&dir);
    engine
        .add_activity(
            "backyard".into(),
            ride(&[10.0, 40.0, 25.0, 15.0]),
            "Ride".into(),
        )
        .expect("backyard");

    let preview = engine
        .export_privacy_preview(HOME_LAT, HOME_LNG, 100.0)
        .expect("preview");

    assert_eq!(preview.with_track, 4);
    assert_eq!(preview.touched, 2);
    assert_eq!(preview.dropped, 1);
}

#[test]
fn a_track_with_no_signature_counts_in_the_denominator_only() {
    let dir = TempDir::new().unwrap();
    let mut engine = three_rides(&dir);
    engine
        .add_activity("single-fix".into(), ride(&[5.0]), "Ride".into())
        .expect("single fix");

    let preview = engine
        .export_privacy_preview(HOME_LAT, HOME_LNG, 100.0)
        .expect("preview");

    assert_eq!(preview.with_track, 4);
    assert_eq!(preview.touched, 1);
}

#[test]
fn an_empty_library_previews_zeroes_rather_than_failing() {
    let dir = TempDir::new().unwrap();
    let engine = engine(&dir);

    let preview = engine
        .export_privacy_preview(HOME_LAT, HOME_LNG, 100.0)
        .expect("preview");

    assert_eq!(preview.with_track, 0);
    assert_eq!(preview.touched, 0);
    assert_eq!(preview.dropped, 0);
}
