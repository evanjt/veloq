//! Why the engine did not open, not just that it did not.
//!
//! Scenario: init fails at launch and the banner says "Route engine failed to
//! initialise" for every cause. A database from a newer build is fixed by
//! updating the app, a locked one by waiting a moment, and an unwritable
//! directory by neither. Expected behaviour: the engine records which, so the
//! banner can say what to do about it.
//!
//! Corruption is deliberately not a failure here. It quarantines and reopens,
//! so its outcome is `Opened`, and this pins that.
//!
//! These share the process-global engine, so they take `SERIAL`.
//!
//! Run: `cargo test --test engine_init_outcome -p veloqrs`

use std::fs;
use std::sync::Mutex;
use tempfile::TempDir;
use veloqrs::objects::FfiInitOutcome;
use veloqrs::persistence::persistent_engine_ffi::{last_init_outcome, persistent_engine_init};
use veloqrs::{GpsPoint, PersistentEngine};

static SERIAL: Mutex<()> = Mutex::new(());

fn seeded(db_str: &str) {
    let mut engine = PersistentEngine::new(db_str).expect("engine new");
    engine
        .add_activity(
            "a1".to_string(),
            vec![
                GpsPoint::new(46.2330, 7.3600),
                GpsPoint::new(46.2340, 7.3610),
                GpsPoint::new(46.2350, 7.3620),
            ],
            "Ride".to_string(),
        )
        .expect("seed");
}

#[test]
fn a_database_that_opens_records_opened() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = TempDir::new().unwrap();
    let db_str = tmp.path().join("routes.db").to_string_lossy().into_owned();
    seeded(&db_str);

    assert!(persistent_engine_init(db_str));
    assert_eq!(last_init_outcome(), FfiInitOutcome::Opened);
}

/// Lock contention lifts on its own, so the outcome has to say the retry is
/// worth making. This is the one refusal the banner should not blame the
/// athlete for.
#[test]
fn a_locked_database_records_busy_and_opens_on_the_retry() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    let db_str = db_path.to_string_lossy().into_owned();
    seeded(&db_str);

    let mut blocker = rusqlite::Connection::open(&db_path).unwrap();
    let held = blocker
        .transaction_with_behavior(rusqlite::TransactionBehavior::Exclusive)
        .unwrap();

    assert!(!persistent_engine_init(db_str.clone()));
    assert_eq!(last_init_outcome(), FfiInitOutcome::Busy);
    assert!(last_init_outcome().is_retryable());

    drop(held);
    drop(blocker);

    assert!(persistent_engine_init(db_str));
    assert_eq!(last_init_outcome(), FfiInitOutcome::Opened);
}

/// The one failure the athlete can fix, and the one that must never read as
/// corruption: the file is healthy and this build is behind it.
#[test]
fn a_forward_schema_records_its_own_reason() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    let db_str = db_path.to_string_lossy().into_owned();
    seeded(&db_str);

    let supported = veloqrs::persistence::SUPPORTED_SCHEMA_VERSION;
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('schema_version', ?)",
        rusqlite::params![(supported + 1).to_string()],
    )
    .unwrap();
    drop(conn);

    assert!(!persistent_engine_init(db_str));
    assert_eq!(last_init_outcome(), FfiInitOutcome::ForwardSchema);
    assert!(!last_init_outcome().is_retryable());
}

/// A parent that is a plain file cannot be created as a directory, whoever the
/// process runs as. That is the same answer a full disk or a denied permission
/// gives: nothing can be written where the database belongs.
#[test]
fn a_directory_that_cannot_be_created_records_storage_unavailable() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = TempDir::new().unwrap();
    let blocking_file = tmp.path().join("not-a-dir");
    fs::write(&blocking_file, b"x").unwrap();
    let db_str = blocking_file
        .join("routes.db")
        .to_string_lossy()
        .into_owned();

    assert!(!persistent_engine_init(db_str));
    assert_eq!(last_init_outcome(), FfiInitOutcome::StorageUnavailable);
    assert!(!last_init_outcome().is_retryable());
}

/// Corruption is recovered, not reported. The athlete loses a cache the next
/// sync refills, and the engine opens, so the outcome must not read as a
/// failure or the banner would appear over a working engine.
#[test]
fn a_corrupt_database_still_records_opened() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    let db_str = db_path.to_string_lossy().into_owned();
    seeded(&db_str);

    let mut bytes = fs::read(&db_path).unwrap();
    for b in &mut bytes[1024..4096] {
        *b = 0xFF;
    }
    fs::write(&db_path, bytes).unwrap();
    let _ = fs::remove_file(format!("{}-wal", db_str));
    let _ = fs::remove_file(format!("{}-shm", db_str));

    assert!(persistent_engine_init(db_str));
    assert_eq!(last_init_outcome(), FfiInitOutcome::Opened);
}
