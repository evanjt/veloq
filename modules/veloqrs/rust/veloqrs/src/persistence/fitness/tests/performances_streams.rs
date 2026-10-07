use rusqlite::params;

use super::PersistentEngine;

fn seed_activity(engine: &PersistentEngine, id: &str, track_len: Option<usize>) {
    engine
        .db
        .execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?, 'Ride', 46.0, 46.1, 7.0, 7.1)",
            params![id],
        )
        .unwrap();
    if let Some(track_len) = track_len {
        engine
            .db
            .execute(
                "INSERT INTO gps_tracks (activity_id, track_data, point_count)
                 VALUES (?, X'00', ?)",
                params![id, track_len],
            )
            .unwrap();
    }
}

fn seed_portion(engine: &PersistentEngine, activity_id: &str, lap_time: Option<f64>) {
    engine
        .db
        .execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                start_index, end_index, distance_meters, lap_time)
             VALUES ('section', ?, 'same', 1, 30, 400.0, ?)",
            params![activity_id, lap_time],
        )
        .unwrap();
}

#[test]
fn test_get_activities_needing_time_streams_lists_legacy_mismatch() {
    let engine = PersistentEngine::in_memory().unwrap();
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('section', 'auto', 'Section', 'Ride', '[]', 400.0, 0, 1,
                '2026-01-01T00:00:00Z', 46.0, 46.1, 7.0, 7.1)",
            [],
        )
        .unwrap();

    for id in ["mismatch", "matching", "empty", "missing", "excluded"] {
        seed_activity(&engine, id, Some(40));
    }
    engine
        .store_time_stream("mismatch", &(0..43).collect::<Vec<u32>>())
        .unwrap();
    engine
        .store_time_stream("matching", &(0..40).collect::<Vec<u32>>())
        .unwrap();
    engine.store_time_stream("empty", &[]).unwrap();
    engine
        .store_time_stream("excluded", &(0..43).collect::<Vec<u32>>())
        .unwrap();
    seed_portion(&engine, "mismatch", Some(30.0));
    seed_portion(&engine, "matching", None);
    seed_portion(&engine, "empty", None);
    seed_portion(&engine, "missing", None);
    seed_portion(&engine, "excluded", None);
    engine
        .db
        .execute(
            "UPDATE section_activities SET excluded = 1 WHERE activity_id = 'excluded'",
            [],
        )
        .unwrap();

    let mut actual = engine.get_activities_needing_time_streams();
    actual.sort();
    assert_eq!(actual, ["mismatch", "missing"]);
}

#[test]
fn test_store_time_streams_flat_rejects_mismatched_track_length() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    seed_activity(&engine, "activity", Some(40));

    engine.store_time_streams_flat(
        &["activity".to_string()],
        &(0..43).collect::<Vec<u32>>(),
        &[0],
    );

    assert!(engine.load_time_stream("activity").is_none());
    assert!(!engine.time_streams.contains(&"activity".to_string()));
}

#[test]
fn test_store_time_streams_flat_rejects_mismatch_after_matching_stream() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    seed_activity(&engine, "activity", Some(40));
    let matching: Vec<u32> = (0..40).collect();
    let mismatched: Vec<u32> = (0..43).collect();
    let ids = ["activity".to_string()];

    engine.store_time_streams_flat(&ids, &matching, &[0]);
    engine.store_time_streams_flat(&ids, &mismatched, &[0]);

    assert_eq!(engine.load_time_stream("activity"), Some(matching.clone()));
    assert_eq!(
        engine.time_streams.get(&"activity".to_string()),
        Some(&matching)
    );
}

#[test]
fn test_store_time_streams_flat_accepts_matching_track_length() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    seed_activity(&engine, "activity", Some(40));
    let times: Vec<u32> = (0..40).collect();

    engine.store_time_streams_flat(&["activity".to_string()], &times, &[0]);

    assert_eq!(engine.load_time_stream("activity"), Some(times));
}

#[test]
fn test_store_time_streams_flat_accepts_empty_stream() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    seed_activity(&engine, "activity", Some(40));

    engine.store_time_streams_flat(&["activity".to_string()], &[], &[0]);

    assert_eq!(engine.load_time_stream("activity"), Some(Vec::new()));
}

#[test]
fn test_store_time_streams_flat_accepts_activity_without_track() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    seed_activity(&engine, "activity", None);

    engine.store_time_streams_flat(&["activity".to_string()], &[0, 5], &[0]);

    assert_eq!(engine.load_time_stream("activity"), Some(vec![0, 5]));
}

#[test]
fn test_store_time_streams_flat_reports_only_persisted_ids() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    seed_activity(&engine, "good", Some(3));
    seed_activity(&engine, "full-disk", Some(3));
    engine
        .db
        .execute_batch(
            "CREATE TRIGGER refuse_stream BEFORE INSERT ON time_streams
             WHEN NEW.activity_id = 'full-disk'
             BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
        )
        .unwrap();
    let ids = ["good".to_string(), "full-disk".to_string()];

    let persisted = engine.store_time_streams_flat(&ids, &[0, 1, 2, 0, 1, 2], &[0, 3]);

    assert_eq!(persisted, ["good"]);
    assert!(engine.load_time_stream("full-disk").is_none());
}

#[test]
fn test_set_time_streams_flat_reports_nothing_for_a_refused_insert() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    seed_activity(&engine, "a", Some(3));
    engine
        .db
        .execute_batch(
            "CREATE TRIGGER refuse_stream BEFORE INSERT ON time_streams
             BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
        )
        .unwrap();

    assert!(
        engine
            .set_time_streams_flat(&["a".to_string()], &[0, 1, 2], &[0])
            .is_empty()
    );
}
