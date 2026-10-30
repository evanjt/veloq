//! The time of one pass over a section.
//!
//! Every pass is timed between the same two gates: the line across the section
//! at its start and the line across it at its end, each perpendicular to the
//! section line. The crossing time of a gate is interpolated between the two
//! samples either side of it, so a pass covers exactly the section's ground and
//! the time does not depend on where the recording happened to place its
//! samples. A pass that starts or stops short of a gate, within the slack the
//! matcher admits, has that end projected to the gate at the pass's own speed,
//! so it covers the same ground as every other pass. How far the projection
//! reached is stored with the time: a short reach leaves the time plain, a long
//! one marks it estimated. A pass further from a gate than the slack has no
//! time and is never ranked.
//!
//! Pace is the section's length over that time, so pace and time rank every
//! pass the same way.

use std::collections::HashMap;

use crate::GpsPoint;
use crate::persistence::PersistentEngine;

/// How far from a gate's origin, in ground metres, the samples either side of
/// a pass's trimmed end are searched for the crossing, and how far along the
/// gate's line a crossing may lie. The trim keeps the sample nearest each end
/// by distance and admits one up to the ground tolerance short of the line, so
/// on a sideways approach the crossing is any number of samples away, however
/// densely the recording was sampled, and on a slanting one it lies beyond
/// the tolerance along the line. Twice the tolerance reaches past both.
const CROSSING_REACH_M: f64 = 2.0 * tracematch::sections::GROUND_TOL_M;

/// The ground a gate's direction is taken over.
const GATE_ARM_M: f64 = 5.0;

/// The span of samples at a pass's end its speed is read over: up to this many
/// seconds or this many metres of track, whichever is reached first.
const END_SPEED_WINDOW_S: f64 = 30.0;
const END_SPEED_WINDOW_M: f64 = 100.0;

/// Below this an end speed is a stop, and projecting over it would blow the
/// time up, so the pass's average over the section stands in.
const MIN_END_SPEED_MPS: f64 = 0.5;

/// The share of the section's length a pass's own track, with the ground
/// projected at its ends, has to span between them. A sanity floor and not the coverage rule:
/// chords across a sparse recording and corners cut by the line fall well
/// short of the line's length on a pass that is plainly the section.
const MIN_COVERED_SHARE: f64 = 0.5;

/// A projection of at least this many metres leaves the time estimated. A
/// shorter one is inside the noise of a gate crossing and the time is plain.
pub(crate) const ESTIMATED_FROM_PROJECTED_M: f64 = 10.0;

/// Whether a pass projected `projected_m` metres to its gates is estimated.
/// `None` is a pass timed between its gates, or a row stored before the
/// projection was recorded.
pub(crate) fn is_estimated(projected_m: Option<f64>) -> bool {
    projected_m.is_some_and(|metres| metres >= ESTIMATED_FROM_PROJECTED_M)
}

const METRES_PER_DEGREE: f64 = 111_319.490_793;

/// A line across the section, with the side a pass moving through it arrives
/// from negative and leaves on positive.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Gate {
    origin: GpsPoint,
    /// Unit vector in the local east/north frame pointing the way a pass moves
    /// through the gate.
    heading: (f64, f64),
}

impl Gate {
    fn side(&self, point: &GpsPoint) -> f64 {
        let (east, north) = local_offset(&self.origin, point);
        east * self.heading.0 + north * self.heading.1
    }

    /// How far across the section, from the gate's origin, the path between
    /// two samples is `fraction` of the way from `from` to `to`.
    fn offset_across(&self, from: &GpsPoint, to: &GpsPoint, fraction: f64) -> f64 {
        let (e0, n0) = local_offset(&self.origin, from);
        let (e1, n1) = local_offset(&self.origin, to);
        let east = e0 + fraction * (e1 - e0);
        let north = n0 + fraction * (n1 - n0);
        -east * self.heading.1 + north * self.heading.0
    }

    fn reversed(&self) -> Self {
        Self {
            origin: self.origin,
            heading: (-self.heading.0, -self.heading.1),
        }
    }
}

/// Metres east and north of `origin`.
fn local_offset(origin: &GpsPoint, point: &GpsPoint) -> (f64, f64) {
    let east = (point.longitude - origin.longitude)
        * METRES_PER_DEGREE
        * origin.latitude.to_radians().cos();
    let north = (point.latitude - origin.latitude) * METRES_PER_DEGREE;
    (east, north)
}

fn unit(from: &GpsPoint, to: &GpsPoint) -> Option<(f64, f64)> {
    let (east, north) = local_offset(from, to);
    let length = east.hypot(north);
    (length > 0.0).then(|| (east / length, north / length))
}

