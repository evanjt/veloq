//! What one grouping-preview run costs on a handset, at library size.
//!
//! The debounce in `useRouteGroupingPreview.ts` is a starting value, not a
//! measured one, and the only numbers behind it are x86 on a desktop. What the
//! debounce trades is how many runs a drag starts against how closely the paint
//! follows the knob, and neither is decidable without knowing what a run costs
//! on the phone.
//!
//! The poll cannot answer it: `GROUPING_POLL_INTERVAL_MS` is 250, the same
//! order as the number, so start-to-complete seen through the poll is quantised
//! to nothing useful. This times the engine call directly instead, which is why
//! it is an example rather than something read off a build.
//!
//! It runs against a copy of a real library, so the point counts and the
//! overlap between rides are the athlete's rather than a generator's. Pull one
//! off a debuggable build:
//!
//!     adb shell run-as com.veloq.app.dev cat files/routes.db > /tmp/routes.db
//!     adb push /tmp/routes.db /data/local/tmp/routes.db
//!
//! Usage, on the device:
//!   VELOQ_DB=/data/local/tmp/routes.db ./grouping_preview_cost
//!
//! Optional:
//!   VELOQ_RUNS=5   runs per strictness, default 3
//!
//! Build for the handset with `cargo ndk -t arm64-v8a build --release -p
//! veloqrs --example grouping_preview_cost`, push the binary, and delete it and
//! the database copy afterwards.

use std::time::Instant;

use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::route_grouping_preview::{PreviewPoll, PreviewStrictness};
use veloqrs::persistence::with_persistent_engine;

/// The two knobs the screen drags, at the ends and the middle of their ranges:
/// a looser match groups more and costs more, so one figure would not describe
/// the drag.
const STRICTNESS: [(f64, f64); 5] = [
    (50.0, 200.0),
    (60.0, 150.0),
    (70.0, 100.0),
    (80.0, 75.0),
    (90.0, 50.0),
];

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(|a, b| a.partial_cmp(b).expect("no NaN"));
    xs[xs.len() / 2]
}

fn main() {
    let db = std::env::var("VELOQ_DB").expect("VELOQ_DB names the database to group");
    let runs: usize = std::env::var("VELOQ_RUNS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3);

    assert!(
        persistent_engine_init(db.clone()),
        "engine did not open {db}"
    );
    let activities = with_persistent_engine(|e| e.activity_count()).expect("engine");
    println!("{db}: {activities} activities, {runs} runs per strictness");
    println!();
    println!("min_match  endpoint   walk_ms   group_ms   total_ms   groups");

    for (min_match_percentage, endpoint_threshold) in STRICTNESS {
        let mut walks = Vec::new();
        let mut groups_ms = Vec::new();
        let mut group_count = 0usize;
        for _ in 0..runs {
            // The signature collection happens inside the engine call, on this
            // thread; the grouping runs on the thread it spawns. Timed apart,
            // because only the first is a frame the athlete loses.
            let t0 = Instant::now();
            let mut handle = with_persistent_engine(|e| {
                e.grouping_preview_background(PreviewStrictness {
                    min_match_percentage,
                    endpoint_threshold,
                })
            })
            .expect("engine")
            .expect("a library with signatures");
            let walk = t0.elapsed();

            let t1 = Instant::now();
            loop {
                match handle.poll_status() {
                    PreviewPoll::Running => std::thread::yield_now(),
                    PreviewPoll::Complete => break,
                    other => panic!(
                        "run ended as {}",
                        match other {
                            PreviewPoll::Cancelled => "cancelled",
                            PreviewPoll::Died => "died",
                            _ => "running",
                        }
                    ),
                }
            }
            let grouping = t1.elapsed();
            group_count = handle.take_groups().map(|g| g.len()).unwrap_or(0);

            walks.push(walk.as_secs_f64() * 1000.0);
            groups_ms.push(grouping.as_secs_f64() * 1000.0);
        }
        let w = median(walks);
        let g = median(groups_ms);
        println!(
            "{min_match_percentage:>9.0}  {endpoint_threshold:>8.0}  {w:>8.1}  {g:>9.1}  {:>9.1}  {group_count:>6}",
            w + g
        );
    }
}
