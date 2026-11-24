//! Simplifying a line laid out in local metres, for the route follower, the lines under a tap
//! and the watch guide read.

/// Metres on the ground to one degree of latitude, the one figure every point-to-point distance
/// in the engine's local reads is measured with.
pub(crate) const METRES_PER_DEGREE: f64 = 111_320.0;

/// A position in metres on a local flat plane, east then north.
pub(crate) type Metres = [f64; 2];

/// The straight distance between two positions in metres.
pub(crate) fn distance(a: Metres, b: Metres) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

/// The point of segment `a`-`b` nearest to `p`, and its fraction along it.
pub(crate) fn nearest_on_segment(p: Metres, a: Metres, b: Metres) -> (Metres, f64) {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length_squared = dx * dx + dy * dy;
    let t = if length_squared > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_squared).clamp(0.0, 1.0)
    } else {
        0.0
    };
    ([a[0] + t * dx, a[1] + t * dy], t)
}

/// Douglas-Peucker over `points`, keeping the first and last and every vertex
/// that lies more than `tolerance_m` from the line kept so far.
pub(crate) fn simplify(points: &[Metres], tolerance_m: f64) -> Vec<Metres> {
    simplify_indices(points, tolerance_m)
        .into_iter()
        .map(|index| points[index])
        .collect()
}

/// The indices [`simplify`] keeps, in order, so a caller can keep whatever else
/// each vertex carries. Under three points there is nothing to drop.
pub(crate) fn simplify_indices(points: &[Metres], tolerance_m: f64) -> Vec<usize> {
    if points.len() < 3 {
        return (0..points.len()).collect();
    }
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
    keep.into_iter()
        .enumerate()
        .filter_map(|(index, kept)| kept.then_some(index))
        .collect()
}

#[cfg(test)]
mod scale_tests {
    use super::*;

    #[test]
    fn one_degree_of_latitude_is_the_shared_scale_in_metres() {
        assert_eq!(METRES_PER_DEGREE, 111_320.0);
        assert!((distance([0.0, 0.0], [0.0, METRES_PER_DEGREE]) - 111_320.0).abs() < 1e-9);
    }
}
