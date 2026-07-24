//! Suite #2 — config & evidence lifecycle.
//!
//! Changing detection config must re-analyse the existing library; the current
//! engine silently doesn't. Method-agnostic persistence behaviour, run on the
//! fast Control arm. Snapshots read the user-visible DB view.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_lifecycle -- --nocapture`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use tracematch::sections::SectionConfig;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// Measurement: change the detection config to something far stricter, trigger
/// detection, and print whether the existing catalogue re-analyses.
#[test]
fn config_change_effect_today() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let before = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;

    let mut strict = SectionConfig::default();
    strict.min_activities = 50; // no synthetic corridor has 50 passes → a batch would find 0
    engine.set_section_config(strict);
    let after = ingest_step(&mut engine, "trigger", &[&corpus.bucket_c_single]).snapshot;

    println!(
        "[control] config min_activities default→50: sections {} → {} (a from-scratch batch under this config is 0)",
        before.count(),
        after.count(),
    );
}

/// Target gate (B1 config invalidation): changing to a far stricter config must
/// re-analyse the existing library, not silently keep stale sections. With
/// min_activities=50 on a ~60-activity corpus the correct catalogue is empty.
/// Fails today — `set_section_config` doesn't clear `processed_activity_ids`, so
/// the next trigger runs incrementally and the stale sections survive.
#[test]
#[ignore = "B1 config invalidation not built — config change doesn't re-analyse existing sections"]
fn config_change_reanalyses() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
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
