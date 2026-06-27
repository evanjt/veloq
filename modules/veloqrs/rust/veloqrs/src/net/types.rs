//! serde response types and parsed output records for intervals.icu endpoints.
//!
//! Each raw `*Dto` mirrors the JSON the server returns; the parsed record is the
//! shape the app consumes (matching the old TypeScript return types and
//! transforms in `src/api/intervals.ts` + `src/features/activity/lib/streams.ts`).
//! Unknown JSON fields are ignored, so requesting a `fields=` subset is safe.

use serde::{Deserialize, Deserializer, Serialize};

/// Deserialize a Vec that the server may send as JSON `null` (e.g. unset zones)
/// into an empty Vec. `#[serde(default)]` alone only covers a *missing* field.
fn null_as_empty_vec<'de, D, T>(d: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(d)?.unwrap_or_default())
}

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
// Streams (parseStreams parity)
// ===========================================================================

/// One raw stream object from `streams.json`. `latlng` carries lat in `data`
/// and lng in `data2`; numeric gaps come through as JSON null.
#[derive(Debug, Clone, Deserialize)]
pub struct StreamDto {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub data: Vec<Option<f64>>,
    #[serde(default)]
    pub data2: Option<Vec<Option<f64>>>,
}

/// Parsed, app-facing streams. Mirrors `ActivityStreams` from the TS layer.
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

/// Convert raw stream objects into the parsed shape, applying the same rules as
/// the TS `parseStreams`: zip latlng data/data2, prefer `fixed_altitude` over
/// `altitude`, convert `ga_velocity` (m/s) to gap pace (min/km).
pub fn parse_streams(raw: Vec<StreamDto>) -> ParsedStreams {
    let mut out = ParsedStreams::default();
    for s in raw {
        match s.kind.as_str() {
            "time" => out.time = s.data.iter().map(|x| x.unwrap_or(0.0) as i64).collect(),
            "latlng" => {
                if let Some(lng) = &s.data2 {
                    let n = s.data.len().min(lng.len());
                    out.latlng = (0..n)
                        .filter_map(|i| match (s.data[i], lng[i]) {
                            (Some(la), Some(lo)) => Some([la, lo]),
                            _ => None,
                        })
                        .collect();
                }
            }
            "altitude" => {
                if !out.altitude_is_fixed {
                    out.altitude = fill(&s.data);
                }
            }
            "fixed_altitude" => {
                out.altitude = fill(&s.data);
                out.altitude_is_fixed = true;
            }
            "heartrate" => out.heartrate = fill(&s.data),
            "watts" => out.watts = fill(&s.data),
            "cadence" => out.cadence = fill(&s.data),
            "velocity_smooth" => out.velocity_smooth = fill(&s.data),
            "distance" => out.distance = fill(&s.data),
            "grade_smooth" => out.grade_smooth = fill(&s.data),
            "temp" => out.temp = fill(&s.data),
            "w_bal" => out.wbal = fill(&s.data),
            "ga_velocity" => {
                out.gap = s
                    .data
                    .iter()
                    .map(|x| pace_minutes_from_speed(x.unwrap_or(0.0), 1000.0))
                    .collect()
            }
            _ => {}
        }
    }
    out
}

// ===========================================================================
// Intervals / laps
// ===========================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct IntervalRecord {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(rename = "type", default)]
    pub interval_type: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub start_index: Option<i64>,
    #[serde(default)]
    pub end_index: Option<i64>,
    #[serde(default)]
    pub distance: Option<f64>,
    #[serde(default)]
    pub moving_time: Option<i64>,
    #[serde(default)]
    pub elapsed_time: Option<i64>,
    #[serde(default)]
    pub average_watts: Option<f64>,
    #[serde(default)]
    pub average_heartrate: Option<f64>,
    #[serde(default)]
    pub average_cadence: Option<f64>,
    #[serde(default)]
    pub zone: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct IntervalsRecord {
    #[serde(default)]
    pub icu_intervals: Vec<IntervalRecord>,
}

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
}

