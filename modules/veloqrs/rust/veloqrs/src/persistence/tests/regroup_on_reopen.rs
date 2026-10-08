use rusqlite::params;
use tempfile::TempDir;
use tracematch::GpsPoint;

use super::PersistentEngine;

fn track(latitude: f64) -> Vec<GpsPoint> {
    (0..30)
        .map(|index| GpsPoint::new(latitude + f64::from(index) * 0.0001, 7.0))
        .collect()
}

fn open_loaded(path: &str) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path).unwrap();
    engine.load().unwrap();
    engine
}

fn insert_corrupt_signature(engine: &PersistentEngine, id: &str) {
    engine
        .db
        .execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?1, 'Ride', 0, 0, 0, 0)",
            params![id],
        )
        .unwrap();
    engine
        .db
        .execute(
            "INSERT INTO signatures (activity_id, points, start_point_lat, start_point_lng,
                                     end_point_lat, end_point_lng, total_distance, point_count)
             VALUES (?1, x'ff', 0, 0, 0, 0, 0, 2)",
            params![id],
        )
        .unwrap();
}

#[test]
fn test_reopen_marks_stored_ungrouped_activity_dirty() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();

    {
        let mut engine = open_loaded(path);
        engine
            .add_activity("first".into(), track(46.0), "Ride".into())
            .unwrap();
        assert_eq!(engine.get_groups().len(), 1);
        engine
            .add_activity("later".into(), track(46.0), "Ride".into())
            .unwrap();
        assert!(engine.groups_are_dirty());
        assert!(
            engine
                .groups
                .iter()
                .all(|group| !group.activity_ids.contains(&"later".to_string()))
        );
        assert_eq!(
            engine
                .db
                .query_row("SELECT COUNT(*) FROM signatures", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    let mut engine = open_loaded(path);
    assert!(engine.groups_are_dirty());
    assert!(
        engine
            .get_groups()
            .iter()
            .any(|group| group.activity_ids.iter().any(|id| id == "later"))
    );
}

#[test]
fn test_reopen_keeps_regrouped_library_clean() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();

    {
        let mut engine = open_loaded(path);
        engine
            .add_activity("first".into(), track(46.0), "Ride".into())
            .unwrap();
        engine.get_groups();
        assert!(!engine.groups_are_dirty());
    }

    assert!(!open_loaded(path).groups_are_dirty());
}

#[test]
fn test_reopen_without_signatures_keeps_groups_clean() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();

    drop(open_loaded(path));
    assert!(!open_loaded(path).groups_are_dirty());

    {
        let engine = open_loaded(path);
        assert!(!engine.groups_are_dirty());
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES ('trackless', 'Ride', 0, 0, 0, 0)",
                [],
            )
            .unwrap();
    }

    assert!(!open_loaded(path).groups_are_dirty());
}

#[test]
fn test_reopen_ignores_ungroupable_signature() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();

    {
        let mut engine = open_loaded(path);
        engine
            .add_activity("first".into(), track(46.0), "Ride".into())
            .unwrap();
        engine.get_groups();
        insert_corrupt_signature(&engine, "garbled");
    }

    assert!(!open_loaded(path).groups_are_dirty());
}

#[test]
fn test_reopen_leaves_rejected_signature_pool_clean() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();

    {
        let mut engine = open_loaded(path);
        engine
            .add_activity("first".into(), track(46.0), "Ride".into())
            .unwrap();
        engine.get_groups();
        engine
            .add_activity("later".into(), track(46.0), "Ride".into())
            .unwrap();
        for index in 0..8 {
            insert_corrupt_signature(&engine, &format!("garbled-{index}"));
        }
    }

    assert!(!open_loaded(path).groups_are_dirty());
}
