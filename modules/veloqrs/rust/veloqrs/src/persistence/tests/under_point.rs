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

use crate::ffi_types::FfiUnderPointKind;
use crate::persistence::tiles::HeatmapSource;
use crate::persistence::under_point::{
    Group, MAX_ACTIVITIES, MAX_TRACES, answer, buffer_metres, clip_and_simplify,
    clip_radius_metres, query, traces,
};
use crate::persistence::{PersistentEngine, codec};

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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_track_sixty_metres_off_hits_at_zoom_twelve_and_not_at_zoom_sixteen() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "off", 1_700_000_000, passing(60.0, 40));
    let source = source_of(&engine);

    assert_eq!(ids(&query(&source, &engine.db, tap(), 12)), ["off"]);
    assert!(query(&source, &engine.db, tap(), 16).is_empty());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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

    crate::tiles::work::take_figure_reads();
    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(
        crate::tiles::work::take_figure_reads(),
        2,
        "one figures read per route group, none for the one-offs"
    );
    assert_eq!(found.total, 600);
    assert_eq!(found.trace_cap as usize, MAX_TRACES);
    assert!(found.truncated);
    let route_ids: Vec<Option<&str>> = found.groups.iter().map(|g| g.id.as_deref()).collect();
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_tap_with_nothing_under_it_answers_an_empty_result() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "far", 1_700_000_000, passing(900.0, 40));

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(found, crate::ffi_types::FfiActivitiesUnderPoint::default());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tap_that_is_not_a_coordinate_answers_nothing() {
        let found = activities_under_point(f64::NAN, TAP.1, 14).expect("an empty answer");

        assert_eq!(found, crate::ffi_types::FfiActivitiesUnderPoint::default());
    }

    /// Scenario: the sheet lists a section group and the athlete chooses it, so
    /// the map asks `veloq-geo` for the key the phone builds for that group.
    ///
    /// Expected behaviour: the key names the section group the engine parses it
    /// as, the answer is the section's members newest first and never the
    /// activity that rode no section, and a section with no such members
    /// answers an empty collection.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_section_key_at_the_geo_path_answers_the_section_members() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("under-point-section-key.db");
        with_persistent_engine(|e| {
            route_section_and_loose(e);
            publish_heatmap_source(Some(source_of(e)));
        })
        .expect("engine");

        let answer = |group: &str| {
            crate::basemap::geo_answer(&format!("under-point/46200000_7350000_14_{group}"))
        };
        let feature_ids = |body: Vec<u8>| -> Vec<String> {
            let value: serde_json::Value = serde_json::from_slice(&body).expect("JSON");
            value["features"]
                .as_array()
                .expect("features")
                .iter()
                .map(|feature| feature["id"].as_str().expect("an id").to_string())
                .collect()
        };

        let climb = answer("section_climb").expect("a section key answers");
        let absent = answer("section_absent").expect("an absent section answers");
        publish_heatmap_source(None);

        assert_eq!(feature_ids(climb), ["section-b", "section-a", "route-a"]);
        assert!(feature_ids(absent).is_empty());
    }
}

/// Metres from the tap on the flat plane the clip is made on, which takes a
/// degree of latitude as the engine's shared figure.
fn metres_from_tap(point: &GpsPoint) -> f64 {
    const CLIP_METRES_PER_DEGREE: f64 = METRES_PER_DEGREE;
    let north = (point.latitude - TAP.0) * CLIP_METRES_PER_DEGREE;
    let east = (point.longitude - TAP.1) * CLIP_METRES_PER_DEGREE * TAP.0.to_radians().cos();
    north.hypot(east)
}

fn at(north: f64, east: f64) -> GpsPoint {
    GpsPoint::new(north_of_tap(north), east_of_tap(east))
}

