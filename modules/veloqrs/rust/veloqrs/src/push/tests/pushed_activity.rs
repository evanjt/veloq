//! A pushed activity lands the way a sync would have landed it.
//!
//! The push fetches the detail, the detail streams and the intervals, and marks
//! the census row at the version the detail body names. The sync behind it then
//! owes nothing for that activity, and the library it leaves is the one the sync
//! alone would have written.

use super::*;
use crate::objects::sync::{DETAIL_STREAM_TYPES_KEY, ready_newest_activities};
use crate::test_globals::serial_global_state;
use httpmock::prelude::*;
use serde_json::{Value, json};

const ATHLETE: &str = "i1";
const START: &str = "2026-09-17T07:30:00";

/// One invented activity as the server would answer for it: the detail body,
/// the list row, the streams and the intervals. `None` is a 404.
struct Shape {
    label: &'static str,
    id: &'static str,
    sport: &'static str,
    stream_types: Vec<&'static str>,
    streams: Option<Value>,
    intervals: Option<Value>,
}

fn coords(n: usize) -> (Vec<Value>, Vec<Value>) {
    let lat = (0..n).map(|i| json!(46.2 + i as f64 * 0.0005)).collect();
    let lng = (0..n).map(|i| json!(7.35 + i as f64 * 0.0005)).collect();
    (lat, lng)
}

fn series(kind: &str, n: usize, base: f64) -> Value {
    json!({"type": kind, "data": (0..n).map(|i| base + i as f64).collect::<Vec<_>>()})
}

fn track_streams(n: usize, extra: &[&str]) -> Value {
    let (lat, lng) = coords(n);
    let mut out = vec![
        series("time", n, 0.0),
        json!({"type": "latlng", "data": lat, "data2": lng}),
        series("altitude", n, 400.0),
        series("distance", n, 0.0),
    ];
    for kind in extra {
        out.push(series(kind, n, 120.0));
    }
    Value::Array(out)
}

fn some_intervals() -> Value {
    json!({"icu_intervals": [{"id": 1, "start_index": 0, "end_index": 10, "type": "WORK"}],
           "icu_groups": []})
}

fn no_intervals() -> Value {
    json!({"icu_intervals": [], "icu_groups": []})
}

fn shapes() -> Vec<Shape> {
    vec![
        Shape {
            label: "a ride with power",
            id: "i701",
            sport: "Ride",
            stream_types: vec![
                "time",
                "latlng",
                "altitude",
                "distance",
                "watts",
                "heartrate",
            ],
            streams: Some(track_streams(30, &["watts", "heartrate"])),
            intervals: Some(some_intervals()),
        },
        Shape {
            label: "a run with a graded pace",
            id: "i702",
            sport: "Run",
            stream_types: vec!["time", "latlng", "altitude", "distance", "ga_velocity"],
            streams: Some(track_streams(25, &["ga_velocity"])),
            intervals: Some(some_intervals()),
        },
        Shape {
            label: "a pool swim with no track",
            id: "i703",
            sport: "Swim",
            stream_types: vec!["time", "distance", "heartrate"],
            streams: Some(json!([
                series("time", 12, 0.0),
                series("distance", 12, 0.0),
                series("heartrate", 12, 110.0)
            ])),
            intervals: Some(no_intervals()),
        },
        Shape {
            label: "a manual entry with no series",
            id: "i704",
            sport: "WeightTraining",
            stream_types: vec![],
            streams: Some(json!([])),
            intervals: Some(no_intervals()),
        },
        Shape {
            label: "a stub the server holds no data behind",
            id: "i705",
            sport: "Ride",
            stream_types: vec![],
            streams: None,
            intervals: None,
        },
        Shape {
            label: "a ride with no intervals",
            id: "i706",
            sport: "Ride",
            stream_types: vec!["time", "latlng", "altitude", "distance"],
            streams: Some(track_streams(20, &[])),
            intervals: Some(no_intervals()),
        },
    ]
}

