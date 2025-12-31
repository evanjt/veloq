//! Route matching algorithms using Average Minimum Distance (AMD).
//!
//! This module provides the core route comparison functionality:
//! - AMD-based route comparison
//! - Route resampling for fair comparison
//! - Direction detection (same vs reverse)

use crate::geo_utils::haversine_distance;
use crate::{GpsPoint, MatchConfig, MatchResult, RouteSignature};

/// Compare two routes and return a match result using Average Minimum Distance (AMD).
///
/// AMD is robust to GPS noise and doesn't require point ordering.
/// For each point in route1, we find the minimum distance to any point in route2,
/// then average all those distances.
///
/// Returns `None` if the routes don't meet the minimum match threshold.
///
/// # Example
/// ```
/// use route_matcher::{GpsPoint, RouteSignature, MatchConfig};
/// use route_matcher::matching::compare_routes;
///
/// let points1 = vec![
///     GpsPoint::new(51.5074, -0.1278),
///     GpsPoint::new(51.5090, -0.1300),
/// ];
/// let points2 = points1.clone();
///
/// let sig1 = RouteSignature::from_points("a", &points1, &MatchConfig::default()).unwrap();
/// let sig2 = RouteSignature::from_points("b", &points2, &MatchConfig::default()).unwrap();
///
/// let result = compare_routes(&sig1, &sig2, &MatchConfig::default());
/// assert!(result.is_some());
/// ```
pub fn compare_routes(
    sig1: &RouteSignature,
    sig2: &RouteSignature,
    config: &MatchConfig,
) -> Option<MatchResult> {
    // Quick distance filter - routes must be within 50% of each other's length
    let distance_ratio = if sig1.total_distance > sig2.total_distance {
        sig2.total_distance / sig1.total_distance
    } else {
        sig1.total_distance / sig2.total_distance
    };

    if distance_ratio < 0.5 {
        return None;
    }

    // Resample both routes to same number of points for fair comparison
    let resampled1 = resample_route(&sig1.points, config.resample_count as usize);
    let resampled2 = resample_route(&sig2.points, config.resample_count as usize);

    // Calculate AMD in both directions (AMD is asymmetric)
    let amd_1_to_2 = average_min_distance(&resampled1, &resampled2);
    let amd_2_to_1 = average_min_distance(&resampled2, &resampled1);

    // Use average of both directions
    let avg_amd = (amd_1_to_2 + amd_2_to_1) / 2.0;

    // Convert AMD to percentage using thresholds
    let match_percentage = amd_to_percentage(avg_amd, config.perfect_threshold, config.zero_threshold);

    // Check if meets minimum threshold
    if match_percentage < config.min_match_percentage {
        return None;
    }

    // Determine direction using endpoint comparison (AMD is symmetric)
    let direction = determine_direction_by_endpoints(sig1, sig2, config.endpoint_threshold);

    // Direction type based on match quality
    let direction_str = if match_percentage >= 70.0 {
        direction
    } else {
        "partial".to_string()
    };

    Some(MatchResult {
        activity_id_1: sig1.activity_id.clone(),
        activity_id_2: sig2.activity_id.clone(),
        match_percentage,
        direction: direction_str,
        amd: avg_amd,
    })
}

/// Calculate Average Minimum Distance from route1 to route2.
///
/// For each point in route1, find the minimum distance to any point in route2.
/// Return the average of these minimum distances.
pub fn average_min_distance(route1: &[GpsPoint], route2: &[GpsPoint]) -> f64 {
    if route1.is_empty() || route2.is_empty() {
        return f64::INFINITY;
    }

    let total_min_dist: f64 = route1
        .iter()
        .map(|p1| {
            route2
                .iter()
                .map(|p2| haversine_distance(p1, p2))
                .fold(f64::INFINITY, f64::min)
        })
        .sum();

    total_min_dist / route1.len() as f64
}

/// Convert AMD to a match percentage using thresholds.
///
/// - AMD <= perfect_threshold → 100% match
/// - AMD >= zero_threshold → 0% match
/// - Linear interpolation between
pub fn amd_to_percentage(amd: f64, perfect_threshold: f64, zero_threshold: f64) -> f64 {
    if amd <= perfect_threshold {
        return 100.0;
    }
    if amd >= zero_threshold {
        return 0.0;
    }

    // Linear interpolation
    100.0 * (1.0 - (amd - perfect_threshold) / (zero_threshold - perfect_threshold))
}

