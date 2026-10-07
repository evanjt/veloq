//! A detect loads only the tracks the fold will read: the new activities plus
//! the members of the clusters they route into.
//!
//! Scenario: an athlete rides in three places far enough apart that the
//! detector's 50 km cluster gap keeps them separate, then records one more ride
//! at home.
//!
//! Expected behaviour: the catalogue that detect produces is the same one a
//! cold engine produces from the whole set. The fold's own guarantee is that an
//! incremental result is identical to the batch, and narrowing the pool is only
//! safe while that holds: the two other places' tracks are never read, and the
//! sections they hold are carried through untouched.
//!
//! Run: `cargo test --features synthetic --test detection_synthetic -p veloqrs -- detection_narrowed_pool::`

#![cfg(feature = "synthetic")]

use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

use crate::lifecycle_support::*;

/// Far enough apart that no pad bridges them: the cluster gap is 50 km and
/// these are thousands.
const PLACES: [(f64, f64); 3] = [(0.0, 0.0), (30.0, 40.0), (-25.0, 130.0)];

fn corpus() -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 24,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

/// The same ride, moved bodily to another part of the world.
fn moved(a: &LifecycleActivity, place: (f64, f64), suffix: &str) -> LifecycleActivity {
    LifecycleActivity {
        id: format!("{}_{suffix}", a.id),
        sport_type: a.sport_type.clone(),
        start_date_unix: a.start_date_unix,
        gps_points: a
            .gps_points
            .iter()
            .map(|p| GpsPoint {
                latitude: p.latitude + place.0,
                longitude: p.longitude + place.1,
                elevation: p.elevation,
            })
            .collect(),
    }
}

/// One library, three places, in a fixed order so both arms see the same set.
fn three_places() -> Vec<LifecycleActivity> {
    let base = corpus();
    let mut out = Vec::new();
    for (n, place) in PLACES.iter().enumerate() {
        for a in &base {
            out.push(moved(a, *place, &format!("p{n}")));
        }
    }
    out
}

/// Ingest and detect, insisting the worker answered.
///
/// `ingest_step` takes the detect's result as `unwrap_or_default`, so a worker
/// that panics reads as a detect that found nothing and leaves the previous
/// catalogue standing. A pool narrowed too far panics on a hard member lookup
/// inside the fold, which is exactly the failure this file has to see.
fn detect_expecting_an_answer(engine: &mut PersistentEngine, new: &[&LifecycleActivity]) {
    for a in new {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
    let (main, cache_update) = engine.detect_sections_background().recv_with_cache();
    let (sections, processed_ids) =
        main.expect("the detection worker died without sending a result");
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed_ids)
        .expect("save_processed_activity_ids");
}

#[test]
fn a_detect_after_one_new_ride_agrees_with_a_cold_detect_of_the_whole_library() {
    let _serial_state = super::serial_state();
    let library = three_places();
    let (early, latest) = library.split_at(library.len() - 1);

    // The drip: the library, then one more ride, against a warm evidence cache.
    let (mut warm, _warm_dir) = fresh_engine();
    ingest_step(&mut warm, "library", &refs(early));
    detect_expecting_an_answer(&mut warm, &[&library[library.len() - 1]]);
    let incremental = snapshot(&mut warm);
    let incremental_raw = raw_snapshot(&warm);

    // The batch: a cold engine given the whole set at once.
    let (mut cold, _cold_dir) = fresh_engine();
    ingest_step(&mut cold, "everything", &refs(&library));
    let batch = snapshot(&mut cold);
    let batch_raw = raw_snapshot(&cold);

    assert!(!latest.is_empty());
    assert_catalogue_populated("incremental", &incremental);
    assert_catalogue_populated("batch", &batch);
    // The raw catalogue is what the fold produces. The visible view lags it by
    // the debounce, and a ride that extends a section moves the raw line a
    // detect before the visible one.
    assert_eq!(
        incremental_raw.catalogue_signature(),
        batch_raw.catalogue_signature(),
        "a narrowed pool changed the catalogue: the fold was handed less than it reads"
    );
}

#[test]
fn a_second_detect_over_an_unchanged_library_does_not_move_it() {
    let _serial_state = super::serial_state();
    // With nothing new the plan is empty and the whole pool is loaded, which is
    // the path that must not regress into loading nothing.
    let library = three_places();
    let (mut engine, _dir) = fresh_engine();
    ingest_step(&mut engine, "library", &refs(&library));
    let first = snapshot(&mut engine);

    ingest_step(&mut engine, "again", &[]);
    let second = snapshot(&mut engine);

    assert_catalogue_populated("first", &first);
    assert_eq!(first.catalogue_signature(), second.catalogue_signature());
}

#[test]
fn a_new_ride_without_a_track_completes_without_clearing_a_warm_catalogue() {
    let _serial_state = super::serial_state();
    let library = three_places();
    let (mut engine, _dir) = fresh_engine();
    ingest_step(&mut engine, "library", &refs(&library));
    let before = snapshot(&mut engine);
    assert_catalogue_populated("before indoor ride", &before);

    for i in 0..4 {
        let indoor = LifecycleActivity {
            id: format!("indoor_{i}"),
            sport_type: "VirtualRide".to_string(),
            start_date_unix: library[0].start_date_unix + 100 + i,
            gps_points: Vec::new(),
        };
        detect_expecting_an_answer(&mut engine, &[&indoor]);
        assert_eq!(
            before.catalogue_signature(),
            snapshot(&mut engine).catalogue_signature(),
            "indoor ride {i} must preserve the catalogue"
        );
        assert!(!engine.detection_owed(), "the empty ride was processed");
    }
    for _ in 0..4 {
        detect_expecting_an_answer(&mut engine, &[]);
        assert_eq!(
            before.catalogue_signature(),
            snapshot(&mut engine).catalogue_signature()
        );
    }
}

#[test]
fn multi_cluster_detect_advances_progress_during_the_fold() {
    let _serial_state = super::serial_state();
    let library = three_places();
    let (mut engine, _dir) = fresh_engine();
    for activity in &library {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .expect("add activity");
    }

    let handle = engine.detect_sections_background();
    let progress = handle.progress.clone();
    let mut between = false;
    let started = std::time::Instant::now();
    while progress.get_phase() != "saving"
        && progress.get_phase() != "complete"
        && started.elapsed() < std::time::Duration::from_secs(30)
    {
        let percent = progress.get_percent();
        if percent > 4 && percent < 85 {
            between = true;
            break;
        }
        std::thread::yield_now();
    }
    assert!(
        handle.recv().is_ok(),
        "the multi-cluster detect must finish"
    );
    assert!(
        between,
        "fold progress must move between loading and saving"
    );
}
