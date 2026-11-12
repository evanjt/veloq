//! Fitness and fatigue folded from the loads of a library with no
//! intervals.icu account.
//!
//! Expected behaviour: one load decays by the time constants after its day; a
//! later ride rewrites only the days from its own; a day intervals.icu served
//! is left as it is; a library holding anything from intervals.icu is not
//! touched; the rows read back marked as Veloq's.

use super::*;
use crate::persistence::PersistentEngine;
use rusqlite::params;
use tempfile::TempDir;

const DAY: i64 = 86_400;
/// 2023-11-14 22:13:20 UTC.
const FIRST_DAY_AT: i64 = 1_700_000_000;

fn engine() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().unwrap();
    let engine =
        PersistentEngine::new(dir.path().join("fitness_series.db").to_str().unwrap()).unwrap();
    (dir, engine)
}

fn ride(engine: &PersistentEngine, id: &str, sport: &str, at: i64, load: f64) {
    engine
        .db
        .execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                     start_date, name, distance_meters, duration_secs)
             VALUES (?1, ?2, 0, 0, 0, 0, ?3, ?1, 0, 0)",
            params![id, sport, at],
        )
        .unwrap();
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                                           elapsed_time, elevation_gain, sport_type,
                                           training_load)
             VALUES (?1, ?1, ?2, 0, 0, 0, 0, ?3, ?4)",
            params![id, at, sport, load],
        )
        .unwrap();
}

fn day(offset: i64) -> String {
    chrono::DateTime::from_timestamp(FIRST_DAY_AT + offset * DAY, 0)
        .unwrap()
        .date_naive()
        .to_string()
}

fn row(engine: &PersistentEngine, date: &str) -> Option<Held> {
    engine
        .db
        .query_row(
            "SELECT ctl, atl, ramp_rate, source FROM wellness WHERE date = ?1",
            params![date],
            |r| {
                Ok(Held {
                    ctl: r.get(0)?,
                    atl: r.get(1)?,
                    ramp_rate: r.get(2)?,
                    source: r.get(3)?,
                })
            },
        )
        .ok()
}

fn weight(days: f64) -> f64 {
    1.0 - (-1.0 / days).exp()
}

#[test]
fn one_load_enters_the_averages_on_its_day_and_decays_after() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);

    refresh(&engine.db, &day(3)).unwrap();

    let Held {
        ctl,
        atl,
        ramp_rate: ramp,
        source,
    } = row(&engine, &day(0)).unwrap();
    assert!((ctl.unwrap() - 100.0 * weight(42.0)).abs() < 1e-9);
    assert!((atl.unwrap() - 100.0 * weight(7.0)).abs() < 1e-9);
    assert_eq!(source.as_deref(), Some("veloq"));
    assert!(
        (ramp.unwrap() - ctl.unwrap()).abs() < 1e-9,
        "the week's change from nothing"
    );

    let Held {
        ctl: ctl3,
        atl: atl3,
        ..
    } = row(&engine, &day(3)).unwrap();
    let kept = |days: f64| (-1.0 / days).exp().powi(3);
    assert!((ctl3.unwrap() - 100.0 * weight(42.0) * kept(42.0)).abs() < 1e-9);
    assert!((atl3.unwrap() - 100.0 * weight(7.0) * kept(7.0)).abs() < 1e-9);
}

#[test]
fn the_ramp_rate_is_the_change_in_fitness_over_the_week() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);

    refresh(&engine.db, &day(9)).unwrap();

    let ctl = |n| row(&engine, &day(n)).unwrap().ctl.unwrap();
    let ramp = row(&engine, &day(9)).unwrap().ramp_rate.unwrap();
    assert!((ramp - (ctl(9) - ctl(2))).abs() < 1e-9);
}

#[test]
fn weight_training_adds_fatigue_and_no_fitness() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "WeightTraining", FIRST_DAY_AT, 100.0);

    refresh(&engine.db, &day(0)).unwrap();

    let Held { ctl, atl, .. } = row(&engine, &day(0)).unwrap();
    assert_eq!(ctl, Some(0.0));
    assert!((atl.unwrap() - 100.0 * weight(7.0)).abs() < 1e-9);
}

