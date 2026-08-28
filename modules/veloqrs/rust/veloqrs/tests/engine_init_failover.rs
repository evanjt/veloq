//! Init failover: an unreadable database must never brick the engine.
//!
//! Scenario: a user's SQLite file is corrupted (interrupted write, bad flash
//! sector). Before the failover, `persistent_engine_init` returned `false`,
//! the constructor discarded it, and every feature silently returned empty
//! data on every launch. Expected behaviour: the corrupt file is quarantined
//! (renamed aside, one generation kept) and a fresh database takes its place.
//!
//! The tests share the process-global `PERSISTENT_ENGINE` and the process-wide
//! panic hook, so they take `SERIAL` rather than running on cargo's default
//! thread pool. Integration test files are their own process, so this cannot
//! race other test files.

use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tempfile::TempDir;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::{GpsPoint, PersistentRouteEngine};

static SERIAL: Mutex<()> = Mutex::new(());

fn quarantine_files(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".corrupt-"))
        .collect()
}

fn activity_count(db_path: &Path) -> i64 {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    conn.query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .unwrap()
}

/// Lock contention at launch is not corruption. Quarantining on a busy file
/// would rename a healthy cache aside and resync from scratch, silently, for
/// every user whose launch races a background write.
#[test]
fn transient_lock_does_not_quarantine() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    let db_str = db_path.to_string_lossy().into_owned();

    {
        let mut engine = PersistentRouteEngine::new(&db_str).unwrap();
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
            .unwrap();
    }
    assert_eq!(activity_count(&db_path), 1, "seed must land");

    // An exclusive transaction blocks every other connection for as long as it
    // is held. Five seconds is the engine's busy_timeout, so init gives up.
    let mut blocker = rusqlite::Connection::open(&db_path).unwrap();
    let held = blocker
        .transaction_with_behavior(rusqlite::TransactionBehavior::Exclusive)
        .unwrap();

    assert!(
        !persistent_engine_init(db_str.clone()),
        "a locked database must report failure, not recover"
    );
    assert!(
        quarantine_files(tmp.path()).is_empty(),
        "lock contention must never quarantine: {:?}",
        quarantine_files(tmp.path())
    );

    drop(held);
    drop(blocker);

    assert_eq!(
        activity_count(&db_path),
        1,
        "the cache must survive a failed launch untouched"
    );
    // The retry the banner offers succeeds on the same file.
    assert!(persistent_engine_init(db_str.clone()));
    assert!(quarantine_files(tmp.path()).is_empty());
    assert_eq!(activity_count(&db_path), 1);
}

#[test]
fn init_survives_corrupt_database() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    let db_str = db_path.to_string_lossy().into_owned();

    // Fresh directory, no database: plain init works.
    assert!(persistent_engine_init(db_str.clone()));
    assert!(db_path.exists());
    assert!(quarantine_files(tmp.path()).is_empty());

    // Re-init on a healthy database: no quarantine.
    assert!(persistent_engine_init(db_str.clone()));
    assert!(quarantine_files(tmp.path()).is_empty());

    // Corrupt the file: init must quarantine it and start fresh.
    fs::write(&db_path, b"this is not a sqlite database, not even close").unwrap();
    fs::write(format!("{}-wal", db_str), b"garbage wal").unwrap();
    // A background thread the healthy init spawned may still hold the file, and
    // SQLite then answers with a transient code that init rightly declines to
    // quarantine on. Retry so the verdict under test is the file's own.
    let recovered = (0..20).any(|attempt| {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        persistent_engine_init(db_str.clone())
    });
    assert!(recovered, "init must recover from a corrupt database");
    assert!(db_path.exists(), "a fresh database must exist");
    let generation_one = quarantine_files(tmp.path());
    assert!(
        generation_one
            .iter()
            .any(|n| n.starts_with("routes.db.corrupt-")),
        "corrupt file must be renamed aside, got {:?}",
        generation_one
    );
    // The stale wal must leave the live namespace. Whether quarantine renames
    // it or SQLite deletes it during a racing open attempt is timing; what
    // matters is that no stale sibling sits beside the fresh database.
    assert!(
        !Path::new(&format!("{}-wal", db_str)).exists(),
        "stale wal must not survive beside the fresh database"
    );

    // The fresh database is functional (schema created, zero activities).
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
    drop(conn);

    // A second corruption event replaces the previous quarantine generation
    // instead of accumulating files.
    // Sleep so the epoch-seconds suffix differs from generation one.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(&db_path, b"corrupted again").unwrap();
    assert!(persistent_engine_init(db_str.clone()));
    let generation_two = quarantine_files(tmp.path());
    let db_generations: Vec<_> = generation_two
        .iter()
        .filter(|n| !n.ends_with("-wal") && !n.ends_with("-shm"))
        .collect();
    assert_eq!(
        db_generations.len(),
        1,
        "only the newest quarantine generation may remain, got {:?}",
        generation_two
    );
    assert_ne!(
        db_generations[0],
        generation_one
            .iter()
            .find(|n| !n.ends_with("-wal") && !n.ends_with("-shm"))
            .unwrap(),
        "second event must produce a new generation"
    );
}

