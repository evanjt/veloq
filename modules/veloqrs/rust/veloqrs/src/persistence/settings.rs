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

    /// The athlete's fitness model events as intervals.icu answers them, the
    /// dated fitness and fatigue days among them. One small list read whole,
    /// so it is a key rather than a table. It belongs to the athlete, so a
    /// clear takes it.
    pub const FITNESS_MODEL_EVENTS: &str = "__fitness_model_events";

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
    /// `widget_snapshot::FfiWidgetContext` reads: the translated words, the date
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

    /// The request budget the governor keeps: until when a refusal's
    /// cooldown holds (an RFC 3339 instant, empty for none), the budget day
    /// and the backfill requests admitted on it, this install's offset on the
    /// daily reset in seconds, and the cooldown ladder's rung. They describe
    /// the device's use of the shared limits rather than the library, so a
    /// clear leaves them.
    pub const REQUEST_BUDGET_COOLDOWN_UNTIL: &str = "__request_budget_cooldown_until";
    pub const REQUEST_BUDGET_DAY: &str = "__request_budget_day";
    pub const REQUEST_BUDGET_BACKFILL_TODAY: &str = "__request_budget_backfill_today";
    pub const REQUEST_BUDGET_DAY_OFFSET: &str = "__request_budget_day_offset";
    pub const REQUEST_BUDGET_LADDER_STEP: &str = "__request_budget_ladder_step";
}

/// The request budget the settings rows hold, from any connection. `None`
/// when no day has been written, which is an install that has never sent a
/// backfill request; a value that will not parse reads as absent.
pub fn request_budget_from(
    conn: &rusqlite::Connection,
) -> SqlResult<Option<crate::governor::StoredBudget>> {
    let Some(day) = setting_from(conn, settings_keys::REQUEST_BUDGET_DAY)?
        .and_then(|raw| chrono::NaiveDate::parse_from_str(&raw, "%Y-%m-%d").ok())
    else {
        return Ok(None);
    };
    let number = |key: &str| -> SqlResult<u32> {
        Ok(setting_from(conn, key)?
            .and_then(|raw| raw.parse::<u32>().ok())
            .unwrap_or(0))
    };
    let cooldown_until = setting_from(conn, settings_keys::REQUEST_BUDGET_COOLDOWN_UNTIL)?
        .and_then(|raw| chrono::DateTime::parse_from_rfc3339(&raw).ok())
        .map(|at| at.with_timezone(&chrono::Utc));
    Ok(Some(crate::governor::StoredBudget {
        cooldown_until,
        day,
        backfill_today: number(settings_keys::REQUEST_BUDGET_BACKFILL_TODAY)?,
        day_offset_secs: number(settings_keys::REQUEST_BUDGET_DAY_OFFSET)?,
        ladder_step: number(settings_keys::REQUEST_BUDGET_LADDER_STEP)?,
    }))
}

/// Write the request budget to the settings rows, every key in one
/// transaction, so another process never reads a cooldown beside the count of
/// another moment.
pub fn set_request_budget_on(
    conn: &rusqlite::Connection,
    stored: &crate::governor::StoredBudget,
) -> SqlResult<usize> {
    let pairs = [
        (
            settings_keys::REQUEST_BUDGET_COOLDOWN_UNTIL,
            stored
                .cooldown_until
                .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .unwrap_or_default(),
        ),
        (
            settings_keys::REQUEST_BUDGET_DAY,
            stored.day.format("%Y-%m-%d").to_string(),
        ),
        (
            settings_keys::REQUEST_BUDGET_BACKFILL_TODAY,
            stored.backfill_today.to_string(),
        ),
        (
            settings_keys::REQUEST_BUDGET_DAY_OFFSET,
            stored.day_offset_secs.to_string(),
        ),
        (
            settings_keys::REQUEST_BUDGET_LADDER_STEP,
            stored.ladder_step.to_string(),
        ),
    ]
    .map(|(key, value)| (key.to_string(), value));
    set_settings_on(conn, &pairs)
}

/// The governor's budget kept in the settings rows, through the settings
/// write connection, so a request never waits on the engine lock to learn
/// whether it may go. With no library open it holds nothing, and the budget
/// runs on what it has in memory.
pub struct RequestBudgetRows;

