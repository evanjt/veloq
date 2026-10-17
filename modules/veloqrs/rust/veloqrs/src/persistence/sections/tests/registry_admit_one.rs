//! Handing one auto section back to the registry, which a reset, an enable
//! and a reset of the reference all do, must cost the one section and not the
//! registry. Planning it against every held row is a step over the whole
//! catalogue on a tap, and the cost grows with the library.
//!
//! Scenario: forty auto sections held by the registry, and one more, with an
//! excluded member, that the registry let go and is now asked to readmit.
//! Expected behaviour: no identity plan runs, every held entry is exactly as
//! it was, and the readmitted section is held under its own real id with its
//! excluded member.

use serde_json::Value;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;

const HELD: usize = 40;
const LAT: f64 = 46.2;
const LNG: f64 = 7.3;
/// About 3.8 km apart at this latitude, so no two lines share a corridor.
const SPACING_DEG: f64 = 0.05;
const STEP_DEG: f64 = 0.0001;
const POINTS: usize = 200;
const READMITTED: &str = "auto-orchard-lane";

fn line(lng: f64) -> Vec<GpsPoint> {
    (0..POINTS)
        .map(|i| GpsPoint::new(LAT + i as f64 * STEP_DEG, lng))
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

fn auto_section(
    id: &str,
    polyline: Vec<GpsPoint>,
    members: &[&str],
) -> tracematch::FrequentSection {
    let distance = tracematch::matching::calculate_route_distance(&polyline);
    tracematch::FrequentSection {
        id: id.into(),
        name: None,
        sport_type: "Ride".into(),
        polyline,
        representative_activity_id: members[0].into(),
        representative_range: Some((0, POINTS as u32 - 1)),
        activity_ids: members.iter().map(|m| (*m).into()).collect(),
        activity_portions: members.iter().map(|m| portion(m, distance)).collect(),
        visit_count: members.len() as u32,
        distance_meters: distance,
        activity_traces: Default::default(),
        confidence: 0.8,
        observation_count: members.len() as u32,
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
    }
}

/// Forty held sections and one let go, whose second member is excluded.
fn engine_with_one_section_let_go() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    for k in 0..HELD {
        let lng = LNG + (k + 1) as f64 * SPACING_DEG;
        let ride = format!("ride-{k}");
        engine
            .add_activity(ride.clone(), line(lng), "Ride".into())
            .unwrap();
        engine
            .sections
            .push(auto_section(&format!("auto-{k}"), line(lng), &[&ride]).into());
    }
    for ride in ["kept", "excluded"] {
        engine
            .add_activity(ride.into(), line(LNG), "Ride".into())
            .unwrap();
    }
    engine
        .sections
        .push(auto_section(READMITTED, line(LNG), &["kept", "excluded"]).into());
    engine.save_sections_with_events(&[]).unwrap();
    engine
        .exclude_activity_from_section(READMITTED, "excluded")
        .unwrap();
    engine.section_identity_reseed();
    engine.section_identity_relinquish(READMITTED);
    assert_eq!(engine.section_identity_visible_len(), HELD);
    engine
}

fn hysteresis_json(engine: &PersistentEngine) -> Value {
    serde_json::to_value(engine.section_identity_hysteresis()).unwrap()
}

#[test]
fn readmitting_one_section_plans_nothing_and_leaves_every_held_entry_alone() {
    let mut engine = engine_with_one_section_let_go();
    let before = hysteresis_json(&engine);
    let plans_before = tracematch::sections::identity_plans_run();

    engine.section_identity_admit(READMITTED);

    assert_eq!(
        tracematch::sections::identity_plans_run(),
        plans_before,
        "readmitting one section plans it against no held row"
    );

    let join_id = engine
        .section_identity_join_id(READMITTED)
        .expect("the readmitted section is held")
        .to_string();
    assert!(
        before["visible"].get(&join_id).is_none(),
        "the readmitted section is held under a fresh join id"
    );
    let mut after = hysteresis_json(&engine);
    let readmitted_ground = after["visible"]
        .as_object_mut()
        .unwrap()
        .remove(&join_id)
        .expect("the hysteresis holds the readmitted ground");
    assert_eq!(
        after["visible"], before["visible"],
        "every held entry is unchanged"
    );
    for field in ["pending", "tombstones", "decisive", "params"] {
        assert_eq!(after[field], before[field], "{field} is unchanged");
    }
    assert_eq!(
        readmitted_ground["polyline"],
        serde_json::to_value(
            &engine
                .section_identity_payload(READMITTED)
                .unwrap()
                .polyline
        )
        .unwrap(),
        "the hysteresis holds the ground the registry payload carries"
    );

    assert_eq!(engine.section_identity_visible_len(), HELD + 1);
    let mut members = engine
        .section_identity_payload(READMITTED)
        .unwrap()
        .activity_ids
        .clone();
    members.sort();
    assert_eq!(members, vec!["excluded", "kept"]);
    for k in 0..HELD {
        assert!(
            engine
                .section_identity_payload(&format!("auto-{k}"))
                .is_some(),
            "held section {k} is still held"
        );
    }
}

#[test]
fn readmitting_a_section_already_held_changes_nothing() {
    let mut engine = engine_with_one_section_let_go();
    engine.section_identity_admit(READMITTED);
    let join_id = engine
        .section_identity_join_id(READMITTED)
        .unwrap()
        .to_string();
    let before = hysteresis_json(&engine);

    engine.section_identity_admit(READMITTED);

    assert_eq!(hysteresis_json(&engine), before);
    assert_eq!(
        engine.section_identity_join_id(READMITTED),
        Some(join_id.as_str())
    );
    assert_eq!(engine.section_identity_visible_len(), HELD + 1);
}
