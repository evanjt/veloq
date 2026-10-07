//! The histogram of the counted attempts' times the performance charts draw
//! when the plot is switched from the scatter, one per direction.
//!
//! It bins the same attempts the trend curve fits, so the bars and the
//! scatter under the same chips agree. Bins are equal widths of attempt time,
//! which on a fixed-length section is equal width in pace. The width is the
//! Freedman-Diaconis width, `2 * IQR * n^(-1/3)`, rounded up to a readable
//! step and widened until there are at most `MAX_BINS` bins.

use crate::{FfiAttemptHistogram, FfiAttemptHistograms, FfiSectionChartPoint};

/// Most bins a histogram has.
const MAX_BINS: usize = 20;

/// Fewest counted attempts a direction needs for a distribution.
const MIN_ATTEMPTS: usize = 3;

/// Readable bin widths in seconds: 1, 2, 5, 10, 15, 20, 30 s, 1, 2, 5, 10, 15,
/// 30 min and 1 h.
const STEPS: [f64; 14] = [
    1.0, 2.0, 5.0, 10.0, 15.0, 20.0, 30.0, 60.0, 120.0, 300.0, 600.0, 900.0, 1800.0, 3600.0,
];

/// Quantile of sorted values by linear interpolation between ranks.
fn quantile(sorted: &[f64], q: f64) -> f64 {
    let position = q * (sorted.len() - 1) as f64;
    let below = position.floor() as usize;
    let above = position.ceil() as usize;
    sorted[below] + (sorted[above] - sorted[below]) * (position - below as f64)
}

fn bin_count(start: f64, width: f64, slowest: f64) -> usize {
    (((slowest - start) / width).ceil() as usize).max(1)
}

/// The bin width for sorted times: the Freedman-Diaconis width rounded up to
/// a step, then the next step up until the bins fit.
fn bin_width(sorted: &[f64]) -> f64 {
    let n = sorted.len() as f64;
    let iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
    let ideal = 2.0 * iqr * n.powf(-1.0 / 3.0);
    let fastest = sorted[0];
    let slowest = sorted[sorted.len() - 1];
    let mut chosen = STEPS[STEPS.len() - 1];
    for &step in STEPS.iter().filter(|&&s| s >= ideal) {
        chosen = step;
        let start = (fastest / step).floor() * step;
        if bin_count(start, step, slowest) <= MAX_BINS {
            break;
        }
    }
    chosen
}

/// The binned times, or `None` below `MIN_ATTEMPTS`. `edge_distance` is the
/// length the times were taken over, when it is the same for every attempt.
fn bin(
    times: &[f64],
    edge_distance: Option<f64>,
    outside_band: u32,
) -> Option<FfiAttemptHistogram> {
    if times.len() < MIN_ATTEMPTS {
        return None;
    }
    let mut sorted = times.to_vec();
    sorted.sort_by(f64::total_cmp);
    let width = bin_width(&sorted);
    let start = (sorted[0] / width).floor() * width;
    let count = bin_count(start, width, sorted[sorted.len() - 1]);
    let mut counts = vec![0u32; count];
    for &t in &sorted {
        let index = (((t - start) / width).floor() as usize).min(count - 1);
        counts[index] += 1;
    }
    // A zero-second edge has no speed; it is reported as 0 rather than
    // infinity, which JSON cannot carry.
    let edge_speeds = edge_distance.map(|distance| {
        (0..=count)
            .map(|i| {
                let edge = start + i as f64 * width;
                if edge > 0.0 { distance / edge } else { 0.0 }
            })
            .collect()
    });
    Some(FfiAttemptHistogram {
        start_secs: start,
        bin_width_secs: width,
        counts,
        edge_speeds,
        binned: sorted.len() as u32,
        unbinned_outside_band: outside_band,
    })
}

/// The histograms over a section's counted attempts, each direction on its
/// section times. A reverse attempt is one whose direction reads `reverse`;
/// every other counts as forward.
pub(crate) fn section_histograms(points: &[FfiSectionChartPoint]) -> FfiAttemptHistograms {
    let direction = |reverse: bool| {
        let own: Vec<&FfiSectionChartPoint> = points
            .iter()
            .filter(|p| (p.direction == "reverse") == reverse)
            .collect();
        let times: Vec<f64> = own.iter().map(|p| f64::from(p.section_time)).collect();
        bin(&times, own.first().map(|p| p.section_distance), 0)
    };
    FfiAttemptHistograms {
        forward: direction(false),
        reverse: direction(true),
    }
}

