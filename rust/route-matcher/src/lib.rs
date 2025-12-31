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
    Coord, LineString,
    algorithm::simplify::Simplify,
};
use rstar::{RTreeObject, AABB};
use serde::{Deserialize, Serialize};

// Unified error handling
pub mod error;
pub use error::{RouteMatchError, Result, OptionExt};

// Union-Find data structure for grouping
pub mod union_find;
pub use union_find::UnionFind;

// Route matching algorithms (AMD-based comparison)
pub mod matching;
pub use matching::compare_routes;

// Route grouping algorithms
pub mod grouping;
pub use grouping::{group_signatures, should_group_routes};
#[cfg(feature = "parallel")]
pub use grouping::{group_signatures_parallel, group_incremental};

// Geographic utilities (distance, bounds, center calculations)
pub mod geo_utils;

// Algorithm toolbox - modular access to all algorithms
// Use route_matcher::algorithms::{...} for standalone algorithm access
pub mod algorithms;

// LRU cache for efficient memory management
pub mod lru_cache;

// Stateful route engine (singleton with all route state)
pub mod engine;
pub use engine::{RouteEngine, EngineStats, ENGINE, with_engine};

// Persistent route engine with tiered storage
#[cfg(feature = "persistence")]
pub mod persistence;
#[cfg(feature = "persistence")]
pub use persistence::{
    PersistentRouteEngine, PersistentEngineStats, SectionDetectionHandle,
    PERSISTENT_ENGINE, with_persistent_engine,
};

// HTTP module for activity fetching
#[cfg(feature = "http")]
pub mod http;

#[cfg(feature = "http")]
pub use http::{ActivityFetcher, ActivityMapResult, MapBounds};

// Frequent sections detection (medoid-based algorithm for smooth polylines)
pub mod sections;
pub use sections::{FrequentSection, SectionConfig, SectionPortion, detect_sections_from_tracks};

// Heatmap generation module
pub mod heatmap;
pub use heatmap::{
    HeatmapConfig, HeatmapBounds, HeatmapCell, HeatmapResult,
    RouteRef, CellQueryResult, ActivityHeatmapData,
    generate_heatmap, query_heatmap_cell,
};

// Zone distribution calculations (power/HR zones)
pub mod zones;
pub use zones::{
    PowerZoneConfig, HRZoneConfig,
    PowerZoneDistribution, HRZoneDistribution,
    calculate_power_zones, calculate_hr_zones,
};
#[cfg(feature = "parallel")]
pub use zones::{calculate_power_zones_parallel, calculate_hr_zones_parallel};

// Power/pace curve computation
pub mod curves;
pub use curves::{
    PowerCurve, PaceCurve, CurvePoint,
    compute_power_curve, compute_pace_curve,
};

