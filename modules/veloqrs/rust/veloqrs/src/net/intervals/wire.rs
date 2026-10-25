//! What intervals.icu speaks: the field lists a request asks for and the serde
//! shapes of the records it sends and accepts.
//!
//! Unknown JSON fields are ignored, so requesting a `fields=` subset is safe.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ===========================================================================
// Activities
// ===========================================================================

/// One activity as returned by the activities list / detail endpoints. Only the
/// fields the app consumes are modelled; the rest are ignored by serde.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ActivityRecord {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "type", default)]
    pub activity_type: Option<String>,
    #[serde(default)]
    pub start_date_local: Option<String>,
    #[serde(default, deserialize_with = "whole_seconds")]
    pub moving_time: Option<i64>,
    #[serde(default, deserialize_with = "whole_seconds")]
    pub elapsed_time: Option<i64>,
    #[serde(default)]
    pub distance: Option<f64>,
    #[serde(default)]
    pub total_elevation_gain: Option<f64>,
    #[serde(default)]
    pub average_speed: Option<f64>,
    #[serde(default)]
    pub max_speed: Option<f64>,
    #[serde(default)]
    pub average_heartrate: Option<f64>,
    #[serde(default)]
    pub max_heartrate: Option<f64>,
    #[serde(default)]
    pub icu_average_watts: Option<f64>,
    #[serde(default)]
    pub icu_pm_p_max: Option<f64>,
    #[serde(default)]
    pub average_cadence: Option<f64>,
    #[serde(default)]
    pub calories: Option<f64>,
    #[serde(default)]
    pub icu_training_load: Option<f64>,
    #[serde(default)]
    pub icu_ftp: Option<f64>,
    /// The accepted eFTP after this activity, and what this activity moved it
    /// by. intervals.icu marks the pair on its own plot, and only a non-zero
    /// delta is a change.
    #[serde(default)]
    pub icu_rolling_ftp: Option<f64>,
    #[serde(default)]
    pub icu_rolling_ftp_delta: Option<f64>,
    /// Power zone times, one entry per zone.
    #[serde(default, deserialize_with = "lenient")]
    pub icu_zone_times: Option<Vec<ZoneTime>>,
    /// HR zone times in seconds, one entry per zone.
    #[serde(default, deserialize_with = "lenient")]
    pub icu_hr_zone_times: Option<Vec<i64>>,
    #[serde(default)]
    pub has_weather: Option<bool>,
    #[serde(default)]
    pub average_weather_temp: Option<f64>,
    #[serde(default)]
    pub stream_types: Option<Vec<String>>,
    /// The elevation skyline the feed card draws, base64 as intervals.icu
    /// sends it.
    #[serde(default)]
    pub skyline_chart_bytes: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
    /// Where intervals.icu got the activity (`GARMIN_CONNECT`, `STRAVA`, ...),
    /// and the id it holds there.
    #[serde(default, deserialize_with = "lenient")]
    pub source: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub external_id: Option<String>,
    /// The note an empty stub carries in place of the activity. intervals.icu
    /// answers a stub for an activity it holds but may not serve to apps.
    #[serde(default, rename = "_note", deserialize_with = "lenient")]
    pub stub_note: Option<String>,
    /// When intervals.icu first held this activity, and when it last changed
    /// there. Asked for only by the census pull, so every other request leaves
    /// them empty.
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub icu_sync_date: Option<String>,
    /// The athlete the activity belongs to. Only `GET /activity/{id}` sends
    /// it, so a body carrying it is the detail form rather than a list row.
    #[serde(default, deserialize_with = "lenient")]
    pub icu_athlete_id: Option<String>,
    /// The detail figures the list request does not ask for, and the stored
    /// intensity and decoupling it does. Each is read leniently: a key in a
    /// shape not modelled costs that key, not the activity.
    #[serde(default, deserialize_with = "lenient")]
    pub icu_intensity: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    pub icu_pm_ftp_watts: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    pub icu_efficiency_factor: Option<f64>,
    /// Aerobic decoupling in percent. It arrives as the string `-Infinity`
    /// when a half carried no power, which reads as none.
    #[serde(default, deserialize_with = "lenient")]
    pub decoupling: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    pub trimp: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    pub strain_score: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    pub icu_hrr: Option<HeartRateRecovery>,
    /// The device sensor's average temperature, not the weather's.
    #[serde(default, deserialize_with = "lenient")]
    pub average_temp: Option<f64>,
    /// Feels-like temperature under its current name and the two older ones,
    /// in the order they are preferred.
    #[serde(default, deserialize_with = "lenient")]
    pub apparent_temperature: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    pub average_feels_like: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    pub average_temp_feels_like: Option<f64>,
    /// Wind speed in m/s.
    #[serde(default, deserialize_with = "lenient")]
    pub average_wind_speed: Option<f64>,
}

