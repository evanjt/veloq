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
    ride_along(
        |d| at(if reverse { to - d } else { from + d }),
        to - from,
        speed,
    )
}

/// A ride of `span` metres along any path, `position` giving the point at a
/// distance travelled, sampled once a second.
fn ride_along(
    position: impl Fn(f64) -> GpsPoint,
    span: f64,
    speed: impl Fn(f64) -> f64,
) -> (Vec<GpsPoint>, Vec<u32>) {
    let mut travelled = 0.0;
    let mut clock = 0.0;
    let mut samples = vec![(0.0, 0.0)];
    while travelled < span {
        let step = speed(travelled);
        let next = (travelled + step).min(span);
        clock += (next - travelled) / step;
        travelled = next;
        samples.push((travelled, clock));
    }
    let track = samples.iter().map(|(d, _)| position(*d)).collect();
    let times = samples.iter().map(|(_, t)| t.round() as u32).collect();
    (track, times)
}

/// The point `north` and `east` metres from the section's start.
fn at_offset(north: f64, east: f64) -> GpsPoint {
    let per_degree = metres_per_degree();
    GpsPoint {
        latitude: 46.0 + north / per_degree,
        longitude: 7.0 + east / (per_degree * 46.0_f64.to_radians().cos()),
        elevation: None,
    }
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
            outside_distance_band: false,
            match_percentage: None,
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
        in_range(&whole, after_both, None).is_none(),
        "the range holds no forward attempt"
    );
    let ranged = in_range(&whole, FIRST_DAY + DAY, None).expect("the fading attempt is in range");
    let forward = ranged.forward.as_ref().expect("forward deltas");
    assert_eq!(
        forward.reference_activity_id, "steady",
        "the reference is the whole record's"
    );
    assert_eq!(forward.laps.len(), 1);
    assert_eq!(forward.laps[0].activity_id, "fading");
}

/// Held forward curves of one lap a curve, the `n`th lap from day `n`, each
/// with its 100 m splits, as the cache keeps them.
fn held_curves(curves: Vec<Vec<f32>>) -> crate::FfiSectionLapCurves {
    let laps = curves
        .into_iter()
        .enumerate()
        .map(|(n, curve)| {
            let splits: Vec<f32> = curve
                .windows(11)
                .step_by(10)
                .map(|w| w[10] - w[0])
                .collect();
            crate::FfiLapDelta {
                activity_id: format!("attempt-{n}"),
                start_index: 0,
                activity_date: (FIRST_DAY + n as i64 * DAY) as f64,
                end_delta_secs: curve.last().copied(),
                delta_secs: curve.into(),
                split_delta_secs: splits.into(),
                split_secs: Vec::new().into(),
            }
        })
        .collect();
    crate::FfiSectionLapCurves {
        grid_step_m: GRID_STEP_M,
        split_step_m: SPLIT_STEP_M,
        section_length_m: 40_000.0,
        forward: compared(
            "attempt-0".to_string(),
            FfiReferenceSource::Record,
            laps,
            Vec::new(),
            None,
            None,
        ),
        reverse: None,
    }
}

/// Curves the shape of a 40 km route of `attempts` attempts: every lap a
/// whole curve on the 10 m grid.
fn long_route_curves(attempts: usize) -> crate::FfiSectionLapCurves {
    held_curves(
        (0..attempts)
            .map(|n| {
                (0..4_001)
                    .map(|k| ((k + n) % 97) as f32 * 0.25 - 12.0)
                    .collect()
            })
            .collect(),
    )
}

/// Scenario: a time chip filters a long route's held curves, fifty attempts
/// of 4,001 grid points each, keeping every one of them.
///
/// Expected behaviour: the kept laps share the held curves rather than
/// copying them, so the filter allocates under a tenth of the bytes the
/// curves lower to.
#[test]
fn a_range_over_held_curves_shares_them_rather_than_copying() {
    let held = long_route_curves(50);
    let lowered: usize = held
        .forward
        .iter()
        .flat_map(|deltas| &deltas.laps)
        .map(|lap| 4 * (lap.delta_secs.len() + lap.split_delta_secs.len()))
        .sum();
    assert!(
        lowered > 800_000,
        "the fixture is a long route: {lowered} B"
    );

    let (ranged, count, bytes) =
        crate::test_alloc::allocated_by(|| in_range(&held, FIRST_DAY, None));
    let ranged = ranged.expect("every attempt is in range");
    assert_eq!(ranged.forward.as_ref().expect("forward").laps.len(), 50);
    assert!(
        bytes < lowered / 10,
        "in_range allocated {bytes} B in {count} allocations for {lowered} B of curves"
    );
}

