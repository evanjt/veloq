//! Resolving a section's line, cache first and provenance second.
//!
//! `sections.polyline_blob` holds a decoded copy of one contiguous slice of
//! one stored activity. The slice itself is described by the reference triple
//! (`representative_activity_id`, `rep_start_index`, `rep_end_index`), which
//! is the truth: the blob is a cache of it and clearing the blob costs
//! nothing an exact row cannot rebuild. Only a consensus line, averaged across
//! activities and belonging to none, has no triple to rebuild from.

use rusqlite::{Connection, OptionalExtension, params};
use tracematch::GpsPoint;

use crate::persistence::codec::{self, TrackRead};

/// The reference triple, when a row carries a whole one. A half-triple
/// indexes nothing.
pub(crate) fn reference(
    activity_id: Option<&str>,
    start: Option<u32>,
    end: Option<u32>,
) -> Option<(&str, u32, u32)> {
    let activity_id = activity_id.filter(|id| !id.is_empty())?;
    Some((activity_id, start?, end?))
}

/// One activity's stored stream. Free-standing rather than a method, so a read
/// that already holds a prepared statement on the connection can still call it.
fn stream(conn: &Connection, activity_id: &str) -> Option<Vec<GpsPoint>> {
    let blob: Vec<u8> = conn
        .query_row(
            "SELECT track_data FROM gps_tracks WHERE activity_id = ?",
            params![activity_id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()?;
    match TrackRead::from_blob(&blob) {
        TrackRead::Present(points) => Some(points),
        TrackRead::Missing => None,
        TrackRead::Corrupt(reason) => {
            log::warn!(
                "veloqrs: [geometry] stream for {activity_id} did not decode ({reason}); \
                 the sections referencing it cannot be rebuilt"
            );
            None
        }
    }
}

/// Re-slice a section's line out of the stream it was cut from.
///
/// The range is half-open and is refused rather than clamped. A range that no
/// longer indexes its stream describes some other line, and a plausible wrong
/// line renders as real geometry, which is worse than none.
pub(crate) fn rebuild(conn: &Connection, reference: (&str, u32, u32)) -> Option<Vec<GpsPoint>> {
    let (activity_id, start, end) = reference;
    let (start, end) = (start as usize, end as usize);
    let points = stream(conn, activity_id)?;
    if start >= end || end > points.len() {
        log::warn!(
            "veloqrs: [geometry] range {start}..{end} does not index the {}-point stream of \
             {activity_id}; refusing to rebuild",
            points.len()
        );
        return None;
    }
    Some(points[start..end].to_vec())
}

/// A section's line: the cached blob, the legacy JSON, then a rebuild from the
/// triple. The rebuild also covers a blob that is present but did not decode,
/// so a corrupt cache heals on the next read instead of leaving a blank line.
pub(crate) fn line(
    conn: &Connection,
    blob: Option<&[u8]>,
    json: Option<&str>,
    reference: Option<(&str, u32, u32)>,
) -> Result<Vec<GpsPoint>, String> {
    match codec::decode_polyline_row(blob, json) {
        Ok(points) if !points.is_empty() => Ok(points),
        cached => match reference.and_then(|r| rebuild(conn, r)) {
            Some(points) => Ok(points),
            None => cached,
        },
    }
}

/// One section's line, read and resolved from its own row. The single-row form
/// of [`line`], for the callers that hold no statement of their own.
pub(crate) fn stored_line(conn: &Connection, section_id: &str) -> Result<Vec<GpsPoint>, String> {
    struct Row {
        blob: Option<Vec<u8>>,
        json: Option<String>,
        activity_id: Option<String>,
        start: Option<u32>,
        end: Option<u32>,
    }
    let row = conn
        .query_row(
            "SELECT polyline_blob, polyline_json, representative_activity_id,
                    rep_start_index, rep_end_index
             FROM sections WHERE id = ?",
            params![section_id],
            |row| {
                Ok(Row {
                    blob: row.get(0)?,
                    json: row.get(1)?,
                    activity_id: row.get(2)?,
                    start: row.get(3)?,
                    end: row.get(4)?,
                })
            },
        )
        .map_err(|_| format!("Section not found: {section_id}"))?;
    line(
        conn,
        row.blob.as_deref(),
        row.json.as_deref(),
        reference(row.activity_id.as_deref(), row.start, row.end),
    )
}
