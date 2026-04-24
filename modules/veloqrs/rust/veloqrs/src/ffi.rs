//! FFI bindings for mobile platforms (iOS/Android).
//!
//! This module provides the UniFFI bindings that expose Rust functionality
//! to Kotlin and Swift. All FFI functions are prefixed with `ffi_` to avoid
//! naming conflicts with the internal API.

use crate::init_logging;
use log::info;
use std::time::Instant;
use tracematch::GpsPoint;

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

/// Get current download progress for FFI polling.
///
/// TypeScript should poll this every 100ms during fetch operations
/// to get smooth progress updates without cross-thread callback issues.
///
/// Returns DownloadProgressResult with completed/total/active fields.
/// When active is false, the download has completed (or never started).

#[uniffi::export]
pub fn get_download_progress() -> DownloadProgressResult {
    let (completed, total, active) = crate::http::get_download_progress();
    DownloadProgressResult {
        completed,
        total,
        active,
    }
}

// =============================================================================
// Combined Fetch + Store (Eliminates FFI Round-Trip)
// =============================================================================

/// Result of the combined fetch and store operation.

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

        // Spawn background heatmap tile generation with the new GPS data
        if success_count > 0 {
            let handle = crate::persistence::with_persistent_engine(|engine| {
                engine.mark_heatmap_dirty();
                engine.generate_tiles_background()
            });
            if let Some(Some(h)) = handle {
                if let Ok(mut guard) =
                    crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock()
                {
                    *guard = Some(h);
                }
            }
        }

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

static FETCH_AND_STORE_RESULT: std::sync::Mutex<Option<FetchAndStoreResult>> =
    std::sync::Mutex::new(None);

fn store_fetch_and_store_result(result: FetchAndStoreResult) {
    if let Ok(mut guard) = FETCH_AND_STORE_RESULT.lock() {
        *guard = Some(result);
    }
}

/// Take the result from a completed fetch+store operation.
///
/// Returns None if operation is still in progress.
/// Returns the result and clears storage when complete.

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
