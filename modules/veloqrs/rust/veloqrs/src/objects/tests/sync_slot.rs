//! Scenario: the launch sync holds the exclusive slot for minutes, and the feed
//! opens an older window while it runs. The window is refused as busy, and
//! that refusal is not a network failure, so no reconnect or foreground ever
//! arrives to ask again.
//!
//! Expected behaviour: the engine keeps the refused window owed and starts it
//! itself once the slot frees, with no second ask from the caller.

use super::*;
use httpmock::prelude::*;
use std::time::{Duration, Instant};

const OLDEST: &str = "2019-03-01";
const NEWEST: &str = "2019-03-31";

/// Wait for `done`, failing the test with `what` if it never holds.
fn eventually(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Let whatever the test started run to its end, so the process-wide slot is
/// free for the next test.
fn settle() {
    eventually("the sync never let go of the slot", || {
        SYNC_SERVICE.snapshot().state != SyncState::Syncing
    });
}

fn listing(server: &MockServer, status: u16) -> httpmock::Mock<'_> {
    server.mock(|when, then| {
        when.method(GET).path("/athlete/1/activities");
        then.status(status).json_body(serde_json::json!([]));
    })
}

#[test]
fn a_window_refused_while_the_slot_is_held_is_fetched_when_it_frees() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("owed-window.db");
    let server = MockServer::start();
    let window = listing(&server, 200);
    let _base = test_base_url(server.base_url());
    let _creds = test_credentials();

    test_hold_sync_slot();
    assert_eq!(
        start_window_sync(OLDEST.into(), NEWEST.into()),
        FfiStartOutcome::Busy
    );
    assert_eq!(window.calls(), 0, "nothing runs while the slot is held");

    SYNC_SERVICE.finish(SyncState::Idle, None, true);

    eventually("the refused window was never fetched", || {
        window.calls() > 0
    });
    settle();
}

/// The windows a test service was asked to start, in order.
type Started = Arc<Mutex<Vec<(String, String)>>>;

/// A service whose owed windows are recorded rather than fetched, and whose
/// record says which were started.
fn recording_service() -> (Arc<SyncService>, Started) {
    let started: Started = Arc::new(Mutex::new(Vec::new()));
    let record = Arc::clone(&started);
    let svc = SyncService::starting_windows_with(move |oldest, newest| {
        record.lock().unwrap().push((oldest, newest));
    });
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    (Arc::new(svc), started)
}

/// A service whose owed-window start takes the slot, as a real window does.
fn claiming_service() -> (Arc<SyncService>, Started) {
    let started: Started = Arc::new(Mutex::new(Vec::new()));
    let record = Arc::clone(&started);
    let svc: Arc<std::sync::OnceLock<Arc<SyncService>>> = Arc::new(std::sync::OnceLock::new());
    let handle = Arc::clone(&svc);
    let built = Arc::new(SyncService::starting_windows_with(move |oldest, newest| {
        record
            .lock()
            .unwrap()
            .push((oldest.clone(), newest.clone()));
        let svc = handle.get().expect("the service is built");
        svc.claim_slot_for(SyncRequest::Window { oldest, newest })
            .expect("the slot is free when an owed window starts");
    }));
    built.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    let _ = svc.set(Arc::clone(&built));
    (built, started)
}

fn window(oldest: &str, newest: &str) -> SyncRequest {
    SyncRequest::Window {
        oldest: oldest.into(),
        newest: newest.into(),
    }
}

fn pair(oldest: &str, newest: &str) -> (String, String) {
    (oldest.to_string(), newest.to_string())
}

#[test]
fn a_window_asked_twice_while_the_slot_is_held_starts_once_when_it_frees() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, started) = recording_service();
    svc.claim_slot().expect("the slot is free");

    for _ in 0..2 {
        assert_eq!(
            svc.try_start_for(window(OLDEST, NEWEST)).err(),
            Some(FfiStartOutcome::Busy)
        );
    }
    assert!(
        started.lock().unwrap().is_empty(),
        "nothing starts while the slot is held"
    );

    svc.finish(SyncState::Idle, None, true);
    assert_eq!(*started.lock().unwrap(), vec![pair(OLDEST, NEWEST)]);

    svc.finish(SyncState::Idle, None, true);
    assert_eq!(
        started.lock().unwrap().len(),
        1,
        "an owed window is started once"
    );
}

#[test]
fn owed_windows_start_one_per_free_slot_in_the_order_they_were_asked() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, started) = claiming_service();
    svc.claim_slot().expect("the slot is free");
    let _ = svc.try_start_for(window("2019-03-01", "2019-03-31"));
    let _ = svc.try_start_for(window("2019-02-01", "2019-02-28"));

    svc.finish(
        SyncState::Idle,
        Some(SyncFailure::new(FfiSyncErrorReason::Network, "timed out")),
        false,
    );
    assert_eq!(
        *started.lock().unwrap(),
        vec![pair("2019-03-01", "2019-03-31")],
        "a failed run frees the slot too, and the first owed window takes it"
    );

    svc.finish(SyncState::Idle, None, true);
    assert_eq!(
        *started.lock().unwrap(),
        vec![
            pair("2019-03-01", "2019-03-31"),
            pair("2019-02-01", "2019-02-28")
        ]
    );
}

