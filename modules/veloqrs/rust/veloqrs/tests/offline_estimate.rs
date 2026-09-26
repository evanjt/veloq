//! Scenario: the athlete is about to make a date range available offline and
//! has to be told what it costs before they tap start, on a connection that
//! may be metered.
//!
//! Expected behaviour: the estimate is built from the moving seconds already
//! stored for the range, not from an activity count. Across the sample `I153`
//! measured, per-activity cost spans fifty-fold while bytes per moving second
//! holds to about a third, so a count-based figure is the one that misleads.

use tempfile::TempDir;
use veloqrs::net::offline_prefetch::estimate_range;
use veloqrs::{ActivityMetrics, PersistentEngine};

fn engine() -> (TempDir, PersistentEngine) {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");
    (tmp, engine)
}

/// One metrics row, which is all the estimate reads.
fn metrics(id: &str, date: i64, moving_time: u32) -> ActivityMetrics {
    ActivityMetrics {
        activity_id: id.to_string(),
        name: id.to_string(),
        date,
        distance: 0.0,
        moving_time,
        elapsed_time: moving_time,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

#[test]
fn an_empty_range_costs_only_the_per_athlete_constants() {
    let (_tmp, engine) = engine();

    let estimate = engine.estimate_offline_range(0, 1_000).expect("estimate");

    assert_eq!(estimate.activities, 0);
    assert_eq!(estimate.moving_seconds, 0);
    assert_eq!(estimate.requests, 47);
    assert_eq!(estimate.bytes, 600_000);
}

#[test]
fn every_activity_in_the_range_costs_three_requests() {
    let (_tmp, mut engine) = engine();
    engine
        .set_activity_metrics(vec![metrics("a", 100, 60), metrics("b", 200, 60)])
        .expect("store");

    let estimate = engine.estimate_offline_range(0, 1_000).expect("estimate");

    assert_eq!(estimate.activities, 2);
    assert_eq!(estimate.requests, 47 + 6);
}

#[test]
fn the_bytes_follow_the_moving_seconds_rather_than_the_count() {
    let short = estimate_range(1, 60);
    let long = estimate_range(1, 6_000);
    let base = estimate_range(1, 0);

    // Same activity count, so the request figure cannot tell them apart.
    assert_eq!(short.requests, long.requests);
    // A hundred times the moving seconds is a hundred times the part of the
    // figure that moves. The constants are the rest of it either way.
    assert_eq!(
        long.bytes - base.bytes,
        (short.bytes - base.bytes) * 100,
        "{} vs {}",
        long.bytes,
        short.bytes
    );
}

#[test]
fn a_range_outside_the_stored_window_counts_nothing() {
    let (_tmp, mut engine) = engine();
    engine
        .set_activity_metrics(vec![metrics("a", 5_000, 3_600)])
        .expect("store");

    let estimate = engine.estimate_offline_range(0, 1_000).expect("estimate");

    assert_eq!(estimate.activities, 0);
    assert_eq!(estimate.moving_seconds, 0);
}

#[test]
fn the_range_bounds_are_inclusive() {
    let (_tmp, mut engine) = engine();
    engine
        .set_activity_metrics(vec![metrics("a", 100, 60), metrics("b", 200, 60)])
        .expect("store");

    let estimate = engine.estimate_offline_range(100, 200).expect("estimate");

    assert_eq!(estimate.activities, 2);
}

/// `I153`'s own figure for a year of the measured library, reproduced from the
/// components rather than from its rounded total: 318 activities and about 520
/// hours moving came to 1,001 requests and about 115 MB.
#[test]
fn a_year_of_the_measured_library_reproduces_the_figure() {
    let estimate = estimate_range(318, 520 * 3_600);

    assert_eq!(estimate.requests, 1_001);
    let megabytes = estimate.bytes / 1_000_000;
    assert!((110..=120).contains(&megabytes), "{megabytes} MB");
}
