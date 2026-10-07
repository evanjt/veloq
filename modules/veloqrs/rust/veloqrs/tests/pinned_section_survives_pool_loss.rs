//! Scenario: the athlete pins an auto section, then every activity that
//! traversed it leaves the pool, and the next detect is applied.
//!
//! Expected behaviour: the pinned section stays in the catalogue and on disk
//! with no traversals, and an unpinned section in the same state is dropped.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

fn engine_with_detected_sections() -> (PersistentEngine, Vec<tracematch::FrequentSection>, TempDir)
{
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("pinned.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
    }
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().expect("the detect ran");
    engine.apply_sections(sections.clone()).unwrap();
    assert!(
        engine.get_section_summaries().len() >= 2,
        "corpus produced too few sections"
    );
    (engine, sections, dir)
}

fn listed(engine: &PersistentEngine) -> Vec<String> {
    engine
        .get_sections_filtered(None, None)
        .into_iter()
        .map(|s| s.id.clone())
        .collect()
}

#[test]
fn a_pinned_section_whose_traversals_left_the_pool_survives_the_next_apply() {
    let (mut engine, sections, _dir) = engine_with_detected_sections();
    let pinned = engine.get_section_summaries()[0].id.clone();
    let loose = engine.get_section_summaries()[1].id.clone();
    assert!(engine.pin_section_geometry(&pinned, 1).unwrap(), "pin v1");

    let every_activity: Vec<String> = sections
        .iter()
        .flat_map(|s| s.activity_ids.iter().cloned())
        .collect();
    for id in &every_activity {
        let _ = engine.remove_activity(id);
    }

    engine.apply_sections(sections).unwrap();

    assert!(
        listed(&engine).contains(&pinned),
        "a pin freezes existence, so an empty pool must not take the section"
    );
    assert!(
        !listed(&engine).contains(&loose),
        "an unpinned section with no pooled traversal is still dropped"
    );

    let path = engine.get_section_by_id(&pinned).map(|s| s.id);
    assert_eq!(path.as_deref(), Some(pinned.as_str()));
}

#[test]
fn the_pinned_section_is_still_on_disk_after_a_reopen() {
    let (mut engine, sections, dir) = engine_with_detected_sections();
    let pinned = engine.get_section_summaries()[0].id.clone();
    assert!(engine.pin_section_geometry(&pinned, 1).unwrap());
    for id in sections.iter().flat_map(|s| s.activity_ids.iter()) {
        let _ = engine.remove_activity(id);
    }
    engine.apply_sections(sections).unwrap();
    drop(engine);

    let mut reopened =
        PersistentEngine::new(dir.path().join("pinned.db").to_str().unwrap()).unwrap();
    reopened.load().unwrap();

    assert!(listed(&reopened).contains(&pinned));
}
