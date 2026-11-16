//! Scenario: the routes screen lists each group with the moving time of its fastest counted
//! attempt.
//!
//! Expected behaviour: a group's best time is the minimum moving time over its attempts that are
//! not excluded; a group with no timed attempt carries none.

use rusqlite::params;

use crate::FfiRoutesScreenQuery;
use crate::persistence::PersistentEngine;

fn metrics(id: &str, moving_time: u32) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: id.to_string(),
        name: id.to_string(),
        date: 1_700_000_000,
        distance: 5_000.0,
        moving_time,
        elapsed_time: moving_time,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

fn add_group(engine: &mut PersistentEngine, id: &str, times: &[u32]) {
    let members: Vec<String> = (0..times.len()).map(|i| format!("{id}-{i}")).collect();
    engine
        .set_activity_metrics(
            members
                .iter()
                .zip(times)
                .map(|(member, &time)| metrics(member, time))
                .collect(),
        )
        .expect("metrics");
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count)
             VALUES (?1, ?2, ?3, 'Ride', ?4)",
            params![
                id,
                members[0],
                serde_json::to_string(&members).unwrap(),
                members.len() as u32
            ],
        )
        .expect("insert group");
    for member in &members {
        engine
            .db
            .execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                 VALUES (?1, ?2, 100.0, 'same')",
                params![id, member],
            )
            .expect("insert match");
    }
}

fn best_times(engine: &PersistentEngine) -> Vec<(String, Option<f64>)> {
    let mut rows: Vec<_> = engine
        .get_routes_screen_data(FfiRoutesScreenQuery {
            user_lat: f64::NAN,
            user_lng: f64::NAN,
            group_limit: 20,
            ..Default::default()
        })
        .groups
        .into_iter()
        .map(|g| (g.group_id, g.best_time))
        .collect();
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    rows
}

#[test]
fn a_group_carries_its_fastest_attempt_and_no_excluded_one() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_group(&mut engine, "plain", &[900, 600, 750]);
    add_group(&mut engine, "faster_excluded", &[900, 300]);
    engine
        .db
        .execute(
            "UPDATE activity_matches SET excluded = 1 WHERE activity_id = 'faster_excluded-1'",
            [],
        )
        .expect("exclude");

    assert_eq!(
        best_times(&engine),
        [
            ("faster_excluded".to_string(), Some(900.0)),
            ("plain".to_string(), Some(600.0)),
        ]
    );
}

#[test]
fn a_group_with_no_timed_attempt_has_no_best_time() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    add_group(&mut engine, "untimed", &[0, 0]);

    assert_eq!(best_times(&engine), [("untimed".to_string(), None)]);
}
