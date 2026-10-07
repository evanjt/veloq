//! Where a heatmap tile pass spends its time, cold and after one added
//! activity, with the pass's own load, plan and total lines printed beside the
//! elapsed time of each run.
//!
//! The bench in `benches/heatmap_tiles.rs` reports one number per case. This
//! prints the phases, so it answers whether an incremental pass is drawing or
//! loading and planning the whole library. It builds for a handset as well as
//! the host, and on a handset the release engine logs nothing below a warning,
//! so the phase lines come from this binary's own logger.
//!
//! Usage:
//!   cargo run --release -p veloqrs --features synthetic \
//!     --example heatmap_pass_phases -- [REPEATS]
//!
//! For a handset, build with `cargo ndk -t arm64-v8a`, push the binary from
//! `target/aarch64-linux-android/release/examples/` and run it there.

use std::path::Path;
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::persistence::persistent_engine_ffi::{TILE_GENERATION_HANDLE, persistent_engine_init};
use veloqrs::persistence::{TileGenerationHandle, with_persistent_engine};

/// The same 500-activity shape `one_added/500` builds: A, B and E fill what
/// the four fixed lifecycle activities leave.
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

/// The bucket C track shifted a few metres under a new id, so it overlaps
/// ground the library already draws.
fn added_activity(corpus: &LifecycleCorpus) -> LifecycleActivity {
    let mut added = corpus.bucket_c_single.clone();
    added.id = "phases-added".to_string();
    for point in &mut added.gps_points {
        point.latitude += 0.000_05;
    }
    added
}

fn await_requested_pass() -> TileGenerationHandle {
    let deadline = Instant::now() + Duration::from_secs(300);
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

/// Time a pass from the moment it is requested to its outcome.
fn timed(handle: TileGenerationHandle) -> (u32, Duration) {
    let start = Instant::now();
    let drawn = handle
        .recv_blocking()
        .expect("the pass reported its outcome");
    (drawn, start.elapsed())
}

/// Remove every zoom directory and the markers, as a wipe leaves the set.
fn wipe_tiles(tiles_dir: &Path) {
    for entry in std::fs::read_dir(tiles_dir).expect("tiles dir").flatten() {
        let path = entry.path();
        if path.is_dir() {
            std::fs::remove_dir_all(&path).expect("zoom dir removed");
        } else if matches!(
            path.file_name().and_then(|s| s.to_str()),
            Some("version.txt" | ".dirty")
        ) {
            std::fs::remove_file(&path).expect("marker removed");
        }
    }
}

fn main() {
    env_logger::Builder::new()
        .filter_module("veloqrs::persistence::tiles", log::LevelFilter::Info)
        .format_timestamp_millis()
        .init();
    let repeats: usize = std::env::args()
        .nth(1)
        .map(|s| s.parse().expect("REPEATS is a count"))
        .unwrap_or(3);

    let corpus = corpus();
    let baseline: Vec<_> = corpus.through_e().into_iter().cloned().collect();
    assert_eq!(baseline.len(), 500, "the baseline holds 500 activities");
    let added = added_activity(&corpus);

    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("phases.db");
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
    let (drawn, elapsed) = timed(await_requested_pass());
    eprintln!("RESULT first {drawn} tiles {} ms", elapsed.as_millis());

    for run in 1..=repeats {
        wipe_tiles(&tiles_dir);
        let handle = with_persistent_engine(|engine| {
            engine.mark_heatmap_dirty();
            engine.generate_tiles_background()
        })
        .expect("engine installed")
        .expect("a pass started");
        let (drawn, elapsed) = timed(handle);
        assert!(drawn > 0, "the cold pass drew no tiles");
        eprintln!("RESULT cold {run} {drawn} tiles {} ms", elapsed.as_millis());
    }

    for run in 1..=repeats {
        let stored = Instant::now();
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
        let pass = await_requested_pass();
        let swept = stored.elapsed();
        let (drawn, elapsed) = timed(pass);
        assert!(drawn > 0, "the added activity's tiles were not redrawn");
        eprintln!(
            "RESULT one_added {run} {drawn} tiles store+sweep {} ms pass {} ms",
            swept.as_millis(),
            elapsed.as_millis()
        );
        with_persistent_engine(|engine| engine.remove_activity(&added.id).expect("removed"))
            .expect("engine installed");
        let (_, _) = timed(await_requested_pass());
    }
}
