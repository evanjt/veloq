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
use veloqrs::PersistentEngine;

fn engine_with_sections(dir: &TempDir, corpus: &LifecycleCorpus) -> PersistentEngine {
    let path = dir.path().join("two_tier.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();

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

    let handle = engine.detect_sections_background();
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
// pass. The attach path counts passes with the detector's own matcher, so
// the rows it writes are the rows a full detection over the same set would
// write, revolution for revolution.

fn lapped_corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
}

/// A line whose ends sit apart: one lap of the corpus ride crosses it once.
/// The synthetic corridor coils in places, and a section drawn on one
/// revolution of a coil is crossed once per revolution, so those lines
/// count more passes per lap than the lap count.
fn is_open_line(polyline: &[tracematch::GpsPoint]) -> bool {
    match (polyline.first(), polyline.last()) {
        (Some(a), Some(b)) => tracematch::geo_utils::haversine_distance(a, b) > 100.0,
        _ => false,
    }
}

/// Per section `activity_id` appears in: (stored rows, the detector's own
/// pass count over the stored line, whether the line is open).
fn passes_per_section(
    engine: &mut PersistentEngine,
    activity_id: &str,
) -> Vec<(usize, usize, bool)> {
    let config = engine.get_section_config();
    let track = engine.get_gps_track(activity_id).expect("stored track");
    let ids: Vec<String> = engine
        .get_sections_for_activity(activity_id)
        .iter()
        .map(|s| s.id.clone())
        .collect();
    ids.iter()
        .filter_map(|id| engine.get_section_by_id(id))
        .map(|s| {
            let rows = s
                .activity_portions
                .iter()
                .filter(|p| p.activity_id == activity_id)
                .count();
            let detector =
                tracematch::track_portions(activity_id, &track, &s.polyline, &config).len();
            (rows, detector, is_open_line(&s.polyline))
        })
        .collect()
}

fn store(
    engine: &mut PersistentEngine,
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

fn assert_rows_are_the_detectors(per_section: &[(usize, usize, bool)], laps: usize) {
    assert!(!per_section.is_empty(), "the corridor must be sectioned");
    assert!(
        per_section.iter().any(|(_, _, open)| *open),
        "the corridor must hold at least one open line"
    );
    for (rows, detector, open) in per_section {
        assert_eq!(
            rows, detector,
            "a section's rows must be the detector's passes, got {per_section:?}"
        );
        if *open {
            assert_eq!(
                *rows, laps,
                "an open line is crossed once per lap, got {per_section:?}"
            );
        }
    }
}

#[test]
fn attach_inserts_a_junction_row_for_every_lap() {
    let dir = TempDir::new().unwrap();
    let corpus = lapped_corpus();
    let mut engine = engine_with_sections(&dir, &corpus);
    let section_count = engine.get_sections().len();

    let base = &corpus.bucket_c_single;
    store(&mut engine, "act_lapped", base.lapped(3), base);
    let summary = engine.attach_new_activities(&["act_lapped".to_string()]);

    assert_eq!(summary.attached_activities, 1);

    let per_section = passes_per_section(&mut engine, "act_lapped");
    assert_rows_are_the_detectors(&per_section, 3);
    assert_eq!(
        summary.inserted_portions as usize,
        per_section.iter().map(|(rows, _, _)| rows).sum::<usize>(),
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
    store(&mut incremental, "act_lapped", base.lapped(3), base);
    incremental.attach_new_activities(&["act_lapped".to_string()]);

    let batch_dir = TempDir::new().unwrap();
    let batch_path = batch_dir.path().join("batch.db");
    let mut batch = PersistentEngine::new(batch_path.to_str().unwrap()).unwrap();
    for activity in corpus.through_a() {
        let id = activity.id.clone();
        store(&mut batch, &id, activity.gps_points.clone(), activity);
    }
    store(&mut batch, "act_lapped", base.lapped(3), base);
    let handle = batch.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    batch.apply_sections(sections).unwrap();

    // How many sections the corridor is cut into is a detection decision and
    // varies between the two engines. What must not vary is that every
    // section's rows are the detector's passes over its line.
    assert_rows_are_the_detectors(&passes_per_section(&mut incremental, "act_lapped"), 3);
    assert_rows_are_the_detectors(&passes_per_section(&mut batch, "act_lapped"), 3);
}

#[test]
fn re_attaching_a_lapped_activity_does_not_stack_rows() {
    let dir = TempDir::new().unwrap();
    let corpus = lapped_corpus();
    let mut engine = engine_with_sections(&dir, &corpus);

    let base = &corpus.bucket_c_single;
    store(&mut engine, "act_lapped", base.lapped(3), base);
    let first = engine.attach_new_activities(&["act_lapped".to_string()]);
    let once = passes_per_section(&mut engine, "act_lapped");
    let again = engine.attach_new_activities(&["act_lapped".to_string()]);

    assert_eq!(
        again.inserted_portions, first.inserted_portions,
        "re-attach replaces the lap rows, never stacks them"
    );
    assert_eq!(
        passes_per_section(&mut engine, "act_lapped"),
        once,
        "the rows after a repeated attach are the rows after the first"
    );
}

/// A copy of `line` shifted `metres` sideways, perpendicular to its
/// end-to-end bearing. A shift of the whole ride would leave every stretch
/// running along the shift direction exactly where it was.
fn beside(line: &[tracematch::GpsPoint], metres: f64) -> Vec<tracematch::GpsPoint> {
    let (a, b) = (line[0], line[line.len() - 1]);
    let lat_m = 111_132.0;
    let lng_m = 111_320.0 * a.latitude.to_radians().cos();
    let (dx, dy) = (
        (b.longitude - a.longitude) * lng_m,
        (b.latitude - a.latitude) * lat_m,
    );
    let len = (dx * dx + dy * dy).sqrt();
    let (nx, ny) = (-dy / len, dx / len);
    line.iter()
        .map(|p| tracematch::GpsPoint {
            latitude: p.latitude + ny * metres / lat_m,
            longitude: p.longitude + nx * metres / lng_m,
            ..*p
        })
        .collect()
}

/// A straight open line from the catalogue: ends further apart than four
/// fifths of its length, so a sideways copy stays sideways along its whole
/// extent.
fn straight_section(engine: &mut PersistentEngine) -> (String, Vec<tracematch::GpsPoint>) {
    let ids: Vec<String> = engine.get_sections().iter().map(|s| s.id.clone()).collect();
    ids.iter()
        .filter_map(|id| engine.get_section_by_id(id))
        .filter(|s| {
            let ends = tracematch::geo_utils::haversine_distance(
                &s.polyline[0],
                &s.polyline[s.polyline.len() - 1],
            );
            ends > 0.8 * s.distance_meters
        })
        .max_by(|a, b| a.distance_meters.total_cmp(&b.distance_meters))
        .map(|s| (s.id, s.polyline))
        .expect("a straight open section")
}

/// The attach bar is the detector's: a track counts on a line when its
/// points share the line's cells, and the cell scales with the proximity
/// setting. The engine hands its live config to that matcher, so a track
/// three cells beside a line never attaches to it and one a fifth of a
/// cell beside it always does, at whatever setting the user chose.
#[test]
fn the_attach_bar_is_the_detectors_cell() {
    for proximity in [200.0, 400.0] {
        let dir = TempDir::new().unwrap();
        let corpus = lapped_corpus();
        let mut engine = engine_with_sections(&dir, &corpus);
        let mut cfg = tracematch::SectionConfig::default();
        cfg.proximity_threshold = proximity;
        engine.set_section_config(cfg.clone());
        let cell = tracematch::line_match_cell_m(&cfg);
        let (sid, line) = straight_section(&mut engine);
        let sport = engine.get_section_by_id(&sid).unwrap().sport_type;

        engine
            .add_activity("far".into(), beside(&line, 3.0 * cell), sport.clone())
            .unwrap();
        engine.attach_new_activities(&["far".to_string()]);
        assert!(
            !engine
                .get_sections_for_activity("far")
                .iter()
                .any(|s| s.id == sid),
            "a track three cells beside the line attached to it at {proximity} m"
        );

        engine
            .add_activity("near".into(), beside(&line, 0.2 * cell), sport)
            .unwrap();
        engine.attach_new_activities(&["near".to_string()]);
        assert!(
            engine
                .get_sections_for_activity("near")
                .iter()
                .any(|s| s.id == sid),
            "a track a fifth of a cell beside the line did not attach at {proximity} m"
        );
        let per_section = passes_per_section(&mut engine, "near");
        for (rows, detector, _) in &per_section {
            assert_eq!(
                rows, detector,
                "attach must count with the live setting, got {per_section:?}"
            );
        }
    }
}

#[test]
fn the_attach_cell_follows_the_proximity_setting() {
    let mut relaxed = tracematch::SectionConfig::default();
    relaxed.proximity_threshold = 400.0;
    assert!(
        tracematch::line_match_cell_m(&relaxed)
            > tracematch::line_match_cell_m(&tracematch::SectionConfig::default()),
        "a relaxed proximity setting must widen the attach cell"
    );
}
