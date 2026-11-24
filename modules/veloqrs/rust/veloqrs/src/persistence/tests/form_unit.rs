//! Scenario: an athlete reads form either as absolute TSB or as a share of
//! fitness, and a page that draws form, its zone bands and today's reading
//! takes the number and the unit from the read rather than working them out.
//!
//! Expected behaviour: every form the engine sends is in the athlete's unit,
//! a day that cannot be read in that unit carries none, and the zone edges
//! come with it.

use crate::form::{FORM_ZONE_EDGES, form_in_unit};
use crate::persistence::PersistentEngine;
use crate::persistence::wellness::{WellnessRow, pooled};

fn day(date: &str, ctl: Option<f64>, atl: Option<f64>) -> WellnessRow {
    WellnessRow {
        date: date.into(),
        ctl,
        atl,
        ramp_rate: None,
        hrv: None,
        resting_hr: None,
        weight: None,
        sleep_secs: None,
        sleep_score: None,
        soreness: None,
        fatigue: None,
        stress: None,
        mood: None,
        motivation: None,
        raw: None,
    }
}

fn engine_with(profile: Option<&str>) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .upsert_wellness(&[
            day("2026-03-01", Some(50.4), Some(39.6)),
            day("2026-03-02", Some(0.0), Some(10.0)),
            day("2026-03-03", None, Some(10.0)),
            day("2026-03-04", Some(80.0), None),
        ])
        .unwrap();
    if let Some(profile) = profile {
        engine.set_athlete_profile(profile).unwrap();
    }
    engine
}

#[test]
fn absolute_form_is_rounded_fitness_less_rounded_fatigue() {
    assert_eq!(form_in_unit(Some(50.4), Some(39.6), false), Some(10.0));
    assert_eq!(form_in_unit(Some(30.0), Some(55.0), false), Some(-25.0));
}

#[test]
fn percent_form_is_the_difference_over_rounded_fitness() {
    assert_eq!(form_in_unit(Some(50.4), Some(39.6), true), Some(20.0));
    assert_eq!(form_in_unit(Some(80.0), Some(100.0), true), Some(-25.0));
}

#[test]
fn a_day_missing_a_load_or_with_no_fitness_has_no_form_in_percent() {
    assert_eq!(form_in_unit(None, Some(10.0), false), None);
    assert_eq!(form_in_unit(Some(80.0), None, false), None);
    assert_eq!(form_in_unit(Some(0.0), Some(10.0), true), None);
    assert_eq!(form_in_unit(Some(0.4), Some(10.0), true), None);
    assert_eq!(form_in_unit(Some(0.0), Some(10.0), false), Some(-10.0));
}

#[test]
fn the_zone_edges_are_the_intervals_boundaries_lowest_first() {
    assert_eq!(FORM_ZONE_EDGES, [-30.0, -10.0, 5.0, 25.0]);
}

