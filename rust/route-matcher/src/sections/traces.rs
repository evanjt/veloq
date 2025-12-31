//! Activity trace extraction from GPS tracks.

use std::collections::HashMap;
use rstar::{RTree, PointDistance};
use crate::GpsPoint;
use super::rtree::{IndexedPoint, build_rtree};

/// Distance threshold for considering a point "on" the section (meters)
const TRACE_PROXIMITY_THRESHOLD: f64 = 50.0;

/// Minimum points to consider a valid overlap trace
const MIN_TRACE_POINTS: usize = 3;

/// Extract the portion(s) of a GPS track that overlap with a section.
/// Returns ALL passes over the section (not just the longest) merged together.
/// This handles out-and-back routes where the activity crosses the section twice.
/// Uses R-tree for efficient O(log n) proximity lookups.
/// Tolerates small gaps (up to 3 points) due to GPS noise.
fn extract_activity_trace(
    track: &[GpsPoint],
    section_polyline: &[GpsPoint],
    polyline_tree: &RTree<IndexedPoint>,
) -> Vec<GpsPoint> {
    if track.len() < MIN_TRACE_POINTS || section_polyline.len() < 2 {
        return Vec::new();
    }

    // Convert threshold from meters to approximate degrees for R-tree comparison
    // Use a slightly larger threshold to catch GPS variations
    let threshold_deg = (TRACE_PROXIMITY_THRESHOLD * 1.2) / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    // Find ALL contiguous sequences of points near the section
    let mut sequences: Vec<Vec<GpsPoint>> = Vec::new();
    let mut current_sequence: Vec<GpsPoint> = Vec::new();
    let mut gap_count = 0;
    const MAX_GAP: usize = 3; // Allow small gaps due to GPS noise

    for point in track {
        let query = [point.latitude, point.longitude];

        // Use R-tree for O(log n) nearest neighbor lookup
        let is_near = if let Some(nearest) = polyline_tree.nearest_neighbor(&query) {
            nearest.distance_2(&query) <= threshold_deg_sq
        } else {
            false
        };

        if is_near {
            // Point is near section - reset gap counter
            gap_count = 0;
            current_sequence.push(point.clone());
        } else {
            gap_count += 1;
            // Allow small gaps but still add the point if we're in a sequence
            if gap_count <= MAX_GAP && !current_sequence.is_empty() {
                current_sequence.push(point.clone());
            } else if gap_count > MAX_GAP {
                // End current sequence if valid
                if current_sequence.len() >= MIN_TRACE_POINTS {
                    sequences.push(std::mem::take(&mut current_sequence));
                } else {
                    current_sequence.clear();
                }
                gap_count = 0;
            }
        }
    }

    // Don't forget the last sequence
    if current_sequence.len() >= MIN_TRACE_POINTS {
        sequences.push(current_sequence);
    }

    // Merge all sequences instead of just returning the longest
    // This captures both forward and reverse passes over the section
    if sequences.is_empty() {
        return Vec::new();
    }

    // If there's only one sequence, return it
    if sequences.len() == 1 {
        return sequences.into_iter().next().unwrap();
    }

    // Multiple sequences - merge them all
    // Sort sequences by their first point's position along the section
    // This helps visualization show the correct order
    let section_tree = build_rtree(section_polyline);

    // For each sequence, find where it starts on the section
    let mut sequence_with_position: Vec<(usize, Vec<GpsPoint>)> = sequences
        .into_iter()
        .map(|seq| {
            let start_pos = if let Some(first) = seq.first() {
                let query = [first.latitude, first.longitude];
                section_tree.nearest_neighbor(&query)
                    .map(|n| n.idx)
                    .unwrap_or(0)
            } else {
                0
            };
            (start_pos, seq)
        })
        .collect();

    // Sort by position on section
    sequence_with_position.sort_by_key(|(pos, _)| *pos);

    // Concatenate all sequences
    let mut merged: Vec<GpsPoint> = Vec::new();
    for (_, seq) in sequence_with_position {
        merged.extend(seq);
    }

    merged
}

/// Extract activity traces for all activities in a section.
/// Returns a map of activity_id -> overlapping GPS points
pub fn extract_all_activity_traces(
    activity_ids: &[String],
    section_polyline: &[GpsPoint],
    track_map: &HashMap<String, Vec<GpsPoint>>,
) -> HashMap<String, Vec<GpsPoint>> {
    let mut traces = HashMap::new();

    // Build R-tree once for the section polyline (O(n log n))
    let polyline_tree = build_rtree(section_polyline);

    for activity_id in activity_ids {
        if let Some(track) = track_map.get(activity_id) {
            let trace = extract_activity_trace(track, section_polyline, &polyline_tree);
            if !trace.is_empty() {
                traces.insert(activity_id.clone(), trace);
            }
        }
    }

    traces
}
