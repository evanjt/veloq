use super::*;

fn set(order: u32, weight: f64, reps: u16, start: Option<f64>) -> FfiExerciseSet {
    FfiExerciseSet {
        activity_id: "session-a".into(),
        set_order: order,
        exercise_category: 0,
        exercise_name: Some(1),
        display_name: "Squat".into(),
        set_type: 0,
        repetitions: Some(reps),
        weight_kg: Some(weight),
        duration_secs: Some(30.0),
        start_time: start,
    }
}

#[test]
fn test_summarise_session_best_set_and_rest() {
    let session = summarise_session(vec![
        set(0, 80.0, 5, Some(100.0)),
        set(1, 90.0, 3, Some(190.0)),
        set(2, 90.0, 4, Some(280.0)),
    ]);
    let group = &session.groups[0];
    assert_eq!(group.best_set.as_ref().unwrap().set_order, 2);
    assert_eq!(group.rest_seconds, vec![60.0, 60.0]);
}

#[test]
fn test_summarise_session_missing_time_has_no_rest() {
    let session = summarise_session(vec![set(0, 80.0, 5, None), set(1, 85.0, 5, Some(190.0))]);
    assert!(session.groups[0].rest_seconds.is_empty());
}

#[test]
fn test_exercise_detail_reads_best_per_session_and_caps_estimate() {
    let engine = crate::persistence::PersistentEngine::in_memory().unwrap();
    for (id, date) in [("session-a", 1000), ("session-b", 2000)] {
        engine.db.execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain, sport_type)
             VALUES (?1, ?2, ?3, 0, 0, 0, 0, 'WeightTraining')",
            rusqlite::params![id, "Weights", date],
        ).unwrap();
    }
    let make_set = |order, weight, reps| fit::FitExerciseSet {
        set_order: order,
        exercise_category: 25,
        exercise_name: Some(1),
        set_type: 0,
        repetitions: Some(reps),
        weight_kg: Some(weight),
        duration_secs: Some(30.0),
        start_time: None,
    };
    engine
        .store_exercise_sets("session-a", &[make_set(0, 70.0, 8), make_set(1, 80.0, 5)])
        .unwrap();
    engine
        .store_exercise_sets("session-b", &[make_set(0, 85.0, 12)])
        .unwrap();

    let detail = crate::persistence::screens::exercise_detail_data(&engine.db, 25).unwrap();
    assert_eq!(detail.sessions.len(), 2);
    assert_eq!(detail.sessions[0].best_set.weight_kg, Some(80.0));
    assert_eq!(
        detail.sessions[0].estimated_one_rep_max_kg,
        Some(80.0 * (1.0 + 5.0 / 30.0))
    );
    assert_eq!(detail.sessions[1].best_set.weight_kg, Some(85.0));
    assert_eq!(detail.sessions[1].estimated_one_rep_max_kg, None);
}
