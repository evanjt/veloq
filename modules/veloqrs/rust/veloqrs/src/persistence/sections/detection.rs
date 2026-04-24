//! Background section detection and application.

use crate::{FrequentSection, GpsPoint};
use rusqlite::{Connection, Result as SqlResult, params};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;

use super::super::{
    ClusteringAwareProgress, PersistentRouteEngine, SectionDetectionHandle,
    SectionDetectionProgress, load_groups_from_db,
};

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
///   incremental detection — correct but slow. Subsequent syncs pick up
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
/// `false` — they hold their own engine and don't need the singleton.
pub fn run_accumulator_backfill(
    db_path: &str,
    refresh_engine: bool,
) -> Result<(u32, u32), String> {
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
        // query — cheaper than N separate query_row round-trips, especially on
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
                    let track: Vec<tracematch::GpsPoint> = rmp_serde::from_slice(&bytes)
                        .unwrap_or_default();
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

        match rmp_serde::to_vec(&acc) {
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

    // Mark the flag even if some were skipped — we only want to pay the
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
    // held by a concurrent operation, skip — the engine will pick them up
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
            log::info!(
                "tracematch: [accum backfill] engine busy, deferring reload to next start"
            );
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
        let db_path = self.db_path.clone();
        let section_config = self.section_config.clone();

        // Create shared progress tracker
        let progress = SectionDetectionProgress::new();
        let progress_clone = progress.clone();

        // Ensure groups are computed before section detection.
        if self.groups_dirty {
            log::info!(
                "tracematch: [SectionDetection] Computing route groups before section detection..."
            );
            let start = std::time::Instant::now();
            let _ = self.get_groups();
            log::info!(
                "tracematch: [SectionDetection] Route groups computed in {:?}",
                start.elapsed()
            );
        }

        // Build sport type map
        let sport_map: HashMap<String, String> = self
            .activity_metadata
            .values()
            .map(|m| (m.id.clone(), m.sport_type.clone()))
            .collect();

        // Filter activity IDs by sport
        let activity_ids: Vec<String> = if let Some(ref sport) = sport_filter {
            self.activity_metadata
                .values()
                .filter(|m| &m.sport_type == sport)
                .map(|m| m.id.clone())
                .collect()
        } else {
            self.activity_metadata.keys().cloned().collect()
        };

        // Determine if incremental detection is possible:
        // - Must have existing sections
        // - New (unprocessed) activities must be < 50% of total
        // Use persistent tracking table (includes activities that didn't match any section)
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
            return SectionDetectionHandle {
                receiver: rx,
                progress,
            };
        }

        // Threshold tuned for correctness, not just perf. Tried raising
        // 0.5 → 0.9 (mirroring the grouping fix) but scenario F drift
        // went from 2% to 73% — incremental on 72% new misses sections
        // because the unmatched-pool's full detection only sees the new
        // tracks, not the existing 28% they should pair with. Grouping
        // doesn't have this issue because group_incremental queries new
        // signatures against the union R-tree of existing+new. Section
        // incremental's "match new against existing sections, then full
        // on unmatched" loses cross-pairs at the boundary.
        const INCREMENTAL_THRESHOLD: f64 = 0.5;

        let use_incremental = !existing_sections.is_empty()
            && !new_activity_ids.is_empty()
            && (new_activity_ids.len() as f64) < (activity_ids.len() as f64 * INCREMENTAL_THRESHOLD);

        if use_incremental {
            log::info!(
                "tracematch: [SectionDetection] Using INCREMENTAL mode: {} new of {} total activities, {} existing sections",
                new_activity_ids.len(),
                activity_ids.len(),
                existing_sections.len()
            );
        } else if !new_activity_ids.is_empty() && !existing_sections.is_empty() {
            log::info!(
                "tracematch: [SectionDetection] Using FULL mode: {} new of {} total activities (>{:.0}% threshold)",
                new_activity_ids.len(),
                activity_ids.len(),
                INCREMENTAL_THRESHOLD * 100.0,
            );
        }

        // For incremental mode, only load tracks for new activities + the
        // subset of section-referenced activities whose sections could
        // geographically overlap the new activities. The naive approach
        // (load every section-referenced activity) loaded ~500 tracks for a
        // 500-activity corpus even when only 1 activity was new — the
        // dominant cost in the "add 1 activity" lag path. The bbox
        // pre-filter typically cuts this to dozens.
        let ids_to_load = if use_incremental {
            let mut needed: HashSet<String> = new_activity_ids.iter().cloned().collect();

            // 1. Compute new-activity bbox set from cached activity_metadata
            //    bounds (no DB read, no GPS parse).
            let new_bounds: Vec<tracematch::Bounds> = new_activity_ids
                .iter()
                .filter_map(|id| self.activity_metadata.get(id).map(|m| m.bounds.clone()))
                .collect();

            if new_bounds.is_empty() {
                // No bounds metadata for new activities (shouldn't happen
                // for synced activities but guard anyway). Fall back to the
                // safe-but-slow path: load every section-referenced track.
                for section in &existing_sections {
                    for aid in &section.activity_ids {
                        needed.insert(aid.clone());
                    }
                }
            } else {
                // 2. For each existing section, compute its bbox from the
                //    polyline (small allocation, well under detection cost)
                //    and check whether any new-activity bbox overlaps it
                //    within 2x the proximity threshold (matches the buffer
                //    used by the overlap detector itself).
                let buffer_meters = section_config.proximity_threshold * 2.0;

                let mut sections_loaded = 0usize;
                for section in &existing_sections {
                    if section.polyline.len() < 2 {
                        // Defensive: include polyline-less sections so we
                        // don't drop their consensus state by accident.
                        for aid in &section.activity_ids {
                            needed.insert(aid.clone());
                        }
                        sections_loaded += 1;
                        continue;
                    }
                    let section_bounds = tracematch::geo_utils::compute_bounds(&section.polyline);
                    let ref_lat = (section_bounds.min_lat + section_bounds.max_lat) / 2.0;

                    let overlaps = new_bounds.iter().any(|b| {
                        tracematch::geo_utils::bounds_overlap(
                            b,
                            &section_bounds,
                            buffer_meters,
                            ref_lat,
                        )
                    });

                    if overlaps {
                        for aid in &section.activity_ids {
                            needed.insert(aid.clone());
                        }
                        sections_loaded += 1;
                    }
                }

                if log::log_enabled!(log::Level::Info) {
                    let naive_count = {
                        let mut naive: HashSet<&String> = new_activity_ids.iter().collect();
                        for s in &existing_sections {
                            for a in &s.activity_ids {
                                naive.insert(a);
                            }
                        }
                        naive.len()
                    };
                    log::info!(
                        "tracematch: [SectionDetection] bbox pre-filter: {} of {} existing sections nearby — loading {} tracks (naive {})",
                        sections_loaded,
                        existing_sections.len(),
                        needed.len(),
                        naive_count,
                    );
                }
            }

            needed.into_iter().collect()
        } else {
            activity_ids.clone()
        };
        progress.set_phase("loading", ids_to_load.len() as u32);

        // Clone activity_ids for the background thread (to persist as processed after detection)
        let all_activity_ids = activity_ids.clone();

        thread::spawn(move || {
            log::info!(
                "tracematch: [SectionDetection] Background thread started with {} activity IDs",
                ids_to_load.len()
            );

            let conn = match Connection::open(&db_path) {
                Ok(c) => c,
                Err(e) => {
                    log::info!("tracematch: [SectionDetection] Failed to open DB: {:?}", e);
                    tx.send((Vec::new(), Vec::new())).ok();
                    return;
                }
            };

            let groups = load_groups_from_db(&conn);
            log::info!(
                "tracematch: [SectionDetection] Loaded {} groups from DB",
                groups.len()
            );

            progress_clone.set_phase("loading", ids_to_load.len() as u32);

            // Tier 3: single IN(...) query to load every needed track in one
            // round-trip, instead of preparing + executing N statements inside
            // the loop. For scenario E (550 tracks) this cuts the per-row
            // prepare/plan overhead; the msgpack decode cost per track is
            // unchanged. SQLite's IN-list limit is 32k — safely above any
            // realistic batch. Progress still ticks per-track so the UI
            // animates through the phase at the same cadence.
            let mut tracks_loaded = 0;
            let mut tracks_empty = 0;
            let tracks: Vec<(String, Vec<GpsPoint>)> = if ids_to_load.is_empty() {
                Vec::new()
            } else {
                let placeholders: String = std::iter::repeat("?")
                    .take(ids_to_load.len())
                    .collect::<Vec<_>>()
                    .join(",");
                let sql = format!(
                    "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
                    placeholders
                );
                let mut loaded: HashMap<String, Vec<GpsPoint>> = HashMap::new();
                match conn.prepare(&sql) {
                    Ok(mut stmt) => {
                        let params_slice: Vec<&dyn rusqlite::ToSql> = ids_to_load
                            .iter()
                            .map(|id| id as &dyn rusqlite::ToSql)
                            .collect();
                        let rows = stmt.query_map(params_slice.as_slice(), |row| {
                            let id: String = row.get(0)?;
                            let blob: Vec<u8> = row.get(1)?;
                            let track: Vec<GpsPoint> = rmp_serde::from_slice(&blob)
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
                            "tracematch: [SectionDetection] Batch prepare failed: {:?}; loaded=0",
                            e
                        );
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

            if use_incremental {
                // Incremental mode: match new activities against existing sections
                let new_set: HashSet<String> = new_activity_ids.into_iter().collect();
                let new_tracks: Vec<(String, Vec<GpsPoint>)> = tracks
                    .iter()
                    .filter(|(id, _)| new_set.contains(id))
                    .cloned()
                    .collect();

                log::info!(
                    "tracematch: [SectionDetection] Incremental: {} new tracks to match against {} sections",
                    new_tracks.len(),
                    existing_sections.len()
                );

                let result = tracematch::sections::incremental::detect_sections_incremental(
                    &new_tracks,
                    &existing_sections,
                    &tracks, // all tracks for consensus recalc
                    &sport_map,
                    &groups,
                    &section_config,
                    Arc::new(ClusteringAwareProgress::new(progress_clone.clone())),
                );

                log::info!(
                    "tracematch: [SectionDetection] Incremental complete: {} updated, {} new, {} matched, {} unmatched",
                    result.updated_sections.len(),
                    result.new_sections.len(),
                    result.matched_activity_ids.len(),
                    result.unmatched_activity_ids.len(),
                );

                // Merge: updated existing + newly discovered
                let mut all_sections = result.updated_sections;
                all_sections.extend(result.new_sections);

                // Tier 2: seed consensus_state for any newly-discovered section
                // that lacks one. Incremental-path updates already carry an
                // accumulator, so this only touches new_sections.
                seed_consensus_state(
                    &mut all_sections,
                    &tracks,
                    section_config.proximity_threshold,
                );

                // Signal saving phase before sending results for DB persistence
                progress_clone.set_phase("saving", 1);
                tx.send((all_sections, all_activity_ids)).ok();
            } else {
                // Full detection mode with batching for large datasets.
                // Cap full pairwise detection at BATCH_CAP activities per batch.
                // Subsequent batches use incremental detection against results from prior batches.
                const BATCH_CAP: usize = 500;

                if tracks.len() <= BATCH_CAP {
                    // Small enough for single-pass full detection
                    let result = tracematch::detect_sections_multiscale_with_progress(
                        &tracks,
                        &sport_map,
                        &groups,
                        &section_config,
                        Arc::new(ClusteringAwareProgress::new(progress_clone.clone())),
                    );

                    log::info!(
                        "tracematch: [SectionDetection] Detection complete: {} sections, {} potentials",
                        result.sections.len(),
                        result.potentials.len()
                    );

                    // Tier 2: seed consensus_state for every section produced by
                    // the full-detection pipeline — tracematch emits them with
                    // None and the next incremental add otherwise falls into the
                    // expensive first-touch backfill (scenario C's ~1.5 s).
                    let mut sections_to_send = result.sections;
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
            progress,
        }
    }

    /// Hot path of apply_sections: replace in-memory sections, persist
    /// them to SQLite, clear the relevant LRU caches. Returns as soon as
    /// the new section set is durably saved and queryable from in-memory
    /// reads. Does NOT do the cross-sport merge or the indicator
    /// recompute — those are the deferred tail
    /// (`apply_sections_finalize`) so callers that want the UI interactive
    /// can return after `_save` and do the tail on a background thread.
    ///
    /// If `save_sections` fails the prior in-memory state is restored —
    /// the rollback contract is unchanged from the monolithic
    /// `apply_sections`.
    pub fn apply_sections_save(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        let old_sections = std::mem::replace(&mut self.sections, sections);
        match self.save_sections() {
            Ok(()) => {
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

    /// Deferred tail of apply_sections: cross-sport merge + activity-
    /// indicator recompute. Both are best-effort (errors are logged, not
    /// returned) because they don't affect the ability to query the just-
    /// saved sections — they only refine derived state. Safe to invoke on
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
