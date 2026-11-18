//! Named strength workouts the athlete saved to start from again.
//!
//! A saved workout is a [`StrengthSession`] of kind `saved`: its exercises in
//! order, planned sets, groups and rest, with a name and nothing done. It is
//! made from a finished session or from the session being prepared, and
//! starting it copies it into a new live session, so training never changes
//! the saved rows. The list is ordered by when each was last started.

use std::fmt;

use rusqlite::{Connection, Result as SqlResult};

use super::PersistentEngine;
use super::climb_bests::in_write_txn;
use super::strength_live::{LiveError, StartFrom, prepared_from};
use super::strength_sessions::{
    SESSION_TABLES, SessionExercise, SessionGroup, SessionKind, SessionSet, StrengthSession,
    read_session,
};

/// Why a saved-workout call did nothing.
#[derive(Debug, PartialEq)]
pub enum SavedError {
    /// The name is empty once trimmed.
    EmptyName,
    /// No session with this id exists to save from.
    NoSuchSource(String),
    /// No saved workout has this id.
    NoSuchWorkout(String),
    /// A session already holds the id a restore would give back.
    WorkoutExists(String),
    /// An exercise names a catalogue name the catalogue does not hold.
    UnknownExercise {
        category: u16,
        name: u16,
    },
    /// Starting it was refused.
    Live(LiveError),
    Sql(String),
}

impl fmt::Display for SavedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SavedError::EmptyName => write!(f, "a saved workout needs a name"),
            SavedError::NoSuchSource(id) => write!(f, "no session {id} to save"),
            SavedError::NoSuchWorkout(id) => write!(f, "no saved workout {id}"),
            SavedError::WorkoutExists(id) => write!(f, "{id} is already in use"),
            SavedError::UnknownExercise { category, name } => {
                write!(f, "no exercise {category}.{name} in the catalogue")
            }
            SavedError::Live(error) => write!(f, "{error}"),
            SavedError::Sql(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for SavedError {}

impl From<rusqlite::Error> for SavedError {
    fn from(error: rusqlite::Error) -> Self {
        SavedError::Sql(error.to_string())
    }
}

/// A saved workout as the start screen lists it.
#[derive(Debug, Clone, PartialEq)]
pub struct SavedWorkout {
    pub id: String,
    pub name: String,
    pub exercise_count: u32,
    pub set_count: u32,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
}

/// What a delete took, for the confirmation that names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemovedWorkout {
    pub exercise_count: u32,
    pub set_count: u32,
}

fn clean_name(name: &str) -> Result<&str, SavedError> {
    let name = name.trim();
    if name.is_empty() {
        Err(SavedError::EmptyName)
    } else {
        Ok(name)
    }
}

/// A set as a planned set: its values are what the athlete means to do.
fn planned_set(set: SessionSet) -> SessionSet {
    SessionSet {
        reps: set.reps,
        weight_kg: set.weight_kg,
        duration_secs: set.duration_secs,
        side: set.side,
        warm_up: set.warm_up,
        planned_reps: set.reps,
        planned_weight_kg: set.weight_kg,
        planned_duration_secs: set.duration_secs,
        done: false,
        done_at: None,
    }
}

/// Refuse an exercise whose catalogue name the catalogue does not hold.
fn known_exercises(exercises: &[SessionExercise]) -> Result<(), SavedError> {
    for exercise in exercises {
        if let Some(exercise_name) = exercise.exercise_name
            && crate::strength::catalogue::lookup(exercise.exercise_category, exercise_name)
                .is_none()
        {
            return Err(SavedError::UnknownExercise {
                category: exercise.exercise_category,
                name: exercise_name,
            });
        }
    }
    Ok(())
}

