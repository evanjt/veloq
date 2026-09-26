use super::error::{VeloqError, with_engine, with_reader};
use std::sync::Arc;

/// One key and the value to store under it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SettingPair {
    pub key: String,
    pub value: String,
}

/// The notification templates for one locale, as they cross the binding.
///
/// A record rather than a JSON string, so a renamed key is a binding change
/// the generated tests catch rather than a sentence that renders as its own
/// key on a handset.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiNotificationTemplates {
    /// The locale tag JavaScript resolved these for, e.g. `ja` or `en-AU`.
    pub locale: String,
    /// Every template, ordered by key.
    pub templates: Vec<SettingPair>,
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
            e.set_athlete_profile(&json)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn get_sport_settings(&self) -> Result<Option<String>, VeloqError> {
        with_engine(|e| e.get_sport_settings())
    }

    fn set_sport_settings(&self, json: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_sport_settings(&json)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
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

    /// Hand the engine the notification templates for the locale the app is
    /// running in. Answers whether anything was written, which is false for
    /// the ordinary launch that re-pushes the bundle it pushed last time.
    ///
    /// This is what lets a push handler build a sentence with no JavaScript
    /// alive to resolve one. `set_name_translations` is the same gesture and
    /// keeps its two words in a process global, which a handler woken with the
    /// app killed cannot read; these land in the settings table.
    ///
    /// Call it once the bundle is in i18next's store and not before: a key
    /// resolves as itself until then, and a bundle of keys is what the handler
    /// would render.
    fn set_notification_templates(
        &self,
        locale: String,
        templates: Vec<SettingPair>,
    ) -> Result<bool, VeloqError> {
        with_engine(|e| {
            let owned: Vec<(String, String)> =
                templates.into_iter().map(|p| (p.key, p.value)).collect();
            e.set_notification_templates(&locale, &owned)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// The templates the last push left, or none on an install whose app has
    /// never started.
    ///
    /// Read through the pool rather than the engine's write lock: it is one
    /// row of SQLite and it reaches no engine state, and the caller is a push
    /// handler that must not wait behind whatever is writing.
    fn notification_templates(&self) -> Result<Option<FfiNotificationTemplates>, VeloqError> {
        with_reader(|conn| {
            crate::persistence::settings::notification_templates_from(conn)
                .map(|held| {
                    held.map(|held| FfiNotificationTemplates {
                        locale: held.locale,
                        templates: held
                            .templates
                            .into_iter()
                            .map(|(key, value)| SettingPair { key, value })
                            .collect(),
                    })
                })
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

    /// The two blobs are stored apart from the settings rows, and nothing
    /// short of a wipe empties them: the export that used to is gone with the
    /// sign-out that called it, so a re-login on the same account is instant
    /// and offline.
    #[test]
    fn profile_blobs_are_stored_apart_from_the_settings_rows() {
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

        assert_eq!(
            settings.get_setting("kept".into()).unwrap().as_deref(),
            Some("yes"),
            "a settings row is not a profile blob"
        );
    }

    #[test]
    fn stream_retention_defaults_to_keeping_everything_and_zero_says_so() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("settings.db");
        let settings = SettingsManager::new();

        // The FFI carries "keep everything" as zero, which is also what the
        // athlete sets to ask for it.
        assert_eq!(settings.stream_retention_days().unwrap(), 0);
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
            .lock()
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
