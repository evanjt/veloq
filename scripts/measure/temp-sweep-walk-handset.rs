//! Times the stale temp file sweep a tile store path hand-over runs on the
//! calling thread, on a handset's own filesystem, before and after the
//! directory cache is pushed out.
//!
//! The walk is the one in `atomic_file::sweep_stale_temp_files`, copied here
//! so the program builds with `rustc` alone. The tree has the store's shape,
//! `<source>/<z>/<x>/<y>.<ext>` plus a sidecar per source, three sources with
//! most tiles at the deep zooms and eight tiles per column. A rebuild-shaped
//! walk that reads `metadata` for every file is timed beside it, because its
//! 40k-file figure is known on the handset and checks the instrument.
//!
//! Build for the handset and the host:
//!
//!     NDK=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin
//!     rustc -O --target aarch64-linux-android -C linker=$NDK/aarch64-linux-android24-clang \
//!       -o /tmp/temp-sweep-walk-handset scripts/measure/temp-sweep-walk-handset.rs
//!     rustc -O -o /tmp/temp-sweep-walk-host scripts/measure/temp-sweep-walk-handset.rs
//!
//! Run, under the device lock, with `files` above zero to build the tree and
//! time it warm, then at zero after the cache has been pushed out, so the first
//! sweep is the first touch of the tree:
//!
//!     adb push /tmp/temp-sweep-walk-handset /data/local/tmp/tsw
//!     adb shell /data/local/tmp/tsw /data/local/tmp/tsw-20000 20000 1
//!     adb shell 'for i in 1 2 3 4 5 6 7 8; do dd if=/dev/zero of=/data/local/tmp/tsw-fill-$i bs=4m count=512; done;
//!                for i in 1 2 3 4 5 6 7 8; do cat /data/local/tmp/tsw-fill-$i > /dev/null; done'
//!     adb shell /data/local/tmp/tsw /data/local/tmp/tsw-20000 0 3
//!     adb shell rm -rf /data/local/tmp/tsw*
//!
//! Without root the cache cannot be dropped outright, so the pushed-out figure
//! sits between a warm launch and one after a reboot. Every run is printed in
//! milliseconds.

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

fn metadata_walk(dir: &Path) -> (usize, u64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };
    let mut files = 0;
    let mut bytes = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let (f, b) = metadata_walk(&path);
            files += f;
            bytes += b;
        } else if let Ok(meta) = entry.metadata() {
            files += 1;
            bytes += meta.len();
        }
    }
    (files, bytes)
}

fn build(root: &Path, files: usize) {
    let sources: [(&str, usize); 3] = [("openmaptiles", 70), ("terrain", 20), ("ne2_shaded", 10)];
    for (source, share) in sources {
        let mut left = files * share / 100;
        let mut z: u32 = 14;
        while left > 0 && z >= 4 {
            // Deeper zooms hold more: halve the share each level up.
            let at_level = if z == 4 { left } else { (left + 1) / 2 };
            let mut x = 0;
            let mut placed = 0;
            while placed < at_level {
                let dir = root.join(source).join(z.to_string()).join(x.to_string());
                fs::create_dir_all(&dir).expect("mkdir");
                for y in 0..8 {
                    if placed >= at_level {
                        break;
                    }
                    fs::write(dir.join(format!("{y}.pbf")), b"x").expect("write");
                    placed += 1;
                }
                x += 1;
            }
            left -= at_level;
            z -= 1;
        }
        fs::write(root.join(source).join("index.json"), b"{}").expect("write");
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = PathBuf::from(args.get(1).expect("root"));
    let files: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let runs: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(3);
    if files > 0 {
        let started = Instant::now();
        build(&root, files);
        println!("built {files} files in {} ms", started.elapsed().as_millis());
    }
    // The sweep goes first: it is the launch call, and a count beforehand
    // would warm the directory cache the first run is meant to find as it is.
    for run in 0..runs {
        let started = Instant::now();
        let removed = sweep_stale_temp_files(&root, Duration::from_secs(3600));
        println!(
            "sweep run {run}: {} ms (removed {removed})",
            started.elapsed().as_millis()
        );
    }
    for run in 0..runs {
        let started = Instant::now();
        let (f, b) = metadata_walk(&root);
        println!(
            "metadata walk run {run}: {} ms ({f} files, {b} bytes)",
            started.elapsed().as_millis()
        );
    }
}
