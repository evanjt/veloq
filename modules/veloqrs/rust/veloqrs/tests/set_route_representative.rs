use rusqlite::params;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;

fn make_track(base_lat: f64, base_lng: f64, points: usize, jitter: f64) -> Vec<GpsPoint> {
    (0..points)
        .map(|i| {
            let frac = i as f64 / points as f64;
            GpsPoint::new(
                base_lat + frac * 0.01 + jitter * (i % 3) as f64 * 0.00001,
                base_lng + frac * 0.01 + jitter * (i % 5) as f64 * 0.00001,
            )
        })
        .collect()
}

fn setup_engine(activity_count: usize) -> (PersistentRouteEngine, TempDir) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let mut engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).unwrap();

    for i in 0..activity_count {
        let id = format!("activity_{}", i);
        let track = make_track(47.0, 7.0, 200, i as f64 * 0.5);
        engine
            .add_activity(id, track, "Ride".to_string())
            .unwrap();
    }

    (engine, dir)
}

#[test]
fn set_representative_updates_memory_and_db() {
    let (mut engine, dir) = setup_engine(5);

    let groups = engine.get_groups();
    assert!(!groups.is_empty(), "Should produce at least one route group");

    let group_id = groups[0].group_id.clone();
    let original_rep = groups[0].representative_id.clone();
    let new_rep = groups[0]
        .activity_ids
        .iter()
        .find(|id| **id != original_rep)
        .expect("Group should have non-representative members")
        .clone();

    engine
        .set_route_representative(&group_id, &new_rep)
        .expect("set_route_representative should succeed");

    // Verify in-memory update
    let groups = engine.get_groups();
    let group = groups
        .iter()
        .find(|g| g.group_id == group_id)
        .expect("Group should still exist");
    assert_eq!(
        group.representative_id, new_rep,
        "In-memory representative should be updated"
    );

    // Verify DB update
    let db_path = dir.path().join("test.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let db_rep: String = conn
        .query_row(
            "SELECT representative_id FROM route_groups WHERE id = ?",
            params![group_id],
            |row| row.get(0),
        )
        .expect("DB row should exist");
    assert_eq!(db_rep, new_rep, "DB representative should be updated");
}

#[test]
fn set_representative_rejects_nonmember_activity() {
    let (mut engine, _dir) = setup_engine(5);

    let groups = engine.get_groups();
    assert!(!groups.is_empty());
    let group_id = groups[0].group_id.clone();

    let result = engine.set_route_representative(&group_id, "nonexistent_activity");
    assert!(result.is_err(), "Should reject non-member activity");
    assert!(
        result
            .unwrap_err()
            .contains("is not a member of route"),
        "Error message should mention non-membership"
    );
}

#[test]
fn set_representative_rejects_nonexistent_group() {
    let (mut engine, _dir) = setup_engine(5);

    // Force groups to load
    let _ = engine.get_groups();

    let result = engine.set_route_representative("fake_group_id", "activity_0");
    assert!(result.is_err(), "Should reject non-existent group");
    assert!(
        result.unwrap_err().contains("not found"),
        "Error message should mention group not found"
    );
}
