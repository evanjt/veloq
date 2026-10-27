use super::{PersistentEngine, pooled};

const DAY: i64 = 86_400;
const NOW: i64 = 1_900_000_000;

/// A list body carrying every key a feed card draws, and one it does not.
const FULL: &str = r#"{"id":"i501","name":"Ridge traverse","type":"GravelRide",
    "start_date_local":"2026-03-14T07:05:09","distance":42195.5,"moving_time":5400,
    "total_elevation_gain":812.4,"average_heartrate":143.6,"icu_average_watts":211.7,
    "icu_training_load":96.2,"calories":1234.0,"has_weather":true,
    "average_weather_temp":17.5,"skyline_chart_bytes":"AQID",
    "stream_types":["latlng","time"],"icu_intensity":0.81}"#;

fn query(needle: &str, offset: u32, limit: Option<u32>) -> crate::FfiActivityBodiesQuery {
    crate::FfiActivityBodiesQuery {
        oldest_ts: None,
        newest_ts: None,
        needle: needle.into(),
        sport_families: Vec::new(),
        offset,
        limit,
    }
}

fn store(engine: &mut PersistentEngine, rows: &[(&str, i64, &str)]) {
    let rows: Vec<(String, i64, String)> = rows
        .iter()
        .map(|(key, date, raw)| (key.to_string(), *date, raw.to_string()))
        .collect();
    engine
        .upsert_activity_bodies_with_metrics(&rows)
        .expect("bodies");
}

/// Scenario: the feed draws its cards from a typed record rather than
/// parsing every stored body, and some bodies carry no sport and no streams.
///
/// Expected behaviour: every field the card draws comes through as the body
/// carries it, a body with no sport stays without one rather than reading as
/// a ride, only a `latlng` stream counts as GPS, an `altitude` stream marks a
/// zero climb as measured, and a duration stored with a fraction is rounded
/// rather than costing the card.
#[test]
fn test_feed_cards_carry_every_card_field_from_the_stored_body() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(
        &mut engine,
        &[
            ("i501", NOW, FULL),
            ("i502", NOW - DAY, r#"{"id":"i502","moving_time":1200.6}"#),
            (
                "i503",
                NOW - 2 * DAY,
                r#"{"id":"i503","type":"Ride","total_elevation_gain":0.0,
                    "stream_types":["altitude","time"]}"#,
            ),
        ],
    );

    let page = pooled::feed_card_page(&engine.db, &query("", 0, None)).expect("page");
    assert_eq!(page.matched_count, 3);
    assert!(!page.has_more);
    assert_eq!(
        page.cards[0],
        crate::FfiFeedCard {
            id: "i501".into(),
            intervals_web_id: Some("i501".into()),
            sport_type: Some("GravelRide".into()),
            name: "Ridge traverse".into(),
            start_date_local: "2026-03-14T07:05:09".into(),
            distance: Some(42195.5),
            moving_time: Some(5400.0),
            elevation_gain: Some(812.4),
            avg_hr: Some(143.6),
            avg_power: Some(211.7),
            training_load: Some(96.2),
            calories: Some(1234.0),
            has_weather: true,
            average_weather_temp: Some(17.5),
            skyline_chart_bytes: Some("AQID".into()),
            has_gps: true,
            has_altitude: false,
            sync_failure: None,
            stub: crate::net::garmin_swap::FfiStubVerdict::NotStub,
        }
    );

    let bare = &page.cards[1];
    assert_eq!(bare.id, "i502");
    assert_eq!(bare.sport_type, None);
    assert_eq!(bare.name, "");
    assert_eq!(bare.start_date_local, "");
    assert_eq!(bare.moving_time, Some(1201.0));
    assert_eq!(bare.distance, None);
    assert!(!bare.has_gps);
    assert!(!bare.has_altitude);
    assert!(!bare.has_weather);
    assert_eq!(bare.skyline_chart_bytes, None);

    let climb = &page.cards[2];
    assert!(climb.has_altitude);
    assert!(!climb.has_gps);
    assert_eq!(climb.elevation_gain, Some(0.0));
}

