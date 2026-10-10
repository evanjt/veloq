use super::PersistentEngine;
use tracematch::GpsPoint;

fn deferred_failure(engine: &PersistentEngine) {
    engine
        .db
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE txn_parent (id INTEGER PRIMARY KEY);
             CREATE TABLE txn_child (parent_id INTEGER REFERENCES txn_parent(id)
                 DEFERRABLE INITIALLY DEFERRED);",
        )
        .unwrap();
}

#[test]
fn test_in_write_txn_rolls_back_failed_commit() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    deferred_failure(&engine);
    let result = engine.in_write_txn(|engine| {
        engine
            .db
            .execute("INSERT INTO txn_child VALUES (1)", [])
            .map_err(|error| error.to_string())?;
        Ok(())
    });
    assert!(result.is_err());
    assert!(engine.db.is_autocommit());
    let count: i64 = engine
        .db
        .query_row("SELECT COUNT(*) FROM txn_child", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn nested_write_failure_rolls_back_only_its_own_rows() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .db
        .execute_batch("CREATE TABLE nested_write_probe (value INTEGER NOT NULL)")
        .unwrap();
    engine
        .in_write_txn(|engine| {
            engine
                .db
                .execute("INSERT INTO nested_write_probe VALUES (1)", [])
                .map_err(|e| e.to_string())?;
            let inner: Result<(), String> = engine.in_write_txn(|engine| {
                engine
                    .db
                    .execute("INSERT INTO nested_write_probe VALUES (2)", [])
                    .map_err(|e| e.to_string())?;
                Err("inner refused".to_string())
            });
            assert_eq!(inner.unwrap_err(), "inner refused");
            engine
                .db
                .execute("INSERT INTO nested_write_probe VALUES (3)", [])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .unwrap();
    let mut stmt = engine
        .db
        .prepare("SELECT value FROM nested_write_probe ORDER BY value")
        .unwrap();
    let values: Vec<i64> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(values, [1, 3]);
    assert!(engine.db.is_autocommit());
}

#[test]
fn test_add_activities_batch_rolls_back_failed_commit() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    deferred_failure(&engine);
    engine
        .db
        .execute_batch(
            "CREATE TRIGGER txn_fail AFTER INSERT ON activities
             BEGIN INSERT INTO txn_child VALUES (1); END;",
        )
        .unwrap();
    let track = (0..12)
        .map(|i| GpsPoint::new(46.0 + f64::from(i) * 0.001, 7.0))
        .collect();
    assert!(
        engine
            .add_activity("a1".into(), track, "Ride".into())
            .is_err()
    );
    assert!(engine.db.is_autocommit());
    assert!(!engine.has_activity("a1"));
}

/// Scenario: a mutation opens `BEGIN IMMEDIATE` as raw SQL on the process-wide
/// engine, writes a row and panics before it commits. Nothing is dropped, so
/// SQLite does not roll the transaction back, and the next caller recovers the
/// poisoned lock onto a connection still inside it.
///
/// Expected behaviour: the recovery rolls the open transaction back before it
/// reloads, so the half-written row is gone, the engine is in autocommit and
/// commits again, and another connection to the same file can write.
#[test]
fn a_panic_inside_a_raw_write_transaction_is_rolled_back_by_the_recovery() {
    use crate::persistence::with_persistent_engine;
    use crate::test_globals::{init_global_engine, serial_global_state};
    use std::panic::{AssertUnwindSafe, catch_unwind};

    let _serial = serial_global_state();
    let dir = init_global_engine("raw_txn_panic.db");
    let db_path = dir.path().join("raw_txn_panic.db");

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let panicked = catch_unwind(AssertUnwindSafe(|| {
        with_persistent_engine(|engine| {
            engine.db.execute_batch("BEGIN IMMEDIATE").unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO settings (key, value) VALUES ('half_written', 'yes')",
                    [],
                )
                .unwrap();
            panic!("a mutation panics inside its write transaction");
        });
    }));
    std::panic::set_hook(previous);
    assert!(panicked.is_err(), "the closure has to panic to poison");

    assert_eq!(
        with_persistent_engine(|engine| engine.db.is_autocommit()),
        Some(true),
        "the recovery leaves the engine connection outside any transaction"
    );
    let half_written: i64 = with_persistent_engine(|engine| {
        engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = 'half_written'",
                [],
                |row| row.get(0),
            )
            .unwrap()
    })
    .unwrap();
    assert_eq!(half_written, 0, "the panicked write is rolled back");

    let other = rusqlite::Connection::open(&db_path).unwrap();
    other
        .busy_timeout(std::time::Duration::from_millis(200))
        .unwrap();
    other
        .execute(
            "INSERT INTO settings (key, value) VALUES ('another_writer', 'yes')",
            [],
        )
        .expect("another connection can write once the recovery let go of the lock");

    with_persistent_engine(|engine| {
        engine
            .in_write_txn(|engine| {
                engine
                    .db
                    .execute(
                        "INSERT INTO settings (key, value) VALUES ('after_recovery', 'yes')",
                        [],
                    )
                    .map_err(|e| e.to_string())
                    .map(|_| ())
            })
            .unwrap();
    });
    let committed: i64 = other
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key = 'after_recovery'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(committed, 1, "a write after the recovery commits");
    crate::persistence::clear_persistent_engine();
}
