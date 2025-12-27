//! # Geographic Utilities
//!
//! Core geographic computation utilities for GPS track analysis.
//!
//! This module provides fundamental geographic operations used throughout the route matching
//! library. All functions are designed to be efficient and accurate for GPS trajectory data.
//!
//! ## Overview
//!
//! | Function | Description |
//! |----------|-------------|
//! | [`haversine_distance`] | Great-circle distance between two GPS points |
//! | [`polyline_length`] | Total length of a GPS track in meters |
//! | [`compute_bounds`] | Bounding box of a GPS track |
//! | [`compute_center`] | Centroid of a GPS track |
//! | [`bounds_overlap`] | Check if two bounding boxes overlap |
//! | [`meters_to_degrees`] | Convert meters to approximate degrees at a latitude |
//!
//! ## Example
//!
//! ```rust
//! use route_matcher::{GpsPoint, geo_utils};
//!
//! let track = vec![
//!     GpsPoint::new(51.5074, -0.1278),  // London
//!     GpsPoint::new(51.5080, -0.1290),
//!     GpsPoint::new(51.5090, -0.1300),
//! ];
//!
//! // Calculate track length
//! let length = geo_utils::polyline_length(&track);
//! println!("Track length: {:.0}m", length);
//!
//! // Get bounding box
//! let bounds = geo_utils::compute_bounds(&track);
//! println!("Bounds: {:.4}N to {:.4}N", bounds.min_lat, bounds.max_lat);
//!
//! // Distance between two points
//! let dist = geo_utils::haversine_distance(&track[0], &track[2]);
//! println!("Start to end: {:.0}m", dist);
//! ```
//!
//! ## Algorithm Notes
//!
//! ### Haversine Formula
//!
//! The haversine formula calculates the great-circle distance between two points on a sphere.
//! It's the standard method for GPS distance calculation, accurate to within 0.3% for most
//! practical applications.
//!
//! Reference: [Haversine formula (Wikipedia)](https://en.wikipedia.org/wiki/Haversine_formula)
//!
//! ### Coordinate System
//!
//! All functions expect WGS84 coordinates (latitude/longitude in degrees), which is the
//! standard used by GPS receivers and mapping services.

use geo::{Point, Haversine, Distance};
use crate::{GpsPoint, Bounds};

// =============================================================================
// Distance Functions
// =============================================================================

/// Calculate the great-circle distance between two GPS points using the Haversine formula.
///
/// Returns the distance in meters along the Earth's surface (assuming a spherical Earth
/// with radius 6,371 km).
///
/// # Arguments
///
/// * `p1` - First GPS point
/// * `p2` - Second GPS point
///
/// # Returns
///
/// Distance in meters between the two points.
///
/// # Example
///
/// ```rust
/// use route_matcher::{GpsPoint, geo_utils};
///
/// let london = GpsPoint::new(51.5074, -0.1278);
/// let paris = GpsPoint::new(48.8566, 2.3522);
///
/// let distance = geo_utils::haversine_distance(&london, &paris);
/// assert!((distance - 343_560.0).abs() < 1000.0); // ~344 km
/// ```
///
/// # Performance
///
/// This function is O(1) and involves trigonometric operations. For comparing distances
/// where exact values aren't needed, consider using squared Euclidean distance on
/// projected coordinates for better performance.
#[inline]
pub fn haversine_distance(p1: &GpsPoint, p2: &GpsPoint) -> f64 {
    let point1 = Point::new(p1.longitude, p1.latitude);
    let point2 = Point::new(p2.longitude, p2.latitude);
    Haversine::distance(point1, point2)
}

/// Calculate the total length of a polyline (GPS track) in meters.
///
/// Sums the haversine distance between consecutive points. Empty or single-point
/// tracks return 0.0.
///
/// # Arguments
///
/// * `points` - Slice of GPS points forming the track
///
/// # Returns
///
/// Total track length in meters.
///
/// # Example
///
/// ```rust
/// use route_matcher::{GpsPoint, geo_utils};
///
/// let track = vec![
///     GpsPoint::new(51.5074, -0.1278),
///     GpsPoint::new(51.5080, -0.1290),
///     GpsPoint::new(51.5090, -0.1300),
/// ];
///
/// let length = geo_utils::polyline_length(&track);
/// println!("Track is {:.0} meters long", length);
/// ```
pub fn polyline_length(points: &[GpsPoint]) -> f64 {
    if points.len() < 2 {
        return 0.0;
    }

    points
        .windows(2)
        .map(|w| haversine_distance(&w[0], &w[1]))
        .sum()
}

