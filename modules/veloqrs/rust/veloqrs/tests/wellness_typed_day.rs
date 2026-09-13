//! Scenario: the wellness and fitness screens read a stored day to draw the
//! fitness, fatigue, form and daily-load charts.
//!
//! Expected behaviour: `get_wellness_days` answers with the typed columns and
//! the per-sport loads lifted out of the stored body, and carries nothing
//! else. The screens read `ctl` and `atl` alone, so a day whose `ctl` the API
//! never sent reads as no fitness rather than as that day's own load, which is
//! a different quantity (`Q265`, measured over 1,900 days).

use tempfile::TempDir;
use veloqrs::persistence::PersistentEngine;
use veloqrs::persistence::wellness::WellnessRow;

fn row(date: &str, ctl: Option<f64>, raw: Option<&str>) -> WellnessRow {
    WellnessRow {
        date: date.to_string(),
        ctl,
        atl: ctl.map(|c| c / 2.0),
        ramp_rate: None,
        hrv: Some(48.0),
        resting_hr: Some(52.0),
        weight: None,
        sleep_secs: Some(27_000),
        sleep_score: Some(81.0),
        soreness: None,
        fatigue: None,
        stress: None,
        mood: None,
        motivation: None,
        raw: raw.map(str::to_string),
    }
}

fn engine() -> (TempDir, PersistentEngine) {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");
    (tmp, engine)
}

#[test]
fn a_day_carries_its_typed_columns_and_its_per_sport_loads() {
    let (_tmp, mut engine) = engine();
    let body = r#"{"id":"2026-08-08","ctl":40.0,"ctlLoad":91.0,
        "sportInfo":[{"type":"Ride","load":63.0},{"type":"Run","load":28.0}]}"#;
    engine
        .upsert_wellness(&[row("2026-08-08", Some(40.0), Some(body))])
        .expect("store");

    let days = engine
        .get_wellness_days("2026-08-01", "2026-08-08")
        .expect("read");

    assert_eq!(days.len(), 1);
    let day = &days[0];
    assert_eq!(day.date, "2026-08-08");
    assert_eq!(day.ctl, Some(40.0));
    assert_eq!(day.atl, Some(20.0));
    assert_eq!(day.sleep_secs, Some(27_000));
    assert_eq!(day.sport_load.len(), 2);
    assert_eq!(day.sport_load[0].sport_group.as_deref(), Some("Ride"));
    assert_eq!(day.sport_load[0].load, Some(63.0));
    let total: f64 = day.sport_load.iter().filter_map(|s| s.load).sum();
    assert_eq!(total, 91.0, "the daily load bar sums the breakdown");
}

#[test]
fn a_day_the_api_sent_no_ctl_for_has_none_despite_a_daily_load() {
    let (_tmp, mut engine) = engine();
    // `ctlLoad` is the day's own load, not a second spelling of the fitness
    // curve, so it must not reach a screen that would print it as fitness.
    let body = r#"{"id":"2026-08-09","ctlLoad":91.0,"atlLoad":91.0}"#;
    engine
        .upsert_wellness(&[row("2026-08-09", None, Some(body))])
        .expect("store");

    let days = engine
        .get_wellness_days("2026-08-09", "2026-08-09")
        .expect("read");

    assert_eq!(days[0].ctl, None);
    assert_eq!(days[0].atl, None);
    assert!(days[0].sport_load.is_empty());
}

#[test]
fn a_day_stored_before_the_body_column_reads_its_columns_and_no_loads() {
    let (_tmp, mut engine) = engine();
    engine
        .upsert_wellness(&[row("2026-08-07", Some(36.0), None)])
        .expect("store");

    let days = engine
        .get_wellness_days("2026-08-07", "2026-08-07")
        .expect("read");

    assert_eq!(days[0].ctl, Some(36.0));
    assert_eq!(days[0].hrv, Some(48.0));
    assert!(days[0].sport_load.is_empty());
}

#[test]
fn a_body_that_will_not_parse_is_a_day_with_no_breakdown() {
    let (_tmp, mut engine) = engine();
    engine
        .upsert_wellness(&[row("2026-08-06", Some(30.0), Some("{not json"))])
        .expect("store");

    let days = engine
        .get_wellness_days("2026-08-06", "2026-08-06")
        .expect("read");

    assert_eq!(days.len(), 1, "the row is still read");
    assert_eq!(days[0].ctl, Some(30.0));
    assert!(days[0].sport_load.is_empty());
}

#[test]
fn days_come_back_oldest_first() {
    let (_tmp, mut engine) = engine();
    engine
        .upsert_wellness(&[
            row("2026-08-08", Some(32.0), None),
            row("2026-08-06", Some(34.0), None),
            row("2026-08-07", Some(33.0), None),
        ])
        .expect("store");

    let days = engine
        .get_wellness_days("2026-08-01", "2026-08-08")
        .expect("read");

    let dates: Vec<&str> = days.iter().map(|d| d.date.as_str()).collect();
    assert_eq!(dates, vec!["2026-08-06", "2026-08-07", "2026-08-08"]);
}
