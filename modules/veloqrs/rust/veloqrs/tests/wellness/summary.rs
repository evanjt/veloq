//! Scenario: the feed's summary card read a month of wellness bodies across
//! the FFI and derived its five numbers and five arrows in TypeScript, on
//! every wellness invalidation, for values the engine already holds as typed
//! columns.
//!
//! Expected behaviour: the engine answers with the numbers and the glyphs, and
//! judges every move itself, so there is one deadband table and one polarity
//! table rather than one per language.

use tempfile::TempDir;
use veloqrs::FfiClaimBasis;
use veloqrs::persistence::PersistentEngine;
use veloqrs::persistence::wellness::WellnessRow;

fn engine() -> (TempDir, PersistentEngine) {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");
    (tmp, engine)
}

/// A day carrying only the fields a case names.
fn day(
    date: &str,
    ctl: Option<f64>,
    atl: Option<f64>,
    hrv: Option<f64>,
    rhr: Option<f64>,
    weight: Option<f64>,
) -> WellnessRow {
    WellnessRow {
        date: date.to_string(),
        ctl,
        atl,
        ramp_rate: None,
        hrv,
        resting_hr: rhr,
        weight,
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

/// A day inside every daily metric's week that sits behind the baseline, so
/// an arrow has the second earlier reading its floor asks for and still
/// compares with the day before.
fn earlier_day(date: &str) -> WellnessRow {
    day(date, Some(55.0), Some(35.0), Some(65.0), Some(50.0), None)
}

/// The same for weight, inside its fortnight and behind its baseline.
fn earlier_weigh_in(date: &str) -> WellnessRow {
    day(date, None, None, None, None, Some(72.0))
}

fn summary(rows: Vec<WellnessRow>) -> veloqrs::WidgetWellnessSummary {
    let (_tmp, mut engine) = engine();
    engine.upsert_wellness(&rows).expect("store");
    let out = engine
        .widget_snapshot_data(0, 1, 0, 1, 7, 150)
        .summary
        .wellness;
    drop(_tmp);
    out
}

#[test]
fn a_single_day_gives_every_number_and_no_arrow() {
    let s = summary(vec![day(
        "2026-09-05",
        Some(60.0),
        Some(40.0),
        Some(70.0),
        Some(48.0),
        Some(71.0),
    )]);

    assert_eq!(s.fitness, Some(60.0));
    assert_eq!(s.form, Some(20.0));
    assert_eq!(s.hrv, Some(70.0));
    assert_eq!(s.rhr, Some(48.0));
    assert_eq!(s.weight, Some(71.0));
    assert_eq!(s.fitness_trend, None);
    assert_eq!(s.form_trend, None);
    assert_eq!(s.hrv_trend, None);
    assert_eq!(s.rhr_trend, None);
    assert_eq!(s.weight_trend, None);
}

#[test]
fn an_empty_history_survives() {
    let s = summary(vec![]);

    assert_eq!(s.fitness, None);
    assert_eq!(s.form, None);
    assert_eq!(s.weight, None);
    assert_eq!(s.fitness_trend, None);
}

#[test]
fn a_one_day_gap_reads_as_the_day_before() {
    let s = summary(vec![
        day(
            "2026-09-05",
            Some(60.0),
            Some(40.0),
            Some(70.0),
            Some(48.0),
            None,
        ),
        day(
            "2026-09-03",
            Some(50.0),
            Some(38.0),
            Some(60.0),
            Some(52.0),
            None,
        ),
        earlier_day("2026-09-01"),
    ]);

    assert_eq!(s.fitness_trend.as_deref(), Some("↑"));
    assert_eq!(s.form_trend.as_deref(), Some("↑"));
    assert_eq!(s.hrv_trend.as_deref(), Some("↑"));
    // Resting heart rate fell, which is an improvement, so the glyph points up.
    assert_eq!(s.rhr_trend.as_deref(), Some("↑"));
}

#[test]
fn a_gap_wider_than_the_day_it_stands_for_says_nothing() {
    let s = summary(vec![
        day("2026-09-05", Some(60.0), Some(40.0), None, None, None),
        day("2026-09-01", Some(50.0), Some(30.0), None, None, None),
    ]);

    assert_eq!(s.fitness, Some(60.0));
    assert_eq!(s.fitness_trend, None);
    assert_eq!(s.form_trend, None);
}

#[test]
fn a_weigh_in_older_than_a_fortnight_says_nothing() {
    let s = summary(vec![
        day("2026-09-05", None, None, None, None, Some(71.0)),
        day("2026-08-10", None, None, None, None, Some(74.0)),
    ]);

    assert_eq!(s.weight, Some(71.0));
    assert_eq!(s.weight_trend, None);
}

#[test]
fn a_weekly_weigh_in_is_compared_with_the_previous_one() {
    let s = summary(vec![
        day("2026-09-05", None, None, None, None, Some(71.0)),
        day("2026-08-29", None, None, None, None, Some(72.4)),
        earlier_weigh_in("2026-08-23"),
    ]);

    assert_eq!(s.weight_trend.as_deref(), Some("↓"));
}

#[test]
fn every_deadband_holds_and_one_step_past_it_moves() {
    let inside = summary(vec![
        day(
            "2026-09-05",
            Some(60.0),
            Some(40.0),
            Some(70.0),
            Some(48.0),
            Some(71.0),
        ),
        day(
            "2026-09-04",
            Some(60.4),
            Some(40.0),
            Some(71.9),
            Some(48.9),
            None,
        ),
        day("2026-08-29", None, None, None, None, Some(71.29)),
        earlier_day("2026-09-01"),
        earlier_weigh_in("2026-08-23"),
    ]);

    assert_eq!(inside.fitness_trend.as_deref(), Some("→"));
    assert_eq!(inside.form_trend.as_deref(), Some("→"));
    assert_eq!(inside.hrv_trend.as_deref(), Some("→"));
    assert_eq!(inside.rhr_trend.as_deref(), Some("→"));
    assert_eq!(inside.weight_trend.as_deref(), Some("→"));

    let outside = summary(vec![
        day(
            "2026-09-05",
            Some(60.0),
            Some(40.0),
            Some(70.0),
            Some(48.0),
            Some(71.0),
        ),
        day(
            "2026-09-04",
            Some(58.0),
            Some(40.0),
            Some(72.0),
            Some(49.0),
            None,
        ),
        day("2026-08-29", None, None, None, None, Some(71.5)),
        earlier_day("2026-09-01"),
        earlier_weigh_in("2026-08-23"),
    ]);

    assert_eq!(outside.fitness_trend.as_deref(), Some("↑"));
    assert_eq!(outside.form_trend.as_deref(), Some("↑"));
    assert_eq!(outside.hrv_trend.as_deref(), Some("↓"));
    assert_eq!(outside.rhr_trend.as_deref(), Some("↑"));
    assert_eq!(outside.weight_trend.as_deref(), Some("↓"));
}

#[test]
fn each_metric_is_taken_from_its_own_nearest_row() {
    let s = summary(vec![
        day(
            "2026-09-05",
            Some(60.0),
            Some(40.0),
            Some(70.0),
            None,
            Some(71.0),
        ),
        day("2026-09-04", Some(58.0), Some(40.0), None, None, None),
        day("2026-08-28", None, None, None, None, Some(73.0)),
        earlier_day("2026-09-01"),
        earlier_weigh_in("2026-08-23"),
    ]);

    assert_eq!(s.fitness_trend.as_deref(), Some("↑"));
    // The earlier day holds an HRV reading, but none stands on the day before.
    assert_eq!(s.hrv_trend, None);
    assert_eq!(s.weight_trend.as_deref(), Some("↓"));
}

/// Weight and form have no better direction, so the glyph is the bare
/// direction rather than a verdict.
#[test]
fn a_metric_with_no_polarity_draws_its_direction() {
    let s = summary(vec![
        day("2026-09-05", Some(60.0), Some(45.0), None, None, Some(72.0)),
        day("2026-09-04", Some(60.0), Some(40.0), None, None, None),
        day("2026-08-29", None, None, None, None, Some(71.0)),
        earlier_day("2026-09-01"),
        earlier_weigh_in("2026-08-23"),
    ]);

    // Form fell from 20 to 15, and form is unjudged, so the arrow points down.
    assert_eq!(s.form_trend.as_deref(), Some("↓"));
    // Weight rose, and weight is unjudged, so the arrow points up.
    assert_eq!(s.weight_trend.as_deref(), Some("↑"));
}

/// A rising resting heart rate is a decline, and the glyph says so rather than
/// following the number.
#[test]
fn a_rising_resting_heart_rate_points_down() {
    let s = summary(vec![
        day("2026-09-05", Some(60.0), Some(40.0), None, Some(52.0), None),
        day("2026-09-04", Some(60.0), Some(40.0), None, Some(48.0), None),
        earlier_day("2026-09-01"),
    ]);

    assert_eq!(s.rhr, Some(52.0));
    assert_eq!(s.rhr_trend.as_deref(), Some("↓"));
}

#[test]
fn measured_zero_is_not_missing() {
    let s = summary(vec![day(
        "2026-09-20",
        Some(0.0),
        Some(0.0),
        None,
        None,
        None,
    )]);
    assert_eq!(s.fitness, Some(0.0));
    assert_eq!(s.form, Some(0.0));
}

#[test]
fn missing_loads_are_not_zero_or_a_form_reading() {
    let s = summary(vec![day("2026-09-20", Some(40.0), None, None, None, None)]);
    assert_eq!(s.fitness, Some(40.0));
    assert_eq!(s.form, None);
    assert_eq!(s.form_trend, None);
    let s = summary(vec![day("2026-09-20", None, Some(20.0), None, None, None)]);
    assert_eq!(s.fitness, None);
    assert_eq!(s.form, None);
    assert_eq!(s.fitness_trend, None);
}

#[test]
fn the_summary_carries_fatigue_and_the_values_each_arrow_was_judged_against() {
    let s = summary(vec![
        day(
            "2026-09-05",
            Some(60.4),
            Some(44.0),
            Some(70.0),
            Some(48.0),
            None,
        ),
        day(
            "2026-09-04",
            Some(58.0),
            Some(40.0),
            Some(66.0),
            Some(50.0),
            None,
        ),
    ]);

    assert_eq!(s.fatigue, Some(44.0));
    assert_eq!(s.fitness_previous, Some(58.0));
    assert_eq!(s.fatigue_previous, Some(40.0));
    assert_eq!(s.form_previous, Some(18.0));
    assert_eq!(s.hrv_previous, Some(66.0));
    assert_eq!(s.rhr_previous, Some(50.0));
}

#[test]
fn fatigue_is_absent_when_the_newest_day_has_none_and_no_baseline_is_invented() {
    let s = summary(vec![
        day("2026-09-05", Some(60.0), None, None, None, None),
        day(
            "2026-09-04",
            Some(58.0),
            Some(40.0),
            Some(66.0),
            Some(50.0),
            None,
        ),
    ]);

    assert_eq!(s.fatigue, None);
    assert_eq!(s.fatigue_previous, Some(40.0));
    assert_eq!(s.form_previous, Some(18.0));
    assert_eq!(s.hrv_previous, Some(66.0));
}

#[test]
fn a_single_day_has_no_previous_values() {
    let s = summary(vec![day(
        "2026-09-05",
        Some(60.0),
        Some(40.0),
        Some(70.0),
        Some(48.0),
        None,
    )]);

    assert_eq!(s.fatigue, Some(40.0));
    assert_eq!(s.fitness_previous, None);
    assert_eq!(s.fatigue_previous, None);
    assert_eq!(s.form_previous, None);
    assert_eq!(s.hrv_previous, None);
    assert_eq!(s.rhr_previous, None);
}

/// One earlier reading is a single comparison, not a trend, so every arrow
/// waits for a second reading inside its window.
#[test]
fn one_earlier_reading_draws_no_arrow() {
    let s = summary(vec![
        day(
            "2026-09-05",
            Some(60.0),
            Some(40.0),
            Some(70.0),
            Some(48.0),
            Some(71.0),
        ),
        day(
            "2026-09-04",
            Some(50.0),
            Some(30.0),
            Some(60.0),
            Some(52.0),
            None,
        ),
        day("2026-08-29", None, None, None, None, Some(73.0)),
    ]);

    assert_eq!(s.fitness_trend, None);
    assert_eq!(s.form_trend, None);
    assert_eq!(s.hrv_trend, None);
    assert_eq!(s.rhr_trend, None);
    assert_eq!(s.weight_trend, None);
}

fn earlier_readings(population: u32) -> FfiClaimBasis {
    FfiClaimBasis {
        baseline: "earlierReading".to_string(),
        population,
    }
}

#[test]
fn each_arrow_uses_its_baseline_population() {
    let s = summary(vec![
        day(
            "2026-09-05",
            Some(60.0),
            Some(40.0),
            Some(70.0),
            Some(48.0),
            Some(71.0),
        ),
        day(
            "2026-09-04",
            Some(50.0),
            Some(30.0),
            Some(60.0),
            Some(52.0),
            None,
        ),
        earlier_day("2026-09-01"),
        earlier_day("2026-08-30"),
        day("2026-08-29", None, None, None, None, Some(73.0)),
        earlier_weigh_in("2026-08-23"),
    ]);

    let daily = Some(earlier_readings(3));
    assert_eq!(s.fitness_basis, daily);
    assert_eq!(s.fatigue_basis, daily);
    assert_eq!(s.form_basis, daily);
    assert_eq!(s.hrv_basis, daily);
    assert_eq!(s.rhr_basis, daily);
    assert_eq!(s.weight_basis, Some(earlier_readings(2)));

    assert_eq!(s.fitness_trend.as_deref(), Some("↑"));
    assert_eq!(s.form_trend.as_deref(), Some("→"));
    assert_eq!(s.hrv_trend.as_deref(), Some("↑"));
    assert_eq!(s.rhr_trend.as_deref(), Some("↑"));
    assert_eq!(s.weight_trend.as_deref(), Some("↓"));
}

/// The floor is counted inside the window, so a reading from before it does
/// not lift a lone earlier reading over the floor.
#[test]
fn a_reading_before_the_window_does_not_count_toward_the_floor() {
    let s = summary(vec![
        day("2026-09-05", None, None, Some(70.0), None, Some(71.0)),
        day("2026-09-04", None, None, Some(60.0), None, None),
        day("2026-08-28", None, None, Some(65.0), None, None),
        day("2026-08-29", None, None, None, None, Some(73.0)),
        day("2026-08-21", None, None, None, None, Some(72.0)),
    ]);

    assert_eq!(s.hrv_basis, Some(earlier_readings(1)));
    assert_eq!(s.hrv_trend, None);
    assert_eq!(s.weight_basis, Some(earlier_readings(1)));
    assert_eq!(s.weight_trend, None);
}

/// A day with no reading of its own is not an earlier reading.
#[test]
fn a_day_without_the_metric_does_not_count_toward_its_floor() {
    let s = summary(vec![
        day("2026-09-05", Some(60.0), Some(40.0), Some(70.0), None, None),
        day("2026-09-04", Some(50.0), Some(30.0), Some(60.0), None, None),
        day("2026-09-02", Some(55.0), Some(35.0), None, None, None),
    ]);

    assert_eq!(s.fitness_basis, Some(earlier_readings(2)));
    assert_eq!(s.fitness_trend.as_deref(), Some("↑"));
    assert_eq!(s.hrv_basis, Some(earlier_readings(1)));
    assert_eq!(s.hrv_trend, None);
}

/// A metric with no reading today has nothing to disclose.
#[test]
fn a_metric_with_no_reading_carries_no_basis() {
    let s = summary(vec![
        day("2026-09-05", Some(60.0), None, None, None, None),
        earlier_day("2026-09-04"),
        earlier_day("2026-09-03"),
    ]);

    assert_eq!(s.fitness_basis, Some(earlier_readings(2)));
    assert_eq!(s.fatigue_basis, None);
    assert_eq!(s.form_basis, None);
    assert_eq!(s.hrv_basis, None);
    assert_eq!(s.rhr_basis, None);
    assert_eq!(s.weight_basis, None);
    assert_eq!(summary(vec![]).fitness_basis, None);
}
