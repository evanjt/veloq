//! FFI-safe types with UniFFI derives.
//!
//! These types mirror tracematch types but add UniFFI derives for mobile FFI.
//! Conversion is done at the FFI boundary.

use serde::{Deserialize, Serialize};

// ============================================================================
// Core Types
// ============================================================================

/// Batch trace result: one activity's extracted section trace.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBatchTrace {
    pub activity_id: String,
    /// Delta+varint encoded coordinates (decode with coords::decode)
    pub encoded_coords: Vec<u8>,
}

/// Entry for importing superseded section mappings from AsyncStorage migration.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSupersededEntry {
    pub custom_section_id: String,
    pub auto_section_ids: Vec<String>,
}

/// Extension track for expanding section bounds.
/// Contains the representative activity's full GPS track with section start/end indices.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionExtensionTrack {
    /// Delta+varint encoded coordinates of the full representative activity track
    pub encoded_track: Vec<u8>,
    /// Index in the track where the current section starts
    pub section_start_idx: u32,
    /// Index in the track where the current section ends
    pub section_end_idx: u32,
}

/// Section detection progress info.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiDetectionProgress {
    /// Current phase: "loading", "building_rtrees", "finding_overlaps", etc.
    pub phase: String,
    /// Number of items completed in current phase
    pub completed: u32,
    /// Total items in current phase
    pub total: u32,
    /// Phase-weighted overall percent (0–100)
    pub percent: u32,
}

/// Section reference info: combines reference activity ID and user-defined flag.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionReferenceInfo {
    pub activity_id: String,
    pub is_user_defined: bool,
}

/// Lightweight map signature for rendering activity traces on the map.
/// Contains simplified GPS points (max ~100 via Douglas-Peucker) as encoded coords.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMapSignature {
    pub activity_id: String,
    /// Delta+varint encoded coordinates (simplified, max ~100 points)
    pub encoded_coords: Vec<u8>,
    pub center_lat: f64,
    pub center_lng: f64,
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
    /// Power zone times in seconds per zone (optional)
    pub power_zone_times: Option<Vec<u32>>,
    /// HR zone times in seconds per zone (optional)
    pub hr_zone_times: Option<Vec<u32>>,
}

impl From<crate::ActivityMetrics> for FfiActivityMetrics {
    fn from(m: crate::ActivityMetrics) -> Self {
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

impl From<FfiActivityMetrics> for crate::ActivityMetrics {
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

/// Pace trend data (critical speed for running/swimming).
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPaceTrend {
    /// Most recent critical speed in m/s
    pub latest_pace: Option<f64>,
    /// Date of most recent snapshot (Unix timestamp seconds)
    pub latest_date: Option<i64>,
    /// Previous different critical speed in m/s
    pub previous_pace: Option<f64>,
    /// Date of previous snapshot (Unix timestamp seconds)
    pub previous_date: Option<i64>,
}

/// Summary card batch data: combines period stats, FTP trend, and pace trends.
/// Reduces Home screen FFI calls from 5 to 1.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSummaryCardData {
    pub current_week: FfiPeriodStats,
    pub prev_week: FfiPeriodStats,
    pub ftp_trend: FfiFtpTrend,
    pub run_pace_trend: FfiPaceTrend,
    pub swim_pace_trend: FfiPaceTrend,
}

/// Section summaries with total count: combines count + summaries in one call.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionSummariesResult {
    /// Total section count (unfiltered)
    pub total_count: u32,
    /// Summaries (optionally filtered by sport type)
    pub summaries: Vec<crate::SectionSummary>,
}

/// Group summaries with total count: combines count + summaries in one call.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiGroupSummariesResult {
    /// Total group count
    pub total_count: u32,
    /// All group summaries
    pub summaries: Vec<crate::GroupSummary>,
}

// ============================================================================
// Route Types
// ============================================================================

/// Route signature for FFI
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteSignature {
    pub activity_id: String,
    pub encoded_points: Vec<u8>,
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
            encoded_points: crate::coords::encode(&s.points),
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
            points: crate::coords::decode(&s.encoded_points),
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
            name: s.name.to_string(),
            min_length: s.min_length,
            max_length: s.max_length,
            min_activities: s.min_activities,
        }
    }
}

impl From<FfiScalePreset> for tracematch::ScalePreset {
    fn from(s: FfiScalePreset) -> Self {
        Self {
            name: s.name.parse().unwrap_or_default(),
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
    pub jaccard_threshold: f64,
    pub min_routes: u32,
    pub enable_density_splits: bool,
    pub merge_distance_multiplier: f64,
    pub min_cell_visits: u32,
    pub divergence_threshold: f64,
    pub min_corridor_tracks: u32,
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
            detection_mode: c.detection_mode.parse().unwrap_or_default(),
            include_potentials: c.include_potentials,
            scale_presets: c
                .scale_presets
                .into_iter()
                .map(tracematch::ScalePreset::from)
                .collect(),
            preserve_hierarchy: c.preserve_hierarchy,
            jaccard_threshold: c.jaccard_threshold,
            min_routes: c.min_routes,
            enable_density_splits: c.enable_density_splits,
            merge_distance_multiplier: c.merge_distance_multiplier,
            min_cell_visits: c.min_cell_visits,
            divergence_threshold: c.divergence_threshold,
            min_corridor_tracks: c.min_corridor_tracks,
            // Pooling is not a user setting, so it stays off the FFI record.
            pool_sports: tracematch::SectionConfig::default().pool_sports,
        }
    }
}

