//! The fetch mark survives the next census pull.
//!
//! The census is replaced on every pull, because an id the new census does not
//! carry is gone upstream and a row left behind would answer "already there"
//! for an activity that no longer exists. `fetched_sync_date` is not upstream's
//! to say, though: it records what this device came away with, and rewriting it
//! to NULL makes every window owe its download again after any sync, which is
//! every screen reading "not downloaded yet" over a library that is fully
//! downloaded.
//!
//! Run: `cargo test --test app -p veloqrs -- census_fetch_marks_survive::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::net::types::ActivityCensusEntry;
use veloqrs::{LibraryCoverage, RangeCoverage};

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
        has_latlng: true,
    }
}

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

/// A March the device holds in full, marked at the versions the census names.
fn fetched_march(dir: &TempDir) -> PersistentEngine {
    let mut engine = engine(dir);
    let census = [
        entry("a1", "2026-03-02", "2026-03-02T00:10:00Z"),
        entry("a2", "2026-03-09", "2026-03-09T00:10:00Z"),
    ];
    engine
        .record_activity_census("i1", &census)
        .expect("census");
    for (i, e) in census.iter().enumerate() {
        store_body(&mut engine, &e.id, 1_770_000_000 + i as i64);
    }
    engine
}

#[test]
fn a_second_census_naming_the_same_versions_leaves_the_window_covered() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = fetched_march(&dir);
    assert!(engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));

    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-03-02", "2026-03-02T00:10:00Z"),
                entry("a2", "2026-03-09", "2026-03-09T00:10:00Z"),
            ],
        )
        .expect("census");

    assert!(engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));
}

#[test]
fn a_second_census_leaves_the_range_loaded_rather_than_not_fetched() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = fetched_march(&dir);

    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-03-02", "2026-03-02T00:10:00Z"),
                entry("a2", "2026-03-09", "2026-03-09T00:10:00Z"),
            ],
        )
        .expect("census");

    assert_eq!(
        engine.range_coverage("i1", "2026-03-01", "2026-03-31"),
        RangeCoverage::Loaded
    );
}

/// The version check is the point of keeping the mark: a row edited upstream
/// since the download owes it again, and only a surviving mark can tell.
#[test]
fn a_row_whose_version_moved_upstream_owes_its_download_again() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = fetched_march(&dir);

    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-03-02", "2026-03-02T00:10:00Z"),
                entry("a2", "2026-03-09", "2026-03-11T08:00:00Z"),
            ],
        )
        .expect("census");

    assert!(!engine.window_is_covered("i1", "2026-03-01", "2026-03-31"));
    assert_eq!(
        engine.range_coverage("i1", "2026-03-01", "2026-03-31"),
        RangeCoverage::NotFetched
    );
}

#[test]
fn the_library_count_does_not_fall_back_to_zero_after_a_pull() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = fetched_march(&dir);

    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-03-02", "2026-03-02T00:10:00Z"),
                entry("a2", "2026-03-09", "2026-03-09T00:10:00Z"),
            ],
        )
        .expect("census");

    let coverage = engine.library_coverage("i1");

    assert_eq!(coverage.upstream, 2);
    assert_eq!(coverage.fetched, 2);
}

/// An id the new census does not carry is gone upstream, and the replace exists
/// to drop it. Keeping the mark must not keep the row.
#[test]
fn an_id_the_new_census_drops_leaves_no_row_behind() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = fetched_march(&dir);

    engine
        .record_activity_census("i1", &[entry("a1", "2026-03-02", "2026-03-02T00:10:00Z")])
        .expect("census");

    let coverage = engine.library_coverage("i1");

    assert_eq!(
        coverage,
        LibraryCoverage {
            upstream: 1,
            fetched: 1,
            tracks_upstream: 1,
            tracks_stored: 0,
        }
    );
}

/// The mark belongs to the athlete it was written for, so a second sign-in
/// inherits none of it.
#[test]
fn a_second_athletes_census_does_not_inherit_the_first_ones_marks() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = fetched_march(&dir);

    engine
        .record_activity_census("i2", &[entry("a1", "2026-03-02", "2026-03-02T00:10:00Z")])
        .expect("census");

    assert_eq!(engine.library_coverage("i2").fetched, 0);
    assert_eq!(engine.library_coverage("i1").fetched, 2);
}

/// An id that leaves the account and comes back is a new download: its row went
/// with the id, so nothing says the device still holds what the census names.
#[test]
fn an_id_dropped_and_readded_owes_its_download() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = fetched_march(&dir);

    engine
        .record_activity_census("i1", &[entry("a1", "2026-03-02", "2026-03-02T00:10:00Z")])
        .expect("census");
    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-03-02", "2026-03-02T00:10:00Z"),
                entry("a2", "2026-03-09", "2026-03-09T00:10:00Z"),
            ],
        )
        .expect("census");

    assert_eq!(engine.library_coverage("i1").fetched, 1);
}
