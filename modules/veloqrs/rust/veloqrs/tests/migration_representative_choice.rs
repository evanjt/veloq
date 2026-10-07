//! Scenario: a library left at an earlier schema, whose route representatives
//! record nothing about who picked them. The grouping's own pick was the member
//! id that sorts first, and any other representative was set by the athlete or
//! by a split.
//!
//! Expected behaviour: a representative that is its route's lowest member id
//! migrates as the grouping's pick, any other as the athlete's choice, and a
//! launch after the upgrade keeps both.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

/// Route id, representative, members in their stored order.
const ROUTES: &[(&str, &str, &[&str])] = &[
    ("r_1", "i10", &["i10", "i11", "i12"]),
    ("r_2", "i21", &["i20", "i21", "i22"]),
    ("r_3", "i30", &["i31", "i30"]),
    ("r_4", "i40", &["i40"]),
    ("r_5", "i9", &["i10a", "i9"]),
];

fn seed_library(path: &Path, version: u32) {
    let conn = seed_at_version(path, version);
    for (id, representative, members) in ROUTES {
        conn.execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES (?, ?, ?, 'Run')",
            params![id, representative, serde_json::to_string(members).unwrap()],
        )
        .unwrap();
    }
}

/// Open the library the way a launch does: migrate, then load.
fn upgrade(path: &Path) -> Connection {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    engine.load().expect("load");
    drop(engine);
    Connection::open(path).expect("reopen")
}

fn chosen(conn: &Connection) -> BTreeMap<String, bool> {
    let mut stmt = conn
        .prepare("SELECT id, representative_chosen FROM route_groups")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn expected() -> BTreeMap<String, bool> {
    BTreeMap::from([
        ("r_1".to_string(), false),
        ("r_2".to_string(), true),
        ("r_3".to_string(), false),
        ("r_4".to_string(), false),
        ("r_5".to_string(), true),
    ])
}

fn assert_upgrade_records_who_chose(version: u32) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_library(&path, version);

    let after = upgrade(&path);
    assert_eq!(chosen(&after), expected(), "upgrade from {version}");

    let reopened = upgrade(&path);
    assert_eq!(
        chosen(&reopened),
        expected(),
        "second launch after {version}"
    );
}

#[test]
fn an_upgrade_from_the_released_schema_records_who_chose_each_representative() {
    let _serial_state = super::serial_state();
    assert_upgrade_records_who_chose(12);
}

#[test]
fn an_upgrade_from_schema_44_records_who_chose_each_representative() {
    let _serial_state = super::serial_state();
    assert_upgrade_records_who_chose(44);
}