impl From<&tracematch::SectionConfig> for FfiSectionConfig {
    fn from(c: &tracematch::SectionConfig) -> Self {
        Self {
            proximity_threshold: c.proximity_threshold,
            min_section_length: c.min_section_length,
            max_section_length: c.max_section_length,
            min_activities: c.min_activities,
            cluster_tolerance: c.cluster_tolerance,
            sample_points: c.sample_points,
            detection_mode: c.detection_mode.to_string(),
            include_potentials: c.include_potentials,
            scale_presets: c
                .scale_presets
                .iter()
                .cloned()
                .map(FfiScalePreset::from)
                .collect(),
            preserve_hierarchy: c.preserve_hierarchy,
            jaccard_threshold: c.jaccard_threshold,
            min_routes: c.min_routes,
            enable_density_splits: c.enable_density_splits,
            merge_distance_multiplier: c.merge_distance_multiplier,
            min_cell_visits: c.min_cell_visits,
            divergence_threshold: c.divergence_threshold,
            min_corridor_tracks: c.min_corridor_tracks,
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
            detection_mode: c.detection_mode.to_string(),
            include_potentials: c.include_potentials,
            scale_presets: c
                .scale_presets
                .into_iter()
                .map(FfiScalePreset::from)
                .collect(),
            preserve_hierarchy: c.preserve_hierarchy,
            jaccard_threshold: c.jaccard_threshold,
            min_routes: c.min_routes,
            enable_density_splits: c.enable_density_splits,
            merge_distance_multiplier: c.merge_distance_multiplier,
            min_cell_visits: c.min_cell_visits,
            divergence_threshold: c.divergence_threshold,
            min_corridor_tracks: c.min_corridor_tracks,
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
            direction: p.direction.to_string(),
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
    pub encoded_polyline: Vec<u8>,
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
    pub is_user_defined: bool,
    pub stability: f64,
    pub version: u32,
    pub updated_at: Option<String>,
    pub created_at: Option<String>,
    pub elevation_gain_m: Option<f64>,
    pub avg_grade_percent: Option<f64>,
    pub elevation_loss_m: Option<f64>,
    pub max_grade_percent: Option<f64>,
    pub straightness: Option<f64>,
    pub klass: Option<String>,
    pub is_lift: bool,
    pub rank_score: Option<f64>,
    pub sport_rank_score: Option<f64>,
}

impl From<tracematch::FrequentSection> for FfiFrequentSection {
    fn from(s: tracematch::FrequentSection) -> Self {
        Self::from(&s)
    }
}

/// A named corridor: a durable user name keyed to ground, with its current
/// resolution onto the visible catalogue. `section_id` is None while the
/// name is dormant (no visible section covers its ground).
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiNamedCorridor {
    pub intent_id: String,
    pub name: String,
    pub encoded_footprint: Vec<u8>,
    pub sport_type: Option<String>,
    pub created_at: String,
    pub section_id: Option<String>,
    pub coverage: f64,
    pub primary: bool,
}

impl From<crate::persistence::sections::NamedCorridor> for FfiNamedCorridor {
    fn from(c: crate::persistence::sections::NamedCorridor) -> Self {
        Self {
            intent_id: c.intent_id,
            name: c.name,
            encoded_footprint: crate::coords::encode(&c.footprint),
            sport_type: c.sport_type,
            created_at: c.created_at,
            section_id: c.section_id,
            coverage: c.coverage,
            primary: c.primary,
        }
    }
}

// Borrow-based conversion so get-all / get-filtered paths don't deep-copy the
// large `activity_traces` HashMap that the FFI struct never carries.
impl From<&tracematch::FrequentSection> for FfiFrequentSection {
    fn from(s: &tracematch::FrequentSection) -> Self {
        Self {
            id: s.id.clone(),
            name: s.name.clone(),
            sport_type: s.sport_type.clone(),
            encoded_polyline: crate::coords::encode(&s.polyline),
            representative_activity_id: s.representative_activity_id.clone(),
            activity_ids: s.activity_ids.clone(),
            activity_portions: s
                .activity_portions
                .iter()
                .cloned()
                .map(FfiSectionPortion::from)
                .collect(),
            route_ids: s.route_ids.clone(),
            visit_count: s.visit_count,
            distance_meters: s.distance_meters,
            confidence: s.confidence,
            observation_count: s.observation_count,
            average_spread: s.average_spread,
            point_density: s.point_density.clone(),
            scale: s.scale.map(|s| s.to_string()),
            is_user_defined: s.is_user_defined,
            stability: s.stability,
            version: s.version,
            updated_at: s.updated_at.clone(),
            created_at: s.created_at.clone(),
            elevation_gain_m: s.elevation_gain_m,
            avg_grade_percent: s.avg_grade_percent,
            elevation_loss_m: s.enrichment.elevation_loss_m,
            max_grade_percent: s.enrichment.max_grade_percent,
            straightness: s.enrichment.straightness,
            klass: s.enrichment.klass.map(|k| k.as_str().to_string()),
            is_lift: s.enrichment.is_lift,
            rank_score: s.rank.as_ref().map(|r| r.score),
            sport_rank_score: s.rank.as_ref().map(|r| r.sport_score),
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
    pub encoded_polyline: Vec<u8>,
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
    pub is_user_defined: bool,
    pub stability: Option<f64>,
    pub elevation_gain_m: Option<f64>,
    pub avg_grade_percent: Option<f64>,
    pub version: Option<u32>,
    pub updated_at: Option<String>,
    pub created_at: String,
    // Route associations
    pub route_ids: Option<Vec<String>>,
    // Custom-specific fields (None for auto sections)
    pub source_activity_id: Option<String>,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,
    // Visibility state
    pub disabled: bool,
    pub superseded_by: Option<String>,
    pub elevation_loss_m: Option<f64>,
    pub max_grade_percent: Option<f64>,
    pub straightness: Option<f64>,
    pub klass: Option<String>,
    pub is_lift: bool,
    pub rank_score: Option<f64>,
    pub sport_rank_score: Option<f64>,
}

impl From<crate::sections::Section> for FfiSection {
    fn from(s: crate::sections::Section) -> Self {
        Self {
            id: s.id,
            section_type: s.section_type.as_str().to_string(),
            name: s.name,
            sport_type: s.sport_type,
            encoded_polyline: crate::coords::encode(&s.polyline),
            distance_meters: s.distance_meters,
            representative_activity_id: s.representative_activity_id,
            activity_ids: s.activity_ids,
            visit_count: s.visit_count,
            confidence: s.confidence,
            observation_count: s.observation_count,
            average_spread: s.average_spread,
            point_density: s.point_density,
            scale: s.scale,
            is_user_defined: s.is_user_defined,
            stability: s.stability,
            elevation_gain_m: s.elevation_gain_m,
            avg_grade_percent: s.avg_grade_percent,
            elevation_loss_m: s.elevation_loss_m,
            max_grade_percent: s.max_grade_percent,
            straightness: s.straightness,
            klass: s.klass,
            is_lift: s.is_lift,
            rank_score: s.rank_score,
            sport_rank_score: s.sport_rank_score,
            version: s.version,
            updated_at: s.updated_at,
            created_at: s.created_at,
            route_ids: s.route_ids,
            source_activity_id: s.source_activity_id,
            start_index: s.start_index,
            end_index: s.end_index,
            disabled: s.disabled,
            superseded_by: s.superseded_by,
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
    /// Mean heart rate over the lap, when the activity carried a stream.
    pub avg_hr: Option<f64>,
}

/// One ledger row of a section.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionHistoryEvent {
    pub id: i64,
    pub at: String,
    /// formed, restored, split, recut, dissolved, merged, superseded,
    /// reverted, pr_rebased, baseline or algorithm_changed.
    pub kind: String,
    /// JSON: the era snapshot, lineage links and what was around the change.
    pub details: Option<String>,
    pub geometry_version: Option<i64>,
}

/// One stored geometry version of a section.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionGeometryVersion {
    pub version: i64,
    pub created_at: String,
    pub milestone: bool,
    pub pinned: bool,
}

/// A section the ledger remembers and the catalogue no longer holds.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRetiredSection {
    pub section_id: String,
    pub kind: String,
    pub at: String,
    pub into: Option<String>,
    pub versions: Vec<i64>,
}

/// The claims the change card may make on this build.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiChangeCardSupport {
    pub deterministic: bool,
    pub same_result_drip_or_batch: bool,
    pub ledger: bool,
    pub revert: bool,
    pub retired: bool,
    pub pinned_survive: bool,
    pub same_on_every_device: bool,
}

/// A recent change on a live section, for the insights feed.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionChange {
    pub section_id: String,
    pub kind: String,
    pub at: String,
}

/// A split sibling's parent and discriminator, for the read side to name it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionLineage {
    pub section_id: String,
    pub parent_id: String,
    /// A cardinal ("north", "east", "south", "west") or an ordinal ("2").
    pub discriminator: String,
}

/// One excluded traversal, addressed the way the junction stores it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiExcludedLap {
    pub activity_id: String,
    /// Start index in the activity's GPS track
    pub start_index: u32,
}

