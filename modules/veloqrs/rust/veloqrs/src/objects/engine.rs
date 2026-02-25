use crate::persistence::{with_persistent_engine, PersistentEngineStats, PERSISTENT_ENGINE};
use crate::init_logging;
use log::info;
use std::sync::Arc;

/// Root UniFFI Object wrapping the persistent engine singleton.
///
/// During the migration, this delegates to the same global `PERSISTENT_ENGINE`
/// used by the flat FFI functions, so both APIs share state.
#[derive(uniffi::Object)]
pub struct VeloqEngine {
    #[allow(dead_code)]
    db_path: String,
}

#[uniffi::export]
impl VeloqEngine {
    /// Create or reconnect to the engine at the given database path.
    #[uniffi::constructor]
    fn create(db_path: String) -> Arc<Self> {
        init_logging();

        // Initialize the global engine if not already done
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

    fn get_stats(&self) -> Option<PersistentEngineStats> {
        with_persistent_engine(|e| e.stats())
    }

    fn get_activity_count(&self) -> u32 {
        with_persistent_engine(|e| e.activity_count() as u32).unwrap_or(0)
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
