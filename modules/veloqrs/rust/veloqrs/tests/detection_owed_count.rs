//! What a resting detection row rests on.
//!
//! The jobs screen lists every job always, with a resting state, and a resting
//! row is only honest if it says what is waiting. Detection's phase cannot say:
//! it is a process-global value starting at idle, so after a relaunch it reads
//! idle whatever is outstanding.
//!
//! The persisted `processed_activities` table is the durable fact. An activity
//! that is not in it has never been through a detect, and the count of those is
//! what a run still owes.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test detection_owed_count -p veloqrs`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn track(seed: usize) -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint::new(46.0 + seed as f64 * 0.02 + i as f64 * 0.0005, 7.0))
        .collect()
}

fn engine_with(dir: &TempDir, activities: usize) -> PersistentEngine {
    let path = dir.path().join("owed.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("engine");
    for i in 0..activities {
        engine
            .add_activity(format!("a{i}"), track(i), "Ride".into())
            .expect("add activity");
    }
    engine
}

#[test]
fn a_fresh_library_owes_a_detect_for_every_activity() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with(&dir, 5);

    assert_eq!(engine.activities_awaiting_detection().unwrap(), 5);
}

#[test]
fn an_empty_library_owes_nothing() {
    let dir = TempDir::new().unwrap();
    let engine = engine_with(&dir, 0);

    assert_eq!(engine.activities_awaiting_detection().unwrap(), 0);
}

/// The count is the point of the item: it has to survive the relaunch that
/// resets every phase to idle.
#[test]
fn the_count_survives_a_reopen() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("owed.db");
    {
        let mut engine = PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("engine");
        for i in 0..4 {
            engine
                .add_activity(format!("a{i}"), track(i), "Ride".into())
                .expect("add activity");
        }
        engine
            .save_processed_activity_ids(&["a0".into(), "a1".into()])
            .expect("save");
    }

    let mut reopened = PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("engine");
    reopened.load().expect("load");

    assert_eq!(
        reopened.activities_awaiting_detection().unwrap(),
        2,
        "the two that were never processed are still owed after a reopen"
    );
}
