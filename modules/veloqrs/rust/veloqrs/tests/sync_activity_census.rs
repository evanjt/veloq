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
//! Run: `cargo test --test persistence -p veloqrs -- sync_activity_census::`

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

    let removed = engine.reconcile_against_census(&census(&["a1", "a3"]), "9999-12-31");

    assert_eq!(removed, vec!["a2".to_string()]);
    assert_eq!(stored(&engine), vec!["a1".to_string(), "a3".to_string()]);
}

#[test]
fn a_census_that_carries_every_local_id_removes_nothing() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["a1", "a2"]);

    assert!(
        engine
            .reconcile_against_census(&census(&["a1", "a2", "a9"]), "9999-12-31")
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

    assert!(
        engine
            .reconcile_against_census(&[], "9999-12-31")
            .is_empty()
    );
    assert_eq!(stored(&engine).len(), 2);
}

/// Demo activities are seeded on the device and no census carries them.
#[test]
fn a_demo_library_is_never_a_candidate() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["demo-test-0", "demo-stress-4", "a1"]);

    let removed = engine.reconcile_against_census(&census(&["a1"]), "9999-12-31");

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

    assert!(
        engine
            .reconcile_against_census(&census(&["a1"]), "9999-12-31")
            .is_empty()
    );
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
            .reconcile_against_census(&census(&["i77"]), "9999-12-31")
            .is_empty()
    );
    assert_eq!(stored(&engine).len(), 1);

    let removed = engine.reconcile_against_census(&census(&["i88"]), "9999-12-31");
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

    let removed = engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

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

    let removed = engine.reconcile_against_census(&census(&["other"]), "9999-12-31");

    assert!(removed.is_empty(), "removed {removed:?}");
    assert!(stored(&engine).contains(&"gone".to_string()));
    assert_eq!(anchor(&dir).as_deref(), Some("gone"));
}

fn seed_member(dir: &TempDir, id: &str, start: u32, end: u32) {
    conn(dir)
        .execute(
            "INSERT INTO section_activities
                 (section_id, activity_id, start_index, end_index, distance_meters, excluded)
             VALUES ('s1', ?, ?, ?, 1000.0, 0)",
            params![id, start, end],
        )
        .expect("seed member");
}

/// An activity the section still counts whose stored track is gone.
fn drop_track(dir: &TempDir, id: &str) {
    conn(dir)
        .execute("DELETE FROM gps_tracks WHERE activity_id = ?", params![id])
        .expect("drop track");
}

/// Scenario: a section has three members and the athlete deletes its anchor ride. The member
/// closest in length (ties break on id) has no stored track.
///
/// Expected behaviour: the next member that can carry the line takes the reference.
#[test]
fn a_trackless_closest_member_does_not_stop_the_re_anchor() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "kept", "a_no_track"]);
    seed_section(&dir, &engine, "gone", &["gone", "kept"]);
    seed_member(&dir, "a_no_track", 10, 40);
    drop_track(&dir, "a_no_track");

    let removed = engine.reconcile_against_census(&census(&["kept", "a_no_track"]), "9999-12-31");

    assert_eq!(removed, vec!["gone".to_string()]);
    assert_eq!(anchor(&dir).as_deref(), Some("kept"));
}

#[test]
fn a_closest_member_with_a_slice_past_its_track_does_not_stop_the_re_anchor() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "a_short", "kept"]);
    seed_section(&dir, &engine, "gone", &["gone", "kept"]);
    seed_member(&dir, "a_short", 10, 400);

    let removed = engine.reconcile_against_census(&census(&["kept", "a_short"]), "9999-12-31");

    assert_eq!(removed, vec!["gone".to_string()]);
    assert_eq!(anchor(&dir).as_deref(), Some("kept"));
}

#[test]
fn a_section_whose_every_other_member_is_unusable_keeps_its_reference_ride() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "a_short", "b_no_track"]);
    seed_section(&dir, &engine, "gone", &["gone", "a_short"]);
    conn(&dir)
        .execute(
            "UPDATE section_activities SET end_index = 400 WHERE activity_id = 'a_short'",
            [],
        )
        .expect("break slice");
    seed_member(&dir, "b_no_track", 10, 40);
    drop_track(&dir, "b_no_track");

    let removed =
        engine.reconcile_against_census(&census(&["a_short", "b_no_track"]), "9999-12-31");

    assert!(removed.is_empty(), "removed {removed:?}");
    assert!(stored(&engine).contains(&"gone".to_string()));
    assert_eq!(anchor(&dir).as_deref(), Some("gone"));
}

