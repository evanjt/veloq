//! Background section detection and application.

use crate::persistence::codec;
use crate::persistence::codec::TrackRead;
use crate::{FrequentSection, GpsPoint, SectionEvidenceCache};

/// How often a running fold checkpoints its progress at most; the last
/// cluster always does.
const CHECKPOINT_EVERY: std::time::Duration = std::time::Duration::from_secs(2);
use rusqlite::{Connection, Result as SqlResult, params};
use std::collections::{HashMap, HashSet};
use std::sync::mpsc;
use std::thread;
use tracematch::{Bounds, MatchConfig, RouteGroup, RouteSignature};

use super::super::route_identity::{RouteIdentity, load_identity, write_identity};
use super::super::{
    CacheUpdate, PersistentRouteEngine, SectionDetectionHandle, SectionDetectionProgress,
    load_groups_from_db,
};

/// A stored track that did not decode, named so it can be excluded from a
/// detection pool by id rather than counted anonymously.
pub(crate) struct CorruptTrack {
    pub activity_id: String,
    pub reason: String,
}

/// Share of unreadable rows above which a pool is treated as a read-path
/// failure rather than isolated row rot. Above the ceiling the detect is
/// abandoned and the catalogue is left as it stands, because a catalogue cut
/// over a fraction of the library is wrong rather than incomplete.
const MAX_CORRUPT_POOL_FRACTION: f64 = 0.10;

/// Fewest unreadable rows that can abandon a run. The fraction alone makes a
/// small library a cliff, where one bad blob in nine gives up on detection
/// permanently. A read-path failure takes the whole store with it and clears
/// both bars, so the floor costs nothing against the shape worth catching.
const MIN_CORRUPT_TO_ABANDON: usize = 8;

/// Seconds an abandoned pool stays abandoned while its activity ids are
/// unchanged. The abort returns before `save_processed_activity_ids`, so
/// without a window every sync reloads and re-decodes the whole store to reach
/// the same verdict. Any new or removed activity changes the digest and
/// retries at once, so a repaired library is never held off by the window.
const ABANDON_RETRY_SECONDS: i64 = 6 * 3600;

/// `schema_info` key holding the completeness of the pool the live catalogue
/// was cut over.
const POOL_INTEGRITY_KEY: &str = "detection_pool_integrity";

/// `schema_info` key holding the pool an abandoned run gave up on.
const ABANDONED_POOL_KEY: &str = "detection_abandoned_pool";

/// Number of ids named individually in a log line or a durable record.
const CORRUPT_ID_LOG_CAP: usize = 20;

/// Whether a pool with this many unreadable rows may still be cut over. Both
/// bars must be cleared to abandon: enough unreadable rows to rule out
/// isolated rot, and enough of the store to rule out a catalogue worth cutting.
fn pool_is_usable(readable: usize, corrupt: usize) -> bool {
    let total = readable + corrupt;
    if total == 0 || corrupt < MIN_CORRUPT_TO_ABANDON {
        return true;
    }
    (corrupt as f64) / (total as f64) <= MAX_CORRUPT_POOL_FRACTION
}

/// FNV-1a over the sorted activity ids. Fixed by its own arithmetic rather
/// than by the standard library, so the stored digest still names the same
/// pool after a toolchain change.
fn pool_digest(activity_ids: &[String]) -> u64 {
    let mut sorted: Vec<&str> = activity_ids.iter().map(|s| s.as_str()).collect();
    sorted.sort_unstable();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mix = |byte: u8, hash: &mut u64| {
        *hash ^= byte as u64;
        *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    };
    for id in sorted {
        for byte in id.as_bytes() {
            mix(*byte, &mut hash);
        }
        mix(0xff, &mut hash);
    }
    hash
}

/// True when this exact pool was abandoned recently enough that loading it
/// again can only reach the same verdict.
fn abandon_window_active(conn: &Connection, activity_ids: &[String]) -> bool {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![ABANDONED_POOL_KEY],
            |row| row.get(0),
        )
        .ok();
    let Some(stored) = stored else {
        return false;
    };
    let Ok(record) = serde_json::from_str::<serde_json::Value>(&stored) else {
        return false;
    };
    let digest = record["pool_digest"].as_str().unwrap_or_default();
    let at = record["abandoned_at"].as_i64().unwrap_or(0);
    let age = chrono::Utc::now().timestamp() - at;
    digest == format!("{:016x}", pool_digest(activity_ids))
        && (0..ABANDON_RETRY_SECONDS).contains(&age)
}

/// Name the pool an abandoned run gave up on, so the next sync can tell it has
/// already been decoded and rejected.
fn record_abandoned_pool(conn: &Connection, activity_ids: &[String]) {
    let value = serde_json::json!({
        "abandoned_at": chrono::Utc::now().timestamp(),
        "pool_digest": format!("{:016x}", pool_digest(activity_ids)),
        "pool_size": activity_ids.len(),
    })
    .to_string();
    if let Err(e) = conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
        params![ABANDONED_POOL_KEY, value],
    ) {
        log::error!("tracematch: [pool integrity] abandon record failed: {}", e);
    }
}

/// Drop the abandon record once a pool is usable again.
fn clear_abandoned_pool(conn: &Connection) {
    let _ = conn.execute(
        "DELETE FROM schema_info WHERE key = ?",
        params![ABANDONED_POOL_KEY],
    );
}

/// Name every excluded track and its reason, capped so a corpus-wide read
/// failure cannot flood the log.
fn log_corrupt_tracks(context: &str, readable: usize, corrupt: &[CorruptTrack]) {
    if corrupt.is_empty() {
        return;
    }
    log::error!(
        "tracematch: [{}] {} of {} stored tracks are unreadable and excluded from the pool",
        context,
        corrupt.len(),
        readable + corrupt.len()
    );
    for track in corrupt.iter().take(CORRUPT_ID_LOG_CAP) {
        log::error!(
            "tracematch: [{}] activity {} unreadable: {}",
            context,
            track.activity_id,
            track.reason
        );
    }
    if corrupt.len() > CORRUPT_ID_LOG_CAP {
        log::error!(
            "tracematch: [{}] {} further unreadable tracks not listed",
            context,
            corrupt.len() - CORRUPT_ID_LOG_CAP
        );
    }
}

