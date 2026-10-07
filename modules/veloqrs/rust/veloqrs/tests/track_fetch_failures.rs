//! A track whose download fails on every settled run is given up on, so no sync
//! asks for it or reports it for ever.
//!
//! The count is kept on the census row beside the upstream version it was made
//! against: a census pull does not erase it, a landed track clears it, and an
//! edit upstream retires it.
//!
//! Run: `cargo test --test app -p veloqrs -- track_fetch_failures::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::net::types::ActivityCensusEntry;
use veloqrs::persistence::TRACK_FAILURE_LIMIT;

fn entry(id: &str, synced: &str) -> ActivityCensusEntry {
    ActivityCensusEntry {
        id: id.to_string(),
        start_date_local: Some("2026-03-02T06:00:00".to_string()),
        created: Some("2026-03-02T00:00:00Z".to_string()),
        icu_sync_date: Some(synced.to_string()),
        has_latlng: true,
    }
}

fn census() -> Vec<ActivityCensusEntry> {
    vec![
        entry("walk", "2026-03-02T00:10:00Z"),
        entry("ride", "2026-03-02T00:10:00Z"),
    ]
}

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    engine
        .record_activity_census("i1", &census())
        .expect("census");
    engine
        .record_activity_window("i1", "2026-01-01")
        .expect("window");
    engine
}

fn fail(engine: &PersistentEngine, id: &str, runs: u32) {
    for _ in 0..runs {
        engine
            .record_track_fetch_outcomes("i1", &[], &[id.to_string()])
            .expect("record");
    }
}

#[test]
fn a_track_is_unavailable_only_once_it_has_failed_the_limit_of_settled_runs() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);

    fail(&engine, "walk", TRACK_FAILURE_LIMIT - 1);
    assert!(engine.unavailable_track_ids("i1").is_empty());

    fail(&engine, "walk", 1);
    assert_eq!(engine.unavailable_track_ids("i1"), vec!["walk"]);
}

#[test]
fn an_unavailable_track_no_longer_counts_as_owed_by_the_library() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    assert_eq!(engine.library_coverage("i1").tracks_upstream, 2);

    fail(&engine, "walk", TRACK_FAILURE_LIMIT);

    assert_eq!(engine.library_coverage("i1").tracks_upstream, 1);
}

#[test]
fn a_landed_track_clears_its_count() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);
    fail(&engine, "walk", TRACK_FAILURE_LIMIT - 1);

    engine
        .record_track_fetch_outcomes("i1", &["walk".to_string()], &[])
        .expect("record");
    fail(&engine, "walk", 1);

    assert!(engine.unavailable_track_ids("i1").is_empty());
}

#[test]
fn the_count_survives_a_second_census_naming_the_same_version() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    fail(&engine, "walk", TRACK_FAILURE_LIMIT);

    engine
        .record_activity_census("i1", &census())
        .expect("census");

    assert_eq!(engine.unavailable_track_ids("i1"), vec!["walk"]);
}

#[test]
fn a_version_moved_upstream_retires_the_mark_and_restarts_the_count() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    fail(&engine, "walk", TRACK_FAILURE_LIMIT);

    engine
        .record_activity_census(
            "i1",
            &[
                entry("walk", "2026-03-09T08:00:00Z"),
                entry("ride", "2026-03-02T00:10:00Z"),
            ],
        )
        .expect("census");
    assert!(engine.unavailable_track_ids("i1").is_empty());

    fail(&engine, "walk", TRACK_FAILURE_LIMIT - 1);
    assert!(engine.unavailable_track_ids("i1").is_empty());
}

#[test]
fn an_activity_the_census_does_not_name_is_ignored() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);

    fail(&engine, "elsewhere", TRACK_FAILURE_LIMIT);
    engine
        .record_track_fetch_outcomes("i2", &[], &["walk".to_string()])
        .expect("record");

    assert!(engine.unavailable_track_ids("i1").is_empty());
    assert!(engine.unavailable_track_ids("i2").is_empty());
}