/// Resample a route to have exactly n points, evenly spaced by distance.
pub fn resample_route(points: &[GpsPoint], target_count: usize) -> Vec<GpsPoint> {
    if points.len() < 2 {
        return points.to_vec();
    }
    if points.len() == target_count {
        return points.to_vec();
    }

    // Calculate total distance
    let total_dist = calculate_route_distance(points);
    if total_dist == 0.0 {
        return points[..target_count.min(points.len())].to_vec();
    }

    let step_dist = total_dist / (target_count - 1) as f64;
    let mut resampled: Vec<GpsPoint> = vec![points[0]];

    let mut accumulated = 0.0;
    let mut next_threshold = step_dist;
    let mut prev_point = &points[0];

    for curr in points.iter().skip(1) {
        let seg_dist = haversine_distance(prev_point, curr);

        while accumulated + seg_dist >= next_threshold && resampled.len() < target_count - 1 {
            // Interpolate point at the threshold distance
            let ratio = (next_threshold - accumulated) / seg_dist;
            let new_lat = prev_point.latitude + ratio * (curr.latitude - prev_point.latitude);
            let new_lng = prev_point.longitude + ratio * (curr.longitude - prev_point.longitude);
            resampled.push(GpsPoint::new(new_lat, new_lng));
            next_threshold += step_dist;
        }

        accumulated += seg_dist;
        prev_point = curr;
    }

    // Always include the last point
    if resampled.len() < target_count {
        resampled.push(*points.last().unwrap());
    }

    resampled
}

/// Calculate the total distance of a route in meters.
pub fn calculate_route_distance(points: &[GpsPoint]) -> f64 {
    points
        .windows(2)
        .map(|w| haversine_distance(&w[0], &w[1]))
        .sum()
}

/// Determine direction using endpoint comparison.
///
/// Returns "same" if sig2 starts near sig1's start, "reverse" if near sig1's end.
pub fn determine_direction_by_endpoints(
    sig1: &RouteSignature,
    sig2: &RouteSignature,
    loop_threshold: f64,
) -> String {
    let start1 = &sig1.start_point;
    let end1 = &sig1.end_point;
    let start2 = &sig2.start_point;
    let end2 = &sig2.end_point;

    // Check if either route is a loop (start ≈ end)
    let sig1_is_loop = haversine_distance(start1, end1) < loop_threshold;
    let sig2_is_loop = haversine_distance(start2, end2) < loop_threshold;

    // If both are loops, direction is meaningless
    if sig1_is_loop && sig2_is_loop {
        return "same".to_string();
    }

    // Score for same direction: start2→start1 + end2→end1
    let same_score = haversine_distance(start2, start1) + haversine_distance(end2, end1);
    // Score for reverse direction: start2→end1 + end2→start1
    let reverse_score = haversine_distance(start2, end1) + haversine_distance(end2, start1);

    // Require a significant difference (100m) to call it 'reverse'
    let min_direction_diff = 100.0;

    if reverse_score < same_score - min_direction_diff {
        "reverse".to_string()
    } else {
        "same".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_route() -> Vec<GpsPoint> {
        vec![
            GpsPoint::new(51.5074, -0.1278),
            GpsPoint::new(51.5080, -0.1290),
            GpsPoint::new(51.5090, -0.1300),
            GpsPoint::new(51.5100, -0.1310),
            GpsPoint::new(51.5110, -0.1320),
        ]
    }

    #[test]
    fn test_amd_to_percentage() {
        // Below perfect threshold = 100%
        assert_eq!(amd_to_percentage(10.0, 30.0, 250.0), 100.0);

        // Above zero threshold = 0%
        assert_eq!(amd_to_percentage(300.0, 30.0, 250.0), 0.0);

        // At perfect threshold = 100%
        assert_eq!(amd_to_percentage(30.0, 30.0, 250.0), 100.0);

        // At zero threshold = 0%
        assert_eq!(amd_to_percentage(250.0, 30.0, 250.0), 0.0);

        // Midpoint
        let mid = amd_to_percentage(140.0, 30.0, 250.0);
        assert!(mid > 45.0 && mid < 55.0);
    }

    #[test]
    fn test_resample_route() {
        let points = sample_route();
        let resampled = resample_route(&points, 10);
        assert_eq!(resampled.len(), 10);

        // First and last points should be preserved
        assert_eq!(resampled[0].latitude, points[0].latitude);
        assert_eq!(
            resampled.last().unwrap().latitude,
            points.last().unwrap().latitude
        );
    }

    #[test]
    fn test_calculate_route_distance() {
        let points = sample_route();
        let distance = calculate_route_distance(&points);
        assert!(distance > 0.0);
    }

    #[test]
    fn test_identical_routes_match() {
        let points = sample_route();
        let sig1 = RouteSignature::from_points("test-1", &points, &MatchConfig::default()).unwrap();
        let sig2 = RouteSignature::from_points("test-2", &points, &MatchConfig::default()).unwrap();

        let result = compare_routes(&sig1, &sig2, &MatchConfig::default());
        assert!(result.is_some());
        let result = result.unwrap();
        assert!(result.match_percentage > 95.0);
    }
}
