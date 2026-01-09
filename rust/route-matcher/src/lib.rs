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

use geo::{algorithm::simplify::Simplify, Coord, LineString};
use rstar::{RTreeObject, AABB};
use serde::{Deserialize, Serialize};

// Unified error handling
pub mod error;
pub use error::{OptionExt, Result, RouteMatchError};

// Union-Find data structure for grouping
pub mod union_find;
pub use union_find::UnionFind;

// Route matching algorithms (AMD-based comparison)
pub mod matching;
pub use matching::compare_routes;

// Route grouping algorithms
pub mod grouping;
#[cfg(feature = "parallel")]
pub use grouping::{
    group_incremental, group_signatures_parallel, group_signatures_parallel_with_matches,
};
pub use grouping::{group_signatures, group_signatures_with_matches, should_group_routes};

// Geographic utilities (distance, bounds, center calculations)
pub mod geo_utils;

// Algorithm toolbox - modular access to all algorithms
// Use route_matcher::algorithms::{...} for standalone algorithm access
pub mod algorithms;

// LRU cache for efficient memory management
pub mod lru_cache;

// Stateful route engine (singleton with all route state)
pub mod engine;
pub use engine::{with_engine, EngineStats, RouteEngine, ENGINE};

// Persistent route engine with tiered storage
#[cfg(feature = "persistence")]
pub mod persistence;
#[cfg(feature = "persistence")]
pub use persistence::{
    with_persistent_engine, PersistentEngineStats, PersistentRouteEngine, SectionDetectionHandle,
    PERSISTENT_ENGINE,
};

// HTTP module for activity fetching
#[cfg(feature = "http")]
pub mod http;

#[cfg(feature = "http")]
pub use http::{ActivityFetcher, ActivityMapResult, MapBounds};

// Frequent sections detection (medoid-based algorithm for smooth polylines)
pub mod sections;
pub use sections::{
    detect_sections_from_tracks,
    detect_sections_multiscale,
    DetectionStats,
    FrequentSection,
    MultiScaleSectionResult,
    PotentialSection,
    // Multi-scale detection
    ScalePreset,
    SectionConfig,
    SectionPortion,
};

// Heatmap generation module
pub mod heatmap;
pub use heatmap::{
    generate_heatmap, query_heatmap_cell, ActivityHeatmapData, CellQueryResult, HeatmapBounds,
    HeatmapCell, HeatmapConfig, HeatmapResult, RouteRef,
};

// Zone distribution calculations (power/HR zones)
pub mod zones;
pub use zones::{
    calculate_hr_zones, calculate_power_zones, HRZoneConfig, HRZoneDistribution, PowerZoneConfig,
    PowerZoneDistribution,
};
#[cfg(feature = "parallel")]
pub use zones::{calculate_hr_zones_parallel, calculate_power_zones_parallel};

// Power/pace curve computation
pub mod curves;
pub use curves::{compute_pace_curve, compute_power_curve, CurvePoint, PaceCurve, PowerCurve};

// FFI bindings for mobile platforms (iOS/Android)
#[cfg(feature = "ffi")]
pub mod ffi;

#[cfg(feature = "ffi")]
uniffi::setup_scaffolding!();

/// Initialize logging for Android (only used in FFI)
#[cfg(all(feature = "ffi", target_os = "android"))]
pub(crate) fn init_logging() {
    use android_logger::Config;
    use log::LevelFilter;

    android_logger::init_once(
        Config::default()
            .with_max_level(LevelFilter::Debug)
            .with_tag("RouteMatcherRust"),
    );
}

