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
