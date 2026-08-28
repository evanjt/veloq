//! What was around a change. A fired re-cut, dissolve or merge names the
//! activities that arrived while it was pending, the firing step's included,
//! and a cut at a fork names the traffic the branch collected. Neither is a
//! cause: the copy is "around this change".
//!
//! Scenario: the small-batch corpus, whose third detect after the year
//! expansion fires the debounced changes the expansion started.
//! Expected behaviour: every change fired on that step carries the ids that
//! arrived on it and only ids that arrived after the cold detect, and a
//! ledger built across an app restart still carries what arrived before it.

#![cfg(feature = "synthetic")]

use std::collections::{BTreeMap, BTreeSet};
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

const FIRED: [&str; 3] = ["recut", "dissolved", "merged"];

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    })
}

fn open(dir: &TempDir) -> PersistentRouteEngine {
    let path = dir.path().join("attribution.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();
    engine.load().unwrap();
    engine
}

fn step(engine: &mut PersistentRouteEngine, activities: &[&LifecycleActivity]) {
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .unwrap();
    }
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed) = main.expect("detect result");
    engine
        .apply_sections_with_cache(sections, cache_update)
        .unwrap();
    engine.save_processed_activity_ids(&processed).unwrap();
}

fn section_ids(engine: &mut PersistentRouteEngine) -> Vec<String> {
    engine.get_sections().iter().map(|s| s.id.clone()).collect()
}

fn event_counts(engine: &PersistentRouteEngine, ids: &[String]) -> BTreeMap<String, usize> {
    ids.iter()
        .map(|id| (id.clone(), engine.section_history(id).len()))
        .collect()
}

/// `(kind, around)` of every change fired since `before`, on the ids listed.
fn fired_since(
    engine: &PersistentRouteEngine,
    before: &BTreeMap<String, usize>,
) -> Vec<(String, Vec<String>)> {
    let mut out = Vec::new();
    for (id, seen) in before {
        for e in engine.section_history(id).into_iter().skip(*seen) {
            if !FIRED.contains(&e.kind.as_str()) {
                continue;
            }
            let around: Vec<String> = e
                .details
                .as_deref()
                .and_then(|d| serde_json::from_str::<serde_json::Value>(d).ok())
                .and_then(|v| v.get("around").cloned())
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            out.push((e.kind, around));
        }
    }
    out
}

#[test]
fn a_fired_change_lists_the_activities_around_it() {
    let corpus = corpus();
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    step(&mut engine, &corpus.through_a());
    step(
        &mut engine,
        &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
    );
    step(&mut engine, &[&corpus.bucket_c_single]);
    let ids = section_ids(&mut engine);
    let before = event_counts(&engine, &ids);
    step(
        &mut engine,
        &corpus.bucket_d_delta.iter().collect::<Vec<_>>(),
    );

    let fired = fired_since(&engine, &before);
    assert!(
        !fired.is_empty(),
        "the third detect after the expansion fires changes"
    );
    let after_cold: BTreeSet<&str> = corpus
        .bucket_b_delta
        .iter()
        .chain(std::iter::once(&corpus.bucket_c_single))
        .chain(corpus.bucket_d_delta.iter())
        .map(|a| a.id.as_str())
        .collect();
    let firing_step: BTreeSet<&str> = corpus
        .bucket_d_delta
        .iter()
        .map(|a| a.id.as_str())
        .collect();
    for (kind, around) in &fired {
        assert!(
            !around.is_empty(),
            "a fired {kind} names what was around it"
        );
        let named: BTreeSet<&str> = around.iter().map(String::as_str).collect();
        assert!(
            named.is_subset(&after_cold),
            "a {kind} named an activity from the cold detect: {around:?}"
        );
        assert!(
            firing_step.is_subset(&named),
            "a {kind} must name the step it fired on, got {around:?}"
        );
    }
}

#[test]
fn attribution_survives_a_restart() {
    let corpus = corpus();
    let dir = TempDir::new().unwrap();
    {
        let mut engine = open(&dir);
        step(&mut engine, &corpus.through_a());
        step(
            &mut engine,
            &corpus.bucket_b_delta.iter().collect::<Vec<_>>(),
        );
        step(&mut engine, &[&corpus.bucket_c_single]);
    }
    let mut engine = open(&dir);
    let ids = section_ids(&mut engine);
    let before = event_counts(&engine, &ids);
    step(
        &mut engine,
        &corpus.bucket_d_delta.iter().collect::<Vec<_>>(),
    );

    let recuts: Vec<Vec<String>> = fired_since(&engine, &before)
        .into_iter()
        .filter(|(kind, _)| kind == "recut")
        .map(|(_, around)| around)
        .collect();
    assert!(!recuts.is_empty(), "a re-cut fires on the third detect");
    for around in &recuts {
        assert!(
            around.contains(&corpus.bucket_c_single.id),
            "the arrival before the restart is still around the re-cut: {around:?}"
        );
    }
}
