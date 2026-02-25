use crate::persistence::with_persistent_engine;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct SettingsManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl SettingsManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn get_athlete_profile(&self) -> String {
        with_persistent_engine(|e| e.get_athlete_profile())
            .flatten()
            .unwrap_or_default()
    }

    fn set_athlete_profile(&self, json: String) {
        with_persistent_engine(|e| e.set_athlete_profile(&json));
    }

    fn get_sport_settings(&self) -> String {
        with_persistent_engine(|e| e.get_sport_settings())
            .flatten()
            .unwrap_or_default()
    }

    fn set_sport_settings(&self, json: String) {
        with_persistent_engine(|e| e.set_sport_settings(&json));
    }
}
