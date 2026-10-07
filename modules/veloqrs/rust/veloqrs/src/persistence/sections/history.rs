//! Section history, versioned geometry, and pins: the storage layer.
//!
//! Three tables keyed on the durable real section id with no foreign key to
//! the wipe-managed `sections` table, so events outlive every catalogue
//! rebuild. `section_history` holds one row per lifecycle event, kept
//! forever; the event vocabulary and `details` payload shape belong to the
//! lifecycle emitter, which is the only writer of event rows. `section_geometry`
//! holds independently-decodable polyline versions (codec `encode_polyline`,
//! corpus-measured ~3 B/point); `section_pins` freezes a section at a stored
//! version (revert = pin at version).
//!
//! Retention on every geometry write: version 1 (the birth geometry),
//! milestones, the pinned version, and the newest [`GEOMETRY_KEEP_RECENT`]
//! versions always survive; anything else is pruned. The 10-year budget for
//! this policy is measured in the lab (`geometry_codec`, REPORT round 10).
//!
//! A catalogue the cutover replaces is kept here too, one [`KIND_ARCHIVED`]
//! row per outgoing section naming a milestone version, so a past catalogue
//! state is pinned, rolled back and backed up like any other version.

use rusqlite::{OptionalExtension, params};

use crate::persistence::PersistentEngine;
use crate::persistence::codec;
use crate::persistence::sections::geometry;
use tracematch::GpsPoint;

#[cfg(test)]
#[path = "tests/section_sport_consistency.rs"]
mod section_sport_consistency;

/// The activity and point range an exact geometry version was sliced from.
type SliceReference = (String, u32, u32);

/// Newest versions always retained, besides version 1, milestones, and the
/// pinned version.
const GEOMETRY_KEEP_RECENT: usize = 3;

/// `section_geometry.encoding` for the quantised zigzag-varint stream.
const ENCODING_QUANTISED: i64 = 1;

/// `section_geometry.source` for an averaged line no single activity carries,
/// which is why its representative triple is NULL.
pub const SOURCE_CONSENSUS: &str = "consensus";

/// A line sliced whole from one activity, so re-slicing its triple reproduces
/// the stored blob and the blob is a droppable cache.
pub const SOURCE_EXACT: &str = "exact";

/// A line that names the activity and range it was sliced from, which do not
/// reproduce it here: the stream is not stored, or no longer slices to it. The
/// blob is the line until the stream that does arrives.
pub const SOURCE_ORPHANED: &str = "orphaned";

/// The cutover replaced the section's catalogue. `geometry_version` is the
/// milestone that draws the outgoing shape, and `details` names the cutover's
/// token and the section's name, sport, distance, visit count and birth.
pub const KIND_ARCHIVED: &str = "archived";

/// Baseline row an upgrade writes for a section that pre-dates the ledger.
pub const KIND_BASELINE: &str = "baseline";

/// First detect after the detector generation the catalogue was cut under
/// stops matching the live one.
pub const KIND_ALGORITHM_CHANGED: &str = "algorithm_changed";

/// One id gave way to another across a detector change. Written on both ids,
/// `superseded_by` on the old and `supersedes` on the new.
pub const KIND_SUPERSEDED: &str = "superseded";

/// A re-cut moved the section's record: the old best time was set over a
/// different extent, so the PR is re-based on the current one.
pub const KIND_PR_REBASED: &str = "pr_rebased";

/// The user put a stored geometry version back and pinned it there.
pub const KIND_REVERTED: &str = "reverted";

/// The athlete cut the section's line to a range of itself. `details` names the
/// first and last point kept, and `geometry_version` is the trimmed line.
pub const KIND_TRIMMED: &str = "trimmed";

/// The athlete redrew the section's line over a range of one activity.
/// `details` names the activity and the range, and `geometry_version` is the
/// new line.
pub const KIND_EXPANDED: &str = "expanded";

/// The athlete put the line the section had before their edits back.
/// `geometry_version` is the restored line.
pub const KIND_BOUNDS_RESET: &str = "bounds_reset";

/// The athlete chose another activity as the section's reference. `details`
/// names the activity, and `geometry_version` is the line cut from it.
pub const KIND_REFERENCE_SET: &str = "reference_set";

/// The athlete handed the reference back to detection.
pub const KIND_REFERENCE_RESET: &str = "reference_reset";

/// The athlete accepted a detected section as their own.
pub const KIND_ACCEPTED: &str = "accepted";

/// The athlete named or renamed the section. `details` holds the name before
/// and after, null where there was none.
pub const KIND_RENAMED: &str = "renamed";

/// The athlete merged another section into this one. `details` names the
/// absorbed ids. The absorbed section's own ledger ends in a `merged` row
/// naming this one.
pub const KIND_ABSORBED: &str = "absorbed";

/// The user rolled a section the cutover retired back to an archived state,
/// which gave it a row again and pinned it there.
pub const KIND_RESTORED: &str = "restored";

/// The activity a section's line was sliced from left intervals.icu, so the
/// line was re-cut from another member's own pass. `details` names the
/// activity that was the reference, the one that replaced it, and the cause,
/// because a line must not move without the athlete being able to read why.
pub const KIND_REFERENCE_REANCHORED: &str = "reference_reanchored";

/// The upgrade placed an accepted or trimmed section's line on a stored track,
/// so it names a range of one activity. `details` names the activity, the
/// range, and whether the drawn line moved (`moved` is false when it already
/// was that slice, point for point).
pub const KIND_REFERENCE_ANCHORED: &str = "reference_anchored";

/// A detect left a typed name on another section than the one that showed it.
/// Written on the section that showed it. `details` names the name, the section
/// it left and the one it landed on (`to` is null while the name has no
/// section).
pub const KIND_NAME_RELEASED: &str = "name_released";

/// A detect put a typed name on this section that another section showed
/// before. `details` has the same shape as [`KIND_NAME_RELEASED`], `from` being
/// null when the name had no section.
pub const KIND_NAME_TAKEN: &str = "name_taken";

/// The `cause` a re-anchor gives when the census found the activity gone.
pub const REANCHOR_CAUSE_ACTIVITY_REMOVED: &str = "activity_removed";

/// The `basis` every re-based PR row carries.
pub const PR_BASIS_CURRENT_EXTENT: &str = "current_extent";

/// The detector and parameters a catalogue was cut under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectorGeneration {
    pub method: String,
    pub digest: String,
}

/// Where a split sibling came from: the parent it was carved out of and the
/// discriminator its birth recorded (a cardinal, or an ordinal among the
/// siblings). An unnamed sibling's shown name is composed from the parent and
/// its part, see `numbers::compose_split_labels`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionLineage {
    pub section_id: String,
    pub parent_id: String,
    pub discriminator: String,
    /// Position along the original parent line, including the retained piece.
    pub line_order: Option<u32>,
    /// The part number among the parent's split children, from 1. A child
    /// keeps its recorded `line_order` unless another child already holds
    /// it; otherwise it takes one more than the highest held so far.
    pub part: u32,
}

/// A section the ledger remembers and the catalogue no longer holds: its
/// last event says how it left, and its stored versions still draw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetiredSection {
    pub section_id: String,
    /// dissolved, merged or superseded. A state a record restore still holds
    /// pending reads superseded, with no survivor.
    pub kind: String,
    pub at: String,
    /// The survivor a merge or supersession handed the ground to.
    pub into: Option<String>,
    /// Surviving geometry versions, newest last.
    pub versions: Vec<i64>,
}

/// A change the ledger recorded on a live section, for the insights feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionChange {
    pub section_id: String,
    pub kind: String,
    pub at: String,
}

/// A ledger row that names one activity, with the section it sits on.
///
/// `relation` says how the row names it: `around` and `fork_around` for the
/// lists a change attributes, `reanchored_from` and `reanchored_to` for the
/// two ends of a reference re-anchor. None of them says the activity caused
/// the change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityLedgerChange {
    pub event_id: i64,
    pub section_id: String,
    pub section_name: Option<String>,
    pub section_type: String,
    pub at: String,
    pub kind: String,
    pub relation: String,
}

/// One stored geometry version, without its polyline.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionGeometryVersion {
    pub version: i64,
    pub created_at: String,
    pub milestone: bool,
}

/// Open a quarantined database to read what can still be salvaged out of it.
///
/// Read-only first, which is what a file that may be corrupt deserves. But
/// SQLite cannot open a WAL database read-only unless the `-shm` sidecar is
/// already there, and a cleanly closed one has none: the mode is in the
/// header and the sidecars are gone. Every database here is WAL, so
/// read-only alone would have made salvage return nothing on exactly the
/// files it exists for. The fallback opens read-write, which lets SQLite
/// create the sidecar; nothing here writes to the file.
fn open_quarantined(path: &str) -> Option<rusqlite::Connection> {
    rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .or_else(|_| rusqlite::Connection::open(path))
        .ok()
}

/// What one quarantine salvage carried into the fresh database, per table.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SalvageCounts {
    pub history: usize,
    pub geometry: usize,
    pub pins: usize,
    /// User-owned `sections` rows: custom, accepted, renamed, trimmed.
    pub sections: usize,
    /// `section_intents` suppressions, the disabled and deleted corridors.
    pub intents: usize,
    pub recordings: usize,
    pub route_names: usize,
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