/// The histograms over a route's counted attempts, on elapsed time. A partial
/// match and an attempt outside the route's distance band are not binned, and
/// neither is one with no finite speed; the out-of-band ones the scatter still
/// draws are counted in `unbinned_outside_band`.
pub(crate) fn route_histograms(performances: &[crate::RoutePerformance]) -> FfiAttemptHistograms {
    let direction = |reverse: bool| {
        let drawn = performances
            .iter()
            .filter(|p| p.direction != "partial" && p.speed.is_finite())
            .filter(|p| (p.direction == "reverse") == reverse);
        let outside = drawn.clone().filter(|p| p.outside_distance_band).count() as u32;
        let times: Vec<f64> = drawn
            .filter(|p| !p.outside_distance_band)
            .map(|p| f64::from(p.duration))
            .collect();
        bin(&times, None, outside)
    };
    FfiAttemptHistograms {
        forward: direction(false),
        reverse: direction(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(seconds: u32, direction: &str) -> FfiSectionChartPoint {
        FfiSectionChartPoint {
            lap_id: format!("lap{seconds}"),
            activity_id: format!("a{seconds}"),
            activity_name: String::new(),
            activity_date: 1_700_000_000.0,
            speed: 1000.0 / f64::from(seconds),
            section_time: seconds,
            section_distance: 1000.0,
            direction: direction.to_string(),
            is_best: false,
            avg_power: None,
        }
    }

    fn points(times: &[u32], direction: &str) -> Vec<FfiSectionChartPoint> {
        times.iter().map(|&t| point(t, direction)).collect()
    }

    #[test]
    fn times_bin_at_a_readable_step_with_the_slowest_in_the_closed_last_bin() {
        let h = section_histograms(&points(&[300, 305, 310, 330, 360], "same"));
        let forward = h.forward.expect("five attempts");
        assert_eq!(forward.bin_width_secs, 30.0);
        assert_eq!(forward.start_secs, 300.0);
        assert_eq!(forward.counts, vec![3, 2]);
        assert_eq!(forward.binned, 5);
        assert_eq!(forward.unbinned_outside_band, 0);
        assert!(h.reverse.is_none());
    }

    #[test]
    fn a_direction_needs_three_attempts() {
        assert!(
            section_histograms(&points(&[300, 310], "same"))
                .forward
                .is_none()
        );
        assert!(
            section_histograms(&points(&[300, 310, 320], "same"))
                .forward
                .is_some()
        );
    }

    #[test]
    fn identical_times_give_one_bin_of_the_smallest_step() {
        let forward = section_histograms(&points(&[400; 20], "same"))
            .forward
            .unwrap();
        assert_eq!(forward.counts, vec![20]);
        assert_eq!(forward.bin_width_secs, 1.0);
        assert_eq!(forward.start_secs, 400.0);
    }

    #[test]
    fn a_wide_spread_is_widened_to_at_most_twenty_bins() {
        // Evenly spread over 12 minutes; the Freedman-Diaconis step of 10 s
        // alone would give 72 bins.
        let times: Vec<u32> = (0..60).map(|i| 600 + i * 12).collect();
        let forward = section_histograms(&points(&times, "same")).forward.unwrap();
        assert!(forward.counts.len() <= MAX_BINS, "{forward:?}");
        assert_eq!(forward.counts.iter().sum::<u32>(), 60);
    }

    #[test]
    fn a_reverse_attempt_counts_only_in_reverse() {
        let mut all = points(&[300, 310, 320], "same");
        all.extend(points(&[400, 410, 420, 430], "reverse"));
        let h = section_histograms(&all);
        assert_eq!(h.forward.unwrap().binned, 3);
        assert_eq!(h.reverse.unwrap().binned, 4);
    }

    #[test]
    fn section_edges_carry_the_speed_over_each() {
        let forward = section_histograms(&points(&[300, 305, 310, 330, 360], "same"))
            .forward
            .unwrap();
        let speeds = forward.edge_speeds.expect("a section has an edge speed");
        assert_eq!(speeds.len(), forward.counts.len() + 1);
        for (i, speed) in speeds.iter().enumerate() {
            let edge = forward.start_secs + i as f64 * forward.bin_width_secs;
            assert_eq!(*speed, 1000.0 / edge);
        }
    }

    fn attempt(
        duration: u32,
        direction: &str,
        outside: bool,
        speed: f64,
    ) -> crate::RoutePerformance {
        crate::RoutePerformance {
            activity_id: format!("a{duration}"),
            name: String::new(),
            date: 1_700_000_000,
            speed,
            duration,
            moving_time: duration,
            distance: 1000.0,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            is_current: false,
            direction: direction.to_string(),
            match_percentage: None,
            outside_distance_band: outside,
            is_record: false,
        }
    }

    #[test]
    fn route_bins_only_in_band_complete_timed_attempts() {
        let mut all: Vec<_> = [300, 305, 310, 330, 360]
            .iter()
            .map(|&d| attempt(d, "same", false, 3.0))
            .collect();
        all.push(attempt(340, "partial", false, 3.0));
        all.push(attempt(900, "same", true, 1.0));
        all.push(attempt(910, "same", false, f64::NAN));
        let forward = route_histograms(&all).forward.unwrap();
        assert_eq!(forward.binned, 5);
        assert_eq!(forward.counts.iter().sum::<u32>(), 5);
        assert_eq!(forward.unbinned_outside_band, 1);
        assert!(forward.edge_speeds.is_none());
    }

    #[test]
    fn route_directions_are_separate() {
        let mut all: Vec<_> = [300, 310, 320]
            .iter()
            .map(|&d| attempt(d, "reverse", false, 3.0))
            .collect();
        all.push(attempt(305, "same", false, 3.0));
        let h = route_histograms(&all);
        assert!(h.forward.is_none());
        assert_eq!(h.reverse.unwrap().binned, 3);
    }
}
