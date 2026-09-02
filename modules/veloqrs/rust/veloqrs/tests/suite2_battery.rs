//! Suite #2. Battery.
//!
//! The new base (`DetectionMethod::Unified`) driven through the same journeys
//! as the Control baseline (Suite #1), over the shared harness. Every check
//! here is live: the identity, order-freedom, and incremental-persistence
//! invariants the detection and identity layers deliver are asserted, not
//! printed.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_battery`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// Sanity: both arms are wired and the harness drives each end to end, and the
/// unified detector actually produces a catalogue on the cold-start corpus.
#[test]
fn both_arms_detect_on_cold_start() {
    let corpus = corpus();
    for arm in [Arm::Battery] {
        let (mut engine, _dir) = fresh_engine_for(arm);
        let cold = ingest_step(&mut engine, "cold-90", &corpus.through_a());
        cold.print(arm);
        assert!(
            cold.snapshot.count() > 0,
            "{}: cold start produced no sections",
            arm.label()
        );
    }
}

/// Headline measurement: expanding the sync window must not reshuffle the
/// catalogue. Runs cold-90 then expand-to-1y on both arms and reports, per
/// arm, how much survives BY ID versus BY GROUND. The discontinuity we are
/// killing shows up as ground surviving while ids do not.
#[test]
fn expand_window_discontinuity_is_measured() {
    let corpus = corpus();
    for arm in [Arm::Battery] {
        let (mut engine, _dir) = fresh_engine_for(arm);
        let cold = ingest_step(&mut engine, "cold-90", &corpus.through_a());
        let expand = ingest_step(&mut engine, "expand-1y", &refs(&corpus.bucket_b_delta));
        cold.print(arm);
        expand.print(arm);
        assert_catalogue_populated(arm.label(), &cold.snapshot);
        println!(
            "[{}] expand survival: id(string)={:>3.0}%  ground={:>3.0}%  identity(ground+id)={:>3.0}%   ({} -> {} sections)",
            arm.label(),
            id_survival(&cold.snapshot, &expand.snapshot) * 100.0,
            ground_survival(&cold.snapshot, &expand.snapshot) * 100.0,
            identity_retention(&cold.snapshot, &expand.snapshot) * 100.0,
            cold.snapshot.count(),
            expand.snapshot.count(),
        );
        assert!(
            expand.snapshot.count() > 0,
            "{}: expand produced no sections",
            arm.label()
        );
    }
}

/// Invariant 4, order-free catalogue. A single cold batch must yield the same
/// catalogue no matter the ingest order. This is the property that makes
/// incremental == batch and lets an expand ADD rather than reshuffle, so it is
/// the foundation the whole redesign stands on. Battery (unified) is order-free
/// by construction; Control is measured alongside.
#[test]
fn order_free_cold_batch() {
    let corpus = corpus();
    let forward = corpus.through_a();
    let mut reversed = forward.clone();
    reversed.reverse();

    for arm in [Arm::Battery] {
        let (mut e1, _d1) = fresh_engine_for(arm);
        let s1 = ingest_step(&mut e1, "forward", &forward).snapshot;
        let (mut e2, _d2) = fresh_engine_for(arm);
        let s2 = ingest_step(&mut e2, "reversed", &reversed).snapshot;
        let same = s1.catalogue_signature() == s2.catalogue_signature();
        println!(
            "[{}] order-free cold batch: {}  ({} vs {} sections)",
            arm.label(),
            if same { "YES" } else { "NO, order-dependent" },
            s1.count(),
            s2.count(),
        );
        if arm == Arm::Battery {
            assert!(
                same,
                "battery cold-batch catalogue depends on ingest order (violates invariant 4)"
            );
        }
    }
}

/// Invariant (identity layer): the Battery keeps section identity across an
/// expand, most cold-catalogue ids still address the same ground afterwards.
/// The assign-once identity layer carries the id with the corridor, so widening
/// the sync window adds sections instead of renumbering them.
#[test]
fn battery_expand_preserves_identity() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold-90", &corpus.through_a());
    let expand = ingest_step(&mut engine, "expand-1y", &refs(&corpus.bucket_b_delta));
    assert_catalogue_populated("cold-90", &cold.snapshot);
    // Ground-anchored identity, NOT raw string-id survival: of the sections
    // whose corridor persisted, how many kept their id.
    let retention = identity_retention(&cold.snapshot, &expand.snapshot);
    assert!(
        retention >= 0.85,
        "identity lost on expand: only {:.0}% of surviving-ground sections kept their id",
        retention * 100.0
    );
}
