//! A database backup must not hold the engine lock.
//!
//! Scenario: the user taps "Export backup", or the daily auto-backup fires,
//! while the app is drawing. Expected behaviour: starting the copy returns
//! immediately and every engine read taken while it runs is served within a
//! frame budget, because the copy runs on its own thread and its own
//! connection.

use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::WorkerPoll;

/// One 60 Hz frame. A read that waits longer than this drops a frame.
const FRAME_BUDGET: Duration = Duration::from_millis(16);

/// Enough pages that the paced copy (100 pages per step, 10 ms between
/// steps) runs for a few hundred milliseconds, so a reader has time to
/// contend with it.
const BULK_ROWS: usize = 1_500;
const BULK_ROW_BYTES: usize = 4_096;

fn engine_with_bulk_bytes(name: &str) -> (TempDir, Arc<RwLock<PersistentEngine>>) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join(name);
    let path_str = path.to_str().unwrap().to_string();

    let engine = PersistentEngine::new(&path_str).expect("open engine");

    let conn = Connection::open(&path_str).expect("bulk connection");
    conn.execute("CREATE TABLE bulk (id INTEGER PRIMARY KEY, blob BLOB)", [])
        .expect("create bulk");
    let payload = vec![7u8; BULK_ROW_BYTES];
    conn.execute("BEGIN", []).expect("begin");
    {
        let mut stmt = conn
            .prepare("INSERT INTO bulk (blob) VALUES (?1)")
            .expect("prepare bulk insert");
        for _ in 0..BULK_ROWS {
            stmt.execute([&payload]).expect("insert bulk");
        }
    }
    conn.execute("COMMIT", []).expect("commit");
    drop(conn);

    (dir, Arc::new(RwLock::new(engine)))
}

fn bulk_count(path: &str) -> i64 {
    let conn = Connection::open(path).expect("open copy");
    conn.query_row("SELECT COUNT(*) FROM bulk", [], |row| row.get(0))
        .expect("count copy")
}

/// Drive a running backup to its result, timing an engine write-lock
/// acquisition on every poll. Returns the waits and the outcome.
fn poll_to_completion(
    engine: &Arc<RwLock<PersistentEngine>>,
    handle: &veloqrs::persistence::BackupHandle,
) -> (Vec<Duration>, Result<(), String>) {
    let mut waits = Vec::new();
    loop {
        let before = Instant::now();
        {
            let guard = engine.write().expect("engine lock");
            let _ = guard.activity_count();
        }
        waits.push(before.elapsed());

        match handle.poll_state() {
            WorkerPoll::Running => std::thread::sleep(Duration::from_millis(5)),
            WorkerPoll::Ready(result) => return (waits, result),
            WorkerPoll::Died => return (waits, Err("backup thread died".to_string())),
        }
    }
}

#[test]
fn engine_stays_readable_while_the_backup_copies() {
    let (dir, engine) = engine_with_bulk_bytes("live.db");
    let dest = dir.path().join("copy.veloqdb");
    let dest_str = dest.to_str().unwrap().to_string();

    let started = Instant::now();
    let handle = engine
        .write()
        .expect("engine lock")
        .backup_database_background(&dest_str);
    let start_cost = started.elapsed();

    let (waits, result) = poll_to_completion(&engine, &handle);
    result.expect("backup succeeds");

    assert!(
        start_cost < FRAME_BUDGET,
        "starting the backup cost {:?}, over one frame",
        start_cost
    );
    assert!(
        waits.len() >= 5,
        "the copy finished in {} polls, too fast to prove anything about contention",
        waits.len()
    );
    let worst = waits.iter().max().copied().unwrap_or_default();
    assert!(
        worst < FRAME_BUDGET,
        "a read waited {:?} behind the backup, over one frame",
        worst
    );

    assert_eq!(bulk_count(&dest_str), BULK_ROWS as i64);
}

#[test]
fn a_failed_backup_reports_its_error_and_leaves_the_engine_usable() {
    let (dir, engine) = engine_with_bulk_bytes("live.db");
    let dest = dir.path().join("no-such-dir").join("copy.veloqdb");
    let dest_str = dest.to_str().unwrap().to_string();

    let handle = engine
        .write()
        .expect("engine lock")
        .backup_database_background(&dest_str);
    let (_, result) = poll_to_completion(&engine, &handle);

    let message = result.expect_err("a backup to a missing directory must fail");
    assert!(!message.is_empty(), "the failure carried no message");

    let good = dir.path().join("after-failure.veloqdb");
    let good_str = good.to_str().unwrap().to_string();
    let handle = engine
        .write()
        .expect("engine lock")
        .backup_database_background(&good_str);
    let (_, result) = poll_to_completion(&engine, &handle);
    result.expect("a backup after a failed one still succeeds");
    assert_eq!(bulk_count(&good_str), BULK_ROWS as i64);
}

#[test]
fn a_second_backup_copies_writes_made_since_the_first() {
    let (dir, engine) = engine_with_bulk_bytes("live.db");

    let first = dir.path().join("first.veloqdb");
    let first_str = first.to_str().unwrap().to_string();
    let handle = engine
        .write()
        .expect("engine lock")
        .backup_database_background(&first_str);
    poll_to_completion(&engine, &handle)
        .1
        .expect("first backup");

    engine
        .write()
        .expect("engine lock")
        .add_activity(
            "b192-activity".to_string(),
            vec![
                veloqrs::GpsPoint::new(-37.81, 144.96),
                veloqrs::GpsPoint::new(-37.82, 144.97),
            ],
            "Ride".to_string(),
        )
        .expect("add activity");

    let second = dir.path().join("second.veloqdb");
    let second_str = second.to_str().unwrap().to_string();
    let handle = engine
        .write()
        .expect("engine lock")
        .backup_database_background(&second_str);
    poll_to_completion(&engine, &handle)
        .1
        .expect("second backup");

    let conn = Connection::open(&second_str).expect("open second copy");
    let activities: i64 = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .expect("count activities");
    assert_eq!(activities, 1, "the second copy missed the new activity");
}
