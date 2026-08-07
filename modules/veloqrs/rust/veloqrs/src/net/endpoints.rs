//! One async fetcher per intervals.icu endpoint: build request → transport →
//! serde parse → convert. These replace the axios methods in `src/api/intervals.ts`.
//! Credentials live on the `Transport`; callers pass only ids and params.

use crate::governor::Lane;
use crate::net::transport::{NetError, Transport};
use crate::net::types::*;

/// Streams requested for the detail charts (GPS + the per-metric series).
pub const DEFAULT_STREAM_TYPES: &str = "time,distance,latlng,velocity_smooth,heartrate,watts,altitude,fixed_altitude,cadence,grade_smooth,temp,w_bal,ga_velocity";

/// `GET /athlete/{id}` - full athlete profile.
pub async fn fetch_athlete(
    t: &Transport,
    athlete_id: &str,
    lane: Lane,
) -> Result<AthleteRecord, NetError> {
    t.get_json(&format!("/athlete/{}", athlete_id), &[], lane)
        .await
}

/// `GET /athlete/{id}` as the untyped body. `AthleteRecord` models three
/// fields; the profile screens read unit preferences beyond them, so the body
/// is what gets persisted.
pub async fn fetch_athlete_body(
    t: &Transport,
    athlete_id: &str,
    lane: Lane,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(&format!("/athlete/{}", athlete_id), &[], lane)
        .await?;
    decode_body(bytes)
}

/// `GET /athlete/{id}/sport-settings` as the untyped body, for the same reason
/// as `fetch_athlete_body`.
pub async fn fetch_sport_settings_body(
    t: &Transport,
    athlete_id: &str,
    lane: Lane,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/sport-settings", athlete_id),
            &[],
            lane,
        )
        .await?;
    decode_body(bytes)
}

/// `GET /athlete/{id}/wellness` returning each day both typed and as its own
/// body, from a single request. Rust computes on the typed values; the UI
/// reads fields the record does not model.
pub async fn fetch_wellness_with_bodies(
    t: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    lane: Lane,
) -> Result<Vec<(WellnessRecord, String)>, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/wellness", athlete_id),
            &[("oldest", oldest), ("newest", newest)],
            lane,
        )
        .await?;
    let days: Vec<serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|e| NetError::Decode(e.to_string()))?;

    let mut out = Vec::with_capacity(days.len());
    for day in days {
        let body = day.to_string();
        let record: WellnessRecord =
            serde_json::from_value(day).map_err(|e| NetError::Decode(e.to_string()))?;
        out.push((record, body));
    }
    Ok(out)
}

/// Response bytes as UTF-8. intervals.icu always answers JSON, so a body that
/// is not valid UTF-8 is a decode failure rather than something to store.
fn decode_body(bytes: Vec<u8>) -> Result<String, NetError> {
    String::from_utf8(bytes).map_err(|e| NetError::Decode(e.to_string()))
}

/// `GET /athlete/me` - discover the current athlete from the credential alone.
pub async fn fetch_current_athlete(t: &Transport, lane: Lane) -> Result<AthleteRecord, NetError> {
    t.get_json("/athlete/me", &[], lane).await
}

/// `GET /athlete/{id}/activities` with the app's field selection.
pub async fn fetch_activities(
    t: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    include_stats: bool,
    lane: Lane,
) -> Result<Vec<ActivityRecord>, NetError> {
    let fields = if include_stats {
        format!("{},{}", ACTIVITY_FIELDS, ACTIVITY_STATS_EXTRA)
    } else {
        ACTIVITY_FIELDS.to_string()
    };
    t.get_json(
        &format!("/athlete/{}/activities", athlete_id),
        &[("oldest", oldest), ("newest", newest), ("fields", &fields)],
        lane,
    )
    .await
}

