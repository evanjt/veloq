//! One section record across the section page: the scatter's ring, the stats
//! row's trophy, the calendar's trophy and the lap list's mark all name the
//! same lap, or none of them names one.
//!
//! The record is the eligible lap with the shortest time, on its float time,
//! when it strictly beats every eligible lap of another activity. A second lap
//! of the same outing is not a rival.

use crate::persistence::fitness::performances::laps;

const SECTION_M: f64 = 1000.0;

fn lap(activity: &str, start: u32, time: f64, coverage: f64) -> crate::SectionLap {
    crate::SectionLap {
        id: format!("{activity}-{start}"),
        activity_id: activity.to_string(),
        time,
        pace: SECTION_M / time,
        distance: SECTION_M * coverage,
        direction: "same".to_string(),
        start_index: start,
        end_index: start + 10,
        avg_hr: None,
        avg_power: None,
        coverage: Some(coverage),
        excluded: false,
        outside_distance_band: false,
        match_percentage: None,
        is_record: false,
    }
}

fn outing(
    activity: &str,
    age_days: i64,
    laps: Vec<crate::SectionLap>,
) -> crate::SectionPerformanceRecord {
    let first = laps[0].clone();
    crate::SectionPerformanceRecord {
        activity_id: activity.to_string(),
        activity_name: activity.to_string(),
        activity_date: crate::WholeNumber(chrono::Utc::now().timestamp() - age_days * 86_400),
        lap_count: laps.len() as u32,
        laps,
        best_time: first.time,
        best_pace: first.pace,
        best_forward_time: Some(first.time),
        best_reverse_time: None,
        avg_time: first.time,
        avg_pace: first.pace,
        direction: "same".to_string(),
        section_distance: SECTION_M,
    }
}

fn detail(records: Vec<crate::SectionPerformanceRecord>) -> crate::FfiSectionPerformanceData {
    let all = std::sync::Arc::new(laps::summarise(SECTION_M, records));
    super::section_detail_from(
        &[],
        Some(SECTION_M),
        None,
        0,
        crate::FfiPerformanceSubject::Section,
        None,
        |_, _| Vec::new(),
        |_| Some(std::sync::Arc::new(None)),
        |_, _| None,
        |_, rows| match rows {
            laps::Rows::Included => all.clone(),
            laps::Rows::Excluded => std::sync::Arc::new(laps::empty()),
        },
    )
}

/// The lap ids the scatter rings.
fn ringed(data: &crate::FfiSectionPerformanceData) -> Vec<String> {
    data.chart_data
        .points
        .iter()
        .filter(|p| p.is_best)
        .map(|p| p.lap_id.clone())
        .collect()
}

/// The activity the calendar's overall forward trophy names.
fn calendar_holder(data: &crate::FfiSectionPerformanceData) -> Option<String> {
    data.calendar_summary
        .as_ref()
        .and_then(|c| c.forward_pr.as_ref())
        .map(|best| best.best_activity_id.clone())
}

/// The lap ids the lap list marks as the record.
fn marked(data: &crate::FfiSectionPerformanceData) -> Vec<String> {
    data.lap_records
        .iter()
        .flat_map(|r| &r.laps)
        .filter(|l| l.is_record)
        .map(|l| l.id.clone())
        .collect()
}

#[test]
fn a_fifth_of_a_second_holds_the_ring_and_the_trophy_on_the_same_lap() {
    let data = detail(vec![
        outing("quick", 20, vec![lap("quick", 0, 100.2, 1.0)]),
        outing("slow", 10, vec![lap("slow", 0, 100.4, 1.0)]),
    ]);
    assert!(data.best_forward_is_record);
    assert_eq!(ringed(&data), vec!["quick-0"]);
    assert_eq!(calendar_holder(&data).as_deref(), Some("quick"));
    assert_eq!(marked(&data), vec!["quick-0"]);
}

#[test]
fn two_tied_laps_of_one_outing_hold_the_record_against_another_outing() {
    let data = detail(vec![
        outing(
            "double",
            20,
            vec![lap("double", 0, 90.0, 1.0), lap("double", 50, 90.0, 1.0)],
        ),
        outing("single", 10, vec![lap("single", 0, 100.0, 1.0)]),
    ]);
    assert!(data.best_forward_is_record);
    assert!(data.performances.best_forward_is_pr);
    assert_eq!(ringed(&data), vec!["double-0"]);
    assert_eq!(calendar_holder(&data).as_deref(), Some("double"));
    assert_eq!(marked(&data), vec!["double-0"]);
}

#[test]
fn a_lone_outing_is_a_record_on_no_surface() {
    let data = detail(vec![outing(
        "alone",
        10,
        vec![lap("alone", 0, 90.0, 1.0), lap("alone", 50, 95.0, 1.0)],
    )]);
    assert!(!data.best_forward_is_record);
    assert!(ringed(&data).is_empty());
    assert_eq!(calendar_holder(&data), None);
    assert!(marked(&data).is_empty());
}

#[test]
fn a_tie_between_two_outings_is_a_record_on_no_surface() {
    let data = detail(vec![
        outing("first", 30, vec![lap("first", 0, 90.0, 1.0)]),
        outing("second", 20, vec![lap("second", 0, 90.0, 1.0)]),
        outing("third", 10, vec![lap("third", 0, 100.0, 1.0)]),
    ]);
    assert!(!data.best_forward_is_record);
    assert!(ringed(&data).is_empty());
    assert_eq!(calendar_holder(&data), None);
    assert!(marked(&data).is_empty());
}

#[test]
fn a_lap_covering_part_of_the_section_is_neither_the_record_nor_its_rival() {
    let data = detail(vec![
        outing(
            "mixed",
            20,
            vec![lap("mixed", 0, 40.0, 0.5), lap("mixed", 50, 95.0, 1.0)],
        ),
        outing("other", 10, vec![lap("other", 0, 100.0, 1.0)]),
    ]);
    assert!(data.best_forward_is_record);
    assert_eq!(ringed(&data), vec!["mixed-50"]);
    assert_eq!(calendar_holder(&data).as_deref(), Some("mixed"));
    assert_eq!(marked(&data), vec!["mixed-50"]);
}
