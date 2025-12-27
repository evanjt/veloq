//! # Adaptive Consensus Section Detection
//!
//! Detects frequently-traveled road sections using FULL GPS tracks.
//! Produces smooth, natural polylines that evolve and refine over time
//! as more tracks are observed.
//!
//! ## Algorithm
//! 1. Load full GPS tracks (1000s of points per activity)
//! 2. Find overlapping portions using R-tree spatial indexing
//! 3. Cluster overlaps that represent the same physical section
//! 4. Select initial medoid as the starting reference
//! 5. Compute consensus polyline via weighted averaging of all tracks
//! 6. Track per-point confidence based on observation density
//! 7. Adapt section boundaries based on where tracks consistently overlap
//!
//! ## Consensus Algorithm
//! - Normalize all tracks to common parameterization (by distance)
//! - At each position, collect nearby points from all tracks
//! - Compute weighted average: weight = 1 / (distance_to_reference + epsilon)
//! - Higher observation density → higher confidence → tighter future matching
//!
//! ## Adaptive Boundaries
//! - Track where each activity's overlap starts/ends relative to section
//! - Section can grow if tracks consistently extend beyond current bounds
//! - Section contracts if tracks consistently end before current bounds

use std::collections::{HashMap, HashSet};
use crate::{GpsPoint, RouteGroup};
use crate::geo_utils::{haversine_distance, compute_bounds, compute_center, polyline_length, bounds_overlap};
use rstar::{RTree, RTreeObject, PointDistance, AABB};
#[cfg(feature = "parallel")]
use rayon::prelude::*;
use log::info;

/// Configuration for section detection
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionConfig {
    /// Maximum distance between tracks to consider overlapping (meters)
    pub proximity_threshold: f64,
    /// Minimum overlap length to consider a section (meters)
    pub min_section_length: f64,
    /// Maximum section length (meters) - prevents sections from becoming full routes
    pub max_section_length: f64,
    /// Minimum number of activities that must share an overlap
    pub min_activities: u32,
    /// Tolerance for clustering similar overlaps (meters)
    pub cluster_tolerance: f64,
    /// Number of sample points for AMD comparison (not for output!)
    pub sample_points: u32,
}

impl Default for SectionConfig {
    fn default() -> Self {
        Self {
            proximity_threshold: 50.0,   // 50m - handles GPS error + wide roads + opposite sides
            min_section_length: 200.0,   // 200m minimum section
            max_section_length: 5000.0,  // 5km max - longer is likely a route, not a section
            min_activities: 3,           // Need 3+ activities
            cluster_tolerance: 80.0,     // 80m for clustering similar overlaps
            sample_points: 50,           // For AMD comparison only
        }
    }
}

/// Each activity's portion of a section (for pace comparison)
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionPortion {
    /// Activity ID
    pub activity_id: String,
    /// Start index into the activity's FULL GPS track
    pub start_index: u32,
    /// End index into the activity's FULL GPS track
    pub end_index: u32,
    /// Distance of this portion in meters
    pub distance_meters: f64,
    /// Direction relative to representative: "same" or "reverse"
    pub direction: String,
}

/// A frequently-traveled section with adaptive consensus representation
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct FrequentSection {
    /// Unique section ID
    pub id: String,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// The consensus polyline - refined from all overlapping tracks
    /// Initially the medoid, evolves via weighted averaging as more tracks are added
    pub polyline: Vec<GpsPoint>,
    /// Which activity provided the initial representative polyline (medoid)
    pub representative_activity_id: String,
    /// All activity IDs that traverse this section
    pub activity_ids: Vec<String>,
    /// Each activity's portion (start/end indices, distance, direction)
    pub activity_portions: Vec<SectionPortion>,
    /// Route group IDs that include this section
    pub route_ids: Vec<String>,
    /// Number of times traversed
    pub visit_count: u32,
    /// Section length in meters
    pub distance_meters: f64,
    /// Pre-computed GPS traces for each activity's overlapping portion
    /// Key is activity ID, value is the GPS points within proximity of section
    pub activity_traces: HashMap<String, Vec<GpsPoint>>,
    /// Confidence score (0.0-1.0) based on observation density
    /// Higher confidence = more tracks observed, tighter consensus
    pub confidence: f64,
    /// Number of observations (tracks) used to compute consensus
    pub observation_count: u32,
    /// Average spread (meters) of track observations from consensus line
    /// Lower spread = more consistent track alignment
    pub average_spread: f64,
    /// Per-point observation density (how many activities pass through each point)
    /// Used for detecting high-traffic portions that should become separate sections
    pub point_density: Vec<u32>,
}

// =============================================================================
// R-tree Indexed Point for Spatial Queries
// =============================================================================

/// A GPS point with its index for R-tree queries
#[derive(Debug, Clone, Copy)]
struct IndexedPoint {
    idx: usize,
    lat: f64,
    lng: f64,
}

impl RTreeObject for IndexedPoint {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_point([self.lat, self.lng])
    }
}

impl PointDistance for IndexedPoint {
    fn distance_2(&self, point: &[f64; 2]) -> f64 {
        let dlat = self.lat - point[0];
        let dlng = self.lng - point[1];
        dlat * dlat + dlng * dlng
    }
}

// =============================================================================
// Full Track Overlap Detection
// =============================================================================

/// A detected overlap between two full GPS tracks
#[derive(Debug, Clone)]
struct FullTrackOverlap {
    activity_a: String,
    activity_b: String,
    /// The actual GPS points from track A (for medoid selection)
    points_a: Vec<GpsPoint>,
    /// The actual GPS points from track B
    points_b: Vec<GpsPoint>,
    /// Center point for clustering
    center: GpsPoint,
}

/// Build R-tree from GPS points for efficient spatial queries
fn build_rtree(points: &[GpsPoint]) -> RTree<IndexedPoint> {
    let indexed: Vec<IndexedPoint> = points.iter()
        .enumerate()
        .map(|(i, p)| IndexedPoint {
            idx: i,
            lat: p.latitude,
            lng: p.longitude
        })
        .collect();
    RTree::bulk_load(indexed)
}