impl crate::governor::BudgetStore for RequestBudgetRows {
    fn load(&self) -> Option<crate::governor::StoredBudget> {
        super::settings_conn::with_settings_conn(request_budget_from)?.unwrap_or_else(|e| {
            log::warn!("veloqrs: [budget] could not read the request budget: {e}");
            None
        })
    }

    fn save(&self, stored: &crate::governor::StoredBudget) {
        if let Some(Err(e)) =
            super::settings_conn::with_settings_conn(|conn| set_request_budget_on(conn, stored))
        {
            log::warn!("veloqrs: [budget] could not write the request budget: {e}");
        }
    }
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

/// Whether section detection is switched on, from a connection that holds no
/// engine lock.
///
/// The switch used to live in TypeScript alone, so the engine kept cutting
/// the catalogue on every sync while the screens looked away.
/// Absent, unreadable or anything but "0" reads as on: the failure mode of
/// a lost setting has to be the feature working, not silently off.
pub fn detection_enabled_from(conn: &rusqlite::Connection) -> bool {
    !matches!(
        setting_from(conn, settings_keys::DETECTION_ENABLED)
            .ok()
            .flatten()
            .as_deref(),
        Some("0")
    )
}

/// Whether Route Matching is switched off, read through the pool so the
/// background work that asks never waits on the engine lock.
///
/// The one answer to which owed work a library runs on its own: with the
/// switch off the elevation backfill and the detector cutover do not run, so
/// nothing waits on them either. An engine that cannot answer reads as on,
/// like an absent row.
pub(crate) fn detection_switched_off() -> bool {
    matches!(
        crate::objects::error::with_reader(detection_enabled_from),
        Ok(false)
    )
}

/// Upsert several settings in one transaction on `conn`, skipping each pair
/// whose value is already stored. Returns how many were written.
///
/// The transaction is taken immediate. A deferred one reads first and then
/// asks to write, and under WAL a write another connection committed in
/// between makes that upgrade fail at once with the database locked, never
/// waiting out the busy timeout. The preference then never reached SQLite,
/// which is the copy the next launch reads.
pub fn set_settings_on(
    conn: &rusqlite::Connection,
    pairs: &[(String, String)],
) -> SqlResult<usize> {
    if pairs.is_empty() {
        return Ok(0);
    }
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
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

/// Delete one setting on `conn`.
pub fn delete_setting_on(conn: &rusqlite::Connection, key: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM settings WHERE key = ?", params![key])?;
    Ok(())
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

/// The fields of the stored intervals.icu athlete body that the screens and
/// the widget read, typed once here.
///
/// The body is stored as it arrived and carries far more. Each field is read
/// leniently: missing, `null` or of another type reads as absent and costs the
/// record nothing else.
#[derive(Debug, Clone, Default, PartialEq, uniffi::Record)]
pub struct AthleteProfile {
    /// The intervals.icu athlete id, as `i123`. A number on the wire reads as its digits.
    pub id: Option<String>,
    pub name: Option<String>,
    /// The URL of the athlete's medium profile photo.
    pub profile_medium: Option<String>,
    /// `M` or `F` as intervals.icu sends it.
    pub sex: Option<String>,
    /// `meters` or `feet`, the units the athlete chose on intervals.icu.
    pub measurement_preference: Option<String>,
    /// Whether the athlete reads form as a share of fitness rather than as
    /// absolute TSB, from `icu_form_as_percent`. Absent on a body from before
    /// the setting existed.
    pub form_as_percent: Option<bool>,
    /// The athlete's weight in kilograms: `icu_weight`, which is where the body
    /// sends it, else `weight`. Absent unless positive.
    pub weight_kg: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct AthleteBody {
    #[serde(deserialize_with = "lenient_id")]
    id: Option<String>,
    #[serde(deserialize_with = "lenient")]
    name: Option<String>,
    #[serde(deserialize_with = "lenient")]
    profile_medium: Option<String>,
    #[serde(deserialize_with = "lenient")]
    sex: Option<String>,
    #[serde(deserialize_with = "lenient")]
    measurement_preference: Option<String>,
    #[serde(deserialize_with = "lenient")]
    icu_form_as_percent: Option<bool>,
    #[serde(deserialize_with = "lenient")]
    icu_weight: Option<f64>,
    #[serde(deserialize_with = "lenient")]
    weight: Option<f64>,
}

fn lenient<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(value).ok())
}

fn lenient_id<'de, D>(d: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(match serde_json::Value::deserialize(d)? {
        serde_json::Value::String(id) => Some(id),
        serde_json::Value::Number(id) => Some(id.to_string()),
        _ => None,
    })
}

