use super::laps::summarise;
use crate::{SectionLap, SectionPerformanceRecord, SectionPerformanceResult};

fn record(date: i64, distance: f64, time: f64) -> SectionPerformanceRecord {
    named(&format!("run_{date}"), date, distance, time)
}

fn named(activity_id: &str, date: i64, distance: f64, time: f64) -> SectionPerformanceRecord {
    let activity_id = activity_id.to_string();
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

/// Three uploads of one ride share a start second and an equal best time. The
/// best named and the record order read back must be the same for every order
/// the records were collected in.
#[test]
fn test_summarise_names_the_same_best_whatever_order_equal_dates_arrive_in() {
    let base = [
        named("upload_c", 7, 1558.0, 870.0),
        named("upload_a", 7, 1558.0, 870.0),
        named("upload_b", 7, 1558.0, 870.0),
    ];
    let orders: [[usize; 3]; 6] = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ];
    let outcomes: Vec<(Option<String>, Vec<String>)> = orders
        .iter()
        .map(|order| {
            let records: Vec<SectionPerformanceRecord> =
                order.iter().map(|&i| base[i].clone()).collect();
            let result = summarise(1837.0, records);
            let best = result
                .best_forward_record
                .as_ref()
                .map(|r| r.activity_id.clone());
            let read = result
                .records
                .iter()
                .map(|r| r.activity_id.clone())
                .collect();
            (best, read)
        })
        .collect();
    assert_eq!(
        outcomes[0],
        (
            Some("upload_a".to_string()),
            vec![
                "upload_a".to_string(),
                "upload_b".to_string(),
                "upload_c".to_string()
            ]
        )
    );
    for outcome in &outcomes[1..] {
        assert_eq!(outcome, &outcomes[0]);
    }
}

/// Two uploads share a start second and differ in time. The progression steps
/// are read in record order, so the step list must not depend on the order the
/// records were collected in.
#[test]
fn test_record_progression_reads_equal_dates_in_one_order() {
    let slower = named("upload_a", 7, 1558.0, 900.0);
    let faster = named("upload_b", 7, 1558.0, 870.0);
    let steps = |records: Vec<SectionPerformanceRecord>| -> Vec<String> {
        let result: SectionPerformanceResult = summarise(1837.0, records);
        crate::persistence::records::section_record_progression(&result, false)
            .into_iter()
            .map(|step| step.activity_id)
            .collect()
    };
    let forward = steps(vec![slower.clone(), faster.clone()]);
    let reverse = steps(vec![faster, slower]);
    assert_eq!(forward, reverse);
    assert_eq!(forward, ["upload_a", "upload_b"]);
}
