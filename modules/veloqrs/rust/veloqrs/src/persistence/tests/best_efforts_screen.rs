//! Scenario: the Best Efforts screen draws power, pace and climbing bests for
//! one period, toggled between a season and all time while it stays mounted.
//!
//! Expected behaviour: one read gives every sport's bests at the screen's
//! checkpoints from the curve stored for that period, says which curves were
//! never fetched, and gives each climbing family's best window per length from
//! the stored climb rows, with the activity that holds it and how many
//! activities in the period are still owed rows. Nothing it returns is
//! non-finite.

use super::pooled::best_efforts_data;
use crate::GpsPoint;
use crate::metrics::vertical_power::CLIMB_WINDOWS_S;
use crate::persistence::PersistentEngine;
use crate::persistence::bodies::CurveKind;
use crate::persistence::{
    ELEVATION_SOURCE_CORRECTED, ELEVATION_SOURCE_DEVICE, ELEVATION_SOURCE_RECORDED,
    ELEVATION_SOURCE_UNKNOWN,
};
use crate::{FfiBestEffortsData, FfiBestEffortsSport, FfiClimbBests};

const NOW: i64 = 1_760_000_000;
const DAY: i64 = 86_400;
const SEASON: i64 = 90;
const ALL_TIME: i64 = 0;
/// Long enough that every stored window fits.
const POINTS: u32 = 1300;

const RIDE_POWER: &str = r#"{
    "list": [{
        "secs": [1, 5, 60, 301, 1200, 7200],
        "values": [900, 780, 410, 300, 260, 200],
        "activity_id": ["p1", "p2", "p3", "p4", "p5", "p6"]
    }]
}"#;

const RUN_PACE: &str = r#"{
    "list": [{
        "distance": [400, 1000, 5000, 10000, 21098],
        "values": [80, 210, 1200, 2500, 0],
        "activity_id": ["r1", "r2", "r3", "r4", "r5"]
    }]
}"#;

/// Label, checkpoint, watts and the activity holding them.
type PowerRow<'a> = (&'a str, f64, Option<f64>, Option<&'a str>);

/// Label, speed, time and the activity holding them.
type PaceRow<'a> = (&'a str, Option<f64>, Option<f64>, Option<&'a str>);

/// Flat, then a rep of `rep_m` metres over 15 s from t=40, then flat again.
fn hill_rep(rep_m: f64) -> impl Fn(u32) -> f64 {
    move |t| match t {
        0..=40 => 100.0,
        41..=55 => 100.0 + rep_m * f64::from(t - 40) / 15.0,
        _ => 100.0 + rep_m,
    }
}

fn climbed(engine: &mut PersistentEngine, id: &str, sport: &str, rep_m: f64, days_ago: i64) {
    let rep = hill_rep(rep_m);
    let points: Vec<GpsPoint> = (0..POINTS)
        .map(|t| GpsPoint::with_elevation(46.0, 7.0 + f64::from(t) * 0.00003, rep(t)))
        .collect();
    engine
        .add_activities_batch(vec![(id.to_string(), points, sport.to_string())])
        .unwrap();
    engine
        .update_activity_metadata(id, Some(NOW - days_ago * DAY), Some(id), None, None)
        .unwrap();
    let times: Vec<u32> = (0..POINTS).collect();
    engine.store_time_streams_flat(&[id.to_string()], &times, &[0]);
    engine
        .record_elevation_source(&[(id.to_string(), ELEVATION_SOURCE_CORRECTED)])
        .unwrap();
}

fn set_source(engine: &PersistentEngine, id: &str, source: u8) {
    engine
        .record_elevation_source(&[(id.to_string(), source)])
        .unwrap();
}

fn read(engine: &PersistentEngine, days: i64) -> FfiBestEffortsData {
    best_efforts_data(&engine.db, days, NOW).unwrap()
}

fn sport<'a>(data: &'a FfiBestEffortsData, name: &str) -> &'a FfiBestEffortsSport {
    data.sports.iter().find(|s| s.sport == name).unwrap()
}

fn climbing<'a>(data: &'a FfiBestEffortsData, name: &str) -> &'a FfiClimbBests {
    data.climbing.iter().find(|c| c.sport == name).unwrap()
}

/// The 15 s best's vam and the activity holding it.
fn fifteen_seconds(bests: &FfiClimbBests) -> (Option<f64>, Option<String>) {
    let best = bests.bests.iter().find(|b| b.window_s == 15).unwrap();
    (best.vam, best.activity_id.clone())
}

