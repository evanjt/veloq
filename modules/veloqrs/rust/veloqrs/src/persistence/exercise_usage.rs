//! Which exercises the athlete has done, ranked by recent use, and which
//! exercise usually follows which.
//!
//! `exercise_usage` holds one row per exercise and `exercise_followers` one per
//! ordered pair of exercises that met inside a session. Both are derived from
//! `exercise_sets` and kept by the writers of those rows: [`detach`] before a
//! session's sets change and [`attach`] after, so a session counts once however
//! often it is stored, and removing an activity takes its share back out.
//!
//! Only active sets of a named exercise count. A rest set, and a set the watch
//! could not name (category `unknown` or `invalid`), never enter the ranking,
//! the last-done day or the followers.

use std::collections::BTreeSet;

use rusqlite::{Connection, Result as SqlResult, params};

use super::PersistentEngine;

/// The e-folding time of an exercise's relevance, in days. Each session adds
/// `exp(-age_days / RELEVANCE_DECAY_DAYS)`, so a session this many days old
/// counts for 1/e of one done today (a half-life of about 41.6 days).
pub const RELEVANCE_DECAY_DAYS: f64 = 60.0;

const SECONDS_PER_DAY: i64 = 86_400;

/// Stored in place of the name of a set that carries none, so the key has no NULL.
const NO_NAME: i64 = -1;

/// FIT's exercise categories `unknown` and the invalid `uint16`.
const UNNAMED_CATEGORIES: &str = "(65534, 65535)";

/// The day a session counts for, in a query over `exercise_sets es` joined to
/// `activity_metrics am`: its activity's date, else its first set's start.
const SESSION_DAY: &str = "COALESCE(am.date,
                         (SELECT MIN(s.start_time) FROM exercise_sets s
                          WHERE s.activity_id = es.activity_id))";

/// One exercise as the tables key it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct ExerciseKey {
    pub(super) category: i64,
    pub(super) name: i64,
}

impl ExerciseKey {
    fn new(category: i64, name: Option<i64>) -> Self {
        Self {
            category,
            name: name.unwrap_or(NO_NAME),
        }
    }

    fn name(self) -> Option<i64> {
        (self.name != NO_NAME).then_some(self.name)
    }
}

/// An exercise the athlete has done, with how recently and how much.
#[derive(Clone, Debug, PartialEq)]
pub struct RankedExercise {
    pub category: u16,
    pub name: Option<u16>,
    /// Whole days since a session last used it, 0 for today or a later date.
    pub last_done_days: u32,
    /// Each session's `exp(-age_days / RELEVANCE_DECAY_DAYS)` summed.
    pub relevance: f64,
    pub sessions: u32,
}

/// One working set of an exercise as an earlier session did it.
#[derive(Clone, Debug, PartialEq)]
pub struct LastTimeSet {
    pub reps: Option<u32>,
    pub weight_kg: Option<f64>,
    pub duration_secs: Option<f64>,
}

/// An exercise as the most recent session that did it left it.
#[derive(Clone, Debug, PartialEq)]
pub struct LastTime {
    /// Whole days from that session to now, 0 for today or a later date.
    pub days_ago: u32,
    pub sets: Vec<LastTimeSet>,
}

/// An exercise that followed another, and how many times it did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FollowingExercise {
    pub category: u16,
    pub name: Option<u16>,
    pub times: u32,
}

/// The exercises of a session in the order they were done: active sets of a
/// named exercise, with a run of sets of one exercise counted once.
pub(super) fn session_sequence(
    conn: &Connection,
    activity_id: &str,
) -> SqlResult<Vec<ExerciseKey>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT exercise_category, exercise_name FROM exercise_sets
         WHERE activity_id = ?1 AND set_type = 0
           AND exercise_category NOT IN {UNNAMED_CATEGORIES}
         ORDER BY set_order"
    ))?;
    let mut sequence: Vec<ExerciseKey> = Vec::new();
    let rows = stmt.query_map([activity_id], |row| {
        Ok(ExerciseKey::new(row.get(0)?, row.get(1)?))
    })?;
    for key in rows {
        let key = key?;
        if sequence.last() != Some(&key) {
            sequence.push(key);
        }
    }
    Ok(sequence)
}

