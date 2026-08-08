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

/// Validate a backup database file without touching the global engine.
/// Opens the file read-only and returns JSON: {"schema_version", "athlete_id", "activity_count"}.
#[uniffi::export]
pub fn validate_backup_database(path: String) -> Result<String, crate::VeloqError> {
    use rusqlite::{Connection, OpenFlags};

    let conn =
        Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| {
            crate::VeloqError::Database {
                msg: format!("Cannot open backup: {}", e),
            }
        })?;

    let schema_version: String = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "0".to_string());

    let athlete_id: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = '__athlete_id'",
            [],
            |row| row.get(0),
        )
        .ok();

    let activity_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .unwrap_or(0);

    let metadata = serde_json::json!({
        "schema_version": schema_version,
        "athlete_id": athlete_id,
        "activity_count": activity_count,
    });
    Ok(metadata.to_string())
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
pub fn start_fetch_and_store(activity_ids: Vec<String>, sport_types: Vec<ActivitySportMapping>) {
    use crate::elapsed_ms;
    use std::collections::HashMap;
    init_logging();

    let ffi_start = Instant::now();
    let activity_count = activity_ids.len();
    info!(
        "[RUST: start_fetch_and_store] FFI called with {} activities",
        activity_count
    );

    // Credentials are held by the sync service, never passed per call. Without
    // one there is nothing to fetch, so settle the progress + result contract
    // immediately rather than spawning a thread that can only fail.
    let Ok(fetcher) = crate::http::ActivityFetcher::from_credentials() else {
        info!("[RUST: start_fetch_and_store] No credentials set");
        crate::http::reset_download_progress(activity_count as u32);
        store_fetch_and_store_result(FetchAndStoreResult {
            synced_ids: vec![],
            failed_ids: activity_ids,
            total: activity_count as u32,
            success_count: 0,
            total_points: 0,
            fetch_time_ms: 0,
            storage_time_ms: 0,
            total_time_ms: 0,
        });
        crate::http::finish_download_progress();
        return;
    };

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

    // Clear any previous results. Recover from a poisoned lock instead of
    // aborting (panic=abort): a poisoned FETCH_AND_STORE_RESULT only means a
    // prior writer panicked, the inner Option is still safe to read/replace.
    FETCH_AND_STORE_RESULT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();

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

        // Runs on the shared process runtime instead of building a throwaway
        // 4-thread runtime per call.

        // Fetch GPS data
        let fetch_start = Instant::now();
        let fetch_results =
            crate::runtime::block_on(fetcher.fetch_activity_maps(activity_ids_clone.clone(), None));
        let fetch_success_count = fetch_results.iter().filter(|r| r.success).count();
        info!(
            "[RUST: start_fetch_and_store] Fetch complete: {}/{} successful ({} ms)",
            fetch_success_count,
            fetch_results.len(),
            elapsed_ms(fetch_start)
        );

        // Store directly in persistent engine (NO FFI round-trip!)
        use crate::persistence::sections::conditioning;
        let storage_start = Instant::now();
        let mut synced_ids = Vec::new();
        let mut failed_ids = Vec::new();
        let mut total_points: usize = 0;
        let mut total_attached_portions: u32 = 0;
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

                            // Store directly in engine, then attach: junction
                            // rows against the existing catalogue so visits
                            // and laps are current while the download runs.
                            // New sections wait for conditioning.
                            let (stored, attached_portions) =
                                crate::persistence::with_persistent_engine(|engine| {
                                    let ok = engine
                                        .add_activity(result.activity_id.clone(), coords, sport)
                                        .is_ok();
                                    let portions = if ok {
                                        engine.attach_stored_activity(&result.activity_id).1
                                    } else {
                                        0
                                    };
                                    (ok, portions)
                                })
                                .unwrap_or((false, 0));
                            total_attached_portions += attached_portions;

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
                                // Conditioning cadence: during a long
                                // backfill, a detection run fires every
                                // CONDITIONING_BATCH_ADDS stores so the
                                // catalogue grows while the download runs.
                                conditioning::note_stored(1);
                                conditioning::maybe_condition_backfill();
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

        // Time streams for the activities that landed. TypeScript used to
        // fetch these itself, concurrently with this download; doing it here
        // keeps every request behind the one governor and leaves the section
        // maths with nothing left to fetch.
        if !synced_ids.is_empty() {
            let missing = crate::persistence::with_persistent_engine(|engine| {
                engine.get_activities_missing_time_streams(&synced_ids)
            })
            .unwrap_or_default();
            for activity_id in missing {
                match crate::runtime::block_on(crate::net::endpoints::fetch_time_stream(
                    fetcher.transport(),
                    &activity_id,
                    crate::governor::Lane::Backfill,
                )) {
                    Ok(times) if !times.is_empty() => {
                        crate::persistence::with_persistent_engine(|engine| {
                            engine.set_time_streams_flat(&[activity_id.clone()], &times, &[0]);
                        });
                    }
                    Ok(_) => {}
                    Err(e) => info!(
                        "[RUST: start_fetch_and_store] Time stream {} failed: {}",
                        activity_id, e
                    ),
                }
            }

            // Attach batch tail: one regroup (ingest marked groups dirty) or
            // one indicator recompute for the whole batch, never per activity.
            // Runs after the time streams land so lap times are timed, not
            // recomputed on the next sync.
            crate::persistence::with_persistent_engine(|engine| {
                engine.attach_finalize(total_attached_portions)
            });
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
                let mut guard = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                *guard = Some(h);
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
    });
}

