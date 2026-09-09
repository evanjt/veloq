//! Re-pointing a custom section at another activity.
//!
//! `sections.start_index`/`end_index` are the range the athlete drew, and the
//! map writes them inclusive. Reading them half-open cuts a line one point
//! short of the one they drew, and the loss compounds over re-points.
//!
//! Run: `cargo test --test section_reference_range -p veloqrs`

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

struct Setup {
    engine: PersistentEngine,
    _raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("reference.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    let _raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        _raw,
        _tmp: tmp,
    }
}

/// `count` points ~55 m apart along a meridian, `lng` apart from the others.
fn track(count: usize, lng: f64) -> Vec<GpsPoint> {
    (0..count)
        .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0005, lng))
        .collect()
}

fn assert_close(points: &[GpsPoint], expected: &[GpsPoint]) {
    assert_eq!(points.len(), expected.len(), "polyline length mismatch");
    for (got, want) in points.iter().zip(expected) {
        assert!(
            (got.latitude - want.latitude).abs() < 1e-9
                && (got.longitude - want.longitude).abs() < 1e-9,
            "point mismatch: {:?} vs {:?}",
            got,
            want
        );
    }
}

fn cut(s: &mut Setup, activity_id: &str, points: Vec<GpsPoint>, start: u32, end: u32) -> String {
    s.engine
        .add_activity(activity_id.to_string(), points.clone(), "Ride".to_string())
        .expect("add activity");
    let slice = points[start as usize..=end as usize].to_vec();
    s.engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: slice.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&slice),
            name: Some("Home climb".to_string()),
            source_activity_id: Some(activity_id.to_string()),
            start_index: Some(start),
            end_index: Some(end),
        })
        .expect("create section")
}

#[test]
fn re_pointing_keeps_every_point_of_the_drawn_range() {
    let mut s = setup();
    let id = cut(&mut s, "act_first", track(20, 7.0), 4, 12);

    let second = track(20, 7.001);
    s.engine
        .add_activity("act_second".to_string(), second.clone(), "Ride".to_string())
        .expect("add second activity");
    s.engine
        .set_section_reference(&id, "act_second")
        .expect("re-point the section");

    let section = s.engine.get_section(&id).expect("section readable");
    assert_close(&section.polyline, &second[4..=12]);
}

/// The line must not shrink by a point on every re-point.
#[test]
fn re_pointing_twice_does_not_shorten_the_line() {
    let mut s = setup();
    let id = cut(&mut s, "act_a", track(20, 7.0), 4, 12);
    for (activity, lng) in [("act_b", 7.001), ("act_c", 7.002)] {
        s.engine
            .add_activity(activity.to_string(), track(20, lng), "Ride".to_string())
            .expect("add activity");
        s.engine
            .set_section_reference(&id, activity)
            .expect("re-point the section");
    }

    let section = s.engine.get_section(&id).expect("section readable");
    assert_eq!(
        section.polyline.len(),
        9,
        "the line lost points on re-point"
    );
}

/// The last index of the stream is the boundary the half-open read gets wrong
/// most quietly, since there is nothing after it to notice missing.
#[test]
fn re_pointing_a_whole_ride_cut_keeps_the_final_point() {
    let mut s = setup();
    let first = track(20, 7.0);
    let id = cut(&mut s, "act_whole", first.clone(), 0, 19);

    let second = track(20, 7.001);
    s.engine
        .add_activity(
            "act_whole_b".to_string(),
            second.clone(),
            "Ride".to_string(),
        )
        .expect("add second activity");
    s.engine
        .set_section_reference(&id, "act_whole_b")
        .expect("re-point the section");

    let section = s.engine.get_section(&id).expect("section readable");
    assert_close(&section.polyline, &second);
}

/// A range that runs off the end of the shorter stream is clamped, not
/// refused, and the clamp takes everything that is there.
#[test]
fn a_range_past_the_end_of_a_shorter_stream_is_clamped() {
    let mut s = setup();
    let id = cut(&mut s, "act_long", track(20, 7.0), 4, 19);

    let short = track(15, 7.001);
    s.engine
        .add_activity("act_short".to_string(), short.clone(), "Ride".to_string())
        .expect("add short activity");
    s.engine
        .set_section_reference(&id, "act_short")
        .expect("re-point the section");

    let section = s.engine.get_section(&id).expect("section readable");
    assert_close(&section.polyline, &short[4..]);
}