/// Scenario: the plot scales its y axis to the largest delta among the laps
/// it draws, and a range drops the lap that reached it.
///
/// Expected behaviour: each direction carries that peak as an absolute value,
/// over finite deltas only, and a range carries the peak of the laps it kept.
#[test]
fn a_direction_carries_the_peak_of_the_laps_it_holds() {
    let held = held_curves(vec![
        vec![0.0, 2.0, 5.0],
        vec![0.0, -20.0, f32::NAN],
        vec![0.0, 8.0, -3.0],
    ]);
    let peak = |curves: &crate::FfiSectionLapCurves| {
        curves.forward.as_ref().expect("forward").peak_delta_secs
    };
    assert_eq!(peak(&held), 20.0);
    assert_eq!(peak(&in_range(&held, FIRST_DAY, None).expect("all")), 20.0);
    assert_eq!(
        peak(&in_range(&held, FIRST_DAY + 2 * DAY, None).expect("newest")),
        8.0
    );

    let computed = curves_of(&reference_and_fading(), None).expect("curves");
    let forward = computed.forward.as_ref().expect("forward deltas");
    let largest = forward
        .laps
        .iter()
        .flat_map(|lap| lap.delta_secs.iter())
        .filter(|delta| delta.is_finite())
        .fold(0.0_f32, |peak, delta| peak.max(delta.abs()));
    assert!(largest > 30.0, "the fading lap loses over 30 s");
    assert_eq!(forward.peak_delta_secs, largest);
}

/// A lap on a 300 m line whose three 100 m splits are `splits`, its curve
/// the running sum of them on the split grid, dated `day`.
fn split_lap(id: &str, start_index: u32, day: i64, splits: [f32; 3]) -> crate::FfiLapDelta {
    let mut curve = vec![0.0_f32];
    for split in splits {
        curve.push(curve.last().unwrap() + split);
    }
    crate::FfiLapDelta {
        activity_id: id.to_string(),
        start_index,
        activity_date: (FIRST_DAY + day * DAY) as f64,
        end_delta_secs: curve.last().copied().filter(|end| end.is_finite()),
        delta_secs: curve.into(),
        split_delta_secs: splits.to_vec().into(),
        split_secs: Vec::new().into(),
    }
}

/// The record, level with itself, and nine laps after it on days 1 to 9. The
/// sixth is a second lap of the record's own activity, and its last split is
/// one it did not cover.
fn record_and_laps(count: usize) -> Vec<crate::FfiLapDelta> {
    let splits: [(&str, u32, [f32; 3]); 9] = [
        ("one", 0, [1.0, 4.0, -2.0]),
        ("two", 0, [3.0, 2.0, 0.0]),
        ("three", 0, [2.0, 6.0, 1.0]),
        ("four", 0, [5.0, 1.0, -1.0]),
        ("five", 0, [4.0, 3.0, 2.0]),
        ("record", 900, [0.0, 5.0, f32::NAN]),
        ("seven", 0, [6.0, 7.0, 3.0]),
        ("eight", 0, [-1.0, 0.0, 4.0]),
        ("nine", 0, [7.0, 8.0, -3.0]),
    ];
    std::iter::once(split_lap("record", 0, 0, [0.0; 3]))
        .chain(
            splits
                .iter()
                .take(count)
                .enumerate()
                .map(|(n, (id, start, s))| split_lap(id, *start, n as i64 + 1, *s)),
        )
        .collect()
}

fn summary_of(laps: Vec<crate::FfiLapDelta>) -> Option<crate::FfiSplitSummary> {
    compared(
        "record".to_string(),
        FfiReferenceSource::Record,
        laps,
        Vec::new(),
        None,
        None,
    )
    .expect("laps beside the record")
    .split_summary
}

fn assert_floats(actual: &crate::FfiFloat32Array, expected: &[f32], what: &str) {
    let same = actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(a, e)| (a.is_nan() && e.is_nan()) || (a - e).abs() < 1e-5);
    assert!(same, "{what}: {:?} is not {expected:?}", &actual[..]);
}

/// Scenario: six laps beside the record on a 300 m line, one of them a
/// second lap of the record's own activity and one split it did not cover.
///
/// Expected behaviour: each split's median is the hand median over the laps
/// other than the record, counting only the laps that cover it, and the
/// quartiles stay NaN under eight laps.
#[test]
fn a_direction_carries_the_typical_lap_per_split_without_the_record() {
    let summary = summary_of(record_and_laps(6)).expect("five laps reach a median");
    assert_eq!(summary.laps, vec![6, 6, 5]);
    assert_floats(&summary.median_secs, &[2.5, 3.5, 0.0], "median");
    assert_floats(&summary.lower_quartile_secs, &[f32::NAN; 3], "lower");
    assert_floats(&summary.upper_quartile_secs, &[f32::NAN; 3], "upper");
}

/// Scenario: five laps beside the record, the last split covered by four.
///
/// Expected behaviour: the split under five laps has no median while the two
/// covered by five do.
#[test]
fn a_split_under_five_laps_has_no_typical_lap() {
    let mut laps = record_and_laps(6);
    laps.remove(1);
    let summary = summary_of(laps).expect("two splits reach a median");
    assert_eq!(summary.laps, vec![5, 5, 4]);
    assert_floats(&summary.median_secs, &[3.0, 3.0, f32::NAN], "median");
}

