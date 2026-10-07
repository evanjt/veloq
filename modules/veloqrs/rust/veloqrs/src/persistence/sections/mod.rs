//! Section management: every read and write of a section on one tree.
//!
//! `queries` reads, `mutations` creates, renames, references and deletes,
//! `editing` handles bounds, visibility and imports, and the rest is
//! detection, identity, ranking, naming and history. All of it is
//! `impl PersistentEngine`, so a question like "what happens on rename" is
//! answered here and nowhere else.

mod anchoring;
pub mod conditioning;
pub(crate) mod correlations;
pub(crate) mod detection;
// The encode is the caller's now, not the apply's: a worker pays it before it
// takes the write lock and hands the row in. Both halves are re-exported so a
// gate can put the two encodes side by side.
pub use detection::{EvidenceRow, encode_evidence_row};
pub(crate) mod attempt_histogram;
mod editing;
pub(crate) mod geometry;
pub(crate) mod history;
mod identity;
mod interest;
pub(crate) mod lap_curves;
pub(crate) mod merging;
mod mutations;
pub(crate) mod named;
pub(crate) mod naming;
pub(crate) mod numbers;
pub(crate) mod preview;
pub(crate) mod queries;
pub(crate) mod ranking;
#[cfg(test)]
#[path = "tests/save_backstop.rs"]
mod save_backstop_tests;
pub(crate) mod track_pool;
pub(crate) mod trend_curve;

pub(crate) use anchoring::anchoring_owed;
pub use history::{
    DetectorGeneration, KIND_ARCHIVED, KIND_RESTORED, KIND_REVERTED, RetiredSection,
    SOURCE_CONSENSUS, SOURCE_EXACT, SOURCE_ORPHANED, SalvageCounts, SectionChange,
    SectionGeometryVersion, SectionHistoryEvent, SectionLineage,
};
pub(crate) use identity::SECTION_IDENTITY_KEY;
pub(crate) use identity::SectionIdentity;
pub use identity::content_id_for;
pub(crate) use identity::{identity_blob_for, purge_activity_from_tiers};
use interest::IS_LIFT_UNLESS_UNFLAGGED;
pub(crate) use named::is_section_handle;
pub use named::{NamedCorridor, NamedOverlay};
pub use naming::SectionNameError;
pub(crate) use ranking::{chart_from_cutoff, range_cutoff};

pub use detection::detection_workers_started;
pub(crate) use detection::rank_off_lock;
pub use detection::{
    DETECTION_PHASE_CUTOVER_OWED, DETECTION_PHASE_DISABLED, DETECTION_PHASE_SUSPENDED,
    DetectionRefusal, detection_refusal, detection_was_refused,
};
pub use interest::locked_rank_passes;

use crate::sections::{LapCarry, assign_carried_exclusions};
use crate::{FrequentSection, GpsPoint, SectionPortion};
use chrono::Utc;
use rusqlite::{Result as SqlResult, params, types::Type};
use std::collections::{HashMap, HashSet};

use super::schema::{SECTION_SUMMARY_BULK_KEY, recount_section_summaries};
use super::{PersistentEngine, SectionSummary, codec};

pub(crate) fn decode_point_density(
    blob: Option<&[u8]>,
    json: Option<&str>,
    section_id: &str,
    json_column: usize,
    blob_column: usize,
) -> SqlResult<Option<Vec<u32>>> {
    if let Some(bytes) = blob {
        return codec::deserialize(bytes).map(Some).map_err(|error| {
            log::error!(
                "veloqrs: sections.point_density_blob decode failed for id {section_id}: {error}"
            );
            rusqlite::Error::FromSqlConversionFailure(blob_column, Type::Blob, error.into())
        });
    }
    if let Some(value) = json {
        return serde_json::from_str(value).map(Some).map_err(|error| {
            log::error!(
                "veloqrs: sections.point_density_json decode failed for id {section_id}: {error}"
            );
            rusqlite::Error::FromSqlConversionFailure(json_column, Type::Text, Box::new(error))
        });
    }
    Ok(None)
}

/// `schema_info` key naming the detection method that cut the stored catalogue.
pub const CATALOGUE_METHOD_KEY: &str = "catalogue_detection_method";

/// The one detector this build ships. Stored beside every catalogue so a
/// database cut by an older build reads as owed a cutover.
pub const DETECTOR_METHOD: &str = "unified";

/// `schema_info` key holding [`section_config_digest`] of the config the stored
/// catalogue ran under.
pub const CATALOGUE_CONFIG_DIGEST_KEY: &str = "catalogue_config_digest";

/// Revision of the detector's code and tunables, bumped by hand whenever a
/// change makes the same activities cut different sections with no
/// [`tracematch::sections::SectionConfig`] field moving.
///
/// It is folded into [`section_config_digest`], so a bump drops the persisted
/// evidence cache and records an algorithm change for the stored catalogue.
/// Revision 0 hashes the config alone, which keeps every digest written before
/// this constant existed valid.
pub const DETECTOR_REVISION: u32 = 0;

/// Stable fingerprint of a detection config under the live detector revision,
/// as 16 lowercase hex digits.
///
/// Two devices holding the same config agree on this string. The input is the
/// serde form, ordered by struct declaration rather than by map iteration, and
/// the hash is FNV-1a, whose output is fixed across processes and releases.
pub fn section_config_digest(config: &tracematch::sections::SectionConfig) -> String {
    section_config_digest_at(config, DETECTOR_REVISION)
}

/// [`section_config_digest`] for an explicit detector revision.
pub(crate) fn section_config_digest_at(
    config: &tracematch::sections::SectionConfig,
    revision: u32,
) -> String {
    let Ok(canonical) = serde_json::to_string(config) else {
        return "unserialisable".to_string();
    };
    let revision_suffix = (revision != 0).then(|| format!("|detector_revision={revision}"));
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let suffix = revision_suffix.as_deref().unwrap_or("").as_bytes();
    for byte in canonical.as_bytes().iter().chain(suffix) {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Haversine distance between two lat/lng points in meters.
pub(super) use crate::persistence::haversine_distance_meters as haversine_distance;

/// The mean heart rate over one traversal, from the activity's own series.
///
/// Indices are the half-open pair every writer of `section_activities` stores,
/// the same space [`compute_lap_time_from_stream`] reads, so the last sample of
/// the traversal is `end_index - 1`.
///
/// Absent samples are skipped rather than counted as zero: a strap that dropped
/// out for a minute must not read as a minute at nought beats. `None` when
/// there is no series, when either index is out of bounds, or when nothing in
/// the slice was recorded, all of which are "this lap has no heart rate" rather
/// than a heart rate of nought.
pub(super) fn mean_over_traversal(
    series: Option<&[Option<f64>]>,
    start_index: u32,
    end_index: u32,
) -> Option<f64> {
    let series = series?;
    if end_index == 0 || end_index as usize > series.len() {
        return None;
    }
    let si = start_index as usize;
    let ei = end_index as usize - 1;
    if si >= series.len() || ei < si {
        return None;
    }
    let present: Vec<f64> = series[si..=ei].iter().flatten().copied().collect();
    if present.is_empty() {
        return None;
    }
    Some(present.iter().sum::<f64>() / present.len() as f64)
}

/// Compute `(lap_time, lap_pace)` from a time stream slice and traversal indices.
///
/// `end_index` is the half-open end every writer of `section_activities` stores,
/// so the last point of the traversal is `end_index - 1` and a portion running
/// to the last point of its activity carries `end_index == point_count`.
///
/// Returns `(None, None)` when:
/// - `times` is `None` (no stream available)
/// - either index is out of bounds
/// - the traversal holds fewer than two points
///
/// Shared by the detection-time populate path (`save_sections`), the manual
/// insert path (`insert_section_activity`), and the lazy backfill path.
pub(super) fn compute_lap_time_from_stream(
    times: Option<&[u32]>,
    track_points: Option<usize>,
    start_index: u32,
    end_index: u32,
    distance_meters: f64,
) -> (Option<f64>, Option<f64>) {
    let times = match times {
        Some(t) => t,
        None => return (None, None),
    };
    // A stream that is not the track's length is not in the track's index
    // space. `fetch_time_stream` has reduced `time` through the `latlng` mask
    // since 2026-08-16, but every 0.3.x stored the raw series, which keeps the
    // samples the coordinate mask drops. Indexing that with track indices reads
    // the wrong window, and the four lap-time readers were the one place the
    // rule was not applied: the detector's loader and the scrubber's body
    // builder both refuse such a stream already.
    //
    // `None` is "the track length is not knowable here", which an activity with
    // no track row is, and not evidence of a misalignment.
    if track_points.is_some_and(|n| n != times.len()) {
        return (None, None);
    }
    if end_index == 0 || end_index as usize > times.len() {
        return (None, None);
    }
    let si = start_index as usize;
    let ei = end_index as usize - 1;
    if si >= times.len() || ei <= si {
        return (None, None);
    }
    let lap_time = (times[ei] as f64 - times[si] as f64).abs();
    if lap_time <= 0.0 {
        return (None, None);
    }
    let lap_pace = distance_meters / lap_time;
    (Some(lap_time), Some(lap_pace))
}

/// Exclusion rows the auto-section wipe is about to cascade away:
/// `None` fate for a fully excluded activity, `Some(laps)` for per-lap
/// state: the `start_index` of every row, excluded and included.
type CarriedExclusions = Vec<(String, String, Option<LapCarry>)>;

/// Relative change in a section's length from which an adopted line counts as
/// a new extent. Below it the line is the same ground drawn again.
const ADOPTED_EXTENT_FRACTION: f64 = 0.05;

/// A derived section's line, reference and length as the catalogue held them
/// before a detect replaced the row.
struct OutgoingShape {
    line: Vec<GpsPoint>,
    reference: Option<(String, u32, u32)>,
    distance_meters: f64,
}

fn outgoing_shapes(conn: &rusqlite::Connection) -> SqlResult<HashMap<String, OutgoingShape>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, polyline_blob, polyline_json, representative_activity_id,
                rep_start_index, rep_end_index, distance_meters
         FROM sections WHERE {DERIVED_SECTION_PREDICATE}"
    ))?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<Vec<u8>>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<u32>>(4)?,
            row.get::<_, Option<u32>>(5)?,
            row.get::<_, f64>(6)?,
        ))
    })?;
    let mut shapes = HashMap::new();
    for row in rows {
        let (id, blob, json, rep_id, start, end, distance_meters) = row?;
        let reference = geometry::reference(rep_id.as_deref(), start, end);
        let line =
            geometry::line(conn, blob.as_deref(), json.as_deref(), reference).unwrap_or_default();
        let reference = reference.map(|(id, start, end)| (id.to_string(), start, end));
        shapes.insert(
            id,
            OutgoingShape {
                line,
                reference,
                distance_meters,
            },
        );
    }
    Ok(shapes)
}

/// Whether adopting `section` over `outgoing` moved the reference ride or the
/// length by enough that the ledger has to say so.
fn adoption_moved_extent(section: &FrequentSection, outgoing: &OutgoingShape) -> bool {
    let reference = section
        .representative_range
        .filter(|_| !section.representative_activity_id.is_empty())
        .map(|(start, end)| (section.representative_activity_id.clone(), start, end));
    if reference != outgoing.reference {
        return true;
    }
    let base = outgoing.distance_meters.max(1.0);
    (section.distance_meters - outgoing.distance_meters).abs() / base >= ADOPTED_EXTENT_FRACTION
}

/// Version the line a detect adopted outright and append the `recut` row that
/// links it. A section whose outgoing extent has no version yet gets one first,
/// so the ledger holds both sides of the change.
fn record_adoption(
    conn: &rusqlite::Connection,
    section: &FrequentSection,
    outgoing: &OutgoingShape,
) -> SqlResult<()> {
    if !adoption_moved_extent(section, outgoing) {
        return Ok(());
    }
    let held: i64 = conn.query_row(
        "SELECT COUNT(*) FROM section_geometry WHERE section_id = ?",
        params![section.id],
        |row| row.get(0),
    )?;
    if held == 0 && outgoing.line.len() >= 2 {
        history::record_geometry_on(
            conn,
            &section.id,
            &outgoing.line,
            false,
            outgoing
                .reference
                .as_ref()
                .map(|(id, start, end)| (id.as_str(), *start, *end)),
        )?;
    }
    let reference = (!section.representative_activity_id.is_empty())
        .then_some(section.representative_range)
        .flatten()
        .map(|(start, end)| (section.representative_activity_id.as_str(), start, end));
    let version =
        history::record_geometry_on(conn, &section.id, &section.polyline, false, reference)?;
    let details = serde_json::json!({
        "reason": "adopted",
        "from_distance_m": outgoing.distance_meters,
        "to_distance_m": section.distance_meters,
        "from_reference": outgoing.reference.as_ref().map(|r| r.0.as_str()),
        "to_reference": reference.map(|r| r.0),
    })
    .to_string();
    history::append_history_on(
        conn,
        &section.id,
        "recut",
        Some(&details),
        Some(version),
        None,
    )?;
    Ok(())
}

/// Whether a section kept the line it had before its first edit, as SQL over
/// the bare `sections` columns. An edit writes the quantised blob; a row an
/// older build edited still holds the JSON column instead, and counts the same.
macro_rules! has_original_line {
    () => {
        "(original_polyline_blob IS NOT NULL OR original_polyline_json IS NOT NULL)"
    };
}
pub(crate) use has_original_line;

