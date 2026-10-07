//! A route record counts only attempts whose recorded distance sits within a
//! band of the route's usual distance, the median over the attempts that count.
//! The route page and the feed card read the same rule.

use std::collections::{HashMap, HashSet};

use crate::ActivityMetrics;
use crate::persistence::fitness::derivations::highlights::{self, Effort, GroupView};
use crate::persistence::fitness::performances::route_performances;

struct Attempt {
    id: String,
    sport: &'static str,
    distance: f64,
    moving_time: u32,
}

fn attempt(id: &str, sport: &'static str, distance: f64, moving_time: u32) -> Attempt {
    Attempt {
        id: id.to_string(),
        sport,
        distance,
        moving_time,
    }
}

fn metrics_of(attempts: &[Attempt], index: usize) -> impl Fn(&str) -> Option<ActivityMetrics> + '_ {
    move |id| {
        let a = attempts.iter().find(|a| a.id == id)?;
        Some(ActivityMetrics {
            activity_id: a.id.clone(),
            name: a.id.clone(),
            date: 1_700_000_000
                + (attempts.iter().position(|x| x.id == id)? + index) as i64 * 86_400,
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
    }
}

fn page(attempts: &[Attempt], excluded: &[&str], current: &str) -> crate::RoutePerformanceResult {
    let ids: Vec<String> = attempts.iter().map(|a| a.id.clone()).collect();
    let excluded: Vec<String> = excluded.iter().map(|s| s.to_string()).collect();
    route_performances(
        &ids,
        None,
        &excluded,
        metrics_of(attempts, 0),
        Some(current),
        None,
    )
}

fn feed(attempts: &[Attempt], excluded: &[&str]) -> HashMap<String, bool> {
    let ids: Vec<String> = attempts.iter().map(|a| a.id.clone()).collect();
    let groups = [GroupView {
        group_id: "g",
        activity_ids: &ids,
    }];
    let mut excl: HashMap<String, HashSet<String>> = HashMap::new();
    excl.insert(
        "g".to_string(),
        excluded.iter().map(|s| s.to_string()).collect(),
    );
    let lookup = metrics_of(attempts, 0);
    let rows = highlights::route_highlights(
        &groups,
        &HashMap::new(),
        &excl,
        &HashMap::new(),
        |id| lookup(id).as_ref().map(Effort::from),
        &ids,
    );
    rows.into_iter().map(|r| (r.activity_id, r.is_pr)).collect()
}

fn outside(result: &crate::RoutePerformanceResult, id: &str) -> bool {
    result
        .performances
        .iter()
        .find(|p| p.activity_id == id)
        .expect("performance present")
        .outside_distance_band
}

/// Four attempts at the route's usual distance and one faster probe at
/// `probe_distance`. True when the probe counts for the record.
fn probe_counts(sport: &'static str, centre: f64, probe_distance: f64) -> bool {
    let attempts = vec![
        attempt("a", sport, centre, 1000),
        attempt("b", sport, centre, 1010),
        attempt("c", sport, centre, 1020),
        attempt("d", sport, centre, 1030),
        attempt("probe", sport, probe_distance, 900),
    ];
    let on_page = page(&attempts, &[], "probe");
    let counted_on_page = !outside(&on_page, "probe");
    let counted_in_feed = feed(&attempts, &[])["probe"];
    assert_eq!(
        counted_on_page,
        on_page
            .best
            .as_ref()
            .is_some_and(|b| b.activity_id == "probe")
    );
    assert_eq!(counted_on_page, counted_in_feed, "page and feed disagree");
    counted_on_page
}

#[test]
fn a_run_shortcut_holds_no_record_and_is_flagged() {
    let attempts = vec![
        attempt("a", "Run", 4300.0, 1200),
        attempt("b", "Run", 4280.0, 1210),
        attempt("c", "Run", 4320.0, 1190),
        attempt("short", "Run", 3650.0, 1120),
    ];

    let result = page(&attempts, &[], "c");
    let rows = feed(&attempts, &[]);

    assert!(outside(&result, "short"));
    assert!(!outside(&result, "c"));
    assert_eq!(result.best.as_ref().unwrap().activity_id, "c");
    assert_eq!(result.attempt_count, 3);
    assert_eq!(result.current_rank, Some(1));
    assert!(!rows["short"]);
    assert!(rows["c"]);
    assert!(result.performances.iter().any(|p| p.activity_id == "short"));
}

#[test]
fn two_attempts_far_from_their_median_give_no_record() {
    let attempts = vec![
        attempt("long", "Run", 4300.0, 1200),
        attempt("short", "Run", 3650.0, 1120),
    ];

    let result = page(&attempts, &[], "long");
    let rows = feed(&attempts, &[]);

    assert!(outside(&result, "long") && outside(&result, "short"));
    assert!(result.best.is_none());
    assert_eq!(result.attempt_count, 0);
    assert!(!rows["long"] && !rows["short"]);
}

#[test]
fn a_lone_attempt_is_its_own_centre() {
    let attempts = vec![attempt("only", "Run", 4300.0, 1200)];

    let result = page(&attempts, &[], "only");

    assert!(!outside(&result, "only"));
    assert_eq!(result.best.as_ref().unwrap().activity_id, "only");
    assert_eq!(result.attempt_count, 1);
}

#[test]
fn a_ride_band_is_five_per_cent_and_the_edge_is_inside() {
    assert!(probe_counts("Ride", 20_000.0, 20_900.0));
    assert!(probe_counts("Ride", 20_000.0, 21_000.0));
    assert!(!probe_counts("Ride", 20_000.0, 21_100.0));
    assert!(!probe_counts("Ride", 20_000.0, 18_900.0));
}

#[test]
fn a_run_band_is_five_per_cent() {
    assert!(probe_counts("Run", 5_000.0, 5_240.0));
    assert!(probe_counts("Run", 5_000.0, 5_250.0));
    assert!(!probe_counts("Run", 5_000.0, 5_300.0));
}

#[test]
fn other_sports_use_ten_per_cent() {
    assert!(probe_counts("Walk", 5_000.0, 5_400.0));
    assert!(!probe_counts("Walk", 5_000.0, 5_600.0));
}

#[test]
fn an_atypical_representative_is_flagged_and_the_fastest_other_holds_the_record() {
    let attempts = vec![
        attempt("rep", "Run", 3250.0, 800),
        attempt("a", "Run", 2500.0, 700),
        attempt("b", "Run", 2520.0, 690),
        attempt("c", "Run", 2550.0, 680),
        attempt("d", "Run", 2580.0, 710),
        attempt("e", "Run", 2600.0, 720),
    ];

    let result = page(&attempts, &[], "c");
    let rows = feed(&attempts, &[]);

    assert!(outside(&result, "rep"));
    assert_eq!(result.best.as_ref().unwrap().activity_id, "c");
    assert_eq!(result.attempt_count, 5);
    assert!(rows["c"] && !rows["rep"]);
}

#[test]
fn the_median_ignores_excluded_and_other_sport_attempts() {
    let attempts = vec![
        attempt("a", "Run", 5000.0, 1500),
        attempt("b", "Run", 5000.0, 1510),
        attempt("c", "Run", 5000.0, 1520),
        attempt("excluded_far", "Run", 9000.0, 2500),
        attempt("excluded_far2", "Run", 9000.0, 2500),
        attempt("excluded_far3", "Run", 9000.0, 2500),
        attempt("ride", "Ride", 9000.0, 900),
    ];
    let excluded = ["excluded_far", "excluded_far2", "excluded_far3"];

    let result = page(&attempts, &excluded, "a");
    let rows = feed(&attempts, &excluded);

    assert!(!outside(&result, "a") && !outside(&result, "b"));
    assert_eq!(result.attempt_count, 3);
    assert!(rows["a"]);
}

#[test]
fn untimed_attempts_do_not_move_the_centre() {
    let attempts = vec![
        attempt("a", "Run", 5000.0, 1500),
        attempt("b", "Run", 5000.0, 1510),
        attempt("untimed1", "Run", 9000.0, 0),
        attempt("untimed2", "Run", 9000.0, 0),
        attempt("untimed3", "Run", 9000.0, 0),
    ];

    let result = page(&attempts, &[], "a");

    assert!(!outside(&result, "a") && !outside(&result, "b"));
    assert_eq!(result.attempt_count, 2);
}

fn is_record(result: &crate::RoutePerformanceResult, id: &str) -> bool {
    result
        .performances
        .iter()
        .find(|p| p.activity_id == id)
        .expect("performance present")
        .is_record
}

#[test]
fn the_fastest_in_band_attempt_is_stamped_a_record_and_no_other() {
    let attempts = vec![
        attempt("a", "Run", 4300.0, 1200),
        attempt("b", "Run", 4280.0, 1210),
        attempt("c", "Run", 4320.0, 1190),
    ];

    let result = page(&attempts, &[], "a");

    assert!(is_record(&result, "c"));
    assert!(!is_record(&result, "a") && !is_record(&result, "b"));
}

#[test]
fn a_tied_best_is_stamped_on_neither_attempt() {
    let attempts = vec![
        attempt("a", "Run", 4300.0, 1190),
        attempt("b", "Run", 4300.0, 1190),
        attempt("c", "Run", 4300.0, 1210),
    ];

    let result = page(&attempts, &[], "a");

    assert!(!is_record(&result, "a") && !is_record(&result, "b") && !is_record(&result, "c"));
}

#[test]
fn a_lone_attempt_is_not_a_record() {
    let attempts = vec![attempt("only", "Run", 4300.0, 1200)];

    let result = page(&attempts, &[], "only");

    assert!(!is_record(&result, "only"));
}

#[test]
fn an_out_of_band_faster_attempt_neither_holds_nor_blocks_the_record() {
    let attempts = vec![
        attempt("a", "Run", 4300.0, 1200),
        attempt("b", "Run", 4280.0, 1210),
        attempt("c", "Run", 4320.0, 1190),
        attempt("short", "Run", 3650.0, 1120),
    ];

    let result = page(&attempts, &[], "a");

    assert!(outside(&result, "short"));
    assert!(!is_record(&result, "short"));
    assert!(is_record(&result, "c"));
}

#[test]
fn each_direction_judges_its_own_attempts() {
    let attempts = vec![
        attempt("f1", "Run", 4300.0, 1200),
        attempt("f2", "Run", 4300.0, 1250),
        attempt("r1", "Run", 4300.0, 1500),
        attempt("r2", "Run", 4300.0, 1400),
    ];
    let ids: Vec<String> = attempts.iter().map(|a| a.id.clone()).collect();
    let matches: Vec<crate::ActivityMatchInfo> = attempts
        .iter()
        .map(|a| crate::ActivityMatchInfo {
            activity_id: a.id.clone(),
            match_percentage: 95.0,
            direction: if a.id.starts_with('r') {
                crate::Direction::Reverse
            } else {
                crate::Direction::Same
            },
        })
        .collect();

    let result = route_performances(
        &ids,
        Some(&matches),
        &[],
        metrics_of(&attempts, 0),
        Some("f1"),
        None,
    );

    assert!(is_record(&result, "f1") && is_record(&result, "r2"));
    assert!(!is_record(&result, "f2") && !is_record(&result, "r1"));
}