/// A saved workout from a builder's exercises and groups: every set planned,
/// and only the groups some exercise belongs to.
fn drafted_workout(
    id: String,
    name: &str,
    created_at: i64,
    last_used_at: Option<i64>,
    exercises: Vec<SessionExercise>,
    groups: Vec<SessionGroup>,
) -> StrengthSession {
    let exercises: Vec<SessionExercise> = exercises
        .into_iter()
        .map(|exercise| SessionExercise {
            sets: exercise.sets.into_iter().map(planned_set).collect(),
            ..exercise
        })
        .collect();
    let mut kept_groups: Vec<SessionGroup> = Vec::new();
    for exercise in &exercises {
        let Some(group_no) = exercise.group_no else {
            continue;
        };
        if kept_groups.iter().any(|group| group.group_no == group_no) {
            continue;
        }
        let rest_secs = groups
            .iter()
            .find(|group| group.group_no == group_no)
            .and_then(|group| group.rest_secs);
        kept_groups.push(SessionGroup {
            group_no,
            rest_secs,
        });
    }
    StrengthSession {
        id,
        kind: SessionKind::Saved,
        name: Some(name.to_string()),
        activity_key: None,
        intervals_id: None,
        started_at: None,
        ended_at: None,
        last_used_at,
        created_at,
        exercises,
        groups: kept_groups,
        rests: Vec::new(),
        current_exercise: None,
        current_set: None,
        rest_started_at: None,
        heart_rate: Vec::new(),
        notes: Vec::new(),
    }
}

/// The saved workouts on any connection, last started first, then the ones
/// never started, newest first, so a screen can read them on a pooled reader.
pub(crate) fn saved_workouts(conn: &Connection) -> SqlResult<Vec<SavedWorkout>> {
    workouts_of_kind(conn, SessionKind::Saved)
}

/// The removed workouts on any connection, in the order the saved ones list.
pub(crate) fn removed_workouts(conn: &Connection) -> SqlResult<Vec<SavedWorkout>> {
    workouts_of_kind(conn, SessionKind::Removed)
}

fn workouts_of_kind(conn: &Connection, kind: SessionKind) -> SqlResult<Vec<SavedWorkout>> {
    let mut statement = conn.prepare(
        "SELECT s.id, s.name, s.last_used_at, s.created_at,
                (SELECT count(*) FROM strength_session_exercises e
                  WHERE e.session_id = s.id),
                (SELECT count(*) FROM strength_session_sets t
                  WHERE t.session_id = s.id)
         FROM strength_sessions s
         WHERE s.kind = ?1
         ORDER BY s.last_used_at IS NULL, s.last_used_at DESC,
                  s.created_at DESC, s.id",
    )?;
    statement
        .query_map([kind.as_str()], |row| {
            Ok(SavedWorkout {
                id: row.get(0)?,
                name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                last_used_at: row.get(2)?,
                created_at: row.get(3)?,
                exercise_count: row.get(4)?,
                set_count: row.get(5)?,
            })
        })?
        .collect()
}

/// One saved workout as a connection reads it, or `None` for an id that is
/// absent or is a session of another kind.
pub(crate) fn saved_workout_of(conn: &Connection, id: &str) -> SqlResult<Option<StrengthSession>> {
    Ok(read_session(conn, id)?.filter(|found| found.kind == SessionKind::Saved))
}

impl PersistentEngine {
    fn saved_workout(&self, id: &str) -> Result<StrengthSession, SavedError> {
        match self.get_strength_session(id)? {
            Some(found) if found.kind == SessionKind::Saved => Ok(found),
            _ => Err(SavedError::NoSuchWorkout(id.to_string())),
        }
    }

    /// Save a copy of the session `source` (finished, live or saved) as a
    /// workout called `name`: every set a planned set, none done, no rest
    /// history. The source is not changed.
    pub fn save_strength_workout(
        &self,
        source: &str,
        name: &str,
        now: i64,
    ) -> Result<StrengthSession, SavedError> {
        let name = clean_name(name)?;
        in_write_txn(&self.db, |_| {
            let Some(found) = self.get_strength_session(source)? else {
                return Ok(Err(SavedError::NoSuchSource(source.to_string())));
            };
            let mut id = format!("saved-{now}");
            let mut attempt = 1;
            while self.get_strength_session(&id)?.is_some() {
                attempt += 1;
                id = format!("saved-{now}-{attempt}");
            }
            let mut workout = prepared_from(&found, id, now);
            workout.kind = SessionKind::Saved;
            workout.name = Some(name.to_string());
            workout.current_exercise = None;
            workout.current_set = None;
            self.save_strength_session(&workout)?;
            Ok(Ok(workout))
        })?
    }

    /// The saved workouts, last started first, then the ones never started,
    /// newest first.
    pub fn list_strength_workouts(&self) -> SqlResult<Vec<SavedWorkout>> {
        saved_workouts(&self.db)
    }

