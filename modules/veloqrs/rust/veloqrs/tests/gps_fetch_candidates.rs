//! The tracks a GPS pass still owes, answered from the census and the stored
//! bodies without parsing a body's stream list.
//!
//! The pass used to filter a whole parsed library for `stream_types` carrying
//! `latlng`, minus the ids the device already held and the ones it had given
//! up on. The census now says which activities have a track upstream, so the
//! list is a read over it: marked, stored, not downloaded, not settled out,
//! inside the range the athlete selected.
//!
//! Run: `cargo test --test app -p veloqrs -- gps_fetch_candidates::`

use tempfile::TempDir;
use veloqrs::net::types::ActivityCensusEntry;
use veloqrs::persistence::{TRACK_FAILURE_LIMIT, TrackRefusalKind};
use veloqrs::{GpsPoint, PersistentEngine};

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    PersistentEngine::new(path.to_str().expect("utf-8")).expect("open")
}

fn entry(id: &str, day: &str, has_latlng: bool) -> ActivityCensusEntry {
    ActivityCensusEntry {
        id: id.to_string(),
        start_date_local: Some(format!("{day}T06:30:00")),
        created: Some(format!("{day}T00:00:00Z")),
        icu_sync_date: Some(format!("{day}T00:10:00Z")),
        has_latlng,
        has_series: false,
    }
}

fn store_body(
    engine: &mut PersistentEngine,
    id: &str,
    raw_type: Option<&str>,
    metrics_sport: &str,
) {
    let raw = match raw_type {
        Some(kind) => format!("{{\"id\":\"{id}\",\"type\":\"{kind}\"}}"),
        None => format!("{{\"id\":\"{id}\"}}"),
    };
    engine
        .store_synced_activity_bodies(
            "i1",
            &[(id.to_string(), 1_770_000_000, raw)],
            &[id.to_string()],
            vec![veloqrs::ActivityMetrics {
                activity_id: id.to_string(),
                date: 1_770_000_000,
                sport_type: metrics_sport.to_string(),
                ..Default::default()
            }],
        )
        .expect("body");
}

fn store_track(engine: &mut PersistentEngine, id: &str) {
    let coords = vec![
        GpsPoint {
            latitude: 47.5,
            longitude: 8.7,
            elevation: None,
        },
        GpsPoint {
            latitude: 47.51,
            longitude: 8.71,
            elevation: None,
        },
    ];
    engine
        .add_activities_batch(vec![(id.to_string(), coords, "Ride".to_string())])
        .expect("track");
}

fn library(dir: &TempDir, census: &[ActivityCensusEntry]) -> PersistentEngine {
    let mut engine = engine(dir);
    engine.record_activity_census("i1", census).expect("census");
    for e in census {
        store_body(&mut engine, &e.id, Some("Ride"), "Ride");
    }
    engine
}

fn ids(engine: &PersistentEngine, oldest: &str, newest: &str) -> Vec<String> {
    engine
        .gps_fetch_candidates("i1", oldest, newest)
        .into_iter()
        .map(|c| c.activity_id)
        .collect()
}

#[test]
fn a_marked_stored_activity_without_a_track_is_a_candidate_newest_first() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    let census = [
        entry("old", "2026-03-02", true),
        entry("new", "2026-03-16", true),
        entry("mid", "2026-03-09", true),
    ];
    engine
        .record_activity_census("i1", &census)
        .expect("census");
    store_body(&mut engine, "old", Some("Run"), "Ride");
    store_body(&mut engine, "new", None, "Swim");
    store_body(&mut engine, "mid", None, "");

    let candidates = engine.gps_fetch_candidates("i1", "2026-01-01", "2026-12-31");

    let rows: Vec<_> = candidates
        .iter()
        .map(|c| (c.activity_id.as_str(), c.sport_type.as_str()))
        .collect();
    assert_eq!(
        rows,
        vec![("new", "Swim"), ("mid", "Ride"), ("old", "Run")],
        "the body's own type wins, then the metrics row, then Ride"
    );
    // 2026-03-16T06:30:00 read as UTC, the way the stored dates are.
    assert_eq!(candidates[0].start_date, Some(1_773_642_600.0));
}

#[test]
fn an_activity_without_a_track_upstream_is_not_a_candidate() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(
        &dir,
        &[
            entry("ride", "2026-03-02", true),
            entry("pool", "2026-03-03", false),
        ],
    );

    assert_eq!(ids(&engine, "2026-01-01", "2026-12-31"), vec!["ride"]);
}

#[test]
fn a_track_already_on_the_device_is_not_a_candidate() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(
        &dir,
        &[
            entry("have", "2026-03-02", true),
            entry("want", "2026-03-03", true),
        ],
    );
    store_track(&mut engine, "have");

    assert_eq!(ids(&engine, "2026-01-01", "2026-12-31"), vec!["want"]);
}

#[test]
fn a_track_given_up_on_is_not_a_candidate_until_the_activity_changes_upstream() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(
        &dir,
        &[
            entry("walk", "2026-03-02", true),
            entry("flaky", "2026-03-03", true),
            entry("ride", "2026-03-04", true),
        ],
    );
    engine
        .record_track_refusals("i1", &[("walk".to_string(), TrackRefusalKind::TooShort)])
        .expect("refusal");
    for _ in 0..TRACK_FAILURE_LIMIT {
        engine
            .record_track_fetch_outcomes("i1", &[], &["flaky".to_string()])
            .expect("failure");
    }
    assert_eq!(ids(&engine, "2026-01-01", "2026-12-31"), vec!["ride"]);

    // An edit upstream moves icu_sync_date, which retires both marks.
    let edited = ActivityCensusEntry {
        icu_sync_date: Some("2026-04-01T00:00:00Z".to_string()),
        ..entry("walk", "2026-03-02", true)
    };
    engine
        .record_activity_census(
            "i1",
            &[
                edited,
                ActivityCensusEntry {
                    icu_sync_date: Some("2026-04-01T00:00:00Z".to_string()),
                    ..entry("flaky", "2026-03-03", true)
                },
                entry("ride", "2026-03-04", true),
            ],
        )
        .expect("census");
    let mut again = ids(&engine, "2026-01-01", "2026-12-31");
    again.sort();
    assert_eq!(again, vec!["flaky", "ride", "walk"]);
}

#[test]
fn an_activity_whose_body_has_not_landed_is_not_a_candidate() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .record_activity_census(
            "i1",
            &[
                entry("stored", "2026-03-02", true),
                entry("owed", "2026-03-03", true),
            ],
        )
        .expect("census");
    store_body(&mut engine, "stored", Some("Ride"), "Ride");

    assert_eq!(ids(&engine, "2026-01-01", "2026-12-31"), vec!["stored"]);
}

#[test]
fn the_range_bounds_both_ends_by_day_and_includes_its_edges() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(
        &dir,
        &[
            entry("before", "2026-03-01", true),
            entry("first", "2026-03-02", true),
            entry("last", "2026-03-09", true),
            entry("after", "2026-03-10", true),
        ],
    );

    let mut inside = ids(&engine, "2026-03-02", "2026-03-09");
    inside.sort();
    assert_eq!(inside, vec!["first", "last"]);
}

#[test]
fn another_athletes_census_and_an_empty_athlete_answer_nothing() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, &[entry("ride", "2026-03-02", true)]);

    assert!(
        engine
            .gps_fetch_candidates("i2", "2026-01-01", "2026-12-31")
            .is_empty()
    );
    assert!(
        engine
            .gps_fetch_candidates("", "2026-01-01", "2026-12-31")
            .is_empty()
    );
}