/// Heart rate recovery after the activity, as intervals.icu sends it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct HeartRateRecovery {
    #[serde(default)]
    pub start_bpm: Option<f64>,
    #[serde(default)]
    pub end_bpm: Option<f64>,
    /// The drop in beats per minute.
    #[serde(default)]
    pub hrr: Option<f64>,
}

impl ActivityRecord {
    /// Whether this is the detail form `GET /activity/{id}` answers rather
    /// than the lighter row the list sync stores.
    ///
    /// The list asks for a fixed field set and intervals.icu drops the ones
    /// the activity has nothing for, so a list body's key set varies and its
    /// size says nothing. `icu_athlete_id` is not in that set. Measured against
    /// the real API on 2026-09-12: a list pull returned 20 keys for a run and
    /// the detail 183, and the detail carried `icu_athlete_id` on all twelve
    /// activities sampled, across sports and uploading clients.
    pub fn is_detail(&self) -> bool {
        self.icu_athlete_id
            .as_deref()
            .is_some_and(|id| !id.is_empty())
    }

    /// Whether intervals.icu answered an empty stub for this activity: it
    /// holds the activity and may not serve it. The stub's note is the mark.
    pub fn is_held_back(&self) -> bool {
        self.stub_note.is_some()
    }

    /// The feels-like temperature, from whichever of its names is present.
    pub fn feels_like(&self) -> Option<f64> {
        self.apparent_temperature
            .or(self.average_feels_like)
            .or(self.average_temp_feels_like)
    }
}

/// One power zone's time, as intervals.icu sends it: `{"id": "Z1", "secs": 123}`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ZoneTime {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub secs: Option<i64>,
}

/// Read a field the app can do without, dropping it when the shape is not the
/// one modelled. A zone series in an unexpected shape is worth less than the
/// activity, and a hard failure would cost the whole page its metrics.
fn lenient<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(value).ok())
}

/// Read a duration in seconds that may arrive with a fraction. A recording
/// saved on the device stores its measured duration, and refusing the float
/// would drop the whole activity rather than round a second.
fn whole_seconds<'de, D>(d: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<f64>::deserialize(d)?.map(|secs| secs.round() as i64))
}

/// The base field list the activities request asks for. Every name is a field
/// of the Activity schema.
pub const ACTIVITY_FIELDS: &str = "id,name,type,start_date_local,moving_time,elapsed_time,distance,total_elevation_gain,average_speed,max_speed,average_heartrate,max_heartrate,icu_average_watts,icu_pm_p_max,average_cadence,calories,icu_training_load,icu_intensity,decoupling,has_weather,average_weather_temp,icu_ftp,stream_types,skyline_chart_bytes,description,source,external_id,_note";

/// The additional stats fields appended when `includeStats` is set.
pub const ACTIVITY_STATS_EXTRA: &str = "icu_pm_ftp_watts,icu_zone_times,icu_hr_zone_times,\
     icu_power_zones,icu_hr_zones,icu_rolling_ftp,icu_rolling_ftp_delta";

