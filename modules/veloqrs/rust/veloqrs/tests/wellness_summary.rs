//! Scenario: the feed's summary card read a month of wellness bodies across
//! the FFI and derived its five numbers and five arrows in TypeScript, on
//! every wellness invalidation, for values the engine already holds as typed
//! columns.
//!
//! Expected behaviour: the engine answers with the numbers and the glyphs, and
//! judges every move itself, so there is one deadband table and one polarity
//! table rather than one per language. The cases below are the ones
//! `src/__tests__/lib/wellnessStats.test.ts` pins, so a verdict that moved
//! would fail here first.

use tempfile::TempDir;
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

fn summary(rows: Vec<WellnessRow>) -> veloqrs::FfiWellnessSummary {
    let (_tmp, mut engine) = engine();
    engine.upsert_wellness(&rows).expect("store");
    let out = engine.wellness_summary();
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
    ]);

    assert_eq!(s.fitness_trend.as_deref(), Some("↑"));
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
