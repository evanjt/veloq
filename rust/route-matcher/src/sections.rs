//! # Medoid-Based Section Detection
//!
//! Detects frequently-traveled road sections using FULL GPS tracks.
//! Produces smooth, natural polylines by selecting actual GPS traces (medoids)
//! rather than computing artificial median points.
//!
//! ## Algorithm
//! 1. Load full GPS tracks (1000s of points per activity)
//! 2. Find overlapping portions using R-tree spatial indexing
//! 3. Cluster overlaps that represent the same physical section
//! 4. Select medoid: the actual trace with minimum AMD to all others
//! 5. Store each activity's portion indices for pace comparison
//!
//! ## Key Difference from Previous Approach
//! - Uses FULL GPS tracks, not pre-simplified RouteSignatures
//! - Medoid selection: picks an ACTUAL trace, no artificial interpolation
//! - Stores activity portions for pace comparison

use std::collections::{HashMap, HashSet};
use crate::{GpsPoint, RouteGroup, Bounds};
use geo::{Point, Haversine, Distance};
use rstar::{RTree, RTreeObject, PointDistance, AABB};
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
            proximity_threshold: 30.0,   // 30m - tight enough for road-level matching
            min_section_length: 200.0,   // 200m minimum section
            max_section_length: 5000.0,  // 5km max - longer is likely a route, not a section
            min_activities: 3,           // Need 3+ activities
            cluster_tolerance: 50.0,     // 50m for clustering similar overlaps
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

