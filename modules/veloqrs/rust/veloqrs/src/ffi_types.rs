//! FFI-safe types with UniFFI derives.
//!
//! These types mirror tracematch types but add UniFFI derives for mobile FFI.
//! Conversion is done at the FFI boundary.

use serde::{Deserialize, Serialize};

// ============================================================================
// Core Types
// ============================================================================

/// Batch trace result: one activity's extracted section trace as flat coords.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBatchTrace {
    pub activity_id: String,
    /// Flat coordinates [lat, lng, lat, lng, ...]
    pub coords: Vec<f64>,
}

/// GPS point for FFI
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct FfiGpsPoint {
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elevation: Option<f64>,
}

impl From<tracematch::GpsPoint> for FfiGpsPoint {
    fn from(p: tracematch::GpsPoint) -> Self {
        Self {
            latitude: p.latitude,
            longitude: p.longitude,
            elevation: p.elevation,
        }
    }
}

impl From<FfiGpsPoint> for tracematch::GpsPoint {
    fn from(p: FfiGpsPoint) -> Self {
        match p.elevation {
            Some(e) => Self::with_elevation(p.latitude, p.longitude, e),
            None => Self::new(p.latitude, p.longitude),
        }
    }
}

/// Bounding box for FFI
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct FfiBounds {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
}

impl From<tracematch::Bounds> for FfiBounds {
    fn from(b: tracematch::Bounds) -> Self {
        Self {
            min_lat: b.min_lat,
            max_lat: b.max_lat,
            min_lng: b.min_lng,
            max_lng: b.max_lng,
        }
    }
}

impl From<FfiBounds> for tracematch::Bounds {
    fn from(b: FfiBounds) -> Self {
        Self {
            min_lat: b.min_lat,
            max_lat: b.max_lat,
            min_lng: b.min_lng,
            max_lng: b.max_lng,
        }
    }
}

/// Activity metrics for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
pub struct FfiActivityMetrics {
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
    /// Power zone times as JSON array string: "[secs, secs, ...]" (optional)
    pub power_zone_times: Option<String>,
    /// HR zone times as JSON array string: "[secs, secs, ...]" (optional)
    pub hr_zone_times: Option<String>,
}

impl From<tracematch::ActivityMetrics> for FfiActivityMetrics {
    fn from(m: tracematch::ActivityMetrics) -> Self {
        Self {
            activity_id: m.activity_id,
            name: m.name,
            date: m.date,
            distance: m.distance,
            moving_time: m.moving_time,
            elapsed_time: m.elapsed_time,
            elevation_gain: m.elevation_gain,
            avg_hr: m.avg_hr,
            avg_power: m.avg_power,
            sport_type: m.sport_type,
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        }
    }
}

impl From<FfiActivityMetrics> for tracematch::ActivityMetrics {
    fn from(m: FfiActivityMetrics) -> Self {
        Self {
            activity_id: m.activity_id,
            name: m.name,
            date: m.date,
            distance: m.distance,
            moving_time: m.moving_time,
            elapsed_time: m.elapsed_time,
            elevation_gain: m.elevation_gain,
            avg_hr: m.avg_hr,
            avg_power: m.avg_power,
            sport_type: m.sport_type,
        }
    }
}

// ============================================================================
// Aggregate Query Result Types
// ============================================================================

/// Aggregated stats for a date range.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPeriodStats {
    /// Number of activities
    pub count: u32,
    /// Total moving time in seconds
    pub total_duration: i64,
    /// Total distance in meters
    pub total_distance: f64,
    /// Total training load (TSS)
    pub total_tss: f64,
}

/// Monthly aggregate value.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMonthlyAggregate {
    /// Month (0-11)
    pub month: u8,
    /// Aggregated value (hours, distance in meters, or TSS)
    pub value: f64,
}

/// Activity heatmap day entry.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiHeatmapDay {
    /// Date string "YYYY-MM-DD"
    pub date: String,
    /// Intensity level (0-4)
    pub intensity: u8,
}

/// FTP trend data.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiFtpTrend {
    /// Most recent FTP value
    pub latest_ftp: Option<u16>,
    /// Date of most recent FTP (Unix timestamp seconds)
    pub latest_date: Option<i64>,
    /// Previous different FTP value
    pub previous_ftp: Option<u16>,
    /// Date of previous FTP (Unix timestamp seconds)
    pub previous_date: Option<i64>,
}