fn count_followers(conn: &Connection, sequence: &[ExerciseKey], step: i64) -> SqlResult<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT INTO exercise_followers
             (exercise_category, exercise_name, next_category, next_name, times)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT DO UPDATE SET times = times + excluded.times",
    )?;
    for pair in sequence.windows(2) {
        stmt.execute(params![
            pair[0].category,
            pair[0].name,
            pair[1].category,
            pair[1].name,
            step
        ])?;
    }
    Ok(())
}

/// Take a session's exercises out of the follower counts, ahead of a change to
/// its sets. Returns the exercises it used, for [`attach`] to recount.
pub(crate) fn detach(conn: &Connection, activity_id: &str) -> SqlResult<Vec<ExerciseKey>> {
    let sequence = session_sequence(conn, activity_id)?;
    count_followers(conn, &sequence, -1)?;
    Ok(sequence)
}

/// Count a session's exercises, after a change to its sets: the follower
/// pairs of the sets as they now stand, and the usage of every exercise the
/// session used before or uses now.
pub(crate) fn attach(
    conn: &Connection,
    activity_id: &str,
    before: &[ExerciseKey],
) -> SqlResult<()> {
    let sequence = session_sequence(conn, activity_id)?;
    count_followers(conn, &sequence, 1)?;
    conn.execute("DELETE FROM exercise_followers WHERE times <= 0", [])?;
    let touched: BTreeSet<ExerciseKey> = before.iter().chain(&sequence).copied().collect();
    for key in touched {
        recompute_usage(conn, key)?;
    }
    super::strength_signature::refresh(conn, activity_id, &sequence)
}

/// One exercise's usage row, from the sets that name it. The session's day is
/// its activity's date, else its first set's start.
fn recompute_usage(conn: &Connection, key: ExerciseKey) -> SqlResult<()> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {SESSION_DAY}
         FROM exercise_sets es
         LEFT JOIN activity_metrics am ON am.activity_id = es.activity_id
         WHERE es.exercise_category = ?1 AND es.exercise_name IS ?2 AND es.set_type = 0
         GROUP BY es.activity_id",
    ))?;
    let days: Vec<i64> = stmt
        .query_map(params![key.category, key.name()], |row| {
            row.get::<_, Option<i64>>(0)
        })?
        .filter_map(|day| day.transpose())
        .collect::<SqlResult<_>>()?;

    let Some(&last_done) = days.iter().max() else {
        conn.execute(
            "DELETE FROM exercise_usage WHERE exercise_category = ?1 AND exercise_name = ?2",
            params![key.category, key.name],
        )?;
        return Ok(());
    };
    let score: f64 = days.iter().map(|&day| decay(last_done - day)).sum();
    conn.execute(
        "INSERT OR REPLACE INTO exercise_usage
             (exercise_category, exercise_name, last_done, score, sessions)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![key.category, key.name, last_done, score, days.len() as i64],
    )?;
    Ok(())
}

/// What one session is worth once `age_secs` have passed. A negative age (a
/// session dated after now) counts in full.
fn decay(age_secs: i64) -> f64 {
    let age_days = age_secs.max(0) as f64 / SECONDS_PER_DAY as f64;
    (-age_days / RELEVANCE_DECAY_DAYS).exp()
}

/// Rebuild both tables from the sets, for a library that held sets before the
/// tables existed.
pub(crate) fn rebuild(conn: &Connection) -> SqlResult<()> {
    conn.execute("DELETE FROM exercise_followers", [])?;
    conn.execute("DELETE FROM exercise_usage", [])?;
    let activity_ids: Vec<String> = conn
        .prepare("SELECT DISTINCT activity_id FROM exercise_sets")?
        .query_map([], |row| row.get(0))?
        .collect::<SqlResult<_>>()?;
    for id in &activity_ids {
        count_followers(conn, &session_sequence(conn, id)?, 1)?;
    }
    let keys: Vec<ExerciseKey> = conn
        .prepare(&format!(
            "SELECT DISTINCT exercise_category, exercise_name FROM exercise_sets
             WHERE set_type = 0 AND exercise_category NOT IN {UNNAMED_CATEGORIES}"
        ))?
        .query_map([], |row| Ok(ExerciseKey::new(row.get(0)?, row.get(1)?)))?
        .collect::<SqlResult<_>>()?;
    for key in keys {
        recompute_usage(conn, key)?;
    }
    Ok(())
}

