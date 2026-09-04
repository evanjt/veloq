//! A preview run announces its own end, and the outcome is readable when it does.
//!
//! The screen subscribes to `preview_finished` instead of polling, so the
//! event has to arrive on every exit path and never before the outcome the
//! poller will read.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test preview_finished_event -p veloqrs`

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::FfiSectionConfig;
use veloqrs::objects::SectionPreview;
use veloqrs::objects::observer::{EngineObserver, set_observer};
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// Counts the finish notices and nothing else.
struct Counter {
    finished: AtomicUsize,
}

impl Counter {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            finished: AtomicUsize::new(0),
        })
    }

    fn finished(&self) -> usize {
        self.finished.load(Ordering::SeqCst)
    }
}

impl EngineObserver for Counter {
    fn sync_progress(&self) {}
    fn sync_settled(&self) {}
    fn body_stored(&self, _kind: String, _activity_id: String) {}
    fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
    fn gps_track_stored(&self, _activity_id: String) {}
    fn fit_parsed(&self, _activity_id: String) {}
    fn detection_applied(&self) {}
    fn tiles_generated(&self) {}
    fn backfill_phase(&self, _phase: String) {}
    fn cutover_settled(&self) {}
    fn preview_finished(&self) {
        self.finished.fetch_add(1, Ordering::SeqCst);
    }
}

/// A ~2.2 km line: 200 points ~11 m apart, laterally jittered per activity
/// within GPS drift.
fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn seed_engine() {
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
}

fn seeded_engine() -> (TempDir, FfiSectionConfig) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    seed_engine();
    let cfg = with_persistent_engine(|engine| engine.get_section_config()).expect("config");
    (dir, FfiSectionConfig::from(&cfg))
}

/// Wait for the `nth` finish notice, without polling the preview: a poll would
/// reap the run and hide the very ordering under test.
fn wait_for_finish(counter: &Counter, nth: usize) {
    let deadline = Instant::now() + Duration::from_secs(120);
    while counter.finished() < nth {
        assert!(
            Instant::now() < deadline,
            "the preview run never announced its end"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Poll to a terminal status, for the one test that has no notice to wait on.
fn wait_for_terminal(preview: &SectionPreview) -> String {
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let status = preview.poll().expect("poll");
        if status != "running" {
            return status;
        }
        assert!(Instant::now() < deadline, "the preview run never ended");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_completed_preview_announces_once_and_the_outcome_is_readable() {
    let _serial = serial();
    let (_dir, cfg) = seeded_engine();
    let counter = Counter::new();
    set_observer(Some(counter.clone()));

    let preview = SectionPreview::new();
    assert!(preview.start(46.01, 7.0, cfg).expect("start"));
    wait_for_finish(&counter, 1);

    // The first poll after the notice is terminal: the sender is gone by the
    // time the notice lands, so a subscriber that only ever polls here still
    // sees the run end.
    assert_eq!(
        preview.poll().expect("poll"),
        "complete",
        "the announcement must not outrun the outcome"
    );
    assert!(preview.take_result().expect("take").is_some());
    assert_eq!(counter.finished(), 1, "one run, one notice");

    set_observer(None);
}

#[test]
fn a_cancelled_preview_still_announces() {
    let _serial = serial();
    let (_dir, cfg) = seeded_engine();
    let counter = Counter::new();
    set_observer(Some(counter.clone()));

    let preview = SectionPreview::new();
    assert!(preview.start(46.01, 7.0, cfg).expect("start"));
    preview.cancel().expect("cancel");
    wait_for_finish(&counter, 1);

    let status = preview.poll().expect("poll");
    assert!(
        status == "cancelled" || status == "complete",
        "a cancelled run ends cancelled, or completes if the cancel arrived late, got '{status}'"
    );
    assert_eq!(counter.finished(), 1, "one run, one notice");

    set_observer(None);
}

#[test]
fn a_second_run_announces_again() {
    let _serial = serial();
    let (_dir, cfg) = seeded_engine();
    let counter = Counter::new();
    set_observer(Some(counter.clone()));

    let preview = SectionPreview::new();
    assert!(preview.start(46.01, 7.0, cfg.clone()).expect("start"));
    wait_for_finish(&counter, 1);
    assert_eq!(preview.poll().expect("poll"), "complete");
    assert!(preview.take_result().expect("take").is_some());

    assert!(preview.start(46.01, 7.0, cfg).expect("second start"));
    wait_for_finish(&counter, 2);
    assert_eq!(
        preview.poll().expect("poll"),
        "complete",
        "the second announcement must not outrun its outcome either"
    );
    assert!(preview.take_result().expect("take").is_some());

    set_observer(None);
}

#[test]
fn a_run_with_no_observer_registered_still_finishes() {
    let _serial = serial();
    let (_dir, cfg) = seeded_engine();
    set_observer(None);

    let preview = SectionPreview::new();
    assert!(preview.start(46.01, 7.0, cfg).expect("start"));
    assert_eq!(wait_for_terminal(&preview), "complete");
    assert!(preview.take_result().expect("take").is_some());
}
