//! What the sync batch tail costs the engine write lock.
//!
//! Every sync ends with one `attach_finalize` under the **write** lock
//! (`ffi.rs`, the attach batch tail), which either regroups when the ingest
//! marked groups dirty or recomputes activity indicators when junction rows
//! landed. It is the last long holder on the async path: `B475` took the bulk
//! exports off the lock and `B482`/`B503` own the wipes, so this is the number
//! `B489` was missing.
//!
//! Both arms are timed, on the same corpus, because which one runs depends on
//! whether the batch created a new group and the two do different work. The
//! sync arm ingests a handful of activities first, so the regroup takes the
//! incremental path a real sync reaches rather than the full rebuild.
//!
//! Baseline only, nothing asserts. Run in release:
//!   cargo test --release --features synthetic --bench attach_finalize_cost -- --ignored --nocapture

#![cfg(feature = "synthetic")]

use std::time::Instant;

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

/// How many activities a sync brings in, which is what decides whether the
/// regroup takes its incremental path or the full one.
const NEW_PER_SYNC: usize = 3;

/// `scale` multiplies the corpus, so the same shape is measured at a small
/// library and at one the size a real athlete's is.
fn build_engine(scale: usize) -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("attach.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");

    let cfg = LifecycleConfig {
        bucket_a_count: 60 * scale,
        bucket_b_delta_count: 90 * scale,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    for activity in corpus.through_b() {
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

    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("initial apply");
    // The build leaves the groups dirty. Consume that here so each arm below
    // starts from a settled catalogue and measures only what it means to.
    engine.get_groups();

    (engine, dir)
}

/// Add the activities a sync would bring in, the way ingest does, so the
/// regroup that follows has new signatures to place. Returns how many landed.
fn ingest_new(engine: &mut PersistentEngine, scale: usize) -> usize {
    let cfg = LifecycleConfig {
        bucket_a_count: 60 * scale,
        bucket_b_delta_count: 90 * scale,
        bucket_d_delta_count: NEW_PER_SYNC,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    let existing = engine.activity_count();
    let mut added = 0;
    for activity in corpus.through_d().into_iter().skip(existing) {
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
        added += 1;
    }
    added
}

fn report(label: &str, sections: usize, activities: usize, elapsed_ms: f64) {
    println!("{label}: {elapsed_ms:.1} ms over {sections} sections and {activities} activities");
}

#[test]
#[ignore] // ~1 min per scale; baseline for B489
fn attach_finalize_cost_baseline() {
    for scale in [1, 5] {
        println!("--- scale {scale} ---");

        // The indicator arm: junction rows landed and nothing marked the
        // groups dirty, which is the ordinary sync of activities on routes
        // the athlete already has. The build leaves the groups dirty, so they
        // are consumed first or this arm measures the regroup as well.
        let (mut engine, _tmp) = build_engine(scale);
        let sections = engine.get_sections().len();
        let activities = engine.activity_count();
        let start = Instant::now();
        let (regrouped, indicators) = engine.attach_finalize(1);
        report(
            &format!("attach_finalize indicators (regrouped={regrouped}, ran={indicators})"),
            sections,
            activities,
            start.elapsed().as_secs_f64() * 1000.0,
        );

        // The sync arm, and the one that matters: a handful of new
        // activities landed, so the tail regroups with the incremental path
        // the ingest actually reaches.
        let added = ingest_new(&mut engine, scale);
        let start = Instant::now();
        let (regrouped, indicators) = engine.attach_finalize(1);
        report(
            &format!(
                "attach_finalize sync of {added} new (regrouped={regrouped}, ran={indicators})"
            ),
            sections,
            activities + added,
            start.elapsed().as_secs_f64() * 1000.0,
        );

        // Nothing landed and nothing is dirty: the tail must cost nothing at
        // all, which is what makes the two arms above the whole cost.
        let start = Instant::now();
        let (regrouped, indicators) = engine.attach_finalize(0);
        report(
            &format!("attach_finalize idle (regrouped={regrouped}, ran={indicators})"),
            sections,
            activities,
            start.elapsed().as_secs_f64() * 1000.0,
        );
    }
}
