//! The scatter's focus range, the record progression and each attempt's gap
//! to the record, as the performance read carries them.

use crate::persistence::fitness::performances::laps;
use crate::{FfiOffScale, FfiPerformanceSubject, FfiSectionPerformanceData};

/// A mile, so a time reads as a pace per mile.
const MILE_M: f64 = 1609.344;

struct Attempt {
    activity: String,
    time: f64,
    direction: &'static str,
    coverage: f64,
    outside_band: bool,
}

fn attempt(activity: &str, time: f64) -> Attempt {
    Attempt {
        activity: activity.to_string(),
        time,
        direction: "same",
        coverage: 1.0,
        outside_band: false,
    }
}

/// One outing per attempt, a day apart, the first the oldest.
fn outings(attempts: &[Attempt], excluded: bool) -> Vec<crate::SectionPerformanceRecord> {
    let now = chrono::Utc::now().timestamp();
    let count = attempts.len() as i64;
    attempts
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let lap = crate::SectionLap {
                id: format!("{}-lap", a.activity),
                activity_id: a.activity.clone(),
                time: a.time,
                pace: MILE_M / a.time,
                distance: MILE_M * a.coverage,
                direction: a.direction.to_string(),
                start_index: 0,
                end_index: 10,
                avg_hr: None,
                avg_power: None,
                coverage: Some(a.coverage),
                excluded,
                outside_distance_band: a.outside_band,
                match_percentage: None,
                is_record: false,
                estimated: false,
            };
            crate::SectionPerformanceRecord {
                avg_pace_text: None,
                best_pace_text: None,
                activity_id: a.activity.clone(),
                activity_name: a.activity.clone(),
                activity_date: crate::WholeNumber(now - (count - i as i64) * 86_400),
                lap_count: 1,
                laps: vec![lap],
                best_time: a.time,
                best_pace: MILE_M / a.time,
                best_forward_time: (a.direction == "same").then_some(a.time),
                best_reverse_time: (a.direction == "reverse").then_some(a.time),
                best_estimated: false,
                avg_time: a.time,
                avg_pace: MILE_M / a.time,
                direction: a.direction.to_string(),
                section_distance: MILE_M,
            }
        })
        .collect()
}

fn read_with(
    included: &[Attempt],
    excluded: &[Attempt],
    subject: FfiPerformanceSubject,
    highlight: Option<&str>,
) -> FfiSectionPerformanceData {
    let all = std::sync::Arc::new(laps::summarise(MILE_M, outings(included, false)));
    let left_out = std::sync::Arc::new(laps::summarise(MILE_M, outings(excluded, true)));
    crate::persistence::screens::section_detail_from(
        &[],
        Some(MILE_M),
        None,
        0,
        subject,
        highlight,
        |_, _| Vec::new(),
        |_| Some(std::sync::Arc::new(None)),
        |_, _| None,
        |_| Vec::new(),
        |_, _| 0,
        |_, rows| match rows {
            laps::Rows::Included => all.clone(),
            laps::Rows::Excluded => left_out.clone(),
        },
    )
}

fn sport_read(included: &[Attempt], sport: &str) -> FfiSectionPerformanceData {
    let all = std::sync::Arc::new(laps::summarise(MILE_M, outings(included, false)));
    crate::persistence::screens::section_detail_from(
        &[],
        Some(MILE_M),
        Some(sport),
        0,
        FfiPerformanceSubject::Section,
        None,
        |_, _| Vec::new(),
        |_| Some(std::sync::Arc::new(None)),
        |_, _| None,
        |_| Vec::new(),
        |_, _| 0,
        |_, rows| match rows {
            laps::Rows::Included => all.clone(),
            laps::Rows::Excluded => std::sync::Arc::new(laps::empty()),
        },
    )
}

