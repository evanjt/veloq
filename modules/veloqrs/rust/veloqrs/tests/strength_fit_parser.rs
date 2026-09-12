//! Integration tests for the local FIT strength parser and its storage path.
//!
//! Covers:
//!   1. `parse_fit_strength_sets` error branches (empty / malformed bytes)
//!   2. `store_exercise_sets` -> `get_exercise_sets` roundtrip on a real DB,
//!      exercising the same persistence path the new
//!      `import_sets_from_fit` FFI takes after a successful parse.
//!
//! Run: `cargo test --test strength_fit_parser -p veloqrs`

use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::fit::{FitExerciseSet, parse_fit_strength_sets};
use veloqrs::{ActivityMetrics, FitOutcome, PersistentEngine};

#[test]
fn parse_empty_bytes_reports_empty_error() {
    let err = parse_fit_strength_sets(&[]).expect_err("empty input should error");
    assert!(
        format!("{}", err).to_lowercase().contains("empty"),
        "unexpected error: {}",
        err
    );
}

#[test]
fn parse_malformed_bytes_reports_decode_error() {
    // 16 zero bytes is a non-empty but invalid FIT header.
    let err = parse_fit_strength_sets(&[0u8; 16]).expect_err("malformed input should error");
    assert!(
        format!("{}", err).to_lowercase().contains("decode"),
        "unexpected error: {}",
        err
    );
}

#[test]
fn store_and_read_back_exercise_sets() {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();
    let engine = PersistentEngine::new(&path_str).expect("engine new");

    let activity_id = "test-activity-1";
    let sets = vec![
        // Bench Press, 10 reps at 60kg, active
        FitExerciseSet {
            set_order: 0,
            exercise_category: 0,
            exercise_name: None,
            set_type: 0,
            repetitions: Some(10),
            weight_kg: Some(60.0),
            duration_secs: None,
            start_time: Some(1_700_000_000),
        },
        // Rest
        FitExerciseSet {
            set_order: 1,
            exercise_category: 0,
            exercise_name: None,
            set_type: 1,
            repetitions: None,
            weight_kg: None,
            duration_secs: Some(60.0),
            start_time: Some(1_700_000_060),
        },
        // Squat, 8 reps at 100kg
        FitExerciseSet {
            set_order: 2,
            exercise_category: 28,
            exercise_name: Some(3),
            set_type: 0,
            repetitions: Some(8),
            weight_kg: Some(100.0),
            duration_secs: None,
            start_time: Some(1_700_000_120),
        },
    ];

    engine
        .store_exercise_sets(activity_id, &sets)
        .expect("store ok");
    engine
        .mark_fit_outcome(activity_id, FitOutcome::Parsed)
        .expect("mark processed");

    assert!(
        engine
            .is_fit_processed(activity_id)
            .expect("is_fit_processed")
    );

    let read_back = engine.get_exercise_sets(activity_id).expect("read ok");
    assert_eq!(read_back.len(), 3, "expected 3 sets");
    assert_eq!(read_back[0].set_order, 0);
    assert_eq!(read_back[0].exercise_category, 0);
    assert_eq!(read_back[0].repetitions, Some(10));
    assert_eq!(read_back[0].weight_kg, Some(60.0));

    assert_eq!(read_back[1].set_type, 1, "rest set preserved");
    assert_eq!(read_back[1].duration_secs, Some(60.0));

    assert_eq!(read_back[2].exercise_category, 28, "Squat preserved");
    assert_eq!(read_back[2].exercise_name, Some(3));
    assert_eq!(read_back[2].weight_kg, Some(100.0));
}

/// An activity is retried until it settles. `get_unprocessed_strength_ids` is
/// the queue, and only a recorded outcome takes an activity out of it, so a
/// download that failed for a retryable reason must record nothing.
#[test]
fn only_a_recorded_outcome_leaves_the_retry_queue() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("fit_queue.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("engine");

    let ids = vec![
        "settled_with_sets".to_string(),
        "settled_empty".to_string(),
        "settled_absent".to_string(),
        "failed_download".to_string(),
    ];

    engine
        .mark_fit_outcome("settled_with_sets", FitOutcome::Parsed)
        .expect("mark parsed");
    engine
        .mark_fit_outcome("settled_empty", FitOutcome::Empty)
        .expect("mark empty");
    engine
        .mark_fit_outcome("settled_absent", FitOutcome::Absent)
        .expect("mark absent");

    let unprocessed = engine
        .get_unprocessed_strength_ids(&ids)
        .expect("unprocessed");
    assert_eq!(
        unprocessed,
        vec!["failed_download".to_string()],
        "an activity whose download failed must stay in the queue, and every \
         settled verdict must leave it"
    );

    assert!(
        engine.is_fit_processed("settled_empty").expect("processed"),
        "a FIT that genuinely carries no sets is settled, not pending"
    );
    assert!(
        !engine.is_fit_processed("failed_download").expect("pending"),
        "a failed download must not read as processed"
    );
}

fn strength_metrics(engine: &mut PersistentEngine, ids: &[(&str, &str)]) {
    let metrics = ids
        .iter()
        .enumerate()
        .map(|(i, (id, sport))| ActivityMetrics {
            activity_id: (*id).to_string(),
            name: (*id).to_string(),
            date: 1_700_000_000 + i as i64 * 86_400,
            distance: 0.0,
            moving_time: 3600,
            elapsed_time: 3600,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: (*sport).to_string(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        })
        .collect();
    engine.set_activity_metrics(metrics).expect("metrics");
}

/// Scenario: the caller built the candidate list by filtering a whole-library
/// parsed array in JavaScript for `type === 'WeightTraining'`, which is one of
/// the three uses keeping that array alive, and shipped every id across the FFI
/// to be filtered again.
///
/// Expected behaviour: an empty list asks the engine for the queue itself. The
/// sport is already a column, so the filter belongs in the SQL beside the one
/// on `fit_file_status`.
#[test]
fn an_empty_list_asks_for_every_unprocessed_strength_activity() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("fit_all.db");
    let mut engine = PersistentEngine::new(db.to_str().unwrap()).expect("engine");

    strength_metrics(
        &mut engine,
        &[
            ("lifted_pending", "WeightTraining"),
            ("lifted_settled", "WeightTraining"),
            ("rode", "Ride"),
        ],
    );
    engine
        .mark_fit_outcome("lifted_settled", FitOutcome::Parsed)
        .expect("mark parsed");

    let queue = engine
        .get_unprocessed_strength_ids(&[])
        .expect("unprocessed");
    assert_eq!(
        queue,
        vec!["lifted_pending".to_string()],
        "only the strength activity with no recorded outcome is owed a FIT"
    );
}

#[test]
fn an_empty_library_asks_for_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("fit_none.db");
    let engine = PersistentEngine::new(db.to_str().unwrap()).expect("engine");
    assert!(
        engine
            .get_unprocessed_strength_ids(&[])
            .expect("unprocessed")
            .is_empty()
    );
}

/// A named list still means exactly that list, so a caller that has the ids to
/// hand is unaffected.
#[test]
fn a_named_list_is_still_filtered_to_that_list_alone() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("fit_named.db");
    let mut engine = PersistentEngine::new(db.to_str().unwrap()).expect("engine");

    strength_metrics(
        &mut engine,
        &[
            ("lifted_a", "WeightTraining"),
            ("lifted_b", "WeightTraining"),
        ],
    );

    let queue = engine
        .get_unprocessed_strength_ids(&["lifted_b".to_string()])
        .expect("unprocessed");
    assert_eq!(queue, vec!["lifted_b".to_string()]);
}
