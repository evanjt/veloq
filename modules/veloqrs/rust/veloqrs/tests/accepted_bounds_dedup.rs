//! An auto section that is a coarse redraw of an accepted section's ground is
//! dropped before the identity registry sees it, so the skip leaves nothing
//! behind: no catalogue row, no registry row, and no burnt name number. A line
//! that only lies inside the accepted section's bounding box, without coming
//! near its ground, is a different road and is kept.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test app_synthetic -- accepted_bounds_dedup::

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::{Direction, FrequentSection, GpsPoint, SectionPortion};
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

const BASE_LAT: f64 = 46.0;
const BASE_LON: f64 = 7.10;

fn deg_lat(m: f64) -> f64 {
    m / 111_320.0
}

fn deg_lon(m: f64) -> f64 {
    m / (111_320.0 * BASE_LAT.to_radians().cos())
}

fn pt(north_m: f64, east_m: f64) -> GpsPoint {
    GpsPoint {
        latitude: BASE_LAT + deg_lat(north_m),
        longitude: BASE_LON + deg_lon(east_m),
        elevation: Some(500.0),
    }
}

/// A square loop `lo`..`hi` metres on a side, sampled every 25 m. At 0..1000
/// its bounding box is wide in both axes, so a line drawn well inside it lies
/// in the box without ever coming within ground distance of an edge.
fn square(lo: f64, hi: f64) -> Vec<GpsPoint> {
    let step = 25.0;
    let mut pts = Vec::new();
    let mut d = lo;
    while d <= hi {
        pts.push(pt(d, lo));
        d += step;
    }
    d = lo;
    while d <= hi {
        pts.push(pt(hi, d));
        d += step;
    }
    d = hi;
    while d >= lo {
        pts.push(pt(d, hi));
        d -= step;
    }
    d = hi;
    while d >= lo {
        pts.push(pt(lo, d));
        d -= step;
    }
    pts
}

fn ring() -> Vec<GpsPoint> {
    square(0.0, 1_000.0)
}

/// A diagonal line, so its bounding box has extent in both axes.
fn diagonal(origin_north_m: f64, origin_east_m: f64) -> Vec<GpsPoint> {
    (0..=20)
        .map(|i| {
            let d = f64::from(i) * 10.0;
            pt(origin_north_m + d, origin_east_m + d)
        })
        .collect()
}

fn auto_section(id: &str, polyline: Vec<GpsPoint>, members: &[&str]) -> FrequentSection {
    let last = (polyline.len() - 1) as u32;
    let portions: Vec<SectionPortion> = members
        .iter()
        .map(|a| SectionPortion {
            activity_id: (*a).to_string(),
            start_index: 0,
            end_index: last,
            distance_meters: 200.0,
            direction: Direction::Same,
        })
        .collect();
    FrequentSection {
        id: id.to_string(),
        name: None,
        sport_type: "Ride".to_string(),
        polyline,
        representative_activity_id: members[0].to_string(),
        representative_range: None,
        activity_ids: members.iter().map(|a| (*a).to_string()).collect(),
        activity_portions: portions,
        visit_count: members.len() as u32,
        distance_meters: 200.0,
        activity_traces: Default::default(),
        confidence: 0.9,
        observation_count: members.len() as u32,
        average_spread: 5.0,
        point_density: Vec::new(),
        scale: None,
        is_user_defined: false,
        stability: 1.0,
        elevation_gain_m: None,
        avg_grade_percent: None,
        enrichment: Default::default(),
        rank: None,
        version: 1,
        updated_at: None,
        created_at: None,
        consensus_state: None,
    }
}

fn engine_with_activities(tracks: &[(&str, Vec<GpsPoint>)]) -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("dedup.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    for (i, (id, pts)) in tracks.iter().enumerate() {
        engine
            .add_activity((*id).to_string(), pts.clone(), "Ride".to_string())
            .expect("add_activity");
        engine
            .update_activity_metadata(
                id,
                Some(1_700_000_000 + i as i64 * 86_400),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }
    (engine, dir)
}

#[test]
fn coarse_redraw_of_accepted_ground_leaves_no_orphan_row_and_burns_no_name() {
    let accepted_ground = ring();
    let inside = square(100.0, 900.0);
    let elsewhere = diagonal(300_000.0, 0.0);

    let (mut engine, _dir) = engine_with_activities(&[
        ("act_ring", accepted_ground.clone()),
        ("act_inside", inside.clone()),
        ("act_far", elsewhere.clone()),
    ]);

    let accepted_id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: accepted_ground,
            distance_meters: 4_000.0,
            name: Some("Accepted loop".to_string()),
            source_activity_id: Some("act_ring".to_string()),
            start_index: Some(0),
            end_index: Some(160),
        })
        .expect("create_section");

    // Two members against one, so the dominated candidate sorts first and would
    // take the next number if the skip still happened at save time.
    let dominated = auto_section("pos_dominated", inside, &["act_inside", "act_ring"]);
    let survivor = auto_section("pos_survivor", elsewhere, &["act_far"]);
    engine
        .apply_sections(vec![dominated, survivor])
        .expect("apply_sections");

    let visible: Vec<_> = engine
        .get_sections()
        .iter()
        .filter(|s| s.id != accepted_id)
        .cloned()
        .collect();
    assert_eq!(
        visible.len(),
        1,
        "the coarse redraw should not reach the catalogue: {:?}",
        visible.iter().map(|s| s.id.clone()).collect::<Vec<_>>()
    );

    let kept = &visible[0];
    // The accepted section holds number 1, so a skipped candidate that took a
    // number would leave the survivor on 3.
    let shown_name = engine.get_section(&kept.id).and_then(|s| s.name);
    assert_eq!(
        shown_name.as_deref(),
        Some("Section 2"),
        "the skipped candidate must not consume a number"
    );

    let registry_ids: Vec<String> = engine
        .section_identity_mirror_rows()
        .into_iter()
        .map(|(_, real_id, _, _)| real_id)
        .collect();
    assert_eq!(
        registry_ids,
        vec![kept.id.clone()],
        "the registry must hold no row the catalogue does not"
    );
}

#[test]
fn road_inside_accepted_loop_bounds_is_kept() {
    let accepted_ground = ring();
    let interior = diagonal(400.0, 400.0);

    let (mut engine, _dir) = engine_with_activities(&[
        ("act_ring", accepted_ground.clone()),
        ("act_interior", interior.clone()),
    ]);

    let accepted_id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: accepted_ground,
            distance_meters: 4_000.0,
            name: Some("Accepted loop".to_string()),
            source_activity_id: Some("act_ring".to_string()),
            start_index: Some(0),
            end_index: Some(160),
        })
        .expect("create_section");

    let road = auto_section("pos_road", interior, &["act_interior"]);
    engine.apply_sections(vec![road]).expect("apply_sections");

    let others: Vec<_> = engine
        .get_sections()
        .iter()
        .filter(|s| s.id != accepted_id)
        .cloned()
        .collect();
    assert_eq!(
        others.len(),
        1,
        "a road 400 m from the loop's ground must reach the catalogue"
    );
}
