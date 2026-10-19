//! One rule for "is this better, worse, or the same".
//!
//! Every trend chip, ranking score and wellness label used to carry its own
//! copy of the same three-way comparison, each with its own inequality and its
//! own idea of which direction counted as better. The deadband stays a
//! parameter because the screens genuinely disagree on how big a move has to
//! be, but the comparison itself lives here.
//!
//! A verdict on a whole series, rather than on two numbers, goes through
//! [`classify_estimate`]: the change has to clear its own 95 per cent interval
//! as well as a floor, so a noisy series is not read as a trend.

/// Improvement of `current` against `baseline`, as a fraction of the baseline,
/// for a metric where **lower is better** (lap and split times).
///
/// `None` when the baseline carries no signal: zero, negative or non-finite.
pub fn time_improvement(baseline: f64, current: f64) -> Option<f64> {
    if !baseline.is_finite() || baseline <= 0.0 || !current.is_finite() {
        return None;
    }
    Some((baseline - current) / baseline)
}

/// Three-way verdict on a signed improvement fraction: `1` better, `-1` worse,
/// `0` inside the deadband. The comparison is strict on both sides, so a move
/// of exactly the deadband reads as stable.
pub fn classify_change(improvement: f64, deadband: f64) -> i8 {
    debug_assert!(deadband >= 0.0, "deadband must not be negative");
    if !improvement.is_finite() {
        return 0;
    }
    if improvement > deadband {
        1
    } else if improvement < -deadband {
        -1
    } else {
        0
    }
}

/// [`time_improvement`] then [`classify_change`], the shape every lap-time
/// trend actually wants. `None` when the baseline carries no signal.
pub fn classify_time(baseline: f64, current: f64, deadband: f64) -> Option<i8> {
    time_improvement(baseline, current).map(|pct| classify_change(pct, deadband))
}

/// A three-way trend over one series of times, oldest to newest. Sections and
/// routes both stand on it, so neither reads a thinner history than the other.
///
/// The median of the last three efforts against the median of the three
/// before. Under six traversals there are not two windows to compare and the
/// verdict is stable: it used to fall back to the first effort against the
/// last, which is one day against one day, so a headwind on the first ride
/// read as a season of progress while the card said "Recent median".
pub fn median_window_trend(times: &[f64], deadband: f64) -> i8 {
    median_window_medians(times)
        .and_then(|(previous, recent)| classify_time(previous, recent, deadband))
        .unwrap_or(0)
}

/// The two medians [`median_window_trend`] compares, previous then recent:
/// the three efforts before the last three, and the last three. `None` under
/// six times, where there are not two windows.
pub fn median_window_medians(times: &[f64]) -> Option<(f64, f64)> {
    let n = times.len();
    if n < 6 {
        return None;
    }
    Some((
        median_of_three(&times[n - 6..n - 3]),
        median_of_three(&times[n - 3..]),
    ))
}

fn median_of_three(window: &[f64]) -> f64 {
    let mut sorted = window.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    sorted[1]
}

/// A change estimated from a series, with what it takes to judge it: its
/// standard error, the degrees of freedom behind that error, and the series'
/// own spread around the fit, in the series' units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Change {
    pub size: f64,
    pub std_error: f64,
    pub dof: usize,
    pub spread: f64,
}

/// Two-sided 95 per cent critical values of Student's t for one to thirty
/// degrees of freedom.
const T_95: [f64; 30] = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160,
    2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056,
    2.052, 2.048, 2.045, 2.042,
];

/// 97.5th percentile of the standard normal.
const Z_95: f64 = 1.959_964;

/// The two-sided 95 per cent critical value of Student's t on `dof` degrees of
/// freedom: tabulated to thirty, past that the Cornish-Fisher expansion about
/// the normal, which is within 0.001 of the table at thirty and converges on
/// 1.96. Infinite at zero, so a change with no freedom to judge it never
/// clears its interval.
pub fn t_critical_95(dof: usize) -> f64 {
    match dof {
        0 => f64::INFINITY,
        1..=30 => T_95[dof - 1],
        _ => {
            let v = dof as f64;
            let z = Z_95;
            z + (z.powi(3) + z) / (4.0 * v)
                + (5.0 * z.powi(5) + 16.0 * z.powi(3) + 3.0 * z) / (96.0 * v * v)
        }
    }
}

/// Three-way verdict on an estimated change: `1` when it rose, `-1` when it
/// fell, `0` when its 95 per cent interval spans zero or it is no larger than
/// `floor`, the smallest change worth calling in the series' units. This is
/// the rule for whether a series moved; a fixed percentage on its own ignores
/// how noisy the series is, so scatter crosses it as readily as a trend does.
pub fn classify_estimate(change: &Change, floor: f64) -> i8 {
    if !change.size.is_finite() || !change.std_error.is_finite() || change.std_error < 0.0 {
        return 0;
    }
    let margin = t_critical_95(change.dof) * change.std_error;
    if change.size.abs() <= margin || change.size.abs() <= floor.max(0.0) {
        return 0;
    }
    if change.size > 0.0 { 1 } else { -1 }
}

