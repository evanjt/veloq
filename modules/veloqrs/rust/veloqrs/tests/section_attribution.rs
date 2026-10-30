//! What was around a change. A fired re-cut, dissolve or merge names the
//! activities that arrived while it was pending, the firing step's included,
//! and that rode the ground it moved. A cut at a fork names the traffic the
//! branch collected. Neither is a cause: the copy is "around this change".
//!
//! Scenario: the small-batch corpus, whose expansion fires the changes its
//! rides support inside its own detect, then the rides of the last bucket one
//! per detect, the second of which starts changes the next two confirm.
//! Expected behaviour: every fired change carries only ids that arrived after
//! the cold detect and that rode its ground, a ride elsewhere in the library
//! that synced beside it is never listed, one of
//! them names the rides it was pending across, and a ledger built across an
//! app restart still carries what arrived before it.

#![cfg(feature = "synthetic")]

use std::collections::{BTreeMap, BTreeSet};
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

const FIRED: [&str; 3] = ["recut", "dissolved", "merged"];

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 6,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    })
}

fn open(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("attribution.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    engine.load().unwrap();
    engine
}

fn step(engine: &mut PersistentEngine, activities: &[&LifecycleActivity]) {
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

fn section_ids(engine: &mut PersistentEngine) -> Vec<String> {
    engine.get_sections().iter().map(|s| s.id.clone()).collect()
}

fn event_counts(engine: &PersistentEngine, ids: &[String]) -> BTreeMap<String, usize> {
    ids.iter()
        .map(|id| (id.clone(), engine.section_history(id).len()))
        .collect()
}

/// `(kind, around)` of each fired change.
type Fired = Vec<(String, Vec<String>)>;

/// `(kind, around)` of every change fired since `before`, on the ids listed.
fn fired_since(engine: &PersistentEngine, before: &BTreeMap<String, usize>) -> Fired {
    let mut out = Vec::new();
    for (id, seen) in before {
        for e in engine.section_history(id).into_iter().skip(*seen) {
            if !FIRED.contains(&e.kind.as_str()) {
                continue;
            }
            let details = e
                .details
                .as_deref()
                .and_then(|d| serde_json::from_str::<serde_json::Value>(d).ok());
            // An adoption swaps the line outright and was never pending, so it
            // has no arrivals to name.
            if details
                .as_ref()
                .and_then(|v| v.get("reason"))
                .and_then(|r| r.as_str())
                == Some("adopted")
            {
                continue;
            }
            let around: Vec<String> = details
                .and_then(|v| v.get("around").cloned())
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            out.push((e.kind, around));
        }
    }
    out
}

/// The cold detect, the expansion and the single add, as three detects.
fn through_c(engine: &mut PersistentEngine, corpus: &LifecycleCorpus) {
    step(engine, &corpus.through_a());
    step(engine, &corpus.bucket_b_delta.iter().collect::<Vec<_>>());
    step(engine, &[&corpus.bucket_c_single]);
}

/// Store one ride and detect, returning the changes that fired on it.
fn ride(engine: &mut PersistentEngine, a: &LifecycleActivity) -> Fired {
    let ids = section_ids(engine);
    let before = event_counts(engine, &ids);
    step(engine, &[a]);
    fired_since(engine, &before)
}

#[test]
fn a_fired_change_lists_the_activities_around_it() {
    let corpus = corpus();
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    step(&mut engine, &corpus.through_a());
    let ids = section_ids(&mut engine);
    let before = event_counts(&engine, &ids);
    let expansion: Vec<&LifecycleActivity> = corpus.bucket_b_delta.iter().collect();
    step(&mut engine, &expansion);
    let mut fired: Vec<(BTreeSet<&str>, Fired)> = vec![(
        expansion.iter().map(|a| a.id.as_str()).collect(),
        fired_since(&engine, &before),
    )];
    for a in std::iter::once(&corpus.bucket_c_single).chain(&corpus.bucket_d_delta) {
        fired.push((BTreeSet::from([a.id.as_str()]), ride(&mut engine, a)));
    }

    assert!(
        !fired[0].1.is_empty(),
        "the expansion fires the changes its rides support"
    );
    let after_cold: BTreeSet<&str> = corpus
        .bucket_b_delta
        .iter()
        .chain(std::iter::once(&corpus.bucket_c_single))
        .chain(corpus.bucket_d_delta.iter())
        .map(|a| a.id.as_str())
        .collect();
    let mut pended = false;
    for (firing_step, changes) in &fired {
        for (kind, around) in changes {
            assert!(
                !around.is_empty(),
                "a fired {kind} names what was around it"
            );
            let named: BTreeSet<&str> = around.iter().map(String::as_str).collect();
            assert!(
                named.is_subset(&after_cold),
                "a {kind} named an activity from the cold detect: {around:?}"
            );
            pended |= !named.is_subset(firing_step);
        }
    }
    assert!(
        pended,
        "a change pending across single rides names the rides before the one it fired on"
    );
}

#[test]
fn attribution_survives_a_restart() {
    let corpus = corpus();
    let [_, before_restart, after_restart @ ..] = corpus.bucket_d_delta.as_slice() else {
        panic!("the last bucket holds six rides");
    };
    let dir = TempDir::new().unwrap();
    {
        let mut engine = open(&dir);
        through_c(&mut engine, &corpus);
        ride(&mut engine, &corpus.bucket_d_delta[0]);
        ride(&mut engine, before_restart);
    }
    let mut engine = open(&dir);
    let fired: Fired = after_restart[..2]
        .iter()
        .flat_map(|a| ride(&mut engine, a))
        .collect();

    assert!(
        !fired.is_empty(),
        "a change pending across the restart fires on the second ride after it"
    );
    for (kind, around) in &fired {
        assert!(
            around.contains(&before_restart.id),
            "the arrival before the restart is still around the {kind}: {around:?}"
        );
    }
}

/// A ride on the same shape of track, hundreds of kilometres from the corpus.
fn far_ride(from: &LifecycleActivity, tag: &str) -> LifecycleActivity {
    LifecycleActivity {
        id: format!("far-{tag}"),
        sport_type: from.sport_type.clone(),
        start_date_unix: from.start_date_unix + 1,
        gps_points: from
            .gps_points
            .iter()
            .map(|p| tracematch::GpsPoint {
                latitude: p.latitude + 4.0,
                longitude: p.longitude + 4.0,
                elevation: p.elevation,
            })
            .collect(),
    }
}

#[test]
fn a_ride_far_from_a_change_is_never_listed_on_it() {
    let corpus = corpus();
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir);
    step(&mut engine, &corpus.through_a());
    let ids = section_ids(&mut engine);
    let before = event_counts(&engine, &ids);
    let far_batch = far_ride(&corpus.bucket_b_delta[0], "batch");
    let mut expansion: Vec<&LifecycleActivity> = corpus.bucket_b_delta.iter().collect();
    expansion.push(&far_batch);
    step(&mut engine, &expansion);
    let mut fired = fired_since(&engine, &before);

    let singles: Vec<&LifecycleActivity> = std::iter::once(&corpus.bucket_c_single)
        .chain(&corpus.bucket_d_delta)
        .collect();
    let far_singles: Vec<LifecycleActivity> = singles
        .iter()
        .enumerate()
        .map(|(i, a)| far_ride(a, &i.to_string()))
        .collect();
    for (near, far) in singles.iter().zip(&far_singles) {
        let ids = section_ids(&mut engine);
        let before = event_counts(&engine, &ids);
        step(&mut engine, &[near, far]);
        fired.extend(fired_since(&engine, &before));
    }

    assert!(!fired.is_empty(), "the corpus fires changes");
    for (kind, around) in &fired {
        assert!(
            around.iter().all(|id| !id.starts_with("far-")),
            "a {kind} listed a ride that never touched it: {around:?}"
        );
    }
}
