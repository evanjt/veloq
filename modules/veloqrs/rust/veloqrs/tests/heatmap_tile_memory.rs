//! What drawing one heatmap tile costs in memory.
//!
//! A pass draws its tiles on every worker of the pool at once, so whatever one
//! tile holds while it is drawn is held several times over. These pin that a
//! dense tile is drawn in a fixed handful of buffers whatever its track count.
//!
//! Run: `cargo test --test heatmap_tile_memory -p veloqrs`

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicUsize, Ordering};
use tracematch::GpsPoint;
use veloqrs::tiles;

// ------------------------------------------------------------ allocator

// Counted across the whole process, not per thread: a tile's ink may be laid on
// any worker of the pool, and a per-thread count would miss exactly that. This
// binary holds one test, so nothing else allocates while the count is armed.
static ARMED: AtomicBool = AtomicBool::new(false);
static LIVE: AtomicIsize = AtomicIsize::new(0);
static PEAK: AtomicIsize = AtomicIsize::new(0);
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

fn grew(bytes: usize, new_block: bool) {
    if !ARMED.load(Ordering::Relaxed) {
        return;
    }
    if new_block {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
    }
    let live = LIVE.fetch_add(bytes as isize, Ordering::Relaxed) + bytes as isize;
    PEAK.fetch_max(live, Ordering::Relaxed);
}

fn shrank(bytes: usize) {
    if ARMED.load(Ordering::Relaxed) {
        LIVE.fetch_sub(bytes as isize, Ordering::Relaxed);
    }
}

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        grew(layout.size(), true);
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        grew(layout.size(), true);
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        shrank(layout.size());
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if new_size >= layout.size() {
            grew(new_size - layout.size(), false);
        } else {
            shrank(layout.size() - new_size);
        }
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// What `f` allocates, as the peak bytes live above where it started and the
/// number of blocks it asked for.
fn measure<R>(f: impl FnOnce() -> R) -> (R, isize, usize) {
    LIVE.store(0, Ordering::SeqCst);
    PEAK.store(0, Ordering::SeqCst);
    ALLOCATIONS.store(0, Ordering::SeqCst);
    ARMED.store(true, Ordering::SeqCst);
    let out = f();
    ARMED.store(false, Ordering::SeqCst);
    (
        out,
        PEAK.load(Ordering::SeqCst),
        ALLOCATIONS.load(Ordering::SeqCst),
    )
}

// ------------------------------------------------------------ fixtures

/// A straight track `points` long at 10 m spacing, centred on the given point.
fn straight_track(lat: f64, lng: f64, points: usize, bearing_deg: f64) -> Vec<GpsPoint> {
    let br = bearing_deg.to_radians();
    let d_lat = 10.0 * br.cos() / 111_320.0;
    let d_lng = 10.0 * br.sin() / (111_320.0 * lat.to_radians().cos());
    let half = points as f64 / 2.0;
    (0..points)
        .map(|i| {
            let k = i as f64 - half;
            GpsPoint::new(lat + d_lat * k, lng + d_lng * k)
        })
        .collect()
}

/// `count` tracks over the same corridor, each turned and shifted a little.
fn overlapping_tracks(count: usize, lat: f64, lng: f64) -> Vec<Vec<GpsPoint>> {
    (0..count)
        .map(|i| {
            let i = i as f64;
            let bearing = 45.0 + i * 0.09;
            straight_track(lat + i * 0.000_02, lng + i * 0.000_03, 2_000, bearing)
        })
        .collect()
}

const MIB: isize = 1024 * 1024;

/// Scenario: the tile over home ground, crossed by five hundred rides of two
/// thousand points each, drawn at a street zoom from tracks the pass has
/// already placed on the map.
///
/// Expected behaviour: drawing it holds no more than one tile's working
/// buffers at once and asks for a fixed handful of blocks, rather than one
/// fresh buffer for every share of tracks the pool splits it into.
#[test]
fn a_dense_tile_is_drawn_in_a_fixed_handful_of_buffers() {
    let (lat, lng, zoom) = (47.37, 8.55, 12);
    let rides = overlapping_tracks(500, lat, lng);
    let placed: Vec<tiles::ProjectedTrack> = rides
        .iter()
        .map(|t| tiles::ProjectedTrack::new(t))
        .collect();
    let placed: Vec<&tiles::ProjectedTrack> = placed.iter().collect();
    let x = tiles::lon_to_tile_x(lng, zoom).floor() as u32;
    let y = tiles::lat_to_tile_y(lat, zoom).floor() as u32;

    // Once outside the count, so the pool and every lazy table exist before it.
    assert!(tiles::draw_heatmap_tile(zoom, x, y, &placed).is_some());

    let (png, peak, allocations) = measure(|| tiles::draw_heatmap_tile(zoom, x, y, &placed));
    assert!(png.is_some());
    assert!(
        peak <= 2 * MIB,
        "peak rise {peak} bytes over {allocations} allocations"
    );
    assert!(
        allocations <= 8,
        "{allocations} allocations, peak rise {peak} bytes"
    );
}
