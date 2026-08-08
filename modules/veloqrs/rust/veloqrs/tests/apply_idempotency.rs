//! Applying an unchanged catalogue twice must leave storage untouched.
//!
//! Since D4/D5 a catalogue save can also write a geometry version and a history
//! row. Those tables are kept forever, so a save path that wrote on every apply
//! would grow the history of a section that never changed and fill the section's
//! timeline with events the user never caused. Detection re-runs on every sync,
//! so "same input, no writes" is the property that keeps the timeline honest.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test apply_idempotency`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

/// Small enough to detect quickly in debug, large enough to form corridors.
const COLD_N: usize = 24;

fn cold_corpus(bucket_a_count: usize) -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        ..LifecycleConfig::default()
    })
}

/// Rows the first apply must have written, so an all-empty fingerprint can
/// never pass this test by comparing nothing with nothing.
fn stored_row_count(engine: &mut PersistentRouteEngine) -> usize {
    let snap = snapshot(engine);
    snap.ids()
        .into_iter()
        .map(|id| engine.section_geometry_versions(id).len() + engine.section_history(id).len())
        .sum()
}

/// Everything a repeated apply could disturb: the visible catalogue, the stored
/// geometry versions, and the event timeline.
fn storage_fingerprint(engine: &mut PersistentRouteEngine) -> String {
    let snap = snapshot(engine);
    let mut out = snap.catalogue_signature();
    for id in snap.ids() {
        let versions: Vec<String> = engine
            .section_geometry_versions(id)
            .into_iter()
            .map(|v| format!("{}:{}", v.version, v.milestone))
            .collect();
        let events: Vec<String> = engine
            .section_history(id)
            .into_iter()
            .map(|e| format!("{}@{:?}", e.kind, e.geometry_version))
            .collect();
        out.push_str(&format!(
            "\n{} geom[{}] hist[{}]",
            id,
            versions.join(","),
            events.join(",")
        ));
    }
    out
}

#[test]
fn reapplying_the_same_catalogue_writes_nothing() {
    let corpus = cold_corpus(COLD_N);
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);

    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }

    let handle = engine.detect_sections_background();
    let (sections, processed) = handle.recv().unwrap_or_default();
    assert!(
        !sections.is_empty(),
        "the corpus must form sections for this test to mean anything"
    );

    engine
        .apply_sections(sections.clone())
        .expect("first apply");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save processed");
    let first = storage_fingerprint(&mut engine);
    assert!(
        stored_row_count(&mut engine) > 0,
        "the first apply wrote no geometry or history rows, so repetition proves nothing"
    );

    engine
        .apply_sections(sections.clone())
        .expect("second apply");
    let second = storage_fingerprint(&mut engine);

    assert_eq!(
        first, second,
        "re-applying an unchanged catalogue changed stored state"
    );

    engine.apply_sections(sections).expect("third apply");
    let third = storage_fingerprint(&mut engine);
    assert_eq!(first, third, "a third identical apply changed stored state");
}
