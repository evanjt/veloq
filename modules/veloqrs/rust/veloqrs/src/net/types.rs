//! serde response types and parsed output records for intervals.icu endpoints.
//!
//! Each raw `*Dto` mirrors the JSON the server returns; the parsed record is the
//! shape the app consumes (matching the old TypeScript return types and
//! transforms in `src/api/intervals.ts` + `src/features/activity/lib/streams.ts`).
//! Unknown JSON fields are ignored, so requesting a `fields=` subset is safe.

use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub moving_time: Option<i64>,
    #[serde(default)]
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
    pub icu_average_watts: Option<f64>,
    #[serde(default)]
    pub average_watts: Option<f64>,
    #[serde(default)]
    pub max_watts: Option<f64>,
    #[serde(default)]
    pub average_cadence: Option<f64>,
    #[serde(default)]
    pub calories: Option<f64>,
    #[serde(default)]
    pub icu_training_load: Option<f64>,
    #[serde(default)]
    pub icu_ftp: Option<f64>,
    #[serde(default)]
    pub has_weather: Option<bool>,
    #[serde(default)]
    pub average_weather_temp: Option<f64>,
    #[serde(default)]
    pub stream_types: Option<Vec<String>>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
}

/// The base field list the activities request asks for (matches `intervals.ts`).
pub const ACTIVITY_FIELDS: &str = "id,name,type,start_date_local,moving_time,elapsed_time,distance,total_elevation_gain,average_speed,max_speed,icu_average_hr,icu_max_hr,average_heartrate,average_watts,max_watts,icu_average_watts,average_cadence,calories,icu_training_load,has_weather,average_weather_temp,icu_ftp,stream_types,locality,country,skyline_chart_bytes";

/// The additional stats fields appended when `includeStats` is set.
pub const ACTIVITY_STATS_EXTRA: &str =
    "icu_pm_ftp_watts,icu_zone_times,icu_hr_zone_times,icu_power_zones,icu_hr_zones";

// ===========================================================================
// Streams
// ===========================================================================

/// One raw stream object from `streams.json`. `latlng` carries lat in `data`
/// and lng in `data2`; numeric gaps come through as JSON null.
///
/// Serialised as well as deserialised, because a body rebuilt from the stored
/// track is handed to the same `parseStreams` a live response goes through.
/// `data2` is skipped when absent so a reconstruction is byte-shaped like a
/// server response rather than carrying a null the wire never sends.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StreamDto {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub data: Vec<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data2: Option<Vec<Option<f64>>>,
}

/// One series whose sample count disagrees with the `latlng` index space. The
/// server sends every series at the same length, so a disagreement means the
/// response is malformed and the parsed values cannot be trusted positionally.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeriesLengthMismatch {
    pub series: &'static str,
    /// Samples the series carries.
    pub len: usize,
    /// Samples the `latlng` index space covers.
    pub expected: usize,
}

/// Parsed, app-facing streams.
///
/// Every series shares one index space: when the response carries `latlng`,
/// samples whose coordinate pair is null are dropped from all series alike, so
/// `latlng[i]` and `altitude[i]` describe the same sample. Any series that did
/// not line up with that space is listed in `misaligned`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedStreams {
    pub time: Vec<i64>,
    pub latlng: Vec<[f64; 2]>,
    pub altitude: Vec<f64>,
    pub altitude_is_fixed: bool,
    pub heartrate: Vec<f64>,
    pub watts: Vec<f64>,
    pub cadence: Vec<f64>,
    pub velocity_smooth: Vec<f64>,
    pub distance: Vec<f64>,
    pub grade_smooth: Vec<f64>,
    pub temp: Vec<f64>,
    pub wbal: Vec<f64>,
    pub gap: Vec<f64>,
    pub misaligned: Vec<SeriesLengthMismatch>,
}

/// Pace in minutes per `reference_meters`, from a speed in m/s. Mirrors
/// `paceMinutesFromSpeed` (reference 1000 m). Non-positive / non-finite -> 0.
pub fn pace_minutes_from_speed(speed_ms: f64, reference_meters: f64) -> f64 {
    if !(speed_ms > 0.0) || !speed_ms.is_finite() {
        return 0.0;
    }
    let pace = reference_meters / speed_ms / 60.0;
    if pace.is_finite() { pace } else { 0.0 }
}

