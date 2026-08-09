//! An exclusion is a user decision on a junction row. Every editing path
//! that rebuilds a section's junction rows must carry the flag across, and
//! every read that serves cached results must drop them when the flag
//! moves — or exclude quietly stops meaning anything.

#![cfg(feature = "synthetic")]

mod lifecycle_support;

use lifecycle_support::*;
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::{ActivityMetrics, PersistentRouteEngine};

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
}

/// An engine holding a detected catalogue, plus one auto section id and
/// one of its member activities to exclude.
fn engine_with_excludable(dir: &TempDir) -> (PersistentRouteEngine, String, String) {
    let corpus = corpus();
    let path = dir.path().join("exclusion.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();
    let mut metrics = Vec::new();
    let mut ids = Vec::new();
    let mut times: Vec<u32> = Vec::new();
    let mut offsets = Vec::new();
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .unwrap();
        // A 1 s-per-point stream so junction rows carry lap times and the
        // performance panel has records to serve.
        let n = a.gps_points.len() as u32;
        offsets.push(times.len() as u32);
        times.extend(0..n);
        ids.push(a.id.clone());
        metrics.push(ActivityMetrics {
            activity_id: a.id.clone(),
            name: a.id.clone(),
            date: a.start_date_unix,
            distance: 1000.0,
            moving_time: n,
            elapsed_time: n,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: a.sport_type.clone(),
        });
    }
    offsets.push(times.len() as u32);
    engine.set_activity_metrics(metrics).unwrap();
    engine.set_time_streams_flat(&ids, &times, &offsets);
    let handle = engine.detect_sections_background(None);
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();

    let section = engine
        .get_sections_by_type(None)
        .into_iter()
        .filter(|s| !s.is_user_defined)
        .max_by_key(|s| s.activity_ids.len())
        .expect("an auto section from 30 overlapping tracks");
    let member = section.activity_ids.first().cloned().unwrap();
    (engine, section.id, member)
}

fn excluded(engine: &PersistentRouteEngine, section_id: &str) -> Vec<String> {
    engine.get_excluded_activity_ids(section_id)
}

#[test]
fn an_exclusion_survives_a_trim() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);
    engine.exclude_activity_from_section(&sid, &member).unwrap();
    assert_eq!(excluded(&engine, &sid), vec![member.clone()]);

    let len = engine.get_section_by_id(&sid).unwrap().polyline.len() as u32;
    engine.trim_section(&sid, 1, len - 2).unwrap();

    assert_eq!(
        excluded(&engine, &sid),
        vec![member],
        "trimming a section must not forget its exclusions"
    );
}

#[test]
fn an_exclusion_survives_a_bounds_reset() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);

    let len = engine.get_section_by_id(&sid).unwrap().polyline.len() as u32;
    engine.trim_section(&sid, 1, len - 2).unwrap();
    engine.exclude_activity_from_section(&sid, &member).unwrap();
    assert_eq!(excluded(&engine, &sid), vec![member.clone()]);

    engine.reset_section_bounds(&sid).unwrap();

    assert_eq!(
        excluded(&engine, &sid),
        vec![member],
        "resetting bounds must not forget exclusions"
    );
}

#[test]
fn an_excluded_activity_stays_out_of_the_member_list_after_a_trim() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);
    engine.exclude_activity_from_section(&sid, &member).unwrap();

    let len = engine.get_section_by_id(&sid).unwrap().polyline.len() as u32;
    engine.trim_section(&sid, 1, len - 2).unwrap();

    let after = engine.get_section_by_id(&sid).unwrap();
    assert!(
        !after.activity_ids.contains(&member),
        "the excluded activity returned as an included member"
    );
}

#[test]
fn excluding_refreshes_the_performance_panel() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);

    let before = engine.get_section_performances(&sid);
    assert!(
        before.records.iter().any(|r| r.activity_id == member),
        "member must appear before exclusion (records: {})",
        before.records.len()
    );

    engine.exclude_activity_from_section(&sid, &member).unwrap();

    let after = engine.get_section_performances(&sid);
    assert!(
        !after.records.iter().any(|r| r.activity_id == member),
        "excluded activity still served from the performance cache"
    );
}

#[test]
fn including_refreshes_the_performance_panel() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);
    engine.exclude_activity_from_section(&sid, &member).unwrap();

    let before = engine.get_section_performances(&sid);
    assert!(!before.records.iter().any(|r| r.activity_id == member));

    engine.include_activity_in_section(&sid, &member).unwrap();

    let after = engine.get_section_performances(&sid);
    assert!(
        after.records.iter().any(|r| r.activity_id == member),
        "re-included activity still missing from the performance cache"
    );
}
