//! Scenario: the fitness tab paints a year of calendar days, two calendar
//! years of monthly totals, the year and month to date against the same spans
//! of last year, and the weekly card's every range. They came from a training
//! read of their own beside the fitness read, so the one screen made two
//! screen reads on mount and two on each `activities` event.
//!
//! Expected behaviour: the fitness read answers every part over the windows
//! the screen names, each the same answer the part's own query gives over the
//! same rows, and a read that fails says so rather than answering an empty
//! year.

use chrono::NaiveDate;

use super::pooled::fitness_screen_data;
use crate::persistence::PersistentEngine;
use crate::persistence::fitness::derivations::pooled::{
    activity_heatmap, monthly_stats, period_stats,
};
use crate::types::ActivityMetrics;
use crate::{FfiFitnessScreenWindows, FfiTimestampRange};

/// The fitness screen's read over `windows`, asked for no range span, since
/// the calendar parts follow the windows alone.
fn read(
    conn: &rusqlite::Connection,
    windows: &FfiFitnessScreenWindows,
) -> rusqlite::Result<crate::FfiFitnessScreenData> {
    fitness_screen_data(conn, "2026-03-03", &[], windows)
}

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
fn windows() -> FfiFitnessScreenWindows {
    FfiFitnessScreenWindows {
        heatmap_first_day: "2025-03-09".into(),
        heatmap_last_day: "2026-03-03".into(),
        months: days("2025-01-01", "2026-03-03"),
        year_current: days("2026-01-01", "2026-03-03"),
        year_previous: days("2025-01-01", "2025-03-03"),
        month_current: days("2026-03-01", "2026-03-03"),
        month_previous: days("2025-03-01", "2025-03-03"),
        now_wall_seconds: (day("2026-03-03") + 12 * 3_600) as f64,
    }
}

fn library() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    // A window held back past the heatmap's cap, so the calendar draws the cap.
    engine
        .set_setting(crate::persistence::settings_keys::ATHLETE_ID, "i1")
        .unwrap();
    engine.record_activity_window("i1", "2024-01-01").unwrap();
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
    let data = read(&engine.db, &windows()).unwrap();

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
    let data = read(&engine.db, &w).unwrap();
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

    let data = read(&engine.db, &windows()).unwrap();
    assert_eq!(data.year_current.count, 1);
    assert_eq!(data.month_current.count, 1);
    assert_eq!(data.months.len(), 1);
    assert_eq!(data.heatmap.len(), 1);
}

#[test]
fn an_empty_library_is_empty_parts_and_zero_totals() {
    let engine = PersistentEngine::in_memory().unwrap();
    let data = read(&engine.db, &windows()).unwrap();

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
            read(&engine.db, &windows()).is_err(),
            "with {table} unreadable the screen would draw a year of nothing"
        );
    }
}

/// The windows with the clock at `hour` on `date`.
fn windows_at(date: &str, hour: i64) -> FfiFitnessScreenWindows {
    FfiFitnessScreenWindows {
        now_wall_seconds: (day(date) + hour * 3_600) as f64,
        ..windows()
    }
}

fn at(id: &str, date: &str, hour: i64, moving_time: u32) -> ActivityMetrics {
    ActivityMetrics {
        date: day(date) + hour * 3_600,
        ..activity(id, date, "Ride", moving_time)
    }
}

fn span(r: &FfiTimestampRange) -> (i64, i64) {
    (r.start_ts as i64, r.end_ts as i64)
}

#[test]
fn the_weekly_comparison_ends_last_week_at_the_same_hour_as_now() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_activity_metrics(vec![
            at("last-monday", "2026-02-23", 9, 3_600),
            // Later on the same weekday than now, so not yet matched this week.
            at("last-wednesday-evening", "2026-02-25", 18, 7_200),
            at("this-monday", "2026-03-02", 9, 5_400),
        ])
        .unwrap();

    // Wednesday 4 March 2026, 09:00.
    let data = read(&engine.db, &windows_at("2026-03-04", 9)).unwrap();
    let week = &data.comparisons.week;

    assert_eq!(
        span(&week.current),
        (day("2026-03-02"), day("2026-03-04") + 9 * 3_600)
    );
    assert_eq!(
        span(&week.previous),
        (day("2026-02-23"), day("2026-02-25") + 9 * 3_600)
    );
    assert_eq!(week.current_stats.total_duration, 5_400.0);
    assert_eq!(week.previous_stats.total_duration, 3_600.0);
    let duration = week
        .duration
        .as_ref()
        .expect("last week had time to compare");
    assert_eq!(
        duration.glyph, "↑",
        "1.5 h against 1 h is up, as the home card says"
    );
    assert_eq!(duration.percent, Some(50));
}

