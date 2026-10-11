//! One async fetcher per intervals.icu endpoint: build request → transport →
//! serde parse → convert.
//! Credentials live on the `Transport`; callers pass only ids and params.

use crate::governor::Dispatch;
use crate::net::transport::{FilePart, NetError, Transport};
use crate::net::types::*;
use std::time::Duration;

/// Streams requested for the detail charts (GPS + the per-metric series).
pub const DEFAULT_STREAM_TYPES: &str = "time,distance,latlng,velocity_smooth,heartrate,watts,altitude,fixed_altitude,cadence,grade_smooth,temp,w_bal,ga_velocity";

/// Series the bulk track ingest asks for: the coordinates, both altitude
/// forms so `parse_streams` can prefer the corrected one, and the clock the
/// section lap times are read off, which would otherwise cost a second
/// `time,latlng` request per activity.
pub const TRACK_STREAM_TYPES: &str = "latlng,fixed_altitude,altitude,time";

/// Series the elevation backfill asks for. The coordinates of every row in
/// its queue are already on the device, so asking for them again costs about
/// five times the bytes and buys nothing.
pub const ELEVATION_STREAM_TYPES: &str = "fixed_altitude,altitude";

/// `GET /athlete/{id}` as the untyped body. `AthleteRecord` models three
/// fields; the profile screens read unit preferences beyond them, so the body
/// is what gets persisted.
pub async fn fetch_athlete_body(
    t: &Transport,
    athlete_id: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(&format!("/athlete/{}", athlete_id), &[], dispatch)
        .await?;
    decode_body(bytes)
}

/// `GET /athlete/{id}/sport-settings` as the untyped body, for the same reason
/// as `fetch_athlete_body`.
pub async fn fetch_sport_settings_body(
    t: &Transport,
    athlete_id: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/sport-settings", athlete_id),
            &[],
            dispatch,
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
    dispatch: impl Into<Dispatch>,
) -> Result<Vec<(WellnessRecord, String)>, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/wellness", athlete_id),
            &[("oldest", oldest), ("newest", newest)],
            dispatch,
        )
        .await?;
    split_page(&bytes)
}

/// A JSON array page split into each item typed and as its own body, the body
/// being the item's bytes exactly as the server sent them.
///
/// Each item is held as a slice of the page and parsed on its own, so the
/// page is never built into a tree: a 200-activity page of several megabytes
/// costs its bodies and one record at a time rather than a tree several times
/// its size. The stored text keeps the server's key order.
pub fn split_page<T: serde::de::DeserializeOwned>(
    bytes: &[u8],
) -> Result<Vec<(T, String)>, NetError> {
    let items: Vec<&serde_json::value::RawValue> =
        serde_json::from_slice(bytes).map_err(|e| NetError::Decode(e.to_string()))?;

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let raw = item.get();
        let record: T = serde_json::from_str(raw).map_err(|e| NetError::Decode(e.to_string()))?;
        out.push((record, raw.to_owned()));
    }
    Ok(out)
}

/// Response bytes as UTF-8. intervals.icu always answers JSON, so a body that
/// is not valid UTF-8 is a decode failure rather than something to store.
fn decode_body(bytes: Vec<u8>) -> Result<String, NetError> {
    String::from_utf8(bytes).map_err(|e| NetError::Decode(e.to_string()))
}

/// `GET /athlete/me` - discover the current athlete from the credential alone.
pub async fn fetch_current_athlete(
    t: &Transport,
    dispatch: impl Into<Dispatch>,
) -> Result<AthleteRecord, NetError> {
    t.get_json("/athlete/me", &[], dispatch).await
}

/// `GET /athlete/{id}/activities` returning each activity both typed and as
/// its own body. Rust aggregates on the typed values; the feed and detail
/// screens read fields the record does not model.
/// `limit` caps the answer at that many, newest first. The endpoint requires
/// the date range either way, so a count is a narrowing of a window and never
/// a replacement for one.
pub async fn fetch_activities_with_bodies(
    t: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    include_stats: bool,
    limit: Option<u32>,
    dispatch: impl Into<Dispatch>,
) -> Result<Vec<(ActivityRecord, String)>, NetError> {
    let fields = activity_list_fields(include_stats);
    let mut params: Vec<(&str, &str)> =
        vec![("oldest", oldest), ("newest", newest), ("fields", &fields)];
    let limit = limit.map(|n| n.to_string());
    if let Some(limit) = limit.as_deref() {
        params.push(("limit", limit));
    }
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/activities", athlete_id),
            &params,
            dispatch,
        )
        .await?;
    split_page(&bytes)
}

