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
