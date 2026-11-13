//! The demo library's strength sessions: the sets each one carries, keyed by its
//! activity id. Demo mode has no FIT file to download, so the engine settles a
//! demo session from here through `settle_exercise_sets`, the write a real
//! session takes, and the groups, the ranking and the history read it back.
//!
//! The ids are shared with the demo fixtures in
//! `src/shared/demo/activity/stableActivities.ts`. `demo-test-6` is the stable
//! session the end-to-end flows open. `demo-strength-<template>-<weeks ago>` is
//! one weekly session of a template, over the last eight weeks.

use crate::fit::FitExerciseSet;

/// The stable session, a bench, squat and deadlift named by category only.
const STABLE_SESSION: &str = "demo-test-6";

/// How many weeks of weekly sessions the fixtures hold, the latest being week 0.
const WEEKS: u32 = 8;

/// Weights rise by this much for every two weeks, so the latest session is the heaviest.
const WEIGHT_STEP_KG: f64 = 2.5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Template {
    Push,
    Pull,
    Legs,
}

/// One exercise of a template: its catalogue pair, how many active sets it
/// takes, and its load. A hold takes a duration in place of repetitions and
/// weight; a load moves up by [`WEIGHT_STEP_KG`] over the weeks.
struct Lift {
    exercise: (u16, u16),
    sets: u32,
    reps: Option<u16>,
    kg: Option<f64>,
    hold_secs: Option<f64>,
}

impl Template {
    fn lifts(self) -> Vec<Lift> {
        let load = |exercise, sets, reps, kg| Lift {
            exercise,
            sets,
            reps: Some(reps),
            kg: Some(kg),
            hold_secs: None,
        };
        match self {
            Template::Push => vec![
                load((0, 1), 3, 5, 60.0),
                load((24, 24), 3, 8, 16.0),
                Lift {
                    exercise: (19, 43),
                    sets: 3,
                    reps: None,
                    kg: None,
                    hold_secs: Some(45.0),
                },
            ],
            // One-sided: three sets per arm, six in all.
            Template::Pull => vec![
                load((23, 24), 6, 10, 20.0),
                load((21, 13), 3, 10, 45.0),
                load((8, 23), 3, 8, 50.0),
            ],
            Template::Legs => vec![load((28, 102), 4, 6, 40.0), load((28, 41), 3, 10, 12.0)],
        }
    }

    fn name(self) -> &'static str {
        match self {
            Template::Push => "push",
            Template::Pull => "pull",
            Template::Legs => "legs",
        }
    }
}

/// The sets of a demo strength session, or `None` for an activity the corpus
/// does not hold.
pub(crate) fn demo_sets(activity_id: &str) -> Option<Vec<FitExerciseSet>> {
    if activity_id == STABLE_SESSION {
        return Some(stable_session());
    }
    let (template, weeks_ago) = parse_id(activity_id)?;
    Some(weekly_session(template, weeks_ago))
}

/// The corpus's sets for each of the activities that it holds, each under its
/// activity id. An activity it does not hold contributes nothing.
pub(crate) fn sample_sets<'a>(
    activity_ids: impl IntoIterator<Item = &'a str>,
) -> Vec<(String, FitExerciseSet)> {
    activity_ids
        .into_iter()
        .flat_map(|id| {
            demo_sets(id)
                .unwrap_or_default()
                .into_iter()
                .map(move |set| (id.to_string(), set))
        })
        .collect()
}

fn parse_id(activity_id: &str) -> Option<(Template, u32)> {
    let rest = activity_id.strip_prefix("demo-strength-")?;
    let (name, weeks) = rest.split_once('-')?;
    let template = [Template::Push, Template::Pull, Template::Legs]
        .into_iter()
        .find(|t| t.name() == name)?;
    let weeks_ago: u32 = weeks.parse().ok()?;
    (weeks_ago < WEEKS).then_some((template, weeks_ago))
}

fn weekly_session(template: Template, weeks_ago: u32) -> Vec<FitExerciseSet> {
    let steps = f64::from((WEEKS - 1 - weeks_ago) / 2);
    let mut sets = Vec::new();
    for lift in template.lifts() {
        for _ in 0..lift.sets {
            sets.push(FitExerciseSet {
                set_order: sets.len() as u32,
                exercise_category: lift.exercise.0,
                exercise_name: Some(lift.exercise.1),
                set_type: 0,
                repetitions: lift.reps,
                weight_kg: lift.kg.map(|kg| kg + steps * WEIGHT_STEP_KG),
                duration_secs: lift.hold_secs,
                start_time: None,
            });
        }
    }
    sets
}