fn assert_all_finite(data: &FfiBestEffortsData) {
    for s in &data.sports {
        for e in &s.efforts {
            assert!(
                e.value.is_none_or(f64::is_finite),
                "{} {}",
                s.sport,
                e.label
            );
            assert!(e.time.is_none_or(f64::is_finite), "{} {}", s.sport, e.label);
        }
    }
    for c in &data.climbing {
        for b in &c.bests {
            assert!(b.vam.is_none_or(f64::is_finite), "{} {}", c.sport, b.label);
            assert!(b.watts_per_kg.is_none_or(f64::is_finite));
        }
    }
}

#[test]
fn test_best_efforts_match_curve_reads_for_each_sport_and_period() {
    let engine = PersistentEngine::in_memory().unwrap();
    for days in [SEASON, ALL_TIME] {
        let power_body = if days == SEASON {
            RIDE_POWER
        } else {
            r#"{"list":[{"secs":[5],"values":[1000],"activity_id":["long-ride"]}]}"#
        };
        let pace_body = if days == SEASON {
            RUN_PACE
        } else {
            r#"{"list":[{"distance":[400],"values":[70],"activity_id":["long-run"]}]}"#
        };
        engine
            .set_curve_body(CurveKind::Power, "Ride", days, false, power_body)
            .unwrap();
        for sport in ["Run", "Swim"] {
            engine
                .set_curve_body(CurveKind::Pace, sport, days, false, pace_body)
                .unwrap();
        }

        let data = read(&engine, days);
        let (fetched, power) =
            crate::persistence::curves::pooled::power_curve(&engine.db, "Ride", days).unwrap();
        assert_eq!(sport(&data, "Ride").fetched, fetched);
        assert_eq!(
            format!("{:?}", sport(&data, "Ride").efforts),
            format!("{:?}", super::power_bests(power.as_ref()))
        );
        for name in ["Run", "Swim"] {
            let (fetched, pace) =
                crate::persistence::curves::pooled::pace_curve(&engine.db, name, days, false)
                    .unwrap();
            let checkpoints = if name == "Run" {
                &super::RUN_CHECKPOINTS[..]
            } else {
                &super::SWIM_CHECKPOINTS[..]
            };
            assert_eq!(sport(&data, name).fetched, fetched);
            assert_eq!(
                format!("{:?}", sport(&data, name).efforts),
                format!("{:?}", super::pace_bests(pace.as_ref(), checkpoints))
            );
        }
    }
}

