use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::net::types::StreamDto;

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let track = (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0,
            elevation: None,
        })
        .collect();
    engine
        .add_activity("a1".into(), track, "Ride".into())
        .unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "INSERT INTO sections
         (id, name, sport_type, section_type, distance_meters, visit_count,
          created_at, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES ('s1', 'Section 1', 'Ride', 'auto', 1000.0, 0, datetime('now'), 0, 0, 0, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO activity_metrics
         (activity_id, name, date, distance, moving_time, elapsed_time,
          elevation_gain, sport_type)
         VALUES ('a1', 'Powered ride', 1767225600, 1000, 300, 300, 0, 'Ride')",
        [],
    )
    .unwrap();
    engine
}

fn watts() -> StreamDto {
    StreamDto {
        kind: "watts".into(),
        data: (0..60).map(|i| Some(100.0 + f64::from(i))).collect(),
        data2: None,
    }
}

fn avg_power(dir: &TempDir) -> Option<f64> {
    Connection::open(dir.path().join("routes.db"))
        .unwrap()
        .query_row(
            "SELECT avg_power FROM section_activities WHERE section_id = 's1'",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn manual_lap_records_mean_power_over_its_traversal() {
    let dir = TempDir::new().unwrap();
    let mut engine = engine(&dir);
    engine.store_activity_streams("a1", &[watts()]).unwrap();
    engine.store_time_streams_flat(&["a1".to_string()], &(0..60).collect::<Vec<u32>>(), &[0]);
    engine
        .insert_section_activity("s1", "a1", &tracematch::Direction::Same, 10, 21, 1000.0)
        .unwrap();

    assert_eq!(avg_power(&dir), Some(115.0));
    let records = engine.get_section_performances("s1").records;
    assert_eq!(records[0].laps[0].avg_power, Some(115.0));
}

#[test]
fn lazy_pass_fills_power_when_the_series_arrives_later() {
    let dir = TempDir::new().unwrap();
    let engine = engine(&dir);
    engine
        .insert_section_activity("s1", "a1", &tracematch::Direction::Same, 10, 21, 1000.0)
        .unwrap();
    engine.store_activity_streams("a1", &[watts()]).unwrap();
    engine.recompute_activity_indicators().unwrap();

    assert_eq!(avg_power(&dir), Some(115.0));
}

#[test]
fn detected_laps_keep_power_across_a_second_apply() {
    let _serial_state = crate::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let track: Vec<GpsPoint> = (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0,
            elevation: None,
        })
        .collect();
    for id in ["a1", "a2", "a3"] {
        engine
            .add_activity(id.into(), track.clone(), "Ride".into())
            .unwrap();
        engine.store_activity_streams(id, &[watts()]).unwrap();
    }

    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap();
    engine.apply_sections_save(sections).unwrap();
    let first = recorded_powers(&dir);
    assert!(!first.is_empty());
    assert!(first.iter().all(Option::is_some));

    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap();
    engine.apply_sections_save(sections).unwrap();
    assert_eq!(recorded_powers(&dir), first);
}

fn recorded_powers(dir: &TempDir) -> Vec<Option<f64>> {
    let conn = Connection::open(dir.path().join("routes.db")).unwrap();
    let mut stmt = conn
        .prepare("SELECT avg_power FROM section_activities ORDER BY section_id, activity_id")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}
