use super::*;
use crate::governor::{AuthMethod, Governor, NoopPolicy};
use crate::net::Transport;
use crate::objects::{SYNC_SERVICE, SyncState};
use httpmock::prelude::*;
use std::sync::Arc;

fn unauthorized_result() -> crate::http::ActivityMapResult {
    crate::http::ActivityMapResult {
        activity_id: "a1".to_string(),
        latlngs: None,
        elevations: None,
        elevation_corrected: false,
        body_bytes: 0,
        streams: Vec::new(),
        times: Vec::new(),
        success: false,
        error: Some("unauthorized".to_string()),
    }
}

#[test]
fn test_track_unauthorized_parks_only_when_profile_confirms() {
    let _serial = crate::test_globals::serial_global_state();
    let _credential = crate::objects::sync::test_credentials();
    for (status, expected) in [(401, SyncState::AuthExpired), (200, SyncState::Idle)] {
        crate::objects::set_credentials_from_native("api_key", "key", "1").expect("credential");
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/1");
            then.status(status)
                .json_body(serde_json::json!({"id": "1"}));
        });
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let transport =
            Transport::with_governor(server.base_url(), AuthMethod::ApiKey("key"), governor)
                .expect("transport");
        crate::runtime::block_on(park_track_auth_failure(
            &unauthorized_result(),
            &transport,
            "1",
        ));
        assert_eq!(SYNC_SERVICE.snapshot().state, expected);
    }
}

fn track_body() -> serde_json::Value {
    serde_json::json!([{"type": "latlng", "data": [46.0, 46.1], "data2": [7.0, 7.1]}])
}

fn time_body() -> serde_json::Value {
    serde_json::json!([
        {"type": "time", "data": [0, 1]},
        {"type": "latlng", "data": [46.0, 46.1], "data2": [7.0, 7.1]}
    ])
}

fn run_result(run: f64) -> FetchAndStoreResult {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        if let Some(result) = take_fetch_and_store_result(run) {
            return result;
        }
        assert!(std::time::Instant::now() < until, "run {run} never settled");
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

fn wait_for_a_hit(mocks: &[httpmock::Mock<'_>]) {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while mocks.iter().all(|mock| mock.hits() == 0) {
        assert!(
            std::time::Instant::now() < until,
            "no request reached the fake transport"
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

fn profile_answers(server: &MockServer, status: u16) {
    server.mock(|when, then| {
        when.method(GET).path("/athlete/1");
        then.status(status)
            .json_body(serde_json::json!({"id": "1"}));
    });
}

#[test]
fn a_track_run_parks_on_a_401_only_when_the_profile_confirms_it() {
    let _serial = crate::test_globals::serial_global_state();
    for (status, expected) in [(401, SyncState::AuthExpired), (200, SyncState::Idle)] {
        // A bulk run claims each track in the engine's attempt store, so with
        // no engine it fetches nothing. A fresh one per case, or the first
        // case's refusal backs the track off and the second asks for nothing.
        let _engine = crate::test_globals::init_global_engine("track-401.db");
        let server = MockServer::start();
        let _base = crate::objects::sync::test_base_url(server.base_url());
        crate::objects::set_credentials_from_native("api_key", "key", "1").expect("credential");
        let track = server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(401);
        });
        profile_answers(&server, status);

        let run = start_fetch_and_store(
            vec!["a1".to_string()],
            vec![],
            crate::http::DownloadPriority::Bulk,
        );
        run_result(run);

        assert!(
            track.hits() > 0,
            "the run never asked for the track (profile {status})"
        );
        assert_eq!(SYNC_SERVICE.snapshot().state, expected, "profile {status}");
        crate::objects::sync::clear_test_credentials();
    }
}

#[test]
fn a_single_activity_fetch_parks_on_a_401_only_when_the_profile_confirms_it() {
    let _serial = crate::test_globals::serial_global_state();
    for (status, expected) in [(401, SyncState::AuthExpired), (200, SyncState::Idle)] {
        let server = MockServer::start();
        let _base = crate::objects::sync::test_base_url(server.base_url());
        crate::objects::set_credentials_from_native("api_key", "key", "1").expect("credential");
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(401);
        });
        profile_answers(&server, status);

        let outcome = fetch_and_index_activity("a1".to_string(), "Ride".to_string());

        assert!(outcome.is_err(), "a refused track indexes nothing");
        assert_eq!(SYNC_SERVICE.snapshot().state, expected, "profile {status}");
        crate::objects::sync::clear_test_credentials();
    }
}

