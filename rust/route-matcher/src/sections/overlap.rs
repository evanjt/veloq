//! Full track overlap detection and clustering.

use super::rtree::IndexedPoint;
use super::SectionConfig;
use crate::geo_utils::{compute_center, haversine_distance};
use crate::GpsPoint;
use rstar::{PointDistance, RTree};
use std::collections::HashSet;

/// A detected overlap between two full GPS tracks
#[derive(Debug, Clone)]
pub struct FullTrackOverlap {
    pub activity_a: String,
    pub activity_b: String,
    /// The actual GPS points from track A (for medoid selection)
    pub points_a: Vec<GpsPoint>,
    /// The actual GPS points from track B
    pub points_b: Vec<GpsPoint>,
    /// Center point for clustering
    pub center: GpsPoint,
}

/// A cluster of overlaps representing the same physical section
#[derive(Debug)]
pub struct OverlapCluster {
    /// All overlaps in this cluster
    pub overlaps: Vec<FullTrackOverlap>,
    /// Unique activity IDs in this cluster
    pub activity_ids: HashSet<String>,
}

/// Find overlapping portion between two FULL GPS tracks
pub fn find_full_track_overlap(
    activity_a: &str,
    track_a: &[GpsPoint],
    activity_b: &str,
    track_b: &[GpsPoint],
    tree_b: &RTree<IndexedPoint>,
    config: &SectionConfig,
) -> Option<FullTrackOverlap> {
    // Convert proximity threshold from meters to approximate degrees
    // 1 degree ≈ 111km, so 30m ≈ 0.00027 degrees
    let threshold_deg = config.proximity_threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    let mut best_start_a: Option<usize> = None;
    let mut best_end_a = 0;
    let mut best_min_b = usize::MAX;
    let mut best_max_b = 0;
    let mut best_length = 0.0;

    let mut current_start_a: Option<usize> = None;
    let mut current_min_b = usize::MAX;
    let mut current_max_b = 0;
    let mut current_length = 0.0;

    for (i, point_a) in track_a.iter().enumerate() {
        // Use R-tree to find nearest point in track B
        let query_point = [point_a.latitude, point_a.longitude];

        if let Some(nearest) = tree_b.nearest_neighbor(&query_point) {
            let dist_sq = nearest.distance_2(&query_point);

            if dist_sq <= threshold_deg_sq {
                // Point is within threshold
                if current_start_a.is_none() {
                    current_start_a = Some(i);
                    current_min_b = nearest.idx;
                    current_max_b = nearest.idx;
                    current_length = 0.0;
                } else {
                    current_min_b = current_min_b.min(nearest.idx);
                    current_max_b = current_max_b.max(nearest.idx);
                }

                // Accumulate distance
                if i > 0 {
                    current_length += haversine_distance(&track_a[i - 1], point_a);
                }
            } else {
                // Gap - check if current sequence is substantial
                if let Some(start_a) = current_start_a {
                    if current_length >= config.min_section_length && current_length > best_length {
                        best_start_a = Some(start_a);
                        best_end_a = i;
                        best_min_b = current_min_b;
                        best_max_b = current_max_b;
                        best_length = current_length;
                    }
                }
                current_start_a = None;
                current_length = 0.0;
                current_min_b = usize::MAX;
                current_max_b = 0;
            }
        }
    }

    // Check final sequence
    if let Some(start_a) = current_start_a {
        if current_length >= config.min_section_length && current_length > best_length {
            best_start_a = Some(start_a);
            best_end_a = track_a.len();
            best_min_b = current_min_b;
            best_max_b = current_max_b;
            // best_length not needed after this point
        }
    }

    // Build result if we found a substantial overlap
    best_start_a.map(|start_a| {
        let a_end = best_end_a;
        let b_start = best_min_b;
        let b_end = (best_max_b + 1).min(track_b.len());

        let points_a = track_a[start_a..a_end].to_vec();
        let points_b = track_b[b_start..b_end].to_vec();

        let center = compute_center(&points_a);

        FullTrackOverlap {
            activity_a: activity_a.to_string(),
            activity_b: activity_b.to_string(),
            points_a,
            points_b,
            center,
        }
    })
}

/// Cluster overlaps that represent the same physical section
pub fn cluster_overlaps(
    overlaps: Vec<FullTrackOverlap>,
    config: &SectionConfig,
) -> Vec<OverlapCluster> {
    if overlaps.is_empty() {
        return vec![];
    }

    let mut clusters: Vec<OverlapCluster> = Vec::new();
    let mut assigned: HashSet<usize> = HashSet::new();

    for (i, overlap) in overlaps.iter().enumerate() {
        if assigned.contains(&i) {
            continue;
        }

        // Start new cluster with this overlap
        let mut cluster_overlaps = vec![overlap.clone()];
        let mut cluster_activities: HashSet<String> = HashSet::new();
        cluster_activities.insert(overlap.activity_a.clone());
        cluster_activities.insert(overlap.activity_b.clone());
        assigned.insert(i);

        // Find other overlaps that belong to this cluster
        for (j, other) in overlaps.iter().enumerate() {
            if assigned.contains(&j) {
                continue;
            }

            // Check if centers are close enough
            let center_dist = haversine_distance(&overlap.center, &other.center);
            if center_dist <= config.cluster_tolerance {
                // Additional check: verify overlaps are geometrically similar
                if overlaps_match(
                    &overlap.points_a,
                    &other.points_a,
                    config.proximity_threshold,
                ) {
                    cluster_overlaps.push(other.clone());
                    cluster_activities.insert(other.activity_a.clone());
                    cluster_activities.insert(other.activity_b.clone());
                    assigned.insert(j);
                }
            }
        }

        clusters.push(OverlapCluster {
            overlaps: cluster_overlaps,
            activity_ids: cluster_activities,
        });
    }

    clusters
}

/// Check if two polylines overlap geometrically
fn overlaps_match(poly_a: &[GpsPoint], poly_b: &[GpsPoint], threshold: f64) -> bool {
    if poly_a.is_empty() || poly_b.is_empty() {
        return false;
    }

    // Sample points from poly_a and check how many are close to poly_b
    let sample_count = 10.min(poly_a.len());
    let step = poly_a.len() / sample_count;
    let mut matches = 0;

    for i in (0..poly_a.len()).step_by(step.max(1)).take(sample_count) {
        let point = &poly_a[i];
        // Find min distance to poly_b
        let min_dist = poly_b
            .iter()
            .map(|p| haversine_distance(point, p))
            .min_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(f64::MAX);

        if min_dist <= threshold {
            matches += 1;
        }
    }

    // Need at least 50% of samples to match
    matches >= sample_count / 2
}
