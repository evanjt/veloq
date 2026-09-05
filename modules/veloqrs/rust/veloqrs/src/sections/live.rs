//! Matching a live fix stream against a section catalogue.
//!
//! The batch detector cuts sections from a finished activity. This runs the
//! other way: one fix at a time, against lines that are already known, and
//! answers whether the athlete has just started one, is still on it, or has
//! left it. Nothing here touches the database, so a replay harness and the
//! recorder drive the same state machine.

use std::collections::HashSet;

use tracematch::GpsPoint;
use tracematch::geo_utils::haversine_distance;

/// Metres per degree of latitude, close enough for corridor arithmetic.
const METRES_PER_DEGREE: f64 = 111_320.0;

/// The thresholds the matcher arms and abandons on.
#[derive(Debug, Clone, Copy)]
pub struct LiveMatchConfig {
    /// How close to a section's first point a fix must fall to arm it.
    pub entry_radius_meters: f64,
    /// How close to the last point a fix must fall to close it.
    pub exit_radius_meters: f64,
    /// How far off the line a fix may sit before it counts as off corridor.
    pub corridor_meters: f64,
    /// How far the fix heading may differ from the section's opening bearing.
    pub bearing_tolerance_degrees: f64,
    /// Consecutive off-corridor fixes that abandon an armed section.
    pub off_corridor_fixes: u32,
    /// Consecutive moving fixes that make no progress before abandoning.
    pub stalled_fixes: u32,
    /// Fraction of the line that must be covered for an exit to count.
    pub min_progress_ratio: f64,
}

impl Default for LiveMatchConfig {
    fn default() -> Self {
        Self {
            entry_radius_meters: 25.0,
            exit_radius_meters: 30.0,
            corridor_meters: 40.0,
            bearing_tolerance_degrees: 60.0,
            off_corridor_fixes: 5,
            stalled_fixes: 20,
            min_progress_ratio: 0.9,
        }
    }
}

/// One fix off the recorder, or one replayed sample.
#[derive(Debug, Clone, Copy)]
pub struct Fix {
    pub point: GpsPoint,
    pub seconds: f64,
}

/// Why an armed section was given up on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbandonReason {
    /// The fixes drifted further off the line than the corridor allows.
    LeftCorridor,
    /// The athlete kept moving without covering any more of the line.
    Stalled,
}

/// What the matcher says about a section on one fix.
#[derive(Debug, Clone, PartialEq)]
pub enum LiveSectionEvent {
    Entered {
        section_id: String,
        seconds: f64,
    },
    Exited {
        section_id: String,
        seconds: f64,
        elapsed_seconds: f64,
    },
    Abandoned {
        section_id: String,
        seconds: f64,
        reason: AbandonReason,
    },
}

/// A section line the matcher watches for, with its along-line distances.
#[derive(Debug, Clone)]
pub struct LiveCandidate {
    pub section_id: String,
    points: Vec<GpsPoint>,
    cumulative: Vec<f64>,
    opening_bearing: Option<f64>,
}

impl LiveCandidate {
    /// A line of fewer than two points indexes nothing and is refused.
    pub fn new(section_id: impl Into<String>, points: Vec<GpsPoint>) -> Option<Self> {
        if points.len() < 2 {
            return None;
        }
        let mut cumulative = Vec::with_capacity(points.len());
        cumulative.push(0.0);
        for pair in points.windows(2) {
            let last = cumulative[cumulative.len() - 1];
            cumulative.push(last + haversine_distance(&pair[0], &pair[1]));
        }
        let opening_bearing = opening_bearing(&points, &cumulative);
        Some(Self {
            section_id: section_id.into(),
            points,
            cumulative,
            opening_bearing,
        })
    }

    pub fn distance_meters(&self) -> f64 {
        *self.cumulative.last().unwrap_or(&0.0)
    }

    pub fn start(&self) -> GpsPoint {
        self.points[0]
    }

    pub fn points(&self) -> &[GpsPoint] {
        &self.points
    }

    pub fn opening_bearing(&self) -> Option<f64> {
        self.opening_bearing
    }
}