fn detail_body(shape: &Shape, sync_date: &str) -> String {
    json!({
        "id": shape.id,
        "icu_athlete_id": ATHLETE,
        "name": format!("{} at {sync_date}", shape.label),
        "type": shape.sport,
        "start_date_local": START,
        "created": "2026-09-17T09:00:00Z",
        "icu_sync_date": sync_date,
        "moving_time": 3600,
        "elapsed_time": 3700,
        "distance": 30000.5,
        "stream_types": shape.stream_types,
    })
    .to_string()
}

/// The row a list page carries for the same activity: every field the metrics
/// row reads, since a window sync asks with the stats, and no athlete id, so
/// the body store reads it as a summary rather than a detail.
fn list_body(shape: &Shape, sync_date: &str) -> String {
    json!({
        "id": shape.id,
        "name": format!("{} at {sync_date}", shape.label),
        "type": shape.sport,
        "start_date_local": START,
        "icu_sync_date": sync_date,
        "moving_time": 3600,
        "elapsed_time": 3700,
        "distance": 30000.5,
        "stream_types": shape.stream_types,
    })
    .to_string()
}

fn census_entry(shape: &Shape, sync_date: &str) -> crate::net::types::ActivityCensusEntry {
    let record: crate::net::intervals::wire::ActivityRecord =
        serde_json::from_str(&detail_body(shape, sync_date)).expect("the body");
    crate::net::types::ActivityCensusEntry::from(&record)
}

fn serve<'a>(server: &'a MockServer, shape: &Shape, sync_date: &str) -> Vec<httpmock::Mock<'a>> {
    let detail = detail_body(shape, sync_date);
    let mut mocks = vec![server.mock(|when, then| {
        when.method(GET).path(format!("/activity/{}", shape.id));
        then.status(200).body(detail.clone());
    })];
    mocks.push(server.mock(|when, then| {
        when.method(GET)
            .path(format!("/activity/{}/streams.json", shape.id));
        match &shape.streams {
            Some(body) => then.status(200).body(body.to_string()),
            None => then.status(404),
        };
    }));
    mocks.push(server.mock(|when, then| {
        when.method(GET)
            .path(format!("/activity/{}/intervals", shape.id));
        match &shape.intervals {
            Some(body) => then.status(200).body(body.to_string()),
            None => then.status(404),
        };
    }));
    // The bulk request carries nothing here, so every body is asked singly,
    // which is the path the push takes.
    mocks.push(server.mock(|when, then| {
        when.method(GET)
            .path(format!("/athlete/{ATHLETE}/activities/{}", shape.id));
        then.status(200)
            .header("content-type", "application/json")
            .body("[]");
    }));
    mocks
}

fn transport_to(server: &MockServer) -> crate::net::transport::Transport {
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    crate::net::transport::Transport::with_governor(
        server.base_url(),
        crate::governor::AuthMethod::ApiKey("k"),
        governor,
    )
    .expect("transport")
}

fn signed_in_library(file: &str) -> tempfile::TempDir {
    let tmp = crate::test_globals::init_global_engine(file);
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_setting(crate::persistence::settings_keys::ATHLETE_ID, ATHLETE)
            .expect("the owner");
    })
    .expect("the engine");
    crate::objects::clear_test_credentials();
    crate::objects::set_credentials_from_native("api_key", "key", ATHLETE).expect("credential");
    tmp
}

fn push(id: &str) {
    let run = activity_push_run(
        crate::persistence::engine_install(),
        id,
        ATHLETE,
        false,
        false,
    )
    .expect("the push ran");
    assert!(run.is_some(), "the push wrote to the library it started in");
}

fn ready_pass(server: &MockServer) {
    crate::runtime::block_on(ready_newest_activities(
        crate::persistence::engine_install(),
        &crate::net::intervals::IntervalsSession::new(transport_to(server), ATHLETE),
        &|| false,
    ))
    .expect("the ready pass");
}

fn record_census(entries: Vec<crate::net::types::ActivityCensusEntry>) {
    crate::persistence::with_persistent_engine(move |engine| {
        engine
            .record_activity_census(ATHLETE, &entries)
            .expect("the census");
    })
    .expect("the engine");
}

