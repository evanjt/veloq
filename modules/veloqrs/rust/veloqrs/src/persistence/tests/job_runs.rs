//! Scenario: the background jobs each finish a run and say how it went, and
//! the app is closed and opened again before anyone looks.
//!
//! Expected behaviour: the screen read returns each job's last run with its
//! time, outcome and counts after the reopen, a second run of a job replaces
//! its first rather than adding a row, and a write that cannot land is logged
//! and leaves the caller running.

use super::{BackgroundJob, JobRun, RunOutcome, job_runs, record_job_run};
use crate::FfiBackgroundJobsData;
use crate::persistence::PersistentEngine;
use crate::persistence::screens::background_jobs_data;

fn detection_run(finished_at: i64, handled: u32, added: u32, changed: u32) -> JobRun {
    JobRun {
        job: BackgroundJob::Detection,
        finished_at: crate::WholeNumber(finished_at),
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
        finished_at: crate::WholeNumber(1_791_000_500_000),
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

/// The run the app finds under `job`, the token it names the job by.
fn run_of<'a>(data: &'a FfiBackgroundJobsData, job: &str) -> Option<&'a JobRun> {
    data.runs.iter().find(|run| run.job.token() == job)
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
    assert_eq!(detection.finished_at, crate::WholeNumber(1_791_000_000_000));
    assert_eq!(
        detection.outcome,
        crate::persistence::job_runs::RunOutcome::Complete
    );
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
    assert_eq!(elevation.finished_at, crate::WholeNumber(1_791_000_500_000));
    assert_eq!(
        elevation.outcome,
        crate::persistence::job_runs::RunOutcome::Partial
    );
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
    assert_eq!(detection.finished_at, crate::WholeNumber(1_791_000_900_000));
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
                finished_at: crate::WholeNumber(1),
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
        assert_eq!(run_of(&data, job).unwrap().outcome.token(), *outcome);
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
        RunOutcome::Stopped
    );
}

/// Scenario: a newer build recorded a run under a job or an outcome this build
/// has no name for, and the athlete went back to this build.
///
/// Expected behaviour: the read leaves that row out and still answers with
/// every run it can name, rather than failing the whole screen.
#[test]
fn a_run_this_build_cannot_name_is_left_out_of_the_read() {
    let engine = PersistentEngine::in_memory().unwrap();
    record_job_run(&engine.db, &elevation_run());
    for (job, outcome) in [("detection", "abandoned"), ("rebalance", "complete")] {
        engine
            .db
            .execute(
                "INSERT OR REPLACE INTO job_runs
                     (job, finished_at, outcome, handled, added, changed, retired, failed)
                 VALUES (?, 1, ?, 0, 0, 0, 0, 0)",
                rusqlite::params![job, outcome],
            )
            .unwrap();
    }

    let runs = job_runs(&engine.db).expect("the read answers");

    assert_eq!(runs, vec![elevation_run()]);
}

#[test]
fn every_token_names_its_own_job_and_outcome() {
    for job in BackgroundJob::ALL {
        assert_eq!(BackgroundJob::from_token(job.token()), Some(job));
    }
    for outcome in RunOutcome::ALL {
        assert_eq!(RunOutcome::from_token(outcome.token()), Some(outcome));
    }
    assert_eq!(BackgroundJob::from_token("Detection"), None);
    assert_eq!(RunOutcome::from_token(""), None);
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

/// Stores `count` activities that each owe a stream series: a track and the
/// metrics the queue prices them by, dated inside the retention window.
fn owe_streams(engine: &PersistentEngine, count: u32) {
    engine.db.execute_batch("BEGIN").unwrap();
    for i in 0..count {
        let id = format!("owed-{i}");
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                 VALUES (?, 'Ride', 0, 0, 0, 0, strftime('%s', 'now') - 86400)",
                rusqlite::params![id],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO gps_tracks (activity_id, track_data, point_count) VALUES (?, X'00', 10)",
                rusqlite::params![id],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics
                     (activity_id, name, date, distance, moving_time, elapsed_time,
                      elevation_gain, sport_type)
                 VALUES (?, 'r', 0, 0, 600, 600, 0, 'Ride')",
                rusqlite::params![id],
            )
            .unwrap();
    }
    engine.db.execute_batch("COMMIT").unwrap();
}

/// Scenario: the library owes more streams than one day's allowance draws, and the
/// athlete opens the jobs screen while the download waits.
///
/// Expected behaviour: the read carries the whole days the allowance takes, which
/// is two for one request past a day's cap, and nothing once the queue is empty.
#[test]
fn a_library_owing_more_than_a_day_reports_the_days_it_takes() {
    use crate::governor::{BACKFILL_ALLOWANCE, days_to_draw};

    let engine = PersistentEngine::in_memory().unwrap();
    assert_eq!(read(&engine).stream_days_to_finish, None);

    let per_day = BACKFILL_ALLOWANCE.per_day.expect("a daily allowance");
    owe_streams(&engine, per_day + 1);
    let data = read(&engine);
    assert_eq!(
        data.stream_days_to_finish,
        days_to_draw(u64::from(per_day) + 1, BACKFILL_ALLOWANCE, per_day)
    );
    assert_eq!(data.stream_days_to_finish, Some(2));

    engine
        .db
        .execute("DELETE FROM gps_tracks", [])
        .expect("the queue empties");
    assert_eq!(read(&engine).stream_days_to_finish, None);
}