/// Scenario: four laps beside the record, and a direction of one lap.
///
/// Expected behaviour: no split reaches five laps, so neither carries a
/// summary.
#[test]
fn a_direction_under_five_laps_carries_no_summary() {
    assert!(summary_of(record_and_laps(4)).is_none());
    let computed = curves_of(&reference_and_fading(), None).expect("curves");
    assert!(computed.forward.expect("forward").split_summary.is_none());
}

/// Scenario: nine laps beside the record, the last split covered by eight.
///
/// Expected behaviour: the quartiles are finite at eight laps, linearly
/// interpolated between the order statistics either side.
#[test]
fn eight_laps_give_a_split_its_quartiles() {
    let summary = summary_of(record_and_laps(9)).expect("summary");
    assert_eq!(summary.laps, vec![9, 9, 8]);
    assert_floats(&summary.median_secs, &[3.0, 4.0, 0.5], "median");
    assert_floats(&summary.lower_quartile_secs, &[1.0, 2.0, -1.25], "lower");
    assert_floats(&summary.upper_quartile_secs, &[5.0, 6.0, 2.25], "upper");
}

/// Scenario: a time chip keeps the four newest of six laps.
///
/// Expected behaviour: the summary follows the range, so the kept laps are
/// too few for one.
#[test]
fn a_range_carries_the_summary_of_the_laps_it_keeps() {
    let held = crate::FfiSectionLapCurves {
        grid_step_m: SPLIT_STEP_M,
        split_step_m: SPLIT_STEP_M,
        section_length_m: 300.0,
        forward: compared(
            "record".to_string(),
            FfiReferenceSource::Record,
            record_and_laps(6),
            Vec::new(),
            None,
            None,
        ),
        reverse: None,
    };
    assert!(
        held.forward
            .as_ref()
            .expect("forward")
            .split_summary
            .is_some()
    );
    let all = in_range(&held, FIRST_DAY, None).expect("all");
    assert_eq!(
        all.forward
            .expect("forward")
            .split_summary
            .expect("summary")
            .laps,
        vec![6, 6, 5]
    );
    let newest = in_range(&held, FIRST_DAY + 3 * DAY, None).expect("four laps");
    assert!(newest.forward.expect("forward").split_summary.is_none());
}

/// The curve type crosses the bridge as its values' little-endian bytes and
/// comes back the same, NaN gaps included, and refuses a partial float.
#[test]
fn a_curve_crosses_the_bridge_as_little_endian_floats() {
    let curve = crate::FfiFloat32Array::from(vec![1.5, -0.25, f32::NAN, 40_000.0]);
    let bytes = curve.to_le_bytes();
    assert_eq!(bytes.len(), 16);
    assert_eq!(&bytes[..4], &1.5_f32.to_le_bytes());
    assert_eq!(&bytes[4..8], &(-0.25_f32).to_le_bytes());

    let back = crate::FfiFloat32Array::from_le_bytes(&bytes).expect("whole floats");
    assert_eq!(back.len(), 4);
    assert_eq!(back[0], 1.5);
    assert_eq!(back[1], -0.25);
    assert!(back[2].is_nan());
    assert_eq!(back[3], 40_000.0);
    assert!(crate::FfiFloat32Array::from_le_bytes(&bytes[..15]).is_none());
    assert!(
        crate::FfiFloat32Array::from_le_bytes(&[])
            .expect("empty")
            .is_empty()
    );
}

/// A 1,000 m square loop, 250 m a side, from its start corner north, east,
/// south and west back to the start.
fn square(d: f64) -> GpsPoint {
    let d = d.clamp(0.0, LENGTH);
    match (d / 250.0) as u32 {
        0 => at_offset(d, 0.0),
        1 => at_offset(250.0, d - 250.0),
        2 => at_offset(750.0 - d, 250.0),
        _ => at_offset(0.0, LENGTH - d),
    }
}

/// Out 500 m north and back down the same road to the start.
fn out_and_back(d: f64) -> GpsPoint {
    at(if d <= 500.0 { d } else { LENGTH - d })
}

