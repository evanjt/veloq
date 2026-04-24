//! Integration tests for activity indicators version-based invalidation.
//!
//! Verifies B-2 fix: recompute fires on any version mismatch, not only when
//! sections are present (the old guard left users with empty section tables
//! stuck on stale indicators forever).
//!
//! Run: `cargo test --test indicators -p veloqrs`

use rusqlite::{params, Connection};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

const CURRENT_VERSION: i32 = 4;

struct Setup {
    engine: PersistentRouteEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();
    let engine = PersistentRouteEngine::new(&path_str).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");
    Setup { engine, raw, _tmp: tmp }
}

fn set_indicator_version(db: &Connection, version: i32) {
    db.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('indicator_version', ?1)",
        params![version.to_string()],
    )
    .expect("set indicator_version");
}

fn read_indicator_version(db: &Connection) -> i32 {
    db.query_row(
        "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = 'indicator_version'",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

fn insert_stale_indicator(db: &Connection, activity_id: &str) {
    db.execute(
        "INSERT INTO activity_indicators
         (activity_id, indicator_type, target_id, target_name, direction,
          lap_time, trend, computed_at)
         VALUES (?1, 'section_pr', 'old_section', 'Old', 'same', 100.0, 0, 0)",
        params![activity_id],
    )
    .expect("insert stale indicator");
}

fn count_indicators(db: &Connection) -> i64 {
    db.query_row("SELECT COUNT(*) FROM activity_indicators", [], |r| r.get(0))
        .unwrap_or(-1)
}

// ============================================================================
// B-2 regression: version recompute does not depend on section presence
// ============================================================================

#[test]
fn version_mismatch_with_no_sections_still_recomputes() {
    // The bug: old code gated recompute on `!self.sections.is_empty()`, so
    // users with no sections never picked up new indicator-algorithm versions.
    let setup = setup();
    set_indicator_version(&setup.raw, 1); // stale
    insert_stale_indicator(&setup.raw, "ghost"); // bogus row from old algo

    // Trigger version check (call signature: any activity ID, doesn't matter)
    let _ = setup
        .engine
        .get_activity_indicators(&["any-activity".to_string()]);

    // Stale row must be cleared
    assert_eq!(
        count_indicators(&setup.raw),
        0,
        "recompute should have wiped stale indicators even with no sections"
    );
    // Version stamp must be updated
    assert_eq!(
        read_indicator_version(&setup.raw),
        CURRENT_VERSION,
        "indicator_version must be stamped to current after recompute"
    );
}

#[test]
fn version_match_skips_recompute() {
    let setup = setup();
    set_indicator_version(&setup.raw, CURRENT_VERSION); // up to date
    insert_stale_indicator(&setup.raw, "preserved");

    let _ = setup
        .engine
        .get_activity_indicators(&["any-activity".to_string()]);

    // Recompute did NOT fire — the row is preserved. Proves the guard works
    // both ways (no spurious recomputes when version matches).
    assert_eq!(
        count_indicators(&setup.raw),
        1,
        "version match must not trigger recompute"
    );
}

#[test]
fn fresh_install_stamps_version_on_first_call() {
    // No stored version (key missing) → unwrap_or(0) → 0 < CURRENT_VERSION → recompute.
    let setup = setup();
    let _ = setup
        .engine
        .get_activity_indicators(&["any-activity".to_string()]);
    assert_eq!(
        read_indicator_version(&setup.raw),
        CURRENT_VERSION,
        "fresh install must stamp current version on first read"
    );
}

#[test]
fn empty_activity_id_list_short_circuits() {
    let setup = setup();
    set_indicator_version(&setup.raw, 1);
    insert_stale_indicator(&setup.raw, "ghost");

    let result = setup.engine.get_activity_indicators(&[]);

    assert!(result.is_empty(), "empty input → empty output");
    // Important: short-circuit must fire BEFORE version check, so stale data
    // remains untouched until a real query comes in.
    assert_eq!(
        count_indicators(&setup.raw),
        1,
        "empty input must not trigger recompute"
    );
    assert_eq!(
        read_indicator_version(&setup.raw),
        1,
        "version stamp must be untouched when input is empty"
    );
}
