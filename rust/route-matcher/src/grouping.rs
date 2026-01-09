//! Route grouping algorithms.
//!
//! This module provides functionality to group similar routes together
//! using spatial indexing and Union-Find for efficient grouping.

use std::collections::HashMap;
use rstar::{RTree, AABB};

use crate::geo_utils::haversine_distance;
use crate::matching::compare_routes;
use crate::union_find::UnionFind;
use crate::{Bounds, GpsPoint, MatchConfig, MatchResult, RouteGroup, RouteBounds, RouteSignature, ActivityMatchInfo, GroupingResult};

/// Spatial search tolerance in degrees (~1km).
const SPATIAL_TOLERANCE: f64 = 0.01;

/// Check if two routes should be GROUPED into the same route.
///
/// A "route" is a complete, repeated JOURNEY - not just a shared section.
/// Two activities are the same route only if they represent the same end-to-end trip.
///
/// Criteria:
/// 1. Both routes must be at least min_route_distance
/// 2. Match percentage meets threshold
/// 3. Similar total distance (within max_distance_diff_ratio)
/// 4. Same endpoints (within endpoint_threshold)
/// 5. Middle points must also match
pub fn should_group_routes(
    sig1: &RouteSignature,
    sig2: &RouteSignature,
    match_result: &MatchResult,
    config: &MatchConfig,
) -> bool {
    // CHECK 0: Both routes must be meaningful length
    if sig1.total_distance < config.min_route_distance || sig2.total_distance < config.min_route_distance {
        return false;
    }

    // CHECK 1: Match percentage must be high enough
    if match_result.match_percentage < config.min_match_percentage {
        return false;
    }

    // CHECK 2: Total distance must be similar
    let distance_diff = (sig1.total_distance - sig2.total_distance).abs();
    let max_distance = sig1.total_distance.max(sig2.total_distance);
    if max_distance > 0.0 && distance_diff / max_distance > config.max_distance_diff_ratio {
        return false;
    }

    // CHECK 3: Endpoints must match closely
    let start1 = &sig1.start_point;
    let end1 = &sig1.end_point;
    let start2 = &sig2.start_point;
    let end2 = &sig2.end_point;

    // Check if routes are loops
    let sig1_is_loop = haversine_distance(start1, end1) < config.endpoint_threshold;
    let sig2_is_loop = haversine_distance(start2, end2) < config.endpoint_threshold;

    // For loops, check that starts are close and both are actually loops
    if sig1_is_loop && sig2_is_loop {
        let start_dist = haversine_distance(start1, start2);
        if start_dist > config.endpoint_threshold {
            return false;
        }
        return check_middle_points_match(&sig1.points, &sig2.points, config.endpoint_threshold * 2.0);
    }

    // Determine direction by checking which endpoint pairing is closer
    let same_start_dist = haversine_distance(start1, start2);
    let same_end_dist = haversine_distance(end1, end2);
    let reverse_start_dist = haversine_distance(start1, end2);
    let reverse_end_dist = haversine_distance(end1, start2);

    let same_direction_ok = same_start_dist < config.endpoint_threshold && same_end_dist < config.endpoint_threshold;
    let reverse_direction_ok = reverse_start_dist < config.endpoint_threshold && reverse_end_dist < config.endpoint_threshold;

    if !same_direction_ok && !reverse_direction_ok {
        return false;
    }

    // CHECK 4: Middle points must also match
    let points2_for_middle: Vec<GpsPoint> = if reverse_direction_ok && !same_direction_ok {
        sig2.points.iter().rev().cloned().collect()
    } else {
        sig2.points.clone()
    };

    check_middle_points_match(&sig1.points, &points2_for_middle, config.endpoint_threshold * 2.0)
}

/// Check that the middle portions of two routes also match.
pub fn check_middle_points_match(points1: &[GpsPoint], points2: &[GpsPoint], threshold: f64) -> bool {
    if points1.len() < 5 || points2.len() < 5 {
        return true; // Not enough points to check middle
    }

    // Check points at 25%, 50%, and 75% along each route
    let check_positions = [0.25, 0.5, 0.75];

    for pos in check_positions {
        let idx1 = (points1.len() as f64 * pos) as usize;
        let idx2 = (points2.len() as f64 * pos) as usize;

        let p1 = &points1[idx1];
        let p2 = &points2[idx2];

        let dist = haversine_distance(p1, p2);
        if dist > threshold {
            return false;
        }
    }

    true
}

