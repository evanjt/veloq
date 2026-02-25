use crate::persistence::{
    with_persistent_engine, PersistentEngineStats, NAME_TRANSLATIONS, PERSISTENT_ENGINE,
};
use crate::init_logging;
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

    fn get_stats(&self) -> Option<PersistentEngineStats> {
        with_persistent_engine(|e| e.stats())
    }

    fn get_activity_count(&self) -> u32 {
        with_persistent_engine(|e| e.activity_count() as u32).unwrap_or(0)
    }

    fn clear(&self) {
        if let Some(()) = with_persistent_engine(|e| {
            e.clear().ok();
        }) {
            info!("[VeloqEngine] Cleared");
        }
    }

    fn cleanup_old_activities(&self, retention_days: u32) -> u32 {
        with_persistent_engine(|e| match e.cleanup_old_activities(retention_days) {
            Ok(count) => {
                if retention_days > 0 && count > 0 {
                    info!("[VeloqEngine] Cleanup: {} activities removed", count);
                }
                count
            }
            Err(e) => {
                log::error!("[VeloqEngine] Cleanup failed: {:?}", e);
                0
            }
        })
        .unwrap_or(0)
    }

    fn mark_for_recomputation(&self) {
        with_persistent_engine(|e| {
            e.mark_for_recomputation();
            info!("[VeloqEngine] Marked for re-computation");
        });
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
}
