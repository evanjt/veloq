//! Following a saved route: each fix of a ride is placed on the route's line
//! and answered with the distance along and remaining, how far off the line it
//! is, the bearings, whether the ride has joined or left the route, and the
//! direction it runs the route in.
//!
//! The route is laid out once in local metres, simplified, and held with its
//! prefix distances. A fix is then matched against a window of segments around
//! the last match, so the cost per fix does not grow with the route's length
//! and a route that crosses itself is followed along and not across.

use crate::GpsPoint;

/// Metres to a degree of latitude, the scale the nearby-route read uses.
const METRES_PER_DEGREE: f64 = 111_320.0;

/// Douglas-Peucker tolerance for the followed line. A saved route's raw track
/// has a median of 1,294 vertices and at most 9,246; at 5 m it has a median of
/// 91 and at most 518.
const SIMPLIFY_TOLERANCE_M: f64 = 5.0;

/// How far either side of the last match, along the route, a fix is searched.
/// A window of this size visited at most 95 segments for 95 % of fixes.
const WINDOW_M: f64 = 300.0;

/// A windowed match further than this from the fix is searched again over the
/// whole route, because the ride has left the window.
const RESEARCH_M: f64 = 50.0;

/// A ride joins the route at its first fix this close to it. Against the
/// representative of a repeated route, 10 % to 16 % of fixes lie over 30 m
/// away, mostly before the ride joins and after it leaves.
pub(crate) const JOIN_M: f64 = 30.0;

/// A joined ride is off the route once its fixes have been this far away for
/// more than [`OFF_ROUTE_FIXES`] in a row.
pub(crate) const OFF_ROUTE_M: f64 = 75.0;

/// Consecutive fixes over [`OFF_ROUTE_M`] that must precede the one that
/// turns the state to off-route, so a single stray fix never does.
pub(crate) const OFF_ROUTE_FIXES: u32 = 10;

/// An off-route ride is back on the route under this distance.
pub(crate) const RETURN_M: f64 = 30.0;

/// Net distance along the route, from the first on-route fix, at which the
/// direction is decided. 21 % to 32 % of repeat rides run the route in reverse.
pub(crate) const DIRECTION_M: f64 = 100.0;

/// Heading change that makes a turn, accumulated over at most
/// [`TURN_WINDOW_M`] of route. Measured on the 5 m line: the raw 1 Hz line
/// has a median of 22.4 turns per km at this threshold and the simplified line
/// 6.8, so the turn is defined on the simplified line only.
pub(crate) const TURN_MIN_ANGLE_DEG: f64 = 45.0;

/// Route length over which heading changes add up to one turn. A turn that
/// follows another within this distance is part of it, so a hairpin is one turn.
pub(crate) const TURN_WINDOW_M: f64 = 30.0;

