//! Tier 0.3 — tile-set snapshot across lifecycle checkpoints.
//!
//! Complements `heatmap_parity` (which checks per-tile pixel output) by
//! snapshotting the *set* of (z,x,y) tile files written at two lifecycle
//! points: cold start (scenario A) and full year expansion (scenario E).
//! Guards the Tier 1.1 loop-inversion rewrite from accidentally dropping
//! tiles we used to emit.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn seed_engine(activities: &[&LifecycleActivity]) -> (PersistentRouteEngine, TempDir) {
    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("tile_set.db");
    let mut engine = PersistentRouteEngine::new(db.to_str().unwrap()).expect("open engine");
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
    }
    (engine, tmp)
}

fn generate_and_collect(engine: &mut PersistentRouteEngine, tmp: &TempDir) -> BTreeSet<String> {
    let tiles_dir = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles_dir).expect("create tiles dir");
    engine.set_heatmap_tiles_path(tiles_dir.to_str().unwrap().to_string());
    let _ = {
        let mut guard = veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
            .lock()
            .expect("lock handle");
        guard
            .take()
            .expect("cold run should spawn")
            .recv_blocking()
            .expect("cold run should complete")
    };

    let mut out = BTreeSet::new();
    fn recurse(dir: &Path, base: &Path, out: &mut BTreeSet<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                recurse(&path, base, out);
            } else if path.extension().and_then(|s| s.to_str()) == Some("png") {
                if let Ok(rel) = path.strip_prefix(base) {
                    out.insert(rel.to_string_lossy().to_string());
                }
            }
        }
    }
    recurse(&tiles_dir, &tiles_dir, &mut out);
    out
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn compare_or_write(fixture: &str, set: &BTreeSet<String>) {
    let path = fixture_path(fixture);
    let joined = set.iter().cloned().collect::<Vec<_>>().join("\n");
    if let Ok(expected) = std::fs::read_to_string(&path) {
        let expected_lines: BTreeSet<String> =
            expected.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect();
        if expected_lines != *set {
            let missing: Vec<_> = expected_lines.difference(set).collect();
            let extra: Vec<_> = set.difference(&expected_lines).collect();
            panic!(
                "tile-set drift in {}\n  missing ({}): {:?}\n  extra   ({}): {:?}\n\
                 If this change is intentional, delete the fixture and re-run.",
                path.display(),
                missing.len(),
                missing.iter().take(10).collect::<Vec<_>>(),
                extra.len(),
                extra.iter().take(10).collect::<Vec<_>>(),
            );
        }
    } else {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&path, joined).expect("write fixture");
        panic!(
            "fixture was missing — wrote it to {}. Review, then commit.",
            path.display()
        );
    }
}

#[test]
fn scenario_a_tile_set_snapshot() {
    let cfg = LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 2,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let acts: Vec<&LifecycleActivity> = corpus.bucket_a.iter().collect();
    let (mut engine, tmp) = seed_engine(&acts);
    let set = generate_and_collect(&mut engine, &tmp);
    println!("[lifecycle/A_heatmap] tiles_written={}", set.len());
    assert!(
        !set.is_empty(),
        "scenario A should produce at least one tile"
    );
    compare_or_write("heatmap_tile_set_A_v1.txt", &set);
}

#[test]
fn scenario_e_tile_set_snapshot() {
    // Keep E small enough for CI: 60+90+350 = 500 full-year state
    // matches the bench, but we trim it here since we only need a
    // stable structural fingerprint, not timing.
    let cfg = LifecycleConfig {
        bucket_a_count: 40,
        bucket_b_delta_count: 60,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 50,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let acts: Vec<&LifecycleActivity> = corpus
        .bucket_a
        .iter()
        .chain(corpus.bucket_b_delta.iter())
        .chain(corpus.bucket_e_delta.iter())
        .collect();
    let (mut engine, tmp) = seed_engine(&acts);
    let set = generate_and_collect(&mut engine, &tmp);
    println!("[lifecycle/E_heatmap] tiles_written={}", set.len());
    assert!(
        set.len() > 10,
        "scenario E should produce many tiles; got {}",
        set.len()
    );
    compare_or_write("heatmap_tile_set_E_v1.txt", &set);
}