/// The catalogue is a re-derivable cache; the ledger is not. A quarantine
/// brings every readable history row, geometry version and pin across into
/// the fresh database before the catalogue is rebuilt from scratch.
#[test]
fn quarantine_salvages_readable_history_rows() {
    let _serial = SERIAL.lock().unwrap();
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("ledger.db");
    let db_str = db_path.to_string_lossy().into_owned();
    let line: Vec<GpsPoint> = (0..20)
        .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0005, 7.0))
        .collect();
    {
        let mut engine = PersistentRouteEngine::new(&db_str).unwrap();
        engine
            .add_activity("act_1".to_string(), line.clone(), "Ride".to_string())
            .unwrap();
        let v1 = engine
            .record_section_geometry("sec_ledger", &line, true, Some(("act_1", 3, 22)))
            .unwrap();
        engine
            .append_section_history("sec_ledger", "formed", Some("{\"note\":1}"), Some(v1))
            .unwrap();
        engine
            .append_section_history("sec_ledger", "recut", None, None)
            .unwrap();
        assert!(engine.pin_section_geometry("sec_ledger", v1).unwrap());
    }

    // Page-level corruption the ledger survives: the activities table's root
    // page is overwritten, so reading the catalogue reports a malformed
    // image while the schema and the ledger pages stay readable.
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let page_size: u64 = conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .unwrap();
        // The table and every index on it, so no read can route around the
        // damage through a smaller b-tree.
        let roots: Vec<u64> = conn
            .prepare(
                "SELECT rootpage FROM sqlite_master WHERE tbl_name = 'activities' AND rootpage > 0",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .flatten()
            .collect();
        drop(conn);
        assert!(!roots.is_empty());
        let mut bytes = fs::read(&db_path).unwrap();
        for root in roots {
            let start = ((root - 1) * page_size) as usize;
            for b in &mut bytes[start..start + page_size as usize] {
                *b = 0xFF;
            }
        }
        fs::write(&db_path, bytes).unwrap();
        let _ = fs::remove_file(format!("{}-wal", db_str));
        let _ = fs::remove_file(format!("{}-shm", db_str));
    }
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let read: Result<i64, _> =
            conn.query_row("SELECT COUNT(sport_type) FROM activities", [], |r| r.get(0));
        assert!(
            read.is_err(),
            "test premise: the catalogue page must read as corrupt"
        );
        let ledger: i64 = conn
            .query_row("SELECT COUNT(*) FROM section_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ledger, 2, "test premise: the ledger pages still read");
    }
    let recovered = (0..20).any(|attempt| {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        persistent_engine_init(db_str.clone())
    });
    assert!(recovered, "init must quarantine and start fresh");
    assert!(!quarantine_files(tmp.path()).is_empty());

    let fresh = PersistentRouteEngine::new(&db_str).unwrap();
    let kinds: Vec<String> = fresh
        .section_history("sec_ledger")
        .into_iter()
        .map(|e| e.kind)
        .collect();
    assert_eq!(
        kinds,
        vec!["formed", "recut"],
        "history rows came across in order"
    );
    let (polyline, reference) = fresh
        .section_geometry_version("sec_ledger", 1)
        .expect("the geometry version came across");
    assert_eq!(polyline.len(), line.len());
    assert_eq!(reference, Some(("act_1".to_string(), 3, 22)));
    assert_eq!(fresh.pinned_section_version("sec_ledger"), Some(1));
    assert_eq!(
        activity_count(&db_path),
        0,
        "the catalogue itself starts over"
    );
}