fn read_with_sport(
    included: &[Attempt],
    excluded: &[Attempt],
    sport: &str,
) -> FfiSectionPerformanceData {
    let all = std::sync::Arc::new(laps::summarise(MILE_M, outings(included, false)));
    let left_out = std::sync::Arc::new(laps::summarise(MILE_M, outings(excluded, true)));
    crate::persistence::screens::section_detail_from(
        &[],
        Some(MILE_M),
        Some(sport),
        0,
        FfiPerformanceSubject::Section,
        None,
        |_, _| Vec::new(),
        |_| Some(std::sync::Arc::new(None)),
        |_, _| None,
        |_| Vec::new(),
        |_, _| 0,
        |_, rows| match rows {
            laps::Rows::Included => all.clone(),
            laps::Rows::Excluded => left_out.clone(),
        },
    )
}

fn section_read(included: &[Attempt], highlight: Option<&str>) -> FfiSectionPerformanceData {
    read_with(included, &[], FfiPerformanceSubject::Section, highlight)
}

fn off_scale_of(data: &FfiSectionPerformanceData, activity: &str) -> FfiOffScale {
    data.chart_data
        .points
        .iter()
        .find(|p| p.activity_id == activity)
        .map(|p| p.off_scale)
        .expect("a point for the activity")
}

fn point<'a>(
    data: &'a FfiSectionPerformanceData,
    activity: &str,
) -> &'a crate::FfiSectionChartPoint {
    data.chart_data
        .points
        .iter()
        .find(|p| p.activity_id == activity)
        .expect("a point for the activity")
}

