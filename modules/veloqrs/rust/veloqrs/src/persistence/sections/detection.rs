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

        let use_incremental = !existing_sections.is_empty()
            && !new_activity_ids.is_empty()
            && (new_activity_ids.len() as f64) < (activity_ids.len() as f64 * 0.5);

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
                50.0
            );
        }

        // For incremental mode, only load tracks for new activities + section-referenced activities
        let ids_to_load = if use_incremental {
            let mut needed: HashSet<String> = new_activity_ids.iter().cloned().collect();
            for section in &existing_sections {
                for aid in &section.activity_ids {
                    needed.insert(aid.clone());
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

            // Load GPS tracks from DB
            let mut tracks_loaded = 0;
            let mut tracks_empty = 0;
            let tracks: Vec<(String, Vec<GpsPoint>)> = ids_to_load
                .iter()
                .filter_map(|id| {
                    progress_clone.increment();
                    let mut stmt = conn
                        .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
                        .ok()?;
                    let track: Vec<GpsPoint> = stmt
                        .query_row(params![id], |row| {
                            let blob: Vec<u8> = row.get(0)?;
                            match rmp_serde::from_slice(&blob) {
                                Ok(t) => Ok(t),
                                Err(e) => {
                                    log::warn!(
                                        "tracematch: [SectionDetection] Skipping malformed track data for {}: {:?}",
                                        id, e
                                    );
                                    Ok(Vec::new())
                                }
                            }
                        })
                        .ok()?;
                    if track.is_empty() {
                        tracks_empty += 1;
                        return None;
                    }
                    tracks_loaded += 1;
                    Some((id.clone(), track))
                })
                .collect();

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

                    // Signal saving phase before sending results for DB persistence
                    progress_clone.set_phase("saving", 1);
                    tx.send((result.sections, all_activity_ids)).ok();
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

    /// Apply completed section detection results.
    /// Saves to DB first, only updates in-memory state on success.
    pub fn apply_sections(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        let old_sections = std::mem::replace(&mut self.sections, sections);
        match self.save_sections() {
            Ok(()) => {
                self.sections_dirty = false;
                // Clear activity_traces to prevent memory leak.
                // These GPS traces were used for consensus computation but are not persisted
                // to SQLite, so keeping them in memory is wasteful.
                for section in &mut self.sections {
                    section.activity_traces.clear();
                }
                // Invalidate section LRU cache since sections changed
                self.section_cache.clear();
                self.invalidate_perf_cache();

                // Merge sections that overlap geographically across different sport types
                if let Err(e) = self.merge_cross_sport_sections() {
                    log::warn!(
                        "tracematch: [apply_sections] Cross-sport merge failed: {}",
                        e
                    );
                }

                // Recompute materialized PR/trend indicators
                if let Err(e) = self.recompute_activity_indicators() {
                    log::warn!(
                        "tracematch: [apply_sections] Indicator recomputation failed: {}",
                        e
                    );
                }

                Ok(())
            }
            Err(e) => {
                // Rollback in-memory state on DB failure
                self.sections = old_sections;
                Err(e)
            }
        }
    }
}
