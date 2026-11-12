//! Curves worked out on the phone, on synthetic streams.
//!
//! Expected behaviour: a constant hour holds its watts at every duration to
//! the hour and none beyond; a short hard effort shows at its own length and
//! dilutes at a longer one; the library curve is the best of the rides in it;
//! the fit recovers the critical power and W' of a ride built from them; and a
//! library with anything from intervals.icu, or a window the server already
//! filled, is left as the server has it.

use super::*;
use crate::persistence::PersistentEngine;
use crate::persistence::bodies::CurveKind;
use tempfile::TempDir;

fn ride(id: &str, at: i64, points: Vec<f32>) -> RideCurve {
    RideCurve {
        id: id.into(),
        name: format!("Ride {id}"),
        distance: 0.0,
        moving_time: 0.0,
        at,
        points,
    }
}

fn at_duration(curve: &[f32], secs: u32) -> f32 {
    curve[POWER_DURATIONS.iter().position(|&d| d == secs).unwrap()]
}

#[test]
fn a_constant_hour_holds_its_watts_to_the_hour_and_nothing_beyond() {
    let curve = mean_max(&vec![250.0; 3600], &POWER_DURATIONS);

    for (&secs, &watts) in POWER_DURATIONS.iter().zip(&curve) {
        if secs <= 3600 {
            assert_eq!(watts, 250.0, "{secs} s");
        } else {
            assert_eq!(watts, 0.0, "{secs} s is longer than the ride");
        }
    }
}

#[test]
fn one_hard_minute_shows_at_a_minute_and_dilutes_at_two() {
    let mut watts = vec![100.0; 600];
    watts[200..260].fill(300.0);

    let curve = mean_max(&watts, &POWER_DURATIONS);

    assert_eq!(at_duration(&curve, 60), 300.0);
    assert_eq!(at_duration(&curve, 120), 200.0);
    assert!(at_duration(&curve, 30) == 300.0);
}

#[test]
fn a_gap_in_the_clock_reads_as_nought_watts() {
    let time = [0.0, 1.0, 2.0, 5.0, 6.0];
    let watts = [Some(200.0), Some(200.0), Some(200.0), Some(200.0), None];

    let per_second = resample_1hz(Some(&time), &watts);

    assert_eq!(per_second, vec![200.0, 200.0, 200.0, 0.0, 0.0, 200.0, 0.0]);
}

#[test]
fn the_library_curve_takes_the_best_of_the_rides_at_each_duration() {
    let steady = ride("a", 10, mean_max(&vec![200.0; 1800], &POWER_DURATIONS));
    let mut surge = vec![100.0; 600];
    surge[0..60].fill(400.0);
    let surge = ride("b", 20, mean_max(&surge, &POWER_DURATIONS));

    let best = best_of(&[&steady, &surge], POWER_DURATIONS.len(), Sense::Highest);

    let slot = |secs: u32| POWER_DURATIONS.iter().position(|&d| d == secs).unwrap();
    assert_eq!(best.values[slot(60)], 400.0);
    assert_eq!(best.owner[slot(60)], Some(1));
    assert_eq!(best.values[slot(1200)], 200.0);
    assert_eq!(best.owner[slot(1200)], Some(0));
    assert_eq!(best.values[slot(3600)], 0.0);
    assert_eq!(best.owner[slot(3600)], None);
}

#[test]
fn the_fit_recovers_the_critical_power_and_w_prime_of_a_ride_built_from_them() {
    let (cp, w_prime) = (250.0, 20_000.0);
    let points: Vec<(f64, f64)> = [180.0, 300.0, 480.0, 720.0, 1200.0]
        .iter()
        .map(|t| (*t, cp * t + w_prime))
        .collect();

    let fit = critical_fit(&points).expect("supported");

    assert!((fit.critical - cp).abs() < 1e-6);
    assert!((fit.prime - w_prime).abs() < 1e-4);
    assert!((fit.r2 - 1.0).abs() < 1e-9);
}

#[test]
fn a_fit_with_too_few_points_or_a_negative_w_prime_is_not_supported() {
    assert!(critical_fit(&[(180.0, 45_000.0), (300.0, 75_000.0)]).is_none());
    // Work growing faster than a line through the origin gives a negative W'.
    let below = [(180.0, 10_000.0), (600.0, 150_000.0), (1200.0, 330_000.0)];
    assert!(critical_fit(&below).is_none());
}

