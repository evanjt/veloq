//! Scenario: both regroup writers group a signature pool over the catalogue
//! they hold, through `group_pool`.
//!
//! Expected behaviour: the grouping is incremental only when there are groups
//! to seed from, new signatures to place, and an unchanged match rule, and its
//! result keeps every signature in exactly one group either way.

use std::collections::HashSet;

use tracematch::{GpsPoint, MatchConfig, RouteGroup, RouteSignature};

use super::*;

fn signature(id: &str, lat: f64) -> RouteSignature {
    let points: Vec<GpsPoint> = (0..8)
        .map(|i| GpsPoint::new(lat + f64::from(i) * 0.001, 7.3))
        .collect();
    let bounds = Bounds::from_points(&points).unwrap();
    RouteSignature {
        activity_id: id.to_string(),
        start_point: points[0],
        end_point: points[7],
        total_distance: 780.0,
        center: bounds.center(),
        bounds,
        points,
    }
}

fn members(result: &tracematch::GroupingResult) -> HashSet<String> {
    result
        .groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().cloned())
        .collect()
}

fn held(sigs: &[RouteSignature]) -> Vec<RouteGroup> {
    group_pool(sigs, &[], &HashSet::new(), false, &MatchConfig::default())
        .0
        .groups
}

#[test]
fn an_empty_catalogue_groups_in_full() {
    let sigs = vec![signature("a", 46.2), signature("b", 46.2)];
    let (result, mode) = group_pool(&sigs, &[], &HashSet::new(), false, &MatchConfig::default());
    assert_eq!(mode, GroupingMode::Full);
    assert_eq!(members(&result).len(), 2);
}

#[test]
fn a_few_new_signatures_group_incrementally_into_the_held_route() {
    let mut sigs: Vec<RouteSignature> =
        (0..12).map(|i| signature(&format!("a{i}"), 46.2)).collect();
    let groups = held(&sigs);
    sigs.push(signature("new", 46.2));
    let (result, mode) = group_pool(
        &sigs,
        &groups,
        &HashSet::new(),
        false,
        &MatchConfig::default(),
    );
    assert_eq!(mode, GroupingMode::Incremental);
    assert_eq!(members(&result).len(), 13);
    assert_eq!(result.groups.len(), 1);
}

#[test]
fn a_changed_rule_groups_in_full() {
    let mut sigs: Vec<RouteSignature> =
        (0..12).map(|i| signature(&format!("a{i}"), 46.2)).collect();
    let groups = held(&sigs);
    sigs.push(signature("new", 46.2));
    let (_, mode) = group_pool(
        &sigs,
        &groups,
        &HashSet::new(),
        true,
        &MatchConfig::default(),
    );
    assert_eq!(mode, GroupingMode::Full);
}

#[test]
fn nothing_new_groups_in_full() {
    let sigs: Vec<RouteSignature> = (0..4).map(|i| signature(&format!("a{i}"), 46.2)).collect();
    let groups = held(&sigs);
    let (_, mode) = group_pool(
        &sigs,
        &groups,
        &HashSet::new(),
        false,
        &MatchConfig::default(),
    );
    assert_eq!(mode, GroupingMode::Full);
}

#[test]
fn a_mostly_new_pool_groups_in_full() {
    let first = vec![signature("a0", 46.2), signature("a1", 46.2)];
    let groups = held(&first);
    let mut sigs = first;
    sigs.extend((0..20).map(|i| signature(&format!("n{i}"), 46.2)));
    let (_, mode) = group_pool(
        &sigs,
        &groups,
        &HashSet::new(),
        false,
        &MatchConfig::default(),
    );
    assert_eq!(mode, GroupingMode::Full);
}

#[test]
fn a_removed_activity_leaves_no_group_holding_it() {
    let mut sigs: Vec<RouteSignature> =
        (0..12).map(|i| signature(&format!("a{i}"), 46.2)).collect();
    let groups = held(&sigs);
    sigs.retain(|s| s.activity_id != "a3");
    sigs.push(signature("new", 46.2));
    let (result, _) = group_pool(
        &sigs,
        &groups,
        &HashSet::new(),
        false,
        &MatchConfig::default(),
    );
    assert!(!members(&result).contains("a3"));
}
