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

/// Share of a section a traversal must cover before it can be its record.
///
/// The rule this replaced compared the lap's own track length against the
/// section's. GPS wobble makes that ratio 1.05 at p50 and 1.34 at p95 on laps
/// squarely on the ground, so a lap joining a third of the way along cleared a
/// 0.7 bar and was crowned fastest on a fragment.
pub const MIN_SECTION_COVERAGE: f64 = 0.9;

/// The length ratio the coverage rule replaced. Still the answer for a row
/// whose coverage has not been measured yet, so an install that has not run
/// the backfill keeps the records it had rather than losing all of them.
pub const MIN_LENGTH_RATIO: f64 = 0.7;

/// True when a traversal covers enough of its section to stand as a record.
///
/// `coverage` is the fraction of the section the lap spans, `None` until the
/// backfill measures it. `lap_metres` and `section_metres` are the fallback,
/// and a section with no length of its own admits everything.
pub fn covers_enough_for_record(
    coverage: Option<f64>,
    lap_metres: f64,
    section_metres: f64,
) -> bool {
    if let Some(coverage) = coverage
        && coverage.is_finite()
    {
        return coverage >= MIN_SECTION_COVERAGE;
    }
    if !section_metres.is_finite() || section_metres <= 0.0 {
        return true;
    }
    lap_metres >= section_metres * MIN_LENGTH_RATIO
}

/// [`covers_enough_for_record`] as a SQL predicate over `section_activities sa`
/// joined to `sections s`, so the indicator queries cannot drift from the Rust.
pub fn complete_traversal_sql() -> String {
    format!(
        "CASE WHEN sa.coverage IS NOT NULL THEN sa.coverage >= {MIN_SECTION_COVERAGE} \
              WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1 \
              ELSE sa.distance_meters >= s.distance_meters * {MIN_LENGTH_RATIO} END"
    )
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

    /// Expected behaviour: a measured lap is judged on how much of the section
    /// it covers, and an unmeasured one falls back to the length rule rather
    /// than losing its record.
    #[test]
    fn coverage_decides_a_record_once_it_is_measured() {
        assert!(covers_enough_for_record(Some(0.9), 1.0, 1000.0));
        assert!(covers_enough_for_record(Some(1.0), 1.0, 1000.0));
        assert!(!covers_enough_for_record(Some(0.89), 5000.0, 1000.0));

        // The measured case that opened this: 86 per cent of the section's
        // length, 59 per cent of its ground.
        assert!(!covers_enough_for_record(Some(0.59), 860.0, 1000.0));
    }

    #[test]
    fn an_unmeasured_lap_falls_back_to_the_length_rule() {
        assert!(covers_enough_for_record(None, 700.0, 1000.0));
        assert!(!covers_enough_for_record(None, 699.0, 1000.0));
    }

    #[test]
    fn a_section_with_no_length_admits_everything_unmeasured() {
        assert!(covers_enough_for_record(None, 10.0, 0.0));
        assert!(covers_enough_for_record(None, 10.0, f64::NAN));
        assert!(!covers_enough_for_record(Some(0.1), 10.0, 0.0));
    }

    #[test]
    fn a_non_finite_coverage_is_not_a_measurement() {
        assert!(covers_enough_for_record(Some(f64::NAN), 700.0, 1000.0));
        assert!(!covers_enough_for_record(Some(f64::NAN), 699.0, 1000.0));
    }
}