/// A frequently-traveled section with medoid representation
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct FrequentSection {
    /// Unique section ID
    pub id: String,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// The medoid polyline - an ACTUAL GPS trace from one activity
    pub polyline: Vec<GpsPoint>,
    /// Which activity provided the representative polyline
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
    /// Start index in activity A's full track
    a_start: usize,
    /// End index in activity A's full track
    a_end: usize,
    /// Start index in activity B's full track
    b_start: usize,
    /// End index in activity B's full track
    b_end: usize,
    /// The actual GPS points from track A (for medoid selection)
    points_a: Vec<GpsPoint>,
    /// The actual GPS points from track B
    points_b: Vec<GpsPoint>,
    /// Overlap length in meters
    length_meters: f64,
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
            a_start: start_a,
            a_end,
            b_start,
            b_end,
            points_a,
            points_b,
            length_meters: best_length,
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
    /// Center point (average of overlap centers)
    center: GpsPoint,
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

        // Compute cluster center
        let center = if cluster_overlaps.len() == 1 {
            cluster_overlaps[0].center.clone()
        } else {
            let sum_lat: f64 = cluster_overlaps.iter().map(|o| o.center.latitude).sum();
            let sum_lng: f64 = cluster_overlaps.iter().map(|o| o.center.longitude).sum();
            let n = cluster_overlaps.len() as f64;
            GpsPoint::new(sum_lat / n, sum_lng / n)
        };

        clusters.push(OverlapCluster {
            overlaps: cluster_overlaps,
            activity_ids: cluster_activities,
            center,
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
    representative_id: &str,
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
                let distance = compute_polyline_length(&track[start_idx..end_idx]);

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
        // Determine direction by comparing start/end points
        let track_start = &track[start];
        let track_end = &track[end_idx.saturating_sub(1).max(start)];
        let ref_start = &reference[0];
        let ref_end = &reference[reference.len() - 1];

        let same_dir = haversine_distance(track_start, ref_start) +
                       haversine_distance(track_end, ref_end);
        let reverse_dir = haversine_distance(track_start, ref_end) +
                         haversine_distance(track_end, ref_start);

        let direction = if reverse_dir < same_dir {
            "reverse".to_string()
        } else {
            "same".to_string()
        };

        (start, end_idx, direction)
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

        // Process pairs in parallel
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

        // Process clusters in parallel
        let sport_sections: Vec<FrequentSection> = cluster_data
            .into_par_iter()
            .filter_map(|(idx, cluster)| {
                // Select medoid - an ACTUAL GPS trace
                let (representative_id, representative_polyline) = select_medoid(&cluster);

                if representative_polyline.is_empty() {
                    return None;
                }

                let distance_meters = compute_polyline_length(&representative_polyline);

                // Filter by max length - sections shouldn't be whole routes
                if distance_meters > config.max_section_length {
                    return None;
                }

                // Compute activity portions for pace comparison
                let activity_portions = compute_activity_portions(
                    &cluster,
                    &representative_id,
                    &representative_polyline,
                    &track_map,
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
                    &track_map,
                );

                Some(FrequentSection {
                    id: format!("sec_{}_{}", sport_type.to_lowercase(), idx),
                    sport_type: sport_type.clone(),
                    polyline: representative_polyline,
                    representative_activity_id: representative_id,
                    activity_ids: cluster.activity_ids.into_iter().collect(),
                    activity_portions,
                    route_ids,
                    visit_count: cluster.overlaps.len() as u32 + 1,
                    distance_meters,
                    activity_traces,
                })
            })
            .collect();

        info!(
            "[Sections] Converted {} sections for {} in {}ms",
            sport_sections.len(),
            sport_type,
            section_convert_start.elapsed().as_millis()
        );

        // Post-process: remove sections that contain or are contained by others
        let dedup_start = std::time::Instant::now();
        let deduped_sections = remove_overlapping_sections(sport_sections, config);
        info!(
            "[Sections] Deduplicated to {} unique sections in {}ms",
            deduped_sections.len(),
            dedup_start.elapsed().as_millis()
        );

        // Re-number sections
        for (i, mut section) in deduped_sections.into_iter().enumerate() {
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
// Helper Functions
// =============================================================================

/// Check if two tracks' bounding boxes overlap
fn bounds_overlap_tracks(track_a: &[GpsPoint], track_b: &[GpsPoint], buffer: f64) -> bool {
    if track_a.is_empty() || track_b.is_empty() {
        return false;
    }

    let bounds_a = compute_bounds(track_a);
    let bounds_b = compute_bounds(track_b);

    // Convert buffer from meters to degrees (approximate)
    let buffer_deg = buffer / 111_000.0;

    !(bounds_a.max_lat + buffer_deg < bounds_b.min_lat ||
      bounds_b.max_lat + buffer_deg < bounds_a.min_lat ||
      bounds_a.max_lng + buffer_deg < bounds_b.min_lng ||
      bounds_b.max_lng + buffer_deg < bounds_a.min_lng)
}

/// Compute bounding box of track
fn compute_bounds(points: &[GpsPoint]) -> Bounds {
    let mut min_lat = f64::MAX;
    let mut max_lat = f64::MIN;
    let mut min_lng = f64::MAX;
    let mut max_lng = f64::MIN;

    for p in points {
        min_lat = min_lat.min(p.latitude);
        max_lat = max_lat.max(p.latitude);
        min_lng = min_lng.min(p.longitude);
        max_lng = max_lng.max(p.longitude);
    }

    Bounds { min_lat, max_lat, min_lng, max_lng }
}

/// Compute center point of polyline
fn compute_center(points: &[GpsPoint]) -> GpsPoint {
    if points.is_empty() {
        return GpsPoint::new(0.0, 0.0);
    }

    let sum_lat: f64 = points.iter().map(|p| p.latitude).sum();
    let sum_lng: f64 = points.iter().map(|p| p.longitude).sum();
    let n = points.len() as f64;

    GpsPoint::new(sum_lat / n, sum_lng / n)
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

// =============================================================================
// Section Deduplication
// =============================================================================

/// Remove sections that contain or are contained by others.
/// When sections overlap significantly, keep the one with more visits.
/// This ensures each section is unique and non-redundant.
fn remove_overlapping_sections(
    mut sections: Vec<FrequentSection>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    if sections.len() < 2 {
        return sections;
    }

    // Sort by visit count descending (prefer more visited sections)
    sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

    let mut keep: Vec<bool> = vec![true; sections.len()];

    // Check each pair
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

            // Check if section_j is mostly contained within section_i
            let containment = compute_containment(&section_j.polyline, &tree_i, config.proximity_threshold);

            if containment > 0.7 {
                // section_j is >70% contained in section_i - remove it
                keep[j] = false;
            } else if containment > 0.3 {
                // Significant overlap - check the reverse direction
                let tree_j = build_rtree(&section_j.polyline);
                let reverse_containment = compute_containment(&section_i.polyline, &tree_j, config.proximity_threshold);

                if reverse_containment > 0.7 {
                    // section_i is mostly contained in section_j
                    // But we prefer section_i (more visits), so keep it and remove j
                    keep[j] = false;
                } else if containment > 0.5 || reverse_containment > 0.5 {
                    // Mutual overlap > 50% - they're essentially the same section
                    // Keep the one with more visits (section_i, since we sorted)
                    keep[j] = false;
                }
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

/// Extract the portion of a GPS track that overlaps with a section.
/// Returns the longest contiguous sequence of points within TRACE_PROXIMITY_THRESHOLD
/// of the section polyline.
/// Uses R-tree for efficient O(log n) proximity lookups instead of O(n) linear search.
fn extract_activity_trace(track: &[GpsPoint], section_polyline: &[GpsPoint], polyline_tree: &RTree<IndexedPoint>) -> Vec<GpsPoint> {
    if track.len() < MIN_TRACE_POINTS || section_polyline.len() < 2 {
        return Vec::new();
    }

    // Convert threshold from meters to approximate degrees for R-tree comparison
    // 1 degree ≈ 111km, so 50m ≈ 0.00045 degrees
    let threshold_deg = TRACE_PROXIMITY_THRESHOLD / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    // Find contiguous sequences of points near the section
    let mut sequences: Vec<Vec<GpsPoint>> = Vec::new();
    let mut current_sequence: Vec<GpsPoint> = Vec::new();

    for point in track {
        let query = [point.latitude, point.longitude];

        // Use R-tree for O(log n) nearest neighbor lookup
        let is_near = if let Some(nearest) = polyline_tree.nearest_neighbor(&query) {
            nearest.distance_2(&query) <= threshold_deg_sq
        } else {
            false
        };

        if is_near {
            // Point is near section
            current_sequence.push(point.clone());
        } else {
            // Point is far from section - end current sequence if valid
            if current_sequence.len() >= MIN_TRACE_POINTS {
                sequences.push(std::mem::take(&mut current_sequence));
            } else {
                current_sequence.clear();
            }
        }
    }

    // Don't forget the last sequence
    if current_sequence.len() >= MIN_TRACE_POINTS {
        sequences.push(current_sequence);
    }

    // Return the longest sequence
    sequences.into_iter()
        .max_by_key(|s| s.len())
        .unwrap_or_default()
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