// ============================================================================
// Route Types
// ============================================================================

/// Route signature for FFI
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteSignature {
    pub activity_id: String,
    pub points: Vec<FfiGpsPoint>,
    pub total_distance: f64,
    pub start_point: FfiGpsPoint,
    pub end_point: FfiGpsPoint,
    pub bounds: FfiBounds,
    pub center: FfiGpsPoint,
}

impl From<tracematch::RouteSignature> for FfiRouteSignature {
    fn from(s: tracematch::RouteSignature) -> Self {
        Self {
            activity_id: s.activity_id,
            points: s.points.into_iter().map(FfiGpsPoint::from).collect(),
            total_distance: s.total_distance,
            start_point: FfiGpsPoint::from(s.start_point),
            end_point: FfiGpsPoint::from(s.end_point),
            bounds: FfiBounds::from(s.bounds),
            center: FfiGpsPoint::from(s.center),
        }
    }
}

impl From<FfiRouteSignature> for tracematch::RouteSignature {
    fn from(s: FfiRouteSignature) -> Self {
        Self {
            activity_id: s.activity_id,
            points: s
                .points
                .into_iter()
                .map(tracematch::GpsPoint::from)
                .collect(),
            total_distance: s.total_distance,
            start_point: tracematch::GpsPoint::from(s.start_point),
            end_point: tracematch::GpsPoint::from(s.end_point),
            bounds: tracematch::Bounds::from(s.bounds),
            center: tracematch::GpsPoint::from(s.center),
        }
    }
}

/// Route group for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRouteGroup {
    pub group_id: String,
    pub representative_id: String,
    pub activity_ids: Vec<String>,
    pub sport_type: String,
    pub bounds: Option<FfiBounds>,
    pub custom_name: Option<String>,
    #[serde(default)]
    pub best_time: Option<f64>,
    #[serde(default)]
    pub avg_time: Option<f64>,
    #[serde(default)]
    pub best_pace: Option<f64>,
    #[serde(default)]
    pub best_activity_id: Option<String>,
}

impl From<tracematch::RouteGroup> for FfiRouteGroup {
    fn from(g: tracematch::RouteGroup) -> Self {
        Self {
            group_id: g.group_id,
            representative_id: g.representative_id,
            activity_ids: g.activity_ids,
            sport_type: g.sport_type,
            bounds: g.bounds.map(FfiBounds::from),
            custom_name: g.custom_name,
            best_time: g.best_time,
            avg_time: g.avg_time,
            best_pace: g.best_pace,
            best_activity_id: g.best_activity_id,
        }
    }
}

impl From<FfiRouteGroup> for tracematch::RouteGroup {
    fn from(g: FfiRouteGroup) -> Self {
        Self {
            group_id: g.group_id,
            representative_id: g.representative_id,
            activity_ids: g.activity_ids,
            sport_type: g.sport_type,
            bounds: g.bounds.map(tracematch::Bounds::from),
            custom_name: g.custom_name,
            best_time: g.best_time,
            avg_time: g.avg_time,
            best_pace: g.best_pace,
            best_activity_id: g.best_activity_id,
        }
    }
}

// ============================================================================
// Section Detection Types
// ============================================================================

/// Scale preset for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiScalePreset {
    pub name: String,
    pub min_length: f64,
    pub max_length: f64,
    pub min_activities: u32,
}

impl From<tracematch::ScalePreset> for FfiScalePreset {
    fn from(s: tracematch::ScalePreset) -> Self {
        Self {
            name: s.name,
            min_length: s.min_length,
            max_length: s.max_length,
            min_activities: s.min_activities,
        }
    }
}

impl From<FfiScalePreset> for tracematch::ScalePreset {
    fn from(s: FfiScalePreset) -> Self {
        Self {
            name: s.name,
            min_length: s.min_length,
            max_length: s.max_length,
            min_activities: s.min_activities,
        }
    }
}

/// Section config for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionConfig {
    pub proximity_threshold: f64,
    pub min_section_length: f64,
    pub max_section_length: f64,
    pub min_activities: u32,
    pub cluster_tolerance: f64,
    pub sample_points: u32,
    pub detection_mode: String,
    pub include_potentials: bool,
    pub scale_presets: Vec<FfiScalePreset>,
    pub preserve_hierarchy: bool,
}