/// Record how complete the pool behind the live catalogue is, so an incomplete
/// corpus is a durable fact rather than a log line that scrolls away.
/// `abandoned` says whether the run gave up on this pool or cut a catalogue
/// over it, which is the difference between an unchanged catalogue and a
/// current one. A clean pool clears the record.
fn record_pool_integrity(
    conn: &Connection,
    readable: usize,
    corrupt: &[CorruptTrack],
    abandoned: bool,
) {
    if corrupt.is_empty() {
        let _ = conn.execute(
            "DELETE FROM schema_info WHERE key = ?",
            params![POOL_INTEGRITY_KEY],
        );
        return;
    }
    let value = serde_json::json!({
        "recorded_at": chrono::Utc::now().timestamp(),
        "readable": readable,
        "corrupt": corrupt.len(),
        "abandoned": abandoned,
        "activity_ids": corrupt
            .iter()
            .take(CORRUPT_ID_LOG_CAP)
            .map(|c| c.activity_id.as_str())
            .collect::<Vec<_>>(),
        "first_reason": corrupt.first().map(|c| c.reason.as_str()).unwrap_or(""),
    })
    .to_string();
    if let Err(e) = conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
        params![POOL_INTEGRITY_KEY, value],
    ) {
        log::error!("tracematch: [pool integrity] record failed: {}", e);
    }
}

/// Load all route signatures from the DB (standalone, no engine needed).
/// Returns the signatures that decoded and the ones that did not, so the
/// caller decides whether a reduced pool may be grouped over.
fn load_all_signatures(conn: &Connection) -> (Vec<RouteSignature>, Vec<CorruptTrack>) {
    let mut stmt = match conn.prepare(
        "SELECT activity_id, points, start_point_lat, start_point_lng,
                end_point_lat, end_point_lng, total_distance
         FROM signatures",
    ) {
        Ok(s) => s,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Vec<u8>>(1)?,
            GpsPoint::new(row.get(2)?, row.get(3)?),
            GpsPoint::new(row.get(4)?, row.get(5)?),
            row.get::<_, f64>(6)?,
        ))
    });
    let rows = match rows {
        Ok(r) => r,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    let mut signatures: Vec<RouteSignature> = Vec::new();
    let mut corrupt: Vec<CorruptTrack> = Vec::new();

    for (id, blob, start_point, end_point, total_distance) in rows.flatten() {
        let points: Vec<GpsPoint> = match TrackRead::from_blob(&blob) {
            TrackRead::Present(points) => points,
            TrackRead::Missing => Vec::new(),
            TrackRead::Corrupt(reason) => {
                corrupt.push(CorruptTrack {
                    activity_id: id,
                    reason,
                });
                continue;
            }
        };
        let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
            min_lat: 0.0,
            max_lat: 0.0,
            min_lng: 0.0,
            max_lng: 0.0,
        });
        let center = bounds.center();
        signatures.push(RouteSignature {
            activity_id: id,
            points,
            total_distance,
            start_point,
            end_point,
            bounds,
            center,
        });
    }

    (signatures, corrupt)
}

/// Compute route groups from DB signatures and save them back.
/// Runs on the background thread so it doesn't block the JS thread.
fn recompute_and_save_groups(
    conn: &Connection,
    match_config: &MatchConfig,
    existing_groups: &[RouteGroup],
    activity_metadata: &HashMap<String, String>,
) -> Vec<RouteGroup> {
    let start = std::time::Instant::now();

    let (signatures, corrupt) = load_all_signatures(conn);
    let sig_ms = start.elapsed().as_millis();

    if !corrupt.is_empty() {
        log_corrupt_tracks("BG Groups", signatures.len(), &corrupt);
        if !pool_is_usable(signatures.len(), corrupt.len()) {
            log::error!(
                "tracematch: [BG Groups] Keeping the existing groups: too much of the signature pool is unreadable to regroup over"
            );
            return existing_groups.to_vec();
        }
    }

    if signatures.is_empty() {
        return existing_groups.to_vec();
    }

    let already_grouped: HashSet<&str> = existing_groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|s| s.as_str()))
        .collect();
    let (new_sigs, existing_sigs): (Vec<_>, Vec<_>) = signatures
        .iter()
        .cloned()
        .partition(|s| !already_grouped.contains(s.activity_id.as_str()));

    let total = signatures.len();
    let use_incremental = !existing_groups.is_empty()
        && !new_sigs.is_empty()
        && (new_sigs.len() as f64) < (total as f64 * 0.9);

    let group_start = std::time::Instant::now();
    let result = if use_incremental {
        log::info!(
            "[BG Groups] INCREMENTAL: {} new vs {} existing",
            new_sigs.len(),
            existing_sigs.len()
        );
        let groups =
            tracematch::group_incremental(&new_sigs, existing_groups, &existing_sigs, match_config);
        tracematch::GroupingResult {
            groups,
            activity_matches: HashMap::new(),
        }
    } else {
        log::info!("[BG Groups] FULL: {} signatures", signatures.len());
        tracematch::group_signatures_parallel_with_matches(&signatures, match_config)
    };
    let group_ms = group_start.elapsed().as_millis();

    // SB5: the same assign-once remap the foreground writer runs. Without it this
    // path persists the raw Union-Find roots, re-keying the catalogue behind the
    // stable ids `route_names` and `activity_matches` are keyed on, and the user's
    // route names are orphaned by whichever writer happened to run last.
    let mut identity = load_identity(conn, existing_groups);
    let (mut groups, _id_map) = identity.remap(existing_groups.to_vec(), result.groups);

    for group in &mut groups {
        if let Some(sport) = activity_metadata.get(&group.representative_id) {
            group.sport_type = if sport.is_empty() {
                "Ride".to_string()
            } else {
                sport.clone()
            };
        }
    }

    if let Err(e) = save_groups_to_db(conn, &groups, &identity) {
        log::error!("[BG Groups] Save failed: {}", e);
    }

    let total_ms = start.elapsed().as_millis();
    log::info!(
        "[BG Groups] Done: {} groups in {}ms (sigs={}ms, grouping={}ms)",
        groups.len(),
        total_ms,
        sig_ms,
        group_ms
    );

    groups
}

/// Save route groups and the registry that keyed them to DB (standalone, no
/// engine needed). One transaction: a failure mid-way would otherwise leave the
/// catalogue half-written, or the groups committed under ids the registry does
/// not know, which is the crash window the registry reconcile exists to heal.
fn save_groups_to_db(
    conn: &Connection,
    groups: &[RouteGroup],
    identity: &RouteIdentity,
) -> SqlResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = save_groups_txn(conn, groups, identity);
    if result.is_ok() {
        conn.execute_batch("COMMIT")?;
    } else {
        let _ = conn.execute_batch("ROLLBACK");
    }
    result
}

