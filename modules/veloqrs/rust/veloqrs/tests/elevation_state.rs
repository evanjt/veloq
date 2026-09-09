//! Per-activity elevation provenance on `gps_tracks`.
//!
//! A partly elevated library is worse than a uniformly flat one: a track
//! without elevation can mint a lift candidate but can never rescue one, so
//! mid-backfill a genuine climb is vetoed as a lift and the spurious section
//! keeps a durable ledger id afterwards. `elevation_state` is how the rest of
//! the system knows whether the all-or-nothing condition holds.
//!
//! Run: `cargo test --test elevation_state -p veloqrs`

mod migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

const UNKNOWN: u8 = 0;
const FETCHED: u8 = 1;
const UNAVAILABLE: u8 = 2;

fn flat_track(seed: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint {
            latitude: 46.2 + seed + f64::from(i) * 0.001,
            longitude: 7.35 + seed,
            elevation: None,
        })
        .collect()
}

fn engine_at(path: &Path) -> PersistentEngine {
    PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("open engine")
}

fn seeded_engine(ids: &[&str]) -> (TempDir, PathBuf, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let mut engine = engine_at(&path);
    for (i, id) in ids.iter().enumerate() {
        engine
            .add_activity(
                (*id).to_string(),
                flat_track(i as f64 * 0.01),
                "Ride".into(),
            )
            .expect("add activity");
    }
    (dir, path, engine)
}

/// Read the raw column, bypassing the engine, so an assertion cannot be
/// satisfied by an in-memory value the database never received.
fn stored_states(path: &Path) -> Vec<(String, i64)> {
    let conn = Connection::open(path).expect("reopen database");
    let mut stmt = conn
        .prepare("SELECT activity_id, elevation_state FROM gps_tracks ORDER BY activity_id")
        .expect("prepare");
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .expect("query");
    rows.map(|r| r.expect("row")).collect()
}

