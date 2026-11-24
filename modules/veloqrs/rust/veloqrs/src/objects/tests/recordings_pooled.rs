use super::*;
use crate::persistence::recordings::UploadTransition;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

fn entry(id: &str, created_at: i64, status: &str) -> FfiRecordingEntry {
    FfiRecordingEntry {
        id: id.to_string(),
        kind: "fit".to_string(),
        fit_path: format!("/recordings/{id}.fit"),
        streams_path: None,
        activity_type: "Ride".to_string(),
        name: format!("Ride {id}"),
        start_time: created_at as f64,
        duration_seconds: 3600.0,
        distance_meters: 20_000.0,
        elevation_gain: Some(120.0),
        avg_heartrate: Some(148.0),
        paired_event_id: None,
        created_at: created_at as f64,
        upload_status: status.to_string(),
        retry_count: 0,
        last_attempt_at: None,
        last_error: None,
        intervals_activity_id: None,
        engine_activity_id: None,
        engine_reconciled: false,
        athlete_id: Some("i1".to_string()),
        notes: None,
        rpe: None,
        rpe_sent: false,
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_list_recordings_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("recordings_list_under_writer.db");
    let recordings = RecordingManager::new();
    let result = read_while_writer_holds(|| recordings.list_recordings().unwrap());
    assert!(result.is_empty());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_get_recording_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("recordings_get_under_writer.db");
    let recordings = RecordingManager::new();
    let result = read_while_writer_holds(|| recordings.get_recording("r1".into()).unwrap());
    assert!(result.is_none());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_unuploaded_count_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("recordings_count_under_writer.db");
    let recordings = RecordingManager::new();
    assert_eq!(
        read_while_writer_holds(|| recordings
            .unuploaded_visible_count(Some("i1".into()))
            .unwrap()),
        0
    );
}

/// The pooled reads answer from the same rows the engine methods do, including
/// a row the add wrote a moment before, which is the read-after-write a save
/// followed by a list makes.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_pooled_reads_match_the_engine() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("recordings_pooled_parity.db");
    let recordings = RecordingManager::new();
    assert!(
        recordings
            .add_recording(entry("old", 1_000, "pending"))
            .unwrap()
    );
    assert!(
        recordings
            .add_recording(entry("new", 2_000, "pending"))
            .unwrap()
    );
    assert!(
        recordings
            .add_recording(entry("done", 3_000, "uploaded"))
            .unwrap()
    );
    crate::with_persistent_engine(|e| {
        let begun = e
            .transition_recording("old", &UploadTransition::Begin, 9_000)
            .unwrap();
        e.transition_recording(
            "old",
            &UploadTransition::Failed {
                install: begun.install,
                error: "offline".into(),
            },
            10_000,
        )
        .unwrap();
    })
    .unwrap();

    let (list, one, missing, next, count) = crate::with_persistent_engine(|e| {
        (
            e.list_recordings().unwrap(),
            e.get_recording("new").unwrap(),
            e.get_recording("missing").unwrap(),
            e.next_pending_recording(10_001).unwrap(),
            e.unuploaded_recording_count(Some("i1")).unwrap(),
        )
    })
    .unwrap();

    assert_eq!(
        format!("{:?}", recordings.list_recordings().unwrap()),
        format!("{list:?}")
    );
    assert_eq!(
        list.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        vec!["done", "new", "old"]
    );
    assert_eq!(
        format!("{:?}", recordings.get_recording("new".into()).unwrap()),
        format!("{one:?}")
    );
    assert!(one.is_some());
    assert!(
        recordings
            .get_recording("missing".into())
            .unwrap()
            .is_none()
    );
    assert!(missing.is_none());
    // The failed attempt on the older entry is still backing off, so the queue
    // skips past it to the newer one.
    assert_eq!(next.map(|r| r.id), Some("new".to_string()));
    assert_eq!(
        recordings
            .unuploaded_visible_count(Some("i1".into()))
            .unwrap(),
        count
    );
    assert_eq!(count, 2);
}
