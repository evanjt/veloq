//! Section history, versioned geometry, and pins: the D4 storage layer.
//!
//! Three tables keyed on the durable real section id with no foreign key to
//! the wipe-managed `sections` table, so events outlive every catalogue
//! rebuild. `section_history` holds one row per lifecycle event, kept
//! forever; the event vocabulary and `details` payload shape belong to the
//! emitter (D5), which is the only writer of event rows. `section_geometry`
//! holds independently-decodable polyline versions (codec `encode_polyline`,
//! corpus-measured ~3 B/point); `section_pins` freezes a section at a stored
//! version (revert = pin at version).
//!
//! Retention on every geometry write: version 1 (the birth geometry),
//! milestones, the pinned version, and the newest [`GEOMETRY_KEEP_RECENT`]
//! versions always survive; anything else is pruned. The 10-year budget for
//! this policy is measured in the lab (`geometry_codec`, REPORT round 10).

use rusqlite::{OptionalExtension, params};

use crate::persistence::PersistentRouteEngine;
use crate::persistence::codec;
use tracematch::GpsPoint;

/// Newest versions always retained, besides version 1, milestones, and the
/// pinned version.
const GEOMETRY_KEEP_RECENT: usize = 3;

/// `section_geometry.encoding` for the quantised zigzag-varint stream.
const ENCODING_QUANTISED: i64 = 1;

/// One stored geometry version, without its polyline.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionGeometryVersion {
    pub version: i64,
    pub created_at: String,
    pub milestone: bool,
}

/// One section lifecycle event.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionHistoryEvent {
    pub id: i64,
    pub at: String,
    pub kind: String,
    pub details: Option<String>,
    pub geometry_version: Option<i64>,
}

/// Store `polyline` as the next geometry version of `section_id` and prune
/// per the retention policy. Returns the version number written. Takes a bare
/// connection so the emitter can write inside the catalogue-save transaction;
/// statements on the connection join whatever transaction is open on it.
pub(super) fn record_geometry_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    polyline: &[GpsPoint],
    milestone: bool,
) -> rusqlite::Result<i64> {
    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM section_geometry WHERE section_id = ?",
        params![section_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO section_geometry (section_id, version, encoding, blob, milestone)
         VALUES (?, ?, ?, ?, ?)",
        params![
            section_id,
            version,
            ENCODING_QUANTISED,
            codec::encode_polyline(polyline),
            milestone as i64,
        ],
    )?;
    // Newest-N is by surviving version rank, not version arithmetic:
    // earlier pruning leaves gaps, so `version > max - N` would under-keep.
    conn.execute(
        "DELETE FROM section_geometry
         WHERE section_id = ?1 AND milestone = 0 AND version > 1
           AND version NOT IN (
               SELECT version FROM section_geometry WHERE section_id = ?1
               ORDER BY version DESC LIMIT ?2)
           AND version != COALESCE(
               (SELECT version FROM section_pins WHERE section_id = ?1), -1)",
        params![section_id, GEOMETRY_KEEP_RECENT as i64],
    )?;
    Ok(version)
}

/// Append one lifecycle event row at `at`, or at the current time when `at` is
/// None. An upgrade backdates its baseline row to when the catalogue it
/// describes was actually cut; a live event passes None. Returns the event row
/// id. Connection-level for the same transactional reason as
/// [`record_geometry_on`].
pub(super) fn append_history_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    kind: &str,
    details: Option<&str>,
    geometry_version: Option<i64>,
    at: Option<&str>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
         VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?)",
        params![section_id, at, kind, details, geometry_version],
    )?;
    Ok(conn.last_insert_rowid())
}

impl PersistentRouteEngine {
    /// Store `polyline` as the next geometry version of `section_id` and
    /// prune per the retention policy. Returns the version number written.
    pub fn record_section_geometry(
        &mut self,
        section_id: &str,
        polyline: &[GpsPoint],
        milestone: bool,
    ) -> rusqlite::Result<i64> {
        record_geometry_on(&self.db, section_id, polyline, milestone)
    }

