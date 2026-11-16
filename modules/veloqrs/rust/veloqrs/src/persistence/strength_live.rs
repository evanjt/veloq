//! The strength session being recorded now: planned and done sets, the
//! last-time prefill, the flow-down rule, groups, rest, free order and resume.
//!
//! A live session is a [`StrengthSession`] of kind `live`, stored by
//! `persistence::strength_sessions` and written back after every change, so a
//! killed app resumes at the set it was on. Screens and the linked browser
//! call [`PersistentEngine::edit_live_strength_session`] with a [`LiveEdit`]
//! and draw the session it answers with; they keep none of it.
//!
//! The rules live on [`StrengthSession`] as plain methods that touch no
//! database, so each is tested alone:
//!
//! - A change to a set's reps, weight or duration carries down through the
//!   sets directly below that held the same value. It stops at the first set
//!   that differs and at a done set, never moves a set above it and never
//!   moves a done set.
//! - A session that has not begun (`started_at` empty) is being prepared, and
//!   its edits change the planned values with the values. Once it has begun
//!   the planned values stay as they were set.
//! - Any set may be done next. After a set is done the position moves to the
//!   next set still to do: the next member of its group, else the next set of
//!   its exercise, else the next exercise, wrapping to the first one left.

use std::fmt;

use rusqlite::{Connection, Result as SqlResult};

use super::PersistentEngine;
use super::climb_bests::in_write_txn;
use super::exercise_usage::{LastTime, last_time};
use super::strength_sessions::{
    HEART_RATE_RANGE, SessionExercise, SessionGroup, SessionKind, SessionRest, SessionSet,
    StrengthSession, read_session,
};
use crate::strength::catalogue::{self, Equipment};
use crate::strength::plan_line::{PlanLineReading, read_line};
use crate::strength::weight::{WeightUnit, step_sizes, step_weight_kg};

/// Why a live-session call did nothing.
#[derive(Debug, PartialEq)]
pub enum LiveError {
    /// No session is live.
    NoLiveSession,
    /// A session is already live, and there is one at a time.
    LiveSessionExists,
    /// The exercise index names no exercise of the session.
    NoSuchExercise(u32),
    /// The set index names no set of the exercise.
    NoSuchSet {
        exercise: u32,
        set: u32,
    },
    /// The session to start from does not exist, or is the live one.
    NoSuchSource(String),
    Sql(String),
}

impl fmt::Display for LiveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LiveError::NoLiveSession => write!(f, "no strength session is live"),
            LiveError::LiveSessionExists => write!(f, "a strength session is already live"),
            LiveError::NoSuchExercise(exercise) => write!(f, "no exercise {exercise}"),
            LiveError::NoSuchSet { exercise, set } => {
                write!(f, "no set {set} of exercise {exercise}")
            }
            LiveError::NoSuchSource(id) => write!(f, "no session {id} to start from"),
            LiveError::Sql(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for LiveError {}

impl From<rusqlite::Error> for LiveError {
    fn from(error: rusqlite::Error) -> Self {
        LiveError::Sql(error.to_string())
    }
}

/// Where a new live session takes its exercises from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartFrom {
    /// No exercises.
    Blank,
    /// A finished session or a saved workout, copied with its sets as planned
    /// values and nothing done. The source is not changed.
    Session(String),
    /// A strength activity in the library, whatever recorded it. A phone
    /// recording that kept its session starts from that session, with its
    /// groups and rests; any other starts from its working sets, each run of
    /// sets of one exercise an exercise.
    Activity(String),
    /// The lines of a planned workout. Each line that reads as an exercise
    /// becomes one with its planned sets, a rest line becomes the rest after
    /// the exercise before it, and every other line is kept as a session note.
    Plan(Vec<String>),
}

/// One change to the live session. The phone and the browser both make these.
#[derive(Debug, Clone, PartialEq)]
pub enum LiveEdit {
    /// Start the session: from here, edits leave the planned values alone.
    Begin,
    /// Append an exercise, its sets filled from the last time it was done.
    AddExercise {
        category: u16,
        name: Option<u16>,
    },
    RemoveExercise {
        exercise: u32,
    },
    MoveExercise {
        from: u32,
        to: u32,
    },
    /// Group `exercise` with `onto`, placing it beside it.
    Group {
        exercise: u32,
        onto: u32,
    },
    Ungroup {
        exercise: u32,
    },
    ExerciseRest {
        exercise: u32,
        secs: Option<u32>,
    },
    GroupRest {
        group_no: u32,
        secs: Option<u32>,
    },
    /// A copy of the set `after`, below it; of the last set when `after` is empty.
    AddSet {
        exercise: u32,
        after: Option<u32>,
    },
    RemoveSet {
        exercise: u32,
        set: u32,
    },
    /// One tap of a stepper: reps up or down by one, never below one.
    StepReps {
        exercise: u32,
        set: u32,
        direction: i32,
    },
    /// One tap of a stepper: weight up or down by the exercise's equipment
    /// step, never below zero.
    StepWeight {
        exercise: u32,
        set: u32,
        direction: i32,
        /// The athlete's unit: the step is taken in it.
        unit: WeightUnit,
    },
    /// One tap of a stepper: duration up or down by five seconds, never below
    /// five.
    StepDuration {
        exercise: u32,
        set: u32,
        direction: i32,
    },
    SetReps {
        exercise: u32,
        set: u32,
        value: Option<u32>,
    },
    SetWeight {
        exercise: u32,
        set: u32,
        value: Option<f64>,
    },
    SetDuration {
        exercise: u32,
        set: u32,
        value: Option<f64>,
    },
    SetSide {
        exercise: u32,
        set: u32,
        side: Option<String>,
    },
    SetWarmUp {
        exercise: u32,
        set: u32,
        warm_up: bool,
    },
    SelectSet {
        exercise: u32,
        set: u32,
    },
    CompleteSet {
        exercise: u32,
        set: u32,
    },
    ReopenSet {
        exercise: u32,
        set: u32,
    },
    StartRest,
    EndRest,
}

/// The live session after an edit.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveOutcome {
    pub session: StrengthSession,
    /// For an exercise added with sets from an earlier session, the whole days
    /// since that session.
    pub prefilled_days_ago: Option<u32>,
}

/// The categories the profile uses for a set with no named exercise.
const UNNAMED_CATEGORIES: [u16; 2] = [65534, 65535];

fn same_reps(a: &Option<u32>, b: &Option<u32>) -> bool {
    a == b
}

fn same_measure(a: &Option<f64>, b: &Option<f64>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => (a - b).abs() < 1e-9,
        _ => false,
    }
}

impl StrengthSession {
    fn exercise_mut(&mut self, exercise: u32) -> Result<&mut SessionExercise, LiveError> {
        self.exercises
            .get_mut(exercise as usize)
            .ok_or(LiveError::NoSuchExercise(exercise))
    }

    fn check_set(&self, exercise: u32, set: u32) -> Result<(), LiveError> {
        let found = self
            .exercises
            .get(exercise as usize)
            .ok_or(LiveError::NoSuchExercise(exercise))?;
        if (set as usize) < found.sets.len() {
            Ok(())
        } else {
            Err(LiveError::NoSuchSet { exercise, set })
        }
    }

    fn preparing(&self) -> bool {
        self.started_at.is_none()
    }

    fn first_undone(&self, exercise: usize, from: usize) -> Option<(u32, u32)> {
        let sets = &self.exercises.get(exercise)?.sets;
        (from..sets.len())
            .find(|&i| !sets[i].done)
            .map(|i| (exercise as u32, i as u32))
    }

    /// The first set still to do, in the order the exercises sit.
    fn earliest_undone(&self) -> Option<(u32, u32)> {
        (0..self.exercises.len()).find_map(|e| self.first_undone(e, 0))
    }

    fn put_position(&mut self, position: Option<(u32, u32)>) {
        self.current_exercise = position.map(|p| p.0);
        self.current_set = position.map(|p| p.1);
    }

    /// Keep the position on a set that exists: if it names none, move it to
    /// the first set still to do.
    pub(crate) fn settle_position(&mut self) {
        let valid = self
            .current_exercise
            .zip(self.current_set)
            .is_some_and(|(e, s)| self.check_set(e, s).is_ok());
        if !valid {
            let first = self.earliest_undone();
            self.put_position(first);
        }
    }

    /// The set to go to once `(exercise, set)` is done.
    fn position_after(&self, exercise: u32, set: u32) -> Option<(u32, u32)> {
        let here = exercise as usize;
        let count = self.exercises.len();
        if let Some(group) = self.exercises[here].group_no {
            let members: Vec<usize> = (0..count)
                .filter(|&e| self.exercises[e].group_no == Some(group))
                .collect();
            let order = members
                .iter()
                .filter(|&&e| e > here)
                .chain(members.iter().filter(|&&e| e < here))
                .chain(members.iter().filter(|&&e| e == here));
            if let Some(found) = order.into_iter().find_map(|&e| self.first_undone(e, 0)) {
                return Some(found);
            }
        }
        self.first_undone(here, set as usize + 1)
            .or_else(|| (here + 1..count).find_map(|e| self.first_undone(e, 0)))
            .or_else(|| self.earliest_undone())
    }

