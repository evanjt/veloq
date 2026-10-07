//! The trend curve and band the section scatter draws, one per direction and
//! axis.
//!
//! A Gaussian kernel smoother with a local-linear fit, so the recent trend is
//! not pulled toward the historical mean. The bandwidth is the time span over
//! the larger of 3 and the square root of the attempt count. The band is the
//! weighted residual spread about the fitted line. Both are unchanged by a
//! linear rescale of the time axis, so the curve is computed over unix seconds
//! and the screen places it on whatever x range it draws.

use crate::{FfiSectionChartPoint, FfiSectionTrendCurves, FfiTrendBandPoint};

/// Points on each curve.
const CURVE_POINTS: usize = 200;

/// Share of the attempts' own range the curve and band may extend past.
const RANGE_PADDING: f64 = 0.15;

/// Padding used when every attempt has the same value.
const FLAT_PADDING: f64 = 0.5;

struct Smoothed {
    x: f64,
    y: f64,
    std: f64,
}

fn smooth(xs: &[f64], ys: &[f64], output_count: usize) -> Vec<Smoothed> {
    let n = xs.len();
    if n < 2 || n != ys.len() {
        return Vec::new();
    }
    if n == 2 {
        // A line through two points is exact, so the residual spread is zero.
        return vec![
            Smoothed {
                x: xs[0],
                y: ys[0],
                std: 0.0,
            },
            Smoothed {
                x: xs[1],
                y: ys[1],
                std: 0.0,
            },
        ];
    }

    let x_min = xs.iter().copied().fold(f64::INFINITY, f64::min);
    let x_max = xs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let span = x_max - x_min;
    if span == 0.0 {
        let mean = ys.iter().sum::<f64>() / n as f64;
        return vec![Smoothed {
            x: x_min,
            y: mean,
            std: 0.0,
        }];
    }

    let count = output_count.max(2);
    let h = span / 3.0_f64.max((n as f64).sqrt());

    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let x0 = x_min + (i as f64 / (count - 1) as f64) * span;
        let (mut sw, mut swx, mut swy, mut swxx, mut swxy, mut swyy) =
            (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        for (&x, &y) in xs.iter().zip(ys) {
            let dx = (x - x0) / h;
            let w = (-0.5 * dx * dx).exp();
            sw += w;
            swx += w * x;
            swy += w * y;
            swxx += w * x * x;
            swxy += w * x * y;
            swyy += w * y * y;
        }

        let denom = sw * swxx - swx * swx;
        let (a, b) = if denom.abs() < 1e-12 {
            (if sw > 0.0 { swy / sw } else { 0.0 }, 0.0)
        } else {
            let b = (sw * swxy - swx * swy) / denom;
            (((swy - b * swx) / sw), b)
        };
        let y0 = a + b * x0;

        // The spread about the fitted line, not about `y0`: measured about a
        // single point it folds the local slope into the band.
        let variance = if sw > 0.0 {
            (swyy - 2.0 * a * swy - 2.0 * b * swxy + a * a * sw + 2.0 * a * b * swx + b * b * swxx)
                / sw
        } else {
            0.0
        };
        out.push(Smoothed {
            x: x0,
            y: y0,
            std: variance.max(0.0).sqrt(),
        });
    }
    out
}

/// The smoothed curve over `(time, value)` pairs, with its band, both clamped
/// to the values' own range plus padding so neither can leave the chart.
/// `None` below two attempts, since a trend needs two observations.
fn band(times: &[f64], values: &[f64]) -> Option<Vec<FfiTrendBandPoint>> {
    if times.len() < 2 {
        return None;
    }
    // Unix seconds squared lose their low digits in the weighted sums, so the
    // smoother runs on the range rescaled to 0..1 and the times are put back.
    let origin = times.iter().copied().fold(f64::INFINITY, f64::min);
    let span = times.iter().copied().fold(f64::NEG_INFINITY, f64::max) - origin;
    let unit: Vec<f64> = if span > 0.0 {
        times.iter().map(|t| (t - origin) / span).collect()
    } else {
        vec![0.0; times.len()]
    };
    let curve = smooth(&unit, values, CURVE_POINTS);
    if curve.len() < 2 {
        return None;
    }
    let lo = values.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let spread = (hi - lo) * RANGE_PADDING;
    let pad = if spread == 0.0 { FLAT_PADDING } else { spread };
    Some(
        curve
            .into_iter()
            .map(|p| FfiTrendBandPoint {
                time: origin + p.x * span,
                value: (lo - pad).max((hi + pad).min(p.y)),
                upper: (hi + pad).min(p.y + p.std),
                lower: (lo - pad).max(p.y - p.std),
            })
            .collect(),
    )
}

/// One counted attempt as the smoother sees it.
struct Attempt {
    time: f64,
    speed: f64,
    duration: f64,
    reverse: bool,
}

