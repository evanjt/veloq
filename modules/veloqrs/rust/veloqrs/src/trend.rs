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
