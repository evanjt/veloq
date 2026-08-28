//! The fixed-point contract: a detect over an unchanged activity set must
//! converge and then stop moving.
//!
//! Detection re-runs on every sync and feeds the previous catalogue back in as
//! the prior, so the pipeline is a map from catalogue to catalogue. Hysteresis
//! may legitimately move the visible view for a few rounds, but the map has to
//! reach a fixed point and stay on it. A cycle instead of a fixed point rewrites
//! the user's section list, their ids and their history timeline on every sync,
//! forever.
//!
//! What is pinned here that `detection_settles.rs` does not reach is the apply
//! observed at BOTH its boundaries: the catalogue the save commits, and the
//! catalogue the deferred tail leaves behind. A tail that edits the catalogue
//! the save just wrote is a period-2 oscillation even when every round looks
//! identical from outside, because the detector re-derives the pre-tail shape
//! from the ground on the next sync and the tail edits it again.
//!
//! Rounds run the production apply: the evidence cache advances with the save
//! and the processed activity ids are saved, so every round after the first
//! enters the no-new-activities short-circuit rather than a cold re-detect.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test detection_fixed_point`

#![cfg(feature = "synthetic")]

mod lifecycle_support;

use std::collections::BTreeSet;

use lifecycle_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

/// Rounds of detect over the unchanged pool.
const ROUNDS: usize = 12;

/// Rounds the visible view may still move in before it must hold. The dissolve
/// debounce is a few steps deep, so round one is not required to be final.
const SETTLE_BUDGET: usize = 6;

/// Rounds the save-versus-tail boundary is compared over.
const BOUNDARY_ROUNDS: usize = 6;

/// Rounds run before the names are read, so the catalogue has stopped moving.
const NAME_WARMUP_ROUNDS: usize = 6;

/// Rounds the minted names are held against after that warm-up.
const NAME_ROUNDS: usize = 4;

/// Enough overlapping traffic for several corridors in both sports, small
/// enough to detect a dozen times in a debug build.
fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 2,
        ..LifecycleConfig::default()
    })
}

/// An engine on the Unified arm holding the whole pool, undetected.
/// Unified is explicit: the shipped default is still Corridor, whose damped
/// view never settles.
fn loaded_engine(path: &std::path::Path, corpus: &LifecycleCorpus) -> PersistentRouteEngine {
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();
    engine.set_section_config(SectionConfig {
        ..SectionConfig::default()
    });
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .unwrap();
    }
    engine
}

/// Detect, then run the hot half of the production apply: the cache-aware save
/// followed by the processed-id save, in that order and under one lock.
fn detect_and_save(engine: &mut PersistentRouteEngine) {
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed_ids) = main.unwrap_or_default();
    engine
        .apply_sections_save_with_cache(sections, cache_update)
        .unwrap();
    engine.save_processed_activity_ids(&processed_ids).unwrap();
}

/// One detect+apply round, both halves.
fn redetect(engine: &mut PersistentRouteEngine) {
    detect_and_save(engine);
    engine.apply_sections_finalize();
}

/// One detect+apply round with the two apply halves split, as production runs
/// them across separate engine locks. Returns the catalogue the save committed
/// and the catalogue the deferred tail left behind.
fn redetect_split(engine: &mut PersistentRouteEngine) -> (String, String) {
    detect_and_save(engine);
    let saved = snapshot(engine).catalogue_signature();
    engine.apply_sections_finalize();
    (saved, snapshot(engine).catalogue_signature())
}

/// Index of the first round after which the sequence never changes again, or
/// `None` if it is still moving at the end. A cycle of any period returns
/// `None`: every entry in a cycle recurs after a different one, so no suffix of
/// the sequence is constant. A run of one at the tail is not evidence of a
/// fixed point either, so the constant suffix must be at least two long.
fn settle_round(signatures: &[String]) -> Option<usize> {
    let last = signatures.last()?;
    let first = signatures.iter().position(|s| s == last)?;
    let constant = signatures[first..].iter().all(|s| s == last);
    (constant && signatures.len() - first >= 2).then_some(first)
}

/// The sports the visible catalogue is carrying.
fn sports(engine: &mut PersistentRouteEngine) -> BTreeSet<String> {
    snapshot(engine)
        .sections
        .values()
        .map(|f| f.sport_type.clone())
        .collect()
}

/// Two auto sections to fuse, the busier one first.
fn fusable_pair(engine: &mut PersistentRouteEngine) -> Option<(String, String)> {
    let snap = snapshot(engine);
    let mut rows: Vec<(u32, String)> = snap
        .sections
        .iter()
        .filter(|(_, f)| !f.is_user_defined)
        .map(|(id, f)| (f.visit_count, id.clone()))
        .collect();
    rows.sort();
    rows.reverse();
    match rows.as_slice() {
        [(_, primary), (_, secondary), ..] => Some((primary.clone(), secondary.clone())),
        _ => None,
    }
}

/// Names as the rows carry them. The in-memory catalogue the identity apply
/// installs has no name on it; the save mints them straight onto the row.
fn stored_names(db_path: &std::path::Path) -> Vec<(String, String)> {
    let conn = Connection::open(db_path).unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name FROM sections WHERE name IS NOT NULL ORDER BY id")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .flatten()
        .collect()
}

