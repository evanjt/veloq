//! What one deep heatmap tile costs when the map asks for it and no pass has
//! drawn it: the read of the tracks that reach it, the draw and the write,
//! timed at the densest z15, z16 and z17 tile of a 500-activity library.
//!
//! The densest tile is the one the most tracks walk through at that zoom,
//! which is the slowest one to draw. Each run removes it and asks for it
//! again through the reader the map uses.
//!
//! Usage:
//!   cargo run --release -p veloqrs --features synthetic \
//!     --example heatmap_tile_on_request -- [REPEATS]
//!
//! For a handset, build with `cargo ndk -t arm64-v8a`, push the binary from
//! `target/aarch64-linux-android/release/examples/` and run it there.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::persistence::persistent_engine_ffi::{TILE_GENERATION_HANDLE, persistent_engine_init};
use veloqrs::persistence::tiles::{heatmap_tile_bytes, take_on_request_counts};
use veloqrs::persistence::with_persistent_engine;
use veloqrs::tiles::tiles_along_track;

/// The 500-activity shape the heatmap benches build.
fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 346,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    })
}

fn drain_pass() -> u32 {
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        if let Some(handle) = TILE_GENERATION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            return handle
                .recv_blocking()
                .expect("the pass reported its outcome");
        }
        assert!(Instant::now() < deadline, "no tile pass was requested");
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// The tile at `z` the most tracks walk through, as its `(x, y)` and path.
/// The pass draws nothing this deep, so the count of tracks stands in for the
/// ink: the tile with the most tracks is the slowest one to draw.
fn densest_tile(tiles_dir: &Path, tracks: &[Vec<GpsPoint>], z: u8) -> (u32, u32, PathBuf) {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for track in tracks {
        for tile in tiles_along_track(track, z) {
            *counts.entry(tile).or_default() += 1;
        }
    }
    let ((x, y), _) = counts
        .into_iter()
        .max_by_key(|&((x, y), n)| (n, std::cmp::Reverse((x, y))))
        .expect("a tile with a track in it");
    let path = tiles_dir
        .join(z.to_string())
        .join(x.to_string())
        .join(format!("{y}.png"));
    (x, y, path)
}

fn main() {
    let repeats: usize = std::env::args()
        .nth(1)
        .map(|s| s.parse().expect("REPEATS is a count"))
        .unwrap_or(10);

    let baseline: Vec<_> = corpus().through_e().into_iter().cloned().collect();
    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("on-request.db");
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
    let drawn = drain_pass();
    eprintln!(
        "RESULT library {} activities, {drawn} tiles drawn by the pass",
        baseline.len()
    );

    let stored: Vec<Vec<GpsPoint>> = baseline.iter().map(|a| a.gps_points.clone()).collect();
    for z in [15u8, 16, 17] {
        let (x, y, path) = densest_tile(&tiles_dir, &stored, z);
        let mut times = Vec::with_capacity(repeats);
        let mut tracks = 0;
        for _ in 0..repeats {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => panic!("the tile could not be removed: {e}"),
            }
            take_on_request_counts();
            let start = Instant::now();
            let bytes = heatmap_tile_bytes(z, x, y);
            times.push(start.elapsed());
            assert!(bytes.is_some(), "the tile was not drawn on request");
            tracks = take_on_request_counts().tracks_loaded;
        }
        times.sort();
        eprintln!(
            "RESULT z{z} {x}/{y}: {tracks} tracks read, median {:.1} ms, max {:.1} ms over {repeats}",
            times[times.len() / 2].as_secs_f64() * 1e3,
            times[times.len() - 1].as_secs_f64() * 1e3,
        );
    }
}
