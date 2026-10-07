//! The lap delta curves against a synthetic straight 1,000 m section, with
//! every lap sampled once a second the way a recorded stream is.

use super::*;
use crate::persistence::fitness::performances::laps;
use crate::{FfiLapDeltaMissingReason, FfiReferenceSource, GpsPoint, SectionPerformanceResult};

const LENGTH: f64 = 1000.0;
const DAY: i64 = 86_400;
const FIRST_DAY: i64 = 1_700_000_000;

fn metres_per_degree() -> f64 {
    crate::persistence::haversine_distance_meters(46.0, 7.0, 46.01, 7.0) / 0.01
}

fn at(metres: f64) -> GpsPoint {
    GpsPoint {
        latitude: 46.0 + metres / metres_per_degree(),
        longitude: 7.0,
        elevation: None,
    }
}

/// The section's line, a vertex every 50 m.
fn line() -> Vec<GpsPoint> {
    (0..=20).map(|i| at(i as f64 * 50.0)).collect()
}

/// A ride over `[from, to]` of the section, sampled once a second. `speed`
/// gives the speed in m/s at a distance along the direction of travel, and a
/// reverse ride runs from `to` back to `from`. The last sample sits on `to`,
/// at the nearest whole second, the way a stream's clock reads.
fn ride(
    from: f64,
    to: f64,
    reverse: bool,
    speed: impl Fn(f64) -> f64,
) -> (Vec<GpsPoint>, Vec<u32>) {
    let mut travelled = 0.0;
    let mut clock = 0.0;
    let mut samples = vec![(0.0, 0.0)];
    let span = to - from;
    while travelled < span {
        let step = speed(travelled);
        let next = (travelled + step).min(span);
        clock += (next - travelled) / step;
        travelled = next;
        samples.push((travelled, clock));
    }
    let track = samples
        .iter()
        .map(|(d, _)| at(if reverse { to - d } else { from + d }))
        .collect();
    let times = samples.iter().map(|(_, t)| t.round() as u32).collect();
    (track, times)
}

fn steady(_: f64) -> f64 {
    4.0
}

fn fades_after_halfway(travelled: f64) -> f64 {
    if travelled < 500.0 { 4.0 } else { 3.2 }
}

/// One lap of an activity, with the ride it was cut from.
struct Lap {
    id: &'static str,
    day: i64,
    direction: &'static str,
    ride: (Vec<GpsPoint>, Vec<u32>),
    coverage: f64,
}

impl Lap {
    fn new(
        id: &'static str,
        day: i64,
        direction: &'static str,
        ride: (Vec<GpsPoint>, Vec<u32>),
    ) -> Self {
        Lap {
            id,
            day,
            direction,
            ride,
            coverage: 1.0,
        }
    }

    fn time(&self) -> f64 {
        *self.ride.1.last().unwrap() as f64
    }
}

fn performances(laps_in: &[Lap]) -> SectionPerformanceResult {
    let portions = laps_in
        .iter()
        .map(|lap| laps::Portion {
            activity_id: lap.id.to_string(),
            direction: lap.direction.to_string(),
            start_index: 0,
            end_index: lap.ride.0.len() as u32,
            distance_meters: LENGTH * lap.coverage,
            lap_time: Some(lap.time()),
            lap_pace: Some(LENGTH * lap.coverage / lap.time()),
            avg_hr: None,
            avg_power: None,
            coverage: Some(lap.coverage),
            excluded: false,
        })
        .collect();
    laps::performances(
        LENGTH,
        portions,
        |id| {
            laps_in
                .iter()
                .find(|lap| lap.id == id)
                .map(|lap| (lap.id.to_string(), FIRST_DAY + lap.day * DAY))
        },
        |_| None,
    )
}

fn curves_of(laps_in: &[Lap], reference_set: Option<&str>) -> Option<crate::FfiSectionLapCurves> {
    let perf = performances(laps_in);
    lap_curves(
        &line(),
        &perf,
        reference_set,
        |id| {
            laps_in
                .iter()
                .find(|l| l.id == id)
                .map(|l| l.ride.0.clone())
        },
        |id| {
            laps_in
                .iter()
                .find(|l| l.id == id)
                .map(|l| l.ride.1.clone())
        },
    )
}

