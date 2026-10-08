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
/// fixed length used to label each time edge as a speed.
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
/// every other counts as forward. A route attempt outside its distance band
/// is not binned and is counted in `unbinned_outside_band`.
pub(crate) fn section_histograms(
    points: &[FfiSectionChartPoint],
    section_distance: Option<f64>,
) -> FfiAttemptHistograms {
    let direction = |reverse: bool| {
        let own = points
            .iter()
            .filter(|p| (p.direction == "reverse") == reverse);
        let outside = own.clone().filter(|p| p.outside_distance_band).count() as u32;
        let times: Vec<f64> = own
            .filter(|p| !p.outside_distance_band)
            .map(|p| f64::from(p.section_time))
            .collect();
        bin(&times, section_distance, outside)
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
#[path = "tests/attempt_histogram.rs"]
mod tests;
