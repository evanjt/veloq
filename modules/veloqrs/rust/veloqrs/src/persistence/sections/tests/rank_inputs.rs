//! Scenario: the insights cards rank every section by relevance, and the rank
//! reads each section's history. The history is kept as stored inputs per
//! section, refreshed as a write commits and recomputed by the read for any
//! section a write has changed since.
//!
//! Expected behaviour: the stored path ranks exactly as scoring every
//! traversal does, through every kind of change to a traversal, and the steps
//! a read takes stay level as the history of each section grows.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use tracematch::GpsPoint;

use super::pooled::{
    page_trends, ranked_sections_by_sports, refresh_rank_inputs, score_traversals,
    traversals_by_sport,
};
use crate::PersistentEngine;

static STEPS: AtomicUsize = AtomicUsize::new(0);

fn count_step() -> bool {
    STEPS.fetch_add(1, Ordering::SeqCst);
    false
}

const DAY: i64 = 86_400;
const NOW: i64 = 1_757_000_000;

fn track() -> Vec<GpsPoint> {
    (0..3)
        .map(|i| GpsPoint {
            latitude: 46.0 + i as f64 * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

/// `sections` sections each ridden `per_section` times, one lap a day, with
/// lap times that wander so improvement and anomaly are not all zero.
fn library(sections: usize, per_section: usize) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    seed(&mut engine, sections, per_section);
    engine
}

/// The same library in a file, so a second connection can commit beside it.
fn library_on_disk(
    path: &std::path::Path,
    sections: usize,
    per_section: usize,
) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    seed(&mut engine, sections, per_section);
    engine
}

fn seed(engine: &mut PersistentEngine, sections: usize, per_section: usize) {
    for s in 0..sections {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, disabled, version)
                 VALUES (?1, 'auto', ?2, 'Ride', '[]', 800.0, 0, 1)",
                rusqlite::params![format!("s{s}"), format!("Section {s}")],
            )
            .expect("section");
        for i in 0..per_section {
            let id = format!("a{s}_{i}");
            engine
                .add_activity(id.clone(), track(), "Ride".into())
                .expect("activity");
            engine
                .db
                .execute(
                    "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                         elapsed_time, elevation_gain, sport_type)
                     VALUES (?1, ?1, ?2, 800.0, 200, 200, 0, 'Ride')",
                    rusqlite::params![
                        id,
                        NOW - ((per_section - i) as i64) * DAY * (1 + s as i64 % 3)
                    ],
                )
                .expect("metrics");
            let lap = 200.0 + ((i * 37 + s * 11) % 29) as f64;
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                         start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                     VALUES (?1, ?2, ?3, 0, 2, 800.0, ?4, ?5, 0)",
                    rusqlite::params![
                        format!("s{s}"),
                        id,
                        if i % 7 == 6 { "reverse" } else { "same" },
                        lap,
                        800.0 / lap
                    ],
                )
                .expect("traversal");
        }
    }
}

fn sports() -> Vec<String> {
    vec!["Ride".to_string()]
}

fn stored(engine: &PersistentEngine, limit: u32) -> String {
    let ranked = ranked_sections_by_sports(&engine.db, &sports(), limit, &BTreeMap::new());
    format!("{:?}", ranked[0].sections)
}

/// Every traversal scored, the way the read worked before the inputs were kept.
fn scanned(engine: &PersistentEngine, limit: u32) -> String {
    let rows = traversals_by_sport(&engine.db)
        .remove("Ride")
        .unwrap_or_default();
    format!("{:?}", score_traversals(rows, limit, &BTreeMap::new()))
}

fn dirty(engine: &PersistentEngine) -> i64 {
    engine
        .db
        .query_row(
            "SELECT (SELECT COUNT(*) FROM section_rank_dirty)
                  + (SELECT COUNT(*) FROM section_rank_dirty_activity)",
            [],
            |r| r.get(0),
        )
        .unwrap()
}

fn assert_exact(engine: &PersistentEngine, why: &str) {
    for limit in [3, 100] {
        assert_eq!(
            stored(engine, limit),
            scanned(engine, limit),
            "{why}, limit {limit}"
        );
    }
}

