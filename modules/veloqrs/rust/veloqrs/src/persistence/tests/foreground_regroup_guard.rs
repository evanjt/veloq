//! Scenario: the regroup a read triggers runs over a signature pool that is
//! mostly unreadable, or whose table cannot be read at all.
//!
//! Expected behaviour: the catalogue and the route names stay as they were and
//! the regroup is no longer owed, the same refusal the background worker makes.

use rusqlite::params;
use tempfile::TempDir;
use tracematch::GpsPoint;

use super::*;

const UNDECODABLE: &[u8] = &[0x7f, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];

fn ride() -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.3))
        .collect()
}

/// `count` identical rides, grouped into one named route, then marked owed.
fn named_route(count: usize) -> (PersistentEngine, TempDir, String) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("guard.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    for i in 0..count {
        engine
            .add_activity(format!("a{i:03}"), ride(), "Ride".into())
            .unwrap();
    }
    let groups = engine.get_groups().to_vec();
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].activity_ids.len(), count);
    let route_id = groups[0].group_id.clone();
    engine.set_route_name(&route_id, Some("Lake loop")).unwrap();
    engine.set_groups_dirty(true);
    (engine, dir, route_id)
}

fn assert_untouched(engine: &mut PersistentEngine, route_id: &str, count: usize) {
    let groups = engine.get_groups().to_vec();
    assert_eq!(groups.len(), 1, "the route dissolved");
    assert_eq!(groups[0].group_id, route_id);
    assert_eq!(groups[0].activity_ids.len(), count);
    assert_eq!(
        engine
            .get_all_route_names()
            .get(route_id)
            .map(String::as_str),
        Some("Lake loop"),
        "the route's name was deleted"
    );
    assert!(!engine.groups_are_dirty(), "the refused regroup stays owed");
}

#[test]
fn test_regroup_over_a_mostly_unreadable_pool_keeps_routes_and_names() {
    let (mut engine, _dir, route_id) = named_route(100);
    for i in 0..12 {
        engine
            .db
            .execute(
                "UPDATE signatures SET points = ? WHERE activity_id = ?",
                params![UNDECODABLE, format!("a{i:03}")],
            )
            .unwrap();
    }
    assert_untouched(&mut engine, &route_id, 100);
}

#[test]
fn test_regroup_over_an_unreadable_signature_table_keeps_routes_and_names() {
    let (mut engine, _dir, route_id) = named_route(20);
    engine.db.execute_batch("DROP TABLE signatures").unwrap();
    assert_untouched(&mut engine, &route_id, 20);
}