/// The negation of [`has_original_line`]: a section no edit has touched.
macro_rules! no_original_line {
    () => {
        "(original_polyline_blob IS NULL AND original_polyline_json IS NULL)"
    };
}

/// The rows a detection run owns. Custom, trimmed, accepted and disabled
/// sections fall outside it, so every wipe that reuses it keeps them.
pub(crate) const DERIVED_SECTION_PREDICATE: &str = concat!(
    "section_type = 'auto' AND ",
    no_original_line!(),
    " AND is_user_defined = 0 AND disabled = 0"
);

fn capture_auto_exclusions(tx: &rusqlite::Connection) -> SqlResult<CarriedExclusions> {
    // The common save carries no exclusions at all; one early-exit probe
    // spares the correlated scan below on every detection apply.
    let any: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM section_activities WHERE excluded = 1)",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !any {
        return Ok(CarriedExclusions::new());
    }
    let mut stmt = tx.prepare(concat!(
        "SELECT sa.section_id, sa.activity_id, sa.excluded, sa.start_index
         FROM section_activities sa
         JOIN sections s ON s.id = sa.section_id
         WHERE s.section_type = 'auto' AND ",
        no_original_line!(),
        "
           AND s.is_user_defined = 0 AND s.disabled = 0
           AND EXISTS (SELECT 1 FROM section_activities e
                       WHERE e.section_id = sa.section_id
                         AND e.activity_id = sa.activity_id AND e.excluded = 1)
         ORDER BY sa.section_id, sa.activity_id, sa.start_index",
    ))?;
    let rows: Vec<(String, String, bool, u32)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get(3)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();
    let mut carried = CarriedExclusions::new();
    let mut i = 0;
    while i < rows.len() {
        let (sid, aid) = (rows[i].0.clone(), rows[i].1.clone());
        let mut laps = LapCarry {
            excluded: Vec::new(),
            included: Vec::new(),
        };
        while i < rows.len() && rows[i].0 == sid && rows[i].1 == aid {
            if rows[i].2 {
                laps.excluded.push(rows[i].3);
            } else {
                laps.included.push(rows[i].3);
            }
            i += 1;
        }
        if laps.included.is_empty() {
            carried.push((sid, aid, None));
        } else {
            carried.push((sid, aid, Some(laps)));
        }
    }
    Ok(carried)
}

/// `identity_state.key` for the auto-section exclusions a catalogue wipe
/// took, held until a detection apply finds their activities in the library.
const WIPED_EXCLUSIONS_KEY: &str = "wiped_section_exclusions";

/// Hold the exclusions on the auto sections a catalogue wipe is about to
/// delete, so the re-detect that follows can put them back on the ids the
/// identity registry re-mints.
///
/// The apply carries them across its own delete in memory, but a wipe is not
/// followed by an apply in the same transaction. With route matching off none
/// may run for weeks, and the app can close in between, so the hold is a row
/// in the same record table as the registry that re-mints the ids. Merged
/// with whatever an earlier wipe still holds: a second clear before a detect
/// finds no rows to capture and must not drop the first one's.
pub(crate) fn hold_auto_exclusions_through_wipe(db: &rusqlite::Connection) -> SqlResult<()> {
    let captured = capture_auto_exclusions(db)?;
    if captured.is_empty() {
        return Ok(());
    }
    let mut held = held_auto_exclusions(db);
    held.retain(|(sid, aid, _)| !captured.iter().any(|(s, a, _)| s == sid && a == aid));
    held.extend(captured);
    write_held_auto_exclusions(db, &held)
}

fn write_held_auto_exclusions(
    db: &rusqlite::Connection,
    held: &CarriedExclusions,
) -> SqlResult<()> {
    let blob = serde_json::to_vec(held)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    db.execute(
        "INSERT INTO identity_state (key, blob, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at",
        params![WIPED_EXCLUSIONS_KEY, blob],
    )?;
    Ok(())
}

/// What a wipe holds. An unreadable hold reads as empty rather than failing
/// the detect it would be handed to.
fn held_auto_exclusions(db: &rusqlite::Connection) -> CarriedExclusions {
    let blob: Option<Vec<u8>> = db
        .query_row(
            "SELECT blob FROM identity_state WHERE key = ?",
            params![WIPED_EXCLUSIONS_KEY],
            |row| row.get(0),
        )
        .ok();
    let Some(blob) = blob else {
        return CarriedExclusions::new();
    };
    serde_json::from_slice(&blob).unwrap_or_else(|e| {
        log::warn!("veloqrs: [sections] held exclusions unreadable, dropped: {e}");
        CarriedExclusions::new()
    })
}

/// Release what this apply could place and keep holding the rest, in the
/// apply's own transaction. An entry is spent once its activity is back in
/// the library: the apply either put it back or found its section gone, the
/// rule it already keeps for a section that dies across its own delete. One
/// whose activity is still missing waits, because Clear cache re-detects over
/// the few activities it kept before the sync brings the rest back.
fn release_placed_auto_exclusions(
    tx: &rusqlite::Connection,
    held: CarriedExclusions,
) -> SqlResult<()> {
    if held.is_empty() {
        return Ok(());
    }
    let mut present = tx.prepare("SELECT EXISTS(SELECT 1 FROM activities WHERE id = ?)")?;
    let mut waiting = CarriedExclusions::new();
    for entry in held {
        let back: bool = present.query_row(params![entry.1], |row| row.get(0))?;
        if !back {
            waiting.push(entry);
        }
    }
    if waiting.is_empty() {
        tx.execute(
            "DELETE FROM identity_state WHERE key = ?",
            params![WIPED_EXCLUSIONS_KEY],
        )?;
        return Ok(());
    }
    write_held_auto_exclusions(tx, &waiting)
}

/// `identity_state.key` for the supersessions a catalogue wipe took: the auto
/// section id and the custom section that replaced it.
const WIPED_SUPERSESSIONS_KEY: &str = "wiped_section_supersessions";

/// Hold which auto sections a custom section replaced, across a wipe that
/// deletes them, for the same reason and in the same place as the exclusions
/// above. Detection never supersedes on its own, only drawing a section does,
/// so without the hold a clear brings back ground the athlete replaced.
pub(crate) fn hold_supersessions_through_wipe(db: &rusqlite::Connection) -> SqlResult<()> {
    let captured: Vec<(String, String)> = db
        .prepare(&format!(
            "SELECT id, superseded_by FROM sections WHERE {DERIVED_SECTION_PREDICATE}
             AND superseded_by IS NOT NULL"
        ))?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<SqlResult<_>>()?;
    if captured.is_empty() {
        return Ok(());
    }
    let mut held = held_supersessions(db);
    held.retain(|(id, _)| !captured.iter().any(|(c, _)| c == id));
    held.extend(captured);
    write_held_supersessions(db, &held)
}

fn write_held_supersessions(db: &rusqlite::Connection, held: &[(String, String)]) -> SqlResult<()> {
    if held.is_empty() {
        db.execute(
            "DELETE FROM identity_state WHERE key = ?",
            params![WIPED_SUPERSESSIONS_KEY],
        )?;
        return Ok(());
    }
    let blob = serde_json::to_vec(held)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    db.execute(
        "INSERT INTO identity_state (key, blob, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at",
        params![WIPED_SUPERSESSIONS_KEY, blob],
    )?;
    Ok(())
}

/// What a wipe holds. An unreadable hold reads as empty, as the exclusions do.
fn held_supersessions(db: &rusqlite::Connection) -> Vec<(String, String)> {
    let blob: Option<Vec<u8>> = db
        .query_row(
            "SELECT blob FROM identity_state WHERE key = ?",
            params![WIPED_SUPERSESSIONS_KEY],
            |row| row.get(0),
        )
        .ok();
    let Some(blob) = blob else {
        return Vec::new();
    };
    serde_json::from_slice(&blob).unwrap_or_else(|e| {
        log::warn!("veloqrs: [sections] held supersessions unreadable, dropped: {e}");
        Vec::new()
    })
}

/// Put held supersessions back on the ids this apply re-minted, in its own
/// transaction. An entry is spent once it is placed, or once the custom
/// section it names is gone, since nothing then replaces the ground. One whose
/// ground has not come back yet waits for a later apply.
fn place_held_supersessions(
    tx: &rusqlite::Connection,
    held: Vec<(String, String)>,
) -> SqlResult<()> {
    if held.is_empty() {
        return Ok(());
    }
    let mut exists = tx.prepare("SELECT EXISTS(SELECT 1 FROM sections WHERE id = ?)")?;
    let mut waiting = Vec::new();
    for (id, target) in held {
        if !exists.query_row(params![target], |row| row.get::<_, bool>(0))? {
            continue;
        }
        if exists.query_row(params![id], |row| row.get::<_, bool>(0))? {
            tx.execute(
                "UPDATE sections SET superseded_by = ? WHERE id = ?",
                params![target, id],
            )?;
            continue;
        }
        waiting.push((id, target));
    }
    write_held_supersessions(tx, &waiting)
}

/// Put carried exclusions back after the junction re-insert. Same rules
/// as the CRUD-side reapply: full activities flag every new row; per-lap
/// state carries onto the nearest rebuilt row by `start_index`.
fn reapply_auto_exclusions(
    tx: &rusqlite::Transaction,
    carried: &CarriedExclusions,
) -> SqlResult<()> {
    for (sid, aid, fate) in carried {
        match fate {
            None => {
                tx.execute(
                    "UPDATE section_activities SET excluded = 1
                     WHERE section_id = ? AND activity_id = ?",
                    params![sid, aid],
                )?;
            }
            Some(laps) => {
                let rebuilt: Vec<u32> = {
                    let mut stmt = tx.prepare(
                        "SELECT start_index FROM section_activities
                         WHERE section_id = ? AND activity_id = ? ORDER BY start_index",
                    )?;
                    stmt.query_map(params![sid, aid], |row| row.get(0))?
                        .filter_map(|r| r.ok())
                        .collect()
                };
                for start in assign_carried_exclusions(laps, &rebuilt) {
                    tx.execute(
                        "UPDATE section_activities SET excluded = 1
                         WHERE section_id = ? AND activity_id = ? AND start_index = ?",
                        params![sid, aid, start],
                    )?;
                }
            }
        }
    }
    Ok(())
}

/// Ids read per `IN (...)` batch when the catalogue pre-fetches streams.
///
/// The same bound the detection pool uses, for the same reason: one `IN` over
/// the whole library holds every decoded series resident at once, which on a
/// long-ride library is around 100 MB on top of the pool that is already there.
const STREAM_READ_CHUNK: usize = 150;

/// `?,?,?` for a batch of `n`.
fn placeholders_for(n: usize) -> String {
    std::iter::repeat_n("?", n).collect::<Vec<_>>().join(",")
}

