//! Scenario: the fitness tab plots the eFTP over three months with the rides
//! that moved it, and falls back on the last stored critical speed for running
//! and swimming. It asked for the trend once per card and borrowed the summary
//! card's bundle, week totals and all, once per sport for the speeds.
//!
//! Expected behaviour: one read answers all three, with the FTP comparison
//! shared with the summary card and three months of chart history.

use super::pooled::{FITNESS_FTP_LOOKBACK_DAYS, fitness_screen_data};
use crate::persistence::PersistentEngine;
use crate::persistence::fitness::derivations::pooled::{
    SYNC_PACE_WINDOW_DAYS, ftp_trend_to, pace_trend,
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
            eftp_day("2026-06-01", 240.0),
            eftp_day("2026-07-20", 252.0),
            eftp_day(TODAY, 260.0),
        ])
        .unwrap();
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time,
              elevation_gain, sport_type) VALUES ('r1', 'Hill repeats', 1781000000, 0, 0, 0, 0, 'Ride')",
            [],
        )
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
fn test_fitness_screen_read_uses_shared_ftp_comparison_and_stored_speeds() {
    let engine = library();
    let conn = engine.cold_connection();

    let read = fitness_screen_data(conn, TODAY);

    assert_eq!(read.ftp_trend.latest_ftp, Some(260));
    assert_eq!(
        read.ftp_trend.previous_ftp,
        Some(252),
        "compared across the shared month"
    );
    assert_eq!(read.ftp_trend.delta_watts, Some(8));
    assert_eq!(read.ftp_trend.history.len(), 3);
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
        read.ftp_trend.previous_ftp,
        ftp_trend_to(conn, TODAY).previous_ftp
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
fn test_fitness_screen_ftp_direction_matches_summary_with_older_gain() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .upsert_wellness(&[
            eftp_day("2026-06-07", 240.0),
            eftp_day("2026-07-27", 252.0),
            eftp_day("2026-08-06", 255.0),
            eftp_day(TODAY, 252.0),
        ])
        .unwrap();
    let conn = engine.cold_connection();

    assert_eq!(FITNESS_FTP_LOOKBACK_DAYS, 90);
    let fitness = fitness_screen_data(conn, TODAY).ftp_trend;
    let summary = ftp_trend_to(conn, TODAY);
    assert_eq!(fitness.delta_watts, summary.delta_watts);
    assert_eq!(fitness.delta_watts, Some(-3));
    assert_eq!(fitness.history.len(), 4);
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
