//! The riding areas the preview offers are connected regions of the athlete's
//! sections, not cells of a fixed grid, and a simulated ride is not a place.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test app -p veloqrs -- preview_centres::`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("centres.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
}

fn add_section(s: &Setup, id: &str, sport: &str, lat: f64, lng: f64, visits: u32) {
    s.raw
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, disabled, version, visit_count,
                                   bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                                   created_at, updated_at)
             VALUES (?1, 'auto', ?1, ?2, '[]', 500.0, 0, 1, ?3,
                     ?4, ?4, ?5, ?5, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![id, sport, visits, lat, lng],
        )
        .expect("insert section");
}

/// Scenario: two clusters of sections about 1 km apart whose centres fall on
/// either side of a 0.045 degree grid line.
///
/// Expected behaviour: one area holding all four sections.
#[test]
fn a_region_straddling_a_grid_line_is_one_area() {
    let s = setup();
    add_section(&s, "w1", "Ride", 10.0349, 20.0, 5);
    add_section(&s, "w2", "Ride", 10.0345, 20.001, 4);
    add_section(&s, "e1", "Ride", 10.0351, 20.0, 3);
    add_section(&s, "e2", "Ride", 10.0355, 20.001, 2);

    let centres = s.engine.preview_centres(10);
    assert_eq!(centres.len(), 1, "{centres:?}");
    assert_eq!(centres[0].section_count, 4);
    assert_eq!(centres[0].visit_total, 14);
}

/// Scenario: a chain of sections each 30 km from the next, 60 km end to end.
///
/// Expected behaviour: one area, since every link is within the gap.
#[test]
fn sections_chained_within_the_gap_are_one_area() {
    let s = setup();
    add_section(&s, "c1", "Ride", 10.0, 20.0, 1);
    add_section(&s, "c2", "Ride", 10.27, 20.0, 1);
    add_section(&s, "c3", "Ride", 10.54, 20.0, 1);

    assert_eq!(s.engine.preview_centres(10).len(), 1);
}

/// Scenario: sections only on virtual activities, and a real region.
///
/// Expected behaviour: only the real region is an area.
#[test]
fn sections_on_virtual_sports_make_no_area() {
    let s = setup();
    add_section(&s, "real", "Ride", 10.0, 20.0, 5);
    add_section(&s, "sim_ride", "VirtualRide", -40.0, 150.0, 50);
    add_section(&s, "sim_run", "VirtualRun", 60.0, -100.0, 50);

    let centres = s.engine.preview_centres(10);
    assert_eq!(centres.len(), 1, "{centres:?}");
    assert_eq!(centres[0].section_count, 1);
    assert!((centres[0].lat - 10.0).abs() < 1e-9);
}

/// Scenario: three regions far apart, fewer than the limit.
///
/// Expected behaviour: three areas, busiest first, none within the gap of
/// another.
#[test]
fn distinct_regions_come_back_ranked_and_apart() {
    let s = setup();
    add_section(&s, "a", "Ride", 10.0, 20.0, 3);
    add_section(&s, "b", "Ride", 10.2, 20.0, 3);
    add_section(&s, "c", "Ride", 40.0, 20.0, 9);
    add_section(&s, "d", "Ride", -30.0, 100.0, 1);

    let centres = s.engine.preview_centres(10);
    let visits: Vec<u32> = centres.iter().map(|c| c.visit_total).collect();
    assert_eq!(visits, vec![9, 6, 1]);
    let keys: std::collections::HashSet<&str> =
        centres.iter().map(|c| c.bin_key.as_str()).collect();
    assert_eq!(keys.len(), 3);
}

/// Scenario: more regions than the limit.
///
/// Expected behaviour: the busiest regions fill the limit.
#[test]
fn the_limit_keeps_the_busiest_regions() {
    let s = setup();
    add_section(&s, "a", "Ride", 10.0, 20.0, 1);
    add_section(&s, "b", "Ride", 40.0, 20.0, 9);
    add_section(&s, "c", "Ride", -30.0, 100.0, 5);

    let visits: Vec<u32> = s
        .engine
        .preview_centres(2)
        .iter()
        .map(|c| c.visit_total)
        .collect();
    assert_eq!(visits, vec![9, 5]);
}

/// Scenario: no sections at all, a real activity and a virtual one.
///
/// Expected behaviour: the fallback names the real activity's region only.
#[test]
fn the_activity_fallback_leaves_out_virtual_rides() {
    let s = setup();
    for (id, sport, lat) in [("r1", "Ride", 10.0), ("v1", "VirtualRide", -40.0)] {
        s.raw
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES (?1, ?2, ?3, ?3, 20.0, 20.0)",
                params![id, sport, lat],
            )
            .expect("insert activity");
    }
    let centres = s.engine.preview_centres(10);
    assert_eq!(centres.len(), 1, "{centres:?}");
    assert_eq!(centres[0].source, "activities");
    assert!((centres[0].lat - 10.0).abs() < 1e-9);
}

/// Scenario: one area of four auto sections. The athlete removed one, a
/// re-cut superseded one, and one was accepted into a custom section.
///
/// Expected behaviour: the area counts only the section the preview opens,
/// and its visits alone.
#[test]
fn retired_and_accepted_sections_leave_the_area_count() {
    let s = setup();
    add_section(&s, "kept", "Ride", 10.0, 20.0, 5);
    add_section(&s, "removed", "Ride", 10.001, 20.001, 7);
    add_section(&s, "replaced", "Ride", 10.002, 20.002, 9);
    add_section(&s, "accepted", "Ride", 10.003, 20.003, 11);
    s.raw
        .execute("UPDATE sections SET disabled = 1 WHERE id = 'removed'", [])
        .expect("disable");
    s.raw
        .execute(
            "UPDATE sections SET superseded_by = 'kept' WHERE id = 'replaced'",
            [],
        )
        .expect("supersede");
    s.raw
        .execute(
            "UPDATE sections SET is_user_defined = 1 WHERE id = 'accepted'",
            [],
        )
        .expect("accept");

    let centres = s.engine.preview_centres(10);
    assert_eq!(centres.len(), 1, "{centres:?}");
    assert_eq!(centres[0].section_count, 1);
    assert_eq!(centres[0].visit_total, 5);
}
