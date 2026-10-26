//! Scenario: a mixed-sport library detected from two ingest orders, then
//! detected a second time over the same pool.
//! Expected behaviour: every run spans all sports and yields the same section
//! membership, so the catalogue is a pure function of the pool plus config.

#![cfg(feature = "synthetic")]

use std::collections::{BTreeSet, HashMap};

use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

fn corpus() -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 40,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 2,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

fn ingest(engine: &mut PersistentEngine, activities: &[LifecycleActivity]) {
    for activity in activities {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }
}

fn detect(engine: &mut PersistentEngine) {
    let handle = engine.detect_sections_background();
    let (sections, processed) = handle.recv().expect("the detect ran");
    engine.apply_sections(sections).expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
}

/// Member activities of every section, order-free.
fn catalogue(engine: &PersistentEngine) -> Vec<Vec<String>> {
    let mut entries: Vec<Vec<String>> = engine
        .get_sections()
        .iter()
        .map(|s| {
            let mut ids = s.activity_ids.clone();
            ids.sort();
            ids
        })
        .collect();
    entries.sort();
    entries
}

/// Sports of the activities that ended up in the catalogue.
fn covered_sports(engine: &PersistentEngine, activities: &[LifecycleActivity]) -> BTreeSet<String> {
    let sports: HashMap<&str, &str> = activities
        .iter()
        .map(|a| (a.id.as_str(), a.sport_type.as_str()))
        .collect();
    engine
        .get_sections()
        .iter()
        .flat_map(|s| s.activity_ids.iter())
        .filter_map(|id| sports.get(id.as_str()).map(|s| s.to_string()))
        .collect()
}

fn pooled_unified(engine: &mut PersistentEngine) {
    engine
        .set_section_config(SectionConfig {
            pool_sports: true,
            ..SectionConfig::default()
        })
        .expect("config accepted");
}

/// Further arrivals riding the ground of the engine's largest section: copies
/// of one of its members, dated after the pool, one per re-cut confirmation.
fn riders_of_the_largest_section(
    engine: &PersistentEngine,
    activities: &[LifecycleActivity],
) -> Vec<LifecycleActivity> {
    let sections = engine.get_sections();
    let largest = sections
        .iter()
        .max_by_key(|s| s.activity_ids.len())
        .expect("a section to ride");
    let member = activities
        .iter()
        .find(|a| largest.activity_ids.contains(&a.id))
        .expect("a member of the section is in the pool");
    let last = activities
        .iter()
        .map(|a| a.start_date_unix)
        .max()
        .unwrap_or(0);
    (1..=RECUT_ARRIVALS)
        .map(|n| LifecycleActivity {
            id: format!("{}_rider_{n}", member.id),
            start_date_unix: last + 86_400 * n as i64,
            ..member.clone()
        })
        .collect()
}

/// Arrivals a re-cut waits for before it shows.
const RECUT_ARRIVALS: usize = 3;

/// Scenario: one engine detects the pooled-sport pool cold; another grows it
/// incrementally over the evidence cache; both then settle.
/// Expected behaviour: the two engines hold the same section membership.
#[test]
fn test_pooled_cold_and_warm_detections_agree() {
    let _serial_state = super::serial_state();
    let activities = corpus();
    let dir = TempDir::new().unwrap();

    let cold_path = dir.path().join("cold.db");
    let mut cold = PersistentEngine::new(cold_path.to_str().unwrap()).expect("engine");
    pooled_unified(&mut cold);
    ingest(&mut cold, &activities);
    detect(&mut cold);

    let warm_path = dir.path().join("warm.db");
    let mut warm = PersistentEngine::new(warm_path.to_str().unwrap()).expect("engine");
    pooled_unified(&mut warm);
    let (head, tail) = activities.split_at(activities.len() / 2);
    ingest(&mut warm, head);
    detect(&mut warm);
    ingest(&mut warm, tail);

    detect(&mut warm);
    detect(&mut cold);

    // A grown line sheds the rides that no longer run it end to end, and the
    // warm engine holds that re-cut until `k` arrivals have been through it.
    // Both engines receive those arrivals one sync at a time, so each sits at
    // the fold's fixed point for the same pool.
    let ridden = riders_of_the_largest_section(&cold, &activities);
    for rider in &ridden {
        ingest(&mut warm, std::slice::from_ref(rider));
        ingest(&mut cold, std::slice::from_ref(rider));
        detect(&mut warm);
        detect(&mut cold);
    }
    // Idle detects advance nothing, so these only settle the cold view.
    for _ in 0..8 {
        detect(&mut warm);
        detect(&mut cold);
    }

    let raw = |e: &PersistentEngine| -> Vec<Vec<String>> {
        let mut v: Vec<Vec<String>> = e
            .raw_detection_catalogue()
            .iter()
            .map(|s| {
                let mut ids = s.activity_ids.clone();
                ids.sort();
                ids
            })
            .collect();
        v.sort();
        v
    };
    assert_eq!(
        raw(&cold),
        raw(&warm),
        "raw pooled batches must agree cold and warm"
    );

    let expected = catalogue(&cold);
    assert!(
        !expected.is_empty(),
        "expected sections from the pooled pool"
    );
    assert_eq!(
        expected,
        catalogue(&warm),
        "pooled cold and warm engines must agree on the same pool"
    );
}

#[test]
fn test_detection_catalogue_stable_across_invocations() {
    let _serial_state = super::serial_state();
    let activities = corpus();

    let dir = TempDir::new().unwrap();
    let start_path = dir.path().join("start.db");
    let mut start_engine = PersistentEngine::new(start_path.to_str().unwrap()).expect("engine");
    ingest(&mut start_engine, &activities);
    detect(&mut start_engine);

    let reversed_path = dir.path().join("reversed.db");
    let mut reversed_engine =
        PersistentEngine::new(reversed_path.to_str().unwrap()).expect("engine");
    let mut reversed: Vec<LifecycleActivity> = activities.clone();
    reversed.reverse();
    ingest(&mut reversed_engine, &reversed);
    detect(&mut reversed_engine);

    let expected = catalogue(&start_engine);
    assert!(!expected.is_empty(), "expected sections from the corpus");

    let sports = covered_sports(&start_engine, &activities);
    assert!(
        sports.len() > 1,
        "detection must span every sport in the pool, got {:?}",
        sports
    );

    assert_eq!(
        expected,
        catalogue(&reversed_engine),
        "catalogue must not depend on ingest order"
    );

    detect(&mut start_engine);
    assert_eq!(
        expected,
        catalogue(&start_engine),
        "re-invoking detection over the same pool must not change the catalogue"
    );
}
