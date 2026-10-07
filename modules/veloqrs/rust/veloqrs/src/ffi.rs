//! FFI bindings for mobile platforms (iOS/Android).
//!
//! This module provides the UniFFI bindings that expose Rust functionality
//! to Kotlin and Swift. All FFI functions are prefixed with `ffi_` to avoid
//! naming conflicts with the internal API.

use std::time::Instant;

use log::info;
use tracematch::GpsPoint;

use crate::init_logging;
use crate::objects::observer::Announcement;

use crate::objects::sync::TIME_STREAM_CONCURRENCY;

async fn park_track_auth_failure(
    result: &crate::http::ActivityMapResult,
    transport: &crate::net::Transport,
    athlete_id: &str,
) {
    if result.error.as_deref() == Some("unauthorized") {
        crate::objects::park_auth_expired(transport, athlete_id).await;
    }
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

/// Check a credential and report the athlete it belongs to, without storing it.
///
/// Standalone rather than a method on the engine, because a sign-in screen has
/// no engine: the layout opens one only once the athlete is authenticated, so
/// the engine-object form answered `engineUnavailable` on every fresh install
/// and the screen rendered that as "Failed to connect". Nothing here reads the
/// database. The transport is built from the process base URL, the runtime is
/// built on first use, and a rejected candidate deliberately leaves the sync
/// service's own state alone, since it is not an expired session.
#[uniffi::export]
pub async fn validate_credentials(
    method: String,
    secret: String,
) -> crate::objects::FfiCallOutcome {
    crate::objects::sync::validate_credentials_detached(method, secret).await
}

/// Ask one fetch-and-store run to stop. Returns whether that run was still in
/// the queue.
///
/// Cooperative and scoped to the run: the loop checks between activities, so
/// the one in flight finishes and lands, and the attach tail still runs over
/// whatever did. The flag belongs to that run's queue entry and ends with the run, so a
/// cancel cannot reach a later download.
#[uniffi::export]
pub fn cancel_fetch_and_store(run: f64) -> bool {
    crate::http::cancel_download(crate::ffi_types::uint_from_wire(run))
}

/// Progress for one fetch run, by the id `start_fetch_and_store` returned.
///
/// The global read answers for the queue head and reports active for
/// any non-empty queue, so a caller whose own run has already finished kept
/// reading active for as long as somebody else's held the slot, and its screen
/// sat on a bar counting someone else's activities. A run that has left the
/// queue reads inactive here, whatever is still downloading.
#[uniffi::export]
pub fn get_fetch_run_progress(run: f64) -> DownloadProgressResult {
    let (completed, total, active) =
        crate::http::run_download_progress(crate::ffi_types::uint_from_wire(run));
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
}

/// Sport type mapping for activities.

#[derive(Debug, Clone, uniffi::Record)]
pub struct ActivitySportMapping {
    pub activity_id: String,
    pub sport_type: String,
    /// Start of the activity, epoch seconds, or `None` when the caller does
    /// not know it. It decides whether the sync downloads every series or only
    /// the three the track needs, and the engine cannot supply it:
    /// `activities.start_date` is filled by the metrics sync, which lands
    /// after this one on a first run.
    pub start_date: Option<f64>,
}

/// What a picked backup file says about itself, read without touching the
/// global engine.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiBackupValidation {
    /// The file's own schema version, as it stores it. `"0"` when the file
    /// carries no `schema_info` row at all.
    pub schema_version: String,
    /// Who the backup belongs to, or `None` for a file that stored no athlete.
    pub athlete_id: Option<String>,
    pub activity_count: u32,
    /// What the athlete recognises the file by. `None` for a backup whose
    /// activities carry no date, which reads as "unknown" rather than as new.
    pub newest_activity: Option<f64>,
    /// This build's own version, not the file's. It is the only honest thing
    /// to compare a backup against: the live database is the other candidate
    /// and a fresh install cannot read one.
    pub supported_schema_version: i32,
}

/// Validate a backup database file without touching the global engine.
///
/// Opens the file read-only. A record rather than a JSON document, so a field
/// renamed here is a compile error in TypeScript rather than a valid backup
/// reported as invalid at runtime.
#[uniffi::export]
pub fn validate_backup_database(path: String) -> Result<FfiBackupValidation, crate::VeloqError> {
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

    // What the athlete recognises the file by. Null for a backup whose
    // activities carry no date, which reads as "unknown" rather than as new.
    let newest_activity: Option<i64> = conn
        .query_row("SELECT MAX(date) FROM activity_metrics", [], |row| {
            row.get(0)
        })
        .unwrap_or(None);

    Ok(FfiBackupValidation {
        schema_version,
        athlete_id,
        activity_count: activity_count.max(0) as u32,
        newest_activity: newest_activity.map(|v| v as f64),
        supported_schema_version: crate::persistence::SUPPORTED_SCHEMA_VERSION,
    })
}

/// Convert a SQLite backup to the record format through a migrated copy.
#[uniffi::export]
pub async fn convert_legacy_database_to_record_backup(
    source_path: String,
    dest_path: String,
) -> Result<(), crate::VeloqError> {
    crate::runtime::ASYNC_RUNTIME
        .spawn_blocking(move || {
            crate::persistence::record_backup::convert_legacy_database(&source_path, &dest_path)
        })
        .await
        .unwrap_or_else(|e| Err(format!("Backup conversion thread died: {e}")))
        .map_err(|msg| crate::VeloqError::Database { msg })
}

/// Stored points for one fetched track.
///
/// `elevations` shares the index space of `latlngs`, so each coordinate reads
/// its own elevation and a coordinate rejected by the validity filter takes its
/// elevation with it instead of shifting the rest. A missing or non-finite
/// elevation leaves the point without one, never at zero.
pub(crate) fn track_points(
    latlngs: &[[f64; 2]],
    elevations: Option<&[Option<f64>]>,
) -> Vec<GpsPoint> {
    latlngs
        .iter()
        .enumerate()
        .filter_map(|(i, p)| {
            let lat = p[0];
            let lng = p[1];
            if !crate::net::types::is_storable(lat, lng) {
                return None;
            }
            Some(
                match elevations
                    .and_then(|e| e.get(i).copied().flatten())
                    .filter(|e| e.is_finite())
                {
                    Some(ele) => GpsPoint::with_elevation(lat, lng, ele),
                    None => GpsPoint::new(lat, lng),
                },
            )
        })
        .collect()
}

/// Provenance for a stored track. It follows the points the engine keeps, not
/// the series the response offered, so a track left flat by an unusable
/// altitude series reads as unavailable rather than fetched.
pub(crate) fn elevation_state_of(points: &[GpsPoint]) -> u8 {
    if points.iter().any(|p| p.elevation.is_some()) {
        crate::persistence::ELEVATION_STATE_FETCHED
    } else {
        crate::persistence::ELEVATION_STATE_UNAVAILABLE
    }
}

/// Why a fetched activity cannot be ingested, when it cannot.
///
/// Named rather than collapsed into a bool, because a caller woken by a push
/// has one activity and one chance to say something about it: "the server
/// refused" and "this ride has no GPS" want different notifications, and
/// today's batch path discards both by skipping the row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TrackRefusal {
    /// The fetch itself failed. Carries what the transport said.
    Fetch(String),
    /// The response carried no `latlng` series at all: an indoor ride, a
    /// manual entry, a session recorded without GPS.
    NoTrack,
    /// There is a series and it is too short to be a line. Two points is the
    /// floor everything downstream assumes.
    TooShort,
}

/// The points a fetched activity can be stored as, or why it cannot.
///
/// Pure, so the decision the batch path makes inline at three separate `if`s
/// can be tested without a network, an engine or a runtime, and so the single
/// and batch paths cannot drift on what counts as a usable track.
pub(crate) fn usable_track(
    result: &crate::http::ActivityMapResult,
) -> Result<Vec<GpsPoint>, TrackRefusal> {
    if !result.success {
        return Err(TrackRefusal::Fetch(
            result
                .error
                .clone()
                .unwrap_or_else(|| "unknown".to_string()),
        ));
    }
    let Some(latlngs) = result.latlngs.as_deref() else {
        return Err(TrackRefusal::NoTrack);
    };
    if latlngs.len() < 2 {
        return Err(TrackRefusal::TooShort);
    }
    let coords = track_points(latlngs, result.elevations.as_deref());
    // A series long enough to be a line can still filter down to nothing:
    // `is_storable` drops a point outside the world or at the null island.
    if coords.len() < 2 {
        return Err(TrackRefusal::TooShort);
    }
    Ok(coords)
}

/// Whether a refusal is a download that failed, or an activity with no track
/// to download.
///
/// Only the first is retried and reported. An indoor session, or a walk too
/// short to be a line, answers the same way on every run, and a notice that
/// says it "didn't download" and that the next refresh will try again is
/// wrong on both counts: it came back every launch for one thirteen-second
/// walk.
pub(crate) fn counts_as_failure(refusal: &TrackRefusal) -> bool {
    matches!(refusal, TrackRefusal::Fetch(_))
}

/// The refusal the engine records, when it is a final answer. A failed fetch
/// says nothing about the activity and is never recorded, so it stays a
/// candidate.
pub(crate) fn final_refusal(
    refusal: &TrackRefusal,
) -> Option<crate::persistence::TrackRefusalKind> {
    match refusal {
        TrackRefusal::Fetch(_) => None,
        TrackRefusal::NoTrack => Some(crate::persistence::TrackRefusalKind::NoTrack),
        TrackRefusal::TooShort => Some(crate::persistence::TrackRefusalKind::TooShort),
    }
}

/// Store one downloaded track, attach it to the catalogue, then announce it.
///
/// Returns whether the track landed, how many portions attached and the engine
/// install that stored it. `None` means the run's install has closed.
/// The announcement follows the engine lock:
/// the binding blocks this thread until JavaScript answers, and a listener
/// reading the engine under the write lock would deadlock.
fn store_downloaded_track(
    install: u64,
    activity_id: &str,
    coords: Vec<GpsPoint>,
    series: crate::persistence::ElevationSeries,
    sport: String,
    streams: &[crate::net::types::StreamDto],
    times: &[u32],
) -> Option<(bool, u32, u64)> {
    store_track(
        install,
        activity_id,
        coords,
        series,
        sport,
        streams,
        times,
        true,
    )
}

