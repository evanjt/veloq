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

#[uniffi::export]
impl DetectionManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn start(&self, sport_filter: Option<String>) -> Result<bool, VeloqError> {
        {
            let handle_guard = SECTION_DETECTION_HANDLE
                .lock()
                .map_err(|_| VeloqError::LockFailed)?;
            if handle_guard.is_some() {
                info!("tracematch: [DetectionManager] Section detection already running");
                return Ok(false);
            }
        }

        let handle = with_engine(|e| e.detect_sections_background(sport_filter))?;

        let mut handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;
        *handle_guard = Some(handle);
        info!("tracematch: [DetectionManager] Section detection started");
        Ok(true)
    }

    fn poll(&self) -> Result<String, VeloqError> {
        let mut handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;

        if handle_guard.is_none() {
            return Ok("idle".to_string());
        }

        let result = handle_guard.as_ref().unwrap().try_recv();

        match result {
            Some((sections, detection_activity_ids)) => {
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

                with_engine(|e| {
                    if let Err(err) = e.apply_sections_save(sections) {
                        log::error!("apply_sections_save failed: {}", err);
                        return Err(VeloqError::Database {
                            msg: format!("apply_sections_save failed: {}", err),
                        });
                    }
                    if let Err(err) = e.save_processed_activity_ids(&detection_activity_ids) {
                        log::error!("save_processed_activity_ids failed: {}", err);
                    }
                    e.apply_sections_finalize_with_progress(progress.as_ref());
                    Ok(())
                })??;

                *handle_guard = None;
                info!("tracematch: [DetectionManager] Section detection complete");
                Ok("complete".to_string())
            }
            None => Ok("running".to_string()),
        }
    }

    fn get_progress(&self) -> Result<Option<crate::FfiDetectionProgress>, VeloqError> {
        let handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;

        Ok(handle_guard.as_ref().map(|handle| {
            let (phase, completed, total) = handle.get_progress();
            crate::FfiDetectionProgress {
                phase,
                completed,
                total,
            }
        }))
    }

    /// Force full re-detection by clearing processed activity IDs first.
    /// This ensures all activities are re-evaluated against sections.
    /// Returns false if detection is already running.
    fn force_redetect(&self, sport_filter: Option<String>) -> Result<bool, VeloqError> {
        {
            let handle_guard = SECTION_DETECTION_HANDLE
                .lock()
                .map_err(|_| VeloqError::LockFailed)?;
            if handle_guard.is_some() {
                info!("tracematch: [DetectionManager] Cannot force redetect: detection already running");
                return Ok(false);
            }
        }

        // Clear processed activity IDs to force full re-evaluation
        with_engine(|e| {
            e.clear_processed_activity_ids();
        })?;

        let handle = with_engine(|e| e.detect_sections_background(sport_filter))?;

        let mut handle_guard = SECTION_DETECTION_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;
        *handle_guard = Some(handle);
        info!("tracematch: [DetectionManager] Forced full section re-detection started");
        Ok(true)
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
