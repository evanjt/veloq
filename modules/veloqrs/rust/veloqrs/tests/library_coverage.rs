//! How much of the athlete's library is on the device, counted off the census.
//!
//! Every progress figure before this one was the current run's own queue, so a
//! library of 1,598 rides with 400 tracks stored reported "12/12" and then
//! nothing. The census says what the account holds; `activity_bodies` and
//! `gps_tracks` say what the device has, and the difference is what the sync
//! row reports.
//!
//! Two pairs, because they converge at different times: the activity pages
//! arrive with the window syncs and the tracks with the GPS pass.
//!
//! Run: `cargo test --test app -p veloqrs -- library_coverage::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::net::types::ActivityCensusEntry;
use veloqrs::{GpsPoint, LibraryCoverage};

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    PersistentEngine::new(path.to_str().expect("utf-8")).expect("open")
}

fn entry(id: &str, day: &str, has_latlng: bool) -> ActivityCensusEntry {
    ActivityCensusEntry {
        id: id.to_string(),
        start_date_local: Some(format!("{day}T06:00:00")),
        created: Some(format!("{day}T00:00:00Z")),
        icu_sync_date: Some(format!("{day}T00:10:00Z")),
        has_latlng,
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

/// Two rides with a track upstream and one indoor session, all three stored and
/// marked, and one of the two tracks on the device.
fn partly_downloaded(dir: &TempDir) -> PersistentEngine {
    let mut engine = engine(dir);
    let census = [
        entry("a1", "2026-03-02", true),
        entry("a2", "2026-03-09", true),
        entry("a3", "2026-03-16", false),
    ];
    engine
        .record_activity_census("i1", &census)
        .expect("census");
    for (i, e) in census.iter().enumerate() {
        store_body(&mut engine, &e.id, 1_770_000_000 + i as i64);
    }
    store_track(&mut engine, "a1");
    engine
}

#[test]
fn a_library_reports_both_pairs_against_the_whole_account() {
    let dir = TempDir::new().expect("tempdir");
    let engine = partly_downloaded(&dir);

    assert_eq!(
        engine.library_coverage("i1"),
        LibraryCoverage {
            upstream: 3,
            fetched: 3,
            tracks_upstream: 2,
            tracks_stored: 1,
        }
    );
}

/// The point of the item: an athlete whose census was never pulled must not be
/// reported as fully downloaded, and must not be reported at all.
#[test]
fn an_athlete_with_no_census_answers_zeros() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);

    assert_eq!(engine.library_coverage("i1"), LibraryCoverage::default());
    assert_eq!(engine.library_coverage(""), LibraryCoverage::default());
}

/// One row the device never stored lowers `fetched` and nothing else.
#[test]
fn a_row_never_stored_is_short_of_fetched() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    let census = [
        entry("a1", "2026-03-02", true),
        entry("a2", "2026-03-09", true),
    ];
    engine
        .record_activity_census("i1", &census)
        .expect("census");
    store_body(&mut engine, "a1", 1_770_000_000);

    let coverage = engine.library_coverage("i1");

    assert_eq!(coverage.upstream, 2);
    assert_eq!(coverage.fetched, 1);
    assert_eq!(coverage.tracks_upstream, 2);
    assert_eq!(coverage.tracks_stored, 0);
}

/// A row edited upstream since the download owes it again, on the same
/// predicate the sync and the charts use.
#[test]
fn a_row_that_moved_upstream_since_the_fetch_is_short_of_fetched() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = partly_downloaded(&dir);
    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-03-02", true),
                ActivityCensusEntry {
                    icu_sync_date: Some("2026-03-11T08:00:00Z".to_string()),
                    ..entry("a2", "2026-03-09", true)
                },
                entry("a3", "2026-03-16", false),
            ],
        )
        .expect("census");

    let coverage = engine.library_coverage("i1");

    assert_eq!(coverage.upstream, 3);
    assert_eq!(coverage.fetched, 2);
}