/// Find overlapping portion between two FULL GPS tracks
fn find_full_track_overlap(
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
            best_length = current_length;
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

// =============================================================================
// Overlap Clustering
// =============================================================================

/// A cluster of overlaps representing the same physical section
#[derive(Debug)]
struct OverlapCluster {
    /// All overlaps in this cluster
    overlaps: Vec<FullTrackOverlap>,
    /// Unique activity IDs in this cluster
    activity_ids: HashSet<String>,
}

/// Cluster overlaps that represent the same physical section
fn cluster_overlaps(
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
                if overlaps_match(&overlap.points_a, &other.points_a, config.proximity_threshold) {
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
        let min_dist = poly_b.iter()
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

// =============================================================================
// Medoid Selection - The Key Innovation
// =============================================================================

/// Select the medoid trace from a cluster.
/// The medoid is the actual GPS trace with minimum total AMD to all other traces.
/// This ensures we return REAL GPS points, not artificial interpolations.
fn select_medoid(cluster: &OverlapCluster) -> (String, Vec<GpsPoint>) {
    // Collect all unique activity portions in this cluster
    let mut traces: Vec<(&str, &[GpsPoint])> = Vec::new();

    for overlap in &cluster.overlaps {
        // Add both sides of each overlap
        if !traces.iter().any(|(id, _)| *id == overlap.activity_a) {
            traces.push((&overlap.activity_a, &overlap.points_a));
        }
        if !traces.iter().any(|(id, _)| *id == overlap.activity_b) {
            traces.push((&overlap.activity_b, &overlap.points_b));
        }
    }

    if traces.is_empty() {
        return (String::new(), Vec::new());
    }

    if traces.len() == 1 {
        return (traces[0].0.to_string(), traces[0].1.to_vec());
    }

    // For small clusters, compute full pairwise AMD
    // For larger clusters (>10), use approximate method
    let use_full_pairwise = traces.len() <= 10;

    let mut best_idx = 0;
    let mut best_total_amd = f64::MAX;

    if use_full_pairwise {
        // Compute AMD for each trace to all others
        for (i, (_, trace_i)) in traces.iter().enumerate() {
            let mut total_amd = 0.0;

            for (j, (_, trace_j)) in traces.iter().enumerate() {
                if i != j {
                    total_amd += average_min_distance(trace_i, trace_j);
                }
            }

            if total_amd < best_total_amd {
                best_total_amd = total_amd;
                best_idx = i;
            }
        }
    } else {
        // Approximate: compare each to a random sample of 5 others
        let sample_size = 5.min(traces.len() - 1);

        for (i, (_, trace_i)) in traces.iter().enumerate() {
            let mut total_amd = 0.0;
            let mut count = 0;

            // Sample evenly distributed traces
            let step = traces.len() / sample_size;
            for j in (0..traces.len()).step_by(step.max(1)).take(sample_size) {
                if i != j {
                    total_amd += average_min_distance(trace_i, traces[j].1);
                    count += 1;
                }
            }

            if count > 0 {
                let avg_amd = total_amd / count as f64;
                if avg_amd < best_total_amd {
                    best_total_amd = avg_amd;
                    best_idx = i;
                }
            }
        }
    }

    (traces[best_idx].0.to_string(), traces[best_idx].1.to_vec())
}

/// Average Minimum Distance between two polylines
fn average_min_distance(poly_a: &[GpsPoint], poly_b: &[GpsPoint]) -> f64 {
    if poly_a.is_empty() || poly_b.is_empty() {
        return f64::MAX;
    }

    // Resample both to same number of points for fair comparison
    let n = 50;
    let resampled_a = resample_by_distance(poly_a, n);
    let resampled_b = resample_by_distance(poly_b, n);

    // Compute AMD from A to B
    let mut sum_a_to_b = 0.0;
    for point_a in &resampled_a {
        let min_dist = resampled_b.iter()
            .map(|p| haversine_distance(point_a, p))
            .min_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(0.0);
        sum_a_to_b += min_dist;
    }

    // Compute AMD from B to A
    let mut sum_b_to_a = 0.0;
    for point_b in &resampled_b {
        let min_dist = resampled_a.iter()
            .map(|p| haversine_distance(point_b, p))
            .min_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(0.0);
        sum_b_to_a += min_dist;
    }

    // Average of both directions
    (sum_a_to_b + sum_b_to_a) / (2.0 * n as f64)
}

/// Resample polyline to N points by distance
fn resample_by_distance(points: &[GpsPoint], n: usize) -> Vec<GpsPoint> {
    if points.len() <= n {
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

    let mut resampled = Vec::with_capacity(n);
    for i in 0..n {
        let target_dist = (i as f64 / (n - 1) as f64) * total_length;

        // Find segment containing target distance
        let mut seg_idx = 0;
        for j in 1..cumulative.len() {
            if cumulative[j] >= target_dist {
                seg_idx = j - 1;
                break;
            }
            seg_idx = j - 1;
        }

        // Interpolate within segment
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

// =============================================================================
// Activity Portion Computation
// =============================================================================

/// Compute each activity's portion of a section
fn compute_activity_portions(
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

/// Find the portion of a track that overlaps with a reference polyline
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

    let mut start_idx: Option<usize> = None;
    let mut end_idx = 0;
    let mut in_overlap = false;

    for (i, point) in track.iter().enumerate() {
        let query = [point.latitude, point.longitude];

        if let Some(nearest) = ref_tree.nearest_neighbor(&query) {
            let dist_sq = nearest.distance_2(&query);

            if dist_sq <= threshold_deg_sq {
                if !in_overlap {
                    start_idx = Some(i);
                    in_overlap = true;
                }
                end_idx = i + 1;
            } else if in_overlap {
                // Gap - but continue to find longest overlap
                in_overlap = false;
            }
        }
    }

    start_idx.map(|start| {
        let direction = detect_direction_robust(
            &track[start..end_idx],
            reference,
            &ref_tree,
        );
        (start, end_idx, direction)
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

// =============================================================================
// Cluster Processing Helper
// =============================================================================

/// Process a single cluster into a FrequentSection.
/// Extracted as a helper to support both parallel and sequential execution.
fn process_cluster(
    idx: usize,
    cluster: OverlapCluster,
    sport_type: &str,
    track_map: &HashMap<String, Vec<GpsPoint>>,
    activity_to_route: &HashMap<&str, &str>,
    config: &SectionConfig,
) -> Option<FrequentSection> {
    // Select medoid - an ACTUAL GPS trace
    let (representative_id, representative_polyline) = select_medoid(&cluster);

    if representative_polyline.is_empty() {
        return None;
    }

    let distance_meters = polyline_length(&representative_polyline);

    // Filter by max length - sections shouldn't be whole routes
    if distance_meters > config.max_section_length {
        return None;
    }

    // Compute activity portions for pace comparison
    let activity_portions = compute_activity_portions(
        &cluster,
        &representative_polyline,
        track_map,
        config,
    );

    // Collect route IDs
    let route_ids: Vec<String> = cluster.activity_ids
        .iter()
        .filter_map(|aid| activity_to_route.get(aid.as_str()).map(|s| s.to_string()))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    // Pre-compute activity traces
    let activity_id_vec: Vec<String> = cluster.activity_ids.iter().cloned().collect();
    let activity_traces = extract_all_activity_traces(
        &activity_id_vec,
        &representative_polyline,
        track_map,
    );

    // Collect all traces for consensus computation
    let all_traces: Vec<Vec<GpsPoint>> = activity_traces.values().cloned().collect();

    // Compute consensus polyline from all overlapping tracks
    let consensus = compute_consensus_polyline(
        &representative_polyline,
        &all_traces,
        config.proximity_threshold,
    );

    // Use consensus polyline and update distance
    let consensus_distance = polyline_length(&consensus.polyline);

    Some(FrequentSection {
        id: format!("sec_{}_{}", sport_type.to_lowercase(), idx),
        sport_type: sport_type.to_string(),
        polyline: consensus.polyline,
        representative_activity_id: representative_id,
        activity_ids: cluster.activity_ids.into_iter().collect(),
        activity_portions,
        route_ids,
        visit_count: cluster.overlaps.len() as u32 + 1,
        distance_meters: consensus_distance,
        activity_traces,
        confidence: consensus.confidence,
        observation_count: consensus.observation_count,
        average_spread: consensus.average_spread,
        point_density: consensus.point_density,
    })
}

// =============================================================================
// Main Entry Point
// =============================================================================

/// Detect frequent sections from FULL GPS tracks.
/// This is the main entry point for section detection.
pub fn detect_sections_from_tracks(
    tracks: &[(String, Vec<GpsPoint>)],  // (activity_id, full_gps_points)
    sport_types: &HashMap<String, String>,
    groups: &[RouteGroup],
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    info!(
        "[Sections] Detecting from {} full GPS tracks",
        tracks.len()
    );

    if tracks.len() < config.min_activities as usize {
        return vec![];
    }

    // Filter to only groups with 2+ activities (these are the ones shown in Routes list)
    let significant_groups: Vec<&RouteGroup> = groups
        .iter()
        .filter(|g| g.activity_ids.len() >= 2)
        .collect();

    // Build activity_id -> route_id mapping (only for significant groups)
    let activity_to_route: HashMap<&str, &str> = significant_groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|aid| (aid.as_str(), g.group_id.as_str())))
        .collect();

    // Debug: log the groups we received
    info!(
        "[Sections] Received {} groups, {} with 2+ activities, {} total activity mappings",
        groups.len(),
        significant_groups.len(),
        activity_to_route.len()
    );

    // Build track lookup
    let track_map: HashMap<String, Vec<GpsPoint>> = tracks
        .iter()
        .map(|(id, pts)| (id.clone(), pts.clone()))
        .collect();

    // Group tracks by sport type
    let mut tracks_by_sport: HashMap<String, Vec<(&str, &[GpsPoint])>> = HashMap::new();
    for (activity_id, points) in tracks {
        let sport = sport_types
            .get(activity_id)
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string());
        tracks_by_sport
            .entry(sport)
            .or_default()
            .push((activity_id.as_str(), points.as_slice()));
    }

    let mut all_sections: Vec<FrequentSection> = Vec::new();
    let mut section_counter = 0;

    // Process each sport type
    for (sport_type, sport_tracks) in &tracks_by_sport {
        if sport_tracks.len() < config.min_activities as usize {
            continue;
        }

        info!(
            "[Sections] Processing {} {} tracks",
            sport_tracks.len(),
            sport_type
        );

        // Build R-trees for all tracks
        let rtree_start = std::time::Instant::now();
        let rtrees: Vec<RTree<IndexedPoint>> = sport_tracks
            .iter()
            .map(|(_, pts)| build_rtree(pts))
            .collect();
        info!("[Sections] Built {} R-trees in {}ms", rtrees.len(), rtree_start.elapsed().as_millis());

        // Find pairwise overlaps - PARALLELIZED with rayon
        let overlap_start = std::time::Instant::now();

        // Generate all pairs
        let pairs: Vec<(usize, usize)> = (0..sport_tracks.len())
            .flat_map(|i| ((i + 1)..sport_tracks.len()).map(move |j| (i, j)))
            .collect();

        let total_pairs = pairs.len();

        // Process pairs (parallel if feature enabled)
        #[cfg(feature = "parallel")]
        let overlaps: Vec<FullTrackOverlap> = pairs
            .into_par_iter()
            .filter_map(|(i, j)| {
                let (id_a, track_a) = sport_tracks[i];
                let (id_b, track_b) = sport_tracks[j];

                // Quick bounding box check
                if !bounds_overlap_tracks(track_a, track_b, config.proximity_threshold) {
                    return None;
                }

                // Find overlap using R-tree
                find_full_track_overlap(
                    id_a, track_a,
                    id_b, track_b,
                    &rtrees[j],
                    config,
                )
            })
            .collect();

        #[cfg(not(feature = "parallel"))]
        let overlaps: Vec<FullTrackOverlap> = pairs
            .into_iter()
            .filter_map(|(i, j)| {
                let (id_a, track_a) = sport_tracks[i];
                let (id_b, track_b) = sport_tracks[j];

                // Quick bounding box check
                if !bounds_overlap_tracks(track_a, track_b, config.proximity_threshold) {
                    return None;
                }

                // Find overlap using R-tree
                find_full_track_overlap(
                    id_a, track_a,
                    id_b, track_b,
                    &rtrees[j],
                    config,
                )
            })
            .collect();

        info!(
            "[Sections] Found {} pairwise overlaps for {} ({} pairs) in {}ms",
            overlaps.len(),
            sport_type,
            total_pairs,
            overlap_start.elapsed().as_millis()
        );

        // Cluster overlaps
        let cluster_start = std::time::Instant::now();
        let clusters = cluster_overlaps(overlaps, config);

        // Filter to clusters with enough activities
        let significant_clusters: Vec<_> = clusters
            .into_iter()
            .filter(|c| c.activity_ids.len() >= config.min_activities as usize)
            .collect();

        info!(
            "[Sections] {} significant clusters ({}+ activities) for {} in {}ms",
            significant_clusters.len(),
            config.min_activities,
            sport_type,
            cluster_start.elapsed().as_millis()
        );

        // Convert clusters to sections - PARALLELIZED with rayon
        let section_convert_start = std::time::Instant::now();

        // Prepare data for parallel processing
        let cluster_data: Vec<_> = significant_clusters
            .into_iter()
            .enumerate()
            .collect();

        // Process clusters (parallel if feature enabled)
        #[cfg(feature = "parallel")]
        let sport_sections: Vec<FrequentSection> = cluster_data
            .into_par_iter()
            .filter_map(|(idx, cluster)| {
                process_cluster(idx, cluster, &sport_type, &track_map, &activity_to_route, config)
            })
            .collect();

        #[cfg(not(feature = "parallel"))]
        let sport_sections: Vec<FrequentSection> = cluster_data
            .into_iter()
            .filter_map(|(idx, cluster)| {
                process_cluster(idx, cluster, &sport_type, &track_map, &activity_to_route, config)
            })
            .collect();

        info!(
            "[Sections] Converted {} sections for {} in {}ms",
            sport_sections.len(),
            sport_type,
            section_convert_start.elapsed().as_millis()
        );

        // Post-process step 1: Split sections that fold back on themselves (out-and-back)
        let fold_start = std::time::Instant::now();
        let split_sections = split_folding_sections(sport_sections, config);
        info!(
            "[Sections] After fold splitting: {} sections in {}ms",
            split_sections.len(),
            fold_start.elapsed().as_millis()
        );

        // Post-process step 2: Merge sections that are nearby (reversed, parallel, GPS drift)
        let merge_start = std::time::Instant::now();
        let merged_sections = merge_nearby_sections(split_sections, config);
        info!(
            "[Sections] After nearby merge: {} sections in {}ms",
            merged_sections.len(),
            merge_start.elapsed().as_millis()
        );

        // Post-process step 3: Remove sections that contain or are contained by others
        let dedup_start = std::time::Instant::now();
        let deduped_sections = remove_overlapping_sections(merged_sections, config);
        info!(
            "[Sections] After dedup: {} unique sections in {}ms",
            deduped_sections.len(),
            dedup_start.elapsed().as_millis()
        );

        // Post-process step 4: Split sections with high-traffic portions
        // This creates new sections from portions that are used by many activities
        let split_start = std::time::Instant::now();
        let final_sections = split_high_variance_sections(deduped_sections, &track_map, config);
        info!(
            "[Sections] After density splitting: {} sections in {}ms",
            final_sections.len(),
            split_start.elapsed().as_millis()
        );

        // Re-number sections
        for (i, mut section) in final_sections.into_iter().enumerate() {
            section.id = format!("sec_{}_{}", sport_type.to_lowercase(), section_counter + i);
            all_sections.push(section);
        }
        section_counter += all_sections.len();
    }

    // Sort by visit count (most visited first)
    all_sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

    info!(
        "[Sections] Detected {} total sections",
        all_sections.len()
    );

    all_sections
}

// =============================================================================
// Legacy API Compatibility
// =============================================================================

/// Legacy entry point using RouteSignatures (for backwards compatibility)
/// This wraps the new algorithm but uses pre-simplified points
pub fn detect_frequent_sections(
    signatures: &[crate::RouteSignature],
    groups: &[RouteGroup],
    sport_types: &HashMap<String, String>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    // Convert signatures to tracks format
    let tracks: Vec<(String, Vec<GpsPoint>)> = signatures
        .iter()
        .map(|sig| (sig.activity_id.clone(), sig.points.clone()))
        .collect();

    detect_sections_from_tracks(&tracks, sport_types, groups, config)
}

// =============================================================================
// Consensus Polyline Computation
// =============================================================================

/// Result of consensus computation including confidence metrics
struct ConsensusResult {
    /// The refined consensus polyline
    polyline: Vec<GpsPoint>,
    /// Confidence score (0.0-1.0)
    confidence: f64,
    /// Number of tracks that contributed
    observation_count: u32,
    /// Average spread of observations from consensus (meters)
    average_spread: f64,
    /// Per-point observation count (how many tracks contributed to each point)
    point_density: Vec<u32>,
}

/// Compute a consensus polyline from multiple overlapping tracks.
/// Uses weighted averaging where weight = 1 / (distance_to_reference + epsilon).
///
/// Algorithm:
/// 1. Normalize each track to distance parameterization
/// 2. For each position along the reference, find nearby points from all tracks
/// 3. Compute weighted centroid of nearby points
/// 4. Track observation density for confidence scoring
fn compute_consensus_polyline(
    reference: &[GpsPoint],
    all_traces: &[Vec<GpsPoint>],
    proximity_threshold: f64,
) -> ConsensusResult {
    if reference.is_empty() || all_traces.is_empty() {
        return ConsensusResult {
            polyline: reference.to_vec(),
            confidence: 0.0,
            observation_count: 0,
            average_spread: 0.0,
            point_density: vec![0; reference.len()],
        };
    }

    // Build R-trees for all traces for efficient spatial queries
    let trace_trees: Vec<RTree<IndexedPoint>> = all_traces
        .iter()
        .map(|trace| build_rtree(trace))
        .collect();

    let threshold_deg = proximity_threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;
    let epsilon = 0.000001; // Small constant to avoid division by zero

    let mut consensus_points = Vec::with_capacity(reference.len());
    let mut point_density = Vec::with_capacity(reference.len());
    let mut total_spread = 0.0;
    let mut total_point_observations = 0u32;

    for ref_point in reference {
        let ref_coords = [ref_point.latitude, ref_point.longitude];

        // Collect nearby points from all traces
        let mut weighted_lat = 0.0;
        let mut weighted_lng = 0.0;
        let mut total_weight = 0.0;
        let mut nearby_distances: Vec<f64> = Vec::new();
        let mut this_point_observations = 0u32;

        for (trace_idx, tree) in trace_trees.iter().enumerate() {
            if let Some(nearest) = tree.nearest_neighbor(&ref_coords) {
                let dist_sq = nearest.distance_2(&ref_coords);

                if dist_sq <= threshold_deg_sq {
                    // Point is within threshold - include in weighted average
                    let trace = &all_traces[trace_idx];
                    let trace_point = &trace[nearest.idx];

                    // Weight inversely proportional to distance
                    let dist_deg = dist_sq.sqrt();
                    let dist_meters = dist_deg * 111_000.0;
                    let weight = 1.0 / (dist_meters + epsilon);

                    weighted_lat += trace_point.latitude * weight;
                    weighted_lng += trace_point.longitude * weight;
                    total_weight += weight;
                    nearby_distances.push(dist_meters);
                    this_point_observations += 1;
                }
            }
        }

        // Track per-point density
        point_density.push(this_point_observations);

        if total_weight > 0.0 {
            // Compute weighted centroid
            let consensus_lat = weighted_lat / total_weight;
            let consensus_lng = weighted_lng / total_weight;
            consensus_points.push(GpsPoint::new(consensus_lat, consensus_lng));

            // Track spread (average distance of observations from consensus)
            if !nearby_distances.is_empty() {
                let avg_dist: f64 = nearby_distances.iter().sum::<f64>() / nearby_distances.len() as f64;
                total_spread += avg_dist;
                total_point_observations += nearby_distances.len() as u32;
            }
        } else {
            // No nearby points - keep reference point
            consensus_points.push(ref_point.clone());
        }
    }

    // Compute overall metrics
    let observation_count = trace_trees.len() as u32;
    let average_spread = if total_point_observations > 0 {
        total_spread / (reference.len() as f64)
    } else {
        proximity_threshold // Default to max threshold if no observations
    };

    // Confidence based on observation count and spread
    // More observations + tighter spread = higher confidence
    let obs_factor = (observation_count as f64).min(10.0) / 10.0; // Saturates at 10 observations
    let spread_factor = 1.0 - (average_spread / proximity_threshold).min(1.0); // Lower spread = higher factor
    let confidence = (obs_factor * 0.5 + spread_factor * 0.5).min(1.0).max(0.0);

    ConsensusResult {
        polyline: consensus_points,
        confidence,
        observation_count,
        average_spread,
        point_density,
    }
}

// =============================================================================
// Density-Based Section Splitting
// =============================================================================
//
// Based on concepts from:
// - TRACLUS: "Trajectory Clustering: A Partition-and-Group Framework" (Lee, Han, Whang 2007)
//   https://hanj.cs.illinois.edu/pdf/sigmod07_jglee.pdf
// - GPS Segment Averaging (MDPI 2019)
//   https://mdpi.com/2076-3417/9/22/4899/htm
//
// The algorithm detects when part of a section has significantly higher traffic
// than the rest, indicating it should become its own section for better insights.

/// Minimum density ratio to trigger a split (high-traffic portion / endpoint density)
const SPLIT_DENSITY_RATIO: f64 = 2.0;

/// Minimum length (meters) for a split portion to become its own section
const MIN_SPLIT_LENGTH: f64 = 100.0;

/// Minimum number of points in a high-density region to consider splitting
const MIN_SPLIT_POINTS: usize = 10;

/// Result of analyzing a section for potential splits
#[derive(Debug)]
struct SplitCandidate {
    /// Start index of the high-density portion
    start_idx: usize,
    /// End index of the high-density portion
    end_idx: usize,
    /// Average density in this portion
    avg_density: f64,
    /// Density ratio compared to endpoints
    density_ratio: f64,
}

/// Analyze a section's point density to find high-traffic portions.
/// Returns split candidates if the section should be divided.
fn find_split_candidates(section: &FrequentSection) -> Vec<SplitCandidate> {
    let density = &section.point_density;

    if density.len() < MIN_SPLIT_POINTS * 2 {
        return vec![]; // Too short to split meaningfully
    }

    // Compute endpoint density (average of first/last 10% of points)
    let endpoint_window = (density.len() / 10).max(3);
    let start_density: f64 = density[..endpoint_window].iter().map(|&d| d as f64).sum::<f64>()
        / endpoint_window as f64;
    let end_density: f64 = density[density.len() - endpoint_window..].iter().map(|&d| d as f64).sum::<f64>()
        / endpoint_window as f64;
    let endpoint_density = (start_density + end_density) / 2.0;

    if endpoint_density < 1.0 {
        return vec![]; // No meaningful endpoint density to compare against
    }

    // Sliding window to find high-density regions
    let window_size = (density.len() / 5).max(MIN_SPLIT_POINTS);
    let mut candidates = Vec::new();

    let mut i = window_size;
    while i < density.len() - window_size {
        // Compute density in current window
        let window_density: f64 = density[i - window_size / 2..i + window_size / 2]
            .iter()
            .map(|&d| d as f64)
            .sum::<f64>() / window_size as f64;

        let ratio = window_density / endpoint_density;

        if ratio >= SPLIT_DENSITY_RATIO {
            // Found a high-density region - expand to find boundaries
            let mut start_idx = i - window_size / 2;
            let mut end_idx = i + window_size / 2;

            // Expand start backward while density remains high
            while start_idx > 0 {
                let local_density = density[start_idx - 1] as f64;
                if local_density < endpoint_density * 1.5 {
                    break;
                }
                start_idx -= 1;
            }

            // Expand end forward while density remains high
            while end_idx < density.len() - 1 {
                let local_density = density[end_idx + 1] as f64;
                if local_density < endpoint_density * 1.5 {
                    break;
                }
                end_idx += 1;
            }

            // Compute distance of this portion
            let portion_distance = if end_idx > start_idx {
                polyline_length(&section.polyline[start_idx..=end_idx])
            } else {
                0.0
            };

            // Only consider if long enough
            if portion_distance >= MIN_SPLIT_LENGTH && end_idx - start_idx >= MIN_SPLIT_POINTS {
                let portion_density: f64 = density[start_idx..=end_idx]
                    .iter()
                    .map(|&d| d as f64)
                    .sum::<f64>() / (end_idx - start_idx + 1) as f64;

                candidates.push(SplitCandidate {
                    start_idx,
                    end_idx,
                    avg_density: portion_density,
                    density_ratio: portion_density / endpoint_density,
                });

                // Skip past this region
                i = end_idx + window_size;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    candidates
}

/// Split a section into multiple sections based on density analysis.
/// Returns the original section plus any new sections created from high-density portions.
fn split_section_by_density(
    section: FrequentSection,
    track_map: &HashMap<String, Vec<GpsPoint>>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    let candidates = find_split_candidates(&section);

    if candidates.is_empty() {
        return vec![section];
    }

    info!(
        "[Sections] Found {} split candidates for section {} (len={}m)",
        candidates.len(),
        section.id,
        section.distance_meters as i32
    );

    let mut result = Vec::new();

    // Create new sections from high-density portions
    for (split_idx, candidate) in candidates.iter().enumerate() {
        // Extract the high-density portion
        let split_polyline = section.polyline[candidate.start_idx..=candidate.end_idx].to_vec();
        let split_density = section.point_density[candidate.start_idx..=candidate.end_idx].to_vec();
        let split_distance = polyline_length(&split_polyline);

        // Re-compute which activities overlap with this portion
        let mut split_activity_ids = Vec::new();
        let mut split_activity_traces = HashMap::new();

        let split_tree = build_rtree(&split_polyline);
        let threshold_deg = config.proximity_threshold / 111_000.0;
        let threshold_deg_sq = threshold_deg * threshold_deg;

        for activity_id in &section.activity_ids {
            if let Some(track) = track_map.get(activity_id) {
                // Check if this activity overlaps with the split portion
                let mut overlap_points = Vec::new();

                for point in track {
                    let query = [point.latitude, point.longitude];
                    if let Some(nearest) = split_tree.nearest_neighbor(&query) {
                        if nearest.distance_2(&query) <= threshold_deg_sq {
                            overlap_points.push(point.clone());
                        }
                    }
                }

                // Need substantial overlap to count
                let overlap_distance = polyline_length(&overlap_points);
                if overlap_distance >= split_distance * 0.5 {
                    split_activity_ids.push(activity_id.clone());
                    if !overlap_points.is_empty() {
                        split_activity_traces.insert(activity_id.clone(), overlap_points);
                    }
                }
            }
        }

        // Only create the split section if it has enough activities
        if split_activity_ids.len() >= config.min_activities as usize {
            let split_section = FrequentSection {
                id: format!("{}_split{}", section.id, split_idx),
                sport_type: section.sport_type.clone(),
                polyline: split_polyline,
                representative_activity_id: section.representative_activity_id.clone(),
                activity_ids: split_activity_ids,
                activity_portions: Vec::new(), // Will be recomputed later if needed
                route_ids: section.route_ids.clone(),
                visit_count: candidate.avg_density as u32,
                distance_meters: split_distance,
                activity_traces: split_activity_traces,
                confidence: section.confidence,
                observation_count: candidate.avg_density as u32,
                average_spread: section.average_spread,
                point_density: split_density,
            };

            info!(
                "[Sections] Created split section {} with {} activities (density ratio {:.1}x)",
                split_section.id,
                split_section.activity_ids.len(),
                candidate.density_ratio
            );

            result.push(split_section);
        }
    }

    // Keep the original section too (it still represents the full route)
    result.push(section);

    result
}

/// Post-processing step: Split sections with high density variance.
/// Called after initial section detection to break up sections that have
/// high-traffic portions used by many other activities.
fn split_high_variance_sections(
    sections: Vec<FrequentSection>,
    track_map: &HashMap<String, Vec<GpsPoint>>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    let mut result = Vec::new();

    for section in sections {
        let split = split_section_by_density(section, track_map, config);
        result.extend(split);
    }

    result
}

// =============================================================================
// Helper Functions
// =============================================================================
//
// Core geographic utilities (haversine_distance, compute_bounds, compute_center,
// polyline_length, bounds_overlap) are imported from crate::geo_utils

/// Check if two tracks' bounding boxes overlap
fn bounds_overlap_tracks(track_a: &[GpsPoint], track_b: &[GpsPoint], buffer: f64) -> bool {
    if track_a.is_empty() || track_b.is_empty() {
        return false;
    }

    let bounds_a = compute_bounds(track_a);
    let bounds_b = compute_bounds(track_b);

    // Use reference latitude from center of bounds_a for meter-to-degree conversion
    let ref_lat = (bounds_a.min_lat + bounds_a.max_lat) / 2.0;
    bounds_overlap(&bounds_a, &bounds_b, buffer, ref_lat)
}

// =============================================================================
// Self-Folding Section Detection
// =============================================================================

/// Detect if a polyline folds back on itself (out-and-back pattern).
/// Returns the index of the fold point if found, or None if no fold.
fn detect_fold_point(polyline: &[GpsPoint], threshold: f64) -> Option<usize> {
    if polyline.len() < 10 {
        return None;
    }

    let threshold_deg = threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    // Build R-tree of the first half of the polyline
    let half = polyline.len() / 2;
    let first_half_tree = build_rtree(&polyline[..half]);

    // Check each point in the second half against the first half
    // Looking for where the track returns close to earlier points
    let mut fold_candidates: Vec<(usize, f64)> = Vec::new();

    for (i, point) in polyline[half..].iter().enumerate() {
        let idx = half + i;
        let query = [point.latitude, point.longitude];

        if let Some(nearest) = first_half_tree.nearest_neighbor(&query) {
            let dist_sq = nearest.distance_2(&query);
            if dist_sq <= threshold_deg_sq {
                // This point is close to an earlier point - potential fold
                // Track the earliest point where this happens
                fold_candidates.push((idx, dist_sq));
            }
        }
    }

    // Find the first substantial fold (where a sequence of points return)
    // We want the point where the track genuinely turns back, not random noise
    if fold_candidates.len() >= 3 {
        // The fold point is approximately where the return starts
        // Use the first candidate that has at least 2 more following candidates
        Some(fold_candidates[0].0)
    } else {
        None
    }
}

/// Check if a section is "folding" - meaning it goes out and comes back
/// on essentially the same path. Returns fold ratio (0.0 = no fold, 1.0 = perfect fold)
fn compute_fold_ratio(polyline: &[GpsPoint], threshold: f64) -> f64 {
    if polyline.len() < 6 {
        return 0.0;
    }

    let threshold_deg = threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    // Compare first third to last third (reversed)
    let third = polyline.len() / 3;
    let first_third = &polyline[..third];
    let last_third: Vec<GpsPoint> = polyline[(polyline.len() - third)..].iter().cloned().collect();

    // Build tree from first third
    let first_tree = build_rtree(first_third);

    // Count how many points in last third are close to points in first third
    let mut close_count = 0;
    for point in last_third.iter().rev() {  // Reversed order for out-and-back
        let query = [point.latitude, point.longitude];
        if let Some(nearest) = first_tree.nearest_neighbor(&query) {
            if nearest.distance_2(&query) <= threshold_deg_sq {
                close_count += 1;
            }
        }
    }

    close_count as f64 / third as f64
}

/// Split sections that fold back on themselves into separate one-way sections.
/// For out-and-back routes, this creates two sections: outbound and return.
fn split_folding_sections(
    sections: Vec<FrequentSection>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    let mut result = Vec::new();

    for section in sections {
        let fold_ratio = compute_fold_ratio(&section.polyline, config.proximity_threshold);

        if fold_ratio > 0.5 {
            // This section folds back on itself - split it
            if let Some(fold_idx) = detect_fold_point(&section.polyline, config.proximity_threshold) {
                // Create outbound section (start to fold point)
                let outbound_polyline = section.polyline[..fold_idx].to_vec();
                let outbound_length = polyline_length(&outbound_polyline);

                if outbound_length >= config.min_section_length {
                    let mut outbound = section.clone();
                    outbound.id = format!("{}_out", section.id);
                    outbound.polyline = outbound_polyline;
                    outbound.distance_meters = outbound_length;
                    // Update activity traces to only include outbound portion
                    outbound.activity_traces = HashMap::new();  // Will be recomputed
                    result.push(outbound);
                }

                // Create return section (fold point to end)
                let return_polyline = section.polyline[fold_idx..].to_vec();
                let return_length = polyline_length(&return_polyline);

                if return_length >= config.min_section_length {
                    let mut return_section = section.clone();
                    return_section.id = format!("{}_ret", section.id);
                    return_section.polyline = return_polyline;
                    return_section.distance_meters = return_length;
                    return_section.activity_traces = HashMap::new();
                    result.push(return_section);
                }

                info!(
                    "[Sections] Split folding section {} at index {} (fold_ratio={:.2})",
                    section.id, fold_idx, fold_ratio
                );
            } else {
                // Couldn't find fold point, keep original
                result.push(section);
            }
        } else {
            // Not folding, keep as-is
            result.push(section);
        }
    }

    result
}

/// Merge sections that are geometrically close to each other.
/// This handles: reversed sections, parallel tracks (opposite sides of road), GPS drift.
fn merge_nearby_sections(
    mut sections: Vec<FrequentSection>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    if sections.len() < 2 {
        return sections;
    }

    // Sort by visit count descending - keep the most visited version
    sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

    let mut keep: Vec<bool> = vec![true; sections.len()];

    // Use a very generous threshold for merging nearby sections
    // Wide roads can be 30m+, GPS error can add 20m, so use 2x the base threshold
    let merge_threshold = config.proximity_threshold * 2.0;

    for i in 0..sections.len() {
        if !keep[i] {
            continue;
        }

        let section_i = &sections[i];
        let tree_i = build_rtree(&section_i.polyline);

        for j in (i + 1)..sections.len() {
            if !keep[j] {
                continue;
            }

            let section_j = &sections[j];

            // Skip if sections are very different lengths (>3x difference)
            let length_ratio = section_i.distance_meters / section_j.distance_meters.max(1.0);
            if length_ratio > 3.0 || length_ratio < 0.33 {
                continue;
            }

            // Check forward containment with generous threshold
            let forward_containment = compute_containment(&section_j.polyline, &tree_i, merge_threshold);

            // Check reverse containment
            let reversed_j: Vec<GpsPoint> = section_j.polyline.iter().rev().cloned().collect();
            let reverse_containment = compute_containment(&reversed_j, &tree_i, merge_threshold);

            let max_containment = forward_containment.max(reverse_containment);

            // Merge if either direction shows overlap (lower threshold since we're using generous distance)
            if max_containment > 0.4 {
                keep[j] = false;

                let direction = if reverse_containment > forward_containment { "reverse" } else { "same" };

                info!(
                    "[Sections] Merged nearby {} section {} into {} ({:.0}% overlap @ {}m threshold)",
                    direction, section_j.id, section_i.id, max_containment * 100.0, merge_threshold as i32
                );
            }
        }
    }

    sections
        .into_iter()
        .zip(keep)
        .filter_map(|(s, k)| if k { Some(s) } else { None })
        .collect()
}

// =============================================================================
// Section Deduplication
// =============================================================================

/// Remove sections that overlap significantly.
/// Strategy: Prefer SHORTER sections over longer ones that contain them.
/// A short section (like an intersection or bridge) is more specific and useful
/// than a long section that happens to include it.
fn remove_overlapping_sections(
    mut sections: Vec<FrequentSection>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    if sections.len() < 2 {
        return sections;
    }

    // Sort by LENGTH ascending (shorter sections first), then by visit count descending
    // This ensures shorter, more specific sections are preferred
    sections.sort_by(|a, b| {
        match a.distance_meters.partial_cmp(&b.distance_meters) {
            Some(std::cmp::Ordering::Equal) => b.visit_count.cmp(&a.visit_count),
            Some(ord) => ord,
            None => std::cmp::Ordering::Equal,
        }
    });

    let mut keep: Vec<bool> = vec![true; sections.len()];

    // For each section, check if it's mostly contained in a shorter section
    // If so, the longer section should be removed (or trimmed)
    for i in 0..sections.len() {
        if !keep[i] {
            continue;
        }

        let section_i = &sections[i];
        let tree_i = build_rtree(&section_i.polyline);

        for j in (i + 1)..sections.len() {
            if !keep[j] {
                continue;
            }

            let section_j = &sections[j];
            let tree_j = build_rtree(&section_j.polyline);

            // Check mutual containment
            let j_in_i = compute_containment(&section_j.polyline, &tree_i, config.proximity_threshold);
            let i_in_j = compute_containment(&section_i.polyline, &tree_j, config.proximity_threshold);

            // If j is largely contained in i (j is the longer one since we sorted by length)
            // j should be removed because i is the more specific section
            if j_in_i > 0.6 {
                info!(
                    "[Sections] Removing {} ({}m) - {}% contained in {} ({}m)",
                    section_j.id, section_j.distance_meters as u32,
                    (j_in_i * 100.0) as u32,
                    section_i.id, section_i.distance_meters as u32
                );
                keep[j] = false;
            } else if i_in_j > 0.8 {
                // If i is almost entirely contained in j, remove i (the smaller one)
                // This handles edge cases where the "smaller" section by length
                // is actually just a subset of another section
                info!(
                    "[Sections] Removing {} ({}m) - {}% contained in {} ({}m)",
                    section_i.id, section_i.distance_meters as u32,
                    (i_in_j * 100.0) as u32,
                    section_j.id, section_j.distance_meters as u32
                );
                keep[i] = false;
                break; // Stop checking j's against removed i
            } else if j_in_i > 0.4 && i_in_j > 0.4 {
                // Significant mutual overlap - they're essentially the same
                // Keep the shorter one (i, since sorted by length)
                info!(
                    "[Sections] Removing {} due to mutual overlap with {} ({}% vs {}%)",
                    section_j.id, section_i.id,
                    (j_in_i * 100.0) as u32, (i_in_j * 100.0) as u32
                );
                keep[j] = false;
            }
        }
    }

    sections
        .into_iter()
        .zip(keep)
        .filter_map(|(s, k)| if k { Some(s) } else { None })
        .collect()
}

/// Compute what fraction of polyline A is contained within polyline B
fn compute_containment(
    poly_a: &[GpsPoint],
    tree_b: &RTree<IndexedPoint>,
    threshold: f64,
) -> f64 {
    if poly_a.is_empty() {
        return 0.0;
    }

    let threshold_deg = threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    let mut contained_points = 0;

    for point in poly_a {
        let query = [point.latitude, point.longitude];
        if let Some(nearest) = tree_b.nearest_neighbor(&query) {
            if nearest.distance_2(&query) <= threshold_deg_sq {
                contained_points += 1;
            }
        }
    }

    contained_points as f64 / poly_a.len() as f64
}

/// Distance threshold for considering a point "on" the section (meters)
const TRACE_PROXIMITY_THRESHOLD: f64 = 50.0;

/// Minimum points to consider a valid overlap trace
const MIN_TRACE_POINTS: usize = 3;

/// Extract the portion(s) of a GPS track that overlap with a section.
/// Returns ALL passes over the section (not just the longest) merged together.
/// This handles out-and-back routes where the activity crosses the section twice.
/// Uses R-tree for efficient O(log n) proximity lookups.
/// Tolerates small gaps (up to 3 points) due to GPS noise.
fn extract_activity_trace(track: &[GpsPoint], section_polyline: &[GpsPoint], polyline_tree: &RTree<IndexedPoint>) -> Vec<GpsPoint> {
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
fn extract_all_activity_traces(
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_point(lat: f64, lng: f64) -> GpsPoint {
        GpsPoint::new(lat, lng)
    }

    #[test]
    fn test_haversine_distance() {
        let p1 = make_point(51.5074, -0.1278); // London
        let p2 = make_point(48.8566, 2.3522);   // Paris
        let dist = haversine_distance(&p1, &p2);
        // London to Paris is about 344 km
        assert!(dist > 340_000.0 && dist < 350_000.0);
    }

    #[test]
    fn test_compute_center() {
        let points = vec![
            make_point(0.0, 0.0),
            make_point(2.0, 2.0),
        ];
        let center = compute_center(&points);
        assert!((center.latitude - 1.0).abs() < 0.001);
        assert!((center.longitude - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_resample_by_distance() {
        let points = vec![
            make_point(0.0, 0.0),
            make_point(0.001, 0.0),
            make_point(0.002, 0.0),
        ];
        let resampled = resample_by_distance(&points, 5);
        assert_eq!(resampled.len(), 5);
    }
}
