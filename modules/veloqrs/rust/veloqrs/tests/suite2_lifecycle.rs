//! Suite #2, config & evidence lifecycle.
//!
//! Changing detection config re-analyses the existing library, and removing an
//! activity purges its contribution. Method-agnostic persistence behaviour, run
//! on the fast Control arm. Snapshots read the user-visible DB view.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_lifecycle`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use tracematch::sections::SectionConfig;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// Target gate (B1 config invalidation): changing to a far stricter config must
/// re-analyse the existing library, not silently keep stale sections. With
/// min_activities=50 on a ~60-activity corpus the correct catalogue is empty.
/// Green under B1, `set_section_config` now clears `processed_activity_ids`, so
/// the next trigger re-detects the whole library under the new config instead of
/// short-circuiting on the seen activities.
#[test]
fn config_change_reanalyses() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cold", &corpus.through_a());

    let mut strict = SectionConfig::default();
    strict.min_activities = 50;
    engine.set_section_config(strict);
    let after = ingest_step(&mut engine, "trigger", &[&corpus.bucket_c_single]).snapshot;

    assert_eq!(
        after.count(),
        0,
        "config change to min_activities=50 left {} stale sections (should re-analyse to 0)",
        after.count(),
    );
}

/// Removing an activity purges its contribution from the sections it fed
/// (invariant 6: deleting activities is the only way evidence leaves). The
/// junction rows cascade on the activity_id foreign key, the identity registry
/// drops the gone member, and the processed set is cleared so the next detect
/// re-derives the library without it.
#[test]
fn remove_activity_purges_evidence() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;

    let victim = cold
        .sections
        .values()
        .flat_map(|s| s.activity_ids.iter())
        .next()
        .cloned()
        .expect("a section with a contributing activity");

    engine.remove_activity(&victim).expect("remove_activity");
    let after = snapshot(&mut engine);

    let still_referenced: Vec<String> = after
        .sections
        .iter()
        .filter(|(_, s)| s.activity_ids.contains(&victim))
        .map(|(id, _)| id.clone())
        .collect();
    println!(
        "[control] removed activity {victim}: still referenced by {} section(s) {:?}",
        still_referenced.len(),
        still_referenced,
    );
    assert!(
        still_referenced.is_empty(),
        "removed activity {victim} still contributes to sections {still_referenced:?} (evidence not purged)"
    );
}
