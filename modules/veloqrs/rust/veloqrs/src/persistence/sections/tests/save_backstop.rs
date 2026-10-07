//! A save that skips a section for having no pooled portion leaves memory and
//! the `sections` table agreeing: the skipped section is in neither.

use std::collections::HashMap;

use tracematch::{Direction, FrequentSection, GpsPoint, SectionPortion};

use crate::persistence::PersistentEngine;

fn track() -> Vec<GpsPoint> {
    (0..50)
        .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0005, 7.0))
        .collect()
}

fn section(id: &str, rides: &[&str]) -> FrequentSection {
    FrequentSection {
        id: id.to_string(),
        name: None,
        sport_type: "Ride".to_string(),
        polyline: track(),
        representative_activity_id: rides[0].to_string(),
        representative_range: None,
        activity_ids: rides.iter().map(|r| r.to_string()).collect(),
        activity_portions: rides
            .iter()
            .map(|ride| SectionPortion {
                activity_id: ride.to_string(),
                start_index: 0,
                end_index: 50,
                distance_meters: 2500.0,
                direction: Direction::Same,
            })
            .collect(),
        visit_count: rides.len() as u32,
        distance_meters: 2500.0,
        activity_traces: HashMap::new(),
        confidence: 0.8,
        observation_count: rides.len() as u32,
        average_spread: 10.0,
        point_density: vec![rides.len() as u32; 50],
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

fn stored_ids(engine: &PersistentEngine) -> Vec<String> {
    let mut stmt = engine
        .db
        .prepare("SELECT id FROM sections ORDER BY id")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn memory_ids(engine: &PersistentEngine) -> Vec<String> {
    let mut ids: Vec<String> = engine.get_sections().iter().map(|s| s.id.clone()).collect();
    ids.sort();
    ids
}

fn engine_with_sections() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    for ride in ["a0", "a1"] {
        engine
            .add_activity(ride.to_string(), track(), "Ride".to_string())
            .unwrap();
    }
    engine.sections = vec![section("s_kept", &["a0", "a1"]), section("s_gone", &["x0"])];
    engine
}

#[test]
fn save_sections_drops_the_section_it_skipped_from_memory() {
    let mut engine = engine_with_sections();
    engine.save_sections().unwrap();
    assert_eq!(stored_ids(&engine), vec!["s_kept"]);
    assert_eq!(memory_ids(&engine), stored_ids(&engine));
}

#[test]
fn save_sections_with_events_drops_the_section_it_skipped_from_memory() {
    let mut engine = engine_with_sections();
    engine.save_sections_with_events(&[]).unwrap();
    assert_eq!(stored_ids(&engine), vec!["s_kept"]);
    assert_eq!(memory_ids(&engine), stored_ids(&engine));
}

#[test]
fn a_second_save_keeps_the_section_that_is_pooled() {
    let mut engine = engine_with_sections();
    engine.save_sections().unwrap();
    engine.save_sections().unwrap();
    assert_eq!(memory_ids(&engine), vec!["s_kept"]);
    assert_eq!(stored_ids(&engine), vec!["s_kept"]);
}
