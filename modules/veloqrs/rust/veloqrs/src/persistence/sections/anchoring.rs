//! Giving the athlete's own 0.3.x sections a reference triple.
//!
//! 0.3.x stored an accepted or trimmed section as a line with no range into any
//! stream. The flip's re-cut leaves those rows alone, so without this pass they
//! would keep an averaged line for the life of the install. Each one is placed
//! on its representative's own track (or a member's, when that is gone), after
//! which the line is a slice of a stored stream like every other.

use rusqlite::{Connection, params};
use tracematch::GpsPoint;
use tracematch::geo_utils::haversine_distance;
use tracematch::matching::calculate_route_distance;

use crate::persistence::PersistentEngine;
use crate::persistence::sections::geometry;
use crate::persistence::sections::history::{
    KIND_REFERENCE_ANCHORED, SOURCE_CONSENSUS, append_history_on, milestone_prior_geometry_on,
    pooled::pinned_section_version, record_archived_geometry_on,
};

/// The rows the pass owns: a detected section the athlete has accepted or
/// trimmed, still on a line that belongs to no stream. An anchored row stops
/// matching, which is what makes the pass rerunnable.
const UNANCHORED_USER_OWNED: &str = concat!(
    "section_type = 'auto' AND (is_user_defined = 1 OR ",
    super::has_original_line!(),
    ") AND rep_start_index IS NULL \
     AND COALESCE(geometry_source, 'consensus') = 'consensus'"
);

/// Whether any section is owed the pass, on a connection that holds no engine lock.
pub(crate) fn anchoring_owed(conn: &Connection) -> bool {
    conn.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM sections WHERE {UNANCHORED_USER_OWNED})"),
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|n| n == 1)
    .unwrap_or(false)
}

/// Where a line sits on a track, as inclusive indices.
struct Placement {
    start: usize,
    end: usize,
    /// The drawn line changes: it is the track's slice, not the line it had.
    moved: bool,
}

/// Indices that are the closest approach of `track` to `target` on each pass
/// within `threshold` metres, in track order.
fn pass_minima(track: &[GpsPoint], target: &GpsPoint, threshold: f64) -> Vec<usize> {
    let mut minima = Vec::new();
    let mut best: Option<(usize, f64)> = None;
    for (index, point) in track.iter().enumerate() {
        let distance = haversine_distance(point, target);
        if distance <= threshold {
            if best.is_none_or(|(_, closest)| distance < closest) {
                best = Some((index, distance));
            }
        } else if let Some((found, _)) = best.take() {
            minima.push(found);
        }
    }
    minima.extend(best.map(|(found, _)| found));
    minima
}

/// The slice of `track` whose ends are nearest the ends of `line`, both within
/// `threshold`. A track that passes an end more than once gives several pairs,
/// and the one whose length is closest to `wanted` metres wins, the earlier on a tie.
fn nearest_slice(
    track: &[GpsPoint],
    line: &[GpsPoint],
    threshold: f64,
    wanted: f64,
) -> Option<(usize, usize)> {
    let starts = pass_minima(track, line.first()?, threshold);
    let ends = pass_minima(track, line.last()?, threshold);
    let mut along = Vec::with_capacity(track.len());
    let mut total = 0.0;
    for (index, point) in track.iter().enumerate() {
        if index > 0 {
            total += haversine_distance(&track[index - 1], point);
        }
        along.push(total);
    }
    let mut best: Option<(f64, usize, usize)> = None;
    for &start in &starts {
        for &end in ends.iter().filter(|&&end| end > start) {
            let cost = ((along[end] - along[start]) - wanted).abs();
            if best.is_none_or(|(closest, _, _)| cost < closest) {
                best = Some((cost, start, end));
            }
        }
    }
    best.map(|(_, start, end)| (start, end))
}

fn place(track: &[GpsPoint], line: &[GpsPoint], wanted: f64) -> Option<Placement> {
    if let Some((start, end)) = geometry::locate_slice(track, line) {
        return Some(Placement {
            start: start as usize,
            end: end as usize,
            moved: false,
        });
    }
    let threshold = tracematch::SectionConfig::default().proximity_threshold;
    let (start, end) = nearest_slice(track, line, threshold, wanted)?;
    Some(Placement {
        start,
        end,
        moved: true,
    })
}