fn curves_over(attempts: Vec<Attempt>) -> FfiSectionTrendCurves {
    let curves = |reverse: bool| {
        let mut sorted: Vec<&Attempt> = attempts.iter().filter(|a| a.reverse == reverse).collect();
        sorted.sort_by(|a, b| a.time.total_cmp(&b.time));
        let times: Vec<f64> = sorted.iter().map(|a| a.time).collect();
        let speeds: Vec<f64> = sorted.iter().map(|a| a.speed).collect();
        let durations: Vec<f64> = sorted.iter().map(|a| a.duration).collect();
        (band(&times, &speeds), band(&times, &durations))
    };
    let (forward_speed, forward_time) = curves(false);
    let (reverse_speed, reverse_time) = curves(true);
    FfiSectionTrendCurves {
        forward_speed,
        forward_time,
        reverse_speed,
        reverse_time,
    }
}

/// The four curves over a section's counted attempts: each direction, by speed
/// and by section time. A reverse attempt is one whose direction reads
/// `reverse`; every other counts as forward.
pub(crate) fn trend_curves(points: &[FfiSectionChartPoint]) -> FfiSectionTrendCurves {
    curves_over(
        points
            .iter()
            .map(|p| Attempt {
                time: p.activity_date,
                speed: p.speed,
                duration: f64::from(p.section_time),
                reverse: p.direction == "reverse",
            })
            .collect(),
    )
}

