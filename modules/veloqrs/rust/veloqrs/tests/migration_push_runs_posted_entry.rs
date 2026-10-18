//! Scenario: a library from before a push run kept the entry it posted is
//! opened by this build, once from the schema a released build shipped and
//! once from the one just before the columns arrived, holding a run that
//! posted for a ride.
//!
//! Expected behaviour: the run survives with no entry recorded, so it holds
//! back nothing: the next push for that ride posts as it would have before.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let seeded = seed_at_version(&path, version);
    let had_runs = tables_at(&seeded).contains(&"push_runs".to_string());
    if had_runs {
        seeded
            .execute(
                "INSERT INTO push_runs (ts, activity_id, outcome) VALUES (100, 'a1', 'posted')",
                [],
            )
            .unwrap();
    }
    drop(seeded);

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    assert_eq!(
        engine.last_posted_push("a1").unwrap(),
        None,
        "a run from before v{version}'s upgrade holds back no entry"
    );
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    let columns = columns_of(&conn, "push_runs");
    assert!(columns.contains(&"posted_title".to_string()), "{columns:?}");
    assert!(columns.contains(&"posted_body".to_string()), "{columns:?}");
    assert_eq!(
        row_count(&conn, "push_runs"),
        Some(i64::from(had_runs)),
        "the kept runs survive the upgrade"
    );
}

#[test]
fn an_upgrade_from_the_released_schema_records_no_posted_entry() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_columns_keeps_the_runs_without_an_entry() {
    upgrade_from(71);
}