    fn flow_down<T: Copy>(
        &mut self,
        exercise: u32,
        set: u32,
        value: Option<T>,
        value_of: fn(&mut SessionSet) -> &mut Option<T>,
        plan_of: fn(&mut SessionSet) -> &mut Option<T>,
        same: fn(&Option<T>, &Option<T>) -> bool,
    ) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        let preparing = self.preparing();
        let sets = &mut self.exercises[exercise as usize].sets;
        let old = *value_of(&mut sets[set as usize]);
        for (offset, row) in sets[set as usize..].iter_mut().enumerate() {
            if offset > 0 && (row.done || !same(value_of(row), &old)) {
                break;
            }
            *value_of(row) = value;
            if preparing {
                *plan_of(row) = value;
            }
        }
        Ok(())
    }

    /// Change a set's reps, carrying the change down the sets that held the
    /// same value.
    pub fn set_reps(
        &mut self,
        exercise: u32,
        set: u32,
        value: Option<u32>,
    ) -> Result<(), LiveError> {
        self.flow_down(
            exercise,
            set,
            value,
            |s| &mut s.reps,
            |s| &mut s.planned_reps,
            same_reps,
        )
    }

    /// Change a set's weight in kilograms, carrying the change down.
    pub fn set_weight(
        &mut self,
        exercise: u32,
        set: u32,
        value: Option<f64>,
    ) -> Result<(), LiveError> {
        self.flow_down(
            exercise,
            set,
            value,
            |s| &mut s.weight_kg,
            |s| &mut s.planned_weight_kg,
            same_measure,
        )
    }

    /// Change a set's duration in seconds, carrying the change down.
    pub fn set_duration(
        &mut self,
        exercise: u32,
        set: u32,
        value: Option<f64>,
    ) -> Result<(), LiveError> {
        self.flow_down(
            exercise,
            set,
            value,
            |s| &mut s.duration_secs,
            |s| &mut s.planned_duration_secs,
            same_measure,
        )
    }

    /// One stepper tap on a set's reps, carried down like any change.
    pub fn step_reps(&mut self, exercise: u32, set: u32, direction: i32) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        let current = self.exercises[exercise as usize].sets[set as usize].reps;
        let step = step_sizes(Equipment::Other, WeightUnit::Kilogram).reps;
        let next = (i64::from(current.unwrap_or(0))
            + i64::from(step) * i64::from(direction.signum()))
        .max(1);
        self.set_reps(exercise, set, Some(next as u32))
    }

    /// One stepper tap on a set's weight, by the step its exercise's
    /// equipment takes in the athlete's `unit`, carried down like any change.
    pub fn step_weight(
        &mut self,
        exercise: u32,
        set: u32,
        direction: i32,
        unit: WeightUnit,
    ) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        let found = &self.exercises[exercise as usize];
        let equipment = found
            .exercise_name
            .and_then(|name| catalogue::lookup(found.exercise_category, name))
            .map_or(Equipment::Other, |entry| entry.equipment);
        let current = found.sets[set as usize].weight_kg.unwrap_or(0.0);
        let next = step_weight_kg(current, equipment, unit, direction);
        self.set_weight(exercise, set, Some(next))
    }

    /// One stepper tap on a set's duration, carried down like any change.
    pub fn step_duration(
        &mut self,
        exercise: u32,
        set: u32,
        direction: i32,
    ) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        let current = self.exercises[exercise as usize].sets[set as usize]
            .duration_secs
            .unwrap_or(0.0);
        let step = f64::from(step_sizes(Equipment::Other, WeightUnit::Kilogram).duration_secs);
        let next = (current + step * f64::from(direction.signum())).max(step);
        self.set_duration(exercise, set, Some(next))
    }

    pub fn set_side(
        &mut self,
        exercise: u32,
        set: u32,
        side: Option<String>,
    ) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        self.exercises[exercise as usize].sets[set as usize].side = side;
        Ok(())
    }

    pub fn set_warm_up(&mut self, exercise: u32, set: u32, warm_up: bool) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        self.exercises[exercise as usize].sets[set as usize].warm_up = warm_up;
        Ok(())
    }

    /// Add a set below `after`, a copy of it that is not done; with no `after`,
    /// a copy of the exercise's last set, or an empty set when it has none.
    pub fn add_set(&mut self, exercise: u32, after: Option<u32>) -> Result<(), LiveError> {
        let count = self.exercise_mut(exercise)?.sets.len();
        let index = match after {
            Some(index) => {
                self.check_set(exercise, index)?;
                index as usize + 1
            }
            None => count,
        };
        let mut added = match index.checked_sub(1) {
            Some(source) => self.exercises[exercise as usize].sets[source].clone(),
            None => SessionSet::default(),
        };
        added.done = false;
        added.done_at = None;
        self.exercises[exercise as usize].sets.insert(index, added);
        if self.current_exercise == Some(exercise)
            && let Some(current) = self.current_set
            && current as usize >= index
        {
            self.current_set = Some(current + 1);
        }
        self.settle_position();
        Ok(())
    }

    pub fn remove_set(&mut self, exercise: u32, set: u32) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        self.exercises[exercise as usize].sets.remove(set as usize);
        if self.current_exercise == Some(exercise)
            && let Some(current) = self.current_set
            && current > set
        {
            self.current_set = Some(current - 1);
        }
        self.settle_position();
        Ok(())
    }

    /// Append an exercise and give back its index.
    pub fn insert_exercise(&mut self, exercise: SessionExercise) -> u32 {
        self.exercises.push(exercise);
        self.settle_position();
        (self.exercises.len() - 1) as u32
    }

    pub fn remove_exercise(&mut self, exercise: u32) -> Result<(), LiveError> {
        self.exercise_mut(exercise)?;
        let removed = self.exercises.remove(exercise as usize);
        if let Some(group) = removed.group_no {
            self.dissolve_group_if_alone(group);
        }
        match self.current_exercise {
            Some(current) if current == exercise => self.put_position(None),
            Some(current) if current > exercise => self.current_exercise = Some(current - 1),
            _ => {}
        }
        self.settle_position();
        Ok(())
    }

    /// Move an exercise so it ends at index `to`, the position following it.
    pub fn move_exercise(&mut self, from: u32, to: u32) -> Result<(), LiveError> {
        self.exercise_mut(from)?;
        self.exercise_mut(to)?;
        let moved = self.exercises.remove(from as usize);
        self.exercises.insert(to as usize, moved);
        if let Some(current) = self.current_exercise {
            self.current_exercise = Some(if current == from {
                to
            } else if from < to && current > from && current <= to {
                current - 1
            } else if to < from && current >= to && current < from {
                current + 1
            } else {
                current
            });
        }
        Ok(())
    }

    fn dissolve_group_if_alone(&mut self, group: u32) {
        let members = self
            .exercises
            .iter()
            .filter(|e| e.group_no == Some(group))
            .count();
        if members <= 1 {
            for exercise in &mut self.exercises {
                if exercise.group_no == Some(group) {
                    exercise.group_no = None;
                }
            }
            self.groups.retain(|g| g.group_no != group);
        }
    }

    /// Put `exercise` in the group of `onto`, making one if `onto` has none,
    /// and move it to sit right after that group's other members.
    pub fn group_exercises(&mut self, exercise: u32, onto: u32) -> Result<(), LiveError> {
        self.exercise_mut(exercise)?;
        self.exercise_mut(onto)?;
        if exercise == onto {
            return Ok(());
        }
        let previous = self.exercises[exercise as usize].group_no;
        let group = match self.exercises[onto as usize].group_no {
            Some(group) => group,
            None => {
                let used = self
                    .exercises
                    .iter()
                    .filter_map(|e| e.group_no)
                    .chain(self.groups.iter().map(|g| g.group_no))
                    .max()
                    .unwrap_or(0);
                self.exercises[onto as usize].group_no = Some(used + 1);
                used + 1
            }
        };
        self.exercises[exercise as usize].group_no = Some(group);
        if let Some(previous) = previous
            && previous != group
        {
            self.dissolve_group_if_alone(previous);
        }
        let last_other = self
            .exercises
            .iter()
            .enumerate()
            .filter(|&(i, e)| i != exercise as usize && e.group_no == Some(group))
            .map(|(i, _)| i)
            .max()
            .expect("the target is a member");
        let to = if (exercise as usize) < last_other {
            last_other
        } else {
            last_other + 1
        };
        self.move_exercise(exercise, to as u32)
    }

    /// Take an exercise out of its group; a group left with one member ends.
    pub fn ungroup(&mut self, exercise: u32) -> Result<(), LiveError> {
        let group = self.exercise_mut(exercise)?.group_no.take();
        if let Some(group) = group {
            self.dissolve_group_if_alone(group);
        }
        Ok(())
    }

    pub fn set_exercise_rest(&mut self, exercise: u32, secs: Option<u32>) -> Result<(), LiveError> {
        self.exercise_mut(exercise)?.rest_secs = secs;
        Ok(())
    }

    pub fn set_group_rest(&mut self, group_no: u32, secs: Option<u32>) -> Result<(), LiveError> {
        match self.groups.iter_mut().find(|g| g.group_no == group_no) {
            Some(group) => group.rest_secs = secs,
            None => {
                self.groups.push(SessionGroup {
                    group_no,
                    rest_secs: secs,
                });
                self.groups.sort_by_key(|g| g.group_no);
            }
        }
        Ok(())
    }

    /// The rest planned after a set of this exercise: its group's when it is in
    /// one that has a rest, else its own.
    pub fn rest_secs_after(&self, exercise: u32) -> Option<u32> {
        let found = self.exercises.get(exercise as usize)?;
        found
            .group_no
            .and_then(|no| self.groups.iter().find(|g| g.group_no == no))
            .and_then(|g| g.rest_secs)
            .or(found.rest_secs)
    }

    /// Point the position at a set, to do it next.
    pub fn select_set(&mut self, exercise: u32, set: u32) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        self.put_position(Some((exercise, set)));
        Ok(())
    }

    /// Mark a set done at `now`. A rest in progress ends, and a session still
    /// being prepared begins.
    pub fn complete_set(&mut self, exercise: u32, set: u32, now: i64) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        self.end_rest(now);
        self.started_at.get_or_insert(now);
        let row = &mut self.exercises[exercise as usize].sets[set as usize];
        row.done = true;
        row.done_at = Some(now);
        let next = self.position_after(exercise, set);
        self.put_position(next);
        Ok(())
    }

    /// Make a done set not done and the one to do next.
    pub fn reopen_set(&mut self, exercise: u32, set: u32) -> Result<(), LiveError> {
        self.check_set(exercise, set)?;
        let row = &mut self.exercises[exercise as usize].sets[set as usize];
        row.done = false;
        row.done_at = None;
        self.put_position(Some((exercise, set)));
        Ok(())
    }

    /// Begin a rest at `now`; one already running keeps its start.
    pub fn start_rest(&mut self, now: i64) {
        self.rest_started_at.get_or_insert(now);
    }

    /// End the rest in progress at `now` and record it.
    pub fn end_rest(&mut self, now: i64) {
        if let Some(start) = self.rest_started_at.take() {
            self.rests.push(SessionRest {
                started_at: Some(start),
                duration_secs: Some((now - start).max(0) as f64),
            });
        }
    }

    /// End the session at `now` as a finished one for the ride stored under
    /// `activity_key`, closing the rest in progress.
    pub fn finish(&mut self, activity_key: &str, now: i64) {
        self.end_rest(now);
        self.kind = SessionKind::Finished;
        self.started_at.get_or_insert(now);
        self.ended_at = Some(now);
        self.last_used_at = Some(now);
        self.activity_key = Some(activity_key.to_string());
        self.put_position(None);
    }

    /// Start the session at `now` if it has not begun.
    pub fn begin(&mut self, now: i64) {
        self.started_at.get_or_insert(now);
    }

    fn apply(&mut self, edit: &LiveEdit, now: i64) -> Result<(), LiveError> {
        match edit {
            LiveEdit::Begin => self.begin(now),
            LiveEdit::AddExercise { category, name } => {
                self.insert_exercise(SessionExercise {
                    exercise_category: *category,
                    exercise_name: *name,
                    ..SessionExercise::default()
                });
            }
            LiveEdit::RemoveExercise { exercise } => self.remove_exercise(*exercise)?,
            LiveEdit::MoveExercise { from, to } => self.move_exercise(*from, *to)?,
            LiveEdit::Group { exercise, onto } => self.group_exercises(*exercise, *onto)?,
            LiveEdit::Ungroup { exercise } => self.ungroup(*exercise)?,
            LiveEdit::ExerciseRest { exercise, secs } => {
                self.set_exercise_rest(*exercise, *secs)?
            }
            LiveEdit::GroupRest { group_no, secs } => self.set_group_rest(*group_no, *secs)?,
            LiveEdit::AddSet { exercise, after } => self.add_set(*exercise, *after)?,
            LiveEdit::RemoveSet { exercise, set } => self.remove_set(*exercise, *set)?,
            LiveEdit::StepReps {
                exercise,
                set,
                direction,
            } => self.step_reps(*exercise, *set, *direction)?,
            LiveEdit::StepWeight {
                exercise,
                set,
                direction,
                unit,
            } => self.step_weight(*exercise, *set, *direction, *unit)?,
            LiveEdit::StepDuration {
                exercise,
                set,
                direction,
            } => self.step_duration(*exercise, *set, *direction)?,
            LiveEdit::SetReps {
                exercise,
                set,
                value,
            } => self.set_reps(*exercise, *set, *value)?,
            LiveEdit::SetWeight {
                exercise,
                set,
                value,
            } => {
                self.set_weight(*exercise, *set, *value)?;
            }
            LiveEdit::SetDuration {
                exercise,
                set,
                value,
            } => {
                self.set_duration(*exercise, *set, *value)?;
            }
            LiveEdit::SetSide {
                exercise,
                set,
                side,
            } => {
                self.set_side(*exercise, *set, side.clone())?;
            }
            LiveEdit::SetWarmUp {
                exercise,
                set,
                warm_up,
            } => {
                self.set_warm_up(*exercise, *set, *warm_up)?;
            }
            LiveEdit::SelectSet { exercise, set } => self.select_set(*exercise, *set)?,
            LiveEdit::CompleteSet { exercise, set } => self.complete_set(*exercise, *set, now)?,
            LiveEdit::ReopenSet { exercise, set } => self.reopen_set(*exercise, *set)?,
            LiveEdit::StartRest => self.start_rest(now),
            LiveEdit::EndRest => self.end_rest(now),
        }
        Ok(())
    }
}

