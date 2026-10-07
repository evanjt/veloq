//! Scenario: a sync page holds the engine write lock while the time-stream
//! backfill asks which stored activities still lack a usable stream.
//!
//! Expected behaviour: the list is read from committed rows on a pooled
//! connection and returns while the writer holds the engine, and it is the
//! list the engine's own method gives.

use super::*;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};
use crate::with_persistent_engine;

#[test]
fn activities_needing_time_streams_do_not_wait_for_a_writer() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("needing_streams_under_a_writer.db");
    with_persistent_engine(|e| {
        e.db.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('s', 'auto', 'S', 'Ride', '[]', 400.0, 0, 1,
                '2026-01-01T00:00:00Z', 46.0, 46.1, 7.0, 7.1)",
            [],
        )
        .unwrap();
        e.db.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES ('a1', 'Ride', 46.0, 46.1, 7.0, 7.1), ('a2', 'Ride', 46.0, 46.1, 7.0, 7.1)",
            [],
        )
        .unwrap();
        e.db.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                start_index, end_index, distance_meters, lap_time)
             VALUES ('s', 'a1', 'same', 1, 30, 400.0, NULL)",
            [],
        )
        .unwrap();
    })
    .unwrap();

    let ids = read_while_writer_holds(|| {
        VeloqEngine
            .get_activities_needing_time_streams()
            .expect("the read finishes while the writer holds the engine")
    });
    assert_eq!(ids, vec!["a1".to_string()]);
}

#[test]
fn the_pooled_list_is_the_one_the_engine_method_gives() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("needing_streams_parity.db");
    with_persistent_engine(|e| {
        e.db.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('s', 'auto', 'S', 'Ride', '[]', 400.0, 0, 1,
                '2026-01-01T00:00:00Z', 46.0, 46.1, 7.0, 7.1)",
            [],
        )
        .unwrap();
        e.db.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES ('a1', 'Ride', 46.0, 46.1, 7.0, 7.1), ('a2', 'Ride', 46.0, 46.1, 7.0, 7.1)",
            [],
        )
        .unwrap();
        for id in ["a1", "a2"] {
            e.db.execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                    start_index, end_index, distance_meters, lap_time, excluded)
                 VALUES ('s', ?, 'same', 1, 30, 400.0, NULL, ?)",
                rusqlite::params![id, i64::from(id == "a2")],
            )
            .unwrap();
        }
        let mut engine_list = e.get_activities_needing_time_streams();
        let mut pooled_list =
            crate::persistence::fitness::performances::activities_needing_time_streams(&e.db);
        engine_list.sort();
        pooled_list.sort();
        assert_eq!(engine_list, pooled_list);
        assert_eq!(
            pooled_list,
            vec!["a1".to_string()],
            "an excluded portion is not listed"
        );
    })
    .unwrap();
}
