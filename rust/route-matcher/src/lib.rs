//! # Route Matcher
//!
//! High-performance GPS route matching and activity fetching for intervals.icu.
//!
//! This library provides:
//! - GPS route matching using Average Minimum Distance (AMD)
//! - High-speed activity fetching with rate limiting
//! - Parallel processing for batch operations
//!
//! ## Features
//!
//! - **`parallel`** - Enable parallel processing with rayon
//! - **`http`** - Enable HTTP client for activity fetching
//! - **`ffi`** - Enable FFI bindings for mobile platforms (iOS/Android)
//! - **`full`** - Enable all features
//!
//! ## Quick Start
//!
//! ```rust
//! use route_matcher::{GpsPoint, RouteSignature, MatchConfig, compare_routes};
//!
//! // Create route signatures from GPS points
//! let route1 = vec![
//!     GpsPoint::new(51.5074, -0.1278),
//!     GpsPoint::new(51.5080, -0.1290),
//!     GpsPoint::new(51.5090, -0.1300),
//! ];
//!
//! let route2 = route1.clone(); // Same route
//!
//! let sig1 = RouteSignature::from_points("activity-1", &route1, &MatchConfig::default());
//! let sig2 = RouteSignature::from_points("activity-2", &route2, &MatchConfig::default());
//!
//! if let (Some(s1), Some(s2)) = (sig1, sig2) {
//!     if let Some(result) = compare_routes(&s1, &s2, &MatchConfig::default()) {
//!         println!("Match: {}% ({})", result.match_percentage, result.direction);
//!     }
//! }
//! ```

use geo::{
    Coord, LineString, Point,
    Haversine, Distance,
    algorithm::simplify::Simplify,
};
use rstar::{RTree, RTreeObject, AABB};
use std::collections::HashMap;

// HTTP module for activity fetching
#[cfg(feature = "http")]
pub mod http;

#[cfg(feature = "http")]
pub use http::{ActivityFetcher, ActivityMapResult, MapBounds};

// Frequent sections detection (vector-first algorithm for smooth polylines)
pub mod sections;
pub use sections::{FrequentSection, SectionConfig, detect_frequent_sections};

// Heatmap generation module
pub mod heatmap;
pub use heatmap::{
    HeatmapConfig, HeatmapBounds, HeatmapCell, HeatmapResult,
    RouteRef, CellQueryResult, ActivityHeatmapData,
    generate_heatmap, query_heatmap_cell,
};

#[cfg(feature = "ffi")]
uniffi::setup_scaffolding!();

/// Initialize logging for Android (only used in FFI)
#[cfg(all(feature = "ffi", target_os = "android"))]
fn init_logging() {
    use android_logger::Config;
    use log::LevelFilter;

    android_logger::init_once(
        Config::default()
            .with_max_level(LevelFilter::Debug)
            .with_tag("RouteMatcherRust")
    );
}

#[cfg(all(feature = "ffi", not(target_os = "android")))]
fn init_logging() {
    // No-op on non-Android platforms
}

// ============================================================================
// Core Types
// ============================================================================

/// A GPS coordinate with latitude and longitude.
///
/// # Example
/// ```
/// use route_matcher::GpsPoint;
/// let point = GpsPoint::new(51.5074, -0.1278); // London
/// ```
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct GpsPoint {
    pub latitude: f64,
    pub longitude: f64,
}

impl GpsPoint {
    /// Create a new GPS point.
    pub fn new(latitude: f64, longitude: f64) -> Self {
        Self { latitude, longitude }
    }

    /// Check if the point has valid coordinates.
    pub fn is_valid(&self) -> bool {
        self.latitude.is_finite()
            && self.longitude.is_finite()
            && self.latitude >= -90.0
            && self.latitude <= 90.0
            && self.longitude >= -180.0
            && self.longitude <= 180.0
    }
}

/// Bounding box for a route.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct Bounds {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
}

impl Bounds {
    /// Create bounds from GPS points.
    pub fn from_points(points: &[GpsPoint]) -> Option<Self> {
        if points.is_empty() {
            return None;
        }
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

        Some(Self { min_lat, max_lat, min_lng, max_lng })
    }

    /// Get the center point of the bounds.
    pub fn center(&self) -> GpsPoint {
        GpsPoint::new(
            (self.min_lat + self.max_lat) / 2.0,
            (self.min_lng + self.max_lng) / 2.0,
        )
    }
}

/// A simplified route signature for efficient matching.
///
/// The signature contains a simplified version of the original GPS track,
/// optimized for comparison using the Fréchet distance algorithm.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct RouteSignature {
    /// Unique identifier for the activity/route
    pub activity_id: String,
    /// Simplified GPS points
    pub points: Vec<GpsPoint>,
    /// Total route distance in meters
    pub total_distance: f64,
    /// Starting point of the route
    pub start_point: GpsPoint,
    /// Ending point of the route
    pub end_point: GpsPoint,
    /// Pre-computed bounding box (normalized, ready for use)
    pub bounds: Bounds,
    /// Pre-computed center point (for map rendering without JS calculation)
    pub center: GpsPoint,
}