impl From<FfiSectionConfig> for tracematch::SectionConfig {
    fn from(c: FfiSectionConfig) -> Self {
        Self {
            proximity_threshold: c.proximity_threshold,
            min_section_length: c.min_section_length,
            max_section_length: c.max_section_length,
            min_activities: c.min_activities,
            cluster_tolerance: c.cluster_tolerance,
            sample_points: c.sample_points,
            detection_mode: c.detection_mode,
            include_potentials: c.include_potentials,
            scale_presets: c
                .scale_presets
                .into_iter()
                .map(tracematch::ScalePreset::from)
                .collect(),
            preserve_hierarchy: c.preserve_hierarchy,
        }
    }
}

impl Default for FfiSectionConfig {
    fn default() -> Self {
        let c = tracematch::SectionConfig::default();
        Self {
            proximity_threshold: c.proximity_threshold,
            min_section_length: c.min_section_length,
            max_section_length: c.max_section_length,
            min_activities: c.min_activities,
            cluster_tolerance: c.cluster_tolerance,
            sample_points: c.sample_points,
            detection_mode: c.detection_mode,
            include_potentials: c.include_potentials,
            scale_presets: c
                .scale_presets
                .into_iter()
                .map(FfiScalePreset::from)
                .collect(),
            preserve_hierarchy: c.preserve_hierarchy,
        }
    }
}

/// Section portion for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPortion {
    pub activity_id: String,
    pub start_index: u32,
    pub end_index: u32,
    pub distance_meters: f64,
    pub direction: String,
}

impl From<tracematch::SectionPortion> for FfiSectionPortion {
    fn from(p: tracematch::SectionPortion) -> Self {
        Self {
            activity_id: p.activity_id,
            start_index: p.start_index,
            end_index: p.end_index,
            distance_meters: p.distance_meters,
            direction: p.direction,
        }
    }
}

/// Frequent section for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiFrequentSection {
    pub id: String,
    pub name: Option<String>,
    pub sport_type: String,
    pub polyline: Vec<FfiGpsPoint>,
    pub representative_activity_id: String,
    pub activity_ids: Vec<String>,
    pub activity_portions: Vec<FfiSectionPortion>,
    pub route_ids: Vec<String>,
    pub visit_count: u32,
    pub distance_meters: f64,
    pub confidence: f64,
    pub observation_count: u32,
    pub average_spread: f64,
    pub point_density: Vec<u32>,
    pub scale: Option<String>,
    pub version: u32,
    pub is_user_defined: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub stability: f64,
}

impl From<tracematch::FrequentSection> for FfiFrequentSection {
    fn from(s: tracematch::FrequentSection) -> Self {
        Self {
            id: s.id,
            name: s.name,
            sport_type: s.sport_type,
            polyline: s.polyline.into_iter().map(FfiGpsPoint::from).collect(),
            representative_activity_id: s.representative_activity_id,
            activity_ids: s.activity_ids,
            activity_portions: s
                .activity_portions
                .into_iter()
                .map(FfiSectionPortion::from)
                .collect(),
            route_ids: s.route_ids,
            visit_count: s.visit_count,
            distance_meters: s.distance_meters,
            confidence: s.confidence,
            observation_count: s.observation_count,
            average_spread: s.average_spread,
            point_density: s.point_density,
            scale: s.scale,
            version: s.version,
            is_user_defined: s.is_user_defined,
            created_at: s.created_at,
            updated_at: s.updated_at,
            stability: s.stability,
        }
    }
}

/// Potential section for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiPotentialSection {
    pub id: String,
    pub sport_type: String,
    pub polyline: Vec<FfiGpsPoint>,
    pub activity_ids: Vec<String>,
    pub distance_meters: f64,
    pub confidence: f64,
    pub scale: String,
}

impl From<tracematch::PotentialSection> for FfiPotentialSection {
    fn from(s: tracematch::PotentialSection) -> Self {
        Self {
            id: s.id,
            sport_type: s.sport_type,
            polyline: s.polyline.into_iter().map(FfiGpsPoint::from).collect(),
            activity_ids: s.activity_ids,
            distance_meters: s.distance_meters,
            confidence: s.confidence,
            scale: s.scale,
        }
    }
}

