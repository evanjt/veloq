//! What starting a detect costs the thread that asks for it.
//!
//! Every caller asks for a detect holding the engine lock, so whatever the
//! spawn copies before it hands off is paid by every reader queued behind it.
//! A routine sync that stores nothing new reaches the no-new-activities
//! short-circuit, and that run must not copy the evidence cache, the raw
//! catalogue or a per-activity table on the way there.
//!
//! Scenario: a library of 120 rides is detected and applied, then a detect is
//! asked for with nothing new, then one more ride arrives and is detected.
//!
//! Expected behaviour: the detect with nothing new allocates a bounded handful
//! on the asking thread and copies the evidence cache nowhere, leaving the
//! engine's cache the same allocation it was. The detect that folds the new
//! ride copies the cache once, on the worker, and the asking thread pays for
//! none of it.
//!
//! Run: `cargo test --features synthetic --test detection_spawn_allocations -p veloqrs`

#![cfg(feature = "synthetic")]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::{Arc, Mutex, MutexGuard};

use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

#[path = "lifecycle_support/mod.rs"]
mod lifecycle_support;

use lifecycle_support::*;

// ------------------------------------------------------------ allocator

// Counted per thread, so a detection worker's own allocations never reach the
// thread that asked for the run. Const-initialised and Drop-free, so the
// counter itself never allocates.
thread_local! {
    static ALLOCATED_BYTES: Cell<usize> = const { Cell::new(0) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

fn count(bytes: usize) {
    let _ = ALLOCATED_BYTES.try_with(|b| b.set(b.get() + bytes));
    let _ = ALLOCATIONS.try_with(|n| n.set(n.get() + 1));
}

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count(layout.size());
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        count(new_size.saturating_sub(layout.size()));
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// Bytes and allocations the calling thread made inside `body`.
fn on_this_thread<T>(body: impl FnOnce() -> T) -> (T, usize, usize) {
    let bytes = ALLOCATED_BYTES.with(Cell::get);
    let allocations = ALLOCATIONS.with(Cell::get);
    let out = body();
    (
        out,
        ALLOCATED_BYTES.with(Cell::get) - bytes,
        ALLOCATIONS.with(Cell::get) - allocations,
    )
}

// ------------------------------------------------------------ fixtures

/// The cache-copy counter is process-wide, so the two runs take turns.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

const LIBRARY: usize = 120;

/// What the asking thread may spend on a detect with nothing new: the
/// channels, the sorted id list the echo saves as processed, and the thread
/// that carries the echo, about 9 KB in 140 allocations at this size. A copy
/// of the raw catalogue is 81 KB in 772 allocations, and of the evidence cache
/// 3.4 MB in 22,000.
const SHORT_CIRCUIT_BYTES: usize = 32 * 1024;
const SHORT_CIRCUIT_ALLOCATIONS: usize = 500;

/// What the asking thread may spend starting a fold: the catalogue it folds
/// against and the per-activity tables, about 190 KB at this size, well short
/// of one copy of the evidence cache.
const FOLD_BYTES: usize = 1024 * 1024;

fn library() -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: LIBRARY,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

fn store(engine: &mut PersistentEngine, ride: &LifecycleActivity) {
    engine
        .add_activity(
            ride.id.clone(),
            ride.gps_points.clone(),
            ride.sport_type.clone(),
        )
        .expect("add_activity");
    engine
        .update_activity_metadata(&ride.id, Some(ride.start_date_unix), None, None, None)
        .expect("update_activity_metadata");
}

#[test]
fn a_detect_with_nothing_new_copies_nothing_on_the_asking_thread() {
    let _serial = serial();
    let rides = library();
    let (mut engine, _dir) = fresh_engine();
    let applied = ingest_step(&mut engine, "library", &refs(&rides));
    assert_catalogue_populated("library", &applied.snapshot);

    let (cache_before, _) = engine.shared_evidence_cache();
    let copies_before = PersistentEngine::evidence_cache_copies();

    let (handle, bytes, allocations) = on_this_thread(|| engine.detect_sections_background());

    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed) = main.expect("the echo answered");
    assert!(
        cache_update.is_none(),
        "the run folded, so it never reached the short-circuit"
    );
    engine.apply_sections(sections).expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");

    assert!(
        bytes < SHORT_CIRCUIT_BYTES && allocations < SHORT_CIRCUIT_ALLOCATIONS,
        "a detect with nothing new spent {bytes} bytes in {allocations} allocations on the asking thread"
    );
    assert_eq!(
        PersistentEngine::evidence_cache_copies(),
        copies_before,
        "a detect with nothing new copied the evidence cache"
    );
    assert!(
        Arc::ptr_eq(&cache_before, &engine.shared_evidence_cache().0),
        "the engine's evidence cache was replaced by a run that folded nothing"
    );
}

#[test]
fn a_detect_that_folds_copies_the_cache_once_and_off_the_asking_thread() {
    let _serial = serial();
    let rides = library();
    let (earlier, latest) = rides.split_at(rides.len() - 1);
    let (mut engine, _dir) = fresh_engine();
    ingest_step(&mut engine, "earlier", &refs(earlier));
    store(&mut engine, &latest[0]);

    let (cache_before, _) = engine.shared_evidence_cache();
    let copies_before = PersistentEngine::evidence_cache_copies();

    let (handle, bytes, allocations) = on_this_thread(|| engine.detect_sections_background());

    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed) = main.expect("the fold answered");
    assert!(
        cache_update.is_some(),
        "a fold over a new ride owes a cache"
    );
    let copies = PersistentEngine::evidence_cache_copies() - copies_before;
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply_sections_with_cache");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");

    // The asking thread still builds the fold's inputs, the catalogue and the
    // per-activity tables, but the cache it hands over is shared.
    assert!(
        bytes < FOLD_BYTES,
        "a folding detect spent {bytes} bytes in {allocations} allocations on the asking thread"
    );
    assert_eq!(copies, 1, "the worker folds into one copy of its own");
    assert!(
        !Arc::ptr_eq(&cache_before, &engine.shared_evidence_cache().0),
        "the applied fold left the engine on the cache it started from"
    );
}
