//! Form is shown as rounded fitness minus rounded fatigue, the way intervals.icu
//! prints it. The summary card's supporting row read it that way from
//! `wellness_summary`, while its hero sub-line and the widget read the last
//! sparkline point, which rounded the difference. A half-unit day then put two
//! answers on one card.
//!
//! Run: `cargo test --test wellness_form_rounding -p veloqrs`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::wellness::WellnessRow;

const TODAY: &str = "2026-09-10";

fn row(date: &str, ctl: f64, atl: f64) -> WellnessRow {
    WellnessRow {
        date: date.to_string(),
        ctl: Some(ctl),
        atl: Some(atl),
        ramp_rate: None,
        hrv: None,
        resting_hr: None,
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

fn forms(ctl: f64, atl: f64) -> (i32, f64) {
    let dir = TempDir::new().unwrap();
    let mut engine =
        PersistentEngine::new(dir.path().join("wellness.db").to_str().unwrap()).expect("engine");
    engine
        .upsert_wellness(&[row("2026-09-09", 30.0, 30.0), row(TODAY, ctl, atl)])
        .expect("seed");
    let sparkline = engine
        .get_wellness_sparklines_to(7, TODAY)
        .expect("read")
        .expect("rows");
    let summary = engine.wellness_summary();
    (
        *sparkline.form.last().unwrap(),
        summary.form.expect("summary form"),
    )
}

#[test]
fn a_positive_half_unit_day_has_one_form() {
    // 51 - 40 = 11, where the unrounded difference 10.1 rounds to 10.
    let (sparkline, summary) = forms(50.5, 40.4);
    assert_eq!(summary, 11.0);
    assert_eq!(sparkline, 11);
}

#[test]
fn a_negative_half_unit_day_has_one_form() {
    // 45 - 51 = -6, where the unrounded difference -5.2 rounds to -5.
    let (sparkline, summary) = forms(45.4, 50.6);
    assert_eq!(summary, -6.0);
    assert_eq!(sparkline, -6);
}

#[test]
fn whole_loads_agree_either_way() {
    let (sparkline, summary) = forms(50.0, 40.0);
    assert_eq!(summary, 10.0);
    assert_eq!(sparkline, 10);
}

#[test]
fn every_sparkline_form_is_its_own_rounded_fitness_minus_fatigue() {
    let dir = TempDir::new().unwrap();
    let mut engine =
        PersistentEngine::new(dir.path().join("wellness.db").to_str().unwrap()).expect("engine");
    engine
        .upsert_wellness(&[
            row("2026-09-07", 50.5, 40.4),
            row("2026-09-08", 45.4, 50.6),
            row("2026-09-10", 60.5, 60.4),
        ])
        .expect("seed");
    let sp = engine
        .get_wellness_sparklines_to(7, TODAY)
        .expect("read")
        .expect("rows");
    for i in 0..sp.form.len() {
        assert_eq!(sp.form[i], sp.fitness[i] - sp.fatigue[i], "day {i}");
    }
}
