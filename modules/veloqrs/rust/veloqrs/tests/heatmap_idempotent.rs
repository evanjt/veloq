//! Tier 0.4, idempotence guard for heatmap tile generation.
//!
//! Run a full cycle, re-run without adding activities, and assert that the
//! second pass is a near-no-op: every tile already on disk gets skipped and
//! the channel closes quickly. Protects the Tier 1.1 loop-inversion rewrite
//! from quietly dropping the "skip if exists" short-circuit.

use std::time::Instant;

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

fn seed_engine() -> (PersistentEngine, TempDir) {
    let cfg = LifecycleConfig {
        bucket_a_count: 25,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 2,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("heatmap.db");
    let mut engine = PersistentEngine::new(db.to_str().unwrap()).expect("open engine");
    for a in corpus.bucket_a {
        engine
            .add_activity(a.id, a.gps_points, a.sport_type)
            .expect("add_activity");
    }
    (engine, tmp)
}

#[test]
fn second_pass_generates_nothing_new() {
    let _serial_state = super::serial_state();
    let (mut engine, tmp) = seed_engine();
    let tiles_dir = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles_dir).expect("create tiles dir");

    // Cold pass: populate tiles from scratch.
    let cold_start = Instant::now();
    engine.set_heatmap_tiles_path(tiles_dir.to_str().unwrap().to_string());
    // set_heatmap_tiles_path parked the handle in the global; drain it.
    let cold_generated = {
        if let Ok(mut guard) =
            veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock()
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
    let cold_elapsed = cold_start.elapsed();
    assert!(
        cold_generated > 0,
        "cold run should produce at least one tile; got {cold_generated}"
    );

    // Warm pass: every tile on disk already, skip path must short-circuit.
    let handle = engine
        .generate_tiles_background()
        .expect("the cold pass was drained, so the slot is free");
    let warm_generated = handle.recv_blocking().expect("warm run should complete");

    assert_eq!(
        warm_generated, 0,
        "warm pass should not write any new tiles (every coord already on disk)"
    );
    // The zero count above cannot see a regression that renders first and
    // skips the write after. The scheduled total can: it is stored once the
    // existence filter has run and before any tile is rasterised, so a pass
    // that reaches the renderer with anything left reports it here. This used
    // to be an elapsed-time bound against the cold pass, which measured the
    // build profile rather than the skip: with the dependencies optimised the
    // load and sweep that both passes share are three quarters of a cold pass.
    let (_, warm_scheduled) = handle.get_progress();
    assert_eq!(
        warm_scheduled,
        0,
        "warm pass scheduled {warm_scheduled} tiles for rendering against a cold pass of {}ms, skip-if-exists is running after the plan",
        cold_elapsed.as_millis()
    );
}

/// Scenario: a clean cache written by the release before the palette change
/// (version "7", no dirty marker) is opened by the current renderer.
///
/// Expected behaviour: the open schedules a pass, the tile drawn with the old
/// palette is replaced, the new version is recorded, and the next unchanged
/// open schedules nothing.
#[test]
fn cache_from_the_previous_palette_is_regenerated_on_open() {
    let _serial_state = super::serial_state();
    let (mut engine, tmp) = seed_engine();
    let tiles_dir = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles_dir).expect("create tiles dir");
    let path = tiles_dir.to_str().unwrap().to_string();

    engine.set_heatmap_tiles_path(path.clone());
    drain_parked_pass("first open spawns a pass");
    let current_version =
        std::fs::read_to_string(tiles_dir.join("version.txt")).expect("version recorded");

    let tile = first_png(&tiles_dir).expect("a tile was rendered");
    let previous_palette = b"tile drawn with the previous palette".to_vec();
    std::fs::write(&tile, &previous_palette).expect("overwrite tile");
    std::fs::write(tiles_dir.join("version.txt"), "7").expect("write old version");
    let _ = std::fs::remove_file(tiles_dir.join(".dirty"));

    engine.set_heatmap_tiles_path(path.clone());
    drain_parked_pass("an old-format cache starts a pass");

    assert_ne!(
        std::fs::read(&tile).ok(),
        Some(previous_palette),
        "a tile drawn with the previous palette survived the upgrade"
    );
    assert_eq!(
        std::fs::read_to_string(tiles_dir.join("version.txt")).expect("version recorded"),
        current_version,
        "the upgrade did not record the current format version"
    );

    engine.set_heatmap_tiles_path(path);
    assert!(
        veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .unwrap()
            .take()
            .is_none(),
        "an unchanged cache scheduled a pass on the next open"
    );
}

fn drain_parked_pass(expect: &str) {
    veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
        .lock()
        .unwrap()
        .take()
        .expect(expect)
        .recv_blocking()
        .expect("pass completes");
}

fn first_png(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(f) = first_png(&p) {
                return Some(f);
            }
        } else if p.extension().is_some_and(|e| e == "png") {
            return Some(p);
        }
    }
    None
}
