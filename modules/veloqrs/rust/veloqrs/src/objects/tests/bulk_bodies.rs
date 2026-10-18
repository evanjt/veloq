//! Scenario: a library owes an interval body for every activity it holds, as
//! every upgrade from a release before interval bodies does, and the newest
//! few also owe their detail bodies.
//!
//! Expected behaviour: both bodies arrive through the bulk activities endpoint,
//! at most 200 ids a request, matched to their rows by id. What the bulk
//! answer leaves out costs one single interval request to confirm before
//! anything is recorded as absent, a chunk that times out is retried in
//! halves, and the stored bodies are the bodies the single endpoints answer,
//! byte for byte.

use super::*;
use crate::governor::{Governor, NoopPolicy};
use crate::net::transport::LaneTimeouts;
use crate::persistence::with_persistent_engine;
use crate::test_globals::serial_global_state;
use crate::types::ActivityMetrics;
use httpmock::prelude::*;
use std::time::Duration;

const ATHLETE: &str = "i1";

fn init_engine() -> tempfile::TempDir {
    crate::test_globals::init_global_engine("bulk_bodies.db")
}

fn transport_to(server: &MockServer) -> Transport {
    let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor)
        .expect("transport")
}

/// A transport whose backfill attempts give up after `ceiling`.
fn transport_with_backfill_ceiling(server: &MockServer, ceiling: Duration) -> Transport {
    let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    let timeouts = LaneTimeouts {
        backfill: ceiling,
        ..LaneTimeouts::default()
    };
    Transport::with_timeouts(
        server.base_url(),
        AuthMethod::ApiKey("k"),
        governor,
        timeouts,
    )
    .expect("transport")
}

/// `count` ids, `b000` the newest.
fn owed_ids(count: usize) -> Vec<String> {
    (0..count).map(|i| format!("b{i:03}")).collect()
}

/// A library holding `ids`, newest first in the order given.
fn library_of(ids: &[String]) {
    let metrics = ids
        .iter()
        .enumerate()
        .map(|(i, id)| ActivityMetrics {
            activity_id: id.clone(),
            name: id.clone(),
            date: 1_700_000_000 - i as i64 * 3_600,
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

/// The detail body the single endpoint answers for `id`.
fn detail_text(id: &str) -> String {
    format!(
        r#"{{"id":"{id}","start_date_local":"2025-03-01T07:30:00","type":"Ride","name":"{id}","analyzed":"2025-03-01T08:00:00.000+00:00","icu_athlete_id":"i1","moving_time":600}}"#
    )
}

/// The interval body the single endpoint answers for `id`.
fn intervals_text(id: &str) -> String {
    format!(
        r#"{{"id":"{id}","analyzed":"2025-03-01T08:00:00.000+00:00","icu_intervals":[{{"type":"WORK","start_index":0,"end_index":9}}],"icu_groups":[{{"id":"g1","count":1}}]}}"#
    )
}

/// One activity as the bulk endpoint answers it: the detail body with the
/// interval fields after it.
fn bulk_item(id: &str) -> String {
    format!(
        r#"{{"id":"{id}","start_date_local":"2025-03-01T07:30:00","type":"Ride","name":"{id}","analyzed":"2025-03-01T08:00:00.000+00:00","icu_athlete_id":"i1","moving_time":600,"icu_intervals":[{{"type":"WORK","start_index":0,"end_index":9}}],"icu_groups":[{{"id":"g1","count":1}}]}}"#
    )
}

fn bulk_path(ids: &[String]) -> String {
    format!("/athlete/{ATHLETE}/activities/{}", ids.join(","))
}

/// The server answers sorted by id, whatever order the ids were asked in.
fn sorted_answer(items: Vec<String>, ids: &[String]) -> String {
    let mut paired: Vec<(&String, String)> = ids.iter().zip(items).collect();
    paired.sort_by(|a, b| a.0.cmp(b.0));
    format!(
        "[{}]",
        paired
            .into_iter()
            .map(|(_, item)| item)
            .collect::<Vec<_>>()
            .join(",")
    )
}

/// The bulk request for exactly `ids`, answering every one.
fn mock_bulk<'a>(server: &'a MockServer, ids: &[String]) -> httpmock::Mock<'a> {
    let body = sorted_answer(ids.iter().map(|id| bulk_item(id)).collect(), ids);
    let path = bulk_path(ids);
    server.mock(|when, then| {
        when.method(GET).path(path).query_param("intervals", "true");
        then.status(200)
            .header("content-type", "application/json")
            .body(body);
    })
}

fn mock_bulk_answering<'a>(
    server: &'a MockServer,
    asked: &[String],
    answer: String,
) -> httpmock::Mock<'a> {
    let path = bulk_path(asked);
    server.mock(|when, then| {
        when.method(GET).path(path).query_param("intervals", "true");
        then.status(200)
            .header("content-type", "application/json")
            .body(answer);
    })
}

