use super::error::{with_engine, VeloqError};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tracematch::sections::SectionConfig;
use tracematch::GpsPoint;

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
            let handle_guard = SECTION_DETECTION_HANDLE.lock().map_err(|_| VeloqError::LockFailed)?;
            if handle_guard.is_some() {
                info!("tracematch: [DetectionManager] Section detection already running");
                return Ok(false);
            }
        }

        let handle = with_engine(|e| e.detect_sections_background(sport_filter))?;

        let mut handle_guard = SECTION_DETECTION_HANDLE.lock().map_err(|_| VeloqError::LockFailed)?;
        *handle_guard = Some(handle);
        info!("tracematch: [DetectionManager] Section detection started");
        Ok(true)
    }

    fn poll(&self) -> Result<String, VeloqError> {
        let mut handle_guard = SECTION_DETECTION_HANDLE.lock().map_err(|_| VeloqError::LockFailed)?;

        if handle_guard.is_none() {
            return Ok("idle".to_string());
        }

        let result = handle_guard.as_ref().unwrap().try_recv();

        match result {
            Some((sections, detection_activity_ids)) => {
                with_engine(|e| {
                    if let Err(err) = e.apply_sections(sections) {
                        log::error!("apply_sections failed: {}", err);
                        return Err(VeloqError::Database {
                            msg: format!("apply_sections failed: {}", err),
                        });
                    }
                    e.save_processed_activity_ids(&detection_activity_ids).ok();

                    // Spawn background heatmap tile generation after sections are applied
                    if let Some(handle) = e.generate_tiles_background() {
                        if let Ok(mut guard) = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE.lock() {
                            *guard = Some(handle);
                        }
                    }

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
        let handle_guard = SECTION_DETECTION_HANDLE.lock().map_err(|_| VeloqError::LockFailed)?;

        Ok(handle_guard.as_ref().map(|handle| {
            let (phase, completed, total) = handle.get_progress();
            crate::FfiDetectionProgress {
                phase,
                completed,
                total,
            }
        }))
    }

    fn detect_potentials(&self, sport_filter: Option<String>) -> Result<Vec<crate::FfiPotentialSection>, VeloqError> {
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
                &tracks,
                &sport_map,
                &groups,
                &config,
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
