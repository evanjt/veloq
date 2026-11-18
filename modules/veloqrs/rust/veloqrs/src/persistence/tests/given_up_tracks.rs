//! Scenario: the engine stops asking for a track after the limit of settled
//! failed runs, and the notice has to name those activities.
//!
//! Expected behaviour: the read lists the census rows at the limit for the
//! version they still name, newest first, with the stored name and start. A
//! moved version, a refusal, another athlete's row and a landed track are not
//! listed.

use super::TRACK_FAILURE_LIMIT;
use crate::persistence::PersistentEngine;

fn add(engine: &PersistentEngine, athlete: &str, id: &str, name: &str, start: &str) {
    engine
        .db
        .execute(
            "INSERT INTO activity_census
                 (athlete_id, intervals_id, start_date_local, icu_sync_date, has_latlng)
             VALUES (?1, ?2, ?3, 'v1', 1)",
            rusqlite::params![athlete, id, start],
        )
        .expect("census row");
    engine
        .db
        .execute(
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, 0, ?2)",
            rusqlite::params![id, format!(r#"{{"name":"{name}","type":"Ride"}}"#)],
        )
        .expect("body");
}

fn fail(engine: &PersistentEngine, id: &str, failures: u32) {
    engine
        .db
        .execute(
            "UPDATE activity_census
             SET track_fetch_failures = ?2, track_failed_sync_date = icu_sync_date
             WHERE intervals_id = ?1",
            rusqlite::params![id, failures],
        )
        .expect("failures");
}

fn ids(engine: &PersistentEngine, athlete: &str) -> Vec<String> {
    engine
        .given_up_tracks(athlete)
        .tracks
        .into_iter()
        .map(|t| t.activity_id)
        .collect()
}

#[test]
fn lists_only_tracks_at_the_limit_for_the_current_version() {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("given_up.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");

    add(&engine, "me", "gone", "Lunch loop", "2023-11-14T12:00:00");
    add(
        &engine,
        "me",
        "newer",
        "Evening ride",
        "2023-11-15T18:00:00",
    );
    add(
        &engine,
        "me",
        "edited",
        "Edited ride",
        "2023-11-13T09:00:00",
    );
    add(&engine, "me", "short", "Short spin", "2023-11-12T09:00:00");
    add(&engine, "me", "trying", "Second run", "2023-11-11T09:00:00");
    add(
        &engine,
        "you",
        "theirs",
        "Their ride",
        "2023-11-10T09:00:00",
    );
    for id in ["gone", "newer", "edited"] {
        fail(&engine, id, TRACK_FAILURE_LIMIT);
    }
    fail(&engine, "trying", TRACK_FAILURE_LIMIT - 1);
    fail(&engine, "theirs", TRACK_FAILURE_LIMIT);
    engine
        .db
        .execute(
            "UPDATE activity_census SET icu_sync_date = 'v2' WHERE intervals_id = 'edited'",
            [],
        )
        .expect("edit");
    engine
        .db
        .execute(
            "UPDATE activity_census
             SET track_refusal = 'too_short', track_refused_sync_date = icu_sync_date
             WHERE intervals_id = 'short'",
            [],
        )
        .expect("refusal");

    let given_up = engine.given_up_tracks("me").tracks;
    assert_eq!(
        given_up
            .iter()
            .map(|t| t.activity_id.as_str())
            .collect::<Vec<_>>(),
        ["newer", "gone"]
    );
    assert_eq!(given_up[1].name, "Lunch loop");
    assert_eq!(given_up[1].start_date_local, "2023-11-14T12:00:00");
    assert!(engine.given_up_tracks("").tracks.is_empty());

    engine
        .record_track_fetch_outcomes("me", &["gone".to_string()], &[])
        .expect("landed");
    assert_eq!(ids(&engine, "me"), ["newer"]);
    crate::persistence::read_cache::close();
}