fn fill(v: &[Option<f64>]) -> Vec<f64> {
    v.iter().map(|x| x.unwrap_or(f64::NAN)).collect()
}

/// A coordinate the engine will store. The validity mask, the parsed `latlng`
/// and the stored track share this gate, so every series stays in the index
/// space the stored points actually occupy.
pub(crate) fn is_storable(lat: f64, lng: f64) -> bool {
    lat.is_finite()
        && lng.is_finite()
        && (-90.0..=90.0).contains(&lat)
        && (-180.0..=180.0).contains(&lng)
}

/// Sample validity taken from `latlng`: true where both lat and lng are present.
/// `None` when the response carries no usable `latlng`, in which case every
/// series keeps its own length.
fn latlng_mask(raw: &[StreamDto], misaligned: &mut Vec<SeriesLengthMismatch>) -> Option<Vec<bool>> {
    let s = raw.iter().find(|s| s.kind == "latlng")?;
    let Some(lng) = s.data2.as_ref() else {
        log::warn!(
            "[Streams] latlng carries {} lat samples and no lng series",
            s.data.len()
        );
        misaligned.push(SeriesLengthMismatch {
            series: "latlng",
            len: s.data.len(),
            expected: 0,
        });
        return None;
    };
    let n = s.data.len().min(lng.len());
    let longest = s.data.len().max(lng.len());
    if longest != n {
        log::warn!(
            "[Streams] latlng carries {} lat and {} lng samples",
            s.data.len(),
            lng.len()
        );
        misaligned.push(SeriesLengthMismatch {
            series: "latlng",
            len: longest,
            expected: n,
        });
    }
    Some(
        (0..n)
            .map(|i| match (s.data[i], lng[i]) {
                (Some(la), Some(lo)) => is_storable(la, lo),
                _ => false,
            })
            .collect(),
    )
}

/// One series reduced to the valid samples, gaps as NaN. A series whose length
/// disagrees with the mask source is recorded in `misaligned` and logged before
/// it is reduced, so a discarded tail or a padded gap never passes unremarked.
fn select(
    kind: &'static str,
    mask: Option<&[bool]>,
    v: &[Option<f64>],
    misaligned: &mut Vec<SeriesLengthMismatch>,
) -> Vec<f64> {
    let Some(m) = mask else {
        return fill(v);
    };
    if v.len() != m.len() {
        log::warn!(
            "[Streams] series {} carries {} samples, the latlng index space covers {}",
            kind,
            v.len(),
            m.len()
        );
        misaligned.push(SeriesLengthMismatch {
            series: kind,
            len: v.len(),
            expected: m.len(),
        });
    }
    m.iter()
        .enumerate()
        .filter(|(_, keep)| **keep)
        .map(|(i, _)| v.get(i).copied().flatten().unwrap_or(f64::NAN))
        .collect()
}