/// `GET /athlete/{id}/activities` returning each activity both typed and as
/// its own body. Rust aggregates on the typed values; the feed and detail
/// screens read fields the record does not model.
pub async fn fetch_activities_with_bodies(
    t: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    include_stats: bool,
    lane: Lane,
) -> Result<Vec<(ActivityRecord, String)>, NetError> {
    let fields = if include_stats {
        format!("{},{}", ACTIVITY_FIELDS, ACTIVITY_STATS_EXTRA)
    } else {
        ACTIVITY_FIELDS.to_string()
    };
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/activities", athlete_id),
            &[("oldest", oldest), ("newest", newest), ("fields", &fields)],
            lane,
        )
        .await?;
    let items: Vec<serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|e| NetError::Decode(e.to_string()))?;

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let body = item.to_string();
        let record: ActivityRecord =
            serde_json::from_value(item).map_err(|e| NetError::Decode(e.to_string()))?;
        out.push((record, body));
    }
    Ok(out)
}

/// `GET /activity/{id}` - full activity detail.
pub async fn fetch_activity(
    t: &Transport,
    activity_id: &str,
    lane: Lane,
) -> Result<ActivityRecord, NetError> {
    t.get_json(&format!("/activity/{}", activity_id), &[], lane)
        .await
}

/// Oldest activity date across the whole history (cheap two-field pull + reduce).
pub async fn fetch_oldest_activity_date(
    t: &Transport,
    athlete_id: &str,
    today: &str,
    lane: Lane,
) -> Result<Option<String>, NetError> {
    let acts: Vec<ActivityRecord> = t
        .get_json(
            &format!("/athlete/{}/activities", athlete_id),
            &[
                ("oldest", "2000-01-01"),
                ("newest", today),
                ("fields", "id,start_date_local"),
            ],
            lane,
        )
        .await?;
    Ok(oldest_activity_date(&acts))
}

/// `GET /activity/{id}/streams.json` → parsed streams (parseStreams parity).
pub async fn fetch_streams(
    t: &Transport,
    activity_id: &str,
    types: Option<&str>,
    lane: Lane,
) -> Result<ParsedStreams, NetError> {
    let raw: Vec<StreamDto> = t
        .get_json(
            &format!("/activity/{}/streams.json", activity_id),
            &[("types", types.unwrap_or(DEFAULT_STREAM_TYPES))],
            lane,
        )
        .await?;
    Ok(parse_streams(raw))
}

/// `GET /activity/{id}/streams.json` as the untyped body. TypeScript's
/// `parseStreams` stays the single transform, so what the charts render is
/// byte-for-byte what it rendered before the read moved.
pub async fn fetch_streams_body(
    t: &Transport,
    activity_id: &str,
    types: &str,
    lane: Lane,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/activity/{}/streams.json", activity_id),
            &[("types", types)],
            lane,
        )
        .await?;
    decode_body(bytes)
}

/// `GET /activity/{id}` as the untyped body. The detail screen reads far more
/// than `ActivityRecord` models.
pub async fn fetch_activity_body(
    t: &Transport,
    activity_id: &str,
    lane: Lane,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(&format!("/activity/{}", activity_id), &[], lane)
        .await?;
    decode_body(bytes)
}

/// An activity's `time` stream as whole seconds, for the section-performance
/// lap maths. Non-finite and negative samples are dropped rather than cast.
pub async fn fetch_time_stream(
    t: &Transport,
    activity_id: &str,
    lane: Lane,
) -> Result<Vec<u32>, NetError> {
    let parsed = fetch_streams(t, activity_id, Some("time"), lane).await?;
    Ok(parsed
        .time
        .into_iter()
        .filter(|v| *v >= 0)
        .map(|v| v as u32)
        .collect())
}

/// `GET /activity/{id}/intervals` - work/recovery intervals.
pub async fn fetch_intervals(
    t: &Transport,
    activity_id: &str,
    lane: Lane,
) -> Result<IntervalsRecord, NetError> {
    t.get_json(&format!("/activity/{}/intervals", activity_id), &[], lane)
        .await
}

