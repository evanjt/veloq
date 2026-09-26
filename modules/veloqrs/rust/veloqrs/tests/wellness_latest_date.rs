//! Scenario: the insights panel has to date the last wellness sync so a stale
//! form reading can be dropped and explained rather than vanishing.
//!
//! Expected behaviour: `latest_wellness_date` answers the newest stored date,
//! and `None` on an empty table, without reading a row's CTL or ATL.

use tempfile::TempDir;
use veloqrs::persistence::PersistentEngine;
use veloqrs::persistence::wellness::WellnessRow;

fn row(date: &str) -> WellnessRow {
    WellnessRow {
        date: date.to_string(),
        ctl: Some(40.0),
        atl: Some(20.0),
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

fn engine() -> (TempDir, PersistentEngine) {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");
    (tmp, engine)
}

#[test]
fn an_empty_table_has_no_latest_date() {
    let (_tmp, engine) = engine();
    assert_eq!(engine.latest_wellness_date().expect("query"), None);
}

#[test]
fn the_latest_date_is_the_newest_row_whatever_the_insert_order() {
    let (_tmp, mut engine) = engine();
    engine
        .upsert_wellness(&[row("2026-08-08"), row("2026-06-01"), row("2026-07-15")])
        .expect("store");

    assert_eq!(
        engine.latest_wellness_date().expect("query"),
        Some("2026-08-08".to_string())
    );
}
