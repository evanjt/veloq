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

/// Scenario: a ride recorded here is uploaded, and the next sync stores the
/// server's body for it, which names the server's id, under the device key.
///
/// Expected behaviour: the feed page answers the device key for that body,
/// so a card navigates to the row that holds the ride.
#[test]
fn test_feed_page_answers_the_row_key_for_a_synced_upload() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .upsert_activity_bodies(&[(
            "local-ride-1".into(),
            1_736_940_000,
            r#"{"id":"local-ride-1"}"#.into(),
        )])
        .expect("provisional body");
    assert!(engine.record_upload("local-ride-1", "i900").unwrap());
    engine
        .store_synced_activity_bodies(
            "athlete",
            &[(
                "local-ride-1".into(),
                1_736_940_000,
                r#"{"id":"i900","type":"Ride"}"#.into(),
            )],
            &["i900".into()],
            vec![ActivityMetrics {
                activity_id: "local-ride-1".into(),
                date: 1_736_940_000,
                ..Default::default()
            }],
        )
        .expect("synced body");

    let page = super::pooled::feed_card_page(
        &engine.db,
        &crate::FfiActivityBodiesQuery {
            oldest_ts: None,
            newest_ts: None,
            needle: String::new(),
            sport_families: Vec::new(),
            offset: 0,
            limit: None,
        },
    )
    .expect("page");

    let ids: Vec<&str> = page.cards.iter().map(|card| card.id.as_str()).collect();
    assert_eq!(ids, vec!["local-ride-1"]);
    assert_eq!(page.cards[0].sport_type.as_deref(), Some("Ride"));
    assert_eq!(page.cards[0].intervals_web_id.as_deref(), Some("i900"));
}
