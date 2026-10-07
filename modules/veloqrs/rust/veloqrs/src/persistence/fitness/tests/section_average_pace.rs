//! Scenario: a section is 596 m long and its laps run longer than that, so
//! each lap's own distance and the section's length differ.
//!
//! Expected behaviour: the average pace is the laps' total distance over
//! their total time, the same distance basis as the best pace, so it lies
//! between the fastest and slowest lap pace.

use super::laps::summarise;
use crate::{SectionLap, SectionPerformanceRecord};

fn record(date: i64, distance: f64, time: f64, direction: &str) -> SectionPerformanceRecord {
    let lap = SectionLap {
        id: format!("lap_{date}"),
        activity_id: format!("act_{date}"),
        time,
        pace: distance / time,
        distance,
        direction: direction.to_string(),
        start_index: 0,
        end_index: 10,
        avg_hr: None,
        avg_power: None,
        coverage: Some(1.0),
        excluded: false,
    };
    SectionPerformanceRecord {
        activity_id: format!("act_{date}"),
        activity_name: "Run".to_string(),
        activity_date: date,
        laps: vec![lap],
        lap_count: 1,
        best_time: time,
        best_pace: distance / time,
        best_forward_time: Some(time),
        best_reverse_time: None,
        avg_time: time,
        avg_pace: distance / time,
        direction: direction.to_string(),
        section_distance: 596.0,
    }
}

#[test]
fn average_pace_lies_between_the_fastest_and_slowest_lap() {
    let result = summarise(
        596.0,
        vec![
            record(1, 666.0, 261.0, "same"),
            record(2, 906.0, 355.0, "same"),
        ],
    );
    let stats = result.forward_stats.expect("forward stats");
    let speed = stats.avg_speed.expect("average speed");
    let (a, b): (f64, f64) = (666.0 / 261.0, 906.0 / 355.0);
    assert!(speed >= a.min(b) && speed <= a.max(b), "{speed}");
    assert!((speed - (666.0 + 906.0) / (261.0 + 355.0)).abs() < 1e-9);
}

#[test]
fn reverse_laps_do_not_enter_the_forward_average() {
    let result = summarise(
        596.0,
        vec![
            record(1, 600.0, 200.0, "same"),
            record(2, 900.0, 600.0, "reverse"),
        ],
    );
    assert_eq!(result.forward_stats.unwrap().avg_speed, Some(3.0));
    assert_eq!(result.reverse_stats.unwrap().avg_speed, Some(1.5));
}
