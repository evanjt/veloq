//! A live recorder asks the catalogue one question: what am I about to enter.
//! `get_nearby_sections` cannot answer it, being keyed on a section, and its
//! centre distance answers a different question again. `sections_near_point`
//! is keyed on the fix and measured from the section's first point.
//!
//! Run: `cargo test --test sections_near_point -p veloqrs`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

const BASE_LAT: f64 = -33.85;
const BASE_LNG: f64 = 151.20;

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("near_point.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
}

fn deg_lat(m: f64) -> f64 {
    m / 111_320.0
}

fn deg_lng(m: f64) -> f64 {
    m / (111_320.0 * BASE_LAT.to_radians().cos())
}

fn at(north_m: f64, east_m: f64) -> GpsPoint {
    GpsPoint::new(BASE_LAT + deg_lat(north_m), BASE_LNG + deg_lng(east_m))
}

/// An eastward line of `count` points 10 m apart, starting at the offset.
fn eastward(north_m: f64, east_m: f64, count: usize) -> Vec<GpsPoint> {
    (0..count)
        .map(|i| at(north_m, east_m + i as f64 * 10.0))
        .collect()
}

fn draw(s: &mut Setup, name: &str, sport: &str, polyline: Vec<GpsPoint>) -> String {
    s.engine
        .create_section(CreateSectionParams {
            sport_type: sport.to_string(),
            polyline: polyline.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&polyline),
            name: Some(name.to_string()),
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .expect("create section")
}

fn ids(found: &[veloqrs::FfiSectionNearPoint]) -> Vec<&str> {
    found.iter().map(|s| s.id.as_str()).collect()
}

#[test]
fn a_section_starting_under_the_fix_is_returned_and_a_distant_one_is_not() {
    let mut s = setup();
    let here = draw(&mut s, "Here", "Ride", eastward(0.0, 0.0, 20));
    draw(&mut s, "Away", "Ride", eastward(5_000.0, 0.0, 20));

    let found = s.engine.sections_near_point(BASE_LAT, BASE_LNG, None, 50.0);
    assert_eq!(ids(&found), vec![here.as_str()]);
    assert!(found[0].start_distance_meters < 1.0);
}

#[test]
fn a_fix_inside_a_long_section_is_not_a_fix_at_its_start() {
    // The bounding box is the prefilter and nothing more. Standing at the far
    // end of a 5 km line is inside its box and 5 km from where it begins, and
    // a centre-distance query would answer 2.5 km and call it near.
    let mut s = setup();
    let long = eastward(0.0, 0.0, 501);
    draw(&mut s, "Long", "Ride", long.clone());

    let far_end = long.last().unwrap();
    let found = s
        .engine
        .sections_near_point(far_end.latitude, far_end.longitude, None, 100.0);
    assert!(found.is_empty(), "returned {:?}", ids(&found));

    let start = long[0];
    let found = s
        .engine
        .sections_near_point(start.latitude, start.longitude, None, 100.0);
    assert_eq!(found.len(), 1);
}

#[test]
fn the_sport_filter_matches_the_stored_sport_exactly() {
    let mut s = setup();
    let ride = draw(&mut s, "Ride line", "Ride", eastward(0.0, 0.0, 20));
    let run = draw(&mut s, "Run line", "Run", eastward(0.0, 0.0, 20));

    let found = s
        .engine
        .sections_near_point(BASE_LAT, BASE_LNG, Some("Ride"), 50.0);
    assert_eq!(ids(&found), vec![ride.as_str()]);

    let found = s
        .engine
        .sections_near_point(BASE_LAT, BASE_LNG, Some("Run"), 50.0);
    assert_eq!(ids(&found), vec![run.as_str()]);

    let found = s
        .engine
        .sections_near_point(BASE_LAT, BASE_LNG, Some("VirtualRide"), 50.0);
    assert!(found.is_empty());

    let found = s.engine.sections_near_point(BASE_LAT, BASE_LNG, None, 50.0);
    assert_eq!(found.len(), 2);
}

#[test]
fn a_disabled_or_superseded_section_is_not_offered_to_a_recording() {
    let mut s = setup();
    let live = draw(&mut s, "Live", "Ride", eastward(0.0, 0.0, 20));
    let off = draw(&mut s, "Off", "Ride", eastward(1.0, 0.0, 20));
    let gone = draw(&mut s, "Gone", "Ride", eastward(2.0, 0.0, 20));
    s.raw
        .execute(
            "UPDATE sections SET disabled = 1 WHERE id = ?",
            params![off],
        )
        .expect("disable");
    s.raw
        .execute(
            "UPDATE sections SET superseded_by = ? WHERE id = ?",
            params![live, gone],
        )
        .expect("supersede");

    let found = s.engine.sections_near_point(BASE_LAT, BASE_LNG, None, 50.0);
    assert_eq!(ids(&found), vec![live.as_str()]);
}

#[test]
fn results_are_ordered_by_distance_to_the_start() {
    let mut s = setup();
    let near = draw(&mut s, "Near", "Ride", eastward(5.0, 0.0, 20));
    let mid = draw(&mut s, "Mid", "Ride", eastward(20.0, 0.0, 20));
    let far = draw(&mut s, "Far", "Ride", eastward(40.0, 0.0, 20));

    let found = s.engine.sections_near_point(BASE_LAT, BASE_LNG, None, 60.0);
    assert_eq!(ids(&found), vec![near.as_str(), mid.as_str(), far.as_str()]);
    assert!(found[0].start_distance_meters < found[1].start_distance_meters);
    assert!(found[1].start_distance_meters < found[2].start_distance_meters);
}

#[test]
fn an_entry_bearing_and_a_line_come_back_with_each_hit() {
    let mut s = setup();
    draw(&mut s, "East", "Ride", eastward(0.0, 0.0, 20));

    let found = s.engine.sections_near_point(BASE_LAT, BASE_LNG, None, 50.0);
    let bearing = found[0].entry_bearing_degrees.expect("an opening bearing");
    assert!((bearing - 90.0).abs() < 2.0, "got {bearing}");
    assert!(!found[0].encoded_polyline.is_empty());
    assert_eq!(found[0].visit_count, 0);
}

#[test]
fn a_radius_of_zero_or_a_broken_fix_returns_nothing() {
    let mut s = setup();
    draw(&mut s, "Here", "Ride", eastward(0.0, 0.0, 20));

    assert!(
        s.engine
            .sections_near_point(BASE_LAT, BASE_LNG, None, 0.0)
            .is_empty()
    );
    assert!(
        s.engine
            .sections_near_point(BASE_LAT, BASE_LNG, None, -10.0)
            .is_empty()
    );
    assert!(
        s.engine
            .sections_near_point(f64::NAN, BASE_LNG, None, 50.0)
            .is_empty()
    );
    assert!(
        s.engine
            .sections_near_point(BASE_LAT, f64::INFINITY, None, 50.0)
            .is_empty()
    );
}

#[test]
fn a_section_with_no_bounds_cached_is_skipped_rather_than_scanned() {
    let mut s = setup();
    let id = draw(&mut s, "Unbounded", "Ride", eastward(0.0, 0.0, 20));
    s.raw
        .execute(
            "UPDATE sections SET bounds_min_lat = NULL, bounds_max_lat = NULL,
                                 bounds_min_lng = NULL, bounds_max_lng = NULL
             WHERE id = ?",
            params![id],
        )
        .expect("clear bounds");

    let found = s.engine.sections_near_point(BASE_LAT, BASE_LNG, None, 50.0);
    assert!(found.is_empty());
}