// ===========================================================================
// Athlete + sport settings
// ===========================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AthleteRecord {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub sex: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SportSettingsRecord {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default, deserialize_with = "null_as_empty_vec")]
    pub types: Vec<String>,
    #[serde(default)]
    pub ftp: Option<f64>,
    #[serde(default)]
    pub indoor_ftp: Option<f64>,
    #[serde(default)]
    pub lthr: Option<f64>,
    #[serde(default)]
    pub max_hr: Option<f64>,
    #[serde(default)]
    pub threshold_pace: Option<f64>,
    #[serde(default, deserialize_with = "null_as_empty_vec")]
    pub hr_zones: Vec<f64>,
    #[serde(default, deserialize_with = "null_as_empty_vec")]
    pub power_zones: Vec<f64>,
    #[serde(default, deserialize_with = "null_as_empty_vec")]
    pub pace_zones: Vec<f64>,
}

// ===========================================================================
// Power / pace curves
// ===========================================================================

#[derive(Debug, Clone, Deserialize)]
struct CurveListDto<T> {
    list: Vec<T>,
}

#[derive(Debug, Clone, Deserialize)]
struct PowerCurveDto {
    #[serde(default)]
    secs: Vec<i64>,
    #[serde(default)]
    values: Vec<f64>,
    #[serde(default)]
    activity_id: Option<Vec<String>>,
}

/// Best-power-by-duration curve. `watts` is renamed from the server's `values`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PowerCurve {
    pub secs: Vec<i64>,
    pub watts: Vec<f64>,
    pub activity_ids: Option<Vec<String>>,
}

/// Parse the `power-curves.json` body (takes `list[0]`, renames `values`).
pub fn parse_power_curve(body: &[u8]) -> Result<PowerCurve, serde_json::Error> {
    let dto: CurveListDto<PowerCurveDto> = serde_json::from_slice(body)?;
    Ok(match dto.list.into_iter().next() {
        Some(c) => PowerCurve {
            secs: c.secs,
            watts: c.values,
            activity_ids: c.activity_id,
        },
        None => PowerCurve::default(),
    })
}

#[derive(Debug, Clone, Deserialize)]
struct PaceModelDto {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    #[serde(rename = "criticalSpeed")]
    critical_speed: Option<f64>,
    #[serde(default, rename = "dPrime")]
    d_prime: Option<f64>,
    #[serde(default)]
    r2: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
struct PaceCurveDto {
    #[serde(default)]
    distance: Vec<f64>,
    #[serde(default)]
    values: Vec<f64>,
    #[serde(default)]
    activity_id: Option<Vec<String>>,
    #[serde(default)]
    #[serde(rename = "paceModels")]
    pace_models: Vec<PaceModelDto>,
    #[serde(default)]
    start_date_local: Option<String>,
    #[serde(default)]
    end_date_local: Option<String>,
    #[serde(default)]
    days: Option<i64>,
}

/// Best-pace-by-distance curve. `pace` (m/s) is computed as distance/time.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PaceCurve {
    pub distances: Vec<f64>,
    pub times: Vec<f64>,
    pub pace: Vec<f64>,
    pub activity_ids: Option<Vec<String>>,
    pub critical_speed: Option<f64>,
    pub d_prime: Option<f64>,
    pub r2: Option<f64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<i64>,
}

