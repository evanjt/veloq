//! The FIT intake: which activities owe their file, what each sport takes from
//! it (a strength session's sets, a pool swim's lengths), and the verdict.

use crate::fit::{FitExerciseSet, FitPoolSwim};
use rusqlite::{Result as SqlResult, params};

use super::PersistentEngine;

/// A settled verdict on an activity's FIT file. Only these four reach
/// `fit_file_status`; a retryable download failure records nothing at all, which
/// is what leaves the activity in the owed queue.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FitOutcome {
    /// Downloaded and parsed, and it carried what its sport reads: exercise
    /// sets for a strength session, lengths for a pool swim.
    Parsed,
    /// Downloaded and parsed, and it genuinely carries none of them.
    Empty,
    /// Upstream has no FIT file for this activity, and never will.
    Absent,
    /// Downloaded, and the decoder refused it. Kept apart from `Empty` so a
    /// release whose decoder reads the file can queue these activities again.
    Undecodable,
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
            FitOutcome::Undecodable => "undecodable",
        }
    }
}

/// What an activity's FIT file is read for, decided by its sport.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FitIntake {
    /// A strength session's exercise sets.
    Strength,
    /// A pool swim's lengths and pool length.
    PoolSwim,
}

impl FitIntake {
    /// The intake for a sport. Every sport but a pool swim reads as strength;
    /// an open-water swim has no lengths to read.
    pub fn for_sport(sport: Option<&str>) -> FitIntake {
        match sport {
            Some("Swim") => FitIntake::PoolSwim,
            _ => FitIntake::Strength,
        }
    }
}

