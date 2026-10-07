//! Scenario: the insights panel names the routes holding a recent record or a
//! trend, from the same counted attempts the route page and the feed read.
//!
//! Expected behaviour: a bucket is one route in one sport and one direction.
//! Only attempts that are timed, not excluded, not partial and inside the
//! distance band stand in its record or its trend.

use std::collections::{HashMap, HashSet};

use crate::persistence::fitness::derivations::highlights::{
    self, Effort, GroupView, RouteInsightWindow,
};
use crate::persistence::fitness::performances::route_performances;

const DAY: i64 = 86_400;
const NOW: i64 = 1_760_000_000;

struct Attempt {
    id: String,
    sport: &'static str,
    distance: f64,
    moving_time: u32,
    days_ago: i64,
    reverse: bool,
}

fn run(id: &str, days_ago: i64, moving_time: u32) -> Attempt {
    Attempt {
        id: id.to_string(),
        sport: "Run",
        distance: 5_000.0,
        moving_time,
        days_ago,
        reverse: false,
    }
}

fn window() -> RouteInsightWindow {
    RouteInsightWindow {
        now: NOW,
        recent_since: NOW - 14 * DAY,
        active_window_days: 28,
        history_limit: 20,
    }
}

fn read(
    attempts: &[Attempt],
    non_attempts: &[&str],
    window: &RouteInsightWindow,
) -> Vec<crate::FfiRouteInsight> {
    let ids: Vec<String> = attempts.iter().map(|a| a.id.clone()).collect();
    let groups = [GroupView {
        group_id: "g",
        activity_ids: &ids,
    }];
    let by_activity: HashMap<&str, bool> = attempts
        .iter()
        .map(|a| (a.id.as_str(), !a.reverse))
        .collect();
    let directions: HashMap<&str, HashMap<&str, bool>> = HashMap::from([("g", by_activity)]);
    let excluded: HashMap<String, HashSet<String>> = HashMap::from([(
        "g".to_string(),
        non_attempts.iter().map(|s| s.to_string()).collect(),
    )]);
    highlights::route_insights(
        &groups,
        &directions,
        &excluded,
        &HashMap::from([("g".to_string(), "Route 1".to_string())]),
        |id| {
            let a = attempts.iter().find(|a| a.id == id)?;
            Some(Effort {
                distance: a.distance,
                moving_time: a.moving_time,
                date: NOW - a.days_ago * DAY,
                sport_type: a.sport.to_string(),
            })
        },
        window,
    )
}

/// Oldest first, `times` seconds each, the newest `newest_days_ago` old.
fn series(times: &[u32], newest_days_ago: i64) -> Vec<Attempt> {
    let n = times.len() as i64;
    times
        .iter()
        .enumerate()
        .map(|(i, t)| run(&format!("a{i}"), newest_days_ago + (n - 1 - i as i64), *t))
        .collect()
}

#[test]
fn seven_attempts_with_a_faster_recent_median_give_a_faster_trend() {
    let attempts = series(&[1000, 1000, 1000, 1000, 970, 970, 970], 1);

    let rows = read(&attempts, &[], &window());

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].trend, 1);
    assert_eq!(rows[0].route_name, "Route 1");
    assert_eq!(rows[0].attempt_count, 7);
    assert!(!rows[0].is_recent_record, "a tied best beats nothing");
    assert_eq!(rows[0].days_since_last, 1);
}

#[test]
fn a_slower_recent_median_gives_a_slower_trend() {
    let attempts = series(&[970, 970, 970, 1000, 1000, 1000], 1);

    let rows = read(&attempts, &[], &window());

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].trend, -1);
}

#[test]
fn five_attempts_are_no_trend() {
    let attempts = series(&[1000, 1000, 1000, 970, 970], 1);

    assert!(read(&attempts, &[], &window()).is_empty());
}

#[test]
fn a_trend_is_withheld_when_the_newest_attempt_is_older_than_the_active_window() {
    let attempts = series(&[1000, 1000, 1000, 970, 970, 970], 29);

    assert!(read(&attempts, &[], &window()).is_empty());
}

#[test]
fn the_newest_fastest_attempt_inside_the_window_is_a_recent_record() {
    let attempts = series(&[1010, 1020, 1000, 950], 3);

    let rows = read(&attempts, &[], &window());

    assert_eq!(rows.len(), 1);
    assert!(rows[0].is_recent_record);
    assert_eq!(rows[0].best_time, 950.0);
    assert_eq!(rows[0].trend, 0);
}