/// Any single-activity request, which a bulk-served sweep should not make.
fn mock_single_activity_requests(server: &MockServer) -> httpmock::Mock<'_> {
    server.mock(|when, then| {
        when.method(GET).path_matches(r"^/activity/");
        then.status(500);
    })
}

fn sweep_with(transport: &Transport) -> Result<(), NetError> {
    crate::runtime::block_on(sync_interval_bodies(
        crate::persistence::engine_install(),
        &crate::net::IntervalsSession::new(transport.clone(), ATHLETE),
        &|| false,
        &|_, _| {},
    ))
}

fn sweep(server: &MockServer) -> Result<(), NetError> {
    sweep_with(&transport_to(server))
}

fn interval_body(id: &str) -> Option<String> {
    with_persistent_engine(|engine| engine.get_interval_body(id))
        .expect("engine")
        .expect("read")
}

fn activity_body(id: &str) -> Option<String> {
    with_persistent_engine(|engine| engine.get_activity_body(id)).expect("engine")
}

fn owing(limit: usize) -> Vec<crate::persistence::bodies::BodiesOwed> {
    with_persistent_engine(|engine| {
        engine.newest_activities_owing_bodies(limit, DETAIL_STREAM_TYPES_KEY)
    })
    .expect("engine")
    .expect("read")
}

#[test]
fn four_hundred_and_fifty_owed_bodies_cost_three_requests() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(450);
    library_of(&ids);
    let server = MockServer::start();
    let chunks: Vec<_> = ids.chunks(200).map(|c| mock_bulk(&server, c)).collect();
    let single = mock_single_activity_requests(&server);

    sweep(&server).expect("the sweep");

    for chunk in &chunks {
        chunk.assert_calls(1);
    }
    single.assert_calls(0);
    for id in &ids {
        assert_eq!(
            interval_body(id),
            Some(intervals_text(id)),
            "{id} intervals"
        );
        assert_eq!(activity_body(id), Some(detail_text(id)), "{id} detail");
    }
    let owed = owing(ids.len());
    assert!(
        owed.iter().all(|o| !o.detail && !o.intervals),
        "no detail or interval body is still owed: {:?}",
        owed.iter().find(|o| o.detail || o.intervals)
    );

    let quiet = MockServer::start();
    let any = quiet.mock(|when, then| {
        when.method(GET);
        then.status(500);
    });
    sweep(&quiet).expect("a library with every body owes nothing");
    any.assert_calls(0);
}

#[test]
fn a_stored_detail_body_carries_no_second_copy_of_the_laps() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(3);
    library_of(&ids);
    let server = MockServer::start();
    mock_bulk(&server, &ids);

    sweep(&server).expect("the sweep");

    for id in &ids {
        let detail = activity_body(id).expect("detail stored");
        let parsed: serde_json::Value = serde_json::from_str(&detail).expect("json");
        assert!(parsed.get("icu_intervals").is_none(), "{id}: {detail}");
        assert!(parsed.get("icu_groups").is_none(), "{id}: {detail}");
    }
}

