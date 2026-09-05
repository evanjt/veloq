use super::error::{VeloqError, with_engine};
use std::sync::Arc;

/// One key and the value to store under it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SettingPair {
    pub key: String,
    pub value: String,
}

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

    /// Where the athlete's rides start and finish most often, for the export
    /// privacy row to offer. A guess: the trim stays off until it is confirmed
    /// or replaced, and a library with too little to cluster answers none.
    fn suggest_export_home(&self) -> Result<Option<crate::persistence::SuggestedHome>, VeloqError> {
        with_engine(|e| e.suggest_export_home())
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

    /// Set several user preferences in one transaction, skipping each pair
    /// whose value is already stored. Returns how many were written.
    fn set_settings(&self, pairs: Vec<SettingPair>) -> Result<u32, VeloqError> {
        with_engine(|e| {
            let owned: Vec<(String, String)> =
                pairs.into_iter().map(|p| (p.key, p.value)).collect();
            e.set_settings(&owned)
                .map(|written| written as u32)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// Days of stream history the athlete keeps. Zero means keep everything.
    ///
    /// This only ever evicts stored series: nothing deletes whole activities
    /// by age.
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
