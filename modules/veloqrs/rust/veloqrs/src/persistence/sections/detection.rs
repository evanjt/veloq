//! Background section detection and application.

use crate::persistence::codec;
use crate::{FrequentSection, GpsPoint, SectionEvidenceCache};
use rusqlite::{Connection, Result as SqlResult, params};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use tracematch::{Bounds, MatchConfig, RouteGroup, RouteSignature};

use super::super::{
    CacheUpdate, ClusteringAwareProgress, PersistentRouteEngine, SectionDetectionHandle,
    SectionDetectionProgress, load_groups_from_db,
};

/// Load all route signatures from the DB (standalone, no engine needed).
fn load_all_signatures(conn: &Connection) -> Vec<RouteSignature> {
    let mut stmt = match conn.prepare(
        "SELECT activity_id, points, start_point_lat, start_point_lng,
                end_point_lat, end_point_lng, total_distance
         FROM signatures",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let blob: Vec<u8> = row.get(1)?;
        let points: Vec<GpsPoint> = codec::deserialize_points(&blob).unwrap_or_default();
        let start_point = GpsPoint::new(row.get(2)?, row.get(3)?);
        let end_point = GpsPoint::new(row.get(4)?, row.get(5)?);
        let total_distance: f64 = row.get(6)?;
        let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
            min_lat: 0.0,
            max_lat: 0.0,
            min_lng: 0.0,
            max_lng: 0.0,
        });
        let center = bounds.center();
        Ok(RouteSignature {
            activity_id: id,
            points,
            total_distance,
            start_point,
            end_point,
            bounds,
            center,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
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

    let signatures = load_all_signatures(conn);
    let sig_ms = start.elapsed().as_millis();

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

    let mut groups = result.groups;

    for group in &mut groups {
        if let Some(sport) = activity_metadata.get(&group.representative_id) {
            group.sport_type = if sport.is_empty() {
                "Ride".to_string()
            } else {
                sport.clone()
            };
        }
    }

    if let Err(e) = save_groups_to_db(conn, &groups) {
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

/// Save route groups to DB (standalone, no engine needed).
fn save_groups_to_db(conn: &Connection, groups: &[RouteGroup]) -> SqlResult<()> {
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
    Ok(())
}

/// Tier 2 upgrade-path backfill: seed `consensus_state_blob` on every
/// pre-existing section whose blob is still NULL, using its own SQLite
/// connection so it doesn't block the main engine. Runs once per install
/// (guarded by the `accumulators_seeded_v1` key in `schema_info`).
///
/// Why: users upgrading from 0.2.2 (or any pre-Tier-2 version) have
/// sections on disk whose `consensus_state_blob` is NULL because the
/// detection run that created them didn't seed accumulators. Without this
/// backfill, the first post-upgrade sync still pays the historical-trace
/// extraction cost (scenario C's ~1.5 s). With it, the next sync reads
/// fresh accumulators and lands in the O(K) fast path immediately.
///
/// Race-safety:
/// - UPDATE is gated on `WHERE consensus_state_blob IS NULL`, so if the
///   main engine's `apply_sections_save` persisted a newer blob in the
///   meantime we don't clobber it.
/// - If the user syncs during backfill, the engine's in-memory copy still
///   has None accumulators and will hit today's backfill branch in
///   incremental detection - correct but slow. Subsequent syncs pick up
///   the persisted blobs on next engine reload.
/// - `try_write` at the end is best-effort: if the engine lock is taken
///   by an active operation we skip the in-memory reload; the fresh blobs
///   land on next app start via `load_sections`.
pub fn spawn_accumulator_backfill(db_path: String) {
    std::thread::spawn(move || {
        let result = run_accumulator_backfill(&db_path, /* refresh_engine = */ true);
        if let Err(e) = result {
            log::warn!("tracematch: [accum backfill] {}", e);
        }
    });
}

/// Synchronous body of [`spawn_accumulator_backfill`]. Separated so
/// integration tests can drive the backfill deterministically (no thread).
///
/// When `refresh_engine` is true and any section got seeded, best-effort
/// acquires the global engine write lock and reloads sections. Tests pass
/// `false` - they hold their own engine and don't need the singleton.
pub fn run_accumulator_backfill(db_path: &str, refresh_engine: bool) -> Result<(u32, u32), String> {
    let start = std::time::Instant::now();
    let conn = match Connection::open(db_path) {
        Ok(c) => {
            let _ = c.busy_timeout(std::time::Duration::from_millis(500));
            c
        }
        Err(e) => return Err(format!("open failed: {}", e)),
    };

    // Already-seeded flag: once set, skip entirely.
    let flag_set: bool = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'accumulators_seeded_v1'",
            [],
            |row| row.get::<_, String>(0),
        )
        .is_ok();
    if flag_set {
        return Ok((0, 0));
    }

    // Collect sections that still need seeding.
    let sections_to_seed: Vec<(String, Vec<tracematch::GpsPoint>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, polyline_json FROM sections
                 WHERE consensus_state_blob IS NULL
                   AND polyline_json IS NOT NULL
                   AND disabled = 0",
            )
            .map_err(|e| format!("prepare failed: {}", e))?;
        stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let polyline_json: String = row.get(1)?;
            Ok((id, polyline_json))
        })
        .ok()
        .map(|rows| {
            rows.filter_map(|r| r.ok())
                .filter_map(|(id, json)| {
                    serde_json::from_str::<Vec<tracematch::GpsPoint>>(&json)
                        .ok()
                        .map(|p| (id, p))
                })
                .filter(|(_, p)| p.len() >= 2)
                .collect()
        })
        .unwrap_or_default()
    };

    if sections_to_seed.is_empty() {
        // Nothing to do. Set flag so next start skips straight past.
        let _ = conn.execute(
            "INSERT OR REPLACE INTO schema_info (key, value)
             VALUES ('accumulators_seeded_v1', '1')",
            [],
        );
        return Ok((0, 0));
    }

    log::info!(
        "tracematch: [accum backfill] Seeding {} sections from pre-Tier-2 data",
        sections_to_seed.len()
    );

    let section_config = tracematch::SectionConfig::default();
    let mut seeded: u32 = 0;
    let mut skipped: u32 = 0;

    for (section_id, polyline) in &sections_to_seed {
        // Activity ids for this section (excluded=0 matches the rest of the codebase).
        let activity_ids: Vec<String> = match conn.prepare(
            "SELECT activity_id FROM section_activities
             WHERE section_id = ? AND excluded = 0",
        ) {
            Ok(mut stmt) => stmt
                .query_map([section_id], |row| row.get::<_, String>(0))
                .ok()
                .map(|r| r.filter_map(|x| x.ok()).collect())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        if activity_ids.is_empty() {
            skipped += 1;
            continue;
        }

        // Load full GPS tracks for the section's activities in a single IN(...)
        // query - cheaper than N separate query_row round-trips, especially on
        // sections with many traversals.
        let mut track_map_owned: HashMap<String, Vec<tracematch::GpsPoint>> = HashMap::new();
        {
            let placeholders: String = std::iter::repeat("?")
                .take(activity_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
                placeholders
            );
            if let Ok(mut stmt) = conn.prepare(&sql) {
                let params_slice: Vec<&dyn rusqlite::ToSql> = activity_ids
                    .iter()
                    .map(|id| id as &dyn rusqlite::ToSql)
                    .collect();
                if let Ok(rows) = stmt.query_map(params_slice.as_slice(), |row| {
                    let id: String = row.get(0)?;
                    let bytes: Vec<u8> = row.get(1)?;
                    let track: Vec<tracematch::GpsPoint> =
                        codec::deserialize_points(&bytes).unwrap_or_default();
                    Ok((id, track))
                }) {
                    for row in rows.flatten() {
                        if !row.1.is_empty() {
                            track_map_owned.insert(row.0, row.1);
                        }
                    }
                }
            }
        }
        if track_map_owned.is_empty() {
            skipped += 1;
            continue;
        }

        let track_ref_map: HashMap<&str, &[tracematch::GpsPoint]> = track_map_owned
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect();

        let traces_map = tracematch::sections::extract_all_activity_traces(
            &activity_ids,
            polyline,
            &track_ref_map,
        );
        if traces_map.is_empty() {
            skipped += 1;
            continue;
        }
        let traces: Vec<(String, Vec<tracematch::GpsPoint>)> = traces_map.into_iter().collect();
        let acc = tracematch::sections::build_accumulator_from_traces(
            polyline,
            &traces,
            section_config.proximity_threshold,
        );

        match codec::serialize_gps_composite(&acc) {
            Ok(blob) => {
                // IS NULL guard: respect any writes the main engine made
                // while we were computing (e.g., a sync that ran concurrently
                // and populated this section via the normal incremental path).
                let updated = conn
                    .execute(
                        "UPDATE sections SET consensus_state_blob = ?
                         WHERE id = ? AND consensus_state_blob IS NULL",
                        params![blob, section_id],
                    )
                    .unwrap_or(0);
                if updated > 0 {
                    seeded += 1;
                } else {
                    skipped += 1;
                }
            }
            Err(_) => skipped += 1,
        }
    }

    // Mark the flag even if some were skipped - we only want to pay the
    // corpus-wide scan once. Sections we skipped here (e.g., no GPS data on
    // disk) will get their accumulators built by the ordinary incremental
    // backfill path if/when they're ever touched.
    let _ = conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value)
         VALUES ('accumulators_seeded_v1', '1')",
        [],
    );

    log::info!(
        "tracematch: [accum backfill] Done: {} seeded, {} skipped, took {:?}",
        seeded,
        skipped,
        start.elapsed()
    );

    // Best-effort: refresh the engine's in-memory copy so the new blobs
    // become usable without requiring an app restart. If the write lock is
    // held by a concurrent operation, skip - the engine will pick them up
    // on next `load_sections` call / next app start.
    if refresh_engine && seeded > 0 {
        if let Ok(mut guard) = super::super::PERSISTENT_ENGINE.try_write() {
            if let Some(ref mut engine) = *guard {
                if let Err(e) = engine.load_sections() {
                    log::warn!(
                        "tracematch: [accum backfill] in-memory reload failed: {}",
                        e
                    );
                } else {
                    log::info!("tracematch: [accum backfill] in-memory sections refreshed");
                }
            }
        } else {
            log::info!("tracematch: [accum backfill] engine busy, deferring reload to next start");
        }
    }

    Ok((seeded, skipped))
}

