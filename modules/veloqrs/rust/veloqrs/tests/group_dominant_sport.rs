//! A route's members retain their sports, while its retired scalar stays empty.
//!
//! Run: `cargo test --test app_synthetic -p veloqrs --features synthetic -- group_dominant_sport::`

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn track() -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0004,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

/// One loop covered by every `(id, sport)` given, all with metadata written.
fn engine_over(members: &[(&str, &str)]) -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("engine");

    for (id, sport) in members {
        engine
            .add_activity((*id).to_string(), track(), (*sport).to_string())
            .expect("add activity");
        engine
            .update_activity_metadata(id, Some(1_700_000_000), None, None, None)
            .expect("metadata lands on ingest");
    }
    (engine, dir)
}

fn only_group_sport(engine: &mut PersistentEngine) -> String {
    let groups = engine.get_groups();
    assert_eq!(
        groups.len(),
        1,
        "one loop covered several times is one group"
    );
    groups[0].sport_type.clone()
}

#[test]
fn test_route_scalar_empty_for_mixed_sports() {
    for members in [
        [
            ("a", "Walk"),
            ("b", "Ride"),
            ("c", "Ride"),
            ("d", "Ride"),
            ("e", "Ride"),
        ],
        [
            ("a", "Ride"),
            ("b", "Walk"),
            ("c", "Walk"),
            ("d", "Walk"),
            ("e", "Walk"),
        ],
    ] {
        let (mut engine, _dir) = engine_over(&members);
        assert_eq!(only_group_sport(&mut engine), "");
    }
}

#[test]
fn test_route_scalar_empty_for_tied_sports() {
    let (mut engine, _dir) = engine_over(&[("a", "Walk"), ("b", "Ride")]);
    assert_eq!(only_group_sport(&mut engine), "");
}