/// A whole-line lap along `path`, as a route attempt is: the line is the
/// path itself, with a vertex every 50 m, and the activity's first sample sits
/// `start_east` metres east of the start, the way a watch starts a stride off
/// the line.
fn whole_line_curves(
    path: fn(f64) -> GpsPoint,
    start_east: f64,
) -> Option<crate::FfiSectionLapCurves> {
    let line: Vec<GpsPoint> = (0..=20).map(|i| path(i as f64 * 50.0)).collect();
    let nudged = |speed: fn(f64) -> f64| {
        let (mut track, times) = ride_along(path, LENGTH, speed);
        track[0] = at_offset(0.0, start_east);
        (track, times)
    };
    let laps_in = vec![
        Lap::new("steady", 0, "same", nudged(steady)),
        Lap::new("fading", 1, "same", nudged(fades_after_halfway)),
    ];
    let perf = performances(&laps_in);
    lap_curves(
        &line,
        &perf,
        None,
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

fn assert_fades_over_the_second_half(curves: Option<crate::FfiSectionLapCurves>, what: &str) {
    let curves = curves.unwrap_or_else(|| panic!("{what}: curves"));
    assert!((curves.section_length_m - LENGTH).abs() < 0.01, "{what}");
    let forward = curves.forward.as_ref().expect("forward deltas");
    assert_eq!(forward.reference_activity_id, "steady", "{what}");
    assert!(forward.missing.is_empty(), "{what}: {:?}", forward.missing);
    let fading = lap(forward, "fading");
    for (k, delta) in fading.delta_secs.iter().enumerate().take(51) {
        assert_near(*delta, 0.0, 0.5, &format!("{what}: delta at {} m", k * 10));
    }
    assert_near(
        fading.delta_secs[75],
        15.625,
        0.5,
        &format!("{what}: delta at 750 m"),
    );
    assert_near(
        fading
            .end_delta_secs
            .expect("a full lap quotes an end delta"),
        31.25,
        0.5,
        &format!("{what}: end delta"),
    );
}

/// Scenario: a route that is a loop, its start and finish on one corner, and
/// two attempts whose first sample lands 2 m along the closing side, nearer
/// the line's end than its start.
///
/// Expected behaviour: each attempt starts at the start of the line rather
/// than its end, so the fade is drawn over the second half as on a straight.
#[test]
fn a_loop_attempt_starting_beside_the_finish_is_measured_from_the_start() {
    assert_fades_over_the_second_half(whole_line_curves(square, 2.0), "loop");
}

/// Scenario: a route out along a road and back down it, every point of the
/// return leg on a point of the way out.
///
/// Expected behaviour: the return leg is placed on the line's second half by
/// where the attempt has come from, so the fade on the way back is drawn there.
#[test]
fn an_out_and_back_attempt_follows_the_line_down_the_return_leg() {
    assert_fades_over_the_second_half(whole_line_curves(out_and_back, 0.0), "out and back");
}

/// Out 20 km north and back down the same road, the shape that makes a point
/// weigh two passes of the line.
fn long_out_and_back(d: f64) -> GpsPoint {
    at(if d <= 20_000.0 { d } else { 40_000.0 - d })
}

/// Scenario: a route of 4,001 points, out 20 km and back, with 50 attempts
/// of 4,001 samples or more, ridden up to 30 m beside the line so the search for
/// a second pass widens past its first ring.
///
/// Expected behaviour: projecting the samples allocates nothing per sample.
/// The computation allocates a bounded number of times per attempt, and no
/// more bytes than a small multiple of the tracks and streams it is handed.
#[test]
fn projecting_a_long_route_allocates_per_attempt_not_per_sample() {
    const ATTEMPTS: usize = 50;
    let line: Vec<GpsPoint> = (0..=4_000)
        .map(|i| long_out_and_back(i as f64 * 10.0))
        .collect();
    let laps_in: Vec<Lap> = (0..ATTEMPTS)
        .map(|n| {
            let east = (n % 7) as f64 * 5.0;
            let speed = 10.0 - n as f64 * 0.01;
            let (track, times) = ride_along(
                |d| {
                    let on = long_out_and_back(d);
                    at_offset(
                        (on.latitude - 46.0) * metres_per_degree(),
                        east * (d / 1000.0).sin(),
                    )
                },
                40_000.0,
                |_| speed,
            );
            let id: &'static str = Box::leak(format!("attempt-{n}").into_boxed_str());
            Lap::new(id, n as i64, "same", (track, times))
        })
        .collect();
    assert!(laps_in.iter().all(|lap| lap.ride.0.len() >= 4_001));
    let perf = performances(&laps_in);
    let handed_in: usize = laps_in
        .iter()
        .map(|lap| {
            lap.ride.0.len() * std::mem::size_of::<GpsPoint>()
                + lap.ride.1.len() * std::mem::size_of::<u32>()
        })
        .sum();

    let (curves, allocations, bytes) = crate::test_alloc::allocated_by(|| {
        lap_curves(
            &line,
            &perf,
            None,
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
    });

    let curves = curves.expect("curves");
    let forward = curves.forward.as_ref().expect("forward deltas");
    assert_eq!(forward.laps.len(), ATTEMPTS, "{:?}", forward.missing);
    assert!(
        allocations < ATTEMPTS * 64,
        "{allocations} allocations for {ATTEMPTS} attempts"
    );
    assert!(
        bytes < 8 * handed_in,
        "{bytes} bytes allocated for {handed_in} bytes of tracks and streams"
    );
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

    /// The section screen's own read, which serves the curves only once held.
    fn section_screen_read(days: u32, sport: Option<&str>) -> crate::FfiSectionPerformanceData {
        crate::persistence::read_pool::with_read_conn(|conn| {
            crate::persistence::screens::pooled::section_detail_performance(
                conn,
                "climb",
                days,
                sport,
                None,
                pooled::CurveRead::Held,
            )
        })
        .expect("reader")
    }

    /// The same read with the curves computed, as the off-thread load runs it.
    fn section_load(days: u32, sport: Option<&str>) -> crate::FfiSectionPerformanceData {
        crate::persistence::read_pool::with_read_conn(|conn| {
            crate::persistence::screens::pooled::section_detail_performance(
                conn,
                "climb",
                days,
                sport,
                None,
                pooled::CurveRead::Computed,
            )
        })
        .expect("reader")
    }

    fn bundle(days: u32) -> crate::FfiSectionPerformanceData {
        section_load(days, None)
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

    /// Scenario: the section screen opens on the record holder, then on an
    /// older attempt.
    ///
    /// Expected behaviour: the read resolves the reference the chart opens on
    /// for the highlighted attempt, from the one cached computation.
    #[test]
    fn the_section_read_opens_the_record_holder_on_the_previous_record() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_curves_default.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let _engine = engine_with(db_path, &four_records());

        let opened_on = |highlight: &str| {
            let data = crate::persistence::read_pool::with_read_conn(|conn| {
                crate::persistence::screens::pooled::section_detail_performance(
                    conn,
                    "climb",
                    0,
                    None,
                    Some(highlight),
                    pooled::CurveRead::Computed,
                )
            })
            .expect("reader");
            let forward = data.curves.and_then(|c| c.forward).expect("forward deltas");
            (
                forward.default_reference,
                forward.previous_record.map(|lap| lap.activity_id),
            )
        };
        assert_eq!(
            opened_on("fourth"),
            (FfiReferenceSource::PreviousRecord, Some("second".into()))
        );
        assert_eq!(
            opened_on("first"),
            (FfiReferenceSource::Record, Some("second".into()))
        );
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

    /// Three Ride attempts as one route, each its whole activity: `steady`
    /// the record, `fading` and `unstreamed` behind it, `unstreamed` with no
    /// stored time stream. `representative` is the route's line, `chosen` whether the
    /// athlete picked it. The route shares its id with the section the
    /// attempts also cross.
    fn route_with(path: &str, representative: &str, chosen: bool) -> PersistentEngine {
        let mut laps_in = reference_and_fading();
        laps_in.push(Lap::new(
            "unstreamed",
            2,
            "same",
            ride(0.0, LENGTH, false, |_| 3.8),
        ));
        let engine = engine_with(path, &laps_in);
        engine
            .db
            .execute(
                "DELETE FROM time_streams WHERE activity_id = 'unstreamed'",
                [],
            )
            .expect("unstreamed");
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                           activity_count, representative_chosen)
                 VALUES ('climb', ?1, '[\"steady\",\"fading\",\"unstreamed\"]', 'Ride', 3, ?2)",
                rusqlite::params![representative, chosen],
            )
            .expect("route");
        for lap in &laps_in {
            engine
                .db
                .execute(
                    "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                     VALUES ('climb', ?1, 100.0, 'same')",
                    rusqlite::params![lap.id],
                )
                .expect("match");
        }
        engine
    }

    fn route_read(days: u32, curves: pooled::CurveRead) -> crate::FfiSectionPerformanceData {
        crate::persistence::read_pool::with_read_conn(|conn| {
            crate::persistence::screens::pooled::route_detail_performance(
                conn, "climb", days, None, None, curves,
            )
        })
        .expect("reader")
    }

    fn route_bundle(days: u32) -> crate::FfiSectionPerformanceData {
        route_read(days, pooled::CurveRead::Computed)
    }

    /// Scenario: a route of three Ride attempts, one of them with no time
    /// stream, its line the record's own activity.
    ///
    /// Expected behaviour: the route read carries one curve per streamed
    /// attempt, measured along the line against the record, lists the
    /// unstreamed attempt as missing its stream, and computes the curves once
    /// for every range.
    #[test]
    fn a_route_measures_each_attempt_against_its_record() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_curves_route.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let _engine = route_with(db_path, "steady", false);

        pooled::reset_test_counters();
        let data = route_bundle(0);
        let curves = data.curves.as_ref().expect("the route carries curves");
        assert!((curves.section_length_m - LENGTH).abs() < 0.5);
        assert!(curves.reverse.is_none());
        let forward = curves.forward.as_ref().expect("forward deltas");
        assert_eq!(
            (
                forward.reference_activity_id.as_str(),
                forward.reference_source
            ),
            ("steady", FfiReferenceSource::Record)
        );
        let drawn: Vec<&str> = forward
            .laps
            .iter()
            .map(|l| l.activity_id.as_str())
            .collect();
        assert_eq!(
            drawn,
            ["steady", "fading"],
            "one curve per streamed attempt"
        );
        assert_near(
            lap(forward, "fading")
                .end_delta_secs
                .expect("a whole attempt quotes an end delta"),
            31.25,
            0.5,
            "the fading attempt's end delta",
        );
        let missing: Vec<(&str, FfiLapDeltaMissingReason)> = forward
            .missing
            .iter()
            .map(|m| (m.activity_id.as_str(), m.reason))
            .collect();
        assert_eq!(
            missing,
            [("unstreamed", FfiLapDeltaMissingReason::NoTimeStream)]
        );

        // The fixture's rides are years old, so only the whole record holds them.
        assert!(route_bundle(30).curves.is_none());
        assert_eq!(pooled::computations(), 1, "one computation for two ranges");
    }

    /// Scenario: the athlete set the fading attempt as the route's
    /// representative, and the section of the same id has been read first.
    ///
    /// Expected behaviour: the representative is the route's reference, marked
    /// as the athlete's, and the record runs ahead of it, rather than the
    /// section's curves being served for the route.
    #[test]
    fn a_representative_the_athlete_chose_is_the_route_reference() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_curves_route_chosen.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let engine = route_with(db_path, "fading", true);

        assert_eq!(
            reference_of(&bundle(0)),
            ("steady".into(), FfiReferenceSource::Record),
            "the section has no reference set"
        );
        let data = route_bundle(0);
        let forward = data
            .curves
            .as_ref()
            .and_then(|c| c.forward.as_ref())
            .expect("forward deltas");
        assert_eq!(
            (
                forward.reference_activity_id.as_str(),
                forward.reference_source
            ),
            ("fading", FfiReferenceSource::AthleteSet)
        );
        assert_near(
            lap(forward, "steady").end_delta_secs.expect("end delta"),
            -31.25,
            0.5,
            "the record's end delta",
        );

        engine
            .db
            .execute(
                "UPDATE route_groups SET representative_chosen = 0 WHERE id = 'climb'",
                [],
            )
            .expect("reset");
        let reset = route_bundle(0);
        let forward = reset
            .curves
            .as_ref()
            .and_then(|c| c.forward.as_ref())
            .expect("forward deltas");
        assert_eq!(
            (
                forward.reference_activity_id.as_str(),
                forward.reference_source
            ),
            ("steady", FfiReferenceSource::Record),
            "a representative the grouping picked is no reference"
        );
    }

    /// Scenario: the route screen opens, its own read serving the curves only
    /// once held, then the curves are loaded, then a write lands.
    ///
    /// Expected behaviour: the first read says the curves are owed and
    /// computes nothing; once loaded, the screen's read serves them with
    /// nothing owed and computes nothing more; after the write they are owed
    /// again. The section read never leaves its curves owed.
    #[test]
    fn the_route_screen_read_serves_its_curves_only_once_loaded() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_curves_route_held.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let engine = route_with(db_path, "steady", false);

        pooled::reset_test_counters();
        let owed = route_read(0, pooled::CurveRead::Held);
        assert!(owed.curves_pending);
        assert!(owed.curves.is_none());
        assert_eq!(
            pooled::computations(),
            0,
            "the screen's read computes nothing"
        );

        let loaded = route_read(0, pooled::CurveRead::Computed);
        assert!(!loaded.curves_pending);
        assert!(loaded.curves.is_some());

        let held = route_read(0, pooled::CurveRead::Held);
        assert!(!held.curves_pending);
        assert_eq!(
            held.curves
                .as_ref()
                .and_then(|c| c.forward.as_ref())
                .map(|f| f.laps.len()),
            Some(2)
        );
        assert_eq!(pooled::computations(), 1, "loaded once, then served");

        engine
            .db
            .execute(
                "UPDATE activity_metrics SET name = 'renamed' WHERE activity_id = 'fading'",
                [],
            )
            .expect("write");
        assert!(route_read(0, pooled::CurveRead::Held).curves_pending);
    }

    /// Scenario: the section screen opens on a cold cache, then a sport chip
    /// is tapped, then the curves are loaded off the thread, then a write
    /// lands.
    ///
    /// Expected behaviour: the screen's read decodes nothing and says the
    /// curves are owed, under either sport; the load computes them once; the
    /// screen's read then serves them with nothing owed and decodes nothing
    /// more; after the write they are owed again.
    #[test]
    fn the_section_screen_read_serves_its_curves_only_once_loaded() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_curves_section_held.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let engine = engine_with(db_path, &reference_and_fading());

        pooled::reset_test_counters();
        let owed = section_screen_read(0, None);
        assert!(owed.curves_pending);
        assert!(owed.curves.is_none());
        assert!(section_screen_read(0, Some("Ride")).curves_pending);
        assert_eq!(pooled::decodes(), 0, "the screen's read decodes nothing");
        assert_eq!(pooled::computations(), 0);

        let loaded = section_load(0, None);
        assert!(!loaded.curves_pending);
        assert_eq!(
            loaded
                .curves
                .as_ref()
                .and_then(|c| c.forward.as_ref())
                .map(|f| f.laps.len()),
            Some(2)
        );
        assert_eq!(pooled::computations(), 1);
        assert_eq!(
            pooled::decodes(),
            4,
            "one track and one stream per activity"
        );

        let held = section_screen_read(0, None);
        assert!(!held.curves_pending);
        assert_eq!(
            format!("{:?}", held.curves),
            format!("{:?}", loaded.curves),
            "the screen's read serves what the load computed"
        );
        assert!(
            section_screen_read(30, None).curves.is_none(),
            "a range filters the held set"
        );
        assert!(!section_screen_read(30, None).curves_pending);
        assert_eq!(pooled::computations(), 1, "loaded once, then served");
        assert_eq!(pooled::decodes(), 4);

        engine
            .db
            .execute(
                "UPDATE activity_metrics SET name = 'renamed' WHERE activity_id = 'fading'",
                [],
            )
            .expect("write");
        assert!(section_screen_read(0, None).curves_pending);
    }

    /// Scenario: the route screen opens on a route one of whose attempts has
    /// no stored time stream.
    ///
    /// Expected behaviour: the detail read names that attempt, so the screen
    /// fetches its stream before the curves can draw it.
    #[test]
    fn the_route_detail_read_names_the_attempts_missing_a_stream() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("lap_curves_route_missing.db");
        let db_path = path.to_str().expect("utf-8");
        crate::persistence::read_pool::bind(db_path);
        let _engine = route_with(db_path, "steady", false);

        let detail = crate::persistence::read_pool::with_read_conn(|conn| {
            crate::persistence::screens::pooled::route_detail_data(conn, "climb")
        })
        .expect("reader");
        assert_eq!(detail.missing_time_stream_ids, ["unstreamed"]);
    }
}

