//! Where a lap won or lost its time: each lap's clock along the section,
//! measured against the section's reference.
//!
//! A lap's points are projected onto the section's line, oriented so a
//! reverse lap runs its own axis from the far end, and its clock is resampled
//! onto a fixed distance grid. Progress that runs backward is held at its
//! running maximum, which is enough for the few samples GPS noise turns back.
//! A lap's delta at a grid point is its time since the start of the stretch it
//! shares with the reference, less the reference's over the same stretch.
//!
//! A line can pass over the same ground twice: a loop starts and finishes on
//! one spot, and an out-and-back returns down its own road. A point there is
//! as near one pass as the other, so it is placed on the pass nearer where the
//! lap had got to, rather than on whichever is a metre nearer. A lap runs
//! forward, so a pass behind that progress counts as further from it than a
//! pass the same distance ahead.
//!
//! A route is measured the same way, its representative activity's track as
//! the line and each attempt one lap over the whole activity.
//!
//! Nothing here is stored. The curves are derived from the track, the stream
//! and the line, so the read cache holds them until the database moves rather
//! than a column holding them across a migration.

use std::collections::HashMap;

use crate::{
    FfiDirectionDeltas, FfiLapDelta, FfiLapDeltaMissing, FfiLapDeltaMissingReason,
    FfiReferenceSource, FfiSectionLapCurves, GpsPoint, SectionLap, SectionPerformanceResult,
};

/// Metres between two points of a lap's curve. Alignment between laps is good
/// to a few seconds over 100 m and better over the whole section, so a finer
/// grid would only resample noise.
pub(crate) const GRID_STEP_M: f64 = 10.0;

/// Metres each split spans, the stretch a curve is honest about as a shape.
pub(crate) const SPLIT_STEP_M: f64 = 100.0;

/// Slack on a grid comparison, for distances that are a grid point in
/// arithmetic but not quite in floating point.
const EPSILON_M: f64 = 1e-6;

/// How much further from a point a second pass of the line may be and still be
/// the pass the point is placed on. Wider than the two sides of a road and the
/// error of a GPS fix, narrower than a road running beside it.
const PASS_SLACK_M: f64 = 25.0;

/// How far along the line two of its nearest places must be apart to be two
/// passes rather than one stretch of a line GPS noise wrinkled.
const PASS_GAP_M: f64 = 20.0;

/// How many metres ahead one metre behind a lap's progress counts as, when
/// choosing between two passes.
const BACKWARD_WEIGHT: f64 = 3.0;

/// Side of a square of the index that finds the segments near a point.
const CELL_M: f64 = 50.0;

/// Rings of cells searched before every segment is measured instead, for a
/// point far off the line.
const MAX_RING: i32 = 8;

/// The section's line in local planar metres, with the distance along it at
/// each vertex and the grid every curve is sampled on.
struct Axis {
    origin: (f64, f64),
    metres_per_degree: (f64, f64),
    vertices: Vec<(f64, f64)>,
    along: Vec<f64>,
    length: f64,
    grid: Vec<f64>,
    /// The segments each square of `CELL_M` touches, a segment `i` running
    /// from vertex `i - 1` to vertex `i`.
    cells: HashMap<(i32, i32), Vec<u32>>,
}

/// Where a point falls on one segment of the line.
#[derive(Clone, Copy)]
struct Foot {
    segment: usize,
    /// Squared planar distance from the point.
    squared: f64,
    /// The segment parameter, 0 at its first vertex and 1 at its last.
    t: f64,
    along: f64,
}

fn cell_of(xy: (f64, f64)) -> (i32, i32) {
    (
        (xy.0 / CELL_M).floor() as i32,
        (xy.1 / CELL_M).floor() as i32,
    )
}

