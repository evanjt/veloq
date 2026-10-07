//! Scenario: a library's routes are regrouped, one route's representative is
//! chosen by hand, and the catalogue is wiped, each through the writer the app
//! uses.
//!
//! Expected behaviour: the layer read holds a line for exactly the committed
//! routes of two or more activities, each its representative's encoded
//! signature, and holds nothing once the groups it was built from are gone.

use super::*;
use crate::persistence::PersistentEngine;
use crate::{GpsPoint, RouteGroup};

fn track(latitude: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|index| GpsPoint::new(latitude + f64::from(index) * 0.00001, 7.0))
        .collect()
}

fn group(id: &str, members: &[&str]) -> RouteGroup {
    RouteGroup {
        group_id: id.to_string(),
        representative_id: members[0].to_string(),
        activity_ids: members.iter().map(|member| member.to_string()).collect(),
        sport_type: "Ride".to_string(),
        bounds: None,
        custom_name: None,
        best_time: None,
        avg_time: None,
        best_pace: None,
        best_activity_id: None,
    }
}

fn library(engine: &mut PersistentEngine) {
    for (id, latitude) in [
        ("a", 46.0),
        ("b", 46.0),
        ("c", 47.0),
        ("d", 47.001),
        ("e", 48.0),
        ("f", 48.0),
        ("g", 49.0),
    ] {
        engine
            .add_activity(id.into(), track(latitude), "Ride".into())
            .unwrap();
    }
}

fn save(engine: &mut PersistentEngine, groups: Vec<RouteGroup>) {
    engine.groups = groups;
    engine.route_identity_reseed();
    engine.save_groups().unwrap();
}

fn three_routes_regrouped_to_two(engine: &mut PersistentEngine) {
    library(engine);
    save(
        engine,
        vec![
            group("r_1", &["a", "b"]),
            group("r_2", &["c", "d"]),
            group("r_3", &["e", "f"]),
        ],
    );
    save(
        engine,
        vec![
            group("r_1", &["a", "b"]),
            group("r_2", &["c", "d", "e", "f"]),
            group("r_4", &["g"]),
        ],
    );
}

fn encoded_signature(conn: &Connection, activity_id: &str) -> Vec<u8> {
    let signature = crate::persistence::activities::pooled::signature(conn, activity_id)
        .expect("stored signature");
    crate::persistence::codec::encode_polyline(&signature.points)
}

fn route_ids(lines: &[RouteLine]) -> Vec<&str> {
    lines.iter().map(|line| line.route_id.as_str()).collect()
}

fn layer_of(conn: &Connection) -> Option<Vec<RouteLine>> {
    pooled::layer(conn).unwrap()
}

#[test]
fn a_regroup_leaves_a_line_for_each_route_it_kept() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    three_routes_regrouped_to_two(&mut engine);

    let lines = layer_of(&engine.db).expect("a current layer");
    assert_eq!(route_ids(&lines), ["r_1", "r_2"]);
    assert_eq!(lines[0].polyline, encoded_signature(&engine.db, "a"));
    assert_eq!(lines[1].polyline, encoded_signature(&engine.db, "c"));
    assert!(lines.iter().all(|line| line.number.is_some()));
    let route_count: i64 = engine
        .db
        .query_row("SELECT route_count FROM route_line_layer", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(route_count, 2);
}

#[test]
fn a_representative_choice_changes_only_its_own_line() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    three_routes_regrouped_to_two(&mut engine);
    let before = layer_of(&engine.db).expect("a current layer");

    engine.set_route_representative("r_2", "d").unwrap();

    let after = layer_of(&engine.db).expect("a current layer after the choice");
    assert_eq!(route_ids(&after), ["r_1", "r_2"]);
    assert_eq!(after[0], before[0]);
    assert_eq!(after[1].polyline, encoded_signature(&engine.db, "d"));
    assert_ne!(after[1].polyline, before[1].polyline);
    assert_eq!(after[1].number, before[1].number);
}

#[test]
fn clearing_routes_and_sections_leaves_no_lines() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    three_routes_regrouped_to_two(&mut engine);
    assert!(layer_of(&engine.db).is_some());

    engine.clear_routes_and_sections().unwrap();

    assert_eq!(layer_of(&engine.db), None);
}

#[test]
fn clearing_derived_data_leaves_no_lines() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    three_routes_regrouped_to_two(&mut engine);
    assert!(layer_of(&engine.db).is_some());

    engine.clear_derived().unwrap();

    assert_eq!(layer_of(&engine.db), None);
}

#[test]
fn clearing_the_library_leaves_no_lines() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    three_routes_regrouped_to_two(&mut engine);
    assert!(layer_of(&engine.db).is_some());

    engine.clear().unwrap();

    assert_eq!(layer_of(&engine.db), None);
    let rows: i64 = engine
        .db
        .query_row("SELECT COUNT(*) FROM route_line_layer", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(rows, 0);
}

#[test]
fn a_layer_from_an_older_generation_reads_as_none() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    three_routes_regrouped_to_two(&mut engine);
    assert!(layer_of(&engine.db).is_some());

    engine
        .db
        .execute(
            "UPDATE route_line_layer SET generation = generation - 1",
            [],
        )
        .unwrap();

    assert_eq!(layer_of(&engine.db), None);
}

#[test]
fn a_stale_layer_is_rebuilt_on_the_foreground_load() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let path = path.to_str().unwrap();
    {
        let mut engine = PersistentEngine::new(path).unwrap();
        three_routes_regrouped_to_two(&mut engine);
        engine
            .db
            .execute(
                "UPDATE route_line_layer SET generation = generation - 1, layer = x''",
                [],
            )
            .unwrap();
    }

    let mut engine = PersistentEngine::new(path).unwrap();
    engine.load().unwrap();

    let lines = layer_of(&engine.db).expect("the load rebuilt the layer");
    assert_eq!(route_ids(&lines), ["r_1", "r_2"]);
}

/// The schema before the layer, which every library this build opens comes
/// through on its way to the table.
const SCHEMA_BEFORE_THE_LAYER: i64 = 57;

#[test]
fn a_library_upgraded_with_stored_groups_reads_its_lines_after_the_load() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("upgraded.db");
    let path = path.to_str().unwrap();
    {
        let mut engine = PersistentEngine::new(path).unwrap();
        library(&mut engine);
        engine
            .db
            .execute_batch(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
                 VALUES ('r_1', 'a', '[\"a\",\"b\"]', 'Ride', 2),
                        ('r_2', 'c', '[\"c\"]', 'Ride', 1);
                 INSERT INTO route_numbers (route_id, number) VALUES ('r_1', 1), ('r_2', 2);
                 DROP TABLE route_line_layer;
                 DROP TABLE activity_climb_bests;
                 ALTER TABLE sections DROP COLUMN original_polyline_blob;
                 ALTER TABLE gps_tracks DROP COLUMN elevation_source;",
            )
            .unwrap();
        engine
            .db
            .pragma_update(None, "user_version", SCHEMA_BEFORE_THE_LAYER)
            .unwrap();
        engine
            .db
            .execute(
                "UPDATE schema_info SET value = ? WHERE key = 'schema_version'",
                [SCHEMA_BEFORE_THE_LAYER.to_string()],
            )
            .unwrap();
    }

    let mut engine = PersistentEngine::new(path).unwrap();
    engine.load().unwrap();

    let lines = layer_of(&engine.db).expect("the load built the layer");
    assert_eq!(
        lines,
        vec![RouteLine {
            route_id: "r_1".to_string(),
            number: Some(1),
            polyline: encoded_signature(&engine.db, "a"),
        }]
    );
}
