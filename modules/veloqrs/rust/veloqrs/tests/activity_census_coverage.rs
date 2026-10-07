//! The census pull is the only call that sees the whole history, and until now
//! its rows were reduced to a list of ids, used once to reconcile and dropped.
//! Nothing durable said which activities the account holds, so every launch had
//! to assume it held none.
//!
//! What is stored is what intervals.icu said, under the athlete it said it for:
//! the id, when the activity was created and when it last changed upstream.
//! Whether the device has that activity is a separate question, answered by
//! joining these rows against the ones it stored.
//!
//! Run: `cargo test --test persistence -p veloqrs -- activity_census_coverage::`

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::net::types::ActivityCensusEntry;

fn engine(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("routes.db");
    PersistentEngine::new(path.to_str().expect("utf-8")).expect("open")
}

fn entry(id: &str, created: &str, synced: &str) -> ActivityCensusEntry {
    ActivityCensusEntry {
        id: id.to_string(),
        start_date_local: Some(format!("{}T06:00:00", &created[..10])),
        created: Some(created.to_string()),
        icu_sync_date: Some(synced.to_string()),
        has_latlng: false,
    }
}

fn synced_dates(engine: &PersistentEngine, athlete: &str) -> Vec<(String, Option<String>)> {
    let mut rows: Vec<(String, Option<String>)> = engine
        .activity_census(athlete)
        .into_iter()
        .map(|e| (e.id, e.icu_sync_date))
        .collect();
    rows.sort();
    rows
}

#[test]
fn a_census_is_stored_under_the_athlete_it_was_pulled_for() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);

    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-01-02T00:00:00Z", "2026-01-02T00:10:00Z"),
                entry("a2", "2026-02-03T00:00:00Z", "2026-02-03T00:10:00Z"),
            ],
        )
        .expect("census");

    let stored = engine.activity_census("i1");
    assert_eq!(stored.len(), 2);
    let first = stored.iter().find(|e| e.id == "a1").expect("a1 stored");
    assert_eq!(first.created.as_deref(), Some("2026-01-02T00:00:00Z"));
    assert_eq!(first.icu_sync_date.as_deref(), Some("2026-01-02T00:10:00Z"));
    assert_eq!(
        first.start_date_local.as_deref(),
        Some("2026-01-02T06:00:00")
    );
}

#[test]
fn a_second_pass_moves_the_row_that_changed_and_leaves_the_rest() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-01-02T00:00:00Z", "2026-01-02T00:10:00Z"),
                entry("a2", "2026-02-03T00:00:00Z", "2026-02-03T00:10:00Z"),
            ],
        )
        .expect("census");

    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-01-02T00:00:00Z", "2026-01-02T00:10:00Z"),
                entry("a2", "2026-02-03T00:00:00Z", "2026-09-14T08:00:00Z"),
            ],
        )
        .expect("census");

    assert_eq!(
        synced_dates(&engine, "i1"),
        vec![
            ("a1".to_string(), Some("2026-01-02T00:10:00Z".to_string())),
            ("a2".to_string(), Some("2026-09-14T08:00:00Z".to_string())),
        ]
    );
}

#[test]
fn an_id_the_new_census_drops_leaves_the_table() {
    // The pull spans all history, so an id it does not carry is gone upstream.
    // Leaving the row would answer "already fetched" for an activity that no
    // longer exists.
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .record_activity_census(
            "i1",
            &[
                entry("a1", "2026-01-02T00:00:00Z", "2026-01-02T00:10:00Z"),
                entry("a2", "2026-02-03T00:00:00Z", "2026-02-03T00:10:00Z"),
            ],
        )
        .expect("census");

    engine
        .record_activity_census(
            "i1",
            &[entry("a1", "2026-01-02T00:00:00Z", "2026-01-02T00:10:00Z")],
        )
        .expect("census");

    assert_eq!(
        synced_dates(&engine, "i1"),
        vec![("a1".to_string(), Some("2026-01-02T00:10:00Z".to_string()))]
    );
}

#[test]
fn an_empty_census_is_refused_rather_than_wiping_the_athlete() {
    // An errored pull and an athlete who deleted everything are the same empty
    // list here, and `reconcile_against_census` refuses one for that reason.
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .record_activity_census(
            "i1",
            &[entry("a1", "2026-01-02T00:00:00Z", "2026-01-02T00:10:00Z")],
        )
        .expect("census");

    engine.record_activity_census("i1", &[]).expect("census");

    assert_eq!(engine.activity_census("i1").len(), 1);
}

#[test]
fn a_second_athletes_census_leaves_the_firsts_standing() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);
    engine
        .record_activity_census(
            "i1",
            &[entry("a1", "2026-01-02T00:00:00Z", "2026-01-02T00:10:00Z")],
        )
        .expect("census");

    engine
        .record_activity_census(
            "i2",
            &[entry("b1", "2026-03-04T00:00:00Z", "2026-03-04T00:10:00Z")],
        )
        .expect("census");

    assert_eq!(
        synced_dates(&engine, "i1"),
        vec![("a1".to_string(), Some("2026-01-02T00:10:00Z".to_string()))]
    );
    assert_eq!(
        synced_dates(&engine, "i2"),
        vec![("b1".to_string(), Some("2026-03-04T00:10:00Z".to_string()))]
    );
}

/// The flag that says a ride has a track upstream is written and read back with
/// the rest of the census, so the GPS fetch list and the download count are a
/// query rather than a pass over every stored body.
#[test]
fn a_census_records_which_activities_have_a_track_upstream() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine(&dir);

    let mut with_track = entry("a1", "2026-01-02T00:00:00Z", "2026-01-02T00:10:00Z");
    with_track.has_latlng = true;
    let without = entry("a2", "2026-02-03T00:00:00Z", "2026-02-03T00:10:00Z");
    engine
        .record_activity_census("i1", &[with_track, without])
        .expect("census");

    fn flag(engine: &PersistentEngine, id: &str) -> Option<bool> {
        engine
            .activity_census("i1")
            .into_iter()
            .find(|e| e.id == id)
            .map(|e| e.has_latlng)
    }
    assert_eq!(flag(&engine, "a1"), Some(true));
    assert_eq!(flag(&engine, "a2"), Some(false));

    // A second pull is the only thing that moves it: a track added upstream
    // arrives with the next census rather than being watched for between syncs.
    let mut now_has_one = entry("a2", "2026-02-03T00:00:00Z", "2026-02-04T00:10:00Z");
    now_has_one.has_latlng = true;
    engine
        .record_activity_census("i1", &[now_has_one])
        .expect("census");
    assert_eq!(flag(&engine, "a2"), Some(true));
}