/// Bench 3×5 at 60 kg, squat 5×5 at 80 kg and deadlift 1×5 at 100 kg, each
/// named by its category alone.
fn stable_session() -> Vec<FitExerciseSet> {
    let mut sets = Vec::new();
    let mut push = |category: u16, reps: u16, kg: f64, count: u32| {
        for _ in 0..count {
            sets.push(FitExerciseSet {
                set_order: sets.len() as u32,
                exercise_category: category,
                exercise_name: None,
                set_type: 0,
                repetitions: Some(reps),
                weight_kg: Some(kg),
                duration_secs: None,
                start_time: None,
            });
        }
    };
    push(4, 5, 60.0, 3);
    push(25, 5, 80.0, 5);
    push(12, 5, 100.0, 1);
    sets
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::PersistentEngine;
    use rusqlite::params;
    use tempfile::TempDir;

    const DAY: i64 = 86_400;
    const NOW: i64 = 1_800_000_000;

    const BENCH_CATEGORY: u16 = 0;
    const WEEKLY_EXERCISES: usize = 8;

    fn engine() -> (TempDir, PersistentEngine) {
        let dir = TempDir::new().unwrap();
        let engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
        (dir, engine)
    }

    /// The fixtures' schedule: each weekly session two to six days into its week,
    /// and the stable session a week ago.
    fn demo_schedule() -> Vec<(String, i64)> {
        let mut schedule = vec![(STABLE_SESSION.to_string(), NOW - 7 * DAY)];
        for weeks_ago in 0..WEEKS {
            for (name, offset) in [("push", 2), ("pull", 4), ("legs", 6)] {
                let days_ago = i64::from(weeks_ago) * 7 + offset;
                schedule.push((
                    format!("demo-strength-{name}-{weeks_ago}"),
                    NOW - days_ago * DAY,
                ));
            }
        }
        schedule
    }

    /// The demo library as the app seeds it: each strength activity dated, and
    /// its corpus sets settled through the write a real session takes.
    fn seed_demo_library(engine: &PersistentEngine) {
        for (id, date) in demo_schedule() {
            engine
                .db
                .execute(
                    "INSERT OR REPLACE INTO activity_metrics
                     (activity_id, name, date, distance, moving_time, elapsed_time,
                      elevation_gain, sport_type)
                     VALUES (?1, 'Strength', ?2, 0, 0, 0, 0, 'WeightTraining')",
                    params![id, date],
                )
                .unwrap();
            let sets = demo_sets(&id).unwrap_or_else(|| panic!("the corpus holds {id}"));
            engine.settle_exercise_sets(&id, &sets).unwrap();
        }
    }

    #[test]
    fn the_weekly_sessions_repeat_as_groups_and_outrank_the_stable_session() {
        let (_dir, engine) = engine();
        seed_demo_library(&engine);

        let groups = engine.recent_strength_groups().unwrap();
        let repeated = groups.iter().filter(|g| g.times > 1).count();
        assert!(repeated >= 2, "{groups:?}");
        assert!(
            groups[..3]
                .iter()
                .all(|g| g.times == WEEKLY_EXERCISES as u32)
        );

        let ranked = engine.ranked_exercises(NOW).unwrap();
        assert!(ranked[..WEEKLY_EXERCISES].iter().all(|e| e.sessions == 8));
        assert!(ranked[WEEKLY_EXERCISES..].iter().all(|e| e.sessions == 1));
    }

    #[test]
    fn the_latest_session_prefills_its_sets_and_the_history_lists_each_week() {
        let (_dir, engine) = engine();
        seed_demo_library(&engine);

        let latest = engine.get_exercise_sets("demo-strength-push-0").unwrap();
        let bench: Vec<_> = latest
            .iter()
            .filter(|set| set.exercise_category == BENCH_CATEGORY)
            .collect();
        assert_eq!(bench.len(), 3);
        assert!(bench.iter().all(|set| set.exercise_name == Some(1)));
        assert_eq!(bench[0].weight_kg, Some(67.5));

        let history =
            crate::persistence::screens::exercise_detail_data(&engine.db, BENCH_CATEGORY).unwrap();
        assert_eq!(history.sessions.len(), WEEKLY_EXERCISES);
    }

    #[test]
    fn a_sample_takes_the_sets_of_its_strength_sessions_and_nothing_else() {
        let sets = sample_sets(["demo-strength-push-0", "demo-test-0", "demo-test-6"]);

        let per_activity = |id: &str| sets.iter().filter(|(activity, _)| activity == id).count();
        assert_eq!(per_activity("demo-strength-push-0"), 9);
        assert_eq!(per_activity("demo-test-6"), 9);
        assert_eq!(per_activity("demo-test-0"), 0);
        assert_eq!(sets.len(), 18);
    }

    #[test]
    fn weights_rise_every_two_weeks_and_a_session_outside_the_eight_weeks_is_not_held() {
        assert_eq!(
            demo_sets("demo-strength-legs-7").unwrap()[0].weight_kg,
            Some(40.0)
        );
        assert_eq!(
            demo_sets("demo-strength-legs-6").unwrap()[0].weight_kg,
            Some(40.0)
        );
        assert_eq!(
            demo_sets("demo-strength-legs-0").unwrap()[0].weight_kg,
            Some(47.5)
        );
        assert!(demo_sets("demo-strength-legs-8").is_none());
        assert!(demo_sets("demo-strength-swim-0").is_none());
        assert!(demo_sets("demo-lift").is_none());
    }
}