/// A section whose anchor names the ride but lost its indices is still anchored to it.
#[test]
fn a_null_index_anchor_is_re_anchored_when_its_ride_goes() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "kept"]);
    seed_section(&dir, &engine, "gone", &["gone", "kept"]);
    conn(&dir)
        .execute(
            "UPDATE sections SET start_index = NULL, end_index = NULL WHERE id = 's1'",
            [],
        )
        .expect("null the indices");

    let removed = engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

    assert_eq!(removed, vec!["gone".to_string()]);
    assert_eq!(anchor(&dir).as_deref(), Some("kept"));
}

/// The member slices are unusable but the section's own line sits in a member's track, so the
/// line is located there and kept.
#[test]
fn a_line_located_in_a_member_track_re_anchors_when_stored_slices_are_unusable() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "kept"]);
    seed_section(&dir, &engine, "gone", &["gone", "kept"]);
    let own_line = engine.get_gps_track("kept").expect("track")[10..=40].to_vec();
    conn(&dir)
        .execute(
            "UPDATE sections SET polyline_blob = ? WHERE id = 's1'",
            params![veloqrs::persistence::codec::serialize_track_points(
                &own_line
            )],
        )
        .expect("line from the member");
    conn(&dir)
        .execute(
            "UPDATE section_activities SET start_index = 10, end_index = 4000
             WHERE activity_id = 'kept'",
            [],
        )
        .expect("break slice");

    let removed = engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

    assert_eq!(removed, vec!["gone".to_string()]);
    assert_eq!(anchor(&dir).as_deref(), Some("kept"));
}

/// A detected section as the catalogue write leaves it: the representative
/// triple, `geometry_source` exact, and no `source_activity_id`. Its first
/// geometry version is cut from the representative and stores no blob.
fn seed_detected_section(
    dir: &TempDir,
    engine: &mut PersistentEngine,
    representative: &str,
    members: &[&str],
) {
    let polyline = engine.get_gps_track(representative).expect("track")[10..=40].to_vec();
    let blob = veloqrs::persistence::codec::serialize_track_points(&polyline);
    let c = conn(dir);
    c.execute(
        "INSERT INTO sections
             (id, name, sport_type, section_type, polyline_blob, distance_meters,
              visit_count, created_at, representative_activity_id, rep_start_index,
              rep_end_index, geometry_source,
              bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES ('s1', 'Section 1', 'Ride', 'auto', ?, 1000.0, ?, datetime('now'),
                 ?, 10, 41, 'exact', 0, 0, 0, 0)",
        params![blob, members.len() as u32, representative],
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
    engine
        .record_section_geometry("s1", &polyline, true, Some((representative, 10, 41)))
        .expect("record version");
}

fn representative(dir: &TempDir) -> Option<String> {
    conn(dir)
        .query_row(
            "SELECT representative_activity_id FROM sections WHERE id = 's1'",
            [],
            |row| row.get(0),
        )
        .expect("read representative")
}

fn version_blob_len(dir: &TempDir, version: i64) -> i64 {
    conn(dir)
        .query_row(
            "SELECT length(blob) FROM section_geometry WHERE section_id = 's1' AND version = ?",
            params![version],
            |row| row.get(0),
        )
        .expect("read version")
}

#[test]
fn a_detected_section_is_re_anchored_before_its_reference_ride_goes() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "kept"]);
    seed_detected_section(&dir, &mut engine, "gone", &["gone", "kept"]);
    assert_eq!(
        version_blob_len(&dir, 1),
        0,
        "the fixture is the emitter's shape"
    );
    let before = engine.section_geometry_polyline("s1", 1).expect("v1 reads");

    let removed = engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

    assert_eq!(removed, vec!["gone".to_string()]);
    assert_eq!(representative(&dir).as_deref(), Some("kept"));
    assert_eq!(engine.section_geometry_polyline("s1", 1), Some(before));
}

#[test]
fn a_version_cut_from_the_vanished_ride_still_reads_after_it_goes() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "kept"]);
    seed_detected_section(&dir, &mut engine, "kept", &["gone", "kept"]);
    let polyline = engine.get_gps_track("gone").expect("track")[10..=40].to_vec();
    let version = engine
        .record_section_geometry("s1", &polyline, true, Some(("gone", 10, 41)))
        .expect("record version");
    assert_eq!(version_blob_len(&dir, version), 0);

    let removed = engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

    assert_eq!(removed, vec!["gone".to_string()]);
    let read = engine
        .section_geometry_polyline("s1", version)
        .expect("the version survives the stream");
    assert_eq!(read.len(), polyline.len());
}

