//! The athlete's sport settings, read once into typed entries.
//!
//! The sync stores the `sportSettings` array the athlete body carries as it
//! arrived. Every reader here takes it through [`SportSettings`], so the rule
//! for which entry covers a sport lives in one place. Each field is read
//! leniently: a key that is missing, `null` or of another type reads as unset
//! rather than failing the entry, and keys not modelled here are ignored.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// One entry of the athlete's sport settings, as the athlete endpoint sends it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub(crate) struct SportSettingsEntry {
    /// The activity types the entry covers. Entries that are not strings are dropped.
    #[serde(deserialize_with = "strings")]
    pub types: Vec<String>,
    /// Whether this is the entry for every sport no other entry lists.
    #[serde(deserialize_with = "flag")]
    pub other: bool,
    /// The set threshold power, in watts.
    #[serde(deserialize_with = "number")]
    pub ftp: Option<f64>,
    /// The set lactate threshold heart rate, in bpm.
    #[serde(deserialize_with = "number")]
    pub lthr: Option<f64>,
    /// The set maximum heart rate, in bpm.
    #[serde(deserialize_with = "number")]
    pub max_hr: Option<f64>,
    /// The upper bpm edge of each heart rate zone. Bounds that are not numbers are dropped.
    #[serde(deserialize_with = "numbers")]
    pub hr_zones: Vec<f64>,
    /// The upper edge of each power zone as a percent of FTP, the last one
    /// [`POWER_ZONE_OPEN_TOP_PERCENT`] for a top zone with no upper edge.
    /// Bounds that are not numbers are dropped.
    #[serde(deserialize_with = "numbers")]
    pub power_zones: Vec<f64>,
    /// The athlete's names for the heart rate zones, empty unless every one is a string.
    #[serde(deserialize_with = "names")]
    pub hr_zone_names: Vec<String>,
    /// The athlete's names for the power zones, empty unless every one is a string.
    #[serde(deserialize_with = "names")]
    pub power_zone_names: Vec<String>,
}

/// The value intervals.icu puts last in a list of power zones for a top zone
/// with no upper edge.
pub(crate) const POWER_ZONE_OPEN_TOP_PERCENT: f64 = 999.0;

impl SportSettingsEntry {
    /// The power zone, numbered from 1, that `watts` falls in at `ftp`. Each
    /// bound is the top of its zone and belongs to it, and a reading over the
    /// last bound is the top zone. `None` when the entry lists no zones, a
    /// bound is not positive, or `watts` or `ftp` is not a positive number.
    pub(crate) fn zone_for_power(&self, watts: f64, ftp: f64) -> Option<u32> {
        let positive = |v: f64| v.is_finite() && v > 0.0;
        if !positive(watts) || !positive(ftp) || self.power_zones.is_empty() {
            return None;
        }
        if !self.power_zones.iter().all(|bound| positive(*bound)) {
            return None;
        }
        // Compared as watts times 100 against percent times FTP, so a reading
        // that lands on a bound is not split by rounding.
        let below = self
            .power_zones
            .iter()
            .take_while(|percent| watts * 100.0 > **percent * ftp)
            .count();
        Some(below.min(self.power_zones.len() - 1) as u32 + 1)
    }
}

/// Every entry of the stored sport settings, in their stored order.
#[derive(Debug, Clone, Default)]
pub(crate) struct SportSettings(Vec<SportSettingsEntry>);

impl SportSettings {
    /// The entries of a stored body. A body that is absent or is not a JSON
    /// array has none, and an element that is not an object is skipped.
    pub(crate) fn parse(raw: Option<&str>) -> Self {
        let entries = raw
            .and_then(|raw| serde_json::from_str::<Vec<Value>>(raw).ok())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|entry| SportSettingsEntry::deserialize(entry).ok())
            .collect();
        Self(entries)
    }

    /// The stored sport settings on any connection.
    pub(crate) fn read(conn: &rusqlite::Connection) -> Self {
        Self::parse(super::sport_settings_from(conn).as_deref())
    }

    /// The first entry listing `sport`, else the entry for unlisted sports.
    pub(crate) fn entry_for(&self, sport: &str) -> Option<&SportSettingsEntry> {
        self.0
            .iter()
            .find(|entry| entry.types.iter().any(|t| t == sport))
            .or_else(|| self.0.iter().find(|entry| entry.other))
    }

    /// The first entry listing any sport of `sport`'s family, with no fallback.
    pub(crate) fn family_entry_for(&self, sport: &str) -> Option<&SportSettingsEntry> {
        let family = crate::sport::family_of(sport);
        self.0
            .iter()
            .find(|entry| entry.types.iter().any(|t| family.contains(&t.as_str())))
    }
}

