//! What an apply pays to write the evidence cache, measured rather than
//! estimated.
//!
//! `persist_evidence_cache` runs at the end of every successful apply and its
//! own comment put the write at roughly 0.07 ms per activity. Nothing had
//! measured it. `persist_evidence_checkpoint` encodes and writes the same blob
//! through the same `persist_evidence_blob`, so it is what an integration test
//! can reach.
//!
//! Ignored by default: it detects a whole corpus per size and takes minutes.
//! Run: `cargo test --test evidence_cache_write_cost -p veloqrs --features synthetic -- --ignored --nocapture`

#![cfg(feature = "synthetic")]

use std::time::Instant;

use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

/// Pool sizes to measure, the same ladder `evidence_cache_decode_cost` walks.
const SIZES: &[usize] = &[24, 120, 480];

fn corpus(bucket_a: usize) -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: bucket_a,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

#[test]
#[ignore = "detects a whole corpus per size; run it deliberately"]
fn what_an_apply_pays_to_write_the_evidence_cache() {
    println!("activities  write_ms  ms/act");
    for &bucket_a in SIZES {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("evidence.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine.load().expect("load");
        engine.set_section_config(SectionConfig::default());

        let pool = corpus(bucket_a);
        let count = pool.len();
        for a in &pool {
            engine
                .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
                .expect("add_activity");
            engine
                .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
                .expect("update_activity_metadata");
        }

        let handle = engine.detect_sections_background();
        let (main, cache_update) = handle.recv_with_cache();
        let (sections, processed) = main.unwrap_or_default();
        let update = cache_update.expect("a detect over a fresh pool owes a cache");

        // Median of three: the first write pays for a page the later two find.
        // Timed before the apply, because `CacheUpdate` moves into it.
        let mut runs = Vec::new();
        for _ in 0..3 {
            let start = Instant::now();
            engine.persist_evidence_checkpoint(&update);
            runs.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        runs.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
        let write = runs[1];

        engine
            .apply_sections_with_cache(sections, Some(update))
            .expect("apply_sections_with_cache");
        engine
            .save_processed_activity_ids(&processed)
            .expect("save_processed_activity_ids");

        println!("{count:>10}  {write:>8.1}  {:>6.3}", write / count as f64);
    }
}
