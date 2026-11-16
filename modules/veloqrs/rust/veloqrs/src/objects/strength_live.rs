//! The strength recorder's FFI surface: the start screen's read, the live
//! session's read, and the one write that changes it.
//!
//! The recorder keeps none of the session. Every call answers the session as
//! the engine holds it, and an edit is one transaction in
//! `persistence::strength_live`, so a phone and a linked browser that edit at
//! once each see the other's change whole or not at all.

use super::error::{VeloqError, with_engine, with_reader};
use super::strength::StrengthManager;
use crate::persistence::PersistentEngine;
use crate::persistence::strength_focus::FocusState;
use crate::persistence::strength_live::{LiveEdit, LiveError, LiveOutcome, StartFrom, read_live};
use crate::persistence::strength_saved::saved_workouts;
use crate::persistence::strength_sessions::StrengthSession;
use crate::persistence::strength_sessions::{athlete_weight_unit_on, strength_session_fit_on};
use crate::persistence::strength_signature::exercises_of;
use crate::persistence::strength_signature::{RECENT_GROUP_LIMIT, recent};
use crate::strength::catalogue;
use crate::strength::weight::{WeightUnit, display_weight, stored_weight_kg};
use crate::{
    FfiFocusState, FfiLiveEdit, FfiLiveEditKind, FfiLiveStrengthExercise, FfiLiveStrengthGroup,
    FfiLiveStrengthOutcome, FfiLiveStrengthSession, FfiLiveStrengthSet, FfiStrengthSavedWorkout,
    FfiStrengthStartData, FfiStrengthStartGroup, FfiStrengthStartKind,
};
use rusqlite::Connection;

const SECONDS_PER_DAY: i64 = 86_400;

fn database(error: impl std::fmt::Display) -> VeloqError {
    VeloqError::Database {
        msg: error.to_string(),
    }
}

impl From<LiveError> for VeloqError {
    fn from(error: LiveError) -> Self {
        match error {
            LiveError::NoLiveSession
            | LiveError::NoSuchExercise(_)
            | LiveError::NoSuchSet { .. }
            | LiveError::NoSuchSource(_) => VeloqError::NotFound {
                msg: error.to_string(),
            },
            LiveError::LiveSessionExists => VeloqError::Busy {
                msg: error.to_string(),
            },
            LiveError::Sql(msg) => VeloqError::Database { msg },
        }
    }
}

pub(crate) fn focus_to_ffi(state: FocusState) -> FfiFocusState {
    FfiFocusState {
        phase: state.phase,
        current: state.current,
        previous: state.previous,
        next: state.next,
        rest_started_at: state.rest_started_at.map(|at| at as f64),
        rest_secs: state.rest_secs,
        rest_ends_at: state.rest_ends_at.map(|at| at as f64),
    }
}

pub(crate) fn session_to_ffi(
    session: &StrengthSession,
    unit: WeightUnit,
) -> FfiLiveStrengthSession {
    FfiLiveStrengthSession {
        id: session.id.clone(),
        weight_unit: unit,
        begun: session.started_at.is_some(),
        started_at: session.started_at.map(|at| at as f64),
        exercises: session
            .exercises
            .iter()
            .map(|exercise| {
                let entry = exercise
                    .exercise_name
                    .and_then(|name| catalogue::lookup(exercise.exercise_category, name));
                FfiLiveStrengthExercise {
                    category: exercise.exercise_category,
                    name: exercise.exercise_name,
                    label_key: entry.map_or_else(String::new, |e| e.label_key.to_string()),
                    display_name: crate::fit::exercise_display_name(
                        exercise.exercise_category,
                        exercise.exercise_name,
                    ),
                    equipment: entry.map_or("other", |e| e.equipment.slug()).to_string(),
                    one_sided: entry.is_some_and(|e| e.one_sided),
                    group_no: exercise.group_no,
                    rest_secs: exercise.rest_secs,
                    sets: exercise
                        .sets
                        .iter()
                        .map(|set| FfiLiveStrengthSet {
                            reps: set.reps,
                            weight_kg: set.weight_kg,
                            display_weight: set.weight_kg.map(|kg| display_weight(kg, unit)),
                            duration_secs: set.duration_secs,
                            side: set.side.clone(),
                            warm_up: set.warm_up,
                            done: set.done,
                        })
                        .collect(),
                }
            })
            .collect(),
        groups: session
            .groups
            .iter()
            .map(|group| FfiLiveStrengthGroup {
                group_no: group.group_no,
                rest_secs: group.rest_secs,
            })
            .collect(),
        current_exercise: session.current_exercise,
        current_set: session.current_set,
        rest_started_at: session.rest_started_at.map(|at| at as f64),
        notes: session.notes.clone(),
    }
}

