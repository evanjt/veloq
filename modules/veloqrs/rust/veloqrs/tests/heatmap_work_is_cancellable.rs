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
//! Every cancel lands on a pass held just before it draws, so the cancel is in
//! place before the first tile whatever the machine's load. The pass slot, the
//! handle slot and the hold are process-global, so these take `SERIAL`.
//!
//! Run: `cargo test --features synthetic --test heatmap_synthetic -p veloqrs -- heatmap_work_is_cancellable::`

use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::tiles::{
    clear_tile_set, hold_next_tile_pass, hold_next_tile_pass_inside_a_tile,
};
use veloqrs::persistence::{CancelToken, TileGenerationHandle, WorkerPoll, clear_all_background};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// Start a pass, wait until it has scheduled its tiles and is about to draw,
/// cancel it there, and let it go. The cancel is in place before any tile.
fn cancel_before_drawing(engine: &PersistentEngine) -> TileGenerationHandle {
    let hold = hold_next_tile_pass();
    let handle = engine.generate_tiles_background().expect("the pass starts");
    hold.wait_until_reached();
    let (_, scheduled) = handle.get_progress();
    assert!(scheduled > 0, "the held pass scheduled no tiles to cancel");
    handle.cancel();
    hold.release();
    handle
}

/// Small, since the hold rather than the size of the pass is what gives a
/// cancel something in flight to land on.
fn seed_engine() -> (PersistentEngine, TempDir) {
    let cfg = LifecycleConfig {
        bucket_a_count: 12,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
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
        && let Some(handle) = guard.take()
    {
        handle.recv_blocking();
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
    let _serial_state = super::serial_state();
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
    let handle = cancel_before_drawing(&stopped);
    let drawn = handle.recv_blocking().expect("the pass answers");

    assert!(
        handle.was_cancelled(),
        "the pass must report it stopped early"
    );
    assert_eq!(
        drawn, 0,
        "a pass cancelled before its first tile drew {drawn} tiles, a whole pass drew {full}"
    );
}

/// A cancelled pass leaves the ground it did not draw owed to the next one.
/// Clearing the marker would leave the heatmap permanently half-drawn.
#[test]
fn a_cancelled_pass_leaves_the_set_dirty() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let (engine, _tmp) = seed_engine();
    engine.mark_heatmap_dirty();

    let handle = cancel_before_drawing(&engine);
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
    let _serial_state = super::serial_state();
    let _serial = serial();
    let (engine, _tmp) = seed_engine();
    engine.mark_heatmap_dirty();

    let first = cancel_before_drawing(&engine);
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
    let _serial_state = super::serial_state();
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

/// Every tile file under `tiles`, the no-coverage markers included.
fn tiles_on_disk(tiles: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    let mut dirs: Vec<std::path::PathBuf> = std::fs::read_dir(tiles)
        .map(|entries| entries.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    while let Some(path) = dirs.pop() {
        if path.is_dir() {
            dirs.extend(
                std::fs::read_dir(&path)
                    .expect("read")
                    .flatten()
                    .map(|e| e.path()),
            );
        } else if path.parent() != Some(tiles) {
            found.push(path);
        }
    }
    found
}

/// Scenario: athlete A's tile pass is drawing when B's sign-in wipe lands.
/// The wipe deleted the set and the pass, still running, wrote more of A's
/// tiles into it. The next pass skips a tile that exists, so those stayed on
/// disk for B's map to serve.
///
/// Expected behaviour: the wipe stops the pass and waits for it to end before
/// it deletes, so nothing of A's is on disk once the wipe has answered.
///
/// The pass is held inside a tile, past its cancel check, and let go only once
/// the wipe has either answered or asked it to stop. That tile is saved after
/// the cancel whatever happens, so a wipe that cancels without waiting deletes
/// before it and leaves it on disk.
#[test]
fn a_wipe_stops_a_running_pass_before_it_deletes() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let (engine, tmp) = seed_engine();
    engine.mark_heatmap_dirty();
    let tiles = tmp.path().join("tiles");
    // The login screen's wipe: the global engine names no tiles path, so the
    // directory it is handed is the one it wipes.
    let db = tmp.path().join("global.db");
    assert!(persistent_engine_init(
        db.to_str().expect("utf-8").to_string()
    ));

    let hold = hold_next_tile_pass_inside_a_tile();
    let pass = engine.generate_tiles_background().expect("the pass starts");
    hold.wait_until_reached();
    let wipe = clear_all_background(Some(tiles.to_string_lossy().into_owned()));

    let outcome = loop {
        match wipe.poll_state() {
            WorkerPoll::Ready(outcome) => break Some(outcome),
            WorkerPoll::Died => panic!("the wipe thread died"),
            WorkerPoll::Running if pass.was_cancelled() => break None,
            WorkerPoll::Running => std::thread::yield_now(),
        }
    };
    hold.release();
    let outcome = outcome.unwrap_or_else(|| wipe.wait());
    pass.recv_blocking().expect("the pass answers");

    outcome.expect("the wipe");
    let left = tiles_on_disk(&tiles);
    assert!(
        left.is_empty(),
        "{} of A's tiles were written after the wipe, first {:?}",
        left.len(),
        left.first()
    );
    assert!(pass.was_cancelled(), "the wipe left A's pass running");
}

/// Scenario: a tile pass is drawing when the athlete taps Clear cache or turns
/// the heatmap off. The set was emptied and the pass, still running, saved the
/// tile it had in flight. The next pass skips a tile that exists, so the heat
/// it drew stayed on disk however the library changed.
///
/// Expected behaviour: the clear stops the pass and waits for it to end before
/// it deletes, so nothing is on disk once the clear has answered.
#[test]
fn a_clear_stops_a_running_pass_before_it_deletes() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let (engine, tmp) = seed_engine();
    engine.mark_heatmap_dirty();
    let tiles = tmp.path().join("tiles");

    let hold = hold_next_tile_pass_inside_a_tile();
    let pass = engine.generate_tiles_background().expect("the pass starts");
    hold.wait_until_reached();
    let clearing = tiles.clone();
    let clear = std::thread::spawn(move || clear_tile_set(&clearing));

    while !clear.is_finished() && !pass.was_cancelled() {
        std::thread::yield_now();
    }
    hold.release();
    let outcome = clear.join().expect("the clear thread");
    pass.recv_blocking().expect("the pass answers");

    outcome.expect("the clear");
    let left = tiles_on_disk(&tiles);
    assert!(
        left.is_empty(),
        "{} tiles were written after the clear, first {:?}",
        left.len(),
        left.first()
    );
    assert!(pass.was_cancelled(), "the clear left the pass running");
}

/// The token is the house shape, so its own contract is pinned here rather
/// than only through a pass that happens to use it.
#[test]
fn the_token_is_shared_and_latches() {
    let _serial_state = super::serial_state();
    let token = CancelToken::new();
    let copy = token.clone();

    assert!(!token.is_cancelled());
    copy.cancel();
    assert!(token.is_cancelled(), "a clone must cancel the original");
    copy.cancel();
    assert!(token.is_cancelled(), "a second cancel must not unset it");
}
