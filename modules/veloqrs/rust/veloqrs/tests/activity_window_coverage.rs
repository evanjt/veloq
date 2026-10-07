//! Whether a date window still owes a download, answered by the engine rather
//! than by a `Set` the caller keeps.
//!
//! The census says what the account holds and when each activity last changed
//! upstream. `activity_bodies` says what the device has, because that is what a
//! window sync writes and what the feed reads: a synced activity whose track
//! was never downloaded has no `activities` row at all. A window is covered
//! when every census row inside it has a stored body and the version fetched is
//! the version the census names. Anything else, a missing id or one that moved
//! upstream since, owes the download.
//!
//! A window is never called covered on no evidence: an athlete whose census has
//! never been pulled knows nothing, so every window owes.
//!
//! Run: `cargo test --test persistence -p veloqrs -- activity_window_coverage::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::net::types::ActivityCensusEntry;

/// One stored body, the way a window sync leaves it: keyed by the id the row
/// was written under, with the raw payload beside it.
fn store_body(engine: &mut PersistentEngine, id: &str, date: i64) {
    engine
        .store_synced_activity_bodies(
            "i1",
            &[(id.to_string(), date, format!("{{\"id\":\"{id}\"}}"))],
            &[id.to_string()],
            vec![veloqrs::ActivityMetrics {
                activity_id: id.to_string(),
                date,
                ..Default::default()
            }],
        )
        .expect("body");
}

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    PersistentEngine::new(path.to_str().expect("utf-8")).expect("open")
}

fn entry(id: &str, day: &str, synced: &str) -> ActivityCensusEntry {
    ActivityCensusEntry {
        id: id.to_string(),
        start_date_local: Some(format!("{day}T06:00:00")),
        created: Some(format!("{day}T00:00:00Z")),
        icu_sync_date: Some(synced.to_string()),
        has_latlng: false,
    }
}

/// A census, the matching local activities, and every one marked fetched at the
/// version the census names: the state a completed window sync leaves.
fn covered_library() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    let census = [
        entry("a1", "2026-03-02", "2026-03-02T00:10:00Z"),
        entry("a2", "2026-03-09", "2026-03-09T00:10:00Z"),
        entry("a3", "2026-06-01", "2026-06-01T00:10:00Z"),
    ];
    engine
        .record_activity_census("i1", &census)
        .expect("census");
    for (i, e) in census.iter().enumerate() {
        store_body(&mut engine, &e.id, 1_770_000_000 + i as i64);
    }
    (dir, engine)
}

#[test]
fn a_window_whose_ids_are_all_local_and_current_owes_nothing() {
    let (_dir, engine) = covered_library();

    assert!(engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));
}

#[test]
fn one_id_the_device_never_stored_owes_the_window() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-03-02", "2026-03-02T00:10:00Z"),
                entry("a2", "2026-03-09", "2026-03-09T00:10:00Z"),
            ],
        )
        .expect("census");
    store_body(&mut engine, "a1", 1_770_000_000);

    assert!(!engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));
}

#[test]
fn an_activity_that_moved_upstream_since_it_was_fetched_owes_the_window() {
    let (_dir, mut engine) = covered_library();
    assert!(engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));

    // The next census carries a later change date for a1 and nothing has
    // fetched that version.
    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-03-02", "2026-03-20T11:00:00Z"),
                entry("a2", "2026-03-09", "2026-03-09T00:10:00Z"),
                entry("a3", "2026-06-01", "2026-06-01T00:10:00Z"),
            ],
        )
        .expect("census");

    assert!(!engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));
}

#[test]
fn a_window_the_census_names_nothing_in_is_covered() {
    let (_dir, engine) = covered_library();

    // The athlete rode nothing in April. There is nothing to download, and a
    // window that owes nothing is covered whether or not it is empty.
    assert!(engine.window_is_covered("i1", "2026-04-01", "2026-04-30"));
}

#[test]
fn an_athlete_with_no_census_at_all_owes_every_window() {
    let (_dir, engine) = covered_library();

    // Never pulled for this athlete, so nothing is known. Reading an empty
    // table as "nothing missing" is how a second sign-in shows an empty feed
    // and never fetches.
    assert!(!engine.window_is_covered("i2", "2026-03-01", "2026-03-31"));
}

#[test]
fn one_athletes_coverage_never_answers_for_another() {
    let (_dir, mut engine) = covered_library();
    engine
        .record_activity_census("i2", &[entry("b1", "2026-03-04", "2026-03-04T00:10:00Z")])
        .expect("census");

    // i2 has a census now and one row in the window, and the device does not
    // have that activity.
    assert!(!engine.window_is_covered("i2", "2026-03-01", "2026-03-31"));
    assert!(engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));
}

#[test]
fn a_fetch_mark_names_the_version_it_fetched_rather_than_the_time_it_ran() {
    let (_dir, mut engine) = covered_library();

    // Marking an id the census does not carry writes nothing, so a stale mark
    // cannot make a later census row read as fetched.
    engine
        .store_synced_activity_bodies(
            "i1",
            &[("not-in-census".into(), 0, "{}".into())],
            &["not-in-census".into()],
            vec![veloqrs::ActivityMetrics {
                activity_id: "not-in-census".into(),
                ..Default::default()
            }],
        )
        .unwrap();
    engine
        .record_activity_census(
            "i1",
            &[entry("not-in-census", "2026-03-05", "2026-03-05T00:10:00Z")],
        )
        .expect("census");

    assert!(!engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));
}

#[test]
fn an_uploaded_trackless_ride_stored_under_its_local_key_is_not_owed() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    let date = 1_772_000_000;
    let body = |id: &str| {
        format!(
            r#"{{"id":"{id}","name":"Gym","type":"WeightTraining","start_date_local":"2026-03-02T07:00:00","moving_time":3600,"elapsed_time":3600,"distance":0}}"#
        )
    };
    engine
        .save_provisional_activity(
            "local-abc",
            Vec::new(),
            &veloqrs::FfiActivityBody {
                activity_id: "local-abc".to_string(),
                date: date as f64,
                raw: body("local-abc"),
            },
        )
        .expect("trackless provisional row");
    assert!(engine.record_upload("local-abc", "i77").expect("upload"));
    engine
        .record_activity_census("i1", &[entry("i77", "2026-03-02", "2026-03-02T00:10:00Z")])
        .expect("census");
    engine
        .store_synced_activity_bodies(
            "i1",
            &[("local-abc".to_string(), date, body("i77"))],
            &["i77".to_string()],
            vec![veloqrs::ActivityMetrics {
                activity_id: "local-abc".to_string(),
                date,
                ..Default::default()
            }],
        )
        .expect("sync page");

    assert_eq!(
        engine.owed_dates_in_window("i1", "2026-03-01", "2026-03-31"),
        Some(vec![])
    );
    assert!(engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));
    assert_eq!(engine.library_coverage("i1").fetched, 1);
}