    /// Save a workout built outside a session, from its exercises and groups:
    /// every set a planned set, none done. With `id` it replaces that saved
    /// workout, keeping when it was made and last started; without, it is a
    /// new one. A session that is live is not touched.
    pub fn save_strength_draft(
        &self,
        id: Option<&str>,
        name: &str,
        exercises: Vec<SessionExercise>,
        groups: Vec<SessionGroup>,
        now: i64,
    ) -> Result<StrengthSession, SavedError> {
        let name = clean_name(name)?;
        known_exercises(&exercises)?;
        in_write_txn(&self.db, |_| {
            let (id, created_at, last_used_at) = match id {
                Some(id) => match self.saved_workout(id) {
                    Ok(kept) => (kept.id, kept.created_at, kept.last_used_at),
                    Err(error) => return Ok(Err(error)),
                },
                None => {
                    let mut id = format!("saved-{now}");
                    let mut attempt = 1;
                    while self.get_strength_session(&id)?.is_some() {
                        attempt += 1;
                        id = format!("saved-{now}-{attempt}");
                    }
                    (id, now, None)
                }
            };
            let workout = drafted_workout(id, name, created_at, last_used_at, exercises, groups);
            self.save_strength_session(&workout)?;
            Ok(Ok(workout))
        })?
    }

    /// Put back a saved workout that was deleted, under its old id and with
    /// the times it had, so it takes its old place in the list. Refused when
    /// any session already holds the id.
    pub fn restore_strength_workout(
        &self,
        id: &str,
        name: &str,
        exercises: Vec<SessionExercise>,
        groups: Vec<SessionGroup>,
        created_at: i64,
        last_used_at: Option<i64>,
    ) -> Result<StrengthSession, SavedError> {
        let name = clean_name(name)?;
        known_exercises(&exercises)?;
        in_write_txn(&self.db, |_| {
            match self.get_strength_session(id)? {
                Some(held) if held.kind == SessionKind::Removed => self.erase_session(id)?,
                Some(_) => return Ok(Err(SavedError::WorkoutExists(id.to_string()))),
                None => {}
            }
            let workout = drafted_workout(
                id.to_string(),
                name,
                created_at,
                last_used_at,
                exercises,
                groups,
            );
            self.save_strength_session(&workout)?;
            Ok(Ok(workout))
        })?
    }

    /// Start a live session from the saved workout, which stays as it was, and
    /// mark the workout used at `now`. Refused while a session is live.
    pub fn start_strength_workout(
        &self,
        id: &str,
        now: i64,
    ) -> Result<StrengthSession, SavedError> {
        in_write_txn(&self.db, |_| {
            let workout = match self.saved_workout(id) {
                Ok(workout) => workout,
                Err(error) => return Ok(Err(error)),
            };
            let live =
                match self.start_live_strength_session(&StartFrom::Session(id.to_string()), now) {
                    Ok(live) => live,
                    Err(error) => return Ok(Err(SavedError::Live(error))),
                };
            let mut used = workout;
            used.last_used_at = Some(now);
            self.save_strength_session(&used)?;
            Ok(Ok(live))
        })?
    }

    pub fn rename_strength_workout(&self, id: &str, name: &str) -> Result<(), SavedError> {
        let name = clean_name(name)?;
        in_write_txn(&self.db, |_| {
            let mut workout = match self.saved_workout(id) {
                Ok(workout) => workout,
                Err(error) => return Ok(Err(error)),
            };
            workout.name = Some(name.to_string());
            self.save_strength_session(&workout)?;
            Ok(Ok(()))
        })?
    }

