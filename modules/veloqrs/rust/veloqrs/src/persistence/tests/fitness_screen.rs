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
/// The spans the fitness picker offers, in days.
const SPANS: [u32; 5] = [7, 30, 90, 180, 365];

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

    let read = fitness_screen_data(conn, TODAY, &SPANS);

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
    let fitness = fitness_screen_data(conn, TODAY, &SPANS).ftp_trend;
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

    let fitness = fitness_screen_data(conn, TODAY, &SPANS).ftp_trend;
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

    let read = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS);

    assert!(read.ftp_trend.history.is_empty());
    assert_eq!(read.ftp_trend.latest_ftp, None);
    assert!(read.ftp_trend.changes.is_empty());
    assert_eq!(read.run_pace_trend.latest_pace, None);
    assert_eq!(read.swim_pace_trend.latest_pace, None);
}

#[test]
fn the_fitness_screen_read_carries_the_fitness_and_fatigue_days_in_effect_today() {
    let engine = PersistentEngine::in_memory().unwrap();
    let defaults = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS);
    assert_eq!((defaults.fitness_days, defaults.fatigue_days), (42, 7));

    engine
        .set_setting(
            crate::persistence::settings_keys::FITNESS_MODEL_EVENTS,
            r#"[{"category":"FITNESS_DAYS","start_date_local":"2026-01-01T00:00:00","ctl_days":28,"atl_days":5},
                {"category":"FITNESS_DAYS","start_date_local":"2026-12-01T00:00:00","ctl_days":35,"atl_days":10}]"#,
        )
        .unwrap();

    let read = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS);
    assert_eq!((read.fitness_days, read.fatigue_days), (28, 5));
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

    let mix = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS).sport_mix;

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

    let mix = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS).sport_mix;

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

    let mix = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS).sport_mix;

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
    let empty = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS).sport_mix;
    assert_eq!((empty.rides, empty.runs, empty.swims), (0, 0, 0));
    assert_eq!(empty.dominant, None);

    insert_activities(&engine, "ride", "Ride", 6, RECENT);
    insert_activities(&engine, "run", "Run", 6, RECENT);
    let tied = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS).sport_mix;
    assert_eq!(tied.dominant, None, "a tie is no evidence for either sport");
}

fn ride_with_ftp(engine: &PersistentEngine, id: &str, date: i64, sport: &str, ftp: Option<i64>) {
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time,
              elevation_gain, sport_type, ftp) VALUES (?1, 'Spin', ?2, 0, 0, 0, 0, ?3, ?4)",
            rusqlite::params![id, date, sport, ftp],
        )
        .unwrap();
}

#[test]
fn the_read_carries_the_set_cycling_ftp_and_running_lthr() {
    let engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_sport_settings(
            r#"[{"types":["Ride"],"ftp":155},{"types":["Run"],"lthr":177},{"types":["Other"],"other":true}]"#,
        )
        .unwrap();
    ride_with_ftp(&engine, "a1", RECENT, "Ride", Some(260));

    let read = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS);

    assert_eq!(
        read.cycling_ftp_setting,
        Some(155.0),
        "the setting comes before the activity"
    );
    assert_eq!(read.running_lthr, Some(177.0));
}

#[test]
fn with_no_ride_ftp_set_the_newest_cycling_activity_supplies_it() {
    let no_ride_ftp =
        r#"[{"types":["Ride"],"lthr":160},{"types":["Other"],"other":true,"ftp":90,"lthr":150}]"#;
    let no_ride_entry =
        r#"[{"types":["Swim"],"ftp":80},{"types":["Other"],"other":true,"ftp":90,"lthr":150}]"#;
    for settings in [no_ride_ftp, no_ride_entry] {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.set_sport_settings(settings).unwrap();
        ride_with_ftp(&engine, "old", LONG_AGO, "Ride", Some(230));
        ride_with_ftp(&engine, "new", RECENT, "VirtualRide", Some(250));
        ride_with_ftp(&engine, "unset", RECENT + 1, "GravelRide", None);
        ride_with_ftp(&engine, "zero", RECENT + 2, "Ride", Some(0));
        ride_with_ftp(&engine, "run", RECENT + 3, "Run", Some(330));

        let read = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS);

        assert_eq!(read.cycling_ftp_setting, Some(250.0), "{settings}");
        assert_eq!(
            read.running_lthr, None,
            "the entry for unlisted sports holds no running threshold: {settings}"
        );
    }
}

#[test]
fn with_no_settings_and_no_activity_ftp_the_read_has_no_thresholds() {
    let engine = PersistentEngine::in_memory().unwrap();
    ride_with_ftp(&engine, "a1", RECENT, "Ride", None);

    let read = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS);

    assert_eq!(read.cycling_ftp_setting, None);
    assert_eq!(read.running_lthr, None);
}

/// One activity with its stored body, its date in wall-clock seconds.
struct Session<'a> {
    id: &'a str,
    sport: &'a str,
    date: i64,
    moving_time: i64,
    power: Option<i64>,
    hr: Option<i64>,
    load: Option<f64>,
    body: serde_json::Value,
}

fn store_session(engine: &PersistentEngine, s: &Session) {
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time,
              elevation_gain, sport_type, avg_power, avg_hr, training_load)
             VALUES (?1, ?2, ?3, 21000, ?4, ?4, 0, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                s.id,
                format!("{} session", s.id),
                s.date,
                s.moving_time,
                s.sport,
                s.power,
                s.hr,
                s.load
            ],
        )
        .unwrap();
    engine
        .db
        .execute(
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, ?2, ?3)",
            rusqlite::params![s.id, s.date, s.body.to_string()],
        )
        .unwrap();
}

