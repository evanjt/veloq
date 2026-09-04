//! A detection run killed after its first checkpoint resumes on the next
//! launch: the restored cache owes only the clusters left, the resumed
//! detect cuts exactly those, and the catalogue is the one an
//! uninterrupted run lands.

mod lifecycle_support;

use std::collections::HashMap;

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use tracematch::{GpsPoint, SectionEvidenceCache, detect_sections_unified_incremental_observed};
use veloqrs::persistence::{CacheUpdate, PersistentEngine};

/// Three far-apart clusters, each its own corridor library, ids prefixed
/// per cluster so the three generators cannot mint the same id.
fn library() -> Vec<Vec<LifecycleActivity>> {
    (0..3)
        .map(|c| {
            let corpus = LifecycleCorpus::generate(&LifecycleConfig {
                origin: GpsPoint::with_elevation(44.0 + c as f64 * 3.0, 8.0, 400.0),
                seed: 0x51D + c as u64,
                bucket_a_count: 12,
                bucket_b_delta_count: 0,
                bucket_d_delta_count: 0,
                bucket_e_delta_count: 0,
                one_off_fraction: 0.0,
                parallel_street_count: 0,
                ..LifecycleConfig::default()
            });
            corpus
                .through_a()
                .into_iter()
                .map(|a| {
                    let mut a = a.clone();
                    a.id = format!("c{c}_{}", a.id);
                    a
                })
                .collect()
        })
        .collect()
}

#[test]
fn a_run_killed_after_its_first_checkpoint_resumes_where_it_stopped() {
    let corpora = library();
    let (mut engine, dir) = fresh_engine();
    let path = dir.path().join("lifecycle.db");

    // Cold: every cluster minus its last two activities.
    let held: Vec<&LifecycleActivity> = corpora
        .iter()
        .flat_map(|c| {
            let n = c.len();
            [&c[n - 2], &c[n - 1]]
        })
        .collect();
    let held_ids: Vec<&str> = held.iter().map(|a| a.id.as_str()).collect();
    let base: Vec<&LifecycleActivity> = corpora
        .iter()
        .flat_map(|c| c.iter())
        .filter(|a| !held_ids.contains(&a.id.as_str()))
        .collect();
    let cold = ingest_step(&mut engine, "cold", &base).snapshot;
    assert_catalogue_populated("cold", &cold);
    let existing = engine.get_sections().to_vec();

    // The uninterrupted answer, from the same state on a twin engine.
    let twin_path = dir.path().join("twin.db");
    std::fs::copy(&path, &twin_path).expect("copy db");
    let expected = {
        let mut twin = PersistentEngine::new(twin_path.to_str().unwrap()).expect("twin");
        twin.load().expect("load twin");
        ingest_step(&mut twin, "twin", &held).snapshot
    };

    // The interrupted run: store the newcomers, fold them off-engine to
    // obtain the checkpoint a kill after the first cluster would have
    // left, persist it as the poller would, and open a new process.
    for a in &held {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("store");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("date");
    }
    let tracks: Vec<(String, Vec<GpsPoint>)> = base
        .iter()
        .chain(held.iter())
        .map(|a| (a.id.clone(), a.gps_points.clone()))
        .collect();
    let sports: HashMap<String, String> = tracks
        .iter()
        .map(|(id, _)| (id.clone(), "Ride".to_string()))
        .collect();
    let starts: HashMap<String, i64> = base
        .iter()
        .chain(held.iter())
        .map(|a| (a.id.clone(), a.start_date_unix))
        .collect();
    let base_ids: Vec<&str> = base.iter().map(|a| a.id.as_str()).collect();
    let config = engine.get_section_config();
    let mut cache = SectionEvidenceCache::new();
    let policy = tracematch::SectionUpdatePolicy::default();
    detect_sections_unified_incremental_observed(
        &mut cache,
        &[],
        &tracks[..base.len()],
        &base_ids,
        &[],
        &sports,
        &starts,
        &config,
        &policy,
        &mut |_, _, _| {},
    );
    let mut checkpoint: Option<SectionEvidenceCache> = None;
    detect_sections_unified_incremental_observed(
        &mut cache,
        &existing,
        &tracks,
        &held_ids,
        &[],
        &sports,
        &starts,
        &config,
        &policy,
        &mut |done, _, cache| {
            if done == 1 {
                checkpoint = Some(cache.checkpoint());
            }
        },
    );
    let checkpoint = checkpoint.expect("a checkpoint after the first cluster");
    assert_eq!(checkpoint.dirty_clusters(), 2);
    engine.persist_evidence_checkpoint(&CacheUpdate {
        cache: checkpoint,
        folded_ids: tracks.iter().map(|(id, _)| id.clone()).collect(),
        checkpoint: true,
        boundaries: Vec::new(),
    });
    drop(engine);

    // Next launch: the debt is restored, and one detect settles it.
    let mut resumed = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    resumed.load().expect("load");
    assert_eq!(
        resumed.evidence_cache_dirty_clusters(),
        2,
        "the restored checkpoint must still owe the two clusters"
    );
    let after = ingest_step(&mut resumed, "resume", &[]).snapshot;
    assert_eq!(resumed.evidence_cache_dirty_clusters(), 0);
    assert_eq!(
        after.catalogue_signature_with_ids(),
        expected.catalogue_signature_with_ids(),
        "the resumed catalogue must be the uninterrupted one"
    );
}
