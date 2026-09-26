//! The stored curve bodies, parsed into the shapes the charts read.
//!
//! The body intervals.icu sends is stored whole, because a curve only means
//! anything alongside the sport, window and gap flag it was computed for. What
//! reads it is a chart, and TypeScript used to parse the JSON on every stats
//! mount and every sync completion, on the thread drawing the frame. The
//! parse belongs where the body already lives.
//!
//! The raw shapes below are the body as measured on a live account on
//! 2026-09-05, not the subset one chart happened to need, and every field is
//! optional because the server omits rather than nulls.

use std::collections::HashMap;

use serde::Deserialize;

/// A model the server finished fitting.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPowerModel {
    /// `MS_2P`, `MORTON_3P`, `FFT_CURVES` or `ECP`.
    pub kind: String,
    pub critical_power: f64,
    /// W prime, joules above critical power.
    pub w_prime: f64,
    pub ftp: f64,
    /// The three-parameter models' peak, absent on the two-parameter fit.
    pub p_max: Option<f64>,
}

/// An activity a curve point came from, as the body names it.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiCurveActivity {
    pub id: String,
    pub name: String,
    pub distance: f64,
    pub moving_time: f64,
    pub training_load: f64,
    pub weight: f64,
    pub start_date_local: String,
    pub race: bool,
}

/// A power curve for one sport and window, and when its body was fetched.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPowerCurve {
    pub sport: String,
    /// Durations, in seconds.
    pub secs: Vec<f64>,
    /// The best watts held for each duration.
    pub watts: Vec<f64>,
    pub watts_per_kg: Option<Vec<f64>>,
    pub activity_ids: Option<Vec<String>>,
    /// Activity ids for each per-kilogram best, which need not be the watts one.
    pub wkg_activity_ids: Option<Vec<String>>,
    /// The athlete's weight the per-kilogram series was divided by.
    pub weight: Option<f64>,
    /// The server's fitted models, in the order it sent them.
    pub models: Vec<FfiPowerModel>,
    /// Every activity a point came from, so a checkpoint has a date offline.
    pub activities: HashMap<String, FfiCurveActivity>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<f64>,
    /// Epoch seconds at the fetch that stored the body.
    pub fetched_at: f64,
}

/// A pace curve for one sport and window, and when its body was fetched.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPaceCurve {
    pub sport: String,
    /// Distances, in metres.
    pub distances: Vec<f64>,
    /// Seconds taken to cover each distance.
    pub times: Vec<f64>,
    /// Metres per second at each distance, zero where the time is.
    pub pace: Vec<f64>,
    pub activity_ids: Option<Vec<String>>,
    pub activities: HashMap<String, FfiCurveActivity>,
    /// The critical-speed model's terms, when the server fitted one.
    pub critical_speed: Option<f64>,
    pub d_prime: Option<f64>,
    pub r2: Option<f64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<f64>,
    /// Epoch seconds at the fetch that stored the body.
    pub fetched_at: f64,
}

