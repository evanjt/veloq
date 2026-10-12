use super::current_prs_on;
use crate::persistence::PersistentEngine;
use crate::persistence::fitness::performances::{laps, pooled};
use crate::persistence::sections::queries;
use tracematch::GpsPoint;

#[test]
fn test_section_reads_use_the_synced_activity_sport() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let track: Vec<GpsPoint> = (0..8)
        .map(|index| GpsPoint {
            latitude: 46.2 + f64::from(index) * 0.001,
            longitude: 7.3,
            elevation: None,
        })
        .collect();
    for (id, date) in [("outing", 1_700_000_000), ("rival", 1_700_100_000)] {
        engine
            .add_activity(id.to_string(), track.clone(), "Ride".to_string())
            .expect("activity");
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                    elapsed_time, elevation_gain, sport_type)
                 VALUES (?1, 'Morning outing', ?2, 400.0, 200, 200, 0, 'Run')",
                rusqlite::params![id, date],
            )
            .expect("synced metrics");
    }
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at)
             VALUES ('climb', 'auto', 'Climb', 'Ride', '[]', 400.0, 0, 1,
                '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("section");
    for (id, lap_time) in [("outing", 200.0), ("rival", 220.0)] {
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                    start_index, end_index, distance_meters, lap_time, lap_pace, coverage)
                 VALUES ('climb', ?1, 'same', 1, 5, 400.0, ?2, 400.0 / ?2, 1.0)",
                rusqlite::params![id, lap_time],
            )
            .expect("traversal");
    }

    let records = current_prs_on(&engine.db, "climb");
    let held: Vec<_> = records.keys().collect();
    assert_eq!(held, vec![&("Run".to_string(), "same".to_string())]);
    assert_eq!(
        records[&("Run".to_string(), "same".to_string())].0,
        "outing"
    );
    assert_eq!(
        laps::sports(&engine.db, "climb"),
        vec![("Run".to_string(), 2)]
    );
    assert_eq!(
        pooled::section_performances(&engine.db, "climb", Some("Run"))
            .records
            .len(),
        2
    );
    assert!(
        pooled::section_performances(&engine.db, "climb", Some("Ride"))
            .records
            .is_empty()
    );
    assert!(queries::pooled::supported_section_ids(&engine.db, Some("Run"), 1).contains("climb"));
    assert!(!queries::pooled::supported_section_ids(&engine.db, Some("Ride"), 1).contains("climb"));
}

/// A traversal of `climb` by `activity`, taking `lap_time` seconds.
fn traverse(engine: &PersistentEngine, activity: &str, lap_time: f64) {
    engine
        .db
        .execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                start_index, end_index, distance_meters, lap_time, lap_pace, coverage)
             VALUES ('climb', ?1, 'same', 1, 5, 400.0, ?2, 2.0, 1.0)",
            rusqlite::params![activity, lap_time],
        )
        .expect("traversal");
}

/// Scenario: three outings cross one section as rides. A sync retypes the
/// fastest one upstream, which rewrites its metrics row and leaves the
/// activity row's sport as it was stored. One more ride has no metrics row.
///
/// Expected behaviour: the feed badges judge the retyped lap among its new
/// sport, as the ledger does, so it earns nothing alone there and the two
/// remaining rides, one of them read through its activity row, share the
/// record and the trend between them.
#[test]
fn test_indicators_group_a_retyped_activity_under_its_synced_sport() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let track: Vec<GpsPoint> = (0..8)
        .map(|index| GpsPoint {
            latitude: 46.2 + f64::from(index) * 0.001,
            longitude: 7.3,
            elevation: None,
        })
        .collect();
    for id in ["steady", "gravel", "commute"] {
        engine
            .add_activity(id.to_string(), track.clone(), "Ride".to_string())
            .expect("activity");
    }
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at)
             VALUES ('climb', 'auto', 'Climb', 'Ride', '[]', 400.0, 0, 1,
                '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("section");
    traverse(&engine, "steady", 220.0);
    traverse(&engine, "gravel", 150.0);
    traverse(&engine, "commute", 200.0);

    let metrics = |id: &str, date: i64, sport: &str| crate::ActivityMetrics {
        activity_id: id.to_string(),
        name: id.to_string(),
        date,
        distance: 400.0,
        moving_time: 200,
        elapsed_time: 200,
        sport_type: sport.to_string(),
        ..Default::default()
    };
    engine
        .set_activity_metrics(vec![
            metrics("steady", 1_700_000_000, "Ride"),
            metrics("gravel", 1_700_100_000, "Ride"),
        ])
        .expect("first sync");
    engine
        .set_activity_metrics(vec![metrics("gravel", 1_700_100_000, "GravelRide")])
        .expect("retype");
    for (id, start) in [
        ("commute", 1_699_000_000),
        ("steady", 1_700_000_000),
        ("gravel", 1_700_100_000),
    ] {
        engine
            .db
            .execute(
                "UPDATE activities SET start_date = ?2 WHERE id = ?1",
                rusqlite::params![id, start],
            )
            .expect("start date");
    }
    engine.recompute_activity_indicators().expect("indicators");

    let prs = current_prs_on(&engine.db, "climb");
    let held: Vec<_> = prs.keys().collect();
    assert_eq!(held, vec![&("Ride".to_string(), "same".to_string())]);
    assert_eq!(prs[&("Ride".to_string(), "same".to_string())].0, "commute");

    let ids = ["steady", "gravel", "commute"].map(String::from);
    let indicators = engine.get_activity_indicators(&ids);
    assert!(
        indicators.iter().all(|i| i.activity_id != "gravel"),
        "a lone GravelRide lap earns no badge: {indicators:?}"
    );
    let record: Vec<_> = indicators
        .iter()
        .filter(|i| i.indicator_type == "section_pr")
        .map(|i| i.activity_id.as_str())
        .collect();
    assert_eq!(record, vec!["commute"]);
    assert!(
        indicators
            .iter()
            .any(|i| i.activity_id == "steady" && i.indicator_type == "section_trend")
    );
}
