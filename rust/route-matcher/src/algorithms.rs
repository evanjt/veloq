//! # Algorithm Toolbox
//!
//! This module provides direct access to all route-matching algorithms.
//! Use these for integrating specific algorithms into your own systems
//! without needing the full engine.
//!
//! ## Core Algorithms
//!
//! - **Route Matching**: AMD-based route comparison
//! - **Route Grouping**: Union-Find clustering of similar routes
//! - **Section Detection**: Find frequently-traveled segments
//! - **Heatmap Generation**: Density visualization
//!
//! ## Geographic Utilities
//!
//! - **Haversine Distance**: Great-circle distance between GPS points
//! - **Polyline Length**: Total distance along a path
//! - **Bounds Computation**: Bounding box for GPS tracks
//! - **Douglas-Peucker**: Line simplification
//!
//! # Example
//!
//! ```rust
//! use route_matcher::algorithms::{
//!     haversine_distance,
//!     compare_routes,
//!     group_signatures,
//!     GpsPoint, RouteSignature, MatchConfig,
//! };
//!
//! // Compute distance between two points
//! let london = GpsPoint::new(51.5074, -0.1278);
//! let paris = GpsPoint::new(48.8566, 2.3522);
//! let distance = haversine_distance(&london, &paris);
//! println!("London to Paris: {:.0} km", distance / 1000.0);
//! ```

// =============================================================================
// Core Types (re-exported from lib)
// =============================================================================

pub use crate::{
    GpsPoint,
    Bounds,
    RouteSignature,
    MatchResult,
    MatchConfig,
    RouteGroup,
};

// =============================================================================
// Geographic Utilities
// =============================================================================

pub use crate::geo_utils::{
    haversine_distance,
    polyline_length,
    meters_to_degrees,
    compute_bounds,
    compute_bounds_tuple,
    bounds_overlap,
    compute_center,
};

// =============================================================================
// Route Matching Algorithms
// =============================================================================

/// Compare two routes and compute similarity.
///
/// Uses Average Minimum Distance (AMD) algorithm:
/// 1. Sample points from both routes
/// 2. For each point in route A, find minimum distance to route B
/// 3. Average these minimum distances
/// 4. Convert to match percentage based on threshold
///
/// # Arguments
/// * `sig1` - First route signature
/// * `sig2` - Second route signature
/// * `config` - Matching configuration
///
/// # Returns
/// Match result with percentage and direction, or None if routes don't match
pub use crate::compare_routes;

/// Group similar routes together using Union-Find.
///
/// Algorithm:
/// 1. Compare all pairs of routes
/// 2. Use Union-Find with path compression to cluster matches
/// 3. Return groups with their member activities
///
/// # Arguments
/// * `signatures` - All route signatures to group
/// * `config` - Matching configuration
///
/// # Returns
/// Vector of route groups
pub use crate::group_signatures;

/// Parallel version of route grouping.
///
/// Uses Rayon for parallel pairwise comparisons.
/// Automatically uses all available CPU cores.
#[cfg(feature = "parallel")]
pub use crate::group_signatures_parallel;

/// Incremental grouping for adding new routes.
///
/// Efficient O(n×m) algorithm instead of O(n²):
/// - Only compares new signatures to existing ones
/// - Only compares new signatures to each other
/// - Preserves existing group structure
///
/// Use this when adding activities to avoid re-processing everything.
#[cfg(feature = "parallel")]
pub use crate::group_incremental;

// =============================================================================
// Section Detection
// =============================================================================

/// Detected frequently-traveled section
pub use crate::sections::FrequentSection;
/// Configuration for section detection
pub use crate::sections::SectionConfig;
/// Activity's portion of a section
pub use crate::sections::SectionPortion;
/// Main section detection function
pub use crate::sections::detect_sections_from_tracks;

// =============================================================================
// Heatmap Generation
// =============================================================================

/// Heatmap configuration
pub use crate::heatmap::HeatmapConfig;
/// Heatmap bounds
pub use crate::heatmap::HeatmapBounds;
/// Single heatmap cell
pub use crate::heatmap::HeatmapCell;
/// Complete heatmap result
pub use crate::heatmap::HeatmapResult;
/// Cell query result
pub use crate::heatmap::CellQueryResult;
/// Route reference in a cell
pub use crate::heatmap::RouteRef;
/// Activity metadata for heatmap
pub use crate::heatmap::ActivityHeatmapData;
/// Generate heatmap from signatures
pub use crate::heatmap::generate_heatmap;
/// Query cell at location
pub use crate::heatmap::query_heatmap_cell;