impl RouteSignature {
    /// Create a route signature from raw GPS points.
    ///
    /// The points are simplified using the Douglas-Peucker algorithm and
    /// optionally limited to a maximum number of points.
    ///
    /// Returns `None` if the input has fewer than 2 valid points.
    ///
    /// # Example
    /// ```
    /// use route_matcher::{GpsPoint, RouteSignature, MatchConfig};
    ///
    /// let points = vec![
    ///     GpsPoint::new(51.5074, -0.1278),
    ///     GpsPoint::new(51.5080, -0.1290),
    ///     GpsPoint::new(51.5090, -0.1300),
    /// ];
    ///
    /// let signature = RouteSignature::from_points("my-route", &points, &MatchConfig::default());
    /// assert!(signature.is_some());
    /// ```
    pub fn from_points(activity_id: &str, points: &[GpsPoint], config: &MatchConfig) -> Option<Self> {
        if points.len() < 2 {
            return None;
        }

        // Filter invalid points and convert to geo coordinates
        let coords: Vec<Coord> = points
            .iter()
            .filter(|p| p.is_valid())
            .map(|p| Coord { x: p.longitude, y: p.latitude })
            .collect();

        if coords.len() < 2 {
            return None;
        }

        let line = LineString::new(coords);

        // Douglas-Peucker simplification
        let simplified = line.simplify(&config.simplification_tolerance);

        // Limit to max points if needed (uniform sampling)
        let final_coords: Vec<Coord> = if simplified.0.len() > config.max_simplified_points as usize {
            let step = simplified.0.len() as f64 / config.max_simplified_points as f64;
            (0..config.max_simplified_points)
                .map(|i| simplified.0[(i as f64 * step) as usize])
                .collect()
        } else {
            simplified.0.clone()
        };

        if final_coords.len() < 2 {
            return None;
        }

        let simplified_points: Vec<GpsPoint> = final_coords
            .iter()
            .map(|c| GpsPoint::new(c.y, c.x))
            .collect();

        let total_distance = calculate_route_distance(&simplified_points);

        // Pre-compute bounds and center for 120Hz map rendering
        let bounds = Bounds::from_points(&simplified_points)?;
        let center = bounds.center();

        Some(Self {
            activity_id: activity_id.to_string(),
            start_point: simplified_points[0],
            end_point: simplified_points[simplified_points.len() - 1],
            points: simplified_points,
            total_distance,
            bounds,
            center,
        })
    }

    /// Get the bounding box of this route as RouteBounds (for R-tree indexing).
    pub fn route_bounds(&self) -> RouteBounds {
        RouteBounds {
            activity_id: self.activity_id.clone(),
            min_lat: self.bounds.min_lat,
            max_lat: self.bounds.max_lat,
            min_lng: self.bounds.min_lng,
            max_lng: self.bounds.max_lng,
            distance: self.total_distance,
        }
    }
}

/// Result of comparing two routes.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct MatchResult {
    /// ID of the first route
    pub activity_id_1: String,
    /// ID of the second route
    pub activity_id_2: String,
    /// Match percentage (0-100, higher = better match)
    pub match_percentage: f64,
    /// Direction: "same", "reverse", or "partial"
    pub direction: String,
    /// Average Minimum Distance in meters (lower = better match)
    pub amd: f64,
}

/// Configuration for route matching algorithms.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct MatchConfig {
    /// AMD threshold for perfect match (100%). Routes with AMD below this are considered identical.
    /// Default: 30.0 meters (accounts for GPS variance of 5-10m)
    pub perfect_threshold: f64,

    /// AMD threshold for no match (0%). Routes with AMD above this are considered different.
    /// Default: 250.0 meters
    pub zero_threshold: f64,

    /// Minimum match percentage to consider routes similar.
    /// Default: 65.0% (lowered from 80% to account for GPS variance)
    pub min_match_percentage: f64,

    /// Minimum route distance to be considered for grouping.
    /// Default: 500.0 meters
    pub min_route_distance: f64,

    /// Maximum distance difference ratio for grouping (within 20%).
    /// Default: 0.20
    pub max_distance_diff_ratio: f64,

    /// Endpoint threshold for matching start/end points.
    /// Default: 200.0 meters
    pub endpoint_threshold: f64,

    /// Number of points to resample routes to for comparison.
    /// Default: 50
    pub resample_count: u32,

    /// Tolerance for Douglas-Peucker simplification (in degrees).
    /// Smaller values preserve more detail. Default: 0.0001 (~11 meters)
    pub simplification_tolerance: f64,

    /// Maximum points after simplification.
    /// Fewer points = faster comparison. Default: 100
    pub max_simplified_points: u32,
}

impl Default for MatchConfig {
    fn default() -> Self {
        Self {
            perfect_threshold: 30.0,
            zero_threshold: 250.0,
            min_match_percentage: 65.0,
            min_route_distance: 500.0,
            max_distance_diff_ratio: 0.20,
            endpoint_threshold: 200.0,
            resample_count: 50,
            simplification_tolerance: 0.0001,
            max_simplified_points: 100,
        }
    }
}

/// A group of similar routes.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct RouteGroup {
    /// Unique identifier for this group (typically the first activity ID)
    pub group_id: String,
    /// All activity IDs that belong to this group
    pub activity_ids: Vec<String>,
}