fn outcome_to_ffi(outcome: LiveOutcome, unit: WeightUnit) -> FfiLiveStrengthOutcome {
    FfiLiveStrengthOutcome {
        session: session_to_ffi(&outcome.session, unit),
        prefilled_days_ago: outcome.prefilled_days_ago,
    }
}

fn missing(kind: FfiLiveEditKind, field: &str) -> VeloqError {
    VeloqError::ParseError {
        msg: format!("a {kind:?} edit needs {field}"),
    }
}

fn whole(kind: FfiLiveEditKind, field: &str, value: Option<f64>) -> Result<i32, VeloqError> {
    let value = value.ok_or_else(|| missing(kind, field))?;
    if value.fract() == 0.0 && value.abs() <= f64::from(i32::MAX) {
        Ok(value as i32)
    } else {
        Err(VeloqError::ParseError {
            msg: format!("a {kind:?} edit needs a whole number for {field}"),
        })
    }
}

fn reps_or_secs(kind: FfiLiveEditKind, value: Option<f64>) -> Result<Option<u32>, VeloqError> {
    value
        .map(|_| {
            u32::try_from(whole(kind, "a value", value)?).map_err(|_| VeloqError::ParseError {
                msg: format!("a {kind:?} edit needs a value of zero or more"),
            })
        })
        .transpose()
}

/// The change an edit record asks for, or the field it lacks.
fn live_edit(edit: &FfiLiveEdit, unit: WeightUnit) -> Result<LiveEdit, VeloqError> {
    use FfiLiveEditKind as Kind;
    let kind = edit.kind;
    let exercise = || edit.exercise.ok_or_else(|| missing(kind, "an exercise"));
    let set = || edit.set.ok_or_else(|| missing(kind, "a set"));
    let direction = || whole(kind, "a direction", edit.value);
    Ok(match kind {
        Kind::Begin => LiveEdit::Begin,
        Kind::AddExercise => LiveEdit::AddExercise {
            category: edit
                .category
                .and_then(|category| u16::try_from(category).ok())
                .ok_or_else(|| missing(kind, "a category"))?,
            name: edit.name.and_then(|name| u16::try_from(name).ok()),
        },
        Kind::RemoveExercise => LiveEdit::RemoveExercise {
            exercise: exercise()?,
        },
        Kind::MoveExercise => LiveEdit::MoveExercise {
            from: exercise()?,
            to: edit.to.ok_or_else(|| missing(kind, "a place to move to"))?,
        },
        Kind::Group => LiveEdit::Group {
            exercise: exercise()?,
            onto: edit
                .to
                .ok_or_else(|| missing(kind, "an exercise to join"))?,
        },
        Kind::Ungroup => LiveEdit::Ungroup {
            exercise: exercise()?,
        },
        Kind::ExerciseRest => LiveEdit::ExerciseRest {
            exercise: exercise()?,
            secs: reps_or_secs(kind, edit.value)?,
        },
        Kind::GroupRest => LiveEdit::GroupRest {
            group_no: edit.group_no.ok_or_else(|| missing(kind, "a group"))?,
            secs: reps_or_secs(kind, edit.value)?,
        },
        Kind::AddSet => LiveEdit::AddSet {
            exercise: exercise()?,
            after: edit.set,
        },
        Kind::RemoveSet => LiveEdit::RemoveSet {
            exercise: exercise()?,
            set: set()?,
        },
        Kind::StepReps => LiveEdit::StepReps {
            exercise: exercise()?,
            set: set()?,
            direction: direction()?,
        },
        Kind::StepWeight => LiveEdit::StepWeight {
            exercise: exercise()?,
            set: set()?,
            direction: direction()?,
            unit,
        },
        Kind::StepDuration => LiveEdit::StepDuration {
            exercise: exercise()?,
            set: set()?,
            direction: direction()?,
        },
        Kind::SetReps => LiveEdit::SetReps {
            exercise: exercise()?,
            set: set()?,
            value: reps_or_secs(kind, edit.value)?,
        },
        Kind::SetWeight => LiveEdit::SetWeight {
            exercise: exercise()?,
            set: set()?,
            value: edit.value,
        },
        Kind::SetWeightEntered => LiveEdit::SetWeight {
            exercise: exercise()?,
            set: set()?,
            value: edit.value.map(|entered| stored_weight_kg(entered, unit)),
        },
        Kind::SetDuration => LiveEdit::SetDuration {
            exercise: exercise()?,
            set: set()?,
            value: edit.value,
        },
        Kind::SetSide => LiveEdit::SetSide {
            exercise: exercise()?,
            set: set()?,
            side: edit.text.clone(),
        },
        Kind::SetWarmUp => LiveEdit::SetWarmUp {
            exercise: exercise()?,
            set: set()?,
            warm_up: edit.flag.unwrap_or(false),
        },
        Kind::SelectSet => LiveEdit::SelectSet {
            exercise: exercise()?,
            set: set()?,
        },
        Kind::CompleteSet => LiveEdit::CompleteSet {
            exercise: exercise()?,
            set: set()?,
        },
        Kind::ReopenSet => LiveEdit::ReopenSet {
            exercise: exercise()?,
            set: set()?,
        },
        Kind::StartRest => LiveEdit::StartRest,
        Kind::EndRest => LiveEdit::EndRest,
    })
}