// =============================================================================
// Line Simplification
// =============================================================================

/// Douglas-Peucker line simplification algorithm.
///
/// Reduces the number of points in a polyline while preserving shape.
/// Uses the geo crate's implementation.
///
/// # Arguments
/// * `points` - Input polyline
/// * `tolerance` - Maximum deviation from original line (in coordinate units, typically degrees)
///
/// # Returns
/// Simplified polyline with fewer points
///
/// # Example
/// ```rust
/// use route_matcher::algorithms::{douglas_peucker, GpsPoint};
///
/// let track = vec![
///     GpsPoint::new(51.5074, -0.1278),
///     GpsPoint::new(51.5080, -0.1280),
///     GpsPoint::new(51.5090, -0.1300),
/// ];
/// let simplified = douglas_peucker(&track, 0.0001);
/// ```
pub fn douglas_peucker(points: &[crate::GpsPoint], tolerance: f64) -> Vec<crate::GpsPoint> {
    use geo::{Coord, LineString, algorithm::simplify::Simplify};

    if points.len() < 2 {
        return points.to_vec();
    }

    let coords: Vec<Coord<f64>> = points
        .iter()
        .map(|p| Coord { x: p.longitude, y: p.latitude })
        .collect();

    let line = LineString::new(coords);
    let simplified = line.simplify(&tolerance);

    simplified
        .coords()
        .map(|c| crate::GpsPoint::new(c.y, c.x))
        .collect()
}

/// Resample a polyline to fixed number of points.
///
/// Creates evenly-spaced points along the route for consistent comparisons.
/// Uses linear interpolation between original points.
///
/// # Arguments
/// * `points` - Input polyline
/// * `count` - Number of output points
///
/// # Returns
/// Resampled polyline with exactly `count` points
///
/// # Example
/// ```rust
/// use route_matcher::algorithms::{resample_track, GpsPoint};
///
/// let track = vec![
///     GpsPoint::new(51.5074, -0.1278),
///     GpsPoint::new(51.5090, -0.1300),
///     GpsPoint::new(51.5100, -0.1320),
/// ];
/// let resampled = resample_track(&track, 10);
/// assert_eq!(resampled.len(), 10);
/// ```
pub fn resample_track(points: &[crate::GpsPoint], count: usize) -> Vec<crate::GpsPoint> {
    if points.is_empty() || count == 0 {
        return vec![];
    }
    if points.len() == 1 || count == 1 {
        return vec![points[0].clone()];
    }

    let total_length = polyline_length(points);
    if total_length == 0.0 {
        return vec![points[0].clone(); count];
    }

    let segment_length = total_length / (count - 1) as f64;
    let mut result = Vec::with_capacity(count);
    result.push(points[0].clone());

    let mut current_distance = 0.0;
    let mut target_distance = segment_length;
    let mut point_idx = 0;

    while result.len() < count - 1 && point_idx < points.len() - 1 {
        let p1 = &points[point_idx];
        let p2 = &points[point_idx + 1];
        let seg_dist = haversine_distance(p1, p2);

        while current_distance + seg_dist >= target_distance && result.len() < count - 1 {
            let ratio = (target_distance - current_distance) / seg_dist;
            let lat = p1.latitude + ratio * (p2.latitude - p1.latitude);
            let lng = p1.longitude + ratio * (p2.longitude - p1.longitude);
            result.push(crate::GpsPoint::new(lat, lng));
            target_distance += segment_length;
        }

        current_distance += seg_dist;
        point_idx += 1;
    }

    // Ensure we end with the last point
    if result.len() < count {
        result.push(points.last().unwrap().clone());
    }

    result
}

// =============================================================================
// Spatial Indexing
// =============================================================================

/// R-tree spatial index for fast geographic queries.
///
/// Re-export of rstar's RTree for custom spatial indexing needs.
pub use rstar::RTree;

// =============================================================================
// Algorithm Traits
// =============================================================================

/// Trait for types that can be spatially indexed.
///
/// Implement this to use custom types with R-tree spatial indexing.
pub use rstar::RTreeObject;

/// Axis-aligned bounding box for spatial queries.
pub use rstar::AABB;