impl From<crate::SectionLap> for FfiSectionLap {
    fn from(l: crate::SectionLap) -> Self {
        Self {
            id: l.id,
            activity_id: l.activity_id,
            time: l.time,
            pace: l.pace,
            distance: l.distance,
            direction: l.direction,
            start_index: l.start_index,
            end_index: l.end_index,
            avg_hr: l.avg_hr,
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

impl From<crate::SectionPerformanceRecord> for FfiSectionPerformanceRecord {
    fn from(r: crate::SectionPerformanceRecord) -> Self {
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
    /// Average speed across all traversals in this direction (m/s).
    /// Populated for route detail stats so the TS hook no longer has to
    /// re-aggregate. Section performance queries currently leave it as None.
    pub avg_speed: Option<f64>,
}

impl From<crate::DirectionStats> for FfiDirectionStats {
    fn from(s: crate::DirectionStats) -> Self {
        Self {
            avg_time: s.avg_time,
            last_activity: s.last_activity,
            count: s.count,
            avg_speed: s.avg_speed,
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

impl From<crate::SectionPerformanceResult> for FfiSectionPerformanceResult {
    fn from(r: crate::SectionPerformanceResult) -> Self {
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

/// Tier 3.2: one entry of a batched section-performance fetch. Returned
/// in the same order as the requested section_ids so the TS caller can
/// map directly without rebuilding lookups.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionPerformanceBatchEntry {
    pub section_id: String,
    pub result: FfiSectionPerformanceResult,
}

/// Tier 5.5: result of a user-initiated section polyline recalc.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiSectionRecalcResult {
    pub section_id: String,
    pub polyline_point_count: u32,
    pub distance_meters: f64,
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

impl From<crate::RoutePerformance> for FfiRoutePerformance {
    fn from(p: crate::RoutePerformance) -> Self {
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
    /// Activity metrics for all activities in the route (inlined to avoid duplicate FFI call)
    pub activity_metrics: Vec<FfiActivityMetrics>,
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

impl From<crate::RoutePerformanceResult> for FfiRoutePerformanceResult {
    fn from(r: crate::RoutePerformanceResult) -> Self {
        Self {
            performances: r
                .performances
                .into_iter()
                .map(FfiRoutePerformance::from)
                .collect(),
            activity_metrics: r
                .activity_metrics
                .into_iter()
                .map(FfiActivityMetrics::from)
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
// Heatmap Types
// ============================================================================

/// Pre-computed daily activity intensity for the activity heatmap.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiHeatmapDay {
    /// Date string in YYYY-MM-DD format
    pub date: String,
    /// Intensity bracket: 0 (none), 1 (light), 2 (medium-light), 3 (medium), 4 (high)
    pub intensity: u8,
    /// Longest activity duration in seconds for this day
    pub max_duration: i64,
    /// Number of activities on this day
    pub activity_count: u32,
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
    /// Delta+varint encoded coordinates
    pub encoded_polyline: Vec<u8>,
    /// All sport types present in this group's activities
    pub sport_types: Vec<String>,
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
    /// Delta+varint encoded coordinates
    pub encoded_polyline: Vec<u8>,
    /// All sport types present in this section's activities
    pub sport_types: Vec<String>,
    pub is_user_defined: bool,
    pub disabled: bool,
    pub superseded_by: Option<String>,
    pub elevation_gain_m: Option<f64>,
    pub elevation_loss_m: Option<f64>,
    pub avg_grade_percent: Option<f64>,
    pub max_grade_percent: Option<f64>,
    pub klass: Option<String>,
    pub is_lift: bool,
    pub rank_score: Option<f64>,
    pub sport_rank_score: Option<f64>,
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
    /// Whether route groups need recomputation (stale after activity removal)
    pub groups_dirty: bool,
}

// ============================================================================
// Ranked Section Types (ML-driven relevance scoring)
// ============================================================================

/// A section ranked by composite relevance score combining recency, improvement,
/// anomaly detection, and engagement signals.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRankedSection {
    pub section_id: String,
    pub section_name: String,
    pub relevance_score: f64,
    pub recency_score: f64,
    pub improvement_score: f64,
    pub anomaly_score: f64,
    pub engagement_score: f64,
    pub traversal_count: u32,
    pub best_time_secs: f64,
    pub median_recent_secs: f64,
    pub days_since_last: u32,
    /// -1 = declining, 0 = stable, 1 = improving
    pub trend: i32,
    /// Whether the most recent effort is the all-time best time
    pub latest_is_pr: bool,
}

/// Per-exercise contribution to a muscle group, aggregated across all active
/// sets of one activity. Role reflects whether the muscle is primary or
/// secondary for the exercise.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseContribution {
    pub name: String,
    /// "primary" | "secondary"
    pub role: String,
    pub sets: u32,
    pub reps: u32,
    pub volume_kg: f64,
}

/// Full muscle-group breakdown for one activity, one muscle slug. Rust groups
/// exercise sets by display name, classifies primary/secondary, and returns
/// totals - replacing the useMemo grouping/reducing in `useMuscleDetail`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMuscleGroupDetail {
    pub slug: String,
    pub exercises: Vec<FfiExerciseContribution>,
    pub total_sets: u32,
    pub total_reps: u32,
    pub total_volume_kg: f64,
    pub primary_exercises: u32,
    pub secondary_exercises: u32,
}

/// One renderable chart point on the section-detail chart. One entry per
/// lap traversal (activities with multiple laps expand into multiple points).
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionChartPoint {
    pub lap_id: String,
    pub activity_id: String,
    pub activity_name: String,
    /// Unix seconds
    pub activity_date: i64,
    /// m/s
    pub speed: f64,
    /// Section time for this lap (seconds)
    pub section_time: u32,
    pub section_distance: f64,
    /// "same" | "reverse"
    pub direction: String,
    /// Rank by speed across all points (1 = fastest). Duplicate activity rows
    /// keep the best (lowest) rank.
    pub rank: u32,
}

/// Bundled chart payload for the section-detail screen. Rust composes
/// per-lap points, ranks, and summary stats from the performance records
/// it already owns so the TS hook stops iterating + sorting multiple times.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionChartData {
    pub points: Vec<FfiSectionChartPoint>,
    pub min_speed: f64,
    pub max_speed: f64,
    /// Index into `points` for the fastest lap (0 when empty).
    pub best_index: u32,
    pub has_reverse_runs: bool,
    pub best_activity_id: Option<String>,
    pub best_time_secs: Option<f64>,
    pub best_pace: Option<f64>,
    pub average_time_secs: Option<f64>,
    pub last_activity_date: Option<i64>,
    pub total_activities: u32,
}

/// Enriched workout section for the home-screen "Sections for you" list.
/// Composes ranking + performance lookups server-side so the TS hook is a
/// thin pass-through instead of a per-section FFI loop.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWorkoutSection {
    pub id: String,
    pub name: String,
    pub pr_time_secs: Option<f64>,
    /// Second-best time (prior PR before current best)
    pub previous_best_time_secs: Option<f64>,
    pub last_time_secs: Option<f64>,
    pub days_since_last: Option<i32>,
    pub pr_days_ago: Option<i32>,
    /// "improving" | "stable" | "declining" - empty string when insufficient data
    pub trend: String,
}

// ============================================================================
// Calendar Summary Types
// ============================================================================

/// Best performance in one direction for a calendar period.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCalendarDirectionBest {
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
    /// Unix timestamp of best activity
    pub best_activity_date: i64,
    /// True if time was estimated
    pub is_estimated: bool,
}

impl From<crate::CalendarDirectionBest> for FfiCalendarDirectionBest {
    fn from(d: crate::CalendarDirectionBest) -> Self {
        Self {
            count: d.count,
            best_time: d.best_time,
            best_pace: d.best_pace,
            best_activity_id: d.best_activity_id,
            best_activity_name: d.best_activity_name,
            best_activity_date: d.best_activity_date,
            is_estimated: d.is_estimated,
        }
    }
}

/// Best performance in a calendar month for FFI.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCalendarMonthSummary {
    /// Month number (1-12)
    pub month: u32,
    /// Total traversals (both directions)
    pub traversal_count: u32,
    /// Best forward/same direction performance
    pub forward: Option<FfiCalendarDirectionBest>,
    /// Best reverse direction performance
    pub reverse: Option<FfiCalendarDirectionBest>,
}

impl From<crate::CalendarMonthSummary> for FfiCalendarMonthSummary {
    fn from(m: crate::CalendarMonthSummary) -> Self {
        Self {
            month: m.month,
            traversal_count: m.traversal_count,
            forward: m.forward.map(FfiCalendarDirectionBest::from),
            reverse: m.reverse.map(FfiCalendarDirectionBest::from),
        }
    }
}

/// Best performance in a calendar year for FFI.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCalendarYearSummary {
    /// Calendar year
    pub year: i32,
    /// Total traversals in this year
    pub traversal_count: u32,
    /// Best forward/same direction performance this year
    pub forward: Option<FfiCalendarDirectionBest>,
    /// Best reverse direction performance this year
    pub reverse: Option<FfiCalendarDirectionBest>,
    /// Monthly breakdowns (only months with traversals)
    pub months: Vec<FfiCalendarMonthSummary>,
}

impl From<crate::CalendarYearSummary> for FfiCalendarYearSummary {
    fn from(y: crate::CalendarYearSummary) -> Self {
        Self {
            year: y.year,
            traversal_count: y.traversal_count,
            forward: y.forward.map(FfiCalendarDirectionBest::from),
            reverse: y.reverse.map(FfiCalendarDirectionBest::from),
            months: y
                .months
                .into_iter()
                .map(FfiCalendarMonthSummary::from)
                .collect(),
        }
    }
}

/// Calendar-aligned performance summary for FFI.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiCalendarSummary {
    /// Year summaries (newest first)
    pub years: Vec<FfiCalendarYearSummary>,
    /// Overall forward/same PR
    pub forward_pr: Option<FfiCalendarDirectionBest>,
    /// Overall reverse PR
    pub reverse_pr: Option<FfiCalendarDirectionBest>,
    /// Section distance in meters
    pub section_distance: f64,
}

impl From<crate::CalendarSummary> for FfiCalendarSummary {
    fn from(s: crate::CalendarSummary) -> Self {
        Self {
            years: s
                .years
                .into_iter()
                .map(FfiCalendarYearSummary::from)
                .collect(),
            forward_pr: s.forward_pr.map(FfiCalendarDirectionBest::from),
            reverse_pr: s.reverse_pr.map(FfiCalendarDirectionBest::from),
            section_distance: s.section_distance,
        }
    }
}

// ============================================================================
// Activity Pattern Types
// ============================================================================

/// One Monday-anchored week of training totals, derived from
/// `activity_metrics`. Replaces the intervals.icu athlete-summary endpoint:
/// the screens read only these four numbers.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWeeklySummary {
    /// Monday of the week, epoch seconds at local midnight.
    pub week_start: i64,
    pub count: u32,
    /// Moving time in seconds.
    pub moving_time: i64,
    /// Distance in metres.
    pub distance: f64,
    /// Training load (TSS).
    pub training_load: f64,
}

/// One untyped calendar event payload, keyed by id and day.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiCalendarEventBody {
    pub event_id: String,
    /// Event day as epoch seconds.
    pub date: i64,
    pub raw: String,
}

/// One untyped activity payload, keyed by id and start time. Demo seeding
/// writes these; a live sync writes them from the same shape.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityBody {
    pub activity_id: String,
    /// Start time as epoch seconds.
    pub date: i64,
    /// The untyped intervals.icu activity payload.
    pub raw: String,
}

