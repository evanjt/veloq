//! Scenario: a stored geometry version has lost its cached blob and has to be
//! re-sliced from its reference triple, and the stream behind that triple may
//! have been replaced by a sync since the version was recorded.
//! Expected behaviour: the version remembers the point count of the stream it
//! was cut from. An equal count re-slices, a different or unknown count is
//! refused, because a plausible wrong line renders as real geometry.
//!
//! Coordinates here are synthetic.

mod migration_support;

use migration_support::{latest_version, seed_at_version};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::codec;

const SID: &str = "s_versioned";
const POINTS: u32 = 40;

fn track(points: u32, shift: f64) -> Vec<GpsPoint> {
    (0..points)
        .map(|i| GpsPoint {
            latitude: 46.0 + shift + f64::from(i) * 0.000_1,
            longitude: 7.0 + shift,
            elevation: None,
        })
        .collect()
}

/// A current-schema database holding one stored stream and one exact
/// geometry version sliced from it. Returns the directory, which the caller
/// has to hold, and the version number.
fn library() -> (TempDir, std::path::PathBuf, i64) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("count.db");
    drop(seed_at_version(&path, latest_version()));

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .add_activity("a1".into(), track(POINTS, 0.0), "Ride".into())
        .expect("add_activity");
    let line = track(POINTS, 0.0)[0..12].to_vec();
    let version = engine
        .record_section_geometry(SID, &line, true, Some(("a1", 0, 12)))
        .expect("record a version");
    drop(engine);

    (dir, path, version)
}

fn open(path: &Path) -> Connection {
    Connection::open(path).expect("open")
}

fn clear_version_blob(conn: &Connection) {
    conn.execute(
        "UPDATE section_geometry SET blob = X'' WHERE section_id = ?",
        params![SID],
    )
    .expect("empty the version blob");
}

fn replace_track(conn: &Connection, points: &[GpsPoint]) {
    conn.execute(
        "UPDATE gps_tracks SET track_data = ?, point_count = ? WHERE activity_id = 'a1'",
        params![codec::serialize_track_points(points), points.len() as i64],
    )
    .expect("replace the stream");
}

fn stored_count(conn: &Connection, section_id: &str) -> Option<i64> {
    conn.query_row(
        "SELECT point_count FROM section_geometry WHERE section_id = ? AND version = 1",
        params![section_id],
        |row| row.get(0),
    )
    .expect("the version row")
}

fn restore(path: &Path, version: i64) -> Option<Vec<GpsPoint>> {
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.section_geometry_polyline(SID, version)
}

#[test]
fn a_recorded_version_carries_the_count_of_the_stream_it_was_cut_from() {
    let (_dir, path, _) = library();
    let conn = open(&path);
    assert_eq!(stored_count(&conn, SID), Some(i64::from(POINTS)));
}

#[test]
fn a_consensus_version_carries_no_count() {
    let (_dir, path, _) = library();
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .record_section_geometry("s_averaged", &track(12, 0.5), false, None)
        .expect("record an averaged version");
    drop(engine);
    assert_eq!(stored_count(&open(&path), "s_averaged"), None);
}

#[test]
fn a_version_re_sliced_from_an_unchanged_track_restores_the_same_line() {
    let (_dir, path, version) = library();
    clear_version_blob(&open(&path));

    let restored = restore(&path, version).expect("the triple still indexes its stream");
    assert_eq!(restored, track(POINTS, 0.0)[0..12].to_vec());
}

#[test]
fn a_version_whose_track_was_replaced_is_reported_unrestorable() {
    let (_dir, path, version) = library();
    {
        let conn = open(&path);
        replace_track(&conn, &track(POINTS + 5, 0.0));
        clear_version_blob(&conn);
    }

    assert!(
        restore(&path, version).is_none(),
        "a re-slice over a replaced stream is a different line, not a restore"
    );
}

#[test]
fn a_version_with_no_stored_count_is_unverifiable() {
    let (_dir, path, version) = library();
    {
        let conn = open(&path);
        conn.execute(
            "UPDATE section_geometry SET point_count = NULL WHERE section_id = ?",
            params![SID],
        )
        .expect("forget the count");
        clear_version_blob(&conn);
    }

    assert!(restore(&path, version).is_none());
}

#[test]
fn a_quantisation_only_rewrite_still_restores() {
    let (_dir, path, version) = library();
    {
        let conn = open(&path);
        replace_track(&conn, &track(POINTS, 0.000_001));
        clear_version_blob(&conn);
    }

    let restored = restore(&path, version).expect("same count, same stream");
    assert_eq!(restored.len(), 12);
}

/// A consensus version is averaged across activities and belongs to none, so
/// it keeps its blob and has no triple to check a count against. The stored
/// line is the record and a track that moved underneath cannot reach it.
#[test]
fn a_version_that_carries_its_own_line_needs_no_count() {
    let (_dir, path, _) = library();
    let averaged = track(12, 0.5);
    let version = {
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .record_section_geometry("s_averaged", &averaged, false, None)
            .expect("record an averaged version")
    };
    {
        let conn = open(&path);
        replace_track(&conn, &track(POINTS + 5, 0.0));
    }

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let restored = engine
        .section_geometry_polyline("s_averaged", version)
        .expect("the stored line is the record");
    assert_eq!(restored.len(), averaged.len());
    assert_eq!(stored_count(&open(&path), "s_averaged"), None);
}

/// Scenario: a database written before the column existed opens on this build.
/// Expected behaviour: every version whose stream is still stored gets its
/// count from that stream, and one whose stream is gone stays unverifiable.
#[test]
fn the_upgrade_backfills_the_count_from_the_stored_track() {
    let (_dir, path, _) = library();
    {
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine
            .record_section_geometry("s_orphaned", &track(12, 0.5), false, Some(("gone", 0, 12)))
            .expect("record a version over a missing stream");
    }
    {
        let conn = open(&path);
        conn.execute("ALTER TABLE section_geometry DROP COLUMN point_count", [])
            .expect("drop the column");
    }

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("reopen"));

    let conn = open(&path);
    assert_eq!(stored_count(&conn, SID), Some(i64::from(POINTS)));
    assert_eq!(stored_count(&conn, "s_orphaned"), None);
}

#[test]
fn a_quarantine_salvage_carries_the_count_across() {
    let (_dir, source, _) = library();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("fresh.db");
    {
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("fresh engine");
        let counts = engine.salvage_ledger_from(source.to_str().unwrap());
        assert_eq!(counts.geometry, 1);
    }

    let count: Option<i64> = open(&path)
        .query_row(
            "SELECT point_count FROM section_geometry WHERE section_id = ?",
            params![SID],
            |row| row.get(0),
        )
        .optional()
        .expect("query")
        .flatten();
    assert_eq!(count, Some(i64::from(POINTS)));
}
