//! # Vector-First Section Detection (v2)
//!
//! Detects frequently-traveled road sections by analyzing GPS track overlaps directly,
//! rather than using grid-based clustering. This produces smooth, natural polylines
//! that are actual portions of real GPS tracks.
//!
//! ## Algorithm
//! 1. For each pair of activities (same sport), find overlapping portions
//! 2. An overlap is where tracks stay within proximity threshold for sustained distance
//! 3. Cluster overlaps that are geographically similar
//! 4. Keep clusters appearing in 3+ activities
//! 5. Use median of overlapping portions as section polyline
//!
//! This is fundamentally different from v1 which gridded all points into cells first.
//! Here we work with actual GPS coordinates throughout, only using spatial indexing
//! for efficiency, not for defining section shapes.

use std::collections::{HashMap, HashSet};
use crate::{GpsPoint, RouteSignature, RouteGroup};
use geo::{Point, Haversine, Distance};

/// Configuration for v2 section detection
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionConfigV2 {
    /// Maximum distance between tracks to consider overlapping (meters)
    pub proximity_threshold: f64,
    /// Minimum overlap length to consider a section (meters)
    pub min_section_length: f64,
    /// Minimum number of activities that must share an overlap
    pub min_activities: u32,
    /// Tolerance for clustering similar overlaps (meters)
    pub cluster_tolerance: f64,
    /// Number of sample points for polyline normalization
    pub sample_points: u32,
}

impl Default for SectionConfigV2 {
    fn default() -> Self {
        Self {
            proximity_threshold: 30.0,   // 30m - tight enough for road-level matching
            min_section_length: 200.0,   // 200m minimum section
            min_activities: 3,           // Need 3+ activities
            cluster_tolerance: 50.0,     // 50m for clustering similar overlaps
            sample_points: 50,           // Sample points for normalization
        }
    }
}

/// A detected track overlap between two activities
#[derive(Debug, Clone)]
struct TrackOverlap {
    /// First activity ID
    activity_a: String,
    /// Second activity ID
    activity_b: String,
    /// GPS points from activity A that overlap
    points_a: Vec<GpsPoint>,
    /// GPS points from activity B that overlap
    points_b: Vec<GpsPoint>,
    /// Estimated overlap length in meters
    length: f64,
    /// Center point of overlap (for spatial clustering)
    center: GpsPoint,
}

/// A cluster of overlapping track portions
#[derive(Debug, Clone)]
struct OverlapCluster {
    /// All overlaps in this cluster
    overlaps: Vec<TrackOverlap>,
    /// Activity IDs that have overlaps in this cluster
    activity_ids: HashSet<String>,
    /// Representative polyline (median of all overlaps)
    polyline: Vec<GpsPoint>,
    /// Estimated length in meters
    length: f64,
    /// Center point
    center: GpsPoint,
}

/// A frequently-traveled section (v2)
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct FrequentSectionV2 {
    /// Unique section ID
    pub id: String,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// Smooth polyline from actual GPS tracks
    pub polyline: Vec<GpsPoint>,
    /// Activity IDs that traverse this section
    pub activity_ids: Vec<String>,
    /// Route group IDs that include this section
    pub route_ids: Vec<String>,
    /// Number of times traversed
    pub visit_count: u32,
    /// Section length in meters
    pub distance_meters: f64,
}