#[derive(Debug, Deserialize)]
struct RawCurveActivity {
    id: Option<String>,
    name: Option<String>,
    distance: Option<f64>,
    moving_time: Option<f64>,
    training_load: Option<f64>,
    icu_weight: Option<f64>,
    start_date_local: Option<String>,
    race: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RawPowerModel {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(rename = "criticalPower")]
    critical_power: Option<f64>,
    #[serde(rename = "wPrime")]
    w_prime: Option<f64>,
    ftp: Option<f64>,
    #[serde(rename = "pMax")]
    p_max: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct RawPaceModel {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(rename = "criticalSpeed")]
    critical_speed: Option<f64>,
    #[serde(rename = "dPrime")]
    d_prime: Option<f64>,
    r2: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct RawPowerWindow {
    start_date_local: Option<String>,
    end_date_local: Option<String>,
    days: Option<i64>,
    weight: Option<f64>,
    activity_id: Option<Vec<String>>,
    secs: Option<Vec<f64>>,
    values: Option<Vec<f64>>,
    watts_per_kg: Option<Vec<f64>>,
    wkg_activity_id: Option<Vec<String>>,
    #[serde(rename = "powerModels")]
    power_models: Option<Vec<RawPowerModel>>,
}

#[derive(Debug, Deserialize)]
struct RawPaceWindow {
    start_date_local: Option<String>,
    end_date_local: Option<String>,
    days: Option<i64>,
    activity_id: Option<Vec<String>>,
    distance: Option<Vec<f64>>,
    values: Option<Vec<f64>>,
    #[serde(rename = "paceModels")]
    pace_models: Option<Vec<RawPaceModel>>,
}

#[derive(Debug, Deserialize)]
struct RawPowerCurve {
    list: Option<Vec<RawPowerWindow>>,
    activities: Option<HashMap<String, RawCurveActivity>>,
}

#[derive(Debug, Deserialize)]
struct RawPaceCurve {
    list: Option<Vec<RawPaceWindow>>,
    activities: Option<HashMap<String, RawCurveActivity>>,
}

fn activities_of(
    raw: Option<HashMap<String, RawCurveActivity>>,
) -> HashMap<String, FfiCurveActivity> {
    raw.unwrap_or_default()
        .into_iter()
        .map(|(id, a)| {
            let activity = FfiCurveActivity {
                id: a.id.unwrap_or_else(|| id.clone()),
                name: a.name.unwrap_or_default(),
                distance: a.distance.unwrap_or(0.0),
                moving_time: a.moving_time.unwrap_or(0.0),
                training_load: a.training_load.unwrap_or(0.0),
                weight: a.icu_weight.unwrap_or(0.0),
                start_date_local: a.start_date_local.unwrap_or_default(),
                race: a.race.unwrap_or(false),
            };
            (id, activity)
        })
        .collect()
}

/// A model without every term of the fit is dropped: the charts draw all four
/// or none, so a half-fitted one would be an overlay nobody can read.
fn models_of(raw: Option<Vec<RawPowerModel>>) -> Vec<FfiPowerModel> {
    raw.unwrap_or_default()
        .into_iter()
        .filter_map(|m| {
            Some(FfiPowerModel {
                kind: m.kind?,
                critical_power: m.critical_power?,
                w_prime: m.w_prime?,
                ftp: m.ftp?,
                p_max: m.p_max,
            })
        })
        .collect()
}

/// Parse a stored power-curve body. `None` is a body that is not one.
pub fn parse_power_curve(body: &str, sport: &str, fetched_at: i64) -> Option<FfiPowerCurve> {
    let parsed: RawPowerCurve = serde_json::from_str(body).ok()?;
    let window = parsed.list.unwrap_or_default().into_iter().next();
    let (
        secs,
        watts,
        watts_per_kg,
        activity_ids,
        wkg_activity_ids,
        weight,
        models,
        start,
        end,
        days,
    ) = match window {
        Some(w) => (
            w.secs.unwrap_or_default(),
            w.values.unwrap_or_default(),
            w.watts_per_kg,
            w.activity_id,
            w.wkg_activity_id,
            w.weight,
            models_of(w.power_models),
            w.start_date_local,
            w.end_date_local,
            w.days,
        ),
        None => (
            Vec::new(),
            Vec::new(),
            None,
            None,
            None,
            None,
            Vec::new(),
            None,
            None,
            None,
        ),
    };

    Some(FfiPowerCurve {
        sport: sport.to_string(),
        secs,
        watts,
        watts_per_kg,
        activity_ids,
        wkg_activity_ids,
        weight,
        models,
        activities: activities_of(parsed.activities),
        start_date: start,
        end_date: end,
        days: days.map(|v| v as f64),
        fetched_at: fetched_at as f64,
    })
}

/// Parse a stored pace-curve body. `None` is a body that is not one.
pub fn parse_pace_curve(body: &str, sport: &str, fetched_at: i64) -> Option<FfiPaceCurve> {
    let parsed: RawPaceCurve = serde_json::from_str(body).ok()?;
    let window = parsed.list.unwrap_or_default().into_iter().next();
    let (distances, times, activity_ids, models, start, end, days) = match window {
        Some(w) => (
            w.distance.unwrap_or_default(),
            w.values.unwrap_or_default(),
            w.activity_id,
            w.pace_models.unwrap_or_default(),
            w.start_date_local,
            w.end_date_local,
            w.days,
        ),
        None => (Vec::new(), Vec::new(), None, Vec::new(), None, None, None),
    };

    // Metres per second, and nought where the time is: a divide by zero would
    // draw an infinite pace rather than a gap.
    let pace = distances
        .iter()
        .enumerate()
        .map(|(i, dist)| match times.get(i) {
            Some(t) if *t > 0.0 => dist / t,
            _ => 0.0,
        })
        .collect();

    let cs = models.into_iter().find(|m| m.kind.as_deref() == Some("CS"));

    Some(FfiPaceCurve {
        sport: sport.to_string(),
        distances,
        times,
        pace,
        activity_ids,
        activities: activities_of(parsed.activities),
        critical_speed: cs.as_ref().and_then(|m| m.critical_speed),
        d_prime: cs.as_ref().and_then(|m| m.d_prime),
        r2: cs.as_ref().and_then(|m| m.r2),
        start_date: start,
        end_date: end,
        days: days.map(|v| v as f64),
        fetched_at: fetched_at as f64,
    })
}

#[cfg(test)]
mod tests {
    //! The bodies here are cut down from what intervals.icu sent on
    //! 2026-09-05, keeping the shape and dropping the length.

    use super::*;

