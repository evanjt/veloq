//! Scenario: the athlete taps the heatmap and the engine names the activities
//! whose tracks pass under the finger.
//!
//! Expected behaviour: a track counts when one of its segments comes within a
//! fingertip of the tap at the tap's zoom, never when only its bounding box
//! does; a hidden activity is absent; one track is decoded at a time; the
//! answer groups the hits by route, newest first, under a cap.

use std::collections::HashSet;
use std::sync::Arc;

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::persistence::tiles::HeatmapSource;
use crate::persistence::under_point::{
    MAX_ACTIVITIES, MAX_TRACES, answer, buffer_metres, clip_and_simplify, clip_radius_metres,
    query, traces,
};

const TAP: (f64, f64) = (46.2, 7.35);
const METRES_PER_DEGREE: f64 = 111_320.0;

fn tap() -> GpsPoint {
    GpsPoint::new(TAP.0, TAP.1)
}

fn east_of_tap(metres: f64) -> f64 {
    TAP.1 + metres / (METRES_PER_DEGREE * TAP.0.to_radians().cos())
}

fn north_of_tap(metres: f64) -> f64 {
    TAP.0 + metres / METRES_PER_DEGREE
}

/// A north-south line `east_metres` east of the tap, through its latitude.
fn passing(east_metres: f64, points: u32) -> Vec<GpsPoint> {
    let lng = east_of_tap(east_metres);
    (0..points)
        .map(|i| {
            let t = f64::from(i) / f64::from(points - 1);
            GpsPoint::new(north_of_tap(-2_000.0 + 4_000.0 * t), lng)
        })
        .collect()
}

/// Four corners 900 m from the tap: its bounding box holds the tap and no
/// segment comes near it.
fn ring_around(metres: f64) -> Vec<GpsPoint> {
    let corner = |north: f64, east: f64| GpsPoint::new(north_of_tap(north), east_of_tap(east));
    vec![
        corner(-metres, -metres),
        corner(-metres, metres),
        corner(metres, metres),
        corner(metres, -metres),
        corner(-metres, -metres),
    ]
}

fn metrics(id: &str, date: i64) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: id.to_string(),
        name: format!("ride {id}"),
        date,
        distance: 10_000.0,
        moving_time: 1_800,
        elapsed_time: 1_900,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

fn store(engine: &mut PersistentEngine, id: &str, date: i64, track: Vec<GpsPoint>) {
    engine
        .add_activity(id.to_string(), track, "Ride".to_string())
        .expect("activity stored");
    engine
        .set_activity_metrics(vec![metrics(id, date)])
        .expect("metrics stored");
}

fn source_of(engine: &PersistentEngine) -> HeatmapSource {
    HeatmapSource {
        dir: String::new(),
        db_path: engine.db_path.clone(),
        bounds: Arc::clone(&engine.spatial_index),
        hidden: Arc::clone(&engine.heatmap_hidden),
    }
}

fn ids(hits: &[crate::persistence::under_point::Hit]) -> Vec<&str> {
    let mut ids: Vec<&str> = hits.iter().map(|h| h.activity_id.as_str()).collect();
    ids.sort_unstable();
    ids
}

#[test]
fn the_buffer_is_a_fingertip_at_the_zoom_clamped_to_fifteen_and_a_hundred_and_fifty_metres() {
    let at_14 = buffer_metres(TAP.0, 14);
    assert!(
        (30.0..50.0).contains(&at_14),
        "12 px of a 512 px tile at zoom 14 and 46 degrees is about 40 m, got {at_14}"
    );
    assert_eq!(buffer_metres(TAP.0, 5), 150.0);
    assert_eq!(buffer_metres(TAP.0, 18), 15.0);
}

/// Scenario: three tracks share a map cell. One passes 5 m from the tap, one
/// is a loop whose box holds the tap while its nearest segment is 900 m off,
/// and one passes straight over the tap but the athlete hid it.
///
/// Expected behaviour: at zoom 14 only the first answers.
#[test]
fn a_track_counts_by_its_nearest_segment_and_a_hidden_one_is_absent() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "near", 1_700_000_000, passing(5.0, 40));
    store(&mut engine, "loop", 1_700_000_100, ring_around(900.0));
    store(&mut engine, "hidden", 1_700_000_200, passing(0.0, 40));
    engine
        .set_heatmap_hidden("hidden", true)
        .expect("hidden stored");

    let hits = query(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(ids(&hits), ["near"]);
    assert!(
        (hits[0].nearest_m - 5.0).abs() < 1.0,
        "nearest approach was {}",
        hits[0].nearest_m
    );
}