/// Detect frequent sections using vector-first approach
pub fn detect_sections_v2(
    signatures: &[RouteSignature],
    groups: &[RouteGroup],
    sport_types: &HashMap<String, String>,
    config: &SectionConfigV2,
) -> Vec<FrequentSectionV2> {
    use log::info;
    info!("[SectionsV2] Detecting sections from {} signatures (vector-first)", signatures.len());

    if signatures.len() < config.min_activities as usize {
        return vec![];
    }

    // Build activity_id -> route_id mapping
    let activity_to_route: HashMap<&str, &str> = groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|aid| (aid.as_str(), g.group_id.as_str())))
        .collect();

    // Group signatures by sport type
    let mut sport_signatures: HashMap<String, Vec<&RouteSignature>> = HashMap::new();
    for sig in signatures {
        let sport = sport_types
            .get(&sig.activity_id)
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string());
        sport_signatures.entry(sport).or_default().push(sig);
    }

    let mut all_sections: Vec<FrequentSectionV2> = Vec::new();

    // Process each sport type
    for (sport_type, sigs) in &sport_signatures {
        if sigs.len() < config.min_activities as usize {
            continue;
        }

        // Find all pairwise overlaps
        let overlaps = find_pairwise_overlaps(sigs, config);
        info!("[SectionsV2] Found {} overlaps for {}", overlaps.len(), sport_type);

        if overlaps.is_empty() {
            continue;
        }

        // Cluster overlaps by geographic similarity
        let clusters = cluster_overlaps(&overlaps, config);
        info!("[SectionsV2] Clustered into {} groups", clusters.len());

        // Convert clusters to sections
        for (idx, cluster) in clusters.iter().enumerate() {
            if cluster.activity_ids.len() < config.min_activities as usize {
                continue;
            }

            // Get route IDs for activities in this section
            let route_ids: Vec<String> = cluster.activity_ids
                .iter()
                .filter_map(|aid| activity_to_route.get(aid.as_str()).map(|s| s.to_string()))
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();

            let section = FrequentSectionV2 {
                id: format!("sec2_{}_{}", sport_type.to_lowercase(), idx),
                sport_type: sport_type.clone(),
                polyline: cluster.polyline.clone(),
                activity_ids: cluster.activity_ids.iter().cloned().collect(),
                route_ids,
                visit_count: cluster.activity_ids.len() as u32,
                distance_meters: cluster.length,
            };

            all_sections.push(section);
        }
    }

    // Sort by visit count
    all_sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

    info!("[SectionsV2] Found {} frequent sections", all_sections.len());
    all_sections
}

/// Find overlapping portions between all pairs of tracks
fn find_pairwise_overlaps(
    signatures: &[&RouteSignature],
    config: &SectionConfigV2,
) -> Vec<TrackOverlap> {
    let mut overlaps = Vec::new();

    // Compare all pairs
    for i in 0..signatures.len() {
        for j in (i + 1)..signatures.len() {
            let sig_a = signatures[i];
            let sig_b = signatures[j];

            // Quick bounds check - skip if bounding boxes don't overlap
            if !bounds_overlap(&sig_a.bounds, &sig_b.bounds, config.proximity_threshold) {
                continue;
            }

            // Find overlapping portions
            if let Some(overlap) = find_track_overlap(sig_a, sig_b, config) {
                overlaps.push(overlap);
            }
        }
    }

    overlaps
}

/// Check if two bounding boxes overlap (with buffer)
fn bounds_overlap(a: &crate::Bounds, b: &crate::Bounds, buffer_meters: f64) -> bool {
    // Convert buffer to approximate degrees
    let buffer_deg = buffer_meters / 111_319.0;

    !(a.max_lat + buffer_deg < b.min_lat ||
      b.max_lat + buffer_deg < a.min_lat ||
      a.max_lng + buffer_deg < b.min_lng ||
      b.max_lng + buffer_deg < a.min_lng)
}