/// `store_downloaded_track` with the attach optional. A caller that indexes
/// the activity straight afterwards stores without it, because the index
/// attaches once itself and a second match rewrites the same junction rows.
#[allow(clippy::too_many_arguments)]
pub(crate) fn store_track(
    install: u64,
    activity_id: &str,
    coords: Vec<GpsPoint>,
    series: crate::persistence::ElevationSeries,
    sport: String,
    streams: &[crate::net::types::StreamDto],
    times: &[u32],
    attach: bool,
) -> Option<(bool, u32, u64)> {
    let elevation_state = elevation_state_of(&coords);
    let elevation_source = crate::persistence::elevation_source_of(&coords, series);

    // Store directly in engine, then attach: junction rows against the
    // existing catalogue so visits and laps are current while the download
    // runs. New sections wait for conditioning.
    let (stored, attached_portions, time_stream_persisted) =
        crate::persistence::with_persistent_engine_for(install, |engine| {
            let mut time_stream_persisted = false;
            let added = engine.add_activity(activity_id.to_string(), coords, sport);
            let ok = added.is_ok();
            let track_changed = added.is_ok_and(|changed| !changed.is_empty());
            if ok {
                // The insert replaces the row and resets the column, so
                // provenance is recorded after the points land.
                if let Err(e) = engine
                    .record_elevation_state(&[(activity_id.to_string(), elevation_state)])
                    .and_then(|()| {
                        engine
                            .record_elevation_source(&[(activity_id.to_string(), elevation_source)])
                    })
                {
                    log::warn!(
                        "[Elevation] {} stored without provenance: {}",
                        activity_id,
                        e
                    );
                }
                // Empty unless the fetch was widened. The track is already down,
                // so a failure here costs the series and not the activity.
                if !streams.is_empty()
                    && let Err(e) = engine.store_activity_streams(activity_id, streams)
                {
                    log::warn!("[Streams] {} stored without its series: {}", activity_id, e);
                }
                // The wide response already carried `time` in this same index
                // space. Dropping it left every activity just stored named by
                // `get_activities_missing_time_streams`, and the pass behind this
                // one fetched the heaviest series in the response a second time,
                // one activity at a time. Empty for a narrow fetch, which carries
                // no `time` at all and still owes that pass.
                if !times.is_empty() {
                    // Deferred: the attach below fills this activity's lap times
                    // at insert, and the batch's backfill runs once in
                    // `attach_finalize`.
                    time_stream_persisted = !engine
                        .store_time_streams_flat(&[activity_id.to_string()], times, &[0])
                        .is_empty();
                }
            }
            let portions = if ok && attach {
                engine.attach_after_store(activity_id, track_changed)
            } else {
                0
            };
            (ok, portions, time_stream_persisted)
        })?;

    if stored {
        crate::objects::observer::notify(Announcement::GpsTrackStored(activity_id.to_string()));
        // Announced with the write lock released, the same reason the track is.
        if time_stream_persisted {
            crate::objects::observer::notify(Announcement::TimeStreamsStored(vec![
                activity_id.to_string(),
            ]));
        }
    }

    Some((stored, attached_portions, install))
}

/// Start one fetch+store run and answer its id.
///
/// The id is what `take_fetch_and_store_result` reads back with. Three callers
/// start runs, a silent push arriving during a foreground sync is ordinary, and
/// before the id they shared one result slot and took each other's answers.
#[uniffi::export]
pub fn start_fetch_and_store(
    activity_ids: Vec<String>,
    sport_types: Vec<ActivitySportMapping>,
    priority: crate::http::DownloadPriority,
) -> f64 {
    init_logging();
    let run = next_fetch_run();
    // Credentials are held by the sync service, never passed per call. Without
    // one there is nothing to fetch, so settle the progress + result contract
    // immediately rather than spawning a thread that can only fail.
    // The athlete is read with the transport, so the run is gated on the one
    // whose credential it carries.
    let Some(Ok((transport, athlete_id))) = crate::objects::current_session() else {
        info!("[RUST: start_fetch_and_store] No credentials set");
        store_fetch_run_result(
            run,
            FetchAndStoreResult {
                synced_ids: vec![],
                total: activity_ids.len() as u32,
                failed_ids: activity_ids,
                success_count: 0,
                total_points: 0,
            },
        );
        return run as f64;
    };
    start_fetch_and_store_run(
        run,
        activity_ids,
        sport_types,
        priority,
        crate::http::ActivityFetcher::with_transport(transport),
        Some(athlete_id),
    ) as f64
}

#[cfg(test)]
pub(crate) fn start_fetch_and_store_with_fetcher(
    activity_ids: Vec<String>,
    sport_types: Vec<ActivitySportMapping>,
    priority: crate::http::DownloadPriority,
    fetcher: crate::http::ActivityFetcher,
) -> f64 {
    start_fetch_and_store_run(
        next_fetch_run(),
        activity_ids,
        sport_types,
        priority,
        fetcher,
        None,
    ) as f64
}