/// Convert raw stream objects into the parsed shape: zip latlng data/data2,
/// prefer `fixed_altitude` over `altitude`, convert `ga_velocity` (m/s) to gap
/// pace (min/km).
///
/// The `latlng` validity mask governs every series, so all of them come back the
/// same length in one index space. TypeScript's `parseStreams` applies the same
/// rule, so the chart cursor and the map cursor index the same samples.
pub fn parse_streams(raw: Vec<StreamDto>) -> ParsedStreams {
    let mut out = ParsedStreams::default();
    let mut misaligned = Vec::new();
    let mask = latlng_mask(&raw, &mut misaligned);
    let mask = mask.as_deref();
    for s in raw {
        match s.kind.as_str() {
            // A NaN gap saturates to 0 on the cast.
            "time" => {
                out.time = select("time", mask, &s.data, &mut misaligned)
                    .into_iter()
                    .map(|x| x as i64)
                    .collect()
            }
            "latlng" => {
                if let Some(lng) = &s.data2 {
                    let n = s.data.len().min(lng.len());
                    out.latlng = (0..n)
                        .filter_map(|i| match (s.data[i], lng[i]) {
                            (Some(la), Some(lo)) if is_storable(la, lo) => Some([la, lo]),
                            _ => None,
                        })
                        .collect();
                }
            }
            "altitude" => {
                if !out.altitude_is_fixed {
                    out.altitude = select("altitude", mask, &s.data, &mut misaligned);
                }
            }
            "fixed_altitude" => {
                out.altitude = select("fixed_altitude", mask, &s.data, &mut misaligned);
                out.altitude_is_fixed = true;
            }
            "heartrate" => out.heartrate = select("heartrate", mask, &s.data, &mut misaligned),
            "watts" => out.watts = select("watts", mask, &s.data, &mut misaligned),
            "cadence" => out.cadence = select("cadence", mask, &s.data, &mut misaligned),
            "velocity_smooth" => {
                out.velocity_smooth = select("velocity_smooth", mask, &s.data, &mut misaligned)
            }
            "distance" => out.distance = select("distance", mask, &s.data, &mut misaligned),
            "grade_smooth" => {
                out.grade_smooth = select("grade_smooth", mask, &s.data, &mut misaligned)
            }
            "temp" => out.temp = select("temp", mask, &s.data, &mut misaligned),
            "w_bal" => out.wbal = select("w_bal", mask, &s.data, &mut misaligned),
            "ga_velocity" => {
                out.gap = select("ga_velocity", mask, &s.data, &mut misaligned)
                    .into_iter()
                    .map(|x| pace_minutes_from_speed(x, 1000.0))
                    .collect()
            }
            _ => {}
        }
    }
    out.misaligned = misaligned;
    out
}

// ===========================================================================
// Intervals / laps
// ===========================================================================

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
// Power / pace curves
// ===========================================================================

