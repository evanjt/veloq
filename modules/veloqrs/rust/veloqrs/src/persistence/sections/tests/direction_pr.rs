//! Scenario: a section is climbed forward and descended in reverse, and the
//! descent is the fastest lap on the list.
//! Expected behaviour: Best, the median, the trend and the PR badge describe
//! the direction of the latest lap, so a descent is never a PR over climbs.

use std::collections::BTreeMap;

use super::TraversalRow;
use super::pooled::score_traversals;
use crate::FfiRankedSection;

const DAY: i64 = 86_400;
const START: i64 = 1_700_000_000;

fn lap(day: i64, direction: &str, lap_time: f64) -> TraversalRow {
    TraversalRow {
        section_id: "hill".to_string(),
        section_name: "Hill".to_string(),
        lap_time,
        activity_date: START + day * DAY,
        direction: direction.to_string(),
        activity_id: format!("act{day}"),
    }
}

fn rank(rows: Vec<TraversalRow>) -> FfiRankedSection {
    score_traversals(rows, 10, &BTreeMap::new()).remove(0)
}

fn climbs() -> Vec<TraversalRow> {
    [550.0, 560.0, 570.0, 565.0, 585.0]
        .iter()
        .enumerate()
        .map(|(i, t)| lap(i as i64, "same", *t))
        .collect()
}

#[test]
fn a_descent_today_is_not_a_pr_over_the_climbs() {
    let mut rows = climbs();
    rows.push(lap(10, "reverse", 340.0));
    let ranked = rank(rows);
    assert!(!ranked.latest_is_pr);
    assert_eq!(ranked.best_time_secs, 340.0);
    assert_eq!(ranked.median_recent_secs, 340.0);
    assert_eq!(ranked.traversal_count, 6);
}

#[test]
fn a_climb_today_is_judged_against_the_climbs_only() {
    let mut rows = vec![lap(0, "reverse", 340.0)];
    rows.extend(climbs().into_iter().map(|mut r| {
        r.activity_date += DAY;
        r
    }));
    rows.push(lap(10, "same", 545.0));
    let ranked = rank(rows);
    assert!(ranked.latest_is_pr);
    assert_eq!(ranked.best_time_secs, 545.0);
    assert_eq!(ranked.median_recent_secs, 565.0);
}

#[test]
fn a_slower_latest_climb_is_not_a_pr_and_best_stays_in_direction() {
    let mut rows = vec![lap(0, "reverse", 340.0)];
    rows.extend(climbs().into_iter().map(|mut r| {
        r.activity_date += DAY;
        r
    }));
    rows.push(lap(10, "same", 600.0));
    let ranked = rank(rows);
    assert!(!ranked.latest_is_pr);
    assert_eq!(ranked.best_time_secs, 550.0);
}

#[test]
fn the_trend_reads_the_latest_laps_own_direction() {
    let rows = (0..9)
        .map(|day| {
            if (3..6).contains(&day) {
                lap(day, "reverse", 300.0)
            } else {
                lap(day, "same", 500.0)
            }
        })
        .collect();
    assert_eq!(rank(rows).trend, 0);
}

#[test]
fn improvement_and_anomaly_read_the_latest_laps_own_direction() {
    let rows = (0..9)
        .map(|day| {
            if day % 2 == 0 {
                lap(day, "same", 570.0)
            } else {
                lap(day, "reverse", 340.0)
            }
        })
        .collect();
    let ranked = rank(rows);
    assert_eq!(ranked.improvement_change, Some(0.0));
    assert_eq!(ranked.improvement_score, 0.5);
    assert_eq!(ranked.anomaly_score, 0.0);
    assert_eq!(ranked.traversal_count, 9);
}

#[test]
fn too_few_laps_in_the_latest_direction_leave_improvement_unjudged() {
    let mut rows = climbs();
    rows.truncate(1);
    rows.extend((1..8).map(|day| lap(day, "reverse", 340.0 + day as f64)));
    rows.push(lap(9, "same", 560.0));
    let ranked = rank(rows);
    assert_eq!(ranked.improvement_change, None);
    assert_eq!(ranked.improvement_score, 0.5);
    assert_eq!(ranked.anomaly_score, 0.0);
}
