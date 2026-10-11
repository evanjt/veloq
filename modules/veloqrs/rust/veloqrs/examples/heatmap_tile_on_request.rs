//! What one deep heatmap tile costs when the map asks for it and no pass has
//! drawn it: the read of the tracks that reach it, the draw and the write,
//! timed at the densest z15, z16 and z17 tile of a 500-activity library.
//!
//! The densest tile is the largest PNG the pass drew at that zoom, so it is
//! the tile with the most ink, which is the slowest one to draw. Each run
//! removes it and asks for it again through the reader the map uses.
//!
//! Usage:
//!   cargo run --release -p veloqrs --features synthetic \
//!     --example heatmap_tile_on_request -- [REPEATS]
//!
//! For a handset, build with `cargo ndk -t arm64-v8a`, push the binary from
//! `target/aarch64-linux-android/release/examples/` and run it there.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::persistence::persistent_engine_ffi::{TILE_GENERATION_HANDLE, persistent_engine_init};
use veloqrs::persistence::tiles::{heatmap_tile_bytes, take_on_request_counts};
use veloqrs::persistence::with_persistent_engine;

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

/// The largest PNG the pass drew at `z`, as its `(x, y)` and path.
fn densest_tile(tiles_dir: &Path, z: u8) -> (u32, u32, PathBuf) {
    let mut best: Option<(u64, u32, u32, PathBuf)> = None;
    for column in std::fs::read_dir(tiles_dir.join(z.to_string()))
        .expect("the pass drew this zoom")
        .flatten()
    {
        let x: u32 = column
            .file_name()
            .to_string_lossy()
            .parse()
            .expect("column");
        for tile in std::fs::read_dir(column.path()).expect("column").flatten() {
            let name = tile.file_name().to_string_lossy().into_owned();
            let Some(y) = name.strip_suffix(".png") else {
                continue;
            };
            let size = tile.metadata().expect("tile").len();
            if best.as_ref().is_none_or(|(most, ..)| size > *most) {
                best = Some((size, x, y.parse().expect("row"), tile.path()));
            }
        }
    }
    let (_, x, y, path) = best.expect("a tile with heat in it");
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

    for z in [15u8, 16, 17] {
        let (x, y, path) = densest_tile(&tiles_dir, z);
        let mut times = Vec::with_capacity(repeats);
        let mut tracks = 0;
        for _ in 0..repeats {
            std::fs::remove_file(&path).expect("tile removed");
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
