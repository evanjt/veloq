//! Strength training: exercise set storage and FIT file processing status.

use crate::fit::FitExerciseSet;
use rusqlite::{Result as SqlResult, params};

use super::PersistentEngine;

/// A settled verdict on an activity's FIT file. Only these three reach
/// `fit_file_status`; a retryable download failure records nothing at all, which
/// is what leaves the activity in `get_unprocessed_strength_ids`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FitOutcome {
    /// Downloaded and parsed, and it carried exercise sets.
    Parsed,
    /// Downloaded and parsed, and it genuinely carries no sets.
    Empty,
    /// Upstream has no FIT file for this activity, and never will.
    Absent,
}

impl FitOutcome {
    fn has_sets(self) -> bool {
        matches!(self, FitOutcome::Parsed)
    }

    fn as_str(self) -> &'static str {
        match self {
            FitOutcome::Parsed => "parsed",
            FitOutcome::Empty => "empty",
            FitOutcome::Absent => "absent",
        }
    }
}

impl PersistentEngine {
    /// Store parsed exercise sets for an activity.
    pub fn store_exercise_sets(&self, activity_id: &str, sets: &[FitExerciseSet]) -> SqlResult<()> {
        if sets.is_empty() {
            return Ok(());
        }

        // One transaction for the session. A set per autocommit paid an fsync
        // apiece under the engine lock, so a thirty-set session held every
        // screen read out thirty times.
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match self.write_exercise_sets(activity_id, sets) {
            Ok(()) => self.db.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
        Ok(())
    }

    fn write_exercise_sets(&self, activity_id: &str, sets: &[FitExerciseSet]) -> SqlResult<()> {
        let mut stmt = self.db.prepare(
            "INSERT OR REPLACE INTO exercise_sets
             (activity_id, set_order, exercise_category, exercise_name,
              set_type, repetitions, weight_kg, duration_secs, start_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )?;

        for set in sets {
            stmt.execute(params![
                activity_id,
                set.set_order,
                set.exercise_category as i32,
                set.exercise_name.map(|v| v as i32),
                set.set_type as i32,
                set.repetitions.map(|v| v as i32),
                set.weight_kg,
                set.duration_secs,
                set.start_time,
            ])?;
        }

        Ok(())
    }

    /// Get cached exercise sets for an activity.
    pub fn get_exercise_sets(&self, activity_id: &str) -> SqlResult<Vec<FitExerciseSet>> {
        let mut stmt = self.db.prepare(
            "SELECT set_order, exercise_category, exercise_name,
                    set_type, repetitions, weight_kg, duration_secs, start_time
             FROM exercise_sets
             WHERE activity_id = ?
             ORDER BY set_order",
        )?;

        let sets = stmt
            .query_map(params![activity_id], |row| {
                Ok(FitExerciseSet {
                    set_order: row.get::<_, i32>(0)? as u32,
                    exercise_category: row.get::<_, i32>(1)? as u16,
                    exercise_name: row.get::<_, Option<i32>>(2)?.map(|v| v as u16),
                    set_type: row.get::<_, i32>(3)? as u8,
                    repetitions: row.get::<_, Option<i32>>(4)?.map(|v| v as u16),
                    weight_kg: row.get(5)?,
                    duration_secs: row.get(6)?,
                    start_time: row.get(7)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        Ok(sets)
    }

    /// Record a SETTLED verdict for an activity's FIT file. A row here excludes
    /// the activity from every retry path, so only a verdict that will not change
    /// on a later attempt may be written: parsed, empty, or absent upstream. A
    /// download that failed for any other reason writes nothing and is retried.
    pub fn mark_fit_outcome(&self, activity_id: &str, outcome: FitOutcome) -> SqlResult<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO fit_file_status (activity_id, processed_at, has_sets, outcome)
             VALUES (?, ?, ?, ?)",
            params![
                activity_id,
                chrono::Utc::now().timestamp(),
                outcome.has_sets() as i32,
                outcome.as_str(),
            ],
        )?;
        Ok(())
    }

    /// Check if a FIT file has been processed for an activity.
    pub fn is_fit_processed(&self, activity_id: &str) -> SqlResult<bool> {
        let count: i32 = self.db.query_row(
            "SELECT COUNT(*) FROM fit_file_status WHERE activity_id = ?",
            params![activity_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get activity IDs from the input list that have NOT been FIT-processed yet.
    pub fn get_unprocessed_strength_ids(&self, activity_ids: &[String]) -> SqlResult<Vec<String>> {
        if activity_ids.is_empty() {
            return Ok(Vec::new());
        }

        let processed: std::collections::HashSet<String> = {
            let placeholders = activity_ids
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT activity_id FROM fit_file_status WHERE activity_id IN ({})",
                placeholders
            );
            let mut stmt = self.db.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(activity_ids.iter()), |row| {
                row.get::<_, String>(0)
            })?;
            rows.filter_map(|r| r.ok()).collect()
        };

        Ok(activity_ids
            .iter()
            .filter(|id| !processed.contains(id.as_str()))
            .cloned()
            .collect())
    }

    /// Get all exercise sets for WeightTraining activities within a date range.
    /// Joins exercise_sets with activity_metrics to filter by date (Unix timestamp) and sport type.
    /// Returns (activity_id, FitExerciseSet) pairs for active sets only.
    pub fn get_exercise_sets_in_range(
        &self,
        start_ts: i64,
        end_ts: i64,
    ) -> SqlResult<Vec<(String, FitExerciseSet)>> {
        let mut stmt = self.db.prepare(
            "SELECT es.activity_id, es.set_order, es.exercise_category, es.exercise_name,
                    es.set_type, es.repetitions, es.weight_kg, es.duration_secs, es.start_time
             FROM exercise_sets es
             INNER JOIN activity_metrics am ON es.activity_id = am.activity_id
             WHERE am.sport_type = 'WeightTraining'
               AND am.date >= ?
               AND am.date <= ?
               AND es.set_type = 0
             ORDER BY am.date DESC, es.activity_id, es.set_order",
        )?;

        let results = stmt
            .query_map(params![start_ts, end_ts], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    FitExerciseSet {
                        set_order: row.get::<_, i32>(1)? as u32,
                        exercise_category: row.get::<_, i32>(2)? as u16,
                        exercise_name: row.get::<_, Option<i32>>(3)?.map(|v| v as u16),
                        set_type: row.get::<_, i32>(4)? as u8,
                        repetitions: row.get::<_, Option<i32>>(5)?.map(|v| v as u16),
                        weight_kg: row.get(6)?,
                        duration_secs: row.get(7)?,
                        start_time: row.get(8)?,
                    },
                ))
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        Ok(results)
    }

    /// Count WeightTraining activities that have exercise set data.
    pub fn get_strength_activity_count(&self) -> SqlResult<u32> {
        let count: i32 = self.db.query_row(
            "SELECT COUNT(DISTINCT es.activity_id)
             FROM exercise_sets es
             INNER JOIN activity_metrics am ON es.activity_id = am.activity_id
             WHERE am.sport_type = 'WeightTraining'
               AND es.set_type = 0",
            [],
            |row| row.get(0),
        )?;
        Ok(count as u32)
    }

    /// Get activity name and date for a set of activity IDs.
    /// Returns a HashMap from activity_id to (name, date).
    pub fn get_activity_names(
        &self,
        activity_ids: &[String],
    ) -> SqlResult<std::collections::HashMap<String, (String, i64)>> {
        if activity_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        let placeholders = activity_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT activity_id, name, date FROM activity_metrics WHERE activity_id IN ({})",
            placeholders
        );
        let mut stmt = self.db.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(activity_ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;

        let mut result = std::collections::HashMap::new();
        for row in rows {
            let (id, name, date) = row?;
            result.insert(id, (name, date));
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::super::commit_counter;
    use super::*;
    use tempfile::TempDir;

    fn engine() -> (TempDir, PersistentEngine) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        (dir, engine)
    }

    fn set(order: u32) -> FitExerciseSet {
        FitExerciseSet {
            set_order: order,
            exercise_category: 3,
            exercise_name: Some(7),
            set_type: 0,
            repetitions: Some(10),
            weight_kg: Some(60.0),
            duration_secs: Some(45.0),
            start_time: Some(1_700_000_000 + order as i64),
        }
    }

    /// A session's sets were written one autocommit each, so thirty sets was
    /// thirty fsyncs under the engine lock.
    #[test]
    fn a_session_of_sets_is_one_commit() {
        let (_dir, engine) = engine();
        let commits = commit_counter::watch(&engine);

        let sets: Vec<FitExerciseSet> = (0..30).map(set).collect();
        engine.store_exercise_sets("a1", &sets).unwrap();

        assert_eq!(commit_counter::count(&commits), 1);
        assert_eq!(engine.get_exercise_sets("a1").unwrap().len(), 30);
    }

    #[test]
    fn re_storing_the_same_session_is_one_commit() {
        let (_dir, engine) = engine();
        let sets: Vec<FitExerciseSet> = (0..30).map(set).collect();
        engine.store_exercise_sets("a1", &sets).unwrap();

        let commits = commit_counter::watch(&engine);
        engine.store_exercise_sets("a1", &sets).unwrap();

        assert_eq!(commit_counter::count(&commits), 1);
        assert_eq!(engine.get_exercise_sets("a1").unwrap().len(), 30);
    }

    #[test]
    fn a_session_with_no_sets_writes_nothing() {
        let (_dir, engine) = engine();
        let commits = commit_counter::watch(&engine);

        engine.store_exercise_sets("a1", &[]).unwrap();

        assert_eq!(commit_counter::count(&commits), 0);
        assert!(engine.get_exercise_sets("a1").unwrap().is_empty());
    }

    #[test]
    fn a_failed_session_write_leaves_no_sets_behind() {
        let (_dir, engine) = engine();
        engine.db.execute_batch("DROP TABLE exercise_sets").unwrap();

        let sets: Vec<FitExerciseSet> = (0..3).map(set).collect();

        assert!(engine.store_exercise_sets("a1", &sets).is_err());
        assert!(engine.db.is_autocommit());
    }
}
