//! A detection run announces its own end, on every exit path.
//!
//! The screens subscribe to `detection_applied` instead of draining
//! `poll_state` on a timer, so the event has to arrive whether the run
//! applied, aborted or died, and never before the outcome a follower reads.
//! The worker frees its own slot before it announces, so one follower poll
//! returns the recorded outcome without taking it.
//! A run that ends without announcing leaves the bar frozen at its last
//! percentage and the rescan screen never returns.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test detection_global -p veloqrs -- detection_applied_event::`

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::objects::DetectionManager;
use veloqrs::objects::observer::{EngineObserver, set_observer};
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// The engine and the observer registry are both process-wide.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// Counts the end notices.
struct Counter {
    applied: AtomicUsize,
}

impl Counter {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            applied: AtomicUsize::new(0),
        })
    }

    fn applied(&self) -> usize {
        self.applied.load(Ordering::SeqCst)
    }
}

impl EngineObserver for Counter {
    fn sync_progress(&self) {}
    fn sync_settled(&self) {}
    fn activities_stored(&self) {}
    fn body_stored(&self, _kind: String, _activity_id: String) {}
    fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
    fn gps_track_stored(&self, _activity_id: String) {}
    fn gps_tracks_mutated(&self, _activity_ids: Vec<String>) {}
    fn fit_parsed(&self, _activity_id: String) {}
    fn detection_applied(&self) {
        self.applied.fetch_add(1, Ordering::SeqCst);
    }
    fn tiles_generated(&self) {}
    fn backfill_phase(&self, _phase: String) {}
    fn stream_backfill_phase(&self, _phase: String) {}
    fn cutover_settled(&self) {}
    fn preview_phase(&self, _phase: String) {}
    fn preview_finished(&self) {}
    fn recordings_changed(&self) {}
    fn upload_permission_refused(&self) {}
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

/// Drain any run a previous case left installed: the handle slot is
/// process-wide and a failed case can leave one behind.
fn drain_any_running_detection() {
    let detection = DetectionManager::new();
    let deadline = Instant::now() + Duration::from_secs(120);
    while detection.poll().unwrap_or_default() == "running" {
        assert!(
            Instant::now() < deadline,
            "a run from an earlier case hangs"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn seeded_engine() -> TempDir {
    drain_any_running_detection();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.min_activities = 3;
        engine
            .set_section_config(cfg)
            .expect("set the section config");
        for i in 0..4 {
            let id = format!("ride_{i}");
            engine
                .add_activity(
                    id.clone(),
                    line_track(f64::from(i) * 0.00002),
                    "Ride".into(),
                )
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
    .expect("engine installed");
    dir
}

/// What a follower reads at a run's end, as `detectionRun.ts` reads it.
fn followed_outcome(detection: &DetectionManager) -> String {
    detection.poll().expect("poll")
}

/// Wait for the `nth` notice without polling: a poll could take the result
/// before the worker settles it and hide the very ordering under test.
fn wait_for_notice(counter: &Counter, nth: usize) {
    let deadline = Instant::now() + Duration::from_secs(120);
    while counter.applied() < nth {
        assert!(
            Instant::now() < deadline,
            "the detection run never announced its end"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_completed_detection_announces_once_and_the_outcome_is_readable() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let _dir = seeded_engine();
    let counter = Counter::new();
    set_observer(Some(counter.clone()));

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start").started());
    wait_for_notice(&counter, 1);

    // The worker settles before the guard announces, so the first read after
    // the notice finds the slot free and the verdict already recorded.
    assert!(detection.get_progress().expect("progress").is_none());
    assert_eq!(
        detection.poll().expect("poll"),
        "complete",
        "the follower reads the completed outcome after the slot is free"
    );
    assert_eq!(
        detection.last_outcome(),
        "complete",
        "the announcement must not outrun the outcome"
    );
    assert_eq!(counter.applied(), 1, "one run, one notice");

    veloqrs::objects::observer::flush();
    set_observer(None);
}

#[test]
fn a_second_run_announces_again() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let _dir = seeded_engine();
    let counter = Counter::new();
    set_observer(Some(counter.clone()));

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start").started());
    wait_for_notice(&counter, 1);
    assert_eq!(followed_outcome(&detection), "complete");

    // A start clears the previous verdict, so the first run's "complete"
    // cannot stand in for the second's.
    assert!(detection.force_redetect().expect("second start").started());
    wait_for_notice(&counter, 2);
    assert_eq!(
        followed_outcome(&detection),
        "complete",
        "the second announcement must not outrun its outcome either"
    );

    veloqrs::objects::observer::flush();
    set_observer(None);
}

#[test]
fn a_run_with_no_observer_registered_still_finishes() {
    let _serial_state = super::serial_state();
    let _serial = serial();
    let _dir = seeded_engine();
    veloqrs::objects::observer::flush();
    set_observer(None);

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start").started());
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let status = followed_outcome(&detection);
        if status != "running" {
            assert_eq!(status, "complete");
            break;
        }
        assert!(Instant::now() < deadline, "the detection run never ended");
        std::thread::sleep(Duration::from_millis(10));
    }
}