/// The whole history as five fields an activity: the oldest date, the year
/// counts and the census, all from one pull.
pub async fn fetch_activity_history_summary(
    t: &Transport,
    athlete_id: &str,
    today: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<ActivityHistorySummary, NetError> {
    let acts: Vec<CensusRecord> = t
        .get_json(
            &format!("/athlete/{}/activities", athlete_id),
            &[
                ("oldest", "2000-01-01"),
                ("newest", today),
                (
                    "fields",
                    "id,start_date_local,created,icu_sync_date,stream_types",
                ),
            ],
            dispatch,
        )
        .await?;
    Ok(ActivityHistorySummary {
        oldest: oldest_activity_date(&acts),
        counts_by_year: activity_counts_by_year(&acts),
        entries: acts.iter().map(ActivityCensusEntry::from).collect(),
    })
}

/// `GET /activity/{id}/streams.json` → parsed streams, every series reduced to
/// the `latlng` index space. A ragged series is reduced to that space with its
/// gaps as NaN, never shifted, so it costs its own samples and not the
/// response. A `latlng` series that disagrees with itself is rejected: it
/// defines the index space, so nothing in the response can be trusted.
pub async fn fetch_streams(
    t: &Transport,
    activity_id: &str,
    types: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<ParsedStreams, NetError> {
    let raw: Vec<StreamDto> = t
        .get_json(
            &format!("/activity/{}/streams.json", activity_id),
            &[("types", types)],
            dispatch,
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

/// The altitude series for one activity, in the index space upstream holds,
/// with `altitude_is_fixed` saying which of the two it is.
///
/// `None` is a response that carried no altitude series at all, which is
/// upstream saying nothing yet rather than saying there is none. A series that
/// arrived and cannot be filled comes back as `Some`, and that is final.
pub async fn fetch_altitude(
    t: &Transport,
    activity_id: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<Option<ParsedStreams>, NetError> {
    let raw: Vec<StreamDto> = t
        .get_json(
            &format!("/activity/{}/streams.json", activity_id),
            &[("types", ELEVATION_STREAM_TYPES)],
            dispatch,
        )
        .await?;
    if !raw
        .iter()
        .any(|s| s.kind == "altitude" || s.kind == "fixed_altitude")
    {
        return Ok(None);
    }
    // `parse_streams` prefers the corrected series over the raw one, which is
    // the same preference the full track ingest gets.
    Ok(Some(parse_streams(raw)))
}

/// `GET /activity/{id}/streams.json` as the untyped body. The read parses it
/// with `parse_streams`, the single transform, so the cache keeps what the
/// server sent.
pub async fn fetch_streams_body(
    t: &Transport,
    activity_id: &str,
    types: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/activity/{}/streams.json", activity_id),
            &[("types", types)],
            dispatch,
        )
        .await?;
    decode_body(bytes)
}

/// `GET /activity/{id}` as the untyped body. The detail screen reads far more
/// than `ActivityRecord` models.
pub async fn fetch_activity_body(
    t: &Transport,
    activity_id: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(&format!("/activity/{}", activity_id), &[], dispatch)
        .await?;
    decode_body(bytes)
}

/// An activity's `time` stream as whole seconds, for the section-performance
/// lap maths. A section addresses this array with the indices it holds into the
/// stored track, so `latlng` is requested alongside `time` to put both in the
/// one index space. Without it a single dropped coordinate shifts every lap
/// time on the activity. A negative sample is clamped rather than dropped.
///
/// Empty when upstream has no `time`. With no coordinates there is no mask,
/// so the series comes back as upstream sent it and the store's length check
/// judges it. A `time` out of step with coordinates that did come back is an
/// error rather than a series padded or cut to fit, so the activity stays
/// owed rather than timed off the wrong samples.
pub async fn fetch_time_stream(
    t: &Transport,
    activity_id: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<Vec<u32>, NetError> {
    use crate::net::types::{TrackClock, track_clock};
    let parsed = fetch_streams(t, activity_id, "time,latlng", dispatch).await?;
    match track_clock(&parsed) {
        TrackClock::Fits(times) => Ok(times),
        TrackClock::Absent => Ok(Vec::new()),
        TrackClock::OutOfStep if parsed.latlng.is_empty() => {
            Ok(parsed.time.iter().map(|v| (*v).max(0) as u32).collect())
        }
        TrackClock::OutOfStep => Err(NetError::Decode(format!(
            "activity {activity_id} time is out of step with its coordinates"
        ))),
    }
}

/// `GET /athlete/{id}/events` - calendar events (planned workouts, notes,
/// targets) over a date window, as untyped bodies. `resolve=true` expands the
/// workout document the planner screens render.
pub async fn fetch_calendar_events_bodies(
    t: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<Vec<(String, String, String)>, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/events", athlete_id),
            &[("oldest", oldest), ("newest", newest), ("resolve", "true")],
            dispatch,
        )
        .await?;
    split_event_page(&bytes)
}

/// The two fields an event is stored under. Left as values so an event whose
/// date is not a string is skipped like one with no date, rather than failing
/// the page.
#[derive(serde::Deserialize)]
struct EventKey {
    #[serde(default)]
    id: Option<serde_json::Value>,
    #[serde(default)]
    start_date_local: Option<serde_json::Value>,
}

/// An events page as `(id, start_date_local, body)` per event, each body the
/// event's bytes as sent.
pub fn split_event_page(bytes: &[u8]) -> Result<Vec<(String, String, String)>, NetError> {
    let items: Vec<(EventKey, String)> = split_page(bytes)?;
    Ok(items
        .into_iter()
        .filter_map(|(key, body)| {
            // An event with no id cannot be keyed, and one with no date cannot be
            // windowed. Either way it would be unreachable, so skip it.
            let id = key.id.as_ref().map(value_to_id)?;
            let start = key.start_date_local?.as_str()?.to_string();
            Some((id, start, body))
        })
        .collect())
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
    dispatch: impl Into<Dispatch>,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/power-curves.json", athlete_id),
            &[("type", sport), ("curves", curves)],
            dispatch,
        )
        .await?;
    decode_body(bytes)
}

/// `GET /athlete/{id}/pace-curves.json` as the untyped body. `gap=true` is sent
/// only for the `Run` sport.
pub async fn fetch_pace_curve_body(
    t: &Transport,
    athlete_id: &str,
    sport: &str,
    curves: &str,
    gap: bool,
    dispatch: impl Into<Dispatch>,
) -> Result<String, NetError> {
    let mut query: Vec<(&str, &str)> = vec![("type", sport), ("curves", curves)];
    if gap && sport == "Run" {
        query.push(("gap", "true"));
    }
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/pace-curves.json", athlete_id),
            &query,
            dispatch,
        )
        .await?;
    decode_body(bytes)
}

/// `GET /activity/{id}/intervals` as the untyped body.
pub async fn fetch_intervals_body(
    t: &Transport,
    activity_id: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<String, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/activity/{}/intervals", activity_id),
            &[],
            dispatch,
        )
        .await?;
    decode_body(bytes)
}

/// The most activities one bulk request names. Measured against the live
/// server, which answers 200 in one request at about 670 KB gzipped.
pub const BULK_ACTIVITIES_MAX: usize = 200;

/// One activity from the bulk answer, split into the bodies the single
/// endpoints answer for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BulkActivityBodies {
    /// The activity's id upstream.
    pub id: String,
    /// What `GET /activity/{id}` answers: the item with its interval fields
    /// left out, every other field as sent and in the order sent.
    pub detail: String,
    /// What `GET /activity/{id}/intervals` answers, or `None` when the item
    /// carried no `icu_intervals` or a null one.
    pub intervals: Option<String>,
}

