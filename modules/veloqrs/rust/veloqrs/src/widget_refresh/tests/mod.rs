use super::*;
use crate::objects::{test_base_url, test_credentials};
use crate::test_globals::serial_global_state;
use crate::widget_snapshot::WidgetContext;
use httpmock::prelude::*;
use serde_json::json;

const SHORT: Duration = Duration::from_secs(5);

fn day(days_ago: i64) -> String {
    (chrono::Local::now().date_naive() - chrono::Duration::days(days_ago)).to_string()
}

fn store_context() {
    let json = serde_json::to_string(&WidgetContext {
        locale: "en".to_string(),
        is_metric: true,
        strings: [(
            "time.asOfLastSync".to_string(),
            "As of last sync".to_string(),
        )]
        .into(),
        ..WidgetContext::default()
    })
    .expect("the context");
    crate::persistence::with_persistent_engine(|engine| engine.set_widget_context(&json))
        .expect("the engine")
        .expect("the write");
}

/// The wellness row a foreground sync left behind: three days old.
fn store_stale_wellness() {
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .upsert_wellness(&[crate::persistence::wellness::WellnessRow {
                date: day(3),
                ctl: Some(50.0),
                atl: Some(40.0),
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
            }])
            .expect("the stored row");
    })
    .expect("the engine");
}

/// The moment the last clean sync finished, as the app records it.
const LAST_SYNC: &str = "2026-10-05T07:30:00.000Z";
const LAST_SYNC_SECONDS: i64 = 1_791_185_400;

fn store_last_sync() {
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_setting(
                crate::persistence::settings_keys::SYNC_LAST_SUCCESS_AT,
                LAST_SYNC,
            )
            .expect("the stored sync time");
    })
    .expect("the engine");
}

fn snapshot_of(refresh: &WidgetRefresh) -> serde_json::Value {
    serde_json::from_str(&refresh.snapshot_json).expect("a snapshot a widget can read")
}

fn fitness_of(refresh: &WidgetRefresh) -> f64 {
    let snapshot: serde_json::Value =
        serde_json::from_str(&refresh.snapshot_json).expect("a snapshot a widget can read");
    snapshot["metrics"]["fitness"]["value"]
        .as_f64()
        .expect("a fitness value")
}

fn refresh(deadline: Duration) -> Option<WidgetRefresh> {
    refresh_open_engine(deadline)
}

/// Scenario: the last foreground sync was three days ago and the wellness feed
/// has rows since. The app is killed and a refresh runs.
///
/// Expected behaviour: the refresh asks for the 14-day window and the snapshot
/// carries the pulled rows, not the three-day-old ones.
#[test]
fn the_snapshot_carries_the_rows_the_refresh_pulled() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_pull.db");
    let _creds = test_credentials();
    store_context();
    store_stale_wellness();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    let window = server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/1/wellness")
            .query_param("oldest", day(WELLNESS_REFRESH_DAYS))
            .query_param("newest", day(0));
        then.status(200).json_body(json!([
            {"id": day(1), "ctl": 70.0, "atl": 55.0},
            {"id": day(0), "ctl": 72.0, "atl": 58.0},
        ]));
    });

    let refreshed = refresh(SHORT).expect("a snapshot");

    window.assert();
    assert_eq!(refreshed.status, PullStatus::Pulled);
    assert_eq!(fitness_of(&refreshed), 72.0);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the server refuses the credential during a refresh.
///
/// Expected behaviour: the snapshot is still composed, from the stored rows,
/// and the status says the credential expired.
#[test]
fn an_expired_credential_composes_from_the_stored_rows_and_says_so() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_expired.db");
    let _creds = test_credentials();
    store_context();
    store_stale_wellness();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    server.mock(|when, then| {
        when.method(GET).path("/athlete/1/wellness");
        then.status(401);
    });

    let refreshed = refresh(SHORT).expect("a snapshot");

    assert_eq!(refreshed.status, PullStatus::Expired);
    assert_eq!(fitness_of(&refreshed), 50.0);
    crate::persistence::clear_persistent_engine();
}

#[test]
fn a_server_failure_composes_from_the_stored_rows_and_says_it_failed() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_failed.db");
    let _creds = test_credentials();
    store_context();
    store_stale_wellness();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    server.mock(|when, then| {
        when.method(GET).path("/athlete/1/wellness");
        then.status(400).body("no");
    });

    let refreshed = refresh(SHORT).expect("a snapshot");

    assert_eq!(refreshed.status, PullStatus::Failed);
    assert_eq!(fitness_of(&refreshed), 50.0);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the pull is slower than the deadline the caller can afford.
///
/// Expected behaviour: the refresh answers at the deadline with the stored
/// rows and does not wait for the server.
#[test]
fn a_pull_that_outlasts_the_deadline_composes_from_the_stored_rows() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_slow.db");
    let _creds = test_credentials();
    store_context();
    store_stale_wellness();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    server.mock(|when, then| {
        when.method(GET).path("/athlete/1/wellness");
        then.status(200)
            .delay(Duration::from_secs(3))
            .json_body(json!([{"id": day(0), "ctl": 72.0, "atl": 58.0}]));
    });

    let refreshed = refresh(Duration::from_millis(200)).expect("a snapshot");

    assert_eq!(refreshed.status, PullStatus::TimedOut);
    assert_eq!(fitness_of(&refreshed), 50.0);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the process holds no credential, as after a sign-out.
