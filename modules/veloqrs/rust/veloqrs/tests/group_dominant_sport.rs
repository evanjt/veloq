//! Scenario: one loop ridden four times and walked once. The group's scalar
//! sport was taken from whichever activity happened to represent the group, so
//! a route the athlete rides could be labelled `Walk` on the strength of a
//! single stroll, and the sort that numbers the routes used that label.
//!
//! Expected behaviour: the scalar is the sport most of the group's members
//! carry. The set is still the answer to "which sports have been here"; this is
//! only the one label anything left reading a scalar gets.
//!
//! Run: `cargo test --test group_dominant_sport -p veloqrs --features synthetic`

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

/// The odd one out is first in both fixtures, and both directions are covered,
/// so a scalar taken from whichever member represents the group is wrong about
/// at least one of them however that member is chosen.
#[test]
fn the_label_is_the_sport_most_of_the_group_carries() {
    for (members, expected) in [
        (
            [
                ("a", "Walk"),
                ("b", "Ride"),
                ("c", "Ride"),
                ("d", "Ride"),
                ("e", "Ride"),
            ],
            "Ride",
        ),
        (
            [
                ("a", "Ride"),
                ("b", "Walk"),
                ("c", "Walk"),
                ("d", "Walk"),
                ("e", "Walk"),
            ],
            "Walk",
        ),
    ] {
        let (mut engine, _dir) = engine_over(&members);
        assert_eq!(
            only_group_sport(&mut engine),
            expected,
            "four of one sport and one of another is a route of the four"
        );
    }
}

#[test]
fn a_tie_settles_the_same_way_every_run() {
    let (mut engine, _dir) = engine_over(&[("a", "Walk"), ("b", "Ride")]);

    assert_eq!(
        only_group_sport(&mut engine),
        "Ride",
        "one each settles alphabetically, so two runs number the routes the same way"
    );
}