/// The catalogue edit the deleted cross-sport auto-merge performed: the
/// secondary's members move to the primary and the secondary row goes, with no
/// call into the identity registry.
fn fuse_behind_the_registry(db_path: &std::path::Path, primary: &str, secondary: &str) {
    let conn = Connection::open(db_path).unwrap();
    conn.execute(
        "UPDATE OR IGNORE section_activities SET section_id = ? WHERE section_id = ?",
        [primary, secondary],
    )
    .unwrap();
    conn.execute(
        "DELETE FROM section_activities WHERE section_id = ?",
        [secondary],
    )
    .unwrap();
    conn.execute("DELETE FROM sections WHERE id = ?", [secondary])
        .unwrap();
}

#[test]
fn repeated_detection_converges_and_holds_on_a_mixed_sport_pool() {
    let dir = TempDir::new().unwrap();
    let corpus = corpus();
    let mut engine = loaded_engine(&dir.path().join("fixed_point.db"), &corpus);

    let mut signatures = Vec::with_capacity(ROUNDS);
    for _ in 0..ROUNDS {
        redetect(&mut engine);
        signatures.push(snapshot(&mut engine).catalogue_signature());
    }

    assert!(
        !signatures[0].is_empty(),
        "expected a catalogue from the pool"
    );
    // A single-sport catalogue would make every cross-sport defect invisible
    // here, and the corpus generator is free to change under us.
    let carried = sports(&mut engine);
    assert!(
        carried.len() > 1,
        "the pool must reach the catalogue as more than one sport, got {carried:?}"
    );

    let settled = settle_round(&signatures).unwrap_or_else(|| {
        let distinct: BTreeSet<&String> = signatures.iter().collect();
        panic!(
            "visible catalogue never stopped moving over {ROUNDS} rounds with no activity added: \
             {} distinct catalogues, sizes {:?}",
            distinct.len(),
            signatures
                .iter()
                .map(|s| s.lines().count())
                .collect::<Vec<_>>()
        )
    });
    assert!(
        settled < SETTLE_BUDGET,
        "visible catalogue took {} rounds to settle, budget is {SETTLE_BUDGET}",
        settled + 1
    );
}

/// Scenario: the apply is driven as production drives it, save first and the
/// deferred tail second, over an unchanged pool.
/// Expected behaviour: the tail leaves the saved catalogue exactly as it found
/// it. A tail that edits the catalogue is a period-2 oscillation, because the
/// next detect re-derives the pre-tail shape from unchanged ground.
#[test]
fn the_deferred_apply_tail_leaves_the_saved_catalogue_alone() {
    let dir = TempDir::new().unwrap();
    let corpus = corpus();
    let mut engine = loaded_engine(&dir.path().join("apply_tail.db"), &corpus);

    let carried = {
        redetect(&mut engine);
        sports(&mut engine)
    };
    assert!(
        carried.len() > 1,
        "the pool must reach the catalogue as more than one sport, got {carried:?}"
    );

    for round in 0..BOUNDARY_ROUNDS {
        let (saved, finalised) = redetect_split(&mut engine);
        assert_eq!(
            saved, finalised,
            "the apply tail edited the catalogue the save committed, on round {round}"
        );
    }
}

/// Scenario: the tail fuses two auto sections behind the identity registry's
/// back, which is what the deleted cross-sport auto-merge did on every apply.
/// Expected behaviour: the registry re-emits the fused-away ground on the next
/// detect, the tail takes it away again, and the save-versus-tail comparison
/// sees the difference every round. Without this the contract above could pass
/// on a pipeline where the two boundaries are the same call.
#[test]
fn a_tail_that_fuses_behind_the_registry_is_caught_every_round() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("fused_tail.db");
    let corpus = corpus();
    let mut engine = loaded_engine(&db_path, &corpus);
    redetect(&mut engine);

    let (primary, secondary) = fusable_pair(&mut engine).expect("expected two auto sections");

    for round in 0..3 {
        detect_and_save(&mut engine);
        let saved = snapshot(&mut engine).catalogue_signature();
        fuse_behind_the_registry(&db_path, &primary, &secondary);
        engine.apply_sections_finalize();
        assert_ne!(
            saved,
            snapshot(&mut engine).catalogue_signature(),
            "a fusing tail went unseen on round {round}, so the contract above cannot fail"
        );
    }
}

#[test]
fn settled_section_names_do_not_move() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("names.db");
    let corpus = corpus();
    let mut engine = loaded_engine(&db_path, &corpus);

    for _ in 0..NAME_WARMUP_ROUNDS {
        redetect(&mut engine);
    }
    // Names are minted inside the save from a per-sport counter over the rows
    // the wipe spared, so they can move while the catalogue itself holds still.
    // The signature does not carry them.
    let settled = stored_names(&db_path);
    assert!(!settled.is_empty(), "expected named sections");

    for round in 0..NAME_ROUNDS {
        redetect(&mut engine);
        assert_eq!(
            stored_names(&db_path),
            settled,
            "section names moved on round {round} with no activity added"
        );
    }
}

/// The cycle detector itself, on sequences with known shapes. A settle check
/// that reported convergence for an alternating sequence would make the
/// contract above unfalsifiable.
#[test]
fn settle_round_rejects_cycles() {
    let seq = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();

    assert_eq!(settle_round(&seq(&["a", "a", "a"])), Some(0));
    assert_eq!(settle_round(&seq(&["a", "b", "b", "b"])), Some(1));
    assert_eq!(settle_round(&seq(&["a", "b", "a", "b"])), None);
    assert_eq!(settle_round(&seq(&["a", "a", "b", "a"])), None);
    assert_eq!(settle_round(&seq(&["a", "b", "c"])), None);
    assert_eq!(settle_round(&[]), None);
}
