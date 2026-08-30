//! Scenario: the Unified detector's evidence cache is written beside the
//! catalogue it produced, and the next process picks it up.
//!
//! Expected behaviour: a restart resumes warm under the same config, and
//! goes cold, without complaint, under any other config or on a row it
//! cannot read. Being cold is only ever slow; adopting a cache that does not
//! match the catalogue would be wrong.

#![cfg(feature = "synthetic")]

use std::collections::BTreeSet;

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn corpus() -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 24,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

fn unified_config() -> SectionConfig {
    SectionConfig {
        ..SectionConfig::default()
    }
}

fn open(dir: &TempDir) -> PersistentRouteEngine {
    let path = dir.path().join("evidence.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    engine.load().expect("load");
    engine.set_section_config(unified_config());
    engine
}

fn ingest(engine: &mut PersistentRouteEngine, activities: &[LifecycleActivity]) {
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
}

fn detect(engine: &mut PersistentRouteEngine) {
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed) = main.unwrap_or_default();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply_sections_with_cache");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
}

/// Every section's member set, order-free. Ids are minted off the clock until
/// they come from the ground, so two engines cutting the same catalogue at
/// different moments agree on membership and not on ids.
fn catalogue(engine: &mut PersistentRouteEngine) -> BTreeSet<BTreeSet<String>> {
    engine
        .get_sections()
        .iter()
        .map(|s| s.activity_ids.iter().cloned().collect())
        .collect()
}

/// The catalogue including its ids, for the paths where nothing is re-cut and
/// the ids must therefore be the ones already stored.
fn catalogue_with_ids(engine: &mut PersistentRouteEngine) -> BTreeSet<(String, BTreeSet<String>)> {
    engine
        .get_sections()
        .iter()
        .map(|s| (s.id.clone(), s.activity_ids.iter().cloned().collect()))
        .collect()
}

fn cache_row(dir: &TempDir) -> Option<(String, usize)> {
    let conn = Connection::open(dir.path().join("evidence.db")).expect("open");
    conn.query_row(
        "SELECT config_digest, length(cache) FROM evidence_cache WHERE id = 1",
        [],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize)),
    )
    .ok()
}

fn seeded(dir: &TempDir) -> PersistentRouteEngine {
    let pool = corpus();
    let mut engine = open(dir);
    ingest(&mut engine, &pool);
    detect(&mut engine);
    engine
}

#[test]
fn a_detect_leaves_its_evidence_behind() {
    let dir = TempDir::new().unwrap();
    let engine = seeded(&dir);

    assert!(
        engine.evidence_cache_folded_count() > 0,
        "the detect folded nothing, so the rest proves nothing"
    );
    let (_digest, bytes) = cache_row(&dir).expect("the apply wrote an evidence row");
    assert!(bytes > 0, "the evidence blob is empty");
}

#[test]
fn a_restart_resumes_warm_on_the_same_catalogue() {
    let dir = TempDir::new().unwrap();
    let mut first = seeded(&dir);
    let folded = first.evidence_cache_folded_count();
    let before = catalogue_with_ids(&mut first);
    drop(first);

    let mut second = open(&dir);
    assert_eq!(
        second.evidence_cache_folded_count(),
        folded,
        "the restart came up cold"
    );
    assert_eq!(
        catalogue_with_ids(&mut second),
        before,
        "the catalogue moved across a restart that re-cut nothing"
    );
}

#[test]
fn a_restart_under_another_config_starts_cold() {
    let dir = TempDir::new().unwrap();
    let first = seeded(&dir);
    assert!(first.evidence_cache_folded_count() > 0);
    drop(first);

    let path = dir.path().join("evidence.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    engine.set_section_config(SectionConfig {
        min_activities: unified_config().min_activities + 1,
        ..unified_config()
    });
    engine.load().expect("load");

    assert_eq!(
        engine.evidence_cache_folded_count(),
        0,
        "evidence folded under one config was adopted under another"
    );
    assert!(
        cache_row(&dir).is_none(),
        "the mismatched row was left behind to be re-read next time"
    );
}

#[test]
fn an_unreadable_blob_starts_cold_without_failing_the_open() {
    let dir = TempDir::new().unwrap();
    let first = seeded(&dir);
    assert!(first.evidence_cache_folded_count() > 0);
    drop(first);

    {
        let conn = Connection::open(dir.path().join("evidence.db")).expect("open");
        conn.execute(
            "UPDATE evidence_cache SET cache = ?1 WHERE id = 1",
            [b"not a cache".to_vec()],
        )
        .expect("corrupt the blob");
    }

    let mut engine = open(&dir);
    assert_eq!(
        engine.evidence_cache_folded_count(),
        0,
        "an unreadable blob was adopted"
    );
    assert!(cache_row(&dir).is_none(), "the bad row was left in place");
    assert!(
        !catalogue(&mut engine).is_empty(),
        "the catalogue itself must survive a bad cache row"
    );
}

#[test]
fn an_invalidation_takes_the_stored_row_with_it() {
    let dir = TempDir::new().unwrap();
    let mut engine = seeded(&dir);
    assert!(cache_row(&dir).is_some());

    let pool = corpus();
    engine
        .remove_activity(&pool[0].id)
        .expect("remove_activity");

    assert_eq!(engine.evidence_cache_folded_count(), 0);
    assert!(
        cache_row(&dir).is_none(),
        "the removal cleared the engine's cache but left the stored one"
    );
}

#[test]
fn a_warm_add_lands_on_the_same_catalogue_as_a_cold_one() {
    let pool = corpus();
    let (head, tail) = pool.split_at(pool.len() - 3);

    let warm_dir = TempDir::new().unwrap();
    let mut warm = open(&warm_dir);
    ingest(&mut warm, head);
    detect(&mut warm);
    drop(warm);
    let mut warm = open(&warm_dir);
    assert!(
        warm.evidence_cache_folded_count() > 0,
        "the restarted engine is cold, so this is not a warm-add test"
    );
    ingest(&mut warm, tail);
    detect(&mut warm);

    let cold_dir = TempDir::new().unwrap();
    let mut cold = open(&cold_dir);
    ingest(&mut cold, &pool);
    detect(&mut cold);

    assert_eq!(
        catalogue(&mut warm),
        catalogue(&mut cold),
        "an add folded through a restored cache disagrees with a cold batch"
    );
}

#[test]
fn a_config_change_drops_the_evidence_it_invalidates() {
    let pool = corpus();

    let changed_dir = TempDir::new().unwrap();
    let mut changed = open(&changed_dir);
    ingest(&mut changed, &pool);
    detect(&mut changed);
    assert!(changed.evidence_cache_folded_count() > 0);

    changed.set_section_config(SectionConfig {
        min_activities: unified_config().min_activities + 3,
        ..unified_config()
    });
    assert_eq!(
        changed.evidence_cache_folded_count(),
        0,
        "evidence folded under the old config survived the change"
    );
    assert!(
        cache_row(&changed_dir).is_none(),
        "the stored row survived a config change that invalidated it"
    );
    detect(&mut changed);

    let fresh_dir = TempDir::new().unwrap();
    let path = fresh_dir.path().join("evidence.db");
    let mut fresh = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    fresh.load().expect("load");
    fresh.set_section_config(SectionConfig {
        min_activities: unified_config().min_activities + 3,
        ..unified_config()
    });
    ingest(&mut fresh, &pool);
    detect(&mut fresh);

    assert_eq!(
        catalogue(&mut changed),
        catalogue(&mut fresh),
        "a re-detect after a config change disagrees with an engine that \
         only ever knew the new config"
    );
}
