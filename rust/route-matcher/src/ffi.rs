//! FFI bindings for mobile platforms (iOS/Android).
//!
//! This module provides the UniFFI bindings that expose Rust functionality
//! to Kotlin and Swift. All FFI functions are prefixed with `ffi_` to avoid
//! naming conflicts with the internal API.

use crate::{
    compare_routes, init_logging,
    GpsPoint, MatchConfig, MatchResult, RouteGroup, RouteSignature,
};
use log::{debug, info};

#[cfg(feature = "parallel")]
use crate::grouping::{group_incremental, group_signatures_parallel};

#[cfg(not(feature = "parallel"))]
use crate::group_signatures;

// ============================================================================
// Progress Callback Interface (for real-time updates to mobile)
// ============================================================================

/// Callback interface for receiving progress updates during fetch operations.
/// Implement this in Kotlin/Swift to receive real-time updates.
#[uniffi::export(callback_interface)]
pub trait FetchProgressCallback: Send + Sync {
    /// Called when a single activity fetch completes.
    /// - completed: Number of activities fetched so far
    /// - total: Total number of activities to fetch
    fn on_progress(&self, completed: u32, total: u32);
}

// ============================================================================
// Core Route Functions
// ============================================================================

/// Create a route signature from GPS points.
#[uniffi::export]
pub fn create_signature(activity_id: String, points: Vec<GpsPoint>) -> Option<RouteSignature> {
    init_logging();
    info!(
        "[RouteMatcherRust] create_signature called for {} with {} points",
        activity_id,
        points.len()
    );
    let result = RouteSignature::from_points(&activity_id, &points, &MatchConfig::default());
    if let Some(ref sig) = result {
        info!(
            "[RouteMatcherRust] Created signature: {} points, {:.0}m distance",
            sig.points.len(),
            sig.total_distance
        );
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
    info!(
        "[RouteMatcherRust] create_signature_with_config for {} ({} points)",
        activity_id,
        points.len()
    );
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
    debug!(
        "[RouteMatcherRust] Comparing {} vs {}",
        sig1.activity_id, sig2.activity_id
    );
    let result = compare_routes(sig1, sig2, &config);
    if let Some(ref r) = result {
        info!(
            "[RouteMatcherRust] Match found: {:.1}% ({})",
            r.match_percentage, r.direction
        );
    }
    result
}

/// Group signatures into route groups.
#[uniffi::export]
pub fn ffi_group_signatures(signatures: Vec<RouteSignature>, config: MatchConfig) -> Vec<RouteGroup> {
    init_logging();
    info!(
        "[RouteMatcherRust] RUST groupSignatures called with {} signatures",
        signatures.len()
    );

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
    info!(
        "[RouteMatcherRust] Grouped into {} groups in {:?}",
        groups.len(),
        elapsed
    );

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
    info!(
        "[RouteMatcherRust] Incremental grouped into {} groups in {:?}",
        groups.len(),
        elapsed
    );

    groups
}

/// Get default configuration.
#[uniffi::export]
pub fn default_config() -> MatchConfig {
    init_logging();
    info!("[RouteMatcherRust] default_config called - Rust is active!");
    MatchConfig::default()
}

// ============================================================================
// Flat Buffer Processing (optimized for TypedArray input)
// ============================================================================

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
pub fn create_signatures_from_flat(
    tracks: Vec<FlatGpsTrack>,
    config: MatchConfig,
) -> Vec<RouteSignature> {
    init_logging();
    info!(
        "[RouteMatcherRust] FLAT BUFFER createSignatures called with {} tracks",
        tracks.len()
    );

    let start = std::time::Instant::now();

    #[cfg(feature = "parallel")]
    let signatures: Vec<RouteSignature> = {
        use rayon::prelude::*;
        info!("[RouteMatcherRust] Using PARALLEL flat buffer processing (rayon)");
        tracks
            .par_iter()
            .filter_map(|track| {
                // Convert flat coords to GpsPoints
                let points: Vec<GpsPoint> = track
                    .coords
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
                let points: Vec<GpsPoint> = track
                    .coords
                    .chunks_exact(2)
                    .map(|chunk| GpsPoint::new(chunk[0], chunk[1]))
                    .collect();
                RouteSignature::from_points(&track.activity_id, &points, &config)
            })
            .collect()
    };

    let elapsed = start.elapsed();
    info!(
        "[RouteMatcherRust] FLAT created {} signatures from {} tracks in {:?}",
        signatures.len(),
        tracks.len(),
        elapsed
    );

    signatures
}

/// Process routes end-to-end from flat buffers: create signatures AND group them.
/// Most efficient way to process many activities from TypedArray input.
#[uniffi::export]
pub fn process_routes_from_flat(tracks: Vec<FlatGpsTrack>, config: MatchConfig) -> Vec<RouteGroup> {
    init_logging();
    info!(
        "[RouteMatcherRust] FLAT BATCH process_routes called with {} tracks",
        tracks.len()
    );

    let start = std::time::Instant::now();

    // Step 1: Create all signatures from flat buffers
    let signatures = create_signatures_from_flat(tracks.clone(), config.clone());

    // Step 2: Group signatures
    #[cfg(feature = "parallel")]
    let groups = group_signatures_parallel(&signatures, &config);

    #[cfg(not(feature = "parallel"))]
    let groups = group_signatures(&signatures, &config);

    let elapsed = start.elapsed();
    info!(
        "[RouteMatcherRust] FLAT batch processing: {} signatures -> {} groups in {:?}",
        signatures.len(),
        groups.len(),
        elapsed
    );

    groups
}

// ============================================================================
// HTTP Activity Fetching (requires "http" feature)
// ============================================================================

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
pub fn fetch_activity_maps(api_key: String, activity_ids: Vec<String>) -> Vec<FfiActivityMapResult> {
    init_logging();
    info!(
        "[RouteMatcherRust] fetch_activity_maps called for {} activities",
        activity_ids.len()
    );

    let results = crate::http::fetch_activity_maps_sync(api_key, activity_ids, None);

    // Convert to FFI-friendly format
    results
        .into_iter()
        .map(|r| FfiActivityMapResult {
            activity_id: r.activity_id,
            bounds: r
                .bounds
                .map_or(vec![], |b| vec![b.ne[0], b.ne[1], b.sw[0], b.sw[1]]),
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
    info!(
        "[RouteMatcherRust] fetch_activity_maps_with_progress called for {} activities",
        activity_ids.len()
    );

    // Wrap the callback to match the expected type
    let callback = Arc::new(callback);
    let progress_callback: crate::http::ProgressCallback = Arc::new(move |completed, total| {
        callback.on_progress(completed, total);
    });

    let results =
        crate::http::fetch_activity_maps_sync(api_key, activity_ids, Some(progress_callback));

    // Convert to FFI-friendly format
    results
        .into_iter()
        .map(|r| FfiActivityMapResult {
            activity_id: r.activity_id,
            bounds: r
                .bounds
                .map_or(vec![], |b| vec![b.ne[0], b.ne[1], b.sw[0], b.sw[1]]),
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
    info!(
        "[RouteMatcherRust] fetch_and_process_activities for {} activities",
        activity_ids.len()
    );

    let start = std::time::Instant::now();

    // Fetch all activity maps
    let results = crate::http::fetch_activity_maps_sync(api_key, activity_ids, None);

    // Convert to FFI format and create signatures from successful fetches
    let mut map_results = Vec::with_capacity(results.len());
    let mut signatures = Vec::new();

    for r in results {
        let bounds_vec = r
            .bounds
            .as_ref()
            .map_or(vec![], |b| vec![b.ne[0], b.ne[1], b.sw[0], b.sw[1]]);

        let latlngs_flat: Vec<f64> = r.latlngs.as_ref().map_or(vec![], |coords| {
            coords.iter().flat_map(|p| vec![p[0], p[1]]).collect()
        });

        // Create signature if we have GPS data
        if r.success && r.latlngs.is_some() {
            let points: Vec<GpsPoint> = r
                .latlngs
                .as_ref()
                .unwrap()
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
    info!(
        "[RouteMatcherRust] Fetched {} activities, created {} signatures in {:?}",
        map_results.len(),
        signatures.len(),
        elapsed
    );

    FetchAndProcessResult {
        map_results,
        signatures,
    }
}

// ============================================================================
// Frequent Sections Detection
// ============================================================================

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

/// Get discovery mode section config (more sensitive detection, lower thresholds)
#[uniffi::export]
pub fn discovery_section_config() -> crate::SectionConfig {
    crate::SectionConfig::discovery()
}

/// Get conservative section config (fewer sections, higher confidence)
#[uniffi::export]
pub fn conservative_section_config() -> crate::SectionConfig {
    crate::SectionConfig::conservative()
}

/// Get legacy section config (backward compatible single-scale)
#[uniffi::export]
pub fn legacy_section_config() -> crate::SectionConfig {
    crate::SectionConfig::legacy()
}

/// Get default scale presets for multi-scale detection
#[uniffi::export]
pub fn default_scale_presets() -> Vec<crate::ScalePreset> {
    crate::ScalePreset::default_presets()
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
        let end_offset = offsets
            .get(i + 1)
            .map(|&o| o as usize)
            .unwrap_or(all_coords.len() / 2);

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

    let sections =
        crate::sections::detect_sections_from_tracks(&tracks, &sport_map, &groups, &config);

    let elapsed = start.elapsed();
    info!(
        "[RouteMatcherRust] Found {} sections (medoid-based) in {:?}",
        sections.len(),
        elapsed
    );

    sections
}

/// Detect sections at multiple scales with potential section suggestions.
/// This is the flagship entry point for section detection.
///
/// Returns a MultiScaleSectionResult with:
/// - sections: Confirmed sections (meeting min_activities threshold)
/// - potentials: Suggested sections from 1-2 activity overlaps
/// - stats: Detection statistics
#[uniffi::export]
pub fn ffi_detect_sections_multiscale(
    activity_ids: Vec<String>,
    all_coords: Vec<f64>,
    offsets: Vec<u32>,
    sport_types: Vec<ActivitySportType>,
    groups: Vec<RouteGroup>,
    config: crate::SectionConfig,
) -> crate::MultiScaleSectionResult {
    init_logging();
    info!(
        "[RouteMatcherRust] detect_sections_multiscale: {} activities, {} coords, {} scales",
        activity_ids.len(),
        all_coords.len() / 2,
        config.scale_presets.len()
    );

    let start = std::time::Instant::now();

    // Convert flat coordinates to tracks
    let mut tracks: Vec<(String, Vec<GpsPoint>)> = Vec::with_capacity(activity_ids.len());

    for (i, activity_id) in activity_ids.iter().enumerate() {
        let start_offset = offsets[i] as usize;
        let end_offset = offsets
            .get(i + 1)
            .map(|&o| o as usize)
            .unwrap_or(all_coords.len() / 2);

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

    let result =
        crate::sections::detect_sections_multiscale(&tracks, &sport_map, &groups, &config);

    let elapsed = start.elapsed();
    info!(
        "[RouteMatcherRust] Multi-scale detection: {} sections, {} potentials in {:?}",
        result.sections.len(),
        result.potentials.len(),
        elapsed
    );

    result
}

// ============================================================================
// Heatmap Generation FFI
// ============================================================================

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
    let data_map: std::collections::HashMap<String, crate::ActivityHeatmapData> = activity_data
        .into_iter()
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

// ============================================================================
// Zone Distribution FFI
// ============================================================================

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
    info!(
        "[RouteMatcherRust] calculate_power_zones: {} samples, FTP={}W",
        power_data.len(),
        ftp
    );

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
    info!(
        "[RouteMatcherRust] calculate_hr_zones: {} samples, threshold={}bpm",
        hr_data.len(),
        threshold_hr
    );

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

// ============================================================================
// Power/Pace Curve FFI
// ============================================================================

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
    info!(
        "[RouteMatcherRust] compute_power_curve: {} samples, {} durations",
        power_data.len(),
        durations.len()
    );

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
        let end = offsets
            .get(i + 1)
            .map(|&o| o as usize)
            .unwrap_or(power_data_flat.len());
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