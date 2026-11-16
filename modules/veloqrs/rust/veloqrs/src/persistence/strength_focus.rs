//! What a live strength session shows on a screen that can only be read at a
//! glance: the focus view, and the notification that carries the rest
//! countdown and the next set while the phone is locked.
//!
//! One function reads the session and answers with a [`FocusState`]. The
//! screens draw it and keep none of it, so the focus view and the lock screen
//! cannot disagree about which set is next or when the rest ends. Times are
//! epoch seconds, the clock the session itself records in.

use super::strength_sessions::{SessionSet, StrengthSession};
use crate::strength::catalogue::{self, Equipment};
use crate::strength::weight::{WeightUnit, display_weight, step_sizes, step_weight_kg};

/// Where the session is, as the athlete would say it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, uniffi::Enum)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiFocusPhase")]
pub enum FocusPhase {
    /// A set is to be done now.
    Set,
    /// A rest is running; `current` is the set it leads to.
    Rest,
    /// No set is left to do.
    Finished,
}

/// The set to do, with its place in its exercise.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiFocusSet")]
pub struct FocusSet {
    pub exercise_category: u16,
    pub exercise_name: Option<u16>,
    /// One-based, so a screen can say "set 2 of 3".
    pub set_number: u32,
    pub set_count: u32,
    pub reps: Option<u32>,
    pub weight_kg: Option<f64>,
    /// The weight as the athlete reads it, in `weight_unit`, to one decimal.
    pub display_weight: Option<f64>,
    pub weight_unit: WeightUnit,
    /// One tap of the weight stepper, in `weight_unit`.
    pub weight_step: f64,
    /// The stored kilograms after one tap down and one tap up; an unset weight steps from zero.
    pub weight_down_kg: f64,
    pub weight_up_kg: f64,
    pub duration_secs: Option<f64>,
    pub warm_up: bool,
}

