//! Scenario: the summary card, the fitness charts and the widget all render the
//! wellness sparklines, and each has to know which end of the array is today.
//!
//! Expected behaviour: every array `get_wellness_sparklines` returns is
//! oldest-first, so the LAST element is the most recent day. The widget read
//! index 0 as today for a release, which showed month-old numbers with inverted
//! trend arrows. These tests pin the contract so that cannot regress silently.

use tempfile::TempDir;
use veloqrs::persistence::PersistentEngine;
use veloqrs::persistence::wellness::WellnessRow;

fn row(date: &str, ctl: f64, atl: f64) -> WellnessRow {
    WellnessRow {
        date: date.to_string(),
        ctl: Some(ctl),
        atl: Some(atl),
        ramp_rate: None,
        hrv: Some(ctl),
        resting_hr: Some(atl),
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

fn engine_with_five_days() -> (TempDir, PersistentEngine) {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("routes.db");
    let mut engine = PersistentEngine::new(db.to_str().unwrap()).expect("open");

    // Inserted newest-first on purpose: storage order must not decide read order.
    engine
        .upsert_wellness(&[
            row("2026-08-08", 32.0, 16.0),
            row("2026-08-07", 33.0, 19.0),
            row("2026-08-06", 34.0, 21.0),
            row("2026-08-05", 35.0, 25.0),
            row("2026-08-04", 36.0, 22.0),
        ])
        .expect("store");
    (tmp, engine)
}

#[test]
fn sparklines_end_with_the_most_recent_day() {
    let (_tmp, engine) = engine_with_five_days();
    let sp = engine
        .get_wellness_sparklines(30)
        .expect("read")
        .expect("some rows");

    assert_eq!(sp.fitness, vec![36, 35, 34, 33, 32]);
    assert_eq!(sp.fatigue, vec![22, 25, 21, 19, 16]);
    // form = ctl - atl, so today is 32 - 16.
    assert_eq!(sp.form, vec![14, 10, 13, 14, 16]);

    let last = sp.fitness.len() - 1;
    assert_eq!(sp.fitness[last], 32, "today's CTL is the LAST element");
    assert_eq!(sp.fitness[0], 36, "index 0 is the OLDEST day, not today");
}

#[test]
fn every_series_shares_one_ordering() {
    let (_tmp, engine) = engine_with_five_days();
    let sp = engine
        .get_wellness_sparklines(30)
        .expect("read")
        .expect("some rows");

    // A consumer picks one index convention for all five series, so a single
    // series disagreeing would silently mix days within one rendered card.
    let last = sp.fitness.len() - 1;
    assert_eq!(sp.fatigue.len(), sp.fitness.len());
    assert_eq!(sp.form.len(), sp.fitness.len());
    assert_eq!(sp.hrv.len(), sp.fitness.len());
    assert_eq!(sp.rhr.len(), sp.fitness.len());
    assert_eq!(sp.hrv[last], 32, "hrv mirrors ctl in the fixture");
    assert_eq!(sp.rhr[last], 16, "rhr mirrors atl in the fixture");
}

#[test]
fn the_window_takes_the_newest_days_when_it_is_shorter_than_the_history() {
    let (_tmp, engine) = engine_with_five_days();
    let sp = engine
        .get_wellness_sparklines(2)
        .expect("read")
        .expect("some rows");

    // Two days requested: the two most recent, still oldest-first.
    assert_eq!(sp.fitness, vec![33, 32]);
}
