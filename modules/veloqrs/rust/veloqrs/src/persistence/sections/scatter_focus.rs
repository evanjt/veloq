//! The range each direction's scatter axis draws, and the points past it.
//!
//! One stopped attempt would otherwise stretch the axis until the rest sit in
//! a line, so the range covers the 5th to 95th percentile of the direction's
//! counted attempts, widened to hold the record and the highlighted attempt,
//! and padded. A point past it is flagged on the side it lies, and the screen
//! draws it at the edge. A section ranges on speed and a route on time, the
//! axis each screen draws.

use crate::{
    FfiFocusRange, FfiOffScale, FfiPerformanceSubject, FfiScatterFocus, FfiSectionChartPoint,
};

/// Lower and upper percentile of the counted attempts the range covers.
const LOW_PERCENTILE: f64 = 0.05;
const HIGH_PERCENTILE: f64 = 0.95;

/// Fewest counted attempts a direction needs before any is flagged. Below
/// ten, the 5th and 95th percentiles sit within one attempt of the fastest
/// and slowest, so trimming would cut a real attempt rather than a tail; the
/// range then holds every point.
const MIN_TRIMMED_ATTEMPTS: usize = 10;

/// Share of the range's span added at each end.
const PADDING: f64 = 0.12;

/// Share of the value added at each end when every point has the same one.
const FLAT_PADDING: f64 = 0.05;

/// The value a point is placed at on the axis.
fn axis_value(point: &FfiSectionChartPoint, subject: FfiPerformanceSubject) -> f64 {
    match subject {
        FfiPerformanceSubject::Section => point.speed,
        FfiPerformanceSubject::Route => f64::from(point.section_time),
    }
}

/// Quantile of sorted values by linear interpolation between order
/// statistics.
fn quantile(sorted: &[f64], q: f64) -> f64 {
    let position = q * (sorted.len() - 1) as f64;
    let below = position.floor() as usize;
    let above = position.ceil() as usize;
    sorted[below] + (sorted[above] - sorted[below]) * (position - below as f64)
}

/// Where `value` lies against `range`. Slow is low speed or long time.
fn side(value: f64, range: &FfiFocusRange, subject: FfiPerformanceSubject) -> FfiOffScale {
    let (below, above) = match subject {
        FfiPerformanceSubject::Section => (FfiOffScale::Slow, FfiOffScale::Fast),
        FfiPerformanceSubject::Route => (FfiOffScale::Fast, FfiOffScale::Slow),
    };
    if value < range.low {
        below
    } else if value > range.high {
        above
    } else {
        FfiOffScale::None
    }
}

/// One direction's range over its drawn points, or `None` with no point.
fn direction_range(
    drawn: &[&FfiSectionChartPoint],
    subject: FfiPerformanceSubject,
    highlight: Option<&str>,
) -> Option<FfiFocusRange> {
    let values = |points: &mut dyn Iterator<Item = &&FfiSectionChartPoint>| -> Vec<f64> {
        points
            .map(|p| axis_value(p, subject))
            .filter(|v| v.is_finite())
            .collect()
    };
    let mut counted = values(&mut drawn.iter().filter(|p| !p.outside_distance_band));
    counted.sort_by(f64::total_cmp);
    let (mut low, mut high) = if counted.len() >= MIN_TRIMMED_ATTEMPTS {
        (
            quantile(&counted, LOW_PERCENTILE),
            quantile(&counted, HIGH_PERCENTILE),
        )
    } else {
        let all = values(&mut drawn.iter());
        (
            all.iter().copied().reduce(f64::min)?,
            all.iter().copied().reduce(f64::max)?,
        )
    };
    // The record and the highlighted attempt are what the screen is about, so
    // they are always on the axis.
    let kept = values(
        &mut drawn
            .iter()
            .filter(|p| p.is_best || highlight.is_some_and(|id| p.activity_id == id)),
    );
    for value in kept {
        low = low.min(value);
        high = high.max(value);
    }
    let span = high - low;
    let pad = if span > 0.0 {
        span * PADDING
    } else {
        low.abs() * FLAT_PADDING
    };
    Some(FfiFocusRange {
        low: low - pad,
        high: high + pad,
        slow_count: 0,
        fast_count: 0,
    })
}

/// Each direction's focus range over `points`, flagging every point past it
/// and counting them.
pub(crate) fn scatter_focus(
    points: &mut [FfiSectionChartPoint],
    subject: FfiPerformanceSubject,
    highlight: Option<&str>,
) -> FfiScatterFocus {
    let range = |reverse: bool| {
        let drawn: Vec<&FfiSectionChartPoint> = points
            .iter()
            .filter(|p| (p.direction == "reverse") == reverse)
            .collect();
        direction_range(&drawn, subject, highlight)
    };
    let mut focus = FfiScatterFocus {
        forward: range(false),
        reverse: range(true),
    };
    for point in points.iter_mut() {
        let range = if point.direction == "reverse" {
            focus.reverse.as_mut()
        } else {
            focus.forward.as_mut()
        };
        let Some(range) = range else { continue };
        point.off_scale = side(axis_value(point, subject), range, subject);
        match point.off_scale {
            FfiOffScale::Slow => range.slow_count += 1,
            FfiOffScale::Fast => range.fast_count += 1,
            FfiOffScale::None => {}
        }
    }
    focus
}

/// Flag `points` against a focus already taken, counting none of them: the
/// excluded attempts the show-excluded view draws on the same axis.
pub(crate) fn flag_against(
    points: &mut [FfiSectionChartPoint],
    focus: &FfiScatterFocus,
    subject: FfiPerformanceSubject,
) {
    for point in points.iter_mut() {
        let range = if point.direction == "reverse" {
            focus.reverse.as_ref()
        } else {
            focus.forward.as_ref()
        };
        point.off_scale = range.map_or(FfiOffScale::None, |range| {
            side(axis_value(point, subject), range, subject)
        });
    }
}

#[cfg(test)]
#[path = "tests/scatter_focus.rs"]
mod tests;
