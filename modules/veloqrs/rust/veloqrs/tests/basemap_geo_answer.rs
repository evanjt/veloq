//! One activity's stored line, answered as GeoJSON at the map page's own
//! origin.
//!
//! Scenario: the map page used to receive a long ride as GeoJSON text the
//! JavaScript side had decoded, rebuilt and stringified, half a megabyte per
//! copy. Expected behaviour: the page asks for `veloq-geo/track/<id>` and the
//! engine answers it from the stored track through a pooled read, so the text
//! is written once, in Rust, and parsed in MapLibre's worker. The line is the
//! points the chart scrubber indexes into: every stored point, less the ones
//! with no finite coordinate.
//!
//! Run: `cargo test --test app -p veloqrs -- basemap_geo_answer::`

use std::ffi::CString;
use std::os::raw::c_char;

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::basemap::geo_answer;
use veloqrs::persistence::codec;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work;
use veloqrs::persistence::with_persistent_engine;

unsafe extern "C" {
    fn veloq_geo_get(path: *const c_char, len: *mut usize, status: *mut u16) -> *mut u8;
    fn veloq_tile_free(bytes: *mut u8, len: usize);
}

/// Six hours at one point every second.
const LONG_RIDE_POINTS: usize = 21_600;

fn init_global_engine() -> (TempDir, String) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("geo.db").to_string_lossy().into_owned();
    assert!(
        persistent_engine_init_without_owed_work(path.clone()),
        "the fixture database must open"
    );
    (dir, path)
}

/// A long ride that wanders both ways in both axes, so a sign or an axis swap
/// shows.
fn long_ride(seed: f64) -> Vec<GpsPoint> {
    (0..LONG_RIDE_POINTS)
        .map(|i| {
            let t = i as f64;
            GpsPoint::with_elevation(
                -33.871_234 + seed + (t * 0.001).sin() * 0.05,
                151.204_567 - (t * 0.0007).cos() * 0.08,
                12.0 + (t * 0.01).sin() * 4.0,
            )
        })
        .collect()
}

fn store_track(id: &str, points: Vec<GpsPoint>) {
    with_persistent_engine(|engine| {
        engine
            .add_activity(id.to_string(), points, "Ride".to_string())
            .expect("store the track")
    })
    .expect("the engine is open");
}

/// Write a track row in an older container, the only one that can hold a
/// non-finite coordinate, as a library synced by an earlier build does.
fn overwrite_track_blob(db_path: &str, id: &str, points: &[GpsPoint]) {
    let blob = codec::serialize_points(points).expect("legacy blob");
    let conn = Connection::open(db_path).expect("open beside the engine");
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .expect("busy timeout");
    let changed = conn
        .execute(
            "UPDATE gps_tracks SET track_data = ?, point_count = ? WHERE activity_id = ?",
            params![blob, points.len() as i64, id],
        )
        .expect("overwrite the track");
    assert_eq!(changed, 1, "the activity has a track row to overwrite");
}

fn json(bytes: &[u8]) -> serde_json::Value {
    serde_json::from_slice(bytes).expect("the answer is JSON")
}

/// The positions of the one `LineString` the answer carries.
fn line_positions(bytes: &[u8]) -> Vec<(f64, f64)> {
    let value = json(bytes);
    assert_eq!(value["type"], "Feature");
    assert_eq!(value["geometry"]["type"], "LineString");
    value["geometry"]["coordinates"]
        .as_array()
        .expect("coordinates")
        .iter()
        .map(|position| {
            let pair = position.as_array().expect("a position");
            assert_eq!(pair.len(), 2, "a position is [lng, lat] and nothing else");
            (pair[0].as_f64().unwrap(), pair[1].as_f64().unwrap())
        })
        .collect()
}

fn assert_empty_collection(bytes: &[u8]) {
    let value = json(bytes);
    assert_eq!(value["type"], "FeatureCollection");
    assert_eq!(value["features"].as_array().map(Vec::len), Some(0));
}

/// What the stored encoding decodes to, which is what every reader of the
/// track sees.
fn stored_points(points: &[GpsPoint]) -> Vec<GpsPoint> {
    codec::decode_polyline(&codec::encode_polyline(points)).expect("decode")
}

#[test]
fn a_long_ride_is_answered_as_one_line_matching_the_stored_points() {
    let _serial_state = super::serial_state();
    let (_dir, _path) = init_global_engine();
    let ride = long_ride(0.0);
    store_track("ride-long", ride.clone());

    let body = geo_answer("track/ride-long").expect("a stored track answers");

    assert!(
        body.len() < 600_000,
        "{} bytes for {} points",
        body.len(),
        LONG_RIDE_POINTS
    );
    let positions = line_positions(&body);
    let expected = stored_points(&ride);
    assert_eq!(positions.len(), LONG_RIDE_POINTS);
    for (i, ((lng, lat), point)) in positions.iter().zip(&expected).enumerate() {
        assert!(
            (lng - point.longitude).abs() <= 1e-6 && (lat - point.latitude).abs() <= 1e-6,
            "position {i} is [{lng}, {lat}], stored ({}, {})",
            point.latitude,
            point.longitude
        );
    }
}

