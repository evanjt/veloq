use super::*;

fn histograms(points: &[FfiSectionChartPoint]) -> FfiAttemptHistograms {
    section_histograms(points, Some(1000.0))
}

fn point(seconds: u32, direction: &str) -> FfiSectionChartPoint {
    FfiSectionChartPoint {
        lap_id: format!("lap{seconds}"),
        activity_id: format!("a{seconds}"),
        activity_name: String::new(),
        activity_date: 1_700_000_000.0,
        speed: 1000.0 / f64::from(seconds),
        section_time: seconds,
        section_distance: 1000.0,
        direction: direction.to_string(),
        is_best: false,
        avg_power: None,
        outside_distance_band: false,
        match_percentage: None,
        off_scale: crate::FfiOffScale::None,
        record_gap_secs: None,
        record_gap_speed: None,
    }
}

fn points(times: &[u32], direction: &str) -> Vec<FfiSectionChartPoint> {
    times.iter().map(|&t| point(t, direction)).collect()
}

#[test]
fn times_bin_at_a_readable_step_with_the_slowest_in_the_closed_last_bin() {
    let h = histograms(&points(&[300, 305, 310, 330, 360], "same"));
    let forward = h.forward.expect("five attempts");
    assert_eq!(forward.bin_width_secs, 30.0);
    assert_eq!(forward.start_secs, 300.0);
    assert_eq!(forward.counts, vec![3, 2]);
    assert_eq!(forward.binned, 5);
    assert_eq!(forward.unbinned_outside_band, 0);
    assert!(h.reverse.is_none());
}

#[test]
fn a_direction_needs_three_attempts() {
    assert!(histograms(&points(&[300, 310], "same")).forward.is_none());
    assert!(
        histograms(&points(&[300, 310, 320], "same"))
            .forward
            .is_some()
    );
}

#[test]
fn identical_times_give_one_bin_of_the_smallest_step() {
    let forward = histograms(&points(&[400; 20], "same")).forward.unwrap();
    assert_eq!(forward.counts, vec![20]);
    assert_eq!(forward.bin_width_secs, 1.0);
    assert_eq!(forward.start_secs, 400.0);
}

#[test]
fn a_wide_spread_is_widened_to_at_most_twenty_bins() {
    // Evenly spread over 12 minutes; the Freedman-Diaconis step of 10 s
    // alone would give 72 bins.
    let times: Vec<u32> = (0..60).map(|i| 600 + i * 12).collect();
    let forward = histograms(&points(&times, "same")).forward.unwrap();
    assert!(forward.counts.len() <= MAX_BINS, "{forward:?}");
    assert_eq!(forward.counts.iter().sum::<u32>(), 60);
}

#[test]
fn a_reverse_attempt_counts_only_in_reverse() {
    let mut all = points(&[300, 310, 320], "same");
    all.extend(points(&[400, 410, 420, 430], "reverse"));
    let h = histograms(&all);
    assert_eq!(h.forward.unwrap().binned, 3);
    assert_eq!(h.reverse.unwrap().binned, 4);
}

#[test]
fn section_edges_carry_the_speed_over_each() {
    let forward = histograms(&points(&[300, 305, 310, 330, 360], "same"))
        .forward
        .unwrap();
    let speeds = forward.edge_speeds.expect("a section has an edge speed");
    assert_eq!(speeds.len(), forward.counts.len() + 1);
    for (i, speed) in speeds.iter().enumerate() {
        let edge = forward.start_secs + i as f64 * forward.bin_width_secs;
        assert_eq!(*speed, 1000.0 / edge);
    }
}

#[test]
fn test_section_histograms_edges_use_section_length() {
    let mut attempts = points(&[300, 310, 320], "same");
    for (attempt, distance) in attempts.iter_mut().zip([900.0, 1000.0, 1100.0]) {
        attempt.section_distance = distance;
    }
    let forward = section_histograms(&attempts, Some(1000.0)).forward.unwrap();
    let speeds = forward.edge_speeds.unwrap();
    for (index, speed) in speeds.iter().enumerate() {
        let edge = forward.start_secs + index as f64 * forward.bin_width_secs;
        assert_eq!(*speed, 1000.0 / edge);
    }
}

fn attempt(duration: u32, direction: &str, outside: bool, speed: f64) -> crate::RoutePerformance {
    crate::RoutePerformance {
        activity_id: format!("a{duration}"),
        name: String::new(),
        date: crate::WholeNumber(1_700_000_000),
        speed,
        duration,
        moving_time: duration,
        distance: 1000.0,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        is_current: false,
        direction: direction.to_string(),
        match_percentage: None,
        outside_distance_band: outside,
        is_record: false,
    }
}

#[test]
fn route_bins_only_in_band_complete_timed_attempts() {
    let mut all: Vec<_> = [300, 305, 310, 330, 360]
        .iter()
        .map(|&d| attempt(d, "same", false, 3.0))
        .collect();
    all.push(attempt(340, "partial", false, 3.0));
    all.push(attempt(900, "same", true, 1.0));
    all.push(attempt(910, "same", false, f64::NAN));
    let forward = route_histograms(&all).forward.unwrap();
    assert_eq!(forward.binned, 5);
    assert_eq!(forward.counts.iter().sum::<u32>(), 5);
    assert_eq!(forward.unbinned_outside_band, 1);
    assert!(forward.edge_speeds.is_none());
}

#[test]
fn route_directions_are_separate() {
    let mut all: Vec<_> = [300, 310, 320]
        .iter()
        .map(|&d| attempt(d, "reverse", false, 3.0))
        .collect();
    all.push(attempt(305, "same", false, 3.0));
    let h = route_histograms(&all);
    assert!(h.forward.is_none());
    assert_eq!(h.reverse.unwrap().binned, 3);
}
