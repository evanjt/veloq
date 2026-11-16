//! What the athlete wrote about a recorded ride travels in the record backup
//! without the file or the upload state, and a restore puts it back on the
//! ride it names. A restored row has no file, so it is never offered to the
//! upload queue.

use crate::persistence::PersistentEngine;
use crate::persistence::record_backup::collect_record_payload;
use crate::persistence::recordings::FfiRecordingEntry;

fn recording(id: &str) -> FfiRecordingEntry {
    FfiRecordingEntry {
        id: id.to_string(),
        kind: "fit".to_string(),
        fit_path: format!("/disk/{id}.fit"),
        streams_path: Some(format!("/disk/{id}.json")),
        activity_type: "Ride".to_string(),
        name: "Dawn loop".to_string(),
        start_time: 1_700_000_000_000.0,
        duration_seconds: 3600.0,
        distance_meters: 20_000.0,
        elevation_gain: None,
        avg_heartrate: None,
        paired_event_id: Some(4242.0),
        created_at: 1_700_000_100_000.0,
        upload_status: "localOnly".to_string(),
        retry_count: 3,
        last_attempt_at: Some(1_700_000_200_000.0),
        last_error: Some("offline".to_string()),
        intervals_activity_id: None,
        engine_activity_id: None,
        engine_reconciled: false,
        athlete_id: Some("athlete-1".to_string()),
        notes: Some("Cold start, legs heavy".to_string()),
        rpe: Some(7),
        rpe_sent: false,
    }
}

fn engine(dir: &tempfile::TempDir, name: &str) -> PersistentEngine {
    PersistentEngine::new(dir.path().join(name).to_str().unwrap()).unwrap()
}

fn backup_of(source: &PersistentEngine) -> String {
    serde_json::to_string(&collect_record_payload(&source.db).unwrap()).unwrap()
}

fn words(
    engine: &PersistentEngine,
    id: &str,
) -> (String, Option<String>, Option<u32>, Option<f64>) {
    let row = engine.get_recording(id).unwrap().unwrap();
    (row.name, row.notes, row.rpe, row.paired_event_id)
}

#[test]
fn the_backup_holds_the_athletes_words_and_not_the_file_or_the_upload_state() {
    let dir = tempfile::tempdir().unwrap();
    let source = engine(&dir, "source.db");
    source.insert_recording(&recording("rec-1")).unwrap();

    let payload = collect_record_payload(&source.db).unwrap();
    let rows: Vec<_> = payload
        .entries
        .iter()
        .filter(|row| row.table == "recordings")
        .collect();
    assert_eq!(rows.len(), 1);
    let values = &rows[0].values;
    assert_eq!(values["name"], "Dawn loop");
    assert_eq!(values["notes"], "Cold start, legs heavy");
    assert_eq!(values["rpe"], 7);
    assert_eq!(values["paired_event_id"], 4242);
    for left_out in [
        "fit_path",
        "streams_path",
        "upload_status",
        "retry_count",
        "last_error",
    ] {
        assert!(!values.contains_key(left_out), "{left_out} travelled");
    }
}

#[test]
fn a_restore_puts_the_words_back_on_the_recording_the_library_holds() {
    let dir = tempfile::tempdir().unwrap();
    let source = engine(&dir, "source.db");
    source.insert_recording(&recording("rec-1")).unwrap();
    let json = backup_of(&source);

    let mut target = engine(&dir, "target.db");
    let mut bare = recording("rec-1");
    bare.name = "Ride".to_string();
    bare.notes = None;
    bare.rpe = None;
    bare.paired_event_id = None;
    target.insert_recording(&bare).unwrap();

    let result = target.restore_record_json(&json).unwrap();

    assert_eq!(result.unplaced, 0);
    assert_eq!(
        words(&target, "rec-1"),
        (
            "Dawn loop".to_string(),
            Some("Cold start, legs heavy".to_string()),
            Some(7),
            Some(4242.0)
        )
    );
}

#[test]
fn a_restore_with_no_ride_waits_and_places_when_the_ride_arrives() {
    let dir = tempfile::tempdir().unwrap();
    let source = engine(&dir, "source.db");
    let mut uploaded = recording("rec-1");
    uploaded.upload_status = "uploaded".to_string();
    uploaded.intervals_activity_id = Some("i777".to_string());
    source.insert_recording(&uploaded).unwrap();
    let json = backup_of(&source);

    let mut target = engine(&dir, "target.db");
    let result = target.restore_record_json(&json).unwrap();
    assert_eq!(result.unplaced, 1);
    assert!(target.get_recording("rec-1").unwrap().is_none());

    target
        .db
        .execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, intervals_id)
             VALUES ('i777', 'Ride', 1, 1, 1, 1, 'i777')",
            [],
        )
        .unwrap();
    let result = target.retry_record_restore().unwrap();

    assert_eq!(result.unplaced, 0);
    let row = target.get_recording("rec-1").unwrap().unwrap();
    assert_eq!(row.notes.as_deref(), Some("Cold start, legs heavy"));
    assert_eq!(row.rpe, Some(7));
    assert_eq!(row.paired_event_id, Some(4242.0));
    assert_eq!(row.engine_activity_id.as_deref(), Some("i777"));
    assert_eq!(row.fit_path, "");
    assert_eq!(row.upload_status, "uploaded");
    assert!(
        target
            .next_pending_recording(i64::MAX / 2)
            .unwrap()
            .is_none(),
        "a restored row has no file and must not be uploaded"
    );
}

#[test]
fn a_restored_row_without_an_upload_id_is_never_queued() {
    let dir = tempfile::tempdir().unwrap();
    let source = engine(&dir, "source.db");
    source.insert_recording(&recording("rec-1")).unwrap();
    let json = backup_of(&source);

    let mut target = engine(&dir, "target.db");
    target
        .db
        .execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, intervals_id)
             VALUES ('rec-1', 'Ride', 1, 1, 1, 1, NULL)",
            [],
        )
        .unwrap();
    target.restore_record_json(&json).unwrap();

    let row = target.get_recording("rec-1").unwrap().unwrap();
    assert_eq!(row.upload_status, "localOnly");
    assert!(
        target
            .next_pending_recording(i64::MAX / 2)
            .unwrap()
            .is_none()
    );
}
