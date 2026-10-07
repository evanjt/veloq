#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn coords(base: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(base + f64::from(i) * 0.001, 7.3))
        .collect()
}

#[test]
fn test_external_group_reload_restores_route_registry() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();
    let mut foreground = PersistentEngine::new(path).unwrap();
    foreground.load().unwrap();
    let mut handler = PersistentEngine::new(path).unwrap();
    handler
        .add_activity("a1".into(), coords(46.2), "Ride".into())
        .unwrap();
    handler.get_groups();
    handler
        .add_activity("a2".into(), coords(48.2), "Ride".into())
        .unwrap();
    handler.get_groups();
    handler.note_external_write().unwrap();

    assert!(foreground.take_external_writes());
    assert_eq!(
        foreground.route_identity_fingerprint(),
        handler.route_identity_fingerprint(),
        "the foreground must adopt the registry committed with the groups"
    );
}