/// `signed_in_as` is the athlete whose credential the fetcher carries. The run
/// stops dispatching, storing and asking for time streams once that athlete is
/// no longer the one signed in, the way a cancel stops it. Only the test seam
/// above passes `None`, for a fetcher aimed at a mock with no credential held.
fn start_fetch_and_store_run(
    run: u64,
    activity_ids: Vec<String>,
    sport_types: Vec<ActivitySportMapping>,
    priority: crate::http::DownloadPriority,
    fetcher: crate::http::ActivityFetcher,
    signed_in_as: Option<String>,
) -> u64 {
    use crate::elapsed_ms;
    use std::collections::HashMap;

    let signed_in = move || {
        signed_in_as
            .as_deref()
            .is_none_or(crate::objects::sync::still_signed_in)
    };

    let ffi_start = Instant::now();
    info!(
        "[RUST: start_fetch_and_store] FFI called with {} activities (run {})",
        activity_ids.len(),
        run
    );
    let install = crate::persistence::engine_install();

    // Build sport type lookup, and alongside it the set of activities inside
    // the stream retention window, which is what the fetch widens for.
    let sport_map_start = Instant::now();
    // The setting and the clock are read once for the whole batch. Asking the
    // engine per row ran a `SELECT` and a `Utc::now` apiece, under the write
    // lock, for a window that cannot move mid-sync. It is one settings row, so
    // it comes through the read pool and does not wait behind a sync page
    // holding the write lock. An install that moved since `install` was read
    // is a wipe in progress, and widens nothing, as the locked read did.
    let retention = crate::objects::error::with_reader(|conn| {
        (
            crate::persistence::streams::pooled::retention_days(conn),
            chrono::Utc::now().timestamp(),
        )
    })
    .ok()
    .filter(|_| crate::persistence::engine_install() == install);
    let wide_ids: std::collections::HashSet<String> = match retention {
        Some((days, now)) => sport_types
            .iter()
            .filter(|m| {
                crate::persistence::streams::inside_stream_window_at(
                    days,
                    now,
                    m.start_date.map(|v| v as i64),
                )
            })
            .map(|m| m.activity_id.clone())
            .collect(),
        None => Default::default(),
    };
    let sport_map: HashMap<String, String> = sport_types
        .into_iter()
        .map(|m| (m.activity_id, m.sport_type))
        .collect();
    info!(
        "[RUST: start_fetch_and_store] Built sport map with {} entries ({} ms)",
        sport_map.len(),
        elapsed_ms(sport_map_start)
    );

    // Join the queue here rather than on the fetch thread, so a caller holding
    // a run id already reads as busy the first time it polls.
    crate::http::enqueue_download(run, activity_ids.len() as u32, priority);

    info!(
        "[RUST: start_fetch_and_store] Spawning background thread ({} ms)",
        elapsed_ms(ffi_start)
    );

    let activity_ids_clone = activity_ids.clone();

    // Spawn background thread
    crate::threads::spawn_named("veloq-gps", move || {
        // The run leaves the queue on the way out of this thread however it
        // leaves. A panic unwinds this one thread and the process carries on,
        // so the tail below is not reached and the only consumer polls forever.
        // Waiting for the head serialises the three callers: a map tap landing
        // during a background download runs after it rather than over it.
        let _slot = crate::http::hold_download_slot(run);
        let thread_start = Instant::now();
        if crate::http::download_cancelled(run) || crate::persistence::engine_install() != install {
            store_fetch_run_result(
                run,
                FetchAndStoreResult {
                    synced_ids: vec![],
                    failed_ids: vec![],
                    total: 0,
                    success_count: 0,
                    total_points: 0,
                },
            );
            return;
        }
        info!(
            "[RUST: start_fetch_and_store] Thread started for {} activities",
            activity_ids.len()
        );

        // Runs on the shared process runtime instead of building a throwaway
        // 4-thread runtime per call.

        // Fetch GPS data. The results come down a channel as they land rather
        // than back as one `Vec`: 490 activities at 5,000 points is roughly
        // 80 MB of tracks plus half a megabyte of series apiece, and collecting
        // them first held all of it in the window before a single row was
        // written, then lost the lot to a kill. Storage now runs alongside the
        // download.
        let fetch_start = Instant::now();
        // Store directly in persistent engine (NO FFI round-trip!)
        use crate::persistence::sections::conditioning;
        // Each store sweeps its tiles and would ask for a pass as the sweep
        // ends. The tail below starts the one pass the whole run owes.
        let tile_passes = crate::persistence::tiles::defer_tile_passes();
        let storage_start = Instant::now();
        let mut synced_ids = Vec::new();
        let mut failed_ids = Vec::new();
        let mut total_points: usize = 0;
        let mut total_attached_portions: u32 = 0;
        let mut fetch_success_count = 0usize;
        let mut auth_checked = false;
        let mut install_closed = false;
        let num_results = activity_ids_clone.len();

        // PERF ASSESSMENT: Storage is currently SEQUENTIAL (one activity at a time)
        // SQLite doesn't support concurrent writes, but we could batch inserts
        info!(
            "[RUST: PERF] Storage: processing up to {} activities SEQUENTIALLY (SQLite limitation)",
            num_results
        );

        // A bulk run asks the attempt store about every id, so a track that
        // failed is remembered by the engine and backs off on its schedule. A
        // run for one activity somebody is waiting on is not held back by it.
        let uses_store = priority == crate::http::DownloadPriority::Bulk;
        let mut offered = activity_ids_clone.clone();
        let mut pass = 0u32;

        'passes: loop {
            pass += 1;
            let mut backing_off: Vec<String> = Vec::new();
            let mut to_fetch = offered.clone();
            if uses_store {
                let Some(claims) = crate::objects::tracks::claim_tracks(
                    install,
                    &offered,
                    crate::persistence::attempts::now_ms(),
                ) else {
                    install_closed = true;
                    break 'passes;
                };
                to_fetch = claims.taken;
                backing_off = claims.backing_off;
                // Ids that only just failed free on the store's own schedule,
                // so a later pass waits for that rather than for a timer here.
                if to_fetch.is_empty()
                    && pass > 1
                    && let Some(frees_at) = claims.frees_at
                {
                    let wait = frees_at - crate::persistence::attempts::now_ms();
                    if wait <= crate::objects::tracks::MAX_RETRY_WAIT_MS {
                        pass -= 1;
                        let ready =
                            Instant::now() + std::time::Duration::from_millis(wait.max(0) as u64);
                        while Instant::now() < ready
                            && !crate::http::download_cancelled(run)
                            && signed_in()
                        {
                            std::thread::sleep(std::time::Duration::from_millis(50));
                        }
                        if crate::http::download_cancelled(run) || !signed_in() {
                            break 'passes;
                        }
                        continue 'passes;
                    }
                }
            }
            // Still owed, and reported so, but not asked for in this pass.
            failed_ids.extend(backing_off);
            if to_fetch.is_empty() {
                break 'passes;
            }

            let (result_tx, result_rx) = std::sync::mpsc::channel::<(
                crate::http::ActivityMapResult,
                tokio::sync::OwnedSemaphorePermit,
            )>();
            let fetch_ids = to_fetch.clone();
            let fetch_signed_in = signed_in.clone();
            let pass_wide = wide_ids.clone();
            // Its own fetcher over a clone of the same transport, so the pooled
            // client, the governor and the retry policy are still shared and the
            // time-stream pass below keeps the one it was given.
            let downloader =
                crate::http::ActivityFetcher::with_transport(fetcher.transport().clone());
            let fetch = crate::threads::spawn_named("veloq-gps-fetch", move || {
                crate::runtime::block_on(downloader.fetch_activity_maps_into(
                    run,
                    fetch_ids,
                    pass_wide,
                    None,
                    fetch_signed_in,
                    move |result, permit| {
                        // A send that fails means the storing loop has stopped,
                        // which is a cancel: the result is dropped rather than
                        // queued for nobody.
                        result_tx.send((result, permit)).ok();
                    },
                ));
            });
            let mut pass_failed: Vec<(String, String)> = Vec::new();
            let mut pass_landed: Vec<String> = Vec::new();
            let mut pass_refused: Vec<(String, crate::persistence::TrackRefusalKind)> = Vec::new();

            for (idx, (result, _permit)) in result_rx.into_iter().enumerate() {
                // Between activities, never inside one: a track stops being half
                // written here, and the rows already stored stay whole.
                if crate::http::download_cancelled(run) {
                    info!(
                        "[RUST: start_fetch_and_store] Cancelled after {}/{} activities",
                        idx, num_results
                    );
                    break;
                }
                // A sign-out ends the run like a cancel: what lands after it
                // belongs to an athlete the app has been asked to forget.
                if !signed_in() {
                    info!(
                        "[RUST: start_fetch_and_store] Signed out after {}/{} activities",
                        idx, num_results
                    );
                    break;
                }
                if crate::persistence::engine_install() != install {
                    install_closed = true;
                    break;
                }
                if !auth_checked && result.error.as_deref() == Some("unauthorized") {
                    auth_checked = true;
                    if let Some(Ok((transport, athlete_id))) = crate::objects::current_session() {
                        crate::runtime::block_on(park_track_auth_failure(
                            &result,
                            &transport,
                            &athlete_id,
                        ));
                    }
                }
                if result.success {
                    fetch_success_count += 1;
                }
                let activity_start = Instant::now();
                // The same gate the single-activity path uses, so the two cannot
                // drift on what counts as a usable track.
                match usable_track(&result) {
                    Ok(coords) => {
                        {
                            {
                                // Get sport type
                                let sport = sport_map
                                    .get(&result.activity_id)
                                    .cloned()
                                    .unwrap_or_else(|| "Ride".to_string());

                                // Capture point count before moving coords
                                let point_count = coords.len();

                                let Some((stored, attached_portions, store_install)) =
                                    store_downloaded_track(
                                        install,
                                        &result.activity_id,
                                        coords,
                                        crate::persistence::ElevationSeries::upstream(
                                            result.elevation_corrected,
                                        ),
                                        sport,
                                        &result.streams,
                                        &result.times,
                                    )
                                else {
                                    install_closed = true;
                                    break;
                                };
                                total_points += point_count;
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
                                    pass_landed.push(result.activity_id.clone());
                                    synced_ids.push(result.activity_id);
                                    // Conditioning cadence: during a long
                                    // backfill, a detection run fires every
                                    // CONDITIONING_BATCH_ADDS stores so the
                                    // catalogue grows while the download runs.
                                    conditioning::note_stored_for(store_install, 1);
                                    if crate::persistence::engine_install() == install {
                                        conditioning::maybe_condition_backfill();
                                    }
                                } else {
                                    pass_failed.push((
                                        result.activity_id,
                                        "the track did not store".to_string(),
                                    ));
                                }
                            }
                        }
                    }
                    Err(refusal) => {
                        if counts_as_failure(&refusal) {
                            let error = result.error.clone().unwrap_or_default();
                            pass_failed.push((result.activity_id, error));
                        } else {
                            // No track to get is a final answer, not a failure,
                            // and it is remembered so the next run does not ask.
                            if let Some(kind) = final_refusal(&refusal) {
                                pass_refused.push((result.activity_id.clone(), kind));
                            }
                            pass_landed.push(result.activity_id);
                        }
                    }
                }
            }

            // The fetch thread is done once the channel closed, but a cancel drops
            // the receiver first, so join it rather than leave it detached against
            // a run this one has already reported on.
            let _ = fetch.join();
            let stopped = install_closed || crate::http::download_cancelled(run) || !signed_in();
            let retry = !stopped
                && pass < crate::objects::tracks::MAX_TRACK_PASSES
                && pass_failed
                    .iter()
                    .any(|(_, error)| !crate::objects::tracks::network_absent(error));
            if uses_store {
                let unattempted: Vec<String> = to_fetch
                    .iter()
                    .filter(|id| {
                        !pass_landed.contains(id) && !pass_failed.iter().any(|(f, _)| f == *id)
                    })
                    .cloned()
                    .collect();
                // Only the pass that ends the run counts a failure, so a run
                // that retries is one settled run.
                let settled = if retry || stopped {
                    Vec::new()
                } else {
                    crate::objects::tracks::settled_failures(&pass_failed)
                };
                crate::objects::tracks::release_tracks(
                    install,
                    &pass_landed,
                    &pass_refused,
                    &pass_failed,
                    &settled,
                    &unattempted,
                    crate::persistence::attempts::now_ms(),
                );
            }
            offered = pass_failed.iter().map(|(id, _)| id.clone()).collect();
            if !retry {
                failed_ids.append(&mut offered);
                break 'passes;
            }
        }

        // Time streams for the activities that landed. TypeScript used to
        // fetch these itself, concurrently with this download; doing it here
        // keeps every request behind the one governor and leaves the section
        // maths with nothing left to fetch.
        if !synced_ids.is_empty() && !install_closed {
            let missing = crate::persistence::with_persistent_engine_for(install, |engine| {
                engine.get_activities_missing_time_streams(&synced_ids)
            });
            let missing = missing.unwrap_or_else(|| {
                install_closed = true;
                Vec::new()
            });
            // A chunk at a time, fetched together rather than one after the
            // other. Serially this was one round trip per activity on the tail
            // of the sync, after the concurrent batch had already finished.
            // The chunk is what bounds the memory: a two-hour ride at 1 Hz is
            // about 29 KB of `u32`, so a whole 500-activity pass held in one
            // go would be tens of megabytes for no reason.
            'time_streams: for chunk in missing.chunks(TIME_STREAM_CONCURRENCY) {
                if crate::http::download_cancelled(run) {
                    info!("[RUST: start_fetch_and_store] Cancelled before the remaining streams");
                    break;
                }
                if !signed_in() {
                    info!("[RUST: start_fetch_and_store] Signed out before the remaining streams");
                    break;
                }
                if crate::persistence::engine_install() != install {
                    install_closed = true;
                    break;
                }
                // The URL names the activity upstream, the chunk names it locally.
                let upstream = crate::persistence::with_persistent_engine_for(install, |engine| {
                    engine.intervals_ids(chunk)
                })
                .unwrap_or_default();
                let fetched = crate::runtime::block_on(async {
                    let requests = chunk.iter().map(|activity_id| {
                        let transport = fetcher.transport().clone();
                        let named = upstream.get(activity_id).unwrap_or(activity_id).clone();
                        async move {
                            let result = crate::net::endpoints::fetch_time_stream(
                                &transport,
                                &named,
                                crate::governor::Lane::Backfill,
                            )
                            .await;
                            (activity_id.clone(), result)
                        }
                    });
                    futures::future::join_all(requests).await
                });
                // One refusal speaks for the rest of the list, as it does for
                // the tracks: the chunk already fetched is kept, and nothing
                // further is asked for.
                let mut refused = false;
                for (activity_id, result) in fetched {
                    if crate::http::download_cancelled(run) || !signed_in() {
                        break 'time_streams;
                    }
                    if crate::persistence::engine_install() != install {
                        install_closed = true;
                        break 'time_streams;
                    }
                    match result {
                        // An empty answer is stored as a zero-length row, the
                        // same as the backfill lane does. This request asked
                        // for one activity's `time` and upstream said there is
                        // none, so the row records that the question was put
                        // and the activity leaves the missing list for good.
                        Ok(times) => {
                            let stored =
                                crate::persistence::with_persistent_engine_for(install, |engine| {
                                    engine.store_time_streams_flat(
                                        std::slice::from_ref(&activity_id),
                                        &times,
                                        &[0],
                                    )
                                });
                            // Announced with the engine lock released, and only
                            // when the write landed.
                            if stored.is_none() {
                                install_closed = true;
                                break 'time_streams;
                            } else if stored.is_some_and(|p| !p.is_empty()) {
                                crate::objects::observer::notify(Announcement::TimeStreamsStored(
                                    vec![activity_id.clone()],
                                ));
                            }
                        }
                        Err(crate::net::transport::NetError::Unauthorized) => refused = true,
                        Err(e) => info!(
                            "[RUST: start_fetch_and_store] Time stream {} failed: {}",
                            activity_id, e
                        ),
                    }
                }
                if refused {
                    if let Some(Ok((transport, athlete_id))) = crate::objects::current_session() {
                        crate::runtime::block_on(crate::objects::park_auth_expired(
                            &transport,
                            &athlete_id,
                        ));
                    }
                    break;
                }
            }

            // Attach batch tail: one regroup (ingest marked groups dirty) or
            // one indicator recompute for the whole batch, never per activity.
            // Runs after the time streams so lap times are real, not estimated.
            let finalised = if install_closed {
                None
            } else {
                crate::persistence::with_persistent_engine_for(install, |engine| {
                    engine.attach_finalize(total_attached_portions)
                })
            };
            if finalised.is_none() {
                install_closed = true;
            }
            // Sync-end cadence: a batch too small for the backfill threshold
            // still gets its detection run, started here rather than by the
            // app after the fact.
            if finalised.is_some() {
                conditioning::condition_pending_for_install(install);
            }
        }

        info!(
            "[RUST: start_fetch_and_store] Fetch complete: {}/{} successful ({} ms)",
            fetch_success_count,
            num_results,
            elapsed_ms(fetch_start)
        );

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
        let total_time = elapsed_ms(thread_start);

        // Spawn background heatmap tile generation with the new GPS data
        if success_count > 0 && !install_closed {
            crate::persistence::with_persistent_engine_for(install, |engine| {
                engine.mark_heatmap_dirty();
                // The ground the athlete's own regions need, pinned, on the
                // same trigger and for the same reason: a sync that stored a
                // track is what moves the bounds both passes key on.
                crate::basemap::seed_ground_background(engine.activity_bounds());
                let centres = engine.preview_centres(u32::MAX);
                crate::basemap::seed_terrain_background(
                    centres
                        .into_iter()
                        .map(|centre| (centre.lat, centre.lng))
                        .collect(),
                );
                engine.start_tile_pass();
            });
        }
        // After the start and outside the lock: a pass held back during the
        // run is asked for now, and the pass just started refuses it.
        drop(tile_passes);

        // File the result under this run, so only the caller that started it
        // can read it back.
        store_fetch_run_result(
            run,
            FetchAndStoreResult {
                synced_ids,
                failed_ids,
                total,
                success_count,
                total_points: total_points as u32,
            },
        );

        info!(
            "[RUST: start_fetch_and_store] Thread complete ({} ms)",
            total_time
        );
    });

    run
}