/// Find the oldest `start_date_local` in an activities list (the reduce in
/// `getOldestActivityDate`). Returns None for an empty list.
pub fn oldest_activity_date(activities: &[ActivityRecord]) -> Option<String> {
    activities
        .iter()
        .filter_map(|a| a.start_date_local.clone())
        .min()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_activities_subset() {
        // Shape derived from the live activities endpoint; values synthetic.
        let body = json!([
            {"id": "a1", "name": "Morning Ride", "type": "Ride", "start_date_local": "2026-06-20T07:00:00",
             "moving_time": 3600, "distance": 30000.0, "average_watts": 180, "icu_training_load": 65,
             "has_weather": true, "stream_types": ["time", "watts", "latlng"], "extra_unmodelled": 7},
            {"id": "a2", "name": "Run", "type": "Run", "start_date_local": "2026-06-18T18:00:00",
             "moving_time": 1800, "distance": 5000.0}
        ]);
        let acts: Vec<ActivityRecord> = serde_json::from_value(body).unwrap();
        assert_eq!(acts.len(), 2);
        assert_eq!(acts[0].id, "a1");
        assert_eq!(acts[0].activity_type.as_deref(), Some("Ride"));
        assert_eq!(acts[0].average_watts, Some(180.0)); // int coerced to f64
        assert_eq!(acts[0].stream_types.as_ref().unwrap().len(), 3);
        assert_eq!(acts[1].distance, Some(5000.0));
    }

    #[test]
    fn oldest_date_is_min_start() {
        let acts: Vec<ActivityRecord> = serde_json::from_value(json!([
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
    fn parse_streams_zips_latlng_and_prefers_fixed_altitude() {
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "time", "data": [0, 1, 2]},
            {"type": "latlng", "data": [42.5, 42.6, 42.7], "data2": [1.1, 1.2, 1.3]},
            {"type": "altitude", "data": [100.0, 101.0, 102.0]},
            {"type": "fixed_altitude", "data": [200.0, 201.0, 202.0]},
            {"type": "watts", "data": [150, 160, 170]},
            {"type": "ga_velocity", "data": [5.0, 0.0, 4.0]}
        ]))
        .unwrap();
        let s = parse_streams(raw);
        assert_eq!(s.time, vec![0, 1, 2]);
        assert_eq!(s.latlng, vec![[42.5, 1.1], [42.6, 1.2], [42.7, 1.3]]);
        assert!(s.altitude_is_fixed);
        assert_eq!(s.altitude, vec![200.0, 201.0, 202.0]); // fixed wins
        assert_eq!(s.watts, vec![150.0, 160.0, 170.0]);
        // ga_velocity 5 m/s -> 1000/5/60 = 3.333.. min/km; 0 -> 0.
        assert!((s.gap[0] - (1000.0 / 5.0 / 60.0)).abs() < 1e-9);
        assert_eq!(s.gap[1], 0.0);
    }

    #[test]
    fn parse_streams_drops_altitude_at_a_null_coordinate() {
        // Distinct altitude per index, so a series that compacted independently
        // of latlng would land on the wrong samples rather than the right ones.
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "latlng", "data": [42.5, null, 42.7, null, 42.9],
             "data2": [1.1, null, 1.3, null, 1.5]},
            {"type": "altitude", "data": [100.0, 200.0, 300.0, 400.0, 500.0]}
        ]))
        .unwrap();
        let s = parse_streams(raw);
        assert_eq!(s.latlng, vec![[42.5, 1.1], [42.7, 1.3], [42.9, 1.5]]);
        assert_eq!(s.altitude, vec![100.0, 300.0, 500.0]);
        assert!(s.misaligned.is_empty());
    }

    #[test]
    fn parse_streams_leaves_altitude_empty_when_the_series_is_absent() {
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "latlng", "data": [42.5, 42.6], "data2": [1.1, 1.2]}
        ]))
        .unwrap();
        let s = parse_streams(raw);
        assert_eq!(s.latlng.len(), 2);
        assert!(s.altitude.is_empty());
        assert!(!s.altitude_is_fixed);
    }

    #[test]
    fn parse_streams_altitude_used_when_no_fixed() {
        let raw: Vec<StreamDto> =
            serde_json::from_value(json!([{"type": "altitude", "data": [10.0, 11.0]}])).unwrap();
        let s = parse_streams(raw);
        assert!(!s.altitude_is_fixed);
        assert_eq!(s.altitude, vec![10.0, 11.0]);
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
    fn pace_minutes_from_speed_guards_invalid() {
        assert_eq!(pace_minutes_from_speed(0.0, 1000.0), 0.0);
        assert_eq!(pace_minutes_from_speed(-3.0, 1000.0), 0.0);
        assert_eq!(pace_minutes_from_speed(f64::NAN, 1000.0), 0.0);
        assert!((pace_minutes_from_speed(5.0, 1000.0) - 3.3333333333).abs() < 1e-6);
    }

    // Golden tests below mirror the real `streams.json`, activities, intervals,
    // sport-settings, wellness, and curve envelopes captured from intervals.icu.
    // Values are synthetic/anonymised; the key set, types, and null placement
    // match the live shapes so the parse stays pinned to the server contract.

    #[test]
    fn parse_streams_ignores_server_envelope() {
        // Each live stream carries an envelope (allNull, anomalies, custom, name,
        // valueType, valueTypeIsArray) and a `data2` that is JSON null on every
        // non-latlng series. serde must ignore the envelope and treat data2: null
        // as absent, while still zipping latlng from data (lat) + data2 (lng).
        let raw: Vec<StreamDto> = serde_json::from_value(json!([
            {"type": "time", "name": null, "data": [0, 1, 2], "data2": null,
             "valueType": "INTEGER", "valueTypeIsArray": false, "allNull": false,
             "anomalies": null, "custom": false},
            {"type": "latlng", "name": null, "data": [42.5, 42.6, 42.7],
             "data2": [1.1, 1.2, 1.3], "valueType": "FLOAT", "valueTypeIsArray": true,
             "allNull": false, "anomalies": null, "custom": false},
            {"type": "watts", "name": null, "data": [150, 160, 170], "data2": null,
             "valueType": "INTEGER", "valueTypeIsArray": false, "allNull": false}
        ]))
        .unwrap();
        let s = parse_streams(raw);
        assert_eq!(s.time, vec![0, 1, 2]);
        assert_eq!(s.latlng, vec![[42.5, 1.1], [42.6, 1.2], [42.7, 1.3]]);
        assert_eq!(s.watts, vec![150.0, 160.0, 170.0]);
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
            "icu_average_watts": 210, "average_watts": null, "max_watts": null,
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
        assert_eq!(a.average_watts, None); // null power -> None
        assert_eq!(a.max_watts, None);
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
