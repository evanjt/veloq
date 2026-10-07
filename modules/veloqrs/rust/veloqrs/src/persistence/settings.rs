//! Settings: key-value storage for user preferences.
//!
//! Consolidates AsyncStorage preferences into SQLite so a single database
//! backup captures the complete app state.

use std::collections::BTreeMap;

use rusqlite::{OptionalExtension, Result as SqlResult, params};
use serde::{Deserialize, Serialize};

use super::PersistentEngine;

/// Reserved setting keys owned by Rust internals. The double-underscore
/// prefix distinguishes them from user-facing preferences set via
/// `SettingsManager.set_setting`. TS code should treat these as opaque.
pub mod settings_keys {
    /// Minimum match percentage threshold (f64 stored as decimal string).
    pub const MATCH_MIN_MATCH_PCT: &str = "__match_min_match_pct";
    /// Endpoint distance threshold in metres (f64 stored as decimal string).
    pub const MATCH_ENDPOINT_THRESHOLD: &str = "__match_endpoint_threshold";

    /// SectionConfig.proximity_threshold in metres (f64 stored as decimal string).
    pub const SECTION_PROXIMITY_THRESHOLD: &str = "__section_proximity_threshold";
    /// SectionConfig.min_section_length in metres (f64 stored as decimal string).
    pub const SECTION_MIN_LENGTH: &str = "__section_min_length";
    /// SectionConfig.min_activities (u32 stored as decimal string).
    pub const SECTION_MIN_ACTIVITIES: &str = "__section_min_activities";
    /// The WHOLE SectionConfig as a JSON blob. The individual keys above persist
    /// the strictness-slider fields; this captures every field so a restart
    /// restores the EXACT config that was last set. Without it the load path
    /// rebuilds `default()` + the three slider fields, and the TS launch re-apply
    /// (which spreads the current config and re-sets whatever it holds) then
    /// reads as a genuine change every boot, clearing the processed set and
    /// renumbering every section. Preferred by the loader; the individual keys remain as a
    /// pre-blob-install fallback.
    pub const SECTION_CONFIG_JSON: &str = "__section_config_json";

    /// Prefix of one key per sport type, valued with the epoch second an
    /// activity of that sport last left intervals.icu and was removed here.
    /// The curve sweep reads it as an arrival: the server's stored curves
    /// were drawn with that activity in them, and a removal only lowers the
    /// family's newest body, so nothing else would mark them stale.
    pub const CURVE_REMOVED_AT_PREFIX: &str = "__curve_removed_at:";

    /// Prefix of one key per activity that left intervals.icu and was kept
    /// for a section with no other member. Its departure has stamped its
    /// sport under `CURVE_REMOVED_AT_PREFIX` once, so a later census that
    /// finds it gone again, or the removal once the section can do without
    /// it, stamps nothing more. Deleted with the activity's rows.
    pub const CURVE_DEPARTED_PREFIX: &str = "__curve_departed:";

    /// The feed's new-activity marker, stamps and dismissals as one JSON row.
    /// It describes this device's use of this library, so a clear takes it and
    /// a record backup and a restore leave it out: a restored library has no
    /// marker and nothing in it rings.
    pub const FEED_RINGS: &str = "__feed_rings";

    /// Whose library this database holds. It names the data, not the device,
    /// so a clear takes it with the library.
    pub const ATHLETE_ID: &str = "__athlete_id";

    /// This library wrote the device-backup record zip, or the athlete has
    /// answered its offer. It describes the library, so a clear takes it.
    pub const PLATFORM_RECORD_ANSWERED: &str = "__platform_record_answered";

    /// The one-shot section redetect has been spent on this library. It
    /// describes the library, so a clear takes it and a record backup leaves it
    /// out: a restored library starts with it unset and is checked again.
    pub const SECTION_HEALTH_CHECK_DONE: &str = "__section_health_check_done";

    /// The field set the stored activity list bodies were fetched with. A
    /// build that asks for another set refetches every stored activity once
    /// and then writes its own here, so a field added to the request reaches
    /// rides already on the device and not only the ones the census still
    /// owes. It describes the bodies rather than the athlete, so a clear
    /// leaves it: an emptied library holds no body fetched with another set.
    pub const ACTIVITY_BODY_FIELDS: &str = "__activity_body_fields";

