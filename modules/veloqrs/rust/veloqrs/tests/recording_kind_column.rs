//! What a recording is: a FIT the app wrote, or a manual entry the athlete typed.
//!
//! Scenario: a manual indoor entry posted straight to intervals.icu and kept no
//! local copy, so offline it failed with a red banner and what was typed was
//! lost. It belongs in the recordings library like any other ride, and that
//! table could not hold a row without a file: `fit_path` is NOT NULL and
//! nothing said a row had no FIT to look for.
//!
//! Expected behaviour: a `kind` column, `fit` for every row that predates it,
//! `manual` for an entry with no FIT and an empty `fit_path`, and every other
//! value on an upgraded row untouched.

use rusqlite::{Connection, params};
use rusqlite_migration::{M, Migrations};
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::FfiRecordingEntry;

const RECORDING_ID: &str = "1757200000000-abc123";
const MANUAL_ID: &str = "1757500000000-man001";

/// Every migration but the last, which is the schema as the release before this
/// one wrote it.
fn migrations_before_the_kind() -> Migrations<'static> {
    let mut set: Vec<M<'static>> = PersistentEngine::migration_scripts()
        .into_iter()
        .map(M::up)
        .collect();
    set.pop();
    Migrations::new(set)
}

fn manual_entry(id: &str) -> FfiRecordingEntry {
    FfiRecordingEntry {
        id: id.to_string(),
        kind: "manual".to_string(),
        // A manual entry has no file, and the column cannot hold a null.
        fit_path: String::new(),
        streams_path: Some(format!("/recordings/{id}.manual.json")),
        activity_type: "VirtualRide".to_string(),
        name: "Turbo session".to_string(),
        start_time: 1_757_500_000_000.0,
        duration_seconds: 2_700.0,
        distance_meters: 0.0,
        elevation_gain: None,
        avg_heartrate: Some(138.0),
        paired_event_id: None,
        created_at: 1_757_502_700_000.0,
        upload_status: "pending".to_string(),
        retry_count: 0,
        last_attempt_at: None,
        last_error: None,
        intervals_activity_id: None,
        engine_activity_id: None,
        engine_reconciled: false,
        athlete_id: Some("i296629".to_string()),
        notes: None,
        rpe: None,
        rpe_sent: false,
    }
}

/// A database written before the kind column, holding one pending FIT recording.
fn seed_database_without_the_column(path: &Path) {
    let mut conn = Connection::open(path).expect("open");
    migrations_before_the_kind()
        .to_latest(&mut conn)
        .expect("apply the migrations that shipped");
    conn.execute(
        "INSERT INTO recordings (id, fit_path, streams_path, activity_type, name, start_time, \
         duration_seconds, distance_meters, elevation_gain, avg_heartrate, paired_event_id, \
         created_at, upload_status, retry_count, last_attempt_at, last_error, \
         intervals_activity_id, engine_activity_id, engine_reconciled, athlete_id) \
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, NULL, NULL, NULL, NULL, 0, ?)",
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
            "i296629",
        ],
    )
    .expect("insert the pre-upgrade recording");
}

#[test]
fn an_upgrade_calls_every_existing_recording_a_fit_and_changes_nothing_else() {
    let dir = TempDir::new().expect("temp dir");
    let db = dir.path().join("veloq.db");
    seed_database_without_the_column(&db);

    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open and migrate");
    let rows = engine.list_recordings().expect("list");

    assert_eq!(rows.len(), 1, "the upgrade lost the recording");
    let row = &rows[0];
    assert_eq!(row.kind, "fit", "a row written before the column has a FIT");
    assert_eq!(row.fit_path, format!("/recordings/{RECORDING_ID}.fit"));
    assert_eq!(row.upload_status, "pending");
    assert_eq!(row.distance_meters, 28_400.0);
    assert_eq!(row.elevation_gain, Some(420.0));
    assert_eq!(row.duration_seconds, 3_600.0);
    assert_eq!(row.athlete_id, Some("i296629".to_string()));
}

#[test]
fn a_manual_entry_is_a_row_with_no_file() {
    let dir = TempDir::new().expect("temp dir");
    let db = dir.path().join("veloq.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");

    assert!(
        engine
            .insert_recording(&manual_entry(MANUAL_ID))
            .expect("insert"),
        "the row was not written"
    );

    let row = engine
        .get_recording(MANUAL_ID)
        .expect("read")
        .expect("the manual row");
    assert_eq!(row.kind, "manual");
    assert_eq!(row.fit_path, "", "a manual entry names no file");
    assert_eq!(
        row.streams_path,
        Some(format!("/recordings/{MANUAL_ID}.manual.json")),
        "the request body is where the streams sidecar would be"
    );
    assert_eq!(row.upload_status, "pending");
}

#[test]
fn a_manual_entry_is_the_next_pending_upload_like_any_other() {
    let dir = TempDir::new().expect("temp dir");
    let db = dir.path().join("veloq.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");
    engine
        .insert_recording(&manual_entry(MANUAL_ID))
        .expect("insert");

    let next = engine
        .next_pending_recording(1_757_502_800_000)
        .expect("read")
        .expect("a pending entry");

    assert_eq!(next.id, MANUAL_ID);
    assert_eq!(next.kind, "manual");
}
