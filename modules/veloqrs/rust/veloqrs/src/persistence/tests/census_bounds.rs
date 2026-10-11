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

/// Scenario: the census pull carries the whole history on every sync, and
/// almost none of it has changed since the last one.
///
/// Expected behaviour: a row is written only when what upstream says about it
/// moved, so an identical pull writes nothing, and a pull that changes one
/// entry and drops another writes exactly those two rows.
#[test]
fn test_census_rewrites_only_what_changed() {
    fn total_changes(engine: &PersistentEngine) -> i64 {
        engine
            .db
            .query_row("SELECT total_changes()", [], |row| row.get(0))
            .unwrap()
    }
    fn census_ids(engine: &PersistentEngine) -> Vec<String> {
        let mut stmt = engine
            .db
            .prepare("SELECT intervals_id FROM activity_census WHERE athlete_id = 'i1' ORDER BY intervals_id")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    let mut engine = PersistentEngine::in_memory().unwrap();
    let entries: Vec<crate::net::types::ActivityCensusEntry> = (0..500)
        .map(|n| crate::net::types::ActivityCensusEntry {
            id: format!("i{n:04}"),
            start_date_local: Some(format!("2024-01-{:02}T07:00:00", n % 28 + 1)),
            created: Some("2024-02-01T00:00:00Z".into()),
            icu_sync_date: Some("2024-02-01T00:00:00Z".into()),
            has_latlng: n % 2 == 0,
            has_series: n % 3 == 0,
        })
        .collect();
    engine.record_activity_census("i1", &entries).unwrap();
    engine
        .record_activity_census("other", &entries[..3])
        .unwrap();

    let before = total_changes(&engine);
    engine.record_activity_census("i1", &entries).unwrap();
    assert_eq!(
        total_changes(&engine) - before,
        0,
        "an identical census writes nothing"
    );

    let mut changed = entries.clone();
    changed[7].icu_sync_date = Some("2024-03-01T00:00:00Z".into());
    let dropped = changed.remove(11);
    let before = total_changes(&engine);
    engine.record_activity_census("i1", &changed).unwrap();
    assert_eq!(
        total_changes(&engine) - before,
        2,
        "one edit and one departure"
    );

    let ids = census_ids(&engine);
    assert_eq!(ids.len(), 499);
    assert!(
        !ids.contains(&dropped.id),
        "a departed activity leaves the census"
    );
    let sync_date: Option<String> = engine
        .db
        .query_row(
            "SELECT icu_sync_date FROM activity_census WHERE athlete_id = 'i1' AND intervals_id = ?1",
            params![changed[7].id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(sync_date.as_deref(), Some("2024-03-01T00:00:00Z"));
    let others: i64 = engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM activity_census WHERE athlete_id = 'other'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        others, 3,
        "another athlete's census is not this pull's to prune"
    );
}