/// The blob to store for a version: nothing when the version is a slice of a
/// stored stream, the encoded line otherwise.
///
/// A section is `(activity_id, start, end)` into one stored stream, so an
/// exact version's blob is a second copy of geometry the device already holds.
/// It is dropped only when re-slicing the triple reproduces the line here and
/// now, so a caller that names a range the line did not come from keeps its
/// blob rather than losing the version. The two sides are compared through the
/// encoding, the same normalisation the ingest's mutation check uses, so a
/// quantised store of the same ground is not read as a difference.
fn droppable_blob(
    conn: &rusqlite::Connection,
    polyline: &[GpsPoint],
    reference: Option<(&str, u32, u32)>,
) -> Vec<u8> {
    let encoded = codec::encode_polyline(polyline);
    let reproduces = reference
        .and_then(|r| geometry::rebuild(conn, r))
        .is_some_and(|sliced| codec::encode_polyline(&sliced) == encoded);
    if reproduces { Vec::new() } else { encoded }
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
    reference: Option<(&str, u32, u32)>,
) -> rusqlite::Result<i64> {
    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM section_geometry WHERE section_id = ?",
        params![section_id],
        |row| row.get(0),
    )?;
    // The stream's count at the moment of the cut, so a later re-slice can
    // tell the same stream from one a sync replaced under the same id.
    let point_count: Option<i64> = match reference {
        Some((activity_id, _, _)) => conn
            .query_row(
                "SELECT point_count FROM gps_tracks WHERE activity_id = ?",
                params![activity_id],
                |row| row.get(0),
            )
            .optional()?,
        None => None,
    };
    conn.execute(
        "INSERT INTO section_geometry
             (section_id, version, encoding, blob, milestone,
              rep_activity_id, rep_start_index, rep_end_index, source, point_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            section_id,
            version,
            ENCODING_QUANTISED,
            droppable_blob(conn, polyline, reference),
            milestone as i64,
            reference.map(|(id, _, _)| id),
            reference.map(|(_, start, _)| start),
            reference.map(|(_, _, end)| end),
            if reference.is_some() {
                SOURCE_EXACT
            } else {
                SOURCE_CONSENSUS
            },
            point_count,
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

/// The encoded line with elevation left out. Two lines over the same
/// coordinates are one course whether or not the stream they were cut from
/// carried elevation, and a second version for the difference would offer a
/// revert to a line that looks identical.
fn encode_course(points: &[GpsPoint]) -> Vec<u8> {
    let flat: Vec<GpsPoint> = points
        .iter()
        .map(|p| GpsPoint {
            elevation: None,
            ..p.clone()
        })
        .collect();
    codec::encode_polyline(&flat)
}

/// Keep a shape the cutover is about to replace as a milestone version, and
/// return the version that draws it.
///
/// A version that already draws `line` is milestoned rather than written
/// again, unless it names no range where this one does. A new version stores
/// the range alone when the stream re-slices to `line`, the line beside the
/// range when the stream is missing or slices to other ground, and the line
/// alone when there is no range. None when there is neither a line nor a range.
pub(in crate::persistence) fn record_archived_geometry_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    line: &[GpsPoint],
    reference: Option<(&str, u32, u32)>,
) -> rusqlite::Result<Option<i64>> {
    if line.is_empty() && reference.is_none() {
        return Ok(None);
    }
    if !line.is_empty() {
        let encoded = encode_course(line);
        let versions: Vec<i64> = {
            let mut stmt = conn.prepare(
                "SELECT version FROM section_geometry WHERE section_id = ? ORDER BY version DESC",
            )?;
            stmt.query_map(params![section_id], |row| row.get(0))?
                .collect::<rusqlite::Result<_>>()?
        };
        for version in versions {
            let Some((points, stored)) =
                pooled::section_geometry_version(conn, section_id, version)
            else {
                continue;
            };
            let same_range = match (reference, stored.as_ref()) {
                (None, _) => true,
                (Some(wanted), Some((id, start, end))) => wanted == (id.as_str(), *start, *end),
                (Some(_), None) => false,
            };
            if same_range && encode_course(&points) == encoded {
                conn.execute(
                    "UPDATE section_geometry SET milestone = 1 WHERE section_id = ? AND version = ?",
                    params![section_id, version],
                )?;
                return Ok(Some(version));
            }
        }
    }
    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM section_geometry WHERE section_id = ?",
        params![section_id],
        |row| row.get(0),
    )?;
    let reproduced = reference.and_then(|r| {
        let sliced = geometry::rebuild(conn, r)?;
        (line.is_empty() || codec::encode_polyline(&sliced) == codec::encode_polyline(line))
            .then_some(())
    });
    let (source, blob) = match (reference, reproduced) {
        (Some(_), Some(())) => (SOURCE_EXACT, Vec::new()),
        (Some(_), None) if line.is_empty() => (SOURCE_ORPHANED, Vec::new()),
        (Some(_), None) => (SOURCE_ORPHANED, codec::encode_polyline(line)),
        (None, _) => (SOURCE_CONSENSUS, codec::encode_polyline(line)),
    };
    let point_count: Option<i64> = match (reference, source) {
        (Some((activity_id, _, _)), SOURCE_EXACT) => conn
            .query_row(
                "SELECT point_count FROM gps_tracks WHERE activity_id = ?",
                params![activity_id],
                |row| row.get(0),
            )
            .optional()?,
        _ => None,
    };
    conn.execute(
        "INSERT INTO section_geometry
             (section_id, version, encoding, blob, milestone,
              rep_activity_id, rep_start_index, rep_end_index, source, point_count)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
        params![
            section_id,
            version,
            ENCODING_QUANTISED,
            blob,
            reference.map(|(id, _, _)| id),
            reference.map(|(_, start, _)| start),
            reference.map(|(_, _, end)| end),
            source,
            point_count,
        ],
    )?;
    Ok(Some(version))
}

/// Settle the orphaned versions that name `activity_id` against its stream,
/// just stored. A version whose range indexes the stream and re-slices to the
/// line it carries, or that carries no line, becomes exact: the range is then
/// its truth and the carried line goes. Any other stays as it was, on its own
/// line. Returns how many settled.
pub(in crate::persistence) fn settle_orphaned_references_on(
    conn: &rusqlite::Connection,
    activity_id: &str,
    stream: &[GpsPoint],
) -> rusqlite::Result<usize> {
    type Orphan = (String, i64, Vec<u8>, Option<u32>, Option<u32>, Option<i64>);
    let orphans: Vec<Orphan> = {
        let mut stmt = conn.prepare(
            "SELECT section_id, version, blob, rep_start_index, rep_end_index, point_count
             FROM section_geometry
             WHERE rep_activity_id = ? AND source = 'orphaned' AND encoding = ?",
        )?;
        stmt.query_map(params![activity_id, ENCODING_QUANTISED], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?
    };
    let mut settled = 0;
    for (section_id, version, blob, start, end, point_count) in orphans {
        let (Some(start), Some(end)) = (start, end) else {
            continue;
        };
        // A count recorded beside the range names the stream it was cut from.
        if point_count.is_some_and(|count| count != stream.len() as i64) {
            continue;
        }
        let Some(sliced) = geometry::slice(stream, (activity_id, start, end)) else {
            continue;
        };
        if !blob.is_empty() && codec::encode_polyline(&sliced) != blob {
            continue;
        }
        settled += conn.execute(
            "UPDATE section_geometry SET source = 'exact', blob = X'', point_count = ?
             WHERE section_id = ? AND version = ?",
            params![stream.len() as i64, section_id, version],
        )?;
    }
    Ok(settled)
}

/// Copy the rows `select` yields from `src` into `dst` with `insert`, one
/// at a time, skipping any row that fails to read or write. Returns the
/// rows written.
fn salvage_rows(
    src: &rusqlite::Connection,
    dst: &rusqlite::Connection,
    select: &str,
    insert: &str,
    columns: usize,
) -> usize {
    let Ok(mut stmt) = src.prepare(select) else {
        return 0;
    };
    let rows = stmt.query_map([], |row| {
        (0..columns)
            .map(|i| row.get::<_, rusqlite::types::Value>(i))
            .collect::<Result<Vec<_>, _>>()
    });
    let Ok(rows) = rows else { return 0 };
    let mut written = 0;
    for values in rows.flatten() {
        if dst
            .execute(insert, rusqlite::params_from_iter(values.iter()))
            .is_ok()
        {
            written += 1;
        }
    }
    written
}

/// The columns a table carries in BOTH databases, in the destination's order.
/// A quarantined file is one that failed to open or migrate, so its shape can
/// lag the fresh schema by any number of versions; a fixed column list would
/// salvage nothing at all from it.
fn shared_columns(
    src: &rusqlite::Connection,
    dst: &rusqlite::Connection,
    table: &str,
) -> Vec<String> {
    let names = |conn: &rusqlite::Connection| -> Vec<String> {
        let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({table})")) else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) else {
            return Vec::new();
        };
        rows.flatten().collect()
    };
    let source: std::collections::BTreeSet<String> = names(src).into_iter().collect();
    names(dst)
        .into_iter()
        .filter(|c| source.contains(c))
        .collect()
}

/// Copy readable rows of one table across on the shared columns, `filter`
/// narrowing which rows qualify. Returns how many landed.
fn salvage_table(
    src: &rusqlite::Connection,
    dst: &rusqlite::Connection,
    table: &str,
    filter: &str,
) -> usize {
    let columns = shared_columns(src, dst, table);
    if columns.is_empty() {
        return 0;
    }
    let list = columns.join(", ");
    let placeholders = vec!["?"; columns.len()].join(", ");
    salvage_rows(
        src,
        dst,
        &format!("SELECT {list} FROM {table} {filter}"),
        &format!("INSERT OR IGNORE INTO {table} ({list}) VALUES ({placeholders})"),
        columns.len(),
    )
}

fn salvage_declared_records(
    src: &rusqlite::Connection,
    dst: &rusqlite::Connection,
) -> std::collections::BTreeMap<&'static str, usize> {
    let mut records = std::collections::BTreeMap::new();
    for class in [
        crate::persistence::tables::TableClass::Record,
        crate::persistence::tables::TableClass::Identity,
        crate::persistence::tables::TableClass::Device,
    ] {
        for table in crate::persistence::tables::tables_of(class) {
            records.insert(table, salvage_table(src, dst, table, ""));
        }
    }
    records
}

/// The section's records as the junction rows stand now: per sport, the
/// fastest included full traversal and its activity. A record is held within
/// one sport, so a ride over ground a run also crosses never holds the run's.
pub(super) fn current_prs_on(
    conn: &rusqlite::Connection,
    section_id: &str,
) -> std::collections::BTreeMap<String, (String, f64)> {
    let complete = crate::persistence::records::complete_traversal_clause("sa", "s");
    let mut records = std::collections::BTreeMap::new();
    let Ok(mut stmt) = conn.prepare(&format!(
        "SELECT COALESCE(am.sport_type, a.sport_type), sa.activity_id, sa.lap_time
         FROM section_activities sa
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
         LEFT JOIN sections s ON s.id = sa.section_id
         WHERE sa.section_id = ? AND sa.excluded = 0 AND sa.lap_time IS NOT NULL{complete}
         ORDER BY 1, sa.lap_time ASC, sa.activity_id ASC"
    )) else {
        return records;
    };
    let rows = stmt.query_map(params![section_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, f64>(2)?,
        ))
    });
    if let Ok(rows) = rows {
        for (sport, activity_id, lap_time) in rows.flatten() {
            records.entry(sport).or_insert((activity_id, lap_time));
        }
    }
    records
}

/// The records as the era snapshot stores them, keyed by sport.
pub(super) fn prs_json(
    records: &std::collections::BTreeMap<String, (String, f64)>,
) -> serde_json::Value {
    serde_json::Value::Object(
        records
            .iter()
            .map(|(sport, (activity_id, time))| {
                (
                    sport.clone(),
                    serde_json::json!({ "activity_id": activity_id, "time": time }),
                )
            })
            .collect(),
    )
}

