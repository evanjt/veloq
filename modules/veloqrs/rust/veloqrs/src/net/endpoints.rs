//! One async fetcher per intervals.icu endpoint: build request → transport →
//! serde parse → convert. These replace the axios methods in `src/api/intervals.ts`.
//! Credentials live on the `Transport`; callers pass only ids and params.

use crate::governor::Lane;
use crate::net::transport::{NetError, Transport};
use crate::net::types::*;

/// Streams requested for the detail charts (GPS + the per-metric series).
pub const DEFAULT_STREAM_TYPES: &str =
    "time,distance,latlng,velocity_smooth,heartrate,watts,altitude,fixed_altitude,cadence,grade_smooth,temp,w_bal,ga_velocity";

/// `GET /athlete/{id}` — full athlete profile.
pub async fn fetch_athlete(
    t: &Transport,
    athlete_id: &str,
    lane: Lane,
) -> Result<AthleteRecord, NetError> {
    t.get_json(&format!("/athlete/{}", athlete_id), &[], lane).await
}

/// `GET /athlete/me` — discover the current athlete from the credential alone.
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

/// `GET /activity/{id}` — full activity detail.
pub async fn fetch_activity(
    t: &Transport,
    activity_id: &str,
    lane: Lane,
) -> Result<ActivityRecord, NetError> {
    t.get_json(&format!("/activity/{}", activity_id), &[], lane).await
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

/// `GET /activity/{id}/intervals` — work/recovery intervals.
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
    t.get_json(&format!("/athlete/{}/sport-settings", athlete_id), &[], lane)
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
pub async fn fetch_pace_curve(
    t: &Transport,
    athlete_id: &str,
    sport: &str,
    curves: &str,
    lane: Lane,
) -> Result<PaceCurve, NetError> {
    let body = t
        .get_bytes(
            &format!("/athlete/{}/pace-curves.json", athlete_id),
            &[("type", sport), ("curves", curves)],
            lane,
        )
        .await?;
    parse_pace_curve(&body).map_err(|e| NetError::Decode(e.to_string()))
}

/// `GET /activity/{id}/file` — raw FIT bytes (for strength exercise-set parsing).
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
            &t, "i1", "2026-01-01", "2026-06-26", false, Lane::Backfill,
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
                            q.iter().any(|(k, v)| k == "fields" && v.contains("icu_power_zones"))
                        })
                        .unwrap_or(false)
                });
            then.status(200).json_body(json!([]));
        });
        let t = fast_transport(server.base_url());
        let _ = crate::runtime::block_on(fetch_activities(
            &t, "i1", "2026-01-01", "2026-06-26", true, Lane::Backfill,
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
            &t, "i1", "2026-06-26", Lane::Backfill,
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
        let pc = crate::runtime::block_on(fetch_power_curve(
            &t, "i1", "Ride", "42d", Lane::Backfill,
        ))
        .unwrap();
        assert_eq!(pc.watts, vec![900.0, 800.0]);
    }
}