/// Every exercise the athlete has done, most relevant first. The table holds a
/// row per exercise done, a few hundred at most, so the ageing to `now` and the
/// sort happen here.
pub(crate) fn ranked(conn: &Connection, now: i64) -> SqlResult<Vec<RankedExercise>> {
    let mut stmt = conn.prepare_cached(
        "SELECT exercise_category, exercise_name, last_done, score, sessions
         FROM exercise_usage",
    )?;
    let mut rows: Vec<(i64, RankedExercise)> = stmt
        .query_map([], |row| {
            let key = ExerciseKey {
                category: row.get(0)?,
                name: row.get(1)?,
            };
            let last_done: i64 = row.get(2)?;
            let score: f64 = row.get(3)?;
            Ok((
                last_done,
                RankedExercise {
                    category: key.category as u16,
                    name: key.name().map(|n| n as u16),
                    last_done_days: ((now - last_done).max(0) / SECONDS_PER_DAY) as u32,
                    relevance: score * decay(now - last_done),
                    sessions: row.get::<_, i64>(4)? as u32,
                },
            ))
        })?
        .collect::<SqlResult<_>>()?;
    rows.sort_by(|(day_a, a), (day_b, b)| {
        b.relevance
            .total_cmp(&a.relevance)
            .then(day_b.cmp(day_a))
            .then((a.category, a.name).cmp(&(b.category, b.name)))
    });
    Ok(rows.into_iter().map(|(_, ranked)| ranked).collect())
}

/// The working sets of an exercise in the latest session that did it, in any
/// session, with the days since. A session with no day is not counted, as in
/// the ranking. `None` for an exercise never done.
pub(crate) fn last_time(
    conn: &Connection,
    category: u16,
    name: Option<u16>,
    now: i64,
) -> SqlResult<Option<LastTime>> {
    let key = ExerciseKey::new(i64::from(category), name.map(i64::from));
    let latest = conn
        .prepare_cached(&format!(
            "SELECT es.activity_id, {SESSION_DAY} AS day
             FROM exercise_sets es
             LEFT JOIN activity_metrics am ON am.activity_id = es.activity_id
             WHERE es.exercise_category = ?1 AND es.exercise_name IS ?2 AND es.set_type = 0
             GROUP BY es.activity_id
             HAVING day IS NOT NULL
             ORDER BY day DESC, es.activity_id
             LIMIT 1"
        ))?
        .query_row(params![key.category, key.name()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        });
    let (activity_id, day) = match latest {
        Ok(found) => found,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(error),
    };
    let sets = conn
        .prepare_cached(
            "SELECT repetitions, weight_kg, duration_secs FROM exercise_sets
             WHERE activity_id = ?1 AND exercise_category = ?2 AND exercise_name IS ?3
               AND set_type = 0
             ORDER BY set_order",
        )?
        .query_map(params![activity_id, key.category, key.name()], |row| {
            Ok(LastTimeSet {
                reps: row.get::<_, Option<u32>>(0)?,
                weight_kg: row.get(1)?,
                duration_secs: row.get(2)?,
            })
        })?
        .collect::<SqlResult<_>>()?;
    Ok(Some(LastTime {
        days_ago: ((now - day).max(0) / SECONDS_PER_DAY) as u32,
        sets,
    }))
}

/// The exercises that followed this one in a session, most often first.
pub(crate) fn usually_next(
    conn: &Connection,
    category: u16,
    name: Option<u16>,
) -> SqlResult<Vec<FollowingExercise>> {
    let key = ExerciseKey::new(i64::from(category), name.map(i64::from));
    let mut stmt = conn.prepare_cached(
        "SELECT next_category, next_name, times FROM exercise_followers
         WHERE exercise_category = ?1 AND exercise_name = ?2
         ORDER BY times DESC, next_category, next_name",
    )?;
    stmt.query_map(params![key.category, key.name], |row| {
        let next = ExerciseKey {
            category: row.get(0)?,
            name: row.get(1)?,
        };
        Ok(FollowingExercise {
            category: next.category as u16,
            name: next.name().map(|n| n as u16),
            times: row.get::<_, i64>(2)? as u32,
        })
    })?
    .collect()
}

