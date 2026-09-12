//! What `activity_detail_data` costs as the number of sections an activity
//! crosses grows, measured on the athlete's own library rather than on one
//! activity.
//!
//! `I91` timed the bundle at 11.1 ms for a single activity and concluded the
//! mount budget was safe. The call does per-section work in three places, so
//! the figure that matters is the slope, not the average: a trace extraction
//! and an R-tree build per matched section (`persistence/screens.rs:325-350`),
//! a `get_section_performances_filtered` per section (`:356-361`), and a
//! `get_section` per section behind `get_sections_for_activity`
//! (`sections/queries.rs:166-170`).
//!
//! Nothing asserts, it prints a table.
//!
//! Run in release, on a quiet machine, twice:
//!   cargo bench -p veloqrs --bench activity_detail_cost
//!
//! The corpus is a real `routes.db`. Two can serve: the athlete's own fixture
//! under the gitignored `tests/fixtures/private/`, and a live pull off the
//! handset, which is current and opens where the fixture does not. Name the
//! pull with `VELOQ_DEVICE_DB` and it wins; otherwise the fixture is used, and
//! the bench is skipped when neither is there.
//!
//!     adb -s <handset> shell "run-as com.veloq.app.dev cat files/routes.db" > /tmp/routes.db
//!     VELOQ_DEVICE_DB=/tmp/routes.db cargo bench -p veloqrs --bench <name>

use std::path::PathBuf;
use std::time::{Duration, Instant};

use veloqrs::PersistentEngine;

const CORPUS: &str = "tests/fixtures/private/routes.db";

/// What `useActivityDetailData` passes, from `src/features/activity/...`.
const MIN_ROUTE_ACTIVITIES: u32 = 2;

/// A copy of the corpus in a temp directory, so the fixture is never migrated

/// Where the corpus comes from: `VELOQ_DEVICE_DB` if it names a file that
/// exists, else the gitignored private fixture. A pull off the handset is
/// current and opens through the engine, which the fixture does not, so it
/// wins when both are present.
fn corpus_source(fixture: &str) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("VELOQ_DEVICE_DB") {
        let named = PathBuf::from(&p);
        if named.exists() {
            return Some(named);
        }
        eprintln!("VELOQ_DEVICE_DB={p} does not exist, falling back to the fixture");
    }
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(fixture);
    if src.exists() {
        return Some(src);
    }
    eprintln!(
        "skipped: no VELOQ_DEVICE_DB and {} is not present",
        src.display()
    );
    None
}

/// A copy of the corpus in a temp directory, so neither source is migrated or
/// written in place.
fn corpus() -> Option<(tempfile::TempDir, PathBuf)> {
    let src = corpus_source(CORPUS)?;
    let dir = tempfile::TempDir::new().expect("tempdir");
    let dst = dir.path().join("routes.db");
    std::fs::copy(&src, &dst).expect("copy corpus");
    Some((dir, dst))
}

fn median(mut xs: Vec<Duration>) -> Duration {
    xs.sort();
    xs[xs.len() / 2]
}

fn main() {
    let Some((_dir, path)) = corpus() else { return };
    let started = Instant::now();
    // A corpus whose recorded version disagrees with what was applied aborts a
    // migration, and the engine then refuses the file. That is a fixture to fix,
    // not a measurement to report, so say which it was.
    let mut engine = match PersistentEngine::new(path.to_str().unwrap()) {
        Ok(engine) => engine,
        Err(e) => {
            eprintln!("skipped: the corpus does not open: {e:?}");
            return;
        }
    };
    // The catalogue lives in memory, and every read below goes through it.
    // Without this the bench reports a library of zero activities and prints an
    // empty table, which is what it did against a corpus that opened.
    engine.load().expect("load the catalogue");
    println!("open, migrate and load: {:?}", started.elapsed());

    let ids = engine.get_activity_ids();
    let mut by_sections: Vec<(String, usize)> = ids
        .iter()
        .map(|id| (id.clone(), engine.get_sections_for_activity(id).len()))
        .collect();
    by_sections.sort_by_key(|(_, n)| *n);

    let total: usize = by_sections.iter().map(|(_, n)| n).sum();
    println!(
        "{} activities, {} matches, most-crossed {}",
        by_sections.len(),
        total,
        by_sections.last().map(|(_, n)| *n).unwrap_or(0)
    );

    // The whole distribution, not one activity: the cheapest, the median, the
    // busiest, and the deciles between them.
    let picks: Vec<&(String, usize)> = if by_sections.is_empty() {
        Vec::new()
    } else {
        (0..=10)
            .map(|d| &by_sections[(by_sections.len() - 1) * d / 10])
            .collect()
    };

    println!("\n{:>9}  {:>10}  {:>10}", "sections", "cold", "warm");
    for (id, n) in picks {
        // Cold is a fresh engine, since `invalidate_perf_cache` is crate-private
        // and the LRU holds 8 entries against a loop that runs once per section.
        let mut cold_engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen corpus");
        cold_engine.load().expect("load the catalogue");
        let at = Instant::now();
        let _ = cold_engine.activity_detail_data(id, MIN_ROUTE_ACTIVITIES);
        let cold = at.elapsed();
        drop(cold_engine);

        let _ = engine.activity_detail_data(id, MIN_ROUTE_ACTIVITIES);
        let warm = median(
            (0..5)
                .map(|_| {
                    let at = Instant::now();
                    let _ = engine.activity_detail_data(id, MIN_ROUTE_ACTIVITIES);
                    at.elapsed()
                })
                .collect(),
        );

        println!("{n:>9}  {cold:>10.2?}  {warm:>10.2?}");
    }
}