/// Tier 2: seed `consensus_state` on any section that came out of detection
/// with None. Uses the GPS tracks already loaded for detection, so no DB
/// round-trip. Runs before the results cross the mpsc channel so the
/// accumulator lands in the FrequentSection that `apply_sections_save` later
/// persists via `consensus_state_blob`.
///
/// Why it matters: without a seeded accumulator, the first incremental add
/// that touches each section falls into the backfill branch in
/// `tracematch/src/sections/incremental.rs` (extract_all_activity_traces for
/// every historical activity of that section). On a 150-activity corpus
/// that's the bulk of scenario C's 1.6 s lag per the baselines. Seeding
/// eagerly shifts that cost into the detection phase itself (where we
/// already have all the traces resident) and lets the next incremental
/// touch take the O(K) fast path.
///
/// Idempotent: sections that already have `consensus_state` (from the
/// incremental path that produced them) are skipped, so we never
/// double-seed.
fn seed_consensus_state(
    sections: &mut [FrequentSection],
    tracks: &[(String, Vec<GpsPoint>)],
    proximity_threshold: f64,
) {
    if sections.is_empty() || tracks.is_empty() {
        return;
    }
    let track_map: HashMap<&str, &[GpsPoint]> = tracks
        .iter()
        .map(|(id, pts)| (id.as_str(), pts.as_slice()))
        .collect();

    for section in sections.iter_mut() {
        if section.consensus_state.is_some() {
            continue;
        }
        if section.polyline.len() < 2 || section.activity_ids.is_empty() {
            continue;
        }
        let traces_map = tracematch::sections::extract_all_activity_traces(
            &section.activity_ids,
            &section.polyline,
            &track_map,
        );
        if traces_map.is_empty() {
            continue;
        }
        let traces: Vec<(String, Vec<GpsPoint>)> = traces_map.into_iter().collect();
        let acc = tracematch::sections::build_accumulator_from_traces(
            &section.polyline,
            &traces,
            proximity_threshold,
        );
        section.consensus_state = Some(acc);
    }
}