/// Results of finished fetch+store runs, keyed by the run that produced them.
///
/// There was one slot for the whole process and three callers: the foreground
/// GPS sync, the headless push task and the map's single-activity download. A
/// silent push arriving during a sync is ordinary, and whichever of them read
/// first took the other's result and acted on it, while the second read nothing
/// and reported a download that had really happened as a failure. The map's
/// caller never reads at all, so it left one behind for the next reader to
/// find.
///
/// A run id is minted per start and the result is filed under it, so a caller
/// can only ever read back what its own start produced.
static FETCH_AND_STORE_RESULTS: std::sync::Mutex<Vec<(u64, FetchAndStoreResult)>> =
    std::sync::Mutex::new(Vec::new());

static NEXT_FETCH_RUN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// How many finished-but-unread results are kept. A caller that unmounts before
/// reading leaves one behind, so this is bounded rather than growing for the
/// life of the process. The oldest goes first: a result nobody has read after
/// eight more runs is not going to be read.
const MAX_UNREAD_FETCH_RESULTS: usize = 8;

fn next_fetch_run() -> u64 {
    NEXT_FETCH_RUN.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

fn store_fetch_run_result(run: u64, result: FetchAndStoreResult) {
    let mut guard = FETCH_AND_STORE_RESULTS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    guard.retain(|(id, _)| *id != run);
    guard.push((run, result));
    while guard.len() > MAX_UNREAD_FETCH_RESULTS {
        guard.remove(0);
    }
}

fn take_fetch_run_result(run: u64) -> Option<FetchAndStoreResult> {
    let mut guard = FETCH_AND_STORE_RESULTS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let at = guard.iter().position(|(id, _)| *id == run)?;
    Some(guard.remove(at).1)
}

/// Take the result of one fetch+store run.
///
/// `run` is what `start_fetch_and_store` answered. None means that run has not
/// finished, which is what a caller polls on; it never means another caller's
/// run has finished.

#[uniffi::export]
pub fn take_fetch_and_store_result(run: f64) -> Option<FetchAndStoreResult> {
    init_logging();

    let run = crate::ffi_types::uint_from_wire(run);
    let result = take_fetch_run_result(run);

    if let Some(ref r) = result {
        info!(
            "[RUST: take_fetch_and_store_result] Run {} returning result: {} synced, {} failed",
            run,
            r.success_count,
            r.failed_ids.len()
        );
    }
    // Don't log when returning None - this is called frequently during polling

    result
}

// =============================================================================
// Elevation backfill
// =============================================================================

/// Progress of the one-shot elevation backfill.
///
/// `phase` is the terminal signal as well as the live one: "complete" when
/// nothing is outstanding, "partial" when the pass finished but activities
/// remain for a later run, "failed" when it could not proceed at all.
///
/// The single re-cut that follows a conversion runs detached and reports
/// through `DetectionManager::get_progress`, so this record covers the download
/// alone rather than duplicating a second detection progress surface.
#[derive(Debug, Clone, uniffi::Record)]
pub struct ElevationBackfillProgress {
    /// idle, fetching, complete, partial or failed.
    pub phase: String,
    /// Activities this run has finished with.
    pub completed: u32,
    /// Activities the run started with.
    pub total: u32,
    /// Activities whose fetch failed, so a later run retries them.
    pub failed: u32,
    /// Whole percent of the queue handled. An empty queue reads 100.
    pub percent: u32,
}

/// Tell the engine what TypeScript sees on the network.
///
/// The network lifecycle is Rust's, and nothing in the crate can see the
/// network itself, so this is the whole of its connectivity input. Call it
/// from the same place that calls `onlineManager.setOnline`, on every
/// transition and on foreground, so there is one debounce and one edge rather
/// than two.
///
/// The value is advisory and only ever a reason to refuse work: a state
/// nobody has refreshed for fifteen minutes expires back to "try", and an
/// install that never calls this behaves exactly as it did before.
#[uniffi::export]
pub fn set_network_online(online: bool) {
    init_logging();
    crate::net::connectivity::set_online(online);
}

/// What was last pushed to [`set_network_online`], and how many seconds ago.
///
/// `null` means nothing has ever been pushed. For the debug screen and for
/// tests that need to see the push landed, not for scheduling: everything
/// that schedules reads the state in Rust.
#[uniffi::export]
pub fn get_network_push() -> Option<NetworkPush> {
    crate::net::connectivity::last_push().map(|(online, age)| NetworkPush {
        online,
        age_seconds: age.as_secs().try_into().unwrap_or(u32::MAX),
    })
}

/// The last connectivity state TypeScript pushed, with its age.
#[derive(Debug, Clone, uniffi::Record)]
pub struct NetworkPush {
    /// What was pushed.
    pub online: bool,
    /// Seconds since the push. Past the staleness window the engine ignores
    /// the value and tries anyway.
    pub age_seconds: u32,
}

/// Start the elevation backfill on a background thread.
///
/// The verdict names the refusal, so an empty queue reads as the job finished
/// rather than as a failure to start. Safe to call on every launch.
#[uniffi::export]
pub fn start_elevation_backfill() -> crate::objects::FfiStartOutcome {
    init_logging();
    crate::net::elevation_backfill::start_elevation_backfill()
}

/// Pause the elevation backfill for the rest of this process.
///
/// The pass in flight ends at its next batch and reports `paused`, and no
/// launch or resume attempt starts another until the app is reopened. Nothing
/// is persisted, so a forgotten pause can never strand the migration. The phase
/// is what says it is paused, so there is nothing to return.
#[uniffi::export]
pub fn pause_elevation_backfill() {
    init_logging();
    crate::net::elevation_backfill::pause_elevation_backfill()
}

/// Lift a pause on the elevation backfill and start a pass again.
///
/// The pause only a new process could clear left detection held and the
/// detector cutover unable to run, with a force-quit as the only exit. Returns
/// whether there was a pause to lift.
#[uniffi::export]
pub fn resume_elevation_backfill() -> bool {
    init_logging();
    crate::net::elevation_backfill::resume_elevation_backfill()
}

/// Whether the elevation backfill is paused in this process.
#[uniffi::export]
pub fn is_elevation_backfill_paused() -> bool {
    crate::net::elevation_backfill::elevation_backfill_paused()
}

/// How many stored tracks the backfill still has to ask upstream about.
/// Zero means the library has been fully asked, so the launch trigger can
/// stop attempting runs for this install.
///
/// Raises rather than answering zero when it cannot answer at all. The launch
/// trigger stamps the app version on a zero and the cutover start reads one
/// as permission to cut (it answers held while the queue is non-empty), so an
/// absent engine or a locked database has to reach the caller as the null its
/// delegate already handles.
#[uniffi::export]
pub fn get_elevation_backfill_remaining() -> Result<u32, crate::VeloqError> {
    let remaining = crate::objects::error::with_reader(|conn| {
        crate::net::elevation_backfill::pooled_elevation_backfill_remaining(conn)
    })?
    .map_err(|e| crate::VeloqError::Database {
        msg: format!("{}", e),
    })?;
    Ok(remaining.try_into().unwrap_or(u32::MAX))
}

/// Read the elevation backfill's progress. Safe to poll at any time.
#[uniffi::export]
pub fn get_elevation_backfill_progress() -> ElevationBackfillProgress {
    let snapshot = crate::net::elevation_backfill::backfill_progress();
    ElevationBackfillProgress {
        phase: snapshot.phase.to_string(),
        completed: snapshot.completed,
        total: snapshot.total,
        failed: snapshot.failed,
        percent: snapshot.percent(),
    }
}

/// Start the stream backfill on a background thread.
///
/// Unlike the elevation backfill this is not fired at launch: it is tens of
/// megabytes on whatever connection the phone has, so a screen starts it.
#[uniffi::export]
pub fn start_stream_backfill() -> crate::objects::FfiStartOutcome {
    init_logging();
    crate::net::stream_backfill::start_stream_backfill()
}

/// Record the athlete's yes to a large automatic download and start the pass.
#[uniffi::export]
pub fn consent_stream_backfill() -> crate::objects::FfiStartOutcome {
    init_logging();
    crate::net::stream_backfill::consent_stream_backfill()
}

/// Ask the stream backfill to stop. It ends at its next batch boundary, so the
/// activities already stored stay stored. Stopping a pass held for the
/// athlete's answer is the no.
#[uniffi::export]
pub fn stop_stream_backfill() {
    init_logging();
    crate::net::stream_backfill::stop_stream_backfill()
}

/// How many activities the stream backfill still has to ask upstream about.
/// Zero means the library is fully stocked for the window as it stands.
///
/// Raises rather than answering zero when it cannot answer at all: a screen
/// that offers the backfill reads this, and an absent engine must not read as
/// the job being done.
#[uniffi::export]
pub fn get_stream_backfill_remaining() -> Result<u32, crate::VeloqError> {
    let remaining = crate::objects::error::with_reader(|conn| {
        crate::persistence::streams::pooled::backfill_remaining(
            conn,
            crate::net::stream_backfill::STREAM_ATTEMPT_LIMIT,
        )
    })?
    .map_err(|e| crate::VeloqError::Database {
        msg: format!("{}", e),
    })?;
    Ok(remaining.try_into().unwrap_or(u32::MAX))
}

/// Read the stream backfill's progress. Safe to poll at any time.
#[uniffi::export]
pub fn get_stream_backfill_progress() -> StreamBackfillProgress {
    let snapshot = crate::net::stream_backfill::stream_backfill_progress();
    StreamBackfillProgress {
        phase: snapshot.phase.to_string(),
        completed: snapshot.completed,
        total: snapshot.total,
        stored: snapshot.stored,
        failed: snapshot.failed,
        percent: snapshot.percent(),
        estimate_requests: snapshot.estimate_requests,
        estimate_bytes: snapshot.estimate_bytes as f64,
    }
}

/// What a poller sees while the stream backfill runs and after it settles.
#[derive(Debug, Clone, uniffi::Record)]
pub struct StreamBackfillProgress {
    /// One of idle, fetching, complete, partial, stopped, failed,
    /// awaiting_consent.
    pub phase: String,
    /// Activities this pass has finished with, however they ended.
    pub completed: u32,
    /// Activities the pass started with.
    pub total: u32,
    /// Activities whose series landed in the store.
    pub stored: u32,
    /// Activities whose fetch failed, so the next pass asks about them again.
    pub failed: u32,
    /// Whole-percent progress. An empty queue is 100, not 0.
    pub percent: u32,
    /// Requests the held pass would make. Meaningful while awaiting consent.
    pub estimate_requests: u32,
    /// Bytes on the wire the held pass would download.
    pub estimate_bytes: f64,
}

/// Whether the Corridor-to-Unified cutover is pending.
#[uniffi::export]
pub fn is_cutover_pending() -> bool {
    crate::persistence::cutover::cutover_pending()
}

/// Whether a cutover run is currently in flight.
#[uniffi::export]
pub fn is_cutover_running() -> bool {
    crate::persistence::cutover::cutover_running()
}

/// How far a detector cutover has got. The phase is the whole story: a cut has
/// no unit of work to count, unlike the elevation queue.
#[derive(Debug, Clone, uniffi::Record)]
pub struct CutoverProgress {
    /// idle, draining, archiving, detecting, diffing, complete, failed, or
    /// failed_after_apply once the new catalogue had landed.
    pub phase: String,
    /// Whether a run holds the slot right now.
    pub running: bool,
}

/// Every background-job figure the routes and settings screens poll, in one
/// read.
///
/// Four timers used to poll four exports on the one screen, each taking the
/// engine lock on its own interval, and `get_elevation_backfill_remaining` was
/// read from three files on three schedules. This is a poller consolidation
/// and not a screen read: it carries no catalogue, nothing it holds is drawn
/// as content, and it is refreshed by a tick rather than by an announcement,
/// because progress deliberately has no observer event. The binding blocks the
/// Rust thread until JavaScript returns, so a per-item event would park the
/// worker it is reporting on.
///
/// Two figures are deliberately not here. The stored cutover diff is read once
/// when the run settles, and parsing it walks every section. The count of
/// activities awaiting a detect is a `COUNT` under the engine's write lock, so
/// a tick landing while a sync write holds it stalls the caller for as long as
/// that write runs; it changes only when activities land or a detect applies,
/// which are both announced, so it is read on those channels instead.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRoutesStatusData {
    /// The running detection, or `None` when no run holds the slot.
    pub detection: Option<crate::FfiDetectionProgress>,
    /// How the last finished detect ended: idle, complete or error. Read
    /// beside the progress rather than through `poll`, which takes the run's
    /// completion out from under the follower waiting on it.
    pub detection_outcome: String,
    pub stream: StreamBackfillProgress,
    /// Activities with no stored series, on the same terms as the elevation
    /// count: withheld while a pass runs, null when it cannot be answered.
    pub stream_remaining: Option<u32>,
    pub elevation: ElevationBackfillProgress,
    /// How many stored tracks the elevation backfill has still to ask about.
    ///
    /// `None` is "cannot answer", which is what an absent engine or a locked
    /// database gives, and the triggers read it differently from a zero: a
    /// zero is permission to stop, a null is a reason to try again. Not read
    /// while a pass is running, where the progress figures say more.
    pub elevation_remaining: Option<u32>,
    pub elevation_paused: bool,
    pub cutover: CutoverProgress,
}

