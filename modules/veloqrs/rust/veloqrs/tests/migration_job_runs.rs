//! Scenario: a library from before the jobs kept their last run is opened by
//! this build, once from the schema a released build shipped and once from the
//! one just before the table arrived.
//!
//! Expected behaviour: the upgrade leaves an empty table behind, so the read
//! answers no runs rather than an error, and a run recorded after it reads back.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::job_runs::{BackgroundJob, JobRun, RunOutcome, job_runs, record_job_run};

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(seed_at_version(&path, version));
    assert!(!tables_at(&Connection::open(&path).unwrap()).contains(&"job_runs".to_string()));

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert!(
        job_runs(&conn)
            .expect("the upgraded file answers")
            .is_empty(),
        "an upgrade from v{version} reads no runs"
    );

    record_job_run(
        &conn,
        &JobRun {
            job: BackgroundJob::Cutover,
            finished_at: 1_791_000_000_000,
            outcome: RunOutcome::Stopped,
            handled: 4,
            added: 0,
            changed: 0,
            retired: 0,
            failed: 0,
        },
    );
    let runs = job_runs(&conn).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(
        (runs[0].job.as_str(), runs[0].outcome.as_str()),
        ("cutover", "stopped")
    );
}

#[test]
fn an_upgrade_from_the_released_schema_reads_no_runs() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_table_reads_no_runs() {
    upgrade_from(61);
}
