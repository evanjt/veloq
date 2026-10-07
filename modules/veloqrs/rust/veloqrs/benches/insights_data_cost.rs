//! Where the time in `insights_data` actually goes.
//!
//! The whole bundle measured 27.8 ms on the handset, with the split left
//! open. Three parts of it scale with sections times traversals rather
//! than with the window asked for: the per-sport summary scan, the junction
//! query behind the recent-PR loop, and the per-sport ranked join. Rewriting
//! any of them means growing or changing the read, so the split comes first.
//!
//! Desktop timings are not handset timings. What transfers is the ratio
//! between the parts and how each one grows, which is what decides which is
//! worth rewriting.
//!
//! The clock is anchored to the newest activity in it rather than to now: a
//! corpus months old measured against today's date takes the empty path
//! through every window and measures nothing.
//!
//! Ignored by default. Run in release, on a quiet machine, twice:
//!   cargo test --release -p veloqrs --bench insights_data_cost -- --ignored --nocapture
//!
//! The corpus is a real `routes.db`, named by `VELOQ_DEVICE_DB`, and the bench
//! is skipped without one. The athlete's own fixture under the gitignored
//! `tests/fixtures/private/` is gone: it sat three migrations apart from its
//! own version records and could not be opened by the engine at all, and no
//! private library stands in for a fixture. A pull off the handset is current
//! and opens.
//!
//!     adb -s <handset> shell "run-as com.veloq.app.dev cat files/routes.db" > /tmp/routes.db
//!     VELOQ_DEVICE_DB=/tmp/routes.db cargo bench -p veloqrs --bench <name>

use std::path::PathBuf;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

/// Ranked sections per sport, as `insightsParams.ts` asks for them.
const RANKED_LIMIT: u32 = 50;
/// History points a card carries, as `insightsParams.ts` asks for them. The
/// bench measures what ships, so it asks for the same tail the screen does.
const HISTORY_LIMIT: u32 = 20;
/// Efficiency candidates taken from each sport's ranked list.
const EFFICIENCY_PER_SPORT: u32 = 5;
/// The trailing window the HRV verdict is read over, as `insightsParams.ts` asks.
const HRV_WINDOW_DAYS: u32 = 7;
/// The trailing window the section-change list covers.
const SECTION_CHANGE_WINDOW_DAYS: u32 = 14;
/// A section unvisited for this many days is stale.
const STALE_THRESHOLD_DAYS: u32 = 30;
/// Sections last visited beyond this many days get no efficiency trend.
const ACTIVE_WINDOW_DAYS: u32 = 28;

