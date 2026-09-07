//! The athlete a recording belongs to, and what an upgrade does to the rows
//! that predate the column.
//!
//! Scenario: a pending recording is held across a forced sign-out instead of
//! being demoted, so the app has to be able to say whose it is before it may
//! upload it.
//!
//! Expected behaviour: `recordings` carries the athlete stamped at save time,
//! a row written before the column existed reads `None` rather than failing
//! the upgrade, and every other value on that row survives it.

use rusqlite::{Connection, params};
use rusqlite_migration::{M, Migrations};
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::FfiRecordingEntry;

const RECORDING_ID: &str = "1757200000000-abc123";
const ATHLETE: &str = "i296629";

/// Every migration up to and including the recordings table and its reconcile
/// flag: the schema as the last release wrote it, before the athlete column.
fn migrations_before_the_stamp() -> Migrations<'static> {
    let mut set: Vec<M<'static>> = veloqrs::PersistentEngine::migration_scripts()
        .into_iter()
        .map(M::up)
        .collect();
    set.pop();
    Migrations::new(set)
}

fn entry(id: &str) -> FfiRecordingEntry {
    FfiRecordingEntry {
        id: id.to_string(),
        fit_path: format!("/recordings/{id}.fit"),
        streams_path: None,
        activity_type: "Ride".to_string(),
        name: "Evening ride".to_string(),
        start_time: 1_757_200_000_000,
        duration_seconds: 3_600,
        distance_meters: 28_400.0,
        elevation_gain: Some(420.0),
        avg_heartrate: Some(142.0),
        paired_event_id: None,
        created_at: 1_757_203_600_000,
        upload_status: "pending".to_string(),
        retry_count: 0,
        last_attempt_at: None,
        last_error: None,
        intervals_activity_id: None,
        engine_activity_id: None,
        engine_reconciled: false,
        athlete_id: Some(ATHLETE.to_string()),
    }
}

/// A database written before the athlete column, holding one pending
/// recording with every other field populated.
fn seed_database_without_the_column(path: &Path) {
    let mut conn = Connection::open(path).expect("open");
    migrations_before_the_stamp()
        .to_latest(&mut conn)
        .expect("apply the migrations that shipped");
    conn.execute(
        "INSERT INTO recordings (id, fit_path, streams_path, activity_type, name, start_time, \
         duration_seconds, distance_meters, elevation_gain, avg_heartrate, paired_event_id, \
         created_at, upload_status, retry_count, last_attempt_at, last_error, \
         intervals_activity_id, engine_activity_id, engine_reconciled) \
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, NULL, NULL, NULL, NULL, 0)",
        params![
            RECORDING_ID,
            format!("/recordings/{RECORDING_ID}.fit"),
            "Ride",
            "Evening ride",
            1_757_200_000_000i64,
            3_600i64,
            28_400.0f64,
            420.0f64,
            142.0f64,
            1_757_203_600_000i64,
            "pending",
        ],
    )
    .expect("insert the pre-upgrade recording");
}

#[test]
fn an_upgrade_leaves_a_recording_written_before_the_column_unstamped_and_otherwise_intact() {
    let dir = TempDir::new().expect("temp dir");
    let db = dir.path().join("veloq.db");
    seed_database_without_the_column(&db);

    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open and migrate");
    let rows = engine.list_recordings().expect("list");

    assert_eq!(rows.len(), 1, "the upgrade lost the recording");
    let row = &rows[0];
    assert_eq!(row.id, RECORDING_ID);
    assert_eq!(
        row.athlete_id, None,
        "a row written before the column has no athlete, and must not be given one"
    );
    assert_eq!(row.upload_status, "pending");
    assert_eq!(row.distance_meters, 28_400.0);
    assert_eq!(row.elevation_gain, Some(420.0));
    assert_eq!(row.avg_heartrate, Some(142.0));
    assert_eq!(row.duration_seconds, 3_600);
}

#[test]
fn a_recording_saved_with_an_athlete_reads_that_athlete_back() {
    let dir = TempDir::new().expect("temp dir");
    let db = dir.path().join("veloq.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");

    assert!(
        engine
            .insert_recording(&entry("1757300000000-def456"))
            .expect("insert"),
        "the row was not written"
    );

    let rows = engine.list_recordings().expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].athlete_id, Some(ATHLETE.to_string()));
}

#[test]
fn a_recording_saved_with_no_athlete_stays_unstamped() {
    let dir = TempDir::new().expect("temp dir");
    let db = dir.path().join("veloq.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");

    let mut anonymous = entry("1757400000000-ghi789");
    anonymous.athlete_id = None;
    engine.insert_recording(&anonymous).expect("insert");

    let rows = engine.list_recordings().expect("list");
    assert_eq!(rows[0].athlete_id, None);
}
