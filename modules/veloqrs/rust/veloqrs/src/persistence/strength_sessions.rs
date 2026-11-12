//! Strength sessions recorded on the phone, and the workouts the athlete saved.
//!
//! A session recorded here has no other source until its upload lands, and the
//! side and groups on it never reach intervals.icu. So its tables are the
//! athlete's own (`persistence::tables`): a backup carries them and a
//! derived-data clear leaves them.
//!
//! `exercise_sets` is where every strength screen reads, and it holds sets as
//! a FIT file gave them. A finished session writes its done working sets there
//! under the key of the ride its recording made, so the screens see them at
//! once, and that key is the session's claim on them: a FIT import for a
//! claimed key stores nothing, and a clear leaves the rows.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

use super::PersistentEngine;
use super::climb_bests::in_write_txn;
use super::strength::{FitOutcome, write_fit_outcome};
use crate::fit::FitExerciseSet;

/// The tables a session lives in, parent first, as a record backup carries them.
pub(crate) const SESSION_TABLES: &[&str] = &[
    "strength_sessions",
    "strength_session_exercises",
    "strength_session_sets",
    "strength_session_groups",
    "strength_session_rests",
];

/// What a session row stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    /// The session in progress.
    Live,
    /// A recording the athlete finished and saved.
    Finished,
    /// A named workout that starting copies into a live session.
    Saved,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionKind::Live => "live",
            SessionKind::Finished => "finished",
            SessionKind::Saved => "saved",
        }
    }

    fn parse(text: &str) -> Option<SessionKind> {
        match text {
            "live" => Some(SessionKind::Live),
            "finished" => Some(SessionKind::Finished),
            "saved" => Some(SessionKind::Saved),
            _ => None,
        }
    }
}

/// One set of an exercise. The planned values are what the athlete set before
/// the session and the others are what was done.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionSet {
    pub reps: Option<u32>,
    pub weight_kg: Option<f64>,
    pub duration_secs: Option<f64>,
    /// Which side of a one-sided exercise. Kept here only: the FIT set message
    /// has no field for it.
    pub side: Option<String>,
    pub warm_up: bool,
    pub planned_reps: Option<u32>,
    pub planned_weight_kg: Option<f64>,
    pub planned_duration_secs: Option<f64>,
    pub done: bool,
    pub done_at: Option<i64>,
}

/// An exercise of a session: the FIT profile's category and name pair, the
/// group it is done with and the rest planned after it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionExercise {
    pub exercise_category: u16,
    pub exercise_name: Option<u16>,
    pub group_no: Option<u32>,
    pub rest_secs: Option<u32>,
    pub sets: Vec<SessionSet>,
}

/// The rest planned after a group of exercises.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionGroup {
    pub group_no: u32,
    pub rest_secs: Option<u32>,
}

/// A rest period as it happened.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionRest {
    pub started_at: Option<i64>,
    pub duration_secs: Option<f64>,
}

/// A session with everything it holds. Exercises and sets are stored in the
/// order they sit in these vectors.
#[derive(Debug, Clone, PartialEq)]
pub struct StrengthSession {
    pub id: String,
    pub kind: SessionKind,
    pub name: Option<String>,
    /// The key the ride this session recorded is stored under, which its
    /// sets in `exercise_sets` are written to.
    pub activity_key: Option<String>,
    /// The id intervals.icu gave that ride once the upload landed.
    pub intervals_id: Option<String>,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub exercises: Vec<SessionExercise>,
    pub groups: Vec<SessionGroup>,
    pub rests: Vec<SessionRest>,
}

/// The sets a finished session puts in the library: the done working sets, in
/// the order they sit. Warm-ups and rests stay in the session tables; the
/// strength screens count working sets.
fn projected_sets(session: &StrengthSession) -> Vec<FitExerciseSet> {
    let mut order = 0u32;
    let mut sets = Vec::new();
    for exercise in &session.exercises {
        for set in exercise.sets.iter().filter(|s| s.done && !s.warm_up) {
            sets.push(FitExerciseSet {
                set_order: order,
                exercise_category: exercise.exercise_category,
                exercise_name: exercise.exercise_name,
                set_type: 0,
                repetitions: set.reps.and_then(|r| u16::try_from(r).ok()),
                weight_kg: set.weight_kg,
                duration_secs: set.duration_secs,
                start_time: set.done_at,
            });
            order += 1;
        }
    }
    sets
}

