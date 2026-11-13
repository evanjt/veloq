//! The exercises a strength session used, as one value, and the last sessions
//! grouped by it.
//!
//! A session's signature is the sorted set of the exercises it did, so two
//! sessions that did the same exercises in a different order share one. The
//! `strength_signatures` table holds it per activity, derived from
//! `exercise_sets` and kept by the same writers as `exercise_usage`: the one
//! call is [`refresh`], made from `exercise_usage::attach`.

use crate::FfiMuscleGroup;
use crate::strength::catalogue::{self, Equipment};
use rusqlite::{Connection, Result as SqlResult, params};

use super::PersistentEngine;
use super::exercise_usage::{ExerciseKey, session_sequence};

/// How many groups the read returns.
pub const RECENT_GROUP_LIMIT: usize = 10;

/// The read behind [`PersistentEngine::recent_strength_groups`]: one query,
/// answered from `idx_strength_signatures_group` alone. The activity id is the
/// bare column of the row `MAX(done_at)` picks, so it is the latest session's.
pub(crate) const RECENT_GROUPS_SQL: &str = "SELECT signature, COUNT(*), MAX(done_at), activity_id
     FROM strength_signatures
     GROUP BY signature
     ORDER BY 3 DESC, signature
     LIMIT ?1";

/// Sessions that did the same exercises, and what the latest of them looked like.
#[derive(Clone, Debug)]
pub struct StrengthGroup {
    /// The sorted exercise set, `category.name` joined by commas.
    pub signature: String,
    /// How many sessions did exactly these exercises.
    pub times: u32,
    /// The day of the latest of them.
    pub last_done: i64,
    pub latest_activity_id: String,
    /// The muscles the latest session worked, as its feed card shades them.
    pub muscles: Vec<FfiMuscleGroup>,
    /// The equipment of the exercises, each kind once, in catalogue order.
    pub equipment: Vec<Equipment>,
}

/// The signature of a set of exercises, or `None` for a session that used none.
pub(crate) fn signature_of(sequence: &[ExerciseKey]) -> Option<String> {
    let mut keys: Vec<ExerciseKey> = sequence.to_vec();
    keys.sort();
    keys.dedup();
    if keys.is_empty() {
        return None;
    }
    Some(
        keys.iter()
            .map(|key| format!("{}.{}", key.category, key.name))
            .collect::<Vec<_>>()
            .join(","),
    )
}

/// The exercises a signature names, in its order.
fn exercises_of(signature: &str) -> impl Iterator<Item = (u16, Option<u16>)> + '_ {
    signature.split(',').filter_map(|part| {
        let (category, name) = part.split_once('.')?;
        let category = category.parse::<u16>().ok()?;
        Some((category, name.parse::<u16>().ok()))
    })
}

/// Store the signature of a session whose sets have just changed, from the
/// exercises it now uses, or take it out when it uses none.
pub(crate) fn refresh(
    conn: &Connection,
    activity_id: &str,
    sequence: &[ExerciseKey],
) -> SqlResult<()> {
    let Some(signature) = signature_of(sequence) else {
        conn.prepare_cached("DELETE FROM strength_signatures WHERE activity_id = ?1")?
            .execute([activity_id])?;
        return Ok(());
    };
    conn.prepare_cached(
        "INSERT OR REPLACE INTO strength_signatures (activity_id, signature, done_at)
         VALUES (?1, ?2, COALESCE(
             (SELECT date FROM activity_metrics WHERE activity_id = ?1),
             (SELECT MIN(start_time) FROM exercise_sets WHERE activity_id = ?1),
             0))",
    )?
    .execute(params![activity_id, signature])?;
    Ok(())
}

/// Rebuild the table from the sets, for a library that held sets before it existed.
pub(crate) fn rebuild(conn: &Connection) -> SqlResult<()> {
    conn.execute("DELETE FROM strength_signatures", [])?;
    let activity_ids: Vec<String> = conn
        .prepare("SELECT DISTINCT activity_id FROM exercise_sets")?
        .query_map([], |row| row.get(0))?
        .collect::<SqlResult<_>>()?;
    for id in &activity_ids {
        refresh(conn, id, &session_sequence(conn, id)?)?;
    }
    Ok(())
}

fn equipment_of(signature: &str) -> Vec<Equipment> {
    let mut kinds: Vec<Equipment> = exercises_of(signature)
        .filter_map(|(category, name)| catalogue::lookup(category, name?))
        .map(|exercise| exercise.equipment)
        .collect();
    kinds.sort();
    kinds.dedup();
    kinds
}

