//! The old-versus-new sections map: every retired section with its newest
//! decodable line, every catalogue row visible or not, and the pairs between
//! them with the reason each is shown together.
//!
//! The pairing is the detector's own: two lines share ground when a majority
//! of either lies within the ground tolerance of the other, the rule that
//! suppresses a fresh auto section over ground an athlete already owns. A
//! bounding-box prefilter keeps a retired line from being compared with
//! sections nowhere near it.
//!
//! Scanning for shared ground resamples both lines, so on a dense library it
//! costs seconds, and the read has a mount budget. So the ground pairs are
//! worked out in the background and stored, each line with a fingerprint of
//! what it was measured as. A line whose fingerprint has moved is owed, and
//! only its own pairs are measured again. The read takes the stored pairs and
//! says when some are still owed; it never scans.
//!
//! Staleness is keyed on the line rather than on the writes that move it, since
//! a line also moves where no catalogue write runs: a pending restore's archived
//! line, or a reference triple whose activity track was replaced.

use super::history::RetiredSection;
use super::history::pooled as history;
use crate::{
    FfiCurrentMapSection, FfiRetiredMapData, FfiRetiredMapPair, FfiRetiredMapSection,
    FfiRetiredPairLink,
};
use rusqlite::{Connection, Result as SqlResult, params};
use std::collections::{HashMap, HashSet};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tracematch::GpsPoint;
use tracematch::sections::{CARRY_COVERAGE, GROUND_TOL_M, coverage_and_offset};

#[cfg(test)]
thread_local! {
    /// How many whole-line ground comparisons this thread has made, each a
    /// resample and a coverage scan of two lines.
    pub(crate) static GROUND_COMPARES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// How many times this thread has asked tracematch to scan a pair of lines
    /// for shared ground, whichever question it asked.
    pub(crate) static GROUND_SCANS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// How many times this thread has built the whole record.
    pub(crate) static RETIRED_MAP_BUILDS: std::cell::Cell<usize> =
        const { std::cell::Cell::new(0) };
}

/// A line's box, padded by the ground tolerance: two lines within tolerance of
/// each other must have boxes that meet, so a miss means no comparison is owed.
#[derive(Debug, Clone, Copy)]
struct PaddedBox {
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
}

impl PaddedBox {
    fn of_line(line: &[GpsPoint]) -> Self {
        let b = tracematch::geo_utils::compute_bounds(line);
        let pad_lat = GROUND_TOL_M / 111_000.0;
        let mid = ((b.min_lat + b.max_lat) * 0.5).to_radians();
        let pad_lng = GROUND_TOL_M / (111_320.0 * mid.cos().abs().max(0.01));
        Self {
            min_lat: b.min_lat - pad_lat,
            max_lat: b.max_lat + pad_lat,
            min_lng: b.min_lng - pad_lng,
            max_lng: b.max_lng + pad_lng,
        }
    }

    fn meets(&self, other: &Self) -> bool {
        self.min_lat <= other.max_lat
            && other.min_lat <= self.max_lat
            && self.min_lng <= other.max_lng
            && other.min_lng <= self.max_lng
    }
}

/// `retired_ground_lines.side` for a retired section's newest line.
const SIDE_RETIRED: i64 = 0;
/// `retired_ground_lines.side` for a catalogue row's line.
const SIDE_CURRENT: i64 = 1;

/// What a line was measured as: the CRC-32 of its encoded bytes beside their
/// length. Any change to the line moves it, so the line's pairs are owed again.
fn fingerprint(encoded: &[u8]) -> i64 {
    ((encoded.len() as i64) << 32) | i64::from(crc32fast::hash(encoded))
}

struct CurrentRow {
    shown: FfiCurrentMapSection,
    line: Vec<GpsPoint>,
    fingerprint: i64,
}