/// Scenario: a ride recorded here was uploaded and the next sync stored the
/// server's body, which names the server's id, under the device key. A demo
/// row sits beside it.
///
/// Expected behaviour: the card is named by the row key, so a tap opens the
/// row that holds the ride, and its web link names the server's id. The demo
/// card has no web link.
#[test]
fn test_feed_card_is_named_by_its_row_key_and_carries_the_web_link() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(
        &mut engine,
        &[
            ("local-ride-1", NOW, r#"{"id":"local-ride-1"}"#),
            (
                "demo-ride-1",
                NOW - DAY,
                r#"{"id":"demo-ride-1","type":"Ride"}"#,
            ),
        ],
    );
    assert!(engine.record_upload("local-ride-1", "i900").unwrap());
    store(
        &mut engine,
        &[("local-ride-1", NOW, r#"{"id":"i900","type":"Ride"}"#)],
    );

    let page = pooled::feed_card_page(&engine.db, &query("", 0, None)).expect("page");
    let named: Vec<(&str, Option<&str>)> = page
        .cards
        .iter()
        .map(|c| (c.id.as_str(), c.intervals_web_id.as_deref()))
        .collect();
    assert_eq!(
        named,
        vec![("local-ride-1", Some("i900")), ("demo-ride-1", None)]
    );
}

/// Scenario: a feed search pages over typed cards, and one stored row will
/// not parse.
///
/// Expected behaviour: the search, the count and the paging are the body
/// read's, and the corrupt row is left off the page rather than failing it.
/// Unfiltered it still counts, so the offsets of the pages after it hold.
#[test]
fn test_feed_card_search_pages_like_the_body_read_and_skips_a_corrupt_row() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(
        &mut engine,
        &[
            (
                "i601",
                NOW,
                r#"{"id":"i601","name":"Tuesday club spin","type":"VirtualRide"}"#,
            ),
            (
                "i602",
                NOW - DAY,
                r#"{"id":"i602","name":"Harbour loop","type":"Run"}"#,
            ),
            (
                "i603",
                NOW - 2 * DAY,
                r#"{"id":"i603","name":"Tuesday club spin","type":"Ride"}"#,
            ),
            (
                "i604",
                NOW - 3 * DAY,
                r#"{"id":"i604","name":"Tuesday club spin","type":"Ride"}"#,
            ),
        ],
    );
    engine
        .db
        .execute(
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES ('broken', ?1, '{not json')",
            [NOW - DAY / 2],
        )
        .unwrap();

    let first = pooled::feed_card_page(&engine.db, &query("CLUB", 0, Some(2))).expect("page");
    let ids: Vec<&str> = first.cards.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["i601", "i603"]);
    assert_eq!(first.matched_count, 3);
    assert!(first.has_more);
    assert_eq!(first.cards[0].sport_type.as_deref(), Some("VirtualRide"));

    let second = pooled::feed_card_page(&engine.db, &query("club", 2, Some(2))).expect("page");
    let ids: Vec<&str> = second.cards.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["i604"]);
    assert!(!second.has_more);

    let window = pooled::feed_card_page(&engine.db, &query("", 0, None)).expect("page");
    let ids: Vec<&str> = window.cards.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["i601", "i602", "i603", "i604"]);
    assert_eq!(window.matched_count, 5);
}

/// Scenario: intervals.icu holds three activities it does not serve in full
/// and one it does. One stub names a Garmin id, one names a non-numeric id,
/// one carries another source.
///
/// Expected behaviour: with a key held the Garmin-id stub is updatable, and
/// without one it points at the connector. A stub from another source or with
/// an id that is not Garmin's is never offered an update, whatever the key. A
/// served activity is not a stub.
#[test]
fn test_feed_card_carries_one_stub_verdict_from_the_body_and_the_key() {
    use crate::net::garmin_swap::FfiStubVerdict::*;
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(
        &mut engine,
        &[
            (
                "i601",
                NOW,
                r#"{"id":"i601","_note":"stub","source":"GARMIN_CONNECT","external_id":"123456"}"#,
            ),
            (
                "i602",
                NOW - DAY,
                r#"{"id":"i602","_note":"stub","source":"GARMIN_CONNECT","external_id":"abc"}"#,
            ),
            (
                "i603",
                NOW - 2 * DAY,
                r#"{"id":"i603","_note":"stub","source":"STRAVA","external_id":"123456"}"#,
            ),
            (
                "i604",
                NOW - 3 * DAY,
                r#"{"id":"i604","source":"GARMIN_CONNECT","external_id":"123456"}"#,
            ),
        ],
    );

    let verdicts = |key_held: bool| -> Vec<_> {
        pooled::feed_card_page_with_key(&engine.db, &query("", 0, None), key_held)
            .expect("page")
            .cards
            .iter()
            .map(|c| c.stub)
            .collect()
    };
    assert_eq!(
        verdicts(true),
        vec![GarminUpdatable, OtherSource, OtherSource, NotStub]
    );
    assert_eq!(
        verdicts(false),
        vec![NoKey, OtherSource, OtherSource, NotStub]
    );
}
