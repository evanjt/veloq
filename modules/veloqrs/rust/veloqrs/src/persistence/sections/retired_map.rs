//! The old-versus-new sections map: every retired section with its newest
//! decodable line, every catalogue row visible or not, and the pairs between
//! them with the reason each is shown together.
//!
//! The pairing is the detector's own: two lines share ground when
//! [`shares_ground`] says so, the rule that suppresses a fresh auto section
//! over ground an athlete already owns. A bounding-box prefilter keeps a
//! retired line from being compared with sections nowhere near it.

use super::history::pooled as history;
use crate::{
    FfiCurrentMapSection, FfiRetiredMapData, FfiRetiredMapPair, FfiRetiredMapSection,
    FfiRetiredPairLink,
};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use tracematch::GpsPoint;
use tracematch::sections::{GROUND_TOL_M, coverage_and_offset, shares_ground};

#[cfg(test)]
thread_local! {
    /// How many whole-line ground comparisons this thread has made, each a
    /// resample and a coverage scan of two lines.
    pub(crate) static GROUND_COMPARES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
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
    fn around(min_lat: f64, max_lat: f64, min_lng: f64, max_lng: f64) -> Self {
        let pad_lat = GROUND_TOL_M / 111_000.0;
        let mid = ((min_lat + max_lat) * 0.5).to_radians();
        let pad_lng = GROUND_TOL_M / (111_320.0 * mid.cos().abs().max(0.01));
        Self {
            min_lat: min_lat - pad_lat,
            max_lat: max_lat + pad_lat,
            min_lng: min_lng - pad_lng,
            max_lng: max_lng + pad_lng,
        }
    }

    fn of_line(line: &[GpsPoint]) -> Self {
        let b = tracematch::geo_utils::compute_bounds(line);
        Self::around(b.min_lat, b.max_lat, b.min_lng, b.max_lng)
    }

    fn meets(&self, other: &Self) -> bool {
        self.min_lat <= other.max_lat
            && other.min_lat <= self.max_lat
            && self.min_lng <= other.max_lng
            && other.min_lng <= self.max_lng
    }
}

struct CurrentRow {
    shown: FfiCurrentMapSection,
    line: Vec<GpsPoint>,
    bounds: PaddedBox,
}

/// Every catalogue row with a line that decodes. A row's stored bounds are the
/// prefilter; one that carries none takes its own line's.
fn current_rows(conn: &Connection) -> Vec<CurrentRow> {
    let names = super::named::pooled::overlay_names(conn);
    let pinned: HashSet<String> = super::pooled::pinned_section_ids(conn)
        .into_iter()
        .collect();
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, name, is_user_defined, disabled, superseded_by,
                polyline_blob, polyline_json, representative_activity_id,
                rep_start_index, rep_end_index,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
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
        let stored: [Option<f64>; 4] = [row.get(10)?, row.get(11)?, row.get(12)?, row.get(13)?];
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
            stored,
        ))
    });
    let Ok(rows) = rows else { return Vec::new() };
    rows.flatten()
        .filter(|(_, _, _, _, _, line, _)| line.len() >= 2)
        .map(
            |(id, name, is_user_defined, disabled, superseded_by, line, stored)| {
                let bounds = match stored {
                    [Some(a), Some(b), Some(c), Some(d)] => PaddedBox::around(a, b, c, d),
                    _ => PaddedBox::of_line(&line),
                };
                CurrentRow {
                    shown: FfiCurrentMapSection {
                        name: name.or_else(|| names.get(&id).cloned()),
                        is_user_defined,
                        pinned: pinned.contains(&id),
                        hidden: disabled || superseded_by.is_some(),
                        superseded_by,
                        encoded_polyline: crate::persistence::codec::encode_polyline(&line),
                        id,
                    },
                    line,
                    bounds,
                }
            },
        )
        .collect()
}

/// A retired section's newest stored version that decodes.
fn newest_line(
    conn: &Connection,
    section_id: &str,
    versions: &[crate::WholeNumber],
) -> Vec<GpsPoint> {
    versions
        .iter()
        .rev()
        .filter_map(|v| history::section_geometry_version(conn, section_id, v.0))
        .map(|(points, _)| points)
        .find(|points| points.len() >= 2)
        .unwrap_or_default()
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

/// The larger of the two coverage fractions of a pair known to share ground.
fn ground_overlap(a: &[GpsPoint], b: &[GpsPoint]) -> f64 {
    coverage_and_offset(a, b).0.max(coverage_and_offset(b, a).0)
}

pub(crate) fn retired_map_data(conn: &Connection) -> FfiRetiredMapData {
    #[cfg(test)]
    RETIRED_MAP_BUILDS.with(|builds| builds.set(builds.get() + 1));

    let retired_sections = history::retired_sections(conn);
    let current = current_rows(conn);
    let into: HashMap<&str, Option<&str>> = retired_sections
        .iter()
        .map(|r| (r.section_id.as_str(), r.into.as_deref()))
        .collect();

    let mut pairs = Vec::new();
    let mut retired = Vec::with_capacity(retired_sections.len());
    for section in &retired_sections {
        let line = newest_line(conn, &section.section_id, &section.versions);
        if line.is_empty() {
            retired.push(FfiRetiredMapSection {
                section: section.clone(),
                encoded_polyline: None,
            });
            continue;
        }
        let bounds = PaddedBox::of_line(&line);
        let survivor = chain_end(&section.section_id, &into);
        for row in &current {
            let id = row.shown.id.as_str();
            let (link, overlap) = if survivor == Some(id) {
                (FfiRetiredPairLink::Ledger, None)
            } else if row.shown.superseded_by.as_deref() == Some(section.section_id.as_str()) {
                (FfiRetiredPairLink::Supersedes, None)
            } else if bounds.meets(&row.bounds) {
                #[cfg(test)]
                GROUND_COMPARES.with(|c| c.set(c.get() + 1));
                if !shares_ground(&line, &row.line) {
                    continue;
                }
                (
                    FfiRetiredPairLink::Ground,
                    Some(ground_overlap(&line, &row.line)),
                )
            } else {
                continue;
            };
            pairs.push(FfiRetiredMapPair {
                retired_id: section.section_id.clone(),
                current_id: row.shown.id.clone(),
                link,
                overlap,
            });
        }
        retired.push(FfiRetiredMapSection {
            section: section.clone(),
            encoded_polyline: Some(crate::persistence::codec::encode_polyline(&line)),
        });
    }

    FfiRetiredMapData {
        retired,
        current: current.into_iter().map(|row| row.shown).collect(),
        pairs,
    }
}
