//! What the strength tab's one read costs, against the 100 ms a mount allows.
//!
//! `C89` replaced the tab's three engine reads with one `get_screen_data`, so
//! the period read, the four trailing-week reads and the aggregation now happen
//! together on the mount path, and the per-muscle exercise aggregation that used
//! to wait for a selection no longer does. `I91`'s table has a row for every
//! other screen read and none for this one.
//!
//! Desktop timings are not handset timings. What transfers is the split between
//! the parts and how each one grows, which is what decides whether the exercise
//! aggregation belongs at mount or behind the selection.
//!
//! The clock is anchored to the newest activity in the corpus rather than to
//! now: a corpus months old measured against today's date takes the empty path
//! through every window and measures nothing.
//!
//! Ignored by default. Run in release, on a quiet machine, twice:
//!   cargo test --release -p veloqrs --bench strength_screen_cost -- --ignored --nocapture
//!
//! The corpus is a real `routes.db`, named by `VELOQ_DEVICE_DB`, and the bench
//! is skipped without one:
//!
//!     adb -s <handset> shell "run-as com.veloq.app.dev cat files/routes.db" > /tmp/routes.db
//!     VELOQ_DEVICE_DB=/tmp/routes.db cargo bench -p veloqrs --bench strength_screen_cost

use std::path::PathBuf;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::fit::FitExerciseSet;
use veloqrs::objects::strength::{
    aggregate_strength_sets, exercises_by_muscle, strength_screen_data,
};

const DAY: i64 = 86_400;
/// The widest period the tab offers, which is the one worth measuring.
const PERIOD_DAYS: i64 = 180;
/// How many trailing weeks the progression charts cover.
const PROGRESSION_WEEKS: i64 = 4;

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

/// A writable copy, since the engine opens read-write and the corpus is the
/// athlete's own file.
fn corpus() -> Option<(PersistentEngine, TempDir)> {
    let src = corpus_source()?;
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    std::fs::copy(&src, &path).expect("copy corpus");
    match PersistentEngine::new(path.to_str().unwrap()) {
        Ok(engine) => Some((engine, dir)),
        Err(e) => {
            eprintln!("skipped: the corpus will not open: {e:?}");
            None
        }
    }
}

/// The newest activity date in the corpus, which stands in for "now".
fn newest_activity(engine_path: &std::path::Path) -> i64 {
    let db = Connection::open(engine_path).expect("open for max date");
    db.query_row("SELECT MAX(date) FROM activity_metrics", [], |r| r.get(0))
        .expect("max date")
}

fn time<T>(label: &str, mut f: impl FnMut() -> T) -> (T, Duration) {
    let start = Instant::now();
    let out = f();
    let elapsed = start.elapsed();
    println!("{label:<46} {:>9.2} ms", elapsed.as_secs_f64() * 1000.0);
    (out, elapsed)
}

/// The trailing weeks the tab asks for, oldest first, as `getTrailingWeekRanges`
/// builds them.
fn week_ranges(now: i64) -> Vec<(i64, i64)> {
    (0..PROGRESSION_WEEKS)
        .rev()
        .map(|i| {
            let end = now - i * 7 * DAY;
            (end - 6 * DAY, end)
        })
        .collect()
}