fn lap<'a>(deltas: &'a crate::FfiDirectionDeltas, id: &str) -> &'a crate::FfiLapDelta {
    deltas
        .laps
        .iter()
        .find(|l| l.activity_id == id)
        .unwrap_or_else(|| panic!("{id} has a curve"))
}

fn assert_near(actual: f32, expected: f64, tolerance: f64, what: &str) {
    assert!(
        (actual as f64 - expected).abs() <= tolerance,
        "{what}: {actual} is not within {tolerance} of {expected}"
    );
}

fn reference_and_fading() -> Vec<Lap> {
    vec![
        Lap::new("steady", 0, "same", ride(0.0, LENGTH, false, steady)),
        Lap::new(
            "fading",
            1,
            "same",
            ride(0.0, LENGTH, false, fades_after_halfway),
        ),
    ]
}

/// Scenario: the record runs a steady 4 m/s and an attempt holds that to
/// halfway, then drops to 3.2 m/s.
///
/// Expected behaviour: the attempt is level with the record to 500 m and loses
/// 100 / 3.2 - 100 / 4 = 6.25 s over each 100 m after, 31.25 s in all.
#[test]
fn an_attempt_that_fades_at_halfway_loses_its_time_over_the_second_half() {
    let curves = curves_of(&reference_and_fading(), None).expect("curves");
    assert_eq!(curves.grid_step_m, 10.0);
    assert_eq!(curves.split_step_m, 100.0);
    assert!((curves.section_length_m - LENGTH).abs() < 0.01);
    assert!(curves.reverse.is_none(), "no lap ran the reverse way");

    let forward = curves.forward.as_ref().expect("forward deltas");
    assert_eq!(forward.reference_activity_id, "steady");
    assert_eq!(forward.reference_source, FfiReferenceSource::Record);
    assert!(forward.missing.is_empty());

    let fading = lap(forward, "fading");
    assert_eq!(fading.start_index, 0);
    assert_eq!(fading.activity_date, (FIRST_DAY + DAY) as f64);
    assert_eq!(
        fading.delta_secs.len(),
        101,
        "a point every 10 m, both ends"
    );
    for (k, delta) in fading.delta_secs.iter().enumerate().take(51) {
        assert_near(*delta, 0.0, 0.5, &format!("delta at {} m", k * 10));
    }
    assert_near(fading.delta_secs[60], 6.25, 0.5, "delta at 600 m");
    assert_near(fading.delta_secs[100], 31.25, 0.5, "delta at 1,000 m");
    assert_near(
        fading
            .end_delta_secs
            .expect("a full lap quotes an end delta"),
        31.25,
        0.5,
        "end delta",
    );

    assert_eq!(fading.split_delta_secs.len(), 10);
    for (bin, split) in fading.split_delta_secs.iter().enumerate() {
        let expected = if bin < 5 { 0.0 } else { 6.25 };
        assert_near(*split, expected, 0.5, &format!("split {bin}"));
    }

    let steady = lap(forward, "steady");
    assert!(
        steady.delta_secs.iter().all(|d| *d == 0.0),
        "the reference is level with itself"
    );
}

/// Scenario: the same two rides recorded the other way along the section.
///
/// Expected behaviour: the reverse laps run their own axis from the far end,
/// so the attempt's curve and splits are the forward ones, in travel order.
#[test]
fn a_reverse_attempt_has_the_forward_curve_on_the_reverse_axis() {
    let mut laps_in = reference_and_fading();
    laps_in.push(Lap::new(
        "steady-back",
        2,
        "reverse",
        ride(0.0, LENGTH, true, steady),
    ));
    laps_in.push(Lap::new(
        "fading-back",
        3,
        "reverse",
        ride(0.0, LENGTH, true, fades_after_halfway),
    ));
    let curves = curves_of(&laps_in, None).expect("curves");
    let forward = curves.forward.as_ref().expect("forward deltas");
    let reverse = curves.reverse.as_ref().expect("reverse deltas");
    assert_eq!(reverse.reference_activity_id, "steady-back");
    assert!(
        reverse
            .laps
            .iter()
            .all(|l| l.activity_id.ends_with("-back"))
    );
    assert!(
        forward
            .laps
            .iter()
            .all(|l| !l.activity_id.ends_with("-back"))
    );

    let there = lap(forward, "fading");
    let back = lap(reverse, "fading-back");
    assert_eq!(there.delta_secs.len(), back.delta_secs.len());
    for (k, (a, b)) in there.delta_secs.iter().zip(&back.delta_secs).enumerate() {
        assert!(
            (a - b).abs() < 1e-3,
            "delta at {} m: {a} forward, {b} reverse",
            k * 10
        );
    }
    for (bin, (a, b)) in there
        .split_delta_secs
        .iter()
        .zip(&back.split_delta_secs)
        .enumerate()
    {
        assert!(
            (a - b).abs() < 1e-3,
            "split {bin}: {a} forward, {b} reverse"
        );
    }
    assert_near(
        back.end_delta_secs.expect("end delta"),
        31.25,
        0.5,
        "reverse end delta",
    );
}

