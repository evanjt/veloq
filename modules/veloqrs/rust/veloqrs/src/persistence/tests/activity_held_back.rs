//! Scenario: a list page holds one activity intervals.icu answered as an empty
//! stub beside one it served in full, and a later page serves the stub's
//! activity in full.
//!
//! Expected behaviour: the stub is marked held back with its source and
//! external id and the ordinary one is not, the stream and elevation queues
//! leave the held-back one out, the activity screen read carries the mark, and
//! a later full body clears it.

use super::{ActivityHeldBack, begin_download, new_in_last_download, of};
use crate::persistence::PersistentEngine;
use crate::persistence::screens::pooled::activity_detail_data;
use rusqlite::params;

const STUB: &str = r#"{"id":"h1","start_date_local":"2025-03-01T07:30:00","type":"Ride","source":"GARMIN_CONNECT","external_id":"24686966034","_note":"not available via the API"}"#;
const SERVED: &str = r#"{"id":"h2","start_date_local":"2025-03-02T07:30:00","type":"Ride","source":"STRAVA","external_id":"99","distance":12000.0,"moving_time":1800}"#;
const SERVED_H1: &str = r#"{"id":"h1","start_date_local":"2025-03-01T07:30:00","type":"Ride","source":"GARMIN_CONNECT","external_id":"24686966034","distance":15000.0,"moving_time":2400}"#;

fn engine_with_page(bodies: &[(&str, i64, &str)]) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("in-memory engine");
    store_page(&mut engine, bodies);
    for (id, _, _) in bodies {
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
                 VALUES (?1, 'Ride', 0, 0, 0, 0, 1740000000)",
                params![id],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO gps_tracks (activity_id, track_data, point_count, elevation_state)
                 VALUES (?1, X'00', 10, ?2)",
                params![id, i64::from(crate::persistence::ELEVATION_STATE_UNKNOWN)],
            )
            .unwrap();
    }
    engine
}

fn store_page(engine: &mut PersistentEngine, bodies: &[(&str, i64, &str)]) {
    let rows: Vec<(String, i64, String)> = bodies
        .iter()
        .map(|(id, date, raw)| (id.to_string(), *date, raw.to_string()))
        .collect();
    let ids: Vec<String> = bodies.iter().map(|(id, _, _)| id.to_string()).collect();
    let metrics = ids
        .iter()
        .zip(bodies)
        .map(|(id, (_, date, _))| crate::ActivityMetrics {
            activity_id: id.clone(),
            date: *date,
            ..Default::default()
        })
        .collect();
    engine
        .store_synced_activity_bodies("i1", &rows, &ids, metrics)
        .expect("page stores");
}

#[test]
fn a_stub_is_marked_held_back_and_a_served_activity_is_not() {
    let engine = engine_with_page(&[("h1", 1_740_800_000, STUB), ("h2", 1_740_900_000, SERVED)]);

    assert_eq!(
        of(&engine.db, "h1").unwrap(),
        Some(ActivityHeldBack {
            source: Some("GARMIN_CONNECT".into()),
            external_id: Some("24686966034".into()),
        })
    );
    assert_eq!(of(&engine.db, "h2").unwrap(), None);
}

#[test]
fn the_stream_and_elevation_queues_leave_a_held_back_activity_out() {
    let engine = engine_with_page(&[("h1", 1_740_800_000, STUB), ("h2", 1_740_900_000, SERVED)]);

    let streams: Vec<String> = engine
        .activities_missing_streams(3)
        .unwrap()
        .into_iter()
        .map(|gap| gap.activity_id)
        .collect();
    assert_eq!(streams, vec!["h2".to_string()]);
    assert_eq!(engine.stream_backfill_remaining(3).unwrap(), 1);

    let elevation: Vec<String> = engine
        .tracks_missing_elevation()
        .unwrap()
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert_eq!(elevation, vec!["h2".to_string()]);
    assert_eq!(engine.elevation_backfill_remaining().unwrap(), 1);
}

#[test]
fn the_activity_screen_read_reports_the_mark() {
    let engine = engine_with_page(&[("h1", 1_740_800_000, STUB), ("h2", 1_740_900_000, SERVED)]);

    let held = activity_detail_data(&engine.db, "h1", 1).held_back;
    assert_eq!(
        held.expect("marked").source.as_deref(),
        Some("GARMIN_CONNECT")
    );
    assert!(
        activity_detail_data(&engine.db, "h2", 1)
            .held_back
            .is_none()
    );
}

#[test]
fn a_later_full_body_clears_the_mark() {
    let mut engine = engine_with_page(&[("h1", 1_740_800_000, STUB)]);
    assert!(of(&engine.db, "h1").unwrap().is_some());

    store_page(&mut engine, &[("h1", 1_740_800_000, SERVED_H1)]);

    assert_eq!(of(&engine.db, "h1").unwrap(), None);
}

#[test]
fn a_download_counts_the_stubs_not_held_before_and_a_repeat_counts_none() {
    let stub = |id: &str| {
        format!(
            r#"{{"id":"{id}","start_date_local":"2025-03-01T07:30:00","type":"Ride","source":"GARMIN_CONNECT","external_id":"1{id}","_note":"not available via the API"}}"#
        )
    };
    let stubs = [stub("s1"), stub("s2"), stub("s3")];
    let page: Vec<(&str, i64, &str)> = ["s1", "s2", "s3"]
        .iter()
        .zip(&stubs)
        .map(|(id, raw)| (*id, 1_740_800_000, raw.as_str()))
        .collect();
    let mut engine = PersistentEngine::in_memory().expect("in-memory engine");
    assert_eq!(new_in_last_download(&engine.db).unwrap(), 0);

    begin_download(&engine.db).unwrap();
    store_page(&mut engine, &page);
    assert_eq!(new_in_last_download(&engine.db).unwrap(), 3);

    begin_download(&engine.db).unwrap();
    store_page(&mut engine, &page);
    assert_eq!(new_in_last_download(&engine.db).unwrap(), 0);
}

#[test]
fn a_page_adds_to_the_count_until_the_next_download_begins() {
    let mut engine = PersistentEngine::in_memory().expect("in-memory engine");
    begin_download(&engine.db).unwrap();
    store_page(&mut engine, &[("h1", 1_740_800_000, STUB)]);
    store_page(&mut engine, &[("h2", 1_740_900_000, SERVED)]);
    assert_eq!(new_in_last_download(&engine.db).unwrap(), 1);

    store_page(&mut engine, &[("h1", 1_740_800_000, SERVED_H1)]);
    store_page(&mut engine, &[("h1", 1_740_800_000, STUB)]);
    assert_eq!(new_in_last_download(&engine.db).unwrap(), 2);
}
