use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::recordings::UploadTransition;

#[test]
fn a_synced_upload_that_disappears_can_retry_without_another_local_copy() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let track: Vec<GpsPoint> = (0..20)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0,
            elevation: None,
        })
        .collect();
    for id in ["local-recording", "i-old"] {
        engine
            .add_activity(id.to_string(), track.clone(), "Ride".to_string())
            .unwrap();
    }
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "INSERT INTO recordings (
            id, fit_path, activity_type, name, start_time, duration_seconds, distance_meters,
            created_at, upload_status, intervals_activity_id, engine_activity_id, engine_reconciled
        ) VALUES ('r1', 'ride.fit', 'Ride', 'Ride', 1, 20, 100, 1, 'uploaded', 'i-old', 'local-recording', 1)",
        [],
    )
    .unwrap();

    assert!(engine.record_upload("local-recording", "i-old").unwrap());
    let canonical = engine
        .get_recording("r1")
        .unwrap()
        .unwrap()
        .engine_activity_id
        .unwrap();
    assert_eq!(canonical, "i-old");
    let rejected = UploadTransition::Rejected {
        install: 0.0,
        error: "intervals.icu no longer has this activity".to_string(),
    };
    assert!(
        engine
            .transition_recording("r1", &rejected, 2_000)
            .unwrap()
            .applied
    );
    let rejected = engine.get_recording("r1").unwrap().unwrap();
    assert_eq!(rejected.upload_status, "failed");
    assert_eq!(rejected.intervals_activity_id, None);
    assert!(!rejected.engine_reconciled);
    assert_eq!(rejected.fit_path, "ride.fit");
    assert!(engine.next_pending_recording(10_000).unwrap().is_none());
    assert_eq!(engine.activity_id_for_intervals_id("i-old"), None);

    let landed = UploadTransition::Uploaded {
        install: 0.0,
        intervals_activity_id: Some("i-new".to_string()),
    };
    for transition in [UploadTransition::Requeue, UploadTransition::Begin, landed] {
        let answer = engine.transition_recording("r1", &transition, 0).unwrap();
        assert!(answer.applied, "{transition:?} was refused: {answer:?}");
    }
    assert!(engine.record_upload(&canonical, "i-new").unwrap());
    engine.set_recording_reconciled("r1").unwrap();
    assert!(!engine.record_upload(&canonical, "i-new").unwrap());
    assert_eq!(engine.activity_count(), 1);
    assert_eq!(
        engine.activity_id_for_intervals_id("i-new"),
        Some(canonical.clone())
    );
    assert_eq!(engine.activity_id_for_intervals_id("i-old"), None);
    drop(engine);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    engine.load().unwrap();
    assert_eq!(engine.get_activity_ids(), vec![canonical]);
    let recording = engine.get_recording("r1").unwrap().unwrap();
    assert_eq!(recording.upload_status, "uploaded");
    assert_eq!(recording.intervals_activity_id.as_deref(), Some("i-new"));
    assert!(recording.engine_reconciled);
}
