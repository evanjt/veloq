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

/// The reference triple and its direction, when a row carries a whole triple.
/// A half-triple indexes nothing.
pub(crate) fn reference(
    activity_id: Option<&str>,
    start: Option<u32>,
    end: Option<u32>,
    reversed: bool,
) -> Option<(&str, u32, u32, bool)> {
    let activity_id = activity_id.filter(|id| !id.is_empty())?;
    Some((activity_id, start?, end?, reversed))
}

/// The range of `line[from..to]` in the stream a line runs over, given the
/// line's own range and direction. A line read backwards counts its indices
/// from the range's end, so its first points are the stream's last.
pub(crate) fn sub_range(range: (u32, u32), reversed: bool, from: u32, to: u32) -> (u32, u32) {
    let (start, end) = range;
    if reversed {
        (end - to, end - from)
    } else {
        (start + from, start + to)
    }
}

/// Where `line` sits in `track` as a half-open range, and whether it reads
/// that range backwards, when it sits at exactly one place either way.
pub(crate) fn locate_reference(track: &[GpsPoint], line: &[GpsPoint]) -> Option<(u32, u32, bool)> {
    if let Some((start, last)) = locate_slice(track, line) {
        return Some((start, last + 1, false));
    }
    let backwards: Vec<GpsPoint> = line.iter().rev().cloned().collect();
    locate_slice(track, &backwards).map(|(start, last)| (start, last + 1, true))
}

/// The one offset at which `polyline` sits inside `track`, if it sits at exactly one.
pub(crate) fn locate_slice(track: &[GpsPoint], polyline: &[GpsPoint]) -> Option<(u32, u32)> {
    const TOLERANCE: f64 = 1e-6;
    let same = |a: &GpsPoint, b: &GpsPoint| {
        (a.latitude - b.latitude).abs() < TOLERANCE && (a.longitude - b.longitude).abs() < TOLERANCE
    };

    if polyline.is_empty() || polyline.len() > track.len() {
        return None;
    }

    let mut found: Option<(u32, u32)> = None;
    for offset in 0..=(track.len() - polyline.len()) {
        let window = &track[offset..offset + polyline.len()];
        if !window.iter().zip(polyline).all(|(a, b)| same(a, b)) {
            continue;
        }
        if found.is_some() {
            return None;
        }
        found = Some((offset as u32, (offset + polyline.len() - 1) as u32));
    }
    found
}

/// One activity's stored stream. Free-standing rather than a method, so a read
/// that already holds a prepared statement on the connection can still call it.
pub(crate) fn stream(conn: &Connection, activity_id: &str) -> Option<Vec<GpsPoint>> {
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
pub(crate) fn rebuild(
    conn: &Connection,
    reference: (&str, u32, u32, bool),
) -> Option<Vec<GpsPoint>> {
    let points = stream(conn, reference.0)?;
    slice(&points, reference)
}

/// [`rebuild`] for a line recorded against a stream of `point_count` points.
///
/// A sync replaces a whole track under the same id, so a triple can index a
/// stream that is not the one it was cut from. The count is the version's
/// memory of that stream: a different count is a different line and an
/// unknown count cannot be checked, and both are refused.
pub(crate) fn rebuild_counted(
    conn: &Connection,
    reference: (&str, u32, u32, bool),
    point_count: Option<i64>,
) -> Option<Vec<GpsPoint>> {
    let points = stream(conn, reference.0)?;
    match point_count {
        Some(count) if count == points.len() as i64 => slice(&points, reference),
        Some(count) => {
            log::warn!(
                "veloqrs: [geometry] stream of {} has {} points, the version was cut from {count}; \
                 refusing to rebuild",
                reference.0,
                points.len()
            );
            None
        }
        None => {
            log::warn!(
                "veloqrs: [geometry] version cut from {} carries no point count; refusing to rebuild",
                reference.0
            );
            None
        }
    }
}

/// Cut a line out of its stream: the half-open range, read backwards when the
/// reference says the line runs from the range's end.
pub(crate) fn slice(
    points: &[GpsPoint],
    reference: (&str, u32, u32, bool),
) -> Option<Vec<GpsPoint>> {
    let (activity_id, start, end, reversed) = reference;
    let (start, end) = (start as usize, end as usize);
    if start >= end || end > points.len() {
        log::warn!(
            "veloqrs: [geometry] range {start}..{end} does not index the {}-point stream of \
             {activity_id}; refusing to rebuild",
            points.len()
        );
        return None;
    }
    let mut line = points[start..end].to_vec();
    if reversed {
        line.reverse();
    }
    Some(line)
}

/// A section's line: the cached blob, the legacy JSON, then a rebuild from the
/// triple. The rebuild also covers a blob that is present but did not decode,
/// so a corrupt cache heals on the next read instead of leaving a blank line.
pub(crate) fn line(
    conn: &Connection,
    blob: Option<&[u8]>,
    json: Option<&str>,
    reference: Option<(&str, u32, u32, bool)>,
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
        reversed: bool,
    }
    let row = conn
        .query_row(
            "SELECT polyline_blob, polyline_json, representative_activity_id,
                    rep_start_index, rep_end_index, rep_reversed
             FROM sections WHERE id = ?",
            params![section_id],
            |row| {
                Ok(Row {
                    blob: row.get(0)?,
                    json: row.get(1)?,
                    activity_id: row.get(2)?,
                    start: row.get(3)?,
                    end: row.get(4)?,
                    reversed: row.get(5)?,
                })
            },
        )
        .map_err(|_| format!("Section not found: {section_id}"))?;
    line(
        conn,
        row.blob.as_deref(),
        row.json.as_deref(),
        reference(row.activity_id.as_deref(), row.start, row.end, row.reversed),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(n: usize) -> Vec<GpsPoint> {
        (0..n)
            .map(|i| GpsPoint::new(47.0 + i as f64 * 0.0001, 8.0))
            .collect()
    }

    /// Scenario: detection turned a line to face its majority, so the line is
    /// its range read from the end.
    /// Expected behaviour: the cut runs the way the line runs, and a forward
    /// reference still cuts forwards.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_reversed_reference_cuts_its_range_backwards() {
        let points = stream(10);
        let mut backwards = points[2..7].to_vec();
        backwards.reverse();

        assert_eq!(slice(&points, ("ride", 2, 7, true)), Some(backwards));
        assert_eq!(
            slice(&points, ("ride", 2, 7, false)),
            Some(points[2..7].to_vec())
        );
        assert_eq!(slice(&points, ("ride", 7, 2, true)), None);
    }

    /// Scenario: an athlete trims a stretch off a line by its own indices.
    /// Expected behaviour: the stretch's range is the same ground cut from the
    /// stream, whichever way the line runs.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_stretch_of_a_line_names_the_stream_range_under_it() {
        let points = stream(20);
        for reversed in [false, true] {
            let line = slice(&points, ("ride", 4, 16, reversed)).unwrap();
            let (start, end) = sub_range((4, 16), reversed, 3, 9);

            assert_eq!(
                slice(&points, ("ride", start, end, reversed)).unwrap(),
                line[3..9].to_vec(),
                "reversed: {reversed}"
            );
        }
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_line_is_located_in_its_stream_either_way_it_runs() {
        let points = stream(12);
        let mut backwards = points[3..8].to_vec();
        backwards.reverse();

        assert_eq!(
            locate_reference(&points, &points[3..8]),
            Some((3, 8, false))
        );
        assert_eq!(locate_reference(&points, &backwards), Some((3, 8, true)));
        assert_eq!(locate_reference(&points, &stream(30)[20..25]), None);
    }
}
