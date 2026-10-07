//! Scenario: a library a released build left at schema 12, where every route
//! name sits in `route_names` whether the athlete typed it or the build minted
//! it, in whichever language was current at the time.
//!
//! Expected behaviour: every stored name survives the upgrade unchanged, and
//! every route takes a number of its own. A kept name that reads as a route
//! word and a number holds that number when it is free, so no unnamed route is
//! later shown under the same label beside it.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn seed_v12_library(path: &Path, groups: &[(&str, &[&str])], names: &[(&str, &str)]) {
    let conn = seed_at_version(path, 12);
    for (id, members) in groups {
        conn.execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES (?, ?, ?, 'Ride')",
            params![id, members[0], serde_json::to_string(members).unwrap()],
        )
        .unwrap();
    }
    for (id, name) in names {
        conn.execute(
            "INSERT INTO route_names (route_id, custom_name) VALUES (?, ?)",
            params![id, name],
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

fn read_pairs<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> BTreeMap<String, T> {
    let mut stmt = conn.prepare(sql).unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn names(conn: &Connection) -> BTreeMap<String, String> {
    read_pairs(conn, "SELECT route_id, custom_name FROM route_names")
}

fn numbers(conn: &Connection) -> BTreeMap<String, u32> {
    read_pairs(conn, "SELECT route_id, number FROM route_numbers")
}

#[test]
fn an_upgrade_keeps_every_name_and_gives_every_route_its_own_number() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_v12_library(
        &path,
        &[
            ("r_1", &["a1", "a2"]),
            ("r_2", &["b1"]),
            ("r_3", &["c1"]),
            ("r_4", &["d1"]),
        ],
        &[
            ("r_1", "Route 3"),
            ("r_2", "Walk Route 5"),
            ("r_3", "Harbour loop"),
        ],
    );
    let before = names(&Connection::open(&path).unwrap());

    let after = upgrade(&path);
    assert_eq!(names(&after), before, "the upgrade changed a stored name");
    assert_eq!(
        numbers(&after),
        BTreeMap::from([
            ("r_1".to_string(), 3),
            ("r_2".to_string(), 5),
            ("r_3".to_string(), 1),
            ("r_4".to_string(), 2),
        ])
    );

    let reopened = upgrade(&path);
    assert_eq!(names(&reopened), before, "a second launch changed a name");
    assert_eq!(
        numbers(&reopened),
        numbers(&after),
        "a second launch renumbered"
    );
}

#[test]
fn two_routes_holding_one_label_keep_it_and_only_one_holds_its_number() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_v12_library(
        &path,
        &[("r_1", &["a1"]), ("r_2", &["b1"])],
        &[("r_1", "Route 3"), ("r_2", "Route 3")],
    );

    let after = upgrade(&path);
    assert_eq!(
        names(&after),
        BTreeMap::from([
            ("r_1".to_string(), "Route 3".to_string()),
            ("r_2".to_string(), "Route 3".to_string()),
        ])
    );
    assert_eq!(
        numbers(&after),
        BTreeMap::from([("r_1".to_string(), 3), ("r_2".to_string(), 1)])
    );
}

#[test]
fn an_upgrade_drops_the_index_no_query_reads() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_v12_library(&path, &[], &[]);

    let after = upgrade(&path);
    let index: i64 = after
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_groups_sport'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(index, 0);
}