/// An indoor session counts in the library and never in the track pair, so the
/// two fractions can agree while only one of them was ever downloadable.
#[test]
fn an_activity_with_no_track_upstream_is_outside_the_track_pair() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .record_activity_census("i1", &[entry("a1", "2026-03-02", false)])
        .expect("census");
    store_body(&mut engine, "a1", 1_770_000_000);

    let coverage = engine.library_coverage("i1");

    assert_eq!(coverage.upstream, 1);
    assert_eq!(coverage.fetched, 1);
    assert_eq!(coverage.tracks_upstream, 0);
    assert_eq!(coverage.tracks_stored, 0);
}

/// The census is keyed on the athlete, so a second sign-in never reads the
/// first one's library as its own.
#[test]
fn a_second_athlete_reads_none_of_the_first_ones_library() {
    let dir = TempDir::new().expect("tempdir");
    let engine = partly_downloaded(&dir);

    assert_eq!(engine.library_coverage("i2"), LibraryCoverage::default());
}

fn days_ago(days: i64) -> String {
    (chrono::Local::now().date_naive() - chrono::Duration::days(days)).to_string()
}

/// Ten rides inside the default window, all fetched, and fifty dated two
/// years back that no download has reached.
fn recent_and_old(dir: &TempDir) -> PersistentEngine {
    let mut engine = engine(dir);
    let recent: Vec<_> = (0..10)
        .map(|i| entry(&format!("r{i}"), &days_ago(5 + i), true))
        .collect();
    let old: Vec<_> = (0..50)
        .map(|i| entry(&format!("o{i}"), &days_ago(730 + i), true))
        .collect();
    engine
        .record_activity_census("i1", &[recent.clone(), old].concat())
        .expect("census");
    for (i, e) in recent.iter().enumerate() {
        store_body(&mut engine, &e.id, 1_770_000_000 + i as i64);
    }
    engine
}

fn pair(coverage: LibraryCoverage) -> (i64, i64) {
    (coverage.upstream as i64, coverage.fetched as i64)
}

#[test]
fn rows_older_than_the_default_window_are_outside_the_count() {
    let dir = TempDir::new().expect("tempdir");
    let engine = recent_and_old(&dir);

    assert_eq!(pair(engine.library_coverage("i1")), (10, 10));
}

#[test]
fn an_ask_reaching_back_brings_its_rows_into_the_count() {
    let dir = TempDir::new().expect("tempdir");
    let engine = recent_and_old(&dir);

    engine
        .record_activity_window("i1", &days_ago(3 * 365))
        .expect("record");

    assert_eq!(pair(engine.library_coverage("i1")), (60, 10));
}

#[test]
fn a_shorter_later_ask_never_narrows_the_window() {
    let dir = TempDir::new().expect("tempdir");
    let engine = recent_and_old(&dir);
    engine
        .record_activity_window("i1", &days_ago(3 * 365))
        .expect("record");

    engine
        .record_activity_window("i1", &days_ago(365))
        .expect("record");

    assert_eq!(pair(engine.library_coverage("i1")), (60, 10));
}

#[test]
fn another_athletes_window_does_not_move_this_ones_count() {
    let dir = TempDir::new().expect("tempdir");
    let engine = recent_and_old(&dir);
    engine
        .record_activity_window("i2", &days_ago(3 * 365))
        .expect("record");

    assert_eq!(pair(engine.library_coverage("i1")), (10, 10));
}

#[test]
fn an_empty_athlete_records_nothing_and_reads_zeros() {
    let dir = TempDir::new().expect("tempdir");
    let engine = engine(&dir);

    engine
        .record_activity_window("", &days_ago(3 * 365))
        .expect("record");

    assert_eq!(engine.library_coverage(""), LibraryCoverage::default());
    assert_eq!(
        engine.get_setting("__activity_window_oldest:").unwrap(),
        None
    );
}

/// An install upgrading with no stored window keeps a library it had already
/// widened: the oldest stored activity says how far back the athlete went.
#[test]
fn an_upgraded_library_seeds_its_window_from_its_oldest_stored_activity() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = recent_and_old(&dir);
    let two_years = chrono::Local::now().timestamp() - 730 * 86_400;
    for i in 0..50 {
        store_body(&mut engine, &format!("o{i}"), two_years - i * 86_400);
    }

    assert_eq!(pair(engine.library_coverage("i1")), (60, 60));
}