impl PersistentEngine {
    /// Load sections from database.
    pub(super) fn load_sections(&mut self) -> SqlResult<()> {
        self.sections.clear();

        // First check how many rows are in the table
        let count: i64 = self
            .db
            .query_row("SELECT COUNT(*) FROM sections", [], |row| row.get(0))
            .unwrap_or(0);
        log::info!(
            "veloqrs: [PersistentEngine] Loading sections: {} rows in DB",
            count
        );

        // Load full activity portions from junction table (includes direction, indices, distance)
        // After cross-sport merge, sections can have activities from multiple sport types.
        // One row per pass: `portions.len()` IS the visit count, matching the
        // trigger-maintained column. Gating the count on lap_time made the
        // number DROP when one pass gained a time stream.
        let section_portions: HashMap<String, Vec<SectionPortion>> = {
            let mut stmt = self.db.prepare(
                "SELECT sa.section_id, sa.activity_id, sa.direction, sa.start_index, sa.end_index, sa.distance_meters
                 FROM section_activities sa
                 WHERE sa.excluded = 0
                 ORDER BY sa.section_id, sa.start_index"
            )?;
            let mut map: HashMap<String, Vec<SectionPortion>> = HashMap::new();
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?, // section_id
                    SectionPortion {
                        activity_id: row.get(1)?,
                        direction: {
                            let s: String = row.get(2)?;
                            s.parse().map_err(|_| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    2,
                                    Type::Text,
                                    Box::new(std::fmt::Error),
                                )
                            })?
                        },
                        start_index: row.get(3)?,
                        end_index: row.get(4)?,
                        distance_meters: row.get(5)?,
                    },
                ))
            })?;
            for row in rows {
                let row = match row {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!(
                            "veloqrs: [PersistentEngine] Skipping malformed section_activities row during loading: {:?}",
                            e
                        );
                        continue;
                    }
                };
                map.entry(row.0).or_default().push(row.1);
            }
            map
        };

        // Scope the statement to release its borrow on the connection
        {
            let mut stmt = self.db.prepare(
                "SELECT id, section_type, name, sport_type, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        created_at, updated_at,
                        polyline_blob, point_density_blob,
                        elevation_gain_m, avg_grade_percent,
                        rep_start_index, rep_end_index,
                        elevation_loss_m, max_grade_percent, straightness, klass, is_lift, rank_score, sport_rank_score
                 FROM sections
                 WHERE (section_type = 'auto' OR section_type = 'custom') AND disabled = 0
                 ORDER BY id",
            )?;

            self.sections = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let polyline_json: Option<String> = row.get(4)?;
                    let point_density_json: Option<String> = row.get(10)?;
                    let representative_activity_id: Option<String> = row.get(6)?;
                    let polyline_blob: Option<Vec<u8>> = row.get(17)?;
                    let point_density_blob: Option<Vec<u8>> = row.get(18)?;
                    // `consensus_state_blob` is neither selected nor decoded.
                    // The detector only ever produces `None` for this field and
                    // nothing reads it back, so loading it was a MessagePack
                    // decode per section on every launch for a value that is
                    // discarded. The column stays, holding whatever legacy rows
                    // put there.
                    let consensus_state = None;

                    // Both columns or neither: a half-range indexes nothing.
                    let rep_start: Option<u32> = row.get(21)?;
                    let rep_end: Option<u32> = row.get(22)?;
                    let polyline: Vec<GpsPoint> = geometry::line(
                        &self.db,
                        polyline_blob.as_deref(),
                        polyline_json.as_deref(),
                        geometry::reference(
                            representative_activity_id.as_deref(),
                            rep_start,
                            rep_end,
                        ),
                    )
                    .unwrap_or_else(|e| {
                        log::error!(
                            "load_sections: polyline decode failed for section {} ({}); section will load with an empty polyline",
                            id, e
                        );
                        Vec::new()
                    });
                    let point_density = decode_point_density(
                        point_density_blob.as_deref(),
                        point_density_json.as_deref(),
                        &id,
                        10,
                        18,
                    )?
                    .unwrap_or_default();

                    let portions = section_portions.get(&id)
                        .cloned()
                        .unwrap_or_default();
                    // Derive activity_ids from portions, unique and in id order
                    let activity_ids: Vec<String> = portions.iter()
                        .map(|p| p.activity_id.clone())
                        .collect::<std::collections::BTreeSet<_>>()
                        .into_iter()
                        .collect();
                    let visit_count = portions.len() as u32;

                    let representative_range = rep_start.zip(rep_end);

                    Ok(FrequentSection {
                        id,
                        name: row.get(2)?,
                        sport_type: row.get(3)?,
                        polyline,
                        representative_activity_id: representative_activity_id.unwrap_or_default(),
                        representative_range,
                        activity_ids,
                        activity_portions: portions,
                        visit_count,
                        distance_meters: row.get(5)?,
                        activity_traces: std::collections::HashMap::new(),
                        confidence: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                        observation_count: row.get::<_, Option<u32>>(8)?.unwrap_or(0),
                        average_spread: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                        point_density,
                        scale: {
                            let s: Option<String> = row.get(11)?;
                            match s {
                                None => None,
                                Some(s) => Some(s.parse().map_err(|_| {
                                    rusqlite::Error::FromSqlConversionFailure(11, Type::Text, Box::new(std::fmt::Error))
                                })?),
                            }
                        },
                        is_user_defined: row.get::<_, Option<i32>>(13)?.unwrap_or(0) != 0,
                        stability: row.get::<_, Option<f64>>(14)?.unwrap_or(0.0),
                        elevation_gain_m: row.get(19)?,
                        avg_grade_percent: row.get(20)?,
                        version: row.get::<_, Option<u32>>(12)?.unwrap_or(1),
                        updated_at: row.get(16)?,
                        created_at: row.get(15)?,
                        enrichment: interest::enrichment_from_row(row, 19, 23)?,
                        rank: interest::rank_from_row(row, 28)?,
                        consensus_state,
                    })
                })?
                .filter_map(|r| match r {
                    Ok(v) => Some(v),
                    Err(e) => {
                        log::warn!("veloqrs: [PersistentEngine] Skipping malformed section row during loading: {:?}", e);
                        None
                    }
                })
                .filter(|s: &FrequentSection| !s.id.is_empty())
                .collect();
        }

        log::info!(
            "veloqrs: [PersistentEngine] Loaded {} sections into memory (from {} in DB)",
            self.sections.len(),
            count
        );

        // Log section IDs for debugging
        if !self.sections.is_empty() {
            let section_ids: Vec<&str> = self
                .sections
                .iter()
                .take(10)
                .map(|s| s.id.as_str())
                .collect();
            log::info!(
                "veloqrs: [PersistentEngine] First {} section IDs: {:?}",
                section_ids.len(),
                section_ids
            );
        }

        // Backfill any NULL lap_time/lap_pace from available time streams
        // Handles migration edge cases and activities synced after section detection
        let _ = self.backfill_section_performance_cache();
        let _ = self.backfill_section_coverage();

        self.refresh_superseded_ids();

        self.sections_dirty = false;
        Ok(())
    }

    /// Load processed activity IDs from database (for incremental section detection).
    pub(super) fn load_processed_activity_ids(&mut self) -> SqlResult<()> {
        self.processed_activity_ids.clear();
        let mut stmt = self
            .db
            .prepare("SELECT activity_id FROM processed_activities")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for row in rows.flatten() {
            self.processed_activity_ids.insert(row);
        }
        log::info!(
            "veloqrs: [PersistentEngine] Loaded {} processed activity IDs",
            self.processed_activity_ids.len()
        );
        Ok(())
    }

    /// Save processed activity IDs to database after section detection.
    /// Re-cut a single section's line from one member's own track. Cheap,
    /// user-initiated alternative to a corpus-wide detection rerun. Returns
    /// the new line's length, or None if the section doesn't exist / is
    /// user-defined / no member's track covers it.
    pub fn recalculate_section_polyline(
        &mut self,
        section_id: &str,
    ) -> Option<crate::FfiSectionRecalcResult> {
        let idx = self.sections.iter().position(|s| s.id == section_id)?;
        let mut section = self.sections[idx].clone();
        if section.is_user_defined || section.activity_ids.is_empty() {
            return None;
        }

        // A line sliced from one activity recalculates by re-slicing that
        // range: the same input gives the same line, so a second call is a
        // no-op.
        if let Some((start, end)) = section.representative_range
            && let Some(track) = self.load_gps_track_from_db(&section.representative_activity_id)
            && (start as usize) < (end as usize)
            && (end as usize) <= track.len()
        {
            let polyline = track[start as usize..end as usize].to_vec();
            let distance = tracematch::matching::calculate_route_distance(&polyline);
            let result = crate::FfiSectionRecalcResult {
                section_id: section.id.clone(),
                distance_meters: distance,
            };
            let unchanged = section.polyline == polyline;
            section.polyline = polyline;
            section.distance_meters = distance;
            self.sections[idx] = section;
            if !unchanged && let Err(err) = self.save_sections() {
                log::warn!(
                    "veloqrs: [recalculate_section_polyline] save_sections failed: {}",
                    err
                );
            }
            return Some(result);
        }

        // No triple: the line is an average no activity rode. Cut it from one
        // member's own track instead, located by geometry. A row no member
        // covers keeps the line it has.
        let (activity_id, range, polyline) = self.slice_of_member_track(&section)?;
        let distance = tracematch::matching::calculate_route_distance(&polyline);
        section.representative_activity_id = activity_id;
        section.representative_range = Some(range);
        section.polyline = polyline;
        section.distance_meters = distance;
        let result = crate::FfiSectionRecalcResult {
            section_id: section.id.clone(),
            distance_meters: distance,
        };
        self.sections[idx] = section;
        if let Err(err) = self.save_sections() {
            log::warn!(
                "veloqrs: [recalculate_section_polyline] save_sections failed: {}",
                err
            );
        }
        Some(result)
    }

    /// The section's line as a slice of one member's stored track, found by
    /// matching the current line against each member (the representative
    /// first). `None` when no member's track covers it.
    pub(super) fn slice_of_member_track(
        &self,
        section: &FrequentSection,
    ) -> Option<(String, (u32, u32), Vec<GpsPoint>)> {
        if section.polyline.len() < 2 {
            return None;
        }
        let representative = section.representative_activity_id.as_str();
        let candidates = std::iter::once(representative)
            .filter(|id| !id.is_empty())
            .chain(
                section
                    .activity_ids
                    .iter()
                    .map(String::as_str)
                    .filter(|id| *id != representative),
            );
        for activity_id in candidates {
            let Some(track) = self.load_gps_track_from_db(activity_id) else {
                continue;
            };
            let portions = compute_section_portions(
                activity_id,
                &track,
                &section.polyline,
                &self.section_config,
            );
            for portion in portions {
                let (lo, hi) = (portion.start_index as usize, portion.end_index as usize);
                if lo + 1 < hi && hi <= track.len() {
                    return Some((
                        activity_id.to_string(),
                        (portion.start_index, portion.end_index),
                        track[lo..hi].to_vec(),
                    ));
                }
            }
        }
        None
    }

    /// How many stored activities have never been through a detect.
    ///
    /// The jobs screen lists every job always, with a resting state, and a
    /// resting row is only honest if it says what is waiting. Detection's phase
    /// cannot say: it is a process-global value starting at idle, so after a
    /// relaunch it reads idle whatever is outstanding.
    ///
    /// `processed_activities` is the durable half and is read back by
    /// `load_processed_activity_ids`, so this counts against the table rather
    /// than the in-memory set: the two agree once loaded, and only the table
    /// survives the launch the row has to be honest across.
    pub fn activities_awaiting_detection(&self) -> SqlResult<u64> {
        pooled::activities_awaiting_detection(&self.db)
    }

    pub fn save_processed_activity_ids(&mut self, activity_ids: &[String]) -> SqlResult<()> {
        let tx = self.db.unchecked_transaction()?;
        let mut stmt =
            tx.prepare("INSERT OR IGNORE INTO processed_activities (activity_id) VALUES (?)")?;
        for id in activity_ids {
            stmt.execute(params![id])?;
        }
        drop(stmt);
        tx.commit()?;
        // Update in-memory set
        for id in activity_ids {
            self.processed_activity_ids.insert(id.clone());
        }
        Ok(())
    }

    /// Clear all processed activity IDs to force full re-detection.
    pub(crate) fn clear_processed_activity_ids(&mut self) {
        // The evidence cache goes first and unconditionally. Its caller has
        // already persisted the config that provoked the clear, so a cache
        // folded under the old one is wrong from here on however the DELETE
        // goes; dropping it only costs a cold rebatch.
        self.invalidate_evidence_cache();
        // Only clear the in-memory set when the DB delete succeeds; otherwise
        // the rows reload on next start and memory would disagree with disk.
        match self.db.execute("DELETE FROM processed_activities", []) {
            Ok(_) => {
                self.processed_activity_ids.clear();
                self.pending_processed_clear = false;
                log::info!(
                    "veloqrs: [PersistentEngine] Cleared all processed activity IDs for forced re-detection"
                );
            }
            Err(e) => {
                // Leaving the set intact would short-circuit the next detect on
                // every activity it holds, under a config that no longer matches
                // them. Flag it so the next detect retries before it reads.
                self.pending_processed_clear = true;
                log::warn!("veloqrs: failed to clear processed activity IDs: {e:?}");
            }
        }
    }

    /// Whether a processed-set clear is still owed. Exposed so a test can see
    /// the flag without reaching into the engine's private state.
    #[doc(hidden)]
    pub fn processed_clear_pending(&self) -> bool {
        self.pending_processed_clear
    }

    /// Re-run a clear whose DELETE failed. Called at the head of every detect,
    /// which is the first moment the stale processed set would be read.
    pub(crate) fn retry_pending_processed_clear(&mut self) {
        if !self.pending_processed_clear {
            return;
        }
        log::info!("veloqrs: retrying the processed-activity clear owed from a failed DELETE");
        self.clear_processed_activity_ids();
    }

    /// Evict specific activity IDs from the processed set (DB + in memory) so a
    /// GPS mutation forces the next detect to re-analyse just those activities,
    /// leaving the rest processed. A no-op for IDs not currently processed (e.g.
    /// brand-new adds). Mirrors `clear_processed_activity_ids`: the in-memory set
    /// is only mutated when the DB delete commits, so memory can't disagree with
    /// disk after a failed write.
    pub(crate) fn evict_processed_activity_ids(&mut self, activity_ids: &[String]) {
        if activity_ids.is_empty() {
            return;
        }
        let tx = match self.db.unchecked_transaction() {
            Ok(tx) => tx,
            Err(e) => {
                log::warn!("veloqrs: processed-id eviction begin failed: {e:?}");
                return;
            }
        };
        let mut ok = true;
        match tx.prepare("DELETE FROM processed_activities WHERE activity_id = ?") {
            Ok(mut stmt) => {
                for id in activity_ids {
                    if stmt.execute(params![id]).is_err() {
                        ok = false;
                        break;
                    }
                }
            }
            Err(_) => ok = false,
        }
        if ok && tx.commit().is_ok() {
            for id in activity_ids {
                self.processed_activity_ids.remove(id);
            }
            // A mutated activity's cluster in the evidence cache is now stale and
            // the cache cannot drop one member surgically, so clear the whole
            // cache; the next detect cold-rebatches the correct pool.
            self.invalidate_evidence_cache();
        } else {
            log::warn!("veloqrs: processed-id eviction failed; in-memory set left intact");
        }
    }

    // Section name migration and management methods live in `naming.rs`.

    // ========================================================================
    // Sections (Background Detection)
    // ========================================================================

    /// Get sections (must call detect_sections first or load from DB). The whole
    /// catalogue, superseded entries included: they are still detection priors,
    /// so dropping them here would re-mint their ground under a new id. Reads
    /// that answer a user use [`get_visible_sections`](Self::get_visible_sections).
    pub fn get_sections(&self) -> &[FrequentSection] {
        &self.sections
    }

    /// Re-read which sections a custom section has replaced. Queries `self.db`,
    /// so it needs the engine; every path that writes `superseded_by` calls it
    /// so the memory-only views stay pure memory.
    pub(crate) fn refresh_superseded_ids(&mut self) {
        let Ok(mut stmt) = self
            .db
            .prepare("SELECT id FROM sections WHERE superseded_by IS NOT NULL")
        else {
            return;
        };
        self.superseded_ids = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
    }

    /// The catalogue as a user should see it: superseded sections hidden, matching
    /// the DB visible view. Disabled sections are already absent (the loader
    /// filters them). Pure memory, so it never touches `self.db`.
    pub fn get_visible_sections(&self) -> Vec<&FrequentSection> {
        self.sections
            .iter()
            .filter(|s| !self.superseded_ids.contains(&s.id))
            .collect()
    }

    /// The outing floor a section list applies: enough distinct outings, or
    /// a pin, which freezes the section's existence whatever its support.
    pub(crate) fn meets_section_floor(outings: u32, pinned: bool, min: u32) -> bool {
        outings >= min || pinned
    }

    /// The activity's sport, falling back to the `activities` row when the
    /// in-memory maps have not been loaded.
    pub(crate) fn sport_of_activity(&self, activity_id: &str) -> Option<String> {
        if let Some(sport) = self.sport_of(activity_id) {
            return Some(sport.to_string());
        }
        self.db
            .query_row(
                "SELECT sport_type FROM activities WHERE id = ?",
                rusqlite::params![activity_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
    }

    /// `activity_metadata` is the authority: it is written on ingest, while
    /// `activity_metrics` fills only once metrics load.
    pub(crate) fn sport_of(&self, activity_id: &str) -> Option<&str> {
        self.activity_metadata
            .get(activity_id)
            .map(|m| m.sport_type.as_str())
            .or_else(|| {
                self.activity_metrics
                    .get(activity_id)
                    .map(|m| m.sport_type.as_str())
            })
    }

    /// The stored catalogue narrowed by sport and distinct outings, through
    /// the one filter the sections export reads. A pin exempts only the
    /// outing floor, never the sport filter.
    pub fn get_sections_filtered(
        &self,
        sport_type: Option<&str>,
        min_visits: Option<u32>,
    ) -> Vec<FrequentSection> {
        pooled::catalogue_sections(&self.db, sport_type, min_visits)
    }

    pub fn mark_section_accepted_in_memory(&mut self, section_id: &str) {
        if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
            section.is_user_defined = true;
        }
    }

    /// Refresh a section in memory from the database. Auto and custom
    /// sections are both cached in `self.sections`, so this applies to any
    /// row. Call it after modifying a section's polyline or activity list.
    pub fn refresh_section_in_memory(&mut self, section_id: &str) {
        type SectionRow = (
            String,
            String,
            Option<String>,
            Option<String>,
            f64,
            Option<String>,
            Option<f64>,
            Option<u32>,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<u32>,
            Option<i32>,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<Vec<u8>>,
            Option<Vec<u8>>,
            Option<f64>,
            Option<f64>,
            Option<u32>,
            Option<u32>,
        );
        let section_data: Option<SectionRow> = {
            // Cached: the attach loop refreshes one section per match and the
            // parse of these twenty-two columns is the cost, not the row.
            let mut stmt = match self.db.prepare_cached(
                "SELECT section_type, sport_type, name, polyline_json, distance_meters,
                        representative_activity_id, confidence, observation_count, average_spread,
                        point_density_json, scale, version, is_user_defined, stability,
                        created_at, updated_at, polyline_blob, point_density_blob,
                        elevation_gain_m, avg_grade_percent,
                        rep_start_index, rep_end_index
                 FROM sections WHERE id = ?",
            ) {
                Ok(s) => s,
                Err(_) => return,
            };

            stmt.query_row(params![section_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,           // section_type
                    row.get::<_, String>(1)?,           // sport_type
                    row.get::<_, Option<String>>(2)?,   // name
                    row.get::<_, Option<String>>(3)?,   // polyline_json
                    row.get::<_, f64>(4)?,              // distance_meters
                    row.get::<_, Option<String>>(5)?,   // representative_activity_id
                    row.get::<_, Option<f64>>(6)?,      // confidence
                    row.get::<_, Option<u32>>(7)?,      // observation_count
                    row.get::<_, Option<f64>>(8)?,      // average_spread
                    row.get::<_, Option<String>>(9)?,   // point_density_json
                    row.get::<_, Option<String>>(10)?,  // scale
                    row.get::<_, Option<u32>>(11)?,     // version
                    row.get::<_, Option<i32>>(12)?,     // is_user_defined
                    row.get::<_, Option<f64>>(13)?,     // stability
                    row.get::<_, Option<String>>(14)?,  // created_at
                    row.get::<_, Option<String>>(15)?,  // updated_at
                    row.get::<_, Option<Vec<u8>>>(16)?, // polyline_blob
                    row.get::<_, Option<Vec<u8>>>(17)?, // point_density_blob
                    row.get::<_, Option<f64>>(18)?,     // elevation_gain_m
                    row.get::<_, Option<f64>>(19)?,     // avg_grade_percent
                    row.get::<_, Option<u32>>(20)?,     // rep_start_index
                    row.get::<_, Option<u32>>(21)?,     // rep_end_index
                ))
            })
            .ok()
        };

        let (
            _section_type,
            sport_type,
            name,
            polyline_json,
            distance_meters,
            representative_activity_id,
            confidence,
            observation_count,
            average_spread,
            point_density_json,
            scale,
            version,
            is_user_defined,
            stability,
            created_at,
            updated_at,
            polyline_blob,
            point_density_blob,
            elevation_gain_m,
            avg_grade_percent,
            rep_start_index,
            rep_end_index,
        ) = match section_data {
            Some(data) => data,
            None => return, // Section not found
        };

        // Both auto and custom sections are cached in memory now: the in-memory
        // matcher (index_new_activity) scans get_sections(), so a custom section
        // must be there for a new activity to join it. save_sections skips
        // user-defined rows, so caching custom here cannot round-trip into an
        // 'auto' re-insert.

        // Get activity IDs from junction table (deduplicated)
        let activity_ids: Vec<String> = {
            let mut stmt = match self.db.prepare(
                "SELECT DISTINCT sa.activity_id FROM section_activities sa
                 WHERE sa.section_id = ? AND sa.excluded = 0",
            ) {
                Ok(s) => s,
                Err(_) => return,
            };
            stmt.query_map(params![section_id], |row| row.get(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default()
        };

        // The cached blob first, then the reference triple, so a refresh after a
        // cleared cache reads the same line the load does.
        let polyline: Vec<GpsPoint> = match geometry::line(
            &self.db,
            polyline_blob.as_deref(),
            polyline_json.as_deref(),
            geometry::reference(
                representative_activity_id.as_deref(),
                rep_start_index,
                rep_end_index,
            ),
        ) {
            Ok(p) => p,
            Err(e) => {
                log::error!(
                    "veloqrs: [refresh_section_in_memory] Failed to decode polyline for {}: {}",
                    section_id,
                    e
                );
                return;
            }
        };
        let Ok(point_density) = decode_point_density(
            point_density_blob.as_deref(),
            point_density_json.as_deref(),
            section_id,
            9,
            17,
        ) else {
            return;
        };
        let point_density = point_density.unwrap_or_default();

        // The trigger-maintained column: one row per pass, no lap_time gate.
        let visit_count: u32 = self
            .db
            .query_row(
                "SELECT visit_count FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .unwrap_or(activity_ids.len() as u32);

        let (enrichment, rank) = self.read_enrichment(section_id);
        let updated_section = FrequentSection {
            id: section_id.to_string(),
            name,
            sport_type,
            polyline,
            representative_activity_id: representative_activity_id.unwrap_or_default(),
            // Dropping this here would demote an exact section to consensus on
            // the next save, permanently.
            representative_range: rep_start_index.zip(rep_end_index),
            activity_ids,
            // From the junction table: `save_sections` writes junction rows
            // FROM this field, so a blank here turns the next save into a
            // wipe of the section's traversals.
            activity_portions: self.get_section_portions(section_id),
            visit_count,
            distance_meters,
            activity_traces: std::collections::HashMap::new(), // Not stored in DB
            confidence: confidence.unwrap_or(0.0),
            observation_count: observation_count.unwrap_or(0),
            average_spread: average_spread.unwrap_or(0.0),
            point_density,
            scale: scale.and_then(|s| match s.parse::<tracematch::sections::ScaleName>() {
                Ok(v) => Some(v),
                Err(_) => {
                    log::warn!(
                        "veloqrs: [refresh_section_in_memory] Failed to parse scale '{}' for {}",
                        s,
                        section_id
                    );
                    None
                }
            }),
            is_user_defined: is_user_defined.unwrap_or(0) != 0,
            stability: stability.unwrap_or(0.0),
            elevation_gain_m,
            avg_grade_percent,
            version: version.unwrap_or(1),
            updated_at,
            created_at,
            enrichment,
            rank,
            consensus_state: None,
        };

        // Find and update existing section, or append if new
        if let Some(existing) = self.sections.iter_mut().find(|s| s.id == section_id) {
            *existing = updated_section;
            log::debug!(
                "veloqrs: [refresh_section_in_memory] Updated section {} in memory",
                section_id
            );
        } else {
            self.sections.push(updated_section);
            log::debug!(
                "veloqrs: [refresh_section_in_memory] Added section {} to memory",
                section_id
            );
        }
    }

    /// Remove a section from in-memory cache.
    /// Call this after deleting a section.
    pub fn remove_section_from_memory(&mut self, section_id: &str) {
        self.sections.retain(|s| s.id != section_id);
        self.invalidate_perf_cache();
        log::debug!(
            "veloqrs: [remove_section_from_memory] Removed section {} from memory",
            section_id
        );
    }

    /// Get section count directly from SQLite (no data loading).
    /// This is O(1) and doesn't require loading sections into memory.
    ///
    /// Counts what the section views show, so it carries the same visibility
    /// predicate `get_section_summaries` and `get_sections_by_type` use. A
    /// disabled or superseded section reaches no list, and every caller here
    /// is asking whether the athlete has sections to look at.
    pub fn get_section_count(&self) -> u32 {
        queries::pooled::section_count(&self.db)
    }

    /// Auto sections the athlete retired, disabled or superseded by a custom
    /// one. `VISIBLE_FILTER` is the complement of this, so no list query can
    /// answer it: the rows it counts are exactly the ones every section view
    /// leaves out, which is why the figure beside the "Removed" chip needs its
    /// own count.
    pub fn get_retired_section_count(&self) -> u32 {
        self.db
            .query_row(
                "SELECT COUNT(*) FROM sections
                 WHERE section_type = 'auto' AND (disabled = 1 OR superseded_by IS NOT NULL)",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    /// Get lightweight section summaries without polyline data.
    /// Queries SQLite and extracts only summary fields, skipping heavy data like
    /// polylines, activityTraces, and pointDensity.
    pub fn get_section_summaries(&self) -> Vec<SectionSummary> {
        self.get_section_summaries_by_type(None)
    }

    /// Get section summaries filtered by sport type.
    pub fn get_section_summaries_for_sport(&self, sport_type: &str) -> Vec<SectionSummary> {
        self.get_section_summaries()
            .into_iter()
            .filter(|s| Self::summary_covers_sport(s, sport_type))
            .collect()
    }

    /// Whether a sport traverses a section: one of its included outings was
    /// that sport. Ground has no sport of its own.
    pub fn summary_covers_sport(s: &SectionSummary, sport: &str) -> bool {
        s.sport_types.iter().any(|t| t == sport)
    }

    /// Get a single section by ID with LRU caching.
    /// Returns the full FrequentSection with polyline data.
    /// Uses LRU cache to avoid repeated SQLite queries for hot sections.
    ///
    /// Delegates to crud.rs get_section() which handles both auto and custom sections
    /// reliably, then loads activity portions from the junction table.
    pub fn get_section_by_id(&mut self, section_id: &str) -> Option<FrequentSection> {
        // Cached entries bake the named-corridor overlay of their read; drop
        // them whenever the overlay had to recompute.
        // The LRU stores RAW rows; the corridor-name overlay is applied on
        // the way out of every call, so an overlay change can never leave a
        // baked stale name behind in the cache.
        let cached = self.section_cache.get(&section_id.to_string()).cloned();
        if let Some(mut section) = cached {
            log::debug!(
                "veloqrs: [PersistentEngine] get_section_by_id cache hit for {}",
                section_id
            );
            self.apply_named_overlay_to_frequent(&mut section);
            return Some(section);
        }

        // Use crud.rs get_section_raw() which is proven to work for both auto and custom sections
        let section = match self.get_section_raw(section_id) {
            Some(s) => s,
            None => {
                log::info!(
                    "veloqrs: [PersistentEngine] get_section_by_id: section {} not found in DB",
                    section_id
                );
                return None;
            }
        };

        // Load full activity portions from junction table
        let portions = self.get_section_portions(section_id);

        let frequent = pooled::to_frequent(section, portions);

        // Cache the raw row for future access; overlay applies per read.
        self.section_cache
            .put(section_id.to_string(), frequent.clone());
        log::info!(
            "veloqrs: [PersistentEngine] get_section_by_id found and cached section {} (type={:?})",
            section_id,
            frequent.is_user_defined
        );

        let mut out = frequent;
        self.apply_named_overlay_to_frequent(&mut out);
        Some(out)
    }

    /// Load activity portions for a section from the junction table.
    pub(crate) fn get_section_portions(&self, section_id: &str) -> Vec<SectionPortion> {
        pooled::section_portions(&self.db, section_id)
    }

    /// Invalidate a section in the LRU cache.
    /// Call this after modifying a section to ensure fresh data on next fetch.
    pub fn invalidate_section_cache(&mut self, section_id: &str) {
        self.section_cache.pop(&section_id.to_string());
    }

    pub fn invalidate_all_section_caches(&mut self) {
        self.section_cache.clear();
    }

    pub fn mark_all_auto_sections_accepted(&mut self) {
        for section in &mut self.sections {
            section.is_user_defined = true;
        }
    }

    /// Get section polyline only (flat coordinates for map rendering).
    /// Returns [lat1, lng1, lat2, lng2, ...] or empty vec if not found.
    pub fn get_section_polyline(&self, section_id: &str) -> Vec<f64> {
        pooled::section_polyline(&self.db, section_id)
    }

    /// Sections as the regional map draws them: the summary fields it labels and
    /// colours with, and the line, in one pass.
    ///
    /// The map's own read used to be `get_sections_filtered`, which carries the
    /// activity ids, one portion record per traversal and the point density for
    /// every section, all of it discarded after six fields were read. The
    /// polylines come from the batch query rather than one call per section.
    ///
    /// One difference from that read, and it is deliberate: this answers from
    /// the `sections` table rather than the in-memory catalogue. The table is
    /// the record and the catalogue is a cache of it, and `VISIBLE_FILTER`
    /// excludes the disabled and superseded rows the other read excluded by
    /// holding a set of ids.
    pub fn get_map_sections(
        &self,
        sport_type: Option<&str>,
        min_visits: Option<u32>,
    ) -> Vec<crate::FfiMapSection> {
        self.ensure_named_overlay();
        pooled::map_sections(
            &self.db,
            sport_type,
            min_visits,
            &self.named_overlay_cached_names(),
        )
    }

    /// Insert a single section_activities row for a manually matched activity.
    pub fn insert_section_activity(
        &self,
        section_id: &str,
        activity_id: &str,
        direction: &tracematch::Direction,
        start_index: u32,
        end_index: u32,
        distance_meters: f64,
    ) -> Result<(), String> {
        let heartrate = self.load_heartrate_series(activity_id);
        let power = self.load_power_series(activity_id);
        self.insert_section_activity_with_sensors(
            section_id,
            activity_id,
            direction,
            start_index,
            end_index,
            distance_meters,
            heartrate.as_deref(),
            power.as_deref(),
        )
    }

    /// The same insert for a caller that already holds the activity's sensor series.
    ///
    /// The caller loads each activity series once for all of its portions.
    // The traversal coordinates and both sensor slices belong to one insert.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn insert_section_activity_with_sensors(
        &self,
        section_id: &str,
        activity_id: &str,
        direction: &tracematch::Direction,
        start_index: u32,
        end_index: u32,
        distance_meters: f64,
        heartrate: Option<&[Option<f64>]>,
        power: Option<&[Option<f64>]>,
    ) -> Result<(), String> {
        let dir_str = direction.to_string();

        // Compute lap_time from time_stream when available (in-memory or DB)
        let (lap_time, lap_pace) =
            self.load_lap_time(activity_id, start_index, end_index, distance_meters);
        // Each sensor mean uses the traversal's own samples.
        let avg_hr = mean_over_traversal(heartrate, start_index, end_index);
        let avg_power = mean_over_traversal(power, start_index, end_index);

        // Cached: an activity with twelve portions runs this insert twelve
        // times, and an attach runs it once per portion of every match.
        self.db
            .prepare_cached(
                "INSERT OR IGNORE INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace, avg_hr, avg_power)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .and_then(|mut stmt| stmt.execute(rusqlite::params![section_id, activity_id, dir_str, start_index, end_index, distance_meters, lap_time, lap_pace, avg_hr, avg_power]))
            .map_err(|e| format!("Failed to insert section_activity: {}", e))?;
        Ok(())
    }

    /// The activity's stored heart rate series, if it has one.
    ///
    /// `activity_streams` is where the sync puts every series but the ones the
    /// track already carries, so this is one row and one decode.
    pub(super) fn load_heartrate_series(&self, activity_id: &str) -> Option<Vec<Option<f64>>> {
        let blob: Vec<u8> = self
            .db
            .prepare_cached(
                "SELECT data FROM activity_streams WHERE activity_id = ? AND kind = 'heartrate'",
            )
            .ok()?
            .query_row(rusqlite::params![activity_id], |row| row.get(0))
            .ok()?;
        codec::decode_series(&blob)
    }

    pub(super) fn load_power_series(&self, activity_id: &str) -> Option<Vec<Option<f64>>> {
        let blob: Vec<u8> = self
            .db
            .prepare_cached(
                "SELECT data FROM activity_streams WHERE activity_id = ? AND kind = 'watts'",
            )
            .ok()?
            .query_row(rusqlite::params![activity_id], |row| row.get(0))
            .ok()?;
        codec::decode_series(&blob)
    }

    /// Load lap_time from time_stream (in-memory or DB fallback).
    fn load_lap_time(
        &self,
        activity_id: &str,
        start_index: u32,
        end_index: u32,
        distance_meters: f64,
    ) -> (Option<f64>, Option<f64>) {
        let times = if let Some(ts) = self.time_streams.peek(activity_id) {
            Some(ts.clone())
        } else {
            self.db
                .prepare_cached("SELECT times FROM time_streams WHERE activity_id = ?")
                .and_then(|mut stmt| {
                    stmt.query_row(rusqlite::params![activity_id], |row| {
                        let bytes: Vec<u8> = row.get(0)?;
                        codec::deserialize::<Vec<u32>>(&bytes).map_err(|error| {
                            log::error!(
                                "veloqrs: time_streams.times decode failed for activity_id {activity_id}: {error}"
                            );
                            rusqlite::Error::FromSqlConversionFailure(
                                0,
                                Type::Blob,
                                error.into(),
                            )
                        })
                    })
                })
                .ok()
        };

        compute_lap_time_from_stream(
            times.as_deref(),
            self.track_point_count(activity_id),
            start_index,
            end_index,
            distance_meters,
        )
    }

    pub(super) fn save_sections(&mut self) -> SqlResult<()> {
        self.apply_lift_intents_to_memory()?;
        self.anchor_unranged_sections();
        let skipped = self.write_catalogue(&[], false)?;
        self.drop_unwritten(&skipped);
        self.refresh_superseded_ids();
        Ok(())
    }

    /// [`save_sections`](Self::save_sections) plus the lifecycle events the
    /// identity apply fired this step: geometry versions and history rows land
    /// in the SAME transaction as the catalogue and the registry blob, so a
    /// rolled-back save leaves no orphan narrative behind.
    pub(super) fn save_sections_with_events(
        &mut self,
        events: &[identity::SectionLifecycleEvent],
    ) -> SqlResult<()> {
        self.apply_lift_intents_to_memory()?;
        self.anchor_unranged_sections();
        let skipped = self.write_catalogue(events, true)?;
        self.drop_unwritten(&skipped);
        self.refresh_superseded_ids();
        Ok(())
    }

    /// Give every new derived section that arrives without a reference range
    /// a line cut from one member's own track. A line is never an average, so
    /// a new section no member's track covers is dropped and not written. A
    /// row already stored or pinned keeps the line it has: re-cutting a line
    /// the athlete already holds is not a save's call.
    fn anchor_unranged_sections(&mut self) {
        let pinned: HashSet<String> = self.pinned_section_ids().into_iter().collect();
        let is_stored = |id: &str| {
            self.db
                .query_row("SELECT 1 FROM sections WHERE id = ?", params![id], |_| {
                    Ok(())
                })
                .is_ok()
        };
        let unranged: Vec<usize> = self
            .sections
            .iter()
            .enumerate()
            .filter(|(_, s)| {
                !s.is_user_defined
                    && s.representative_range.is_none()
                    && !pinned.contains(&s.id)
                    && !is_stored(&s.id)
            })
            .map(|(i, _)| i)
            .collect();
        let mut refused = Vec::new();
        for idx in unranged {
            match self.slice_of_member_track(&self.sections[idx]) {
                Some((activity_id, range, polyline)) => {
                    let section = &mut self.sections[idx];
                    section.distance_meters =
                        tracematch::matching::calculate_route_distance(&polyline);
                    section.representative_activity_id = activity_id;
                    section.representative_range = Some(range);
                    section.polyline = polyline;
                }
                None => refused.push(idx),
            }
        }
        for idx in refused.into_iter().rev() {
            let section = self.sections.remove(idx);
            log::warn!(
                "veloqrs: [save_sections] dropping new section {}: no member track covers its line",
                section.id
            );
        }
    }

    /// Memory follows the table: a section the save skipped has no row, so it
    /// leaves `self.sections` too. Its registry row stays, as in a detect, so
    /// the ground can re-emerge under its old id.
    fn drop_unwritten(&mut self, skipped: &HashSet<String>) {
        if !skipped.is_empty() {
            self.sections.retain(|s| !skipped.contains(&s.id));
        }
    }

    /// Put back the rides the athlete attached by hand to a section the apply
    /// has just written. The wipe cascaded their rows and the detector's own
    /// portions never include them, so each is re-cut at the relaxed bar.
    /// A record whose section did not come back, or whose ride the relaxed
    /// cut no longer finds, is left as it stands for a later apply.
    fn recut_forced_rides(&self, tx: &rusqlite::Connection) -> SqlResult<()> {
        let forced: Vec<(String, String)> = {
            let mut stmt = tx.prepare(&format!(
                "SELECT section_id, activity_id FROM section_forced_matches
                 WHERE section_id IN (SELECT id FROM sections WHERE {DERIVED_SECTION_PREDICATE})
                 ORDER BY section_id, activity_id"
            ))?;
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<SqlResult<_>>()?
        };
        for (section_id, activity_id) in forced {
            let Some(section) = self.sections.iter().find(|s| s.id == section_id) else {
                continue;
            };
            let Some(track) = self.get_gps_track(&activity_id) else {
                continue;
            };
            let portions = forced_portions(
                &activity_id,
                &track,
                &section.polyline,
                &self.section_config,
            );
            if portions.is_empty() {
                continue;
            }
            tx.execute(
                "DELETE FROM section_activities WHERE section_id = ? AND activity_id = ?",
                params![section_id, activity_id],
            )?;
            let heartrate = self.load_heartrate_series(&activity_id);
            let power = self.load_power_series(&activity_id);
            for portion in &portions {
                self.insert_section_activity_with_sensors(
                    &section_id,
                    &activity_id,
                    &portion.direction,
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                    heartrate.as_deref(),
                    power.as_deref(),
                )
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
            }
        }
        Ok(())
    }

    /// `from_detect` separates a detection apply from the ordinary saves a
    /// mutation makes. Only a detect re-cuts geometry, so only a detect can
    /// carry the catalogue from one detector generation to the next.
    fn write_catalogue(
        &self,
        events: &[identity::SectionLifecycleEvent],
        from_detect: bool,
    ) -> SqlResult<HashSet<String>> {
        let mut skipped = HashSet::new();
        let tx = self.db.unchecked_transaction()?;

        // The detector that cut what is on disk no longer matches the live
        // one, so every shape it drew is about to be replaced by a different
        // algorithm's answer. Keep each one as a milestone and say so, before
        // the wipe below takes them. The row set is the wipe's own predicate:
        // a custom, accepted or disabled section keeps its line through a
        // detector change and has nothing to explain.
        if from_detect && let Some((from, to)) = self.detector_generation_change() {
            let mut stmt = tx.prepare(&format!(
                "SELECT id, polyline_blob, polyline_json, representative_activity_id,
                        rep_start_index, rep_end_index
                 FROM sections
                 WHERE {DERIVED_SECTION_PREDICATE}"
            ))?;
            type Prior = (
                String,
                Option<Vec<u8>>,
                Option<String>,
                Option<String>,
                Option<u32>,
                Option<u32>,
            );
            let priors: Vec<Prior> = stmt
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })?
                .filter_map(|r| r.ok())
                .collect();
            drop(stmt);
            for (id, blob, json, rep_id, start, end) in priors {
                // The blob is a cache. The outgoing shape is the one thing the
                // milestone exists to keep, so a cleared cache is rebuilt from
                // the triple rather than milestoned as an empty line.
                let reference = geometry::reference(rep_id.as_deref(), start, end);
                let prior = geometry::line(&tx, blob.as_deref(), json.as_deref(), reference)
                    .unwrap_or_default();
                history::record_algorithm_change_on(&tx, &id, Some(&prior), Some(&from), &to)?;
            }
        }

        // What an adoption is about to replace: the line, reference and length
        // each derived section holds now. The identity apply fires no event
        // for a line it adopts outright, so the comparison after the insert is
        // the only place a changed extent can be seen.
        let outgoing: HashMap<String, OutgoingShape> = if from_detect {
            outgoing_shapes(&tx)?
        } else {
            HashMap::new()
        };

        // Which section shows each typed name before the wipe, to say so when a
        // detect leaves one on another.
        let names_before = from_detect.then(|| named::compute::compute_overlay(&tx));

        // Birth dates of every current row, read BEFORE the wipe. New payloads
        // stamp created_at at mint, but payloads persisted before that change
        // carry None forever (the registry blob round-trips it); without this
        // fallback such rows would re-stamp on every save.
        let existing_created: HashMap<String, String> = {
            let mut stmt =
                tx.prepare("SELECT id, created_at FROM sections WHERE created_at IS NOT NULL")?;
            stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        let held_supersessions = held_supersessions(&tx);
        let existing_superseded: Vec<(String, String)> = {
            let mut stmt = tx.prepare(&format!(
                "SELECT id, superseded_by FROM sections WHERE {DERIVED_SECTION_PREDICATE}
                 AND superseded_by IS NOT NULL"
            ))?;
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<SqlResult<_>>()?
        };

        // Exclusions are user decisions living on junction rows the wipe
        // below cascades away. Read them first so the re-insert can put
        // them back on the surviving section ids.
        // A catalogue wipe since the last apply deleted its rows already and
        // left their exclusions held for this one.
        let held_exclusions = held_auto_exclusions(&tx);
        let mut carried_exclusions = held_exclusions.clone();
        carried_exclusions.extend(capture_auto_exclusions(&tx)?);

        // Clear existing auto sections (keep custom, trimmed, and accepted
        // sections, and disabled ones, whose row is retained so enable can
        // restore it with members intact; the disabled corridor is separately
        // suppressed via section_intents, so sparing the row cannot resurrect it).
        // Deleting the section cascades its section_activities rows (FK ON DELETE
        // CASCADE), so this needs no separate junction delete.
        tx.execute(
            &format!("DELETE FROM sections WHERE {DERIVED_SECTION_PREDICATE}"),
            [],
        )?;

        // Load existing section names to preserve user-set names (from custom sections)
        let existing_names: HashMap<String, String> = {
            let mut stmt = tx.prepare("SELECT id, name FROM sections WHERE name IS NOT NULL")?;
            stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        // Insert auto-detected sections with new schema
        let mut section_stmt = tx.prepare(&format!(
            "INSERT INTO sections (
                id, section_type, name, sport_type, polyline_json, distance_meters,
                representative_activity_id, confidence, observation_count, average_spread,
                point_density_json, scale, version, is_user_defined, stability, created_at, updated_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                consensus_state_blob, polyline_blob, point_density_blob,
                elevation_gain_m, avg_grade_percent,
                rep_start_index, rep_end_index, geometry_source,
                elevation_loss_m, max_grade_percent, straightness, klass, is_lift, rank_score, sport_rank_score
            ) VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {IS_LIFT_UNLESS_UNFLAGGED}, ?, ?)"
        ))?;
        // OR REPLACE: two passes of one activity can share a `start_index` on a
        // short section, and a UNIQUE violation would abort the whole apply.
        let mut junction_stmt = tx
            .prepare("INSERT OR REPLACE INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace, avg_hr, avg_power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")?;

        // Persist only the auto (non-user-defined) catalogue. Custom and accepted
        // sections are durable rows the wipe above spares and are managed by their
        // own CRUD paths; since they now also live in the in-memory `self.sections`
        // (so the matcher and get_sections() see them), they must be filtered out
        // here or they would be re-inserted under 'auto', a UNIQUE-id collision.
        let mut sorted_sections: Vec<&FrequentSection> = self
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .collect();
        // Section id closes the order: it is unique, so a section new to the
        // catalogue takes the same number on every run.
        sorted_sections.sort_by(|a, b| {
            a.sport_type
                .cmp(&b.sport_type)
                .then_with(|| b.activity_ids.len().cmp(&a.activity_ids.len()))
                .then_with(|| a.id.cmp(&b.id))
        });

        // The insert triggers recount a section's summary on every junction
        // row, quadratic in the rows a section carries. Suspend them for the
        // bulk write and recount the saved rows once below.
        tx.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, '1')",
            params![SECTION_SUMMARY_BULK_KEY],
        )?;

        // Pre-fetch all time streams the upcoming portion loop will need.
        // Replaces a per-portion `SELECT times FROM time_streams WHERE
        // activity_id = ?` (~0.1-0.2 ms each, ~hundreds of portions per
        // detection batch) with one `WHERE activity_id IN (...)` query.
        // Activities already in `self.time_streams` are skipped so we only
        // pay for cache misses.
        let db_time_streams: HashMap<String, Vec<u32>> = {
            let mut needed: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for section in &sorted_sections {
                for portion in &section.activity_portions {
                    if !self.time_streams.contains(&portion.activity_id) {
                        needed.insert(portion.activity_id.as_str());
                    }
                }
            }
            let mut map: HashMap<String, Vec<u32>> = HashMap::with_capacity(needed.len());
            let ids: Vec<&str> = needed.iter().copied().collect();
            // Chunked for the same reason the detection pool is: one `IN` over
            // the whole library holds every decoded series resident at once,
            // which on a long-ride library is the spike, not the total.
            for chunk in ids.chunks(STREAM_READ_CHUNK) {
                let sql = format!(
                    "SELECT activity_id, times FROM time_streams WHERE activity_id IN ({})",
                    placeholders_for(chunk.len())
                );
                let params_vec: Vec<&dyn rusqlite::ToSql> =
                    chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
                if let Ok(mut stmt) = tx.prepare(&sql)
                    && let Ok(rows) = stmt.query_map(params_vec.as_slice(), |row| {
                        let id: String = row.get(0)?;
                        let bytes: Vec<u8> = row.get(1)?;
                        let stream = codec::deserialize::<Vec<u32>>(&bytes).map_err(|error| {
                            log::error!(
                                "veloqrs: time_streams.times decode failed for activity_id {id}: {error}"
                            );
                            rusqlite::Error::FromSqlConversionFailure(
                                1,
                                Type::Blob,
                                error.into(),
                            )
                        })?;
                        Ok((id, stream))
                    })
                {
                    for row in rows.flatten() {
                        map.insert(row.0, row.1);
                    }
                }
            }
            map
        };

        // A time stream must match its track's point count to time a traversal.
        let track_points: HashMap<String, usize> = {
            let ids: Vec<String> = sorted_sections
                .iter()
                .flat_map(|s| s.activity_portions.iter())
                .map(|p| p.activity_id.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            self.track_point_counts(&ids)
        };

        // The apply stores sensor means before replacing section rows.
        let (db_hr_series, db_power_series) = {
            let mut needed: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for section in &sorted_sections {
                for portion in &section.activity_portions {
                    needed.insert(portion.activity_id.as_str());
                }
            }
            let mut map: HashMap<String, Vec<Option<f64>>> = HashMap::with_capacity(needed.len());
            let mut power_map: HashMap<String, Vec<Option<f64>>> =
                HashMap::with_capacity(needed.len());
            let ids: Vec<&str> = needed.iter().copied().collect();
            for chunk in ids.chunks(STREAM_READ_CHUNK) {
                let sql = format!(
                    "SELECT activity_id, kind, data FROM activity_streams WHERE kind IN ('heartrate', 'watts') AND activity_id IN ({})",
                    placeholders_for(chunk.len())
                );
                let params_vec: Vec<&dyn rusqlite::ToSql> =
                    chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
                if let Ok(mut stmt) = tx.prepare(&sql)
                    && let Ok(rows) = stmt.query_map(params_vec.as_slice(), |row| {
                        let id: String = row.get(0)?;
                        let kind: String = row.get(1)?;
                        let bytes: Vec<u8> = row.get(2)?;
                        Ok((id, kind, bytes))
                    })
                {
                    for (id, kind, bytes) in rows.flatten() {
                        if let Some(series) = codec::decode_series(&bytes) {
                            if kind == "heartrate" {
                                map.insert(id, series);
                            } else {
                                power_map.insert(id, series);
                            }
                        }
                    }
                }
            }
            (map, power_map)
        };

        let pinned: HashSet<String> = self.pinned_section_ids().into_iter().collect();
        for section in sorted_sections {
            // The portions that will actually become junction rows. A
            // section with none of them takes zero rows, so no visit_count
            // trigger fires and the catalogue gains a "0 visits" card over an
            // empty detail screen. Skip the row entirely rather than persist it.
            // Detection prunes these before the save; this is the backstop for
            // any other caller.
            let surviving: Vec<&tracematch::SectionPortion> = section
                .activity_portions
                .iter()
                .filter(|p| self.activity_metadata.contains_key(&p.activity_id))
                .collect();
            if surviving.is_empty() && !pinned.contains(&section.id) {
                log::warn!(
                    "veloqrs: [save_sections] skipping section {} - {} activity_ids, {} \
                     portions, none of them pooled",
                    section.id,
                    section.activity_ids.len(),
                    section.activity_portions.len(),
                );
                skipped.insert(section.id.clone());
                continue;
            }

            // Blob is the authoritative geometry; only legacy rows carry real
            // JSON, which readers use as a fallback.
            let polyline_blob = codec::serialize_track_points(&section.polyline);
            let point_density_blob = if section.point_density.is_empty() {
                None
            } else {
                Some(
                    codec::serialize(&section.point_density)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?,
                )
            };
            let created_at = section
                .created_at
                .clone()
                .or_else(|| existing_created.get(&section.id).cloned())
                .unwrap_or_else(|| Utc::now().to_rfc3339());

            // A section with no name stays unnamed: the insert trigger gives it
            // a number when it is new, and it keeps the one it held otherwise.
            let name_to_save: Option<String> = existing_names
                .get(&section.id)
                .cloned()
                .or_else(|| section.name.clone());

            // Compute bounds from polyline
            let (bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng) =
                if section.polyline.len() >= 2 {
                    let bounds = tracematch::geo_utils::compute_bounds(&section.polyline);
                    (
                        Some(bounds.min_lat),
                        Some(bounds.max_lat),
                        Some(bounds.min_lng),
                        Some(bounds.max_lng),
                    )
                } else {
                    (None, None, None, None)
                };

            // Store the optional consensus accumulator as MessagePack. The
            // load path does not read this blob.
            let consensus_state_blob = section
                .consensus_state
                .as_ref()
                .and_then(|acc| codec::serialize_gps_composite(acc).ok());

            // A range is only truth alongside the activity it indexes. Without
            // one the line is an average, which is a slice of nothing.
            let geometry_source = if section.representative_range.is_some()
                && !section.representative_activity_id.is_empty()
            {
                history::SOURCE_EXACT
            } else {
                history::SOURCE_CONSENSUS
            };
            section_stmt.execute(params![
                section.id,
                name_to_save,
                section.sport_type,
                codec::NO_POLYLINE_JSON,
                section.distance_meters,
                if section.representative_activity_id.is_empty() {
                    None
                } else {
                    Some(&section.representative_activity_id)
                },
                section.confidence,
                section.observation_count,
                section.average_spread,
                None::<String>, // point_density_json: legacy column, blob is authoritative
                section.scale.map(|s| s.to_string()),
                section.version,
                if section.is_user_defined { 1 } else { 0 },
                section.stability,
                created_at,
                section.updated_at,
                bounds_min_lat,
                bounds_max_lat,
                bounds_min_lng,
                bounds_max_lng,
                consensus_state_blob,
                polyline_blob,
                point_density_blob,
                section.elevation_gain_m,
                section.avg_grade_percent,
                section.representative_range.map(|(start, _)| start),
                section.representative_range.map(|(_, end)| end),
                geometry_source,
                section.enrichment.elevation_loss_m,
                section.enrichment.max_grade_percent,
                section.enrichment.straightness,
                section
                    .enrichment
                    .klass
                    .map(tracematch::SectionClass::as_str),
                section.id,
                i32::from(section.enrichment.is_lift),
                section.rank.as_ref().map(|r| r.score),
                section.rank.as_ref().map(|r| r.sport_score),
            ])?;

            // Populate junction table with full portion details and cached performance metrics.
            // Time streams come from `self.time_streams` (warm cache) or
            // the pre-fetched `db_time_streams` batch above (cold).
            // `surviving` already dropped the portions whose activity the pool no
            // longer holds. The activity_id foreign key would reject those and
            // abort the entire apply, a single stale carried member bricking
            // detection for the session.
            for portion in &surviving {
                let times = self
                    .time_streams
                    .peek(&portion.activity_id)
                    .map(|v| v.as_slice())
                    .or_else(|| {
                        db_time_streams
                            .get(&portion.activity_id)
                            .map(|v| v.as_slice())
                    });

                let (lap_time, lap_pace) = compute_lap_time_from_stream(
                    times,
                    track_points.get(&portion.activity_id).copied(),
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                );
                let avg_hr = mean_over_traversal(
                    db_hr_series.get(&portion.activity_id).map(Vec::as_slice),
                    portion.start_index,
                    portion.end_index,
                );
                let avg_power = mean_over_traversal(
                    db_power_series.get(&portion.activity_id).map(Vec::as_slice),
                    portion.start_index,
                    portion.end_index,
                );

                junction_stmt.execute(params![
                    section.id,
                    portion.activity_id,
                    portion.direction.to_string(),
                    portion.start_index,
                    portion.end_index,
                    portion.distance_meters,
                    lap_time,
                    lap_pace,
                    avg_hr,
                    avg_power,
                ])?;
            }
        }

        // Drop prepared statements before committing (they hold borrows on tx)
        drop(section_stmt);
        drop(junction_stmt);

        self.recut_forced_rides(&tx)?;

        // An id this catalogue does not produce has no row to update, so its
        // supersession waits with the held ones until the ground returns.
        let mut pending = held_supersessions;
        pending.extend(existing_superseded);
        place_held_supersessions(&tx, pending)?;

        recount_section_summaries(&tx, DERIVED_SECTION_PREDICATE)?;
        tx.execute(
            "DELETE FROM schema_info WHERE key = ?",
            params![SECTION_SUMMARY_BULK_KEY],
        )?;

        // Sections whose id survived the re-detect get their exclusions
        // back; a section that died has no rows and the updates are no-ops.
        reapply_auto_exclusions(&tx, &carried_exclusions)?;
        release_placed_auto_exclusions(&tx, held_exclusions)?;

        // Write the identity-registry blob in THIS transaction so the
        // registry and the catalogue it describes commit (or roll back) together.
        if let Some(blob) = self.section_identity_blob() {
            tx.execute(
                "INSERT INTO identity_state (key, blob, updated_at)
                 VALUES (?, ?, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at",
                params![identity::SECTION_IDENTITY_KEY, blob],
            )?;
        }

        if let Some(before) = names_before {
            history::record_name_moves_on(&tx, &before, &named::compute::compute_overlay(&tx))?;
        }

        // The emitter's fired lifecycle events, durable with the
        // catalogue they narrate. A geometry-bearing event versions its
        // polyline first and the history row links the version.
        for event in events {
            let version = match &event.geometry {
                Some(polyline) => Some(history::record_geometry_on(
                    &tx,
                    &event.real_id,
                    polyline,
                    false,
                    event
                        .reference
                        .as_ref()
                        .map(|(id, start, end)| (id.as_str(), *start, *end)),
                )?),
                None => None,
            };
            history::append_history_on(
                &tx,
                &event.real_id,
                event.kind,
                event.details.as_deref(),
                version,
                None,
            )?;
            // A re-cut re-bases the PR on the new extent. When that moves
            // the record, the ledger says so beside the re-cut, labelled
            // against the current extent: the old time was over other ground.
            if event.kind == "recut" {
                history::record_pr_rebase_on(&tx, &event.real_id, event.details.as_deref())?;
            }
        }

        if from_detect {
            let narrated: HashSet<&str> = events
                .iter()
                .filter(|event| event.geometry.is_some())
                .map(|event| event.real_id.as_str())
                .collect();
            for section in self.sections.iter().filter(|s| !s.is_user_defined) {
                let Some(outgoing) = outgoing.get(&section.id) else {
                    continue;
                };
                if narrated.contains(section.id.as_str()) {
                    continue;
                }
                record_adoption(&tx, section, outgoing)?;
            }
        }

        // Provenance of the catalogue this transaction stores: which detector
        // cut it, and under which parameters. Only a detect moves it. A
        // mutation save leaves the geometry of every other section alone, so
        // advancing the marker there would retire the one-shot capture above
        // without anything having been re-cut.
        if from_detect {
            for (key, value) in [
                (CATALOGUE_METHOD_KEY, DETECTOR_METHOD.to_string()),
                (
                    CATALOGUE_CONFIG_DIGEST_KEY,
                    section_config_digest(&self.section_config),
                ),
            ] {
                tx.execute(
                    "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
                    params![key, value],
                )?;
            }
        }

        tx.commit()?;

        Ok(skipped)
    }

    /// The detection method that cut the stored catalogue, absent until a save
    /// has run under a build that records it.
    pub fn catalogue_detection_method(&self) -> Option<String> {
        self.schema_info_value(CATALOGUE_METHOD_KEY)
    }

    /// [`section_config_digest`] of the config the stored catalogue ran under.
    pub fn catalogue_config_digest(&self) -> Option<String> {
        self.schema_info_value(CATALOGUE_CONFIG_DIGEST_KEY)
    }

    fn schema_info_value(&self, key: &str) -> Option<String> {
        pooled::schema_info_value(&self.db, key)
    }
}

#[cfg(test)]
mod tests {
    /// A line running north from a fixed origin, one point every `spacing_m`
    /// metres, shifted `east_m` metres east and starting `start_index` points
    /// along it.
    fn northbound(
        points: usize,
        spacing_m: f64,
        east_m: f64,
        start_index: f64,
    ) -> Vec<tracematch::GpsPoint> {
        let lat0 = 46.5_f64;
        let lng0 = 6.6_f64;
        let m_per_deg_lat = 111_320.0;
        let m_per_deg_lng = m_per_deg_lat * lat0.to_radians().cos();
        (0..points)
            .map(|i| {
                tracematch::GpsPoint::new(
                    lat0 + (start_index + i as f64) * spacing_m / m_per_deg_lat,
                    lng0 + east_m / m_per_deg_lng,
                )
            })
            .collect()
    }

    fn forced(
        track: &[tracematch::GpsPoint],
        line: &[tracematch::GpsPoint],
    ) -> Vec<tracematch::SectionPortion> {
        super::forced_portions("ride", track, line, &tracematch::SectionConfig::default())
    }

    /// Scenario: a ride the athlete attached by hand runs beside the section,
    /// 20 m and 300 m to its side.
    /// Expected behaviour: each keeps one row covering the section.
    #[test]
    fn a_forced_ride_beside_the_section_keeps_one_row() {
        let line = northbound(200, 11.0, 0.0, 0.0);
        for east_m in [20.0, 300.0] {
            let ride = northbound(200, 11.0, east_m, 0.0);

            let rows = forced(&ride, &line);

            assert_eq!(rows.len(), 1, "{east_m} m east");
            assert!(rows[0].start_index <= 3, "{east_m} m east: {:?}", rows[0]);
            assert!(rows[0].end_index >= 196, "{east_m} m east: {:?}", rows[0]);
        }
    }

    /// Scenario: a ride out and back along the section with a lead-in before
    /// and after, so a cut at the relaxed distance runs past both ends.
    /// Expected behaviour: two rows, each ending where the section ends.
    #[test]
    fn a_forced_out_and_back_writes_two_rows_that_stop_at_the_section_ends() {
        let line = northbound(200, 11.0, 0.0, 0.0);
        let lead = 100;
        let long = northbound(200 + 2 * lead, 11.0, 0.0, -(lead as f64));
        let mut ride: Vec<_> = long.clone();
        let mut back: Vec<_> = long.into_iter().rev().collect();
        ride.append(&mut back);
        let section_start = lead;
        let section_end = lead + 199;

        let rows = forced(&ride, &line);

        assert_eq!(rows.len(), 2, "{rows:?}");
        let slack = 1;
        let out = &rows[0];
        assert!(
            (out.start_index as usize).abs_diff(section_start) <= slack
                && (out.end_index as usize).abs_diff(section_end + 1) <= slack,
            "{out:?}"
        );
        let back = &rows[1];
        let rev_start = ride.len() - 1 - section_end;
        assert!(
            (back.start_index as usize).abs_diff(rev_start) <= slack
                && (back.end_index as usize).abs_diff(rev_start + 200) <= slack,
            "{back:?}"
        );
    }

    /// Scenario: a ride on the line with 100 points of approach and run-out,
    /// forced to sections of 150, 222 and 300 m, on the line and 300 m east.
    /// Expected behaviour: one row whose ends sit within one point of the
    /// section's and whose distance is within 10 per cent of the section's.
    #[test]
    fn a_forced_ride_row_ends_where_the_section_ends() {
        let spacing = 11.1;
        let lead = 100;
        for section_m in [150.0_f64, 222.0, 300.0] {
            let points = (section_m / spacing).round() as usize + 1;
            for east_m in [0.0, 300.0] {
                let line = northbound(points, spacing, 0.0, lead as f64);
                let ride = northbound(points + 2 * lead, spacing, east_m, 0.0);

                let rows = forced(&ride, &line);

                let label = format!("{section_m} m section, {east_m} m east: {rows:?}");
                assert_eq!(rows.len(), 1, "{label}");
                let row = &rows[0];
                assert!((row.start_index as usize).abs_diff(lead) <= 1, "{label}");
                assert!(
                    (row.end_index as usize).abs_diff(lead + points) <= 1,
                    "{label}"
                );
                let section_len = tracematch::matching::calculate_route_distance(&line);
                assert!(
                    (row.distance_meters - section_len).abs() <= 0.1 * section_len,
                    "{label}"
                );
            }
        }
    }

    /// Scenario: the DELETE behind a forced re-detect fails, after the config
    /// that provoked it has already been persisted.
    /// Expected behaviour: the evidence cache goes anyway, the processed set is
    /// left matching disk, and the clear is retried at the next detect.
    #[test]
    fn a_failed_processed_clear_drops_the_cache_and_is_retried() {
        let mut engine = crate::persistence::PersistentEngine::in_memory().unwrap();
        engine
            .save_processed_activity_ids(&["a".to_string(), "b".to_string()])
            .unwrap();
        engine.cache_folded_ids.insert("a".to_string());

        engine
            .db
            .execute("DROP TABLE processed_activities", [])
            .unwrap();
        engine.clear_processed_activity_ids();

        assert!(engine.processed_clear_pending());
        assert_eq!(engine.processed_activity_ids.len(), 2);
        assert_eq!(engine.evidence_cache_folded_count(), 0);

        engine
            .db
            .execute(
                "CREATE TABLE processed_activities (activity_id TEXT PRIMARY KEY)",
                [],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO processed_activities (activity_id) VALUES ('a'), ('b')",
                [],
            )
            .unwrap();

        engine.retry_pending_processed_clear();

        assert!(!engine.processed_clear_pending());
        assert!(engine.processed_activity_ids.is_empty());
        let remaining: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM processed_activities", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn retry_is_a_no_op_when_no_clear_is_owed() {
        let mut engine = crate::persistence::PersistentEngine::in_memory().unwrap();
        engine
            .save_processed_activity_ids(&["a".to_string()])
            .unwrap();

        engine.retry_pending_processed_clear();

        assert!(!engine.processed_clear_pending());
        assert_eq!(engine.processed_activity_ids.len(), 1);
    }
}

/// Every traversal of a section line by one activity, counted the way
/// detection counts it, so an attached row and a detected row agree.
pub(crate) fn compute_section_portions(
    activity_id: &str,
    track: &[tracematch::GpsPoint],
    section_polyline: &[tracematch::GpsPoint],
    config: &tracematch::SectionConfig,
) -> Vec<tracematch::SectionPortion> {
    tracematch::track_portions(activity_id, track, section_polyline, config)
}

/// How far past the proximity threshold a ride the athlete attached by hand
/// may sit: they have asserted it passes the section, so the bar relaxes.
pub(crate) const FORCED_PROXIMITY_FACTOR: f64 = 2.5;

/// Every traversal of a section line by a ride the athlete attached by hand,
/// cut by the pass matcher with the relaxed bar as its lateral tolerance. The attach, every junction rebuild that re-cuts the
/// ride and the scan that offers it all cut here, so what the scan offers is
/// what the attach writes and what a rebuild keeps.
pub(crate) fn forced_portions(
    activity_id: &str,
    track: &[tracematch::GpsPoint],
    section_polyline: &[tracematch::GpsPoint],
    config: &tracematch::SectionConfig,
) -> Vec<tracematch::SectionPortion> {
    // The matcher counts a point one cell past the tolerance, so the tolerance
    // is the relaxed bar less that cell. Whole cells are what it reaches, and a
    // ride exactly at the bar would fall either side of a cell edge.
    let lateral_m = config.proximity_threshold * FORCED_PROXIMITY_FACTOR
        - tracematch::line_match_cell_m(config);
    match tracematch::PreparedLine::with_lateral_tolerance(section_polyline, config, lateral_m) {
        Some(line) => line
            .portions(activity_id, track)
            .into_iter()
            .map(|portion| clip_to_line_ends(portion, track, section_polyline))
            .collect(),
        None => Vec::new(),
    }
}

/// A pass cut with a lateral tolerance runs on past the line, one tolerance
/// before its start and after its end. Trim it to the points nearest the
/// line's two ends, so its distance and lap time describe the section. A pass
/// whose two end points coincide, a loop, has no span between them and keeps
/// the cut it came with.
fn clip_to_line_ends(
    mut portion: tracematch::SectionPortion,
    track: &[tracematch::GpsPoint],
    line: &[tracematch::GpsPoint],
) -> tracematch::SectionPortion {
    let (start, end) = (portion.start_index as usize, portion.end_index as usize);
    let (Some(first), Some(last)) = (line.first(), line.last()) else {
        return portion;
    };
    let Some(span) = track.get(start..end.min(track.len())) else {
        return portion;
    };
    let nearest = |target: &tracematch::GpsPoint| {
        span.iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                let da = tracematch::geo_utils::haversine_distance(a, target);
                let db = tracematch::geo_utils::haversine_distance(b, target);
                da.total_cmp(&db)
            })
            .map(|(i, _)| i)
    };
    let (Some(a), Some(b)) = (nearest(first), nearest(last)) else {
        return portion;
    };
    let (lo, hi) = (a.min(b), a.max(b));
    if hi - lo < 1 {
        return portion;
    }
    portion.start_index = (start + lo) as u32;
    portion.end_index = (start + hi + 1) as u32;
    portion.distance_meters =
        tracematch::matching::calculate_route_distance(&track[start + lo..start + hi + 1]);
    portion
}

