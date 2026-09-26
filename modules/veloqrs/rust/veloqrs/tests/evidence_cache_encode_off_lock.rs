//! Scenario: a detection run finishes on a real library and applies. The
//! evidence cache is about 13 KB per activity, so encoding it is the expensive
//! half of filing it, and the final apply did that inside the engine write
//! lock while every reader waited.
//!
//! Expected behaviour: the worker encodes before it takes the lock, and the row
//! it hands in is byte-for-byte the row the under-lock path would have written.
//! A cache that files differently depending on who encoded it would resume the
//! next launch onto something the catalogue does not match.

#![cfg(feature = "synthetic")]

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

fn corpus() -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 24,
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

fn open(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("evidence.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.load().expect("load");
    engine.set_section_config(SectionConfig::default());
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

/// The stored row's digest and both blobs, which is everything the next launch
/// reads back.
fn stored_row(dir: &TempDir) -> Option<(String, Vec<u8>, Vec<u8>)> {
    let conn = Connection::open(dir.path().join("evidence.db")).expect("open");
    conn.query_row(
        "SELECT config_digest, folded_ids, cache FROM evidence_cache WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .ok()
}

/// One detection, and the two encodes of its cache put side by side.
///
/// Both have to read the same `CacheUpdate`, not two runs of the same corpus:
/// section ids are minted off the clock, so two engines cutting the same ground
/// at different moments agree on membership and not on bytes.
#[test]
fn the_worker_encode_and_the_under_lock_encode_write_the_same_row() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    ingest(&mut engine, &corpus());

    let handle = engine.detect_sections_background();
    let (main, update) = handle.recv_with_cache();
    let (sections, processed) = main.unwrap_or_default();
    let update = update.expect("the unified detector sent a cache");
    assert!(
        !update.folded_ids.is_empty(),
        "the detect folded nothing, so the rest proves nothing"
    );

    // The worker's encode, paid before any lock is taken.
    let on_worker = veloqrs::encode_evidence_row(
        &update.cache,
        &update.folded_ids,
        engine.evidence_config_digest(),
    )
    .expect("the cache encodes");

    // The under-lock encode, from the same cache.
    engine.persist_evidence_checkpoint(&update);
    let (digest, folded, cache) = stored_row(&dir).expect("the under-lock encode wrote a row");

    assert_eq!(on_worker.digest, digest, "the config digest moved");
    assert_eq!(on_worker.folded_blob, folded, "the folded-id shadow moved");
    assert_eq!(on_worker.cache_blob, cache, "the cache blob moved");
    assert!(
        cache.len() > 1_000,
        "the cache blob is {} bytes",
        cache.len()
    );

    // And the apply that hands the worker's row in files exactly that.
    engine
        .apply_sections_save_with_cache_row(sections, Some(update), Some(on_worker))
        .expect("apply");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
    engine.apply_sections_finalize();

    assert_eq!(
        stored_row(&dir).expect("the apply wrote an evidence row"),
        (digest, folded, cache),
        "the apply filed something other than the row it was handed"
    );
}

/// The apply still has to leave a cache the next launch can adopt. A byte
/// comparison alone would pass on a row nothing can read back.
#[test]
fn a_restart_resumes_warm_on_a_row_the_worker_encoded() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    ingest(&mut engine, &corpus());

    let handle = engine.detect_sections_background();
    let (main, update) = handle.recv_with_cache();
    let (sections, processed) = main.unwrap_or_default();
    let update = update.expect("the unified detector sent a cache");
    let row = veloqrs::encode_evidence_row(
        &update.cache,
        &update.folded_ids,
        engine.evidence_config_digest(),
    );

    engine
        .apply_sections_save_with_cache_row(sections, Some(update), row)
        .expect("apply");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
    engine.apply_sections_finalize();
    drop(engine);

    let restarted = open(&dir);

    assert!(
        restarted.evidence_cache_folded_count() > 0,
        "the restart came up cold on a row the worker encoded"
    );
}

/// The order is the whole point: the encode has to be paid before the apply
/// takes its lock. Read from the source, because a test cannot observe a lock
/// it does not hold, and the runtime enforcement is a deadlock rather than an
/// assertion.
#[test]
fn both_apply_sites_encode_before_they_take_the_lock() {
    for path in [
        "src/persistence/sections/detection.rs",
        "src/objects/detection.rs",
    ] {
        let source = std::fs::read_to_string(path).expect(path);
        let encode = source
            .find("let encoded = ")
            .unwrap_or_else(|| panic!("{path} does not encode the cache for its apply"));
        let apply = source
            .find("apply_sections_save_with_cache_row")
            .unwrap_or_else(|| panic!("{path} does not hand a row to its apply"));

        assert!(
            encode < apply,
            "{path} encodes the cache after taking the lock, which is what this fixed"
        );
        assert!(
            !source.contains("e.apply_sections_save_with_cache("),
            "{path} still calls the apply that encodes under the lock"
        );
    }
}
