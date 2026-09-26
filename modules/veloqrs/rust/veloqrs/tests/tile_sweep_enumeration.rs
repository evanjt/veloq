//! Which way of finding the tiles to invalidate is cheaper, and at what density
//! the answer changes.
//!
//! The rectangle walk asks the filesystem about two paths per tile in the
//! bounding box at every zoom, so its cost is the rectangle's area whether or
//! not anything is drawn there. Reading each zoom's directory and intersecting
//! what is there with the rectangle costs what is on disk instead. The
//! crossover was the open question, and there is not one: listing wins at every
//! density measured, including a full cache. So the read_dir side here is what
//! `invalidate_tiles_in_bounds` now does, and the rectangle side is kept as the
//! thing it is measured against.
//!
//! What this does not measure is a phone's filesystem. These are desktop
//! numbers on a tmpfs-backed temporary directory, so they establish the shape
//! and the crossover density, not a budget.
//!
//! Ignored by default: it creates tens of thousands of files per case.
//! Run: `cargo test --test tile_sweep_enumeration -p veloqrs -- --ignored --nocapture`

use std::fs;
use std::path::Path;
use std::time::Instant;

use tempfile::TempDir;
use veloqrs::tiles::{EMPTY_MARKER_EXT, tiles_for_bounds};

/// The zoom span the default config sweeps.
const MIN_ZOOM: u8 = 1;
const MAX_ZOOM: u8 = 17;

/// A bounding box the size of one ride around a city, which is what a single
/// activity's invalidation covers.
const BOX: (f64, f64, f64, f64) = (46.50, 46.58, 6.58, 6.70);

/// A long ride, the size the 110,000-probe figure this was filed on describes.
const LONG_BOX: (f64, f64, f64, f64) = (46.50, 47.00, 6.60, 7.35);

fn tile_path(base: &Path, z: u8, x: u32, y: u32, extension: &str) -> std::path::PathBuf {
    base.join(z.to_string())
        .join(x.to_string())
        .join(format!("{y}.{extension}"))
}

/// Lay down `one_in` of the tiles the rectangle covers, so the cache is dense
/// relative to the box at 1 and very sparse at 64.
fn seed(base: &Path, area: (f64, f64, f64, f64), one_in: usize) -> usize {
    let mut written = 0usize;
    for z in MIN_ZOOM..=MAX_ZOOM {
        for (i, (x, y)) in tiles_for_bounds(area.0, area.1, area.2, area.3, z)
            .into_iter()
            .enumerate()
        {
            if i % one_in != 0 {
                continue;
            }
            let path = tile_path(base, z, x, y, "png");
            fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            fs::write(&path, b"x").expect("write");
            written += 1;
        }
    }
    written
}

/// How many paths the rectangle walk asks the filesystem about: two per tile.
fn rectangle_probes(area: (f64, f64, f64, f64)) -> usize {
    (MIN_ZOOM..=MAX_ZOOM)
        .map(|z| tiles_for_bounds(area.0, area.1, area.2, area.3, z).len() * 2)
        .sum()
}

/// The sweep as it stands: probe every candidate in the rectangle.
fn by_rectangle(base: &Path, area: (f64, f64, f64, f64)) -> usize {
    let mut found = 0usize;
    for z in MIN_ZOOM..=MAX_ZOOM {
        for (x, y) in tiles_for_bounds(area.0, area.1, area.2, area.3, z) {
            for extension in ["png", EMPTY_MARKER_EXT] {
                if tile_path(base, z, x, y, extension).exists() {
                    found += 1;
                }
            }
        }
    }
    found
}