/// Convert meters to approximate degrees at a given latitude.
///
/// Uses the WGS84 ellipsoid approximation for latitude-dependent conversion.
/// More accurate at the given latitude than a fixed conversion factor.
///
/// # Arguments
///
/// * `meters` - Distance in meters to convert
/// * `latitude` - Reference latitude for the conversion (in degrees)
///
/// # Returns
///
/// Approximate distance in degrees.
///
/// # Notes
///
/// - At the equator, 1 degree ≈ 111,320 meters
/// - At 45°N/S, 1 degree ≈ 78,710 meters (longitude) / 111,132 meters (latitude)
/// - At the poles, longitude degrees become meaningless
///
/// This function returns a single value suitable for bounding box calculations
/// where a square search area is acceptable.
#[inline]
pub fn meters_to_degrees(meters: f64, latitude: f64) -> f64 {
    // At the equator, 1 degree ≈ 111,320 meters
    // This decreases with cos(latitude) for longitude
    // For simplicity, use a conservative (larger) value based on latitude
    let lat_rad = latitude.to_radians();
    let meters_per_degree = 111_320.0 * lat_rad.cos().max(0.1);
    meters / meters_per_degree
}

// =============================================================================
// Bounding Box Functions
// =============================================================================

/// Compute the bounding box of a GPS track.
///
/// Returns a [`Bounds`] struct containing the minimum and maximum latitude/longitude
/// values that enclose all points in the track.
///
/// # Arguments
///
/// * `points` - Slice of GPS points
///
/// # Returns
///
/// A [`Bounds`] struct with the bounding box coordinates. For empty input,
/// returns a bounds with MIN/MAX values that will fail any overlap check.
///
/// # Example
///
/// ```rust
/// use route_matcher::{GpsPoint, geo_utils};
///
/// let track = vec![
///     GpsPoint::new(51.5000, -0.1300),
///     GpsPoint::new(51.5100, -0.1200),
///     GpsPoint::new(51.5050, -0.1250),
/// ];
///
/// let bounds = geo_utils::compute_bounds(&track);
/// assert_eq!(bounds.min_lat, 51.5000);
/// assert_eq!(bounds.max_lat, 51.5100);
/// assert_eq!(bounds.min_lng, -0.1300);
/// assert_eq!(bounds.max_lng, -0.1200);
/// ```
pub fn compute_bounds(points: &[GpsPoint]) -> Bounds {
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

/// Compute the bounding box as a tuple (min_lat, max_lat, min_lng, max_lng).
///
/// This is a convenience function that returns the bounds as a tuple instead
/// of a [`Bounds`] struct. Useful for quick destructuring.
///
/// # Arguments
///
/// * `points` - Slice of GPS points
///
/// # Returns
///
/// Tuple of (min_lat, max_lat, min_lng, max_lng).
#[inline]
pub fn compute_bounds_tuple(points: &[GpsPoint]) -> (f64, f64, f64, f64) {
    let bounds = compute_bounds(points);
    (bounds.min_lat, bounds.max_lat, bounds.min_lng, bounds.max_lng)
}

/// Check if two bounding boxes overlap, with an optional buffer.
///
/// Useful for quick spatial filtering before expensive point-by-point comparisons.
/// Two tracks with non-overlapping bounds cannot share any common points.
///
/// # Arguments
///
/// * `a` - First bounding box
/// * `b` - Second bounding box
/// * `buffer_meters` - Buffer distance in meters to expand the overlap check
/// * `reference_lat` - Reference latitude for meter-to-degree conversion
///
/// # Returns
///
/// `true` if the bounding boxes overlap (including buffer), `false` otherwise.
///
/// # Example
///
/// ```rust
/// use route_matcher::{Bounds, geo_utils};
///
/// let bounds_a = Bounds {
///     min_lat: 51.50, max_lat: 51.51,
///     min_lng: -0.13, max_lng: -0.12,
/// };
///
/// let bounds_b = Bounds {
///     min_lat: 51.505, max_lat: 51.515,
///     min_lng: -0.125, max_lng: -0.115,
/// };
///
/// // These bounds overlap
/// assert!(geo_utils::bounds_overlap(&bounds_a, &bounds_b, 0.0, 51.5));
///
/// // With a large negative buffer, they might not
/// // (negative buffer shrinks the overlap zone)
/// ```
pub fn bounds_overlap(a: &Bounds, b: &Bounds, buffer_meters: f64, reference_lat: f64) -> bool {
    let buffer_deg = meters_to_degrees(buffer_meters, reference_lat);

    !(a.max_lat + buffer_deg < b.min_lat ||
      b.max_lat + buffer_deg < a.min_lat ||
      a.max_lng + buffer_deg < b.min_lng ||
      b.max_lng + buffer_deg < a.min_lng)
}

// =============================================================================
// Center/Centroid Functions
// =============================================================================

/// Compute the geographic center (centroid) of a GPS track.
///
/// Returns the arithmetic mean of all latitude and longitude values.
/// This is a simple centroid calculation suitable for small geographic areas.
///
/// # Arguments
///
/// * `points` - Slice of GPS points
///
/// # Returns
///
/// A [`GpsPoint`] at the center of the track. Returns (0, 0) for empty input.
///
/// # Notes
///
/// For tracks spanning large areas or crossing the antimeridian (180°/-180° longitude),
/// this simple averaging may produce unexpected results. For such cases, consider
/// using a proper spherical centroid calculation.
///
/// # Example
///
/// ```rust
/// use route_matcher::{GpsPoint, geo_utils};
///
/// let track = vec![
///     GpsPoint::new(51.50, -0.10),
///     GpsPoint::new(51.52, -0.12),
/// ];
///
/// let center = geo_utils::compute_center(&track);
/// assert!((center.latitude - 51.51).abs() < 0.001);
/// assert!((center.longitude - (-0.11)).abs() < 0.001);
/// ```
pub fn compute_center(points: &[GpsPoint]) -> GpsPoint {
    if points.is_empty() {
        return GpsPoint::new(0.0, 0.0);
    }

    let sum_lat: f64 = points.iter().map(|p| p.latitude).sum();
    let sum_lng: f64 = points.iter().map(|p| p.longitude).sum();
    let n = points.len() as f64;

    GpsPoint::new(sum_lat / n, sum_lng / n)
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f64, b: f64, epsilon: f64) -> bool {
        (a - b).abs() < epsilon
    }

    #[test]
    fn test_haversine_distance_same_point() {
        let p = GpsPoint::new(51.5074, -0.1278);
        assert_eq!(haversine_distance(&p, &p), 0.0);
    }

    #[test]
    fn test_haversine_distance_known_value() {
        // London to Paris is approximately 344 km
        let london = GpsPoint::new(51.5074, -0.1278);
        let paris = GpsPoint::new(48.8566, 2.3522);
        let dist = haversine_distance(&london, &paris);
        assert!(approx_eq(dist, 343_560.0, 5000.0)); // Within 5km
    }

    #[test]
    fn test_polyline_length_empty() {
        let empty: Vec<GpsPoint> = vec![];
        assert_eq!(polyline_length(&empty), 0.0);
    }

    #[test]
    fn test_polyline_length_single_point() {
        let single = vec![GpsPoint::new(51.5074, -0.1278)];
        assert_eq!(polyline_length(&single), 0.0);
    }

    #[test]
    fn test_polyline_length_two_points() {
        let track = vec![
            GpsPoint::new(51.5074, -0.1278),
            GpsPoint::new(51.5080, -0.1280),
        ];
        let length = polyline_length(&track);
        assert!(length > 0.0);
        assert!(length < 100.0); // Should be about 68m
    }

    #[test]
    fn test_compute_bounds() {
        let track = vec![
            GpsPoint::new(51.50, -0.13),
            GpsPoint::new(51.51, -0.12),
            GpsPoint::new(51.505, -0.125),
        ];
        let bounds = compute_bounds(&track);
        assert_eq!(bounds.min_lat, 51.50);
        assert_eq!(bounds.max_lat, 51.51);
        assert_eq!(bounds.min_lng, -0.13);
        assert_eq!(bounds.max_lng, -0.12);
    }

    #[test]
    fn test_compute_center() {
        let track = vec![
            GpsPoint::new(51.50, -0.10),
            GpsPoint::new(51.52, -0.12),
        ];
        let center = compute_center(&track);
        assert!(approx_eq(center.latitude, 51.51, 0.001));
        assert!(approx_eq(center.longitude, -0.11, 0.001));
    }

    #[test]
    fn test_compute_center_empty() {
        let empty: Vec<GpsPoint> = vec![];
        let center = compute_center(&empty);
        assert_eq!(center.latitude, 0.0);
        assert_eq!(center.longitude, 0.0);
    }

    #[test]
    fn test_bounds_overlap_yes() {
        let a = Bounds { min_lat: 51.50, max_lat: 51.52, min_lng: -0.13, max_lng: -0.11 };
        let b = Bounds { min_lat: 51.51, max_lat: 51.53, min_lng: -0.12, max_lng: -0.10 };
        assert!(bounds_overlap(&a, &b, 0.0, 51.5));
    }

    #[test]
    fn test_bounds_overlap_no() {
        let a = Bounds { min_lat: 51.50, max_lat: 51.51, min_lng: -0.13, max_lng: -0.12 };
        let b = Bounds { min_lat: 51.52, max_lat: 51.53, min_lng: -0.11, max_lng: -0.10 };
        assert!(!bounds_overlap(&a, &b, 0.0, 51.5));
    }

    #[test]
    fn test_bounds_overlap_with_buffer() {
        let a = Bounds { min_lat: 51.50, max_lat: 51.51, min_lng: -0.13, max_lng: -0.12 };
        let b = Bounds { min_lat: 51.52, max_lat: 51.53, min_lng: -0.11, max_lng: -0.10 };
        // With large buffer (5km), these should overlap
        assert!(bounds_overlap(&a, &b, 5000.0, 51.5));
    }

    #[test]
    fn test_meters_to_degrees() {
        // At equator, 111km = 1 degree
        let deg = meters_to_degrees(111_320.0, 0.0);
        assert!(approx_eq(deg, 1.0, 0.01));

        // At higher latitude, same distance = more degrees
        let deg_45 = meters_to_degrees(111_320.0, 45.0);
        assert!(deg_45 > 1.0);
    }
}