impl Axis {
    /// `None` for a line shorter than one grid step, which has no curve to draw.
    fn new(line: &[GpsPoint]) -> Option<Axis> {
        let first = line.first()?;
        let origin = (first.latitude, first.longitude);
        let per_latitude = crate::persistence::haversine_distance_meters(
            origin.0,
            origin.1,
            origin.0 + 0.01,
            origin.1,
        ) / 0.01;
        let metres_per_degree = (per_latitude, per_latitude * origin.0.to_radians().cos());
        let mut axis = Axis {
            origin,
            metres_per_degree,
            vertices: Vec::with_capacity(line.len()),
            along: Vec::with_capacity(line.len()),
            length: 0.0,
            grid: Vec::new(),
            cells: HashMap::new(),
        };
        let mut run = 0.0;
        for point in line {
            let xy = axis.planar(point);
            if let Some(last) = axis.vertices.last() {
                run += (xy.0 - last.0).hypot(xy.1 - last.1);
            }
            axis.vertices.push(xy);
            axis.along.push(run);
        }
        if !run.is_finite() || run < GRID_STEP_M {
            return None;
        }
        axis.length = run;
        let steps = (run / GRID_STEP_M - EPSILON_M).ceil() as usize;
        axis.grid = (0..steps).map(|k| k as f64 * GRID_STEP_M).collect();
        axis.grid.push(run);
        for i in 1..axis.vertices.len() {
            let (a, b) = (cell_of(axis.vertices[i - 1]), cell_of(axis.vertices[i]));
            for cx in a.0.min(b.0)..=a.0.max(b.0) {
                for cy in a.1.min(b.1)..=a.1.max(b.1) {
                    axis.cells.entry((cx, cy)).or_default().push(i as u32);
                }
            }
        }
        Some(axis)
    }

    fn planar(&self, point: &GpsPoint) -> (f64, f64) {
        (
            (point.latitude - self.origin.0) * self.metres_per_degree.0,
            (point.longitude - self.origin.1) * self.metres_per_degree.1,
        )
    }

