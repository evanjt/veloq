//! Scenario: a library from before the athlete could hide an activity from the
//! heatmap is opened by this build, once from the schema the newest release
//! shipped and once from the one just before the table arrived.
//!
//! Expected behaviour: the upgrade keeps every activity and leaves the table
//! empty, so nothing the athlete drew is hidden, and a choice made afterwards
//! is still there when the library is opened again.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .expect(table)
}

fn reopen(path: &Path) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open");
    engine.load().expect("load");
    engine
}

fn upgrade_and_hide(path: &Path) {
    let before = {
        let conn = Connection::open(path).unwrap();
        assert!(!tables_at(&conn).contains(&"heatmap_hidden_activities".to_string()));
        (count(&conn, "activities"), count(&conn, "gps_tracks"))
    };

    let mut engine = reopen(path);
    assert_eq!(
        user_version(&Connection::open(path).unwrap()),
        latest_version()
    );
    {
        let conn = Connection::open(path).unwrap();
        assert_eq!(count(&conn, "heatmap_hidden_activities"), 0);
        assert_eq!(
            (count(&conn, "activities"), count(&conn, "gps_tracks")),
            before
        );
    }
    assert!(engine.heatmap_hidden_activity_ids().is_empty());

    engine.set_heatmap_hidden("some-flight", true).unwrap();
    drop(engine);

    assert_eq!(
        reopen(path).heatmap_hidden_activity_ids(),
        vec!["some-flight".to_string()]
    );
}

#[test]
fn an_upgrade_from_the_newest_release_library_hides_nothing_and_keeps_every_activity() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    Connection::open(&path)
        .unwrap()
        .execute_batch(latest_release().library.expect("a library fixture"))
        .unwrap();

    upgrade_and_hide(&path);
}

#[test]
fn an_upgrade_from_the_schema_before_the_table_hides_nothing() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(seed_at_version(&path, 83));

    upgrade_and_hide(&path);
}
