//! App-layer types for persistence and FFI.
//!
//! These types are data containers used by the persistence layer and FFI boundary.
//! They were moved out of tracematch because they are not produced or consumed
//! by any tracematch algorithm - they exist solely for the app's storage and UI.

use serde::{Deserialize, Serialize};

// ============================================================================
// Activity Metrics
// ============================================================================

/// Stores the non-GPS data needed for performance comparison.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    /// Training load / TSS (optional)
    pub training_load: Option<f64>,
    /// FTP used for this activity (optional)
    pub ftp: Option<u16>,
    /// Power zone times in seconds per zone (optional)
    pub power_zone_times: Option<Vec<u32>>,
    /// HR zone times in seconds per zone (optional)
    pub hr_zone_times: Option<Vec<u32>>,
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
    /// True when the recorded distance sits outside the band around the
    /// route's usual distance, so the attempt holds no record and is not
    /// counted in the rank.
    pub outside_distance_band: bool,
    /// True when this attempt strictly beats every other counted attempt in
    /// its sport and direction, under the one record rule.
    pub is_record: bool,
}

/// Complete route performance result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePerformanceResult {
    /// Performances sorted by date (oldest first)
    pub performances: Vec<RoutePerformance>,
    /// Activity metrics for all activities in the route (inlined to avoid duplicate FFI call)
    pub activity_metrics: Vec<ActivityMetrics>,
    /// Fastest forward performance, or fastest reverse when none ran forward.
    pub best: Option<RoutePerformance>,
    /// Best performance in forward/same direction
    pub best_forward: Option<RoutePerformance>,
    /// Best performance in reverse direction
    pub best_reverse: Option<RoutePerformance>,
    /// Best performance in the current activity's direction.
    pub current_direction_best: Option<RoutePerformance>,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<DirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<DirectionStats>,
    /// Current activity's standing, with rank one reserved for a strict record.
    pub current_rank: Option<u32>,
    /// Timed comparable attempts in the current direction.
    pub attempt_count: u32,
    /// Share of those attempts slower than the current one, 0 to 100.
    /// `None` for a lone attempt or an activity that is not on the route.
    pub percentile_rank: Option<f64>,
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
    /// Direction: "same", "reverse" or "partial"
    pub direction: String,
    /// Start index in the activity's GPS track
    #[serde(alias = "start_index")]
    pub start_index: u32,
    /// End index in the activity's GPS track
    #[serde(alias = "end_index")]
    pub end_index: u32,
    /// Mean heart rate over the lap, when the activity carried a stream.
    #[serde(default, alias = "avg_hr")]
    pub avg_hr: Option<f64>,
    /// Mean watts over the lap, when the activity carried a power stream.
    #[serde(default, alias = "avg_power")]
    pub avg_power: Option<f64>,
    /// Share of the section this lap spans, `None` until it is measured.
    #[serde(default)]
    pub coverage: Option<f64>,
    /// The athlete excluded this traversal. Only a read that asked for
    /// excluded rows carries one, and it never counts.
    #[serde(default)]
    pub excluded: bool,
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
    /// Best eligible forward lap time.
    #[serde(default)]
    pub best_forward_time: Option<f64>,
    /// Best eligible reverse lap time.
    #[serde(default)]
    pub best_reverse_time: Option<f64>,
    /// Average lap time in seconds
    #[serde(alias = "avg_time")]
    pub avg_time: f64,
    /// Average pace in m/s
    #[serde(alias = "avg_pace")]
    pub avg_pace: f64,
    /// Primary direction: "same" or "reverse"
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
    /// Average speed across all traversals in this direction (m/s).
    /// Populated by route performance queries; section performance queries
    /// currently leave it as None.
    #[serde(default)]
    pub avg_speed: Option<f64>,
}

/// Complete section performance result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionPerformanceResult {
    /// Performance records sorted by date (oldest first)
    pub records: Vec<SectionPerformanceRecord>,
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
// Section Performance Bucket Types
// ============================================================================

// ============================================================================
// Calendar Summary Types
// ============================================================================

/// Best performance in one direction for a calendar period.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDirectionBest {
    /// Number of traversals in this direction
    pub count: u32,
    /// Best time in seconds
    pub best_time: f64,
    /// Best pace in m/s
    pub best_pace: f64,
    /// Activity ID of best traversal
    pub best_activity_id: String,
    /// Name of best activity
    pub best_activity_name: String,
}

/// Best performance in a calendar month, split by direction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarMonthSummary {
    /// Month number (1-12)
    pub month: u32,
    /// Total traversals in this month (both directions), one per lap
    pub traversal_count: u32,
    /// Distinct activities those traversals came from
    #[serde(default)]
    pub activity_count: u32,
    /// Best forward/same direction performance (None if no forward traversals)
    pub forward: Option<CalendarDirectionBest>,
    /// Best reverse direction performance (None if no reverse traversals)
    pub reverse: Option<CalendarDirectionBest>,
}

/// Best performance in a calendar year, with monthly breakdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarYearSummary {
    /// Calendar year
    pub year: i32,
    /// Total traversals in this year, one per lap
    pub traversal_count: u32,
    /// Distinct activities those traversals came from
    #[serde(default)]
    pub activity_count: u32,
    /// Best forward/same direction performance this year
    pub forward: Option<CalendarDirectionBest>,
    /// Best reverse direction performance this year
    pub reverse: Option<CalendarDirectionBest>,
    /// Monthly breakdowns (only months with traversals, sorted 1-12)
    pub months: Vec<CalendarMonthSummary>,
}

/// Calendar-aligned performance summary for a section.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSummary {
    /// Year summaries (newest first)
    pub years: Vec<CalendarYearSummary>,
    /// Overall forward/same PR
    pub forward_pr: Option<CalendarDirectionBest>,
    /// Overall reverse PR
    pub reverse_pr: Option<CalendarDirectionBest>,
    /// Section distance in meters
    pub section_distance: f64,
}
