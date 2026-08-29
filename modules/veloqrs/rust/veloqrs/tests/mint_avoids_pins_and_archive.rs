//! A minted content id must never land on an id the database still names.
//!
//! `section_pins` and the cutover archive have no FK to `sections` and outlive
//! the wipe, so an id retired from `sections` can still be claimed there. A
//! mint that only scanned the live rows, the ledger and the geometry versions
//! could re-issue it, and the re-minted section would inherit a dead pin.

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

fn open() -> (TempDir, PersistentRouteEngine, String) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("mint.db");
    let db_path = path.to_str().unwrap().to_string();
    let engine = PersistentRouteEngine::new(&db_path).expect("engine");
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
        "INSERT INTO section_catalogue_archive (token, section_id, sport_type)
         VALUES ('cutover-1', 'archived-ghost', 'Ride')",
        [],
    )
    .expect("insert archive");
    conn.execute(
        "INSERT INTO section_catalogue_archive_members (token, section_id, activity_id)
         VALUES ('cutover-1', 'member-ghost', 'a1')",
        [],
    )
    .expect("insert archive member");
    drop(conn);

    let taken = engine.section_ids_a_mint_must_avoid();
    assert!(
        taken.contains("archived-ghost"),
        "the archive is the revert substrate, its ids are still spoken for"
    );
    assert!(
        taken.contains("member-ghost"),
        "an archived member names a section id too"
    );
}
