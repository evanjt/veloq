//! Scenario: a stored activity is re-stored with a track that no longer
//! passes a section the athlete defined or accepted.
//!
//! Expected behaviour: when the track changed, the attach owns all of the
//! activity's rows. Rows on sections the new track no longer passes are gone,
//! rows on sections it still passes are rewritten, a hand attachment keeps the
//! relaxed bar, and an unchanged track leaves the rows alone.

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;

const POINTS: i32 = 200;
const STEP_DEG: f64 = 0.0001;
const HOME_LAT: f64 = 46.2;
const AWAY_LAT: f64 = 47.2;
const LNG: f64 = 7.3;

fn line(lat: f64) -> Vec<GpsPoint> {
    (-40..POINTS + 40)
        .map(|i| GpsPoint::new(lat + f64::from(i) * STEP_DEG, LNG))
        .collect()
}

/// A custom section, or an auto one the athlete accepted (user defined).
fn insert_section(engine: &PersistentEngine, id: &str, accepted: bool, lat: f64) {
    let polyline: Vec<GpsPoint> = (0..POINTS)
        .map(|i| GpsPoint::new(lat + f64::from(i) * STEP_DEG, LNG))
        .collect();
    let bounds = tracematch::Bounds::from_points(&polyline).unwrap();
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?, ?, ?, 'Ride', ?, 2200.0, ?, 1, '2026-01-01T00:00:00Z', ?, ?, ?, ?)",
            params![
                id,
                if accepted { "auto" } else { "custom" },
                id,
                serde_json::to_string(&polyline).unwrap(),
                i64::from(accepted),
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng
            ],
        )
        .unwrap();
}

fn row_count(engine: &PersistentEngine, section_id: &str) -> i64 {
    engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = ? AND activity_id = 'ride'",
            params![section_id],
            |r| r.get(0),
        )
        .unwrap()
}

fn library() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .add_activity("ride".into(), line(HOME_LAT), "Ride".into())
        .unwrap();
    insert_section(&engine, "custom", false, HOME_LAT);
    insert_section(&engine, "accepted", true, HOME_LAT);
    insert_section(&engine, "kept", false, HOME_LAT);
    engine.load_sections().unwrap();
    engine.attach_after_store("ride", true);
    assert_eq!(row_count(&engine, "custom"), 1);
    assert_eq!(row_count(&engine, "accepted"), 1);
    engine
}

fn move_ride_away(engine: &mut PersistentEngine) {
    let changed = engine
        .add_activity("ride".into(), line(AWAY_LAT), "Ride".into())
        .unwrap();
    assert_eq!(changed, vec!["ride".to_string()]);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_changed_track_drops_rows_on_custom_and_accepted_sections_it_no_longer_passes() {
    let mut engine = library();
    move_ride_away(&mut engine);

    engine.attach_after_store("ride", true);

    assert_eq!(row_count(&engine, "custom"), 0);
    assert_eq!(row_count(&engine, "accepted"), 0);
    assert_eq!(row_count(&engine, "kept"), 0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_changed_track_that_still_passes_a_section_keeps_its_row() {
    let mut engine = library();
    let changed = engine
        .add_activity("ride".into(), line(HOME_LAT)[10..].to_vec(), "Ride".into())
        .unwrap();
    assert_eq!(changed, vec!["ride".to_string()]);

    engine.attach_after_store("ride", true);

    assert_eq!(row_count(&engine, "custom"), 1);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_changed_track_too_short_to_match_clears_every_row() {
    let mut engine = library();
    engine
        .add_activity("ride".into(), line(HOME_LAT)[..2].to_vec(), "Ride".into())
        .unwrap();

    engine.attach_after_store("ride", true);

    assert_eq!(row_count(&engine, "custom"), 0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_unchanged_track_leaves_rows_on_sections_the_attach_does_not_reach() {
    let mut engine = library();
    move_ride_away(&mut engine);

    engine.attach_after_store("ride", false);

    assert_eq!(row_count(&engine, "custom"), 1);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_changed_track_keeps_a_hand_attachment_the_relaxed_bar_still_reaches() {
    let mut engine = library();
    let beside: Vec<GpsPoint> = line(HOME_LAT)
        .into_iter()
        .map(|p| {
            GpsPoint::new(
                p.latitude,
                p.longitude + 300.0 / (111_320.0 * HOME_LAT.to_radians().cos()),
            )
        })
        .collect();
    engine
        .db
        .execute(
            "INSERT INTO section_forced_matches (section_id, activity_id, forced_at)
             VALUES ('custom', 'ride', 1700000000)",
            [],
        )
        .unwrap();
    engine
        .add_activity("ride".into(), beside, "Ride".into())
        .unwrap();

    engine.attach_after_store("ride", true);

    assert_eq!(row_count(&engine, "custom"), 1);
    assert_eq!(row_count(&engine, "accepted"), 0);
}
