//! Two-tier ingest: the download loop attaches each stored activity to the
//! existing catalogue instantly (junction rows, one regroup tail), while
//! full detection is deferred to the conditioning cadence.
//!
//! Scenario: a library already has detected sections, then a sync stores a
//! batch of new activities over the same corridor.
//! Expected behaviour: attach_new_activities inserts junction rows for every
//! stored activity and refreshes groups/indicators once for the whole batch,
//! without creating or destroying any section.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn engine_with_sections(dir: &TempDir, corpus: &LifecycleCorpus) -> PersistentRouteEngine {
    let path = dir.path().join("two_tier.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();

    for activity in corpus.through_a() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .unwrap();
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .unwrap();
    }

    let handle = engine.detect_sections_background(None);
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();
    assert!(
        !engine.get_sections().is_empty(),
        "expected sections from 30 overlapping tracks"
    );
    engine
}

#[test]
fn attach_batch_inserts_junctions_without_detection() {
    let dir = TempDir::new().unwrap();
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    let mut engine = engine_with_sections(&dir, &corpus);
    let section_count = engine.get_sections().len();

    // Bucket C (RideMain forward) and bucket D's reverse ride are guaranteed
    // traversals of already-sectioned ground; the third D activity is a
    // deliberate one-off that must store without attaching. D's run overlap
    // is excluded: run traffic splits across two corridors, so its ground is
    // not deterministically sectioned at this corpus size.
    let corridor: Vec<&tracematch::scenarios::LifecycleActivity> =
        vec![&corpus.bucket_c_single, &corpus.bucket_d_delta[1]];
    let one_off = &corpus.bucket_d_delta[2];

    let mut new_ids: Vec<String> = Vec::new();
    for a in corridor.iter().chain(std::iter::once(&one_off)) {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        new_ids.push(a.id.clone());
    }

    let summary = engine.attach_new_activities(&new_ids);

    for a in &corridor {
        assert!(
            !engine.get_sections_for_activity(&a.id).is_empty(),
            "junction rows must make {} queryable immediately",
            a.id
        );
    }
    assert_eq!(
        summary.attached_activities, 2,
        "both ride traversals must attach, the one-off must not: {:?}",
        summary
    );
    assert!(summary.inserted_portions >= 2, "{:?}", summary);
    assert!(
        summary.regrouped,
        "ingest sets groups_dirty, so the batch tail must regroup once"
    );
    assert!(
        engine.get_sections_for_activity(&one_off.id).is_empty(),
        "a one-off stretch never gains junction rows from attach"
    );

    assert_eq!(
        engine.get_sections().len(),
        section_count,
        "attach never creates or destroys sections"
    );

    let again = engine.attach_new_activities(&new_ids);
    assert_eq!(again.attached_activities, summary.attached_activities);
    assert_eq!(
        again.inserted_portions, summary.inserted_portions,
        "re-attach replaces rows, never stacks them"
    );
}

#[test]
fn attach_ignores_unknown_and_tiny_activities() {
    let dir = TempDir::new().unwrap();
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    let mut engine = engine_with_sections(&dir, &corpus);

    let summary = engine.attach_new_activities(&["missing".to_string()]);
    assert_eq!(summary.attached_activities, 0);
    assert_eq!(summary.inserted_portions, 0);
}

// --- Lapped activities attach every pass ---
//
// A track crossing sectioned ground several times owes one junction row per
// pass, and the attach path must agree with what a full detection over the
// same set assigns it.

/// Out, back, out again over `base`: three passes of the same corridor.
fn lapped_track(base: &tracematch::scenarios::LifecycleActivity) -> Vec<tracematch::GpsPoint> {
    let mut points = base.gps_points.clone();
    let mut back = base.gps_points.clone();
    back.reverse();
    points.extend(back);
    points.extend(base.gps_points.clone());
    points
}

fn lapped_corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
}

/// Passes `activity_id` owns in each section it appears in.
fn passes_per_section(engine: &mut PersistentRouteEngine, activity_id: &str) -> Vec<usize> {
    let ids: Vec<String> = engine
        .get_sections_for_activity(activity_id)
        .iter()
        .map(|s| s.id.clone())
        .collect();
    ids.iter()
        .map(|id| {
            engine
                .get_section_by_id(id)
                .map(|s| {
                    s.activity_portions
                        .iter()
                        .filter(|p| p.activity_id == activity_id)
                        .count()
                })
                .unwrap_or(0)
        })
        .collect()
}

/// Passes `activity_id` owns across every section it appears in.
fn passes_for(engine: &mut PersistentRouteEngine, activity_id: &str) -> usize {
    passes_per_section(engine, activity_id).iter().sum()
}

fn store(
    engine: &mut PersistentRouteEngine,
    id: &str,
    points: Vec<tracematch::GpsPoint>,
    a: &tracematch::scenarios::LifecycleActivity,
) {
    engine
        .add_activity(id.to_string(), points, a.sport_type.clone())
        .unwrap();
    engine
        .update_activity_metadata(id, Some(a.start_date_unix), None, None, None)
        .unwrap();
}