// Achievement/PR detection
pub mod achievements;
pub use achievements::{
    Achievement, AchievementType, ActivityRecord,
    detect_achievements,
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
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
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

// Use matching functions from the matching module
use crate::matching::calculate_route_distance;


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
        info!("[RouteMatcherRust] create_signature called for {} with {} points", activity_id, points.len());
        let result = RouteSignature::from_points(&activity_id, &points, &MatchConfig::default());
        if let Some(ref sig) = result {
            info!("[RouteMatcherRust] Created signature: {} points, {:.0}m distance", sig.points.len(), sig.total_distance);
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
        info!("[RouteMatcherRust] create_signature_with_config for {} ({} points)", activity_id, points.len());
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
        debug!("[RouteMatcherRust] Comparing {} vs {}", sig1.activity_id, sig2.activity_id);
        let result = compare_routes(sig1, sig2, &config);
        if let Some(ref r) = result {
            info!("[RouteMatcherRust] Match found: {:.1}% ({})", r.match_percentage, r.direction);
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
        info!("[RouteMatcherRust] RUST groupSignatures called with {} signatures", signatures.len());

        let start = std::time::Instant::now();

        #[cfg(feature = "parallel")]
        let groups = {
            info!("[RouteMatcherRust] Using PARALLEL processing (rayon)");
            group_signatures_parallel(&signatures, &config)
        };

        #[cfg(not(feature = "parallel"))]
        let groups = {
            info!("[RouteMatcherRust] Using sequential processing");
            group_signatures(&signatures, &config)
        };

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] Grouped into {} groups in {:?}", groups.len(), elapsed);

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
            "[RouteMatcherRust] INCREMENTAL grouping: {} new + {} existing signatures",
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
        info!("[RouteMatcherRust] Incremental grouped into {} groups in {:?}", groups.len(), elapsed);

        groups
    }

    /// Get default configuration.
    #[uniffi::export]
    pub fn default_config() -> MatchConfig {
        init_logging();
        info!("[RouteMatcherRust] default_config called - Rust is active!");
        MatchConfig::default()
    }

    /// Input for flat buffer processing (zero-copy from JS TypedArray)
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
        info!("[RouteMatcherRust] FLAT BUFFER createSignatures called with {} tracks", tracks.len());

        let start = std::time::Instant::now();

        #[cfg(feature = "parallel")]
        let signatures: Vec<RouteSignature> = {
            use rayon::prelude::*;
            info!("[RouteMatcherRust] Using PARALLEL flat buffer processing (rayon)");
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
            info!("[RouteMatcherRust] Using sequential flat buffer processing");
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
        info!("[RouteMatcherRust] FLAT created {} signatures from {} tracks in {:?}",
              signatures.len(), tracks.len(), elapsed);

        signatures
    }

    /// Process routes end-to-end from flat buffers: create signatures AND group them.
    /// Most efficient way to process many activities from TypedArray input.
    #[uniffi::export]
    pub fn process_routes_from_flat(tracks: Vec<FlatGpsTrack>, config: MatchConfig) -> Vec<RouteGroup> {
        init_logging();
        info!("[RouteMatcherRust] FLAT BATCH process_routes called with {} tracks", tracks.len());

        let start = std::time::Instant::now();

        // Step 1: Create all signatures from flat buffers
        let signatures = create_signatures_from_flat(tracks.clone(), config.clone());

        // Step 2: Group signatures
        #[cfg(feature = "parallel")]
        let groups = group_signatures_parallel(&signatures, &config);

        #[cfg(not(feature = "parallel"))]
        let groups = group_signatures(&signatures, &config);

        let elapsed = start.elapsed();
        info!("[RouteMatcherRust] FLAT batch processing: {} signatures -> {} groups in {:?}",
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
        info!("[RouteMatcherRust] fetch_activity_maps called for {} activities", activity_ids.len());

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
        info!("[RouteMatcherRust] fetch_activity_maps_with_progress called for {} activities", activity_ids.len());

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

    /// Get default section detection configuration
    #[uniffi::export]
    pub fn default_section_config() -> crate::SectionConfig {
        crate::SectionConfig::default()
    }

    /// Detect frequent sections from FULL GPS tracks.
    /// Uses medoid-based algorithm to select actual GPS traces as representative polylines.
    /// This produces smooth, natural section shapes that follow real roads.
    ///
    /// # Arguments
    /// * `activity_ids` - List of activity IDs (in same order as coordinates)
    /// * `all_coords` - Flat array of coordinates: [lat1, lng1, lat2, lng2, ...]
    /// * `offsets` - Start offset for each activity in all_coords (length = activity count + 1)
    /// * `sport_types` - Sport type for each activity
    /// * `groups` - Route groups (for linking sections to routes)
    /// * `config` - Section detection configuration
    #[uniffi::export]
    pub fn ffi_detect_sections_from_tracks(
        activity_ids: Vec<String>,
        all_coords: Vec<f64>,
        offsets: Vec<u32>,
        sport_types: Vec<ActivitySportType>,
        groups: Vec<RouteGroup>,
        config: crate::SectionConfig,
    ) -> Vec<crate::FrequentSection> {
        init_logging();
        info!(
            "[RouteMatcherRust] detect_sections_from_tracks: {} activities, {} coords",
            activity_ids.len(),
            all_coords.len() / 2
        );

        let start = std::time::Instant::now();

        // Convert flat coordinates to tracks
        let mut tracks: Vec<(String, Vec<GpsPoint>)> = Vec::with_capacity(activity_ids.len());

        for (i, activity_id) in activity_ids.iter().enumerate() {
            let start_offset = offsets[i] as usize;
            let end_offset = offsets.get(i + 1).map(|&o| o as usize).unwrap_or(all_coords.len() / 2);

            let mut points = Vec::with_capacity(end_offset - start_offset);
            for j in start_offset..end_offset {
                let coord_idx = j * 2;
                if coord_idx + 1 < all_coords.len() {
                    points.push(GpsPoint::new(all_coords[coord_idx], all_coords[coord_idx + 1]));
                }
            }

            if !points.is_empty() {
                tracks.push((activity_id.clone(), points));
            }
        }

        info!(
            "[RouteMatcherRust] Converted to {} tracks with full GPS data",
            tracks.len()
        );

        // Convert sport types to HashMap
        let sport_map: std::collections::HashMap<String, String> = sport_types
            .into_iter()
            .map(|st| (st.activity_id, st.sport_type))
            .collect();

        let sections = crate::sections::detect_sections_from_tracks(
            &tracks,
            &sport_map,
            &groups,
            &config,
        );

        let elapsed = start.elapsed();
        info!(
            "[RouteMatcherRust] Found {} sections (medoid-based) in {:?}",
            sections.len(),
            elapsed
        );

        sections
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
        info!("[RouteMatcherRust] fetch_and_process_activities for {} activities", activity_ids.len());

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
        info!("[RouteMatcherRust] Fetched {} activities, created {} signatures in {:?}",
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
            "[RouteMatcherRust] generate_heatmap: {} signatures, {}m cells",
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
            "[RouteMatcherRust] Heatmap generated: {} cells, {} routes, {} activities in {:?}",
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

    // ========================================================================
    // Zone Distribution FFI
    // ========================================================================

    /// Calculate power zone distribution from power data.
    ///
    /// # Arguments
    /// * `power_data` - Power values in watts (1Hz sampling)
    /// * `ftp` - Functional Threshold Power in watts
    /// * `zone_thresholds` - Optional custom zone thresholds as % of FTP [Z1, Z2, Z3, Z4, Z5, Z6]
    ///
    /// # Returns
    /// JSON string with zone distribution results
    #[uniffi::export]
    pub fn ffi_calculate_power_zones(
        power_data: Vec<u16>,
        ftp: u16,
        zone_thresholds: Option<Vec<f32>>,
    ) -> String {
        init_logging();
        info!("[RouteMatcherRust] calculate_power_zones: {} samples, FTP={}W", power_data.len(), ftp);

        let config = match zone_thresholds {
            Some(thresholds) if thresholds.len() == 6 => {
                let mut arr = [0.0f32; 6];
                arr.copy_from_slice(&thresholds);
                crate::zones::PowerZoneConfig::with_thresholds(ftp, arr)
            }
            _ => crate::zones::PowerZoneConfig::from_ftp(ftp),
        };

        #[cfg(feature = "parallel")]
        let result = crate::zones::calculate_power_zones_parallel(&power_data, &config);
        #[cfg(not(feature = "parallel"))]
        let result = crate::zones::calculate_power_zones(&power_data, &config);

        info!(
            "[RouteMatcherRust] Power zones: {} samples, avg={}W, peak={}W",
            result.total_samples, result.average_power, result.peak_power
        );

        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
    }

    /// Calculate HR zone distribution from heart rate data.
    ///
    /// # Arguments
    /// * `hr_data` - Heart rate values in BPM (1Hz sampling)
    /// * `threshold_hr` - Max HR or LTHR
    /// * `zone_thresholds` - Optional custom zone thresholds as % of threshold [Z1, Z2, Z3, Z4]
    ///
    /// # Returns
    /// JSON string with zone distribution results
    #[uniffi::export]
    pub fn ffi_calculate_hr_zones(
        hr_data: Vec<u8>,
        threshold_hr: u8,
        zone_thresholds: Option<Vec<f32>>,
    ) -> String {
        init_logging();
        info!("[RouteMatcherRust] calculate_hr_zones: {} samples, threshold={}bpm", hr_data.len(), threshold_hr);

        let config = match zone_thresholds {
            Some(thresholds) if thresholds.len() == 4 => {
                let mut arr = [0.0f32; 4];
                arr.copy_from_slice(&thresholds);
                crate::zones::HRZoneConfig::with_thresholds(threshold_hr, arr)
            }
            _ => crate::zones::HRZoneConfig::from_max_hr(threshold_hr),
        };

        #[cfg(feature = "parallel")]
        let result = crate::zones::calculate_hr_zones_parallel(&hr_data, &config);
        #[cfg(not(feature = "parallel"))]
        let result = crate::zones::calculate_hr_zones(&hr_data, &config);

        info!(
            "[RouteMatcherRust] HR zones: {} samples, avg={}bpm, peak={}bpm",
            result.total_samples, result.average_hr, result.peak_hr
        );

        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
    }

    // ========================================================================
    // Power/Pace Curve FFI
    // ========================================================================

    /// Compute power curve for a single activity.
    ///
    /// # Arguments
    /// * `power_data` - Power values in watts (1Hz sampling)
    /// * `durations` - Durations to compute in seconds [1, 5, 60, 300, 1200, 3600]
    ///
    /// # Returns
    /// JSON string with power curve results
    #[uniffi::export]
    pub fn ffi_compute_power_curve(power_data: Vec<u16>, durations: Vec<u32>) -> String {
        init_logging();
        info!("[RouteMatcherRust] compute_power_curve: {} samples, {} durations", power_data.len(), durations.len());

        let result = crate::curves::compute_power_curve(&power_data, &durations);

        info!(
            "[RouteMatcherRust] Power curve computed, peak 1s={}W",
            result.get_power_at(1).unwrap_or(0.0)
        );

        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
    }

    /// Compute power curve from multiple activities (all-time bests).
    ///
    /// # Arguments
    /// * `activity_ids` - Activity IDs
    /// * `power_data_flat` - Flat array of all power data
    /// * `offsets` - Start offset for each activity in power_data_flat
    /// * `timestamps` - Unix timestamps for each activity
    /// * `durations` - Durations to compute in seconds
    ///
    /// # Returns
    /// JSON string with power curve results including activity attribution
    #[uniffi::export]
    pub fn ffi_compute_power_curve_multi(
        activity_ids: Vec<String>,
        power_data_flat: Vec<u16>,
        offsets: Vec<u32>,
        timestamps: Vec<i64>,
        durations: Vec<u32>,
    ) -> String {
        init_logging();
        info!(
            "[RouteMatcherRust] compute_power_curve_multi: {} activities, {} total samples",
            activity_ids.len(),
            power_data_flat.len()
        );

        // Reconstruct activities from flat data
        let mut activities: Vec<(String, Vec<u16>, i64)> = Vec::new();

        for (i, activity_id) in activity_ids.iter().enumerate() {
            let start = offsets[i] as usize;
            let end = offsets.get(i + 1).map(|&o| o as usize).unwrap_or(power_data_flat.len());
            let power = power_data_flat[start..end].to_vec();
            let ts = timestamps.get(i).copied().unwrap_or(0);
            activities.push((activity_id.clone(), power, ts));
        }

        #[cfg(feature = "parallel")]
        let result = crate::curves::compute_power_curve_multi_parallel(&activities, &durations);
        #[cfg(not(feature = "parallel"))]
        let result = crate::curves::compute_power_curve_multi(&activities, &durations);

        info!(
            "[RouteMatcherRust] Multi-activity power curve computed from {} activities",
            result.activities_analyzed
        );

        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
    }

    /// Compute pace curve for a single activity.
    ///
    /// # Arguments
    /// * `distances` - Cumulative distance at each second in meters
    /// * `target_distances` - Distances to compute pace for in meters
    ///
    /// # Returns
    /// JSON string with pace curve results
    #[uniffi::export]
    pub fn ffi_compute_pace_curve(distances: Vec<f32>, target_distances: Vec<f32>) -> String {
        init_logging();
        info!(
            "[RouteMatcherRust] compute_pace_curve: {} samples, {} target distances",
            distances.len(),
            target_distances.len()
        );

        let result = crate::curves::compute_pace_curve(&distances, &target_distances);

        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
    }

    // ========================================================================
    // Achievement Detection FFI
    // ========================================================================

    /// Detect achievements by comparing a new activity against historical records.
    ///
    /// # Arguments
    /// * `new_activity` - The newly completed activity record
    /// * `history` - Historical activity records for comparison
    ///
    /// # Returns
    /// Vector of detected achievements, sorted by importance
    #[uniffi::export]
    pub fn ffi_detect_achievements(
        new_activity: crate::achievements::ActivityRecord,
        history: Vec<crate::achievements::ActivityRecord>,
    ) -> Vec<crate::achievements::Achievement> {
        init_logging();
        info!(
            "[RouteMatcherRust] detect_achievements for activity {}, comparing against {} historical activities",
            new_activity.activity_id,
            history.len()
        );

        let achievements = crate::achievements::detect_achievements(&new_activity, &history);

        info!(
            "[RouteMatcherRust] Detected {} achievements",
            achievements.len()
        );

        achievements
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
