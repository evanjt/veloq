//! An exclusion is a user decision on a junction row. Every editing path
//! that rebuilds a section's junction rows must carry the flag across, and
//! every read that serves cached results must drop them when the flag
//! moves, or exclude quietly stops meaning anything.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::{ActivityMetrics, PersistentEngine};

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
fn engine_with_excludable(dir: &TempDir) -> (PersistentEngine, String, String) {
    let corpus = corpus();
    let path = dir.path().join("exclusion.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
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
    let handle = engine.detect_sections_background();
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

fn excluded(engine: &PersistentEngine, section_id: &str) -> Vec<String> {
    engine.get_excluded_activity_ids(section_id)
}

/// An engine whose detected catalogue includes a member with several laps
/// on one section, plus that section's id and the excluded lap's index.
fn engine_with_lapped_member(dir: &TempDir) -> (PersistentEngine, String, u32) {
    let corpus = corpus();
    let path = dir.path().join("exclusion_laps.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .unwrap();
    }
    let base = &corpus.bucket_c_single;
    engine
        .add_activity(
            "act_lapped".to_string(),
            base.lapped(3),
            base.sport_type.clone(),
        )
        .unwrap();
    engine
        .update_activity_metadata("act_lapped", Some(base.start_date_unix), None, None, None)
        .unwrap();
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();

    let candidate_ids: Vec<String> = engine
        .get_sections_for_activity("act_lapped")
        .iter()
        .map(|s| s.id.clone())
        .collect();
    let section = candidate_ids
        .iter()
        .filter_map(|id| engine.get_section_by_id(id))
        .filter(|s| !s.is_user_defined)
        .find(|s| {
            s.activity_portions
                .iter()
                .filter(|p| p.activity_id == "act_lapped")
                .count()
                >= 2
        })
        .expect("a section holding several act_lapped laps");
    let mut starts: Vec<u32> = section
        .activity_portions
        .iter()
        .filter(|p| p.activity_id == "act_lapped")
        .map(|p| p.start_index)
        .collect();
    starts.sort_unstable();
    (engine, section.id.clone(), starts[1])
}

fn lapped_exclusions(engine: &PersistentEngine, section_id: &str) -> Vec<(String, u32)> {
    engine
        .get_excluded_section_laps(section_id)
        .into_iter()
        .filter(|(aid, _)| aid == "act_lapped")
        .collect()
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

/// One excluded lap of a three-lap member must ride across a trim as
/// exactly one excluded lap: not lost, not widened to the whole activity.
#[test]
fn a_per_lap_exclusion_survives_a_trim() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, lap) = engine_with_lapped_member(&dir);
    engine.exclude_section_lap(&sid, "act_lapped", lap).unwrap();
    assert_eq!(lapped_exclusions(&engine, &sid).len(), 1);

    let len = engine.get_section_by_id(&sid).unwrap().polyline.len() as u32;
    engine.trim_section(&sid, 1, len - 2).unwrap();

    assert_eq!(
        lapped_exclusions(&engine, &sid).len(),
        1,
        "the excluded lap must survive the rebuild"
    );
    assert!(
        !excluded(&engine, &sid).contains(&"act_lapped".to_string()),
        "a per-lap exclusion must not widen to the whole activity"
    );
}

/// A re-attach that changes the member's lap count must still carry the
/// exclusion. It lands on the rebuilt traversal nearest the one the user
/// excluded, rather than being dropped because the row count moved.
#[test]
fn a_per_lap_exclusion_survives_a_recut_that_changes_the_lap_count() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, lap) = engine_with_lapped_member(&dir);
    engine.exclude_section_lap(&sid, "act_lapped", lap).unwrap();
    assert_eq!(lapped_exclusions(&engine, &sid).len(), 1);
    let laps = |dir: &TempDir| -> i64 {
        rusqlite::Connection::open(dir.path().join("exclusion_laps.db"))
            .and_then(|db| {
                db.query_row(
                    "SELECT COUNT(*) FROM section_activities WHERE activity_id = 'act_lapped'",
                    [],
                    |r| r.get(0),
                )
            })
            .expect("lap count")
    };
    let before = laps(&dir);

    let corpus = corpus();
    let base = &corpus.bucket_c_single;
    let mut four_passes = base.lapped(3);
    let mut back = base.gps_points.clone();
    back.reverse();
    four_passes.extend(back);
    engine
        .add_activity(
            "act_lapped".to_string(),
            four_passes,
            base.sport_type.clone(),
        )
        .unwrap();
    engine.attach_new_activities(&["act_lapped".to_string()]);

    assert!(
        laps(&dir) != before,
        "the fourth pass left the lap count unchanged, so this proves nothing"
    );
    assert_eq!(
        lapped_exclusions(&engine, &sid).len(),
        1,
        "the excluded lap must ride across a rebuild that changes the lap count"
    );
    assert!(
        !excluded(&engine, &sid).contains(&"act_lapped".to_string()),
        "a per-lap exclusion must not widen to the whole activity"
    );
}

