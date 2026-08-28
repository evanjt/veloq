//! Scenario: a Unified fold checkpoints mid-run, then sends the authoritative
//! evidence cache last.
//!
//! Expected behaviour: the blocking collector hands back the authoritative
//! update, not the first checkpoint. A checkpoint is a mid-fold snapshot with
//! clusters still dirty, `leaves` stripped, `folded_ids` already claiming the
//! whole pool and no `boundaries` at all. Adopting one as final makes the next
//! detect compute `pool - folded = {}` and reload everything anyway, and loses
//! every fork attribution the ledger reads.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;
use veloqrs::persistence::WorkerPoll;

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

fn seeded(dir: &TempDir) -> PersistentRouteEngine {
    let path = dir.path().join("final_cache.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    engine.load().expect("load");
    engine.set_section_config(SectionConfig::default());
    for a in corpus() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
    engine
}

/// Test premise. The observe closure skips only while `done < total`, so the
/// final call always sends a checkpoint ahead of the real update. Without one
/// in the channel the drain below would have nothing to skip and the test
/// would pass vacuously.
#[test]
fn a_fold_always_checkpoints_before_the_final_update() {
    let tmp = TempDir::new().unwrap();
    let mut engine = seeded(&tmp);

    let handle = engine.detect_sections_background();
    let ready = (0..600).any(|_| {
        if matches!(handle.poll_state(), WorkerPoll::Ready(_)) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        false
    });
    assert!(ready, "the run must produce a result");
    assert!(
        handle.take_checkpoint().is_some(),
        "premise: the worker sends at least one checkpoint per fold"
    );
}

/// The blocking collector must skip past every checkpoint to the authoritative
/// update. A single `try_recv` could only ever see the first one.
#[test]
fn recv_with_cache_returns_the_final_update_not_a_checkpoint() {
    let tmp = TempDir::new().unwrap();
    let mut engine = seeded(&tmp);

    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, _processed) = main.expect("the run must produce a result");
    assert!(!sections.is_empty(), "the corpus must cut some sections");

    let update = cache_update.expect("the Unified path must produce a cache update");
    assert!(
        !update.checkpoint,
        "a mid-fold checkpoint was adopted as the final evidence cache"
    );
    assert!(
        !update.boundaries.is_empty(),
        "the final update carries the fold's boundary records; a checkpoint carries none"
    );
}
