//! Tier 0.4 — idempotence guard for heatmap tile generation.
//!
//! Run a full cycle, re-run without adding activities, and assert that the
//! second pass is a near-no-op: every tile already on disk gets skipped and
//! the channel closes quickly. Protects the Tier 1.1 loop-inversion rewrite
//! from quietly dropping the "skip if exists" short-circuit.

use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn seed_engine() -> (PersistentRouteEngine, TempDir) {
    let cfg = LifecycleConfig {
        bucket_a_count: 25,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 2,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("heatmap.db");
    let mut engine = PersistentRouteEngine::new(db.to_str().unwrap()).expect("open engine");
    for a in corpus.bucket_a {
        engine
            .add_activity(a.id, a.gps_points, a.sport_type)
            .expect("add_activity");
    }
    (engine, tmp)
}

#[test]
fn second_pass_generates_nothing_new() {
    let (mut engine, tmp) = seed_engine();
    let tiles_dir = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles_dir).expect("create tiles dir");

    // Cold pass: populate tiles from scratch.
    engine.set_heatmap_tiles_path(tiles_dir.to_str().unwrap().to_string());
    // set_heatmap_tiles_path parked the handle in the global; drain it.
    let cold_generated = {
        if let Ok(mut guard) = veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock()
        {
            guard
                .take()
                .expect("set_heatmap_tiles_path should spawn a background run for a dirty cache")
                .recv_blocking()
                .expect("cold run should complete")
        } else {
            panic!("failed to lock TILE_GENERATION_HANDLE");
        }
    };
    assert!(
        cold_generated > 0,
        "cold run should produce at least one tile; got {cold_generated}"
    );

    // Warm pass: every tile on disk already, skip path must short-circuit.
    let start = Instant::now();
    let handle = engine
        .generate_tiles_background()
        .expect("background should still spawn — the function is unconditional");
    let warm_generated = handle
        .recv_blocking()
        .expect("warm run should complete");
    let warm_elapsed = start.elapsed();

    assert_eq!(
        warm_generated, 0,
        "warm pass should not write any new tiles (every coord already on disk)"
    );
    assert!(
        warm_elapsed < Duration::from_millis(1500),
        "warm pass took {}ms — skip-if-exists path may have regressed",
        warm_elapsed.as_millis()
    );
}
