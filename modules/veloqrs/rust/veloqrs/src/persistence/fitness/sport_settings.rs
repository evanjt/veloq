//! The athlete's sport settings, read once into typed entries.
//!
//! The sync stores the `sportSettings` array the athlete body carries as it
//! arrived. Every reader here takes it through [`SportSettings`], so the rule
//! for which entry covers a sport lives in one place. Each field is read
//! leniently: a key that is missing, `null` or of another type reads as unset
//! rather than failing the entry, and keys not modelled here are ignored.

use serde::{Deserialize, Deserializer};
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
}