/// Storage for fetch+store results

static FETCH_AND_STORE_RESULT: std::sync::Mutex<Option<FetchAndStoreResult>> =
    std::sync::Mutex::new(None);

fn store_fetch_and_store_result(result: FetchAndStoreResult) {
    let mut guard = FETCH_AND_STORE_RESULT
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *guard = Some(result);
}

/// Take the result from a completed fetch+store operation.
///
/// Returns None if operation is still in progress.
/// Returns the result and clears storage when complete.

#[uniffi::export]
pub fn take_fetch_and_store_result() -> Option<FetchAndStoreResult> {
    init_logging();

    let result = FETCH_AND_STORE_RESULT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();

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

/// Run section detection on arbitrary GPS traces without the persistent engine.
///
/// Used for illustrations and previews. Takes JSON-encoded inputs and returns
/// JSON-encoded FrequentSection array.
#[uniffi::export]
pub fn detect_sections_standalone(
    tracks_json: String,
    sport_types_json: String,
    config_json: String,
) -> Result<String, crate::VeloqError> {
    let tracks: Vec<(String, Vec<GpsPoint>)> = serde_json::from_str(&tracks_json)
        .map_err(|e| crate::VeloqError::ParseError { msg: e.to_string() })?;
    let sport_types: std::collections::HashMap<String, String> =
        serde_json::from_str(&sport_types_json)
            .map_err(|e| crate::VeloqError::ParseError { msg: e.to_string() })?;
    let config: tracematch::SectionConfig = serde_json::from_str(&config_json)
        .map_err(|e| crate::VeloqError::ParseError { msg: e.to_string() })?;

    let groups = if matches!(
        config.detection_method,
        tracematch::DetectionMethod::DensityGrid
    ) {
        let match_config = tracematch::MatchConfig {
            min_route_distance: 100.0,
            endpoint_threshold: 500.0,
            max_distance_diff_ratio: 0.8,
            ..tracematch::MatchConfig::default()
        };
        let sigs: Vec<_> = tracks
            .iter()
            .filter_map(|(id, pts)| tracematch::RouteSignature::from_points(id, pts, &match_config))
            .collect();
        tracematch::group_signatures(&sigs, &match_config)
    } else {
        vec![]
    };

    let sections = tracematch::detect_sections(&tracks, &sport_types, &groups, &config);
    serde_json::to_string(&sections)
        .map_err(|e| crate::VeloqError::ParseError { msg: e.to_string() })
}
