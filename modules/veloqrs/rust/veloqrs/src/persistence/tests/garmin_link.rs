//! Scenario: a Garmin original and the intervals.icu activity that holds the
//! same ride reach the library in either order, as a stub or served in full.
//!
//! Expected behaviour: one row whichever arrives first. It keeps the original's
//! track, takes intervals.icu's id, takes intervals.icu's body when it is
//! served and keeps its own when it is a stub. More than one candidate naming
//! the id links nothing, and a linked row is never offered to the upload. A
//! copy that does not name the id is never linked, whatever its start, sport
//! and length.

use super::*;
use crate::fit_synthetic::outdoor_ride;
use crate::net::garmin::ingest::ingest_into;
use crate::net::garmin::wire::ListedActivity;
use crate::persistence::activity_held_back;
use crate::persistence::origin::{ActivityProvenance, garmin_source_key};
use crate::persistence::screens::pooled::activity_detail_data;
use serde_json::json;
use tempfile::TempDir;

const GARMIN_ID: i64 = 24_686_966_034;

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

/// The original of `id`: a thirty second ride starting at 09:00 local.
fn store_original(dir: &TempDir, engine: &mut PersistentEngine, id: i64) -> String {
    let key = garmin_source_key(id);
    let path = dir.path().join("recordings").join(format!("{key}.fit"));
    ingest_into(engine, Some(&path), &listed(id), &outdoor_ride().to_fit()).expect("stored");
    key
}

fn served(id: &str, external: serde_json::Value, start: &str, elapsed: i64) -> String {
    let mut body = json!({
        "id": id,
        "start_date_local": start,
        "type": "Ride",
        "name": "Morning ride",
        "moving_time": 28,
        "elapsed_time": elapsed,
        "distance": 171.5,
        "icu_training_load": 61.0,
    });
    if !external.is_null() {
        body["external_id"] = external;
        body["source"] = json!("GARMIN_CONNECT");
    }
    body.to_string()
}

fn stub(id: &str, external: &str) -> String {
    json!({
        "id": id,
        "start_date_local": "2026-03-14T09:00:00",
        "type": "Ride",
        "source": "GARMIN_CONNECT",
        "external_id": external,
        "_note": "not available via the API"
    })
    .to_string()
}

fn sync_page(engine: &mut PersistentEngine, page: &[(&str, String)]) {
    let rows: Vec<(String, i64, String)> = page
        .iter()
        .map(|(id, raw)| {
            let record: ActivityRecord = serde_json::from_str(raw).unwrap();
            let date =
                crate::objects::sync::start_date_to_timestamp(record.start_date_local.as_deref())
                    .unwrap();
            (id.to_string(), date, raw.clone())
        })
        .collect();
    let ids: Vec<String> = page.iter().map(|(id, _)| id.to_string()).collect();
    let metrics = rows
        .iter()
        .map(|(id, date, raw)| crate::net::intervals::metrics_from_body(raw, *date, id).unwrap())
        .collect();
    engine
        .store_synced_activity_bodies("athlete", &rows, &ids, metrics)
        .expect("page stores");
}

#[derive(Clone, Copy, Debug)]
enum Arrives {
    OriginalFirst,
    CopyFirst,
}

const BOTH: [Arrives; 2] = [Arrives::OriginalFirst, Arrives::CopyFirst];

/// The library after the original and `page` have both arrived, in `order`.
fn library(order: Arrives, page: &[(&str, String)]) -> (TempDir, PersistentEngine, String) {
    let (dir, mut engine) = engine();
    let key = garmin_source_key(GARMIN_ID);
    match order {
        Arrives::OriginalFirst => {
            store_original(&dir, &mut engine, GARMIN_ID);
            sync_page(&mut engine, page);
        }
        Arrives::CopyFirst => {
            sync_page(&mut engine, page);
            store_original(&dir, &mut engine, GARMIN_ID);
        }
    }
    (dir, engine, key)
}

fn body_of(engine: &PersistentEngine, key: &str) -> serde_json::Value {
    serde_json::from_str(&engine.get_activity_body(key).expect("a stored body")).unwrap()
}

