//! The HRV trend is read over a window ending today, so a stale library
//! answers no verdict. The insights bundle says so, with the date of the
//! newest stored wellness row, so the panel can date the gap.
//!
//! Run: `cargo test --test wellness -p veloqrs -- hrv_withheld::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::wellness::WellnessRow;

fn engine(dir: &TempDir) -> PersistentEngine {
    PersistentEngine::new(dir.path().join("wellness.db").to_str().unwrap()).expect("engine")
}

fn row(date: &str, hrv: f64) -> WellnessRow {
    WellnessRow {
        date: date.to_string(),
        ctl: Some(40.0),
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

fn seed(engine: &mut PersistentEngine, dates: &[&str]) {
    let rows: Vec<WellnessRow> = dates.iter().map(|d| row(d, 50.0)).collect();
    engine.upsert_wellness(&rows).expect("seed");
}

#[test]
fn a_window_emptied_by_time_names_the_newest_stored_date() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    seed(
        &mut engine,
        &[
            "2026-08-31",
            "2026-09-01",
            "2026-09-02",
            "2026-09-03",
            "2026-09-04",
        ],
    );

    let since = engine.hrv_withheld_since_to(7, "2026-09-14").expect("read");

    assert_eq!(since.as_deref(), Some("2026-09-04"));
}

#[test]
fn a_fresh_library_withholds_nothing() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    seed(
        &mut engine,
        &[
            "2026-09-08",
            "2026-09-09",
            "2026-09-10",
            "2026-09-11",
            "2026-09-12",
        ],
    );

    assert_eq!(engine.hrv_withheld_since_to(7, "2026-09-12").unwrap(), None);
}

#[test]
fn a_library_that_never_synced_wellness_withholds_nothing() {
    let dir = TempDir::new().unwrap();
    let engine = engine(&dir);

    assert_eq!(engine.hrv_withheld_since_to(7, "2026-09-12").unwrap(), None);
}

#[test]
fn the_oldest_day_of_the_window_still_counts_as_fresh() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    seed(&mut engine, &["2026-09-06"]);

    assert_eq!(engine.hrv_withheld_since_to(7, "2026-09-12").unwrap(), None);
    assert_eq!(
        engine
            .hrv_withheld_since_to(7, "2026-09-13")
            .unwrap()
            .as_deref(),
        Some("2026-09-06")
    );
}
