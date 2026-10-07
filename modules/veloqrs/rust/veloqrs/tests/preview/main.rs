use std::sync::{Mutex, MutexGuard};

static SERIAL: Mutex<()> = Mutex::new(());

fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}

#[path = "../preview_cluster.rs"]
mod preview_cluster;

#[path = "../preview_current.rs"]
mod preview_current;

#[path = "../preview_finished_event.rs"]
mod preview_finished_event;

#[path = "../preview_pool_gate.rs"]
mod preview_pool_gate;

#[path = "../preview_purity.rs"]
mod preview_purity;

#[path = "../named_corridor_first_read.rs"]
mod named_corridor_first_read;

#[path = "../grouping_preview_signature_cache.rs"]
mod grouping_preview_signature_cache;