/// The field list one activities request asks for.
pub fn activity_list_fields(include_stats: bool) -> String {
    if include_stats {
        format!("{ACTIVITY_FIELDS},{ACTIVITY_STATS_EXTRA}")
    } else {
        ACTIVITY_FIELDS.to_string()
    }
}

/// The field list a stored list body was fetched with. Every window sync asks
/// with the stats, so this is the set `activity_bodies.raw` holds.
pub fn stored_activity_fields() -> String {
    activity_list_fields(true)
}

#[cfg(test)]
#[path = "tests/activity_fields.rs"]
mod activity_fields_tests;

// ===========================================================================
// Wellness
// ===========================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct WellnessRecord {
    /// ISO date (YYYY-MM-DD).
    pub id: String,
    #[serde(default)]
    pub ctl: Option<f64>,
    #[serde(default)]
    pub atl: Option<f64>,
    #[serde(default, rename = "rampRate")]
    pub ramp_rate: Option<f64>,
    #[serde(default)]
    pub hrv: Option<f64>,
    #[serde(default, rename = "restingHR")]
    pub resting_hr: Option<f64>,
    #[serde(default)]
    pub weight: Option<f64>,
    #[serde(default, rename = "sleepSecs")]
    pub sleep_secs: Option<f64>,
    #[serde(default, rename = "sleepScore")]
    pub sleep_score: Option<f64>,
    #[serde(default)]
    pub steps: Option<f64>,
    #[serde(default)]
    pub vo2max: Option<f64>,
    #[serde(default)]
    pub soreness: Option<i32>,
    #[serde(default)]
    pub fatigue: Option<i32>,
    #[serde(default)]
    pub stress: Option<i32>,
    #[serde(default)]
    pub mood: Option<i32>,
    #[serde(default)]
    pub motivation: Option<i32>,
}

// ===========================================================================
// Athlete + sport settings
// ===========================================================================

/// The JSON body for a manual activity entry, an activity with no file behind
/// it. Field names are the wire names, and an unset optional is omitted rather
/// than sent as null, matching what the app has always posted.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ManualActivityBody {
    #[serde(rename = "type")]
    pub activity_type: String,
    pub name: String,
    pub start_date_local: String,
    pub elapsed_time: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moving_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_elevation_gain: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_heartrate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Always sent, defaulted false by the caller.
    pub trainer: bool,
    /// Always sent, defaulted false by the caller.
    pub commute: bool,
    /// The recording's own id, so an entry whose create may have landed can
    /// be found on the server before it is posted again.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
}

/// One activity as the upload's duplicate check lists it: the four fields it
/// matches a recording on and nothing else.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct ListedActivity {
    pub id: String,
    #[serde(default)]
    pub external_id: Option<String>,
    #[serde(default)]
    pub start_date_local: Option<String>,
    #[serde(rename = "type", default)]
    pub activity_type: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AthleteRecord {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub sex: Option<String>,
}

// ===========================================================================
// Census
// ===========================================================================

/// One activity as the census pull asks for it, by its `fields=` list and
/// nothing more. The pull carries the whole history on every sync, so it is
/// decoded into these five fields rather than the full activity record.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct CensusRecord {
    pub id: String,
    #[serde(default)]
    pub start_date_local: Option<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub icu_sync_date: Option<String>,
    #[serde(default)]
    pub stream_types: Option<Vec<String>>,
}

/// Find the oldest `start_date_local` in the census pull. Returns None for an
/// empty list.
pub fn oldest_activity_date(activities: &[CensusRecord]) -> Option<String> {
    activities
        .iter()
        .filter_map(|a| a.start_date_local.clone())
        .min()
}