/// `GET /athlete/{id}/wellness` over a date window.
pub async fn fetch_wellness(
    t: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    lane: Lane,
) -> Result<Vec<WellnessRecord>, NetError> {
    t.get_json(
        &format!("/athlete/{}/wellness", athlete_id),
        &[("oldest", oldest), ("newest", newest)],
        lane,
    )
    .await
}

/// `GET /athlete/{id}/sport-settings`.
pub async fn fetch_sport_settings(
    t: &Transport,
    athlete_id: &str,
    lane: Lane,
) -> Result<Vec<SportSettingsRecord>, NetError> {
    t.get_json(
        &format!("/athlete/{}/sport-settings", athlete_id),
        &[],
        lane,
    )
    .await
}

/// `GET /athlete/{id}/power-curves.json` → curve with `values` renamed to watts.
pub async fn fetch_power_curve(
    t: &Transport,
    athlete_id: &str,
    sport: &str,
    curves: &str,
    lane: Lane,
) -> Result<PowerCurve, NetError> {
    let body = t
        .get_bytes(
            &format!("/athlete/{}/power-curves.json", athlete_id),
            &[("type", sport), ("curves", curves)],
            lane,
        )
        .await?;
    parse_power_curve(&body).map_err(|e| NetError::Decode(e.to_string()))
}

/// `GET /athlete/{id}/pace-curves.json` → curve with pace computed as distance/time.
///
/// `gap` asks for gradient-adjusted pace. intervals.icu only offers it for
/// running, so it is dropped for any other sport rather than sent and ignored.
pub async fn fetch_pace_curve(
    t: &Transport,
    athlete_id: &str,
    sport: &str,
    curves: &str,
    gap: bool,
    lane: Lane,
) -> Result<PaceCurve, NetError> {
    let mut query: Vec<(&str, &str)> = vec![("type", sport), ("curves", curves)];
    if gap && sport == "Run" {
        query.push(("gap", "true"));
    }
    let body = t
        .get_bytes(
            &format!("/athlete/{}/pace-curves.json", athlete_id),
            &query,
            lane,
        )
        .await?;
    parse_pace_curve(&body).map_err(|e| NetError::Decode(e.to_string()))
}

/// `GET /athlete/{id}/events` - calendar events (planned workouts, notes,
/// targets) over a date window, as untyped bodies. `resolve=true` expands the
/// workout document the planner screens render.
pub async fn fetch_calendar_events_bodies(
    t: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    lane: Lane,
) -> Result<Vec<(String, String, String)>, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/events", athlete_id),
            &[("oldest", oldest), ("newest", newest), ("resolve", "true")],
            lane,
        )
        .await?;
    let items: Vec<serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|e| NetError::Decode(e.to_string()))?;

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        // An event with no id cannot be keyed, and one with no date cannot be
        // windowed. Either way it would be unreachable, so skip it.
        let Some(id) = item.get("id").map(value_to_id) else {
            continue;
        };
        let Some(start) = item
            .get("start_date_local")
            .and_then(|v| v.as_str())
            .map(str::to_string)
        else {
            continue;
        };
        out.push((id, start, item.to_string()));
    }
    Ok(out)
}

/// intervals.icu sends event ids as numbers; the store keys them as text.
fn value_to_id(v: &serde_json::Value) -> String {
    v.as_str()
        .map(str::to_string)
        .unwrap_or_else(|| v.to_string())
}

/// `GET /athlete/{id}/power-curves.json` as the untyped body.
pub async fn fetch_power_curve_body(
    t: &Transport,
    athlete_id: &str,
    sport: &str,
    curves: &str,
    lane: Lane,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/power-curves.json", athlete_id),
            &[("type", sport), ("curves", curves)],
            lane,
        )
        .await?;
    decode_body(bytes)
}

