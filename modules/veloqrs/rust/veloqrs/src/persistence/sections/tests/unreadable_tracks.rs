//! A member whose stored track does not read, because the row is gone or its
//! bytes do not decode, is not a member that left the line. A rebuild keeps its
//! rows, its exclusion and its hand attachment, and a recount that met one is
//! not complete.

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::sections::CreateSectionParams;

const POINTS: usize = 200;
const STEP_DEG: f64 = 0.0001;
const LAT: f64 = 46.2;
const LNG: f64 = 7.3;

fn line() -> Vec<GpsPoint> {
    (0..POINTS)
        .map(|i| GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG))
        .collect()
}

/// One pass along the line with ground before and after it.
fn ride() -> Vec<GpsPoint> {
    (-40..POINTS as i64 + 40)
        .map(|i| GpsPoint::new(LAT + i as f64 * STEP_DEG, LNG))
        .collect()
}

fn engine_with_section(custom: bool) -> (PersistentEngine, String) {
    let mut engine = PersistentEngine::in_memory().unwrap();
    let polyline = line();
    if custom {
        engine
            .add_activity("source".into(), polyline.clone(), "Ride".into())
            .unwrap();
    }
    let id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: polyline.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&polyline),
            name: Some("Long straight".into()),
            source_activity_id: custom.then(|| "source".to_string()),
            start_index: custom.then_some(0),
            end_index: custom.then_some(POINTS as u32 - 1),
        })
        .unwrap();
    (engine, id)
}

#[derive(Clone, Copy, Debug)]
enum Damage {
    RowRemoved,
    BytesCorrupt,
}

const DAMAGES: [Damage; 2] = [Damage::RowRemoved, Damage::BytesCorrupt];

fn damage_track(engine: &PersistentEngine, id: &str, how: Damage) {
    let sql = match how {
        Damage::RowRemoved => "DELETE FROM gps_tracks WHERE activity_id = ?",
        Damage::BytesCorrupt => "UPDATE gps_tracks SET track_data = x'01' WHERE activity_id = ?",
    };
    assert_eq!(engine.db.execute(sql, params![id]).unwrap(), 1);
}

fn row_flags(engine: &PersistentEngine, section_id: &str, id: &str) -> Vec<bool> {
    engine
        .db
        .prepare(
            "SELECT excluded FROM section_activities
             WHERE section_id = ? AND activity_id = ? ORDER BY start_index",
        )
        .unwrap()
        .query_map(params![section_id, id], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn is_forced(engine: &PersistentEngine, section_id: &str, id: &str) -> bool {
    engine
        .db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM section_forced_matches
             WHERE section_id = ? AND activity_id = ?)",
            params![section_id, id],
            |r| r.get(0),
        )
        .unwrap()
}

/// Two rides on the line, `bad` excluded, then its track damaged.
fn engine_with_damaged_member(custom: bool, how: Damage) -> (PersistentEngine, String) {
    let (mut engine, sid) = engine_with_section(custom);
    for id in ["good", "bad"] {
        engine
            .add_activity(id.into(), ride(), "Ride".into())
            .unwrap();
    }
    engine
        .match_activities_to_section(&sid, &line(), "Ride")
        .unwrap();
    assert_eq!(row_flags(&engine, &sid, "bad").len(), 1);
    engine.exclude_activity_from_section(&sid, "bad").unwrap();
    damage_track(&engine, "bad", how);
    (engine, sid)
}

#[test]
fn a_rematch_keeps_the_rows_and_exclusion_of_a_member_whose_track_does_not_read() {
    for how in DAMAGES {
        let (mut engine, sid) = engine_with_damaged_member(false, how);

        engine.rematch_section_activities(&sid, &line()).unwrap();

        assert_eq!(row_flags(&engine, &sid, "bad"), vec![true], "{how:?}");
        assert_eq!(row_flags(&engine, &sid, "good"), vec![false], "{how:?}");
    }
}

#[test]
fn a_junction_rebuild_of_a_custom_section_keeps_a_member_whose_track_does_not_read() {
    for how in DAMAGES {
        let (mut engine, sid) = engine_with_damaged_member(true, how);

        engine.rebuild_section_junctions(&sid, &line()).unwrap();

        assert_eq!(row_flags(&engine, &sid, "bad"), vec![true], "{how:?}");
        assert_eq!(row_flags(&engine, &sid, "good"), vec![false], "{how:?}");
    }
}

#[test]
fn a_hand_attached_ride_whose_track_does_not_read_survives_a_rebuild() {
    for how in DAMAGES {
        let (mut engine, sid) = engine_with_section(false);
        engine
            .add_activity("hand".into(), ride(), "Ride".into())
            .unwrap();
        assert!(engine.rematch_activity_to_section("hand", &sid).unwrap());
        engine.exclude_activity_from_section(&sid, "hand").unwrap();
        damage_track(&engine, "hand", how);

        let departed = engine.rebuild_section_junctions(&sid, &line()).unwrap();

        assert!(departed.is_empty(), "{how:?}: {departed:?}");
        assert!(is_forced(&engine, &sid, "hand"), "{how:?}");
        assert_eq!(row_flags(&engine, &sid, "hand"), vec![true], "{how:?}");
    }
}

#[test]
fn a_recount_that_met_an_unreadable_member_is_not_complete() {
    let _serial = crate::test_globals::serial_global_state();
    let (mut engine, sid) = engine_with_damaged_member(false, Damage::BytesCorrupt);
    let install = crate::persistence::engine_install();

    let report = engine.recount_every_section(install);

    assert!(!report.complete);
    assert_eq!(row_flags(&engine, &sid, "bad"), vec![true]);
}
