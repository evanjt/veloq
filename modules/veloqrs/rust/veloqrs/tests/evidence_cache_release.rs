//! Scenario: the OS asks the engine for memory after a detect, and the
//! evidence cache the detect left resident is the largest thing it holds.
//!
//! Expected behaviour: when the stored row is the cache in memory, the release
//! drops the in-memory copy and the next detect restores it from the row,
//! landing the catalogue an engine that never released lands. When the row
//! does not hold that cache, because its write failed, the release keeps it,
//! since dropping a fold nothing stored costs a cold rebatch.
//!
//! Run: `cargo test --test evidence_cache_release -p veloqrs --features synthetic`

#![cfg(feature = "synthetic")]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::collections::BTreeSet;

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

// ------------------------------------------------------------ allocator

// Live bytes are counted per thread, so the tests of this file running in
// parallel do not count each other, and a block freed here that another
// thread allocated still counts against this one. Const-initialised and
// Drop-free, so the counter never allocates itself.
thread_local! {
    static LIVE_BYTES: Cell<isize> = const { Cell::new(0) };
}

fn add_bytes(delta: isize) {
    let _ = LIVE_BYTES.try_with(|live| live.set(live.get() + delta));
}

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        add_bytes(layout.size() as isize);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        add_bytes(-(layout.size() as isize));
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        add_bytes(new_size as isize - layout.size() as isize);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

fn live_bytes() -> isize {
    LIVE_BYTES.try_with(|live| live.get()).unwrap_or(0)
}

// ------------------------------------------------------------ fixtures

fn corpus() -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 24,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

fn db_path(dir: &TempDir) -> std::path::PathBuf {
    dir.path().join("evidence.db")
}

fn open(dir: &TempDir) -> PersistentEngine {
    let mut engine = PersistentEngine::new(db_path(dir).to_str().unwrap()).expect("engine");
    engine.load().expect("load");
    engine
        .set_section_config(SectionConfig::default())
        .expect("config accepted");
    engine
}

fn ingest(engine: &mut PersistentEngine, activities: &[LifecycleActivity]) {
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
}

fn detect(engine: &mut PersistentEngine) {
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed) = main.unwrap_or_default();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply_sections_with_cache");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
}

/// Every section's member set, order-free, so two engines that cut the same
/// catalogue at different moments agree.
fn catalogue(engine: &mut PersistentEngine) -> BTreeSet<BTreeSet<String>> {
    engine
        .get_sections()
        .iter()
        .map(|s| s.activity_ids.iter().cloned().collect())
        .collect()
}

fn stored_cache_bytes(dir: &TempDir) -> Option<usize> {
    let conn = Connection::open(db_path(dir)).expect("open");
    conn.query_row(
        "SELECT length(cache) FROM evidence_cache WHERE id = 1",
        [],
        |r| r.get::<_, i64>(0),
    )
    .ok()
    .map(|n| n as usize)
}

/// Make every write of the evidence row fail, as a full disk or a read-only
/// file would, while the catalogue tables still take theirs.
fn refuse_evidence_writes(dir: &TempDir) {
    let conn = Connection::open(db_path(dir)).expect("open");
    conn.execute_batch(
        "CREATE TRIGGER refuse_evidence_insert BEFORE INSERT ON evidence_cache
         BEGIN SELECT RAISE(ABORT, 'evidence writes refused'); END;
         CREATE TRIGGER refuse_evidence_update BEFORE UPDATE ON evidence_cache
         BEGIN SELECT RAISE(ABORT, 'evidence writes refused'); END;",
    )
    .expect("install the refusing triggers");
}

// ------------------------------------------------------------ tests

