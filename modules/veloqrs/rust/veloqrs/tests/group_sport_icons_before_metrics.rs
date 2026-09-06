//! Scenario: the app has just opened. Activities are ingested with their sport
//! and their metadata, and metrics load a moment later. A route list and a
//! section list sit on the same screen.
//!
//! Expected behaviour: a route group reports the sports that have traversed it
//! from the same authority a section does, `activity_metadata`, so the two
//! lists cannot disagree about a library they are reading at the same instant.
//!
//! Run: `cargo test --test group_sport_icons_before_metrics -p veloqrs --features synthetic`

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn track(offset: f64) -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0004,
            longitude: 7.0 + offset,
            elevation: None,
        })
        .collect()
}

/// Two activities over one loop, one ridden and one walked, both with their
/// metadata written and neither with metrics yet.
fn engine_without_metrics() -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("engine");

    for (id, sport) in [("ridden", "Ride"), ("walked", "Walk")] {
        engine
            .add_activity(id.to_string(), track(0.0), sport.to_string())
            .expect("add activity");
        engine
            .update_activity_metadata(id, Some(1_700_000_000), None, None, None)
            .expect("metadata lands on ingest");
    }
    (engine, dir)
}

#[test]
fn a_group_reports_its_sports_before_metrics_have_loaded() {
    let (mut engine, _dir) = engine_without_metrics();

    assert_eq!(
        engine.get_groups().len(),
        1,
        "one loop covered twice groups sport-blind"
    );
    let summaries = engine.get_group_summaries();
    let group = summaries
        .first()
        .expect("one loop covered twice is one group");

    let mut sports = group.sport_types.clone();
    sports.sort();
    assert_eq!(
        sports,
        vec!["Ride".to_string(), "Walk".to_string()],
        "the sports are known from ingest, so the icons must not wait for metrics"
    );
}
