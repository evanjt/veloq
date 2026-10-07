//! The activity id set, membership and counts, read while a writer holds the engine.

use super::ActivityManager;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};
use crate::with_persistent_engine;
use tracematch::GpsPoint;

fn add(id: &str) {
    with_persistent_engine(|e| {
        let track: Vec<GpsPoint> = (0..8)
            .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
            .collect();
        e.add_activity(id.to_string(), track, "Ride".into())
            .expect("add activity");
    })
    .expect("engine");
}

#[test]
fn test_get_ids_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("activity_ids_under_a_writer.db");
    add("a1");
    let ids = read_while_writer_holds(|| ActivityManager::new().get_ids().expect("ids"));
    assert_eq!(ids, vec!["a1".to_string()]);
}

#[test]
fn test_has_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("activity_has_under_a_writer.db");
    add("a1");
    let (present, absent) = read_while_writer_holds(|| {
        let activities = ActivityManager::new();
        (
            activities.has("a1".into()).expect("has"),
            activities.has("nope".into()).expect("has"),
        )
    });
    assert!(present);
    assert!(!absent);
}

#[test]
fn test_get_count_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("activity_count_under_a_writer.db");
    add("a1");
    add("a2");
    let count = read_while_writer_holds(|| ActivityManager::new().get_count().expect("count"));
    assert_eq!(count, 2);
}

/// Scenario: activities are added, then one is removed.
///
/// Expected behaviour: the pooled answers equal the engine's own after each
/// step, and an empty library reads empty rather than erroring.
#[test]
fn test_activity_set_pooled_matches_locked() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("activity_set_parity.db");
    let activities = ActivityManager::new();
    let locked = || {
        with_persistent_engine(|e| {
            let mut ids = e.get_activity_ids();
            ids.sort();
            (ids, e.activity_count() as u32, e.has_activity("a1"))
        })
        .expect("engine")
    };
    let pooled = || {
        let mut ids = activities.get_ids().expect("ids");
        ids.sort();
        (
            ids,
            activities.get_count().expect("count"),
            activities.has("a1".into()).expect("has"),
        )
    };

    assert_eq!(pooled(), (Vec::new(), 0, false));
    assert_eq!(pooled(), locked());

    add("a1");
    add("a2");
    assert_eq!(pooled(), locked());
    assert_eq!(pooled().1, 2);

    with_persistent_engine(|e| e.remove_activity("a1").expect("remove")).expect("engine");
    assert_eq!(pooled(), locked());
    assert_eq!(pooled(), (vec!["a2".to_string()], 1, false));
}