/// Segments shorter than this are jitter the simplification left behind and
/// take no part in a turn.
pub(crate) const TURN_MIN_SEGMENT_M: f64 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FollowStatus {
    NotJoined,
    OnRoute,
    OffRoute,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FollowDirection {
    Undecided,
    Forward,
    Reverse,
}

/// A turn on the followed line, in the route's own direction.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiRouteTurn")]
pub struct RouteTurn {
    /// Metres from the route's start to where the turn begins.
    pub along_m: f64,
    /// Signed heading change in degrees: a left turn is negative, a right turn positive.
    pub angle_deg: f64,
    pub lat: f64,
    pub lng: f64,
}

/// The first turn ahead of a ride.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiNextTurn")]
pub struct NextTurn {
    /// Metres from the route's start to where the turn begins, the same value as the
    /// `along_m` of that turn in `turns()`, so a caller can find it there.
    pub along_m: f64,
    /// Metres along the route, in the ride's direction, to where the turn begins.
    pub distance_m: f64,
    /// Signed heading change as the ride meets it: a left turn is negative, a
    /// right turn positive, and the sign flips when the route is ridden in reverse.
    pub angle_deg: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FollowFix {
    /// Metres from the route's start to the matched point.
    pub(crate) along_m: f64,
    /// Metres from the matched point to the route's end when the ride runs
    /// forward or is undecided, and to its start when it runs in reverse.
    pub(crate) remaining_m: f64,
    /// Distance from the fix to the matched point.
    pub(crate) cross_track_m: f64,
    /// Bearing of the matched segment in the direction of the ride, degrees
    /// clockwise from north.
    pub(crate) route_bearing_deg: f64,
    /// Bearing from the fix to the matched point. The route's own bearing
    /// when the fix lies on the line.
    pub(crate) bearing_to_route_deg: f64,
    pub(crate) status: FollowStatus,
    pub(crate) direction: FollowDirection,
    /// The first turn ahead in the ride's direction. `None` until the ride is
    /// on the route with its direction decided, and while it is off the route.
    pub(crate) next_turn: Option<NextTurn>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FollowBuildError {
    /// Fewer than two points that pass the recorded-fix rule.
    TooFewPoints,
    /// The points are all one place.
    NoLength,
}

impl std::fmt::Display for FollowBuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooFewPoints => f.write_str("the route has fewer than two recorded positions"),
            Self::NoLength => f.write_str("the route has no length"),
        }
    }
}

/// A position in metres on a local flat plane, east then north.
pub(crate) type Metres = [f64; 2];

/// The nearest point of one segment to a fix.
#[derive(Debug, Clone, Copy)]
struct Hit {
    segment: usize,
    along_m: f64,
    distance_m: f64,
    point: Metres,
}

pub(crate) struct FollowerCore {
    origin_lat: f64,
    origin_lng: f64,
    metres_per_lng_degree: f64,
    vertices: Vec<Metres>,
    /// Distance from the start to each vertex, `vertices.len()` entries.
    prefix_m: Vec<f64>,
    turns: Vec<RouteTurn>,
    last_along_m: Option<f64>,
    first_on_route_along_m: Option<f64>,
    over_off_route: u32,
    last: FollowFix,
    visited: usize,
}

impl FollowerCore {
    pub(crate) fn build(track: &[GpsPoint]) -> Result<Self, FollowBuildError> {
        let mut fixes = track
            .iter()
            .filter(|p| crate::net::types::is_recorded_fix(p.latitude, p.longitude));
        let first = fixes.next().ok_or(FollowBuildError::TooFewPoints)?;
        let metres_per_lng_degree = METRES_PER_DEGREE * first.latitude.to_radians().cos();
        let project = |p: &GpsPoint| -> Metres {
            [
                (p.longitude - first.longitude) * metres_per_lng_degree,
                (p.latitude - first.latitude) * METRES_PER_DEGREE,
            ]
        };

        let mut laid_out: Vec<Metres> = vec![[0.0, 0.0]];
        let mut recorded = 1;
        for point in fixes {
            recorded += 1;
            let metres = project(point);
            if laid_out.last() != Some(&metres) {
                laid_out.push(metres);
            }
        }
        if recorded < 2 {
            return Err(FollowBuildError::TooFewPoints);
        }
        if laid_out.len() < 2 {
            return Err(FollowBuildError::NoLength);
        }

        let vertices = simplify(&laid_out, SIMPLIFY_TOLERANCE_M);
        let mut prefix_m = Vec::with_capacity(vertices.len());
        let mut total = 0.0;
        prefix_m.push(total);
        for pair in vertices.windows(2) {
            total += distance(pair[0], pair[1]);
            prefix_m.push(total);
        }
        if total <= 0.0 {
            return Err(FollowBuildError::NoLength);
        }

        let turns = find_turns(&vertices, &prefix_m)
            .into_iter()
            .map(|(along_m, angle_deg, [x, y])| RouteTurn {
                along_m,
                angle_deg,
                lat: first.latitude + y / METRES_PER_DEGREE,
                lng: first.longitude + x / metres_per_lng_degree,
            })
            .collect();

        let mut core = Self {
            origin_lat: first.latitude,
            origin_lng: first.longitude,
            metres_per_lng_degree,
            vertices,
            prefix_m,
            turns,
            last_along_m: None,
            first_on_route_along_m: None,
            over_off_route: 0,
            last: FollowFix {
                along_m: 0.0,
                remaining_m: total,
                cross_track_m: 0.0,
                route_bearing_deg: 0.0,
                bearing_to_route_deg: 0.0,
                status: FollowStatus::NotJoined,
                direction: FollowDirection::Undecided,
                next_turn: None,
            },
            visited: 0,
        };
        core.last.route_bearing_deg = core.segment_bearing(0);
        Ok(core)
    }

