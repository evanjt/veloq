//! What the section editors cost as the section sheet calls them.
//!
//! `create` and `exclude_activity` are blocking FFI calls, so each holds the JS thread and the
//! engine write lock for its whole duration, and the budget for a tap is 100 ms. Trim, reset and
//! expand run off the JS thread through `run_section_bounds_edit` and still hold the write lock
//! for theirs. Each editor runs its own scoped indicator pass on the way out, so the call timed
//! here is the whole of what the sheet waits for.
//!
//! An auto section re-cuts only the rides it holds, while a custom one rescans the library, so
//! both kinds are timed: the busiest auto section, and a custom section cut from one of its
//! attempts.
//!
//! The corpus is a real database, named by `VELOQ_DEVICE_DB`. Every editor mutates, so every run
//! gets its own copy, and `VELOQ_BENCH_RUNS` sets how many (default 5). Nothing here is asserted;
//! it prints. The same binary cross-compiles for a handset, so a desktop and a phone can be timed
//! against one corpus.
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

fn runs() -> usize {
    std::env::var("VELOQ_BENCH_RUNS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(5)
}

/// A fresh, loaded copy of the corpus, because every editor here writes to it.
fn fresh(src: &Path) -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    std::fs::copy(src, &path).expect("copy corpus");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    // The app loads before the sheet can open. Without it the activity index a
    // custom section matches against is empty, and every custom edit is free.
    engine.load().expect("load engine");
    (engine, dir)
}

struct Target {
    section: String,
    sport: String,
    members: i64,
    activity: String,
    start: u32,
    end: u32,
}

/// The auto section with the most junction rows, and one of its attempts. The
/// editors are worth measuring against the row with the most behind it.
fn target(src: &Path) -> Target {
    targets(src, 1).remove(0)
}

