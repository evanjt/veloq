//! A track's points indexed for nearest-point queries, so the average minimum
//! distance from another track to this one costs a tree descent per point
//! rather than a haversine against every point of this track.
//!
//! The points sit on the unit sphere as 3D vectors. The straight-line distance
//! between two of them rises with the great-circle distance between them, so
//! the nearest point by straight line is the nearest by haversine, at any
//! latitude and across the antimeridian, where a flat projection would not be.
//! The haversine to that point is then taken exactly as the brute-force
//! average takes it, so the two averages agree.

use std::sync::Arc;

use rstar::{AABB, PointDistance, RTree, RTreeObject};
use tracematch::GpsPoint;
use tracematch::geo_utils::haversine_distance;

#[derive(Debug, Clone, Copy)]
struct SpherePoint {
    position: [f64; 3],
    index: usize,
}

impl RTreeObject for SpherePoint {
    type Envelope = AABB<[f64; 3]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_point(self.position)
    }
}

impl PointDistance for SpherePoint {
    fn distance_2(&self, point: &[f64; 3]) -> f64 {
        count_distance_evaluation();
        let dx = self.position[0] - point[0];
        let dy = self.position[1] - point[1];
        let dz = self.position[2] - point[2];
        dx * dx + dy * dy + dz * dz
    }
}

fn unit_vector(point: &GpsPoint) -> [f64; 3] {
    let latitude = point.latitude.to_radians();
    let longitude = point.longitude.to_radians();
    [
        latitude.cos() * longitude.cos(),
        latitude.cos() * longitude.sin(),
        latitude.sin(),
    ]
}

/// One track, indexed once and queried by every track measured against it.
pub(crate) struct TrackIndex {
    points: Arc<Vec<GpsPoint>>,
    tree: RTree<SpherePoint>,
}

impl TrackIndex {
    pub(crate) fn new(points: Arc<Vec<GpsPoint>>) -> Self {
        let tree = RTree::bulk_load(
            points
                .iter()
                .enumerate()
                .map(|(index, point)| SpherePoint {
                    position: unit_vector(point),
                    index,
                })
                .collect(),
        );
        Self { points, tree }
    }

    pub(crate) fn points(&self) -> &[GpsPoint] {
        &self.points
    }

    /// The mean, over every point of `route`, of the haversine distance to
    /// the nearest point of this track: `average_min_distance(route, track)`.
    pub(crate) fn average_min_distance_from(&self, route: &[GpsPoint]) -> f64 {
        if route.is_empty() || self.points.is_empty() {
            return f64::INFINITY;
        }
        let total: f64 = route
            .iter()
            .map(|point| {
                let nearest = self
                    .tree
                    .nearest_neighbor(&unit_vector(point))
                    .expect("a non-empty tree has a nearest point");
                count_distance_evaluation();
                haversine_distance(point, &self.points[nearest.index])
            })
            .sum();
        total / route.len() as f64
    }
}

