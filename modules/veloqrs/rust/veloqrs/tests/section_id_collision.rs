//! A drawn section's id carries a millisecond, and a millisecond is not unique.
//! The trailing number is earned by asking the table for a free one, so two
//! draws inside one tick get two ids rather than one.
//!
//! Scenario: an athlete draws several sections without pausing between them.
//! Expected behaviour: every draw returns its own id and every drawn section
//! is still there afterwards.
//!
//! The table's `id` is a primary key and the write is a plain INSERT, so a
//! collision does not overwrite quietly: the second draw fails and the athlete
//! loses the line they just drew.
//!
//! Run: `cargo test --test section_id_collision -p veloqrs`

use std::collections::BTreeSet;

use rusqlite::Connection;
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
    let path = tmp.path().join("collision.db");
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

/// An eastward line of `count` points 10 m apart, starting at the offset.
fn eastward(north_m: f64, count: usize) -> Vec<GpsPoint> {
    (0..count)
        .map(|i| {
            GpsPoint::new(
                BASE_LAT + deg_lat(north_m),
                BASE_LNG + deg_lng(i as f64 * 10.0),
            )
        })
        .collect()
}

fn draw(s: &mut Setup, name: &str, polyline: Vec<GpsPoint>) -> String {
    s.engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: polyline.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&polyline),
            name: Some(name.to_string()),
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .unwrap_or_else(|e| panic!("draw {name}: {e}"))
}

fn stored(s: &Setup) -> i64 {
    s.raw
        .query_row("SELECT COUNT(*) FROM sections", [], |r| r.get(0))
        .expect("count")
}

#[test]
fn twenty_draws_in_a_loop_get_twenty_ids() {
    let mut s = setup();
    let ids: BTreeSet<String> = (0..20)
        .map(|n| draw(&mut s, &format!("Line {n}"), eastward(n as f64 * 50.0, 20)))
        .collect();

    assert_eq!(ids.len(), 20, "one id per draw, got {ids:?}");
    assert_eq!(stored(&s), 20, "every drawn section is still in the table");
}

#[test]
fn a_line_and_its_reverse_are_two_sections() {
    let mut s = setup();
    let forward = eastward(0.0, 20);
    let mut backward = forward.clone();
    backward.reverse();

    let there = draw(&mut s, "There", forward);
    let back = draw(&mut s, "Back", backward);

    assert_ne!(there, back, "the same ground drawn twice is two draws");
    assert_eq!(stored(&s), 2);
}

#[test]
fn the_same_line_drawn_twice_is_two_sections() {
    let mut s = setup();
    let line = eastward(0.0, 20);

    let first = draw(&mut s, "First", line.clone());
    let second = draw(&mut s, "Second", line);

    assert_ne!(first, second, "a redraw is not the first draw");
    assert_eq!(stored(&s), 2);
}