impl PersistentEngine {
    /// Anchor every accepted or trimmed detected section that has no reference
    /// triple. Returns how many rows were anchored; a row no stored track covers
    /// is left as it was and met again by the next run.
    pub(crate) fn anchor_user_owned_references(&mut self) -> Result<usize, String> {
        let ids: Vec<String> = {
            let mut stmt = self
                .db
                .prepare(&format!(
                    "SELECT id FROM sections WHERE {UNANCHORED_USER_OWNED} ORDER BY id"
                ))
                .map_err(|e| e.to_string())?;
            stmt.query_map([], |row| row.get(0))
                .and_then(|rows| rows.collect::<rusqlite::Result<_>>())
                .map_err(|e| e.to_string())?
        };
        if ids.is_empty() {
            return Ok(0);
        }

        let mut anchored: Vec<(String, bool)> = Vec::new();
        let done = self.in_write_txn(|e| {
            for id in &ids {
                if let Some(moved) = e.anchor_one_reference(id)? {
                    anchored.push((id.clone(), moved));
                }
            }
            Ok(())
        });
        for (id, moved) in &anchored {
            // A moved line has new ground to match, and the records and badges
            // that rode the old one follow it.
            if *moved && done.is_ok() {
                self.rebuild_matches_after_anchor(id);
            }
            self.resync_section_after_edit(id, done.is_err());
        }
        done.map(|()| anchored.len())
    }

    fn rebuild_matches_after_anchor(&mut self, section_id: &str) {
        let Ok(line) = self.stored_section_polyline(section_id) else {
            return;
        };
        let rebuilt = self.in_write_txn(|e| e.rebuild_section_junctions(section_id, &line));
        if let Err(e) = rebuilt {
            log::warn!(
                "veloqrs: [anchoring] re-matching {} failed: {}",
                section_id,
                e
            );
        }
    }