/// The fields of the interval body, in the order the single endpoint sends them.
const INTERVAL_BODY_FIELDS: [&str; 4] = ["id", "analyzed", "icu_intervals", "icu_groups"];

/// The fields the bulk answer adds to the detail body.
const INTERVAL_ONLY_FIELDS: [&str; 2] = ["icu_intervals", "icu_groups"];

/// `GET /athlete/{id}/activities/{ids}?intervals=true`: the detail and
/// interval bodies of up to [`BULK_ACTIVITIES_MAX`] activities in one request.
///
/// The answer is sorted by id whatever order the ids were asked in, and an id
/// the server does not know is left out rather than refused, so a caller
/// matches on id and decides for itself what a missing one means.
pub async fn fetch_activity_bodies_in_bulk(
    t: &Transport,
    athlete_id: &str,
    ids: &[String],
    dispatch: impl Into<Dispatch>,
) -> Result<Vec<BulkActivityBodies>, NetError> {
    let bytes = t
        .get_bytes(
            &format!("/athlete/{}/activities/{}", athlete_id, ids.join(",")),
            &[("intervals", "true")],
            dispatch,
        )
        .await?;
    split_bulk_activities(&bytes)
}

/// Split a bulk answer into each activity's detail and interval bodies.
///
/// Each field is copied as the text the server sent, never re-serialised, so
/// key order, number formatting and string escapes match the single
/// endpoints byte for byte.
fn split_bulk_activities(bytes: &[u8]) -> Result<Vec<BulkActivityBodies>, NetError> {
    let items: Vec<OrderedFields<'_>> =
        serde_json::from_slice(bytes).map_err(|e| NetError::Decode(e.to_string()))?;
    items.iter().map(OrderedFields::split).collect()
}

