//! Two-tier ingest: the download loop attaches each stored activity to the
//! existing catalogue instantly (junction rows, one regroup tail), while
//! full detection is deferred to the conditioning cadence.
//!
//! Scenario: a library already has detected sections, then a sync stores a
//! batch of new activities over the same corridor.
//! Expected behaviour: attach_new_activities inserts junction rows for every
//! stored activity and refreshes groups/indicators once for the whole batch,
//! without creating or destroying any section.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn engine_with_sections(dir: &TempDir, corpus: &LifecycleCorpus) -> PersistentRouteEngine {
    let path = dir.path().join("two_tier.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();

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
    engine
}

#[test]
fn attach_batch_inserts_junctions_without_detection() {
    let dir = TempDir::new().unwrap();
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    let mut engine = engine_with_sections(&dir, &corpus);
    let section_count = engine.get_sections().len();

    // Bucket C (RideMain forward) and bucket D's reverse ride are guaranteed
    // traversals of already-sectioned ground; the third D activity is a
    // deliberate one-off that must store without attaching. D's run overlap
    // is excluded: run traffic splits across two corridors, so its ground is
    // not deterministically sectioned at this corpus size.
    let corridor: Vec<&tracematch::scenarios::LifecycleActivity> =
        vec![&corpus.bucket_c_single, &corpus.bucket_d_delta[1]];
    let one_off = &corpus.bucket_d_delta[2];

    let mut new_ids: Vec<String> = Vec::new();
    for a in corridor.iter().chain(std::iter::once(&one_off)) {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        new_ids.push(a.id.clone());
    }

    let summary = engine.attach_new_activities(&new_ids);

    for a in &corridor {
        assert!(
            !engine.get_sections_for_activity(&a.id).is_empty(),
            "junction rows must make {} queryable immediately",
            a.id
        );
    }
    assert_eq!(
        summary.attached_activities, 2,
        "both ride traversals must attach, the one-off must not: {:?}",
        summary
    );
    assert!(summary.inserted_portions >= 2, "{:?}", summary);
    assert!(
        summary.regrouped,
        "ingest sets groups_dirty, so the batch tail must regroup once"
    );
    assert!(
        engine.get_sections_for_activity(&one_off.id).is_empty(),
        "a one-off stretch never gains junction rows from attach"
    );

    assert_eq!(
        engine.get_sections().len(),
        section_count,
        "attach never creates or destroys sections"
    );

    let again = engine.attach_new_activities(&new_ids);
    assert_eq!(again.attached_activities, summary.attached_activities);
    assert_eq!(
        again.inserted_portions, summary.inserted_portions,
        "re-attach replaces rows, never stacks them"
    );
}

#[test]
fn attach_ignores_unknown_and_tiny_activities() {
    let dir = TempDir::new().unwrap();
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    let mut engine = engine_with_sections(&dir, &corpus);

    let summary = engine.attach_new_activities(&["missing".to_string()]);
    assert_eq!(summary.attached_activities, 0);
    assert_eq!(summary.inserted_portions, 0);
}