/// Pair every summary with each sport that travels it, most travelled first.
///
/// One pass over a list the caller already holds. Asking the database per
/// sport, which is what the insights bundle used to do, re-runs the whole
/// summary query once per sport and discards every row belonging to the other
/// thirteen: measured at a third of a 15 ms bundle on a 152-section library.
///
/// `min_outings` is the returning floor. A PR slot is earned by coming back,
/// so a section travelled once does not hold one however fast the pass was.
pub fn summaries_by_sport(
    summaries: &[SectionSummary],
    sports: &[String],
    min_outings: u32,
) -> Vec<(String, SectionSummary)> {
    let mut paired: Vec<(String, SectionSummary)> = sports
        .iter()
        .flat_map(|sport| {
            summaries
                .iter()
                .filter(|s| PersistentEngine::summary_covers_sport(s, sport))
                .filter(|s| s.activity_count >= min_outings)
                .map(move |s| (sport.clone(), s.clone()))
        })
        .collect();
    paired.sort_by_key(|(_, s)| std::cmp::Reverse(s.visit_count));
    paired
}

pub(crate) mod pooled {
    use rusqlite::types::Type;
    use rusqlite::{Connection, params};

    use super::{FrequentSection, SectionPortion};
    use crate::sections::Section;

    use crate::persistence::PersistentEngine;