/// Read every routes background-job figure at once. Safe to poll at any time.
#[uniffi::export]
pub fn get_routes_status_data() -> FfiRoutesStatusData {
    let detection = {
        let handle = crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        handle.as_ref().map(|handle| {
            let (phase, completed, total) = handle.get_progress();
            crate::FfiDetectionProgress {
                phase,
                completed,
                total,
                percent: handle.progress.get_percent(),
            }
        })
    };

    let detection_outcome = crate::objects::DetectionManager::new().last_outcome();

    let stream = get_stream_backfill_progress();
    let stream_remaining = if stream.phase == "fetching" {
        None
    } else {
        get_stream_backfill_remaining().ok()
    };

    let elevation = get_elevation_backfill_progress();
    // The count is a `COUNT(*)` over the stored tracks, so it is skipped while
    // a pass is reporting its own figures, exactly as the hook that used to
    // make two calls did.
    let elevation_remaining = if elevation.phase == "fetching" {
        None
    } else {
        get_elevation_backfill_remaining().ok()
    };

    FfiRoutesStatusData {
        detection,
        detection_outcome,
        stream,
        stream_remaining,
        elevation,
        elevation_remaining,
        elevation_paused: is_elevation_backfill_paused(),
        cutover: get_cutover_progress(),
    }
}

/// Start the cutover on a background thread, returning the start verdict.
#[uniffi::export]
pub fn start_detector_cutover() -> crate::objects::FfiStartOutcome {
    crate::persistence::cutover::start_cutover()
}

/// Ask the running cutover to stop at its next step boundary.
///
/// The cut is a cold detect over the whole library, spawned unattended at
/// launch, and the only lever before this was a force-quit, which the
/// in-flight token undid on the next launch anyway. Stopping costs the run's
/// work and nothing else: the migration is still owed and the next launch runs
/// it again from the top.
#[uniffi::export]
pub fn cancel_detector_cutover() {
    crate::persistence::cutover::cancel_cutover();
}

/// How far the running cutover has got.
#[uniffi::export]
pub fn get_cutover_progress() -> CutoverProgress {
    CutoverProgress {
        phase: crate::persistence::cutover::cutover_phase().to_string(),
        running: crate::persistence::cutover::cutover_running(),
    }
}

/// Which claims the change card may make on this build.
#[uniffi::export]
pub fn get_change_card_support() -> crate::FfiChangeCardSupport {
    let s = crate::objects::error::with_reader(|conn| {
        crate::persistence::cutover::change_card_support_from(conn).ok()
    })
    .ok()
    .flatten();
    let s = s.unwrap_or(crate::persistence::cutover::ChangeCardSupport {
        deterministic: false,
        same_result_drip_or_batch: false,
        ledger: false,
        revert: false,
        retired: false,
        pinned_survive: false,
        same_on_every_device: false,
    });
    crate::FfiChangeCardSupport {
        deterministic: s.deterministic,
        same_result_drip_or_batch: s.same_result_drip_or_batch,
        ledger: s.ledger,
        revert: s.revert,
        retired: s.retired,
        pinned_survive: s.pinned_survive,
        same_on_every_device: s.same_on_every_device,
    }
}

/// The stored cutover diff, if any.
///
/// It is persisted as JSON in a settings row, so it is parsed here rather than
/// handed across as a string for the other side to cast blind. A
/// payload that will not parse reads as no diff; a reset that will not parse is
/// dropped alone, never taking the diff it rides in.
#[uniffi::export]
pub fn get_cutover_diff() -> Option<crate::FfiCutoverDiff> {
    let json = crate::persistence::cutover::cutover_diff_payload()?;
    parse_cutover_diff(&json)
}

fn parse_cutover_diff(json: &str) -> Option<crate::FfiCutoverDiff> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(crate::FfiCutoverDiff {
        token: value.get("token")?.as_str()?.to_string(),
        counts: serde_json::from_value(value.get("counts")?.clone()).ok()?,
        settings_reset: value
            .get("settings_reset")
            .cloned()
            .and_then(|reset| serde_json::from_value(reset).ok()),
    })
}

/// Fetch one activity's track, store it, and index it against the catalogue.
///
/// One blocking call, for a caller with no run loop. A push handler in Kotlin
/// or Swift holds an activity id, a budget measured in seconds and no way to
/// poll: `start_fetch_and_store` arms a global slot and hands back a run id,
/// which is the right shape for a screen watching a progress bar and the wrong
/// one here. This returns what happened, or says why nothing did.
///
/// The three steps each already exist and were only ever composed by the batch
/// path, in a thread that reports through that slot. Composing them here is
/// what lets a native caller hold an id and get a sentence out of it.
#[cfg(test)]
pub(crate) fn fetch_and_index_activity(
    activity_id: String,
    sport_type: String,
) -> Result<crate::FfiIndexActivitySummary, crate::VeloqError> {
    fetch_and_index_activity_for(
        crate::persistence::engine_install(),
        &activity_id,
        sport_type,
    )
}

