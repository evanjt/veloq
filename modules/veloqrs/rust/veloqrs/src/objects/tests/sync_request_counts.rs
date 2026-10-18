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
