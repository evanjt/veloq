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
        min_distance: None,
        max_distance: None,
        min_moving_time: None,
        max_moving_time: None,
        sort: None,
    };
    let page =
        crate::persistence::activities::pooled::feed_card_page(&engine.db, &query).expect("page");
    assert_eq!(got["id"], 7);
    let mut read = got["result"].clone();
    read.as_object_mut().unwrap().remove("previews");
    read.as_object_mut().unwrap().remove("familyCounts");
    assert_eq!(read, serde_json::to_value(&page).unwrap());
    assert_eq!(got["result"]["matchedCount"], 2);
    assert_eq!(got["result"]["hasMore"], true);
    assert_eq!(got["result"]["cards"][0]["id"], "i2");
}

fn engine_with_distances() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let body = |id: &str, distance: f64, name: &str| {
        format!(
            r#"{{"id":"{id}","type":"Ride","name":"{name}","distance":{distance},"moving_time":{},"total_elevation_gain":{},"icu_training_load":{},"stream_types":["latlng"]}}"#,
            distance / 10.0,
            distance / 100.0,
            distance / 1000.0
        )
    };
    engine
        .upsert_activity_bodies_with_metrics(&[
            ("a".into(), 1_700_000_000, body("a", 120_000.0, "Long one")),
            ("b".into(), 1_700_100_000, body("b", 30_000.0, "Short one")),
            ("c".into(), 1_700_200_000, body("c", 60_000.0, "Middle one")),
        ])
        .expect("bodies");
    engine
}

