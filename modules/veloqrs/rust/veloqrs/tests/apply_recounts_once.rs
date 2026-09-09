//! A detection apply recounts each section's summary once, not once per
//! junction row.
//!
//! `sections.visit_count`, `activity_count` and `sport_types` are kept by
//! triggers on `section_activities`. A recount on every inserted row makes the
//! catalogue save quadratic in a section's rows, all of it under the engine
//! write lock every screen read queues behind. The save suspends the insert
//! triggers and recounts the rows it wrote in one pass.
//!
//! Scenario: a corpus where every activity shares one corridor, so a handful
//! of sections carry thousands of junction rows between them.
//! Expected behaviour: the number of summary updates the apply makes is at
//! most the number of sections it saved, the columns still agree with the
//! junction table afterwards, and the suspension leaves no marker behind.

#![cfg(feature = "synthetic")]

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::synthetic::SyntheticScenario;
use veloqrs::PersistentEngine;

const PROBE_TABLE: &str = "probe_summary_updates";

fn build_engine(pool: usize) -> (PersistentEngine, Connection, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("recount.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    let dataset = SyntheticScenario::with_activity_count(pool, 20_000.0, 0.8).generate();
    let rows: Vec<(String, Vec<GpsPoint>, String)> = dataset
        .tracks
        .into_iter()
        .map(|(id, points)| {
            let sport = dataset
                .sport_types
                .get(&id)
                .cloned()
                .unwrap_or_else(|| "Ride".to_string());
            (id, points, sport)
        })
        .collect();
    for chunk in rows.chunks(100) {
        engine
            .add_activities_batch(chunk.to_vec())
            .expect("ingest batch");
    }
    let raw = Connection::open(&path).expect("raw open");
    // A trigger created here lives in the shared schema, so the engine's own
    // connection fires it: one probe row per summary update the apply makes.
    raw.execute_batch(&format!(
        "CREATE TABLE {PROBE_TABLE} (section_id TEXT NOT NULL);
         CREATE TRIGGER probe_summary_au AFTER UPDATE OF visit_count ON sections
         BEGIN INSERT INTO {PROBE_TABLE} VALUES (NEW.id); END;"
    ))
    .expect("install probe");
    (engine, raw, dir)
}

fn probe_count(raw: &Connection) -> i64 {
    raw.query_row(&format!("SELECT COUNT(*) FROM {PROBE_TABLE}"), [], |r| {
        r.get(0)
    })
    .expect("probe count")
}

fn reset_probe(raw: &Connection) {
    raw.execute(&format!("DELETE FROM {PROBE_TABLE}"), [])
        .expect("reset probe");
}

fn junction_rows(raw: &Connection) -> i64 {
    raw.query_row("SELECT COUNT(*) FROM section_activities", [], |r| r.get(0))
        .expect("junction count")
}

fn auto_sections(raw: &Connection) -> i64 {
    raw.query_row(
        "SELECT COUNT(*) FROM sections WHERE section_type = 'auto'",
        [],
        |r| r.get(0),
    )
    .expect("section count")
}

fn bulk_marker_present(raw: &Connection) -> bool {
    raw.query_row(
        "SELECT COUNT(*) FROM schema_info WHERE key LIKE '%bulk%'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .expect("marker probe")
        > 0
}

/// Every section's three summary columns equal what its own junction rows say.
fn assert_summaries_true(raw: &Connection, after: &str) {
    let mut stmt = raw
        .prepare(
            "SELECT s.id, s.visit_count, s.activity_count, s.sport_types,
                    (SELECT COUNT(*) FROM section_activities sa
                     WHERE sa.section_id = s.id AND sa.excluded = 0),
                    (SELECT COUNT(DISTINCT activity_id) FROM section_activities sa
                     WHERE sa.section_id = s.id AND sa.excluded = 0),
                    (SELECT GROUP_CONCAT(DISTINCT a.sport_type) FROM section_activities sa
                     JOIN activities a ON a.id = sa.activity_id
                     WHERE sa.section_id = s.id AND sa.excluded = 0)
             FROM sections s",
        )
        .expect("prepare parity");
    let rows: Vec<(String, i64, i64, Option<String>, i64, i64, Option<String>)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })
        .expect("query parity")
        .filter_map(|r| r.ok())
        .collect();
    assert!(!rows.is_empty(), "no sections to check {after}");
    for (id, visits, activities, sports, live_visits, live_activities, live_sports) in rows {
        assert_eq!(visits, live_visits, "visit_count stale on {id} {after}");
        assert_eq!(
            activities, live_activities,
            "activity_count stale on {id} {after}"
        );
        let mut stored: Vec<&str> = sports.as_deref().unwrap_or("").split(',').collect();
        let mut live: Vec<&str> = live_sports.as_deref().unwrap_or("").split(',').collect();
        stored.sort_unstable();
        live.sort_unstable();
        assert_eq!(stored, live, "sport_types stale on {id} {after}");
    }
}

fn detect_and_apply(engine: &mut PersistentEngine) {
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    assert!(!sections.is_empty(), "the corpus produced no sections");
    engine.apply_sections(sections).expect("apply");
}

#[test]
fn detection_apply_recounts_each_section_once() {
    let (mut engine, raw, _dir) = build_engine(120);

    detect_and_apply(&mut engine);
    let sections = auto_sections(&raw);
    let rows = junction_rows(&raw);
    assert!(
        rows > sections * 4,
        "corpus too thin to tell a per-row recount from a per-section one: {rows} rows over {sections} sections"
    );
    let updates = probe_count(&raw);
    assert!(
        updates <= sections,
        "first apply recounted {updates} times for {sections} sections over {rows} junction rows"
    );
    assert_summaries_true(&raw, "after the first apply");
    assert!(
        !bulk_marker_present(&raw),
        "bulk marker left behind after the first apply"
    );

    // A re-detect over the same pool wipes and rewrites the same catalogue.
    reset_probe(&raw);
    detect_and_apply(&mut engine);
    let sections = auto_sections(&raw);
    let updates = probe_count(&raw);
    assert!(
        updates <= sections,
        "second apply recounted {updates} times for {sections} sections"
    );
    assert_summaries_true(&raw, "after the second apply");
    assert!(
        !bulk_marker_present(&raw),
        "bulk marker left behind after the second apply"
    );
}

#[test]
fn single_row_writes_still_recount_through_the_triggers() {
    let (mut engine, raw, _dir) = build_engine(60);
    detect_and_apply(&mut engine);
    reset_probe(&raw);

    // Outside a bulk save the triggers must keep working row by row: an
    // exclusion flip on a live junction row recounts its section at once.
    let (section_id, activity_id): (String, String) = raw
        .query_row(
            "SELECT section_id, activity_id FROM section_activities LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("one junction row");
    raw.execute(
        "UPDATE section_activities SET excluded = 1 WHERE section_id = ?1 AND activity_id = ?2",
        rusqlite::params![section_id, activity_id],
    )
    .expect("flip exclusion");
    assert!(probe_count(&raw) >= 1, "exclusion flip did not recount");
    assert_summaries_true(&raw, "after an exclusion flip");

    reset_probe(&raw);
    raw.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, excluded)
         VALUES (?1, ?2, 'same', 999999, 999999, 1.0, 0)",
        rusqlite::params![section_id, activity_id],
    )
    .expect("insert one row");
    assert!(probe_count(&raw) >= 1, "single-row insert did not recount");
    assert_summaries_true(&raw, "after a single-row insert");
}