/// A neighbouring exercise, shown small beside the current one.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiFocusNeighbour")]
pub struct FocusNeighbour {
    pub exercise_category: u16,
    pub exercise_name: Option<u16>,
    pub sets_done: u32,
    pub set_count: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FocusState {
    pub phase: FocusPhase,
    /// The set to do now, or after the rest. None once the session is finished.
    pub current: Option<FocusSet>,
    pub previous: Option<FocusNeighbour>,
    pub next: Option<FocusNeighbour>,
    /// When the running rest began. None outside a rest.
    pub rest_started_at: Option<i64>,
    /// The rest planned after the set just done, in seconds. None when no rest
    /// is planned: the rest then counts up and has no end.
    pub rest_secs: Option<u32>,
    /// When the running rest ends: the moment the lock screen counts down to
    /// and the phone vibrates. None unless a rest with a planned length runs.
    pub rest_ends_at: Option<i64>,
}

fn neighbour(session: &StrengthSession, index: i64) -> Option<FocusNeighbour> {
    let exercise = session.exercises.get(usize::try_from(index).ok()?)?;
    Some(FocusNeighbour {
        exercise_category: exercise.exercise_category,
        exercise_name: exercise.exercise_name,
        sets_done: exercise.sets.iter().filter(|s| s.done).count() as u32,
        set_count: exercise.sets.len() as u32,
    })
}

fn focus_set(
    session: &StrengthSession,
    exercise: u32,
    set: u32,
    unit: WeightUnit,
) -> Option<FocusSet> {
    let found = session.exercises.get(exercise as usize)?;
    let row: &SessionSet = found.sets.get(set as usize)?;
    let equipment = found
        .exercise_name
        .and_then(|name| catalogue::lookup(found.exercise_category, name))
        .map_or(Equipment::Other, |e| e.equipment);
    let current_kg = row.weight_kg.unwrap_or(0.0);
    Some(FocusSet {
        exercise_category: found.exercise_category,
        exercise_name: found.exercise_name,
        set_number: set + 1,
        set_count: found.sets.len() as u32,
        reps: row.reps,
        weight_kg: row.weight_kg,
        display_weight: row.weight_kg.map(|kg| display_weight(kg, unit)),
        weight_unit: unit,
        weight_step: step_sizes(equipment, unit).weight,
        weight_down_kg: step_weight_kg(current_kg, equipment, unit, -1),
        weight_up_kg: step_weight_kg(current_kg, equipment, unit, 1),
        duration_secs: row.duration_secs,
        warm_up: row.warm_up,
    })
}

/// The exercise whose set was done last: the one whose planned rest the
/// running rest is.
fn last_done_exercise(session: &StrengthSession) -> Option<u32> {
    session
        .exercises
        .iter()
        .enumerate()
        .flat_map(|(i, e)| {
            e.sets
                .iter()
                .filter_map(move |s| s.done_at.map(|at| (at, i)))
        })
        .max_by_key(|&(at, i)| (at, i))
        .map(|(_, i)| i as u32)
}

impl StrengthSession {
    /// The focus read with weights in the athlete's `unit`.
    pub fn focus_state(&self, unit: WeightUnit) -> FocusState {
        let position = self.current_exercise.zip(self.current_set);
        let current = position.and_then(|(e, s)| focus_set(self, e, s, unit));
        let (previous, next) = match position {
            Some((e, _)) => (
                neighbour(self, i64::from(e) - 1),
                neighbour(self, i64::from(e) + 1),
            ),
            None => (None, None),
        };
        let phase = match (&current, self.rest_started_at) {
            (None, _) => FocusPhase::Finished,
            (Some(_), Some(_)) => FocusPhase::Rest,
            (Some(_), None) => FocusPhase::Set,
        };
        let resting = phase == FocusPhase::Rest;
        let rest_secs = if resting {
            last_done_exercise(self).and_then(|e| self.rest_secs_after(e))
        } else {
            None
        };
        let rest_ends_at = self
            .rest_started_at
            .zip(rest_secs)
            .filter(|_| resting)
            .map(|(start, secs)| start + i64::from(secs));
        FocusState {
            phase,
            current,
            previous,
            next,
            rest_started_at: self.rest_started_at.filter(|_| resting),
            rest_secs,
            rest_ends_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::strength_sessions::{SessionExercise, SessionKind};

    const NOW: i64 = 1_800_000_000;

    fn exercise(category: u16, sets: u32) -> SessionExercise {
        SessionExercise {
            exercise_category: category,
            exercise_name: Some(1),
            sets: (0..sets)
                .map(|_| SessionSet {
                    reps: Some(8),
                    weight_kg: Some(40.0),
                    ..SessionSet::default()
                })
                .collect(),
            ..SessionExercise::default()
        }
    }

    fn session(exercises: Vec<SessionExercise>) -> StrengthSession {
        let mut session = StrengthSession {
            id: "live-1".to_string(),
            kind: SessionKind::Live,
            name: None,
            activity_key: None,
            intervals_id: None,
            started_at: Some(NOW),
            ended_at: None,
            last_used_at: None,
            created_at: NOW,
            exercises,
            groups: Vec::new(),
            rests: Vec::new(),
            current_exercise: None,
            current_set: None,
            rest_started_at: None,
            heart_rate: Vec::new(),
            notes: Vec::new(),
        };
        session.settle_position();
        session
    }

    #[test]
    fn the_focus_read_carries_display_weight_and_equipment_steps() {
        let (category, name) = (0, 0); // a dumbbell exercise
        let mut dumbbell = exercise(category, 1);
        dumbbell.exercise_name = Some(name);
        dumbbell.sets[0].weight_kg = Some(20.0);
        let s = session(vec![dumbbell]);

        let kg = s.focus_state(WeightUnit::Kilogram).current.unwrap();
        assert_eq!(kg.display_weight, Some(20.0));
        assert_eq!(kg.weight_step, 2.0);
        assert_eq!(kg.weight_up_kg, 22.0);
        assert_eq!(kg.weight_down_kg, 18.0);

        let lb = s.focus_state(WeightUnit::Pound).current.unwrap();
        assert_eq!(lb.display_weight, Some(44.1));
        assert_eq!(lb.weight_step, 5.0);
        assert_eq!(display_weight(lb.weight_up_kg, WeightUnit::Pound), 49.1);
        assert_eq!(display_weight(lb.weight_down_kg, WeightUnit::Pound), 39.1);
    }

    #[test]
    fn an_unset_weight_steps_up_from_zero() {
        let mut bare = exercise(0, 1);
        bare.exercise_name = Some(0);
        bare.sets[0].weight_kg = None;
        let focus = session(vec![bare])
            .focus_state(WeightUnit::Kilogram)
            .current
            .unwrap();
        assert_eq!(focus.display_weight, None);
        assert_eq!(focus.weight_down_kg, 0.0);
        assert_eq!(focus.weight_up_kg, 2.0);
    }

    #[test]
    fn a_set_to_do_names_its_place_and_the_exercises_either_side() {
        let mut s = session(vec![exercise(0, 3), exercise(7, 2), exercise(23, 2)]);
        s.complete_set(0, 0, NOW).unwrap();
        s.complete_set(0, 1, NOW + 60).unwrap();
        s.complete_set(0, 2, NOW + 120).unwrap();
        let focus = s.focus_state(WeightUnit::Kilogram);
        assert_eq!(focus.phase, FocusPhase::Set);
        let current = focus.current.unwrap();
        assert_eq!(
            (
                current.exercise_category,
                current.set_number,
                current.set_count
            ),
            (7, 1, 2)
        );
        let previous = focus.previous.unwrap();
        assert_eq!(
            (
                previous.exercise_category,
                previous.sets_done,
                previous.set_count
            ),
            (0, 3, 3)
        );
        assert_eq!(focus.next.unwrap().exercise_category, 23);
        assert_eq!(focus.rest_ends_at, None);
    }

    #[test]
    fn a_rest_carries_the_next_set_and_the_moment_it_ends() {
        let mut s = session(vec![exercise(0, 2), exercise(7, 1)]);
        s.set_exercise_rest(0, Some(90)).unwrap();
        s.complete_set(0, 0, NOW).unwrap();
        s.start_rest(NOW + 5);
        let focus = s.focus_state(WeightUnit::Kilogram);
        assert_eq!(focus.phase, FocusPhase::Rest);
        assert_eq!(focus.current.unwrap().set_number, 2);
        assert_eq!(focus.rest_started_at, Some(NOW + 5));
        assert_eq!(focus.rest_secs, Some(90));
        assert_eq!(focus.rest_ends_at, Some(NOW + 95));
    }

    #[test]
    fn a_rest_after_a_grouped_exercise_takes_the_groups_length() {
        let mut s = session(vec![exercise(0, 1), exercise(7, 1), exercise(23, 1)]);
        s.set_exercise_rest(1, Some(30)).unwrap();
        s.group_exercises(1, 0).unwrap();
        let group = s.exercises[0].group_no.unwrap();
        s.set_group_rest(group, Some(150)).unwrap();
        s.complete_set(1, 0, NOW).unwrap();
        s.start_rest(NOW);
        assert_eq!(
            s.focus_state(WeightUnit::Kilogram).rest_ends_at,
            Some(NOW + 150)
        );
    }

    #[test]
    fn a_rest_with_no_planned_length_has_no_end() {
        let mut s = session(vec![exercise(0, 2)]);
        s.complete_set(0, 0, NOW).unwrap();
        s.start_rest(NOW);
        let focus = s.focus_state(WeightUnit::Kilogram);
        assert_eq!(focus.phase, FocusPhase::Rest);
        assert_eq!(focus.rest_secs, None);
        assert_eq!(focus.rest_ends_at, None);
    }

    #[test]
    fn a_session_with_no_set_left_is_finished() {
        let mut s = session(vec![exercise(0, 1)]);
        s.complete_set(0, 0, NOW).unwrap();
        s.start_rest(NOW);
        let focus = s.focus_state(WeightUnit::Kilogram);
        assert_eq!(focus.phase, FocusPhase::Finished);
        assert_eq!(focus.current, None);
        assert_eq!(focus.rest_ends_at, None);
        assert_eq!((focus.previous, focus.next), (None, None));
    }

    #[test]
    fn the_first_exercise_has_no_previous_and_the_last_has_no_next() {
        let s = session(vec![exercise(0, 1)]);
        let focus = s.focus_state(WeightUnit::Kilogram);
        assert_eq!((focus.previous, focus.next), (None, None));
    }
}
