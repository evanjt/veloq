//! FFI-safe types with UniFFI derives.
//!
//! These types mirror tracematch types but add UniFFI derives for mobile FFI.
//! Conversion is done at the FFI boundary.

use serde::{Deserialize, Serialize};

// ============================================================================
// Core Types
// ============================================================================

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
// Helper functions
// ============================================================================

/// Get default scale presets
pub fn default_scale_presets() -> Vec<FfiScalePreset> {
    tracematch::ScalePreset::default_presets()
        .into_iter()
        .map(FfiScalePreset::from)
        .collect()
}
