//! The pool a detect reads while elevation is still owed.
//!
//! A pool that mixes tracks with elevation and tracks without lets a flat
//! track veto a real climb, so while the elevation download can still run a
//! detect reads only the tracks whose elevation is decided, and leaves the
//! others unprocessed for the next detect.

use tempfile::TempDir;
use tracematch::GpsPoint;

use crate::persistence::{ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNKNOWN, PersistentEngine};

fn ride(lat: f64) -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint::new(lat + f64::from(i) * 0.000_1, 7.0))
        .collect()
}

fn store(engine: &mut PersistentEngine, id: &str, lat: f64, state: u8) {
    engine
        .add_activity(id.into(), ride(lat), "Ride".into())
        .expect("add_activity");
    engine
        .record_elevation_state(&[(id.to_string(), state)])
        .expect("record_elevation_state");
}

fn library(dir: &TempDir) -> PersistentEngine {
    let mut engine =
        PersistentEngine::new(dir.path().join("pool.db").to_str().unwrap()).expect("engine");
    for (id, lat, state) in [
        ("a1", 46.0, ELEVATION_STATE_FETCHED),
        ("a2", 46.1, ELEVATION_STATE_FETCHED),
        ("a3", 46.2, ELEVATION_STATE_FETCHED),
        ("b1", 46.3, ELEVATION_STATE_UNKNOWN),
        ("b2", 46.4, ELEVATION_STATE_UNKNOWN),
    ] {
        store(&mut engine, id, lat, state);
    }
    engine
}

fn detect(engine: &mut PersistentEngine) -> Vec<String> {
    let handle = engine.detect_sections_background();
    let (sections, mut processed) = handle.recv().expect("the detect ran");
    engine.apply_sections(sections).expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
    processed.sort();
    processed
}

/// Scenario: five tracks, two with elevation unknown, and the download able to run.
/// Expected behaviour: the detect reads and processes three, and the next
/// detect after the other two are decided reads all five.
#[test]
fn an_owed_track_is_left_out_and_unprocessed_until_decided() {
    let _serial = crate::test_globals::serial_global_state();
    let _creds = crate::objects::test_credentials();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir);

    assert_eq!(detect(&mut engine), ["a1", "a2", "a3"]);
    assert!(!engine.processed_activity_ids.contains("b1"));
    assert!(!engine.processed_activity_ids.contains("b2"));
    assert_eq!(engine.detect_pool_ids(), ["a1", "a2", "a3"]);

    engine
        .record_elevation_state(&[
            ("b1".to_string(), ELEVATION_STATE_FETCHED),
            (
                "b2".to_string(),
                crate::persistence::ELEVATION_STATE_UNAVAILABLE,
            ),
        ])
        .expect("record_elevation_state");
    assert_eq!(detect(&mut engine), ["a1", "a2", "a3", "b1", "b2"]);
}

/// Scenario: a track nobody can ask about, because no credential is held.
/// Expected behaviour: nothing is owed, so the pool is the whole library and
/// a library that never updates is not starved of sections.
#[test]
fn nothing_is_held_out_when_the_download_cannot_run() {
    let _serial = crate::test_globals::serial_global_state();
    crate::objects::clear_test_credentials();
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir);

    assert_eq!(detect(&mut engine), ["a1", "a2", "a3", "b1", "b2"]);
}

/// Scenario: a library of only owed tracks.
/// Expected behaviour: the pool is empty and nothing is marked processed.
#[test]
fn a_library_wholly_owed_has_an_empty_pool() {
    let _serial = crate::test_globals::serial_global_state();
    let _creds = crate::objects::test_credentials();
    let dir = TempDir::new().expect("tempdir");
    let mut engine =
        PersistentEngine::new(dir.path().join("owed.db").to_str().unwrap()).expect("engine");
    store(&mut engine, "b1", 46.0, ELEVATION_STATE_UNKNOWN);

    assert!(engine.detect_pool_ids().is_empty());
    assert!(!engine.processed_activity_ids.contains("b1"));
}
