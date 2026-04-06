use super::error::{VeloqError, with_engine};
use std::collections::HashMap;
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

    fn get_athlete_profile(&self) -> Result<Option<String>, VeloqError> {
        with_engine(|e| e.get_athlete_profile())
    }

    fn set_athlete_profile(&self, json: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_athlete_profile(&json);
        })
    }

    fn get_sport_settings(&self) -> Result<Option<String>, VeloqError> {
        with_engine(|e| e.get_sport_settings())
    }

    fn set_sport_settings(&self, json: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_sport_settings(&json);
        })
    }

    /// Get a single user preference by key.
    fn get_setting(&self, key: String) -> Result<Option<String>, VeloqError> {
        with_engine(|e| {
            e.get_setting(&key).map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    /// Set a single user preference (upsert).
    fn set_setting(&self, key: String, value: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_setting(&key, &value)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// Get all user preferences as a JSON string: {"key": "value", ...}.
    fn get_all_settings(&self) -> Result<String, VeloqError> {
        with_engine(|e| {
            let settings = e.get_all_settings().map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })?;
            serde_json::to_string(&settings).map_err(|e| VeloqError::Database {
                msg: format!("JSON serialization failed: {}", e),
            })
        })?
    }

    /// Bulk upsert user preferences from a JSON string: {"key": "value", ...}.
    fn set_all_settings(&self, json: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            let settings: HashMap<String, String> =
                serde_json::from_str(&json).map_err(|e| VeloqError::Database {
                    msg: format!("JSON parse failed: {}", e),
                })?;
            e.set_all_settings(&settings)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// Delete a single user preference.
    fn delete_setting(&self, key: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.delete_setting(&key).map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }
}