#[cfg(all(feature = "ffi", not(target_os = "android")))]
pub(crate) fn init_logging() {
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
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct GpsPoint {
    pub latitude: f64,
    pub longitude: f64,
}

impl GpsPoint {
    /// Create a new GPS point.
    pub fn new(latitude: f64, longitude: f64) -> Self {
        Self {
            latitude,
            longitude,
        }
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
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
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

        Some(Self {
            min_lat,
            max_lat,
            min_lng,
            max_lng,
        })
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
    pub fn from_points(
        activity_id: &str,
        points: &[GpsPoint],
        config: &MatchConfig,
    ) -> Option<Self> {
        if points.len() < 2 {
            return None;
        }

        // Filter invalid points and convert to geo coordinates
        let coords: Vec<Coord> = points
            .iter()
            .filter(|p| p.is_valid())
            .map(|p| Coord {
                x: p.longitude,
                y: p.latitude,
            })
            .collect();

        if coords.len() < 2 {
            return None;
        }

        let line = LineString::new(coords);

        // Douglas-Peucker simplification
        let simplified = line.simplify(&config.simplification_tolerance);

        // Limit to max points if needed (uniform sampling)
        let final_coords: Vec<Coord> = if simplified.0.len() > config.max_simplified_points as usize
        {
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct RouteGroup {
    /// Unique identifier for this group (typically the first activity ID)
    pub group_id: String,
    /// ID of the representative activity (the medoid)
    pub representative_id: String,
    /// All activity IDs that belong to this group
    pub activity_ids: Vec<String>,
    /// Sport type for this group (e.g., "Ride", "Run")
    pub sport_type: String,
    /// Bounding box for all activities in the group
    pub bounds: Option<Bounds>,
    /// User-defined custom name for this route (None = use auto-generated name)
    pub custom_name: Option<String>,
}

/// Match info for an activity within a route group.
/// Stores how well the activity matches the representative route.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityMatchInfo {
    /// Activity ID
    pub activity_id: String,
    /// Match percentage (0-100)
    pub match_percentage: f64,
    /// Match direction: "same", "reverse", or "partial"
    pub direction: String,
}

/// Result from grouping signatures, including per-activity match info.
#[derive(Debug, Clone)]
pub struct GroupingResult {
    /// The route groups
    pub groups: Vec<RouteGroup>,
    /// Match info per activity: route_id -> Vec<ActivityMatchInfo>
    pub activity_matches: std::collections::HashMap<String, Vec<ActivityMatchInfo>>,
}

// ============================================================================
// Performance Types
// ============================================================================

/// Activity metadata for performance calculations.
/// Stores the non-GPS data needed for performance comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ActivityMetrics {
    pub activity_id: String,
    pub name: String,
    /// Unix timestamp (seconds since epoch)
    pub date: i64,
    /// Distance in meters
    pub distance: f64,
    /// Moving time in seconds
    pub moving_time: u32,
    /// Elapsed time in seconds
    pub elapsed_time: u32,
    /// Total elevation gain in meters
    pub elevation_gain: f64,
    /// Average heart rate (optional)
    pub avg_hr: Option<u16>,
    /// Average power in watts (optional)
    pub avg_power: Option<u16>,
    /// Sport type (e.g., "Ride", "Run")
    pub sport_type: String,
}

/// A single performance point for route comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct RoutePerformance {
    pub activity_id: String,
    pub name: String,
    /// Unix timestamp
    pub date: i64,
    /// Speed in m/s (distance / moving_time)
    pub speed: f64,
    /// Elapsed time in seconds
    pub duration: u32,
    /// Moving time in seconds
    pub moving_time: u32,
    /// Distance in meters
    pub distance: f64,
    /// Elevation gain in meters
    pub elevation_gain: f64,
    /// Average heart rate (optional)
    pub avg_hr: Option<u16>,
    /// Average power in watts (optional)
    pub avg_power: Option<u16>,
    /// Is this the current activity being viewed
    pub is_current: bool,
    /// Match direction: "same", "reverse", or "partial"
    pub direction: String,
    /// Match percentage (0-100)
    pub match_percentage: f64,
}

/// Complete route performance result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct RoutePerformanceResult {
    /// Performances sorted by date (oldest first)
    pub performances: Vec<RoutePerformance>,
    /// Best performance (fastest speed)
    pub best: Option<RoutePerformance>,
    /// Current activity's rank (1 = fastest), if current_activity_id was provided
    pub current_rank: Option<u32>,
}

/// A single lap of a section.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionLap {
    pub id: String,
    pub activity_id: String,
    /// Lap time in seconds
    pub time: f64,
    /// Pace in m/s
    pub pace: f64,
    /// Distance in meters
    pub distance: f64,
    /// Direction: "forward" or "backward"
    pub direction: String,
    /// Start index in the activity's GPS track
    pub start_index: u32,
    /// End index in the activity's GPS track
    pub end_index: u32,
}

/// Section performance record for an activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionPerformanceRecord {
    pub activity_id: String,
    pub activity_name: String,
    /// Unix timestamp
    pub activity_date: i64,
    /// All laps for this activity on this section
    pub laps: Vec<SectionLap>,
    /// Number of times this section was traversed
    pub lap_count: u32,
    /// Best (fastest) lap time in seconds
    pub best_time: f64,
    /// Best pace in m/s
    pub best_pace: f64,
    /// Average lap time in seconds
    pub avg_time: f64,
    /// Average pace in m/s
    pub avg_pace: f64,
    /// Primary direction: "forward" or "backward"
    pub direction: String,
    /// Section distance in meters
    pub section_distance: f64,
}

/// Complete section performance result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionPerformanceResult {
    /// Performance records sorted by date (oldest first)
    pub records: Vec<SectionPerformanceRecord>,
    /// Best record (fastest time)
    pub best_record: Option<SectionPerformanceRecord>,
}

// ============================================================================
// Spatial Indexing Types
// ============================================================================

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
        AABB::from_corners([self.min_lng, self.min_lat], [self.max_lng, self.max_lat])
    }
}

// ============================================================================
// Core Functions
// ============================================================================

// Use matching functions from the matching module
use crate::matching::calculate_route_distance;

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
        let sig2 =
            RouteSignature::from_points("test-2", &reversed, &MatchConfig::default()).unwrap();

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

        let sig1 =
            RouteSignature::from_points("test-1", &long_route, &MatchConfig::default()).unwrap();
        let sig2 =
            RouteSignature::from_points("test-2", &long_route, &MatchConfig::default()).unwrap();
        let sig3 = RouteSignature::from_points("test-3", &different_route, &MatchConfig::default())
            .unwrap();

        let groups = group_signatures(&[sig1, sig2, sig3], &MatchConfig::default());

        // Should have 2 groups: one with test-1 and test-2, one with test-3
        assert_eq!(groups.len(), 2);

        // Verify the grouping is correct
        let group_with_1 = groups
            .iter()
            .find(|g| g.activity_ids.contains(&"test-1".to_string()))
            .unwrap();
        assert!(group_with_1.activity_ids.contains(&"test-2".to_string()));
        assert!(!group_with_1.activity_ids.contains(&"test-3".to_string()));
    }
}