/// The sets of an exercise added from an earlier session, as planned sets when
/// the session is still being prepared.
fn prefilled_sets(last: &LastTime, preparing: bool) -> Vec<SessionSet> {
    last.sets
        .iter()
        .map(|set| SessionSet {
            reps: set.reps,
            weight_kg: set.weight_kg,
            duration_secs: set.duration_secs,
            planned_reps: set.reps.filter(|_| preparing),
            planned_weight_kg: set.weight_kg.filter(|_| preparing),
            planned_duration_secs: set.duration_secs.filter(|_| preparing),
            ..SessionSet::default()
        })
        .collect()
}

/// A copy of a session to start from: every set as a planned set, none done,
/// and nothing of the recording it came from.
pub(super) fn prepared_from(source: &StrengthSession, id: String, now: i64) -> StrengthSession {
    let exercises = source
        .exercises
        .iter()
        .map(|exercise| SessionExercise {
            sets: exercise
                .sets
                .iter()
                .map(|set| {
                    let reps = set.reps.or(set.planned_reps);
                    let weight = set.weight_kg.or(set.planned_weight_kg);
                    let duration = set.duration_secs.or(set.planned_duration_secs);
                    SessionSet {
                        reps,
                        weight_kg: weight,
                        duration_secs: duration,
                        side: set.side.clone(),
                        warm_up: set.warm_up,
                        planned_reps: reps,
                        planned_weight_kg: weight,
                        planned_duration_secs: duration,
                        done: false,
                        done_at: None,
                    }
                })
                .collect(),
            ..exercise.clone()
        })
        .collect();
    let mut session = StrengthSession {
        id,
        kind: SessionKind::Live,
        name: None,
        activity_key: None,
        intervals_id: None,
        started_at: None,
        ended_at: None,
        last_used_at: None,
        created_at: now,
        exercises,
        groups: source.groups.clone(),
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

/// The session in progress, read on any connection, so a screen can ask on a
/// pooled reader without the engine's write lock.
pub(crate) fn read_live(conn: &Connection) -> SqlResult<Option<StrengthSession>> {
    let id: Option<String> = conn
        .query_row(
            "SELECT id FROM strength_sessions WHERE kind = 'live'
             ORDER BY created_at DESC, id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            error => Err(error),
        })?;
    match id {
        Some(id) => read_session(conn, &id),
        None => Ok(None),
    }
}

impl PersistentEngine {
    /// The session in progress, if there is one: where a restarted app picks
    /// up.
    pub fn live_strength_session(&self) -> SqlResult<Option<StrengthSession>> {
        read_live(&self.db)
    }

    /// Start the live session from nothing or from a copy of an earlier one,
    /// prepared with nothing done and not yet begun. Refused while a session is
    /// live.
    pub fn start_live_strength_session(
        &self,
        from: &StartFrom,
        now: i64,
    ) -> Result<StrengthSession, LiveError> {
        in_write_txn(&self.db, |_| {
            if self.live_strength_session()?.is_some() {
                return Ok(Err(LiveError::LiveSessionExists));
            }
            let mut id = format!("strength-{now}");
            let mut attempt = 1;
            while self.get_strength_session(&id)?.is_some() {
                attempt += 1;
                id = format!("strength-{now}-{attempt}");
            }
            let session = match from {
                StartFrom::Blank => prepared_from(
                    &StrengthSession {
                        id: String::new(),
                        kind: SessionKind::Live,
                        name: None,
                        activity_key: None,
                        intervals_id: None,
                        started_at: None,
                        ended_at: None,
                        last_used_at: None,
                        created_at: now,
                        exercises: Vec::new(),
                        groups: Vec::new(),
                        rests: Vec::new(),
                        current_exercise: None,
                        current_set: None,
                        rest_started_at: None,
                        heart_rate: Vec::new(),
                        notes: Vec::new(),
                    },
                    id,
                    now,
                ),
                StartFrom::Session(source) => match self.get_strength_session(source)? {
                    Some(found) if found.kind != SessionKind::Live => {
                        prepared_from(&found, id, now)
                    }
                    _ => return Ok(Err(LiveError::NoSuchSource(source.clone()))),
                },
                StartFrom::Plan(lines) => self.session_for_plan(lines, id, now)?,
                StartFrom::Activity(activity) => {
                    match self.session_for_activity(activity, id, now)? {
                        Some(session) => session,
                        None => return Ok(Err(LiveError::NoSuchSource(activity.clone()))),
                    }
                }
            };
            self.save_strength_session(&session)?;
            Ok(Ok(session))
        })?
    }

    /// The prepared session a plan starts: its lines read one by one, an
    /// exercise named without sets taking the sets of its last time.
    fn session_for_plan(
        &self,
        lines: &[String],
        id: String,
        now: i64,
    ) -> SqlResult<StrengthSession> {
        let mut exercises: Vec<SessionExercise> = Vec::new();
        let mut notes: Vec<String> = Vec::new();
        for line in lines
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
        {
            match read_line(line) {
                PlanLineReading::Exercise(planned) => {
                    let mut exercise = planned.into_session_exercise();
                    if exercise.sets.is_empty()
                        && let Some(last) = last_time(
                            &self.db,
                            exercise.exercise_category,
                            exercise.exercise_name,
                            now,
                        )?
                    {
                        exercise.sets = prefilled_sets(&last, true);
                    }
                    exercises.push(exercise);
                }
                PlanLineReading::Rest { secs } => match exercises.last_mut() {
                    Some(last) => last.rest_secs = Some(secs),
                    None => notes.push(line.to_string()),
                },
                PlanLineReading::Note(note) => notes.push(note),
            }
        }
        let mut session = StrengthSession {
            id,
            kind: SessionKind::Live,
            name: None,
            activity_key: None,
            intervals_id: None,
            started_at: None,
            ended_at: None,
            last_used_at: None,
            created_at: now,
            exercises,
            groups: Vec::new(),
            rests: Vec::new(),
            current_exercise: None,
            current_set: None,
            rest_started_at: None,
            heart_rate: Vec::new(),
            notes,
        };
        session.settle_position();
        Ok(session)
    }

    /// The prepared session an activity starts: from the finished session a
    /// phone recording kept, else from the working sets in the library.
    fn session_for_activity(
        &self,
        activity: &str,
        id: String,
        now: i64,
    ) -> SqlResult<Option<StrengthSession>> {
        let kept: Option<String> = self
            .db
            .query_row(
                "SELECT id FROM strength_sessions
                 WHERE kind = 'finished' AND (activity_key = ?1 OR intervals_id = ?1)
                 ORDER BY created_at DESC, id LIMIT 1",
                [activity],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                error => Err(error),
            })?;
        if let Some(kept) = kept
            && let Some(found) = self.get_strength_session(&kept)?
        {
            return Ok(Some(prepared_from(&found, id, now)));
        }
        let mut exercises: Vec<SessionExercise> = Vec::new();
        for logged in self.get_exercise_sets(activity)? {
            if logged.set_type != 0 || UNNAMED_CATEGORIES.contains(&logged.exercise_category) {
                continue;
            }
            let reps = logged.repetitions.map(u32::from);
            let row = SessionSet {
                reps,
                weight_kg: logged.weight_kg,
                duration_secs: logged.duration_secs,
                planned_reps: reps,
                planned_weight_kg: logged.weight_kg,
                planned_duration_secs: logged.duration_secs,
                ..SessionSet::default()
            };
            match exercises.last_mut() {
                Some(last)
                    if last.exercise_category == logged.exercise_category
                        && last.exercise_name == logged.exercise_name =>
                {
                    last.sets.push(row);
                }
                _ => exercises.push(SessionExercise {
                    exercise_category: logged.exercise_category,
                    exercise_name: logged.exercise_name,
                    sets: vec![row],
                    ..SessionExercise::default()
                }),
            }
        }
        if exercises.is_empty() {
            return Ok(None);
        }
        let mut session = StrengthSession {
            id,
            kind: SessionKind::Live,
            name: None,
            activity_key: None,
            intervals_id: None,
            started_at: None,
            ended_at: None,
            last_used_at: None,
            created_at: now,
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
        Ok(Some(session))
    }

    /// Make one change to the live session and store the result, in one
    /// transaction: another edit sees it whole or not at all. A refused edit
    /// stores nothing.
    pub fn edit_live_strength_session(
        &self,
        edit: &LiveEdit,
        now: i64,
    ) -> Result<LiveOutcome, LiveError> {
        in_write_txn(&self.db, |_| {
            let Some(mut session) = self.live_strength_session()? else {
                return Ok(Err(LiveError::NoLiveSession));
            };
            let mut prefilled_days_ago = None;
            let mut change = session.apply(edit, now);
            if change.is_ok()
                && let LiveEdit::AddExercise { category, name } = edit
                && let Some(last) = last_time(&self.db, *category, *name, now)?
            {
                let added = session.exercises.len() - 1;
                session.exercises[added].sets = prefilled_sets(&last, session.preparing());
                session.settle_position();
                prefilled_days_ago = Some(last.days_ago);
            }
            if change.is_ok() {
                change = Ok(());
                self.save_strength_session(&session)?;
            }
            Ok(change.map(|()| LiveOutcome {
                session,
                prefilled_days_ago,
            }))
        })?
    }

    /// Keep one heart rate reading taken at `now` on the live session. A
    /// reading is dropped when no session is live, when the session has not
    /// begun, and when it is no heart rate (a strap off the skin reports 0);
    /// a second reading in the same second replaces the first. Nothing is
    /// filled in for a pause. Returns whether the reading was kept.
    pub fn record_live_heart_rate(&self, bpm: u32, now: i64) -> SqlResult<bool> {
        if !HEART_RATE_RANGE.contains(&bpm) {
            return Ok(false);
        }
        in_write_txn(&self.db, |_| {
            let Some(session) = self.live_strength_session()? else {
                return Ok(false);
            };
            if session.started_at.is_none() {
                return Ok(false);
            }
            self.db.execute(
                "INSERT OR REPLACE INTO strength_session_heart_rate (session_id, at, bpm)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![session.id, now, bpm],
            )?;
            Ok(true)
        })
    }

    /// End the live session at `now` as a finished one for the ride stored
    /// under `activity_key`: its done working sets enter the library at once.
    pub fn finish_live_strength_session(
        &self,
        activity_key: &str,
        now: i64,
    ) -> Result<StrengthSession, LiveError> {
        in_write_txn(&self.db, |_| {
            let Some(mut session) = self.live_strength_session()? else {
                return Ok(Err(LiveError::NoLiveSession));
            };
            session.finish(activity_key, now);
            self.save_strength_session(&session)?;
            Ok(Ok(session))
        })?
    }

    /// Drop the live session and everything in it. The library is unchanged:
    /// a live session wrote nothing there.
    pub fn discard_live_strength_session(&self) -> SqlResult<()> {
        in_write_txn(&self.db, |_| {
            if let Some(session) = self.live_strength_session()? {
                for table in &super::strength_sessions::SESSION_TABLES[1..] {
                    self.db.execute(
                        &format!("DELETE FROM {table} WHERE session_id = ?1"),
                        [&session.id],
                    )?;
                }
                self.db
                    .execute("DELETE FROM strength_sessions WHERE id = ?1", [&session.id])?;
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fit::FitExerciseSet;
    use tempfile::TempDir;

    const DAY: i64 = 86_400;
    const NOW: i64 = 1_800_000_000;

    const BENCH: (u16, u16) = (0, 1);
    const ROW: (u16, u16) = (23, 2);

    fn set(reps: u32, weight: f64) -> SessionSet {
        SessionSet {
            reps: Some(reps),
            weight_kg: Some(weight),
            ..SessionSet::default()
        }
    }

    fn exercise(exercise: (u16, u16), sets: Vec<SessionSet>) -> SessionExercise {
        SessionExercise {
            exercise_category: exercise.0,
            exercise_name: Some(exercise.1),
            sets,
            ..SessionExercise::default()
        }
    }

    fn live(exercises: Vec<SessionExercise>) -> StrengthSession {
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

    fn reps_of(session: &StrengthSession, exercise: usize) -> Vec<Option<u32>> {
        session.exercises[exercise]
            .sets
            .iter()
            .map(|s| s.reps)
            .collect()
    }

    fn weights_of(session: &StrengthSession, exercise: usize) -> Vec<Option<f64>> {
        session.exercises[exercise]
            .sets
            .iter()
            .map(|s| s.weight_kg)
            .collect()
    }

    fn position(session: &StrengthSession) -> Option<(u32, u32)> {
        session.current_exercise.zip(session.current_set)
    }

    fn three_sets(reps: [u32; 3]) -> StrengthSession {
        live(vec![exercise(
            BENCH,
            reps.iter().map(|&r| set(r, 40.0)).collect(),
        )])
    }

    #[test]
    fn a_change_carries_down_through_the_sets_that_held_the_same_value() {
        let mut session = three_sets([20, 20, 10]);
        session.set_reps(0, 0, Some(18)).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(18), Some(18), Some(10)]);
    }

    #[test]
    fn a_change_stops_at_the_first_set_that_differs() {
        let mut session = three_sets([12, 10, 8]);
        session.set_reps(0, 0, Some(10)).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(10), Some(10), Some(8)]);

        let mut session = three_sets([12, 10, 12]);
        session.set_reps(0, 0, Some(14)).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(14), Some(10), Some(12)]);
    }

    #[test]
    fn a_change_never_moves_a_set_above_it() {
        let mut session = three_sets([10, 10, 10]);
        session.set_reps(0, 1, Some(12)).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(10), Some(12), Some(12)]);
    }

    #[test]
    fn a_change_never_moves_a_done_set_and_stops_there() {
        let mut session = three_sets([10, 10, 10]);
        session.complete_set(0, 1, NOW).unwrap();
        session.set_reps(0, 0, Some(12)).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(12), Some(10), Some(10)]);
        assert!(session.exercises[0].sets[1].done);

        let mut session = three_sets([10, 10, 10]);
        session.complete_set(0, 2, NOW).unwrap();
        session.set_reps(0, 0, Some(12)).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(12), Some(12), Some(10)]);
    }

    #[test]
    fn the_edited_set_itself_changes_even_when_done() {
        let mut session = three_sets([10, 10, 10]);
        session.complete_set(0, 0, NOW).unwrap();
        session.set_reps(0, 0, Some(9)).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(9), Some(9), Some(9)]);
        assert!(session.exercises[0].sets[0].done);
    }

    #[test]
    fn weight_and_duration_follow_the_same_rule() {
        let mut session = live(vec![exercise(
            BENCH,
            vec![set(8, 60.0), set(8, 60.0), set(8, 57.5)],
        )]);
        session.set_weight(0, 0, Some(62.5)).unwrap();
        assert_eq!(
            weights_of(&session, 0),
            [Some(62.5), Some(62.5), Some(57.5)]
        );

        let hold = |secs: f64| SessionSet {
            duration_secs: Some(secs),
            ..SessionSet::default()
        };
        let mut session = live(vec![exercise(
            BENCH,
            vec![hold(30.0), hold(30.0), hold(20.0)],
        )]);
        session.set_duration(0, 0, Some(45.0)).unwrap();
        let durations: Vec<_> = session.exercises[0]
            .sets
            .iter()
            .map(|s| s.duration_secs)
            .collect();
        assert_eq!(durations, [Some(45.0), Some(45.0), Some(20.0)]);
    }

    #[test]
    fn a_set_with_no_value_is_not_the_same_as_one_with_a_value() {
        let mut session = live(vec![exercise(
            BENCH,
            vec![set(10, 40.0), SessionSet::default()],
        )]);
        session.set_reps(0, 0, Some(12)).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(12), None]);
    }

    #[test]
    fn changes_before_the_session_begins_change_the_plan_too() {
        let mut session = three_sets([20, 20, 10]);
        session.started_at = None;
        for s in &mut session.exercises[0].sets {
            s.planned_reps = s.reps;
        }
        session.set_reps(0, 0, Some(18)).unwrap();
        let planned: Vec<_> = session.exercises[0]
            .sets
            .iter()
            .map(|s| s.planned_reps)
            .collect();
        assert_eq!(planned, [Some(18), Some(18), Some(10)]);
    }

    #[test]
    fn changes_during_the_session_leave_the_plan_alone() {
        let mut session = three_sets([20, 20, 10]);
        for s in &mut session.exercises[0].sets {
            s.planned_reps = s.reps;
        }
        session.set_reps(0, 0, Some(18)).unwrap();
        let planned: Vec<_> = session.exercises[0]
            .sets
            .iter()
            .map(|s| s.planned_reps)
            .collect();
        assert_eq!(planned, [Some(20), Some(20), Some(10)]);
    }

    #[test]
    fn plus_copies_the_set_into_the_row_below_it() {
        let mut session = live(vec![exercise(
            BENCH,
            vec![set(12, 40.0), set(10, 45.0), set(8, 50.0)],
        )]);
        session.complete_set(0, 0, NOW).unwrap();
        session.add_set(0, Some(0)).unwrap();
        assert_eq!(
            reps_of(&session, 0),
            [Some(12), Some(12), Some(10), Some(8)]
        );
        assert_eq!(
            weights_of(&session, 0),
            [Some(40.0), Some(40.0), Some(45.0), Some(50.0)]
        );
        assert!(session.exercises[0].sets[0].done);
        assert!(!session.exercises[0].sets[1].done);
        assert_eq!(session.exercises[0].sets[1].done_at, None);
    }

    #[test]
    fn plus_on_an_exercise_copies_its_last_set_or_starts_empty() {
        let mut session = three_sets([12, 10, 8]);
        session.add_set(0, None).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(12), Some(10), Some(8), Some(8)]);

        let mut session = live(vec![exercise(BENCH, Vec::new())]);
        session.add_set(0, None).unwrap();
        assert_eq!(session.exercises[0].sets, vec![SessionSet::default()]);
    }

    #[test]
    fn a_set_added_above_the_current_one_keeps_the_position_on_the_same_set() {
        let mut session = three_sets([12, 10, 8]);
        session.select_set(0, 2).unwrap();
        session.add_set(0, Some(0)).unwrap();
        assert_eq!(position(&session), Some((0, 3)));
    }

    #[test]
    fn any_set_may_be_done_next_and_the_position_moves_on_from_it() {
        let mut session = live(vec![
            exercise(BENCH, vec![set(8, 40.0), set(8, 40.0), set(8, 40.0)]),
            exercise(ROW, vec![set(10, 30.0), set(10, 30.0)]),
        ]);
        assert_eq!(position(&session), Some((0, 0)));

        session.select_set(1, 1).unwrap();
        assert_eq!(position(&session), Some((1, 1)));
        session.complete_set(1, 1, NOW + 10).unwrap();
        assert!(session.exercises[1].sets[1].done);
        assert_eq!(position(&session), Some((0, 0)));

        session.complete_set(0, 0, NOW + 20).unwrap();
        assert_eq!(position(&session), Some((0, 1)));
        session.complete_set(0, 2, NOW + 30).unwrap();
        assert_eq!(position(&session), Some((1, 0)));
        session.complete_set(1, 0, NOW + 40).unwrap();
        assert_eq!(position(&session), Some((0, 1)));
        session.complete_set(0, 1, NOW + 50).unwrap();
        assert_eq!(position(&session), None);
        assert_eq!(session.exercises[0].sets[2].done_at, Some(NOW + 30));
    }

    #[test]
    fn exercises_in_a_group_alternate_set_by_set() {
        let mut session = live(vec![
            exercise(BENCH, vec![set(8, 40.0), set(8, 40.0)]),
            exercise(ROW, vec![set(10, 30.0), set(10, 30.0)]),
        ]);
        session.group_exercises(1, 0).unwrap();
        let order = [(0, 0), (1, 0), (0, 1), (1, 1)];
        for (index, &(e, s)) in order.iter().enumerate() {
            assert_eq!(position(&session), Some((e, s)), "step {index}");
            session.complete_set(e, s, NOW + index as i64).unwrap();
        }
        assert_eq!(position(&session), None);
    }

    #[test]
    fn a_weight_step_takes_the_equipment_size_and_flows_down() {
        let mut session = three_sets([8, 8, 8]);
        session
            .apply(
                &LiveEdit::StepWeight {
                    exercise: 0,
                    set: 0,
                    direction: 1,
                    unit: WeightUnit::Kilogram,
                },
                NOW,
            )
            .unwrap();
        assert_eq!(
            weights_of(&session, 0),
            [Some(42.5), Some(42.5), Some(42.5)]
        );

        session
            .apply(
                &LiveEdit::StepWeight {
                    exercise: 0,
                    set: 1,
                    direction: -1,
                    unit: WeightUnit::Kilogram,
                },
                NOW,
            )
            .unwrap();
        assert_eq!(
            weights_of(&session, 0),
            [Some(42.5), Some(40.0), Some(40.0)]
        );
    }

    #[test]
    fn a_weight_step_from_nothing_starts_at_one_step_and_never_goes_below_zero() {
        let mut session = live(vec![exercise(
            BENCH,
            vec![SessionSet::default(), SessionSet::default()],
        )]);
        let step = |direction| LiveEdit::StepWeight {
            exercise: 0,
            set: 0,
            direction,
            unit: WeightUnit::Kilogram,
        };
        session.apply(&step(-1), NOW).unwrap();
        assert_eq!(weights_of(&session, 0), [Some(0.0), Some(0.0)]);
        session.apply(&step(1), NOW).unwrap();
        assert_eq!(weights_of(&session, 0), [Some(2.5), Some(2.5)]);
    }

    #[test]
    fn a_reps_step_moves_by_one_and_stops_at_one() {
        let mut session = three_sets([2, 2, 5]);
        let step = |set, direction| LiveEdit::StepReps {
            exercise: 0,
            set,
            direction,
        };
        session.apply(&step(0, -1), NOW).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(1), Some(1), Some(5)]);
        session.apply(&step(0, -1), NOW).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(1), Some(1), Some(5)]);
        session.apply(&step(2, 1), NOW).unwrap();
        assert_eq!(reps_of(&session, 0), [Some(1), Some(1), Some(6)]);
    }

    #[test]
    fn a_duration_step_moves_by_five_seconds_and_stops_at_five() {
        let mut session = live(vec![exercise(
            BENCH,
            vec![SessionSet {
                duration_secs: Some(10.0),
                ..SessionSet::default()
            }],
        )]);
        let step = |direction| LiveEdit::StepDuration {
            exercise: 0,
            set: 0,
            direction,
        };
        session.apply(&step(1), NOW).unwrap();
        assert_eq!(session.exercises[0].sets[0].duration_secs, Some(15.0));
        for _ in 0..4 {
            session.apply(&step(-1), NOW).unwrap();
        }
        assert_eq!(session.exercises[0].sets[0].duration_secs, Some(5.0));
    }

    #[test]
    fn reopening_a_done_set_makes_it_the_current_one() {
        let mut session = three_sets([8, 8, 8]);
        session.complete_set(0, 0, NOW).unwrap();
        session.reopen_set(0, 0).unwrap();
        assert!(!session.exercises[0].sets[0].done);
        assert_eq!(session.exercises[0].sets[0].done_at, None);
        assert_eq!(position(&session), Some((0, 0)));
    }

    #[test]
    fn an_index_that_names_nothing_is_refused_and_changes_nothing() {
        let mut session = three_sets([8, 8, 8]);
        let before = session.clone();
        assert_eq!(
            session.set_reps(1, 0, Some(5)),
            Err(LiveError::NoSuchExercise(1))
        );
        assert_eq!(
            session.complete_set(0, 3, NOW),
            Err(LiveError::NoSuchSet {
                exercise: 0,
                set: 3
            })
        );
        assert_eq!(session, before);
    }

    #[test]
    fn dragging_an_exercise_moves_it_and_the_position_follows_the_set() {
        let mut session = live(vec![
            exercise(BENCH, vec![set(8, 40.0)]),
            exercise(ROW, vec![set(10, 30.0)]),
            exercise((7, 4), vec![set(12, 10.0)]),
        ]);
        session.select_set(0, 0).unwrap();
        session.move_exercise(0, 2).unwrap();
        let order: Vec<_> = session
            .exercises
            .iter()
            .map(|e| e.exercise_category)
            .collect();
        assert_eq!(order, [23, 7, 0]);
        assert_eq!(position(&session), Some((2, 0)));

        session.move_exercise(2, 0).unwrap();
        assert_eq!(position(&session), Some((0, 0)));
    }

    #[test]
    fn dropping_an_exercise_on_another_groups_them_side_by_side() {
        let mut session = live(vec![
            exercise(BENCH, vec![set(8, 40.0)]),
            exercise(ROW, vec![set(10, 30.0)]),
            exercise((7, 4), vec![set(12, 10.0)]),
        ]);
        session.group_exercises(2, 0).unwrap();
        let order: Vec<_> = session
            .exercises
            .iter()
            .map(|e| (e.exercise_category, e.group_no.is_some()))
            .collect();
        assert_eq!(order, [(0, true), (7, true), (23, false)]);
        assert_eq!(session.exercises[0].group_no, session.exercises[1].group_no);

        session.ungroup(1).unwrap();
        assert_eq!(session.exercises[0].group_no, None);
        assert_eq!(session.exercises[1].group_no, None);
        assert!(session.groups.is_empty());
    }

    #[test]
    fn rest_is_planned_per_exercise_or_group_and_recorded_as_it_happens() {
        let mut session = live(vec![
            exercise(BENCH, vec![set(8, 40.0), set(8, 40.0)]),
            exercise(ROW, vec![set(10, 30.0)]),
            exercise((7, 4), vec![set(12, 10.0)]),
        ]);
        session.set_exercise_rest(0, Some(90)).unwrap();
        session.group_exercises(2, 1).unwrap();
        let group = session.exercises[1].group_no.unwrap();
        session.set_group_rest(group, Some(150)).unwrap();
        assert_eq!(session.rest_secs_after(0), Some(90));
        assert_eq!(session.rest_secs_after(1), Some(150));
        assert_eq!(session.rest_secs_after(2), Some(150));

        session.complete_set(0, 0, NOW).unwrap();
        session.start_rest(NOW + 5);
        assert_eq!(session.rest_started_at, Some(NOW + 5));
        session.start_rest(NOW + 6);
        assert_eq!(session.rest_started_at, Some(NOW + 5));
        session.complete_set(0, 1, NOW + 95).unwrap();
        assert_eq!(session.rest_started_at, None);
        assert_eq!(
            session.rests,
            vec![SessionRest {
                started_at: Some(NOW + 5),
                duration_secs: Some(90.0)
            }]
        );
        session.end_rest(NOW + 100);
        assert_eq!(session.rests.len(), 1);
    }

    fn engine() -> (TempDir, PersistentEngine) {
        let dir = TempDir::new().unwrap();
        let engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
        (dir, engine)
    }

    fn library_set(order: u32, exercise: (u16, u16), reps: u16, weight: f64) -> FitExerciseSet {
        FitExerciseSet {
            set_order: order,
            exercise_category: exercise.0,
            exercise_name: Some(exercise.1),
            set_type: 0,
            repetitions: Some(reps),
            weight_kg: Some(weight),
            duration_secs: None,
            start_time: None,
        }
    }

    fn watch_session(engine: &PersistentEngine, id: &str, date: i64, sets: &[FitExerciseSet]) {
        engine
            .db
            .execute(
                "INSERT OR REPLACE INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, sport_type)
                 VALUES (?1, 'Weights', ?2, 0, 0, 0, 0, 'WeightTraining')",
                rusqlite::params![id, date],
            )
            .unwrap();
        engine.store_exercise_sets(id, sets).unwrap();
    }

    fn add(engine: &PersistentEngine, exercise: (u16, u16), now: i64) -> LiveOutcome {
        engine
            .edit_live_strength_session(
                &LiveEdit::AddExercise {
                    category: exercise.0,
                    name: Some(exercise.1),
                },
                now,
            )
            .unwrap()
    }

    #[test]
    fn adding_an_exercise_fills_its_sets_from_the_latest_session_that_did_it() {
        let (_dir, engine) = engine();
        watch_session(
            &engine,
            "older",
            NOW - 20 * DAY,
            &[
                library_set(0, BENCH, 5, 30.0),
                library_set(1, BENCH, 5, 30.0),
            ],
        );
        watch_session(
            &engine,
            "latest",
            NOW - 3 * DAY - 100,
            &[
                library_set(0, ROW, 10, 50.0),
                library_set(1, BENCH, 12, 40.0),
                library_set(2, BENCH, 10, 40.0),
                library_set(3, BENCH, 8, 42.5),
            ],
        );
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();

        let outcome = add(&engine, BENCH, NOW);

        assert_eq!(outcome.prefilled_days_ago, Some(3));
        let sets = &outcome.session.exercises[0].sets;
        let values: Vec<_> = sets.iter().map(|s| (s.reps, s.weight_kg)).collect();
        assert_eq!(
            values,
            [
                (Some(12), Some(40.0)),
                (Some(10), Some(40.0)),
                (Some(8), Some(42.5))
            ]
        );
        assert!(sets.iter().all(|s| !s.done));
        assert_eq!(position(&outcome.session), Some((0, 0)));
    }

    #[test]
    fn adding_an_exercise_prefills_from_a_phone_recorded_session_too() {
        let (_dir, engine) = engine();
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW - 2 * DAY)
            .unwrap();
        add(&engine, BENCH, NOW - 2 * DAY);
        engine
            .edit_live_strength_session(
                &LiveEdit::AddSet {
                    exercise: 0,
                    after: None,
                },
                NOW - 2 * DAY,
            )
            .unwrap();
        engine
            .edit_live_strength_session(
                &LiveEdit::SetReps {
                    exercise: 0,
                    set: 0,
                    value: Some(6),
                },
                NOW - 2 * DAY,
            )
            .unwrap();
        engine
            .edit_live_strength_session(
                &LiveEdit::CompleteSet {
                    exercise: 0,
                    set: 0,
                },
                NOW - 2 * DAY + 60,
            )
            .unwrap();
        engine
            .finish_live_strength_session("local-r1", NOW - 2 * DAY + 600)
            .unwrap();

        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();
        let outcome = add(&engine, BENCH, NOW);

        assert_eq!(outcome.prefilled_days_ago, Some(1));
        assert_eq!(outcome.session.exercises[0].sets.len(), 1);
        assert_eq!(outcome.session.exercises[0].sets[0].reps, Some(6));
    }

    #[test]
    fn a_new_exercise_starts_empty() {
        let (_dir, engine) = engine();
        watch_session(
            &engine,
            "past",
            NOW - DAY,
            &[library_set(0, BENCH, 12, 40.0)],
        );
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();

        let outcome = add(&engine, ROW, NOW);

        assert_eq!(outcome.prefilled_days_ago, None);
        assert!(outcome.session.exercises[0].sets.is_empty());
        assert_eq!(position(&outcome.session), None);
    }

    #[test]
    fn a_reopened_engine_resumes_the_session_at_the_same_set() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        watch_session(
            &engine,
            "past",
            NOW - DAY,
            &[
                library_set(0, BENCH, 12, 40.0),
                library_set(1, BENCH, 10, 40.0),
                library_set(2, ROW, 10, 30.0),
            ],
        );
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();
        add(&engine, BENCH, NOW);
        add(&engine, ROW, NOW);
        for edit in [
            LiveEdit::SelectSet {
                exercise: 1,
                set: 0,
            },
            LiveEdit::CompleteSet {
                exercise: 1,
                set: 0,
            },
            LiveEdit::StartRest,
        ] {
            engine.edit_live_strength_session(&edit, NOW + 30).unwrap();
        }
        let before = engine.live_strength_session().unwrap().unwrap();
        drop(engine);

        let reopened = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        let after = reopened.live_strength_session().unwrap().unwrap();

        assert_eq!(after, before);
        assert_eq!(position(&after), Some((0, 0)));
        assert!(after.exercises[1].sets[0].done);
        assert_eq!(after.rest_started_at, Some(NOW + 30));
    }

    #[test]
    fn every_change_is_stored_before_the_call_returns() {
        let (_dir, engine) = engine();
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();
        let outcome = add(&engine, ROW, NOW);
        assert_eq!(
            engine.get_strength_session(&outcome.session.id).unwrap(),
            Some(outcome.session)
        );
    }

    #[test]
    fn only_one_session_is_live_at_a_time() {
        let (_dir, engine) = engine();
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();
        assert_eq!(
            engine.start_live_strength_session(&StartFrom::Blank, NOW + 1),
            Err(LiveError::LiveSessionExists)
        );
    }

    #[test]
    fn an_edit_with_no_live_session_is_refused() {
        let (_dir, engine) = engine();
        assert_eq!(
            engine.edit_live_strength_session(&LiveEdit::StartRest, NOW),
            Err(LiveError::NoLiveSession)
        );
        assert_eq!(engine.live_strength_session().unwrap(), None);
    }

    #[test]
    fn a_refused_edit_leaves_the_stored_session_as_it_was() {
        let (_dir, engine) = engine();
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();
        let before = engine.live_strength_session().unwrap();
        let refused = engine.edit_live_strength_session(
            &LiveEdit::CompleteSet {
                exercise: 4,
                set: 0,
            },
            NOW,
        );
        assert_eq!(refused, Err(LiveError::NoSuchExercise(4)));
        assert_eq!(engine.live_strength_session().unwrap(), before);
    }

    fn finished_with_two_exercises() -> StrengthSession {
        let mut session = live(vec![
            exercise(BENCH, vec![set(10, 40.0), set(8, 45.0)]),
            exercise(ROW, vec![set(12, 30.0)]),
        ]);
        session.id = "past".to_string();
        session.kind = SessionKind::Finished;
        session.activity_key = Some("local-r9".to_string());
        session.set_exercise_rest(0, Some(90)).unwrap();
        session.group_exercises(1, 0).unwrap();
        session.complete_set(0, 0, NOW - DAY).unwrap();
        session.complete_set(1, 0, NOW - DAY + 30).unwrap();
        session.complete_set(0, 1, NOW - DAY + 60).unwrap();
        session
    }

    #[test]
    fn a_pound_athlete_s_session_file_carries_the_pound_unit() {
        let (_dir, engine) = engine();
        let mut past = finished_with_two_exercises();
        past.started_at = Some(NOW - DAY - 10);
        engine.save_strength_session(&past).unwrap();

        assert_eq!(engine.strength_session_fit("nope").unwrap(), None);

        let metric = engine.strength_session_fit("past").unwrap().unwrap();
        assert_eq!(
            crate::fit::strength_weight_unit(&metric).unwrap(),
            Some(crate::strength::weight::WeightUnit::Kilogram)
        );
        let sets = crate::fit::parse_fit_strength_sets(&metric).unwrap();
        assert_eq!(sets.len(), 3);

        engine
            .set_setting("veloq-resolved-unit-system", "imperial")
            .unwrap();
        let imperial = engine.strength_session_fit("past").unwrap().unwrap();
        assert_eq!(
            crate::fit::strength_weight_unit(&imperial).unwrap(),
            Some(crate::strength::weight::WeightUnit::Pound)
        );
    }

    #[test]
    fn starting_from_a_past_session_prepares_its_exercises_with_planned_sets() {
        let (_dir, engine) = engine();
        let past = finished_with_two_exercises();
        engine.save_strength_session(&past).unwrap();

        let started = engine
            .start_live_strength_session(&StartFrom::Session("past".to_string()), NOW)
            .unwrap();

        assert_eq!(started.kind, SessionKind::Live);
        assert_ne!(started.id, "past");
        assert_eq!(started.started_at, None);
        assert_eq!(started.activity_key, None);
        assert_eq!(started.exercises.len(), 2);
        assert_eq!(started.exercises[0].group_no, past.exercises[0].group_no);
        assert_eq!(started.exercises[0].rest_secs, Some(90));
        assert_eq!(started.groups, past.groups);
        let first = &started.exercises[0].sets;
        assert_eq!(
            first
                .iter()
                .map(|s| (s.reps, s.planned_reps, s.planned_weight_kg, s.done))
                .collect::<Vec<_>>(),
            [
                (Some(10), Some(10), Some(40.0), false),
                (Some(8), Some(8), Some(45.0), false)
            ]
        );
        assert_eq!(position(&started), Some((0, 0)));
        assert_eq!(engine.get_strength_session("past").unwrap(), Some(past));
    }

    #[test]
    fn starting_from_a_logged_activity_makes_an_exercise_of_each_run_of_sets() {
        let (_dir, engine) = engine();
        let mut rest = library_set(3, BENCH, 0, 0.0);
        rest.set_type = 1;
        rest.repetitions = None;
        rest.weight_kg = None;
        engine
            .store_exercise_sets(
                "watch-1",
                &[
                    library_set(0, BENCH, 10, 40.0),
                    library_set(1, BENCH, 8, 45.0),
                    library_set(2, ROW, 12, 30.0),
                    rest,
                    library_set(4, BENCH, 6, 50.0),
                ],
            )
            .unwrap();

        let started = engine
            .start_live_strength_session(&StartFrom::Activity("watch-1".to_string()), NOW)
            .unwrap();

        assert_eq!(started.kind, SessionKind::Live);
        assert_eq!(started.started_at, None);
        let shape: Vec<_> = started
            .exercises
            .iter()
            .map(|e| {
                (
                    (e.exercise_category, e.exercise_name),
                    e.sets
                        .iter()
                        .map(|s| (s.planned_reps, s.planned_weight_kg, s.done))
                        .collect::<Vec<_>>(),
                )
            })
            .collect();
        assert_eq!(
            shape,
            [
                (
                    (BENCH.0, Some(BENCH.1)),
                    vec![(Some(10), Some(40.0), false), (Some(8), Some(45.0), false)]
                ),
                ((ROW.0, Some(ROW.1)), vec![(Some(12), Some(30.0), false)]),
                ((BENCH.0, Some(BENCH.1)), vec![(Some(6), Some(50.0), false)]),
            ]
        );
        assert_eq!(position(&started), Some((0, 0)));
        assert_eq!(engine.live_strength_session().unwrap(), Some(started));
    }

    #[test]
    fn a_phone_recording_that_kept_its_session_starts_from_it_with_its_groups_and_rests() {
        let (_dir, engine) = engine();
        let past = finished_with_two_exercises();
        engine.save_strength_session(&past).unwrap();

        let started = engine
            .start_live_strength_session(&StartFrom::Activity("local-r9".to_string()), NOW)
            .unwrap();

        assert_eq!(started.exercises.len(), 2);
        assert_eq!(started.exercises[0].rest_secs, Some(90));
        assert_eq!(started.exercises[1].group_no, past.exercises[1].group_no);
        assert_eq!(started.groups, past.groups);
    }

    #[test]
    fn an_activity_with_no_logged_sets_cannot_be_started_from() {
        let (_dir, engine) = engine();
        assert_eq!(
            engine.start_live_strength_session(&StartFrom::Activity("watch-9".to_string()), NOW),
            Err(LiveError::NoSuchSource("watch-9".to_string()))
        );
        assert_eq!(engine.live_strength_session().unwrap(), None);
    }

    #[test]
    fn starting_from_nothing_that_exists_is_refused() {
        let (_dir, engine) = engine();
        assert_eq!(
            engine.start_live_strength_session(&StartFrom::Session("nope".to_string()), NOW),
            Err(LiveError::NoSuchSource("nope".to_string()))
        );
        assert_eq!(engine.live_strength_session().unwrap(), None);
    }

    #[test]
    fn finishing_stores_the_done_sets_in_the_library_and_ends_the_live_session() {
        let (_dir, engine) = engine();
        engine
            .save_strength_session(&finished_with_two_exercises())
            .unwrap();
        engine
            .start_live_strength_session(&StartFrom::Session("past".to_string()), NOW)
            .unwrap();
        engine
            .edit_live_strength_session(
                &LiveEdit::CompleteSet {
                    exercise: 0,
                    set: 0,
                },
                NOW + 30,
            )
            .unwrap();

        let finished = engine
            .finish_live_strength_session("local-r10", NOW + 90)
            .unwrap();

        assert_eq!(finished.kind, SessionKind::Finished);
        assert_eq!(finished.ended_at, Some(NOW + 90));
        assert_eq!(finished.activity_key.as_deref(), Some("local-r10"));
        assert_eq!(engine.live_strength_session().unwrap(), None);
        let stored = engine.get_exercise_sets("local-r10").unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].repetitions, Some(10));
    }

    #[test]
    fn discarding_removes_the_live_session_and_leaves_the_library_alone() {
        let (_dir, engine) = engine();
        engine
            .save_strength_session(&finished_with_two_exercises())
            .unwrap();
        engine
            .start_live_strength_session(&StartFrom::Session("past".to_string()), NOW)
            .unwrap();

        engine.discard_live_strength_session().unwrap();

        assert_eq!(engine.live_strength_session().unwrap(), None);
        assert_eq!(engine.get_exercise_sets("local-r9").unwrap().len(), 3);
    }

    fn begun(engine: &PersistentEngine) {
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();
        engine
            .edit_live_strength_session(&LiveEdit::Begin, NOW)
            .unwrap();
    }

    fn beats(session: &StrengthSession) -> Vec<(i64, u8)> {
        session.heart_rate.iter().map(|r| (r.at, r.bpm)).collect()
    }

    #[test]
    fn readings_make_a_stream_with_its_average_and_maximum() {
        let (_dir, engine) = engine();
        begun(&engine);
        for (offset, bpm) in [(1, 100), (2, 110), (3, 130)] {
            engine.record_live_heart_rate(bpm, NOW + offset).unwrap();
        }

        let session = engine.live_strength_session().unwrap().unwrap();

        assert_eq!(
            beats(&session),
            vec![(NOW + 1, 100), (NOW + 2, 110), (NOW + 3, 130)]
        );
        assert_eq!(session.average_heart_rate(), Some(113));
        assert_eq!(session.max_heart_rate(), Some(130));
    }

    #[test]
    fn a_session_with_no_readings_has_no_heart_rate() {
        let (_dir, engine) = engine();
        begun(&engine);

        let session = engine.live_strength_session().unwrap().unwrap();

        assert!(session.heart_rate.is_empty());
        assert_eq!(session.average_heart_rate(), None);
        assert_eq!(session.max_heart_rate(), None);
    }

    #[test]
    fn a_pause_in_readings_leaves_a_gap_and_no_invented_values() {
        let (_dir, engine) = engine();
        begun(&engine);
        engine.record_live_heart_rate(90, NOW + 1).unwrap();
        engine.record_live_heart_rate(120, NOW + 600).unwrap();

        let session = engine.live_strength_session().unwrap().unwrap();

        assert_eq!(beats(&session), vec![(NOW + 1, 90), (NOW + 600, 120)]);
    }

    #[test]
    fn the_fit_writer_takes_the_readings_by_seconds_after_the_start() {
        let (_dir, engine) = engine();
        begun(&engine);
        engine.record_live_heart_rate(100, NOW + 5).unwrap();
        engine.record_live_heart_rate(110, NOW + 9).unwrap();

        let session = engine.live_strength_session().unwrap().unwrap();
        let written = crate::fit_strength::StrengthSession {
            start_unix: NOW,
            sets: Vec::new(),
            heart_rate: session.fit_heart_rate(),
            weight_unit: crate::strength::weight::WeightUnit::Kilogram,
        };
        let read: Vec<(u32, u8)> = written
            .heart_rate
            .iter()
            .map(|s| (s.offset_secs, s.bpm))
            .collect();

        assert_eq!(read, vec![(5, 100), (9, 110)]);
        assert!(!written.to_fit().is_empty());
    }

    #[test]
    fn a_reading_that_is_no_heart_rate_is_not_kept() {
        let (_dir, engine) = engine();
        begun(&engine);
        for bpm in [0, 5, 251, 255] {
            engine.record_live_heart_rate(bpm, NOW + 1).unwrap();
        }

        let session = engine.live_strength_session().unwrap().unwrap();

        assert!(session.heart_rate.is_empty());
    }

    #[test]
    fn a_second_reading_in_the_same_second_replaces_the_first() {
        let (_dir, engine) = engine();
        begun(&engine);
        engine.record_live_heart_rate(100, NOW + 1).unwrap();
        engine.record_live_heart_rate(104, NOW + 1).unwrap();

        let session = engine.live_strength_session().unwrap().unwrap();

        assert_eq!(beats(&session), vec![(NOW + 1, 104)]);
    }

    #[test]
    fn readings_before_the_session_begins_or_with_none_live_are_dropped() {
        let (_dir, engine) = engine();
        engine.record_live_heart_rate(100, NOW).unwrap();
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();
        engine.record_live_heart_rate(100, NOW + 1).unwrap();

        let session = engine.live_strength_session().unwrap().unwrap();

        assert!(session.heart_rate.is_empty());
    }

    #[test]
    fn edits_and_a_reopened_engine_keep_the_readings() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        {
            let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
            begun(&engine);
            engine.record_live_heart_rate(100, NOW + 1).unwrap();
            engine
                .edit_live_strength_session(&LiveEdit::StartRest, NOW + 2)
                .unwrap();
            engine.record_live_heart_rate(110, NOW + 3).unwrap();
        }
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        engine.load().unwrap();

        let session = engine.live_strength_session().unwrap().unwrap();

        assert_eq!(beats(&session), vec![(NOW + 1, 100), (NOW + 3, 110)]);
    }

    #[test]
    fn finishing_keeps_the_readings_and_discarding_removes_them() {
        let (_dir, engine) = engine();
        begun(&engine);
        engine.record_live_heart_rate(100, NOW + 1).unwrap();
        let finished = engine
            .finish_live_strength_session("local-r11", NOW + 60)
            .unwrap();
        assert_eq!(finished.heart_rate.len(), 1);
        let stored = engine.get_strength_session(&finished.id).unwrap().unwrap();
        assert_eq!(stored.average_heart_rate(), Some(100));

        begun(&engine);
        engine.record_live_heart_rate(120, NOW + 1).unwrap();
        engine.discard_live_strength_session().unwrap();
        let rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM strength_session_heart_rate WHERE session_id <> ?1",
                [&finished.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
    }

    fn plan(lines: &[&str]) -> StartFrom {
        StartFrom::Plan(lines.iter().map(|line| line.to_string()).collect())
    }

    #[test]
    fn a_plan_starts_a_session_with_its_read_exercises_and_the_rest_as_notes() {
        let (_dir, engine) = engine();
        let session = engine
            .start_live_strength_session(
                &plan(&["Bench 18.5kg per hand 12/10/8", "Mobility 10 min"]),
                NOW,
            )
            .unwrap();

        assert_eq!(session.exercises.len(), 1);
        let bench = &session.exercises[0];
        let planned: Vec<_> = bench
            .sets
            .iter()
            .map(|s| (s.planned_reps, s.planned_weight_kg, s.done))
            .collect();
        assert_eq!(
            planned,
            [
                (Some(12), Some(18.5), false),
                (Some(10), Some(18.5), false),
                (Some(8), Some(18.5), false)
            ]
        );
        assert_eq!(session.notes, ["Mobility 10 min"]);
        assert!(session.preparing());
        assert_eq!(position(&session), Some((0, 0)));

        let stored = engine.live_strength_session().unwrap().unwrap();
        assert_eq!(stored, session);
    }

    #[test]
    fn a_rest_line_is_the_rest_after_the_exercise_before_it() {
        let (_dir, engine) = engine();
        let session = engine
            .start_live_strength_session(
                &plan(&[
                    "Rest 60 sec",
                    "Bench 18.5kg per hand 12/10/8",
                    "Rest 90 sec",
                ]),
                NOW,
            )
            .unwrap();
        assert_eq!(session.exercises.len(), 1);
        assert_eq!(session.exercises[0].rest_secs, Some(90));
        // A rest with nothing before it to follow stays as the plan wrote it.
        assert_eq!(session.notes, ["Rest 60 sec"]);
    }

    #[test]
    fn an_exercise_named_without_sets_takes_its_sets_from_last_time() {
        let (_dir, engine) = engine();
        let crate::strength::plan_line::PlanLineReading::Exercise(named) =
            crate::strength::plan_line::read_line("Goblet squat")
        else {
            panic!("the exercise is in the catalogue");
        };
        let named = (named.category, named.name);
        watch_session(
            &engine,
            "earlier",
            NOW - 3 * DAY,
            &[
                library_set(0, named, 10, 40.0),
                library_set(1, named, 8, 42.5),
            ],
        );
        let session = engine
            .start_live_strength_session(&plan(&["Goblet squat"]), NOW)
            .unwrap();
        let values: Vec<_> = session.exercises[0]
            .sets
            .iter()
            .map(|s| (s.planned_reps, s.planned_weight_kg))
            .collect();
        assert_eq!(values, [(Some(10), Some(40.0)), (Some(8), Some(42.5))]);
    }

    #[test]
    fn a_plan_with_nothing_read_is_all_notes_and_blank_lines_are_dropped() {
        let (_dir, engine) = engine();
        let session = engine
            .start_live_strength_session(&plan(&["  ", "Warm up well", "", "Stretch"]), NOW)
            .unwrap();
        assert!(session.exercises.is_empty());
        assert_eq!(session.notes, ["Warm up well", "Stretch"]);
    }

    #[test]
    fn notes_survive_finishing_and_a_copy_starts_without_them() {
        let (_dir, engine) = engine();
        engine
            .start_live_strength_session(&plan(&["Goblet squat 20kg 3x5", "Foam roll after"]), NOW)
            .unwrap();
        let finished = engine
            .finish_live_strength_session("local-r12", NOW + 60)
            .unwrap();
        let stored = engine.get_strength_session(&finished.id).unwrap().unwrap();
        assert_eq!(stored.notes, ["Foam roll after"]);

        let copy = engine
            .start_live_strength_session(&StartFrom::Session(finished.id.clone()), NOW + 120)
            .unwrap();
        assert!(copy.notes.is_empty());
    }
}
