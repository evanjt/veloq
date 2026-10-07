use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}

#[path = "../heatmap_announcement.rs"]
mod heatmap_announcement;

#[path = "../heatmap_tile_intercept.rs"]
mod heatmap_tile_intercept;

#[path = "../tile_scheme_handler.rs"]
mod tile_scheme_handler;
