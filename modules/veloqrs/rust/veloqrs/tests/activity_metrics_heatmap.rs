use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::{ActivityMetrics, FfiActivityBody, FfiActivityMetrics, PersistentEngine};

fn metric(id: &str, date: i64, moving_time: u32) -> ActivityMetrics {
    ActivityMetrics {
        activity_id: id.into(),
        name: "Ride".into(),
        date,
        moving_time,
        sport_type: "Ride".into(),
        ..ActivityMetrics::default()
    }
}

fn day(conn: &Connection, date: &str) -> Option<(i64, i64, i64)> {
    conn.query_row(
        "SELECT intensity, max_duration, activity_count FROM activity_heatmap WHERE date = ?",
        [date],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .ok()
}

#[test]
fn test_metrics_writers_recompute_heatmap_on_rewrite_and_removal() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("metrics.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let conn = Connection::open(&path).unwrap();
    let first = metric("a1", 1_704_067_200, 7_300);
    let second = metric("a2", 1_704_070_800, 3_500);

    engine
        .set_activity_metrics(vec![first.clone(), second])
        .unwrap();
    assert_eq!(day(&conn, "2024-01-01"), Some((4, 7_300, 2)));

    engine
        .set_activity_metrics_extended(vec![FfiActivityMetrics::from(first.clone())])
        .unwrap();
    assert_eq!(day(&conn, "2024-01-01"), Some((4, 7_300, 2)));

    engine
        .set_activity_metrics(vec![metric("a1", first.date, 2_000)])
        .unwrap();
    assert_eq!(day(&conn, "2024-01-01"), Some((1, 3_500, 2)));

    engine
        .set_activity_metrics(vec![metric("a1", 1_704_153_600, 2_000)])
        .unwrap();
    assert_eq!(day(&conn, "2024-01-01"), Some((1, 3_500, 1)));
    assert_eq!(day(&conn, "2024-01-02"), Some((1, 2_000, 1)));

    engine.remove_activity("a2").unwrap();
    assert_eq!(day(&conn, "2024-01-01"), None);
    engine.remove_activity("a1").unwrap();
    assert_eq!(day(&conn, "2024-01-02"), None);
}

#[test]
fn test_body_upsert_derives_metrics_using_the_local_id_and_power_precedence() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("body.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let raw = r#"{"id":"server-id","name":"Indoor ride","type":"Ride","moving_time":3700,"elapsed_time":3800,"distance":30000,"average_watts":205,"icu_average_watts":212,"icu_ftp":260,"icu_zone_times":[{"secs":10},{"secs":20}]}"#;

    engine
        .upsert_activity_bodies_with_metrics(&[("local-one".into(), 1_704_067_200, raw.into())])
        .unwrap();

    let conn = Connection::open(&path).unwrap();
    let stored: (i64, i64, i64, f64, i64) = conn.query_row(
        "SELECT avg_power, ftp, moving_time, power_z2, date FROM activity_metrics WHERE activity_id = 'local-one'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).unwrap();
    assert_eq!(stored, (212, 260, 3700, 20.0, 1_704_067_200));
    assert_eq!(day(&conn, "2024-01-01"), Some((2, 3700, 1)));
    assert!(
        engine
            .upsert_activity_bodies_with_metrics(&[
                ("good".into(), 1, raw.into()),
                ("bad".into(), 1, "{".into())
            ])
            .is_err()
    );
    assert!(engine.get_activity_body("good").is_none());
}

#[test]
fn test_provisional_body_derives_metrics_before_commit() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("provisional.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let body = FfiActivityBody {
        activity_id: "local-two".into(),
        date: 1_704_067_200.0,
        raw: r#"{"id":"server-id","name":"Ride","type":"Ride","moving_time":3700,"average_watts":205,"icu_average_watts":212}"#.into(),
    };

    engine
        .save_provisional_activity("local-two", Vec::new(), &body)
        .unwrap();

    let conn = Connection::open(&path).unwrap();
    let power: i64 = conn
        .query_row(
            "SELECT avg_power FROM activity_metrics WHERE activity_id = 'local-two'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(power, 212);
    assert_eq!(day(&conn, "2024-01-01"), Some((2, 3700, 1)));
}

/// Scenario: a developer clones an activity to load the engine, and the
/// training calendar is read from `activity_heatmap`.
///
/// Expected behaviour: the clones go through the metrics writer, so the
/// calendar counts them, and each clone's activity row carries its name,
/// distance and duration as a synced one does.
#[test]
fn test_cloned_activities_reach_the_heatmap_and_their_activity_rows() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("metrics.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let track: Vec<veloqrs::GpsPoint> = (0..3)
        .map(|i| veloqrs::GpsPoint {
            latitude: 46.2 + f64::from(i) * 0.01,
            longitude: 7.3 + f64::from(i) * 0.01,
            elevation: None,
        })
        .collect();
    engine
        .add_activity("src".into(), track, "Ride".into())
        .unwrap();
    engine
        .set_activity_metrics(vec![ActivityMetrics {
            distance: 42_000.0,
            ..metric("src", 1_704_067_200, 5_500)
        }])
        .unwrap();

    assert_eq!(engine.debug_clone_activity("src", 2), 2);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(day(&conn, "2024-01-01"), Some((3, 5_500, 3)));
    // id, name, distance, duration
    type CloneRow = (String, Option<String>, Option<f64>, Option<f64>);
    let rows: Vec<CloneRow> = conn
        .prepare(
            "SELECT id, name, distance_meters, duration_secs FROM activities
             WHERE id LIKE 'src_clone_%' ORDER BY id",
        )
        .unwrap()
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(rows.len(), 2);
    for (id, name, distance, duration) in rows {
        assert_eq!(name.as_deref(), Some("Ride"), "{id}");
        assert_eq!(distance, Some(42_000.0), "{id}");
        assert_eq!(duration, Some(5_500.0), "{id}");
    }
}
