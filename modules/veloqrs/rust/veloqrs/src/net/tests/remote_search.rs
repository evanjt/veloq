//! Scenario: an exhausted feed search offers a search of the athlete's
//! account, whose rows the device does not hold.
//!
//! Expected behaviour: the request is the name search when a name is set and
//! the dated listing when only a date range is, and none when neither is. Rows
//! the library already holds are dropped, the rest are narrowed on the device by
//! date, sport family, distance and moving time, and listed newest first. A
//! source with no search answers nothing, and a refusal comes back as the
//! error rather than an empty list.

use super::*;
use crate::net::intervals::wire::RemoteActivitySummary;
use crate::net::live::live_source;
use crate::net::recording_source::{RecordingSource, asked, unreachable_transport};
use std::collections::HashSet;

fn row(id: &str, start: &str, sport: &str, distance: f64, moving: f64) -> RemoteActivitySummary {
    RemoteActivitySummary {
        id: id.into(),
        name: format!("Outing {id}"),
        sport: sport.into(),
        start_date_local: Some(start.into()),
        distance: Some(distance),
        moving_time: Some(moving),
    }
}

fn four_rows() -> Vec<RemoteActivitySummary> {
    vec![
        row("i1", "2024-03-02T08:00:00", "Ride", 40_000.0, 5_400.0),
        row("i2", "2024-05-11T09:30:00", "Ride", 12_000.0, 2_400.0),
        row("i3", "2023-12-24T07:15:00", "Run", 8_000.0, 2_700.0),
        row("i4", "2024-01-09T17:45:00", "Ride", 95_000.0, 12_000.0),
    ]
}

fn named(needle: &str) -> FfiActivityBodiesQuery {
    FfiActivityBodiesQuery {
        oldest_ts: None,
        newest_ts: None,
        needle: needle.into(),
        sport_families: Vec::new(),
        offset: 0,
        limit: None,
        min_distance: None,
        max_distance: None,
        min_moving_time: None,
        max_moving_time: None,
        sort: None,
    }
}

fn ids(rows: &[RemoteActivitySummary]) -> Vec<&str> {
    rows.iter().map(|r| r.id.as_str()).collect()
}

async fn none_held(_: Vec<String>) -> HashSet<String> {
    HashSet::new()
}

#[test]
fn a_source_is_offered_the_search_only_when_it_answers_one() {
    let mut without = RecordingSource::new();
    without.remote = None;

    assert!(
        !without.searches(),
        "a source with no search is not offered one"
    );
    assert!(RecordingSource::new().searches());
    assert!(live_source(unreachable_transport(), "i1").searches());
}

#[test]
fn a_name_asks_the_name_search_at_its_cap_on_the_interactive_lane() {
    let source = RecordingSource::new();

    crate::runtime::block_on(search(&source, &named("  ferry "), none_held)).unwrap();

    assert_eq!(
        source.calls(),
        vec![asked(
            "search_activities",
            &["ferry", "200"],
            Dispatch::new(Lane::Interactive, Intent::User)
        )]
    );
}

#[test]
fn a_date_range_alone_lists_the_window_by_its_local_days() {
    let source = RecordingSource::new();
    let query = FfiActivityBodiesQuery {
        oldest_ts: Some(1_709_251_200.0),
        newest_ts: Some(1_711_929_599.0),
        ..named("")
    };

    crate::runtime::block_on(search(&source, &query, none_held)).unwrap();

    assert_eq!(
        source.calls(),
        vec![asked(
            "activity_summaries",
            &["2024-03-01", "2024-03-31"],
            Dispatch::new(Lane::Interactive, Intent::User)
        )]
    );
}

#[test]
fn neither_a_name_nor_a_full_date_range_asks_nothing() {
    let source = RecordingSource::new();
    let half_open = FfiActivityBodiesQuery {
        oldest_ts: Some(1_709_251_200.0),
        ..named("   ")
    };

    for query in [named(""), named("  "), half_open] {
        let found = crate::runtime::block_on(search(&source, &query, none_held)).unwrap();
        assert_eq!(found, RemoteSearch::NoQuery);
    }
    assert!(source.calls().is_empty());
}

