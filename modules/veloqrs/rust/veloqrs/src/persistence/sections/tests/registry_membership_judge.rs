//! Who belongs to a carried section is the detector's call wherever the
//! detector looked.
//!
//! The detector counts a ride against the line it drew and may then shorten
//! that line where it meets a neighbour, so the line the registry holds is not
//! always the line the count was taken against. A ride can pass the held line
//! and still be one the cut left out.
//!
//! Scenario: a carried section, then a step whose cut leaves out a ride whose
//! track runs the held line end to end.
//! Expected behaviour: the carried row holds exactly the cut's members, so a
//! library built one ride at a time holds the members a batch of the same rides
//! holds.

use std::collections::HashMap;

use tempfile::TempDir;
use tracematch::{FrequentSection, GpsPoint, SectionPortion};

use super::{SectionIdentity, SectionReplay};
use crate::persistence::PersistentEngine;

const SECTION: &str = "s_line";

fn line() -> Vec<GpsPoint> {
    (0..120)
        .map(|i| GpsPoint::new(46.0 + f64::from(i) * 0.000_1, 7.0))
        .collect()
}

/// A ride well away from the line, so it arrives without touching it.
fn elsewhere() -> Vec<GpsPoint> {
    (0..120)
        .map(|i| GpsPoint::new(46.5 + f64::from(i) * 0.000_1, 7.5))
        .collect()
}

fn engine(dir: &TempDir, pooled: bool) -> PersistentEngine {
    let path = dir.path().join("judge.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.section_config.pool_sports = pooled;
    engine
}

fn ride(engine: &mut PersistentEngine, id: &str, track: Vec<GpsPoint>, sport: &str) {
    engine
        .add_activity(id.into(), track, sport.into())
        .expect("add_activity");
}

fn passes(engine: &PersistentEngine, id: &str) -> Vec<SectionPortion> {
    tracematch::track_portions(id, &line(), &line(), &engine.section_config)
}

/// The detector's cut over the line, holding `members` and no one else.
fn cut(engine: &PersistentEngine, members: &[&str]) -> FrequentSection {
    let polyline = line();
    let portions: Vec<SectionPortion> = members.iter().flat_map(|m| passes(engine, m)).collect();
    FrequentSection {
        id: SECTION.to_string(),
        name: None,
        sport_type: "Ride".to_string(),
        distance_meters: tracematch::matching::calculate_route_distance(&polyline),
        point_density: vec![members.len() as u32; polyline.len()],
        representative_activity_id: members[0].to_string(),
        representative_range: Some((0, polyline.len() as u32)),
        polyline,
        activity_ids: members.iter().map(|m| m.to_string()).collect(),
        visit_count: portions.len() as u32,
        activity_portions: portions,
        activity_traces: HashMap::new(),
        confidence: 0.9,
        observation_count: members.len() as u32,
        average_spread: 4.0,
        scale: None,
        is_user_defined: false,
        stability: 1.0,
        elevation_gain_m: None,
        avg_grade_percent: None,
        version: 1,
        updated_at: None,
        created_at: None,
        enrichment: Default::default(),
        rank: None,
        consensus_state: None,
    }
}

fn members(rows: &[FrequentSection]) -> Vec<String> {
    assert_eq!(rows.len(), 1, "one section on one line");
    let mut ids = rows[0].activity_ids.clone();
    ids.sort();
    ids
}

fn apply(
    engine: &PersistentEngine,
    identity: &mut SectionIdentity,
    cut: FrequentSection,
) -> Vec<FrequentSection> {
    engine
        .section_identity_apply_into(identity, SectionReplay::whole(vec![cut]))
        .visible
}

#[test]
fn an_arrival_the_cut_leaves_out_is_not_folded_into_a_carried_row() {
    let dir = TempDir::new().expect("tempdir");
    let mut drip = engine(&dir, true);
    for id in ["a1", "a2", "a3"] {
        ride(&mut drip, id, line(), "Ride");
    }
    let mut drip_identity = SectionIdentity::default();
    apply(&drip, &mut drip_identity, cut(&drip, &["a1", "a2", "a3"]));

    ride(&mut drip, "late", line(), "Ride");
    assert!(
        !passes(&drip, "late").is_empty(),
        "the late ride runs the held line"
    );
    let drip_rows = apply(&drip, &mut drip_identity, cut(&drip, &["a1", "a2", "a3"]));

    let batch_dir = TempDir::new().expect("tempdir");
    let mut batch = engine(&batch_dir, true);
    for id in ["a1", "a2", "a3", "late"] {
        ride(&mut batch, id, line(), "Ride");
    }
    let batch_rows = apply(
        &batch,
        &mut SectionIdentity::default(),
        cut(&batch, &["a1", "a2", "a3"]),
    );

    assert_eq!(members(&drip_rows), vec!["a1", "a2", "a3"]);
    assert_eq!(members(&drip_rows), members(&batch_rows));
}

#[test]
fn an_arrival_the_cut_counts_joins_with_the_cuts_passes() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir, true);
    for id in ["a1", "a2", "a3"] {
        ride(&mut engine, id, line(), "Ride");
    }
    let mut identity = SectionIdentity::default();
    apply(&engine, &mut identity, cut(&engine, &["a1", "a2", "a3"]));

    ride(&mut engine, "late", line(), "Ride");
    let rows = apply(
        &engine,
        &mut identity,
        cut(&engine, &["a1", "a2", "a3", "late"]),
    );

    assert_eq!(members(&rows), vec!["a1", "a2", "a3", "late"]);
    let late: Vec<&SectionPortion> = rows[0]
        .activity_portions
        .iter()
        .filter(|p| p.activity_id == "late")
        .collect();
    assert_eq!(late.len(), passes(&engine, "late").len());
    assert_eq!(
        rows[0].visit_count as usize,
        rows[0].activity_portions.len()
    );
}

#[test]
fn a_member_the_cut_leaves_out_is_not_grafted_back_once_the_re_cut_fires() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir, true);
    for id in ["a1", "a2", "a3", "gone"] {
        ride(&mut engine, id, line(), "Ride");
    }
    let mut identity = SectionIdentity::default();
    apply(
        &engine,
        &mut identity,
        cut(&engine, &["a1", "a2", "a3", "gone"]),
    );

    let mut rows = Vec::new();
    for step in 0..12 {
        ride(&mut engine, &format!("away_{step}"), elsewhere(), "Ride");
        rows = apply(&engine, &mut identity, cut(&engine, &["a1", "a2", "a3"]));
    }

    assert_eq!(members(&rows), vec!["a1", "a2", "a3"]);
}

#[test]
fn an_arrival_outside_the_cuts_sport_is_judged_by_the_held_line() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir, false);
    for id in ["a1", "a2", "a3"] {
        ride(&mut engine, id, line(), "Ride");
    }
    let mut identity = SectionIdentity::default();
    apply(&engine, &mut identity, cut(&engine, &["a1", "a2", "a3"]));

    ride(&mut engine, "run", line(), "Run");
    let rows = apply(&engine, &mut identity, cut(&engine, &["a1", "a2", "a3"]));

    assert_eq!(members(&rows), vec!["a1", "a2", "a3", "run"]);
}
