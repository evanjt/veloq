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
//! Run: `cargo test --test match_strictness_invalidates -p veloqrs`

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

#[test]
fn the_values_survive_a_reload() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    {
        let mut engine = engine(&dir);
        engine.set_match_strictness(65.0, 180.0);
    }

    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("reopen");
    engine.load().expect("load");
    let (pct, endpoint) = engine.match_strictness();
    assert_eq!((pct, endpoint), (65.0, 180.0));
}