/// Find overlapping portion between two tracks using sliding window
fn find_track_overlap(
    sig_a: &RouteSignature,
    sig_b: &RouteSignature,
    config: &SectionConfigV2,
) -> Option<TrackOverlap> {
    // For each point in track A, find nearest point in track B
    // Track contiguous sequences where distance < threshold

    let mut best_overlap: Option<(Vec<usize>, Vec<usize>)> = None;
    let mut best_length = 0.0;

    let mut current_a_indices: Vec<usize> = Vec::new();
    let mut current_b_indices: Vec<usize> = Vec::new();
    let mut current_length = 0.0;

    for (i, point_a) in sig_a.points.iter().enumerate() {
        // Find nearest point in B
        let (nearest_j, min_dist) = find_nearest_point(point_a, &sig_b.points);

        if min_dist <= config.proximity_threshold {
            // Point is within threshold - add to current overlap
            current_a_indices.push(i);
            if !current_b_indices.contains(&nearest_j) {
                current_b_indices.push(nearest_j);
            }

            // Add distance from previous point
            if i > 0 && !current_a_indices.is_empty() {
                let prev_i = current_a_indices[current_a_indices.len().saturating_sub(2)];
                if prev_i < sig_a.points.len() {
                    current_length += haversine_distance(&sig_a.points[prev_i], point_a);
                }
            }
        } else {
            // Gap in overlap - check if current sequence is substantial
            if current_length >= config.min_section_length && current_length > best_length {
                best_overlap = Some((current_a_indices.clone(), current_b_indices.clone()));
                best_length = current_length;
            }
            current_a_indices.clear();
            current_b_indices.clear();
            current_length = 0.0;
        }
    }

    // Check final sequence
    if current_length >= config.min_section_length && current_length > best_length {
        best_overlap = Some((current_a_indices, current_b_indices));
        best_length = current_length;
    }

    // Convert to TrackOverlap
    best_overlap.map(|(a_indices, b_indices)| {
        let points_a: Vec<GpsPoint> = a_indices.iter()
            .map(|&i| sig_a.points[i].clone())
            .collect();
        let points_b: Vec<GpsPoint> = b_indices.iter()
            .filter(|&&i| i < sig_b.points.len())
            .map(|&i| sig_b.points[i].clone())
            .collect();

        let center = compute_center(&points_a);

        TrackOverlap {
            activity_a: sig_a.activity_id.clone(),
            activity_b: sig_b.activity_id.clone(),
            points_a,
            points_b,
            length: best_length,
            center,
        }
    })
}

/// Find nearest point in a list and return (index, distance)
fn find_nearest_point(target: &GpsPoint, points: &[GpsPoint]) -> (usize, f64) {
    let mut min_dist = f64::MAX;
    let mut min_idx = 0;

    for (i, point) in points.iter().enumerate() {
        let dist = haversine_distance(target, point);
        if dist < min_dist {
            min_dist = dist;
            min_idx = i;
        }
    }

    (min_idx, min_dist)
}

/// Compute center point of a polyline
fn compute_center(points: &[GpsPoint]) -> GpsPoint {
    if points.is_empty() {
        return GpsPoint::new(0.0, 0.0);
    }

    let sum_lat: f64 = points.iter().map(|p| p.latitude).sum();
    let sum_lng: f64 = points.iter().map(|p| p.longitude).sum();
    let n = points.len() as f64;

    GpsPoint::new(sum_lat / n, sum_lng / n)
}

/// Cluster overlaps by geographic similarity
fn cluster_overlaps(
    overlaps: &[TrackOverlap],
    config: &SectionConfigV2,
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

            // Check if this overlap is geographically similar
            let center_dist = haversine_distance(&overlap.center, &other.center);
            if center_dist <= config.cluster_tolerance {
                // Additional check: do the polylines actually overlap?
                if polylines_overlap(&overlap.points_a, &other.points_a, config.cluster_tolerance) {
                    cluster_overlaps.push(other.clone());
                    cluster_activities.insert(other.activity_a.clone());
                    cluster_activities.insert(other.activity_b.clone());
                    assigned.insert(j);
                }
            }
        }

        // Build cluster
        let polyline = build_median_polyline(&cluster_overlaps, config.sample_points as usize);
        let length = compute_polyline_length(&polyline);
        let center = compute_center(&polyline);

        clusters.push(OverlapCluster {
            overlaps: cluster_overlaps,
            activity_ids: cluster_activities,
            polyline,
            length,
            center,
        });
    }

    clusters
}

