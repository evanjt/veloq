//! Scenario: one day's form is judged in one place, whichever surface asks.
//!
//! Expected behaviour: the zone changes on each edge in either unit, the text
//! rounds halves up as the screens always printed them, and a day that cannot
//! be read in the athlete's unit has no reading at all.

use super::*;

#[test]
fn the_zone_changes_exactly_on_each_edge() {
    let cases = [
        (-30.01, "highRisk"),
        (-30.0, "optimal"),
        (-10.01, "optimal"),
        (-10.0, "greyZone"),
        (4.99, "greyZone"),
        (5.0, "fresh"),
        (24.99, "fresh"),
        (25.0, "transition"),
    ];
    for (value, zone) in cases {
        assert_eq!(zone_of(value), zone, "{value}");
    }
}

#[test]
fn the_text_is_signed_and_rounds_halves_up() {
    assert_eq!(text_of(2.5, false), "+3");
    assert_eq!(text_of(-2.5, false), "-2");
    assert_eq!(text_of(-0.4, false), "0");
    assert_eq!(text_of(0.0, false), "0");
    assert_eq!(text_of(-12.5, true), "-12%");
    assert_eq!(text_of(20.0, true), "+20%");
    assert_eq!(text_of(0.0, true), "0%");
}

#[test]
fn a_reading_zones_the_rounded_loads_in_the_athletes_unit() {
    // 50.4 and 39.6 round to 50 and 40: form 10, a fifth of fitness.
    let absolute = form_reading(Some(50.4), Some(39.6), false).unwrap();
    assert_eq!((absolute.value, absolute.zone), (10.0, "fresh"));
    assert_eq!(absolute.text, "+10");

    let percent = form_reading(Some(50.4), Some(39.6), true).unwrap();
    assert_eq!((percent.value, percent.zone), (20.0, "fresh"));
    assert_eq!(percent.text, "+20%");
}

#[test]
fn a_reading_is_judged_on_the_printed_form_not_the_raw_difference() {
    // The raw difference 4.2 is grey zone, but the printed form 60 - 55 = 5 is fresh.
    let reading = form_reading(Some(59.6), Some(55.4), false).unwrap();
    assert_eq!(reading.text, "+5");
    assert_eq!(reading.zone, "fresh");
}

#[test]
fn a_day_missing_a_load_has_no_reading_not_minus_fatigue() {
    assert_eq!(form_reading(None, Some(50.0), false), None);
    assert_eq!(form_reading(Some(50.0), None, false), None);
    assert_eq!(form_reading(Some(f64::NAN), Some(50.0), false), None);
}

#[test]
fn a_percentage_with_no_fitness_has_no_reading_while_absolute_has_one() {
    assert_eq!(form_reading(Some(0.4), Some(10.0), true), None);
    let absolute = form_reading(Some(0.4), Some(10.0), false).unwrap();
    assert_eq!((absolute.zone, absolute.text.as_str()), ("greyZone", "-10"));
}

#[test]
fn an_already_stated_form_follows_the_same_rules() {
    assert_eq!(form_zone(-20.0, Some(80.0), true), Some("optimal"));
    assert_eq!(form_text(-20.0, Some(80.0), true).as_deref(), Some("-25%"));
    assert_eq!(form_zone(-20.0, None, true), None);
    assert_eq!(form_text(-20.0, Some(0.0), true), None);
    assert_eq!(form_zone(-20.0, None, false), Some("optimal"));
    assert_eq!(form_text(-20.0, None, false).as_deref(), Some("-20"));
}

#[test]
fn the_edges_are_the_intervals_boundaries_lowest_first() {
    assert_eq!(FORM_ZONE_EDGES, [-30.0, -10.0, 5.0, 25.0]);
}
