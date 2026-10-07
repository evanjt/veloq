//! The stats, fitness and wellness reads, taken while a writer holds the
//! engine. Each is committed rows and nothing the engine keeps in memory, so a
//! sync page mid-transaction must not hold the screen that asked.

use super::FitnessManager;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

#[test]
fn test_get_weekly_summaries_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("weekly_under_a_writer.db");
    let weeks = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_weekly_summaries(vec![0.0, 604_800.0], 604_800.0)
            .expect("weekly summaries")
    });
    assert_eq!(weeks.len(), 2);
}

#[test]
fn test_get_period_stats_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("period_under_a_writer.db");
    let stats = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_period_stats(0.0, 100.0)
            .expect("period")
    });
    assert_eq!(stats.count, 0);
}

/// Every window of the training screen read, over the whole of 2026.
fn training_windows() -> crate::FfiTrainingScreenWindows {
    let year = crate::FfiTimestampRange {
        start_ts: 1_767_225_600.0,
        end_ts: 1_798_761_599.0,
    };
    crate::FfiTrainingScreenWindows {
        heatmap_first_day: "2026-01-01".into(),
        heatmap_last_day: "2026-12-31".into(),
        months: year.clone(),
        year_current: year.clone(),
        year_previous: year.clone(),
        month_current: year.clone(),
        month_previous: year,
    }
}

#[test]
fn test_get_training_screen_data_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("training_screen_under_a_writer.db");
    let data = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_training_screen_data(training_windows())
            .expect("training screen")
    });
    assert!(data.heatmap.is_empty());
    assert!(data.months.is_empty());
    assert_eq!(data.year_current.count, 0);
}

#[test]
fn test_get_wellness_sparklines_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("sparklines_under_a_writer.db");
    let lines = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_wellness_sparklines(30)
            .expect("sparklines")
    });
    assert!(lines.is_none());
}

#[test]
fn test_get_available_sport_types_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("sports_under_a_writer.db");
    let sports = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_available_sport_types()
            .expect("sports")
    });
    assert!(sports.is_empty());
}

#[test]
fn test_get_zone_distribution_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("zones_under_a_writer.db");
    let zones = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_zone_distribution("Ride".into(), "power".into(), 0.0, i64::MAX as f64)
            .expect("zones")
            .seconds
    });
    assert_eq!(zones, vec![0.0; 7]);
}

#[test]
fn test_get_fitness_screen_data_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("fitness_screen_under_a_writer.db");
    let data = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_fitness_screen_data()
            .expect("fitness screen")
    });
    assert!(data.ftp_trend.changes.is_empty());
    assert_eq!(data.run_pace_trend.latest_pace, None);
}

#[test]
fn test_get_wellness_days_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("wellness_days_under_a_writer.db");
    let days = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_wellness_days("2026-01-01".into(), "2026-12-31".into())
            .expect("wellness days")
    });
    assert!(days.is_empty());
}

#[test]
fn test_get_power_curve_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("power_curve_under_a_writer.db");
    let curve = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_power_curve("Ride".into(), 42.0)
            .expect("power curve")
    });
    assert!(curve.is_none());
}

#[test]
fn test_get_pace_curve_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("pace_curve_under_a_writer.db");
    let curve = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_pace_curve("Run".into(), 42.0, false)
            .expect("pace curve")
    });
    assert!(curve.is_none());
}

#[test]
fn test_get_calendar_event_bodies_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("calendar_under_a_writer.db");
    let bodies = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_calendar_event_bodies(0.0, 100.0)
            .expect("calendar")
    });
    assert!(bodies.is_empty());
}

fn metrics(
    id: &str,
    date: i64,
    sport: &str,
    power: Option<Vec<u32>>,
    hr: Option<Vec<u32>>,
) -> crate::types::ActivityMetrics {
    crate::types::ActivityMetrics {
        activity_id: id.into(),
        name: format!("{id} name"),
        date,
        distance: 10_000.0,
        moving_time: 1_800,
        elapsed_time: 1_900,
        elevation_gain: 100.0,
        avg_hr: Some(140),
        avg_power: Some(200),
        sport_type: sport.into(),
        training_load: Some(50.0),
        ftp: None,
        power_zone_times: power,
        hr_zone_times: hr,
    }
}

fn wellness_row(date: String, hrv: f64, raw: Option<&str>) -> crate::FfiWellnessRow {
    crate::FfiWellnessRow {
        date,
        ctl: Some(50.0),
        atl: Some(60.0),
        ramp_rate: Some(1.5),
        hrv: Some(hrv),
        resting_hr: Some(48.0),
        weight: None,
        sleep_secs: None,
        sleep_score: None,
        soreness: None,
        fatigue: None,
        stress: None,
        mood: None,
        motivation: None,
        raw: raw.map(str::to_string),
    }
}

