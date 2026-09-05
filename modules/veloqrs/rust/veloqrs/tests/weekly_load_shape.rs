//! A week's load has a shape, and the shape is only honest when the week has
//! enough training days to have one.
//!
//! `get_period_stats` sums a window into one record, so the engine could say a
//! week carried four hundred load points and not whether that was one day or
//! seven. Measured over 190 weeks of a real account, weeks of 200 to 400
//! points spread from 0.45 to 1.92 on the mean-over-deviation of their daily
//! loads, so the reading separates weeks that the total cannot. On a week with
//! six rest days the same ratio is `1/sqrt(6)` whatever the one day carried,
//! which is a constant dressed as a measurement, so it is withheld.
//!
//! Run: `cargo test --test weekly_load_shape -p veloqrs`

use std::path::Path;

use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

/// Midnight UTC of a `YYYY-MM-DD` day, which is what `activity_metrics.date` holds.
fn day(date: &str) -> i64 {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .expect("date")
        .and_hms_opt(0, 0, 0)
        .expect("midnight")
        .and_utc()
        .timestamp()
}

fn open(dir: &TempDir) -> (PersistentEngine, Connection) {
    let path = dir.path().join("load.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let raw = Connection::open(&path).expect("raw open");
    (engine, raw)
}

/// One activity on `date` carrying `load` training-load points.
fn add(db: &Connection, id: &str, date: &str, load: f64) {
    db.execute(
        "INSERT INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, sport_type, training_load)
             VALUES (?1, ?1, ?2, 10000.0, 3600, 3600, 0.0, 'Ride', ?3)",
        params![id, day(date), load],
    )
    .expect("insert metrics");
}

const MONDAY: &str = "2026-08-31";
const SUNDAY: &str = "2026-09-06";

fn shape(engine: &PersistentEngine) -> Option<f64> {
    engine
        .get_week_load_shape(day(MONDAY), day(SUNDAY))
        .map(|s| s.evenness)
}

#[test]
fn a_week_of_four_equal_days_reads_differently_from_four_unequal_ones() {
    let dir = TempDir::new().unwrap();
    let (engine, db) = open(&dir);
    for (i, d) in ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"]
        .iter()
        .enumerate()
    {
        add(&db, &format!("even{i}"), d, 75.0);
    }
    let even = shape(&engine).expect("a reading");

    let dir2 = TempDir::new().unwrap();
    let (engine2, db2) = open(&dir2);
    for (i, (d, load)) in [
        ("2026-08-31", 240.0),
        ("2026-09-01", 30.0),
        ("2026-09-02", 20.0),
        ("2026-09-03", 10.0),
    ]
    .iter()
    .enumerate()
    {
        add(&db2, &format!("uneven{i}"), d, *load);
    }
    let uneven = shape(&engine2).expect("a reading");

    assert!(
        even > uneven,
        "an even week must read higher than a spiky one of the same total: {even} against {uneven}"
    );
}

#[test]
fn a_week_of_one_hard_day_reports_nothing_rather_than_the_constant() {
    let dir = TempDir::new().unwrap();
    let (engine, db) = open(&dir);
    add(&db, "one", "2026-09-02", 400.0);

    assert_eq!(
        engine.get_week_load_shape(day(MONDAY), day(SUNDAY)),
        None,
        "one training day has no shape, and 1/sqrt(6) is not a measurement of it"
    );
}

#[test]
fn the_floor_is_four_training_days() {
    let dir = TempDir::new().unwrap();
    let (engine, db) = open(&dir);
    for (i, d) in ["2026-08-31", "2026-09-01", "2026-09-02"]
        .iter()
        .enumerate()
    {
        add(&db, &format!("three{i}"), d, 100.0);
    }
    assert_eq!(engine.get_week_load_shape(day(MONDAY), day(SUNDAY)), None);

    add(&db, "fourth", "2026-09-03", 100.0);
    assert!(
        engine
            .get_week_load_shape(day(MONDAY), day(SUNDAY))
            .is_some()
    );
}

#[test]
fn a_week_whose_activities_carry_no_load_reports_nothing() {
    let dir = TempDir::new().unwrap();
    let (engine, db) = open(&dir);
    for (i, d) in ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"]
        .iter()
        .enumerate()
    {
        add(&db, &format!("zero{i}"), d, 0.0);
    }

    assert_eq!(engine.get_week_load_shape(day(MONDAY), day(SUNDAY)), None);
}

#[test]
fn the_daily_series_sums_to_the_window_total() {
    let dir = TempDir::new().unwrap();
    let (engine, db) = open(&dir);
    for (i, (d, load)) in [
        ("2026-08-31", 90.0),
        ("2026-09-01", 60.0),
        ("2026-09-02", 30.0),
        ("2026-09-05", 120.0),
    ]
    .iter()
    .enumerate()
    {
        add(&db, &format!("a{i}"), d, *load);
    }

    let shape = engine
        .get_week_load_shape(day(MONDAY), day(SUNDAY))
        .expect("a reading");
    let window = engine.get_period_stats(day(MONDAY), day(SUNDAY));

    assert_eq!(shape.daily.len(), 7, "a week is seven days, gaps included");
    assert!((shape.daily.iter().sum::<f64>() - window.total_tss).abs() < 1e-6);
    assert_eq!(shape.training_days, 4);
}

#[test]
fn an_empty_week_reports_nothing() {
    let dir = TempDir::new().unwrap();
    let (engine, db) = open(&dir);

    assert_eq!(engine.get_week_load_shape(day(MONDAY), day(SUNDAY)), None);
}
