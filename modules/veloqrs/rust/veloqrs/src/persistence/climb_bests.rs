//! Each climbing activity's best window per length, stored when its inputs move.
//!
//! The climb curve takes a maximum per window over every activity of a sport,
//! and measuring each track on demand misses the tap budget on a cold read. So
//! `activity_climb_bests` holds what [`best_climb_windows`] gives over
//! [`CLIMB_WINDOWS_S`] for each activity, and [`refresh`] is its one writer.
//! Its inputs are the stored track's elevation, the stored time stream and the
//! activity's sport, and every writer of one of those calls it inside the
//! transaction that moved it. A removal takes the rows by cascade.
//!
//! A library stored before the table holds the inputs and no rows. What is owed
//! is read from the tables rather than flagged: a measurable activity with no
//! row. [`start_backfill`] works it off on a thread of its own, in pages.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

use super::codec::{self, TrackRead};
use super::{PersistentEngine, with_persistent_engine_for};
use crate::metrics::vertical_power::{CLIMB_WINDOWS_S, ClimbBest, best_climb_windows};
use crate::objects::start::FfiStartOutcome;
use crate::sport::{UNPOWERED_ELEVATION_EXCLUDED, climbing_family, sql_list};

/// Activities measured under one hold of the engine lock.
const PAGE: usize = 25;

static RUNNING: AtomicBool = AtomicBool::new(false);

