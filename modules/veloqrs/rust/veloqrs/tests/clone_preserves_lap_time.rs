//! Regression test: `debug_clone_activity` must propagate cached performance
//! (lap_time, lap_pace) from the source row into every clone row.
//!
//! Before the fix, the clone path wrote `NULL, NULL` for both columns, so
//! demo-mode stress clones had no PR detection and feed trend pills read
//! empty data. Clones don't have their own time_streams, so the backfill
//! pass couldn't recover them either.
//!
//! Run: `cargo test --test clone_preserves_lap_time -p veloqrs`

use rusqlite::{params, Connection};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;

#[test]
fn clone_preserves_cached_lap_time_and_pace() {
    let tmp = TempDir::new().expect("temp dir");
    let db_path = tmp.path().join("test.db");
    let mut engine =
        PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("engine new");

    // Seed one source activity so activity_metadata has it.
    let source_id = "src-1".to_string();
    let coords = vec![
        GpsPoint {
            latitude: 46.20,
            longitude: 7.30,
            elevation: None,
        },
        GpsPoint {
            latitude: 46.21,
            longitude: 7.31,
            elevation: None,
        },
        GpsPoint {
            latitude: 46.22,
            longitude: 7.32,
            elevation: None,
        },
    ];
    engine
        .add_activity(source_id.clone(), coords, "Ride".to_string())
        .expect("add source activity");

    // Seed a section and a source section_activities row with known
    // lap_time/lap_pace. We don't need a real section polyline for this —
    // we're testing the clone SQL, not detection.
    {
        let raw = Connection::open(&db_path).expect("raw open");
        raw.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('sec-1', 'auto', 'Ride', '[]', 250.0)",
            [],
        )
        .expect("insert section");
        raw.execute(
            "INSERT INTO section_activities
             (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace)
             VALUES ('sec-1', ?1, 'same', 0, 2, 250.0, 123.45, 2.024)",
            params![source_id],
        )
        .expect("insert source section_activity");
    }

    // Clone twice.
    let created = engine.debug_clone_activity(&source_id, 2);
    assert_eq!(created, 2, "expected two clones");

    // Read back — every clone row must carry the source's lap_time/lap_pace.
    let raw = Connection::open(&db_path).expect("raw open");
    let mut stmt = raw
        .prepare(
            "SELECT activity_id, lap_time, lap_pace
             FROM section_activities
             WHERE section_id = 'sec-1' AND activity_id != ?1",
        )
        .expect("prepare");
    let rows: Vec<(String, Option<f64>, Option<f64>)> = stmt
        .query_map(params![source_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .expect("query")
        .filter_map(|r| r.ok())
        .collect();

    assert_eq!(rows.len(), 2, "expected two clone rows");
    for (activity_id, lap_time, lap_pace) in &rows {
        assert!(
            activity_id.starts_with("src-1_clone_"),
            "unexpected clone id: {activity_id}"
        );
        assert_eq!(*lap_time, Some(123.45), "clone lap_time lost");
        assert_eq!(*lap_pace, Some(2.024), "clone lap_pace lost");
    }
}
