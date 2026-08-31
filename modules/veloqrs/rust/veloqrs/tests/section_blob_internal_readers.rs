//! Scenario: the cached section geometry is cleared, the way a "clear cache"
//! must be free to clear it, and the engine's own internal readers then run.
//! Expected behaviour: every one of them resolves the line the same way a
//! screen read does, blob first and the reference triple second, so none of
//! them writes the emptiness into the registry, the ledger or the archive
//! where no triple can undo it.
//!
//! `section_blob_is_droppable.rs` covers the read paths a screen takes. These
//! are the five that run inside a transaction or a migration instead.
//!
//! Coordinates here are synthetic.

mod migration_support;

use migration_support::{latest_version, seed_at_version};
use rusqlite::{Connection, params};
use std::path::Path;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::codec;

const RIDE: i64 = 1_600_000_000;
const POINTS: u32 = 40;

fn track(offset: f64) -> Vec<GpsPoint> {
    (0..POINTS)
        .map(|i| GpsPoint {
            latitude: 46.0 + offset + f64::from(i) * 0.000_1,
            longitude: 7.0 + offset,
            elevation: None,
        })
        .collect()
}

/// A current-schema database holding one stored stream, so a triple written
/// against it re-slices. Returns the directory, which the caller has to hold.
fn library() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("readers.db");
    drop(seed_at_version(&path, latest_version()));

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .add_activity("a1".into(), track(0.0), "Ride".into())
        .expect("add_activity");
    engine
        .update_activity_metadata("a1", Some(RIDE), None, None, None)
        .expect("metadata");
    drop(engine);

    (dir, path)
}

/// One section row whose line is a real slice of `a1`, cached blob included.
fn insert_section(conn: &Connection, id: &str, user_defined: bool) {
    let points = track(0.0)[0..12].to_vec();
    conn.execute(
        "INSERT INTO sections
             (id, section_type, name, sport_type, polyline_json, polyline_blob,
              distance_meters, representative_activity_id, rep_start_index,
              rep_end_index, geometry_source, created_at, is_user_defined,
              bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES (?, 'auto', ?, 'Ride', NULL, ?, 1200.0, 'a1', 0, 12, 'exact',
                 '2026-01-01T00:00:00Z', ?, 46.0, 46.1, 7.0, 7.1)",
        params![
            id,
            format!("Section {id}"),
            codec::serialize_points(&points).expect("encode"),
            i64::from(user_defined),
        ],
    )
    .expect("insert section");
    conn.execute(
        "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
         VALUES (?, 'a1', 0, 12)",
        params![id],
    )
    .expect("insert junction row");
}

/// Everything a "clear cache" is allowed to drop from the sections table.
fn clear_geometry_cache(conn: &Connection) {
    conn.execute(
        "UPDATE sections SET polyline_blob = NULL, polyline_json = NULL",
        [],
    )
    .expect("clear the cached geometry");
}

fn open(path: &Path) -> Connection {
    Connection::open(path).expect("open")
}

/// Re-run the engine's open-time migrations and hooks over the file.
fn reopen(path: &Path) {
    drop(PersistentEngine::new(path.to_str().unwrap()).expect("reopen engine"));
}

fn forget_marker(conn: &Connection, key: &str) {
    conn.execute("DELETE FROM schema_info WHERE key = ?", params![key])
        .expect("forget the marker");
}

/// Scenario: the ledger's one-off baseline seed runs after a clear.
/// Expected behaviour: it writes the rebuilt line as version 1 rather than
/// skipping the section, which would leave it with no birth geometry for ever.
#[test]
fn the_baseline_seed_rebuilds_a_cleared_line() {
    let (_dir, path) = library();
    {
        let conn = open(&path);
        insert_section(&conn, "s_baseline", false);
        clear_geometry_cache(&conn);
        conn.execute("DELETE FROM section_geometry", [])
            .expect("clear the ledger");
        forget_marker(&conn, "section_geometry_baseline_v1");
    }

    reopen(&path);

    let conn = open(&path);
    let blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT blob FROM section_geometry WHERE section_id = 's_baseline' AND version = 1",
            [],
            |row| row.get(0),
        )
        .ok();
    let points = blob
        .as_deref()
        .and_then(codec::decode_polyline)
        .unwrap_or_default();
    assert_eq!(
        points.len(),
        12,
        "the seed has to rebuild the line from the triple, not skip the section"
    );
}

/// Scenario: the content-id migration walks the catalogue after a clear.
/// Expected behaviour: a clock-minted id still re-mints, because the line that
/// anchors the new id is rebuildable.
#[test]
fn the_content_id_migration_rebuilds_a_cleared_line() {
    let (_dir, path) = library();
    {
        let conn = open(&path);
        insert_section(&conn, "s_1700000000000__00001", false);
        clear_geometry_cache(&conn);
        forget_marker(&conn, "content_ids_v1");
    }

    reopen(&path);

    let conn = open(&path);
    let still_clock_minted: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE id GLOB 's_[0-9]*__[0-9]*'",
            [],
            |row| row.get(0),
        )
        .expect("count");
    assert_eq!(
        still_clock_minted, 0,
        "a clock-minted id with a rebuildable line has to re-mint as a content id"
    );
}

/// Scenario: the detector generation changes and every auto shape is about to
/// be replaced, after a clear.
/// Expected behaviour: the outgoing line is milestoned from the triple, so the
/// ledger keeps a real "before" rather than an empty one nothing can overlay.
#[test]
fn the_algorithm_change_milestones_a_cleared_line() {
    let (_dir, path) = library();
    {
        let conn = open(&path);
        insert_section(&conn, "s_prior", false);
        clear_geometry_cache(&conn);
        conn.execute("DELETE FROM section_geometry", [])
            .expect("clear the ledger");
        conn.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES
                 ('catalogue_detection_method', 'corridor'),
                 ('catalogue_config_digest', 'deadbeefdeadbeef')",
            [],
        )
        .expect("stamp an older generation");
    }

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.apply_sections(Vec::new()).expect("apply_sections");
    drop(engine);

    let conn = open(&path);
    let blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT blob FROM section_geometry WHERE section_id = 's_prior'
             ORDER BY version DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();
    let points = blob
        .as_deref()
        .and_then(codec::decode_polyline)
        .unwrap_or_default();
    assert_eq!(
        points.len(),
        12,
        "the outgoing shape has to be milestoned from the triple, not lost"
    );
}

/// Scenario: a stored geometry version's own blob no longer decodes, and the
/// user asks to revert to it.
/// Expected behaviour: the version carries its own triple, so it rebuilds the
/// same way the live row does. Returning nothing would make the revert target
/// silently unreachable.
#[test]
fn a_geometry_version_rebuilds_from_its_own_triple() {
    let (_dir, path) = library();
    {
        let conn = open(&path);
        insert_section(&conn, "s_versioned", false);
    }

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let line = track(0.0)[0..12].to_vec();
    let version = engine
        .record_section_geometry("s_versioned", &line, true, Some(("a1", 0, 12)))
        .expect("record a version");
    drop(engine);

    {
        let conn = open(&path);
        conn.execute(
            "UPDATE section_geometry SET blob = X'' WHERE section_id = 's_versioned'",
            [],
        )
        .expect("empty the version blob");
    }

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let rebuilt = engine
        .section_geometry_polyline("s_versioned", version)
        .unwrap_or_default();
    assert_eq!(
        rebuilt.len(),
        12,
        "a version with an unreadable blob still has its triple to rebuild from"
    );
}
