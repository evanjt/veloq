//! Times the stale temp file sweep a tile store path hand-over runs on the
//! calling thread, against synthetic tile trees of increasing size.
//!
//! The walk is the one in `atomic_file::sweep_stale_temp_files`, copied here
//! so the program builds with `rustc` alone and no crate build. The tree has
//! the store's shape, `<source>/<z>/<x>/<y>.<ext>` plus a sidecar per source,
//! with tiles spread over zoom levels the way a map viewport fills them.
//!
//! Build and run:
//!
//!     rustc -O -o /tmp/temp-sweep-walk scripts/measure/temp-sweep-walk.rs
//!     /tmp/temp-sweep-walk [tiles ...]
//!
//! Each line is the tile count, the directory count, the cold walk (first pass
//! after the tree is written) and the median of five warm passes, in ms. The
//! page cache is warm throughout, since the tree was just written, so every
//! figure is a lower bound on a handset after a reboot.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn sweep_stale_temp_files(dir: &Path, min_age: Duration) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            removed += sweep_stale_temp_files(&path, min_age);
        } else if kind.is_file()
            && path.extension().is_some_and(|e| e == "tmp")
            && entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age >= min_age)
            && fs::remove_file(&path).is_ok()
        {
            removed += 1;
        }
    }
    removed
}

/// Write `tiles` tiles under `root` across three sources, each column holding
/// about eight rows, which is what a phone-sized viewport leaves behind.
fn build_tree(root: &Path, tiles: usize) -> usize {
    const SOURCES: [(&str, &str); 3] = [("openmaptiles", "pbf"), ("terrain", "png"), ("ground", "jpg")];
    const ROWS_PER_COLUMN: usize = 8;
    const COLUMNS_PER_ZOOM: usize = 24;
    let mut dirs = 0;
    let per_source = tiles / SOURCES.len();
    for (source, ext) in SOURCES {
        let source_dir = root.join(source);
        fs::create_dir_all(&source_dir).unwrap();
        dirs += 1;
        fs::write(source_dir.join("index.bin"), [0u8; 4096]).unwrap();
        let mut written = 0;
        let mut z = 2u32;
        while written < per_source {
            let zoom_dir = source_dir.join(z.to_string());
            fs::create_dir_all(&zoom_dir).unwrap();
            dirs += 1;
            for x in 0..COLUMNS_PER_ZOOM {
                if written >= per_source {
                    break;
                }
                let column = zoom_dir.join(x.to_string());
                fs::create_dir_all(&column).unwrap();
                dirs += 1;
                for y in 0..ROWS_PER_COLUMN {
                    if written >= per_source {
                        break;
                    }
                    fs::write(column.join(format!("{y}.{ext}")), b"tile").unwrap();
                    written += 1;
                }
            }
            z += 1;
        }
    }
    dirs
}

fn time_walk(root: &Path) -> Duration {
    let started = Instant::now();
    let removed = sweep_stale_temp_files(root, Duration::from_secs(3600));
    assert_eq!(removed, 0, "a measurement tree holds no stale temp files");
    started.elapsed()
}

fn main() {
    let mut sizes: Vec<usize> = std::env::args().skip(1).filter_map(|a| a.parse().ok()).collect();
    if sizes.is_empty() {
        sizes = vec![1_000, 5_000, 20_000, 50_000, 100_000];
    }
    let base: PathBuf = std::env::temp_dir().join(format!("temp-sweep-walk-{}", std::process::id()));
    println!("{:>8} {:>6} {:>9} {:>9}", "tiles", "dirs", "cold ms", "warm ms");
    for tiles in sizes {
        let root = base.join(tiles.to_string());
        let dirs = build_tree(&root, tiles);
        let cold = time_walk(&root);
        let mut warm: Vec<Duration> = (0..5).map(|_| time_walk(&root)).collect();
        warm.sort();
        println!(
            "{:>8} {:>6} {:>9.1} {:>9.1}",
            tiles,
            dirs,
            cold.as_secs_f64() * 1e3,
            warm[2].as_secs_f64() * 1e3
        );
        fs::remove_dir_all(&root).unwrap();
    }
    let _ = fs::remove_dir_all(&base);
}
