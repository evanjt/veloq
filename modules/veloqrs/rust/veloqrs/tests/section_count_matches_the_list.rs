//! The count beside a summaries list has to be a count of that list. A
//! disabled or superseded section is hidden from every section view, so
//! counting it makes the two halves of one record disagree, and the rescan
//! result reads "512 sections" over a list of 509.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;
use veloqrs::sections::CreateSectionParams;

fn engine_with_sections() -> (PersistentRouteEngine, TempDir) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("count.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();

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
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();
    assert!(
        engine.get_section_summaries().len() >= 3,
        "corpus produced too few sections to hide any"
    );
    (engine, dir)
}

#[test]
fn a_disabled_section_leaves_the_count() {
    let (mut engine, _dir) = engine_with_sections();
    let before = engine.get_section_count();

    let hidden = engine.get_section_summaries()[0].id.clone();
    engine.disable_section(&hidden).unwrap();

    assert_eq!(
        engine.get_section_count() as usize,
        engine.get_section_summaries().len(),
        "the count and the list it labels disagree"
    );
    assert_eq!(engine.get_section_count(), before - 1);
}

#[test]
fn a_superseded_section_leaves_the_count() {
    let (mut engine, _dir) = engine_with_sections();
    let summaries = engine.get_section_summaries();
    let before = engine.get_section_count();
    let auto = summaries[0].id.clone();

    let polyline = engine.get_section_by_id(&auto).unwrap().polyline;
    let custom = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline,
            distance_meters: 500.0,
            name: Some("Drawn".to_string()),
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .unwrap();
    engine.set_superseded(&auto, &custom).unwrap();

    assert_eq!(
        engine.get_section_count() as usize,
        engine.get_section_summaries().len(),
        "the count and the list it labels disagree"
    );
    // One auto hidden, one custom added, so the visible total is unchanged.
    assert_eq!(engine.get_section_count(), before);
}

/// With nothing hidden the two must still agree, or the fix has only moved
/// the disagreement.
#[test]
fn nothing_hidden_still_counts_every_section() {
    let (engine, _dir) = engine_with_sections();
    assert_eq!(
        engine.get_section_count() as usize,
        engine.get_section_summaries().len()
    );
}

/// Every section hidden is zero, not "some exist": the health check
/// redetects on that zero, and the section list gates its empty state on it.
#[test]
fn hiding_every_section_counts_none() {
    let (mut engine, _dir) = engine_with_sections();
    for s in engine.get_section_summaries() {
        engine.disable_section(&s.id).unwrap();
    }
    assert_eq!(engine.get_section_count(), 0);
    assert!(engine.get_section_summaries().is_empty());
}