#[test]
fn the_eftp_is_the_critical_power_when_the_fit_holds_and_95_percent_of_twenty_minutes_when_not() {
    let mut fitted = best_of(&[], POWER_DURATIONS.len(), Sense::Highest);
    for (slot, secs) in POWER_DURATIONS.iter().enumerate() {
        let t = f64::from(*secs);
        fitted.values[slot] = (250.0 * t + 20_000.0) / t;
    }
    assert!((eftp_of(&fitted).unwrap() - 250.0).abs() < 1e-6);

    let mut only_twenty = best_of(&[], POWER_DURATIONS.len(), Sense::Highest);
    let slot = POWER_DURATIONS.iter().position(|&d| d == 1200).unwrap();
    only_twenty.values[slot] = 300.0;
    assert_eq!(eftp_of(&only_twenty), Some(285.0));

    let nothing = best_of(&[], POWER_DURATIONS.len(), Sense::Highest);
    assert_eq!(eftp_of(&nothing), None);
}

#[test]
fn a_steady_run_takes_the_same_time_to_cover_each_distance_and_none_beyond_its_length() {
    let time: Vec<f64> = (0..=1000).map(f64::from).collect();
    let distance: Vec<f64> = time.iter().map(|t| t * 4.0).collect();

    let times = best_times(&time, &distance, &PACE_DISTANCES);

    let at = |metres: u32| times[PACE_DISTANCES.iter().position(|&d| d == metres).unwrap()];
    assert_eq!(at(400), 100.0);
    assert_eq!(at(1000), 250.0);
    assert_eq!(at(4000), 1000.0);
    assert_eq!(at(5000), 0.0, "the run is 4,000 m long");
}

#[test]
fn the_fastest_stretch_of_a_run_sets_its_best_time() {
    // 2 m/s, then 200 s at 5 m/s, then 2 m/s again.
    let mut time = Vec::new();
    let mut distance = Vec::new();
    let mut covered = 0.0;
    for second in 0..600 {
        let speed = if (200..400).contains(&second) {
            5.0
        } else {
            2.0
        };
        time.push(f64::from(second));
        distance.push(covered);
        covered += speed;
    }

    let times = best_times(&time, &distance, &[1000]);

    assert_eq!(times, vec![200.0]);
}

#[test]
fn the_pace_fit_recovers_the_critical_speed_and_d_prime() {
    let (cs, d_prime) = (4.0, 150.0);
    let points: Vec<(f64, f64)> = [200.0, 400.0, 800.0, 1200.0]
        .iter()
        .map(|t| (*t, cs * t + d_prime))
        .collect();

    let fit = critical_fit(&points).expect("supported");

    assert!((fit.critical - cs).abs() < 1e-9);
    assert!((fit.prime - d_prime).abs() < 1e-6);
}

fn window(days: i64) -> Window {
    Window {
        days,
        now: 1_700_100_000,
        earliest: 1_700_000_000,
    }
}

#[test]
fn the_power_body_reads_back_through_the_server_parser_with_the_fit_as_its_model() {
    let a = ride("a", 10, mean_max(&vec![220.0; 1500], &POWER_DURATIONS));
    let mut surge = vec![120.0; 900];
    surge[0..5].fill(900.0);
    let b = ride("b", 20, mean_max(&surge, &POWER_DURATIONS));

    let body = power_body(&[&a, &b], window(0), Some(70.0)).expect("reaches durations");
    let curve = crate::persistence::curves::parse_power_curve(&body, "Ride", 7).expect("parses");

    let slot = |secs: f64| curve.secs.iter().position(|s| *s == secs).unwrap();
    assert_eq!(curve.watts[slot(5.0)], 900.0);
    assert_eq!(curve.activity_ids.as_ref().unwrap()[slot(5.0)], "b");
    assert_eq!(curve.watts[slot(1200.0)], 220.0);
    assert_eq!(curve.weight, Some(70.0));
    assert!((curve.watts_per_kg.as_ref().unwrap()[slot(1200.0)] - 220.0 / 70.0).abs() < 1e-9);
    assert_eq!(curve.activities["b"].name, "Ride b");
    assert_eq!(curve.models.len(), 1);
    assert_eq!(curve.models[0].kind, MODEL_KIND);
    assert_eq!(curve.models[0].p_max, Some(900.0));
    assert_eq!(curve.source, "veloq");
}

#[test]
fn a_window_no_ride_reaches_writes_no_body() {
    let short = ride("a", 10, vec![0.0; POWER_DURATIONS.len()]);
    assert!(power_body(&[&short], window(42), None).is_none());
    assert!(power_body(&[], window(42), None).is_none());
    assert!(pace_body(&[], window(42)).is_none());
}

// ----------------------------------------------------------------------------
// Storage
// ----------------------------------------------------------------------------

const RIDE_AT: i64 = 1_700_000_000;
const NOW: i64 = 1_700_100_000;

