//! FFI bindings for mobile platforms (iOS/Android).
//!
//! This module provides the UniFFI bindings that expose Rust functionality
//! to Kotlin and Swift. All FFI functions are prefixed with `ffi_` to avoid
//! naming conflicts with the internal API.

use crate::ffi_types::{
    FfiActivityHeatmapData, FfiHeatmapConfig, FfiHeatmapResult, FfiMultiScaleSectionResult,
    FfiRouteGroup, FfiRouteSignature, FfiScalePreset, FfiSectionConfig,
};
use crate::{elapsed_ms, init_logging};
use log::info;
use std::time::Instant;
use tracematch::GpsPoint;

// ============================================================================
// Callback Interfaces
// ============================================================================

/// Callback interface for receiving progress updates during fetch operations.
/// Implement this in TypeScript/Kotlin/Swift to receive real-time updates.
#[uniffi::export(callback_interface)]
pub trait FetchProgressCallback: Send + Sync {
    /// Called when a single activity fetch completes.
    /// - completed: Number of activities fetched so far
    /// - total: Total number of activities to fetch
    fn on_progress(&self, completed: u32, total: u32);
}

/// Result of polling download progress.
/// Used by TypeScript to show real-time progress without cross-thread callbacks.
#[derive(Debug, Clone, uniffi::Record)]
pub struct DownloadProgressResult {
    /// Number of activities fetched so far
    pub completed: u32,
    /// Total number of activities to fetch
    pub total: u32,
    /// Whether a download is currently active
    pub active: bool,
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

/// Get default scale presets for multi-scale detection
#[uniffi::export]
pub fn default_scale_presets() -> Vec<FfiScalePreset> {
    crate::ffi_types::default_scale_presets()
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
    groups: Vec<FfiRouteGroup>,
    config: FfiSectionConfig,
) -> FfiMultiScaleSectionResult {
    init_logging();
    let ffi_start = Instant::now();
    info!(
        "[RUST: detect_sections_multiscale] FFI called with {} activities, {} coords, {} scales",
        activity_ids.len(),
        all_coords.len() / 2,
        config.scale_presets.len()
    );

    // Phase 1: Convert flat coordinates to tracks
    let convert_start = Instant::now();
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
                points.push(GpsPoint::new(
                    all_coords[coord_idx],
                    all_coords[coord_idx + 1],
                ));
            }
        }

        if !points.is_empty() {
            tracks.push((activity_id.clone(), points));
        }
    }
    info!(
        "[RUST: detect_sections_multiscale] Converted {} tracks ({} ms)",
        tracks.len(),
        elapsed_ms(convert_start)
    );

    // Phase 2: Build sport type map
    let sport_map_start = Instant::now();
    let sport_map: std::collections::HashMap<String, String> = sport_types
        .into_iter()
        .map(|st| (st.activity_id, st.sport_type))
        .collect();
    info!(
        "[RUST: detect_sections_multiscale] Built sport map ({} ms)",
        elapsed_ms(sport_map_start)
    );

    // Phase 3: Convert FFI types to tracematch types and run detection
    let detect_start = Instant::now();
    let tm_groups: Vec<tracematch::RouteGroup> = groups.into_iter().map(Into::into).collect();
    let tm_config: tracematch::SectionConfig = config.into();
    let result = tracematch::sections::detect_sections_multiscale(&tracks, &sport_map, &tm_groups, &tm_config);
    info!(
        "[RUST: detect_sections_multiscale] Detection complete: {} raw sections, {} raw potentials ({} ms)",
        result.sections.len(),
        result.potentials.len(),
        elapsed_ms(detect_start)
    );

    // Phase 4: Filter sparse sections
    let filter_start = Instant::now();
    let filtered_sections: Vec<_> = result
        .sections
        .into_iter()
        .filter(|s| s.polyline.len() >= 2)
        .collect();
    let filtered_potentials: Vec<_> = result
        .potentials
        .into_iter()
        .filter(|p| p.polyline.len() >= 2)
        .collect();
    info!(
        "[RUST: detect_sections_multiscale] Filtered to {} sections, {} potentials ({} ms)",
        filtered_sections.len(),
        filtered_potentials.len(),
        elapsed_ms(filter_start)
    );

    info!(
        "[RUST: detect_sections_multiscale] Complete ({} ms)",
        elapsed_ms(ffi_start)
    );

    // Convert back to FFI types
    FfiMultiScaleSectionResult::from(tracematch::MultiScaleSectionResult {
        sections: filtered_sections,
        potentials: filtered_potentials,
        stats: result.stats,
    })
}

