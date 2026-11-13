//! A strength session recorded on the phone is the athlete's own data until an
//! upload lands: its sets are in the library at once, a clear of derived data
//! leaves them, and the copy of the same file that comes back down is not read
//! as a second session.
//!
//! Run: `cargo test --test persistence -p veloqrs -- strength_sessions::`

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::fit::FitExerciseSet;
use veloqrs::persistence::strength_sessions::{
    SessionExercise, SessionGroup, SessionKind, SessionRest, SessionSet, StrengthSession,
};

const BENCH: u16 = 0;
const CURL: u16 = 7;

fn track() -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

fn done(reps: u32, weight_kg: f64) -> SessionSet {
    SessionSet {
        reps: Some(reps),
        weight_kg: Some(weight_kg),
        done: true,
        done_at: Some(1_000 + i64::from(reps)),
        ..SessionSet::default()
    }
}

/// Bench with two working sets, a warm-up and a set left undone, then a
/// one-sided curl, grouped with the bench and rested after.
fn recorded(key: &str) -> StrengthSession {
    StrengthSession {
        id: "session-1".to_string(),
        kind: SessionKind::Finished,
        name: None,
        activity_key: Some(key.to_string()),
        intervals_id: None,
        started_at: Some(900),
        ended_at: Some(2_000),
        last_used_at: None,
        created_at: 900,
        exercises: vec![
            SessionExercise {
                exercise_category: BENCH,
                exercise_name: Some(1),
                group_no: Some(1),
                rest_secs: Some(90),
                sets: vec![
                    SessionSet {
                        warm_up: true,
                        ..done(15, 20.0)
                    },
                    done(10, 60.0),
                    done(8, 62.5),
                    SessionSet {
                        planned_reps: Some(8),
                        planned_weight_kg: Some(62.5),
                        ..SessionSet::default()
                    },
                ],
            },
            SessionExercise {
                exercise_category: CURL,
                exercise_name: None,
                group_no: Some(1),
                rest_secs: None,
                sets: vec![SessionSet {
                    side: Some("left".to_string()),
                    ..done(12, 10.0)
                }],
            },
        ],
        groups: vec![SessionGroup {
            group_no: 1,
            rest_secs: Some(120),
        }],
        rests: vec![SessionRest {
            started_at: Some(1_100),
            duration_secs: Some(88.0),
        }],
        current_exercise: None,
        current_set: None,
        rest_started_at: None,
    }
}

fn open(dir: &TempDir) -> PersistentEngine {
    PersistentEngine::new(dir.path().join("library.db").to_str().unwrap()).unwrap()
}

fn rows(dir: &TempDir, key: &str) -> i64 {
    Connection::open(dir.path().join("library.db"))
        .unwrap()
        .query_row(
            "SELECT count(*) FROM exercise_sets WHERE activity_id = ?1",
            [key],
            |row| row.get(0),
        )
        .unwrap()
}

/// The sets the same ride's FIT file gives when intervals.icu serves it back.
fn downloaded_copy() -> Vec<FitExerciseSet> {
    (0..5)
        .map(|i| FitExerciseSet {
            set_order: i,
            exercise_category: BENCH,
            exercise_name: Some(1),
            set_type: 0,
            repetitions: Some(10),
            weight_kg: Some(60.0),
            duration_secs: None,
            start_time: Some(1_000),
        })
        .collect()
}

#[test]
fn a_saved_session_puts_its_done_working_sets_in_the_library_at_once() {
    let dir = TempDir::new().unwrap();
    let engine = open(&dir);

    engine.save_strength_session(&recorded("local-r1")).unwrap();

    let sets = engine.get_exercise_sets("local-r1").unwrap();
    let shape: Vec<_> = sets
        .iter()
        .map(|s| (s.set_order, s.exercise_category, s.repetitions, s.weight_kg))
        .collect();
    assert_eq!(
        shape,
        vec![
            (0, BENCH, Some(10), Some(60.0)),
            (1, BENCH, Some(8), Some(62.5)),
            (2, CURL, Some(12), Some(10.0)),
        ],
        "the warm-up and the set left undone are not working sets"
    );
    assert!(
        engine.is_fit_processed("local-r1").unwrap(),
        "no download is owed for a session the phone recorded"
    );
}

#[test]
fn a_saved_session_reads_back_with_its_side_groups_planned_values_and_rest() {
    let dir = TempDir::new().unwrap();
    let engine = open(&dir);
    let session = recorded("local-r1");

    engine.save_strength_session(&session).unwrap();

    assert_eq!(
        engine.get_strength_session("session-1").unwrap(),
        Some(session)
    );
    assert_eq!(engine.get_strength_session("nothing").unwrap(), None);
}

#[test]
fn saving_a_session_again_replaces_its_rows_and_its_sets() {
    let dir = TempDir::new().unwrap();
    let engine = open(&dir);
    let mut session = recorded("local-r1");
    engine.save_strength_session(&session).unwrap();

    session.exercises.truncate(1);
    session.exercises[0].sets.truncate(2);
    engine.save_strength_session(&session).unwrap();

    assert_eq!(rows(&dir, "local-r1"), 1);
    assert_eq!(
        engine.get_strength_session("session-1").unwrap(),
        Some(session)
    );
}

