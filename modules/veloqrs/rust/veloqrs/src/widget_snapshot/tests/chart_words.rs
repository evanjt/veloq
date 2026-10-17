//! Scenario: a widget draws its charts beside the hero and under the card. A
//! line on its own says neither which series it is nor how many days it spans.
//!
//! Expected behaviour: the snapshot carries the days each chart spans in the
//! athlete's words and plural form, under the same rule that decides whether
//! the chart is drawn, so both platforms caption it from one answer.

use std::collections::BTreeMap;

use super::super::*;
use super::fixtures::{demo, english};
use super::spoken::{clock, context, rising_fitness};
use crate::FfiWellnessSparklines;

#[test]
fn each_drawn_chart_carries_the_days_it_spans() {
    let snapshot = compose(&rising_fitness(), &context(english()), clock());
    let spans = &snapshot.display.chart_spans;
    assert_eq!(spans.fitness.as_deref(), Some("3 days"));
    assert_eq!(spans.hrv.as_deref(), Some("3 days"));
    assert_eq!(spans.form.as_deref(), Some("3 days"));
}

#[test]
fn a_chart_with_too_few_days_to_draw_carries_no_span() {
    let mut data = rising_fitness();
    data.sparklines = Some(FfiWellnessSparklines {
        fitness: vec![52],
        fatigue: vec![60],
        form: vec![-8],
        hrv: vec![],
        ..Default::default()
    });
    let spans = compose(&data, &context(english()), clock())
        .display
        .chart_spans;
    assert_eq!(spans.fitness, None);
    assert_eq!(spans.hrv, None);
    assert_eq!(spans.form, None);
}

#[test]
fn the_span_takes_the_plural_form_the_language_gives_the_count() {
    let strings: BTreeMap<String, String> = [
        ("time.daysCount_one", "{{count}} dzień"),
        ("time.daysCount_few", "{{count}} dni (few)"),
        ("time.daysCount_many", "{{count}} dni (many)"),
        ("time.daysCount_other", "{{count}} dnia"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let mut ctx = context(strings);
    ctx.locale = "pl".to_string();

    let mut data = rising_fitness();
    data.sparklines = Some(FfiWellnessSparklines {
        fitness: (0..22).collect(),
        fatigue: (0..22).collect(),
        form: (0..5).collect(),
        hrv: vec![],
        ..Default::default()
    });
    let spans = compose(&data, &ctx, clock()).display.chart_spans;
    assert_eq!(spans.fitness.as_deref(), Some("22 dni (few)"));
    assert_eq!(spans.form.as_deref(), Some("5 dni (many)"));
}

#[test]
fn a_context_stored_before_the_span_words_carries_no_span() {
    let mut strings = english();
    strings.retain(|key, _| !key.starts_with("time.daysCount"));
    let spans = compose(&rising_fitness(), &context(strings), clock())
        .display
        .chart_spans;
    assert_eq!(spans.fitness, None);
    assert_eq!(spans.form, None);
}

#[test]
fn the_sample_library_names_its_series_span_and_zone() {
    let snapshot = demo();
    let display = &snapshot["display"];
    assert_eq!(display["chartSpans"]["fitness"], "30 days");
    assert_eq!(display["chartSpans"]["hrv"], "30 days");
    assert_eq!(display["chartSpans"]["form"], "42 days");
    assert_eq!(display["metricLabels"]["fitness"], "Fitness");
    assert_eq!(display["metricLabels"]["fatigue"], "Fatigue");
    assert_eq!(display["formZone"], "Grey zone");
}