fn engine() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().unwrap();
    let engine =
        PersistentEngine::new(dir.path().join("curves_local.db").to_str().unwrap()).unwrap();
    (dir, engine)
}

fn stream(kind: &str, data: Vec<f64>) -> StreamDto {
    StreamDto {
        kind: kind.into(),
        data: data.into_iter().map(Some).collect(),
        data2: None,
    }
}

fn add_activity(engine: &PersistentEngine, id: &str, sport: &str, at: i64, streams: &[StreamDto]) {
    engine
        .db
        .execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                     start_date, name, distance_meters, duration_secs)
             VALUES (?1, ?2, 0, 0, 0, 0, ?3, ?1, 0, 0)",
            params![id, sport, at],
        )
        .unwrap();
    engine
        .db
        .execute(
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                                           elapsed_time, elevation_gain, sport_type)
             VALUES (?1, ?1, ?2, 0, 0, 0, 0, ?3)",
            params![id, at, sport],
        )
        .unwrap();
    engine.store_trackless_streams(id, streams).unwrap();
}

fn power_streams(watts: Vec<f64>) -> Vec<StreamDto> {
    let time: Vec<f64> = (0..watts.len()).map(|i| i as f64).collect();
    vec![stream("time", time), stream("watts", watts)]
}

fn body_of(
    engine: &PersistentEngine,
    kind: &str,
    sport: &str,
    days: i64,
) -> Option<(String, String)> {
    engine
        .db
        .query_row(
            "SELECT raw, source FROM curve_bodies
              WHERE kind = ?1 AND sport = ?2 AND days = ?3 AND gap = 0",
            params![kind, sport, days],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .unwrap()
}

#[test]
fn a_garmin_only_library_gets_a_curve_from_its_rides_streams() {
    let (_dir, engine) = engine();
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT,
        &power_streams(vec![250.0; 3600]),
    );

    refresh(&engine.db, NOW).unwrap();

    let (raw, source) = body_of(&engine, "power", "Ride", 0).expect("all-time curve");
    assert_eq!(source, SOURCE_LOCAL);
    let curve = crate::persistence::curves::parse_power_curve(&raw, "Ride", NOW).unwrap();
    let hour = curve.secs.iter().position(|s| *s == 3600.0).unwrap();
    assert_eq!(curve.watts[hour], 250.0);
    assert_eq!(
        *curve.secs.last().unwrap(),
        3600.0,
        "nothing past the ride's length"
    );
    assert_eq!(curve.activity_ids.unwrap()[hour], "src-garmin-1");
}

#[test]
fn a_window_that_holds_no_ride_has_no_curve() {
    let (_dir, engine) = engine();
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT,
        &power_streams(vec![250.0; 600]),
    );

    refresh(&engine.db, RIDE_AT + 30 * DAY_S).unwrap();

    assert!(body_of(&engine, "power", "Ride", 0).is_some());
    assert!(body_of(&engine, "power", "Ride", 365).is_some());
    assert!(
        body_of(&engine, "power", "Ride", 7).is_none(),
        "the ride is more than seven days old"
    );
}

#[test]
fn a_curve_the_server_sent_for_the_same_window_is_left_untouched() {
    let (_dir, engine) = engine();
    engine
        .set_curve_body(CurveKind::Power, "Ride", 0, false, r#"{"list":[]}"#)
        .unwrap();
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT,
        &power_streams(vec![250.0; 600]),
    );

    refresh(&engine.db, NOW).unwrap();

    let (raw, source) = body_of(&engine, "power", "Ride", 0).unwrap();
    assert_eq!(raw, r#"{"list":[]}"#);
    assert_eq!(source, "intervals");
    assert_eq!(
        body_of(&engine, "power", "Ride", 365).unwrap().1,
        SOURCE_LOCAL
    );
}

#[test]
fn a_server_sync_of_a_window_takes_it_back_from_the_phone() {
    let (_dir, engine) = engine();
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT,
        &power_streams(vec![250.0; 600]),
    );
    refresh(&engine.db, NOW).unwrap();
    assert_eq!(
        body_of(&engine, "power", "Ride", 0).unwrap().1,
        SOURCE_LOCAL
    );

    engine
        .set_curve_body(CurveKind::Power, "Ride", 0, false, r#"{"list":[]}"#)
        .unwrap();

    assert_eq!(body_of(&engine, "power", "Ride", 0).unwrap().1, "intervals");
}

#[test]
fn a_library_holding_an_intervals_activity_never_writes_a_curve() {
    let (_dir, engine) = engine();
    add_activity(
        &engine,
        "i123",
        "Ride",
        RIDE_AT,
        &power_streams(vec![250.0; 600]),
    );
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT + 100,
        &power_streams(vec![300.0; 600]),
    );

    refresh(&engine.db, NOW).unwrap();

    let curves: i64 = engine
        .db
        .query_row("SELECT COUNT(*) FROM activity_curves", [], |r| r.get(0))
        .unwrap();
    assert_eq!(curves, 0);
    assert!(body_of(&engine, "power", "Ride", 0).is_none());
}

