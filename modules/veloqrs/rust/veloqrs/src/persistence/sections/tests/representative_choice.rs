//! Scenario: a 2.5 km loop recorded three times, once with a 200 m lead-in and
//! lead-out from home under the id that sorts first.
//!
//! Expected behaviour: a regroup keeps a representative the athlete chose, and
//! replaces one the grouping picked by sort order with the member the others
//! match best, through either writer.

use super::*;

const BASE_LAT: f64 = 47.0;
const BASE_LNG: f64 = 8.0;

/// A point `east` and `north` metres from the base, on a flat-earth approximation.
fn offset_point(east: f64, north: f64) -> GpsPoint {
    let metres_per_degree = 111_320.0;
    GpsPoint::new(
        BASE_LAT + north / metres_per_degree,
        BASE_LNG + east / (metres_per_degree * BASE_LAT.to_radians().cos()),
    )
}

/// The rectangular loop, with a straight lead-in and lead-out of `lead` metres,
/// as points every ~10 m.
fn loop_track(lead: f64) -> Vec<GpsPoint> {
    let mut corners = vec![(0.0, -lead)];
    corners.extend([
        (0.0, 0.0),
        (600.0, 0.0),
        (600.0, 650.0),
        (0.0, 650.0),
        (0.0, 0.0),
    ]);
    corners.push((0.0, -lead));
    let mut points = Vec::new();
    for pair in corners.windows(2) {
        let (from, to): ((f64, f64), (f64, f64)) = (pair[0], pair[1]);
        let length = ((to.0 - from.0).powi(2) + (to.1 - from.1).powi(2)).sqrt();
        let steps = (length / 10.0).ceil() as usize;
        for step in 0..steps {
            let t = step as f64 / steps as f64;
            points.push(offset_point(
                from.0 + (to.0 - from.0) * t,
                from.1 + (to.1 - from.1) * t,
            ));
        }
    }
    points.push(offset_point(0.0, -lead));
    points
}

const DETOUR: &str = "a1";

/// An engine holding the loop as one route, with the recording that carries
/// the lead-in as its representative, as a library grouped by sort order holds
/// it. Returns the route's id.
fn library_represented_by_the_detour(engine: &mut PersistentEngine) -> String {
    for (id, lead) in [(DETOUR, 200.0), ("a2", 0.0), ("a3", 0.0)] {
        engine
            .add_activity(id.into(), loop_track(lead), "Run".into())
            .unwrap();
    }
    let groups = engine.get_groups().to_vec();
    assert_eq!(groups.len(), 1, "the recordings form one route: {groups:?}");
    let route = groups[0].group_id.clone();
    engine
        .db
        .execute(
            "UPDATE route_groups SET representative_id = ? WHERE id = ?",
            params![DETOUR, route],
        )
        .unwrap();
    engine.reload_groups_from_db();
    route
}

fn add_plain_recording(engine: &mut PersistentEngine, id: &str) {
    engine
        .add_activity(id.into(), loop_track(0.0), "Run".into())
        .unwrap();
}

fn representative(engine: &mut PersistentEngine, route: &str) -> String {
    engine
        .get_groups()
        .iter()
        .find(|group| group.group_id == route)
        .unwrap_or_else(|| panic!("{route} is no longer a route"))
        .representative_id
        .clone()
}

fn stored_representative(conn: &Connection, route: &str) -> (String, bool) {
    conn.query_row(
        "SELECT representative_id, representative_chosen FROM route_groups WHERE id = ?",
        [route],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

#[test]
fn regroup_replaces_a_representative_nobody_chose() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let route = library_represented_by_the_detour(&mut engine);

    add_plain_recording(&mut engine, "a4");

    assert_ne!(representative(&mut engine, &route), DETOUR);
    let (stored, chosen) = stored_representative(&engine.db, &route);
    assert_ne!(stored, DETOUR);
    assert!(!chosen);
}

#[test]
fn regroup_keeps_the_representative_the_athlete_chose() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let route = library_represented_by_the_detour(&mut engine);
    engine.set_route_representative(&route, DETOUR).unwrap();

    add_plain_recording(&mut engine, "a4");
    assert_eq!(representative(&mut engine, &route), DETOUR);
    assert_eq!(
        stored_representative(&engine.db, &route),
        (DETOUR.to_string(), true)
    );

    engine.reload_groups_from_db();
    add_plain_recording(&mut engine, "a5");
    assert_eq!(representative(&mut engine, &route), DETOUR);
    assert_eq!(
        stored_representative(&engine.db, &route),
        (DETOUR.to_string(), true)
    );
}

/// A released build keyed a route by one of its members, so the grouping's own
/// carry of a representative by route id can reach this one.
#[test]
fn regroup_replaces_an_unchosen_representative_under_a_member_keyed_route() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    library_represented_by_the_detour(&mut engine);
    engine
        .db
        .execute_batch(
            "DELETE FROM route_groups;
             DELETE FROM activity_matches;
             DELETE FROM identity_state;
             INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES ('a1', 'a1', '[\"a1\",\"a2\",\"a3\"]', '');",
        )
        .unwrap();
    engine.reload_groups_from_db();

    add_plain_recording(&mut engine, "a4");

    assert_ne!(representative(&mut engine, "a1"), DETOUR);
}

#[test]
fn background_regroup_replaces_a_representative_nobody_chose() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let route = library_represented_by_the_detour(&mut engine);
    add_plain_recording(&mut engine, "a4");
    let prior = engine.groups.clone();

    recompute_and_save_groups(
        &engine.db,
        crate::persistence::engine_install(),
        &MatchConfig::default(),
        &prior,
        engine.group_generation,
    );

    let (stored, chosen) = stored_representative(&engine.db, &route);
    assert_ne!(stored, DETOUR);
    assert!(!chosen);
}

#[test]
fn background_regroup_keeps_the_representative_the_athlete_chose() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    let route = library_represented_by_the_detour(&mut engine);
    engine.set_route_representative(&route, DETOUR).unwrap();
    add_plain_recording(&mut engine, "a4");
    let prior = engine.groups.clone();

    recompute_and_save_groups(
        &engine.db,
        crate::persistence::engine_install(),
        &MatchConfig::default(),
        &prior,
        engine.group_generation,
    );

    assert_eq!(
        stored_representative(&engine.db, &route),
        (DETOUR.to_string(), true)
    );
}
