use super::*;

#[test]
fn test_reconcile_keeps_activities_after_census_newest() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    for (id, date) in [("i_old", "2025-01-01"), ("i_future", "2025-01-03")] {
        engine
            .db
            .execute(
                "INSERT INTO activities (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                 VALUES (?1, ?1, 'Ride', 0, 0, 0, 0, unixepoch(?2))",
                params![id, date],
            )
            .unwrap();
    }

    let removed = engine.reconcile_against_census(&["i_present".to_string()], "2025-01-02");
    assert_eq!(removed, vec!["i_old".to_string()]);
    assert!(
        engine
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM activities WHERE id = 'i_future')",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap()
    );
}

#[test]
fn test_reconcile_uses_body_date_when_track_metadata_has_no_date() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine.db.execute(
        "INSERT INTO activities (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng)
         VALUES ('i_future', 'i_future', 'Ride', 0, 0, 0, 0)", [],
    ).unwrap();
    engine
        .upsert_activity_bodies(&[(
            "i_future".into(),
            chrono::NaiveDate::from_ymd_opt(2025, 1, 3)
                .unwrap()
                .and_hms_opt(8, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp(),
            "{}".into(),
        )])
        .unwrap();

    let removed = engine.reconcile_against_census(&["i_present".to_string()], "2025-01-02");
    assert!(removed.is_empty());
}