/// Scenario: a route of more activities than the cap passes the tap beside two one-offs.
///
/// Expected behaviour: the route's group answers the newest `MAX_TRACES` as lines inside
/// the clip circle with fewer points than the stored tracks; the no-route
/// group answers the two one-offs; a group that is not there answers nothing;
/// a hidden member is absent.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_group_answers_its_newest_traces_clipped_to_the_circle_and_simplified() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let mut members = Vec::new();
    let members_count = MAX_TRACES as i64 + 5;
    for i in 0..members_count {
        let id = format!("m{i}");
        store(&mut engine, &id, 1_700_000_000 + i * 60, passing(3.0, 200));
        members.push(id);
    }
    store(&mut engine, "solo-a", 1_700_100_000, passing(3.0, 200));
    store(&mut engine, "solo-b", 1_700_100_060, passing(3.0, 200));
    add_route(&engine, "loop", &members);
    engine
        .set_heatmap_hidden(&format!("m{}", members_count - 1), true)
        .expect("hidden stored");
    let source = source_of(&engine);
    let radius = clip_radius_metres(TAP.0, 14);

    let route = traces(&source, &engine.db, tap(), 14, Group::Route("loop"));

    assert_eq!(route.len(), MAX_TRACES);
    let expected: Vec<String> = (4..members_count - 1)
        .rev()
        .map(|i| format!("m{i}"))
        .collect();
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
    let ones = traces(&source, &engine.db, tap(), 14, Group::NoRoute);
    let mut one_ids: Vec<&str> = ones.iter().map(|t| t.activity_id.as_str()).collect();
    one_ids.sort_unstable();
    assert_eq!(one_ids, ["solo-a", "solo-b"]);
    assert!(traces(&source, &engine.db, tap(), 14, Group::Route("absent")).is_empty());
}

/// A section whose line is `line`, ridden by `members`.
fn add_section(
    engine: &PersistentEngine,
    id: &str,
    name: Option<&str>,
    line: &[GpsPoint],
    members: &[&str],
) {
    let bounds = tracematch::geo_utils::compute_bounds(line);
    engine
        .db
        .execute(
            "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_blob, distance_meters, visit_count,
                  representative_activity_id, rep_start_index, rep_end_index,
                  geometry_source, created_at, is_user_defined,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?, 'auto', ?, 'Ride', ?, 1200.0, ?, ?, 0, 12, 'exact',
                     '2026-01-01T00:00:00Z', 0, ?, ?, ?, ?)",
            params![
                id,
                name,
                codec::serialize_track_points(line),
                members.len() as i64,
                members[0],
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng,
            ],
        )
        .expect("section stored");
    for member in members {
        engine
            .db
            .execute(
                "INSERT INTO section_activities
                     (section_id, activity_id, direction, start_index, end_index, distance_meters)
                 VALUES (?1, ?2, 'same', 0, 10, 1200.0)",
                params![id, member],
            )
            .expect("section member stored");
    }
}

/// Three groups cross the tap: a route of two activities, a section of three
/// (one of them also in the route) and one activity in neither.
fn route_section_and_loose(engine: &mut PersistentEngine) {
    for (id, date) in [
        ("route-a", 1_700_000_100),
        ("route-b", 1_700_000_200),
        ("section-a", 1_700_000_300),
        ("section-b", 1_700_000_400),
        ("loose", 1_700_000_500),
    ] {
        store(engine, id, date, passing(3.0, 40));
    }
    add_route(engine, "loop", &["route-a".into(), "route-b".into()]);
    add_section(
        engine,
        "climb",
        Some("The climb"),
        &passing(3.0, 40),
        &["section-a", "section-b", "route-a"],
    );
}

/// Scenario: a route, a section and a loose activity all cross the tap, and
/// one activity is in both the route and the section.
///
/// Expected behaviour: three groups, the route, the section and the
/// activities in no route; the section lists its three members newest first;
/// the shared activity is listed under both and counted once in the total.
#[test]
fn a_section_under_the_tap_is_a_group_of_its_own_between_the_routes_and_no_route() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    route_section_and_loose(&mut engine);

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(found.total, 5);
    let shape: Vec<(FfiUnderPointKind, Option<&str>, u32)> = found
        .groups
        .iter()
        .map(|g| (g.kind, g.id.as_deref(), g.count))
        .collect();
    assert_eq!(
        shape,
        [
            (FfiUnderPointKind::Route, Some("loop"), 2),
            (FfiUnderPointKind::Section, Some("climb"), 3),
            (FfiUnderPointKind::NoRoute, None, 3),
        ]
    );
    let section = &found.groups[1];
    assert_eq!(section.name.as_deref(), Some("The climb"));
    assert_eq!(section.number, None);
    let members: Vec<&str> = section.activities.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(members, ["section-b", "section-a", "route-a"]);
}

