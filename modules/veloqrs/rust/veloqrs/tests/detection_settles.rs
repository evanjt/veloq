//! Locked decision 4: the catalogue is a pure function of the activity set.
//!
//! Detection re-runs on every sync, and the identity layer feeds the previous
//! catalogue back in as the prior. So repeated detection over an UNCHANGED set
//! is a fixed-point question, not a no-op: hysteresis may legitimately move the
//! visible catalogue for a few rounds, but decision 7 requires it to converge
//! and never flip-flop. A catalogue that kept moving would rewrite the user's
//! section list, and their history timeline, on every sync forever.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test detection_settles`

#![cfg(feature = "synthetic")]

mod lifecycle_support;

use lifecycle_support::*;
use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

/// Enough overlapping traffic to form several corridors, small enough to
/// re-detect many times in a debug build.
fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
}

/// An engine on the Unified arm holding a detected catalogue over `corpus`.
/// Unified is explicit: the shipped default is still Corridor until the B3
/// flip, and Corridor's damped view does not settle.
fn detected_engine(dir: &TempDir, corpus: &LifecycleCorpus) -> PersistentRouteEngine {
    let path = dir.path().join("settles.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();
    let cfg = SectionConfig {
        ..SectionConfig::default()
    };
    engine.set_section_config(cfg);

    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .unwrap();
    }
    engine
}

/// One detect+apply round, as a sync performs it.
fn redetect(engine: &mut PersistentRouteEngine) {
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();
}

#[test]
fn repeated_detection_over_one_set_reaches_a_fixed_point() {
    let dir = TempDir::new().unwrap();
    let corpus = corpus();
    let mut engine = detected_engine(&dir, &corpus);

    redetect(&mut engine);
    let settled = snapshot(&mut engine).catalogue_signature();
    assert!(
        !settled.is_empty(),
        "expected a catalogue from 30 overlapping tracks"
    );

    // Ten more rounds with nothing added. Any drift here reaches the user as a
    // section list that reshuffles on every sync.
    for round in 0..10 {
        redetect(&mut engine);
        assert_eq!(
            snapshot(&mut engine).catalogue_signature(),
            settled,
            "visible catalogue moved on round {round} with no activity added"
        );
    }
}

#[test]
fn the_visible_catalogue_settles_onto_what_detection_found() {
    let dir = TempDir::new().unwrap();
    let corpus = corpus();
    let mut engine = detected_engine(&dir, &corpus);

    for _ in 0..3 {
        redetect(&mut engine);
    }

    let visible = snapshot(&mut engine);
    let raw = raw_snapshot(&engine);
    assert_eq!(
        visible.count(),
        raw.count(),
        "visible catalogue holds sections detection did not find"
    );
}

#[test]
fn both_read_paths_floor_on_the_same_population() {
    let dir = TempDir::new().unwrap();
    let corpus = corpus();
    let mut engine = detected_engine(&dir, &corpus);
    redetect(&mut engine);

    // The DB counts distinct activities on junction rows, which follow the
    // DRAWN line. The in-memory filter must count that same population, or a
    // section sitting on the floor appears in one list and not the other.
    for s in engine.get_sections_by_type(None) {
        let db_outings = s.activity_ids.len() as u32;
        let in_memory = engine
            .get_sections_filtered(None, Some(db_outings))
            .into_iter()
            .any(|f| f.id == s.id);
        assert!(
            in_memory,
            "section {} shows {} outings in the summaries but is filtered out at that floor",
            s.id, db_outings
        );
    }
}
