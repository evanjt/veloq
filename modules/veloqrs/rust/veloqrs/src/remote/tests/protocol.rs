//! Each method answers what the app's own read answers.

use super::*;
use crate::persistence::PersistentEngine;
use serde_json::Value;

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
    serde_json::from_str(&answer(&engine.db, request)).expect("a JSON reply")
}

#[test]
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
    assert_eq!(got["result"], serde_json::to_value(&page).unwrap());
    assert_eq!(got["result"]["matchedCount"], 2);
    assert_eq!(got["result"]["hasMore"], true);
    assert_eq!(got["result"]["cards"][0]["id"], "i2");
}

#[test]
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
fn an_unknown_method_is_an_error_not_a_panic() {
    let engine = engine_with_rides();
    let got = reply(&engine, r#"{"id":3,"method":"activities.delete"}"#);
    assert_eq!(got["id"], 3);
    assert_eq!(got["error"], "unknown method: activities.delete");
    assert!(got.get("result").is_none());
}

#[test]
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
    engine
}

fn written(engine: &mut PersistentEngine, request: &str) -> Value {
    serde_json::from_str(&answer_write(engine, BROWSER, request)).expect("a JSON reply")
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
    assert_eq!(writes, ["section.rename"]);
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
        "activity.summary" => r#"{"id":"i1"}"#,
        "section.rename" => r#"{"id":"s_a","name":"Col"}"#,
        other => panic!("no sample ask for {other}"),
    }
}

#[test]
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
fn hello_answers_a_page_on_another_protocol_with_the_phones_own() {
    let engine = engine_with_rides();
    let got = reply(
        &engine,
        r#"{"id":1,"method":"link.hello","params":{"protocol":4,"page":"newer page"}}"#,
    );
    assert_eq!(got["result"]["protocol"], PROTOCOL_VERSION);
}

#[test]
fn every_listed_method_answers_a_well_formed_ask() {
    let engine = engine_with_rides();
    let mut sections = engine_with_a_section();
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
fn method_names_are_unique() {
    let mut names: Vec<&str> = METHODS.iter().map(|method| method.name).collect();
    names.sort_unstable();
    let count = names.len();
    names.dedup();
    assert_eq!(names.len(), count);
}

#[test]
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
fn a_small_reply_is_one_plain_last_frame() {
    let reply = json!({ "id": 3, "result": "short" }).to_string();
    let cut = frames(&reply);
    assert_eq!(cut.len(), 1);
    assert_eq!(cut[0][1], FRAME_LAST);
    assert_eq!(joined(&cut), (3, reply));
}

#[test]
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
fn a_reply_with_no_numeric_id_travels_under_id_zero() {
    let reply = json!({ "id": null, "error": "malformed request" }).to_string();
    assert_eq!(joined(&frames(&reply)), (0, reply));
}

#[test]
fn an_empty_reply_is_one_empty_last_frame() {
    let cut = frames("");
    assert_eq!(cut.len(), 1);
    assert_eq!(cut[0].len(), FRAME_HEADER_BYTES);
    assert_eq!(cut[0][1], FRAME_LAST);
}

#[test]
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