/// Scenario: the athlete signs out while the map download is part way through
/// a queue longer than one concurrent window.
///
/// Expected behaviour: nothing is dispatched past the window already in
/// flight, and what lands after the sign-out is not stored.
#[test]
fn a_sign_out_stops_the_track_run_and_stores_nothing_after_it() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sign-out-tracks.db");
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    crate::objects::set_credentials_from_native("api_key", "key", "1").expect("credential");
    let ids: Vec<String> = (0..crate::http::MAX_CONCURRENCY + 10)
        .map(|i| format!("out-{i}"))
        .collect();
    let mocks: Vec<_> = ids
        .iter()
        .map(|id| {
            server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/activity/{id}/streams.json"));
                then.status(200)
                    .delay(std::time::Duration::from_millis(300))
                    .json_body(track_body());
            })
        })
        .collect();

    let run = start_fetch_and_store(ids.clone(), vec![], crate::http::DownloadPriority::Bulk);
    wait_for_a_hit(&mocks);
    crate::objects::sync::clear_test_credentials();
    let result = run_result(run);

    let dispatched: usize = mocks.iter().map(httpmock::Mock::hits).sum();
    assert!(
        dispatched <= crate::http::MAX_CONCURRENCY,
        "dispatched {dispatched} track requests after the sign-out"
    );
    assert!(
        result.synced_ids.is_empty(),
        "stored {:?} after the sign-out",
        result.synced_ids
    );
    let stored = crate::persistence::with_persistent_engine(|engine| {
        ids.iter()
            .filter(|id| engine.get_gps_track(id).is_some())
            .count()
    })
    .expect("engine");
    assert_eq!(stored, 0, "tracks reached the library after the sign-out");
}

/// Scenario: the tracks are down and the run is fetching the time streams
/// they did not carry when the athlete signs out.
///
/// Expected behaviour: the chunk in flight is the last one asked for.
#[test]
fn a_sign_out_stops_the_time_stream_tail() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sign-out-times.db");
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    crate::objects::set_credentials_from_native("api_key", "key", "1").expect("credential");
    let ids: Vec<String> = (0..TIME_STREAM_CONCURRENCY + 5)
        .map(|i| format!("tail-{i}"))
        .collect();
    let mut time_mocks = Vec::new();
    for id in &ids {
        server.mock(|when, then| {
            when.method(GET)
                .path(format!("/activity/{id}/streams.json"))
                .query_param("types", crate::net::endpoints::TRACK_STREAM_TYPES);
            then.status(200).json_body(track_body());
        });
        time_mocks.push(server.mock(|when, then| {
            when.method(GET)
                .path(format!("/activity/{id}/streams.json"))
                .query_param("types", "time,latlng");
            then.status(200)
                .delay(std::time::Duration::from_millis(300))
                .json_body(time_body());
        }));
    }

    let run = start_fetch_and_store(ids.clone(), vec![], crate::http::DownloadPriority::Bulk);
    wait_for_a_hit(&time_mocks);
    crate::objects::sync::clear_test_credentials();
    run_result(run);

    let asked: usize = time_mocks.iter().map(httpmock::Mock::hits).sum();
    assert!(
        asked <= TIME_STREAM_CONCURRENCY,
        "asked for {asked} time streams after the sign-out"
    );
}

/// Scenario: the key was regenerated between the track download and the time
/// streams behind it.
///
/// Expected behaviour: the first 401 ends the tail, and a profile that
/// confirms it parks the service while one that does not leaves it standing.
#[test]
fn a_401_on_the_time_stream_tail_parks_and_asks_nothing_more() {
    let _serial = crate::test_globals::serial_global_state();
    for (status, expected) in [(401, SyncState::AuthExpired), (200, SyncState::Idle)] {
        let _engine = crate::test_globals::init_global_engine("tail-401.db");
        let server = MockServer::start();
        let _base = crate::objects::sync::test_base_url(server.base_url());
        crate::objects::set_credentials_from_native("api_key", "key", "1").expect("credential");
        profile_answers(&server, status);
        let ids: Vec<String> = (0..TIME_STREAM_CONCURRENCY + 5)
            .map(|i| format!("refused-{i}"))
            .collect();
        let mut time_mocks = Vec::new();
        for id in &ids {
            server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/activity/{id}/streams.json"))
                    .query_param("types", crate::net::endpoints::TRACK_STREAM_TYPES);
                then.status(200).json_body(track_body());
            });
            time_mocks.push(server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/activity/{id}/streams.json"))
                    .query_param("types", "time,latlng");
                then.status(401);
            }));
        }

        let run = start_fetch_and_store(ids.clone(), vec![], crate::http::DownloadPriority::Bulk);
        run_result(run);

        let asked: usize = time_mocks.iter().map(httpmock::Mock::hits).sum();
        assert!(
            asked <= TIME_STREAM_CONCURRENCY,
            "asked for {asked} time streams after a 401 (profile {status})"
        );
        assert_eq!(SYNC_SERVICE.snapshot().state, expected, "profile {status}");
        crate::objects::sync::clear_test_credentials();
    }
}
