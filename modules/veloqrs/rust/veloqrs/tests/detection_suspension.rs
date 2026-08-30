//! Detection is all-or-nothing against an elevation backfill.
//!
//! A candidate lift span survives when its own track carries no elevation,
//! but a rescuing track without elevation cannot rescue it. Halfway through a
//! backfill a real climb is therefore vetoed as a lift, the spurious section
//! is written, and it takes a durable ledger id that outlives the backfill.
//! So a backfill holds a suspension guard and no detection arm may start
//! while it does.
//!
//! Run: `cargo test --test detection_suspension -p veloqrs`

use std::sync::Mutex;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::sections::conditioning;
use veloqrs::persistence::{WorkerPoll, detection_suspended, suspend_detection};

/// Suspension is process-wide, so every test in this binary takes it in turn.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn track(seed: f64) -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 10.0 + seed * 0.01 + f64::from(i) * 0.0002,
            longitude: 20.0 + seed * 0.01,
            elevation: None,
        })
        .collect()
}

fn engine_with(ids: &[&str]) -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine =
        PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("open engine");
    for (i, id) in ids.iter().enumerate() {
        engine
            .add_activity((*id).to_string(), track(i as f64), "Ride".to_string())
            .expect("store activity");
    }
    (dir, engine)
}

/// A fresh engine detects. Suspension is process-lifetime state and is never
/// persisted, so a crash mid-backfill comes back able to detect.
#[test]
fn a_fresh_engine_is_never_suspended() {
    let _serial = serial();
    let (_dir, mut engine) = engine_with(&["a1", "a2"]);

    assert!(!detection_suspended(), "a fresh process is not suspended");
    let handle = engine.detect_sections_background();
    assert!(
        !matches!(handle.poll_state(), WorkerPoll::Died),
        "an unsuspended engine starts a real run"
    );
}

/// The funnel arm: `detect_sections_background` is what every arm calls, so
/// gating it gates `DetectionManager::start`, `force_redetect` and the
/// conditioning driver alike.
#[test]
fn the_background_detect_arm_refuses_while_suspended() {
    let _serial = serial();
    let (_dir, mut engine) = engine_with(&["b1", "b2"]);

    let guard = suspend_detection();
    let handle = engine.detect_sections_background();
    assert!(
        matches!(handle.poll_state(), WorkerPoll::Died),
        "a suspended detect must refuse, not run"
    );
    assert!(
        handle.take_cache().is_none(),
        "a refused run carries no evidence-cache update"
    );
    drop(guard);
}

/// The conditioning arm fires from inside the Rust ingest loop with no FFI
/// round trip, so it needs the same gate.
#[test]
fn the_conditioning_arm_refuses_while_suspended() {
    let _serial = serial();

    let guard = suspend_detection();
    conditioning::note_stored(conditioning::CONDITIONING_BATCH_ADDS);
    assert!(
        !conditioning::maybe_condition_backfill(),
        "a due batch must not start a run while suspended"
    );
    drop(guard);
}

/// A refusal reports as a dead worker, which the FFI poll renders "error".
/// A run that finished having changed nothing reports Ready and renders
/// "complete", so the caller can tell the two apart.
#[test]
fn a_refusal_is_distinguishable_from_a_run_that_changed_nothing() {
    let _serial = serial();
    let (_dir, mut engine) = engine_with(&["c1", "c2"]);

    let refused = {
        let _guard = suspend_detection();
        engine.detect_sections_background()
    };
    assert!(matches!(refused.poll_state(), WorkerPoll::Died));

    let ran = engine.detect_sections_background();
    let (sections, _ids) = ran.recv().expect("an unsuspended run sends a result");
    assert!(
        sections.is_empty(),
        "this pool has no repeated ground, so the run changes nothing"
    );
}

/// Release is the guard's drop, not a matched call, so bailing out of the
/// backfill early still resumes detection.
#[test]
fn the_guard_releases_on_an_early_return() {
    let _serial = serial();

    fn backfill_bails_out() -> Option<()> {
        let _guard = suspend_detection();
        assert!(detection_suspended());
        None?;
        unreachable!("the early return is the point of this test")
    }

    assert!(backfill_bails_out().is_none());
    assert!(!detection_suspended(), "an early return still releases");
}

#[test]
fn detection_works_normally_again_after_release() {
    let _serial = serial();
    let (_dir, mut engine) = engine_with(&["d1", "d2"]);

    let guard = suspend_detection();
    assert!(matches!(
        engine.detect_sections_background().poll_state(),
        WorkerPoll::Died
    ));
    drop(guard);

    assert!(!detection_suspended());
    let handle = engine.detect_sections_background();
    assert!(
        handle.recv().is_some(),
        "detection runs again once the backfill releases"
    );
}

/// The elevation query is available but is not itself a gate: a library that
/// has never been backfilled still detects.
#[test]
fn an_unbackfilled_library_still_detects() {
    let _serial = serial();
    let (_dir, mut engine) = engine_with(&["e1", "e2"]);

    assert!(
        engine.elevation_backfill_outstanding() > 0,
        "tracks stored without elevation read as outstanding"
    );
    assert!(!engine.library_uniformly_elevated());

    let handle = engine.detect_sections_background();
    assert!(
        handle.recv().is_some(),
        "a non-uniform library detects unless a backfill holds the guard"
    );
}
