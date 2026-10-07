use super::super::*;
use crate::{
    FfiWellnessSparklines, FfiWidgetSnapshotData, WidgetSummaryCardData, WidgetWellnessSummary,
};

const NOW: i64 = 1_760_000_000;

// Form holds at -20 as fitness rises, so only the zones banded on a share of fitness move.
const FORM: [i32; 4] = [-20, -20, -20, -20];
const FITNESS: [i32; 4] = [30, 60, 150, 300];

fn data() -> FfiWidgetSnapshotData {
    FfiWidgetSnapshotData {
        sparklines: Some(FfiWellnessSparklines {
            form: FORM.to_vec(),
            fitness: FITNESS.to_vec(),
            fatigue: vec![50, 80, 170, 320],
            hrv: vec![],
            rhr: vec![],
            ..Default::default()
        }),
        summary: WidgetSummaryCardData {
            wellness: WidgetWellnessSummary {
                form: Some(f64::from(FORM[3])),
                fitness: Some(f64::from(FITNESS[3])),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }
}

fn context(form_as_percent: bool) -> WidgetContext {
    WidgetContext {
        locale: "en-AU".to_string(),
        is_metric: true,
        form_as_percent,
        ..Default::default()
    }
}

fn snapshot(data: &FfiWidgetSnapshotData, form_as_percent: bool) -> WidgetSnapshot {
    let clock = Clock {
        now_seconds: NOW,
        now_wall_seconds: NOW,
    };
    compose(data, &context(form_as_percent), clock)
}

fn set_fitness(data: &mut FfiWidgetSnapshotData, fitness: Vec<i32>) {
    data.sparklines.as_mut().unwrap().fitness = fitness;
}

#[test]
fn bands_the_headline_form_metric_on_todays_fitness() {
    assert_eq!(snapshot(&data(), true).metrics.form.zone, Some("greyZone"));
    assert_eq!(snapshot(&data(), false).metrics.form.zone, Some("optimal"));
}

#[test]
fn stores_no_zone_for_the_headline_when_today_has_no_fitness_under_the_percentage_setting() {
    let mut gap = data();
    set_fitness(&mut gap, vec![30, 60, 150, 0]);
    gap.summary.wellness = WidgetWellnessSummary {
        form: Some(-20.0),
        fitness: Some(0.0),
        ..Default::default()
    };

    let s = snapshot(&gap, true);
    assert_eq!(s.metrics.form.zone, None);
    assert_eq!(s.display.form_zone, "");
}

// The headline value and arrow are the engine's wellness summary: absolute form and its glyph.
fn form_of(
    form: [i32; 2],
    fitness: [i32; 2],
    form_as_percent: bool,
    form_trend: &str,
) -> MetricValue {
    let mut d = data();
    d.sparklines.as_mut().unwrap().form = form.to_vec();
    set_fitness(&mut d, fitness.to_vec());
    d.summary = WidgetSummaryCardData {
        wellness: WidgetWellnessSummary {
            form: Some(f64::from(form[1])),
            fitness: Some(f64::from(fitness[1])),
            form_trend: Some(form_trend.to_string()),
            form_previous: Some(f64::from(form[0])),
            fitness_previous: Some(f64::from(fitness[0])),
            ..Default::default()
        },
        ..Default::default()
    };
    snapshot(&d, form_as_percent).metrics.form
}

fn assert_close(actual: Option<f64>, expected: f64) {
    let actual = actual.expect("a change");
    assert!(
        (actual - expected).abs() < 0.005,
        "{actual} is not close to {expected}"
    );
}

#[test]
fn the_form_change_is_in_percentage_points_of_fitness_when_the_flag_is_on() {
    let m = form_of([-4, -8], [40, 40], true, "↓");
    assert_eq!(m.text.as_deref(), Some("-20%"));
    assert_close(m.delta_vs_yesterday, -10.0);
    assert_eq!(m.trend_dir, "down");
}

#[test]
fn the_form_change_is_zero_when_the_percentage_holds_while_the_absolute_value_moves() {
    let m = form_of([-4, -8], [40, 80], true, "↓");
    assert_eq!(m.text.as_deref(), Some("-10%"));
    assert_close(m.delta_vs_yesterday, 0.0);
    // The arrow is the card's, on absolute form, so it still shows the fall.
    assert_eq!(m.trend_dir, "down");
}

#[test]
fn the_form_change_is_omitted_when_either_day_has_no_fitness_to_divide_by() {
    assert_eq!(
        form_of([-4, -8], [40, 0], true, "↓").delta_vs_yesterday,
        None
    );
    assert_eq!(
        form_of([-4, -8], [0, 40], true, "↓").delta_vs_yesterday,
        None
    );
    assert_eq!(form_of([-4, -8], [40, 0], true, "→").trend_dir, "flat");
}

#[test]
fn the_form_change_stays_absolute_when_the_flag_is_off() {
    let m = form_of([-4, -8], [40, 40], false, "↓");
    assert_eq!(m.text.as_deref(), Some("-8"));
    assert_eq!(m.delta_vs_yesterday, Some(-4.0));
}
