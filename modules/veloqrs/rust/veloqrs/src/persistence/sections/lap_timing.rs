//! The time of one pass over a section.
//!
//! Every pass is timed between the same two gates: the line across the section
//! at its start and the line across it at its end, each perpendicular to the
//! section line. The crossing time of a gate is interpolated between the two
//! samples either side of it, so a pass covers exactly the section's ground and
//! the time does not depend on where the recording happened to place its
//! samples. A pass that does not cross both gates, because the recording began
//! inside the section or stopped short of its end, has no time and is never
//! ranked.
//!
//! Pace is the section's length over that time, so pace and time rank every
//! pass the same way.

use std::collections::HashMap;

use crate::GpsPoint;
use crate::persistence::PersistentEngine;

/// How far from a gate's origin, in ground metres, the samples either side of
/// a pass's trimmed end are searched for the crossing. The trim keeps the
/// sample nearest each end by distance and admits one up to the ground
/// tolerance short of the line, so on a sideways approach the crossing is
/// any number of samples away, however densely the recording was sampled.
/// Twice the tolerance reaches past any such sample, and a crossing further
/// out is rejected by the ground check anyway.
const CROSSING_REACH_M: f64 = 2.0 * tracematch::sections::GROUND_TOL_M;

/// The ground a gate's direction is taken over.
const GATE_ARM_M: f64 = 5.0;

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

/// `(time, pace)` of one pass, both `None` when it cannot be timed.
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
) -> (Option<f64>, Option<f64>) {
    let (Some(times), Some(track)) = (times, track) else {
        return (None, None);
    };
    // A stream that is not the track's length is not in the track's index
    // space. Every 0.3.x stored the raw series, which keeps the samples the
    // coordinate mask drops, and indexing that with track indices reads the
    // wrong window.
    if track.len() != times.len() {
        return (None, None);
    }
    if pass.end_index == 0 || pass.end_index as usize > times.len() {
        return (None, None);
    }
    let first = pass.start_index as usize;
    let last = pass.end_index as usize - 1;
    if first >= times.len() || last <= first {
        return (None, None);
    }
    if pass.direction == "partial" {
        let elapsed = (f64::from(times[last]) - f64::from(times[first])).abs();
        return positive(elapsed, pass, section.map_or(0.0, SectionTiming::length_m));
    }
    let Some(section) = section else {
        return (None, None);
    };
    let (entry, exit) = section.gates_for(pass.direction == "reverse");
    let (Some(entered), Some(left)) = (
        crossing_time(times, track, &entry, first),
        crossing_time(times, track, &exit, last),
    ) else {
        return (None, None);
    };
    positive(left - entered, pass, section.length_m)
}

fn positive(elapsed: f64, pass: &PassSpan<'_>, section_m: f64) -> (Option<f64>, Option<f64>) {
    if elapsed.is_finite() && elapsed > 0.0 {
        let pace = pace_over(pass.direction, elapsed, section_m, pass.distance_meters);
        (Some(elapsed), Some(pace))
    } else {
        (None, None)
    }
}

/// The interpolated time `gate` is crossed in its heading, at the segment
/// nearest sample `near`.
fn crossing_time(times: &[u32], track: &[GpsPoint], gate: &Gate, near: usize) -> Option<f64> {
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
    let mut nearest: Option<(f64, f64)> = None;
    for k in from..to {
        let before = gate.side(&track[k]);
        let after = gate.side(&track[k + 1]);
        if !(before <= 0.0 && after >= 0.0 && before < after) {
            continue;
        }
        let fraction = -before / (after - before);
        // A line is crossed somewhere along its whole length, and only the
        // crossing at the section's own ground is the gate.
        if gate.offset_across(&track[k], &track[k + 1], fraction).abs()
            > tracematch::sections::GROUND_TOL_M
        {
            continue;
        }
        let t0 = f64::from(times[k]);
        let t1 = f64::from(times[k + 1]);
        let gap = (k as f64 + 0.5 - near as f64).abs();
        if nearest.is_none_or(|(best, _)| gap < best) {
            nearest = Some((gap, t0 + fraction * (t1 - t0)));
        }
    }
    nearest.map(|(_, time)| time)
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

    /// `(time, pace)` of `pass` of `section_id` by `activity_id`, timed over
    /// `times`.
    pub(crate) fn time(
        &mut self,
        times: Option<&[u32]>,
        section_id: &str,
        activity_id: &str,
        pass: &PassSpan<'_>,
    ) -> (Option<f64>, Option<f64>) {
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

    fn lap(recording: &Recording, direction: &str, first: f64, last: f64) -> Option<f64> {
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
        .0
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
        .0
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
        .0
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
        let (time, pace) = time_pass(
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
        assert!((pace.unwrap() - SECTION_M / time.unwrap()).abs() < 1e-9);
    }

    #[test]
    fn a_recording_that_starts_inside_the_section_has_no_time() {
        let run = recording(20.0, SECTION_M + 40.0, SPEED, 1, 0);
        assert_eq!(lap(&run, "same", 20.0, SECTION_M), None);
    }

    #[test]
    fn a_recording_that_stops_short_of_the_end_has_no_time() {
        let run = recording(-40.0, SECTION_M - 20.0, SPEED, 1, 0);
        assert_eq!(lap(&run, "same", 0.0, SECTION_M - 20.0), None);
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
        let (time, pace) = time_pass(
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
        assert_eq!(time, Some(elapsed));
        assert!((pace.unwrap() - 100.0 / elapsed).abs() < 1e-9);
    }

    #[test]
    fn a_section_with_no_usable_line_has_no_gates() {
        assert_eq!(SectionTiming::from_line(&[at(0.0), at(2.0)], 306.0), None);
        assert_eq!(SectionTiming::from_line(&[at(0.0), at(60.0)], 0.0), None);
        assert_eq!(SectionTiming::from_line(&[], 306.0), None);
    }
}
