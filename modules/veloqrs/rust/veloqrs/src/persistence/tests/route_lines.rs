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
                 DROP TABLE activity_new_ground;
                 ALTER TABLE sections DROP COLUMN original_polyline_blob;
                 ALTER TABLE gps_tracks DROP COLUMN elevation_source;
                 DROP INDEX idx_activity_census_trackless_series;
                 ALTER TABLE activity_census DROP COLUMN has_series;
                 ALTER TABLE evidence_cache DROP COLUMN dirty_clusters;
                 ALTER TABLE recordings DROP COLUMN upload_in_doubt;
                 ALTER TABLE push_runs DROP COLUMN posted_title;
                 ALTER TABLE push_runs DROP COLUMN posted_body;
                 DROP TABLE activity_sync_failures;
                 DROP TABLE activity_held_back;
                 DROP TABLE garmin_link_unresolved;
                 ALTER TABLE gps_tracks DROP COLUMN elevation_settled_version;
                 ALTER TABLE activity_stream_backfill DROP COLUMN withheld;
                 ALTER TABLE activity_stream_backfill DROP COLUMN settled_version;
                 ALTER TABLE section_activities DROP COLUMN projected_m;
                 ALTER TABLE section_rank_inputs ADD COLUMN latest_is_pr INTEGER NOT NULL DEFAULT 0;
                 DROP TRIGGER section_list_counts_ai;
                 DROP TRIGGER section_list_counts_ad;
                 DROP TRIGGER section_list_counts_au;
                 DROP TRIGGER route_group_sizes_ai;
                 DROP TRIGGER route_group_sizes_ad;
                 DROP TRIGGER route_group_sizes_au_old;
                 DROP TRIGGER route_group_sizes_au_new;
                 DROP TABLE section_list_counts;
                 DROP TABLE route_group_sizes;
                 CREATE TABLE section_visible_count (
                     id INTEGER PRIMARY KEY CHECK (id = 1),
                     n INTEGER NOT NULL
                 );",
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

fn line_of(route_id: &str, number: Option<u32>, points: &[GpsPoint]) -> RouteLine {
    RouteLine {
        route_id: route_id.to_string(),
        number,
        polyline: crate::persistence::codec::encode_polyline(points),
    }
}

fn answered(conn: &Connection) -> serde_json::Value {
    let text = crate::basemap::route_lines_collection(conn).expect("the layer reads");
    serde_json::from_str(&text).expect("the answer is JSON")
}

fn answered_ids(answer: &serde_json::Value) -> Vec<String> {
    answer["features"]
        .as_array()
        .expect("features")
        .iter()
        .map(|feature| feature["properties"]["id"].as_str().unwrap().to_string())
        .collect()
}

fn answered_positions(feature: &serde_json::Value) -> Vec<(f64, f64)> {
    feature["geometry"]["coordinates"]
        .as_array()
        .expect("positions")
        .iter()
        .map(|position| {
            (
                position[0].as_f64().expect("lng"),
                position[1].as_f64().expect("lat"),
            )
        })
        .collect()
}

#[test]
fn the_geo_answer_draws_each_route_with_a_line_in_layer_order() {
    let _serial = crate::test_globals::serial_global_state();
    let engine = PersistentEngine::in_memory().unwrap();
    let generation = read_group_generation(&engine.db).unwrap();
    // A non-finite pair cannot reach the layer, the codec writes it as zero,
    // so the finite guard is pinned on the writer in `basemap::geo`.
    let long = track(46.0);
    let single = vec![GpsPoint::new(47.0, 7.0)];
    let other = track(48.123_456_7);
    write_layer(
        &engine.db,
        generation,
        &[
            line_of("r_1", Some(1), &long),
            line_of("r_2", Some(2), &single),
            line_of("r_3", None, &other),
        ],
    )
    .unwrap();

    let answer = answered(&engine.db);

    assert_eq!(answered_ids(&answer), ["r_1", "r_3"]);
    let features = answer["features"].as_array().expect("features");
    assert_eq!(features[0]["id"], "r_1");
    assert_eq!(features[0]["properties"]["number"], 1);
    assert_eq!(features[1]["properties"]["number"], serde_json::Value::Null);
    for (feature, points) in [(&features[0], &long), (&features[1], &other)] {
        let stored = crate::persistence::codec::decode_polyline(
            &crate::persistence::codec::encode_polyline(points),
        )
        .expect("decodes");
        let drawn = answered_positions(feature);
        assert_eq!(drawn.len(), stored.len());
        for ((lng, lat), point) in drawn.iter().zip(&stored) {
            assert!(
                (lng - point.longitude).abs() < 1e-6,
                "{lng} {}",
                point.longitude
            );
            assert!(
                (lat - point.latitude).abs() < 1e-6,
                "{lat} {}",
                point.latitude
            );
        }
    }
}

#[test]
fn the_geo_answer_follows_a_regroup_and_is_empty_for_a_stale_layer() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    library(&mut engine);
    save(
        &mut engine,
        vec![group("r_1", &["a", "b"]), group("r_2", &["c", "d"])],
    );
    assert_eq!(answered_ids(&answered(&engine.db)), ["r_1", "r_2"]);

    save(
        &mut engine,
        vec![group("r_2", &["c", "d"]), group("r_3", &["e", "f"])],
    );
    assert_eq!(answered_ids(&answered(&engine.db)), ["r_2", "r_3"]);

    engine
        .db
        .execute(
            "UPDATE route_line_layer SET generation = generation - 1",
            [],
        )
        .unwrap();
    assert_eq!(
        crate::basemap::route_lines_collection(&engine.db).unwrap(),
        r#"{"type":"FeatureCollection","features":[]}"#
    );
}

#[test]
fn the_geo_answer_is_empty_with_no_layer() {
    let _serial = crate::test_globals::serial_global_state();
    let engine = PersistentEngine::in_memory().unwrap();

    assert_eq!(
        crate::basemap::route_lines_collection(&engine.db).unwrap(),
        r#"{"type":"FeatureCollection","features":[]}"#
    );
}
