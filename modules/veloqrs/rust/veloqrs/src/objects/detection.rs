use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::with_persistent_engine;
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

    fn start(&self, sport_filter: Option<String>) -> bool {
        {
            let handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();
            if handle_guard.is_some() {
                info!("tracematch: [DetectionManager] Section detection already running");
                return false;
            }
        }

        let handle = with_persistent_engine(|e| e.detect_sections_background(sport_filter));

        if let Some(h) = handle {
            let mut handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();
            *handle_guard = Some(h);
            info!("tracematch: [DetectionManager] Section detection started");
            true
        } else {
            info!("tracematch: [DetectionManager] Failed to start section detection");
            false
        }
    }

    fn poll(&self) -> String {
        let mut handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();

        if handle_guard.is_none() {
            return "idle".to_string();
        }

        let result = handle_guard.as_ref().unwrap().try_recv();

        match result {
            Some((sections, detection_activity_ids)) => {
                let applied = with_persistent_engine(|e| {
                    if let Err(err) = e.apply_sections(sections) {
                        log::error!("apply_sections failed: {}", err);
                        return None;
                    }
                    e.save_processed_activity_ids(&detection_activity_ids).ok();
                    Some(())
                });

                *handle_guard = None;

                if applied.is_some() {
                    info!("tracematch: [DetectionManager] Section detection complete");
                    "complete".to_string()
                } else {
                    "error".to_string()
                }
            }
            None => "running".to_string(),
        }
    }

    fn get_progress(&self) -> String {
        let handle_guard = SECTION_DETECTION_HANDLE.lock().unwrap();

        if let Some(handle) = handle_guard.as_ref() {
            let (phase, completed, total) = handle.get_progress();
            format!(
                r#"{{"phase":"{}","completed":{},"total":{}}}"#,
                phase, completed, total
            )
        } else {
            "{}".to_string()
        }
    }

    fn detect_potentials(&self, sport_filter: Option<String>) -> String {
        with_persistent_engine(|e| {
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
                return "[]".to_string();
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
                return "[]".to_string();
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

            serde_json::to_string(&result.potentials).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }
}