#[test]
fn a_detected_section_with_no_other_member_keeps_its_reference_ride() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "other"]);
    seed_detected_section(&dir, &mut engine, "gone", &["gone"]);

    let removed = engine.reconcile_against_census(&census(&["other"]), "9999-12-31");

    assert!(removed.is_empty(), "removed {removed:?}");
    assert!(stored(&engine).contains(&"gone".to_string()));
    assert_eq!(representative(&dir).as_deref(), Some("gone"));
}

/// An id removed once must not come back on the next sync.
#[test]
fn a_removed_id_stays_removed_across_a_second_census() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["a1", "a2"]);

    assert_eq!(
        engine.reconcile_against_census(&census(&["a1"]), "9999-12-31"),
        vec!["a2".to_string()]
    );
    assert!(
        engine
            .reconcile_against_census(&census(&["a1"]), "9999-12-31")
            .is_empty()
    );
    assert_eq!(stored(&engine), vec!["a1".to_string()]);
}

/// Store an activity the way the page write leaves one with no GPS: metrics
/// and body, and no `activities` row, since only the track store writes one.
fn store_trackless(dir: &TempDir, id: &str, sport: &str, date: &str) {
    let c = conn(dir);
    c.execute(
        "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain,
              sport_type)
         VALUES (?1, 'Trainer', unixepoch(?3), 0, 3600, 3600, 0, ?2)",
        params![id, sport, date],
    )
    .expect("store metrics");
    c.execute(
        "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, unixepoch(?2), '{}')",
        params![id, date],
    )
    .expect("store body");
}

fn keyed_rows(dir: &TempDir, id: &str) -> i64 {
    conn(dir)
        .query_row(
            "SELECT (SELECT COUNT(*) FROM activity_metrics WHERE activity_id = ?1)
                  + (SELECT COUNT(*) FROM activity_bodies WHERE activity_id = ?1)",
            params![id],
            |row| row.get(0),
        )
        .expect("count rows")
}

fn removal_stamps(engine: &PersistentEngine) -> Vec<(String, Option<i64>)> {
    let mut stamps = engine.try_curve_removals_by_sport().expect("read stamps");
    stamps.sort();
    stamps
}

/// Scenario: the athlete deletes a duplicate indoor ride on intervals.icu. It
/// has no GPS, so it has metrics and a body and no `activities` row, and the
/// census only ever read `activities`: the ride stayed in the feed, the weekly
/// load and the power aggregates, and its family's curves kept its efforts.
///
/// Expected behaviour: the census removes it like any other departure, takes
/// every row keyed on it, and stamps its sport for the curve sweep.
#[test]
fn a_trackless_activity_deleted_upstream_is_removed() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["kept"]);
    store_trackless(&dir, "trainer", "VirtualRide", "2025-01-01");

    let removed = engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

    assert_eq!(removed, vec!["trainer".to_string()]);
    assert_eq!(keyed_rows(&dir, "trainer"), 0);
    let stamps = removal_stamps(&engine);
    assert_eq!(stamps.len(), 1, "stamps {stamps:?}");
    assert_eq!(stamps[0].0, "VirtualRide");
    assert_eq!(stored(&engine), vec!["kept".to_string()]);
}

#[test]
fn a_trackless_activity_the_census_names_is_kept() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["kept"]);
    store_trackless(&dir, "swim", "Swim", "2025-01-01");

    assert!(
        engine
            .reconcile_against_census(&census(&["kept", "swim"]), "9999-12-31")
            .is_empty()
    );
    assert_eq!(keyed_rows(&dir, "swim"), 2);
    assert!(removal_stamps(&engine).is_empty());
}

/// The census stops at the device's local today, so a trackless activity dated
/// after it is one the census could not have named.
#[test]
fn a_trackless_activity_after_the_census_newest_is_kept() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["kept"]);
    store_trackless(&dir, "early", "WeightTraining", "2025-01-01");
    store_trackless(&dir, "tomorrow", "WeightTraining", "2025-01-03");

    let removed = engine.reconcile_against_census(&census(&["kept"]), "2025-01-02");

    assert_eq!(removed, vec!["early".to_string()]);
    assert_eq!(keyed_rows(&dir, "tomorrow"), 2);
}

/// A body with no metrics row is still stored, and still departs.
#[test]
fn a_trackless_body_with_no_metrics_is_a_candidate() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["kept"]);
    conn(&dir)
        .execute(
            "INSERT INTO activity_bodies (activity_id, date, raw)
             VALUES ('bare', unixepoch('2025-01-01'), '{}')",
            [],
        )
        .expect("store body");

    let removed = engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

    assert_eq!(removed, vec!["bare".to_string()]);
    assert_eq!(keyed_rows(&dir, "bare"), 0);
}