fn stored_row(path: &Path, id: &str) -> (Vec<u8>, i64, String) {
    let conn = Connection::open(path).expect("reopen database");
    conn.query_row(
        "SELECT g.track_data, g.point_count, a.sport_type
         FROM gps_tracks g JOIN activities a ON a.id = g.activity_id
         WHERE g.activity_id = ?",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .expect("read track row")
}

#[test]
fn a_fresh_database_stores_every_track_as_unknown() {
    let (_dir, path, engine) = seeded_engine(&["a1", "a2", "a3"]);

    assert_eq!(
        stored_states(&path),
        vec![
            ("a1".to_string(), 0),
            ("a2".to_string(), 0),
            ("a3".to_string(), 0)
        ],
        "a track stored without provenance must read as unknown, not as elevated"
    );

    let counts = engine.elevation_state_counts().expect("counts");
    assert_eq!(counts.unknown, 3);
    assert_eq!(counts.fetched, 0);
    assert_eq!(counts.unavailable, 0);
    assert_eq!(counts.not_fetched(), 3);
}

#[test]
fn recording_state_is_idempotent_and_leaves_the_track_untouched() {
    let (_dir, path, engine) = seeded_engine(&["a1"]);
    let before = stored_row(&path, "a1");

    engine
        .record_elevation_state(&[("a1".to_string(), FETCHED)])
        .expect("first record");
    let once = stored_states(&path);

    engine
        .record_elevation_state(&[("a1".to_string(), FETCHED)])
        .expect("repeat record");
    assert_eq!(
        stored_states(&path),
        once,
        "repeating a record must not drift"
    );
    assert_eq!(once, vec![("a1".to_string(), 1)]);

    let after = stored_row(&path, "a1");
    assert_eq!(before.0, after.0, "points blob must be byte-identical");
    assert_eq!(before.1, after.1, "point_count must be untouched");
    assert_eq!(before.2, after.2, "sport must be untouched");
}

#[test]
fn recording_state_upserts_over_an_earlier_value() {
    let (_dir, path, engine) = seeded_engine(&["a1"]);

    engine
        .record_elevation_state(&[("a1".to_string(), UNAVAILABLE)])
        .expect("record unavailable");
    assert_eq!(stored_states(&path), vec![("a1".to_string(), 2)]);

    engine
        .record_elevation_state(&[("a1".to_string(), FETCHED)])
        .expect("record fetched");
    assert_eq!(stored_states(&path), vec![("a1".to_string(), 1)]);
}

#[test]
fn counts_split_a_mixed_population() {
    let (_dir, _path, engine) = seeded_engine(&["a1", "a2", "a3", "a4", "a5"]);

    engine
        .record_elevation_state(&[
            ("a1".to_string(), FETCHED),
            ("a2".to_string(), FETCHED),
            ("a3".to_string(), UNAVAILABLE),
            ("a4".to_string(), UNKNOWN),
        ])
        .expect("record mixed");

    let counts = engine.elevation_state_counts().expect("counts");
    assert_eq!(counts.fetched, 2);
    assert_eq!(counts.unavailable, 1);
    assert_eq!(
        counts.unknown, 2,
        "a4 recorded unknown plus a5 never recorded"
    );
    assert_eq!(counts.not_fetched(), 3);
}

#[test]
fn recording_state_for_an_unknown_activity_creates_nothing() {
    let (_dir, path, engine) = seeded_engine(&["a1"]);

    engine
        .record_elevation_state(&[("a1".to_string(), FETCHED), ("ghost".to_string(), FETCHED)])
        .expect("recording an absent id must not error");

    assert_eq!(
        stored_states(&path),
        vec![("a1".to_string(), 1)],
        "an id with no track row must not mint one"
    );
    assert_eq!(engine.elevation_state_counts().expect("counts").fetched, 1);
}

/// The upgrade path, not the fresh one. A schema change whose upgrade is
/// untested loses user data.
#[test]
fn upgrading_from_v12_reaches_the_column_with_existing_rows_at_unknown() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");

    let conn = seed_at_version(&path, 12);
    assert!(
        !columns_of(&conn, "gps_tracks").contains(&"elevation_state".to_string()),
        "the seed must predate the column, or the test proves nothing"
    );
    conn.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
         VALUES ('legacy', 'Ride', 46.2, 46.3, 7.3, 7.4)",
        [],
    )
    .expect("insert legacy activity");
    // A blob long enough that a truncation or a re-encode during the upgrade
    // shows up, which a one-byte placeholder would hide.
    let blob: Vec<u8> = (0..2000u32).map(|i| (i % 251) as u8).collect();
    conn.execute(
        "INSERT INTO gps_tracks (activity_id, track_data, point_count)
         VALUES ('legacy', ?1, 500)",
        rusqlite::params![blob],
    )
    .expect("insert legacy track");
    drop(conn);

    let engine = engine_at(&path);
    drop(engine);

    let conn = Connection::open(&path).expect("reopen upgraded");
    assert!(
        columns_of(&conn, "gps_tracks").contains(&"elevation_state".to_string()),
        "the upgrade must add the column"
    );
    let state: i64 = conn
        .query_row(
            "SELECT elevation_state FROM gps_tracks WHERE activity_id = 'legacy'",
            [],
            |row| row.get(0),
        )
        .expect("read legacy state");
    assert_eq!(
        state, 0,
        "a row that predates the column must read as unknown"
    );
    assert_eq!(
        conn.query_row(
            "SELECT point_count FROM gps_tracks WHERE activity_id = 'legacy'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .expect("read legacy point_count"),
        500,
        "the existing row must survive the upgrade intact"
    );
    assert_eq!(
        conn.query_row(
            "SELECT track_data FROM gps_tracks WHERE activity_id = 'legacy'",
            [],
            |r| r.get::<_, Vec<u8>>(0)
        )
        .expect("read legacy track_data"),
        blob,
        "the upgrade must not rewrite or truncate a stored track"
    );
}
