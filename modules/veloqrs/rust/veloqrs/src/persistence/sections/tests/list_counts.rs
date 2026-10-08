//! The routes screen's totals and counters are stored rows the section and
//! route group triggers keep, so reading them never scans either catalogue.
//!
//! Expected behaviour: after any insert, accept, disable, supersession, restore
//! or delete of a section, and any write to a group's member count, the stored
//! counts equal a count of the rows; and after the triggers are lost to a
//! rebuild and the database is opened again, they are reseeded.

use rusqlite::params;

use crate::persistence::PersistentEngine;

fn insert_section(engine: &PersistentEngine, id: &str, section_type: &str) {
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters)
             VALUES (?, ?, 'A', 'Ride', '[]', 100.0)",
            params![id, section_type],
        )
        .unwrap();
}

fn insert_group(engine: &PersistentEngine, id: &str, count: Option<u32>) {
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count)
             VALUES (?, 'a1', '[\"a1\"]', 'Ride', ?)",
            params![id, count],
        )
        .unwrap();
}

fn write(engine: &PersistentEngine, sql: &str) {
    engine.db.execute_batch(sql).unwrap();
}

fn rows(engine: &PersistentEngine, sql: &str) -> Vec<(String, i64)> {
    let mut stmt = engine.db.prepare(sql).unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// Each kind of section and how many there are, from the stored counts.
fn stored_kinds(engine: &PersistentEngine) -> Vec<(String, i64)> {
    rows(
        engine,
        "SELECT section_type || '/' || user_defined || '/' || removed, n
         FROM section_list_counts WHERE n != 0 ORDER BY 1",
    )
}

/// The same, counted from the rows.
fn counted_kinds(engine: &PersistentEngine) -> Vec<(String, i64)> {
    rows(
        engine,
        "SELECT section_type || '/' || (COALESCE(is_user_defined, 0) != 0) || '/'
                || (disabled != 0 OR superseded_by IS NOT NULL), COUNT(*)
         FROM sections GROUP BY 1 ORDER BY 1",
    )
}

fn stored_sizes(engine: &PersistentEngine) -> Vec<(String, i64)> {
    rows(
        engine,
        "SELECT CAST(activity_count AS TEXT), n FROM route_group_sizes
         WHERE n != 0 ORDER BY activity_count",
    )
}

fn counted_sizes(engine: &PersistentEngine) -> Vec<(String, i64)> {
    rows(
        engine,
        "SELECT CAST(activity_count AS TEXT), COUNT(*) FROM route_groups
         WHERE activity_count IS NOT NULL GROUP BY activity_count ORDER BY activity_count",
    )
}

fn visible(engine: &PersistentEngine) -> u32 {
    engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE disabled = 0 AND superseded_by IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn the_stored_counts_follow_every_write_to_a_sections_kind() {
    let engine = PersistentEngine::in_memory().expect("engine");
    assert_eq!(engine.get_section_count(), 0);
    assert!(stored_kinds(&engine).is_empty());

    let steps = [
        "UPDATE sections SET is_user_defined = 1 WHERE id = 's1'",
        "UPDATE sections SET is_user_defined = NULL WHERE id = 's1'",
        "UPDATE sections SET disabled = 1 WHERE id = 's1'",
        "UPDATE sections SET disabled = 1 WHERE id = 's1'",
        "UPDATE sections SET superseded_by = 's2' WHERE id = 's3'",
        "UPDATE sections SET disabled = 1 WHERE id = 's3'",
        "UPDATE sections SET superseded_by = NULL WHERE id = 's3'",
        "UPDATE sections SET disabled = 0 WHERE id = 's1'",
        "UPDATE sections SET name = 'B' WHERE id = 's2'",
        "UPDATE sections SET disabled = 1, is_user_defined = 1 WHERE id = 'c1'",
        "DELETE FROM sections WHERE id = 's3'",
        "DELETE FROM sections WHERE id = 's4'",
        "DELETE FROM sections WHERE id = 'c1'",
    ];
    for (id, section_type) in [
        ("s1", "auto"),
        ("s2", "auto"),
        ("s3", "auto"),
        ("s4", "auto"),
    ]
    .into_iter()
    .chain([("c1", "custom"), ("c2", "custom")])
    {
        insert_section(&engine, id, section_type);
        assert_eq!(stored_kinds(&engine), counted_kinds(&engine));
    }
    assert_eq!(engine.get_section_count(), 6);
    for sql in steps {
        write(&engine, sql);
        assert_eq!(stored_kinds(&engine), counted_kinds(&engine), "after {sql}");
        assert_eq!(engine.get_section_count(), visible(&engine), "after {sql}");
    }
    assert_eq!(engine.get_section_count(), 3);
}

#[test]
fn the_stored_sizes_follow_every_write_to_a_groups_count() {
    let engine = PersistentEngine::in_memory().expect("engine");
    for (id, count) in [
        ("g1", Some(3)),
        ("g2", Some(3)),
        ("g3", Some(1)),
        ("g4", None),
    ] {
        insert_group(&engine, id, count);
        assert_eq!(stored_sizes(&engine), counted_sizes(&engine));
    }
    for sql in [
        "UPDATE route_groups SET activity_count = 5 WHERE id = 'g1'",
        "UPDATE route_groups SET activity_count = 5 WHERE id = 'g1'",
        "UPDATE route_groups SET activity_count = 2 WHERE id = 'g4'",
        "UPDATE route_groups SET activity_count = NULL WHERE id = 'g2'",
        "UPDATE route_groups SET representative_id = 'a2' WHERE id = 'g3'",
        "DELETE FROM route_groups WHERE id = 'g2'",
        "DELETE FROM route_groups WHERE id = 'g3'",
    ] {
        write(&engine, sql);
        assert_eq!(stored_sizes(&engine), counted_sizes(&engine), "after {sql}");
    }
    write(&engine, "DELETE FROM route_groups");
    assert!(stored_sizes(&engine).is_empty());
}

#[test]
fn opening_a_database_whose_counts_drifted_reseeds_them() {
    let dir = tempfile::tempdir().expect("dir");
    let path = dir.path().join("routes.db");
    {
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        insert_section(&engine, "s1", "auto");
        insert_section(&engine, "s2", "custom");
        insert_group(&engine, "g1", Some(2));
        write(
            &engine,
            "DROP TRIGGER section_list_counts_ai;
             DROP TRIGGER route_group_sizes_ai;",
        );
        insert_section(&engine, "s3", "auto");
        insert_group(&engine, "g2", Some(4));
        assert_ne!(stored_kinds(&engine), counted_kinds(&engine));
        assert_ne!(stored_sizes(&engine), counted_sizes(&engine));
    }
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    assert_eq!(stored_kinds(&engine), counted_kinds(&engine));
    assert_eq!(stored_sizes(&engine), counted_sizes(&engine));
    assert_eq!(engine.get_section_count(), 3);
}
