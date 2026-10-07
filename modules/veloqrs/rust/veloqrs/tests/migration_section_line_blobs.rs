//! Scenario: a library an older build left behind, where a trimmed section's
//! original line and every section intent's footprint are stored as JSON.
//!
//! Expected behaviour: the upgrade carries every one of those rows as it is,
//! and they keep working: the trimmed section still resets, a legacy name
//! still resolves, and a hidden corridor keeps its footprint. Lines the
//! upgrade writes itself, such as a legacy name promoted to an intent, go
//! into the quantised blob and leave the JSON column empty.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::codec;

/// Eight points about 55 m apart along a meridian.
fn line() -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0005, 7.0))
        .collect()
}

fn json(points: &[GpsPoint]) -> String {
    serde_json::to_string(points).unwrap()
}

fn assert_close(points: &[GpsPoint], expected: &[GpsPoint]) {
    assert_eq!(points.len(), expected.len(), "line length");
    for (got, want) in points.iter().zip(expected) {
        assert!((got.latitude - want.latitude).abs() < 1e-9);
        assert!((got.longitude - want.longitude).abs() < 1e-9);
    }
}

fn insert_section(conn: &Connection, id: &str, name: Option<&str>, points: &[GpsPoint]) {
    conn.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, created_at)
         VALUES (?, 'auto', ?, 'Ride', ?, 385.0, '2026-01-01T00:00:00Z')",
        params![id, name, json(points)],
    )
    .unwrap();
}

/// A section an older build trimmed: the shorter line is the section's, the
/// full one is its backup.
fn insert_trimmed(conn: &Connection, id: &str) {
    insert_section(conn, id, None, &line()[0..6]);
    conn.execute(
        "UPDATE sections SET is_user_defined = 1, original_polyline_json = ? WHERE id = ?",
        params![json(&line()), id],
    )
    .unwrap();
}

fn intent(conn: &Connection, id: &str) -> (Option<Vec<GpsPoint>>, Option<String>) {
    let (blob, text): (Option<Vec<u8>>, Option<String>) = conn
        .query_row(
            "SELECT polyline_blob, polyline_json FROM section_intents WHERE id = ?",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    (
        blob.map(|bytes| codec::deserialize_points(&bytes).expect("decodable intent blob")),
        text,
    )
}

fn column_is_nullable(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT \"notnull\" = 0 FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn legacy_json_lines_survive_the_upgrade_from_the_release_before() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, latest_version() - 1);
        insert_trimmed(&conn, "trimmed");
        insert_section(&conn, "under_name", None, &line());
        conn.execute(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
             VALUES ('ni_old', 'named', ?1, '2026-01-01T00:00:00Z', 'Lakeside', 'Ride'),
                    ('hidden', 'disabled', ?1, '2026-01-01T00:00:00Z', NULL, NULL)",
            params![json(&line())],
        )
        .unwrap();
    }

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    let conn = Connection::open(&path).unwrap();
    assert!(column_is_nullable(
        &conn,
        "section_intents",
        "polyline_json"
    ));
    for id in ["ni_old", "hidden"] {
        let (blob, text) = intent(&conn, id);
        assert_eq!(blob, None, "{id}: the upgrade rewrites no row");
        assert_eq!(text.as_deref(), Some(json(&line()).as_str()), "{id}");
    }

    let corridor = engine
        .get_named_corridors()
        .into_iter()
        .find(|c| c.intent_id == "ni_old")
        .expect("the legacy name resolves");
    assert_close(&corridor.footprint, &line());
    assert_eq!(corridor.section_id.as_deref(), Some("under_name"));

    assert!(engine.has_original_bounds("trimmed"));
    engine.reset_section_bounds("trimmed").expect("reset");
    let restored = engine.get_section("trimmed").expect("section");
    assert_close(&restored.polyline, &line());
}

#[test]
fn an_upgrade_from_twelve_keeps_trims_and_writes_promoted_names_as_blobs() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 12);
        insert_trimmed(&conn, "trimmed");
        insert_section(&conn, "typed", Some("Harbour sprint"), &line());
    }

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate");
    let conn = Connection::open(&path).unwrap();

    let (blob, text) = intent(&conn, "ni_bf_typed");
    assert_close(&blob.expect("promoted name footprint as a blob"), &line());
    assert_eq!(text, None, "a promoted name is not stored as JSON");

    let original: Option<String> = conn
        .query_row(
            "SELECT original_polyline_json FROM sections WHERE id = 'trimmed'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(original.as_deref(), Some(json(&line()).as_str()));
    assert!(engine.has_original_bounds("trimmed"));
    engine.reset_section_bounds("trimmed").expect("reset");
    let restored = engine.get_section("trimmed").expect("section");
    assert_close(&restored.polyline, &line());
}