fn store_list_page(shape: &Shape, sync_date: &str) {
    let raw = list_body(shape, sync_date);
    let record: crate::net::intervals::wire::ActivityRecord =
        serde_json::from_str(&raw).expect("the row");
    let date = crate::objects::sync::start_date_to_timestamp(Some(START)).expect("a date");
    let metrics = vec![crate::net::intervals::activity_metrics_row(record, date)];
    let id = shape.id.to_string();
    crate::persistence::with_persistent_engine(move |engine| {
        engine
            .store_synced_activity_bodies(ATHLETE, &[(id.clone(), date, raw)], &[id], metrics)
            .expect("the list page");
    })
    .expect("the engine");
}

fn stored_detail(id: &str) -> Option<String> {
    crate::persistence::with_persistent_engine(|engine| engine.get_activity_body(id))
        .expect("the engine")
}

fn stored_streams(id: &str) -> Option<String> {
    crate::persistence::with_persistent_engine(|engine| {
        engine.get_stream_body(id, DETAIL_STREAM_TYPES_KEY)
    })
    .expect("the engine")
    .expect("the read")
}

fn stored_intervals(id: &str) -> Option<String> {
    crate::persistence::with_persistent_engine(|engine| engine.get_interval_body(id))
        .expect("the engine")
        .expect("the read")
}

/// One stored row, as column name and value.
type Row = Vec<(String, String)>;