/// The bearing of the first 20 metres of a line, which is what a fix heading
/// is compared against. A line shorter than that opens on its own endpoints.
fn opening_bearing(points: &[GpsPoint], cumulative: &[f64]) -> Option<f64> {
    let target = 20.0_f64.min(*cumulative.last()?);
    let index = cumulative.iter().position(|d| *d >= target)?.max(1);
    bearing(&points[0], &points[index])
}

/// Initial bearing from `from` to `to`, degrees clockwise from north. Two
/// coincident points have no bearing.
fn bearing(from: &GpsPoint, to: &GpsPoint) -> Option<f64> {
    let lat1 = from.latitude.to_radians();
    let lat2 = to.latitude.to_radians();
    let delta_lng = (to.longitude - from.longitude).to_radians();
    let y = delta_lng.sin() * lat2.cos();
    let x = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * delta_lng.cos();
    if y == 0.0 && x == 0.0 {
        return None;
    }
    Some(y.atan2(x).to_degrees().rem_euclid(360.0))
}

/// Smallest angle between two bearings, 0 to 180.
fn bearing_delta(a: f64, b: f64) -> f64 {
    let delta = (a - b).abs().rem_euclid(360.0);
    if delta > 180.0 { 360.0 - delta } else { delta }
}

/// Distance from `p` to the segment `a`-`b`, in metres, on a local
/// equirectangular projection. Over a corridor's width the projection error is
/// far below the noise in the fix itself.
fn distance_to_segment(p: &GpsPoint, a: &GpsPoint, b: &GpsPoint) -> f64 {
    let scale = p.latitude.to_radians().cos();
    let px = (p.longitude - a.longitude) * METRES_PER_DEGREE * scale;
    let py = (p.latitude - a.latitude) * METRES_PER_DEGREE;
    let bx = (b.longitude - a.longitude) * METRES_PER_DEGREE * scale;
    let by = (b.latitude - a.latitude) * METRES_PER_DEGREE;
    let length_squared = bx * bx + by * by;
    if length_squared == 0.0 {
        return (px * px + py * py).sqrt();
    }
    let t = ((px * bx + py * by) / length_squared).clamp(0.0, 1.0);
    let dx = px - t * bx;
    let dy = py - t * by;
    (dx * dx + dy * dy).sqrt()
}

/// How far forward along a line one fix is allowed to jump.
const FORWARD_WINDOW_METRES: f64 = 250.0;
/// How far back the search may reach, to absorb a fix that lands behind.
const BACKWARD_WINDOW_METRES: f64 = 50.0;
/// Displacement below which a fix counts as standing still.
const MOVING_METRES: f64 = 2.0;

#[derive(Debug, Clone, Copy)]
struct Armed {
    entered_seconds: f64,
    reached: usize,
    off_corridor: u32,
    stalled: u32,
}

/// The state machine, one instance per recording.
pub struct LiveSectionMatcher {
    config: LiveMatchConfig,
    candidates: Vec<LiveCandidate>,
    armed: Vec<Option<Armed>>,
    previous: Option<Fix>,
    heading: Option<f64>,
}

impl LiveSectionMatcher {
    pub fn new(candidates: Vec<LiveCandidate>, config: LiveMatchConfig) -> Self {
        let armed = vec![None; candidates.len()];
        Self {
            config,
            candidates,
            armed,
            previous: None,
            heading: None,
        }
    }

    pub fn candidate_count(&self) -> usize {
        self.candidates.len()
    }

    /// Add a candidate a catalogue query has just turned up. A section already
    /// watched keeps whatever state it has rather than starting over, so a
    /// refresh mid-section does not lose the entry.
    pub fn insert(&mut self, candidate: LiveCandidate) -> bool {
        if self
            .candidates
            .iter()
            .any(|c| c.section_id == candidate.section_id)
        {
            return false;
        }
        self.candidates.push(candidate);
        self.armed.push(None);
        true
    }