    fn foot(&self, (x, y): (f64, f64), segment: usize) -> Foot {
        let (ax, ay) = self.vertices[segment - 1];
        let (bx, by) = self.vertices[segment];
        let (dx, dy) = (bx - ax, by - ay);
        let span = dx * dx + dy * dy;
        let t = if span > 0.0 {
            (((x - ax) * dx + (y - ay) * dy) / span).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let (px, py) = (ax + t * dx, ay + t * dy);
        Foot {
            segment,
            squared: (x - px).powi(2) + (y - py).powi(2),
            t,
            along: self.along[segment - 1] + t * (self.along[segment] - self.along[segment - 1]),
        }
    }

    /// Fills `feet` with where `xy` falls on every segment within `reach` of
    /// it, and on some further ones. False, with `feet` left as it was, when
    /// the index cannot vouch for `reach`.
    fn feet_within(&self, xy: (f64, f64), reach: f64, feet: &mut Vec<Foot>) -> bool {
        // A segment within `ring * CELL_M` of the point touches a cell at most
        // `ring` cells from the point's own.
        let ring = (reach / CELL_M).ceil().max(1.0) as i32;
        if ring > MAX_RING {
            return false;
        }
        let home = cell_of(xy);
        feet.clear();
        for cx in home.0 - ring..=home.0 + ring {
            for cy in home.1 - ring..=home.1 + ring {
                if let Some(segments) = self.cells.get(&(cx, cy)) {
                    feet.extend(segments.iter().map(|&i| self.foot(xy, i as usize)));
                }
            }
        }
        true
    }

    /// Whether the line comes no nearer the point on either side of `foot`: a
    /// foot inside its segment, or one on a vertex both segments meeting there
    /// end on. A foot on a vertex the next segment runs on past is no place of
    /// its own, only the end of the segment before.
    fn is_local_nearest(&self, xy: (f64, f64), foot: &Foot) -> bool {
        if foot.t > 0.0 && foot.t < 1.0 {
            return true;
        }
        let last = self.vertices.len() - 1;
        if foot.t <= 0.0 {
            foot.segment == 1 || self.foot(xy, foot.segment - 1).t >= 1.0
        } else {
            foot.segment == last || self.foot(xy, foot.segment + 1).t <= 0.0
        }
    }

    /// Distance along the line to the point on it nearest `point`, or, where
    /// the line passes that ground more than once, to the nearest point on the
    /// pass closest to `reached`, the progress a lap travelling the way
    /// `reverse` says has made so far. `feet` is scratch the caller keeps
    /// across points, so a lap's projection allocates once rather than per
    /// point.
    fn along(&self, point: &GpsPoint, reached: f64, reverse: bool, feet: &mut Vec<Foot>) -> f64 {
        let xy = self.planar(point);
        // Ties go to the earlier segment, as a scan from the start would have it.
        let nearest_of = |feet: &[Foot]| {
            feet.iter().copied().reduce(|a, b| {
                if (b.squared, b.segment) < (a.squared, a.segment) {
                    b
                } else {
                    a
                }
            })
        };
        // Widen the search until it holds every segment within the slack of
        // the nearest, and measure them all when that is too far for the index.
        let mut reach = CELL_M;
        let nearest = loop {
            if !self.feet_within(xy, reach, feet) {
                feet.clear();
                feet.extend((1..self.vertices.len()).map(|i| self.foot(xy, i)));
                match nearest_of(feet) {
                    Some(nearest) => break nearest,
                    None => return 0.0,
                }
            }
            match nearest_of(feet) {
                Some(nearest) if nearest.squared.sqrt() + PASS_SLACK_M <= reach => {
                    break nearest;
                }
                Some(nearest) => reach = nearest.squared.sqrt() + PASS_SLACK_M,
                None => reach += CELL_M,
            }
        };
        let within = (nearest.squared.sqrt() + PASS_SLACK_M).powi(2);
        let away = |foot: &Foot| {
            let progress = if reverse {
                self.length - foot.along
            } else {
                foot.along
            };
            let ahead = progress - reached;
            if ahead >= 0.0 {
                ahead
            } else {
                -ahead * BACKWARD_WEIGHT
            }
        };
        feet.iter()
            .copied()
            .filter(|foot| {
                (foot.along - nearest.along).abs() > PASS_GAP_M
                    && foot.squared <= within
                    && self.is_local_nearest(xy, foot)
            })
            .fold(nearest, |chosen, foot| {
                if away(&foot) < away(&chosen) {
                    foot
                } else {
                    chosen
                }
            })
            .along
    }
}

/// One lap's clock on the grid, in seconds from its own first sample.
struct LapClock {
    /// The first and last grid index the lap's progress reaches.
    from: usize,
    to: usize,
    /// One per grid point, NaN outside `from..=to`.
    times: Vec<f64>,
    /// Where the lap's projected progress starts and ends on its axis.
    start_m: f64,
    end_m: f64,
    /// The lap's median distance between two samples, the floor any boundary
    /// it crosses is known to.
    floor_m: f64,
}

impl LapClock {
    /// Within a grid step and one sample of both ends of the section.
    fn covers_both_ends(&self, length: f64) -> bool {
        let slack = GRID_STEP_M + self.floor_m;
        self.start_m <= slack && self.end_m >= length - slack
    }
}

/// The lap's clock on the grid, or `None` when it does not advance along the
/// line by a grid step. `track` and `times` are the lap's own points, one time
/// per point.
fn lap_clock(axis: &Axis, track: &[GpsPoint], times: &[u32], reverse: bool) -> Option<LapClock> {
    if track.len() < 2 || track.len() != times.len() {
        return None;
    }
    let mut progress = Vec::with_capacity(track.len());
    let mut furthest = f64::NEG_INFINITY;
    let mut feet = Vec::new();
    for point in track {
        let along = axis.along(point, furthest.max(0.0), reverse, &mut feet);
        let oriented = if reverse { axis.length - along } else { along };
        furthest = furthest.max(oriented);
        progress.push(furthest);
    }
    let start_m = progress[0];
    let end_m = furthest;
    let from = axis.grid.iter().position(|&g| g >= start_m - EPSILON_M)?;
    let to = axis.grid.iter().rposition(|&g| g <= end_m + EPSILON_M)?;
    if to <= from {
        return None;
    }

    let mut clock = vec![f64::NAN; axis.grid.len()];
    let first = times[0] as f64;
    let mut i = 0;
    for (k, &g) in axis.grid.iter().enumerate().take(to + 1).skip(from) {
        while i < progress.len() && progress[i] < g - EPSILON_M {
            i += 1;
        }
        let at = if i == 0 || i == progress.len() {
            times[i.min(progress.len() - 1)] as f64
        } else {
            let (p0, p1) = (progress[i - 1], progress[i]);
            let (t0, t1) = (times[i - 1] as f64, times[i] as f64);
            if p1 - p0 > 0.0 {
                t0 + (g - p0) / (p1 - p0) * (t1 - t0)
            } else {
                t1
            }
        };
        clock[k] = at - first;
    }

    let mut steps: Vec<f64> = progress
        .windows(2)
        .map(|w| w[1] - w[0])
        .filter(|step| *step > 0.0)
        .collect();
    steps.sort_by(f64::total_cmp);
    let floor_m = steps.get(steps.len() / 2).copied().unwrap_or(0.0);

    Some(LapClock {
        from,
        to,
        times: clock,
        start_m,
        end_m,
        floor_m,
    })
}

/// A lap's deltas against the reference.
struct Deltas {
    delta_secs: Vec<f32>,
    split_delta_secs: Vec<f32>,
    end_delta_secs: Option<f32>,
}

/// The lap against the reference over the stretch both reach, re-zeroed at
/// its start. `None` when they share less than a grid step.
fn lap_deltas(axis: &Axis, lap: &LapClock, reference: &LapClock) -> Option<Deltas> {
    let from = lap.from.max(reference.from);
    let to = lap.to.min(reference.to);
    if to <= from {
        return None;
    }
    let (lap_zero, reference_zero) = (lap.times[from], reference.times[from]);
    let delta: Vec<f64> = (0..axis.grid.len())
        .map(|k| {
            if (from..=to).contains(&k) {
                (lap.times[k] - lap_zero) - (reference.times[k] - reference_zero)
            } else {
                f64::NAN
            }
        })
        .collect();

    let per_split = (SPLIT_STEP_M / GRID_STEP_M).round() as usize;
    let last = axis.grid.len() - 1;
    let splits = last.div_ceil(per_split);
    let split_delta_secs = (0..splits)
        .map(|b| {
            let (s, e) = (b * per_split, ((b + 1) * per_split).min(last));
            if s >= from && e <= to {
                (delta[e] - delta[s]) as f32
            } else {
                f32::NAN
            }
        })
        .collect();

    let whole = lap.covers_both_ends(axis.length) && reference.covers_both_ends(axis.length);
    Some(Deltas {
        delta_secs: delta.iter().map(|d| *d as f32).collect(),
        split_delta_secs,
        end_delta_secs: whole.then(|| delta[to] as f32),
    })
}

type LapKey = (String, u32);

fn key_of(lap: &SectionLap) -> LapKey {
    (lap.activity_id.clone(), lap.start_index)
}

fn runs_reverse(lap: &SectionLap) -> Option<bool> {
    match lap.direction.as_str() {
        "same" => Some(false),
        "reverse" => Some(true),
        // A `partial` overlap is a fragment of the ground and never a
        // traversal, the rule the chart and the record apply.
        _ => None,
    }
}

/// The lap a direction is measured against, and why it is that one.
///
/// The athlete's choice when they made one and that activity has a full lap
/// in this direction with a clock, else the direction's record over the whole
/// included history, the lap `best_*_record` names.
fn reference_lap<'a>(
    perf: &'a SectionPerformanceResult,
    reverse: bool,
    athlete_set: Option<&str>,
    has_clock: impl Fn(&SectionLap) -> bool,
) -> Option<(&'a SectionLap, FfiReferenceSource)> {
    let set = athlete_set
        .and_then(|id| perf.records.iter().find(|r| r.activity_id == id))
        .and_then(|record| {
            let (forward, backward) =
                crate::persistence::fitness::performances::direction_best_laps(
                    &record.laps,
                    record.section_distance,
                );
            if reverse { backward } else { forward }
        })
        .filter(|lap| has_clock(lap));
    if let Some(lap) = set {
        return Some((lap, FfiReferenceSource::AthleteSet));
    }

    let best = if reverse {
        perf.best_reverse_record.as_ref()
    } else {
        perf.best_forward_record.as_ref()
    }?;
    let lap = perf
        .records
        .iter()
        .find(|r| r.activity_id == best.activity_id)?
        .laps
        .iter()
        .find(|lap| {
            runs_reverse(lap) == Some(reverse)
                && lap.time == best.best_time
                && lap.counts_for_record(best.section_distance)
        })?;
    Some((lap, FfiReferenceSource::Record))
}

