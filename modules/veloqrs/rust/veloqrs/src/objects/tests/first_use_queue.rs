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
        &crate::net::intervals::IntervalsSession::new(transport_to(server), "i1"),
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
    for count in 1..=FIRST_USE_ACTIVITIES as usize {
        let ids: Vec<String> = (0..count).map(|index| format!("r{index}")).collect();
        let items: Vec<_> = ids
            .iter()
            .map(|id| {
                json!({"id": id, "icu_athlete_id": "i1",
                       "start_date_local": "2026-09-01T08:30:00",
                       "type": "Ride", "icu_intervals": []})
            })
            .collect();
        server.mock(|when, then| {
            when.method(GET)
                .path(format!("/athlete/i1/activities/{}", ids.join(",")))
                .query_param("intervals", "true");
            then.status(200).json_body(json!(items));
        });
    }
    server.mock(|when, then| {
        when.method(GET)
            .path_matches(r"^/activity/r\d/streams\.json$");
        then.status(200).json_body(json!([]));
    });
    server.mock(|when, then| {
        when.method(GET).path_matches(r"^/activity/r\d/intervals$");
        then.status(200).json_body(json!({"icu_intervals": []}));
    });
    server.mock(|when, then| {
        when.method(GET).path_matches(r"^/activity/r\d$");
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

fn owing(id: &str) -> Option<crate::persistence::BodiesOwed> {
    with_persistent_engine(|engine| {
        engine
            .activity_owing_bodies(id, DETAIL_STREAM_TYPES_KEY)
            .expect("owed read")
    })
    .expect("engine")
}

fn ready_one(server: &MockServer, id: &str) -> Result<bool, NetError> {
    crate::runtime::block_on(ready_owed_activity(
        crate::persistence::engine_install(),
        &crate::net::intervals::IntervalsSession::new(transport_to(server), "i1"),
        id,
    ))
}

/// Scenario: a push stored the detail and the narrow track, and the streams
/// and intervals are still owed. The app's own task readies the one activity.
///
/// Expected behaviour: afterwards the activity owes nothing, so its screen
/// opens with no network, and the answer says so.
#[test]
fn test_ready_owed_activity_leaves_nothing_owed() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(2);
    let server = MockServer::start();
    mock_all_bodies(&server);
    assert!(owing("r0").is_some_and(|gap| gap.streams && gap.intervals));

    assert!(ready_one(&server, "r0").expect("readied"));
    assert!(owing("r0").is_none(), "r0 owes nothing");
    assert!(owing("r1").is_some(), "only the named activity is readied");
}

/// Scenario: the activity already owes nothing, as on a platform whose push
/// readied it, or a second delivery of the same push.
///
/// Expected behaviour: no request is made and the answer is ready.
#[test]
fn test_ready_owed_activity_asks_nothing_when_nothing_is_owed() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(1);
    let server = MockServer::start();
    mock_all_bodies(&server);
    assert!(ready_one(&server, "r0").expect("readied"));

    let quiet = MockServer::start();
    let any = quiet.mock(|when, then| {
        when.any_request();
        then.status(500);
    });
    assert!(ready_one(&quiet, "r0").expect("nothing owed"));
    any.assert_calls(0);
}

/// Scenario: upstream fails every body the activity owes.
///
/// Expected behaviour: the activity still owes them, and the answer is not
/// ready, so the caller records that the next sync has work left.
#[test]
fn test_ready_owed_activity_reports_what_is_still_owed() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(1);
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(500);
    });

    assert!(!ready_one(&server, "r0").unwrap_or(false));
    assert!(owing("r0").is_some_and(|gap| gap.streams && gap.intervals));
}

/// Scenario: the credential is refused while readying.
///
/// Expected behaviour: the refusal is the answer, so the caller can park the
/// session rather than record a body failure.
#[test]
fn test_ready_owed_activity_returns_a_refused_credential() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(1);
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(401);
    });

    assert!(matches!(
        ready_one(&server, "r0"),
        Err(NetError::Unauthorized)
    ));
}

