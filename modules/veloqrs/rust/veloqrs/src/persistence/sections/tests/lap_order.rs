//! Scenario: a lapped outing rides a section more than once, so its laps share
//! one activity and one date.
//! Expected behaviour: the ranking reads an outing's laps in the order they
//! were ridden, whatever order they are stored in.

use tracematch::GpsPoint;

use super::pooled::traversals_by_sport;
use crate::PersistentEngine;

const START: i64 = 1_700_000_000;

fn track() -> Vec<GpsPoint> {
    (0..3)
        .map(|i| GpsPoint {
            latitude: 46.0 + i as f64 * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

#[test]
fn an_outings_laps_are_read_in_the_order_they_were_ridden() {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .db
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, disabled, version)
             VALUES ('ridge', 'auto', 'Ridge', 'Ride', '[]', 800.0, 0, 1)",
            [],
        )
        .expect("section");
    engine
        .add_activity("evening".into(), track(), "Ride".into())
        .expect("activity");
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                 elapsed_time, elevation_gain, sport_type)
             VALUES ('evening', 'evening', ?1, 800.0, 200, 200, 0, 'Ride')",
            [START],
        )
        .expect("metrics");
    // Written latest lap first, so storage order disagrees with ridden order.
    for (start_index, lap_time) in [(900, 300.0), (500, 295.0), (100, 290.0)] {
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                     start_index, end_index, distance_meters, lap_time, lap_pace, excluded)
                 VALUES ('ridge', 'evening', 'same', ?1, ?2, 800.0, ?3, ?4, 0)",
                rusqlite::params![start_index, start_index + 2, lap_time, 800.0 / lap_time],
            )
            .expect("traversal");
    }
    let times: Vec<f64> = traversals_by_sport(&engine.db)
        .remove("Ride")
        .unwrap_or_default()
        .iter()
        .map(|r| r.lap_time)
        .collect();
    assert_eq!(times, vec![290.0, 295.0, 300.0]);
}