/// Bounding box for a route (used for spatial indexing).
#[derive(Debug, Clone)]
pub struct RouteBounds {
    pub activity_id: String,
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
    pub distance: f64,
}

impl RTreeObject for RouteBounds {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            [self.min_lng, self.min_lat],
            [self.max_lng, self.max_lat],
        )
    }
}

// ============================================================================
// Core Functions
// ============================================================================

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
/// use route_matcher::{GpsPoint, RouteSignature, MatchConfig, compare_routes};
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
/// For each point in route1, find the minimum distance to any point in route2.
/// Return the average of these minimum distances.
fn average_min_distance(route1: &[GpsPoint], route2: &[GpsPoint]) -> f64 {
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
/// - AMD <= perfect_threshold → 100% match
/// - AMD >= zero_threshold → 0% match
/// - Linear interpolation between
fn amd_to_percentage(amd: f64, perfect_threshold: f64, zero_threshold: f64) -> f64 {
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
fn resample_route(points: &[GpsPoint], target_count: usize) -> Vec<GpsPoint> {
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
fn calculate_route_distance(points: &[GpsPoint]) -> f64 {
    points
        .windows(2)
        .map(|w| haversine_distance(&w[0], &w[1]))
        .sum()
}

/// Calculate haversine distance between two GPS points in meters.
fn haversine_distance(p1: &GpsPoint, p2: &GpsPoint) -> f64 {
    let point1 = Point::new(p1.longitude, p1.latitude);
    let point2 = Point::new(p2.longitude, p2.latitude);
    Haversine::distance(point1, point2)
}

/// Determine direction using endpoint comparison.
/// Returns "same" if sig2 starts near sig1's start, "reverse" if near sig1's end.
fn determine_direction_by_endpoints(
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
fn should_group_routes(
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
fn check_middle_points_match(points1: &[GpsPoint], points2: &[GpsPoint], threshold: f64) -> bool {
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
///
/// # Example
/// ```
/// use route_matcher::{GpsPoint, RouteSignature, MatchConfig, group_signatures};
///
/// // Create a route long enough to meet min_route_distance (500m)
/// // Each point is ~111m apart (0.001 degrees latitude)
/// let points: Vec<GpsPoint> = (0..10)
///     .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278))
///     .collect();
///
/// let sig1 = RouteSignature::from_points("a", &points, &MatchConfig::default()).unwrap();
/// let sig2 = RouteSignature::from_points("b", &points, &MatchConfig::default()).unwrap();
///
/// let groups = group_signatures(&[sig1, sig2], &MatchConfig::default());
/// assert_eq!(groups.len(), 1); // Both routes in same group
/// ```
pub fn group_signatures(signatures: &[RouteSignature], config: &MatchConfig) -> Vec<RouteGroup> {
    if signatures.is_empty() {
        return vec![];
    }

    // Build spatial index
    let bounds: Vec<RouteBounds> = signatures.iter().map(|s| s.route_bounds()).collect();
    let rtree = RTree::bulk_load(bounds.clone());

    // Create signature lookup
    let sig_map: HashMap<&str, &RouteSignature> = signatures
        .iter()
        .map(|s| (s.activity_id.as_str(), s))
        .collect();

    // Union-Find
    let mut parent: HashMap<String, String> = signatures
        .iter()
        .map(|s| (s.activity_id.clone(), s.activity_id.clone()))
        .collect();

    // Find matching pairs
    let tolerance = 0.01; // ~1km

    for sig1 in signatures {
        let (min_lat, max_lat, min_lng, max_lng) = calculate_bounds(&sig1.points);
        let search_bounds = AABB::from_corners(
            [min_lng - tolerance, min_lat - tolerance],
            [max_lng + tolerance, max_lat + tolerance],
        );

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
                        union(&mut parent, &sig1.activity_id, &sig2.activity_id);
                    }
                }
            }
        }
    }

    // Build groups
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    for sig in signatures {
        let root = find(&mut parent, &sig.activity_id);
        groups.entry(root).or_default().push(sig.activity_id.clone());
    }

    groups
        .into_iter()
        .map(|(group_id, activity_ids)| RouteGroup { group_id, activity_ids })
        .collect()
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
    let rtree = RTree::bulk_load(bounds.clone());

    // Create signature lookup
    let sig_map: HashMap<&str, &RouteSignature> = signatures
        .iter()
        .map(|s| (s.activity_id.as_str(), s))
        .collect();

    // Find matches in parallel (with strict grouping criteria)
    let tolerance = 0.01;
    let matches: Vec<(String, String)> = signatures
        .par_iter()
        .flat_map(|sig1| {
            let (min_lat, max_lat, min_lng, max_lng) = calculate_bounds(&sig1.points);
            let search_bounds = AABB::from_corners(
                [min_lng - tolerance, min_lat - tolerance],
                [max_lng + tolerance, max_lat + tolerance],
            );

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
    let mut parent: HashMap<String, String> = signatures
        .iter()
        .map(|s| (s.activity_id.clone(), s.activity_id.clone()))
        .collect();

    for (id1, id2) in matches {
        union(&mut parent, &id1, &id2);
    }

    // Build groups
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    for sig in signatures {
        let root = find(&mut parent, &sig.activity_id);
        groups.entry(root).or_default().push(sig.activity_id.clone());
    }

    groups
        .into_iter()
        .map(|(group_id, activity_ids)| RouteGroup { group_id, activity_ids })
        .collect()
}

/// Incremental grouping: efficiently add new signatures to existing groups.
///
/// This is much faster than re-grouping all signatures when adding new activities:
/// - O(n×m) instead of O(n²) where n = existing, m = new
/// - Only compares: new vs existing AND new vs new
/// - Existing signatures are NOT compared against each other (already grouped)
///
/// # Arguments
/// * `new_signatures` - New signatures to add
/// * `existing_groups` - Current group structure
/// * `existing_signatures` - All existing signatures (for comparison)
/// * `config` - Matching configuration
///
/// # Returns
/// Updated groups including new signatures
#[cfg(feature = "parallel")]
pub fn group_incremental(
    new_signatures: &[RouteSignature],
    existing_groups: &[RouteGroup],
    existing_signatures: &[RouteSignature],
    config: &MatchConfig,
) -> Vec<RouteGroup> {
    use rayon::prelude::*;

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
    let new_ids: std::collections::HashSet<&str> = new_signatures
        .iter()
        .map(|s| s.activity_id.as_str())
        .collect();

    // Initialize Union-Find with existing group structure
    let mut parent: HashMap<String, String> = HashMap::new();

    // For existing groups: point all members to the group's representative (first member)
    for group in existing_groups {
        if !group.activity_ids.is_empty() {
            let representative = &group.activity_ids[0];
            for id in &group.activity_ids {
                parent.insert(id.clone(), representative.clone());
            }
        }
    }

    // For new signatures: each is its own parent initially
    for sig in new_signatures {
        parent.insert(sig.activity_id.clone(), sig.activity_id.clone());
    }

    // Find matches in parallel - but ONLY where at least one signature is new
    let tolerance = 0.01;
    let matches: Vec<(String, String)> = new_signatures
        .par_iter()
        .flat_map(|new_sig| {
            let search_bounds = AABB::from_corners(
                [new_sig.bounds.min_lng - tolerance, new_sig.bounds.min_lat - tolerance],
                [new_sig.bounds.max_lng + tolerance, new_sig.bounds.max_lat + tolerance],
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
                    if !other_is_new {
                        // new vs existing - always check
                    } else {
                        // new vs new - only check once (lexicographic ordering)
                        if new_sig.activity_id >= b.activity_id {
                            return None;
                        }
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
        union(&mut parent, &id1, &id2);
    }

    // Build groups from all signatures
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    for sig in all_signatures {
        let root = find(&mut parent, &sig.activity_id);
        groups.entry(root).or_default().push(sig.activity_id.clone());
    }

    groups
        .into_iter()
        .map(|(group_id, activity_ids)| RouteGroup { group_id, activity_ids })
        .collect()
}

// ============================================================================
// FFI Exports (only when feature enabled)
// ============================================================================

#[cfg(feature = "ffi")]
mod ffi {
    use super::*;
    use log::{info, debug};

    // ========================================================================
    // Progress Callback Interface (for real-time updates to mobile)
    // ========================================================================

    /// Callback interface for receiving progress updates during fetch operations.
    /// Implement this in Kotlin/Swift to receive real-time updates.
    #[uniffi::export(callback_interface)]
    pub trait FetchProgressCallback: Send + Sync {
        /// Called when a single activity fetch completes.
        /// - completed: Number of activities fetched so far
        /// - total: Total number of activities to fetch
        fn on_progress(&self, completed: u32, total: u32);
    }

    /// Create a route signature from GPS points.
    #[uniffi::export]
    pub fn create_signature(activity_id: String, points: Vec<GpsPoint>) -> Option<RouteSignature> {
        init_logging();
        info!("[RouteMatcherRust] 🦀 create_signature called for {} with {} points", activity_id, points.len());
        let result = RouteSignature::from_points(&activity_id, &points, &MatchConfig::default());
        if let Some(ref sig) = result {
            info!("[RouteMatcherRust] 🦀 Created signature: {} points, {:.0}m distance", sig.points.len(), sig.total_distance);
        }
        result
    }

    /// Create a route signature with custom configuration.
    #[uniffi::export]
    pub fn create_signature_with_config(
        activity_id: String,
        points: Vec<GpsPoint>,
        config: MatchConfig,
    ) -> Option<RouteSignature> {
        init_logging();
        info!("[RouteMatcherRust] 🦀 create_signature_with_config for {} ({} points)", activity_id, points.len());
        RouteSignature::from_points(&activity_id, &points, &config)
    }

    /// Compare two routes and return match result.
    #[uniffi::export]
    pub fn ffi_compare_routes(
        sig1: &RouteSignature,
        sig2: &RouteSignature,
        config: MatchConfig,
    ) -> Option<MatchResult> {
        init_logging();
        debug!("[RouteMatcherRust] 🦀 Comparing {} vs {}", sig1.activity_id, sig2.activity_id);
        let result = compare_routes(sig1, sig2, &config);
        if let Some(ref r) = result {
            info!("[RouteMatcherRust] 🦀 Match found: {:.1}% ({})", r.match_percentage, r.direction);
        }
        result
    }

    /// Group signatures into route groups.
    #[uniffi::export]
    pub fn ffi_group_signatures(
        signatures: Vec<RouteSignature>,
        config: MatchConfig,
    ) -> Vec<RouteGroup> {
        init_logging();
        info!("[RouteMatcherRust] 🦀🦀🦀 RUST groupSignatures called with {} signatures 🦀🦀🦀", signatures.len());

        let start = std::time::Instant::now();

        #[cfg(feature = "parallel")]
        let groups = {
            info!("[RouteMatcherRust] 🦀 Using PARALLEL processing (rayon)");
            group_signatures_parallel(&signatures, &config)
        };

        #[cfg(not(feature = "parallel"))]
        let groups = {
            info!("[RouteMatcherRust] 🦀 Using sequential processing");
            group_signatures(&signatures, &config)
        };

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] 🦀 Grouped into {} groups in {:?}", groups.len(), elapsed);

        groups
    }

    /// Incremental grouping: efficiently add new signatures to existing groups.
    /// Only compares new vs existing and new vs new - O(n×m) instead of O(n²).
    #[uniffi::export]
    pub fn ffi_group_incremental(
        new_signatures: Vec<RouteSignature>,
        existing_groups: Vec<RouteGroup>,
        existing_signatures: Vec<RouteSignature>,
        config: MatchConfig,
    ) -> Vec<RouteGroup> {
        init_logging();
        info!(
            "[RouteMatcherRust] 🦀 INCREMENTAL grouping: {} new + {} existing signatures",
            new_signatures.len(),
            existing_signatures.len()
        );

        let start = std::time::Instant::now();

        #[cfg(feature = "parallel")]
        let groups = group_incremental(&new_signatures, &existing_groups, &existing_signatures, &config);

        #[cfg(not(feature = "parallel"))]
        let groups = {
            // Fallback to full re-grouping if parallel feature not enabled
            let all_sigs: Vec<RouteSignature> = existing_signatures
                .into_iter()
                .chain(new_signatures.into_iter())
                .collect();
            group_signatures(&all_sigs, &config)
        };

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] 🦀 Incremental grouped into {} groups in {:?}", groups.len(), elapsed);

        groups
    }

    /// Get default configuration.
    #[uniffi::export]
    pub fn default_config() -> MatchConfig {
        init_logging();
        info!("[RouteMatcherRust] 🦀 default_config called - Rust is active!");
        MatchConfig::default()
    }

    /// Input for batch signature creation
    #[derive(Debug, Clone, uniffi::Record)]
    pub struct GpsTrack {
        pub activity_id: String,
        pub points: Vec<GpsPoint>,
    }

    /// Input for flat buffer batch processing (zero-copy from JS TypedArray)
    #[derive(Debug, Clone, uniffi::Record)]
    pub struct FlatGpsTrack {
        pub activity_id: String,
        /// Flat array of coordinates: [lat1, lng1, lat2, lng2, ...]
        pub coords: Vec<f64>,
    }

    /// Create signatures from flat coordinate buffers (optimized for TypedArray input).
    /// Each track's coords array contains [lat1, lng1, lat2, lng2, ...].
    /// This avoids the overhead of deserializing GpsPoint objects.
    #[uniffi::export]
    pub fn create_signatures_from_flat(tracks: Vec<FlatGpsTrack>, config: MatchConfig) -> Vec<RouteSignature> {
        init_logging();
        info!("[RouteMatcherRust] 🦀🦀🦀 FLAT BUFFER createSignatures called with {} tracks 🦀🦀🦀", tracks.len());

        let start = std::time::Instant::now();

        #[cfg(feature = "parallel")]
        let signatures: Vec<RouteSignature> = {
            use rayon::prelude::*;
            info!("[RouteMatcherRust] 🦀 Using PARALLEL flat buffer processing (rayon)");
            tracks
                .par_iter()
                .filter_map(|track| {
                    // Convert flat coords to GpsPoints
                    let points: Vec<GpsPoint> = track.coords
                        .chunks_exact(2)
                        .map(|chunk| GpsPoint::new(chunk[0], chunk[1]))
                        .collect();
                    RouteSignature::from_points(&track.activity_id, &points, &config)
                })
                .collect()
        };

        #[cfg(not(feature = "parallel"))]
        let signatures: Vec<RouteSignature> = {
            info!("[RouteMatcherRust] 🦀 Using sequential flat buffer processing");
            tracks
                .iter()
                .filter_map(|track| {
                    let points: Vec<GpsPoint> = track.coords
                        .chunks_exact(2)
                        .map(|chunk| GpsPoint::new(chunk[0], chunk[1]))
                        .collect();
                    RouteSignature::from_points(&track.activity_id, &points, &config)
                })
                .collect()
        };

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] 🦀 FLAT created {} signatures from {} tracks in {:?}",
              signatures.len(), tracks.len(), elapsed);

        signatures
    }

    /// Process routes end-to-end from flat buffers: create signatures AND group them.
    /// Most efficient way to process many activities from TypedArray input.
    #[uniffi::export]
    pub fn process_routes_from_flat(tracks: Vec<FlatGpsTrack>, config: MatchConfig) -> Vec<RouteGroup> {
        init_logging();
        info!("[RouteMatcherRust] 🦀🦀🦀 FLAT BATCH process_routes called with {} tracks 🦀🦀🦀", tracks.len());

        let start = std::time::Instant::now();

        // Step 1: Create all signatures from flat buffers
        let signatures = create_signatures_from_flat(tracks.clone(), config.clone());

        // Step 2: Group signatures
        #[cfg(feature = "parallel")]
        let groups = group_signatures_parallel(&signatures, &config);

        #[cfg(not(feature = "parallel"))]
        let groups = group_signatures(&signatures, &config);

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] 🦀 FLAT batch processing: {} signatures -> {} groups in {:?}",
              signatures.len(), groups.len(), elapsed);

        groups
    }

    /// Create multiple route signatures in parallel (batch processing).
    /// Much faster than calling create_signature repeatedly due to:
    /// 1. Single FFI call instead of N calls
    /// 2. Parallel processing with rayon
    #[uniffi::export]
    pub fn create_signatures_batch(tracks: Vec<GpsTrack>, config: MatchConfig) -> Vec<RouteSignature> {
        init_logging();
        info!("[RouteMatcherRust] 🦀🦀🦀 BATCH create_signatures called with {} tracks 🦀🦀🦀", tracks.len());

        let start = std::time::Instant::now();

        #[cfg(feature = "parallel")]
        let signatures: Vec<RouteSignature> = {
            use rayon::prelude::*;
            info!("[RouteMatcherRust] 🦀 Using PARALLEL signature creation (rayon)");
            tracks
                .par_iter()
                .filter_map(|track| {
                    RouteSignature::from_points(&track.activity_id, &track.points, &config)
                })
                .collect()
        };

        #[cfg(not(feature = "parallel"))]
        let signatures: Vec<RouteSignature> = {
            info!("[RouteMatcherRust] 🦀 Using sequential signature creation");
            tracks
                .iter()
                .filter_map(|track| {
                    RouteSignature::from_points(&track.activity_id, &track.points, &config)
                })
                .collect()
        };

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] 🦀 Created {} signatures from {} tracks in {:?}",
              signatures.len(), tracks.len(), elapsed);

        signatures
    }

    /// Process routes end-to-end: create signatures AND group them in one call.
    /// This is the most efficient way to process many activities.
    #[uniffi::export]
    pub fn process_routes_batch(tracks: Vec<GpsTrack>, config: MatchConfig) -> Vec<RouteGroup> {
        init_logging();
        info!("[RouteMatcherRust] 🦀🦀🦀 FULL BATCH process_routes called with {} tracks 🦀🦀🦀", tracks.len());

        let start = std::time::Instant::now();

        // Step 1: Create all signatures in parallel
        let signatures = create_signatures_batch(tracks, config.clone());

        // Step 2: Group signatures (also parallel if feature enabled)
        #[cfg(feature = "parallel")]
        let groups = group_signatures_parallel(&signatures, &config);

        #[cfg(not(feature = "parallel"))]
        let groups = group_signatures(&signatures, &config);

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] 🦀 Full batch processing: {} signatures -> {} groups in {:?}",
              signatures.len(), groups.len(), elapsed);

        groups
    }

    // ========================================================================
    // HTTP Activity Fetching (requires "http" feature)
    // ========================================================================

    /// Result of fetching activity map data from intervals.icu
    #[cfg(feature = "http")]
    #[derive(Debug, Clone, uniffi::Record)]
    pub struct FfiActivityMapResult {
        pub activity_id: String,
        /// Bounds as [ne_lat, ne_lng, sw_lat, sw_lng] or empty if no bounds
        pub bounds: Vec<f64>,
        /// GPS coordinates as flat array [lat1, lng1, lat2, lng2, ...]
        pub latlngs: Vec<f64>,
        pub success: bool,
        pub error: Option<String>,
    }

    /// Fetch map data for multiple activities in parallel.
    ///
    /// This function respects intervals.icu rate limits:
    /// - 30 req/s burst limit
    /// - 131 req/10s sustained limit
    ///
    /// Uses connection pooling and parallel fetching for maximum performance.
    /// Automatically retries on 429 errors with exponential backoff.
    #[cfg(feature = "http")]
    #[uniffi::export]
    pub fn fetch_activity_maps(
        api_key: String,
        activity_ids: Vec<String>,
    ) -> Vec<FfiActivityMapResult> {
        init_logging();
        info!("[RouteMatcherRust] 🦀 fetch_activity_maps called for {} activities", activity_ids.len());

        let results = crate::http::fetch_activity_maps_sync(api_key, activity_ids, None);

        // Convert to FFI-friendly format
        results
            .into_iter()
            .map(|r| FfiActivityMapResult {
                activity_id: r.activity_id,
                bounds: r.bounds.map_or(vec![], |b| vec![b.ne[0], b.ne[1], b.sw[0], b.sw[1]]),
                latlngs: r.latlngs.map_or(vec![], |coords| {
                    coords.into_iter().flat_map(|p| vec![p[0], p[1]]).collect()
                }),
                success: r.success,
                error: r.error,
            })
            .collect()
    }

    /// Fetch map data with real-time progress callbacks.
    ///
    /// Same as fetch_activity_maps but calls the progress callback after each
    /// activity is fetched, allowing the UI to show real-time progress.
    #[cfg(feature = "http")]
    #[uniffi::export]
    pub fn fetch_activity_maps_with_progress(
        api_key: String,
        activity_ids: Vec<String>,
        callback: Box<dyn FetchProgressCallback>,
    ) -> Vec<FfiActivityMapResult> {
        use std::sync::Arc;

        init_logging();
        info!("[RouteMatcherRust] 🦀 fetch_activity_maps_with_progress called for {} activities", activity_ids.len());

        // Wrap the callback to match the expected type
        let callback = Arc::new(callback);
        let progress_callback: crate::http::ProgressCallback = Arc::new(move |completed, total| {
            callback.on_progress(completed, total);
        });

        let results = crate::http::fetch_activity_maps_sync(
            api_key,
            activity_ids,
            Some(progress_callback),
        );

        // Convert to FFI-friendly format
        results
            .into_iter()
            .map(|r| FfiActivityMapResult {
                activity_id: r.activity_id,
                bounds: r.bounds.map_or(vec![], |b| vec![b.ne[0], b.ne[1], b.sw[0], b.sw[1]]),
                latlngs: r.latlngs.map_or(vec![], |coords| {
                    coords.into_iter().flat_map(|p| vec![p[0], p[1]]).collect()
                }),
                success: r.success,
                error: r.error,
            })
            .collect()
    }

    /// Result of fetch_and_process_activities
    #[cfg(feature = "http")]
    #[derive(Debug, Clone, uniffi::Record)]
    pub struct FetchAndProcessResult {
        pub map_results: Vec<FfiActivityMapResult>,
        pub signatures: Vec<RouteSignature>,
    }

    // ========================================================================
    // Frequent Sections Detection
    // ========================================================================

    /// Input mapping activity IDs to sport types
    #[derive(Debug, Clone, uniffi::Record)]
    pub struct ActivitySportType {
        pub activity_id: String,
        pub sport_type: String,
    }

    /// Detect frequent sections from route signatures.
    /// Returns sections sorted by visit count (most visited first).
    #[uniffi::export]
    pub fn ffi_detect_frequent_sections(
        signatures: Vec<RouteSignature>,
        groups: Vec<RouteGroup>,
        sport_types: Vec<ActivitySportType>,
        config: crate::SectionConfig,
    ) -> Vec<crate::FrequentSection> {
        init_logging();
        info!(
            "[RouteMatcherRust] 🦀 detect_frequent_sections: {} signatures, {} sport types",
            signatures.len(),
            sport_types.len()
        );

        let start = std::time::Instant::now();

        // Convert sport types to HashMap
        let sport_map: std::collections::HashMap<String, String> = sport_types
            .into_iter()
            .map(|st| (st.activity_id, st.sport_type))
            .collect();

        let sections = crate::sections::detect_frequent_sections(
            &signatures,
            &groups,
            &sport_map,
            &config,
        );

        let elapsed = start.elapsed();
        info!(
            "[RouteMatcherRust] 🦀 Found {} frequent sections in {:?}",
            sections.len(),
            elapsed
        );

        sections
    }

    /// Get default section detection configuration
    #[uniffi::export]
    pub fn default_section_config() -> crate::SectionConfig {
        crate::SectionConfig::default()
    }

    /// Fetch map data AND create route signatures in one call.
    /// Most efficient for initial sync - fetches from API and processes GPS data.
    #[cfg(feature = "http")]
    #[uniffi::export]
    pub fn fetch_and_process_activities(
        api_key: String,
        activity_ids: Vec<String>,
        config: MatchConfig,
    ) -> FetchAndProcessResult {
        init_logging();
        info!("[RouteMatcherRust] 🦀 fetch_and_process_activities for {} activities", activity_ids.len());

        let start = std::time::Instant::now();

        // Fetch all activity maps
        let results = crate::http::fetch_activity_maps_sync(api_key, activity_ids, None);

        // Convert to FFI format and create signatures from successful fetches
        let mut map_results = Vec::with_capacity(results.len());
        let mut signatures = Vec::new();

        for r in results {
            let bounds_vec = r.bounds.as_ref().map_or(vec![], |b| {
                vec![b.ne[0], b.ne[1], b.sw[0], b.sw[1]]
            });

            let latlngs_flat: Vec<f64> = r.latlngs.as_ref().map_or(vec![], |coords| {
                coords.iter().flat_map(|p| vec![p[0], p[1]]).collect()
            });

            // Create signature if we have GPS data
            if r.success && r.latlngs.is_some() {
                let points: Vec<GpsPoint> = r.latlngs.as_ref().unwrap()
                    .iter()
                    .map(|p| GpsPoint::new(p[0], p[1]))
                    .collect();

                if let Some(sig) = RouteSignature::from_points(&r.activity_id, &points, &config) {
                    signatures.push(sig);
                }
            }

            map_results.push(FfiActivityMapResult {
                activity_id: r.activity_id,
                bounds: bounds_vec,
                latlngs: latlngs_flat,
                success: r.success,
                error: r.error,
            });
        }

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] 🦀 Fetched {} activities, created {} signatures in {:?}",
              map_results.len(), signatures.len(), elapsed);

        FetchAndProcessResult { map_results, signatures }
    }

    // ========================================================================
    // Heatmap Generation FFI
    // ========================================================================

    /// Generate a heatmap from route signatures.
    /// Uses the simplified GPS traces (~100 points each) for efficient generation.
    #[uniffi::export]
    pub fn ffi_generate_heatmap(
        signatures: Vec<RouteSignature>,
        activity_data: Vec<crate::ActivityHeatmapData>,
        config: crate::HeatmapConfig,
    ) -> crate::HeatmapResult {
        init_logging();
        info!(
            "[RouteMatcherRust] 🦀 generate_heatmap: {} signatures, {}m cells",
            signatures.len(),
            config.cell_size_meters
        );

        let start = std::time::Instant::now();

        // Convert Vec to HashMap for efficient lookup
        let data_map: std::collections::HashMap<String, crate::ActivityHeatmapData> =
            activity_data.into_iter()
                .map(|d| (d.activity_id.clone(), d))
                .collect();

        let result = crate::generate_heatmap(&signatures, &data_map, &config);

        let elapsed = start.elapsed();
        info!(
            "[RouteMatcherRust] 🦀 Heatmap generated: {} cells, {} routes, {} activities in {:?}",
            result.cells.len(),
            result.total_routes,
            result.total_activities,
            elapsed
        );

        result
    }

    /// Query the heatmap at a specific location.
    #[uniffi::export]
    pub fn ffi_query_heatmap_cell(
        heatmap: crate::HeatmapResult,
        lat: f64,
        lng: f64,
    ) -> Option<crate::CellQueryResult> {
        crate::query_heatmap_cell(&heatmap, lat, lng, heatmap.cell_size_meters)
    }

    /// Get default heatmap configuration.
    #[uniffi::export]
    pub fn default_heatmap_config() -> crate::HeatmapConfig {
        crate::HeatmapConfig::default()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

fn calculate_bounds(points: &[GpsPoint]) -> (f64, f64, f64, f64) {
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

    (min_lat, max_lat, min_lng, max_lng)
}

fn distance_ratio_ok(d1: f64, d2: f64) -> bool {
    if d1 <= 0.0 || d2 <= 0.0 {
        return false;
    }
    let ratio = if d1 > d2 { d2 / d1 } else { d1 / d2 };
    ratio >= 0.5
}

fn find(parent: &mut HashMap<String, String>, id: &str) -> String {
    let current = parent.get(id).cloned().unwrap_or_else(|| id.to_string());
    if current == id {
        return id.to_string();
    }
    let root = find(parent, &current);
    parent.insert(id.to_string(), root.clone());
    root
}

fn union(parent: &mut HashMap<String, String>, id1: &str, id2: &str) {
    let root1 = find(parent, id1);
    let root2 = find(parent, id2);
    if root1 != root2 {
        parent.insert(root2, root1);
    }
}

// ============================================================================
// Tests
// ============================================================================

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
    fn test_gps_point_validation() {
        assert!(GpsPoint::new(51.5074, -0.1278).is_valid());
        assert!(!GpsPoint::new(91.0, 0.0).is_valid());
        assert!(!GpsPoint::new(0.0, 181.0).is_valid());
        assert!(!GpsPoint::new(f64::NAN, 0.0).is_valid());
    }

    #[test]
    fn test_create_signature() {
        let points = sample_route();
        let sig = RouteSignature::from_points("test-1", &points, &MatchConfig::default());

        assert!(sig.is_some());
        let sig = sig.unwrap();
        assert_eq!(sig.activity_id, "test-1");
        assert!(sig.total_distance > 0.0);
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
        // Direction is "same" when routes go the same direction
        assert_eq!(result.direction, "same");
    }

    #[test]
    fn test_reverse_routes_match() {
        let points = sample_route();
        let mut reversed = points.clone();
        reversed.reverse();

        let sig1 = RouteSignature::from_points("test-1", &points, &MatchConfig::default()).unwrap();
        let sig2 = RouteSignature::from_points("test-2", &reversed, &MatchConfig::default()).unwrap();

        let result = compare_routes(&sig1, &sig2, &MatchConfig::default());
        assert!(result.is_some());
        assert_eq!(result.unwrap().direction, "reverse");
    }

    #[test]
    fn test_group_signatures() {
        // Create a longer route that meets min_route_distance (500m)
        // Each point is about 100m apart, 10 points = ~1km
        let long_route: Vec<GpsPoint> = (0..10)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278))
            .collect();

        let different_route: Vec<GpsPoint> = (0..10)
            .map(|i| GpsPoint::new(40.7128 + i as f64 * 0.001, -74.0060))
            .collect();

        let sig1 = RouteSignature::from_points("test-1", &long_route, &MatchConfig::default()).unwrap();
        let sig2 = RouteSignature::from_points("test-2", &long_route, &MatchConfig::default()).unwrap();
        let sig3 = RouteSignature::from_points("test-3", &different_route, &MatchConfig::default()).unwrap();

        let groups = group_signatures(&[sig1, sig2, sig3], &MatchConfig::default());

        // Should have 2 groups: one with test-1 and test-2, one with test-3
        assert_eq!(groups.len(), 2);

        // Verify the grouping is correct
        let group_with_1 = groups.iter().find(|g| g.activity_ids.contains(&"test-1".to_string())).unwrap();
        assert!(group_with_1.activity_ids.contains(&"test-2".to_string()));
        assert!(!group_with_1.activity_ids.contains(&"test-3".to_string()));
    }

}
