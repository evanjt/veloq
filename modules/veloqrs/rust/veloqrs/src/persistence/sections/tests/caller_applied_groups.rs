use super::*;
use crate::test_globals::serial_global_state;

fn coords(base: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(base + f64::from(i) * 0.001, 7.3))
        .collect()
}

/// A detect the caller blocks on and applies itself, the way a blocking
/// caller with an engine of its own does.
///
/// A store schedules a regroup on a thread of its own, and a run that starts
/// while it is in flight leaves the grouping to it. That worker swaps into the
/// shared slot and not into this engine, so the run starts once it has ended.
fn detect_and_apply(engine: &mut PersistentEngine) {
    crate::test_globals::wait_for_regroup_workers();
    let (main, update) = engine.detect_sections_background().recv_with_cache();
    let (sections, processed) = main.expect("the detect ran");
    engine
        .apply_sections_with_cache(sections, update)
        .expect("apply");
    engine
        .save_processed_activity_ids(&processed)
        .expect("processed ids");
}

fn holds(groups: &[RouteGroup], member: &str) -> bool {
    groups
        .iter()
        .any(|group| group.activity_ids.iter().any(|id| id == member))
}

/// Scenario: an engine outside the shared slot runs two detects, each after a
/// new ride, and applies each on the calling thread. Each run regroups on its
/// own connection and commits there.
///
/// Expected behaviour: the apply adopts the groups the run committed, so the
/// second run regroups from the first one's catalogue and its write commits,
/// rather than being refused as stale and leaving the second ride in no route.
#[test]
fn a_caller_applied_run_leaves_its_engine_on_the_groups_it_committed() {
    let _serial = serial_global_state();
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("caller-applied.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    engine
        .add_activity("m".into(), coords(40.0), "Ride".into())
        .unwrap();
    detect_and_apply(&mut engine);
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        engine.group_generation,
        read_group_generation(&conn).unwrap(),
        "the first run's commit was not adopted"
    );
    assert!(holds(&engine.groups, "m"));

    engine
        .add_activity("t".into(), coords(44.0), "Ride".into())
        .unwrap();
    detect_and_apply(&mut engine);
    assert!(
        holds(&load_groups_from_db(&conn), "t"),
        "the second run's regroup was refused as stale"
    );
    assert_eq!(
        engine.group_generation,
        read_group_generation(&conn).unwrap()
    );
    assert!(holds(&engine.groups, "t"));
}
