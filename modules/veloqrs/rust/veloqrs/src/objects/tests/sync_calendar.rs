use super::*;

use crate::governor::{Governor, NoopPolicy};
use httpmock::prelude::*;
use serde_json::json;

fn mock_sync_endpoints(server: &MockServer, event_date: &str) {
    for path in [
        "/athlete/i1",
        "/athlete/i1/sport-settings",
        "/athlete/i1/wellness",
        "/athlete/i1/activities",
    ] {
        server.mock(|when, then| {
            when.method(GET).path(path);
            then.status(200).json_body(json!([]));
        });
    }
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/events");
        then.status(200).json_body(json!([{
            "id": "new",
            "start_date_local": format!("{event_date}T07:00:00"),
            "category": "WORKOUT"
        }]));
    });
}

#[test]
fn test_full_sync_replaces_stale_calendar_window() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine_dir = crate::test_globals::init_global_engine("calendar-sync.db");
    let (oldest, newest) = calendar_window();
    let oldest_ts = day_start_timestamp(&oldest).expect("day timestamp");
    let newest_ts = day_start_timestamp(&newest).expect("day timestamp") + 86_399;
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .replace_calendar_events(
                oldest_ts,
                newest_ts,
                &[(
                    "cancelled".into(),
                    oldest_ts,
                    r#"{"id":"cancelled"}"#.into(),
                )],
            )
            .expect("seed calendar");
    })
    .expect("engine");

    let server = MockServer::start();
    mock_sync_endpoints(&server, &oldest);
    let svc = SyncService::new();
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    assert!(svc.try_begin());
    let transport = Transport::with_governor(
        server.base_url(),
        AuthMethod::ApiKey("k"),
        Arc::new(Governor::new(1000, Box::new(NoopPolicy))),
    )
    .expect("transport");
    crate::runtime::block_on(perform_sync(
        &svc,
        crate::persistence::engine_install(),
        transport,
        "i1".into(),
    ));

    crate::persistence::with_persistent_engine(|engine| {
        let rows = engine
            .get_calendar_event_bodies(oldest_ts, newest_ts)
            .expect("read calendar");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].contains("\"id\":\"new\""));
    })
    .expect("engine");
}