    const POWER: &str = r#"{
        "list": [{
            "start_date_local": "2025-09-05T00:00:00",
            "end_date_local": "2026-09-05T00:00:00",
            "days": 365,
            "weight": 72.5,
            "secs": [1, 5, 60],
            "values": [900, 780, 410],
            "watts_per_kg": [12.4, 10.8, 5.7],
            "activity_id": ["i1", "i1", "i2"],
            "wkg_activity_id": ["i1", "i3", "i2"],
            "powerModels": [
                {"type": "MS_2P", "criticalPower": 280, "wPrime": 21000, "ftp": 265},
                {"type": "MORTON_3P", "criticalPower": 275, "wPrime": 22000, "ftp": 262, "pMax": 1100},
                {"type": "HALF_FITTED", "criticalPower": 275}
            ]
        }],
        "activities": {
            "i1": {"name": "Hill repeats", "distance": 42000, "moving_time": 5400,
                   "training_load": 120, "icu_weight": 72.5,
                   "start_date_local": "2026-08-01T07:00:00", "race": false}
        }
    }"#;

    const PACE: &str = r#"{
        "list": [{
            "days": 90,
            "distance": [400, 1000, 5000],
            "values": [70, 200, 0],
            "activity_id": ["r1", "r2", "r3"],
            "paceModels": [
                {"type": "OTHER", "criticalSpeed": 9.9},
                {"type": "CS", "criticalSpeed": 4.2, "dPrime": 180, "r2": 0.97}
            ]
        }],
        "activities": {"r1": {"id": "r1", "name": "Intervals", "race": true}}
    }"#;

    #[test]
    fn a_power_body_carries_its_series_models_and_activities() {
        let curve = parse_power_curve(POWER, "Ride", 1_757_000_000).expect("parses");

        assert_eq!(curve.sport, "Ride");
        assert_eq!(curve.secs, vec![1.0, 5.0, 60.0]);
        assert_eq!(curve.watts, vec![900.0, 780.0, 410.0]);
        assert_eq!(curve.watts_per_kg.as_deref(), Some(&[12.4, 10.8, 5.7][..]));
        assert_eq!(curve.wkg_activity_ids.as_deref().map(|v| v.len()), Some(3));
        assert_eq!(curve.weight, Some(72.5));
        assert_eq!(curve.days, Some(365.0));
        assert_eq!(curve.fetched_at, 1_757_000_000.0);
        assert_eq!(
            curve.activities.get("i1").map(|a| a.name.as_str()),
            Some("Hill repeats")
        );
    }

    /// A model the server has not finished fitting draws nothing, so it is not
    /// carried as one with its terms defaulted to nought.
    #[test]
    fn a_half_fitted_power_model_is_dropped() {
        let curve = parse_power_curve(POWER, "Ride", 0).expect("parses");

        let kinds: Vec<&str> = curve.models.iter().map(|m| m.kind.as_str()).collect();
        assert_eq!(kinds, vec!["MS_2P", "MORTON_3P"]);
        assert_eq!(curve.models[0].p_max, None);
        assert_eq!(curve.models[1].p_max, Some(1100.0));
    }

    /// The map is keyed by what the body keys it by, and an entry that names
    /// no id of its own takes the key's.
    #[test]
    fn an_activity_without_its_own_id_takes_the_key() {
        let curve = parse_power_curve(POWER, "Ride", 0).expect("parses");

        assert_eq!(curve.activities["i1"].id, "i1");
    }

    #[test]
    fn a_pace_body_carries_the_critical_speed_model_and_nothing_else() {
        let curve = parse_pace_curve(PACE, "Run", 42).expect("parses");

        assert_eq!(curve.distances, vec![400.0, 1000.0, 5000.0]);
        assert_eq!(curve.times, vec![70.0, 200.0, 0.0]);
        assert_eq!(curve.critical_speed, Some(4.2));
        assert_eq!(curve.d_prime, Some(180.0));
        assert_eq!(curve.r2, Some(0.97));
        assert_eq!(curve.fetched_at, 42.0);
    }

    /// A distance with no time is a gap in the curve. Dividing by it would
    /// draw an infinite pace.
    #[test]
    fn a_pace_point_with_no_time_is_nought_and_not_infinity() {
        let curve = parse_pace_curve(PACE, "Run", 0).expect("parses");

        assert_eq!(curve.pace[0], 400.0 / 70.0);
        assert_eq!(curve.pace[2], 0.0);
        assert!(curve.pace.iter().all(|p| p.is_finite()));
    }

    #[test]
    fn a_body_that_is_not_a_curve_is_not_one() {
        assert!(parse_power_curve("not json", "Ride", 0).is_none());
        assert!(parse_pace_curve("not json", "Run", 0).is_none());
    }

    /// An empty body is a curve with no points rather than nothing: the chart
    /// draws the empty state under a date, and `None` means "never fetched".
    #[test]
    fn a_body_with_no_windows_is_an_empty_curve() {
        let power = parse_power_curve("{}", "Ride", 7).expect("parses");
        let pace = parse_pace_curve("{}", "Run", 7).expect("parses");

        assert!(power.secs.is_empty() && power.models.is_empty());
        assert!(pace.distances.is_empty() && pace.pace.is_empty());
        assert_eq!((power.fetched_at, pace.fetched_at), (7.0, 7.0));
    }
}