#[test]
#[ignore]
fn strength_screen_data_split_by_part() {
    let Some((mut engine, dir)) = corpus() else {
        return;
    };
    let path = dir.path().join("routes.db");
    let now = newest_activity(&path);
    let period_start = now - PERIOD_DAYS * DAY;
    let weeks = week_ranges(now);

    let sets = engine
        .get_exercise_sets_in_range(period_start, now)
        .expect("period sets");
    let activities: usize = {
        let mut ids: Vec<&str> = sets.iter().map(|(id, _)| id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        ids.len()
    };
    println!(
        "corpus: {} sets over {PERIOD_DAYS} days across {activities} activities, anchored at {now}",
        sets.len()
    );
    if sets.is_empty() {
        println!("nothing to measure: the corpus holds no strength sets in the period");
        return;
    }

    // Warm the page cache once, so the first part measured does not carry the
    // cost of opening the file for all of them.
    let _ = engine.get_exercise_sets_in_range(period_start, now);

    let (_, whole) = time("get_screen_data (the whole read)", || {
        let period = engine
            .get_exercise_sets_in_range(period_start, now)
            .expect("period");
        let weekly = weeks
            .iter()
            .map(|(s, e)| {
                aggregate_strength_sets(&engine.get_exercise_sets_in_range(*s, *e).expect("week"))
            })
            .collect();
        strength_screen_data(&period, PERIOD_DAYS as u32, weekly)
    });

    let (period, period_read) = time("  the period's rows", || {
        engine
            .get_exercise_sets_in_range(period_start, now)
            .expect("period")
    });
    let (_, week_reads) = time("  the four weeks' rows, aggregated", || {
        weeks
            .iter()
            .map(|(s, e)| {
                aggregate_strength_sets(&engine.get_exercise_sets_in_range(*s, *e).expect("week"))
            })
            .collect::<Vec<_>>()
    });
    let (summary, summary_agg) = time("  the period aggregated by muscle", || {
        aggregate_strength_sets(&period)
    });
    let (by_muscle, exercise_agg) = time("  the exercises behind every muscle", || {
        exercises_by_muscle(&period, PERIOD_DAYS as u32)
    });

    println!(
        "shape: {} muscles with volume, {} muscles with exercises, {} exercise rows in all",
        summary.muscle_volumes.len(),
        by_muscle.len(),
        by_muscle.iter().map(|m| m.exercises.len()).sum::<usize>()
    );
    println!(
        "reads are {:.0}% of the whole, the aggregation {:.0}%",
        100.0 * (period_read + week_reads).as_secs_f64() / whole.as_secs_f64(),
        100.0 * (summary_agg + exercise_agg).as_secs_f64() / whole.as_secs_f64()
    );

    // A mount allows 100 ms (`I91`). Desktop is not the handset, so this is a
    // tripwire on the shape rather than the acceptance: a read that is already
    // over budget here is over it there too.
    assert!(
        whole < Duration::from_millis(100),
        "the strength screen read took {:.1} ms on this machine, over the 100 ms a mount allows",
        whole.as_secs_f64() * 1000.0
    );
}

/// A library's worth of sets, spread over `activities` sessions and the
/// exercises a lifter actually repeats. The corpus on the handset holds one
/// strength session, so the shape of the aggregation is measured here instead.
fn synthetic(sets: usize, activities: usize) -> Vec<(String, FitExerciseSet)> {
    // Bench Press, Curl, Squat, Deadlift, Row, Triceps Extension, Pull Up,
    // Shoulder Press: eight a session rotates through, each reaching a
    // different set of muscles.
    const CATEGORIES: [u16; 8] = [0, 7, 29, 8, 23, 30, 21, 25];
    (0..sets)
        .map(|i| {
            (
                format!("act-{}", i % activities.max(1)),
                FitExerciseSet {
                    set_order: i as u32,
                    exercise_category: CATEGORIES[i % CATEGORIES.len()],
                    exercise_name: None,
                    set_type: 0,
                    repetitions: Some(8),
                    weight_kg: Some(60.0),
                    duration_secs: None,
                    start_time: None,
                },
            )
        })
        .collect()
}

/// How the aggregation grows, which is the half that moved onto the mount path.
///
/// No corpus needed, so this runs anywhere. A heavy lifter at five sessions a
/// week and twenty-five sets a session is about 3,000 sets over six months, so
/// 10,000 is well past what a real library holds.
#[test]
#[ignore]
fn the_aggregation_grows_with_the_sets() {
    for (sets, activities) in [(100, 5), (1_000, 40), (3_000, 120), (10_000, 400)] {
        let rows = synthetic(sets, activities);
        let (_, summary) = time(&format!("{sets:>6} sets: aggregate_strength_sets"), || {
            aggregate_strength_sets(&rows)
        });
        let (by_muscle, exercises) = time(&format!("{sets:>6} sets: exercises_by_muscle"), || {
            exercises_by_muscle(&rows, 180)
        });
        println!(
            "        {} muscles, {} exercise rows, {:.2} ms for both",
            by_muscle.len(),
            by_muscle.iter().map(|m| m.exercises.len()).sum::<usize>(),
            (summary + exercises).as_secs_f64() * 1000.0
        );
    }
}
