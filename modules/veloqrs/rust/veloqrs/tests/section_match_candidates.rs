//! Matching a custom section against the library must not decode every track
//! in it. The matcher already refuses any track whose points miss the line's
//! padded bounds, but it refuses them after the decode, so the cost is paid
//! for every activity the athlete owns. The bounds are already in memory and
//! already indexed, so the same refusal can happen before the read.
//!
//! Run: `cargo test --test section_match_candidates -p veloqrs`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

struct Setup {
    engine: PersistentEngine,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("candidates.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    Setup { engine, _tmp: tmp }
}

/// Twenty points ~55 m apart along a meridian, anchored wherever asked.
fn ride_at(lat: f64, lng: f64) -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint::new(lat + i as f64 * 0.0005, lng))
        .collect()
}

fn add(s: &mut Setup, id: &str, track: Vec<GpsPoint>) {
    s.engine
        .add_activity(id.to_string(), track, "Ride".to_string())
        .expect("add activity");
}

#[test]
fn a_ride_on_the_line_is_a_candidate() {
    let mut s = setup();
    add(&mut s, "on_it", ride_at(46.0, 7.0));

    let near = s.engine.activities_near_polyline(
        &ride_at(46.0, 7.0),
        s.engine.section_config_proximity_threshold(),
    );
    assert_eq!(near, vec!["on_it".to_string()]);
}

#[test]
fn a_ride_in_another_valley_is_not_read_at_all() {
    let mut s = setup();
    add(&mut s, "on_it", ride_at(46.0, 7.0));
    add(&mut s, "far", ride_at(47.5, 9.0));

    let near = s.engine.activities_near_polyline(
        &ride_at(46.0, 7.0),
        s.engine.section_config_proximity_threshold(),
    );
    assert_eq!(
        near,
        vec!["on_it".to_string()],
        "the far ride was a candidate"
    );
}

/// A ride that runs beside the line rather than on it still has to be read:
/// the matcher's own bound is the proximity threshold, so anything inside it
/// is the matcher's call to make, not the prefilter's.
#[test]
fn a_ride_just_off_the_line_is_still_a_candidate() {
    let mut s = setup();
    let pad = 50.0;
    // Half the pad east, in degrees of longitude at 46 N.
    let offset = (pad / 2.0) / (111_320.0 * 46.0_f64.to_radians().cos());
    add(&mut s, "beside", ride_at(46.0, 7.0 + offset));

    let near = s.engine.activities_near_polyline(&ride_at(46.0, 7.0), pad);
    assert_eq!(near, vec!["beside".to_string()]);
}

/// The pad is what separates the two. The same ride is a candidate against a
/// generous threshold and not against a mean one.
#[test]
fn the_pad_is_what_decides_the_edge() {
    let mut s = setup();
    let offset = 400.0 / (111_320.0 * 46.0_f64.to_radians().cos());
    add(&mut s, "beside", ride_at(46.0, 7.0 + offset));

    let line = ride_at(46.0, 7.0);
    assert_eq!(s.engine.activities_near_polyline(&line, 1_000.0).len(), 1);
    assert!(s.engine.activities_near_polyline(&line, 100.0).is_empty());
}

#[test]
fn an_empty_line_has_no_candidates() {
    let mut s = setup();
    add(&mut s, "on_it", ride_at(46.0, 7.0));

    assert!(s.engine.activities_near_polyline(&[], 1_000.0).is_empty());
}

/// The prefilter must not change what matches. A section cut from one ride,
/// with a second ride on the same road and a third in another country, still
/// attaches exactly the two.
#[test]
fn the_prefilter_does_not_change_what_matches() {
    let mut s = setup();
    let ride = ride_at(46.0, 7.0);
    add(&mut s, "source", ride.clone());
    add(&mut s, "same_road", ride.clone());
    add(&mut s, "elsewhere", ride_at(-33.8, 151.2));

    let slice = ride[4..=12].to_vec();
    let id = s
        .engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: slice.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&slice),
            name: Some("Home climb".to_string()),
            source_activity_id: Some("source".to_string()),
            start_index: Some(4),
            end_index: Some(12),
        })
        .expect("create section");

    let section = s.engine.get_section(&id).expect("section");
    let mut attached = section.activity_ids.clone();
    attached.sort();
    assert_eq!(
        attached,
        vec!["same_road".to_string(), "source".to_string()]
    );
}