/// Every catalogue row with a line that decodes.
fn current_rows(conn: &Connection) -> Vec<CurrentRow> {
    let names = super::named::pooled::overlay_names(conn);
    let pinned: HashSet<String> = super::pooled::pinned_section_ids(conn)
        .into_iter()
        .collect();
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, name, is_user_defined, disabled, superseded_by,
                polyline_blob, polyline_json, representative_activity_id,
                rep_start_index, rep_end_index, distance_meters, visit_count
         FROM sections ORDER BY id",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let name: Option<String> = row.get(1)?;
        let is_user_defined: Option<i64> = row.get(2)?;
        let disabled: i64 = row.get(3)?;
        let superseded_by: Option<String> = row.get(4)?;
        let blob: Option<Vec<u8>> = row.get(5)?;
        let json: Option<String> = row.get(6)?;
        let rep: Option<String> = row.get(7)?;
        let rep_start: Option<u32> = row.get(8)?;
        let rep_end: Option<u32> = row.get(9)?;
        let distance: Option<f64> = row.get(10)?;
        let visits: Option<u32> = row.get(11)?;
        let line = super::geometry::line(
            conn,
            blob.as_deref(),
            json.as_deref(),
            super::geometry::reference(rep.as_deref(), rep_start, rep_end),
        )
        .unwrap_or_default();
        Ok((
            id,
            name,
            is_user_defined.unwrap_or(0) != 0,
            disabled != 0,
            superseded_by,
            line,
            (distance.unwrap_or(0.0), visits.unwrap_or(0)),
        ))
    });
    let Ok(rows) = rows else { return Vec::new() };
    rows.flatten()
        .filter(|(_, _, _, _, _, line, _)| line.len() >= 2)
        .map(
            |(id, name, is_user_defined, disabled, superseded_by, line, (distance, visits))| {
                let encoded = crate::persistence::codec::encode_polyline(&line);
                CurrentRow {
                    fingerprint: fingerprint(&encoded),
                    shown: FfiCurrentMapSection {
                        name: name.or_else(|| names.get(&id).cloned()),
                        is_user_defined,
                        pinned: pinned.contains(&id),
                        hidden: disabled || superseded_by.is_some(),
                        superseded_by,
                        distance_meters: distance,
                        visit_count: visits,
                        encoded_polyline: encoded,
                        id,
                    },
                    line,
                }
            },
        )
        .collect()
}

/// A retired section with its newest stored version that decodes, encoded,
/// or none when no version does.
struct RetiredRow {
    section: RetiredSection,
    line: Vec<GpsPoint>,
    encoded: Option<(Vec<u8>, i64)>,
}

fn retired_rows(conn: &Connection) -> Vec<RetiredRow> {
    history::retired_sections(conn)
        .into_iter()
        .map(|section| {
            let line = section
                .versions
                .iter()
                .rev()
                .filter_map(|v| history::section_geometry_version(conn, &section.section_id, v.0))
                .map(|(points, _)| points)
                .find(|points| points.len() >= 2)
                .unwrap_or_default();
            let encoded = (!line.is_empty()).then(|| {
                let bytes = crate::persistence::codec::encode_polyline(&line);
                let print = fingerprint(&bytes);
                (bytes, print)
            });
            RetiredRow {
                section,
                line,
                encoded,
            }
        })
        .collect()
}

/// The fingerprint each stored pair's lines were measured at, by side. An
/// unreadable table reads as empty, which owes every line.
#[derive(Default)]
struct MeasuredLines {
    retired: HashMap<String, i64>,
    current: HashMap<String, i64>,
}

fn measured_lines(conn: &Connection) -> MeasuredLines {
    let mut measured = MeasuredLines::default();
    let Ok(mut stmt) =
        conn.prepare("SELECT section_id, side, fingerprint FROM retired_ground_lines")
    else {
        return measured;
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    });
    for (id, side, print) in rows.into_iter().flatten().flatten() {
        match side {
            SIDE_RETIRED => measured.retired.insert(id, print),
            _ => measured.current.insert(id, print),
        };
    }
    measured
}

/// The stored ground pairs, by retired id.
fn stored_pairs(conn: &Connection) -> HashMap<String, HashMap<String, f64>> {
    let mut pairs: HashMap<String, HashMap<String, f64>> = HashMap::new();
    let Ok(mut stmt) =
        conn.prepare("SELECT retired_id, current_id, overlap FROM retired_ground_pairs")
    else {
        return pairs;
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, f64>(2)?,
        ))
    });
    for (retired, current, overlap) in rows.into_iter().flatten().flatten() {
        pairs.entry(retired).or_default().insert(current, overlap);
    }
    pairs
}

