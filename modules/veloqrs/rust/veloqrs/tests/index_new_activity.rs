//! Cheap per-activity indexing after ingest.
//!
//! Scenario: a library already has detected sections, then one new activity
//! arrives over the same corridor (the background push handler path).
//! Expected behaviour: index_new_activity attaches the activity to the
//! existing sections via junction rows, regroups incrementally, and is
//! idempotent on re-delivery — all without a full re-detection.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

#[test]
fn indexes_new_activity_against_existing_sections() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("index_new_activity.db");
    let db_path_str = path.to_str().unwrap();

    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 1,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });

    let mut engine = PersistentRouteEngine::new(db_path_str).unwrap();

    for activity in corpus.through_a() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .unwrap();
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .unwrap();
    }

    let handle = engine.detect_sections_background(None);
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();
    assert!(
        !engine.get_sections().is_empty(),
        "expected sections from 30 overlapping tracks"
    );

    let new_activity = &corpus.bucket_b_delta[0];
    engine
        .add_activity(
            new_activity.id.clone(),
            new_activity.gps_points.clone(),
            new_activity.sport_type.clone(),
        )
        .unwrap();

    let summary = engine.index_new_activity(&new_activity.id).unwrap();
    assert!(
        summary.matched_sections >= 1,
        "new corridor activity should match at least one existing section; got {:?}",
        summary
    );
    assert!(summary.inserted_portions >= 1, "expected junction rows: {:?}", summary);
    assert!(summary.regrouped, "ingest sets groups_dirty, so indexing must regroup");
    assert!(summary.indicators_recomputed, "indicators must refresh: {:?}", summary);

    let attached = engine.get_sections_for_activity(&new_activity.id);
    assert_eq!(
        attached.len() as u32,
        summary.matched_sections,
        "junction rows must make the activity queryable via get_sections_for_activity"
    );

    let in_memory_has_activity = engine
        .get_sections()
        .iter()
        .any(|s| s.activity_ids.iter().any(|id| id == &new_activity.id));
    assert!(
        in_memory_has_activity,
        "refresh_section_in_memory must expose the new activity on the in-memory section"
    );

    // Re-delivered webhook: same result, no duplicate rows.
    let again = engine.index_new_activity(&new_activity.id).unwrap();
    assert_eq!(again.matched_sections, summary.matched_sections);
    assert_eq!(again.inserted_portions, summary.inserted_portions);
    let attached_again = engine.get_sections_for_activity(&new_activity.id);
    assert_eq!(attached_again.len(), attached.len());
}

#[test]
fn returns_empty_summary_for_unknown_or_tiny_activity() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("index_empty.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();

    let summary = engine.index_new_activity("does-not-exist").unwrap();
    assert_eq!(summary.matched_sections, 0);
    assert_eq!(summary.inserted_portions, 0);
    assert!(!summary.regrouped);
}