#[test]
fn the_query_string_only_busts_the_cache() {
    let _serial_state = super::serial_state();
    let (_dir, _path) = init_global_engine();
    store_track("ride-query", long_ride(0.0)[..50].to_vec());

    assert_eq!(
        geo_answer("track/ride-query?v=3"),
        geo_answer("track/ride-query")
    );
}

#[test]
fn a_point_with_no_finite_coordinate_is_left_off_the_line() {
    let _serial_state = super::serial_state();
    let (_dir, path) = init_global_engine();
    let mut ride = stored_points(&long_ride(0.0));
    store_track("ride-gap", ride.clone());
    ride[1_000].latitude = f64::NAN;
    ride[1_000].longitude = f64::NAN;
    overwrite_track_blob(&path, "ride-gap", &ride);

    let positions = line_positions(&geo_answer("track/ride-gap").expect("answer"));

    assert_eq!(positions.len(), LONG_RIDE_POINTS - 1);
    assert!(
        positions
            .iter()
            .all(|(lng, lat)| lng.is_finite() && lat.is_finite())
    );
}

#[test]
fn a_track_too_short_to_draw_is_an_empty_collection() {
    let _serial_state = super::serial_state();
    let (_dir, path) = init_global_engine();
    store_track("ride-short", long_ride(0.0)[..10].to_vec());
    overwrite_track_blob(&path, "ride-short", &[GpsPoint::new(-33.87, 151.2)]);

    assert_empty_collection(&geo_answer("track/ride-short").expect("answer"));

    // Two points with only one of them finite is no more drawable.
    overwrite_track_blob(
        &path,
        "ride-short",
        &[GpsPoint::new(-33.87, 151.2), GpsPoint::new(f64::NAN, 151.3)],
    );
    assert_empty_collection(&geo_answer("track/ride-short").expect("answer"));
}

#[test]
fn an_unknown_activity_or_kind_is_not_found() {
    let _serial_state = super::serial_state();
    let (_dir, _path) = init_global_engine();
    store_track("ride-known", long_ride(0.0)[..10].to_vec());

    assert_eq!(geo_answer("track/ride-unknown"), Err(404));
    assert_eq!(geo_answer("section/ride-known"), Err(404));
}

#[test]
fn a_path_outside_the_id_alphabet_is_refused() {
    let _serial_state = super::serial_state();
    let (_dir, _path) = init_global_engine();

    for path in [
        "track/../x",
        "track/",
        "track",
        "",
        "track/a/b",
        "track/a%2Fb",
        "track/a.b",
        "track/a b",
        "track/é",
    ] {
        assert_eq!(geo_answer(path), Err(400), "{path:?}");
    }
}

#[test]
fn a_re_ingest_that_replaces_the_track_changes_the_next_answer() {
    let _serial_state = super::serial_state();
    let (_dir, _path) = init_global_engine();
    store_track("ride-again", long_ride(0.0)[..100].to_vec());
    let before = geo_answer("track/ride-again").expect("answer");

    store_track("ride-again", long_ride(0.25)[..100].to_vec());
    let after = geo_answer("track/ride-again").expect("answer");

    assert_ne!(before, after);
    let expected = stored_points(&long_ride(0.25)[..100]);
    let (_, lat) = line_positions(&after)[0];
    assert!((lat - expected[0].latitude).abs() <= 1e-6);
}

/// Ask the way the iOS handler asks, and give the bytes back the way it does.
fn ask_c(path: &str) -> (Option<Vec<u8>>, u16) {
    let path = CString::new(path).unwrap();
    let mut len = usize::MAX;
    let mut status = 0u16;
    let bytes = unsafe { veloq_geo_get(path.as_ptr(), &mut len, &mut status) };
    if bytes.is_null() {
        assert_eq!(len, 0, "a null answer carries no length");
        assert_ne!(status, 200, "a null answer is never a success");
        return (None, status);
    }
    assert_eq!(status, 200);
    let copy = unsafe { std::slice::from_raw_parts(bytes, len) }.to_vec();
    unsafe { veloq_tile_free(bytes, len) };
    (Some(copy), status)
}

#[test]
fn the_ios_entry_answers_the_same_bytes_and_statuses() {
    let _serial_state = super::serial_state();
    let (_dir, _path) = init_global_engine();
    store_track("ride-c", long_ride(0.0)[..200].to_vec());

    let (bytes, _) = ask_c("track/ride-c?v=1");
    assert_eq!(bytes, geo_answer("track/ride-c").ok());
    assert_eq!(ask_c("track/ride-missing"), (None, 404));
    assert_eq!(ask_c("track/../x"), (None, 400));

    let mut len = usize::MAX;
    let mut status = 0u16;
    let null = unsafe { veloq_geo_get(std::ptr::null(), &mut len, &mut status) };
    assert!(null.is_null());
    assert_eq!((len, status), (0, 400));
}
