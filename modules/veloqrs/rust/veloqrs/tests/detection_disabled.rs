//! Turning section detection off turns it off in the engine.
//!
//! Scenario: the athlete turns the detection switch off. `Q61` leans on that
//! switch being the honest opt-out, "turning that switch off turns the feature
//! off completely". It used to be a TypeScript display filter: Rust started a
//! conditioning detect at the end of every stored batch and knew nothing about
//! it, so the engine kept cutting the catalogue and spending the CPU while the
//! screens looked away (`B258`).
//!
//! Runs against the process-global engine, exactly like production, so the
//! tests take a file-local lock and run one at a time.

use std::sync::{Mutex, MutexGuard};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::persistent_engine_ffi::{
    SECTION_DETECTION_HANDLE, persistent_engine_init,
};
use veloqrs::persistence::sections::conditioning::try_start_conditioning;
use veloqrs::persistence::sections::{DETECTION_PHASE_DISABLED, detection_was_refused};
use veloqrs::persistence::with_persistent_engine;

static SERIAL: Mutex<()> = Mutex::new(());
fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// The same line six times with a metre or two of jitter, the shape
/// `tests/cutover.rs` uses to get a catalogue out of a detect.
fn track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

/// Four rides over the same ground, so a detect that runs produces sections.
fn seeded_engine() -> TempDir {
    drain_slot();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.min_activities = 3;
        engine.set_section_config(cfg);
        for i in 0..4 {
            let id = format!("a{}", i);
            engine
                .add_activity(id.clone(), track(f64::from(i) * 0.00002), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i64::from(i) * 14 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
        }
    })
    .expect("engine");
    dir
}

fn drain_slot() {
    if let Some(handle) = SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let _ = handle.recv_with_cache();
    }
}

fn detect_and_apply() -> usize {
    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache) = handle.recv_with_cache();
        match main {
            Some((sections, processed)) => {
                let count = sections.len();
                engine
                    .apply_sections_with_cache(sections, cache)
                    .expect("apply");
                engine
                    .save_processed_activity_ids(&processed)
                    .expect("save");
                count
            }
            None => 0,
        }
    })
    .expect("engine")
}

#[test]
fn a_detect_is_refused_while_detection_is_disabled() {
    let _serial = serial();
    let _dir = seeded_engine();

    with_persistent_engine(|e| e.set_detection_enabled(false).expect("write setting"))
        .expect("engine");

    let phase = with_persistent_engine(|e| e.detect_sections_background().get_progress().0)
        .expect("engine");
    assert_eq!(phase, DETECTION_PHASE_DISABLED);
    assert_eq!(
        with_persistent_engine(|e| e.get_sections().len()).expect("engine"),
        0,
        "a refused detect must leave the catalogue untouched"
    );
}

#[test]
fn conditioning_will_not_start_while_detection_is_disabled() {
    let _serial = serial();
    let _dir = seeded_engine();

    with_persistent_engine(|e| e.set_detection_enabled(false).expect("write setting"))
        .expect("engine");

    assert!(!try_start_conditioning());
    assert!(
        SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_none(),
        "a refused handle must not occupy the slot"
    );
}

#[test]
fn re_enabling_detects_again() {
    let _serial = serial();
    let _dir = seeded_engine();

    with_persistent_engine(|e| e.set_detection_enabled(false).expect("write setting"))
        .expect("engine");
    assert_eq!(detect_and_apply(), 0);

    with_persistent_engine(|e| e.set_detection_enabled(true).expect("write setting"))
        .expect("engine");
    assert!(
        detect_and_apply() > 0,
        "re-enabling detects on the next run"
    );
}

#[test]
fn detection_is_enabled_on_a_fresh_install() {
    let _serial = serial();
    let _dir = seeded_engine();

    assert!(with_persistent_engine(|e| e.detection_enabled()).expect("engine"));
    assert!(detect_and_apply() > 0);
}

#[test]
fn the_setting_survives_a_reopen() {
    let _serial = serial();
    let dir = seeded_engine();
    let path = dir.path().join("routes.db");

    with_persistent_engine(|e| e.set_detection_enabled(false).expect("write setting"))
        .expect("engine");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

    assert!(!with_persistent_engine(|e| e.detection_enabled()).expect("engine"));
}

/// The disabled refusal is its own phase, so the sections page can tell an
/// install that turned detection off from one that is waiting on the migration.
#[test]
fn the_disabled_refusal_is_distinct_from_the_others() {
    let _serial = serial();
    let _dir = seeded_engine();

    with_persistent_engine(|e| e.set_detection_enabled(false).expect("write setting"))
        .expect("engine");

    let handle = with_persistent_engine(|e| e.detect_sections_background()).expect("engine");
    assert_eq!(handle.get_progress().0, DETECTION_PHASE_DISABLED);
    assert!(detection_was_refused(&handle));
    assert!(!veloqrs::ffi::is_cutover_pending());
    assert!(!veloqrs::persistence::detection_suspended());
}
