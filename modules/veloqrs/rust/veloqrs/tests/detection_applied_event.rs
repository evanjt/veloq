//! A detection run announces its own end, on every exit path.
//!
//! The screens subscribe to `detection_applied` instead of draining
//! `poll_state` on a timer, so the event has to arrive whether the run
//! applied, aborted or died, and never before the outcome the poll will read.
//! A run that ends without announcing leaves the bar frozen at its last
//! percentage and the rescan screen never returns.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test detection_applied_event -p veloqrs`

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
    fn body_stored(&self, _kind: String, _activity_id: String) {}
    fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
    fn gps_track_stored(&self, _activity_id: String) {}
    fn fit_parsed(&self, _activity_id: String) {}
    fn detection_applied(&self) {
        self.applied.fetch_add(1, Ordering::SeqCst);
    }
    fn tiles_generated(&self) {}
    fn backfill_phase(&self, _phase: String) {}
    fn cutover_settled(&self) {}
    fn preview_phase(&self, _phase: String) {}
    fn preview_finished(&self) {}
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
        engine.set_section_config(cfg);
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

/// Wait for the `nth` notice without polling: a poll would reap the run and
/// hide the very ordering under test.
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
    let _serial = serial();
    let _dir = seeded_engine();
    let counter = Counter::new();
    set_observer(Some(counter.clone()));

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start"));
    wait_for_notice(&counter, 1);

    // The first poll after the notice is terminal: the guard drops after the
    // sender, so a subscriber that only ever polls here still sees the end.
    assert_eq!(
        detection.poll().expect("poll"),
        "complete",
        "the announcement must not outrun the outcome"
    );
    assert_eq!(counter.applied(), 1, "one run, one notice");

    set_observer(None);
}

#[test]
fn a_second_run_announces_again() {
    let _serial = serial();
    let _dir = seeded_engine();
    let counter = Counter::new();
    set_observer(Some(counter.clone()));

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start"));
    wait_for_notice(&counter, 1);
    assert_eq!(detection.poll().expect("poll"), "complete");

    assert!(detection.force_redetect().expect("second start"));
    wait_for_notice(&counter, 2);
    assert_eq!(
        detection.poll().expect("poll"),
        "complete",
        "the second announcement must not outrun its outcome either"
    );

    set_observer(None);
}

#[test]
fn a_run_with_no_observer_registered_still_finishes() {
    let _serial = serial();
    let _dir = seeded_engine();
    set_observer(None);

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start"));
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let status = detection.poll().expect("poll");
        if status != "running" {
            assert_eq!(status, "complete");
            break;
        }
        assert!(Instant::now() < deadline, "the detection run never ended");
        std::thread::sleep(Duration::from_millis(10));
    }
}
