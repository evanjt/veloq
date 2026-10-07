//! Scenario: the training tab paints a year of heatmap days, two calendar
//! years of monthly totals, and the year and month to date against the same
//! spans of last year. Each card asked the engine for its own part, so opening
//! the tab cost a call per part and each card chose its own refresh.
//!
//! Expected behaviour: one read answers every part over the windows the screen
//! names, each the same answer the part's own query gives over the same rows,
//! and a read that fails says so rather than answering an empty year.

use chrono::NaiveDate;

use super::pooled::training_screen_data;
use crate::persistence::PersistentEngine;
use crate::persistence::fitness::derivations::pooled::{
    activity_heatmap, monthly_stats, period_stats,
};
use crate::types::ActivityMetrics;
use crate::{FfiTimestampRange, FfiTrainingScreenWindows};

/// Midnight of a calendar day in the wall-clock timebase `activity_metrics`
/// keeps, where the date part is the athlete's own day.
fn day(date: &str) -> i64 {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp()
}

/// The first instant of `first` through the last of `last`.
fn days(first: &str, last: &str) -> FfiTimestampRange {
    FfiTimestampRange {
        start_ts: day(first) as f64,
        end_ts: (day(last) + 86_399) as f64,
    }
}

fn activity(id: &str, date: &str, sport: &str, moving_time: u32) -> ActivityMetrics {
    ActivityMetrics {
        activity_id: id.into(),
        name: id.into(),
        // Mid-morning, so no window edge is met by accident.
        date: day(date) + 9 * 3_600,
        distance: 10_000.0,
        moving_time,
        elapsed_time: moving_time + 60,
        elevation_gain: 100.0,
        avg_hr: Some(140),
        avg_power: None,
        sport_type: sport.into(),
        training_load: Some(50.0),
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

/// Today is Tuesday 3 March 2026.
fn windows() -> FfiTrainingScreenWindows {
    FfiTrainingScreenWindows {
        heatmap_first_day: "2025-03-09".into(),
        heatmap_last_day: "2026-03-03".into(),
        months: days("2025-01-01", "2026-03-03"),
        year_current: days("2026-01-01", "2026-03-03"),
        year_previous: days("2025-01-01", "2025-03-03"),
        month_current: days("2026-03-01", "2026-03-03"),
        month_previous: days("2025-03-01", "2025-03-03"),
    }
}

fn library() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_activity_metrics(vec![
            // Before every window.
            activity("old", "2024-12-31", "Ride", 3_600),
            // Last year to date, and in the monthly rows, before the heatmap.
            activity("jan", "2025-01-10", "Ride", 1_800),
            activity("jun", "2025-06-01", "Run", 2_400),
            activity("new-year", "2026-01-05", "Ride", 3_600),
            // Two on one day, which the heatmap counts as one cell of two.
            activity("ride", "2026-03-02", "Ride", 5_400),
            activity("run", "2026-03-02", "Run", 1_200),
            // After today, so after every window.
            activity("tomorrow", "2026-03-04", "Ride", 3_600),
        ])
        .unwrap();
    engine
}

#[test]
fn every_part_is_read_over_the_window_the_screen_names() {
    let engine = library();
    let data = training_screen_data(&engine.db, &windows()).unwrap();

    assert_eq!(
        data.heatmap
            .iter()
            .map(|d| (d.date.as_str(), d.activity_count))
            .collect::<Vec<_>>(),
        vec![("2025-06-01", 1), ("2026-01-05", 1), ("2026-03-02", 2)],
        "the heatmap starts at its first drawn day and ends today"
    );
    assert_eq!(
        data.months
            .iter()
            .map(|m| (m.year, m.month, m.stats.count))
            .collect::<Vec<_>>(),
        vec![(2025, 1, 1), (2025, 6, 1), (2026, 1, 1), (2026, 3, 2)],
        "two calendar years to today, oldest first"
    );
    assert_eq!(data.year_current.count, 3);
    assert_eq!(data.year_current.total_duration, 10_200.0);
    assert_eq!(data.year_previous.count, 1);
    assert_eq!(data.year_previous.total_duration, 1_800.0);
    assert_eq!(data.month_current.count, 2);
    assert_eq!(data.month_current.total_tss, 100.0);
    assert_eq!(data.month_previous.count, 0);
    assert_eq!(data.month_previous.total_distance, 0.0);
}

#[test]
fn each_part_answers_what_its_own_query_answers() {
    let engine = library();
    let w = windows();
    let data = training_screen_data(&engine.db, &w).unwrap();
    let span = |r: &FfiTimestampRange| (r.start_ts as i64, r.end_ts as i64);

    assert_eq!(
        format!("{:?}", data.heatmap),
        format!(
            "{:?}",
            activity_heatmap(&engine.db, &w.heatmap_first_day, &w.heatmap_last_day).unwrap()
        )
    );
    let (start, end) = span(&w.months);
    assert_eq!(
        format!("{:?}", data.months),
        format!("{:?}", monthly_stats(&engine.db, start, end).unwrap())
    );
    for (got, window) in [
        (&data.year_current, &w.year_current),
        (&data.year_previous, &w.year_previous),
        (&data.month_current, &w.month_current),
        (&data.month_previous, &w.month_previous),
    ] {
        let (start, end) = span(window);
        assert_eq!(
            format!("{got:?}"),
            format!("{:?}", period_stats(&engine.db, start, end))
        );
    }
}

#[test]
fn a_window_includes_an_activity_on_its_last_second() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    let mut last = activity("edge", "2026-03-03", "Ride", 600);
    last.date = day("2026-03-03") + 86_399;
    engine.set_activity_metrics(vec![last]).unwrap();

    let data = training_screen_data(&engine.db, &windows()).unwrap();
    assert_eq!(data.year_current.count, 1);
    assert_eq!(data.month_current.count, 1);
    assert_eq!(data.months.len(), 1);
    assert_eq!(data.heatmap.len(), 1);
}

#[test]
fn an_empty_library_is_empty_parts_and_zero_totals() {
    let engine = PersistentEngine::in_memory().unwrap();
    let data = training_screen_data(&engine.db, &windows()).unwrap();

    assert!(data.heatmap.is_empty());
    assert!(data.months.is_empty());
    for totals in [
        &data.year_current,
        &data.year_previous,
        &data.month_current,
        &data.month_previous,
    ] {
        assert_eq!(totals.count, 0);
        assert_eq!(totals.total_duration, 0.0);
        assert_eq!(totals.total_distance, 0.0);
        assert_eq!(totals.total_tss, 0.0);
    }
}

#[test]
fn a_read_that_fails_is_an_error_rather_than_an_empty_year() {
    for table in ["activity_metrics", "activity_heatmap"] {
        let engine = library();
        engine
            .db
            .execute_batch(&format!("DROP TABLE {table}"))
            .unwrap();

        assert!(
            training_screen_data(&engine.db, &windows()).is_err(),
            "with {table} unreadable the screen would draw a year of nothing"
        );
    }
}
