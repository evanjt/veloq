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
//! Two lenses, because they answer different questions:
//! - `catalogue_signature()` is id-free and sorted, so it measures GROUND
//!   determinism. A stable signature means the golden can be frozen order-free.
//! - `identity_retention` measures ID-assignment determinism. Stable ground
//!   with unstable ids means the ground can be frozen but ids cannot.
//!
//! Persistence-layer + detector behaviour, run on both arms. Snapshots read the
//! user-visible DB view.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_determinism -- --nocapture --include-ignored`

mod lifecycle_support;

use lifecycle_support::*;
use std::collections::BTreeSet;
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

/// A corpus with an expand delta, for reproducing the a->b identity flake. The
/// expand adds 45 of 75 (> 50%), so the resync takes the FULL-detect path, as
/// the default corpus does.
fn evo_corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 45,
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

/// Number of distinct signatures in a run of builds. 1 means byte-stable.
fn distinct_signatures(snaps: &[SectionSnapshot]) -> usize {
    snaps
        .iter()
        .map(|s| s.catalogue_signature())
        .collect::<BTreeSet<_>>()
        .len()
}

// ============================================================================
// Probe 1: COLD-REBUILD DETERMINISM (detector, isolated)
// ============================================================================

/// Measurement: rebuild the same cold set from scratch K times per arm. Prints
/// how many distinct GROUND signatures result (1 = byte-stable detector) and
/// the id-assignment stability (`identity_retention` of each build against the
/// first). Ground vs id are reported separately so the verdict can name which.
#[test]
fn cold_rebuild_determinism_today() {
    let corpus = small_corpus();
    let set = corpus.through_a();
    const K: usize = 5;

    for arm in [Arm::Control, Arm::Battery] {
        let snaps: Vec<SectionSnapshot> = (0..K).map(|_| cold_snapshot(arm, &set)).collect();
        let distinct = distinct_signatures(&snaps);
        let counts: Vec<usize> = snaps.iter().map(|s| s.count()).collect();
        let irs: Vec<String> = snaps
            .iter()
            .map(|s| format!("{:.2}", identity_retention(&snaps[0], s)))
            .collect();
        println!(
            "[{}] cold-rebuild x{K}: distinct GROUND signatures = {distinct}/{K} \
             (1 = byte-stable), section counts = {counts:?}, \
             identity_retention vs build0 = [{}]",
            arm.label(),
            irs.join(", "),
        );
    }
}

/// Gate: the Control cold-rebuild must be byte-stable in GROUND (two
/// independent builds of the same set produce the identical order-free
/// signature). This is the precondition for freezing the Suite #1 golden.
#[test]
#[ignore = "Corridor is not byte-stable on identical input: a section's sport_type flips run-to-run (nondeterministic cross-sport-merge primary selection on a tie), and the expand shows broader ground variance, so the Suite #1 golden cannot be byte-frozen, only order-free-tolerant"]
fn control_cold_rebuild_is_byte_stable() {
    let corpus = small_corpus();
    let set = corpus.through_a();
    let a = cold_snapshot(Arm::Control, &set);
    let b = cold_snapshot(Arm::Control, &set);
    assert_eq!(
        a.catalogue_signature(),
        b.catalogue_signature(),
        "Control cold-rebuild produced different catalogues from identical input \
         ({} vs {} sections). The detector itself is nondeterministic",
        a.count(),
        b.count(),
    );
}

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
fn redetect_same_set(arm: Arm, set: &[&LifecycleActivity]) -> (SectionSnapshot, SectionSnapshot, usize) {
    let (mut engine, _dir) = fresh_engine_for(arm);
    let before = ingest_step(&mut engine, "cold", set).snapshot;

    let handle = engine.detect_sections_background(None);
    let (sections, _processed) = handle.recv().unwrap_or_default();
    let returned = sections.len();
    engine.apply_sections(sections).expect("re-apply sections");
    let after = snapshot(&mut engine);
    (before, after, returned)
}

/// Measurement: re-apply the same set on each arm and print whether the
/// catalogue drifts. A byte-identical before/after says the apply/persist path
/// is idempotent; drift here would be a persistence bug independent of the
/// detector.
#[test]
fn redetect_same_set_today() {
    let corpus = small_corpus();
    let set = corpus.through_a();

    for arm in [Arm::Control, Arm::Battery] {
        let (before, after, returned) = redetect_same_set(arm, &set);
        println!(
            "[{}] re-detect same set: detector returned {returned} sections (short-circuit), \
             signature identical = {}, identity_retention = {:.2}, counts {} -> {}",
            arm.label(),
            before.catalogue_signature() == after.catalogue_signature(),
            identity_retention(&before, &after),
            before.count(),
            after.count(),
        );
    }
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

// ============================================================================
// Probe 3: REPRODUCE THE a->b IDENTITY FLAKE
// ============================================================================

/// Measurement: run the cold-a -> resync-b journey five times on the Control
/// arm and report the spread of `identity_retention(a, b)` (seen swinging 0.00
/// to 0.17). Also counts distinct cold-a and b GROUND signatures across the
/// runs, which localises the flake: a varying cold-a signature is a
/// nondeterministic detector; a stable signature with a swinging retention is
/// nondeterministic id assignment.
#[test]
fn ab_flake_spread_today() {
    let corpus = evo_corpus();
    let a_set = corpus.through_a();
    let b_set = refs(&corpus.bucket_b_delta);
    const RUNS: usize = 5;

    let mut irs = Vec::with_capacity(RUNS);
    let mut sig_a = Vec::with_capacity(RUNS);
    let mut sig_b = Vec::with_capacity(RUNS);

    for run in 0..RUNS {
        let (mut engine, _dir) = fresh_engine_for(Arm::Control);
        let s_a = ingest_step(&mut engine, "a/cold", &a_set).snapshot;
        let s_b = ingest_step(&mut engine, "b/expand", &b_set).snapshot;
        let ir = identity_retention(&s_a, &s_b);
        println!(
            "[control] run {run}: identity_retention(a,b) = {ir:.2}, a_count={}, b_count={}",
            s_a.count(),
            s_b.count(),
        );
        irs.push(ir);
        sig_a.push(s_a.catalogue_signature());
        sig_b.push(s_b.catalogue_signature());
    }

    let min = irs.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = irs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let distinct_a = sig_a.iter().collect::<BTreeSet<_>>().len();
    let distinct_b = sig_b.iter().collect::<BTreeSet<_>>().len();
    println!(
        "[control] a->b flake over {RUNS} runs: identity_retention spread [{min:.2}, {max:.2}]; \
         distinct cold-a signatures = {distinct_a}/{RUNS} (>1 = cold detect is ground-nondeterministic); \
         distinct b signatures = {distinct_b}/{RUNS}",
    );
}