/// Scenario: a lap joins the section 300 m in and rides to its end.
///
/// Expected behaviour: its curve starts at 300 m, level with the reference
/// there, is NaN before it, and quotes no whole-section number.
#[test]
fn a_lap_joining_partway_is_drawn_from_where_it_joined_and_quotes_no_end_delta() {
    let mut laps_in = reference_and_fading();
    let mut joined = Lap::new("joined", 2, "same", ride(300.0, LENGTH, false, |_| 3.5));
    joined.coverage = 0.7;
    laps_in.push(joined);
    let curves = curves_of(&laps_in, None).expect("curves");
    let forward = curves.forward.as_ref().expect("forward deltas");
    assert_eq!(
        forward.reference_activity_id, "steady",
        "a partial lap is never the record"
    );

    let joined = lap(forward, "joined");
    assert!(
        joined.delta_secs[..30].iter().all(|d| d.is_nan()),
        "nothing before it joined"
    );
    assert_eq!(joined.delta_secs[30], 0.0, "re-zeroed where it joined");
    // 700 m at 3.5 m/s against 700 m at 4 m/s.
    assert_near(joined.delta_secs[100], 25.0, 0.5, "delta at 1,000 m");
    assert_eq!(joined.end_delta_secs, None);
    assert!(
        joined.split_delta_secs[..3].iter().all(|s| s.is_nan()),
        "bins it never rode"
    );
    assert!(joined.split_delta_secs[3..].iter().all(|s| s.is_finite()));
}

/// Scenario: one lap's stored stream is a point longer than its track, and
/// another activity has no stream at all.
///
/// Expected behaviour: neither is drawn, least of all as a flat zero, and
/// each is listed as missing with its reason.
#[test]
fn a_lap_with_no_usable_clock_is_missing_not_drawn() {
    let mut laps_in = reference_and_fading();
    let mut long = Lap::new("long-stream", 2, "same", ride(0.0, LENGTH, false, steady));
    long.ride.1.push(999);
    laps_in.push(long);
    let unstreamed = Lap::new("no-stream", 3, "same", ride(0.0, LENGTH, false, steady));
    laps_in.push(unstreamed);

    let perf = performances(&laps_in);
    let curves = lap_curves(
        &line(),
        &perf,
        None,
        |id| {
            laps_in
                .iter()
                .find(|l| l.id == id)
                .map(|l| l.ride.0.clone())
        },
        |id| {
            (id != "no-stream")
                .then(|| {
                    laps_in
                        .iter()
                        .find(|l| l.id == id)
                        .map(|l| l.ride.1.clone())
                })
                .flatten()
        },
    )
    .expect("curves");
    let forward = curves.forward.as_ref().expect("forward deltas");
    assert!(
        forward
            .laps
            .iter()
            .all(|l| l.activity_id != "long-stream" && l.activity_id != "no-stream")
    );
    let reason = |id: &str| {
        forward
            .missing
            .iter()
            .find(|m| m.activity_id == id)
            .map(|m| m.reason)
    };
    assert_eq!(
        reason("long-stream"),
        Some(FfiLapDeltaMissingReason::MisalignedTimeStream)
    );
    assert_eq!(
        reason("no-stream"),
        Some(FfiLapDeltaMissingReason::NoTimeStream)
    );
}