/// The proposal: enumerate what is on disk and intersect with the rectangle.
fn by_read_dir(base: &Path, area: (f64, f64, f64, f64)) -> usize {
    let mut found = 0usize;
    for z in MIN_ZOOM..=MAX_ZOOM {
        let tiles = tiles_for_bounds(area.0, area.1, area.2, area.3, z);
        let (x_min, x_max) = match (
            tiles.iter().map(|t| t.0).min(),
            tiles.iter().map(|t| t.0).max(),
        ) {
            (Some(lo), Some(hi)) => (lo, hi),
            _ => continue,
        };
        let (y_min, y_max) = (
            tiles.iter().map(|t| t.1).min().unwrap_or(0),
            tiles.iter().map(|t| t.1).max().unwrap_or(0),
        );
        let zoom_dir = base.join(z.to_string());
        let Ok(xs) = fs::read_dir(&zoom_dir) else {
            continue;
        };
        for x_entry in xs.flatten() {
            let Ok(x) = x_entry.file_name().to_string_lossy().parse::<u32>() else {
                continue;
            };
            if x < x_min || x > x_max {
                continue;
            }
            let Ok(ys) = fs::read_dir(x_entry.path()) else {
                continue;
            };
            for y_entry in ys.flatten() {
                let name = y_entry.file_name();
                let name = name.to_string_lossy();
                let Some((stem, _ext)) = name.rsplit_once('.') else {
                    continue;
                };
                let Ok(y) = stem.parse::<u32>() else { continue };
                if y >= y_min && y <= y_max {
                    found += 1;
                }
            }
        }
    }
    found
}

fn millis(f: impl FnOnce() -> usize) -> (usize, f64) {
    let start = Instant::now();
    let found = f();
    (found, start.elapsed().as_secs_f64() * 1000.0)
}

/// How large the rectangle actually is, per size of ride, since the figure this
/// was filed on was arithmetic nobody had checked.
#[test]
fn the_rectangle_grows_with_the_ride_not_with_the_library() {
    println!("box_degrees        tiles  probes");
    for (name, span) in [
        ("hill repeat  0.01", 0.01f64),
        ("city ride    0.10", 0.10),
        ("long ride    0.50", 0.50),
        ("touring day  1.50", 1.50),
    ] {
        let tiles: usize = (MIN_ZOOM..=MAX_ZOOM)
            .map(|z| tiles_for_bounds(46.5, 46.5 + span, 6.6, 6.6 + span * 1.5, z).len())
            .sum();
        println!("{name}  {tiles:11}  {:6}", tiles * 2);
    }
}

#[test]
#[ignore = "creates tens of thousands of files per case"]
fn where_read_dir_overtakes_the_rectangle_walk() {
    let candidates = rectangle_probes(BOX) / 2;
    println!(
        "the rectangle is {candidates} tiles over zooms {MIN_ZOOM} to {MAX_ZOOM}, \
         {} path probes a sweep",
        rectangle_probes(BOX)
    );
    println!("on_disk  density  rectangle_ms  read_dir_ms  winner");

    for one_in in [1usize, 4, 16, 64] {
        let dir = TempDir::new().expect("tempdir");
        let base = dir.path();
        let written = seed(base, BOX, one_in);

        // Each strategy twice, reporting the second, so the first case does not
        // pay for warming the directory cache the others then enjoy.
        by_rectangle(base, BOX);
        let (rect_found, rect_ms) = millis(|| by_rectangle(base, BOX));
        by_read_dir(base, BOX);
        let (dir_found, dir_ms) = millis(|| by_read_dir(base, BOX));

        println!(
            "{written:7}  {:6.1}%  {rect_ms:12.1}  {dir_ms:11.1}  {}",
            100.0 * written as f64 / candidates as f64,
            if dir_ms < rect_ms {
                "read_dir"
            } else {
                "rectangle"
            }
        );

        assert_eq!(
            rect_found, dir_found,
            "the two strategies found different tiles at one in {one_in}"
        );
        assert_eq!(rect_found, written, "every seeded tile should be found");
    }
}

/// The same comparison at the size of ride that figure was about, where
/// the rectangle is 98,000 tiles and the cache over it is sparse.
#[test]
#[ignore = "walks a 98,000-tile rectangle"]
fn a_long_rides_rectangle_against_a_sparse_cache() {
    let candidates = rectangle_probes(LONG_BOX) / 2;
    let dir = TempDir::new().expect("tempdir");
    let base = dir.path();
    let written = seed(base, LONG_BOX, 64);

    by_rectangle(base, LONG_BOX);
    let (rect_found, rect_ms) = millis(|| by_rectangle(base, LONG_BOX));
    by_read_dir(base, LONG_BOX);
    let (dir_found, dir_ms) = millis(|| by_read_dir(base, LONG_BOX));

    println!(
        "long ride: {candidates} candidate tiles, {written} on disk ({:.1}%), \
         rectangle {rect_ms:.1} ms, read_dir {dir_ms:.1} ms",
        100.0 * written as f64 / candidates as f64
    );

    assert_eq!(rect_found, dir_found, "the two strategies disagreed");
    assert_eq!(rect_found, written);
}
