//! The follower over invented routes laid out in metres east and north of a
//! fixed origin, so each expected distance is the one the layout states.

use super::follower::{FollowBuildError, FollowDirection, FollowFix, FollowStatus, FollowerCore};
use crate::GpsPoint;

const ORIGIN_LAT: f64 = 47.0;
const ORIGIN_LNG: f64 = 7.0;
const METRES_PER_DEGREE: f64 = 111_320.0;

fn at(east: f64, north: f64) -> GpsPoint {
    let lat = ORIGIN_LAT + north / METRES_PER_DEGREE;
    let lng = ORIGIN_LNG + east / (METRES_PER_DEGREE * ORIGIN_LAT.to_radians().cos());
    GpsPoint::new(lat, lng)
}

/// `corners` joined by a vertex every `step` metres.
fn track_through(corners: &[(f64, f64)], step: f64) -> Vec<GpsPoint> {
    let mut points = vec![at(corners[0].0, corners[0].1)];
    for pair in corners.windows(2) {
        let (from, to) = (pair[0], pair[1]);
        let length = (to.0 - from.0).hypot(to.1 - from.1);
        let steps = (length / step).ceil() as usize;
        for index in 1..=steps {
            let t = index as f64 / steps as f64;
            points.push(at(
                from.0 + (to.0 - from.0) * t,
                from.1 + (to.1 - from.1) * t,
            ));
        }
    }
    points
}

/// A 2 km line running north from the origin.
fn straight_route() -> FollowerCore {
    FollowerCore::build(&track_through(&[(0.0, 0.0), (0.0, 2_000.0)], 10.0)).unwrap()
}

fn step(core: &mut FollowerCore, east: f64, north: f64) -> FollowFix {
    let point = at(east, north);
    core.advance(point.latitude, point.longitude)
}

fn bearing_difference(a: f64, b: f64) -> f64 {
    let difference = (a - b).rem_euclid(360.0);
    difference.min(360.0 - difference)
}

#[test]
fn a_fix_beside_the_midpoint_is_on_route_half_way() {
    let mut core = straight_route();

    let fix = step(&mut core, 5.0, 1_000.0);

    assert_eq!(fix.status, FollowStatus::OnRoute);
    assert!(
        (fix.along_m - 1_000.0).abs() < 10.0,
        "along {}",
        fix.along_m
    );
    assert!(
        (fix.remaining_m - 1_000.0).abs() < 10.0,
        "remaining {}",
        fix.remaining_m
    );
    assert!(
        (fix.cross_track_m - 5.0).abs() < 1.0,
        "cross {}",
        fix.cross_track_m
    );
    assert!(
        bearing_difference(fix.bearing_to_route_deg, 270.0) < 1.0,
        "bearing to route {}",
        fix.bearing_to_route_deg
    );
    assert!(bearing_difference(fix.route_bearing_deg, 0.0) < 1.0);
}

#[test]
fn a_ride_is_not_joined_until_a_fix_is_within_thirty_metres() {
    let mut core = straight_route();

    for east in [500.0, 400.0, 300.0, 200.0, 100.0, 80.0, 60.0, 40.0, 31.0] {
        let fix = step(&mut core, east, 400.0);
        assert_eq!(fix.status, FollowStatus::NotJoined, "at {east} m");
    }
    for _ in 0..30 {
        let fix = step(&mut core, 500.0, 400.0);
        assert_eq!(fix.status, FollowStatus::NotJoined);
    }
    let joined = step(&mut core, 25.0, 400.0);

    assert_eq!(joined.status, FollowStatus::OnRoute);
}

#[test]
fn eleven_fixes_over_seventy_five_metres_leave_the_route_on_the_eleventh() {
    let mut core = straight_route();
    step(&mut core, 0.0, 500.0);

    for index in 1..=10 {
        let fix = step(&mut core, 120.0, 500.0 + f64::from(index));
        assert_eq!(fix.status, FollowStatus::OnRoute, "fix {index}");
    }
    let eleventh = step(&mut core, 120.0, 511.0);

    assert_eq!(eleventh.status, FollowStatus::OffRoute);
    assert!(
        bearing_difference(eleventh.bearing_to_route_deg, 270.0) < 1.0,
        "bearing to route {}",
        eleventh.bearing_to_route_deg
    );
    assert!((eleventh.cross_track_m - 120.0).abs() < 1.0);

    let still_off = step(&mut core, 50.0, 520.0);
    assert_eq!(still_off.status, FollowStatus::OffRoute, "50 m is not back");
    let back = step(&mut core, 20.0, 530.0);
    assert_eq!(back.status, FollowStatus::OnRoute);
}