#[test]
fn the_weekly_comparison_matches_the_home_card_window_to_the_second() {
    let now = day("2026-03-04") + 9 * 3_600 + 17;
    let (cs, ce, ps, pe) = crate::widget_snapshot::week_bounds(now);
    let w = FfiFitnessScreenWindows {
        now_wall_seconds: now as f64,
        ..windows()
    };
    let data = read(&PersistentEngine::in_memory().unwrap().db, &w).unwrap();

    assert_eq!(span(&data.comparisons.week.current), (cs, ce));
    assert_eq!(span(&data.comparisons.week.previous), (ps, pe));
}

#[test]
fn every_longer_range_ends_its_previous_window_the_same_span_after_its_start() {
    let engine = PersistentEngine::in_memory().unwrap();
    // Tuesday 3 March 2026, 12:00.
    let data = read(&engine.db, &windows_at("2026-03-03", 12)).unwrap();
    let noon = |date: &str| day(date) + 12 * 3_600;
    let c = &data.comparisons;

    assert_eq!(
        span(&c.month.current),
        (day("2026-03-01"), noon("2026-03-03"))
    );
    assert_eq!(
        span(&c.month.previous),
        (day("2026-02-01"), noon("2026-02-03"))
    );
    assert_eq!(
        span(&c.three_months.current),
        (day("2026-01-01"), noon("2026-03-03"))
    );
    assert_eq!(
        span(&c.three_months.previous),
        (day("2025-10-01"), noon("2025-12-01"))
    );
    assert_eq!(
        span(&c.six_months.current),
        (day("2025-10-01"), noon("2026-03-03"))
    );
    assert_eq!(
        span(&c.six_months.previous),
        (day("2025-04-01"), noon("2025-09-01"))
    );
    assert_eq!(
        span(&c.year.current),
        (day("2026-01-01"), noon("2026-03-03"))
    );
    assert_eq!(
        span(&c.year.previous),
        (day("2025-01-01"), noon("2025-03-03"))
    );
}

#[test]
fn a_previous_window_never_runs_into_the_current_one() {
    let engine = PersistentEngine::in_memory().unwrap();
    // 31 March is further into its month than February ever runs.
    let data = read(&engine.db, &windows_at("2026-03-31", 10)).unwrap();

    assert_eq!(
        span(&data.comparisons.month.previous),
        (day("2026-02-01"), day("2026-03-01") - 1),
        "February whole, ending the second before March starts"
    );
}

#[test]
fn a_period_with_nothing_before_it_is_not_judged_and_a_level_one_has_no_percentage() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_activity_metrics(vec![
            at("last-month", "2026-02-02", 9, 3_600),
            at("this-month", "2026-03-02", 9, 3_600),
        ])
        .unwrap();
    let data = read(&engine.db, &windows_at("2026-03-03", 12)).unwrap();

    let month = &data.comparisons.month;
    for trend in [&month.count, &month.duration, &month.distance, &month.load] {
        let trend = trend.as_ref().expect("last month has its own to compare");
        assert_eq!(trend.glyph, "→");
        assert_eq!(trend.percent, None);
    }
    let year = &data.comparisons.year;
    assert!(year.previous_stats.count == 0);
    assert!(year.count.is_none() && year.duration.is_none());
    assert!(year.distance.is_none() && year.load.is_none());
}

#[test]
fn hours_are_judged_as_the_card_prints_them() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_activity_metrics(vec![
            at("last-monday", "2026-02-23", 8, 3_600),
            // 1.46 h prints as 1.5 h, a half hour up on 1 h.
            at("this-monday", "2026-03-02", 8, 5_256),
        ])
        .unwrap();
    let data = read(&engine.db, &windows_at("2026-03-04", 9)).unwrap();

    let duration = data.comparisons.week.duration.as_ref().unwrap();
    assert_eq!(duration.glyph, "↑");
    assert_eq!(duration.percent, Some(46));
}

/// One activity on Monday at 08:00 carrying a week's totals.
fn week_of(id: &str, monday: &str, moving_time: u32, distance: f64, load: f64) -> ActivityMetrics {
    ActivityMetrics {
        distance,
        training_load: Some(load),
        ..at(id, monday, 8, moving_time)
    }
}

/// This week's moves against last week's totals, with the clock on Wednesday.
fn weekly_moves(last: (u32, f64, f64), this: (u32, f64, f64)) -> crate::FfiSummaryComparison {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_activity_metrics(vec![
            week_of("last", "2026-02-23", last.0, last.1, last.2),
            week_of("this", "2026-03-02", this.0, this.1, this.2),
        ])
        .unwrap();
    read(&engine.db, &windows_at("2026-03-04", 9))
        .unwrap()
        .comparisons
        .week
}

