//! Changing how tightly rides group into routes has to move the groups.
//!
//! Grouping is recomputed only when `groups_dirty` is set, and that flag was
//! set by the activity ingestion paths alone. So an athlete who tightened
//! grouping saw the same groups until something else imported an activity.
//! Nothing called the setter from a real user path, which is why nobody hit
//! it, and the route-grouping preview's Keep button is exactly this call.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test app -p veloqrs -- match_strictness_invalidates::`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

/// A straight line, offset laterally so two of them agree over most of their
/// length without being the same ride.
fn line(offset: f64) -> Vec<GpsPoint> {
    (0..80)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0 + offset,
            elevation: None,
        })
        .collect()
}

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    for (id, offset) in [("a1", 0.0), ("a2", 0.0004), ("a3", 0.02)] {
        engine
            .add_activity(id.to_string(), line(offset), "Ride".to_string())
            .expect("store");
    }
    engine
}

/// The grouping the engine would answer with right now.
fn grouping(engine: &mut PersistentEngine) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = engine
        .get_groups()
        .iter()
        .map(|g| {
            let mut ids = g.activity_ids.clone();
            ids.sort();
            ids
        })
        .collect();
    out.sort();
    out
}

#[test]
fn tightening_the_strictness_regroups_without_an_intervening_import() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);

    engine.set_match_strictness(50.0, 300.0);
    let relaxed = grouping(&mut engine);

    engine.set_match_strictness(90.0, 5.0);
    let strict = grouping(&mut engine);

    assert_ne!(
        relaxed, strict,
        "the groups have to move when the rule that made them does: {relaxed:?}"
    );
}

#[test]
fn setting_the_value_it_already_has_recomputes_nothing() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);

    engine.set_match_strictness(55.0, 250.0);
    let _ = grouping(&mut engine);
    assert!(!engine.groups_are_dirty(), "the recompute settled the flag");

    engine.set_match_strictness(55.0, 250.0);
    assert!(
        !engine.groups_are_dirty(),
        "an unchanged rule is not a reason to regroup a whole library"
    );
}

#[test]
fn a_changed_strictness_marks_the_grouping_for_recompute() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    let _ = grouping(&mut engine);
    assert!(!engine.groups_are_dirty());

    engine.set_match_strictness(65.0, 180.0);

    assert!(
        engine.groups_are_dirty(),
        "the flag is what the recompute waits on"
    );
}

fn together(grouping: &[Vec<String>], a: &str, b: &str) -> bool {
    grouping
        .iter()
        .any(|ids| ids.iter().any(|i| i == a) && ids.iter().any(|i| i == b))
}

#[test]
fn tightening_with_an_unrelated_activity_pending_still_splits_existing_groups() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);

    engine.set_match_strictness(50.0, 300.0);
    assert!(together(&grouping(&mut engine), "a1", "a2"));

    engine
        .add_activity("a4".to_string(), line(0.05), "Ride".to_string())
        .expect("store");
    engine.set_match_strictness(90.0, 5.0);

    let strict = grouping(&mut engine);
    assert!(
        !together(&strict, "a1", "a2"),
        "a pending activity must not limit the regroup to itself: {strict:?}"
    );
}

#[test]
fn a_strictness_change_survives_a_restart_before_any_regroup() {
    let dir = TempDir::new().expect("tempdir");
    {
        let mut engine = engine(&dir);
        engine.set_match_strictness(50.0, 300.0);
        assert!(together(&grouping(&mut engine), "a1", "a2"));
        engine.set_match_strictness(90.0, 5.0);
    }

    let path = dir.path().join("routes.db");
    let mut reopened = PersistentEngine::new(path.to_str().expect("utf-8")).expect("reopen");
    reopened.load().expect("load");

    let strict = grouping(&mut reopened);
    assert!(
        !together(&strict, "a1", "a2"),
        "the groups made under the old rule must not outlive it: {strict:?}"
    );
}

#[test]
fn a_restart_under_an_unchanged_rule_leaves_the_grouping_settled() {
    let dir = TempDir::new().expect("tempdir");
    {
        let mut engine = engine(&dir);
        engine.set_match_strictness(50.0, 300.0);
        let _ = grouping(&mut engine);
    }

    let path = dir.path().join("routes.db");
    let mut reopened = PersistentEngine::new(path.to_str().expect("utf-8")).expect("reopen");
    reopened.load().expect("load");

    assert!(
        !reopened.groups_are_dirty(),
        "an unchanged rule is not a reason to regroup a library at launch"
    );
}