fn ride(id: &str, date: i64, minutes: i64, decoupling: serde_json::Value) -> Session<'_> {
    Session {
        id,
        sport: "Ride",
        date,
        moving_time: minutes * 60,
        power: Some(210),
        hr: Some(140),
        load: Some(60.0),
        body: serde_json::json!({ "id": id, "decoupling": decoupling }),
    }
}

const SEP_04_0700: i64 = 1_788_505_200;
const SEP_01_0700: i64 = 1_788_246_000;
const AUG_20_0700: i64 = 1_787_209_200;

/// Scenario: the fitness tab's decoupling card names one ride and the value
/// intervals.icu stored for it. The newest ride is too short, the next stored
/// a non-number, so the card reaches back to the oldest.
///
/// Expected behaviour: each span answers the newest cycling activity of half an
/// hour or more with power, heart rate and a finite stored decoupling inside
/// it, and a span that holds none answers none.
#[test]
fn each_span_names_the_newest_ride_with_a_finite_stored_decoupling() {
    let engine = PersistentEngine::in_memory().unwrap();
    store_session(&engine, &ride("short", SEP_04_0700, 20, 3.0.into()));
    store_session(
        &engine,
        &ride("broken", SEP_01_0700, 50, "-Infinity".into()),
    );
    store_session(&engine, &ride("steady", AUG_20_0700, 40, 4.2.into()));
    store_session(
        &engine,
        &Session {
            sport: "Run",
            ..ride("run", SEP_04_0700 + 60, 60, 2.0.into())
        },
    );
    store_session(
        &engine,
        &Session {
            hr: None,
            ..ride("no-hr", SEP_04_0700 + 120, 60, 2.5.into())
        },
    );
    store_session(
        &engine,
        &Session {
            power: None,
            ..ride("no-power", SEP_04_0700 + 180, 60, 2.6.into())
        },
    );

    let read = fitness_screen_data(engine.cold_connection(), TODAY, &[7, 30]);

    assert_eq!(
        read.decoupling_sources
            .iter()
            .map(|s| s.days)
            .collect::<Vec<_>>(),
        vec![7, 30]
    );
    assert!(
        read.decoupling_sources[0].source.is_none(),
        "the week holds no ride that qualifies"
    );
    let source = read.decoupling_sources[1].source.as_ref().unwrap();
    assert_eq!(source.activity_id, "steady");
    assert_eq!(source.name, "steady session");
    assert_eq!(source.start_date_local, "2026-08-20T07:00:00");
    assert_eq!(source.decoupling, 4.2);
}

#[test]
fn a_ride_of_exactly_half_an_hour_qualifies_and_an_empty_library_names_none() {
    let engine = PersistentEngine::in_memory().unwrap();
    let empty = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS);
    assert_eq!(empty.decoupling_sources.len(), SPANS.len());
    assert!(empty.decoupling_sources.iter().all(|s| s.source.is_none()));
    assert!(empty.load_dots.is_empty());

    store_session(&engine, &ride("half-hour", SEP_04_0700, 30, (-1.5).into()));
    store_session(
        &engine,
        &ride("unstored", SEP_04_0700 + 60, 90, serde_json::Value::Null),
    );

    let read = fitness_screen_data(engine.cold_connection(), TODAY, &SPANS);
    for span in &read.decoupling_sources {
        let source = span.source.as_ref().unwrap();
        assert_eq!(
            (source.activity_id.as_str(), source.decoupling),
            ("half-hour", -1.5)
        );
    }
}

const SEP_05_2330: i64 = 1_788_651_000;
const SEP_05_2025_0000: i64 = 1_757_030_400;
const SEP_04_2025_2300: i64 = 1_757_026_800;

/// Scenario: the strip under the fitness plot marks each day's activities with
/// their sport and load, and the day picker lists each one's start, duration
/// and distance.
///
/// Expected behaviour: one dot per activity inside the longest span, oldest
/// first, from today's last minutes back to the span's first day and none
/// before it, an activity with no recorded load carrying zero.
#[test]
fn the_read_carries_one_load_dot_per_activity_in_the_longest_span() {
    let engine = PersistentEngine::in_memory().unwrap();
    store_session(&engine, &ride("late-today", SEP_05_2330, 45, 1.0.into()));
    store_session(
        &engine,
        &Session {
            sport: "Swim",
            load: None,
            ..ride("pool", SEP_01_0700, 35, 0.0.into())
        },
    );
    store_session(
        &engine,
        &ride("first-day", SEP_05_2025_0000, 60, 1.0.into()),
    );
    store_session(&engine, &ride("too-old", SEP_04_2025_2300, 60, 1.0.into()));

    let dots = fitness_screen_data(engine.cold_connection(), TODAY, &[30, 365]).load_dots;

    assert_eq!(
        dots.iter()
            .map(|d| d.activity_id.as_str())
            .collect::<Vec<_>>(),
        vec!["first-day", "pool", "late-today"]
    );
    let pool = &dots[1];
    assert_eq!(pool.name, "pool session");
    assert_eq!(pool.sport_type, "Swim");
    assert_eq!(pool.start_date_local, "2026-09-01T07:00:00");
    assert_eq!(pool.moving_time, 35 * 60);
    assert_eq!(pool.distance, 21000.0);
    assert_eq!(pool.load, 0.0);
    assert_eq!(dots[2].load, 60.0);
}