fn glyph(trend: &Option<crate::FfiStatTrend>) -> Option<(&str, Option<u32>)> {
    trend.as_ref().map(|t| (t.glyph.as_str(), t.percent))
}

#[test]
fn a_move_inside_each_totals_deadband_is_flat() {
    // 20 minutes more is under the half-hour deadband, 600 m under a
    // kilometre, three points of load under five.
    let week = weekly_moves((18_000, 120_000.0, 300.0), (19_200, 120_600.0, 303.0));
    assert_eq!(glyph(&week.duration), Some(("→", None)));
    assert_eq!(glyph(&week.distance), Some(("→", None)));
    assert_eq!(glyph(&week.load), Some(("→", None)));
}

#[test]
fn more_time_and_distance_are_up_and_load_moves_with_no_judgement() {
    let up = weekly_moves((18_000, 120_000.0, 300.0), (21_600, 132_000.0, 360.0));
    assert_eq!(glyph(&up.duration), Some(("↑", Some(20))));
    assert_eq!(glyph(&up.distance), Some(("↑", Some(10))));
    assert_eq!(glyph(&up.load), Some(("↑", Some(20))));

    let down = weekly_moves((18_000, 120_000.0, 300.0), (14_400, 108_000.0, 240.0));
    assert_eq!(glyph(&down.duration), Some(("↓", Some(20))));
    assert_eq!(glyph(&down.distance), Some(("↓", Some(10))));
    // Load has no polarity, so its glyph is the bare direction.
    assert_eq!(glyph(&down.load), Some(("↓", Some(20))));
}

#[test]
fn one_more_activity_than_last_week_is_a_move_up() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_activity_metrics(vec![
            at("last-a", "2026-02-23", 8, 3_600),
            at("last-b", "2026-02-24", 8, 3_600),
            at("this-a", "2026-03-02", 8, 3_600),
            at("this-b", "2026-03-03", 8, 3_600),
            at("this-c", "2026-03-04", 8, 3_600),
        ])
        .unwrap();
    let week = read(&engine.db, &windows_at("2026-03-04", 9))
        .unwrap()
        .comparisons
        .week;
    assert_eq!(glyph(&week.count), Some(("↑", Some(50))));
}

// The calendar's span. Today is Sunday 18 October 2026, the screen's 52-week
// cap opens on Monday 20 October 2025, and a first sync holds the 90 days
// back to Monday 20 July 2026.

const SPAN_TODAY: &str = "2026-10-18";
const ATHLETE: &str = "i77";

fn span_windows() -> FfiFitnessScreenWindows {
    FfiFitnessScreenWindows {
        heatmap_first_day: "2025-10-20".into(),
        heatmap_last_day: SPAN_TODAY.into(),
        ..windows()
    }
}

fn span_read(engine: &PersistentEngine) -> crate::FfiFitnessScreenData {
    fitness_screen_data(&engine.db, SPAN_TODAY, &[], &span_windows()).unwrap()
}

/// An engine signed in to the athlete, holding activities back to `oldest`.
fn signed_in(oldest: &str) -> PersistentEngine {
    let engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_setting(crate::persistence::settings_keys::ATHLETE_ID, ATHLETE)
        .unwrap();
    engine.record_activity_window(ATHLETE, oldest).unwrap();
    engine
}

fn census_row(id: String, date: NaiveDate) -> crate::net::types::ActivityCensusEntry {
    crate::net::types::ActivityCensusEntry {
        id,
        start_date_local: Some(format!("{date}T09:00:00")),
        created: None,
        icu_sync_date: Some("v1".into()),
        has_latlng: true,
        has_series: false,
    }
}

/// One census row each Monday from `first` to the week of today, none of
/// them downloaded.
fn weekly_census(engine: &mut PersistentEngine, first: &str) -> Vec<NaiveDate> {
    let today = NaiveDate::parse_from_str(SPAN_TODAY, "%Y-%m-%d").unwrap();
    let mut dates = Vec::new();
    let mut date = NaiveDate::parse_from_str(first, "%Y-%m-%d").unwrap();
    while date <= today {
        dates.push(date);
        date += chrono::Duration::days(7);
    }
    let rows: Vec<_> = dates
        .iter()
        .map(|d| census_row(format!("c{d}"), *d))
        .collect();
    engine.record_activity_census(ATHLETE, &rows).unwrap();
    dates
}