/// The section a retirement's `into` chain ends at: a retired survivor hands
/// the ground on to its own, so the walk follows retired ids until it leaves
/// them. A cycle ends the walk where it closes.
fn chain_end<'a>(from: &'a str, into: &'a HashMap<&str, Option<&str>>) -> Option<&'a str> {
    let mut seen: HashSet<&str> = HashSet::from([from]);
    let mut at = (*into.get(from)?)?;
    while let Some(Some(next)) = into.get(at) {
        if !seen.insert(at) {
            break;
        }
        at = next;
    }
    Some(at)
}

/// The larger of the two coverage fractions of a pair. At or above
/// [`CARRY_COVERAGE`] the pair shares ground, which is the rule
/// `shares_ground` applies, so one scan both decides and measures.
fn ground_overlap(a: &[GpsPoint], b: &[GpsPoint]) -> f64 {
    #[cfg(test)]
    GROUND_SCANS.with(|c| c.set(c.get() + 1));
    coverage_and_offset(a, b).0.max(coverage_and_offset(b, a).0)
}

/// Catalogue rows the athlete restored from the retired list.
fn restored_live_ids(conn: &Connection) -> HashSet<String> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT DISTINCT h.section_id FROM section_history h
         JOIN sections s ON s.id = h.section_id WHERE h.kind = ?",
    ) else {
        return HashSet::new();
    };
    stmt.query_map([super::KIND_RESTORED], |row| row.get(0))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

pub(crate) fn retired_map_data(conn: &Connection) -> FfiRetiredMapData {
    #[cfg(test)]
    RETIRED_MAP_BUILDS.with(|builds| builds.set(builds.get() + 1));

    let retired_rows = retired_rows(conn);
    let current = current_rows(conn);
    let measured = measured_lines(conn);
    let mut stored = stored_pairs(conn);
    let links: Vec<(String, Option<String>)> = retired_rows
        .iter()
        .map(|r| (r.section.section_id.clone(), r.section.into.clone()))
        .collect();
    let into: HashMap<&str, Option<&str>> = links
        .iter()
        .map(|(id, survivor)| (id.as_str(), survivor.as_deref()))
        .collect();

    // A stored pair stands only while both lines read as they were measured.
    let current_level: HashSet<&str> = current
        .iter()
        .filter(|row| measured.current.get(&row.shown.id) == Some(&row.fingerprint))
        .map(|row| row.shown.id.as_str())
        .collect();
    let mut pairs_pending = current_level.len() < current.len();

    let mut pairs = Vec::new();
    let mut retired = Vec::with_capacity(retired_rows.len());
    for row in retired_rows {
        let RetiredRow {
            section, encoded, ..
        } = row;
        let Some((encoded, print)) = encoded else {
            retired.push(FfiRetiredMapSection {
                section,
                encoded_polyline: None,
            });
            continue;
        };
        let id = section.section_id.as_str();
        let ground = if measured.retired.get(id) == Some(&print) {
            stored.remove(id).unwrap_or_default()
        } else {
            pairs_pending = true;
            HashMap::new()
        };
        let survivor = chain_end(id, &into);
        for row in &current {
            let current_id = row.shown.id.as_str();
            let (link, overlap) = if survivor == Some(current_id) {
                (FfiRetiredPairLink::Ledger, None)
            } else if row.shown.superseded_by.as_deref() == Some(id) {
                (FfiRetiredPairLink::Supersedes, None)
            } else if let Some(&overlap) = ground
                .get(current_id)
                .filter(|_| current_level.contains(current_id))
            {
                (FfiRetiredPairLink::Ground, Some(overlap))
            } else {
                continue;
            };
            pairs.push(FfiRetiredMapPair {
                retired_id: id.to_string(),
                current_id: current_id.to_string(),
                link,
                overlap,
            });
        }
        retired.push(FfiRetiredMapSection {
            section,
            encoded_polyline: Some(encoded),
        });
    }

    // A restored section is live, so no retirement lists it, yet the auto
    // sections it hides keep their pair: Prefer on it is the way back.
    let restored = restored_live_ids(conn);
    for row in &current {
        let Some(by) = row.shown.superseded_by.as_deref() else {
            continue;
        };
        if restored.contains(by) {
            pairs.push(FfiRetiredMapPair {
                retired_id: by.to_string(),
                current_id: row.shown.id.clone(),
                link: FfiRetiredPairLink::Supersedes,
                overlap: None,
            });
        }
    }

    FfiRetiredMapData {
        retired,
        current: current.into_iter().map(|row| row.shown).collect(),
        pairs,
        pairs_pending,
    }
}

