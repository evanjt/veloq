//! Activity portion computation for pace comparison.

use std::collections::HashMap;
use rstar::{RTree, PointDistance};
use crate::GpsPoint;
use crate::geo_utils::polyline_length;
use super::rtree::{IndexedPoint, build_rtree};
use super::overlap::OverlapCluster;
use super::{SectionConfig, SectionPortion};

/// Compute each activity's portion of a section
pub fn compute_activity_portions(
    cluster: &OverlapCluster,
    representative_polyline: &[GpsPoint],
    all_tracks: &HashMap<String, Vec<GpsPoint>>,
    config: &SectionConfig,
) -> Vec<SectionPortion> {
    let mut portions = Vec::new();

    for activity_id in &cluster.activity_ids {
        if let Some(track) = all_tracks.get(activity_id) {
            // Find the portion of this track that overlaps with the representative
            if let Some((start_idx, end_idx, direction)) = find_track_portion(
                track,
                representative_polyline,
                config.proximity_threshold,
            ) {
                let distance = polyline_length(&track[start_idx..end_idx]);

                portions.push(SectionPortion {
                    activity_id: activity_id.clone(),
                    start_index: start_idx as u32,
                    end_index: end_idx as u32,
                    distance_meters: distance,
                    direction,
                });
            }
        }
    }

    portions
}

/// A contiguous segment of a track that overlaps with the reference
struct OverlapSegment {
    start_idx: usize,
    end_idx: usize,
    distance: f64,
}

/// Find the portion of a track that overlaps with a reference polyline.
/// Returns the segment that best matches the section length, not just any overlap.
fn find_track_portion(
    track: &[GpsPoint],
    reference: &[GpsPoint],
    threshold: f64,
) -> Option<(usize, usize, String)> {
    if track.is_empty() || reference.is_empty() {
        return None;
    }

    let ref_tree = build_rtree(reference);
    let threshold_deg = threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;
    let ref_length = polyline_length(reference);

    // Find all contiguous overlapping segments
    let mut segments: Vec<OverlapSegment> = Vec::new();
    let mut current_start: Option<usize> = None;
    let mut gap_count = 0;
    const MAX_GAP: usize = 3; // Allow small gaps for GPS noise

    for (i, point) in track.iter().enumerate() {
        let query = [point.latitude, point.longitude];

        let is_near = ref_tree
            .nearest_neighbor(&query)
            .map(|nearest| nearest.distance_2(&query) <= threshold_deg_sq)
            .unwrap_or(false);

        if is_near {
            if current_start.is_none() {
                current_start = Some(i);
            }
            gap_count = 0;
        } else if current_start.is_some() {
            gap_count += 1;
            if gap_count > MAX_GAP {
                // End this segment
                let start = current_start.unwrap();
                let end = i - gap_count;
                if end > start {
                    let distance = polyline_length(&track[start..end]);
                    segments.push(OverlapSegment {
                        start_idx: start,
                        end_idx: end,
                        distance,
                    });
                }
                current_start = None;
                gap_count = 0;
            }
        }
    }

    // Handle final segment
    if let Some(start) = current_start {
        let end = track.len() - gap_count.min(track.len() - start - 1);
        if end > start {
            let distance = polyline_length(&track[start..end]);
            segments.push(OverlapSegment {
                start_idx: start,
                end_idx: end,
                distance,
            });
        }
    }

    if segments.is_empty() {
        return None;
    }

    // Select the best segment:
    // 1. Distance should be close to section length (within 50% tolerance)
    // 2. If multiple segments match, pick the one closest to section length
    let tolerance = 0.5; // 50% tolerance
    let min_dist = ref_length * (1.0 - tolerance);
    let max_dist = ref_length * (1.0 + tolerance);

    // First try to find segments within tolerance
    let mut best_segment: Option<&OverlapSegment> = None;
    let mut best_diff = f64::MAX;

    for segment in &segments {
        if segment.distance >= min_dist && segment.distance <= max_dist {
            let diff = (segment.distance - ref_length).abs();
            if diff < best_diff {
                best_diff = diff;
                best_segment = Some(segment);
            }
        }
    }

    // If no segment within tolerance, pick the closest one to section length
    // (but only if it's at least 50% of the section length)
    if best_segment.is_none() {
        for segment in &segments {
            if segment.distance >= ref_length * 0.5 {
                let diff = (segment.distance - ref_length).abs();
                if diff < best_diff {
                    best_diff = diff;
                    best_segment = Some(segment);
                }
            }
        }
    }

    best_segment.map(|seg| {
        let direction = detect_direction_robust(
            &track[seg.start_idx..seg.end_idx],
            reference,
            &ref_tree,
        );
        (seg.start_idx, seg.end_idx, direction)
    })
}

/// Detect direction by sampling multiple points along the track and checking
/// their positions on the reference polyline. More robust than just comparing endpoints.
fn detect_direction_robust(
    track_portion: &[GpsPoint],
    reference: &[GpsPoint],
    ref_tree: &RTree<IndexedPoint>,
) -> String {
    if track_portion.len() < 3 || reference.len() < 3 {
        return "same".to_string();
    }

    // Sample 5 points along the track portion
    let sample_count = 5.min(track_portion.len());
    let step = track_portion.len() / sample_count;

    let mut ref_indices: Vec<usize> = Vec::with_capacity(sample_count);

    for i in 0..sample_count {
        let track_idx = (i * step).min(track_portion.len() - 1);
        let point = &track_portion[track_idx];
        let query = [point.latitude, point.longitude];

        if let Some(nearest) = ref_tree.nearest_neighbor(&query) {
            ref_indices.push(nearest.idx);
        }
    }

    if ref_indices.len() < 2 {
        return "same".to_string();
    }

    // Count how many times consecutive samples go forward vs backward on the reference
    let mut forward_count = 0;
    let mut backward_count = 0;

    for i in 1..ref_indices.len() {
        let prev_idx = ref_indices[i - 1];
        let curr_idx = ref_indices[i];

        if curr_idx > prev_idx {
            forward_count += 1;
        } else if curr_idx < prev_idx {
            backward_count += 1;
        }
        // Equal indices don't count (could be same point, noise)
    }

    if backward_count > forward_count {
        "reverse".to_string()
    } else {
        "same".to_string()
    }
}
