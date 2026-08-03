//! Contract suite for the D4 storage layer: section history events, versioned
//! geometry, and pins. The tables key on the durable real section id with no
//! foreign key to the wipe-managed `sections` table, versions decode
//! independently (no delta chains), and retention keeps the birth geometry,
//! milestones, the pinned version, and the newest three. The D5 emitter is
//! the writer; these contracts pin the storage semantics it will lean on.

mod lifecycle_support;

use lifecycle_support::fresh_engine;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;

const SID: &str = "s_1700000000000__ab12cd34";

/// A short 6-decimal line, distinct per seed so versions differ.
fn poly(seed: u32) -> Vec<GpsPoint> {
    let dec = |v: f64| -> f64 { format!("{v:.6}").parse().unwrap() };
    (0..40)
        .map(|i| GpsPoint {
            latitude: dec(46.2 + f64::from(seed) * 0.001 + f64::from(i) * 0.000_09),
            longitude: dec(7.36 + f64::from(i) * 0.000_11),
            elevation: Some(500.0 + f64::from(i)),
        })
        .collect()
}

fn versions_of(engine: &PersistentRouteEngine, sid: &str) -> Vec<i64> {
    engine
        .section_geometry_versions(sid)
        .iter()
        .map(|v| v.version)
        .collect()
}

#[test]
fn geometry_versions_increment_and_round_trip_exactly() {
    let (mut engine, _dir) = fresh_engine();
    let first = poly(0);
    let second = poly(1);
    assert_eq!(engine.record_section_geometry(SID, &first, false).unwrap(), 1);
    assert_eq!(
        engine.record_section_geometry(SID, &second, false).unwrap(),
        2
    );
    assert_eq!(engine.section_geometry_polyline(SID, 1).unwrap(), first);
    assert_eq!(engine.section_geometry_polyline(SID, 2).unwrap(), second);
    assert!(engine.section_geometry_polyline(SID, 3).is_none());
    assert!(engine.section_geometry_polyline("s_other", 1).is_none());
}

/// Scenario: eight versions land; version 2 is a milestone and version 4 is
/// pinned along the way.
/// Expected behaviour: survivors are exactly the birth geometry, the
/// milestone, the pinned version, and the newest three.
#[test]
fn retention_keeps_birth_milestones_pin_and_newest_three() {
    let (mut engine, _dir) = fresh_engine();
    for seed in 1..=4 {
        engine
            .record_section_geometry(SID, &poly(seed), seed == 2)
            .unwrap();
    }
    assert!(engine.pin_section_geometry(SID, 4).unwrap());
    for seed in 5..=8 {
        engine
            .record_section_geometry(SID, &poly(seed), false)
            .unwrap();
    }
    assert_eq!(versions_of(&engine, SID), vec![1, 2, 4, 6, 7, 8]);
    let kept = engine.section_geometry_versions(SID);
    assert!(kept.iter().find(|v| v.version == 2).unwrap().milestone);
    assert_eq!(engine.pinned_section_version(SID), Some(4));
    // The pinned polyline is still decodable after the churn around it.
    assert_eq!(engine.section_geometry_polyline(SID, 4).unwrap(), poly(4));
}

/// Scenario: the pin is lifted and one more version lands.
/// Expected behaviour: the formerly pinned version becomes prunable like any
/// other non-milestone.
#[test]
fn unpin_releases_the_version_to_retention() {
    let (mut engine, _dir) = fresh_engine();
    for seed in 1..=4 {
        engine
            .record_section_geometry(SID, &poly(seed), false)
            .unwrap();
    }
    assert!(engine.pin_section_geometry(SID, 3).unwrap());
    engine.record_section_geometry(SID, &poly(5), false).unwrap();
    assert_eq!(versions_of(&engine, SID), vec![1, 3, 4, 5]);

    engine.unpin_section_geometry(SID).unwrap();
    assert_eq!(engine.pinned_section_version(SID), None);
    engine.record_section_geometry(SID, &poly(6), false).unwrap();
    assert_eq!(versions_of(&engine, SID), vec![1, 4, 5, 6]);
}

/// A pin must always be restorable: pinning a version that never existed or
/// was already pruned is refused, not recorded.
#[test]
fn pin_refuses_a_missing_version() {
    let (mut engine, _dir) = fresh_engine();
    engine.record_section_geometry(SID, &poly(1), false).unwrap();
    assert!(!engine.pin_section_geometry(SID, 7).unwrap());
    assert_eq!(engine.pinned_section_version(SID), None);

    for seed in 2..=5 {
        engine
            .record_section_geometry(SID, &poly(seed), false)
            .unwrap();
    }
    // Version 2 was pruned by the newest-three window.
    assert_eq!(versions_of(&engine, SID), vec![1, 3, 4, 5]);
    assert!(!engine.pin_section_geometry(SID, 2).unwrap());
    // Re-pinning an existing version moves the one pin, never stacks a second.
    assert!(engine.pin_section_geometry(SID, 3).unwrap());
    assert!(engine.pin_section_geometry(SID, 4).unwrap());
    assert_eq!(engine.pinned_section_version(SID), Some(4));
}

#[test]
fn history_events_append_in_order_and_read_back() {
    let (mut engine, _dir) = fresh_engine();
    let v = engine.record_section_geometry(SID, &poly(1), false).unwrap();
    engine
        .append_section_history(SID, "recut", Some(r#"{"shift_m":44}"#), Some(v))
        .unwrap();
    engine
        .append_section_history(SID, "dissolve", None, None)
        .unwrap();
    engine
        .append_section_history("s_unrelated", "recut", None, None)
        .unwrap();

    let events = engine.section_history(SID);
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].kind, "recut");
    assert_eq!(events[0].details.as_deref(), Some(r#"{"shift_m":44}"#));
    assert_eq!(events[0].geometry_version, Some(v));
    assert_eq!(events[1].kind, "dissolve");
    assert_eq!(events[1].geometry_version, None);
    assert!(events[0].id < events[1].id);
    assert_eq!(engine.section_history("s_never").len(), 0);
}

/// Scenario: the app restarts.
/// Expected behaviour: events, versions, and the pin read back from the DB
/// alone — the layer holds no in-memory state to lose.
#[test]
fn history_geometry_and_pin_survive_restart() {
    let (mut engine, dir) = fresh_engine();
    engine.record_section_geometry(SID, &poly(1), false).unwrap();
    engine.record_section_geometry(SID, &poly(2), true).unwrap();
    assert!(engine.pin_section_geometry(SID, 1).unwrap());
    engine
        .append_section_history(SID, "recut", None, Some(2))
        .unwrap();
    let path = dir.path().join("lifecycle.db");
    drop(engine);

    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    assert_eq!(versions_of(&engine, SID), vec![1, 2]);
    assert_eq!(engine.section_geometry_polyline(SID, 1).unwrap(), poly(1));
    assert_eq!(engine.pinned_section_version(SID), Some(1));
    let events = engine.section_history(SID);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "recut");
}