    pub(crate) fn segment_count(&self) -> usize {
        self.vertices.len() - 1
    }

    /// Segments the latest `advance` measured a fix against, the cost the tests bound.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn last_segments_visited(&self) -> usize {
        self.visited
    }

    /// The turns of the route in its own direction, nearest the start first.
    pub(crate) fn turns(&self) -> &[RouteTurn] {
        &self.turns
    }

    pub(crate) fn length_m(&self) -> f64 {
        self.prefix_m[self.prefix_m.len() - 1]
    }

    /// Place one fix. A fix that is not a recorded position changes nothing
    /// and answers the previous record.
    pub(crate) fn advance(&mut self, latitude: f64, longitude: f64) -> FollowFix {
        if !crate::net::types::is_recorded_fix(latitude, longitude) {
            return self.last;
        }
        let fix = [
            (longitude - self.origin_lng) * self.metres_per_lng_degree,
            (latitude - self.origin_lat) * METRES_PER_DEGREE,
        ];
        self.visited = 0;
        let mut hit = match self.last_along_m {
            Some(along) => self.search_window(fix, along),
            None => self.search_all(fix),
        };
        if hit.distance_m > RESEARCH_M && self.last_along_m.is_some() {
            hit = self.search_all(fix);
        }
        self.last_along_m = Some(hit.along_m);

        let status = self.next_status(hit.distance_m);
        if status == FollowStatus::OnRoute && self.first_on_route_along_m.is_none() {
            self.first_on_route_along_m = Some(hit.along_m);
        }
        let mut direction = self.last.direction;
        if direction == FollowDirection::Undecided && status == FollowStatus::OnRoute {
            let progress = hit.along_m - self.first_on_route_along_m.unwrap_or(hit.along_m);
            if progress >= DIRECTION_M {
                direction = FollowDirection::Forward;
            } else if progress <= -DIRECTION_M {
                direction = FollowDirection::Reverse;
            }
        }

        let reverse = direction == FollowDirection::Reverse;
        let segment_bearing = self.segment_bearing(hit.segment);
        let route_bearing_deg = if reverse {
            (segment_bearing + 180.0).rem_euclid(360.0)
        } else {
            segment_bearing
        };
        let bearing_to_route_deg = if hit.distance_m > 1e-6 {
            bearing(fix, hit.point)
        } else {
            route_bearing_deg
        };
        self.last = FollowFix {
            along_m: hit.along_m,
            remaining_m: if reverse {
                hit.along_m
            } else {
                self.length_m() - hit.along_m
            },
            cross_track_m: hit.distance_m,
            route_bearing_deg,
            bearing_to_route_deg,
            status,
            direction,
            next_turn: if status == FollowStatus::OnRoute {
                self.next_turn(hit.along_m, direction)
            } else {
                None
            },
        };
        self.last
    }

    /// The first turn ahead of `along_m` in the ride's direction.
    fn next_turn(&self, along_m: f64, direction: FollowDirection) -> Option<NextTurn> {
        match direction {
            FollowDirection::Undecided => None,
            FollowDirection::Forward => {
                let index = self.turns.partition_point(|turn| turn.along_m < along_m);
                self.turns.get(index).map(|turn| NextTurn {
                    along_m: turn.along_m,
                    distance_m: turn.along_m - along_m,
                    angle_deg: turn.angle_deg,
                })
            }
            FollowDirection::Reverse => {
                let index = self.turns.partition_point(|turn| turn.along_m <= along_m);
                index.checked_sub(1).map(|index| {
                    let turn = &self.turns[index];
                    NextTurn {
                        along_m: turn.along_m,
                        distance_m: along_m - turn.along_m,
                        angle_deg: -turn.angle_deg,
                    }
                })
            }
        }
    }

    fn next_status(&mut self, distance_m: f64) -> FollowStatus {
        match self.last.status {
            FollowStatus::NotJoined if distance_m <= JOIN_M => FollowStatus::OnRoute,
            FollowStatus::NotJoined => FollowStatus::NotJoined,
            FollowStatus::OnRoute => {
                if distance_m > OFF_ROUTE_M {
                    self.over_off_route += 1;
                } else {
                    self.over_off_route = 0;
                }
                if self.over_off_route > OFF_ROUTE_FIXES {
                    FollowStatus::OffRoute
                } else {
                    FollowStatus::OnRoute
                }
            }
            FollowStatus::OffRoute if distance_m < RETURN_M => {
                self.over_off_route = 0;
                FollowStatus::OnRoute
            }
            FollowStatus::OffRoute => FollowStatus::OffRoute,
        }
    }

    fn search_all(&mut self, fix: Metres) -> Hit {
        self.search(fix, 0, self.segment_count())
    }

    fn search_window(&mut self, fix: Metres, along_m: f64) -> Hit {
        let from = self
            .prefix_m
            .partition_point(|&at| at < along_m - WINDOW_M)
            .saturating_sub(1);
        let to = self
            .prefix_m
            .partition_point(|&at| at <= along_m + WINDOW_M)
            .min(self.segment_count());
        self.search(fix, from, to.max(from + 1).min(self.segment_count()))
    }

    /// The nearest point of segments `from..to` to the fix.
    fn search(&mut self, fix: Metres, from: usize, to: usize) -> Hit {
        let mut best: Option<Hit> = None;
        for segment in from..to {
            self.visited += 1;
            let (a, b) = (self.vertices[segment], self.vertices[segment + 1]);
            let (point, t) = nearest_on_segment(fix, a, b);
            let distance_m = distance(fix, point);
            if best.is_none_or(|current| distance_m < current.distance_m) {
                best = Some(Hit {
                    segment,
                    along_m: self.prefix_m[segment] + t * distance(a, b),
                    distance_m,
                    point,
                });
            }
        }
        best.expect("a window holds at least one segment")
    }

    fn segment_bearing(&self, segment: usize) -> f64 {
        bearing(self.vertices[segment], self.vertices[segment + 1])
    }
}