/// Detection stats for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiDetectionStats {
    pub activities_processed: u32,
    pub overlaps_found: u32,
    pub sections_by_scale: std::collections::HashMap<String, u32>,
    pub potentials_by_scale: std::collections::HashMap<String, u32>,
}

impl From<tracematch::DetectionStats> for FfiDetectionStats {
    fn from(s: tracematch::DetectionStats) -> Self {
        Self {
            activities_processed: s.activities_processed,
            overlaps_found: s.overlaps_found,
            sections_by_scale: s.sections_by_scale,
            potentials_by_scale: s.potentials_by_scale,
        }
    }
}

/// Multi-scale section result for FFI
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiMultiScaleSectionResult {
    pub sections: Vec<FfiFrequentSection>,
    pub potentials: Vec<FfiPotentialSection>,
    pub stats: FfiDetectionStats,
}

impl From<tracematch::MultiScaleSectionResult> for FfiMultiScaleSectionResult {
    fn from(r: tracematch::MultiScaleSectionResult) -> Self {
        Self {
            sections: r
                .sections
                .into_iter()
                .map(FfiFrequentSection::from)
                .collect(),
            potentials: r
                .potentials
                .into_iter()
                .map(FfiPotentialSection::from)
                .collect(),
            stats: FfiDetectionStats::from(r.stats),
        }
    }
}

// ============================================================================
// Unified Section Type
// ============================================================================

/// Unified section for FFI.
/// Represents both auto-detected and custom sections with the same structure.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSection {
    pub id: String,
    pub section_type: String,
    pub name: Option<String>,
    pub sport_type: String,
    pub polyline: Vec<FfiGpsPoint>,
    pub distance_meters: f64,
    pub representative_activity_id: Option<String>,
    pub activity_ids: Vec<String>,
    pub visit_count: u32,
    // Auto-specific metadata (None for custom sections)
    pub confidence: Option<f64>,
    pub observation_count: Option<u32>,
    pub average_spread: Option<f64>,
    pub point_density: Option<Vec<u32>>,
    pub scale: Option<String>,
    // Version tracking
    pub version: u32,
    pub is_user_defined: bool,
    pub stability: Option<f64>,
    // Timestamps
    pub created_at: String,
    pub updated_at: Option<String>,
    // Route associations
    pub route_ids: Option<Vec<String>>,
    // Custom-specific fields (None for auto sections)
    pub source_activity_id: Option<String>,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,
}

impl From<crate::sections::Section> for FfiSection {
    fn from(s: crate::sections::Section) -> Self {
        Self {
            id: s.id,
            section_type: s.section_type.as_str().to_string(),
            name: s.name,
            sport_type: s.sport_type,
            polyline: s.polyline.into_iter().map(FfiGpsPoint::from).collect(),
            distance_meters: s.distance_meters,
            representative_activity_id: s.representative_activity_id,
            activity_ids: s.activity_ids,
            visit_count: s.visit_count,
            confidence: s.confidence,
            observation_count: s.observation_count,
            average_spread: s.average_spread,
            point_density: s.point_density,
            scale: s.scale,
            version: s.version,
            is_user_defined: s.is_user_defined,
            stability: s.stability,
            created_at: s.created_at,
            updated_at: s.updated_at,
            route_ids: s.route_ids,
            source_activity_id: s.source_activity_id,
            start_index: s.start_index,
            end_index: s.end_index,
        }
    }
}

// ============================================================================
// ============================================================================
// Performance Types
// ============================================================================

/// Section lap for FFI.
/// Represents a single traversal of a section within an activity.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionLap {
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

impl From<tracematch::SectionLap> for FfiSectionLap {
    fn from(l: tracematch::SectionLap) -> Self {
        Self {
            id: l.id,
            activity_id: l.activity_id,
            time: l.time,
            pace: l.pace,
            distance: l.distance,
            direction: l.direction,
            start_index: l.start_index,
            end_index: l.end_index,
        }
    }
}

/// Section performance record for FFI.
/// Contains all traversals for a single activity on a section.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPerformanceRecord {
    pub activity_id: String,
    pub activity_name: String,
    /// Unix timestamp
    pub activity_date: i64,
    /// All laps for this activity on this section
    pub laps: Vec<FfiSectionLap>,
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

