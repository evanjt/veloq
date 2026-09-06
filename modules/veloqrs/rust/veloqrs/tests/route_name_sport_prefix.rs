//! Scenario: a route group is minted, then the app is reopened.
//! Expected behaviour: the minted name carries no sport word, and the number
//! it was given survives the reload. `save_groups` used to mint
//! "Walk Route 3" while the loader's migration stripped the prefix and
//! renumbered, so the name depended on whether the app had been reopened.

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

const SPORTS: [&str; 7] = [
    "Ride",
    "Run",
    "Hike",
    "Walk",
    "Swim",
    "VirtualRide",
    "VirtualRun",
];

fn make_track(base_lat: f64, base_lng: f64, jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| {
            let frac = i as f64 / 200.0;
            GpsPoint::new(
                base_lat + frac * 0.01 + jitter * (i % 3) as f64 * 0.00001,
                base_lng + frac * 0.01 + jitter * (i % 5) as f64 * 0.00001,
            )
        })
        .collect()
}

/// Two well separated route groups, one walked and one ridden.
fn seed(engine: &mut PersistentEngine) {
    for i in 0..3 {
        engine
            .add_activity(
                format!("walk_{i}"),
                make_track(47.0, 7.0, i as f64 * 0.5),
                "Walk".to_string(),
            )
            .unwrap();
        engine
            .add_activity(
                format!("ride_{i}"),
                make_track(48.5, 9.5, i as f64 * 0.5),
                "Ride".to_string(),
            )
            .unwrap();
    }
}

fn names(engine: &PersistentEngine) -> Vec<(String, String)> {
    let mut rows: Vec<(String, String)> = engine.get_all_route_names().into_iter().collect();
    rows.sort();
    rows
}

#[test]
fn minted_route_names_carry_no_sport_and_survive_a_reload() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");

    let minted = {
        let mut engine = PersistentEngine::new(db_path.to_str().unwrap()).unwrap();
        seed(&mut engine);
        assert!(engine.get_groups().len() >= 2, "expected two route groups");
        names(&engine)
    };

    assert!(!minted.is_empty(), "no names were minted");
    for (id, name) in &minted {
        for sport in SPORTS {
            assert!(
                !name.starts_with(&format!("{sport} ")),
                "{id} was minted as {name:?}, which carries a sport word"
            );
        }
    }

    let reloaded = {
        let mut engine = PersistentEngine::new(db_path.to_str().unwrap()).unwrap();
        engine.get_groups();
        names(&engine)
    };

    assert_eq!(
        minted, reloaded,
        "the reload renamed groups the mint had already named"
    );
}

#[test]
fn minted_numbers_are_global_not_per_sport() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let mut engine = PersistentEngine::new(db_path.to_str().unwrap()).unwrap();
    seed(&mut engine);
    engine.get_groups();

    let minted = names(&engine);
    let mut numbers: Vec<&str> = minted
        .iter()
        .map(|(_, n)| n.rsplit(' ').next().unwrap())
        .collect();
    numbers.sort();
    numbers.dedup();
    assert_eq!(
        numbers.len(),
        minted.len(),
        "two groups were numbered per sport, so they share a number: {minted:?}"
    );
}