/// Check if two polylines overlap geographically
fn polylines_overlap(a: &[GpsPoint], b: &[GpsPoint], tolerance: f64) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }

    // Check if any points in A are within tolerance of any points in B
    let mut matches = 0;
    let check_count = a.len().min(10); // Sample up to 10 points
    let step = a.len() / check_count.max(1);

    for i in (0..a.len()).step_by(step.max(1)) {
        let (_, dist) = find_nearest_point(&a[i], b);
        if dist <= tolerance {
            matches += 1;
        }
    }

    // Need at least 50% of sampled points to match
    matches >= check_count / 2
}

/// Build median polyline from multiple overlaps
fn build_median_polyline(overlaps: &[TrackOverlap], num_samples: usize) -> Vec<GpsPoint> {
    if overlaps.is_empty() {
        return vec![];
    }

    if overlaps.len() == 1 {
        // Just return the first track's points, simplified
        return simplify_polyline(&overlaps[0].points_a, num_samples);
    }

    // Collect all point sequences, normalized to same direction
    let mut all_points: Vec<Vec<GpsPoint>> = Vec::new();

    // Use first overlap as reference direction
    let ref_start = &overlaps[0].points_a[0];
    let ref_end = &overlaps[0].points_a[overlaps[0].points_a.len() - 1];

    for overlap in overlaps {
        // Add points from track A
        let points_a = normalize_direction(&overlap.points_a, ref_start, ref_end);
        all_points.push(points_a);

        // Add points from track B
        let points_b = normalize_direction(&overlap.points_b, ref_start, ref_end);
        all_points.push(points_b);
    }

    // Resample all to same number of points
    let resampled: Vec<Vec<GpsPoint>> = all_points
        .iter()
        .map(|pts| resample_polyline(pts, num_samples))
        .collect();

    // Compute median at each sample point
    let mut median = Vec::with_capacity(num_samples);
    for i in 0..num_samples {
        let mut lats: Vec<f64> = Vec::new();
        let mut lngs: Vec<f64> = Vec::new();

        for poly in &resampled {
            if i < poly.len() {
                lats.push(poly[i].latitude);
                lngs.push(poly[i].longitude);
            }
        }

        if !lats.is_empty() {
            lats.sort_by(|a, b| a.partial_cmp(b).unwrap());
            lngs.sort_by(|a, b| a.partial_cmp(b).unwrap());

            median.push(GpsPoint::new(
                lats[lats.len() / 2],
                lngs[lngs.len() / 2],
            ));
        }
    }

    // Apply smoothing
    smooth_polyline(&median, 3)
}

/// Normalize polyline direction to match reference
fn normalize_direction(points: &[GpsPoint], ref_start: &GpsPoint, ref_end: &GpsPoint) -> Vec<GpsPoint> {
    if points.len() < 2 {
        return points.to_vec();
    }

    let start = &points[0];
    let end = &points[points.len() - 1];

    // Check if going same direction (start near ref_start, end near ref_end)
    let same_dir = haversine_distance(start, ref_start) + haversine_distance(end, ref_end);
    let reverse_dir = haversine_distance(start, ref_end) + haversine_distance(end, ref_start);

    if reverse_dir < same_dir {
        // Reverse the points
        points.iter().rev().cloned().collect()
    } else {
        points.to_vec()
    }
}

/// Resample polyline to fixed number of points
fn resample_polyline(points: &[GpsPoint], num_samples: usize) -> Vec<GpsPoint> {
    if points.len() < 2 || num_samples < 2 {
        return points.to_vec();
    }

    // Compute cumulative distances
    let mut cumulative = vec![0.0];
    for i in 1..points.len() {
        let d = haversine_distance(&points[i - 1], &points[i]);
        cumulative.push(cumulative.last().unwrap() + d);
    }

    let total_length = *cumulative.last().unwrap();
    if total_length < 1.0 {
        return points.to_vec();
    }

    let mut resampled = Vec::with_capacity(num_samples);
    for i in 0..num_samples {
        let target_dist = (i as f64 / (num_samples - 1) as f64) * total_length;

        // Find segment
        let mut seg_idx = 0;
        for j in 1..cumulative.len() {
            if cumulative[j] >= target_dist {
                seg_idx = j - 1;
                break;
            }
            seg_idx = j - 1;
        }

        // Interpolate
        let seg_start = cumulative[seg_idx];
        let seg_end = cumulative.get(seg_idx + 1).copied().unwrap_or(seg_start);
        let seg_len = seg_end - seg_start;

        let t = if seg_len > 0.001 {
            (target_dist - seg_start) / seg_len
        } else {
            0.0
        };

        let p1 = &points[seg_idx];
        let p2 = points.get(seg_idx + 1).unwrap_or(p1);

        resampled.push(GpsPoint::new(
            p1.latitude + t * (p2.latitude - p1.latitude),
            p1.longitude + t * (p2.longitude - p1.longitude),
        ));
    }

    resampled
}

