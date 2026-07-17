//! Init failover: an unreadable database must never brick the engine.
//!
//! Scenario: a user's SQLite file is corrupted (interrupted write, bad flash
//! sector). Before the failover, `persistent_engine_init` returned `false`,
//! the constructor discarded it, and every feature silently returned empty
//! data on every launch. Expected behaviour: the corrupt file is quarantined
//! (renamed aside, one generation kept) and a fresh database takes its place.
//!
//! Runs as a single sequential test because `persistent_engine_init` writes
//! the process-global `PERSISTENT_ENGINE`. Integration test files are their
//! own process, so this cannot race other test files.

use std::fs;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;

fn quarantine_files(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".corrupt-"))
        .collect()
}

#[test]
fn init_survives_corrupt_database() {
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
    assert!(
        persistent_engine_init(db_str.clone()),
        "init must recover from a corrupt database"
    );
    assert!(db_path.exists(), "a fresh database must exist");
    let generation_one = quarantine_files(tmp.path());
    assert!(
        generation_one.iter().any(|n| n.starts_with("routes.db.corrupt-")),
        "corrupt file must be renamed aside, got {:?}",
        generation_one
    );
    assert!(
        generation_one.iter().any(|n| n.ends_with("-wal")),
        "wal sibling must be quarantined too, got {:?}",
        generation_one
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