/// One direction's laps against its reference, with the peak the plot scales
/// to. `None` without a lap beside the reference, as a direction is worth
/// drawing only with one.
fn compared(
    reference_activity_id: String,
    reference_source: FfiReferenceSource,
    laps: Vec<FfiLapDelta>,
    missing: Vec<FfiLapDeltaMissing>,
) -> Option<FfiDirectionDeltas> {
    fn finite(lap: &FfiLapDelta) -> impl Iterator<Item = f32> + '_ {
        lap.delta_secs
            .iter()
            .copied()
            .filter(|delta| delta.is_finite())
    }
    let beside = laps.iter().any(|lap| {
        lap.activity_id != reference_activity_id || finite(lap).any(|delta| delta != 0.0)
    });
    if !beside {
        return None;
    }
    let peak_delta_secs = laps
        .iter()
        .flat_map(finite)
        .fold(0.0_f32, |peak, delta| peak.max(delta.abs()));
    Some(FfiDirectionDeltas {
        reference_activity_id,
        reference_source,
        laps,
        missing,
        peak_delta_secs,
    })
}

fn either(curves: FfiSectionLapCurves) -> Option<FfiSectionLapCurves> {
    (curves.forward.is_some() || curves.reverse.is_some()).then_some(curves)
}

/// Every lap's deltas over the whole included history `perf` holds.
///
/// `track_of` and `stream_of` are asked once per activity with a lap, and
/// `stream_of` first, so an activity with no stream costs no track decode.
pub(crate) fn lap_curves<T, S>(
    line: &[GpsPoint],
    perf: &SectionPerformanceResult,
    athlete_set: Option<&str>,
    mut track_of: T,
    mut stream_of: S,
) -> Option<FfiSectionLapCurves>
where
    T: FnMut(&str) -> Option<Vec<GpsPoint>>,
    S: FnMut(&str) -> Option<Vec<u32>>,
{
    let axis = Axis::new(line)?;

    let mut clocks: HashMap<LapKey, Result<LapClock, FfiLapDeltaMissingReason>> = HashMap::new();
    for record in &perf.records {
        let laps: Vec<(&SectionLap, bool)> = record
            .laps
            .iter()
            .filter_map(|lap| runs_reverse(lap).map(|reverse| (lap, reverse)))
            .collect();
        if laps.is_empty() {
            continue;
        }
        let times = stream_of(&record.activity_id);
        let track = times.as_ref().and_then(|_| track_of(&record.activity_id));
        for (lap, reverse) in laps {
            let clock = match (&times, &track) {
                (None, _) => Err(FfiLapDeltaMissingReason::NoTimeStream),
                (Some(_), None) => Err(FfiLapDeltaMissingReason::NotProjectable),
                // The rule every lap-time reader applies: a stream that is not
                // the track's length is not in the track's index space.
                (Some(times), Some(track)) if times.len() != track.len() => {
                    Err(FfiLapDeltaMissingReason::MisalignedTimeStream)
                }
                (Some(times), Some(track)) => {
                    let start = lap.start_index as usize;
                    let end = (lap.end_index as usize).min(track.len());
                    (start < end)
                        .then(|| lap_clock(&axis, &track[start..end], &times[start..end], reverse))
                        .flatten()
                        .ok_or(FfiLapDeltaMissingReason::NotProjectable)
                }
            };
            clocks.insert(key_of(lap), clock);
        }
    }

    let direction = |reverse: bool| -> Option<FfiDirectionDeltas> {
        let has_clock = |lap: &SectionLap| clocks.get(&key_of(lap)).is_some_and(Result::is_ok);
        let (reference, source) = reference_lap(perf, reverse, athlete_set, has_clock)?;
        let Some(Ok(reference_clock)) = clocks.get(&key_of(reference)) else {
            return None;
        };
        let mut laps = Vec::new();
        let mut missing = Vec::new();
        for record in &perf.records {
            for lap in record
                .laps
                .iter()
                .filter(|l| runs_reverse(l) == Some(reverse))
            {
                let missed = |reason| FfiLapDeltaMissing {
                    activity_id: record.activity_id.clone(),
                    start_index: lap.start_index,
                    activity_date: record.activity_date as f64,
                    reason,
                };
                let clock = match clocks.get(&key_of(lap)) {
                    Some(Ok(clock)) => clock,
                    Some(Err(reason)) => {
                        missing.push(missed(*reason));
                        continue;
                    }
                    None => continue,
                };
                match lap_deltas(&axis, clock, reference_clock) {
                    Some(d) => laps.push(FfiLapDelta {
                        activity_id: record.activity_id.clone(),
                        start_index: lap.start_index,
                        activity_date: record.activity_date as f64,
                        delta_secs: d.delta_secs.into(),
                        split_delta_secs: d.split_delta_secs.into(),
                        end_delta_secs: d.end_delta_secs,
                    }),
                    None => missing.push(missed(FfiLapDeltaMissingReason::NotProjectable)),
                }
            }
        }
        compared(reference.activity_id.clone(), source, laps, missing)
    };

    either(FfiSectionLapCurves {
        grid_step_m: GRID_STEP_M,
        split_step_m: SPLIT_STEP_M,
        section_length_m: axis.length,
        forward: direction(false),
        reverse: direction(true),
    })
}