/// Scenario: a library with activities, wellness, curves, calendar events,
/// eFTP markers and the heatmap days its activities derive, read through the
/// pool and through the engine.
///
/// Expected behaviour: every moved export answers what the engine answers for
/// the same rows, and what the rows say.
#[test]
fn test_fitness_reads_pooled_match_locked() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("fitness_pooled_parity.db");
    let fitness = FitnessManager::new();
    // 2026-01-15 and 2026-02-10, UTC midnight, as the sync stores a day.
    let jan = 1_768_435_200i64;
    let feb = 1_770_681_600i64;
    crate::with_persistent_engine(|engine| {
        engine
            .set_activity_metrics(vec![
                metrics("r1", jan, "Ride", Some(vec![10, 20, 30]), Some(vec![5, 5])),
                metrics(
                    "r2",
                    feb,
                    "GravelRide",
                    Some(vec![1, 1, 1, 1, 1, 1, 1]),
                    None,
                ),
                metrics("n1", feb, "Run", None, Some(vec![60, 0, 0, 0, 9, 400, 120])),
            ])
            .expect("metrics");
        engine
            .set_curve_body(
                crate::persistence::bodies::CurveKind::Power,
                "Ride",
                42,
                false,
                r#"{"list":[{"secs":[1,5],"values":[600,450]}]}"#,
            )
            .expect("power body");
        engine
            .set_curve_body(
                crate::persistence::bodies::CurveKind::Pace,
                "Run",
                42,
                true,
                r#"{"list":[{"distance":[400,1000],"values":[80,210]}]}"#,
            )
            .expect("pace body");
        engine
            .replace_calendar_events(
                0,
                i64::MAX,
                &[
                    ("e2".into(), feb, r#"{"id":"e2"}"#.into()),
                    ("e1".into(), jan, r#"{"id":"e1"}"#.into()),
                ],
            )
            .expect("calendar");
        engine
            .set_eftp_change("r2", feb, 260.0, 5.0, "r2 name")
            .expect("eftp change");
        engine
            .set_eftp_change("r1", jan, 255.0, 3.0, "r1 name")
            .expect("eftp change");
    })
    .expect("engine");

    let today = chrono::Local::now().date_naive();
    let rows: Vec<crate::FfiWellnessRow> = (0..10)
        .map(|back| {
            let date = (today - chrono::Duration::days(back)).to_string();
            let raw = (back == 0).then_some(r#"{"sportInfo":[{"type":"Ride","load":42.0}]}"#);
            wellness_row(date, 60.0 + back as f64, raw)
        })
        .collect();
    fitness.upsert_wellness(rows).expect("wellness");

    let locked = |f: &dyn Fn(&mut crate::persistence::PersistentEngine) -> String| {
        crate::with_persistent_engine(|e| f(e)).expect("engine")
    };

    let weekly = fitness
        .get_weekly_summaries(
            vec![(jan - 86_400) as f64, (feb - 86_400) as f64],
            (7 * 86_400) as f64,
        )
        .expect("weekly");
    assert_eq!(
        weekly.iter().map(|w| w.count).collect::<Vec<_>>(),
        vec![1, 2],
        "one ride in January's week, a ride and a run in February's"
    );
    assert_eq!(weekly[1].training_load, 100.0);

    let period = fitness
        .get_period_stats(jan as f64, feb as f64)
        .expect("period");
    assert_eq!(period.count, 3);
    assert_eq!(
        format!("{period:?}"),
        locked(&|e| format!("{:?}", e.get_period_stats(jan, feb)))
    );

    let training = fitness
        .get_training_screen_data(training_windows())
        .expect("training screen");
    assert_eq!(
        training
            .months
            .iter()
            .map(|m| (m.year, m.month, m.stats.count))
            .collect::<Vec<_>>(),
        vec![(2026, 1, 1), (2026, 2, 2)]
    );
    assert_eq!(training.year_current.count, 3);
    assert_eq!(training.heatmap.len(), 2);
    assert_eq!(training.heatmap[0].date, "2026-01-15");
    assert_eq!(training.heatmap[0].intensity, 1);
    assert_eq!(training.heatmap[0].max_duration, 1_800.0);
    assert_eq!(training.heatmap[0].activity_count, 1);
    assert_eq!(training.heatmap[1].activity_count, 2);
    assert_eq!(
        format!("{training:?}"),
        locked(&|e| format!(
            "{:?}",
            e.training_screen_data(&training_windows())
                .expect("training screen")
        ))
    );

    let power = fitness
        .get_zone_distribution("Ride".into(), "power".into(), 0.0, i64::MAX as f64)
        .expect("power zones")
        .seconds;
    assert_eq!(
        power,
        vec![11.0, 21.0, 31.0, 1.0, 1.0, 1.0, 1.0],
        "the gravel ride's seconds reach the cycling family"
    );
    let hr = fitness
        .get_zone_distribution("Run".into(), "hr".into(), 0.0, i64::MAX as f64)
        .expect("hr zones")
        .seconds;
    assert_eq!(
        hr,
        vec![60.0, 0.0, 0.0, 0.0, 9.0, 400.0, 120.0],
        "time in the sixth and seventh zones reaches the distribution"
    );
    assert!(
        fitness
            .get_zone_distribution("Run".into(), "cadence".into(), 0.0, i64::MAX as f64)
            .expect("unknown zones")
            .seconds
            .is_empty()
    );
    assert_eq!(
        format!("{power:?}"),
        locked(&|e| format!(
            "{:?}",
            e.get_zone_distribution("Ride", "power", 0, i64::MAX)
        ))
    );

    let sports = fitness.get_available_sport_types().expect("sports");
    assert_eq!(sports, vec!["GravelRide", "Ride", "Run"]);
    assert_eq!(
        format!("{sports:?}"),
        locked(&|e| format!("{:?}", e.get_available_sport_types()))
    );

    let eftp = fitness
        .get_fitness_screen_data()
        .expect("fitness screen")
        .ftp_trend
        .changes;
    assert_eq!(
        eftp.iter()
            .map(|c| c.activity_id.as_str())
            .collect::<Vec<_>>(),
        vec!["r1", "r2"],
        "oldest first"
    );
    assert_eq!(
        format!("{eftp:?}"),
        locked(&|e| format!("{:?}", e.eftp_changes()))
    );

    let calendar = fitness
        .get_calendar_event_bodies(0.0, feb as f64)
        .expect("calendar");
    assert_eq!(calendar, vec![r#"{"id":"e1"}"#, r#"{"id":"e2"}"#]);
    assert_eq!(
        format!("{calendar:?}"),
        locked(&|e| format!(
            "{:?}",
            e.get_calendar_event_bodies(0, feb).expect("calendar")
        ))
    );

    let power_curve = fitness
        .get_power_curve("Ride".into(), 42.0)
        .expect("power curve")
        .expect("a stored power curve");
    let stored_power = crate::with_persistent_engine(|e| {
        e.get_stored_curve(
            crate::persistence::bodies::CurveKind::Power,
            "Ride",
            42,
            false,
        )
        .expect("stored power")
        .expect("a stored row")
    })
    .expect("engine");
    assert_eq!(
        format!("{power_curve:?}"),
        format!(
            "{:?}",
            crate::persistence::curves::parse_power_curve(
                &stored_power.raw,
                "Ride",
                stored_power.fetched_at as i64
            )
            .expect("parses")
        )
    );
    assert!(
        fitness
            .get_power_curve("Ride".into(), 90.0)
            .expect("absent power curve")
            .is_none(),
        "a window never fetched is none"
    );
    let pace_curve = fitness
        .get_pace_curve("Run".into(), 42.0, true)
        .expect("pace curve");
    assert!(pace_curve.is_some());
    assert!(
        fitness
            .get_pace_curve("Run".into(), 42.0, false)
            .expect("absent pace curve")
            .is_none(),
        "the gap flag is part of the key"
    );

    let oldest = (today - chrono::Duration::days(30)).to_string();
    let newest = today.to_string();
    let days = fitness
        .get_wellness_days(oldest.clone(), newest.clone())
        .expect("wellness days");
    assert_eq!(days.len(), 10);
    assert_eq!(days.last().expect("today").sport_load.len(), 1);
    assert_eq!(
        format!("{days:?}"),
        locked(&|e| format!(
            "{:?}",
            e.get_wellness_days(&oldest, &newest)
                .expect("wellness days")
        ))
    );

    let sparklines = fitness.get_wellness_sparklines(14).expect("sparklines");
    assert!(sparklines.is_some());
    assert_eq!(
        format!("{sparklines:?}"),
        locked(&|e| format!("{:?}", e.get_wellness_sparklines(14).expect("sparklines")))
    );
}

/// Scenario: Cedar Hill holds a fresh Ride record and an old VirtualRide
/// record, and the athlete's eFTP is up a quarter since the old one was set.
///
/// Expected behaviour: both insights paths offer the VirtualRide as a stale
/// opportunity and the Ride, which already carries a recent record, is not.
#[test]
fn test_insights_stale_pr_is_excluded_only_in_the_sport_of_the_recent_record() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("stale_pr_sport_exclusion.db");
    let fitness = FitnessManager::new();
    let now = chrono::Utc::now().timestamp();
    let today = chrono::Local::now().date_naive().to_string();
    let old = now - 400 * 86_400;
    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, disabled, version, source_activity_id)
                 VALUES ('cedar_hill', 'auto', 'Cedar Hill', 'Ride', '[]', 800.0, 0, 1, NULL)",
                [],
            )
            .expect("section");
        // (activity, sport, start, lap seconds): the newest lap in each sport
        // is its fastest, so each sport's record is its latest outing.
        let laps = [
            ("old_0", "VirtualRide", old - 2 * 86_400, 260.0),
            ("old_1", "VirtualRide", old - 86_400, 250.0),
            ("old_2", "VirtualRide", old, 240.0),
            ("new_0", "Ride", now - 5 * 86_400, 260.0),
            ("new_1", "Ride", now - 4 * 86_400, 250.0),
            ("new_2", "Ride", now - 86_400, 240.0),
        ];
        for (id, sport, date, lap) in laps {
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                             start_date, name, distance_meters, duration_secs)
                     VALUES (?1, ?2, 46.0, 46.1, 7.0, 7.1, ?3, ?1, 1000.0, 300)",
                    rusqlite::params![id, sport, date],
                )
                .expect("activity");
            engine
                .db
                .execute(
                    "INSERT INTO activity_metrics (activity_id, name, date, distance,
                                                   moving_time, elapsed_time, elevation_gain,
                                                   sport_type)
                     VALUES (?1, ?1, ?2, 1000.0, 300, 300, 0.0, ?3)",
                    rusqlite::params![id, date, sport],
                )
                .expect("metrics");
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                                                     start_index, end_index, distance_meters,
                                                     lap_time, lap_pace, excluded)
                     VALUES ('cedar_hill', ?1, 'same', 0, 40, 800.0, ?2, ?3, 0)",
                    rusqlite::params![id, lap, 800.0 / lap],
                )
                .expect("traversal");
        }
    })
    .expect("engine");
    let record_day = chrono::DateTime::from_timestamp(old, 0)
        .expect("record")
        .date_naive()
        .to_string();
    let eftp = |eftp: f64| {
        format!(
            r#"{{"sportInfo":[{{"type":"Ride","eftp":{eftp}}},{{"type":"VirtualRide","eftp":{eftp}}}]}}"#
        )
    };
    fitness
        .upsert_wellness(vec![
            wellness_row(record_day, 60.0, Some(&eftp(200.0))),
            wellness_row(today, 60.0, Some(&eftp(250.0))),
        ])
        .expect("wellness");

    let params = crate::FfiInsightsParams {
        history_limit: 20,
        current_start: (now - 7 * 86_400) as f64,
        current_end: now as f64,
        prev_start: (now - 14 * 86_400) as f64,
        prev_end: (now - 7 * 86_400) as f64,
        chronic_start: (now - 35 * 86_400) as f64,
        today_start: (now - 86_400) as f64,
        include_sections: true,
        ranked_limit: 50,
        active_window_days: 90,
        efficiency_per_sport: 5,
        efficiency_min_hr_change_bpm: 1,
        efficiency_limit: 2,
        efficiency_min_efforts: 3,
        efficiency_declining_min_efforts: 5,
        strength_month: crate::FfiTimestampRange {
            start_ts: (now - 28 * 86_400) as f64,
            end_ts: now as f64,
        },
        strength_weeks: Vec::new(),
        wellness_oldest: "2000-01-01".to_string(),
        wellness_newest: "2100-01-01".to_string(),
        hrv_window_days: 7,
        section_change_window_days: 14,
        stale_threshold_days: 30,
        stale_min_gain_percent: 3.0,
        stale_max_opportunities: 5,
        stale_min_traversals: 1,
        recent_pr_window_days: 7,
        recent_pr_min_outings: 3,
    };
    let pooled = fitness
        .get_insights_data(params.clone())
        .expect("pooled insights");
    let engine = crate::with_persistent_engine(|e| e.insights_data(&params)).expect("engine");

    for (path, bundle) in [("pooled", pooled), ("engine", engine)] {
        assert_eq!(
            bundle
                .recent_prs
                .iter()
                .map(|pr| (pr.section_id.as_str(), pr.sport_type.as_str()))
                .collect::<Vec<_>>(),
            vec![("cedar_hill", "Ride")],
            "{path}: the fixture holds a recent Ride record"
        );
        assert_eq!(
            bundle
                .stale_pr_opportunities
                .iter()
                .map(|o| (o.section_id.as_str(), o.sport_type.as_str()))
                .collect::<Vec<_>>(),
            vec![("cedar_hill", "VirtualRide")],
            "{path}"
        );
    }
}