impl PersistentRouteEngine {
    /// Start section detection in a background thread.
    ///
    /// Returns a handle that can be polled for completion and progress.
    ///
    /// Note: This method is designed to be non-blocking on the calling thread.
    /// All heavy operations (groups loading, track loading, detection) happen
    /// in the background thread to keep the UI responsive.
    pub fn detect_sections_background(
        &mut self,
        sport_filter: Option<String>,
    ) -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        // Out-of-band channel for the Unified detector's evidence-cache update.
        // Left unsent by the legacy detectors and the short-circuit, so the
        // caller's `take_cache` returns None and the engine cache is untouched.
        let (cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        let db_path = self.db_path.clone();
        let section_config = self.section_config.clone();

        // The Unified incremental folds new activities into a per-cluster
        // evidence cache. Clone the current cache + its folded-id shadow into the
        // worker only when Unified is the active method — the legacy detectors
        // never touch it, so they pay nothing to clone. The worker mutates its
        // clone and ships it back via `cache_tx`; the cache-aware apply stores it
        // only if the save succeeds, so `self`'s cache can never advance past the
        // applied catalogue.
        let unified = matches!(
            section_config.detection_method,
            tracematch::DetectionMethod::Unified
        );
        let (cache_at_spawn, folded_at_spawn) = if unified {
            (
                self.section_evidence_cache.clone(),
                self.cache_folded_ids.clone(),
            )
        } else {
            (SectionEvidenceCache::new(), HashSet::new())
        };

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
            match &sport_filter {
                Some(sport) if &m.sport_type != sport => {}
                _ => activity_ids.push(id.clone()),
            }
        }

