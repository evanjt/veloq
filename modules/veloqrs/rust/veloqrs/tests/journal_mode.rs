//! Scenario: the crate set no `journal_mode` pragma anywhere, so the database
//! ran SQLite's rollback default and every commit paid two fsyncs on whichever
//! thread asked for it. The mode is WAL.
//!
//! Expected behaviour: the database file is WAL, converted once on open and
//! persisting across reopens, and every connection that writes runs
//! `synchronous=NORMAL`, which is per-connection and so has to be set on each
//! of them. The read-only paths keep working against a WAL file, including
//! salvage from a quarantined database no writer holds open.

use rusqlite::{Connection, OpenFlags};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn journal_mode(conn: &Connection) -> String {
    conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
        .unwrap()
        .to_lowercase()
}

#[test]
fn a_fresh_database_opens_in_wal() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let _engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    assert_eq!(journal_mode(&Connection::open(&path).unwrap()), "wal");
}

#[test]
fn the_mode_is_a_property_of_the_file_and_survives_a_reopen() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let _engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    }

    let plain = Connection::open(&path).unwrap();
    assert_eq!(journal_mode(&plain), "wal");
}

#[test]
fn a_rollback_database_is_converted_on_the_next_open() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let legacy = Connection::open(&path).unwrap();
        legacy
            .pragma_update(None, "journal_mode", "delete")
            .unwrap();
        legacy
            .execute_batch("CREATE TABLE probe (id INTEGER)")
            .unwrap();
        assert_eq!(journal_mode(&legacy), "delete");
    }

    let _engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    assert_eq!(journal_mode(&Connection::open(&path).unwrap()), "wal");
}

#[test]
fn salvage_reads_a_quarantined_wal_database_no_writer_holds_open() {
    // A read-only connection cannot create the -shm a WAL database needs, so
    // salvage of a quarantined file has to cope with the mode this change
    // gives every database.
    let dir = TempDir::new().unwrap();
    let corrupt = dir.path().join("routes.db.corrupt-1");
    {
        let _engine = PersistentEngine::new(corrupt.to_str().unwrap()).unwrap();
    }
    {
        let seed = Connection::open(&corrupt).unwrap();
        seed.execute(
            "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
             VALUES ('s1', 1, 'created', '{}', 1)",
            [],
        )
        .unwrap();
    }
    // Cleanly closed, so the sidecars are gone and only the WAL header remains.
    assert!(!dir.path().join("routes.db.corrupt-1-shm").exists());

    let live = dir.path().join("routes.db");
    let engine = PersistentEngine::new(live.to_str().unwrap()).unwrap();
    let counts = engine.salvage_ledger_from(corrupt.to_str().unwrap());

    assert_eq!(counts.history, 1, "salvage read nothing out of a WAL file");
}

#[test]
fn a_read_only_reader_still_opens_the_live_database() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let _engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

    let reader = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("read-only open of the live database");
    assert_eq!(journal_mode(&reader), "wal");
}

#[test]
fn a_backup_file_still_validates_after_the_source_became_wal() {
    // `sqlite3_backup` copies the source header, the journal mode with it, so a
    // backup taken from a WAL database can itself be WAL. `validate_backup_database`
    // opens the file it is handed read-only, which is the one thing a WAL file
    // with no sidecar refuses.
    let dir = TempDir::new().unwrap();
    let live = dir.path().join("routes.db");
    let backup = dir.path().join("backup.db");
    {
        let _engine = PersistentEngine::new(live.to_str().unwrap()).unwrap();
    }

    let source = Connection::open(&live).unwrap();
    let mut dest = Connection::open(&backup).unwrap();
    rusqlite::backup::Backup::new(&source, &mut dest)
        .unwrap()
        .run_to_completion(100, std::time::Duration::from_millis(0), None)
        .unwrap();
    drop(dest);

    veloqrs::ffi::validate_backup_database(backup.to_str().unwrap().to_string())
        .expect("a backup taken from a WAL database has to validate");
}