impl From<tracematch::SectionPerformanceRecord> for FfiSectionPerformanceRecord {
    fn from(r: tracematch::SectionPerformanceRecord) -> Self {
        Self {
            activity_id: r.activity_id,
            activity_name: r.activity_name,
            activity_date: r.activity_date,
            laps: r.laps.into_iter().map(FfiSectionLap::from).collect(),
            lap_count: r.lap_count,
            best_time: r.best_time,
            best_pace: r.best_pace,
            avg_time: r.avg_time,
            avg_pace: r.avg_pace,
            direction: r.direction,
            section_distance: r.section_distance,
        }
    }
}

/// Direction stats for FFI.
/// Summary statistics for traversals in a single direction.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiDirectionStats {
    /// Average time across all traversals in this direction (seconds)
    pub avg_time: Option<f64>,
    /// Unix timestamp of most recent traversal in this direction
    pub last_activity: Option<i64>,
    /// Number of traversals in this direction
    pub count: u32,
}

impl From<tracematch::DirectionStats> for FfiDirectionStats {
    fn from(s: tracematch::DirectionStats) -> Self {
        Self {
            avg_time: s.avg_time,
            last_activity: s.last_activity,
            count: s.count,
        }
    }
}

/// Section performance result for FFI.
/// Complete performance data for a section across all activities.
/// Replaces the JSON-returning `persistent_engine_get_section_performances_json()`.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPerformanceResult {
    /// Performance records sorted by date (oldest first)
    pub records: Vec<FfiSectionPerformanceRecord>,
    /// Best record (fastest time) - overall regardless of direction
    pub best_record: Option<FfiSectionPerformanceRecord>,
    /// Best record in forward/same direction
    pub best_forward_record: Option<FfiSectionPerformanceRecord>,
    /// Best record in reverse direction
    pub best_reverse_record: Option<FfiSectionPerformanceRecord>,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<FfiDirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<FfiDirectionStats>,
}

impl From<tracematch::SectionPerformanceResult> for FfiSectionPerformanceResult {
    fn from(r: tracematch::SectionPerformanceResult) -> Self {
        Self {
            records: r
                .records
                .into_iter()
                .map(FfiSectionPerformanceRecord::from)
                .collect(),
            best_record: r.best_record.map(FfiSectionPerformanceRecord::from),
            best_forward_record: r.best_forward_record.map(FfiSectionPerformanceRecord::from),
            best_reverse_record: r.best_reverse_record.map(FfiSectionPerformanceRecord::from),
            forward_stats: r.forward_stats.map(FfiDirectionStats::from),
            reverse_stats: r.reverse_stats.map(FfiDirectionStats::from),
        }
    }
}

/// Route performance for FFI.
/// Performance data for a single activity on a route.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRoutePerformance {
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

impl From<tracematch::RoutePerformance> for FfiRoutePerformance {
    fn from(p: tracematch::RoutePerformance) -> Self {
        Self {
            activity_id: p.activity_id,
            name: p.name,
            date: p.date,
            speed: p.speed,
            duration: p.duration,
            moving_time: p.moving_time,
            distance: p.distance,
            elevation_gain: p.elevation_gain,
            avg_hr: p.avg_hr,
            avg_power: p.avg_power,
            is_current: p.is_current,
            direction: p.direction,
            match_percentage: p.match_percentage,
        }
    }
}

/// Route performance result for FFI.
/// Complete performance data for a route group across all activities.
/// Replaces the JSON-returning `persistent_engine_get_route_performances_json()`.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRoutePerformanceResult {
    /// Performances sorted by date (oldest first)
    pub performances: Vec<FfiRoutePerformance>,
    /// Best performance (fastest speed) - overall regardless of direction
    pub best: Option<FfiRoutePerformance>,
    /// Best performance in forward/same direction
    pub best_forward: Option<FfiRoutePerformance>,
    /// Best performance in reverse direction
    pub best_reverse: Option<FfiRoutePerformance>,
    /// Summary stats for forward/same direction
    pub forward_stats: Option<FfiDirectionStats>,
    /// Summary stats for reverse direction
    pub reverse_stats: Option<FfiDirectionStats>,
    /// Current activity's rank (1 = fastest), if current_activity_id was provided
    pub current_rank: Option<u32>,
}

