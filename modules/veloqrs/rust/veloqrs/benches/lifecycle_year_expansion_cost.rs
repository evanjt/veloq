//! What each step of a year's expansion costs, measured rather than asserted.
//!
//! Five steps over about 550 activities: the cold set, the window expansion,
//! one added activity, a small batch, and the year's remainder. Every step
//! prints its ingest, detection and apply time and the final step prints how
//! many sections disappeared, appeared or lost activities.
//!
//! Ignored by default, it takes about 15 s in debug and 3 s in release. Run:
//! `cargo test --bench lifecycle_year_expansion_cost -p veloqrs --features synthetic --release -- --ignored --nocapture`

#![cfg(feature = "synthetic")]

#[path = "../tests/lifecycle_support/mod.rs"]
mod lifecycle_support;

use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

use lifecycle_support::*;

#[test]
#[ignore = "about 15 s in debug; run it deliberately, in release"]
fn year_expansion_step_costs() {
    let arm = Arm::Battery;
    let cfg = LifecycleConfig::default();
    let corpus = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine_for(arm);

    let step_a = ingest_step(&mut engine, "E_step1_A", &corpus.through_a());
    let step_b = ingest_step(&mut engine, "E_step2_B", &refs(&corpus.bucket_b_delta));
    let step_c = ingest_step(&mut engine, "E_step3_C", &[&corpus.bucket_c_single]);
    let step_d = ingest_step(&mut engine, "E_step4_D", &refs(&corpus.bucket_d_delta));
    let step_e = ingest_step(&mut engine, "E_step5_E", &refs(&corpus.bucket_e_delta));
    for step in [&step_a, &step_b, &step_c, &step_d, &step_e] {
        step.print(arm);
    }

    let delta = measure_delta(&step_d.snapshot, &step_e.snapshot);
    print_delta(arm, "E_step5_E", &delta);
}
