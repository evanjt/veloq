//! Scenario: the insight ranker scores an efficiency claim on how far the
//! newest effort sits from the section's own baseline, and the engine is where
//! the per-effort ratios are computed.
//!
//! Expected behaviour: the trend carries that distance, in the series' own
//! standard deviations, so the generator reads one number rather than averaging
//! the ratios a second time. A series with no spread carries none.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test app -p veloqrs -- efficiency_trend_signal::`

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::types::ActivityMetrics;

fn track() -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

/// A section five activities have travelled, each at the heart rate given and
/// all at the same pace, so the ratio series is the heart rates scaled.
fn engine_with_efforts(dir: &TempDir, heart_rates: &[f64]) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");

    for (i, _) in heart_rates.iter().enumerate() {
        let id = format!("a{i}");
        engine
            .add_activity(id.clone(), track(), "Ride".into())
            .expect("add");
        engine
            .set_activity_metrics(vec![ActivityMetrics {
                activity_id: id.clone(),
                name: format!("Effort {i}"),
                date: 1_700_000_000 + (i as i64) * 86_400,
                distance: 1000.0,
                moving_time: 300,
                elapsed_time: 300,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".into(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .expect("metrics");
    }

    // The junction and the section are written straight to the file: detection
    // is not what this is about, and the engine's own connection is private.
    let conn = Connection::open(&path).expect("open");
    let polyline = serde_json::to_string(&track()).expect("polyline");
    conn.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, disabled, version, source_activity_id)
             VALUES ('auto1', 'auto', 'Church Hill', 'Ride', ?1, 800.0, 0, 1, NULL)",
        rusqlite::params![polyline],
    )
    .expect("section");

    for (i, hr) in heart_rates.iter().enumerate() {
        conn.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, lap_pace, avg_hr, excluded)
                 VALUES ('auto1', ?1, 'same', 0, 60, 800.0, 200.0, 4.0, ?2, 0)",
            rusqlite::params![format!("a{i}"), hr],
        )
        .expect("traversal");
    }

    // The catalogue is loaded when the engine opens, so the section written
    // behind it only exists for a reader that opened after it.
    drop(engine);
    drop(conn);
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("reopen");
    engine.load().expect("catalogue");
    engine
}

#[test]
fn the_trend_carries_the_newest_effort_against_its_own_series() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_efforts(&dir, &[150.0, 148.0, 146.0, 144.0, 132.0]);

    let trend = engine
        .get_section_efficiency_trend("auto1", "Ride")
        .expect("five efforts are a trend");

    let ratios: Vec<f64> = trend.points.iter().map(|p| p.hr_pace_ratio).collect();
    let mean = veloqrs::signal::mean(&ratios).expect("a mean");
    let expected = veloqrs::signal::signal_delta(*ratios.last().expect("efforts"), mean, &ratios)
        .expect("the series has spread");

    assert_eq!(
        trend.signal_delta,
        Some(expected),
        "the distance is taken where the ratios are built"
    );
    assert!(expected > 1.0, "the last effort is well off the baseline");
}

#[test]
fn a_series_with_no_spread_carries_no_distance() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_efforts(&dir, &[145.0, 145.0, 145.0, 145.0, 145.0]);

    let trend = engine
        .get_section_efficiency_trend("auto1", "Ride")
        .expect("five efforts are a trend");

    assert!(
        trend.signal_delta.is_none(),
        "every effort is the baseline, so a distance in deviations says nothing"
    );
}
