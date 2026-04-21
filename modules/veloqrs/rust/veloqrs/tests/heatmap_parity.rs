//! Tier 0.2 — pixel-parity fixture for heatmap tiles.
//!
//! Seeds a deterministic corpus, runs the full generation pipeline, decodes
//! every tile PNG, and hashes the RGBA pixel buffers. The fixture stored at
//! `tests/fixtures/heatmap_parity_v1.txt` is the canonical digest — Tier 1
//! changes must either match it exactly or the test fails with the new
//! digest printed for review.
//!
//! To regenerate after an intentional change: delete the fixture file and
//! re-run; the test will write a fresh one and fail with a "commit this"
//! message.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use image::GenericImageView;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

const FIXTURE_FILE: &str = "tests/fixtures/heatmap_parity_v1.txt";

fn seed_engine(tmp: &TempDir) -> PersistentRouteEngine {
    let cfg = LifecycleConfig {
        bucket_a_count: 15,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 1,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let db = tmp.path().join("parity.db");
    let mut engine = PersistentRouteEngine::new(db.to_str().unwrap()).expect("open engine");
    for a in corpus.bucket_a {
        engine
            .add_activity(a.id, a.gps_points, a.sport_type)
            .expect("add_activity");
    }
    engine
}

fn walk_tiles(base: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn recurse(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                recurse(&path, out);
            } else if path.extension().and_then(|s| s.to_str()) == Some("png") {
                out.push(path);
            }
        }
    }
    recurse(base, &mut out);
    out.sort();
    out
}

fn hash_tile_pixels(path: &Path) -> String {
    let img = image::open(path).expect("decode png");
    let rgba = img.to_rgba8();
    let (w, h) = img.dimensions();
    let mut hasher = Sha256::new();
    hasher.update(w.to_le_bytes());
    hasher.update(h.to_le_bytes());
    hasher.update(rgba.as_raw());
    format!("{:x}", hasher.finalize())
}

fn compute_digest(tiles_dir: &Path) -> String {
    let files = walk_tiles(tiles_dir);
    let mut per_tile: BTreeMap<String, String> = BTreeMap::new();
    for p in &files {
        let rel = p.strip_prefix(tiles_dir).unwrap().to_string_lossy().to_string();
        per_tile.insert(rel, hash_tile_pixels(p));
    }
    let mut top = Sha256::new();
    top.update((per_tile.len() as u64).to_le_bytes());
    for (k, v) in &per_tile {
        top.update(k.as_bytes());
        top.update(b"=");
        top.update(v.as_bytes());
        top.update(b"\n");
    }
    format!("{:x} tiles={}", top.finalize(), per_tile.len())
}

#[test]
fn tile_pixels_match_fixture() {
    let tmp = TempDir::new().expect("tempdir");
    let mut engine = seed_engine(&tmp);
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

    let actual = compute_digest(&tiles_dir);

    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE_FILE);
    if let Ok(expected) = std::fs::read_to_string(&fixture_path) {
        let expected = expected.trim();
        assert_eq!(
            expected, actual,
            "heatmap pixel digest drift.\n  expected: {expected}\n  actual:   {actual}\n\
             If the change is intentional, delete {} and re-run to regenerate the fixture.",
            fixture_path.display()
        );
    } else {
        if let Some(parent) = fixture_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&fixture_path, &actual).expect("write fixture");
        panic!(
            "fixture was missing — wrote it to {}. Review the tile output, then commit the fixture so future runs can compare.",
            fixture_path.display()
        );
    }
}