/// The two gates of a section and the ground between them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SectionTiming {
    start: Gate,
    end: Gate,
    length_m: f64,
    /// The two gates are one place: a lap of it is a pass from anywhere on the
    /// ground round to the same point.
    closed: bool,
}

impl SectionTiming {
    /// The gates of a section drawn as `line`, `length_m` long. `None` when the
    /// line cannot give a heading at one of its ends or the length is not a
    /// positive finite number.
    pub(crate) fn from_line(line: &[GpsPoint], length_m: f64) -> Option<Self> {
        if !length_m.is_finite() || length_m <= 0.0 {
            return None;
        }
        let first = line.first()?;
        let last = line.last()?;
        let toward_start = line
            .iter()
            .find(|p| local_distance(first, p) >= GATE_ARM_M)?;
        let toward_end = line
            .iter()
            .rev()
            .find(|p| local_distance(last, p) >= GATE_ARM_M)?;
        Some(Self {
            start: Gate {
                origin: *first,
                heading: unit(first, toward_start)?,
            },
            end: Gate {
                origin: *last,
                heading: unit(toward_end, last)?,
            },
            length_m,
            closed: local_distance(first, last) <= tracematch::sections::GROUND_TOL_M,
        })
    }

    pub(crate) fn length_m(&self) -> f64 {
        self.length_m
    }

    /// The gate a pass enters through and the one it leaves by.
    fn gates_for(&self, reverse: bool) -> (Gate, Gate) {
        if reverse {
            (self.end.reversed(), self.start.reversed())
        } else {
            (self.start, self.end)
        }
    }
}

fn local_distance(a: &GpsPoint, b: &GpsPoint) -> f64 {
    let (east, north) = local_offset(a, b);
    east.hypot(north)
}

/// One stored pass over a section: the half-open sample range the detector cut
/// and the ground that range covers.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PassSpan<'a> {
    pub direction: &'a str,
    pub start_index: u32,
    pub end_index: u32,
    pub distance_meters: f64,
}

/// The time of one pass over a section.
///
/// `time` and `pace` are both `None` when the pass cannot be timed.
/// `projected_m` is the longer of the two ends' projections to their gates,
/// `None` when the pass crossed both.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct PassTime {
    pub time: Option<f64>,
    pub pace: Option<f64>,
    pub projected_m: Option<f64>,
}

impl PassTime {
    const NONE: Self = Self {
        time: None,
        pace: None,
        projected_m: None,
    };
}

/// The time and pace of one pass, none of them when it cannot be timed.
///
/// `track` is the activity's samples and `times` their elapsed seconds, so the
/// two must be the same length. `section` is `None` when the section's line or
/// length is unknown, which times nothing.
///
/// A pass of direction `partial` covers only part of the section and is never
/// ranked, so it keeps the time between its first and last sample and the pace
/// over its own ground.
pub(crate) fn time_pass(
    times: Option<&[u32]>,
    track: Option<&[GpsPoint]>,
    section: Option<&SectionTiming>,
    pass: &PassSpan<'_>,
) -> PassTime {
    let (Some(times), Some(track)) = (times, track) else {
        return PassTime::NONE;
    };
    // A stream that is not the track's length is not in the track's index
    // space. Every 0.3.x stored the raw series, which keeps the samples the
    // coordinate mask drops, and indexing that with track indices reads the
    // wrong window.
    if track.len() != times.len() {
        return PassTime::NONE;
    }
    if pass.end_index == 0 || pass.end_index as usize > times.len() {
        return PassTime::NONE;
    }
    let first = pass.start_index as usize;
    let last = pass.end_index as usize - 1;
    if first >= times.len() || last <= first {
        return PassTime::NONE;
    }
    if pass.direction == "partial" {
        let elapsed = (f64::from(times[last]) - f64::from(times[first])).abs();
        return positive(
            elapsed,
            None,
            pass,
            section.map_or(0.0, SectionTiming::length_m),
        );
    }
    let Some(section) = section else {
        return PassTime::NONE;
    };
    let (entry, exit) = section.gates_for(pass.direction == "reverse");
    let entered = crossing_time(times, track, &entry, first, last)
        .map(|(time, at)| End {
            time,
            projected_m: 0.0,
            at,
        })
        .or_else(|| project_entry(times, track, &entry, first, last));
    let left = crossing_time(times, track, &exit, last, first)
        .map(|(time, at)| End {
            time,
            projected_m: 0.0,
            at,
        })
        .or_else(|| project_exit(times, track, &exit, first, last));
    if let (Some(entered), Some(left)) = (entered, left)
        && left.at >= entered.at
    {
        // Two crossings of an open section's gates are its length apart. At a
        // closed section's one place they can be a moment apart, and a pass
        // projected to a gate at either end can be a run that hardly moves,
        // so the track between the ends and the ground projected over has to
        // be a good part of the section's length.
        let projected_total = entered.projected_m + left.projected_m;
        let covered = path_between(track, entered.at, left.at) + projected_total;
        if (!section.closed && projected_total == 0.0)
            || covered >= MIN_COVERED_SHARE * section.length_m
        {
            let projected = entered.projected_m.max(left.projected_m);
            return positive(
                left.time - entered.time,
                (projected > 0.0).then_some(projected),
                pass,
                section.length_m,
            );
        }
    }
    whole_lap(times, track, section, &entry, pass, first, last)
}

