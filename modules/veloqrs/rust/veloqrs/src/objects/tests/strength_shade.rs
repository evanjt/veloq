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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn diagram_shade_steps_each_muscle_against_the_most_trained() {
    let shades: Vec<u8> = [10.0, 6.0, 5.0, 2.0, 0.5]
        .iter()
        .map(|&weighted| diagram_shade(weighted, 10.0))
        .collect();
    assert_eq!(shades, vec![5, 3, 3, 1, 1]);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn diagram_shade_of_an_untrained_scale_is_the_lightest() {
    assert_eq!(diagram_shade(0.0, 0.0), 1);
}

/// Scenario: ten curls, six triceps extensions and two calf raises.
/// Expected behaviour: biceps 10, triceps 6, forearm 5 (curl's secondary at
/// half) and calves 2 shade as 5, 3, 3 and 1 against a maximum of 10.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_single_muscle_is_the_darkest_shade() {
    let summary = aggregate_strength_sets(&sets_of(1, 1));

    assert_eq!(summary.muscle_volumes.len(), 1);
    assert_eq!(summary.max_weighted_sets, 1.0);
    assert_eq!(shade_of(&summary, "calves"), DIAGRAM_SHADES);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_window_has_no_volumes_and_a_maximum_of_zero() {
    let summary = aggregate_strength_sets(&[]);

    assert!(summary.muscle_volumes.is_empty());
    assert_eq!(summary.max_weighted_sets, 0.0);
}

/// Scenario: a window whose most trained muscle has twelve weighted sets.
/// Expected behaviour: the summary names the most sets each shade covers, one
/// fifth of the maximum per step, to a tenth of a set, the last at the maximum.
#[test]
fn shade_ceilings_step_a_fifth_of_the_maximum_to_a_tenth_of_a_set() {
    assert_eq!(diagram_shade_ceilings(12.0), vec![2.4, 4.8, 7.2, 9.6, 12.0]);
    assert_eq!(diagram_shade_ceilings(7.5), vec![1.5, 3.0, 4.5, 6.0, 7.5]);
    assert_eq!(diagram_shade_ceilings(3.3), vec![0.7, 1.3, 2.0, 2.6, 3.3]);
}

/// Expected behaviour: a window with nothing trained, or a non-finite or
/// negative maximum, covers no sets at any step.
#[test]
fn shade_ceilings_of_an_untrained_window_are_all_zero() {
    let none = vec![0.0; usize::from(DIAGRAM_SHADES)];
    assert_eq!(diagram_shade_ceilings(0.0), none);
    assert_eq!(diagram_shade_ceilings(f64::NAN), none);
    assert_eq!(diagram_shade_ceilings(-3.0), none);
}

/// Expected behaviour: the summary carries the ceilings of its own maximum, so
/// a shade and the legend's label for it come from one place.
#[test]
fn the_summary_carries_the_ceilings_of_its_maximum() {
    let summary = aggregate_strength_sets(&sets_of(7, 10));
    assert_eq!(
        summary.shade_ceilings,
        diagram_shade_ceilings(summary.max_weighted_sets)
    );
    assert_eq!(summary.shade_ceilings.len(), usize::from(DIAGRAM_SHADES));
    assert_eq!(aggregate_strength_sets(&[]).shade_ceilings, vec![0.0; 5]);
}

fn session_of(id: &str, category: u16, count: u32) -> Vec<(String, fit::FitExerciseSet)> {
    sets_of(category, count)
        .into_iter()
        .map(|(_, set)| (id.to_string(), set))
        .collect()
}

/// Scenario: three sessions of bench press, four sets in the first, and one of
/// curls.
///
/// Expected behaviour: each muscle counts a session once however many of its
/// sets worked it, and a muscle worked only secondarily counts its sessions
/// too, so the chest and the deltoids read three and the biceps one.
#[test]
fn each_muscle_counts_the_sessions_that_worked_it_once_each() {
    let mut sets = session_of("monday", 0, 4);
    sets.extend(session_of("wednesday", 0, 1));
    sets.extend(session_of("friday", 0, 2));
    sets.extend(session_of("friday", 7, 3));

    let sessions = muscle_session_counts(&sets);

    assert_eq!(sessions.get("chest"), Some(&3));
    assert_eq!(sessions.get("triceps"), Some(&3));
    assert_eq!(sessions.get("deltoids"), Some(&3));
    assert_eq!(sessions.get("biceps"), Some(&1));
    assert_eq!(sessions.get("calves"), None);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn no_sets_count_no_sessions() {
    assert!(muscle_session_counts(&[]).is_empty());
}
