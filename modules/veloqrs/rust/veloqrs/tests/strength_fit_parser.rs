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
use veloqrs::PersistentRouteEngine;

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
    let engine = PersistentRouteEngine::new(&path_str).expect("engine new");

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
        .mark_fit_processed(activity_id, true)
        .expect("mark processed");

    assert!(engine.is_fit_processed(activity_id).expect("is_fit_processed"));

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
