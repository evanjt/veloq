//! Suite #2: determinism (detector vs apply/persist).
//!
//! Decides two things the redesign needs settled: can the Suite #1 Control
//! golden be byte-frozen, and does the Battery (Unified) base give a
//! byte-stable anchor. It separates two nondeterminism sources:
//!
//! - DETECTOR: two fresh engines fed the identical set as a single cold batch.
//!   Any difference is the detector alone (no incremental/processed-id state).
//! - APPLY/PERSIST: re-run detect+apply over an already-processed set. The
//!   detector short-circuits (all ids processed, returns the existing sections
//!   verbatim), so any drift is the save/reload path, not detection.
//!
//! Both probes read `catalogue_signature()`, which is id-free and sorted, so
//! they measure GROUND determinism: a stable signature means the golden can be
//! frozen order-free. ID-assignment determinism is gated separately on the
//! visible view (`suite2_battery`, `suite2_multigeo_sport`).
//!
//! Persistence-layer + detector behaviour, run on both arms. Snapshots read the
//! user-visible DB view.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_determinism -- --include-ignored`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};

/// A small single-batch corpus for the cold-rebuild probes: 25 activities, one
/// bucket, kept fast so a probe can rebuild it many times.
fn small_corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 25,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    })
}

/// Build a fresh engine, ingest the set as a single cold batch, return the
/// visible catalogue. The engine and its temp DB are torn down on return, so
/// each call is fully independent.
fn cold_snapshot(arm: Arm, set: &[&LifecycleActivity]) -> SectionSnapshot {
    let (mut engine, _dir) = fresh_engine_for(arm);
    ingest_step(&mut engine, "cold", set).snapshot
}

// ============================================================================
// Probe 1: COLD-REBUILD DETERMINISM (detector, isolated)
// ============================================================================

/// Gate: the Battery cold-rebuild must be byte-stable in GROUND. A4 removed the
/// order-dependence inside `unified.rs`, so this should hold through the whole
/// stack and give the redesign a byte-frozen anchor. Live, not ignored. If it
/// ever goes red, apply/persist is injecting nondeterminism above a
/// deterministic detector, which is a serious regression.
#[test]
fn battery_cold_rebuild_is_byte_stable() {
    let corpus = small_corpus();
    let set = corpus.through_a();
    let a = cold_snapshot(Arm::Battery, &set);
    let b = cold_snapshot(Arm::Battery, &set);
    assert_eq!(
        a.catalogue_signature(),
        b.catalogue_signature(),
        "Battery cold-rebuild produced different catalogues from identical input \
         ({} vs {} sections). Nondeterminism above the unified detector",
        a.count(),
        b.count(),
    );
}

// ============================================================================
// Probe 2: RE-DETECT-SAME-SET DETERMINISM (apply/persist, isolated)
// ============================================================================

/// Force a second detect+apply cycle over an already-processed set. Detection
/// short-circuits (no new activities) and returns the existing sections, so the
/// only thing exercised is the save/reload path. Returns the before/after
/// snapshots and how many sections the detector handed back.
fn redetect_same_set(
    arm: Arm,
    set: &[&LifecycleActivity],
) -> (SectionSnapshot, SectionSnapshot, usize) {
    let (mut engine, _dir) = fresh_engine_for(arm);
    let before = ingest_step(&mut engine, "cold", set).snapshot;

    let handle = engine.detect_sections_background();
    let (sections, _processed) = handle.recv().unwrap_or_default();
    let returned = sections.len();
    engine.apply_sections(sections).expect("re-apply sections");
    let after = snapshot(&mut engine);
    (before, after, returned)
}

/// Gate: re-applying the same set on the Battery must leave the catalogue
/// byte-identical. Isolates apply/persist idempotence from detection. Live. A
/// failure means the save/reload path itself churns ids or ground.
#[test]
fn battery_redetect_same_set_is_stable() {
    let corpus = small_corpus();
    let set = corpus.through_a();
    let (before, after, _returned) = redetect_same_set(Arm::Battery, &set);
    assert_eq!(
        before.catalogue_signature(),
        after.catalogue_signature(),
        "Battery re-apply drifted the catalogue ({} -> {} sections). apply/persist is not idempotent",
        before.count(),
        after.count(),
    );
}
