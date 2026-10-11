//! Scenario: section detail and activity detail read a section's route ids
//! for every section they show. Deciding which matched routes clear the
//! routes list's floor by first loading every route group in the library
//! makes each of those reads grow with the library while the answer stays
//! one or two ids.
//!
//! Expected behaviour: the route ids of one section cost the same number of
//! SQLite virtual machine steps beside ten unrelated route groups as beside
//! four hundred, and a group whose member count was never stored is judged by
//! its members, so one with two members is still a route and one with a
//! single member is not. The steps come from SQLite's progress handler, which
//! reads no clock.

use std::sync::atomic::{AtomicUsize, Ordering};

use rusqlite::params;
use tracematch::GpsPoint;

use crate::PersistentEngine;

static STEPS: AtomicUsize = AtomicUsize::new(0);

fn count_step() -> bool {
    STEPS.fetch_add(1, Ordering::SeqCst);
    false
}

/// The virtual machine steps `read` costs on `engine`'s connection.
fn steps_in<T>(engine: &PersistentEngine, read: impl FnOnce(&PersistentEngine) -> T) -> usize {
    STEPS.store(0, Ordering::SeqCst);
    engine
        .db
        .progress_handler(1, Some(count_step))
        .expect("install the step counter");
    let result = read(engine);
    engine
        .db
        .progress_handler(1, None::<fn() -> bool>)
        .expect("remove the step counter");
    std::hint::black_box(result);
    STEPS.load(Ordering::SeqCst)
}

/// One section passed by two activities, both grouped into `canal`, beside
/// `unrelated` route groups no activity of the section belongs to.
fn seeded(unrelated: usize) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    for id in ["walk_1", "walk_2"] {
        engine
            .add_activity(
                id.to_string(),
                vec![GpsPoint::new(46.2, 7.3), GpsPoint::new(46.21, 7.31)],
                "Ride".to_string(),
            )
            .expect("add activity");
    }
    let tx = engine.db.transaction().expect("tx");
    tx.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
            distance_meters, is_user_defined, version, created_at,
            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES ('towpath', 'auto', 'towpath', 'Ride', '[]', 400.0, 0, 1,
            '2026-01-01T00:00:00Z', 46.2, 46.21, 7.3, 7.31)",
        [],
    )
    .expect("insert section");
    for aid in ["walk_1", "walk_2"] {
        tx.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                start_index, end_index, distance_meters)
             VALUES ('towpath', ?, 'same', 0, 2, 400.0)",
            params![aid],
        )
        .expect("insert junction");
        tx.execute(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
             VALUES ('canal', ?, 100.0, 'same')",
            params![aid],
        )
        .expect("insert match");
    }
    tx.execute(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
            activity_count)
         VALUES ('canal', 'walk_1', '[\"walk_1\",\"walk_2\"]', 'Ride', 2)",
        [],
    )
    .expect("insert route");
    for g in 0..unrelated {
        tx.execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                activity_count)
             VALUES (?, 'elsewhere', '[\"elsewhere_1\",\"elsewhere_2\",\"elsewhere_3\"]',
                'Ride', 3)",
            params![format!("orchard_{g}")],
        )
        .expect("insert unrelated route");
    }
    tx.commit().expect("commit seed");
    engine.groups_dirty = false;
    engine
}

fn route_ids(engine: &PersistentEngine) -> Vec<String> {
    crate::persistence::routes::pooled::route_ids_for_sections(&engine.db, &["towpath".into()])
        .remove("towpath")
        .unwrap_or_default()
}

#[test]
fn a_sections_route_ids_cost_the_same_however_many_routes_the_library_holds() {
    let small = seeded(10);
    let large = seeded(400);

    let on_small = steps_in(&small, route_ids);
    let on_large = steps_in(&large, route_ids);
    assert!(on_small > 0, "the route ids ran no statement");
    assert_eq!(
        on_large, on_small,
        "the route ids took {on_large} steps beside 400 unrelated routes and {on_small} \
         beside 10: the read is walking every route group"
    );

    let detail_small = steps_in(&small, |e| e.get_section("towpath"));
    let detail_large = steps_in(&large, |e| e.get_section("towpath"));
    assert_eq!(
        detail_large, detail_small,
        "the section read took {detail_large} steps beside 400 unrelated routes and \
         {detail_small} beside 10"
    );
    assert_eq!(route_ids(&large), vec!["canal"]);
}

#[test]
fn a_group_with_no_stored_count_is_judged_by_its_members() {
    let engine = seeded(0);
    engine
        .db
        .execute(
            "UPDATE route_groups SET activity_count = NULL WHERE id = 'canal'",
            [],
        )
        .unwrap();
    assert_eq!(route_ids(&engine), vec!["canal"]);
    assert_eq!(
        engine.get_section("towpath").and_then(|s| s.route_ids),
        Some(vec!["canal".to_string()])
    );

    engine
        .db
        .execute(
            "UPDATE route_groups SET activity_ids = '[\"walk_1\"]' WHERE id = 'canal'",
            [],
        )
        .unwrap();
    assert!(
        route_ids(&engine).is_empty(),
        "a group with one member is under the routes list's floor"
    );
}

#[test]
fn a_matched_route_with_no_group_row_is_not_named() {
    let engine = seeded(0);
    engine
        .db
        .execute("DELETE FROM route_groups WHERE id = 'canal'", [])
        .unwrap();
    assert!(route_ids(&engine).is_empty());
}