/// The set cycling FTP: the `ftp` of the entry covering cycling, else the FTP
/// the newest cycling activity was analysed against.
pub(crate) fn cycling_ftp(conn: &rusqlite::Connection, settings: &SportSettings) -> Option<f64> {
    let set = settings
        .family_entry_for("Ride")
        .and_then(|entry| entry.ftp)
        .filter(|ftp| ftp.is_finite() && *ftp > 0.0);
    set.or_else(|| {
        let cycling = crate::sport::sql_list(&crate::sport::family_of("Ride"));
        conn.query_row(
            &format!(
                "SELECT ftp FROM activity_metrics
                 WHERE sport_type IN ({cycling}) AND ftp > 0
                 ORDER BY date DESC LIMIT 1"
            ),
            [],
            |row| row.get::<_, f64>(0),
        )
        .ok()
    })
}

/// The set running LTHR: the `lthr` of the entry covering running.
pub(crate) fn running_lthr(settings: &SportSettings) -> Option<f64> {
    settings
        .family_entry_for("Run")
        .and_then(|entry| entry.lthr)
        .filter(|lthr| lthr.is_finite() && *lthr > 0.0)
}

/// Where a threshold figure came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ThresholdSource {
    /// The athlete set it.
    Athlete,
    /// The sport settings body intervals.icu holds.
    SportSettings,
    /// The newest figure the athlete's own activity files carry.
    File,
}

/// A threshold figure and where it came from.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Sourced {
    pub value: f64,
    pub source: ThresholdSource,
}

/// The thresholds and profile figures a sport is judged against on a date.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct AthleteThresholds {
    pub ftp: Option<Sourced>,
    pub threshold_hr: Option<Sourced>,
    pub max_hr: Option<Sourced>,
    pub resting_hr: Option<Sourced>,
    pub weight_kg: Option<Sourced>,
}

/// One of the figures [`AthleteThresholds`] holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ThresholdField {
    Ftp,
    ThresholdHr,
    MaxHr,
    RestingHr,
    WeightKg,
}

impl From<ThresholdSource> for crate::FfiThresholdSource {
    fn from(source: ThresholdSource) -> Self {
        match source {
            ThresholdSource::Athlete => Self::Athlete,
            ThresholdSource::SportSettings => Self::SportSettings,
            ThresholdSource::File => Self::File,
        }
    }
}

impl From<crate::FfiThresholdField> for ThresholdField {
    fn from(field: crate::FfiThresholdField) -> Self {
        match field {
            crate::FfiThresholdField::Ftp => Self::Ftp,
            crate::FfiThresholdField::ThresholdHr => Self::ThresholdHr,
            crate::FfiThresholdField::MaxHr => Self::MaxHr,
            crate::FfiThresholdField::RestingHr => Self::RestingHr,
            crate::FfiThresholdField::WeightKg => Self::WeightKg,
        }
    }
}

impl AthleteThresholds {
    pub(crate) fn get(&self, field: ThresholdField) -> Option<Sourced> {
        match field {
            ThresholdField::Ftp => self.ftp,
            ThresholdField::ThresholdHr => self.threshold_hr,
            ThresholdField::MaxHr => self.max_hr,
            ThresholdField::RestingHr => self.resting_hr,
            ThresholdField::WeightKg => self.weight_kg,
        }
    }
}

/// The figures one source gives, each unset where it gives none.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
struct Figures {
    #[serde(skip_serializing_if = "Option::is_none")]
    ftp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    threshold_hr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_hr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resting_hr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    weight_kg: Option<f64>,
}