#[test]
fn a_garmin_original_linked_to_an_intervals_activity_ends_the_garmin_only_library() {
    let (_dir, engine) = engine();
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT,
        &power_streams(vec![250.0; 600]),
    );
    assert!(is_garmin_only(&engine.db).unwrap());

    engine
        .db
        .execute(
            "UPDATE activities SET intervals_id = 'i77' WHERE id = 'src-garmin-1'",
            [],
        )
        .unwrap();

    assert!(!is_garmin_only(&engine.db).unwrap());
}

#[test]
fn the_daily_eftp_is_written_in_the_wellness_sport_info_shape() {
    let (_dir, engine) = engine();
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT,
        &power_streams(vec![200.0; 1500]),
    );

    refresh(&engine.db, NOW).unwrap();

    let raw: String = engine
        .db
        .query_row(
            "SELECT raw FROM wellness WHERE date = '2023-11-14'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let body: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(body["sportInfo"][0]["type"], "Ride");
    assert_eq!(body["sportInfo"][0]["eftp"], 200.0);
    assert_eq!(body["sportInfo"][0]["source"], "veloq");
}

#[test]
fn the_daily_eftp_reads_only_the_ninety_days_before_the_day() {
    let (_dir, engine) = engine();
    let old = RIDE_AT - 100 * DAY_S;
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        old,
        &power_streams(vec![300.0; 1500]),
    );
    add_activity(
        &engine,
        "src-garmin-2",
        "Ride",
        RIDE_AT,
        &power_streams(vec![200.0; 1500]),
    );

    refresh(&engine.db, NOW).unwrap();

    let eftp = |date: &str| -> f64 {
        let raw: String = engine
            .db
            .query_row("SELECT raw FROM wellness WHERE date = ?1", [date], |r| {
                r.get(0)
            })
            .unwrap();
        serde_json::from_str::<Value>(&raw).unwrap()["sportInfo"][0]["eftp"]
            .as_f64()
            .unwrap()
    };
    assert_eq!(eftp("2023-11-14"), 200.0, "the 300 W ride is 100 days back");
    assert_eq!(eftp("2023-08-06"), 300.0);
}

#[test]
fn a_run_with_distance_and_clock_writes_a_pace_curve() {
    let (_dir, engine) = engine();
    let time: Vec<f64> = (0..=1300).map(f64::from).collect();
    let distance: Vec<f64> = time.iter().map(|t| t * 4.0).collect();
    add_activity(
        &engine,
        "src-garmin-2",
        "Run",
        RIDE_AT,
        &[stream("time", time), stream("distance", distance)],
    );

    refresh(&engine.db, NOW).unwrap();

    let (raw, source) = body_of(&engine, "pace", "Run", 0).expect("pace curve");
    assert_eq!(source, SOURCE_LOCAL);
    let curve = crate::persistence::curves::parse_pace_curve(&raw, "Run", NOW).unwrap();
    let at = |metres: f64| curve.distances.iter().position(|d| *d == metres).unwrap();
    assert_eq!(curve.times[at(400.0)], 100.0);
    assert_eq!(curve.times[at(5000.0)], 1250.0);
    assert!((curve.critical_speed.unwrap() - 4.0).abs() < 1e-6);
    assert_eq!(curve.source, "veloq");
}

#[test]
fn a_second_refresh_with_nothing_new_changes_nothing() {
    let (_dir, engine) = engine();
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT,
        &power_streams(vec![250.0; 600]),
    );
    refresh(&engine.db, NOW).unwrap();
    let first = body_of(&engine, "power", "Ride", 0);

    refresh(&engine.db, NOW + 5).unwrap();

    assert_eq!(body_of(&engine, "power", "Ride", 0), first);
}

#[test]
fn signing_out_takes_the_ride_curves_with_it() {
    let (_dir, mut engine) = engine();
    add_activity(
        &engine,
        "src-garmin-1",
        "Ride",
        RIDE_AT,
        &power_streams(vec![250.0; 600]),
    );
    refresh(&engine.db, NOW).unwrap();

    engine.clear().unwrap();

    let held: i64 = engine
        .db
        .query_row("SELECT COUNT(*) FROM activity_curves", [], |r| r.get(0))
        .unwrap();
    assert_eq!(held, 0);
}
