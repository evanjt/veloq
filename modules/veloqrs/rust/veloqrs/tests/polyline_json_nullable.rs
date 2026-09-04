//! `sections.polyline_json` is a legacy fallback the blob replaced. The
//! rebuild that relaxes its NOT NULL runs as a post-migration hook with
//! foreign keys off, so a referenced table can be swapped without cascading
//! a delete into the junction rows.
//!
//! Scenario: a populated previous-version database opens on this build.
//! Expected behaviour: every section and junction row survives, the column
//! is nullable, foreign keys are back on, and a torn rebuild leaves the old
//! table exactly as it was.

mod migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use std::path::Path;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

const PREVIOUS: u32 = 18;

fn points(n: usize) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| GpsPoint {
            latitude: 47.3 + i as f64 * 0.0001,
            longitude: 8.5 + i as f64 * 0.0001,
            elevation: None,
        })
        .collect()
}

/// Two sections, one legacy row carrying real JSON and one blob-only row,
/// and three junction rows between them.
fn seed_previous(path: &Path) {
    let conn = seed_at_version(path, PREVIOUS);
    for (i, id) in ["a1", "a2"].iter().enumerate() {
        conn.execute(
            "INSERT INTO activities(id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                    start_date, name, distance_meters, duration_secs)
             VALUES (?1, 'Ride', 47.3, 47.5, 8.5, 8.6, ?2, ?3, 25000.0, 3600)",
            params![
                id,
                1_735_689_600_i64 + i as i64 * 86_400,
                format!("Ride {i}")
            ],
        )
        .expect("seed activity");
    }
    let json = serde_json::to_string(&points(40)).unwrap();
    conn.execute(
        "INSERT INTO sections(id, section_type, name, sport_type, polyline_json,
                              distance_meters, version, is_user_defined, created_at)
         VALUES ('legacy', 'auto', 'Legacy', 'Ride', ?1, 500.0, 1, 0, '2026-01-01 00:00:00')",
        params![json],
    )
    .expect("seed legacy section");
    let blob = veloqrs::persistence::codec::serialize_points(&points(30)).unwrap();
    conn.execute(
        "INSERT INTO sections(id, section_type, name, sport_type, polyline_json,
                              polyline_blob, distance_meters, version, is_user_defined, created_at)
         VALUES ('blob', 'auto', 'Blob', 'Ride', '', ?1, 400.0, 1, 0, '2026-01-02 00:00:00')",
        params![blob],
    )
    .expect("seed blob section");
    for (section, activity, start) in [
        ("legacy", "a1", 10),
        ("legacy", "a2", 12),
        ("blob", "a1", 3),
    ] {
        conn.execute(
            "INSERT INTO section_activities(section_id, activity_id, direction, start_index,
                                            end_index, distance_meters, lap_time, lap_pace, excluded)
             VALUES (?1, ?2, 'same', ?3, ?4, 500.0, 120.0, 4.1, 0)",
            params![section, activity, start, start + 20],
        )
        .expect("seed junction row");
    }
}

fn polyline_json_not_null(conn: &Connection) -> bool {
    conn.prepare("PRAGMA table_info(sections)")
        .unwrap()
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .any(|(name, notnull)| name == "polyline_json" && notnull != 0)
}

#[test]
fn an_upgrade_relaxes_the_column_and_keeps_every_row() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("prev.db");
    seed_previous(&path);
    assert!(polyline_json_not_null(&Connection::open(&path).unwrap()));

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("upgraded engine");
    let legacy = engine.get_section_by_id("legacy").expect("legacy row");
    assert_eq!(legacy.polyline.len(), 40, "legacy JSON still decodes");
    let blob = engine.get_section_by_id("blob").expect("blob row");
    assert_eq!(blob.polyline.len(), 30, "blob still decodes");
    assert_eq!(legacy.activity_ids.len(), 2);
    assert_eq!(blob.activity_ids.len(), 1);
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert!(
        !polyline_json_not_null(&conn),
        "the column must be nullable"
    );
    assert_eq!(row_count(&conn, "sections"), Some(2));
    assert_eq!(row_count(&conn, "section_activities"), Some(3));
    let fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1, "foreign keys are back on after the rebuild");
    let leftovers: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'sections_rebuild'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(leftovers, 0);
    let triggers: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'
             AND name LIKE 'section_activities_visit_count_%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(triggers, 4, "the visit_count triggers are recreated");
    let visits: i64 = conn
        .query_row(
            "SELECT visit_count FROM sections WHERE id = 'legacy'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(visits, 2, "visit_count is recounted onto the rebuilt table");
}

#[test]
fn a_torn_rebuild_leaves_the_old_table_intact() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("torn.db");
    seed_previous(&path);
    // A view under the scratch name makes CREATE TABLE fail inside the
    // rebuild transaction, after the hook has already switched keys off.
    Connection::open(&path)
        .unwrap()
        .execute_batch("CREATE VIEW sections_rebuild AS SELECT 1 AS x")
        .unwrap();

    let opened = PersistentEngine::new(path.to_str().unwrap());
    assert!(opened.is_err(), "a failed rebuild must not open as healthy");

    let conn = Connection::open(&path).unwrap();
    assert!(polyline_json_not_null(&conn), "the old table is untouched");
    assert_eq!(row_count(&conn, "sections"), Some(2));
    assert_eq!(row_count(&conn, "section_activities"), Some(3));
}

#[test]
fn a_fresh_write_leaves_polyline_json_null() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("fresh.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    engine
        .add_activity("a1".into(), points(60), "Ride".into())
        .unwrap();
    let id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: points(60)[5..45].to_vec(),
            distance_meters: 500.0,
            name: Some("Custom".into()),
            source_activity_id: Some("a1".into()),
            start_index: Some(5),
            end_index: Some(45),
        })
        .unwrap();
    drop(engine);
    let conn = Connection::open(&path).unwrap();
    let json: Option<String> = conn
        .query_row(
            "SELECT polyline_json FROM sections WHERE id = ?",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(json, None);
}

/// The rebuild predates any index or column a later migration adds, so it
/// reads both off the live table rather than a list written here.
#[test]
fn the_rebuild_keeps_every_index_and_column() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("indexes.db");
    seed_previous(&path);
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "ALTER TABLE sections ADD COLUMN future_metric REAL;
             UPDATE sections SET future_metric = 7.5 WHERE id = 'legacy';
             CREATE INDEX idx_sections_future_metric ON sections(future_metric);",
        )
        .unwrap();

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("upgraded engine");
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert!(!polyline_json_not_null(&conn));
    for index in [
        "idx_sections_type",
        "idx_sections_sport",
        "idx_sections_disabled",
        "idx_sections_superseded",
        "idx_sections_rank_score",
        "idx_sections_klass",
        "idx_sections_future_metric",
    ] {
        let present: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
                [index],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(present, 1, "{index} survives the rebuild");
    }
    let metric: Option<f64> = conn
        .query_row(
            "SELECT future_metric FROM sections WHERE id = 'legacy'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(metric, Some(7.5), "a migration-added column carries over");
}