/// Group similar routes together.
///
/// Uses an R-tree spatial index for pre-filtering and Union-Find
/// for efficient grouping. Routes that match are grouped together
/// only if they pass strict grouping criteria (same journey, not just shared sections).
pub fn group_signatures(signatures: &[RouteSignature], config: &MatchConfig) -> Vec<RouteGroup> {
    if signatures.is_empty() {
        return vec![];
    }

    // Build spatial index
    let bounds: Vec<RouteBounds> = signatures.iter().map(|s| s.route_bounds()).collect();
    let rtree = RTree::bulk_load(bounds);

    // Create signature lookup
    let sig_map: HashMap<&str, &RouteSignature> = signatures
        .iter()
        .map(|s| (s.activity_id.as_str(), s))
        .collect();

    // Union-Find using our new type
    let mut uf = UnionFind::with_capacity(signatures.len());
    for sig in signatures {
        uf.make_set(sig.activity_id.clone());
    }

    // Find matching pairs
    for sig1 in signatures {
        let search_bounds = create_search_bounds(&sig1.points, SPATIAL_TOLERANCE);

        for bounds in rtree.locate_in_envelope_intersecting(&search_bounds) {
            // Skip self and already-processed pairs
            if bounds.activity_id == sig1.activity_id {
                continue;
            }
            if sig1.activity_id >= bounds.activity_id {
                continue;
            }

            // Distance pre-filter
            if !distance_ratio_ok(sig1.total_distance, bounds.distance) {
                continue;
            }

            if let Some(sig2) = sig_map.get(bounds.activity_id.as_str()) {
                // Only group if match exists AND passes strict grouping criteria
                if let Some(match_result) = compare_routes(sig1, sig2, config) {
                    if should_group_routes(sig1, sig2, &match_result, config) {
                        uf.union(&sig1.activity_id, &bounds.activity_id);
                    }
                }
            }
        }
    }

    // Build groups from Union-Find
    let groups_map = uf.groups();
    build_route_groups(groups_map, &sig_map)
}

/// Group similar routes together and capture match info for each activity.
///
/// Returns both the groups and per-activity match percentages.
/// The match info is calculated by comparing each activity to the group's representative.
pub fn group_signatures_with_matches(
    signatures: &[RouteSignature],
    config: &MatchConfig,
) -> GroupingResult {
    if signatures.is_empty() {
        return GroupingResult {
            groups: vec![],
            activity_matches: HashMap::new(),
        };
    }

    // First, do the normal grouping
    let groups = group_signatures(signatures, config);

    // Create signature lookup
    let sig_map: HashMap<&str, &RouteSignature> = signatures
        .iter()
        .map(|s| (s.activity_id.as_str(), s))
        .collect();

    // Calculate match info for each activity in each group
    let mut activity_matches: HashMap<String, Vec<ActivityMatchInfo>> = HashMap::new();

    for group in &groups {
        let representative_sig = match sig_map.get(group.representative_id.as_str()) {
            Some(sig) => *sig,
            None => continue,
        };

        let mut matches = Vec::new();
        for activity_id in &group.activity_ids {
            if let Some(activity_sig) = sig_map.get(activity_id.as_str()) {
                // Compare to representative
                let (match_percentage, direction) = if activity_id == &group.representative_id {
                    // Representative always matches itself 100%
                    (100.0, "same".to_string())
                } else if let Some(result) = compare_routes(activity_sig, representative_sig, config) {
                    (result.match_percentage, result.direction.clone())
                } else {
                    // Shouldn't happen for grouped activities, but fallback
                    (100.0, "same".to_string())
                };

                matches.push(ActivityMatchInfo {
                    activity_id: activity_id.clone(),
                    match_percentage,
                    direction,
                });
            }
        }

        activity_matches.insert(group.group_id.clone(), matches);
    }

    GroupingResult {
        groups,
        activity_matches,
    }
}