/// Whether a finished session holds `key` as its ride's key or as the id the
/// upload gave it.
pub(super) fn claims(conn: &Connection, key: &str) -> SqlResult<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM strength_sessions
                       WHERE kind = 'finished'
                         AND (activity_key = ?1 OR intervals_id = ?1))",
        params![key],
        |row| row.get(0),
    )
}

fn write_session(conn: &Connection, session: &StrengthSession) -> SqlResult<()> {
    let id = session.id.as_str();
    for table in &SESSION_TABLES[1..] {
        conn.execute(&format!("DELETE FROM {table} WHERE session_id = ?1"), [id])?;
    }
    conn.execute(
        "INSERT OR REPLACE INTO strength_sessions
         (id, kind, name, activity_key, intervals_id, started_at, ended_at,
          last_used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            session.kind.as_str(),
            session.name,
            session.activity_key,
            session.intervals_id,
            session.started_at,
            session.ended_at,
            session.last_used_at,
            session.created_at,
        ],
    )?;
    let mut exercise_stmt = conn.prepare(
        "INSERT INTO strength_session_exercises
         (session_id, position, exercise_category, exercise_name, group_no, rest_secs)
         VALUES (?, ?, ?, ?, ?, ?)",
    )?;
    let mut set_stmt = conn.prepare(
        "INSERT INTO strength_session_sets
         (session_id, exercise_position, set_index, reps, weight_kg, duration_secs, side,
          warm_up, planned_reps, planned_weight_kg, planned_duration_secs, done, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )?;
    for (position, exercise) in session.exercises.iter().enumerate() {
        exercise_stmt.execute(params![
            id,
            position as i64,
            exercise.exercise_category,
            exercise.exercise_name,
            exercise.group_no,
            exercise.rest_secs,
        ])?;
        for (index, set) in exercise.sets.iter().enumerate() {
            set_stmt.execute(params![
                id,
                position as i64,
                index as i64,
                set.reps,
                set.weight_kg,
                set.duration_secs,
                set.side,
                set.warm_up,
                set.planned_reps,
                set.planned_weight_kg,
                set.planned_duration_secs,
                set.done,
                set.done_at,
            ])?;
        }
    }
    let mut group_stmt = conn.prepare(
        "INSERT OR REPLACE INTO strength_session_groups (session_id, group_no, rest_secs)
         VALUES (?, ?, ?)",
    )?;
    for group in &session.groups {
        group_stmt.execute(params![id, group.group_no, group.rest_secs])?;
    }
    let mut rest_stmt = conn.prepare(
        "INSERT INTO strength_session_rests (session_id, seq, started_at, duration_secs)
         VALUES (?, ?, ?, ?)",
    )?;
    for (seq, rest) in session.rests.iter().enumerate() {
        rest_stmt.execute(params![id, seq as i64, rest.started_at, rest.duration_secs])?;
    }
    Ok(())
}

fn read_session(conn: &Connection, id: &str) -> SqlResult<Option<StrengthSession>> {
    let head = conn
        .query_row(
            "SELECT kind, name, activity_key, intervals_id, started_at, ended_at,
                    last_used_at, created_at
             FROM strength_sessions WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((
        kind,
        name,
        activity_key,
        intervals_id,
        started_at,
        ended_at,
        last_used_at,
        created_at,
    )) = head
    else {
        return Ok(None);
    };
    let kind = SessionKind::parse(&kind).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown session kind {kind:?}").into(),
        )
    })?;

    let mut exercises: Vec<SessionExercise> = conn
        .prepare(
            "SELECT exercise_category, exercise_name, group_no, rest_secs
             FROM strength_session_exercises WHERE session_id = ?1 ORDER BY position",
        )?
        .query_map([id], |row| {
            Ok(SessionExercise {
                exercise_category: row.get(0)?,
                exercise_name: row.get(1)?,
                group_no: row.get(2)?,
                rest_secs: row.get(3)?,
                sets: Vec::new(),
            })
        })?
        .collect::<SqlResult<_>>()?;
    let mut set_stmt = conn.prepare(
        "SELECT exercise_position, reps, weight_kg, duration_secs, side, warm_up,
                planned_reps, planned_weight_kg, planned_duration_secs, done, done_at
         FROM strength_session_sets WHERE session_id = ?1
         ORDER BY exercise_position, set_index",
    )?;
    let sets = set_stmt.query_map([id], |row| {
        Ok((
            row.get::<_, i64>(0)? as usize,
            SessionSet {
                reps: row.get(1)?,
                weight_kg: row.get(2)?,
                duration_secs: row.get(3)?,
                side: row.get(4)?,
                warm_up: row.get(5)?,
                planned_reps: row.get(6)?,
                planned_weight_kg: row.get(7)?,
                planned_duration_secs: row.get(8)?,
                done: row.get(9)?,
                done_at: row.get(10)?,
            },
        ))
    })?;
    for set in sets {
        let (position, set) = set?;
        if let Some(exercise) = exercises.get_mut(position) {
            exercise.sets.push(set);
        }
    }
    let groups = conn
        .prepare(
            "SELECT group_no, rest_secs FROM strength_session_groups
             WHERE session_id = ?1 ORDER BY group_no",
        )?
        .query_map([id], |row| {
            Ok(SessionGroup {
                group_no: row.get(0)?,
                rest_secs: row.get(1)?,
            })
        })?
        .collect::<SqlResult<_>>()?;
    let rests = conn
        .prepare(
            "SELECT started_at, duration_secs FROM strength_session_rests
             WHERE session_id = ?1 ORDER BY seq",
        )?
        .query_map([id], |row| {
            Ok(SessionRest {
                started_at: row.get(0)?,
                duration_secs: row.get(1)?,
            })
        })?
        .collect::<SqlResult<_>>()?;

    Ok(Some(StrengthSession {
        id: id.to_string(),
        kind,
        name,
        activity_key,
        intervals_id,
        started_at,
        ended_at,
        last_used_at,
        created_at,
        exercises,
        groups,
        rests,
    }))
}