/// Scenario: the athlete set the fading attempt as the section's reference.
///
/// Expected behaviour: it is the reference, marked as the athlete's, and the
/// record's curve runs below zero, gaining the time the fade lost.
#[test]
fn a_reference_the_athlete_set_replaces_the_record() {
    let curves = curves_of(&reference_and_fading(), Some("fading")).expect("curves");
    let forward = curves.forward.as_ref().expect("forward deltas");
    assert_eq!(forward.reference_activity_id, "fading");
    assert_eq!(forward.reference_source, FfiReferenceSource::AthleteSet);
    let steady = lap(forward, "steady");
    assert_near(
        steady.end_delta_secs.expect("end delta"),
        -31.25,
        0.5,
        "the record's end delta",
    );
}

/// Scenario: the athlete set as reference an activity with no full lap in a
/// direction, or one with no lap on the section at all.
///
/// Expected behaviour: that direction falls back to the record.
#[test]
fn a_reference_with_no_full_lap_falls_back_to_the_record() {
    let mut laps_in = reference_and_fading();
    let mut joined = Lap::new("joined", 2, "same", ride(300.0, LENGTH, false, steady));
    joined.coverage = 0.7;
    laps_in.push(joined);
    for set in ["joined", "elsewhere"] {
        let curves = curves_of(&laps_in, Some(set)).expect("curves");
        let forward = curves.forward.as_ref().expect("forward deltas");
        assert_eq!(forward.reference_activity_id, "steady", "set to {set}");
        assert_eq!(
            forward.reference_source,
            FfiReferenceSource::Record,
            "set to {set}"
        );
    }
}

/// Scenario: a direction holds only its reference, over the whole record or
/// inside the chosen range.
///
/// Expected behaviour: there is nothing to compare, so that direction is
/// `None`, and with neither direction holding a comparison so is the whole.
#[test]
fn a_direction_holding_only_its_reference_has_no_deltas() {
    let alone = [Lap::new(
        "steady",
        0,
        "same",
        ride(0.0, LENGTH, false, steady),
    )];
    assert!(curves_of(&alone, None).is_none());

    let mut laps_in = reference_and_fading();
    laps_in.push(Lap::new(
        "steady-back",
        30,
        "reverse",
        ride(0.0, LENGTH, true, steady),
    ));
    let whole = curves_of(&laps_in, None).expect("curves");
    assert!(whole.forward.is_some());
    assert!(
        whole.reverse.is_none(),
        "the reverse way holds only its reference"
    );

    let after_both = FIRST_DAY + 2 * DAY;
    assert!(
        in_range(&whole, after_both).is_none(),
        "the range holds no forward attempt"
    );
    let ranged = in_range(&whole, FIRST_DAY + DAY).expect("the fading attempt is in range");
    let forward = ranged.forward.as_ref().expect("forward deltas");
    assert_eq!(
        forward.reference_activity_id, "steady",
        "the reference is the whole record's"
    );
    assert_eq!(forward.laps.len(), 1);
    assert_eq!(forward.laps[0].activity_id, "fading");
}

mod stored {
    //! The bundle read through SQLite: the ledger names the reference, and
    //! the curves are computed once for every range.

    use super::*;
    use crate::persistence::PersistentEngine;
    use crate::persistence::sections::history::{KIND_REFERENCE_RESET, KIND_REFERENCE_SET};

