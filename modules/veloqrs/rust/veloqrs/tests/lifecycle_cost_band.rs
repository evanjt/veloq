//! Scenario: a year's expansion on the synthetic lifecycle corpus, step by step.
//! Expected behaviour: the window expansion, the single add and the year's
//! remainder each stay inside a band of the baseline recorded beside the
//! corpora, and so does the apply tail. A step may get faster. The baseline
//! moves only on a rebase that gives its reason.
//!
//! Run: `cargo test --release -p veloqrs --features synthetic,real-corpus --test lifecycle_cost_band -- --nocapture`
//! Rebase: set `TRACEMATCH_BITWISE_REBASE` to the reason, after reading the report.

#![cfg(all(feature = "synthetic", feature = "real-corpus"))]

mod cost_band_support;
#[path = "lifecycle_support/mod.rs"]
mod lifecycle_support;

use cost_band_support::{Band, corpus, judge};
use lifecycle_support::*;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

const BASELINE: &str = "_lifecycle_baseline.txt";

/// A step is hundreds of milliseconds on a quiet machine, and the corpus is
/// generated, so only the clock moves between runs.
const BAND: Band = Band {
    time_factor: 1.5,
    time_floor_ms: 100,
    bytes_factor: 1.2,
    bytes_floor: 0,
};

#[test]
fn each_lifecycle_step_stays_inside_its_band() {
    let cfg = LifecycleConfig::default();
    let corpus_set = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine();

    ingest_step(&mut engine, "A", &corpus_set.through_a());
    let b = ingest_step(&mut engine, "B_expand", &refs(&corpus_set.bucket_b_delta));
    let c = ingest_step(&mut engine, "C_add", &[&corpus_set.bucket_c_single]);
    ingest_step(&mut engine, "D", &refs(&corpus_set.bucket_d_delta));
    let e = ingest_step(&mut engine, "E_year", &refs(&corpus_set.bucket_e_delta));
    for step in [&b, &c, &e] {
        step.print();
    }

    let shape = format!(
        "L {} {} {} {}",
        corpus_set.through_a().len(),
        corpus_set.bucket_b_delta.len(),
        corpus_set.bucket_d_delta.len(),
        corpus_set.bucket_e_delta.len()
    );
    judge(
        &corpus::root().join(BASELINE),
        &shape,
        &[
            ("perf_b_expand_ms", b.total_ms as u64),
            ("perf_c_single_add_ms", c.total_ms as u64),
            ("perf_e_year_ms", e.total_ms as u64),
            (
                "perf_apply_tail_ms",
                b.apply_ms.max(c.apply_ms).max(e.apply_ms) as u64,
            ),
        ],
        &BAND,
    );
}
