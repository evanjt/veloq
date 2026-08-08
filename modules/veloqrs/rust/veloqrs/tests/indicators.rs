//! Integration tests for activity indicators version-based invalidation.
//!
//! Verifies B-2 fix: recompute fires on any version mismatch, not only when
//! sections are present (the old guard left users with empty section tables
//! stuck on stale indicators forever).
//!
//! Run: `cargo test --test indicators -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

const CURRENT_VERSION: i32 = 5;

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
    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
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

// --- One badge per activity, earned by its fastest lap ---
//
// The junction carries a row per pass, so a lapped session offers many
// candidates for one indicator key.

fn insert_dated_activity(db: &Connection, id: &str, start_unix: i64) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                 start_date, name, distance_meters, duration_secs)
         VALUES (?1, 'Run', 46.0, 46.1, 7.0, 7.1, ?2, ?1, 1000.0, 300)",
        params![id, start_unix],
    )
    .expect("insert activity");
}

fn insert_oval(db: &Connection) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version)
         VALUES ('sec_oval', 'auto', 'Oval', 'Run', '[]', 400.0, 0, 1)",
        [],
    )
    .expect("insert section");
}

/// One timed pass over the oval, keyed apart by `start_index`.
fn insert_timed_pass(db: &Connection, activity_id: &str, start_index: i64, lap_time: f64) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, excluded)
         VALUES ('sec_oval', ?1, 'same', ?2, ?3, 400.0, ?4, 0)",
        params![activity_id, start_index, start_index + 40, lap_time],
    )
    .expect("insert pass");
}

fn indicator_rows(db: &Connection, activity_id: &str) -> Vec<(String, f64)> {
    let mut stmt = db
        .prepare(
            "SELECT indicator_type, lap_time FROM activity_indicators
             WHERE activity_id = ?1 AND target_id = 'sec_oval'
             ORDER BY indicator_type",
        )
        .expect("prepare");
    stmt.query_map(params![activity_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .expect("query")
        .filter_map(|r| r.ok())
        .collect()
}

/// A first outing, then a lapped session straddling it. The fastest lap is
/// deliberately not the last row inserted.
fn setup_interval_session() -> Setup {
    let s = setup();
    insert_oval(&s.raw);
    insert_dated_activity(&s.raw, "act_first", 1_700_000_000);
    insert_dated_activity(&s.raw, "act_intervals", 1_700_500_000);

    insert_timed_pass(&s.raw, "act_first", 0, 100.0);
    insert_timed_pass(&s.raw, "act_intervals", 0, 110.0);
    insert_timed_pass(&s.raw, "act_intervals", 100, 90.0);
    insert_timed_pass(&s.raw, "act_intervals", 200, 105.0);

    set_indicator_version(&s.raw, 1);
    s
}

#[test]
fn an_interval_session_earns_one_row_per_indicator_not_one_per_lap() {
    let setup = setup_interval_session();

    let _ = setup
        .engine
        .get_activity_indicators(&["act_intervals".to_string()]);

    let rows = indicator_rows(&setup.raw, "act_intervals");
    let kinds: Vec<&str> = rows.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(
        kinds,
        vec!["section_pr", "section_trend"],
        "three laps must leave one PR row and one trend row, not a row per lap"
    );
}

#[test]
fn every_indicator_row_carries_the_fastest_lap_not_the_last_one() {
    // Laps run 110, 90, 105, so the slowest is written last and a per-pass
    // walk would leave 105 on the trend row.
    let setup = setup_interval_session();

    let _ = setup
        .engine
        .get_activity_indicators(&["act_intervals".to_string()]);

    for (kind, lap_time) in indicator_rows(&setup.raw, "act_intervals") {
        assert_eq!(
            lap_time, 90.0,
            "{kind} must carry the session's fastest lap, not lap 105"
        );
    }
}

#[test]
fn a_faded_session_is_not_judged_on_the_lap_it_faded_to() {
    // Every lap beats the earlier outing, but the session fades across them.
    // The trend must agree with the PR the same run awards.
    let s = setup();
    insert_oval(&s.raw);
    insert_dated_activity(&s.raw, "act_first", 1_700_000_000);
    insert_dated_activity(&s.raw, "act_faded", 1_700_500_000);
    insert_timed_pass(&s.raw, "act_first", 0, 100.0);
    insert_timed_pass(&s.raw, "act_faded", 0, 80.0);
    insert_timed_pass(&s.raw, "act_faded", 100, 97.0);
    set_indicator_version(&s.raw, 1);

    let _ = s.engine.get_activity_indicators(&["act_faded".to_string()]);

    let rows = indicator_rows(&s.raw, "act_faded");
    assert!(
        rows.iter().any(|(k, t)| k == "section_trend" && *t == 80.0),
        "the trend row must be earned by the best lap, got {rows:?}"
    );
}

#[test]
fn a_lone_interval_session_does_not_compare_against_its_own_laps() {
    // One activity, several laps, and nothing to compare against. Counting
    // rows rather than activities would treat those laps as a history and
    // manufacture a PR against itself.
    let s = setup();
    insert_oval(&s.raw);
    insert_dated_activity(&s.raw, "act_only", 1_700_000_000);
    insert_timed_pass(&s.raw, "act_only", 0, 110.0);
    insert_timed_pass(&s.raw, "act_only", 100, 90.0);
    insert_timed_pass(&s.raw, "act_only", 200, 105.0);
    set_indicator_version(&s.raw, 1);

    let _ = s.engine.get_activity_indicators(&["act_only".to_string()]);

    assert!(
        indicator_rows(&s.raw, "act_only").is_empty(),
        "a single session is not a trend, however many laps it holds"
    );
}
