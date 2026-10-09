//! The power and pace curve windows and keys the sync sweeps.
//!
//! A sync that owes a key any window asks for every window of it in one
//! request, so the stats and fitness screens read their curves from storage
//! whatever range they open on, and every window of a key ends on one day.

use crate::persistence::bodies::CurveKind;

/// The windows read by the stats and fitness screens.
pub(crate) const CURVE_DAYS: &[i64] = &[7, 30, 42, 90, 180, 365, ALL_TIME_CURVE_DAYS];

/// The window value that stands for the whole history. It is the stored key
/// for the all-time curve and is sent upstream as `all`, not as a day count.
pub(crate) const ALL_TIME_CURVE_DAYS: i64 = 0;

/// The `curves` spec for a window: `all` for the whole history, `{days}d`
/// otherwise.
pub(crate) fn curve_window(days: i64) -> String {
    if days == ALL_TIME_CURVE_DAYS {
        "all".to_string()
    } else {
        format!("{days}d")
    }
}

/// The `curves` spec asking every window in [`CURVE_DAYS`] at once.
pub(crate) fn every_curve_window() -> String {
    CURVE_DAYS
        .iter()
        .map(|&days| curve_window(days))
        .collect::<Vec<_>>()
        .join(",")
}

/// What a single-window request returns for a window with no data. A
/// multi-window answer leaves that window out instead.
const EMPTY_WINDOW_BODY: &str = r#"{"list":[],"activities":{}}"#;

/// Split an answer to [`every_curve_window`] into one body per window, in
/// [`CURVE_DAYS`] order, each in the shape a single-window request returns.
///
/// Each entry of `list` names its window in `id`. The answer carries one
/// `activities` map for every window, so each body keeps the activities its
/// own points cite and those dated inside its own window, which is every
/// activity a single-window answer lists. A window with no entry is stored
/// as the empty answer. An entry naming no requested window means the body
/// cannot be filed, and nothing of it is.
pub(crate) fn split_curve_windows(body: &str) -> Result<Vec<(i64, String)>, String> {
    use serde_json::{Map, Value, json};

    let parsed: Value =
        serde_json::from_str(body).map_err(|e| format!("curve body is not json: {e}"))?;
    let entries = parsed
        .get("list")
        .and_then(Value::as_array)
        .ok_or("curve body has no window list")?;
    let activities = parsed.get("activities").and_then(Value::as_object);

    let mut by_window: Vec<(i64, Option<&Value>)> =
        CURVE_DAYS.iter().map(|&days| (days, None)).collect();
    for entry in entries {
        let id = entry.get("id").and_then(Value::as_str);
        let slot = by_window
            .iter_mut()
            .find(|(days, _)| Some(curve_window(*days).as_str()) == id)
            .ok_or_else(|| format!("curve entry names no requested window: {id:?}"))?;
        slot.1 = Some(entry);
    }

    let date_of = |value: Option<&Value>| value?.as_str()?.get(..10).map(str::to_string);
    Ok(by_window
        .into_iter()
        .map(|(days, entry)| {
            let Some(entry) = entry else {
                return (days, EMPTY_WINDOW_BODY.to_string());
            };
            let cited: Vec<&str> = ["activity_id", "wkg_activity_id"]
                .iter()
                .filter_map(|field| entry.get(*field)?.as_array())
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let start = date_of(entry.get("start_date_local"));
            let end = date_of(entry.get("end_date_local"));
            let within = |activity: &Value| match (
                &start,
                &end,
                date_of(activity.get("start_date_local")),
            ) {
                (Some(start), Some(end), Some(date)) => *start <= date && date <= *end,
                _ => false,
            };
            let kept: Map<String, Value> = activities
                .into_iter()
                .flatten()
                .filter(|(id, activity)| cited.contains(&id.as_str()) || within(activity))
                .map(|(id, activity)| (id.clone(), activity.clone()))
                .collect();
            let window = json!({"list": [entry], "activities": kept});
            (days, window.to_string())
        })
        .collect())
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct CurveKey {
    pub kind: CurveKind,
    pub sport: &'static str,
    pub gap: bool,
}

pub(crate) const CURVE_KEYS: &[CurveKey] = &[
    CurveKey {
        kind: CurveKind::Power,
        sport: "Ride",
        gap: false,
    },
    CurveKey {
        kind: CurveKind::Pace,
        sport: "Run",
        gap: false,
    },
    CurveKey {
        kind: CurveKind::Pace,
        sport: "Run",
        gap: true,
    },
    CurveKey {
        kind: CurveKind::Pace,
        sport: "Swim",
        gap: false,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_all_time_window_is_requested_as_all_and_the_rest_as_days() {
        assert_eq!(curve_window(ALL_TIME_CURVE_DAYS), "all");
        assert_eq!(curve_window(90), "90d");
        assert_eq!(curve_window(365), "365d");
    }
}