    /// Anchor one row. `Some(moved)` when it was, `None` when no track covers it.
    fn anchor_one_reference(&mut self, section_id: &str) -> Result<Option<bool>, String> {
        let (representative, wanted): (Option<String>, f64) = self
            .db
            .query_row(
                "SELECT representative_activity_id, distance_meters FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let Some(outgoing) = self
            .stored_section_polyline(section_id)
            .ok()
            .filter(|line| line.len() >= 2)
        else {
            return Ok(None);
        };

        // The representative first, then the members in the order a re-anchor
        // tries them: closest pass length, then id.
        let skip = representative.clone().unwrap_or_default();
        let members: Vec<String> = {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT activity_id FROM section_activities
                     WHERE section_id = ? AND activity_id <> ? AND excluded = 0
                     ORDER BY abs(COALESCE(distance_meters, 0) - ?) ASC, activity_id ASC",
                )
                .map_err(|e| e.to_string())?;
            stmt.query_map(params![section_id, skip, wanted], |row| row.get(0))
                .and_then(|rows| rows.collect::<rusqlite::Result<_>>())
                .map_err(|e| e.to_string())?
        };
        let found = representative
            .into_iter()
            .chain(members)
            .find_map(|activity_id| {
                let track = geometry::stream(&self.db, &activity_id)?;
                let placement = place(&track, &outgoing, wanted)?;
                Some((activity_id, track, placement))
            });
        let Some((activity_id, track, placement)) = found else {
            log::info!(
                "veloqrs: [anchoring] no stored track covers section {}; left as it was",
                section_id
            );
            return Ok(None);
        };
        let Placement { start, end, moved } = placement;
        let polyline = if moved {
            track[start..=end].to_vec()
        } else {
            outgoing.clone()
        };
        // The reference's end is half-open where the slice is inclusive.
        let triple = (activity_id.as_str(), start as u32, end as u32 + 1);

        let pinned = pinned_section_version(&self.db, section_id);
        milestone_prior_geometry_on(&self.db, section_id, Some(&outgoing))
            .map_err(|e| e.to_string())?;
        let version = record_archived_geometry_on(&self.db, section_id, &polyline, Some(triple))
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Section {section_id} has no line to anchor"))?;

        // A pin on the averaged baseline would keep drawing the average.
        if let Some(pin) = pinned {
            let source: Option<String> = self
                .db
                .query_row(
                    "SELECT source FROM section_geometry WHERE section_id = ? AND version = ?",
                    params![section_id, pin],
                    |row| row.get(0),
                )
                .ok();
            if source.as_deref() == Some(SOURCE_CONSENSUS) {
                self.db
                    .execute(
                        "UPDATE section_pins SET version = ? WHERE section_id = ?",
                        params![version, section_id],
                    )
                    .map_err(|e| e.to_string())?;
            }
        }

        if moved {
            let bounds = tracematch::geo_utils::compute_bounds(&polyline);
            self.db
                .execute(
                    "UPDATE sections SET
                         polyline_json = ?, polyline_blob = ?, distance_meters = ?,
                         updated_at = ?, representative_activity_id = ?,
                         rep_start_index = ?, rep_end_index = ?, geometry_source = 'exact',
                         bounds_min_lat = ?, bounds_max_lat = ?,
                         bounds_min_lng = ?, bounds_max_lng = ?
                     WHERE id = ?",
                    params![
                        crate::persistence::codec::NO_POLYLINE_JSON,
                        crate::persistence::codec::serialize_track_points(&polyline),
                        calculate_route_distance(&polyline),
                        chrono::Utc::now().to_rfc3339(),
                        triple.0,
                        triple.1,
                        triple.2,
                        bounds.min_lat,
                        bounds.max_lat,
                        bounds.min_lng,
                        bounds.max_lng,
                        section_id
                    ],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.db
                .execute(
                    "UPDATE sections SET
                         representative_activity_id = ?, rep_start_index = ?,
                         rep_end_index = ?, geometry_source = 'exact'
                     WHERE id = ?",
                    params![triple.0, triple.1, triple.2, section_id],
                )
                .map_err(|e| e.to_string())?;
        }

        let details = serde_json::json!({
            "activity": triple.0,
            "start_index": triple.1,
            "end_index": triple.2,
            "moved": moved,
        })
        .to_string();
        append_history_on(
            &self.db,
            section_id,
            KIND_REFERENCE_ANCHORED,
            Some(&details),
            Some(version),
            None,
        )
        .map_err(|e| e.to_string())?;
        Ok(Some(moved))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(count: usize) -> Vec<GpsPoint> {
        (0..count)
            .map(|i| GpsPoint {
                latitude: 46.0 + i as f64 * 0.000_1,
                longitude: 7.0,
                elevation: None,
            })
            .collect()
    }

    /// Scenario: a track out and back over the same ground, so each end of the
    /// line is passed twice.
    /// Expected behaviour: the pair whose length is nearest the row's distance wins.
    #[test]
    fn a_track_that_passes_an_end_twice_gives_the_pair_nearest_the_row_distance() {
        let mut out_and_back = track(40);
        out_and_back.extend(track(40).into_iter().rev());
        let line = track(40)[10..20].to_vec();
        let one_way = calculate_route_distance(&line);

        let (start, end) = nearest_slice(&out_and_back, &line, 5.0, one_way).expect("a pair");
        assert_eq!((start, end), (10, 19));

        let (start, end) = nearest_slice(&out_and_back, &line, 5.0, one_way * 7.0).expect("a pair");
        assert!(
            start < 40 && end >= 40,
            "the long way round: {start}..{end}"
        );
    }

    /// Scenario: the line ends nowhere near the track.
    /// Expected behaviour: no placement.
    #[test]
    fn a_line_off_the_track_is_not_placed() {
        let far: Vec<GpsPoint> = track(10)
            .into_iter()
            .map(|p| GpsPoint {
                longitude: 9.0,
                ..p
            })
            .collect();
        assert!(nearest_slice(&track(40), &far, 200.0, 100.0).is_none());
    }
}
