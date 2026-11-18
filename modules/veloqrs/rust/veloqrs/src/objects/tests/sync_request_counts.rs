//! Scenario: a first sync on an empty library, against an athlete with one
//! activity in the window, a profile that carries no sport settings and no
//! stored wellness.
//!
//! Expected behaviour: every endpoint the run reaches is asked exactly as
//! often as below, and the run ends idle with every step done and no error.
//! The counts are the run as it stands, so a change to how the sync reaches
//! its source that moves any of them shows here.

use super::*;
use crate::governor::{Governor, NoopPolicy};
use httpmock::prelude::*;
use serde_json::json;

fn transport_to(base: String) -> Transport {
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).expect("transport")
}

/// The day the fixture's one activity starts on, three days back.
pub(super) fn ride_day() -> String {
    (chrono::Local::now().date_naive() - chrono::Duration::days(3)).to_string()
}

pub(super) fn profile_body() -> serde_json::Value {
    json!({"id": "i1", "name": "Ada"})
}

pub(super) fn census_body() -> serde_json::Value {
    json!([{
        "id": "a1",
        "start_date_local": format!("{}T08:00:00", ride_day()),
        "created": format!("{}T09:00:00Z", ride_day()),
        "icu_sync_date": format!("{}T09:00:00Z", ride_day()),
        "stream_types": ["time", "latlng"],
    }])
}

pub(super) fn activities_body() -> serde_json::Value {
    json!([{
        "id": "a1",
        "name": "Hill loop",
        "type": "Ride",
        "start_date_local": format!("{}T08:00:00", ride_day()),
        "distance": 21000.0,
        "moving_time": 3600,
        "elapsed_time": 3700,
    }])
}

pub(super) fn detail_body() -> serde_json::Value {
    json!({
        "id": "a1",
        "icu_athlete_id": "i1",
        "name": "Hill loop",
        "type": "Ride",
        "start_date_local": format!("{}T08:00:00", ride_day()),
    })
}

pub(super) fn intervals_body() -> serde_json::Value {
    json!({"id": "a1", "icu_intervals": [], "icu_groups": []})
}

pub(super) fn curve_body() -> serde_json::Value {
    json!({"list": [], "activities": {}})
}

struct Hits {
    server: MockServer,
    ids: Vec<(&'static str, usize)>,
}

impl Hits {
    fn of(&self, name: &str) -> usize {
        let id = self
            .ids
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, id)| *id)
            .expect("a mock by that name");
        httpmock::Mock::new(id, &self.server).calls()
    }
}

fn upstream() -> Hits {
    let server = MockServer::start();
    let mut ids = Vec::new();
    let mut mock = |name: &'static str, path: String, census: bool, body: serde_json::Value| {
        let id = server
            .mock(|when, then| {
                let when = when.method(GET).path(path);
                if census {
                    when.query_param("oldest", "2000-01-01");
                }
                then.status(200).json_body(body);
            })
            .id;
        ids.push((name, id));
    };
    mock("profile", "/athlete/i1".into(), false, profile_body());
    mock(
        "sport settings",
        "/athlete/i1/sport-settings".into(),
        false,
        json!([]),
    );
    mock(
        "fitness model events",
        "/athlete/i1/fitness-model-events".into(),
        false,
        json!([]),
    );
    mock("wellness", "/athlete/i1/wellness".into(), false, json!([]));
    // Before the plain list, so it is the mock a census request meets first.
    mock(
        "census",
        "/athlete/i1/activities".into(),
        true,
        census_body(),
    );
    mock(
        "activities",
        "/athlete/i1/activities".into(),
        false,
        activities_body(),
    );
    // The bulk answer leaves the activity out, so each body is asked alone.
    mock("bulk", "/athlete/i1/activities/a1".into(), false, json!([]));
    mock("detail", "/activity/a1".into(), false, detail_body());
    mock(
        "streams",
        "/activity/a1/streams.json".into(),
        false,
        json!([]),
    );
    mock(
        "intervals",
        "/activity/a1/intervals".into(),
        false,
        intervals_body(),
    );
    mock("calendar", "/athlete/i1/events".into(), false, json!([]));
    mock(
        "power curves",
        "/athlete/i1/power-curves.json".into(),
        false,
        curve_body(),
    );
    mock(
        "pace curves",
        "/athlete/i1/pace-curves.json".into(),
        false,
        curve_body(),
    );
    Hits { server, ids }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_first_sync_asks_each_endpoint_as_often_as_it_always_has() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_request_counts.db");
    let upstream = upstream();
    let svc = SyncService::new();
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    assert!(svc.try_begin());

    crate::runtime::block_on(perform_sync(
        &svc,
        crate::persistence::engine_install(),
        transport_to(upstream.server.base_url()),
        "i1".into(),
        false,
    ));

    let counts: Vec<(&str, usize)> = upstream
        .ids
        .iter()
        .map(|(name, _)| (*name, upstream.of(name)))
        .collect();
    assert_eq!(
        counts,
        vec![
            ("profile", 1),
            ("sport settings", 1),
            ("fitness model events", 1),
            ("wellness", 1),
            ("census", 1),
            ("activities", 1),
            ("bulk", 1),
            ("detail", 1),
            ("streams", 1),
            ("intervals", 1),
            ("calendar", 1),
            ("power curves", 1),
            ("pace curves", 0),
        ]
    );
    let s = svc.snapshot();
    assert_eq!(s.state, SyncState::Idle);
    assert_eq!(s.completed, SYNC_STEPS);
    assert_eq!(s.last_error, None);
}

