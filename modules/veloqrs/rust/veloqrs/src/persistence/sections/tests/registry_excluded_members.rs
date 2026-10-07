//! The registry a detect carries from holds every member of a section, the
//! athlete's exclusions included. The loaded catalogue leaves excluded members
//! out, so a registry built from it alone writes the section back without
//! them and the next detect has no row left to flag as excluded.
//!
//! Scenario: a section of two rides, one excluded, then the registry rebuilt
//! the two ways a reset, an enable or a restart rebuilds it.
//! Expected behaviour: the excluded ride is still one of the registry's members.

use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;

const LAT: f64 = 46.2;
const LNG: f64 = 7.3;
const STEP_DEG: f64 = 0.0001;
const POINTS: usize = 200;
const SECTION: &str = "auto-line";

fn northbound() -> Vec<GpsPoint> {
    (0..POINTS)
        .map(|i| GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG))
        .collect()
}

fn portion(activity: &str, distance: f64) -> tracematch::SectionPortion {
    tracematch::SectionPortion {
        activity_id: activity.into(),
        start_index: 0,
        end_index: POINTS as u32 - 1,
        distance_meters: distance,
        direction: tracematch::Direction::Same,
    }
}

fn engine_with_two_members_one_excluded() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    for id in ["kept", "excluded"] {
        engine
            .add_activity(id.into(), northbound(), "Ride".into())
            .unwrap();
    }
    let polyline = northbound();
    let distance = tracematch::matching::calculate_route_distance(&polyline);
    engine.sections.push(tracematch::FrequentSection {
        id: SECTION.into(),
        name: None,
        sport_type: "Ride".into(),
        polyline,
        representative_activity_id: "kept".into(),
        representative_range: Some((0, POINTS as u32 - 1)),
        activity_ids: vec!["kept".into(), "excluded".into()],
        activity_portions: vec![portion("kept", distance), portion("excluded", distance)],
        visit_count: 2,
        distance_meters: distance,
        activity_traces: Default::default(),
        confidence: 0.8,
        observation_count: 2,
        average_spread: 10.0,
        point_density: vec![1; POINTS],
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
    });
    engine.save_sections_with_events(&[]).unwrap();
    engine
        .exclude_activity_from_section(SECTION, "excluded")
        .unwrap();
    assert_eq!(
        engine.sections[0].activity_ids,
        vec!["kept"],
        "the loaded catalogue leaves the excluded ride out"
    );
    engine
}

fn registry_members(engine: &PersistentEngine) -> Vec<String> {
    let mut ids = engine
        .section_identity_payload(SECTION)
        .expect("the registry holds the section")
        .activity_ids
        .clone();
    ids.sort();
    ids
}

#[test]
fn a_reseed_keeps_an_excluded_member_in_the_registry() {
    let mut engine = engine_with_two_members_one_excluded();

    engine.section_identity_reseed();

    assert_eq!(registry_members(&engine), vec!["excluded", "kept"]);
    let payload = engine.section_identity_payload(SECTION).unwrap();
    assert_eq!(payload.activity_portions.len(), 2);
    assert_eq!(payload.visit_count, 2);
}

#[test]
fn an_admit_keeps_an_excluded_member_in_the_registry() {
    let mut engine = engine_with_two_members_one_excluded();
    engine.section_identity_reseed();
    engine.section_identity_relinquish(SECTION);
    assert!(engine.section_identity_payload(SECTION).is_none());

    engine.section_identity_admit(SECTION);

    assert_eq!(registry_members(&engine), vec!["excluded", "kept"]);
}

#[test]
fn a_reseed_with_nothing_excluded_changes_no_member() {
    let mut engine = engine_with_two_members_one_excluded();
    engine
        .include_activity_in_section(SECTION, "excluded")
        .unwrap();

    engine.section_identity_reseed();

    assert_eq!(registry_members(&engine), vec!["excluded", "kept"]);
    assert_eq!(
        engine
            .section_identity_payload(SECTION)
            .unwrap()
            .activity_portions
            .len(),
        2
    );
}
