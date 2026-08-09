//! The in-memory section refresh must carry the junction table's
//! traversals, because `save_sections` writes junction rows FROM the
//! in-memory portions. A refresh that blanks them turns the next save
//! into a wipe of every traversal, lap, and PR the section holds.

#![cfg(feature = "synthetic")]

mod lifecycle_support;

use lifecycle_support::*;
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
}

/// An engine holding a detected catalogue with at least two auto sections.
fn detected_engine(dir: &TempDir) -> PersistentRouteEngine {
    let corpus = corpus();
    let path = dir.path().join("refresh.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .unwrap();
    }
    let handle = engine.detect_sections_background(None);
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();
    engine
}

fn auto_ids(engine: &mut PersistentRouteEngine) -> Vec<String> {
    engine
        .get_sections_by_type(None)
        .into_iter()
        .filter(|s| !s.is_user_defined)
        .map(|s| s.id)
        .collect()
}

fn junction_rows(engine: &mut PersistentRouteEngine, section_id: &str) -> usize {
    engine
        .get_section_by_id(section_id)
        .map(|s| s.activity_portions.len())
        .unwrap_or(0)
}

#[test]
fn a_recalculate_after_an_exclude_keeps_every_traversal() {
    let dir = TempDir::new().unwrap();
    let mut engine = detected_engine(&dir);
    let ids = auto_ids(&mut engine);
    assert!(ids.len() >= 2, "need two auto sections, got {}", ids.len());
    let (edited, recalced) = (&ids[0], &ids[1]);

    let member = engine
        .get_section_by_id(edited)
        .unwrap()
        .activity_ids
        .first()
        .cloned()
        .unwrap();
    let rows_before = junction_rows(&mut engine, edited);
    assert!(rows_before > 0);

    // The exclude refreshes `edited` in memory; recalculating a DIFFERENT
    // section then saves the whole catalogue from memory.
    engine
        .exclude_activity_from_section(edited, &member)
        .unwrap();
    engine.recalculate_section_polyline(recalced);

    let rows_after = junction_rows(&mut engine, edited);
    assert!(
        rows_after > 0,
        "the save after a refresh wiped {edited}'s traversals ({rows_before} rows -> 0)"
    );
}

#[test]
fn a_reset_reference_does_not_wedge_the_next_save() {
    let dir = TempDir::new().unwrap();
    let mut engine = detected_engine(&dir);
    let ids = auto_ids(&mut engine);
    assert!(ids.len() >= 2);
    let (reset, recalced) = (&ids[0], &ids[1]);

    let _ = recalced;
    // Trim promotes and backs up the original polyline; reset-reference
    // demotes back to auto. The catalogue save wipes only auto rows with
    // no backup, then re-inserts every auto section from memory — a
    // demoted row still carrying its backup is spared by the wipe AND
    // re-inserted, so the whole save aborts on the UNIQUE collision.
    // The invariant: a demoted section carries no backup.
    let len = engine.get_section_by_id(reset).unwrap().polyline.len() as u32;
    engine.trim_section(reset, 1, len - 2).unwrap();
    engine.reset_section_reference(reset).unwrap();

    let db = rusqlite::Connection::open(dir.path().join("refresh.db")).unwrap();
    let (user_defined, has_backup): (i64, bool) = db
        .query_row(
            "SELECT is_user_defined, original_polyline_json IS NOT NULL FROM sections WHERE id = ?",
            [reset],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(user_defined, 0);
    assert!(
        !has_backup,
        "demoted section still carries its polyline backup — the next catalogue save collides on it"
    );
}

#[test]
fn a_rematch_of_an_attached_activity_does_not_stack_rows() {
    let dir = TempDir::new().unwrap();
    let mut engine = detected_engine(&dir);
    let ids = auto_ids(&mut engine);
    let sid = &ids[0];
    let member = engine
        .get_section_by_id(sid)
        .unwrap()
        .activity_ids
        .first()
        .cloned()
        .unwrap();
    // Shift the stored row off the span the matcher would cut, so a
    // rematch that inserts instead of recognising the pair cannot hide
    // behind an index coincidence.
    let db = rusqlite::Connection::open(dir.path().join("refresh.db")).unwrap();
    db.execute(
        "UPDATE section_activities SET start_index = start_index + 7
         WHERE section_id = ?1 AND activity_id = ?2",
        rusqlite::params![sid, member],
    )
    .unwrap();
    engine.invalidate_section_cache(sid);
    engine.refresh_section_in_memory(sid);
    let pair_rows = |db: &rusqlite::Connection| -> i64 {
        db.query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = ?1 AND activity_id = ?2",
            rusqlite::params![sid, member],
            |r| r.get(0),
        )
        .unwrap()
    };
    let rows_before = pair_rows(&db);
    assert!(rows_before > 0);

    let matched = engine.rematch_activity_to_section(&member, sid).unwrap();

    assert!(matched, "an already-attached pair reports matched");
    assert_eq!(
        pair_rows(&db),
        rows_before,
        "rematching an attached activity stacked a duplicate junction row"
    );
}