/// Simplify polyline to target number of points
fn simplify_polyline(points: &[GpsPoint], target: usize) -> Vec<GpsPoint> {
    if points.len() <= target {
        return points.to_vec();
    }

    // Simple uniform sampling for now
    let step = points.len() / target;
    points.iter()
        .step_by(step.max(1))
        .take(target)
        .cloned()
        .collect()
}

/// Smooth polyline with moving average
fn smooth_polyline(points: &[GpsPoint], window: usize) -> Vec<GpsPoint> {
    if points.len() <= window {
        return points.to_vec();
    }

    let half = window / 2;
    let mut smoothed = Vec::with_capacity(points.len());

    for i in 0..points.len() {
        let start = i.saturating_sub(half);
        let end = (i + half + 1).min(points.len());
        let count = (end - start) as f64;

        let avg_lat: f64 = points[start..end].iter().map(|p| p.latitude).sum::<f64>() / count;
        let avg_lng: f64 = points[start..end].iter().map(|p| p.longitude).sum::<f64>() / count;

        smoothed.push(GpsPoint::new(avg_lat, avg_lng));
    }

    smoothed
}

/// Compute polyline length in meters
fn compute_polyline_length(points: &[GpsPoint]) -> f64 {
    if points.len() < 2 {
        return 0.0;
    }

    points.windows(2)
        .map(|w| haversine_distance(&w[0], &w[1]))
        .sum()
}

/// Haversine distance between two points in meters
fn haversine_distance(p1: &GpsPoint, p2: &GpsPoint) -> f64 {
    let point1 = Point::new(p1.longitude, p1.latitude);
    let point2 = Point::new(p2.longitude, p2.latitude);
    Haversine::distance(point1, point2)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_point(lat: f64, lng: f64) -> GpsPoint {
        GpsPoint::new(lat, lng)
    }

    #[test]
    fn test_haversine_distance() {
        let p1 = make_point(51.5, -0.1);
        let p2 = make_point(51.501, -0.1);
        let dist = haversine_distance(&p1, &p2);
        // ~111m per 0.001 degree latitude
        assert!(dist > 100.0 && dist < 120.0);
    }

    #[test]
    fn test_resample_polyline() {
        let points = vec![
            make_point(51.5, -0.1),
            make_point(51.501, -0.1),
            make_point(51.502, -0.1),
            make_point(51.503, -0.1),
        ];

        let resampled = resample_polyline(&points, 10);
        assert_eq!(resampled.len(), 10);

        // First and last should be close to original
        assert!((resampled[0].latitude - 51.5).abs() < 0.0001);
        assert!((resampled[9].latitude - 51.503).abs() < 0.0001);
    }

    #[test]
    fn test_normalize_direction() {
        let forward = vec![
            make_point(51.5, -0.1),
            make_point(51.501, -0.1),
            make_point(51.502, -0.1),
        ];

        let backward = vec![
            make_point(51.502, -0.1),
            make_point(51.501, -0.1),
            make_point(51.5, -0.1),
        ];

        let ref_start = make_point(51.5, -0.1);
        let ref_end = make_point(51.502, -0.1);

        let normalized = normalize_direction(&backward, &ref_start, &ref_end);

        // Should now start near ref_start
        assert!((normalized[0].latitude - 51.5).abs() < 0.001);
    }
}
