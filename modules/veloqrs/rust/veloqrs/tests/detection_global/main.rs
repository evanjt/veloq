use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
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

#[path = "../detection_last_run.rs"]
mod detection_last_run;