impl From<tracematch::RoutePerformanceResult> for FfiRoutePerformanceResult {
    fn from(r: tracematch::RoutePerformanceResult) -> Self {
        Self {
            performances: r
                .performances
                .into_iter()
                .map(FfiRoutePerformance::from)
                .collect(),
            best: r.best.map(FfiRoutePerformance::from),
            best_forward: r.best_forward.map(FfiRoutePerformance::from),
            best_reverse: r.best_reverse.map(FfiRoutePerformance::from),
            forward_stats: r.forward_stats.map(FfiDirectionStats::from),
            reverse_stats: r.reverse_stats.map(FfiDirectionStats::from),
            current_rank: r.current_rank,
        }
    }
}

// ============================================================================
// Batch Screen Data Types
// ============================================================================

/// Group summary with embedded consensus polyline for the Routes screen.
/// Avoids N separate getConsensusRoute() calls.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiGroupWithPolyline {
    pub group_id: String,
    pub representative_id: String,
    pub sport_type: String,
    pub activity_count: u32,
    pub custom_name: Option<String>,
    pub bounds: Option<FfiBounds>,
    /// Distance in meters (from representative activity's metrics)
    pub distance_meters: f64,
    /// Flat lat/lng pairs [lat1, lng1, lat2, lng2, ...]
    pub consensus_polyline: Vec<f64>,
}

/// Section summary with embedded polyline for the Routes screen.
/// Avoids N separate getSectionPolyline() calls.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionWithPolyline {
    pub id: String,
    pub name: Option<String>,
    pub sport_type: String,
    pub visit_count: u32,
    pub distance_meters: f64,
    pub activity_count: u32,
    pub confidence: f64,
    pub scale: Option<String>,
    pub bounds: Option<FfiBounds>,
    /// Flat lat/lng pairs [lat1, lng1, lat2, lng2, ...]
    pub polyline: Vec<f64>,
}

/// All data needed by the Routes screen in a single FFI call.
/// Supports pagination via limit/offset for groups and sections.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRoutesScreenData {
    pub activity_count: u32,
    pub group_count: u32,
    pub section_count: u32,
    pub oldest_date: Option<i64>,
    pub newest_date: Option<i64>,
    pub groups: Vec<FfiGroupWithPolyline>,
    pub sections: Vec<FfiSectionWithPolyline>,
    /// Whether more groups are available beyond the current page
    pub has_more_groups: bool,
    /// Whether more sections are available beyond the current page
    pub has_more_sections: bool,
}

// ============================================================================
// Helper functions
// ============================================================================

