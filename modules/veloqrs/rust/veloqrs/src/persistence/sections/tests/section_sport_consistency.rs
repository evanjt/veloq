use super::current_prs_on;
use crate::persistence::PersistentEngine;
use crate::persistence::fitness::performances::{laps, pooled};
use crate::persistence::sections::queries;
use tracematch::GpsPoint;

#[test]
fn test_section_reads_use_the_synced_activity_sport() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let track = (0..8)
        .map(|index| GpsPoint {
            latitude: 46.2 + f64::from(index) * 0.001,
            longitude: 7.3,
            elevation: None,
        })
        .collect();
    engine
        .add_activity("outing".to_string(), track, "Ride".to_string())
        .expect("activity");
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                elapsed_time, elevation_gain, sport_type)
             VALUES ('outing', 'Morning outing', 1700000000, 400.0, 200, 200, 0, 'Run')",
            [],
        )
        .expect("synced metrics");
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
    engine
        .db
        .execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                start_index, end_index, distance_meters, lap_time, lap_pace, coverage)
             VALUES ('climb', 'outing', 'same', 1, 5, 400.0, 200.0, 2.0, 1.0)",
            [],
        )
        .expect("traversal");

    assert_eq!(current_prs_on(&engine.db, "climb")["Run"].0, "outing");
    assert_eq!(
        laps::sports(&engine.db, "climb"),
        vec![("Run".to_string(), 1)]
    );
    assert_eq!(
        pooled::section_performances(&engine.db, "climb", Some("Run"))
            .records
            .len(),
        1
    );
    assert!(
        pooled::section_performances(&engine.db, "climb", Some("Ride"))
            .records
            .is_empty()
    );
    assert!(queries::pooled::supported_section_ids(&engine.db, Some("Run"), 1).contains("climb"));
    assert!(!queries::pooled::supported_section_ids(&engine.db, Some("Ride"), 1).contains("climb"));
}