/// One wellness row passed in from TS (intervals.icu sync). Fields outside
/// this subset (sleepQuality, spO2, etc.) aren't persisted yet - the TS
/// sync helper only forwards the fields the Rust atomics consume.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWellnessRow {
    /// ISO-8601 YYYY-MM-DD
    pub date: String,
    pub ctl: Option<f64>,
    pub atl: Option<f64>,
    pub ramp_rate: Option<f64>,
    pub hrv: Option<f64>,
    pub resting_hr: Option<f64>,
    pub weight: Option<f64>,
    pub sleep_secs: Option<i64>,
    pub sleep_score: Option<f64>,
    pub soreness: Option<i32>,
    pub fatigue: Option<i32>,
    pub stress: Option<i32>,
    pub mood: Option<i32>,
    pub motivation: Option<i32>,
    /// The untyped intervals.icu body for this day, when the caller has it.
    /// Omitting it leaves any previously stored body intact.
    pub raw: Option<String>,
}

/// Sparkline payload for the SummaryCard: rounded integer arrays, oldest
/// first, forward-filled where needed so renderers produce continuous lines.
/// Empty arrays mean "not enough data" (TS renders `undefined` / skips).
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWellnessSparklines {
    pub fitness: Vec<i32>,
    pub fatigue: Vec<i32>,
    pub form: Vec<i32>,
    pub hrv: Vec<i32>,
    pub rhr: Vec<i32>,
}

/// HRV trend summary over a trailing window. `label` is the i18n key suffix
/// ("trendingUp" | "stable" | "trendingDown") - TS resolves translations.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiHrvTrend {
    pub label: String,
    pub avg: f64,
    pub latest: f64,
    pub data_points: u32,
    pub sparkline: Vec<f64>,
}

/// Ranked sections for one sport, paired with the sport label. One element
/// per input sport in `get_ranked_sections_batch`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRankedSectionsBySport {
    pub sport_type: String,
    pub sections: Vec<FfiRankedSection>,
}

/// Bundled patterns payload for the home screen: today's pattern alongside
/// the full detected set, delivered in a single FFI call.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityPatternsBundle {
    pub today: Option<FfiActivityPattern>,
    pub all: Vec<FfiActivityPattern>,
}

/// A detected recurring training pattern from k-means clustering.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityPattern {
    /// Sport type (e.g., "Ride", "Run")
    pub sport_type: String,
    /// Cluster identifier within the sport group
    pub cluster_id: u8,
    /// Most common day of week (0=Mon..6=Sun)
    pub primary_day: u8,
    /// Dominant season label ("winter", "spring", "summer", "autumn", "all")
    pub season_label: String,
    /// Number of activities in this pattern
    pub activity_count: u32,
    /// Average moving time in seconds
    pub avg_duration_secs: u32,
    /// Average training load (TSS)
    pub avg_tss: f32,
    /// Average distance in meters
    pub avg_distance_meters: f32,
    /// How often this pattern occurs per month
    pub frequency_per_month: f32,
    /// Weighted confidence score (0.0-1.0)
    pub confidence: f32,
    /// Silhouette score for cluster quality (0.0-1.0)
    pub silhouette_score: f32,
    /// Days since the most recent activity in this cluster
    pub days_since_last: u32,
    /// Sections commonly traversed by activities in this pattern
    pub common_sections: Vec<FfiPatternSection>,
}

/// A section commonly associated with a training pattern.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPatternSection {
    /// Section identifier
    pub section_id: String,
    /// Section display name
    pub section_name: String,
    /// Fraction of cluster activities that traverse this section (0.0-1.0)
    pub appearance_rate: f32,
    /// Best (fastest) traversal time in seconds
    pub best_time_secs: f32,
    /// Median of the 5 most recent traversal times in seconds
    pub median_recent_secs: f32,
    /// Performance trend: None=insufficient data, -1=declining, 0=stable, 1=improving
    pub trend: Option<i8>,
    /// Total number of traversals across cluster activities
    pub traversal_count: u32,
}

// ============================================================================
// Insights Batch Types
// ============================================================================

/// A recent section PR detected in the last 7 days.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRecentPR {
    pub section_id: String,
    pub section_name: String,
    pub best_time: f64,
    pub days_ago: u32,
}

/// Batch insights data: combines period stats, trends, patterns, and recent PRs.
/// Reduces Insights hook FFI calls from 13-16 to 1.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiInsightsData {
    /// Current week stats
    pub current_week: FfiPeriodStats,
    /// Previous week stats
    pub previous_week: FfiPeriodStats,
    /// 4-week chronic period stats (raw total, not averaged)
    pub chronic_period: FfiPeriodStats,
    /// Today's stats (for rest day detection)
    pub today_period: FfiPeriodStats,
    /// FTP trend
    pub ftp_trend: FfiFtpTrend,
    /// Running pace trend
    pub run_pace_trend: FfiPaceTrend,
    /// All activity patterns from k-means clustering
    pub all_patterns: Vec<FfiActivityPattern>,
    /// Today's matching pattern (if any, confidence >= 0.6)
    pub today_pattern: Option<FfiActivityPattern>,
    /// Up to 3 recent section PRs (best times set in last 7 days)
    pub recent_prs: Vec<FfiRecentPR>,
    /// Sections held by the engine, for the section-readiness check
    pub section_count: u32,
    /// Sport types the ranked-section lists were built for
    pub sport_types: Vec<String>,
    /// ML-ranked sections per sport, empty when sections were not requested
    pub ranked_sections: Vec<FfiRankedSectionsBySport>,
    /// Aerobic efficiency trends worth surfacing, already filtered and capped
    pub efficiency_trends: Vec<FfiEfficiencyTrend>,
    /// Whether any strength activity exists
    pub has_strength_data: bool,
    /// Strength volume over the requested month and weeks, when data exists
    pub strength_series: Option<FfiStrengthInsightSeries>,
}

/// Scalar inputs for the insights bundle.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiInsightsParams {
    /// Start of the current week
    pub current_start: i64,
    /// Now
    pub current_end: i64,
    /// Start of the previous week
    pub prev_start: i64,
    /// End of the previous week
    pub prev_end: i64,
    /// Start of the four-week chronic window
    pub chronic_start: i64,
    /// Start of today
    pub today_start: i64,
    /// Whether section-derived insights are wanted at all
    pub include_sections: bool,
    /// Ranked sections requested per sport
    pub ranked_limit: u32,
    /// Sections last visited beyond this many days get no efficiency trend
    pub active_window_days: u32,
    /// Efficiency candidates taken from each sport's ranked list
    pub efficiency_per_sport: u32,
    /// Efficiency trends to return at most
    pub efficiency_limit: u32,
    /// Minimum matched efforts before an efficiency trend counts
    pub efficiency_min_efforts: u32,
    /// Trailing month the strength summary covers
    pub strength_month: FfiTimestampRange,
    /// Trailing weeks the strength summary covers
    pub strength_weeks: Vec<FfiTimestampRange>,
}