#[test]
fn exactly_two_hundred_owed_is_one_request_and_two_hundred_and_one_is_two() {
    for (count, requests) in [(200usize, 1usize), (201, 2)] {
        let _guard = serial_global_state();
        let _dir = init_engine();
        let ids = owed_ids(count);
        library_of(&ids);
        let server = MockServer::start();
        let chunks: Vec<_> = ids.chunks(200).map(|c| mock_bulk(&server, c)).collect();
        let single = mock_single_activity_requests(&server);

        sweep(&server).expect("the sweep");

        assert_eq!(chunks.len(), requests);
        for chunk in &chunks {
            chunk.assert_calls(1);
        }
        single.assert_calls(0);
        assert!(ids.iter().all(|id| interval_body(id).is_some()), "{count}");
    }
}

#[test]
fn ids_asked_out_of_order_are_matched_to_their_own_rows() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids: Vec<String> = ["b007", "b002", "b009", "b001"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    library_of(&ids);
    let server = MockServer::start();
    let bulk = mock_bulk(&server, &ids);

    sweep(&server).expect("the sweep");

    bulk.assert_calls(1);
    for id in &ids {
        assert_eq!(interval_body(id), Some(intervals_text(id)), "{id}");
        assert_eq!(activity_body(id), Some(detail_text(id)), "{id}");
    }
}

#[test]
fn an_id_the_answer_leaves_out_is_confirmed_by_one_single_request() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(3);
    library_of(&ids);
    let server = MockServer::start();
    let answer = sorted_answer(
        vec![bulk_item("b000"), bulk_item("b002")],
        &["b000".to_string(), "b002".to_string()],
    );
    let bulk = mock_bulk_answering(&server, &ids, answer);
    let confirm = server.mock(|when, then| {
        when.method(GET).path("/activity/b001/intervals");
        then.status(404);
    });
    let others = mock_single_activity_requests(&server);

    sweep(&server).expect("an answered absence is not a failed sweep");

    bulk.assert_calls(1);
    confirm.assert_calls(1);
    others.assert_calls(0);
    assert_eq!(interval_body("b001").as_deref(), Some(NO_INTERVALS_BODY));
    assert!(interval_body("b000").is_some() && interval_body("b002").is_some());
}

#[test]
fn a_left_out_id_the_single_request_answers_is_stored_as_answered() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(2);
    library_of(&ids);
    let server = MockServer::start();
    let answer = sorted_answer(vec![bulk_item("b000")], &["b000".to_string()]);
    mock_bulk_answering(&server, &ids, answer);
    let confirm = server.mock(|when, then| {
        when.method(GET).path("/activity/b001/intervals");
        then.status(200).body(intervals_text("b001"));
    });

    sweep(&server).expect("the sweep");

    confirm.assert_calls(1);
    assert_eq!(interval_body("b001"), Some(intervals_text("b001")));
}

#[test]
fn a_left_out_id_whose_confirmation_fails_stays_owed() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(2);
    library_of(&ids);
    let server = MockServer::start();
    let answer = sorted_answer(vec![bulk_item("b000")], &["b000".to_string()]);
    mock_bulk_answering(&server, &ids, answer);
    server.mock(|when, then| {
        when.method(GET).path("/activity/b001/intervals");
        then.status(500);
    });

    let outcome = sweep(&server);

    assert!(
        outcome.is_err(),
        "an unconfirmed absence is not a finished sweep"
    );
    assert_eq!(interval_body("b001"), None);
    assert!(interval_body("b000").is_some());
}