// ============================================================================
// Heatmap Generation FFI
// ============================================================================

/// Generate a heatmap from route signatures.
/// Uses the simplified GPS traces (~100 points each) for efficient generation.
#[uniffi::export]
pub fn ffi_generate_heatmap(
    signatures: Vec<FfiRouteSignature>,
    activity_data: Vec<FfiActivityHeatmapData>,
    config: FfiHeatmapConfig,
) -> FfiHeatmapResult {
    init_logging();
    let ffi_start = Instant::now();
    info!(
        "[RUST: generate_heatmap] FFI called with {} signatures, {}m cells",
        signatures.len(),
        config.cell_size_meters
    );

    // Phase 1: Convert FFI types and build data map
    let map_start = Instant::now();
    let data_map: std::collections::HashMap<String, tracematch::ActivityHeatmapData> = activity_data
        .into_iter()
        .map(|d| (d.activity_id.clone(), d.into()))
        .collect();
    info!(
        "[RUST: generate_heatmap] Built data map with {} entries ({} ms)",
        data_map.len(),
        elapsed_ms(map_start)
    );

    // Phase 2: Convert signatures and generate heatmap
    let gen_start = Instant::now();
    let tm_signatures: Vec<tracematch::RouteSignature> = signatures.into_iter().map(Into::into).collect();
    let tm_config: tracematch::HeatmapConfig = config.into();
    let result = tracematch::generate_heatmap(&tm_signatures, &data_map, &tm_config);
    info!(
        "[RUST: generate_heatmap] Generated {} cells, {} routes, {} activities ({} ms)",
        result.cells.len(),
        result.total_routes,
        result.total_activities,
        elapsed_ms(gen_start)
    );

    info!(
        "[RUST: generate_heatmap] Complete ({} ms)",
        elapsed_ms(ffi_start)
    );

    FfiHeatmapResult::from(result)
}

// =============================================================================
// HTTP Activity Fetching (requires "http" feature)
// =============================================================================

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

/// Fetch map data for multiple activities.
///
/// The auth_header should be a pre-formatted Authorization header value:
/// - For API key auth: "Basic {base64(API_KEY:key)}"
/// - For OAuth: "Bearer {access_token}"
#[cfg(feature = "http")]
#[uniffi::export]
pub fn fetch_activity_maps(
    auth_header: String,
    activity_ids: Vec<String>,
) -> Vec<FfiActivityMapResult> {
    init_logging();
    let ffi_start = Instant::now();
    let count = activity_ids.len();
    info!(
        "[RUST: fetch_activity_maps] FFI called with {} activities",
        count
    );

    // Fetch from API
    let fetch_start = Instant::now();
    let results = crate::http::fetch_activity_maps_sync(auth_header, activity_ids, None);
    let success_count = results.iter().filter(|r| r.success).count();
    info!(
        "[RUST: fetch_activity_maps] Fetched {}/{} successfully ({} ms)",
        success_count,
        count,
        elapsed_ms(fetch_start)
    );

    // Convert to FFI-friendly format (flat arrays)
    let convert_start = Instant::now();
    let ffi_results: Vec<FfiActivityMapResult> = results
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
        .collect();
    info!(
        "[RUST: fetch_activity_maps] Converted to FFI format ({} ms)",
        elapsed_ms(convert_start)
    );

    info!(
        "[RUST: fetch_activity_maps] Complete ({} ms)",
        elapsed_ms(ffi_start)
    );

    ffi_results
}