// ============================================================================
// Startup Batch Types
// ============================================================================

/// GPS track for a single activity (for feed map previews).
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPreviewTrack {
    pub activity_id: String,
    /// Delta+varint encoded coordinates
    pub encoded_coords: Vec<u8>,
}

/// All data needed for the feed screen on startup in one call.
/// Reduces 20+ FFI calls to 1.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStartupData {
    /// Insights data (replaces getInsightsData)
    pub insights: FfiInsightsData,
    /// Summary card data (replaces getSummaryCardData)
    pub summary_card: FfiSummaryCardData,
    /// GPS tracks for initial visible activities (replaces N × getGpsTrack)
    pub preview_tracks: Vec<FfiPreviewTrack>,
    /// Activity IDs with cached metrics (for sync skip check)
    pub cached_metric_ids: Vec<String>,
}

// ============================================================================
// Activity Detail Batch Types
// ============================================================================

/// One activity's portion of a single section, delta+varint encoded.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionTrace {
    /// Section the trace belongs to
    pub section_id: String,
    /// Delta+varint encoded coordinates of the activity's portion
    pub encoded_coords: Vec<u8>,
}

/// All data needed to paint the activity detail screen in one call.
/// Replaces a fan-out that grew one trace extraction per matched section.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityDetailData {
    /// Total activities held by the engine
    pub activity_count: u32,
    /// Total sections held by the engine
    pub section_count: u32,
    /// Route groups meeting the caller's minimum, most attempts first
    pub route_groups: Vec<FfiRouteGroup>,
    /// Route group total before the minimum-activity filter
    pub total_route_group_count: u32,
    /// Visible sections this activity traverses, most-visited first
    pub matched_sections: Vec<FfiSection>,
    /// Every visible custom section, matched or not
    pub custom_sections: Vec<FfiSection>,
    /// One entry per (section, direction) this activity encountered
    pub encounters: Vec<FfiSectionEncounter>,
    /// Section indicators and route highlights for this activity
    pub highlights: FfiActivityHighlightsBundle,
    /// This activity's portion of every section it matches
    pub section_traces: Vec<FfiSectionTrace>,
    /// Sections where this activity currently holds the best record
    pub pr_section_ids: Vec<String>,
}

// ============================================================================
// Section Detail Batch Types
// ============================================================================

/// The section detail reads that do not depend on time streams.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionDetailData {
    /// Total activities held by the engine
    pub activity_count: u32,
    /// The section itself, or `None` when the ID is unknown
    pub section: Option<FfiFrequentSection>,
    /// Sections within the requested radius, for the map overlay
    pub nearby: Vec<FfiNearbySectionSummary>,
    /// Sections this one could merge with
    pub merge_candidates: Vec<FfiMergeCandidate>,
    /// Activities the user excluded from this section
    pub excluded_activity_ids: Vec<String>,
    /// Whether the original bounds can still be restored
    pub has_original_bounds: bool,
    /// Metrics for every activity on the section
    pub activity_metrics: Vec<FfiActivityMetrics>,
    /// Simplified GPS signatures for scrub-time trace display
    pub map_signatures: Vec<FfiMapSignature>,
    /// Activities whose time streams still have to be fetched
    pub missing_time_stream_ids: Vec<String>,
}

/// The section detail reads that need lap times.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionPerformanceData {
    /// Year and month performance history, or `None` with no records
    pub calendar_summary: Option<FfiCalendarSummary>,
    /// Per-activity performance records for the requested sport
    pub performances: FfiSectionPerformanceResult,
    /// Pre-computed chart payload for the requested range and sport
    pub chart_data: FfiSectionChartData,
}

// ============================================================================
// Route Detail Batch Types
// ============================================================================

/// Everything the route detail screen paints with in one call.
///
/// The performances are unfiltered: the screen derives its sport pills from
/// them and only asks for a filtered read once the user picks a sport.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteDetailData {
    /// Total activities held by the engine
    pub activity_count: u32,
    /// The route itself, or `None` when the ID is unknown
    pub group: Option<FfiRouteGroup>,
    /// Route groups above the caller's minimum, most attempts first
    pub groups: Vec<FfiRouteGroup>,
    /// Every attempt on the route, across sports
    pub performances: FfiRoutePerformanceResult,
    /// Consensus polyline, delta+varint encoded
    pub encoded_consensus: Vec<u8>,
    /// User-set route names by route ID
    pub route_names: std::collections::HashMap<String, String>,
    /// Activities the user excluded from this route
    pub excluded_activity_ids: Vec<String>,
    /// Simplified GPS signatures for the route's activities
    pub map_signatures: Vec<FfiMapSignature>,
}

// ============================================================================
// Widget Snapshot Batch Types
// ============================================================================

/// Everything the home-screen widget snapshot is composed from.
///
/// Widgets run in a separate process and cannot reach the engine, so the app
/// bakes their content. This is the single read that feeds it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiWidgetSnapshotData {
    /// Trailing wellness sparklines, `None` until wellness has synced
    pub sparklines: Option<FfiWellnessSparklines>,
    /// This week and last week, with the trends the widget shows
    pub summary: FfiSummaryCardData,
    /// The most recent activity, or `None` when there are none
    pub latest: Option<FfiActivityMetrics>,
    /// Whether the latest activity carries a route or section record
    pub latest_is_pr: bool,
    /// The latest activity's GPS track, empty for indoor activities
    pub latest_gps: Vec<FfiGpsPoint>,
}

// ============================================================================
// Map Screen Batch Types
// ============================================================================

/// Everything the map tab paints with in one call.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMapScreenData {
    /// Total activities held by the engine, before the date and sport filters
    pub activity_count: u32,
    /// Sport types with at least one activity
    pub available_sport_types: Vec<String>,
    /// Activities inside the requested window and sport filter
    pub activities: Vec<crate::persistence::MapActivityComplete>,
}

// ============================================================================
// Helper functions
// ============================================================================

// ============================================================================
// Aerobic Efficiency Types
// ============================================================================

/// A single data point for aerobic efficiency tracking.
/// Represents one section traversal with pace and heart rate data.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiEfficiencyPoint {
    /// Unix timestamp of the activity
    pub date: i64,
    /// Pace in seconds per km
    pub pace_secs_per_km: f64,
    /// Average heart rate during this traversal
    pub avg_hr: f64,
    /// HR/pace ratio: avg_hr / pace_secs_per_km - lower = more efficient
    pub hr_pace_ratio: f64,
}