/// A JSON object's fields in the order they were sent, each value as its text.
struct OrderedFields<'a>(Vec<(String, &'a serde_json::value::RawValue)>);

impl<'de> serde::Deserialize<'de> for OrderedFields<'de> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Fields;
        impl<'de> serde::de::Visitor<'de> for Fields {
            type Value = OrderedFields<'de>;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("an activity object")
            }
            fn visit_map<M: serde::de::MapAccess<'de>>(
                self,
                mut map: M,
            ) -> Result<Self::Value, M::Error> {
                let mut fields = Vec::with_capacity(map.size_hint().unwrap_or(0));
                while let Some(field) =
                    map.next_entry::<String, &'de serde_json::value::RawValue>()?
                {
                    fields.push(field);
                }
                Ok(OrderedFields(fields))
            }
        }
        deserializer.deserialize_map(Fields)
    }
}

impl OrderedFields<'_> {
    fn field(&self, name: &str) -> Option<&serde_json::value::RawValue> {
        self.0
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| *value)
    }

    fn split(&self) -> Result<BulkActivityBodies, NetError> {
        let id = self
            .field("id")
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw.get()).ok())
            .and_then(|id| match id {
                serde_json::Value::String(id) => Some(id),
                serde_json::Value::Number(id) => Some(id.to_string()),
                _ => None,
            })
            .ok_or_else(|| NetError::Decode("bulk activity without an id".into()))?;
        let detail = object_text(
            self.0
                .iter()
                .filter(|(key, _)| !INTERVAL_ONLY_FIELDS.contains(&key.as_str())),
        );
        let intervals = match self.field("icu_intervals") {
            Some(raw) if raw.get().trim() != "null" => {
                Some(object_text(INTERVAL_BODY_FIELDS.iter().filter_map(
                    |name| self.0.iter().find(|(key, _)| key == name),
                )))
            }
            _ => None,
        };
        Ok(BulkActivityBodies {
            id,
            detail,
            intervals,
        })
    }
}

/// An object written back from its fields, each value as its sent text.
fn object_text<'a, 'b: 'a>(
    fields: impl Iterator<Item = &'a (String, &'b serde_json::value::RawValue)>,
) -> String {
    let mut text = String::from("{");
    for (index, (key, value)) in fields.enumerate() {
        if index > 0 {
            text.push(',');
        }
        // A key is a plain string, so serialising it cannot fail.
        text.push_str(&serde_json::to_string(key).unwrap_or_default());
        text.push(':');
        text.push_str(value.get());
    }
    text.push('}');
    text
}

/// The multipart field holding the activity file. Taken from the upload path
/// the app has been shipping, not from documentation.
const UPLOAD_FILE_FIELD: &str = "file";

/// What intervals.icu records as the source of an uploaded activity.
const DEVICE_NAME: &str = "Veloq";

/// Uploads get 60 seconds per attempt instead of the interactive lane's 8 s
/// ceiling. A large FIT on a slow connection needs the headroom, and a timeout
/// here costs the athlete a retry. The lane's 10 s budget still bounds the 429
/// retries.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);

/// The text an upload carries beside its file. Each is left out when unset.
#[derive(Debug, Default, Clone, Copy)]
pub struct UploadDetails<'a> {
    pub external_id: Option<&'a str>,
    pub name: Option<&'a str>,
    /// The documented description, which is where the review screen's notes go.
    pub description: Option<&'a str>,
    pub paired_event_id: Option<i64>,
}

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
    details: UploadDetails<'_>,
    dispatch: impl Into<Dispatch>,
) -> Result<Option<String>, NetError> {
    let mut fields: Vec<(&str, String)> = Vec::new();
    if let Some(name) = details.name.filter(|n| !n.is_empty()) {
        fields.push(("name", name.to_string()));
    }
    if let Some(description) = details.description.filter(|d| !d.trim().is_empty()) {
        fields.push(("description", description.to_string()));
    }
    if let Some(event) = details.paired_event_id.filter(|id| *id != 0) {
        fields.push(("paired_event_id", event.to_string()));
    }
    fields.push(("device_name", DEVICE_NAME.to_string()));
    let query = details
        .external_id
        .map(|id| vec![("external_id", id)])
        .unwrap_or_default();

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
            &query,
            dispatch,
            UPLOAD_TIMEOUT,
        )
        .await?;
    Ok(created_activity_id(&body))
}