/// Parse the `pace-curves.json` body (takes `list[0]`, computes pace, extracts CS).
pub fn parse_pace_curve(body: &[u8]) -> Result<PaceCurve, serde_json::Error> {
    let dto: CurveListDto<PaceCurveDto> = serde_json::from_slice(body)?;
    Ok(match dto.list.into_iter().next() {
        Some(c) => {
            let pace = c
                .distance
                .iter()
                .zip(c.values.iter())
                .map(|(d, t)| if *t > 0.0 { d / t } else { 0.0 })
                .collect();
            let cs = c.pace_models.iter().find(|m| m.kind == "CS");
            PaceCurve {
                distances: c.distance,
                times: c.values,
                pace,
                activity_ids: c.activity_id,
                critical_speed: cs.and_then(|m| m.critical_speed),
                d_prime: cs.and_then(|m| m.d_prime),
                r2: cs.and_then(|m| m.r2),
                start_date: c.start_date_local,
                end_date: c.end_date_local,
                days: c.days,
            }
        }
        None => PaceCurve::default(),
    })
}

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
    fn parses_sport_settings_int_zones() {
        let ss: Vec<SportSettingsRecord> = serde_json::from_value(json!([
            {"id": 1473689, "types": ["Ride", "VirtualRide"], "ftp": 155, "lthr": 174,
             "max_hr": 201, "hr_zones": [120, 140, 160, 175, 185, 195, 205],
             "power_zones": [55, 75, 90, 105, 120, 150, 200], "pace_zones": null}
        ]))
        .unwrap();
        assert_eq!(ss[0].id, Some(1473689));
        assert_eq!(ss[0].types, vec!["Ride", "VirtualRide"]);
        assert_eq!(ss[0].ftp, Some(155.0));
        assert_eq!(ss[0].hr_zones.len(), 7);
        assert!(ss[0].pace_zones.is_empty()); // null -> default empty
    }

    #[test]
    fn power_curve_renames_values_to_watts() {
        let body = json!({
            "list": [{"secs": [1, 5, 60], "values": [800, 700, 400], "activity_id": ["x", "y", "z"]}],
            "activities": {}
        })
        .to_string();
        let pc = parse_power_curve(body.as_bytes()).unwrap();
        assert_eq!(pc.secs, vec![1, 5, 60]);
        assert_eq!(pc.watts, vec![800.0, 700.0, 400.0]);
        assert_eq!(pc.activity_ids.as_ref().unwrap()[1], "y");
    }

    #[test]
    fn pace_curve_computes_pace_and_extracts_cs() {
        let body = json!({
            "list": [{
                "distance": [400.0, 1000.0, 0.0],
                "values": [80.0, 220.0, 0.0],
                "activity_id": ["a", "b", "c"],
                "paceModels": [{"type": "CS", "criticalSpeed": 2.85, "dPrime": 250.6, "r2": 0.999}],
                "start_date_local": "2026-05-01", "end_date_local": "2026-06-26", "days": 56
            }]
        })
        .to_string();
        let pc = parse_pace_curve(body.as_bytes()).unwrap();
        assert_eq!(pc.distances, vec![400.0, 1000.0, 0.0]);
        assert_eq!(pc.pace[0], 400.0 / 80.0); // 5 m/s
        assert_eq!(pc.pace[2], 0.0); // div-by-zero guard
        assert_eq!(pc.critical_speed, Some(2.85));
        assert_eq!(pc.d_prime, Some(250.6));
        assert_eq!(pc.days, Some(56));
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
    fn parses_intervals_envelope() {
        // The intervals endpoint wraps the laps in `{analyzed, icu_groups,
        // icu_intervals, id}`; each lap has a large key set with `type`/`zone`.
        let body = json!({
            "analyzed": true, "id": "i159922890", "icu_groups": [],
            "icu_intervals": [{
                "id": 5386051, "type": "RECOVERY", "label": null,
                "start_index": 0, "end_index": 16, "distance": 120.0,
                "moving_time": 17, "elapsed_time": 17, "average_watts": 90.0,
                "average_heartrate": 110.0, "average_cadence": 70.0, "zone": 6,
                "average_speed": 7.0, "decoupling": 1.2, "group_id": null,
                "segment_effort_ids": [], "wbal_start": 20000, "wbal_end": 19500
            }]
        });
        let rec: IntervalsRecord = serde_json::from_value(body).unwrap();
        assert_eq!(rec.icu_intervals.len(), 1);
        let iv = &rec.icu_intervals[0];
        assert_eq!(iv.id, Some(5386051));
        assert_eq!(iv.interval_type.as_deref(), Some("RECOVERY"));
        assert_eq!(iv.label, None);
        assert_eq!(iv.start_index, Some(0));
        assert_eq!(iv.end_index, Some(16));
        assert_eq!(iv.zone, Some(6));
    }

    #[test]
    fn power_curve_reads_values_not_server_watts() {
        // list[0] carries both `values` and a separate `watts` field plus many
        // extras (ranks, powerModels, watts_per_kg). The TS client renames
        // `values` -> watts, so the parse must read `values`, never the server's
        // `watts` array. Distinct arrays prove which one is used.
        let body = json!({
            "list": [{
                "secs": [1, 2, 3], "values": [508, 487, 487],
                "watts": [999, 999, 999], "watts_per_kg": [7.1, 6.8, 6.8],
                "activity_id": ["i1", "i1", "i2"], "ranks": [1, 2, 3],
                "powerModels": [], "id": "x", "label": "1 year", "weight": 70
            }],
            "activities": {}
        })
        .to_string();
        let pc = parse_power_curve(body.as_bytes()).unwrap();
        assert_eq!(pc.secs, vec![1, 2, 3]);
        assert_eq!(pc.watts, vec![508.0, 487.0, 487.0]); // from `values`, not `watts`
        assert_eq!(pc.activity_ids.as_ref().unwrap()[2], "i2");
    }

    #[test]
    fn pace_curve_ignores_extras_and_input_indexes() {
        // The CS pace model carries an `inputPointIndexes` array alongside the
        // scalars; the list entry carries label/id/training_load extras. Both
        // must be ignored while pace = distance/time and the CS scalars extract.
        let body = json!({
            "list": [{
                "distance": [100.0, 200.0, 0.0], "values": [20.0, 50.0, 0.0],
                "activity_id": ["a", "b", "c"], "type": "Run",
                "paceModels": [{"type": "CS", "criticalSpeed": 2.85,
                    "dPrime": 250.6, "r2": 0.999, "inputPointIndexes": [41, 62, 67]}],
                "start_date_local": "2026-05-01", "end_date_local": "2026-06-26",
                "days": 56, "id": "x", "label": "56 days", "training_load": 40,
                "weight": 68, "moving_time": [10, 20, 30]
            }],
            "activities": {}
        })
        .to_string();
        let pc = parse_pace_curve(body.as_bytes()).unwrap();
        assert_eq!(pc.pace[0], 100.0 / 20.0); // 5 m/s
        assert_eq!(pc.pace[1], 200.0 / 50.0); // 4 m/s
        assert_eq!(pc.pace[2], 0.0); // div-by-zero guard
        assert_eq!(pc.critical_speed, Some(2.85));
        assert_eq!(pc.d_prime, Some(250.6));
        assert_eq!(pc.r2, Some(0.999));
        assert_eq!(pc.days, Some(56));
    }

    #[test]
    fn parses_sport_settings_all_zones_null() {
        // A sport with no configured zones sends every zone array as JSON null
        // (seen on Swim/Other in the live response). null_as_empty_vec turns each
        // into an empty Vec rather than failing the deserialise.
        let ss: Vec<SportSettingsRecord> = serde_json::from_value(json!([{
            "id": 1473692, "types": ["Swim"], "ftp": null, "indoor_ftp": null,
            "lthr": null, "max_hr": null, "threshold_pace": null,
            "hr_zones": null, "power_zones": null, "pace_zones": null
        }]))
        .unwrap();
        assert_eq!(ss[0].id, Some(1473692));
        assert_eq!(ss[0].types, vec!["Swim"]);
        assert_eq!(ss[0].ftp, None);
        assert!(ss[0].hr_zones.is_empty());
        assert!(ss[0].power_zones.is_empty());
        assert!(ss[0].pace_zones.is_empty());
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
