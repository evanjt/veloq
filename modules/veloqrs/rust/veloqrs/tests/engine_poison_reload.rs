//! A panic under the engine write lock leaves the memory tiers ahead of SQLite.
//!
//! Scenario: a mutation panics between a memory write and its row write. SQLite
//! rolls the transaction back; `activity_metadata`, `groups`, `sections` and the
//! rest do not go with it, and `with_persistent_engine` recovers the poisoned
//! lock and hands the next caller the engine exactly as the panic left it.
//!
//! Expected behaviour: the first caller after each panic reloads the tiers
//! from SQLite. Clearing the poison after recovery keeps later healthy calls
//! from paying for that reload.
//!
//! One test covers both panics because `PERSISTENT_ENGINE` is process-wide.

use std::panic::{AssertUnwindSafe, catch_unwind};

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// Write a row straight into the database, behind the engine's back. Memory is
/// then behind SQLite, which is the same disagreement a panic leaves and the
/// only one a test can make without reaching inside the engine.
fn insert_activity(db_path: &str, id: &str) {
    let conn = Connection::open(db_path).expect("open behind the engine");
    conn.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
         VALUES (?1, 'Ride', 46.0, 46.1, 6.0, 6.1)",
        [id],
    )
    .expect("insert");
}

fn activity_count() -> usize {
    with_persistent_engine(|engine| engine.activity_count()).expect("engine open")
}

#[test]
fn the_first_caller_after_a_poison_reloads_the_tiers_and_no_later_one_does() {
    let _serial_state = crate::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("poison.db");
    let db_path = db_path.to_str().unwrap().to_string();
    assert!(persistent_engine_init(db_path.clone()));

    insert_activity(&db_path, "before-the-panic");
    assert_eq!(
        activity_count(),
        0,
        "the tier is loaded at open, so a row written behind it is not seen yet"
    );

    let panicked = catch_unwind(AssertUnwindSafe(|| {
        with_persistent_engine(|_| panic!("a mutation panics under the write lock"));
    }));
    assert!(panicked.is_err(), "the closure has to panic to poison");

    assert_eq!(
        activity_count(),
        1,
        "the first caller after the poison reloads the tiers from SQLite"
    );

    insert_activity(&db_path, "after-the-recovery");
    assert_eq!(
        activity_count(),
        1,
        "the recovery cleared the poison, so a healthy call does not reload"
    );

    let panicked_again = catch_unwind(AssertUnwindSafe(|| {
        with_persistent_engine(|_| panic!("a second mutation panics under the write lock"));
    }));
    assert!(panicked_again.is_err());
    assert_eq!(
        activity_count(),
        2,
        "a second panic in the same install earns another reload"
    );
}