/// One end of a pass at its gate: when it was there, how far it was projected
/// to get there, and the sample the ground between the ends is counted from.
#[derive(Clone, Copy)]
struct End {
    time: f64,
    projected_m: f64,
    at: usize,
}

/// The track's length from sample `from` to the end of the segment `to` starts,
/// so a crossing inside a segment counts the whole of it.
fn path_between(track: &[GpsPoint], from: usize, to: usize) -> f64 {
    (from..(to + 1).min(track.len() - 1))
        .map(|k| local_distance(&track[k], &track[k + 1]))
        .sum()
}

/// The time of a lap of a closed section that began away from its gates: the
/// pass leaves a point and comes back to it, so it covers the section's ground
/// once whichever point it started from, and its time is the lap's. How far
/// from the gate it started is the projection, which always marks it estimated.
fn whole_lap(
    times: &[u32],
    track: &[GpsPoint],
    section: &SectionTiming,
    gate: &Gate,
    pass: &PassSpan<'_>,
    first: usize,
    last: usize,
) -> PassTime {
    let returns = local_distance(&track[first], &track[last])
        <= tracematch::sections::GROUND_TOL_M + local_distance(&track[last], &track[last - 1]);
    if !section.closed || !returns {
        return PassTime::NONE;
    }
    // A run that hardly moves also ends where it began.
    let travelled = path_between(track, first, last);
    if travelled < MIN_COVERED_SHARE * section.length_m {
        return PassTime::NONE;
    }
    let elapsed = f64::from(times[last]) - f64::from(times[first]);
    let started_m = local_distance(&gate.origin, &track[first]).max(ESTIMATED_FROM_PROJECTED_M);
    positive(elapsed, Some(started_m), pass, section.length_m)
}

fn positive(
    elapsed: f64,
    projected_m: Option<f64>,
    pass: &PassSpan<'_>,
    section_m: f64,
) -> PassTime {
    if elapsed.is_finite() && elapsed > 0.0 {
        let pace = pace_over(pass.direction, elapsed, section_m, pass.distance_meters);
        PassTime {
            time: Some(elapsed),
            pace: Some(pace),
            projected_m,
        }
    } else {
        PassTime::NONE
    }
}

/// The time a pass would have crossed its entry gate, and the metres projected
/// to get there, for a pass whose search found no crossing. The first sample
/// is inside the section when it began there, and still before the gate when
/// the pass came at the gate from the side and never crossed it. `None` when
/// that sample is further from the gate than the slack.
fn project_entry(
    times: &[u32],
    track: &[GpsPoint],
    gate: &Gate,
    first: usize,
    last: usize,
) -> Option<End> {
    let inside = gate.side(&track[first]);
    if !within_slack(inside, &track[first], &track[first + 1]) {
        return None;
    }
    let speed = end_speed(times, track, first, last, true)?;
    Some(End {
        time: f64::from(times[first]) - inside / speed,
        projected_m: inside.abs(),
        at: first,
    })
}

/// The time a pass would have crossed its exit gate, and the metres projected
/// to get there: forward from a pass that stopped short of the end, and back
/// from one that reached the gate from the side and never crossed it.
fn project_exit(
    times: &[u32],
    track: &[GpsPoint],
    gate: &Gate,
    first: usize,
    last: usize,
) -> Option<End> {
    let short = -gate.side(&track[last]);
    if !within_slack(short, &track[last], &track[last - 1]) {
        return None;
    }
    let speed = end_speed(times, track, first, last, false)?;
    Some(End {
        time: f64::from(times[last]) + short / speed,
        projected_m: short.abs(),
        at: last,
    })
}

/// Whether an end sample `metres` from its gate, on either side, is inside the
/// slack a counted pass can fall short by: twice the ground tolerance, since
/// the matcher admits a run whose line comes within the tolerance of it and
/// cuts the pass where the line begins, plus the gap to the next sample in,
/// since the cut keeps the sample nearest the end and a sparse recording has
/// none closer.
fn within_slack(metres: f64, end: &GpsPoint, next_in: &GpsPoint) -> bool {
    metres.abs() <= CROSSING_REACH_M + local_distance(end, next_in)
}

