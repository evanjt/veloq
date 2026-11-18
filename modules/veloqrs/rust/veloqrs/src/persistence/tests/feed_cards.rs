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
        min_distance: None,
        max_distance: None,
        min_moving_time: None,
        max_moving_time: None,
        sort: None,
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
            metrics_source: None,
            calories: Some(1234.0),
            has_weather: true,
            average_weather_temp: Some(17.5),
            skyline_chart_bytes: Some("AQID".into()),
            has_gps: true,
            has_altitude: false,
            sync_failure: None,
            stub: crate::net::garmin_swap::FfiStubVerdict::NotStub,
            heatmap_hidden: false,
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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

/// Scenario: the activities table marks the rows the athlete hid from the
/// heatmap, and a hidden id may also name an activity the library does not
/// hold.
///
/// Expected behaviour: only the cards of hidden activities read
/// `heatmap_hidden`, showing the activity again clears it, and a hidden id
/// with no stored body adds no card.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_feed_card_carries_whether_its_activity_is_hidden_from_the_heatmap() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(
        &mut engine,
        &[
            ("i601", NOW, r#"{"id":"i601","type":"Ride"}"#),
            ("i602", NOW - DAY, r#"{"id":"i602","type":"Ride"}"#),
            ("i603", NOW - 2 * DAY, r#"{"id":"i603","type":"Run"}"#),
        ],
    );
    engine.set_heatmap_hidden("i602", true).expect("hide");
    engine.set_heatmap_hidden("gone", true).expect("hide");

    let hidden_flags = |engine: &PersistentEngine| -> Vec<(String, bool)> {
        pooled::feed_card_page(&engine.db, &query("", 0, None))
            .expect("page")
            .cards
            .into_iter()
            .map(|c| (c.id, c.heatmap_hidden))
            .collect()
    };
    assert_eq!(
        hidden_flags(&engine),
        vec![
            ("i601".to_string(), false),
            ("i602".to_string(), true),
            ("i603".to_string(), false),
        ]
    );

    engine.set_heatmap_hidden("i602", false).expect("show");
    assert!(hidden_flags(&engine).iter().all(|(_, hidden)| !hidden));
}

/// Scenario: three activities share a name, and the feed narrows by name,
/// sport, distance and moving time together. One body has no metrics row and
/// carries its distance only in its payload.
///
/// Expected behaviour: every bound narrows every other filter, a bound equal
/// to the stored value matches, the sport chip counts narrow by the same
/// bounds, and a body without a metrics row is matched by its payload.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_feed_card_distance_and_duration_bounds_narrow_with_name_and_sport() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(
        &mut engine,
        &[
            (
                "i1",
                NOW,
                r#"{"id":"i1","name":"Loop","type":"Ride","distance":10000,"moving_time":1800}"#,
            ),
            (
                "i2",
                NOW - DAY,
                r#"{"id":"i2","name":"Loop","type":"Ride","distance":50000,"moving_time":7200}"#,
            ),
            (
                "i3",
                NOW - 2 * DAY,
                r#"{"id":"i3","name":"Loop","type":"Run","distance":50000,"moving_time":14400}"#,
            ),
        ],
    );
    let ids = |q: &crate::FfiActivityBodiesQuery| -> Vec<String> {
        pooled::feed_card_page(&engine.db, q)
            .expect("page")
            .cards
            .into_iter()
            .map(|card| card.id)
            .collect()
    };

    let mut q = query("loop", 0, None);
    q.sport_families = vec![crate::FfiSportFamily::Ride];
    q.min_distance = Some(20_000.0);
    q.max_moving_time = Some(10_800);
    assert_eq!(ids(&q), ["i2"]);
    let page = pooled::feed_card_page(&engine.db, &q).expect("page");
    assert_eq!(page.matched_count, 1);

    q.sport_families = Vec::new();
    assert_eq!(
        pooled::family_counts(&engine.db, &q).expect("counts"),
        vec![(crate::FfiSportFamily::Ride, 1)]
    );

    let mut exact = query("", 0, None);
    exact.min_distance = Some(50_000.0);
    exact.max_distance = Some(50_000.0);
    exact.min_moving_time = Some(7_200);
    exact.max_moving_time = Some(7_200);
    assert_eq!(ids(&exact), ["i2"]);

    let mut none = query("", 0, None);
    none.max_distance = Some(9_999.0);
    let page = pooled::feed_card_page(&engine.db, &none).expect("page");
    assert!(page.cards.is_empty());
    assert_eq!(page.matched_count, 0);
    assert!(!page.has_more);

    engine
        .db
        .execute("DELETE FROM activity_metrics WHERE activity_id = 'i1'", [])
        .expect("drop metrics");
    let mut short = query("", 0, None);
    short.max_distance = Some(20_000.0);
    assert_eq!(ids(&short), ["i1"]);
    short.max_moving_time = Some(1_000);
    assert!(ids(&short).is_empty());
}