#[test]
fn a_return_inside_ten_fixes_never_leaves_the_route() {
    let mut core = straight_route();
    step(&mut core, 0.0, 500.0);

    for index in 1..=9 {
        let fix = step(&mut core, 120.0, 500.0 + f64::from(index));
        assert_eq!(fix.status, FollowStatus::OnRoute);
    }
    let back = step(&mut core, 20.0, 510.0);
    assert_eq!(back.status, FollowStatus::OnRoute);
    for index in 1..=9 {
        let fix = step(&mut core, 120.0, 510.0 + f64::from(index));
        assert_eq!(fix.status, FollowStatus::OnRoute, "the count restarted");
    }
}

#[test]
fn a_ride_walking_the_route_back_from_its_far_end_is_decided_reverse() {
    let mut core = straight_route();

    let entered = step(&mut core, 3.0, 1_990.0);
    assert_eq!(entered.status, FollowStatus::OnRoute);
    assert_eq!(entered.direction, FollowDirection::Undecided);
    assert!((entered.remaining_m - 10.0).abs() < 10.0);

    let mut last = entered;
    for north in (1_891..1_990).rev().step_by(10) {
        last = step(&mut core, 3.0, f64::from(north));
        assert_eq!(last.direction, FollowDirection::Undecided, "at {north}");
    }
    let decided = step(&mut core, 3.0, 1_880.0);
    assert_eq!(decided.direction, FollowDirection::Reverse);
    assert!(decided.remaining_m > last.remaining_m);
    assert!((decided.remaining_m - 1_880.0).abs() < 10.0);
    assert!(
        bearing_difference(decided.route_bearing_deg, 180.0) < 1.0,
        "bearing {}",
        decided.route_bearing_deg
    );

    let nearer_start = step(&mut core, 3.0, 1_000.0);
    assert_eq!(nearer_start.direction, FollowDirection::Reverse, "held");
    assert!((nearer_start.remaining_m - 1_000.0).abs() < 10.0);
    assert!(nearer_start.remaining_m < decided.remaining_m);
}

#[test]
fn a_ride_walking_the_route_forwards_is_decided_forward() {
    let mut core = straight_route();

    let entered = step(&mut core, 3.0, 10.0);
    assert_eq!(entered.direction, FollowDirection::Undecided);
    let fix = step(&mut core, 3.0, 120.0);

    assert_eq!(fix.direction, FollowDirection::Forward);
    assert!(bearing_difference(fix.route_bearing_deg, 0.0) < 1.0);
    assert!((fix.remaining_m - 1_880.0).abs() < 10.0);
}

#[test]
fn a_ride_on_the_first_leg_of_a_crossing_stays_on_it_through_the_crossing() {
    // Leg one runs east through the origin, and the line returns north
    // through it 1.1 km further on, so the legs cross at right angles.
    let corners = [
        (-300.0, 0.0),
        (300.0, 0.0),
        (300.0, -250.0),
        (0.0, -250.0),
        (0.0, 500.0),
    ];
    let mut core = FollowerCore::build(&track_through(&corners, 10.0)).unwrap();

    // Beside leg one, so that within three metres of the crossing the second
    // leg is the nearer line.
    for east in (-100..=100).step_by(2) {
        let fix = step(&mut core, f64::from(east), 3.0);
        let expected = 300.0 + f64::from(east);
        assert!(
            (fix.along_m - expected).abs() < 10.0,
            "east {east}: along {} against {expected}",
            fix.along_m
        );
        assert_eq!(fix.status, FollowStatus::OnRoute);
    }
}

