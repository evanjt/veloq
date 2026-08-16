//! Stream parsing keeps every series in one index space, names any series that
//! does not fit it, and the fetcher refuses such a response. The transport asks
//! for gzip and decodes it.
//!
//! Coordinates here are synthetic.

use httpmock::prelude::*;
use serde_json::json;
use std::sync::Arc;
use veloqrs::governor::{AuthMethod, Governor, Lane, NoopPolicy};
use veloqrs::net::endpoints;
use veloqrs::net::types::{SeriesLengthMismatch, StreamDto, parse_streams};
use veloqrs::net::{NetError, Transport};

fn dtos(v: serde_json::Value) -> Vec<StreamDto> {
    serde_json::from_value(v).unwrap()
}

fn fast_transport(base: String) -> Transport {
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).unwrap()
}

#[test]
fn null_coordinates_drop_from_every_series() {
    let raw = dtos(json!([
        {"type": "time", "data": [0, 1, 2, 3, 4]},
        {"type": "latlng",
         "data": [10.0, null, 10.2, null, 10.4],
         "data2": [20.0, 20.1, null, 20.3, 20.4]},
        {"type": "altitude", "data": [500.0, 501.0, 502.0, 503.0, 504.0]},
        {"type": "heartrate", "data": [120, 121, 122, 123, 124]},
        {"type": "watts", "data": [200, 201, 202, 203, 204]},
        {"type": "ga_velocity", "data": [5.0, 5.0, 5.0, 5.0, 5.0]}
    ]));

    let s = parse_streams(raw);

    assert_eq!(s.latlng, vec![[10.0, 20.0], [10.4, 20.4]]);
    assert_eq!(s.time, vec![0, 4]);
    assert_eq!(s.altitude, vec![500.0, 504.0]);
    assert_eq!(s.heartrate, vec![120.0, 124.0]);
    assert_eq!(s.watts, vec![200.0, 204.0]);
    assert_eq!(s.gap.len(), 2);

    let n = s.latlng.len();
    for len in [
        s.time.len(),
        s.altitude.len(),
        s.heartrate.len(),
        s.watts.len(),
        s.gap.len(),
    ] {
        assert_eq!(len, n);
    }
}

#[test]
fn clean_coordinates_leave_every_series_untouched() {
    let raw = dtos(json!([
        {"type": "time", "data": [0, 1, 2]},
        {"type": "latlng", "data": [10.0, 10.1, 10.2], "data2": [20.0, 20.1, 20.2]},
        {"type": "fixed_altitude", "data": [500.0, 501.0, 502.0]},
        {"type": "distance", "data": [0.0, 9.0, 18.0]}
    ]));

    let s = parse_streams(raw);

    assert_eq!(s.latlng, vec![[10.0, 20.0], [10.1, 20.1], [10.2, 20.2]]);
    assert_eq!(s.time, vec![0, 1, 2]);
    assert_eq!(s.altitude, vec![500.0, 501.0, 502.0]);
    assert_eq!(s.distance, vec![0.0, 9.0, 18.0]);
    assert!(s.altitude_is_fixed);
}

#[test]
fn mask_comes_from_latlng_not_the_first_series() {
    // `heartrate` leads and carries its own nulls; only the `latlng` gap at
    // index 1 may remove a sample, and a heartrate gap becomes NaN in place.
    let raw = dtos(json!([
        {"type": "heartrate", "data": [null, 121, null, 123]},
        {"type": "latlng",
         "data": [10.0, null, 10.2, 10.3],
         "data2": [20.0, 20.1, 20.2, 20.3]},
        {"type": "time", "data": [0, 1, 2, 3]}
    ]));

    let s = parse_streams(raw);

    assert_eq!(s.latlng, vec![[10.0, 20.0], [10.2, 20.2], [10.3, 20.3]]);
    assert_eq!(s.time, vec![0, 2, 3]);
    assert_eq!(s.heartrate.len(), 3);
    assert!(s.heartrate[0].is_nan());
    assert!(s.heartrate[1].is_nan());
    assert_eq!(s.heartrate[2], 123.0);
}

#[test]
fn a_short_series_is_reported_rather_than_padded_in_silence() {
    let raw = dtos(json!([
        {"type": "latlng", "data": [10.0, 10.1, 10.2], "data2": [20.0, 20.1, 20.2]},
        {"type": "temp", "data": [7.0]}
    ]));

    let s = parse_streams(raw);

    assert_eq!(
        s.misaligned,
        vec![SeriesLengthMismatch {
            series: "temp",
            len: 1,
            expected: 3
        }]
    );
    assert_eq!(s.temp.len(), 3);
    assert_eq!(s.temp[0], 7.0);
    assert!(s.temp[1].is_nan() && s.temp[2].is_nan());
}

