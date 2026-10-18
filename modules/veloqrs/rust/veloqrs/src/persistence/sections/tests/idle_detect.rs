//! A detect with nothing new is no step for the debounce.
//!
//! The debounce counts arrivals. A detect that finds every activity already
//! processed and no cluster owing a recompute has no evidence to offer, so it
//! must leave the visible catalogue, the pending ledger and the registry as
//! the last ingest left them. A run of idle syncs would otherwise confirm a
//! change one ride began to make until it fired.

use std::collections::HashMap;

use rusqlite::params;
use tempfile::TempDir;
use tracematch::{FrequentSection, GpsPoint};

use crate::persistence::{PersistentEngine, codec};

/// A line of `n` points running north from `lat`, about 11 m apart.
fn line_at(lat: f64, n: u32) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| GpsPoint::new(lat + f64::from(i) * 0.000_1, 7.0))
        .collect()
}

/// The ground the first ingest holds.
fn orchard() -> Vec<GpsPoint> {
    line_at(46.0, 40)
}

/// Ground well away from it, which the second ingest cuts alone.
fn quarry() -> Vec<GpsPoint> {
    line_at(46.5, 40)
}

/// A raw detection cut on `line`, every member riding the whole of it.
fn cut(line: Vec<GpsPoint>, members: &[&str]) -> FrequentSection {
    let distance = tracematch::matching::calculate_route_distance(&line);
    FrequentSection {
        id: "raw".to_string(),
        name: None,
        sport_type: "Ride".to_string(),
        distance_meters: distance,
        point_density: vec![members.len() as u32; line.len()],
        representative_activity_id: members[0].to_string(),
        representative_range: Some((0, line.len() as u32 - 1)),
        activity_ids: members.iter().map(|m| m.to_string()).collect(),
        visit_count: members.len() as u32,
        activity_portions: members
            .iter()
            .map(|m| tracematch::SectionPortion {
                activity_id: m.to_string(),
                start_index: 0,
                end_index: line.len() as u32 - 1,
                distance_meters: distance,
                direction: tracematch::Direction::Same,
            })
            .collect(),
        polyline: line,
        activity_traces: HashMap::new(),
        confidence: 0.9,
        observation_count: members.len() as u32,
        average_spread: 4.0,
        scale: None,
        is_user_defined: false,
        stability: 1.0,
        elevation_gain_m: None,
        avg_grade_percent: None,
        version: 0,
        updated_at: None,
        created_at: None,
        enrichment: Default::default(),
        rank: None,
    }
}

/// Midnight UTC on a day of 2026, as the store keeps a start date.
const fn day(n: i64) -> i64 {
    1_767_225_600 + n * 86_400
}

fn store(engine: &mut PersistentEngine, id: &str, date: i64, track: Vec<GpsPoint>) {
    engine
        .add_activity(id.into(), track, "Ride".into())
        .expect("add_activity");
    engine
        .update_activity_metadata(id, Some(date), None, None, None)
        .expect("update_activity_metadata");
}

/// Apply `raw` as an ingest's batch and mark every stored activity processed,
/// as a sync does.
fn ingest(engine: &mut PersistentEngine, raw: Vec<FrequentSection>) {
    engine.apply_sections(raw).expect("apply_sections");
    let ids: Vec<String> = engine.activity_metadata.keys().cloned().collect();
    engine
        .save_processed_activity_ids(&ids)
        .expect("save_processed_activity_ids");
}

/// One sync's detect and apply, as the blocking callers run it.
fn redetect(engine: &mut PersistentEngine) {
    let handle = engine.detect_sections_background();
    let (sections, processed) = handle.recv().expect("the detect ran");
    engine.apply_sections(sections).expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
}

/// The id the orchard is held under.
fn orchard_id(engine: &PersistentEngine) -> String {
    engine
        .identity
        .rows
        .values()
        .find(|row| row.section.polyline == orchard())
        .map(|row| row.real_id.clone())
        .expect("the orchard is visible")
}

/// Whether the visible row `real_id` carries an active debounce.
fn pending(engine: &PersistentEngine, real_id: &str) -> bool {
    engine
        .identity
        .rows
        .iter()
        .find(|(_, row)| row.real_id == real_id)
        .is_some_and(|(pid, _)| engine.identity.hysteresis.pending_ids().contains(pid))
}

fn registry_bytes(engine: &PersistentEngine) -> Vec<u8> {
    codec::serialize_named(&engine.identity).expect("encode")
}

/// An engine on `path` whose last ingest began retiring the orchard: two rides
/// formed it, two more arrived on the quarry and their batch cut only the
/// quarry, so the orchard is visible and pending with one confirmation.
fn half_retired(path: &std::path::Path) -> (PersistentEngine, String) {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let held = begin_retiring(&mut engine);
    (engine, held)
}