#[test]
fn a_dense_wandering_track_costs_a_bounded_window_per_fix() {
    let track: Vec<GpsPoint> = (0..9_000)
        .map(|index| {
            let along = f64::from(index);
            let sway = 20.0 * (along / 20.0 * std::f64::consts::TAU).sin();
            let jitter = if index % 2 == 0 { 2.0 } else { -2.0 };
            at(sway + jitter, along)
        })
        .collect();
    let mut core = FollowerCore::build(&track).unwrap();
    assert!(
        core.segment_count() > 800,
        "the simplified route kept {} segments",
        core.segment_count()
    );

    let first = core.advance(track[0].latitude, track[0].longitude);
    assert_eq!(first.status, FollowStatus::OnRoute);
    for point in track.iter().step_by(5).skip(1) {
        let fix = core.advance(point.latitude, point.longitude);
        assert_eq!(fix.status, FollowStatus::OnRoute);
        assert!(
            core.last_segments_visited() < 200,
            "visited {} segments",
            core.last_segments_visited()
        );
    }
}

#[test]
fn a_route_without_two_recorded_fixes_is_refused() {
    assert!(matches!(
        FollowerCore::build(&[at(0.0, 0.0)]),
        Err(FollowBuildError::TooFewPoints)
    ));
    assert!(matches!(
        FollowerCore::build(&[]),
        Err(FollowBuildError::TooFewPoints)
    ));

    let placeholders = [
        GpsPoint::new(0.0, 0.0),
        GpsPoint::new(0.0, 0.0),
        GpsPoint::new(95.0, 7.0),
        GpsPoint::new(f64::NAN, 7.0),
        at(0.0, 0.0),
    ];
    assert!(matches!(
        FollowerCore::build(&placeholders),
        Err(FollowBuildError::TooFewPoints)
    ));
}

#[test]
fn a_route_that_never_moves_is_refused() {
    let standing = [at(4.0, 4.0), at(4.0, 4.0), at(4.0, 4.0)];

    assert!(matches!(
        FollowerCore::build(&standing),
        Err(FollowBuildError::NoLength)
    ));
}

#[test]
fn an_unrecorded_fix_returns_the_previous_record() {
    let mut core = straight_route();
    let before_any = core.advance(0.0, 0.0);
    assert_eq!(before_any.status, FollowStatus::NotJoined);

    let good = step(&mut core, 5.0, 700.0);

    for (lat, lng) in [
        (0.0, 0.0),
        (f64::NAN, 7.0),
        (91.0, 7.0),
        (47.0, f64::INFINITY),
    ] {
        assert_eq!(core.advance(lat, lng), good, "fix ({lat}, {lng})");
    }
    let next = step(&mut core, 5.0, 710.0);
    assert!((next.along_m - 710.0).abs() < 10.0);
}

fn l_route() -> FollowerCore {
    FollowerCore::build(&track_through(
        &[(0.0, 0.0), (0.0, 1_000.0), (1_000.0, 1_000.0)],
        10.0,
    ))
    .unwrap()
}

#[test]
fn an_l_shaped_route_has_one_right_turn_at_the_corner() {
    let core = l_route();

    let turns = core.turns();

    assert_eq!(turns.len(), 1, "turns {turns:?}");
    assert!((turns[0].along_m - 1_000.0).abs() < 10.0);
    assert!((turns[0].angle_deg - 90.0).abs() < 5.0);
}

#[test]
fn a_gentle_arc_has_no_turn() {
    let mut corners = vec![(0.0, 0.0)];
    let (mut east, mut north, mut heading) = (0.0_f64, 0.0_f64, 0.0_f64);
    for _ in 0..25 {
        heading += 2.0;
        east += 20.0 * heading.to_radians().sin();
        north += 20.0 * heading.to_radians().cos();
        corners.push((east, north));
    }
    let core = FollowerCore::build(&track_through(&corners, 5.0)).unwrap();

    assert!(core.turns().is_empty(), "turns {:?}", core.turns());
}

#[test]
fn a_hairpin_is_one_turn_of_about_a_half_circle() {
    let corners = [(0.0, 0.0), (0.0, 500.0), (10.0, 500.0), (10.0, 0.0)];
    let core = FollowerCore::build(&track_through(&corners, 5.0)).unwrap();

    let turns = core.turns();

    assert_eq!(turns.len(), 1, "turns {turns:?}");
    assert!((turns[0].angle_deg.abs() - 180.0).abs() < 10.0);
}

