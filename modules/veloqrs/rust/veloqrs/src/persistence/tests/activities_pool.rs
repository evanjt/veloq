use super::{GpsPoint, PersistentEngine, RangeCoverage, pooled};

#[test]
fn test_census_coverage_pooled_owed_and_fetched() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let census = crate::net::types::ActivityCensusEntry {
        id: "a1".into(),
        start_date_local: Some("2025-01-15T12:00:00".into()),
        created: None,
        icu_sync_date: Some("v1".into()),
        has_latlng: false,
        has_series: false,
    };
    engine
        .record_activity_census("athlete", &[census])
        .expect("census");
    for athlete in ["athlete", "other"] {
        assert_eq!(
            pooled::window_is_covered(&engine.db, athlete, "2025-01-01", "2025-01-31"),
            engine.window_is_covered(athlete, "2025-01-01", "2025-01-31")
        );
        assert_eq!(
            pooled::range_coverage(&engine.db, athlete, "2025-01-01", "2025-01-31"),
            engine.range_coverage(athlete, "2025-01-01", "2025-01-31")
        );
        assert_eq!(
            pooled::library_coverage(&engine.db, athlete),
            engine.library_coverage(athlete)
        );
    }
    engine
        .store_synced_activity_bodies(
            "athlete",
            &[("a1".into(), 1_736_940_000, "{}".into())],
            &["a1".into()],
            vec![crate::ActivityMetrics {
                activity_id: "a1".into(),
                date: 1_736_940_000,
                ..Default::default()
            }],
        )
        .expect("body and census version");
    assert!(pooled::window_is_covered(
        &engine.db,
        "athlete",
        "2025-01-01",
        "2025-01-31"
    ));
    assert_eq!(
        pooled::range_coverage(&engine.db, "athlete", "2025-01-01", "2025-01-31"),
        RangeCoverage::Loaded
    );
    assert_eq!(pooled::library_coverage(&engine.db, "athlete").fetched, 1);
}

#[test]
fn test_activity_reads_pooled_populated() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let points = vec![GpsPoint::new(46.0, 7.0), GpsPoint::new(46.001, 7.001)];
    engine
        .add_activity("a1".into(), points, "Ride".into())
        .expect("track");
    engine
        .upsert_activity_bodies(&[
            ("a1".into(), 100, "{\"id\":\"a1\"}".into()),
            ("a2".into(), 200, "{\"id\":\"a2\"}".into()),
        ])
        .expect("bodies");

    assert_eq!(
        pooled::activity_body(&engine.db, "a1")
            .expect("read")
            .as_deref(),
        Some("{\"id\":\"a1\"}")
    );
    assert_eq!(
        pooled::gps_track(&engine.db, "a1").map(|track| track.len()),
        Some(2)
    );
    assert_eq!(
        pooled::activity_bodies(&engine.db, 0, 200).expect("bodies"),
        vec!["{\"id\":\"a2\"}", "{\"id\":\"a1\"}"]
    );

    for id in ["a1", "missing"] {
        assert_eq!(
            pooled::activity_body(&engine.db, id).expect("read"),
            engine.get_activity_body(id)
        );
        assert_eq!(
            format!("{:?}", pooled::gps_track(&engine.db, id)),
            format!("{:?}", engine.get_gps_track(id))
        );
    }
    for (oldest, newest) in [(0, 200), (100, 100), (201, 300)] {
        assert_eq!(
            pooled::activity_bodies(&engine.db, oldest, newest).expect("pooled bodies"),
            engine
                .get_activity_bodies(oldest, newest)
                .expect("engine bodies")
        );
    }
}

/// Scenario: a screen reads one stored body while another connection holds the
/// database locked past the reader's wait.
///
/// Expected behaviour: the read fails as a read, so the caller can try again,
/// and is never answered as "nothing stored", which a detail screen takes as
/// a download to wait for that nobody started.
#[test]
fn a_body_read_that_fails_is_an_error_and_not_an_absent_body() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("locked.db");
    let writer = rusqlite::Connection::open(&path).expect("writer");
    writer
        .execute_batch(
            "CREATE TABLE activity_bodies (activity_id TEXT PRIMARY KEY, date INTEGER, raw TEXT);
             INSERT INTO activity_bodies VALUES ('a1', 100, '{\"name\":\"Hill loop\"}');",
        )
        .expect("one stored body");
    let reader = rusqlite::Connection::open(&path).expect("reader");
    reader
        .busy_timeout(std::time::Duration::ZERO)
        .expect("no wait");
    assert_eq!(
        pooled::activity_body(&reader, "a1").expect("an open database reads"),
        Some("{\"name\":\"Hill loop\"}".to_string())
    );

    writer.execute_batch("BEGIN EXCLUSIVE").expect("lock");
    assert!(
        pooled::activity_body(&reader, "a1").is_err(),
        "a locked read must fail, not answer that nothing is stored"
    );
    assert!(pooled::activity_record(&reader, "a1").is_err());
    writer.execute_batch("COMMIT").expect("unlock");

    assert_eq!(
        pooled::activity_body(&reader, "missing").expect("an absent row is not a failure"),
        None
    );
    assert_eq!(
        pooled::activity_record(&reader, "a1")
            .expect("reads again once the lock is gone")
            .and_then(|record| record.name),
        Some("Hill loop".to_string())
    );
}

#[test]
fn metrics_for_ids_answers_every_id_across_the_chunk_boundary() {
    use crate::persistence::activities::pooled as activities;

    let mut engine = PersistentEngine::in_memory().expect("engine");
    let ids: Vec<String> = (0..501).map(|i| format!("m{i:03}")).collect();
    let track: Vec<GpsPoint> = (0..20)
        .map(|i| GpsPoint {
            latitude: 46.0 + i as f64 * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect();
    let batch = ids
        .iter()
        .map(|id| (id.clone(), track.clone(), "Ride".to_string()))
        .collect();
    engine.add_activities_batch(batch).expect("activities");
    engine
        .set_activity_metrics(
            ids.iter()
                .enumerate()
                .map(|(i, id)| crate::ActivityMetrics {
                    activity_id: id.clone(),
                    name: id.clone(),
                    moving_time: i as u32 + 1,
                    sport_type: "Ride".into(),
                    ..Default::default()
                })
                .collect(),
        )
        .expect("metrics");

    let mut wanted = ids.clone();
    wanted.push("absent".into());
    let rows = activities::metrics_for_ids(&engine.db, &wanted);

    assert_eq!(rows.len(), 501);
    assert!(!rows.contains_key("absent"));
    assert_eq!(rows["m000"].moving_time, 1);
    assert_eq!(rows["m500"].moving_time, 501);
    assert_eq!(
        activities::metrics_of(&engine.db, "m250").map(|m| m.moving_time),
        Some(251)
    );
    assert!(activities::metrics_for_ids(&engine.db, &[]).is_empty());
}
