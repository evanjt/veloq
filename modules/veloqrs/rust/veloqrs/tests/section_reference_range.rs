//! Re-pointing a custom section at another activity.
//!
//! `sections.start_index`/`end_index` are the range the athlete drew, and the
//! map writes them inclusive. Reading them half-open cuts a line one point
//! short of the one they drew, and the loss compounds over re-points.
//!
//! Run: `cargo test --test section -p veloqrs -- section_reference_range::`

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

    let second = track(20, 7.00001);
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
    for (activity, lng) in [("act_b", 7.00001), ("act_c", 7.00002)] {
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

    let second = track(20, 7.00001);
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

/// Expected behaviour: a stream that stops short of the drawn ground is
/// refused rather than clamped, since the clamped line is not the drawn one.
#[test]
fn a_stream_that_stops_short_of_the_drawn_ground_is_refused() {
    let mut s = setup();
    let id = cut(&mut s, "act_long", track(20, 7.0), 12, 19);

    s.engine
        .add_activity(
            "act_short".to_string(),
            track(15, 7.00001),
            "Ride".to_string(),
        )
        .expect("add short activity");
    assert!(s.engine.set_section_reference(&id, "act_short").is_err());

    let section = s.engine.get_section(&id).expect("section readable");
    assert_eq!(section.polyline.len(), 8, "the drawn line was altered");
}

/// `count` points ~55 m apart along a meridian, from `lat0`.
fn track_from(lat0: f64, count: usize, lng: f64) -> Vec<GpsPoint> {
    (0..count)
        .map(|i| GpsPoint::new(lat0 + i as f64 * 0.0005, lng))
        .collect()
}

fn stored_range(s: &Setup) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    s._raw
        .query_row(
            "SELECT start_index, end_index, rep_start_index, rep_end_index FROM sections LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("section row")
}

/// Scenario: the second ride reaches the drawn stretch later in its stream, so
/// the indices of the first ride point at different ground.
/// Expected behaviour: the line is the drawn ground as the second ride rode it.
#[test]
fn re_pointing_follows_the_ground_not_the_indices() {
    let mut s = setup();
    let first = track_from(46.0, 40, 7.0);
    let id = cut(&mut s, "act_first", first.clone(), 10, 20);

    let second = track_from(45.99, 70, 7.0);
    s.engine
        .add_activity("act_second".to_string(), second.clone(), "Ride".to_string())
        .expect("add second activity");
    s.engine
        .set_section_reference(&id, "act_second")
        .expect("re-point the section");

    let section = s.engine.get_section(&id).expect("section readable");
    let drawn = &first[10..=20];
    let first_lat = section.polyline.first().unwrap().latitude;
    let last_lat = section.polyline.last().unwrap().latitude;
    assert!(
        (first_lat - drawn[0].latitude).abs() < 0.0011,
        "line starts at {first_lat}, drawn ground starts at {}",
        drawn[0].latitude
    );
    assert!(
        (last_lat - drawn[10].latitude).abs() < 0.0011,
        "line ends at {last_lat}, drawn ground ends at {}",
        drawn[10].latitude
    );

    let (start, end, rep_start, rep_end) = stored_range(&s);
    let (start, end) = (start.unwrap(), end.unwrap());
    assert!(
        (28..=32).contains(&start),
        "start index {start} still names the first ride's cut"
    );
    assert_eq!(rep_start, Some(start), "rep triple start");
    assert_eq!(rep_end, Some(end + 1), "rep triple end is half-open");
    assert!(
        (10..=12).contains(&(end - start)),
        "range {start}..={end} is not the drawn 11 points"
    );
    let rep_id: String = s
        ._raw
        .query_row(
            "SELECT representative_activity_id FROM sections LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rep_id, "act_second");

    let rows: i64 = s
        ._raw
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = ? AND activity_id = 'act_second'",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, 1, "one row per pass of the new reference");
    let zero_rows: i64 = s
        ._raw
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = ? AND distance_meters = 0",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(zero_rows, 0, "no zero-length visit");
}

/// Expected behaviour: the drawn line is kept in the backup so a reset can
/// bring it back.
#[test]
fn re_pointing_backs_up_the_drawn_line() {
    let mut s = setup();
    let id = cut(&mut s, "act_first", track_from(46.0, 40, 7.0), 10, 20);
    let drawn = s
        .engine
        .get_section(&id)
        .expect("section readable")
        .polyline;
    s.engine
        .add_activity(
            "act_second".to_string(),
            track_from(45.99, 70, 7.0),
            "Ride".to_string(),
        )
        .expect("add second activity");
    s.engine
        .set_section_reference(&id, "act_second")
        .expect("re-point the section");

    assert!(
        s.engine.has_original_bounds(&id),
        "no backup of the drawn line"
    );
    let backup: Vec<u8> = s
        ._raw
        .query_row(
            "SELECT original_polyline_blob FROM sections WHERE id = ?",
            [&id],
            |row| row.get(0),
        )
        .expect("the drawn line is backed up as a blob");
    assert_eq!(
        veloqrs::persistence::codec::deserialize_points(&backup).unwrap(),
        drawn
    );
}

/// Expected behaviour: a ride that never covers the drawn ground is refused
/// and the section is untouched.
#[test]
fn a_ride_elsewhere_is_refused_and_leaves_the_section_alone() {
    let mut s = setup();
    let first = track_from(46.0, 40, 7.0);
    let id = cut(&mut s, "act_first", first.clone(), 10, 20);
    let before = s
        .engine
        .get_section(&id)
        .expect("section readable")
        .polyline;

    s.engine
        .add_activity(
            "act_elsewhere".to_string(),
            track_from(47.0, 5, 8.0),
            "Ride".to_string(),
        )
        .expect("add other activity");
    let refused = s.engine.set_section_reference(&id, "act_elsewhere");
    assert!(refused.is_err(), "a ride off the line became its reference");

    let after = s
        .engine
        .get_section(&id)
        .expect("section readable")
        .polyline;
    assert_close(&after, &before);
    assert_eq!(stored_range(&s).0, Some(10));
    let rows: i64 = s
        ._raw
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = ? AND activity_id = 'act_elsewhere'",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, 0);
}

/// Scenario: an auto section re-pointed at another ride.
/// Expected behaviour: the line is the pass as a half-open slice of the new
/// stream, and the rep triple names that slice.
#[test]
fn re_pointing_an_auto_section_cuts_the_pass_and_writes_the_rep_triple() {
    let mut s = setup();
    let first = track_from(46.0, 40, 7.0);
    s.engine
        .add_activity("act_first".to_string(), first.clone(), "Ride".to_string())
        .expect("add first activity");
    let drawn = first[10..=20].to_vec();
    let blob = veloqrs::persistence::codec::serialize_track_points(&drawn);
    s._raw
        .execute(
            "INSERT INTO sections
                 (id, name, sport_type, section_type, polyline_blob, distance_meters,
                  visit_count, created_at, source_activity_id, start_index, end_index,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('auto1', 'Auto 1', 'Ride', 'auto', ?, ?, 1, datetime('now'),
                     'act_first', 10, 20, 0, 0, 0, 0)",
            rusqlite::params![blob, tracematch::matching::calculate_route_distance(&drawn)],
        )
        .expect("seed the auto section");

    let second = track_from(45.99, 70, 7.0);
    s.engine
        .add_activity("act_second".to_string(), second, "Ride".to_string())
        .expect("add second activity");
    s.engine
        .set_section_reference("auto1", "act_second")
        .expect("re-point the section");

    let (rep_start, rep_end, source): (Option<i64>, Option<i64>, Option<String>) = s
        ._raw
        .query_row(
            "SELECT rep_start_index, rep_end_index, geometry_source FROM sections WHERE id = 'auto1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    let (rep_start, rep_end) = (rep_start.expect("rep start"), rep_end.expect("rep end"));
    assert!(source.is_some(), "geometry source not written");

    let line = s
        .engine
        .get_section("auto1")
        .expect("section readable")
        .polyline;
    assert_eq!(
        line.len() as i64,
        rep_end - rep_start,
        "line is not the half-open slice the triple names"
    );
    assert!(
        (10..=12).contains(&(rep_end - rep_start - 1)),
        "pass of {} points is not the drawn 11",
        rep_end - rep_start
    );
}