/// Group signatures using parallel processing.
///
/// This is the same as `group_signatures` but uses rayon for parallel
/// comparison of route pairs. Recommended for large datasets (100+ routes).
#[cfg(feature = "parallel")]
pub fn group_signatures_parallel(
    signatures: &[RouteSignature],
    config: &MatchConfig,
) -> Vec<RouteGroup> {
    use rayon::prelude::*;

    if signatures.is_empty() {
        return vec![];
    }

    // Build spatial index
    let bounds: Vec<RouteBounds> = signatures.iter().map(|s| s.route_bounds()).collect();
    let rtree = RTree::bulk_load(bounds);

    // Create signature lookup
    let sig_map: HashMap<&str, &RouteSignature> = signatures
        .iter()
        .map(|s| (s.activity_id.as_str(), s))
        .collect();

    // Find matches in parallel (with strict grouping criteria)
    let matches: Vec<(String, String)> = signatures
        .par_iter()
        .flat_map(|sig1| {
            let search_bounds = create_search_bounds(&sig1.points, SPATIAL_TOLERANCE);

            rtree
                .locate_in_envelope_intersecting(&search_bounds)
                .filter(|b| {
                    b.activity_id != sig1.activity_id
                        && sig1.activity_id < b.activity_id
                        && distance_ratio_ok(sig1.total_distance, b.distance)
                })
                .filter_map(|b| {
                    let sig2 = sig_map.get(b.activity_id.as_str())?;
                    let match_result = compare_routes(sig1, sig2, config)?;
                    // Only group if passes strict grouping criteria
                    if should_group_routes(sig1, sig2, &match_result, config) {
                        Some((sig1.activity_id.clone(), sig2.activity_id.clone()))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect();

    // Union-Find (sequential - fast enough)
    let mut uf = UnionFind::with_capacity(signatures.len());
    for sig in signatures {
        uf.make_set(sig.activity_id.clone());
    }

    for (id1, id2) in matches {
        uf.union(&id1, &id2);
    }

    // Build groups from Union-Find
    let groups_map = uf.groups();
    build_route_groups(groups_map, &sig_map)
}

/// Group signatures in parallel and capture match info for each activity.
///
/// Returns both the groups and per-activity match percentages.
#[cfg(feature = "parallel")]
pub fn group_signatures_parallel_with_matches(
    signatures: &[RouteSignature],
    config: &MatchConfig,
) -> GroupingResult {
    use rayon::prelude::*;

    if signatures.is_empty() {
        return GroupingResult {
            groups: vec![],
            activity_matches: HashMap::new(),
        };
    }

    // First, do the parallel grouping
    let groups = group_signatures_parallel(signatures, config);

    // Create signature lookup
    let sig_map: HashMap<&str, &RouteSignature> = signatures
        .iter()
        .map(|s| (s.activity_id.as_str(), s))
        .collect();

    // Calculate match info for each activity in parallel
    let activity_matches: HashMap<String, Vec<ActivityMatchInfo>> = groups
        .par_iter()
        .filter_map(|group| {
            let representative_sig = sig_map.get(group.representative_id.as_str())?;

            let matches: Vec<ActivityMatchInfo> = group.activity_ids
                .iter()
                .filter_map(|activity_id| {
                    let activity_sig = sig_map.get(activity_id.as_str())?;

                    let (match_percentage, direction) = if activity_id == &group.representative_id {
                        (100.0, "same".to_string())
                    } else if let Some(result) = compare_routes(activity_sig, representative_sig, config) {
                        (result.match_percentage, result.direction.clone())
                    } else {
                        (100.0, "same".to_string())
                    };

                    Some(ActivityMatchInfo {
                        activity_id: activity_id.clone(),
                        match_percentage,
                        direction,
                    })
                })
                .collect();

            Some((group.group_id.clone(), matches))
        })
        .collect();

    GroupingResult {
        groups,
        activity_matches,
    }
}

/// Incremental grouping: efficiently add new signatures to existing groups.
///
/// This is much faster than re-grouping all signatures when adding new activities:
/// - O(n×m) instead of O(n²) where n = existing, m = new
/// - Only compares: new vs existing AND new vs new
/// - Existing signatures are NOT compared against each other (already grouped)
#[cfg(feature = "parallel")]
pub fn group_incremental(
    new_signatures: &[RouteSignature],
    existing_groups: &[RouteGroup],
    existing_signatures: &[RouteSignature],
    config: &MatchConfig,
) -> Vec<RouteGroup> {
    use rayon::prelude::*;
    use std::collections::HashSet;

    if new_signatures.is_empty() {
        return existing_groups.to_vec();
    }

    if existing_groups.is_empty() {
        // No existing groups - just group the new signatures
        return group_signatures_parallel(new_signatures, config);
    }

    // Combine all signatures for R-tree indexing
    let all_signatures: Vec<&RouteSignature> = existing_signatures
        .iter()
        .chain(new_signatures.iter())
        .collect();

    // Build spatial index from all signatures
    let all_bounds: Vec<RouteBounds> = all_signatures.iter().map(|s| s.route_bounds()).collect();
    let rtree = RTree::bulk_load(all_bounds);

    // Create signature lookup
    let sig_map: HashMap<&str, &RouteSignature> = all_signatures
        .iter()
        .map(|s| (s.activity_id.as_str(), *s))
        .collect();

    // Set of new signature IDs for fast lookup
    let new_ids: HashSet<&str> = new_signatures
        .iter()
        .map(|s| s.activity_id.as_str())
        .collect();

    // Initialize Union-Find with existing group structure
    let mut uf = UnionFind::with_capacity(all_signatures.len());

    // For existing groups: union all members together
    for group in existing_groups {
        if group.activity_ids.len() > 1 {
            let first = &group.activity_ids[0];
            uf.make_set(first.clone());
            for id in group.activity_ids.iter().skip(1) {
                uf.make_set(id.clone());
                uf.union(first, id);
            }
        } else if !group.activity_ids.is_empty() {
            uf.make_set(group.activity_ids[0].clone());
        }
    }

    // For new signatures: each is its own set initially
    for sig in new_signatures {
        uf.make_set(sig.activity_id.clone());
    }

    // Find matches in parallel - but ONLY where at least one signature is new
    let matches: Vec<(String, String)> = new_signatures
        .par_iter()
        .flat_map(|new_sig| {
            let search_bounds = AABB::from_corners(
                [new_sig.bounds.min_lng - SPATIAL_TOLERANCE, new_sig.bounds.min_lat - SPATIAL_TOLERANCE],
                [new_sig.bounds.max_lng + SPATIAL_TOLERANCE, new_sig.bounds.max_lat + SPATIAL_TOLERANCE],
            );

            rtree
                .locate_in_envelope_intersecting(&search_bounds)
                .filter(|b| {
                    b.activity_id != new_sig.activity_id
                        && distance_ratio_ok(new_sig.total_distance, b.distance)
                })
                .filter_map(|b| {
                    let other_sig = sig_map.get(b.activity_id.as_str())?;

                    // Skip if both are existing (they're already grouped)
                    let other_is_new = new_ids.contains(b.activity_id.as_str());
                    if other_is_new && new_sig.activity_id >= b.activity_id {
                        // new vs new - only check once (lexicographic ordering)
                        return None;
                    }

                    let match_result = compare_routes(new_sig, other_sig, config)?;
                    if should_group_routes(new_sig, other_sig, &match_result, config) {
                        Some((new_sig.activity_id.clone(), b.activity_id.clone()))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect();

    // Apply matches to Union-Find
    for (id1, id2) in matches {
        uf.union(&id1, &id2);
    }

    // Build groups from Union-Find
    let groups_map = uf.groups();
    build_route_groups(groups_map, &sig_map)
}

/// Build RouteGroup instances with full metadata from grouped activity IDs.
fn build_route_groups(
    groups_map: HashMap<String, Vec<String>>,
    sig_map: &HashMap<&str, &RouteSignature>,
) -> Vec<RouteGroup> {
    groups_map
        .into_iter()
        .map(|(group_id, activity_ids)| {
            // Find representative signature (first in group)
            let representative_id = activity_ids.first().cloned().unwrap_or_default();

            // Get sport type from first signature (empty for now - caller should set)
            let sport_type = String::new();

            // Compute combined bounds from all signatures in group
            let bounds = compute_group_bounds(&activity_ids, sig_map);

            RouteGroup {
                group_id,
                representative_id,
                activity_ids,
                sport_type,
                bounds,
                custom_name: None,
            }
        })
        .collect()
}

/// Compute combined bounds for a group of activity IDs.
fn compute_group_bounds(
    activity_ids: &[String],
    sig_map: &HashMap<&str, &RouteSignature>,
) -> Option<Bounds> {
    let group_sigs: Vec<_> = activity_ids
        .iter()
        .filter_map(|id| sig_map.get(id.as_str()))
        .collect();

    if group_sigs.is_empty() {
        return None;
    }

    let mut min_lat = f64::MAX;
    let mut max_lat = f64::MIN;
    let mut min_lng = f64::MAX;
    let mut max_lng = f64::MIN;

    for sig in group_sigs {
        min_lat = min_lat.min(sig.bounds.min_lat);
        max_lat = max_lat.max(sig.bounds.max_lat);
        min_lng = min_lng.min(sig.bounds.min_lng);
        max_lng = max_lng.max(sig.bounds.max_lng);
    }

    Some(Bounds {
        min_lat,
        max_lat,
        min_lng,
        max_lng,
    })
}

/// Create search bounds for spatial index query.
fn create_search_bounds(points: &[GpsPoint], tolerance: f64) -> AABB<[f64; 2]> {
    let (min_lat, max_lat, min_lng, max_lng) = crate::geo_utils::compute_bounds_tuple(points);
    AABB::from_corners(
        [min_lng - tolerance, min_lat - tolerance],
        [max_lng + tolerance, max_lat + tolerance],
    )
}

/// Check if two distances are within acceptable ratio (50%).
fn distance_ratio_ok(d1: f64, d2: f64) -> bool {
    if d1 <= 0.0 || d2 <= 0.0 {
        return false;
    }
    let ratio = if d1 > d2 { d2 / d1 } else { d1 / d2 };
    ratio >= 0.5
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_long_route() -> Vec<GpsPoint> {
        // Create a route long enough to meet min_route_distance (500m)
        // Each point is about 100m apart, 10 points = ~1km
        (0..10)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278))
            .collect()
    }

    #[test]
    fn test_group_identical_routes() {
        let long_route = create_long_route();

        let sig1 = RouteSignature::from_points("test-1", &long_route, &MatchConfig::default()).unwrap();
        let sig2 = RouteSignature::from_points("test-2", &long_route, &MatchConfig::default()).unwrap();

        let groups = group_signatures(&[sig1, sig2], &MatchConfig::default());

        // Should have 1 group with both routes
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].activity_ids.len(), 2);
    }

    #[test]
    fn test_group_different_routes() {
        let route1: Vec<GpsPoint> = (0..10)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278))
            .collect();

        let route2: Vec<GpsPoint> = (0..10)
            .map(|i| GpsPoint::new(40.7128 + i as f64 * 0.001, -74.0060))
            .collect();

        let sig1 = RouteSignature::from_points("test-1", &route1, &MatchConfig::default()).unwrap();
        let sig2 = RouteSignature::from_points("test-2", &route2, &MatchConfig::default()).unwrap();

        let groups = group_signatures(&[sig1, sig2], &MatchConfig::default());

        // Should have 2 groups (different routes)
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn test_distance_ratio_ok() {
        assert!(distance_ratio_ok(1000.0, 1200.0)); // 83% - ok
        assert!(distance_ratio_ok(1000.0, 500.0));  // 50% - ok
        assert!(!distance_ratio_ok(1000.0, 400.0)); // 40% - not ok
        assert!(!distance_ratio_ok(0.0, 1000.0));   // Invalid
    }
}