    /// Whether the athlete wants section detection at all. Absent means yes:
    /// the feature is on by default and an install that never touched the
    /// switch must not read as opted out.
    pub const DETECTION_ENABLED: &str = "__detection_enabled";

    /// Where the athlete lives, and how much of a track around it an export
    /// leaves behind. Absent or a zero radius means an export is exactly what
    /// it was before this existed.
    pub const EXPORT_HOME_LAT: &str = "__export_home_lat";
    pub const EXPORT_HOME_LNG: &str = "__export_home_lng";
    pub const EXPORT_PRIVACY_RADIUS_M: &str = "__export_privacy_radius_m";

    /// When the last sync finished, written by the app's sync health. It
    /// belongs to the library that synced, so a clear takes it.
    pub const SYNC_LAST_SUCCESS_AT: &str = "sync.last_success_at";

    /// The notification templates for the locale JavaScript last resolved,
    /// with the locale tag beside them, as one JSON blob. A push handler
    /// woken with the app killed formats from this: the crate holds no
    /// bundles of its own and there is no i18next in that process.
    ///
    /// One key rather than fifteen so a locale change is one write and can
    /// never leave half of one bundle beside half of another.
    pub const NOTIFICATION_TEMPLATES: &str = "__notification_templates";

    /// What the widget snapshot needs that only the app knows, as the JSON
    /// `widget_snapshot::WidgetContext` reads: the translated words, the date
    /// names, the palette, the summary card settings and the recent sports. A
    /// push handler that writes the snapshot with no JavaScript composes from it.
    pub const WIDGET_CONTEXT: &str = "__widget_context";

    /// Bumped by a push handler that wrote to the database, and read by the
    /// foreground to tell whether its in-memory tiers still speak for the
    /// file.
    ///
    /// A counter rather than a flag: the foreground has to tell "nothing has
    /// happened" from "something happened and I have already taken it", and a
    /// flag someone has to clear races a second push arriving between the read
    /// and the clear. The bump is one `UPDATE`, so two processes cannot lose
    /// one another's.
    pub const EXTERNAL_WRITE_TOKEN: &str = "__external_write_token";

    /// The notification switch and its category flags, as JavaScript's
    /// preferences store persists them: one JSON row, `{enabled, categories:
    /// {sectionPr, fitnessMilestone}, ...}`. The key is the store's, at
    /// `src/features/settings/stores/NotificationPreferencesStore.ts`, since
    /// `setSetting` writes it here as well as to AsyncStorage. A push handler
    /// with no JavaScript reads the switch from this row.
    pub const NOTIFICATION_PREFERENCES: &str = "veloq-notification-preferences";
}

/// What a push handler needs to write a sentence: the resolved templates for
/// one locale, keyed by their i18next path, and the tag they were resolved
/// for.
///
/// The templates interpolate `{{name}}`, `{{delta}}` and `{{count}}` and
/// nothing else, and no locale carries a plural variant of any of them, so
/// formatting one is a substitution rather than a locale rule.
///
/// Ordered, so the stored JSON is byte-stable for one bundle and the launch
/// that re-pushes what it pushed last time compares equal and writes nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationTemplates {
    pub locale: String,
    pub templates: BTreeMap<String, String>,
}

/// The templates the last push left, read from whatever connection the caller
/// holds, so a screen or a push handler can take this off the engine's write
/// lock and through the read pool.
///
/// A stored blob that no longer parses reads as none, so a handler falls back
/// to its own wording rather than failing.
pub fn notification_templates_from(
    conn: &rusqlite::Connection,
) -> SqlResult<Option<NotificationTemplates>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            params![settings_keys::NOTIFICATION_TEMPLATES],
            |row| row.get(0),
        )
        .optional()?;
    Ok(json.and_then(|json| serde_json::from_str(&json).ok()))
}

/// One setting from a connection that holds no engine lock, or `None` when
/// the row is absent.
pub fn setting_from(conn: &rusqlite::Connection, key: &str) -> SqlResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

