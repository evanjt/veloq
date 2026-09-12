//! Integration tests for activity indicators version-based invalidation.
//!
//! The stale-version recompute is a launch-time pass, not a read-time one. It
//! rewrites every row in `activity_indicators` under the write lock, and the
//! version cannot change while the process runs, so a read has nothing to
//! check. Doing it on the read put a library-wide write inside the feed's
//! render memo.
//!
//! The guarantee is unchanged either way: nothing ever reads indicators
//! computed by a superseded algorithm. Only the moment moved.
//!
//! Run: `cargo test --test indicators -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const CURRENT_VERSION: i32 = 5;

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    path: PathBuf,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();
    let engine = PersistentEngine::new(&path_str).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        path,
        _tmp: tmp,
    }
}

/// Open a second engine on the same file, the way a relaunch would.
fn reopen(s: &Setup) -> PersistentEngine {
    PersistentEngine::new(s.path.to_str().unwrap()).expect("engine reopen")
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
// The version check belongs to the open, not to the read
// ============================================================================

#[test]
fn a_stale_version_is_recomputed_when_the_engine_opens() {
    let setup = setup();
    set_indicator_version(&setup.raw, 1);
    insert_stale_indicator(&setup.raw, "ghost");

    let _second = reopen(&setup);

    // No read has happened yet. The open alone must have cleared the rows the
    // superseded algorithm wrote and stamped the version it wrote them under.
    assert_eq!(
        count_indicators(&setup.raw),
        0,
        "the open must wipe indicators left by a superseded algorithm"
    );
    assert_eq!(
        read_indicator_version(&setup.raw),
        CURRENT_VERSION,
        "the open must stamp the current version"
    );
}

#[test]
fn a_stale_version_recomputes_with_no_sections_present() {
    // The old guard gated the recompute on `!self.sections.is_empty()`, which
    // left a library with no sections on stale indicators forever.
    let setup = setup();
    set_indicator_version(&setup.raw, 1);
    insert_stale_indicator(&setup.raw, "ghost");

    let _second = reopen(&setup);

    assert_eq!(count_indicators(&setup.raw), 0);
    assert_eq!(read_indicator_version(&setup.raw), CURRENT_VERSION);
}

#[test]
fn a_read_never_recomputes_however_stale_the_version_reads() {
    let setup = setup();
    // Written behind the open engine's back, which is the only way the version
    // can be stale while a process is running.
    set_indicator_version(&setup.raw, 1);
    insert_stale_indicator(&setup.raw, "preserved");

    let _ = setup
        .engine
        .get_activity_indicators(&["any-activity".to_string()]);

    assert_eq!(
        count_indicators(&setup.raw),
        1,
        "a read must not rewrite the table, whatever the version says"
    );
    assert_eq!(
        read_indicator_version(&setup.raw),
        1,
        "a read must not stamp the version either"
    );
}

#[test]
fn a_matching_version_leaves_the_table_alone_on_open() {
    let setup = setup();
    set_indicator_version(&setup.raw, CURRENT_VERSION);
    insert_stale_indicator(&setup.raw, "preserved");

    let _second = reopen(&setup);

    assert_eq!(
        count_indicators(&setup.raw),
        1,
        "an up-to-date version must not trigger a recompute"
    );
}

#[test]
fn a_fresh_install_stamps_the_version_on_the_first_open() {
    // No stored version reads as 0, which is behind the current one.
    let setup = setup();
    assert_eq!(
        read_indicator_version(&setup.raw),
        CURRENT_VERSION,
        "the first open of a new database must stamp the current version"
    );
}

#[test]
fn an_empty_activity_id_list_returns_empty() {
    let setup = setup();
    insert_stale_indicator(&setup.raw, "ghost");

    let result = setup.engine.get_activity_indicators(&[]);

    assert!(result.is_empty(), "empty input, empty output");
    assert_eq!(count_indicators(&setup.raw), 1, "and nothing written");
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

    // The rows above went in behind the engine, so ask for the pass rather
    // than leaning on a stale stamp to fire it from a read.
    s.engine.recompute_activity_indicators().expect("recompute");
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
    s.engine.recompute_activity_indicators().expect("recompute");

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
    s.engine.recompute_activity_indicators().expect("recompute");

    let _ = s.engine.get_activity_indicators(&["act_only".to_string()]);

    assert!(
        indicator_rows(&s.raw, "act_only").is_empty(),
        "a single session is not a trend, however many laps it holds"
    );
}

// ============================================================================
// A personal record is beaten, not matched
// ============================================================================

/// Expected behaviour: two outings at the same time leave neither of them a
/// record. Equalling the best is not beating it.
#[test]
fn matching_the_best_time_earns_no_pr_row() {
    let s = setup();
    insert_oval(&s.raw);
    insert_dated_activity(&s.raw, "act_first", 1_700_000_000);
    insert_dated_activity(&s.raw, "act_tie", 1_700_500_000);
    insert_timed_pass(&s.raw, "act_first", 0, 100.0);
    insert_timed_pass(&s.raw, "act_tie", 0, 100.0);
    s.engine.recompute_activity_indicators().expect("recompute");

    let _ = s
        .engine
        .get_activity_indicators(&["act_first".to_string(), "act_tie".to_string()]);

    for id in ["act_first", "act_tie"] {
        assert!(
            !indicator_rows(&s.raw, id)
                .iter()
                .any(|(kind, _)| kind == "section_pr"),
            "{id} matched the best time and must carry no PR row"
        );
    }
}

/// Expected behaviour: a hundredth of a second is inside the noise the
/// tolerance exists to absorb, so it is not a beat. A whole second is.
#[test]
fn a_beat_has_to_clear_the_noise_the_tolerance_absorbs() {
    for (lap, expect_pr) in [(99.995_f64, false), (99.0_f64, true)] {
        let s = setup();
        insert_oval(&s.raw);
        insert_dated_activity(&s.raw, "act_first", 1_700_000_000);
        insert_dated_activity(&s.raw, "act_now", 1_700_500_000);
        insert_timed_pass(&s.raw, "act_first", 0, 100.0);
        insert_timed_pass(&s.raw, "act_now", 0, lap);
        s.engine.recompute_activity_indicators().expect("recompute");

        let _ = s.engine.get_activity_indicators(&["act_now".to_string()]);

        let has_pr = indicator_rows(&s.raw, "act_now")
            .iter()
            .any(|(kind, _)| kind == "section_pr");
        assert_eq!(has_pr, expect_pr, "{lap} against a best of 100.0");
    }
}

/// Expected behaviour: an outing that was beaten later is no longer the best,
/// so it holds no record however far it beat what came before it.
#[test]
fn an_outing_that_was_later_beaten_holds_no_record() {
    let s = setup();
    insert_oval(&s.raw);
    insert_dated_activity(&s.raw, "act_slow", 1_700_000_000);
    insert_dated_activity(&s.raw, "act_middle", 1_700_500_000);
    insert_dated_activity(&s.raw, "act_fast", 1_701_000_000);
    insert_timed_pass(&s.raw, "act_slow", 0, 120.0);
    insert_timed_pass(&s.raw, "act_middle", 0, 100.0);
    insert_timed_pass(&s.raw, "act_fast", 0, 90.0);
    s.engine.recompute_activity_indicators().expect("recompute");

    let ids: Vec<String> = ["act_slow", "act_middle", "act_fast"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let _ = s.engine.get_activity_indicators(&ids);

    let pr_holders: Vec<&str> = ["act_slow", "act_middle", "act_fast"]
        .into_iter()
        .filter(|id| {
            indicator_rows(&s.raw, id)
                .iter()
                .any(|(kind, _)| kind == "section_pr")
        })
        .collect();
    assert_eq!(pr_holders, vec!["act_fast"]);
}

// ============================================================================
// An edit that moves a section's line must move its badges with it
// ============================================================================

/// A section with a real polyline, so the bounds editors have something to cut.
fn insert_drawn_section(db: &Connection, points: usize) {
    let polyline: Vec<String> = (0..points)
        .map(|i| {
            format!(
                "{{\"latitude\":46.0,\"longitude\":{:.5}}}",
                7.0 + i as f64 * 0.001
            )
        })
        .collect();
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version)
         VALUES ('sec_oval', 'auto', 'Oval', 'Run', ?1, 400.0, 0, 1)",
        params![format!("[{}]", polyline.join(","))],
    )
    .expect("insert drawn section");
}