#[test]
fn clear_cache_keeps_a_recorded_sessions_sets() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    for id in ["local-r1", "watch-1"] {
        engine
            .add_activity(id.to_string(), track(), "WeightTraining".to_string())
            .unwrap();
    }
    engine.save_strength_session(&recorded("local-r1")).unwrap();
    engine
        .store_exercise_sets("watch-1", &downloaded_copy())
        .unwrap();

    engine.clear_derived().unwrap();

    assert_eq!(
        rows(&dir, "local-r1"),
        3,
        "a recorded session has no other copy to refill from"
    );
    assert_eq!(
        rows(&dir, "watch-1"),
        0,
        "a watch's sets are the server's, and a sync refills them"
    );
}

#[test]
fn sign_out_takes_the_recorded_session_with_the_rest_of_the_library() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    engine.save_strength_session(&recorded("local-r1")).unwrap();

    engine.clear().unwrap();

    assert_eq!(engine.get_strength_session("session-1").unwrap(), None);
    assert_eq!(rows(&dir, "local-r1"), 0);
}

/// Scenario: the upload landed and the ride keeps its own key, which now also
/// names the intervals.icu activity. The owed-download queue treats the key as
/// upstream from here, and intervals.icu serves the phone's own file back.
///
/// Expected behaviour: the rows stay, no download is owed, and an import of
/// the copy under either id adds nothing.
#[test]
fn landing_an_upload_on_the_ride_key_keeps_the_rows_and_a_later_import_adds_none() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    engine
        .add_activity(
            "local-r1".to_string(),
            track(),
            "WeightTraining".to_string(),
        )
        .unwrap();
    engine.save_strength_session(&recorded("local-r1")).unwrap();
    engine.record_upload("local-r1", "i700").unwrap();

    assert!(engine.relink_recorded_session("local-r1", "i700").unwrap());

    assert_eq!(rows(&dir, "local-r1"), 3);
    assert!(engine.is_fit_processed("local-r1").unwrap());
    engine
        .settle_exercise_sets("local-r1", &downloaded_copy())
        .unwrap();
    engine
        .settle_exercise_sets("i700", &downloaded_copy())
        .unwrap();
    assert_eq!(rows(&dir, "local-r1"), 3);
    assert_eq!(rows(&dir, "i700"), 0);
    let session = engine.get_strength_session("session-1").unwrap().unwrap();
    assert_eq!(session.intervals_id.as_deref(), Some("i700"));
}

/// Scenario: the sync stored the uploaded ride under the intervals.icu id
/// before the upload was recorded, so the recording's own row is the duplicate
/// that goes, and its rows with it.
///
/// Expected behaviour: the rows move to the intervals.icu id in the one
/// relink, and the later import of the downloaded file for that id adds none.
#[test]
fn landing_an_upload_the_sync_stored_first_moves_the_rows_to_the_intervals_id() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    for id in ["local-r1", "i700"] {
        engine
            .add_activity(id.to_string(), track(), "WeightTraining".to_string())
            .unwrap();
    }
    Connection::open(dir.path().join("library.db"))
        .unwrap()
        .execute(
            "UPDATE activities SET intervals_id = 'i700' WHERE id = 'i700'",
            [],
        )
        .unwrap();
    engine.save_strength_session(&recorded("local-r1")).unwrap();
    engine.record_upload("local-r1", "i700").unwrap();
    assert!(!engine.has_activity("local-r1"), "the recording's row went");

    assert!(engine.relink_recorded_session("local-r1", "i700").unwrap());

    assert_eq!(rows(&dir, "local-r1"), 0);
    assert_eq!(rows(&dir, "i700"), 3);
    assert!(engine.is_fit_processed("i700").unwrap());
    engine
        .settle_exercise_sets("i700", &downloaded_copy())
        .unwrap();
    assert_eq!(rows(&dir, "i700"), 3, "the same session is not read twice");
    assert!(
        engine.relink_recorded_session("local-r1", "i700").unwrap(),
        "a second call finds the session by the id it was given"
    );
    assert_eq!(rows(&dir, "i700"), 3);
}

#[test]
fn relinking_a_ride_no_session_recorded_changes_nothing() {
    let dir = TempDir::new().unwrap();
    let engine = open(&dir);
    engine
        .store_exercise_sets("watch-1", &downloaded_copy())
        .unwrap();

    assert!(!engine.relink_recorded_session("local-r9", "i9").unwrap());

    assert_eq!(rows(&dir, "watch-1"), 5);
}

#[test]
fn a_saved_workout_writes_nothing_to_the_library() {
    let dir = TempDir::new().unwrap();
    let engine = open(&dir);
    let mut workout = recorded("local-r1");
    workout.kind = SessionKind::Saved;
    workout.name = Some("Push day".to_string());

    engine.save_strength_session(&workout).unwrap();

    assert_eq!(rows(&dir, "local-r1"), 0);
    assert_eq!(
        engine.get_strength_session("session-1").unwrap(),
        Some(workout)
    );
}