#[test]
fn an_owed_window_that_does_not_take_the_slot_passes_to_the_next() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, started) = recording_service();
    svc.claim_slot().expect("the slot is free");
    let _ = svc.try_start_for(window("2019-03-01", "2019-03-31"));
    let _ = svc.try_start_for(window("2019-02-01", "2019-02-28"));

    svc.finish(SyncState::Idle, None, true);

    assert_eq!(
        *started.lock().unwrap(),
        vec![
            pair("2019-03-01", "2019-03-31"),
            pair("2019-02-01", "2019-02-28")
        ],
        "a window that landed meanwhile answers without running, and must not strand the rest"
    );
}

#[test]
fn a_parked_credential_starts_no_owed_window() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, started) = recording_service();
    svc.claim_slot().expect("the slot is free");
    let _ = svc.try_start_for(window(OLDEST, NEWEST));

    svc.park_auth_expired_now();
    svc.finish(SyncState::Idle, None, false);

    assert!(started.lock().unwrap().is_empty());
}

#[test]
fn a_window_owed_to_an_athlete_who_signed_out_is_dropped() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, started) = recording_service();
    svc.claim_slot().expect("the slot is free");
    let _ = svc.try_start_for(window(OLDEST, NEWEST));

    svc.set_credentials(AuthKind::ApiKey, "other".into(), "i2".into());
    svc.finish(SyncState::Idle, None, true);
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    svc.claim_slot().expect("the slot is free");
    svc.finish(SyncState::Idle, None, true);

    assert!(started.lock().unwrap().is_empty());
}

#[test]
fn a_default_sync_refused_busy_is_not_kept_owed() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, started) = recording_service();
    svc.claim_slot().expect("the slot is free");
    assert_eq!(svc.claim_slot().err(), Some(FfiStartOutcome::Busy));

    svc.finish(SyncState::Idle, None, true);

    assert!(started.lock().unwrap().is_empty());
    assert_eq!(svc.snapshot().state, SyncState::Idle);
}

/// What a test service was asked to start, default runs and windows alike.
type Runs = Arc<Mutex<Vec<SyncRequest>>>;

/// A service whose owed runs are recorded rather than started, signed in as
/// `i1`.
fn recording_runs() -> (Arc<SyncService>, Runs) {
    let runs: Runs = Arc::new(Mutex::new(Vec::new()));
    let full = Arc::clone(&runs);
    let windows = Arc::clone(&runs);
    let svc = SyncService::starting_with(
        move |force| full.lock().unwrap().push(SyncRequest::Full { force }),
        move |oldest, newest| {
            windows
                .lock()
                .unwrap()
                .push(SyncRequest::Window { oldest, newest })
        },
    );
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    (Arc::new(svc), runs)
}

fn full() -> SyncRequest {
    SyncRequest::Full { force: false }
}

fn failure(reason: FfiSyncErrorReason) -> Option<SyncFailure> {
    Some(SyncFailure::new(reason, "failed"))
}

/// Scenario: the connection drops while a run is fetching, so the run settles
/// with a network failure and nothing it asked for landed. No later ask comes
/// from the screen that wanted it.
///
/// Expected behaviour: the engine keeps the run owed to the connection and
/// starts it again on the online edge, once, and not before.
#[test]
fn a_run_that_failed_on_the_network_starts_again_on_the_online_edge() {
    let _serial = crate::test_globals::serial_global_state();
    for request in [full(), window(OLDEST, NEWEST)] {
        let (svc, runs) = recording_runs();
        svc.claim_slot_for(request.clone())
            .expect("the slot is free");
        svc.finish(SyncState::Idle, failure(FfiSyncErrorReason::Network), false);
        assert!(
            runs.lock().unwrap().is_empty(),
            "a failed run waits for the connection rather than looping"
        );

        svc.claim_slot().expect("the slot is free");
        svc.finish(SyncState::Idle, None, true);
        assert!(
            runs.lock().unwrap().is_empty(),
            "a freed slot is not what a network failure waits for"
        );

        svc.reconnected();
        assert_eq!(*runs.lock().unwrap(), vec![request.clone()]);

        svc.reconnected();
        assert_eq!(
            runs.lock().unwrap().len(),
            1,
            "an edge starts a failed run once"
        );
    }
}

#[test]
fn a_run_that_settled_cleanly_or_was_cancelled_owes_the_edge_nothing() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, runs) = recording_runs();
    svc.claim_slot_for(window(OLDEST, NEWEST))
        .expect("the slot is free");
    svc.finish(SyncState::Idle, None, true);

    svc.claim_slot().expect("the slot is free");
    svc.request_cancel();
    svc.finish(SyncState::Idle, failure(FfiSyncErrorReason::Network), false);

    svc.reconnected();
    assert!(runs.lock().unwrap().is_empty());
}