#[test]
fn a_record_set_before_the_window_is_not_recent() {
    let mut attempts = series(&[1010, 1020, 1000], 20);
    attempts.push(run("fast", 21, 950));

    assert!(read(&attempts, &[], &window()).is_empty());
}

#[test]
fn a_single_attempt_holds_no_record() {
    assert!(read(&series(&[950], 1), &[], &window()).is_empty());
}

#[test]
fn a_shortcut_is_in_neither_the_record_nor_the_trend_series() {
    let mut attempts = series(&[1000, 1000, 1020, 1030], 5);
    attempts.push(Attempt {
        distance: 4_000.0,
        ..run("shortcut", 1, 700)
    });

    let rows = read(&attempts, &[], &window());

    assert!(rows.is_empty(), "the shortcut holds the record: {rows:?}");

    attempts.push(run("fastest", 2, 960));
    let rows = read(&attempts, &[], &window());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].best_time, 960.0);
    assert_eq!(rows[0].attempt_count, 5);
    assert!(rows[0].recent_efforts.iter().all(|p| p.value > 700.0));
}

#[test]
fn excluded_and_partial_attempts_are_in_neither() {
    let mut attempts = series(&[1000, 1000, 1020], 5);
    attempts.push(run("excluded", 1, 800));
    attempts.push(run("partial", 2, 700));

    let rows = read(&attempts, &["excluded", "partial"], &window());

    assert!(rows.is_empty(), "{rows:?}");
}

#[test]
fn each_sport_and_each_direction_is_its_own_bucket() {
    let mut attempts = series(&[1010, 1020, 1000, 950], 3);
    for (i, t) in [2000, 2010, 1990, 1900].into_iter().enumerate() {
        attempts.push(Attempt {
            sport: "Ride",
            ..run(&format!("r{i}"), 3 + (3 - i as i64), t)
        });
    }
    for (i, t) in [1100, 1110, 1090, 1040].into_iter().enumerate() {
        attempts.push(Attempt {
            reverse: true,
            ..run(&format!("v{i}"), 3 + (3 - i as i64), t)
        });
    }

    let rows = read(&attempts, &[], &window());

    assert_eq!(rows.len(), 3);
    let find = |sport: &str, reverse: bool| {
        rows.iter()
            .find(|r| r.sport_type == sport && r.is_reverse == reverse)
            .expect("bucket")
    };
    assert_eq!(find("Run", false).best_time, 950.0);
    assert_eq!(find("Ride", false).best_time, 1900.0);
    assert_eq!(find("Run", true).best_time, 1040.0);
    for row in &rows {
        assert_eq!(row.attempt_count, 4);
        assert_eq!(row.recent_efforts.len(), 4);
    }
}

#[test]
fn records_come_before_trends_and_then_newest_first() {
    let mut a = series(&[1000, 1000, 1000, 970, 970, 970], 1);
    for x in &mut a {
        x.id = format!("t{}", x.id);
    }
    let mut b = series(&[1010, 1020, 1000, 950], 6);
    for x in &mut b {
        x.id = format!("r{}", x.id);
        x.reverse = true;
    }
    a.extend(b);

    let rows = read(&a, &[], &window());

    assert_eq!(rows.len(), 2);
    assert!(rows[0].is_recent_record);
    assert_eq!(rows[1].trend, 1);
}

#[test]
fn the_bucket_record_is_the_one_the_route_page_names_best() {
    let attempts = series(&[1010, 1020, 1000, 950], 3);
    let ids: Vec<String> = attempts.iter().map(|a| a.id.clone()).collect();
    let page = route_performances(
        &ids,
        None,
        &[],
        |id| {
            let a = attempts.iter().find(|a| a.id == id)?;
            Some(crate::ActivityMetrics {
                activity_id: a.id.clone(),
                name: a.id.clone(),
                date: NOW - a.days_ago * DAY,
                distance: a.distance,
                moving_time: a.moving_time,
                elapsed_time: a.moving_time,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: a.sport.to_string(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            })
        },
        None,
        None,
    );

    let rows = read(&attempts, &[], &window());

    assert_eq!(
        rows[0].best_time,
        f64::from(page.best.expect("best").moving_time)
    );
}
