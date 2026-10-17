use super::*;
use crate::persistence::codec::decode_polyline;

fn floats(bytes: &[u8]) -> Vec<f64> {
    assert_eq!(bytes.len() % 8, 0, "a float buffer is whole samples");
    bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|&c| f64::from_le_bytes(c))
        .collect()
}

fn same(actual: &[f64], expected: &[f64]) {
    assert_eq!(actual.len(), expected.len());
    for (a, e) in actual.iter().zip(expected) {
        assert!(
            a.to_bits() == e.to_bits() || (a.is_nan() && e.is_nan()),
            "{a} != {e}"
        );
    }
}

const RIDE: &str = r#"[
    {"type":"time","data":[0,1,2,3]},
    {"type":"latlng","data":[46.5,null,46.7,46.8],"data2":[7.1,7.2,7.3,7.4]},
    {"type":"altitude","data":[400.5,401.0,402.0,403.0]},
    {"type":"heartrate","data":[120,125,null,135]},
    {"type":"watts","data":[200,210,220,230]},
    {"type":"cadence","data":[80,81,82,83]},
    {"type":"velocity_smooth","data":[5.0,5.5,6.0,6.5]},
    {"type":"distance","data":[0,5.5,11.5,18]},
    {"type":"grade_smooth","data":[0.5,0.6,0.7,0.8]},
    {"type":"temp","data":[15,15,16,16]},
    {"type":"w_bal","data":[20000,19900,19800,19700]},
    {"type":"ga_velocity","data":[4.0,0,null,5.0]}
]"#;

/// Scenario: a full ride body is read for the detail charts.
///
/// Expected behaviour: every series arrives as floats in the index space the
/// coordinates leave, the sample with no coordinate is gone from all of them,
/// a null reads as NaN, and grade-adjusted pace is minutes per kilometre.
#[test]
fn every_series_crosses_in_one_index_space() {
    let streams = chart_streams_from_body(RIDE, "Ride").expect("a stream array");

    let track = decode_polyline(&streams.latlng).expect("the engine's track encoding");
    let coordinates: Vec<(f64, f64)> = track.iter().map(|p| (p.latitude, p.longitude)).collect();
    assert_eq!(coordinates, vec![(46.5, 7.1), (46.7, 7.3), (46.8, 7.4)]);

    same(&floats(&streams.time), &[0.0, 2.0, 3.0]);
    same(&floats(&streams.altitude), &[400.5, 402.0, 403.0]);
    same(&floats(&streams.heartrate), &[120.0, f64::NAN, 135.0]);
    same(&floats(&streams.watts), &[200.0, 220.0, 230.0]);
    same(&floats(&streams.cadence), &[80.0, 82.0, 83.0]);
    same(&floats(&streams.velocity_smooth), &[5.0, 6.0, 6.5]);
    same(&floats(&streams.distance), &[0.0, 11.5, 18.0]);
    same(&floats(&streams.grade_smooth), &[0.5, 0.7, 0.8]);
    same(&floats(&streams.temp), &[15.0, 16.0, 16.0]);
    same(&floats(&streams.wbal), &[20000.0, 19800.0, 19700.0]);
    same(
        &floats(&streams.gap),
        &[1000.0 / 4.0 / 60.0, f64::NAN, 1000.0 / 5.0 / 60.0],
    );
}

/// Expected behaviour: a stopped sample reads pace 0 and a missing one NaN,
/// the two cases the chart tells apart.
#[test]
fn stopped_pace_is_zero_and_missing_pace_is_nan() {
    let body = r#"[{"type":"ga_velocity","data":[0,null,2.5]}]"#;
    let streams = chart_streams_from_body(body, "Ride").unwrap();
    same(&floats(&streams.gap), &[0.0, f64::NAN, 1000.0 / 2.5 / 60.0]);
}

#[test]
fn a_series_the_body_lacks_is_an_empty_buffer() {
    let body = r#"[{"type":"time","data":[0,1]},{"type":"watts","data":[100,110]}]"#;
    let streams = chart_streams_from_body(body, "Ride").unwrap();
    same(&floats(&streams.watts), &[100.0, 110.0]);
    assert!(streams.latlng.is_empty());
    assert!(streams.heartrate.is_empty());
    assert!(streams.gap.is_empty());
    assert!(streams.wbal.is_empty());
}

/// Expected behaviour: an activity with no coordinates keeps every sample of
/// every series, in the server's own index.
#[test]
fn a_trackless_body_keeps_its_own_index() {
    let body = r#"[
        {"type":"time","data":[0,1,2]},
        {"type":"heartrate","data":[90,null,100]}
    ]"#;
    let streams = chart_streams_from_body(body, "Ride").unwrap();
    assert!(streams.latlng.is_empty());
    same(&floats(&streams.time), &[0.0, 1.0, 2.0]);
    same(&floats(&streams.heartrate), &[90.0, f64::NAN, 100.0]);
}

/// Expected behaviour: the corrected altitude wins whichever order the server
/// listed the two in, and the device altitude stands in when it is unusable.
#[test]
fn corrected_altitude_wins_and_device_altitude_stands_in() {
    let corrected = r#"[
        {"type":"altitude","data":[1,2]},
        {"type":"fixed_altitude","data":[10,20]}
    ]"#;
    same(
        &floats(&chart_streams_from_body(corrected, "Ride").unwrap().altitude),
        &[10.0, 20.0],
    );
    let unusable = r#"[
        {"type":"fixed_altitude","data":[null,null]},
        {"type":"altitude","data":[1,2]}
    ]"#;
    same(
        &floats(&chart_streams_from_body(unusable, "Ride").unwrap().altitude),
        &[1.0, 2.0],
    );
}

