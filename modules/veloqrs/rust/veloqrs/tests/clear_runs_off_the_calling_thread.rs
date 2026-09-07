//! The whole-database wipes run on a Rust thread, not the caller's.
//!
//! Scenario: "Clear cache" and "Clear & Sync" both take the engine write lock
//! over every table. Measured at 734 ms and 401 ms on a 750-activity library
//! (`B482`), and on the JavaScript thread that is a button that freezes the
//! app for as long as the wipe runs. The catalogue wipe was moved off it
//! already; these two were not.
//!
//! Expected behaviour: start returns at once, the poll reports the wipe while
//! it runs and its result when it lands, and the slot is free for the next
//! one either way.
//!
//! These share the process-global engine, so they take `SERIAL`.
//!
//! Run: `cargo test --test clear_runs_off_the_calling_thread -p veloqrs`

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::{
    clear_all_background, clear_derived_background, with_persistent_engine,
};

static SERIAL: Mutex<()> = Mutex::new(());

fn track(base: f64) -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: base + f64::from(i) * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

fn seeded_engine() -> TempDir {
    let tmp = TempDir::new().expect("tempdir");
    let path = tmp.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8").to_string()
    ));
    with_persistent_engine(|engine| {
        for i in 0..8 {
            engine
                .add_activity(format!("a{i}"), track(46.0 + f64::from(i)), "Ride".into())
                .expect("add activity");
        }
    })
    .expect("engine open");
    tmp
}

fn activity_count() -> usize {
    with_persistent_engine(|engine| engine.activity_count()).expect("engine open")
}

/// Block until the handle answers, the way the JavaScript waiter polls.
fn settle<T>(poll: impl Fn() -> veloqrs::persistence::WorkerPoll<Result<T, String>>) -> T {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match poll() {
            veloqrs::persistence::WorkerPoll::Running => {
                assert!(Instant::now() < deadline, "the wipe never finished");
                std::thread::sleep(Duration::from_millis(5));
            }
            veloqrs::persistence::WorkerPoll::Ready(Ok(value)) => return value,
            veloqrs::persistence::WorkerPoll::Ready(Err(msg)) => panic!("wipe failed: {msg}"),
            veloqrs::persistence::WorkerPoll::Died => panic!("wipe thread died"),
        }
    }
}

#[test]
fn the_derived_clear_runs_on_its_own_thread_and_reports_what_went() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = seeded_engine();
    assert_eq!(activity_count(), 8, "seed must land");

    let handle = clear_derived_background();
    let cleared = settle(|| handle.poll_state());

    assert_eq!(cleared.activities_removed, 8);
    assert_eq!(cleared.activities_kept, 0);
    assert_eq!(activity_count(), 0);
}

#[test]
fn the_whole_wipe_runs_on_its_own_thread() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = seeded_engine();
    assert_eq!(activity_count(), 8, "seed must land");

    let handle = clear_all_background();
    settle(|| handle.poll_state());

    assert_eq!(activity_count(), 0);
}
