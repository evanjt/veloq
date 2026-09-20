//! How far the newest reading of a series sits from its own baseline, in
//! standard deviations of the series behind it.
//!
//! The corridor the insight ranker scores against is in those units, so a
//! series that cannot carry the reading gives none rather than a number on
//! another scale. An absence is a claim the ranker can read; an invented
//! number is not.

/// The z-score, or `None` when the series cannot carry one.
///
/// Two readings and some spread between them is the floor: a flat series puts
/// every reading on the baseline, where a distance in deviations means nothing.
/// The variance is the population's, over the samples given rather than over a
/// sample of a larger series.
pub fn signal_delta(value: f64, baseline: f64, samples: &[f64]) -> Option<f64> {
    if !value.is_finite() || !baseline.is_finite() {
        return None;
    }
    if samples.len() < 2 || !samples.iter().all(|s| s.is_finite()) {
        return None;
    }
    let n = samples.len() as f64;
    let mean = samples.iter().sum::<f64>() / n;
    let variance = samples.iter().map(|s| (s - mean).powi(2)).sum::<f64>() / n;
    let stddev = variance.sqrt();
    if stddev == 0.0 {
        return None;
    }
    Some((value - baseline).abs() / stddev)
}

/// The mean of a series, or `None` when there is nothing to average.
pub fn mean(samples: &[f64]) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    Some(samples.iter().sum::<f64>() / samples.len() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reading_is_measured_in_the_series_own_deviations() {
        let samples = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];

        assert_eq!(signal_delta(9.0, 5.0, &samples), Some(2.0));
        assert_eq!(signal_delta(4.0, 5.0, &samples), Some(0.5));
    }

    #[test]
    fn distance_is_unsigned_so_either_side_reads_the_same() {
        let samples = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];

        assert_eq!(
            signal_delta(1.0, 5.0, &samples),
            signal_delta(9.0, 5.0, &samples)
        );
    }

    #[test]
    fn a_series_with_no_spread_carries_no_reading() {
        assert!(signal_delta(6.0, 5.0, &[5.0, 5.0, 5.0, 5.0]).is_none());
        assert!(signal_delta(9.0, 5.0, &[5.0]).is_none());
        assert!(signal_delta(9.0, 5.0, &[]).is_none());
    }

    #[test]
    fn nothing_finite_is_nothing_to_read() {
        let samples = [2.0, 4.0, 7.0, 9.0];

        assert!(signal_delta(f64::NAN, 5.0, &samples).is_none());
        assert!(signal_delta(9.0, f64::INFINITY, &samples).is_none());
        assert!(signal_delta(9.0, 5.0, &[2.0, f64::NAN, 7.0, 9.0]).is_none());
    }
}