/// Run the two ingests of `half_retired` on `engine`, returning the orchard's id.
fn begin_retiring(engine: &mut PersistentEngine) -> String {
    store(engine, "orchard-1", day(1), orchard());
    store(engine, "orchard-2", day(2), orchard());
    ingest(engine, vec![cut(orchard(), &["orchard-1", "orchard-2"])]);
    let held = orchard_id(engine);
    assert!(!pending(engine, &held), "the orchard forms settled");

    store(engine, "quarry-1", day(3), quarry());
    store(engine, "quarry-2", day(4), quarry());
    ingest(engine, vec![cut(quarry(), &["quarry-1", "quarry-2"])]);
    assert_eq!(orchard_id(engine), held, "one ingest cannot retire it");
    assert!(
        pending(engine, &held),
        "the quarry ingest began retiring it"
    );
    held
}

fn visible_ids(engine: &PersistentEngine) -> Vec<String> {
    let mut ids: Vec<String> = engine.sections.iter().map(|s| s.id.clone()).collect();
    ids.sort();
    ids
}

/// Scenario: an ingest began retiring a section, and five syncs follow with
/// no new activity.
/// Expected behaviour: none of them steps the debounce, so the section is
/// still visible, still pending, and the registry is byte for byte the one
/// the ingest left.
#[test]
fn idle_syncs_leave_a_pending_retirement_where_the_ingest_left_it() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, held) = half_retired(&dir.path().join("idle.db"));
    let registry = registry_bytes(&engine);
    let visible = visible_ids(&engine);

    for sync in 1..=5 {
        redetect(&mut engine);
        assert_eq!(orchard_id(&engine), held, "dissolved on idle sync {sync}");
        assert!(pending(&engine, &held), "settled on idle sync {sync}");
        assert!(
            registry_bytes(&engine) == registry,
            "idle sync {sync} moved the registry"
        );
        assert_eq!(visible_ids(&engine), visible, "idle sync {sync}");
    }
}

/// Scenario: the same on the run the app starts, which settles itself on its
/// worker thread rather than handing the batch back.
/// Expected behaviour: the worker steps nothing and still reports the run
/// settled.
#[test]
fn idle_syncs_settled_on_the_worker_leave_the_registry_unmoved() {
    use crate::persistence::sections::detection::ApplyOn;
    use crate::persistence::{WorkerApply, with_persistent_engine};

    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("idle-worker.db");
    let (held, registry) = with_persistent_engine(|engine| {
        let held = begin_retiring(engine);
        (held, registry_bytes(engine))
    })
    .expect("engine");

    for sync in 1..=5 {
        let handle = with_persistent_engine(|engine| {
            engine.detect_sections_background_unchecked_applying(ApplyOn::Worker)
        })
        .expect("engine");
        let (state, _) =
            handle.recv_state_with_cache_within(Some(std::time::Duration::from_secs(30)));
        assert!(
            matches!(state, crate::persistence::WorkerPoll::Ready(_)),
            "idle sync {sync} ended"
        );
        assert_eq!(
            handle.worker_apply(),
            WorkerApply::Landed,
            "idle sync {sync}"
        );
        crate::test_globals::wait_for_detection_workers();
        with_persistent_engine(|engine| {
            assert!(pending(engine, &held), "settled on idle sync {sync}");
            assert!(
                registry_bytes(engine) == registry,
                "idle sync {sync} on the worker moved the registry"
            );
        })
        .expect("engine");
    }
}

/// Scenario: the same, after a restart, where no raw batch is held in memory
/// and the idle detect has only the visible catalogue to offer.
/// Expected behaviour: still no step. The visible catalogue holds the
/// retiring section, so stepping it would read as the ground continuing and
/// clear the confirmation the ingest gave.
#[test]
fn idle_syncs_after_a_restart_leave_the_registry_unmoved() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("restart.db");
    let (engine, held) = half_retired(&path);
    drop(engine);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    assert!(pending(&engine, &held), "the ledger survives the restart");
    let registry = registry_bytes(&engine);

    for sync in 1..=5 {
        redetect(&mut engine);
        assert!(pending(&engine, &held), "settled on idle sync {sync}");
        assert!(
            registry_bytes(&engine) == registry,
            "idle sync {sync} after the restart moved the registry"
        );
    }
}

/// Scenario: no activity arrived, but the evidence cache owes a cluster a
/// recompute, so the detect re-folds the pool.
/// Expected behaviour: its batch is new evidence and steps the debounce, so the
/// registry moves where an idle detect would leave it.
#[test]
fn a_detect_owing_a_recompute_still_steps() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, _) = half_retired(&dir.path().join("dirty.db"));
    let digest = super::super::section_config_digest(&engine.section_config);
    engine
        .db
        .execute(
            "INSERT INTO evidence_cache (id, config_digest, folded_ids, cache, updated_at, dirty_clusters)
             VALUES (1, ?1, x'00', x'00', 0, 1)",
            params![digest],
        )
        .expect("owe a recompute");
    // As an open leaves it: the cache on disk, read only when a detect needs it.
    engine.mark_evidence_cache_unrestored();
    let registry = registry_bytes(&engine);

    redetect(&mut engine);

    assert!(
        registry_bytes(&engine) != registry,
        "a detect owing a recompute left the registry where it was"
    );
}
