use super::PersistentEngine;
use crate::ActivityMetrics;
use crate::net::types::ActivityCensusEntry;

fn census(version: &str) -> ActivityCensusEntry {
    ActivityCensusEntry {
        id: "a1".into(),
        start_date_local: Some("2025-01-15T12:00:00".into()),
        created: None,
        icu_sync_date: Some(version.into()),
        has_latlng: false,
        has_series: false,
    }
}

fn store(engine: &mut PersistentEngine, raw: &str) {
    engine
        .store_synced_activity_bodies(
            "athlete",
            &[("a1".into(), 1_736_940_000, raw.into())],
            &["a1".into()],
            vec![ActivityMetrics {
                activity_id: "a1".into(),
                date: 1_736_940_000,
                ..Default::default()
            }],
        )
        .expect("synced body");
}

#[test]
fn test_store_synced_activity_bodies_keeps_detail_for_unchanged_census() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .record_activity_census("athlete", &[census("v1")])
        .expect("census");
    let detail = r#"{"id":"a1","icu_athlete_id":"athlete"}"#;
    store(&mut engine, detail);

    store(&mut engine, r#"{"id":"a1"}"#);

    assert_eq!(engine.get_activity_body("a1").as_deref(), Some(detail));
    let owed = engine
        .newest_activities_owing_bodies(1, "watts")
        .expect("owed bodies");
    assert_eq!(owed.len(), 1);
    assert!(!owed[0].detail);
}

#[test]
fn test_store_synced_activity_bodies_replaces_detail_for_changed_census() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .record_activity_census("athlete", &[census("v1")])
        .expect("census");
    store(&mut engine, r#"{"id":"a1","icu_athlete_id":"athlete"}"#);
    engine
        .record_activity_census("athlete", &[census("v2")])
        .expect("changed census");
    let list = r#"{"id":"a1"}"#;

    store(&mut engine, list);

    assert_eq!(engine.get_activity_body("a1").as_deref(), Some(list));
    let owed = engine
        .newest_activities_owing_bodies(1, "watts")
        .expect("owed bodies");
    assert_eq!(owed.len(), 1);
    assert!(owed[0].detail);
}