/// Replace the library's sets under `key` with the session's done working
/// sets, and settle the FIT verdict so no download is owed for the key.
fn project(engine: &PersistentEngine, key: &str, session: &StrengthSession) -> SqlResult<()> {
    engine
        .db
        .execute("DELETE FROM exercise_sets WHERE activity_id = ?1", [key])?;
    let sets = projected_sets(session);
    if sets.is_empty() {
        return Ok(());
    }
    engine.write_exercise_sets(key, &sets)?;
    write_fit_outcome(&engine.db, key, FitOutcome::Parsed)
}

impl PersistentEngine {
    /// Store a session, replacing the rows it had. A finished session with a
    /// ride key writes its done working sets to the library at once, under
    /// that key, in the same transaction.
    pub fn save_strength_session(&self, session: &StrengthSession) -> SqlResult<()> {
        in_write_txn(&self.db, |_| {
            let before = read_session(&self.db, &session.id)?;
            write_session(&self.db, session)?;
            // A session that moved off a key, or stopped being finished, no
            // longer claims the sets it wrote there.
            if let Some(before) = before
                && before.kind == SessionKind::Finished
                && let Some(old) = before.activity_key.as_deref()
                && (session.kind != SessionKind::Finished
                    || session.activity_key.as_deref() != Some(old))
            {
                self.db
                    .execute("DELETE FROM exercise_sets WHERE activity_id = ?1", [old])?;
            }
            if session.kind == SessionKind::Finished
                && let Some(key) = session.activity_key.as_deref()
            {
                project(self, key, session)?;
            }
            Ok(())
        })
    }

    /// A session with everything it holds, or `None` for an id nothing holds.
    pub fn get_strength_session(&self, id: &str) -> SqlResult<Option<StrengthSession>> {
        read_session(&self.db, id)
    }

