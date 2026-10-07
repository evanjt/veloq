use super::*;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

const DAY: i64 = 86_400;
const BASE: i64 = 1_700_000_000;
const CATEGORY: u16 = 7;

fn a_set(order: u32, weight_kg: f64) -> fit::FitExerciseSet {
    fit::FitExerciseSet {
        set_order: order,
        exercise_category: CATEGORY,
        exercise_name: None,
        set_type: 0,
        repetitions: Some(8),
        weight_kg: Some(weight_kg),
        duration_secs: None,
        start_time: None,
    }
}

/// Two strength sessions a day apart, one unprocessed strength activity, and a
/// ride that must never reach a strength read.
fn seed_strength() {
    crate::with_persistent_engine(|engine| {
        for (id, name, date, sport) in [
            ("s1", "Push day", BASE, "WeightTraining"),
            ("s2", "Pull day", BASE + DAY, "WeightTraining"),
            ("s3", "Leg day", BASE + 2 * DAY, "WeightTraining"),
            ("r1", "Lake loop", BASE, "Ride"),
        ] {
            engine
                .db
                .execute(
                    "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                         elapsed_time, elevation_gain, sport_type)
                     VALUES (?1, ?2, ?3, 0, 0, 0, 0, ?4)",
                    rusqlite::params![id, name, date, sport],
                )
                .unwrap();
        }
        engine
            .store_exercise_sets("s1", &[a_set(0, 40.0), a_set(1, 42.5)])
            .unwrap();
        engine.store_exercise_sets("s2", &[a_set(0, 50.0)]).unwrap();
        engine.mark_fit_outcome("s1", FitOutcome::Parsed).unwrap();
        engine.mark_fit_outcome("s2", FitOutcome::Parsed).unwrap();
    })
    .unwrap();
}

fn primary_slug() -> String {
    fit::exercise_muscle_groups(CATEGORY)
        .iter()
        .find(|m| m.intensity == 2)
        .expect("a primary muscle for the category")
        .slug
        .to_string()
}

fn week(start: i64) -> FfiTimestampRange {
    FfiTimestampRange {
        start_ts: start as f64,
        end_ts: (start + DAY - 1) as f64,
    }
}

#[test]
fn test_get_exercise_sets_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_sets_under_writer.db");
    let strength = StrengthManager::new();
    let result = read_while_writer_holds(|| strength.get_exercise_sets("s1".into()).unwrap());
    assert!(result.sets.is_empty());
}

#[test]
fn test_is_fit_processed_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_processed_under_writer.db");
    let strength = StrengthManager::new();
    assert!(!read_while_writer_holds(|| strength
        .is_fit_processed("s1".into())
        .unwrap()));
}

#[test]
fn test_get_unprocessed_strength_ids_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_unprocessed_under_writer.db");
    let strength = StrengthManager::new();
    let result = read_while_writer_holds(|| strength.get_unprocessed_strength_ids().unwrap());
    assert!(result.is_empty());
}

#[test]
fn test_get_screen_data_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_screen_under_writer.db");
    let strength = StrengthManager::new();
    let result = read_while_writer_holds(|| {
        strength
            .get_screen_data(BASE as f64, (BASE + 7 * DAY) as f64, vec![week(BASE)])
            .unwrap()
    });
    assert_eq!(result.summary.total_sets, 0);
    assert_eq!(result.weekly.len(), 1);
}

#[test]
fn test_get_activities_for_exercise_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_exercise_under_writer.db");
    let strength = StrengthManager::new();
    let result = read_while_writer_holds(|| {
        strength
            .get_activities_for_exercise(
                BASE as f64,
                (BASE + 7 * DAY) as f64,
                primary_slug(),
                CATEGORY,
            )
            .unwrap()
    });
    assert!(result.activities.is_empty());
}

#[test]
fn test_has_strength_data_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_has_data_under_writer.db");
    let strength = StrengthManager::new();
    assert!(!read_while_writer_holds(|| strength
        .has_strength_data()
        .unwrap()));
}

#[test]
fn test_get_muscle_groups_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_muscles_under_writer.db");
    let strength = StrengthManager::new();
    let result = read_while_writer_holds(|| strength.get_muscle_groups("s1".into()).unwrap());
    assert!(result.is_empty());
}

#[test]
fn test_get_muscle_detail_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_detail_under_writer.db");
    let strength = StrengthManager::new();
    let result = read_while_writer_holds(|| {
        strength
            .get_muscle_detail("s1".into(), primary_slug())
            .unwrap()
    });
    assert_eq!(result.total_sets, 0.0);
}