impl PersistentEngine {
    /// The exercises the athlete has done, most relevant at `now` first, each
    /// with the whole days since it was last done.
    pub fn ranked_exercises(&self, now: i64) -> SqlResult<Vec<RankedExercise>> {
        ranked(&self.db, now)
    }

    /// The exercises that followed this one in a session, most often first.
    pub fn exercises_usually_next(
        &self,
        category: u16,
        name: Option<u16>,
    ) -> SqlResult<Vec<FollowingExercise>> {
        usually_next(&self.db, category, name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fit::FitExerciseSet;
    use tempfile::TempDir;

    const DAY: i64 = SECONDS_PER_DAY;
    const NOW: i64 = 1_800_000_000;

    const BENCH: (u16, u16) = (0, 1);
    const ROW: (u16, u16) = (23, 2);
    const SQUAT: (u16, u16) = (28, 3);
    const CURL: (u16, u16) = (7, 4);

    fn engine() -> (TempDir, PersistentEngine) {
        let dir = TempDir::new().unwrap();
        let engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
        (dir, engine)
    }

    fn set_of(order: u32, exercise: (u16, u16), set_type: u8) -> FitExerciseSet {
        FitExerciseSet {
            set_order: order,
            exercise_category: exercise.0,
            exercise_name: Some(exercise.1),
            set_type,
            repetitions: Some(8),
            weight_kg: Some(40.0),
            duration_secs: None,
            start_time: None,
        }
    }

    /// A strength session dated `date`, doing `exercises` in order, one active set each.
    fn session(engine: &PersistentEngine, id: &str, date: i64, exercises: &[(u16, u16)]) {
        engine
            .db
            .execute(
                "INSERT OR REPLACE INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, sport_type)
                 VALUES (?1, 'Weights', ?2, 0, 0, 0, 0, 'WeightTraining')",
                params![id, date],
            )
            .unwrap();
        let sets: Vec<_> = exercises
            .iter()
            .enumerate()
            .map(|(i, &e)| set_of(i as u32, e, 0))
            .collect();
        engine.store_exercise_sets(id, &sets).unwrap();
    }

    fn order(engine: &PersistentEngine) -> Vec<(u16, u16)> {
        engine
            .ranked_exercises(NOW)
            .unwrap()
            .iter()
            .map(|e| (e.category, e.name.unwrap()))
            .collect()
    }

    fn next_after(engine: &PersistentEngine, exercise: (u16, u16)) -> Vec<((u16, u16), u32)> {
        engine
            .exercises_usually_next(exercise.0, Some(exercise.1))
            .unwrap()
            .iter()
            .map(|f| ((f.category, f.name.unwrap()), f.times))
            .collect()
    }

    #[test]
    fn three_recent_sessions_outrank_ten_a_year_ago() {
        let (_dir, engine) = engine();
        for i in 0..10 {
            session(&engine, &format!("old{i}"), NOW - (360 + i) * DAY, &[ROW]);
        }
        for i in 0..3 {
            session(&engine, &format!("new{i}"), NOW - (7 + i) * DAY, &[BENCH]);
        }

        assert_eq!(order(&engine), vec![BENCH, ROW]);
        let ranked = engine.ranked_exercises(NOW).unwrap();
        assert_eq!(ranked[0].sessions, 3);
        assert_eq!(ranked[1].sessions, 10);
    }

    #[test]
    fn last_done_counts_whole_days_from_the_latest_session() {
        let (_dir, engine) = engine();
        session(&engine, "older", NOW - 20 * DAY, &[BENCH]);
        session(&engine, "latest", NOW - 3 * DAY - 100, &[BENCH]);

        assert_eq!(engine.ranked_exercises(NOW).unwrap()[0].last_done_days, 3);
    }

    #[test]
    fn a_session_dated_after_now_was_done_today() {
        let (_dir, engine) = engine();
        session(&engine, "ahead", NOW + 2 * DAY, &[BENCH]);

        let ranked = engine.ranked_exercises(NOW).unwrap();
        assert_eq!(ranked[0].last_done_days, 0);
        assert!((ranked[0].relevance - 1.0).abs() < 1e-12);
    }

    #[test]
    fn a_session_adds_exp_of_minus_its_age_over_the_decay_constant() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - 60 * DAY, &[BENCH]);
        session(&engine, "b", NOW - 120 * DAY, &[BENCH]);

        let relevance = engine.ranked_exercises(NOW).unwrap()[0].relevance;
        assert_eq!(RELEVANCE_DECAY_DAYS, 60.0);
        assert!((relevance - ((-1.0f64).exp() + (-2.0f64).exp())).abs() < 1e-12);
    }

