//! A batch stored through the FFI activity object lands a catalogue on its
//! own. Demo seeding and the recording save path both add through this
//! object rather than the sync fetcher, so nothing else starts their run.
//!
//! Sequential by nature: the object writes the process-global engine.

#![cfg(feature = "synthetic")]

use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::objects::activities::ActivityManager;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

#[test]
fn a_batch_added_through_the_ffi_conditions_itself() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("ffi_add.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });

    let mut ids = Vec::new();
    let mut coords = Vec::new();
    let mut offsets = Vec::new();
    let mut sports = Vec::new();
    for activity in corpus.through_a() {
        ids.push(activity.id.clone());
        offsets.push((coords.len() / 2) as u32);
        for p in &activity.gps_points {
            coords.push(p.latitude);
            coords.push(p.longitude);
        }
        sports.push(activity.sport_type.clone());
    }
    assert!(ids.len() > 1);

    ActivityManager::new()
        .add(ids, coords, offsets, sports)
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let count = with_persistent_engine(|engine| engine.get_sections().len()).unwrap();
        if count > 0 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the FFI add never produced a catalogue"
        );
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[test]
fn a_ride_added_while_detection_is_held_still_gets_its_sections() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("ffi_add_attach.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });

    with_persistent_engine(|engine| {
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
        let (sections, _) = engine.detect_sections_background().recv().unwrap();
        engine.apply_sections(sections).unwrap();
        assert!(!engine.get_sections().is_empty());
    })
    .unwrap();

    let ride = &corpus.bucket_c_single;
    let coords: Vec<f64> = ride
        .gps_points
        .iter()
        .flat_map(|p| [p.latitude, p.longitude])
        .collect();
    let _held = veloqrs::persistence::suspend_detection();
    ActivityManager::new()
        .add(
            vec![ride.id.clone()],
            coords,
            vec![0],
            vec![ride.sport_type.clone()],
        )
        .unwrap();

    let sections =
        with_persistent_engine(|engine| engine.get_sections_for_activity(&ride.id)).unwrap();
    assert!(
        !sections.is_empty(),
        "a ride stored over sectioned ground must attach without a detect run"
    );
}