/// `PUT /activity/{id}` setting the effort the athlete gave a ride, as
/// `icu_rpe`, and nothing else. The upload has no field for it, so it goes up
/// once the upload has returned the activity's id.
pub async fn update_activity_rpe(
    t: &Transport,
    activity_id: &str,
    rpe: u32,
    dispatch: impl Into<Dispatch>,
) -> Result<(), NetError> {
    t.put_json(
        &format!("/activity/{}", activity_id),
        &serde_json::json!({ "icu_rpe": rpe }),
        dispatch,
    )
    .await?;
    Ok(())
}

/// `POST /athlete/{id}/activities/manual` with a JSON body for an entry with no file.
pub async fn create_activity(
    t: &Transport,
    athlete_id: &str,
    activity: &ManualActivityBody,
    dispatch: impl Into<Dispatch>,
) -> Result<Option<String>, NetError> {
    let body = serde_json::to_value(activity).map_err(|e| NetError::Decode(e.to_string()))?;
    let response = t
        .post_json(
            &format!("/athlete/{}/activities/manual", athlete_id),
            &body,
            dispatch,
        )
        .await?;
    Ok(created_activity_id(&response))
}

/// `GET /athlete/{id}/activities` between two local dates, inclusive, asking
/// only for the fields the upload's duplicate check matches on.
pub async fn list_activities_between(
    t: &Transport,
    athlete_id: &str,
    oldest: &str,
    newest: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<Vec<ListedActivity>, NetError> {
    t.get_json(
        &format!("/athlete/{}/activities", athlete_id),
        &[
            ("oldest", oldest),
            ("newest", newest),
            ("fields", "id,external_id,start_date_local,type"),
        ],
        dispatch,
    )
    .await
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
    use crate::governor::{AuthMethod, Governor, Lane, NoopPolicy};
    use httpmock::prelude::*;
    use serde_json::json;
    use std::sync::Arc;

    fn fast_transport(base: String) -> Transport {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).unwrap()
    }

    #[test]
    fn the_bulk_request_names_every_id_and_asks_for_intervals() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities/i30,i10,i20")
                .query_param("intervals", "true");
            then.status(200).body(
                r#"[{"id":"i10","icu_intervals":[]},{"id":"i20","icu_intervals":[]},{"id":"i30","icu_intervals":[]}]"#,
            );
        });
        let t = fast_transport(server.base_url());
        let ids = ["i30", "i10", "i20"].map(String::from);
        let items = crate::runtime::block_on(fetch_activity_bodies_in_bulk(
            &t,
            "i1",
            &ids,
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
        let answered: Vec<&str> = items.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(answered, ["i10", "i20", "i30"]);
    }

    /// A value round-tripped through `serde_json::Value` loses its key order
    /// and rewrites `1.0E-4` and `\u00e9`, so the split body would not be the
    /// one the single endpoint answers.
    #[test]
    fn a_split_body_keeps_every_field_as_the_server_sent_it() {
        let answer = r#"[{"id":"i5","name":"Caf\u00e9","icu_intervals":[{"type":"WORK","gradient":-1.5E-4}],"zeta":1.0E-4,"analyzed":"2025-03-01T08:00:00.000+00:00","alpha":[1,2.50],"icu_groups":null,"icu_athlete_id":"i1"}]"#;

        let items = split_bulk_activities(answer.as_bytes()).unwrap();

        assert_eq!(
            items,
            vec![BulkActivityBodies {
                id: "i5".into(),
                detail: r#"{"id":"i5","name":"Caf\u00e9","zeta":1.0E-4,"analyzed":"2025-03-01T08:00:00.000+00:00","alpha":[1,2.50],"icu_athlete_id":"i1"}"#.into(),
                intervals: Some(
                    r#"{"id":"i5","analyzed":"2025-03-01T08:00:00.000+00:00","icu_intervals":[{"type":"WORK","gradient":-1.5E-4}],"icu_groups":null}"#.into()
                ),
            }]
        );
    }

    #[test]
    fn an_item_with_no_intervals_or_a_null_carries_no_interval_body() {
        let answer =
            r#"[{"id":"i1","type":"Run"},{"id":"i2","icu_intervals":null,"icu_groups":null}]"#;

        let items = split_bulk_activities(answer.as_bytes()).unwrap();

        assert_eq!(items[0].intervals, None);
        assert_eq!(items[0].detail, r#"{"id":"i1","type":"Run"}"#);
        assert_eq!(items[1].intervals, None);
        assert_eq!(items[1].detail, r#"{"id":"i2"}"#);
    }

    #[test]
    fn an_answer_that_is_not_a_list_of_activities_is_a_decode_failure() {
        for answer in [r#"{"id":"i1"}"#, r#"[{"type":"Run"}]"#, "[1]", "[{"] {
            assert!(
                matches!(
                    split_bulk_activities(answer.as_bytes()),
                    Err(NetError::Decode(_))
                ),
                "{answer}"
            );
        }
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
            None,
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].0.id, "a1");
    }

    /// The count the first-use step asks with. The endpoint requires the date
    /// range either way and answers newest first, so a limit narrows a window
    /// rather than replacing one.
    #[test]
    fn activities_carry_the_limit_when_one_is_asked_for() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("limit", "5");
            then.status(200).json_body(json!([]));
        });
        let t = fast_transport(server.base_url());
        let _ = crate::runtime::block_on(fetch_activities_with_bodies(
            &t,
            "i1",
            "2026-01-01",
            "2026-06-26",
            true,
            Some(5),
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
    }

    /// And carries none when none is asked for, or every window pull would
    /// come back capped.
    #[test]
    fn activities_carry_no_limit_by_default() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .matches(|req| {
                    req.query_params
                        .as_ref()
                        .map(|q| !q.iter().any(|(k, _)| k == "limit"))
                        .unwrap_or(true)
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
            None,
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
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
            None,
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
        let s = crate::runtime::block_on(fetch_streams(
            &t,
            "77",
            DEFAULT_STREAM_TYPES,
            Lane::Interactive,
        ))
        .unwrap();
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
                {"type": "altitude", "data": [400.0, 401.0]},
                {"type": "time", "data": [0, 1, 2]}
            ]));
        });
        let t = fast_transport(server.base_url());
        let s = crate::runtime::block_on(fetch_streams(
            &t,
            "77",
            DEFAULT_STREAM_TYPES,
            Lane::Interactive,
        ))
        .unwrap();
        assert_eq!(s.latlng.len(), 3);
        assert_eq!(s.time, vec![0, 1, 2]);
        assert_eq!(s.altitude.len(), 3);
        assert_eq!(s.altitude[1], 401.0);
        assert!(s.altitude[2].is_nan());
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
        let r = crate::runtime::block_on(fetch_streams(
            &t,
            "77",
            DEFAULT_STREAM_TYPES,
            Lane::Interactive,
        ));
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
        let summary = crate::runtime::block_on(fetch_activity_history_summary(
            &t,
            "i1",
            "2026-06-26",
            Lane::Backfill,
        ))
        .unwrap();
        assert_eq!(summary.oldest.as_deref(), Some("2023-02-02T00:00:00"));
        // The same response carries every start date, so the year counts come
        // out of it rather than out of a second request.
        assert_eq!(summary.counts_by_year.get("2026"), Some(&1));
        assert_eq!(summary.counts_by_year.get("2023"), Some(&1));
    }

    #[test]
    fn census_carries_created_and_sync_dates() {
        // The diff that decides what a launch downloads is these two fields
        // against the local rows, since the API has no updated-since filter.
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities").query_param(
                "fields",
                "id,start_date_local,created,icu_sync_date,stream_types",
            );
            then.status(200).json_body(json!([
                {
                    "id": "a",
                    "start_date_local": "2026-06-20T00:00:00",
                    "created": "2026-06-20T08:00:00.000+00:00",
                    "icu_sync_date": "2026-06-21T09:30:00.000+00:00"
                }
            ]));
        });
        let t = fast_transport(server.base_url());
        let summary = crate::runtime::block_on(fetch_activity_history_summary(
            &t,
            "i1",
            "2026-06-26",
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
        assert_eq!(summary.ids(), vec!["a".to_string()]);
        let entry = &summary.entries[0];
        assert_eq!(
            entry.created.as_deref(),
            Some("2026-06-20T08:00:00.000+00:00")
        );
        assert_eq!(
            entry.icu_sync_date.as_deref(),
            Some("2026-06-21T09:30:00.000+00:00")
        );
    }

    /// Scenario: the GPS fetch list and the download-progress count both need
    /// to know which rides have a track upstream. Today that is answered by
    /// parsing every stored body for `stream_types`, on the JS thread.
    ///
    /// Expected behaviour: the census asks for the field and reduces it to one
    /// flag, so no caller parses a body to find out.
    #[test]
    fn census_says_which_activities_have_a_track_upstream() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities").query_param(
                "fields",
                "id,start_date_local,created,icu_sync_date,stream_types",
            );
            then.status(200).json_body(json!([
                {"id": "with", "start_date_local": "2026-06-20T00:00:00",
                 "stream_types": ["time", "watts", "latlng"]},
                {"id": "without", "start_date_local": "2026-06-21T00:00:00",
                 "stream_types": ["time", "watts"]},
                // A field the API omits is not a track.
                {"id": "silent", "start_date_local": "2026-06-22T00:00:00"}
            ]));
        });
        let t = fast_transport(server.base_url());
        let summary = crate::runtime::block_on(fetch_activity_history_summary(
            &t,
            "i1",
            "2026-06-26",
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();

        let flag = |id: &str| {
            summary
                .entries
                .iter()
                .find(|e| e.id == id)
                .map(|e| e.has_latlng)
        };
        assert_eq!(flag("with"), Some(true));
        assert_eq!(flag("without"), Some(false));
        assert_eq!(flag("silent"), Some(false), "no field is not a track");
    }

    /// Scenario: an activity recorded without coordinates still carries heart
    /// rate, and another carries nothing but its clock.
    ///
    /// Expected behaviour: the census marks the first as carrying a series the
    /// stream pass would store and not the second, whatever its track, so the
    /// pass can take a trackless activity without asking about every one.
    #[test]
    fn census_says_which_activities_carry_a_series_beyond_their_track() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/athlete/i1/activities");
            then.status(200).json_body(json!([
                {"id": "strength", "stream_types": ["time", "heartrate"]},
                {"id": "clock", "stream_types": ["time"]},
                {"id": "ride", "stream_types": ["time", "latlng", "watts"]},
                {"id": "line", "stream_types": ["time", "latlng"]},
                {"id": "empty", "stream_types": []},
                {"id": "silent"}
            ]));
        });
        let t = fast_transport(server.base_url());
        let summary = crate::runtime::block_on(fetch_activity_history_summary(
            &t,
            "i1",
            "2026-06-26",
            Lane::Backfill,
        ))
        .unwrap();

        let flag = |id: &str| {
            summary
                .entries
                .iter()
                .find(|e| e.id == id)
                .map(|e| e.has_series)
        };
        assert_eq!(flag("strength"), Some(true));
        assert_eq!(flag("clock"), Some(false), "time only indexes the rest");
        assert_eq!(flag("ride"), Some(true));
        assert_eq!(flag("line"), Some(false), "the coordinates are the track");
        assert_eq!(flag("empty"), Some(false));
        assert_eq!(flag("silent"), Some(false), "no field is no series");
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

    /// An activity page as the server writes it: keys out of alphabetical
    /// order, an escape inside a string and a number with a trailing zero.
    const ACTIVITY_PAGE: &str = r#"[
  {"id":"i9","type":"Ride","name":"Col du L\u00e9man \"loop\"","distance":42000.0,"average_speed":7.50},
  {"name":"Harbour run","id":"i8","start_date_local":"2026-05-01T07:00:00","moving_time":1800}
]"#;

    /// The bytes of each item as it appears in the page.
    fn item_slices(page: &str) -> Vec<&str> {
        let items: Vec<&serde_json::value::RawValue> = serde_json::from_str(page).unwrap();
        items.into_iter().map(|item| item.get()).collect()
    }

    #[test]
    fn an_activity_page_stores_each_body_as_sent() {
        let split: Vec<(ActivityRecord, String)> = split_page(ACTIVITY_PAGE.as_bytes()).unwrap();
        let bodies: Vec<&str> = split.iter().map(|(_, body)| body.as_str()).collect();
        assert_eq!(bodies, item_slices(ACTIVITY_PAGE));
        assert!(bodies[1].starts_with(r#"{"name":"Harbour run","id":"i8""#));
        assert_eq!(split[0].0.id, "i9");
        assert_eq!(split[0].0.name.as_deref(), Some("Col du Léman \"loop\""));
        assert_eq!(split[0].0.average_speed, Some(7.5));
        assert_eq!(split[1].0.moving_time, Some(1800));
    }

    #[test]
    fn a_wellness_page_stores_each_body_as_sent() {
        let page = r#"[{"restingHR":48,"id":"2026-05-01","ctl":50.0},{"id":"2026-05-02"}]"#;
        let split: Vec<(WellnessRecord, String)> = split_page(page.as_bytes()).unwrap();
        let bodies: Vec<&str> = split.iter().map(|(_, body)| body.as_str()).collect();
        assert_eq!(bodies, item_slices(page));
        assert_eq!(split[0].0.resting_hr, Some(48.0));
        assert_eq!(split[1].0.id, "2026-05-02");
    }

    #[test]
    fn an_empty_page_splits_into_nothing() {
        let split: Vec<(ActivityRecord, String)> = split_page(b"[]").unwrap();
        assert!(split.is_empty());
        assert!(split_event_page(b"[]").unwrap().is_empty());
    }

    #[test]
    fn a_page_that_is_not_an_array_or_holds_a_bad_item_is_a_decode_error() {
        assert!(matches!(
            split_page::<ActivityRecord>(br#"{"id":"i1"}"#),
            Err(NetError::Decode(_))
        ));
        assert!(matches!(
            split_page::<ActivityRecord>(br#"[{"id":"i1"},{"name":"no id"}]"#),
            Err(NetError::Decode(_))
        ));
    }

    #[test]
    fn an_events_page_keys_each_event_and_stores_its_body_as_sent() {
        let page = r#"[
  {"start_date_local":"2026-06-01T00:00:00","id":101,"name":"Tempo"},
  {"id":"note-7","start_date_local":"2026-06-02T00:00:00"},
  {"name":"no id","start_date_local":"2026-06-03T00:00:00"},
  {"id":102,"name":"no date"},
  {"id":103,"start_date_local":20260604}
]"#;
        let events = split_event_page(page.as_bytes()).unwrap();
        let slices = item_slices(page);
        assert_eq!(
            events,
            vec![
                (
                    "101".to_string(),
                    "2026-06-01T00:00:00".to_string(),
                    slices[0].to_string()
                ),
                (
                    "note-7".to_string(),
                    "2026-06-02T00:00:00".to_string(),
                    slices[1].to_string()
                ),
            ]
        );
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
            UploadDetails {
                external_id: None,
                name: Some("Bern loop"),
                description: None,
                paired_event_id: Some(4321),
            },
            Lane::Interactive,
        ))
        .unwrap();
        mock.assert();
        assert_eq!(id.as_deref(), Some("i999"));
    }

    /// Scenario: the athlete typed notes on the review screen. They are the
    /// activity's description, which the upload takes under its documented
    /// name, so they arrive with the file rather than in a second request.
    #[test]
    fn upload_carries_the_notes_as_the_description() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .body_contains("name=\"description\"")
                .body_contains("legs heavy");
            then.status(200).json_body(json!({"id": "i999"}));
        });
        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url());
        crate::runtime::block_on(upload_activity(
            &t,
            "i1",
            &path,
            "ride.fit",
            UploadDetails {
                external_id: None,
                name: Some("Bern loop"),
                description: Some("legs heavy"),
                paired_event_id: None,
            },
            Lane::Interactive,
        ))
        .unwrap();
        mock.assert();
    }

    /// The effort goes up as the activity's `icu_rpe`, and only that field,
    /// so the update cannot overwrite anything the athlete changed on the web.
    #[test]
    fn the_effort_update_sends_only_icu_rpe() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/activity/i999")
                .json_body(json!({"icu_rpe": 8}));
            then.status(200)
                .json_body(json!({"id": "i999", "icu_rpe": 8}));
        });
        let t = fast_transport(server.base_url());
        crate::runtime::block_on(update_activity_rpe(&t, "i999", 8, Lane::Interactive)).unwrap();
        mock.assert();
    }

    #[test]
    fn a_refused_effort_update_is_an_error() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(PUT).path("/activity/i999");
            then.status(500);
        });
        let t = fast_transport(server.base_url());
        assert!(
            crate::runtime::block_on(update_activity_rpe(&t, "i999", 8, Lane::Interactive))
                .is_err()
        );
    }

    /// True when the multipart body carries neither optional text part. The
    /// file part declares `name="file"`, so `name="name"` only appears when the
    /// title part was actually added.
    fn without_optional_parts(body: Option<&Vec<u8>>) -> bool {
        let text = String::from_utf8_lossy(body.map_or(&[][..], |b| b.as_slice())).into_owned();
        !text.contains("name=\"name\"")
            && !text.contains("name=\"description\"")
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
            UploadDetails {
                external_id: None,
                name: None,
                description: None,
                paired_event_id: None,
            },
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
            UploadDetails {
                external_id: None,
                name: Some(""),
                description: Some(""),
                paired_event_id: Some(0),
            },
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
            UploadDetails {
                external_id: None,
                name: None,
                description: None,
                paired_event_id: None,
            },
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
            UploadDetails {
                external_id: None,
                name: None,
                description: None,
                paired_event_id: None,
            },
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
            external_id: None,
        }
    }

    #[test]
    fn manual_activity_posts_json_with_the_flags_present() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities/manual")
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
