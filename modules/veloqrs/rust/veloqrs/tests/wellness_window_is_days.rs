//! The wellness window is a span of days, not a count of rows.
//!
//! intervals.icu writes a row for each day it has data for, so a library with
//! gaps has fewer rows than days. The window took the last N rows and every
//! caller read position as date: the widget called `series[len - 2]`
//! yesterday, the ramp rate called `fitness[last - 6]` seven days ago, and the
//! HRV flag called two adjacent rows a consecutive-day decline. On an athlete
//! with a three-day gap all three were reading across the gap.
//!
//! Run: `cargo test --test wellness_window_is_days -p veloqrs`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::wellness::WellnessRow;

fn engine(dir: &TempDir) -> PersistentEngine {
    PersistentEngine::new(dir.path().join("wellness.db").to_str().unwrap()).expect("engine")
}

fn row(date: &str, ctl: f64, hrv: f64) -> WellnessRow {
    WellnessRow {
        date: date.to_string(),
        ctl: Some(ctl),
        atl: Some(10.0),
        ramp_rate: None,
        hrv: Some(hrv),
        resting_hr: Some(50.0),
        weight: None,
        sleep_secs: None,
        sleep_score: None,
        soreness: None,
        fatigue: None,
        stress: None,
        mood: None,
        motivation: None,
        raw: None,
    }
}

/// Today back to nine days ago, with the three days before today missing.
/// Ten calendar days, seven rows.
fn seed_with_a_gap(engine: &mut PersistentEngine, today: &str) {
    let days = [
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-09-04",
        "2026-09-05",
        "2026-09-06",
    ];
    let mut rows: Vec<WellnessRow> = days
        .iter()
        .enumerate()
        .map(|(i, d)| row(d, 40.0 + i as f64, 60.0))
        .collect();
    rows.push(row(today, 80.0, 40.0));
    engine.upsert_wellness(&rows).expect("seed");
}

#[test]
fn the_window_holds_the_days_asked_for_and_no_older_row() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    seed_with_a_gap(&mut engine, "2026-09-10");

    let window = engine
        .get_wellness_window_to(4, "2026-09-10")
        .expect("window");

    // 2026-09-07 through 2026-09-10 inclusive: only the last day has a row.
    assert_eq!(
        window.iter().map(|w| w.date.as_str()).collect::<Vec<_>>(),
        ["2026-09-10"]
    );
}

#[test]
fn a_wider_window_reaches_back_over_the_gap() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    seed_with_a_gap(&mut engine, "2026-09-10");

    let window = engine
        .get_wellness_window_to(10, "2026-09-10")
        .expect("window");

    assert_eq!(window.len(), 7, "ten days hold seven rows here");
    assert_eq!(window.first().map(|w| w.date.as_str()), Some("2026-09-01"));
    assert_eq!(window.last().map(|w| w.date.as_str()), Some("2026-09-10"));
}

#[test]
fn a_row_outside_the_window_is_left_out_however_few_rows_remain() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    engine
        .upsert_wellness(&[row("2026-01-01", 10.0, 55.0), row("2026-09-10", 80.0, 40.0)])
        .expect("seed");

    let window = engine
        .get_wellness_window_to(7, "2026-09-10")
        .expect("window");

    assert_eq!(
        window.iter().map(|w| w.date.as_str()).collect::<Vec<_>>(),
        ["2026-09-10"],
        "a row eight months back is not one of the last seven days"
    );
}

#[test]
fn an_empty_library_yields_an_empty_window() {
    let dir = TempDir::new().unwrap();
    let engine = engine(&dir);

    assert!(
        engine
            .get_wellness_window_to(7, "2026-09-10")
            .expect("window")
            .is_empty()
    );
}

/// HRV that ends where it started, so the two halves agree and the only rule
/// that can push the verdict down is the consecutive-day one.
const STEADY_THEN_DOWN: [f64; 6] = [40.0, 50.0, 60.0, 60.0, 50.0, 40.0];

