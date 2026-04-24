//! Tier 1.4 — assert that the perf indexes added in migration 024 are
//! actually used by the planner for the queries they target.
//!
//! Two checks via `EXPLAIN QUERY PLAN`:
//! 1. `SELECT COUNT(*) FROM section_activities WHERE section_id = ?
//!    AND excluded = 0 AND lap_time IS NOT NULL` — visit_count derivation,
//!    must use `idx_section_activities_perf`.
//! 2. `SELECT id FROM activity_metrics WHERE sport_type = ? ORDER BY date
//!    DESC LIMIT 50` — feed/sport-filtered queries, must use
//!    `idx_activity_metrics_sport_date`.
//!
//! Without an index, EXPLAIN QUERY PLAN reports `SCAN <table>`. With the
//! right index, it reports `SEARCH <table> USING INDEX <name>`. We assert
//! the latter substring.

#![cfg(feature = "synthetic")]

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

fn open_engine_db() -> (TempDir, Connection) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("schema.db");
    // Run migrations by opening the engine, then drop and reopen as plain
    // Connection to introspect.
    {
        let _engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    }
    let conn = Connection::open(&path).expect("reopen");
    (dir, conn)
}

fn explain(conn: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
        .expect("prepare explain");
    let rows: Vec<String> = stmt
        .query_map([], |row| {
            // EXPLAIN QUERY PLAN columns: id, parent, notused, detail
            let detail: String = row.get(3)?;
            Ok(detail)
        })
        .expect("query_map")
        .filter_map(|r| r.ok())
        .collect();
    rows
}

#[test]
fn section_activities_perf_query_uses_composite_index() {
    let (_dir, conn) = open_engine_db();
    let plan = explain(
        &conn,
        "SELECT COUNT(*) FROM section_activities \
         WHERE section_id = 'sec_ride_0' AND excluded = 0 AND lap_time IS NOT NULL",
    );
    let joined = plan.join(" | ");
    println!("[schema_indexes] section_activities plan: {}", joined);
    assert!(
        joined.contains("idx_section_activities_perf"),
        "expected plan to use idx_section_activities_perf, got: {}",
        joined
    );
    assert!(
        !joined.contains("SCAN section_activities"),
        "expected SEARCH (index lookup), got SCAN: {}",
        joined
    );
}

#[test]
fn activity_metrics_sport_date_query_uses_composite_index() {
    let (_dir, conn) = open_engine_db();
    let plan = explain(
        &conn,
        "SELECT activity_id FROM activity_metrics \
         WHERE sport_type = 'Ride' ORDER BY date DESC LIMIT 50",
    );
    let joined = plan.join(" | ");
    println!("[schema_indexes] activity_metrics plan: {}", joined);
    assert!(
        joined.contains("idx_activity_metrics_sport_date"),
        "expected plan to use idx_activity_metrics_sport_date, got: {}",
        joined
    );
    assert!(
        !joined.contains("SCAN activity_metrics"),
        "expected SEARCH (index lookup), got SCAN: {}",
        joined
    );
}
