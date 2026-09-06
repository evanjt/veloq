//! A sync reconciles what the device holds against what intervals.icu still
//! carries, so a ride deleted on the website, a duplicate merged, or a file
//! re-uploaded under a new id stops living on in the feed, the ledger, the
//! route records and the heatmap.
//!
//! Every guard here is a library wiped if it is dropped: an empty census, a
//! demo library, and a row the device minted that the server has never seen.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test sync_activity_census -p veloqrs`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn track(offset: f64) -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0002,
            longitude: 7.0 + offset,
            elevation: None,
        })
        .collect()
}

fn engine_with(dir: &TempDir, ids: &[&str]) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    for (i, id) in ids.iter().enumerate() {
        engine
            .add_activity((*id).to_string(), track(i as f64 * 0.0001), "Ride".into())
            .expect("store");
    }
    engine
}

fn conn(dir: &TempDir) -> Connection {
    Connection::open(dir.path().join("routes.db")).expect("open directly")
}

fn census(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|s| (*s).to_string()).collect()
}

fn stored(engine: &PersistentEngine) -> Vec<String> {
    let mut ids = engine.get_activity_ids();
    ids.sort();
    ids
}

#[test]
fn an_id_the_census_does_not_carry_is_removed() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["a1", "a2", "a3"]);

    let removed = engine.reconcile_against_census(&census(&["a1", "a3"]));

    assert_eq!(removed, vec!["a2".to_string()]);
    assert_eq!(stored(&engine), vec!["a1".to_string(), "a3".to_string()]);
}

#[test]
fn a_census_that_carries_every_local_id_removes_nothing() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["a1", "a2"]);

    assert!(
        engine
            .reconcile_against_census(&census(&["a1", "a2", "a9"]))
            .is_empty()
    );
    assert_eq!(stored(&engine).len(), 2);
}

/// A truncated or failed census is indistinguishable from an athlete who
/// deleted everything, and a blind difference then wipes the library.
#[test]
fn an_empty_census_removes_nothing() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["a1", "a2"]);

    assert!(engine.reconcile_against_census(&[]).is_empty());
    assert_eq!(stored(&engine).len(), 2);
}

/// Demo activities are seeded on the device and no census carries them.
#[test]
fn a_demo_library_is_never_a_candidate() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["demo-test-0", "demo-stress-4", "a1"]);

    let removed = engine.reconcile_against_census(&census(&["a1"]));

    assert!(removed.is_empty(), "removed {removed:?}");
    assert_eq!(stored(&engine).len(), 3);
}

/// A row the device minted has never been upstream, so the server not naming
/// it says nothing at all.
#[test]
fn a_row_the_server_has_never_seen_is_never_a_candidate() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["a1", "local-ride"]);
    conn(&dir)
        .execute(
            "UPDATE activities SET intervals_id = NULL WHERE id = 'local-ride'",
            [],
        )
        .expect("a ride not yet uploaded");

    assert!(engine.reconcile_against_census(&census(&["a1"])).is_empty());
    assert_eq!(stored(&engine).len(), 2);
}

/// The comparison is against the server's own id, never the key: a row keyed
/// locally and later uploaded must not read as deleted.
#[test]
fn the_census_matches_on_the_server_id_not_the_key() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["local-ride"]);
    conn(&dir)
        .execute(
            "UPDATE activities SET intervals_id = 'i77' WHERE id = 'local-ride'",
            [],
        )
        .expect("the upload answered");

    assert!(
        engine
            .reconcile_against_census(&census(&["i77"]))
            .is_empty()
    );
    assert_eq!(stored(&engine).len(), 1);

    let removed = engine.reconcile_against_census(&census(&["i88"]));
    assert_eq!(removed, vec!["local-ride".to_string()]);
}

/// A section's line is a triple into one stored stream, so the reference moves
/// to another member before the row goes.
fn seed_section(dir: &TempDir, engine: &PersistentEngine, anchor: &str, members: &[&str]) {
    let polyline = engine.get_gps_track(anchor).expect("track")[10..=40].to_vec();
    let blob = veloqrs::persistence::codec::serialize_track_points(&polyline);
    let c = conn(dir);
    c.execute(
        "INSERT INTO sections
             (id, name, sport_type, section_type, polyline_blob, distance_meters,
              visit_count, created_at, source_activity_id, start_index, end_index,
              bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES ('s1', 'Section 1', 'Ride', 'auto', ?, 1000.0, ?, datetime('now'),
                 ?, 10, 40, 0, 0, 0, 0)",
        params![blob, members.len() as u32, anchor],
    )
    .expect("seed section");
    for id in members {
        c.execute(
            "INSERT INTO section_activities
                 (section_id, activity_id, start_index, end_index, distance_meters, excluded)
             VALUES ('s1', ?, 10, 40, 1000.0, 0)",
            params![id],
        )
        .expect("seed member");
    }
}

fn anchor(dir: &TempDir) -> Option<String> {
    conn(dir)
        .query_row(
            "SELECT source_activity_id FROM sections WHERE id = 's1'",
            [],
            |row| row.get(0),
        )
        .expect("read anchor")
}

#[test]
fn a_section_anchored_to_the_vanished_activity_is_re_anchored_first() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "kept"]);
    seed_section(&dir, &engine, "gone", &["gone", "kept"]);

    let removed = engine.reconcile_against_census(&census(&["kept"]));

    assert_eq!(removed, vec!["gone".to_string()]);
    assert_eq!(anchor(&dir).as_deref(), Some("kept"));
}

/// A section whose only visit was the vanished activity has nothing to
/// re-anchor to, so the row is protected and the delete is skipped.
#[test]
fn an_activity_a_section_cannot_do_without_is_kept() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "other"]);
    seed_section(&dir, &engine, "gone", &["gone"]);

    let removed = engine.reconcile_against_census(&census(&["other"]));

    assert!(removed.is_empty(), "removed {removed:?}");
    assert!(stored(&engine).contains(&"gone".to_string()));
    assert_eq!(anchor(&dir).as_deref(), Some("gone"));
}

/// An id removed once must not come back on the next sync.
#[test]
fn a_removed_id_stays_removed_across_a_second_census() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["a1", "a2"]);

    assert_eq!(
        engine.reconcile_against_census(&census(&["a1"])),
        vec!["a2".to_string()]
    );
    assert!(engine.reconcile_against_census(&census(&["a1"])).is_empty());
    assert_eq!(stored(&engine), vec!["a1".to_string()]);
}
