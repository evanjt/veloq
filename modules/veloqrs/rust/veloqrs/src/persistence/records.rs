//! The one personal-record rule.
//!
//! A traversal is a PR when it equals the best time for its (section or route,
//! direction) pair. Ties count and float noise counts, a whole second does not.
//! Four sites once carried four thresholds: 1 ms, 10 ms, exact integer seconds,
//! and a 0.5 % relative band.
//!
//! The band is not float noise, it is a different question: "did you match your
//! best", not "is this your best". The activity screen's encounter list asks it
//! deliberately and has a regression test that says so, so it keeps its own
//! predicate here rather than one of the two readings being silently dropped.

/// Widest gap, in seconds, that still reads as the same time. Integer-second
/// sources compare exactly under it, and f64 seconds absorb their own noise.
pub const PR_TOLERANCE_SECS: f64 = 0.01;

/// True when `time_secs` is the best time. Non-finite or non-positive inputs
/// are never a record.
pub fn is_personal_record(time_secs: f64, best_secs: f64) -> bool {
    if !time_secs.is_finite() || !best_secs.is_finite() {
        return false;
    }
    if time_secs <= 0.0 || best_secs <= 0.0 {
        return false;
    }
    (time_secs - best_secs).abs() < PR_TOLERANCE_SECS
}

/// Relative width of the "matched your best" band used by the activity
/// screen's section encounters. Scales with effort length, so a 5 s sprint and
/// a 30 min climb both read fairly.
pub const NEAR_PR_RELATIVE_TOLERANCE: f64 = 0.005;

/// True when `time_secs` lands inside the band around the best time. Wider than
/// [`is_personal_record`] on purpose, and never true for degenerate inputs.
pub fn matches_personal_record(time_secs: f64, best_secs: f64) -> bool {
    if !time_secs.is_finite() || !best_secs.is_finite() {
        return false;
    }
    if time_secs <= 0.0 || best_secs <= 0.0 {
        return false;
    }
    ((time_secs - best_secs) / best_secs).abs() < NEAR_PR_RELATIVE_TOLERANCE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_best_time_is_a_record() {
        assert!(is_personal_record(612.4, 612.4));
    }

    #[test]
    fn float_noise_still_reads_as_the_best_time() {
        assert!(is_personal_record(612.4 + 1e-9, 612.4));
        assert!(is_personal_record(612.4 - 1e-9, 612.4));
    }

    #[test]
    fn a_whole_second_off_the_best_is_not_a_record() {
        assert!(!is_personal_record(613.0, 612.0));
        assert!(!is_personal_record(1801.0, 1800.0));
    }

    #[test]
    fn a_relative_band_does_not_reopen_on_long_efforts() {
        // 0.4 % of a 30 minute climb is 7 seconds. The old section rule called
        // that a PR, the route rule did not.
        assert!(!is_personal_record(1807.0, 1800.0));
    }

    #[test]
    fn slower_and_faster_are_symmetric() {
        assert_eq!(
            is_personal_record(100.005, 100.0),
            is_personal_record(99.995, 100.0)
        );
    }

    #[test]
    fn the_band_scales_with_the_length_of_the_effort() {
        assert!(matches_personal_record(5.0, 4.99));
        assert!(matches_personal_record(1800.0, 1799.0));
        assert!(!matches_personal_record(100.0, 90.0));
    }

    #[test]
    fn the_band_is_wider_than_the_record_rule_and_contains_it() {
        assert!(is_personal_record(1799.0, 1799.0));
        assert!(matches_personal_record(1799.0, 1799.0));
        assert!(!is_personal_record(1800.0, 1799.0));
        assert!(matches_personal_record(1800.0, 1799.0));
    }

    #[test]
    fn degenerate_inputs_are_never_a_record() {
        assert!(!is_personal_record(0.0, 0.0));
        assert!(!is_personal_record(-5.0, -5.0));
        assert!(!is_personal_record(f64::NAN, 100.0));
        assert!(!is_personal_record(100.0, f64::INFINITY));
        assert!(!is_personal_record(100.0, f64::MAX));
        assert!(!matches_personal_record(0.0, 100.0));
        assert!(!matches_personal_record(100.0, 0.0));
        assert!(!matches_personal_record(f64::NAN, 100.0));
        assert!(!matches_personal_record(100.0, f64::MAX));
    }
}