#[test]
fn test_page_trends_match_insights_ranker_and_omit_ineligible_sections() {
    let engine = library(4, 9);
    let shift = chrono::Utc::now().timestamp() - NOW;
    engine
        .db
        .execute("UPDATE activity_metrics SET date = date + ?1", [shift])
        .unwrap();
    for index in 0..9 {
        engine.db.execute(
            "UPDATE section_activities SET lap_time = ?1 WHERE section_id = 's0' AND activity_id = ?2",
            rusqlite::params![200.0 - 10.0 * f64::from(index), format!("a0_{index}")],
        ).unwrap();
        engine.db.execute(
            "UPDATE section_activities SET lap_time = ?1 WHERE section_id = 's1' AND activity_id = ?2",
            rusqlite::params![200.0 + 10.0 * f64::from(index), format!("a1_{index}")],
        ).unwrap();
    }
    engine
        .db
        .execute(
            "UPDATE activity_metrics SET date = date - 40 * 86400 WHERE activity_id LIKE 'a2_%'",
            [],
        )
        .unwrap();
    engine.db.execute("DELETE FROM section_activities WHERE section_id = 's3' AND activity_id IN ('a3_0', 'a3_1', 'a3_2', 'a3_3')", []).unwrap();
    let verdicts = page_trends(&engine.db, &["s0", "s1", "s2", "s3"], Some("Ride"));
    let ranked = ranked_sections_by_sports(&engine.db, &sports(), 100, &BTreeMap::new());
    for section in &ranked[0].sections {
        let expected = super::eligible_trend(
            section.trend,
            section.days_since_last,
            super::SECTION_TREND_MAX_AGE_DAYS,
        );
        assert_eq!(verdicts.get(&section.section_id).copied(), expected);
    }
    assert_eq!(verdicts.get("s0"), Some(&1));
    assert_eq!(verdicts.get("s1"), Some(&-1));
    assert!(!verdicts.contains_key("s2"));
    assert!(!verdicts.contains_key("s3"));
}

#[test]
fn a_section_nothing_has_refreshed_ranks_as_the_scan_does() {
    let engine = library(6, 9);
    assert!(dirty(&engine) > 0);
    assert_exact(&engine, "before any refresh");
}

#[test]
fn a_refresh_clears_the_marks_and_ranks_as_the_scan_does() {
    let engine = library(6, 9);
    refresh_rank_inputs(&engine.db).unwrap();
    assert_eq!(dirty(&engine), 0);
    assert_exact(&engine, "after the refresh");
}

#[test]
fn every_change_to_a_traversal_is_ranked_exactly_before_and_after_its_refresh() {
    let engine = library(6, 9);
    refresh_rank_inputs(&engine.db).unwrap();
    let changes = [
        "UPDATE section_activities SET lap_time = 150.0 WHERE section_id = 's1' AND activity_id = 'a1_8'",
        "UPDATE section_activities SET excluded = 1 WHERE section_id = 's2' AND activity_id = 'a2_8'",
        "UPDATE section_activities SET direction = 'reverse' WHERE section_id = 's3' AND activity_id = 'a3_8'",
        "UPDATE section_activities SET lap_time = NULL WHERE section_id = 's4' AND activity_id = 'a4_0'",
        "UPDATE activity_metrics SET date = date + 400 * 86400 WHERE activity_id = 'a5_3'",
        "DELETE FROM section_activities WHERE section_id = 's0' AND activity_id = 'a0_8'",
        "DELETE FROM activities WHERE id = 'a1_7'",
        "UPDATE sections SET disabled = 1 WHERE id = 's2'",
        "UPDATE sections SET distance_meters = 100000.0 WHERE id = 's3'",
        "UPDATE sections SET superseded_by = 's0' WHERE id = 's4'",
        "UPDATE section_activities SET section_id = 's0' WHERE section_id = 's5' AND activity_id = 'a5_8'",
        "UPDATE activity_metrics SET sport_type = 'Run' WHERE activity_id = 'a0_2'",
    ];
    for change in changes {
        engine.db.execute(change, []).expect(change);
        assert!(dirty(&engine) > 0, "{change} marked nothing");
        assert_exact(&engine, &format!("after `{change}`, before the refresh"));
        refresh_rank_inputs(&engine.db).unwrap();
        assert_eq!(dirty(&engine), 0);
        assert_exact(&engine, &format!("after `{change}`, refreshed"));
        assert_eq!(
            unstored(&engine),
            0,
            "after `{change}`, a ranked pair has no row"
        );
    }
}

/// Sections with a complete traversal in a sport that hold no stored row for
/// that sport.
fn unstored(engine: &PersistentEngine) -> i64 {
    engine
        .db
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM (
                     SELECT DISTINCT s.id, am.sport_type
                     FROM sections s
                     JOIN section_activities sa ON s.id = sa.section_id
                     JOIN activity_metrics am ON sa.activity_id = am.activity_id
                     WHERE sa.excluded = 0 AND sa.lap_time IS NOT NULL
                       AND s.disabled = 0 AND s.superseded_by IS NULL{}) t
                 WHERE NOT EXISTS (SELECT 1 FROM section_rank_inputs i
                                   WHERE i.section_id = t.id AND i.sport_type = t.sport_type)",
                crate::persistence::records::complete_traversal_clause("sa", "s")
            ),
            [],
            |r| r.get(0),
        )
        .unwrap()
}

