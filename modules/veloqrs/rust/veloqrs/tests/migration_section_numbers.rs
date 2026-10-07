//! Scenario: a library a released build left behind, where every detected
//! section stores a minted "Section N" label in whichever language was current
//! when it was cut, and the athlete's own sections store what they typed.
//!
//! Expected behaviour: every section takes a number of its own. A detected
//! section's label becomes its number and the row is left unnamed, so it is
//! shown in the current language. A name the athlete chose stays a name, and
//! one that reads as a section word and a number holds that number, so no
//! unnamed section is later shown under the same label beside it.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn insert_section(conn: &Connection, id: &str, section_type: &str, name: Option<&str>) {
    conn.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, is_user_defined, created_at)
         VALUES (?, ?, ?, 'Ride', '[]', 100.0, ?, '2026-01-01T00:00:00Z')",
        params![id, section_type, name, section_type == "custom"],
    )
    .unwrap();
}

/// Open the library the way a launch does: migrate, then load, and read the
/// name each section is shown under.
fn upgrade(path: &Path) -> (Connection, BTreeMap<String, String>) {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    engine.load().expect("load");
    let shown = engine.get_all_section_names().into_iter().collect();
    drop(engine);
    (Connection::open(path).expect("reopen"), shown)
}

fn read_pairs<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> BTreeMap<String, T> {
    let mut stmt = conn.prepare(sql).unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn names(conn: &Connection) -> BTreeMap<String, Option<String>> {
    read_pairs(conn, "SELECT id, name FROM sections")
}

fn numbers(conn: &Connection) -> BTreeMap<String, u32> {
    read_pairs(conn, "SELECT section_id, number FROM section_numbers")
}

fn pairs<V: Clone>(entries: &[(&str, V)]) -> BTreeMap<String, V> {
    entries
        .iter()
        .map(|(id, value)| (id.to_string(), value.clone()))
        .collect()
}

#[test]
fn an_upgrade_from_twelve_numbers_every_section_and_keeps_every_typed_name() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 12);
        insert_section(&conn, "a_german", "auto", Some("Abschnitt 6"));
        insert_section(&conn, "a_ride", "auto", Some("Ride Section 3"));
        insert_section(&conn, "a_portuguese", "auto", Some("Seccao 2"));
        insert_section(&conn, "a_unnamed", "auto", None);
        insert_section(&conn, "c_dated", "custom", Some("Ride section (12 Mar)"));
        insert_section(&conn, "c_typed", "custom", Some("Section 7"));
    }

    let (after, shown) = upgrade(&path);
    assert_eq!(
        names(&after),
        pairs(&[
            ("a_german", None),
            ("a_ride", None),
            ("a_portuguese", None),
            ("a_unnamed", None),
            ("c_dated", Some("Ride section (12 Mar)".to_string())),
            ("c_typed", Some("Section 7".to_string())),
        ])
    );
    assert_eq!(
        numbers(&after),
        pairs(&[
            ("a_german", 6),
            ("a_ride", 3),
            ("a_portuguese", 2),
            ("a_unnamed", 1),
            ("c_dated", 4),
            ("c_typed", 7),
        ])
    );
    assert_eq!(
        shown,
        pairs(&[
            ("a_german", "Section 6".to_string()),
            ("a_ride", "Section 3".to_string()),
            ("a_portuguese", "Section 2".to_string()),
            ("a_unnamed", "Section 1".to_string()),
            ("c_dated", "Ride section (12 Mar)".to_string()),
            ("c_typed", "Section 7".to_string()),
        ])
    );

    let (reopened, _) = upgrade(&path);
    assert_eq!(names(&reopened), names(&after), "a second launch renamed");
    assert_eq!(
        numbers(&reopened),
        numbers(&after),
        "a second launch renumbered"
    );
}

#[test]
fn two_sections_holding_one_typed_label_keep_it_and_only_one_holds_its_number() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 12);
        insert_section(&conn, "c_first", "custom", Some("Section 7"));
        insert_section(&conn, "c_second", "custom", Some("Section 7"));
    }

    let (after, _) = upgrade(&path);
    assert_eq!(
        names(&after),
        pairs(&[
            ("c_first", Some("Section 7".to_string())),
            ("c_second", Some("Section 7".to_string())),
        ])
    );
    assert_eq!(numbers(&after), pairs(&[("c_first", 7), ("c_second", 1)]));
}

#[test]
fn a_detected_label_the_athlete_named_on_purpose_stays_a_name() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 46);
        insert_section(&conn, "a_intended", "auto", Some("Section 4"));
        insert_section(&conn, "a_minted", "auto", Some("Abschnitt 4"));
        conn.execute(
            "INSERT INTO section_intents (id, kind, polyline_json, name, sport_type)
             VALUES ('intent', 'named', '[]', 'Section 4', 'Ride')",
            [],
        )
        .unwrap();
    }

    let (after, _) = upgrade(&path);
    assert_eq!(
        names(&after),
        pairs(&[
            ("a_intended", Some("Section 4".to_string())),
            ("a_minted", None),
        ])
    );
    assert_eq!(
        numbers(&after),
        pairs(&[("a_intended", 4), ("a_minted", 1)])
    );
}

#[test]
fn the_numbering_trigger_survives_every_upgrade() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_at_version(&path, 12);

    let (after, _) = upgrade(&path);
    insert_section(&after, "late", "custom", None);
    assert_eq!(numbers(&after), pairs(&[("late", 1)]));
}
