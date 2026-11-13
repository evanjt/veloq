//! Each method answers what the app's own read answers.

use super::*;
use crate::persistence::PersistentEngine;
use serde_json::{Value, json};

fn engine_with_rides() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .upsert_activity_bodies(&[
            (
                "i1".into(),
                1_736_940_000,
                r#"{"id":"i1","type":"Ride","name":"Morning loop","moving_time":3600}"#.into(),
            ),
            (
                "i2".into(),
                1_737_040_000,
                r#"{"id":"i2","type":"Run","name":"Track session","moving_time":1800}"#.into(),
            ),
        ])
        .expect("bodies");
    engine
}

fn reply(engine: &PersistentEngine, request: &str) -> Value {
    reply_as(engine, None, request)
}

fn reply_as(engine: &PersistentEngine, athlete: Option<&str>, request: &str) -> Value {
    let caller = Caller {
        athlete,
        ..Caller::default()
    };
    reply_from(engine, &caller, request)
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_feed_page_is_the_feed_read_itself() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":7,"method":"feed.page","params":{"limit":1}}"#,
    );

    let query = crate::FfiActivityBodiesQuery {
        oldest_ts: None,
        newest_ts: None,
        needle: String::new(),
        sport_families: Vec::new(),
        offset: 0,
        limit: Some(1),
    };
    let page =
        crate::persistence::activities::pooled::feed_card_page(&engine.db, &query).expect("page");
    assert_eq!(got["id"], 7);
    let mut read = got["result"].clone();
    read.as_object_mut().unwrap().remove("previews");
    assert_eq!(read, serde_json::to_value(&page).unwrap());
    assert_eq!(got["result"]["matchedCount"], 2);
    assert_eq!(got["result"]["hasMore"], true);
    assert_eq!(got["result"]["cards"][0]["id"], "i2");
}

/// Scenario: a page holding an outdoor ride with a stored track and an
/// indoor ride with none.
///
/// Expected behaviour: the page carries the phone card's preview line for the
/// ride and none for the indoor one.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_feed_page_carries_each_gps_cards_preview_line() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .upsert_activity_bodies(&[
            (
                "out".into(),
                1_737_040_000,
                r#"{"id":"out","type":"Ride","name":"Outdoor","stream_types":["latlng","time"]}"#
                    .into(),
            ),
            (
                "in".into(),
                1_736_940_000,
                r#"{"id":"in","type":"VirtualRide","name":"Indoor","stream_types":["watts"]}"#
                    .into(),
            ),
        ])
        .expect("bodies");
    let points: Vec<crate::GpsPoint> = (0..120)
        .map(|i| crate::GpsPoint::new(46.5 + f64::from(i) * 0.0004, 6.6 + f64::from(i) * 0.0002))
        .collect();
    engine
        .add_activity("out".into(), points, "Ride".into())
        .expect("track");

    let got = reply(
        &engine,
        r#"{"id":9,"method":"feed.page","params":{"limit":10}}"#,
    );

    let phone = crate::persistence::screens::pooled::preview_track(&engine.db, "out")
        .expect("the phone's preview");
    let previews = got["result"]["previews"].as_array().expect("previews");
    assert_eq!(previews.len(), 1);
    assert_eq!(previews[0], serde_json::to_value(&phone).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_page_larger_than_the_cap_is_cut_to_it() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        &format!(
            r#"{{"id":1,"method":"feed.page","params":{{"limit":{}}}}}"#,
            MAX_PAGE * 10
        ),
    );
    assert_eq!(got["result"]["cards"].as_array().unwrap().len(), 2);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_summary_is_the_detail_read_summary() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":2,"method":"activity.summary","params":{"id":"i1"}}"#,
    );
    let detail = crate::persistence::screens::pooled::activity_detail_data(&engine.db, "i1", 1);
    assert_eq!(
        got["result"],
        serde_json::to_value(&detail.summary).unwrap()
    );
    assert_eq!(got["result"]["movingTime"], 3600.0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_unknown_method_is_an_error_not_a_panic() {
    let engine = engine_with_rides();
    let got = reply(&engine, r#"{"id":3,"method":"activities.delete"}"#);
    assert_eq!(got["id"], 3);
    assert_eq!(got["error"], "unknown method: activities.delete");
    assert!(got.get("result").is_none());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn bad_params_and_malformed_requests_are_errors() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":4,"method":"activity.summary","params":{}}"#,
    );
    assert!(got["error"].as_str().unwrap().starts_with("bad params"));
    let got = reply(&engine, "not json");
    assert_eq!(got["id"], Value::Null);
    assert_eq!(got["error"], "malformed request");
}

const BROWSER: &str = "sha-256 AA:BB:CC";

fn engine_with_a_section() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().expect("engine");
    for (id, name) in [("s_a", "Climb 1"), ("s_b", "Climb 2")] {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES (?1, 'auto', ?2, 'Ride', '[[46.2,7.3],[46.21,7.3]]', 400.0, 0, 1,
                    '2026-01-01T00:00:00Z', 46.2, 46.21, 7.3, 7.31)",
                [id, name],
            )
            .expect("insert the section");
    }
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, 1_700_000_000)
        .expect("link the browser");
    engine
}

fn written(engine: &mut PersistentEngine, request: &str) -> Value {
    serde_json::from_str(&answer_write(engine, BROWSER, request).reply).expect("a JSON reply")
}

fn name_of(engine: &PersistentEngine, id: &str) -> Option<String> {
    crate::persistence::sections::naming::pooled::all_section_names(&engine.db).remove(id)
}

#[test]
fn a_rename_is_the_rename_the_phone_makes() {
    let mut engine = engine_with_a_section();
    let got = written(
        &mut engine,
        r#"{"id":9,"method":"section.rename","params":{"id":"s_a","name":"Col"}}"#,
    );
    assert_eq!(got["id"], 9);
    assert_eq!(got["result"], serde_json::json!({ "ok": true }));
    assert_eq!(name_of(&engine, "s_a").as_deref(), Some("Col"));
}

#[test]
fn a_taken_name_keeps_its_name_in_the_refusal_and_changes_nothing() {
    let mut engine = engine_with_a_section();
    written(
        &mut engine,
        r#"{"id":1,"method":"section.rename","params":{"id":"s_a","name":"Col"}}"#,
    );
    let got = written(
        &mut engine,
        r#"{"id":2,"method":"section.rename","params":{"id":"s_b","name":"Col"}}"#,
    );
    assert_eq!(got["error"], "Another section is already named Col");
    assert_eq!(name_of(&engine, "s_b").as_deref(), Some("Climb 2"));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_rename_with_bad_params_is_refused() {
    let mut engine = engine_with_a_section();
    let got = written(
        &mut engine,
        r#"{"id":1,"method":"section.rename","params":{"id":"s_a"}}"#,
    );
    assert!(got["error"].as_str().unwrap().starts_with("bad params"));
    assert_eq!(name_of(&engine, "s_a").as_deref(), Some("Climb 1"));
}

#[test]
fn the_phone_only_operations_are_unknown_on_both_channels() {
    let mut engine = engine_with_a_section();
    let before = row_counts(&engine);
    for method in ["account.signOut", "library.clear", "linkedDevices.remove"] {
        let request = format!(r#"{{"id":5,"method":"{method}","params":{{"id":"1"}}}}"#);
        assert!(!is_write(method));
        let got = written(&mut engine, &request);
        assert_eq!(got["error"], format!("unknown method: {method}"));
        let got = reply(&engine, &request);
        assert_eq!(got["error"], format!("unknown method: {method}"));
    }
    assert_eq!(row_counts(&engine), before);
}

#[test]
fn a_write_is_not_answered_on_the_read_channel() {
    let engine = engine_with_a_section();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"section.rename","params":{"id":"s_a","name":"Col"}}"#,
    );
    assert_eq!(got["error"], "unknown method: section.rename");
    assert_eq!(name_of(&engine, "s_a").as_deref(), Some("Climb 1"));
}

fn rename_request(id: u32, section: &str, name: &str) -> String {
    format!(
        r#"{{"id":{id},"method":"section.rename","params":{{"id":"{section}","name":"{name}"}}}}"#
    )
}

