//! A section whose portions all belong to activities the pool no longer
//! holds gets zero junction rows, so no `visit_count` trigger fires and the
//! catalogue gains a "0 visits" card over an empty detail screen. The apply
//! must drop such a section instead of persisting it.
//!
//! Run: `cargo test --test section_zero_visit_guard -p veloqrs --features synthetic`

#![cfg(feature = "synthetic")]

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

fn engine_with_sections() -> (PersistentEngine, TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("sb6.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");

    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);
    for activity in corpus.through_b() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("initial apply");

    (engine, dir, path)
}

/// Every persisted auto section owns at least one junction row and a truthful
/// visit count.
fn assert_no_visitless_rows(db: &Connection, after: &str) {
    let mut stmt = db
        .prepare(
            "SELECT s.id, s.visit_count,
                    (SELECT COUNT(*) FROM section_activities sa WHERE sa.section_id = s.id)
             FROM sections s WHERE s.section_type = 'auto'",
        )
        .expect("prepare");
    let rows: Vec<(String, i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("query")
        .filter_map(|r| r.ok())
        .collect();
    assert!(
        !rows.is_empty(),
        "no auto sections persisted after {}",
        after
    );
    for (id, visits, junction) in rows {
        assert!(
            junction > 0,
            "section {} persisted with 0 junction rows after {}",
            id,
            after
        );
        assert_eq!(
            visits, junction,
            "section {} visit_count disagrees with its junction rows after {}",
            id, after
        );
    }
}

#[test]
fn a_section_whose_members_left_the_pool_is_not_persisted() {
    let (mut engine, _tmp, path) = engine_with_sections();
    let db = Connection::open(&path).expect("raw open");
    assert_no_visitless_rows(&db, "the initial detect");

    let before = engine.get_sections().len();

    // The payload: a frozen carry whose every member has left the pool.
    let mut broken: Vec<_> = engine.get_sections().to_vec();
    let victim = broken[0].id.clone();
    for portion in &mut broken[0].activity_portions {
        portion.activity_id = "ghost-activity".to_string();
    }
    engine.apply_sections(broken).expect("apply");

    assert_no_visitless_rows(&db, "an apply with an unpooled section");
    let survivors = engine.get_sections().len();
    assert!(
        survivors <= before,
        "the unpooled section {} should be dropped, not added",
        victim
    );
}