/// Download the census rows on `dates`, as a window sync stores a page.
fn download(engine: &mut PersistentEngine, dates: &[NaiveDate]) {
    let ts = |d: &NaiveDate| d.and_hms_opt(9, 0, 0).unwrap().and_utc().timestamp();
    let rows: Vec<_> = dates
        .iter()
        .map(|d| (format!("c{d}"), ts(d), "{}".to_string()))
        .collect();
    let ids: Vec<_> = dates.iter().map(|d| format!("c{d}")).collect();
    let metrics = dates
        .iter()
        .map(|d| ActivityMetrics {
            date: ts(d),
            ..activity(&format!("c{d}"), &d.to_string(), "Ride", 3_600)
        })
        .collect();
    engine
        .store_synced_activity_bodies(ATHLETE, &rows, &ids, metrics)
        .unwrap();
}

fn before(dates: &[NaiveDate], day: &str) -> Vec<NaiveDate> {
    let day = NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap();
    dates.iter().copied().filter(|d| *d < day).collect()
}

fn from(dates: &[NaiveDate], day: &str) -> Vec<NaiveDate> {
    let day = NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap();
    dates.iter().copied().filter(|d| *d >= day).collect()
}

#[test]
fn the_calendar_spans_the_held_window_and_counts_the_older_activities_owed() {
    let mut engine = signed_in("2026-07-20");
    let census = weekly_census(&mut engine, "2025-11-03");
    // Before the cap, so never counted, however owed.
    engine
        .record_activity_census(
            ATHLETE,
            &census
                .iter()
                .map(|d| census_row(format!("c{d}"), *d))
                .chain([census_row(
                    "older-than-a-year".into(),
                    NaiveDate::from_ymd_opt(2025, 6, 2).unwrap(),
                )])
                .collect::<Vec<_>>(),
        )
        .unwrap();
    download(&mut engine, &from(&census, "2026-07-20"));

    let data = span_read(&engine);

    assert_eq!(data.calendar_first_day, "2026-07-20");
    // The Mondays from 3 November 2025 to 13 July 2026.
    assert_eq!(before(&census, "2026-07-20").len(), 37);
    assert_eq!(data.calendar_older_owed, 37);
    assert_eq!(
        data.heatmap.first().map(|d| d.date.as_str()),
        Some("2026-07-20"),
        "the heatmap reads from the span's first day"
    );
}

#[test]
fn a_window_older_than_the_cap_answers_the_cap() {
    let mut engine = signed_in("2024-01-01");
    // An account older than the cap too.
    let census = weekly_census(&mut engine, "2025-06-02");
    download(&mut engine, &from(&census, "2026-07-20"));

    let data = span_read(&engine);

    assert_eq!(data.calendar_first_day, "2025-10-20");
    assert_eq!(
        data.calendar_older_owed, 0,
        "every owed row is inside the drawn span, which its coverage caption covers"
    );
}

#[test]
fn an_account_younger_than_the_window_starts_on_the_monday_of_its_oldest_activity() {
    let mut engine = signed_in("2026-07-20");
    // Wednesday 2 September 2026.
    let census = weekly_census(&mut engine, "2026-09-02");
    download(&mut engine, &census);

    let data = span_read(&engine);

    assert_eq!(data.calendar_first_day, "2026-08-31");
    assert_eq!(data.calendar_older_owed, 0);
}

#[test]
fn no_stored_athlete_answers_the_default_window() {
    let engine = PersistentEngine::in_memory().unwrap();

    let data = span_read(&engine);

    // 90 days back from Sunday 18 October 2026 is Monday 20 July.
    assert_eq!(data.calendar_first_day, "2026-07-20");
    assert_eq!(data.calendar_older_owed, 0);
}

#[test]
fn a_widened_ask_grows_the_span_and_the_older_rows_leave_the_count() {
    let mut engine = signed_in("2026-07-20");
    let census = weekly_census(&mut engine, "2025-11-03");
    download(&mut engine, &from(&census, "2026-07-20"));
    assert_eq!(span_read(&engine).calendar_older_owed, 37);

    engine
        .record_activity_window(ATHLETE, "2025-10-20")
        .unwrap();
    let asked = span_read(&engine);
    assert_eq!(
        asked.calendar_first_day, "2025-11-03",
        "the widened window, as far back as the account goes"
    );
    assert_eq!(asked.calendar_older_owed, 0);
}

#[test]
fn older_rows_downloaded_are_not_owed() {
    let mut engine = signed_in("2026-07-20");
    let census = weekly_census(&mut engine, "2025-11-03");
    download(&mut engine, &census);

    let data = span_read(&engine);

    assert_eq!(data.calendar_first_day, "2026-07-20");
    assert_eq!(data.calendar_older_owed, 0);
}