thread_local! {
    static REFRESHES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(crate) fn reset_test_refreshes() {
    REFRESHES.with(|count| count.set(0));
}

/// How many activities this thread has measured and rewritten.
#[cfg(test)]
pub(crate) fn refreshes() -> usize {
    REFRESHES.with(std::cell::Cell::get)
}

/// Replace one activity's rows with what its stored inputs give now.
///
/// It gets no rows when its sport is outside its own climbing family, when it
/// has no readable track or no time stream, or when the two differ in length.
/// A window the track cannot measure gets no row.
pub(crate) fn refresh(conn: &Connection, activity_id: &str) -> SqlResult<()> {
    REFRESHES.with(|count| count.set(count.get() + 1));
    let bests = measure(conn, activity_id)?;
    conn.prepare_cached("DELETE FROM activity_climb_bests WHERE activity_id = ?1")?
        .execute(params![activity_id])?;
    let mut insert = conn.prepare_cached(
        "INSERT INTO activity_climb_bests (activity_id, window_s, start_idx, end_idx, vam)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for best in bests {
        insert.execute(params![
            activity_id,
            best.window_s,
            best.start as i64,
            best.end as i64,
            best.vam
        ])?;
    }
    Ok(())
}

fn measure(conn: &Connection, activity_id: &str) -> SqlResult<Vec<ClimbBest>> {
    let Some(sport) = conn
        .query_row(
            "SELECT sport_type FROM activities WHERE id = ?1",
            params![activity_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    else {
        return Ok(Vec::new());
    };
    if !climbing_family(&sport).contains(&sport.as_str()) {
        return Ok(Vec::new());
    }
    // The stream first: a track stored before its stream is the common
    // case on a first sync, and it is not worth decoding the track for.
    let Some(times) = conn
        .query_row(
            "SELECT times FROM time_streams WHERE activity_id = ?1",
            params![activity_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?
    else {
        return Ok(Vec::new());
    };
    // An undecodable stream measures nothing, the same as an absent one.
    let Ok(times) = codec::deserialize::<Vec<u32>>(&times) else {
        return Ok(Vec::new());
    };
    let Some(blob) = conn
        .query_row(
            "SELECT track_data FROM gps_tracks WHERE activity_id = ?1",
            params![activity_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?
    else {
        return Ok(Vec::new());
    };
    let TrackRead::Present(points) = TrackRead::from_blob(&blob) else {
        return Ok(Vec::new());
    };
    if times.len() != points.len() {
        return Ok(Vec::new());
    }
    let elevation: Vec<Option<f64>> = points.iter().map(|p| p.elevation).collect();
    Ok(best_climb_windows(&times, &elevation, &CLIMB_WINDOWS_S)
        .into_iter()
        .flatten()
        .collect())
}

/// What a measurable activity looks like before it has rows: a climbing sport
/// whose stored track and time stream agree in length and that holds no row.
/// A stream of another length is never measured, so it is never owed.
fn owed_from_sql() -> String {
    format!(
        "FROM activities a
         JOIN gps_tracks g ON g.activity_id = a.id
         JOIN time_streams t ON t.activity_id = a.id AND t.point_count = g.point_count
         WHERE a.sport_type NOT IN ({})
           AND NOT EXISTS (SELECT 1 FROM activity_climb_bests b WHERE b.activity_id = a.id)",
        sql_list(UNPOWERED_ELEVATION_EXCLUDED)
    )
}

/// How many activities are owed rows. Reads through any connection, so the
/// climb curve can report it from the read pool.
pub(crate) fn owed_count(conn: &Connection) -> SqlResult<u64> {
    conn.query_row(&format!("SELECT COUNT(*) {}", owed_from_sql()), [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|count| count.max(0) as u64)
}

/// How many activities of `sports` starting at or after `since` are owed
/// rows, or of every date when `since` is empty.
pub(crate) fn owed_among(conn: &Connection, sports: &[&str], since: Option<i64>) -> SqlResult<u64> {
    let sql = format!(
        "SELECT COUNT(*) {} AND a.sport_type IN ({}) AND (?1 IS NULL OR a.start_date >= ?1)",
        owed_from_sql(),
        sql_list(sports)
    );
    conn.prepare_cached(&sql)?
        .query_row(params![since], |row| row.get::<_, i64>(0))
        .map(|count| count.max(0) as u64)
}

impl PersistentEngine {
    /// Activities owed climb rows.
    #[cfg(test)]
    pub(crate) fn climb_bests_owed(&self) -> SqlResult<u64> {
        owed_count(&self.db)
    }

    /// Measure up to `limit` owed activities not yet in `attempted`, newest
    /// first, and return how many it took.
    ///
    /// An activity that measures to nothing stays owed in the tables, so the
    /// pass remembers the ones it has taken: without that a track with no
    /// elevation would be asked about for ever.
    pub(crate) fn backfill_climb_bests_page(
        &self,
        attempted: &mut HashSet<String>,
        limit: usize,
    ) -> SqlResult<usize> {
        let sql = format!(
            "SELECT a.id {} ORDER BY a.start_date DESC, a.id LIMIT ?1",
            owed_from_sql()
        );
        // Taken ones are skipped in Rust, so the page is read wide enough to
        // still hold `limit` fresh ids behind them.
        let width = i64::try_from(limit + attempted.len()).unwrap_or(i64::MAX);
        let ids: Vec<String> = self
            .db
            .prepare(&sql)?
            .query_map(params![width], |row| row.get::<_, String>(0))?
            .collect::<SqlResult<Vec<_>>>()?
            .into_iter()
            .filter(|id| !attempted.contains(id))
            .take(limit)
            .collect();
        for id in &ids {
            attempted.insert(id.clone());
            in_write_txn(&self.db, |conn| refresh(conn, id))?;
        }
        Ok(ids.len())
    }
}

/// Work the owed rows off in pages, each under its own hold of the engine
/// lock, so a sync or a read waits for one page and not for the library.
/// Stops when nothing is owed, when the library it began against is replaced,
/// or when a page fails.
fn run_pass(install: u64) -> usize {
    let mut attempted = HashSet::new();
    let mut total = 0;
    loop {
        match with_persistent_engine_for(install, |engine| {
            engine.backfill_climb_bests_page(&mut attempted, PAGE)
        }) {
            Some(Ok(0)) | None => return total,
            Some(Ok(done)) => total += done,
            Some(Err(error)) => {
                log::warn!("[Climb] backfill stopped: {error}");
                return total;
            }
        }
        std::thread::yield_now();
    }
}

/// Start a pass on a thread of its own when rows are owed.
///
/// It reads only what is stored, so it needs no credential and does not wait
/// for Route Matching. The count reads through the pool, so an empty queue
/// costs one query and no thread. It is safe to ask at every open.
pub fn start_backfill() -> FfiStartOutcome {
    match crate::objects::error::with_reader(owed_count) {
        Ok(Ok(0)) => return FfiStartOutcome::NotOwed,
        Ok(Ok(_)) => {}
        _ => return FfiStartOutcome::NotReady,
    }
    if RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return FfiStartOutcome::Busy;
    }
    let install = super::engine_install();
    crate::threads::spawn_named("veloq-climb", move || {
        run_pass(install);
        RUNNING.store(false, Ordering::SeqCst);
    });
    FfiStartOutcome::Started
}

/// Run `work` inside a write transaction of its own, or inside a savepoint
/// when the connection is already in one, rolling back if it fails.
pub(crate) fn in_write_txn<T>(
    conn: &Connection,
    work: impl FnOnce(&Connection) -> SqlResult<T>,
) -> SqlResult<T> {
    let nested = !conn.is_autocommit();
    conn.execute_batch(if nested {
        "SAVEPOINT climb_bests_write"
    } else {
        "BEGIN IMMEDIATE"
    })?;
    match work(conn) {
        Ok(value) => {
            if nested {
                if let Err(error) = conn.execute_batch("RELEASE SAVEPOINT climb_bests_write") {
                    let _ = conn.execute_batch(
                        "ROLLBACK TO SAVEPOINT climb_bests_write; RELEASE SAVEPOINT climb_bests_write",
                    );
                    return Err(error);
                }
            } else {
                super::commit_write_txn(conn)?;
            }
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch(if nested {
                "ROLLBACK TO SAVEPOINT climb_bests_write; RELEASE SAVEPOINT climb_bests_write"
            } else {
                "ROLLBACK"
            });
            Err(error)
        }
    }
}

#[cfg(test)]
#[path = "tests/climb_bests.rs"]
mod tests;
