//! App-layer types for persistence and FFI.
//!
//! These types are data containers used by the persistence layer and FFI boundary.
//! They were moved out of tracematch because they are not produced or consumed
//! by any tracematch algorithm — they exist solely for the app's storage and UI.

use serde::{Deserialize, Serialize};
use tracematch::GpsPoint;

// ============================================================================
// Activity Metrics
// ============================================================================

/// Stores the non-GPS data needed for performance comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

// ============================================================================
// Route Performance Types
// ============================================================================

/// A single performance point for route comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// Match percentage (0-100), None if no match data available
    pub match_percentage: Option<f64>,
}

/// Complete route performance result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePerformanceResult {
    /// Performances sorted by date (oldest first)
    pub performances: Vec<RoutePerformance>,
    /// Best performance (fastest speed) - overall regardless of direction
    pub best: Option<RoutePerformance>,
    /// Best performance in forward/same direction
    pub best_forward: Option<RoutePerformance>,
    /// Best performance in reverse direction
    pub best_reverse: Option<RoutePerformance>,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<DirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<DirectionStats>,
    /// Current activity's rank (1 = fastest), if current_activity_id was provided
    pub current_rank: Option<u32>,
}

// ============================================================================
// Section Performance Types
// ============================================================================

/// A single lap of a section.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionLap {
    pub id: String,
    #[serde(alias = "activity_id")]
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
    #[serde(alias = "start_index")]
    pub start_index: u32,
    /// End index in the activity's GPS track
    #[serde(alias = "end_index")]
    pub end_index: u32,
}

/// Section performance record for an activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionPerformanceRecord {
    #[serde(alias = "activity_id")]
    pub activity_id: String,
    #[serde(alias = "activity_name")]
    pub activity_name: String,
    /// Unix timestamp
    #[serde(alias = "activity_date")]
    pub activity_date: i64,
    /// All laps for this activity on this section
    pub laps: Vec<SectionLap>,
    /// Number of times this section was traversed
    #[serde(alias = "lap_count")]
    pub lap_count: u32,
    /// Best (fastest) lap time in seconds
    #[serde(alias = "best_time")]
    pub best_time: f64,
    /// Best pace in m/s
    #[serde(alias = "best_pace")]
    pub best_pace: f64,
    /// Average lap time in seconds
    #[serde(alias = "avg_time")]
    pub avg_time: f64,
    /// Average pace in m/s
    #[serde(alias = "avg_pace")]
    pub avg_pace: f64,
    /// Primary direction: "forward" or "backward"
    pub direction: String,
    /// Section distance in meters
    #[serde(alias = "section_distance")]
    pub section_distance: f64,
}

/// Per-direction summary statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectionStats {
    /// Average time across all traversals in this direction (seconds)
    pub avg_time: Option<f64>,
    /// Unix timestamp of most recent traversal in this direction
    pub last_activity: Option<i64>,
    /// Number of traversals in this direction
    pub count: u32,
}

/// Complete section performance result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionPerformanceResult {
    /// Performance records sorted by date (oldest first)
    pub records: Vec<SectionPerformanceRecord>,
    /// Best record (fastest time) - overall regardless of direction
    #[serde(alias = "best_record")]
    pub best_record: Option<SectionPerformanceRecord>,
    /// Best record in forward/same direction
    #[serde(alias = "best_forward_record")]
    pub best_forward_record: Option<SectionPerformanceRecord>,
    /// Best record in reverse direction
    #[serde(alias = "best_reverse_record")]
    pub best_reverse_record: Option<SectionPerformanceRecord>,
    /// Summary stats for forward/same direction
    #[serde(alias = "forward_stats")]
    pub forward_stats: Option<DirectionStats>,
    /// Summary stats for reverse direction
    #[serde(alias = "reverse_stats")]
    pub reverse_stats: Option<DirectionStats>,
}

// ============================================================================
// Custom Section Types
// ============================================================================

/// A user-created custom section definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSection {
    /// Unique identifier (e.g., "custom_1234567890_abc123")
    pub id: String,
    /// User-defined name
    pub name: String,
    /// GPS polyline defining the section path
    pub polyline: Vec<GpsPoint>,
    /// Activity this section was created from
    pub source_activity_id: String,
    /// Start index in the source activity's GPS track
    pub start_index: u32,
    /// End index in the source activity's GPS track
    pub end_index: u32,
    /// Sport type (e.g., "Ride", "Run")
    pub sport_type: String,
    /// Distance in meters
    pub distance_meters: f64,
    /// ISO 8601 timestamp when section was created
    pub created_at: String,
}

/// A match between a custom section and an activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSectionMatch {
    /// Activity ID that matched the section
    pub activity_id: String,
    /// Start index in the activity's GPS track
    pub start_index: u32,
    /// End index in the activity's GPS track
    pub end_index: u32,
    /// Direction: "same" or "reverse"
    pub direction: String,
    /// Distance of the matched portion in meters
    pub distance_meters: f64,
}

/// Configuration for custom section matching.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSectionMatchConfig {
    /// Maximum distance in meters between section and activity points (default: 50m)
    pub proximity_threshold: f64,
    /// Minimum percentage of section that must be covered (default: 0.8 = 80%)
    pub min_coverage: f64,
}

impl Default for CustomSectionMatchConfig {
    fn default() -> Self {
        Self {
            proximity_threshold: 50.0,
            min_coverage: 0.8,
        }
    }
}

// ============================================================================
// Section Performance Bucket Types
// ============================================================================

/// A time-bucketed best performance for chart display.
/// Each bucket represents the best traversal within a time period (week or month).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionPerformanceBucket {
    pub activity_id: String,
    pub activity_name: String,
    /// Unix timestamp (seconds since epoch)
    pub activity_date: i64,
    /// Best time in seconds
    pub best_time: f64,
    /// Best pace in m/s
    pub best_pace: f64,
    /// Direction: "same" or "reverse"
    pub direction: String,
    /// Section distance in meters
    pub section_distance: f64,
    /// True if no time stream was available (proportional estimate)
    pub is_estimated: bool,
    /// Number of traversals in this bucket
    pub bucket_count: u32,
}

/// Result of bucketed section performance query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionPerformanceBucketResult {
    /// Best-per-bucket data points for chart display
    pub buckets: Vec<SectionPerformanceBucket>,
    /// Total traversals in the date range (not just bucket count)
    pub total_traversals: u32,
    /// Overall PR bucket (always included even if outside date range)
    pub pr_bucket: Option<SectionPerformanceBucket>,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<DirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<DirectionStats>,
}