    #[test]
    fn the_exercise_that_most_often_followed_comes_first() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - 9 * DAY, &[BENCH, ROW, SQUAT]);
        session(&engine, "b", NOW - 6 * DAY, &[BENCH, ROW]);
        session(&engine, "c", NOW - 3 * DAY, &[BENCH, CURL]);

        assert_eq!(next_after(&engine, BENCH), vec![(ROW, 2), (CURL, 1)]);
        assert_eq!(next_after(&engine, ROW), vec![(SQUAT, 1)]);
        assert!(next_after(&engine, SQUAT).is_empty());
    }

    #[test]
    fn sets_of_one_exercise_in_a_row_are_one_step() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - DAY, &[BENCH, BENCH, BENCH, ROW, ROW]);

        assert_eq!(next_after(&engine, BENCH), vec![(ROW, 1)]);
        assert!(next_after(&engine, ROW).is_empty());
        assert_eq!(engine.ranked_exercises(NOW).unwrap()[0].sessions, 1);
    }

    #[test]
    fn unnamed_exercises_and_rest_sets_never_enter_any_read() {
        let (_dir, engine) = engine();
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, sport_type)
                 VALUES ('a', 'Weights', ?1, 0, 0, 0, 0, 'WeightTraining')",
                [NOW - DAY],
            )
            .unwrap();
        let sets = [
            set_of(0, BENCH, 0),
            set_of(1, (0xFFFE, 0), 0),
            set_of(2, (0xFFFF, 0), 0),
            set_of(3, SQUAT, 1),
            set_of(4, ROW, 0),
        ];
        engine.store_exercise_sets("a", &sets).unwrap();

        assert_eq!(order(&engine), vec![BENCH, ROW]);
        assert_eq!(next_after(&engine, BENCH), vec![(ROW, 1)]);
        assert!(
            engine
                .exercises_usually_next(0xFFFE, Some(0))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn a_set_with_a_category_and_no_name_is_the_category() {
        let (_dir, engine) = engine();
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, sport_type)
                 VALUES ('a', 'Weights', ?1, 0, 0, 0, 0, 'WeightTraining')",
                [NOW - DAY],
            )
            .unwrap();
        let mut bare = set_of(0, BENCH, 0);
        bare.exercise_name = None;
        engine.store_exercise_sets("a", &[bare]).unwrap();

        let ranked = engine.ranked_exercises(NOW).unwrap();
        assert_eq!((ranked[0].category, ranked[0].name), (0, None));
        assert!(engine.exercises_usually_next(0, None).unwrap().is_empty());
    }

    #[test]
    fn storing_a_session_again_counts_it_once() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - 4 * DAY, &[BENCH, ROW]);
        session(&engine, "a", NOW - 4 * DAY, &[BENCH, ROW]);

        assert_eq!(engine.ranked_exercises(NOW).unwrap()[0].sessions, 1);
        assert_eq!(next_after(&engine, BENCH), vec![(ROW, 1)]);
    }

    #[test]
    fn a_session_stored_again_with_other_exercises_replaces_its_counts() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - 4 * DAY, &[BENCH, ROW]);
        session(&engine, "a", NOW - 4 * DAY, &[SQUAT, CURL]);

        let mut exercises = order(&engine);
        exercises.sort();
        assert_eq!(exercises, vec![CURL, SQUAT]);
        assert!(next_after(&engine, BENCH).is_empty());
        assert_eq!(next_after(&engine, SQUAT), vec![(CURL, 1)]);
    }

    #[test]
    fn removing_an_activity_takes_its_share_out() {
        let (_dir, mut engine) = engine();
        session(&engine, "old", NOW - 30 * DAY, &[BENCH, ROW]);
        session(&engine, "new", NOW - 2 * DAY, &[BENCH, CURL]);
        assert_eq!(engine.ranked_exercises(NOW).unwrap().len(), 3);

        engine.remove_activity("new").unwrap();

        let ranked = engine.ranked_exercises(NOW).unwrap();
        assert_eq!(order(&engine), vec![BENCH, ROW]);
        assert_eq!(ranked[0].last_done_days, 30);
        assert_eq!(ranked[0].sessions, 1);
        assert_eq!(next_after(&engine, BENCH), vec![(ROW, 1)]);
    }

    #[test]
    fn clearing_the_library_empties_both_tables() {
        let (_dir, mut engine) = engine();
        session(&engine, "a", NOW - DAY, &[BENCH, ROW]);

        engine.clear().unwrap();

        assert!(engine.ranked_exercises(NOW).unwrap().is_empty());
        assert!(next_after(&engine, BENCH).is_empty());
    }

    #[test]
    fn a_rebuild_from_the_sets_equals_the_tables_kept_as_sessions_arrived() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - 9 * DAY, &[BENCH, ROW, SQUAT]);
        session(&engine, "b", NOW - 6 * DAY, &[BENCH, ROW, BENCH]);
        session(&engine, "c", NOW - 3 * DAY, &[CURL, BENCH]);
        let dump = |engine: &PersistentEngine| {
            let usage: Vec<(i64, i64, i64, String, i64)> = engine
                .db
                .prepare("SELECT * FROM exercise_usage ORDER BY 1, 2")
                .unwrap()
                .query_map([], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        format!("{:.9}", r.get::<_, f64>(3)?),
                        r.get(4)?,
                    ))
                })
                .unwrap()
                .map(Result::unwrap)
                .collect();
            let followers: Vec<(i64, i64, i64, i64, i64)> = engine
                .db
                .prepare("SELECT * FROM exercise_followers ORDER BY 1, 2, 3, 4")
                .unwrap()
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .unwrap()
                .map(Result::unwrap)
                .collect();
            (usage, followers)
        };
        let kept = dump(&engine);
        assert!(!kept.0.is_empty() && !kept.1.is_empty());

        rebuild(&engine.db).unwrap();

        assert_eq!(dump(&engine), kept);
    }

    #[test]
    fn the_exercise_history_read_uses_the_exercise_index() {
        let (_dir, engine) = engine();
        let plan: Vec<String> = engine
            .db
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT es.activity_id FROM exercise_sets es
                 WHERE es.exercise_category = 0 AND es.exercise_name IS 1 AND es.set_type = 0
                 GROUP BY es.activity_id",
            )
            .unwrap()
            .query_map([], |r| r.get(3))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(
            plan.iter()
                .any(|d| d.contains("idx_exercise_sets_exercise")),
            "{plan:?}"
        );
    }

    #[test]
    fn picker_read_gives_last_done_days_and_ignores_unknown_filter_words() {
        use crate::persistence::screens::exercise_picker_data;
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - 127 * DAY, &[BENCH]);
        session(&engine, "b", NOW - 3 * DAY, &[CURL]);

        let all = exercise_picker_data(&engine.db, &[], None, None, "", None, NOW).unwrap();
        let days = |key: &str| {
            all.rows
                .iter()
                .find(|r| r.label_key == key)
                .and_then(|r| r.last_done_days)
        };
        let bench = crate::strength::catalogue::lookup(BENCH.0, BENCH.1).unwrap();
        let curl = crate::strength::catalogue::lookup(CURL.0, CURL.1).unwrap();
        assert_eq!(days(bench.label_key), Some(127));
        assert_eq!(days(curl.label_key), Some(3));
        assert_eq!(all.rows[0].label_key, curl.label_key);
        assert!(!all.equipment.is_empty() && !all.muscles.is_empty());

        let unknown =
            exercise_picker_data(&engine.db, &["nope".into()], None, None, "", None, NOW).unwrap();
        assert!(unknown.rows.is_empty());
        assert!(!unknown.muscles.is_empty());
        let arms =
            exercise_picker_data(&engine.db, &[], Some("arms"), None, "", None, NOW).unwrap();
        assert!(arms.rows.len() < all.rows.len() && !arms.rows.is_empty());
    }
}
