//! Scenario: the fitness tab plots the eFTP over three months with the rides
//! that moved it, and falls back on the last stored critical speed for running
//! and swimming. It asked for the trend once per card and borrowed the summary
//! card's bundle, week totals and all, once per sport for the speeds.
//!
//! Expected behaviour: one read answers all three, with the FTP comparison
//! shared with the summary card and three months of chart history.

use super::pooled::{FITNESS_FTP_LOOKBACK_DAYS, SPORT_MIX_ACTIVITIES, fitness_screen_data};
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

/// Scenario: the chart draws three months of eFTP while the step it captions
/// is measured across the shared month, so a caption that names a window of
/// its own misstates the change.
///
/// Expected behaviour: the read carries the window the step was measured over,
/// the same one the summary card compares across.
#[test]
fn test_fitness_screen_ftp_trend_names_the_window_its_step_spans() {
    let mut engine = PersistentEngine::in_memory().unwrap();
    engine
        .upsert_wellness(&[
            eftp_day("2026-06-07", 240.0),
            eftp_day("2026-08-06", 270.0),
            eftp_day(TODAY, 275.0),
        ])
        .unwrap();
    let conn = engine.cold_connection();

    let fitness = fitness_screen_data(conn, TODAY).ftp_trend;
    assert_eq!(
        fitness.lookback_days,
        ftp_trend_to(conn, TODAY).lookback_days
    );
    assert_eq!(fitness.lookback_days, 30);
    assert_eq!(fitness.delta_watts, Some(5));
    assert_eq!(fitness.history.len(), 3);
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

fn insert_activities(
    engine: &PersistentEngine,
    prefix: &str,
    sport: &str,
    count: usize,
    date: i64,
) {
    for i in 0..count {
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time,
                  elevation_gain, sport_type) VALUES (?1, 'Session', ?2, 0, 0, 0, 0, ?3)",
                rusqlite::params![format!("{prefix}{i}"), date, sport],
            )
            .unwrap();
    }
}

const RECENT: i64 = 1_785_542_400;
const LONG_AGO: i64 = 1_704_067_200;

#[test]
fn a_library_of_runs_reports_running_as_its_dominant_sport() {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_activities(&engine, "run", "Run", 150, RECENT);
    insert_activities(&engine, "trail", "TrailRun", 50, RECENT);
    insert_activities(&engine, "old-ride", "Ride", 400, LONG_AGO);

    let mix = fitness_screen_data(engine.cold_connection(), TODAY).sport_mix;

    assert_eq!(
        mix.runs, SPORT_MIX_ACTIVITIES,
        "the latest activities are runs and trail runs"
    );
    assert_eq!(
        mix.rides, 0,
        "rides older than the latest activities do not count"
    );
    assert_eq!(mix.swims, 0);
    assert_eq!(mix.dominant.as_deref(), Some("Running"));
}

#[test]
fn the_dominant_sport_names_each_family_and_counts_its_members() {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_activities(&engine, "pool", "Swim", 3, RECENT);
    insert_activities(&engine, "lake", "OpenWaterSwim", 2, RECENT);
    insert_activities(&engine, "zwift", "VirtualRide", 4, RECENT);
    insert_activities(&engine, "lift", "WeightTraining", 9, RECENT);

    let mix = fitness_screen_data(engine.cold_connection(), TODAY).sport_mix;

    assert_eq!((mix.rides, mix.runs, mix.swims), (4, 0, 5));
    assert_eq!(
        mix.dominant.as_deref(),
        Some("Swimming"),
        "a sport outside the three is not counted"
    );
}

#[test]
fn the_mix_counts_the_latest_activities_and_none_older() {
    let engine = PersistentEngine::in_memory().unwrap();
    insert_activities(&engine, "old-ride", "Ride", 400, LONG_AGO);
    insert_activities(&engine, "swim", "Swim", 10, RECENT);

    let mix = fitness_screen_data(engine.cold_connection(), TODAY).sport_mix;

    assert_eq!((mix.rides, mix.swims), (40, 10));
    assert_eq!(
        mix.dominant.as_deref(),
        Some("Cycling"),
        "fifty activities, forty of them rides"
    );
}

#[test]
fn a_tie_or_an_empty_library_names_no_dominant_sport() {
    let engine = PersistentEngine::in_memory().unwrap();
    let empty = fitness_screen_data(engine.cold_connection(), TODAY).sport_mix;
    assert_eq!((empty.rides, empty.runs, empty.swims), (0, 0, 0));
    assert_eq!(empty.dominant, None);

    insert_activities(&engine, "ride", "Ride", 6, RECENT);
    insert_activities(&engine, "run", "Run", 6, RECENT);
    let tied = fitness_screen_data(engine.cold_connection(), TODAY).sport_mix;
    assert_eq!(tied.dominant, None, "a tie is no evidence for either sport");
}