/// The start screen: whether a session is live, the sessions done the same way
/// before, newest first, and the saved workouts. One read on any connection.
pub(crate) fn start_data(conn: &Connection, now: i64) -> Result<FfiStrengthStartData, VeloqError> {
    let live = read_live(conn).map_err(database)?.is_some();
    let groups = recent(conn, RECENT_GROUP_LIMIT)
        .map_err(database)?
        .into_iter()
        .map(|group| FfiStrengthStartGroup {
            exercise_names: exercises_of(&group.signature)
                .map(|(category, name)| crate::fit::exercise_display_name(category, name))
                .collect(),
            signature: group.signature,
            times: group.times,
            last_done_days: ((now - group.last_done).max(0) / SECONDS_PER_DAY) as u32,
            latest_activity_id: group.latest_activity_id,
            muscles: group.muscles,
            equipment: group
                .equipment
                .iter()
                .map(|kind| kind.slug().to_string())
                .collect(),
        })
        .collect();
    let workouts = saved_workouts(conn)
        .map_err(database)?
        .into_iter()
        .map(|workout| FfiStrengthSavedWorkout {
            id: workout.id,
            name: workout.name,
            exercise_count: workout.exercise_count,
            set_count: workout.set_count,
        })
        .collect();
    Ok(FfiStrengthStartData {
        live,
        groups,
        workouts,
    })
}

/// One edit to the live session, weights read and entered in the athlete's unit.
pub(crate) fn edit_session(
    engine: &PersistentEngine,
    edit: &FfiLiveEdit,
    now: i64,
) -> Result<FfiLiveStrengthOutcome, VeloqError> {
    let unit = engine.athlete_weight_unit().map_err(database)?;
    let change = live_edit(edit, unit)?;
    engine
        .edit_live_strength_session(&change, now)
        .map(|outcome| outcome_to_ffi(outcome, unit))
        .map_err(VeloqError::from)
}

fn start_session(
    engine: &PersistentEngine,
    kind: FfiStrengthStartKind,
    id: Option<String>,
    now: i64,
) -> Result<FfiLiveStrengthSession, VeloqError> {
    let source = || {
        id.clone().ok_or_else(|| VeloqError::ParseError {
            msg: format!("a {kind:?} start needs an id"),
        })
    };
    let started =
        match kind {
            FfiStrengthStartKind::Blank => {
                engine.start_live_strength_session(&StartFrom::Blank, now)?
            }
            FfiStrengthStartKind::Session => {
                engine.start_live_strength_session(&StartFrom::Session(source()?), now)?
            }
            FfiStrengthStartKind::Activity => {
                engine.start_live_strength_session(&StartFrom::Activity(source()?), now)?
            }
            FfiStrengthStartKind::Workout => engine
                .start_strength_workout(&source()?, now)
                .map_err(|error| match error {
                    crate::persistence::strength_saved::SavedError::Live(live) => {
                        VeloqError::from(live)
                    }
                    other => VeloqError::NotFound {
                        msg: other.to_string(),
                    },
                })?,
        };
    Ok(session_to_ffi(
        &started,
        engine.athlete_weight_unit().map_err(database)?,
    ))
}

