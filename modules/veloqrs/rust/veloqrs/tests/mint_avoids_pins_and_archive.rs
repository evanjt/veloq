//! A minted content id must never land on an id the database still names.
//!
//! `section_pins` and the ledger, the cutover's archived states among it, have
//! no FK to `sections` and outlive the wipe, so an id retired from `sections`
//! can still be claimed there. A mint that only scanned the live rows could
//! re-issue it, and the re-minted section would inherit a dead pin.

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn open() -> (TempDir, PersistentEngine, String) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("mint.db");
    let db_path = path.to_str().unwrap().to_string();
    let engine = PersistentEngine::new(&db_path).expect("engine");
    (dir, engine, db_path)
}

#[test]
fn a_pinned_id_is_never_free_to_mint() {
    let (_dir, engine, db_path) = open();

    let conn = Connection::open(&db_path).expect("open");
    conn.execute(
        "INSERT INTO section_pins (section_id, version) VALUES ('pinned-ghost', 3)",
        [],
    )
    .expect("insert pin");
    drop(conn);

    assert!(
        engine
            .section_ids_a_mint_must_avoid()
            .contains("pinned-ghost"),
        "a pin outlives the sections row, so its id is still taken"
    );
}

#[test]
fn an_archived_id_is_never_free_to_mint() {
    let (_dir, engine, db_path) = open();

    let conn = Connection::open(&db_path).expect("open");
    conn.execute(
        "INSERT INTO section_history (section_id, kind, details)
         VALUES ('archived-ghost', 'archived', '{\"token\":\"cutover-1\"}')",
        [],
    )
    .expect("insert archived state");
    drop(conn);

    assert!(
        engine
            .section_ids_a_mint_must_avoid()
            .contains("archived-ghost"),
        "an archived state can be rolled back to, so its id is still spoken for"
    );
}
