//! Playback (drip) against batch: if activities arrive one at a time (the
//! daily drip) instead of one big batch, does the catalogue converge to the
//! from-scratch batch answer? The cost of each is the `playback_vs_batch_cost`
//! bench.

use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

use crate::lifecycle_support::*;

/// Target gate (order-free incremental): the drip MUST converge to the batch
/// catalogue exactly. Sync delivers one ride at a time, so the same rides played
/// one by one and ingested as one batch must draw the same ground, on the
/// detector's own catalogue and again on the view once the debounce has run out.
/// Ground-based so it survives id renumbering. Extra drip sections fail it as
/// surely as missing ones.
///
/// The corpus is deliberately small (24 activities): this default corpus is a
/// single home geography = one cluster, and a single-cluster drip recomputes the
/// whole cluster on every add (O(N) per add, O(N^2) over the drip) even with the
/// cache, so 24 activities keeps the drip to seconds in debug. 24 activities
/// still form real corridors, so the contract stays live. The 60-activity
/// version is the `playback_vs_batch_cost` bench.
#[test]
fn playback_converges_to_batch() {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 24,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        ..LifecycleConfig::default()
    });
    let all = corpus.through_a();
    let (mut eb, _db) = fresh_engine();
    let batch = ingest_step(&mut eb, "batch", &all);
    assert_catalogue_populated("batch", &batch.snapshot);
    let (mut ep, _dp) = fresh_engine();
    for a in all.iter().copied() {
        ingest_step(&mut ep, "play", &[a]);
    }

    let drip_raw = raw_snapshot(&ep);
    let batch_raw = raw_snapshot(&eb);
    assert_eq!(
        ground(&drip_raw),
        ground(&batch_raw),
        "the detector's own catalogues differ: drip {} sections, batch {}",
        drip_raw.sections.len(),
        batch_raw.sections.len()
    );

    let drip_rounds = settle_to_detector(&mut ep, 8);
    let batch_rounds = settle_to_detector(&mut eb, 8);
    let drip_settled = snapshot(&mut ep);
    let batch_settled = snapshot(&mut eb);
    assert_eq!(
        ground(&drip_settled),
        ground(&batch_settled),
        "the settled views differ: drip {} sections after {} rounds, batch {} after {}",
        drip_settled.sections.len(),
        drip_rounds,
        batch_settled.sections.len(),
        batch_rounds
    );
    assert!(
        drip_rounds <= 8 && batch_rounds <= 8,
        "a view had not caught up with the detector when settle gave up: drip {drip_rounds}, batch {batch_rounds}"
    );
}
