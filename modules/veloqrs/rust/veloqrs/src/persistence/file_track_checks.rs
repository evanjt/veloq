//! Whether an imported file of a synced ride has the record count the server
//! holds for it, and so may stand in for the ride's track download.
//!
//! The intervals of a ride address the server's own samples, and the last of
//! them ends at the server's record count. A file with another count is not
//! that recording: its samples do not sit at the indices the intervals name.

use super::PersistentEngine;
use rusqlite::{OptionalExtension, Result as SqlResult, params};

/// What a ride's row holds of the check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileTrackCheck {
    /// The records the file holds.
    pub file_records: u32,
    /// The records the server holds, known once an interval body is stored.
    pub server_records: Option<u32>,
    /// The ride's track and series are the file's.
    pub supplied: bool,
}

impl FileTrackCheck {
    /// The file's count is not the server's count, where that is known.
    pub fn mismatched(&self) -> bool {
        !counts_match(self.file_records, self.server_records)
    }
}

/// A file of `file` records fits a server count of `server`; with no count
/// known there is nothing to contradict it.
pub fn counts_match(file: u32, server: Option<u32>) -> bool {
    server.is_none_or(|server| server == file)
}

/// The record count a stored interval body implies: where its last interval
/// ends. `None` for a body with no intervals or one that does not parse.
pub fn server_records_of(interval_body: &str) -> Option<u32> {
    super::intervals::parse_activity_intervals(interval_body)?
        .intervals
        .iter()
        .map(|lap| lap.end_index)
        .max()
}

impl PersistentEngine {
    /// The check recorded for a ride, if a file of it was read.
    pub fn file_track_check(&self, id: &str) -> Option<FileTrackCheck> {
        self.db
            .query_row(
                "SELECT file_records, server_records, supplied
                 FROM file_track_checks WHERE activity_id = ?1",
                params![id],
                |row| {
                    Ok(FileTrackCheck {
                        file_records: row.get(0)?,
                        server_records: row.get(1)?,
                        supplied: row.get::<_, i64>(2)? != 0,
                    })
                },
            )
            .optional()
            .unwrap_or_else(|e| {
                log::warn!("veloqrs: [import] file track check of {id} unreadable: {e}");
                None
            })
    }

    /// Record the check of a file read for a ride.
    pub(crate) fn record_file_track_check(
        &self,
        id: &str,
        check: &FileTrackCheck,
    ) -> SqlResult<()> {
        self.db.execute(
            "INSERT INTO file_track_checks (activity_id, file_records, server_records, supplied)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(activity_id) DO UPDATE SET
                file_records = excluded.file_records,
                server_records = excluded.server_records,
                supplied = excluded.supplied",
            params![
                id,
                check.file_records,
                check.server_records,
                i64::from(check.supplied)
            ],
        )?;
        Ok(())
    }

    /// Hold the rides whose interval body was just stored against the file
    /// that supplied their track. A track whose file disagrees with the
    /// body is withdrawn, so the download is owed again, and the row keeps
    /// the mismatch.
    pub(crate) fn recheck_file_tracks(&mut self, rows: &[(String, String)]) {
        for (id, body) in rows {
            let Some(mut check) = self.file_track_check(id) else {
                continue;
            };
            check.server_records = server_records_of(body);
            if check.supplied && check.mismatched() {
                match self.withdraw_track(id) {
                    Ok(()) => check.supplied = false,
                    Err(e) => {
                        log::warn!("veloqrs: [import] the file's track of {id} not withdrawn: {e}");
                        continue;
                    }
                }
            }
            if let Err(e) = self.record_file_track_check(id, &check) {
                log::warn!("veloqrs: [import] file track check of {id} not recorded: {e}");
            }
        }
    }
}