fn assert_one_row(engine: &PersistentEngine, key: &str, intervals_id: &str, at: &str) {
    assert_eq!(
        engine.intervals_id(key).as_deref(),
        Some(intervals_id),
        "{at}"
    );
    assert_eq!(
        engine.activity_id_for_intervals_id(intervals_id).as_deref(),
        Some(key),
        "{at}"
    );
    if intervals_id != key {
        assert!(
            engine.get_activity_body(intervals_id).is_none(),
            "{at}: a second row"
        );
    }
    assert_eq!(
        engine.get_gps_track(key).expect("the track").len(),
        30,
        "{at}"
    );
    assert!(
        originals_to_offer(&engine.db).unwrap().is_empty(),
        "{at}: offered"
    );
    assert_eq!(
        unresolved_candidates(&engine.db, key).unwrap(),
        None,
        "{at}"
    );
}

#[test]
fn an_activity_naming_the_garmin_id_and_the_original_become_one_row_in_either_order() {
    for order in BOTH {
        let at = format!("{order:?}");
        let page = [(
            "i500",
            served("i500", json!("24686966034"), "2026-03-14T09:00:00", 30),
        )];
        let (_dir, engine, key) = library(order, &page);

        assert_one_row(&engine, &key, "i500", &at);
        let body = body_of(&engine, &key);
        assert_eq!(
            body["distance"], 171.5,
            "{at}: intervals.icu's number fills in"
        );
        assert_eq!(body["icu_training_load"], 61.0, "{at}");
        assert!(
            activity_held_back::of(&engine.db, &key).unwrap().is_none(),
            "{at}"
        );
    }
}

#[test]
fn a_stub_links_the_same_way_and_leaves_the_original_as_it_was() {
    for order in BOTH {
        let at = format!("{order:?}");
        let page = [("i500", stub("i500", "24686966034"))];
        let (_dir, mut engine, key) = library(order, &page);

        assert_one_row(&engine, &key, "i500", &at);
        let body = body_of(&engine, &key);
        assert_eq!(body["name"], "Lake loop", "{at}");
        assert_eq!(body["distance"], 174.0, "{at}");
        assert!(body.get("_note").is_none(), "{at}: the stub's body");
        assert!(
            activity_held_back::of(&engine.db, &key).unwrap().is_none(),
            "{at}"
        );
        assert!(
            activity_held_back::of(&engine.db, "i500")
                .unwrap()
                .is_none(),
            "{at}"
        );

        sync_page(&mut engine, &page);
        let again = body_of(&engine, &key);
        assert_eq!(again["distance"], 174.0, "{at}: a second sync of the stub");
        assert_one_row(&engine, &key, "i500", &at);
    }
}

/// Scenario: a Garmin original is linked to the intervals.icu activity that
/// holds the same ride, and the athlete opens that activity.
///
/// Expected behaviour: the activity screen read says the ride is filled from
/// the Garmin file on this phone, and an activity intervals.icu holds alone
/// reads as intervals.icu's own.
#[test]
fn a_linked_original_reads_as_filled_from_the_phone_and_an_upstream_ride_as_intervals() {
    for order in BOTH {
        let at = format!("{order:?}");
        let page = [(
            "i500",
            served("i500", json!("24686966034"), "2026-03-14T09:00:00", 30),
        )];
        let (_dir, engine, key) = library(order, &page);

        assert_eq!(
            activity_detail_data(&engine.db, &key, 1).provenance,
            ActivityProvenance::GarminOnPhone,
            "{at}"
        );
    }

    let (_dir, mut engine) = engine();
    let page = [(
        "i900",
        served("i900", json!(null), "2026-05-01T07:00:00", 30),
    )];
    sync_page(&mut engine, &page);
    assert_eq!(
        activity_detail_data(&engine.db, "i900", 1).provenance,
        ActivityProvenance::Intervals
    );
}

#[test]
fn the_form_an_upload_writes_names_the_garmin_id_too() {
    for order in BOTH {
        let page = [(
            "i500",
            served(
                "i500",
                json!("garmin:24686966034"),
                "2026-03-14T09:00:00",
                30,
            ),
        )];
        let (_dir, engine, key) = library(order, &page);
        assert_one_row(&engine, &key, "i500", &format!("{order:?}"));
    }
}

