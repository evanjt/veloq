//! Suite #2 — Battery.
//!
//! The new base (`DetectionMethod::Unified`) driven through the same journeys
//! as the Control baseline (Suite #1), over the shared harness. Live checks
//! pass today; identity, incremental-persistence, hysteresis, and concurrency
//! assertions are `#[ignore]` target gates that flip green as B1/B2/B4 land.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_battery -- --nocapture`

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
    for arm in [Arm::Control, Arm::Battery] {
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
    for arm in [Arm::Control, Arm::Battery] {
        let (mut engine, _dir) = fresh_engine_for(arm);
        let cold = ingest_step(&mut engine, "cold-90", &corpus.through_a());
        let expand = ingest_step(&mut engine, "expand-1y", &refs(&corpus.bucket_b_delta));
        cold.print(arm);
        expand.print(arm);
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

/// Target gate (B2 identity layer): the Battery keeps section identity across
/// an expand — most cold-catalogue ids still address the same ground
/// afterwards. Fails today because ids are still positional and renumber on
/// every set change; flips green when the assign-once identity layer lands.
#[test]
#[ignore = "B2 identity layer not built yet — target gate"]
fn battery_expand_preserves_identity() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold-90", &corpus.through_a());
    let expand = ingest_step(&mut engine, "expand-1y", &refs(&corpus.bucket_b_delta));
    // Ground-anchored identity, NOT raw string-id survival: of the sections
    // whose corridor persisted, how many kept their id.
    let retention = identity_retention(&cold.snapshot, &expand.snapshot);
    assert!(
        retention >= 0.85,
        "identity lost on expand: only {:.0}% of surviving-ground sections kept their id",
        retention * 100.0
    );
}