#[test]
fn lateral_jitter_on_a_straight_line_is_no_turn() {
    let mut track = Vec::new();
    for index in 0..300 {
        let jitter = if index % 2 == 0 { 2.0 } else { -2.0 };
        track.push(at(jitter, f64::from(index) * 10.0));
    }
    let core = FollowerCore::build(&track).unwrap();

    assert!(core.turns().is_empty(), "turns {:?}", core.turns());
}

#[test]
fn a_left_turn_is_negative() {
    let core = FollowerCore::build(&track_through(
        &[(0.0, 0.0), (0.0, 500.0), (-500.0, 500.0)],
        10.0,
    ))
    .unwrap();

    assert_eq!(core.turns().len(), 1);
    assert!((core.turns()[0].angle_deg + 90.0).abs() < 5.0);
}

#[test]
fn the_next_turn_closes_on_the_corner_and_is_gone_once_past_it() {
    let mut core = l_route();

    let _ = step(&mut core, 0.0, 0.0);
    let early = step(&mut core, 0.0, 100.0);
    let _ = step(&mut core, 0.0, 200.0);
    let near = step(&mut core, 0.0, 990.0);
    let past = step(&mut core, 5.0, 1_000.0);
    let beyond = step(&mut core, 100.0, 1_000.0);

    let first = early.next_turn.expect("a turn ahead");
    assert!((first.distance_m - 900.0).abs() < 15.0, "{first:?}");
    assert!((first.angle_deg - 90.0).abs() < 5.0);
    assert!(near.next_turn.expect("still ahead").distance_m < 20.0);
    assert!(past.next_turn.is_none_or(|turn| turn.distance_m < 10.0));
    assert!(beyond.next_turn.is_none(), "{:?}", beyond.next_turn);
}

#[test]
fn ridden_in_reverse_the_turn_has_the_opposite_sign_at_the_same_place() {
    let mut core = l_route();

    let _ = step(&mut core, 1_000.0, 1_000.0);
    let fix = step(&mut core, 800.0, 1_000.0);

    assert_eq!(fix.direction, FollowDirection::Reverse);
    let turn = fix.next_turn.expect("a turn ahead");
    assert!((turn.distance_m - 800.0).abs() < 15.0, "{turn:?}");
    assert!((turn.angle_deg + 90.0).abs() < 5.0);
}

#[test]
fn the_next_turn_carries_the_along_distance_of_the_turn_it_measures_to() {
    let mut core = l_route();
    let _ = step(&mut core, 0.0, 0.0);
    let early = step(&mut core, 0.0, 100.0);

    let turn = early.next_turn.expect("a turn ahead");
    let route_turn = core.turns()[0];
    assert_eq!(turn.along_m, route_turn.along_m);
    assert!((turn.distance_m - (route_turn.along_m - early.along_m)).abs() < 1e-9);
}

#[test]
fn ridden_in_reverse_the_next_turn_carries_the_turn_it_measures_to() {
    let mut core = l_route();
    let _ = step(&mut core, 1_000.0, 1_000.0);
    let fix = step(&mut core, 800.0, 1_000.0);

    assert_eq!(fix.direction, FollowDirection::Reverse);
    let turn = fix.next_turn.expect("a turn ahead");
    assert_eq!(turn.along_m, core.turns()[0].along_m);
}

#[test]
fn no_turn_is_announced_before_the_direction_is_decided_or_while_off_route() {
    let mut core = l_route();
    let undecided = step(&mut core, 0.0, 20.0);
    assert_eq!(undecided.direction, FollowDirection::Undecided);
    assert!(undecided.next_turn.is_none());

    let _ = step(&mut core, 0.0, 200.0);
    let joined = step(&mut core, 0.0, 300.0);
    assert!(joined.next_turn.is_some());

    let mut off = joined;
    for _ in 0..12 {
        off = step(&mut core, 400.0, 300.0);
    }
    assert_eq!(off.status, FollowStatus::OffRoute);
    assert!(off.next_turn.is_none());

    let back = step(&mut core, 0.0, 320.0);
    assert_eq!(back.status, FollowStatus::OnRoute);
    assert!(back.next_turn.is_some());
}