/// [`fetch_and_index_activity`] against the library a caller started in: a
/// store or index after the install has moved is refused.
pub(crate) fn fetch_and_index_activity_for(
    install: u64,
    activity_id: &str,
    sport_type: String,
) -> Result<crate::FfiIndexActivitySummary, crate::VeloqError> {
    init_logging();
    let started = Instant::now();
    let activity_id = activity_id.to_string();

    let fetcher = crate::http::ActivityFetcher::from_credentials().map_err(|msg| {
        crate::VeloqError::NotFound {
            msg: format!("credentials: {}", msg),
        }
    })?;

    let signed_in_as = crate::objects::current_session().and_then(|s| s.ok().map(|(_, id)| id));

    // One id, and narrow: the extra series a wide fetch brings are for the
    // chart screens, and this call is paying a push's budget for a track and
    // an index. `fetch_activity_maps` resolves the upstream id itself.
    let mut results = crate::runtime::block_on(fetcher.fetch_activity_maps(
        // Outside the queue: this is the push task's own one-activity fetch and
        // it speaks for no run, so nothing counts it and nothing waits on it.
        0,
        vec![activity_id.clone()],
        Default::default(),
        None,
    ));
    let result = results.pop().ok_or_else(|| crate::VeloqError::NotFound {
        msg: format!("no result for {}", activity_id),
    })?;
    if result.error.as_deref() == Some("unauthorized")
        && let Some(Ok((transport, athlete_id))) = crate::objects::current_session()
    {
        crate::runtime::block_on(park_track_auth_failure(&result, &transport, &athlete_id));
    }

    // A plain sign-out keeps the library, so the install cannot see it: the
    // credential the fetch ran on is what says nothing more may be stored.
    if !signed_in_as
        .as_deref()
        .is_some_and(crate::objects::sync::still_signed_in)
    {
        return Err(crate::VeloqError::NotInitialized);
    }

    // Every refusal is the same answer to the caller, there is no track to
    // index, and the message is which of the four it was.
    let coords = usable_track(&result).map_err(|refusal| crate::VeloqError::NotFound {
        msg: match refusal {
            TrackRefusal::Fetch(e) => e,
            TrackRefusal::NoTrack => "no track".to_string(),
            TrackRefusal::TooShort => "track too short".to_string(),
        },
    })?;

    let point_count = coords.len();
    let (stored, _attached, _install) = store_track(
        install,
        &activity_id,
        coords,
        crate::persistence::ElevationSeries::upstream(result.elevation_corrected),
        sport_type,
        &result.streams,
        &result.times,
        false,
    )
    .ok_or(crate::VeloqError::NotInitialized)?;
    if !stored {
        return Err(crate::VeloqError::Database {
            msg: format!("store failed for {}", activity_id),
        });
    }

    let summary = crate::persistence::with_persistent_engine_for(install, |engine| {
        let summary = engine.index_new_activity(&activity_id);
        // Inside the take that indexed, so this costs no second one. A
        // foreground engine in another process is now behind the file by a
        // track, a metrics row and whatever junction rows the index wrote, and
        // the token is the only thing that will tell it so. Called on this
        // path rather than only the push one because this is where the rows
        // land, and an engine that notes its own write advances what it has
        // seen, so the app's own fetch costs itself no reload.
        if let Err(e) = engine.note_external_write() {
            log::warn!(
                "[RUST: fetch_and_index_activity] {activity_id} indexed without a token: {e}"
            );
        }
        summary
    })
    .ok_or(crate::VeloqError::NotInitialized)?
    .map_err(|msg| crate::VeloqError::Database { msg })?;

    info!(
        "[RUST: fetch_and_index_activity] {} ({} points) in {} ms",
        activity_id,
        point_count,
        crate::elapsed_ms(started)
    );
    Ok(crate::FfiIndexActivitySummary::from(summary))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scenario: a push names one activity and the fetch comes back. Three
    /// answers are not a track, and a caller with one notification to write
    /// needs to tell them apart.
    mod usable_track {
        use super::*;

        fn result(latlngs: Option<Vec<[f64; 2]>>, success: bool) -> crate::http::ActivityMapResult {
            crate::http::ActivityMapResult {
                activity_id: "a1".to_string(),
                latlngs,
                elevations: None,
                elevation_corrected: false,
                body_bytes: 0,
                streams: Vec::new(),
                times: Vec::new(),
                success,
                error: if success {
                    None
                } else {
                    Some("HTTP 503".to_string())
                },
            }
        }

        #[test]
        fn a_two_point_track_is_usable() {
            let r = result(Some(vec![[-37.81, 144.96], [-37.82, 144.97]]), true);
            assert_eq!(usable_track(&r).unwrap().len(), 2);
        }

        #[test]
        fn a_failed_fetch_carries_what_the_transport_said() {
            let r = result(None, false);
            assert_eq!(
                usable_track(&r),
                Err(TrackRefusal::Fetch("HTTP 503".to_string()))
            );
        }

        #[test]
        fn a_failed_fetch_with_a_track_is_still_a_failed_fetch() {
            // A partial response must not be read as data: success is the gate.
            let r = result(Some(vec![[-37.81, 144.96], [-37.82, 144.97]]), false);
            assert!(matches!(usable_track(&r), Err(TrackRefusal::Fetch(_))));
        }

        #[test]
        fn a_failed_fetch_is_reported_and_retried() {
            assert!(counts_as_failure(&TrackRefusal::Fetch(
                "timeout".to_string()
            )));
        }

        #[test]
        fn only_a_final_refusal_is_recorded() {
            use crate::persistence::TrackRefusalKind;
            assert_eq!(final_refusal(&TrackRefusal::Fetch("timeout".into())), None);
            assert_eq!(
                final_refusal(&TrackRefusal::NoTrack),
                Some(TrackRefusalKind::NoTrack)
            );
            assert_eq!(
                final_refusal(&TrackRefusal::TooShort),
                Some(TrackRefusalKind::TooShort)
            );
        }

        #[test]
        fn an_activity_with_no_track_is_not_a_failed_download() {
            assert!(!counts_as_failure(&TrackRefusal::NoTrack));
            assert!(!counts_as_failure(&TrackRefusal::TooShort));
        }

        #[test]
        fn no_latlng_series_is_an_indoor_ride_not_a_failure() {
            assert_eq!(
                usable_track(&result(None, true)),
                Err(TrackRefusal::NoTrack)
            );
        }

        #[test]
        fn one_point_is_too_short_to_be_a_line() {
            let r = result(Some(vec![[-37.81, 144.96]]), true);
            assert_eq!(usable_track(&r), Err(TrackRefusal::TooShort));
        }

        #[test]
        fn an_empty_series_is_too_short_rather_than_absent() {
            assert_eq!(
                usable_track(&result(Some(vec![]), true)),
                Err(TrackRefusal::TooShort)
            );
        }

        /// The length check runs twice on purpose. A series long enough to be a
        /// line can filter down to nothing: `is_storable`
        /// in `net/types.rs` drops a non-finite coordinate and one
        /// outside the world, and a caller that trusted the first check would
        /// hand the engine one point or none. The null island passes that gate
        /// and is stored, which is why it is not the case used here.
        #[test]
        fn a_long_series_of_unstorable_points_is_too_short() {
            let r = result(
                Some(vec![[999.0, 999.0], [f64::NAN, 0.0], [0.0, -181.0]]),
                true,
            );
            assert_eq!(usable_track(&r), Err(TrackRefusal::TooShort));
        }

        /// And a mixed series keeps what is storable, so one bad sample does
        /// not cost the ride its map.
        #[test]
        fn one_unstorable_sample_does_not_cost_the_track() {
            let r = result(
                Some(vec![[-37.81, 144.96], [999.0, 999.0], [-37.82, 144.97]]),
                true,
            );
            assert_eq!(usable_track(&r).unwrap().len(), 2);
        }
    }

    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::{elevation_state_of, store_downloaded_track, store_track, track_points};
    use crate::objects::observer::{EngineObserver, set_observer};
    use crate::persistence::{
        ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNAVAILABLE, ElevationSeries, PERSISTENT_ENGINE,
    };
    use crate::test_globals::{init_global_engine, serial_global_state};
    use tracematch::GpsPoint;

    /// Records each announced track, and what the engine looked like from
    /// inside the announcement: whether the write lock was free, and how many
    /// points the track held.
    struct TrackRecorder {
        seen: Mutex<Vec<(String, bool, usize)>>,
    }

    impl TrackRecorder {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                seen: Mutex::new(Vec::new()),
            })
        }

        fn seen(&self) -> Vec<(String, bool, usize)> {
            self.seen.lock().unwrap_or_else(|e| e.into_inner()).clone()
        }

        /// How long a neighbour's hold is given to clear. Three orders of
        /// magnitude over the milliseconds one actually takes, and a lock this
        /// thread holds never clears however long the ceiling is.
        const FOREIGN_HOLD_CEILING: Duration = Duration::from_secs(2);

        /// The track, and whether the write lock was this thread's to take.
        fn read_track_once_free(activity_id: &str) -> (bool, usize) {
            let until = Instant::now() + Self::FOREIGN_HOLD_CEILING;
            loop {
                if let Ok(mut guard) = PERSISTENT_ENGINE.try_lock() {
                    let points = guard
                        .as_mut()
                        .and_then(|engine| engine.get_gps_track(activity_id))
                        .map(|track| track.len())
                        .unwrap_or(0);
                    return (true, points);
                }
                if Instant::now() >= until {
                    return (false, 0);
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    }

    impl EngineObserver for TrackRecorder {
        fn gps_track_stored(&self, activity_id: String) {
            // Not `with_persistent_engine`: an announcement made under the lock
            // must fail this test, not hang it. But not a single `try_write`
            // either, which answers "is this lock free right now" when the
            // question is "did the announcing thread let go of it".
            //
            // The two are told apart by waiting, not by timing. The engine
            // lock this thread still holds can never be taken again, because a
            // `Mutex` is not reentrant, so no amount of retrying will
            // find it free. A neighbour's hold is milliseconds and frees on its
            // own. So retrying up to a ceiling answers the real question and
            // still fails, rather than hanging, on the regression it guards:
            // exceeding the ceiling reports the lock busy exactly as before.
            //
            // This is why the merge gate failed twice on branches touching none
            // of this, on a box where another test's background worker held the
            // lock for the moment the announcement fired.
            let (free, points) = Self::read_track_once_free(&activity_id);
            self.seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((activity_id, free, points));
        }

        fn sync_progress(&self) {}
        fn sync_settled(&self) {}
        fn activities_stored(&self) {}
        fn body_stored(&self, _kind: String, _activity_id: String) {}
        fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
        fn gps_tracks_mutated(&self, _activity_ids: Vec<String>) {}
        fn fit_parsed(&self, _activity_id: String) {}
        fn detection_applied(&self) {}
        fn tiles_generated(&self) {}
        fn backfill_phase(&self, _phase: String) {}
        fn stream_backfill_phase(&self, _phase: String) {}
        fn preview_phase(&self, _phase: String) {}
        fn cutover_settled(&self) {}
        fn preview_finished(&self) {}
        fn recordings_changed(&self) {}
        fn upload_permission_refused(&self) {}
    }

    fn downloaded_track(seed: f64) -> Vec<GpsPoint> {
        (0..8)
            .map(|i| GpsPoint::new(46.2 + seed + f64::from(i) * 0.001, 7.35 + seed))
            .collect()
    }

    fn elevated_track(seed: f64) -> Vec<GpsPoint> {
        (0..8)
            .map(|i| {
                GpsPoint::with_elevation(
                    46.2 + seed + f64::from(i) * 0.001,
                    7.35 + seed,
                    500.0 + f64::from(i),
                )
            })
            .collect()
    }

    fn stored_source(id: &str) -> Option<u8> {
        crate::persistence::with_persistent_engine(|engine| engine.elevation_source_of_track(id))
            .expect("engine")
    }

    /// Scenario: the bulk ingest, the single fetch and the first-use step all
    /// store through here, from a response whose elevation is the corrected
    /// series, the device one, or neither.
    ///
    /// Expected behaviour: each track records the series its points carry, a
    /// track with no elevation claims none, and storing the same activity again
    /// records it again rather than leaving the reset of the replace.
    #[test]
    fn a_stored_track_records_the_series_its_elevation_came_from() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("gps_elevation_source.db");
        let install = crate::persistence::engine_install();
        let store = |id: &str, points: Vec<GpsPoint>, series: ElevationSeries| {
            store_track(install, id, points, series, "Ride".into(), &[], &[], false)
                .expect("current install")
                .0
        };

        assert!(store(
            "ridge",
            elevated_track(0.0),
            ElevationSeries::Corrected
        ));
        assert!(store(
            "valley",
            elevated_track(0.1),
            ElevationSeries::Device
        ));
        assert!(store(
            "flat",
            downloaded_track(0.2),
            ElevationSeries::Corrected
        ));

        assert_eq!(
            stored_source("ridge"),
            Some(crate::persistence::ELEVATION_SOURCE_CORRECTED)
        );
        assert_eq!(
            stored_source("valley"),
            Some(crate::persistence::ELEVATION_SOURCE_DEVICE)
        );
        assert_eq!(
            stored_source("flat"),
            Some(crate::persistence::ELEVATION_SOURCE_UNKNOWN)
        );

        assert!(store(
            "ridge",
            elevated_track(0.0),
            ElevationSeries::Corrected
        ));
        assert_eq!(
            stored_source("ridge"),
            Some(crate::persistence::ELEVATION_SOURCE_CORRECTED),
            "a re-ingest keeps the series"
        );
        assert!(store(
            "valley",
            elevated_track(0.1),
            ElevationSeries::Corrected
        ));
        assert_eq!(
            stored_source("valley"),
            Some(crate::persistence::ELEVATION_SOURCE_CORRECTED),
            "a re-ingest from the other series records that one"
        );
    }

    /// Scenario: the push path stores a track and then indexes it, and the
    /// index attaches the activity to the catalogue itself.
    /// Expected behaviour: storing without the attach writes no junction rows,
    /// and the one index that follows writes the same rows an attaching store
    /// does.
    #[test]
    fn a_store_without_attach_leaves_the_junction_rows_to_the_index() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("store_without_attach.db");
        let install = crate::persistence::engine_install();
        for id in ["seed-a", "seed-b", "seed-c"] {
            store_downloaded_track(
                install,
                id,
                downloaded_track(0.0),
                ElevationSeries::Corrected,
                "Ride".into(),
                &[],
                &[],
            )
            .expect("current install");
        }
        crate::persistence::with_persistent_engine(|engine| {
            let handle = engine.detect_sections_background();
            let (sections, _) = handle.recv().expect("the detect ran");
            engine.apply_sections(sections).unwrap();
            assert!(!engine.get_sections().is_empty(), "a catalogue to match");
        })
        .expect("engine");

        let (stored, portions, _) = store_track(
            install,
            "pushed",
            downloaded_track(0.0),
            ElevationSeries::Corrected,
            "Ride".into(),
            &[],
            &[],
            false,
        )
        .expect("current install");
        assert!(stored);
        assert_eq!(portions, 0, "no attach ran in the store");
        let after_store = crate::persistence::with_persistent_engine(|engine| {
            engine.get_sections_for_activity("pushed").len()
        })
        .expect("engine");
        assert_eq!(after_store, 0, "the store wrote no junction rows");

        let summary = crate::persistence::with_persistent_engine(|engine| {
            engine.index_new_activity("pushed").unwrap()
        })
        .expect("engine");
        assert!(summary.matched_sections >= 1, "{summary:?}");
        let after_index = crate::persistence::with_persistent_engine(|engine| {
            engine.get_sections_for_activity("pushed").len()
        })
        .expect("engine");
        assert!(after_index >= 1);
    }

    #[test]
    fn a_track_from_a_closed_install_does_not_enter_the_new_library() {
        let _serial = serial_global_state();
        let _old = init_global_engine("old-download.db");
        let install = crate::persistence::engine_install();
        let _new = init_global_engine("new-download.db");

        let stored = store_downloaded_track(
            install,
            "old-athlete",
            downloaded_track(0.0),
            ElevationSeries::Corrected,
            "Ride".into(),
            &[],
            &[],
        );

        assert!(stored.is_none(), "the old run must stop after reinstall");
        assert!(
            crate::persistence::with_persistent_engine(|engine| {
                engine.get_gps_track("old-athlete").is_none()
            })
            .expect("new engine"),
            "the new library must have no track from the old run"
        );
    }

    #[test]
    fn a_downloaded_track_is_announced_with_the_lock_released() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("gps_announce.db");
        let recorder = TrackRecorder::new();
        set_observer(Some(recorder.clone()));

        let (stored, _portions, _install) = store_downloaded_track(
            crate::persistence::engine_install(),
            "a1",
            downloaded_track(0.0),
            ElevationSeries::Corrected,
            "Ride".into(),
            &[],
            &[],
        )
        .expect("current install");
        crate::objects::observer::flush();
        set_observer(None);

        assert!(stored, "the fixture track must store");
        assert_eq!(
            recorder.seen(),
            vec![("a1".to_string(), true, 8)],
            "the announcement names the activity, leaves the write lock free and follows the commit"
        );
    }

    /// Scenario: the machine is busy. Another thread holds the engine write
    /// lock for a few milliseconds while the announcement fires.
    ///
    /// Expected behaviour: the test above still passes. It is asserting that
    /// the announcing thread released the lock, and a lock another thread holds
    /// for a moment is not that. Reading it as one is why the merge gate failed
    /// twice on branches that touch none of this.
    #[test]
    fn a_foreign_thread_holding_the_lock_is_not_an_announcement_under_it() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("gps_announce_busy.db");
        let recorder = TrackRecorder::new();
        set_observer(Some(recorder.clone()));

        // A neighbour holding the write lock as the announcement fires and
        // letting go shortly after, which is what a background worker from
        // another test does on a loaded box. Transient, not permanent: a hold
        // that never ends is the regression this guards, not this scenario.
        let taken = Arc::new(std::sync::Barrier::new(2));
        let neighbour = {
            let taken = taken.clone();
            std::thread::spawn(move || {
                let _held = PERSISTENT_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
                taken.wait();
                std::thread::sleep(Duration::from_millis(100));
            })
        };
        taken.wait();

        recorder.gps_track_stored("a1".to_string());
        neighbour.join().expect("the neighbour thread");
        crate::objects::observer::flush();
        set_observer(None);

        let (id, free, _points) = recorder
            .seen()
            .into_iter()
            .next()
            .expect("one announcement");
        assert_eq!(id, "a1");
        assert!(
            free,
            "a lock a neighbour held for a moment read as an announcement made under it"
        );
    }

    /// Scenario: a wide fetch carries `time` beside `latlng`, and the store
    /// loop dropped it. `get_activities_missing_time_streams` then named every
    /// activity just stored, and each was fetched again, serially, for the
    /// heaviest series in the response.
    #[test]
    fn a_widened_track_stores_its_time_series_with_the_points() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("gps_times.db");

        let times: Vec<u32> = (0..8).map(|i| i * 10).collect();
        let (stored, _portions, _install) = store_downloaded_track(
            crate::persistence::engine_install(),
            "a1",
            downloaded_track(0.0),
            ElevationSeries::Corrected,
            "Ride".into(),
            &[],
            &times,
        )
        .expect("current install");

        assert!(stored, "the fixture track must store");
        let missing = crate::persistence::with_persistent_engine(|engine| {
            engine.get_activities_missing_time_streams(&["a1".to_string()])
        })
        .expect("the engine is open");
        assert!(
            missing.is_empty(),
            "the second pass must find nothing to fetch again, it found {:?}",
            missing
        );
    }

    /// A narrow fetch carries no `time`, so the second pass is still what
    /// fills it and must still see the activity.
    #[test]
    fn a_narrow_track_still_owes_its_time_series() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("gps_no_times.db");

        store_downloaded_track(
            crate::persistence::engine_install(),
            "a1",
            downloaded_track(0.0),
            ElevationSeries::Corrected,
            "Ride".into(),
            &[],
            &[],
        );

        let missing = crate::persistence::with_persistent_engine(|engine| {
            engine.get_activities_missing_time_streams(&["a1".to_string()])
        })
        .expect("the engine is open");
        assert_eq!(missing, vec!["a1".to_string()]);
    }

    /// Scenario: every released 0.3.x stored the raw `time` series, which keeps
    /// the samples the `latlng` mask drops, so the stored stream is longer than
    /// its track by the number of unfixed samples. On the July export that is
    /// 587 of 733 activities. Nothing corrected it: this query asked only
    /// whether a row existed, so the sync never fetched one again.
    ///
    /// Expected behaviour: a stream whose length disagrees with its track reads
    /// as missing, which is what puts it back in front of the sync.
    #[test]
    fn a_stream_that_is_not_the_track_length_is_owed_again() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("gps_misaligned.db");

        let track = downloaded_track(0.0);
        let long: Vec<u32> = (0..(track.len() as u32 + 3)).map(|i| i * 10).collect();
        store_downloaded_track(
            crate::persistence::engine_install(),
            "a1",
            track,
            ElevationSeries::Corrected,
            "Ride".into(),
            &[],
            &long,
        );

        let missing = crate::persistence::with_persistent_engine(|engine| {
            // The store caches it in memory, and the in-memory check runs
            // first; a fresh launch reads it off disk, which is the shape this
            // is about.
            engine.forget_time_stream_for_test("a1");
            engine.get_activities_missing_time_streams(&["a1".to_string()])
        })
        .expect("the engine is open");

        assert_eq!(
            missing,
            vec!["a1".to_string()],
            "a stream in the wrong index space is owed again"
        );
    }

    #[test]
    fn a_re_ingested_track_is_announced_again() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("gps_reannounce.db");
        let recorder = TrackRecorder::new();
        set_observer(Some(recorder.clone()));

        let install = crate::persistence::engine_install();
        assert!(
            store_downloaded_track(
                install,
                "a1",
                downloaded_track(0.0),
                ElevationSeries::Corrected,
                "Ride".into(),
                &[],
                &[],
            )
            .is_some_and(|(stored, _, _)| stored)
        );
        crate::objects::observer::flush();
        assert_eq!(recorder.seen().len(), 1);
        assert_eq!(crate::persistence::engine_install(), install);
        assert!(
            store_downloaded_track(
                install,
                "a1",
                downloaded_track(0.5),
                ElevationSeries::Corrected,
                "Ride".into(),
                &[],
                &[],
            )
            .is_some_and(|(stored, _, _)| stored)
        );
        crate::objects::observer::flush();
        set_observer(None);

        let ids: Vec<String> = recorder.seen().into_iter().map(|(id, _, _)| id).collect();
        assert_eq!(ids, vec!["a1".to_string(), "a1".to_string()]);
    }

    #[test]
    fn a_track_carrying_any_elevation_reads_as_fetched() {
        let points = track_points(
            &[[46.0, 7.0], [46.1, 7.1], [46.2, 7.2]],
            Some(&[None, Some(1400.0), None]),
        );
        assert_eq!(elevation_state_of(&points), ELEVATION_STATE_FETCHED);
    }

    #[test]
    fn a_track_left_flat_reads_as_unavailable() {
        let points = track_points(&[[46.0, 7.0], [46.1, 7.1]], None);
        assert_eq!(elevation_state_of(&points), ELEVATION_STATE_UNAVAILABLE);
    }

    #[test]
    fn an_altitude_series_of_only_gaps_reads_as_unavailable() {
        // A series that arrives all-null leaves the track flat, so it is
        // provenance-unavailable rather than fetched.
        let points = track_points(&[[46.0, 7.0], [46.1, 7.1]], Some(&[None, None]));
        assert_eq!(elevation_state_of(&points), ELEVATION_STATE_UNAVAILABLE);
    }

    #[test]
    fn a_non_finite_altitude_series_reads_as_unavailable() {
        let points = track_points(
            &[[46.0, 7.0], [46.1, 7.1]],
            Some(&[Some(f64::NAN), Some(f64::INFINITY)]),
        );
        assert_eq!(elevation_state_of(&points), ELEVATION_STATE_UNAVAILABLE);
    }

    #[test]
    fn each_point_keeps_the_elevation_of_its_own_index() {
        let latlngs = [[46.10, 7.10], [46.11, 7.11], [46.12, 7.12]];
        let elevations = [Some(100.0), Some(200.0), Some(300.0)];

        let pts = track_points(&latlngs, Some(&elevations));

        assert_eq!(pts.len(), 3);
        assert_eq!(pts[0].elevation, Some(100.0));
        assert_eq!(pts[1].elevation, Some(200.0));
        assert_eq!(pts[2].elevation, Some(300.0));
    }

    #[test]
    fn a_rejected_coordinate_takes_its_own_elevation_with_it() {
        // The middle coordinate is out of range, so the surviving pair must
        // still read elevations 100 and 300, never 100 and 200.
        let latlngs = [[46.10, 7.10], [999.0, 7.11], [46.12, 7.12]];
        let elevations = [Some(100.0), Some(200.0), Some(300.0)];

        let pts = track_points(&latlngs, Some(&elevations));

        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0].elevation, Some(100.0));
        assert_eq!(pts[1].elevation, Some(300.0));
    }

    #[test]
    fn a_missing_or_non_finite_elevation_leaves_the_point_without_one() {
        let latlngs = [[46.10, 7.10], [46.11, 7.11], [46.12, 7.12]];
        let elevations = [Some(100.0), None, Some(f64::NAN)];

        let pts = track_points(&latlngs, Some(&elevations));

        assert_eq!(pts[0].elevation, Some(100.0));
        assert_eq!(pts[1].elevation, None);
        assert_eq!(pts[2].elevation, None);
    }

    #[test]
    fn no_elevation_series_yields_a_full_track_without_elevation() {
        let latlngs = [[46.10, 7.10], [46.11, 7.11]];

        let pts = track_points(&latlngs, None);

        assert_eq!(pts.len(), 2);
        assert!(pts.iter().all(|p| p.elevation.is_none()));
    }

    #[test]
    fn coordinate_validity_gates_are_unchanged() {
        let latlngs = [
            [46.10, 7.10],
            [f64::NAN, 7.11],
            [46.12, f64::INFINITY],
            [91.0, 7.13],
            [46.14, 181.0],
            [-90.0, -180.0],
        ];

        let pts = track_points(&latlngs, None);

        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0].latitude, 46.10);
        assert_eq!(pts[1].latitude, -90.0);
    }
}

