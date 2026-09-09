//! The detector-change half of the ledger: `algorithm_changed` and
//! `superseded`.
//!
//! The change is driven off the generation marker stored beside the catalogue
//! (detection method plus config digest), not off a settings call, because the
//! two real flip cases never touch settings: one user's persisted config
//! overwrites the new default, the other picks it up silently at load.
//!
//! The old shape has to be kept before the new cut lands, so every event pins
//! the outgoing geometry as a milestone. Without that there is no "before" to
//! put beside the "after".

mod migration_support;

use migration_support::seed_at_version;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::sections::DetectorGeneration;

const SID: &str = "s_1700000000000__ab12cd34";

fn poly(seed: u32) -> Vec<GpsPoint> {
    let dec = |v: f64| -> f64 { format!("{v:.6}").parse().unwrap() };
    (0..20)
        .map(|i| GpsPoint {
            latitude: dec(40.0 + f64::from(seed) * 0.001 + f64::from(i) * 0.000_09),
            longitude: dec(5.0 + f64::from(i) * 0.000_11),
            elevation: None,
        })
        .collect()
}

fn engine_at(path: &Path) -> PersistentEngine {
    PersistentEngine::new(path.to_str().unwrap()).expect("open engine")
}

fn fresh() -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine_at(&dir.path().join("routes.db"));
    (engine, dir)
}

/// Write the marker a save would leave, without running one.
fn stamp_generation(dir: &TempDir, method: &str, digest: &str) {
    let conn = Connection::open(dir.path().join("routes.db")).expect("open second connection");
    for (key, value) in [
        ("catalogue_detection_method", method),
        ("catalogue_config_digest", digest),
    ] {
        conn.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
            rusqlite::params![key, value],
        )
        .expect("stamp marker");
    }
}

/// A plain auto row, the kind a detect wipes and re-cuts.
fn insert_auto_section(path: &Path, id: &str) {
    let points: Vec<serde_json::Value> = poly(0)
        .into_iter()
        .map(|p| {
            serde_json::json!({
                "latitude": p.latitude,
                "longitude": p.longitude,
                "elevation": serde_json::Value::Null,
            })
        })
        .collect();
    let conn = Connection::open(path).expect("open second connection");
    conn.execute(
        "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
         VALUES (?, 'auto', 'Ride', ?, 1000.0)",
        rusqlite::params![id, serde_json::to_string(&points).unwrap()],
    )
    .expect("insert section");
}

fn generation(method: &str, digest: &str) -> DetectorGeneration {
    DetectorGeneration {
        method: method.to_string(),
        digest: digest.to_string(),
    }
}

fn kinds_of(engine: &PersistentEngine, sid: &str) -> Vec<String> {
    engine
        .section_history(sid)
        .into_iter()
        .map(|e| e.kind)
        .collect()
}

/// Scenario: a fresh install, which is the only case with no prior generation.
/// Expected behaviour: no change, and the marker is genuinely absent rather
/// than agreeing by accident with whatever the live config happens to be.
#[test]
fn an_unsaved_catalogue_reports_no_generation_change() {
    let (mut engine, dir) = fresh();
    engine.set_section_config(engine.get_section_config());

    let conn = Connection::open(dir.path().join("routes.db")).expect("open second connection");
    let marked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_info
             WHERE key IN ('catalogue_detection_method', 'catalogue_config_digest')",
            [],
            |row| row.get(0),
        )
        .expect("count markers");
    assert_eq!(marked, 0, "an empty catalogue was cut by nothing");
    assert!(engine.detector_generation_change().is_none());
}

