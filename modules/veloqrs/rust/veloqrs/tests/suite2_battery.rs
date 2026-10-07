//! Suite #2. Battery.
//!
//! The detector driven through the lifecycle journeys over the shared harness.
//! Every check here is live: the identity, order-freedom, and incremental-persistence
//! invariants the detection and identity layers deliver are asserted, not
//! printed.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2 -- suite2_battery::`

use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

use crate::lifecycle_support::*;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// Invariant (identity layer): the Battery keeps section identity across an
/// expand, most cold-catalogue ids still address the same ground afterwards.
/// The assign-once identity layer carries the id with the corridor, so widening
/// the sync window adds sections instead of renumbering them.
#[test]
fn battery_expand_preserves_identity() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine();
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
