//! Mid-backfill conditioning drives itself to a durable catalogue.
//!
//! Scenario: a long first sync stores activities one by one through the
//! ingest hooks. At the conditioning cadence a detection run fires, and the
//! Rust driver thread applies its result with no TS poll anywhere.
//!
//! Runs as a single sequential test because the conditioning driver applies
//! through the process-global `PERSISTENT_ENGINE`, exactly like production.

#![cfg(feature = "synthetic")]

use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::sections::conditioning;
use veloqrs::persistence::with_persistent_engine;

#[test]
fn backfill_cadence_conditions_without_any_ts_poll() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("conditioning.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    with_persistent_engine(|engine| {
        engine.set_section_config(tracematch::sections::SectionConfig {
            detection_method: tracematch::DetectionMethod::Unified,
            ..Default::default()
        });
    })
    .unwrap();

    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: conditioning::CONDITIONING_BATCH_ADDS as usize,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });

    let mut fired = 0;
    for activity in corpus.through_a() {
        with_persistent_engine(|engine| {
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
            engine.attach_stored_activity(&activity.id);
        })
        .unwrap();
        conditioning::note_stored(1);
        if conditioning::maybe_condition_backfill() {
            fired += 1;
        }
    }
    assert_eq!(fired, 1, "the cadence fires exactly once at the threshold");

    // The driver thread owns poll + apply from here. Wait for the durable
    // catalogue with no TS-side poll call anywhere in this test.
    let deadline = Instant::now() + Duration::from_secs(120);
    let sections = loop {
        let count = with_persistent_engine(|engine| engine.get_sections().len()).unwrap();
        if count > 0 {
            break count;
        }
        assert!(
            Instant::now() < deadline,
            "conditioning driver never applied a catalogue"
        );
        std::thread::sleep(Duration::from_millis(200));
    };
    assert!(sections > 0);

    // The applied run also advances the processed set, so a sync-end detect
    // over the same pool short-circuits instead of re-deriving.
    let processed = with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (sections_again, _) = handle.recv().unwrap_or_default();
        (sections_again.len(), engine.get_sections().len())
    })
    .unwrap();
    assert_eq!(
        processed.0, processed.1,
        "sync-end detect over an already-conditioned pool returns the same catalogue"
    );
}