/// After a re-cut's junction rows are written, compare each sport's record
/// they hold with the one the era snapshot the re-cut event carried, and write
/// one [`KIND_PR_REBASED`] row per sport whose record moved. A record that
/// merely gained precision is not a move: times compare to the millisecond.
pub(super) fn record_pr_rebase_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    recut_details: Option<&str>,
) -> rusqlite::Result<()> {
    let era: serde_json::Value = recut_details
        .and_then(|d| serde_json::from_str(d).ok())
        .unwrap_or(serde_json::Value::Null);
    let before: std::collections::BTreeMap<String, (Option<String>, Option<f64>)> = era
        .get("prs")
        .and_then(|v| v.as_object())
        .map(|prs| {
            prs.iter()
                .map(|(sport, record)| {
                    (
                        sport.clone(),
                        (
                            record
                                .get("activity_id")
                                .and_then(|v| v.as_str())
                                .map(str::to_string),
                            record.get("time").and_then(|v| v.as_f64()),
                        ),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let now = current_prs_on(conn, section_id);
    let sports: std::collections::BTreeSet<&String> = before.keys().chain(now.keys()).collect();
    for sport in sports {
        let (from_activity, from_time) = before.get(sport).cloned().unwrap_or((None, None));
        let (to_activity, to_time) = match now.get(sport) {
            Some((a, t)) => (Some(a.clone()), Some(*t)),
            None => (None, None),
        };
        let same_time = match (from_time, to_time) {
            (Some(a), Some(b)) => (a - b).abs() < 0.001,
            (None, None) => true,
            _ => false,
        };
        if from_activity == to_activity && same_time {
            continue;
        }
        let details = serde_json::json!({
            "sport": sport,
            "from_activity_id": from_activity,
            "from_time": from_time,
            "to_activity_id": to_activity,
            "to_time": to_time,
            "basis": PR_BASIS_CURRENT_EXTENT,
        });
        append_history_on(
            conn,
            section_id,
            KIND_PR_REBASED,
            Some(&details.to_string()),
            None,
            None,
        )?;
    }
    Ok(())
}

/// Write the ledger rows for every typed name whose holder differs between two
/// resolutions of the overlay: [`KIND_NAME_RELEASED`] on the section that showed
/// it and [`KIND_NAME_TAKEN`] on the one that shows it now. The overlay is
/// derived at read time, so a catalogue write is the only place a move can be
/// seen: the caller resolves it before and after the write.
pub(super) fn record_name_moves_on(
    conn: &rusqlite::Connection,
    before: &super::named::NamedOverlay,
    after: &super::named::NamedOverlay,
) -> rusqlite::Result<()> {
    let held_before: std::collections::BTreeMap<&str, &str> = before
        .corridors
        .iter()
        .filter_map(|c| Some((c.intent_id.as_str(), c.section_id.as_deref()?)))
        .collect();
    for corridor in &after.corridors {
        let from = held_before.get(corridor.intent_id.as_str()).copied();
        let to = corridor.section_id.as_deref();
        if from == to {
            continue;
        }
        let details = serde_json::json!({
            "name": corridor.name,
            "from": from,
            "to": to,
        })
        .to_string();
        if let Some(from) = from {
            append_history_on(conn, from, KIND_NAME_RELEASED, Some(&details), None, None)?;
        }
        if let Some(to) = to {
            append_history_on(conn, to, KIND_NAME_TAKEN, Some(&details), None, None)?;
        }
    }
    Ok(())
}

/// Append one lifecycle event row at `at`, or at the current time when `at` is
/// None. An upgrade backdates its baseline row to when the catalogue it
/// describes was actually cut; a live event passes None. Returns the event row
/// id. Connection-level for the same transactional reason as
/// [`record_geometry_on`].
pub(in crate::persistence) fn append_history_on(
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

/// `schema_info` key marking the one-off baseline seeding as done.
const BASELINE_MARKER_KEY: &str = "section_geometry_baseline_v1";

/// Detector every catalogue that pre-dates the generation marker was cut under.
/// The marker's only writer is a detect, and no shipped build ran one, so a
/// migrating database would otherwise present as having always been current.
const PRE_LEDGER_METHOD: &str = "corridor";

/// Digest stamped beside [`PRE_LEDGER_METHOD`]. [`super::section_config_digest`]
/// emits 16 hex digits, so this can never collide with a live config.
const PRE_LEDGER_DIGEST: &str = "pre-ledger";

/// One section awaiting its birth geometry: the stored line in whichever form
/// it survives in, its earliest member ride, and how many rides it holds.
struct PendingBaseline {
    id: String,
    blob: Option<Vec<u8>>,
    json: Option<String>,
    rep_activity_id: Option<String>,
    rep_start: Option<u32>,
    rep_end: Option<u32>,
    at: String,
    activity_count: i64,
}

/// Write the birth geometry of every section that pre-dates the ledger.
///
/// A database upgraded onto the history tables carries sections with no
/// versions and no events, so the first change to any of them has nothing to
/// sit beside. This writes each one's current polyline as version 1, a
/// milestone by construction, and appends one `baseline` event backdated to the
/// section's earliest member ride rather than to upgrade day.
///
/// The row names a triple only when the line was checked against it: a line
/// that is a contiguous slice of its representative activity's stream is
/// `exact` with that half-open range. Any other line was cut by a detector that
/// never recorded which activity it came from, and is `consensus` with a NULL
/// triple, because claiming a triple that was never checked would put a wrong
/// line under a prior-versus-current overlay. Runs once, guarded on [`BASELINE_MARKER_KEY`]; a fresh install
/// marks itself done over an empty catalogue and never seeds.
///
/// Seeding a non-empty catalogue also stamps the generation marker at
/// [`PRE_LEDGER_METHOD`], because the catalogue it just described was cut by
/// that detector and nothing else will ever say so. Without it the first
/// detect under a new detector sees no generation change and the flip goes
/// unexplained for exactly the users the ledger exists for.
///
/// Returns the number of sections seeded and the number skipped for an
/// undecodable or empty polyline.
fn pending_baselines_on(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<PendingBaseline>> {
    // Backdating reads the member rides, so a section whose junction rows are
    // gone falls back to now rather than claiming a date it cannot support.
    let mut stmt = conn.prepare(
        "SELECT s.id, s.polyline_blob, s.polyline_json,
                s.representative_activity_id, s.rep_start_index, s.rep_end_index,
                COALESCE(
                    (SELECT datetime(MIN(a.start_date), 'unixepoch')
                     FROM section_activities sa JOIN activities a ON a.id = sa.activity_id
                     WHERE sa.section_id = s.id),
                    datetime('now')),
                (SELECT COUNT(*) FROM section_activities sa WHERE sa.section_id = s.id)
         FROM sections s
         WHERE NOT EXISTS (SELECT 1 FROM section_geometry g WHERE g.section_id = s.id)",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PendingBaseline {
                id: row.get(0)?,
                blob: row.get(1)?,
                json: row.get(2)?,
                rep_activity_id: row.get(3)?,
                rep_start: row.get(4)?,
                rep_end: row.get(5)?,
                at: row.get(6)?,
                activity_count: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    Ok(rows)
}

/// The half-open range of `activity_id`'s stored stream that `line` is a slice
/// of, with the stream's point count, when it is one. A triple the row already
/// carries wins when it reproduces the line, so a stream that holds the line
/// twice does not lose a range that was never ambiguous.
fn exact_reference(
    conn: &rusqlite::Connection,
    activity_id: &str,
    stored: Option<(&str, u32, u32)>,
    line: &[GpsPoint],
) -> Option<(String, u32, u32, i64)> {
    let stream = geometry::stream(conn, activity_id)?;
    let (start, end) = match stored {
        Some((id, start, end))
            if id == activity_id
                && geometry::slice(&stream, (id, start, end)).is_some_and(|sliced| {
                    codec::encode_polyline(&sliced) == codec::encode_polyline(line)
                }) =>
        {
            (start, end)
        }
        _ => {
            let (start, last) = geometry::locate_slice(&stream, line)?;
            (start, last + 1)
        }
    };
    Some((activity_id.to_string(), start, end, stream.len() as i64))
}

fn seed_one_baseline_on(
    conn: &rusqlite::Connection,
    row: PendingBaseline,
    schema_from: i32,
    detector: Option<&str>,
) -> rusqlite::Result<bool> {
    let PendingBaseline {
        id,
        blob,
        json,
        rep_activity_id,
        rep_start,
        rep_end,
        at,
        activity_count,
    } = row;
    let stored_reference = geometry::reference(rep_activity_id.as_deref(), rep_start, rep_end);
    let Ok(polyline) = geometry::line(conn, blob.as_deref(), json.as_deref(), stored_reference)
    else {
        return Ok(false);
    };
    if polyline.is_empty() {
        return Ok(false);
    }
    let exact = rep_activity_id
        .as_deref()
        .and_then(|activity_id| exact_reference(conn, activity_id, stored_reference, &polyline));
    match &exact {
        Some((activity_id, start, end, point_count)) => conn.execute(
            "INSERT INTO section_geometry
                 (section_id, version, created_at, encoding, blob, milestone,
                  rep_activity_id, rep_start_index, rep_end_index, source, point_count)
             VALUES (?, 1, ?, ?, X'', 1, ?, ?, ?, ?, ?)",
            params![
                id,
                at,
                ENCODING_QUANTISED,
                activity_id,
                start,
                end,
                SOURCE_EXACT,
                point_count,
            ],
        )?,
        None => conn.execute(
            "INSERT INTO section_geometry
                 (section_id, version, created_at, encoding, blob, milestone, source)
             VALUES (?, 1, ?, ?, ?, 1, ?)",
            params![
                id,
                at,
                ENCODING_QUANTISED,
                codec::encode_polyline(&polyline),
                SOURCE_CONSENSUS,
            ],
        )?,
    };
    let details = serde_json::json!({
        "source": "upgrade",
        "schema_from": schema_from,
        "detector": detector,
        "activity_count": activity_count,
    })
    .to_string();
    append_history_on(conn, &id, KIND_BASELINE, Some(&details), Some(1), Some(&at))?;
    Ok(true)
}

pub(in crate::persistence) fn seed_baseline_geometry_on(
    conn: &rusqlite::Connection,
    schema_from: i32,
) -> rusqlite::Result<(usize, usize)> {
    let done: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_info WHERE key = ?)",
        params![BASELINE_MARKER_KEY],
        |row| row.get(0),
    )?;
    if done {
        return Ok((0, 0));
    }

    // One transaction over the whole seed, marker included, so a kill mid-run
    // leaves no half-written ledger and the next open starts over.
    let tx = conn.unchecked_transaction()?;
    let conn = &*tx;

    let stored_detector: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![super::CATALOGUE_METHOD_KEY],
            |row| row.get(0),
        )
        .optional()?;

    let rows = pending_baselines_on(conn)?;

    let detector = stored_detector
        .clone()
        .or_else(|| (!rows.is_empty()).then(|| PRE_LEDGER_METHOD.to_string()));

    let mut seeded = 0usize;
    let mut skipped = 0usize;
    for row in rows {
        if seed_one_baseline_on(conn, row, schema_from, detector.as_deref())? {
            seeded += 1;
        } else {
            skipped += 1;
        }
    }

    // The catalogue just described was cut by the pre-ledger detector, and a
    // save under the live one would otherwise be the first thing to name a
    // generation, hiding the change it is about to make.
    if seeded > 0 && stored_detector.is_none() {
        for (key, value) in [
            (super::CATALOGUE_METHOD_KEY, PRE_LEDGER_METHOD),
            (super::CATALOGUE_CONFIG_DIGEST_KEY, PRE_LEDGER_DIGEST),
        ] {
            conn.execute(
                "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
                params![key, value],
            )?;
        }
    }

    // A name the athlete typed in 0.3.x marks the line as theirs: pin it at
    // the baseline so the first detect under the new detector leaves it whole.
    // The named-intent backfill runs earlier in the same open, so its
    // `ni_bf_<section id>` intents say which rows carried a typed name.
    conn.execute(
        "INSERT OR IGNORE INTO section_pins (section_id, version)
         SELECT s.id, 1
         FROM section_intents i
         JOIN sections s ON s.id = substr(i.id, 7)
         JOIN section_geometry g ON g.section_id = s.id AND g.version = 1
         WHERE i.kind = 'named' AND substr(i.id, 1, 6) = 'ni_bf_'",
        [],
    )?;

    conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, datetime('now'))",
        params![BASELINE_MARKER_KEY],
    )?;
    tx.commit()?;
    Ok((seeded, skipped))
}

/// The generation stored beside a catalogue, absent until a save records one.
pub(super) fn stored_generation_on(conn: &rusqlite::Connection) -> Option<DetectorGeneration> {
    let value = |key: &str| -> Option<String> {
        conn.query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![key],
            |row| row.get(0),
        )
        .ok()
    };
    Some(DetectorGeneration {
        method: value(super::CATALOGUE_METHOD_KEY)?,
        digest: value(super::CATALOGUE_CONFIG_DIGEST_KEY)?,
    })
}

/// Keep the shape `section_id` carries right now as a milestone and return its
/// version.
///
/// `current` is the line on the section row, which is the authority. Only when
/// the newest stored version already encodes to it is that version milestoned;
/// otherwise the section drifted without an event (an adopted batch geometry
/// does exactly that) and the stored line is stale, so `current` is written as
/// a new milestone version. None when there is neither.
pub(super) fn milestone_prior_geometry_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    current: Option<&[GpsPoint]>,
) -> rusqlite::Result<Option<i64>> {
    // The newest version's own line, not its bytes: an exact version stores
    // its triple and no blob, so comparing the raw column would call every
    // unchanged line a change and write a version per detect.
    let newest: Option<(i64, Vec<u8>)> = conn
        .query_row(
            "SELECT version, blob, rep_activity_id, rep_start_index, rep_end_index, point_count
             FROM section_geometry
             WHERE section_id = ?1
               AND version = (SELECT MAX(version) FROM section_geometry WHERE section_id = ?1)",
            params![section_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<u32>>(3)?,
                    row.get::<_, Option<u32>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            },
        )
        .optional()?
        .map(|(version, blob, rep_id, start, end, point_count)| {
            let stored = match (blob.is_empty(), rep_id, start, end) {
                (true, Some(id), Some(start), Some(end)) => {
                    geometry::rebuild_counted(conn, (id.as_str(), start, end), point_count)
                        .map(|points| codec::encode_polyline(&points))
                        .unwrap_or_default()
                }
                _ => blob,
            };
            (version, stored)
        });
    let current = current.filter(|points| !points.is_empty());
    // The outgoing line's provenance is whatever the row still says it is.
    let reference: Option<(String, u32, u32)> = conn
        .query_row(
            "SELECT representative_activity_id, rep_start_index, rep_end_index
             FROM sections WHERE id = ? AND geometry_source = 'exact'",
            params![section_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<u32>>(1)?,
                    row.get::<_, Option<u32>>(2)?,
                ))
            },
        )
        .optional()?
        .and_then(|(id, start, end)| Some((id?, start?, end?)));
    let reference = reference.as_ref().map(|(id, s, e)| (id.as_str(), *s, *e));
    match (newest, current) {
        (Some((_, blob)), Some(points)) if codec::encode_polyline(points) != blob => Ok(Some(
            record_geometry_on(conn, section_id, points, true, reference)?,
        )),
        (Some((version, _)), _) => {
            conn.execute(
                "UPDATE section_geometry SET milestone = 1 WHERE section_id = ? AND version = ?",
                params![section_id, version],
            )?;
            Ok(Some(version))
        }
        (None, Some(points)) => Ok(Some(record_geometry_on(
            conn, section_id, points, true, reference,
        )?)),
        (None, None) => Ok(None),
    }
}

