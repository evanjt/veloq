use super::super::*;
use crate::{
    FfiActivityMetrics, FfiClaimBasis, FfiPaceTrend, FfiPeriodStats, FfiWellnessSparklines,
    FfiWidgetSnapshotData, WidgetSummaryCardData, WidgetWellnessSummary,
};

const NOW: i64 = 1_800_000_000;

fn glyph(g: &str) -> Option<String> {
    Some(g.to_string())
}

fn week(count: u32, total_duration: f64, total_tss: f64) -> FfiPeriodStats {
    FfiPeriodStats {
        count,
        total_duration,
        total_distance: 0.0,
        total_tss,
    }
}

fn sparklines() -> FfiWellnessSparklines {
    FfiWellnessSparklines {
        fitness: vec![50, 50],
        fatigue: vec![40, 40],
        form: vec![10, 10],
        hrv: vec![60, 60],
        rhr: vec![50, 50],
        ..Default::default()
    }
}

fn summary(wellness: WidgetWellnessSummary) -> WidgetSummaryCardData {
    WidgetSummaryCardData {
        current_week: week(4, 7200.0, 100.0),
        prev_week: week(4, 7200.0, 100.0),
        wellness,
        ..Default::default()
    }
}

fn data(
    wellness: WidgetWellnessSummary,
    sparklines: FfiWellnessSparklines,
) -> FfiWidgetSnapshotData {
    FfiWidgetSnapshotData {
        sparklines: Some(sparklines),
        summary: summary(wellness),
        ..Default::default()
    }
}