    /// Decode one stored geometry version. None when the version is absent,
    /// pruned, or carries an unknown encoding.
    pub fn section_geometry_polyline(
        &self,
        section_id: &str,
        version: i64,
    ) -> Option<Vec<GpsPoint>> {
        let (encoding, blob): (i64, Vec<u8>) = self
            .db
            .query_row(
                "SELECT encoding, blob FROM section_geometry
                 WHERE section_id = ? AND version = ?",
                params![section_id, version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .ok()
            .flatten()?;
        if encoding != ENCODING_QUANTISED {
            return None;
        }
        codec::decode_polyline(&blob)
    }

    /// The surviving versions of one section, oldest first, polylines
    /// excluded.
    pub fn section_geometry_versions(&self, section_id: &str) -> Vec<SectionGeometryVersion> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT version, created_at, milestone FROM section_geometry
             WHERE section_id = ? ORDER BY version",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map(params![section_id], |row| {
            Ok(SectionGeometryVersion {
                version: row.get(0)?,
                created_at: row.get(1)?,
                milestone: row.get::<_, i64>(2)? != 0,
            })
        });
        rows.map(|iter| iter.flatten().collect())
            .unwrap_or_default()
    }

    /// Append one lifecycle event at the current time. Returns the event row id.
    pub fn append_section_history(
        &mut self,
        section_id: &str,
        kind: &str,
        details: Option<&str>,
        geometry_version: Option<i64>,
    ) -> rusqlite::Result<i64> {
        append_history_on(&self.db, section_id, kind, details, geometry_version, None)
    }

    /// Append one lifecycle event at `at`, for a row that records something
    /// which happened before this call.
    pub fn append_section_history_at(
        &mut self,
        section_id: &str,
        kind: &str,
        details: Option<&str>,
        geometry_version: Option<i64>,
        at: &str,
    ) -> rusqlite::Result<i64> {
        append_history_on(
            &self.db,
            section_id,
            kind,
            details,
            geometry_version,
            Some(at),
        )
    }

    /// Every event of one section, oldest first.
    pub fn section_history(&self, section_id: &str) -> Vec<SectionHistoryEvent> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT id, at, kind, details, geometry_version FROM section_history
             WHERE section_id = ? ORDER BY id",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map(params![section_id], |row| {
            Ok(SectionHistoryEvent {
                id: row.get(0)?,
                at: row.get(1)?,
                kind: row.get(2)?,
                details: row.get(3)?,
                geometry_version: row.get(4)?,
            })
        });
        rows.map(|iter| iter.flatten().collect())
            .unwrap_or_default()
    }

    /// Pin `section_id` at a stored geometry version. Returns false without
    /// writing when that version does not exist (absent or already pruned) —
    /// a pin must always be restorable.
    pub fn pin_section_geometry(
        &mut self,
        section_id: &str,
        version: i64,
    ) -> rusqlite::Result<bool> {
        let exists: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM section_geometry WHERE section_id = ? AND version = ?)",
            params![section_id, version],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(false);
        }
        self.db.execute(
            "INSERT INTO section_pins (section_id, version) VALUES (?, ?)
             ON CONFLICT(section_id) DO UPDATE SET
                 version = excluded.version, created_at = datetime('now')",
            params![section_id, version],
        )?;
        Ok(true)
    }

    /// Drop the pin; the formerly pinned version becomes prunable on the
    /// next geometry write like any other.
    pub fn unpin_section_geometry(&mut self, section_id: &str) -> rusqlite::Result<()> {
        self.db.execute(
            "DELETE FROM section_pins WHERE section_id = ?",
            params![section_id],
        )?;
        Ok(())
    }

    /// The pinned version of one section, if any.
    pub fn pinned_section_version(&self, section_id: &str) -> Option<i64> {
        self.db
            .query_row(
                "SELECT version FROM section_pins WHERE section_id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }
}
