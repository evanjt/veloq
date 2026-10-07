use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}

#[path = "../heatmap_idempotent.rs"]
mod heatmap_idempotent;

#[path = "../heatmap_parity.rs"]
mod heatmap_parity;

#[path = "../heatmap_tile_set.rs"]
mod heatmap_tile_set;

#[path = "../heatmap_work_is_cancellable.rs"]
mod heatmap_work_is_cancellable;

#[path = "../tile_pass_slot.rs"]
mod tile_pass_slot;
