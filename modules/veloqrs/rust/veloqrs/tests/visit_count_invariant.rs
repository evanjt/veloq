//! The denormalised `sections.visit_count` column must agree with the junction
//! table after every mutation path, not just the ones the triggers can see.
//!
//! `get_section_summaries` reads the column instead of counting rows (B4 phase
//! 3), so a path that moves or removes junction rows without recomputing shows
//! the user a stale visit count until some unrelated write repairs it.
//!
//! Run: `cargo test --test visit_count_invariant -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

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

fn insert_activity(db: &Connection, id: &str, start_unix: i64) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                  start_date, name, distance_meters, duration_secs)
         VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, ?2, ?3, 1000.0, 300)",
        params![id, start_unix, format!("Activity {}", id)],
    )
    .expect("insert activity");
}

fn insert_section(db: &Connection, id: &str, sport: &str) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version,
                               bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES (?1, 'auto', ?1, ?2, '[]', 500.0, 0, 1,
                 46.0, 46.01, 7.0, 7.01)",
        params![id, sport],
    )
    .expect("insert section");
}

fn insert_traversal(db: &Connection, section_id: &str, activity_id: &str) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, excluded)
         VALUES (?1, ?2, 'same', 0, 0, 500.0, 0)",
        params![section_id, activity_id],
    )
    .expect("insert traversal");
}