fn logged(engine: &PersistentEngine) -> Vec<crate::persistence::linked_devices::RemoteWrite> {
    let device = crate::persistence::linked_devices::list(&engine.db, &[]).expect("devices")[0]
        .id
        .clone();
    crate::persistence::linked_devices::recent_writes(&engine.db, &device, 500).expect("writes")
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_rename_over_the_link_is_logged_under_the_browser_that_made_it() {
    let mut engine = engine_with_a_section();
    written(&mut engine, &rename_request(1, "s_a", "Col"));

    let rows = logged(&engine);
    assert_eq!(rows.len(), 1);
    let device = crate::persistence::linked_devices::list(&engine.db, &[]).unwrap()[0]
        .id
        .clone();
    assert_eq!(rows[0].device_id, device);
    assert_eq!(rows[0].method, "section.rename");
    assert_eq!(rows[0].target_id, "s_a");
    assert_eq!(rows[0].summary, "Renamed section Climb 1 to Col");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn clearing_a_name_is_logged_as_a_clear() {
    let mut engine = engine_with_a_section();
    written(&mut engine, &rename_request(1, "s_a", ""));
    assert_eq!(
        logged(&engine)[0].summary,
        "Cleared the name of section Climb 1"
    );
}

#[test]
fn a_refused_write_leaves_no_row() {
    let mut engine = engine_with_a_section();
    written(&mut engine, &rename_request(1, "s_a", "Col"));
    let taken = written(&mut engine, &rename_request(2, "s_b", "Col"));
    assert!(taken.get("error").is_some());
    let bad = written(
        &mut engine,
        r#"{"id":3,"method":"section.rename","params":{"id":"s_a"}}"#,
    );
    assert!(bad.get("error").is_some());
    assert_eq!(logged(&engine).len(), 1);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_log_keeps_the_last_two_hundred_writes() {
    let mut engine = engine_with_a_section();
    for k in 0..201 {
        written(&mut engine, &rename_request(k, "s_a", &format!("Name {k}")));
    }
    let rows = logged(&engine);
    assert_eq!(rows.len(), 200);
    assert_eq!(rows[0].summary, "Renamed section Name 199 to Name 200");
    assert!(rows.iter().all(|row| !row.summary.ends_with("to Name 0")));
}

#[test]
fn unlinking_a_browser_removes_its_log() {
    let mut engine = engine_with_a_section();
    written(&mut engine, &rename_request(1, "s_a", "Col"));
    let device = crate::persistence::linked_devices::list(&engine.db, &[]).unwrap()[0]
        .id
        .clone();
    crate::persistence::linked_devices::remove(&engine.db, &device).unwrap();
    let left: i64 = engine
        .db
        .query_row("SELECT COUNT(*) FROM remote_writes", [], |row| row.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn a_write_from_an_unlinked_peer_is_logged_nowhere() {
    let mut engine = engine_with_a_section();
    let reply = answer_write(
        &mut engine,
        "sha-256 FF:FF",
        &rename_request(1, "s_a", "Col"),
    )
    .reply;
    assert!(reply.contains("result"));
    let left: i64 = engine
        .db
        .query_row("SELECT COUNT(*) FROM remote_writes", [], |row| row.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_rename_announces_the_sections_that_moved_once_and_a_refusal_announces_nothing() {
    use crate::objects::observer::{recorder::Recorder, set_observer};
    let _serial = crate::test_globals::serial_global_state();
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    let mut engine = engine_with_a_section();
    for request in [
        rename_request(1, "s_a", "Col"),
        rename_request(2, "s_b", "Col"),
        r#"{"id":3,"method":"nope"}"#.to_owned(),
    ] {
        answer_write(&mut engine, BROWSER, &request).announce();
    }
    let events = recorder.events();
    set_observer(None);

    assert_eq!(events, ["remote_wrote:sections"]);
}

fn row_counts(engine: &PersistentEngine) -> (i64, i64, i64) {
    let count = |table: &str| {
        engine
            .db
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count")
    };
    (
        count("linked_devices"),
        count("activities"),
        count("sections"),
    )
}

/// Adding a write method is a visible change here, never a quiet widening.
#[test]
fn the_write_table_is_exactly_these_methods() {
    let writes: Vec<&str> = METHODS
        .iter()
        .filter(|method| method.is_write())
        .map(|method| method.name)
        .collect();
    assert_eq!(
        writes,
        [
            "section.rename",
            "section.setLift",
            "section.accept",
            "section.acceptAll",
            "section.enable",
            "section.disable",
            "section.excludeActivity",
            "section.includeActivity",
            "section.excludeLap",
            "section.includeLap",
            "route.rename",
            "route.excludeActivity",
            "route.includeActivity",
            "heatmap.setHidden",
            "detection.setEnabled",
            "detection.setStrictness",
            "detection.setSectionConfig",
        ]
    );
    for name in writes {
        assert!(is_write(name));
    }
}

/// A well-formed ask for each method. A method added to the table without
/// one fails `every_listed_method_answers_a_well_formed_ask`.
fn sample_params(method: &str) -> &'static str {
    match method {
        "link.hello" => r#"{"protocol":3,"page":"test page"}"#,
        "feed.page" => r#"{"offset":0,"limit":1}"#,
        "feed.summary" => r#"{"nowWallSeconds":1737050000}"#,
        "feed.sparklines" => r#"{"days":30}"#,
        "feed.highlights" => r#"{"ids":["i1"]}"#,
        "activity.summary"
        | "activity.detail"
        | "activity.record"
        | "activity.intervals"
        | "activity.sections"
        | "activity.exerciseSets" => r#"{"id":"i1"}"#,
        "activity.streams" => r#"{"id":"i1","types":["time","watts"]}"#,
        "insights.data" => {
            r#"{"currentStart":0,"currentEnd":1737050000,"prevStart":0,"prevEnd":0,"chronicStart":0,"todayStart":1737000000,"includeSections":true,"rankedLimit":50,"historyLimit":20,"activeWindowDays":90,"efficiencyPerSport":5,"efficiencyMinHrChangeBpm":1,"efficiencyLimit":2,"efficiencyMinEfforts":1,"efficiencyDecliningMinEfforts":3,"strengthMonth":{"startTs":1734630000,"endTs":1737050000},"strengthWeeks":[],"wellnessOldest":"2025-01-01","wellnessNewest":"2025-01-31","hrvWindowDays":7,"sectionChangeWindowDays":14,"staleThresholdDays":30,"staleMinGainPercent":3.0,"staleMaxOpportunities":3,"staleMinTraversals":1,"recentPrWindowDays":7,"recentPrMinOutings":3}"#
        }
        "insights.plannedEvents" => r#"{"oldestTs":0,"newestTs":86400}"#,
        "insights.workoutSections" => r#"{"sportType":"Ride","limit":5}"#,
        "settings.get" => r#"{"keys":["veloq-unit-preference"]}"#,
        "settings.profile"
        | "status.backgroundJobs"
        | "status.cache"
        | "status.backup"
        | "status.linkedDevices"
        | "status.coverage"
        | "status.sync" => "{}",
        "section.rename" => r#"{"id":"s_a","name":"Col"}"#,
        "section.setLift" => r#"{"id":"s1","isLift":true}"#,
        "section.accept" | "section.enable" | "section.disable" => r#"{"id":"s1"}"#,
        "section.acceptAll" => "{}",
        "section.excludeActivity" | "section.includeActivity" => r#"{"id":"s1","activityId":"r1"}"#,
        "section.excludeLap" | "section.includeLap" => {
            r#"{"id":"s1","activityId":"r1","startIndex":0}"#
        }
        "route.rename" => r#"{"id":"g1","name":"Valley loop"}"#,
        "route.excludeActivity" | "route.includeActivity" => r#"{"id":"g1","activityId":"r1"}"#,
        "heatmap.setHidden" => r#"{"activityId":"r1","hidden":true}"#,
        "detection.settings" => "{}",
        "detection.setEnabled" => r#"{"enabled":false}"#,
        "detection.setStrictness" => r#"{"minMatchPct":60.0,"endpointThreshold":200.0}"#,
        "detection.setSectionConfig" => {
            r#"{"proximityThreshold":200.0,"minSectionLength":150.0,"maxSectionLength":200000.0,"minActivities":2,"divergenceThreshold":0.15}"#
        }
        "map.screen" => {
            r#"{"startDate":0,"endDate":2000000000,"sportTypes":["Ride"],"distanceBand":"all"}"#
        }
        "geo.routeLines" | "geo.sections" | "heatmap.progress" => "{}",
        "geo.track" | "geo.activityOverlay" => r#"{"id":"i1"}"#,
        "geo.route" | "geo.routeLatest" => r#"{"groupId":"g1"}"#,
        "geo.section" | "geo.sectionPasses" => r#"{"sectionId":"s1"}"#,
        "heatmap.tile" => r#"{"z":3,"x":1,"y":2,"base":"dark"}"#,
        "fitness.screen" => {
            r#"{"spanDays":[42],"windows":{"heatmapFirstDay":"2025-01-01","heatmapLastDay":"2025-12-31","months":{"startTs":0,"endTs":86400},"yearCurrent":{"startTs":0,"endTs":86400},"yearPrevious":{"startTs":0,"endTs":86400},"monthCurrent":{"startTs":0,"endTs":86400},"monthPrevious":{"startTs":0,"endTs":86400},"nowWallSeconds":86400}}"#
        }
        "fitness.wellness" => r#"{"oldest":"2026-01-01","newest":"2026-01-31"}"#,
        "fitness.loads" => r#"{"startTs":0,"endTs":86400}"#,
        "fitness.zones" => r#"{"sportType":"Ride","zoneType":"power","startTs":0,"endTs":86400}"#,
        "fitness.powerCurve" => r#"{"sport":"Ride","days":42}"#,
        "fitness.paceCurve" => r#"{"sport":"Run","days":42,"gap":false}"#,
        "fitness.bestEfforts" => r#"{"days":42}"#,
        "strength.screen" => r#"{"nowWallSeconds":1737050000,"periodDays":30}"#,
        "strength.exercise" => r#"{"exerciseCategory":7}"#,
        "strength.muscle" => r#"{"activityId":"s1","muscleSlug":"chest"}"#,
        "recordings.list" => "{}",
        "recordings.get" => r#"{"id":"b1"}"#,
        "routes.screen" | "sections.retired" => "{}",
        "route.detail" | "route.attempts" => r#"{"id":"g1"}"#,
        "route.performance" => r#"{"id":"g1","timeRangeDays":365}"#,
        "section.detail" | "section.history" | "section.excluded" => r#"{"id":"s1"}"#,
        "section.performance" => r#"{"id":"s1","timeRangeDays":365}"#,
        other => panic!("no sample ask for {other}"),
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn hello_names_the_protocol_the_app_and_every_method() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":9,"method":"link.hello","params":{"protocol":3,"page":"test page"}}"#,
    );
    assert_eq!(got["id"], 9);
    assert_eq!(got["result"]["protocol"], 3);
    assert_eq!(got["result"]["app"], env!("CARGO_PKG_VERSION"));
    let listed: Vec<&str> = got["result"]["methods"]
        .as_array()
        .expect("a method list")
        .iter()
        .map(|name| name.as_str().expect("a name"))
        .collect();
    let table: Vec<&str> = METHODS.iter().map(|method| method.name).collect();
    assert_eq!(listed, table);
    assert!(listed.contains(&"feed.page"));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn hello_carries_the_phones_name_only_when_it_has_one() {
    let named = serde_json::to_value(hello_answer("  Pixel 8 ", PROTOCOL_VERSION)).expect("json");
    assert_eq!(named["device"], "Pixel 8");
    for blank in ["", "   "] {
        let unnamed = serde_json::to_value(hello_answer(blank, PROTOCOL_VERSION)).expect("json");
        assert!(unnamed.get("device").is_none(), "{unnamed}");
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn hello_answers_a_page_on_another_protocol_with_the_phones_own() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"link.hello","params":{"protocol":4,"page":"newer page"}}"#,
    );
    assert_eq!(got["result"]["protocol"], PROTOCOL_VERSION);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn hello_from_a_page_that_speaks_a_range_answers_the_highest_common_version() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"link.hello","params":{"protocol":3,"minProtocol":2,"page":"p"}}"#,
    );
    assert_eq!(got["result"]["protocol"], 3);
    assert_eq!(got["result"]["minProtocol"], MIN_PROTOCOL_VERSION);
    assert_eq!(got["result"]["maxProtocol"], PROTOCOL_VERSION);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn hello_from_a_page_built_for_the_previous_version_alone_answers_that_version() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"link.hello","params":{"protocol":2,"page":"older page"}}"#,
    );
    assert_eq!(got["result"]["protocol"], 2);
    let listed = got["result"]["methods"].as_array().expect("a method list");
    assert_eq!(listed.len(), METHODS.len());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn hello_from_a_page_below_the_range_answers_the_phones_own_range() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"link.hello","params":{"protocol":1,"page":"ancient page"}}"#,
    );
    assert_eq!(got["result"]["protocol"], PROTOCOL_VERSION);
    assert_eq!(got["result"]["minProtocol"], MIN_PROTOCOL_VERSION);
}

