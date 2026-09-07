//! What a whole-database wipe costs the thread that calls it.
//!
//! `clear`, `clear_derived` and `clear_routes_and_sections` are all called
//! straight from the JS thread through `with_engine`, which is the **write**
//! lock. `clear_routes_and_sections` is the one that fires on a settings
//! toggle (`features/routes/stores/RouteSettingsStore.ts`), so it is the one
//! whose cost decides whether a switch freezes the app.
//!
//! Each wipe is destructive, so each is timed on its own engine built from the
//! same corpus. The build is the expensive part, not the measurement.
//!
//! Baseline only, nothing asserts. Run in release:
//!   cargo test --release --features synthetic --bench database_wipe_cost -- --ignored --nocapture

#![cfg(feature = "synthetic")]

use std::time::Instant;

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

/// Wide enough that the catalogue has real section and junction rows to delete
/// rather than a handful. `scale` multiplies both buckets, so the same corpus
/// shape is measured at a small library and at one the size Evan's actually is.
fn build_engine(scale: usize) -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("wipe.db");
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

    (engine, dir)
}

fn report(label: &str, sections: usize, activities: usize, elapsed_ms: f64) {
    println!("{label}: {elapsed_ms:.1} ms over {sections} sections and {activities} activities");
}

#[test]
#[ignore] // ~1 min per wipe; baseline for B482
fn wipe_cost_baseline() {
    for scale in [1, 5] {
        println!("--- scale {scale} ---");
        wipe_cost_at(scale);
    }
}

fn wipe_cost_at(scale: usize) {
    {
        let (mut engine, _tmp) = build_engine(scale);
        let sections = engine.get_sections().len();
        let activities = engine.activity_count();
        let start = Instant::now();
        engine
            .clear_routes_and_sections()
            .expect("clear_routes_and_sections");
        report(
            "clear_routes_and_sections",
            sections,
            activities,
            start.elapsed().as_secs_f64() * 1000.0,
        );
    }

    {
        let (mut engine, _tmp) = build_engine(scale);
        let sections = engine.get_sections().len();
        let activities = engine.activity_count();
        let start = Instant::now();
        engine.clear_derived().expect("clear_derived");
        report(
            "clear_derived",
            sections,
            activities,
            start.elapsed().as_secs_f64() * 1000.0,
        );
    }

    {
        let (mut engine, _tmp) = build_engine(scale);
        let sections = engine.get_sections().len();
        let activities = engine.activity_count();
        let start = Instant::now();
        engine.clear().expect("clear");
        report(
            "clear",
            sections,
            activities,
            start.elapsed().as_secs_f64() * 1000.0,
        );
    }
}