/// An answer naming an id that was not asked for is not the answer to this
/// request, so nothing it leaves out is taken as absent.
#[test]
fn an_answer_naming_an_id_not_asked_for_confirms_nothing_absent() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(2);
    library_of(&ids);
    let server = MockServer::start();
    let answer = sorted_answer(
        vec![bulk_item("b000"), bulk_item("b999")],
        &["b000".to_string(), "b999".to_string()],
    );
    mock_bulk_answering(&server, &ids, answer);
    let single = mock_single_activity_requests(&server);

    let outcome = sweep(&server);

    assert!(
        outcome.is_err(),
        "a mismatched answer is not a finished sweep"
    );
    single.assert_calls(0);
    assert_eq!(interval_body("b001"), None, "still owed");
    assert_eq!(interval_body("b999"), None, "not a row of this library");
    assert_eq!(interval_body("b000"), Some(intervals_text("b000")));
}

/// The server answers `icu_intervals: null` for an activity it has not split
/// into intervals, and the single endpoint stores that answer. A null in the
/// bulk answer is confirmed by that single request rather than stored as an
/// empty body.
#[test]
fn an_item_with_null_intervals_is_confirmed_and_stored_as_the_single_answer() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(1);
    library_of(&ids);
    let server = MockServer::start();
    let item = r#"{"id":"b000","start_date_local":"2025-03-01T07:30:00","type":"Run","analyzed":"2025-03-01T08:00:00.000+00:00","icu_athlete_id":"i1","icu_intervals":null,"icu_groups":null}"#;
    mock_bulk_answering(&server, &ids, format!("[{item}]"));
    let single_answer = r#"{"id":"b000","analyzed":"2025-03-01T08:00:00.000+00:00","icu_intervals":null,"icu_groups":null}"#;
    let confirm = server.mock(|when, then| {
        when.method(GET).path("/activity/b000/intervals");
        then.status(200).body(single_answer);
    });

    sweep(&server).expect("the sweep");

    confirm.assert_calls(1);
    assert_eq!(interval_body("b000").as_deref(), Some(single_answer));
    assert!(
        activity_body("b000").is_some_and(|b| b.contains("icu_athlete_id")),
        "the detail body still lands from the bulk answer"
    );
}

/// An activity the server lists but cannot share answers a stub with no
/// detail fields and no intervals.
#[test]
fn a_stub_item_stores_no_detail_and_is_confirmed_before_it_is_absent() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(1);
    library_of(&ids);
    let server = MockServer::start();
    let stub = r#"{"id":"b000","start_date_local":"2025-03-01T07:30:00","type":"Run","_note":"not available via the API"}"#;
    mock_bulk_answering(&server, &ids, format!("[{stub}]"));
    let confirm = server.mock(|when, then| {
        when.method(GET).path("/activity/b000/intervals");
        then.status(422);
    });

    sweep(&server).expect("the sweep");

    confirm.assert_calls(1);
    assert_eq!(interval_body("b000").as_deref(), Some(NO_INTERVALS_BODY));
    assert!(
        !activity_body("b000").is_some_and(|b| b.contains("_note")),
        "a stub is not a detail body"
    );
}

#[test]
fn a_timed_out_chunk_of_two_hundred_is_retried_as_two_of_one_hundred() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(200);
    library_of(&ids);
    let server = MockServer::start();
    let whole_path = bulk_path(&ids);
    let whole = server.mock(|when, then| {
        when.method(GET).path(whole_path);
        then.status(200).delay(Duration::from_secs(3)).body("[]");
    });
    let halves: Vec<_> = ids.chunks(100).map(|c| mock_bulk(&server, c)).collect();

    let transport = transport_with_backfill_ceiling(&server, Duration::from_millis(300));
    sweep_with(&transport).expect("the halves land");

    assert!(whole.calls() >= 1, "the whole chunk was asked for first");
    for half in &halves {
        half.assert_calls(1);
    }
    assert!(ids.iter().all(|id| interval_body(id).is_some()));
}

