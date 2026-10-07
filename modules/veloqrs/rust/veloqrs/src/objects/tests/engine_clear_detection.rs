use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use rusqlite::Connection;

use super::*;
use crate::persistence::WorkerPoll;
use crate::persistence::persistent_engine_ffi::{SECTION_DETECTION_HANDLE, persistent_engine_init};
use crate::persistence::sections::detection::{ApplyOn, pause_next_group_write};
use crate::test_globals::{seeded_global_engine, serial_global_state};
use crate::with_persistent_engine;

fn assert_catalogue_empty_after_reopen(path: &Path) {
    let conn = Connection::open(path).expect("database");
    let group_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM route_groups", [], |row| row.get(0))
        .expect("stored groups");
    assert_eq!(group_count, 0, "the clear must retain the empty catalogue");
    drop(conn);
    crate::persistence::clear_persistent_engine();
    assert!(persistent_engine_init(path.to_string_lossy().into_owned()));
    with_persistent_engine(|engine| {
        engine.reload_groups_from_db();
        assert!(
            engine.get_groups().is_empty(),
            "reopened engine must stay empty"
        );
    })
    .expect("reopened engine");
}

fn assert_clear_with_held_detection(clear: impl FnOnce(&VeloqEngine, &Path)) {
    let _serial = serial_global_state();
    let dir = seeded_global_engine();
    let path = dir.path().join("detection.db");
    let install = crate::persistence::engine_install();
    let (entered, resume) = pause_next_group_write(&path, install);
    let detection = with_persistent_engine(|engine| {
        engine.detect_sections_background_applying(ApplyOn::Worker)
    })
    .expect("engine");
    *SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(detection);
    let group_count = entered
        .recv_timeout(Duration::from_secs(5))
        .expect("group write reached");
    assert!(group_count > 0, "the worker must hold groups to restore");

    clear(&VeloqEngine, &path);
    let detection = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
        .expect("detection");
    let cancelled = detection.cancel_requested();
    resume.send(()).expect("release group write");
    let (state, _) = detection.recv_state_with_cache_within(Some(Duration::from_secs(5)));
    assert!(
        !matches!(state, WorkerPoll::Running),
        "detection did not finish"
    );

    assert_catalogue_empty_after_reopen(&path);
    assert!(cancelled, "the clear must cancel detection");
}

#[test]
fn test_clear_held_detection_cannot_restore_groups() {
    assert_clear_with_held_detection(|engine, path| {
        crate::runtime::block_on(
            engine.run_clear_all(path.with_extension("tiles").to_string_lossy().into_owned()),
        )
        .unwrap();
    });
}

#[test]
fn test_run_clear_derived_held_detection_cannot_restore_groups() {
    assert_clear_with_held_detection(|engine, _| {
        crate::runtime::block_on(engine.run_clear_derived()).unwrap();
    });
}

#[test]
fn test_run_clear_all_held_detection_cannot_restore_groups() {
    assert_clear_with_held_detection(|engine, path| {
        crate::runtime::block_on(
            engine.run_clear_all(path.with_extension("tiles").to_string_lossy().into_owned()),
        )
        .unwrap();
    });
}

/// Scenario: a detection starts after the clear has retired the running jobs
/// and before its wipe takes the engine lock, so it captures the install the
/// retire left open and a snapshot of the catalogue about to go.
///
/// Expected behaviour: the wipe refuses it all the same, and the catalogue
/// stays empty after the run is released and after a reopen.
fn assert_clear_with_detection_started_after_retire(clear: impl FnOnce(&VeloqEngine, &Path)) {
    let _serial = serial_global_state();
    let dir = seeded_global_engine();
    let path = dir.path().join("detection.db");
    let (started_tx, started_rx) = mpsc::channel();
    let hook_path = path.clone();
    *crate::persistence::AFTER_INVALIDATE
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(Box::new(move || {
        let install = crate::persistence::engine_install();
        let (entered, resume) = pause_next_group_write(&hook_path, install);
        let detection = with_persistent_engine(|engine| {
            engine.detect_sections_background_applying(ApplyOn::Worker)
        })
        .expect("engine");
        let group_count = entered
            .recv_timeout(Duration::from_secs(5))
            .expect("group write reached");
        started_tx
            .send((detection, resume, group_count))
            .expect("test still waiting");
    }));

    clear(&VeloqEngine, &path);
    let (detection, resume, group_count) = started_rx
        .try_recv()
        .expect("the clear must retire its jobs before the wipe");
    assert!(group_count > 0, "the worker must hold groups to restore");
    resume.send(()).expect("release group write");
    let (state, _) = detection.recv_state_with_cache_within(Some(Duration::from_secs(5)));
    assert!(
        !matches!(state, WorkerPoll::Running),
        "detection did not finish"
    );

    assert_catalogue_empty_after_reopen(&path);
}