/// What one level pass measured: the lines it scanned with the fingerprints
/// they were scanned at, the lines that are gone, and the pairs found.
pub(crate) struct OwedPairs {
    retired: Vec<(String, i64)>,
    current: Vec<(String, i64)>,
    gone_retired: Vec<String>,
    gone_current: Vec<String>,
    pairs: Vec<(String, String, f64)>,
}

/// Measure every pair one of whose lines has moved since it was stored, or
/// `None` when the stored pairs are level with the lines. An empty table owes
/// every line, which is the full rebuild.
pub(crate) fn owed_pairs(conn: &Connection) -> Option<OwedPairs> {
    let retired: Vec<(String, Vec<GpsPoint>, i64)> = retired_rows(conn)
        .into_iter()
        .filter_map(|row| {
            let (_, print) = row.encoded?;
            Some((row.section.section_id, row.line, print))
        })
        .collect();
    let current = current_rows(conn);
    let measured = measured_lines(conn);

    let owed_retired: Vec<bool> = retired
        .iter()
        .map(|(id, _, print)| measured.retired.get(id) != Some(print))
        .collect();
    let owed_current: Vec<bool> = current
        .iter()
        .map(|row| measured.current.get(&row.shown.id) != Some(&row.fingerprint))
        .collect();
    let live_retired: HashSet<&str> = retired.iter().map(|(id, _, _)| id.as_str()).collect();
    let live_current: HashSet<&str> = current.iter().map(|row| row.shown.id.as_str()).collect();
    let gone_retired: Vec<String> = measured
        .retired
        .keys()
        .filter(|id| !live_retired.contains(id.as_str()))
        .cloned()
        .collect();
    let gone_current: Vec<String> = measured
        .current
        .keys()
        .filter(|id| !live_current.contains(id.as_str()))
        .cloned()
        .collect();
    if !owed_retired.contains(&true)
        && !owed_current.contains(&true)
        && gone_retired.is_empty()
        && gone_current.is_empty()
    {
        return None;
    }

    let current_boxes: Vec<PaddedBox> = current
        .iter()
        .map(|row| PaddedBox::of_line(&row.line))
        .collect();
    let mut pairs = Vec::new();
    for ((id, line, _), &retired_owed) in retired.iter().zip(&owed_retired) {
        let bounds = PaddedBox::of_line(line);
        for ((row, row_bounds), &current_owed) in
            current.iter().zip(&current_boxes).zip(&owed_current)
        {
            if !(retired_owed || current_owed) || !bounds.meets(row_bounds) {
                continue;
            }
            #[cfg(test)]
            GROUND_COMPARES.with(|c| c.set(c.get() + 1));
            let overlap = ground_overlap(line, &row.line);
            if overlap >= CARRY_COVERAGE {
                pairs.push((id.clone(), row.shown.id.clone(), overlap));
            }
        }
    }

    Some(OwedPairs {
        retired: retired
            .into_iter()
            .zip(owed_retired)
            .filter(|(_, owed)| *owed)
            .map(|((id, _, print), _)| (id, print))
            .collect(),
        current: current
            .into_iter()
            .zip(owed_current)
            .filter(|(_, owed)| *owed)
            .map(|(row, _)| (row.shown.id, row.fingerprint))
            .collect(),
        gone_retired,
        gone_current,
        pairs,
    })
}