/// Scenario: the record and an attempt both start 4 m past the section's start
/// and stop 4 m short of its end, the way a recording's first and last fixes
/// fall a few metres inside the line, and a third lap joins 60 m in.
///
/// Expected behaviour: a lap within a grid step and one sample of an end is
/// clocked from that end, so the first and last 100 m splits are drawn, while
/// the lap joining 60 m in still has no first split.
#[test]
fn a_lap_starting_and_ending_a_few_metres_inside_the_line_has_both_end_splits() {
    let inside = |speed: fn(f64) -> f64| ride(4.0, LENGTH - 4.0, false, speed);
    let quick = |_: f64| 5.0;
    let fading = |travelled: f64| if travelled < 500.0 { 5.0 } else { 4.0 };
    let reference = Lap::new("reference", 0, "same", inside(quick));
    let attempt = Lap::new("attempt", 1, "same", inside(fading));
    let lap_time_gap = attempt.time() - reference.time();
    let mut joined = Lap::new(
        "joined",
        2,
        "same",
        ride(60.0, LENGTH - 4.0, false, |_| 3.0),
    );
    joined.coverage = 0.93;
    let curves = curves_of(&[reference, attempt, joined], None).expect("curves");
    let forward = curves.forward.as_ref().expect("forward deltas");
    assert_eq!(forward.reference_activity_id, "reference");

    let attempt = lap(forward, "attempt");
    assert_eq!(attempt.split_delta_secs.len(), 10);
    for (bin, split) in attempt.split_delta_secs.iter().enumerate() {
        assert!(split.is_finite(), "split {bin} is {split}");
    }
    assert_near(attempt.split_delta_secs[0], 0.0, 0.5, "first split");
    assert_near(
        attempt.split_delta_secs[9],
        100.0 / 4.0 - 100.0 / 5.0,
        1.0,
        "last split",
    );
    assert_near(
        attempt
            .end_delta_secs
            .expect("a lap within the slack of both ends is whole"),
        lap_time_gap,
        0.5,
        "end delta",
    );

    let joined = lap(forward, "joined");
    assert!(
        joined.split_delta_secs[0].is_nan(),
        "joined 60 m in, so no first split"
    );
    assert!(joined.split_delta_secs[1..].iter().all(|s| s.is_finite()));
    assert!(joined.end_delta_secs.is_none());
}