#[test]
fn a_chunk_that_times_out_at_the_floor_fails_the_step_and_stays_owed() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(25);
    library_of(&ids);
    let server = MockServer::start();
    let path = bulk_path(&ids);
    let slow = server.mock(|when, then| {
        when.method(GET).path(path);
        then.status(200).delay(Duration::from_secs(3)).body("[]");
    });
    let others = server.mock(|when, then| {
        when.method(GET);
        then.status(500);
    });

    let transport = transport_with_backfill_ceiling(&server, Duration::from_millis(300));
    let outcome = sweep_with(&transport);

    assert!(
        matches!(outcome, Err(NetError::Transport(_))),
        "{outcome:?}"
    );
    assert!(slow.calls() >= 1);
    others.assert_calls(0);
    assert!(ids.iter().all(|id| interval_body(id).is_none()));
}

#[test]
fn progress_counts_activities_not_requests() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(450);
    library_of(&ids);
    let server = MockServer::start();
    for chunk in ids.chunks(200) {
        mock_bulk(&server, chunk);
    }

    let reports = std::sync::Mutex::new(Vec::new());
    crate::runtime::block_on(sync_interval_bodies(
        crate::persistence::engine_install(),
        &crate::net::IntervalsSession::new(transport_to(&server), ATHLETE),
        &|| false,
        &|done, total| reports.lock().unwrap().push((done, total)),
    ))
    .expect("the sweep");

    assert_eq!(
        *reports.lock().unwrap(),
        vec![(0, 450), (200, 450), (400, 450), (450, 450)]
    );
}

#[test]
fn a_failed_chunk_does_not_cost_the_others_their_bodies() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(250);
    library_of(&ids);
    let server = MockServer::start();
    let first = bulk_path(&ids[..200]);
    server.mock(|when, then| {
        when.method(GET).path(first);
        then.status(500);
    });
    mock_bulk(&server, &ids[200..]);

    let outcome = sweep(&server);

    assert!(outcome.is_err());
    assert!(ids[..200].iter().all(|id| interval_body(id).is_none()));
    assert!(ids[200..].iter().all(|id| interval_body(id).is_some()));
}

#[test]
fn a_refused_credential_ends_the_sweep() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(250);
    library_of(&ids);
    let server = MockServer::start();
    let any = server.mock(|when, then| {
        when.method(GET);
        then.status(401);
    });

    let outcome = sweep(&server);

    assert!(
        matches!(outcome, Err(NetError::Unauthorized)),
        "{outcome:?}"
    );
    any.assert_calls(1);
}

#[test]
fn a_cancelled_sweep_asks_for_nothing() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    library_of(&owed_ids(3));
    let server = MockServer::start();
    let any = server.mock(|when, then| {
        when.method(GET);
        then.status(500);
    });

    crate::runtime::block_on(sync_interval_bodies(
        crate::persistence::engine_install(),
        &crate::net::IntervalsSession::new(transport_to(&server), ATHLETE),
        &|| true,
        &|_, _| {},
    ))
    .expect("a cancel is not a failure");

    any.assert_calls(0);
}

#[test]
fn the_newest_five_cost_one_bulk_request_and_their_stream_requests() {
    let _guard = serial_global_state();
    let _dir = init_engine();
    let ids = owed_ids(7);
    library_of(&ids);
    let server = MockServer::start();
    let bulk = mock_bulk(&server, &ids[..5]);
    let streams = server.mock(|when, then| {
        when.method(GET)
            .path_matches(r"^/activity/b\d+/streams\.json$");
        then.status(200).body("[]");
    });
    let single = mock_single_activity_requests(&server);

    crate::runtime::block_on(ready_newest_activities(
        crate::persistence::engine_install(),
        &crate::net::IntervalsSession::new(transport_to(&server), ATHLETE),
        &|| false,
    ))
    .expect("the step");

    bulk.assert_calls(1);
    streams.assert_calls(5);
    single.assert_calls(0);
    for id in &ids[..5] {
        assert_eq!(interval_body(id), Some(intervals_text(id)), "{id}");
        assert_eq!(activity_body(id), Some(detail_text(id)), "{id}");
    }
    assert!(ids[5..].iter().all(|id| interval_body(id).is_none()));
}

