//! Pearson's r with the sample size and the interval that have to travel with
//! it.
//!
//! The panel this exists for shows an athlete a number about their own body,
//! computed over however many attempts they happen to have. So a bare
//! coefficient is not an answer this module will give: every result carries
//! `n` and the 95 per cent interval, and a sample under the caller's floor
//! returns `TooFew` rather than a number the caller could render by accident.

/// Smallest sample Fisher's transform is defined for: the standard error is
/// `1 / sqrt(n - 3)`.
const MIN_FISHER_SAMPLES: usize = 4;

/// 97.5th percentile of the standard normal, the two-sided 95 per cent bound.
const Z_95: f64 = 1.959_964;

/// One variable's relationship to the measure, or the reason there is not one.
///
/// Deliberately not a struct with optional fields: a caller that wants a
/// coefficient has to name the case it is in first.
#[derive(Debug, Clone, PartialEq)]
pub enum Correlation {
    /// Fewer complete pairs than the floor asked for. `n` is what there was,
    /// so a screen can say how many more attempts it would take.
    TooFew { n: usize },
    /// One of the two series never varies, so there is no relationship to
    /// measure rather than a weak one. A section walked at the same pace every
    /// time lands here, and so does a wellness field the athlete never fills.
    Undefined { n: usize },
    /// Enough pairs, but the interval spans zero. Reported rather than hidden,
    /// because "we looked and could not tell" is different from "we did not
    /// look", and the panel decides which of the two it draws.
    Inconclusive(Estimate),
    /// The interval excludes zero.
    Mover(Estimate),
}

/// A coefficient and everything needed to read it honestly.
#[derive(Debug, Clone, PartialEq)]
pub struct Estimate {
    pub r: f64,
    pub n: usize,
    /// Lower bound of the 95 per cent interval on `r`, through Fisher's z.
    pub low: f64,
    /// Upper bound of the same interval.
    pub high: f64,
}

impl Correlation {
    /// The estimate, when there is one. `None` for `TooFew` and `Undefined`,
    /// which is what stops a caller printing a coefficient that does not exist.
    pub fn estimate(&self) -> Option<&Estimate> {
        match self {
            Correlation::Inconclusive(e) | Correlation::Mover(e) => Some(e),
            _ => None,
        }
    }

    /// Whether the interval excludes zero.
    pub fn is_mover(&self) -> bool {
        matches!(self, Correlation::Mover(_))
    }
}

