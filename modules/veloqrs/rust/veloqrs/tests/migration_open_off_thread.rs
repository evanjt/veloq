//! Scenario: the first launch after an update opens a schema 12 library of
//! 5,000 activities, which runs the pre-upgrade copy, the migration chain and
//! the repair hooks.
//! Expected behaviour: the start call returns while the upgrade is still
//! running, and the terminal state reports the migrated schema.

use super::migration_support::user_version;
use super::upgrade_scale::seed_v12_library;
use rusqlite::Connection;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use veloqrs::objects::{FfiInitOutcome, FfiStartOutcome};
use veloqrs::persistence::open_run::FfiOpenPhase;

const ACTIVITIES: usize = 5_000;

fn wait_until_finished() -> veloqrs::persistence::open_run::FfiOpenProgress {
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        let progress = veloqrs::ffi::get_engine_open_progress();
        if progress.phase == FfiOpenPhase::Finished {
            return progress;
        }
        assert!(Instant::now() < deadline, "the open never finished");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn an_upgrading_open_returns_before_the_upgrade_finishes_and_reports_the_new_schema() {
    let _serial_state = super::serial_state();
    veloqrs::persistence::close_for_restore();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let db_path = path.to_str().unwrap().to_string();
    seed_v12_library(&path, ACTIVITIES);

    let started = veloqrs::ffi::start_engine_open(db_path.clone());

    assert_eq!(started, FfiStartOutcome::Started);
    let at_return = veloqrs::ffi::get_engine_open_progress();
    assert_eq!(
        at_return.phase,
        FfiOpenPhase::Running,
        "start returned only after the upgrade had run"
    );
    assert_eq!(at_return.from_schema, Some(12));

    let finished = wait_until_finished();
    assert_eq!(finished.outcome, Some(FfiInitOutcome::Opened));
    assert_eq!(finished.schema_version, Some(finished.to_schema));
    assert_eq!(
        user_version(&Connection::open(&path).unwrap()),
        finished.to_schema
    );
    assert_eq!(
        veloqrs::ffi::start_engine_open(db_path),
        FfiStartOutcome::NotOwed,
        "the migrated file owes nothing"
    );
    veloqrs::persistence::close_for_restore();
}

#[test]
fn a_second_start_while_one_runs_is_refused() {
    let _serial_state = super::serial_state();
    veloqrs::persistence::close_for_restore();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let db_path = path.to_str().unwrap().to_string();
    seed_v12_library(&path, 1_000);

    assert_eq!(
        veloqrs::ffi::start_engine_open(db_path.clone()),
        FfiStartOutcome::Started
    );
    assert_eq!(
        veloqrs::ffi::start_engine_open(db_path),
        FfiStartOutcome::Busy
    );
    wait_until_finished();
    veloqrs::persistence::close_for_restore();
}

#[test]
fn a_fresh_library_and_a_current_one_start_no_thread() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let db_path = path.to_str().unwrap().to_string();
    assert_eq!(
        veloqrs::ffi::start_engine_open(db_path.clone()),
        FfiStartOutcome::NotOwed
    );

    drop(veloqrs::PersistentEngine::new(&db_path).expect("create"));
    assert_eq!(
        veloqrs::ffi::start_engine_open(db_path),
        FfiStartOutcome::NotOwed
    );
    assert_ne!(
        veloqrs::ffi::get_engine_open_progress().phase,
        FfiOpenPhase::Running
    );
}