/// `count` attempts spread evenly from `fastest` to `slowest` seconds.
fn spread(count: usize, fastest: f64, slowest: f64) -> Vec<Attempt> {
    (0..count)
        .map(|i| {
            let time = fastest + (slowest - fastest) * i as f64 / (count - 1) as f64;
            attempt(&format!("a{i}"), time)
        })
        .collect()
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn one_stopped_attempt_is_flagged_slow_and_does_not_stretch_the_range() {
    let mut attempts = spread(88, 590.0, 630.0);
    attempts.push(attempt("stopped", 6360.0));

    let data = section_read(&attempts, None);

    let range = data
        .scatter_focus
        .forward
        .as_ref()
        .expect("a forward range");
    // On a speed axis: 10:50 per mile is the slow end, 9:30 the fast end.
    assert!(range.low >= MILE_M / 650.0, "{range:?}");
    assert!(range.high <= MILE_M / 570.0, "{range:?}");
    assert_eq!(off_scale_of(&data, "stopped"), FfiOffScale::Slow);
    assert_eq!((range.slow_count, range.fast_count), (1, 0));
    assert!(data.scatter_focus.reverse.is_none());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_record_and_the_highlighted_attempt_widen_the_range_and_are_never_flagged() {
    let mut attempts = spread(20, 600.0, 620.0);
    attempts.push(attempt("record", 400.0));
    attempts.push(attempt("today", 2000.0));

    let unhighlighted = section_read(&attempts, None);
    assert_eq!(off_scale_of(&unhighlighted, "today"), FfiOffScale::Slow);

    let data = section_read(&attempts, Some("today"));
    let range = data
        .scatter_focus
        .forward
        .as_ref()
        .expect("a forward range");
    assert!(point(&data, "record").is_best);
    assert_eq!(off_scale_of(&data, "record"), FfiOffScale::None);
    assert_eq!(off_scale_of(&data, "today"), FfiOffScale::None);
    assert!(
        range.low < MILE_M / 2000.0 && range.high > MILE_M / 400.0,
        "{range:?}"
    );
    assert_eq!((range.slow_count, range.fast_count), (0, 0));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn fewer_than_ten_attempts_flag_nothing() {
    let mut attempts = spread(8, 590.0, 630.0);
    attempts.push(attempt("stopped", 6360.0));

    let data = section_read(&attempts, None);

    let range = data
        .scatter_focus
        .forward
        .as_ref()
        .expect("a forward range");
    assert!(
        data.chart_data
            .points
            .iter()
            .all(|p| p.off_scale == FfiOffScale::None)
    );
    assert_eq!((range.slow_count, range.fast_count), (0, 0));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_direction_has_no_range() {
    let data = section_read(&[], None);
    assert!(data.scatter_focus.forward.is_none());
    assert!(data.scatter_focus.reverse.is_none());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_route_ranges_on_time_and_a_section_on_speed() {
    let attempts = spread(12, 590.0, 630.0);

    let section = section_read(&attempts, None);
    let route = read_with(&attempts, &[], FfiPerformanceSubject::Route, None);

    let speed = section.scatter_focus.forward.expect("a section range");
    assert!(
        speed.low < MILE_M / 630.0 && speed.high > MILE_M / 590.0,
        "{speed:?}"
    );
    assert!(speed.high < 10.0, "{speed:?}");
    let time = route.scatter_focus.forward.expect("a route range");
    assert!(time.low < 590.0 && time.high > 630.0, "{time:?}");
    assert!(time.low > 500.0, "{time:?}");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn on_a_time_axis_a_stopped_attempt_is_slow_past_the_top() {
    let mut attempts = spread(30, 590.0, 630.0);
    attempts.push(attempt("stopped", 6360.0));

    let route = read_with(&attempts, &[], FfiPerformanceSubject::Route, None);

    let range = route.scatter_focus.forward.as_ref().expect("a route range");
    assert!(range.high < 6360.0, "{range:?}");
    assert_eq!(off_scale_of(&route, "stopped"), FfiOffScale::Slow);
    assert_eq!((range.slow_count, range.fast_count), (1, 0));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_progression_steps_only_on_a_strict_beat_by_an_eligible_lap() {
    let mut fragment = attempt("fragment", 560.0);
    fragment.coverage = 0.5;
    let included = [
        attempt("first", 600.0),
        attempt("second", 590.0),
        attempt("slower", 595.0),
        attempt("tie", 590.0),
        attempt("record", 580.0),
        fragment,
    ];
    let excluded = [attempt("left-out", 500.0)];

    let data = read_with(&included, &excluded, FfiPerformanceSubject::Section, None);

    let steps = &data.record_progression.forward;
    let ids: Vec<&str> = steps.iter().map(|s| s.activity_id.as_str()).collect();
    assert_eq!(ids, ["first", "second", "record"]);
    let times: Vec<f64> = steps.iter().map(|s| s.section_time).collect();
    assert_eq!(times, [600.0, 590.0, 580.0]);
    let gains: Vec<Option<f64>> = steps.iter().map(|s| s.improvement_secs).collect();
    assert_eq!(gains, [None, Some(10.0), Some(10.0)]);
    assert_eq!(steps[0].improvement_speed, None);
    let speed_gain = steps[2].improvement_speed.expect("a speed gain");
    assert!((speed_gain - (MILE_M / 580.0 - MILE_M / 590.0)).abs() < 1e-9);
    assert!(data.record_progression.reverse.is_empty());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_progression_covers_the_whole_history_whatever_the_range() {
    let included = [attempt("old", 600.0), attempt("new", 590.0)];
    let all = std::sync::Arc::new(laps::summarise(MILE_M, {
        let mut records = outings(&included, false);
        // The old outing two years back, outside a 90-day range.
        records[0].activity_date.0 -= 730 * 86_400;
        records
    }));
    let data = crate::persistence::screens::section_detail_from(
        &[],
        Some(MILE_M),
        None,
        90,
        FfiPerformanceSubject::Section,
        None,
        |_, _| Vec::new(),
        |_| Some(std::sync::Arc::new(None)),
        |_, _| None,
        |_| Vec::new(),
        |_, _| 0,
        |_, rows| match rows {
            laps::Rows::Included => all.clone(),
            laps::Rows::Excluded => std::sync::Arc::new(laps::empty()),
        },
    );
    assert_eq!(data.chart_data.points.len(), 1);
    let ids: Vec<&str> = data
        .record_progression
        .forward
        .iter()
        .map(|s| s.activity_id.as_str())
        .collect();
    assert_eq!(ids, ["old", "new"]);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_direction_with_no_record_has_no_progression_and_no_gap() {
    let data = section_read(&[attempt("one", 600.0), attempt("two", 600.0)], None);
    assert!(data.record_progression.forward.is_empty());
    assert!(
        data.chart_data
            .points
            .iter()
            .all(|p| p.record_gap_secs.is_none())
    );
    assert!(
        data.chart_data
            .points
            .iter()
            .all(|p| p.record_gap_speed.is_none())
    );

    let lone = section_read(&[attempt("alone", 600.0)], None);
    assert!(lone.record_progression.forward.is_empty());
    assert_eq!(point(&lone, "alone").record_gap_secs, None);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_gap_is_zero_for_the_record_and_positive_for_a_slower_attempt() {
    let mut wide = attempt("wide", 700.0);
    wide.outside_band = true;
    let mut back = attempt("back", 650.0);
    back.direction = "reverse";
    let included = [
        attempt("record", 580.0),
        attempt("slower", 600.0),
        wide,
        back,
    ];
    let excluded = [attempt("left-out", 610.0)];

    let data = read_with(&included, &excluded, FfiPerformanceSubject::Section, None);

    let record = point(&data, "record");
    assert_eq!(record.record_gap_secs, Some(0.0));
    assert_eq!(record.record_gap_speed, Some(0.0));
    let slower = point(&data, "slower");
    assert_eq!(slower.record_gap_secs, Some(20.0));
    let speed_gap = slower.record_gap_speed.expect("a speed gap");
    assert!((speed_gap - (MILE_M / 580.0 - MILE_M / 600.0)).abs() < 1e-9);
    assert!(speed_gap > 0.0);
    assert_eq!(point(&data, "wide").record_gap_secs, None);
    // A lone reverse outing holds no record, so it has nothing to be behind.
    assert_eq!(point(&data, "back").record_gap_secs, None);
    let left_out = data
        .excluded_points
        .iter()
        .find(|p| p.activity_id == "left-out")
        .expect("the excluded point");
    assert_eq!(left_out.record_gap_secs, None);
    assert_eq!(left_out.record_gap_speed, None);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_excluded_attempt_is_flagged_against_the_range_but_not_counted() {
    let attempts = spread(20, 590.0, 630.0);
    let excluded = [attempt("stopped", 6360.0)];

    let data = read_with(&attempts, &excluded, FfiPerformanceSubject::Section, None);

    let left_out = &data.excluded_points[0];
    assert_eq!(left_out.off_scale, FfiOffScale::Slow);
    let range = data
        .scatter_focus
        .forward
        .as_ref()
        .expect("a forward range");
    assert_eq!((range.slow_count, range.fast_count), (0, 0));
}

#[test]
fn a_run_carries_its_gap_and_its_gain_as_pace_seconds() {
    let included = [
        attempt("first", 600.0),
        attempt("record", 580.0),
        attempt("slower", 590.0),
    ];

    let data = sport_read(&included, "Run");

    // Both are 10 s a mile behind or ahead, restated per kilometre.
    let behind = point(&data, "slower").record_gap_pace.expect("a gap");
    assert!((behind.imperial - 10.0).abs() < 0.01, "{behind:?}");
    assert!((behind.metric - 10.0 * 0.621371).abs() < 0.01, "{behind:?}");
    let holder = point(&data, "record").record_gap_pace.expect("a gap");
    assert_eq!((holder.metric, holder.imperial), (0.0, 0.0));
    let steps = &data.record_progression.forward;
    assert_eq!(steps[0].improvement_pace, None);
    let gain = steps[1].improvement_pace.expect("a gain");
    assert!((gain.imperial - 20.0).abs() < 0.01, "{gain:?}");
    assert!((gain.metric - 20.0 * 0.621371).abs() < 0.01, "{gain:?}");
}

#[test]
fn a_swim_carries_its_gap_per_hundred() {
    let data = sport_read(
        &[attempt("record", 580.0), attempt("slower", 600.0)],
        "Swim",
    );

    let gap = point(&data, "slower").record_gap_pace.expect("a gap");
    // 1609.344 m in 600 s and in 580 s: 37 and 36 s per 100 m, 34 and 33 per 100 yd.
    assert_eq!((gap.metric, gap.imperial), (1.0, 1.0));
}

#[test]
fn a_ride_and_a_read_with_no_sport_carry_no_pace_gap() {
    let attempts = [attempt("record", 580.0), attempt("slower", 600.0)];
    for data in [sport_read(&attempts, "Ride"), section_read(&attempts, None)] {
        assert!(
            data.chart_data
                .points
                .iter()
                .all(|p| p.record_gap_pace.is_none())
        );
        assert!(
            data.record_progression
                .forward
                .iter()
                .all(|s| s.improvement_pace.is_none())
        );
        assert!(point(&data, "slower").record_gap_speed.is_some());
    }
}

#[test]
fn an_attempt_with_no_gap_has_no_pace_gap() {
    let mut wide = attempt("wide", 700.0);
    wide.outside_band = true;
    let data = sport_read(
        &[attempt("record", 580.0), attempt("slower", 600.0), wide],
        "Run",
    );
    assert_eq!(point(&data, "wide").record_gap_pace, None);
}

fn texts(pace: &Option<crate::FfiPaceText>) -> Option<(&str, &str)> {
    pace.as_ref()
        .map(|t| (t.metric_text.as_str(), t.imperial_text.as_str()))
}

#[test]
fn a_run_read_carries_pace_text_for_every_speed_it_holds() {
    let mut included = [attempt("fast", 600.0), attempt("slow", 720.0)];
    included[1].direction = "reverse";
    let data = sport_read(&included, "Run");

    // 1609.344 m in 600 s is 6:13 a kilometre and 10:00 a mile.
    assert_eq!(
        texts(&point(&data, "fast").speed_pace),
        Some(("6:13", "10:00"))
    );
    assert_eq!(
        texts(&point(&data, "slow").speed_pace),
        Some(("7:27", "12:00"))
    );
    let record = &data.performances.records[0];
    assert_eq!(texts(&record.best_pace_text), Some(("6:13", "10:00")));
    assert_eq!(texts(&record.avg_pace_text), Some(("6:13", "10:00")));
    let best = data
        .performances
        .best_forward_record
        .as_ref()
        .expect("a forward best");
    assert_eq!(texts(&best.best_pace_text), Some(("6:13", "10:00")));
    let stats = data.performances.forward_stats.as_ref().expect("stats");
    assert_eq!(texts(&stats.avg_pace_text), Some(("6:13", "10:00")));
    let reverse = data.performances.reverse_stats.as_ref().expect("stats");
    assert_eq!(texts(&reverse.avg_pace_text), Some(("7:27", "12:00")));
    let calendar = data.calendar_summary.as_ref().expect("a calendar");
    let year = calendar.years[0].forward.as_ref().expect("a forward best");
    assert_eq!(texts(&year.best_pace_text), Some(("6:13", "10:00")));
    let month = calendar.years[0].months[0]
        .forward
        .as_ref()
        .expect("a forward best");
    assert_eq!(texts(&month.best_pace_text), Some(("6:13", "10:00")));
    let listed = data
        .lap_records
        .iter()
        .find(|r| r.activity_id == "fast")
        .expect("a listed outing");
    assert_eq!(texts(&listed.best_pace_text), Some(("6:13", "10:00")));
}

#[test]
fn the_calendar_record_carries_pace_text() {
    let data = sport_read(&[attempt("fast", 600.0), attempt("slow", 720.0)], "Run");
    let record = data
        .calendar_summary
        .as_ref()
        .and_then(|c| c.forward_pr.as_ref())
        .expect("a record");
    assert_eq!(texts(&record.best_pace_text), Some(("6:13", "10:00")));
}

#[test]
fn an_excluded_attempt_carries_pace_text() {
    let data = read_with_sport(&[attempt("kept", 600.0)], &[attempt("left", 720.0)], "Run");
    assert_eq!(
        texts(&data.excluded_points[0].speed_pace),
        Some(("7:27", "12:00"))
    );
}

#[test]
fn a_swim_read_carries_pace_text_per_hundred() {
    let data = sport_read(&[attempt("swum", 1200.0)], "Swim");

    // 1609.344 m in 1200 s: 1:15 per 100 m, 1:08 per 100 yd.
    assert_eq!(
        texts(&point(&data, "swum").speed_pace),
        Some(("1:15", "1:08"))
    );
    let stats = data.performances.forward_stats.as_ref().expect("stats");
    assert_eq!(texts(&stats.avg_pace_text), Some(("1:15", "1:08")));
}

#[test]
fn a_ride_and_a_read_with_no_sport_carry_no_pace_text() {
    let attempts = [attempt("a", 580.0), attempt("b", 600.0)];
    for data in [sport_read(&attempts, "Ride"), section_read(&attempts, None)] {
        assert!(
            data.chart_data
                .points
                .iter()
                .all(|p| p.speed_pace.is_none())
        );
        let record = &data.performances.records[0];
        assert!(record.best_pace_text.is_none() && record.avg_pace_text.is_none());
        let stats = data.performances.forward_stats.as_ref().expect("stats");
        assert!(stats.avg_pace_text.is_none());
        let calendar = data.calendar_summary.as_ref().expect("a calendar");
        let year = calendar.years[0].forward.as_ref().expect("a best");
        assert!(year.best_pace_text.is_none());
    }
}

#[test]
fn the_axis_marks_and_histogram_edges_carry_pace_text() {
    let attempts = [
        attempt("a", 600.0),
        attempt("b", 640.0),
        attempt("c", 700.0),
        attempt("d", 760.0),
    ];
    let data = sport_read(&attempts, "Run");

    let range = data.scatter_focus.forward.as_ref().expect("a range");
    let mark = |speed: f64| crate::widget_snapshot::sport_pace_text(speed, "Run");
    let as_pair = |pace: &Option<crate::FfiPaceText>| {
        pace.as_ref()
            .map(|t| (t.metric_text.clone(), t.imperial_text.clone()))
    };
    assert_eq!(as_pair(&range.low_pace), mark(range.low));
    assert_eq!(as_pair(&range.high_pace), mark(range.high));
    assert_eq!(
        as_pair(&range.mid_pace),
        mark((range.low + range.high) / 2.0)
    );
    assert!(range.low_pace.is_some());

    let histogram = data.histograms.forward.as_ref().expect("a histogram");
    let speeds = histogram.edge_speeds.as_ref().expect("edge speeds");
    let edges = histogram.edge_pace.as_ref().expect("edge pace");
    assert_eq!(edges.len(), speeds.len());
    for (speed, edge) in speeds.iter().zip(edges) {
        assert_eq!(as_pair(edge), mark(*speed));
    }
    // A zero edge has no pace.
    assert!(
        edges
            .iter()
            .zip(speeds)
            .all(|(e, s)| (*s > 0.0) == e.is_some())
    );
}

#[test]
fn a_ride_has_no_pace_marks_or_edges() {
    let attempts = [
        attempt("a", 600.0),
        attempt("b", 640.0),
        attempt("c", 700.0),
    ];
    let data = sport_read(&attempts, "Ride");
    let range = data.scatter_focus.forward.as_ref().expect("a range");
    assert!(range.low_pace.is_none() && range.mid_pace.is_none() && range.high_pace.is_none());
    let histogram = data.histograms.forward.as_ref().expect("a histogram");
    assert!(histogram.edge_speeds.is_some() && histogram.edge_pace.is_none());
}
