//! Tier 0.5, `apply_sections` atomicity + the B2 identity remap.
//!
//! Originally this locked in the rollback contract by handing `apply_sections`
//! a section vec with DUPLICATE ids to force a `UNIQUE constraint failed:
//! sections.id` and check the transaction rolled back. Since B2 that trigger is
//! void BY DESIGN: the identity registry drops the detector's throwaway ids and
//! assigns its own stable ones (or carries the existing stable id onto surviving
//! ground), so no caller-supplied duplicate can ever reach `save_sections`. That
//! collision is exactly the R2 crash B2 exists to eliminate, so the first test
//! now asserts the remap makes a duplicate-id vec HARMLESS.
//!
//! The rollback-on-real-failure contract itself is unchanged and still covered:
//! `suite2_engine_cache::apply_failure_drops_cache_then_recovers` forces a genuine
//! save failure (read-only DB) and verifies the engine rolls back and recovers,
//! and `suite2_concurrency_durability::crash_before_apply_recovers` guards the
//! mid-apply crash path. The second test here keeps the retry-after-a-no-op check.

#![cfg(feature = "synthetic")]

use std::collections::BTreeMap;

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

fn engine_with_b_state() -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("atomicity.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");

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

    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("initial apply");

    (engine, dir)
}

fn fingerprint(engine: &mut PersistentEngine) -> BTreeMap<String, (u32, usize, String)> {
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
fn apply_sections_remaps_duplicate_input_ids() {
    let (mut engine, _tmp) = engine_with_b_state();

    let pre = fingerprint(&mut engine);
    assert!(
        !pre.is_empty(),
        "expected B-state to produce sections; nothing to test"
    );

    // Duplicate the first section's id into the second slot. Pre-B2 this hit the
    // UNIQUE PK and rolled the apply back; under the identity registry the input
    // ids are thrown away, so the two DISTINCT grounds simply carry their own
    // stable ids and the apply succeeds, the R2 collision cannot occur.
    let mut broken: Vec<_> = engine.get_sections().to_vec();
    assert!(
        broken.len() >= 2,
        "need at least two sections to construct a duplicate"
    );
    let dup_id = broken[0].id.clone();
    broken[1].id = dup_id.clone();

    let result = engine.apply_sections(broken);
    assert!(
        result.is_ok(),
        "identity remap should absorb a duplicate input id, got {:?}",
        result
    );

    // Both grounds survive under DISTINCT stable ids (no section dropped by a
    // collision), and the catalogue stays consistent: same count as before, and
    // every id is unique.
    let post = fingerprint(&mut engine);
    assert_eq!(
        post.len(),
        pre.len(),
        "section count changed after a duplicate-id apply: pre={} post={}",
        pre.len(),
        post.len()
    );
    let unique_ids: std::collections::BTreeSet<&String> = post.keys().collect();
    assert_eq!(
        unique_ids.len(),
        post.len(),
        "duplicate ids leaked into the persisted catalogue"
    );
}

#[test]
fn apply_sections_preserves_db_after_failure_then_succeeds_on_retry() {
    let (mut engine, _tmp) = engine_with_b_state();

    let pre = fingerprint(&mut engine);

    // Apply a duplicate-id vec (a no-op collision-wise under the identity remap,
    // absorbed rather than crashing), then confirm the engine is still healthy.
    let mut broken: Vec<_> = engine.get_sections().to_vec();
    let dup_id = broken[0].id.clone();
    broken[1].id = dup_id;
    let _ = engine.apply_sections(broken);

    // Now re-run a real detection and apply, the engine must still be
    // healthy enough to do this. If save_sections left the DB in a
    // partial state, this would error.
    let handle = engine.detect_sections_background();
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
