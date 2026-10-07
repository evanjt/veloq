//! A track the engine refused for good is remembered, so no sync asks for it again.
//!
//! An activity whose stream has no latlngs, or fewer than two usable points,
//! never reaches `gps_tracks`, so every sync found it missing and requested its
//! stream again. The refusal is kept on the census row beside the version it
//! was made against: a census pull does not erase it, an upstream edit does
//! retire it, and coverage counts the activity as settled.
//!
//! Run: `cargo test --test app -p veloqrs -- track_refusal::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::net::types::ActivityCensusEntry;
use veloqrs::persistence::TrackRefusalKind;

fn entry(id: &str, synced: &str, has_latlng: bool) -> ActivityCensusEntry {
    ActivityCensusEntry {
        id: id.to_string(),
        start_date_local: Some("2026-03-02T06:00:00".to_string()),
        created: Some("2026-03-02T00:00:00Z".to_string()),
        icu_sync_date: Some(synced.to_string()),
        has_latlng,
    }
}

fn engine_with_census(dir: &TempDir, census: &[ActivityCensusEntry]) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("open");
    engine.record_activity_census("i1", census).expect("census");
    engine
        .record_activity_window("i1", "2026-01-01")
        .expect("window");
    engine
}

fn walk_and_ride() -> Vec<ActivityCensusEntry> {
    vec![
        entry("walk", "2026-03-02T00:10:00Z", true),
        entry("ride", "2026-03-02T00:10:00Z", true),
    ]
}

#[test]
fn a_refused_track_is_listed_and_a_track_never_refused_is_not() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine_with_census(&dir, &walk_and_ride());

    engine
        .record_track_refusals("i1", &[("walk".to_string(), TrackRefusalKind::TooShort)])
        .expect("record");

    assert_eq!(engine.refused_track_ids("i1"), vec!["walk"]);
}

#[test]
fn both_refusal_kinds_are_remembered() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine_with_census(&dir, &walk_and_ride());

    engine
        .record_track_refusals(
            "i1",
            &[
                ("walk".to_string(), TrackRefusalKind::TooShort),
                ("ride".to_string(), TrackRefusalKind::NoTrack),
            ],
        )
        .expect("record");

    let mut ids = engine.refused_track_ids("i1");
    ids.sort();
    assert_eq!(ids, vec!["ride", "walk"]);
}

#[test]
fn a_refusal_for_an_activity_the_census_does_not_name_is_ignored() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine_with_census(&dir, &walk_and_ride());

    engine
        .record_track_refusals(
            "i1",
            &[("elsewhere".to_string(), TrackRefusalKind::NoTrack)],
        )
        .expect("record");
    engine
        .record_track_refusals("i2", &[("walk".to_string(), TrackRefusalKind::NoTrack)])
        .expect("record");

    assert!(engine.refused_track_ids("i1").is_empty());
    assert!(engine.refused_track_ids("i2").is_empty());
}

#[test]
fn the_refusal_survives_a_second_census_naming_the_same_version() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_census(&dir, &walk_and_ride());
    engine
        .record_track_refusals("i1", &[("walk".to_string(), TrackRefusalKind::TooShort)])
        .expect("record");

    engine
        .record_activity_census("i1", &walk_and_ride())
        .expect("census");

    assert_eq!(engine.refused_track_ids("i1"), vec!["walk"]);
}

/// An edit upstream can add the track the first download lacked, so the
/// refusal is only good for the version it was made against.
#[test]
fn a_version_moved_upstream_retires_the_refusal() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_census(&dir, &walk_and_ride());
    engine
        .record_track_refusals("i1", &[("walk".to_string(), TrackRefusalKind::TooShort)])
        .expect("record");

    engine
        .record_activity_census(
            "i1",
            &[
                entry("walk", "2026-03-09T08:00:00Z", true),
                entry("ride", "2026-03-02T00:10:00Z", true),
            ],
        )
        .expect("census");

    assert!(engine.refused_track_ids("i1").is_empty());
}

#[test]
fn a_refused_track_no_longer_counts_as_owed_by_the_library() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine_with_census(&dir, &walk_and_ride());
    assert_eq!(engine.library_coverage("i1").tracks_upstream, 2);

    engine
        .record_track_refusals("i1", &[("walk".to_string(), TrackRefusalKind::TooShort)])
        .expect("record");

    let coverage = engine.library_coverage("i1");
    assert_eq!(coverage.tracks_upstream, 1);
    assert_eq!(coverage.tracks_stored, 0);
}