/// Re-attaching an activity (sync re-index) rewrites its junction rows;
/// the exclusion is a user decision and must ride across.
#[test]
fn an_exclusion_survives_a_reattach() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);
    engine.exclude_activity_from_section(&sid, &member).unwrap();

    engine.attach_new_activities(&[member.clone()]);

    assert_eq!(
        excluded(&engine, &sid),
        vec![member],
        "the attach path silently dropped the exclusion"
    );
}

/// Same for a single excluded lap: the re-attach keeps it a per-lap state.
#[test]
fn a_per_lap_exclusion_survives_a_reattach() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, lap) = engine_with_lapped_member(&dir);
    engine.exclude_section_lap(&sid, "act_lapped", lap).unwrap();

    engine.attach_new_activities(&["act_lapped".to_string()]);

    assert_eq!(
        lapped_exclusions(&engine, &sid).len(),
        1,
        "the excluded lap must survive the re-attach"
    );
    assert!(
        !excluded(&engine, &sid).contains(&"act_lapped".to_string()),
        "a per-lap exclusion must not widen to the whole activity"
    );
}

/// A re-detect over the same activity set keeps section ids stable, so it
/// must keep their exclusions too. The catalogue save may not treat the
/// junction rows as disposable.
#[test]
fn an_exclusion_survives_a_redetect() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);
    engine.exclude_activity_from_section(&sid, &member).unwrap();

    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();

    assert_eq!(
        excluded(&engine, &sid),
        vec![member],
        "the catalogue save dropped the exclusion"
    );
}

/// Per-lap state must also ride across a re-detect of the same set.
#[test]
fn a_per_lap_exclusion_survives_a_redetect() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, lap) = engine_with_lapped_member(&dir);
    engine.exclude_section_lap(&sid, "act_lapped", lap).unwrap();

    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();

    assert_eq!(
        lapped_exclusions(&engine, &sid).len(),
        1,
        "the excluded lap must survive the re-detect"
    );
    assert!(
        !excluded(&engine, &sid).contains(&"act_lapped".to_string()),
        "a per-lap exclusion must not widen to the whole activity"
    );
}

/// The two editing paths without exclusion coverage: expand and reference
/// change both rebuild junction rows and must carry the flag. The expand
/// stays within the ground the members run: a line stretched past what a
/// member covers drops that member on the detector's own rule, and a row
/// that no longer exists carries nothing.
#[test]
fn an_exclusion_survives_an_expand() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);
    engine.exclude_activity_from_section(&sid, &member).unwrap();

    let section = engine.get_section_by_id(&sid).unwrap();
    let anchor = section.representative_activity_id.clone();
    let track = engine.get_gps_track(&anchor).expect("anchor track");
    let config = engine.get_section_config();
    let on_anchor = tracematch::track_portions(&anchor, &track, &section.polyline, &config);
    let (start, end) = on_anchor
        .iter()
        .map(|p| (p.start_index, p.end_index))
        .next()
        .expect("the anchor runs its own line");
    let grow = (end - start) / 10;
    let start = start.saturating_sub(grow);
    let end = (end + grow).min(track.len() as u32 - 1);
    engine
        .expand_section_bounds(&sid, &anchor, start, end)
        .unwrap();

    assert_eq!(
        excluded(&engine, &sid),
        vec![member],
        "expanding bounds must not forget exclusions"
    );
}

#[test]
fn an_exclusion_survives_a_reference_change() {
    let dir = TempDir::new().unwrap();
    let (mut engine, sid, member) = engine_with_excludable(&dir);

    let section = engine.get_section_by_id(&sid).unwrap();
    let other = section
        .activity_ids
        .iter()
        .find(|a| **a != member)
        .cloned()
        .expect("a second member to take the reference");
    engine.exclude_activity_from_section(&sid, &member).unwrap();

    engine.set_section_reference(&sid, &other).unwrap();

    assert_eq!(
        excluded(&engine, &sid),
        vec![member],
        "changing the reference must not forget exclusions"
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
