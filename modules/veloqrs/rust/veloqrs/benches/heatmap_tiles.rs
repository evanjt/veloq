//! Criterion benches for heatmap tile generation.
//!
//! Run with: `cargo bench --bench heatmap_tiles --features synthetic`
//!
//! Three bench groups:
//! - `tile/*`, pure `generate_heatmap_tile` cost for representative zoom +
//!   density shapes (sparse low-zoom, medium medium-zoom, dense high-zoom).
//! - `full_cycle/*`, end-to-end `generate_tiles_background` against a seeded
//!   in-memory SQLite with 100 or 500 activities. These are the numbers the
//!   user feels, "finalizing heatmap" banner duration.
//! - `one_added/*`, the pass a sync's single new activity starts over a
//!   library whose tiles are already drawn: the activity is stored through the
//!   engine, its invalidation sweep runs to its end, and only the pass that
//!   sweep requests is timed.

use criterion::{BenchmarkId, Criterion, SamplingMode, criterion_group, criterion_main};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::persistence::TileGenerationHandle;
use veloqrs::persistence::persistent_engine_ffi::{TILE_GENERATION_HANDLE, persistent_engine_init};
use veloqrs::persistence::with_persistent_engine;
use veloqrs::{PersistentEngine, tiles};

// ============================================================================
// Tile-level bench fixtures
// ============================================================================

/// Build a single synthetic track of ~`length_m` around a center lat/lng.
/// Straight-line path, 10 m point spacing, deterministic.
fn straight_track(
    center_lat: f64,
    center_lng: f64,
    length_m: f64,
    bearing_deg: f64,
) -> Vec<GpsPoint> {
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
        group.bench_with_input(
            BenchmarkId::new("z8_sparse", 1),
            &(8u8, x, y, tracks),
            |b, (z, x, y, t)| {
                b.iter(|| tiles::generate_heatmap_tile(*z, *x, *y, t));
            },
        );
    }

    // z14 medium: 10 tracks through the same ~1 km area
    {
        let center_lat = 47.37;
        let center_lng = 8.55;
        let (x, y) = tile_xy_for(center_lat, center_lng, 14);
        let tracks = overlapping_tracks(10, center_lat, center_lng, 1_500.0);
        group.bench_with_input(
            BenchmarkId::new("z14_medium", 10),
            &(14u8, x, y, tracks),
            |b, (z, x, y, t)| {
                b.iter(|| tiles::generate_heatmap_tile(*z, *x, *y, t));
            },
        );
    }

    // z17 dense: 50 tracks through the same ~100 m block
    {
        let center_lat = 47.37;
        let center_lng = 8.55;
        let (x, y) = tile_xy_for(center_lat, center_lng, 17);
        let tracks = overlapping_tracks(50, center_lat, center_lng, 250.0);
        group.bench_with_input(
            BenchmarkId::new("z17_dense", 50),
            &(17u8, x, y, tracks),
            |b, (z, x, y, t)| {
                b.iter(|| tiles::generate_heatmap_tile(*z, *x, *y, t));
            },
        );
    }

    group.finish();
}

// ============================================================================
// Full-cycle bench fixtures, seeded SQLite + background generation
// ============================================================================

/// Activities the lifecycle corpus emits whatever the delta counts are: the
/// one bucket C overlap activity and the three bucket D activities.
const FIXED_LIFECYCLE_ACTIVITIES: usize = 4;

/// The lifecycle corpus holding exactly `target_count` activities.
fn lifecycle_corpus(target_count: usize) -> LifecycleCorpus {
    // The delta counts fill what the fixed activities leave.
    let (a, b, e) = match target_count {
        100 => (60, 36, 0),
        500 => (60, 90, 346),
        other => panic!("no corpus shape for {other} activities"),
    };
    assert_eq!(a + b + e + FIXED_LIFECYCLE_ACTIVITIES, target_count);
    let cfg = LifecycleConfig {
        bucket_a_count: a,
        bucket_b_delta_count: b,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: e,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    LifecycleCorpus::generate(&cfg)
}

/// Seed a tempdir-backed engine with `target_count` activities from the
/// lifecycle corpus, returning (engine, tmp, tiles_dir). Tiles dir is empty,
/// the first `generate_tiles_background` will cold-generate everything.
fn seed_engine(target_count: usize) -> (PersistentEngine, TempDir, PathBuf) {
    let corpus = lifecycle_corpus(target_count);
    let activities: Vec<_> = corpus.through_e().into_iter().cloned().collect();
    assert_eq!(
        activities.len(),
        target_count,
        "the seeded library must hold the count its label claims"
    );

    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("bench.db");
    let tiles_dir = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles_dir).ok();
    let mut engine = PersistentEngine::new(db.to_str().unwrap()).expect("open engine");
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

    for (label, target, sample_size, measurement_secs) in
        [("100", 100usize, 10, 60u64), ("500", 500usize, 10, 300u64)]
    {
        group.sample_size(sample_size);
        group.measurement_time(Duration::from_secs(measurement_secs));

        // One engine per bench case (setup is expensive; tile dir gets reset
        // between iterations).
        let (mut engine, _tmp, tiles_dir) = seed_engine(target);
        engine.set_heatmap_tiles_path(tiles_dir.to_str().unwrap().to_string());
        // `set_heatmap_tiles_path` may have kicked off a background run
        // (format-version write triggers dirty). Drain it.
        {
            if let Ok(mut guard) =
                veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock()
                && let Some(handle) = guard.take()
            {
                let _ = handle.recv_blocking();
            }
        }

        group.bench_with_input(BenchmarkId::from_parameter(label), &label, |b, _| {
            b.iter_custom(|iters| {
                let mut total = Duration::ZERO;
                for _ in 0..iters {
                    reset_tiles_dir(&tiles_dir);
                    engine.mark_heatmap_dirty();
                    let start = Instant::now();
                    let handle = engine.generate_tiles_background().expect("handle returned");
                    let _ = handle.recv_blocking();
                    total += start.elapsed();
                }
                total
            });
        });
    }

    group.finish();
}

