//! Scenario: a library from before a row could carry the source of its load and
//! zone times is opened by this build.
//!
//! Expected behaviour: every activity metrics row survives with its load and
//! FTP unchanged and with no source marked, so no figure the server served is
//! claimed as Veloq's and none is rescored.

use super::migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

type Rows = Vec<(String, Option<f64>, Option<f64>)>;

fn rows(conn: &Connection) -> Rows {
    conn.prepare("SELECT activity_id, training_load, ftp FROM activity_metrics ORDER BY 1")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn an_upgrade_keeps_every_figure_and_marks_none_as_veloqs() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    Connection::open(&path)
        .unwrap()
        .execute_batch(latest_release().library.expect("a library fixture"))
        .unwrap();
    let before = rows(&Connection::open(&path).unwrap());
    assert!(!before.is_empty(), "the fixture holds metrics rows");

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open");
    engine.load().expect("load");
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(rows(&conn), before);
    let marked: i64 = conn
        .query_row(
            "SELECT count(*) FROM activity_metrics WHERE metrics_source IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(marked, 0);
}