/// The least-squares slope of `y` on `x`, with its standard error from the
/// residuals on `n - 2` degrees of freedom. `None` under three points, when
/// every `x` is the same, or when a value is not finite.
pub fn slope_change(points: &[(f64, f64)]) -> Option<Change> {
    if points.len() < 3 || !points.iter().all(|(x, y)| x.is_finite() && y.is_finite()) {
        return None;
    }
    let n = points.len() as f64;
    let mean_x = points.iter().map(|(x, _)| x).sum::<f64>() / n;
    let mean_y = points.iter().map(|(_, y)| y).sum::<f64>() / n;
    let sxx: f64 = points.iter().map(|(x, _)| (x - mean_x).powi(2)).sum();
    if sxx <= 0.0 {
        return None;
    }
    let sxy: f64 = points
        .iter()
        .map(|(x, y)| (x - mean_x) * (y - mean_y))
        .sum();
    let slope = sxy / sxx;
    let dof = points.len() - 2;
    let residual_ss: f64 = points
        .iter()
        .map(|(x, y)| (y - (mean_y + slope * (x - mean_x))).powi(2))
        .sum();
    let residual_variance = residual_ss / dof as f64;
    Some(Change {
        size: slope,
        std_error: (residual_variance / sxx).sqrt(),
        dof,
        spread: residual_variance.sqrt(),
    })
}

