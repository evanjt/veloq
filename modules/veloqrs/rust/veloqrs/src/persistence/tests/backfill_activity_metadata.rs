use rusqlite::params;

use super::*;

fn seed_metrics_before_activity(
    engine: &PersistentEngine,
    start_date: Option<i64>,
    name: Option<&str>,
    measurements_present: bool,
) {
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics
         (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain, sport_type)
         VALUES ('ride-1', 'Metrics ride', 1700000000, 12500, 2700, 2800, 100, 'Ride')",
            [],
        )
        .unwrap();
    engine.db.execute(
        "INSERT INTO activities
         (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date, name, distance_meters, duration_secs)
         VALUES ('ride-1', 'Ride', 0, 0, 0, 0, ?1, ?2, ?3, ?4)",
        params![start_date, name, measurements_present.then_some(12500.0), measurements_present.then_some(2700)],
    ).unwrap();
}

fn reopened_activity(
    start_date: Option<i64>,
    name: Option<&str>,
    measurements_present: bool,
) -> (Option<i64>, Option<String>) {
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    seed_metrics_before_activity(&engine, start_date, name, measurements_present);
    drop(engine);

    engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    engine.load().unwrap();
    engine
        .db
        .query_row(
            "SELECT start_date, name FROM activities WHERE id = 'ride-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

#[test]
fn test_reopen_backfills_missing_activity_date_and_name_from_metrics() {
    assert_eq!(
        reopened_activity(None, None, true),
        (Some(1_700_000_000), Some("Metrics ride".into()))
    );
}

#[test]
fn test_reopen_backfills_name_when_date_and_measurements_exist() {
    assert_eq!(
        reopened_activity(Some(1_700_001_000), None, true),
        (Some(1_700_001_000), Some("Metrics ride".into()))
    );
}

#[test]
fn test_reopen_keeps_imported_activity_date_and_name() {
    assert_eq!(
        reopened_activity(Some(1_700_001_000), Some("Imported ride"), false),
        (Some(1_700_001_000), Some("Imported ride".into()))
    );
}

fn activity_stored_after_metrics(
    seed: impl FnOnce(&PersistentEngine),
) -> (Option<i64>, Option<String>) {
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics
         (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain, sport_type)
         VALUES ('ride-1', 'Metrics ride', 1700000000, 12500, 2700, 2800, 100, 'Ride')",
            [],
        )
        .unwrap();
    seed(&engine);
    let coords = vec![
        GpsPoint::new(46.52, 6.63),
        GpsPoint::new(46.53, 6.64),
        GpsPoint::new(46.54, 6.65),
    ];
    engine
        .add_activity("ride-1".into(), coords, "Ride".into())
        .unwrap();
    engine
        .db
        .query_row(
            "SELECT start_date, name FROM activities WHERE id = 'ride-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

#[test]
fn test_activity_stored_after_its_metrics_takes_date_and_name_in_the_same_session() {
    assert_eq!(
        activity_stored_after_metrics(|_| {}),
        (Some(1_700_000_000), Some("Metrics ride".into()))
    );
}

#[test]
fn test_activity_reingested_after_metrics_keeps_its_imported_date_and_name() {
    assert_eq!(
        activity_stored_after_metrics(|engine| {
            engine
                .db
                .execute(
                    "INSERT INTO activities
                     (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date, name)
                     VALUES ('ride-1', 'Ride', 0, 0, 0, 0, 1700001000, 'Imported ride')",
                    [],
                )
                .unwrap();
        }),
        (Some(1_700_001_000), Some("Imported ride".into()))
    );
}
