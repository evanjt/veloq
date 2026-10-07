//! A detection apply that hands an existing section a new line or a new
//! reference ride without a lifecycle event still leaves a geometry version and
//! a history row, so the ledger never shows an extent the section no longer has.

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;

const LAT: f64 = 46.2;
const LNG: f64 = 7.3;
const STEP_DEG: f64 = 0.0001;
const SECTION: &str = "auto-line";

fn northbound(points: usize) -> Vec<GpsPoint> {
    (0..points)
        .map(|i| GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG))
        .collect()
}

fn section_on(reference: &str, points: usize) -> tracematch::FrequentSection {
    let polyline = northbound(points);
    let distance = tracematch::matching::calculate_route_distance(&polyline);
    tracematch::FrequentSection {
        id: SECTION.into(),
        name: None,
        sport_type: "Ride".into(),
        polyline,
        representative_activity_id: reference.into(),
        representative_range: Some((0, points as u32 - 1)),
        activity_ids: vec![reference.into()],
        activity_portions: vec![tracematch::SectionPortion {
            activity_id: reference.into(),
            start_index: 0,
            end_index: points as u32 - 1,
            distance_meters: distance,
            direction: tracematch::Direction::Same,
        }],
        visit_count: 1,
        distance_meters: distance,
        activity_traces: Default::default(),
        confidence: 0.8,
        observation_count: 1,
        average_spread: 10.0,
        point_density: vec![1; points],
        scale: Some(tracematch::sections::ScaleName::Medium),
        is_user_defined: false,
        stability: 1.0,
        version: 1,
        updated_at: None,
        created_at: None,
        consensus_state: None,
        elevation_gain_m: None,
        avg_grade_percent: None,
        enrichment: Default::default(),
        rank: None,
    }
}

fn engine_with_rides() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    for (id, points) in [("short", 200), ("long", 250)] {
        engine
            .add_activity(id.into(), northbound(points), "Ride".into())
            .unwrap();
    }
    engine
}

fn apply(engine: &mut PersistentEngine, section: tracematch::FrequentSection) {
    engine.sections.retain(|s| s.is_user_defined);
    engine.sections.push(section);
    engine.save_sections_with_events(&[]).unwrap();
}

fn versions(engine: &PersistentEngine) -> i64 {
    engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM section_geometry WHERE section_id = ?",
            params![SECTION],
            |r| r.get(0),
        )
        .unwrap()
}

fn recuts(engine: &PersistentEngine) -> Vec<(Option<i64>, Option<String>)> {
    engine
        .db
        .prepare(
            "SELECT geometry_version, details FROM section_history
             WHERE section_id = ? AND kind = 'recut' ORDER BY id",
        )
        .unwrap()
        .query_map(params![SECTION], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// Scenario: a later detect returns the same id on a line a quarter longer, cut from
/// another ride, and the identity apply fires no event for it.
/// Expected behaviour: the new line is a geometry version and a `recut` history
/// row links it and names the extents and references.
#[test]
fn an_adopted_line_that_grows_is_versioned_and_narrated() {
    let mut engine = engine_with_rides();
    apply(&mut engine, section_on("short", 200));

    apply(&mut engine, section_on("long", 250));

    let rows = recuts(&engine);
    assert_eq!(rows.len(), 1, "{rows:?}");
    let (version, details) = &rows[0];
    let details: serde_json::Value = serde_json::from_str(details.as_deref().unwrap()).unwrap();
    assert_eq!(details["reason"], "adopted");
    assert_eq!(details["from_reference"], "short");
    assert_eq!(details["to_reference"], "long");
    let from = details["from_distance_m"].as_f64().unwrap();
    let to = details["to_distance_m"].as_f64().unwrap();
    assert!(to > from * 1.2, "{from} -> {to}");
    let newest: i64 = engine
        .db
        .query_row(
            "SELECT MAX(version) FROM section_geometry WHERE section_id = ?",
            params![SECTION],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(*version, Some(newest));
    assert!(newest > 1, "the outgoing extent keeps a version of its own");
}

/// Scenario: the same line and reference are applied again.
/// Expected behaviour: nothing is written.
#[test]
fn an_unchanged_adoption_writes_no_version_or_row() {
    let mut engine = engine_with_rides();
    apply(&mut engine, section_on("short", 200));
    let before = versions(&engine);

    apply(&mut engine, section_on("short", 200));

    assert_eq!(versions(&engine), before);
    assert!(recuts(&engine).is_empty());
}

/// Scenario: a new reference ride traces the same ground.
/// Expected behaviour: the change of reference is a version and a row, because
/// the ledger names the reference a section is measured against.
#[test]
fn an_adopted_reference_change_on_the_same_ground_is_narrated() {
    let mut engine = engine_with_rides();
    apply(&mut engine, section_on("long", 250));

    let mut moved = section_on("short", 200);
    moved.polyline = northbound(250);
    moved.distance_meters = tracematch::matching::calculate_route_distance(&moved.polyline);
    moved.representative_range = Some((0, 249));
    apply(&mut engine, moved);

    assert_eq!(recuts(&engine).len(), 1);
}

/// Scenario: a sub-percent wobble in the line from the same reference.
/// Expected behaviour: no row, so consensus noise does not fill the ledger.
#[test]
fn a_small_extent_change_from_the_same_reference_is_not_narrated() {
    let mut engine = engine_with_rides();
    apply(&mut engine, section_on("long", 250));

    let mut wobble = section_on("long", 250);
    wobble.distance_meters *= 1.005;
    apply(&mut engine, wobble);

    assert!(recuts(&engine).is_empty());
}
