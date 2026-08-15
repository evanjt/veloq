use super::error::{VeloqError, with_engine};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tracematch::GpsPoint;
use tracematch::sections::SectionConfig;

#[derive(uniffi::Object)]
pub struct DetectionManager {
    pub(crate) _private: (),
}

/// Outcome of one poll of the shared background-detection handle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DetectionPoll {
    Idle,
    Running,
    Applied,
    Died,
}

/// Poll the shared detection handle once and, when the worker has finished,
/// apply its results under the engine lock. Shared by the FFI poll (the TS
/// sync UI) and the conditioning driver: whichever caller polls Ready first
/// applies, the other sees Idle on its next poll.
pub(crate) fn poll_detection_once() -> Result<DetectionPoll, VeloqError> {
    let mut handle_guard = SECTION_DETECTION_HANDLE
        .lock()
        .map_err(|_| VeloqError::LockFailed)?;

    if handle_guard.is_none() {
        return Ok(DetectionPoll::Idle);
    }

    let result = handle_guard.as_ref().unwrap().poll_state();

    match result {
        crate::persistence::WorkerPoll::Died => {
            // The worker thread died without sending (panic or early
            // abort). Clear the handle so the next start() can run,
            // otherwise detection is blocked for the rest of the session.
            *handle_guard = None;
            log::error!("tracematch: [DetectionManager] Detection thread died without a result");
            Ok(DetectionPoll::Died)
        }
        crate::persistence::WorkerPoll::Ready((sections, detection_activity_ids)) => {
            // Tier 1.1 split: hot save + processed_ids return synchronously
            // (sections are queryable immediately), then run the
            // cross-sport merge + indicator recompute under the engine
            // lock as the deferred tail. The total wall-clock is
            // unchanged on the write side, but get_progress() callers
            // see the apply tail emit phase events
            // (merging_cross_sport / recomputing_indicators / complete)
            // and the UI can keep showing forward motion instead of
            // freezing on a stalled "100%" bar.
            let progress = handle_guard.as_ref().map(|h| h.progress.clone());

            // Take the Unified evidence-cache update (None for the legacy
            // detectors and the short-circuit) BEFORE clearing the handle. The
            // main result is already Ready, and the worker sends the cache
            // first, so it is present now.
            let cache_update = handle_guard.as_ref().and_then(|h| h.take_cache());

            // The channel message is consumed, so this run is over whatever
            // happens next. Clear the handle before the fallible apply so
            // an apply error cannot leave detection permanently "running"
            // on a drained channel.
            *handle_guard = None;
            drop(handle_guard);

            // Hot save under the write lock - sections are queryable as soon
            // as this returns. The cache is adopted only if the save succeeds
            // and dropped if it fails, so it never outruns the applied
            // catalogue.
            with_engine(|e| {
                if let Err(err) = e.apply_sections_save_with_cache(sections, cache_update) {
                    log::error!("apply_sections_save failed: {}", err);
                    return Err(VeloqError::Database {
                        msg: format!("apply_sections_save failed: {}", err),
                    });
                }
                if let Err(err) = e.save_processed_activity_ids(&detection_activity_ids) {
                    // Non-fatal: sections WERE saved above. The
                    // consequence is that the next sync will re-detect
                    // these activities (wasted work, not data loss).
                    // Logging at warn-level with explicit "partial
                    // success" so it's distinguishable from the fatal
                    // apply_sections_save case above.
                    log::warn!(
                        "tracematch: [DetectionManager] poll: detection apply partially \
                         succeeded - sections saved but save_processed_activity_ids \
                         failed ({} ids): {}. Next sync will re-process these activities.",
                        detection_activity_ids.len(),
                        err
                    );
                }
                Ok(())
            })??;

            // Release the write lock above before the finalize tail so any
            // queued reads see the saved sections during the cross-sport
            // merge + indicator recompute, which re-takes a separate lock.
            with_engine(|e| {
                e.apply_sections_finalize_with_progress(progress.as_ref());
                // Reload groups from DB in case the background thread
                // recomputed and saved them.
                e.reload_groups_from_db();
                Ok(())
            })??;

            info!("tracematch: [DetectionManager] Section detection complete");
            Ok(DetectionPoll::Applied)
        }
        crate::persistence::WorkerPoll::Running => Ok(DetectionPoll::Running),
    }
}

#[uniffi::export]
impl DetectionManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn start(&self) -> Result<bool, VeloqError> {
        {
            let handle_guard = SECTION_DETECTION_HANDLE
                .lock()
                .map_err(|_| VeloqError::LockFailed)?;
            if handle_guard.is_some() {
                info!("tracematch: [DetectionManager] Section detection already running");
                return Ok(false);
            }
        }

        let handle = with_engine(|e| e.detect_sections_background())?;