#[test]
fn a_release_drops_a_stored_cache_and_the_next_detect_restores_it() {
    let pool = corpus();
    let (head, tail) = pool.split_at(pool.len() - 1);

    let dir = TempDir::new().unwrap();
    let mut released = open(&dir);
    ingest(&mut released, head);
    detect(&mut released);
    let folded = released.evidence_cache_folded_count();
    assert!(
        folded > 0,
        "the detect folded nothing, so the rest proves nothing"
    );
    let stored = stored_cache_bytes(&dir).expect("the apply wrote an evidence row");
    assert_eq!(released.evidence_cache_decode_count(), 0);

    let before = live_bytes();
    assert!(released.release_evidence_cache(), "a stored cache was kept");
    let freed = before - live_bytes();

    assert!(
        freed >= stored as isize,
        "the release freed {freed} bytes, less than the {stored} byte row that stands in for them"
    );
    assert_eq!(
        released.evidence_cache_decode_count(),
        0,
        "the release read the row back"
    );

    let before = live_bytes();
    assert_eq!(
        released.evidence_cache_folded_count(),
        folded,
        "the restore after a release came back with another fold"
    );
    let restored = live_bytes() - before;
    assert_eq!(
        released.evidence_cache_decode_count(),
        1,
        "the cache was still resident after the release"
    );
    assert!(
        freed >= restored,
        "the release freed {freed} bytes and the restore brought back {restored}"
    );

    assert!(released.release_evidence_cache());
    ingest(&mut released, tail);
    detect(&mut released);
    assert_eq!(
        released.evidence_cache_decode_count(),
        2,
        "the detect after a release did not restore the stored cache"
    );
    assert_eq!(released.evidence_cache_folded_count(), pool.len());

    let kept_dir = TempDir::new().unwrap();
    let mut kept = open(&kept_dir);
    ingest(&mut kept, head);
    detect(&mut kept);
    ingest(&mut kept, tail);
    detect(&mut kept);
    assert_eq!(kept.evidence_cache_decode_count(), 0);

    assert_eq!(
        catalogue(&mut released),
        catalogue(&mut kept),
        "a detect resumed from a released cache disagrees with one that kept it"
    );
}

#[test]
fn a_second_release_has_nothing_left_to_drop() {
    let pool = corpus();
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    ingest(&mut engine, &pool);
    detect(&mut engine);

    assert!(engine.release_evidence_cache());
    assert!(
        !engine.release_evidence_cache(),
        "a released cache was released again"
    );
    assert_eq!(engine.evidence_cache_decode_count(), 0);
    assert_eq!(engine.evidence_cache_folded_count(), pool.len());
    assert_eq!(engine.evidence_cache_decode_count(), 1);
}

#[test]
fn a_cold_engine_has_no_cache_to_release() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    ingest(&mut engine, &corpus());

    assert!(!engine.release_evidence_cache());
    assert_eq!(engine.evidence_cache_folded_count(), 0);
    assert_eq!(engine.evidence_cache_decode_count(), 0);
}

#[test]
fn a_cache_whose_write_failed_is_kept_and_the_next_detect_stays_warm() {
    let pool = corpus();
    let (head, tail) = pool.split_at(pool.len() - 1);

    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    refuse_evidence_writes(&dir);
    ingest(&mut engine, head);
    detect(&mut engine);
    assert!(
        stored_cache_bytes(&dir).is_none(),
        "the refused write still stored a row, so this is not a failed-write test"
    );

    let before = live_bytes();
    assert!(
        !engine.release_evidence_cache(),
        "a cache no row holds was released"
    );
    assert_eq!(live_bytes(), before, "the kept cache still lost memory");
    assert_eq!(engine.evidence_cache_folded_count(), head.len());

    ingest(&mut engine, tail);
    detect(&mut engine);
    assert_eq!(engine.evidence_cache_folded_count(), pool.len());
    assert_eq!(
        engine.evidence_cache_decode_count(),
        0,
        "the detect after a kept release went to the row"
    );
}

#[test]
fn a_stored_row_overwritten_by_a_failed_write_keeps_the_newer_cache() {
    let pool = corpus();
    let (head, tail) = pool.split_at(pool.len() - 1);

    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    ingest(&mut engine, head);
    detect(&mut engine);
    assert!(stored_cache_bytes(&dir).is_some());

    refuse_evidence_writes(&dir);
    ingest(&mut engine, tail);
    detect(&mut engine);
    assert_eq!(engine.evidence_cache_folded_count(), pool.len());

    assert!(
        !engine.release_evidence_cache(),
        "a fold newer than the stored row was released"
    );
    assert_eq!(engine.evidence_cache_folded_count(), pool.len());
    assert_eq!(engine.evidence_cache_decode_count(), 0);
}
