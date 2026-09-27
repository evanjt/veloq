//! What one page of `routes_screen_data` costs on a real library.
//!
//! Two figures for this read were in the tree and they disagreed by 300x.
//! `useRoutesScreenData.ts` carried a comment putting `get_section_summaries`
//! at 277-325 ms with real data, which is why the read sat behind
//! `InteractionManager`. The whole read timed 1.1 ms on the S22, and the first
//! page moved into the state initialiser on that figure. The
//! read is a render-phase read now, so its budget is the 100 ms tap-or-mount
//! ceiling.
//!
//! The whole read is timed, and so is each part of it, because the two figures
//! are only reconcilable if they measured different code: the catalogue-wide
//! summary reads happen before the page is taken, so paging never made them
//! cheaper.
//!
//! Cold is the first call after `load()`, warm is the median of the rest.
//! Nothing asserts, it prints a table.
//!
//! On the S22, which is where the budgets are:
//!
//!     cargo bench -p veloqrs --bench routes_screen_read_cost --no-run --target aarch64-linux-android
//!     adb push <the binary> /data/local/tmp/
//!     adb shell "cd /data/local/tmp && TMPDIR=/data/local/tmp VELOQ_DEVICE_DB=/data/local/tmp/routes.db ./routes_screen_read_cost"
//!
//! On a workstation, against a pull off the handset:
//!
//!     adb -s <handset> exec-out "run-as com.veloq.app.dev cat files/routes.db" > /tmp/routes.db
//!     VELOQ_DEVICE_DB=/tmp/routes.db cargo bench -p veloqrs --bench routes_screen_read_cost

use std::path::PathBuf;
use std::time::{Duration, Instant};

use veloqrs::{FfiGroupSort, FfiRoutesScreenQuery, PersistentEngine};

/// Samples per figure, the handset budget table's method, so the numbers compare.
const SAMPLES: usize = 7;

fn corpus_source() -> Option<PathBuf> {
    let Ok(p) = std::env::var("VELOQ_DEVICE_DB") else {
        eprintln!("skipped: no VELOQ_DEVICE_DB, so there is no corpus to measure");
        return None;
    };
    let named = PathBuf::from(&p);
    if named.exists() {
        return Some(named);
    }
    eprintln!("skipped: VELOQ_DEVICE_DB={p} does not exist");
    None
}

/// A copy of the corpus, sidecars and all, so the athlete's own library is
/// never migrated or written in place. The library runs under WAL, so the main
/// file alone is missing every commit since the last checkpoint and reads as a
/// smaller library rather than as a broken copy.
fn corpus() -> Option<(tempfile::TempDir, PathBuf)> {
    let src = corpus_source()?;
    let dir = tempfile::TempDir::new().expect("tempdir");
    let dst = dir.path().join("routes.db");
    std::fs::copy(&src, &dst).expect("copy corpus");
    for suffix in ["-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", src.display()));
        if from.exists() {
            std::fs::copy(&from, dir.path().join(format!("routes.db{suffix}")))
                .expect("copy the sidecar");
        }
    }
    Some((dir, dst))
}

fn median(mut xs: Vec<Duration>) -> Duration {
    xs.sort();
    xs[xs.len() / 2]
}

fn time<T>(mut f: impl FnMut() -> T) -> Duration {
    median(
        (0..SAMPLES)
            .map(|_| {
                let at = Instant::now();
                let out = f();
                let d = at.elapsed();
                std::hint::black_box(out);
                d
            })
            .collect(),
    )
}

/// The query the screen sends: a page of fifty each, the orders the lists open
/// in, and the minimum group size `useRoutesScreenData.ts` passes, which the
/// type's own default does not carry.
fn screen_query() -> FfiRoutesScreenQuery {
    FfiRoutesScreenQuery {
        min_group_activity_count: 2,
        group_sort: FfiGroupSort::Activities,
        ..Default::default()
    }
}

fn main() {
    let Some((_dir, path)) = corpus() else { return };

    let started = Instant::now();
    let mut engine = match PersistentEngine::new(path.to_str().unwrap()) {
        Ok(engine) => engine,
        Err(e) => {
            eprintln!("skipped: the corpus does not open: {e:?}");
            return;
        }
    };
    engine.load().expect("load the catalogue");
    println!("open, migrate and load: {:?}", started.elapsed());

    let at = Instant::now();
    let first = engine.get_routes_screen_data(screen_query());
    let cold = at.elapsed();
    println!(
        "{} activities, {} groups, {} sections in the corpus",
        first.activity_count, first.group_count, first.section_count
    );
    println!(
        "page returned: {} groups, {} sections\n",
        first.groups.len(),
        first.sections.len()
    );

    let whole = time(|| engine.get_routes_screen_data(screen_query()));
    let sections = time(|| engine.get_section_summaries());
    let groups = time(|| engine.get_group_summaries());
    let retired = time(|| engine.get_retired_section_count());

    println!("median of {SAMPLES}, warm");
    println!("  {:<34} {:>10.2?}", "routes_screen_data, whole", whole);
    println!("  {:<34} {:>10.2?}", "get_section_summaries", sections);
    println!("  {:<34} {:>10.2?}", "get_group_summaries", groups);
    println!("  {:<34} {:>10.2?}", "get_retired_section_count", retired);
    println!("\n  {:<34} {:>10.2?}", "routes_screen_data, cold", cold);
}
