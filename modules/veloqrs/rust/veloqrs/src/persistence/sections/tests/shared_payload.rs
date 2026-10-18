//! The identity registry and the visible catalogue hold one payload per auto
//! section, not a copy each.
//!
//! Scenario: a library is detected and applied, the engine is closed and
//! opened again, more rides arrive and are detected, the catalogue is ranked,
//! and a section is renamed.
//!
//! Expected behaviour: after every step each visible auto section is the same
//! allocation as its identity row's payload, so the row carries the visible
//! rank and name. The registry blob encodes exactly as it did when a row held
//! its section by value.

use std::borrow::Borrow;

use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};

use super::*;

fn library(count: usize) -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: count,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

fn open(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("shared.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.load().expect("load");
    engine
}

fn detect(engine: &mut PersistentEngine, rides: &[LifecycleActivity]) {
    for ride in rides {
        engine
            .add_activity(
                ride.id.clone(),
                ride.gps_points.clone(),
                ride.sport_type.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(&ride.id, Some(ride.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
    let handle = engine.detect_sections_background();
    let (main, update) = handle.recv_state_with_cache();
    let crate::persistence::WorkerPoll::Ready((sections, processed)) = main else {
        panic!("the detect did not answer");
    };
    engine
        .apply_sections_with_cache(sections, update)
        .expect("apply");
    engine
        .save_processed_activity_ids(&processed)
        .expect("processed ids");
}

fn row_payload<'a>(engine: &'a PersistentEngine, real_id: &str) -> Option<&'a FrequentSection> {
    engine
        .identity
        .rows
        .values()
        .find(|row| row.real_id == real_id)
        .map(|row| row.section.borrow())
}

/// Every visible auto section shares its row's payload. Returns how many did.
fn assert_shared(engine: &PersistentEngine, step: &str) -> usize {
    let mut shared = 0;
    for visible in engine.sections.iter() {
        let visible: &FrequentSection = visible.borrow();
        if visible.is_user_defined {
            continue;
        }
        let row = row_payload(engine, &visible.id)
            .unwrap_or_else(|| panic!("{step}: visible {} has no identity row", visible.id));
        assert!(
            std::ptr::eq(row, visible),
            "{step}: visible {} and its identity row are two allocations",
            visible.id
        );
        shared += 1;
    }
    assert!(shared > 0, "{step}: the catalogue holds no auto section");
    shared
}

#[test]
fn every_visible_auto_section_shares_its_identity_row() {
    let rides = library(30);
    let (first, later) = rides.split_at(24);
    let dir = TempDir::new().expect("tempdir");

    let mut engine = open(&dir);
    detect(&mut engine, first);
    assert_shared(&engine, "detect and apply");
    drop(engine);

    let mut engine = open(&dir);
    assert_shared(&engine, "cold open");

    detect(&mut engine, later);
    assert_shared(&engine, "detect after a cold open");

    engine.rank_catalogue().expect("rank");
    assert_shared(&engine, "rank");
    for visible in engine.sections.iter() {
        let visible: &FrequentSection = visible.borrow();
        if !visible.is_user_defined {
            assert!(visible.rank.is_some(), "{} was not ranked", visible.id);
        }
    }

    let renamed = engine
        .sections
        .iter()
        .map(|s| -> &FrequentSection { s.borrow() })
        .find(|s| !s.is_user_defined)
        .map(|s| s.id.clone())
        .expect("an auto section");
    engine
        .set_section_name(&renamed, Some("Quarry Lane"))
        .expect("name");
    engine.adopt_corridor_name(&renamed);
    assert_shared(&engine, "the corridor name adopted onto the section");
    assert_eq!(
        row_payload(&engine, &renamed).and_then(|s| s.name.as_deref()),
        Some("Quarry Lane"),
        "the identity row carries the adopted name"
    );

    engine.set_section_name(&renamed, None).expect("unname");
    assert_shared(&engine, "unname");
    assert_eq!(
        row_payload(&engine, &renamed).map(|s| s.name.as_deref()),
        Some(None),
        "the identity row drops the name"
    );

    engine
        .set_section_is_lift(&renamed, true)
        .expect("flag a lift");
    assert_shared(&engine, "flag a lift");
    assert_eq!(
        row_payload(&engine, &renamed).map(|s| s.enrichment.is_lift),
        Some(true),
        "the identity row carries the lift flag"
    );
    engine.record_section_intent(&renamed, "lift");
    engine.apply_lift_intents_to_memory().expect("lift intents");
    assert_shared(&engine, "a lift intent applied");
    assert_eq!(
        row_payload(&engine, &renamed).map(|s| s.enrichment.is_lift),
        Some(false),
        "the identity row drops the lift flag"
    );

    engine.recalculate_section_polyline(&renamed);
    assert_shared(&engine, "recalculate a line");

    let leaving = row_payload(&engine, &renamed)
        .expect("the row")
        .activity_ids[0]
        .clone();
    engine.remove_activity(&leaving).expect("remove");
    assert_shared(&engine, "remove an activity");
    for visible in engine.sections.iter() {
        assert!(
            !visible.activity_ids.contains(&leaving),
            "{} still holds the removed activity",
            visible.id
        );
    }
}

fn fixed_section(id: &str, latitude: f64, members: &[&str]) -> FrequentSection {
    let polyline: Vec<GpsPoint> = (0..12)
        .map(|i| GpsPoint::new(latitude + f64::from(i) * 0.000_2, 6.5))
        .collect();
    FrequentSection {
        id: id.into(),
        name: Some(format!("{id} name")),
        sport_type: "Ride".into(),
        distance_meters: 245.5,
        point_density: vec![3; polyline.len()],
        polyline,
        representative_activity_id: members[0].into(),
        representative_range: Some((2, 13)),
        activity_ids: members.iter().map(|m| (*m).into()).collect(),
        activity_portions: members
            .iter()
            .map(|m| tracematch::SectionPortion {
                activity_id: (*m).into(),
                start_index: 2,
                end_index: 13,
                distance_meters: 245.5,
                direction: tracematch::Direction::Same,
            })
            .collect(),
        visit_count: members.len() as u32,
        activity_traces: HashMap::new(),
        confidence: 0.75,
        observation_count: members.len() as u32,
        average_spread: 3.25,
        scale: Some(tracematch::sections::ScaleName::Medium),
        is_user_defined: false,
        stability: 0.5,
        elevation_gain_m: Some(4.0),
        avg_grade_percent: Some(1.5),
        version: 3,
        updated_at: Some("2024-02-03T04:05:06+00:00".into()),
        created_at: Some("2023-01-02T03:04:05+00:00".into()),
        enrichment: Default::default(),
        rank: None,
    }
}

/// Encoded registry bytes for two rows, a grave and a seen set, taken when a
/// row held its section by value and was never ranked. A shared payload must
/// not move a byte.
const FIXED_REGISTRY_SHA256: &str =
    "12e23d3e8173eb9be00c15f7930ed6c92b58c35430303c9c0737a54602914614";

#[test]
fn a_shared_payload_encodes_the_registry_blob_unchanged() {
    let mut identity = SectionIdentity::default();
    for (pid, real_id, latitude, members) in [
        ("s_1", "sec-north", 46.1, &["ride-a", "ride-b"][..]),
        ("s_2", "sec-south", 45.9, &["ride-c"][..]),
    ] {
        identity.rows.insert(
            pid.into(),
            IdentityRow {
                real_id: real_id.into(),
                section: fixed_section(real_id, latitude, members).into(),
            },
        );
    }
    // The tables own the score, so a ranked payload persists as an unranked
    // one: the bytes below were taken from rows that had never been ranked.
    let ranked = identity.rows.get_mut("s_1").expect("the north row");
    Arc::make_mut(&mut ranked.section).rank = Some(tracematch::RankFeatures {
        score: 0.75,
        sport_score: 0.5,
        ..Default::default()
    });
    identity.graves.insert(
        "s_3".into(),
        GraveRow::from(IdentityRow {
            real_id: "sec-gone".into(),
            section: fixed_section("sec-gone", 46.4, &["ride-d"]).into(),
        }),
    );
    identity.seen = ["ride-a", "ride-b", "ride-c", "ride-d"]
        .into_iter()
        .map(String::from)
        .collect();
    identity.mint_seq = 7;

    let blob = identity_blob_for(&identity).expect("encode");
    let digest: String = Sha256::digest(&blob)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(digest, FIXED_REGISTRY_SHA256);
}