/// A steady lap of the whole section in `secs` seconds, ridden on `day`.
fn steady_lap(id: &'static str, day: i64, secs: f64) -> Lap {
    Lap::new(
        id,
        day,
        "same",
        ride(0.0, LENGTH, false, move |_| LENGTH / secs),
    )
}

/// Four attempts in date order: 600 s, a record of 590 s, 595 s, and the
/// record of 580 s that stands.
fn four_records() -> Vec<Lap> {
    vec![
        steady_lap("first", 0, 600.0),
        steady_lap("second", 1, 590.0),
        steady_lap("third", 2, 595.0),
        steady_lap("fourth", 3, 580.0),
    ]
}

/// Scenario: the record moved from 600 s to 590 s, a 595 s attempt came
/// after, and 580 s holds it now.
///
/// Expected behaviour: the previous record is the 590 s lap, with its curve
/// against the 580 s record, ten seconds behind at the end.
#[test]
fn a_direction_carries_the_lap_that_held_the_record_before() {
    let curves = curves_of(&four_records(), None).expect("curves");
    let forward = curves.forward.as_ref().expect("forward deltas");
    assert_eq!(forward.reference_activity_id, "fourth");
    let previous = forward
        .previous_record
        .as_ref()
        .expect("the record was beaten once before");
    assert_eq!(previous.activity_id, "second");
    assert_eq!(previous.activity_date, (FIRST_DAY + DAY) as f64);
    assert_eq!(previous.delta_secs, lap(forward, "second").delta_secs);
    assert_near(
        previous.end_delta_secs.expect("a whole lap"),
        10.0,
        0.5,
        "590 s against 580 s",
    );
    assert_near(previous.delta_secs[50], 5.0, 0.5, "halfway");
}

