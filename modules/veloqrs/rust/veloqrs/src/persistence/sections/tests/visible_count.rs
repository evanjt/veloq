//! The visible section count is a stored row the section triggers keep, so
//! reading it never scans the catalogue.
//!
//! Expected behaviour: after any insert, disable, supersession, restore or
//! delete of a section, and after the triggers are lost to a rebuild and the
//! database is opened again, the stored count equals a count of the visible
//! rows.

use rusqlite::params;

use crate::persistence::PersistentEngine;

fn insert(engine: &PersistentEngine, id: &str) {
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters)
             VALUES (?, 'auto', 'A', 'Ride', '[]', 100.0)",
            params![id],
        )
        .unwrap();
}

fn counted(engine: &PersistentEngine) -> u32 {
    engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE disabled = 0 AND superseded_by IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn stored(engine: &PersistentEngine) -> u32 {
    engine.get_section_count()
}

#[test]
fn the_stored_count_follows_every_write_to_visibility() {
    let engine = PersistentEngine::in_memory().expect("engine");
    assert_eq!(stored(&engine), 0);

    for id in ["s1", "s2", "s3", "s4"] {
        insert(&engine, id);
        assert_eq!(stored(&engine), counted(&engine));
    }
    assert_eq!(stored(&engine), 4);

    engine
        .db
        .execute("UPDATE sections SET disabled = 1 WHERE id = 's1'", [])
        .unwrap();
    assert_eq!(stored(&engine), 3);

    engine
        .db
        .execute("UPDATE sections SET disabled = 1 WHERE id = 's1'", [])
        .unwrap();
    assert_eq!(stored(&engine), 3, "a repeated write moves nothing");

    engine
        .db
        .execute(
            "UPDATE sections SET superseded_by = 's2' WHERE id = 's3'",
            [],
        )
        .unwrap();
    assert_eq!(stored(&engine), 2);

    engine
        .db
        .execute("UPDATE sections SET disabled = 0 WHERE id = 's1'", [])
        .unwrap();
    assert_eq!(stored(&engine), 3);

    engine
        .db
        .execute("UPDATE sections SET name = 'B' WHERE id = 's2'", [])
        .unwrap();
    assert_eq!(stored(&engine), 3, "a rename is not a visibility change");

    engine
        .db
        .execute("DELETE FROM sections WHERE id = 's3'", [])
        .unwrap();
    assert_eq!(
        stored(&engine),
        3,
        "a hidden section leaving changes nothing"
    );
    engine
        .db
        .execute("DELETE FROM sections WHERE id = 's4'", [])
        .unwrap();
    assert_eq!(stored(&engine), 2);
    assert_eq!(stored(&engine), counted(&engine));
}

#[test]
fn opening_a_database_whose_count_drifted_reseeds_it() {
    let dir = tempfile::tempdir().expect("dir");
    let path = dir.path().join("routes.db");
    {
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        insert(&engine, "s1");
        insert(&engine, "s2");
        engine
            .db
            .execute_batch(
                "DROP TRIGGER section_visible_count_ai;
                 INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters)
                 VALUES ('s3', 'auto', 'C', 'Ride', '[]', 100.0);",
            )
            .unwrap();
        assert_eq!(stored(&engine), 2);
    }
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    assert_eq!(stored(&engine), 3);
}
