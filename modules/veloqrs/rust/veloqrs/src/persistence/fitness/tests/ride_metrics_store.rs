//! Scenario: Garmin originals are stored in a library that has no intervals.icu
//! account, so their rows carry no training load, FTP or zone times.
//!
//! Expected behaviour: the ride's streams and the athlete's thresholds give the
//! row its load, intensity, normalised power, zone seconds, efficiency factor
//! and decoupling, stored beside the server columns and marked as Veloq's. A
//! row intervals.icu numbers keep their numbers and the `intervals` mark, and a
//! ride with neither power nor heart rate gets nothing.

use crate::fit_synthetic::{Activity, Sample, SessionTotals, Thresholds, outdoor_ride};
use crate::net::garmin::ingest::ingest_into;
use crate::net::garmin::wire::ListedActivity;
use crate::persistence::PersistentEngine;
use crate::persistence::fitness::sport_settings::{ThresholdField, set_threshold_override};
use crate::persistence::origin::garmin_source_key;
use serde_json::json;
use tempfile::TempDir;

const GARMIN_ID: i64 = 24_686_966_034;

fn engine() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    (dir, engine)
}

fn listed(id: i64) -> ListedActivity {
    serde_json::from_value(json!({
        "activityId": id,
        "activityName": "Long ride",
        "startTimeLocal": "2026-03-14 09:00:00",
        "startTimeGMT": "2026-03-14 07:00:00",
        "activityType": {"typeKey": "cycling"},
        "duration": 3600.0,
        "elapsedDuration": 3600.0,
        "distance": 1.0
    }))
    .unwrap()
}

fn sample(at: u32, tracked: bool, power: Option<u16>, heart_rate: Option<u8>) -> Sample {
    Sample {
        at,
        position: tracked.then(|| (46.5 + f64::from(at) * 0.00001, 7.25)),
        power,
        heart_rate,
        ..Sample::default()
    }
}

/// An hour of riding at 1 Hz.
fn hour(tracked: bool, power: Option<u16>, heart_rate: Option<u8>) -> Activity {
    let mut ride = outdoor_ride();
    ride.samples = (0..3600)
        .map(|at| sample(at, tracked, power, heart_rate))
        .collect();
    ride.totals = SessionTotals {
        elapsed_secs: Some(3600.0),
        timer_secs: Some(3600.0),
        ..SessionTotals::default()
    };
    ride
}

fn thresholds() -> Thresholds {
    Thresholds {
        ftp: Some(250),
        threshold_hr: Some(170),
        max_hr: Some(190),
        resting_hr: Some(50),
        ..Thresholds::default()
    }
}

fn store(engine: &mut PersistentEngine, ride: &Activity) -> String {
    ingest_into(engine, None, &listed(GARMIN_ID), &ride.to_fit()).expect("stored");
    garmin_source_key(GARMIN_ID)
}