/// A trackless recording the device minted has no server id to compare, and
/// demo rows of every shape are seeded here and carried by no census.
#[test]
fn trackless_local_and_demo_rows_are_never_candidates() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["kept"]);
    for id in [
        "local-0a1b",
        "demo-test-3",
        "demo-stress-1",
        "demo-2025-01-01-0",
    ] {
        store_trackless(&dir, id, "Ride", "2025-01-01");
    }

    let removed = engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

    assert!(removed.is_empty(), "removed {removed:?}");
    for id in [
        "local-0a1b",
        "demo-test-3",
        "demo-stress-1",
        "demo-2025-01-01-0",
    ] {
        assert_eq!(keyed_rows(&dir, id), 2, "{id}");
    }
}

/// A trackless activity sits in no section, so removing one costs the library
/// no re-detection.
#[test]
fn a_trackless_departure_keeps_the_processed_set() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["kept"]);
    store_trackless(&dir, "trainer", "Ride", "2025-01-01");
    conn(&dir)
        .execute(
            "INSERT INTO processed_activities (activity_id) VALUES ('kept')",
            [],
        )
        .expect("mark processed");

    engine.reconcile_against_census(&census(&["kept"]), "9999-12-31");

    let processed: i64 = conn(&dir)
        .query_row("SELECT COUNT(*) FROM processed_activities", [], |row| {
            row.get(0)
        })
        .expect("count processed");
    assert_eq!(processed, 1);
}

fn set_removal_stamp(dir: &TempDir, sport: &str, at: i64) {
    conn(dir)
        .execute(
            "UPDATE settings SET value = ?2 WHERE key = '__curve_removed_at:' || ?1",
            params![sport, at],
        )
        .expect("move stamp");
}

/// Scenario: the athlete deletes on intervals.icu the only ride a section was
/// cut from. The row is kept for the section, so the removal never ran and the
/// family's curves kept the ride's efforts. Every later census finds it gone
/// again, so a stamp on each would refetch the family on every sync.
///
/// Expected behaviour: the first census that finds it gone stamps its sport,
/// later ones do not, and the removal once the section can do without it does
/// not stamp a second time, since the curves were refetched without it.
#[test]
fn a_departure_kept_for_its_section_stamps_its_sport_once() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "other"]);
    seed_section(&dir, &engine, "gone", &["gone"]);

    assert!(
        engine
            .reconcile_against_census(&census(&["other"]), "9999-12-31")
            .is_empty()
    );
    let stamps = removal_stamps(&engine);
    assert_eq!(stamps.len(), 1, "stamps {stamps:?}");
    assert_eq!(stamps[0].0, "Ride");

    set_removal_stamp(&dir, "Ride", 1);
    assert!(
        engine
            .reconcile_against_census(&census(&["other"]), "9999-12-31")
            .is_empty()
    );
    assert_eq!(removal_stamps(&engine), vec![("Ride".to_string(), Some(1))]);

    conn(&dir)
        .execute(
            "INSERT INTO section_activities
                 (section_id, activity_id, start_index, end_index, distance_meters, excluded)
             VALUES ('s1', 'other', 10, 40, 1000.0, 0)",
            [],
        )
        .expect("another visit");
    assert_eq!(
        engine.reconcile_against_census(&census(&["other"]), "9999-12-31"),
        vec!["gone".to_string()]
    );
    assert_eq!(removal_stamps(&engine), vec![("Ride".to_string(), Some(1))]);
    let markers: i64 = conn(&dir)
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key = '__curve_departed:gone'",
            [],
            |row| row.get(0),
        )
        .expect("count markers");
    assert_eq!(markers, 0, "the marker went with the activity");
}

/// The marker lives only while the activity is gone: one the census names
/// again and later loses again has left a second time, and is stamped again.
#[test]
fn a_kept_departure_the_census_names_again_is_stamped_when_it_leaves_again() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with(&dir, &["gone", "other"]);
    seed_section(&dir, &engine, "gone", &["gone"]);

    engine.reconcile_against_census(&census(&["other"]), "9999-12-31");
    set_removal_stamp(&dir, "Ride", 1);
    assert!(
        engine
            .reconcile_against_census(&census(&["other", "gone"]), "9999-12-31")
            .is_empty()
    );
    assert_eq!(removal_stamps(&engine), vec![("Ride".to_string(), Some(1))]);

    engine.reconcile_against_census(&census(&["other"]), "9999-12-31");

    let stamps = removal_stamps(&engine);
    assert_eq!(stamps.len(), 1, "stamps {stamps:?}");
    assert!(stamps[0].1.is_some_and(|at| at > 1), "stamps {stamps:?}");
}