    /// Drop every unarmed candidate whose id is not in `keep`, and answer how
    /// many went. An armed one stays whatever the catalogue says: the athlete
    /// is on it, and the query that would re-offer it is keyed on a start point
    /// already behind them.
    pub fn retire(&mut self, keep: &HashSet<&str>) -> usize {
        let before = self.candidates.len();
        let mut index = 0;
        while index < self.candidates.len() {
            if self.armed[index].is_none()
                && !keep.contains(self.candidates[index].section_id.as_str())
            {
                self.candidates.remove(index);
                self.armed.remove(index);
            } else {
                index += 1;
            }
        }
        before - self.candidates.len()
    }

    /// Feed one fix. Events come back in candidate order, and a section can
    /// produce at most one event per fix.
    pub fn push(&mut self, fix: Fix) -> Vec<LiveSectionEvent> {
        if let Some(previous) = self.previous
            && haversine_distance(&previous.point, &fix.point) >= MOVING_METRES
            && let Some(heading) = bearing(&previous.point, &fix.point)
        {
            self.heading = Some(heading);
        }
        let moving = self
            .previous
            .map(|previous| haversine_distance(&previous.point, &fix.point) >= MOVING_METRES)
            .unwrap_or(false);

        let mut events = Vec::new();
        for index in 0..self.candidates.len() {
            let event = match self.armed[index] {
                Some(armed) => self.advance(index, armed, fix, moving),
                None => self.arm(index, fix),
            };
            if let Some(event) = event {
                events.push(event);
            }
        }
        self.previous = Some(fix);
        events
    }

    /// The sections currently armed, in candidate order.
    pub fn armed_ids(&self) -> Vec<&str> {
        self.candidates
            .iter()
            .zip(&self.armed)
            .filter(|(_, armed)| armed.is_some())
            .map(|(candidate, _)| candidate.section_id.as_str())
            .collect()
    }

    fn arm(&mut self, index: usize, fix: Fix) -> Option<LiveSectionEvent> {
        let candidate = &self.candidates[index];
        if haversine_distance(&fix.point, &candidate.start()) > self.config.entry_radius_meters {
            return None;
        }
        // A heading is only known once two fixes apart have arrived, and a
        // section with no opening bearing is a degenerate line. Either way the
        // gate cannot be applied, so it is not.
        if let (Some(heading), Some(opening)) = (self.heading, candidate.opening_bearing)
            && bearing_delta(heading, opening) > self.config.bearing_tolerance_degrees
        {
            return None;
        }
        self.armed[index] = Some(Armed {
            entered_seconds: fix.seconds,
            reached: 0,
            off_corridor: 0,
            stalled: 0,
        });
        Some(LiveSectionEvent::Entered {
            section_id: candidate.section_id.clone(),
            seconds: fix.seconds,
        })
    }

    fn advance(
        &mut self,
        index: usize,
        mut armed: Armed,
        fix: Fix,
        moving: bool,
    ) -> Option<LiveSectionEvent> {
        let candidate = &self.candidates[index];
        let (best, distance) = nearest_on_window(candidate, &fix.point, armed.reached);

        if distance > self.config.corridor_meters {
            armed.off_corridor += 1;
            if armed.off_corridor >= self.config.off_corridor_fixes {
                self.armed[index] = None;
                return Some(LiveSectionEvent::Abandoned {
                    section_id: candidate.section_id.clone(),
                    seconds: fix.seconds,
                    reason: AbandonReason::LeftCorridor,
                });
            }
            self.armed[index] = Some(armed);
            return None;
        }

        armed.off_corridor = 0;
        if best > armed.reached {
            armed.reached = best;
            armed.stalled = 0;
        } else if moving {
            armed.stalled += 1;
            if armed.stalled >= self.config.stalled_fixes {
                self.armed[index] = None;
                return Some(LiveSectionEvent::Abandoned {
                    section_id: candidate.section_id.clone(),
                    seconds: fix.seconds,
                    reason: AbandonReason::Stalled,
                });
            }
        }

        let total = candidate.distance_meters();
        let covered = candidate.cumulative[armed.reached];
        let last = candidate.points[candidate.points.len() - 1];
        let closed = total > 0.0
            && covered / total >= self.config.min_progress_ratio
            && haversine_distance(&fix.point, &last) <= self.config.exit_radius_meters;
        if closed {
            self.armed[index] = None;
            return Some(LiveSectionEvent::Exited {
                section_id: candidate.section_id.clone(),
                seconds: fix.seconds,
                elapsed_seconds: fix.seconds - armed.entered_seconds,
            });
        }

        self.armed[index] = Some(armed);
        None
    }
}

