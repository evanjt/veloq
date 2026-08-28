//! Every visible section carries a profile and an interestingness score
//! after a detect: the scores are percentiles, they persist and reload,
//! the summaries agree with the catalogue, and two engines over the same
//! corpus rank identically.

mod lifecycle_support;

use std::collections::BTreeMap;

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::persistence::PersistentRouteEngine;

fn ranked(engine: &PersistentRouteEngine) -> BTreeMap<String, (f64, f64, Option<String>)> {
    engine
        .get_sections()
        .iter()
        .map(|s| {
            let r = s.rank.as_ref().expect("a detected section carries a rank");
            (
                s.id.clone(),
                (
                    r.score,
                    r.sport_score,
                    s.enrichment.klass.map(|k| k.as_str().to_string()),
                ),
            )
        })
        .collect()
}

#[test]
fn a_detect_scores_every_section_and_the_scores_persist() {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig::default());
    let (mut engine, dir) = fresh_engine();
    let step = ingest_step(&mut engine, "cold", &corpus.through_a());
    assert_catalogue_populated("cold", &step.snapshot);

    let scores = ranked(&engine);
    assert!(
        scores.len() > 1,
        "the fixture must cut more than one section"
    );
    for (id, (score, sport, _)) in &scores {
        assert!((0.0..=1.0).contains(score), "{id} score {score}");
        assert!((0.0..=1.0).contains(sport), "{id} sport score {sport}");
    }
    let distinct: std::collections::BTreeSet<u64> =
        scores.values().map(|(s, _, _)| s.to_bits()).collect();
    assert!(
        distinct.len() > 1,
        "percentiles across the catalogue cannot all tie"
    );
    for s in engine.get_sections() {
        assert!(
            s.enrichment.straightness.is_some(),
            "{} has a line but no straightness",
            s.id
        );
    }

    let summaries: BTreeMap<String, Option<f64>> = engine
        .get_section_summaries()
        .into_iter()
        .map(|s| (s.id, s.rank_score))
        .collect();
    for (id, (score, _, _)) in &scores {
        assert_eq!(
            summaries.get(id).copied().flatten(),
            Some(*score),
            "{id} in summaries"
        );
    }

    drop(engine);
    let path = dir.path().join("lifecycle.db");
    let mut reopened = PersistentRouteEngine::new(path.to_str().unwrap()).expect("reopen");
    reopened.load().expect("load");
    assert_eq!(ranked(&reopened), scores, "scores must survive a reload");
}

#[test]
fn two_engines_over_one_corpus_rank_identically() {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig::default());
    let (mut a, _da) = fresh_engine();
    let (mut b, _db) = fresh_engine();
    ingest_step(&mut a, "cold", &corpus.through_a());
    ingest_step(&mut b, "cold", &corpus.through_a());
    assert_eq!(ranked(&a), ranked(&b));
}