/// Every surviving section's column equals its own live junction count.
fn assert_counts_true(db: &Connection, after: &str) {
    let mut stmt = db
        .prepare(
            "SELECT s.id, s.visit_count,
                    (SELECT COUNT(*) FROM section_activities sa
                     WHERE sa.section_id = s.id AND sa.excluded = 0)
             FROM sections s",
        )
        .expect("prepare invariant");
    let rows: Vec<(String, i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("query invariant")
        .filter_map(|r| r.ok())
        .collect();
    assert!(!rows.is_empty(), "no sections to check after {}", after);
    for (id, column, junction) in rows {
        assert_eq!(
            column, junction,
            "section {} visit_count {} != {} junction rows after {}",
            id, column, junction, after
        );
    }
}

fn orphan_junction_rows(db: &Connection) -> i64 {
    db.query_row(
        "SELECT COUNT(*) FROM section_activities sa
         WHERE NOT EXISTS (SELECT 1 FROM sections s WHERE s.id = sa.section_id)",
        [],
        |r| r.get(0),
    )
    .unwrap_or(-1)
}

#[test]
fn direct_junction_writes_keep_the_count_true() {
    let s = setup();
    insert_activity(&s.raw, "a1", 1_700_000_000);
    insert_activity(&s.raw, "a2", 1_700_086_400);
    insert_section(&s.raw, "sec", "Ride");

    insert_traversal(&s.raw, "sec", "a1");
    insert_traversal(&s.raw, "sec", "a2");
    assert_counts_true(&s.raw, "two inserts");

    s.raw
        .execute(
            "DELETE FROM section_activities WHERE section_id = 'sec' AND activity_id = 'a2'",
            [],
        )
        .expect("delete traversal");
    assert_counts_true(&s.raw, "a delete");
}

#[test]
fn excluding_and_reincluding_keeps_the_count_true() {
    let mut s = setup();
    insert_activity(&s.raw, "a1", 1_700_000_000);
    insert_activity(&s.raw, "a2", 1_700_086_400);
    insert_section(&s.raw, "sec", "Ride");
    insert_traversal(&s.raw, "sec", "a1");
    insert_traversal(&s.raw, "sec", "a2");

    s.engine
        .exclude_activity_from_section("sec", "a2")
        .expect("exclude");
    assert_counts_true(&s.raw, "an exclusion");

    s.engine
        .include_activity_in_section("sec", "a2")
        .expect("include");
    assert_counts_true(&s.raw, "a re-inclusion");
}

#[test]
fn merging_two_sections_keeps_the_count_true() {
    let mut s = setup();
    insert_activity(&s.raw, "a1", 1_700_000_000);
    insert_activity(&s.raw, "a2", 1_700_086_400);
    insert_activity(&s.raw, "a3", 1_700_172_800);
    insert_section(&s.raw, "primary", "Ride");
    insert_section(&s.raw, "donor", "Ride");
    insert_traversal(&s.raw, "primary", "a1");
    insert_traversal(&s.raw, "donor", "a2");
    insert_traversal(&s.raw, "donor", "a3");

    s.engine
        .merge_user_sections("primary", "donor")
        .expect("merge");

    assert_counts_true(&s.raw, "a user merge");
    assert_eq!(orphan_junction_rows(&s.raw), 0, "merge left orphan rows");
}

#[test]
fn cross_sport_merge_keeps_the_count_true() {
    let mut s = setup();
    insert_activity(&s.raw, "a1", 1_700_000_000);
    insert_activity(&s.raw, "a2", 1_700_086_400);
    insert_activity(&s.raw, "a3", 1_700_172_800);
    // Same corridor walked and ridden: identical bounds and distance, so the
    // cross-sport pass sees one section under two sports.
    insert_section(&s.raw, "ride", "Ride");
    insert_section(&s.raw, "run", "Run");
    insert_traversal(&s.raw, "ride", "a1");
    insert_traversal(&s.raw, "ride", "a2");
    insert_traversal(&s.raw, "run", "a3");

    s.engine
        .merge_cross_sport_sections()
        .expect("cross-sport merge");

    assert_counts_true(&s.raw, "a cross-sport merge");
    assert_eq!(
        orphan_junction_rows(&s.raw),
        0,
        "cross-sport merge left orphan rows"
    );
}

#[test]
fn removing_an_activity_keeps_the_count_true() {
    let mut s = setup();
    insert_activity(&s.raw, "a1", 1_700_000_000);
    insert_activity(&s.raw, "a2", 1_700_086_400);
    insert_section(&s.raw, "sec", "Ride");
    insert_traversal(&s.raw, "sec", "a1");
    insert_traversal(&s.raw, "sec", "a2");

    s.engine.remove_activity("a2").expect("remove activity");

    assert_counts_true(&s.raw, "an activity removal");
}

/// A database written by a build whose triggers missed row moves carries counts
/// a merge left stale. Opening it again repairs them.
#[test]
fn a_database_left_stale_by_an_older_build_repairs_on_open() {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();
    let raw = {
        let mut engine = PersistentRouteEngine::new(&path_str).expect("engine new");
        let raw = Connection::open(&path).expect("raw open");
        insert_activity(&raw, "a1", 1_700_000_000);
        insert_activity(&raw, "a2", 1_700_086_400);
        insert_section(&raw, "primary", "Ride");
        insert_section(&raw, "donor", "Ride");
        insert_traversal(&raw, "primary", "a1");
        insert_traversal(&raw, "donor", "a2");

        raw.execute("DROP TRIGGER section_activities_visit_count_amove", [])
            .expect("drop move trigger");
        engine
            .merge_user_sections("primary", "donor")
            .expect("merge");
        raw
    };
    let stale: i64 = raw
        .query_row(
            "SELECT visit_count FROM sections WHERE id = 'primary'",
            [],
            |r| r.get(0),
        )
        .expect("read stale count");
    assert_eq!(stale, 1, "the older build's merge must leave the count stale");

    let _engine = PersistentRouteEngine::new(&path_str).expect("reopen");
    assert_counts_true(&raw, "a reopen");
}

#[test]
fn deleting_a_section_leaves_no_orphan_rows() {
    let mut s = setup();
    insert_activity(&s.raw, "a1", 1_700_000_000);
    insert_section(&s.raw, "keep", "Ride");
    insert_section(&s.raw, "drop", "Ride");
    insert_traversal(&s.raw, "keep", "a1");
    insert_traversal(&s.raw, "drop", "a1");

    s.engine.delete_section("drop").expect("delete section");

    assert_counts_true(&s.raw, "a section delete");
    assert_eq!(orphan_junction_rows(&s.raw), 0, "cascade left orphan rows");
}

// ----------------------------------------------------------------------------
// visit_count and activity_count answer different questions and must not be
// aliased to each other. Both summary read paths used to report the SAME
// number: the persistence path sent traversals through both fields, the CRUD
// path sent distinct activities through both. A lapped section is the case
// that separates them, and neither path had a test with one.
// ----------------------------------------------------------------------------

/// One pass over `section_id`, distinguished by `start_index` because that is
/// what the junction primary key uses to tell laps apart.
fn insert_pass(db: &Connection, section_id: &str, activity_id: &str, start_index: i64) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, excluded)
         VALUES (?1, ?2, 'same', ?3, ?4, 500.0, 0)",
        params![section_id, activity_id, start_index, start_index + 50],
    )
    .expect("insert pass");
}