/// Nearest vertex to `point` within a window either side of `reached`, with
/// the perpendicular distance to the line there. Bounding the search is what
/// keeps the per-fix cost independent of how long the section is.
fn nearest_on_window(
    candidate: &LiveCandidate,
    point: &GpsPoint,
    reached: usize,
) -> (usize, f64) {
    let anchor = candidate.cumulative[reached];
    let first = candidate
        .cumulative
        .iter()
        .position(|d| *d >= anchor - BACKWARD_WINDOW_METRES)
        .unwrap_or(0);
    let last = candidate
        .cumulative
        .iter()
        .rposition(|d| *d <= anchor + FORWARD_WINDOW_METRES)
        .unwrap_or(candidate.points.len() - 1)
        .max(first);

    let mut best = reached;
    let mut best_distance = f64::MAX;
    for i in first..=last {
        let distance = if i + 1 < candidate.points.len() {
            distance_to_segment(point, &candidate.points[i], &candidate.points[i + 1])
        } else {
            haversine_distance(point, &candidate.points[i])
        };
        if distance < best_distance {
            best_distance = distance;
            best = i;
        }
    }
    (best, best_distance)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A straight eastward line of `count` points spaced `spacing` metres.
    fn line(lat: f64, lng: f64, count: usize, spacing: f64) -> Vec<GpsPoint> {
        let step = spacing / (METRES_PER_DEGREE * lat.to_radians().cos());
        (0..count)
            .map(|i| GpsPoint::new(lat, lng + step * i as f64))
            .collect()
    }

    fn replay(matcher: &mut LiveSectionMatcher, points: &[GpsPoint]) -> Vec<LiveSectionEvent> {
        let mut events = Vec::new();
        for (i, point) in points.iter().enumerate() {
            events.extend(matcher.push(Fix {
                point: *point,
                seconds: i as f64,
            }));
        }
        events
    }

    fn matcher(points: Vec<GpsPoint>) -> LiveSectionMatcher {
        let candidate = LiveCandidate::new("s1", points).expect("line of two points or more");
        LiveSectionMatcher::new(vec![candidate], LiveMatchConfig::default())
    }

    #[test]
    fn test_live_candidate_rejects_a_degenerate_line() {
        assert!(LiveCandidate::new("s1", vec![]).is_none());
        assert!(LiveCandidate::new("s1", vec![GpsPoint::new(-33.8, 151.2)]).is_none());
    }

    #[test]
    fn test_matcher_enters_and_exits_a_ridden_line() {
        let points = line(-33.8, 151.2, 21, 10.0);
        let mut matcher = matcher(points.clone());
        let events = replay(&mut matcher, &points);

        assert_eq!(
            events.first(),
            Some(&LiveSectionEvent::Entered {
                section_id: "s1".to_string(),
                seconds: 0.0,
            })
        );
        let exit = events.last().expect("an exit");
        match exit {
            LiveSectionEvent::Exited {
                elapsed_seconds, ..
            } => assert_eq!(*elapsed_seconds, 20.0), // 21 fixes at 1 Hz
            other => panic!("expected an exit, got {other:?}"),
        }
        assert!(matcher.armed_ids().is_empty());
    }

    #[test]
    fn test_matcher_does_not_arm_on_the_wrong_heading() {
        let points = line(-33.8, 151.2, 21, 10.0);
        let mut reversed = points.clone();
        reversed.reverse();
        let mut matcher = matcher(points);
        let events = replay(&mut matcher, &reversed);

        // The reversed ride passes the start point, arriving from the far end.
        assert!(events.is_empty(), "unexpected events: {events:?}");
    }

    #[test]
    fn test_matcher_arms_the_first_fix_without_a_heading() {
        // No previous fix means no heading, so the bearing gate cannot apply
        // and the entry stands on the radius alone.
        let points = line(-33.8, 151.2, 21, 10.0);
        let mut matcher = matcher(points.clone());
        let events = matcher.push(Fix {
            point: points[0],
            seconds: 0.0,
        });
        assert_eq!(events.len(), 1);
        assert_eq!(matcher.armed_ids(), vec!["s1"]);
    }

    #[test]
    fn test_matcher_abandons_a_ride_that_turns_off() {
        let points = line(-33.8, 151.2, 21, 10.0);
        let mut ridden: Vec<GpsPoint> = points[..5].to_vec();
        let step = 10.0 / METRES_PER_DEGREE;
        for i in 1..10 {
            ridden.push(GpsPoint::new(
                points[4].latitude - step * i as f64,
                points[4].longitude,
            ));
        }
        let mut matcher = matcher(points);
        let events = replay(&mut matcher, &ridden);

        assert!(matches!(events[0], LiveSectionEvent::Entered { .. }));
        let abandon = events.last().expect("an abandon");
        assert!(
            matches!(
                abandon,
                LiveSectionEvent::Abandoned {
                    reason: AbandonReason::LeftCorridor,
                    ..
                }
            ),
            "got {abandon:?}"
        );
        assert!(matcher.armed_ids().is_empty());
    }

    #[test]
    fn test_matcher_does_not_close_a_line_left_before_the_end() {
        let points = line(-33.8, 151.2, 21, 10.0);
        let mut matcher = matcher(points.clone());
        let events = replay(&mut matcher, &points[..15]);

        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], LiveSectionEvent::Entered { .. }));
        assert_eq!(matcher.armed_ids(), vec!["s1"]);
    }

    #[test]
    fn test_matcher_holds_a_line_through_a_stop() {
        let points = line(-33.8, 151.2, 21, 10.0);
        let mut ridden: Vec<GpsPoint> = points[..10].to_vec();
        for _ in 0..120 {
            ridden.push(points[9]);
        }
        ridden.extend_from_slice(&points[10..]);
        let mut matcher = matcher(points);
        let events = replay(&mut matcher, &ridden);

        assert!(
            !events
                .iter()
                .any(|e| matches!(e, LiveSectionEvent::Abandoned { .. })),
            "a stationary athlete was abandoned: {events:?}"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, LiveSectionEvent::Exited { .. }))
        );
    }

    #[test]
    fn test_matcher_abandons_a_moving_ride_that_stops_progressing() {
        // Back and forth over the same twenty metres, on the line the whole
        // time, so only the stall gate can end it.
        let points = line(-33.8, 151.2, 21, 10.0);
        let mut ridden: Vec<GpsPoint> = points[..4].to_vec();
        for _ in 0..20 {
            ridden.push(points[2]);
            ridden.push(points[3]);
        }
        let mut matcher = matcher(points);
        let events = replay(&mut matcher, &ridden);

        let abandon = events.last().expect("an abandon");
        assert!(
            matches!(
                abandon,
                LiveSectionEvent::Abandoned {
                    reason: AbandonReason::Stalled,
                    ..
                }
            ),
            "got {abandon:?}"
        );
    }

    #[test]
    fn test_matcher_can_re_enter_a_section_it_abandoned() {
        let points = line(-33.8, 151.2, 21, 10.0);
        let step = 10.0 / METRES_PER_DEGREE;
        let mut ridden: Vec<GpsPoint> = points[..3].to_vec();
        for i in 1..14 {
            ridden.push(GpsPoint::new(
                points[2].latitude - step * i as f64,
                points[2].longitude,
            ));
        }
        // Back to the start and all the way through.
        ridden.extend_from_slice(&points);
        let mut matcher = matcher(points);
        let events = replay(&mut matcher, &ridden);

        let entered = events
            .iter()
            .filter(|e| matches!(e, LiveSectionEvent::Entered { .. }))
            .count();
        assert_eq!(entered, 2);
        assert!(
            events
                .iter()
                .any(|e| matches!(e, LiveSectionEvent::Exited { .. }))
        );
    }

    #[test]
    fn test_matcher_tracks_two_overlapping_sections_independently() {
        let long = line(-33.8, 151.2, 41, 10.0);
        let short = long[..11].to_vec();
        let candidates = vec![
            LiveCandidate::new("long", long.clone()).unwrap(),
            LiveCandidate::new("short", short).unwrap(),
        ];
        let mut matcher = LiveSectionMatcher::new(candidates, LiveMatchConfig::default());
        let events = replay(&mut matcher, &long);

        let exited: Vec<&str> = events
            .iter()
            .filter_map(|e| match e {
                LiveSectionEvent::Exited { section_id, .. } => Some(section_id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(exited, vec!["short", "long"]);
    }

    #[test]
    fn test_insert_keeps_the_state_of_a_section_already_watched() {
        let points = line(-33.8, 151.2, 21, 10.0);
        let mut matcher = matcher(points.clone());
        replay(&mut matcher, &points[..5]);
        assert_eq!(matcher.armed_ids(), vec!["s1"]);

        let again = LiveCandidate::new("s1", points.clone()).unwrap();
        assert!(!matcher.insert(again));
        assert_eq!(matcher.candidate_count(), 1);
        assert_eq!(matcher.armed_ids(), vec!["s1"]);
    }

    #[test]
    fn test_retire_drops_the_unarmed_and_keeps_the_armed() {
        let points = line(-33.8, 151.2, 21, 10.0);
        let elsewhere = line(-34.5, 151.2, 21, 10.0);
        let candidates = vec![
            LiveCandidate::new("here", points.clone()).unwrap(),
            LiveCandidate::new("elsewhere", elsewhere).unwrap(),
        ];
        let mut matcher = LiveSectionMatcher::new(candidates, LiveMatchConfig::default());
        replay(&mut matcher, &points[..5]);
        assert_eq!(matcher.armed_ids(), vec!["here"]);

        let keep: HashSet<&str> = HashSet::new();
        assert_eq!(matcher.retire(&keep), 1);
        assert_eq!(matcher.candidate_count(), 1);
        assert_eq!(matcher.armed_ids(), vec!["here"]);
    }

    #[test]
    fn test_a_candidate_inserted_mid_ride_can_still_be_entered() {
        let first = line(-33.8, 151.2, 21, 10.0);
        let mut matcher = LiveSectionMatcher::new(vec![], LiveMatchConfig::default());
        assert!(matcher.push(Fix { point: first[0], seconds: 0.0 }).is_empty());

        assert!(matcher.insert(LiveCandidate::new("late", first.clone()).unwrap()));
        let events = replay(&mut matcher, &first);
        assert!(matches!(events[0], LiveSectionEvent::Entered { .. }));
        assert!(
            events
                .iter()
                .any(|e| matches!(e, LiveSectionEvent::Exited { .. }))
        );
    }

    #[test]
    fn test_bearing_delta_wraps_around_north() {
        assert_eq!(bearing_delta(350.0, 10.0), 20.0);
        assert_eq!(bearing_delta(10.0, 350.0), 20.0);
        assert_eq!(bearing_delta(0.0, 180.0), 180.0);
    }

    #[test]
    fn test_distance_to_segment_projects_onto_the_line() {
        let a = GpsPoint::new(-33.8, 151.2);
        let b = GpsPoint::new(-33.8, 151.21);
        let midpoint = GpsPoint::new(-33.8, 151.205);
        assert!(distance_to_segment(&midpoint, &a, &b) < 1.0);

        // Beyond the far end the distance is to the endpoint, not the line.
        let past = GpsPoint::new(-33.8, 151.22);
        let expected = haversine_distance(&past, &b);
        assert!((distance_to_segment(&past, &a, &b) - expected).abs() < 2.0);
    }
}