// The single-request path and the bulk path, over the same recorded responses.

const FIXTURE_IDS: [&str; 8] = [
    "i900101", "i900102", "i900103", "i900104", "i900105", "i900106", "i900107", "i900108",
];

/// The stub the server lists but cannot share; it has no single-endpoint files.
const FIXTURE_STUB: &str = "i900108";

fn fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/bulk_activities")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Every single-endpoint answer for the fixtures: detail and intervals as
/// recorded, and the stub refused as the server refuses one.
fn mock_single_endpoints(server: &MockServer) {
    for id in FIXTURE_IDS {
        if id == FIXTURE_STUB {
            server.mock(|when, then| {
                when.method(GET).path_matches(format!("^/activity/{id}"));
                then.status(422);
            });
            continue;
        }
        let detail = fixture(&format!("{id}.detail.json"));
        let intervals = fixture(&format!("{id}.intervals.json"));
        server.mock(|when, then| {
            when.method(GET).path(format!("/activity/{id}"));
            then.status(200).body(detail);
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/activity/{id}/intervals"));
            then.status(200).body(intervals);
        });
    }
}

/// The fixtures newest first in descending id order, so the bulk request asks
/// for them in the opposite order to the one the answer comes back in.
fn fixture_library() -> Vec<String> {
    let ids: Vec<String> = FIXTURE_IDS.iter().rev().map(|s| s.to_string()).collect();
    library_of(&ids);
    ids
}

/// What a reader finds for one activity: both bodies, the metrics derived
/// from the detail body and the detail screen's read.
fn reads(id: &str) -> (Option<String>, Option<String>, String, String) {
    let id = id.to_string();
    with_persistent_engine(move |engine| {
        (
            engine.get_activity_body(&id),
            engine.get_interval_body(&id).expect("read"),
            format!("{:?}", engine.activity_metrics.get(&id)),
            format!("{:?}", engine.activity_detail_data(&id, 2)),
        )
    })
    .expect("engine")
}

#[test]
fn the_bulk_path_stores_what_the_single_requests_store() {
    let _guard = serial_global_state();

    let single_reads = {
        let _dir = init_engine();
        fixture_library();
        let server = MockServer::start();
        mock_single_endpoints(&server);
        let transport = transport_to(&server);
        let install = crate::persistence::engine_install();
        for id in FIXTURE_IDS {
            let _ = crate::runtime::block_on(ready_detail_body(
                install,
                &crate::net::IntervalsSession::new(transport.clone(), "i1"),
                id,
                id,
                Lane::Backfill.into(),
            ));
            crate::runtime::block_on(fetch_one_interval_body(
                install,
                &crate::net::IntervalsSession::new(transport.clone(), "i1"),
                id,
                id,
                Lane::Backfill,
            ))
            .expect("single intervals");
        }
        FIXTURE_IDS.iter().map(|id| reads(id)).collect::<Vec<_>>()
    };

    let bulk_reads = {
        let _dir = init_engine();
        let asked = fixture_library();
        let server = MockServer::start();
        let bulk = mock_bulk_answering(&server, &asked, fixture("bulk.json"));
        mock_single_endpoints(&server);
        sweep(&server).expect("the bulk sweep");
        bulk.assert_calls(1);
        FIXTURE_IDS.iter().map(|id| reads(id)).collect::<Vec<_>>()
    };

    for ((id, single), bulk) in FIXTURE_IDS.iter().zip(&single_reads).zip(&bulk_reads) {
        assert_eq!(single.0, bulk.0, "{id}: detail body");
        assert_eq!(single.1, bulk.1, "{id}: interval body");
        assert_eq!(single.2, bulk.2, "{id}: metrics");
        assert_eq!(single.3, bulk.3, "{id}: detail screen read");
    }
    assert!(
        single_reads.iter().all(|r| r.1.is_some()),
        "every fixture ends with an interval body on both paths"
    );
}