impl Figures {
    fn slot(&mut self, field: ThresholdField) -> &mut Option<f64> {
        match field {
            ThresholdField::Ftp => &mut self.ftp,
            ThresholdField::ThresholdHr => &mut self.threshold_hr,
            ThresholdField::MaxHr => &mut self.max_hr,
            ThresholdField::RestingHr => &mut self.resting_hr,
            ThresholdField::WeightKg => &mut self.weight_kg,
        }
    }

    fn get(&self, field: ThresholdField) -> Option<f64> {
        let mut copy = *self;
        *copy.slot(field)
    }

    fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

const FIELDS: [ThresholdField; 5] = [
    ThresholdField::Ftp,
    ThresholdField::ThresholdHr,
    ThresholdField::MaxHr,
    ThresholdField::RestingHr,
    ThresholdField::WeightKg,
];

/// The profile figures belong to the athlete rather than to a sport, so they
/// are answered from any sport's file when the asked sport's holds none.
const PROFILE_FIELDS: [ThresholdField; 2] = [ThresholdField::RestingHr, ThresholdField::WeightKg];

const FILE_KEY: &str = crate::persistence::settings::settings_keys::FILE_THRESHOLDS;
const OVERRIDE_KEY: &str = crate::persistence::settings::settings_keys::THRESHOLD_OVERRIDES;

/// One dated set of figures read from an activity file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct FileRecord {
    sport: String,
    /// The activity's start in Unix seconds.
    at: i64,
    #[serde(flatten)]
    figures: Figures,
}

/// The key a sport's figures are filed under: its family's first sport, so a
/// gravel ride and a road ride share one set of thresholds.
fn sport_key(sport: &str) -> String {
    crate::sport::family_of(sport)
        .first()
        .copied()
        .unwrap_or(sport)
        .to_string()
}

fn positive(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite() && *v > 0.0)
}

fn load<T: serde::de::DeserializeOwned + Default>(conn: &rusqlite::Connection, key: &str) -> T {
    crate::persistence::settings::setting_from(conn, key)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn store<T: Serialize>(conn: &rusqlite::Connection, key: &str, value: &T) -> rusqlite::Result<()> {
    let raw = serde_json::to_string(value)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    crate::persistence::settings::set_settings_on(conn, &[(key.to_string(), raw)]).map(|_| ())
}

/// The file figure for `field` in force at `at`: the newest record at or
/// before `at` that carries it, else the earliest after it. `sport` of `None`
/// reads every sport's records.
fn file_figure(
    records: &[FileRecord],
    sport: Option<&str>,
    field: ThresholdField,
    at: i64,
) -> Option<f64> {
    let carrying = || {
        records
            .iter()
            .filter(|r| sport.is_none_or(|s| r.sport == s))
            .filter_map(|r| positive(r.figures.get(field)).map(|v| (r.at, v)))
    };
    carrying()
        .filter(|(when, _)| *when <= at)
        .max_by_key(|(when, _)| *when)
        .or_else(|| carrying().min_by_key(|(when, _)| *when))
        .map(|(_, value)| value)
}

/// Keep what an activity file at `at` says of the athlete's thresholds. A file
/// that carries none, or none that differ from the figures already in force at
/// its date, writes nothing, so the list grows by changes rather than by
/// activities.
pub(crate) fn record_file_thresholds(
    conn: &rusqlite::Connection,
    sport: &str,
    at: i64,
    found: &crate::fit::FitThresholds,
) -> rusqlite::Result<()> {
    let figures = Figures {
        ftp: positive(found.ftp),
        threshold_hr: positive(found.threshold_hr),
        max_hr: positive(found.max_hr),
        resting_hr: positive(found.resting_hr),
        weight_kg: positive(found.weight_kg),
    };
    if figures.is_empty() {
        return Ok(());
    }
    let sport = sport_key(sport);
    let mut records: Vec<FileRecord> = load(conn, FILE_KEY);
    let unchanged = FIELDS.iter().all(|field| {
        figures
            .get(*field)
            .is_none_or(|new| file_figure(&records, Some(&sport), *field, at) == Some(new))
    });
    if unchanged {
        return Ok(());
    }
    records.retain(|r| !(r.sport == sport && r.at == at));
    records.push(FileRecord { sport, at, figures });
    records.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.sport.cmp(&b.sport)));
    store(conn, FILE_KEY, &records)
}

