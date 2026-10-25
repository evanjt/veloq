//! The fault a sync met readying one activity, kept against that activity.
//!
//! A body that will not store or decode is that activity's fault, so it is
//! recorded here and the run goes on with the rest of the library. The feed
//! card and the activity screen read the row to draw the "couldn't sync" mark,
//! and the activity's next clean readying deletes it. One row per activity,
//! replaced by each failed attempt.
//!
//! The row annotates the activity, it is not the work: what is owed is still
//! derived from the stored bodies, so a lost row costs the mark and nothing
//! else. A write that fails is logged and the sync carries on.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

/// The fault a sync last met readying one activity.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
#[uniffi(name = "FfiActivitySyncFailure")]
pub struct ActivitySyncFailure {
    /// What went wrong, as the engine words it.
    pub message: String,
    /// When the attempt failed, in epoch milliseconds, from
    /// [`super::attempts::now_ms`].
    pub failed_at: crate::WholeNumber,
}

/// Keep `message` as the activity's failure, replacing the one before.
pub fn record(conn: &Connection, activity_id: &str, message: &str, failed_at: i64) {
    let written = conn.execute(
        "INSERT OR REPLACE INTO activity_sync_failures (activity_id, message, failed_at)
         VALUES (?1, ?2, ?3)",
        params![activity_id, message, failed_at],
    );
    if let Err(e) = written {
        log::warn!("veloqrs: [sync_failures] Could not record the fault for {activity_id}: {e}");
    }
}

/// Drop the activity's failure, if it has one.
pub fn clear(conn: &Connection, activity_id: &str) {
    let cleared = conn
        .prepare_cached("DELETE FROM activity_sync_failures WHERE activity_id = ?1")
        .and_then(|mut stmt| stmt.execute(params![activity_id]));
    if let Err(e) = cleared {
        log::warn!("veloqrs: [sync_failures] Could not clear the fault for {activity_id}: {e}");
    }
}

/// The activity's failure, `None` when its last readying was clean or it has
/// not been tried.
pub fn of(conn: &Connection, activity_id: &str) -> SqlResult<Option<ActivitySyncFailure>> {
    conn.prepare_cached(
        "SELECT message, failed_at FROM activity_sync_failures WHERE activity_id = ?1",
    )?
    .query_row(params![activity_id], |row| {
        Ok(ActivitySyncFailure {
            message: row.get(0)?,
            failed_at: row.get(1)?,
        })
    })
    .optional()
}

#[cfg(test)]
#[path = "tests/activity_sync_failures.rs"]
mod tests;