/// The curves of the laps from `cutoff` on, measured against the reference
/// the whole history chose. The time chips filter this way, so a chip change
/// computes nothing, and a kept lap shares its curve with the held one rather
/// than copying it.
pub(crate) fn in_range(curves: &FfiSectionLapCurves, cutoff: i64) -> Option<FfiSectionLapCurves> {
    let cutoff = cutoff as f64;
    let ranged = |deltas: &Option<FfiDirectionDeltas>| {
        let deltas = deltas.as_ref()?;
        compared(
            deltas.reference_activity_id.clone(),
            deltas.reference_source,
            deltas
                .laps
                .iter()
                .filter(|lap| lap.activity_date >= cutoff)
                .cloned()
                .collect(),
            deltas
                .missing
                .iter()
                .filter(|lap| lap.activity_date >= cutoff)
                .cloned()
                .collect(),
        )
    };
    either(FfiSectionLapCurves {
        grid_step_m: curves.grid_step_m,
        split_step_m: curves.split_step_m,
        section_length_m: curves.section_length_m,
        forward: ranged(&curves.forward),
        reverse: ranged(&curves.reverse),
    })
}

/// The curves read on a pooled connection, with no engine lock.
pub(crate) mod pooled {
    use std::cell::Cell;
    use std::sync::Arc;