/// Fetch map data with real-time progress callbacks.
///
/// Same as fetch_activity_maps but calls the progress callback after each
/// activity is fetched, allowing the UI to show real-time progress.
///
/// NOTE: The callback is invoked from tokio worker threads. This may cause
/// crashes with some FFI runtimes (like React Native's Hermes) that aren't
/// thread-safe. Use fetch_activity_maps without callback if you experience crashes.
///
/// The auth_header should be a pre-formatted Authorization header value:
/// - For API key auth: "Basic {base64(API_KEY:key)}"
/// - For OAuth: "Bearer {access_token}"
#[cfg(feature = "http")]
#[uniffi::export]
pub fn fetch_activity_maps_with_progress(
    auth_header: String,
    activity_ids: Vec<String>,
    callback: Box<dyn FetchProgressCallback>,
) -> Vec<FfiActivityMapResult> {
    use std::sync::Arc;

    init_logging();
    let ffi_start = Instant::now();
    let count = activity_ids.len();
    info!(
        "[RUST: fetch_activity_maps_with_progress] FFI called with {} activities",
        count
    );

    // Wrap the callback to match the expected type
    let callback = Arc::new(callback);
    let progress_callback: crate::http::ProgressCallback = Arc::new(move |completed, total| {
        callback.on_progress(completed, total);
    });

    let fetch_start = Instant::now();
    let results =
        crate::http::fetch_activity_maps_sync(auth_header, activity_ids, Some(progress_callback));
    let success_count = results.iter().filter(|r| r.success).count();
    info!(
        "[RUST: fetch_activity_maps_with_progress] Fetched {}/{} successfully ({} ms)",
        success_count,
        count,
        elapsed_ms(fetch_start)
    );

    // Convert to FFI-friendly format (flat arrays)
    let convert_start = Instant::now();
    let ffi_results: Vec<FfiActivityMapResult> = results
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
        .collect();
    info!(
        "[RUST: fetch_activity_maps_with_progress] Converted to FFI format ({} ms)",
        elapsed_ms(convert_start)
    );

    info!(
        "[RUST: fetch_activity_maps_with_progress] Complete ({} ms)",
        elapsed_ms(ffi_start)
    );

    ffi_results
}

/// Get current download progress for FFI polling.
///
/// TypeScript should poll this every 100ms during fetch operations
/// to get smooth progress updates without cross-thread callback issues.
///
/// Returns DownloadProgressResult with completed/total/active fields.
/// When active is false, the download has completed (or never started).
#[cfg(feature = "http")]
#[uniffi::export]
pub fn get_download_progress() -> DownloadProgressResult {
    let (completed, total, active) = crate::http::get_download_progress();
    DownloadProgressResult {
        completed,
        total,
        active,
    }
}

/// Start a non-blocking background fetch.
///
/// This returns immediately and the fetch runs in a background thread.
/// Poll get_download_progress() to monitor progress.
/// When active becomes false, call take_background_fetch_results() to get the data.
///
/// This is preferred over fetch_activity_maps() for UI responsiveness as it
/// doesn't block the JavaScript thread.
#[cfg(feature = "http")]
#[uniffi::export]
pub fn start_background_fetch(auth_header: String, activity_ids: Vec<String>) {
    init_logging();
    let ffi_start = Instant::now();
    info!(
        "[RUST: start_background_fetch] FFI called with {} activities",
        activity_ids.len()
    );
    crate::http::start_background_fetch(auth_header, activity_ids);
    info!(
        "[RUST: start_background_fetch] Thread spawned, returning to caller ({} ms)",
        elapsed_ms(ffi_start)
    );
}