impl From<AthleteBody> for AthleteProfile {
    fn from(body: AthleteBody) -> Self {
        let positive = |kg: Option<f64>| kg.filter(|kg| kg.is_finite() && *kg > 0.0);
        Self {
            id: body.id,
            name: body.name,
            profile_medium: body.profile_medium,
            sex: body.sex,
            measurement_preference: body.measurement_preference,
            form_as_percent: body.icu_form_as_percent,
            weight_kg: positive(body.icu_weight).or(positive(body.weight)),
        }
    }
}

/// The stored athlete profile, typed, from a connection that holds no engine
/// lock. `None` when none is stored, the read fails, or the body is not a JSON
/// object, which the store keeps as given.
pub fn athlete_profile(conn: &rusqlite::Connection) -> Option<AthleteProfile> {
    let body = athlete_profile_from(conn)?;
    serde_json::from_str::<AthleteBody>(&body)
        .ok()
        .map(AthleteProfile::from)
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
    /// One transaction per call, so a launch that changes six keys takes one
    /// commit and one lock hold rather than six (`set_setting` has the
    /// measured cost of a single write). Nothing is written when every pair
    /// is unchanged, so the common launch still takes no commit at all.
    pub fn set_settings(&self, pairs: &[(String, String)]) -> SqlResult<usize> {
        set_settings_on(&self.db, pairs)
    }

    /// Whether section detection is switched on, read from the connection the
    /// engine holds. [`detection_enabled_from`] is the same answer without
    /// the engine lock.
    pub fn detection_enabled(&self) -> bool {
        detection_enabled_from(&self.db)
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
    pub fn set_widget_context(
        &self,
        ctx: &crate::widget_snapshot::FfiWidgetContext,
    ) -> SqlResult<bool> {
        let json = crate::widget_snapshot::context_row(ctx);
        if self.get_setting(settings_keys::WIDGET_CONTEXT)?.as_deref() == Some(json.as_str()) {
            return Ok(false);
        }
        self.set_setting(settings_keys::WIDGET_CONTEXT, &json)?;
        Ok(true)
    }

    /// The templates the last push left, or none on an install whose app has
    /// never started.
    pub fn notification_templates(&self) -> SqlResult<Option<NotificationTemplates>> {
        notification_templates_from(&self.db)
    }

    /// Delete a single setting.
    pub fn delete_setting(&self, key: &str) -> SqlResult<()> {
        delete_setting_on(&self.db, key)
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

    /// Put into effect the configs the settings rows hold after something
    /// other than their setters wrote them, as those setters would: a changed
    /// section config re-detects the library and a changed strictness
    /// regroups it. Equal configs change nothing.
    pub(crate) fn adopt_stored_detection_configs(&mut self) -> SqlResult<()> {
        let section = section_config_from(&self.db)?;
        if section != self.section_config {
            self.adopt_section_config(section);
        }
        let matching = match_config_from(&self.db)?;
        self.adopt_match_strictness(matching.min_match_percentage, matching.endpoint_threshold);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::StoredBudget;

    fn at(rfc3339: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    /// Expected behaviour: what one process writes, a relaunch or another
    /// process reads back exactly, and a cleared cooldown reads as none.
    #[test]
    fn the_request_budget_round_trips_through_the_settings_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("budget.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        assert_eq!(request_budget_from(&engine.db).unwrap(), None);

        let held = StoredBudget {
            cooldown_until: Some(at("2026-03-04T10:10:00Z")),
            day: chrono::NaiveDate::from_ymd_opt(2026, 3, 4).unwrap(),
            backfill_today: 412,
            day_offset_secs: 1_234,
            ladder_step: 2,
        };
        assert_eq!(set_request_budget_on(&engine.db, &held).unwrap(), 5);
        drop(engine);

        let reopened = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        assert_eq!(request_budget_from(&reopened.db).unwrap(), Some(held));
        assert_eq!(
            set_request_budget_on(&reopened.db, &held).unwrap(),
            0,
            "an unchanged budget writes nothing"
        );

        let cleared = StoredBudget {
            cooldown_until: None,
            backfill_today: 413,
            ..held
        };
        assert_eq!(set_request_budget_on(&reopened.db, &cleared).unwrap(), 2);
        assert_eq!(request_budget_from(&reopened.db).unwrap(), Some(cleared));
    }

    #[test]
    fn a_request_budget_value_that_will_not_parse_reads_as_absent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("budget.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        engine
            .set_setting(settings_keys::REQUEST_BUDGET_DAY, "yesterday")
            .unwrap();
        assert_eq!(request_budget_from(&engine.db).unwrap(), None);

        engine
            .set_setting(settings_keys::REQUEST_BUDGET_DAY, "2026-03-04")
            .unwrap();
        engine
            .set_setting(settings_keys::REQUEST_BUDGET_COOLDOWN_UNTIL, "soon")
            .unwrap();
        engine
            .set_setting(settings_keys::REQUEST_BUDGET_BACKFILL_TODAY, "-4")
            .unwrap();
        let read = request_budget_from(&engine.db).unwrap().unwrap();
        assert_eq!(read.cooldown_until, None);
        assert_eq!(read.backfill_today, 0);
    }

    fn engine_holding_profile(body: &str) -> (tempfile::TempDir, PersistentEngine) {
        let dir = tempfile::tempdir().unwrap();
        let engine =
            PersistentEngine::new(dir.path().join("profile.db").to_str().unwrap()).unwrap();
        engine.set_athlete_profile(body).unwrap();
        (dir, engine)
    }

    /// Expected behaviour: the fields the screens and the widget read come
    /// off the stored body typed, the weight from `icu_weight` when the body
    /// leaves `weight` null, which is how the athlete endpoint sends it.
    #[test]
    fn the_stored_athlete_body_reads_into_a_typed_profile() {
        let (_dir, engine) = engine_holding_profile(
            r#"{"id":"i1","name":"Test Rider","profile_medium":"https://example.test/a.png","sex":"F","measurement_preference":"feet","icu_form_as_percent":true,"weight":null,"icu_weight":78.9,"sportSettings":[]}"#,
        );
        let profile = athlete_profile(&engine.db).expect("a stored profile");
        assert_eq!(
            profile,
            AthleteProfile {
                id: Some("i1".into()),
                name: Some("Test Rider".into()),
                profile_medium: Some("https://example.test/a.png".into()),
                sex: Some("F".into()),
                measurement_preference: Some("feet".into()),
                form_as_percent: Some(true),
                weight_kg: Some(78.9),
            }
        );
    }

    #[test]
    fn an_empty_athlete_body_reads_as_a_profile_of_absent_fields() {
        let (_dir, engine) = engine_holding_profile("{}");
        assert_eq!(athlete_profile(&engine.db), Some(AthleteProfile::default()));
    }

    /// Expected behaviour: a field of an unexpected type reads as absent and
    /// costs the record nothing else, and an id sent as a number still names
    /// the athlete.
    #[test]
    fn a_field_of_another_shape_reads_as_absent_without_losing_the_rest() {
        let (_dir, engine) = engine_holding_profile(
            r#"{"id":42,"name":7,"sex":"M","measurement_preference":null,"icu_form_as_percent":"yes","icu_weight":"heavy","weight":81.5}"#,
        );
        let profile = athlete_profile(&engine.db).expect("a stored profile");
        assert_eq!(
            profile,
            AthleteProfile {
                id: Some("42".into()),
                sex: Some("M".into()),
                weight_kg: Some(81.5),
                ..AthleteProfile::default()
            }
        );
    }

    #[test]
    fn the_intervals_weight_is_read_before_the_plain_one() {
        let (_dir, engine) = engine_holding_profile(r#"{"icu_weight":90,"weight":82}"#);
        assert_eq!(athlete_profile(&engine.db).unwrap().weight_kg, Some(90.0));
    }

    #[test]
    fn a_weight_that_is_not_positive_reads_as_absent() {
        let (_dir, engine) = engine_holding_profile(r#"{"icu_weight":0,"weight":-3}"#);
        assert_eq!(athlete_profile(&engine.db).unwrap().weight_kg, None);
    }

    #[test]
    fn a_body_that_is_not_json_or_no_body_reads_as_no_profile() {
        let (_dir, engine) = engine_holding_profile("not json");
        assert_eq!(athlete_profile(&engine.db), None);

        let dir = tempfile::tempdir().unwrap();
        let empty = PersistentEngine::new(dir.path().join("none.db").to_str().unwrap()).unwrap();
        assert_eq!(athlete_profile(&empty.db), None);
    }
}