    fn erase_session(&self, id: &str) -> SqlResult<()> {
        for table in &SESSION_TABLES[1..] {
            self.db
                .execute(&format!("DELETE FROM {table} WHERE session_id = ?1"), [id])?;
        }
        self.db
            .execute("DELETE FROM strength_sessions WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Delete one saved workout and nothing else. The rows stay, marked
    /// removed, so [`Self::recover_strength_workout`] brings it back.
    pub fn delete_strength_workout(&self, id: &str) -> Result<RemovedWorkout, SavedError> {
        in_write_txn(&self.db, |_| {
            let workout = match self.saved_workout(id) {
                Ok(workout) => workout,
                Err(error) => return Ok(Err(error)),
            };
            self.db.execute(
                "UPDATE strength_sessions SET kind = ?2 WHERE id = ?1",
                rusqlite::params![id, SessionKind::Removed.as_str()],
            )?;
            Ok(Ok(RemovedWorkout {
                exercise_count: workout.exercises.len() as u32,
                set_count: workout.exercises.iter().map(|e| e.sets.len() as u32).sum(),
            }))
        })?
    }

    /// The deleted workouts the phone can still recover, as the start screen
    /// lists saved ones.
    pub fn removed_strength_workouts(&self) -> Result<Vec<SavedWorkout>, SavedError> {
        Ok(removed_workouts(&self.db)?)
    }

    /// Bring a deleted workout back as it was, with its place in the list.
    pub fn recover_strength_workout(&self, id: &str) -> Result<(), SavedError> {
        in_write_txn(&self.db, |_| {
            match self.get_strength_session(id)? {
                Some(found) if found.kind == SessionKind::Removed => {}
                _ => return Ok(Err(SavedError::NoSuchWorkout(id.to_string()))),
            }
            self.db.execute(
                "UPDATE strength_sessions SET kind = ?2 WHERE id = ?1",
                rusqlite::params![id, SessionKind::Saved.as_str()],
            )?;
            Ok(Ok(()))
        })?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::record_backup::collect_record_payload;
    use crate::persistence::strength_live::LiveEdit;
    use crate::persistence::strength_sessions::{SessionExercise, SessionGroup, SessionSet};
    use tempfile::TempDir;

    const NOW: i64 = 1_800_000_000;

    fn open(dir: &TempDir, file: &str) -> PersistentEngine {
        PersistentEngine::new(dir.path().join(file).to_str().unwrap()).unwrap()
    }

    fn done(reps: u32, weight: f64) -> SessionSet {
        SessionSet {
            reps: Some(reps),
            weight_kg: Some(weight),
            done: true,
            done_at: Some(NOW),
            ..SessionSet::default()
        }
    }

    /// Squat then lunge grouped, a warm-up, a one-sided lunge, rest after both.
    fn finished(id: &str, key: &str) -> StrengthSession {
        StrengthSession {
            id: id.to_string(),
            kind: SessionKind::Finished,
            name: None,
            activity_key: Some(key.to_string()),
            intervals_id: None,
            started_at: Some(NOW - 3_000),
            ended_at: Some(NOW),
            last_used_at: Some(NOW),
            created_at: NOW - 3_000,
            exercises: vec![
                SessionExercise {
                    exercise_category: 28,
                    exercise_name: Some(1),
                    group_no: Some(1),
                    rest_secs: Some(60),
                    sets: vec![
                        SessionSet {
                            warm_up: true,
                            ..done(10, 20.0)
                        },
                        done(8, 80.0),
                        done(6, 85.0),
                    ],
                },
                SessionExercise {
                    exercise_category: 17,
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
            rests: Vec::new(),
            current_exercise: None,
            current_set: None,
            rest_started_at: None,
            heart_rate: Vec::new(),
            notes: Vec::new(),
        }
    }

    fn seeded(dir: &TempDir) -> PersistentEngine {
        let engine = open(dir, "a.db");
        engine
            .save_strength_session(&finished("done-1", "local-1"))
            .unwrap();
        engine
    }

    #[test]
    fn a_deleted_workout_is_recovered_on_the_phone_without_a_client_copy() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let saved = engine
            .save_strength_workout("done-1", "Leg day", NOW + 1)
            .unwrap();
        let before = engine.get_strength_session(&saved.id).unwrap().unwrap();
        engine.delete_strength_workout(&saved.id).unwrap();
        assert!(engine.list_strength_workouts().unwrap().is_empty());
        assert_eq!(engine.removed_strength_workouts().unwrap().len(), 1);

        engine.recover_strength_workout(&saved.id).unwrap();

        assert_eq!(
            engine.get_strength_session(&saved.id).unwrap().unwrap(),
            before
        );
        assert_eq!(engine.list_strength_workouts().unwrap().len(), 1);
        assert!(engine.removed_strength_workouts().unwrap().is_empty());
        assert_eq!(
            engine.recover_strength_workout(&saved.id).unwrap_err(),
            SavedError::NoSuchWorkout(saved.id.clone())
        );
    }

    #[test]
    fn a_client_copy_restores_over_a_removed_workout() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let saved = engine
            .save_strength_workout("done-1", "Leg day", NOW + 1)
            .unwrap();
        engine.delete_strength_workout(&saved.id).unwrap();
        engine
            .restore_strength_workout(
                &saved.id,
                "Leg day",
                saved.exercises.clone(),
                saved.groups.clone(),
                saved.created_at,
                saved.last_used_at,
            )
            .unwrap();
        assert_eq!(engine.list_strength_workouts().unwrap().len(), 1);
        assert!(engine.removed_strength_workouts().unwrap().is_empty());
    }

    #[test]
    fn a_deleted_workout_is_restored_under_its_id_with_its_times() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let saved = engine
            .save_strength_workout("done-1", "Leg day", NOW + 1)
            .unwrap();
        engine.start_strength_workout(&saved.id, NOW + 5).unwrap();
        let before = engine.get_strength_session(&saved.id).unwrap().unwrap();
        engine.delete_strength_workout(&saved.id).unwrap();
        assert!(engine.list_strength_workouts().unwrap().is_empty());

        let back = engine
            .restore_strength_workout(
                &before.id,
                &before.name.clone().unwrap(),
                before.exercises.clone(),
                before.groups.clone(),
                before.created_at,
                before.last_used_at,
            )
            .unwrap();

        assert_eq!(back.id, saved.id);
        let kept = engine.get_strength_session(&saved.id).unwrap().unwrap();
        assert_eq!(kept, before);
        assert_eq!(engine.list_strength_workouts().unwrap().len(), 1);
    }

    #[test]
    fn restoring_over_a_held_id_or_with_an_empty_name_changes_nothing() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let saved = engine
            .save_strength_workout("done-1", "Leg day", NOW + 1)
            .unwrap();
        let held =
            engine.restore_strength_workout(&saved.id, "Other", Vec::new(), Vec::new(), NOW, None);
        assert_eq!(held, Err(SavedError::WorkoutExists(saved.id.clone())));
        let unnamed =
            engine.restore_strength_workout("saved-x", "  ", Vec::new(), Vec::new(), NOW, None);
        assert_eq!(unnamed, Err(SavedError::EmptyName));
        let unknown = engine.restore_strength_workout(
            "saved-x",
            "X",
            vec![SessionExercise {
                exercise_category: 28,
                exercise_name: Some(u16::MAX),
                group_no: None,
                rest_secs: None,
                sets: Vec::new(),
            }],
            Vec::new(),
            NOW,
            None,
        );
        assert!(matches!(unknown, Err(SavedError::UnknownExercise { .. })));
        assert_eq!(engine.list_strength_workouts().unwrap().len(), 1);
        assert_eq!(
            engine
                .get_strength_session(&saved.id)
                .unwrap()
                .unwrap()
                .name,
            Some("Leg day".to_string())
        );
    }

    #[test]
    fn saving_a_finished_session_keeps_exercises_sets_groups_and_rest_as_plans() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);

