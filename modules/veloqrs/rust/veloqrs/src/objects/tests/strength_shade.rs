use super::*;

fn sets_of(category: u16, count: u32) -> Vec<(String, fit::FitExerciseSet)> {
    (0..count)
        .map(|order| {
            (
                "session-a".to_string(),
                fit::FitExerciseSet {
                    set_order: order,
                    exercise_category: category,
                    exercise_name: None,
                    set_type: 0,
                    repetitions: Some(8),
                    weight_kg: Some(40.0),
                    duration_secs: None,
                    start_time: None,
                },
            )
        })
        .collect()
}

fn shade_of(summary: &FfiStrengthSummary, slug: &str) -> u8 {
    summary
        .muscle_volumes
        .iter()
        .find(|m| m.slug == slug)
        .unwrap_or_else(|| panic!("no volume for {slug}"))
        .shade
}

#[test]
fn diagram_shade_steps_each_muscle_against_the_most_trained() {
    let shades: Vec<u8> = [10.0, 6.0, 5.0, 2.0, 0.5]
        .iter()
        .map(|&weighted| diagram_shade(weighted, 10.0))
        .collect();
    assert_eq!(shades, vec![5, 3, 3, 1, 1]);
}

#[test]
fn diagram_shade_of_an_untrained_scale_is_the_lightest() {
    assert_eq!(diagram_shade(0.0, 0.0), 1);
}

/// Scenario: ten curls, six triceps extensions and two calf raises.
/// Expected behaviour: biceps 10, triceps 6, forearm 5 (curl's secondary at
/// half) and calves 2 shade as 5, 3, 3 and 1 against a maximum of 10.
#[test]
fn the_summary_carries_each_muscles_shade_and_the_scales_maximum() {
    let mut sets = sets_of(7, 10);
    sets.extend(sets_of(30, 6));
    sets.extend(sets_of(1, 2));

    let summary = aggregate_strength_sets(&sets);

    assert_eq!(summary.max_weighted_sets, 10.0);
    assert_eq!(shade_of(&summary, "biceps"), 5);
    assert_eq!(shade_of(&summary, "triceps"), 3);
    assert_eq!(shade_of(&summary, "forearm"), 3);
    assert_eq!(shade_of(&summary, "calves"), 1);
}

#[test]
fn a_single_muscle_is_the_darkest_shade() {
    let summary = aggregate_strength_sets(&sets_of(1, 1));

    assert_eq!(summary.muscle_volumes.len(), 1);
    assert_eq!(summary.max_weighted_sets, 1.0);
    assert_eq!(shade_of(&summary, "calves"), DIAGRAM_SHADES);
}

#[test]
fn an_empty_window_has_no_volumes_and_a_maximum_of_zero() {
    let summary = aggregate_strength_sets(&[]);

    assert!(summary.muscle_volumes.is_empty());
    assert_eq!(summary.max_weighted_sets, 0.0);
}