/// Get default scale presets
pub fn default_scale_presets() -> Vec<FfiScalePreset> {
    tracematch::ScalePreset::default_presets()
        .into_iter()
        .map(FfiScalePreset::from)
        .collect()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ffi_direction_stats_from_tracematch() {
        let stats = tracematch::DirectionStats {
            avg_time: Some(300.0),
            last_activity: Some(1700000000),
            count: 5,
        };
        let ffi_stats = FfiDirectionStats::from(stats);
        assert_eq!(ffi_stats.avg_time, Some(300.0));
        assert_eq!(ffi_stats.last_activity, Some(1700000000));
        assert_eq!(ffi_stats.count, 5);
    }

    #[test]
    fn test_ffi_section_lap_from_tracematch() {
        let lap = tracematch::SectionLap {
            id: "lap_1".to_string(),
            activity_id: "act_123".to_string(),
            time: 120.5,
            pace: 8.3,
            distance: 1000.0,
            direction: "forward".to_string(),
            start_index: 0,
            end_index: 100,
        };
        let ffi_lap = FfiSectionLap::from(lap);
        assert_eq!(ffi_lap.id, "lap_1");
        assert_eq!(ffi_lap.activity_id, "act_123");
        assert_eq!(ffi_lap.time, 120.5);
        assert_eq!(ffi_lap.pace, 8.3);
        assert_eq!(ffi_lap.direction, "forward");
    }

    #[test]
    fn test_ffi_section_performance_record_from_tracematch() {
        let lap = tracematch::SectionLap {
            id: "lap_1".to_string(),
            activity_id: "act_123".to_string(),
            time: 120.5,
            pace: 8.3,
            distance: 1000.0,
            direction: "forward".to_string(),
            start_index: 0,
            end_index: 100,
        };
        let record = tracematch::SectionPerformanceRecord {
            activity_id: "act_123".to_string(),
            activity_name: "Morning Ride".to_string(),
            activity_date: 1700000000,
            laps: vec![lap],
            lap_count: 1,
            best_time: 120.5,
            best_pace: 8.3,
            avg_time: 120.5,
            avg_pace: 8.3,
            direction: "forward".to_string(),
            section_distance: 1000.0,
        };
        let ffi_record = FfiSectionPerformanceRecord::from(record);
        assert_eq!(ffi_record.activity_id, "act_123");
        assert_eq!(ffi_record.activity_name, "Morning Ride");
        assert_eq!(ffi_record.laps.len(), 1);
        assert_eq!(ffi_record.best_time, 120.5);
    }

    #[test]
    fn test_ffi_route_performance_from_tracematch() {
        let perf = tracematch::RoutePerformance {
            activity_id: "act_123".to_string(),
            name: "Morning Ride".to_string(),
            date: 1700000000,
            speed: 8.5,
            duration: 3600,
            moving_time: 3500,
            distance: 30000.0,
            elevation_gain: 500.0,
            avg_hr: Some(145),
            avg_power: Some(200),
            is_current: false,
            direction: "same".to_string(),
            match_percentage: Some(95.5),
        };
        let ffi_perf = FfiRoutePerformance::from(perf);
        assert_eq!(ffi_perf.activity_id, "act_123");
        assert_eq!(ffi_perf.speed, 8.5);
        assert_eq!(ffi_perf.avg_hr, Some(145));
        assert_eq!(ffi_perf.match_percentage, Some(95.5));
    }

    #[test]
    fn test_ffi_section_performance_result_empty() {
        let result = tracematch::SectionPerformanceResult {
            records: vec![],
            best_record: None,
            best_forward_record: None,
            best_reverse_record: None,
            forward_stats: None,
            reverse_stats: None,
        };
        let ffi_result = FfiSectionPerformanceResult::from(result);
        assert!(ffi_result.records.is_empty());
        assert!(ffi_result.best_record.is_none());
    }

    #[test]
    fn test_ffi_route_performance_result_empty() {
        let result = tracematch::RoutePerformanceResult {
            performances: vec![],
            best: None,
            best_forward: None,
            best_reverse: None,
            forward_stats: None,
            reverse_stats: None,
            current_rank: None,
        };
        let ffi_result = FfiRoutePerformanceResult::from(result);
        assert!(ffi_result.performances.is_empty());
        assert!(ffi_result.best.is_none());
        assert!(ffi_result.current_rank.is_none());
    }

    #[test]
    fn test_ffi_section_from_section() {
        use crate::sections::{Section, SectionType};

        let section = Section {
            id: "section_123".to_string(),
            section_type: SectionType::Auto,
            name: Some("Test Section".to_string()),
            sport_type: "Ride".to_string(),
            polyline: vec![
                tracematch::GpsPoint::new(40.0, -74.0),
                tracematch::GpsPoint::new(40.1, -73.9),
            ],
            distance_meters: 1500.0,
            representative_activity_id: Some("act_123".to_string()),
            activity_ids: vec!["act_123".to_string(), "act_456".to_string()],
            visit_count: 5,
            confidence: Some(0.95),
            observation_count: Some(10),
            average_spread: Some(15.0),
            point_density: Some(vec![5, 5]),
            scale: Some("medium".to_string()),
            version: 1,
            is_user_defined: false,
            stability: Some(0.9),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: Some("2024-01-02T00:00:00Z".to_string()),
            route_ids: Some(vec!["route_1".to_string()]),
            source_activity_id: None,
            start_index: None,
            end_index: None,
        };

        let ffi_section = FfiSection::from(section);
        assert_eq!(ffi_section.id, "section_123");
        assert_eq!(ffi_section.section_type, "auto");
        assert_eq!(ffi_section.name, Some("Test Section".to_string()));
        assert_eq!(ffi_section.sport_type, "Ride");
        assert_eq!(ffi_section.polyline.len(), 2);
        assert_eq!(ffi_section.distance_meters, 1500.0);
        assert_eq!(ffi_section.activity_ids.len(), 2);
        assert_eq!(ffi_section.visit_count, 5);
        assert_eq!(ffi_section.confidence, Some(0.95));
        assert!(!ffi_section.is_user_defined);
        assert_eq!(ffi_section.route_ids, Some(vec!["route_1".to_string()]));
        assert!(ffi_section.source_activity_id.is_none());
    }
}