/// `GET /athlete/{id}/pace-curves.json` as the untyped body, with the same
/// running-only `gap` rule as `fetch_pace_curve`.
pub async fn fetch_pace_curve_body(
    t: &Transport,
    athlete_id: &str,
    sport: &str,
    curves: &str,
    gap: bool,
    lane: Lane,
) -> Result<String, NetError> {
    let mut query: Vec<(&str, &str)> = vec![("type", sport), ("curves", curves)];
    if gap && sport == "Run" {
        query.push(("gap", "true"));
    }
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/pace-curves.json", athlete_id),
            &query,
            lane,
        )
        .await?;
    decode_body(bytes)
}

/// `GET /activity/{id}/intervals` as the untyped body.
pub async fn fetch_intervals_body(
    t: &Transport,
    activity_id: &str,
    lane: Lane,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(&format!("/activity/{}/intervals", activity_id), &[], lane)
        .await?;
    decode_body(bytes)
}

/// `GET /activity/{id}/file` - raw FIT bytes (for strength exercise-set parsing).
pub async fn fetch_fit_file(
    t: &Transport,
    activity_id: &str,
    lane: Lane,
) -> Result<Vec<u8>, NetError> {
    t.get_bytes(&format!("/activity/{}/file", activity_id), &[], lane)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::{AuthMethod, Governor, NoopPolicy};
    use httpmock::prelude::*;
    use serde_json::json;
    use std::sync::Arc;

    fn fast_transport(base: String) -> Transport {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).unwrap()
    }

    #[test]
    fn activities_sends_field_selection() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", "2026-01-01")
                .query_param_exists("fields");
            then.status(200)
                .json_body(json!([{"id": "a1", "type": "Ride", "distance": 1000.0}]));
        });
        let t = fast_transport(server.base_url());
        let acts = crate::runtime::block_on(fetch_activities(
            &t,
            "i1",
            "2026-01-01",
            "2026-06-26",
            false,
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].id, "a1");
    }

    #[test]
    fn activities_with_stats_appends_extra_fields() {
        let server = MockServer::start();
        // The fields value must contain a stats-only field when include_stats=true.
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param_exists("fields")
                .matches(|req| {
                    req.query_params
                        .as_ref()
                        .map(|q| {
                            q.iter()
                                .any(|(k, v)| k == "fields" && v.contains("icu_power_zones"))
                        })
                        .unwrap_or(false)
                });
            then.status(200).json_body(json!([]));
        });
        let t = fast_transport(server.base_url());
        let _ = crate::runtime::block_on(fetch_activities(
            &t,
            "i1",
            "2026-01-01",
            "2026-06-26",
            true,
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
    }

    #[test]
    fn streams_endpoint_parses_latlng() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/activity/77/streams.json");
            then.status(200).json_body(json!([
                {"type": "time", "data": [0, 1]},
                {"type": "latlng", "data": [42.5, 42.6], "data2": [1.1, 1.2]}
            ]));
        });
        let t = fast_transport(server.base_url());
        let s = crate::runtime::block_on(fetch_streams(&t, "77", None, Lane::Interactive)).unwrap();
        mock.assert();
        assert_eq!(s.latlng, vec![[42.5, 1.1], [42.6, 1.2]]);
    }

    #[test]
    fn oldest_date_reduces_over_list() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200).json_body(json!([
                {"id": "a", "start_date_local": "2026-06-20T00:00:00"},
                {"id": "b", "start_date_local": "2023-02-02T00:00:00"}
            ]));
        });
        let t = fast_transport(server.base_url());
        let d = crate::runtime::block_on(fetch_oldest_activity_date(
            &t,
            "i1",
            "2026-06-26",
            Lane::Backfill,
        ))
        .unwrap();
        assert_eq!(d.as_deref(), Some("2023-02-02T00:00:00"));
    }

    #[test]
    fn power_curve_endpoint_renames_values() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/power-curves.json")
                .query_param("type", "Ride");
            then.status(200).json_body(json!({
                "list": [{"secs": [1, 5], "values": [900, 800], "activity_id": ["x", "y"]}]
            }));
        });
        let t = fast_transport(server.base_url());
        let pc =
            crate::runtime::block_on(fetch_power_curve(&t, "i1", "Ride", "42d", Lane::Backfill))
                .unwrap();
        assert_eq!(pc.watts, vec![900.0, 800.0]);
    }

    #[test]
    fn pace_curve_endpoint_sends_params_and_computes_pace() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/pace-curves.json")
                .query_param("type", "Run")
                .query_param("curves", "42d");
            then.status(200).json_body(json!({
                "list": [{
                    "distance": [100.0, 0.0],
                    "values": [20.0, 0.0],
                    "paceModels": [{"type": "CS", "criticalSpeed": 2.85,
                        "dPrime": 250.6, "r2": 0.999}]
                }]
            }));
        });
        let t = fast_transport(server.base_url());
        let pc = crate::runtime::block_on(fetch_pace_curve(
            &t,
            "i1",
            "Run",
            "42d",
            false,
            Lane::Backfill,
        ))
        .unwrap();
        assert_eq!(pc.pace[0], 5.0); // 100 m / 20 s
        assert_eq!(pc.pace[1], 0.0); // div-by-zero guard
        assert_eq!(pc.critical_speed, Some(2.85));
    }

    #[test]
    fn pace_curve_sends_gap_only_for_running() {
        let server = MockServer::start();
        let with_gap = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/pace-curves.json")
                .query_param("type", "Run")
                .query_param("gap", "true");
            then.status(200).json_body(json!({"list": []}));
        });
        let t = fast_transport(server.base_url());
        crate::runtime::block_on(fetch_pace_curve(
            &t,
            "i1",
            "Run",
            "42d",
            true,
            Lane::Backfill,
        ))
        .unwrap();
        with_gap.assert();

        // intervals.icu only computes GAP for running, so asking for it on a
        // swim would be a parameter the server ignores.
        let server = MockServer::start();
        let without_gap = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/pace-curves.json")
                .query_param("type", "Swim")
                .matches(|req| {
                    req.query_params
                        .as_ref()
                        .map(|q| !q.iter().any(|(k, _)| k == "gap"))
                        .unwrap_or(true)
                });
            then.status(200).json_body(json!({"list": []}));
        });
        let t = fast_transport(server.base_url());
        crate::runtime::block_on(fetch_pace_curve(
            &t,
            "i1",
            "Swim",
            "42d",
            true,
            Lane::Backfill,
        ))
        .unwrap();
        without_gap.assert();
    }

    #[test]
    fn wellness_endpoint_sends_date_window() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/wellness")
                .query_param("oldest", "2026-05-01")
                .query_param("newest", "2026-06-26");
            then.status(200).json_body(json!([
                {"id": "2026-05-01", "ctl": 50.0, "restingHR": 48, "sleepSecs": 27000}
            ]));
        });
        let t = fast_transport(server.base_url());
        let w = crate::runtime::block_on(fetch_wellness(
            &t,
            "i1",
            "2026-05-01",
            "2026-06-26",
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].resting_hr, Some(48.0));
    }

    #[test]
    fn intervals_endpoint_parses_icu_intervals() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/activity/55/intervals");
            then.status(200).json_body(json!({
                "analyzed": true, "id": "55", "icu_groups": [],
                "icu_intervals": [
                    {"id": 1, "type": "WORK", "zone": 4, "label": null},
                    {"id": 2, "type": "RECOVERY", "zone": 1}
                ]
            }));
        });
        let t = fast_transport(server.base_url());
        let rec = crate::runtime::block_on(fetch_intervals(&t, "55", Lane::Interactive)).unwrap();
        mock.assert();
        assert_eq!(rec.icu_intervals.len(), 2);
        assert_eq!(rec.icu_intervals[0].interval_type.as_deref(), Some("WORK"));
        assert_eq!(rec.icu_intervals[1].zone, Some(1));
    }
}
