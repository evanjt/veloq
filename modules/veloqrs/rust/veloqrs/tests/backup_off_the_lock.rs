//! A database backup must not hold the engine lock.
//!
//! Scenario: the user taps "Export backup", or the daily auto-backup fires,
//! while the app is drawing. Expected behaviour: the copy runs on its own
//! thread and its own connection, so it finishes while another connection
//! holds an open write transaction on the same file, and every engine read
//! taken while it runs is served. Nothing is timed: a copy that needed the
//! writer to let go would stay unfinished until the hang guard ran out.

use std::sync::RwLock;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::WorkerPoll;

/// How long a backup may take before the test calls it hung. It is the only
/// deadline and is never a bound on how fast the copy should be.
const HANG_GUARD: Duration = Duration::from_secs(60);

/// Enough pages that the paced copy (100 pages per step, 10 ms between
/// steps) takes several steps, so a reader has something to contend with.
const BULK_ROWS: usize = 1_500;
const BULK_ROW_BYTES: usize = 4_096;

fn engine_with_bulk_bytes(name: &str) -> (TempDir, RwLock<PersistentEngine>) {
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

    (dir, RwLock::new(engine))
}

fn bulk_count(path: &str) -> i64 {
    let conn = Connection::open(path).expect("open copy");
    conn.query_row("SELECT COUNT(*) FROM bulk", [], |row| row.get(0))
        .expect("count copy")
}

/// Drive a running backup to its result, taking the engine write lock and
/// reading through it on every poll. Returns how many reads were served and
/// the outcome, and fails if the backup is still running after `HANG_GUARD`.
fn poll_to_completion(
    engine: &RwLock<PersistentEngine>,
    handle: &veloqrs::persistence::BackupHandle,
) -> (usize, Result<(), String>) {
    let deadline = Instant::now() + HANG_GUARD;
    let mut reads = 0;
    loop {
        {
            let guard = engine.write().expect("engine lock");
            let _ = guard.activity_count();
        }
        reads += 1;

        match handle.poll_state() {
            WorkerPoll::Running => std::thread::sleep(Duration::from_millis(5)),
            WorkerPoll::Ready(result) => return (reads, result),
            WorkerPoll::Died => return (reads, Err("backup thread died".to_string())),
        }
        assert!(
            Instant::now() < deadline,
            "the backup was still running after {HANG_GUARD:?}"
        );
    }
}

#[test]
fn the_backup_finishes_while_another_connection_holds_a_write() {
    let (dir, engine) = engine_with_bulk_bytes("live.db");
    let live = dir.path().join("live.db");
    let dest = dir.path().join("copy.veloqdb");
    let dest_str = dest.to_str().unwrap().to_string();

    let writer = Connection::open(&live).expect("writer connection");
    writer
        .execute_batch("BEGIN IMMEDIATE; INSERT INTO bulk (blob) VALUES (x'00');")
        .expect("open a write transaction");

    let handle = engine
        .write()
        .expect("engine lock")
        .clear_snapshot_background(&dest_str);
    let (reads, result) = poll_to_completion(&engine, &handle);
    result.expect("backup succeeds while a write is open");
    assert!(reads >= 1, "no engine read was served during the copy");

    writer
        .execute_batch("COMMIT")
        .expect("commit the held write");
    assert_eq!(
        bulk_count(&dest_str),
        BULK_ROWS as i64,
        "the copy held the committed rows and not the open write"
    );
}

#[test]
fn a_failed_backup_reports_its_error_and_leaves_the_engine_usable() {
    let (dir, engine) = engine_with_bulk_bytes("live.db");
    let dest = dir.path().join("no-such-dir").join("copy.veloqdb");
    let dest_str = dest.to_str().unwrap().to_string();

    let handle = engine
        .write()
        .expect("engine lock")
        .clear_snapshot_background(&dest_str);
    let (_, result) = poll_to_completion(&engine, &handle);

    let message = result.expect_err("a backup to a missing directory must fail");
    assert!(!message.is_empty(), "the failure carried no message");

    let good = dir.path().join("after-failure.veloqdb");
    let good_str = good.to_str().unwrap().to_string();
    let handle = engine
        .write()
        .expect("engine lock")
        .clear_snapshot_background(&good_str);
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
        .clear_snapshot_background(&first_str);
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
        .clear_snapshot_background(&second_str);
    poll_to_completion(&engine, &handle)
        .1
        .expect("second backup");

    let conn = Connection::open(&second_str).expect("open second copy");
    let activities: i64 = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .expect("count activities");
    assert_eq!(activities, 1, "the second copy missed the new activity");
}
