//! Scenario: a sync pass has fetched its page when the athlete restores a
//! backup. `destroy` cancels cooperatively, so a pass already past its last
//! check is not stopped, and an unstamped write puts the old library's rows
//! into the restored database.
//!
//! Expected behaviour: each pass that writes does so under the install it was
//! started against. Once the install has moved, the write is discarded and the
//! pass reports the engine closed rather than success.

use super::*;
use httpmock::prelude::*;

fn transport(server: &MockServer) -> Transport {
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap()
}

/// The install a pass was started against, after a restore has moved it on.
fn stale_install() -> u64 {
    let started = crate::persistence::engine_install();
    crate::persistence::invalidate_engine_install();
    assert_ne!(started, crate::persistence::engine_install());
    started
}

fn ride_listing(server: &MockServer) {
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(serde_json::json!([{
            "id": "late", "type": "Ride", "name": "Late ride",
            "start_date_local": "2025-06-03T08:00:00"
        }]));
    });
}

#[test]
fn an_activity_page_fetched_before_a_restore_is_not_written() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("stale-page.db");
    let server = MockServer::start();
    ride_listing(&server);
    let started = stale_install();

    let outcome = crate::runtime::block_on(sync_activity_window(
        started,
        &transport(&server),
        "i1",
        "2025-06-01",
        "2025-06-05",
        None,
        &|| false,
    ));

    assert!(matches!(outcome, Err(NetError::EngineClosed)));
    crate::persistence::with_persistent_engine(|engine| {
        assert!(engine.get_activity_body("late").is_none());
    })
    .unwrap();
}

#[test]
fn a_history_summary_fetched_before_a_restore_is_not_written() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("stale-summary.db");
    let server = MockServer::start();
    ride_listing(&server);
    let started = stale_install();

    let outcome = crate::runtime::block_on(sync_activity_history_summary(
        started,
        &transport(&server),
        "i1",
    ));

    assert!(matches!(outcome, Err(NetError::EngineClosed)));
    crate::persistence::with_persistent_engine(|engine| {
        assert_eq!(engine.get_setting(OLDEST_ACTIVITY_DATE_KEY).unwrap(), None);
        assert!(engine.get_activity_body("late").is_none());
    })
    .unwrap();
}

#[test]
fn a_field_set_recorded_before_a_restore_is_not_written() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("stale-fields.db");
    let key = crate::persistence::settings_keys::ACTIVITY_BODY_FIELDS;
    crate::persistence::with_persistent_engine(|engine| {
        engine.set_setting(key, "id,type").unwrap();
    })
    .unwrap();
    let started = stale_install();

    crate::runtime::block_on(record_activity_fields(started, "id,name".to_string()));

    crate::persistence::with_persistent_engine(|engine| {
        assert_eq!(engine.get_setting(key).unwrap().as_deref(), Some("id,type"));
    })
    .unwrap();
}

#[test]
fn a_body_stored_before_a_restore_is_discarded_and_reported() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("stale-body.db");
    let started = stale_install();

    let stored = crate::runtime::block_on(store_body_or_fail(
        started,
        "detail",
        "late".to_string(),
        |engine| engine.store_activity_detail_body("late", 1, "{}"),
    ));

    assert!(matches!(stored, Err(NetError::EngineClosed)));
    crate::persistence::with_persistent_engine(|engine| {
        assert!(engine.get_activity_body("late").is_none());
    })
    .unwrap();
}

fn stored_streams() -> i64 {
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .db
            .query_row("SELECT COUNT(*) FROM time_streams", [], |row| row.get(0))
            .unwrap()
    })
    .unwrap()
}

#[test]
fn a_time_stream_fetched_before_a_restore_is_not_written() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("stale-stream.db");
    crate::persistence::with_persistent_engine(|engine| {
        let track = (0..3)
            .map(|i| tracematch::GpsPoint {
                latitude: 46.0 + f64::from(i) * 0.001,
                longitude: 7.0,
                elevation: None,
            })
            .collect();
        engine
            .add_activity("late".to_string(), track, "Ride".to_string())
            .unwrap();
    })
    .unwrap();
    let started = stale_install();

    crate::runtime::block_on(store_time_stream(
        started,
        "late".to_string(),
        vec![0, 1, 2],
    ));
    assert_eq!(stored_streams(), 0);

    crate::runtime::block_on(store_time_stream(
        crate::persistence::engine_install(),
        "late".to_string(),
        vec![0, 1, 2],
    ));
    assert_eq!(stored_streams(), 1, "the live install must still write");
}