/// Aerobic efficiency trend for a section.
/// Tracks how HR/pace ratio changes over time across matched section efforts.
/// A declining ratio indicates improving aerobic efficiency
/// (Coyle et al., J Appl Physiol, 1991; Jones & Carter, Sports Med, 2000).
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiEfficiencyTrend {
    /// Section ID
    pub section_id: String,
    /// Section name
    pub section_name: String,
    /// Individual data points sorted by date (oldest first)
    pub points: Vec<FfiEfficiencyPoint>,
    /// Linear regression slope of hr_pace_ratio over time (negative = improving)
    pub trend_slope: f64,
    /// True if slope is significantly negative (improving aerobic efficiency)
    pub is_improving: bool,
    /// Estimated HR change in bpm at the same pace over the observed time range
    pub hr_change_bpm: f64,
    /// Number of efforts with both pace and HR data
    pub effort_count: u32,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    //! The fixtures here are exhaustive struct literals on purpose: a new
    //! field on a source type breaks this build, while the `From` impl would
    //! keep compiling and quietly stop carrying it. Every value is distinct so
    //! a transposed pair of same-typed fields fails rather than passing.
    use super::*;

    fn direction_stats() -> crate::DirectionStats {
        crate::DirectionStats {
            avg_time: Some(300.0),
            last_activity: Some(1700000000),
            count: 5,
            avg_speed: Some(4.5),
        }
    }

    fn section_lap() -> crate::SectionLap {
        crate::SectionLap {
            id: "lap_1".to_string(),
            activity_id: "act_123".to_string(),
            time: 120.5,
            pace: 8.3,
            distance: 1000.0,
            direction: "forward".to_string(),
            start_index: 17,
            end_index: 104,
            avg_hr: Some(142.0),
        }
    }

    fn section_record(direction: &str, best_time: f64) -> crate::SectionPerformanceRecord {
        crate::SectionPerformanceRecord {
            activity_id: format!("act_{direction}"),
            activity_name: format!("{direction} effort"),
            activity_date: 1700000000,
            laps: vec![section_lap()],
            lap_count: 1,
            best_time,
            best_pace: 8.3,
            avg_time: best_time + 4.0,
            avg_pace: 7.9,
            direction: direction.to_string(),
            section_distance: 1000.0,
        }
    }

    fn route_performance(activity_id: &str, speed: f64) -> crate::RoutePerformance {
        crate::RoutePerformance {
            activity_id: activity_id.to_string(),
            name: "Morning Ride".to_string(),
            date: 1700000000,
            speed,
            duration: 3600,
            moving_time: 3500,
            distance: 30000.0,
            elevation_gain: 500.0,
            avg_hr: Some(145),
            avg_power: Some(200),
            is_current: false,
            direction: "same".to_string(),
            match_percentage: Some(95.5),
        }
    }

    fn activity_metrics() -> crate::ActivityMetrics {
        crate::ActivityMetrics {
            activity_id: "act_123".to_string(),
            name: "Morning Ride".to_string(),
            date: 1700000000,
            distance: 30000.0,
            moving_time: 3500,
            elapsed_time: 3600,
            elevation_gain: 500.0,
            avg_hr: Some(145),
            avg_power: Some(200),
            sport_type: "Ride".to_string(),
        }
    }

    #[test]
    fn direction_stats_carries_every_field() {
        let ffi = FfiDirectionStats::from(direction_stats());
        assert_eq!(ffi.avg_time, Some(300.0));
        assert_eq!(ffi.last_activity, Some(1700000000));
        assert_eq!(ffi.count, 5);
        // avg_speed and avg_time are both Option<f64>: a transposition here
        // would show route stats as a speed in a seconds field.
        assert_eq!(ffi.avg_speed, Some(4.5));
    }

    #[test]
    fn direction_stats_keeps_an_absent_speed_absent() {
        let mut stats = direction_stats();
        stats.avg_speed = None;
        let ffi = FfiDirectionStats::from(stats);
        assert_eq!(ffi.avg_time, Some(300.0));
        assert!(ffi.avg_speed.is_none());
    }

    #[test]
    fn section_lap_carries_every_field() {
        let ffi = FfiSectionLap::from(section_lap());
        assert_eq!(ffi.id, "lap_1");
        assert_eq!(ffi.activity_id, "act_123");
        assert_eq!(ffi.time, 120.5);
        assert_eq!(ffi.pace, 8.3);
        assert_eq!(ffi.distance, 1000.0);
        assert_eq!(ffi.direction, "forward");
        // Swapped track indices would draw the lap backwards on the map.
        assert_eq!(ffi.start_index, 17);
        assert_eq!(ffi.end_index, 104);
    }

    #[test]
    fn section_performance_record_carries_every_field() {
        let ffi = FfiSectionPerformanceRecord::from(section_record("forward", 120.5));
        assert_eq!(ffi.activity_id, "act_forward");
        assert_eq!(ffi.activity_name, "forward effort");
        assert_eq!(ffi.activity_date, 1700000000);
        assert_eq!(ffi.lap_count, 1);
        // best_* against avg_*: a transposition would report the average as
        // the PR on the section detail.
        assert_eq!(ffi.best_time, 120.5);
        assert_eq!(ffi.avg_time, 124.5);
        assert_eq!(ffi.best_pace, 8.3);
        assert_eq!(ffi.avg_pace, 7.9);
        assert_eq!(ffi.direction, "forward");
        assert_eq!(ffi.section_distance, 1000.0);

        assert_eq!(ffi.laps.len(), 1);
        assert_eq!(ffi.laps[0].id, "lap_1");
        assert_eq!(ffi.laps[0].start_index, 17);
    }

    #[test]
    fn route_performance_keeps_duration_and_moving_time_apart() {
        // The route PR delta chip is moving-time based, so a swap of these two
        // u32 fields would silently compare the wrong clock.
        let ffi = FfiRoutePerformance::from(route_performance("act_123", 8.5));
        assert_eq!(ffi.duration, 3600, "duration is elapsed time");
        assert_eq!(ffi.moving_time, 3500, "moving_time is moving time");
    }

    #[test]
    fn route_performance_carries_every_field() {
        let ffi = FfiRoutePerformance::from(route_performance("act_123", 8.5));
        assert_eq!(ffi.activity_id, "act_123");
        assert_eq!(ffi.name, "Morning Ride");
        assert_eq!(ffi.date, 1700000000);
        assert_eq!(ffi.speed, 8.5);
        assert_eq!(ffi.distance, 30000.0);
        assert_eq!(ffi.elevation_gain, 500.0);
        assert_eq!(ffi.avg_hr, Some(145));
        assert_eq!(ffi.avg_power, Some(200));
        assert!(!ffi.is_current);
        assert_eq!(ffi.direction, "same");
        assert_eq!(ffi.match_percentage, Some(95.5));
    }

    #[test]
    fn activity_metrics_keeps_moving_and_elapsed_time_apart() {
        let ffi = FfiActivityMetrics::from(activity_metrics());
        assert_eq!(ffi.moving_time, 3500);
        assert_eq!(ffi.elapsed_time, 3600);
        assert_eq!(ffi.activity_id, "act_123");
        assert_eq!(ffi.name, "Morning Ride");
        assert_eq!(ffi.date, 1700000000);
        assert_eq!(ffi.distance, 30000.0);
        assert_eq!(ffi.elevation_gain, 500.0);
        assert_eq!(ffi.avg_hr, Some(145));
        assert_eq!(ffi.avg_power, Some(200));
        assert_eq!(ffi.sport_type, "Ride");
        // These four have no source field and must not invent a value.
        assert!(ffi.training_load.is_none());
        assert!(ffi.ftp.is_none());
        assert!(ffi.power_zone_times.is_none());
        assert!(ffi.hr_zone_times.is_none());
    }

    #[test]
    fn activity_metrics_round_trips_back_without_drift() {
        let original = activity_metrics();
        let back = crate::ActivityMetrics::from(FfiActivityMetrics::from(original.clone()));
        assert_eq!(back.activity_id, original.activity_id);
        assert_eq!(back.name, original.name);
        assert_eq!(back.date, original.date);
        assert_eq!(back.distance, original.distance);
        assert_eq!(back.moving_time, original.moving_time);
        assert_eq!(back.elapsed_time, original.elapsed_time);
        assert_eq!(back.elevation_gain, original.elevation_gain);
        assert_eq!(back.avg_hr, original.avg_hr);
        assert_eq!(back.avg_power, original.avg_power);
        assert_eq!(back.sport_type, original.sport_type);
    }

    #[test]
    fn section_performance_result_keeps_its_option_slots_distinct() {
        let result = crate::SectionPerformanceResult {
            records: vec![
                section_record("forward", 120.5),
                section_record("reverse", 131.0),
            ],
            best_record: Some(section_record("overall", 118.0)),
            best_forward_record: Some(section_record("forward", 120.5)),
            best_reverse_record: Some(section_record("reverse", 131.0)),
            forward_stats: Some(crate::DirectionStats {
                avg_time: Some(300.0),
                last_activity: Some(1700000000),
                count: 5,
                avg_speed: Some(4.5),
            }),
            reverse_stats: Some(crate::DirectionStats {
                avg_time: Some(410.0),
                last_activity: Some(1690000000),
                count: 2,
                avg_speed: Some(3.1),
            }),
        };

        let ffi = FfiSectionPerformanceResult::from(result);
        assert_eq!(ffi.records.len(), 2);
        assert_eq!(ffi.records[0].direction, "forward");
        assert_eq!(ffi.records[1].direction, "reverse");
        // Crossing these three slots would show the wrong PR per direction.
        assert_eq!(ffi.best_record.as_ref().unwrap().best_time, 118.0);
        assert_eq!(ffi.best_forward_record.as_ref().unwrap().best_time, 120.5);
        assert_eq!(ffi.best_reverse_record.as_ref().unwrap().best_time, 131.0);
        assert_eq!(ffi.forward_stats.as_ref().unwrap().count, 5);
        assert_eq!(ffi.reverse_stats.as_ref().unwrap().count, 2);
    }

    #[test]
    fn route_performance_result_keeps_its_option_slots_distinct() {
        let result = crate::RoutePerformanceResult {
            performances: vec![
                route_performance("act_1", 7.0),
                route_performance("act_2", 8.5),
            ],
            activity_metrics: vec![activity_metrics()],
            best: Some(route_performance("act_best", 9.9)),
            best_forward: Some(route_performance("act_fwd", 8.5)),
            best_reverse: Some(route_performance("act_rev", 6.2)),
            forward_stats: Some(crate::DirectionStats {
                avg_time: Some(300.0),
                last_activity: Some(1700000000),
                count: 5,
                avg_speed: Some(4.5),
            }),
            reverse_stats: Some(crate::DirectionStats {
                avg_time: Some(410.0),
                last_activity: Some(1690000000),
                count: 2,
                avg_speed: Some(3.1),
            }),
            current_rank: Some(3),
        };

        let ffi = FfiRoutePerformanceResult::from(result);
        assert_eq!(ffi.performances.len(), 2);
        assert_eq!(ffi.performances[0].activity_id, "act_1");
        assert_eq!(ffi.performances[1].activity_id, "act_2");
        assert_eq!(ffi.activity_metrics.len(), 1);
        assert_eq!(ffi.activity_metrics[0].moving_time, 3500);
        assert_eq!(ffi.best.as_ref().unwrap().activity_id, "act_best");
        assert_eq!(ffi.best_forward.as_ref().unwrap().activity_id, "act_fwd");
        assert_eq!(ffi.best_reverse.as_ref().unwrap().activity_id, "act_rev");
        assert_eq!(ffi.forward_stats.as_ref().unwrap().count, 5);
        assert_eq!(ffi.reverse_stats.as_ref().unwrap().count, 2);
        assert_eq!(ffi.current_rank, Some(3));
    }

    fn section_fixture(section_type: crate::sections::SectionType) -> crate::sections::Section {
        crate::sections::Section {
            id: "section_123".to_string(),
            section_type,
            name: Some("Test Section".to_string()),
            sport_type: "Ride".to_string(),
            polyline: vec![
                tracematch::GpsPoint::new(40.0, -74.0),
                tracematch::GpsPoint::new(40.1, -73.9),
            ],
            distance_meters: 1500.0,
            representative_activity_id: Some("act_rep".to_string()),
            activity_ids: vec!["act_123".to_string(), "act_456".to_string()],
            visit_count: 5,
            confidence: Some(0.95),
            observation_count: Some(10),
            average_spread: Some(15.0),
            point_density: Some(vec![4, 6]),
            scale: Some("medium".to_string()),
            is_user_defined: true,
            stability: Some(0.85),
            elevation_gain_m: Some(120.5),
            avg_grade_percent: Some(4.2),
            elevation_loss_m: Some(8.0),
            max_grade_percent: Some(7.5),
            straightness: Some(0.91),
            klass: Some("climb".to_string()),
            is_lift: false,
            rank_score: Some(0.7),
            sport_rank_score: Some(0.8),
            version: Some(3),
            updated_at: Some("2024-06-01T00:00:00Z".to_string()),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            route_ids: Some(vec!["route_1".to_string()]),
            source_activity_id: Some("act_src".to_string()),
            start_index: Some(11),
            end_index: Some(97),
            disabled: true,
            superseded_by: Some("section_999".to_string()),
        }
    }

    #[test]
    fn section_carries_every_field() {
        let ffi = FfiSection::from(section_fixture(crate::sections::SectionType::Custom));
        assert_eq!(ffi.id, "section_123");
        assert_eq!(ffi.section_type, "custom");
        assert_eq!(ffi.name, Some("Test Section".to_string()));
        assert_eq!(ffi.sport_type, "Ride");
        assert_eq!(ffi.distance_meters, 1500.0);
        assert_eq!(
            ffi.representative_activity_id,
            Some("act_rep".to_string()),
            "representative and source activity ids must not be crossed"
        );
        assert_eq!(ffi.source_activity_id, Some("act_src".to_string()));
        assert_eq!(ffi.activity_ids, vec!["act_123", "act_456"]);
        assert_eq!(ffi.visit_count, 5);
        assert_eq!(ffi.confidence, Some(0.95));
        assert_eq!(ffi.observation_count, Some(10));
        assert_eq!(ffi.average_spread, Some(15.0));
        assert_eq!(ffi.point_density, Some(vec![4, 6]));
        assert_eq!(ffi.scale, Some("medium".to_string()));
        assert!(ffi.is_user_defined);
        assert_eq!(ffi.stability, Some(0.85));
        assert_eq!(ffi.elevation_gain_m, Some(120.5));
        assert_eq!(ffi.avg_grade_percent, Some(4.2));
        assert_eq!(ffi.version, Some(3));
        assert_eq!(ffi.updated_at, Some("2024-06-01T00:00:00Z".to_string()));
        assert_eq!(ffi.created_at, "2024-01-01T00:00:00Z");
        assert_eq!(ffi.route_ids, Some(vec!["route_1".to_string()]));
        assert_eq!(ffi.start_index, Some(11));
        assert_eq!(ffi.end_index, Some(97));
        assert!(ffi.disabled);
        assert_eq!(ffi.superseded_by, Some("section_999".to_string()));

        // The polyline survives the delta+varint encoding in order, not just
        // in count: a reversed or truncated encode draws the wrong overlay.
        let decoded = crate::coords::decode(&ffi.encoded_polyline);
        assert_eq!(decoded.len(), 2);
        assert!((decoded[0].latitude - 40.0).abs() < 1e-5);
        assert!((decoded[0].longitude + 74.0).abs() < 1e-5);
        assert!((decoded[1].latitude - 40.1).abs() < 1e-5);
        assert!((decoded[1].longitude + 73.9).abs() < 1e-5);
    }

    #[test]
    fn section_type_reaches_ffi_as_its_own_tag() {
        // A conversion that hardcoded either tag would still satisfy the
        // single-variant test above.
        let auto = FfiSection::from(section_fixture(crate::sections::SectionType::Auto));
        assert_eq!(auto.section_type, "auto");
        let custom = FfiSection::from(section_fixture(crate::sections::SectionType::Custom));
        assert_eq!(custom.section_type, "custom");
    }
}