/// Where the corpus comes from: `VELOQ_DEVICE_DB` if it names a file that
/// exists, else the gitignored private fixture. A pull off the handset is
/// current and opens through the engine, which the fixture does not, so it
/// wins when both are present.
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
/// athlete's own file.
fn corpus() -> Option<(PersistentEngine, TempDir)> {
    let src = corpus_source()?;
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    std::fs::copy(&src, &path).expect("copy corpus");
    // The corpus carries a `user_version` overstating what was applied to it,
    // which migration 026 cannot survive. That is its own item, and until it
    // is fixed this measurement has no corpus to run against.
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

fn params(now: i64) -> veloqrs::FfiInsightsParams {
    let day = 86_400;
    // The window fields are `f64`: they carry a JavaScript timestamp, which has
    // no integer type to cross on.
    veloqrs::FfiInsightsParams {
        current_start: (now - 7 * day) as f64,
        current_end: now as f64,
        prev_start: (now - 14 * day) as f64,
        prev_end: (now - 7 * day - 1) as f64,
        chronic_start: (now - 35 * day) as f64,
        today_start: (now - day) as f64,
        include_sections: true,
        ranked_limit: RANKED_LIMIT,
        history_limit: HISTORY_LIMIT,
        active_window_days: ACTIVE_WINDOW_DAYS,
        efficiency_per_sport: EFFICIENCY_PER_SPORT,
        efficiency_limit: 2,
        efficiency_min_efforts: 3,
        efficiency_declining_min_efforts: 5,
        efficiency_min_hr_change_bpm: 1,
        strength_month: veloqrs::FfiTimestampRange {
            start_ts: (now - 28 * day) as f64,
            end_ts: now as f64,
        },
        strength_weeks: (0..4)
            .map(|i| veloqrs::FfiTimestampRange {
                start_ts: (now - (i + 1) * 7 * day) as f64,
                end_ts: (now - i * 7 * day) as f64,
            })
            .collect(),
        wellness_oldest: iso_days_before(now, 30),
        wellness_newest: iso_days_before(now, 0),
        hrv_window_days: 7,
        section_change_window_days: 14,
        stale_threshold_days: 30,
        stale_min_gain_percent: 3.0,
        stale_max_opportunities: 3,
        stale_min_traversals: 1,
        recent_pr_window_days: 7,
        recent_pr_min_outings: 3,
    }
}

/// `YYYY-MM-DD`, `back` days before the bench's clock. The wellness window is
/// dates and not timestamps, because a day is what the rows are keyed by.
fn iso_days_before(now: i64, back: i64) -> String {
    chrono::DateTime::from_timestamp(now - back * 86_400, 0)
        .unwrap_or_default()
        .format("%Y-%m-%d")
        .to_string()
}

fn time<T>(label: &str, mut f: impl FnMut() -> T) -> (T, Duration) {
    let start = Instant::now();
    let out = f();
    let elapsed = start.elapsed();
    println!("{label:<42} {:>9.2} ms", elapsed.as_secs_f64() * 1000.0);
    (out, elapsed)
}

#[test]
#[ignore]
fn insights_data_split_by_part() {
    let Some((mut engine, dir)) = corpus() else {
        return;
    };
    let path = dir.path().join("routes.db");
    let now = newest_activity(&path);
    let p = params(now);

    let sports = engine.get_available_sport_types();
    let sections = engine.get_section_count();
    let (activities, junction): (i64, i64) = {
        let db = Connection::open(&path).expect("open for counts");
        (
            db.query_row("SELECT COUNT(*) FROM activity_metrics", [], |r| r.get(0))
                .unwrap(),
            db.query_row("SELECT COUNT(*) FROM section_activities", [], |r| r.get(0))
                .unwrap(),
        )
    };
    println!(
        "corpus: {activities} activities, {sections} sections, {junction} junction rows, \
         {} sports, anchored at {now}",
        sports.len()
    );

    // Warm the page cache and the engine's own caches once, so the first part
    // measured does not carry the cost of opening the file for all of them.
    let _ = engine.insights_data(&p);

    let (_, total) = time("insights_data (whole bundle)", || engine.insights_data(&p));

    // The bundle reads the summaries once and fans out in memory. The per-sport
    // shape is timed beside it because it is what the bundle used to do, and the
    // gap between the two is what the rewrite bought.
    let (summaries, fanout) = time("  summaries once, fanned out in memory", || {
        veloqrs::persistence::sections::summaries_by_sport(
            &engine.get_section_summaries(),
            &sports,
            3,
        )
    });

    let (_, _per_sport_old) = time("  (was: the same query once per sport)", || {
        sports
            .iter()
            .flat_map(|sport| {
                engine
                    .get_section_summaries_for_sport(sport)
                    .into_iter()
                    .map(move |s| (sport.clone(), s))
            })
            .filter(|(_, s)| s.activity_count >= 3)
            .collect::<Vec<_>>()
    });

    let seven_days_ago = now - 7 * 86_400;
    let (visited, junction_scan) = time("  sections_visited_since (junction scan)", || {
        let db = Connection::open(&path).expect("open for junction");
        let mut stmt = db
            .prepare(
                "SELECT DISTINCT sa.section_id, am.sport_type
                 FROM section_activities sa
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.excluded = 0 AND am.date >= ?1",
            )
            .expect("prepare");
        stmt.query_map(rusqlite::params![seven_days_ago], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .expect("query")
        .flatten()
        .collect::<std::collections::HashSet<(String, String)>>()
    });

    let (ranked_lists, ranked) = time("  get_ranked_sections x sports", || {
        sports
            .iter()
            .map(|sport| engine.get_ranked_sections(sport, RANKED_LIMIT))
            .collect::<Vec<_>>()
    });

    // The recent-PR loop only computes performances for a section the junction
    // says was travelled in the window, so the survivors are what it costs.
    let survivors: Vec<(String, String)> = summaries
        .iter()
        .filter(|(sport, s)| visited.contains(&(s.id.clone(), sport.clone())))
        .map(|(sport, s)| (s.id.clone(), sport.clone()))
        .collect();
    let (_, performances) = time("  get_section_performances_filtered x survivors", || {
        survivors
            .iter()
            .map(|(id, sport)| engine.get_section_performances_filtered(id, Some(sport)))
            .collect::<Vec<_>>()
    });

    // The three tails folded into the bundle, which were three engine calls of their
    // own on top of this bundle. The stale-PR one is the only one that reads
    // per sport, and it reads nothing at all unless a fitness gain qualifies.
    let (_, hrv) = time("  compute_hrv_trend (folded in by C92)", || {
        engine.compute_hrv_trend(HRV_WINDOW_DAYS).ok().flatten()
    });
    let (_, changes) = time("  recent_section_changes (folded in by C92)", || {
        engine.recent_section_changes(SECTION_CHANGE_WINDOW_DAYS)
    });
    let (stale_rows, stale) = time(
        "  stale ranked sections x sports (folded in by C92)",
        || {
            sports
                .iter()
                .map(|sport| engine.get_stale_ranked_sections(sport, STALE_THRESHOLD_DAYS))
                .collect::<Vec<_>>()
        },
    );
    println!(
        "  the three tails together                      {:>9.2} ms",
        (hrv + changes + stale).as_secs_f64() * 1000.0
    );
    let _ = stale_rows;

    println!(
        "\n{} summaries over the outing floor, {} of them travelled in the last seven days, \
         {} ranked lists",
        summaries.len(),
        survivors.len(),
        ranked_lists.len()
    );
    let parts = fanout + junction_scan + ranked + performances;
    println!(
        "parts {:.2} ms of a {:.2} ms bundle ({:.0}%); the rest is period stats, trends, \
         patterns, efficiency and strength",
        parts.as_secs_f64() * 1000.0,
        total.as_secs_f64() * 1000.0,
        100.0 * parts.as_secs_f64() / total.as_secs_f64()
    );
}
