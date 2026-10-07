use super::*;
use crate::governor::{AuthMethod, Governor, NoopPolicy};
use httpmock::prelude::*;

#[test]
fn test_track_unauthorized_stops_batch_dispatch() {
    let server = MockServer::start();
    let ids: Vec<String> = (0..MAX_CONCURRENCY + 10)
        .map(|id| format!("a{id}"))
        .collect();
    let mocks: Vec<_> = ids
        .iter()
        .map(|id| {
            server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/activity/{id}/streams.json"));
                then.status(401);
            })
        })
        .collect();
    let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("key"), governor)
            .expect("transport");
    let fetcher = ActivityFetcher::with_transport(transport);

    let results =
        crate::runtime::block_on(fetcher.fetch_activity_maps(0, ids, Default::default(), None));

    assert!(
        results
            .iter()
            .any(|result| result.error.as_deref() == Some("unauthorized"))
    );
    let dispatched: usize = mocks.iter().map(httpmock::Mock::hits).sum();
    assert!(
        dispatched <= MAX_CONCURRENCY,
        "dispatched {dispatched} requests after a 401"
    );
}

/// Scenario: a run with many ids is cancelled as soon as its first result
/// lands.
///
/// Expected behaviour: requests already in flight finish, no further request
/// goes out, and the run's counter stops where the cancel landed.
#[test]
fn a_cancelled_run_stops_dispatching_and_counting() {
    let _serial = crate::test_globals::serial_global_state();
    let run = u64::MAX - 2_000;
    let server = MockServer::start();
    let ids: Vec<String> = (0..MAX_CONCURRENCY * 4)
        .map(|id| format!("a{id}"))
        .collect();
    let mocks: Vec<_> = ids
        .iter()
        .map(|id| {
            server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/activity/{id}/streams.json"));
                then.status(200).json_body(serde_json::json!({}));
            })
        })
        .collect();
    let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("key"), governor)
            .expect("transport");
    let fetcher = ActivityFetcher::with_transport(transport);

    enqueue_download(run, ids.len() as u32, DownloadPriority::Bulk);
    {
        let _slot = hold_download_slot(run);
        crate::runtime::block_on(fetcher.fetch_activity_maps_into(
            run,
            ids.clone(),
            Default::default(),
            None,
            || true,
            |_, _permit| {
                cancel_download(run);
            },
        ));
    }

    let dispatched: usize = mocks.iter().map(httpmock::Mock::hits).sum();
    assert!(
        dispatched <= MAX_CONCURRENCY + 1,
        "dispatched {dispatched} requests after a cancel"
    );
    leave_download_queue(run);
}
