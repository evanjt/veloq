#[path = "../corpus_migration.rs"]
mod corpus_migration;

#[path = "../corpus_preview_identity.rs"]
mod corpus_preview_identity;

use std::sync::{Mutex, MutexGuard};

static SERIAL_STATE: Mutex<()> = Mutex::new(());

/// Every test here opens the one process-wide engine, and a cutover switches
/// its config, so a concurrent pair sees the other's state.
pub(crate) fn serial_state() -> MutexGuard<'static, ()> {
    SERIAL_STATE.lock().unwrap_or_else(|e| e.into_inner())
}