/// The census rows, as the version upstream names and the version fetched.
fn census_versions() -> Vec<(String, Option<String>, Option<String>)> {
    crate::persistence::with_persistent_engine(|engine| {
        let mut stmt = engine
            .db
            .prepare(
                "SELECT intervals_id, icu_sync_date, fetched_sync_date FROM activity_census
                 WHERE athlete_id = ?1 ORDER BY intervals_id",
            )
            .expect("the read");
        stmt.query_map([ATHLETE], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .expect("the rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("the collect")
    })
    .expect("the engine")
}

/// Every row the library holds for one activity in the tables a detail screen
/// and the next sync read, with the columns that carry a wall-clock stamp left
/// out, since two runs a second apart write different ones.
fn library_rows(id: &str) -> Vec<(String, Vec<Row>)> {
    const TABLES: [(&str, &str); 9] = [
        ("activity_bodies", "activity_id"),
        ("activity_metrics", "activity_id"),
        ("stream_bodies", "activity_id"),
        ("interval_bodies", "activity_id"),
        ("gps_tracks", "activity_id"),
        ("time_streams", "activity_id"),
        ("activity_streams", "activity_id"),
        ("activities", "id"),
        ("activity_census", "intervals_id"),
    ];
    const STAMPS: [&str; 4] = ["updated_at", "created_at", "census_at", "fetched_at"];
    crate::persistence::with_persistent_engine(|engine| {
        TABLES
            .iter()
            .map(|(table, key)| {
                let mut stmt = engine
                    .db
                    .prepare(&format!(
                        "SELECT * FROM {table} WHERE {key} = ?1 ORDER BY 2"
                    ))
                    .expect("the read");
                let names: Vec<String> =
                    stmt.column_names().iter().map(|n| n.to_string()).collect();
                let rows = stmt
                    .query_map([id], |row| {
                        let mut out = Vec::new();
                        for (i, name) in names.iter().enumerate() {
                            if STAMPS.contains(&name.as_str()) {
                                continue;
                            }
                            let value: rusqlite::types::Value = row.get(i)?;
                            out.push((name.clone(), format!("{value:?}")));
                        }
                        Ok(out)
                    })
                    .expect("the rows")
                    .collect::<Result<Vec<_>, _>>()
                    .expect("the collect");
                (table.to_string(), rows)
            })
            .collect()
    })
    .expect("the engine")
}

/// Scenario: a push lands for an activity the census has never named, and the
/// sync runs behind it.
///
/// Expected behaviour: the newest-activities pass asks the server for nothing,
/// since the push already stored the detail, the detail streams and the
/// intervals.
#[test]
fn a_pushed_activity_leaves_the_ready_pass_nothing_to_fetch() {
    let _guard = serial_global_state();
    let _tmp = signed_in_library("pushed-ready.db");
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    let shape = &shapes()[0];
    let _served = serve(&server, shape, "2026-09-17T09:05:00Z");

    push(shape.id);

    let quiet = MockServer::start();
    let anything = quiet.mock(|when, then| {
        when.any_request();
        then.status(500);
    });
    ready_pass(&quiet);
    assert_eq!(
        anything.calls(),
        0,
        "the sync asked for what the push stored"
    );
    crate::objects::clear_test_credentials();
}

/// Scenario: the sync's list page reaches a day holding a pushed activity.
///
/// Expected behaviour: the detail body the push stored stays, rather than
/// being replaced with the summary and fetched again. A later census naming a
/// moved version makes it owed once more, and the list page then replaces it.
#[test]
fn a_list_page_keeps_a_pushed_detail_until_the_census_names_a_moved_version() {
    let _guard = serial_global_state();
    let _tmp = signed_in_library("pushed-list.db");
    let shape = &shapes()[0];
    let pushed = detail_body(shape, "2026-09-17T09:05:00Z");
    crate::persistence::with_persistent_engine(|engine| {
        record_activity_detail(engine, shape.id, &pushed)
    })
    .expect("the engine")
    .expect("the record");

    store_list_page(shape, "2026-09-17T09:05:00Z");
    assert_eq!(stored_detail(shape.id).as_deref(), Some(pushed.as_str()));

    record_census(vec![census_entry(shape, "2026-09-18T10:00:00Z")]);
    let days =
        crate::persistence::with_persistent_engine(|engine| engine.fetched_activity_days(ATHLETE))
            .expect("the engine")
            .expect("the days");
    assert_eq!(
        days,
        vec![("2026-09-17".to_string(), shape.id.to_string(), true)],
        "a moved version is owed again"
    );
    store_list_page(shape, "2026-09-18T10:00:00Z");
    assert_eq!(
        stored_detail(shape.id),
        Some(list_body(shape, "2026-09-18T10:00:00Z")),
        "the summary replaces a detail the census says is stale"
    );
    crate::objects::clear_test_credentials();
}

/// Scenario: a detail body with no `icu_sync_date` says nothing about the
/// version it is.
///
/// Expected behaviour: no census row is written for it, so the sync still owes
/// it rather than trusting a version nobody named.
#[test]
fn a_detail_with_no_version_marks_no_census_row() {
    let _guard = serial_global_state();
    let _tmp = signed_in_library("pushed-unversioned.db");
    let body = json!({"id": "i707", "icu_athlete_id": ATHLETE, "type": "Ride",
                      "start_date_local": START})
    .to_string();

    crate::persistence::with_persistent_engine(|engine| {
        record_activity_detail(engine, "i707", &body)
    })
    .expect("the engine")
    .expect("the record");

    assert_eq!(census_versions(), vec![]);
    crate::objects::clear_test_credentials();
}

/// Scenario: the analysed push arrives after the uploaded one, and the
/// analysis moved `icu_sync_date` and changed the series and the intervals.
///
/// Expected behaviour: the stored detail, streams and intervals are the later
/// ones, and the census row names the later version as fetched. The same push
/// delivered twice asks for nothing the second time but the detail.
#[test]
fn an_analysed_push_after_the_upload_replaces_what_the_upload_stored() {
    let _guard = serial_global_state();
    let _tmp = signed_in_library("pushed-twice.db");
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    let uploaded = &shapes()[0];
    let analysed = Shape {
        streams: Some(track_streams(30, &["watts", "heartrate", "w_bal"])),
        intervals: Some(json!({"icu_intervals": [
            {"id": 1, "start_index": 0, "end_index": 10, "type": "WORK"},
            {"id": 2, "start_index": 11, "end_index": 29, "type": "RECOVERY"}],
            "icu_groups": []})),
        stream_types: vec![
            "time",
            "latlng",
            "altitude",
            "distance",
            "watts",
            "heartrate",
            "w_bal",
        ],
        ..shapes().remove(0)
    };

    let served = serve(&server, uploaded, "2026-09-17T09:05:00Z");
    push(uploaded.id);
    for mut mock in served {
        mock.delete();
    }
    let served = serve(&server, &analysed, "2026-09-17T09:06:00Z");
    push(analysed.id);

    assert_eq!(
        stored_detail(analysed.id),
        Some(detail_body(&analysed, "2026-09-17T09:06:00Z"))
    );
    assert_eq!(
        stored_streams(analysed.id),
        analysed.streams.as_ref().map(Value::to_string)
    );
    assert_eq!(
        stored_intervals(analysed.id),
        analysed.intervals.as_ref().map(Value::to_string)
    );
    let later = Some("2026-09-17T09:06:00Z".to_string());
    assert_eq!(
        census_versions(),
        vec![(analysed.id.to_string(), later.clone(), later)]
    );

    push(analysed.id);
    assert_eq!(served[0].calls(), 2, "the detail is asked each time");
    assert_eq!(served[1].calls(), 1, "a repeated push asks no streams");
    assert_eq!(served[2].calls(), 1, "a repeated push asks no intervals");
    crate::objects::clear_test_credentials();
}

/// Scenario: the same activity reaches one library through a push and then a
/// sync, and another library through the sync alone, across the shapes the
/// server answers with.
///
/// Expected behaviour: the two libraries hold the same rows for it, and the
/// sync behind the push asks the server for nothing.
#[test]
fn a_push_then_a_sync_leaves_the_library_the_sync_alone_would() {
    let _guard = serial_global_state();
    let version = "2026-09-17T09:05:00Z";
    for shape in shapes() {
        let pushed = {
            let _tmp = signed_in_library("pushed-path.db");
            let server = MockServer::start();
            let _base = crate::objects::sync::test_base_url(server.base_url());
            let _served = serve(&server, &shape, version);
            push(shape.id);

            let quiet = MockServer::start();
            let anything = quiet.mock(|when, then| {
                when.any_request();
                then.status(500);
            });
            record_census(vec![census_entry(&shape, version)]);
            store_list_page(&shape, version);
            ready_pass(&quiet);
            assert_eq!(anything.calls(), 0, "{}: the sync asked again", shape.label);
            library_rows(shape.id)
        };
        let synced = {
            let _tmp = signed_in_library("synced-path.db");
            let server = MockServer::start();
            let _served = serve(&server, &shape, version);
            record_census(vec![census_entry(&shape, version)]);
            store_list_page(&shape, version);
            ready_pass(&server);
            library_rows(shape.id)
        };
        for ((table, by_push), (_, by_sync)) in pushed.iter().zip(&synced) {
            assert_eq!(by_push, by_sync, "{}: {table}", shape.label);
        }
    }
    crate::objects::clear_test_credentials();
}

/// How many times the feed's channel was announced to `recorder`.
fn activities_announced(recorder: &crate::objects::observer::recorder::Recorder) -> usize {
    recorder
        .events()
        .iter()
        .filter(|event| *event == "activities_stored")
        .count()
}

/// Scenario: the app is alive when the push runs in its process, so the feed
/// already read its list before the ride existed.
///
/// Expected behaviour: the push announces the stored ride on the feed's
/// channel, as a sync does once its rows are committed, so the list reads it
/// again rather than waiting for the next sync.
#[test]
fn a_stored_push_tells_the_feed_its_list_changed() {
    use crate::objects::observer::{recorder::Recorder, set_observer};

    let _guard = serial_global_state();
    let _tmp = signed_in_library("pushed-announced.db");
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    let shape = &shapes()[0];
    let _served = serve(&server, shape, "2026-09-17T09:05:00Z");
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    push(shape.id);

    set_observer(None);
    let events = recorder.events();
    assert_eq!(activities_announced(&recorder), 1, "{events:?}");
    assert_eq!(
        events.last().map(String::as_str),
        Some("activities_stored"),
        "the feed was told before the ride's bodies and index landed: {events:?}"
    );
    crate::objects::clear_test_credentials();
}

/// Scenario: the library changed owner under the push, so nothing of the ride
/// was written.
///
/// Expected behaviour: the feed is not told anything landed.
#[test]
fn a_dropped_push_tells_the_feed_nothing() {
    use crate::objects::observer::{recorder::Recorder, set_observer};

    let _guard = serial_global_state();
    let _tmp = signed_in_library("pushed-dropped.db");
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_setting(crate::persistence::settings_keys::ATHLETE_ID, "i7")
            .expect("another owner");
    })
    .expect("the engine");
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    let shape = &shapes()[0];
    let _served = serve(&server, shape, "2026-09-17T09:05:00Z");
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    let run = activity_push_run(
        crate::persistence::engine_install(),
        shape.id,
        ATHLETE,
        false,
        false,
    )
    .expect("the push ran");

    set_observer(None);
    assert!(
        run.is_none(),
        "the push wrote into another athlete's library"
    );
    assert_eq!(
        activities_announced(&recorder),
        0,
        "{:?}",
        recorder.events()
    );
    crate::objects::clear_test_credentials();
}

