//! Tier 0.5 — `apply_sections` atomicity baseline.
//!
//! Locks in the rollback contract from the 2026-02-07 section-crash fix,
//! before Tier 1.1 rewires the lock and write-tail boundaries. The
//! contract: if `apply_sections` fails partway through, the engine's
//! observable state must be either pre-call or post-call — never
//! half-applied.
//!
//! We trigger a failure by handing `apply_sections` a section vec that
//! contains duplicate IDs. `save_sections` will hit a `UNIQUE constraint
//! failed: sections.id`, the SQLite transaction rolls back, and the
//! in-memory `self.sections` is restored from the pre-call snapshot. After
//! the failed call, every read should return what it returned before.
//!
//! This test does NOT modify production code (no feature-gated `panic!`
//! injection). It uses the natural failure mode of duplicate IDs to drive
//! the rollback path.

#![cfg(feature = "synthetic")]

use std::collections::BTreeMap;

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn engine_with_b_state() -> (PersistentRouteEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("atomicity.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");

    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    for activity in corpus.through_b() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }

    let handle = engine.detect_sections_background(None);
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("initial apply");

    (engine, dir)
}

fn fingerprint(engine: &mut PersistentRouteEngine) -> BTreeMap<String, (u32, usize, String)> {
    engine
        .get_sections()
        .into_iter()
        .map(|s| {
            (
                s.id.clone(),
                (s.visit_count, s.activity_ids.len(), s.sport_type.clone()),
            )
        })
        .collect()
}

#[test]
fn apply_sections_rolls_back_on_duplicate_id() {
    let (mut engine, _tmp) = engine_with_b_state();

    let pre = fingerprint(&mut engine);
    assert!(
        !pre.is_empty(),
        "expected B-state to produce sections; nothing to test"
    );

    // Build a deliberately-broken sections vec by duplicating the first
    // section's id into the second slot. save_sections will hit the
    // UNIQUE PK on `sections.id`.
    let mut broken: Vec<_> = engine.get_sections().to_vec();
    assert!(
        broken.len() >= 2,
        "need at least two sections to construct a duplicate"
    );
    let dup_id = broken[0].id.clone();
    broken[1].id = dup_id.clone();

    let result = engine.apply_sections(broken);
    assert!(
        result.is_err(),
        "expected apply_sections to fail on duplicate ID, got {:?}",
        result
    );
    println!(
        "[atomicity] apply_sections returned expected Err: {:?}",
        result.err()
    );

    // After the failed apply, the engine's observable state must match the
    // pre-call snapshot — neither sections lost nor activity_ids drifted.
    let post = fingerprint(&mut engine);
    assert_eq!(
        post.len(),
        pre.len(),
        "section count changed after failed apply (rollback broken): pre={} post={}",
        pre.len(),
        post.len()
    );
    assert_eq!(
        post, pre,
        "fingerprints differ after failed apply — rollback did not restore state"
    );
}

#[test]
fn apply_sections_preserves_db_after_failure_then_succeeds_on_retry() {
    let (mut engine, _tmp) = engine_with_b_state();

    let pre = fingerprint(&mut engine);

    // Trigger the same failure as above.
    let mut broken: Vec<_> = engine.get_sections().to_vec();
    let dup_id = broken[0].id.clone();
    broken[1].id = dup_id;
    let _ = engine.apply_sections(broken);

    // Now re-run a real detection and apply — the engine must still be
    // healthy enough to do this. If save_sections left the DB in a
    // partial state, this would error.
    let handle = engine.detect_sections_background(None);
    let (sections, _) = handle.recv().unwrap_or_default();
    let retry = engine.apply_sections(sections);
    assert!(
        retry.is_ok(),
        "engine could not recover after a failed apply: {:?}",
        retry
    );

    let post = fingerprint(&mut engine);
    // The retry detection should converge to a similar shape; we don't
    // assert exact equality (detection isn't deterministic across separate
    // runs of the algorithm with the same inputs), but section count
    // shouldn't collapse.
    assert!(
        post.len() >= pre.len() / 2,
        "section count dropped catastrophically after retry: pre={} post={}",
        pre.len(),
        post.len()
    );
}