/// Keep the shape a section held under the outgoing detector, then record that
/// the detector changed. The milestone runs first because the save that
/// follows overwrites the row and the "before" line has to already be stored.
pub(super) fn record_algorithm_change_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    prior_polyline: Option<&[GpsPoint]>,
    from: Option<&DetectorGeneration>,
    to: &DetectorGeneration,
) -> rusqlite::Result<i64> {
    let prior_version = milestone_prior_geometry_on(conn, section_id, prior_polyline)?;
    let details = serde_json::json!({
        "from_method": from.map(|g| g.method.clone()),
        "to_method": to.method,
        "config_digest_from": from.map(|g| g.digest.clone()),
        "config_digest_to": to.digest,
        "prior_version": prior_version,
    })
    .to_string();
    append_history_on(
        conn,
        section_id,
        KIND_ALGORITHM_CHANGED,
        Some(&details),
        prior_version,
        None,
    )
}

/// Record that `old_id` gave way to `new_id`, on both ids, so the ledger reads
/// forwards from the retired section and backwards from its replacement.
pub(super) fn append_superseded_pair_on(
    conn: &rusqlite::Connection,
    old_id: &str,
    new_id: &str,
    overlap_fraction: Option<f64>,
) -> rusqlite::Result<(i64, i64)> {
    let old_details = serde_json::json!({
        "superseded_by": new_id,
        "overlap_fraction": overlap_fraction,
    })
    .to_string();
    let new_details = serde_json::json!({
        "supersedes": old_id,
        "overlap_fraction": overlap_fraction,
    })
    .to_string();
    let old_event = append_history_on(
        conn,
        old_id,
        KIND_SUPERSEDED,
        Some(&old_details),
        None,
        None,
    )?;
    let new_event = append_history_on(
        conn,
        new_id,
        KIND_SUPERSEDED,
        Some(&new_details),
        None,
        None,
    )?;
    Ok((old_event, new_event))
}

impl PersistentEngine {
    /// The generation the stored catalogue was cut under, when it disagrees
    /// with the live config. None on a catalogue nothing has saved yet, and
    /// None while the two agree.
    ///
    /// A seeded generation names the detector and not its parameters, so it is
    /// compared on method alone. Reading its sentinel digest as a real one
    /// would tell every migrating user their algorithm changed, including the
    /// ones staying on the detector they already had.
    pub fn detector_generation_change(&self) -> Option<(DetectorGeneration, DetectorGeneration)> {
        let stored = stored_generation_on(&self.db)?;
        let live = DetectorGeneration {
            method: super::DETECTOR_METHOD.to_string(),
            digest: super::section_config_digest(&self.section_config),
        };
        let changed = if stored.digest == PRE_LEDGER_DIGEST {
            stored.method != live.method
        } else {
            stored != live
        };
        changed.then_some((stored, live))
    }

    /// Milestone the outgoing shape and append `algorithm_changed`. Returns the
    /// event row id.
    pub fn record_section_algorithm_change(
        &mut self,
        section_id: &str,
        prior_polyline: Option<&[GpsPoint]>,
        from: Option<&DetectorGeneration>,
        to: &DetectorGeneration,
    ) -> rusqlite::Result<i64> {
        record_algorithm_change_on(&self.db, section_id, prior_polyline, from, to)
    }

    /// Append the `superseded` pair linking a retired id to its replacement.
    pub fn record_section_superseded(
        &mut self,
        old_id: &str,
        new_id: &str,
        overlap_fraction: Option<f64>,
    ) -> rusqlite::Result<(i64, i64)> {
        append_superseded_pair_on(&self.db, old_id, new_id, overlap_fraction)
    }

    /// Store `polyline` as the next geometry version of `section_id` and
    /// prune per the retention policy. Returns the version number written.
    pub fn record_section_geometry(
        &mut self,
        section_id: &str,
        polyline: &[GpsPoint],
        milestone: bool,
        reference: Option<(&str, u32, u32)>,
    ) -> rusqlite::Result<i64> {
        record_geometry_on(&self.db, section_id, polyline, milestone, reference)
    }

