//! FFI bindings for mobile platforms (iOS/Android).
//!
//! This module provides the UniFFI bindings that expose Rust functionality
//! to Kotlin and Swift. All FFI functions are prefixed with `ffi_` to avoid
//! naming conflicts with the internal API.

use crate::init_logging;
use crate::objects::observer::Announcement;
use log::info;

/// How many leftover time streams are asked for at once.
///
/// Only activities outside the stream retention window reach here: a widened
/// fetch carries `time` with the track and stores it there. The governor paces
/// the requests either way, so this bounds the memory a chunk holds rather
/// than the rate.
const TIME_STREAM_CONCURRENCY: usize = 25;
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

/// Ask the running fetch-and-store to stop. Returns whether there was one.
///
/// Cooperative and scoped to the run: the loop checks between activities, so
/// the one in flight finishes and lands, and the attach tail still runs over
/// whatever did. The flag is cleared by the reset every run makes, so a cancel
/// cannot outlive the download it was aimed at.
#[uniffi::export]
pub fn cancel_fetch_and_store() -> bool {
    crate::http::cancel_download()
}

#[uniffi::export]
pub fn get_download_progress() -> DownloadProgressResult {
    let (completed, total, active) = crate::http::get_download_progress();
    DownloadProgressResult {
        completed,
        total,
        active,
    }
}

/// Progress for one fetch run, by the id `start_fetch_and_store` returned.
///
/// `get_download_progress` answers for the queue head and reports active for
/// any non-empty queue, so a caller whose own run has already finished kept
/// reading active for as long as somebody else's held the slot, and its screen
/// sat on a bar counting someone else's activities. A run that has left the
/// queue reads inactive here, whatever is still downloading.
#[uniffi::export]
pub fn get_fetch_run_progress(run: u64) -> DownloadProgressResult {
    let (completed, total, active) = crate::http::run_download_progress(run);
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
    pub start_date: Option<i64>,
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
    pub newest_activity: Option<i64>,
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
        newest_activity,
        supported_schema_version: crate::persistence::SUPPORTED_SCHEMA_VERSION,
    })
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

/// Store one downloaded track, attach it to the catalogue, then announce it.
///
/// Returns whether the track landed and how many portions attached. The
/// announcement is made after `with_persistent_engine` returns: the binding
/// blocks this thread until JavaScript answers, and a listener reading the
/// engine under the write lock would deadlock.
fn store_downloaded_track(
    activity_id: &str,
    coords: Vec<GpsPoint>,
    sport: String,
    streams: &[crate::net::types::StreamDto],
    times: &[u32],
) -> (bool, u32) {
    let elevation_state = elevation_state_of(&coords);

    // Store directly in engine, then attach: junction rows against the
    // existing catalogue so visits and laps are current while the download
    // runs. New sections wait for conditioning.
    let (stored, attached_portions) = crate::persistence::with_persistent_engine(|engine| {
        let ok = engine
            .add_activity(activity_id.to_string(), coords, sport)
            .is_ok();
        if ok {
            // The insert replaces the row and resets the column, so
            // provenance is recorded after the points land.
            if let Err(e) =
                engine.record_elevation_state(&[(activity_id.to_string(), elevation_state)])
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
                engine.store_time_streams_flat(&[activity_id.to_string()], times, &[0]);
            }
        }
        let portions = if ok {
            engine.attach_stored_activity(activity_id).1
        } else {
            0
        };
        (ok, portions)
    })
    .unwrap_or((false, 0));

    if stored {
        crate::objects::observer::notify(Announcement::GpsTrackStored(activity_id.to_string()));
        // Announced with the write lock released, the same reason the track is.
        if !times.is_empty() {
            crate::objects::observer::notify(Announcement::TimeStreamsStored(vec![
                activity_id.to_string(),
            ]));
        }
    }

    (stored, attached_portions)
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

