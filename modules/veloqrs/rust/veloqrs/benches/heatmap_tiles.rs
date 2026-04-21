//! Criterion benches for heatmap tile generation.
//!
//! Run with: `cargo bench --bench heatmap_tiles --features synthetic`
//!
//! Two bench groups:
//! - `tile/*` — pure `generate_heatmap_tile` cost for representative zoom +
//!   density shapes (sparse low-zoom, medium medium-zoom, dense high-zoom).
//! - `full_cycle/*` — end-to-end `generate_tiles_background` against a seeded
//!   in-memory SQLite with 100 or 500 activities. These are the numbers the
//!   user feels — "finalizing heatmap" banner duration.

use criterion::{BenchmarkId, Criterion, SamplingMode, criterion_group, criterion_main};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::{PersistentRouteEngine, tiles};

// ============================================================================
// Tile-level bench fixtures
// ============================================================================

/// Build a single synthetic track of ~`length_m` around a center lat/lng.
/// Straight-line path, 10 m point spacing, deterministic.
fn straight_track(center_lat: f64, center_lng: f64, length_m: f64, bearing_deg: f64) -> Vec<GpsPoint> {
    let n = (length_m / 10.0).ceil() as usize;
    let br = bearing_deg.to_radians();
    let meters_per_deg_lat = 111_320.0_f64;
    let meters_per_deg_lng = meters_per_deg_lat * center_lat.to_radians().cos();
    let d_lat = 10.0 * br.cos() / meters_per_deg_lat;
    let d_lng = 10.0 * br.sin() / meters_per_deg_lng.max(1.0);
    let half = n as f64 / 2.0;
    (0..n)
        .map(|i| {
            let k = i as f64 - half;
            GpsPoint::new(center_lat + d_lat * k, center_lng + d_lng * k)
        })
        .collect()
}

/// Build `count` overlapping tracks around a center, each slightly rotated
/// and offset to mimic repeated visits along the same rough corridor.
fn overlapping_tracks(
    count: usize,
    center_lat: f64,
    center_lng: f64,
    length_m: f64,
) -> Vec<Vec<GpsPoint>> {
    (0..count)
        .map(|i| {
            let bearing = (i as f64) * (360.0 / count.max(1) as f64) * 0.05 + 45.0;
            let jitter_lat = center_lat + ((i as f64 * 0.000_02) - (count as f64 * 0.000_01));
            let jitter_lng = center_lng + ((i as f64 * 0.000_03) - (count as f64 * 0.000_015));
            straight_track(jitter_lat, jitter_lng, length_m, bearing)
        })
        .collect()
}

fn tile_xy_for(lat: f64, lng: f64, zoom: u8) -> (u32, u32) {
    let tx = tiles::lon_to_tile_x(lng, zoom).floor() as u32;
    let ty = tiles::lat_to_tile_y(lat, zoom).floor() as u32;
    (tx, ty)
}

fn bench_single_tile(c: &mut Criterion) {
    let mut group = c.benchmark_group("tile");
    group.sampling_mode(SamplingMode::Auto);
    group.sample_size(30);
    group.measurement_time(Duration::from_secs(15));

    // z8 sparse: one 20 km track over a z8 tile
    {
        let center_lat = 47.37;
        let center_lng = 8.55;
        let (x, y) = tile_xy_for(center_lat, center_lng, 8);
        let tracks = vec![straight_track(center_lat, center_lng, 20_000.0, 30.0)];
        group.bench_with_input(BenchmarkId::new("z8_sparse", 1), &(8u8, x, y, tracks), |b, (z, x, y, t)| {
            b.iter(|| tiles::generate_heatmap_tile(*z, *x, *y, t));
        });
    }

    // z14 medium: 10 tracks through the same ~1 km area
    {
        let center_lat = 47.37;
        let center_lng = 8.55;
        let (x, y) = tile_xy_for(center_lat, center_lng, 14);
        let tracks = overlapping_tracks(10, center_lat, center_lng, 1_500.0);
        group.bench_with_input(BenchmarkId::new("z14_medium", 10), &(14u8, x, y, tracks), |b, (z, x, y, t)| {
            b.iter(|| tiles::generate_heatmap_tile(*z, *x, *y, t));
        });
    }

    // z17 dense: 50 tracks through the same ~100 m block
    {
        let center_lat = 47.37;
        let center_lng = 8.55;
        let (x, y) = tile_xy_for(center_lat, center_lng, 17);
        let tracks = overlapping_tracks(50, center_lat, center_lng, 250.0);
        group.bench_with_input(BenchmarkId::new("z17_dense", 50), &(17u8, x, y, tracks), |b, (z, x, y, t)| {
            b.iter(|| tiles::generate_heatmap_tile(*z, *x, *y, t));
        });
    }

    group.finish();
}

