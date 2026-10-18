use super::PersistentEngine;
use crate::{FfiActivityBody, GpsPoint};
use serde_json::{Value, json};

const ACTIVITY_BODY: &str = include_str!("../../../tests/fixtures/intervals/activity_body.json");

fn body(id: &str, raw: Value) -> FfiActivityBody {
    FfiActivityBody {
        activity_id: id.into(),
        date: 1_773_473_400.0,
        raw: raw.to_string(),
    }
}

fn track() -> Vec<GpsPoint> {
    vec![GpsPoint::new(46.0, 7.0), GpsPoint::new(46.001, 7.001)]
}

fn metrics(engine: &PersistentEngine, id: &str) -> Value {
    serde_json::to_value(engine.activity_metrics.get(id).expect("metrics row")).unwrap()
}

/// The zone columns the row was written with. The loader leaves the zone
/// series off the in-memory row, so a reopened engine is read from the table.
fn stored_zones(engine: &PersistentEngine, id: &str) -> (Vec<f64>, Vec<f64>) {
    engine
        .db
        .query_row(
            "SELECT power_z1, power_z2, power_z3, power_z4, power_z5, power_z6, power_z7,
                    hr_z1, hr_z2, hr_z3, hr_z4, hr_z5, hr_z6, hr_z7
             FROM activity_metrics WHERE activity_id = ?",
            [id],
            |row| {
                let column = |i: usize| row.get::<_, Option<f64>>(i).map(Option::unwrap_or_default);
                Ok((
                    (0..7).map(column).collect::<Result<_, _>>()?,
                    (7..14).map(column).collect::<Result<_, _>>()?,
                ))
            },
        )
        .unwrap()
}

#[test]
fn full_activity_body_yields_every_metrics_field() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("metrics.db");
    let path = path.to_str().unwrap();

    let full: Value = serde_json::from_str(ACTIVITY_BODY).unwrap();
    let mut clamped = full.clone();
    clamped["moving_time"] = json!(-30);
    clamped["elapsed_time"] = json!(-1);

    let expected_full = json!({
        "activityId": "local-full",
        "name": "Harbour Loop",
        "date": 1_773_473_400,
        "distance": 42137.6,
        "movingTime": 5421,
        "elapsedTime": 5890,
        "elevationGain": 512.4,
        "avgHr": 142,
        "avgPower": 204,
        "sportType": "Ride",
        "trainingLoad": 97.4,
        "ftp": 249,
        "powerZoneTimes": [600, 1800, 1200, 700, 100, 20, 1],
        "hrZoneTimes": [900, 2100, 1600, 700, 121, 0, 0],
    });
    let mut expected_clamped = expected_full.clone();
    expected_clamped["activityId"] = json!("local-clamped");
    expected_clamped["movingTime"] = json!(0);
    expected_clamped["elapsedTime"] = json!(0);

    {
        let mut engine = PersistentEngine::new(path).unwrap();
        engine
            .save_provisional_activity("local-full", track(), &body("local-full", full))
            .unwrap();
        engine
            .save_provisional_activity("local-clamped", track(), &body("local-clamped", clamped))
            .unwrap();
        assert_eq!(metrics(&engine, "local-full"), expected_full);
        assert_eq!(metrics(&engine, "local-clamped"), expected_clamped);
    }

    let mut reopened = PersistentEngine::new(path).unwrap();
    reopened.load().unwrap();
    for (id, mut expected) in [
        ("local-full", expected_full),
        ("local-clamped", expected_clamped),
    ] {
        expected["powerZoneTimes"] = Value::Null;
        expected["hrZoneTimes"] = Value::Null;
        assert_eq!(metrics(&reopened, id), expected);
        assert_eq!(
            stored_zones(&reopened, id),
            (
                vec![600.0, 1800.0, 1200.0, 700.0, 100.0, 20.0, 1.0],
                vec![900.0, 2100.0, 1600.0, 700.0, 121.0, 0.0, 0.0],
            )
        );
    }
}

#[test]
fn zone_series_in_an_unknown_shape_keeps_the_row() {
    let mut raw: Value = serde_json::from_str(ACTIVITY_BODY).unwrap();
    raw["icu_zone_times"] = json!("Z1:600,Z2:1800");
    let mut engine = PersistentEngine::in_memory().unwrap();

    engine
        .save_provisional_activity("local-odd", track(), &body("local-odd", raw))
        .unwrap();

    let row = metrics(&engine, "local-odd");
    assert_eq!(row["powerZoneTimes"], Value::Null);
    assert_eq!(row["hrZoneTimes"], json!([900, 2100, 1600, 700, 121, 0, 0]));
    assert_eq!(row["trainingLoad"], json!(97.4));
}