/// Scenario: the longest activity is the oldest, and the shortest is not the
/// newest.
///
/// Expected behaviour: a sort orders the whole match before the page is cut,
/// in either direction, and a lean ask answers the nine-field row.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_feed_page_sorts_the_whole_match_before_it_is_cut() {
    let engine = engine_with_distances();
    let ask = |params: &str| {
        reply(
            &engine,
            &format!(r#"{{"id":1,"method":"feed.page","params":{params}}}"#),
        )
    };
    let longest = ask(r#"{"limit":1,"sort":{"key":"distance","descending":true}}"#);
    assert_eq!(longest["result"]["cards"][0]["id"], "a");
    assert_eq!(longest["result"]["matchedCount"], 3);
    assert_eq!(longest["result"]["hasMore"], true);
    let shortest = ask(r#"{"limit":1,"sort":{"key":"distance","descending":false}}"#);
    assert_eq!(shortest["result"]["cards"][0]["id"], "b");
    let unsorted = ask(r#"{"limit":1}"#);
    assert_eq!(unsorted["result"]["cards"][0]["id"], "c");
    let second = ask(r#"{"limit":1,"offset":1,"sort":{"key":"distance","descending":true}}"#);
    assert_eq!(second["result"]["cards"][0]["id"], "c");
    let by_name = ask(r#"{"limit":1,"sort":{"key":"name","descending":false}}"#);
    assert_eq!(by_name["result"]["cards"][0]["id"], "a");
    let by_load = ask(r#"{"limit":1,"sort":{"key":"trainingLoad","descending":true}}"#);
    assert_eq!(by_load["result"]["cards"][0]["id"], "a");
    let by_date = ask(r#"{"limit":1,"sort":{"key":"date","descending":false}}"#);
    assert_eq!(by_date["result"]["cards"][0]["id"], "a");

    let lean = ask(r#"{"limit":1,"lean":true,"sort":{"key":"distance","descending":true}}"#);
    let row = lean["result"]["rows"][0].as_object().expect("row");
    let mut fields: Vec<&str> = row.keys().map(String::as_str).collect();
    fields.sort_unstable();
    assert_eq!(
        fields,
        [
            "distance",
            "elevationGain",
            "hasTrack",
            "id",
            "movingTime",
            "name",
            "sportType",
            "startDateLocal",
            "trainingLoad"
        ]
    );
    assert_eq!(row["id"], "a");
    assert_eq!(row["hasTrack"], true);
    assert_eq!(lean["result"]["cards"], json!([]));
    assert_eq!(lean["result"]["matchedCount"], 3);
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

/// Scenario: the site's activities table marks the rows hidden from the
/// heatmap, and one ride is hidden.
///
/// Expected behaviour: the page's card for that ride reads `heatmapHidden`
/// true on the wire and the other card reads false.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_feed_page_marks_the_cards_hidden_from_the_heatmap() {
    let mut engine = engine_with_rides();
    engine.set_heatmap_hidden("i1", true).expect("hide");
    let got = reply(
        &engine,
        r#"{"id":3,"method":"feed.page","params":{"limit":10}}"#,
    );
    let cards = got["result"]["cards"].as_array().expect("cards");
    let hidden: Vec<(&str, bool)> = cards
        .iter()
        .map(|c| {
            (
                c["id"].as_str().unwrap(),
                c["heatmapHidden"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(hidden, vec![("i2", false), ("i1", true)]);
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
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, None, 1_700_000_000)
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
            "section.acceptMany",
            "section.acceptAll",
            "section.unaccept",
            "section.enable",
            "section.disable",
            "section.setEnabledMany",
            "section.delete",
            "section.excludeActivity",
            "section.includeActivity",
            "section.excludeLap",
            "section.includeLap",
            "section.editBounds",
            "section.create",
            "section.merge",
            "section.restore",
            "route.rename",
            "route.excludeActivity",
            "route.includeActivity",
            "route.setReference",
            "route.resetReference",
            "heatmap.setHidden",
            "heatmap.setHiddenMany",
            "detection.setEnabled",
            "detection.setStrictness",
            "detection.setSectionConfig",
            "settings.set",
            "settings.setThreshold",
            "strength.saveWorkout",
            "strength.renameWorkout",
            "strength.deleteWorkout",
            "strength.restoreWorkout",
            "strength.liveEdit",
            "import.begin",
            "import.commit",
            "import.cancel",
            "export.begin",
            "export.status",
            "export.read",
            "export.done",
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
        "feed.filterBounds" => "{}",
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
        "settings.set" => r#"{"key":"veloq-theme-preference","value":"dark"}"#,
        "settings.setThreshold" => r#"{"sport":"Ride","field":"ftp","value":250.0}"#,
        "settings.profile"
        | "settings.thresholds"
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
        "section.unaccept" => r#"{"ids":["s1"]}"#,
        "section.setEnabledMany" => r#"{"ids":["s2"],"enabled":false}"#,
        "section.acceptMany" => r#"{"ids":["s2"]}"#,
        "section.excludeActivity" | "section.includeActivity" => r#"{"id":"s1","activityId":"r1"}"#,
        "section.excludeLap" | "section.includeLap" => {
            r#"{"id":"s1","activityId":"r1","startIndex":0}"#
        }
        "section.editBounds" | "section.boundsPreview" => {
            r#"{"id":"s1","edit":"expand","activityId":"r1","startIndex":0,"endIndex":10}"#
        }
        "section.create" => r#"{"activityId":"r1","startIndex":5,"endIndex":20,"sport":"Ride"}"#,
        "section.mergePreview" | "section.merge" => r#"{"primaryId":"s1","secondaryId":"s2"}"#,
        "section.delete" | "section.restore" => r#"{"id":"s1"}"#,
        "route.rename" => r#"{"id":"g1","name":"Valley loop"}"#,
        "route.setReference" => r#"{"id":"g1","activityId":"r2"}"#,
        "route.resetReference" => r#"{"id":"g1"}"#,
        "route.excludeActivity" | "route.includeActivity" => r#"{"id":"g1","activityId":"r1"}"#,
        "heatmap.setHidden" => r#"{"activityId":"r1","hidden":true}"#,
        "heatmap.setHiddenMany" => r#"{"activityIds":["r1","r2"],"hidden":true}"#,
        "detection.settings" => "{}",
        "detection.setEnabled" => r#"{"enabled":false}"#,
        "detection.setStrictness" => r#"{"minMatchPct":60.0,"endpointThreshold":200.0}"#,
        "detection.setSectionConfig" => {
            r#"{"proximityThreshold":200.0,"minSectionLength":150.0,"maxSectionLength":200000.0,"minActivities":2,"divergenceThreshold":0.15}"#
        }
        "map.screen" => {
            r#"{"startDate":0,"endDate":2000000000,"sportTypes":["Ride"],"distanceBand":"all"}"#
        }
        "geo.routeLines" | "geo.sections" | "heatmap.progress" | "import.status" => "{}",
        "geo.track" | "geo.activityOverlay" => r#"{"id":"i1"}"#,
        "geo.route" | "geo.routeLatest" | "geo.routeAttempts" => r#"{"groupId":"g1"}"#,
        "geo.section" | "geo.sectionPasses" => r#"{"sectionId":"s1"}"#,
        "geo.sectionVersion" => r#"{"sectionId":"s1","version":1}"#,
        "nearby.places" => r#"{"latitude":46.0,"longitude":7.0,"sport":"Ride"}"#,
        "heatmap.tile" => r#"{"z":3,"x":1,"y":2,"base":"dark"}"#,
        "heatmap.underPoint" => r#"{"latitude":46.2,"longitude":7.35,"zoom":14}"#,
        "fitness.screen" => {
            r#"{"spanDays":[42],"windows":{"heatmapFirstDay":"2025-01-01","heatmapLastDay":"2025-12-31","months":{"startTs":0,"endTs":86400},"nowWallSeconds":86400}}"#
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
        "strength.picker" => r#"{"query":"press","nowWallSeconds":1737050000}"#,
        "strength.lastTime" => r#"{"category":7,"nowWallSeconds":1737050000}"#,
        "strength.groups" => r#"{"nowWallSeconds":1737050000}"#,
        "strength.workouts" => "{}",
        "strength.workout" => r#"{"id":"saved-1"}"#,
        "strength.saveWorkout" => {
            r#"{"name":"Push","exercises":[{"category":7,"sets":[{"reps":8,"weightKg":20.0}]}],"groups":[]}"#
        }
        "strength.renameWorkout" => r#"{"id":"saved-1","name":"Pull"}"#,
        "strength.deleteWorkout" => r#"{"id":"saved-1"}"#,
        "strength.restoreWorkout" => r#"{"id":"saved-1","name":"Push","createdAt":1737050000.0}"#,
        "strength.live" => "{}",
        "strength.liveEdit" => r#"{"edit":{"kind":"begin"}}"#,
        "recordings.list" => "{}",
        "recordings.get" => r#"{"id":"b1"}"#,
        "routes.screen" | "sections.retired" => "{}",
        "route.detail" | "route.attempts" => r#"{"id":"g1"}"#,
        "route.performance" => r#"{"id":"g1","timeRangeDays":365}"#,
        "section.detail" | "section.history" | "section.excluded" => r#"{"id":"s1"}"#,
        "section.performance" => r#"{"id":"s1","timeRangeDays":365}"#,
        "section.standing" => r#"{"id":"s1","timeRangeDays":365}"#,
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
fn hello_from_a_page_on_a_newer_protocol_alone_is_refused_with_the_phones_range() {
    let got =
        refused(r#"{"id":1,"method":"link.hello","params":{"protocol":4,"page":"newer page"}}"#);
    assert_eq!(got["error"], VERSION);
    assert_eq!(got["minProtocol"], MIN_PROTOCOL_VERSION);
    assert_eq!(got["maxProtocol"], PROTOCOL_VERSION);
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

/// The reply a request is refused with, read back as JSON.
fn refused(request: &str) -> Value {
    let reply = refusal(request).expect("a refusal");
    serde_json::from_str(&reply).expect("a JSON reply")
}

#[test]
fn a_hello_whose_range_does_not_meet_this_builds_is_refused_with_the_range() {
    let got = refused(
        r#"{"id":7,"method":"link.hello","params":{"protocol":6,"minProtocol":5,"page":"newer page"}}"#,
    );
    assert_eq!(got["id"], 7);
    assert_eq!(got["error"], VERSION);
    assert_eq!(got["minProtocol"], MIN_PROTOCOL_VERSION);
    assert_eq!(got["maxProtocol"], PROTOCOL_VERSION);
}

#[test]
fn a_hello_from_a_page_below_the_range_is_refused_with_the_range() {
    for params in [
        r#"{"protocol":1,"page":"p"}"#,
        r#"{"protocol":0,"minProtocol":0,"page":"p"}"#,
    ] {
        let got = refused(&format!(
            r#"{{"id":1,"method":"link.hello","params":{params}}}"#
        ));
        assert_eq!(got["error"], VERSION, "{params}");
        assert_eq!(got["maxProtocol"], PROTOCOL_VERSION, "{params}");
    }
}

#[test]
fn a_hello_whose_range_meets_this_builds_is_not_refused() {
    for params in [
        r#"{"protocol":2,"page":"p"}"#,
        r#"{"protocol":3,"page":"p"}"#,
        r#"{"protocol":3,"minProtocol":2,"page":"p"}"#,
        r#"{"protocol":9,"minProtocol":2,"page":"p"}"#,
    ] {
        let request = format!(r#"{{"id":1,"method":"link.hello","params":{params}}}"#);
        assert!(refusal(&request).is_none(), "{params}");
    }
}

#[test]
fn a_hello_whose_minimum_is_above_its_maximum_is_refused() {
    let got = refused(
        r#"{"id":1,"method":"link.hello","params":{"protocol":2,"minProtocol":3,"page":"p"}}"#,
    );
    assert_eq!(got["error"], VERSION);
}

#[test]
fn an_ask_naming_a_version_outside_the_window_is_refused() {
    for version in [0, 1, 4, 9] {
        let got = refused(&format!(
            r#"{{"id":5,"method":"feed.page","protocol":{version}}}"#
        ));
        assert_eq!(got["id"], 5);
        assert_eq!(got["error"], VERSION, "protocol {version}");
        assert_eq!(got["minProtocol"], MIN_PROTOCOL_VERSION);
        assert_eq!(got["maxProtocol"], PROTOCOL_VERSION);
    }
}

#[test]
fn an_ask_naming_a_version_inside_the_window_or_none_is_not_refused() {
    for request in [
        r#"{"id":1,"method":"feed.page"}"#,
        r#"{"id":1,"method":"feed.page","protocol":2}"#,
        r#"{"id":1,"method":"feed.page","protocol":3}"#,
        "not json",
    ] {
        assert!(refusal(request).is_none(), "{request}");
    }
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
    let mut engine = engine_with_a_route_and_a_section();
    let cut = create_a_section(&mut engine, 5, 30);
    let mut sections = engine_with_a_route_and_a_section();
    add_a_second_section(&engine);
    add_a_second_section(&sections);
    sections.reload_groups_from_db();
    let retired = retire_a_section(&mut sections);
    let made = create_a_section(&mut sections, 5, 30);
    crate::persistence::linked_devices::add(&sections.db, "Laptop", BROWSER, None, 1_700_000_000)
        .expect("link the browser");
    sections
        .save_strength_draft(None, "Seed", Vec::new(), Vec::new(), 1)
        .expect("a saved workout for the rename and delete asks");
    sections
        .start_live_strength_session(
            &crate::persistence::strength_live::StartFrom::Blank,
            1_700_000_000,
        )
        .expect("a live session for the live edit ask");
    for method in METHODS {
        if is_spool(method.name) {
            // Answered without the engine; `service.rs` drives them through the gate.
            continue;
        }
        let params = if method.name == "section.restore" {
            format!(r#"{{"id":"{retired}"}}"#)
        } else if method.name == "section.delete" {
            format!(r#"{{"id":"{made}"}}"#)
        } else if method.name == "section.extensionTrack" {
            format!(r#"{{"id":"{cut}"}}"#)
        } else {
            sample_params(method.name).to_owned()
        };
        let request = format!(r#"{{"id":5,"method":"{}","params":{params}}}"#, method.name);
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

/// The published reference quotes each method's doc string, so a row without
/// one, or with the same sentence as another, is a gap in it.
#[test]
fn every_method_has_its_own_doc_string() {
    let mut seen = std::collections::HashSet::new();
    for method in METHODS {
        assert!(
            !method.doc.trim().is_empty(),
            "{} has no doc string",
            method.name
        );
        assert!(
            method.doc.trim_end().ends_with('.'),
            "{}'s doc string is not a sentence",
            method.name
        );
        assert!(
            seen.insert(method.doc),
            "{} repeats another method's doc string",
            method.name
        );
    }
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
/// in it, so a pin pairs the two. The doc string is prose for the published
/// reference and is not on the wire, so it is not a column here.
fn wire_fingerprint() -> String {
    let table: Value = serde_json::from_str(&methods_json()).expect("the table is JSON");
    let mut columns: Vec<&str> = table["methods"][0]
        .as_object()
        .expect("a row of the table")
        .keys()
        .map(String::as_str)
        .filter(|column| *column != "doc")
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
fn the_feed_page_counts_each_family_under_the_search_and_window_but_not_the_family_chips() {
    let engine = engine_with_rides();
    let counts = |params: &str| {
        let got = reply(
            &engine,
            &format!(r#"{{"id":20,"method":"feed.page","params":{params}}}"#),
        );
        got["result"]["familyCounts"].clone()
    };
    assert_eq!(
        counts("{}"),
        json!([{"family": "ride", "count": 1}, {"family": "run", "count": 1}])
    );
    assert_eq!(
        counts(r#"{"sportFamilies":["run"]}"#),
        json!([{"family": "ride", "count": 1}, {"family": "run", "count": 1}])
    );
    assert_eq!(
        counts(r#"{"needle":"track"}"#),
        json!([{"family": "run", "count": 1}])
    );
    assert_eq!(
        counts(r#"{"oldestTs":1737000000,"newestTs":1737100000}"#),
        json!([{"family": "run", "count": 1}])
    );
    assert_eq!(counts(r#"{"needle":"nothing matches this"}"#), json!([]));
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

/// Scenario: an ask carries an id a frame cannot hold, zero or one past the
/// 32-bit range. Expected behaviour: the ask is refused, and the largest id a
/// frame holds is still answered.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_ask_id_a_frame_cannot_carry_is_refused() {
    let past = u64::from(u32::MAX) + 1;
    assert_eq!(
        incoming(&format!(r#"{{"id":{past},"method":"feed.page"}}"#)),
        Incoming::Refuse(past)
    );
    assert_eq!(
        incoming(r#"{"id":0,"method":"feed.page"}"#),
        Incoming::Refuse(0)
    );
    assert_eq!(
        incoming(&format!(r#"{{"id":{},"method":"feed.page"}}"#, u32::MAX)),
        Incoming::Ask(Some(u64::from(u32::MAX)))
    );
}

/// Scenario: a refused ask. Expected behaviour: the error names the id the ask
/// sent in full, past the 32 bits a frame header holds, so the text reply can
/// be matched to it.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_refused_ask_names_the_id_it_was_sent_under() {
    let past = u64::from(u32::MAX) + 1;
    let got: Value = serde_json::from_str(&super::super::protocol::refused(past)).unwrap();
    assert_eq!(got, json!({ "id": past, "error": BAD_ID }));
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
    let summed: f64 = read.iter().filter_map(|day| day.total).sum();
    assert_eq!(loads["total"], json!(summed));

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
    let windows = r#"{"heatmapFirstDay":"2025-01-01","heatmapLastDay":"2025-12-31","months":{"startTs":0,"endTs":86400},"nowWallSeconds":86400}"#;
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
    crate::persistence::linked_devices::add(&engine.db, "Laptop", "sha-256 AA", None, 10).unwrap();
    crate::persistence::linked_devices::add(&engine.db, "Desk", "sha-256 BB", None, 20).unwrap();
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

/// Scenario: a click on the page's heatmap asks what lies under the point,
/// with the heatmap on and with it off, and a zoom outside the heatmap's.
///
/// Expected behaviour: the answer is the record the phone's own under-point
/// read returns for the same point and zoom, serialised as the page reads it:
/// the activity whose track passes the point is listed and the one whose box
/// holds the point but whose track does not is not. A heatmap that is off
/// answers the empty record; a zoom outside 1 to 17 and a point that is not a
/// coordinate are errors.
#[test]
fn the_under_point_answer_is_the_phones_own_read() {
    use crate::test_globals::{init_global_engine, serial_global_state};
    use tracematch::GpsPoint;

    let _serial = serial_global_state();
    let _tmp = init_global_engine("link-under-point.db");
    let line = |lng: f64| -> Vec<GpsPoint> {
        (0..40)
            .map(|i| GpsPoint::new(46.18 + 0.04 * f64::from(i) / 39.0, lng))
            .collect()
    };
    let ring = vec![
        GpsPoint::new(46.19, 7.34),
        GpsPoint::new(46.19, 7.36),
        GpsPoint::new(46.21, 7.36),
        GpsPoint::new(46.21, 7.34),
        GpsPoint::new(46.19, 7.34),
    ];
    crate::persistence::with_persistent_engine(|e| {
        for (id, track) in [("near", line(7.35)), ("ring", ring)] {
            e.add_activity(id.into(), track, "Ride".into())
                .expect("activity");
            e.set_activity_metrics(vec![crate::ActivityMetrics {
                activity_id: id.into(),
                name: format!("ride {id}"),
                date: 1_700_000_000,
                distance: 10_000.0,
                moving_time: 1_800,
                elapsed_time: 1_900,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".into(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .expect("metrics");
        }
        crate::persistence::tiles::serve_engine_for_test(e);
    })
    .expect("engine");
    let engine = engine_with_rides();
    let ask = |latitude: f64, longitude: f64, zoom: u32| {
        reply(
            &engine,
            &format!(
                r#"{{"id":1,"method":"heatmap.underPoint","params":{{"latitude":{latitude},"longitude":{longitude},"zoom":{zoom}}}}}"#
            ),
        )
    };

    let open = ask(46.2, 7.35, 14);
    let too_deep = ask(46.2, 7.35, 18);
    let world = ask(46.2, 7.35, 0);
    let off_the_globe = ask(146.2, 7.35, 14);
    let phone = crate::persistence::under_point::activities_under_point(46.2, 7.35, 14)
        .expect("the phone's read");
    crate::persistence::tiles::serve_heatmap_dir_for_test(None);
    let closed = ask(46.2, 7.35, 14);

    assert_eq!(open["result"], serde_json::to_value(&phone).unwrap());
    assert_eq!(phone.total, 1);
    assert_eq!(phone.groups[0].activities[0].id, "near");
    assert!(closed["result"]["groups"].as_array().unwrap().is_empty());
    assert_eq!(closed["result"]["total"], json!(0));
    for refused in [&too_deep, &world, &off_the_globe] {
        assert!(refused["error"].is_string(), "answered {refused}");
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
    assert!(features[1]["properties"]["colorIndex"].as_u64().unwrap() < 5);
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

/// Scenario: a route group of two attempts, one of which holds no track.
///
/// Expected behaviour: one `LineString` per member with a stored track, each
/// the stored track written as the track read writes it and carrying the
/// activity id; a member with no track is left out; an unknown group is the
/// empty collection.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_route_attempts_are_every_members_stored_track() {
    let engine = engine_with_a_route_and_a_section();
    let layer: Value = serde_json::from_str(&geo_text(
        &engine,
        "geo.routeAttempts",
        r#"{"groupId":"g1"}"#,
    ))
    .expect("GeoJSON");
    let features = layer["features"].as_array().unwrap();
    let mut ids: Vec<&str> = features
        .iter()
        .map(|f| f["properties"]["activityId"].as_str().unwrap())
        .collect();
    ids.sort_unstable();
    assert_eq!(ids, ["r1", "r2"]);
    for feature in features {
        let id = feature["properties"]["activityId"].as_str().unwrap();
        let track = engine.get_gps_track(id).unwrap();
        let want: Value = serde_json::from_str(&crate::basemap::line_feature(&track)).unwrap();
        assert_eq!(feature["geometry"], want["geometry"]);
    }

    engine
        .db
        .execute("DELETE FROM gps_tracks WHERE activity_id = 'r2'", [])
        .expect("an attempt with no track");
    let layer: Value = serde_json::from_str(&geo_text(
        &engine,
        "geo.routeAttempts",
        r#"{"groupId":"g1"}"#,
    ))
    .unwrap();
    assert_eq!(layer["features"].as_array().unwrap().len(), 1);

    let empty = r#"{"type":"FeatureCollection","features":[]}"#;
    assert_eq!(
        geo_text(&engine, "geo.routeAttempts", r#"{"groupId":"nope"}"#),
        empty
    );
}

/// Scenario: a section with passes by two activities, and one by an activity
/// that holds no track.
///
/// Expected behaviour: one `LineString` per pass with a track, sliced at the
/// stored track's positions `start_index` to `end_index` inclusive and thinned
/// to the collection tolerance, with the
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
        let slice =
            crate::basemap::line_feature(&crate::basemap::for_collection(&track[from..=to]));
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

/// Scenario: a watch asks for one section's line, capped and packed, because it holds a few
/// hundred points at most and parses a message with no decompression.
///
/// Expected behaviour: asked with `maxPoints` and `packed`, the reply carries the line as one
/// integer array that decodes to the same number of points as the line strided to the same cap,
/// each within 1e-5 degree and 1 m of it, in no more bytes than the cap packs to at worst; asked
/// with neither, the reply is the GeoJSON it has always been, with no packed line.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_packed_section_line_is_capped_and_small() {
    let engine = engine_with_a_route_and_a_section();
    // A riding-pace climb, about 8 m a point: 5.7 m north, 5.7 m east and 0.8 m up each step.
    let climb: Vec<[f64; 3]> = (0..720)
        .map(|i| {
            let i = f64::from(i);
            [46.0 + i * 0.0000508, 7.0 + i * 0.0000732, 400.0 + i * 0.8]
        })
        .collect();
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, disabled, version, source_activity_id)
             VALUES ('climb', 'auto', 'Long climb', 'Ride', ?1, 2400.0, 0, 1, NULL)",
            [serde_json::to_string(&climb).unwrap()],
        )
        .expect("a 720-point section");

    let got = reply(
        &engine,
        r#"{"id":1,"method":"geo.section","params":{"sectionId":"climb","maxPoints":64,"packed":true}}"#,
    );
    let packed = got["result"]["packedLine"]
        .as_array()
        .unwrap_or_else(|| panic!("geo.section answered {got}"));
    let ints: Vec<i32> = packed
        .iter()
        .map(|v| i32::try_from(v.as_i64().unwrap()).unwrap())
        .collect();
    // The worst the 64-point cap packs to: the header `[64,1`, the absolute first point at its
    // widest (lat 4600000, lng 700000, elevation 400), then 63 points of three deltas, each value
    // a comma, a sign and up to four digits.
    let worst = "[64,1,4600000,700000,400".len() + 189 * ",-9999".len() + "]".len();
    let bytes = serde_json::to_string(packed).unwrap().len();
    assert!(bytes <= worst, "{bytes} bytes, past the worst of {worst}");

    let decoded = crate::persistence::codec::unpack_line(&ints).expect("a packed line");
    let line: Vec<crate::GpsPoint> = climb
        .iter()
        .map(|p| crate::GpsPoint {
            latitude: p[0],
            longitude: p[1],
            elevation: Some(p[2]),
        })
        .collect();
    let want = crate::persistence::screens::capped_line(&line, 64);
    assert_eq!(decoded.len(), want.len());
    for (d, w) in decoded.iter().zip(&want) {
        assert!((d.latitude - w.latitude).abs() <= 1e-5);
        assert!((d.longitude - w.longitude).abs() <= 1e-5);
        assert!((d.elevation.unwrap() - w.elevation.unwrap()).abs() <= 1.0);
    }

    let plain = reply(
        &engine,
        r#"{"id":1,"method":"geo.section","params":{"sectionId":"s1"}}"#,
    );
    assert!(plain["result"].get("packedLine").is_none());
    assert!(
        plain["result"]["text"]
            .as_str()
            .unwrap()
            .contains("FeatureCollection")
    );
}

/// Scenario: the page draws one stored geometry version of a section under the section.
///
/// Expected behaviour: a version's line is that version's stored points as one line feature
/// carrying the section id and the version, not the section's current line; an unknown version
/// or section is the empty collection; a version that is not a whole number is refused.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_stored_version_is_drawn_as_its_own_line() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = create_a_section(&mut engine, 5, 30);
    written(
        &mut engine,
        &format!(
            r#"{{"id":3,"method":"section.editBounds","params":{{"id":"{id}","edit":"trim","startIndex":0,"endIndex":10}}}}"#
        ),
    );
    let first = engine.section_geometry_versions(&id)[0].version;
    let ask = format!(r#"{{"sectionId":"{id}","version":{first}}}"#);
    let layer: Value =
        serde_json::from_str(&geo_text(&engine, "geo.sectionVersion", &ask)).unwrap();
    let features = layer["features"].as_array().unwrap();
    assert_eq!(features.len(), 1);
    assert_eq!(features[0]["properties"]["id"], id.as_str());
    assert_eq!(features[0]["properties"]["version"], first);
    let stored = engine
        .section_geometry_polyline(&id, first)
        .expect("the stored version");
    assert_eq!(
        features[0]["geometry"]["coordinates"]
            .as_array()
            .unwrap()
            .len(),
        stored.len()
    );
    assert_ne!(
        features[0]["geometry"]["coordinates"]
            .as_array()
            .unwrap()
            .len(),
        polyline_of(&engine, &id).len() / 2,
        "the line is the stored version, not the current one"
    );

    let empty = json!([]);
    for ask in [
        format!(r#"{{"sectionId":"{id}","version":99}}"#),
        r#"{"sectionId":"nope","version":1}"#.to_owned(),
    ] {
        let got: Value =
            serde_json::from_str(&geo_text(&engine, "geo.sectionVersion", &ask)).unwrap();
        assert_eq!(got["features"], empty, "{ask}");
    }
    let got = reply(
        &engine,
        &format!(
            r#"{{"id":1,"method":"geo.sectionVersion","params":{{"sectionId":"{id}","version":1.5}}}}"#
        ),
    );
    assert!(got.get("error").is_some(), "{got}");
}

/// Scenario: the page undoes a bounds edit by reverting to the version that was live before it:
/// the pinned one, else the newest, else the first, which the first edit stores for the line it
/// replaces.
///
/// Expected behaviour: after a trim, and after an expand made on the line a revert put back, a
/// revert to the version read before the edit puts back the line the edit replaced.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn reverting_to_the_version_live_before_an_edit_puts_the_line_back() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = create_a_section(&mut engine, 5, 30);
    for edit in [
        r#""edit":"trim","startIndex":2,"endIndex":12"#,
        r#""edit":"expand","activityId":"r1","startIndex":0,"endIndex":40"#,
    ] {
        let history = result_of(&engine, "section.history", &format!(r#"{{"id":"{id}"}}"#));
        let newest = history["geometryVersions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|version| version["version"].as_i64())
            .max();
        let live = history["pinnedVersion"].as_i64().or(newest).unwrap_or(1);
        let before = polyline_of(&engine, &id);
        written(
            &mut engine,
            &format!(r#"{{"id":3,"method":"section.editBounds","params":{{"id":"{id}",{edit}}}}}"#),
        );
        assert_ne!(polyline_of(&engine, &id), before, "{edit}");
        written(
            &mut engine,
            &format!(
                r#"{{"id":4,"method":"section.editBounds","params":{{"id":"{id}","edit":"revert","version":{live}}}}}"#
            ),
        );
        assert_eq!(polyline_of(&engine, &id), before, "{edit}");
    }
}

/// Scenario: the page lets the athlete drag a section's ends beyond its line, along the
/// track of the activity the section was cut from.
///
/// Expected behaviour: the extension track answers the reference activity, its whole stored
/// track and the inclusive indices where the section's line runs on it; a section that does not
/// exist is refused.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_extension_track_is_the_references_track_with_the_lines_range_on_it() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = create_a_section(&mut engine, 5, 30);
    let got = result_of(
        &engine,
        "section.extensionTrack",
        &format!(r#"{{"id":"{id}"}}"#),
    );
    assert_eq!(got["activityId"], "r1");
    let track = crate::persistence::activities::pooled::gps_track(&engine.db, "r1")
        .expect("the stored track");
    let sent = {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD
            .decode(got["encodedTrack"].as_str().expect("base64"))
            .expect("base64 bytes")
    };
    assert_eq!(sent, crate::persistence::codec::encode_polyline(&track));
    assert_eq!(got["sectionStartIdx"], 5);
    assert_eq!(got["sectionEndIdx"], 30);

    let refused = reply(
        &engine,
        r#"{"id":1,"method":"section.extensionTrack","params":{"id":"ghost"}}"#,
    );
    assert!(refused.get("error").is_some(), "{refused}");
}

/// The route-and-section engine with a browser linked, a second section and a
/// second named route, and one route attempt under the first route.
fn engine_for_edits() -> PersistentEngine {
    let engine = engine_with_a_route_and_a_section();
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, None, 1_700_000_000)
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
    assert_eq!(got["result"], json!({ "ok": true, "ids": ["s2"] }));
    assert!(section_of(&engine, "s2").is_user_defined);
}

/// Three more rows beside `s1` and `s2`: two detected and one the athlete drew.
fn engine_with_five_sections() -> PersistentEngine {
    let engine = engine_for_edits();
    for (id, kind) in [("s3", "auto"), ("s4", "auto"), ("s5", "custom")] {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, disabled, version, source_activity_id)
                 VALUES (?1, ?2, 'Spur', 'Ride', '[[46.0,7.0],[46.001,7.0]]', 800.0, 0, 1, NULL)",
                rusqlite::params![id, kind],
            )
            .expect("more sections");
    }
    engine
}

#[test]
fn accepting_many_sections_accepts_those_and_leaves_the_rest_for_accept_all() {
    let mut engine = engine_with_five_sections();
    let got = send(
        &mut engine,
        "section.acceptMany",
        r#"{"ids":["s1","s3","s4"]}"#,
    );
    assert_eq!(
        got["result"],
        json!({ "ok": true, "ids": ["s1", "s3", "s4"] })
    );
    for id in ["s1", "s3", "s4"] {
        assert!(section_of(&engine, id).is_user_defined, "{id} is accepted");
    }
    assert!(!section_of(&engine, "s2").is_user_defined);
    let rest = send(&mut engine, "section.acceptAll", "{}");
    assert_eq!(rest["result"], json!({ "ok": true, "ids": ["s2"] }));
}

#[test]
fn accepting_many_is_refused_whole_when_one_is_drawn_accepted_or_missing() {
    for (second, text) in [
        ("s5", "Section was not detected: s5"),
        ("s2", "Section is already accepted: s2"),
        ("nope", "Section not found: nope"),
    ] {
        let mut engine = engine_with_five_sections();
        send(&mut engine, "section.accept", r#"{"id":"s2"}"#);
        let before = logged(&engine).len();
        let got = send(
            &mut engine,
            "section.acceptMany",
            &format!(r#"{{"ids":["s1","{second}"]}}"#),
        );
        assert_eq!(got["error"], text);
        assert!(
            !section_of(&engine, "s1").is_user_defined,
            "s1 is left alone when {second} is refused"
        );
        assert_eq!(
            logged(&engine).len(),
            before,
            "a refused call is not logged"
        );
    }
}

#[test]
fn accepting_many_names_the_sections_it_accepted_so_unaccept_takes_them_back() {
    let mut engine = engine_with_five_sections();
    let got = send(&mut engine, "section.acceptMany", r#"{"ids":["s3","s4"]}"#);
    let ids = got["result"]["ids"].clone();
    send(
        &mut engine,
        "section.unaccept",
        &json!({ "ids": ids }).to_string(),
    );
    assert!(!section_of(&engine, "s3").is_user_defined);
    assert!(!section_of(&engine, "s4").is_user_defined);
}

#[test]
fn accepting_no_sections_is_a_no_op() {
    let mut engine = engine_with_five_sections();
    let got = send(&mut engine, "section.acceptMany", r#"{"ids":[]}"#);
    assert_eq!(got["result"], json!({ "ok": true, "ids": [] }));
}

#[test]
fn unaccepting_returns_exactly_the_sections_that_accepting_all_changed() {
    let mut engine = engine_for_edits();
    send(&mut engine, "section.accept", r#"{"id":"s1"}"#);
    let accepted = send(&mut engine, "section.acceptAll", "{}");
    let ids = accepted["result"]["ids"].clone();
    assert_eq!(ids, json!(["s2"]));
    let got = send(
        &mut engine,
        "section.unaccept",
        &json!({ "ids": ids }).to_string(),
    );
    assert_eq!(got["result"], json!({ "ok": true }));
    assert!(!section_of(&engine, "s2").is_user_defined);
    assert!(
        section_of(&engine, "s1").is_user_defined,
        "a section accepted before the batch stays accepted"
    );
}

#[test]
fn unaccepting_a_section_hands_it_back_to_detection_and_can_be_accepted_again() {
    let mut engine = engine_for_edits();
    send(&mut engine, "section.accept", r#"{"id":"s1"}"#);
    let got = send(&mut engine, "section.unaccept", r#"{"ids":["s1"]}"#);
    assert_eq!(got["result"], json!({ "ok": true }));
    assert!(!section_of(&engine, "s1").is_user_defined);
    send(&mut engine, "section.accept", r#"{"id":"s1"}"#);
    assert!(section_of(&engine, "s1").is_user_defined);
}

#[test]
fn unaccepting_a_section_that_is_not_there_is_refused_and_changes_nothing() {
    let mut engine = engine_for_edits();
    send(&mut engine, "section.accept", r#"{"id":"s1"}"#);
    let got = send(&mut engine, "section.unaccept", r#"{"ids":["s1","nope"]}"#);
    assert_eq!(got["error"], "Section not found: nope");
    assert!(section_of(&engine, "s1").is_user_defined);
}

#[test]
fn unaccepting_nothing_is_a_no_op() {
    let mut engine = engine_for_edits();
    let got = send(&mut engine, "section.unaccept", r#"{"ids":[]}"#);
    assert_eq!(got["result"], json!({ "ok": true }));
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

/// Scenario: a custom section is disabled from the browser. Its undo enables
/// it again, but a hidden custom section is counted as removed and the browser
/// has no delete for it, so the disable is refused and the section stays shown.
#[test]
fn a_custom_section_is_not_disabled_over_the_link() {
    let mut engine = engine_with_a_route_and_a_section();
    let drawn = create_a_section(&mut engine, 5, 30);
    let ask = format!(r#"{{"id":"{drawn}"}}"#);

    let got = send(&mut engine, "section.disable", &ask);
    assert!(got.get("error").is_some(), "{got}");
    assert!(!section_of(&engine, &drawn).disabled);

    let many = format!(r#"{{"ids":["s1","{drawn}"],"enabled":false}}"#);
    let got = send(&mut engine, "section.setEnabledMany", &many);
    assert!(got.get("error").is_some(), "{got}");
    assert!(!section_of(&engine, &drawn).disabled);
    assert!(
        !section_of(&engine, "s1").disabled,
        "nothing was half-applied"
    );

    let got = send(&mut engine, "section.disable", r#"{"id":"s1"}"#);
    assert_eq!(
        got["result"]["ok"], true,
        "a detected section still disables"
    );
}

#[test]
fn hiding_many_sections_is_one_write_the_same_write_undoes() {
    let mut engine = engine_with_five_sections();
    let ask = |enabled: bool| format!(r#"{{"ids":["s1","s3","s4"],"enabled":{enabled}}}"#);
    let hidden = send(&mut engine, "section.setEnabledMany", &ask(false));
    assert_eq!(hidden["result"], json!({ "ok": true }));
    for id in ["s1", "s3", "s4"] {
        assert!(section_of(&engine, id).disabled, "{id} is hidden");
    }
    for id in ["s2", "s5"] {
        assert!(!section_of(&engine, id).disabled, "{id} is left alone");
    }
    let rows = logged(&engine);
    assert_eq!(rows.len(), 1, "three sections were logged as {rows:?}");
    assert_eq!(rows[0].method, "section.setEnabledMany");
    assert_eq!(rows[0].summary, "Disabled 3 sections");

    send(&mut engine, "section.setEnabledMany", &ask(true));
    for id in ["s1", "s3", "s4"] {
        assert!(!section_of(&engine, id).disabled, "{id} is shown again");
    }
    let rows = logged(&engine);
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().any(|row| row.summary == "Enabled 3 sections"));
}

#[test]
fn hiding_many_sections_is_refused_whole_when_one_is_missing() {
    let mut engine = engine_with_five_sections();
    let got = send(
        &mut engine,
        "section.setEnabledMany",
        r#"{"ids":["s1","nope"],"enabled":false}"#,
    );
    assert_eq!(got["error"], "Section not found: nope");
    assert!(!section_of(&engine, "s1").disabled);
    assert!(logged(&engine).is_empty(), "a refused call is not logged");
}

#[test]
fn hiding_one_section_in_the_many_write_reads_as_one_section() {
    let mut engine = engine_with_five_sections();
    send(
        &mut engine,
        "section.setEnabledMany",
        r#"{"ids":["s1"],"enabled":false}"#,
    );
    assert_eq!(logged(&engine)[0].summary, "Disabled 1 section");
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
fn hiding_many_activities_from_the_heatmap_is_one_write_the_same_write_undoes() {
    let mut engine = engine_for_edits();
    let listed = |engine: &PersistentEngine| -> Vec<String> {
        let mut ids: Vec<String> = crate::persistence::tiles::heatmap_hidden_listing(&engine.db)
            .into_iter()
            .map(|row| row.activity_id)
            .collect();
        ids.sort_unstable();
        ids
    };
    let hidden = send(
        &mut engine,
        "heatmap.setHiddenMany",
        r#"{"activityIds":["r1","r2"],"hidden":true}"#,
    );
    assert_eq!(hidden["result"]["ok"], true);
    assert_eq!(listed(&engine), ["r1", "r2"]);
    let rows = logged(&engine);
    assert_eq!(rows.len(), 1, "two activities were logged as {rows:?}");
    assert_eq!(rows[0].method, "heatmap.setHiddenMany");
    assert_eq!(rows[0].summary, "Hid 2 activities from the heatmap");

    send(
        &mut engine,
        "heatmap.setHiddenMany",
        r#"{"activityIds":["r1","r2"],"hidden":false}"#,
    );
    assert!(listed(&engine).is_empty());
    let rows = logged(&engine);
    assert_eq!(rows.len(), 2);
    assert!(
        rows.iter()
            .any(|row| row.summary == "Showed 2 activities on the heatmap")
    );
}

#[test]
fn hiding_one_activity_in_the_many_write_reads_as_one_activity() {
    let mut engine = engine_for_edits();
    send(
        &mut engine,
        "heatmap.setHiddenMany",
        r#"{"activityIds":["r1"],"hidden":true}"#,
    );
    assert_eq!(
        logged(&engine)[0].summary,
        "Hid 1 activity from the heatmap"
    );
}

#[test]
fn hiding_no_activities_is_refused_and_logs_nothing() {
    let mut engine = engine_for_edits();
    let got = send(
        &mut engine,
        "heatmap.setHiddenMany",
        r#"{"activityIds":[],"hidden":true}"#,
    );
    assert!(got.get("error").is_some(), "answered {got}");
    assert!(logged(&engine).is_empty());
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
        (
            "heatmap.setHiddenMany",
            r#"{"activityIds":["r1","r2"],"hidden":true}"#,
        ),
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
            "remote_wrote:activities",
        ]
    );
}

/// A linked browser and a library with no catalogue, so no detector cutover is
/// owed and a section config can change.
fn engine_with_no_catalogue() -> PersistentEngine {
    let engine = PersistentEngine::in_memory().expect("engine");
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, None, 1_700_000_000)
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

fn linked_strength_engine() -> PersistentEngine {
    let engine = engine_with_strength();
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, None, 1_700_000_000)
        .expect("link the browser");
    engine
}

fn a_fifty_kg_set() -> Value {
    json!({"reps":8,"weightKg":50.0,"durationSecs":null,"side":null,"warmUp":false})
}

const PUSH_WORKOUT: &str = r#"{"name":"  Push  ","exercises":[
    {"category":7,"groupNo":1,"restSecs":90,"sets":[{"reps":8,"weightKg":40.0},{"reps":6,"weightKg":45.0}]},
    {"category":0,"name":1,"groupNo":1,"sets":[{"durationSecs":30.0}]}],
    "groups":[{"groupNo":1,"restSecs":120}]}"#;

fn saved_id(engine: &mut PersistentEngine, ask: &str) -> String {
    let got = written(engine, &write_request("strength.saveWorkout", ask));
    assert!(got.get("error").is_none(), "{got}");
    got["result"]["id"]
        .as_str()
        .expect("the new id")
        .to_string()
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_picker_is_the_exercise_picker_read_in_its_own_order() {
    let engine = linked_strength_engine();
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                 elapsed_time, elevation_gain, sport_type)
             VALUES ('s3', 'Bench day', ?1, 0, 0, 0, 0, 'WeightTraining')",
            [WEIGHT_TRAINING_BASE + DAY],
        )
        .expect("an activity");
    let named = crate::fit::FitExerciseSet {
        exercise_category: 0,
        exercise_name: Some(1),
        ..a_set(0, 60.0)
    };
    engine.store_exercise_sets("s3", &[named]).expect("sets");
    let got = result_of(
        &engine,
        "strength.picker",
        &format!(r#"{{"query":"","nowWallSeconds":{NOW_WALL}}}"#),
    );
    let read = crate::persistence::screens::exercise_picker_data(
        &engine.db,
        &[],
        None,
        None,
        "",
        None,
        NOW_WALL,
    )
    .expect("the picker read");
    assert_eq!(got["rows"], wire(&read.rows));
    assert_eq!(got["equipment"], wire(&read.equipment));
    assert_eq!(got["rows"][0]["category"], 0);
    assert_eq!(got["rows"][0]["name"], 1);
    assert_eq!(got["rows"][0]["lastDoneDays"], 1);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_unknown_filter_word_matches_nothing_as_it_does_on_the_phone() {
    let engine = linked_strength_engine();
    let got = result_of(
        &engine,
        "strength.picker",
        &format!(r#"{{"equipment":["no-such-kit"],"nowWallSeconds":{NOW_WALL}}}"#),
    );
    assert_eq!(got["rows"], json!([]));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn last_time_is_the_latest_sessions_working_sets_and_null_for_an_exercise_never_done() {
    let engine = linked_strength_engine();
    let got = result_of(
        &engine,
        "strength.lastTime",
        &format!(r#"{{"category":{CATEGORY},"nowWallSeconds":{NOW_WALL}}}"#),
    );
    assert_eq!(got["lastTime"]["daysAgo"], 1);
    assert_eq!(got["lastTime"]["sets"], json!([a_fifty_kg_set()]));
    let never = result_of(
        &engine,
        "strength.lastTime",
        &format!(r#"{{"category":28,"name":3,"nowWallSeconds":{NOW_WALL}}}"#),
    );
    assert_eq!(never["lastTime"], Value::Null);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_groups_are_the_recent_groups_each_with_the_sets_it_starts_from() {
    let engine = linked_strength_engine();
    let got = result_of(
        &engine,
        "strength.groups",
        &format!(r#"{{"nowWallSeconds":{NOW_WALL}}}"#),
    );
    let groups = got["groups"].as_array().expect("groups");
    let read = engine.recent_strength_groups().expect("the groups read");
    assert_eq!(groups.len(), read.len());
    assert_eq!(groups[0]["signature"], read[0].signature);
    assert_eq!(groups[0]["times"], read[0].times);
    assert_eq!(groups[0]["exercises"][0]["category"], CATEGORY);
    assert_eq!(groups[0]["exercises"][0]["sets"], json!([a_fifty_kg_set()]));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_saved_workout_is_listed_and_read_back_as_it_was_built() {
    let mut engine = linked_strength_engine();
    assert_eq!(
        result_of(&engine, "strength.workouts", "{}")["workouts"],
        json!([])
    );
    let id = saved_id(&mut engine, PUSH_WORKOUT);

    let listed = result_of(&engine, "strength.workouts", "{}");
    assert_eq!(listed["workouts"][0]["id"], id);
    assert_eq!(listed["workouts"][0]["name"], "Push");
    assert_eq!(listed["workouts"][0]["exerciseCount"], 2);
    assert_eq!(listed["workouts"][0]["setCount"], 3);

    let read = result_of(&engine, "strength.workout", &format!(r#"{{"id":"{id}"}}"#));
    let workout = &read["workout"];
    assert_eq!(workout["name"], "Push");
    assert_eq!(workout["exercises"][0]["restSecs"], 90);
    assert_eq!(workout["exercises"][0]["sets"][1]["weightKg"], 45.0);
    assert_eq!(workout["exercises"][1]["name"], 1);
    assert_eq!(workout["exercises"][1]["sets"][0]["durationSecs"], 30.0);
    assert_eq!(workout["groups"], json!([{"groupNo":1,"restSecs":120}]));

    let stored = engine
        .get_strength_session(&id)
        .expect("read")
        .expect("stored");
    assert_eq!(
        stored.kind,
        crate::persistence::strength_sessions::SessionKind::Saved
    );
    assert!(stored.exercises[0].sets.iter().all(|set| !set.done));
    assert_eq!(stored.exercises[0].sets[0].planned_reps, Some(8));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn saving_with_an_id_replaces_that_workout_and_keeps_one_row() {
    let mut engine = linked_strength_engine();
    let id = saved_id(&mut engine, PUSH_WORKOUT);
    let again = format!(
        r#"{{"id":"{id}","name":"Push B","exercises":[{{"category":7,"sets":[{{"reps":5,"weightKg":60.0}}]}}],"groups":[]}}"#
    );
    assert_eq!(saved_id(&mut engine, &again), id);
    let listed = result_of(&engine, "strength.workouts", "{}");
    assert_eq!(listed["workouts"].as_array().unwrap().len(), 1);
    assert_eq!(listed["workouts"][0]["name"], "Push B");
    assert_eq!(listed["workouts"][0]["setCount"], 1);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_save_is_refused_for_an_empty_name_or_an_id_that_is_not_a_saved_workout() {
    let mut engine = linked_strength_engine();
    let empty = written(
        &mut engine,
        &write_request(
            "strength.saveWorkout",
            r#"{"name":"  ","exercises":[],"groups":[]}"#,
        ),
    );
    assert!(empty.get("error").is_some(), "{empty}");
    let missing = written(
        &mut engine,
        &write_request(
            "strength.saveWorkout",
            r#"{"id":"s1","name":"Over a ride","exercises":[],"groups":[]}"#,
        ),
    );
    assert!(missing.get("error").is_some(), "{missing}");
    assert_eq!(
        result_of(&engine, "strength.workouts", "{}")["workouts"],
        json!([])
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_saved_workout_is_renamed_and_deleted_without_touching_the_library() {
    let mut engine = linked_strength_engine();
    let id = saved_id(&mut engine, PUSH_WORKOUT);
    let renamed = written(
        &mut engine,
        &write_request(
            "strength.renameWorkout",
            &format!(r#"{{"id":"{id}","name":"Upper"}}"#),
        ),
    );
    assert!(renamed.get("error").is_none(), "{renamed}");
    assert_eq!(
        result_of(&engine, "strength.workouts", "{}")["workouts"][0]["name"],
        "Upper"
    );
    let deleted = written(
        &mut engine,
        &write_request("strength.deleteWorkout", &format!(r#"{{"id":"{id}"}}"#)),
    );
    assert!(deleted.get("error").is_none(), "{deleted}");
    assert_eq!(
        result_of(&engine, "strength.workouts", "{}")["workouts"],
        json!([])
    );
    let gone = written(
        &mut engine,
        &write_request("strength.deleteWorkout", &format!(r#"{{"id":"{id}"}}"#)),
    );
    assert!(gone.get("error").is_some(), "{gone}");
    assert_eq!(
        result_of(
            &engine,
            "strength.lastTime",
            &format!(r#"{{"category":{CATEGORY},"nowWallSeconds":{NOW_WALL}}}"#)
        )["lastTime"]["sets"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_deleted_workout_comes_back_through_restore_with_its_place_in_the_list() {
    let mut engine = linked_strength_engine();
    let id = saved_id(&mut engine, PUSH_WORKOUT);
    let row = result_of(&engine, "strength.workouts", "{}")["workouts"][0].clone();
    let workout =
        result_of(&engine, "strength.workout", &format!(r#"{{"id":"{id}"}}"#))["workout"].clone();
    let deleted = written(
        &mut engine,
        &write_request("strength.deleteWorkout", &format!(r#"{{"id":"{id}"}}"#)),
    );
    assert!(deleted.get("error").is_none(), "{deleted}");

    let ask = json!({
        "id": workout["id"],
        "name": workout["name"],
        "exercises": workout["exercises"],
        "groups": workout["groups"],
        "createdAt": row["createdAt"],
        "lastUsedAt": row["lastUsedAt"],
    });
    let restored = written(
        &mut engine,
        &write_request("strength.restoreWorkout", &ask.to_string()),
    );
    assert!(restored.get("error").is_none(), "{restored}");
    assert_eq!(
        result_of(&engine, "strength.workouts", "{}")["workouts"][0],
        row
    );
    assert_eq!(
        result_of(&engine, "strength.workout", &format!(r#"{{"id":"{id}"}}"#))["workout"],
        workout
    );
    let again = written(
        &mut engine,
        &write_request("strength.restoreWorkout", &ask.to_string()),
    );
    assert!(again.get("error").is_some(), "{again}");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_workout_deleted_through_the_link_is_listed_and_recovered_on_the_phone() {
    let mut engine = linked_strength_engine();
    let id = saved_id(&mut engine, PUSH_WORKOUT);
    let deleted = written(
        &mut engine,
        &write_request("strength.deleteWorkout", &format!(r#"{{"id":"{id}"}}"#)),
    );
    assert!(deleted.get("error").is_none(), "{deleted}");

    let after_delete = crate::objects::strength_live::start_data(&engine.db, NOW_WALL).unwrap();
    assert!(after_delete.workouts.is_empty());
    assert_eq!(after_delete.removed.len(), 1);
    assert_eq!(after_delete.removed[0].id, id);
    assert_eq!(after_delete.removed[0].name, "Push");
    assert_eq!(after_delete.removed[0].exercise_count, 2);
    assert_eq!(after_delete.removed[0].set_count, 3);

    crate::objects::strength_live::recover_workout(&mut engine, &id).unwrap();

    let after_recover = crate::objects::strength_live::start_data(&engine.db, NOW_WALL).unwrap();
    assert!(after_recover.removed.is_empty());
    assert_eq!(after_recover.workouts.len(), 1);
    assert_eq!(after_recover.workouts[0].id, id);
    assert_eq!(after_recover.workouts[0].exercise_count, 2);
    assert_eq!(after_recover.workouts[0].set_count, 3);
    let workout =
        result_of(&engine, "strength.workout", &format!(r#"{{"id":"{id}"}}"#))["workout"].clone();
    assert_eq!(workout["exercises"].as_array().map(Vec::len), Some(2));

    assert!(crate::objects::strength_live::recover_workout(&mut engine, &id).is_err());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_workout_saves_while_a_session_is_live_and_the_live_session_is_untouched() {
    use crate::persistence::strength_live::StartFrom;
    let mut engine = linked_strength_engine();
    let live = engine
        .start_live_strength_session(&StartFrom::Blank, NOW_WALL)
        .expect("a live session");
    saved_id(&mut engine, PUSH_WORKOUT);
    assert_eq!(engine.live_strength_session().expect("read"), Some(live));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_workout_read_for_an_id_that_is_not_a_saved_workout_is_null() {
    let engine = linked_strength_engine();
    let got = result_of(&engine, "strength.workout", r#"{"id":"s1"}"#);
    assert_eq!(got["workout"], Value::Null);
}

fn live_with_a_pressing_exercise(engine: &mut PersistentEngine) {
    use crate::persistence::strength_live::{LiveEdit, StartFrom};
    engine
        .start_live_strength_session(&StartFrom::Blank, NOW_WALL)
        .expect("a live session");
    for edit in [
        LiveEdit::AddExercise {
            category: 7,
            name: None,
        },
        LiveEdit::Begin,
    ] {
        engine
            .edit_live_strength_session(&edit, NOW_WALL)
            .expect("an edit");
    }
    let mut session = engine.live_strength_session().unwrap().unwrap();
    session.exercises[0].sets = ["40.0", "40.0", "40.0"]
        .iter()
        .map(|kg| crate::persistence::strength_sessions::SessionSet {
            reps: Some(8),
            weight_kg: kg.parse().ok(),
            ..Default::default()
        })
        .collect();
    engine.save_strength_session(&session).expect("sets");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_live_read_is_null_with_no_session_and_the_session_with_its_focus_when_one_is_live() {
    let mut engine = linked_strength_engine();
    let none = result_of(&engine, "strength.live", "{}");
    assert_eq!(none["session"], Value::Null);
    assert_eq!(none["focus"], Value::Null);

    live_with_a_pressing_exercise(&mut engine);
    let live = result_of(&engine, "strength.live", "{}");
    assert_eq!(
        live["session"]["exercises"][0]["sets"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(live["session"]["begun"], true);
    assert_eq!(live["focus"]["phase"], "set");
    assert_eq!(live["focus"]["current"]["setNumber"], 1);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_tick_through_the_link_completes_the_set_in_the_engine_and_the_answer_carries_it() {
    let mut engine = linked_strength_engine();
    live_with_a_pressing_exercise(&mut engine);
    let got = written(
        &mut engine,
        &write_request(
            "strength.liveEdit",
            r#"{"edit":{"kind":"completeSet","exercise":0,"set":0}}"#,
        ),
    );
    assert!(got.get("error").is_none(), "{got}");
    assert_eq!(
        got["result"]["session"]["exercises"][0]["sets"][0]["done"],
        true
    );
    let held = engine.live_strength_session().unwrap().unwrap();
    assert!(held.exercises[0].sets[0].done);
    assert!(!held.exercises[0].sets[1].done);
    let read = result_of(&engine, "strength.live", "{}");
    assert_eq!(read["session"], got["result"]["session"]);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_weight_change_through_the_link_flows_down_the_sets_that_held_the_value() {
    let mut engine = linked_strength_engine();
    live_with_a_pressing_exercise(&mut engine);
    written(
        &mut engine,
        &write_request(
            "strength.liveEdit",
            r#"{"edit":{"kind":"completeSet","exercise":0,"set":0}}"#,
        ),
    );
    let got = written(
        &mut engine,
        &write_request(
            "strength.liveEdit",
            r#"{"edit":{"kind":"setWeightEntered","exercise":0,"set":1,"value":45.0}}"#,
        ),
    );
    assert!(got.get("error").is_none(), "{got}");
    let sets = &got["result"]["session"]["exercises"][0]["sets"];
    assert_eq!(sets[0]["weightKg"], 40.0);
    assert_eq!(sets[1]["weightKg"], 45.0);
    assert_eq!(sets[2]["weightKg"], 45.0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_live_write_with_no_session_is_refused_with_a_reason() {
    let mut engine = linked_strength_engine();
    let got = written(
        &mut engine,
        &write_request("strength.liveEdit", r#"{"edit":{"kind":"startRest"}}"#),
    );
    let error = got["error"].as_str().expect("a refusal");
    assert!(error.contains("no strength session is live"), "{error}");
    assert!(engine.live_strength_session().unwrap().is_none());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_refused_live_edit_leaves_the_session_and_logs_nothing() {
    let mut engine = linked_strength_engine();
    live_with_a_pressing_exercise(&mut engine);
    let before = engine.live_strength_session().unwrap();
    let got = written(
        &mut engine,
        &write_request(
            "strength.liveEdit",
            r#"{"edit":{"kind":"completeSet","exercise":0,"set":9}}"#,
        ),
    );
    assert!(got.get("error").is_some(), "{got}");
    assert_eq!(engine.live_strength_session().unwrap(), before);
}

fn add_a_second_section(engine: &PersistentEngine) {
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, disabled, version, source_activity_id)
             VALUES ('s2', 'auto', 'Lake descent', 'Ride', '[[46.0,7.0],[46.0005,7.0]]', 400.0, 0, 1, NULL)",
            [],
        )
        .expect("section");
}

fn polyline_of(engine: &PersistentEngine, id: &str) -> Vec<f64> {
    crate::persistence::sections::pooled::section_polyline(&engine.db, id)
}

fn exists(engine: &PersistentEngine, id: &str) -> bool {
    engine
        .db
        .query_row(
            "SELECT COUNT(*) > 0 FROM sections WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .expect("count")
}

fn create_a_section(engine: &mut PersistentEngine, start: u32, end: u32) -> String {
    let got = written(
        engine,
        &format!(
            r#"{{"id":1,"method":"section.create","params":{{"activityId":"r1","startIndex":{start},"endIndex":{end},"sport":"Ride"}}}}"#
        ),
    );
    got["result"]["sectionId"]
        .as_str()
        .unwrap_or_else(|| panic!("section.create answered {got}"))
        .to_owned()
}

/// A custom section the athlete gave up for the auto section on its ground:
/// it sits on the retired list with a version to restore.
fn retire_a_section(engine: &mut PersistentEngine) -> String {
    let custom = create_a_section(engine, 0, 1);
    engine.prefer_section("s1", &custom).expect("prefer");
    assert!(!exists(engine, &custom));
    custom
}

/// Scenario: the page cuts a custom section from a range of a ride's track.
///
/// Expected behaviour: the section holds the points of that inclusive range,
/// as the phone's own cut does, and the write is logged under the browser.
#[test]
fn a_custom_section_is_cut_from_the_range_of_a_ride() {
    let mut engine = engine_with_a_route_and_a_section();
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, None, 1_700_000_000)
        .expect("link the browser");
    let id = create_a_section(&mut engine, 5, 20);
    let line = polyline_of(&engine, &id);
    assert_eq!(line.len(), 16 * 2);
    assert!((line[0] - 46.005).abs() < 1e-6);
    assert!((line[line.len() - 2] - 46.020).abs() < 1e-6);
    let rows = logged(&engine);
    assert_eq!(rows[0].method, "section.create");
    assert_eq!(rows[0].target_id, id);
}

#[test]
fn a_range_the_track_does_not_hold_cuts_nothing() {
    let mut engine = engine_with_a_route_and_a_section();
    let before = row_counts(&engine);
    for params in [
        r#"{"activityId":"r1","startIndex":20,"endIndex":5,"sport":"Ride"}"#,
        r#"{"activityId":"r1","startIndex":5,"endIndex":60,"sport":"Ride"}"#,
        r#"{"activityId":"nobody","startIndex":1,"endIndex":5,"sport":"Ride"}"#,
        r#"{"activityId":"r1","startIndex":1,"sport":"Ride"}"#,
    ] {
        let got = written(
            &mut engine,
            &format!(r#"{{"id":1,"method":"section.create","params":{params}}}"#),
        );
        assert!(got.get("error").is_some(), "{params} answered {got}");
    }
    assert_eq!(row_counts(&engine), before);
}

/// Scenario: the page trims a section, expands it, then resets it.
///
/// Expected behaviour: each edit leaves the line the phone's edit leaves.
#[test]
fn a_bounds_edit_changes_the_line_as_the_phones_edit_does() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = create_a_section(&mut engine, 5, 30);
    let edit = |engine: &mut PersistentEngine, params: &str| {
        written(
            engine,
            &format!(r#"{{"id":3,"method":"section.editBounds","params":{params}}}"#),
        )
    };

    let got = edit(
        &mut engine,
        &format!(r#"{{"id":"{id}","edit":"trim","startIndex":0,"endIndex":10}}"#),
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert_eq!(got["result"]["departed"], json!([]));
    assert_eq!(polyline_of(&engine, &id).len(), 11 * 2);

    let got = edit(&mut engine, &format!(r#"{{"id":"{id}","edit":"reset"}}"#));
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert_eq!(polyline_of(&engine, &id).len(), 26 * 2);

    let got = edit(
        &mut engine,
        &format!(
            r#"{{"id":"{id}","edit":"expand","activityId":"r1","startIndex":0,"endIndex":40}}"#
        ),
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert_eq!(polyline_of(&engine, &id).len(), 41 * 2);
}

#[test]
fn a_reference_edit_marks_the_section_user_defined_and_resets() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = create_a_section(&mut engine, 5, 30);
    engine
        .db
        .execute(
            "UPDATE sections SET is_user_defined = 0 WHERE id = ?1",
            [&id],
        )
        .expect("clear");
    let user_defined = |engine: &PersistentEngine| -> bool {
        engine
            .db
            .query_row(
                "SELECT is_user_defined FROM sections WHERE id = ?1",
                [&id],
                |row| row.get(0),
            )
            .expect("flag")
    };
    let got = written(
        &mut engine,
        &format!(
            r#"{{"id":3,"method":"section.editBounds","params":{{"id":"{id}","edit":"setReference","activityId":"r2"}}}}"#
        ),
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert!(user_defined(&engine));
    let got = written(
        &mut engine,
        &format!(
            r#"{{"id":4,"method":"section.editBounds","params":{{"id":"{id}","edit":"resetReference"}}}}"#
        ),
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
}

/// Scenario: the page sets a ride as a custom section's reference, then offers a ride
/// that never covers the section, then hands the reference back.
///
/// Expected behaviour: the ride that covers the line becomes the reference, a ride that is
/// not a pass of the section is refused and leaves the line as it was, and the reset puts
/// back the line the section had before its reference was set.
#[test]
fn a_reference_is_refused_for_a_ride_that_is_not_a_pass_and_reset_restores_the_line() {
    let mut engine = engine_with_a_route_and_a_section();
    let far_track = (0..60)
        .map(|i| crate::GpsPoint {
            latitude: 47.0 + f64::from(i) * 0.001,
            longitude: 8.0,
            elevation: None,
        })
        .collect();
    engine
        .add_activity("r3".into(), far_track, "Ride".into())
        .expect("activity");
    let id = create_a_section(&mut engine, 5, 30);
    let drawn = polyline_of(&engine, &id);

    let refused = written(
        &mut engine,
        &format!(
            r#"{{"id":2,"method":"section.editBounds","params":{{"id":"{id}","edit":"setReference","activityId":"r3"}}}}"#
        ),
    );
    assert!(refused.get("error").is_some(), "{refused}");
    assert_eq!(polyline_of(&engine, &id), drawn);

    let unknown = written(
        &mut engine,
        &format!(
            r#"{{"id":3,"method":"section.editBounds","params":{{"id":"{id}","edit":"setReference","activityId":"nobody"}}}}"#
        ),
    );
    assert!(unknown.get("error").is_some(), "{unknown}");
    assert_eq!(polyline_of(&engine, &id), drawn);

    let set = written(
        &mut engine,
        &format!(
            r#"{{"id":4,"method":"section.editBounds","params":{{"id":"{id}","edit":"setReference","activityId":"r2"}}}}"#
        ),
    );
    assert_eq!(set["result"]["ok"], true, "{set}");
    let reset = written(
        &mut engine,
        &format!(
            r#"{{"id":5,"method":"section.editBounds","params":{{"id":"{id}","edit":"resetReference"}}}}"#
        ),
    );
    assert_eq!(reset["result"]["ok"], true, "{reset}");
    assert_eq!(polyline_of(&engine, &id), drawn);
}

/// Expected behaviour: an edit missing what it needs, or naming one the
/// protocol does not carry, is refused and the line is unchanged.
#[test]
fn a_bounds_edit_missing_its_parameters_is_refused_and_changes_nothing() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = create_a_section(&mut engine, 5, 30);
    let before = polyline_of(&engine, &id);
    for params in [
        format!(r#"{{"id":"{id}","edit":"trim","startIndex":0}}"#),
        format!(r#"{{"id":"{id}","edit":"expand","startIndex":0,"endIndex":4}}"#),
        format!(r#"{{"id":"{id}","edit":"setReference"}}"#),
        format!(r#"{{"id":"{id}","edit":"revert"}}"#),
        format!(r#"{{"id":"{id}","edit":"delete"}}"#),
        format!(r#"{{"id":"{id}","edit":"trim","startIndex":9,"endIndex":3}}"#),
        r#"{"id":"missing","edit":"reset"}"#.to_owned(),
    ] {
        let got = written(
            &mut engine,
            &format!(r#"{{"id":3,"method":"section.editBounds","params":{params}}}"#),
        );
        assert!(got.get("error").is_some(), "{params} answered {got}");
    }
    assert_eq!(polyline_of(&engine, &id), before);
}

#[test]
fn a_revert_puts_a_stored_version_back() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = create_a_section(&mut engine, 5, 30);
    written(
        &mut engine,
        &format!(
            r#"{{"id":3,"method":"section.editBounds","params":{{"id":"{id}","edit":"trim","startIndex":0,"endIndex":10}}}}"#
        ),
    );
    let versions = engine.section_geometry_versions(&id);
    assert!(versions.len() >= 2, "{versions:?}");
    let first = versions[0].version;
    let got = written(
        &mut engine,
        &format!(
            r#"{{"id":4,"method":"section.editBounds","params":{{"id":"{id}","edit":"revert","version":{first}}}}}"#
        ),
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert_eq!(polyline_of(&engine, &id).len(), 26 * 2);
}

/// Scenario: the editor asks what a trim would measure, then saves it.
///
/// Expected behaviour: the preview writes nothing and its distance and grade
/// are the ones the section reports after the same trim; an edit that takes no
/// range is refused.
#[test]
fn a_bounds_preview_reports_what_the_trim_then_stores() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = create_a_section(&mut engine, 5, 30);
    let ask = format!(r#"{{"id":"{id}","edit":"trim","startIndex":0,"endIndex":10}}"#);
    let before = row_counts(&engine);
    let line_before = polyline_of(&engine, &id);

    let got = reply(
        &engine,
        &format!(r#"{{"id":1,"method":"section.boundsPreview","params":{ask}}}"#),
    );
    let preview = got["result"].clone();
    assert!(preview["distanceMeters"].as_f64().unwrap() > 0.0, "{got}");
    assert!(preview["lapsRemeasured"].is_u64(), "{got}");
    assert_eq!(row_counts(&engine), before);
    assert_eq!(polyline_of(&engine, &id), line_before);
    assert!(!is_write("section.boundsPreview"));

    let refused = reply(
        &engine,
        &format!(
            r#"{{"id":2,"method":"section.boundsPreview","params":{{"id":"{id}","edit":"reset"}}}}"#
        ),
    );
    assert!(refused.get("error").is_some(), "{refused}");

    written(
        &mut engine,
        &format!(r#"{{"id":3,"method":"section.editBounds","params":{ask}}}"#),
    );
    let detail = reply(
        &engine,
        &format!(r#"{{"id":4,"method":"section.detail","params":{{"id":"{id}"}}}}"#),
    );
    assert_eq!(
        detail["result"]["section"]["distanceMeters"], preview["distanceMeters"],
        "{detail}"
    );
}

/// Scenario: the page previews a merge of two sections, then merges them.
///
/// Expected behaviour: the preview writes nothing and names the rides the
/// merge would leave out; the merge keeps the primary, deletes the secondary
/// and names the rides that left.
#[test]
fn a_merge_keeps_the_primary_and_a_preview_writes_nothing() {
    let mut engine = engine_with_a_route_and_a_section();
    let primary = create_a_section(&mut engine, 0, 40);
    let secondary = create_a_section(&mut engine, 5, 20);
    let ask = format!(r#"{{"primaryId":"{primary}","secondaryId":"{secondary}"}}"#);
    let before = row_counts(&engine);

    let got = reply(
        &engine,
        &format!(r#"{{"id":1,"method":"section.mergePreview","params":{ask}}}"#),
    );
    assert_eq!(got["result"]["dropped"], json!([]), "{got}");
    assert!(got["result"]["lapsRemeasured"].is_u64(), "{got}");
    assert_eq!(row_counts(&engine), before);
    assert!(is_write("section.merge") && !is_write("section.mergePreview"));

    let got = written(
        &mut engine,
        &format!(r#"{{"id":2,"method":"section.merge","params":{ask}}}"#),
    );
    assert_eq!(got["result"]["sectionId"], primary.as_str(), "{got}");
    assert_eq!(got["result"]["departed"], json!([]));
    assert!(exists(&engine, &primary));
    assert!(!exists(&engine, &secondary));

    let got = written(
        &mut engine,
        &format!(
            r#"{{"id":3,"method":"section.merge","params":{{"primaryId":"{primary}","secondaryId":"{primary}"}}}}"#
        ),
    );
    assert!(got.get("error").is_some(), "{got}");
}

/// Scenario: a custom section the athlete gave up sits on the retired list;
/// the page restores it.
#[test]
fn a_retired_section_is_restored_and_a_live_one_is_refused() {
    let mut engine = engine_with_a_route_and_a_section();
    let id = retire_a_section(&mut engine);
    let live = create_a_section(&mut engine, 5, 30);
    let got = written(
        &mut engine,
        &format!(r#"{{"id":3,"method":"section.restore","params":{{"id":"{live}"}}}}"#),
    );
    assert!(
        got.get("error").is_some(),
        "a live section is not retired: {got}"
    );

    let got = written(
        &mut engine,
        &format!(r#"{{"id":4,"method":"section.restore","params":{{"id":"{id}"}}}}"#),
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert!(exists(&engine, &id));
    let got = written(
        &mut engine,
        r#"{"id":5,"method":"section.restore","params":{"id":"never-existed"}}"#,
    );
    assert!(got.get("error").is_some(), "{got}");
}

fn retirement_row_exists(engine: &PersistentEngine, id: &str) -> bool {
    crate::persistence::sections::history::pooled::retirement_of(&engine.db, id).is_some()
}

/// Scenario: the page's Remove on a section the athlete made, which the phone
/// offers as Delete behind a confirmation.
///
/// Expected behaviour: the delete is the phone's own. A section with an
/// archived state goes to the retired list, where Restore brings it back; one
/// without is gone. A detected section is refused and stays, and so does one
/// that is not there.
#[test]
fn a_made_section_is_deleted_as_the_phone_does_and_a_detected_one_is_refused() {
    let mut engine = engine_with_a_route_and_a_section();
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, None, 1_700_000_000)
        .expect("link the browser");
    assert!(is_write("section.delete"));
    let delete = |engine: &mut PersistentEngine, id: &str| {
        written(
            engine,
            &format!(r#"{{"id":2,"method":"section.delete","params":{{"id":"{id}"}}}}"#),
        )
    };

    let got = delete(&mut engine, "s1");
    assert!(got.get("error").is_some(), "a detected section: {got}");
    assert!(exists(&engine, "s1"));
    assert!(!retirement_row_exists(&engine, "s1"));
    let got = delete(&mut engine, "never-existed");
    assert!(got.get("error").is_some(), "{got}");

    let drawn = create_a_section(&mut engine, 5, 30);
    let got = delete(&mut engine, &drawn);
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert!(!exists(&engine, &drawn));
    assert!(
        !retirement_row_exists(&engine, &drawn),
        "nothing was archived to restore"
    );

    let kept = retire_a_section(&mut engine);
    let got = written(
        &mut engine,
        &format!(r#"{{"id":5,"method":"section.restore","params":{{"id":"{kept}"}}}}"#),
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert!(exists(&engine, &kept));
    let got = delete(&mut engine, &kept);
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert!(!exists(&engine, &kept));
    assert!(retirement_row_exists(&engine, &kept));
}

fn representative_of(engine: &PersistentEngine, route: &str) -> String {
    engine
        .db
        .query_row(
            "SELECT representative_id FROM route_groups WHERE id = ?1",
            [route],
            |row| row.get(0),
        )
        .expect("route")
}

/// Scenario: the page names a route's reference ride, then hands the choice
/// back to the grouping.
#[test]
fn a_route_reference_is_set_and_reset_as_the_phone_does() {
    let mut engine = engine_with_a_route_and_a_section();
    engine.reload_groups_from_db();
    crate::persistence::linked_devices::add(&engine.db, "Laptop", BROWSER, None, 1_700_000_000)
        .expect("link the browser");
    let got = written(
        &mut engine,
        r#"{"id":1,"method":"route.setReference","params":{"id":"g1","activityId":"r2"}}"#,
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
    assert_eq!(representative_of(&engine, "g1"), "r2");
    let got = written(
        &mut engine,
        r#"{"id":2,"method":"route.resetReference","params":{"id":"g1"}}"#,
    );
    assert_eq!(got["result"]["ok"], true, "{got}");
    let rows = logged(&engine);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].method, "route.resetReference");

    let got = written(
        &mut engine,
        r#"{"id":3,"method":"route.setReference","params":{"id":"g1","activityId":"nobody"}}"#,
    );
    assert!(got.get("error").is_some(), "{got}");
    assert_eq!(logged(&engine).len(), 2, "a refusal leaves no row");
}

/// Expected behaviour: a delete-shaped method is unknown on both channels,
/// whatever its name. `section.delete` is the one exception, a section the
/// athlete made, deleted as the phone does.
#[test]
fn a_delete_shaped_method_is_still_refused() {
    let mut engine = engine_with_a_route_and_a_section();
    let before = row_counts(&engine);
    for method in [
        "section.remove",
        "section.deleteCustom",
        "route.delete",
        "route.remove",
    ] {
        let request = format!(r#"{{"id":5,"method":"{method}","params":{{"id":"s1"}}}}"#);
        assert!(!is_write(method));
        let got = written(&mut engine, &request);
        assert_eq!(got["error"], format!("unknown method: {method}"));
        let got = reply(&engine, &request);
        assert_eq!(got["error"], format!("unknown method: {method}"));
    }
    assert_eq!(row_counts(&engine), before);
}

fn threshold_figure(thresholds: &Value, sport: &str, field: &str) -> Value {
    thresholds["sports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["sport"] == sport)
        .unwrap()["figures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|figure| figure["field"] == field)
        .unwrap()
        .clone()
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_threshold_written_over_the_link_is_the_athletes_figure_until_cleared() {
    let mut engine = engine_with_no_catalogue();
    let before = result_of(&engine, "settings.thresholds", "{}");
    assert_eq!(
        threshold_figure(&before, "Ride", "ftp")["source"],
        Value::Null
    );
    assert_eq!(
        before["hrZoneDefaultPercents"].as_array().unwrap().len(),
        crate::persistence::screens::thresholds_screen_data(&engine.db)
            .hr_zone_default_percents
            .len()
    );

    let got = written(
        &mut engine,
        &write_request(
            "settings.setThreshold",
            r#"{"sport":"Ride","field":"ftp","value":262.0}"#,
        ),
    );
    assert_eq!(got["result"]["ok"], true);
    let set = result_of(&engine, "settings.thresholds", "{}");
    let ftp = threshold_figure(&set, "Ride", "ftp");
    assert_eq!(ftp["value"], 262.0);
    assert_eq!(ftp["source"], "athlete");
    assert_eq!(threshold_figure(&set, "Run", "ftp")["source"], Value::Null);
    let row = &logged(&engine)[0];
    assert_eq!(row.method, "settings.setThreshold");
    assert!(row.summary.contains("262"), "{}", row.summary);

    written(
        &mut engine,
        &write_request(
            "settings.setThreshold",
            r#"{"sport":"Ride","field":"ftp","value":null}"#,
        ),
    );
    let cleared = result_of(&engine, "settings.thresholds", "{}");
    assert_eq!(
        threshold_figure(&cleared, "Ride", "ftp")["source"],
        Value::Null
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_threshold_the_engine_refuses_is_refused_and_changes_nothing() {
    let mut engine = engine_with_no_catalogue();
    for params in [
        r#"{"sport":"Ride","field":"ftp","value":0.0}"#,
        r#"{"sport":"Ride","field":"ftp","value":-5.0}"#,
        r#"{"sport":"Swim","field":"ftp","value":200.0}"#,
        r#"{"sport":"Ride","field":"cadence","value":90.0}"#,
        r#"{"sport":"Ride","field":"ftp"}"#,
    ] {
        let got = written(&mut engine, &write_request("settings.setThreshold", params));
        assert!(got.get("error").is_some(), "{params} answered {got}");
    }
    let after = result_of(&engine, "settings.thresholds", "{}");
    assert_eq!(
        threshold_figure(&after, "Ride", "ftp")["source"],
        Value::Null
    );
    assert!(logged(&engine).is_empty());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_display_setting_written_over_the_link_is_the_one_the_phone_reads_back() {
    let mut engine = engine_with_no_catalogue();
    let got = written(
        &mut engine,
        &write_request(
            "settings.set",
            r#"{"key":"veloq-theme-preference","value":"dark"}"#,
        ),
    );
    assert_eq!(got["result"]["ok"], true);
    assert_eq!(
        crate::persistence::settings::setting_from(&engine.db, "veloq-theme-preference")
            .unwrap()
            .as_deref(),
        Some("dark")
    );
    let read = result_of(
        &engine,
        "settings.get",
        r#"{"keys":["veloq-theme-preference"]}"#,
    );
    assert_eq!(read["values"][0]["value"], "dark");
    assert_eq!(logged(&engine)[0].method, "settings.set");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_setting_the_link_may_not_write_or_a_value_it_does_not_take_changes_nothing() {
    let mut engine = engine_with_no_catalogue();
    for params in [
        r#"{"key":"intervals-api-key","value":"x"}"#,
        r#"{"key":"__athlete_id","value":"i1"}"#,
        r#"{"key":"veloq-map-preferences","value":"{}"}"#,
        r#"{"key":"veloq-theme-preference","value":"neon"}"#,
        r#"{"key":"veloq-unit-preference","value":"furlongs"}"#,
        r#"{"key":"veloq-primary-sport","value":"Curling"}"#,
        r#"{"key":"veloq-theme-preference"}"#,
    ] {
        let got = written(&mut engine, &write_request("settings.set", params));
        assert!(got.get("error").is_some(), "{params} answered {got}");
    }
    assert_eq!(
        crate::persistence::settings::setting_from(&engine.db, "veloq-theme-preference").unwrap(),
        None
    );
    assert!(logged(&engine).is_empty());
}

#[test]
fn every_writable_setting_is_a_readable_one() {
    for key in WRITABLE_SETTINGS.iter().map(|setting| setting.key) {
        assert!(SETTING_KEYS.contains(&key), "{key}");
    }
}

/// Scenario: the fitness page prints the period's total load beside its bars.
///
/// Expected behaviour: the total is the sum of the days' recorded loads, with a
/// day that records none adding nothing and an empty window totalling zero.
#[test]
fn the_loads_total_is_the_sum_of_the_days_recorded_loads() {
    let day = |date: &str, total: Option<f64>| crate::FfiDayLoad {
        date: date.into(),
        status: crate::FfiDayLoadStatus::Complete,
        total,
        activity_count: 1,
    };

    let reply = FfiLinkDayLoads::of(vec![
        day("2026-09-01", Some(40.0)),
        day("2026-09-02", None),
        day("2026-09-03", Some(25.5)),
    ]);
    assert_eq!(reply.total, 65.5);
    assert_eq!(reply.days.len(), 3);
    assert_eq!(FfiLinkDayLoads::of(Vec::new()).total, 0.0);
}

/// A ridden section with `count` traversals a day apart, oldest first. The
/// quickest is the one at `fastest`, never the newest.
fn engine_with_a_climb_ridden(count: usize, fastest: usize) -> PersistentEngine {
    let mut engine = engine_with_rides();
    let day = 86_400i64;
    let start = 1_700_000_000i64;
    let ids: Vec<String> = (0..count).map(|i| format!("c{i}")).collect();
    let metrics: Vec<crate::types::ActivityMetrics> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| crate::types::ActivityMetrics {
            activity_id: id.clone(),
            name: format!("Ride {i}"),
            date: start + day * i as i64,
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
    for id in &ids {
        let track = (0..60)
            .map(|i| crate::GpsPoint {
                latitude: 46.0 + f64::from(i) * 0.001,
                longitude: 7.0,
                elevation: None,
            })
            .collect();
        engine
            .add_activity(id.clone(), track, "Ride".into())
            .expect("activity");
    }
    engine.set_activity_metrics(metrics).expect("metrics");
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, disabled, version, source_activity_id, elevation_gain_m)
             VALUES ('s1', 'auto', 'Lake climb', 'Ride', '[[46.0,7.0],[46.001,7.0]]', 800.0, 0, 1, NULL, 95.0)",
            [],
        )
        .expect("section");
    for (i, id) in ids.iter().enumerate() {
        let lap_time = if i == fastest {
            150.0f64
        } else {
            200.0 + i as f64
        };
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                 VALUES ('s1', ?1, 'same', 0, 40, 800.0, ?2, ?3, 0)",
                rusqlite::params![id, lap_time, 800.0 / lap_time],
            )
            .expect("traversal");
    }
    engine
}

fn reply_bytes(engine: &PersistentEngine, method: &str, params: &str) -> usize {
    let request = format!(r#"{{"id":1,"method":"{method}","params":{params}}}"#);
    let caller = Caller::default();
    reply_from(engine, &caller, &request).to_string().len()
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_sections_standing_is_its_best_its_newest_attempts_and_its_count_in_a_few_kilobytes() {
    let engine = engine_with_a_climb_ridden(40, 12);
    let got = result_of(
        &engine,
        "section.standing",
        r#"{"id":"s1","timeRangeDays":36500}"#,
    );
    assert_eq!(got["id"], "s1");
    assert_eq!(got["name"], "Lake climb");
    assert_eq!(got["distanceMeters"], 800.0);
    assert_eq!(got["elevationGainM"], 95.0);
    assert_eq!(got["traversalCount"], 40);
    assert_eq!(got["best"]["forward"]["activityId"], "c12");
    assert_eq!(got["best"]["forward"]["timeSecs"], 150.0);
    assert_eq!(
        got["best"]["forward"]["date"].as_f64(),
        Some((1_700_000_000i64 + 12 * 86_400) as f64)
    );
    assert!(got["best"]["reverse"].is_null());

    let recent = got["recent"].as_array().expect("recent attempts");
    assert_eq!(recent.len(), 40);
    assert_eq!(recent[0]["activityId"], "c39");
    assert_eq!(recent[1]["activityId"], "c38");
    assert_eq!(recent[0]["timeSecs"], 239.0);

    let standing = reply_bytes(
        &engine,
        "section.standing",
        r#"{"id":"s1","timeRangeDays":36500}"#,
    );
    let whole = reply_bytes(
        &engine,
        "section.performance",
        r#"{"id":"s1","timeRangeDays":36500}"#,
    );
    assert!(standing < 8 * 1024, "standing is {standing} bytes");
    assert!(whole > 70 * 1024, "performance is {whole} bytes");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_standings_attempts_are_capped_at_a_page_and_a_limit_narrows_them() {
    let engine = engine_with_a_climb_ridden(120, 3);
    let all = result_of(
        &engine,
        "section.standing",
        r#"{"id":"s1","timeRangeDays":36500,"recentLimit":500}"#,
    );
    assert_eq!(
        all["recent"].as_array().map(Vec::len),
        Some(MAX_PAGE as usize)
    );
    assert_eq!(all["traversalCount"], 120);
    let two = result_of(
        &engine,
        "section.standing",
        r#"{"id":"s1","timeRangeDays":36500,"recentLimit":2}"#,
    );
    assert_eq!(two["recent"].as_array().map(Vec::len), Some(2));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_standings_trend_covers_the_window_the_caller_names() {
    let engine = engine_with_a_climb_ridden(40, 12);
    let wide = result_of(
        &engine,
        "section.standing",
        r#"{"id":"s1","timeRangeDays":36500}"#,
    );
    assert_eq!(wide["trend"]["forward"]["count"], 40);
    assert!(wide["trend"]["forward"]["avgTimeSecs"].as_f64().is_some());
    // The newest attempt is from 2023, so a one-day window holds none.
    let narrow = result_of(
        &engine,
        "section.standing",
        r#"{"id":"s1","timeRangeDays":1}"#,
    );
    assert_eq!(narrow["traversalCount"], 40);
    assert!(narrow["trend"]["forward"].is_null());
    assert_eq!(narrow["recent"].as_array().map(Vec::len), Some(0));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_section_nobody_has_ridden_answers_its_own_fields_and_an_unknown_id_is_an_error() {
    let engine = engine_with_a_climb_ridden(0, 0);
    let got = result_of(
        &engine,
        "section.standing",
        r#"{"id":"s1","timeRangeDays":365}"#,
    );
    assert_eq!(got["name"], "Lake climb");
    assert_eq!(got["traversalCount"], 0);
    assert!(got["best"]["forward"].is_null());
    assert_eq!(got["recent"], json!([]));
    assert!(
        error_of(
            &engine,
            "section.standing",
            r#"{"id":"nope","timeRangeDays":365}"#
        )
        .contains("unknown section")
    );
}

#[test]
fn raw_frames_carry_the_bytes_under_the_raw_flag_and_never_gzip() {
    let bytes: Vec<u8> = (0..3 * (FRAME_BYTES - FRAME_HEADER_BYTES) + 7)
        .map(|n| (n % 251) as u8)
        .collect();
    let frames = raw_frames(9, &bytes);
    assert_eq!(frames.len(), 4);
    let mut joined = Vec::new();
    for (seq, frame) in frames.iter().enumerate() {
        assert!(frame.len() <= FRAME_BYTES);
        assert_eq!(frame[0], FRAME_VERSION);
        let last = seq == frames.len() - 1;
        assert_eq!(frame[1], FRAME_RAW | if last { FRAME_LAST } else { 0 });
        assert_eq!(frame[1] & FRAME_GZIP, 0);
        assert_eq!(u32::from_be_bytes(frame[2..6].try_into().unwrap()), 9);
        assert_eq!(
            u32::from_be_bytes(frame[6..10].try_into().unwrap()),
            seq as u32
        );
        joined.extend_from_slice(&frame[FRAME_HEADER_BYTES..]);
    }
    assert_eq!(joined, bytes);
}

#[test]
fn a_raw_answer_needs_framed_protocol_and_older_pages_get_an_error_text() {
    let answer = Answer::Raw {
        id: 4,
        bytes: vec![1, 2, 3],
    };
    let framed = answer.messages(FRAMED_FROM);
    assert!(framed.iter().all(|message| message.binary));
    let older = answer.messages(FRAMED_FROM - 1);
    assert_eq!(older.len(), 1);
    assert!(!older[0].binary);
    assert!(String::from_utf8_lossy(&older[0].bytes).contains("error"));
}

#[test]
fn export_read_is_a_spool_write_and_the_other_export_methods_are_too() {
    for name in [
        "export.begin",
        "export.status",
        "export.read",
        "export.done",
    ] {
        assert!(is_write(name), "{name}");
        assert!(is_spool(name), "{name}");
    }
    assert!(is_spool_bytes("export.read"));
    assert!(!is_spool_bytes("export.status"));
}
