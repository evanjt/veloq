//! The one personal-record rule.
//!
//! A traversal is a PR when it **beats** every other effort over its (section
//! or route, direction) pair. A tie is not a beat and goes unmarked, and an
//! effort with nothing beside it has beaten nothing, so a first outing is
//! never a record. Float noise is not a beat either, a whole second is.
//! Four sites once carried four thresholds: 1 ms, 10 ms, exact integer seconds,
//! and a 0.5 % relative band. All four now ask this one question.
//!
//! The band was the last to go. It asked "did you match your best", which the
//! activity screen's encounter list badged as a record on efforts up to half a
//! per cent off. Matching is not beating.

/// Widest gap, in seconds, that still reads as the same time. Integer-second
/// sources compare exactly under it, and f64 seconds absorb their own noise.
/// A beat has to clear it, so the two readings partition the line.
pub const PR_TOLERANCE_SECS: f64 = 0.01;

/// True when `time_secs` beats every other effort over the same ground.
///
/// `rival_secs` is the best of those other efforts, and `None` says there are
/// none: a first outing has beaten nothing and is not a record. Non-finite or
/// non-positive inputs are never a record either.
pub fn is_personal_record(time_secs: f64, rival_secs: Option<f64>) -> bool {
    let Some(rival_secs) = rival_secs else {
        return false;
    };
    if !time_secs.is_finite() || !rival_secs.is_finite() {
        return false;
    }
    if time_secs <= 0.0 || rival_secs <= 0.0 {
        return false;
    }
    rival_secs - time_secs >= PR_TOLERANCE_SECS
}

/// The best and the second best of a set of times, ignoring the unusable.
///
/// Two efforts tied at the fastest time give the same value twice, which is
/// what makes a tie leave both of them facing it.
pub fn best_two(times: impl IntoIterator<Item = f64>) -> (Option<f64>, Option<f64>) {
    let mut best: Option<f64> = None;
    let mut second: Option<f64> = None;
    for t in times {
        if !t.is_finite() || t <= 0.0 {
            continue;
        }
        match best {
            Some(b) if t < b => {
                second = Some(b);
                best = Some(t);
            }
            Some(_) => {
                if second.is_none_or(|s| t < s) {
                    second = Some(t);
                }
            }
            None => best = Some(t),
        }
    }
    (best, second)
}

/// The best of the efforts other than the one being judged, given the best and
/// the second best of the whole set.
///
/// For the effort holding the best time that is the second best, and for any
/// other it is the best, which it cannot beat. `None` when there is nothing
/// else, which is the single-effort case.
pub fn rival_of(
    time_secs: f64,
    best_secs: Option<f64>,
    second_best_secs: Option<f64>,
) -> Option<f64> {
    let best = best_secs?;
    if (time_secs - best).abs() < PR_TOLERANCE_SECS {
        second_best_secs
    } else {
        Some(best)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beating_the_best_time_is_a_record() {
        assert!(is_personal_record(611.4, Some(612.4)));
    }

    #[test]
    fn matching_the_best_time_is_not_a_record() {
        assert!(!is_personal_record(612.4, Some(612.4)));
    }

    #[test]
    fn float_noise_is_not_a_beat() {
        assert!(!is_personal_record(612.4 - 1e-9, Some(612.4)));
        assert!(!is_personal_record(612.4 + 1e-9, Some(612.4)));
    }

    #[test]
    fn having_beaten_nothing_is_not_a_record() {
        assert!(!is_personal_record(612.4, None));
    }

    #[test]
    fn a_whole_second_off_the_best_is_not_a_record() {
        assert!(!is_personal_record(613.0, Some(612.0)));
        assert!(!is_personal_record(1801.0, Some(1800.0)));
    }

    #[test]
    fn a_relative_band_does_not_reopen_on_long_efforts() {
        // 0.4 % of a 30 minute climb is 7 seconds. The old section rule called
        // that a PR, the route rule did not.
        assert!(!is_personal_record(1807.0, Some(1800.0)));
    }

    #[test]
    fn the_tolerance_partitions_the_line_rather_than_leaving_a_gap() {
        // Exactly the tolerance is a beat, anything under it is the same time.
        assert!(is_personal_record(100.0 - PR_TOLERANCE_SECS, Some(100.0)));
        assert!(!is_personal_record(
            100.0 - PR_TOLERANCE_SECS / 2.0,
            Some(100.0)
        ));
    }

    /// Expected behaviour: only the holder of the best time is measured against
    /// the second best. Everyone else is measured against the best and loses.
    #[test]
    fn the_rival_is_the_best_of_the_others() {
        assert_eq!(rival_of(90.0, Some(90.0), Some(100.0)), Some(100.0));
        assert_eq!(rival_of(100.0, Some(90.0), Some(100.0)), Some(90.0));
        assert_eq!(rival_of(90.0, Some(90.0), None), None);
        assert_eq!(rival_of(90.0, None, None), None);
    }

    /// Expected behaviour: the pair is read straight off the set, a tie at the
    /// front gives the same time twice, and an unusable time is not one of them.
    #[test]
    fn the_best_two_are_the_two_fastest_usable_times() {
        assert_eq!(best_two([100.0, 90.0, 110.0]), (Some(90.0), Some(100.0)));
        assert_eq!(best_two([90.0, 90.0]), (Some(90.0), Some(90.0)));
        assert_eq!(best_two([90.0]), (Some(90.0), None));
        assert_eq!(best_two([]), (None, None));
        assert_eq!(best_two([f64::NAN, 0.0, -1.0, 90.0]), (Some(90.0), None));
    }

    /// Expected behaviour: two efforts tied at the best each face the other, so
    /// neither beats it.
    #[test]
    fn a_tie_at_the_best_leaves_both_facing_that_time() {
        assert_eq!(rival_of(90.0, Some(90.0), Some(90.0)), Some(90.0));
        assert!(!is_personal_record(
            90.0,
            rival_of(90.0, Some(90.0), Some(90.0))
        ));
    }

    /// Expected behaviour: the near miss the retired 0.5 % band called a record
    /// is not one at either end of the range it was built to serve.
    #[test]
    fn a_near_miss_is_not_a_record_at_any_length_of_effort() {
        assert!(!is_personal_record(5.0, Some(4.99)));
        assert!(!is_personal_record(1800.0, Some(1799.0)));
    }

    #[test]
    fn degenerate_inputs_are_never_a_record() {
        assert!(!is_personal_record(0.0, Some(0.0)));
        assert!(!is_personal_record(-5.0, Some(-5.0)));
        assert!(!is_personal_record(f64::NAN, Some(100.0)));
        assert!(!is_personal_record(100.0, Some(f64::INFINITY)));
        // A sentinel best used to have to be rejected here. Absence is `None`
        // now, so no caller can express it as a number at all, and the case
        // that assertion guarded is gone from the type rather than the body.
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