fn distance(a: Metres, b: Metres) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

/// Degrees clockwise from north of the direction from `from` to `to`.
fn bearing(from: Metres, to: Metres) -> f64 {
    (to[0] - from[0])
        .atan2(to[1] - from[1])
        .to_degrees()
        .rem_euclid(360.0)
}

/// The point of segment `a`-`b` nearest to `p`, and its fraction along it.
fn nearest_on_segment(p: Metres, a: Metres, b: Metres) -> (Metres, f64) {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length_squared = dx * dx + dy * dy;
    let t = if length_squared > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_squared).clamp(0.0, 1.0)
    } else {
        0.0
    };
    ([a[0] + t * dx, a[1] + t * dy], t)
}

/// Heading change in degrees from `from` to `to`, in (-180, 180], clockwise positive.
fn heading_change(from: f64, to: f64) -> f64 {
    let change = (to - from).rem_euclid(360.0);
    if change > 180.0 {
        change - 360.0
    } else {
        change
    }
}

/// The turns of a simplified line: the heading change at each vertex between
/// segments of at least [`TURN_MIN_SEGMENT_M`] is summed over at most
/// [`TURN_WINDOW_M`] of route, and where the sum reaches [`TURN_MIN_ANGLE_DEG`]
/// a turn is recorded where the sum started. The scan resumes after the window,
/// so the next turn begins further on than the window and two turns never
/// overlap. Each is `(along_m, angle_deg, position)`.
fn find_turns(vertices: &[Metres], prefix_m: &[f64]) -> Vec<(f64, f64, Metres)> {
    // (vertex the segment starts at, its heading), jitter segments left out.
    let headings: Vec<(usize, f64)> = (0..vertices.len() - 1)
        .filter(|&i| distance(vertices[i], vertices[i + 1]) >= TURN_MIN_SEGMENT_M)
        .map(|i| (i, bearing(vertices[i], vertices[i + 1])))
        .collect();
    let changes: Vec<(usize, f64)> = headings
        .windows(2)
        .map(|pair| (pair[1].0, heading_change(pair[0].1, pair[1].1)))
        .collect();

    let mut turns = Vec::new();
    let mut at = 0;
    while at < changes.len() {
        let start_m = prefix_m[changes[at].0];
        let mut sum = 0.0;
        let mut end = at;
        while end < changes.len() && prefix_m[changes[end].0] - start_m <= TURN_WINDOW_M {
            sum += changes[end].1;
            end += 1;
        }
        if sum.abs() >= TURN_MIN_ANGLE_DEG {
            turns.push((start_m, sum, vertices[changes[at].0]));
            at = end;
        } else {
            at += 1;
        }
    }
    turns
}