/// Scenario: the flip release reaching a live user, whose catalogue predates
/// the generation marker entirely.
/// Expected behaviour: the upgrade names the detector that cut it, so the
/// first detect under Unified explains the sections it replaces.
#[test]
fn a_migrated_catalogue_explains_its_first_detect() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    drop(seed_at_version(&path, 12));
    insert_auto_section(&path, "s_legacy");

    let mut engine = engine_at(&path);
    engine.set_section_config(engine.get_section_config());
    engine.apply_sections_save(Vec::new()).expect("flip save");

    let changed = engine
        .section_history("s_legacy")
        .into_iter()
        .find(|e| e.kind == "algorithm_changed")
        .expect("a migrating catalogue must explain the detector that replaced it");
    let details: serde_json::Value =
        serde_json::from_str(changed.details.as_deref().unwrap()).unwrap();
    assert_eq!(details["from_method"], "corridor");
    assert_eq!(details["to_method"], "unified");
    assert!(
        changed.geometry_version.is_some(),
        "the shape the flip replaced has to be readable afterwards"
    );
}

/// A line long enough that the section below is an interior portion of it.
fn ride_track() -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 40.0 + f64::from(i) * 0.000_09,
            longitude: 5.0 + f64::from(i) * 0.000_11,
            elevation: None,
        })
        .collect()
}

/// A pre-ledger catalogue holding one auto section that one ride traverses,
/// so a mutation save has something real to re-cut.
fn seed_traversed_legacy_section(path: &Path) {
    drop(seed_at_version(path, 12));
    let track = ride_track();
    let points: Vec<serde_json::Value> = track[20..40]
        .iter()
        .map(|p| {
            serde_json::json!({
                "latitude": p.latitude,
                "longitude": p.longitude,
                "elevation": serde_json::Value::Null,
            })
        })
        .collect();
    let conn = Connection::open(path).expect("open second connection");
    conn.execute(
        "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
         VALUES ('s_legacy', 'auto', 'Ride', ?, 250.0)",
        rusqlite::params![serde_json::to_string(&points).unwrap()],
    )
    .expect("insert section");
    drop(conn);

    let mut engine = engine_at(path);
    engine
        .add_activity("a1".to_string(), track, "Ride".to_string())
        .expect("store ride");
    drop(engine);

    let conn = Connection::open(path).expect("open second connection");
    conn.execute(
        "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
         VALUES ('s_legacy', 'a1', 20, 39)",
        [],
    )
    .expect("insert junction row");
}

/// Scenario: the generation changes, then a mutation saves the catalogue
/// before any detect runs. `recalculate_section_polyline` does exactly this.
/// Expected behaviour: the capture is one-shot and irreplaceable, so an
/// ordinary save must not consume it.
#[test]
fn a_save_between_the_change_and_the_detect_keeps_the_capture() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    seed_traversed_legacy_section(&path);

    let mut engine = engine_at(&path);
    engine.load().expect("load catalogue");
    engine.set_section_config(engine.get_section_config());
    assert!(
        engine.recalculate_section_polyline("s_legacy").is_some(),
        "the mutation must actually reach a save, or this test proves nothing"
    );
    assert_eq!(
        kinds_of(&engine, "s_legacy"),
        vec!["baseline"],
        "a mutation re-cuts nothing, so it explains nothing"
    );

    engine.apply_sections_save(Vec::new()).expect("flip save");
    assert!(
        kinds_of(&engine, "s_legacy")
            .iter()
            .any(|k| k == "algorithm_changed"),
        "the mutation save consumed the marker and the flip went unexplained"
    );
}

#[test]
fn a_matching_marker_reports_no_generation_change() {
    let (mut engine, dir) = fresh();
    engine.set_section_config(engine.get_section_config());
    let live = engine.get_section_config();
    stamp_generation(
        &dir,
        veloqrs::persistence::sections::DETECTOR_METHOD,
        &veloqrs::persistence::sections::section_config_digest(&live),
    );
    assert!(engine.detector_generation_change().is_none());
}

#[test]
fn a_different_method_in_the_marker_is_a_generation_change() {
    let (mut engine, dir) = fresh();
    let cfg = engine.get_section_config();
    engine.set_section_config(cfg.clone());
    stamp_generation(&dir, "corridor", "0000000000000000");

    let (from, to) = engine
        .detector_generation_change()
        .expect("corridor marker against a unified config is a change");
    assert_eq!(from.method, "corridor");
    assert_eq!(to.method, veloqrs::persistence::sections::DETECTOR_METHOD);
    assert_eq!(
        to.digest,
        veloqrs::persistence::sections::section_config_digest(&cfg)
    );
}

