//! # Route Matcher
//!
//! High-performance GPS route matching using Fréchet distance and spatial indexing.
//!
//! This library provides algorithms for:
//! - Comparing GPS routes to find similarities
//! - Detecting forward/reverse route matches
//! - Grouping similar routes together efficiently
//!
//! ## Features
//!
//! - **`parallel`** - Enable parallel processing with rayon (recommended for batch operations)
//! - **`ffi`** - Enable FFI bindings for mobile platforms (iOS/Android) via UniFFI
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
//!
//! ## Batch Grouping
//!
//! For grouping many routes efficiently, use `group_signatures`:
//!
//! ```rust,ignore
//! use route_matcher::{RouteSignature, MatchConfig, group_signatures};
//!
//! let signatures: Vec<RouteSignature> = /* ... */;
//! let groups = group_signatures(&signatures, &MatchConfig::default());
//!
//! for group in groups {
//!     println!("Group {}: {:?}", group.group_id, group.activity_ids);
//! }
//! ```

use geo::{
    Coord, LineString, Point,
    Haversine, Distance,
    algorithm::frechet_distance::FrechetDistance,
    algorithm::simplify::Simplify,
};
use log::{info, debug, warn};
use rstar::{RTree, RTreeObject, AABB};
use std::collections::HashMap;

#[cfg(feature = "ffi")]
uniffi::setup_scaffolding!();

/// Initialize logging for Android
#[cfg(target_os = "android")]
fn init_logging() {
    use android_logger::Config;
    use log::LevelFilter;

    android_logger::init_once(
        Config::default()
            .with_max_level(LevelFilter::Debug)
            .with_tag("RouteMatcherRust")
    );
}

#[cfg(not(target_os = "android"))]
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

        let total_distance = calculate_line_distance(&final_coords);

        let simplified_points: Vec<GpsPoint> = final_coords
            .iter()
            .map(|c| GpsPoint::new(c.y, c.x))
            .collect();

        Some(Self {
            activity_id: activity_id.to_string(),
            start_point: simplified_points[0],
            end_point: simplified_points[simplified_points.len() - 1],
            points: simplified_points,
            total_distance,
        })
    }

    /// Get the bounding box of this route.
    pub fn bounds(&self) -> RouteBounds {
        let (min_lat, max_lat, min_lng, max_lng) = calculate_bounds(&self.points);
        RouteBounds {
            activity_id: self.activity_id.clone(),
            min_lat,
            max_lat,
            min_lng,
            max_lng,
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
    /// Direction: "forward", "reverse", or "partial"
    pub direction: String,
    /// Raw Fréchet distance in meters
    pub frechet_distance: f64,
}

/// Configuration for route matching algorithms.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct MatchConfig {
    /// Maximum Fréchet distance in meters for routes to be considered similar.
    /// Default: 100.0 meters
    pub max_frechet_distance: f64,

    /// Minimum match percentage to consider routes similar.
    /// Default: 80.0%
    pub min_match_percentage: f64,

    /// Tolerance for Douglas-Peucker simplification (in degrees).
    /// Smaller values preserve more detail. Default: 0.0001 (~11 meters)
    pub simplification_tolerance: f64,

    /// Maximum points after simplification.
    /// Fewer points = faster comparison. Default: 50
    pub max_simplified_points: u32,
}

impl Default for MatchConfig {
    fn default() -> Self {
        Self {
            max_frechet_distance: 100.0,
            min_match_percentage: 80.0,
            simplification_tolerance: 0.0001,
            max_simplified_points: 50,
        }
    }
}

impl MatchConfig {
    /// Create a new configuration with custom values.
    pub fn new(
        max_frechet_distance: f64,
        min_match_percentage: f64,
        simplification_tolerance: f64,
        max_simplified_points: u32,
    ) -> Self {
        Self {
            max_frechet_distance,
            min_match_percentage,
            simplification_tolerance,
            max_simplified_points,
        }
    }

    /// Configuration optimized for speed (fewer points, larger tolerance).
    pub fn fast() -> Self {
        Self {
            max_frechet_distance: 150.0,
            min_match_percentage: 70.0,
            simplification_tolerance: 0.0002,
            max_simplified_points: 30,
        }
    }

