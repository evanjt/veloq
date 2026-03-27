//! Strength training: exercise set storage and FIT file processing status.

use rusqlite::{Result as SqlResult, params};
use crate::fit::FitExerciseSet;

use super::PersistentRouteEngine;

impl PersistentRouteEngine {
    /// Store parsed exercise sets for an activity.
    pub fn store_exercise_sets(&self, activity_id: &str, sets: &[FitExerciseSet]) -> SqlResult<()> {
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

    /// Mark a FIT file as processed for an activity.
    pub fn mark_fit_processed(&self, activity_id: &str, has_sets: bool) -> SqlResult<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO fit_file_status (activity_id, processed_at, has_sets)
             VALUES (?, ?, ?)",
            params![
                activity_id,
                chrono::Utc::now().timestamp(),
                has_sets as i32,
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
}
