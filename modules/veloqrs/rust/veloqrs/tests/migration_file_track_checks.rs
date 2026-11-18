//! File track checks on a library upgraded from the last release.
//!
//! Expected behaviour: the last release's library opens with no check recorded,
//! and a check written afterwards is read back and survives a reopen.

use super::migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

#[test]
fn an_upgraded_library_holds_no_check_and_keeps_one_written_after_the_upgrade() {
    let _serial_state = super::serial_state();
    let release = latest_release();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    Connection::open(&path)
        .expect("open fixture")
        .execute_batch(release.library.expect("the latest release has a library"))
        .expect("replay fixture");

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.load().expect("load");
    assert_eq!(engine.file_track_check("i1"), None);
    drop(engine);

    let conn = Connection::open(&path).expect("reopen");
    conn.execute(
        "INSERT INTO file_track_checks (activity_id, file_records, server_records, supplied)
         VALUES ('i1', 31, 30, 0)",
        [],
    )
    .expect("the table exists");
    drop(conn);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine again");
    engine.load().expect("load again");
    let check = engine.file_track_check("i1").expect("the check is read");
    assert_eq!(
        (check.file_records, check.server_records, check.supplied),
        (31, Some(30), false)
    );
    assert!(check.mismatched());
}
