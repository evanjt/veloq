use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

/// Every test starts signed out: a credential left standing narrows the
/// detection pool to tracks with elevation, so the next test's seed would
/// detect over nothing. A test that needs a session stands one up itself.
fn serial_state() -> MutexGuard<'static, ()> {
    let guard = SERIAL.lock().unwrap_or_else(|error| error.into_inner());
    veloqrs::objects::clear_credentials_from_native();
    guard
}

#[path = "../detection_applied_event.rs"]
mod detection_applied_event;

#[path = "../detection_disabled.rs"]
mod detection_disabled;

#[path = "../detection_seconds_wired.rs"]
mod detection_seconds_wired;

#[path = "../detection_suspension.rs"]
mod detection_suspension;

#[path = "../cutover.rs"]
mod cutover;

#[path = "../cutover_retired_from_v12.rs"]
mod cutover_retired_from_v12;

#[path = "../cutover_staged_from_v12.rs"]
mod cutover_staged_from_v12;

#[path = "../detection_last_run.rs"]
mod detection_last_run;
