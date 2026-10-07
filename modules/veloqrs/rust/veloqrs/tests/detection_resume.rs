//! A detection run killed after its first checkpoint resumes on the next
//! launch: the restored cache owes only the clusters left, the resumed
//! detect cuts exactly those, and the catalogue is the one an
//! uninterrupted run lands.

mod lifecycle_support;

use std::collections::HashMap;
use std::ops::ControlFlow;
use std::path::Path;

use lifecycle_support::*;
use rusqlite::Connection;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use tracematch::{GpsPoint, SectionEvidenceCache, detect_sections_incremental_observed};
use veloqrs::objects::{DetectionManager, VeloqEngine};
use veloqrs::persistence::{CacheUpdate, PersistentEngine, with_persistent_engine};

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
                bucket_d_delta_count: 3,
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

/// Every stored traversal with the direction it was filed under, sorted. The
/// catalogue signature sees a direction only through the rank score's one-way
/// feature, which moves by whole percentile steps and lets opposite flips cancel,
/// while the laps, the bests and the direction toggle all read this column.
fn stored_directions(db: &Path) -> Vec<String> {
    let conn = Connection::open(db).expect("open db");
    let mut stmt = conn
        .prepare(
            "SELECT section_id, activity_id, start_index, direction FROM section_activities
             ORDER BY section_id, activity_id, start_index",
        )
        .expect("prepare");
    stmt.query_map([], |r| {
        Ok(format!(
            "{}|{}|{}|{}",
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, String>(3)?,
        ))
    })
    .expect("query")
    .collect::<Result<_, _>>()
    .expect("rows")
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
    // A database is three files, and the committed pages are in
    // the `-wal` while the engine holds it open. Copying the main file alone
    // gave the twin an empty catalogue, so the uninterrupted answer this
    // compares against was nothing at all.
    std::fs::copy(&path, &twin_path).expect("copy db");
    for suffix in ["-wal", "-shm"] {
        let beside = dir.path().join(format!("lifecycle.db{suffix}"));
        if beside.exists() {
            std::fs::copy(&beside, dir.path().join(format!("twin.db{suffix}")))
                .expect("copy sidecar");
        }
    }
    let expected = {
        let mut twin = PersistentEngine::new(twin_path.to_str().unwrap()).expect("twin");
        twin.load().expect("load twin");
        ingest_step(&mut twin, "twin", &held).snapshot
    };
    let expected_directions = stored_directions(&twin_path);

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
        .map(|a| {
            (
                a.id.clone(),
                engine.get_gps_track(&a.id).expect("stored track"),
            )
        })
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
    detect_sections_incremental_observed(
        &mut cache,
        &[],
        &tracks[..base.len()],
        &base_ids,
        &[],
        &sports,
        &starts,
        &config,
        &policy,
        &mut |_, _, _| ControlFlow::Continue(()),
    )
    .unwrap();
    let mut checkpoint: Option<SectionEvidenceCache> = None;
    detect_sections_incremental_observed(
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
            ControlFlow::Continue(())
        },
    )
    .unwrap();
    let checkpoint = checkpoint.expect("a checkpoint after the first cluster");
    assert_eq!(checkpoint.dirty_clusters(), 2);
    engine.persist_evidence_checkpoint(&CacheUpdate {
        cache: checkpoint,
        folded_ids: tracks.iter().map(|(id, _)| id.clone()).collect(),
        checkpoint: true,
        boundaries: Vec::new(),
    });
    drop(engine);

    // Check the persisted interruption before opening the live engine, whose
    // constructor is allowed to complete the run before it returns.
    let mut interrupted = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    interrupted.load().expect("load");
    assert_eq!(
        interrupted.evidence_cache_dirty_clusters(),
        2,
        "the restored checkpoint must still owe the two clusters"
    );
    drop(interrupted);
    // Next launch: create starts the owed run without stores or a manual detect.
    let _reopened = VeloqEngine::create(path.to_string_lossy().into_owned());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while DetectionManager::new().last_outcome() != "complete"
        && std::time::Instant::now() < deadline
    {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(DetectionManager::new().last_outcome(), "complete");
    let after = with_persistent_engine(snapshot).expect("engine");
    assert_eq!(
        with_persistent_engine(|e| e.evidence_cache_dirty_clusters()).expect("engine"),
        0
    );
    let resumed_directions = stored_directions(&path);
    assert!(
        !expected_directions.is_empty(),
        "the uninterrupted run must have filed traversals to compare against"
    );
    assert_eq!(
        resumed_directions, expected_directions,
        "every traversal must be filed under the direction the uninterrupted run gave it"
    );
    assert_eq!(
        after.catalogue_signature_with_ids(),
        expected.catalogue_signature_with_ids(),
        "the resumed catalogue must be the uninterrupted one"
    );
}

#[test]
fn a_detect_cancelled_during_the_fold_stops_at_a_cluster_and_sends_nothing() {
    let (mut engine, _dir) = fresh_engine();
    for a in library().iter().flatten() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("store");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("date");
    }
    let sections_before = engine.get_sections().len();

    let handle = engine.detect_sections_background();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while handle.get_progress().0 != "analyzing" {
        assert!(
            std::time::Instant::now() < deadline,
            "the run never reached the fold"
        );
        std::thread::sleep(std::time::Duration::from_micros(100));
    }
    handle.request_cancel();
    let (state, _) = handle.recv_state_with_cache_within(Some(std::time::Duration::from_secs(60)));

    assert!(
        matches!(state, veloqrs::persistence::WorkerPoll::Died),
        "a cancelled fold sends no catalogue"
    );
    let (phase, done, total) = handle.get_progress();
    assert_eq!(phase, "cancelled");
    assert_eq!(total, 3, "each far-apart cluster is owed");
    assert!(done < total, "the fold stopped at {done} of {total}");
    assert_eq!(engine.get_sections().len(), sections_before);
}
