//! Whether a date range holds nothing, owes a download, or is fully local.
//!
//! `window_is_covered` answers a sync's question, "do I still owe this
//! download", and a bool is enough for that. A chart asks a different one: an
//! empty axis is either an athlete who rode nothing that month or a month the
//! device never pulled, and those read identically when the answer collapses
//! to "no data".
//!
//! The census separates them. No row inside the range means the account holds
//! nothing there, and that is `Empty`. A row whose `fetched_sync_date` is NULL,
//! or no longer matches the `icu_sync_date` the census names, means the
//! download is still owed, and that is `NotFetched`. Everything else is
//! `Loaded`.
//!
//! An athlete whose census has never been pulled knows nothing, so the range is
//! `NotFetched` rather than `Empty`: an empty table is ignorance, not an empty
//! account, and calling it empty is what would tell a fresh sign-in they had
//! never trained.
//!
//! Run: `cargo test --test persistence -p veloqrs -- activity_range_coverage::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::RangeCoverage;
use veloqrs::net::types::ActivityCensusEntry;

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

/// A census spanning March, all of it stored and marked at the version the
/// census names: what a completed window sync leaves behind.
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
fn a_range_the_device_has_in_full_is_loaded() {
    let dir = TempDir::new().expect("tempdir");
    let engine = fetched_march(&dir);

    assert_eq!(
        engine.range_coverage("i1", "2026-03-01", "2026-03-31"),
        RangeCoverage::Loaded
    );
}

#[test]
fn a_range_the_census_names_nothing_in_is_empty() {
    let dir = TempDir::new().expect("tempdir");
    let engine = fetched_march(&dir);

    assert_eq!(
        engine.range_coverage("i1", "2026-04-01", "2026-04-30"),
        RangeCoverage::Empty
    );
}

#[test]
fn a_census_row_never_fetched_owes_the_range() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .record_activity_census("i1", &[entry("a1", "2026-03-02", "2026-03-02T00:10:00Z")])
        .expect("census");

    assert_eq!(
        engine.range_coverage("i1", "2026-03-01", "2026-03-31"),
        RangeCoverage::NotFetched
    );
}

/// The mark carries the version, so an activity edited upstream since the
/// download owes it again rather than reading as local.
#[test]
fn a_row_that_moved_upstream_since_the_fetch_owes_the_range() {
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

    assert_eq!(
        engine.range_coverage("i1", "2026-03-01", "2026-03-31"),
        RangeCoverage::NotFetched
    );
}

/// The whole point of the three-way: a range nobody has pulled must not read as
/// an account with nothing in it.
#[test]
fn an_athlete_with_no_census_at_all_owes_every_range() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);

    assert_eq!(
        engine.range_coverage("i1", "2026-03-01", "2026-03-31"),
        RangeCoverage::NotFetched
    );
}

/// The census is keyed on the athlete, so a second sign-in reads its own
/// coverage and never the first one's.
#[test]
fn a_second_athlete_reads_none_of_the_first_ones_coverage() {
    let dir = TempDir::new().expect("tempdir");
    let engine = fetched_march(&dir);

    assert_eq!(
        engine.range_coverage("i2", "2026-03-01", "2026-03-31"),
        RangeCoverage::NotFetched
    );
}

/// The range is inclusive of both ends, and `start_date_local` carries a time
/// the caller's day boundary does not.
#[test]
fn both_ends_of_the_range_are_inside_it() {
    let dir = TempDir::new().expect("tempdir");
    let engine = fetched_march(&dir);

    assert_eq!(
        engine.range_coverage("i1", "2026-03-02", "2026-03-09"),
        RangeCoverage::Loaded
    );
    assert_eq!(
        engine.range_coverage("i1", "2026-03-03", "2026-03-08"),
        RangeCoverage::Empty
    );
}

/// An empty athlete id is no athlete, and answering `Empty` there would tell a
/// signed-out screen the account holds nothing.
#[test]
fn no_athlete_id_owes_the_range() {
    let dir = TempDir::new().expect("tempdir");
    let engine = fetched_march(&dir);

    assert_eq!(
        engine.range_coverage("", "2026-03-01", "2026-03-31"),
        RangeCoverage::NotFetched
    );
}
