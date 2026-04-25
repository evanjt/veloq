//! Fresh-install schema verification test.
//!
//! Opens a PersistentRouteEngine against an empty database, then verifies
//! that all 12 migrations produce the expected tables, columns, and indexes.

use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

fn open_fresh_db() -> (TempDir, Connection) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("fresh.db");
    {
        let _engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    }
    let conn = Connection::open(&path).expect("reopen");
    (dir, conn)
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        params![name],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!("SELECT {} FROM {} LIMIT 0", column, table))
        .is_ok()
}

fn index_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
        params![name],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

#[test]
fn fresh_install_version_numbers() {
    let (_dir, conn) = open_fresh_db();

    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("user_version");
    assert_eq!(user_version, 12, "12 migrations applied");

    let schema_version: String = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .expect("schema_version");
    assert_eq!(schema_version, "12");
}

#[test]
fn fresh_install_all_tables_exist() {
    let (_dir, conn) = open_fresh_db();

    let expected_tables = [
        "activities",
        "activity_heatmap",
        "activity_indicators",
        "activity_matches",
        "activity_metrics",
        "athlete_profile",
        "exercise_sets",
        "fit_file_status",
        "ftp_history",
        "gps_tracks",
        "overlap_cache",
        "pace_history",
        "processed_activities",
        "route_groups",
        "route_names",
        "schema_info",
        "section_activities",
        "sections",
        "settings",
        "signatures",
        "sport_settings",
        "time_streams",
        "wellness",
    ];

    for table in &expected_tables {
        assert!(table_exists(&conn, table), "table '{}' must exist", table);
    }
}

#[test]
fn fresh_install_v030_columns_exist() {
    let (_dir, conn) = open_fresh_db();

    assert!(column_exists(&conn, "sections", "original_polyline_json"));
    assert!(column_exists(&conn, "sections", "disabled"));
    assert!(column_exists(&conn, "sections", "superseded_by"));
    assert!(column_exists(&conn, "sections", "consensus_state_blob"));
    assert!(column_exists(&conn, "section_activities", "excluded"));
    assert!(column_exists(&conn, "section_activities", "avg_hr"));
    assert!(column_exists(&conn, "activity_matches", "excluded"));
}

#[test]
fn fresh_install_indexes_exist() {
    let (_dir, conn) = open_fresh_db();

    let expected_indexes = [
        "idx_section_activities_perf",
        "idx_activity_metrics_sport_date",
        "idx_sections_disabled",
        "idx_sections_superseded",
        "idx_activity_indicators_activity",
        "idx_activity_indicators_target",
        "idx_exercise_sets_activity",
        "idx_wellness_date_desc",
    ];

    for idx in &expected_indexes {
        assert!(index_exists(&conn, idx), "index '{}' must exist", idx);
    }
}
