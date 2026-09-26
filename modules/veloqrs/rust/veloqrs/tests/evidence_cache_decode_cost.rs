//! What `initWithPath` pays to decode the evidence cache, measured rather than
//! estimated.
//!
//! `engine.load()` restores the persisted evidence cache, and the writer's own
//! comment puts the blob at roughly 5 KB per activity. `I91` budgets the launch
//! path at 200 ms once, and `initWithPath` was about 130 ms cold at 490
//! activities without anyone knowing how much of that is this decode.
//!
//! Ignored by default: it detects a whole corpus per size and takes minutes.
//! Run: `cargo test --test evidence_cache_decode_cost -p veloqrs --features synthetic -- --ignored --nocapture`

#![cfg(feature = "synthetic")]

use std::time::Instant;

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

/// Pool sizes to measure. `bucket_a_count` is what the corpus scales on.
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

fn open(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("evidence.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.load().expect("load");
    engine.set_section_config(SectionConfig::default());
    engine
}

fn ingest(engine: &mut PersistentEngine, activities: &[LifecycleActivity]) {
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
}

fn detect(engine: &mut PersistentEngine) {
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed) = main.unwrap_or_default();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply_sections_with_cache");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
}

fn cache_bytes(dir: &TempDir) -> usize {
    let conn = Connection::open(dir.path().join("evidence.db")).expect("open");
    conn.query_row(
        "SELECT length(cache) FROM evidence_cache WHERE id = 1",
        [],
        |r| Ok(r.get::<_, i64>(0)? as usize),
    )
    .unwrap_or(0)
}

/// Re-open and time `load()`, which is what `initWithPath` calls. Taken three
/// times and reported as the median, because a first open pays page cache too.
fn load_ms(dir: &TempDir) -> f64 {
    let path = dir.path().join("evidence.db");
    let mut runs = Vec::new();
    for _ in 0..3 {
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let start = Instant::now();
        engine.load().expect("load");
        runs.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    runs.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
    runs[1]
}

/// The same open with no cache row, so the difference is the decode and not
/// everything else `load()` does.
fn load_ms_without_cache(dir: &TempDir) -> f64 {
    let conn = Connection::open(dir.path().join("evidence.db")).expect("open");
    conn.execute("DELETE FROM evidence_cache", [])
        .expect("clear");
    drop(conn);
    load_ms(dir)
}

#[test]
#[ignore = "detects a whole corpus per size; run it deliberately"]
fn the_evidence_cache_decode_inside_load() {
    println!("activities  cache_bytes  bytes/act  load_warm_ms  load_cold_ms  decode_ms");
    for &bucket_a in SIZES {
        let dir = TempDir::new().expect("tempdir");
        let pool = corpus(bucket_a);
        let count = pool.len();
        let mut engine = open(&dir);
        ingest(&mut engine, &pool);
        detect(&mut engine);
        drop(engine);

        let bytes = cache_bytes(&dir);
        assert!(bytes > 0, "nothing was persisted at {count} activities");

        let warm = load_ms(&dir);
        let cold = load_ms_without_cache(&dir);

        println!(
            "{count:>10}  {bytes:>11}  {:>9.0}  {warm:>12.1}  {cold:>12.1}  {:>9.1}",
            bytes as f64 / count as f64,
            warm - cold
        );
    }
}