// ============================================================================
// Full-cycle bench fixtures — seeded SQLite + background generation
// ============================================================================

/// Seed a tempdir-backed engine with `target_count` activities from the
/// lifecycle corpus, returning (engine, tmp, tiles_dir). Tiles dir is empty —
/// the first `generate_tiles_background` will cold-generate everything.
fn seed_engine(target_count: usize) -> (PersistentRouteEngine, TempDir, PathBuf) {
    // Pick counts that stack up to ~target_count.
    let (a, b, e) = match target_count {
        100 => (60, 40, 0),
        500 => (60, 90, 350),
        _ => (60, 90, 350),
    };
    let cfg = LifecycleConfig {
        bucket_a_count: a,
        bucket_b_delta_count: b,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: e,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let activities: Vec<_> = corpus
        .through_e()
        .into_iter()
        .cloned()
        .collect();

    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("bench.db");
    let tiles_dir = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles_dir).ok();
    let mut engine = PersistentRouteEngine::new(db.to_str().unwrap()).expect("open engine");
    for a in &activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
    }
    (engine, tmp, tiles_dir)
}

/// Wipe all tile files under `tiles_dir` without removing the directory, and
/// write the dirty marker so the next `generate_tiles_background` runs a full
/// pass. Matches what `set_heatmap_tiles_path` does on format-version bumps.
fn reset_tiles_dir(tiles_dir: &PathBuf) {
    // Remove zoom subdirectories (z0..=z20) but keep the root for speed.
    if let Ok(rd) = std::fs::read_dir(tiles_dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                // Remove version + dirty markers too so next run re-inits cleanly.
                if name == "version.txt" || name == ".dirty" {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}

fn bench_full_cycle(c: &mut Criterion) {
    let mut group = c.benchmark_group("full_cycle");
    group.sampling_mode(SamplingMode::Flat);
    // Full cycles are O(seconds); keep sample size tight but measurement long.
    group.warm_up_time(Duration::from_secs(2));

    for (label, target, sample_size, measurement_secs) in [
        ("100", 100usize, 10, 60u64),
        ("500", 500usize, 10, 300u64),
    ] {
        group.sample_size(sample_size);
        group.measurement_time(Duration::from_secs(measurement_secs));

        // One engine per bench case (setup is expensive; tile dir gets reset
        // between iterations).
        let (mut engine, _tmp, tiles_dir) = seed_engine(target);
        engine.set_heatmap_tiles_path(tiles_dir.to_str().unwrap().to_string());
        // `set_heatmap_tiles_path` may have kicked off a background run
        // (format-version write triggers dirty). Drain it.
        {
            if let Ok(mut guard) = veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock() {
                if let Some(handle) = guard.take() {
                    let _ = handle.recv_blocking();
                }
            }
        }

        group.bench_with_input(BenchmarkId::from_parameter(label), &label, |b, _| {
            b.iter_custom(|iters| {
                let mut total = Duration::ZERO;
                for _ in 0..iters {
                    reset_tiles_dir(&tiles_dir);
                    engine.mark_heatmap_dirty();
                    let start = Instant::now();
                    let handle = engine
                        .generate_tiles_background()
                        .expect("handle returned");
                    let _ = handle.recv_blocking();
                    total += start.elapsed();
                }
                total
            });
        });
    }

    group.finish();
}

criterion_group!(benches, bench_single_tile, bench_full_cycle);
criterion_main!(benches);
