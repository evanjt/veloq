//! What choosing a route's representative costs on a well-ridden route.
//!
//! The choice measures every member again against the new representative's
//! full stored track, so its cost grows with the member count and with the
//! square of the track length under a brute-force average minimum distance.
//! This times `set_route_representative` on routes of 5, 20 and 60 members at
//! 2,100 points a track, beside the brute-force kernel over the same pairs, and
//! takes the peak heap the choice adds. The distance evaluations per choice
//! are pinned by the unit tests beside `persistence/track_index.rs`, which
//! hold them under a tree descent per point.
//!
//! The corpus is synthetic: each member is one corridor offset by half a metre
//! from the last, so every size groups into one route. Cold is the first
//! choice after grouping, warm is the median of the rest. Nothing asserts, it
//! prints a table.
//!
//! On a workstation:
//!
//!     cargo bench -p veloqrs --bench route_representative_cost
//!
//! On a handset, which is where the budgets are, naming the build in the report:
//!
//!     cargo bench -p veloqrs --bench route_representative_cost --no-run --target aarch64-linux-android
//!     adb push <the binary> /data/local/tmp/
//!     adb shell "cd /data/local/tmp && TMPDIR=/data/local/tmp ./route_representative_cost"

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use rayon::prelude::*;
use tracematch::GpsPoint;
use tracematch::matching::average_min_distance;
use veloqrs::PersistentEngine;

/// Live and peak heap across every thread, since the pairs run on the rayon pool.
struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

fn grow(bytes: usize) {
    let live = LIVE.fetch_add(bytes, Ordering::Relaxed) + bytes;
    PEAK.fetch_max(live, Ordering::Relaxed);
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        grow(layout.size());
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if new_size >= layout.size() {
            grow(new_size - layout.size());
        } else {
            LIVE.fetch_sub(layout.size() - new_size, Ordering::Relaxed);
        }
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

const POINTS: usize = 2_100;
const SAMPLES: usize = 5;

fn member(index: usize) -> Vec<GpsPoint> {
    let east = (index as f64 * 0.5) / (111_320.0 * 47.0_f64.to_radians().cos());
    (0..POINTS)
        .map(|step| GpsPoint::new(47.0 + step as f64 * 0.0001, 7.0 + east))
        .collect()
}

fn median(mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

fn measure(members: usize) {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open");
    for index in 0..members {
        engine
            .add_activity(format!("m{index}"), member(index), "Ride".into())
            .expect("add activity");
    }
    let Some(group) = engine
        .get_groups()
        .iter()
        .find(|group| group.activity_ids.len() == members)
        .cloned()
    else {
        println!("  {members:>3} members: the corpus did not group into one route, skipped");
        return;
    };
    let others: Vec<&String> = group
        .activity_ids
        .iter()
        .filter(|id| **id != group.representative_id)
        .collect();

    let before = LIVE.load(Ordering::Relaxed);
    PEAK.store(before, Ordering::Relaxed);
    let at = Instant::now();
    engine
        .set_route_representative(&group.group_id, others[0])
        .expect("choose");
    let cold = at.elapsed();
    let peak = PEAK.load(Ordering::Relaxed).saturating_sub(before);

    let warm = median(
        (1..=SAMPLES)
            .map(|sample| {
                let chosen = others[sample % others.len()];
                let at = Instant::now();
                engine
                    .set_route_representative(&group.group_id, chosen)
                    .expect("choose");
                at.elapsed()
            })
            .collect(),
    );

    let representative = member(0);
    let tracks: Vec<Vec<GpsPoint>> = (1..members).map(member).collect();
    let at = Instant::now();
    let brute: f64 = tracks
        .par_iter()
        .map(|track| {
            average_min_distance(track, &representative)
                + average_min_distance(&representative, track)
        })
        .sum();
    let brute_elapsed = at.elapsed();
    std::hint::black_box(brute);

    println!(
        "  {members:>3} members  {:>10.2?} cold  {:>10.2?} warm  {:>8.2} MB peak  {:>10.2?} brute-force kernel",
        cold,
        warm,
        peak as f64 / 1_048_576.0,
        brute_elapsed
    );
}

fn main() {
    println!(
        "set_route_representative at {POINTS} points a track, {} rayon threads",
        rayon::current_num_threads()
    );
    for members in [5, 20, 60] {
        measure(members);
    }
}