#[test]
fn a_track_sixty_metres_off_hits_at_zoom_twelve_and_not_at_zoom_sixteen() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "off", 1_700_000_000, passing(60.0, 40));
    let source = source_of(&engine);

    assert_eq!(ids(&query(&source, &engine.db, tap(), 12)), ["off"]);
    assert!(query(&source, &engine.db, tap(), 16).is_empty());
}

#[test]
fn a_segment_between_two_far_points_hits_when_no_point_is_near() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    // Two points a kilometre either side of the tap: the line between them
    // crosses it and neither point is within the buffer.
    let across = vec![
        GpsPoint::new(north_of_tap(-1_000.0), east_of_tap(3.0)),
        GpsPoint::new(north_of_tap(1_000.0), east_of_tap(3.0)),
    ];
    store(&mut engine, "across", 1_700_000_000, across);

    let hits = query(&source_of(&engine), &engine.db, tap(), 16);

    assert_eq!(ids(&hits), ["across"]);
}

#[test]
fn an_unreadable_stored_track_is_left_out_and_the_rest_answer() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "good", 1_700_000_000, passing(5.0, 40));
    store(&mut engine, "bad", 1_700_000_100, passing(5.0, 40));
    engine
        .db
        .execute(
            "UPDATE gps_tracks SET track_data = X'FF' WHERE activity_id = 'bad'",
            [],
        )
        .expect("corrupted");

    let hits = query(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(ids(&hits), ["good"]);
}

/// Scenario: 1,200 tracks pass the tap, one of them four hundred points long
/// and the rest ten.
///
/// Expected behaviour: the most points held decoded at once is the longest
/// single track, not a chunk of the candidates.
#[test]
fn the_decode_holds_one_track_at_a_time() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let batch: Vec<(String, Vec<GpsPoint>, String)> = (0..1_200)
        .map(|i| {
            let points = if i == 700 { 400 } else { 10 };
            (format!("a{i}"), passing(2.0, points), "Ride".to_string())
        })
        .collect();
    engine.add_activities_batch(batch).expect("stored");
    let longest = crate::persistence::activities::pooled::gps_track(&engine.db, "a700")
        .expect("stored track")
        .len();
    crate::tiles::work::take_peak_decoded();

    let hits = query(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(hits.len(), 1_200);
    assert_eq!(crate::tiles::work::take_peak_decoded(), longest);
}

fn add_route(engine: &PersistentEngine, id: &str, members: &[String]) {
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count, bounds_min_lat, bounds_max_lat,
                                       bounds_min_lng, bounds_max_lng)
             VALUES (?1, ?2, ?3, 'Ride', ?4, 46.0, 46.4, 7.0, 7.6)",
            params![
                id,
                members[0],
                serde_json::to_string(members).unwrap(),
                members.len() as i64
            ],
        )
        .expect("group stored");
    for member in members {
        engine
            .db
            .execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                 VALUES (?1, ?2, 95.0, 'same')",
                params![id, member],
            )
            .expect("match stored");
    }
}