        let saved = engine
            .save_strength_workout("done-1", "  Leg day ", NOW + 1)
            .unwrap();

        assert_eq!(saved.kind, SessionKind::Saved);
        assert_eq!(saved.name.as_deref(), Some("Leg day"));
        assert_eq!(saved.activity_key, None);
        assert_eq!(saved.groups, finished("x", "y").groups);
        assert_eq!(saved.exercises.len(), 2);
        assert_eq!(saved.exercises[0].rest_secs, Some(60));
        assert_eq!(saved.exercises[0].group_no, Some(1));
        let squat = &saved.exercises[0].sets;
        assert_eq!(squat.len(), 3);
        assert!(squat[0].warm_up);
        assert_eq!(squat[1].planned_reps, Some(8));
        assert_eq!(squat[1].planned_weight_kg, Some(80.0));
        assert!(squat.iter().all(|s| !s.done && s.done_at.is_none()));
        assert_eq!(saved.exercises[1].sets[0].side.as_deref(), Some("left"));
        assert_eq!(engine.get_strength_session(&saved.id).unwrap(), Some(saved));
        // The recording it came from is untouched.
        assert_eq!(
            engine.get_strength_session("done-1").unwrap(),
            Some(finished("done-1", "local-1"))
        );
    }

    #[test]
    fn a_saved_workout_adds_nothing_to_the_library() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let count = |engine: &PersistentEngine| -> i64 {
            engine
                .db
                .query_row("SELECT count(*) FROM exercise_sets", [], |r| r.get(0))
                .unwrap()
        };
        let before = count(&engine);

        engine
            .save_strength_workout("done-1", "Leg day", NOW)
            .unwrap();

        assert_eq!(count(&engine), before);
    }

    #[test]
    fn the_session_being_prepared_can_be_saved_by_name() {
        let dir = TempDir::new().unwrap();
        let engine = open(&dir, "a.db");
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW)
            .unwrap();
        engine
            .edit_live_strength_session(
                &LiveEdit::AddExercise {
                    category: 0,
                    name: Some(1),
                },
                NOW,
            )
            .unwrap();
        let live = engine.live_strength_session().unwrap().unwrap();

        let saved = engine
            .save_strength_workout(&live.id, "Bench", NOW + 1)
            .unwrap();

        assert_eq!(saved.exercises.len(), 1);
        assert_eq!(
            engine.live_strength_session().unwrap().unwrap().kind,
            SessionKind::Live
        );
    }

    #[test]
    fn saving_refuses_a_blank_name_and_an_unknown_source() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        assert_eq!(
            engine
                .save_strength_workout("done-1", "   ", NOW)
                .unwrap_err(),
            SavedError::EmptyName
        );
        assert_eq!(
            engine
                .save_strength_workout("nothing", "Leg", NOW)
                .unwrap_err(),
            SavedError::NoSuchSource("nothing".to_string())
        );
        assert!(engine.list_strength_workouts().unwrap().is_empty());
    }

    #[test]
    fn two_saves_in_one_second_get_different_ids() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let a = engine.save_strength_workout("done-1", "A", NOW).unwrap();
        let b = engine.save_strength_workout("done-1", "B", NOW).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(engine.list_strength_workouts().unwrap().len(), 2);
    }

    #[test]
    fn editing_a_started_workout_leaves_the_saved_one_unchanged() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let saved = engine
            .save_strength_workout("done-1", "Leg day", NOW)
            .unwrap();

        let live = engine.start_strength_workout(&saved.id, NOW + 10).unwrap();
        assert_eq!(live.kind, SessionKind::Live);
        assert_ne!(live.id, saved.id);
        assert!(live.exercises[0].sets.iter().all(|s| !s.done));
        engine
            .edit_live_strength_session(&LiveEdit::Begin, NOW + 11)
            .unwrap();
        engine
            .edit_live_strength_session(&LiveEdit::RemoveExercise { exercise: 1 }, NOW + 12)
            .unwrap();
        engine
            .edit_live_strength_session(
                &LiveEdit::SetReps {
                    exercise: 0,
                    set: 1,
                    value: Some(3),
                },
                NOW + 13,
            )
            .unwrap();
        engine
            .edit_live_strength_session(
                &LiveEdit::CompleteSet {
                    exercise: 0,
                    set: 1,
                },
                NOW + 14,
            )
            .unwrap();

        let mut expected = saved.clone();
        expected.last_used_at = Some(NOW + 10);
        assert_eq!(
            engine.get_strength_session(&saved.id).unwrap(),
            Some(expected)
        );
    }

    #[test]
    fn starting_is_refused_while_a_session_is_live_and_for_a_recording() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let saved = engine
            .save_strength_workout("done-1", "Leg day", NOW)
            .unwrap();
        assert_eq!(
            engine.start_strength_workout("done-1", NOW).unwrap_err(),
            SavedError::NoSuchWorkout("done-1".to_string())
        );
        engine.start_strength_workout(&saved.id, NOW + 1).unwrap();
        assert_eq!(
            engine
                .start_strength_workout(&saved.id, NOW + 2)
                .unwrap_err(),
            SavedError::Live(LiveError::LiveSessionExists)
        );
        // A refused start does not count as a use.
        let listed = engine.list_strength_workouts().unwrap();
        assert_eq!(listed[0].last_used_at, Some(NOW + 1));
    }

    #[test]
    fn the_list_orders_by_last_started_then_never_started_newest_first() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let a = engine.save_strength_workout("done-1", "A", NOW).unwrap();
        let b = engine
            .save_strength_workout("done-1", "B", NOW + 1)
            .unwrap();
        let c = engine
            .save_strength_workout("done-1", "C", NOW + 2)
            .unwrap();
        let d = engine
            .save_strength_workout("done-1", "D", NOW + 3)
            .unwrap();

        engine.start_strength_workout(&a.id, NOW + 100).unwrap();
        engine.discard_live_strength_session().unwrap();
        engine.start_strength_workout(&c.id, NOW + 200).unwrap();
        engine.discard_live_strength_session().unwrap();

        let order: Vec<String> = engine
            .list_strength_workouts()
            .unwrap()
            .into_iter()
            .map(|w| w.id)
            .collect();
        assert_eq!(order, [c.id, a.id, d.id, b.id]);
    }

    #[test]
    fn the_list_counts_exercises_and_sets_and_holds_only_workouts() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        assert!(engine.list_strength_workouts().unwrap().is_empty());
        engine
            .save_strength_workout("done-1", "Leg day", NOW)
            .unwrap();
        engine
            .start_live_strength_session(&StartFrom::Blank, NOW + 5)
            .unwrap();

        let listed = engine.list_strength_workouts().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Leg day");
        assert_eq!(listed[0].exercise_count, 2);
        assert_eq!(listed[0].set_count, 4);
        assert_eq!(listed[0].last_used_at, None);
    }

    #[test]
    fn renaming_changes_the_name_only_and_refuses_blank_or_unknown() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let saved = engine
            .save_strength_workout("done-1", "Leg day", NOW)
            .unwrap();

        engine
            .rename_strength_workout(&saved.id, " Lower body ")
            .unwrap();
        let mut expected = saved.clone();
        expected.name = Some("Lower body".to_string());
        assert_eq!(
            engine.get_strength_session(&saved.id).unwrap(),
            Some(expected)
        );
        assert_eq!(
            engine.rename_strength_workout(&saved.id, "").unwrap_err(),
            SavedError::EmptyName
        );
        assert_eq!(
            engine
                .rename_strength_workout("done-1", "Nope")
                .unwrap_err(),
            SavedError::NoSuchWorkout("done-1".to_string())
        );
        assert_eq!(
            engine.get_strength_session("done-1").unwrap().unwrap().name,
            None
        );
    }

    #[test]
    fn deleting_removes_only_that_workout_and_says_what_it_held() {
        let dir = TempDir::new().unwrap();
        let engine = seeded(&dir);
        let a = engine.save_strength_workout("done-1", "A", NOW).unwrap();
        let b = engine
            .save_strength_workout("done-1", "B", NOW + 1)
            .unwrap();

        let removed = engine.delete_strength_workout(&a.id).unwrap();

        assert_eq!(
            removed,
            RemovedWorkout {
                exercise_count: 2,
                set_count: 4
            }
        );
        assert_eq!(
            engine.get_strength_session(&a.id).unwrap().unwrap().kind,
            SessionKind::Removed
        );
        assert_eq!(engine.list_strength_workouts().unwrap().len(), 1);
        assert_eq!(engine.get_strength_session(&b.id).unwrap(), Some(b));
        assert_eq!(
            engine.get_strength_session("done-1").unwrap(),
            Some(finished("done-1", "local-1"))
        );
        assert_eq!(
            engine.delete_strength_workout("done-1").unwrap_err(),
            SavedError::NoSuchWorkout("done-1".to_string())
        );
        assert_eq!(
            engine.delete_strength_workout(&a.id).unwrap_err(),
            SavedError::NoSuchWorkout(a.id.clone())
        );
    }

    #[test]
    fn a_backup_round_trip_keeps_saved_workouts() {
        let dir = TempDir::new().unwrap();
        let from = seeded(&dir);
        let saved = from
            .save_strength_workout("done-1", "Leg day", NOW)
            .unwrap();
        from.start_strength_workout(&saved.id, NOW + 9).unwrap();
        from.discard_live_strength_session().unwrap();
        let payload = collect_record_payload(&from.db).unwrap();

        let mut to = open(&dir, "b.db");
        to.restore_record_json(&serde_json::to_string(&payload).unwrap())
            .unwrap();

        let listed = to.list_strength_workouts().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].last_used_at, Some(NOW + 9));
        let mut expected = saved;
        expected.last_used_at = Some(NOW + 9);
        assert_eq!(
            to.get_strength_session(&expected.id).unwrap(),
            Some(expected)
        );
    }
}