#[cfg(test)]
mod fetch_and_store_results {
    use super::{
        FetchAndStoreResult, next_fetch_run, store_fetch_run_result, take_fetch_run_result,
    };
    use crate::test_globals::serial_global_state;

    fn result(synced: &str) -> FetchAndStoreResult {
        FetchAndStoreResult {
            synced_ids: vec![synced.to_string()],
            failed_ids: vec![],
            total: 1,
            success_count: 1,
            total_points: 100,
        }
    }

    /// Scenario: a silent push arrives while the foreground sync is
    /// downloading. Both callers started a fetch and both read the result,
    /// and there was one slot for the pair.
    ///
    /// Expected behaviour: a run only ever reads back what its own start
    /// produced, whatever order the two finish in.
    #[test]
    fn a_run_reads_its_own_result_and_never_another_run_s() {
        let _serial = serial_global_state();
        let foreground = next_fetch_run();
        let push = next_fetch_run();
        assert_ne!(foreground, push, "each start gets its own run");

        store_fetch_run_result(push, result("push"));

        assert!(
            take_fetch_run_result(foreground).is_none(),
            "the foreground sync must not be handed the push task's result"
        );

        store_fetch_run_result(foreground, result("foreground"));
        assert_eq!(
            take_fetch_run_result(foreground)
                .expect("its own result")
                .synced_ids,
            vec!["foreground".to_string()]
        );
        assert_eq!(
            take_fetch_run_result(push)
                .expect("still waiting")
                .synced_ids,
            vec!["push".to_string()],
            "reading one result must not consume the other"
        );
    }