/// Scenario: the athlete turned notifications off, so the push stops at the
/// gate and fetches nothing.
///
/// Expected behaviour: the feed is not told anything landed.
#[test]
fn a_gated_push_tells_the_feed_nothing() {
    use crate::objects::observer::{recorder::Recorder, set_observer};

    let _guard = serial_global_state();
    let _tmp = signed_in_library("pushed-gated.db");
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    let shape = &shapes()[0];
    let served = serve(&server, shape, "2026-09-17T09:05:00Z");
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    let answer = activity_push_json(shape.id, ATHLETE).expect("the push ran");

    set_observer(None);
    assert!(answer.is_none(), "a gated push answered {answer:?}");
    assert_eq!(served[0].calls(), 0, "a gated push fetched the detail");
    assert_eq!(
        activities_announced(&recorder),
        0,
        "{:?}",
        recorder.events()
    );
    crate::objects::clear_test_credentials();
}

/// The route a ride over `coords(30)` joins: three earlier rides over the same
/// track, grouped and settled, each slower than the ride the test pushes.
fn grouped_route_of_three() {
    use tracematch::GpsPoint;
    let (lat, lng) = coords(30);
    let track: Vec<GpsPoint> = lat
        .iter()
        .zip(&lng)
        .map(|(la, ln)| GpsPoint::new(la.as_f64().unwrap(), ln.as_f64().unwrap()))
        .collect();
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_notification_templates("en-AU", &super::tests::bundle())
            .expect("the bundle");
        let mut rows = Vec::new();
        for (n, id) in ["i801", "i802", "i803"].into_iter().enumerate() {
            engine
                .add_activity(id.to_string(), track.clone(), "Ride".to_string())
                .expect("the earlier ride");
            rows.push(crate::ActivityMetrics {
                activity_id: id.to_string(),
                name: format!("Earlier ride {n}"),
                date: 1_757_000_000 + n as i64 * 86_400,
                distance: 30000.5,
                moving_time: 4000 + n as u32 * 100,
                elapsed_time: 4100 + n as u32 * 100,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".to_string(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            });
        }
        engine.set_activity_metrics(rows).expect("the metrics");
        let groups = engine.get_groups().to_vec();
        assert_eq!(groups.len(), 1, "the earlier rides form one route");
        assert!(!engine.groups_are_dirty());
    })
    .expect("the engine");
}

