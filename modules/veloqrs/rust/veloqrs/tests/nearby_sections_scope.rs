//! What the section detail map draws around the section it is showing.
//!
//! `get_nearby_sections` measured the distance between two bounds-box
//! midpoints, which answers a question about neither line: a section running
//! right alongside for three kilometres has a midpoint far away, and a loop
//! around the query section has a midpoint on top of it. It also filtered on
//! no sport at all, so a ride section drew the endpoints of every swim and run
//! nearby.
//!
//! Run: `cargo test --test nearby_sections_scope -p veloqrs`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

const BASE_LAT: f64 = -33.85;
const BASE_LNG: f64 = 151.20;
const RADIUS: f64 = 500.0;

struct Setup {
    engine: PersistentEngine,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("nearby.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    Setup { engine, _tmp: tmp }
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

/// A square ring `radius_m` from the origin, so its bounds midpoint sits on
/// the origin while no point of it is nearer than `radius_m`.
fn ring(radius_m: f64) -> Vec<GpsPoint> {
    let r = radius_m;
    let mut points = Vec::new();
    let steps = 20;
    for i in 0..=steps {
        points.push(at(r, -r + 2.0 * r * i as f64 / steps as f64));
    }
    for i in 1..=steps {
        points.push(at(r - 2.0 * r * i as f64 / steps as f64, r));
    }
    for i in 1..=steps {
        points.push(at(-r, r - 2.0 * r * i as f64 / steps as f64));
    }
    points
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

fn ids(found: &[veloqrs::FfiNearbySectionSummary]) -> Vec<&str> {
    found.iter().map(|s| s.id.as_str()).collect()
}

/// A 200 m stub at the origin, the section whose detail screen is open.
fn query_section(s: &mut Setup) -> String {
    draw(s, "Query", "Ride", eastward(0.0, 0.0, 20))
}

#[test]
fn a_long_section_running_alongside_is_near_however_far_its_midpoint_is() {
    let mut s = setup();
    let query = query_section(&mut s);
    // 3 km east from the origin, 50 m to the north. Its midpoint is 1.5 km
    // away, so the midpoint measure called it distant.
    let alongside = draw(&mut s, "Alongside", "Ride", eastward(50.0, 0.0, 301));

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    assert_eq!(ids(&found), vec![alongside.as_str()]);
}

#[test]
fn a_loop_around_the_query_section_is_not_near_it() {
    let mut s = setup();
    let query = query_section(&mut s);
    // The nearest point of the ring is 610 m from the far end of the query
    // stub, and its bounds midpoint is the origin, so the midpoint measure
    // called it 95 m away and drew it.
    draw(&mut s, "Ring", "Ride", ring(800.0));

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    assert!(found.is_empty(), "returned {:?}", ids(&found));
}

#[test]
fn a_section_past_the_radius_in_every_direction_is_not_near() {
    let mut s = setup();
    let query = query_section(&mut s);
    draw(&mut s, "Away", "Ride", eastward(5_000.0, 0.0, 20));

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    assert!(found.is_empty(), "returned {:?}", ids(&found));
}

#[test]
fn the_query_section_is_never_its_own_neighbour() {
    let mut s = setup();
    let query = query_section(&mut s);

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    assert!(found.is_empty(), "returned {:?}", ids(&found));
}

#[test]
fn a_ride_section_does_not_draw_the_swim_and_run_sections_beside_it() {
    let mut s = setup();
    let query = query_section(&mut s);
    draw(&mut s, "Run", "Run", eastward(100.0, 0.0, 20));
    draw(&mut s, "Swim", "OpenWaterSwim", eastward(-100.0, 0.0, 20));
    draw(&mut s, "Walk", "Hike", eastward(150.0, 0.0, 20));

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    assert!(found.is_empty(), "returned {:?}", ids(&found));
}

#[test]
fn a_neighbour_in_the_same_family_under_another_label_is_kept() {
    let mut s = setup();
    let query = query_section(&mut s);
    let virtual_ride = draw(&mut s, "Trainer", "VirtualRide", eastward(100.0, 0.0, 20));
    let gravel = draw(&mut s, "Gravel", "GravelRide", eastward(-100.0, 0.0, 20));

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    let mut got = ids(&found);
    got.sort();
    let mut want = vec![virtual_ride.as_str(), gravel.as_str()];
    want.sort();
    assert_eq!(got, want);
}

#[test]
fn a_sport_in_no_family_answers_only_for_its_own_sport() {
    let mut s = setup();
    let query = draw(&mut s, "Unicycle", "Unicycle", eastward(0.0, 0.0, 20));
    let same = draw(&mut s, "Another", "Unicycle", eastward(100.0, 0.0, 20));
    draw(&mut s, "Ride", "Ride", eastward(-100.0, 0.0, 20));

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    assert_eq!(ids(&found), vec![same.as_str()]);
}

#[test]
fn neighbours_come_back_nearest_first() {
    let mut s = setup();
    let query = query_section(&mut s);
    let far = draw(&mut s, "Far", "Ride", eastward(400.0, 0.0, 20));
    let near = draw(&mut s, "Near", "Ride", eastward(60.0, 0.0, 20));
    let middle = draw(&mut s, "Middle", "Ride", eastward(200.0, 0.0, 20));

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    assert_eq!(
        ids(&found),
        vec![near.as_str(), middle.as_str(), far.as_str()]
    );
}

#[test]
fn a_disabled_neighbour_is_not_drawn() {
    let mut s = setup();
    let query = query_section(&mut s);
    let hidden = draw(&mut s, "Hidden", "Ride", eastward(100.0, 0.0, 20));
    s.engine.disable_section(&hidden).expect("disable");

    let found = s.engine.get_nearby_sections(&query, RADIUS);
    assert!(found.is_empty(), "returned {:?}", ids(&found));
}
