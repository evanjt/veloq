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
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("ffi_add.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
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