#[test]
fn attach_inserts_a_junction_row_for_every_lap() {
    let dir = TempDir::new().unwrap();
    let corpus = lapped_corpus();
    let mut engine = engine_with_sections(&dir, &corpus);
    let section_count = engine.get_sections().len();

    let base = &corpus.bucket_c_single;
    store(&mut engine, "act_lapped", lapped_track(base), base);
    let summary = engine.attach_new_activities(&["act_lapped".to_string()]);

    assert_eq!(summary.attached_activities, 1);

    // The corridor may be cut into several sections. Whichever ground a
    // section covers, all three crossings of it are owed a row.
    let per_section = passes_per_section(&mut engine, "act_lapped");
    assert!(!per_section.is_empty(), "the corridor must be sectioned");
    for passes in &per_section {
        assert_eq!(
            *passes, 3,
            "every section the track crosses owes one row per crossing, got {:?}",
            per_section
        );
    }
    assert_eq!(
        summary.inserted_portions as usize,
        per_section.iter().sum::<usize>(),
        "attach must report exactly the rows it stored"
    );
    assert_eq!(
        engine.get_sections().len(),
        section_count,
        "attach never creates or destroys sections"
    );
}

#[test]
fn a_lapped_attach_matches_what_batch_detection_assigns() {
    let corpus = lapped_corpus();
    let base = &corpus.bucket_c_single;

    let incremental_dir = TempDir::new().unwrap();
    let mut incremental = engine_with_sections(&incremental_dir, &corpus);
    store(&mut incremental, "act_lapped", lapped_track(base), base);
    incremental.attach_new_activities(&["act_lapped".to_string()]);

    let batch_dir = TempDir::new().unwrap();
    let batch_path = batch_dir.path().join("batch.db");
    let mut batch = PersistentRouteEngine::new(batch_path.to_str().unwrap()).unwrap();
    for activity in corpus.through_a() {
        let id = activity.id.clone();
        store(&mut batch, &id, activity.gps_points.clone(), activity);
    }
    store(&mut batch, "act_lapped", lapped_track(base), base);
    let handle = batch.detect_sections_background(None);
    let (sections, _) = handle.recv().unwrap_or_default();
    batch.apply_sections(sections).unwrap();

    // How many sections the corridor is cut into is a detection decision and
    // varies between the two engines. What must not vary is how completely a
    // section records the crossings it covers.
    let from_attach = passes_per_section(&mut incremental, "act_lapped");
    let from_detection = passes_per_section(&mut batch, "act_lapped");
    assert!(!from_attach.is_empty() && !from_detection.is_empty());
    for passes in from_attach.iter().chain(from_detection.iter()) {
        assert_eq!(
            *passes, 3,
            "laps must count the same whether the activity arrived during ingest \
             ({from_attach:?}) or was present when detection ran ({from_detection:?})"
        );
    }
}

#[test]
fn re_attaching_a_lapped_activity_does_not_stack_rows() {
    let dir = TempDir::new().unwrap();
    let corpus = lapped_corpus();
    let mut engine = engine_with_sections(&dir, &corpus);

    let base = &corpus.bucket_c_single;
    store(&mut engine, "act_lapped", lapped_track(base), base);
    let first = engine.attach_new_activities(&["act_lapped".to_string()]);
    let again = engine.attach_new_activities(&["act_lapped".to_string()]);

    assert_eq!(
        again.inserted_portions, first.inserted_portions,
        "re-attach replaces the lap rows, never stacks them"
    );
    for passes in passes_per_section(&mut engine, "act_lapped") {
        assert_eq!(passes, 3, "three laps stay three after a repeated attach");
    }
}

/// The attach matcher derives its tolerance from the proximity setting.
/// At the default (200 m) the derived tolerance is the long-standing 50 m,
/// so shipped behaviour is unchanged; a relaxed setting must widen the
/// match with it, or the slider silently stops at the detection layer.
#[test]
fn the_attach_tolerance_follows_the_proximity_setting() {
    let dir = TempDir::new().unwrap();
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    let mut engine = engine_with_sections(&dir, &corpus);

    let mut cfg = tracematch::SectionConfig::default();
    cfg.proximity_threshold = 400.0;
    engine.set_section_config(cfg);

    // 75 m north of a known corridor ride: outside the default-derived
    // 50 m tolerance, inside the relaxed 100 m one.
    let base = &corpus.bucket_c_single;
    let mut shifted = base.gps_points.clone();
    for p in &mut shifted {
        p.latitude += 75.0 / 111_320.0;
    }
    engine
        .add_activity("shifted".into(), shifted, base.sport_type.clone())
        .unwrap();

    let summary = engine.attach_new_activities(&["shifted".to_string()]);
    assert!(
        summary.inserted_portions > 0,
        "a 75 m-offset track failed to attach under a 400 m proximity setting"
    );
}
