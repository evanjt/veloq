//! Medoid selection - The key innovation for section detection.
//!
//! The medoid is the actual GPS trace with minimum total AMD (Average Minimum Distance)
//! to all other traces. This ensures we return REAL GPS points, not artificial interpolations.

use crate::GpsPoint;
use crate::geo_utils::haversine_distance;
use super::overlap::OverlapCluster;

/// Select the medoid trace from a cluster.
/// The medoid is the actual GPS trace with minimum total AMD to all other traces.
/// This ensures we return REAL GPS points, not artificial interpolations.
pub fn select_medoid(cluster: &OverlapCluster) -> (String, Vec<GpsPoint>) {
    // Collect all unique activity portions in this cluster
    let mut traces: Vec<(&str, &[GpsPoint])> = Vec::new();

    for overlap in &cluster.overlaps {
        // Add both sides of each overlap
        if !traces.iter().any(|(id, _)| *id == overlap.activity_a) {
            traces.push((&overlap.activity_a, &overlap.points_a));
        }
        if !traces.iter().any(|(id, _)| *id == overlap.activity_b) {
            traces.push((&overlap.activity_b, &overlap.points_b));
        }
    }

    if traces.is_empty() {
        return (String::new(), Vec::new());
    }

    if traces.len() == 1 {
        return (traces[0].0.to_string(), traces[0].1.to_vec());
    }

    // For small clusters, compute full pairwise AMD
    // For larger clusters (>10), use approximate method
    let use_full_pairwise = traces.len() <= 10;

    let mut best_idx = 0;
    let mut best_total_amd = f64::MAX;

    if use_full_pairwise {
        // Compute AMD for each trace to all others
        for (i, (_, trace_i)) in traces.iter().enumerate() {
            let mut total_amd = 0.0;

            for (j, (_, trace_j)) in traces.iter().enumerate() {
                if i != j {
                    total_amd += average_min_distance(trace_i, trace_j);
                }
            }

            if total_amd < best_total_amd {
                best_total_amd = total_amd;
                best_idx = i;
            }
        }
    } else {
        // Approximate: compare each to a random sample of 5 others
        let sample_size = 5.min(traces.len() - 1);

        for (i, (_, trace_i)) in traces.iter().enumerate() {
            let mut total_amd = 0.0;
            let mut count = 0;

            // Sample evenly distributed traces
            let step = traces.len() / sample_size;
            for j in (0..traces.len()).step_by(step.max(1)).take(sample_size) {
                if i != j {
                    total_amd += average_min_distance(trace_i, traces[j].1);
                    count += 1;
                }
            }

            if count > 0 {
                let avg_amd = total_amd / count as f64;
                if avg_amd < best_total_amd {
                    best_total_amd = avg_amd;
                    best_idx = i;
                }
            }
        }
    }

    (traces[best_idx].0.to_string(), traces[best_idx].1.to_vec())
}

/// Average Minimum Distance between two polylines
fn average_min_distance(poly_a: &[GpsPoint], poly_b: &[GpsPoint]) -> f64 {
    if poly_a.is_empty() || poly_b.is_empty() {
        return f64::MAX;
    }

    // Resample both to same number of points for fair comparison
    let n = 50;
    let resampled_a = resample_by_distance(poly_a, n);
    let resampled_b = resample_by_distance(poly_b, n);

    // Compute AMD from A to B
    let mut sum_a_to_b = 0.0;
    for point_a in &resampled_a {
        let min_dist = resampled_b.iter()
            .map(|p| haversine_distance(point_a, p))
            .min_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(0.0);
        sum_a_to_b += min_dist;
    }

    // Compute AMD from B to A
    let mut sum_b_to_a = 0.0;
    for point_b in &resampled_b {
        let min_dist = resampled_a.iter()
            .map(|p| haversine_distance(point_b, p))
            .min_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(0.0);
        sum_b_to_a += min_dist;
    }

    // Average of both directions
    (sum_a_to_b + sum_b_to_a) / (2.0 * n as f64)
}

/// Resample polyline to N points by distance
pub fn resample_by_distance(points: &[GpsPoint], n: usize) -> Vec<GpsPoint> {
    if points.len() <= n {
        return points.to_vec();
    }

    // Compute cumulative distances
    let mut cumulative = vec![0.0];
    for i in 1..points.len() {
        let d = haversine_distance(&points[i - 1], &points[i]);
        cumulative.push(cumulative.last().unwrap() + d);
    }

    let total_length = *cumulative.last().unwrap();
    if total_length < 1.0 {
        return points.to_vec();
    }

    let mut resampled = Vec::with_capacity(n);
    for i in 0..n {
        let target_dist = (i as f64 / (n - 1) as f64) * total_length;

        // Find segment containing target distance
        let mut seg_idx = 0;
        for j in 1..cumulative.len() {
            if cumulative[j] >= target_dist {
                seg_idx = j - 1;
                break;
            }
            seg_idx = j - 1;
        }

        // Interpolate within segment
        let seg_start = cumulative[seg_idx];
        let seg_end = cumulative.get(seg_idx + 1).copied().unwrap_or(seg_start);
        let seg_len = seg_end - seg_start;

        let t = if seg_len > 0.001 {
            (target_dist - seg_start) / seg_len
        } else {
            0.0
        };

        let p1 = &points[seg_idx];
        let p2 = points.get(seg_idx + 1).unwrap_or(p1);

        resampled.push(GpsPoint::new(
            p1.latitude + t * (p2.latitude - p1.latitude),
            p1.longitude + t * (p2.longitude - p1.longitude),
        ));
    }

    resampled
}