/// Count activities per calendar year, keyed by the `YYYY` prefix of
/// `start_date_local`. The history slider needs to say how much a widening
/// would download, and the same response that carries the oldest date carries
/// every start date, so this costs no extra request. A record with no start
/// date is skipped: it cannot be placed on the timeline either.
pub fn activity_counts_by_year(activities: &[CensusRecord]) -> BTreeMap<String, u32> {
    let mut counts = BTreeMap::new();
    for a in activities {
        let Some(date) = a.start_date_local.as_deref() else {
            continue;
        };
        if date.len() < 4 || !date[..4].bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        *counts.entry(date[..4].to_string()).or_insert(0) += 1;
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn wire_records_live_under_the_intervals_module() {
        let record: crate::net::types::ActivityRecord =
            crate::net::intervals::wire::ActivityRecord::default();
        assert_eq!(record, ActivityRecord::default());
        assert_eq!(
            crate::net::intervals::BASE_URL,
            "https://intervals.icu/api/v1"
        );
    }

    #[test]
    fn year_counts_bucket_every_dated_activity() {
        let acts: Vec<CensusRecord> = serde_json::from_value(json!([
            {"id": "a", "start_date_local": "2024-06-20T07:00:00"},
            {"id": "b", "start_date_local": "2024-01-02T07:00:00"},
            {"id": "c", "start_date_local": "2025-03-03T07:00:00"}
        ]))
        .unwrap();
        let counts = activity_counts_by_year(&acts);
        assert_eq!(counts.get("2024"), Some(&2));
        assert_eq!(counts.get("2025"), Some(&1));
        assert_eq!(counts.len(), 2);
    }

    #[test]
    fn year_counts_skip_what_cannot_be_placed() {
        // A row with no start date is already dropped by the window sync, and
        // a malformed one would bucket under a year that does not exist.
        let acts: Vec<CensusRecord> = serde_json::from_value(json!([
            {"id": "a"},
            {"id": "b", "start_date_local": "not-a-date"},
            {"id": "c", "start_date_local": "2025-03-03T07:00:00"}
        ]))
        .unwrap();
        let counts = activity_counts_by_year(&acts);
        assert_eq!(counts.len(), 1);
        assert_eq!(counts.get("2025"), Some(&1));
    }

    #[test]
    fn year_counts_of_nothing_is_empty() {
        assert!(activity_counts_by_year(&[]).is_empty());
    }

    #[test]
    fn parses_activities_subset() {
        // Shape derived from the live activities endpoint; values synthetic.
        let body = json!([
            {"id": "a1", "name": "Morning Ride", "type": "Ride", "start_date_local": "2026-06-20T07:00:00",
             "moving_time": 3600, "distance": 30000.0, "icu_average_watts": 180, "icu_training_load": 65,
             "has_weather": true, "stream_types": ["time", "watts", "latlng"], "extra_unmodelled": 7},
            {"id": "a2", "name": "Run", "type": "Run", "start_date_local": "2026-06-18T18:00:00",
             "moving_time": 1800, "distance": 5000.0}
        ]);
        let acts: Vec<ActivityRecord> = serde_json::from_value(body).unwrap();
        assert_eq!(acts.len(), 2);
        assert_eq!(acts[0].id, "a1");
        assert_eq!(acts[0].activity_type.as_deref(), Some("Ride"));
        assert_eq!(acts[0].icu_average_watts, Some(180.0)); // int coerced to f64
        assert_eq!(acts[0].stream_types.as_ref().unwrap().len(), 3);
        assert_eq!(acts[1].distance, Some(5000.0));
    }

    #[test]
    fn oldest_date_is_min_start() {
        let acts: Vec<CensusRecord> = serde_json::from_value(json!([
            {"id": "a", "start_date_local": "2026-06-20T07:00:00"},
            {"id": "b", "start_date_local": "2024-01-02T07:00:00"},
            {"id": "c", "start_date_local": "2025-03-03T07:00:00"}
        ]))
        .unwrap();
        assert_eq!(
            oldest_activity_date(&acts).as_deref(),
            Some("2024-01-02T07:00:00")
        );
        assert_eq!(oldest_activity_date(&[]), None);
    }

    #[test]
    fn parses_wellness_camelcase() {
        let w: Vec<WellnessRecord> = serde_json::from_value(json!([
            {"id": "2026-06-20", "ctl": 50.5, "atl": 60.2, "hrv": 45.0, "restingHR": 48,
             "sleepSecs": 27000, "rampRate": 1.2, "weight": 70.5}
        ]))
        .unwrap();
        assert_eq!(w[0].id, "2026-06-20");
        assert_eq!(w[0].ctl, Some(50.5));
        assert_eq!(w[0].resting_hr, Some(48.0));
        assert_eq!(w[0].sleep_secs, Some(27000.0));
        assert_eq!(w[0].ramp_rate, Some(1.2));
    }

    #[test]
    fn parses_activity_full_server_shape() {
        // One activity with the live key set: many unmodelled fields, null power
        // (no power meter), null description. serde ignores the extras, maps null
        // to None, and renames `type` to activity_type.
        let body = json!([{
            "id": "i159922890", "name": "Lunch Run", "type": "Run",
            "start_date_local": "2026-05-01T12:00:00", "moving_time": 2663,
            "elapsed_time": 2700, "distance": 6430.24, "total_elevation_gain": 160.9,
            "average_speed": 2.41, "max_speed": 4.1, "average_heartrate": 145,
            "icu_average_watts": 210, "icu_pm_p_max": null,
            "average_cadence": 82, "calories": 541, "icu_training_load": 114,
            "icu_ftp": 250, "has_weather": true, "average_weather_temp": 18.5,
            "stream_types": ["time", "heartrate", "latlng", "distance"],
            "description": null, "device_name": "Garmin",
            "icu_atl": 40.1, "icu_ctl": 55.2, "decoupling": 3.4, "pace": 415.0,
            "source": "GARMIN", "timezone": "Europe/Madrid", "strava_id": null,
            "icu_intervals_edited": false, "tags": []
        }]);
        let acts: Vec<ActivityRecord> = serde_json::from_value(body).unwrap();
        assert_eq!(acts.len(), 1);
        let a = &acts[0];
        assert_eq!(a.id, "i159922890");
        assert_eq!(a.activity_type.as_deref(), Some("Run"));
        assert_eq!(a.moving_time, Some(2663));
        assert_eq!(a.icu_average_watts, Some(210.0));
        assert_eq!(a.icu_pm_p_max, None);
        assert_eq!(a.description, None);
        assert_eq!(a.device_name.as_deref(), Some("Garmin"));
        assert_eq!(a.has_weather, Some(true));
        assert_eq!(a.stream_types.as_ref().unwrap().len(), 4);
    }

    #[test]
    fn parses_wellness_null_fields_present() {
        // Wellness rows send unmeasured metrics as explicit null (not absent);
        // Option fields must accept that. restingHR/sleepSecs arrive as integers.
        let w: Vec<WellnessRecord> = serde_json::from_value(json!([{
            "id": "2026-05-01", "ctl": 50.0, "atl": 55.0, "rampRate": null,
            "hrv": null, "restingHR": 48, "weight": null, "sleepSecs": 27000,
            "sleepScore": null, "steps": null, "vo2max": null
        }]))
        .unwrap();
        assert_eq!(w[0].id, "2026-05-01");
        assert_eq!(w[0].ctl, Some(50.0));
        assert_eq!(w[0].ramp_rate, None);
        assert_eq!(w[0].hrv, None);
        assert_eq!(w[0].weight, None);
        assert_eq!(w[0].vo2max, None);
        assert_eq!(w[0].resting_hr, Some(48.0));
        assert_eq!(w[0].sleep_secs, Some(27000.0));
    }
}