/// Scenario: the feed's filter bars need the library's span. The library holds
/// a ride, a longer ride, a run, a strength session with neither distance nor
/// time, and a strength session with a duration but no distance.
///
/// Expected behaviour: the dates reach every stored activity, the strength
/// session included, while each distance and duration bound takes only the
/// positive values, so a session with none does not pull a minimum to zero.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_feed_filter_bounds_span_the_library_over_positive_distance_and_time() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(
        &mut engine,
        &[
            (
                "ride-short",
                NOW - 2 * DAY,
                r#"{"id":"ride-short","type":"Ride","name":"Hill","distance":10000.0,"moving_time":1800}"#,
            ),
            (
                "ride-long",
                NOW - DAY,
                r#"{"id":"ride-long","type":"Ride","name":"Coast","distance":50000.0,"moving_time":7200}"#,
            ),
            (
                "run-newest",
                NOW,
                r#"{"id":"run-newest","type":"Run","name":"Track","distance":21097.5,"moving_time":5400}"#,
            ),
            (
                "lift-oldest",
                NOW - 3 * DAY,
                r#"{"id":"lift-oldest","type":"WeightTraining","name":"Legs","distance":0.0,"moving_time":0}"#,
            ),
            (
                "strength-timed",
                NOW - 4 * DAY,
                r#"{"id":"strength-timed","type":"WeightTraining","name":"Core","distance":0.0,"moving_time":900}"#,
            ),
        ],
    );

    let bounds =
        crate::persistence::screens::pooled::feed_filter_bounds(&engine.db).expect("bounds");
    assert_eq!(
        bounds,
        crate::FfiFeedFilterBounds {
            oldest_ts: Some((NOW - 4 * DAY) as f64),
            newest_ts: Some(NOW as f64),
            min_distance: Some(10_000.0),
            max_distance: Some(50_000.0),
            min_moving_time: Some(900.0),
            max_moving_time: Some(7_200.0),
        }
    );
}

/// Scenario: the bars on a library with nothing stored yet.
///
/// Expected behaviour: every bound is absent, so the panel has no span to draw
/// rather than a span of zero.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_feed_filter_bounds_are_absent_on_an_empty_library() {
    let engine = PersistentEngine::in_memory().expect("engine");
    let bounds =
        crate::persistence::screens::pooled::feed_filter_bounds(&engine.db).expect("bounds");
    assert_eq!(bounds, crate::FfiFeedFilterBounds::default());
}

/// Scenario: a library whose every stored session is a strength session with
/// neither distance nor time.
///
/// Expected behaviour: the dates still answer, since the sessions are in the
/// library, and the distance and duration bounds stay absent rather than
/// reading zero.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn test_feed_filter_bounds_leave_distance_and_time_absent_without_any() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(
        &mut engine,
        &[(
            "lift-only",
            NOW,
            r#"{"id":"lift-only","type":"WeightTraining","name":"Press","distance":0.0,"moving_time":0}"#,
        )],
    );
    let bounds =
        crate::persistence::screens::pooled::feed_filter_bounds(&engine.db).expect("bounds");
    assert_eq!(bounds.oldest_ts, Some(NOW as f64));
    assert_eq!(bounds.newest_ts, Some(NOW as f64));
    assert_eq!(bounds.min_distance, None);
    assert_eq!(bounds.max_distance, None);
    assert_eq!(bounds.min_moving_time, None);
    assert_eq!(bounds.max_moving_time, None);
}