#[test]
fn rows_the_library_holds_are_dropped_and_the_rest_come_newest_first() {
    let mut source = RecordingSource::new();
    source.remote = Some(four_rows());

    let found = crate::runtime::block_on(search(&source, &named("outing"), async |upstream| {
        assert_eq!(upstream.len(), 4);
        HashSet::from(["i1".to_string()])
    }))
    .unwrap();

    let RemoteSearch::Found { rows, fetched, .. } = found else {
        panic!("expected rows, got {found:?}");
    };
    assert_eq!(ids(&rows), vec!["i2", "i4", "i3"]);
    assert_eq!(fetched, 4);
}

#[test]
fn a_minimum_distance_drops_the_shorter_rows() {
    let mut source = RecordingSource::new();
    source.remote = Some(four_rows());
    let query = FfiActivityBodiesQuery {
        min_distance: Some(10_000.0),
        ..named("outing")
    };

    let found = crate::runtime::block_on(search(&source, &query, none_held)).unwrap();

    let RemoteSearch::Found { rows, .. } = found else {
        panic!("expected rows");
    };
    assert_eq!(ids(&rows), vec!["i2", "i1", "i4"]);
}

#[test]
fn a_sport_family_and_a_moving_time_bound_narrow_on_the_device() {
    let mut source = RecordingSource::new();
    source.remote = Some(four_rows());
    let query = FfiActivityBodiesQuery {
        sport_families: vec![FfiSportFamily::Ride],
        max_moving_time: Some(6_000),
        ..named("outing")
    };

    let found = crate::runtime::block_on(search(&source, &query, none_held)).unwrap();

    let RemoteSearch::Found { rows, .. } = found else {
        panic!("expected rows");
    };
    assert_eq!(ids(&rows), vec!["i2", "i1"]);
}

#[test]
fn a_date_range_keeps_the_rows_inside_its_inclusive_days_on_a_name_search_too() {
    let mut source = RecordingSource::new();
    source.remote = Some(four_rows());
    let query = FfiActivityBodiesQuery {
        oldest_ts: Some(1_704_067_200.0),
        newest_ts: Some(1_709_423_999.0),
        ..named("outing")
    };

    let found = crate::runtime::block_on(search(&source, &query, none_held)).unwrap();

    let RemoteSearch::Found { rows, .. } = found else {
        panic!("expected rows");
    };
    assert_eq!(ids(&rows), vec!["i1", "i4"]);
}

#[test]
fn a_row_with_no_distance_fails_a_distance_bound() {
    let mut source = RecordingSource::new();
    let mut bare = row("i9", "2024-02-02T10:00:00", "WeightTraining", 0.0, 1_800.0);
    bare.distance = None;
    source.remote = Some(vec![bare]);
    let query = FfiActivityBodiesQuery {
        min_distance: Some(1.0),
        ..named("outing")
    };

    let found = crate::runtime::block_on(search(&source, &query, none_held)).unwrap();

    let RemoteSearch::Found { rows, fetched, .. } = found else {
        panic!("expected rows");
    };
    assert!(rows.is_empty());
    assert_eq!(fetched, 1);
}

#[test]
fn a_full_answer_is_reported_as_reaching_the_cap() {
    let mut source = RecordingSource::new();
    source.remote = Some(
        (0..SEARCH_LIMIT)
            .map(|n| row(&format!("i{n}"), "2024-03-02T08:00:00", "Ride", 1.0, 1.0))
            .collect(),
    );

    let found = crate::runtime::block_on(search(&source, &named("outing"), none_held)).unwrap();

    let RemoteSearch::Found {
        fetched, capped, ..
    } = found
    else {
        panic!("expected rows");
    };
    assert_eq!(fetched, SEARCH_LIMIT);
    assert!(capped);
}

#[test]
fn a_source_with_no_search_answers_unavailable() {
    let mut source = RecordingSource::new();
    source.remote = None;

    let found = crate::runtime::block_on(search(&source, &named("outing"), none_held)).unwrap();

    assert_eq!(found, RemoteSearch::Unavailable);
}

#[test]
fn a_refusal_is_the_error_and_not_an_empty_list() {
    let mut source = RecordingSource::new();
    source.remote_refusal = Some(422);

    let found = crate::runtime::block_on(search(&source, &named("outing"), none_held));

    assert!(matches!(found, Err(NetError::Http { status: 422, .. })));
}