/// Start one fetch+store run and answer its id.
///
/// The id is what `take_fetch_and_store_result` reads back with. Three callers
/// start runs, a silent push arriving during a foreground sync is ordinary, and
/// before the id they shared one result slot and took each other's answers.
#[uniffi::export]
pub fn start_fetch_and_store(
    activity_ids: Vec<String>,
    sport_types: Vec<ActivitySportMapping>,
) -> u64 {
    use crate::elapsed_ms;
    use std::collections::HashMap;
    init_logging();

    let ffi_start = Instant::now();
    let run = next_fetch_run();
    let activity_count = activity_ids.len();
    info!(
        "[RUST: start_fetch_and_store] FFI called with {} activities (run {})",
        activity_count, run
    );

    // Credentials are held by the sync service, never passed per call. Without
    // one there is nothing to fetch, so settle the progress + result contract
    // immediately rather than spawning a thread that can only fail.
    let Ok(fetcher) = crate::http::ActivityFetcher::from_credentials() else {
        info!("[RUST: start_fetch_and_store] No credentials set");
        store_fetch_run_result(
            run,
            FetchAndStoreResult {
                synced_ids: vec![],
                failed_ids: activity_ids,
                total: activity_count as u32,
                success_count: 0,
                total_points: 0,
            },
        );
        return run;
    };

    // Build sport type lookup, and alongside it the set of activities inside
    // the stream retention window, which is what the fetch widens for.
    let sport_map_start = Instant::now();
    // The setting and the clock are read once for the whole batch. Asking the
    // engine per row ran a `SELECT` and a `Utc::now` apiece, under the write
    // lock, for a window that cannot move mid-sync.
    let retention = crate::persistence::with_persistent_engine(|engine| {
        (
            engine.stream_retention_days(),
            chrono::Utc::now().timestamp(),
        )
    });
    let wide_ids: std::collections::HashSet<String> = match retention {
        Some((days, now)) => sport_types
            .iter()
            .filter(|m| {
                crate::persistence::streams::inside_stream_window_at(days, now, m.start_date)
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
    crate::http::enqueue_download(run, activity_ids.len() as u32);

    info!(
        "[RUST: start_fetch_and_store] Spawning background thread ({} ms)",
        elapsed_ms(ffi_start)
    );

    let activity_ids_clone = activity_ids.clone();

    // Spawn background thread
    std::thread::spawn(move || {
        // The run leaves the queue on the way out of this thread however it
        // leaves. A panic unwinds this one thread and the process carries on,
        // so the tail below is not reached and the only consumer polls forever.
        // Waiting for the head serialises the three callers: a map tap landing
        // during a background download runs after it rather than over it.
        let _slot = crate::http::hold_download_slot(run);
        let thread_start = Instant::now();
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
        let (result_tx, result_rx) = std::sync::mpsc::channel::<crate::http::ActivityMapResult>();
        let fetch_ids = activity_ids_clone.clone();
        // Its own fetcher over a clone of the same transport, so the pooled
        // client, the governor and the retry policy are still shared and the
        // time-stream pass below keeps the one it was given.
        let downloader = crate::http::ActivityFetcher::with_transport(fetcher.transport().clone());
        let fetch = std::thread::spawn(move || {
            crate::runtime::block_on(downloader.fetch_activity_maps_into(
                fetch_ids,
                wide_ids,
                None,
                move |result| {
                    // A send that fails means the storing loop has stopped,
                    // which is a cancel: the result is dropped rather than
                    // queued for nobody.
                    result_tx.send(result).ok();
                },
            ));
        });

        // Store directly in persistent engine (NO FFI round-trip!)
        use crate::persistence::sections::conditioning;
        let storage_start = Instant::now();
        let mut synced_ids = Vec::new();
        let mut failed_ids = Vec::new();
        let mut total_points: usize = 0;
        let mut total_attached_portions: u32 = 0;
        let mut fetch_success_count = 0usize;
        let num_results = activity_ids_clone.len();

        // PERF ASSESSMENT: Storage is currently SEQUENTIAL (one activity at a time)
        // SQLite doesn't support concurrent writes, but we could batch inserts
        info!(
            "[RUST: PERF] Storage: processing up to {} activities SEQUENTIALLY (SQLite limitation)",
            num_results
        );

        for (idx, result) in result_rx.into_iter().enumerate() {
            if result.success {
                fetch_success_count += 1;
            }
            // Between activities, never inside one: a track stops being half
            // written here, and the rows already stored stay whole.
            if crate::http::download_cancelled(run) {
                info!(
                    "[RUST: start_fetch_and_store] Cancelled after {}/{} activities",
                    idx, num_results
                );
                break;
            }
            let activity_start = Instant::now();
            // The same gate the single-activity path uses, so the two cannot
            // drift on what counts as a usable track.
            match usable_track(&result) {
                Ok(coords) => {
                    {
                        {
                            total_points += coords.len();

                            // Get sport type
                            let sport = sport_map
                                .get(&result.activity_id)
                                .cloned()
                                .unwrap_or_else(|| "Ride".to_string());

                            // Capture point count before moving coords
                            let point_count = coords.len();

                            let (stored, attached_portions) = store_downloaded_track(
                                &result.activity_id,
                                coords,
                                sport,
                                &result.streams,
                                &result.times,
                            );
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
                        }
                    }
                }
                Err(_) => failed_ids.push(result.activity_id),
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
            // A chunk at a time, fetched together rather than one after the
            // other. Serially this was one round trip per activity on the tail
            // of the sync, after the concurrent batch had already finished.
            // The chunk is what bounds the memory: a two-hour ride at 1 Hz is
            // about 29 KB of `u32`, so a whole 500-activity pass held in one
            // go would be tens of megabytes for no reason.
            for chunk in missing.chunks(TIME_STREAM_CONCURRENCY) {
                if crate::http::download_cancelled(run) {
                    info!("[RUST: start_fetch_and_store] Cancelled before the remaining streams");
                    break;
                }
                let fetched = crate::runtime::block_on(async {
                    let requests = chunk.iter().map(|activity_id| {
                        let transport = fetcher.transport().clone();
                        async move {
                            let result = crate::net::endpoints::fetch_time_stream(
                                &transport,
                                activity_id,
                                crate::governor::Lane::Backfill,
                            )
                            .await;
                            (activity_id.clone(), result)
                        }
                    });
                    futures::future::join_all(requests).await
                });
                for (activity_id, result) in fetched {
                    match result {
                        // An empty answer is stored as a zero-length row, the
                        // same as the backfill lane does. This request asked
                        // for one activity's `time` and upstream said there is
                        // none, so the row records that the question was put
                        // and the activity leaves the missing list for good.
                        Ok(times) => {
                            let stored = crate::persistence::with_persistent_engine(|engine| {
                                engine.store_time_streams_flat(
                                    &[activity_id.clone()],
                                    &times,
                                    &[0],
                                );
                            });
                            // Announced with the engine lock released, and only
                            // when the write landed.
                            if stored.is_some() {
                                crate::objects::observer::notify(Announcement::TimeStreamsStored(
                                    vec![activity_id.clone()],
                                ));
                            } else {
                                crate::objects::sync::discarded("time_stream", &activity_id);
                            }
                        }
                        Err(e) => info!(
                            "[RUST: start_fetch_and_store] Time stream {} failed: {}",
                            activity_id, e
                        ),
                    }
                }
            }

            // Attach batch tail: one regroup (ingest marked groups dirty) or
            // one indicator recompute for the whole batch, never per activity.
            // Runs after the time streams so lap times are real, not estimated.
            crate::persistence::with_persistent_engine(|engine| {
                engine.attach_finalize(total_attached_portions)
            });
            // Sync-end cadence: a batch too small for the backfill threshold
            // still gets its detection run, started here rather than by the
            // app after the fact.
            conditioning::condition_pending();
        }

        // The fetch thread is done once the channel closed, but a cancel drops
        // the receiver first, so join it rather than leave it detached against
        // a run this one has already reported on.
        let _ = fetch.join();
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
pub fn take_fetch_and_store_result(run: u64) -> Option<FetchAndStoreResult> {
    init_logging();

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
/// trigger stamps the app version on a zero and the cutover trigger reads one
/// as permission to cut, so an absent engine or a locked database has to reach
/// the caller as the null its delegate already handles.
#[uniffi::export]
pub fn get_elevation_backfill_remaining() -> Result<u32, crate::VeloqError> {
    let remaining = crate::objects::error::with_engine(|e| e.elevation_backfill_remaining())?
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

/// Ask the stream backfill to stop. It ends at its next batch boundary, so the
/// activities already stored stay stored.
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
    let remaining = crate::objects::error::with_engine(|e| {
        e.stream_backfill_remaining(crate::net::stream_backfill::STREAM_ATTEMPT_LIMIT)
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
    }
}

/// What a poller sees while the stream backfill runs and after it settles.
#[derive(Debug, Clone, uniffi::Record)]
pub struct StreamBackfillProgress {
    /// One of idle, fetching, complete, partial, stopped, failed.
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
    /// idle, draining, archiving, detecting, diffing, complete or failed.
    pub phase: String,
    /// Whether a run holds the slot right now.
    pub running: bool,
}

/// Start the cutover on a background thread. Returns whether a run was
/// started: false means no engine, not owed, or already running. A full cut is
/// a cold detect over the whole library, so it must never be driven from the
/// calling thread.
#[uniffi::export]
pub fn start_detector_cutover() -> bool {
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
    let s = crate::persistence::with_persistent_engine(|e| e.change_card_support());
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

/// The stored cutover diff payload, if any.
#[uniffi::export]
pub fn get_cutover_diff() -> Option<String> {
    crate::persistence::with_persistent_engine(|e| e.cutover_diff()).flatten()
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
#[uniffi::export]
pub fn fetch_and_index_activity(
    activity_id: String,
    sport_type: String,
) -> Result<crate::FfiIndexActivitySummary, crate::VeloqError> {
    init_logging();
    let started = Instant::now();

    let fetcher = crate::http::ActivityFetcher::from_credentials().map_err(|msg| {
        crate::VeloqError::NotFound {
            msg: format!("credentials: {}", msg),
        }
    })?;

    // One id, and narrow: the extra series a wide fetch brings are for the
    // chart screens, and this call is paying a push's budget for a track and
    // an index. `fetch_activity_maps` resolves the upstream id itself.
    let mut results = crate::runtime::block_on(fetcher.fetch_activity_maps(
        vec![activity_id.clone()],
        Default::default(),
        None,
    ));
    let result = results.pop().ok_or_else(|| crate::VeloqError::NotFound {
        msg: format!("no result for {}", activity_id),
    })?;

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
    let (stored, _attached) = store_downloaded_track(
        &activity_id,
        coords,
        sport_type,
        &result.streams,
        &result.times,
    );
    if !stored {
        return Err(crate::VeloqError::Database {
            msg: format!("store failed for {}", activity_id),
        });
    }

    let summary = crate::persistence::with_persistent_engine(|engine| {
        engine.index_new_activity(&activity_id)
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
        /// (`net/types.rs:174-179`) drops a non-finite coordinate and one
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

    use super::{elevation_state_of, store_downloaded_track, track_points};
    use crate::objects::observer::{EngineObserver, set_observer};
    use crate::persistence::{
        ELEVATION_STATE_FETCHED, ELEVATION_STATE_UNAVAILABLE, PERSISTENT_ENGINE,
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
    }

    impl EngineObserver for TrackRecorder {
        fn gps_track_stored(&self, activity_id: String) {
            // `try_write` and not `with_persistent_engine`: an announcement
            // made under the lock must fail this test, not hang it.
            let (free, points) = match PERSISTENT_ENGINE.try_write() {
                Ok(mut guard) => {
                    let points = guard
                        .as_mut()
                        .and_then(|engine| engine.get_gps_track(&activity_id))
                        .map(|track| track.len())
                        .unwrap_or(0);
                    (true, points)
                }
                Err(_) => (false, 0),
            };
            self.seen
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((activity_id, free, points));
        }

        fn sync_progress(&self) {}
        fn sync_settled(&self) {}
        fn body_stored(&self, _kind: String, _activity_id: String) {}
        fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
        fn fit_parsed(&self, _activity_id: String) {}
        fn detection_applied(&self) {}
        fn tiles_generated(&self) {}
        fn backfill_phase(&self, _phase: String) {}
        fn preview_phase(&self, _phase: String) {}
        fn cutover_settled(&self) {}
        fn preview_finished(&self) {}
    }

    fn downloaded_track(seed: f64) -> Vec<GpsPoint> {
        (0..8)
            .map(|i| GpsPoint::new(46.2 + seed + f64::from(i) * 0.001, 7.35 + seed))
            .collect()
    }

    #[test]
    fn a_downloaded_track_is_announced_with_the_lock_released() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("gps_announce.db");
        let recorder = TrackRecorder::new();
        set_observer(Some(recorder.clone()));

        let (stored, _portions) =
            store_downloaded_track("a1", downloaded_track(0.0), "Ride".into(), &[], &[]);
        set_observer(None);

        assert!(stored, "the fixture track must store");
        assert_eq!(
            recorder.seen(),
            vec![("a1".to_string(), true, 8)],
            "the announcement names the activity, leaves the write lock free and follows the commit"
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
        let (stored, _portions) =
            store_downloaded_track("a1", downloaded_track(0.0), "Ride".into(), &[], &times);

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

        store_downloaded_track("a1", downloaded_track(0.0), "Ride".into(), &[], &[]);

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
        store_downloaded_track("a1", track, "Ride".into(), &[], &long);

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

        store_downloaded_track("a1", downloaded_track(0.0), "Ride".into(), &[], &[]);
        store_downloaded_track("a1", downloaded_track(0.5), "Ride".into(), &[], &[]);
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