#[test]
fn power_bests_are_read_at_each_checkpoint_of_the_stored_ride_curve() {
    let engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_curve_body(CurveKind::Power, "Ride", SEASON, false, RIDE_POWER)
        .unwrap();

    let data = read(&engine, SEASON);
    let ride = sport(&data, "Ride");
    assert!(ride.fetched);
    let rows: Vec<PowerRow> = ride
        .efforts
        .iter()
        .map(|e| {
            (
                e.label.as_str(),
                e.checkpoint,
                e.value,
                e.activity_id.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            ("5s", 5.0, Some(780.0), Some("p2")),
            ("1m", 60.0, Some(410.0), Some("p3")),
            // A sample a second off its checkpoint stands for it.
            ("5m", 300.0, Some(300.0), Some("p4")),
            ("20m", 1200.0, Some(260.0), Some("p5")),
            // The curve holds no hour, and the two-hour best is not one.
            ("1h", 3600.0, None, None),
        ]
    );
    assert!(ride.efforts.iter().all(|e| e.time.is_none()));
}

#[test]
fn pace_bests_carry_the_time_and_drop_a_distance_with_no_time() {
    let engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_curve_body(CurveKind::Pace, "Run", SEASON, false, RUN_PACE)
        .unwrap();

    let data = read(&engine, SEASON);
    let run = sport(&data, "Run");
    assert!(run.fetched);
    let rows: Vec<PaceRow> = run
        .efforts
        .iter()
        .map(|e| (e.label.as_str(), e.value, e.time, e.activity_id.as_deref()))
        .collect();
    assert_eq!(
        rows,
        vec![
            ("400m", Some(5.0), Some(80.0), Some("r1")),
            ("1K", Some(1000.0 / 210.0), Some(210.0), Some("r2")),
            ("5K", Some(5000.0 / 1200.0), Some(1200.0), Some("r3")),
            ("10K", Some(4.0), Some(2500.0), Some("r4")),
            // Within a metre of the half, but a zero time is no best.
            ("Half", None, None, None),
        ]
    );
    assert_all_finite(&data);
}

#[test]
fn a_curve_never_fetched_for_the_period_says_so_and_holds_no_values() {
    let engine = PersistentEngine::in_memory().unwrap();
    engine
        .set_curve_body(CurveKind::Power, "Ride", SEASON, false, RIDE_POWER)
        .unwrap();

    let all_time = read(&engine, ALL_TIME);
    let names: Vec<&str> = all_time.sports.iter().map(|s| s.sport.as_str()).collect();
    assert_eq!(names, vec!["Ride", "Run", "Swim"]);
    for s in &all_time.sports {
        assert!(!s.fetched, "{} was fetched for the season only", s.sport);
        assert!(
            s.efforts
                .iter()
                .all(|e| e.value.is_none() && e.activity_id.is_none())
        );
    }
    let swim: Vec<&str> = sport(&all_time, "Swim")
        .efforts
        .iter()
        .map(|e| e.label.as_str())
        .collect();
    assert_eq!(swim, vec!["100m", "200m", "400m", "1500m"]);
}

#[test]
fn the_climb_best_per_window_is_the_period_and_family_maximum() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    climbed(&mut engine, "recent-run", "Run", 10.0, 10);
    climbed(&mut engine, "old-run", "Run", 20.0, 200);
    climbed(&mut engine, "trail", "TrailRun", 15.0, 300);
    climbed(&mut engine, "hike", "Hike", 40.0, 5);
    climbed(&mut engine, "ride", "Ride", 5.0, 20);

    let season = read(&engine, SEASON);
    let run = climbing(&season, "Run");
    let (vam, holder) = fifteen_seconds(run);
    assert_eq!(holder.as_deref(), Some("recent-run"));
    let vam = vam.unwrap();
    assert!((vam - 10.0 / 15.0 * 3600.0).abs() < 1.0, "15 s vam {vam}");
    let best = run.bests.iter().find(|b| b.window_s == 15).unwrap();
    assert!((best.watts_per_kg.unwrap() - vam / 3600.0 * 9.81).abs() < 1e-9);
    assert_eq!(
        fifteen_seconds(climbing(&season, "Ride")).1.as_deref(),
        Some("ride")
    );

    let windows: Vec<u32> = run.bests.iter().map(|b| b.window_s).collect();
    assert_eq!(windows, CLIMB_WINDOWS_S.to_vec());
    assert_eq!(run.bests[0].label, "15s");

    // All time reaches the older and steeper run, and still never a hike.
    let all_time = read(&engine, ALL_TIME);
    assert_eq!(
        fifteen_seconds(climbing(&all_time, "Run")).1.as_deref(),
        Some("old-run")
    );
    assert_eq!(climbing(&all_time, "Run").owed, 0);
    assert_all_finite(&all_time);
}

#[test]
fn a_virtual_or_assisted_activity_never_holds_a_climb_best() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    climbed(&mut engine, "road", "Ride", 5.0, 3);
    for (id, sport) in [("trainer", "VirtualRide"), ("motor", "EBikeRide")] {
        climbed(&mut engine, id, sport, 50.0, 3);
        // The writer stores none for these sports, so the read is the only
        // thing left to keep a row that got in anyway out of the ranking.
        engine
            .db
            .execute(
                "INSERT INTO activity_climb_bests (activity_id, window_s, start_idx, end_idx, vam)
                 VALUES (?1, 15, 40, 55, 12000.0)",
                [id],
            )
            .unwrap();
    }

    let data = read(&engine, SEASON);
    assert_eq!(
        fifteen_seconds(climbing(&data, "Ride")).1.as_deref(),
        Some("road")
    );
}

#[test]
fn an_empty_library_has_every_climb_window_and_no_value() {
    let engine = PersistentEngine::in_memory().unwrap();
    let data = read(&engine, ALL_TIME);
    let names: Vec<&str> = data.climbing.iter().map(|c| c.sport.as_str()).collect();
    assert_eq!(names, vec!["Ride", "Run"]);
    for c in &data.climbing {
        assert_eq!(c.owed, 0);
        assert_eq!(c.bests.len(), CLIMB_WINDOWS_S.len());
        assert!(
            c.bests
                .iter()
                .all(|b| b.vam.is_none() && b.watts_per_kg.is_none() && b.activity_id.is_none())
        );
    }
}

#[test]
fn activities_still_owed_rows_are_counted_within_the_period_and_family() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    climbed(&mut engine, "recent-run", "Run", 10.0, 10);
    climbed(&mut engine, "old-run", "Run", 20.0, 200);
    climbed(&mut engine, "ride", "Ride", 5.0, 20);
    engine
        .db
        .execute(
            "DELETE FROM activity_climb_bests WHERE activity_id IN ('recent-run', 'old-run')",
            [],
        )
        .unwrap();

    let season = read(&engine, SEASON);
    assert_eq!(climbing(&season, "Run").owed, 1);
    assert_eq!(climbing(&season, "Ride").owed, 0);
    assert_eq!(fifteen_seconds(climbing(&season, "Run")), (None, None));
    assert_eq!(climbing(&read(&engine, ALL_TIME), "Run").owed, 2);
}