/// Douglas-Peucker over `points`, keeping the first and last and every vertex
/// that lies more than `tolerance_m` from the line kept so far.
pub(crate) fn simplify(points: &[Metres], tolerance_m: f64) -> Vec<Metres> {
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut ranges = vec![(0, points.len() - 1)];
    while let Some((from, to)) = ranges.pop() {
        let mut farthest = (0.0, from);
        for index in from + 1..to {
            let (nearest, _) = nearest_on_segment(points[index], points[from], points[to]);
            let away = distance(points[index], nearest);
            if away > farthest.0 {
                farthest = (away, index);
            }
        }
        if farthest.0 > tolerance_m {
            keep[farthest.1] = true;
            ranges.push((from, farthest.1));
            ranges.push((farthest.1, to));
        }
    }
    points
        .iter()
        .zip(keep)
        .filter_map(|(point, kept)| kept.then_some(*point))
        .collect()
}

impl From<FollowStatus> for crate::FfiFollowStatus {
    fn from(status: FollowStatus) -> Self {
        match status {
            FollowStatus::NotJoined => Self::NotJoined,
            FollowStatus::OnRoute => Self::OnRoute,
            FollowStatus::OffRoute => Self::OffRoute,
        }
    }
}

impl From<FollowDirection> for crate::FfiFollowDirection {
    fn from(direction: FollowDirection) -> Self {
        match direction {
            FollowDirection::Undecided => Self::Undecided,
            FollowDirection::Forward => Self::Forward,
            FollowDirection::Reverse => Self::Reverse,
        }
    }
}

impl From<FollowFix> for crate::FfiRouteFollow {
    fn from(fix: FollowFix) -> Self {
        Self {
            along_m: fix.along_m,
            remaining_m: fix.remaining_m,
            cross_track_m: fix.cross_track_m,
            route_bearing_deg: fix.route_bearing_deg,
            bearing_to_route_deg: fix.bearing_to_route_deg,
            status: fix.status.into(),
            direction: fix.direction.into(),
            next_turn: fix.next_turn,
        }
    }
}