/// Take the results from a completed background fetch.
///
/// Returns None if fetch is still in progress (check get_download_progress().active).
/// Returns the results and clears storage when complete.
/// Each call after completion returns None until a new fetch is started.
#[cfg(feature = "http")]
#[uniffi::export]
pub fn take_background_fetch_results() -> Option<Vec<FfiActivityMapResult>> {
    init_logging();
    let ffi_start = Instant::now();

    let result = crate::http::take_background_fetch_results().map(|results| {
        let count = results.len();
        let success_count = results.iter().filter(|r| r.success).count();
        info!(
            "[RUST: take_background_fetch_results] Converting {} results ({} successful)",
            count, success_count
        );

        let convert_start = Instant::now();
        let converted: Vec<FfiActivityMapResult> = results
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
            .collect();
        info!(
            "[RUST: take_background_fetch_results] Converted to FFI format ({} ms)",
            elapsed_ms(convert_start)
        );
        converted
    });

    if result.is_some() {
        info!(
            "[RUST: take_background_fetch_results] Complete with results ({} ms)",
            elapsed_ms(ffi_start)
        );
    }
    // Don't log when returning None - this is called frequently during polling

    result
}

// =============================================================================
// Combined Fetch + Store (Eliminates FFI Round-Trip)
// =============================================================================

/// Result of the combined fetch and store operation.
#[cfg(all(feature = "http", feature = "persistence"))]
#[derive(Debug, Clone, uniffi::Record)]
pub struct FetchAndStoreResult {
    /// Activity IDs that were successfully fetched and stored
    pub synced_ids: Vec<String>,
    /// Activity IDs that failed to fetch
    pub failed_ids: Vec<String>,
    /// Total number of activities processed
    pub total: u32,
    /// Number successfully synced
    pub success_count: u32,
    /// Total GPS points stored
    pub total_points: u32,
    /// Time to fetch all GPS data (ms)
    pub fetch_time_ms: u32,
    /// Time to store in SQLite (ms)
    pub storage_time_ms: u32,
    /// Total thread time (ms)
    pub total_time_ms: u32,
}

/// Sport type mapping for activities.
#[cfg(all(feature = "http", feature = "persistence"))]
#[derive(Debug, Clone, uniffi::Record)]
pub struct ActivitySportMapping {
    pub activity_id: String,
    pub sport_type: String,
}