#[test]
fn a_long_series_reports_the_tail_it_drops() {
    let raw = dtos(json!([
        {"type": "latlng", "data": [10.0, 10.1], "data2": [20.0, 20.1]},
        {"type": "watts", "data": [200, 201, 202, 203]}
    ]));

    let s = parse_streams(raw);

    assert_eq!(
        s.misaligned,
        vec![SeriesLengthMismatch {
            series: "watts",
            len: 4,
            expected: 2
        }]
    );
    assert_eq!(s.watts, vec![200.0, 201.0]);
}

#[test]
fn lat_and_lng_of_different_lengths_are_reported() {
    let raw = dtos(json!([
        {"type": "latlng", "data": [10.0, 10.1, 10.2], "data2": [20.0, 20.1]}
    ]));

    let s = parse_streams(raw);

    assert_eq!(
        s.misaligned,
        vec![SeriesLengthMismatch {
            series: "latlng",
            len: 3,
            expected: 2
        }]
    );
    assert_eq!(s.latlng, vec![[10.0, 20.0], [10.1, 20.1]]);
}

#[test]
fn aligned_series_report_nothing() {
    let raw = dtos(json!([
        {"type": "time", "data": [0, 1, 2]},
        {"type": "latlng", "data": [10.0, null, 10.2], "data2": [20.0, 20.1, 20.2]},
        {"type": "heartrate", "data": [120, null, 122]}
    ]));

    assert!(parse_streams(raw).misaligned.is_empty());
}

#[test]
fn without_latlng_each_series_keeps_its_own_length() {
    let raw = dtos(json!([
        {"type": "time", "data": [0, 1, 2, 3]},
        {"type": "altitude", "data": [500.0, null, 502.0, 503.0]}
    ]));

    let s = parse_streams(raw);

    assert_eq!(s.time, vec![0, 1, 2, 3]);
    assert_eq!(s.altitude.len(), 4);
    assert!(s.altitude[1].is_nan());
}

/// `[{"type":"time","data":[0,1,2]}]` gzipped, so the decode is reqwest's own
/// rather than something this test fakes.
const GZIPPED_STREAMS: &[u8] = &[
    31, 139, 8, 0, 0, 0, 0, 0, 2, 3, 139, 174, 86, 42, 169, 44, 72, 85, 178, 82, 42, 201, 204, 77,
    85, 210, 81, 74, 73, 44, 73, 84, 178, 138, 54, 208, 49, 212, 49, 138, 173, 141, 5, 0, 28, 192,
    6, 153, 32, 0, 0, 0,
];

#[test]
fn transport_requests_gzip_and_decodes_it() {
    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.method(GET)
            .path("/activity/77/streams.json")
            .matches(|req| {
                req.headers.as_ref().is_some_and(|h| {
                    h.iter().any(|(k, v)| {
                        k.eq_ignore_ascii_case("accept-encoding") && v.contains("gzip")
                    })
                })
            });
        then.status(200)
            .header("content-type", "application/json")
            .header("content-encoding", "gzip")
            .body(GZIPPED_STREAMS);
    });

    let t = fast_transport(server.base_url());
    let raw: Vec<StreamDto> =
        veloqrs::runtime::block_on(t.get_json("/activity/77/streams.json", &[], Lane::Interactive))
            .unwrap();

    mock.assert();
    assert_eq!(parse_streams(raw).time, vec![0, 1, 2]);
}

fn streams_mock(server: &MockServer, body: serde_json::Value) -> httpmock::Mock<'_> {
    server.mock(|when, then| {
        when.method(GET).path("/activity/77/streams.json");
        then.status(200)
            .header("content-type", "application/json")
            .body(body.to_string());
    })
}

#[test]
fn a_misaligned_response_is_refused_not_returned() {
    let server = MockServer::start();
    let _mock = streams_mock(
        &server,
        json!([
            {"type": "latlng", "data": [10.0, 10.1, 10.2], "data2": [20.0, 20.1, 20.2]},
            {"type": "temp", "data": [7.0]}
        ]),
    );

    let t = fast_transport(server.base_url());
    let err =
        veloqrs::runtime::block_on(endpoints::fetch_streams(&t, "77", None, Lane::Interactive))
            .unwrap_err();

    match err {
        NetError::Decode(m) => {
            assert!(m.contains("77"), "{m}");
            assert!(m.contains("temp has 1 of 3"), "{m}");
        }
        other => panic!("expected a decode refusal, got {other}"),
    }
}

#[test]
fn a_time_only_request_has_no_mask_and_clamps_negatives() {
    let server = MockServer::start();
    let _mock = streams_mock(&server, json!([{"type": "time", "data": [0, 1, -3, 4]}]));

    let t = fast_transport(server.base_url());
    let times =
        veloqrs::runtime::block_on(endpoints::fetch_time_stream(&t, "77", Lane::Interactive))
            .unwrap();

    assert_eq!(times, vec![0, 1, 0, 4]);
}