/// Scenario: a new ride over a route the athlete has ridden three times,
/// faster than every one of them. The push stores it, indexes it and reads the
/// ladder, and the ride joins the route only when a regroup commits.
///
/// Expected behaviour: the sentence is the route PR, read once the ride's
/// route membership has settled rather than before the regroup that settles
/// it has committed.
#[test]
fn a_new_ride_faster_than_every_earlier_one_on_its_route_is_announced_as_a_route_pr() {
    let _guard = serial_global_state();
    let _tmp = signed_in_library("pushed-route-pr.db");
    grouped_route_of_three();
    let server = MockServer::start();
    let _base = crate::objects::sync::test_base_url(server.base_url());
    let shape = Shape {
        label: "a ride over the route",
        id: "i804",
        sport: "Ride",
        stream_types: vec!["time", "latlng", "altitude", "distance"],
        streams: Some(track_streams(30, &[])),
        intervals: Some(no_intervals()),
    };
    let _served = serve(&server, &shape, "2026-09-17T09:05:00Z");

    let run = activity_push_run(
        crate::persistence::engine_install(),
        shape.id,
        ATHLETE,
        true,
        false,
    )
    .expect("the push ran")
    .expect("the library it started in");

    let sentence = run
        .map_err(|quiet| quiet.outcome)
        .expect("a sentence")
        .json(false);
    assert!(sentence.contains("Route PR"), "{sentence}");
    crate::objects::clear_test_credentials();
}