/// The sports whose activities are owed a FIT download, as an SQL list. One
/// per intake, so the queue and [`FitIntake::for_sport`] name the same sports.
const OWED_FIT_SPORTS: &str = "('WeightTraining', 'Swim')";

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
            Ok(()) => super::commit_write_txn(&self.db)?,
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

    /// Store the sets a FIT file gave an activity and settle its verdict:
    /// parsed when it carried any, empty when it carried none.
    pub fn settle_exercise_sets(
        &self,
        activity_id: &str,
        sets: &[FitExerciseSet],
    ) -> SqlResult<()> {
        let outcome = if sets.is_empty() {
            FitOutcome::Empty
        } else {
            FitOutcome::Parsed
        };
        self.store_exercise_sets(activity_id, sets)?;
        self.mark_fit_outcome(activity_id, outcome)
    }

    /// Store the lengths and pool length a FIT file gave a pool swim and settle
    /// its verdict in the same transaction: parsed when it had lengths, empty
    /// when it had none. A second read replaces the first.
    pub fn settle_pool_swim(&self, activity_id: &str, swim: &FitPoolSwim) -> SqlResult<()> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match self.write_pool_swim(activity_id, swim) {
            Ok(()) => super::commit_write_txn(&self.db),
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    fn write_pool_swim(&self, activity_id: &str, swim: &FitPoolSwim) -> SqlResult<()> {
        self.db.execute(
            "DELETE FROM swim_lengths WHERE activity_id = ?",
            params![activity_id],
        )?;
        self.db.execute(
            "DELETE FROM pool_swims WHERE activity_id = ?",
            params![activity_id],
        )?;
        let outcome = if swim.lengths.is_empty() {
            FitOutcome::Empty
        } else {
            let mut stmt = self.db.prepare(
                "INSERT INTO swim_lengths
                 (activity_id, length_index, start_time, elapsed_secs, timer_secs,
                  length_type, swim_stroke, total_strokes, avg_speed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;
            for (index, length) in swim.lengths.iter().enumerate() {
                stmt.execute(params![
                    activity_id,
                    index as i64,
                    length.start_time,
                    length.total_elapsed_time,
                    length.total_timer_time,
                    length.length_type,
                    length.swim_stroke,
                    length.total_strokes,
                    length.avg_speed,
                ])?;
            }
            self.db.execute(
                "INSERT INTO pool_swims (activity_id, pool_length_m) VALUES (?, ?)",
                params![activity_id, swim.pool_length_m],
            )?;
            FitOutcome::Parsed
        };
        self.mark_fit_outcome(activity_id, outcome)
    }

    /// What the activity's FIT file is read for, from its sport. An id the
    /// library does not hold reads as strength.
    pub fn fit_intake(&self, activity_id: &str) -> SqlResult<FitIntake> {
        pooled::fit_intake(&self.db, activity_id)
    }

    /// Get cached exercise sets for an activity.
    pub fn get_exercise_sets(&self, activity_id: &str) -> SqlResult<Vec<FitExerciseSet>> {
        pooled::exercise_sets(&self.db, activity_id)
    }

    /// Record a SETTLED verdict for an activity's FIT file. A row here excludes
    /// the activity from every retry path, so only a verdict that will not change
    /// on a later attempt may be written: parsed, empty, absent upstream, or
    /// refused by this build's decoder. A download that failed for any other
    /// reason writes nothing and is retried.
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
        pooled::is_fit_processed(&self.db, activity_id)
    }

    /// Strength activities owed a FIT download, newest first. The strength tab
    /// counts its owed sessions from this, so it holds strength alone.
    pub fn get_unprocessed_strength_ids(&self) -> SqlResult<Vec<String>> {
        pooled::unprocessed_strength_queue(&self.db)
    }

    /// Every activity owed a FIT download, of any sport that reads one, newest
    /// first.
    pub fn owed_fit_ids(&self) -> SqlResult<Vec<String>> {
        pooled::owed_fit_queue(&self.db)
    }

    /// Get all exercise sets for WeightTraining activities within a date range.
    /// Joins exercise_sets with activity_metrics to filter by date (Unix timestamp) and sport type.
    /// Returns (activity_id, FitExerciseSet) pairs for active sets only.
    pub fn get_exercise_sets_in_range(
        &self,
        start_ts: i64,
        end_ts: i64,
    ) -> SqlResult<Vec<(String, FitExerciseSet)>> {
        pooled::exercise_sets_in_range(&self.db, start_ts, end_ts)
    }

    /// Count WeightTraining activities that have exercise set data.
    pub fn get_strength_activity_count(&self) -> SqlResult<u32> {
        pooled::strength_activity_count(&self.db)
    }

    /// Get activity name and date for a set of activity IDs.
    /// Returns a HashMap from activity_id to (name, date).
    pub fn get_activity_names(
        &self,
        activity_ids: &[String],
    ) -> SqlResult<std::collections::HashMap<String, (String, i64)>> {
        pooled::activity_names(&self.db, activity_ids)
    }
}

/// A yard in metres.
const YARD_M: f64 = 0.9144;

/// The unit a pool of this many metres is measured in: yards when the length
/// is a whole number of yards and not a whole number of metres, as a 25 yd
/// pool's 22.86 m is.
fn pool_unit_of(pool_length_m: Option<f64>) -> crate::FfiPoolUnit {
    let whole = |v: f64| (v - v.round()).abs() < 0.01;
    match pool_length_m {
        Some(m) if !whole(m) && whole(m / YARD_M) => crate::FfiPoolUnit::Yards,
        _ => crate::FfiPoolUnit::Metres,
    }
}

/// Shape a pool swim's stored lengths into what the screen paints: each
/// length's speed and SWOLF, and the per-stroke totals over the active ones,
/// so the screen computes and sums nothing.
///
/// A length's time is its elapsed time, the timer time when that is missing.
/// Its speed is the pool length over that time, the device's own average when
/// the pool length is unknown. A rest has neither speed nor SWOLF.
pub(crate) fn shape_pool_swim(
    state: crate::FfiPoolSwimState,
    pool_length_m: Option<f64>,
    lengths: &[crate::fit::FitPoolLength],
) -> crate::FfiPoolSwim {
    let positive = |v: f64| (v.is_finite() && v > 0.0).then_some(v);
    let pool = pool_length_m.and_then(positive);

    let shaped: Vec<crate::FfiPoolLength> = lengths
        .iter()
        .enumerate()
        .map(|(index, length)| {
            // The profile's LengthType: 0 is idle, which is a rest.
            let active = length.length_type != Some(0);
            let elapsed = length.total_elapsed_time.or(length.total_timer_time);
            let speed = if active {
                match (pool, elapsed.and_then(positive)) {
                    (Some(metres), Some(secs)) => Some(metres / secs),
                    (None, _) => length.avg_speed.and_then(positive),
                    _ => None,
                }
            } else {
                None
            };
            let swolf = if active {
                elapsed
                    .zip(length.total_strokes)
                    .map(|(secs, strokes)| secs + f64::from(strokes))
            } else {
                None
            };
            crate::FfiPoolLength {
                index: index as u32,
                active,
                stroke: if active { length.swim_stroke } else { None },
                stroke_key: active.then(|| {
                    length
                        .swim_stroke
                        .map_or("unknown", crate::fit::swim_stroke_key)
                        .to_string()
                }),
                elapsed_secs: elapsed,
                strokes: if active { length.total_strokes } else { None },
                speed_mps: speed,
                swolf,
            }
        })
        .collect();

    let mut totals: Vec<(crate::FfiPoolStrokeTotal, f64, u32)> = Vec::new();
    for length in shaped.iter().filter(|l| l.active) {
        let key = length.stroke_key.clone().unwrap_or_default();
        let at = match totals.iter().position(|(t, _, _)| t.stroke_key == key) {
            Some(at) => at,
            None => {
                totals.push((
                    crate::FfiPoolStrokeTotal {
                        stroke: length.stroke,
                        stroke_key: key,
                        lengths: 0,
                        distance_m: None,
                        elapsed_secs: 0.0,
                        speed_mps: None,
                        avg_swolf: None,
                    },
                    0.0,
                    0,
                ));
                totals.len() - 1
            }
        };
        let (total, swolf_sum, swolf_count) = &mut totals[at];
        total.lengths += 1;
        total.elapsed_secs += length.elapsed_secs.unwrap_or(0.0);
        if let Some(swolf) = length.swolf {
            *swolf_sum += swolf;
            *swolf_count += 1;
        }
    }
    let stroke_totals = totals
        .into_iter()
        .map(|(mut total, swolf_sum, swolf_count)| {
            total.distance_m = pool.map(|metres| metres * f64::from(total.lengths));
            total.speed_mps = total
                .distance_m
                .zip(positive(total.elapsed_secs))
                .map(|(metres, secs)| metres / secs);
            total.avg_swolf = (swolf_count > 0).then(|| swolf_sum / f64::from(swolf_count));
            total
        })
        .collect();

    crate::FfiPoolSwim {
        state,
        pool_length_m: pool,
        pool_unit: pool_unit_of(pool),
        lengths: shaped,
        stroke_totals,
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

    /// Scenario: the section history panel draws a chip per traversal and holds
    /// only the activity ids.
    ///
    /// Expected behaviour: one read answers for the ids it knows and says
    /// nothing about the rest, so a caller can fall back to the id rather than
    /// draw an empty chip. This had no test at all until the panel needed it.
    #[test]
    fn activity_names_answers_only_the_ids_it_knows() {
        let (_dir, engine) = engine();
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                     elapsed_time, elevation_gain, sport_type)
                 VALUES ('a1', 'Sunday hills', 1700, 0, 0, 0, 0, 'Ride')",
                [],
            )
            .unwrap();

        let names = engine
            .get_activity_names(&["a1".to_string(), "missing".to_string()])
            .unwrap();

        assert_eq!(names.len(), 1);
        assert_eq!(
            names.get("a1"),
            Some(&("Sunday hills".to_string(), 1700_i64))
        );
    }

    fn add_activity(engine: &PersistentEngine, id: &str, sport: &str, date: i64) {
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                     elapsed_time, elevation_gain, sport_type)
                 VALUES (?1, 'n', ?2, 0, 0, 0, 0, ?3)",
                params![id, date, sport],
            )
            .unwrap();
    }

    fn rows(engine: &PersistentEngine, table: &str, id: &str) -> i64 {
        engine
            .db
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE activity_id = ?1"),
                params![id],
                |r| r.get(0),
            )
            .unwrap()
    }

    fn outcome(engine: &PersistentEngine, id: &str) -> Option<String> {
        engine
            .db
            .query_row(
                "SELECT outcome FROM fit_file_status WHERE activity_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok()
    }

    /// Scenario: a library holds a strength session, a pool swim and an
    /// open-water swim, none of whose files has been read.
    ///
    /// Expected behaviour: the strength session and the pool swim are owed a
    /// download, newest first, and the open-water swim, which has no lengths to
    /// read, is not.
    #[test]
    fn a_pool_swim_is_owed_its_file_and_an_open_water_swim_is_not() {
        let (_dir, engine) = engine();
        add_activity(&engine, "lift", "WeightTraining", 100);
        add_activity(&engine, "pool", "Swim", 200);
        add_activity(&engine, "lake", "OpenWaterSwim", 300);
        add_activity(&engine, "ride", "Ride", 400);

        assert_eq!(engine.owed_fit_ids().unwrap(), vec!["pool", "lift"]);
    }

    /// The strength tab counts its owed sessions from this list, so a swim in it
    /// would keep the tab promising sets that never come.
    #[test]
    fn the_strength_queue_still_holds_strength_alone() {
        let (_dir, engine) = engine();
        add_activity(&engine, "lift", "WeightTraining", 100);
        add_activity(&engine, "pool", "Swim", 200);

        assert_eq!(engine.get_unprocessed_strength_ids().unwrap(), vec!["lift"]);
    }

    #[test]
    fn the_intake_follows_the_sport() {
        let (_dir, engine) = engine();
        add_activity(&engine, "lift", "WeightTraining", 100);
        add_activity(&engine, "pool", "Swim", 200);

        assert_eq!(engine.fit_intake("pool").unwrap(), FitIntake::PoolSwim);
        assert_eq!(engine.fit_intake("lift").unwrap(), FitIntake::Strength);
        assert_eq!(
            engine.fit_intake("unknown").unwrap(),
            FitIntake::Strength,
            "an id the library does not hold is read as it always was"
        );
    }

    /// Scenario: the pool fixture, five lengths of a 25 m pool with one rest,
    /// is stored for a pool swim.
    ///
    /// Expected behaviour: every length and the pool length are written, the
    /// verdict is parsed, all in one commit, and the swim leaves the queue.
    #[test]
    fn a_pool_swim_file_stores_its_lengths_and_leaves_the_queue() {
        let (_dir, engine) = engine();
        add_activity(&engine, "pool", "Swim", 200);
        let swim = crate::fit::parse_fit_pool_swim(&crate::fit::pool_swim_fit()).unwrap();

        let commits = commit_counter::watch(&engine);
        engine.settle_pool_swim("pool", &swim).unwrap();

        assert_eq!(commit_counter::count(&commits), 1);
        assert_eq!(rows(&engine, "swim_lengths", "pool"), 5);
        let pool_length: Option<f64> = engine
            .db
            .query_row(
                "SELECT pool_length_m FROM pool_swims WHERE activity_id = 'pool'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pool_length, Some(25.0));
        assert_eq!(outcome(&engine, "pool").as_deref(), Some("parsed"));
        assert!(engine.owed_fit_ids().unwrap().is_empty());
    }

    /// A stored length as the test reads it back: index, type, stroke, strokes
    /// and speed.
    type StoredLength = (i64, Option<i64>, Option<i64>, Option<i64>, Option<f64>);

    /// Each length keeps its place in the file and every field the parser read.
    #[test]
    fn a_stored_length_keeps_its_order_and_fields() {
        let (_dir, engine) = engine();
        let swim = crate::fit::parse_fit_pool_swim(&crate::fit::pool_swim_fit()).unwrap();

        engine.settle_pool_swim("pool", &swim).unwrap();

        let stored: Vec<StoredLength> = engine
            .db
            .prepare(
                "SELECT length_index, length_type, swim_stroke, total_strokes, avg_speed
                 FROM swim_lengths WHERE activity_id = 'pool' ORDER BY length_index",
            )
            .unwrap()
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        let expected: Vec<StoredLength> = swim
            .lengths
            .iter()
            .enumerate()
            .map(|(i, l)| {
                (
                    i as i64,
                    l.length_type.map(i64::from),
                    l.swim_stroke.map(i64::from),
                    l.total_strokes.map(i64::from),
                    l.avg_speed,
                )
            })
            .collect();
        assert_eq!(stored, expected);
        assert_eq!(stored[2].1, Some(0), "the third length is the rest");
    }

    /// A file with no lengths, such as a ride's, is a swim with nothing to
    /// show, and leaves nothing behind.
    #[test]
    fn a_file_with_no_lengths_settles_a_swim_empty_with_no_rows() {
        let (_dir, engine) = engine();
        add_activity(&engine, "pool", "Swim", 200);
        let ride = crate::fit::parse_fit_pool_swim(&crate::fit::recorded_ride_fit()).unwrap();

        engine.settle_pool_swim("pool", &ride).unwrap();

        assert_eq!(outcome(&engine, "pool").as_deref(), Some("empty"));
        assert_eq!(rows(&engine, "swim_lengths", "pool"), 0);
        assert_eq!(rows(&engine, "pool_swims", "pool"), 0);
        assert!(engine.owed_fit_ids().unwrap().is_empty());
    }

    /// A second read of the same activity replaces the first rather than
    /// leaving a longer earlier file's lengths behind it.
    #[test]
    fn storing_a_swim_again_replaces_its_lengths() {
        let (_dir, engine) = engine();
        let swim = crate::fit::parse_fit_pool_swim(&crate::fit::pool_swim_fit()).unwrap();
        engine.settle_pool_swim("pool", &swim).unwrap();

        let none = crate::fit::FitPoolSwim::default();
        engine.settle_pool_swim("pool", &none).unwrap();

        assert_eq!(rows(&engine, "swim_lengths", "pool"), 0);
        assert_eq!(rows(&engine, "pool_swims", "pool"), 0);
        assert_eq!(outcome(&engine, "pool").as_deref(), Some("empty"));
    }

    /// The lengths and the verdict are one write: a failure part way leaves
    /// neither, so the swim stays owed rather than settled with half its file.
    #[test]
    fn a_failed_swim_write_leaves_no_verdict() {
        let (_dir, engine) = engine();
        add_activity(&engine, "pool", "Swim", 200);
        engine.db.execute_batch("DROP TABLE pool_swims").unwrap();
        let swim = crate::fit::parse_fit_pool_swim(&crate::fit::pool_swim_fit()).unwrap();

        assert!(engine.settle_pool_swim("pool", &swim).is_err());
        assert!(engine.db.is_autocommit());
        assert_eq!(rows(&engine, "swim_lengths", "pool"), 0);
        assert_eq!(outcome(&engine, "pool"), None);
        assert_eq!(engine.owed_fit_ids().unwrap(), vec!["pool"]);
    }

    fn close(a: Option<f64>, b: f64) -> bool {
        a.is_some_and(|a| (a - b).abs() < 1e-9)
    }

    /// Scenario: the pool fixture, two freestyle lengths, a 30 s rest and two
    /// breaststroke lengths of a 25 m pool, is stored for a pool swim.
    ///
    /// Expected behaviour: the screen's read holds all five in order with the
    /// rest flagged, each active length's SWOLF its elapsed seconds plus its
    /// strokes and its speed the pool length over its time, and one total per
    /// stroke summing that stroke's active lengths.
    #[test]
    fn a_read_pool_swim_carries_its_lengths_swolf_and_stroke_totals() {
        let (_dir, engine) = engine();
        add_activity(&engine, "pool", "Swim", 200);
        let swim = crate::fit::parse_fit_pool_swim(&crate::fit::pool_swim_fit()).unwrap();
        engine.settle_pool_swim("pool", &swim).unwrap();

        let read = pooled::pool_swim(&engine.db, "pool").unwrap().unwrap();

        assert_eq!(read.state, crate::FfiPoolSwimState::Read);
        assert_eq!(read.pool_length_m, Some(25.0));
        assert_eq!(read.pool_unit, crate::FfiPoolUnit::Metres);
        let shape: Vec<(u32, bool, Option<&str>, Option<u16>)> = read
            .lengths
            .iter()
            .map(|l| (l.index, l.active, l.stroke_key.as_deref(), l.strokes))
            .collect();
        assert_eq!(
            shape,
            vec![
                (0, true, Some("freestyle"), Some(18)),
                (1, true, Some("freestyle"), Some(19)),
                (2, false, None, None),
                (3, true, Some("breaststroke"), Some(14)),
                (4, true, Some("breaststroke"), Some(15)),
            ]
        );
        let swolf: Vec<Option<f64>> = read.lengths.iter().map(|l| l.swolf).collect();
        assert_eq!(
            swolf,
            vec![Some(43.0), Some(45.5), None, Some(46.0), Some(46.25)]
        );
        let elapsed: Vec<Option<f64>> = read.lengths.iter().map(|l| l.elapsed_secs).collect();
        assert_eq!(
            elapsed,
            vec![Some(25.0), Some(26.5), Some(30.0), Some(32.0), Some(31.25)],
            "a rest keeps its duration"
        );
        assert!(close(read.lengths[0].speed_mps, 1.0));
        assert!(close(read.lengths[1].speed_mps, 25.0 / 26.5));
        assert_eq!(read.lengths[2].speed_mps, None, "a rest has no speed");
        assert!(close(read.lengths[3].speed_mps, 25.0 / 32.0));
        assert!(close(read.lengths[4].speed_mps, 0.8));

        assert_eq!(read.stroke_totals.len(), 2);
        let free = &read.stroke_totals[0];
        assert_eq!(
            (free.stroke_key.as_str(), free.stroke),
            ("freestyle", Some(0))
        );
        assert_eq!(free.lengths, 2);
        assert_eq!(free.distance_m, Some(50.0));
        assert_eq!(free.elapsed_secs, 51.5);
        assert!(close(free.speed_mps, 50.0 / 51.5));
        assert_eq!(free.avg_swolf, Some(44.25));
        let breast = &read.stroke_totals[1];
        assert_eq!(
            (breast.stroke_key.as_str(), breast.stroke),
            ("breaststroke", Some(2))
        );
        assert_eq!(breast.lengths, 2);
        assert_eq!(breast.distance_m, Some(50.0));
        assert_eq!(breast.elapsed_secs, 63.25);
        assert_eq!(breast.avg_swolf, Some(46.125));
        let active = read.lengths.iter().filter(|l| l.active).count() as u32;
        assert_eq!(
            read.stroke_totals.iter().map(|t| t.lengths).sum::<u32>(),
            active
        );
    }

    /// A swim whose file has not been read is owed, with nothing to show yet,
    /// and one settled without lengths is told apart from it.
    #[test]
    fn a_pool_swim_reads_owed_until_settled_and_none_once_settled_empty() {
        let (_dir, engine) = engine();
        add_activity(&engine, "pool", "Swim", 200);

        let owed = pooled::pool_swim(&engine.db, "pool").unwrap().unwrap();
        assert_eq!(owed.state, crate::FfiPoolSwimState::Owed);
        assert!(owed.lengths.is_empty() && owed.stroke_totals.is_empty());

        engine
            .settle_pool_swim("pool", &crate::fit::FitPoolSwim::default())
            .unwrap();
        let settled = pooled::pool_swim(&engine.db, "pool").unwrap().unwrap();
        assert_eq!(settled.state, crate::FfiPoolSwimState::NoLengths);
        assert!(settled.lengths.is_empty());

        add_activity(&engine, "gone", "Swim", 300);
        engine.mark_fit_outcome("gone", FitOutcome::Absent).unwrap();
        assert_eq!(
            pooled::pool_swim(&engine.db, "gone")
                .unwrap()
                .unwrap()
                .state,
            crate::FfiPoolSwimState::NoLengths
        );
    }

    /// Only a pool swim has lengths: a ride, an open-water swim and an id the
    /// library does not hold read none at all.
    #[test]
    fn only_a_pool_swim_reads_a_pool_swim() {
        let (_dir, engine) = engine();
        add_activity(&engine, "ride", "Ride", 100);
        add_activity(&engine, "lake", "OpenWaterSwim", 200);

        assert_eq!(pooled::pool_swim(&engine.db, "ride").unwrap(), None);
        assert_eq!(pooled::pool_swim(&engine.db, "lake").unwrap(), None);
        assert_eq!(pooled::pool_swim(&engine.db, "unknown").unwrap(), None);
    }

    /// A 25 yd pool is 22.86 m: its unit reads as yards, and a metre pool,
    /// a 33⅓ m one included, as metres.
    #[test]
    fn a_pool_measured_in_yards_reads_as_yards() {
        assert_eq!(pool_unit_of(Some(22.86)), crate::FfiPoolUnit::Yards);
        assert_eq!(pool_unit_of(Some(45.72)), crate::FfiPoolUnit::Yards);
        assert_eq!(pool_unit_of(Some(25.0)), crate::FfiPoolUnit::Metres);
        assert_eq!(pool_unit_of(Some(50.0)), crate::FfiPoolUnit::Metres);
        assert_eq!(pool_unit_of(Some(100.0 / 3.0)), crate::FfiPoolUnit::Metres);
        assert_eq!(pool_unit_of(None), crate::FfiPoolUnit::Metres);
    }

    /// With no pool length the speed is the device's own and no distance is
    /// claimed; a length with no stroke count has no SWOLF and an active
    /// length with no stroke is totalled as unknown.
    #[test]
    fn a_swim_with_no_pool_length_falls_back_to_the_device_speed() {
        let lengths = vec![crate::fit::FitPoolLength {
            length_type: Some(1),
            total_elapsed_time: Some(20.0),
            avg_speed: Some(1.2),
            ..Default::default()
        }];

        let read = shape_pool_swim(crate::FfiPoolSwimState::Read, None, &lengths);

        assert_eq!(read.lengths[0].speed_mps, Some(1.2));
        assert_eq!(read.lengths[0].swolf, None);
        assert_eq!(read.lengths[0].stroke_key.as_deref(), Some("unknown"));
        assert_eq!(read.stroke_totals[0].stroke_key, "unknown");
        assert_eq!(read.stroke_totals[0].distance_m, None);
        assert_eq!(read.stroke_totals[0].speed_mps, None);
        assert_eq!(read.stroke_totals[0].avg_swolf, None);
    }

    #[test]
    fn activity_names_answers_nothing_for_no_ids() {
        let (_dir, engine) = engine();

        assert!(engine.get_activity_names(&[]).unwrap().is_empty());
    }

    /// The panel asks for every id on the event, and a section with many
    /// traversals asks for many at once.
    #[test]
    fn activity_names_answers_a_whole_batch_in_one_read() {
        let (_dir, engine) = engine();
        for i in 0..25 {
            engine
                .db
                .execute(
                    "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                         elapsed_time, elevation_gain, sport_type)
                     VALUES (?1, ?2, 0, 0, 0, 0, 0, 'Ride')",
                    rusqlite::params![format!("a{i}"), format!("Ride {i}")],
                )
                .unwrap();
        }
        let ids: Vec<String> = (0..25).map(|i| format!("a{i}")).collect();

        let names = engine.get_activity_names(&ids).unwrap();

        assert_eq!(names.len(), 25);
        assert_eq!(names.get("a24").map(|(n, _)| n.as_str()), Some("Ride 24"));
    }
}

/// The strength reads a screen makes, over a pooled connection. The engine
/// methods above delegate here rather than carrying a second copy.
pub(crate) mod pooled {
    use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

    use crate::fit::FitExerciseSet;

    pub(crate) fn exercise_history(
        conn: &Connection,
        exercise_category: u16,
    ) -> SqlResult<Vec<(String, String, i64, FitExerciseSet)>> {
        let mut stmt = conn.prepare(
            "SELECT es.activity_id, am.name, am.date, es.set_order, es.exercise_category,
                    es.exercise_name, es.set_type, es.repetitions, es.weight_kg,
                    es.duration_secs, es.start_time
             FROM exercise_sets es
             INNER JOIN activity_metrics am ON am.activity_id = es.activity_id
             WHERE am.sport_type = 'WeightTraining' AND es.exercise_category = ?
               AND es.set_type = 0
             ORDER BY am.date, es.activity_id, es.set_order",
        )?;
        stmt.query_map([exercise_category], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                FitExerciseSet {
                    set_order: row.get::<_, i32>(3)? as u32,
                    exercise_category: row.get::<_, i32>(4)? as u16,
                    exercise_name: row.get::<_, Option<i32>>(5)?.map(|v| v as u16),
                    set_type: row.get::<_, i32>(6)? as u8,
                    repetitions: row.get::<_, Option<i32>>(7)?.map(|v| v as u16),
                    weight_kg: row.get(8)?,
                    duration_secs: row.get(9)?,
                    start_time: row.get(10)?,
                },
            ))
        })?
        .collect()
    }

    pub(crate) fn exercise_sets_in_range(
        conn: &Connection,
        start_ts: i64,
        end_ts: i64,
    ) -> SqlResult<Vec<(String, FitExerciseSet)>> {
        let mut stmt = conn.prepare(
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

    /// How many WeightTraining activities have at least one working set.
    pub(crate) fn strength_activity_count(conn: &Connection) -> SqlResult<u32> {
        let count: i32 = conn.query_row(
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

    /// One activity's cached sets, in the order they were recorded.
    pub(crate) fn exercise_sets(
        conn: &Connection,
        activity_id: &str,
    ) -> SqlResult<Vec<FitExerciseSet>> {
        let mut stmt = conn.prepare(
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

    /// For a strength activity, whether its FIT file has a recorded outcome.
    /// `None` for any other sport and for an id the library does not hold.
    pub(crate) fn strength_outcome(
        conn: &Connection,
        activity_id: &str,
    ) -> SqlResult<Option<bool>> {
        let row = conn
            .query_row(
                "SELECT COALESCE(m.sport_type = 'WeightTraining', 0),
                        EXISTS(SELECT 1 FROM fit_file_status f WHERE f.activity_id = m.activity_id)
                 FROM activity_metrics m WHERE m.activity_id = ?",
                params![activity_id],
                |row| Ok((row.get::<_, bool>(0)?, row.get::<_, bool>(1)?)),
            )
            .optional()?;
        Ok(row.and_then(|(is_strength, processed)| is_strength.then_some(processed)))
    }

    /// What the activity's FIT file is read for, from its stored sport.
    pub(crate) fn fit_intake(conn: &Connection, activity_id: &str) -> SqlResult<super::FitIntake> {
        let sport: Option<String> = conn
            .query_row(
                "SELECT sport_type FROM activity_metrics WHERE activity_id = ?",
                params![activity_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(super::FitIntake::for_sport(sport.as_deref()))
    }

    /// Every activity of a sport that reads its FIT file and has no recorded
    /// outcome, newest first: the queue the background download drains.
    pub(crate) fn owed_fit_queue(conn: &Connection) -> SqlResult<Vec<String>> {
        let mut stmt = conn.prepare(&format!(
            "SELECT m.activity_id FROM activity_metrics m
             LEFT JOIN fit_file_status f ON f.activity_id = m.activity_id
             WHERE m.sport_type IN {} AND f.activity_id IS NULL
             ORDER BY m.date DESC",
            super::OWED_FIT_SPORTS
        ))?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    /// A pool swim's lengths as the activity detail screen paints them, or
    /// `None` for any sport but `Swim` and for an id the library does not hold.
    ///
    /// Owed while no verdict is stored, read when lengths are, and no lengths
    /// for every other settled verdict.
    pub(crate) fn pool_swim(
        conn: &Connection,
        activity_id: &str,
    ) -> SqlResult<Option<crate::FfiPoolSwim>> {
        let row = conn
            .query_row(
                "SELECT m.sport_type,
                        EXISTS(SELECT 1 FROM fit_file_status f WHERE f.activity_id = m.activity_id),
                        (SELECT p.pool_length_m FROM pool_swims p WHERE p.activity_id = m.activity_id)
                 FROM activity_metrics m WHERE m.activity_id = ?",
                params![activity_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, bool>(1)?,
                        row.get::<_, Option<f64>>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((sport, settled, pool_length_m)) = row else {
            return Ok(None);
        };
        if super::FitIntake::for_sport(Some(&sport)) != super::FitIntake::PoolSwim {
            return Ok(None);
        }

        let mut stmt = conn.prepare(
            "SELECT length_type, swim_stroke, total_strokes, elapsed_secs, timer_secs, avg_speed
             FROM swim_lengths WHERE activity_id = ? ORDER BY length_index",
        )?;
        let lengths = stmt
            .query_map(params![activity_id], |row| {
                Ok(crate::fit::FitPoolLength {
                    start_time: None,
                    length_type: row
                        .get::<_, Option<i64>>(0)?
                        .and_then(|v| u8::try_from(v).ok()),
                    swim_stroke: row
                        .get::<_, Option<i64>>(1)?
                        .and_then(|v| u8::try_from(v).ok()),
                    total_strokes: row
                        .get::<_, Option<i64>>(2)?
                        .and_then(|v| u16::try_from(v).ok()),
                    total_elapsed_time: row.get(3)?,
                    total_timer_time: row.get(4)?,
                    avg_speed: row.get(5)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        let state = if !lengths.is_empty() {
            crate::FfiPoolSwimState::Read
        } else if settled {
            crate::FfiPoolSwimState::NoLengths
        } else {
            crate::FfiPoolSwimState::Owed
        };
        Ok(Some(super::shape_pool_swim(state, pool_length_m, &lengths)))
    }

    /// Whether the activity's FIT file has a settled verdict.
    pub(crate) fn is_fit_processed(conn: &Connection, activity_id: &str) -> SqlResult<bool> {
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM fit_file_status WHERE activity_id = ?",
            params![activity_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Every strength activity with no recorded FIT outcome, newest first, so the periods that end today fill first.
    ///
    /// The caller used to build a candidate list by filtering a whole-library
    /// parsed array in JavaScript for `type === 'WeightTraining'` and ship every
    /// id back over the FFI to be filtered again. The sport is a column here, so
    /// both filters live in the one statement.
    pub(crate) fn unprocessed_strength_queue(conn: &Connection) -> SqlResult<Vec<String>> {
        let mut stmt = conn.prepare(
            "SELECT m.activity_id FROM activity_metrics m
             LEFT JOIN fit_file_status f ON f.activity_id = m.activity_id
             WHERE m.sport_type = 'WeightTraining' AND f.activity_id IS NULL
             ORDER BY m.date DESC",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// How many strength activities dated inside `[start_ts, end_ts]` have no
    /// recorded FIT outcome. The same rows as the queue above, over the window
    /// the period's sets are read from.
    pub(crate) fn unprocessed_strength_count_in_range(
        conn: &Connection,
        start_ts: i64,
        end_ts: i64,
    ) -> SqlResult<u32> {
        conn.query_row(
            "SELECT COUNT(*) FROM activity_metrics m
             LEFT JOIN fit_file_status f ON f.activity_id = m.activity_id
             WHERE m.sport_type = 'WeightTraining' AND f.activity_id IS NULL
               AND m.date >= ? AND m.date <= ?",
            params![start_ts, end_ts],
            |row| row.get(0),
        )
    }

    /// Name and date for each id the library knows, keyed by id. An id it does
    /// not know is simply absent.
    pub(crate) fn activity_names(
        conn: &Connection,
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
        let mut stmt = conn.prepare(&sql)?;
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