/// One timed pass spanning `distance` of the section, so the completeness rule
/// the PR query applies can be satisfied on a line of any length.
fn insert_pass_of_length(
    db: &Connection,
    activity_id: &str,
    start_index: i64,
    lap_time: f64,
    distance: f64,
) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, excluded)
         VALUES ('sec_oval', ?1, 'same', ?2, ?3, ?4, ?5, 0)",
        params![
            activity_id,
            start_index,
            start_index + 40,
            distance,
            lap_time
        ],
    )
    .expect("insert pass");
}

/// A section whose badges are earned, then a trim that leaves it no traversals
/// at all, since nothing in this database has a track to re-match against.
#[test]
fn a_trim_clears_the_badges_the_old_line_earned() {
    let mut s = setup();
    insert_drawn_section(&s.raw, 30);
    insert_dated_activity(&s.raw, "act_first", 1_700_000_000);
    insert_dated_activity(&s.raw, "act_second", 1_700_500_000);
    insert_timed_pass(&s.raw, "act_first", 0, 100.0);
    insert_timed_pass(&s.raw, "act_second", 0, 90.0);
    s.engine.recompute_activity_indicators().expect("recompute");
    assert!(
        count_indicators(&s.raw) > 0,
        "the two passes must earn badges before the trim"
    );

    s.engine.trim_section("sec_oval", 5, 24).expect("trim");

    assert_eq!(
        count_indicators(&s.raw),
        0,
        "a trim re-matches the section, so a badge earned on the old line is not the section's any more"
    );
}

#[test]
fn a_bounds_reset_clears_the_badges_the_trimmed_line_earned() {
    let mut s = setup();
    insert_drawn_section(&s.raw, 30);
    s.engine.trim_section("sec_oval", 5, 24).expect("trim");

    // The trim rewrote the section's length, and a traversal has to span
    // enough of it to count, so the passes are measured against what it is now.
    let trimmed_distance: f64 = s
        .raw
        .query_row(
            "SELECT distance_meters FROM sections WHERE id = 'sec_oval'",
            [],
            |r| r.get(0),
        )
        .expect("trimmed distance");
    insert_dated_activity(&s.raw, "act_first", 1_700_000_000);
    insert_dated_activity(&s.raw, "act_second", 1_700_500_000);
    insert_pass_of_length(&s.raw, "act_first", 0, 100.0, trimmed_distance);
    insert_pass_of_length(&s.raw, "act_second", 0, 90.0, trimmed_distance);
    s.engine.recompute_activity_indicators().expect("recompute");
    assert!(
        count_indicators(&s.raw) > 0,
        "the two passes must earn badges on the trimmed line"
    );

    s.engine.reset_section_bounds("sec_oval").expect("reset");

    assert_eq!(
        count_indicators(&s.raw),
        0,
        "a reset re-matches against the original line, so the trimmed line's badges are not the section's any more"
    );
}