#[test]
fn the_highest_version_both_sides_speak_is_chosen() {
    assert_eq!(negotiate(2, 3), Some(3));
    assert_eq!(negotiate(3, 3), Some(3));
    assert_eq!(negotiate(2, 2), Some(2));
    assert_eq!(negotiate(1, 9), Some(PROTOCOL_VERSION));
    assert_eq!(negotiate(PROTOCOL_VERSION + 1, PROTOCOL_VERSION + 2), None);
    assert_eq!(negotiate(0, MIN_PROTOCOL_VERSION - 1), None);
    assert_eq!(negotiate(3, 2), None, "an empty range matches nothing");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_request_with_no_protocol_is_answered_in_the_oldest_format() {
    assert_eq!(
        wire_of(r#"{"id":1,"method":"feed.page"}"#),
        MIN_PROTOCOL_VERSION
    );
    assert_eq!(wire_of("not json"), MIN_PROTOCOL_VERSION);
    assert_eq!(wire_of(r#"{"id":1,"protocol":3}"#), 3);
    assert_eq!(wire_of(r#"{"id":1,"protocol":2}"#), 2);
    assert_eq!(wire_of(r#"{"id":1,"protocol":99}"#), PROTOCOL_VERSION);
    assert_eq!(wire_of(r#"{"id":1,"protocol":0}"#), MIN_PROTOCOL_VERSION);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_previous_version_gets_each_reply_as_one_text_message() {
    let reply = format!(r#"{{"id":4,"result":"{}"}}"#, "x".repeat(3 * FRAME_BYTES));
    let sent = messages(&reply, 2);
    assert_eq!(sent.len(), 1);
    assert!(!sent[0].binary, "the previous format is text");
    assert_eq!(sent[0].bytes, reply.as_bytes());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_current_version_gets_binary_frames() {
    let sent = messages(r#"{"id":4,"result":1}"#, PROTOCOL_VERSION);
    assert_eq!(sent.len(), 1);
    assert!(sent[0].binary);
    assert_eq!(sent[0].bytes[0], FRAME_VERSION);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn every_listed_method_answers_a_well_formed_ask() {
    let engine = engine_with_a_route_and_a_section();
    let mut sections = engine_with_a_route_and_a_section();
    crate::persistence::linked_devices::add(&sections.db, "Laptop", BROWSER, 1_700_000_000)
        .expect("link the browser");
    for method in METHODS {
        let request = format!(
            r#"{{"id":5,"method":"{}","params":{}}}"#,
            method.name,
            sample_params(method.name)
        );
        let got = if method.is_write() {
            written(&mut sections, &request)
        } else {
            reply(&engine, &request)
        };
        assert!(
            got.get("result").is_some(),
            "{} answered {got}",
            method.name
        );
        assert_eq!(got["id"], 5);
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn method_names_are_unique() {
    let mut names: Vec<&str> = METHODS.iter().map(|method| method.name).collect();
    names.sort_unstable();
    let count = names.len();
    names.dedup();
    assert_eq!(names.len(), count);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_page_schema_input_is_the_rendered_table() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../web/connect/methods.json"
    );
    let rendered = methods_json();
    let kept = std::fs::read_to_string(path).unwrap_or_default();
    assert!(
        kept == rendered,
        "web/connect/methods.json is out of date with METHODS; it should read:\n{rendered}"
    );
}

/// The wire format each protocol version was cut for, oldest first. Append a
/// pin when the wire format changes and `PROTOCOL_VERSION` bumps with it; a pin
/// already written is never edited.
const WIRE_PINS: &[(u32, &str)] = &[(
    3,
    "e6b07a998045c0d6dd008df12fac3bfc8f3d79862ae455194b8202cb0746edd9",
)];

/// The wire format as a fingerprint: every constant a page reads from a reply
/// frame, and the columns of each row of the method table. The version is not
/// in it, so a pin pairs the two.
fn wire_fingerprint() -> String {
    let table: Value = serde_json::from_str(&methods_json()).expect("the table is JSON");
    let mut columns: Vec<&str> = table["methods"][0]
        .as_object()
        .expect("a row of the table")
        .keys()
        .map(String::as_str)
        .collect();
    columns.sort_unstable();
    let text = format!(
        "frame-bytes={FRAME_BYTES};header-bytes={FRAME_HEADER_BYTES};\
         frame-version={FRAME_VERSION};gzip={FRAME_GZIP};last={FRAME_LAST};\
         columns={}",
        columns.join(",")
    );
    crate::remote::digest::sha256(&[text.as_bytes()])
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
fn the_wire_format_is_pinned_to_the_protocol_version() {
    let (version, pinned) = *WIRE_PINS.last().expect("at least one pin");
    let current = wire_fingerprint();
    assert_eq!(
        version, PROTOCOL_VERSION,
        "the newest pin is for version {version}; a bump to {PROTOCOL_VERSION} needs its pin appended"
    );
    assert_eq!(
        current, pinned,
        "the wire format changed without a new protocol version: bump PROTOCOL_VERSION and append ({PROTOCOL_VERSION}, \"{current}\") to WIRE_PINS"
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_wire_pins_are_in_version_order() {
    for pair in WIRE_PINS.windows(2) {
        assert!(pair[0].0 < pair[1].0, "pins out of order: {pair:?}");
    }
}

/// The reply a frame set carries: the bodies in order, inflated when the
/// frames say gzip. Panics on a frame set a page would reject.
fn joined(cut: &[Vec<u8>]) -> (u32, String) {
    let mut body = Vec::new();
    let mut id = None;
    let mut gzip = false;
    for (k, frame) in cut.iter().enumerate() {
        assert!(frame.len() <= FRAME_BYTES, "a frame over the limit");
        assert_eq!(frame[0], FRAME_VERSION);
        let this = u32::from_be_bytes(frame[2..6].try_into().unwrap());
        assert_eq!(*id.get_or_insert(this), this);
        assert_eq!(
            u32::from_be_bytes(frame[6..10].try_into().unwrap()),
            k as u32
        );
        assert_eq!(frame[1] & FRAME_LAST != 0, k + 1 == cut.len());
        gzip = frame[1] & FRAME_GZIP != 0;
        body.extend_from_slice(&frame[FRAME_HEADER_BYTES..]);
    }
    if gzip {
        let mut text = String::new();
        std::io::Read::read_to_string(&mut flate2::read::GzDecoder::new(&body[..]), &mut text)
            .expect("a gzip body");
        return (id.unwrap(), text);
    }
    (id.unwrap(), String::from_utf8(body).expect("text"))
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_small_reply_is_one_plain_last_frame() {
    let reply = json!({ "id": 3, "result": "short" }).to_string();
    let cut = frames(&reply);
    assert_eq!(cut.len(), 1);
    assert_eq!(cut[0][1], FRAME_LAST);
    assert_eq!(joined(&cut), (3, reply));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_reply_over_the_gzip_threshold_travels_gzipped_and_smaller() {
    let reply = json!({ "id": 4, "result": "0123456789".repeat(1000) }).to_string();
    assert!(reply.len() > GZIP_OVER);
    let cut = frames(&reply);
    assert_eq!(cut[0][1] & FRAME_GZIP, FRAME_GZIP);
    let wire: usize = cut.iter().map(|f| f.len() - FRAME_HEADER_BYTES).sum();
    assert!(wire < reply.len());
    assert_eq!(joined(&cut), (4, reply));
}

#[test]
fn a_reply_that_stays_large_once_gzipped_is_cut_into_frames_that_join_back() {
    let mut state = 0x9E37_79B9u32;
    let noise: String = (0..200_000)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            char::from(b'A' + (state >> 8) as u8 % 52)
        })
        .collect();
    let reply = json!({ "id": 5, "result": noise }).to_string();
    let cut = frames(&reply);
    assert!(cut.len() > 3);
    assert!(cut.iter().all(|frame| frame.len() <= FRAME_BYTES));
    assert_eq!(joined(&cut), (5, reply));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_reply_with_no_numeric_id_travels_under_id_zero() {
    let reply = json!({ "id": null, "error": "malformed request" }).to_string();
    assert_eq!(joined(&frames(&reply)), (0, reply));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_reply_is_one_empty_last_frame() {
    let cut = frames("");
    assert_eq!(cut.len(), 1);
    assert_eq!(cut[0].len(), FRAME_HEADER_BYTES);
    assert_eq!(cut[0][1], FRAME_LAST);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_feed_page_narrows_by_sport_family_and_window() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":10,"method":"feed.page","params":{"sportFamilies":["run"]}}"#,
    );
    let cards = got["result"]["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["id"], "i2");
    assert_eq!(got["result"]["matchedCount"], 1);

    let got = reply(
        &engine,
        r#"{"id":11,"method":"feed.page","params":{"oldestTs":1737000000,"newestTs":1737100000}}"#,
    );
    let cards = got["result"]["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["id"], "i2");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_summary_card_is_the_summary_card_read_itself() {
    let engine = engine_with_rides();
    let now = 1_737_050_000.0_f64;
    let got = reply(
        &engine,
        &format!(r#"{{"id":12,"method":"feed.summary","params":{{"nowWallSeconds":{now}}}}}"#),
    );
    let (cs, ce, ps, pe) = crate::widget_snapshot::week_bounds(now as i64);
    let card = crate::persistence::screens::pooled::summary_card(&engine.db, cs, ce, ps, pe);
    assert_eq!(got["result"], serde_json::to_value(&card).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_sparklines_are_the_sparklines_read_itself() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":13,"method":"feed.sparklines","params":{"days":30}}"#,
    );
    let lines = crate::persistence::wellness::pooled::sparklines_to(
        &engine.db,
        30,
        &crate::persistence::wellness::today_iso(),
    )
    .expect("sparklines");
    assert_eq!(got["result"], serde_json::to_value(&lines).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_highlights_are_the_highlight_bundle_of_the_cards_asked() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":14,"method":"feed.highlights","params":{"ids":["i1","i2"]}}"#,
    );
    let ids = vec!["i1".to_string(), "i2".to_string()];
    let bundle = crate::objects::activities::highlights_bundle(&engine.db, &ids);
    assert_eq!(got["result"], serde_json::to_value(&bundle).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn highlights_for_more_ids_than_a_page_are_cut_to_a_page() {
    let engine = engine_with_rides();
    let ids: Vec<String> = (0..MAX_PAGE * 2).map(|n| format!("x{n}")).collect();
    let capped: Vec<String> = ids[..MAX_PAGE as usize].to_vec();
    let got = reply(
        &engine,
        &json!({"id":15,"method":"feed.highlights","params":{"ids":ids}}).to_string(),
    );
    let bundle = crate::objects::activities::highlights_bundle(&engine.db, &capped);
    assert_eq!(got["result"], serde_json::to_value(&bundle).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_routes_screen_answers_the_routes_read_for_the_same_query() {
    let engine = engine_with_a_section();
    let got = reply(
        &engine,
        r#"{"id":3,"method":"routes.screen","params":{"sectionSort":"name","sectionSearch":"climb","sectionLimit":1,"sectionFilters":{"hideCustom":false,"hideAuto":false,"hideDisabled":false,"hideUnaccepted":false}}}"#,
    );
    let query = crate::FfiRoutesScreenQuery {
        section_sort: crate::FfiSectionSort::Name,
        section_search: "climb".into(),
        section_limit: 1,
        ..Default::default()
    };
    let read = crate::persistence::pooled_routes_screen_data(&engine.db, query);
    assert_eq!(got["result"], serde_json::to_value(&read).unwrap());
    assert_eq!(got["result"]["sections"].as_array().unwrap().len(), 1);
    assert!(got["result"]["filteredSectionCount"].as_u64().unwrap() >= 2);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_routes_ask_reads_the_screens_defaults() {
    let engine = engine_with_a_section();
    let got = reply(&engine, r#"{"id":3,"method":"routes.screen","params":{}}"#);
    let read = crate::persistence::pooled_routes_screen_data(&engine.db, Default::default());
    assert_eq!(got["result"], serde_json::to_value(&read).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_section_detail_is_the_section_detail_read_with_its_history_and_versions() {
    let engine = engine_with_a_section();
    let got = reply(
        &engine,
        r#"{"id":4,"method":"section.detail","params":{"id":"s_a"}}"#,
    );
    let read = crate::persistence::screens::pooled::section_detail_data(&engine.db, "s_a");
    assert_eq!(got["result"], serde_json::to_value(&read).unwrap());
    assert!(got["result"].get("history").is_some());
    assert!(got["result"].get("geometryVersions").is_some());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_route_detail_is_the_route_detail_read() {
    let engine = engine_with_a_route_and_a_section();
    let got = reply(
        &engine,
        r#"{"id":5,"method":"route.detail","params":{"id":"g1"}}"#,
    );
    let read = crate::persistence::screens::pooled::route_detail_data(&engine.db, "g1");
    assert_eq!(got["result"], serde_json::to_value(&read).unwrap());
}

/// `scripts/generate-link-schema.mjs` writes these enums by hand, as serde
/// writes them; this is the other half of that pin.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_empty_reasons_are_written_as_the_page_schema_says() {
    use crate::{FfiCatalogueEmptyReason as Reason, FfiDetectionHold as Hold};
    let json = |reason: &Reason| serde_json::to_value(reason).unwrap();
    assert_eq!(json(&Reason::NoGpsActivities), "noGpsActivities");
    assert_eq!(
        json(&Reason::NotYetRun { awaiting: 3 }),
        serde_json::json!({ "notYetRun": { "awaiting": 3 } })
    );
    assert_eq!(
        json(&Reason::Running {
            phase: "analyzing".into(),
            percent: 40
        }),
        serde_json::json!({ "running": { "phase": "analyzing", "percent": 40 } })
    );
    assert_eq!(
        json(&Reason::NoneFound { min_activities: 2 }),
        serde_json::json!({ "noneFound": { "minActivities": 2 } })
    );
    assert_eq!(
        json(&Reason::Held {
            hold: Hold::ElevationWaiting { remaining: 4 }
        }),
        serde_json::json!({ "held": { "hold": { "elevationWaiting": { "remaining": 4 } } } })
    );
    for (hold, name) in [
        (Hold::ElevationPaused, "elevationPaused"),
        (Hold::ElevationRunning, "elevationRunning"),
        (Hold::Cutover, "cutover"),
    ] {
        assert_eq!(serde_json::to_value(&hold).unwrap(), name);
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_message_is_a_cancel_an_ask_or_nothing_to_answer() {
    assert_eq!(
        incoming(r#"{"method":"cancel","params":{"id":7}}"#),
        Incoming::Cancel(7)
    );
    assert_eq!(
        incoming(r#"{"id":3,"method":"cancel","params":{"id":7}}"#),
        Incoming::Cancel(7),
        "a cancel is withdrawn whatever id it carries"
    );
    assert_eq!(incoming(r#"{"method":"cancel"}"#), Incoming::Ignore);
    assert_eq!(
        incoming(r#"{"method":"cancel","params":{"id":"x"}}"#),
        Incoming::Ignore
    );
    assert_eq!(
        incoming(r#"{"id":5,"method":"feed.page"}"#),
        Incoming::Ask(Some(5))
    );
    assert_eq!(incoming("not json"), Incoming::Ask(None));
    assert_eq!(incoming(r#"{"method":"feed.page"}"#), Incoming::Ask(None));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_busy_reply_names_the_ask_it_refuses() {
    let got: Value = serde_json::from_str(&busy(Some(17))).unwrap();
    assert_eq!(got, json!({ "id": 17, "error": "busy" }));
}

const POWER_BODY: &str = r#"{"list":[{"secs":[1,60,300],"values":[900,420,310],"activity_id":["i1","i1","i1"],"days":42}],"activities":{"i1":{"id":"i1","name":"Morning loop"}}}"#;

fn engine_with_fitness() -> PersistentEngine {
    use crate::persistence::bodies::CurveKind;
    let mut engine = engine_with_rides();
    let day = |date: &str, ctl: f64, atl: f64| crate::persistence::wellness::WellnessRow {
        date: date.into(),
        ctl: Some(ctl),
        atl: Some(atl),
        ramp_rate: None,
        hrv: None,
        resting_hr: None,
        weight: None,
        sleep_secs: None,
        sleep_score: None,
        soreness: None,
        fatigue: None,
        stress: None,
        mood: None,
        motivation: None,
        raw: None,
    };
    engine
        .upsert_wellness(&[day("2026-01-10", 40.0, 35.0), day("2026-01-11", 41.5, 38.0)])
        .expect("wellness");
    engine
        .set_curve_body(CurveKind::Power, "Ride", 42, false, POWER_BODY)
        .expect("curve");
    engine
}

fn result_of(engine: &PersistentEngine, method: &str, params: &str) -> Value {
    let got = reply(
        engine,
        &format!(r#"{{"id":1,"method":"{method}","params":{params}}}"#),
    );
    assert!(got.get("error").is_none(), "{method} answered {got}");
    got["result"].clone()
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn wellness_is_the_wellness_read_with_its_coverage() {
    let engine = engine_with_fitness();
    let got = result_of(
        &engine,
        "fitness.wellness",
        r#"{"oldest":"2026-01-01","newest":"2026-01-31"}"#,
    );
    let days = crate::persistence::wellness::pooled::days_with_coverage(
        &engine.db,
        "2026-01-01",
        "2026-01-31",
    )
    .expect("days");
    assert_eq!(got, serde_json::to_value(&days).unwrap());
    assert_eq!(got["days"].as_array().unwrap().len(), 2);
    assert_eq!(got["days"][1]["ctl"], 41.5);
}

#[test]
fn the_power_curve_is_the_stored_curve_and_null_when_never_fetched() {
    let engine = engine_with_fitness();
    let got = result_of(
        &engine,
        "fitness.powerCurve",
        r#"{"sport":"Ride","days":42}"#,
    );
    let (_, curve) =
        crate::persistence::curves::pooled::power_curve(&engine.db, "Ride", 42).expect("curve");
    assert_eq!(got["curve"], serde_json::to_value(&curve).unwrap());
    assert_eq!(got["curve"]["watts"], json!([900.0, 420.0, 310.0]));

    let none = result_of(
        &engine,
        "fitness.powerCurve",
        r#"{"sport":"Ride","days":7}"#,
    );
    assert_eq!(none["curve"], Value::Null);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_pace_curve_is_null_when_never_fetched() {
    let engine = engine_with_fitness();
    let got = result_of(
        &engine,
        "fitness.paceCurve",
        r#"{"sport":"Run","days":42,"gap":true}"#,
    );
    assert_eq!(got["curve"], Value::Null);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn loads_and_zones_are_their_reads() {
    let engine = engine_with_fitness();
    let loads = result_of(
        &engine,
        "fitness.loads",
        r#"{"startTs":0,"endTs":2000000000}"#,
    );
    let read = crate::persistence::fitness::derivations::pooled::daily_activity_loads(
        &engine.db,
        0,
        2_000_000_000,
    );
    assert_eq!(loads["days"], serde_json::to_value(&read).unwrap());

    let zones = result_of(
        &engine,
        "fitness.zones",
        r#"{"sportType":"Ride","zoneType":"power","startTs":0,"endTs":2000000000}"#,
    );
    let read = crate::persistence::fitness::derivations::pooled::zone_distribution_named(
        &engine.db,
        "Ride",
        "power",
        0,
        2_000_000_000,
    );
    assert_eq!(zones, serde_json::to_value(&read).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn best_efforts_carry_the_power_the_stored_curve_holds() {
    let engine = engine_with_fitness();
    let got = result_of(&engine, "fitness.bestEfforts", r#"{"days":42}"#);
    assert_eq!(got["sports"][0]["sport"], "Ride");
    assert_eq!(got["sports"][0]["fetched"], true);
    assert!(!got["sports"][0]["efforts"].as_array().unwrap().is_empty());
}

const INSIGHTS_ASK: &str = r#"{"currentStart":0,"currentEnd":1737050000,"prevStart":0,"prevEnd":0,"chronicStart":0,"todayStart":1737000000,"includeSections":false,"rankedLimit":50,"historyLimit":20,"activeWindowDays":28,"efficiencyPerSport":5,"efficiencyMinHrChangeBpm":1,"efficiencyLimit":2,"efficiencyMinEfforts":3,"efficiencyDecliningMinEfforts":5,"strengthMonth":{"startTs":1734600000,"endTs":1737050000},"strengthWeeks":[{"startTs":1736400000,"endTs":1737050000}],"wellnessOldest":"2025-01-01","wellnessNewest":"2025-12-31","hrvWindowDays":7,"sectionChangeWindowDays":14,"staleThresholdDays":30,"staleMinGainPercent":3.0,"staleMaxOpportunities":3,"staleMinTraversals":2,"recentPrWindowDays":14,"recentPrMinOutings":3}"#;

/// Scenario: the page asks for the insights read with the phone's parameters,
/// the week bounds left for the engine to fill.
///
/// Expected behaviour: the answer is the insights read itself over those
/// parameters once the engine has set the week bounds.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_insights_data_over_a_fitness_library_is_the_insights_read() {
    let engine = engine_with_fitness();
    let got = result_of(&engine, "insights.data", INSIGHTS_ASK);
    let ask: crate::FfiInsightsParams = serde_json::from_str(INSIGHTS_ASK).unwrap();
    let ask = crate::objects::fitness::with_week_bounds(ask);
    let read = crate::persistence::screens::pooled::insights_data(&engine.db, &ask);
    assert_eq!(got, wire(&read));
    assert_eq!(got["weeklyTotals"].as_array().unwrap().len(), 5);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_insights_ask_missing_a_parameter_is_bad_params() {
    let engine = engine_with_fitness();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"insights.data","params":{"currentEnd":1737050000}}"#,
    );
    assert!(
        got["error"]
            .as_str()
            .unwrap_or_default()
            .starts_with("bad params")
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_fitness_screen_is_the_screen_read() {
    let engine = engine_with_fitness();
    let windows = r#"{"heatmapFirstDay":"2025-01-01","heatmapLastDay":"2025-12-31","months":{"startTs":0,"endTs":86400},"yearCurrent":{"startTs":0,"endTs":86400},"yearPrevious":{"startTs":0,"endTs":86400},"monthCurrent":{"startTs":0,"endTs":86400},"monthPrevious":{"startTs":0,"endTs":86400},"nowWallSeconds":86400}"#;
    let got = result_of(
        &engine,
        "fitness.screen",
        &format!(r#"{{"spanDays":[42],"windows":{windows}}}"#),
    );
    let windows: crate::FfiFitnessScreenWindows = serde_json::from_str(windows).unwrap();
    let read = crate::persistence::screens::pooled::fitness_screen_data(
        &engine.db,
        &crate::persistence::wellness::today_iso(),
        &[42],
        &windows,
    )
    .expect("screen");
    assert_eq!(got, serde_json::to_value(&read).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_range_the_phone_would_not_ask_for_is_bad_params() {
    let engine = engine_with_fitness();
    for (method, params) in [
        (
            "fitness.wellness",
            r#"{"oldest":"2026-02-01","newest":"2026-01-01"}"#,
        ),
        (
            "fitness.wellness",
            r#"{"oldest":"January","newest":"2026-01-01"}"#,
        ),
        ("fitness.loads", r#"{"startTs":100,"endTs":50}"#),
        (
            "fitness.zones",
            r#"{"sportType":"Ride","zoneType":"power","startTs":100,"endTs":50}"#,
        ),
        ("fitness.powerCurve", r#"{"sport":"Ride","days":-1}"#),
        ("fitness.bestEfforts", r#"{"days":-5}"#),
    ] {
        let got = reply(
            &engine,
            &format!(r#"{{"id":1,"method":"{method}","params":{params}}}"#),
        );
        let error = got["error"].as_str().unwrap_or_default();
        assert!(error.starts_with("bad params"), "{method} answered {got}");
    }
}

/// A result as the browser receives it: serialised to text and parsed back, so
/// a float is compared as the reply carries it rather than as the engine held it.
fn wire<T: serde::Serialize>(value: &T) -> Value {
    serde_json::from_str(&serde_json::to_string(value).expect("a serialised result"))
        .expect("a parsed result")
}

const DAY: i64 = 86_400;
const WEIGHT_TRAINING_BASE: i64 = 1_700_000_000;
const CATEGORY: u16 = 7;

fn a_set(order: u32, weight_kg: f64) -> crate::fit::FitExerciseSet {
    crate::fit::FitExerciseSet {
        set_order: order,
        exercise_category: CATEGORY,
        exercise_name: None,
        set_type: 0,
        repetitions: Some(8),
        weight_kg: Some(weight_kg),
        duration_secs: None,
        start_time: None,
    }
}

/// Two strength sessions a day apart, a ride the strength reads must not see,
/// and one muscle the category trains as primary.
fn engine_with_strength() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().expect("engine");
    for (id, name, date, sport) in [
        ("s1", "Push day", WEIGHT_TRAINING_BASE, "WeightTraining"),
        (
            "s2",
            "Pull day",
            WEIGHT_TRAINING_BASE + DAY,
            "WeightTraining",
        ),
        ("r1", "Lake loop", WEIGHT_TRAINING_BASE, "Ride"),
    ] {
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                     elapsed_time, elevation_gain, sport_type)
                 VALUES (?1, ?2, ?3, 0, 0, 0, 0, ?4)",
                rusqlite::params![id, name, date, sport],
            )
            .expect("an activity");
    }
    engine
        .store_exercise_sets("s1", &[a_set(0, 40.0), a_set(1, 42.5)])
        .expect("sets");
    engine
        .store_exercise_sets("s2", &[a_set(0, 50.0)])
        .expect("sets");
    engine
        .mark_fit_outcome("s1", crate::persistence::FitOutcome::Parsed)
        .expect("outcome");
    engine
        .mark_fit_outcome("s2", crate::persistence::FitOutcome::Parsed)
        .expect("outcome");
    engine
}

fn primary_slug() -> String {
    crate::fit::exercise_muscle_groups(CATEGORY)
        .iter()
        .find(|muscle| muscle.intensity == 2)
        .expect("a primary muscle for the category")
        .slug
        .to_string()
}

/// A wall-clock instant two days into the fixture's week.
const NOW_WALL: i64 = WEIGHT_TRAINING_BASE + 2 * DAY + 1_000;

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_strength_screen_is_the_strength_read_over_the_phones_windows() {
    let engine = engine_with_strength();
    let got = reply(
        &engine,
        &format!(
            r#"{{"id":20,"method":"strength.screen","params":{{"nowWallSeconds":{NOW_WALL},"periodDays":7}}}}"#
        ),
    );
    let (start, end, weeks) = crate::objects::strength::screen_windows(NOW_WALL, 7, STRENGTH_WEEKS);
    let read = crate::objects::strength::strength_screen_from(&engine.db, start, end, weeks)
        .expect("the strength read");
    assert_eq!(got["id"], 20);
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"], wire(&read));
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"]["summary"]["activityCount"], 2);
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"]["weekly"].as_array().unwrap().len(), 4);
}

#[test]
fn the_period_is_the_days_ending_tonight_and_the_weeks_are_seven_days_each() {
    let (start, end, weeks) = crate::objects::strength::screen_windows(NOW_WALL, 7, STRENGTH_WEEKS);
    let day_start = |ts: i64| ts.div_euclid(DAY) * DAY;
    assert_eq!(end, day_start(NOW_WALL) + DAY - 1);
    assert_eq!(start, day_start(NOW_WALL) - 6 * DAY);
    assert_eq!(weeks.len(), 4);
    assert_eq!(weeks[3].end_ts, end as f64);
    for week in &weeks {
        assert_eq!(week.end_ts - week.start_ts + 1.0, (7 * DAY) as f64);
    }
    for pair in weeks.windows(2) {
        assert_eq!(pair[1].start_ts, pair[0].end_ts + 1.0);
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_exercise_detail_is_the_exercise_read_itself() {
    let engine = engine_with_strength();
    let got = reply(
        &engine,
        &format!(
            r#"{{"id":21,"method":"strength.exercise","params":{{"exerciseCategory":{CATEGORY}}}}}"#
        ),
    );
    let read = crate::persistence::screens::exercise_detail_data(&engine.db, CATEGORY)
        .expect("the exercise read");
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"], wire(&read));
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"]["sessions"].as_array().unwrap().len(), 2);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_muscle_detail_is_the_muscle_read_of_one_activity() {
    let engine = engine_with_strength();
    let slug = primary_slug();
    let got = reply(
        &engine,
        &json!({"id":22,"method":"strength.muscle","params":{"activityId":"s1","muscleSlug":slug}})
            .to_string(),
    );
    let read = crate::objects::strength::muscle_detail_from(&engine.db, "s1", &slug)
        .expect("the muscle read");
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"], wire(&read));
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"]["totalSets"], 2.0);
}

fn recording(
    id: &str,
    created_at: i64,
    athlete: Option<&str>,
) -> crate::persistence::recordings::FfiRecordingEntry {
    crate::persistence::recordings::FfiRecordingEntry {
        id: id.to_string(),
        kind: "fit".to_string(),
        fit_path: format!("/recordings/{id}.fit"),
        streams_path: None,
        activity_type: "Ride".to_string(),
        name: format!("Ride {id}"),
        start_time: created_at as f64,
        duration_seconds: 3600.0,
        distance_meters: 20_000.0,
        elevation_gain: Some(120.0),
        avg_heartrate: Some(148.0),
        paired_event_id: None,
        created_at: created_at as f64,
        upload_status: "pending".to_string(),
        retry_count: 0,
        last_attempt_at: None,
        last_error: None,
        intervals_activity_id: None,
        engine_activity_id: None,
        engine_reconciled: false,
        athlete_id: athlete.map(str::to_string),
        notes: None,
        rpe: None,
        rpe_sent: false,
    }
}

/// One recording held by each athlete and one unstamped, so the signed-in
/// athlete's view can be told from the others.
fn engine_with_recordings() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().expect("engine");
    for row in [
        recording("a1", 3_000, Some("iA")),
        recording("b1", 2_000, Some("iB")),
        recording("u1", 1_000, None),
    ] {
        engine.insert_recording(&row).expect("a recording");
    }
    engine
}

#[test]
fn the_recordings_list_is_the_signed_in_athletes_view_of_the_library() {
    let engine = engine_with_recordings();
    let got = reply_as(
        &engine,
        Some("iB"),
        r#"{"id":23,"method":"recordings.list","params":{}}"#,
    );
    let read = crate::persistence::recordings::pooled::list_visible(&engine.db, Some("iB"))
        .expect("the recordings read");
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"], json!({ "recordings": wire(&read) }));
    let ids: Vec<&str> = got["result"]["recordings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["b1", "u1"]);
}

#[test]
fn with_nobody_signed_in_the_list_holds_only_the_unstamped_recordings() {
    let engine = engine_with_recordings();
    let got = reply(
        &engine,
        r#"{"id":24,"method":"recordings.list","params":{}}"#,
    );
    let ids: Vec<&str> = got["result"]["recordings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["u1"]);
}

#[test]
fn a_recording_held_by_another_athlete_is_not_answered() {
    let engine = engine_with_recordings();
    let got = reply_as(
        &engine,
        Some("iB"),
        r#"{"id":25,"method":"recordings.get","params":{"id":"a1"}}"#,
    );
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"], json!({ "recording": null }));

    let got = reply_as(
        &engine,
        Some("iB"),
        r#"{"id":26,"method":"recordings.get","params":{"id":"b1"}}"#,
    );
    let read =
        crate::persistence::recordings::pooled::recording_visible(&engine.db, "b1", Some("iB"))
            .expect("the recording read");
    assert!(got.get("result").is_some(), "{got}");
    assert_eq!(got["result"], json!({ "recording": wire(&read) }));
}

fn reply_from(engine: &PersistentEngine, caller: &Caller, request: &str) -> Value {
    serde_json::from_str(&answer_from(&engine.db, caller, request)).expect("a JSON reply")
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_allowed_setting_is_the_setting_the_phone_reads() {
    let engine = engine_with_rides();
    engine
        .db
        .execute(
            "INSERT INTO settings (key, value) VALUES ('veloq-unit-preference', 'imperial')",
            [],
        )
        .unwrap();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"settings.get","params":{"keys":["veloq-unit-preference","veloq-theme-preference"]}}"#,
    );
    let phone =
        crate::persistence::settings::setting_from(&engine.db, "veloq-unit-preference").unwrap();
    assert_eq!(phone.as_deref(), Some("imperial"));
    assert_eq!(
        got["result"]["values"],
        json!([
            { "key": "veloq-unit-preference", "value": "imperial" },
            { "key": "veloq-theme-preference", "value": null },
        ])
    );
    assert_eq!(got["result"]["refused"], json!([]));
}

#[test]
fn a_setting_outside_the_allow_list_is_refused_and_its_value_never_crosses() {
    let engine = engine_with_rides();
    let secret = "k3y-value-that-must-not-cross";
    for key in ["intervals-api-key", "__athlete_id", "oauth-token"] {
        engine
            .db
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                [key, secret],
            )
            .unwrap();
    }
    let text = answer(
        &engine.db,
        r#"{"id":1,"method":"settings.get","params":{"keys":["intervals-api-key","veloq-unit-preference","__athlete_id","oauth-token"]}}"#,
    );
    assert!(!text.contains(secret), "{text}");
    let got: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        got["result"]["refused"],
        json!(["intervals-api-key", "__athlete_id", "oauth-token"])
    );
    let answered: Vec<&str> = got["result"]["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["key"].as_str().unwrap())
        .collect();
    assert_eq!(answered, ["veloq-unit-preference"]);
}

#[test]
fn no_allowed_setting_key_is_a_credential_or_an_account_key() {
    for key in SETTING_KEYS {
        let lowered = key.to_lowercase();
        assert!(
            ![
                "key",
                "token",
                "secret",
                "password",
                "credential",
                "athlete"
            ]
            .iter()
            .any(|word| lowered.contains(word)),
            "{key}"
        );
        assert!(!key.starts_with("__"), "{key}");
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_profile_is_the_profile_the_phone_reads() {
    let engine = engine_with_rides();
    engine
        .set_athlete_profile(r#"{"id":"i42","name":"Ada","icu_weight":61.5}"#)
        .unwrap();
    let got = reply(&engine, r#"{"id":1,"method":"settings.profile"}"#);
    let profile = crate::persistence::settings::athlete_profile(&engine.db);
    assert_eq!(got["result"], serde_json::to_value(&profile).unwrap());
    assert_eq!(got["result"]["name"], "Ada");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn each_status_is_the_read_the_phone_screen_makes() {
    let engine = engine_with_rides();
    let status = |method: &str| {
        reply(
            &engine,
            &format!(r#"{{"id":1,"method":"{method}","params":{{}}}}"#),
        )["result"]
            .clone()
    };
    let jobs = crate::persistence::screens::background_jobs_data(&engine.db).unwrap();
    assert_eq!(
        status("status.backgroundJobs"),
        serde_json::to_value(&jobs).unwrap()
    );
    let cache = crate::persistence::screens::cache_screen_data(&engine.db).unwrap();
    assert_eq!(
        status("status.cache"),
        serde_json::to_value(&cache).unwrap()
    );
    let backup = crate::persistence::screens::backup_screen_data(&engine.db).unwrap();
    assert_eq!(
        status("status.backup"),
        serde_json::to_value(&backup).unwrap()
    );
    let coverage = crate::objects::sync::library_coverage_of(&engine.db);
    assert_eq!(
        status("status.coverage"),
        serde_json::to_value(coverage).unwrap()
    );
    assert!(status("status.sync").get("state").is_some());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_linked_devices_mark_the_browser_that_asked() {
    let engine = engine_with_rides();
    crate::persistence::linked_devices::add(&engine.db, "Laptop", "sha-256 AA", 10).unwrap();
    crate::persistence::linked_devices::add(&engine.db, "Desk", "sha-256 BB", 20).unwrap();
    let connections = vec![("sha-256 BB".to_string(), 30)];
    let caller = Caller {
        browser: "sha-256 BB",
        athlete: None,
        connections: &connections,
    };
    let got = reply_from(
        &engine,
        &caller,
        r#"{"id":1,"method":"status.linkedDevices","params":{}}"#,
    );
    let devices = got["result"]["devices"].as_array().unwrap();
    assert_eq!(devices.len(), 2);
    let desk = devices.iter().find(|d| d["name"] == "Desk").unwrap();
    assert_eq!(got["result"]["thisBrowser"], desk["id"]);
    assert_eq!(desk["connectedSince"], 30.0);
    let text = got.to_string();
    assert!(!text.contains("sha-256"), "a fingerprint crossed: {text}");

    let stranger = Caller {
        browser: "sha-256 CC",
        athlete: None,
        connections: &connections,
    };
    let got = reply_from(
        &engine,
        &stranger,
        r#"{"id":2,"method":"status.linkedDevices","params":{}}"#,
    );
    assert_eq!(got["result"]["thisBrowser"], Value::Null);
}

const WATTS_BODY: &str =
    r#"[{"type":"time","data":[0,1,2,3]},{"type":"watts","data":[100,150,200,250]}]"#;

/// A ride with series, two laps, a custom section cut from it and one
/// strength set stored under another activity.
fn engine_with_a_whole_ride() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .upsert_activity_bodies(&[(
            "r1".into(),
            1_736_940_000,
            r#"{"id":"r1","type":"Ride","name":"Hill repeats","moving_time":3600}"#.into(),
        )])
        .expect("bodies");
    engine
        .set_interval_body(
            "r1",
            r#"{"icu_intervals":[
                {"id":1,"type":"WORK","start_time":0,"end_time":2,"start_index":0,"end_index":2},
                {"id":2,"type":"RECOVERY","start_time":2,"end_time":4,"start_index":2,"end_index":4}]}"#,
        )
        .expect("laps");
    engine
        .set_stream_body("r1", "time,watts", WATTS_BODY)
        .expect("series");
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at, source_activity_id,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('c1', 'custom', 'Lantern', 'Ride', '[[46.2,7.3],[46.21,7.3]]', 400.0, 1, 1,
                '2026-01-01T00:00:00Z', 'r1', 46.2, 46.21, 7.3, 7.31)",
            [],
        )
        .expect("insert the section");
    engine
        .store_exercise_sets(
            "r1",
            &[crate::fit::FitExerciseSet {
                set_order: 0,
                exercise_category: 7,
                exercise_name: None,
                set_type: 0,
                repetitions: Some(5),
                weight_kg: Some(40.0),
                duration_secs: Some(30.0),
                start_time: None,
            }],
        )
        .expect("sets");
    engine
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_detail_is_the_detail_read_itself() {
    let engine = engine_with_a_whole_ride();
    let got = result_of(&engine, "activity.detail", r#"{"id":"r1"}"#);
    let read = crate::persistence::screens::pooled::activity_detail_data(&engine.db, "r1", 1);
    assert_eq!(got, serde_json::to_value(&read).unwrap());
    assert_eq!(got["customSections"][0]["id"], "c1");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_record_is_the_typed_record_the_phone_reads() {
    let engine = engine_with_a_whole_ride();
    let got = result_of(&engine, "activity.record", r#"{"id":"r1"}"#);
    let read = crate::persistence::activities::pooled::activity_record(&engine.db, "r1")
        .unwrap()
        .unwrap();
    assert_eq!(got["record"], serde_json::to_value(&read).unwrap());
    let missing = result_of(&engine, "activity.record", r#"{"id":"nope"}"#);
    assert_eq!(missing["record"], Value::Null);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_streams_are_the_chart_series_with_bytes_as_base64() {
    let engine = engine_with_a_whole_ride();
    let got = result_of(
        &engine,
        "activity.streams",
        r#"{"id":"r1","types":["watts","time"]}"#,
    );
    let (body, _) =
        crate::persistence::bodies::pooled::stream_body(&engine.db, "r1", "time,watts").unwrap();
    let read = crate::net::chart_streams::chart_streams_from_body(&body.unwrap(), "Ride").unwrap();
    assert_eq!(got, serde_json::to_value(&read).unwrap());
    let watts = got["watts"].as_str().expect("a base64 string");
    assert!(!watts.is_empty());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn streams_for_an_activity_with_none_are_empty_not_an_error() {
    let engine = engine_with_a_whole_ride();
    let got = result_of(
        &engine,
        "activity.streams",
        r#"{"id":"nope","types":["watts"]}"#,
    );
    assert_eq!(got["watts"], "");
    assert_eq!(got["latlng"], "");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_laps_are_the_stored_intervals() {
    let engine = engine_with_a_whole_ride();
    let got = result_of(&engine, "activity.intervals", r#"{"id":"r1"}"#);
    let read = crate::persistence::intervals::activity_intervals(&engine.db, "r1")
        .unwrap()
        .unwrap();
    assert_eq!(got["intervals"], serde_json::to_value(&read).unwrap());
    assert_eq!(got["intervals"]["intervals"].as_array().unwrap().len(), 2);
    let none = result_of(&engine, "activity.intervals", r#"{"id":"nope"}"#);
    assert_eq!(none["intervals"], Value::Null);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_custom_sections_are_those_naming_the_activity() {
    let engine = engine_with_a_whole_ride();
    let got = result_of(&engine, "activity.sections", r#"{"id":"r1"}"#);
    assert_eq!(got["sections"].as_array().unwrap().len(), 1);
    assert_eq!(got["sections"][0]["id"], "c1");
    let none = result_of(&engine, "activity.sections", r#"{"id":"nope"}"#);
    assert!(none["sections"].as_array().unwrap().is_empty());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_exercise_sets_are_the_session_the_phone_reads() {
    let engine = engine_with_a_whole_ride();
    let got = result_of(&engine, "activity.exerciseSets", r#"{"id":"r1"}"#);
    assert_eq!(got["activeSetCount"], 1);
    assert_eq!(got["sets"][0]["repetitions"], 5);
    let none = result_of(&engine, "activity.exerciseSets", r#"{"id":"nope"}"#);
    assert_eq!(none["activeSetCount"], 0);
}

fn engine_with_a_mapped_ride() -> PersistentEngine {
    let mut engine = engine_with_rides();
    engine
        .upsert_activity_bodies(&[(
            "out".into(),
            1_737_050_000,
            r#"{"id":"out","type":"Ride","name":"Lake loop","distance":42000,"stream_types":["latlng","time"]}"#
                .into(),
        )])
        .expect("bodies");
    engine
}

/// Scenario: a range and a sport asked of the map over the link.
///
/// Expected behaviour: the activities, counts and unmapped figures are the
/// ones the engine's own map read answers for the same parameters, with no
/// layer in them.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_map_screen_is_the_map_read_without_its_layers() {
    let engine = engine_with_a_mapped_ride();
    let got = reply(
        &engine,
        r#"{"id":3,"method":"map.screen","params":{"startDate":0,"endDate":2000000000,"sportTypes":["Ride"],"distanceBand":"all","isMetric":true,"nameNeedle":""}}"#,
    );

    let read = crate::persistence::screens::pooled::map_screen_data(
        &engine.db,
        0,
        2_000_000_000,
        vec!["Ride".into()],
        crate::MapDistanceBand::All,
        true,
        crate::persistence::screens::pooled::MapLayers::default(),
        String::new(),
    );
    assert_eq!(
        got["result"]["screen"],
        serde_json::to_value(&read).unwrap()
    );
    assert!(got["result"]["screen"]["routeLines"].is_null());
    assert!(got["result"]["screen"]["sections"].is_null());
    assert_eq!(
        got["result"]["screen"]["activityCount"],
        read.activity_count
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_map_screen_refuses_a_distance_band_it_does_not_know() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":3,"method":"map.screen","params":{"startDate":0,"endDate":1,"distanceBand":"marathon"}}"#,
    );
    assert!(got["error"].as_str().unwrap().starts_with("bad params"));
}

fn encoded(points: &[(f64, f64)]) -> Vec<u8> {
    let points: Vec<crate::GpsPoint> = points
        .iter()
        .map(|&(lat, lng)| crate::GpsPoint::new(lat, lng))
        .collect();
    crate::persistence::codec::encode_polyline(&points)
}

fn section(id: &str, name: Option<&str>, points: &[(f64, f64)]) -> crate::FfiMapSection {
    crate::FfiMapSection {
        id: id.into(),
        name: name.map(Into::into),
        sport_types: vec!["Ride".into()],
        visit_count: 7,
        distance_meters: 412.5,
        klass: None,
        max_grade_percent: None,
        encoded_polyline: encoded(points),
    }
}

/// Scenario: a section line under two finite points, and a good one.
///
/// Expected behaviour: one feature, carrying the id, name, visit count,
/// length and palette key; the single-point section is left out.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_section_layer_writes_one_feature_per_section_with_a_line() {
    let sections = [
        section("s_a", Some("Col \"1\""), &[(46.2, 7.3), (46.21, 7.31)]),
        section("s_b", None, &[(46.3, 7.3)]),
    ];

    let text = crate::basemap::sections_features(sections.iter());

    let layer: Value = serde_json::from_str(&text).expect("GeoJSON");
    let features = layer["features"].as_array().unwrap();
    assert_eq!(features.len(), 1);
    let feature = &features[0];
    assert_eq!(feature["geometry"]["type"], "LineString");
    assert_eq!(
        feature["geometry"]["coordinates"],
        json!([[7.3, 46.2], [7.31, 46.21]])
    );
    assert_eq!(feature["properties"]["id"], "s_a");
    assert_eq!(feature["properties"]["name"], "Col \"1\"");
    assert_eq!(feature["properties"]["visitCount"], 7);
    assert_eq!(feature["properties"]["distanceMeters"], 412.5);
    assert_eq!(
        feature["properties"]["palette"],
        crate::basemap::palette_key("s_a")
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_section_layer_is_empty_without_sections() {
    let engine = engine_with_rides();
    let got = reply(&engine, r#"{"id":1,"method":"geo.sections","params":{}}"#);
    let layer: Value = serde_json::from_str(got["result"]["text"].as_str().unwrap()).unwrap();
    assert_eq!(layer, json!({"type":"FeatureCollection","features":[]}));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_route_layer_is_the_collection_the_phone_fetches() {
    let engine = engine_with_rides();
    let got = reply(&engine, r#"{"id":1,"method":"geo.routeLines","params":{}}"#);
    assert_eq!(
        got["result"]["text"],
        crate::basemap::route_lines_collection(&engine.db).unwrap()
    );
}

/// Scenario: a tile the pass drew, one with no heat, and tiles outside the
/// heatmap's zooms or off the world.
///
/// Expected behaviour: the drawn tile is the bytes the phone's tile source
/// serves over that base; a tile with no heat is null; z0, z18, an unknown
/// base and a column off the world are errors.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_heatmap_tile_is_the_tile_the_phone_serves() {
    let _serial = crate::test_globals::serial_global_state();
    let tmp = tempfile::tempdir().expect("tempdir");
    let drawn_png = crate::tiles::encode_indexed_png(&vec![1u8; 512 * 512]);
    let column = tmp.path().join("3").join("1");
    std::fs::create_dir_all(&column).expect("column");
    std::fs::write(column.join("2.png"), drawn_png).expect("tile");
    crate::persistence::tiles::serve_heatmap_dir_for_test(Some(tmp.path()));
    let engine = engine_with_rides();
    let ask = |z: u32, x: u32, y: u32, base: &str| {
        reply(
            &engine,
            &format!(
                r#"{{"id":1,"method":"heatmap.tile","params":{{"z":{z},"x":{x},"y":{y},"base":"{base}"}}}}"#
            ),
        )
    };

    let drawn = ask(3, 1, 2, "dark");
    let empty = ask(3, 1, 3, "dark");
    let too_deep = ask(18, 0, 0, "dark");
    let world = ask(0, 0, 0, "dark");
    let unknown = ask(3, 1, 2, "sepia");
    let off = ask(3, 8, 2, "dark");
    let phone = match crate::basemap::lookup_tile("heatmap-dark", 3, 1, 2) {
        crate::basemap::TileLookup::Ready(bytes) => bytes,
        _ => panic!("the phone serves the drawn tile"),
    };
    crate::persistence::tiles::serve_heatmap_dir_for_test(None);

    use base64::Engine as _;
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(drawn["result"]["png"].as_str().unwrap())
            .unwrap(),
        phone
    );
    assert!(empty["result"]["png"].is_null());
    for refused in [too_deep, world, unknown, off] {
        assert!(refused["error"].is_string(), "{refused}");
    }
}

fn insights_ask(now: i64) -> crate::FfiInsightsParams {
    crate::FfiInsightsParams {
        history_limit: 20,
        current_start: 0.0,
        current_end: now as f64,
        prev_start: 0.0,
        prev_end: 0.0,
        chronic_start: 0.0,
        today_start: (now - 50_000) as f64,
        include_sections: true,
        ranked_limit: 50,
        active_window_days: 90,
        efficiency_per_sport: 5,
        efficiency_min_hr_change_bpm: 1,
        efficiency_limit: 2,
        efficiency_min_efforts: 1,
        efficiency_declining_min_efforts: 3,
        strength_month: crate::FfiTimestampRange {
            start_ts: (now - 28 * 86_400) as f64,
            end_ts: now as f64,
        },
        strength_weeks: Vec::new(),
        wellness_oldest: "2025-01-01".into(),
        wellness_newest: "2025-01-31".into(),
        hrv_window_days: 7,
        section_change_window_days: 14,
        stale_threshold_days: 30,
        stale_min_gain_percent: 3.0,
        stale_max_opportunities: 3,
        stale_min_traversals: 1,
        recent_pr_window_days: 7,
        recent_pr_min_outings: 3,
    }
}

/// The two rides with the metrics rows the insights read totals.
fn engine_with_ride_metrics() -> PersistentEngine {
    let mut engine = engine_with_rides();
    let metrics =
        |id: &str, date: i64, sport: &str, moving_time: u32| crate::types::ActivityMetrics {
            activity_id: id.into(),
            name: id.into(),
            date,
            distance: 20_000.0,
            moving_time,
            elapsed_time: moving_time,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: sport.into(),
            training_load: Some(50.0),
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        };
    engine
        .set_activity_metrics(vec![
            metrics("i1", 1_736_940_000, "Ride", 3600),
            metrics("i2", 1_737_040_000, "Run", 1800),
        ])
        .expect("metrics");
    engine
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_insights_read_is_the_insights_screen_read_itself() {
    let engine = engine_with_ride_metrics();
    let ask = insights_ask(1_737_050_000);
    let request = json!({"id": 11, "method": "insights.data", "params": ask}).to_string();
    let got = reply(&engine, &request);

    let params = crate::objects::fitness::with_week_bounds(ask);
    let read = crate::persistence::screens::pooled::insights_data(&engine.db, &params);
    assert_eq!(got["id"], 11);
    assert_eq!(got["result"], serde_json::to_value(&read).unwrap());
    // The week the bounds put 1_737_050_000 in holds both rides.
    assert_eq!(got["result"]["currentWeek"]["count"], 2);
    assert_eq!(got["result"]["currentWeek"]["totalDuration"], 5400.0);
}

#[test]
fn the_insights_read_derives_its_week_windows_from_the_clock_it_is_given() {
    let engine = engine_with_ride_metrics();
    // The ask carries zeros for every window, as the phone's does: a page that
    // sent its own would otherwise get a different week from the phone.
    let mut ask = insights_ask(1_737_050_000);
    ask.current_start = 5.0;
    ask.chronic_start = 7.0;
    let request = json!({"id": 12, "method": "insights.data", "params": ask}).to_string();
    let got = reply(&engine, &request);
    assert_eq!(got["result"]["currentWeek"]["count"], 2);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_planned_events_and_workout_sections_are_the_phones_reads() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":13,"method":"insights.plannedEvents","params":{"oldestTs":0,"newestTs":2000000000}}"#,
    );
    let events = crate::persistence::calendar::pooled::planned_events(&engine.db, 0, 2_000_000_000)
        .expect("events");
    assert_eq!(
        got["result"],
        json!({ "events": serde_json::to_value(&events).unwrap() })
    );

    let got = reply(
        &engine,
        r#"{"id":14,"method":"insights.workoutSections","params":{"sportType":"Ride","limit":5}}"#,
    );
    assert_eq!(got["result"], json!({ "sections": [] }));
}

/// Two rides on one route and one section they both traverse, with a ledger
/// row that names a ride and a retired section.
fn engine_with_a_route_and_a_section() -> PersistentEngine {
    let mut engine = engine_with_rides();
    let metrics: Vec<crate::types::ActivityMetrics> =
        [("r1", 1_700_000_000i64), ("r2", 1_700_086_400)]
            .into_iter()
            .map(|(id, date)| crate::types::ActivityMetrics {
                activity_id: id.into(),
                name: format!("Loop {id}"),
                date,
                distance: 1000.0,
                moving_time: 300,
                elapsed_time: 300,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".into(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            })
            .collect();
    for id in ["r1", "r2"] {
        let track = (0..60)
            .map(|i| crate::GpsPoint {
                latitude: 46.0 + f64::from(i) * 0.001,
                longitude: 7.0,
                elevation: None,
            })
            .collect();
        engine
            .add_activity(id.into(), track, "Ride".into())
            .expect("activity");
    }
    engine.set_activity_metrics(metrics).expect("metrics");
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
             VALUES ('g1', 'r1', '[\"r1\",\"r2\"]', 'Ride', 2)",
            [],
        )
        .expect("group");
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, disabled, version, source_activity_id)
             VALUES ('s1', 'auto', 'Lake climb', 'Ride', '[[46.0,7.0],[46.001,7.0]]', 800.0, 0, 1, NULL)",
            [],
        )
        .expect("section");
    for (activity, lap_time) in [("r1", 200.0f64), ("r2", 240.0)] {
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                 VALUES ('s1', ?1, 'same', 0, 40, 800.0, ?2, ?3, ?4)",
                rusqlite::params![
                    activity,
                    lap_time,
                    800.0 / lap_time,
                    i32::from(activity == "r2")
                ],
            )
            .expect("traversal");
    }
    engine
        .append_section_history(
            "s1",
            "recut",
            Some(r#"{"around":["r1","r2","gone"]}"#),
            None,
        )
        .expect("ledger row");
    engine
}

fn error_of(engine: &PersistentEngine, method: &str, params: &str) -> String {
    let got = reply(
        engine,
        &format!(r#"{{"id":1,"method":"{method}","params":{params}}}"#),
    );
    got["error"]
        .as_str()
        .unwrap_or_else(|| panic!("{method} answered {got}"))
        .to_owned()
}

fn as_json<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serialises")
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_routes_screen_is_the_screen_read_itself() {
    let engine = engine_with_a_route_and_a_section();
    let got = result_of(
        &engine,
        "routes.screen",
        r#"{"groupLimit":10,"sectionSearch":"lake"}"#,
    );
    let query = crate::FfiRoutesScreenQuery {
        group_limit: 10,
        section_search: "lake".into(),
        ..Default::default()
    };
    let read = crate::persistence::pooled_routes_screen_data(&engine.db, query);
    assert_eq!(got, as_json(&read));
    assert_eq!(got["sections"].as_array().map(Vec::len), Some(1));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_routes_page_larger_than_the_cap_is_cut_to_it() {
    let engine = engine_with_a_route_and_a_section();
    let got = result_of(
        &engine,
        "routes.screen",
        r#"{"groupLimit":100000,"sectionLimit":100000}"#,
    );
    let query = crate::FfiRoutesScreenQuery {
        group_limit: MAX_PAGE,
        section_limit: MAX_PAGE,
        ..Default::default()
    };
    let read = crate::persistence::pooled_routes_screen_data(&engine.db, query);
    assert_eq!(got, as_json(&read));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn route_reads_are_the_phones_reads() {
    use crate::persistence::sections::lap_curves::pooled::CurveRead;
    let engine = engine_with_a_route_and_a_section();
    let detail = result_of(&engine, "route.detail", r#"{"id":"g1"}"#);
    assert_eq!(
        detail,
        as_json(&crate::persistence::screens::pooled::route_detail_data(
            &engine.db, "g1"
        ))
    );
    assert_eq!(detail["group"]["groupId"], "g1");

    let performance = result_of(
        &engine,
        "route.performance",
        r#"{"id":"g1","timeRangeDays":365,"sportFilter":"Ride","highlightActivityId":"r1"}"#,
    );
    assert_eq!(
        performance,
        as_json(
            &crate::persistence::screens::pooled::route_detail_performance(
                &engine.db,
                "g1",
                365,
                Some("Ride"),
                Some("r1"),
                CurveRead::Computed,
            )
        )
    );
    assert_eq!(performance["curvesPending"], false);

    let attempts = result_of(
        &engine,
        "route.attempts",
        r#"{"id":"g1","currentActivityId":"r2"}"#,
    );
    assert_eq!(
        attempts,
        as_json(&crate::FfiRoutePerformanceResult::from(
            crate::persistence::fitness::performances::route_performances_of(
                &engine.db,
                "g1",
                Some("r2"),
                None,
            )
        ))
    );
    assert_eq!(attempts["performances"].as_array().map(Vec::len), Some(2));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn section_reads_are_the_phones_reads() {
    use crate::persistence::sections::lap_curves::pooled::CurveRead;
    let engine = engine_with_a_route_and_a_section();
    let detail = result_of(&engine, "section.detail", r#"{"id":"s1"}"#);
    assert_eq!(
        detail,
        as_json(&crate::persistence::screens::pooled::section_detail_data(
            &engine.db, "s1"
        ))
    );
    assert_eq!(detail["section"]["id"], "s1");

    let performance = result_of(
        &engine,
        "section.performance",
        r#"{"id":"s1","timeRangeDays":3650}"#,
    );
    assert_eq!(
        performance,
        as_json(
            &crate::persistence::screens::pooled::section_detail_performance(
                &engine.db,
                "s1",
                3650,
                None,
                None,
                CurveRead::Computed,
            )
        )
    );

    let excluded = result_of(&engine, "section.excluded", r#"{"id":"s1"}"#);
    assert_eq!(excluded["activityIds"], json!(["r2"]));
    assert_eq!(
        result_of(&engine, "sections.retired", "{}"),
        as_json(&*crate::persistence::screens::pooled::retired_map_data(
            &engine.db
        ))
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_section_history_carries_both_versions_and_the_names_its_chips_draw() {
    let engine = engine_with_a_route_and_a_section();
    let got = result_of(&engine, "section.history", r#"{"id":"s1"}"#);
    let detail = result_of(&engine, "section.detail", r#"{"id":"s1"}"#);
    assert_eq!(got["history"], detail["history"]);
    assert_eq!(got["geometryVersions"], detail["geometryVersions"]);
    assert_eq!(got["pinnedVersion"], detail["pinnedVersion"]);
    assert!(!got["history"].as_array().expect("rows").is_empty());
    let names: Vec<(&str, &str)> = got["names"]
        .as_array()
        .expect("names")
        .iter()
        .map(|n| {
            (
                n["activityId"].as_str().unwrap(),
                n["name"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(names, vec![("r1", "Loop r1"), ("r2", "Loop r2")]);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_unknown_route_or_section_is_an_error_naming_it() {
    let engine = engine_with_a_route_and_a_section();
    for (method, params, named) in [
        ("route.detail", r#"{"id":"nope"}"#, "nope"),
        (
            "route.performance",
            r#"{"id":"nope","timeRangeDays":30}"#,
            "nope",
        ),
        ("route.attempts", r#"{"id":"nope"}"#, "nope"),
        ("section.detail", r#"{"id":"ghost"}"#, "ghost"),
        (
            "section.performance",
            r#"{"id":"ghost","timeRangeDays":30}"#,
            "ghost",
        ),
        ("section.history", r#"{"id":"ghost"}"#, "ghost"),
        ("section.excluded", r#"{"id":"ghost"}"#, "ghost"),
    ] {
        let error = error_of(&engine, method, params);
        assert!(error.contains(named), "{method} answered {error}");
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn heatmap_progress_is_zero_while_no_pass_runs() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"heatmap.progress","params":{}}"#,
    );
    assert_eq!(got["result"], json!({"processed":0,"total":0}));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_catalogue_reason_that_carries_data_is_written_as_the_page_reads_it() {
    use crate::{FfiCatalogueEmptyReason as Reason, FfiDetectionHold as Hold};
    for (reason, written) in [
        (Reason::NoGpsActivities, json!("noGpsActivities")),
        (
            Reason::NotYetRun { awaiting: 3 },
            json!({"notYetRun": {"awaiting": 3}}),
        ),
        (
            Reason::Running {
                phase: "scan".into(),
                percent: 40,
            },
            json!({"running": {"phase": "scan", "percent": 40}}),
        ),
        (
            Reason::Held {
                hold: Hold::ElevationWaiting { remaining: 7 },
            },
            json!({"held": {"hold": {"elevationWaiting": {"remaining": 7}}}}),
        ),
        (
            Reason::Held {
                hold: Hold::Cutover,
            },
            json!({"held": {"hold": "cutover"}}),
        ),
        (
            Reason::NoneFound { min_activities: 2 },
            json!({"noneFound": {"minActivities": 2}}),
        ),
    ] {
        assert_eq!(as_json(&reason), written);
    }
    assert_eq!(
        as_json(&crate::FfiCorrelation::TooFew { n: 4 }),
        json!({"tooFew": {"n": 4}})
    );
    assert_eq!(
        as_json(&crate::FfiCorrelation::Mover {
            r: 0.5,
            n: 30,
            low: 0.1,
            high: 0.8
        }),
        json!({"mover": {"r": 0.5, "n": 30, "low": 0.1, "high": 0.8}})
    );
    assert_eq!(as_json(&Hold::ElevationPaused), json!("elevationPaused"));
    assert_eq!(as_json(&Hold::ElevationRunning), json!("elevationRunning"));
}

fn overlay_line(points: &[(f64, f64)]) -> Vec<u8> {
    let points: Vec<crate::GpsPoint> = points
        .iter()
        .map(|&(lat, lng)| crate::GpsPoint::new(lat, lng))
        .collect();
    crate::persistence::codec::encode_polyline(&points)
}

/// Scenario: two matched sections, one traced in two directions, the first
/// holding the record.
///
/// Expected behaviour: both section lines, a portion per direction in the
/// order of the encounters, and a record point at the first section's start.
#[test]
fn the_overlay_writes_sections_portions_and_the_record_point() {
    let s_a = overlay_line(&[(46.2, 7.3), (46.21, 7.31)]);
    let s_b = overlay_line(&[(46.3, 7.3), (46.31, 7.31)]);
    let trace = overlay_line(&[(46.2, 7.3), (46.205, 7.305)]);
    let sections = [
        crate::basemap::OverlaySection {
            id: "s_a",
            name: Some("Col"),
            polyline: &s_a,
        },
        crate::basemap::OverlaySection {
            id: "s_b",
            name: None,
            polyline: &s_b,
        },
    ];
    let encounters = [
        crate::basemap::OverlayEncounter {
            section_id: "s_b",
            direction: "reverse",
            is_pr: false,
        },
        crate::basemap::OverlayEncounter {
            section_id: "s_a",
            direction: "forward",
            is_pr: true,
        },
        crate::basemap::OverlayEncounter {
            section_id: "s_a",
            direction: "reverse",
            is_pr: false,
        },
    ];

    let text = crate::basemap::activity_overlay_features(
        &sections,
        &[("s_a", trace.as_slice())],
        &encounters,
        &["s_a"],
    );

    let layer: Value = serde_json::from_str(&text).expect("GeoJSON");
    let features = layer["features"].as_array().unwrap();
    let kinds: Vec<_> = features
        .iter()
        .map(|f| f["properties"]["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["section", "section", "portion", "portion", "pr"]);
    assert_eq!(features[0]["properties"]["id"], "s_b");
    assert_eq!(features[1]["properties"]["id"], "s_a");
    assert_eq!(features[1]["properties"]["name"], "Col");
    assert_eq!(features[1]["properties"]["isPR"], true);
    assert_eq!(features[0]["properties"]["isPR"], false);
    assert_eq!(features[2]["properties"]["direction"], "forward");
    assert_eq!(features[2]["properties"]["isPR"], true);
    assert_eq!(features[3]["properties"]["direction"], "reverse");
    assert_eq!(features[3]["properties"]["isPR"], false);
    assert_eq!(features[2]["properties"]["sectionId"], "s_a");
    assert_eq!(
        features[4]["geometry"],
        json!({"type":"Point","coordinates":[7.3, 46.2]})
    );
    assert!(features[1]["properties"]["colorIndex"].as_u64().unwrap() < 8);
}

#[test]
fn the_overlay_leaves_out_a_line_under_two_points() {
    let one = overlay_line(&[(46.2, 7.3)]);
    let sections = [crate::basemap::OverlaySection {
        id: "s_a",
        name: None,
        polyline: &one,
    }];
    let text = crate::basemap::activity_overlay_features(
        &sections,
        &[("s_a", one.as_slice())],
        &[],
        &["s_a"],
    );
    let layer: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(layer, json!({"type":"FeatureCollection","features":[]}));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_activity_without_a_track_or_sections_answers_empty_collections() {
    let engine = engine_with_rides();
    let empty = json!({"type":"FeatureCollection","features":[]});
    for method in ["geo.track", "geo.activityOverlay"] {
        let got = reply(
            &engine,
            &format!(r#"{{"id":1,"method":"{method}","params":{{"id":"i1"}}}}"#),
        );
        let layer: Value = serde_json::from_str(got["result"]["text"].as_str().unwrap()).unwrap();
        assert_eq!(layer, empty, "{method}");
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_track_is_the_line_the_phone_fetches() {
    let mut engine = engine_with_rides();
    let points = vec![
        crate::GpsPoint::new(46.2, 7.3),
        crate::GpsPoint::new(46.21, 7.31),
        crate::GpsPoint::new(46.22, 7.32),
    ];
    engine
        .add_activity("i1".into(), points.clone(), "Ride".into())
        .expect("track");
    let got = reply(
        &engine,
        r#"{"id":1,"method":"geo.track","params":{"id":"i1"}}"#,
    );
    assert_eq!(got["result"]["text"], crate::basemap::line_feature(&points));
}

fn geo_text(engine: &PersistentEngine, method: &str, params: &str) -> String {
    let got = reply(
        engine,
        &format!(r#"{{"id":1,"method":"{method}","params":{params}}}"#),
    );
    got["result"]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("{method} answered {got}"))
        .to_string()
}

/// Expected behaviour: the route's line is the stored representative's
/// track written as a line feature, byte for byte; an unknown group is the
/// empty collection.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_route_line_is_the_stored_representative() {
    let engine = engine_with_a_route_and_a_section();
    let representative = engine
        .get_representative_route("g1")
        .expect("representative");
    assert_eq!(
        geo_text(&engine, "geo.route", r#"{"groupId":"g1"}"#),
        crate::basemap::line_feature(&representative)
    );
    let empty = r#"{"type":"FeatureCollection","features":[]}"#;
    assert_eq!(
        geo_text(&engine, "geo.route", r#"{"groupId":"nope"}"#),
        empty
    );
    assert_eq!(
        geo_text(&engine, "geo.routeLatest", r#"{"groupId":"nope"}"#),
        empty
    );
}

/// Expected behaviour: the latest ride is the group's newest member by date,
/// written as its stored track.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_latest_ride_is_the_newest_member_of_the_group() {
    let engine = engine_with_a_route_and_a_section();
    // r2 is a day newer than r1; give it a distinct track.
    let shifted: Vec<crate::GpsPoint> = (0..60)
        .map(|i| crate::GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.001,
            longitude: 7.5,
            elevation: None,
        })
        .collect();
    let mut engine = engine;
    engine
        .add_activity("r2".into(), shifted, "Ride".into())
        .expect("retrack r2");
    let latest = engine.get_gps_track("r2").expect("r2 track");
    assert_eq!(
        geo_text(&engine, "geo.routeLatest", r#"{"groupId":"g1"}"#),
        crate::basemap::line_feature(&latest)
    );
}

/// Scenario: a section with passes by two activities, and one by an activity
/// that holds no track.
///
/// Expected behaviour: one `LineString` per pass with a track, sliced at the
/// stored track's positions `start_index` to `end_index` inclusive, with the
/// activity id, direction and distance; the pass with no track is left out
/// and counted in the collection's `withoutTrack`.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn section_passes_are_sliced_from_each_stored_track() {
    let mut engine = engine_with_a_route_and_a_section();
    engine
        .add_activity(
            "gone".into(),
            vec![crate::GpsPoint::new(46.0, 7.0); 6],
            "Ride".into(),
        )
        .expect("an activity");
    engine
        .db
        .execute("DELETE FROM gps_tracks WHERE activity_id = 'gone'", [])
        .expect("an activity with no track");
    engine
        .db
        .execute("UPDATE section_activities SET excluded = 0, start_index = 10, end_index = 20 WHERE activity_id = 'r2'", [])
        .expect("r2 pass");
    engine
        .db
        .execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                 start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
             VALUES ('s1', 'gone', 'reverse', 0, 5, 100.0, 20.0, 5.0, 0)",
            [],
        )
        .expect("a pass with no track");

    let text = geo_text(&engine, "geo.sectionPasses", r#"{"sectionId":"s1"}"#);

    let layer: Value = serde_json::from_str(&text).expect("GeoJSON");
    assert_eq!(layer["properties"]["withoutTrack"], 1);
    let features = layer["features"].as_array().unwrap();
    assert_eq!(features.len(), 2);
    for (feature, (activity, from, to)) in features
        .iter()
        .zip([("r1", 0usize, 40usize), ("r2", 10, 20)])
    {
        let track = engine.get_gps_track(activity).unwrap();
        let slice = crate::basemap::line_feature(&track[from..=to]);
        let want: Value = serde_json::from_str(&slice).unwrap();
        assert_eq!(feature["geometry"], want["geometry"]);
        assert_eq!(feature["properties"]["activityId"], activity);
        assert_eq!(feature["properties"]["direction"], "same");
        assert!(feature["properties"]["distanceMeters"].is_number());
    }
}

/// Expected behaviour: the section's line carries its id, name and palette;
/// an unknown section is the empty collection for both reads.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_section_line_carries_its_identity() {
    let engine = engine_with_a_route_and_a_section();
    let layer: Value =
        serde_json::from_str(&geo_text(&engine, "geo.section", r#"{"sectionId":"s1"}"#)).unwrap();
    let features = layer["features"].as_array().unwrap();
    assert_eq!(features.len(), 1);
    assert_eq!(features[0]["properties"]["id"], "s1");
    assert_eq!(features[0]["properties"]["name"], "Lake climb");
    assert_eq!(
        features[0]["properties"]["palette"],
        crate::basemap::palette_key("s1")
    );
    let empty = json!({"type":"FeatureCollection","features":[]});
    for method in ["geo.section", "geo.sectionPasses"] {
        let got: Value =
            serde_json::from_str(&geo_text(&engine, method, r#"{"sectionId":"nope"}"#)).unwrap();
        assert_eq!(got["features"], empty["features"], "{method}");
    }
}

/// The route-and-section engine with a browser linked, a second section and a
/// second named route, and one route attempt under the first route.
fn engine_for_edits() -> PersistentEngine {
    let engine = engine_with_a_route_and_a_section();
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, 1_700_000_000)
        .expect("link the browser");
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, disabled, version, source_activity_id)
             VALUES ('s2', 'auto', 'Ridge', 'Ride', '[[46.0,7.0],[46.001,7.0]]', 800.0, 0, 1, NULL)",
            [],
        )
        .expect("second section");
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
             VALUES ('g2', 'r2', '[\"r2\"]', 'Ride', 1)",
            [],
        )
        .expect("second group");
    for activity in ["r1", "r2"] {
        engine
            .db
            .execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                 VALUES ('g1', ?1, 100.0, 'same')",
                [activity],
            )
            .expect("match");
    }
    engine
}

fn send(engine: &mut PersistentEngine, method: &str, params: &str) -> Value {
    written(
        engine,
        &format!(r#"{{"id":1,"method":"{method}","params":{params}}}"#),
    )
}

fn section_of(engine: &PersistentEngine, id: &str) -> crate::FfiSection {
    crate::persistence::screens::pooled::section_detail_data(&engine.db, id)
        .section
        .expect("the section")
}

fn excluded_in_section(engine: &PersistentEngine, id: &str) -> Vec<String> {
    crate::persistence::screens::pooled::section_detail_data(&engine.db, id).excluded_activity_ids
}

fn excluded_in_route(engine: &PersistentEngine, id: &str) -> Vec<String> {
    crate::persistence::screens::pooled::route_detail_data(&engine.db, id).excluded_activity_ids
}

#[test]
fn a_lift_mark_is_the_one_the_phone_makes_and_unmarking_takes_it_back() {
    let mut engine = engine_for_edits();
    let got = send(
        &mut engine,
        "section.setLift",
        r#"{"id":"s1","isLift":true}"#,
    );
    assert_eq!(got["result"], json!({ "ok": true }));
    assert!(section_of(&engine, "s1").is_lift);
    send(
        &mut engine,
        "section.setLift",
        r#"{"id":"s1","isLift":false}"#,
    );
    assert!(!section_of(&engine, "s1").is_lift);
}

#[test]
fn accepting_a_section_pins_it_and_accepting_all_pins_the_rest() {
    let mut engine = engine_for_edits();
    assert!(!section_of(&engine, "s1").is_user_defined);
    send(&mut engine, "section.accept", r#"{"id":"s1"}"#);
    assert!(section_of(&engine, "s1").is_user_defined);
    assert!(!section_of(&engine, "s2").is_user_defined);
    let got = send(&mut engine, "section.acceptAll", "{}");
    assert_eq!(got["result"], json!({ "ok": true }));
    assert!(section_of(&engine, "s2").is_user_defined);
}

#[test]
fn accepting_a_section_that_is_not_there_is_refused() {
    let mut engine = engine_for_edits();
    let got = send(&mut engine, "section.accept", r#"{"id":"nope"}"#);
    assert_eq!(got["error"], "Section not found: nope");
    assert_eq!(logged(&engine).len(), 0);
}

#[test]
fn disabling_a_section_then_enabling_it_leaves_it_as_it_began() {
    let mut engine = engine_for_edits();
    send(&mut engine, "section.disable", r#"{"id":"s1"}"#);
    assert!(section_of(&engine, "s1").disabled);
    send(&mut engine, "section.enable", r#"{"id":"s1"}"#);
    assert!(!section_of(&engine, "s1").disabled);
}

#[test]
fn excluding_an_activity_then_including_it_leaves_the_section_as_it_began() {
    let mut engine = engine_for_edits();
    let began = excluded_in_section(&engine, "s1");
    let ask = r#"{"id":"s1","activityId":"r1"}"#;
    send(&mut engine, "section.excludeActivity", ask);
    let mut excluded = excluded_in_section(&engine, "s1");
    excluded.sort();
    assert_eq!(excluded, ["r1", "r2"]);
    send(&mut engine, "section.includeActivity", ask);
    send(
        &mut engine,
        "section.includeActivity",
        r#"{"id":"s1","activityId":"r2"}"#,
    );
    send(
        &mut engine,
        "section.excludeActivity",
        r#"{"id":"s1","activityId":"r2"}"#,
    );
    assert_eq!(excluded_in_section(&engine, "s1"), ["r2"]);
    assert_eq!(began, ["r2"]);
}

#[test]
fn excluding_a_lap_counts_one_traversal_out_and_including_it_counts_it_back() {
    let mut engine = engine_for_edits();
    let counted = |engine: &PersistentEngine| -> i64 {
        engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_activities
                 WHERE section_id = 's1' AND activity_id = 'r1' AND excluded = 0",
                [],
                |row| row.get(0),
            )
            .expect("count")
    };
    assert_eq!(counted(&engine), 1);
    let ask = r#"{"id":"s1","activityId":"r1","startIndex":0}"#;
    send(&mut engine, "section.excludeLap", ask);
    assert_eq!(counted(&engine), 0);
    send(&mut engine, "section.includeLap", ask);
    assert_eq!(counted(&engine), 1);
}

#[test]
fn a_route_rename_is_the_phones_and_a_taken_name_is_refused_as_the_phone_refuses_it() {
    let mut engine = engine_for_edits();
    let got = send(
        &mut engine,
        "route.rename",
        r#"{"id":"g2","name":"Valley loop"}"#,
    );
    assert_eq!(got["result"], json!({ "ok": true }));
    let shown = |engine: &PersistentEngine, id: &str| {
        crate::persistence::screens::pooled::route_detail_data(&engine.db, id)
            .group
            .and_then(|group| group.custom_name)
    };
    assert_eq!(shown(&engine, "g2").as_deref(), Some("Valley loop"));
    let got = send(
        &mut engine,
        "route.rename",
        r#"{"id":"g1","name":"Valley loop"}"#,
    );
    assert_eq!(got["error"], "Another route is already named Valley loop");
    assert_ne!(shown(&engine, "g1").as_deref(), Some("Valley loop"));
}

#[test]
fn a_route_exclusion_round_trips() {
    let mut engine = engine_for_edits();
    assert!(excluded_in_route(&engine, "g1").is_empty());
    let ask = r#"{"id":"g1","activityId":"r1"}"#;
    send(&mut engine, "route.excludeActivity", ask);
    assert_eq!(excluded_in_route(&engine, "g1"), ["r1"]);
    send(&mut engine, "route.includeActivity", ask);
    assert!(excluded_in_route(&engine, "g1").is_empty());
}

#[test]
fn hiding_an_activity_from_the_heatmap_lists_it_and_showing_it_takes_it_off() {
    let mut engine = engine_for_edits();
    let listed = |engine: &PersistentEngine| -> Vec<String> {
        crate::persistence::tiles::heatmap_hidden_listing(&engine.db)
            .into_iter()
            .map(|row| row.activity_id)
            .collect()
    };
    send(
        &mut engine,
        "heatmap.setHidden",
        r#"{"activityId":"r1","hidden":true}"#,
    );
    assert_eq!(listed(&engine), ["r1"]);
    send(
        &mut engine,
        "heatmap.setHidden",
        r#"{"activityId":"r1","hidden":false}"#,
    );
    assert!(listed(&engine).is_empty());
}

#[test]
fn every_edit_leaves_one_row_naming_its_target() {
    let mut engine = engine_for_edits();
    let edits = [
        (
            "section.setLift",
            r#"{"id":"s1","isLift":true}"#,
            "Marked section Lake climb as a lift",
        ),
        (
            "section.accept",
            r#"{"id":"s1"}"#,
            "Accepted section Lake climb",
        ),
        (
            "section.disable",
            r#"{"id":"s1"}"#,
            "Disabled section Lake climb",
        ),
        (
            "section.enable",
            r#"{"id":"s1"}"#,
            "Enabled section Lake climb",
        ),
        (
            "section.excludeActivity",
            r#"{"id":"s1","activityId":"r1"}"#,
            "Excluded Loop r1 from section Lake climb",
        ),
        (
            "route.excludeActivity",
            r#"{"id":"g1","activityId":"r1"}"#,
            "Excluded Loop r1 from route g1",
        ),
        (
            "heatmap.setHidden",
            r#"{"activityId":"r1","hidden":true}"#,
            "Hid Loop r1 from the heatmap",
        ),
    ];
    for (method, params, _) in edits {
        send(&mut engine, method, params);
    }
    let rows = logged(&engine);
    assert_eq!(rows.len(), edits.len());
    for (method, _, summary) in edits {
        let row = rows.iter().find(|row| row.method == method).expect(method);
        assert_eq!(row.summary, summary);
    }
}

#[test]
fn each_edit_announces_the_channel_a_screen_re_reads() {
    use crate::objects::observer::{recorder::Recorder, set_observer};
    let _serial = crate::test_globals::serial_global_state();
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));
    let mut engine = engine_for_edits();
    for (method, params) in [
        ("section.setLift", r#"{"id":"s1","isLift":true}"#),
        (
            "section.excludeActivity",
            r#"{"id":"s1","activityId":"r1"}"#,
        ),
        ("route.excludeActivity", r#"{"id":"g1","activityId":"r1"}"#),
        ("route.rename", r#"{"id":"g1","name":"Valley loop"}"#),
        ("heatmap.setHidden", r#"{"activityId":"r1","hidden":true}"#),
    ] {
        let request = format!(r#"{{"id":1,"method":"{method}","params":{params}}}"#);
        answer_write(&mut engine, BROWSER, &request).announce();
    }
    let events = recorder.events();
    set_observer(None);
    assert_eq!(
        events,
        [
            "remote_wrote:sections",
            "remote_wrote:sections",
            "remote_wrote:groups",
            "remote_wrote:groups",
            "remote_wrote:activities",
        ]
    );
}

/// A linked browser and a library with no catalogue, so no detector cutover is
/// owed and a section config can change.
fn engine_with_no_catalogue() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().expect("engine");
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, 1_700_000_000)
        .expect("link the browser");
    engine
}

const STRICTNESS: &str = r#"{"minMatchPct":61.0,"endpointThreshold":150.0}"#;
const SECTION_CONFIG: &str = r#"{"proximityThreshold":150.0,"minSectionLength":300.0,"maxSectionLength":100000.0,"minActivities":3,"divergenceThreshold":0.2}"#;

fn write_request(method: &str, params: &str) -> String {
    format!(r#"{{"id":1,"method":"{method}","params":{params}}}"#)
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_strictness_write_is_the_one_the_phone_reads_back() {
    let mut engine = engine_with_no_catalogue();
    let got = written(
        &mut engine,
        &write_request("detection.setStrictness", STRICTNESS),
    );
    assert_eq!(got["result"]["ok"], true);
    assert_eq!(engine.match_strictness(), (61.0, 150.0));
    let stored = crate::persistence::settings::match_config_from(&engine.db).unwrap();
    assert_eq!(
        (stored.min_match_percentage, stored.endpoint_threshold),
        (61.0, 150.0)
    );
    let row = &logged(&engine)[0];
    assert_eq!(row.method, "detection.setStrictness");
    assert!(row.summary.contains("61") && row.summary.contains("150"));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_strictness_the_phones_numeric_box_refuses_is_refused_and_changes_nothing() {
    let mut engine = engine_with_no_catalogue();
    let before = engine.match_strictness();
    for params in [
        r#"{"minMatchPct":101.0,"endpointThreshold":150.0}"#,
        r#"{"minMatchPct":0.0,"endpointThreshold":150.0}"#,
        r#"{"minMatchPct":60.0,"endpointThreshold":-5.0}"#,
        r#"{"minMatchPct":60.0}"#,
    ] {
        let got = written(
            &mut engine,
            &write_request("detection.setStrictness", params),
        );
        assert!(got.get("error").is_some(), "{params} answered {got}");
    }
    assert_eq!(engine.match_strictness(), before);
    assert!(logged(&engine).is_empty());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_section_config_write_is_the_config_the_phone_reads_back() {
    let mut engine = engine_with_no_catalogue();
    let got = written(
        &mut engine,
        &write_request("detection.setSectionConfig", SECTION_CONFIG),
    );
    assert_eq!(got["result"]["ok"], true);
    let stored = crate::persistence::settings::section_config_from(&engine.db).unwrap();
    assert_eq!(stored.proximity_threshold, 150.0);
    assert_eq!(stored.min_section_length, 300.0);
    assert_eq!(stored.max_section_length, 100000.0);
    assert_eq!(stored.min_activities, 3);
    assert_eq!(stored.divergence_threshold, 0.2);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_section_config_the_phone_refuses_is_refused_and_changes_nothing() {
    let mut engine = engine_with_no_catalogue();
    let before = engine.get_section_config();
    for params in [
        SECTION_CONFIG.replace("\"minActivities\":3", "\"minActivities\":0"),
        SECTION_CONFIG.replace(
            "\"proximityThreshold\":150.0",
            "\"proximityThreshold\":-1.0",
        ),
        SECTION_CONFIG.replace("\"divergenceThreshold\":0.2", "\"divergenceThreshold\":0.0"),
    ] {
        let got = written(
            &mut engine,
            &write_request("detection.setSectionConfig", &params),
        );
        assert!(got.get("error").is_some(), "{params} answered {got}");
    }
    assert_eq!(engine.get_section_config(), before);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn switching_detection_on_stores_one_and_asks_for_one_backfill_start() {
    let mut engine = engine_with_no_catalogue();
    engine.set_detection_enabled(false).unwrap();

    let off = answer_write(
        &mut engine,
        BROWSER,
        &write_request("detection.setEnabled", r#"{"enabled":false}"#),
    );
    assert!(!off.starts_backfill());

    let on = answer_write(
        &mut engine,
        BROWSER,
        &write_request("detection.setEnabled", r#"{"enabled":true}"#),
    );
    assert!(on.starts_backfill());
    assert_eq!(
        crate::persistence::settings::setting_from(&engine.db, "__detection_enabled")
            .unwrap()
            .as_deref(),
        Some("1")
    );
    assert_eq!(
        logged(&engine)[0].summary,
        "Switched route matching from off to on"
    );

    let refused = answer_write(
        &mut engine,
        BROWSER,
        &write_request("detection.setEnabled", "{}"),
    );
    assert!(!refused.starts_backfill());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_detection_read_answers_what_the_three_engine_reads_answer() {
    let mut engine = engine_with_no_catalogue();
    written(
        &mut engine,
        &write_request("detection.setStrictness", STRICTNESS),
    );
    written(
        &mut engine,
        &write_request("detection.setSectionConfig", SECTION_CONFIG),
    );
    written(
        &mut engine,
        &write_request("detection.setEnabled", r#"{"enabled":false}"#),
    );

    let got = result_of(&engine, "detection.settings", "{}");
    assert_eq!(got["enabled"], false);
    assert_eq!(got["strictness"]["minMatchPct"], 61.0);
    assert_eq!(got["strictness"]["endpointThreshold"], 150.0);
    assert_eq!(got["sectionConfig"]["proximityThreshold"], 150.0);
    assert_eq!(got["sectionConfig"]["minActivities"], 3);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_detection_write_announces_the_settings_channel() {
    use crate::objects::observer::{recorder::Recorder, set_observer};
    let _serial = crate::test_globals::serial_global_state();
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));
    let mut engine = engine_with_no_catalogue();
    answer_write(
        &mut engine,
        BROWSER,
        &write_request("detection.setStrictness", STRICTNESS),
    )
    .announce();
    let events = recorder.events();
    set_observer(None);
    assert_eq!(events, ["remote_wrote:settings"]);
}