#[cfg(test)]
thread_local! {
    static DISTANCE_EVALUATIONS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

#[inline]
fn count_distance_evaluation() {
    #[cfg(test)]
    DISTANCE_EVALUATIONS.with(|count| count.set(count.get() + 1));
}

/// Point distances measured on this thread since the last call: each point
/// the tree compares against a query, and each haversine taken.
#[cfg(test)]
pub(crate) fn take_distance_evaluations() -> u64 {
    DISTANCE_EVALUATIONS.with(|count| count.replace(0))
}

/// The most point distances one direction may measure: a tree descent per
/// query point, never a pass over every point of the indexed track.
#[cfg(test)]
pub(crate) fn distance_evaluation_bound(route_len: usize, track_len: usize) -> u64 {
    let depth = (track_len.max(2) as f64).log2().ceil() as u64;
    4 * route_len as u64 * depth
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracematch::matching::{amd_to_percentage, average_min_distance};

    /// A small deterministic generator, so every run draws the same tracks.
    struct Draw(u64);

    impl Draw {
        fn unit(&mut self) -> f64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }

        fn signed(&mut self) -> f64 {
            2.0 * self.unit() - 1.0
        }
    }

    const METRES_PER_DEGREE: f64 = 111_195.0;

    /// A winding line of `count` points from `start`, about `step` metres
    /// apart, heading `bearing` degrees from north with a random wander.
    fn line(
        draw: &mut Draw,
        start: (f64, f64),
        bearing: f64,
        step: f64,
        count: usize,
    ) -> Vec<GpsPoint> {
        let (mut latitude, mut longitude) = start;
        let mut heading = bearing.to_radians();
        (0..count)
            .map(|_| {
                let point = GpsPoint::new(latitude, longitude);
                heading += draw.signed() * 0.05;
                latitude += step * heading.cos() / METRES_PER_DEGREE;
                longitude +=
                    step * heading.sin() / (METRES_PER_DEGREE * latitude.to_radians().cos());
                longitude = (longitude + 540.0) % 360.0 - 180.0;
                point
            })
            .collect()
    }

    /// The same line recorded again: every point moved by up to `noise`
    /// metres, and the recording sampled at its own count.
    fn recorded(draw: &mut Draw, line: &[GpsPoint], noise: f64, count: usize) -> Vec<GpsPoint> {
        (0..count)
            .map(|index| {
                let source = &line[index * (line.len() - 1) / (count - 1).max(1)];
                let latitude = source.latitude + draw.signed() * noise / METRES_PER_DEGREE;
                let longitude = source.longitude
                    + draw.signed() * noise
                        / (METRES_PER_DEGREE * source.latitude.to_radians().cos());
                GpsPoint::new(latitude, (longitude + 540.0) % 360.0 - 180.0)
            })
            .collect()
    }

    fn assert_matches_brute_force(route: &[GpsPoint], track: &[GpsPoint]) {
        let config = tracematch::MatchConfig::default();
        let index = TrackIndex::new(Arc::new(track.to_vec()));
        take_distance_evaluations();
        let indexed = index.average_min_distance_from(route);
        let evaluations = take_distance_evaluations();
        let brute = average_min_distance(route, track);

        assert!(
            (indexed - brute).abs() < 1e-6,
            "indexed {indexed} m against brute force {brute} m"
        );
        let indexed_percentage =
            amd_to_percentage(indexed, config.perfect_threshold, config.zero_threshold);
        let brute_percentage =
            amd_to_percentage(brute, config.perfect_threshold, config.zero_threshold);
        assert!((indexed_percentage - brute_percentage).abs() < 1e-6);
        assert!(
            evaluations <= distance_evaluation_bound(route.len(), track.len()),
            "{evaluations} distances measured for {} points against {}",
            route.len(),
            track.len()
        );
    }

    #[test]
    fn seeded_recordings_measure_what_brute_force_measures() {
        let mut draw = Draw(0x5eed_cafe_f00d_d00d);
        for count in [10, 500, 2_100] {
            for noise in [0.0, 5.0, 15.0, 30.0] {
                let start = (46.0 + draw.unit() * 2.0, 6.0 + draw.unit() * 2.0);
                let bearing = draw.unit() * 360.0;
                let path = line(&mut draw, start, bearing, 10.0, count);
                let ridden = recorded(&mut draw, &path, noise, count);
                let other_count = (count * 9 / 10).max(2);
                let again = recorded(&mut draw, &path, noise, other_count);
                assert_matches_brute_force(&ridden, &again);
                assert_matches_brute_force(&again, &ridden);
            }
        }
    }

    #[test]
    fn a_track_at_seventy_degrees_measures_what_brute_force_measures() {
        let mut draw = Draw(70);
        let path = line(&mut draw, (70.0, 25.0), 45.0, 10.0, 2_100);
        let ridden = recorded(&mut draw, &path, 20.0, 2_100);
        let again = recorded(&mut draw, &path, 20.0, 1_700);
        assert_matches_brute_force(&ridden, &again);
        assert_matches_brute_force(&again, &ridden);
    }

    #[test]
    fn a_long_east_west_track_measures_what_brute_force_measures() {
        let mut draw = Draw(9_000);
        let path = line(&mut draw, (60.0, 10.0), 90.0, 150.0, 2_100);
        let ridden = recorded(&mut draw, &path, 25.0, 2_100);
        let again = recorded(&mut draw, &path, 25.0, 1_900);
        assert_matches_brute_force(&ridden, &again);
        assert_matches_brute_force(&again, &ridden);
    }

    #[test]
    fn a_track_across_the_antimeridian_measures_what_brute_force_measures() {
        let mut draw = Draw(180);
        let path = line(&mut draw, (-17.0, 179.5), 90.0, 50.0, 2_100);
        assert!(path.iter().any(|point| point.longitude < 0.0));
        assert!(path.iter().any(|point| point.longitude > 0.0));
        let ridden = recorded(&mut draw, &path, 15.0, 2_100);
        let again = recorded(&mut draw, &path, 15.0, 2_000);
        assert_matches_brute_force(&ridden, &again);
        assert_matches_brute_force(&again, &ridden);
    }

    #[test]
    fn a_track_near_the_pole_measures_what_brute_force_measures() {
        let mut draw = Draw(89);
        let path = line(&mut draw, (89.5, 0.0), 0.0, 10.0, 1_000);
        let ridden = recorded(&mut draw, &path, 10.0, 1_000);
        let again = recorded(&mut draw, &path, 10.0, 800);
        assert_matches_brute_force(&ridden, &again);
        assert_matches_brute_force(&again, &ridden);
    }

    #[test]
    fn an_empty_side_measures_no_match() {
        let track = Arc::new(vec![GpsPoint::new(47.0, 7.0), GpsPoint::new(47.001, 7.0)]);
        assert_eq!(
            TrackIndex::new(Arc::clone(&track)).average_min_distance_from(&[]),
            f64::INFINITY
        );
        assert_eq!(
            TrackIndex::new(Arc::new(Vec::new())).average_min_distance_from(&track),
            f64::INFINITY
        );
    }
}