/// The `limit` busiest auto sections, each with one of its attempts, busiest
/// first. An auto edit re-cuts the rides a section holds, so its cost follows
/// the junction rows, and a spread of sizes gives the slope.
fn targets(src: &Path, limit: usize) -> Vec<Target> {
    let db = Connection::open(src).expect("open corpus");
    let mut busiest = db
        .prepare(
            "SELECT sa.section_id, s.sport_type, COUNT(*) FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             WHERE s.section_type != 'custom'
             GROUP BY sa.section_id ORDER BY COUNT(*) DESC LIMIT ?1",
        )
        .expect("prepare busiest");
    let rows: Vec<(String, String, i64)> = busiest
        .query_map(rusqlite::params![limit as i64], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .expect("busiest sections")
        .collect::<Result<_, _>>()
        .expect("read busiest");
    rows.into_iter()
        .map(|(section, sport, members)| attempt_on(&db, section, sport, members))
        .collect()
}

fn attempt_on(db: &Connection, section: String, sport: String, members: i64) -> Target {
    let (activity, start, end): (String, u32, u32) = db
        .query_row(
            "SELECT activity_id, start_index, end_index FROM section_activities
             WHERE section_id = ?1 AND excluded = 0 LIMIT 1",
            rusqlite::params![section],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("an attempt on it");
    // A pooled section can hold another sport's ride, and a custom section
    // cut from it matches the sport of the ride it was cut from.
    let sport: String = db
        .query_row(
            "SELECT sport_type FROM activities WHERE id = ?1",
            rusqlite::params![activity],
            |r| r.get(0),
        )
        .unwrap_or(sport);
    Target {
        section,
        sport,
        members,
        activity,
        start,
        end,
    }
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

/// A custom section cut from the target's attempt, which is what a hand-made
/// section over the same ground looks like.
fn make_custom(engine: &mut PersistentEngine, t: &Target) -> String {
    let track = engine.get_gps_track(&t.activity).expect("attempt track");
    let polyline = track[t.start as usize..=t.end as usize].to_vec();
    engine
        .create_section(veloqrs::sections::CreateSectionParams {
            sport_type: t.sport.clone(),
            polyline,
            distance_meters: 0.0,
            name: Some("bench".to_string()),
            source_activity_id: Some(t.activity.clone()),
            start_index: Some(t.start),
            end_index: Some(t.end),
        })
        .expect("create custom")
}

/// A tenth off each end, which is the shape of a real trim.
fn trim_range(engine: &PersistentEngine, section: &str) -> (u32, u32) {
    let points = (engine.get_section_polyline(section).len() / 2) as u32;
    (points / 10, points - points / 10 - 1)
}

/// Times one editor `runs` times, each on a fresh corpus. `prepare` sets the
/// copy up and returns the section to edit; only `edit` is timed.
fn time_editor(
    src: &Path,
    label: &str,
    prepare: impl Fn(&mut PersistentEngine) -> String,
    edit: impl Fn(&mut PersistentEngine, &str) -> Result<(), String>,
) {
    let mut samples = Vec::new();
    for _ in 0..runs() {
        let (mut engine, _dir) = fresh(src);
        let section = prepare(&mut engine);
        // The sheet is open on the section before the tap, so its line is read.
        let _ = engine.get_section_polyline(&section);
        let t = Instant::now();
        let done = edit(&mut engine, &section);
        samples.push(ms(t.elapsed()));
        if let Err(e) = done {
            println!("  ({label} refused: {e})");
        }
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = samples[samples.len() / 2];
    let verdict = if median > TAP_BUDGET_MS { "OVER" } else { "ok" };
    let all: Vec<String> = samples.iter().map(|s| format!("{s:.1}")).collect();
    println!(
        "{label:<24} min {:>7.1}ms  median {:>7.1}ms  max {:>7.1}ms  {verdict}  [{}]",
        samples[0],
        median,
        samples[samples.len() - 1],
        all.join(" ")
    );
}

#[test]
#[ignore]
fn section_editor_cost_as_called() {
    let Some(src) = source() else { return };
    let (activities, sections, junction, indicators) = counts(&src);
    let t = target(&src);
    println!(
        "corpus: {activities} activities, {sections} sections, {junction} junction rows, \
         {indicators} indicators; {} runs each; tap budget {TAP_BUDGET_MS:.0} ms",
        runs()
    );
    println!(
        "target: auto section {} ({}, {} junction rows), attempt {} over [{}, {}]\n",
        t.section, t.sport, t.members, t.activity, t.start, t.end
    );

    {
        let (mut engine, dir) = fresh(&src);
        let id = make_custom(&mut engine, &t);
        drop(engine);
        let db = Connection::open(dir.path().join("routes.db")).expect("reopen");
        let held: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM section_activities WHERE section_id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap_or(-1);
        println!("custom section cut from the attempt holds {held} junction rows\n");
    }

    let auto = |_: &mut PersistentEngine| t.section.clone();
    let custom = |e: &mut PersistentEngine| make_custom(e, &t);
    let trim = |e: &mut PersistentEngine, s: &str| {
        let (a, b) = trim_range(e, s);
        e.trim_section(s, a, b).map(|_| ())
    };
    let trimmed = |e: &mut PersistentEngine, s: String| {
        let (a, b) = trim_range(e, &s);
        e.trim_section(&s, a, b).expect("trim first");
        s
    };
    let reset = |e: &mut PersistentEngine, s: &str| e.reset_section_bounds(s).map(|_| ());
    let expand = |e: &mut PersistentEngine, s: &str| {
        e.expand_section_bounds(s, &t.activity, t.start, t.end)
            .map(|_| ())
    };

    time_editor(&src, "trim auto", auto, trim);
    time_editor(
        &src,
        "reset_bounds auto",
        |e| {
            let s = auto(e);
            trimmed(e, s)
        },
        reset,
    );
    time_editor(&src, "expand_bounds auto", auto, expand);
    time_editor(&src, "exclude_activity auto", auto, |e, s| {
        e.exclude_activity_from_section(s, &t.activity)
            .map_err(|e| e.to_string())
    });
    time_editor(&src, "create custom", auto, |e, _| {
        make_custom(e, &t);
        Ok(())
    });
    time_editor(&src, "trim custom", custom, trim);
    time_editor(
        &src,
        "reset_bounds custom",
        |e| {
            let s = custom(e);
            trimmed(e, s)
        },
        reset,
    );
    time_editor(&src, "expand_bounds custom", custom, expand);
}

/// The auto editors against sections of several sizes, so the cost per junction
/// row can be read off rather than projected from one section.
#[test]
#[ignore]
fn section_editor_cost_by_size() {
    let Some(src) = source() else { return };
    let (activities, sections, junction, _) = counts(&src);
    println!(
        "corpus: {activities} activities, {sections} sections, {junction} junction rows; \
         {} runs each; tap budget {TAP_BUDGET_MS:.0} ms\n",
        runs()
    );
    for t in targets(&src, 6) {
        let label = |editor: &str| format!("{editor} {}r", t.members);
        let auto = |_: &mut PersistentEngine| t.section.clone();
        time_editor(&src, &label("trim"), auto, |e, s| {
            let (a, b) = trim_range(e, s);
            e.trim_section(s, a, b).map(|_| ())
        });
        time_editor(&src, &label("expand_bounds"), auto, |e, s| {
            // A junction row's end can sit one past the track's last point.
            let last = e
                .get_gps_track(&t.activity)
                .map_or(0, |p| p.len() as u32 - 1);
            e.expand_section_bounds(s, &t.activity, t.start, t.end.min(last))
                .map(|_| ())
        });
        time_editor(
            &src,
            &label("reset_bounds"),
            |e| {
                let (a, b) = trim_range(e, &t.section);
                e.trim_section(&t.section, a, b).expect("trim first");
                t.section.clone()
            },
            |e, s| e.reset_section_bounds(s).map(|_| ()),
        );
    }
}