#[test]
fn a_later_ride_rewrites_only_the_days_from_its_own() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);
    refresh(&engine.db, &day(5)).unwrap();
    let before = row(&engine, &day(1)).unwrap();
    engine
        .db
        .execute("UPDATE wellness SET updated_at = 1", [])
        .unwrap();

    ride(&engine, "src-b", "Ride", FIRST_DAY_AT + 3 * DAY, 50.0);
    let written = refresh(&engine.db, &day(5)).unwrap();

    assert_eq!(written, 3, "days 3, 4 and 5");
    assert_eq!(row(&engine, &day(1)).unwrap(), before);
    let touched: i64 = engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM wellness WHERE updated_at > 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(touched, 3);
    assert!(
        row(&engine, &day(3)).unwrap().ctl.unwrap() > row(&engine, &day(2)).unwrap().ctl.unwrap()
    );
}

#[test]
fn a_second_refresh_with_nothing_new_writes_nothing() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);
    refresh(&engine.db, &day(5)).unwrap();

    assert_eq!(refresh(&engine.db, &day(5)).unwrap(), 0);
}

#[test]
fn a_day_intervals_served_keeps_its_figures() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);
    engine
        .db
        .execute(
            "INSERT INTO wellness (date, ctl, atl, ramp_rate, updated_at)
             VALUES (?1, 61.0, 55.0, 2.0, 1)",
            params![day(1)],
        )
        .unwrap();

    refresh(&engine.db, &day(2)).unwrap();

    assert_eq!(
        row(&engine, &day(1)).unwrap(),
        Held {
            ctl: Some(61.0),
            atl: Some(55.0),
            ramp_rate: Some(2.0),
            source: None
        }
    );
    assert!(row(&engine, &day(2)).unwrap().source.is_some());
}

#[test]
fn a_day_holding_only_a_body_is_filled_in_and_keeps_the_body() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);
    engine
        .db
        .execute(
            "INSERT INTO wellness (date, raw, updated_at) VALUES (?1, '{\"sportInfo\":[]}', 1)",
            params![day(0)],
        )
        .unwrap();

    refresh(&engine.db, &day(0)).unwrap();

    assert_eq!(
        row(&engine, &day(0)).unwrap().source.as_deref(),
        Some("veloq")
    );
    let raw: String = engine
        .db
        .query_row(
            "SELECT raw FROM wellness WHERE date = ?1",
            params![day(0)],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, "{\"sportInfo\":[]}");
}

#[test]
fn a_library_holding_anything_from_intervals_is_not_touched() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);
    ride(&engine, "i42", "Ride", FIRST_DAY_AT + DAY, 80.0);

    assert_eq!(refresh(&engine.db, &day(3)).unwrap(), 0);
    assert!(row(&engine, &day(0)).is_none());
}

#[test]
fn a_library_with_no_load_writes_nothing() {
    let (_dir, engine) = engine();

    assert_eq!(refresh(&engine.db, &day(3)).unwrap(), 0);
}

#[test]
fn the_time_constants_the_athlete_set_apply_from_their_date() {
    let (_dir, engine) = engine();
    engine
        .set_setting(
        crate::persistence::settings_keys::FITNESS_MODEL_EVENTS,
        &format!(
            "[{{\"category\":\"FITNESS_DAYS\",\"start_date_local\":\"{}T00:00:00\",\"ctl_days\":30,\"atl_days\":5}}]",
            day(0)
        ),
    )
    .unwrap();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);

    refresh(&engine.db, &day(0)).unwrap();

    let Held { ctl, atl, .. } = row(&engine, &day(0)).unwrap();
    assert!((ctl.unwrap() - 100.0 * weight(30.0)).abs() < 1e-9);
    assert!((atl.unwrap() - 100.0 * weight(5.0)).abs() < 1e-9);
}

#[test]
fn the_wellness_days_read_carries_the_veloq_mark_on_a_computed_day_only() {
    let (_dir, engine) = engine();
    ride(&engine, "src-a", "Ride", FIRST_DAY_AT, 100.0);
    engine
        .db
        .execute(
            "INSERT INTO wellness (date, ctl, atl, updated_at) VALUES ('2020-01-01', 40.0, 35.0, 1)",
            [],
        )
        .unwrap();
    refresh(&engine.db, &day(1)).unwrap();

    let days = engine.get_wellness_days("2020-01-01", &day(1)).unwrap();

    assert_eq!(days[0].source, None);
    assert_eq!(days[1].source.as_deref(), Some("veloq"));
    assert!(days[1].ctl.is_some());
}