/// The speed a pass moves at one of its ends, in metres per second.
///
/// Read over the samples nearest the end until they span the window, and the
/// pass's own average when that is a stop, so a pause just before the gate
/// does not stretch the projection. `None` when the pass does not move.
fn end_speed(
    times: &[u32],
    track: &[GpsPoint],
    first: usize,
    last: usize,
    at_start: bool,
) -> Option<f64> {
    let (end, step): (usize, isize) = if at_start { (first, 1) } else { (last, -1) };
    let mut path = 0.0;
    let mut at = end;
    while at != if at_start { last } else { first } {
        let next = (at as isize + step) as usize;
        path += local_distance(&track[at], &track[next]);
        at = next;
        let elapsed = (f64::from(times[at]) - f64::from(times[end])).abs();
        if elapsed >= END_SPEED_WINDOW_S || path >= END_SPEED_WINDOW_M {
            break;
        }
    }
    let elapsed = (f64::from(times[at]) - f64::from(times[end])).abs();
    let speed = if elapsed > 0.0 { path / elapsed } else { 0.0 };
    if speed >= MIN_END_SPEED_MPS {
        return Some(speed);
    }
    let whole: f64 = (first..last)
        .map(|k| local_distance(&track[k], &track[k + 1]))
        .sum();
    let span = f64::from(times[last]) - f64::from(times[first]);
    let average = if span > 0.0 { whole / span } else { 0.0 };
    (average.is_finite() && average > 0.0).then_some(average)
}

/// The interpolated time `gate` is crossed in its heading, at the segment
/// nearest sample `near`. `other` is the pass's other end: the whole pass
/// between the two is searched, so a pass that runs well past a gate before it
/// ends still finds the crossing it made on the way.
fn crossing_time(
    times: &[u32],
    track: &[GpsPoint],
    gate: &Gate,
    near: usize,
    other: usize,
) -> Option<(f64, usize)> {
    let within = |k: usize| {
        let (east, north) = local_offset(&gate.origin, &track[k]);
        east.hypot(north) <= CROSSING_REACH_M
    };
    // The segments either side of `near` are always read, so a recording
    // sampled more sparsely than the reach still finds its crossing.
    let mut from = near.saturating_sub(1);
    while from > 0 && within(from) {
        from -= 1;
    }
    let mut to = (near + 1).min(track.len() - 1);
    while to + 1 < track.len() && within(to) {
        to += 1;
    }
    from = from.min(near.min(other));
    to = to.max(near.max(other).min(track.len() - 1));
    let mut nearest: Option<(f64, f64, usize)> = None;
    for k in from..to {
        let before = gate.side(&track[k]);
        let after = gate.side(&track[k + 1]);
        if !(before <= 0.0 && after >= 0.0 && before < after) {
            continue;
        }
        let fraction = -before / (after - before);
        // A line is crossed somewhere along its whole length, and only the
        // crossing at the section's own ground is the gate. A pass the matcher
        // counts runs within the ground tolerance of the end, and one that
        // meets the gate at a slant crosses its line further out than that.
        if gate.offset_across(&track[k], &track[k + 1], fraction).abs() > CROSSING_REACH_M {
            continue;
        }
        let t0 = f64::from(times[k]);
        let t1 = f64::from(times[k + 1]);
        let gap = (k as f64 + 0.5 - near as f64).abs();
        if nearest.is_none_or(|(best, _, _)| gap < best) {
            nearest = Some((gap, t0 + fraction * (t1 - t0), k));
        }
    }
    nearest.map(|(_, time, at)| (time, at))
}

/// The pace of a pass whose time is `time_s`: the section's length over the
/// time for a pass of the section, the pass's own ground for a partial one.
pub(crate) fn pace_over(direction: &str, time_s: f64, section_m: f64, pass_m: f64) -> f64 {
    let metres = if direction == "partial" {
        pass_m
    } else {
        section_m
    };
    metres / time_s
}

/// Times passes against the stored sections and tracks.
///
/// The gates of every section are read once. A track is read when its
/// activity is first asked for and kept only until another activity is, so a
/// caller that walks its passes grouped by activity holds one track at a time.
pub(crate) struct PassTimer<'e> {
    engine: &'e PersistentEngine,
    sections: HashMap<String, SectionTiming>,
    track: Option<(String, Option<Vec<GpsPoint>>)>,
}

