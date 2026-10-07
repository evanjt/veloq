//! Scenario: four timers on the routes screens polled four progress exports,
//! each taking the engine lock on its own interval, and the elevation count
//! was read from three files on three schedules.
//!
//! Expected behaviour: one read answers all of them, and it answers the same
//! as the four it replaces, including the two distinctions that are easy to
//! flatten: a count that cannot be answered is null rather than zero, and it
//! is not taken at all while a pass is reporting its own figures.
//!
//! Runs against the process-global engine, so the tests take a file-local lock
//! and run one at a time.

use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use veloqrs::ffi::{
    get_cutover_progress, get_elevation_backfill_progress, get_elevation_backfill_remaining,
    get_routes_status_data, get_stream_backfill_progress, get_stream_backfill_remaining,
    is_elevation_backfill_paused,
};
use veloqrs::persistence::close_for_restore;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn open_engine() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    dir
}

#[test]
fn one_read_answers_what_the_four_exports_answer() {
    let _serial_state = crate::serial_state();
    let _serial = serial();
    let _dir = open_engine();

    let status = get_routes_status_data();

    let elevation = get_elevation_backfill_progress();
    assert_eq!(status.elevation.phase, elevation.phase);
    assert_eq!(status.elevation.completed, elevation.completed);
    assert_eq!(status.elevation.total, elevation.total);
    assert_eq!(status.elevation.failed, elevation.failed);
    assert_eq!(status.elevation.percent, elevation.percent);
    assert_eq!(status.elevation_paused, is_elevation_backfill_paused());
    assert_eq!(status.cutover.phase, get_cutover_progress().phase);
    assert_eq!(status.cutover.running, get_cutover_progress().running);
    assert_eq!(
        status.elevation_remaining,
        get_elevation_backfill_remaining().ok()
    );

    let stream = get_stream_backfill_progress();
    assert_eq!(status.stream.phase, stream.phase);
    assert_eq!(status.stream.completed, stream.completed);
    assert_eq!(status.stream.stored, stream.stored);
    assert_eq!(
        status.stream_remaining,
        get_stream_backfill_remaining().ok()
    );
}

#[test]
fn an_idle_library_reports_no_detection() {
    let _serial_state = crate::serial_state();
    let _serial = serial();
    let _dir = open_engine();

    let status = get_routes_status_data();

    assert!(
        status.detection.is_none(),
        "no run holds the detection slot, so there is no progress to report"
    );
    assert_eq!(
        status.elevation_remaining,
        Some(0),
        "an empty library has nothing left to ask about, which is not the same as being unable to say"
    );
    assert_eq!(status.stream_remaining, Some(0));
    assert_eq!(
        status.detection_outcome, "idle",
        "no run has finished in this process, which is not the same as one that failed"
    );
}

/// A count that cannot be taken is null, not zero. The launch trigger stamps
/// the app version on a zero and the cutover trigger reads one as permission
/// to cut, so flattening the two would cut against a library nobody asked
/// about.
#[test]
fn a_count_the_engine_cannot_answer_is_null() {
    let _serial_state = crate::serial_state();
    let _serial = serial();
    close_for_restore();

    let status = get_routes_status_data();

    assert_eq!(status.elevation_remaining, None);
    assert_eq!(status.stream_remaining, None);
}