    /// A recorded ride's upload landed as `intervals_id`: the session that
    /// wrote its sets under `from_key` takes the id, its sets move to the key
    /// the ride is stored under now, and no download is owed for that key.
    /// False when no finished session holds `from_key` or `intervals_id`.
    ///
    /// Safe to call again: the second call finds the session by the id the
    /// first gave it and writes the same rows.
    pub fn relink_recorded_session(&self, from_key: &str, intervals_id: &str) -> SqlResult<bool> {
        in_write_txn(&self.db, |_| {
            let Some(id) = self
                .db
                .query_row(
                    "SELECT id FROM strength_sessions
                     WHERE kind = 'finished' AND (activity_key = ?1 OR intervals_id = ?2)
                     ORDER BY activity_key = ?1 DESC LIMIT 1",
                    params![from_key, intervals_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
            else {
                return Ok(false);
            };
            let Some(mut session) = read_session(&self.db, &id)? else {
                return Ok(false);
            };
            let target = super::activities::pooled::claiming_key(&self.db, intervals_id)
                .unwrap_or_else(|| intervals_id.to_string());
            if let Some(old) = session.activity_key.as_deref()
                && old != target
            {
                self.db
                    .execute("DELETE FROM exercise_sets WHERE activity_id = ?1", [old])?;
            }
            session.activity_key = Some(target.clone());
            session.intervals_id = Some(intervals_id.to_string());
            self.db.execute(
                "UPDATE strength_sessions SET activity_key = ?1, intervals_id = ?2 WHERE id = ?3",
                params![target, intervals_id, id],
            )?;
            project(self, &target, &session)?;
            Ok(true)
        })
    }

    /// Place one row of a record backup's session tables, replacing the row
    /// with the same key. Only the columns the table has are read, so a record
    /// written by a build with more columns still places. False for a row
    /// that names no session.
    pub(crate) fn place_strength_session_row(
        &self,
        row: &super::record_backup::RecordRow,
    ) -> Result<bool, String> {
        let table = row.table.as_str();
        if !SESSION_TABLES.contains(&table) {
            return Ok(false);
        }
        let key = if table == "strength_sessions" {
            "id"
        } else {
            "session_id"
        };
        if !matches!(row.values.get(key), Some(serde_json::Value::String(_))) {
            return Ok(false);
        }
        let columns: Vec<String> = self
            .db
            .prepare("SELECT name FROM pragma_table_info(?1)")
            .map_err(|e| e.to_string())?
            .query_map([table], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<SqlResult<_>>()
            .map_err(|e| e.to_string())?;
        let mut names = Vec::new();
        let mut values = Vec::new();
        for column in columns {
            let Some(value) = row.values.get(&column) else {
                continue;
            };
            let value = match value {
                serde_json::Value::Null => rusqlite::types::Value::Null,
                serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(i64::from(*b)),
                serde_json::Value::Number(n) => match n.as_i64() {
                    Some(i) => rusqlite::types::Value::Integer(i),
                    None => rusqlite::types::Value::Real(n.as_f64().unwrap_or_default()),
                },
                serde_json::Value::String(text) => rusqlite::types::Value::Text(text.clone()),
                _ => return Ok(false),
            };
            names.push(column);
            values.push(value);
        }
        let marks = vec!["?"; names.len()].join(", ");
        self.db
            .execute(
                &format!(
                    "INSERT OR REPLACE INTO {table} ({}) VALUES ({marks})",
                    names.join(", ")
                ),
                rusqlite::params_from_iter(values),
            )
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// Write again the sets of every finished session whose ride key holds
    /// none, such as after a restore placed the session rows. Answers how many
    /// sessions it wrote.
    pub fn project_recorded_sessions(&self) -> SqlResult<usize> {
        in_write_txn(&self.db, |_| {
            let owed: Vec<(String, String)> = self
                .db
                .prepare(
                    "SELECT s.id, s.activity_key FROM strength_sessions s
                     WHERE s.kind = 'finished' AND s.activity_key IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM exercise_sets e
                                       WHERE e.activity_id = s.activity_key)",
                )?
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<SqlResult<_>>()?;
            let mut written = 0;
            for (id, key) in owed {
                if let Some(session) = read_session(&self.db, &id)? {
                    project(self, &key, &session)?;
                    written += 1;
                }
            }
            Ok(written)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn session(key: &str) -> StrengthSession {
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
            exercises: vec![SessionExercise {
                exercise_category: 7,
                exercise_name: Some(3),
                group_no: Some(2),
                rest_secs: Some(60),
                sets: vec![
                    SessionSet {
                        reps: Some(12),
                        weight_kg: Some(10.0),
                        side: Some("left".to_string()),
                        planned_reps: Some(12),
                        planned_weight_kg: Some(10.0),
                        done: true,
                        done_at: Some(1_000),
                        ..SessionSet::default()
                    },
                    SessionSet {
                        reps: Some(12),
                        weight_kg: Some(10.0),
                        side: Some("right".to_string()),
                        done: true,
                        done_at: Some(1_060),
                        ..SessionSet::default()
                    },
                ],
            }],
            groups: vec![SessionGroup {
                group_no: 2,
                rest_secs: Some(120),
            }],
            rests: vec![SessionRest {
                started_at: Some(1_030),
                duration_secs: Some(30.0),
            }],
        }
    }

    fn saved_workout() -> StrengthSession {
        StrengthSession {
            id: "workout-1".to_string(),
            kind: SessionKind::Saved,
            name: Some("Arms".to_string()),
            activity_key: None,
            ..session("unused")
        }
    }

    /// Scenario: the athlete recorded a session with a left and a right set,
    /// a group and a saved workout, backed up and restored onto a new phone
    /// whose sync has not stored that ride yet.
    ///
    /// Expected behaviour: side, groups, planned values, rest and the saved
    /// workout come back whole, the sets enter the library under the ride's
    /// key, and nothing is left waiting.
    #[test]
    fn a_backup_and_restore_keeps_side_groups_and_saved_workouts() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let source =
            PersistentEngine::new(dir.path().join("sessions-source.db").to_str().unwrap()).unwrap();
        source.save_strength_session(&session("local-r1")).unwrap();
        source.save_strength_session(&saved_workout()).unwrap();
        let payload =
            crate::persistence::record_backup::collect_record_payload(&source.db).unwrap();

        let mut restored =
            PersistentEngine::new(dir.path().join("sessions-restored.db").to_str().unwrap())
                .unwrap();
        let json = serde_json::to_string(&payload).unwrap();
        let result = restored.restore_record_json(&json).unwrap();

        assert_eq!(result.unplaced, 0);
        assert_eq!(
            restored.get_strength_session("session-1").unwrap(),
            Some(session("local-r1"))
        );
        assert_eq!(
            restored.get_strength_session("workout-1").unwrap(),
            Some(saved_workout())
        );
        assert_eq!(restored.get_exercise_sets("local-r1").unwrap().len(), 2);

        let again = restored.restore_record_json(&json).unwrap();
        assert_eq!(again.unplaced, 0);
        assert_eq!(restored.get_exercise_sets("local-r1").unwrap().len(), 2);
    }

    /// Scenario: the ride's upload landed before the backup was taken, so the
    /// record names the ride by the id intervals.icu gave it.
    ///
    /// Expected behaviour: the restored session claims that id, and the copy
    /// the sync downloads for it adds no second set of rows.
    #[test]
    fn a_restored_session_claims_the_id_its_upload_was_given() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let source =
            PersistentEngine::new(dir.path().join("claim-source.db").to_str().unwrap()).unwrap();
        let mut landed = session("i700");
        landed.intervals_id = Some("i700".to_string());
        source.save_strength_session(&landed).unwrap();
        let payload =
            crate::persistence::record_backup::collect_record_payload(&source.db).unwrap();
        let mut restored =
            PersistentEngine::new(dir.path().join("claim-restored.db").to_str().unwrap()).unwrap();
        restored
            .restore_record_json(&serde_json::to_string(&payload).unwrap())
            .unwrap();

        let copy: Vec<FitExerciseSet> = (0..5)
            .map(|i| FitExerciseSet {
                set_order: i,
                exercise_category: 7,
                exercise_name: Some(3),
                set_type: 0,
                repetitions: Some(12),
                weight_kg: Some(10.0),
                duration_secs: None,
                start_time: None,
            })
            .collect();
        restored.settle_exercise_sets("i700", &copy).unwrap();

        assert_eq!(restored.get_exercise_sets("i700").unwrap().len(), 2);
    }
}