/// Take the pass a sweep requested, waiting for the sweep to end and ask.
///
/// A sweep deletes tiles on its own thread and starts the pass as its last
/// step, so the handle appearing marks the sweep's end.
fn await_requested_pass() -> TileGenerationHandle {
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if let Some(handle) = TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            return handle;
        }
        assert!(Instant::now() < deadline, "no tile pass was requested");
        std::thread::sleep(Duration::from_micros(200));
    }
}

/// Run the requested pass to its end, answering how many tiles it drew.
fn finish_requested_pass() -> u32 {
    await_requested_pass()
        .recv_blocking()
        .expect("the pass reported its outcome")
}

/// An activity that overlaps ground the library already draws: the bucket C
/// track, shifted a few metres and stored under a new id.
fn added_activity(corpus: &LifecycleCorpus) -> LifecycleActivity {
    let mut added = corpus.bucket_c_single.clone();
    added.id = "bench-added".to_string();
    for point in &mut added.gps_points {
        point.latitude += 0.000_05;
    }
    added
}

fn bench_one_added(c: &mut Criterion) {
    let mut group = c.benchmark_group("one_added");
    group.sampling_mode(SamplingMode::Flat);
    group.warm_up_time(Duration::from_secs(2));
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(120));

    let target = 500usize;
    let corpus = lifecycle_corpus(target);
    let baseline: Vec<_> = corpus.through_e().into_iter().cloned().collect();
    assert_eq!(
        baseline.len(),
        target,
        "the baseline must hold the count its label claims"
    );
    let added = added_activity(&corpus);

    // Through the process-wide engine, which is the one a sweep's pass request
    // reaches.
    let setup_started = Instant::now();
    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("bench.db");
    let tiles_dir = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles_dir).expect("tiles dir");
    assert!(persistent_engine_init(db.to_str().unwrap().to_string()));
    with_persistent_engine(|engine| {
        for chunk in baseline.chunks(50) {
            let rows = chunk
                .iter()
                .map(|a| (a.id.clone(), a.gps_points.clone(), a.sport_type.clone()))
                .collect();
            engine.add_activities_batch(rows).expect("baseline stored");
        }
        engine.set_heatmap_tiles_path(tiles_dir.to_str().unwrap().to_string());
    })
    .expect("engine installed");
    let drawn = finish_requested_pass();
    assert!(drawn > 0, "the baseline pass drew no tiles");
    eprintln!(
        "one_added setup: {} activities, {} tiles drawn, {:?}",
        baseline.len(),
        drawn,
        setup_started.elapsed()
    );

    group.bench_with_input(BenchmarkId::from_parameter(target), &target, |b, _| {
        b.iter_custom(|iters| {
            let mut total = Duration::ZERO;
            for _ in 0..iters {
                with_persistent_engine(|engine| {
                    engine
                        .add_activity(
                            added.id.clone(),
                            added.gps_points.clone(),
                            added.sport_type.clone(),
                        )
                        .expect("added activity stored")
                })
                .expect("engine installed");
                // The sweep has ended once it has asked for its pass.
                let pass = await_requested_pass();
                let start = Instant::now();
                let redrawn = pass.recv_blocking().expect("the pass reported its outcome");
                total += start.elapsed();
                assert!(redrawn > 0, "the added activity's tiles were not redrawn");

                // Back to the baseline, tiles drawn, outside the timing.
                with_persistent_engine(|engine| {
                    engine
                        .remove_activity(&added.id)
                        .expect("added activity removed")
                })
                .expect("engine installed");
                finish_requested_pass();
            }
            total
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_single_tile,
    bench_full_cycle,
    bench_one_added
);
criterion_main!(benches);
