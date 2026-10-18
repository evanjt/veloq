//! A library carried over from an earlier matcher revision.
//!
//! Its signatures were built by the earlier code and its routes paired by it,
//! and no route grouping setting moved, so only the revision says they are
//! stale. The first regroup after the upgrade rebuilds every stored signature
//! from its stored track and groups the whole library again. A library already
//! at the revision keeps both and stays on the incremental path.

use rusqlite::params;
use tempfile::TempDir;
use tracematch::{GpsPoint, RouteSignature};

use super::{GROUPS_MATCH_RULE_KEY, SIGNATURES_MATCHER_REVISION_KEY, match_rule_digest_at};
use crate::persistence::PersistentEngine;
use crate::persistence::regroup::{GroupSave, recompute_and_save_groups};

/// A ride of about 10 km due north from `latitude`.
fn ride(latitude: f64, longitude: f64) -> Vec<GpsPoint> {
    (0..400)
        .map(|i| GpsPoint::new(latitude + f64::from(i) * 0.000225, longitude))
        .collect()
}

const ORCHARD: (f64, f64) = (45.0, 6.0);
const QUARRY: (f64, f64) = (45.5, 6.5);

fn open_loaded(path: &str) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path).unwrap();
    engine.load().unwrap();
    engine
}

fn stored_end_point(engine: &PersistentEngine, id: &str) -> GpsPoint {
    engine
        .db
        .query_row(
            "SELECT end_point_lat, end_point_lng FROM signatures WHERE activity_id = ?",
            params![id],
            |row| Ok(GpsPoint::new(row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

fn same_place(a: GpsPoint, b: GpsPoint) -> bool {
    (a.latitude - b.latitude).abs() < 1e-9 && (a.longitude - b.longitude).abs() < 1e-9
}

fn route_of(groups: &[tracematch::RouteGroup], id: &str) -> Option<String> {
    groups
        .iter()
        .find(|group| group.activity_ids.iter().any(|member| member == id))
        .map(|group| group.group_id.clone())
}

/// Two recordings of one ride stored as two routes, the first one's signature
/// stopping 3 km short of its finish as an earlier build would have left it.
fn split_library(path: &str) {
    let track = ride(ORCHARD.0, ORCHARD.1);
    let mut engine = open_loaded(path);
    engine
        .add_activity("orchard-first".into(), track.clone(), "Ride".into())
        .unwrap();
    assert_eq!(engine.get_groups().len(), 1);

    let short =
        RouteSignature::from_points("orchard-first", &track[..280], &engine.match_config).unwrap();
    engine.store_signature("orchard-first", &short).unwrap();
    engine.signature_cache.clear();

    engine
        .add_activity("orchard-again".into(), track, "Ride".into())
        .unwrap();
    let groups = engine.get_groups().to_vec();
    assert_ne!(
        route_of(&groups, "orchard-first"),
        route_of(&groups, "orchard-again"),
        "the short signature keeps the two recordings apart"
    );
}

/// Mark the library as written by a build from before the revision existed,
/// with its groups stamped under the rule of that time or, older still, with
/// no stamp at all.
fn stamp_as_earlier_build(path: &str, groups_stamped: bool) {
    let engine = PersistentEngine::new(path).unwrap();
    engine
        .db
        .execute(
            "DELETE FROM schema_info WHERE key = ?",
            params![GROUPS_MATCH_RULE_KEY],
        )
        .unwrap();
    if groups_stamped {
        engine
            .db
            .execute(
                "INSERT INTO schema_info (key, value) VALUES (?, ?)",
                params![
                    GROUPS_MATCH_RULE_KEY,
                    match_rule_digest_at(&engine.match_config, 0)
                ],
            )
            .unwrap();
    }
    engine
        .db
        .execute(
            "DELETE FROM schema_info WHERE key = ?",
            params![SIGNATURES_MATCHER_REVISION_KEY],
        )
        .unwrap();
}

fn signatures_revision(engine: &PersistentEngine) -> Option<String> {
    engine
        .db
        .query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![SIGNATURES_MATCHER_REVISION_KEY],
            |row| row.get(0),
        )
        .ok()
}

#[test]
fn an_upgraded_library_rebuilds_its_signatures_and_regroups_in_full() {
    upgraded_library_regroups_in_full(true);
}

#[test]
fn a_library_from_before_the_rule_stamp_rebuilds_and_regroups_in_full() {
    upgraded_library_regroups_in_full(false);
}

fn upgraded_library_regroups_in_full(groups_stamped: bool) {
    let _serial = crate::test_globals::serial_global_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();
    split_library(path);
    stamp_as_earlier_build(path, groups_stamped);

    let mut engine = open_loaded(path);
    engine
        .add_activity("quarry".into(), ride(QUARRY.0, QUARRY.1), "Ride".into())
        .unwrap();
    let groups = engine.get_groups().to_vec();

    let finish = *ride(ORCHARD.0, ORCHARD.1).last().unwrap();
    assert!(
        same_place(stored_end_point(&engine, "orchard-first"), finish),
        "the stored signature is rebuilt to end at the track's finish"
    );
    assert!(route_of(&groups, "orchard-first").is_some());
    assert_eq!(
        route_of(&groups, "orchard-first"),
        route_of(&groups, "orchard-again"),
        "the two recordings are one route once the library is grouped again"
    );
    assert_ne!(
        route_of(&groups, "quarry"),
        route_of(&groups, "orchard-first")
    );
    assert_eq!(
        signatures_revision(&engine).as_deref(),
        Some(super::ROUTE_MATCHER_REVISION.to_string().as_str())
    );
}

#[test]
fn an_upgraded_library_regrouped_in_the_background_is_rebuilt_first() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();
    split_library(path);
    stamp_as_earlier_build(path, true);

    let mut engine = open_loaded(path);
    engine
        .add_activity("quarry".into(), ride(QUARRY.0, QUARRY.1), "Ride".into())
        .unwrap();
    let (groups, save) = recompute_and_save_groups(
        &engine.db,
        crate::persistence::engine_install(),
        &engine.match_config.clone(),
        &engine.groups,
        engine.group_generation,
        &engine.moved_tracks.keys().cloned().collect(),
    );

    assert_eq!(save, GroupSave::Committed);
    let finish = *ride(ORCHARD.0, ORCHARD.1).last().unwrap();
    assert!(same_place(
        stored_end_point(&engine, "orchard-first"),
        finish
    ));
    assert!(route_of(&groups, "orchard-first").is_some());
    assert_eq!(
        route_of(&groups, "orchard-first"),
        route_of(&groups, "orchard-again")
    );
}

#[test]
fn a_library_at_the_revision_keeps_its_signatures_and_regroups_incrementally() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();
    split_library(path);
    let short_end = {
        let engine = PersistentEngine::new(path).unwrap();
        stored_end_point(&engine, "orchard-first")
    };

    let mut engine = open_loaded(path);
    engine
        .add_activity("quarry".into(), ride(QUARRY.0, QUARRY.1), "Ride".into())
        .unwrap();
    let groups = engine.get_groups().to_vec();

    assert!(
        same_place(stored_end_point(&engine, "orchard-first"), short_end),
        "a signature made at the current revision is not rewritten"
    );
    assert!(route_of(&groups, "quarry").is_some());
    assert_ne!(
        route_of(&groups, "orchard-first"),
        route_of(&groups, "orchard-again"),
        "the regroup stays incremental, so the stored pair is not compared again"
    );
}
