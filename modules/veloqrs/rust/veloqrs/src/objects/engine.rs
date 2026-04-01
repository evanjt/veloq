use super::error::{VeloqError, with_engine};
use crate::init_logging;
use crate::persistence::{NAME_TRANSLATIONS, PERSISTENT_ENGINE, PersistentEngineStats};
use log::info;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct VeloqEngine {
    #[allow(dead_code)]
    db_path: String,
}

#[uniffi::export]
impl VeloqEngine {
    #[uniffi::constructor]
    fn create(db_path: String) -> Arc<Self> {
        init_logging();

        let already = PERSISTENT_ENGINE
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false);

        if !already {
            info!("[VeloqEngine] Initializing at {}", db_path);
            crate::persistence::persistent_engine_ffi::persistent_engine_init(db_path.clone());
        }

        Arc::new(Self { db_path })
    }

    fn is_initialized(&self) -> bool {
        PERSISTENT_ENGINE
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn get_stats(&self) -> Result<PersistentEngineStats, VeloqError> {
        with_engine(|e| e.stats())
    }

    fn get_activity_count(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.activity_count() as u32)
    }

    fn clear(&self) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.clear().map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    /// Drop the persistent engine entirely, closing the SQLite connection.
    /// The next call to `create()` will re-initialize from scratch.
    fn destroy(&self) {
        if let Ok(mut guard) = PERSISTENT_ENGINE.lock() {
            info!("[VeloqEngine] Destroying persistent engine");
            *guard = None;
        }
    }

    fn cleanup_old_activities(&self, retention_days: u32) -> Result<u32, VeloqError> {
        with_engine(|e| {
            let count =
                e.cleanup_old_activities(retention_days)
                    .map_err(|e| VeloqError::Database {
                        msg: format!("{}", e),
                    })?;
            if retention_days > 0 && count > 0 {
                info!("[VeloqEngine] Cleanup: {} activities removed", count);
            }
            Ok(count)
        })?
    }

    fn mark_for_recomputation(&self) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.mark_for_recomputation();
            info!("[VeloqEngine] Marked for re-computation");
        })
    }

    fn set_name_translations(&self, route_word: String, section_word: String) {
        if let Ok(mut translations) = NAME_TRANSLATIONS.write() {
            translations.route_word = route_word;
            translations.section_word = section_word;
        }
    }

    fn sections(&self) -> Arc<super::sections::SectionManager> {
        Arc::new(super::sections::SectionManager { _private: () })
    }

    fn activities(&self) -> Arc<super::activities::ActivityManager> {
        Arc::new(super::activities::ActivityManager { _private: () })
    }

    fn routes(&self) -> Arc<super::routes::RouteManager> {
        Arc::new(super::routes::RouteManager { _private: () })
    }

    fn maps(&self) -> Arc<super::maps::MapManager> {
        Arc::new(super::maps::MapManager { _private: () })
    }

    fn fitness(&self) -> Arc<super::fitness::FitnessManager> {
        Arc::new(super::fitness::FitnessManager { _private: () })
    }

    fn settings(&self) -> Arc<super::settings::SettingsManager> {
        Arc::new(super::settings::SettingsManager { _private: () })
    }

    fn detection(&self) -> Arc<super::detection::DetectionManager> {
        Arc::new(super::detection::DetectionManager { _private: () })
    }

    fn strength(&self) -> Arc<super::strength::StrengthManager> {
        Arc::new(super::strength::StrengthManager { _private: () })
    }

    fn heatmap(&self) -> Arc<super::tiles::HeatmapManager> {
        Arc::new(super::tiles::HeatmapManager { _private: () })
    }
}