/// Scenario: the record holder was the first lap ever ridden.
///
/// Expected behaviour: no lap held the record before it.
#[test]
fn a_record_set_on_the_first_lap_has_no_previous_record() {
    let curves = curves_of(&reference_and_fading(), None).expect("curves");
    assert!(curves.forward.expect("forward").previous_record.is_none());
}

/// Scenario: a time chip keeps only the laps after the previous record.
///
/// Expected behaviour: the previous record is held whatever the range, as
/// the reference a new record is measured against.
#[test]
fn the_previous_record_is_held_outside_the_range() {
    let whole = curves_of(&four_records(), None).expect("curves");
    let ranged = in_range(&whole, FIRST_DAY + 2 * DAY, None).expect("two laps in range");
    let forward = ranged.forward.expect("forward");
    assert!(forward.laps.iter().all(|lap| lap.activity_id != "second"));
    assert_eq!(forward.previous_record.expect("held").activity_id, "second");
}

/// Scenario: the screen highlights an attempt, and the athlete may have set
/// a reference of their own.
///
/// Expected behaviour: the record measured against itself says nothing, so
/// the default is the previous record when the record is highlighted, the
/// record for any other attempt, and the athlete's own reference whenever
/// one is set.
#[test]
fn the_engine_chooses_the_default_reference_for_the_highlighted_attempt() {
    let whole = curves_of(&four_records(), None).expect("curves");
    let default_for = |curves: &crate::FfiSectionLapCurves, highlight| {
        in_range(curves, FIRST_DAY, highlight)
            .expect("curves")
            .forward
            .expect("forward")
            .default_reference
    };
    assert_eq!(
        default_for(&whole, Some("fourth")),
        FfiReferenceSource::PreviousRecord
    );
    assert_eq!(
        default_for(&whole, Some("third")),
        FfiReferenceSource::Record
    );
    assert_eq!(default_for(&whole, None), FfiReferenceSource::Record);

    let set = curves_of(&four_records(), Some("third")).expect("curves");
    for highlight in [Some("fourth"), Some("third"), None] {
        assert_eq!(
            default_for(&set, highlight),
            FfiReferenceSource::AthleteSet,
            "highlighting {highlight:?}"
        );
    }

    let first_record = curves_of(&reference_and_fading(), None).expect("curves");
    assert_eq!(
        default_for(&first_record, Some("steady")),
        FfiReferenceSource::Record,
        "with no previous record the record stays the reference"
    );
}