// ============================================================================
// Strength Training Types
// ============================================================================

/// A single exercise set from a FIT file, exposed to TypeScript.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseSet {
    pub activity_id: String,
    pub set_order: u32,
    pub exercise_category: u16,
    pub exercise_name: Option<u16>,
    /// Human-readable exercise name, pre-resolved in Rust.
    pub display_name: String,
    /// 0=active, 1=rest, 2=warmup, 3=cooldown
    pub set_type: u8,
    pub repetitions: Option<u16>,
    pub weight_kg: Option<f64>,
    pub duration_secs: Option<f64>,
}

/// A muscle group activation, matching react-native-body-highlighter slug format.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMuscleGroup {
    /// Slug matching react-native-body-highlighter (e.g., "biceps", "chest")
    pub slug: String,
    /// 1 = secondary, 2 = primary
    pub intensity: u8,
}

/// Aggregated muscle group volume over a time period.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMuscleVolume {
    /// Slug matching react-native-body-highlighter
    pub slug: String,
    /// Number of sets where this muscle is primary target
    pub primary_sets: u32,
    /// Number of sets where this muscle is secondary target
    pub secondary_sets: u32,
    /// Weighted set count: primary=1.0, secondary=0.5
    pub weighted_sets: f64,
    /// Total reps across all exercises targeting this muscle (primary only)
    pub total_reps: u32,
    /// Total volume load in kg (weight × reps) for primary exercises
    pub total_weight_kg: f64,
    /// Human-readable exercise names that targeted this muscle
    pub exercise_names: Vec<String>,
}

