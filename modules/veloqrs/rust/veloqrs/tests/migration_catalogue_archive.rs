//! Scenario: a library an older build cut over holds its pre-cutover catalogue
//! in the two archive tables: one promoted run, whose lines were trimmed and
//! whose shapes the cutover's own detect kept as milestones, and one still in
//! flight, whose lines are stored.
//!
//! Expected behaviour: the upgrade carries every archived section into the
//! section ledger as an `archived` row naming a version that draws its line,
//! drops the two tables, and a retry of the in-flight run finds its snapshot.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use std::path::Path;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::codec;

fn ride() -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.000_1,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

/// The columns an older build's open hooks added beside the SQL chain.
fn add_hook_columns(conn: &Connection) {
    conn.execute_batch(
        "ALTER TABLE sections ADD COLUMN rep_start_index INTEGER;
         ALTER TABLE sections ADD COLUMN rep_end_index INTEGER;
         ALTER TABLE sections ADD COLUMN geometry_source TEXT;
         ALTER TABLE section_geometry ADD COLUMN point_count INTEGER;",
    )
    .expect("hook columns");
}

fn archive_row(conn: &Connection, section_id: &str, line: Option<&[GpsPoint]>) {
    conn.execute(
        "INSERT INTO section_catalogue_archive
             (token, section_id, name, sport_type, polyline_blob, distance_meters,
              visit_count, created_at)
         VALUES ('unified-1', ?, ?, 'Ride', ?, 1200.0, 4, '2025-06-01T00:00:00Z')",
        params![
            section_id,
            format!("Name of {section_id}"),
            line.map(codec::serialize_track_points)
        ],
    )
    .expect("archive row");
    conn.execute(
        "INSERT INTO section_catalogue_archive_members (token, section_id, activity_id)
         VALUES ('unified-1', ?, 'a1')",
        [section_id],
    )
    .expect("archive member");
}

/// A schema-53 library with one stored ride and three archived sections:
/// `s_trimmed` (promoted, its line kept as the cutover detect's milestone),
/// `s_inflight` (line stored, the live row still naming the range that cuts
/// it) and `s_lost` (line stored, no live row left).
fn seed(path: &Path) {
    let conn = seed_at_version(path, 53);
    add_hook_columns(&conn);
    conn.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
         VALUES ('a1', 'Ride', 46.0, 46.01, 7.0, 7.0)",
        [],
    )
    .expect("activity");
    conn.execute(
        "INSERT INTO gps_tracks (activity_id, track_data, point_count) VALUES ('a1', ?, 40)",
        [codec::serialize_track_points(&ride())],
    )
    .expect("track");

    archive_row(&conn, "s_trimmed", None);
    conn.execute(
        "INSERT INTO section_geometry
             (section_id, version, blob, milestone, rep_activity_id, rep_start_index,
              rep_end_index, source, point_count)
         VALUES ('s_trimmed', 2, X'', 1, 'a1', 0, 12, 'exact', 40)",
        [],
    )
    .expect("the cutover detect's milestone");
    conn.execute(
        "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
         VALUES ('s_trimmed', '2026-03-01 10:00:00', 'algorithm_changed', '{}', 2)",
        [],
    )
    .expect("the change the detect recorded");

    archive_row(&conn, "s_inflight", Some(&ride()[5..20]));
    conn.execute(
        "INSERT INTO sections
             (id, section_type, sport_type, polyline_json, distance_meters,
              representative_activity_id, rep_start_index, rep_end_index, geometry_source)
         VALUES ('s_inflight', 'auto', 'Ride', '[]', 1200.0, 'a1', 5, 20, 'exact')",
        [],
    )
    .expect("the live row");

    archive_row(&conn, "s_lost", Some(&ride()[20..30]));

    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('__detector_cutover', 'unified-1-inflight')",
        [],
    )
    .expect("token");
}

/// `(details, version)` of each archived row, by section.
fn archived(conn: &Connection) -> Vec<(String, serde_json::Value, Option<i64>)> {
    let mut stmt = conn
        .prepare(
            "SELECT section_id, details, geometry_version FROM section_history
             WHERE kind = 'archived' ORDER BY section_id",
        )
        .unwrap();
    stmt.query_map([], |row| {
        let details: String = row.get(1)?;
        Ok((
            row.get(0)?,
            serde_json::from_str(&details).unwrap(),
            row.get(2)?,
        ))
    })
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

fn canonical(line: &[GpsPoint]) -> Vec<GpsPoint> {
    codec::decode_polyline(&codec::encode_polyline(line)).unwrap()
}

#[test]
fn an_older_builds_archive_is_carried_into_the_ledger() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed(&path);

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("upgrade");
    let conn = Connection::open(&path).unwrap();
    let tables = tables_at(&conn);
    assert!(!tables.contains(&"section_catalogue_archive".to_string()));
    assert!(!tables.contains(&"section_catalogue_archive_members".to_string()));

    let rows = archived(&conn);
    let ids: Vec<&str> = rows.iter().map(|(id, _, _)| id.as_str()).collect();
    assert_eq!(ids, vec!["s_inflight", "s_lost", "s_trimmed"]);
    for (id, details, _) in &rows {
        assert_eq!(details["token"], "unified-1");
        assert_eq!(details["name"], format!("Name of {id}"));
        assert_eq!(details["visit_count"], 4);
    }

    let drawn = |id: &str, version: Option<i64>| {
        engine
            .section_geometry_version(id, version.expect("a version"))
            .map(|(points, _)| points)
            .unwrap_or_default()
    };
    assert_eq!(
        rows[2].2,
        Some(2),
        "the trimmed row names the detect's milestone"
    );
    assert_eq!(drawn("s_trimmed", rows[2].2), ride()[0..12].to_vec());
    assert_eq!(drawn("s_inflight", rows[0].2), ride()[5..20].to_vec());
    assert_eq!(drawn("s_lost", rows[1].2), canonical(&ride()[20..30]));

    let (source, blob): (String, Vec<u8>) = conn
        .query_row(
            "SELECT source, blob FROM section_geometry WHERE section_id = 's_inflight'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        source, "exact",
        "the live row's range re-slices the stored line"
    );
    assert!(blob.is_empty());

    let at: String = conn
        .query_row(
            "SELECT at FROM section_history WHERE section_id = 's_trimmed' AND kind = 'archived'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        at, "2026-03-01 10:00:00",
        "dated when the cutover replaced it"
    );
    drop(engine);

    // A second open carries nothing twice.
    drop(PersistentEngine::new(path.to_str().unwrap()).expect("reopen"));
    assert_eq!(archived(&Connection::open(&path).unwrap()).len(), 3);
}
