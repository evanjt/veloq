//! Scenario: the stream pass asks for the whole series set, `time` among it,
//! for a track that sits on a section and has no time stream yet.
//!
//! Expected behaviour: the clock it already received is stored as the time
//! stream when it covers the stored points, so the section maths owe no
//! `time,latlng` request for that activity. A clock of another length is not.

use super::*;
use crate::governor::{AuthMethod, Governor, NoopPolicy};
use crate::persistence::with_persistent_engine;
use crate::test_globals::{init_global_engine, serial_global_state};
use httpmock::prelude::*;
use rusqlite::OptionalExtension;
use std::sync::Arc;
use tempfile::TempDir;
use tracematch::GpsPoint;

const POINTS: usize = 8;

fn line() -> Vec<GpsPoint> {
    (0..POINTS)
        .map(|i| GpsPoint::new(46.2 + i as f64 * 0.001, 7.35))
        .collect()
}

fn library() -> TempDir {
    let tmp = init_global_engine("stream_time.db");
    crate::net::connectivity::reset();
    crate::objects::sync::set_credentials_from_native("api_key", "secret", "1")
        .expect("test credential");
    with_persistent_engine(|engine| {
        engine
            .add_activity("i1".to_string(), line(), "Ride".into())
            .expect("add activity");
    })
    .expect("engine");
    tmp
}

fn body(time_len: usize) -> serde_json::Value {
    let points = line();
    serde_json::json!([
        {"type": "time", "data": (0..time_len).map(|i| i as f64 * 3.0).collect::<Vec<f64>>()},
        {"type": "latlng",
         "data": points.iter().map(|p| p.latitude).collect::<Vec<f64>>(),
         "data2": points.iter().map(|p| p.longitude).collect::<Vec<f64>>()},
        {"type": "heartrate", "data": (0..POINTS).map(|i| 130.0 + i as f64).collect::<Vec<f64>>()}
    ])
}

fn serve(time_len: usize) -> MockServer {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET)
            .path("/activity/i1/streams.json")
            .query_param("types", DEFAULT_STREAM_TYPES);
        then.status(200).json_body(body(time_len));
    });
    server
}

fn transport(server: &MockServer) -> Transport {
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(server.base_url(), AuthMethod::ApiKey("secret"), gov).unwrap()
}

fn time_points() -> Option<i64> {
    with_persistent_engine(|e| {
        e.db.query_row(
            "SELECT point_count FROM time_streams WHERE activity_id = 'i1'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
    })
    .expect("engine")
    .expect("time stream")
}

fn owed_time() -> Vec<String> {
    with_persistent_engine(|e| e.get_activities_missing_time_streams(&["i1".to_string()]))
        .expect("engine")
}

#[test]
fn the_stream_pass_stores_the_clock_it_received() {
    let _serial = serial_global_state();
    let _tmp = library();
    let server = serve(POINTS);
    assert_eq!(owed_time(), vec!["i1".to_string()]);

    let run = run_stream_backfill(&transport(&server), "1");

    assert!(matches!(run, StreamBackfillRun::Finished(o) if o.stored == 1));
    assert_eq!(time_points(), Some(POINTS as i64));
    assert!(owed_time().is_empty(), "the time pass owes nothing for it");
}

#[test]
fn the_stream_pass_leaves_a_clock_of_another_length_owed() {
    let _serial = serial_global_state();
    let _tmp = library();
    let server = serve(POINTS + 1);

    run_stream_backfill(&transport(&server), "1");

    assert_eq!(time_points(), None);
    assert_eq!(owed_time(), vec!["i1".to_string()]);
}
