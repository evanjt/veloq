//! The activities intervals.icu holds but does not serve to apps.
//!
//! intervals.icu answers an empty stub for an activity it may not serve, and
//! a stub parses as an activity with every figure missing. This module is the
//! one place that decides from a stored body whether the activity is held back
//! and keeps that fact against the activity. The queues that ask intervals.icu
//! for streams or elevation leave a held-back activity out, and the activity
//! screen read carries the fact so the screen can say why it is empty.
//!
//! The row annotates the activity and is rewritten by each list page that
//! carries it, so a lost row costs the mark until the next sync.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

use crate::net::intervals::wire::ActivityRecord;

/// An activity intervals.icu holds but does not serve, and where it got it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
#[uniffi(name = "FfiActivityHeldBack")]
pub struct ActivityHeldBack {
    /// The service the activity was imported from, as intervals.icu names it.
    pub source: Option<String>,
    /// The id the activity has at that service.
    pub external_id: Option<String>,
}

/// Whether `record` is a stub, and what intervals.icu says about its origin.
pub fn held_back_by(record: &ActivityRecord) -> Option<ActivityHeldBack> {
    record.is_held_back().then(|| ActivityHeldBack {
        source: record.source.clone(),
        external_id: record.external_id.clone(),
    })
}

/// Keep the mark the stored `body` implies for the activity: written when the
/// body is a stub, removed when it is served. A body that does not parse
/// leaves the mark as it was.
pub fn sync_from_body(conn: &Connection, activity_id: &str, body: &str) -> SqlResult<()> {
    let Ok(record) = serde_json::from_str::<ActivityRecord>(body) else {
        return Ok(());
    };
    match held_back_by(&record) {
        Some(held) => conn
            .prepare_cached(
                "INSERT OR REPLACE INTO activity_held_back (activity_id, source, external_id)
                 VALUES (?1, ?2, ?3)",
            )?
            .execute(params![activity_id, held.source, held.external_id])
            .map(|_| ()),
        None => conn
            .prepare_cached("DELETE FROM activity_held_back WHERE activity_id = ?1")?
            .execute(params![activity_id])
            .map(|_| ()),
    }
}

/// The activity's mark, `None` when intervals.icu serves it or it has not
/// been listed.
pub fn of(conn: &Connection, activity_id: &str) -> SqlResult<Option<ActivityHeldBack>> {
    conn.prepare_cached(
        "SELECT source, external_id FROM activity_held_back WHERE activity_id = ?1",
    )?
    .query_row(params![activity_id], |row| {
        Ok(ActivityHeldBack {
            source: row.get(0)?,
            external_id: row.get(1)?,
        })
    })
    .optional()
}

#[cfg(test)]
#[path = "tests/activity_held_back.rs"]
mod tests;
