//! Playback (drip) against batch cost, measured rather than asserted.
//!
//! If activities arrive one at a time (the daily drip) instead of one big
//! batch, what does it cost, and does a single add get dearer as the library
//! grows? The drip's convergence to the batch catalogue is a test,
//! `playback_converges_to_batch`; this target prints the cost.
//!
//! Ignored by default: it drives detection dozens of times. Run in release,
//! since debug is about 40x inflated:
//! `cargo test --bench playback_vs_batch_cost -p veloqrs --features synthetic --release -- --ignored --nocapture`

#![cfg(feature = "synthetic")]

#[path = "../tests/lifecycle_support/mod.rs"]
mod lifecycle_support;

use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

use lifecycle_support::*;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// Drip the whole cold set in one activity at a time, versus ingesting it as a
/// single batch. Reports total detect + persist cost each way, the per-add
/// timing curve (does a single add get dearer as the library grows?), and
/// whether the drip catalogue converges to the batch catalogue.
#[test]
#[ignore = "benchmark, run explicitly with --release"]
fn playback_vs_batch_cold_set() {
    let corpus = corpus();
    let all = corpus.through_a();
    println!("\n=== playback vs batch over {} activities ===", all.len());

    for arm in [Arm::Battery] {
        // Batch: the whole set at once.
        let (mut eb, _db) = fresh_engine_for(arm);
        let batch = ingest_step(&mut eb, "batch", &all);

        // Playback: one activity at a time, detection + apply after every add.
        let (mut ep, _dp) = fresh_engine_for(arm);
        let mut detect_total = 0u128;
        let mut apply_total = 0u128;
        let mut curve: Vec<(usize, u128)> = Vec::new();
        let marks = [
            0usize,
            all.len() / 4,
            all.len() / 2,
            3 * all.len() / 4,
            all.len() - 1,
        ];
        for (i, a) in all.iter().copied().enumerate() {
            let m = ingest_step(&mut ep, "play", &[a]);
            detect_total += m.detection_ms;
            apply_total += m.apply_ms;
            if marks.contains(&i) {
                curve.push((i + 1, m.detection_ms));
            }
        }
        let play = snapshot(&mut ep);

        let parity = play.catalogue_signature() == batch.snapshot.catalogue_signature();
        assert_catalogue_populated(arm.label(), &batch.snapshot);
        let converged = ground_survival(&batch.snapshot, &play);
        println!(
            "[{}] BATCH   detect={:>6}ms apply={:>5}ms  ({} sections)",
            arm.label(),
            batch.detection_ms,
            batch.apply_ms,
            batch.snapshot.count(),
        );
        println!(
            "[{}] PLAYBACK detect={:>6}ms apply={:>5}ms ({} sections)  detect-slowdown={:.1}x  apply-slowdown={:.1}x",
            arm.label(),
            detect_total,
            apply_total,
            play.count(),
            detect_total as f64 / batch.detection_ms.max(1) as f64,
            apply_total as f64 / batch.apply_ms.max(1) as f64,
        );
        println!("      per-add detect curve (n, ms): {:?}", curve);
        println!(
            "      converges to batch: {} (catalogue {}; batch ground recovered {:.0}%)",
            if parity { "EXACT" } else { "DRIFT" },
            if parity { "identical" } else { "differs" },
            converged * 100.0,
        );
    }
}

/// A single add and a 90-activity batch, each measured against corpora of two
/// sizes, so the shape of the cost is visible: does add-1 get dearer as the
/// library grows (the O(N)-per-add drip), and how does a bulk expand compare?
#[test]
#[ignore = "benchmark, run explicitly with --release"]
fn add_cost_by_library_size() {
    let corpus = corpus();
    {
        let arm = Arm::Battery;
        // add-1 onto a 60-activity library.
        let (mut e60, _d60) = fresh_engine_for(arm);
        ingest_step(&mut e60, "cold60", &corpus.through_a());
        let add1_at_60 = ingest_step(&mut e60, "add1", &[&corpus.bucket_c_single]);

        // add-1 onto a 150-activity library.
        let (mut e150, _d150) = fresh_engine_for(arm);
        ingest_step(&mut e150, "cold150", &corpus.through_b());
        let add1_at_150 = ingest_step(&mut e150, "add1", &[&corpus.bucket_c_single]);

        // add-90 (window expand) onto a 60-activity library.
        let (mut eexp, _dexp) = fresh_engine_for(arm);
        ingest_step(&mut eexp, "cold60", &corpus.through_a());
        let add90 = ingest_step(&mut eexp, "add90", &refs(&corpus.bucket_b_delta));

        println!(
            "[{}] add-1@60: detect={:>5}ms apply={:>4}ms | add-1@150: detect={:>5}ms apply={:>4}ms | add-90@60: detect={:>6}ms apply={:>4}ms",
            arm.label(),
            add1_at_60.detection_ms,
            add1_at_60.apply_ms,
            add1_at_150.detection_ms,
            add1_at_150.apply_ms,
            add90.detection_ms,
            add90.apply_ms,
        );
    }
}