/// The last `limit` groups, newest first.
pub(crate) fn recent(conn: &Connection, limit: usize) -> SqlResult<Vec<StrengthGroup>> {
    let rows: Vec<(String, i64, i64, String)> = conn
        .prepare_cached(RECENT_GROUPS_SQL)?
        .query_map([limit as i64], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<SqlResult<_>>()?;
    let latest: Vec<String> = rows.iter().map(|row| row.3.clone()).collect();
    let mut cards = crate::objects::strength::strength_cards(conn, &latest);
    Ok(rows
        .into_iter()
        .map(|(signature, times, last_done, latest_activity_id)| {
            let muscles = cards
                .iter_mut()
                .find(|card| card.activity_id == latest_activity_id)
                .map(|card| std::mem::take(&mut card.muscles))
                .unwrap_or_default();
            StrengthGroup {
                equipment: equipment_of(&signature),
                signature,
                times: times as u32,
                last_done,
                latest_activity_id,
                muscles,
            }
        })
        .collect())
}

impl PersistentEngine {
    /// The last [`RECENT_GROUP_LIMIT`] groups of strength sessions that did the
    /// same exercises, the most recently done first.
    pub fn recent_strength_groups(&self) -> SqlResult<Vec<StrengthGroup>> {
        recent(&self.db, RECENT_GROUP_LIMIT)
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

    fn dated(engine: &PersistentEngine, id: &str, date: i64) {
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
    }

    /// A strength session dated `date`, doing `exercises` in order, one active set each.
    fn session(engine: &PersistentEngine, id: &str, date: i64, exercises: &[(u16, u16)]) {
        dated(engine, id, date);
        let sets: Vec<_> = exercises
            .iter()
            .enumerate()
            .map(|(i, &e)| set_of(i as u32, e, 0))
            .collect();
        engine.store_exercise_sets(id, &sets).unwrap();
    }

    fn groups(engine: &PersistentEngine) -> Vec<(String, u32, String)> {
        engine
            .recent_strength_groups()
            .unwrap()
            .into_iter()
            .map(|g| (g.signature, g.times, g.latest_activity_id))
            .collect()
    }

    #[test]
    fn the_same_exercises_in_another_order_are_one_group() {
        let (_dir, engine) = engine();
        session(&engine, "first", NOW - 9 * DAY, &[BENCH, ROW, SQUAT]);
        session(&engine, "second", NOW - 2 * DAY, &[SQUAT, BENCH, ROW]);

        assert_eq!(
            groups(&engine),
            vec![("0.1,23.2,28.3".to_string(), 2, "second".to_string())]
        );
    }

    #[test]
    fn a_session_with_one_extra_exercise_is_its_own_group() {
        let (_dir, engine) = engine();
        session(&engine, "base", NOW - 9 * DAY, &[BENCH, ROW]);
        session(&engine, "extra", NOW - 2 * DAY, &[BENCH, ROW, CURL]);

        let found = groups(&engine);
        assert_eq!(found.len(), 2);
        assert_eq!(
            found[0],
            ("0.1,7.4,23.2".to_string(), 1, "extra".to_string())
        );
        assert_eq!(found[1], ("0.1,23.2".to_string(), 1, "base".to_string()));
    }

    #[test]
    fn repeated_sets_of_one_exercise_count_once() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - DAY, &[BENCH, BENCH, ROW, BENCH]);
        session(&engine, "b", NOW, &[ROW, BENCH]);

        assert_eq!(groups(&engine).len(), 1);
        assert_eq!(groups(&engine)[0].1, 2);
    }

    #[test]
    fn rest_and_unnamed_sets_do_not_enter_the_signature() {
        let (_dir, engine) = engine();
        dated(&engine, "a", NOW);
        let unnamed = FitExerciseSet {
            exercise_name: None,
            ..set_of(2, (0xFFFE, 0), 0)
        };
        engine
            .store_exercise_sets("a", &[set_of(0, BENCH, 0), set_of(1, ROW, 1), unnamed])
            .unwrap();

        assert_eq!(groups(&engine)[0].0, "0.1");
    }

    #[test]
    fn a_session_with_no_named_active_set_has_no_group() {
        let (_dir, engine) = engine();
        dated(&engine, "rest", NOW);
        engine
            .store_exercise_sets("rest", &[set_of(0, BENCH, 1)])
            .unwrap();

        assert!(groups(&engine).is_empty());
    }

    #[test]
    fn storing_a_session_again_replaces_its_signature() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - DAY, &[BENCH, ROW]);
        session(&engine, "a", NOW - DAY, &[BENCH, CURL]);

        assert_eq!(
            groups(&engine),
            vec![("0.1,7.4".to_string(), 1, "a".to_string())]
        );
    }

    #[test]
    fn removing_a_session_takes_it_out_of_its_group() {
        let (_dir, mut engine) = engine();
        session(&engine, "a", NOW - 2 * DAY, &[BENCH, ROW]);
        session(&engine, "b", NOW - DAY, &[ROW, BENCH]);
        engine.remove_activity("b").unwrap();

        assert_eq!(
            groups(&engine),
            vec![("0.1,23.2".to_string(), 1, "a".to_string())]
        );
    }

    #[test]
    fn the_read_lists_ten_groups_newest_first() {
        let (_dir, engine) = engine();
        for i in 0..12u16 {
            session(
                &engine,
                &format!("s{i}"),
                NOW - (30 - i64::from(i)) * DAY,
                &[(0, i + 1)],
            );
        }

        let found = groups(&engine);
        assert_eq!(found.len(), RECENT_GROUP_LIMIT);
        assert_eq!(found[0].2, "s11");
        assert_eq!(found[9].2, "s2");
    }

    #[test]
    fn a_group_orders_by_its_latest_session_not_its_count() {
        let (_dir, engine) = engine();
        for i in 0..3 {
            session(&engine, &format!("old{i}"), NOW - (20 + i) * DAY, &[BENCH]);
        }
        session(&engine, "new", NOW - DAY, &[ROW]);

        let found = groups(&engine);
        assert_eq!(found[0].0, "23.2");
        assert_eq!(found[1].1, 3);
    }

    #[test]
    fn a_group_carries_the_muscles_of_its_latest_session_and_the_equipment_once() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW - DAY, &[BENCH, SQUAT]);

        let group = &engine.recent_strength_groups().unwrap()[0];
        let expected = crate::objects::strength::strength_cards(&engine.db, &["a".to_string()]);
        assert!(!group.muscles.is_empty());
        assert_eq!(
            group
                .muscles
                .iter()
                .map(|m| (&m.slug, m.intensity))
                .collect::<Vec<_>>(),
            expected[0]
                .muscles
                .iter()
                .map(|m| (&m.slug, m.intensity))
                .collect::<Vec<_>>()
        );
        let mut sorted = group.equipment.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(group.equipment, sorted);
        let wanted: std::collections::BTreeSet<_> = [BENCH, SQUAT]
            .iter()
            .map(|&(c, n)| catalogue::lookup(c, n).unwrap().equipment)
            .collect();
        assert_eq!(
            group
                .equipment
                .iter()
                .copied()
                .collect::<std::collections::BTreeSet<_>>(),
            wanted
        );
    }

    #[test]
    fn the_read_runs_on_the_index_alone() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW, &[BENCH]);

        let plan: Vec<String> = engine
            .db
            .prepare(&format!("EXPLAIN QUERY PLAN {RECENT_GROUPS_SQL}"))
            .unwrap()
            .query_map([10], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<SqlResult<_>>()
            .unwrap();
        let plan = plan.join("\n");
        assert!(
            plan.contains("COVERING INDEX idx_strength_signatures_group"),
            "{plan}"
        );
        assert!(
            !plan.contains("GROUP BY"),
            "no temp tree for the grouping: {plan}"
        );
    }

    #[test]
    fn a_session_without_a_metrics_row_is_dated_by_its_first_set() {
        let (_dir, engine) = engine();
        let mut set = set_of(0, BENCH, 0);
        set.start_time = Some(NOW - 5 * DAY);
        engine.store_exercise_sets("bare", &[set]).unwrap();

        assert_eq!(
            engine.recent_strength_groups().unwrap()[0].last_done,
            NOW - 5 * DAY
        );
    }

    #[test]
    fn deleting_a_recorded_sessions_sets_directly_leaves_no_signature() {
        let (_dir, engine) = engine();
        session(&engine, "a", NOW, &[BENCH]);
        crate::persistence::strength::delete_exercise_sets(&engine.db, "a").unwrap();

        assert!(groups(&engine).is_empty());
        assert!(engine.ranked_exercises(NOW).unwrap().is_empty());
    }
}
