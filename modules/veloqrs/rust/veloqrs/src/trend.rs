//! One rule for "is this better, worse, or the same".
//!
//! Every trend chip, ranking score and wellness label used to carry its own
//! copy of the same three-way comparison, each with its own inequality and its
//! own idea of which direction counted as better. The deadband stays a
//! parameter because the screens genuinely disagree on how big a move has to
//! be, but the comparison itself lives here.

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

/// Improvement of `current` against `baseline` for a metric where **higher is
/// better** (HRV, power).
pub fn value_improvement(baseline: f64, current: f64) -> Option<f64> {
    if !baseline.is_finite() || baseline <= 0.0 || !current.is_finite() {
        return None;
    }
    Some((current - baseline) / baseline)
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

/// [`value_improvement`] then [`classify_change`], for higher-is-better metrics.
pub fn classify_value(baseline: f64, current: f64, deadband: f64) -> Option<i8> {
    value_improvement(baseline, current).map(|pct| classify_change(pct, deadband))
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
    if times.len() < 6 {
        return 0;
    }
    let n = times.len();
    let mut recent: Vec<f64> = times[n - 3..].to_vec();
    let mut previous: Vec<f64> = times[n - 6..n - 3].to_vec();
    recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    previous.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    classify_time(previous[1], recent[1], deadband).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO_PERCENT: f64 = 0.02;

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
        assert_eq!(classify_value(100.0, 100.0, 0.0), Some(0));
    }

    #[test]
    fn a_zero_or_negative_baseline_has_no_verdict() {
        assert_eq!(classify_time(0.0, 90.0, TWO_PERCENT), None);
        assert_eq!(classify_time(-10.0, 90.0, TWO_PERCENT), None);
        assert_eq!(classify_value(0.0, 90.0, TWO_PERCENT), None);
    }

    #[test]
    fn a_non_finite_input_has_no_verdict() {
        assert_eq!(classify_time(f64::NAN, 90.0, TWO_PERCENT), None);
        assert_eq!(classify_time(f64::INFINITY, 90.0, TWO_PERCENT), None);
        assert_eq!(classify_time(100.0, f64::NAN, TWO_PERCENT), None);
    }

    #[test]
    fn higher_is_better_flips_the_sign() {
        assert_eq!(classify_value(100.0, 103.0, TWO_PERCENT), Some(1));
        assert_eq!(classify_value(100.0, 97.0, TWO_PERCENT), Some(-1));
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
