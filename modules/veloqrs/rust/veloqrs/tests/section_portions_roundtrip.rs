//! End-to-end protection for Bug A: section activity_portions must
//! round-trip through the full detection → save → reload path.
//!
//! The bug: `split_section_by_density` in tracematch's postprocess used
//! to construct split sections with `activity_portions: Vec::new()` and
//! a comment "Will be recomputed later if needed" — but the
//! recomputation never happened. save_sections then iterated empty
//! portions and inserted 0 junction rows. On reload, the section
//! appeared with 0 attached activities — "0 sections attached" in the
//! UI.
//!
//! This test runs the full pipeline on a dataset designed to trigger
//! density-based splitting, then asserts that every saved section has:
//!  - non-empty activity_ids
//!  - non-empty activity_portions
//!  - junction-table rows matching the in-memory portions
//!
//! If Bug A regresses (anywhere in tracematch or veloqrs), this test
//! will catch it at the save-and-reload boundary.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

#[test]
fn detection_save_reload_preserves_activity_portions() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("portions_roundtrip.db");
    let db_path_str = path.to_str().unwrap();

    // ---- Build & run detection -------------------------------------
    {
        let mut engine = PersistentRouteEngine::new(db_path_str).unwrap();

        // Lifecycle corpus produces tracks that overlap heavily on a
        // shared corridor, plus some parallel streets — exactly the
        // shape that triggers `split_high_variance_sections` (the
        // postprocess phase where Bug A lived).
        let corpus = LifecycleCorpus::generate(&LifecycleConfig {
            bucket_a_count: 40,
            bucket_b_delta_count: 0,
            bucket_d_delta_count: 0,
            bucket_e_delta_count: 0,
            parallel_street_count: 3,
            ..LifecycleConfig::default()
        });

        for activity in corpus.through_b() {
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

        // Run detection: the background thread does the work, recv
        // pulls the result, apply_sections persists it.
        let handle = engine.detect_sections_background(None);
        let (sections, _) = handle.recv().unwrap_or_default();
        engine.apply_sections(sections).unwrap();
    }

    // ---- Reload from disk and inspect ------------------------------
    let mut engine2 = PersistentRouteEngine::new(db_path_str).unwrap();
    engine2.load().unwrap();
    let sections = engine2.get_sections().to_vec();

    // Should produce at least one section from 40 overlapping tracks.
    assert!(
        !sections.is_empty(),
        "expected ≥ 1 section after detection on 40 overlapping tracks; got 0. \
         The spatial filter (Phase 3) may have pruned all pairs, or \
         the algorithm produced no candidates."
    );

    // Bug A invariant: every saved section must have non-empty
    // activity_portions if it has any activity_ids. The defensive
    // warning in save_sections will fire if this is violated, but
    // the durable contract is in the junction table — empty portions
    // → no rows → activity_ids reloaded as empty.
    let mut sections_with_portions = 0usize;
    for section in sections.iter() {
        assert!(
            !section.activity_ids.is_empty(),
            "section {} reloaded with empty activity_ids — junction table \
             didn't get any rows for it. Bug A may have regressed.",
            section.id
        );
        assert!(
            !section.activity_portions.is_empty(),
            "section {} has activity_ids {:?} but empty activity_portions — \
             this is exactly the Bug A symptom (sections shown but with \
             '0 sections attached' in the UI).",
            section.id,
            section.activity_ids,
        );
        sections_with_portions += 1;

        // Every activity in activity_ids should have at least one portion.
        // (The reverse — portions referencing non-listed activities —
        // shouldn't happen either.)
        for activity_id in &section.activity_ids {
            let portions_for_activity: Vec<_> = section
                .activity_portions
                .iter()
                .filter(|p| &p.activity_id == activity_id)
                .collect();
            assert!(
                !portions_for_activity.is_empty(),
                "section {} lists activity {} in activity_ids but has \
                 no matching portion — partial mismatch indicates a \
                 portion-computation bug in the split or detection \
                 code path.",
                section.id,
                activity_id,
            );
        }
    }

    assert!(
        sections_with_portions > 0,
        "all {} reloaded sections had empty activity_portions",
        sections.len()
    );
}
