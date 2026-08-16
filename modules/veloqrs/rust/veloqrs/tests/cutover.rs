//! Cutover: archive, switch, cold detect, diff, restore.
//!
//! Synthetic coordinates only. Run: `cargo test --test cutover -p veloqrs`

use std::sync::{Mutex, MutexGuard};
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::sections::DetectionMethod;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

static SERIAL: Mutex<()> = Mutex::new(());
fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn seed_corridor_engine(path: &std::path::Path) {
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.detection_method = DetectionMethod::Corridor;
        cfg.min_activities = 3;
        engine.set_section_config(cfg);
        for i in 0..4 {
            let id = format!("ride_{i}");
            engine
                .add_activity(id.clone(), line_track(i as f64 * 0.00002), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i as i64 * 14 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
        }
    })
    .unwrap();

    // Run one Corridor detect so we have a catalogue to archive.
    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache_update) = handle.recv_with_cache();
        let (sections, processed_ids) = main.expect("detect");
        engine
            .apply_sections_with_cache(sections, cache_update)
            .expect("apply");
        engine
            .save_processed_activity_ids(&processed_ids)
            .expect("save");
    })
    .unwrap();
}

#[test]
fn cutover_archives_switches_and_detects() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    let pre_count = with_persistent_engine(|e| e.get_sections().len()).unwrap();
    assert!(pre_count > 0, "the corridor detect produced no sections");

    let pre_method = with_persistent_engine(|e| e.get_section_config().detection_method).unwrap();
    assert_eq!(pre_method, DetectionMethod::Corridor);

    // The cutover should be owed: we are on Corridor and no token exists.
    assert!(veloqrs::ffi::is_cutover_pending());

    let result = veloqrs::ffi::run_detector_cutover();
    assert!(result.is_ok(), "cutover failed: {:?}", result.err());

    let diff_json = result.unwrap();
    assert!(!diff_json.is_empty(), "diff payload is empty");

    // Config should now be Unified.
    let post_method = with_persistent_engine(|e| e.get_section_config().detection_method).unwrap();
    assert_eq!(post_method, DetectionMethod::Unified);

    // Should no longer be pending.
    assert!(!veloqrs::ffi::is_cutover_pending());

    // A second run is a no-op.
    let second = veloqrs::ffi::run_detector_cutover().unwrap();
    assert_eq!(second, "not_owed");
}

#[test]
fn cutover_is_idempotent_on_rerun() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    let r1 = veloqrs::ffi::run_detector_cutover();
    assert!(r1.is_ok());

    let r2 = veloqrs::ffi::run_detector_cutover().unwrap();
    assert_eq!(r2, "not_owed", "second run should be a no-op");
}

#[test]
fn restore_gives_back_the_old_catalogue_as_pinned() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    let pre_ids: Vec<String> =
        with_persistent_engine(|e| e.get_sections().iter().map(|s| s.id.clone()).collect())
            .unwrap();
    assert!(!pre_ids.is_empty());

    veloqrs::ffi::run_detector_cutover().unwrap();

    // Restore.
    let restored = veloqrs::ffi::restore_from_cutover_archive();
    assert!(restored > 0, "nothing was restored");

    // Config should be back to Corridor.
    let method = with_persistent_engine(|e| e.get_section_config().detection_method).unwrap();
    assert_eq!(method, DetectionMethod::Corridor);

    // Should NOT be pending (reverted sentinel).
    assert!(!veloqrs::ffi::is_cutover_pending());

    // The restored sections should be marked user-defined (pinned).
    let pinned: Vec<bool> = with_persistent_engine(|e| {
        e.get_sections()
            .iter()
            .filter(|s| pre_ids.contains(&s.id))
            .map(|s| s.is_user_defined)
            .collect()
    })
    .unwrap();
    assert!(
        pinned.iter().all(|&p| p),
        "restored sections should be is_user_defined = true"
    );
}

#[test]
fn diff_payload_is_retrievable_after_restart() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    veloqrs::ffi::run_detector_cutover().unwrap();

    let diff = veloqrs::ffi::get_cutover_diff();
    assert!(diff.is_some(), "diff should be stored");

    let payload: serde_json::Value =
        serde_json::from_str(&diff.unwrap()).expect("diff is valid JSON");
    assert_eq!(payload["token"].as_str(), Some("unified-1"));
    assert!(
        payload["counts"]["current"].as_u64().unwrap_or(0) > 0,
        "diff should report non-zero current sections"
    );
}
