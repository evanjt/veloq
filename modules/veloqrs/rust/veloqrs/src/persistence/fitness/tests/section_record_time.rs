use super::laps::summarise;
use crate::{SectionLap, SectionPerformanceRecord};

fn record(date: i64, distance: f64, time: f64) -> SectionPerformanceRecord {
    let activity_id = format!("run_{date}");
    let pace = distance / time;
    SectionPerformanceRecord {
        activity_id: activity_id.clone(),
        activity_name: activity_id.clone(),
        activity_date: crate::WholeNumber(date),
        laps: vec![SectionLap {
            id: format!("{activity_id}_lap"),
            activity_id,
            time,
            pace,
            distance,
            direction: "same".to_string(),
            start_index: 0,
            end_index: 10,
            avg_hr: None,
            avg_power: None,
            coverage: Some(1.0),
            excluded: false,
            outside_distance_band: false,
            match_percentage: None,
            is_record: false,
            estimated: false,
        }],
        lap_count: 1,
        best_time: time,
        best_pace: pace,
        best_forward_time: Some(time),
        best_reverse_time: None,
        best_estimated: false,
        avg_time: time,
        avg_pace: pace,
        direction: "same".to_string(),
        section_distance: 1837.0,
    }
}

#[test]
fn test_summarise_selects_shortest_complete_lap_time_for_record() {
    let result = summarise(
        1837.0,
        vec![record(1, 1951.0, 935.0), record(2, 1558.0, 870.0)],
    );
    let best = result.best_forward_record.as_ref().expect("forward best");
    assert_eq!(best.best_time, 870.0);
    assert_eq!(best.best_pace, 1558.0 / 870.0);

    let chart = crate::persistence::sections::ranking::chart_from_cutoff(&result, i64::MIN);
    let marked = chart
        .points
        .iter()
        .find(|point| point.is_best)
        .expect("record ring");
    assert_eq!(marked.activity_id, best.activity_id);
}

#[test]
fn test_direction_best_laps_selects_shortest_complete_lap_time() {
    let records = [record(1, 1951.0, 935.0), record(2, 1558.0, 870.0)];
    let laps = records
        .iter()
        .flat_map(|record| record.laps.clone())
        .collect::<Vec<_>>();
    let (forward, reverse) = super::direction_best_laps(&laps, 1837.0);
    assert_eq!(forward.expect("forward best").time, 870.0);
    assert!(reverse.is_none());
}