const FILE_RIDES: i64 = 20;
const FILE_RECORDS: u32 = 30;

/// The wall-clock start of ride `n`, ten minutes after ride `n - 1`.
fn file_ride_start(n: i64) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(&format!("{}T08:00:00", ride_day()), "%Y-%m-%dT%H:%M:%S")
        .expect("a start")
        + chrono::Duration::minutes(10 * n)
}

fn file_ride_id(n: i64) -> String {
    format!("f{n}")
}

/// A file of ride `n` with `FILE_RECORDS` samples, its zone two hours ahead.
fn file_of_ride(n: i64) -> Vec<u8> {
    let mut ride = crate::fit_synthetic::outdoor_ride();
    ride.start_unix = file_ride_start(n).and_utc().timestamp() - ride.utc_offset_secs;
    assert_eq!(ride.samples.len(), FILE_RECORDS as usize);
    ride.to_fit()
}

/// A first sync of rides each already holding the track of an imported file
/// whose record count is the server's, answered per request path.
fn upstream_of_file_rides(records_of: impl Fn(i64) -> u32) -> (MockServer, Vec<usize>) {
    let server = MockServer::start();
    let start = |n| file_ride_start(n).format("%Y-%m-%dT%H:%M:%S").to_string();
    let census: Vec<_> = (0..FILE_RIDES)
        .map(|n| {
            json!({
                "id": file_ride_id(n),
                "start_date_local": start(n),
                "created": format!("{}T09:00:00Z", ride_day()),
                "icu_sync_date": format!("{}T09:00:00Z", ride_day()),
                "stream_types": ["time", "latlng"],
            })
        })
        .collect();
    let listed: Vec<_> = (0..FILE_RIDES)
        .map(|n| {
            json!({
                "id": file_ride_id(n), "name": "Loop", "type": "Ride",
                "start_date_local": start(n), "distance": 21000.0,
                "moving_time": 3600, "elapsed_time": 3700,
            })
        })
        .collect();
    let mut stream_mocks = Vec::new();
    let mut answer = |path: &str, census_only: bool, body: serde_json::Value| {
        let id = server
            .mock(|when, then| {
                let when = when.method(GET).path(path);
                if census_only {
                    when.query_param("oldest", "2000-01-01");
                }
                then.status(200).json_body(body);
            })
            .id;
        if path.ends_with("/streams.json") {
            stream_mocks.push(id);
        }
    };
    answer("/athlete/i1", false, profile_body());
    answer("/athlete/i1/sport-settings", false, json!([]));
    answer("/athlete/i1/fitness-model-events", false, json!([]));
    answer("/athlete/i1/wellness", false, json!([]));
    answer("/athlete/i1/activities", true, json!(census));
    answer("/athlete/i1/activities", false, json!(listed));
    answer("/athlete/i1/events", false, json!([]));
    answer("/athlete/i1/power-curves.json", false, curve_body());
    answer("/athlete/i1/pace-curves.json", false, curve_body());
    // The bulk answer leaves every ride out, so each body is asked alone.
    server.mock(|when, then| {
        when.method(GET).path_includes("/athlete/i1/activities/");
        then.status(200).json_body(json!([]));
    });
    for n in 0..FILE_RIDES {
        let id = file_ride_id(n);
        answer(
            &format!("/activity/{id}"),
            false,
            json!({
                "id": id, "icu_athlete_id": "i1", "name": "Loop", "type": "Ride",
                "start_date_local": start(n),
            }),
        );
        answer(
            &format!("/activity/{id}/intervals"),
            false,
            json!({
                "id": id, "icu_groups": [],
                "icu_intervals": [{
                    "id": 1, "type": "WORK", "start_index": 0,
                    "end_index": records_of(n),
                }],
            }),
        );
        answer(
            &format!("/activity/{id}/streams.json"),
            false,
            json!([{"type": "latlng", "data": [46.0, 46.1], "data2": [7.0, 7.1]},
                   {"type": "time", "data": [0, 1]}]),
        );
    }
    (server, stream_mocks)
}

