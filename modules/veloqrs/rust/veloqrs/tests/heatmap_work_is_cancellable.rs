//! A heatmap pass the athlete walked away from stops.
//!
//! Scenario: tile generation and the tile invalidation sweep are both detached
//! threads with no stop. Turning the heatmap off, clearing the cache, or
//! leaving the screen ends the athlete's interest in them, and both run to the
//! end regardless, holding a core and writing files nobody asked for.
//!
//! Expected behaviour: a cancel stops the pass at its next safe point, and it
//! says it stopped early rather than reporting a clean finish. Cancelling
//! heatmap work costs nothing but a stale heatmap the next pass redraws, which
//! is why the dirty marker must survive a cancelled pass.
//!
//! The pass slot and the handle slot are process-global, so these take `SERIAL`.
//!
//! Run: `cargo test --features synthetic --test heatmap_work_is_cancellable -p veloqrs`

use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;
use veloqrs::persistence::CancelToken;

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// Big enough that a pass outlives the call that started it, so a cancel has
/// something in flight to land on.
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
    // Drain it so this test starts from an idle engine, then take the tiles it
    // drew: phase 3 skips a tile that already exists, so a pass over a full
    // set draws nothing and every count here would read zero.
    if let Ok(mut guard) =
        veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock()
    {
        if let Some(handle) = guard.take() {
            handle.recv_blocking();
        }
    }
    for entry in std::fs::read_dir(&tiles).expect("read tiles dir").flatten() {
        // The zoom directories only. `version.txt` stays: without it the set
        // reads as dirty whatever a pass does, and two of these tests turn on
        // the marker moving.
        if entry.path().is_dir() {
            std::fs::remove_dir_all(entry.path()).expect("clear the seeded tiles");
        }
    }
    (engine, tmp)
}

/// The corpus is generated from a fixed config, so the two engines here draw
/// the same tiles and the counts are comparable.
#[test]
fn a_cancelled_pass_draws_less_than_a_pass_left_alone() {
    let _serial = serial();

    let (finished, _finished_tmp) = seed_engine();
    finished.mark_heatmap_dirty();
    let full = finished
        .generate_tiles_background()
        .expect("the pass starts")
        .recv_blocking()
        .expect("the pass completes");
    assert!(
        full > 0,
        "the corpus draws no tiles, so this test proves nothing"
    );

    let (stopped, _stopped_tmp) = seed_engine();
    stopped.mark_heatmap_dirty();
    let handle = stopped
        .generate_tiles_background()
        .expect("the pass starts");
    handle.cancel();
    let drawn = handle.recv_blocking().expect("the pass answers");

    assert!(
        handle.was_cancelled(),
        "the pass must report it stopped early"
    );
    assert!(
        drawn < full,
        "a cancelled pass drew {drawn} tiles and a whole pass drew {full}"
    );
}

/// A cancelled pass leaves the ground it did not draw owed to the next one.
/// Clearing the marker would leave the heatmap permanently half-drawn.
#[test]
fn a_cancelled_pass_leaves_the_set_dirty() {
    let _serial = serial();
    let (engine, _tmp) = seed_engine();
    engine.mark_heatmap_dirty();

    let handle = engine.generate_tiles_background().expect("the pass starts");
    handle.cancel();
    handle.recv_blocking().expect("the pass answers");

    assert!(
        engine.is_heatmap_dirty(),
        "a cancelled pass cleared the marker, so nothing will redraw what it skipped"
    );
}

/// The slot is structural, so a cancelled pass frees it the way a finished one
/// does and the next pass is not refused by the one the athlete stopped.
#[test]
fn the_slot_comes_back_after_a_cancel() {
    let _serial = serial();
    let (engine, _tmp) = seed_engine();
    engine.mark_heatmap_dirty();

    let first = engine.generate_tiles_background().expect("the pass starts");
    first.cancel();
    first.recv_blocking().expect("the pass answers");

    let second = engine
        .generate_tiles_background()
        .expect("the slot came back, so the next pass starts");
    second.recv_blocking().expect("the second pass completes");
}

/// A pass nobody cancelled finishes and says so, which is what keeps the two
/// outcomes distinguishable.
#[test]
fn an_uncancelled_pass_reports_a_clean_finish() {
    let _serial = serial();
    let (engine, _tmp) = seed_engine();
    engine.mark_heatmap_dirty();

    let handle = engine.generate_tiles_background().expect("the pass starts");
    handle.recv_blocking().expect("the pass completes");

    assert!(!handle.was_cancelled());
    assert!(
        !engine.is_heatmap_dirty(),
        "a finished pass clears the marker"
    );
}

/// The token is the house shape, so its own contract is pinned here rather
/// than only through a pass that happens to use it.
#[test]
fn the_token_is_shared_and_latches() {
    let token = CancelToken::new();
    let copy = token.clone();

    assert!(!token.is_cancelled());
    copy.cancel();
    assert!(token.is_cancelled(), "a clone must cancel the original");
    copy.cancel();
    assert!(token.is_cancelled(), "a second cancel must not unset it");
}