/// Scenario: a library synced before a saved walk was kept once holds the
/// recording's row, which claims the server's id, and a trackless copy keyed
/// by that id beside it. The first-use pass finds the copy owing its track.
///
/// Expected behaviour: the pass ends clean, the copy is gone, and the walk is
/// held once, under the recording's key, with its track.
#[test]
fn test_first_use_pass_settles_a_server_keyed_copy_beside_its_claiming_row() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    let walk = (0..3)
        .map(|i| crate::GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.001,
            longitude: 7.0,
            elevation: None,
        })
        .collect::<Vec<_>>();
    let body = |id: &str| crate::FfiActivityBody {
        activity_id: id.into(),
        date: 1_767_340_800.0,
        raw: format!(
            r#"{{"id":"{id}","icu_athlete_id":"i1","start_date_local":"2026-01-02T08:00:00","type":"Walk"}}"#
        ),
    };
    with_persistent_engine(|engine| {
        engine
            .save_provisional_activity("local-w1", walk, &body("local-w1"))
            .expect("save walk");
        assert!(engine.record_upload("local-w1", "i42").expect("upload"));
        engine
            .db
            .execute(
                "INSERT INTO activity_bodies (activity_id, date, raw, updated_at)
                 VALUES ('i42', 1767340800, ?1, 0)",
                [body("i42").raw],
            )
            .expect("copy body");
        engine
            .set_activity_metrics(vec![ActivityMetrics {
                activity_id: "i42".into(),
                name: "Walk".into(),
                date: 1_767_340_800,
                distance: 700.0,
                moving_time: 500,
                elapsed_time: 500,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Walk".into(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .expect("copy metrics");
    })
    .expect("engine");
    // The claiming row itself still owes its bodies, asked under the server's id.
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/activity/i42/streams.json");
        then.status(200).json_body(json!([
            {"type": "latlng", "data": [46.0, 46.001, 46.002], "data2": [7.0, 7.0, 7.0]}
        ]));
    });
    server.mock(|when, then| {
        when.method(GET).path("/activity/i42/intervals");
        then.status(200).json_body(json!({"icu_intervals": []}));
    });
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities/i42");
        then.status(200)
            .json_body(json!([{"id": "i42", "icu_athlete_id": "i1",
            "start_date_local": "2026-01-02T08:00:00", "type": "Walk", "icu_intervals": []}]));
    });
    server.mock(|when, then| {
        when.method(GET).path("/activity/i42");
        then.status(200)
            .json_body(json!({"id": "i42", "icu_athlete_id": "i1",
            "start_date_local": "2026-01-02T08:00:00", "type": "Walk"}));
    });

    let outcome = run_with_bulk(&server, false);

    let held = with_persistent_engine(|engine| {
        let mut stmt = engine
            .db
            .prepare("SELECT id FROM activities UNION SELECT activity_id FROM activity_bodies ORDER BY 1")
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>()
    })
    .expect("engine");
    assert!(outcome.is_ok(), "{outcome:?}");
    assert_eq!(held, vec!["local-w1".to_string()]);
}

fn sync_failure_of(
    id: &str,
) -> Option<crate::persistence::activity_sync_failures::ActivitySyncFailure> {
    with_persistent_engine(|engine| {
        crate::persistence::activity_sync_failures::of(&engine.db, id).expect("failure read")
    })
    .expect("engine")
}

fn feed_failure_of(
    id: &str,
) -> Option<crate::persistence::activity_sync_failures::ActivitySyncFailure> {
    let query = crate::FfiActivityBodiesQuery {
        oldest_ts: None,
        newest_ts: None,
        needle: String::new(),
        sport_families: Vec::new(),
        offset: 0,
        limit: None,
    };
    let page = with_persistent_engine(|engine| {
        crate::persistence::activities::pooled::feed_card_page(&engine.db, &query).expect("page")
    })
    .expect("engine");
    page.cards
        .into_iter()
        .find(|card| card.id == id)
        .unwrap_or_else(|| panic!("{id} has a card"))
        .sync_failure
}

fn detail_failure_of(
    id: &str,
) -> Option<crate::persistence::activity_sync_failures::ActivitySyncFailure> {
    with_persistent_engine(|engine| engine.activity_detail_data(id, 2).sync_failure)
        .expect("engine")
}