    /// Store the line of every geometry version cut from this activity's
    /// stream, so the versions stay readable once the stream is deleted.
    ///
    /// An exact version drops its blob because the stream can rebuild it, and
    /// `section_geometry` has no foreign key to the stream, so the row would
    /// outlive what it is read from. Returns how many versions were written.
    /// A version that already carries a blob, or whose stream no longer
    /// rebuilds it, is left as it is.
    pub fn materialise_geometry_cut_from(&self, activity_id: &str) -> rusqlite::Result<usize> {
        type PendingRow = (String, i64, u32, u32, Option<i64>);
        let pending: Vec<PendingRow> = self
            .db
            .prepare(
                "SELECT section_id, version, rep_start_index, rep_end_index, point_count
                 FROM section_geometry
                 WHERE rep_activity_id = ?1 AND length(blob) = 0
                   AND rep_start_index IS NOT NULL AND rep_end_index IS NOT NULL",
            )?
            .query_map(params![activity_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .collect::<rusqlite::Result<_>>()?;

        let mut written = 0;
        for (section_id, version, start, end, point_count) in pending {
            let Some(line) =
                geometry::rebuild_counted(&self.db, (activity_id, start, end), point_count)
            else {
                continue;
            };
            written += self.db.execute(
                "UPDATE section_geometry SET blob = ? WHERE section_id = ? AND version = ?",
                params![codec::encode_polyline(&line), section_id, version],
            )?;
        }
        Ok(written)
    }

    /// One stored geometry version with the reference it was sliced from:
    /// `(polyline, Some((activity, start, end)))` for an exact version, `None`
    /// reference for an averaged one. None when the version is absent, pruned,
    /// or carries an unknown encoding.
    pub fn section_geometry_version(
        &self,
        section_id: &str,
        version: i64,
    ) -> Option<(Vec<GpsPoint>, Option<SliceReference>)> {
        pooled::section_geometry_version(&self.db, section_id, version)
    }

    /// Decode one stored geometry version. None when the version is absent,
    /// pruned, or carries an unknown encoding.
    pub fn section_geometry_polyline(
        &self,
        section_id: &str,
        version: i64,
    ) -> Option<Vec<GpsPoint>> {
        self.section_geometry_version(section_id, version)
            .map(|(polyline, _)| polyline)
    }

    /// Every section that left the catalogue through a fired retirement and
    /// still has a ledger, newest departure first.
    pub fn retired_sections(&self) -> Vec<RetiredSection> {
        pooled::retired_sections(&self.db)
    }

    /// Visible changes on live sections in the last `days`, newest first:
    /// the re-cuts, splits, restores and reverts a feed can point at. A
    /// section's birth and its record re-basing are not changes to it.
    pub fn recent_section_changes(&self, days: u32) -> Vec<SectionChange> {
        pooled::recent_section_changes(&self.db, days)
    }

    /// Every live section born as a split sibling, with its parent and
    /// discriminator. The newest birth row wins when a section was carved
    /// more than once.
    pub fn section_lineages(&self) -> Vec<SectionLineage> {
        pooled::section_lineages(&self.db)
    }

    /// The surviving versions of one section, oldest first, polylines
    /// excluded.
    pub fn section_geometry_versions(&self, section_id: &str) -> Vec<SectionGeometryVersion> {
        pooled::section_geometry_versions(&self.db, section_id)
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
        pooled::section_history(&self.db, section_id)
    }

    /// Ledger rows with display names and availability for split links.
    pub fn linked_section_history(&self, section_id: &str) -> Vec<SectionHistoryEvent> {
        self.ensure_named_overlay();
        pooled::linked_section_history(&self.db, section_id, &self.named_overlay_cached_names())
    }

    /// Pin `section_id` at a stored geometry version. Returns false without
    /// writing when that version does not exist (absent or already pruned) -
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

    /// Pin a section at the version that draws its current line, writing that
    /// version first when none does (with the reference triple where the row
    /// has one). A section already pinned keeps its pin and its version.
    /// Statements join whatever transaction is open on the connection.
    pub(crate) fn pin_at_current_geometry(&self, section_id: &str) -> Result<(), String> {
        if pooled::pinned_section_version(&self.db, section_id).is_some() {
            return Ok(());
        }
        let (consensus, activity_id, start, end): (bool, Option<String>, Option<u32>, Option<u32>) =
            self.db
                .query_row(
                    "SELECT geometry_source IS 'consensus', representative_activity_id,
                            rep_start_index, rep_end_index
                     FROM sections WHERE id = ?",
                    params![section_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(|e| e.to_string())?;
        // An averaged line belongs to no activity, so it is kept whole.
        let reference =
            geometry::reference(activity_id.as_deref(), start, end).filter(|_| !consensus);
        let line = geometry::stored_line(&self.db, section_id)?;
        let version = record_archived_geometry_on(&self.db, section_id, &line, reference)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Section {section_id} has no line to pin"))?;
        self.db
            .execute(
                "INSERT INTO section_pins (section_id, version) VALUES (?, ?)
                 ON CONFLICT(section_id) DO UPDATE SET
                     version = excluded.version, created_at = datetime('now')",
                params![section_id, version],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Drop a section's pin. Every promotion mutation calls this: a user who
    /// accepts (one or all), trims, expands, resets, merges,
    /// re-references or re-matches a section has taken it over, and a pin that then holds an older line would fight
    /// the edit they just made.
    pub(crate) fn drop_section_pin(&self, section_id: &str) {
        let _ = self.db.execute(
            "DELETE FROM section_pins WHERE section_id = ?",
            params![section_id],
        );
    }

    /// Copy every readable row a rebuild cannot re-derive out of a quarantined
    /// database into this one. Best effort, row by row, so one torn page costs
    /// its rows and nothing else.
    ///
    /// Every Record, Identity and Device table in the declaration comes across,
    /// the id registry included, since this is the same library. Geometry
    /// and user-owned sections need their own treatment because those tables
    /// are classed Derived but carry durable athlete decisions.
    ///
    /// A file that predates the drop of the cutover archive tables has its
    /// archived states converted into the ledger, as opening it would have.
    ///
    /// Junction rows are deliberately NOT salvaged. `section_activities` has an
    /// `ON DELETE CASCADE` foreign key to `activities`, which the fresh
    /// database has none of until the next sync, so every insert would be
    /// rejected. The ingest attach tier (`attach_stored_activity`) matches each
    /// re-synced activity against the whole catalogue, custom sections
    /// included, so the members come back as the library does.
    pub fn salvage_ledger_from(&self, corrupt_path: &str) -> SalvageCounts {
        let Some(src) = open_quarantined(corrupt_path) else {
            return SalvageCounts::default();
        };
        // Guarded on the source's own shape: an older file may lack a column,
        // and one missing name would fail the whole statement.
        let geometry_columns = shared_columns(&src, &self.db, "section_geometry");
        let geometry = if geometry_columns.is_empty() {
            0
        } else {
            let names = geometry_columns.join(", ");
            let marks = vec!["?"; geometry_columns.len()].join(", ");
            salvage_rows(
                &src,
                &self.db,
                &format!("SELECT {names} FROM section_geometry ORDER BY section_id, version"),
                &format!("INSERT OR IGNORE INTO section_geometry ({names}) VALUES ({marks})"),
                geometry_columns.len(),
            )
        };
        let records = salvage_declared_records(&src, &self.db);
        let needs_name_promotion = src
            .query_row(
                "SELECT 1 FROM schema_info WHERE key = 'named_backfill_done'",
                [],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_none();
        let promoted_names = if needs_name_promotion {
            PersistentEngine::promote_legacy_named_rows(&src, &self.db, false).unwrap_or(0)
        } else {
            0
        };
        // Ownership is any of the three marks a promotion leaves, the backed-up
        // line counting in either of its columns, matching the predicate the
        // detection wipe spares and `durable_intent_rows` reads.
        // Guarded on the source's own shape: an older file may lack a column,
        // and one missing name would fail the whole statement.
        let owned = [
            "section_type = 'custom'",
            "is_user_defined = 1",
            "original_polyline_blob IS NOT NULL",
            "original_polyline_json IS NOT NULL",
        ];
        let present = shared_columns(&src, &self.db, "sections");
        let predicate: Vec<&str> = owned
            .iter()
            .copied()
            .filter(|clause| present.iter().any(|c| clause.starts_with(c.as_str())))
            .collect();
        let sections = if predicate.is_empty() {
            0
        } else {
            salvage_table(
                &src,
                &self.db,
                "sections",
                &format!("WHERE {}", predicate.join(" OR ")),
            )
        };
        let schema_from: i32 = src
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if let Ok(rows) = pending_baselines_on(&self.db) {
            for row in rows {
                if let Err(error) = seed_one_baseline_on(&self.db, row, schema_from, None) {
                    log::warn!("veloqrs: could not seed salvaged section geometry: {error}");
                }
            }
        }
        // The archive an older build wrote lives in no declared table, so
        // nothing above copied it; it is read from the source and converted
        // against the ledger rows just salvaged.
        if let Err(error) =
            crate::persistence::cutover::carry_legacy_archive_between(&src, &self.db)
        {
            log::warn!("veloqrs: could not salvage the cutover archive: {error}");
        }
        SalvageCounts {
            history: records["section_history"],
            geometry,
            pins: records["section_pins"],
            sections,
            intents: records["section_intents"] + promoted_names,
            recordings: records["recordings"],
            route_names: records["route_names"],
        }
    }

    /// The pinned version of one section, if any.
    pub fn pinned_section_version(&self, section_id: &str) -> Option<i64> {
        pooled::pinned_section_version(&self.db, section_id)
    }
}

/// The lifecycle reads a screen makes, over a pooled connection rather than
/// the engine's own. Each one is a plain query on committed rows, so the
/// engine methods above delegate here rather than carrying a second copy.
pub(crate) mod pooled {
    /// Visible changes on live sections in the last `days`, newest first.
    ///
    /// Read through the pool as well as through the engine, because the
    /// insights bundle carries them and is served from the pool's connection.
    pub(crate) fn recent_section_changes(
        conn: &rusqlite::Connection,
        days: u32,
    ) -> Vec<super::SectionChange> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT h.section_id, h.kind, h.at FROM section_history h
             JOIN sections s ON s.id = h.section_id
             WHERE h.kind IN ('recut', 'split', 'restored', 'reverted')
               AND h.at >= datetime('now', ?)
             ORDER BY h.at DESC, h.id DESC",
        ) else {
            return Vec::new();
        };
        let window = format!("-{days} days");
        let rows = stmt.query_map(rusqlite::params![window], |row| {
            Ok(super::SectionChange {
                section_id: row.get(0)?,
                kind: row.get(1)?,
                at: row.get(2)?,
            })
        });
        rows.map(|iter| iter.flatten().collect())
            .unwrap_or_default()
    }

    use rusqlite::{Connection, OptionalExtension, params};
    use tracematch::GpsPoint;

    use super::{
        ENCODING_QUANTISED, RetiredSection, SectionGeometryVersion, SectionHistoryEvent,
        SectionLineage, SliceReference, codec, geometry,
    };

    /// One stored geometry version with the reference it was sliced from.
    pub(crate) fn section_geometry_version(
        conn: &Connection,
        section_id: &str,
        version: i64,
    ) -> Option<(Vec<GpsPoint>, Option<SliceReference>)> {
        stored_geometry_version(conn, section_id, version).or_else(|| {
            crate::persistence::record_restore::pending_archived_line(conn, section_id, version)
                .map(|points| (points, None))
        })
    }

    fn stored_geometry_version(
        conn: &Connection,
        section_id: &str,
        version: i64,
    ) -> Option<(Vec<GpsPoint>, Option<SliceReference>)> {
        type GeometryRow = (
            i64,
            Vec<u8>,
            Option<String>,
            Option<u32>,
            Option<u32>,
            Option<i64>,
        );
        let row: GeometryRow = conn
            .query_row(
                "SELECT encoding, blob, rep_activity_id, rep_start_index, rep_end_index,
                        point_count
                 FROM section_geometry WHERE section_id = ? AND version = ?",
                params![section_id, version],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()
            .ok()
            .flatten()?;
        if row.0 != ENCODING_QUANTISED {
            return None;
        }
        let reference = match (row.2, row.3, row.4) {
            (Some(id), Some(start), Some(end)) => Some((id, start, end)),
            _ => None,
        };
        // The version blob is a cache of its own triple, exactly as the live
        // row's is. A version that no longer decodes is still a revert target
        // while its triple indexes the stream it was cut from, which the
        // stored point count vouches for.
        let polyline = codec::decode_polyline(&row.1)
            .filter(|points| !points.is_empty())
            .or_else(|| {
                geometry::rebuild_counted(
                    conn,
                    reference.as_ref().map(|(id, s, e)| (id.as_str(), *s, *e))?,
                    row.5,
                )
            })?;
        Some((polyline, reference))
    }

    /// Every section a fired retirement took out of the catalogue. An
    /// `archived` row is a kept state and not an event, and an upgrade carries
    /// one in after the retirement it follows, so it never stands for how the
    /// section left.
    pub(crate) fn retired_sections(conn: &Connection) -> Vec<RetiredSection> {
        let mut retired = ledger_retired_sections(conn);
        retired.extend(crate::persistence::record_restore::pending_retired_sections(conn));
        retired
    }

    /// How `section_id` left the catalogue and the live section that took its
    /// ground, or `None` when the ledger holds no departure for it.
    ///
    /// The survivor is the live end of the `into` chain: a survivor that
    /// itself retired later hands on to its own, and a chain that ends in no
    /// live section, or loops, names none.
    pub(crate) fn retirement_of(conn: &Connection, section_id: &str) -> Option<RetiredSection> {
        let retired = retired_sections(conn);
        let mut head = retired.iter().find(|r| r.section_id == section_id)?.clone();
        let mut seen = std::collections::HashSet::from([section_id.to_string()]);
        let mut next = head.into.take();
        head.into = loop {
            let Some(id) = next else { break None };
            if !seen.insert(id.clone()) {
                break None;
            }
            match retired.iter().find(|r| r.section_id == id) {
                Some(r) => next = r.into.clone(),
                None => {
                    let live = conn
                        .query_row("SELECT 1 FROM sections WHERE id = ?1", [&id], |_| Ok(()))
                        .is_ok();
                    break live.then_some(id);
                }
            }
        };
        Some(head)
    }

    fn ledger_retired_sections(conn: &Connection) -> Vec<RetiredSection> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT h.section_id, h.kind, h.at, h.details FROM section_history h
             WHERE h.id IN (SELECT MAX(id) FROM section_history
                            WHERE kind <> 'archived' GROUP BY section_id)
               AND h.kind IN ('dissolved', 'merged', 'superseded')
               AND h.section_id NOT IN (SELECT id FROM sections)
             ORDER BY h.at DESC, h.id DESC",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .map(|(section_id, kind, at, details)| {
                let d: serde_json::Value = details
                    .as_deref()
                    .and_then(|d| serde_json::from_str(d).ok())
                    .unwrap_or(serde_json::Value::Null);
                let into = d
                    .get("into")
                    .or_else(|| d.get("superseded_by"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let versions = section_geometry_versions(conn, &section_id)
                    .into_iter()
                    .map(|v| v.version)
                    .collect();
                RetiredSection {
                    section_id,
                    kind,
                    at,
                    into,
                    versions,
                }
            })
            .collect()
    }

    /// Every live section born as a split sibling, newest birth row winning
    /// for its fields. Parts are numbered over every birth in the ledger,
    /// dissolved children included, so a child's number never moves when a
    /// sibling leaves.
    pub(crate) fn section_lineages(conn: &Connection) -> Vec<SectionLineage> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT h.section_id, h.details, s.id IS NOT NULL FROM section_history h
             LEFT JOIN sections s ON s.id = h.section_id
             WHERE h.kind = 'formed' AND h.details LIKE '%split_from%'
             ORDER BY h.id",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        let mut births: Vec<SplitBirth> = Vec::new();
        let mut live: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for (section_id, details, is_live) in iter.flatten() {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&details) else {
                continue;
            };
            let (Some(parent), Some(disc)) = (
                v.get("split_from").and_then(|x| x.as_str()),
                v.get("discriminator").and_then(|x| x.as_str()),
            ) else {
                continue;
            };
            if is_live {
                live.insert(section_id.clone());
            }
            births.push(SplitBirth {
                section_id,
                parent_id: parent.to_string(),
                discriminator: disc.to_string(),
                line_order: v
                    .get("line_order")
                    .and_then(|value| value.as_u64())
                    .and_then(|number| u32::try_from(number).ok()),
            });
        }
        let parts = assign_parts(&births);
        let mut by_id: std::collections::BTreeMap<String, SectionLineage> =
            std::collections::BTreeMap::new();
        for birth in births {
            if !live.contains(&birth.section_id) {
                continue;
            }
            let part = parts[&birth.section_id];
            by_id.insert(
                birth.section_id.clone(),
                SectionLineage {
                    section_id: birth.section_id,
                    parent_id: birth.parent_id,
                    discriminator: birth.discriminator,
                    line_order: birth.line_order,
                    part,
                },
            );
        }
        by_id.into_values().collect()
    }

    /// One split birth row, as the ledger recorded it.
    pub(crate) struct SplitBirth {
        pub section_id: String,
        pub parent_id: String,
        pub discriminator: String,
        pub line_order: Option<u32>,
    }

    /// The part number of every child, from births in ledger order. Per
    /// parent, a child whose recorded place no earlier child holds keeps it;
    /// any other takes one more than the highest held. A child's first birth
    /// row fixes its place.
    pub(crate) fn assign_parts(births: &[SplitBirth]) -> std::collections::HashMap<String, u32> {
        use std::collections::{HashMap, HashSet};
        let mut parts: HashMap<String, u32> = HashMap::new();
        let mut held: HashMap<&str, HashSet<u32>> = HashMap::new();
        let mut highest: HashMap<&str, u32> = HashMap::new();
        for birth in births {
            if parts.contains_key(&birth.section_id) {
                continue;
            }
            let places = held.entry(&birth.parent_id).or_default();
            let top = highest.entry(&birth.parent_id).or_insert(0);
            let part = match birth.line_order {
                Some(order) if order > 0 && !places.contains(&order) => order,
                _ => *top + 1,
            };
            places.insert(part);
            *top = (*top).max(part);
            parts.insert(birth.section_id.clone(), part);
        }
        parts
    }

    pub(crate) fn section_geometry_versions(
        conn: &Connection,
        section_id: &str,
    ) -> Vec<SectionGeometryVersion> {
        let Ok(mut stmt) = conn.prepare(
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

    /// The activity the athlete set as the section's reference, when the
    /// newest of the section's reference set and reference reset rows is a
    /// set. The section's `representative_activity_id` cannot answer this:
    /// detection writes it too.
    pub(crate) fn athlete_reference(conn: &Connection, section_id: &str) -> Option<String> {
        let (kind, details): (String, Option<String>) = conn
            .query_row(
                "SELECT kind, details FROM section_history
                 WHERE section_id = ? AND kind IN (?, ?)
                 ORDER BY id DESC LIMIT 1",
                params![
                    section_id,
                    super::KIND_REFERENCE_SET,
                    super::KIND_REFERENCE_RESET
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .ok()
            .flatten()?;
        if kind != super::KIND_REFERENCE_SET {
            return None;
        }
        let details: serde_json::Value = serde_json::from_str(details.as_deref()?).ok()?;
        details
            .get("activity_id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    }

    pub(crate) fn section_history(conn: &Connection, section_id: &str) -> Vec<SectionHistoryEvent> {
        let Ok(mut stmt) = conn.prepare(
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

    pub(crate) fn linked_section_history(
        conn: &Connection,
        section_id: &str,
        names: &std::collections::BTreeMap<String, String>,
    ) -> Vec<SectionHistoryEvent> {
        let mut history = section_history(conn, section_id);
        // The cutover's snapshot row is bookkeeping for the diff and the
        // backup. The shape it keeps is in the version list, and the
        // `algorithm_changed` row is what tells the change.
        history.retain(|event| event.kind != super::KIND_ARCHIVED);
        let Ok(mut target) = conn.prepare(
            "SELECT section_type, name, disabled, superseded_by FROM sections WHERE id = ?",
        ) else {
            return history;
        };
        let mut link = |id: &str| {
            let row = target
                .query_row(params![id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, bool>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })
                .optional()
                .ok()
                .flatten();
            match row {
                Some((section_type, name, disabled, superseded_by)) => serde_json::json!({
                    "id": id,
                    "name": if section_type == "auto" {
                        names.get(id).cloned().or(name)
                    } else {
                        name.or_else(|| names.get(id).cloned())
                    },
                    "available": !disabled && superseded_by.is_none(),
                }),
                None => serde_json::json!({"id": id, "name": null, "available": false}),
            }
        };
        for event in &mut history {
            let Some(details) = event.details.as_deref() else {
                continue;
            };
            let Ok(mut value) = serde_json::from_str::<serde_json::Value>(details) else {
                continue;
            };
            let Some(object) = value.as_object_mut() else {
                continue;
            };
            if event.kind == "formed" {
                if let Some(id) = object.get("split_from").and_then(|v| v.as_str()) {
                    let linked = link(id);
                    object.insert("split_from_link".into(), linked);
                }
            } else if event.kind == "split"
                && let Some(ids) = object.get("siblings").and_then(|v| v.as_array())
            {
                let linked: Vec<_> = ids
                    .iter()
                    .filter_map(|v| v.as_str())
                    .map(&mut link)
                    .collect();
                object.insert("split_into_links".into(), serde_json::json!(linked));
            }
            event.details = Some(value.to_string());
        }
        history
    }

    /// Every ledger row on a section that names `activity_id`, newest first.
    ///
    /// `instr` on the quoted id narrows the rows and takes no wildcard, so an
    /// id carrying `%` or `_` matches only itself; the details are then parsed
    /// and the id must sit in one of the keys a row attributes, so a longer id
    /// that contains it, or a key that merely mentions it, is not a match. A
    /// section that no longer has a row is left out.
    pub(crate) fn ledger_changes_naming_activity(
        conn: &Connection,
        activity_id: &str,
        names: &std::collections::BTreeMap<String, String>,
    ) -> Vec<super::ActivityLedgerChange> {
        let Ok(needle) = serde_json::to_string(activity_id) else {
            return Vec::new();
        };
        let Ok(mut stmt) = conn.prepare(
            "SELECT h.id, h.section_id, h.at, h.kind, h.details, s.section_type, s.name
             FROM section_history h JOIN sections s ON s.id = h.section_id
             WHERE h.details IS NOT NULL AND instr(h.details, ?) > 0
             ORDER BY h.at DESC, h.id DESC",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map(params![needle], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        });
        let Ok(rows) = rows else {
            return Vec::new();
        };
        let mut found = Vec::new();
        for (event_id, section_id, at, kind, details, section_type, name) in rows.flatten() {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&details) else {
                continue;
            };
            let lists_it = |key: &str| {
                value
                    .get(key)
                    .and_then(|v| v.as_array())
                    .is_some_and(|ids| ids.iter().any(|v| v.as_str() == Some(activity_id)))
            };
            let is_it = |key: &str| value.get(key).and_then(|v| v.as_str()) == Some(activity_id);
            let mut relations = Vec::new();
            if lists_it("around") {
                relations.push("around");
            }
            if lists_it("fork_around") {
                relations.push("fork_around");
            }
            if kind == super::KIND_REFERENCE_REANCHORED {
                if is_it("from") {
                    relations.push("reanchored_from");
                }
                if is_it("to") {
                    relations.push("reanchored_to");
                }
            }
            let section_name = if section_type == "auto" {
                names.get(&section_id).cloned().or(name)
            } else {
                name.or_else(|| names.get(&section_id).cloned())
            };
            for relation in relations {
                found.push(super::ActivityLedgerChange {
                    event_id,
                    section_id: section_id.clone(),
                    section_name: section_name.clone(),
                    section_type: section_type.clone(),
                    at: at.clone(),
                    kind: kind.clone(),
                    relation: relation.to_string(),
                });
            }
        }
        found
    }

    pub(crate) fn pinned_section_version(conn: &Connection, section_id: &str) -> Option<i64> {
        conn.query_row(
            "SELECT version FROM section_pins WHERE section_id = ?",
            params![section_id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PersistentEngine;
    use tempfile::TempDir;

    #[test]
    fn every_declared_record_identity_and_device_table_enters_quarantine_salvage() {
        let src = rusqlite::Connection::open_in_memory().unwrap();
        let dst = rusqlite::Connection::open_in_memory().unwrap();
        for class in [
            crate::persistence::tables::TableClass::Record,
            crate::persistence::tables::TableClass::Identity,
            crate::persistence::tables::TableClass::Device,
        ] {
            for table in crate::persistence::tables::tables_of(class) {
                let create = format!("CREATE TABLE {table} (value TEXT)");
                src.execute(&create, []).unwrap();
                dst.execute(&create, []).unwrap();
                src.execute(&format!("INSERT INTO {table} VALUES ('owned')"), [])
                    .unwrap();
            }
        }
        let counts = salvage_declared_records(&src, &dst);
        for class in [
            crate::persistence::tables::TableClass::Record,
            crate::persistence::tables::TableClass::Identity,
            crate::persistence::tables::TableClass::Device,
        ] {
            for table in crate::persistence::tables::tables_of(class) {
                assert_eq!(counts[table], 1, "{table} must be copied");
                let count: i64 = dst
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(count, 1, "{table} must reach the new database");
            }
        }
    }

    /// A 1,000 m section `s1` and one traversal per `(activity, sport,
    /// direction, lap_time, coverage)`, each activity added under its sport.
    fn section_with_laps(laps: &[(&str, &str, &str, f64, Option<f64>)]) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().expect("engine");
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at)
                 VALUES ('s1', 'auto', 'Climb', 'Ride', '[]', 1000.0, 0, 1,
                    '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("section");
        for (activity, sport, direction, lap_time, coverage) in laps {
            if engine.get_gps_track(activity).is_none() {
                engine
                    .add_activity(activity.to_string(), ride(), sport.to_string())
                    .expect("add_activity");
            }
            let start: i64 = engine
                .db
                .query_row(
                    "SELECT COUNT(*) FROM section_activities WHERE activity_id = ?",
                    params![activity],
                    |row| row.get(0),
                )
                .expect("count");
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters, lap_time, lap_pace, coverage)
                     VALUES ('s1', ?1, ?2, ?3, ?3 + 10, 1000.0, ?4, 1000.0 / ?4, ?5)",
                    params![activity, direction, start * 20, lap_time, coverage],
                )
                .expect("traversal");
        }
        engine
    }

    fn rebased_rows(conn: &rusqlite::Connection) -> Vec<serde_json::Value> {
        let mut stmt = conn
            .prepare("SELECT details FROM section_history WHERE kind = 'pr_rebased' ORDER BY id")
            .expect("prepare");
        stmt.query_map([], |row| row.get::<_, String>(0))
            .expect("query")
            .filter_map(Result::ok)
            .map(|d| serde_json::from_str(&d).expect("json"))
            .collect()
    }

    /// The era a re-cut carried, in the per-sport shape the snapshot writes.
    fn era(records: &[(&str, &str, f64)]) -> String {
        let prs: serde_json::Map<String, serde_json::Value> = records
            .iter()
            .map(|(sport, activity, time)| {
                (
                    sport.to_string(),
                    serde_json::json!({ "activity_id": activity, "time": time }),
                )
            })
            .collect();
        serde_json::json!({ "prs": prs }).to_string()
    }

    /// Scenario: a section is run in about four minutes and ridden in about
    /// one. A re-cut lands a faster run.
    ///
    /// Expected behaviour: the record is held within one sport, so the
    /// ledger says the run record moved from 250 s to 240 s and says nothing
    /// about the ride, which never was the run's record.
    #[test]
    fn a_rebase_compares_each_sport_with_its_own_record() {
        let engine = section_with_laps(&[
            ("run1", "Run", "same", 250.0, Some(1.0)),
            ("run2", "Run", "same", 240.0, Some(1.0)),
            ("ride1", "Ride", "same", 65.0, Some(1.0)),
        ]);
        let before = era(&[("Run", "run1", 250.0), ("Ride", "ride1", 65.0)]);

        record_pr_rebase_on(&engine.db, "s1", Some(&before)).expect("rebase");

        let rows = rebased_rows(&engine.db);
        assert_eq!(rows.len(), 1, "one sport's record moved: {rows:?}");
        assert_eq!(rows[0]["sport"], "Run");
        assert_eq!(rows[0]["from_time"], 250.0);
        assert_eq!(rows[0]["to_time"], 240.0);
        assert_eq!(rows[0]["to_activity_id"], "run2");
    }

    /// Scenario: the fastest included row covers 59 per cent of the section,
    /// and a `partial` row is shorter still.
    ///
    /// Expected behaviour: neither is a traversal the record can be taken
    /// from, so the record is still the full lap and no move is written.
    #[test]
    fn a_fragment_does_not_move_the_record() {
        let engine = section_with_laps(&[
            ("full", "Ride", "same", 98.0, Some(1.0)),
            ("frag", "Ride", "same", 44.0, Some(0.59)),
            ("part", "Ride", "partial", 40.0, None),
        ]);
        let before = era(&[("Ride", "full", 98.0)]);

        record_pr_rebase_on(&engine.db, "s1", Some(&before)).expect("rebase");

        assert_eq!(rebased_rows(&engine.db), Vec::<serde_json::Value>::new());
    }

    /// Scenario: a section is run once, ridden once in full, ridden once in
    /// three laps, crossed once on a 50 per cent fragment, and ridden once
    /// faster but excluded. Detection then dissolves or re-cuts it and
    /// snapshots the era.
    ///
    /// Expected behaviour: the snapshot holds only the per-sport records, each
    /// from an included full traversal.
    #[test]
    fn the_era_snapshot_keeps_one_full_lap_record_per_sport() {
        let engine = section_with_laps(&[
            ("run1", "Run", "same", 250.0, Some(1.0)),
            ("ride1", "Ride", "same", 65.0, Some(1.0)),
            ("loop", "Ride", "same", 70.0, Some(1.0)),
            ("loop", "Ride", "same", 71.0, Some(1.0)),
            ("loop", "Ride", "same", 72.0, Some(1.0)),
            ("frag", "Ride", "same", 30.0, Some(0.5)),
            ("hidden", "Ride", "same", 40.0, Some(1.0)),
        ]);
        engine
            .db
            .execute(
                "UPDATE section_activities SET excluded = 1 WHERE activity_id = 'hidden'",
                [],
            )
            .expect("exclude");

        let snap = serde_json::Value::Object(engine.section_era_snapshot("s1"));

        assert_eq!(
            snap["prs"],
            serde_json::json!({
                "Ride": { "activity_id": "ride1", "time": 65.0 },
                "Run": { "activity_id": "run1", "time": 250.0 },
            })
        );
        let keys: Vec<&String> = snap.as_object().expect("object").keys().collect();
        assert_eq!(keys, vec!["prs"]);
    }

    /// Scenario: two activities hold the same fastest lap time, the higher
    /// activity id inserted first, in two sports.
    ///
    /// Expected behaviour: the record, and the era snapshot that stores it,
    /// names the lower activity id whatever the insertion order.
    #[test]
    fn tied_lap_times_give_the_record_to_the_lower_activity_id() {
        let engine = section_with_laps(&[
            ("act_b", "Ride", "same", 60.0, Some(1.0)),
            ("act_a", "Ride", "same", 60.0, Some(1.0)),
            ("run_b", "Run", "same", 200.0, Some(1.0)),
            ("run_a", "Run", "same", 200.0, Some(1.0)),
        ]);

        let prs = current_prs_on(&engine.db, "s1");
        assert_eq!(prs["Ride"], ("act_a".to_string(), 60.0));
        assert_eq!(prs["Run"], ("run_a".to_string(), 200.0));

        let snap = serde_json::Value::Object(engine.section_era_snapshot("s1"));
        assert_eq!(snap["prs"]["Ride"]["activity_id"], "act_a");
        assert_eq!(snap["prs"]["Run"]["activity_id"], "run_a");
    }

    /// A line long enough that the version below is an interior slice of it.
    fn ride() -> Vec<GpsPoint> {
        (0..80)
            .map(|i| GpsPoint {
                latitude: 46.2 + f64::from(i) * 0.000_09,
                longitude: 7.36 + f64::from(i) * 0.000_11,
                elevation: None,
            })
            .collect()
    }

    fn engine_with_ride() -> (PersistentEngine, TempDir, Vec<GpsPoint>) {
        let dir = TempDir::new().expect("tempdir");
        let mut engine =
            PersistentEngine::new(dir.path().join("history.db").to_str().expect("utf-8"))
                .expect("open engine");
        engine
            .add_activity("a1".to_string(), ride(), "Ride".to_string())
            .expect("add_activity");
        let stored = engine.get_gps_track("a1").expect("stored track");
        (engine, dir, stored)
    }

    fn versions(conn: &rusqlite::Connection, section_id: &str) -> Vec<i64> {
        let mut stmt = conn
            .prepare("SELECT version FROM section_geometry WHERE section_id = ? ORDER BY version")
            .expect("prepare");
        let rows = stmt
            .query_map(params![section_id], |row| row.get::<_, i64>(0))
            .expect("query");
        rows.filter_map(|r| r.ok()).collect()
    }

    /// The milestone asks whether the newest stored version is already the
    /// line it is about to keep. An exact version answers that from its
    /// triple, so dropping its blob must not make every change look like a
    /// change and write a version per detect.
    #[test]
    fn a_milestone_of_an_unchanged_exact_version_writes_no_second_copy() {
        let (engine, _dir, stored) = engine_with_ride();
        let line = stored[20..60].to_vec();
        let reference = Some(("a1", 20u32, 60u32));
        record_geometry_on(&engine.db, "s1", &line, false, reference).expect("record");

        let milestoned = milestone_prior_geometry_on(&engine.db, "s1", Some(&line))
            .expect("milestone")
            .expect("a stored version to keep");

        assert_eq!(milestoned, 1, "the version already stored is the milestone");
        assert_eq!(versions(&engine.db, "s1"), vec![1]);
    }

    /// Scenario: an exact version was cut from a stream that a sync has since
    /// replaced, and the section row still names the same triple.
    ///
    /// Expected behaviour: the version no longer rebuilds, so it is not the
    /// line being kept, and the current line lands as a new milestone.
    #[test]
    fn a_milestone_does_not_keep_an_exact_version_whose_stream_was_replaced() {
        let (engine, _dir, stored) = engine_with_ride();
        let line = stored[20..60].to_vec();
        record_geometry_on(&engine.db, "s1", &line, false, Some(("a1", 20, 60))).expect("record");
        engine
            .db
            .execute(
                "UPDATE section_geometry SET point_count = ? WHERE section_id = 's1'",
                params![stored.len() as i64 - 1],
            )
            .expect("age the version");

        let milestoned = milestone_prior_geometry_on(&engine.db, "s1", Some(&line))
            .expect("milestone")
            .expect("a version");

        assert_eq!(milestoned, 2);
        assert_eq!(versions(&engine.db, "s1"), vec![1, 2]);
    }

    /// A line that really did change still lands as a new milestone version.
    #[test]
    fn a_milestone_of_a_changed_line_writes_a_new_version() {
        let (engine, _dir, stored) = engine_with_ride();
        let line = stored[20..60].to_vec();
        record_geometry_on(&engine.db, "s1", &line, false, Some(("a1", 20, 60))).expect("record");

        let moved = stored[24..64].to_vec();
        let milestoned = milestone_prior_geometry_on(&engine.db, "s1", Some(&moved))
            .expect("milestone")
            .expect("a version");

        assert_eq!(milestoned, 2);
        assert_eq!(versions(&engine.db, "s1"), vec![1, 2]);
    }

    fn seed_birth(
        engine: &PersistentEngine,
        child: &str,
        parent: &str,
        line_order: Option<u32>,
        live: bool,
    ) {
        if live {
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at)
                     VALUES (?1, 'auto', 'Part', 'Ride', '[]', 100.0, 0, 1,
                        '2026-01-01T00:00:00Z')",
                    [child],
                )
                .expect("section");
        }
        let mut details = serde_json::json!({
            "split_from": parent,
            "discriminator": "2",
        });
        if let Some(order) = line_order {
            details["line_order"] = serde_json::json!(order);
        }
        engine
            .db
            .execute(
                "INSERT INTO section_history (section_id, at, kind, details)
                 VALUES (?1, '2026-01-01T00:00:00Z', 'formed', ?2)",
                params![child, details.to_string()],
            )
            .expect("birth");
    }

    fn parts_of(engine: &PersistentEngine, ids: &[&str]) -> Vec<u32> {
        let lineages = engine.section_lineages();
        ids.iter()
            .map(|id| {
                lineages
                    .iter()
                    .find(|l| l.section_id == *id)
                    .unwrap_or_else(|| panic!("{id} has no lineage"))
                    .part
            })
            .collect()
    }

    #[test]
    fn a_child_after_the_retained_piece_is_part_two() {
        let engine = PersistentEngine::in_memory().expect("engine");
        seed_birth(&engine, "c", "p", Some(2), true);
        assert_eq!(parts_of(&engine, &["c"]), vec![2]);
    }

    #[test]
    fn children_either_side_of_the_retained_piece_are_parts_one_and_three() {
        let engine = PersistentEngine::in_memory().expect("engine");
        seed_birth(&engine, "before", "p", Some(1), true);
        seed_birth(&engine, "after", "p", Some(3), true);
        assert_eq!(parts_of(&engine, &["before", "after"]), vec![1, 3]);
    }

    #[test]
    fn a_second_split_numbers_after_the_first_in_birth_order() {
        let engine = PersistentEngine::in_memory().expect("engine");
        seed_birth(&engine, "a", "p", Some(1), true);
        seed_birth(&engine, "b", "p", Some(2), true);
        seed_birth(&engine, "c", "p", Some(1), true);
        seed_birth(&engine, "d", "p", Some(2), true);
        assert_eq!(parts_of(&engine, &["a", "b", "c", "d"]), vec![1, 2, 3, 4]);
    }

    #[test]
    fn a_child_without_a_recorded_place_follows_the_highest_held() {
        let engine = PersistentEngine::in_memory().expect("engine");
        seed_birth(&engine, "a", "p", Some(4), true);
        seed_birth(&engine, "legacy", "p", None, true);
        assert_eq!(parts_of(&engine, &["a", "legacy"]), vec![4, 5]);
    }

    #[test]
    fn a_child_with_no_place_and_no_siblings_is_part_one() {
        let engine = PersistentEngine::in_memory().expect("engine");
        seed_birth(&engine, "legacy", "p", None, true);
        assert_eq!(parts_of(&engine, &["legacy"]), vec![1]);
    }

    #[test]
    fn a_dissolved_sibling_keeps_its_place_held() {
        let engine = PersistentEngine::in_memory().expect("engine");
        seed_birth(&engine, "gone", "p", Some(2), false);
        seed_birth(&engine, "kept", "p", Some(3), true);
        seed_birth(&engine, "later", "p", Some(2), true);
        assert_eq!(parts_of(&engine, &["kept", "later"]), vec![3, 4]);
    }

    #[test]
    fn parents_number_their_children_independently() {
        let engine = PersistentEngine::in_memory().expect("engine");
        seed_birth(&engine, "a", "p", Some(2), true);
        seed_birth(&engine, "b", "q", Some(2), true);
        assert_eq!(parts_of(&engine, &["a", "b"]), vec![2, 2]);
    }

    #[test]
    fn a_rewritten_birth_row_keeps_the_first_place() {
        let engine = PersistentEngine::in_memory().expect("engine");
        seed_birth(&engine, "a", "p", Some(2), true);
        seed_birth(&engine, "a", "p", Some(5), false);
        seed_birth(&engine, "b", "p", Some(2), true);
        assert_eq!(parts_of(&engine, &["a", "b"]), vec![2, 3]);
    }

    fn section_row(engine: &PersistentEngine, id: &str, section_type: &str, name: &str) {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at)
                 VALUES (?1, ?2, ?3, 'Ride', '[]', 1000.0, 0, 1, '2026-01-01T00:00:00Z')",
                params![id, section_type, name],
            )
            .expect("section");
    }

    fn change(engine: &PersistentEngine, section_id: &str, kind: &str, at: &str, details: &str) {
        append_history_on(&engine.db, section_id, kind, Some(details), None, Some(at))
            .expect("history row");
    }

    fn relations_of(conn: &rusqlite::Connection, activity_id: &str) -> Vec<(String, String)> {
        let names = std::collections::BTreeMap::new();
        pooled::ledger_changes_naming_activity(conn, activity_id, &names)
            .into_iter()
            .map(|c| (c.section_id, c.relation))
            .collect()
    }

    /// Scenario: a fork re-cut and a pending change both name activity `a1` on
    /// their sections' ledgers, and a re-anchor moved a line off `a1`.
    ///
    /// Expected behaviour: the activity's read lists each change once with how
    /// it names the activity, newest first, and a row naming only `a10` or
    /// `a1` as a substring of another id is not a match.
    #[test]
    fn a_ledger_row_naming_an_activity_is_found_from_the_activity() {
        let engine = PersistentEngine::in_memory().expect("engine");
        section_row(&engine, "s1", "auto", "Climb");
        section_row(&engine, "s2", "custom", "Loop");
        change(
            &engine,
            "s1",
            "recut",
            "2026-02-01 10:00:00",
            r#"{"around":["a1","a2"],"fork_around":["a1"]}"#,
        );
        change(
            &engine,
            "s2",
            KIND_REFERENCE_REANCHORED,
            "2026-03-01 10:00:00",
            r#"{"from":"a1","to":"a3","cause":"activity_removed"}"#,
        );
        change(
            &engine,
            "s1",
            "recut",
            "2026-04-01 10:00:00",
            r#"{"around":["a10"]}"#,
        );
        change(
            &engine,
            "s1",
            "recut",
            "2026-05-01 10:00:00",
            r#"{"split_from":"a1"}"#,
        );
        change(&engine, "s1", "recut", "2026-06-01 10:00:00", "not json a1");

        let names = std::collections::BTreeMap::from([("s1".to_string(), "Named".to_string())]);
        let found = pooled::ledger_changes_naming_activity(&engine.db, "a1", &names);
        let shape: Vec<(&str, &str, Option<&str>)> = found
            .iter()
            .map(|c| {
                (
                    c.section_id.as_str(),
                    c.relation.as_str(),
                    c.section_name.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            shape,
            vec![
                ("s2", "reanchored_from", Some("Loop")),
                ("s1", "around", Some("Named")),
                ("s1", "fork_around", Some("Named")),
            ]
        );
        assert_eq!(found[0].section_type, "custom");
        assert_eq!(found[0].kind, KIND_REFERENCE_REANCHORED);

        assert_eq!(
            relations_of(&engine.db, "a3"),
            vec![("s2".to_string(), "reanchored_to".to_string())]
        );
        assert!(relations_of(&engine.db, "a%").is_empty());
        assert!(relations_of(&engine.db, "nobody").is_empty());
    }
}