    /// One `schema_info` row, absent when unset or unreadable.
    pub(crate) fn schema_info_value(conn: &Connection, key: &str) -> Option<String> {
        conn.query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![key],
            |row| row.get(0),
        )
        .ok()
    }

    /// The detection method that cut the stored catalogue.
    pub(crate) fn catalogue_detection_method(conn: &Connection) -> Option<String> {
        schema_info_value(conn, super::CATALOGUE_METHOD_KEY)
    }

    pub(crate) fn sections_where_latest_is_record(
        conn: &Connection,
        section_ids: &[&str],
    ) -> std::collections::HashSet<String> {
        if section_ids.is_empty() {
            return std::collections::HashSet::new();
        }
        let placeholders = vec!["?"; section_ids.len()].join(",");
        let query = format!(
            "SELECT DISTINCT ai.target_id
             FROM activity_indicators ai
             WHERE ai.indicator_type = 'section_pr'
               AND ai.target_id IN ({placeholders})
               AND ai.activity_id = (
                 SELECT sa.activity_id
                 FROM section_activities sa
                 JOIN activities a ON a.id = sa.activity_id
                 WHERE sa.section_id = ai.target_id
                   AND sa.excluded = 0
                 ORDER BY a.start_date DESC, sa.activity_id DESC
                 LIMIT 1
               )"
        );
        let Ok(mut stmt) = conn.prepare(&query) else {
            return std::collections::HashSet::new();
        };
        let params: Vec<&dyn rusqlite::types::ToSql> = section_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        stmt.query_map(params.as_slice(), |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }

    /// The stored catalogue, narrowed by sport and distinct outings. A pin
    /// exempts only the outing floor, never the sport filter.
    pub(crate) fn catalogue_sections(
        conn: &Connection,
        sport_type: Option<&str>,
        min_visits: Option<u32>,
    ) -> Vec<FrequentSection> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT s.id FROM sections s
             WHERE s.section_type IN ('auto', 'custom')
               AND s.disabled = 0 AND s.superseded_by IS NULL
               AND (?1 IS NULL OR EXISTS (
                    SELECT 1 FROM section_activities sa
                    JOIN activities a ON a.id = sa.activity_id
                    LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
                    WHERE sa.section_id = s.id AND sa.excluded = 0
                      AND COALESCE(am.sport_type, a.sport_type) = ?1
               ))
               AND (?2 = 0 OR EXISTS (SELECT 1 FROM section_pins p WHERE p.section_id = s.id)
                    OR (SELECT COUNT(DISTINCT sa.activity_id)
                        FROM section_activities sa
                        JOIN activities a ON a.id = sa.activity_id
                        LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
                        WHERE sa.section_id = s.id AND sa.excluded = 0
                          AND (?1 IS NULL OR COALESCE(am.sport_type, a.sport_type) = ?1)) >= ?2)
             ORDER BY s.id",
        ) else {
            return Vec::new();
        };
        let ids: Vec<String> = stmt
            .query_map(params![sport_type, min_visits.unwrap_or(0)], |row| {
                row.get(0)
            })
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default();
        ids.into_iter()
            .filter_map(|id| {
                let section = super::queries::pooled::section_raw(conn, &id)?;
                Some(to_frequent(section, section_portions(conn, &id)))
            })
            .collect()
    }

    /// How many stored activities have never been through a detect, counted
    /// against the persisted processed set.
    pub(crate) fn activities_awaiting_detection(conn: &Connection) -> rusqlite::Result<u64> {
        conn.query_row(
            "SELECT COUNT(*) FROM activities
             WHERE id NOT IN (SELECT activity_id FROM processed_activities)",
            [],
            |row| row.get::<_, i64>(0).map(|n| n.max(0) as u64),
        )
    }

    /// Ids of the sections the user has pinned, sorted.
    pub(crate) fn pinned_section_ids(conn: &Connection) -> Vec<String> {
        let Ok(mut stmt) = conn.prepare("SELECT section_id FROM section_pins ORDER BY section_id")
        else {
            return Vec::new();
        };
        stmt.query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }

    /// One section's line as flat `[lat, lng, lat, lng, ...]`, or empty when
    /// the section is absent or its line will not decode.
    pub(crate) fn section_polyline(conn: &Connection, section_id: &str) -> Vec<f64> {
        match super::geometry::stored_line(conn, section_id) {
            Ok(points) => points
                .iter()
                .flat_map(|p| [p.latitude, p.longitude])
                .collect(),
            Err(e) => {
                log::error!("veloqrs: get_section_polyline decode error for {section_id}: {e}");
                Vec::new()
            }
        }
    }

    /// [`PersistentEngine::get_map_sections`] on a connection. `names` is the
    /// corridor-name overlay: the engine passes its cached map, a pooled reader
    /// `named::pooled::overlay_names`.
    pub(crate) fn map_sections(
        conn: &Connection,
        sport_type: Option<&str>,
        min_visits: Option<u32>,
        names: &std::collections::BTreeMap<String, String>,
    ) -> Vec<crate::FfiMapSection> {
        let mut summaries =
            super::queries::pooled::section_summaries_filtered(conn, None, true, names);
        if let Some(sport) = sport_type {
            summaries.retain(|s| PersistentEngine::summary_covers_sport(s, sport));
        }
        // Outings, not passes, counted in the filtered sport, and a pin exempts
        // the floor: the same rule `get_sections_filtered` applies, so the
        // map's overlay does not change which sections it shows. With no floor
        // there is nothing to count.
        if let Some(min_visits) = min_visits.filter(|&min| min > 0) {
            let supported =
                super::queries::pooled::supported_section_ids(conn, sport_type, min_visits);
            summaries.retain(|s| supported.contains(&s.id));
        }
        if summaries.is_empty() {
            return Vec::new();
        }

        let ids: Vec<&str> = summaries.iter().map(|s| s.id.as_str()).collect();
        let mut polylines = section_polylines(conn, &ids);

        summaries
            .into_iter()
            .filter_map(|summary| {
                // A section whose line will not decode has nothing to draw, and
                // the map skipped it anyway once it counted the points.
                let encoded_polyline = polylines.remove(&summary.id)?;
                if encoded_polyline.is_empty() {
                    return None;
                }
                let name = summary
                    .name
                    .clone()
                    .or_else(|| names.get(&summary.id).cloned());
                Some(crate::FfiMapSection {
                    id: summary.id,
                    name,
                    sport_types: summary.sport_types,
                    visit_count: summary.visit_count,
                    distance_meters: summary.distance_meters,
                    klass: summary.klass,
                    max_grade_percent: summary.max_grade_percent,
                    encoded_polyline,
                })
            })
            .collect()
    }

    /// Every named section's line in one query, encoded as it leaves the
    /// engine. The map asks for a whole catalogue of them, so this is one
    /// statement rather than a read per section.
    pub(crate) fn section_polylines(
        conn: &Connection,
        section_ids: &[&str],
    ) -> std::collections::HashMap<String, Vec<u8>> {
        use std::collections::HashMap;
        if section_ids.is_empty() {
            return HashMap::new();
        }

        let placeholders: Vec<&str> = section_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT id, polyline_blob, polyline_json, representative_activity_id,
                    rep_start_index, rep_end_index
             FROM sections WHERE id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match conn.prepare(&query) {
            Ok(s) => s,
            Err(e) => {
                log::error!("veloqrs: [sections] batch section polyline query failed: {e}");
                return HashMap::new();
            }
        };

        let params: Vec<&dyn rusqlite::types::ToSql> = section_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        stmt.query_map(params.as_slice(), |row| {
            let section_id: String = row.get(0)?;
            let polyline_blob: Option<Vec<u8>> = row.get(1)?;
            let polyline_json: Option<String> = row.get(2)?;
            let rep: Option<String> = row.get(3)?;
            let rep_start: Option<u32> = row.get(4)?;
            let rep_end: Option<u32> = row.get(5)?;
            let points = super::geometry::line(
                conn,
                polyline_blob.as_deref(),
                polyline_json.as_deref(),
                super::geometry::reference(rep.as_deref(), rep_start, rep_end),
            )
            .unwrap_or_default();
            Ok((
                section_id,
                crate::persistence::codec::encode_polyline(&points),
            ))
        })
        .ok()
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }

    pub(crate) fn section_portions(conn: &Connection, section_id: &str) -> Vec<SectionPortion> {
        let mut stmt = match conn.prepare(
            "SELECT sa.activity_id, sa.direction, sa.start_index, sa.end_index, sa.distance_meters
             FROM section_activities sa
             WHERE sa.section_id = ? AND sa.excluded = 0
             ORDER BY sa.start_index",
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "veloqrs: [PersistentEngine] section_portions query failed for {}: {}",
                    section_id,
                    e
                );
                return Vec::new();
            }
        };
        stmt.query_map(params![section_id], |row| {
            Ok(SectionPortion {
                activity_id: row.get(0)?,
                direction: {
                    let s: String = row.get(1)?;
                    s.parse().map_err(|_| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            Type::Text,
                            Box::new(std::fmt::Error),
                        )
                    })?
                },
                start_index: row.get(2)?,
                end_index: row.get(3)?,
                distance_meters: row.get(4)?,
            })
        })
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }

    /// One stored section as the detail screens want it: the row, its
    /// junction portions, and nothing the engine holds in memory. Lifted out
    /// of `get_section_by_id` so the pooled read and the lock-holding one
    /// cannot build a different record from the same row.
    pub(crate) fn to_frequent(section: Section, portions: Vec<SectionPortion>) -> FrequentSection {
        FrequentSection {
            id: section.id,
            name: section.name,
            sport_type: section.sport_type,
            polyline: section.polyline,
            representative_activity_id: section.representative_activity_id.unwrap_or_default(),
            representative_range: None,
            activity_ids: section.activity_ids,
            activity_portions: portions,
            visit_count: section.visit_count,
            distance_meters: section.distance_meters,
            activity_traces: std::collections::HashMap::new(),
            confidence: section.confidence.unwrap_or(0.0),
            observation_count: section.observation_count.unwrap_or(0),
            average_spread: section.average_spread.unwrap_or(0.0),
            point_density: section.point_density.unwrap_or_default(),
            scale: section.scale.and_then(|s| s.parse().ok()),
            is_user_defined: section.is_user_defined,
            stability: section.stability.unwrap_or(0.0),
            elevation_gain_m: section.elevation_gain_m,
            avg_grade_percent: section.avg_grade_percent,
            version: section.version.unwrap_or(1),
            updated_at: section.updated_at,
            created_at: Some(section.created_at),
            enrichment: tracematch::Enrichment {
                elevation_gain_m: section.elevation_gain_m,
                avg_grade_percent: section.avg_grade_percent,
                elevation_loss_m: section.elevation_loss_m,
                max_grade_percent: section.max_grade_percent,
                straightness: section.straightness,
                klass: section
                    .klass
                    .as_deref()
                    .and_then(tracematch::SectionClass::parse),
                is_lift: section.is_lift,
            },
            rank: section.rank_score.map(|score| tracematch::RankFeatures {
                score,
                sport_score: section.sport_rank_score.unwrap_or(score),
                ..Default::default()
            }),
            consensus_state: None,
        }
    }
}