/// Mocks every body for every activity but `r0`, whose streams body does not
/// decode. Registered ahead of the general mocks, which the server consults
/// in order.
fn mock_bodies_with_an_undecodable_streams_body(server: &MockServer) {
    server.mock(|when, then| {
        when.method(GET).path("/activity/r0/streams.json");
        then.status(200)
            .json_body(json!({"not": "a list of streams"}));
    });
    mock_all_bodies(server);
}

/// Scenario: one of the newest activities has a streams body that does not
/// decode, and the others are healthy.
///
/// Expected behaviour: the step completes, the healthy activities are ready,
/// the broken one still owes its streams, and the fault is kept against that
/// activity alone, where the feed card and the detail read both carry it.
#[test]
fn test_a_fault_one_activity_causes_does_not_fail_the_step() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(3);
    let server = MockServer::start();
    mock_bodies_with_an_undecodable_streams_body(&server);

    assert!(run_with_bulk(&server, false).is_ok());

    assert!(owing("r1").is_none() && owing("r2").is_none());
    assert!(owing("r0").is_some_and(|gap| gap.streams));
    let failure = sync_failure_of("r0").expect("r0 is marked");
    assert!(failure.message.contains("r0"), "{}", failure.message);
    assert_eq!(sync_failure_of("r1"), None);
    assert_eq!(sync_failure_of("r2"), None);
    assert_eq!(feed_failure_of("r0"), Some(failure.clone()));
    assert_eq!(feed_failure_of("r1"), None);
    assert_eq!(detail_failure_of("r0"), Some(failure));
    assert_eq!(detail_failure_of("r1"), None);
}

/// Scenario: the marked activity is retried and its body now decodes.
///
/// Expected behaviour: it owes nothing, and its mark is gone from the store,
/// the feed card and the detail read.
#[test]
fn test_a_retry_that_succeeds_clears_the_mark() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(2);
    let broken = MockServer::start();
    mock_bodies_with_an_undecodable_streams_body(&broken);
    assert!(run_with_bulk(&broken, false).is_ok());
    assert!(sync_failure_of("r0").is_some());

    let healthy = MockServer::start();
    mock_all_bodies(&healthy);
    assert!(ready_one(&healthy, "r0").expect("retried"));

    assert!(owing("r0").is_none());
    assert_eq!(sync_failure_of("r0"), None);
    assert_eq!(feed_failure_of("r0"), None);
    assert_eq!(detail_failure_of("r0"), None);
}

/// Scenario: the marked activity is retried and fails the same way again.
///
/// Expected behaviour: the mark stays, as one row with the later time.
#[test]
fn test_a_retry_that_fails_again_keeps_one_mark() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(1);
    let server = MockServer::start();
    mock_bodies_with_an_undecodable_streams_body(&server);
    assert!(run_with_bulk(&server, false).is_ok());
    let first = sync_failure_of("r0").expect("marked");

    assert!(!ready_one(&server, "r0").expect("the retry ends"));

    let again = sync_failure_of("r0").expect("still marked");
    assert!(again.failed_at.0 >= first.failed_at.0);
    let rows: i64 = with_persistent_engine(|engine| {
        engine
            .db
            .query_row("SELECT COUNT(*) FROM activity_sync_failures", [], |r| {
                r.get(0)
            })
            .expect("count")
    })
    .expect("engine");
    assert_eq!(rows, 1);
}

/// Scenario: the server fails every request.
///
/// Expected behaviour: the fault is the network's and not an activity's, so
/// the step fails as before and no activity is marked.
#[test]
fn test_a_server_fault_still_fails_the_step_and_marks_no_activity() {
    let _guard = serial_global_state();
    let _dir = crate::test_globals::init_global_engine("first-use-queue.db");
    library_of(2);
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET);
        then.status(500);
    });

    assert!(run_with_bulk(&server, false).is_err());
    assert_eq!(sync_failure_of("r0"), None);
    assert_eq!(sync_failure_of("r1"), None);
}