/// The thresholds and profile `sport` is judged against on `at`, each with its
/// source. The athlete's own figure wins, then the sport settings body
/// intervals.icu holds, then the files: resting heart rate and weight, which
/// are the athlete's rather than a sport's, fall back to any sport's file.
/// Zone bounds are not answered here.
pub(crate) fn thresholds_for(
    conn: &rusqlite::Connection,
    sport: &str,
    at: i64,
) -> AthleteThresholds {
    let key = sport_key(sport);
    let records: Vec<FileRecord> = load(conn, FILE_KEY);
    let overrides: std::collections::BTreeMap<String, Figures> = load(conn, OVERRIDE_KEY);
    let body = SportSettings::read(conn);
    let entry = body.entry_for(sport);
    let mut out = AthleteThresholds::default();
    let put = |field: ThresholdField, slot: &mut Option<Sourced>| {
        let athlete = overrides.get(&key).and_then(|f| positive(f.get(field)));
        let icu = entry.and_then(|e| match field {
            ThresholdField::Ftp => positive(e.ftp),
            ThresholdField::ThresholdHr => positive(e.lthr),
            ThresholdField::MaxHr => positive(e.max_hr),
            _ => None,
        });
        let file = file_figure(&records, Some(&key), field, at).or_else(|| {
            PROFILE_FIELDS
                .contains(&field)
                .then(|| file_figure(&records, None, field, at))
                .flatten()
        });
        *slot = athlete
            .map(|value| Sourced {
                value,
                source: ThresholdSource::Athlete,
            })
            .or(icu.map(|value| Sourced {
                value,
                source: ThresholdSource::SportSettings,
            }))
            .or(file.map(|value| Sourced {
                value,
                source: ThresholdSource::File,
            }));
    };
    put(ThresholdField::Ftp, &mut out.ftp);
    put(ThresholdField::ThresholdHr, &mut out.threshold_hr);
    put(ThresholdField::MaxHr, &mut out.max_hr);
    put(ThresholdField::RestingHr, &mut out.resting_hr);
    put(ThresholdField::WeightKg, &mut out.weight_kg);
    out
}

/// Set one figure for `sport`'s family by hand, or clear it with `None` so the
/// files answer again. A value that is not a positive number is refused.
pub(crate) fn set_threshold_override(
    conn: &rusqlite::Connection,
    sport: &str,
    field: ThresholdField,
    value: Option<f64>,
) -> Result<(), String> {
    if let Some(v) = value.filter(|v| !(v.is_finite() && *v > 0.0)) {
        return Err(format!("{v} is not a positive number"));
    }
    let mut overrides: std::collections::BTreeMap<String, Figures> = load(conn, OVERRIDE_KEY);
    let key = sport_key(sport);
    *overrides.entry(key.clone()).or_default().slot(field) = value;
    if overrides.get(&key).is_some_and(Figures::is_empty) {
        overrides.remove(&key);
    }
    store(conn, OVERRIDE_KEY, &overrides).map_err(|e| e.to_string())
}

fn strings<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| match item {
                Value::String(s) => Some(s),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    })
}

fn flag<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(Value::deserialize(d)?.as_bool() == Some(true))
}

fn number<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(Value::deserialize(d)?.as_f64())
}

fn numbers<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<f64>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Array(items) => items.iter().filter_map(Value::as_f64).collect(),
        _ => Vec::new(),
    })
}

