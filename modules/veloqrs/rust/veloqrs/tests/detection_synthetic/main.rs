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

#[path = "../lifecycle_support/mod.rs"]
mod lifecycle_support;

#[path = "../detection_final_cache.rs"]
mod detection_final_cache;

#[path = "../detection_fixed_point.rs"]
mod detection_fixed_point;

#[path = "../detection_narrowed_pool.rs"]
mod detection_narrowed_pool;

#[path = "../detection_pool_invariance.rs"]
mod detection_pool_invariance;

#[path = "../detection_settles.rs"]
mod detection_settles;

#[path = "../detection_parallel_routes.rs"]
mod detection_parallel_routes;

#[path = "../detection_determinism.rs"]
mod detection_determinism;

#[path = "../ffi_add_conditions.rs"]
mod ffi_add_conditions;

#[path = "../conditioning_driver.rs"]
mod conditioning_driver;

#[path = "../elevation_backfill.rs"]
mod elevation_backfill;