    /// Configuration optimized for accuracy (more points, smaller tolerance).
    pub fn precise() -> Self {
        Self {
            max_frechet_distance: 50.0,
            min_match_percentage: 90.0,
            simplification_tolerance: 0.00005,
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

/// Compare two routes and return a match result.
///
/// This uses the Fréchet distance algorithm to measure similarity,
/// checking both forward and reverse directions.
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

    // Convert to LineStrings
    let line1 = points_to_linestring(&sig1.points);
    let line2 = points_to_linestring(&sig2.points);
    let line2_reversed = reverse_linestring(&line2);

    // Calculate Fréchet distance for forward and reverse
    let frechet_forward = line1.frechet_distance(&line2);
    let frechet_reverse = line1.frechet_distance(&line2_reversed);

    // Use the better match
    let (frechet_distance, direction) = if frechet_forward <= frechet_reverse {
        (frechet_forward, "forward")
    } else {
        (frechet_reverse, "reverse")
    };

    // Convert Fréchet distance from degrees to approximate meters
    // (rough conversion: 1 degree ≈ 111km at equator)
    let frechet_meters = frechet_distance * 111_000.0;

    if frechet_meters > config.max_frechet_distance {
        return None;
    }

    // Calculate match percentage based on Fréchet distance
    let match_percentage = ((1.0 - (frechet_meters / config.max_frechet_distance)) * 100.0)
        .clamp(0.0, 100.0);

    if match_percentage < config.min_match_percentage {
        return None;
    }

    Some(MatchResult {
        activity_id_1: sig1.activity_id.clone(),
        activity_id_2: sig2.activity_id.clone(),
        match_percentage,
        direction: direction.to_string(),
        frechet_distance: frechet_meters,
    })
}

/// Group similar routes together.
///
/// Uses an R-tree spatial index for pre-filtering and Union-Find
/// for efficient grouping. Routes that match are grouped together.
///
/// # Example
/// ```
/// use route_matcher::{GpsPoint, RouteSignature, MatchConfig, group_signatures};
///
/// let points = vec![
///     GpsPoint::new(51.5074, -0.1278),
///     GpsPoint::new(51.5090, -0.1300),
/// ];
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
    let bounds: Vec<RouteBounds> = signatures.iter().map(|s| s.bounds()).collect();
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
                if compare_routes(sig1, sig2, config).is_some() {
                    union(&mut parent, &sig1.activity_id, &sig2.activity_id);
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
    let bounds: Vec<RouteBounds> = signatures.iter().map(|s| s.bounds()).collect();
    let rtree = RTree::bulk_load(bounds.clone());

    // Create signature lookup
    let sig_map: HashMap<&str, &RouteSignature> = signatures
        .iter()
        .map(|s| (s.activity_id.as_str(), s))
        .collect();

    // Find matches in parallel
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
                    compare_routes(sig1, sig2, config)?;
                    Some((sig1.activity_id.clone(), sig2.activity_id.clone()))
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

// ============================================================================
// FFI Exports (only when feature enabled)
// ============================================================================

#[cfg(feature = "ffi")]
mod ffi {
    use super::*;

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

    /// Get default configuration.
    #[uniffi::export]
    pub fn default_config() -> MatchConfig {
        init_logging();
        info!("[RouteMatcherRust] 🦀 default_config called - Rust is active!");
        MatchConfig::default()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

fn points_to_linestring(points: &[GpsPoint]) -> LineString {
    let coords: Vec<Coord> = points
        .iter()
        .map(|p| Coord { x: p.longitude, y: p.latitude })
        .collect();
    LineString::new(coords)
}

fn reverse_linestring(line: &LineString) -> LineString {
    let mut coords = line.0.clone();
    coords.reverse();
    LineString::new(coords)
}

fn calculate_line_distance(coords: &[Coord]) -> f64 {
    coords
        .windows(2)
        .map(|w| {
            let p1 = Point::new(w[0].x, w[0].y);
            let p2 = Point::new(w[1].x, w[1].y);
            Haversine::distance(p1, p2)
        })
        .sum()
}

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
        assert_eq!(result.direction, "forward");
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
        let route1 = sample_route();
        let route2 = route1.clone();
        let different_route = vec![
            GpsPoint::new(40.7128, -74.0060),
            GpsPoint::new(40.7138, -74.0070),
            GpsPoint::new(40.7148, -74.0080),
        ];

        let sig1 = RouteSignature::from_points("test-1", &route1, &MatchConfig::default()).unwrap();
        let sig2 = RouteSignature::from_points("test-2", &route2, &MatchConfig::default()).unwrap();
        let sig3 = RouteSignature::from_points("test-3", &different_route, &MatchConfig::default()).unwrap();

        let groups = group_signatures(&[sig1, sig2, sig3], &MatchConfig::default());

        // Should have 2 groups: one with test-1 and test-2, one with test-3
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn test_config_presets() {
        let default = MatchConfig::default();
        let fast = MatchConfig::fast();
        let precise = MatchConfig::precise();

        assert!(fast.max_frechet_distance > default.max_frechet_distance);
        assert!(precise.max_frechet_distance < default.max_frechet_distance);
        assert!(fast.max_simplified_points < default.max_simplified_points);
        assert!(precise.max_simplified_points > default.max_simplified_points);
    }
}