fn names<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Array(items) => items
            .into_iter()
            .map(|item| match item {
                Value::String(s) => Some(s),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()
            .unwrap_or_default(),
        _ => Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SETTINGS: &str = r#"[
        {"types":["Ride","GravelRide"],"other":false,"ftp":212,"lthr":171,"max_hr":198,
         "hr_zones":[130,145,160,170,185,198],"power_zones":[55,75,90,105,120,150,999],
         "hr_zone_names":["Easy","Steady"],"power_zone_names":["Spin",4],"sft_type":"x"},
        7,
        {"types":["Run",3],"lthr":"fast","hr_zones":[150,"x",170],"max_hr":null},
        {"types":["Other"],"other":true,"max_hr":192}
    ]"#;

    #[test]
    fn entries_read_the_wire_shape_and_unset_what_they_cannot_read() {
        let settings = SportSettings::parse(Some(SETTINGS));
        assert_eq!(
            settings.0.len(),
            3,
            "an element that is not an object is skipped"
        );

        let ride = settings.entry_for("GravelRide").unwrap();
        assert_eq!(ride.ftp, Some(212.0));
        assert_eq!(ride.lthr, Some(171.0));
        assert_eq!(ride.max_hr, Some(198.0));
        assert_eq!(
            ride.hr_zones,
            vec![130.0, 145.0, 160.0, 170.0, 185.0, 198.0]
        );
        assert_eq!(ride.hr_zone_names, vec!["Easy", "Steady"]);
        assert!(
            ride.power_zone_names.is_empty(),
            "one name that is not a string empties the list"
        );
        assert!(!ride.other);

        let run = settings.entry_for("Run").unwrap();
        assert_eq!(run.types, vec!["Run"]);
        assert_eq!(run.lthr, None);
        assert_eq!(run.max_hr, None);
        assert_eq!(run.hr_zones, vec![150.0, 170.0]);
    }

    #[test]
    fn an_unlisted_sport_takes_the_entry_for_unlisted_sports_and_a_family_has_no_fallback() {
        let settings = SportSettings::parse(Some(SETTINGS));

        assert_eq!(settings.entry_for("Walk").unwrap().max_hr, Some(192.0));
        assert!(settings.entry_for("Walk").unwrap().other);
        assert_eq!(
            settings.family_entry_for("VirtualRide").unwrap().ftp,
            Some(212.0)
        );
        assert_eq!(
            settings.entry_for("VirtualRide").unwrap().max_hr,
            Some(192.0)
        );
        assert!(settings.family_entry_for("Walk").is_none());
        assert!(settings.family_entry_for("Swim").is_none());
    }

    #[test]
    fn the_first_entry_listing_a_sport_wins_over_a_later_one() {
        let settings = SportSettings::parse(Some(
            r#"[{"types":["Ride"],"ftp":200},{"types":["Ride","VirtualRide"],"ftp":300}]"#,
        ));
        assert_eq!(settings.entry_for("Ride").unwrap().ftp, Some(200.0));
        assert_eq!(
            settings.family_entry_for("VirtualRide").unwrap().ftp,
            Some(200.0)
        );
        assert_eq!(settings.entry_for("VirtualRide").unwrap().ftp, Some(300.0));
    }

    #[test]
    fn power_zones_place_watts_against_the_ftp_with_the_top_zone_open() {
        let settings = SportSettings::parse(Some(SETTINGS));
        let ride = settings.entry_for("Ride").unwrap();
        assert_eq!(
            ride.power_zones,
            vec![55.0, 75.0, 90.0, 105.0, 120.0, 150.0, 999.0]
        );

        assert_eq!(ride.zone_for_power(198.0, 180.0), Some(5), "110 % of FTP");
        assert_eq!(
            ride.zone_for_power(99.0, 180.0),
            Some(1),
            "a reading on a bound belongs to the zone it tops"
        );
        assert_eq!(ride.zone_for_power(99.5, 180.0), Some(2));
        assert_eq!(ride.zone_for_power(400.0, 180.0), Some(7));
        assert_eq!(
            ride.zone_for_power(5000.0, 180.0),
            Some(7),
            "past the open top is still the top zone"
        );
        assert_eq!(ride.zone_for_power(1.0, 180.0), Some(1));
    }

    #[test]
    fn power_zones_place_nothing_without_a_reading_an_ftp_or_usable_bounds() {
        let settings = SportSettings::parse(Some(SETTINGS));
        let ride = settings.entry_for("Ride").unwrap();
        for (watts, ftp) in [(0.0, 180.0), (-5.0, 180.0), (f64::NAN, 180.0), (198.0, 0.0)] {
            assert_eq!(ride.zone_for_power(watts, ftp), None, "{watts} W at {ftp}");
        }

        let walk = settings.entry_for("Walk").unwrap();
        assert!(walk.power_zones.is_empty());
        assert_eq!(walk.zone_for_power(198.0, 180.0), None);

        let broken =
            SportSettings::parse(Some(r#"[{"types":["Ride"],"power_zones":[55,0,90,999]}]"#));
        assert_eq!(
            broken
                .entry_for("Ride")
                .unwrap()
                .zone_for_power(198.0, 180.0),
            None
        );
    }

    #[test]
    fn a_body_that_is_not_an_array_has_no_entries() {
        for raw in [
            None,
            Some("{"),
            Some(r#"{"ftp":200}"#),
            Some("null"),
            Some("[]"),
        ] {
            let settings = SportSettings::parse(raw);
            assert!(settings.entry_for("Ride").is_none(), "{raw:?}");
            assert!(settings.family_entry_for("Ride").is_none(), "{raw:?}");
        }
    }

    fn settings_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER);
             CREATE TABLE sport_settings (id TEXT PRIMARY KEY, data TEXT);",
        )
        .unwrap();
        conn
    }

    fn read(ftp: f64, lthr: f64) -> crate::fit::FitThresholds {
        crate::fit::FitThresholds {
            ftp: Some(ftp),
            threshold_hr: Some(lthr),
            max_hr: Some(199.0),
            weight_kg: Some(79.0),
            ..Default::default()
        }
    }

    const DAY: i64 = 86_400;

    #[test]
    fn a_library_with_only_files_answers_the_newest_files_figures() {
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();
        record_file_thresholds(&conn, "Ride", 20 * DAY, &read(251.0, 177.0)).unwrap();

        let now = thresholds_for(&conn, "GravelRide", 30 * DAY);
        assert_eq!(
            now.ftp,
            Some(Sourced {
                value: 251.0,
                source: ThresholdSource::File
            })
        );
        assert_eq!(now.threshold_hr.map(|t| t.value), Some(177.0));
        assert_eq!(now.max_hr.map(|t| t.value), Some(199.0));
        assert_eq!(now.weight_kg.map(|t| t.value), Some(79.0));
        assert_eq!(now.resting_hr, None);
    }

    #[test]
    fn a_date_between_two_files_answers_the_earlier_file() {
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();
        record_file_thresholds(&conn, "Ride", 20 * DAY, &read(251.0, 177.0)).unwrap();

        assert_eq!(
            thresholds_for(&conn, "Ride", 15 * DAY).ftp.map(|t| t.value),
            Some(240.0)
        );
        assert_eq!(
            thresholds_for(&conn, "Ride", 10 * DAY).ftp.map(|t| t.value),
            Some(240.0)
        );
    }

    #[test]
    fn a_date_before_every_file_answers_the_earliest_file() {
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();
        assert_eq!(
            thresholds_for(&conn, "Ride", DAY).ftp.map(|t| t.value),
            Some(240.0)
        );
    }

    #[test]
    fn a_sport_with_no_file_figures_answers_none_but_the_profile_follows_the_athlete() {
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();

        let run = thresholds_for(&conn, "Run", 20 * DAY);
        assert_eq!(run.ftp, None);
        assert_eq!(run.threshold_hr, None);
        assert_eq!(run.weight_kg.map(|t| t.value), Some(79.0));
    }

    #[test]
    fn a_file_with_no_figures_records_nothing() {
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", DAY, &crate::fit::FitThresholds::default()).unwrap();
        assert_eq!(
            crate::persistence::settings::setting_from(&conn, FILE_KEY).unwrap(),
            None
        );
    }

    #[test]
    fn a_file_repeating_the_figures_in_force_adds_no_record() {
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();
        let once = crate::persistence::settings::setting_from(&conn, FILE_KEY).unwrap();
        record_file_thresholds(&conn, "Ride", 20 * DAY, &read(240.0, 170.0)).unwrap();
        assert_eq!(
            crate::persistence::settings::setting_from(&conn, FILE_KEY).unwrap(),
            once
        );
    }

    #[test]
    fn an_older_file_ingested_late_does_not_replace_a_newer_figure() {
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", 20 * DAY, &read(251.0, 177.0)).unwrap();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();

        assert_eq!(
            thresholds_for(&conn, "Ride", 30 * DAY).ftp.map(|t| t.value),
            Some(251.0)
        );
        assert_eq!(
            thresholds_for(&conn, "Ride", 12 * DAY).ftp.map(|t| t.value),
            Some(240.0)
        );
    }

    #[test]
    fn what_the_athlete_sets_wins_over_the_files_and_clears_back_to_them() {
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();

        set_threshold_override(&conn, "GravelRide", ThresholdField::Ftp, Some(265.0)).unwrap();
        let set = thresholds_for(&conn, "Ride", 20 * DAY);
        assert_eq!(
            set.ftp,
            Some(Sourced {
                value: 265.0,
                source: ThresholdSource::Athlete
            })
        );
        assert_eq!(
            set.threshold_hr.map(|t| t.source),
            Some(ThresholdSource::File)
        );

        set_threshold_override(&conn, "Ride", ThresholdField::Ftp, None).unwrap();
        let cleared = thresholds_for(&conn, "Ride", 20 * DAY);
        assert_eq!(
            cleared.ftp,
            Some(Sourced {
                value: 240.0,
                source: ThresholdSource::File
            })
        );
    }

    #[test]
    fn an_override_that_is_not_a_positive_number_is_refused_and_changes_nothing() {
        let conn = settings_db();
        for bad in [0.0, -5.0, f64::NAN, f64::INFINITY] {
            assert!(set_threshold_override(&conn, "Ride", ThresholdField::Ftp, Some(bad)).is_err());
        }
        assert_eq!(thresholds_for(&conn, "Ride", DAY).ftp, None);
    }

    #[test]
    fn the_sport_settings_body_answers_before_the_files() {
        let conn = settings_db();
        conn.execute(
            "INSERT INTO sport_settings (id, data) VALUES ('current', ?)",
            [r#"[{"types":["Ride"],"ftp":300}]"#],
        )
        .unwrap();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();

        let found = thresholds_for(&conn, "Ride", 20 * DAY);
        assert_eq!(
            found.ftp,
            Some(Sourced {
                value: 300.0,
                source: ThresholdSource::SportSettings
            })
        );
        assert_eq!(
            found.threshold_hr.map(|t| t.source),
            Some(ThresholdSource::File)
        );
    }

    fn figure(
        screen: &crate::FfiThresholdsScreenData,
        sport: &str,
        field: crate::FfiThresholdField,
    ) -> (Option<f64>, Option<crate::FfiThresholdSource>) {
        let found = screen
            .sports
            .iter()
            .find(|s| s.sport == sport)
            .and_then(|s| s.figures.iter().find(|f| f.field == field))
            .unwrap();
        (found.value, found.source)
    }

    #[test]
    fn the_thresholds_screen_shows_the_files_then_the_athletes_figure_then_the_files_again() {
        use crate::{FfiThresholdField as Field, FfiThresholdSource as Source};
        let conn = settings_db();
        record_file_thresholds(&conn, "Ride", 10 * DAY, &read(240.0, 170.0)).unwrap();

        let screen = crate::persistence::screens::thresholds_screen_at(&conn, 20 * DAY);
        assert_eq!(
            figure(&screen, "Ride", Field::Ftp),
            (Some(240.0), Some(Source::File))
        );
        assert_eq!(figure(&screen, "Run", Field::Ftp), (None, None));
        assert_eq!(
            screen.hr_zone_default_percents,
            vec![60.0, 70.0, 80.0, 90.0, 100.0]
        );

        set_threshold_override(&conn, "Ride", ThresholdField::Ftp, Some(265.0)).unwrap();
        let screen = crate::persistence::screens::thresholds_screen_at(&conn, 20 * DAY);
        assert_eq!(
            figure(&screen, "Ride", Field::Ftp),
            (Some(265.0), Some(Source::Athlete))
        );

        set_threshold_override(&conn, "Ride", ThresholdField::Ftp, None).unwrap();
        let screen = crate::persistence::screens::thresholds_screen_at(&conn, 20 * DAY);
        assert_eq!(
            figure(&screen, "Ride", Field::Ftp),
            (Some(240.0), Some(Source::File))
        );
    }
}
