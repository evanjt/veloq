//! Scenario: a lapped outing rides a section more than once, so its laps share
//! one activity and one date.
//! Expected behaviour: the PR badge judges the latest outing's fastest lap
//! against the other outings only, whatever order its laps arrive in, and the
//! ranking reads an outing's laps in the order they were ridden.

use std::collections::BTreeMap;

use tracematch::GpsPoint;

use super::TraversalRow;
use super::pooled::{score_traversals, traversals_by_sport};
use crate::PersistentEngine;

const DAY: i64 = 86_400;
const START: i64 = 1_700_000_000;

fn lap(activity: &str, day: i64, lap_time: f64) -> TraversalRow {
    TraversalRow {
        section_id: "ridge".to_string(),
        section_name: "Ridge".to_string(),
        lap_time,
        activity_date: START + day * DAY,
        direction: "same".to_string(),
        activity_id: activity.to_string(),
        estimated: false,
    }
}

fn latest_is_pr(rows: Vec<TraversalRow>) -> bool {
    score_traversals(rows, 10, &BTreeMap::new())
        .remove(0)
        .latest_is_pr
}

#[test]
fn a_lapped_outing_holds_the_record_when_its_slower_lap_comes_last() {
    let rows = vec![
        lap("morning", 0, 310.0),
        lap("evening", 1, 290.0),
        lap("evening", 1, 300.0),
    ];
    assert!(latest_is_pr(rows));
}

#[test]
fn a_lapped_outing_holds_the_record_when_its_faster_lap_comes_last() {
    let rows = vec![
        lap("morning", 0, 310.0),
        lap("evening", 1, 300.0),
        lap("evening", 1, 290.0),
    ];
    assert!(latest_is_pr(rows));
}

#[test]
fn two_tied_laps_of_one_outing_hold_the_record_over_a_slower_outing() {
    let rows = vec![
        lap("morning", 0, 310.0),
        lap("evening", 1, 290.0),
        lap("evening", 1, 290.0),
    ];
    assert!(latest_is_pr(rows));
}

#[test]
fn a_tie_with_another_outing_is_not_a_record() {
    let rows = vec![lap("morning", 0, 290.0), lap("evening", 1, 290.0)];
    assert!(!latest_is_pr(rows));
}

#[test]
fn a_lapped_outing_slower_than_another_outing_is_not_a_record() {
    let rows = vec![
        lap("morning", 0, 280.0),
        lap("evening", 1, 290.0),
        lap("evening", 1, 300.0),
    ];
    assert!(!latest_is_pr(rows));
}

#[test]
fn a_single_lapped_outing_has_no_rival_and_no_record() {
    let rows = vec![lap("evening", 1, 290.0), lap("evening", 1, 300.0)];
    assert!(!latest_is_pr(rows));
}

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