/// The four curves over a route's counted attempts, on the same smoother as a
/// section's. A partial match, an attempt outside the route's distance band
/// and one with no finite speed are drawn or listed but never fitted. The
/// time axis is the attempt's elapsed time.
pub(crate) fn route_trend_curves(
    performances: &[crate::RoutePerformance],
) -> FfiSectionTrendCurves {
    curves_over(
        performances
            .iter()
            .filter(|p| p.direction != "partial" && !p.outside_distance_band && p.speed.is_finite())
            .map(|p| Attempt {
                time: p.date as f64,
                speed: p.speed,
                duration: f64::from(p.duration),
                reverse: p.direction == "reverse",
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: f64 = 86_400.0;

    fn point(day: f64, speed: f64, direction: &str) -> FfiSectionChartPoint {
        FfiSectionChartPoint {
            lap_id: format!("lap{day}"),
            activity_id: format!("a{day}"),
            activity_name: String::new(),
            activity_date: 1_700_000_000.0 + day * DAY,
            speed,
            section_time: (1000.0 / speed).round() as u32,
            section_distance: 1000.0,
            direction: direction.to_string(),
            is_best: false,
            avg_power: None,
        }
    }

    fn fixture() -> Vec<FfiSectionChartPoint> {
        [
            (0.0, 3.1),
            (1.0, 3.4),
            (3.0, 3.0),
            (7.0, 3.8),
            (8.0, 3.6),
            (15.0, 4.1),
            (20.0, 3.9),
        ]
        .iter()
        .map(|&(d, s)| point(d, s, "same"))
        .collect()
    }

    /// The TypeScript smoother's output on this fixture, sampled at five
    /// points; the curve here is 200 points, so compare at the indices that
    /// fall on those fractions of the span.
    #[test]
    fn the_speed_curve_matches_the_reference_smoother() {
        let curves = trend_curves(&fixture());
        let curve = curves.forward_speed.expect("seven attempts have a trend");
        assert_eq!(curve.len(), 200);
        let first = &curve[0];
        let last = &curve[199];
        assert!((first.value - 3.1258017699117113).abs() < 1e-9, "{first:?}");
        assert!((first.upper - 3.3299688265222978).abs() < 1e-9);
        assert!((first.lower - 2.921634713301125).abs() < 1e-9);
        assert!((last.value - 4.004615195322686).abs() < 1e-9, "{last:?}");
        assert!((last.upper - 4.179154945022948).abs() < 1e-9);
        assert!((last.lower - 3.8300754456224237).abs() < 1e-9);
        assert_eq!(first.time, 1_700_000_000.0);
        assert_eq!(last.time, 1_700_000_000.0 + 20.0 * DAY);
    }

    #[test]
    fn the_time_curve_matches_the_reference_smoother() {
        let curves = trend_curves(&fixture());
        let curve = curves.forward_time.expect("seven attempts have a trend");
        let first = &curve[0];
        let last = &curve[199];
        assert!((first.value - 319.61922133600956).abs() < 1e-6, "{first:?}");
        assert!((first.upper - 338.45428702110036).abs() < 1e-6);
        assert!((last.value - 248.83835561582998).abs() < 1e-6, "{last:?}");
        assert!((last.lower - 236.1541089369193).abs() < 1e-6);
    }

    #[test]
    fn a_direction_with_one_attempt_has_no_curve() {
        let mut points = fixture();
        points.push(point(10.0, 3.5, "reverse"));
        let curves = trend_curves(&points);
        assert!(curves.forward_speed.is_some());
        assert!(curves.reverse_speed.is_none());
        assert!(curves.reverse_time.is_none());
    }

    #[test]
    fn two_attempts_give_a_line_with_no_spread() {
        let points = vec![point(0.0, 3.0, "reverse"), point(4.0, 4.0, "reverse")];
        let curve = trend_curves(&points).reverse_speed.expect("two attempts");
        assert_eq!(curve.len(), 2);
        assert_eq!(curve[0].value, 3.0);
        assert_eq!(curve[1].value, 4.0);
        assert_eq!(curve[0].upper, 3.0);
        assert_eq!(curve[1].lower, 4.0);
    }

    #[test]
    fn attempts_on_one_instant_have_no_curve() {
        let points = vec![
            point(0.0, 3.0, "same"),
            point(0.0, 4.0, "same"),
            point(0.0, 5.0, "same"),
        ];
        assert!(trend_curves(&points).forward_speed.is_none());
    }

    #[test]
    fn no_attempts_give_no_curves() {
        let curves = trend_curves(&[]);
        assert!(curves.forward_speed.is_none() && curves.reverse_time.is_none());
    }

    #[test]
    fn the_input_order_does_not_move_the_curve() {
        let mut shuffled = fixture();
        shuffled.reverse();
        let a = trend_curves(&fixture()).forward_speed.unwrap();
        let b = trend_curves(&shuffled).forward_speed.unwrap();
        assert_eq!(a[100].value, b[100].value);
    }

    fn attempt(day: f64, speed: f64, direction: &str) -> crate::RoutePerformance {
        crate::RoutePerformance {
            activity_id: format!("a{day}"),
            name: String::new(),
            date: (1_700_000_000.0 + day * DAY) as i64,
            speed,
            duration: (1000.0 / speed).round() as u32,
            moving_time: (1000.0 / speed).round() as u32,
            distance: 1000.0,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            is_current: false,
            direction: direction.to_string(),
            match_percentage: None,
            outside_distance_band: false,
            is_record: false,
        }
    }

    #[test]
    fn a_route_curve_equals_the_section_curve_over_the_same_attempts() {
        let section = trend_curves(&fixture());
        let performances: Vec<crate::RoutePerformance> = fixture()
            .iter()
            .map(|p| attempt((p.activity_date - 1_700_000_000.0) / DAY, p.speed, "same"))
            .collect();
        let route = route_trend_curves(&performances);
        for (a, b) in [
            (section.forward_speed, route.forward_speed),
            (section.forward_time, route.forward_time),
        ] {
            let (a, b) = (a.unwrap(), b.unwrap());
            assert_eq!(a.len(), b.len());
            for (x, y) in a.iter().zip(&b) {
                assert!((x.time - y.time).abs() < 1e-6);
                assert!((x.value - y.value).abs() < 1e-9);
                assert!((x.upper - y.upper).abs() < 1e-9);
                assert!((x.lower - y.lower).abs() < 1e-9);
            }
        }
        assert!(route.reverse_speed.is_none());
    }

    #[test]
    fn a_route_curve_leaves_out_partial_and_out_of_band_attempts() {
        let mut performances: Vec<crate::RoutePerformance> = fixture()
            .iter()
            .map(|p| attempt((p.activity_date - 1_700_000_000.0) / DAY, p.speed, "same"))
            .collect();
        let clean = route_trend_curves(&performances);
        performances.push(attempt(25.0, 9.0, "partial"));
        let mut shortcut = attempt(26.0, 12.0, "same");
        shortcut.outside_distance_band = true;
        performances.push(shortcut);
        let mut unmeasured = attempt(27.0, 1.0, "same");
        unmeasured.speed = f64::NAN;
        performances.push(unmeasured);
        let with_extras = route_trend_curves(&performances);
        assert_eq!(
            clean.forward_speed.unwrap()[199].value,
            with_extras.forward_speed.unwrap()[199].value
        );
    }

    #[test]
    fn a_route_direction_with_one_attempt_has_no_curve() {
        let performances = vec![attempt(0.0, 3.0, "reverse")];
        assert!(route_trend_curves(&performances).reverse_speed.is_none());
        assert!(route_trend_curves(&[]).forward_time.is_none());
    }

    #[test]
    fn linear_attempts_have_no_spread_about_the_fitted_line() {
        let points: Vec<FfiSectionChartPoint> = (0..10)
            .map(|d| point(f64::from(d), 3.0 + 0.1 * f64::from(d), "same"))
            .collect();
        let curve = trend_curves(&points).forward_speed.unwrap();
        for p in &curve {
            assert!(p.upper - p.lower < 0.01, "{p:?}");
        }
        assert!((curve[0].value - 3.0).abs() < 0.05);
        assert!((curve[199].value - 3.9).abs() < 0.05);
    }

    #[test]
    fn scattered_attempts_keep_a_visible_band() {
        let points: Vec<FfiSectionChartPoint> = (0..20)
            .map(|d| point(f64::from(d), if d % 2 == 0 { 4.0 } else { 3.0 }, "same"))
            .collect();
        let curve = trend_curves(&points).forward_speed.unwrap();
        let mean = curve.iter().map(|p| p.upper - p.lower).sum::<f64>() / curve.len() as f64;
        assert!(mean > 0.5, "{mean}");
    }
}
