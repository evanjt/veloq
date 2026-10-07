use super::*;
use httpmock::prelude::*;

/// Owe `ids` to the global library, as a restore whose pins name them does.
fn owe(ids: &[&str]) {
    let entries: Vec<_> = ids
        .iter()
        .map(|id| {
            serde_json::json!({"table": "section_pins",
                "values": {"section_id": format!("pin-{id}"), "version": 1},
                "ground": {"rep_activity_id": id, "rep_start_index": 0,
                    "rep_end_index": 2, "point_count": 2, "polyline_json": null}})
        })
        .collect();
    let payload = serde_json::json!({"version": 1, "entries": entries});
    crate::persistence::with_persistent_engine(|engine| {
        engine.restore_record_json(&payload.to_string()).unwrap();
    })
    .expect("engine");
}

fn owed() -> Vec<String> {
    crate::persistence::with_persistent_engine(|engine| engine.owed_record_activities().unwrap())
        .expect("engine")
}

/// Scenario: a backup whose records need old activities is restored on a
/// regenerated key, so every activity fetch answers 401.
///
/// Expected behaviour: the first 401 ends the walk and is reported as a
/// refusal rather than as activities upstream no longer has, so every id stays
/// owed. Inside a sync, a profile that confirms it parks the service and one
/// that does not leaves it standing.
#[test]
fn a_401_ends_the_record_dependency_fetch_and_parks_only_when_confirmed() {
    let _serial = crate::test_globals::serial_global_state();
    for (status, expected) in [(401, SyncState::AuthExpired), (200, SyncState::Idle)] {
        let _engine = crate::test_globals::init_global_engine("record-dependencies.db");
        owe(&["old-1", "old-2", "old-3"]);
        let server = MockServer::start();
        let _base = test_base_url(server.base_url());
        set_credentials_from_native("api_key", "key", "1").expect("credential");
        let asked: Vec<_> = ["old-1", "old-2", "old-3"]
            .iter()
            .map(|id| {
                server.mock(|when, then| {
                    when.method(GET).path(format!("/activity/{id}"));
                    then.status(401);
                })
            })
            .collect();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/1");
            then.status(status)
                .json_body(serde_json::json!({"id": "1"}));
        });
        let (transport, athlete_id) = current_session().expect("credential").expect("transport");

        let outcome = crate::runtime::block_on(fetch_owed_record_activities(
            crate::persistence::engine_install(),
            &transport,
            &athlete_id,
            &|| false,
            &|_, _| {},
        ));

        assert!(
            matches!(outcome, Err(NetError::Unauthorized)),
            "a refused credential reported {outcome:?} (profile {status})"
        );
        let hits: usize = asked.iter().map(httpmock::Mock::hits).sum();
        assert_eq!(
            hits, 1,
            "asked {hits} activities after a 401 (profile {status})"
        );
        assert_eq!(owed(), ["old-1", "old-2", "old-3"], "profile {status}");

        // The step hands the 401 to the sync, whose loop confirms and parks.
        if crate::runtime::block_on(credential_is_rejected(&transport, &athlete_id)) {
            SYNC_SERVICE.park_auth_expired_now();
        }
        assert_eq!(SYNC_SERVICE.snapshot().state, expected, "profile {status}");
        clear_test_credentials();
    }
    crate::objects::observer::flush();
}

fn wait_for_a_hit(mock: &httpmock::Mock<'_>) {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while mock.hits() == 0 {
        assert!(
            std::time::Instant::now() < until,
            "no request reached the fake transport"
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

/// Scenario: the athlete signs out while a sync is fetching the old
/// activities a restored record needs.
///
/// Expected behaviour: the activity in flight is not stored, nothing further
/// is asked for, and what was not fetched stays owed.
#[test]
fn a_sign_out_ends_the_record_dependency_fetch() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("record-dependencies-out.db");
    owe(&["old-1", "old-2", "old-3"]);
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    set_credentials_from_native("api_key", "key", "1").expect("credential");
    let first = server.mock(|when, then| {
        when.method(GET).path("/activity/old-1");
        then.status(200)
            .delay(std::time::Duration::from_millis(300))
            .json_body(serde_json::json!({
                "id": "old-1", "type": "Ride", "name": "Old ride",
                "start_date_local": "2024-01-01T10:00:00", "distance": 1000.0
            }));
    });
    server.mock(|when, then| {
        when.method(GET).path("/activity/old-1/streams.json");
        then.status(200).json_body(serde_json::json!([
            {"type": "latlng", "data": [46.1, 46.2], "data2": [7.1, 7.2]}
        ]));
    });
    let later: Vec<_> = ["old-2", "old-3"]
        .iter()
        .map(|id| {
            server.mock(|when, then| {
                when.method(GET).path(format!("/activity/{id}"));
                then.status(404);
            })
        })
        .collect();
    let (transport, athlete_id) = current_session().expect("credential").expect("transport");

    let walk = std::thread::spawn(move || {
        crate::runtime::block_on(fetch_owed_record_activities(
            crate::persistence::engine_install(),
            &transport,
            &athlete_id,
            &|| false,
            &|_, _| {},
        ))
    });
    wait_for_a_hit(&first);
    clear_test_credentials();
    let outcome = walk.join().expect("the walk");

    assert!(outcome.is_ok(), "a sign-out is not a failure: {outcome:?}");
    let asked: usize = later.iter().map(httpmock::Mock::hits).sum();
    assert_eq!(asked, 0, "asked {asked} activities after the sign-out");
    let stored = crate::persistence::with_persistent_engine(|engine| engine.has_activity("old-1"))
        .expect("engine");
    assert!(
        !stored,
        "the activity in flight was stored after the sign-out"
    );
    assert_eq!(owed(), ["old-1", "old-2", "old-3"]);
    crate::objects::observer::flush();
}