#[test]
fn test_clear_refuses_detection_started_after_retire() {
    assert_clear_with_detection_started_after_retire(|engine, path| {
        crate::runtime::block_on(
            engine.run_clear_all(path.with_extension("tiles").to_string_lossy().into_owned()),
        )
        .unwrap();
    });
}

#[test]
fn test_run_clear_derived_refuses_detection_started_after_retire() {
    assert_clear_with_detection_started_after_retire(|engine, _| {
        crate::runtime::block_on(engine.run_clear_derived()).unwrap();
    });
}

#[test]
fn test_run_clear_all_refuses_detection_started_after_retire() {
    assert_clear_with_detection_started_after_retire(|engine, path| {
        crate::runtime::block_on(
            engine.run_clear_all(path.with_extension("tiles").to_string_lossy().into_owned()),
        )
        .unwrap();
    });
}

/// Scenario: the held detection is released once the wipe has committed and
/// before the install moves, so its write checks the install inside that gap.
///
/// Expected behaviour: the write waits for the wipe to finish and is refused,
/// because the wipe holds the lifecycle lock `worker_write` checks under.
#[test]
fn test_worker_write_in_the_gap_after_the_wipe_commits_is_refused() {
    let _serial = serial_global_state();
    let dir = seeded_global_engine();
    let path = dir.path().join("detection.db");
    let (started_tx, started_rx) = mpsc::channel();
    let hook_path = path.clone();
    *crate::persistence::AFTER_INVALIDATE
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(Box::new(move || {
        let install = crate::persistence::engine_install();
        let (entered, resume) = pause_next_group_write(&hook_path, install);
        let detection = with_persistent_engine(|engine| {
            engine.detect_sections_background_applying(ApplyOn::Worker)
        })
        .expect("engine");
        entered
            .recv_timeout(Duration::from_secs(5))
            .expect("group write reached");
        started_tx
            .send((detection, resume))
            .expect("test still waiting");
    }));
    let (released_tx, released_rx) = mpsc::channel();
    let probe_path = path.clone();
    *crate::persistence::AFTER_WIPE
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(Box::new(move || {
        let (detection, resume) = started_rx.try_recv().expect("detection started");
        resume.send(()).expect("release group write");
        // A write that is correctly held never lands here, so this waits out
        // the deadline. One that is not lands within it.
        let probe = Connection::open(&probe_path).expect("probe");
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while std::time::Instant::now() < deadline {
            let groups: i64 = probe
                .query_row("SELECT COUNT(*) FROM route_groups", [], |row| row.get(0))
                .unwrap_or(0);
            if groups > 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        released_tx.send(detection).expect("test still waiting");
    }));

    crate::runtime::block_on(VeloqEngine.run_clear_derived()).unwrap();
    let detection = released_rx.try_recv().expect("the wipe must run its hook");
    let (state, _) = detection.recv_state_with_cache_within(Some(Duration::from_secs(5)));
    assert!(
        !matches!(state, WorkerPoll::Running),
        "detection did not finish"
    );

    assert_catalogue_empty_after_reopen(&path);
}

/// Scenario: a sync is running when a clear retires the jobs, and the run
/// settles after the wipe.
///
/// Expected behaviour: a partial clear starts the sync again against the
/// library the wipe left, and a whole-database clear starts none.
fn assert_clear_under_running_sync(clear: impl FnOnce(&VeloqEngine, &Path), expect_restart: bool) {
    use crate::objects::sync::{
        SYNC_SERVICE, SyncState, test_base_url, test_credentials, test_hold_sync_slot,
    };
    use httpmock::prelude::*;

    let _serial = serial_global_state();
    let dir = seeded_global_engine();
    let path = dir.path().join("detection.db");
    let server = MockServer::start();
    let _base = test_base_url(server.base_url());
    let _credentials = test_credentials();
    let asked = server.mock(|when, then| {
        when.method(GET);
        then.status(200).body("[]");
    });

    test_hold_sync_slot();
    clear(&VeloqEngine, &path);
    assert_eq!(asked.hits(), 0, "the cancelled run still holds the slot");
    SYNC_SERVICE.finish(SyncState::Idle, None, false);

    let until =
        std::time::Instant::now() + Duration::from_secs(if expect_restart { 10 } else { 1 });
    while asked.hits() == 0 && std::time::Instant::now() < until {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(asked.hits() > 0, expect_restart);
    let settle = std::time::Instant::now() + Duration::from_secs(10);
    while SYNC_SERVICE.snapshot().state == SyncState::Syncing && std::time::Instant::now() < settle
    {
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn test_run_clear_derived_restarts_a_running_sync() {
    assert_clear_under_running_sync(
        |engine, _| {
            crate::runtime::block_on(engine.run_clear_derived()).unwrap();
        },
        true,
    );
}

#[test]
fn test_run_clear_all_does_not_restart_a_running_sync() {
    assert_clear_under_running_sync(
        |engine, path| {
            crate::runtime::block_on(
                engine.run_clear_all(path.with_extension("tiles").to_string_lossy().into_owned()),
            )
            .unwrap();
        },
        false,
    );
}