/// An interval session: one activity round the oval three times, plus a second
/// activity that passes once. Four traversals across two outings.
fn setup_lapped_oval() -> Setup {
    let s = setup();
    insert_activity(&s.raw, "act_intervals", 1_700_000_000);
    insert_activity(&s.raw, "act_single", 1_700_100_000);
    insert_section(&s.raw, "sec_oval", "Run");
    for (i, start) in [0, 100, 200].into_iter().enumerate() {
        let _ = i;
        insert_pass(&s.raw, "sec_oval", "act_intervals", start);
    }
    insert_pass(&s.raw, "sec_oval", "act_single", 0);
    s
}

#[test]
fn the_persistence_summary_path_separates_traversals_from_outings() {
    let mut s = setup_lapped_oval();
    s.engine.load().expect("load");

    let summary = s
        .engine
        .get_section_summaries()
        .into_iter()
        .find(|x| x.id == "sec_oval")
        .expect("oval summary present");

    assert_eq!(summary.visit_count, 4, "three laps plus one pass");
    assert_eq!(summary.activity_count, 2, "two outings");
}

#[test]
fn the_crud_summary_path_separates_traversals_from_outings() {
    let mut s = setup_lapped_oval();
    s.engine.load().expect("load");

    let summary = s
        .engine
        .get_all_section_summaries(None)
        .into_iter()
        .find(|x| x.id == "sec_oval")
        .expect("oval summary present");

    assert_eq!(summary.visit_count, 4, "three laps plus one pass");
    assert_eq!(summary.activity_count, 2, "two outings");
}

#[test]
fn both_summary_paths_agree_on_a_lapped_section() {
    let mut s = setup_lapped_oval();
    s.engine.load().expect("load");

    let from_persistence = s
        .engine
        .get_section_summaries()
        .into_iter()
        .find(|x| x.id == "sec_oval")
        .expect("persistence summary");
    let from_crud = s
        .engine
        .get_all_section_summaries(None)
        .into_iter()
        .find(|x| x.id == "sec_oval")
        .expect("crud summary");

    assert_eq!(
        (from_persistence.visit_count, from_persistence.activity_count),
        (from_crud.visit_count, from_crud.activity_count),
        "the two read paths must not disagree about the same section"
    );
}

#[test]
fn excluding_a_lap_drops_one_traversal_but_keeps_the_outing() {
    let mut s = setup_lapped_oval();
    s.engine.load().expect("load");

    s.raw
        .execute(
            "UPDATE section_activities SET excluded = 1
             WHERE section_id = 'sec_oval' AND activity_id = 'act_intervals' AND start_index = 100",
            [],
        )
        .expect("exclude one lap");

    let summary = s
        .engine
        .get_section_summaries()
        .into_iter()
        .find(|x| x.id == "sec_oval")
        .expect("oval summary present");

    assert_eq!(summary.visit_count, 3, "the excluded lap stops counting");
    assert_eq!(
        summary.activity_count, 2,
        "its activity still traverses the section on its other laps"
    );
}