/// Start a background fetch that downloads GPS data and stores it directly
/// in the persistent engine. This eliminates the FFI round-trip where GPS
/// data would otherwise be sent to TypeScript and back.
///
/// Poll get_download_progress() to monitor progress.
/// When active becomes false, call take_fetch_and_store_result() to get the result.
///
/// This is ~3x faster than the separate fetch + addActivities approach because:
/// - No ~1.7MB GPS data transfer from Rust to TypeScript
/// - No ~865KB GPS data transfer from TypeScript back to Rust
/// - Direct storage in SQLite without serialization overhead
#[cfg(all(feature = "http", feature = "persistence"))]
#[uniffi::export]
pub fn start_fetch_and_store(
    auth_header: String,
    activity_ids: Vec<String>,
    sport_types: Vec<ActivitySportMapping>,
) {
    use crate::elapsed_ms;
    use std::collections::HashMap;
    init_logging();

    let ffi_start = Instant::now();
    let activity_count = activity_ids.len();
    // Use both info! and eprintln! - eprintln flushes immediately to stderr
    info!(
        "[RUST: start_fetch_and_store] FFI called with {} activities",
        activity_count
    );
    eprintln!(
        "[RUST: start_fetch_and_store] FFI called with {} activities",
        activity_count
    );

    // Build sport type lookup
    let sport_map_start = Instant::now();
    let sport_map: HashMap<String, String> = sport_types
        .into_iter()
        .map(|m| (m.activity_id, m.sport_type))
        .collect();
    info!(
        "[RUST: start_fetch_and_store] Built sport map with {} entries ({} ms)",
        sport_map.len(),
        elapsed_ms(sport_map_start)
    );

    // Clear any previous results
    if let Ok(mut results) = FETCH_AND_STORE_RESULT.lock() {
        *results = None;
    }

    // Reset progress counters
    crate::http::reset_download_progress(activity_ids.len() as u32);

    info!(
        "[RUST: start_fetch_and_store] Spawning background thread ({} ms)",
        elapsed_ms(ffi_start)
    );

    let activity_ids_clone = activity_ids.clone();

    // Spawn background thread
    std::thread::spawn(move || {
        let thread_start = Instant::now();
        info!(
            "[RUST: start_fetch_and_store] Thread started for {} activities",
            activity_ids.len()
        );
        eprintln!(
            "[RUST: start_fetch_and_store] Thread started for {} activities",
            activity_ids.len()
        );

        // Create tokio runtime for async HTTP
        let runtime_start = Instant::now();
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
        {
            Ok(rt) => {
                info!(
                    "[RUST: start_fetch_and_store] Created tokio runtime ({} ms)",
                    elapsed_ms(runtime_start)
                );
                rt
            }
            Err(e) => {
                info!(
                    "[RUST: start_fetch_and_store] Failed to create runtime: {} ({} ms)",
                    e,
                    elapsed_ms(runtime_start)
                );
                crate::http::finish_download_progress();
                store_fetch_and_store_result(FetchAndStoreResult {
                    synced_ids: vec![],
                    failed_ids: activity_ids,
                    total: 0,
                    success_count: 0,
                    total_points: 0,
                    fetch_time_ms: 0,
                    storage_time_ms: 0,
                    total_time_ms: elapsed_ms(thread_start) as u32,
                });
                return;
            }
        };

        // Create HTTP fetcher
        let client_start = Instant::now();
        let fetcher = match crate::http::ActivityFetcher::with_auth_header(auth_header) {
            Ok(f) => {
                info!(
                    "[RUST: start_fetch_and_store] Created HTTP client ({} ms)",
                    elapsed_ms(client_start)
                );
                f
            }
            Err(e) => {
                info!(
                    "[RUST: start_fetch_and_store] Failed to create HTTP client: {} ({} ms)",
                    e,
                    elapsed_ms(client_start)
                );
                crate::http::finish_download_progress();
                store_fetch_and_store_result(FetchAndStoreResult {
                    synced_ids: vec![],
                    failed_ids: activity_ids,
                    total: 0,
                    success_count: 0,
                    total_points: 0,
                    fetch_time_ms: 0,
                    storage_time_ms: 0,
                    total_time_ms: elapsed_ms(thread_start) as u32,
                });
                return;
            }
        };

        // Fetch GPS data
        let fetch_start = Instant::now();
        let fetch_results =
            rt.block_on(fetcher.fetch_activity_maps(activity_ids_clone.clone(), None));
        let fetch_success_count = fetch_results.iter().filter(|r| r.success).count();
        info!(
            "[RUST: start_fetch_and_store] Fetch complete: {}/{} successful ({} ms)",
            fetch_success_count,
            fetch_results.len(),
            elapsed_ms(fetch_start)
        );

        // Store directly in persistent engine (NO FFI round-trip!)
        let storage_start = Instant::now();
        let mut synced_ids = Vec::new();
        let mut failed_ids = Vec::new();
        let mut total_points: usize = 0;
        let num_results = fetch_results.len();

        // PERF ASSESSMENT: Storage is currently SEQUENTIAL (one activity at a time)
        // SQLite doesn't support concurrent writes, but we could batch inserts
        info!(
            "[RUST: PERF] Storage: processing {} activities SEQUENTIALLY (SQLite limitation)",
            num_results
        );

        for (idx, result) in fetch_results.into_iter().enumerate() {
            let activity_start = Instant::now();
            if result.success {
                if let Some(latlngs) = result.latlngs {
                    if latlngs.len() >= 2 {
                        // Convert to GpsPoints
                        let coords: Vec<GpsPoint> = latlngs
                            .iter()
                            .filter_map(|p| {
                                let lat = p[0];
                                let lng = p[1];
                                // Validate coordinates
                                if lat.is_finite()
                                    && lng.is_finite()
                                    && (-90.0..=90.0).contains(&lat)
                                    && (-180.0..=180.0).contains(&lng)
                                {
                                    Some(GpsPoint::new(lat, lng))
                                } else {
                                    None
                                }
                            })
                            .collect();

                        if coords.len() >= 2 {
                            total_points += coords.len();

                            // Get sport type
                            let sport = sport_map
                                .get(&result.activity_id)
                                .cloned()
                                .unwrap_or_else(|| "Ride".to_string());

                            // Capture point count before moving coords
                            let point_count = coords.len();

                            // Store directly in engine
                            let stored = crate::persistence::with_persistent_engine(|engine| {
                                engine
                                    .add_activity(result.activity_id.clone(), coords, sport)
                                    .is_ok()
                            })
                            .unwrap_or(false);

                            let activity_time = elapsed_ms(activity_start);
                            if stored {
                                if idx == 0 || idx == num_results - 1 || activity_time > 10 {
                                    info!(
                                        "[RUST: PERF] Storage[{}/{}]: {} ({} points) in {} ms",
                                        idx + 1,
                                        num_results,
                                        result.activity_id,
                                        point_count,
                                        activity_time
                                    );
                                }
                                synced_ids.push(result.activity_id);
                            } else {
                                failed_ids.push(result.activity_id);
                            }
                        } else {
                            failed_ids.push(result.activity_id);
                        }
                    } else {
                        failed_ids.push(result.activity_id);
                    }
                } else {
                    failed_ids.push(result.activity_id);
                }
            } else {
                failed_ids.push(result.activity_id);
            }
        }

        let storage_time = elapsed_ms(storage_start);
        let avg_per_activity = if !synced_ids.is_empty() {
            storage_time / synced_ids.len() as u64
        } else {
            0
        };
        info!(
            "[RUST: PERF] Storage complete: {} activities, {} points in {} ms (avg {} ms/activity)",
            synced_ids.len(),
            total_points,
            storage_time,
            avg_per_activity
        );

        let success_count = synced_ids.len() as u32;
        let total = (synced_ids.len() + failed_ids.len()) as u32;

        info!(
            "[RUST: start_fetch_and_store] Storage complete: {} synced, {} failed, {} total points ({} ms)",
            success_count,
            failed_ids.len(),
            total_points,
            elapsed_ms(storage_start)
        );
        eprintln!(
            "[RUST: start_fetch_and_store] Storage complete: {} synced, {} failed, {} total points ({} ms)",
            success_count,
            failed_ids.len(),
            total_points,
            elapsed_ms(storage_start)
        );

        let fetch_time = elapsed_ms(fetch_start) as u32;
        let storage_time = elapsed_ms(storage_start) as u32;
        let total_time = elapsed_ms(thread_start) as u32;

        // Store result
        store_fetch_and_store_result(FetchAndStoreResult {
            synced_ids,
            failed_ids,
            total,
            success_count,
            total_points: total_points as u32,
            fetch_time_ms: fetch_time,
            storage_time_ms: storage_time,
            total_time_ms: total_time,
        });

        crate::http::finish_download_progress();

        info!(
            "[RUST: start_fetch_and_store] Thread complete ({} ms)",
            total_time
        );
        eprintln!(
            "[RUST: start_fetch_and_store] Thread complete ({} ms)",
            total_time
        );
    });
}

/// Storage for fetch+store results
#[cfg(all(feature = "http", feature = "persistence"))]
static FETCH_AND_STORE_RESULT: std::sync::Mutex<Option<FetchAndStoreResult>> =
    std::sync::Mutex::new(None);

#[cfg(all(feature = "http", feature = "persistence"))]
fn store_fetch_and_store_result(result: FetchAndStoreResult) {
    if let Ok(mut guard) = FETCH_AND_STORE_RESULT.lock() {
        *guard = Some(result);
    }
}

/// Take the result from a completed fetch+store operation.
///
/// Returns None if operation is still in progress.
/// Returns the result and clears storage when complete.
#[cfg(all(feature = "http", feature = "persistence"))]
#[uniffi::export]
pub fn take_fetch_and_store_result() -> Option<FetchAndStoreResult> {
    init_logging();

    let result = if let Ok(mut guard) = FETCH_AND_STORE_RESULT.lock() {
        guard.take()
    } else {
        None
    };

    if let Some(ref r) = result {
        info!(
            "[RUST: take_fetch_and_store_result] Returning result: {} synced, {} failed",
            r.success_count,
            r.failed_ids.len()
        );
    }
    // Don't log when returning None - this is called frequently during polling

    result
}