/// Replace the pairs of every line a pass measured or found gone with what it
/// found. The caller holds the write transaction.
pub(crate) fn store_owed_pairs(conn: &Connection, owed: &OwedPairs) -> SqlResult<()> {
    let mut drop_retired =
        conn.prepare_cached("DELETE FROM retired_ground_pairs WHERE retired_id = ?")?;
    let mut drop_current =
        conn.prepare_cached("DELETE FROM retired_ground_pairs WHERE current_id = ?")?;
    let mut drop_line =
        conn.prepare_cached("DELETE FROM retired_ground_lines WHERE section_id = ? AND side = ?")?;
    let mut put_line = conn.prepare_cached(
        "INSERT OR REPLACE INTO retired_ground_lines (section_id, side, fingerprint)
         VALUES (?, ?, ?)",
    )?;
    let mut put_pair = conn.prepare_cached(
        "INSERT OR REPLACE INTO retired_ground_pairs (retired_id, current_id, overlap)
         VALUES (?, ?, ?)",
    )?;
    for id in &owed.gone_retired {
        drop_retired.execute([id])?;
        drop_line.execute(params![id, SIDE_RETIRED])?;
    }
    for id in &owed.gone_current {
        drop_current.execute([id])?;
        drop_line.execute(params![id, SIDE_CURRENT])?;
    }
    for (id, print) in &owed.retired {
        drop_retired.execute([id])?;
        put_line.execute(params![id, SIDE_RETIRED, print])?;
    }
    for (id, print) in &owed.current {
        drop_current.execute([id])?;
        put_line.execute(params![id, SIDE_CURRENT, print])?;
    }
    for (retired, current, overlap) in &owed.pairs {
        put_pair.execute(params![retired, current, overlap])?;
    }
    Ok(())
}

/// Passes one level runs at most. A line that moves while a pass measures is
/// owed again, and a second pass catches it; past that the next read that
/// finds pairs owed starts another level.
const MAX_PASSES: usize = 2;

/// Bring the stored pairs level on a connection of this call's own, outside
/// the engine lock, and say how many passes wrote. Each write is refused once
/// the library it was measured on has closed or moved.
pub(crate) fn level_at(install: u64, path: &str) -> SqlResult<usize> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    crate::persistence::apply_write_pragmas(&conn)?;
    let mut wrote = 0;
    for _ in 0..MAX_PASSES {
        let Some(owed) = owed_pairs(&conn) else { break };
        super::detection::worker_write(&conn, install, || store_owed_pairs(&conn, &owed))?;
        wrote += 1;
    }
    Ok(wrote)
}

/// Whether a level is in flight. Two at once would measure the same lines and
/// write the same rows, so the second does nothing instead.
static LEVEL_SLOT: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

/// The one level in flight. Dropping it frees the slot, however its holder ended.
struct LevelClaim(());

fn claim_level() -> Option<LevelClaim> {
    let mut held = LEVEL_SLOT.0.lock().unwrap_or_else(|e| e.into_inner());
    if *held {
        return None;
    }
    *held = true;
    Some(LevelClaim(()))
}

impl Drop for LevelClaim {
    fn drop(&mut self) {
        *LEVEL_SLOT.0.lock().unwrap_or_else(|e| e.into_inner()) = false;
        LEVEL_SLOT.1.notify_all();
    }
}

/// Whether a level holds the slot now, which a screen reads to know when to
/// look at the pairs again.
pub(crate) fn levelling() -> bool {
    *LEVEL_SLOT.0.lock().unwrap_or_else(|e| e.into_inner())
}

/// Wait until no level is in flight, and say whether that happened within `limit`.
#[cfg(test)]
pub(crate) fn wait_for_level(limit: Duration) -> bool {
    let held = LEVEL_SLOT.0.lock().unwrap_or_else(|e| e.into_inner());
    let (_held, wait) = LEVEL_SLOT
        .1
        .wait_timeout_while(held, limit, |held| *held)
        .unwrap_or_else(|e| e.into_inner());
    !wait.timed_out()
}

fn level_logged(install: u64, path: &str) {
    match level_at(install, path) {
        Ok(passes) if passes > 0 => {
            log::info!("[RetiredPairs] Levelled the ground pairs in {passes} passes")
        }
        Ok(_) => {}
        Err(e) => log::warn!("veloqrs: [RetiredPairs] Ground pairs not levelled: {e}"),
    }
}

/// Level the stored pairs on the calling thread, which is already off the JS
/// thread, unless a level is in flight.
pub(crate) fn level_now(install: u64, path: &str) {
    if let Some(_claim) = claim_level() {
        level_logged(install, path);
    }
}

/// Start a level on a thread of its own, unless one is in flight.
pub(crate) fn schedule_level(install: u64, path: String) {
    let Some(claim) = claim_level() else { return };
    crate::threads::spawn_background("veloq-ret-pairs", move || {
        level_logged(install, &path);
        drop(claim);
    });
}