/// Scenario: matching is off while a route and a section cross the tap.
///
/// Expected behaviour: the stored routes and sections are not offered, so the
/// activities come back in no route and no section.
#[test]
fn a_tap_with_matching_off_lists_no_route_and_no_section() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    route_section_and_loose(&mut engine);
    engine.set_detection_enabled(false).expect("switch");

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(found.total, 5);
    let kinds: Vec<FfiUnderPointKind> = found.groups.iter().map(|g| g.kind).collect();
    assert_eq!(kinds, [FfiUnderPointKind::NoRoute]);
}

/// Scenario: the same route, section and loose activity as above, one of them
/// in both the route and the section.
///
/// Expected behaviour: `activities` names each activity under the tap once,
/// the shared one included, newest first across the groups, without the
/// grouping.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_flat_list_names_each_activity_under_the_tap_once_newest_first() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    route_section_and_loose(&mut engine);

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    let listed: Vec<&str> = found.activities.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(
        listed,
        ["loose", "section-b", "section-a", "route-b", "route-a"]
    );
}

/// Scenario: a section whose line is 60 m from the tap, ridden by activities
/// that pass 3 m from it.
///
/// Expected behaviour: the section is under the tap when the fingertip reaches
/// its line, at zoom 12 and not at zoom 16, whatever the activities do.
#[test]
fn a_section_is_under_the_tap_by_its_own_line_not_by_its_members() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "rider", 1_700_000_000, passing(3.0, 40));
    add_section(&engine, "off", None, &passing(60.0, 40), &["rider"]);
    let source = source_of(&engine);

    let at_16 = answer(&source, &engine.db, tap(), 16);
    let at_12 = answer(&source, &engine.db, tap(), 12);

    let kinds = |found: &crate::ffi_types::FfiActivitiesUnderPoint| -> Vec<FfiUnderPointKind> {
        found.groups.iter().map(|g| g.kind).collect()
    };
    assert_eq!(kinds(&at_16), [FfiUnderPointKind::NoRoute]);
    assert_eq!(
        kinds(&at_12),
        [FfiUnderPointKind::Section, FfiUnderPointKind::NoRoute]
    );
    assert_eq!(at_12.total, 1);
}

/// Scenario: a section on the tap that the athlete disabled, one a merge
/// superseded, an activity the athlete excluded from a third, and one whose
/// members are all hidden from the heatmap.
///
/// Expected behaviour: none of them is a group.
#[test]
fn a_disabled_superseded_or_memberless_section_is_not_offered() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "rider", 1_700_000_000, passing(3.0, 40));
    store(&mut engine, "hidden", 1_700_000_100, passing(3.0, 40));
    engine.set_heatmap_hidden("hidden", true).expect("hidden");
    add_section(&engine, "off", None, &passing(3.0, 40), &["rider"]);
    add_section(&engine, "merged", None, &passing(3.0, 40), &["rider"]);
    add_section(&engine, "excluded", None, &passing(3.0, 40), &["rider"]);
    add_section(&engine, "unseen", None, &passing(3.0, 40), &["hidden"]);
    engine
        .db
        .execute("UPDATE sections SET disabled = 1 WHERE id = 'off'", [])
        .expect("disabled");
    engine
        .db
        .execute(
            "UPDATE sections SET superseded_by = 'off' WHERE id = 'merged'",
            [],
        )
        .expect("superseded");
    engine
        .db
        .execute(
            "UPDATE section_activities SET excluded = 1 WHERE section_id = 'excluded'",
            [],
        )
        .expect("excluded");

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    let kinds: Vec<FfiUnderPointKind> = found.groups.iter().map(|g| g.kind).collect();
    assert_eq!(kinds, [FfiUnderPointKind::NoRoute]);
}

/// Scenario: a section's line passes the tap and none of the activities
/// under the tap rode it.
///
/// Expected behaviour: no section group.
#[test]
fn a_section_none_of_the_listed_activities_rode_is_not_offered() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    store(&mut engine, "rider", 1_700_000_000, passing(3.0, 40));
    store(&mut engine, "elsewhere", 1_700_000_100, passing(900.0, 40));
    add_section(&engine, "quiet", None, &passing(3.0, 40), &["elsewhere"]);

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    assert_eq!(found.groups.len(), 1);
    assert_eq!(found.groups[0].kind, FfiUnderPointKind::NoRoute);
}