/// Put the rides in the library as an earlier, cut-short sync left them, then
/// hand over the files of each.
fn rides_holding_file_tracks() {
    crate::with_persistent_engine(|e| {
        for n in 0..FILE_RIDES {
            let id = file_ride_id(n);
            let local = file_ride_start(n).and_utc().timestamp();
            e.store_synced_activity_bodies(
                "i1",
                &[(
                    id.clone(),
                    local,
                    format!("{{\"id\":\"{id}\",\"type\":\"Ride\"}}"),
                )],
                std::slice::from_ref(&id),
                vec![crate::ActivityMetrics {
                    activity_id: id.clone(),
                    date: local,
                    sport_type: "Ride".to_string(),
                    ..Default::default()
                }],
            )
            .unwrap();
        }
    })
    .expect("engine");
    let dir = tempfile::TempDir::new().unwrap();
    for n in 0..FILE_RIDES {
        std::fs::write(dir.path().join(format!("ride-{n:02}.fit")), file_of_ride(n)).unwrap();
    }
    let progress = crate::net::import::import_with(
        crate::persistence::engine_install(),
        dir.path(),
        &std::sync::atomic::AtomicBool::new(false),
        |_| {},
    )
    .expect("the walk finished");
    assert_eq!(
        progress.already_stored,
        u32::try_from(FILE_RIDES).unwrap(),
        "{progress:#?}"
    );
}

fn run_first_sync(server: &MockServer) {
    let svc = SyncService::new();
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    assert!(svc.try_begin());
    crate::runtime::block_on(perform_sync(
        &svc,
        crate::persistence::engine_install(),
        transport_to(server.base_url()),
        "i1".into(),
        false,
    ));
}

fn requests_to(server: &MockServer, mocks: &[usize]) -> usize {
    mocks
        .iter()
        .map(|id| httpmock::Mock::new(*id, server).calls())
        .sum()
}

/// Scenario: twenty rides each hold the track of an imported file, then the
/// first sync runs, and the server's interval bodies end at the file's record
/// count.
///
/// Expected behaviour: the sync asks for no streams, since every ride's track
/// is already the file's.
#[test]
fn a_first_sync_of_rides_with_matching_file_tracks_asks_for_no_streams() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_file_tracks_matching.db");
    let (server, streams) = upstream_of_file_rides(|_| FILE_RECORDS);
    rides_holding_file_tracks();

    run_first_sync(&server);

    assert_eq!(requests_to(&server, &streams), 0);
    assert_eq!(owed_tracks(), Vec::<String>::new());
}

/// Scenario: the same twenty rides, but the server's intervals of one end a
/// record past its file, a ride among the five newest, whose bodies the first-use step
/// fetches.
///
/// Expected behaviour: the sync asks for the streams of that ride once and of no other,
/// and no track is owed afterwards.
#[test]
fn a_first_sync_asks_for_the_streams_only_of_a_ride_whose_file_does_not_match() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_file_tracks_one_off.db");
    let (server, streams) =
        upstream_of_file_rides(|n| FILE_RECORDS + u32::from(n == FILE_RIDES - 1));
    rides_holding_file_tracks();

    run_first_sync(&server);

    assert_eq!(requests_to(&server, &streams), 1);
    assert_eq!(owed_tracks(), Vec::<String>::new());
}

/// The rides the library still owes a track, which the front end's track run
/// goes on to download.
fn owed_tracks() -> Vec<String> {
    let mut ids: Vec<String> =
        crate::with_persistent_engine(|e| e.gps_fetch_candidates("i1", "2000-01-01", "2100-01-01"))
            .expect("engine")
            .into_iter()
            .map(|c| c.activity_id)
            .collect();
    ids.sort();
    ids
}
