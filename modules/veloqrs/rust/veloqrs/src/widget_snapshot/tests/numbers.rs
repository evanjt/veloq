//! Numbers the widget prints, written with the separators the app's locale
//! hands over, so a widget reads "72,5kg" where the app does.

use super::super::*;

fn context(decimal: &str, group: &str, minimum_grouping_digits: u32) -> WidgetContext {
    WidgetContext {
        locale: "de-DE".to_string(),
        is_metric: true,
        numbers: NumberWords {
            decimal: decimal.to_string(),
            group: group.to_string(),
            minimum_grouping_digits,
        },
        ..Default::default()
    }
}

#[test]
fn a_weight_takes_the_locale_decimal() {
    assert_eq!(weight_text(72.5, &context(",", ".", 1)), "72,5kg");
    assert_eq!(weight_text(72.0, &context(",", ".", 1)), "72kg");
}

#[test]
fn a_distance_takes_the_locale_decimal_and_grouping() {
    let ctx = context(",", ".", 1);
    assert_eq!(format_distance(12_500.0, &ctx), "12,5 km");
    assert_eq!(format_distance(1_234_500.0, &ctx), "1.234,5 km");
    assert_eq!(format_distance(500.0, &ctx), "500 m");
}

#[test]
fn grouping_waits_for_the_locale_minimum() {
    let ctx = context(",", "\u{a0}", 2);
    assert_eq!(number_text("1234", &ctx), "1234");
    assert_eq!(number_text("12345.5", &ctx), "12\u{a0}345,5");
    assert_eq!(number_text("-12345", &ctx), "-12\u{a0}345");
}

#[test]
fn a_context_stored_before_the_separators_writes_a_point_and_no_grouping() {
    let ctx = WidgetContext {
        is_metric: true,
        ..Default::default()
    };
    assert_eq!(weight_text(72.5, &ctx), "72.5kg");
    assert_eq!(format_distance(1_234_500.0, &ctx), "1234.5 km");
}
