//! What the five section editors cost, and how much of it is the indicator tail.
//!
//! `B705` proposes moving `create`, `trim`, `reset_bounds`, `expand_bounds` and
//! `exclude_activity` onto their own thread with progress and a terminal state. That is five
//! handles, five polling hooks and a progress state per editor. Each of the five also tail-calls
//! `recompute_activity_indicators` (`objects/sections.rs:370,385,408,427` and
//! `sections/mutations.rs:241`), which deletes `activity_indicators` whole and rebuilds it from
//! every section in the library, scoped to nothing.
//!
//! So the number that decides `B705`'s size is the split: if the tail is the cost, scoping the
//! rebuild is one file and no FFI change, and the job shape is not needed.
//!
//! The corpus is a real database, named by `VELOQ_DEVICE_DB`. Each editor mutates, so each gets
//! its own copy of it. Nothing here is asserted; it prints.
//!
//! Run in release, twice, on a quiet machine:
//!   VELOQ_DEVICE_DB=/path/to/routes.db \
//!     cargo test --release -p veloqrs --bench section_editor_cost -- --ignored --nocapture

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

/// The tap budget a screen edit has to stay inside.
const TAP_BUDGET_MS: f64 = 100.0;

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn source() -> Option<PathBuf> {
    match std::env::var("VELOQ_DEVICE_DB") {
        Ok(p) if Path::new(&p).exists() => Some(PathBuf::from(p)),
        Ok(p) => {
            eprintln!("skipped: VELOQ_DEVICE_DB={p} does not exist");
            None
        }
        Err(_) => {
            eprintln!("skipped: set VELOQ_DEVICE_DB to a real routes.db");
            None
        }
    }
}

/// A fresh copy of the corpus, because every editor here writes to it.
fn fresh(src: &Path) -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    std::fs::copy(src, &path).expect("copy corpus");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    (engine, dir)
}

/// The most travelled section, and one of its attempts. The editors are worth
/// measuring against the row with the most junction behind it, not the least.
fn target(src: &Path) -> (String, String, u32, u32) {
    let db = Connection::open(src).expect("open corpus");
    let section: String = db
        .query_row(
            "SELECT section_id FROM section_activities
             GROUP BY section_id ORDER BY COUNT(*) DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .expect("busiest section");
    let (activity, start, end): (String, u32, u32) = db
        .query_row(
            "SELECT activity_id, start_index, end_index FROM section_activities
             WHERE section_id = ?1 AND excluded = 0 LIMIT 1",
            rusqlite::params![section],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("an attempt on it");
    (section, activity, start, end)
}

fn counts(src: &Path) -> (i64, i64, i64, i64) {
    let db = Connection::open(src).expect("open corpus");
    let one = |sql: &str| db.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(-1);
    (
        one("SELECT COUNT(*) FROM activity_metrics"),
        one("SELECT COUNT(*) FROM sections"),
        one("SELECT COUNT(*) FROM section_activities"),
        one("SELECT COUNT(*) FROM activity_indicators"),
    )
}

/// The tail every editor calls, timed twice on one engine. The first pass pays
/// `backfill_null_lap_times`, which finds nothing on the second, so the
/// difference is the backfill and the second run is the rebuild alone.
fn time_tail(engine: &PersistentEngine) -> (Duration, Duration) {
    let t0 = Instant::now();
    engine.recompute_activity_indicators().expect("recompute");
    let first = t0.elapsed();
    let t1 = Instant::now();
    engine.recompute_activity_indicators().expect("recompute");
    let second = t1.elapsed();
    (first, second)
}

fn report(label: &str, editor: Duration, tail: Duration) {
    let total = editor + tail;
    let verdict = if ms(total) > TAP_BUDGET_MS {
        "OVER"
    } else {
        "ok"
    };
    println!(
        "{label:<20} editor {:>8.1}ms  tail {:>8.1}ms  total {:>8.1}ms  {verdict}",
        ms(editor),
        ms(tail),
        ms(total)
    );
}

#[test]
#[ignore]
fn section_editor_split_by_editor() {
    let Some(src) = source() else { return };
    let (activities, sections, junction, indicators) = counts(&src);
    println!(
        "corpus: {activities} activities, {sections} sections, {junction} junction rows, \
         {indicators} indicators; tap budget {TAP_BUDGET_MS:.0} ms"
    );

    let (section, activity, start, end) = target(&src);
    println!("target: section {section}, attempt {activity} over [{start}, {end}]\n");

    // The tail on its own, first, since it is what every editor below adds.
    {
        let (engine, _dir) = fresh(&src);
        let (first, second) = time_tail(&engine);
        println!(
            "recompute_activity_indicators  first {:>8.1}ms  again {:>8.1}ms  \
             (the difference is backfill_null_lap_times)\n",
            ms(first),
            ms(second)
        );
    }

    {
        let (mut engine, _dir) = fresh(&src);
        let line = engine.get_section_polyline(&section);
        let points = (line.len() / 2) as u32;
        // A tenth off each end, which is the shape of a real trim.
        let (s, e) = (points / 10, points - points / 10 - 1);
        let t = Instant::now();
        engine.trim_section(&section, s, e).expect("trim");
        let editor = t.elapsed();
        let t = Instant::now();
        engine.recompute_activity_indicators().expect("recompute");
        report("trim", editor, t.elapsed());
    }

    {
        let (mut engine, _dir) = fresh(&src);
        let line = engine.get_section_polyline(&section);
        let points = (line.len() / 2) as u32;
        engine
            .trim_section(&section, points / 10, points - points / 10 - 1)
            .expect("trim first");
        let t = Instant::now();
        engine.reset_section_bounds(&section).expect("reset");
        let editor = t.elapsed();
        let t = Instant::now();
        engine.recompute_activity_indicators().expect("recompute");
        report("reset_bounds", editor, t.elapsed());
    }

    {
        let (mut engine, _dir) = fresh(&src);
        let t = Instant::now();
        let done = engine.expand_section_bounds(&section, &activity, start, end);
        let editor = t.elapsed();
        let t = Instant::now();
        engine.recompute_activity_indicators().expect("recompute");
        report("expand_bounds", editor, t.elapsed());
        if let Err(e) = done {
            println!("  (expand refused this range: {e})");
        }
    }

    {
        let (mut engine, _dir) = fresh(&src);
        let t = Instant::now();
        engine
            .exclude_activity_from_section(&section, &activity)
            .expect("exclude");
        let editor = t.elapsed();
        let t = Instant::now();
        engine.recompute_activity_indicators().expect("recompute");
        report("exclude_activity", editor, t.elapsed());
    }

    {
        let (mut engine, _dir) = fresh(&src);
        let line = engine.get_section_polyline(&section);
        let polyline: Vec<tracematch::GpsPoint> = line
            .chunks_exact(2)
            .map(|c| tracematch::GpsPoint {
                latitude: c[0],
                longitude: c[1],
                elevation: None,
            })
            .collect();
        let params = veloqrs::sections::CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline,
            distance_meters: 0.0,
            name: Some("bench".to_string()),
            source_activity_id: Some(activity.clone()),
            start_index: Some(start),
            end_index: Some(end),
        };
        let t = Instant::now();
        let made = engine.create_section(params);
        let editor = t.elapsed();
        let t = Instant::now();
        engine.recompute_activity_indicators().expect("recompute");
        report("create", editor, t.elapsed());
        if let Err(e) = made {
            println!("  (create refused: {e})");
        }
    }
}
