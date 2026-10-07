//! Scenario: the background jobs each finish a run and say how it went, and
//! the app is closed and opened again before anyone looks.
//!
//! Expected behaviour: the screen read returns each job's last run with its
//! time, outcome and counts after the reopen, a second run of a job replaces
//! its first rather than adding a row, and a write that cannot land is logged
//! and leaves the caller running.

use super::{BackgroundJob, JobRun, RunOutcome, job_runs, record_job_run};
use crate::persistence::PersistentEngine;
use crate::persistence::screens::background_jobs_data;
use crate::{FfiBackgroundJobsData, FfiJobRun};

fn detection_run(finished_at: i64, handled: u32, added: u32, changed: u32) -> JobRun {
    JobRun {
        job: BackgroundJob::Detection,
        finished_at,
        outcome: RunOutcome::Complete,
        handled,
        added,
        changed,
        retired: 0,
        failed: 0,
    }
}

fn elevation_run() -> JobRun {
    JobRun {
        job: BackgroundJob::ElevationBackfill,
        finished_at: 1_791_000_500_000,
        outcome: RunOutcome::Partial,
        handled: 12,
        added: 0,
        changed: 9,
        retired: 2,
        failed: 1,
    }
}

fn read(engine: &PersistentEngine) -> FfiBackgroundJobsData {
    background_jobs_data(&engine.db).expect("the screen read answers")
}

fn run_of<'a>(data: &'a FfiBackgroundJobsData, job: &str) -> Option<&'a FfiJobRun> {
    data.runs.iter().find(|run| run.job == job)
}

#[test]
fn recorded_runs_survive_a_reopen_and_a_second_run_replaces_the_first() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("jobs.db");
    let path = path.to_str().unwrap();

    {
        let engine = PersistentEngine::new(path).unwrap();
        record_job_run(&engine.db, &detection_run(1_791_000_000_000, 77, 3, 1));
        record_job_run(&engine.db, &elevation_run());
    }

    let engine = PersistentEngine::new(path).unwrap();
    let data = read(&engine);
    assert_eq!(data.runs.len(), 2, "one row per job that has run");

    let detection = run_of(&data, "detection").expect("the detection run");
    assert_eq!(detection.finished_at, 1_791_000_000_000.0);
    assert_eq!(detection.outcome, "complete");
    assert_eq!(
        (
            detection.handled,
            detection.added,
            detection.changed,
            detection.retired,
            detection.failed
        ),
        (77, 3, 1, 0, 0)
    );

    let elevation = run_of(&data, "elevationBackfill").expect("the elevation run");
    assert_eq!(elevation.finished_at, 1_791_000_500_000.0);
    assert_eq!(elevation.outcome, "partial");
    assert_eq!(
        (
            elevation.handled,
            elevation.added,
            elevation.changed,
            elevation.retired,
            elevation.failed
        ),
        (12, 0, 9, 2, 1)
    );

    record_job_run(&engine.db, &detection_run(1_791_000_900_000, 5, 0, 0));
    let data = read(&engine);
    assert_eq!(data.runs.len(), 2, "a second run replaces, it does not add");
    let detection = run_of(&data, "detection").unwrap();
    assert_eq!(detection.finished_at, 1_791_000_900_000.0);
    assert_eq!(
        (detection.handled, detection.added, detection.changed),
        (5, 0, 0)
    );
    assert!(run_of(&data, "elevationBackfill").is_some());
}

#[test]
fn a_fresh_library_has_no_runs_and_nothing_owed() {
    let engine = PersistentEngine::in_memory().unwrap();
    let data = read(&engine);
    assert!(data.runs.is_empty());
    assert_eq!(data.detection_awaiting, Some(0));
    assert!(!data.cutover_owed);
}

#[test]
fn the_read_carries_the_activities_detection_has_not_seen() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .add_activities_batch(vec![
            (
                "ride-a".to_string(),
                vec![
                    crate::GpsPoint::new(46.0, 7.0),
                    crate::GpsPoint::new(46.001, 7.0),
                ],
                "Ride".to_string(),
            ),
            (
                "ride-b".to_string(),
                vec![
                    crate::GpsPoint::new(46.0, 7.1),
                    crate::GpsPoint::new(46.001, 7.1),
                ],
                "Ride".to_string(),
            ),
        ])
        .unwrap();
    assert_eq!(read(&engine).detection_awaiting, Some(2));

    engine
        .save_processed_activity_ids(&["ride-a".to_string()])
        .unwrap();
    assert_eq!(read(&engine).detection_awaiting, Some(1));
}

#[test]
fn every_job_and_outcome_round_trips_through_its_token() {
    let engine = PersistentEngine::in_memory().unwrap();
    let jobs = [
        (BackgroundJob::Detection, "detection"),
        (BackgroundJob::ElevationBackfill, "elevationBackfill"),
        (BackgroundJob::StreamBackfill, "streamBackfill"),
        (BackgroundJob::Cutover, "cutover"),
    ];
    let outcomes = [
        (RunOutcome::Complete, "complete"),
        (RunOutcome::Partial, "partial"),
        (RunOutcome::Failed, "failed"),
        (RunOutcome::Paused, "paused"),
    ];
    for ((job, _), (outcome, _)) in jobs.iter().zip(outcomes.iter()) {
        record_job_run(
            &engine.db,
            &JobRun {
                job: *job,
                finished_at: 1,
                outcome: *outcome,
                handled: 0,
                added: 0,
                changed: 0,
                retired: 0,
                failed: 0,
            },
        );
    }
    let stored = job_runs(&engine.db).unwrap();
    assert_eq!(
        stored.len(),
        4,
        "the table never holds more than one row per job"
    );
    let data = read(&engine);
    for ((_, job), (_, outcome)) in jobs.iter().zip(outcomes.iter()) {
        assert_eq!(run_of(&data, job).unwrap().outcome, *outcome);
    }

    record_job_run(
        &engine.db,
        &JobRun {
            outcome: RunOutcome::Stopped,
            ..detection_run(2, 0, 0, 0)
        },
    );
    assert_eq!(
        run_of(&read(&engine), "detection").unwrap().outcome,
        "stopped"
    );
}

#[test]
fn a_write_that_cannot_land_leaves_the_job_running() {
    // A connection with no schema at all: the insert fails on the missing
    // table, and the caller is a job that must carry on regardless.
    let bare = rusqlite::Connection::open_in_memory().unwrap();
    record_job_run(&bare, &elevation_run());
    assert!(job_runs(&bare).is_err());
}

#[test]
fn a_sign_out_takes_the_last_runs_with_the_library() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    record_job_run(&engine.db, &elevation_run());
    assert_eq!(job_runs(&engine.db).unwrap().len(), 1);

    engine.clear().unwrap();
    assert!(
        job_runs(&engine.db).unwrap().is_empty(),
        "the next athlete to sign in does not inherit the last runs of a library that is gone"
    );
}