/// Scenario: 600 activities pass the tap: 250 in one route, 200 in another
/// and 150 in none, dated round-robin so each group spans the whole period.
///
/// Expected behaviour: two route groups by size, then the one-offs; 500
/// activities in all and they are the newest 500; `truncated` is set and
/// `total` is 600; each group lists its own newest first.
#[test]
fn six_hundred_hits_answer_two_routes_then_the_one_offs_capped_to_the_newest_five_hundred() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let mut members: [Vec<String>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    let mut dates = Vec::new();
    let mut batch = Vec::new();
    let mut all_metrics = Vec::new();
    for i in 0..600usize {
        let bucket = match i % 12 {
            0..=4 => 0,
            5..=8 => 1,
            _ => 2,
        };
        let id = format!("a{i}");
        let date = 1_700_000_000 + i as i64 * 60;
        batch.push((id.clone(), passing(3.0, 12), "Ride".to_string()));
        all_metrics.push(metrics(&id, date));
        dates.push((date, id.clone()));
        members[bucket].push(id);
    }
    assert_eq!(
        [members[0].len(), members[1].len(), members[2].len()],
        [250, 200, 150]
    );
    engine.add_activities_batch(batch).expect("stored");
    engine.set_activity_metrics(all_metrics).expect("metrics");
    add_route(&engine, "big", &members[0]);
    add_route(&engine, "small", &members[1]);
    engine
        .db
        .execute(
            "INSERT INTO route_names (route_id, custom_name) VALUES ('big', 'Lake loop')",
            [],
        )
        .expect("name");
    engine
        .db
        .execute(
            "INSERT INTO route_numbers (route_id, number) VALUES ('small', 7)",
            [],
        )
        .expect("number");

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(found.total, 600);
    assert_eq!(found.trace_cap as usize, MAX_TRACES);
    assert!(found.truncated);
    let route_ids: Vec<Option<&str>> = found.groups.iter().map(|g| g.route_id.as_deref()).collect();
    assert_eq!(route_ids, [Some("big"), Some("small"), None]);
    assert_eq!(found.groups[0].name.as_deref(), Some("Lake loop"));
    assert_eq!(found.groups[1].name, None);
    assert_eq!(found.groups[1].number, Some(7));
    assert_eq!(
        found.groups.iter().map(|g| g.count).collect::<Vec<_>>(),
        [250, 200, 150]
    );
    let listed: Vec<_> = found.groups.iter().flat_map(|g| &g.activities).collect();
    assert_eq!(listed.len(), MAX_ACTIVITIES);
    let kept: HashSet<&str> = listed.iter().map(|a| a.id.as_str()).collect();
    dates.sort();
    for (_, id) in &dates[100..] {
        assert!(kept.contains(id.as_str()), "{id} is among the newest 500");
    }
    for group in &found.groups {
        assert!(
            group.activities.windows(2).all(|w| w[0].date >= w[1].date),
            "a group is not newest first"
        );
    }
    assert!(
        listed
            .iter()
            .all(|a| a.nearest_m < 5.0 && a.duration == 1_800),
        "a row lost its distance or its metrics"
    );
}

#[test]
fn a_tap_with_nothing_under_it_answers_an_empty_result() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "far", 1_700_000_000, passing(900.0, 40));

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(found, crate::ffi_types::FfiActivitiesUnderPoint::default());
}

#[test]
fn an_activity_with_no_route_and_no_metrics_row_is_not_listed() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .add_activity("bare".into(), passing(3.0, 12), "Ride".into())
        .expect("stored");
    store(&mut engine, "dated", 1_700_000_000, passing(3.0, 12));

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(found.total, 1);
    assert_eq!(found.groups.len(), 1);
    assert_eq!(found.groups[0].activities[0].id, "dated");
}

/// Scenario: the athlete taps while a sync holds the engine for writing.
///
/// Expected behaviour: the read answers from the heatmap's shared source and a
/// read connection, with no wait for the writer; with the heatmap off it
/// answers an empty result, not an error.
mod published_source {
    use super::*;
    use crate::persistence::tiles::publish_heatmap_source;
    use crate::persistence::under_point::activities_under_point;
    use crate::persistence::with_persistent_engine;
    use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

    #[test]
    fn a_closed_heatmap_answers_an_empty_result() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("under-point-closed.db");
        with_persistent_engine(|e| store(e, "near", 1_700_000_000, passing(5.0, 40)))
            .expect("engine");
        publish_heatmap_source(None);

        let found = activities_under_point(TAP.0, TAP.1, 14).expect("an empty answer");

        assert_eq!(found, crate::ffi_types::FfiActivitiesUnderPoint::default());
    }

    #[test]
    fn an_open_heatmap_answers_the_activities_under_the_tap_without_the_engine_lock() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("under-point-open.db");
        with_persistent_engine(|e| {
            store(e, "near", 1_700_000_000, passing(5.0, 40));
            store(e, "loop", 1_700_000_100, ring_around(900.0));
            publish_heatmap_source(Some(source_of(e)));
        })
        .expect("engine");

        let found = read_while_writer_holds(|| activities_under_point(TAP.0, TAP.1, 14));
        publish_heatmap_source(None);

        let found = found.expect("an answer");
        assert_eq!(found.total, 1);
        assert_eq!(found.groups[0].activities[0].id, "near");
    }

    #[test]
    fn a_tap_that_is_not_a_coordinate_answers_nothing() {
        let found = activities_under_point(f64::NAN, TAP.1, 14).expect("an empty answer");

        assert_eq!(found, crate::ffi_types::FfiActivitiesUnderPoint::default());
    }
}