/// Scenario: the range confirm needs the days a widened range takes before any
/// download is queued, so the read carries the daily share itself.
///
/// Expected behaviour: the share is the backfill allowance's daily cap, on an empty library too.
#[test]
fn the_screen_read_carries_the_backfill_day_share() {
    let engine = PersistentEngine::in_memory().unwrap();
    assert_eq!(
        read(&engine).backfill_day_share,
        crate::governor::BACKFILL_ALLOWANCE.per_day
    );
    assert!(read(&engine).backfill_day_share.is_some());
}

#[test]
fn the_screen_read_says_a_pass_recount_is_running_only_while_its_guard_is_held() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recount.db");
    let path = path.to_str().unwrap();
    let engine = PersistentEngine::new(path).unwrap();
    assert!(!read(&engine).pass_recount_running);

    let running = crate::persistence::sections::pass_rule::RecountRunning::begin(path);
    assert!(read(&engine).pass_recount_running);

    let other = tempfile::tempdir().unwrap();
    let other_path = other.path().join("other.db");
    let other_engine = PersistentEngine::new(other_path.to_str().unwrap()).unwrap();
    assert!(
        !read(&other_engine).pass_recount_running,
        "another library's recount is not this one's"
    );

    drop(running);
    assert!(!read(&engine).pass_recount_running);
}

fn seed_track(engine: &PersistentEngine, id: &str, state: u8) {
    engine
        .db
        .execute(
            "INSERT INTO activities
                (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
             VALUES (?1, 'Ride', 0, 0, 0, 0, 1)",
            [id],
        )
        .unwrap();
    engine
        .db
        .execute(
            "INSERT INTO gps_tracks (activity_id, track_data, point_count, elevation_state)
             VALUES (?1, X'00', 0, ?2)",
            rusqlite::params![id, i64::from(state)],
        )
        .unwrap();
}

fn store_diff(engine: &PersistentEngine, payload: &str) {
    engine
        .set_setting(crate::persistence::cutover::CUTOVER_DIFF_KEY, payload)
        .unwrap();
}

/// Scenario: a cut was promoted over the newest slice, its diff carries no
/// counts yet and some tracks still wait for elevation.
///
/// Expected behaviour: the read reports the decided tracks out of all the
/// tracks the download can ask about, and nothing once the counts are written
/// or the queue is empty.
#[test]
fn a_staged_cut_reports_the_history_still_joining() {
    use crate::persistence::{ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNKNOWN};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("staged.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    assert_eq!(read(&engine).staged_history, None, "no cut, no progress");

    seed_track(&engine, "a1", ELEVATION_STATE_FETCHED);
    seed_track(&engine, "a2", ELEVATION_STATE_FETCHED);
    seed_track(&engine, "a3", ELEVATION_STATE_UNKNOWN);
    seed_track(&engine, "a4", ELEVATION_STATE_UNKNOWN);
    seed_track(&engine, "demo-1", ELEVATION_STATE_UNKNOWN);

    store_diff(&engine, r#"{"token":"t","counts":null}"#);
    assert_eq!(
        read(&engine).staged_history,
        Some(crate::FfiStagedHistory {
            done: 2,
            total: 4,
            days_to_finish: None
        })
    );

    store_diff(&engine, r#"{"token":"t"}"#);
    assert_eq!(
        read(&engine).staged_history,
        Some(crate::FfiStagedHistory {
            done: 2,
            total: 4,
            days_to_finish: None
        }),
        "an absent counts key reads as owed too"
    );

    store_diff(
        &engine,
        r#"{"token":"t","counts":{"current":1,"new":0,"changed":0,"gone":0}}"#,
    );
    assert_eq!(read(&engine).staged_history, None, "counts written");

    store_diff(&engine, r#"{"token":"t","counts":null}"#);
    engine
        .db
        .execute("UPDATE gps_tracks SET elevation_state = 1", [])
        .unwrap();
    assert_eq!(read(&engine).staged_history, None, "nothing owed");
}

/// Scenario: a staged cut with more tracks owed than one day's backfill share.
///
/// Expected behaviour: the staged history names the whole days the queue takes
/// on the daily share, and none when the queue fits in a day.
#[test]
fn a_staged_cut_names_the_days_its_history_needs() {
    use crate::persistence::{ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNKNOWN};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("staged_days.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    store_diff(&engine, r#"{"token":"t","counts":null}"#);

    seed_track(&engine, "ready", ELEVATION_STATE_FETCHED);
    let share = crate::governor::BACKFILL_ALLOWANCE.per_day.unwrap();
    for n in 0..=share {
        seed_track(&engine, &format!("owed-{n}"), ELEVATION_STATE_UNKNOWN);
    }
    let staged = read(&engine).staged_history.unwrap();
    assert_eq!(staged.done, 1);
    assert_eq!(staged.total, share + 2);
    assert_eq!(staged.days_to_finish, Some(2));
}