/// Summary of strength training volume over a time period.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStrengthSummary {
    /// Per-muscle-group volume data
    pub muscle_volumes: Vec<FfiMuscleVolume>,
    /// Number of WeightTraining activities in the period
    pub activity_count: u32,
    /// Total active sets across all activities
    pub total_sets: u32,
}

/// Inclusive Unix-second range used for batched summary requests.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiTimestampRange {
    pub start_ts: i64,
    pub end_ts: i64,
}

/// Bundled strength aggregation for the insights hook: one monthly summary
/// plus N weekly summaries, each keyed to the corresponding input range.
/// Collapses 5+ separate `getStrengthSummary` FFI calls into one round-trip.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStrengthInsightSeries {
    pub monthly: FfiStrengthSummary,
    pub weekly: Vec<FfiStrengthSummary>,
}

// ============================================================================
// Muscle Exercise Detail Types
// ============================================================================

/// Exercise summary for a specific muscle group within a date range.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseSummary {
    /// Human-readable exercise name
    pub exercise_name: String,
    /// FIT exercise category ID (pass back for drill-down query)
    pub exercise_category: u16,
    /// Average days between sessions (period_days / activity_count)
    pub frequency_days: f64,
    /// Total active sets across all activities
    pub total_sets: u32,
    /// Total volume load in kg (weight × reps)
    pub total_weight_kg: f64,
    /// Number of distinct activities containing this exercise
    pub activity_count: u32,
    /// True if the muscle is a primary target for at least one occurrence
    pub is_primary: bool,
}

/// Exercise summaries grouped by frequency for a muscle group.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMuscleExerciseSummary {
    /// Exercises targeting the muscle, sorted by activity_count DESC
    pub exercises: Vec<FfiExerciseSummary>,
    /// Number of days in the selected period
    pub period_days: u32,
}

/// An activity containing a specific exercise, with per-activity stats.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseActivity {
    /// Activity ID for navigation
    pub activity_id: String,
    /// Activity display name
    pub activity_name: String,
    /// Activity date as Unix timestamp (seconds)
    pub date: i64,
    /// Number of sets of this exercise in the activity
    pub sets: u32,
    /// Total volume load in kg (weight × reps) for this exercise in this activity
    pub total_weight_kg: f64,
    /// Whether the muscle is a primary target for this exercise
    pub is_primary: bool,
}

/// Activities for a specific exercise, sorted by date DESC.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiExerciseActivities {
    pub activities: Vec<FfiExerciseActivity>,
}

// ============================================================================
// Section Highlight Types
// ============================================================================

/// Lightweight section highlight for an activity: was this a PR?
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivitySectionHighlight {
    pub activity_id: String,
    pub section_id: String,
    pub section_name: String,
    pub lap_time: f64,
    pub is_pr: bool,
    /// -1=slower than preceding avg, 0=neutral, 1=faster
    pub trend: i8,
    /// Start index into the activity's GPS track array
    pub start_index: u32,
    /// End index into the activity's GPS track array
    pub end_index: u32,
}

/// Combined payload for batched activity-list highlights: pre-computed
/// section indicators (PRs + trends) and route highlights for the same
/// activity IDs, delivered in a single FFI round-trip.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityHighlightsBundle {
    pub indicators: Vec<FfiActivityIndicator>,
    pub route_highlights: Vec<FfiActivityRouteHighlight>,
}

// ============================================================================
// Route Highlight Types
// ============================================================================

/// Lightweight route highlight for an activity: was this a PR on the route?
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityRouteHighlight {
    pub activity_id: String,
    pub route_id: String,
    pub route_name: String,
    /// True when this activity's duration is the best across all route attempts
    pub is_pr: bool,
    /// -1=slower than preceding avg, 0=neutral, 1=faster
    pub trend: i8,
    /// Seconds between this activity's moving time and the route PR's moving
    /// time. Negative = ahead of PR, positive = behind PR. None when there is
    /// no PR comparison available (e.g. first attempt).
    pub time_delta_seconds: Option<i32>,
    /// When is_pr: seconds faster than the previous best attempt. None when
    /// this is the only timed attempt, when times tie, or when not a PR.
    pub pr_improvement_seconds: Option<u32>,
}

// ============================================================================
// Materialized Activity Indicator (from activity_indicators table)
// ============================================================================

/// Pre-computed PR or trend indicator for an activity.
/// Read from the `activity_indicators` table - no on-demand computation.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiActivityIndicator {
    pub activity_id: String,
    /// "section_pr", "route_pr", "section_trend", "route_trend"
    pub indicator_type: String,
    /// section_id or route_id
    pub target_id: String,
    pub target_name: String,
    pub direction: String,
    pub lap_time: f64,
    /// -1=declining, 0=stable, 1=improving
    pub trend: i8,
}

/// A section encounter: one (section, direction) pair for a given activity.
/// This is the canonical unit for displaying section data in the activity detail.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionEncounter {
    pub section_id: String,
    pub section_name: String,
    pub direction: String,
    pub distance_meters: f64,
    /// This activity's time on this section in this direction
    pub lap_time: f64,
    /// This activity's pace on this section in this direction
    pub lap_pace: f64,
    /// Whether this activity holds the PR for this (section, direction)
    pub is_pr: bool,
    /// How many total traversals exist for this (section, direction)
    pub visit_count: u32,
    /// Historical lap times for sparkline (chronological, all activities in this direction)
    pub history_times: Vec<f64>,
    /// Activity IDs corresponding to history_times (for highlighting current activity)
    pub history_activity_ids: Vec<String>,
}

// ============================================================================
// Section Matching & Merge Types
// ============================================================================

/// Result of matching an activity's GPS track against existing sections.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiSectionMatch {
    pub section_id: String,
    pub section_name: Option<String>,
    pub sport_type: String,
    pub start_index: u64,
    pub end_index: u64,
    pub match_quality: f64,
    pub same_direction: bool,
    pub distance_meters: f64,
}

/// Result of cheap per-activity section indexing after ingest.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiIndexActivitySummary {
    pub matched_sections: u32,
    pub inserted_portions: u32,
    pub regrouped: bool,
    pub indicators_recomputed: bool,
}

impl From<crate::sections::IndexActivitySummary> for FfiIndexActivitySummary {
    fn from(s: crate::sections::IndexActivitySummary) -> Self {
        Self {
            matched_sections: s.matched_sections,
            inserted_portions: s.inserted_portions,
            regrouped: s.regrouped,
            indicators_recomputed: s.indicators_recomputed,
        }
    }
}

/// Candidate for merging with another section.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMergeCandidate {
    pub section_id: String,
    pub name: Option<String>,
    pub sport_type: String,
    pub distance_meters: f64,
    pub visit_count: u32,
    pub overlap_pct: f64,
    pub center_distance_meters: f64,
}

/// Nearby section summary with distance info and polyline for map rendering.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiNearbySectionSummary {
    pub id: String,
    pub section_type: String,
    pub name: Option<String>,
    pub sport_type: String,
    pub distance_meters: f64,
    pub visit_count: u32,
    pub center_distance_meters: f64,
    /// Delta+varint encoded coordinates for map overlay
    pub encoded_polyline: Vec<u8>,
}

/// User-tunable match strictness, persisted in the settings table.
/// Read by Rust on engine load; written by `DetectionManager.set_match_strictness`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiMatchStrictness {
    pub min_match_pct: f64,
    pub endpoint_threshold: f64,
}

/// One stale-PR opportunity: a section whose PR might be beatable because
/// the user's threshold fitness (FTP for cycling, critical speed for run/swim)
/// has improved since the PR was set, and the section hasn't been visited
/// recently. Pure pattern recognition - TS formats as an Insight.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiStalePrOpportunity {
    pub section_id: String,
    pub section_name: String,
    pub best_time_secs: f64,
    pub traversal_count: u32,
    /// Days since the last traversal. The insight gates on this, so it has to
    /// travel with the opportunity rather than be recovered downstream.
    pub days_since_last: u32,
    /// "power" for cycling (FTP), "pace" for running/swimming (critical speed)
    pub fitness_metric: String,
    pub current_value: f64,
    pub previous_value: f64,
    pub gain_percent: f64,
    /// "W" for power, "/km" for running, "/100m" for swimming
    pub unit: String,
}