/// The match config the settings rows hold, from a connection that holds no
/// engine lock. A missing or unparseable value keeps the default.
pub fn match_config_from(conn: &rusqlite::Connection) -> SqlResult<tracematch::MatchConfig> {
    let mut config = tracematch::MatchConfig::default();
    if let Some(raw) = setting_from(conn, settings_keys::MATCH_MIN_MATCH_PCT)?
        && let Ok(v) = raw.parse::<f64>()
    {
        config.min_match_percentage = v;
    }
    if let Some(raw) = setting_from(conn, settings_keys::MATCH_ENDPOINT_THRESHOLD)?
        && let Ok(v) = raw.parse::<f64>()
    {
        config.endpoint_threshold = v;
    }
    Ok(config)
}

/// The section config the settings rows hold, from a connection that holds no
/// engine lock. The whole-config blob restores every field, so the launch
/// re-apply of the same preset compares equal and no-ops. Installs written
/// before the blob existed, and a blob that does not parse, fall back to the
/// individual slider keys over the default.
pub fn section_config_from(conn: &rusqlite::Connection) -> SqlResult<tracematch::SectionConfig> {
    if let Some(json) = setting_from(conn, settings_keys::SECTION_CONFIG_JSON)? {
        match serde_json::from_str::<tracematch::SectionConfig>(&json) {
            Ok(config) => return Ok(config),
            Err(e) => log::warn!(
                "veloqrs: [section_config_from] config blob unparseable, falling back to slider keys: {}",
                e
            ),
        }
    }

    let mut config = tracematch::SectionConfig::default();
    if let Some(raw) = setting_from(conn, settings_keys::SECTION_PROXIMITY_THRESHOLD)?
        && let Ok(v) = raw.parse::<f64>()
    {
        config.proximity_threshold = v;
    }
    if let Some(raw) = setting_from(conn, settings_keys::SECTION_MIN_LENGTH)?
        && let Ok(v) = raw.parse::<f64>()
    {
        config.min_section_length = v;
    }
    if let Some(raw) = setting_from(conn, settings_keys::SECTION_MIN_ACTIVITIES)?
        && let Ok(v) = raw.parse::<u32>()
    {
        config.min_activities = v;
    }
    Ok(config)
}

/// The cached athlete profile JSON from a connection that holds no engine
/// lock, or `None` when none is cached or the read fails.
pub fn athlete_profile_from(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT data FROM athlete_profile WHERE id = 'current'",
        [],
        |row| row.get(0),
    )
    .ok()
}