#[test]
fn an_activity_without_the_garmin_id_is_not_linked_whatever_its_start_and_length() {
    let cases = [
        (
            "the same start, sport and length",
            served("i500", json!(null), "2026-03-14T09:00:00", 30),
        ),
        (
            "a start 3 minutes later",
            served("i500", json!(null), "2026-03-14T09:03:00", 30),
        ),
        (
            "a length a fifth longer",
            served("i500", json!(null), "2026-03-14T09:00:00", 36),
        ),
        (
            "another Garmin ride at the same time",
            served("i500", json!("24686966099"), "2026-03-14T09:00:00", 30),
        ),
        (
            "another sport",
            served("i500", json!(null), "2026-03-14T09:00:00", 30).replace("Ride", "Run"),
        ),
    ];
    for order in BOTH {
        for (name, raw) in &cases {
            let at = format!("{order:?}, {name}");
            let (_dir, engine, key) = library(order, &[("i500", raw.clone())]);

            assert_eq!(engine.intervals_id(&key), None, "{at}");
            assert!(
                engine.get_activity_body("i500").is_some(),
                "{at}: the copy stays"
            );
            assert_eq!(
                originals_to_offer(&engine.db).unwrap(),
                vec![key.clone()],
                "{at}"
            );
            assert_eq!(
                unresolved_candidates(&engine.db, &key).unwrap(),
                None,
                "{at}"
            );
        }
    }
}

#[test]
fn two_candidates_naming_the_garmin_id_link_nothing_and_leave_the_original_marked() {
    let page = [
        (
            "i500",
            served("i500", json!("24686966034"), "2026-03-14T09:00:30", 30),
        ),
        (
            "i501",
            served("i501", json!("24686966034"), "2026-03-14T09:01:00", 30),
        ),
    ];
    for order in BOTH {
        let at = format!("{order:?}");
        let (_dir, engine, key) = library(order, &page);

        assert_eq!(engine.intervals_id(&key), None, "{at}");
        assert!(engine.get_activity_body("i500").is_some(), "{at}");
        assert!(engine.get_activity_body("i501").is_some(), "{at}");
        assert_eq!(
            unresolved_candidates(&engine.db, &key).unwrap(),
            Some(2),
            "{at}"
        );
        assert!(
            originals_to_offer(&engine.db).unwrap().is_empty(),
            "{at}: an ambiguous original is not offered"
        );
    }
}

#[test]
fn an_original_nothing_holds_is_offered_and_a_linked_one_is_not() {
    let (dir, mut engine) = engine();
    let linked = store_original(&dir, &mut engine, GARMIN_ID);
    let unlinked = store_original(&dir, &mut engine, GARMIN_ID + 7);
    sync_page(&mut engine, &[("i500", stub("i500", "24686966034"))]);

    assert_eq!(engine.intervals_id(&linked).as_deref(), Some("i500"));
    assert_eq!(originals_to_offer(&engine.db).unwrap(), vec![unlinked]);
}

#[test]
fn a_linked_original_is_never_reconciled_away_when_its_activity_leaves_intervals() {
    for order in BOTH {
        let page = [("i500", stub("i500", "24686966034"))];
        let (_dir, mut engine, key) = library(order, &page);
        assert_eq!(engine.intervals_id(&key).as_deref(), Some("i500"));

        let candidates = engine.census_candidates("2030-01-01");
        assert!(
            !candidates.iter().any(|(id, _)| id == &key),
            "{order:?}: {candidates:?}"
        );
        let removed = engine.reconcile_against_census(&["i1".to_string()], "2030-01-01");
        assert!(removed.is_empty(), "{order:?}: {removed:?}");
        assert!(engine.has_stored_activity(&key), "{order:?}");
    }
}

#[test]
fn a_candidate_naming_the_id_is_the_match_and_a_second_naming_it_is_ambiguous() {
    let candidate = |id: &str, names: Option<i64>| Candidate {
        upstream_id: id.to_string(),
        key: None,
        names,
    };

    let by_id = [candidate("i1", None), candidate("i2", Some(7))];
    assert_eq!(resolve(7, &by_id), Matched::One("i2".into()));

    let twice = [candidate("i1", Some(7)), candidate("i2", Some(7))];
    assert_eq!(
        resolve(7, &twice),
        Matched::Ambiguous(vec!["i1".into(), "i2".into()])
    );

    let other = [candidate("i1", Some(8))];
    assert_eq!(resolve(7, &other), Matched::Nothing, "another ride's id");

    let unnamed = [candidate("i1", None)];
    assert_eq!(
        resolve(7, &unnamed),
        Matched::Nothing,
        "the same start, sport and length without the id"
    );

    let one_listed_twice = [candidate("i1", Some(7)), candidate("i1", Some(7))];
    assert_eq!(resolve(7, &one_listed_twice), Matched::One("i1".into()));
}