/// A full disk, a missing credential or an unreadable file is not cured by
/// the connection coming back, so the edge does not spend a run on it.
#[test]
fn a_failure_no_connection_cures_is_not_started_on_the_edge() {
    let _serial = crate::test_globals::serial_global_state();
    for reason in [
        FfiSyncErrorReason::StorageFull,
        FfiSyncErrorReason::NotConfigured,
        FfiSyncErrorReason::Storage,
    ] {
        let (svc, runs) = recording_runs();
        svc.claim_slot().expect("the slot is free");
        svc.finish(SyncState::Idle, failure(reason), false);
        svc.reconnected();
        assert!(runs.lock().unwrap().is_empty(), "{reason:?} was retried");
    }
}

#[test]
fn a_parked_credential_starts_nothing_on_the_edge() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, runs) = recording_runs();
    svc.claim_slot().expect("the slot is free");
    svc.finish(SyncState::Idle, failure(FfiSyncErrorReason::Network), false);

    svc.park_auth_expired_now();
    svc.reconnected();

    assert!(runs.lock().unwrap().is_empty());
}

#[test]
fn a_failed_run_owed_to_an_athlete_who_signed_out_is_dropped_on_the_edge() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, runs) = recording_runs();
    svc.claim_slot_for(window(OLDEST, NEWEST))
        .expect("the slot is free");
    svc.finish(SyncState::Idle, failure(FfiSyncErrorReason::Network), false);

    svc.set_credentials(AuthKind::ApiKey, "other".into(), "i2".into());
    svc.reconnected();

    assert!(runs.lock().unwrap().is_empty());
}

/// An edge that arrives while another run holds the slot leaves the failed
/// run to that run's finish, as a refused window waits.
#[test]
fn a_failed_run_whose_edge_finds_the_slot_held_starts_when_it_frees() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, runs) = recording_runs();
    svc.claim_slot_for(window(OLDEST, NEWEST))
        .expect("the slot is free");
    svc.finish(SyncState::Idle, failure(FfiSyncErrorReason::Server), false);

    svc.claim_slot().expect("the slot is free");
    svc.reconnected();
    assert!(runs.lock().unwrap().is_empty());

    svc.finish(SyncState::Idle, None, true);
    assert_eq!(*runs.lock().unwrap(), vec![window(OLDEST, NEWEST)]);
}

/// Scenario: a window holds the slot when the default sync is asked for, or
/// the athlete signed out and back in as someone else while the first one's
/// sync was still running. Neither run covers what the refused default sync
/// would have fetched.
///
/// Expected behaviour: the refused default sync is kept owed and starts when
/// the slot frees, with no second ask from the caller.
#[test]
fn a_default_sync_refused_behind_a_window_starts_when_the_slot_frees() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, runs) = recording_runs();
    svc.claim_slot_for(window(OLDEST, NEWEST))
        .expect("the slot is free");
    assert_eq!(svc.claim_slot().err(), Some(FfiStartOutcome::Busy));
    assert_eq!(svc.claim_slot().err(), Some(FfiStartOutcome::Busy));

    svc.finish(SyncState::Idle, None, true);

    assert_eq!(*runs.lock().unwrap(), vec![full()]);
}

#[test]
fn a_default_sync_refused_behind_another_athletes_run_starts_for_the_new_athlete() {
    let _serial = crate::test_globals::serial_global_state();
    let (svc, runs) = recording_runs();
    svc.claim_slot().expect("the slot is free");

    svc.clear_credentials();
    svc.set_credentials(AuthKind::ApiKey, "other".into(), "i2".into());
    assert_eq!(svc.claim_slot().err(), Some(FfiStartOutcome::Busy));

    svc.finish(SyncState::Idle, None, false);

    assert_eq!(*runs.lock().unwrap(), vec![full()]);
}

/// Scenario: the global service, driven through the FFI's connectivity push.
/// A window whose server could not be reached fails, and the athlete's
/// screen asks nothing again.
///
/// Expected behaviour: the offline-to-online push starts the window again and
/// it is fetched.
#[test]
fn the_pushed_online_edge_fetches_a_window_that_failed() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("reconnect-window.db");
    let _creds = test_credentials();
    crate::net::connectivity::reset();

    let unreachable = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a free port");
        let port = listener.local_addr().expect("an address").port();
        drop(listener);
        format!("http://127.0.0.1:{port}")
    };
    let base = test_base_url(unreachable);
    assert_eq!(
        start_window_sync(OLDEST.into(), NEWEST.into()),
        FfiStartOutcome::Started
    );
    settle();
    drop(base);

    let server = MockServer::start();
    let window = listing(&server, 200);
    let _base = test_base_url(server.base_url());

    crate::ffi::set_network_online(false);
    assert_eq!(window.calls(), 0, "nothing is asked while offline");
    crate::ffi::set_network_online(true);

    eventually("the failed window was never fetched again", || {
        window.calls() > 0
    });
    settle();
    crate::net::connectivity::reset();
}