        // The catalogue this detect re-derives from. It seeds the Unified
        // incremental (its add/dissolve diff is computed against this prior
        // catalogue) and gates the no-new-activities short-circuit below.
        let existing_sections = self.sections.clone();

        let new_activity_ids: Vec<String> = activity_ids
            .iter()
            .filter(|id| !self.processed_activity_ids.contains(*id))
            .cloned()
            .collect();

        // Short-circuit: no new activities means nothing to detect
        if new_activity_ids.is_empty() && !existing_sections.is_empty() {
            log::info!(
                "tracematch: [SectionDetection] No new activities, skipping detection ({} already processed)",
                self.processed_activity_ids.len()
            );
            let sections_copy = existing_sections.clone();
            let all_ids = activity_ids.clone();
            tx.send((sections_copy, all_ids)).ok();
            // No detection ran, so the evidence cache is unchanged: `cache_tx` is
            // dropped unsent, `take_cache` returns None, and the caller leaves the
            // engine cache as-is.
            return SectionDetectionHandle {
                receiver: rx,
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
            // spike. The detection algorithm consumes full-resolution tracks
            // (the multiscale/incremental entry points borrow each track's
            // points directly into their `track_map` - see
            // tracematch::sections::detect_sections_multiscale_with_progress),
            // and `seed_consensus_state` below also needs them, so all tracks
            // must still be resident simultaneously when detection runs. We
            // can NOT downsample on load without changing detection output.
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
                                let id: String = row.get(0)?;
                                let blob: Vec<u8> = row.get(1)?;
                                let track: Vec<GpsPoint> = codec::deserialize_points(&blob)
                                    .unwrap_or_else(|e| {
                                        log::warn!(
                                            "tracematch: [SectionDetection] Skipping malformed track for {}: {:?}",
                                            id, e
                                        );
                                        Vec::new()
                                    });
                                Ok((id, track))
                            });
                            if let Ok(iter) = rows {
                                for row in iter.flatten() {
                                    loaded.insert(row.0, row.1);
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
                "tracematch: [SectionDetection] Loaded {} tracks ({} empty/missing) from {} activity IDs",
                tracks_loaded,
                tracks_empty,
                ids_to_load.len()
            );

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
            // past "loading" before the heavy tracematch detect call. The
            // first phase tracematch reports is "building_rtrees", but the
            // R-tree build + density-grid clustering can run for tens of
            // seconds before any per-item tick lands. Without this marker the
            // bar sits frozen at the end of "loading" and a long large-corpus
            // detection reads as a crash. We use the existing progress handle
            // only - no tracematch change. The ClusteringAwareProgress passed
            // into detect overwrites the phase on its first on_phase callback.
            progress_clone.set_phase("analyzing", tracks.len() as u32);

            if unified {
                // Unified: the order-free CACHED incremental. It folds only the
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
                // Seconds streams are wired in B3, so pass none here.
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
                let mut sections_to_send = tracematch::detect_sections_unified_incremental_cached(
                    &mut cache,
                    &existing_sections,
                    &tracks,
                    &new_id_refs,
                    &[],
                    &sport_map,
                    &section_config,
                )
                .catalogue;

                // The cache now folds everything it did before plus the new pool
                // ids just routed (each present in the pool, so actually folded).
                // Keeping this shadow set in step with the returned cache is what
                // lets the next detect compute `pool − folded` correctly.
                let mut folded_after = folded_at_spawn;
                folded_after.extend(new_ids_for_cache);

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
                    })
                    .ok();

