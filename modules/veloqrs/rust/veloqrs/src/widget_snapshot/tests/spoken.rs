//! Scenario: a screen reader reaches a widget. The arrow beside a metric is
//! coloured by its verdict, the charts, the route and the body are drawn, and
//! an insight's tone is a coloured dot, so none of them says anything aloud.
//!
//! Expected behaviour: the snapshot carries the words for each of them, in the
//! athlete's language, so a native reads them out and words nothing itself.

use super::super::*;
use super::fixtures::{demo, english};
use crate::{
    FfiWellnessSparklines, FfiWidgetSnapshotData, WidgetSummaryCardData, WidgetWellnessSummary,
};

pub(super) fn rising_fitness() -> FfiWidgetSnapshotData {
    FfiWidgetSnapshotData {
        sparklines: Some(FfiWellnessSparklines {
            fitness: vec![40, 45, 52],
            fatigue: vec![50, 55, 60],
            form: vec![-10, -10, -8],
            hrv: vec![55, 57, 60],
            rhr: vec![50, 49, 48],
            ..Default::default()
        }),
        summary: WidgetSummaryCardData {
            wellness: WidgetWellnessSummary {
                fitness: Some(52.0),
                fitness_trend: Some("↑".to_string()),
                fitness_previous: Some(45.0),
                fatigue: Some(60.0),
                fatigue_previous: Some(55.0),
                form: Some(-8.0),
                form_trend: Some("↑".to_string()),
                form_previous: Some(-10.0),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }
}

pub(super) fn context(strings: std::collections::BTreeMap<String, String>) -> WidgetContext {
    WidgetContext {
        locale: "en-GB".to_string(),
        is_metric: true,
        strings,
        summary_card: Some(SummaryPrefs {
            enabled: true,
            hero_metric: "fitness".to_string(),
            show_sparkline: true,
            supporting_metrics: vec!["form".to_string(), "hrv".to_string()],
        }),
        ..Default::default()
    }
}

pub(super) fn clock() -> Clock {
    Clock {
        now_seconds: 1_800_000_000,
        now_wall_seconds: 1_800_000_000,
    }
}

fn spoken(value: &serde_json::Value) -> &str {
    value
        .as_str()
        .unwrap_or_else(|| panic!("no words: {value}"))
}

#[test]
fn a_rising_fitness_says_its_verdict_in_words() {
    let snapshot = compose(&rising_fitness(), &context(english()), clock());
    assert_eq!(snapshot.metrics.fitness.spoken, "Fitness 52, improved");
    let card = snapshot.summary_card.expect("a card");
    assert_eq!(card.hero.spoken, "Fitness 52, improved");
    let fitness = snapshot
        .summary_metrics
        .iter()
        .find(|entry| entry.id == "fitness")
        .expect("fitness among the metrics");
    assert_eq!(fitness.spoken, "Fitness 52, improved");
}

#[test]
fn a_move_with_no_polarity_says_which_way_and_a_flat_one_says_steady() {
    let snapshot = compose(&rising_fitness(), &context(english()), clock());
    assert_eq!(snapshot.metrics.form.spoken, "Form -8, rising");
    let mut flat = rising_fitness();
    flat.summary.wellness.fitness_trend = Some("→".to_string());
    let snapshot = compose(&flat, &context(english()), clock());
    assert_eq!(snapshot.metrics.fitness.spoken, "Fitness 52, steady");
}

#[test]
fn a_metric_with_no_reading_says_so_rather_than_a_dash() {
    let snapshot = compose(&rising_fitness(), &context(english()), clock());
    assert_eq!(snapshot.metrics.hrv.spoken, "HRV, no reading");
    let card = snapshot.summary_card.expect("a card");
    let hrv = card
        .entries
        .iter()
        .find(|entry| entry.id == "hrv")
        .expect("hrv on the card");
    assert_eq!(hrv.spoken, "HRV, no reading");
}

#[test]
fn each_chart_carries_a_one_line_summary() {
    let snapshot = compose(&rising_fitness(), &context(english()), clock());
    let charts = &snapshot.display.chart_labels;
    assert_eq!(
        charts.fitness.as_deref(),
        Some("Fitness 40 to 52 and Fatigue 50 to 60 over 3 days")
    );
    assert_eq!(charts.hrv.as_deref(), Some("HRV 55 to 60 over 3 days"));
    assert_eq!(
        charts.form.as_deref(),
        Some("Form -10 to -8 over 3 days, now Grey zone")
    );
}

#[test]
fn a_chart_with_too_few_days_to_draw_carries_no_summary() {
    let mut data = rising_fitness();
    data.sparklines = Some(FfiWellnessSparklines {
        fitness: vec![52],
        fatigue: vec![60],
        form: vec![-8],
        hrv: vec![],
        ..Default::default()
    });
    let charts = compose(&data, &context(english()), clock())
        .display
        .chart_labels;
    assert_eq!(charts.fitness, None);
    assert_eq!(charts.hrv, None);
    assert_eq!(charts.form, None);
}

#[test]
fn a_context_stored_before_the_words_still_speaks_the_label_and_value() {
    let mut strings = english();
    strings.retain(|key, _| !key.starts_with("systemSurfaces.spoken."));
    let snapshot = compose(&rising_fitness(), &context(strings), clock());
    assert_eq!(snapshot.metrics.fitness.spoken, "Fitness 52");
    assert_eq!(snapshot.display.chart_labels.fitness, None);
}

#[test]
fn the_route_record_body_and_insight_tones_are_worded() {
    let snapshot = demo();
    let latest = &snapshot["latest"];
    assert_eq!(spoken(&latest["routeLabel"]), "Route map of Harbour Loop");
    assert!(!spoken(&latest["prLabel"]).is_empty());

    let body = spoken(&snapshot["strength"]["windows"]["last30"]["bodyLabel"]);
    assert!(
        body.contains("Glutes 7 sets, Triceps 7 sets"),
        "the most trained muscles, most first: {body}"
    );

    let insights = snapshot["insights"].as_array().expect("insights");
    assert!(!insights.is_empty());
    for insight in insights {
        let tone = spoken(&insight["toneLabel"]);
        assert!(
            !tone.is_empty() && !tone.contains("systemSurfaces"),
            "{insight}"
        );
    }
    assert_eq!(spoken(&insights[1]["toneLabel"]), "Record");
}

#[test]
fn a_window_with_no_strength_work_has_no_body_to_describe() {
    let snapshot = compose(&rising_fitness(), &context(english()), clock());
    assert_eq!(snapshot.strength.windows.last30.body_label, None);
    assert!(snapshot.strength.windows.last30.empty_text.is_some());
}
