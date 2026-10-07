//! Scenario: the efficiency card claims an athlete's heart rate at the same
//! pace has dropped. The ratio behind it divided heart rate by seconds per
//! kilometre, and a slower effort has more seconds per kilometre, so slowing
//! down at a constant heart rate lowered the ratio and read as a claim.
//!
//! Expected behaviour: the ratio is heart rate per unit of speed, so it rises
//! when the athlete slows and falls when they speed up or their heart rate
//! drops. The count the card prints is the efforts the regression actually
//! used, not the rows before the pace filter.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test app -p veloqrs -- efficiency_trend_direction::`

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::types::ActivityMetrics;
use veloqrs::{EfficiencyDirection, PersistentEngine};

/// The section is 800 m, so a lap time is four fifths of its pace per km.
const SECTION_METRES: f64 = 800.0;

fn track() -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

/// A section travelled once a day, each effort at the pace and heart rate
/// given. `efforts` is `(pace_secs_per_km, avg_hr)`.
fn engine_with_efforts(dir: &TempDir, efforts: &[(f64, f64)]) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");

    for (i, _) in efforts.iter().enumerate() {
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

    let conn = Connection::open(&path).expect("open");
    let polyline = serde_json::to_string(&track()).expect("polyline");
    conn.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version, source_activity_id)
         VALUES ('auto1', 'auto', 'Church Hill', 'Ride', ?1, 800.0, 0, 1, NULL)",
        rusqlite::params![polyline],
    )
    .expect("section");

    for (i, (pace, hr)) in efforts.iter().enumerate() {
        let lap_time = pace * SECTION_METRES / 1000.0;
        conn.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                 start_index, end_index, distance_meters, lap_time, lap_pace, avg_hr, excluded)
             VALUES ('auto1', ?1, 'same', 0, 60, ?2, ?3, ?4, ?5, 0)",
            rusqlite::params![format!("a{i}"), SECTION_METRES, lap_time, pace / 60.0, hr],
        )
        .expect("traversal");
    }

    drop(engine);
    drop(conn);
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("reopen");
    engine.load().expect("catalogue");
    engine
}

#[test]
fn slowing_down_at_the_same_heart_rate_is_not_an_improvement() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_efforts(
        &dir,
        &[
            (300.0, 150.0),
            (310.0, 150.0),
            (320.0, 150.0),
            (330.0, 150.0),
            (340.0, 150.0),
        ],
    );

    let trend = engine
        .get_section_efficiency_trend("auto1", "Ride")
        .expect("five efforts are a trend");

    assert!(
        trend.trend_slope > 0.0,
        "the cost of the same speed went up, so the ratio rises: {}",
        trend.trend_slope
    );
    assert_eq!(trend.direction, EfficiencyDirection::Worsening);
    // `hr_change_bpm` is the ratio's own change restated at the mean pace, so
    // a pace-only change still moves it. What matters is the sign: positive is
    // a cost that went up, and the card's "dropped by" sentence can never be
    // drawn from it.
    assert!(
        trend.hr_change_bpm > 0.0,
        "the cost rose, so the number cannot read as beats saved: {}",
        trend.hr_change_bpm
    );
}

#[test]
fn a_falling_heart_rate_at_the_same_pace_is_an_improvement() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_efforts(
        &dir,
        &[
            (300.0, 150.0),
            (300.0, 148.0),
            (300.0, 146.0),
            (300.0, 144.0),
            (300.0, 142.0),
        ],
    );

    let trend = engine
        .get_section_efficiency_trend("auto1", "Ride")
        .expect("five efforts are a trend");

    assert!(trend.trend_slope < 0.0, "the cost of the same speed fell");
    assert_eq!(trend.direction, EfficiencyDirection::Improving);
    assert!(
        (trend.hr_change_bpm + 8.0).abs() < 0.5,
        "150 to 142 at one pace is eight beats: {}",
        trend.hr_change_bpm
    );
}

#[test]
fn speeding_up_at_the_same_heart_rate_is_an_improvement() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_efforts(
        &dir,
        &[
            (340.0, 150.0),
            (330.0, 150.0),
            (320.0, 150.0),
            (310.0, 150.0),
            (300.0, 150.0),
        ],
    );

    let trend = engine
        .get_section_efficiency_trend("auto1", "Ride")
        .expect("five efforts are a trend");

    assert_eq!(trend.direction, EfficiencyDirection::Improving);
}

#[test]
fn the_count_is_the_efforts_the_regression_used() {
    let dir = TempDir::new().expect("tempdir");
    // The second effort is 15 s/km, faster than the 60 s/km floor, so the
    // ratio series drops it and the sentence must not count it.
    let mut engine = engine_with_efforts(
        &dir,
        &[
            (300.0, 150.0),
            (15.0, 150.0),
            (300.0, 148.0),
            (300.0, 146.0),
            (300.0, 144.0),
            (300.0, 142.0),
        ],
    );

    let trend = engine
        .get_section_efficiency_trend("auto1", "Ride")
        .expect("five surviving efforts are a trend");

    assert_eq!(
        trend.points.len(),
        5,
        "the implausible pace is filtered out"
    );
    assert_eq!(
        trend.effort_count, 5,
        "the count is the points regressed, not the rows read"
    );
}

/// The athlete named the section, and the name lives on the named overlay
/// rather than on the detected row. The card titles the trend with it.
#[test]
fn the_trend_carries_the_name_the_athlete_gave_the_section() {
    let dir = TempDir::new().expect("tmp");
    let mut engine = engine_with_efforts(&dir, &[(300.0, 150.0), (300.0, 148.0), (300.0, 146.0)]);
    engine
        .set_section_name("auto1", Some("Col du Test"))
        .expect("name the section");

    let trend = engine
        .get_section_efficiency_trend("auto1", "Ride")
        .expect("three efforts are a trend");

    assert_eq!(trend.section_name, "Col du Test");
}