                // Seed consensus_state for the fresh sections, mirroring the
                // full-detection path (the sections arrive from detection
                // without an accumulator).
                seed_consensus_state(
                    &mut sections_to_send,
                    &tracks,
                    section_config.proximity_threshold,
                );

                // Signal saving phase before sending results for DB persistence
                progress_clone.set_phase("saving", 1);
                tx.send((sections_to_send, all_activity_ids)).ok();
            } else {
                // Full detection mode with batching for large datasets.
                // Cap full pairwise detection at BATCH_CAP activities per batch.
                // Subsequent batches use incremental detection against results from prior batches.
                const BATCH_CAP: usize = 500;

                if tracks.len() <= BATCH_CAP {
                    let mut sections_to_send = match section_config.detection_method {
                        tracematch::DetectionMethod::Corridor => {
                            log::info!(
                                "tracematch: [SectionDetection] Corridor detection on {} tracks",
                                tracks.len()
                            );
                            tracematch::detect_sections_corridor(
                                &tracks,
                                &sport_map,
                                &section_config,
                            )
                        }
                        tracematch::DetectionMethod::FlowGraph => {
                            log::info!(
                                "tracematch: [SectionDetection] Flow graph detection on {} tracks",
                                tracks.len()
                            );
                            tracematch::detect_sections_flow_graph(
                                &tracks,
                                &sport_map,
                                &section_config,
                            )
                        }
                        tracematch::DetectionMethod::DensityGrid => {
                            log::info!(
                                "tracematch: [SectionDetection] Density grid detection on {} tracks",
                                tracks.len()
                            );
                            let result = tracematch::detect_sections_multiscale_with_progress(
                                &tracks,
                                &sport_map,
                                &groups,
                                &section_config,
                                Arc::new(ClusteringAwareProgress::new(progress_clone.clone())),
                            );
                            log::info!(
                                "tracematch: [SectionDetection] {} sections, {} potentials",
                                result.sections.len(),
                                result.potentials.len()
                            );
                            result.sections
                        }
                        tracematch::DetectionMethod::Unified => unreachable!(
                            "Unified runs the order-free incremental in the branch above"
                        ),
                    };

                    log::info!(
                        "tracematch: [SectionDetection] Detection complete: {} sections",
                        sections_to_send.len()
                    );
                    seed_consensus_state(
                        &mut sections_to_send,
                        &tracks,
                        section_config.proximity_threshold,
                    );

                    // Signal saving phase before sending results for DB persistence
                    progress_clone.set_phase("saving", 1);
                    tx.send((sections_to_send, all_activity_ids)).ok();
                } else {
                    // Large dataset: process in batches
                    let num_batches = (tracks.len() + BATCH_CAP - 1) / BATCH_CAP;
                    log::info!(
                        "tracematch: [SectionDetection] Batched mode: {} activities in {} batches of up to {}",
                        tracks.len(),
                        num_batches,
                        BATCH_CAP
                    );

                    // Batch 1: full detection on first BATCH_CAP activities
                    let batch1_tracks = &tracks[..BATCH_CAP.min(tracks.len())];
                    let result = tracematch::detect_sections_multiscale_with_progress(
                        batch1_tracks,
                        &sport_map,
                        &groups,
                        &section_config,
                        Arc::new(ClusteringAwareProgress::new(progress_clone.clone())),
                    );

                    let mut accumulated_sections = result.sections;
                    log::info!(
                        "tracematch: [SectionDetection] Batch 1/{}: {} sections from {} activities",
                        num_batches,
                        accumulated_sections.len(),
                        batch1_tracks.len()
                    );

                    // Subsequent batches: incremental detection against accumulated sections
                    let mut batch_start = BATCH_CAP;
                    let mut batch_num = 2;
                    while batch_start < tracks.len() {
                        let batch_end = (batch_start + BATCH_CAP).min(tracks.len());
                        let batch_tracks = &tracks[batch_start..batch_end];

                        log::info!(
                            "tracematch: [SectionDetection] Batch {}/{}: {} new activities against {} sections",
                            batch_num,
                            num_batches,
                            batch_tracks.len(),
                            accumulated_sections.len()
                        );

                        let incr_result =
                            tracematch::sections::incremental::detect_sections_incremental(
                                batch_tracks,
                                &accumulated_sections,
                                &tracks, // all tracks for consensus
                                &sport_map,
                                &groups,
                                &section_config,
                                Arc::new(ClusteringAwareProgress::new(progress_clone.clone())),
                            );

                        // Replace accumulated with updated + new
                        accumulated_sections = incr_result.updated_sections;
                        accumulated_sections.extend(incr_result.new_sections);

                        log::info!(
                            "tracematch: [SectionDetection] Batch {}/{}: now {} total sections ({} matched, {} unmatched)",
                            batch_num,
                            num_batches,
                            accumulated_sections.len(),
                            incr_result.matched_activity_ids.len(),
                            incr_result.unmatched_activity_ids.len(),
                        );

                        batch_start = batch_end;
                        batch_num += 1;
                    }

                    log::info!(
                        "tracematch: [SectionDetection] Batched detection complete: {} sections",
                        accumulated_sections.len()
                    );

                    // Tier 2: seed consensus_state. Sections from the first
                    // batch's full detection arrive with None; subsequent
                    // batches' updated-sections already carry accumulators,
                    // so seed is a no-op for those and only pays for the
                    // first-batch sections and any new sections from later
                    // batches' unmatched-pool detections.
                    seed_consensus_state(
                        &mut accumulated_sections,
                        &tracks,
                        section_config.proximity_threshold,
                    );

                    // Signal saving phase before sending results for DB persistence
                    progress_clone.set_phase("saving", 1);
                    tx.send((accumulated_sections, all_activity_ids)).ok();
                }
            }
        });

        SectionDetectionHandle {
            receiver: rx,
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
        let visible = self.section_identity_apply_into(&mut trial_identity, sections);
        let old_sections = std::mem::replace(&mut self.sections, visible);
        match self.save_sections() {
            Ok(()) => {
                self.identity = trial_identity;
                self.raw_sections = raw_for_convergence;
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
                Ok(())
            }
            Err(e) => {
                self.sections = old_sections;
                Err(e)
            }
        }
    }

    /// Cache-aware hot save: `apply_sections_save`, then advance the Unified
    /// evidence cache iff the save succeeded. `update` is the worker's
    /// `CacheUpdate` for the Unified path, or None for the legacy detectors and
    /// the no-new-activities short-circuit (nothing to advance — the cache is
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
        match self.apply_sections_save(sections) {
            Ok(()) => {
                if let Some(u) = update {
                    self.section_evidence_cache = u.cache;
                    self.cache_folded_ids = u.folded_ids;
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

    /// Deferred tail of apply_sections: cross-sport merge + activity-
    /// indicator recompute. Both are best-effort (errors are logged, not
    /// returned) because they don't affect the ability to query the just-
    /// saved sections - they only refine derived state. Safe to invoke on
    /// a background thread after `apply_sections_save` returns.
    pub fn apply_sections_finalize(&mut self) {
        self.apply_sections_finalize_with_progress(None);
    }

    /// Variant that emits phase markers to the supplied progress tracker
    /// so the UI can show "still working on cross-sport merge / indicator
    /// recompute" instead of a frozen-looking 100% bar (Tier 4).
    pub fn apply_sections_finalize_with_progress(
        &mut self,
        progress: Option<&super::super::SectionDetectionProgress>,
    ) {
        if let Some(p) = progress {
            p.set_phase("merging_cross_sport", 1);
        }
        if let Err(e) = self.merge_cross_sport_sections() {
            log::warn!(
                "tracematch: [apply_sections_finalize] Cross-sport merge failed: {}",
                e
            );
        }
        if let Some(p) = progress {
            p.increment();
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
