use super::error::{VeloqError, with_engine};
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

    /// Clear the cached athlete profile and sport settings blobs without
    /// touching activity / GPS / section data. Used by the lightweight
    /// "Sign out" path.
    fn clear_user_profile_caches(&self) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.clear_user_profile_caches();
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

    /// Days of stream history the athlete keeps. Zero means keep everything.
    ///
    /// Not the same knob as the activity `retentionDays` in
    /// `RouteSettingsStore`, which deletes whole activities. This one only ever
    /// evicts stored series.
    fn stream_retention_days(&self) -> Result<i64, VeloqError> {
        with_engine(|e| e.stream_retention_days().unwrap_or(0))
    }

    /// Set the stream retention window in days, then evict what now falls
    /// outside it. Zero keeps everything.
    fn set_stream_retention_days(&self, days: i64) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_stream_retention_days(days)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// Bytes the stream store holds, for the cache readout.
    fn stream_store_bytes(&self) -> Result<i64, VeloqError> {
        with_engine(|e| {
            e.stream_store_bytes().map_err(|e| VeloqError::Database {
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