#[uniffi::export]
impl StrengthManager {
    /// What the strength start screen shows: whether a session is live, the
    /// sessions done the same way before with their muscles and equipment, and
    /// the saved workouts. `now` is epoch seconds.
    fn get_strength_start_data(&self, now: f64) -> Result<FfiStrengthStartData, VeloqError> {
        with_reader(|conn| start_data(conn, now as i64))?
    }

    /// The session being recorded, or none. A restarted app calls this to pick
    /// up where it was.
    fn get_live_strength_session(&self) -> Result<Option<FfiLiveStrengthSession>, VeloqError> {
        with_reader(|conn| {
            let unit = athlete_weight_unit_on(conn).map_err(database)?;
            read_live(conn)
                .map(|found| found.as_ref().map(|session| session_to_ffi(session, unit)))
                .map_err(database)
        })?
    }

    /// What the focus view and the lock screen show of the live session, weights in the
    /// athlete's unit, or none when no session is live.
    fn get_live_focus_state(&self) -> Result<Option<FfiFocusState>, VeloqError> {
        with_reader(|conn| {
            let unit = athlete_weight_unit_on(conn).map_err(database)?;
            read_live(conn)
                .map(|found| found.map(|session| focus_to_ffi(session.focus_state(unit))))
                .map_err(database)
        })?
    }

    /// The finished session's FIT file, weights displayed in the athlete's unit, or none for an
    /// id nothing holds.
    fn get_strength_session_fit(&self, id: String) -> Result<Option<Vec<u8>>, VeloqError> {
        with_reader(|conn| strength_session_fit_on(conn, &id).map_err(database))?
    }

    /// Start the live session from nothing, a session, a library activity or a
    /// saved workout, prepared with nothing done. Refused while one is live.
    fn start_live_strength_session(
        &self,
        kind: FfiStrengthStartKind,
        id: Option<String>,
        now: f64,
    ) -> Result<FfiLiveStrengthSession, VeloqError> {
        with_engine(|engine| start_session(engine, kind, id, now as i64))?
    }

    /// Start the live session from the lines of a planned workout: each line
    /// that reads as an exercise becomes one with its planned sets, a rest line
    /// sets the rest after the exercise before it, and any other line is kept
    /// as a session note. Refused while one is live.
    fn start_live_strength_session_from_plan(
        &self,
        lines: Vec<String>,
        now: f64,
    ) -> Result<FfiLiveStrengthSession, VeloqError> {
        with_engine(|engine| {
            let started =
                engine.start_live_strength_session(&StartFrom::Plan(lines), now as i64)?;
            Ok(session_to_ffi(
                &started,
                engine.athlete_weight_unit().map_err(database)?,
            ))
        })?
    }

    /// Make one change to the live session and answer it as it now stands. A
    /// refused change leaves the session as it was.
    fn edit_live_strength_session(
        &self,
        edit: FfiLiveEdit,
        now: f64,
    ) -> Result<FfiLiveStrengthOutcome, VeloqError> {
        with_engine(|engine| edit_session(engine, &edit, now as i64))?
    }