///
/// Expected behaviour: nothing is requested and the stored rows are composed.
#[test]
fn with_no_credential_nothing_is_requested_and_the_stored_rows_are_composed() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_no_credential.db");
    store_context();
    store_stale_wellness();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    let any = server.mock(|when, then| {
        when.method(GET);
        then.status(200).json_body(json!([]));
    });

    let refreshed = refresh(SHORT).expect("a snapshot");

    any.assert_hits(0);
    assert_eq!(refreshed.status, PullStatus::NoCredential);
    assert_eq!(fitness_of(&refreshed), 50.0);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the app has never stored a context.
///
/// Expected behaviour: no snapshot, and no request spent on one.
#[test]
fn with_no_stored_context_there_is_nothing_to_write_and_nothing_is_requested() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_no_context.db");
    let _creds = test_credentials();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    let any = server.mock(|when, then| {
        when.method(GET);
        then.status(200).json_body(json!([]));
    });

    assert_eq!(refresh(SHORT), None);

    any.assert_hits(0);
    crate::persistence::clear_persistent_engine();
}

#[test]
fn with_the_engine_closed_there_is_nothing_to_write() {
    let _guard = serial_global_state();
    crate::persistence::clear_persistent_engine();

    assert_eq!(refresh(SHORT), None);
}

/// Scenario: the process starts cold for the refresh, so the engine is closed
/// and the caller hands over the path and a credential.
///
/// Expected behaviour: the engine opens at that path and the stored context
/// there is used.
#[test]
fn a_cold_refresh_opens_the_engine_at_the_path_it_was_given() {
    let _guard = serial_global_state();
    let tmp = crate::test_globals::init_global_engine("widget_refresh_cold.db");
    store_context();
    store_stale_wellness();
    crate::persistence::clear_persistent_engine();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    server.mock(|when, then| {
        when.method(GET).path("/athlete/9/wellness");
        then.status(200)
            .json_body(json!([{"id": day(0), "ctl": 72.0, "atl": 58.0}]));
    });
    let db_path = tmp.path().join("widget_refresh_cold.db");

    let refreshed = refresh_snapshot_within(
        db_path.to_str().expect("a path"),
        NativeCredential::Method {
            method: "api_key",
            secret: "k",
            athlete_id: "9",
        },
        SHORT,
    )
    .expect("a snapshot");

    assert_eq!(refreshed.status, PullStatus::Pulled);
    assert_eq!(fitness_of(&refreshed), 72.0);
    crate::persistence::clear_persistent_engine();
}

#[test]
fn the_answer_is_one_object_holding_the_status_and_the_snapshot() {
    let refresh = WidgetRefresh {
        status: PullStatus::TimedOut,
        snapshot_json: r#"{"schemaVersion":9}"#.to_string(),
    };

    let parsed: serde_json::Value = serde_json::from_str(&refresh.to_json()).expect("JSON");

    assert_eq!(parsed["status"], "timed_out");
    assert_eq!(parsed["snapshot"]["schemaVersion"], 9);
}

/// Scenario: the server refuses the credential, so the widget is redrawn from
/// rows the last sync stored.
///
/// Expected behaviour: the snapshot names the moment of that sync and carries
/// the app's own words for it, so the widget does not read as current.
#[test]
fn a_snapshot_the_pull_did_not_refresh_says_the_data_is_as_of_the_last_sync() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_as_of.db");
    let _creds = test_credentials();
    store_context();
    store_stale_wellness();
    store_last_sync();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    server.mock(|when, then| {
        when.method(GET).path("/athlete/1/wellness");
        then.status(401);
    });

    let refreshed = refresh(SHORT).expect("a snapshot");

    let snapshot = snapshot_of(&refreshed);
    assert_eq!(snapshot["dataAsOf"], LAST_SYNC_SECONDS);
    assert_eq!(snapshot["display"]["dataAsOfLabel"], "As of last sync");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: a pull that did not land, in a library that has never recorded a
/// clean sync.
///
/// Expected behaviour: the words are there and no time is invented for them.
#[test]
fn with_no_recorded_sync_the_words_stand_without_a_time() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_as_of_unknown.db");
    store_context();
    store_stale_wellness();

    let refreshed = refresh(SHORT).expect("a snapshot");

    assert_eq!(refreshed.status, PullStatus::NoCredential);
    let snapshot = snapshot_of(&refreshed);
    assert_eq!(snapshot["display"]["dataAsOfLabel"], "As of last sync");
    assert!(snapshot.get("dataAsOf").is_none());
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the pull lands.
///
/// Expected behaviour: the snapshot is current and carries neither the words
/// nor a time, so the widget's own age line is the whole story.
#[test]
fn a_snapshot_the_pull_refreshed_carries_no_as_of_marking() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_refresh_as_of_current.db");
    let _creds = test_credentials();
    store_context();
    store_stale_wellness();
    store_last_sync();
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    server.mock(|when, then| {
        when.method(GET).path("/athlete/1/wellness");
        then.status(200)
            .json_body(json!([{"id": day(0), "ctl": 72.0, "atl": 58.0}]));
    });

    let refreshed = refresh(SHORT).expect("a snapshot");

    assert_eq!(refreshed.status, PullStatus::Pulled);
    let snapshot = snapshot_of(&refreshed);
    assert!(snapshot.get("dataAsOf").is_none());
    assert!(snapshot["display"].get("dataAsOfLabel").is_none());
    crate::persistence::clear_persistent_engine();
}
