//! One tile pass at a time.
//!
//! There is a single handle slot, so a second pass started while one is in
//! flight drops the first pass's handle: the first becomes unobservable, and
//! the two workers write the same tile files. The engine spawns a pass at load
//! when the set is stale and the GPS sync spawns one whenever it stores a
//! track, so the two overlap on the ordinary shape of a cold launch that then
//! syncs.

use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;
use veloqrs::persistence::WorkerPoll;

/// The pass slot and the handle slot are both process-global, so two tests
/// running at once are one test measuring the other.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// Big enough that a pass outlives the call that started it, so the second
/// call lands while the first is genuinely running.
fn seed_engine() -> (PersistentEngine, TempDir) {
    let cfg = LifecycleConfig {
        bucket_a_count: 120,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("tiles.db");
    let mut engine = PersistentEngine::new(db.to_str().unwrap()).expect("open engine");
    for a in corpus.bucket_a {
        engine
            .add_activity(a.id, a.gps_points, a.sport_type)
            .expect("add_activity");
    }
    let tiles = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles).expect("create tiles dir");
    engine.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());
    // set_heatmap_tiles_path parks its own pass in the process-wide slot.
    // Drain it so this test starts from an idle engine.
    if let Ok(mut guard) =
        veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock()
    {
        if let Some(handle) = guard.take() {
            handle.recv_blocking();
        }
    }
    (engine, tmp)
}

#[test]
fn a_second_pass_is_refused_while_one_is_in_flight() {
    let _serial = serial();
    let (engine, _tmp) = seed_engine();
    engine.mark_heatmap_dirty();

    let first = engine
        .generate_tiles_background()
        .expect("the first pass starts");

    assert!(
        matches!(first.poll_state(), WorkerPoll::Running),
        "the corpus is too small to hold a pass open, so this test proves nothing"
    );
    assert!(
        engine.generate_tiles_background().is_none(),
        "a second worker was spawned over the pass already running"
    );

    first.recv_blocking().expect("the first pass completes");
}

#[test]
fn the_slot_comes_back_when_the_pass_ends() {
    let _serial = serial();
    let (engine, _tmp) = seed_engine();
    engine.mark_heatmap_dirty();

    let first = engine
        .generate_tiles_background()
        .expect("the first pass starts");
    first.recv_blocking().expect("the first pass completes");

    let second = engine
        .generate_tiles_background()
        .expect("the slot came back, so the next pass starts");
    second.recv_blocking().expect("the second pass completes");
}