/// Expected behaviour: the shape the outgoing detector left is milestoned and
/// the event points at it, so a prior-versus-current overlay has a prior.
#[test]
fn the_event_milestones_the_shape_already_stored() {
    let (mut engine, _dir) = fresh();
    engine
        .record_section_geometry(SID, &poly(0), false, None)
        .unwrap();
    engine
        .record_section_geometry(SID, &poly(1), false, None)
        .unwrap();

    engine
        .record_section_algorithm_change(
            SID,
            None,
            Some(&generation("corridor", "aaaa")),
            &generation("unified", "bbbb"),
        )
        .unwrap();

    let versions = engine.section_geometry_versions(SID);
    assert_eq!(
        versions.len(),
        2,
        "no new version is cut by the event itself"
    );
    assert!(
        versions.iter().find(|v| v.version == 2).unwrap().milestone,
        "the newest stored shape is the one about to be replaced"
    );
    assert!(!versions.iter().find(|v| v.version == 1).unwrap().milestone);

    let events = engine.section_history(SID);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "algorithm_changed");
    assert_eq!(events[0].geometry_version, Some(2));

    let details: serde_json::Value =
        serde_json::from_str(events[0].details.as_deref().unwrap()).expect("details is JSON");
    assert_eq!(details["from_method"], "corridor");
    assert_eq!(details["to_method"], "unified");
    assert_eq!(details["config_digest_from"], "aaaa");
    assert_eq!(details["config_digest_to"], "bbbb");
    assert_eq!(details["prior_version"], 2);
}

/// Scenario: a section carrying no versions at all, which is every section on a
/// database that never ran the baseline seed.
/// Expected behaviour: the line handed in becomes the milestone, so the event
/// still has a before.
#[test]
fn a_section_with_no_versions_stores_the_line_it_is_given() {
    let (mut engine, _dir) = fresh();
    let prior = poly(3);
    engine
        .record_section_algorithm_change(SID, Some(&prior), None, &generation("unified", "bbbb"))
        .unwrap();

    let versions = engine.section_geometry_versions(SID);
    assert_eq!(versions.len(), 1);
    assert!(versions[0].milestone);
    assert_eq!(engine.section_geometry_polyline(SID, 1).unwrap(), prior);
    assert_eq!(engine.section_history(SID)[0].geometry_version, Some(1));
}

/// Scenario: a section that drifted without an event, which is what carrying a
/// batch geometry forward does. The newest stored version is not the line the
/// section holds.
/// Expected behaviour: the line handed in is stored as a new milestone, so the
/// overlay's "before" is the shape actually being replaced.
#[test]
fn a_stale_newest_version_does_not_stand_in_for_the_current_line() {
    let (mut engine, _dir) = fresh();
    engine
        .record_section_geometry(SID, &poly(0), false, None)
        .unwrap();
    engine
        .record_section_geometry(SID, &poly(1), false, None)
        .unwrap();
    let current = poly(7);

    engine
        .record_section_algorithm_change(
            SID,
            Some(&current),
            Some(&generation("corridor", "aaaa")),
            &generation("unified", "bbbb"),
        )
        .unwrap();

    let versions = engine.section_geometry_versions(SID);
    assert_eq!(versions.len(), 3, "the drifted line is versioned, not lost");
    assert!(versions.iter().find(|v| v.version == 3).unwrap().milestone);
    assert!(
        !versions.iter().find(|v| v.version == 2).unwrap().milestone,
        "version 2 is not what the section carried, so it is not the before"
    );
    assert_eq!(engine.section_geometry_polyline(SID, 3).unwrap(), current);
    assert_eq!(engine.section_history(SID)[0].geometry_version, Some(3));
}

