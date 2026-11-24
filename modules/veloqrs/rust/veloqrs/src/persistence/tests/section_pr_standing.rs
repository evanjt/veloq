use super::{section_pr_standing, tests::lap_record};

#[test]
fn test_section_pr_standing_counts_only_timed_forward_laps() {
    let mut records: Vec<_> = [330.0, 320.0, 310.0, 300.0]
        .into_iter()
        .enumerate()
        .map(|(index, time)| lap_record(index as i64, time))
        .collect();
    let mut reverse = lap_record(5, 280.0);
    reverse.laps[0].direction = "reverse".into();
    records.push(reverse);
    records.push(lap_record(6, 0.0));

    let standing = section_pr_standing(&records, &records[3], false);
    assert_eq!(standing.standing_count, 4);
    assert_eq!(standing.percentile_faster, Some(100));
    assert_eq!(standing.previous_best_time, Some(310.0));
    assert_eq!(
        standing.previous_best_date,
        Some(records[2].activity_date.0 as f64)
    );
    assert_eq!(standing.delta_seconds, Some(10.0));
}

#[test]
fn test_section_pr_standing_single_reverse_lap_has_no_comparison() {
    let forward = lap_record(1, 310.0);
    let mut reverse = lap_record(2, 300.0);
    reverse.laps[0].direction = "reverse".into();
    reverse.direction = "reverse".into();
    let records = [forward, reverse];

    let standing = section_pr_standing(&records, &records[1], true);
    assert_eq!(standing.standing_count, 1);
    assert_eq!(standing.percentile_faster, None);
    assert_eq!(standing.previous_best_time, None);
    assert_eq!(standing.previous_best_date, None);
    assert_eq!(standing.delta_seconds, None);
}

#[test]
fn test_section_pr_standing_counts_forward_lap_inside_a_reverse_outing() {
    let pr = lap_record(1, 300.0);
    let mut mixed = lap_record(2, 280.0);
    mixed.laps[0].direction = "reverse".into();
    let mut forward = mixed.laps[0].clone();
    forward.direction = "same".into();
    forward.time = 320.0;
    mixed.laps.push(forward);
    let records = [pr, mixed, lap_record(3, 310.0)];

    let standing = section_pr_standing(&records, &records[0], false);
    assert_eq!(standing.standing_count, 3);
    assert_eq!(standing.percentile_faster, Some(100));
    assert_eq!(standing.previous_best_time, Some(310.0));
}

/// Scenario: the record is 100 s; another outing has an estimated 95 s pass and a 40 s pass
/// covering half the section, and a third has a 110 s pass timed on the ground.
///
/// Expected behaviour: only the timed passes stand, so the previous best is 110 s, not 95 s.
#[test]
fn test_section_pr_standing_ignores_estimated_and_short_laps() {
    let pr = lap_record(1, 100.0);
    let mut estimated = lap_record(2, 95.0);
    estimated.laps[0].estimated = true;
    let mut short = lap_record(3, 40.0);
    short.laps[0].coverage = Some(0.5);
    let records = [pr, estimated, short, lap_record(4, 110.0)];

    let standing = section_pr_standing(&records, &records[0], false);
    assert_eq!(standing.standing_count, 2);
    assert_eq!(standing.previous_best_time, Some(110.0));
    assert_eq!(standing.delta_seconds, Some(10.0));
}