/// Scenario: the sheet lists a section group and the athlete chooses it.
///
/// Expected behaviour: the traces are the section's members under the tap,
/// newest first, and never the activity that rode no section.
#[test]
fn a_section_group_draws_its_members_and_not_the_loose_activity() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    route_section_and_loose(&mut engine);
    let source = source_of(&engine);

    let section = traces(&source, &engine.db, tap(), 14, Group::Section("climb"));
    let route = traces(&source, &engine.db, tap(), 14, Group::Route("loop"));

    let ids = |traces: &[crate::persistence::under_point::Trace]| -> Vec<String> {
        traces.iter().map(|t| t.activity_id.clone()).collect()
    };
    assert_eq!(ids(&section), ["section-b", "section-a", "route-a"]);
    assert_eq!(ids(&route), ["route-b", "route-a"]);
    assert!(traces(&source, &engine.db, tap(), 14, Group::Section("absent")).is_empty());
}

/// Scenario: a track crosses the circle, leaves it and crosses it again.
///
/// Expected behaviour: two lines, each ending on the circle where the track
/// crossed it, and a track that never comes inside gives none.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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

/// Scenario: a route of two attempts (1 800 s and 1 500 s, the faster one
/// earlier), a section of three laps and a loose activity cross the tap.
///
/// Expected behaviour: the route group answers its representative's length,
/// its sport, two passes, the faster attempt's time and the later attempt's
/// date; the section group answers its visit count, its length and its best
/// lap time; the no-route group answers no figures.
#[test]
fn route_and_section_groups_carry_their_sports_length_passes_best_and_last_date() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    route_section_and_loose(&mut engine);
    engine
        .db
        .execute(
            "UPDATE activity_metrics SET moving_time = 1500 WHERE activity_id = 'route-a'",
            [],
        )
        .expect("faster attempt");
    for (activity, lap) in [
        ("section-a", 140.0),
        ("section-b", 120.0),
        ("route-a", 130.0),
    ] {
        engine
            .db
            .execute(
                "UPDATE section_activities SET lap_time = ?1 WHERE activity_id = ?2",
                params![lap, activity],
            )
            .expect("lap");
    }

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    let route = &found.groups[0];
    assert_eq!(route.sport_types, ["Ride"]);
    assert_eq!(route.distance_m, 10_000.0);
    assert_eq!(route.passes, 2);
    assert_eq!(route.best_time, Some(1_500));
    assert_eq!(route.last_date, Some(1_700_000_200.0));
    let section = &found.groups[1];
    assert_eq!(section.sport_types, ["Ride"]);
    assert_eq!(section.distance_m, 1_200.0);
    assert_eq!(section.passes, 3);
    assert_eq!(section.best_time, Some(120));
    assert_eq!(section.last_date, Some(1_700_000_400.0));
    let loose = &found.groups[2];
    assert!(loose.sport_types.is_empty());
    assert_eq!((loose.distance_m, loose.passes), (0.0, 0));
    assert_eq!((loose.best_time, loose.last_date), (None, None));
}

/// Scenario: a route whose attempts all have a zero moving time.
///
/// Expected behaviour: the group still answers its length and its passes, with
/// no best time.
#[test]
fn a_route_whose_attempts_have_no_time_answers_no_best_and_still_its_length() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    route_section_and_loose(&mut engine);
    engine
        .db
        .execute("UPDATE activity_metrics SET moving_time = 0", [])
        .expect("untimed");

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    let route = &found.groups[0];
    assert_eq!(route.best_time, None);
    assert_eq!(route.distance_m, 10_000.0);
}

/// Expected behaviour: an answer reads figures once per route and section
/// group, never per hit.
#[test]
fn figures_are_read_once_per_route_and_section_group() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    route_section_and_loose(&mut engine);
    crate::tiles::work::take_figure_reads();

    let found = answer(&source_of(&engine), &engine.db, tap(), 14);

    let wanted = found
        .groups
        .iter()
        .filter(|g| g.kind != FfiUnderPointKind::NoRoute)
        .count();
    assert_eq!(wanted, 2);
    assert_eq!(crate::tiles::work::take_figure_reads(), wanted);
}
