//! Scenario: the fitness tab plots the eFTP over three months with the rides
//! that moved it, and falls back on the last stored critical speed for running
//! and swimming. It asked for the trend once per card and borrowed the summary
//! card's bundle, week totals and all, once per sport for the speeds.
//!
//! Expected behaviour: one read answers all three, each the same answer its
//! part gives over the same rows, with the trend compared across the three
//! months the chart draws rather than the summary card's one.

use super::pooled::{FITNESS_FTP_LOOKBACK_DAYS, fitness_screen_data};
use crate::persistence::PersistentEngine;
use crate::persistence::fitness::derivations::pooled::{
    SYNC_PACE_WINDOW_DAYS, ftp_trend_over, ftp_trend_to, pace_trend,
};
use crate::persistence::wellness::WellnessRow;

const TODAY: &str = "2026-09-05";

fn eftp_day(date: &str, eftp: f64) -> WellnessRow {
    WellnessRow {
        date: date.into(),
        ctl: None,
        atl: None,
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
        raw: Some(
            serde_json::json!({ "id": date, "sportInfo": [{ "type": "Ride", "eftp": eftp }] })
                .to_string(),
        ),
    }
}

fn library() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .upsert_wellness(&[
            // The step is measured from the newest day at or before the
            // window's start, so the chart's three months reach back to the
            // first and the summary card's month only to the second.
            eftp_day("2026-06-01", 240.0),
            eftp_day("2026-07-20", 252.0),
            eftp_day(TODAY, 260.0),
        ])
        .unwrap();
    engine
        .set_eftp_change("r1", 1_781_000_000, 252.0, 12.0, "Hill repeats")
        .unwrap();
    engine.save_pace_snapshot("Run", 3.6, None, None, 1_780_000_000, SYNC_PACE_WINDOW_DAYS);
    engine.save_pace_snapshot("Run", 3.8, None, None, 1_782_000_000, SYNC_PACE_WINDOW_DAYS);
    engine.save_pace_snapshot(
        "Swim",
        1.2,
        None,
        None,
        1_782_000_000,
        SYNC_PACE_WINDOW_DAYS,
    );
    engine
}

#[test]
fn the_read_answers_the_trend_over_the_chart_window_and_both_stored_speeds() {
    let engine = library();
    let conn = engine.cold_connection();

    let read = fitness_screen_data(conn, TODAY);

    assert_eq!(read.ftp_trend.latest_ftp, Some(260));
    assert_eq!(
        read.ftp_trend.previous_ftp,
        Some(240),
        "compared across the chart's three months"
    );
    assert_eq!(
        read.ftp_trend
            .changes
            .iter()
            .map(|c| c.activity_id.as_str())
            .collect::<Vec<_>>(),
        vec!["r1"]
    );
    assert_eq!(read.run_pace_trend.latest_pace, Some(3.8));
    assert_eq!(read.swim_pace_trend.latest_pace, Some(1.2));

    assert_eq!(
        format!("{:?}", read.ftp_trend),
        format!(
            "{:?}",
            ftp_trend_over(conn, TODAY, FITNESS_FTP_LOOKBACK_DAYS)
        )
    );
    assert_eq!(
        format!("{:?}", read.run_pace_trend),
        format!("{:?}", pace_trend(conn, "Run"))
    );
    assert_eq!(
        format!("{:?}", read.swim_pace_trend),
        format!("{:?}", pace_trend(conn, "Swim"))
    );
}

#[test]
fn the_chart_window_is_not_the_summary_cards_month() {
    let engine = library();
    let conn = engine.cold_connection();

    assert_eq!(FITNESS_FTP_LOOKBACK_DAYS, 90);
    assert_ne!(
        fitness_screen_data(conn, TODAY).ftp_trend.previous_ftp,
        ftp_trend_to(conn, TODAY).previous_ftp
    );
}

#[test]
fn an_empty_library_answers_no_trend_and_no_speed() {
    let engine = PersistentEngine::in_memory().unwrap();

    let read = fitness_screen_data(engine.cold_connection(), TODAY);

    assert!(read.ftp_trend.history.is_empty());
    assert_eq!(read.ftp_trend.latest_ftp, None);
    assert!(read.ftp_trend.changes.is_empty());
    assert_eq!(read.run_pace_trend.latest_pace, None);
    assert_eq!(read.swim_pace_trend.latest_pace, None);
}
