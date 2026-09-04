//! Scenario: a sync spawns the heatmap tile pass and waits for it.
//!
//! Expected behaviour: the pass announces itself when it finishes, so the
//! waiting screen hears it instead of draining the worker's receiver on a
//! timer.

use std::sync::{Arc, Mutex, MutexGuard};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::objects::observer::{EngineObserver, set_observer};

/// Counts the announcements it hears, in order.
struct Recorder {
    events: Mutex<Vec<String>>,
}

impl Recorder {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            events: Mutex::new(Vec::new()),
        })
    }

    fn events(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl EngineObserver for Recorder {
    fn sync_progress(&self) {}
    fn sync_settled(&self) {}
    fn body_stored(&self, _kind: String, _activity_id: String) {}
    fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
    fn gps_track_stored(&self, _activity_id: String) {}
    fn fit_parsed(&self, _activity_id: String) {}
    fn detection_applied(&self) {}
    fn tiles_generated(&self) {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push("tiles_generated".to_string());
    }
    fn backfill_phase(&self, _phase: String) {}
    fn cutover_settled(&self) {}
    fn preview_finished(&self) {}
}

/// One short ride, enough that the pass has a tile to draw.
fn ride(seed: f64) -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint::new(46.2 + seed + f64::from(i) * 0.0005, 7.35 + seed))
        .collect()
}

/// The observer registry is process-wide, so a test that registers one runs
/// alone. Without this, one test's `set_observer(None)` lands between another's
/// registration and the pass it is waiting on.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn seeded_engine() -> (PersistentEngine, TempDir) {
    let tmp = TempDir::new().expect("tempdir");
    let db = tmp.path().join("heatmap.db");
    let mut engine = PersistentEngine::new(db.to_str().unwrap()).expect("open engine");
    for (i, seed) in [0.0, 0.01].into_iter().enumerate() {
        engine
            .add_activity(format!("a{i}"), ride(seed), "Ride".to_string())
            .expect("add_activity");
    }
    (engine, tmp)
}

fn drain_pass() {
    let handle = veloqrs::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .expect("a dirty cache spawns a pass");
    handle.recv_blocking().expect("the pass completes");
}

#[test]
fn a_finished_tile_pass_announces_itself() {
    let _serial = serial();
    let (mut engine, tmp) = seeded_engine();
    let tiles = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles).expect("create tiles dir");
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    engine.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());
    drain_pass();
    set_observer(None);

    assert_eq!(recorder.events(), vec!["tiles_generated"]);
}

#[test]
fn a_pass_run_with_nobody_listening_is_not_an_error() {
    let _serial = serial();
    let (mut engine, tmp) = seeded_engine();
    let tiles = tmp.path().join("tiles");
    std::fs::create_dir_all(&tiles).expect("create tiles dir");
    set_observer(None);

    engine.set_heatmap_tiles_path(tiles.to_str().unwrap().to_string());
    drain_pass();

    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));
    set_observer(None);
    assert!(recorder.events().is_empty());
}