    fn engine_with(path: &str, laps_in: &[Lap]) -> PersistentEngine {
        let mut engine = PersistentEngine::new(path).expect("engine");
        for lap in laps_in {
            engine
                .add_activity(lap.id.into(), lap.ride.0.clone(), "Ride".into())
                .expect("activity");
            engine
                .set_activity_metrics(vec![crate::types::ActivityMetrics {
                    activity_id: lap.id.into(),
                    name: lap.id.into(),
                    date: FIRST_DAY + lap.day * DAY,
                    distance: LENGTH,
                    moving_time: lap.time() as u32,
                    elapsed_time: lap.time() as u32,
                    elevation_gain: 0.0,
                    avg_hr: None,
                    avg_power: None,
                    sport_type: "Ride".into(),
                    training_load: None,
                    ftp: None,
                    power_zone_times: None,
                    hr_zone_times: None,
                }])
                .expect("metrics");
            engine
                .db
                .execute(
                    "INSERT OR REPLACE INTO time_streams (activity_id, times, point_count)
                     VALUES (?1, ?2, ?3)",
                    rusqlite::params![
                        lap.id,
                        crate::persistence::codec::serialize(&lap.ride.1).expect("times"),
                        lap.ride.1.len() as i64
                    ],
                )
                .expect("stream");
        }
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, disabled, version, source_activity_id)
                 VALUES ('climb', 'auto', 'Climb', 'Ride', ?1, ?2, 0, 1, NULL)",
                rusqlite::params![serde_json::to_string(&line()).expect("line"), LENGTH],
            )
            .expect("section");
        for lap in laps_in {
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                         start_index, end_index, distance_meters, lap_time, lap_pace,
                         coverage, excluded)
                     VALUES ('climb', ?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, 0)",
                    rusqlite::params![
                        lap.id,
                        lap.direction,
                        lap.ride.0.len() as i64,
                        LENGTH * lap.coverage,
                        lap.time(),
                        LENGTH * lap.coverage / lap.time(),
                        lap.coverage
                    ],
                )
                .expect("lap");
        }
        engine
    }

    fn bundle(days: u32) -> crate::FfiSectionPerformanceData {
        crate::persistence::read_pool::with_read_conn(|conn| {
            crate::persistence::screens::pooled::section_detail_performance(
                conn, "climb", days, None,
            )
        })
        .expect("reader")
    }

    fn reference_of(data: &crate::FfiSectionPerformanceData) -> (String, FfiReferenceSource) {
        let forward = data
            .curves
            .as_ref()
            .and_then(|c| c.forward.as_ref())
            .expect("forward deltas");
        (
            forward.reference_activity_id.clone(),
            forward.reference_source,
        )
    }

    /// Scenario: the athlete sets the slower attempt as the reference, then
    /// hands the reference back to detection.
    ///
    /// Expected behaviour: the newest of the two ledger rows decides, so the
    /// attempt leads while the set row is newest and the record after the
    /// reset.
    #[test]
    fn the_newest_reference_row_in_the_ledger_names_the_reference() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_curves_ledger.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let mut engine = engine_with(db_path, &reference_and_fading());

        assert_eq!(
            reference_of(&bundle(0)),
            ("steady".into(), FfiReferenceSource::Record)
        );

        engine
            .append_section_history(
                "climb",
                KIND_REFERENCE_SET,
                Some(r#"{"activity_id":"fading"}"#),
                None,
            )
            .expect("set row");
        let set = bundle(0);
        assert_eq!(
            reference_of(&set),
            ("fading".into(), FfiReferenceSource::AthleteSet)
        );
        let record = set
            .curves
            .as_ref()
            .and_then(|c| c.forward.as_ref())
            .and_then(|f| f.laps.iter().find(|l| l.activity_id == "steady"))
            .expect("the record's curve");
        assert!(record.end_delta_secs.expect("end delta") < -30.0);

        engine
            .append_section_history("climb", KIND_REFERENCE_RESET, Some("{}"), None)
            .expect("reset row");
        assert_eq!(
            reference_of(&bundle(0)),
            ("steady".into(), FfiReferenceSource::Record)
        );
    }

    /// Scenario: the section screen opens, then the athlete taps two other
    /// time chips with nothing written in between.
    ///
    /// Expected behaviour: the curves are computed once, decoding each
    /// activity's track and stream once, and each range filters that set.
    #[test]
    fn three_ranges_compute_the_curves_once() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_curves_ranges.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let _engine = engine_with(db_path, &reference_and_fading());

        pooled::reset_test_counters();
        for days in [0, 30, 365] {
            let data = bundle(days);
            // The fixture's rides are years old, so only the whole record holds them.
            assert_eq!(data.curves.is_some(), days == 0, "range of {days} days");
        }
        assert_eq!(
            pooled::computations(),
            1,
            "one computation for three ranges"
        );
        assert_eq!(
            pooled::decodes(),
            4,
            "one track and one stream per activity"
        );
    }
}