#[test]
fn the_hrv_flag_does_not_read_a_decline_across_a_gap() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    let dates = [
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-09-04",
        "2026-09-05",
        "2026-09-10",
    ];
    let rows: Vec<WellnessRow> = dates
        .iter()
        .zip(STEADY_THEN_DOWN)
        .map(|(d, hrv)| row(d, 40.0, hrv))
        .collect();
    engine.upsert_wellness(&rows).expect("seed");

    let trend = engine
        .compute_hrv_trend_to(10, "2026-09-10")
        .expect("trend")
        .expect("a verdict");

    assert_eq!(
        trend.label, "stable",
        "the two rows either side of a gap are not consecutive days"
    );
}

#[test]
fn the_hrv_flag_still_reads_a_decline_on_two_days_running() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    let dates = [
        "2026-09-05",
        "2026-09-06",
        "2026-09-07",
        "2026-09-08",
        "2026-09-09",
        "2026-09-10",
    ];
    let rows: Vec<WellnessRow> = dates
        .iter()
        .zip(STEADY_THEN_DOWN)
        .map(|(d, hrv)| row(d, 40.0, hrv))
        .collect();
    engine.upsert_wellness(&rows).expect("seed");

    let trend = engine
        .compute_hrv_trend_to(10, "2026-09-10")
        .expect("trend")
        .expect("a verdict");

    assert_eq!(trend.label, "trendingDown");
}

// The sparkline arrays are what the widget indexes by position: the last
// entry is today, the one before it is yesterday, and seven back is a week.
// That only holds if the array carries one entry per calendar day.

#[test]
fn a_sparkline_carries_one_entry_per_day_in_the_window() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    seed_with_a_gap(&mut engine, "2026-09-10");

    let sparklines = engine
        .get_wellness_sparklines_to(10, "2026-09-10")
        .expect("sparklines")
        .expect("some data");

    assert_eq!(sparklines.fitness.len(), 10, "ten days, ten entries");
    assert_eq!(sparklines.fatigue.len(), 10);
    assert_eq!(sparklines.form.len(), 10);
}

#[test]
fn a_day_with_no_row_holds_the_last_value_the_athlete_had() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    seed_with_a_gap(&mut engine, "2026-09-10");

    let fitness = engine
        .get_wellness_sparklines_to(10, "2026-09-10")
        .expect("sparklines")
        .expect("some data")
        .fitness;

    // 09-01 through 09-06 climb 40..45, then 09-07, 09-08 and 09-09 have no
    // row at all and carry 45 forward, and 09-10 is 80.
    assert_eq!(fitness, [40, 41, 42, 43, 44, 45, 45, 45, 45, 80]);
}

#[test]
fn yesterday_is_the_entry_before_last_even_across_a_gap() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    seed_with_a_gap(&mut engine, "2026-09-10");

    let fitness = engine
        .get_wellness_sparklines_to(10, "2026-09-10")
        .expect("sparklines")
        .expect("some data")
        .fitness;

    // The widget reads `series[len - 2]` as yesterday. Yesterday is 09-09,
    // which has no row and holds 45, not the 45 of 09-06 by accident of
    // position.
    assert_eq!(fitness[fitness.len() - 2], 45);
    // And seven days back from today is 09-04, which is 43.
    assert_eq!(fitness[fitness.len() - 1 - 6], 43);
}

#[test]
fn a_library_that_starts_inside_the_window_is_not_padded_before_its_first_row() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    engine
        .upsert_wellness(&[row("2026-09-09", 30.0, 55.0), row("2026-09-10", 32.0, 55.0)])
        .expect("seed");

    let fitness = engine
        .get_wellness_sparklines_to(10, "2026-09-10")
        .expect("sparklines")
        .expect("some data")
        .fitness;

    assert_eq!(
        fitness,
        [30, 32],
        "the window starts where the athlete does"
    );
}