fn typical_of(laps: Vec<crate::FfiLapDelta>) -> Option<crate::FfiFloat32Array> {
    compared(
        "record".to_string(),
        FfiReferenceSource::Record,
        laps,
        Vec::new(),
        None,
        None,
    )
    .expect("laps beside the record")
    .typical_delta_secs
}

/// Scenario: six laps beside the record on a 300 m line, one a second lap
/// of the record's own activity that stops short of the end.
///
/// Expected behaviour: the typical lap at each point is the hand median of
/// the laps other than the record that reach it.
#[test]
fn a_direction_carries_the_typical_lap_at_every_point() {
    let typical = typical_of(record_and_laps(6)).expect("six laps reach a median");
    assert_floats(&typical, &[0.0, 2.5, 5.5, 5.0], "typical");
}

/// Scenario: five laps beside the record, the last point reached by four.
///
/// Expected behaviour: that point has no typical lap and the others do.
#[test]
fn a_point_under_five_laps_has_no_typical_lap() {
    let mut laps = record_and_laps(6);
    laps.remove(1);
    let typical = typical_of(laps).expect("three points reach a median");
    assert_floats(&typical, &[0.0, 3.0, 6.0, f32::NAN], "typical");
    assert!(typical_of(record_and_laps(4)).is_none());
}

/// Scenario: the record runs a steady 4 m/s and an attempt fades to 3.2 m/s
/// at halfway.
///
/// Expected behaviour: each lap carries its own time over every 100 m, 25 s
/// at 4 m/s and 31.25 s at 3.2 m/s, so a split can be put against any other
/// lap's.
#[test]
fn every_lap_carries_its_own_time_per_split() {
    let curves = curves_of(&reference_and_fading(), None).expect("curves");
    let forward = curves.forward.as_ref().expect("forward");
    let steady = &lap(forward, "steady").split_secs;
    assert_eq!(steady.len(), 10);
    for (split, secs) in steady.iter().enumerate() {
        assert_near(*secs, 25.0, 1.0, &format!("steady split {split}"));
    }
    let fading = &lap(forward, "fading").split_secs;
    assert_near(fading[0], 25.0, 1.0, "fading first split");
    assert_near(fading[9], 31.25, 1.0, "fading last split");
}