    #[test]
    fn a_result_is_read_once_and_a_run_that_never_started_reads_nothing() {
        let _serial = serial_global_state();
        let run = next_fetch_run();
        store_fetch_run_result(run, result("one"));

        assert!(take_fetch_run_result(run).is_some());
        assert!(
            take_fetch_run_result(run).is_none(),
            "a result is taken, not left for the next caller to find"
        );
        assert!(take_fetch_run_result(u64::MAX).is_none());
    }

    /// A caller that unmounts before reading leaves its result behind. The
    /// map is bounded so those cannot pile up for the life of the process.
    #[test]
    fn abandoned_results_are_evicted_oldest_first() {
        let _serial = serial_global_state();
        let mut runs = Vec::new();
        for i in 0..12 {
            let run = next_fetch_run();
            store_fetch_run_result(run, result(&format!("run{i}")));
            runs.push(run);
        }

        assert!(
            take_fetch_run_result(runs[0]).is_none(),
            "the oldest abandoned result is dropped rather than held for ever"
        );
        assert!(
            take_fetch_run_result(*runs.last().unwrap()).is_some(),
            "the newest is still there for the caller that is waiting on it"
        );
    }
}

#[cfg(test)]
/// Scenario: the cutover diff is persisted as JSON in a settings row and
/// read back long after the run that wrote it, by a version of the app
/// that may not be the one that wrote it.
///
/// Expected behaviour: the counts come back typed, an older payload
/// carrying rows is read past rather than rejected, and a reset that will
/// not parse is dropped alone rather than taking the diff with it.
mod cutover_diff {
    use super::parse_cutover_diff;

    const SETTINGS: &str = r#"{"proximityThreshold":25.0,"minSectionLength":500.0,
        "maxSectionLength":20000.0,"minActivities":3,"divergenceThreshold":0.35}"#;

    fn diff_with(extra: &str) -> String {
        format!(
            r#"{{"token":"detector-v2","counts":{{"current":4,"proposed":5,"unchanged":3,
             "changed":1,"new":1,"gone":0}}{extra}}}"#
        )
    }

    #[test]
    fn reads_the_counts_and_the_reset() {
        let diff = parse_cutover_diff(&diff_with(&format!(
            r#","settings_reset":{{"previous":{SETTINGS},"current":{SETTINGS}}}"#
        )))
        .expect("a diff");

        assert_eq!(diff.token, "detector-v2");
        assert_eq!(diff.counts.proposed, 5);
        assert_eq!(diff.counts.gone, 0);
        let reset = diff.settings_reset.expect("a reset");
        assert_eq!(reset.previous.min_activities, 3);
        assert_eq!(reset.current.proximity_threshold, 25.0);
    }

    #[test]
    fn a_null_reset_is_a_diff_with_no_reset() {
        let diff = parse_cutover_diff(&diff_with(r#","settings_reset":null"#)).expect("a diff");
        assert!(diff.settings_reset.is_none());
    }

    #[test]
    fn a_half_readable_reset_is_dropped_alone() {
        let diff = parse_cutover_diff(&diff_with(
            r#","settings_reset":{"previous":{"minActivities":3}}"#,
        ))
        .expect("the diff survives its reset");
        assert_eq!(diff.counts.current, 4);
        assert!(diff.settings_reset.is_none());
    }

    #[test]
    fn an_older_payload_carrying_rows_is_read_past() {
        let diff = parse_cutover_diff(&diff_with(r#","sections":[{"id":"a"},{"id":"b"}]"#))
            .expect("a diff");
        assert_eq!(diff.counts.unchanged, 3);
    }

    #[test]
    fn nothing_readable_is_no_diff() {
        assert!(parse_cutover_diff("not json").is_none());
        assert!(parse_cutover_diff(r#"{"counts":{"current":1}}"#).is_none());
        assert!(parse_cutover_diff(r#"{"token":"t"}"#).is_none());
    }
}

#[cfg(test)]
#[path = "tests/track_auth.rs"]
mod track_auth_tests;

#[cfg(test)]
#[path = "tests/ffi_backfill.rs"]
mod ffi_backfill_tests;

#[cfg(test)]
#[path = "tests/fetch_retention.rs"]
mod fetch_retention_tests;

#[cfg(test)]
#[path = "tests/fetch_retry.rs"]
mod fetch_retry_tests;

#[cfg(test)]
#[path = "tests/cutover_reads_under_a_writer.rs"]
mod cutover_reads_under_a_writer_tests;
