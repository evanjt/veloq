//! A detect's catalogue write reads the outgoing catalogue before it wipes it,
//! while a routes regroup writes on a connection of its own.

use std::time::Duration;

use tempfile::TempDir;

use crate::persistence::PersistentEngine;

/// Scenario: a routes regroup holds the write lock when a detect's catalogue
/// write starts, and commits while that write is under way.
/// Expected behaviour: the catalogue write waits its turn and lands, rather
/// than failing on a snapshot the regroup's commit made stale.
#[test]
fn a_detect_write_waits_out_a_writer_that_commits_under_it() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("catalogue.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let writer = rusqlite::Connection::open(&path).expect("writer");
    writer
        .execute_batch(
            "BEGIN IMMEDIATE;
             INSERT INTO settings (key, value) VALUES ('another_writer', '1');",
        )
        .expect("the other writer holds the lock");
    let committer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        writer.execute_batch("COMMIT").expect("commit");
    });

    let written = engine.write_catalogue(&[], true);
    committer.join().unwrap();

    written.expect("the catalogue write");
}
