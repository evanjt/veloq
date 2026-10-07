//! Scenario: intervals.icu's fitness endpoint carries each activity's distance,
//! and the import writes it onto the `activities` row with one UPDATE. On the
//! S22's library, 2026-09-18, `distance_meters` was NULL on all 316 rows while
//! `activity_metrics.distance` held the figure for the same ids: the metrics
//! land before the activity rows do, the UPDATE matches nothing, and its result
//! is discarded, so nothing says it happened. `duration_secs` was set on all
//! 316 by the startup backfill beside it, which is why only one of the two
//! columns the statement writes was missing.
//!
//! Expected behaviour: the distance lands whichever order the two arrive in,
//! and an import that updates no activity row says so.
//!
//! Run: `cargo test --test persistence -p veloqrs -- activity_distance_from_metrics::`

use rusqlite::Connection;
use std::path::PathBuf;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::{FfiActivityMetrics, PersistentEngine};

const DATE: f64 = 1_700_000_000.0;

struct Setup {
    engine: PersistentEngine,
    path: PathBuf,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("tempdir");
    let path = tmp.path().join("routes.db");
    let engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("engine");
    Setup {
        engine,
        path,
        _tmp: tmp,
    }
}

fn track() -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0004,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

fn metrics(activity_id: &str, distance: f64) -> FfiActivityMetrics {
    FfiActivityMetrics {
        activity_id: activity_id.to_string(),
        name: "Morning Ride".to_string(),
        date: DATE,
        distance,
        moving_time: 3_600,
        elapsed_time: 3_700,
        elevation_gain: 250.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

fn stored_distance(path: &PathBuf, activity_id: &str) -> Option<f64> {
    Connection::open(path)
        .expect("raw open")
        .query_row(
            "SELECT distance_meters FROM activities WHERE id = ?1",
            rusqlite::params![activity_id],
            |r| r.get(0),
        )
        .expect("the activity row exists")
}

#[test]
fn an_import_after_the_activity_writes_its_distance() {
    let mut s = setup();
    s.engine
        .add_activity("a1".to_string(), track(), "Ride".to_string())
        .expect("add activity");

    s.engine
        .set_activity_metrics_extended(vec![metrics("a1", 42_000.0)])
        .expect("import metrics");

    assert_eq!(stored_distance(&s.path, "a1"), Some(42_000.0));
}

#[test]
fn an_import_before_the_activity_still_leaves_the_distance_on_it() {
    // The order a real sync uses: the fitness endpoint answers first, and the
    // activity rows arrive with their tracks afterwards. The UPDATE in the
    // import matches nothing, so the open after it has to carry the figure
    // across, the way `duration_secs` already is.
    let mut s = setup();
    s.engine
        .set_activity_metrics_extended(vec![metrics("a1", 42_000.0)])
        .expect("import metrics");
    s.engine
        .add_activity("a1".to_string(), track(), "Ride".to_string())
        .expect("add activity");

    s.engine.load().expect("reload");

    assert_eq!(
        stored_distance(&s.path, "a1"),
        Some(42_000.0),
        "the open backfills a distance the import could not place"
    );
}

#[test]
fn a_distance_already_on_the_activity_is_not_overwritten_by_the_backfill() {
    let mut s = setup();
    s.engine
        .add_activity("a1".to_string(), track(), "Ride".to_string())
        .expect("add activity");
    s.engine
        .update_activity_metadata("a1", Some(DATE as i64), None, Some(41_000.0), Some(3_600))
        .expect("metadata");
    s.engine
        .set_activity_metrics_extended(vec![metrics("a1", 42_000.0)])
        .expect("import metrics");

    // The import's own UPDATE is the authority while the row is there; the
    // backfill only fills a hole.
    let before = stored_distance(&s.path, "a1");
    s.engine.load().expect("reload");

    assert_eq!(stored_distance(&s.path, "a1"), before);
}
