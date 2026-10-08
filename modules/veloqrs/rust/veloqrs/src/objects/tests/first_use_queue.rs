use super::*;
use crate::governor::{Governor, NoopPolicy};
use crate::http::{
    DownloadPriority, enqueue_download, leave_download_queue, should_yield_to_interactive,
};
use crate::persistence::with_persistent_engine;
use crate::test_globals::serial_global_state;
use crate::types::ActivityMetrics;
use httpmock::prelude::*;
use serde_json::json;

const BULK_RUN: u64 = u64::MAX - 100;

fn transport_to(server: &MockServer) -> Transport {
    let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor)
        .expect("transport")
}

fn library_of(count: i64) {
    let metrics = (0..count)
        .map(|index| ActivityMetrics {
            activity_id: format!("r{index}"),
            name: format!("r{index}"),
            date: 1_700_000_000 - index * 86_400,
            distance: 1000.0,
            moving_time: 600,
            elapsed_time: 600,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        })
        .collect::<Vec<_>>();
    with_persistent_engine(move |engine| {
        engine.set_activity_metrics(metrics).expect("store metrics");
    })
    .expect("engine");
}

fn run_with_bulk(server: &MockServer, cancelled: bool) -> Result<(), NetError> {
    enqueue_download(BULK_RUN, 64, DownloadPriority::Bulk);
    let outcome = crate::runtime::block_on(ready_newest_activities(
        crate::persistence::engine_install(),
        &transport_to(server),
        &|| {
            assert!(
                should_yield_to_interactive(BULK_RUN),
                "bulk must yield while first use is active"
            );
            cancelled
        },
    ));
    assert!(
        !should_yield_to_interactive(BULK_RUN),
        "the step releases bulk on exit"
    );
    leave_download_queue(BULK_RUN);
    outcome
}

fn mock_all_bodies(server: &MockServer) {
    server.mock(|when, then| {
        when.method(GET)
            .path_matches(httpmock::Regex::new(r"^/activity/r\d/streams\.json$").expect("pattern"));
        then.status(200).json_body(json!([]));
    });
    server.mock(|when, then| {
        when.method(GET)
            .path_matches(httpmock::Regex::new(r"^/activity/r\d/intervals$").expect("pattern"));
        then.status(200).json_body(json!({"icu_intervals": []}));
    });
    server.mock(|when, then| {
        when.method(GET)
            .path_matches(httpmock::Regex::new(r"^/activity/r\d$").expect("pattern"));
        then.status(200).json_body(json!({
            "id": "r",
            "icu_athlete_id": "i1",
            "start_date_local": "2026-09-01T08:30:00",
            "type": "Ride"
        }));
    });
}

#[test]
fn test_ready_newest_activities_cancellation_releases_bulk() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(1);
    let server = MockServer::start();

    assert!(run_with_bulk(&server, true).is_ok());
}

#[test]
fn test_ready_newest_activities_success_releases_bulk() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(5);
    let server = MockServer::start();
    mock_all_bodies(&server);

    assert!(run_with_bulk(&server, false).is_ok());
    for id in ["r0", "r1", "r2", "r3", "r4"] {
        let ready = with_persistent_engine(|engine| {
            engine.get_activity_body(id).is_some()
                && engine
                    .get_stream_body(id, DETAIL_STREAM_TYPES_KEY)
                    .ok()
                    .flatten()
                    .is_some()
                && engine.get_interval_body(id).ok().flatten().is_some()
        })
        .expect("engine");
        assert!(ready, "{id} is ready");
    }
}

#[test]
fn test_ready_newest_activities_failure_releases_bulk() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(1);
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(500);
    });

    assert!(run_with_bulk(&server, false).is_err());
}