fn context() -> WidgetContext {
    WidgetContext {
        locale: "en-AU".to_string(),
        is_metric: true,
        summary_card: Some(SummaryPrefs {
            enabled: true,
            hero_metric: "fitness".to_string(),
            show_sparkline: false,
            supporting_metrics: ["form", "hrv", "rhr", "thresholdPace"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        }),
        ..Default::default()
    }
}

fn clock() -> Clock {
    Clock {
        now_seconds: NOW,
        now_wall_seconds: NOW,
    }
}

fn snapshot(data: &FfiWidgetSnapshotData) -> WidgetSnapshot {
    compose(data, &context(), clock())
}

fn entry(snapshot: &WidgetSnapshot, id: &str) -> SummaryEntry {
    snapshot
        .summary_card
        .as_ref()
        .expect("a summary card")
        .entries
        .iter()
        .find(|e| e.id == id)
        .unwrap_or_else(|| panic!("no {id} entry"))
        .clone()
}

fn assert_judged(m: &MetricValue, trend_dir: &str, verdict: &str) {
    assert_eq!((m.trend_dir, m.verdict), (trend_dir, verdict));
}

fn assert_entry(e: &SummaryEntry, trend_dir: &str, verdict: &str) {
    assert_eq!((e.trend_dir, e.verdict), (trend_dir, verdict));
}

// Two decimal places, the default precision of the assertion this mirrors.
fn assert_close(actual: Option<f64>, expected: f64) {
    let actual = actual.expect("a change");
    assert!(
        (actual - expected).abs() < 0.005,
        "{actual} is not close to {expected}"
    );
}

#[test]
fn resting_hr_rise_draws_as_a_decline_in_the_metric_and_the_summary_entry() {
    let d = data(
        WidgetWellnessSummary {
            rhr: Some(52.0),
            rhr_trend: glyph("↓"),
            ..Default::default()
        },
        FfiWellnessSparklines {
            rhr: vec![50, 52],
            ..sparklines()
        },
    );
    let s = snapshot(&d);
    assert_eq!(s.metrics.rhr.value, 52.0);
    assert_judged(&s.metrics.rhr, "down", "declined");
    let e = entry(&s, "rhr");
    assert_eq!(e.value, "52");
    assert_entry(&e, "down", "declined");
}

#[test]
fn resting_hr_fall_draws_as_an_improvement() {
    let d = data(
        WidgetWellnessSummary {
            rhr: Some(50.0),
            rhr_trend: glyph("↑"),
            ..Default::default()
        },
        FfiWellnessSparklines {
            rhr: vec![52, 50],
            ..sparklines()
        },
    );
    let s = snapshot(&d);
    assert_judged(&s.metrics.rhr, "up", "improved");
    assert_entry(&entry(&s, "rhr"), "up", "improved");
}

#[test]
fn resting_hr_with_no_engine_arrow_draws_flat() {
    let d = data(
        WidgetWellnessSummary {
            rhr: Some(50.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            rhr: vec![50, 50],
            ..sparklines()
        },
    );
    assert_judged(&snapshot(&d).metrics.rhr, "flat", "flat");
}

fn fatigue(value: f64, previous: f64) -> WidgetWellnessSummary {
    WidgetWellnessSummary {
        fatigue: Some(value),
        fatigue_previous: Some(previous),
        fatigue_basis: Some(earlier_readings(2)),
        ..Default::default()
    }
}

fn earlier_readings(population: u32) -> FfiClaimBasis {
    FfiClaimBasis {
        baseline: "earlierReading".to_string(),
        population,
    }
}

#[test]
fn fatigue_draws_no_move_on_one_earlier_reading() {
    let mut w = fatigue(46.0, 40.0);
    w.fatigue_basis = Some(earlier_readings(1));
    let s = snapshot(&data(w, sparklines()));
    assert_judged(&s.metrics.fatigue, "flat", "flat");
    assert_eq!(s.metrics.fatigue.value, 46.0);
}

#[test]
fn fatigue_is_a_move_with_no_judgement_in_either_direction() {
    let up = snapshot(&data(fatigue(46.0, 40.0), sparklines()));
    assert_judged(&up.metrics.fatigue, "up", "moved");
    let down = snapshot(&data(fatigue(40.0, 46.0), sparklines()));
    assert_judged(&down.metrics.fatigue, "down", "moved");
}

#[test]
fn fatigue_is_flat_inside_the_deadband() {
    let s = snapshot(&data(fatigue(40.5, 40.0), sparklines()));
    assert_judged(&s.metrics.fatigue, "flat", "flat");
}

#[test]
fn form_is_flat_in_the_metric_and_the_entry_when_the_engine_says_flat_whatever_the_sparkline_did() {
    // The engine rounds sparklines to whole numbers, so a rise is 10 to 12 here.
    let d = data(
        WidgetWellnessSummary {
            form: Some(11.0),
            form_trend: glyph("→"),
            fitness: Some(50.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            form: vec![10, 12],
            ..sparklines()
        },
    );
    let s = snapshot(&d);
    assert_judged(&s.metrics.form, "flat", "flat");
    assert_entry(&entry(&s, "form"), "flat", "flat");
}

#[test]
fn form_moves_with_no_judgement_when_the_engine_draws_a_direction() {
    let d = data(
        WidgetWellnessSummary {
            form: Some(12.0),
            form_trend: glyph("↑"),
            fitness: Some(50.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            form: vec![9, 12],
            ..sparklines()
        },
    );
    let s = snapshot(&d);
    assert_judged(&s.metrics.form, "up", "moved");
    assert_entry(&entry(&s, "form"), "up", "moved");
}

#[test]
fn form_takes_the_card_value_not_the_sparkline_value() {
    let d = data(
        WidgetWellnessSummary {
            form: Some(12.0),
            form_trend: glyph("↑"),
            fitness: Some(51.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            form: vec![10, 11],
            ..sparklines()
        },
    );
    assert_eq!(snapshot(&d).metrics.form.value, 12.0);
}

fn fitness_only(fitness: f64) -> WidgetWellnessSummary {
    WidgetWellnessSummary {
        fitness: Some(fitness),
        ..Default::default()
    }
}

#[test]
fn hrv_with_no_card_baseline_shows_no_value_and_no_arrow_even_when_the_sparkline_carries_one_forward()
 {
    let d = data(
        fitness_only(50.0),
        FfiWellnessSparklines {
            hrv: vec![60, 55],
            ..sparklines()
        },
    );
    let s = snapshot(&d);
    assert_judged(&s.metrics.hrv, "flat", "flat");
    let e = entry(&s, "hrv");
    assert_eq!(e.value, "-");
    assert_entry(&e, "flat", "flat");
}

#[test]
fn hrv_and_resting_hr_with_no_reading_print_a_dash_not_a_zero() {
    let d = data(
        fitness_only(50.0),
        FfiWellnessSparklines {
            hrv: vec![],
            rhr: vec![],
            ..sparklines()
        },
    );
    let m = snapshot(&d).metrics;
    assert_eq!(m.hrv.text.as_deref(), Some("-"));
    assert_eq!(m.rhr.text.as_deref(), Some("-"));
    assert_eq!(m.hrv.delta_vs_yesterday, None);
}

#[test]
fn fatigue_with_no_reading_prints_a_dash_not_a_zero() {
    let d = data(fitness_only(50.0), sparklines());
    let m = snapshot(&d).metrics;
    assert_eq!(m.fatigue.text.as_deref(), Some("-"));
    assert_eq!(m.fatigue.delta_vs_yesterday, None);
}

#[test]
fn a_fatigue_reading_prints_no_dash_so_the_native_falls_through_to_the_number() {
    let d = data(
        WidgetWellnessSummary {
            fitness: Some(50.0),
            fatigue: Some(42.0),
            ..Default::default()
        },
        sparklines(),
    );
    assert_eq!(snapshot(&d).metrics.fatigue.text, None);
}

#[test]
fn an_hrv_reading_prints_no_dash_so_the_native_falls_through_to_the_number() {
    let d = data(
        WidgetWellnessSummary {
            fitness: Some(50.0),
            hrv: Some(64.0),
            rhr: Some(49.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            hrv: vec![60, 64],
            ..sparklines()
        },
    );
    let m = snapshot(&d).metrics;
    assert_eq!(m.hrv.text, None);
    assert_eq!(m.rhr.text, None);
}

#[test]
fn fitness_draws_the_engine_arrow_when_the_last_two_sparkline_days_are_both_carried_forward() {
    let d = data(
        WidgetWellnessSummary {
            fitness: Some(52.0),
            fitness_trend: glyph("↑"),
            ..Default::default()
        },
        FfiWellnessSparklines {
            fitness: vec![52, 52],
            ..sparklines()
        },
    );
    let m = snapshot(&d).metrics.fitness;
    assert_eq!(m.value, 52.0);
    assert_judged(&m, "up", "improved");
}

fn with_run_pace(latest: f64, previous: f64, g: &str) -> FfiWidgetSnapshotData {
    let mut d = data(WidgetWellnessSummary::default(), sparklines());
    d.summary.run_pace_trend = FfiPaceTrend {
        latest_pace: Some(latest),
        previous_pace: Some(previous),
        glyph: glyph(g),
        ..Default::default()
    };
    d
}

#[test]
fn a_faster_pace_draws_as_an_improvement_from_the_engine_glyph() {
    let s = snapshot(&with_run_pace(3.5, 3.3, "↑"));
    assert_entry(&entry(&s, "thresholdPace"), "up", "improved");
}

#[test]
fn a_slower_pace_draws_as_a_decline() {
    let s = snapshot(&with_run_pace(3.1, 3.3, "↓"));
    assert_entry(&entry(&s, "thresholdPace"), "down", "declined");
}

#[test]
fn a_longer_week_is_judged_an_improvement() {
    let mut d = data(WidgetWellnessSummary::default(), sparklines());
    d.summary.current_week = week(4, 14_400.0, 1.0);
    let mut ctx = context();
    ctx.summary_card.as_mut().unwrap().supporting_metrics = vec!["weekHours".to_string()];
    let s = compose(&d, &ctx, clock());
    assert_entry(&entry(&s, "weekHours"), "up", "improved");
}

#[test]
fn the_printed_change_is_the_difference_from_the_value_the_engine_judged_the_arrow_against() {
    let d = data(
        WidgetWellnessSummary {
            fitness: Some(52.0),
            fitness_trend: glyph("↑"),
            fitness_previous: Some(50.0),
            form: Some(8.0),
            form_trend: glyph("↓"),
            form_previous: Some(10.0),
            hrv: Some(64.0),
            hrv_trend: glyph("↑"),
            hrv_previous: Some(60.0),
            rhr: Some(49.0),
            rhr_trend: glyph("↑"),
            rhr_previous: Some(52.0),
            fatigue: Some(44.0),
            fatigue_previous: Some(40.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            fitness: vec![1, 1],
            form: vec![1, 1],
            hrv: vec![1, 1],
            rhr: vec![1, 1],
            fatigue: vec![1, 1],
            ..Default::default()
        },
    );
    let m = snapshot(&d).metrics;
    assert_eq!(m.fitness.delta_vs_yesterday, Some(2.0));
    assert_eq!(m.form.delta_vs_yesterday, Some(-2.0));
    assert_eq!(m.hrv.delta_vs_yesterday, Some(4.0));
    assert_eq!(m.rhr.delta_vs_yesterday, Some(-3.0));
    assert_eq!(m.fatigue.delta_vs_yesterday, Some(4.0));
}

#[test]
fn the_printed_change_is_absent_where_the_engine_has_no_baseline() {
    let d = data(
        WidgetWellnessSummary {
            fitness: Some(52.0),
            hrv: Some(64.0),
            rhr: Some(49.0),
            fatigue: Some(44.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            fitness: vec![50, 52],
            ..sparklines()
        },
    );
    let m = snapshot(&d).metrics;
    assert_eq!(m.fitness.delta_vs_yesterday, None);
    assert_eq!(m.hrv.delta_vs_yesterday, None);
    assert_eq!(m.rhr.delta_vs_yesterday, None);
    assert_eq!(m.fatigue.delta_vs_yesterday, None);
}

#[test]
fn the_printed_form_change_is_in_percentage_points_under_the_percentage_setting() {
    let d = data(
        WidgetWellnessSummary {
            form: Some(10.0),
            form_trend: glyph("↑"),
            fitness: Some(50.0),
            form_previous: Some(5.0),
            fitness_previous: Some(50.0),
            ..Default::default()
        },
        sparklines(),
    );
    let ctx = WidgetContext {
        form_as_percent: true,
        ..context()
    };
    assert_close(
        compose(&d, &ctx, clock()).metrics.form.delta_vs_yesterday,
        10.0,
    );
}

#[test]
fn the_printed_form_change_is_absent_under_the_percentage_setting_when_the_baseline_day_had_no_fitness()
 {
    let d = data(
        WidgetWellnessSummary {
            form: Some(10.0),
            form_trend: glyph("↑"),
            fitness: Some(50.0),
            form_previous: Some(5.0),
            ..Default::default()
        },
        sparklines(),
    );
    let ctx = WidgetContext {
        form_as_percent: true,
        ..context()
    };
    assert_eq!(
        compose(&d, &ctx, clock()).metrics.form.delta_vs_yesterday,
        None
    );
}

#[test]
fn fatigue_reads_the_newest_row_not_a_sparkline_that_carried_yesterday_forward() {
    let d = data(
        fitness_only(50.0),
        FfiWellnessSparklines {
            fatigue: vec![40, 40],
            ..sparklines()
        },
    );
    let m = snapshot(&d).metrics.fatigue;
    assert_eq!(m.value, 0.0);
    assert_judged(&m, "flat", "flat");
    assert_eq!(m.delta_vs_yesterday, None);
}

#[test]
fn fatigue_is_a_move_with_no_judgement_against_the_engine_baseline() {
    let up = snapshot(&data(fatigue(46.0, 40.0), sparklines()))
        .metrics
        .fatigue;
    assert_eq!(up.value, 46.0);
    assert_judged(&up, "up", "moved");
    let down = snapshot(&data(fatigue(40.0, 46.0), sparklines()))
        .metrics
        .fatigue;
    assert_judged(&down, "down", "moved");
}

fn with_latest(
    wellness: WidgetWellnessSummary,
    sparklines: FfiWellnessSparklines,
) -> FfiWidgetSnapshotData {
    FfiWidgetSnapshotData {
        latest: Some(FfiActivityMetrics {
            activity_id: "a1".to_string(),
            name: "Ride".to_string(),
            date: (NOW - 3600) as f64,
            distance: 1000.0,
            moving_time: 600,
            sport_type: "Ride".to_string(),
            ..Default::default()
        }),
        ..data(wellness, sparklines)
    }
}

#[test]
fn the_impact_deltas_read_the_engine_baselines_not_the_last_two_sparkline_days() {
    let d = with_latest(
        WidgetWellnessSummary {
            fitness: Some(52.0),
            fitness_previous: Some(50.0),
            fatigue: Some(44.0),
            fatigue_previous: Some(40.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            fitness: vec![52, 52],
            fatigue: vec![44, 44],
            ..sparklines()
        },
    );
    let impact = snapshot(&d).impact.expect("an impact");
    assert_eq!(impact.ctl_delta, 2.0);
    assert_eq!(impact.atl_delta, 4.0);
}

#[test]
fn the_impact_deltas_are_zero_when_the_engine_has_no_baseline() {
    let d = with_latest(
        WidgetWellnessSummary {
            fitness: Some(52.0),
            fatigue: Some(44.0),
            ..Default::default()
        },
        FfiWellnessSparklines {
            fitness: vec![40, 52],
            fatigue: vec![30, 44],
            ..sparklines()
        },
    );
    let impact = snapshot(&d).impact.expect("an impact");
    assert_eq!(impact.ctl_delta, 0.0);
    assert_eq!(impact.atl_delta, 0.0);
}

// The card's newest row can lack HRV, or differ from the day a filled sparkline ends on.
mod card_parity {
    use super::super::super::*;
    use crate::{
        FfiPeriodStats, FfiWellnessSparklines, FfiWidgetSnapshotData, WidgetSummaryCardData,
        WidgetWellnessSummary,
    };

    const NOW: i64 = 1_800_000_000;

    fn week() -> FfiPeriodStats {
        FfiPeriodStats {
            count: 1,
            total_duration: 3600.0,
            total_distance: 0.0,
            total_tss: 50.0,
        }
    }

    fn flat() -> FfiWellnessSparklines {
        FfiWellnessSparklines {
            fitness: vec![50, 50],
            fatigue: vec![40, 40],
            form: vec![10, 10],
            hrv: vec![55, 55],
            rhr: vec![50, 50],
            ..Default::default()
        }
    }

    fn metrics(wellness: WidgetWellnessSummary, sparklines: FfiWellnessSparklines) -> Metrics {
        let data = FfiWidgetSnapshotData {
            sparklines: Some(sparklines),
            summary: WidgetSummaryCardData {
                current_week: week(),
                prev_week: week(),
                wellness,
                ..Default::default()
            },
            ..Default::default()
        };
        let ctx = WidgetContext {
            locale: "en-AU".to_string(),
            is_metric: true,
            ..Default::default()
        };
        let clock = Clock {
            now_seconds: NOW,
            now_wall_seconds: NOW,
        };
        compose(&data, &ctx, clock).metrics
    }

    #[test]
    fn prints_no_hrv_and_no_change_when_the_newest_row_has_none() {
        let m = metrics(
            WidgetWellnessSummary {
                hrv: None,
                hrv_previous: Some(50.0),
                fitness: Some(50.0),
                ..Default::default()
            },
            flat(),
        );
        assert_eq!(m.hrv.value, 0.0);
        assert_eq!(m.hrv.delta_vs_yesterday, None);
    }

    #[test]
    fn ignores_a_sparkline_that_ends_on_a_different_value_from_the_card() {
        let m = metrics(
            WidgetWellnessSummary {
                hrv: Some(60.0),
                hrv_previous: Some(55.0),
                rhr: Some(48.0),
                rhr_previous: Some(50.0),
                fitness: Some(52.0),
                fitness_previous: Some(51.0),
                ..Default::default()
            },
            FfiWellnessSparklines {
                hrv: vec![50, 55],
                rhr: vec![49, 50],
                fitness: vec![50, 51],
                ..flat()
            },
        );
        assert_eq!(m.hrv.delta_vs_yesterday, Some(5.0));
        assert_eq!(m.rhr.delta_vs_yesterday, Some(-2.0));
        assert_eq!(m.fitness.delta_vs_yesterday, Some(1.0));
    }

    #[test]
    fn prints_no_change_where_the_engine_had_no_baseline_whatever_the_sparkline_holds() {
        let m = metrics(
            WidgetWellnessSummary {
                hrv: Some(55.0),
                rhr: Some(50.0),
                fitness: Some(51.0),
                form: Some(11.0),
                ..Default::default()
            },
            FfiWellnessSparklines {
                hrv: vec![50, 55],
                fitness: vec![50, 51],
                ..flat()
            },
        );
        assert_eq!(m.hrv.delta_vs_yesterday, None);
        assert_eq!(m.fitness.delta_vs_yesterday, None);
        assert_eq!(m.form.delta_vs_yesterday, None);
    }

    #[test]
    fn prints_the_form_change_from_the_engine_baseline() {
        let m = metrics(
            WidgetWellnessSummary {
                form: Some(11.0),
                form_previous: Some(10.0),
                fitness: Some(51.0),
                ..Default::default()
            },
            flat(),
        );
        let change = m.form.delta_vs_yesterday.expect("a change");
        assert!((change - 1.0).abs() < 0.005, "{change}");
    }
}

// The in-app card prints these same strings for the same bundle.
mod pace_one_source {
    use super::super::super::*;
    use crate::{FfiPaceTrend, FfiWidgetSnapshotData, WidgetSummaryCardData};

    const NOW: i64 = 1_733_360_000;

    fn pace(latest: f64, previous: f64, glyph: &str) -> FfiPaceTrend {
        FfiPaceTrend {
            latest_pace: Some(latest),
            previous_pace: Some(previous),
            glyph: Some(glyph.to_string()),
            ..Default::default()
        }
    }

    fn run() -> FfiPaceTrend {
        pace(3.5, 3.4, "↑")
    }

    fn swim() -> FfiPaceTrend {
        pace(1.35, 1.25, "↑")
    }

    fn entries(
        run: FfiPaceTrend,
        swim: FfiPaceTrend,
        is_metric: bool,
    ) -> (SummaryEntry, SummaryEntry) {
        let data = FfiWidgetSnapshotData {
            sparklines: None,
            summary: WidgetSummaryCardData {
                run_pace_trend: run,
                swim_pace_trend: swim,
                ..Default::default()
            },
            ..Default::default()
        };
        let ctx = WidgetContext {
            locale: "en-AU".to_string(),
            is_metric,
            summary_card: Some(SummaryPrefs {
                enabled: true,
                hero_metric: "fitness".to_string(),
                show_sparkline: true,
                supporting_metrics: vec!["thresholdPace".to_string(), "css".to_string()],
            }),
            ..Default::default()
        };
        let clock = Clock {
            now_seconds: NOW,
            now_wall_seconds: NOW,
        };
        let card = compose(&data, &ctx, clock)
            .summary_card
            .expect("a summary card");
        let find = |id: &str| card.entries.iter().find(|e| e.id == id).expect(id).clone();
        (find("thresholdPace"), find("css"))
    }

    #[test]
    fn prints_the_measured_paces_in_metric() {
        // 1000 / 3.5 is 285.7 s a kilometre, and 100 / 1.35 rounds to 74 s a hundred metres.
        let (pace, css) = entries(run(), swim(), true);
        assert_eq!(pace.value, "4:46");
        assert_eq!(css.value, "1:14");
    }

    #[test]
    fn prints_the_measured_paces_in_imperial() {
        // 285.7 / 0.621371 is 459.8 s a mile, and 91.44 / 1.35 rounds to 68 s a hundred yards.
        let (pace, css) = entries(run(), swim(), false);
        assert_eq!(pace.value, "7:40");
        assert_eq!(css.value, "1:08");
    }

    #[test]
    fn draws_the_glyph_the_engine_judged_up_for_a_faster_pace() {
        let (pace, css) = entries(pace(3.95, 3.8, "↑"), pace(1.25, 1.35, "↓"), true);
        assert_eq!((pace.trend_dir, pace.verdict), ("up", "improved"));
        assert_eq!((css.trend_dir, css.verdict), ("down", "declined"));
    }

    #[test]
    fn draws_flat_for_a_move_the_engine_called_flat() {
        let (pace, _) = entries(pace(3.83, 3.8, "→"), FfiPaceTrend::default(), true);
        assert_eq!((pace.trend_dir, pace.verdict), ("flat", "flat"));
    }

    #[test]
    fn prints_a_placeholder_and_draws_flat_when_the_engine_measured_nothing() {
        let (pace, css) = entries(FfiPaceTrend::default(), FfiPaceTrend::default(), true);
        assert_eq!(pace.value, "-");
        assert_eq!(css.value, "-");
        assert_eq!((pace.trend_dir, pace.verdict), ("flat", "flat"));
        assert_eq!((css.trend_dir, css.verdict), ("flat", "flat"));
    }
}
