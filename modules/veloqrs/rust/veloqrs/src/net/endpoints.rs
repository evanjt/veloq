//! One async fetcher per intervals.icu endpoint: build request → transport →
//! serde parse → convert. These replace the axios methods in `src/api/intervals.ts`.
//! Credentials live on the `Transport`; callers pass only ids and params.

use crate::governor::Lane;
use crate::net::transport::{FilePart, NetError, Transport};
use crate::net::types::*;
use std::time::Duration;

/// Streams requested for the detail charts (GPS + the per-metric series).
pub const DEFAULT_STREAM_TYPES: &str = "time,distance,latlng,velocity_smooth,heartrate,watts,altitude,fixed_altitude,cadence,grade_smooth,temp,w_bal,ga_velocity";

/// Series the bulk track ingest asks for: the coordinates, plus both altitude
/// forms so `parse_streams` can prefer the corrected one.
pub const TRACK_STREAM_TYPES: &str = "latlng,fixed_altitude,altitude";

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

/// `GET /activity/{id}/streams.json` → parsed streams, every series reduced to
/// the `latlng` index space. A ragged series is reduced to that space with its
/// gaps as NaN, never shifted, so it costs its own samples and not the
/// response. A `latlng` series that disagrees with itself is rejected: it
/// defines the index space, so nothing in the response can be trusted.
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
    let parsed = parse_streams(raw);
    if !parsed.misaligned.is_empty() {
        let detail = parsed
            .misaligned
            .iter()
            .map(|m| format!("{} has {} of {}", m.series, m.len, m.expected))
            .collect::<Vec<_>>()
            .join(", ");
        if parsed.misaligned.iter().any(|m| m.series == "latlng") {
            return Err(NetError::Decode(format!(
                "activity {} streams misaligned: {}",
                activity_id, detail
            )));
        }
        log::warn!(
            "[Streams] activity {} carries misaligned series: {}",
            activity_id,
            detail
        );
    }
    Ok(parsed)
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
/// lap maths. A section addresses this array with the indices it holds into the
/// stored track, so `latlng` is requested alongside `time` to put both in the
/// one index space. Without it a single dropped coordinate shifts every lap
/// time on the activity. A negative sample is clamped rather than dropped.
pub async fn fetch_time_stream(
    t: &Transport,
    activity_id: &str,
    lane: Lane,
) -> Result<Vec<u32>, NetError> {
    let parsed = fetch_streams(t, activity_id, Some("time,latlng"), lane).await?;
    Ok(parsed.time.into_iter().map(|v| v.max(0) as u32).collect())
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

/// The multipart field holding the activity file. Taken from the upload path
/// the app has been shipping, not from documentation.
const UPLOAD_FILE_FIELD: &str = "file";

/// What intervals.icu records as the source of an uploaded activity.
const DEVICE_NAME: &str = "Veloq";

/// Uploads get 60 seconds instead of the transport's 30. A large FIT on a slow
/// connection needs the headroom, and a timeout here costs the athlete a retry.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);

/// `POST /athlete/{id}/activities` with the file streamed from disk.
///
/// Returns the created activity id when the response carries one. An
/// unreadable body is not a failure: the upload already succeeded, and
/// reporting otherwise would have the queue post the same ride twice.
pub async fn upload_activity(
    t: &Transport,
    athlete_id: &str,
    file_path: &str,
    filename: &str,
    name: Option<&str>,
    paired_event_id: Option<i64>,
    lane: Lane,
) -> Result<Option<String>, NetError> {
    let mut fields: Vec<(&str, String)> = Vec::new();
    if let Some(name) = name.filter(|n| !n.is_empty()) {
        fields.push(("name", name.to_string()));
    }
    if let Some(event) = paired_event_id.filter(|id| *id != 0) {
        fields.push(("paired_event_id", event.to_string()));
    }
    fields.push(("device_name", DEVICE_NAME.to_string()));

    let part = FilePart {
        field: UPLOAD_FILE_FIELD,
        path: file_path,
        filename,
    };
    let body = t
        .post_multipart(
            &format!("/athlete/{}/activities", athlete_id),
            &part,
            &fields,
            lane,
            UPLOAD_TIMEOUT,
        )
        .await?;
    Ok(created_activity_id(&body))
}

/// `POST /athlete/{id}/activities` with a JSON body, for an entry with no file.
pub async fn create_activity(
    t: &Transport,
    athlete_id: &str,
    activity: &ManualActivityBody,
    lane: Lane,
) -> Result<Option<String>, NetError> {
    let body = serde_json::to_value(activity).map_err(|e| NetError::Decode(e.to_string()))?;
    let response = t
        .post_json(&format!("/athlete/{}/activities", athlete_id), &body, lane)
        .await?;
    Ok(created_activity_id(&response))
}

/// Best-effort id from a create response, which comes back as either the
/// activity object or a one-element list of them.
fn created_activity_id(body: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(body).ok()?;
    let object = match &value {
        serde_json::Value::Array(items) => items.first()?,
        other => other,
    };
    match object.get("id")? {
        serde_json::Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
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
        let acts = crate::runtime::block_on(fetch_activities_with_bodies(
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
        assert_eq!(acts[0].0.id, "a1");
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
        let _ = crate::runtime::block_on(fetch_activities_with_bodies(
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
    fn a_ragged_series_costs_its_own_samples_and_not_the_response() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/77/streams.json");
            then.status(200).json_body(json!([
                {"type": "latlng", "data": [42.5, 42.6, 42.7], "data2": [1.1, 1.2, 1.3]},
                {"type": "heartrate", "data": [120, 121]},
                {"type": "altitude", "data": [400.0, 401.0, 402.0]}
            ]));
        });
        let t = fast_transport(server.base_url());
        let s = crate::runtime::block_on(fetch_streams(&t, "77", None, Lane::Interactive)).unwrap();
        assert_eq!(s.latlng.len(), 3);
        assert_eq!(s.altitude, vec![400.0, 401.0, 402.0]);
        assert_eq!(s.heartrate.len(), 3);
        assert!(s.heartrate[2].is_nan());
    }

    #[test]
    fn a_latlng_series_that_disagrees_with_itself_rejects_the_response() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/77/streams.json");
            then.status(200).json_body(json!([
                {"type": "latlng", "data": [42.5, 42.6, 42.7], "data2": [1.1]},
                {"type": "altitude", "data": [400.0, 401.0, 402.0]}
            ]));
        });
        let t = fast_transport(server.base_url());
        let r = crate::runtime::block_on(fetch_streams(&t, "77", None, Lane::Interactive));
        assert!(r.is_err(), "a broken index space cannot be trusted");
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
    fn pace_curve_endpoint_sends_sport_and_curve_window() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/pace-curves.json")
                .query_param("type", "Run")
                .query_param("curves", "42d");
            then.status(200).json_body(json!({ "list": [] }));
        });
        let t = fast_transport(server.base_url());
        crate::runtime::block_on(fetch_pace_curve_body(
            &t,
            "i1",
            "Run",
            "42d",
            false,
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
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
        crate::runtime::block_on(fetch_pace_curve_body(
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
        crate::runtime::block_on(fetch_pace_curve_body(
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
        let w = crate::runtime::block_on(fetch_wellness_with_bodies(
            &t,
            "i1",
            "2026-05-01",
            "2026-06-26",
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].0.resting_hr, Some(48.0));
    }

    /// A FIT file on disk, plus the handle keeping it alive for the test.
    fn staged_fit() -> (tempfile::NamedTempFile, String) {
        use std::io::Write;
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&[0x0e, 0x20, 0x00, 0x00, 0x2e, 0x46, 0x49, 0x54])
            .unwrap();
        f.flush().unwrap();
        let path = f.path().to_string_lossy().into_owned();
        (f, path)
    }

    #[test]
    fn upload_names_the_file_part_and_tags_the_device() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .body_contains("name=\"file\"")
                .body_contains("filename=\"Bern loop.fit\"")
                .body_contains("name=\"name\"")
                .body_contains("Bern loop")
                .body_contains("name=\"paired_event_id\"")
                .body_contains("4321")
                .body_contains("name=\"device_name\"")
                .body_contains("Veloq");
            then.status(200).json_body(json!({"id": "i999"}));
        });
        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url());
        let id = crate::runtime::block_on(upload_activity(
            &t,
            "i1",
            &path,
            "Bern loop.fit",
            Some("Bern loop"),
            Some(4321),
            Lane::Interactive,
        ))
        .unwrap();
        mock.assert();
        assert_eq!(id.as_deref(), Some("i999"));
    }

    /// True when the multipart body carries neither optional text part. The
    /// file part declares `name="file"`, so `name="name"` only appears when the
    /// title part was actually added.
    fn without_optional_parts(body: Option<&Vec<u8>>) -> bool {
        let text = String::from_utf8_lossy(body.map_or(&[][..], |b| b.as_slice())).into_owned();
        !text.contains("name=\"name\"")
            && !text.contains("name=\"paired_event_id\"")
            && text.contains("name=\"device_name\"")
    }

    #[test]
    fn upload_omits_the_optional_parts_when_unset() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .matches(|req| without_optional_parts(req.body.as_ref()));
            then.status(200).json_body(json!({"id": "i999"}));
        });
        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url());
        crate::runtime::block_on(upload_activity(
            &t,
            "i1",
            &path,
            "ride.fit",
            None,
            None,
            Lane::Interactive,
        ))
        .unwrap();
        mock.assert();
    }

    #[test]
    fn upload_treats_an_empty_name_and_a_zero_event_as_unset() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .matches(|req| without_optional_parts(req.body.as_ref()));
            then.status(200).json_body(json!({"id": "i999"}));
        });
        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url());
        crate::runtime::block_on(upload_activity(
            &t,
            "i1",
            &path,
            "ride.fit",
            Some(""),
            Some(0),
            Lane::Interactive,
        ))
        .unwrap();
        mock.assert();
    }

    #[test]
    fn an_unreadable_upload_response_is_still_a_success() {
        // The activity is already on the server by the time the body arrives.
        // Failing here would have the queue upload the same ride again.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(200).body("OK");
        });
        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url());
        let id = crate::runtime::block_on(upload_activity(
            &t,
            "i1",
            &path,
            "ride.fit",
            None,
            None,
            Lane::Interactive,
        ))
        .unwrap();
        assert_eq!(id, None);
    }

    #[test]
    fn a_list_response_yields_the_first_activity_id() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(200).json_body(json!([{"id": "i123"}]));
        });
        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url());
        let id = crate::runtime::block_on(upload_activity(
            &t,
            "i1",
            &path,
            "ride.fit",
            None,
            None,
            Lane::Interactive,
        ))
        .unwrap();
        assert_eq!(id.as_deref(), Some("i123"));
    }

    fn manual_body() -> ManualActivityBody {
        ManualActivityBody {
            activity_type: "WeightTraining".to_string(),
            name: "Gym".to_string(),
            start_date_local: "2026-08-05T18:00:00".to_string(),
            elapsed_time: 3600,
            moving_time: None,
            distance: None,
            total_elevation_gain: None,
            average_heartrate: Some(112.0),
            description: None,
            trainer: false,
            commute: false,
        }
    }

    #[test]
    fn manual_activity_posts_json_with_the_flags_present() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .json_body(json!({
                    "type": "WeightTraining",
                    "name": "Gym",
                    "start_date_local": "2026-08-05T18:00:00",
                    "elapsed_time": 3600,
                    "average_heartrate": 112.0,
                    "trainer": false,
                    "commute": false
                }));
            then.status(200).json_body(json!({"id": "i55"}));
        });
        let t = fast_transport(server.base_url());
        let id =
            crate::runtime::block_on(create_activity(&t, "i1", &manual_body(), Lane::Interactive))
                .unwrap();
        mock.assert();
        assert_eq!(id.as_deref(), Some("i55"));
    }
}