        let mut handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;
        *handle_guard = Some(handle);
        info!("tracematch: [DetectionManager] Section detection started");
        Ok(true)
    }

    fn poll(&self) -> Result<String, VeloqError> {
        Ok(match poll_detection_once()? {
            DetectionPoll::Idle => "idle".to_string(),
            DetectionPoll::Running => "running".to_string(),
            DetectionPoll::Applied => "complete".to_string(),
            DetectionPoll::Died => "error".to_string(),
        })
    }

    fn get_progress(&self) -> Result<Option<crate::FfiDetectionProgress>, VeloqError> {
        let handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;

        Ok(handle_guard.as_ref().map(|handle| {
            let (phase, completed, total) = handle.get_progress();
            let percent = handle.progress.get_percent();
            crate::FfiDetectionProgress {
                phase,
                completed,
                total,
                percent,
            }
        }))
    }

    /// Force full re-detection by clearing processed activity IDs first.
    /// This ensures all activities are re-evaluated against sections.
    /// Returns false if detection is already running.
    fn force_redetect(&self) -> Result<bool, VeloqError> {
        {
            let handle_guard = SECTION_DETECTION_HANDLE
                .lock()
                .map_err(|_| VeloqError::LockFailed)?;
            if handle_guard.is_some() {
                info!(
                    "tracematch: [DetectionManager] Cannot force redetect: detection already running"
                );
                return Ok(false);
            }
        }

        // Clear processed activity IDs to force full re-evaluation
        with_engine(|e| {
            e.clear_processed_activity_ids();
        })?;

        let handle = with_engine(|e| e.detect_sections_background())?;

        let mut handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;
        *handle_guard = Some(handle);
        info!("tracematch: [DetectionManager] Forced full section re-detection started");
        Ok(true)
    }

    fn set_config(&self, config: crate::FfiSectionConfig) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_section_config(config.into());
        })
    }

    fn get_config(&self) -> Result<crate::FfiSectionConfig, VeloqError> {
        with_engine(|e| crate::FfiSectionConfig::from(&e.section_config))
    }

    fn set_match_strictness(
        &self,
        min_match_pct: f64,
        endpoint_threshold: f64,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.match_config.min_match_percentage = min_match_pct;
            e.match_config.endpoint_threshold = endpoint_threshold;
            e.set_setting(
                crate::persistence::settings_keys::MATCH_MIN_MATCH_PCT,
                &min_match_pct.to_string(),
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("persist match_min_match_pct failed: {}", err),
            })?;
            e.set_setting(
                crate::persistence::settings_keys::MATCH_ENDPOINT_THRESHOLD,
                &endpoint_threshold.to_string(),
            )
            .map_err(|err| VeloqError::Database {
                msg: format!("persist match_endpoint_threshold failed: {}", err),
            })?;
            Ok::<(), VeloqError>(())
        })??;
        Ok(())
    }

    fn get_match_strictness(&self) -> Result<crate::FfiMatchStrictness, VeloqError> {
        with_engine(|e| crate::FfiMatchStrictness {
            min_match_pct: e.match_config.min_match_percentage,
            endpoint_threshold: e.match_config.endpoint_threshold,
        })
    }

    fn detect_potentials(
        &self,
        sport_filter: Option<String>,
    ) -> Result<Vec<crate::FfiPotentialSection>, VeloqError> {
        with_engine(|e| {
            let activity_ids: Vec<String> = if let Some(ref sport) = sport_filter {
                e.activity_metadata
                    .values()
                    .filter(|m| &m.sport_type == sport)
                    .map(|m| m.id.clone())
                    .collect()
            } else {
                e.activity_metadata.keys().cloned().collect()
            };

            if activity_ids.is_empty() {
                return vec![];
            }

            let mut tracks: Vec<(String, Vec<GpsPoint>)> = Vec::new();
            for id in &activity_ids {
                if let Some(track) = e.get_gps_track(id) {
                    if track.len() >= 4 {
                        tracks.push((id.to_string(), track));
                    }
                }
            }

            if tracks.is_empty() {
                return vec![];
            }

            let sport_map: HashMap<String, String> = e
                .activity_metadata
                .values()
                .map(|m| (m.id.clone(), m.sport_type.clone()))
                .collect();

            let config = SectionConfig {
                include_potentials: true,
                min_activities: 1,
                ..e.section_config.clone()
            };

            let groups = e.get_groups();

            info!(
                "tracematch: [DetectionManager] Detecting potentials from {} tracks",
                tracks.len()
            );

            let result = tracematch::sections::detect_sections_multiscale(
                &tracks, &sport_map, &groups, &config,
            );

            info!(
                "tracematch: [DetectionManager] Found {} potential sections",
                result.potentials.len()
            );

            result
                .potentials
                .into_iter()
                .map(crate::FfiPotentialSection::from)
                .collect()
        })
    }
}
