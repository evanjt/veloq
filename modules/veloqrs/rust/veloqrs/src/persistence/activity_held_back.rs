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
use crate::persistence::settings::{setting_from, settings_keys};

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
/// leaves the mark as it was. Returns whether the activity was newly marked,
/// which the count of the last download adds up.
pub fn sync_from_body(conn: &Connection, activity_id: &str, body: &str) -> SqlResult<bool> {
    let Ok(record) = serde_json::from_str::<ActivityRecord>(body) else {
        return Ok(false);
    };
    match held_back_by(&record) {
        Some(held) => {
            let was_held = of(conn, activity_id)?.is_some();
            conn.prepare_cached(
                "INSERT OR REPLACE INTO activity_held_back (activity_id, source, external_id)
                 VALUES (?1, ?2, ?3)",
            )?
            .execute(params![activity_id, held.source, held.external_id])?;
            Ok(!was_held)
        }
        None => {
            conn.prepare_cached("DELETE FROM activity_held_back WHERE activity_id = ?1")?
                .execute(params![activity_id])?;
            Ok(false)
        }
    }
}

fn write_count(conn: &Connection, count: u32) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?1, ?2, strftime('%s', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![settings_keys::HELD_BACK_IN_LAST_DOWNLOAD, count.to_string()],
    )?;
    Ok(())
}

/// Start a download's count at zero.
pub fn begin_download(conn: &Connection) -> SqlResult<()> {
    write_count(conn, 0)
}

/// Add activities a page newly marked to the running download's count.
pub fn add_to_last_download(conn: &Connection, newly_marked: u32) -> SqlResult<()> {
    if newly_marked == 0 {
        return Ok(());
    }
    let held = new_in_last_download(conn)?;
    write_count(conn, held.saturating_add(newly_marked))
}

/// How many activities the last download newly marked as held back; zero
/// before any download has run.
pub fn new_in_last_download(conn: &Connection) -> SqlResult<u32> {
    Ok(
        setting_from(conn, settings_keys::HELD_BACK_IN_LAST_DOWNLOAD)?
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
    )
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
