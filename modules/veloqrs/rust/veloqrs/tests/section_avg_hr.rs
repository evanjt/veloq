//! The effort a lap was ridden at, beside the time it took.
//!
//! `section_activities.avg_hr` has existed since migration 012 and no writer
//! ever filled it, so `get_section_efficiency_trend` filtered every row out and
//! the efficiency card has never been on screen. The heart rate comes from the
//! same slice the lap time does.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test section_avg_hr -p veloqrs`

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::net::types::StreamDto;

fn track() -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

fn series(kind: &str, data: Vec<Option<f64>>) -> StreamDto {
    StreamDto {
        kind: kind.to_string(),
        data,
        data2: None,
    }
}

/// A rising heart rate, so a slice's mean is distinguishable from the whole
/// activity's.
fn heart_rates() -> Vec<Option<f64>> {
    (0..60).map(|i| Some(100.0 + f64::from(i))).collect()
}

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    engine
        .add_activity("a1".to_string(), track(), "Ride".to_string())
        .expect("store");
    engine
}

fn conn(dir: &TempDir) -> Connection {
    Connection::open(dir.path().join("routes.db")).expect("open directly")
}

fn seed_section(dir: &TempDir) {
    conn(dir)
        .execute(
            "INSERT INTO sections
                 (id, name, sport_type, section_type, distance_meters, visit_count,
                  created_at, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('s1', 'Section 1', 'Ride', 'auto', 1000.0, 0, datetime('now'), 0, 0, 0, 0)",
            [],
        )
        .expect("seed section");
}

fn avg_hr(dir: &TempDir) -> Option<f64> {
    conn(dir)
        .query_row(
            "SELECT avg_hr FROM section_activities WHERE section_id = 's1'",
            [],
            |row| row.get(0),
        )
        .expect("read avg_hr")
}

#[test]
fn a_manual_match_records_the_effort_over_its_own_slice() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    engine
        .store_activity_streams("a1", &[series("heartrate", heart_rates())])
        .expect("store streams");
    seed_section(&dir);

    engine
        .insert_section_activity("s1", "a1", &tracematch::Direction::Same, 10, 21, 1000.0)
        .expect("insert");

    // Indices 10..=20 inclusive, so 105 through 120: mean 115.
    let recorded = avg_hr(&dir).expect("the lap carries a heart rate");
    assert!(
        (recorded - 115.0).abs() < 0.001,
        "the mean is over the lap's own slice, not the activity: {recorded}"
    );
}

#[test]
fn a_lap_on_an_activity_with_no_strap_stays_empty() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    seed_section(&dir);

    engine
        .insert_section_activity("s1", "a1", &tracematch::Direction::Same, 10, 21, 1000.0)
        .expect("insert");

    assert_eq!(avg_hr(&dir), None, "no series is no heart rate, not nought");
}

/// A dropout must not read as a minute at nought beats.
#[test]
fn absent_samples_are_skipped_rather_than_counted() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    let mut data = heart_rates();
    for sample in data.iter_mut().take(20).skip(12) {
        *sample = None;
    }
    engine
        .store_activity_streams("a1", &[series("heartrate", data)])
        .expect("store streams");
    seed_section(&dir);

    engine
        .insert_section_activity("s1", "a1", &tracematch::Direction::Same, 10, 21, 1000.0)
        .expect("insert");

    // 110, 111 and 120 survive the dropout: mean 113.666…
    let recorded = avg_hr(&dir).expect("the present samples still answer");
    assert!(
        (recorded - (110.0 + 111.0 + 120.0) / 3.0).abs() < 0.001,
        "got {recorded}"
    );
}

/// The streams arrive after the apply for an activity synced without them, so
/// the lazy pass has to fill the column the insert could not.
#[test]
fn the_lazy_pass_fills_a_lap_whose_series_landed_later() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    seed_section(&dir);
    engine
        .insert_section_activity("s1", "a1", &tracematch::Direction::Same, 10, 21, 1000.0)
        .expect("insert");
    assert_eq!(avg_hr(&dir), None, "nothing to read yet");

    engine
        .store_activity_streams("a1", &[series("heartrate", heart_rates())])
        .expect("the series lands later");
    engine
        .recompute_activity_indicators()
        .expect("the lazy pass");

    let recorded = avg_hr(&dir).expect("the pass filled it");
    assert!((recorded - 115.0).abs() < 0.001, "got {recorded}");
}

/// A column already filled is never rewritten, and a row is a candidate while
/// either is still empty.
#[test]
fn the_lazy_pass_leaves_a_recorded_value_alone() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    seed_section(&dir);
    engine
        .insert_section_activity("s1", "a1", &tracematch::Direction::Same, 10, 21, 1000.0)
        .expect("insert");
    conn(&dir)
        .execute(
            "UPDATE section_activities SET avg_hr = 99.0 WHERE section_id = 's1'",
            [],
        )
        .expect("a value already recorded");

    engine
        .store_activity_streams("a1", &[series("heartrate", heart_rates())])
        .expect("store streams");
    engine
        .recompute_activity_indicators()
        .expect("the lazy pass");

    assert_eq!(avg_hr(&dir), Some(99.0));
}

#[test]
fn the_efficiency_trend_reads_the_laps_it_could_never_see() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .store_activity_streams("a1", &[series("heartrate", heart_rates())])
        .expect("store streams");
    seed_section(&dir);

    let before = engine.get_section_efficiency_trend("s1");
    assert!(before.is_none(), "nothing recorded yet");

    engine
        .insert_section_activity("s1", "a1", &tracematch::Direction::Same, 10, 21, 1000.0)
        .expect("insert");

    assert!(
        avg_hr(&dir).is_some(),
        "the trend's own filter is avg_hr IS NOT NULL, so this is what gated it"
    );
}