impl PersistentEngine {
    /// Get a single setting by key.
    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        setting_from(&self.db, key)
    }

    /// Set a single setting (upsert).
    ///
    /// An unchanged value is not written, which is most calls: they come from a
    /// store persisting on launch what it just read.
    ///
    /// The commit is no longer what it costs. Measured on the S22 in release on
    /// a quiet machine, median of forty, three runs: a write that changes the
    /// value is 0.021 to 0.048 ms and the unchanged early return 0.005 to
    /// 0.012 ms. The same write against a rollback journal at `synchronous`
    /// FULL, on the same handset, is 2.9 to 9.5 ms with a p95 of 13.5, which is
    /// the two fsyncs this used to pay on the thread that asked.
    pub fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        if self.get_setting(key)?.as_deref() == Some(value) {
            return Ok(());
        }
        self.db.execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES (?, ?, strftime('%s', 'now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value],
        )?;
        Ok(())
    }

    /// Upsert several settings in one transaction, skipping each pair whose
    /// value is already stored. Returns how many were written.
    ///
    /// One commit is two fsyncs, about 20 ms on a mid-range phone, and a
    /// launch that changes six keys paid that six times over
    /// (`set_setting`). Nothing is written when every pair is unchanged, so
    /// the common launch still takes no commit at all.
    pub fn set_settings(&self, pairs: &[(String, String)]) -> SqlResult<usize> {
        if pairs.is_empty() {
            return Ok(0);
        }
        let tx = self.db.unchecked_transaction()?;
        let mut written = 0usize;
        {
            let mut read = tx.prepare("SELECT value FROM settings WHERE key = ?")?;
            let mut write = tx.prepare(
                "INSERT INTO settings (key, value, updated_at)
                 VALUES (?, ?, strftime('%s', 'now'))
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                                updated_at = excluded.updated_at",
            )?;
            for (key, value) in pairs {
                let stored: Option<String> =
                    read.query_row(params![key], |row| row.get(0)).optional()?;
                if stored.as_deref() == Some(value.as_str()) {
                    continue;
                }
                write.execute(params![key, value])?;
                written += 1;
            }
        }
        tx.commit()?;
        Ok(written)
    }

    /// Whether section detection is switched on.
    ///
    /// The switch used to live in TypeScript alone, so the engine kept cutting
    /// the catalogue on every sync while the screens looked away.
    /// Absent, unreadable or anything but "0" reads as on: the failure mode of
    /// a lost setting has to be the feature working, not silently off.
    pub fn detection_enabled(&self) -> bool {
        !matches!(
            self.get_setting(settings_keys::DETECTION_ENABLED)
                .ok()
                .flatten()
                .as_deref(),
            Some("0")
        )
    }

    /// Turn section detection on or off for this library.
    pub fn set_detection_enabled(&self, enabled: bool) -> SqlResult<()> {
        self.set_setting(
            settings_keys::DETECTION_ENABLED,
            if enabled { "1" } else { "0" },
        )
    }

    /// Store the notification templates JavaScript resolved for the locale it
    /// is running in, replacing whatever was held. Answers whether anything
    /// was written, which is false for the ordinary launch that re-pushes the
    /// bundle it pushed last time.
    ///
    /// An empty bundle is refused rather than stored: it would leave a handler
    /// holding a locale tag and no sentence to put an activity in, which is
    /// worse than holding the previous locale's.
    pub fn set_notification_templates(
        &self,
        locale: &str,
        templates: &[(String, String)],
    ) -> SqlResult<bool> {
        if templates.is_empty() {
            return Err(rusqlite::Error::InvalidParameterName(
                "notification templates: an empty bundle".to_string(),
            ));
        }
        let held = NotificationTemplates {
            locale: locale.to_string(),
            templates: templates.iter().cloned().collect(),
        };
        let json = serde_json::to_string(&held)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let before = self.get_setting(settings_keys::NOTIFICATION_TEMPLATES)?;
        if before.as_deref() == Some(json.as_str()) {
            return Ok(false);
        }
        self.set_setting(settings_keys::NOTIFICATION_TEMPLATES, &json)?;
        Ok(true)
    }

    /// Store the widget context the app resolved, replacing whatever was held.
    /// Answers whether anything was written, which is false for the ordinary
    /// refresh that hands over the context it handed over last time.
    pub fn set_widget_context(&self, json: &str) -> SqlResult<bool> {
        if self.get_setting(settings_keys::WIDGET_CONTEXT)?.as_deref() == Some(json) {
            return Ok(false);
        }
        self.set_setting(settings_keys::WIDGET_CONTEXT, json)?;
        Ok(true)
    }

    /// The templates the last push left, or none on an install whose app has
    /// never started.
    pub fn notification_templates(&self) -> SqlResult<Option<NotificationTemplates>> {
        notification_templates_from(&self.db)
    }

    /// Delete a single setting.
    pub fn delete_setting(&self, key: &str) -> SqlResult<()> {
        self.db
            .execute("DELETE FROM settings WHERE key = ?", params![key])?;
        Ok(())
    }

    /// Apply persisted match-strictness overrides to the in-memory `match_config`.
    /// Called from `load()` so a fresh engine instance reflects the user's last
    /// chosen strictness without any TS round-trip.
    pub(crate) fn load_match_strictness_from_settings(&mut self) -> SqlResult<()> {
        self.match_config = match_config_from(&self.db)?;
        Ok(())
    }

    /// Mirror of `load_match_strictness_from_settings` for `section_config`.
    pub(crate) fn load_section_config_from_settings(&mut self) -> SqlResult<()> {
        self.section_config = section_config_from(&self.db)?;
        Ok(())
    }
}