    /// Drop the live session and everything in it; the library is unchanged.
    fn discard_live_strength_session(&self) -> Result<(), VeloqError> {
        with_engine(|engine| engine.discard_live_strength_session().map_err(database))?
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

    fn engine() -> (TempDir, PersistentEngine) {
        let dir = TempDir::new().unwrap();
        let engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
        (dir, engine)
    }

    fn edit(kind: FfiLiveEditKind) -> FfiLiveEdit {
        FfiLiveEdit {
            kind,
            exercise: None,
            set: None,
            to: None,
            group_no: None,
            category: None,
            name: None,
            value: None,
            text: None,
            flag: None,
        }
    }

    fn logged(order: u32, exercise: (u16, u16), reps: u16, weight: f64) -> FitExerciseSet {
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

    #[test]
    fn an_edit_that_lacks_a_field_its_kind_reads_is_refused_naming_it() {
        let refused =
            live_edit(&edit(FfiLiveEditKind::StepWeight), WeightUnit::Kilogram).unwrap_err();
        assert!(
            matches!(&refused, VeloqError::ParseError { msg } if msg.contains("an exercise")),
            "{refused:?}"
        );

        let mut step = edit(FfiLiveEditKind::StepWeight);
        step.exercise = Some(0);
        step.set = Some(0);
        let refused = live_edit(&step, WeightUnit::Kilogram).unwrap_err();
        assert!(
            matches!(&refused, VeloqError::ParseError { msg } if msg.contains("a direction")),
            "{refused:?}"
        );
    }

    #[test]
    fn a_stepper_tap_edit_reaches_the_engine_as_a_step_with_its_direction() {
        let mut step = edit(FfiLiveEditKind::StepReps);
        step.exercise = Some(1);
        step.set = Some(2);
        step.value = Some(-1.0);
        assert_eq!(
            live_edit(&step, WeightUnit::Kilogram).unwrap(),
            LiveEdit::StepReps {
                exercise: 1,
                set: 2,
                direction: -1
            }
        );
    }

    #[test]
    fn a_value_that_is_not_a_whole_count_is_refused() {
        let mut reps = edit(FfiLiveEditKind::SetReps);
        reps.exercise = Some(0);
        reps.set = Some(0);
        reps.value = Some(8.5);
        assert!(matches!(
            live_edit(&reps, WeightUnit::Kilogram),
            Err(VeloqError::ParseError { .. })
        ));
        reps.value = Some(-3.0);
        assert!(matches!(
            live_edit(&reps, WeightUnit::Kilogram),
            Err(VeloqError::ParseError { .. })
        ));
        reps.value = None;
        assert_eq!(
            live_edit(&reps, WeightUnit::Kilogram).unwrap(),
            LiveEdit::SetReps {
                exercise: 0,
                set: 0,
                value: None
            }
        );
    }

    #[test]
    fn the_start_screen_offers_past_groups_with_their_exercises_and_equipment() {
        let (_dir, engine) = engine();
        watch_session(
            &engine,
            "watch-1",
            NOW - 3 * DAY,
            &[logged(0, BENCH, 10, 40.0), logged(1, ROW, 12, 30.0)],
        );

        let data = start_data(&engine.db, NOW).unwrap();

        assert!(!data.live);
        assert_eq!(data.groups.len(), 1);
        let group = &data.groups[0];
        assert_eq!(group.latest_activity_id, "watch-1");
        assert_eq!(group.last_done_days, 3);
        assert_eq!(group.times, 1);
        assert_eq!(group.exercise_names.len(), 2);
        assert!(group.exercise_names[0].contains("Bench Press"));
        assert!(group.equipment.contains(&"barbell".to_string()));
        assert!(!group.muscles.is_empty());
        assert!(data.workouts.is_empty());
    }

    #[test]
    fn a_session_started_from_a_group_is_offered_back_as_live_and_edited_through_the_record() {
        let (_dir, engine) = engine();
        watch_session(
            &engine,
            "watch-1",
            NOW - DAY,
            &[
                logged(0, BENCH, 10, 40.0),
                logged(1, BENCH, 10, 40.0),
                logged(2, ROW, 12, 30.0),
            ],
        );

        let started = start_session(
            &engine,
            FfiStrengthStartKind::Activity,
            Some("watch-1".to_string()),
            NOW,
        )
        .unwrap();
        assert_eq!(started.exercises.len(), 2);
        assert_eq!(started.exercises[0].equipment, "barbell");
        assert_eq!(started.exercises[0].sets.len(), 2);
        assert!(!started.begun);
        assert!(start_data(&engine.db, NOW).unwrap().live);

        let mut plus = edit(FfiLiveEditKind::AddSet);
        plus.exercise = Some(0);
        plus.set = Some(0);
        let outcome = engine
            .edit_live_strength_session(&live_edit(&plus, WeightUnit::Kilogram).unwrap(), NOW)
            .map(|outcome| outcome_to_ffi(outcome, WeightUnit::Kilogram))
            .unwrap();
        assert_eq!(outcome.session.exercises[0].sets.len(), 3);

        let mut step = edit(FfiLiveEditKind::StepWeight);
        step.exercise = Some(0);
        step.set = Some(0);
        step.value = Some(-1.0);
        let outcome = engine
            .edit_live_strength_session(&live_edit(&step, WeightUnit::Kilogram).unwrap(), NOW)
            .map(|outcome| outcome_to_ffi(outcome, WeightUnit::Kilogram))
            .unwrap();
        let weights: Vec<_> = outcome.session.exercises[0]
            .sets
            .iter()
            .map(|set| set.weight_kg)
            .collect();
        assert_eq!(weights, [Some(37.5), Some(37.5), Some(37.5)]);
    }

    #[test]
    fn a_pound_athlete_steps_enters_and_reads_weight_in_pounds() {
        let (_dir, engine) = engine();
        watch_session(
            &engine,
            "watch-1",
            NOW - DAY,
            &[logged(0, BENCH, 10, 40.0), logged(1, BENCH, 10, 40.0)],
        );
        engine
            .set_setting("veloq-resolved-unit-system", "imperial")
            .unwrap();
        let started = start_session(
            &engine,
            FfiStrengthStartKind::Activity,
            Some("watch-1".to_string()),
            NOW,
        )
        .unwrap();
        assert_eq!(started.weight_unit, WeightUnit::Pound);
        assert_eq!(started.exercises[0].sets[0].display_weight, Some(88.2));

        let focus = engine.live_focus_state().unwrap().unwrap();
        let current = focus.current.unwrap();
        assert_eq!(current.display_weight, Some(88.2));
        assert_eq!(current.weight_step, 5.0);
        assert_eq!(
            current.weight_up_kg,
            stored_weight_kg(93.2, WeightUnit::Pound)
        );

        let mut step = edit(FfiLiveEditKind::StepWeight);
        step.exercise = Some(0);
        step.set = Some(0);
        step.value = Some(1.0);
        let stepped = edit_session(&engine, &step, NOW).unwrap();
        let set = &stepped.session.exercises[0].sets[0];
        assert_eq!(set.display_weight, Some(93.2));
        assert_eq!(
            set.weight_kg,
            Some(stored_weight_kg(93.2, WeightUnit::Pound))
        );

        let mut entered = edit(FfiLiveEditKind::SetWeightEntered);
        entered.exercise = Some(0);
        entered.set = Some(0);
        entered.value = Some(135.0);
        let typed = edit_session(&engine, &entered, NOW).unwrap();
        let set = &typed.session.exercises[0].sets[0];
        assert_eq!(set.display_weight, Some(135.0));
        assert!((set.weight_kg.unwrap() - 61.234_9).abs() < 1e-3);

        engine
            .set_setting("veloq-resolved-unit-system", "metric")
            .unwrap();
        let metric = edit_session(&engine, &entered, NOW).unwrap();
        assert_eq!(metric.session.weight_unit, WeightUnit::Kilogram);
        assert_eq!(metric.session.exercises[0].sets[0].weight_kg, Some(135.0));
    }

    #[test]
    fn a_start_that_needs_an_id_and_has_none_is_refused() {
        let (_dir, engine) = engine();
        assert!(matches!(
            start_session(&engine, FfiStrengthStartKind::Activity, None, NOW),
            Err(VeloqError::ParseError { .. })
        ));
        assert!(engine.live_strength_session().unwrap().is_none());
    }

    #[test]
    fn a_second_start_while_one_is_live_is_busy_and_an_unknown_source_is_not_found() {
        let (_dir, engine) = engine();
        assert!(matches!(
            start_session(
                &engine,
                FfiStrengthStartKind::Activity,
                Some("nope".to_string()),
                NOW
            ),
            Err(VeloqError::NotFound { .. })
        ));
        start_session(&engine, FfiStrengthStartKind::Blank, None, NOW).unwrap();
        assert!(matches!(
            start_session(&engine, FfiStrengthStartKind::Blank, None, NOW + 1),
            Err(VeloqError::Busy { .. })
        ));
    }
}
