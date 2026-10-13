//! Every queue that asks upstream about an activity, and the census that
//! removes one upstream no longer names, decides from the key and the stored
//! upstream id whether the row is upstream at all. They answer differently on
//! purpose for some classes of row, and those answers are pinned here so a
//! change to who owns the rule cannot move one of them.
//!
//! Scenario: one library holds a row of every class the engine can store: a
//! server key with and without a track, a device key before and after its
//! upload (tracked, trackless, and tracked with the id only on its body), a
//! seeded demo key, a device recording uploaded in demo mode, and a key from
//! the reserved file-import prefix, with and without a track.
//!
//! Expected behaviour: each queue selects exactly the set below, and no queue
//! or census ever selects an imported key no upload has named.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test persistence -p veloqrs -- activity_origin_queues::`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

const TRACKED: [&str; 7] = [
    "i1",
    "local-a",
    "local-b",
    "local-d",
    "demo-x",
    "local-r",
    "src-file-a",
];
const TRACKLESS: [&str; 3] = ["i2", "local-c", "src-file-b"];

fn track(seed: f64) -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint {
            latitude: 46.0 + seed * 0.01 + f64::from(i) * 0.0002,
            longitude: 7.0 + seed * 0.01,
            elevation: None,
        })
        .collect()
}

fn conn(dir: &TempDir) -> Connection {
    Connection::open(dir.path().join("routes.db")).expect("open directly")
}

fn library() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    for (i, id) in TRACKED.iter().enumerate() {
        engine
            .add_activity((*id).to_string(), track(i as f64), "Ride".to_string())
            .expect("store track");
    }
    let c = conn(&dir);
    for id in TRACKED.iter().chain(TRACKLESS.iter()) {
        c.execute(
            "INSERT INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain,
                  sport_type)
             VALUES (?1, 'Ride', unixepoch('2025-01-01'), 0, 3600, 3600, 0, 'Ride')",
            params![id],
        )
        .expect("store metrics");
    }
    for id in TRACKLESS {
        c.execute(
            "INSERT INTO activity_bodies (activity_id, date, raw)
             VALUES (?1, unixepoch('2025-01-01'), '{}')",
            params![id],
        )
        .expect("store body");
    }
    c.execute(
        "INSERT INTO activity_bodies (activity_id, date, raw, intervals_id)
         VALUES ('local-d', unixepoch('2025-01-01'), '{}', 'i40')",
        [],
    )
    .expect("a body that carries the only upstream id");
    c.execute(
        "UPDATE activities SET intervals_id = 'demo-1700000000000' WHERE id = 'local-r'",
        [],
    )
    .expect("an upload made in demo mode");
    drop(c);
    assert!(
        engine
            .record_upload("local-b", "i20")
            .expect("tracked upload")
    );
    assert!(
        engine
            .record_upload("local-c", "i30")
            .expect("trackless upload")
    );
    (dir, engine)
}

fn sorted(mut ids: Vec<String>) -> Vec<String> {
    ids.sort();
    ids
}

fn names(ids: &[&str]) -> Vec<String> {
    sorted(ids.iter().map(|s| (*s).to_string()).collect())
}

fn stored_intervals_id(dir: &TempDir, id: &str) -> Option<String> {
    conn(dir)
        .query_row(
            "SELECT intervals_id FROM activities WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .expect("row stored")
}

#[test]
fn the_ingest_records_an_upstream_id_only_for_a_key_upstream_can_have_minted() {
    let (dir, _engine) = library();

    assert_eq!(stored_intervals_id(&dir, "i1").as_deref(), Some("i1"));
    assert_eq!(
        stored_intervals_id(&dir, "demo-x").as_deref(),
        Some("demo-x")
    );
    assert_eq!(stored_intervals_id(&dir, "local-a"), None);
    assert_eq!(stored_intervals_id(&dir, "local-d"), None);
    assert_eq!(stored_intervals_id(&dir, "src-file-a"), None);
}

#[test]
fn the_census_compares_only_rows_upstream_has_named() {
    let (_dir, engine) = library();

    let mut candidates = engine.census_candidates("9999-12-31");
    candidates.sort();

    assert_eq!(
        candidates,
        vec![
            ("i1".to_string(), "i1".to_string()),
            ("i2".to_string(), "i2".to_string()),
            ("local-b".to_string(), "i20".to_string()),
            ("local-c".to_string(), "i30".to_string()),
        ]
    );
}

#[test]
fn the_interval_body_queue_asks_for_every_named_row_and_the_demo_ones() {
    let (_dir, engine) = library();

    assert_eq!(
        sorted(engine.activities_missing_interval_bodies().expect("queue")),
        names(&[
            "demo-x", "i1", "i2", "local-b", "local-c", "local-d", "local-r"
        ])
    );
}

#[test]
fn the_stream_queue_reads_only_the_activity_row_for_an_upstream_id() {
    let (_dir, engine) = library();

    let queue = engine.activities_missing_streams(u32::MAX).expect("queue");

    assert_eq!(
        sorted(queue.into_iter().map(|gap| gap.activity_id).collect()),
        names(&["demo-x", "i1", "local-b", "local-r"])
    );
}

#[test]
fn the_elevation_queue_leaves_out_demo_keys_and_unnamed_ones() {
    let (_dir, engine) = library();

    let queue = engine.tracks_missing_elevation().expect("queue");

    assert_eq!(
        sorted(queue.into_iter().map(|(id, _)| id).collect()),
        names(&["i1", "local-b", "local-d", "local-r"])
    );
}

#[test]
fn the_time_stream_queue_leaves_out_unnamed_keys() {
    let (dir, engine) = library();
    let c = conn(&dir);
    c.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
            distance_meters, is_user_defined, version, created_at,
            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES ('section', 'auto', 'Section', 'Ride', '[]', 400.0, 0, 1,
            '2026-01-01T00:00:00Z', 46.0, 46.1, 7.0, 7.1)",
        [],
    )
    .expect("store section");
    for id in TRACKED {
        c.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                start_index, end_index, distance_meters, lap_time)
             VALUES ('section', ?1, 'same', 1, 10, 400.0, NULL)",
            params![id],
        )
        .expect("store portion");
    }
    drop(c);

    assert_eq!(
        sorted(engine.get_activities_needing_time_streams()),
        names(&["demo-x", "i1", "local-b", "local-d", "local-r"])
    );
}