/// Metres from the tap on the flat plane the clip is made on, which takes a
/// degree of latitude as 111 km.
fn metres_from_tap(point: &GpsPoint) -> f64 {
    const CLIP_METRES_PER_DEGREE: f64 = 111_000.0;
    let north = (point.latitude - TAP.0) * CLIP_METRES_PER_DEGREE;
    let east = (point.longitude - TAP.1) * CLIP_METRES_PER_DEGREE * TAP.0.to_radians().cos();
    north.hypot(east)
}

fn at(north: f64, east: f64) -> GpsPoint {
    GpsPoint::new(north_of_tap(north), east_of_tap(east))
}

/// Scenario: a route of 30 activities passes the tap beside two one-offs.
///
/// Expected behaviour: the route's group answers the newest 25 as lines inside
/// the clip circle with fewer points than the stored tracks; the no-route
/// group answers the two one-offs; a group that is not there answers nothing;
/// a hidden member is absent.
#[test]
fn a_group_answers_its_newest_traces_clipped_to_the_circle_and_simplified() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let mut members = Vec::new();
    for i in 0..30i64 {
        let id = format!("m{i}");
        store(&mut engine, &id, 1_700_000_000 + i * 60, passing(3.0, 200));
        members.push(id);
    }
    store(&mut engine, "solo-a", 1_700_100_000, passing(3.0, 200));
    store(&mut engine, "solo-b", 1_700_100_060, passing(3.0, 200));
    add_route(&engine, "loop", &members);
    engine
        .set_heatmap_hidden("m29", true)
        .expect("hidden stored");
    let source = source_of(&engine);
    let radius = clip_radius_metres(TAP.0, 14);

    let route = traces(&source, &engine.db, tap(), 14, Some("loop"));

    assert_eq!(route.len(), MAX_TRACES);
    let expected: Vec<String> = (4..29).rev().map(|i| format!("m{i}")).collect();
    let got: Vec<&str> = route.iter().map(|t| t.activity_id.as_str()).collect();
    assert_eq!(got, expected.iter().map(String::as_str).collect::<Vec<_>>());
    for trace in &route {
        assert_eq!(trace.lines.len(), 1);
        let line = &trace.lines[0];
        assert!(line.len() >= 2 && line.len() < 200, "{} points", line.len());
        assert!(
            line.iter().all(|p| metres_from_tap(p) <= radius + 1.0),
            "a point lies outside the circle of {radius} m"
        );
    }
    let ones = traces(&source, &engine.db, tap(), 14, None);
    let mut one_ids: Vec<&str> = ones.iter().map(|t| t.activity_id.as_str()).collect();
    one_ids.sort_unstable();
    assert_eq!(one_ids, ["solo-a", "solo-b"]);
    assert!(traces(&source, &engine.db, tap(), 14, Some("absent")).is_empty());
}

/// Scenario: a track crosses the circle, leaves it and crosses it again.
///
/// Expected behaviour: two lines, each ending on the circle where the track
/// crossed it, and a track that never comes inside gives none.
#[test]
fn a_track_that_leaves_and_re_enters_the_circle_is_two_lines() {
    let radius = clip_radius_metres(TAP.0, 14);
    let track = [
        at(-2.0 * radius, 0.0),
        at(2.0 * radius, 0.0),
        at(2.0 * radius, 0.5 * radius),
        at(-2.0 * radius, 0.5 * radius),
    ];

    let lines = clip_and_simplify(&track, &tap(), radius, 1.0);

    assert_eq!(lines.len(), 2);
    for line in &lines {
        assert_eq!(line.len(), 2);
        for end in line {
            assert!(
                (metres_from_tap(end) - radius).abs() < 1.0,
                "an end is {} m from the tap, the circle is {radius} m",
                metres_from_tap(end)
            );
        }
    }
    let outside = [at(-radius, 3.0 * radius), at(radius, 3.0 * radius)];
    assert!(clip_and_simplify(&outside, &tap(), radius, 1.0).is_empty());
}

#[test]
fn simplifying_drops_vertices_within_the_tolerance_and_keeps_a_corner() {
    let radius = clip_radius_metres(TAP.0, 14);
    let wobble = [
        at(-100.0, 0.0),
        at(-50.0, 0.4),
        at(0.0, 0.0),
        at(50.0, 0.4),
        at(100.0, 0.0),
        at(100.0, 200.0),
    ];

    let lines = clip_and_simplify(&wobble, &tap(), radius, 1.0);

    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].len(), 3, "the ends and the corner stay");
}
