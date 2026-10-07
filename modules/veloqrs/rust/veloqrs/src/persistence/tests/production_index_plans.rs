//! Scenario: an index exists for a read, the read is rewritten, and the planner
//! stops using the index while every test of the old statement still passes.
//!
//! Expected behaviour: each test runs the read the engine runs, captures the
//! statements SQLite was handed, and plans those. A statement that scans where
//! an index was added for it fails here.

use std::sync::Mutex;

use crate::PersistentEngine;

static STATEMENTS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The trace hook is a bare function with one global log, so tests that plan
/// statements take turns.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

fn record(sql: &str) {
    STATEMENTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(sql.to_string());
}

/// The query plans of every statement `read` issues against `table`, one
/// string per statement.
fn plans_of(
    engine: &mut PersistentEngine,
    table: &str,
    read: impl FnOnce(&PersistentEngine),
) -> Vec<String> {
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    STATEMENTS.lock().unwrap_or_else(|e| e.into_inner()).clear();
    engine.db.trace(Some(record));
    read(engine);
    engine.db.trace(None);
    let issued: Vec<String> = STATEMENTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|sql| sql.contains(table) && !sql.starts_with("EXPLAIN"))
        .cloned()
        .collect();
    assert!(
        !issued.is_empty(),
        "the read issued no statement on {table}"
    );
    issued
        .iter()
        .map(|sql| {
            let mut stmt = engine
                .db
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .unwrap_or_else(|e| panic!("cannot plan {sql}: {e}"));
            let details: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(3))
                .unwrap()
                .flatten()
                .collect();
            details.join(" | ")
        })
        .collect()
}

/// Every date-window aggregate on `activity_metrics` is a date-only predicate,
/// and the only date index that serves one is `idx_activity_metrics_date`.
#[test]
fn a_date_window_aggregate_searches_the_date_index() {
    let mut engine = PersistentEngine::in_memory().unwrap();

    let plans = plans_of(&mut engine, "activity_metrics", |engine| {
        crate::persistence::fitness::derivations::pooled::period_stats(&engine.db, 1, 2);
    });

    for plan in &plans {
        assert!(
            plan.contains("SEARCH activity_metrics USING INDEX idx_activity_metrics_date"),
            "the window did not search the date index: {plan}"
        );
    }
}

#[test]
fn the_launch_date_range_reads_the_date_index_rather_than_the_table() {
    let mut engine = PersistentEngine::in_memory().unwrap();

    let plans = plans_of(&mut engine, "activity_metrics", |engine| {
        crate::persistence::pooled_stats(&engine.db);
    });

    for plan in &plans {
        assert!(
            plan.contains("idx_activity_metrics_date") && !plan.contains("SCAN activity_metrics\n"),
            "the date range did not read the date index: {plan}"
        );
    }
}

/// The batch read joins a section's rows to the matches of each activity, so
/// the section filter and the per-activity match lookup both need their index.
#[test]
fn the_routes_of_a_section_are_read_through_the_section_and_match_indexes() {
    let mut engine = PersistentEngine::in_memory().unwrap();

    let plans = plans_of(&mut engine, "section_activities", |engine| {
        engine.route_ids_for_sections(&["s1".to_string()]);
    });

    for plan in &plans {
        assert!(
            plan.contains("USING INDEX idx_section_activities_perf"),
            "the section filter did not use the section index: {plan}"
        );
        assert!(
            plan.contains("USING INDEX idx_activity_matches_activity"),
            "the match lookup did not use the activity index: {plan}"
        );
    }
}

/// The zone totals filter a sport's family, and the sport-and-date index
/// leads with the sport.
#[test]
fn the_zone_totals_search_the_sport_and_date_index() {
    let mut engine = PersistentEngine::in_memory().unwrap();

    let plans = plans_of(&mut engine, "activity_metrics", |engine| {
        crate::persistence::fitness::derivations::pooled::zone_distribution(
            &engine.db,
            "Ride",
            "power",
            0,
            i64::MAX,
        );
    });

    for plan in &plans {
        assert!(
            plan.contains("USING INDEX idx_activity_metrics_sport_date")
                || plan.contains("USING COVERING INDEX idx_activity_metrics_sport_date"),
            "the zone totals did not search the sport index: {plan}"
        );
    }
}

/// The recent-changes read bounds the ledger by time across every section, the
/// read the time index was added for.
#[test]
fn the_recent_section_changes_search_the_time_index() {
    let mut engine = PersistentEngine::in_memory().unwrap();

    let plans = plans_of(&mut engine, "section_history", |engine| {
        crate::persistence::sections::history::pooled::recent_section_changes(&engine.db, 30);
    });

    for plan in &plans {
        assert!(
            plan.contains("SEARCH h USING INDEX idx_section_history_at")
                || plan.contains("SEARCH h USING COVERING INDEX idx_section_history_at"),
            "the recent changes did not search the time index: {plan}"
        );
    }
}