fn save_groups_txn(
    conn: &Connection,
    groups: &[RouteGroup],
    identity: &RouteIdentity,
) -> SqlResult<()> {
    conn.execute("DELETE FROM route_groups", [])?;
    let mut stmt = conn.prepare(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
            activity_ids_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )?;
    for group in groups {
        let activity_ids_json = serde_json::to_string(&group.activity_ids).unwrap_or_default();
        let activity_ids_blob = super::codec::serialize(&group.activity_ids).ok();
        let (min_lat, max_lat, min_lng, max_lng) = match &group.bounds {
            Some(b) => (
                Some(b.min_lat),
                Some(b.max_lat),
                Some(b.min_lng),
                Some(b.max_lng),
            ),
            None => (None, None, None, None),
        };
        stmt.execute(params![
            group.group_id,
            group.representative_id,
            activity_ids_json,
            group.sport_type,
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            activity_ids_blob,
        ])?;
    }
    drop(stmt);

    // A name outlives its route only while the id survives. The remap keeps that
    // id, so this drops only the names of routes the regroup actually dissolved.
    let live: HashSet<&str> = groups.iter().map(|g| g.group_id.as_str()).collect();
    let named: Vec<String> = {
        let mut stmt = conn.prepare("SELECT route_id FROM route_names")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let mut delete_name = conn.prepare("DELETE FROM route_names WHERE route_id = ?")?;
    for id in named.iter().filter(|id| !live.contains(id.as_str())) {
        delete_name.execute(params![id])?;
    }
    drop(delete_name);

    // Same reasoning for the match rows, which carry the user's per-activity
    // exclusions. A carried id keeps them; only a dissolved route loses them.
    let matched: Vec<String> = {
        let mut stmt = conn.prepare("SELECT DISTINCT route_id FROM activity_matches")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let mut delete_match = conn.prepare("DELETE FROM activity_matches WHERE route_id = ?")?;
    for id in matched.iter().filter(|id| !live.contains(id.as_str())) {
        delete_match.execute(params![id])?;
    }
    drop(delete_match);

    write_identity(conn, identity)
}

/// Phase reported by a handle that was refused because detection is
/// suspended. It is not one of the weighted run phases, so `get_percent`
/// reports the unknown-phase 50 rather than pretending to progress.
pub const DETECTION_PHASE_SUSPENDED: &str = "suspended";

impl PersistentRouteEngine {
    /// A handle for a run that never started: no worker, both senders dropped.
    ///
    /// The first poll reads `WorkerPoll::Died`, which the FFI poll reports as
    /// "error". A refusal is therefore visible to the caller and distinct from
    /// a run that completed and changed nothing, which reports "complete".
    fn refused_detection_handle() -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        let (cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        drop(tx);
        drop(cache_tx);
        let progress = SectionDetectionProgress::new();
        progress.set_phase(DETECTION_PHASE_SUSPENDED, 0);
        SectionDetectionHandle {
            receiver: rx,
            final_update: std::sync::Mutex::new(None),
            cache_receiver: cache_rx,
            progress,
        }
    }

    /// Stored tracks that do not yet carry elevation, ie. the size of the
    /// remaining backfill plus the tracks upstream can never fill.
    pub fn elevation_backfill_outstanding(&self) -> u64 {
        self.elevation_state_counts()
            .map(|counts| counts.not_fetched())
            .unwrap_or(0)
    }

    /// True when every stored track has been asked about its elevation and
    /// answered, so lift rescue reads the same way for every track in the pool.
    ///
    /// Detection does NOT gate on this. A library that has simply never been
    /// backfilled reads as non-uniform, and refusing it would leave a user who
    /// never updates with no sections at all. The gate is the suspension
    /// guard a backfill holds; this is the query a backfill uses to decide
    /// whether it has work, and a diagnostic for everyone else.
    pub fn library_uniformly_elevated(&self) -> bool {
        self.elevation_backfill_outstanding() == 0
    }

    /// Start section detection in a background thread.
    ///
    /// Returns a handle that can be polled for completion and progress.
    ///
    /// Detection always covers every activity, so the catalogue is a pure
    /// function of the activity set plus config.
    ///
    /// Note: This method is designed to be non-blocking on the calling thread.
    /// All heavy operations (groups loading, track loading, detection) happen
    /// in the background thread to keep the UI responsive.
    pub fn detect_sections_background(&mut self) -> SectionDetectionHandle {
        // The single funnel every detection arm passes through, so the
        // suspension gate sits here rather than at each caller.
        if super::conditioning::detection_suspended() {
            log::info!(
                "tracematch: [SectionDetection] Refused: detection is suspended for a backfill"
            );
            return Self::refused_detection_handle();
        }
        self.detect_sections_background_unchecked()
    }

    /// The run behind [`detect_sections_background`], without the suspension
    /// gate. Only the backfill's own final re-cut may call this: it holds the
    /// guard precisely so nothing else can run, and its detect is the one the
    /// suspension exists to protect.
    pub(crate) fn detect_sections_background_unchecked(&mut self) -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        // Out-of-band channel for the evidence-cache update. Left unsent by
        // the short-circuit, so the caller's `take_cache` returns None and the
        // engine cache is untouched.
        let (cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        let db_path = self.db_path.clone();
        let section_config = self.section_config.clone();

        // The incremental folds new activities into a per-cluster evidence
        // cache. Clone the current cache + its folded-id shadow into the worker.
        // The worker mutates its clone and ships it back via `cache_tx`; the
        // cache-aware apply stores it only if the save succeeds, so `self`'s
        // cache can never advance past the applied catalogue.
        let cache_at_spawn = self.section_evidence_cache.clone();
        let folded_at_spawn = self.cache_folded_ids.clone();

        // Create shared progress tracker
        let progress = SectionDetectionProgress::new();
        let progress_clone = progress.clone();

        // Capture whether groups need recomputation. Instead of blocking the
        // calling thread (which freezes the JS progress bar), we pass this
        // flag to the background thread and let it recompute from DB.
        let needs_group_recompute = self.groups_dirty;
        let match_config = self.match_config.clone();
        let current_groups = self.groups.clone();

        // Build sport type map + activity_ids in a single pass over metadata.
        // Uses the HashMap key (= activity id) to avoid cloning m.id separately.
        let mut sport_map: HashMap<String, String> =
            HashMap::with_capacity(self.activity_metadata.len());
        let mut activity_ids: Vec<String> = Vec::with_capacity(self.activity_metadata.len());

        for (id, m) in &self.activity_metadata {
            sport_map.insert(id.clone(), m.sport_type.clone());
            activity_ids.push(id.clone());
        }
        // Metadata iterates in HashMap order, so sort by the activities primary
        // key to give the detector a deterministic input order.
        activity_ids.sort();

        // Activity start times for the occasion support floor: ground
        // visited only within one stay is a trip, not repetition. Dates
        // before 2000 are treated as unknown (each its own occasion),
        // mirroring how anonymised exports are handled corpus-side.
        let mut start_epochs: HashMap<String, i64> = HashMap::new();
        if let Ok(mut stmt) = self
            .db
            .prepare("SELECT id, start_date FROM activities WHERE start_date >= 946684800")
        {
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            });
            if let Ok(rows) = rows {
                for (id, e) in rows.flatten() {
                    start_epochs.insert(id, e);
                }
            }
        }

        // The catalogue this detect re-derives from. It seeds the Unified
        // incremental (its add/dissolve diff is computed against this prior
        // catalogue) and gates the no-new-activities short-circuit below. Only the
        // auto catalogue belongs here: `self.sections` also carries the durable
        // user-defined sections (custom + accepted) for the matcher, but the
        // incremental converges the AUTO batch and must not treat a custom section
        // as an auto prior.
        let existing_sections: Vec<FrequentSection> = self
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .cloned()
            .collect();

        // Pinned sections hold their drawn line: the fold freezes them and
        // withholds any fresh cut sharing their corridor. Read here, on the
        // engine, so the worker takes the durable intent as an explicit input.
        let pinned_ids = self.pinned_section_ids();

        let new_activity_ids: Vec<String> = activity_ids
            .iter()
            .filter(|id| !self.processed_activity_ids.contains(*id))
            .cloned()
            .collect();

        // Short-circuit: no new activities means nothing to detect. Re-emit the
        // last RAW batch, not the damped visible view: the visible catalogue can
        // lag the batch while a dissolve debounces, and echoing it back through
        // identity would count as a decisive continuation and hold the laggards
        // forever. The raw batch is what a re-fold over the unchanged pool would
        // emit, so the debounce keeps pressing and the view converges. A known
        // EMPTY raw batch is echoed as empty for the same reason: it is the
        // detector's answer, and echoing the visible view instead would
        // resurrect sections the pool no longer supports. The raw batch lives
        // in memory only; in a fresh process the visible catalogue is the best
        // available echo.
        if new_activity_ids.is_empty()
            && !existing_sections.is_empty()
            && self.section_evidence_cache.dirty_clusters() == 0
        {
            log::info!(
                "tracematch: [SectionDetection] No new activities, skipping detection ({} already processed)",
                self.processed_activity_ids.len()
            );
            let sections_copy = match &self.raw_sections {
                Some(raw) => raw.clone(),
                None => existing_sections.clone(),
            };
            let all_ids = activity_ids.clone();
            tx.send((sections_copy, all_ids)).ok();
            // No detection ran, so the evidence cache is unchanged: `cache_tx` is
            // dropped unsent, `take_cache` returns None, and the caller leaves the
            // engine cache as-is.
            return SectionDetectionHandle {
                receiver: rx,
                final_update: std::sync::Mutex::new(None),
                cache_receiver: cache_rx,
                progress,
            };
        }

        // Load every activity's track. Both detection paths need the full pool:
        // the Unified incremental re-batches it (converging to the batch), and
        // the legacy detectors run full detection each sync. The old bbox
        // pre-filter only made sense for the deleted threshold-incremental path,
        // which loaded just the new + geographically-nearby subset.
        let ids_to_load = activity_ids.clone();
        progress.set_phase("loading", ids_to_load.len() as u32);

        // Clone activity_ids for the background thread (to persist as processed after detection)
        let all_activity_ids = activity_ids.clone();

        thread::spawn(move || {
            log::info!(
                "tracematch: [SectionDetection] Background thread started with {} activity IDs",
                ids_to_load.len()
            );

            let conn = match Connection::open(&db_path) {
                Ok(c) => {
                    let _ = c.busy_timeout(std::time::Duration::from_secs(5));
                    c
                }
                Err(e) => {
                    log::info!("tracematch: [SectionDetection] Failed to open DB: {:?}", e);
                    tx.send((Vec::new(), Vec::new())).ok();
                    return;
                }
            };

            // A pool already decoded and rejected is not decoded again until it
            // changes or the window lapses, so an unreadable store costs one
            // full load per window rather than one per sync. The run still ends
            // without a result, so the poll reports the same abort.
            if abandon_window_active(&conn, &ids_to_load) {
                log::error!(
                    "tracematch: [SectionDetection] Abandoning detection: this pool of {} activities was already found unreadable within the last {} hours. The catalogue is left unchanged.",
                    ids_to_load.len(),
                    ABANDON_RETRY_SECONDS / 3600
                );
                progress_clone.set_phase("aborted", 0);
                return;
            }

            let groups = if needs_group_recompute {
                log::info!(
                    "tracematch: [SectionDetection] Recomputing route groups on background thread..."
                );
                recompute_and_save_groups(&conn, &match_config, &current_groups, &sport_map)
            } else {
                load_groups_from_db(&conn)
            };
            log::info!(
                "tracematch: [SectionDetection] {} groups ready (recomputed={})",
                groups.len(),
                needs_group_recompute
            );

            progress_clone.set_phase("loading", ids_to_load.len() as u32);

            // #21: chunk the track load to bound the transient SQL/parse
            // spike. The detector consumes full-resolution tracks and borrows
            // each one directly, so all tracks must still be resident
            // simultaneously when detection runs. We can NOT downsample on
            // load without changing detection output.
            // What chunking DOES fix: instead of binding every id into one
            // giant IN(...) statement and materialising the whole result set
            // at once, we load in CHUNK_SIZE batches and move each row into
            // the resident `loaded` map as it arrives. This caps the peak of
            // (resident tracks + in-flight query buffers) to roughly
            // (all tracks) + (one chunk) rather than (all tracks) + (full
            // result set). The final order-preserving pass over `ids_to_load`
            // is byte-identical to before, so the detection input is unchanged.
            //
            // PARTIAL: this only trims the transient spike. The dominant
            // resident cost - every full-resolution track held at once - is
            // inherent to the all-pairs algorithm and can only be removed by
            // a streaming/downsampling change inside the tracematch submodule
            // (out of scope here).
            const CHUNK_SIZE: usize = 150;
            const MEMORY_WARN_THRESHOLD: usize = 800;

            if ids_to_load.len() > MEMORY_WARN_THRESHOLD {
                log::warn!(
                    "tracematch: [SectionDetection] Loading {} full-resolution tracks for detection - all must stay resident simultaneously (all-pairs algorithm). Peak memory may be high (~{}MB est.); chunked load bounds only the transient spike, not the resident set.",
                    ids_to_load.len(),
                    // Rough estimate: ~64KB resident per track at ~1k points.
                    ids_to_load.len() * 64 / 1024,
                );
            }

            let mut tracks_loaded = 0;
            let mut tracks_empty = 0;
            let mut rows_readable = 0usize;
            let mut corrupt_tracks: Vec<CorruptTrack> = Vec::new();
            let tracks: Vec<(String, Vec<GpsPoint>)> = if ids_to_load.is_empty() {
                Vec::new()
            } else {
                let mut loaded: HashMap<String, Vec<GpsPoint>> =
                    HashMap::with_capacity(ids_to_load.len());

                for chunk in ids_to_load.chunks(CHUNK_SIZE) {
                    let placeholders: String = std::iter::repeat("?")
                        .take(chunk.len())
                        .collect::<Vec<_>>()
                        .join(",");
                    let sql = format!(
                        "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
                        placeholders
                    );
                    match conn.prepare(&sql) {
                        Ok(mut stmt) => {
                            let params_slice: Vec<&dyn rusqlite::ToSql> =
                                chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
                            let rows = stmt.query_map(params_slice.as_slice(), |row| {
                                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                            });
                            if let Ok(iter) = rows {
                                for (id, blob) in iter.flatten() {
                                    match TrackRead::from_blob(&blob) {
                                        TrackRead::Present(track) => {
                                            rows_readable += 1;
                                            loaded.insert(id, track);
                                        }
                                        TrackRead::Missing => {}
                                        TrackRead::Corrupt(reason) => {
                                            corrupt_tracks.push(CorruptTrack {
                                                activity_id: id,
                                                reason,
                                            })
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!(
                                "tracematch: [SectionDetection] Batch prepare failed for chunk of {}: {:?}; skipping chunk",
                                chunk.len(),
                                e
                            );
                        }
                    }
                }

                // Preserve the original `ids_to_load` order + emit per-track
                // progress ticks + classify empty vs loaded. Tracks missing
                // from the result (unknown ids, rows not found) count as empty.
                ids_to_load
                    .iter()
                    .filter_map(|id| {
                        progress_clone.increment();
                        match loaded.remove(id) {
                            Some(track) if !track.is_empty() => {
                                tracks_loaded += 1;
                                Some((id.clone(), track))
                            }
                            _ => {
                                tracks_empty += 1;
                                None
                            }
                        }
                    })
                    .collect()
            };

            log::info!(
                "tracematch: [SectionDetection] Loaded {} tracks ({} empty/missing, {} unreadable) from {} activity IDs",
                tracks_loaded,
                tracks_empty,
                corrupt_tracks.len(),
                ids_to_load.len()
            );

            // The pool is the corpus the catalogue is cut over, so an
            // unreadable row is never absorbed quietly. It is named in the log
            // and recorded in schema_info, and past both bars the run is
            // abandoned rather than allowed to re-cut every section against a
            // corpus smaller than the user's library. Dropping `tx` unsent
            // leaves the poll reporting Died, which clears the handle and
            // leaves the stored catalogue exactly as it stands.
            let usable = pool_is_usable(rows_readable, corrupt_tracks.len());
            log_corrupt_tracks("SectionDetection", rows_readable, &corrupt_tracks);
            record_pool_integrity(&conn, rows_readable, &corrupt_tracks, !usable);

            if !usable {
                log::error!(
                    "tracematch: [SectionDetection] Abandoning detection: {} of {} stored tracks are unreadable, past both the {} row floor and the {:.0}% ceiling. The catalogue is left unchanged.",
                    corrupt_tracks.len(),
                    rows_readable + corrupt_tracks.len(),
                    MIN_CORRUPT_TO_ABANDON,
                    MAX_CORRUPT_POOL_FRACTION * 100.0
                );
                record_abandoned_pool(&conn, &ids_to_load);
                progress_clone.set_phase("aborted", 0);
                return;
            }
            clear_abandoned_pool(&conn);

            if tracks.is_empty() {
                log::info!("tracematch: [SectionDetection] No tracks loaded, skipping detection");
                progress_clone.set_phase("complete", 0);
                tx.send((Vec::new(), all_activity_ids)).ok();
                return;
            }

            let total_points: usize = tracks.iter().map(|(_, t)| t.len()).sum();
            log::info!(
                "tracematch: [SectionDetection] Total GPS points: {}, avg per track: {}",
                total_points,
                total_points / tracks.len().max(1)
            );

            // #25: emit an intermediate phase so the JS progress bar moves
            // past "loading" before the heavy tracematch detect call, which
            // can run for tens of seconds before any per-item tick lands.
            // Without this marker the bar sits frozen at the end of "loading"
            // and a long large-corpus detection reads as a crash.
            progress_clone.set_phase("analyzing", tracks.len() as u32);

            {
                // The order-free CACHED incremental. It folds only the
                // activities not yet in the evidence cache and recomputes just the
                // cluster(s) they touch, reusing every untouched cluster verbatim,
                // so a multi-cluster sync is O(touched-cluster) not O(pool). The
                // result is identical to the batch by construction (each cluster
                // is an order-free pure function of its set).
                //
                // The new-id set is derived from the cache's own folded shadow,
                // NOT from `processed_activity_ids`: `pool − folded_at_spawn`. On a
                // cold cache (fresh engine, restart, or any invalidation) that is
                // the whole pool, so the fold seeds every cluster = the full batch;
                // on a warm cache it is just the genuinely new activities. This is
                // what makes a restart self-heal (the DB holds the catalogue; the
                // cache rebuilds) without ever double-routing an already-folded id.
                // No seconds. They feed only the lift veto, whose ruling is
                // still open: ingest now carries elevation, so the veto can
                // raise candidates, and wiring seconds needs the lift-candidate
                // memo re-keyed first.
                let new_ids_for_cache: Vec<String> = tracks
                    .iter()
                    .map(|(id, _)| id.clone())
                    .filter(|id| !folded_at_spawn.contains(id))
                    .collect();
                let new_id_refs: Vec<&str> = new_ids_for_cache.iter().map(|s| s.as_str()).collect();

                log::info!(
                    "tracematch: [SectionDetection] Unified cached incremental: {} new of {} pool tracks against {} existing sections ({} folded in cache)",
                    new_id_refs.len(),
                    tracks.len(),
                    existing_sections.len(),
                    folded_at_spawn.len(),
                );

                let mut cache = cache_at_spawn;
                // The cache will fold everything it did before plus the new pool
                // ids just routed (each present in the pool, so actually folded).
                // Keeping this shadow set in step with the returned cache is what
                // lets the next detect compute `pool − folded` correctly.
                let mut folded_after = folded_at_spawn;
                folded_after.extend(new_ids_for_cache.iter().cloned());
                // A checkpoint after each cut cluster, throttled: the poller
                // persists the newest one, so a killed run resumes from
                // there instead of from the last completed detect.
                let mut last_checkpoint = std::time::Instant::now();
                let mut observe = |done: usize, total: usize, cache: &SectionEvidenceCache| {
                    if done < total && last_checkpoint.elapsed() < CHECKPOINT_EVERY {
                        return;
                    }
                    last_checkpoint = std::time::Instant::now();
                    cache_tx
                        .send(CacheUpdate {
                            cache: cache.checkpoint(),
                            folded_ids: folded_after.clone(),
                            checkpoint: true,
                            boundaries: Vec::new(),
                        })
                        .ok();
                };
                let fold = tracematch::detect_sections_unified_incremental_observed(
                    &mut cache,
                    &existing_sections,
                    &tracks,
                    &new_id_refs,
                    &[],
                    &sport_map,
                    &start_epochs,
                    &section_config,
                    &tracematch::SectionUpdatePolicy {
                        pinned_ids,
                        freeze_all_geometry: false,
                    },
                    &mut observe,
                );
                let sections_to_send = fold.catalogue;

                log::info!(
                    "tracematch: [SectionDetection] Unified cached incremental complete: {} sections",
                    sections_to_send.len()
                );

                // Ship the cache update BEFORE the main result. `recv`/`poll_state`
                // on the main channel is the caller's signal to `take_cache`, so
                // sending the cache first guarantees it is present by then.
                cache_tx
                    .send(CacheUpdate {
                        cache,
                        folded_ids: folded_after,
                        checkpoint: false,
                        boundaries: fold.boundaries,
                    })
                    .ok();

                // No consensus seed here. The accumulator is read only by
                // `sections::incremental`, which the unified arm never calls,
                // so seeding it rebuilds an R-tree and rescans every member
                // track per section for a value nothing consumes.

                // Signal saving phase before sending results for DB persistence
                progress_clone.set_phase("saving", 1);
                tx.send((sections_to_send, all_activity_ids)).ok();
            }
        });

        SectionDetectionHandle {
            receiver: rx,
            final_update: std::sync::Mutex::new(None),
            cache_receiver: cache_rx,
            progress,
        }
    }

    /// Hot path of apply_sections: replace in-memory sections, persist
    /// them to SQLite, clear the relevant LRU caches. Returns as soon as
    /// the new section set is durably saved and queryable from in-memory
    /// reads. Does NOT do the cross-sport merge or the indicator
    /// recompute - those are the deferred tail
    /// (`apply_sections_finalize`) so callers that want the UI interactive
    /// can return after `_save` and do the tail on a background thread.
    ///
    /// If `save_sections` fails the prior in-memory state is restored -
    /// the rollback contract is unchanged from the monolithic
    /// `apply_sections`.
    pub fn apply_sections_save(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        // B2: remap the raw detection batch through the assign-once identity +
        // hysteresis registry into the id-stable, churn-damped VISIBLE catalogue
        // the app renders. Run on a clone of the registry so a failed save never
        // advances identity past what is durable in the DB; commit it only on Ok.
        let mut trial_identity = self.identity.clone();
        let raw_for_convergence = sections.clone();
        let (mut visible, events) = self.section_identity_apply_into(&mut trial_identity, sections);
        // SB6: a section whose every portion belongs to an activity the pool no
        // longer holds gets zero junction rows, so no trigger fires and it renders
        // as "0 visits" over an empty detail screen. Keep it out of the visible
        // catalogue. The registry row stays, so the hysteresis still dissolves the
        // ground on its own schedule and its grave can re-emerge under the old id.
        visible.retain(|section| {
            let alive = section.is_user_defined
                || section
                    .activity_portions
                    .iter()
                    .any(|p| self.activity_metadata.contains_key(&p.activity_id));
            if !alive {
                log::warn!(
                    "tracematch: [apply_sections_save] dropping section {} - none of its {} \
                     portions belong to a pooled activity",
                    section.id,
                    section.activity_portions.len(),
                );
            }
            alive
        });
        // The identity layer owns only the auto catalogue. Carry the durable
        // user-defined sections (custom + accepted) already held in memory across
        // the apply so get_sections() keeps mirroring the full visible catalogue -
        // the in-memory matcher must keep seeing custom sections after a detect.
        // save_sections skips them (durable rows), so this touches only the view.
        for s in &self.sections {
            if s.is_user_defined && !visible.iter().any(|v| v.id == s.id) {
                visible.push(s.clone());
            }
        }
        let old_sections = std::mem::replace(&mut self.sections, visible);
        // Make the trial registry live BEFORE the save: `save_sections` writes its
        // blob (B4) inside the same transaction as the catalogue, so the two
        // commit atomically and a crash cannot leave the registry ahead of the DB.
        let old_identity = std::mem::replace(&mut self.identity, trial_identity);
        match self.save_sections_with_events(&events) {
            Ok(()) => {
                self.raw_sections = Some(raw_for_convergence);
                self.sections_dirty = false;
                // Clear activity_traces to prevent memory leak. These GPS
                // traces were used for consensus computation but aren't
                // persisted; shrink_to_fit() releases the bucket
                // allocation too.
                for section in &mut self.sections {
                    section.activity_traces.clear();
                    section.activity_traces.shrink_to_fit();
                }
                self.section_cache.clear();
                self.invalidate_perf_cache();
                if let Err(e) = self.rank_catalogue() {
                    log::warn!("tracematch: [detection] ranking skipped: {}", e);
                }
                Ok(())
            }
            Err(e) => {
                // The transaction rolled back both the catalogue and the blob;
                // roll the in-memory registry back to match.
                self.sections = old_sections;
                self.identity = old_identity;
                Err(e)
            }
        }
    }

    /// Cache-aware hot save: `apply_sections_save`, then advance the Unified
    /// evidence cache iff the save succeeded. `update` is the worker's
    /// `CacheUpdate` for the Unified path, or None for the legacy detectors and
    /// the no-new-activities short-circuit (nothing to advance, the cache is
    /// left as-is).
    ///
    /// The consistency contract: the cache must never get ahead of the applied
    /// catalogue. On success the returned cache exactly reflects the sections
    /// just persisted, so it is adopted wholesale. On failure `apply_sections_save`
    /// has already rolled the in-memory sections back to the prior state, so the
    /// cache is dropped (`invalidate_evidence_cache`) and the next detect
    /// cold-rebatches from the real DB state rather than from a catalogue that was
    /// never durably saved.
    pub fn apply_sections_save_with_cache(
        &mut self,
        sections: Vec<FrequentSection>,
        update: Option<CacheUpdate>,
    ) -> SqlResult<()> {
        // A checkpoint is a mid-fold snapshot, never the record of what was
        // persisted: adopting one as the final cache silently poisons the next
        // detect. The callers drain to the real update, so reaching here with
        // one is a bug in the caller, not a state to tolerate.
        debug_assert!(
            !update.as_ref().is_some_and(|u| u.checkpoint),
            "apply_sections_save_with_cache adopted a mid-fold checkpoint as the final cache"
        );
        self.fork_records = update
            .as_ref()
            .map(|u| u.boundaries.clone())
            .unwrap_or_default();
        let saved = self.apply_sections_save(sections);
        self.fork_records.clear();
        match saved {
            Ok(()) => {
                if let Some(u) = update {
                    self.section_evidence_cache = u.cache;
                    self.cache_folded_ids = u.folded_ids;
                    self.persist_evidence_cache();
                }
                Ok(())
            }
            Err(e) => {
                self.invalidate_evidence_cache();
                Err(e)
            }
        }
    }

    /// Cache-aware equivalent of `apply_sections`: the hot save-with-cache
    /// followed by the deferred finalize tail. The harness/test ingest path uses
    /// this so a Unified drip actually exercises the cache; production splits the
    /// two halves across separate engine locks (see `objects/detection.rs`).
    pub fn apply_sections_with_cache(
        &mut self,
        sections: Vec<FrequentSection>,
        update: Option<CacheUpdate>,
    ) -> SqlResult<()> {
        self.apply_sections_save_with_cache(sections, update)?;
        self.apply_sections_finalize();
        Ok(())
    }

    /// Deferred tail of apply_sections: activity-indicator recompute. It is
    /// best-effort (errors are logged, not returned) because it doesn't affect
    /// the ability to query the just-saved sections, it only refines derived
    /// state. Safe to invoke on a background thread after
    /// `apply_sections_save` returns.
    pub fn apply_sections_finalize(&mut self) {
        self.apply_sections_finalize_with_progress(None);
    }

    /// Variant that emits phase markers to the supplied progress tracker
    /// so the UI can show "still recomputing indicators" instead of a
    /// frozen-looking 100% bar.
    pub fn apply_sections_finalize_with_progress(
        &mut self,
        progress: Option<&super::super::SectionDetectionProgress>,
    ) {
        if let Some(p) = progress {
            p.set_phase("recomputing_indicators", 1);
        }
        if let Err(e) = self.recompute_activity_indicators() {
            log::warn!(
                "tracematch: [apply_sections_finalize] Indicator recomputation failed: {}",
                e
            );
        }
        if let Some(p) = progress {
            p.increment();
            p.set_phase("complete", 1);
            p.increment();
        }
    }

    /// Apply completed section detection results synchronously: hot save
    /// path followed by the deferred tail. Equivalent to today's pre-Tier
    /// 1.1 single call. Callers that want to keep the UI responsive
    /// during the tail should use `apply_sections_save` followed by
    /// `apply_sections_finalize` on a background thread.
    pub fn apply_sections(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        self.apply_sections_save(sections)?;
        self.apply_sections_finalize();
        Ok(())
    }
}

/// Blob version for the persisted evidence cache. A shape change to
/// `SectionEvidenceCache` or `LeafMemos` bumps this, and the old row is then
/// read as a miss rather than decoded into something that no longer means
/// what it says.
const EVIDENCE_CACHE_BLOB_VERSION: u8 = 1;

impl PersistentRouteEngine {
    /// Write the evidence cache and its folded-id shadow beside the config
    /// digest they were folded under.
    ///
    /// Best effort. The cache is a re-derivable shortcut, so a write that
    /// fails costs one cold rebatch on the next open and nothing else. It is
    /// never allowed to fail an apply that already saved its catalogue.
    ///
    /// Cost scales with the pool: measured on the lifecycle corpus at roughly
    /// 5 KB and 0.07 ms per activity, so a 1,000-activity library pays about
    /// 5 MB and 75 ms per apply. The apply already runs off the main thread,
    /// and the alternative it buys back is a whole cold rebatch.
    pub(crate) fn persist_evidence_cache(&mut self) {
        if self.cache_folded_ids.is_empty() {
            self.clear_persisted_evidence_cache();
            return;
        }
        let cache = std::mem::replace(
            &mut self.section_evidence_cache,
            SectionEvidenceCache::new(),
        );
        let folded = std::mem::take(&mut self.cache_folded_ids);
        self.persist_evidence_blob(&cache, &folded);
        self.section_evidence_cache = cache;
        self.cache_folded_ids = folded;
    }

    /// Persist a mid-fold checkpoint in place of the last completed cache.
    /// The in-memory cache is untouched: the run that sent it still owns
    /// the catalogue until it applies. If the process dies first, the next
    /// launch restores this and the next detect cuts only what is left.
    pub fn persist_evidence_checkpoint(&mut self, update: &CacheUpdate) {
        if update.folded_ids.is_empty() {
            return;
        }
        self.persist_evidence_blob(&update.cache, &update.folded_ids);
    }

    /// Clusters the cache still owes a cut, a restored checkpoint's debt.
    pub fn evidence_cache_dirty_clusters(&self) -> usize {
        self.section_evidence_cache.dirty_clusters()
    }

    fn persist_evidence_blob(
        &mut self,
        cache: &SectionEvidenceCache,
        folded_ids: &HashSet<String>,
    ) {
        let digest = super::section_config_digest(&self.section_config);
        let folded: Vec<String> = {
            let mut ids: Vec<String> = folded_ids.iter().cloned().collect();
            ids.sort();
            ids
        };

        // Named fields: the cache carries `GpsPoint`s, whose skipped elevation
        // would shorten a positional encoding and misalign everything after it.
        let cache_blob = match codec::serialize_named(cache) {
            Ok(bytes) => codec::tag_blob(EVIDENCE_CACHE_BLOB_VERSION, bytes),
            Err(e) => {
                log::warn!("tracematch: evidence cache not encodable, staying cold: {e}");
                return;
            }
        };
        let folded_blob = match codec::serialize_gps_composite(&folded) {
            Ok(bytes) => codec::tag_blob(EVIDENCE_CACHE_BLOB_VERSION, bytes),
            Err(e) => {
                log::warn!("tracematch: folded ids not encodable, staying cold: {e}");
                return;
            }
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        if let Err(e) = self.db.execute(
            "INSERT INTO evidence_cache (id, config_digest, folded_ids, cache, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
                 config_digest = excluded.config_digest,
                 folded_ids = excluded.folded_ids,
                 cache = excluded.cache,
                 updated_at = excluded.updated_at",
            params![digest, folded_blob, cache_blob, now],
        ) {
            log::warn!("tracematch: evidence cache not written, staying cold: {e}");
        }
    }

    /// Drop the persisted evidence cache row. Paired with every in-memory
    /// invalidation, so a restart can never adopt a cache the running engine
    /// had already decided was stale.
    pub(crate) fn clear_persisted_evidence_cache(&mut self) {
        if let Err(e) = self.db.execute("DELETE FROM evidence_cache", []) {
            log::warn!("tracematch: evidence cache row not cleared: {e}");
        }
    }

    /// Adopt the persisted evidence cache if it was folded under the config
    /// now in force. Returns whether it was adopted.
    ///
    /// A missing, stale, mistagged or undecodable row leaves the engine cold,
    /// which is the state every engine started in before this row existed.
    /// The row is deleted in that case so the next write is a clean insert.
    pub(crate) fn restore_evidence_cache(&mut self) -> bool {
        let digest = super::section_config_digest(&self.section_config);

        let row: Option<(String, Vec<u8>, Vec<u8>)> = self
            .db
            .query_row(
                "SELECT config_digest, folded_ids, cache FROM evidence_cache WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();

        let Some((stored_digest, folded_blob, cache_blob)) = row else {
            return false;
        };

        if stored_digest != digest {
            log::info!("tracematch: evidence cache was folded under another config, dropping it");
            self.clear_persisted_evidence_cache();
            return false;
        }

        let decoded = codec::untag_blob(EVIDENCE_CACHE_BLOB_VERSION, &cache_blob)
            .ok_or_else(|| "cache blob tag".to_string())
            .and_then(|b| codec::deserialize_gps_composite::<SectionEvidenceCache>(b))
            .and_then(|cache| {
                let folded = codec::untag_blob(EVIDENCE_CACHE_BLOB_VERSION, &folded_blob)
                    .ok_or_else(|| "folded blob tag".to_string())
                    .and_then(codec::deserialize_gps_composite::<Vec<String>>)?;
                Ok((cache, folded))
            });

        match decoded {
            Ok((cache, folded)) => {
                self.section_evidence_cache = cache;
                self.cache_folded_ids = folded.into_iter().collect();
                true
            }
            Err(e) => {
                log::warn!("tracematch: evidence cache unreadable, starting cold: {e}");
                self.clear_persisted_evidence_cache();
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::route_identity::restore_identity;

    fn group(id: &str, members: &[&str]) -> RouteGroup {
        RouteGroup {
            group_id: id.to_string(),
            representative_id: members[0].to_string(),
            activity_ids: members.iter().map(|s| s.to_string()).collect(),
            sport_type: "Ride".to_string(),
            bounds: None,
            custom_name: None,
            best_time: None,
            avg_time: None,
            best_pace: None,
            best_activity_id: None,
        }
    }

    /// Two well-separated tracks, so the grouping returns two groups whose ids
    /// are the Union-Find roots the members happen to produce, not the stable ids.
    fn store_signatures(engine: &PersistentRouteEngine) {
        for (id, base_lat) in [("a1", 40.0_f64), ("a2", 40.0), ("b1", 50.0)] {
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                     VALUES (?, 'Ride', ?, ?, 10.0, 10.0)",
                    params![id, base_lat, base_lat + 0.04],
                )
                .unwrap();
            let points: Vec<GpsPoint> = (0..40)
                .map(|i| GpsPoint::new(base_lat + i as f64 * 0.001, 10.0))
                .collect();
            let sig = RouteSignature {
                activity_id: id.to_string(),
                start_point: points[0],
                end_point: *points.last().unwrap(),
                bounds: Bounds::from_points(&points).unwrap(),
                center: Bounds::from_points(&points).unwrap().center(),
                total_distance: 4000.0,
                points,
            };
            engine.store_signature(id, &sig).unwrap();
        }
    }

    fn sports(ids: &[&str]) -> HashMap<String, String> {
        ids.iter()
            .map(|id| (id.to_string(), "Ride".to_string()))
            .collect()
    }

    fn names(conn: &Connection) -> HashMap<String, String> {
        let mut stmt = conn
            .prepare("SELECT route_id, custom_name FROM route_names")
            .unwrap();
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    /// SB5. The background writer is handed the same catalogue back under fresh
    /// Union-Find root ids, which is what the grouping emits. It must carry the
    /// stable ids, so the user's route name stays attached, rather than persist
    /// the roots raw and orphan it.
    #[test]
    fn background_save_carries_stable_ids_and_names() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();
        engine.groups = vec![group("r_1", &["a1", "a2"]), group("r_2", &["b1"])];
        engine.route_identity_reseed();
        store_signatures(&engine);
        engine.save_groups().unwrap();
        engine
            .db
            .execute(
                "INSERT OR REPLACE INTO route_names (route_id, custom_name) VALUES (?, ?)",
                params!["r_1", "Morning loop"],
            )
            .unwrap();

        let prior = engine.groups.clone();
        recompute_and_save_groups(
            &engine.db,
            &MatchConfig::default(),
            &prior,
            &sports(&["a1", "a2", "b1"]),
        );

        let saved: HashSet<String> = {
            let mut stmt = engine.db.prepare("SELECT id FROM route_groups").unwrap();
            let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        assert_eq!(
            saved,
            ["r_1".to_string(), "r_2".to_string()].into_iter().collect(),
            "the background writer must persist the stable ids, not the UF roots"
        );
        assert_eq!(
            names(&engine.db).get("r_1").map(String::as_str),
            Some("Morning loop"),
            "the user's name must still be keyed to a live route"
        );
        assert!(
            restore_identity(&engine.db).is_some(),
            "the registry must commit with the groups it describes"
        );
    }

    /// A route the regroup actually dissolves takes its name and match rows with
    /// it, so the id namespace the next run reads holds no dead keys.
    #[test]
    fn background_save_drops_names_of_dissolved_routes() {
        let mut engine = PersistentRouteEngine::in_memory().unwrap();
        engine.groups = vec![group("r_1", &["a1"]), group("r_2", &["b1"])];
        engine.route_identity_reseed();
        engine.save_groups().unwrap();

        let prior = engine.groups.clone();
        let mut identity = load_identity(&engine.db, &prior);
        let (remapped, _) = identity.remap(prior, vec![group("a1", &["a1"])]);
        save_groups_to_db(&engine.db, &remapped, &identity).unwrap();

        assert!(
            !names(&engine.db).contains_key("r_2"),
            "a dissolved route must not leave its name behind"
        );
        let orphan_matches: u32 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM activity_matches WHERE route_id = 'r_2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphan_matches, 0);
    }
}
