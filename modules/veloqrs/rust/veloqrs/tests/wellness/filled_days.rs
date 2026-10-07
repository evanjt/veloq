//! A sparkline day with no reading of its own is marked as filled.
//!
//! The HRV and resting heart rate series carry the last reading forward over
//! a day with none, which is what a line draws between two points. The summary
//! card's scrub labelled each value with the day under the finger, so HRV
//! logged on 1 and 10 September read the 1st's value under the 5th.
//!
//! Run: `cargo test --test wellness -p veloqrs -- filled_days::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::wellness::WellnessRow;

fn row(date: &str, hrv: Option<f64>, resting_hr: Option<f64>) -> WellnessRow {
    WellnessRow {
        date: date.to_string(),
        ctl: Some(40.0),
        atl: Some(30.0),
        ramp_rate: None,
        hrv,
        resting_hr,
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

#[test]
fn a_forward_filled_day_is_marked_as_having_no_reading() {
    let dir = TempDir::new().unwrap();
    let mut engine =
        PersistentEngine::new(dir.path().join("wellness.db").to_str().unwrap()).expect("engine");
    engine
        .upsert_wellness(&[
            row("2026-09-01", Some(50.0), Some(48.0)),
            // A row with a resting heart rate and no HRV: filled for one, read for the other.
            row("2026-09-03", None, Some(46.0)),
            row("2026-09-05", Some(62.0), None),
        ])
        .expect("seed");

    let sparklines = engine
        .get_wellness_sparklines_to(5, "2026-09-05")
        .expect("read")
        .expect("sparklines");

    assert_eq!(sparklines.hrv, [50, 50, 50, 50, 62]);
    assert_eq!(sparklines.hrv_read, [true, false, false, false, true]);
    assert_eq!(sparklines.rhr, [48, 48, 46, 46, 46]);
    assert_eq!(sparklines.rhr_read, [true, false, true, false, false]);
}

#[test]
fn a_series_with_no_reading_at_all_has_no_flags() {
    let dir = TempDir::new().unwrap();
    let mut engine =
        PersistentEngine::new(dir.path().join("wellness.db").to_str().unwrap()).expect("engine");
    engine
        .upsert_wellness(&[
            row("2026-09-01", None, Some(48.0)),
            row("2026-09-02", None, None),
        ])
        .expect("seed");

    let sparklines = engine
        .get_wellness_sparklines_to(2, "2026-09-02")
        .expect("read")
        .expect("sparklines");

    assert!(sparklines.hrv.is_empty());
    assert!(sparklines.hrv_read.is_empty());
    assert_eq!(sparklines.rhr_read.len(), sparklines.rhr.len());
}