/// Rank through a read-only connection while another connection commits
/// `write` part-way through the read's first statement.
fn rank_across_a_commit(path: &std::path::Path, write: fn(&rusqlite::Connection)) -> Vec<String> {
    let reader = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .expect("reader");
    // The schema loads on the first prepare and runs the handler too, so it
    // is loaded before the handler counts.
    reader
        .query_row("SELECT COUNT(*) FROM sections", [], |r| r.get::<_, i64>(0))
        .expect("schema");
    let writer_path = path.to_path_buf();
    let mut write = Some(write);
    let mut calls = 0;
    reader.progress_handler(
        1,
        Some(move || {
            calls += 1;
            if calls == 20
                && let Some(write) = write.take()
            {
                let writer = rusqlite::Connection::open(&writer_path).expect("writer");
                write(&writer);
            }
            false
        }),
    );
    let ranked = ranked_sections_by_sports(&reader, &sports(), 100, &BTreeMap::new());
    reader.progress_handler(1, None::<fn() -> bool>);
    ranked[0]
        .sections
        .iter()
        .map(|r| r.section_id.clone())
        .collect()
}

#[test]
fn a_write_that_marks_a_section_mid_read_does_not_rank_it_twice() {
    let dir = tempfile::tempdir().expect("dir");
    let path = dir.path().join("rank.db");
    let engine = library_on_disk(&path, 6, 9);
    refresh_rank_inputs(&engine.db).unwrap();
    assert_eq!(dirty(&engine), 0);

    let mut ids = rank_across_a_commit(&path, |writer| {
        writer
            .execute(
                "UPDATE section_activities SET lap_time = 150.0
                 WHERE section_id = 's1' AND activity_id = 'a1_8'",
                [],
            )
            .expect("mark s1");
    });
    assert!(dirty(&engine) > 0, "the write did not land");
    ids.sort();
    assert_eq!(ids, ["s0", "s1", "s2", "s3", "s4", "s5"]);
}

#[test]
fn a_refresh_that_clears_a_mark_mid_read_does_not_drop_the_section() {
    let dir = tempfile::tempdir().expect("dir");
    let path = dir.path().join("rank.db");
    let engine = library_on_disk(&path, 6, 9);
    refresh_rank_inputs(&engine.db).unwrap();
    engine
        .db
        .execute(
            "UPDATE section_activities SET lap_time = 150.0
             WHERE section_id = 's1' AND activity_id = 'a1_8'",
            [],
        )
        .expect("mark s1");
    assert!(dirty(&engine) > 0);

    let mut ids = rank_across_a_commit(&path, |writer| {
        refresh_rank_inputs(writer).expect("refresh");
    });
    assert_eq!(dirty(&engine), 0, "the refresh did not land");
    ids.sort();
    assert_eq!(ids, ["s0", "s1", "s2", "s3", "s4", "s5"]);
}

#[test]
fn a_traversal_whose_metrics_arrive_later_is_ranked_once_they_do() {
    let engine = library(2, 5);
    engine
        .db
        .execute(
            "DELETE FROM activity_metrics WHERE activity_id = 'a0_4'",
            [],
        )
        .unwrap();
    refresh_rank_inputs(&engine.db).unwrap();
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                 elapsed_time, elevation_gain, sport_type)
             VALUES ('a0_4', 'late', ?1, 800.0, 200, 200, 0, 'Ride')",
            rusqlite::params![NOW],
        )
        .unwrap();
    assert_exact(&engine, "metrics inserted after the refresh");
}

#[test]
fn a_read_after_a_refresh_costs_what_it_keeps_not_what_the_library_holds() {
    let steps = |sections: usize| {
        let engine = library(sections, 12);
        refresh_rank_inputs(&engine.db).unwrap();
        STEPS.store(0, Ordering::SeqCst);
        engine.db.progress_handler(1, Some(count_step));
        std::hint::black_box(ranked_sections_by_sports(
            &engine.db,
            &sports(),
            4,
            &BTreeMap::new(),
        ));
        engine.db.progress_handler(1, None::<fn() -> bool>);
        STEPS.load(Ordering::SeqCst)
    };
    let (small, large) = (steps(8), steps(24));
    assert!(
        (large as f64) <= small as f64 * 1.25,
        "{large} steps for three times the sections against {small}"
    );
}

#[test]
fn a_replacing_write_to_an_already_marked_section_still_lands() {
    let engine = library(2, 4);
    for _ in 0..2 {
        engine
            .db
            .execute(
                "INSERT OR REPLACE INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, excluded)
                 VALUES ('s0', 'a0_0', 'same', 0, 2, 800.0, 190.0, 0)",
                [],
            )
            .expect("a replace on a marked section");
    }
    engine
        .db
        .execute("INSERT OR REPLACE INTO activity_metrics (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain, sport_type) VALUES ('a0_0', 'again', 5, 1.0, 1, 1, 0, 'Ride')", [])
        .expect("a replace on metrics");
    assert_exact(&engine, "after replacing writes");
}
