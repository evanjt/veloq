//! Scenario: a library from before the routes screen kept its counts as stored
//! rows is opened by this build, once from the schema a released build shipped
//! and once from the one just before, which still carries the single visible
//! count and the triggers an open made for it.
//!
//! Expected behaviour: the upgrade leaves the kind counts and the group sizes
//! equal to the rows already held, drops the old count with its triggers, and a
//! section written after it is counted rather than refused.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

/// The triggers a build at the schema before kept the visible count with,
/// made on every open and so present on a device.
const OLD_COUNT_TRIGGERS: &str = r#"
CREATE TRIGGER section_visible_count_ai
AFTER INSERT ON sections WHEN NEW.disabled = 0 AND NEW.superseded_by IS NULL BEGIN
    INSERT INTO section_visible_count (id, n) VALUES (1, 1)
    ON CONFLICT(id) DO UPDATE SET n = n + 1;
END;
CREATE TRIGGER section_visible_count_ad
AFTER DELETE ON sections WHEN OLD.disabled = 0 AND OLD.superseded_by IS NULL BEGIN
    INSERT INTO section_visible_count (id, n) VALUES (1, -1)
    ON CONFLICT(id) DO UPDATE SET n = n - 1;
END;
CREATE TRIGGER section_visible_count_au
AFTER UPDATE OF disabled, superseded_by ON sections BEGIN
    INSERT INTO section_visible_count (id, n) VALUES (1,
        (NEW.disabled = 0 AND NEW.superseded_by IS NULL)
        - (OLD.disabled = 0 AND OLD.superseded_by IS NULL))
    ON CONFLICT(id) DO UPDATE SET n = n
        + (NEW.disabled = 0 AND NEW.superseded_by IS NULL)
        - (OLD.disabled = 0 AND OLD.superseded_by IS NULL);
END;
"#;

const LIBRARY: &str = r#"
INSERT INTO sections (id, section_type, name, sport_type, polyline_json, distance_meters,
                      is_user_defined, disabled)
VALUES ('s1', 'auto', 'A', 'Ride', '[]', 100.0, 0, 0),
       ('s2', 'auto', 'B', 'Ride', '[]', 100.0, 1, 0),
       ('s3', 'auto', 'C', 'Ride', '[]', 100.0, 0, 1),
       ('c1', 'custom', 'D', 'Ride', '[]', 100.0, 1, 0);
INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
VALUES ('g1', 'a1', '["a1","a2"]', 'Ride', 2),
       ('g2', 'a3', '["a3","a4"]', 'Ride', 2),
       ('g3', 'a5', '["a5","a6","a7"]', 'Ride', 3);
"#;

fn pairs(conn: &Connection, sql: &str) -> Vec<(String, i64)> {
    let mut stmt = conn.prepare(sql).unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn kinds(conn: &Connection) -> Vec<(String, i64)> {
    pairs(
        conn,
        "SELECT section_type || '/' || user_defined || '/' || removed, n
         FROM section_list_counts WHERE n != 0 ORDER BY 1",
    )
}

fn sizes(conn: &Connection) -> Vec<(String, i64)> {
    pairs(
        conn,
        "SELECT CAST(activity_count AS TEXT), n FROM route_group_sizes
         WHERE n != 0 ORDER BY activity_count",
    )
}

#[test]
fn an_upgrade_from_the_released_schema_starts_the_counts_empty() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(seed_at_version(&path, 12));

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    let tables = tables_at(&conn);
    assert!(!tables.contains(&"section_visible_count".to_string()));
    assert!(kinds(&conn).is_empty());
    assert!(sizes(&conn).is_empty());
}

#[test]
fn an_upgrade_from_the_schema_before_counts_the_library_already_held() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    {
        let conn = seed_at_version(&path, 65);
        conn.execute_batch(OLD_COUNT_TRIGGERS).unwrap();
        conn.execute_batch(LIBRARY).unwrap();
        let old: i64 = conn
            .query_row("SELECT n FROM section_visible_count", [], |row| row.get(0))
            .unwrap();
        assert_eq!(old, 3, "the old triggers kept the old count");
    }

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    assert_eq!(engine.get_section_count(), 3);
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert!(!tables_at(&conn).contains(&"section_visible_count".to_string()));
    assert_eq!(
        kinds(&conn),
        [
            ("auto/0/0".to_string(), 1),
            ("auto/0/1".to_string(), 1),
            ("auto/1/0".to_string(), 1),
            ("custom/1/0".to_string(), 1),
        ]
    );
    assert_eq!(sizes(&conn), [("2".to_string(), 2), ("3".to_string(), 1)]);

    conn.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters)
         VALUES ('s4', 'auto', 'E', 'Ride', '[]', 100.0)",
        [],
    )
    .expect("a section written after the upgrade");
    assert_eq!(kinds(&conn)[0], ("auto/0/0".to_string(), 2));
}
