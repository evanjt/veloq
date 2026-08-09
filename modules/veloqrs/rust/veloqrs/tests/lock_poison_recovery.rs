//! Poison recovery on the global engine lock.
//!
//! Scenario: something panics while holding the `PERSISTENT_ENGINE` write
//! lock. Release builds unwind, so `std::sync::RwLock` marks itself poisoned
//! and every later `.write()` / `.read()` returns `Err`.
//!
//! Expected behaviour: the accessors keep serving. Around twenty call sites
//! use `unwrap_or_else(|e| e.into_inner())` for exactly this. Drop that
//! recovery and one panic turns every engine-backed screen blank for the rest
//! of the session, with no crash and no error message to point at.
//!
//! Each test poisons the lock itself rather than relying on a sibling, and
//! they take `SERIAL` because the engine and the panic hook are process-wide.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Mutex;
use tempfile::TempDir;
use veloqrs::objects::error::{with_engine, with_engine_read};
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::{with_persistent_engine, with_persistent_engine_read};

static SERIAL: Mutex<()> = Mutex::new(());

/// Initialise the process-global engine on a throwaway database. The TempDir
/// is returned so the caller keeps it alive for the length of the test.
fn init_global_engine() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("poison.db");
    assert!(
        persistent_engine_init(db_path.to_string_lossy().into_owned()),
        "the fixture database must open"
    );
    tmp
}

/// Run a closure that panics, swallowing the unwind and the default hook's
/// output so the test log stays readable.
fn panic_quietly<F: FnOnce()>(f: F) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let result = catch_unwind(AssertUnwindSafe(f));
    std::panic::set_hook(previous);
    assert!(result.is_err(), "the closure was supposed to panic");
}

/// Every accessor onto the global engine still answers.
fn assert_all_accessors_serve(context: &str) {
    assert!(
        with_persistent_engine(|engine| engine.activity_count()).is_some(),
        "with_persistent_engine went dead after {}",
        context
    );
    assert!(
        with_persistent_engine_read(|engine| engine.activity_count()).is_some(),
        "with_persistent_engine_read went dead after {}",
        context
    );
    assert!(
        with_engine(|engine| engine.activity_count()).is_ok(),
        "with_engine answered LockFailed after {}",
        context
    );
    assert!(
        with_engine_read(|engine| engine.activity_count()).is_ok(),
        "with_engine_read answered LockFailed after {}",
        context
    );
}

#[test]
fn write_accessor_recovers_from_a_poisoned_lock() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = init_global_engine();

    assert_all_accessors_serve("a clean init");

    panic_quietly(|| {
        with_persistent_engine(|_engine| panic!("mutation blew up under the write lock"));
    });

    assert_all_accessors_serve("a panic inside with_persistent_engine");
}

#[test]
fn read_accessor_recovers_from_a_poisoned_lock() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = init_global_engine();

    // std only poisons on an exclusive panic, so a writer poisons the lock
    // first and the read closure then panics under it.
    panic_quietly(|| {
        with_persistent_engine(|_engine| panic!("writer blew up"));
    });
    panic_quietly(|| {
        with_persistent_engine_read(|_engine| panic!("reader blew up"));
    });

    assert_all_accessors_serve("a panic inside with_persistent_engine_read");
}

#[test]
fn ffi_accessors_recover_from_a_poisoned_lock() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = init_global_engine();

    panic_quietly(|| {
        let _ = with_engine(|_engine| panic!("FFI call blew up under the write lock"));
    });

    assert_all_accessors_serve("a panic inside with_engine");
}