/// The mean of `newer` minus the mean of `older`, with the standard error of
/// that difference from the spread pooled across both groups, on
/// `len - 2` degrees of freedom. `None` when either group is empty, when there
/// is no freedom left to estimate the spread, or when a value is not finite.
pub fn mean_shift(older: &[f64], newer: &[f64]) -> Option<Change> {
    if older.is_empty() || newer.is_empty() || older.len() + newer.len() < 3 {
        return None;
    }
    if !older.iter().chain(newer).all(|v| v.is_finite()) {
        return None;
    }
    let mean = |xs: &[f64]| xs.iter().sum::<f64>() / xs.len() as f64;
    let squares = |xs: &[f64], m: f64| xs.iter().map(|v| (v - m).powi(2)).sum::<f64>();
    let (older_mean, newer_mean) = (mean(older), mean(newer));
    let dof = older.len() + newer.len() - 2;
    let pooled_variance = (squares(older, older_mean) + squares(newer, newer_mean)) / dof as f64;
    let weight = 1.0 / older.len() as f64 + 1.0 / newer.len() as f64;
    Some(Change {
        size: newer_mean - older_mean,
        std_error: (pooled_variance * weight).sqrt(),
        dof,
        spread: pooled_variance.sqrt(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO_PERCENT: f64 = 0.02;

    #[test]
    fn the_medians_are_the_three_before_and_the_last_three() {
        let times = [3000.0, 3010.0, 3020.0, 2900.0, 2910.0, 2920.0];
        assert_eq!(median_window_medians(&times), Some((3010.0, 2910.0)));
        assert_eq!(median_window_trend(&times, TWO_PERCENT), 1);
    }

    #[test]
    fn five_times_have_no_medians() {
        assert_eq!(
            median_window_medians(&[3000.0, 3010.0, 3020.0, 2900.0, 2910.0]),
            None
        );
    }

    #[test]
    fn faster_than_the_deadband_is_improving() {
        assert_eq!(classify_time(100.0, 97.0, TWO_PERCENT), Some(1));
    }

    #[test]
    fn slower_than_the_deadband_is_declining() {
        assert_eq!(classify_time(100.0, 103.0, TWO_PERCENT), Some(-1));
    }

    #[test]
    fn inside_the_deadband_is_stable_in_both_directions() {
        assert_eq!(classify_time(100.0, 99.0, TWO_PERCENT), Some(0));
        assert_eq!(classify_time(100.0, 101.0, TWO_PERCENT), Some(0));
    }

    #[test]
    fn exactly_the_deadband_is_stable() {
        assert_eq!(classify_time(100.0, 98.0, TWO_PERCENT), Some(0));
        assert_eq!(classify_time(100.0, 102.0, TWO_PERCENT), Some(0));
    }

    #[test]
    fn an_unchanged_value_is_stable_even_with_no_deadband() {
        assert_eq!(classify_time(100.0, 100.0, 0.0), Some(0));
    }

    #[test]
    fn a_zero_or_negative_baseline_has_no_verdict() {
        assert_eq!(classify_time(0.0, 90.0, TWO_PERCENT), None);
        assert_eq!(classify_time(-10.0, 90.0, TWO_PERCENT), None);
    }

    #[test]
    fn a_non_finite_input_has_no_verdict() {
        assert_eq!(classify_time(f64::NAN, 90.0, TWO_PERCENT), None);
        assert_eq!(classify_time(f64::INFINITY, 90.0, TWO_PERCENT), None);
        assert_eq!(classify_time(100.0, f64::NAN, TWO_PERCENT), None);
    }

    #[test]
    fn classify_change_reads_a_raw_fraction() {
        assert_eq!(classify_change(0.05, 0.03), 1);
        assert_eq!(classify_change(-0.05, 0.03), -1);
        assert_eq!(classify_change(0.03, 0.03), 0);
        assert_eq!(classify_change(f64::NAN, 0.03), 0);
    }
}

/// Scenario: a section the athlete has ridden a handful of times. The card
/// says "Recent median" under a verdict that, below six traversals, compared
/// one day against one day.
///
/// Expected behaviour: the verdict is the medians the card names, and nothing
/// at all until there are two windows of three to compare.
#[cfg(test)]
mod median_window_trend_tests {
    use super::median_window_trend;

    const TWO_PERCENT: f64 = 0.02;

    #[test]
    fn five_traversals_with_a_fast_last_one_are_no_trend() {
        // 380, 400, 405, 410, 372: first against last called this improving
        // while the middle three were the athlete's slowest.
        let times = [380.0, 400.0, 405.0, 410.0, 372.0];
        assert_eq!(median_window_trend(&times, TWO_PERCENT), 0);
    }

    #[test]
    fn five_traversals_are_no_trend_in_either_direction() {
        assert_eq!(
            median_window_trend(&[405.0, 400.0, 395.0, 385.0, 380.0], TWO_PERCENT),
            0
        );
        assert_eq!(
            median_window_trend(&[380.0, 385.0, 395.0, 400.0, 405.0], TWO_PERCENT),
            0
        );
    }

    #[test]
    fn six_traversals_speak_in_either_direction() {
        assert_eq!(
            median_window_trend(&[405.0, 400.0, 395.0, 385.0, 380.0, 375.0], TWO_PERCENT),
            1
        );
        assert_eq!(
            median_window_trend(&[375.0, 380.0, 385.0, 395.0, 400.0, 405.0], TWO_PERCENT),
            -1
        );
    }

    #[test]
    fn three_traversals_are_no_trend() {
        // A headwind on the first ride is not a season of progress.
        assert_eq!(median_window_trend(&[400.0, 395.0, 380.0], TWO_PERCENT), 0);
    }

    #[test]
    fn six_traversals_compare_the_two_medians() {
        // Medians 400 then 380, five per cent faster.
        let times = [405.0, 400.0, 395.0, 385.0, 380.0, 375.0];
        assert_eq!(median_window_trend(&times, TWO_PERCENT), 1);
    }

    #[test]
    fn a_rising_median_is_a_decline() {
        let times = [375.0, 380.0, 385.0, 395.0, 400.0, 405.0];
        assert_eq!(median_window_trend(&times, TWO_PERCENT), -1);
    }

    #[test]
    fn a_move_inside_the_deadband_is_stable() {
        // Medians 400 then 398, half a per cent.
        let times = [401.0, 400.0, 399.0, 399.0, 398.0, 397.0];
        assert_eq!(median_window_trend(&times, TWO_PERCENT), 0);
    }

    #[test]
    fn the_windows_are_the_newest_six_and_the_order_inside_one_does_not_matter() {
        let times = [900.0, 900.0, 405.0, 400.0, 395.0, 385.0, 380.0, 375.0];
        let shuffled = [900.0, 900.0, 400.0, 405.0, 395.0, 375.0, 380.0, 385.0];
        assert_eq!(median_window_trend(&times, TWO_PERCENT), 1);
        assert_eq!(median_window_trend(&shuffled, TWO_PERCENT), 1);
    }
}

/// Scenario: a series whose change has to be told apart from its own scatter.
///
/// Expected behaviour: a direction only when the 95 per cent interval excludes
/// zero and the change is larger than the floor.
#[cfg(test)]
mod estimate_tests {
    use super::*;

    #[test]
    fn t_critical_values_match_the_table_and_approach_the_normal() {
        assert_eq!(t_critical_95(1), 12.706);
        assert_eq!(t_critical_95(3), 3.182);
        assert_eq!(t_critical_95(30), 2.042);
        assert!((t_critical_95(31) - 2.040).abs() < 0.001);
        assert!((t_critical_95(60) - 2.000).abs() < 0.001);
        assert!((t_critical_95(120) - 1.980).abs() < 0.001);
        assert!(t_critical_95(10_000) > Z_95 && t_critical_95(10_000) < 1.961);
        assert!(t_critical_95(0).is_infinite());
    }

    #[test]
    fn a_perfect_line_has_its_slope_and_no_error() {
        let change = slope_change(&[(0.0, 1.0), (1.0, 3.0), (2.0, 5.0), (3.0, 7.0)]).unwrap();
        assert!((change.size - 2.0).abs() < 1e-12);
        assert!(change.std_error.abs() < 1e-12);
        assert_eq!(change.dof, 2);
        assert_eq!(classify_estimate(&change, 0.0), 1);
    }

    /// Hand-checked: y = 1, 3, 2, 4 on x = 0..3 fits a slope of 0.8 with
    /// residuals -0.3, 0.9, -0.9, 0.3, so the residual variance is 1.8 / 2 and
    /// the slope's standard error is sqrt(0.9 / 5).
    #[test]
    fn the_slope_error_comes_from_the_residuals() {
        let change = slope_change(&[(0.0, 1.0), (1.0, 3.0), (2.0, 2.0), (3.0, 4.0)]).unwrap();
        assert!((change.size - 0.8).abs() < 1e-12);
        assert!((change.std_error - (0.9_f64 / 5.0).sqrt()).abs() < 1e-12);
        assert!((change.spread - 0.9_f64.sqrt()).abs() < 1e-12);
        // 0.8 against 4.303 * 0.424: the interval spans zero.
        assert_eq!(classify_estimate(&change, 0.0), 0);
    }

    #[test]
    fn a_slope_needs_three_points_and_more_than_one_x() {
        assert_eq!(slope_change(&[(0.0, 1.0), (1.0, 2.0)]), None);
        assert_eq!(slope_change(&[(1.0, 1.0), (1.0, 2.0), (1.0, 3.0)]), None);
        assert_eq!(
            slope_change(&[(0.0, 1.0), (1.0, f64::NAN), (2.0, 3.0)]),
            None
        );
    }

    /// Hand-checked: groups 1, 2, 3 and 5, 6, 7 each sum squares to 2, so the
    /// pooled variance is 4 / 4 and the error on a shift of 4 is sqrt(2 / 3).
    #[test]
    fn a_mean_shift_is_judged_against_the_pooled_spread() {
        let change = mean_shift(&[1.0, 2.0, 3.0], &[5.0, 6.0, 7.0]).unwrap();
        assert!((change.size - 4.0).abs() < 1e-12);
        assert!((change.std_error - (2.0_f64 / 3.0).sqrt()).abs() < 1e-12);
        assert_eq!(change.dof, 4);
        assert!((change.spread - 1.0).abs() < 1e-12);
        assert_eq!(classify_estimate(&change, 0.0), 1);
        let reversed = mean_shift(&[5.0, 6.0, 7.0], &[1.0, 2.0, 3.0]).unwrap();
        assert_eq!(classify_estimate(&reversed, 0.0), -1);
    }

    #[test]
    fn a_shift_inside_the_scatter_is_no_change() {
        let change = mean_shift(&[1.0, 9.0, 5.0], &[3.0, 11.0, 7.0]).unwrap();
        assert_eq!(classify_estimate(&change, 0.0), 0);
    }

    #[test]
    fn a_shift_needs_two_groups_and_a_spare_degree_of_freedom() {
        assert_eq!(mean_shift(&[], &[1.0, 2.0]), None);
        assert_eq!(mean_shift(&[1.0, 2.0], &[]), None);
        assert_eq!(mean_shift(&[1.0], &[2.0]), None);
        assert_eq!(mean_shift(&[1.0, f64::INFINITY], &[2.0]), None);
    }

    #[test]
    fn a_clear_change_no_larger_than_the_floor_is_no_change() {
        let change = Change {
            size: 2.0,
            std_error: 0.1,
            dof: 10,
            spread: 0.3,
        };
        assert_eq!(classify_estimate(&change, 2.0), 0);
        assert_eq!(classify_estimate(&change, 1.9), 1);
        let falling = Change {
            size: -2.0,
            ..change
        };
        assert_eq!(classify_estimate(&falling, 2.0), 0);
        assert_eq!(classify_estimate(&falling, 1.9), -1);
    }

    #[test]
    fn no_change_at_all_is_no_change_even_with_no_error() {
        let change = mean_shift(&[50.0, 50.0], &[50.0, 50.0, 50.0]).unwrap();
        assert_eq!(classify_estimate(&change, 0.0), 0);
    }

    #[test]
    fn a_non_finite_change_has_no_direction() {
        let change = Change {
            size: f64::NAN,
            std_error: 0.0,
            dof: 5,
            spread: 0.0,
        };
        assert_eq!(classify_estimate(&change, 0.0), 0);
    }
}