/// The pooled reads answer from the same rows the engine methods do, on a
/// library that holds sets, a strength activity still owed its file, and a
/// ride.
#[test]
fn test_pooled_reads_match_the_engine_on_a_seeded_library() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_pooled_parity.db");
    seed_strength();
    let strength = StrengthManager::new();

    let (sets, processed, queue, count) = crate::with_persistent_engine(|e| {
        (
            e.get_exercise_sets("s1").unwrap(),
            e.is_fit_processed("s2").unwrap(),
            e.get_unprocessed_strength_ids().unwrap(),
            e.get_strength_activity_count().unwrap(),
        )
    })
    .unwrap();

    assert_eq!(
        format!("{:?}", strength.get_exercise_sets("s1".into()).unwrap()),
        format!("{:?}", summarise_session(sets_to_ffi("s1", &sets)))
    );
    assert_eq!(sets.len(), 2);
    assert_eq!(strength.is_fit_processed("s2".into()).unwrap(), processed);
    assert!(processed);
    assert!(!strength.is_fit_processed("s3".into()).unwrap());
    assert_eq!(strength.get_unprocessed_strength_ids().unwrap(), queue);
    assert_eq!(queue, vec!["s3".to_string()]);
    assert_eq!(count, 2);
    assert!(strength.has_strength_data().unwrap());

    let groups = strength.get_muscle_groups("s1".into()).unwrap();
    assert_eq!(
        format!("{groups:?}"),
        format!("{:?}", {
            fit::aggregate_muscle_groups(&sets)
                .into_iter()
                .map(|g| FfiMuscleGroup {
                    slug: g.slug,
                    intensity: g.intensity,
                })
                .collect::<Vec<_>>()
        })
    );
    assert!(!groups.is_empty());

    let detail = strength
        .get_muscle_detail("s1".into(), primary_slug())
        .unwrap();
    assert_eq!(detail.total_sets, 2.0);
    assert_eq!(detail.total_reps, 16.0);
}

#[test]
fn test_pooled_screen_data_reads_the_period_and_each_week() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_pooled_screen.db");
    seed_strength();
    let strength = StrengthManager::new();

    let data = strength
        .get_screen_data(
            BASE as f64,
            (BASE + 7 * DAY) as f64,
            vec![week(BASE), week(BASE + DAY), week(BASE + 5 * DAY)],
        )
        .unwrap();

    assert_eq!(data.summary.total_sets, 3);
    assert_eq!(data.summary.activity_count, 2);
    assert_eq!(
        data.weekly.iter().map(|w| w.total_sets).collect::<Vec<_>>(),
        vec![2, 1, 0]
    );
}

/// Scenario: an athlete has sets parsed from earlier, and this period's
/// strength sessions have no FIT outcome because their downloads failed. The
/// summary is empty and the tab said there were no workouts.
///
/// Expected behaviour: the screen read counts the strength activities in the
/// window still owed a file, and only those: a settled one, a ride and one
/// outside the window are not owed here.
#[test]
fn test_screen_data_counts_the_strength_activities_owed_in_the_window() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_pooled_owed.db");
    seed_strength();
    let strength = StrengthManager::new();

    let whole = strength
        .get_screen_data(BASE as f64, (BASE + 7 * DAY) as f64, vec![])
        .unwrap();
    assert_eq!(whole.owed_count, 1, "s3 has no outcome; s1 and s2 settled");

    let before_s3 = strength
        .get_screen_data(BASE as f64, (BASE + 2 * DAY - 1) as f64, vec![])
        .unwrap();
    assert_eq!(before_s3.owed_count, 0, "s3 falls after the window");

    let only_s3 = strength
        .get_screen_data((BASE + 2 * DAY) as f64, (BASE + 3 * DAY - 1) as f64, vec![])
        .unwrap();
    assert_eq!(only_s3.summary.activity_count, 0);
    assert_eq!(only_s3.owed_count, 1);
}

#[test]
fn test_pooled_activities_for_exercise_carry_names_newest_first() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_pooled_exercise.db");
    seed_strength();
    let strength = StrengthManager::new();

    let result = strength
        .get_activities_for_exercise(
            BASE as f64,
            (BASE + 7 * DAY) as f64,
            primary_slug(),
            CATEGORY,
        )
        .unwrap();

    let rows: Vec<_> = result
        .activities
        .iter()
        .map(|a| (a.activity_id.as_str(), a.activity_name.as_str(), a.sets))
        .collect();
    assert_eq!(rows, vec![("s2", "Pull day", 1.0), ("s1", "Push day", 2.0)]);
    assert_eq!(result.activities[1].volume_kg, 40.0 * 8.0 + 42.5 * 8.0);
    assert!(result.activities.iter().all(|a| a.is_primary));

    let other = strength
        .get_activities_for_exercise(
            BASE as f64,
            (BASE + 7 * DAY) as f64,
            primary_slug(),
            CATEGORY + 1,
        )
        .unwrap();
    assert!(other.activities.is_empty());
}

#[test]
fn secondary_exercise_activity_uses_the_muscle_share() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strength_secondary_activity.db");
    seed_strength();
    let secondary = fit::exercise_muscle_groups(CATEGORY)
        .iter()
        .find(|muscle| muscle.intensity == 1)
        .unwrap()
        .slug
        .clone();
    let result = StrengthManager::new()
        .get_activities_for_exercise(BASE as f64, (BASE + 7 * DAY) as f64, secondary, CATEGORY)
        .unwrap();
    let first = result
        .activities
        .iter()
        .find(|a| a.activity_id == "s1")
        .unwrap();
    assert_eq!(first.sets, 1.0);
    assert_eq!(first.reps, 8.0);
    assert_eq!(first.volume_kg, 330.0);
}