#[test]
fn the_wellness_read_carries_form_per_day_in_the_athletes_percent_unit() {
    let engine = engine_with(Some(r#"{"id":"i1","icu_form_as_percent":true}"#));

    let read = pooled::days_with_coverage(&engine.db, "2026-03-01", "2026-03-04").unwrap();

    assert!(read.form_as_percent);
    assert_eq!(read.form, vec![Some(20.0), None, None, None]);
    assert_eq!(read.form_zone_edges, FORM_ZONE_EDGES.to_vec());
    assert_eq!(read.form.len(), read.days.len());
}

#[test]
fn the_wellness_read_carries_each_days_zone_and_text_beside_its_form() {
    let percent = engine_with(Some(r#"{"id":"i1","icu_form_as_percent":true}"#));
    let read = pooled::days_with_coverage(&percent.db, "2026-03-01", "2026-03-04").unwrap();
    assert_eq!(
        read.form_zone,
        vec![Some("fresh".to_string()), None, None, None]
    );
    assert_eq!(
        read.form_text,
        vec![Some("+20%".to_string()), None, None, None]
    );
    // The absolute reading stays on offer for a row that prints TSB beside the percentage.
    assert_eq!(
        read.tsb_text,
        vec![Some("+10".to_string()), Some("-10".to_string()), None, None]
    );

    let absolute = engine_with(None);
    let read = pooled::days_with_coverage(&absolute.db, "2026-03-01", "2026-03-04").unwrap();
    assert_eq!(
        read.form_zone,
        vec![
            Some("fresh".to_string()),
            Some("greyZone".to_string()),
            None,
            None
        ]
    );
    assert_eq!(
        read.form_text,
        vec![Some("+10".to_string()), Some("-10".to_string()), None, None]
    );
}

#[test]
fn the_summary_zones_and_prints_its_form_on_the_athletes_denominator() {
    // Fitness 80, fatigue 100: form -20, a quarter of fitness below it.
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .upsert_wellness(&[
            day("2026-03-01", Some(60.0), Some(70.0)),
            day("2026-03-02", Some(80.4), Some(100.2)),
        ])
        .unwrap();

    let absolute = pooled::summary(&engine.db);
    assert_eq!(absolute.form_zone.as_deref(), Some("optimal"));
    assert_eq!(absolute.form_text.as_deref(), Some("-20"));
    assert_eq!(absolute.form_previous_text.as_deref(), Some("-10"));

    engine
        .set_athlete_profile(r#"{"id":"i1","icu_form_as_percent":true}"#)
        .unwrap();
    let percent = pooled::summary(&engine.db);
    assert_eq!(percent.form_zone.as_deref(), Some("optimal"));
    assert_eq!(percent.form_text.as_deref(), Some("-25%"));
    assert_eq!(percent.form_previous_text.as_deref(), Some("-17%"));
}

#[test]
fn the_sparklines_zone_and_print_each_day_against_its_own_fitness() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .upsert_wellness(&[
            day("2026-03-01", Some(30.0), Some(50.0)),
            day("2026-03-02", Some(150.0), Some(170.0)),
        ])
        .unwrap();
    engine
        .set_athlete_profile(r#"{"id":"i1","icu_form_as_percent":true}"#)
        .unwrap();

    let sp = pooled::sparklines_to(&engine.db, 7, "2026-03-02")
        .unwrap()
        .unwrap();

    // Both days print -20 absolute, but 30 is two thirds below fitness and 150 an eighth.
    assert_eq!(sp.form, vec![-20, -20]);
    assert_eq!(
        sp.form_zone,
        vec![Some("highRisk".to_string()), Some("optimal".to_string())]
    );
    assert_eq!(
        sp.form_text,
        vec![Some("-67%".to_string()), Some("-13%".to_string())]
    );
}

#[test]
fn the_wellness_read_carries_absolute_form_when_the_athlete_reads_it_so() {
    for profile in [Some(r#"{"id":"i1","icu_form_as_percent":false}"#), None] {
        let engine = engine_with(profile);

        let read = pooled::days_with_coverage(&engine.db, "2026-03-01", "2026-03-04").unwrap();

        assert!(!read.form_as_percent);
        assert_eq!(read.form, vec![Some(10.0), Some(-10.0), None, None]);
    }
}

#[test]
fn todays_insight_form_is_in_the_athletes_unit() {
    let engine = engine_with(Some(r#"{"id":"i1","icu_form_as_percent":true}"#));
    engine
        .db
        .execute("DELETE FROM wellness WHERE date > '2026-03-01'", [])
        .unwrap();

    let form = pooled::latest_form(&engine.db, "2026-03-01", "2026-03-31").unwrap();

    assert!(form.form_as_percent);
    assert_eq!(form.form, Some(20.0));
    assert_eq!(form.form_zone.as_deref(), Some("fresh"));
    assert_eq!(form.form_text.as_deref(), Some("+20%"));
    assert_eq!(form.ctl, 50.4);
    assert_eq!(form.atl, 39.6);
}