fn row(
    engine: &PersistentEngine,
    key: &str,
) -> (Option<f64>, Option<f64>, Option<String>, f64, f64) {
    engine
        .db
        .query_row(
            "SELECT training_load, ftp, metrics_source, power_z4, hr_z5
             FROM activity_metrics WHERE activity_id = ?",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap()
}

fn body(engine: &PersistentEngine, key: &str) -> serde_json::Value {
    serde_json::from_str(&engine.get_activity_body(key).expect("a body")).unwrap()
}

fn near(got: Option<f64>, want: f64) {
    let got = got.expect("a figure");
    assert!((got - want).abs() < 0.5, "{got} != {want}");
}

#[test]
fn an_hour_at_ftp_stored_without_an_account_gets_a_hundred_load_marked_as_veloqs() {
    for tracked in [true, false] {
        let (_dir, mut engine) = engine();
        let mut ride = hour(tracked, Some(250), Some(150));
        ride.thresholds = Some(thresholds());
        let key = store(&mut engine, &ride);

        let (load, ftp, source, power_z4, _) = row(&engine, &key);
        near(load, 100.0);
        assert_eq!(ftp, Some(250.0));
        assert_eq!(source.as_deref(), Some("veloq"), "tracked: {tracked}");
        assert_eq!(power_z4, 3600.0);
        near(engine.activity_metrics[&key].training_load, 100.0);

        let body = body(&engine, &key);
        near(body["icu_training_load"].as_f64(), 100.0);
        near(body["icu_intensity"].as_f64(), 100.0);
        near(body["icu_weighted_avg_watts"].as_f64(), 250.0);
        assert_eq!(body["metrics_source"], "veloq");

        let record = crate::persistence::activities::activity_record(
            &key,
            &engine.get_activity_body(&key).unwrap(),
        )
        .unwrap();
        near(record.training_load, 100.0);
        near(record.intensity, 100.0);
        near(record.efficiency_factor, 250.0 / 150.0);
        near(record.decoupling, 0.0);
        assert_eq!(record.metrics_source.as_deref(), Some("veloq"));
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_ride_with_heart_rate_only_gets_a_heart_rate_load_and_no_intensity() {
    let (_dir, mut engine) = engine();
    let mut ride = hour(true, None, Some(170));
    ride.thresholds = Some(thresholds());
    let key = store(&mut engine, &ride);

    let (load, ftp, source, _, hr_z5) = row(&engine, &key);
    near(load, 100.0);
    assert_eq!(ftp, None, "no FTP was used");
    assert_eq!(source.as_deref(), Some("veloq"));
    assert_eq!(hr_z5, 3600.0);
    let body = body(&engine, &key);
    assert!(body.get("icu_intensity").is_none());
    assert!(body.get("icu_weighted_avg_watts").is_none());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_ride_with_neither_power_nor_heart_rate_gets_no_figures_and_no_mark() {
    let (_dir, mut engine) = engine();
    let mut ride = hour(true, None, None);
    ride.thresholds = Some(thresholds());
    let key = store(&mut engine, &ride);

    let (load, ftp, source, power_z4, _) = row(&engine, &key);
    assert_eq!((load, ftp, source, power_z4), (None, None, None, 0.0));
    assert!(body(&engine, &key).get("icu_training_load").is_none());
}

#[test]
fn a_ride_with_an_intervals_body_keeps_its_numbers_and_gets_the_intervals_mark() {
    let (_dir, mut engine) = engine();
    let mut ride = hour(true, Some(250), Some(150));
    ride.thresholds = Some(thresholds());
    let key = store(&mut engine, &ride);
    // intervals.icu then serves its own figures for the row.
    let mut served = body(&engine, &key);
    served["icu_training_load"] = json!(77.0);
    served.as_object_mut().unwrap().remove("metrics_source");
    engine
        .db
        .execute(
            "UPDATE activity_bodies SET raw = ? WHERE activity_id = ?",
            rusqlite::params![served.to_string(), key],
        )
        .unwrap();
    engine
        .db
        .execute(
            "UPDATE activity_metrics SET metrics_source = NULL, training_load = 77.0
             WHERE activity_id = ?",
            [&key],
        )
        .unwrap();

    engine.settle_ride_metrics(&key).unwrap();

    let (load, _, source, _, _) = row(&engine, &key);
    assert_eq!(load, Some(77.0));
    assert_eq!(source.as_deref(), Some("intervals"));
    assert_eq!(body(&engine, &key)["icu_training_load"], 77.0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn settling_a_scored_ride_again_changes_nothing() {
    let (_dir, mut engine) = engine();
    let mut ride = hour(true, Some(250), Some(150));
    ride.thresholds = Some(thresholds());
    let key = store(&mut engine, &ride);
    let before = (row(&engine, &key), body(&engine, &key));

    engine.settle_ride_metrics(&key).unwrap();

    assert_eq!((row(&engine, &key), body(&engine, &key)), before);
}

#[test]
fn the_backfill_scores_a_stored_ride_once_the_athlete_has_set_the_threshold() {
    let (_dir, mut engine) = engine();
    let ride = hour(true, Some(250), Some(150));
    let key = store(&mut engine, &ride);
    let unjudged = row(&engine, &key);
    assert_eq!(
        (unjudged.0, unjudged.1),
        (None, None),
        "no FTP is known yet"
    );

    set_threshold_override(&engine.db, "Ride", ThresholdField::Ftp, Some(250.0)).unwrap();
    let mut attempted = std::collections::HashSet::new();
    assert_eq!(
        engine
            .backfill_ride_metrics_page(&mut attempted, 10)
            .unwrap(),
        1
    );

    let (load, ftp, source, _, _) = row(&engine, &key);
    near(load, 100.0);
    assert_eq!(ftp, Some(250.0));
    assert_eq!(source.as_deref(), Some("veloq"));
    // Nothing is owed on a second pass, and a ride the thresholds still cannot
    // score is not written again.
    let mut attempted = std::collections::HashSet::new();
    assert_eq!(
        engine
            .backfill_ride_metrics_page(&mut attempted, 10)
            .unwrap(),
        0
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_backfill_leaves_a_ride_without_streams_alone() {
    let (_dir, mut engine) = engine();
    let mut empty = hour(true, None, None);
    empty.thresholds = Some(thresholds());
    store(&mut engine, &empty);
    let mut attempted = std::collections::HashSet::new();
    assert_eq!(
        engine
            .backfill_ride_metrics_page(&mut attempted, 10)
            .unwrap(),
        0
    );
}

/// Scenario: a library holds a stored ride and the athlete has set an FTP since.
///
/// Expected behaviour: the owed work started at open scores the ride on its own
/// thread with no credential, and asking again once nothing is owed starts
/// nothing.
#[test]
fn the_owed_work_at_open_scores_stored_rides_without_a_credential() {
    use crate::objects::FfiStartOutcome;
    use crate::persistence::fitness::ride_metrics::start_backfill;
    use crate::persistence::with_persistent_engine;

    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("ride_metrics_backfill.db");
    let key = with_persistent_engine(|engine| {
        let key = store(engine, &hour(true, Some(250), Some(150)));
        set_threshold_override(&engine.db, "Ride", ThresholdField::Ftp, Some(250.0)).unwrap();
        key
    })
    .unwrap();

    crate::net::elevation_backfill::start_owed_work();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while with_persistent_engine(|engine| row(engine, &key).2)
        .unwrap()
        .as_deref()
        != Some("veloq")
        || with_persistent_engine(|engine| row(engine, &key).0)
            .unwrap()
            .is_none()
    {
        assert!(
            std::time::Instant::now() < deadline,
            "the pass never finished"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    while start_backfill() == FfiStartOutcome::Busy {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(start_backfill(), FfiStartOutcome::NotOwed);
}

#[test]
fn a_run_with_speed_only_is_scored_once_the_athlete_sets_a_threshold_pace() {
    let (_dir, mut engine) = engine();
    let mut run = hour(true, None, None);
    run.sport = 1;
    run.sub_sport = 0;
    for s in &mut run.samples {
        s.speed = Some(3.5);
    }
    let mut listing = listed(GARMIN_ID);
    listing.activity_type = serde_json::from_value(json!({"typeKey": "running"})).unwrap();
    ingest_into(&mut engine, None, &listing, &run.to_fit()).expect("stored");
    let key = garmin_source_key(GARMIN_ID);
    assert_eq!(row(&engine, &key).0, None, "no threshold pace is known yet");

    set_threshold_override(&engine.db, "Run", ThresholdField::ThresholdPace, Some(3.5)).unwrap();
    let mut attempted = std::collections::HashSet::new();
    assert_eq!(
        engine
            .backfill_ride_metrics_page(&mut attempted, 10)
            .unwrap(),
        1
    );

    let (load, _, source, _, _) = row(&engine, &key);
    near(load, 100.0);
    assert_eq!(source.as_deref(), Some("veloq"));
    assert_eq!(body(&engine, &key).get("icu_intensity"), None);
}

fn three_laps(ride: &mut Activity) {
    ride.laps = [0u32, 1200, 2400]
        .into_iter()
        .map(|start| crate::fit_synthetic::Lap {
            start,
            elapsed_secs: 1200.0,
            timer_secs: Some(1200.0),
            ..Default::default()
        })
        .collect();
}

fn laps(engine: &PersistentEngine, key: &str) -> Vec<serde_json::Value> {
    let raw = engine.get_interval_body(key).unwrap().expect("a lap body");
    serde_json::from_str::<serde_json::Value>(&raw).unwrap()["icu_intervals"]
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn each_lap_of_a_ride_with_an_ftp_carries_a_load_and_intensity_that_sum_to_the_rides() {
    let (_dir, mut engine) = engine();
    let mut ride = hour(true, Some(250), Some(150));
    three_laps(&mut ride);
    ride.thresholds = Some(thresholds());
    let key = store(&mut engine, &ride);

    let laps = laps(&engine, &key);
    assert_eq!(laps.len(), 3);
    let mut total = 0.0;
    for lap in &laps {
        near(lap["icu_intensity"].as_f64(), 100.0);
        total += lap["icu_training_load"].as_f64().expect("a lap load");
    }
    let ride_load = body(&engine, &key)["icu_training_load"].as_f64().unwrap();
    assert!((total - ride_load).abs() < 1.0, "{total} vs {ride_load}");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn laps_of_a_ride_with_no_thresholds_carry_no_load() {
    let (_dir, mut engine) = engine();
    let mut ride = hour(true, Some(250), Some(150));
    three_laps(&mut ride);
    let key = store(&mut engine, &ride);

    let laps = laps(&engine, &key);
    assert_eq!(laps.len(), 3);
    for lap in &laps {
        assert!(lap.get("icu_training_load").is_none());
        assert!(lap.get("icu_intensity").is_none());
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_lap_with_heart_rate_only_carries_a_load_and_no_intensity() {
    let (_dir, mut engine) = engine();
    let mut ride = hour(true, None, Some(170));
    three_laps(&mut ride);
    ride.thresholds = Some(thresholds());
    let key = store(&mut engine, &ride);

    for lap in laps(&engine, &key) {
        assert!(lap["icu_training_load"].as_f64().unwrap() > 0.0);
        assert!(lap.get("icu_intensity").is_none());
    }
}
