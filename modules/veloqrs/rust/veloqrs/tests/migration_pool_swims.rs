//! Scenario: a library from before a pool swim's lengths were kept is opened by
//! this build, once from the schema a released build shipped and once from the
//! one just before the tables arrived. It holds a pool swim whose file the
//! strength-only parse already settled, and a strength session it parsed.
//!
//! Expected behaviour: both tables arrive empty, the swim's verdict is cleared
//! so its file is owed and read for lengths, and the strength session keeps
//! its verdict and is not fetched again.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn add_settled(conn: &Connection, id: &str, sport: &str, date: i64) {
    conn.execute(
        "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
             elapsed_time, elevation_gain, sport_type)
         VALUES (?1, 'n', ?2, 0, 0, 0, 0, ?3)",
        params![id, date, sport],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO fit_file_status (activity_id, processed_at, has_sets) VALUES (?1, 0, 1)",
        params![id],
    )
    .unwrap();
}

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let seeded = seed_at_version(&path, version);
    add_settled(&seeded, "pool", "Swim", 200);
    add_settled(&seeded, "lift", "WeightTraining", 100);
    drop(seeded);
    let before = tables_at(&Connection::open(&path).unwrap());
    assert!(!before.contains(&"swim_lengths".to_string()));
    assert!(!before.contains(&"pool_swims".to_string()));

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    assert_eq!(
        engine.owed_fit_ids().unwrap(),
        vec!["pool".to_string()],
        "an upgrade from v{version} owes the swim its file and not the strength session"
    );
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert_eq!(row_count(&conn, "swim_lengths"), Some(0));
    assert_eq!(row_count(&conn, "pool_swims"), Some(0));
    let kept: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM fit_file_status WHERE activity_id = 'lift'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kept, 1, "the strength verdict survives the upgrade");
}

#[test]
fn an_upgrade_from_the_released_schema_owes_each_pool_swim_its_file() {
    upgrade_from(12);
}

#[test]
fn an_upgrade_from_the_schema_before_the_tables_owes_each_pool_swim_its_file() {
    upgrade_from(70);
}