/// Pearson's r over the pairs where both series have a value.
///
/// **Pairwise complete, not listwise.** A wellness row can hold `hrv` and not
/// `weight`, and dropping the whole attempt because one field is absent would
/// throw away the attempts this is for. So `n` differs per variable, which is
/// exactly why `n` is reported beside every coefficient.
///
/// `floor` is the caller's, not this module's: how many attempts are enough
/// before an athlete is shown a number about themselves is a product decision,
/// and putting a default here would make it silently.
pub fn correlate(xs: &[Option<f64>], ys: &[Option<f64>], floor: usize) -> Correlation {
    let pairs: Vec<(f64, f64)> = xs
        .iter()
        .zip(ys.iter())
        .filter_map(|(x, y)| match (x, y) {
            (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Some((*x, *y)),
            _ => None,
        })
        .collect();

    let n = pairs.len();
    if n < floor.max(MIN_FISHER_SAMPLES) {
        return Correlation::TooFew { n };
    }

    let count = n as f64;
    let mean_x = pairs.iter().map(|(x, _)| x).sum::<f64>() / count;
    let mean_y = pairs.iter().map(|(_, y)| y).sum::<f64>() / count;

    let mut covariance = 0.0;
    let mut var_x = 0.0;
    let mut var_y = 0.0;
    for (x, y) in &pairs {
        let dx = x - mean_x;
        let dy = y - mean_y;
        covariance += dx * dy;
        var_x += dx * dx;
        var_y += dy * dy;
    }

    // A constant series has no spread to share, so r is undefined rather than
    // zero. This is the division an implementation gets wrong.
    if var_x <= 0.0 || var_y <= 0.0 {
        return Correlation::Undefined { n };
    }

    // Clamped because the accumulation above can land a hair outside [-1, 1]
    // on a perfect relationship, and `atanh` of exactly 1 is infinite.
    let r = (covariance / (var_x * var_y).sqrt()).clamp(-1.0, 1.0);

    let (low, high) = interval(r, n);
    let estimate = Estimate { r, n, low, high };
    if low > 0.0 || high < 0.0 {
        Correlation::Mover(estimate)
    } else {
        Correlation::Inconclusive(estimate)
    }
}

/// The 95 per cent interval on `r`, through Fisher's z transform: `r` is not
/// normally distributed but `atanh(r)` is close enough to be, so the interval
/// is built there and brought back.
///
/// A perfect relationship has an interval of exactly itself, which is honest:
/// `atanh(1)` is infinite and `tanh` of that is 1 again.
fn interval(r: f64, n: usize) -> (f64, f64) {
    let z = r.atanh();
    let standard_error = 1.0 / ((n as f64) - 3.0).sqrt();
    let low = (z - Z_95 * standard_error).tanh();
    let high = (z + Z_95 * standard_error).tanh();
    (low.clamp(-1.0, 1.0), high.clamp(-1.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn some(values: &[f64]) -> Vec<Option<f64>> {
        values.iter().map(|v| Some(*v)).collect()
    }

    /// A relationship with a hand-checkable answer: y = 2x + 1 is perfect, so
    /// r is 1 and the interval is the point itself.
    #[test]
    fn a_perfect_line_is_r_of_one() {
        let xs = some(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let ys = some(&[3.0, 5.0, 7.0, 9.0, 11.0, 13.0]);

        let result = correlate(&xs, &ys, 4);

        let e = result.estimate().expect("an estimate");
        assert!((e.r - 1.0).abs() < 1e-12, "r was {}", e.r);
        assert_eq!(e.n, 6);
        assert!(result.is_mover());
    }

    #[test]
    fn a_perfect_inverse_line_is_r_of_minus_one() {
        let xs = some(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let ys = some(&[13.0, 11.0, 9.0, 7.0, 5.0, 3.0]);

        let e = correlate(&xs, &ys, 4)
            .estimate()
            .cloned()
            .expect("an estimate");

        assert!((e.r + 1.0).abs() < 1e-12, "r was {}", e.r);
        assert_eq!(e.high, -1.0);
    }

    /// Known answer, cross-checked against Python's `statistics.correlation`
    /// on the same two series rather than against this implementation.
    #[test]
    fn a_known_series_gives_the_published_coefficient() {
        let xs = some(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        let ys = some(&[2.0, 4.0, 5.0, 4.0, 8.0]);

        let e = correlate(&xs, &ys, 4)
            .estimate()
            .cloned()
            .expect("an estimate");

        assert!(
            (e.r - 0.866_025_403_784_438_7).abs() < 1e-12,
            "r was {}",
            e.r
        );
        assert!(
            e.low < e.r && e.r < e.high,
            "{} not inside {}..{}",
            e.r,
            e.low,
            e.high
        );
    }

    /// A wellness row can hold one field and not another, so a missing value
    /// drops its pair and keeps the rest. Listwise deletion would throw away
    /// the attempts this exists for.
    #[test]
    fn a_missing_value_drops_its_pair_and_nothing_else() {
        let xs = vec![Some(1.0), None, Some(3.0), Some(4.0), Some(5.0), Some(6.0)];
        let ys = vec![
            Some(3.0),
            Some(99.0),
            Some(7.0),
            Some(9.0),
            Some(11.0),
            Some(13.0),
        ];

        let e = correlate(&xs, &ys, 4)
            .estimate()
            .cloned()
            .expect("an estimate");

        // The five surviving pairs are still the perfect line.
        assert_eq!(e.n, 5);
        assert!((e.r - 1.0).abs() < 1e-12, "r was {}", e.r);
    }

    /// A gap on either side removes the pair, so two gaps in different places
    /// cost two pairs and the remainder falls under Fisher's own floor.
    #[test]
    fn a_missing_value_on_either_side_drops_the_pair() {
        let xs = vec![Some(1.0), Some(2.0), None, Some(4.0), Some(5.0)];
        let ys = vec![Some(3.0), None, Some(7.0), Some(9.0), Some(11.0)];

        assert_eq!(correlate(&xs, &ys, 4), Correlation::TooFew { n: 3 });
    }

    /// NaN and infinity are not values, and they must not reach the sums.
    #[test]
    fn a_non_finite_value_is_not_a_pair() {
        let xs = vec![
            Some(1.0),
            Some(f64::NAN),
            Some(3.0),
            Some(4.0),
            Some(f64::INFINITY),
        ];
        let ys = vec![Some(3.0), Some(5.0), Some(7.0), Some(9.0), Some(11.0)];

        match correlate(&xs, &ys, 4) {
            Correlation::TooFew { n } => assert_eq!(n, 3),
            other => panic!("three usable pairs should be too few, got {:?}", other),
        }
    }

    /// The floor is the whole point of the type: below it there is no number
    /// to render, only a count.
    #[test]
    fn a_sample_under_the_floor_carries_no_coefficient() {
        let xs = some(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]);
        let ys = some(&[3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0]);

        let result = correlate(&xs, &ys, 12);

        assert_eq!(result, Correlation::TooFew { n: 7 });
        assert!(result.estimate().is_none());
        assert!(!result.is_mover());
    }

    #[test]
    fn a_sample_exactly_on_the_floor_is_answered() {
        let xs = some(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let ys = some(&[3.0, 5.0, 7.0, 9.0, 11.0, 13.0]);

        assert!(correlate(&xs, &ys, 6).estimate().is_some());
        assert_eq!(
            correlate(&xs, &ys[..5].to_vec(), 6),
            Correlation::TooFew { n: 5 }
        );
    }

    /// Fisher's transform needs four pairs whatever the caller's floor says,
    /// because the standard error divides by `n - 3`.
    #[test]
    fn a_floor_below_fishers_own_is_raised_to_it() {
        let xs = some(&[1.0, 2.0, 3.0]);
        let ys = some(&[3.0, 5.0, 7.0]);

        assert_eq!(correlate(&xs, &ys, 0), Correlation::TooFew { n: 3 });
        assert_eq!(correlate(&xs, &ys, 1), Correlation::TooFew { n: 3 });
    }

    #[test]
    fn empty_and_single_samples_carry_no_coefficient() {
        assert_eq!(correlate(&[], &[], 4), Correlation::TooFew { n: 0 });
        assert_eq!(
            correlate(&[Some(1.0)], &[Some(2.0)], 4),
            Correlation::TooFew { n: 1 }
        );
    }

    /// A section walked at the same pace every time, or a wellness field the
    /// athlete never varies. There is no relationship rather than a weak one,
    /// and this is the division that would otherwise be by zero.
    #[test]
    fn a_constant_series_is_undefined_not_zero() {
        let flat = some(&[5.0, 5.0, 5.0, 5.0, 5.0]);
        let varying = some(&[1.0, 2.0, 3.0, 4.0, 5.0]);

        assert_eq!(
            correlate(&flat, &varying, 4),
            Correlation::Undefined { n: 5 }
        );
        assert_eq!(
            correlate(&varying, &flat, 4),
            Correlation::Undefined { n: 5 }
        );
        assert_eq!(correlate(&flat, &flat, 4), Correlation::Undefined { n: 5 });
    }

    /// The case the panel exists to refuse: enough attempts, a coefficient
    /// that looks like something, and an interval that spans zero.
    #[test]
    fn an_interval_spanning_zero_is_inconclusive_rather_than_a_mover() {
        // Weak positive drift with noise over ten pairs.
        let xs = some(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]);
        let ys = some(&[5.0, 1.0, 8.0, 2.0, 9.0, 3.0, 10.0, 4.0, 11.0, 6.0]);

        let result = correlate(&xs, &ys, 4);

        let e = result.estimate().expect("an estimate");
        assert!(
            e.low < 0.0 && e.high > 0.0,
            "interval {}..{} should span zero",
            e.low,
            e.high
        );
        assert!(!result.is_mover());
        assert!(matches!(result, Correlation::Inconclusive(_)));
    }

    /// More of the same relationship narrows the interval. This is what makes
    /// `n` worth printing beside `r` rather than only the coefficient.
    #[test]
    fn a_larger_sample_narrows_the_interval() {
        let short_x = some(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        let short_y = some(&[2.0, 4.0, 5.0, 4.0, 8.0]);
        let long_x: Vec<Option<f64>> = short_x.iter().cycle().take(25).cloned().collect();
        let long_y: Vec<Option<f64>> = short_y.iter().cycle().take(25).cloned().collect();

        let short = correlate(&short_x, &short_y, 4)
            .estimate()
            .cloned()
            .unwrap();
        let long = correlate(&long_x, &long_y, 4).estimate().cloned().unwrap();

        assert!(
            (short.r - long.r).abs() < 1e-12,
            "the relationship is the same"
        );
        assert!(
            (long.high - long.low) < (short.high - short.low),
            "25 pairs {}..{} should be tighter than 5 pairs {}..{}",
            long.low,
            long.high,
            short.low,
            short.high
        );
    }

    /// Order is the pairing, not the value: shuffling both series the same way
    /// is the same relationship.
    #[test]
    fn the_coefficient_does_not_depend_on_the_order_of_the_pairs() {
        let xs = some(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        let ys = some(&[2.0, 4.0, 5.0, 4.0, 8.0]);
        let rev_x: Vec<Option<f64>> = xs.iter().rev().cloned().collect();
        let rev_y: Vec<Option<f64>> = ys.iter().rev().cloned().collect();

        let forward = correlate(&xs, &ys, 4).estimate().cloned().unwrap();
        let backward = correlate(&rev_x, &rev_y, 4).estimate().cloned().unwrap();

        assert!((forward.r - backward.r).abs() < 1e-12);
    }

    /// The interval always contains the coefficient, on every shape above.
    #[test]
    fn the_interval_always_contains_the_coefficient() {
        let cases: [(&[f64], &[f64]); 3] = [
            (&[1.0, 2.0, 3.0, 4.0, 5.0], &[2.0, 4.0, 5.0, 4.0, 8.0]),
            (&[1.0, 2.0, 3.0, 4.0, 5.0], &[8.0, 4.0, 5.0, 4.0, 2.0]),
            (
                &[3.0, 1.0, 4.0, 1.0, 5.0, 9.0],
                &[2.0, 7.0, 1.0, 8.0, 2.0, 8.0],
            ),
        ];

        for (xs, ys) in cases {
            let e = correlate(&some(xs), &some(ys), 4)
                .estimate()
                .cloned()
                .expect("an estimate");
            assert!(
                e.low <= e.r && e.r <= e.high,
                "{} outside {}..{}",
                e.r,
                e.low,
                e.high
            );
            assert!(
                e.low >= -1.0 && e.high <= 1.0,
                "{}..{} outside [-1, 1]",
                e.low,
                e.high
            );
        }
    }
}