/// Expected behaviour: a prior that the newest version already holds needs no
/// duplicate, so the stored row is simply flagged.
#[test]
fn a_current_line_already_stored_is_milestoned_in_place() {
    let (mut engine, _dir) = fresh();
    engine
        .record_section_geometry(SID, &poly(0), false, None)
        .unwrap();
    engine
        .record_section_geometry(SID, &poly(1), false, None)
        .unwrap();

    engine
        .record_section_algorithm_change(SID, Some(&poly(1)), None, &generation("unified", "bbbb"))
        .unwrap();

    let versions = engine.section_geometry_versions(SID);
    assert_eq!(versions.len(), 2);
    assert!(versions.iter().find(|v| v.version == 2).unwrap().milestone);
}

/// Expected behaviour: retention keeps the milestone, so the shape a user is
/// told about is still readable years of detects later.
#[test]
fn the_milestoned_shape_survives_retention() {
    let (mut engine, _dir) = fresh();
    for seed in 0..4 {
        engine
            .record_section_geometry(SID, &poly(seed), false, None)
            .unwrap();
    }
    let kept = poly(3);
    engine
        .record_section_algorithm_change(SID, None, None, &generation("unified", "bbbb"))
        .unwrap();
    for seed in 10..16 {
        engine
            .record_section_geometry(SID, &poly(seed), false, None)
            .unwrap();
    }

    assert_eq!(engine.section_geometry_polyline(SID, 4).unwrap(), kept);
}

/// Scenario: a catalogue cut under one detector, then a detect under another.
/// Expected behaviour: the save that replaces those lines explains itself
/// first, once, and the next save under the same detector adds nothing.
#[test]
fn a_detect_under_a_new_generation_explains_the_catalogue_it_replaces() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    {
        let mut engine = engine_at(&path);
        engine.apply_sections_save(Vec::new()).expect("first save");
    }
    insert_auto_section(&path, "s_ghost");
    stamp_generation(&dir, "corridor", "0000000000000000");

    let mut engine = engine_at(&path);
    engine.apply_sections_save(Vec::new()).expect("flip save");

    assert_eq!(kinds_of(&engine, "s_ghost"), vec!["algorithm_changed"]);
    let versions = engine.section_geometry_versions("s_ghost");
    assert_eq!(versions.len(), 1, "the outgoing shape is kept, once");
    assert!(
        versions[0].milestone,
        "the shape the flip replaced has to outlive retention"
    );

    let details: serde_json::Value = serde_json::from_str(
        engine.section_history("s_ghost")[0]
            .details
            .as_deref()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(details["from_method"], "corridor");
    assert_eq!(details["to_method"], "unified");

    engine
        .apply_sections_save(Vec::new())
        .expect("settled save");
    assert_eq!(
        kinds_of(&engine, "s_ghost").len(),
        1,
        "the marker now agrees with the live config, so nothing changed"
    );
}

#[test]
fn superseded_is_written_on_both_ids() {
    let (mut engine, _dir) = fresh();
    engine
        .record_section_superseded(SID, "s_new", Some(0.42))
        .unwrap();

    assert_eq!(kinds_of(&engine, SID), vec!["superseded"]);
    assert_eq!(kinds_of(&engine, "s_new"), vec!["superseded"]);

    let old: serde_json::Value =
        serde_json::from_str(engine.section_history(SID)[0].details.as_deref().unwrap()).unwrap();
    assert_eq!(old["superseded_by"], "s_new");
    assert_eq!(old["overlap_fraction"], 0.42);

    let new: serde_json::Value = serde_json::from_str(
        engine.section_history("s_new")[0]
            .details
            .as_deref()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(new["supersedes"], SID);
}

/// Scenario: the ledger outlives the catalogue, so a retired id keeps its rows
/// after every trace of its section is gone.
#[test]
fn superseded_rows_survive_a_reopen() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    {
        let mut engine = engine_at(&path);
        engine
            .record_section_superseded(SID, "s_new", None)
            .unwrap();
    }
    let engine = engine_at(&path);
    assert_eq!(kinds_of(&engine, SID), vec!["superseded"]);
}