#[test]
fn a_checkpoint_between_distant_samples_or_past_the_curve_has_no_best() {
    let engine = PersistentEngine::in_memory().unwrap();
    let short_run = r#"{"list": [{
        "distance": [400, 1000, 5000, 14000],
        "values": [80, 222, 1250, 4000],
        "activity_id": ["a", "b", "c", "d"]
    }]}"#;
    let short_ride = r#"{"list": [{
        "secs": [5, 60, 1200, 3600],
        "values": [900, 500, 280, 220],
        "activity_id": ["a", "b", "c", "d"]
    }]}"#;
    engine
        .set_curve_body(CurveKind::Pace, "Run", SEASON, false, short_run)
        .unwrap();
    engine
        .set_curve_body(CurveKind::Power, "Ride", SEASON, false, short_ride)
        .unwrap();

    let data = read(&engine, SEASON);
    let by_label = |sport_name: &str, label: &str| {
        sport(&data, sport_name)
            .efforts
            .iter()
            .find(|e| e.label == label)
            .cloned()
            .unwrap()
    };
    for label in ["10K", "Half"] {
        let missing = by_label("Run", label);
        assert_eq!(
            (missing.value, missing.time, missing.activity_id),
            (None, None, None)
        );
    }
    let one_k = by_label("Run", "1K");
    assert_eq!(
        (one_k.time, one_k.activity_id.as_deref()),
        (Some(222.0), Some("b"))
    );
    let five_minutes = by_label("Ride", "5m");
    assert_eq!((five_minutes.value, five_minutes.activity_id), (None, None));
    assert_eq!(by_label("Ride", "1m").value, Some(500.0));
}

#[test]
fn a_half_stored_as_a_rounded_distance_keeps_its_best() {
    let engine = PersistentEngine::in_memory().unwrap();
    let run = r#"{"list": [{
        "distance": [21098],
        "values": [5860],
        "activity_id": ["e"]
    }]}"#;
    engine
        .set_curve_body(CurveKind::Pace, "Run", ALL_TIME, false, run)
        .unwrap();

    let data = read(&engine, ALL_TIME);
    let half = sport(&data, "Run")
        .efforts
        .iter()
        .find(|e| e.label == "Half")
        .unwrap();
    assert_eq!(half.time, Some(5860.0));
    assert_eq!(half.activity_id.as_deref(), Some("e"));
    assert!((half.value.unwrap() - 21098.0 / 5860.0).abs() < 1e-12);
}

#[test]
fn only_a_corrected_track_ranks_and_the_rest_are_counted_as_excluded() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    climbed(&mut engine, "corrected", "Ride", 10.0, 3);
    climbed(&mut engine, "device", "Ride", 30.0, 4);
    climbed(&mut engine, "unknown", "Ride", 40.0, 5);
    climbed(&mut engine, "phone", "Ride", 50.0, 6);
    climbed(&mut engine, "trainer", "VirtualRide", 60.0, 3);
    set_source(&engine, "device", ELEVATION_SOURCE_DEVICE);
    set_source(&engine, "unknown", ELEVATION_SOURCE_UNKNOWN);
    set_source(&engine, "phone", ELEVATION_SOURCE_RECORDED);

    let data = read(&engine, SEASON);
    let ride = climbing(&data, "Ride");
    assert_eq!(fifteen_seconds(ride).1.as_deref(), Some("corrected"));
    assert_eq!(ride.source_excluded, 3);
}

#[test]
fn a_family_with_no_corrected_track_has_no_best_and_a_count() {
    let _serial = crate::test_globals::serial_global_state();
    let mut engine = PersistentEngine::in_memory().unwrap();
    climbed(&mut engine, "device", "Ride", 30.0, 4);
    climbed(&mut engine, "old-device", "Ride", 30.0, 400);
    set_source(&engine, "device", ELEVATION_SOURCE_DEVICE);
    set_source(&engine, "old-device", ELEVATION_SOURCE_DEVICE);

    let data = read(&engine, SEASON);
    let ride = climbing(&data, "Ride");
    assert_eq!(fifteen_seconds(ride), (None, None));
    assert_eq!(ride.source_excluded, 1);
    assert_eq!(climbing(&data, "Run").source_excluded, 0);
    assert_all_finite(&data);
}