impl<'e> PassTimer<'e> {
    pub(crate) fn new<'s>(
        engine: &'e PersistentEngine,
        section_ids: impl IntoIterator<Item = &'s str>,
    ) -> Self {
        let mut sections = HashMap::new();
        for id in section_ids {
            if sections.contains_key(id) {
                continue;
            }
            let length = engine
                .db
                .query_row(
                    "SELECT distance_meters FROM sections WHERE id = ?",
                    [id],
                    |row| row.get::<_, f64>(0),
                )
                .ok();
            let line = crate::persistence::sections::geometry::stored_line(&engine.db, id).ok();
            if let Some(timing) = length
                .zip(line)
                .and_then(|(length, line)| SectionTiming::from_line(&line, length))
            {
                sections.insert(id.to_string(), timing);
            }
        }
        Self {
            engine,
            sections,
            track: None,
        }
    }

    /// The time of `pass` of `section_id` by `activity_id`, timed over
    /// `times`.
    pub(crate) fn time(
        &mut self,
        times: Option<&[u32]>,
        section_id: &str,
        activity_id: &str,
        pass: &PassSpan<'_>,
    ) -> PassTime {
        if self.track.as_ref().is_none_or(|(id, _)| id != activity_id) {
            self.track = Some((
                activity_id.to_string(),
                self.engine.get_gps_track(activity_id),
            ));
        }
        let track = self.track.as_ref().and_then(|(_, track)| track.as_deref());
        time_pass(times, track, self.sections.get(section_id), pass)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAT: f64 = 47.0;
    const LON: f64 = 7.0;
    const SECTION_M: f64 = 306.0;
    const SPEED: f64 = 2.4;

    /// A point `east` metres along the east-pointing section.
    fn at(east: f64) -> GpsPoint {
        GpsPoint::new(
            LAT,
            LON + east / (METRES_PER_DEGREE * LAT.to_radians().cos()),
        )
    }

    fn section() -> SectionTiming {
        let line: Vec<GpsPoint> = (0..=6).map(|i| at(f64::from(i) * 51.0)).collect();
        SectionTiming::from_line(&line, SECTION_M).unwrap()
    }

    /// One recording: positions along the line, one per sample, with the
    /// elapsed seconds of each.
    struct Recording {
        times: Vec<u32>,
        track: Vec<GpsPoint>,
    }

    /// An athlete moving at `speed` m/s from `from` to `to` metres, sampled
    /// every `interval` seconds starting `phase` seconds in.
    fn recording(from: f64, to: f64, speed: f64, interval: u32, phase: u32) -> Recording {
        let seconds = ((to - from).abs() / speed).ceil() as u32 + 1;
        let direction = (to - from).signum();
        let mut times = Vec::new();
        let mut track = Vec::new();
        let mut t = phase;
        while t <= seconds {
            times.push(t);
            track.push(at(from + direction * speed * f64::from(t)));
            t += interval;
        }
        Recording { times, track }
    }

    /// The half-open range the detector cuts: from the sample nearest `first`
    /// to the one after the sample nearest `last`.
    fn trimmed(recording: &Recording, first: f64, last: f64) -> (u32, u32) {
        let nearest = |east: f64| {
            recording
                .track
                .iter()
                .enumerate()
                .min_by(|a, b| {
                    let da = local_distance(a.1, &at(east));
                    let db = local_distance(b.1, &at(east));
                    da.total_cmp(&db)
                })
                .map(|(i, _)| i as u32)
                .unwrap()
        };
        (nearest(first), nearest(last) + 1)
    }

    fn timed(recording: &Recording, direction: &str, first: f64, last: f64) -> PassTime {
        let (start_index, end_index) = trimmed(recording, first, last);
        time_pass(
            Some(&recording.times),
            Some(&recording.track),
            Some(&section()),
            &PassSpan {
                direction,
                start_index,
                end_index,
                distance_meters: SECTION_M,
            },
        )
    }

    fn lap(recording: &Recording, direction: &str, first: f64, last: f64) -> Option<f64> {
        timed(recording, direction, first, last).time
    }

    #[test]
    fn a_constant_pace_is_timed_the_same_at_any_sampling() {
        let expected = SECTION_M / SPEED;
        for (interval, phase) in [(1, 0), (1, 0), (5, 0), (5, 1), (5, 2), (5, 3), (5, 4)] {
            let run = recording(-40.0, SECTION_M + 40.0, SPEED, interval, phase);
            let time = lap(&run, "same", 0.0, SECTION_M).unwrap();
            assert!(
                (time - expected).abs() < 0.1,
                "every {interval} s from {phase}: {time} against {expected}"
            );
        }
    }

    #[test]
    fn a_pass_trimmed_well_away_from_its_gates_is_still_timed() {
        let expected = SECTION_M / 3.0;
        let forward = recording(-100.0, SECTION_M + 100.0, 3.0, 1, 0);
        let entry = forward
            .times
            .iter()
            .position(|&t| 3.0 * f64::from(t) >= 100.0)
            .unwrap();
        let exit = forward
            .times
            .iter()
            .position(|&t| 3.0 * f64::from(t) >= 100.0 + SECTION_M)
            .unwrap();
        let span = |direction, start: usize, end: usize| PassSpan {
            direction,
            start_index: start as u32,
            end_index: end as u32,
            distance_meters: SECTION_M,
        };
        let same = time_pass(
            Some(&forward.times),
            Some(&forward.track),
            Some(&section()),
            &span("same", entry - 20, exit + 20),
        )
        .time
        .unwrap();
        assert!((same - expected).abs() < 0.1, "same {same}");

        let back = recording(SECTION_M + 100.0, -100.0, 3.0, 1, 0);
        let entry = back
            .times
            .iter()
            .position(|&t| 3.0 * f64::from(t) >= 100.0)
            .unwrap();
        let exit = back
            .times
            .iter()
            .position(|&t| 3.0 * f64::from(t) >= 100.0 + SECTION_M)
            .unwrap();
        let reverse = time_pass(
            Some(&back.times),
            Some(&back.track),
            Some(&section()),
            &span("reverse", entry - 20, exit + 20),
        )
        .time
        .unwrap();
        assert!((reverse - expected).abs() < 0.1, "reverse {reverse}");
    }

    #[test]
    fn a_pass_cut_short_of_the_ground_is_timed_over_the_ground() {
        // The detector's two cuts of the same ground: 293 m and 309 m of it.
        // The slower athlete's longer cut must not rank above the faster
        // one's.
        let faster = recording(-12.0, SECTION_M + 12.0, 2.45, 1, 0);
        let slower = recording(-3.0, SECTION_M + 3.0, 2.35, 1, 0);
        let record = lap(&faster, "same", 7.0, 300.0).unwrap();
        let today = lap(&slower, "same", 0.0, 309.0).unwrap();
        assert!((record - SECTION_M / 2.45).abs() < 0.1, "record {record}");
        assert!((today - SECTION_M / 2.35).abs() < 0.1, "today {today}");
        assert!(record < today);
    }

    #[test]
    fn pace_is_the_section_length_over_the_gate_time() {
        let run = recording(-40.0, SECTION_M + 40.0, SPEED, 3, 1);
        let (start_index, end_index) = trimmed(&run, 0.0, SECTION_M);
        let timed = time_pass(
            Some(&run.times),
            Some(&run.track),
            Some(&section()),
            &PassSpan {
                direction: "same",
                start_index,
                end_index,
                // The lap's own cut distance is not the pace's ground.
                distance_meters: 293.0,
            },
        );
        assert!((timed.pace.unwrap() - SECTION_M / timed.time.unwrap()).abs() < 1e-9);
    }

    #[test]
    fn a_pass_between_its_gates_carries_no_projection() {
        let run = recording(-40.0, SECTION_M + 40.0, SPEED, 1, 0);
        let timed = timed(&run, "same", 0.0, SECTION_M);
        assert_eq!(timed.projected_m, None);
        assert!(!is_estimated(timed.projected_m));
    }

    #[test]
    fn a_pass_starting_inside_the_section_is_projected_back_to_the_gate() {
        let run = recording(20.0, SECTION_M + 40.0, SPEED, 1, 0);
        let timed = timed(&run, "same", 20.0, SECTION_M);
        let time = timed.time.unwrap();
        assert!((time - SECTION_M / SPEED).abs() < 0.5, "{time}");
        let projected = timed.projected_m.unwrap();
        assert!((projected - 20.0).abs() < 1.0, "{projected}");
        assert!(is_estimated(timed.projected_m));
        assert!((timed.pace.unwrap() - SECTION_M / time).abs() < 1e-9);
    }

    #[test]
    fn a_pass_stopping_short_of_the_end_is_projected_forward_to_the_gate() {
        let run = recording(-40.0, SECTION_M - 30.0, SPEED, 1, 0);
        let timed = timed(&run, "same", 0.0, SECTION_M - 30.0);
        let time = timed.time.unwrap();
        assert!((time - SECTION_M / SPEED).abs() < 0.5, "{time}");
        assert!(is_estimated(timed.projected_m), "{:?}", timed.projected_m);
    }

    #[test]
    fn a_pass_short_at_both_ends_is_projected_at_both() {
        let run = recording(20.0, SECTION_M - 25.0, SPEED, 1, 0);
        let timed = timed(&run, "same", 20.0, SECTION_M - 25.0);
        let time = timed.time.unwrap();
        assert!((time - SECTION_M / SPEED).abs() < 1.0, "{time}");
    }

    #[test]
    fn a_reverse_pass_is_projected_at_its_own_ends() {
        let run = recording(SECTION_M - 20.0, -40.0, SPEED, 1, 0);
        let time = lap(&run, "reverse", SECTION_M - 20.0, 0.0).unwrap();
        assert!((time - SECTION_M / SPEED).abs() < 0.5, "{time}");
    }

    #[test]
    fn a_pass_deeper_inside_than_the_slack_has_no_time() {
        let run = recording(200.0, SECTION_M + 40.0, SPEED, 1, 0);
        assert_eq!(lap(&run, "same", 200.0, SECTION_M), None);
        let run = recording(-40.0, SECTION_M - 200.0, SPEED, 1, 0);
        assert_eq!(lap(&run, "same", 0.0, SECTION_M - 200.0), None);
    }

    #[test]
    fn the_slack_grows_with_the_sample_spacing() {
        // 10 m/s sampled every 5 s: 50 m between samples.
        let near = recording(120.0, SECTION_M + 100.0, 10.0, 5, 0);
        assert!(lap(&near, "same", 120.0, SECTION_M).is_some());
        let far = recording(250.0, SECTION_M + 100.0, 10.0, 5, 0);
        assert_eq!(lap(&far, "same", 250.0, SECTION_M), None);
    }

    #[test]
    fn a_projection_under_ten_metres_is_plain_and_over_is_estimated() {
        let plain = timed(
            &recording(9.0, SECTION_M + 40.0, SPEED, 1, 0),
            "same",
            9.0,
            SECTION_M,
        );
        assert!(plain.time.is_some());
        assert!(!is_estimated(plain.projected_m), "{:?}", plain.projected_m);

        let estimated = timed(
            &recording(25.0, SECTION_M + 40.0, SPEED, 1, 0),
            "same",
            25.0,
            SECTION_M,
        );
        assert!(is_estimated(estimated.projected_m));
    }

    #[test]
    fn a_stop_before_the_end_is_projected_at_the_passs_average_not_the_stop() {
        let stops_at = 3.0 + (SECTION_M - 10.0 + 40.0) / SPEED;
        let mut times = Vec::new();
        let mut track = Vec::new();
        for t in 0..=(stops_at as u32 + 60) {
            let moving = f64::from(t).min(stops_at);
            times.push(t);
            track.push(at(-40.0 + SPEED * moving));
        }
        let run = Recording { times, track };
        let last = run.times.len() as u32;
        let timed = time_pass(
            Some(&run.times),
            Some(&run.track),
            Some(&section()),
            &PassSpan {
                direction: "same",
                start_index: 0,
                end_index: last,
                distance_meters: SECTION_M,
            },
        );
        let time = timed.time.unwrap();
        let entered = 40.0 / SPEED;
        let stopped = f64::from(*run.times.last().unwrap());
        assert!(time > stopped - entered, "{time}");
        assert!(time < stopped - entered + 30.0, "{time}");
        assert!(!is_estimated(timed.projected_m), "{:?}", timed.projected_m);
    }

    #[test]
    fn a_pass_that_meets_both_gates_from_the_side_is_projected_at_both() {
        // 130 m south of the line, a run that never crosses either gate on the
        // section's own ground: it starts 40 m before the entry gate and ends
        // 6 m past the exit gate.
        let south = |east: f64| {
            GpsPoint::new(
                LAT - 130.0 / METRES_PER_DEGREE,
                LON + east / (METRES_PER_DEGREE * LAT.to_radians().cos()),
            )
        };
        let seconds = ((SECTION_M + 46.0) / SPEED) as u32;
        let times: Vec<u32> = (0..=seconds).collect();
        let track: Vec<GpsPoint> = times
            .iter()
            .map(|&t| south(-40.0 + SPEED * f64::from(t)))
            .collect();
        let timed = time_pass(
            Some(&times),
            Some(&track),
            Some(&section()),
            &PassSpan {
                direction: "same",
                start_index: 0,
                end_index: times.len() as u32,
                distance_meters: SECTION_M,
            },
        );
        let time = timed.time.unwrap();
        assert!((time - SECTION_M / SPEED).abs() < 1.0, "{time}");
        assert!(is_estimated(timed.projected_m));
    }

    fn loop_section() -> SectionTiming {
        // A square lap of 4 x 100 m whose start and end are one place.
        let corners = [
            (0.0, 0.0),
            (100.0, 0.0),
            (100.0, 100.0),
            (0.0, 100.0),
            (0.0, 0.0),
        ];
        let mut line = Vec::new();
        for pair in corners.windows(2) {
            for step in 0..10 {
                let f = f64::from(step) / 10.0;
                let east = pair[0].0 + f * (pair[1].0 - pair[0].0);
                let north = pair[0].1 + f * (pair[1].1 - pair[0].1);
                line.push(GpsPoint::new(
                    LAT + north / METRES_PER_DEGREE,
                    LON + east / (METRES_PER_DEGREE * LAT.to_radians().cos()),
                ));
            }
        }
        line.push(line[0]);
        SectionTiming::from_line(&line, 400.0).unwrap()
    }

    fn lap_from(start_m: f64, laps: f64) -> (Vec<u32>, Vec<GpsPoint>) {
        let corner = |d: f64| {
            let d = d.rem_euclid(400.0);
            let (east, north) = match d {
                d if d < 100.0 => (d, 0.0),
                d if d < 200.0 => (100.0, d - 100.0),
                d if d < 300.0 => (300.0 - d, 100.0),
                d => (0.0, 400.0 - d),
            };
            GpsPoint::new(
                LAT + north / METRES_PER_DEGREE,
                LON + east / (METRES_PER_DEGREE * LAT.to_radians().cos()),
            )
        };
        let seconds = (400.0 * laps / SPEED) as u32;
        let times: Vec<u32> = (0..=seconds).collect();
        let track = times
            .iter()
            .map(|&t| corner(start_m + SPEED * f64::from(t)))
            .collect();
        (times, track)
    }

    #[test]
    fn a_lap_of_a_closed_section_begun_away_from_its_gate_is_timed_as_a_whole_lap() {
        let (times, track) = lap_from(150.0, 1.0);
        let timed = time_pass(
            Some(&times),
            Some(&track),
            Some(&loop_section()),
            &PassSpan {
                direction: "same",
                start_index: 0,
                end_index: times.len() as u32,
                distance_meters: 400.0,
            },
        );
        let time = timed.time.unwrap();
        assert!((time - 400.0 / SPEED).abs() < 1.5, "{time}");
        assert!(is_estimated(timed.projected_m));
    }

    #[test]
    fn a_run_that_hardly_moves_on_a_closed_section_has_no_time() {
        let (times, track) = lap_from(250.0, 0.05);
        let timed = time_pass(
            Some(&times),
            Some(&track),
            Some(&loop_section()),
            &PassSpan {
                direction: "same",
                start_index: 0,
                end_index: times.len() as u32,
                distance_meters: 400.0,
            },
        );
        assert_eq!(timed.time, None);
    }

    #[test]
    fn a_pause_inside_the_section_counts() {
        let pause_s = 30.0;
        let stops_at = (150.0 + 40.0) / SPEED;
        let mut times = Vec::new();
        let mut track = Vec::new();
        for t in 0..=200u32 {
            let t_f = f64::from(t);
            let moving = if t_f < stops_at {
                t_f
            } else {
                stops_at.max(t_f - pause_s)
            };
            times.push(t);
            track.push(at(-40.0 + SPEED * moving));
        }
        let run = Recording { times, track };
        let time = lap(&run, "same", 0.0, SECTION_M).unwrap();
        assert!((time - (SECTION_M / SPEED + pause_s)).abs() < 0.5, "{time}");
    }

    #[test]
    fn the_reverse_direction_swaps_the_gates() {
        let run = recording(SECTION_M + 40.0, -40.0, SPEED, 5, 3);
        let time = lap(&run, "reverse", SECTION_M, 0.0).unwrap();
        assert!((time - SECTION_M / SPEED).abs() < 0.1, "{time}");
        assert_eq!(lap(&run, "same", SECTION_M, 0.0), None);
    }

    #[test]
    fn a_stream_of_another_length_than_the_track_times_nothing() {
        let mut run = recording(-40.0, SECTION_M + 40.0, SPEED, 1, 0);
        run.times.pop();
        assert_eq!(lap(&run, "same", 0.0, SECTION_M), None);
    }

    #[test]
    fn a_partial_pass_keeps_its_own_ground() {
        let run = recording(100.0, 200.0, SPEED, 1, 0);
        let timed = time_pass(
            Some(&run.times),
            Some(&run.track),
            Some(&section()),
            &PassSpan {
                direction: "partial",
                start_index: 0,
                end_index: run.times.len() as u32,
                distance_meters: 100.0,
            },
        );
        let elapsed = f64::from(*run.times.last().unwrap());
        assert_eq!(timed.time, Some(elapsed));
        assert!((timed.pace.unwrap() - 100.0 / elapsed).abs() < 1e-9);
        assert_eq!(timed.projected_m, None);
    }

    #[test]
    fn a_section_with_no_usable_line_has_no_gates() {
        assert_eq!(SectionTiming::from_line(&[at(0.0), at(2.0)], 306.0), None);
        assert_eq!(SectionTiming::from_line(&[at(0.0), at(60.0)], 0.0), None);
        assert_eq!(SectionTiming::from_line(&[], 306.0), None);
    }
}