/// Expected behaviour: a body that is not a stream array reads as nothing
/// stored, so the caller refetches it, and an empty array is a body with no
/// series rather than a failure.
#[test]
fn a_body_that_is_not_a_stream_array_is_nothing_stored() {
    assert!(chart_streams_from_body("not json", "Ride").is_none());
    assert!(chart_streams_from_body(r#"{"time":[0,1]}"#, "Ride").is_none());
    assert!(chart_streams_from_body("", "Ride").is_none());
    assert_eq!(
        chart_streams_from_body("[]", "Ride"),
        Some(FfiActivityStreams::default())
    );
}

/// Expected behaviour: the buffers hold the values exactly, not a rounded
/// copy, and are little-endian whatever the host is.
#[test]
fn values_are_exact_little_endian_floats() {
    let samples: Vec<f64> = (0..20_000).map(|i| f64::from(i) / 100.0).collect();
    let body = serde_json::to_string(&serde_json::json!([
        {"type": "watts", "data": samples}
    ]))
    .unwrap();
    let streams = chart_streams_from_body(&body, "Ride").unwrap();
    assert_eq!(streams.watts.len(), samples.len() * 8);
    assert_eq!(&streams.watts[..8], &samples[0].to_le_bytes());
    same(&floats(&streams.watts), &samples);
}

fn coordinates(streams: &FfiActivityStreams) -> Vec<(f64, f64)> {
    if streams.latlng.is_empty() {
        return Vec::new();
    }
    decode_polyline(&streams.latlng)
        .expect("the engine's track encoding")
        .iter()
        .map(|p| (p.latitude, p.longitude))
        .collect()
}

/// Expected behaviour: a coordinate outside the globe drops its sample from
/// every series, as a missing one does.
#[test]
fn an_out_of_range_coordinate_drops_its_sample_everywhere() {
    let body = r#"[
        {"type":"latlng","data":[46.0,200],"data2":[7.0,7.1]},
        {"type":"watts","data":[200,210]}
    ]"#;
    let streams = chart_streams_from_body(body, "Ride").unwrap();
    assert_eq!(coordinates(&streams), vec![(46.0, 7.0)]);
    same(&floats(&streams.watts), &[200.0]);
}

/// Expected behaviour: a series shorter than the coordinates reads NaN past
/// its end rather than shifting the samples that follow.
#[test]
fn a_short_series_reads_nan_past_its_end() {
    let body = r#"[
        {"type":"latlng","data":[46.0,46.1],"data2":[7.0,7.1]},
        {"type":"cadence","data":[85]}
    ]"#;
    let streams = chart_streams_from_body(body, "Ride").unwrap();
    same(&floats(&streams.cadence), &[85.0, f64::NAN]);
}

/// Expected behaviour: coordinates are paired up to the shorter of the two
/// halves, and a pair with no second half is no coordinates at all.
#[test]
fn unequal_coordinate_halves_pair_to_the_shorter() {
    let shorter_lng = r#"[{"type":"latlng","data":[40.7,34.0],"data2":[-74.0]}]"#;
    assert_eq!(
        coordinates(&chart_streams_from_body(shorter_lng, "Ride").unwrap()),
        vec![(40.7, -74.0)]
    );
    let shorter_lat = r#"[{"type":"latlng","data":[10.0],"data2":[20.0,30.0,40.0]}]"#;
    assert_eq!(
        coordinates(&chart_streams_from_body(shorter_lat, "Ride").unwrap()),
        vec![(10.0, 20.0)]
    );
    let no_lng = r#"[{"type":"latlng","data":[10.0,20.0]}]"#;
    assert!(coordinates(&chart_streams_from_body(no_lng, "Ride").unwrap()).is_empty());
    let empty_lng = r#"[{"type":"latlng","data":[10.0,20.0],"data2":[]}]"#;
    assert!(coordinates(&chart_streams_from_body(empty_lng, "Ride").unwrap()).is_empty());
}

#[test]
fn an_unknown_series_is_ignored() {
    let body = r#"[{"type":"moxie","data":[1,2]},{"type":"watts","data":[3]}]"#;
    let streams = chart_streams_from_body(body, "Ride").unwrap();
    same(&floats(&streams.watts), &[3.0]);
    assert!(streams.time.is_empty());
}

/// Expected behaviour: a run's cadence series, strides a minute as
/// intervals.icu sends it, crosses as steps a minute, the unit the summary
/// gives, while a ride's revolutions cross as stored and a gap stays a gap.
#[test]
fn a_run_cadence_series_is_steps_a_minute() {
    let body = r#"[{"type":"time","data":[0,1,2]},{"type":"cadence","data":[75,null,103]}]"#;
    let run = chart_streams_from_body(body, "Run").unwrap();
    same(&floats(&run.cadence), &[150.0, f64::NAN, 206.0]);
    same(&floats(&run.time), &[0.0, 1.0, 2.0]);
    let ride = chart_streams_from_body(body, "Ride").unwrap();
    same(&floats(&ride.cadence), &[75.0, f64::NAN, 103.0]);
}
