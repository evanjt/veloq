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

    /// What a trim at this home and radius would do to the stored library.
    ///
    /// The radius row shows a count rather than a number of metres, because
    /// metres do not say how much of an archive changes.
    fn export_privacy_preview(
        &self,
        home_lat: f64,
        home_lng: f64,
        radius_m: f64,
    ) -> Result<crate::persistence::ExportPrivacyPreview, VeloqError> {
        with_engine(|e| {
            e.export_privacy_preview(home_lat, home_lng, radius_m)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, serial_global_state};

    #[test]
    fn a_setting_round_trips_and_a_delete_removes_it() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("settings.db");
        let settings = SettingsManager::new();

        assert_eq!(settings.get_setting("theme".into()).unwrap(), None);
        settings.set_setting("theme".into(), "dark".into()).unwrap();
        assert_eq!(
            settings.get_setting("theme".into()).unwrap().as_deref(),
            Some("dark")
        );
        settings
            .set_setting("theme".into(), "light".into())
            .unwrap();
        assert_eq!(
            settings.get_setting("theme".into()).unwrap().as_deref(),
            Some("light")
        );
        settings.delete_setting("theme".into()).unwrap();
        assert_eq!(settings.get_setting("theme".into()).unwrap(), None);
        settings.delete_setting("theme".into()).unwrap();
    }

    #[test]
    fn a_batch_write_counts_only_the_pairs_that_changed() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("settings.db");
        let settings = SettingsManager::new();
        let pair = |k: &str, v: &str| SettingPair {
            key: k.into(),
            value: v.into(),
        };

        assert_eq!(settings.set_settings(vec![]).unwrap(), 0);
        assert_eq!(
            settings
                .set_settings(vec![pair("a", "1"), pair("b", "2")])
                .unwrap(),
            2
        );
        assert_eq!(
            settings
                .set_settings(vec![pair("a", "1"), pair("b", "3")])
                .unwrap(),
            1
        );
        assert_eq!(
            settings.get_setting("b".into()).unwrap().as_deref(),
            Some("3")
        );
    }

    #[test]
    fn profile_blobs_are_stored_apart_and_cleared_together() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("settings.db");
        let settings = SettingsManager::new();

        assert_eq!(settings.get_athlete_profile().unwrap(), None);
        assert_eq!(settings.get_sport_settings().unwrap(), None);
        settings
            .set_athlete_profile("{\"id\":\"i1\"}".into())
            .unwrap();
        settings.set_sport_settings("{\"ftp\":200}".into()).unwrap();
        settings.set_setting("kept".into(), "yes".into()).unwrap();
        assert_eq!(
            settings.get_athlete_profile().unwrap().as_deref(),
            Some("{\"id\":\"i1\"}")
        );
        assert_eq!(
            settings.get_sport_settings().unwrap().as_deref(),
            Some("{\"ftp\":200}")
        );

        settings.clear_user_profile_caches().unwrap();
        assert_eq!(settings.get_athlete_profile().unwrap(), None);
        assert_eq!(settings.get_sport_settings().unwrap(), None);
        assert_eq!(
            settings.get_setting("kept".into()).unwrap().as_deref(),
            Some("yes")
        );
    }

    #[test]
    fn stream_retention_defaults_to_ninety_days_and_zero_keeps_everything() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("settings.db");
        let settings = SettingsManager::new();

        assert_eq!(settings.stream_retention_days().unwrap(), 90);
        assert_eq!(settings.stream_store_bytes().unwrap(), 0);
        settings.set_stream_retention_days(30).unwrap();
        assert_eq!(settings.stream_retention_days().unwrap(), 30);
        settings.set_stream_retention_days(0).unwrap();
        assert_eq!(settings.stream_retention_days().unwrap(), 0);
    }

    #[test]
    fn an_empty_library_offers_no_export_home_and_previews_nothing() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("settings.db");
        let settings = SettingsManager::new();

        assert!(settings.suggest_export_home().unwrap().is_none());
        let preview = settings.export_privacy_preview(46.2, 7.35, 500.0).unwrap();
        assert_eq!(
            (preview.with_track, preview.touched, preview.dropped),
            (0, 0, 0)
        );
    }

    #[test]
    fn every_call_reports_not_initialised_without_an_engine() {
        let _guard = serial_global_state();
        *crate::persistence::PERSISTENT_ENGINE
            .write()
            .unwrap_or_else(|e| e.into_inner()) = None;
        let settings = SettingsManager::new();
        assert!(matches!(
            settings.get_setting("k".into()),
            Err(VeloqError::NotInitialized)
        ));
        assert!(matches!(
            settings.set_setting("k".into(), "v".into()),
            Err(VeloqError::NotInitialized)
        ));
        assert!(matches!(
            settings.stream_retention_days(),
            Err(VeloqError::NotInitialized)
        ));
    }
}