    use rusqlite::Connection;

    use crate::{FfiSectionLapCurves, SectionPerformanceResult};

    thread_local! {
        static COMPUTATIONS: Cell<usize> = const { Cell::new(0) };
        static DECODES: Cell<usize> = const { Cell::new(0) };
    }

    #[cfg(test)]
    pub(crate) fn reset_test_counters() {
        COMPUTATIONS.with(|count| count.set(0));
        DECODES.with(|count| count.set(0));
    }

    /// How many times this thread has computed a section's curves in full.
    #[cfg(test)]
    pub(crate) fn computations() -> usize {
        COMPUTATIONS.with(Cell::get)
    }

    /// How many tracks and time streams those computations decoded.
    #[cfg(test)]
    pub(crate) fn decodes() -> usize {
        DECODES.with(Cell::get)
    }

    fn count(counter: &'static std::thread::LocalKey<Cell<usize>>) {
        counter.with(|count| count.set(count.get() + 1));
    }

    /// Whether a read computes the curves it does not hold, or leaves them
    /// owed. Computing them decodes a track and a time stream for every lap
    /// over the whole history, which on a well-ridden section or route takes
    /// longer than a tap may block, so a screen's own read only serves them
    /// once held.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum CurveRead {
        Held,
        Computed,
    }

    /// One section's curves under one sport filter over the whole included
    /// history, cached until the database moves. `None` when `read` is
    /// [`CurveRead::Held`] and they are not held.
    pub(crate) fn cached_lap_curves(
        conn: &Connection,
        section_id: &str,
        sport_type_filter: Option<&str>,
        read: CurveRead,
    ) -> Option<Arc<Option<FfiSectionLapCurves>>> {
        let key = match sport_type_filter {
            Some(sport) => format!("{section_id}:{sport}"),
            None => section_id.to_string(),
        };
        match read {
            CurveRead::Held => crate::persistence::read_cache::held_lap_curves(conn, &key),
            CurveRead::Computed => Some(crate::persistence::read_cache::lap_curves(
                conn,
                &key,
                || lap_curves(conn, section_id, sport_type_filter),
            )),
        }
    }

    /// One route's curves under one sport filter, over the included attempts
    /// `attempts` reads, cached until the database moves. `None` when `read`
    /// is [`CurveRead::Held`] and they are not held.
    pub(crate) fn cached_route_lap_curves(
        conn: &Connection,
        route_id: &str,
        sport_type_filter: Option<&str>,
        read: CurveRead,
        attempts: impl FnOnce() -> SectionPerformanceResult,
    ) -> Option<Arc<Option<FfiSectionLapCurves>>> {
        // Keyed apart from the sections, whose ids a route's may share.
        let key = match sport_type_filter {
            Some(sport) => format!("route:{route_id}:{sport}"),
            None => format!("route:{route_id}"),
        };
        match read {
            CurveRead::Held => crate::persistence::read_cache::held_lap_curves(conn, &key),
            CurveRead::Computed => Some(crate::persistence::read_cache::lap_curves(
                conn,
                &key,
                || route_lap_curves(conn, route_id, attempts()),
            )),
        }
    }

    /// A route's curves along its representative's track, each attempt one
    /// lap over its whole activity. The reference the athlete set is the
    /// representative they chose; one the grouping picked is no choice.
    fn route_lap_curves(
        conn: &Connection,
        route_id: &str,
        mut attempts: SectionPerformanceResult,
    ) -> Option<FfiSectionLapCurves> {
        use crate::persistence::fitness::performances::laps;
        use crate::persistence::routes::pooled as routes;
        count(&COMPUTATIONS);
        if attempts.records.is_empty() {
            return None;
        }
        let line = routes::representative_route(conn, route_id)?;
        // An attempt's lap runs to the end of whatever track it has.
        for lap in attempts.records.iter_mut().flat_map(|r| r.laps.iter_mut()) {
            lap.end_index = u32::MAX;
        }
        let athlete_set = routes::chosen_representative(conn, route_id);
        super::lap_curves(
            &line,
            &attempts,
            athlete_set.as_deref(),
            |id| {
                count(&DECODES);
                crate::persistence::activities::pooled::gps_track(conn, id)
            },
            |id| {
                count(&DECODES);
                laps::time_stream(conn, id).map(|(times, _)| times)
            },
        )
    }

    fn lap_curves(
        conn: &Connection,
        section_id: &str,
        sport_type_filter: Option<&str>,
    ) -> Option<FfiSectionLapCurves> {
        use crate::persistence::fitness::performances::{laps, pooled as performances};
        count(&COMPUTATIONS);
        let perf = performances::cached_section_performances(conn, section_id, sport_type_filter);
        if perf.records.is_empty() {
            return None;
        }
        let line = crate::persistence::sections::geometry::stored_line(conn, section_id).ok()?;
        let athlete_set =
            crate::persistence::sections::history::pooled::athlete_reference(conn, section_id);
        super::lap_curves(
            &line,
            &perf,
            athlete_set.as_deref(),
            |id| {
                count(&DECODES);
                crate::persistence::activities::pooled::gps_track(conn, id)
            },
            |id| {
                count(&DECODES);
                laps::time_stream(conn, id).map(|(times, _)| times)
            },
        )
    }
}

#[cfg(test)]
#[path = "tests/lap_curves.rs"]
mod tests;
