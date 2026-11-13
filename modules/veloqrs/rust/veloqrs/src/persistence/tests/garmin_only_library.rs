//! Scenario: a library whose only source is a Garmin key holds `src-garmin-`
//! rows and no census, and no intervals.icu credential names an athlete.
//!
//! Expected behaviour: the coverage reads count those rows and judge ranges by
//! how far the backfill has reached, the activity window reaches back to the
//! backfill's cursor, and a restored record naming a Garmin key waits for the
//! backfill to store that ride rather than being counted as lost.

use super::*;
use crate::fit_synthetic::outdoor_ride;
use crate::net::garmin::ingest::ingest_into;
use crate::net::garmin::pull::{BACKFILL_DONE, CURSOR};
use crate::net::garmin::wire::ListedActivity;
use crate::persistence::activities::pooled;
use crate::persistence::origin::garmin_source_key;
use crate::{LibraryCoverage, RangeCoverage};
use serde_json::json;
use tempfile::TempDir;

fn engine() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    (dir, engine)
}

fn listed(id: i64) -> ListedActivity {
    serde_json::from_value(json!({
        "activityId": id,
        "activityName": "Lake loop",
        "startTimeLocal": "2026-03-14 09:00:00",
        "startTimeGMT": "2026-03-14 07:00:00",
        "activityType": {"typeKey": "cycling"},
        "duration": 99.0,
        "elapsedDuration": 99.0,
        "distance": 1.0
    }))
    .unwrap()
}

fn store(dir: &TempDir, engine: &mut PersistentEngine, id: i64) {
    let path = dir
        .path()
        .join("recordings")
        .join(format!("{}.fit", garmin_source_key(id)));
    ingest_into(engine, Some(&path), &listed(id), &outdoor_ride().to_fit()).expect("stored");
}

fn library_of_three() -> (TempDir, PersistentEngine) {
    let (dir, mut engine) = engine();
    for id in [11, 12, 13] {
        store(&dir, &mut engine, id);
    }
    engine.set_setting(CURSOR, "2026-01-10").unwrap();
    (dir, engine)
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn library_coverage_counts_the_garmin_rows_with_no_credential() {
    let (_dir, engine) = library_of_three();
    let coverage = pooled::library_coverage(&engine.db, "");
    assert_eq!(
        coverage,
        LibraryCoverage {
            upstream: 3,
            fetched: 3,
            tracks_upstream: 3,
            tracks_stored: 3,
        }
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_library_with_no_credential_still_reports_nothing() {
    let (_dir, engine) = engine();
    assert_eq!(
        pooled::library_coverage(&engine.db, ""),
        LibraryCoverage::default()
    );
    assert_eq!(
        pooled::range_coverage(&engine.db, "", "2026-01-01", "2026-12-31"),
        RangeCoverage::NotFetched
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_range_is_loaded_or_empty_only_inside_what_the_backfill_reached() {
    let (_dir, engine) = library_of_three();
    let range = |from, to| pooled::range_coverage(&engine.db, "", from, to);
    assert_eq!(range("2026-03-01", "2026-03-31"), RangeCoverage::Loaded);
    assert_eq!(range("2026-04-01", "2026-04-30"), RangeCoverage::Empty);
    assert_eq!(range("2025-06-01", "2025-06-30"), RangeCoverage::NotFetched);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_finished_backfill_makes_every_older_range_empty() {
    let (_dir, engine) = library_of_three();
    engine.set_setting(BACKFILL_DONE, "1").unwrap();
    assert_eq!(
        pooled::range_coverage(&engine.db, "", "2025-06-01", "2025-06-30"),
        RangeCoverage::Empty
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_activity_window_reaches_back_to_the_backfill() {
    let (_dir, engine) = library_of_three();
    let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 12).unwrap();
    assert_eq!(
        pooled::activity_window_oldest_on(&engine.db, "garmin:77", today),
        "2026-01-10"
    );
    assert_eq!(
        pooled::activity_window_oldest_on(&engine.db, "", today),
        "2026-01-10"
    );
}

fn history_naming(ride_id: &str) -> String {
    json!({"version": 1, "entries": [{
        "table": "section_history",
        "values": {"section_id": "gone-id", "at": "2025-01-01 00:00:00",
            "kind": "dissolved", "details": "{}"},
        "ground": {"rep_activity_id": ride_id, "rep_start_index": 10,
            "rep_end_index": 40, "point_count": 80, "polyline_json": null}
    }]})
    .to_string()
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_record_naming_a_garmin_key_waits_for_the_backfill_to_store_it() {
    let (dir, mut engine) = engine();
    let key = garmin_source_key(7);
    let result = engine.restore_record_json(&history_naming(&key)).unwrap();
    assert_eq!((result.unplaced, result.not_restored), (1, 0));
    assert_eq!(engine.settle_record_restore().unwrap().not_restored, 0);
    assert_eq!(engine.unplaced_records().unwrap().len(), 1);

    store(&dir, &mut engine, 7);
    assert!(engine.has_stored_activity(&key));
    // Once the ride is held the record is judged by the ordinary rule, which
    // cannot rebuild a ground of 80 points from this ride's track.
    let after = engine.retry_record_restore().unwrap();
    assert_eq!((after.unplaced, after.not_restored), (0, 1));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_record_naming_a_garmin_key_is_given_up_once_the_backfill_is_done() {
    let (_dir, mut engine) = engine();
    engine.set_setting(BACKFILL_DONE, "1").unwrap();
    let result = engine
        .restore_record_json(&history_naming(&garmin_source_key(7)))
        .unwrap();
    assert_eq!((result.unplaced, result.not_restored), (0, 1));
}
