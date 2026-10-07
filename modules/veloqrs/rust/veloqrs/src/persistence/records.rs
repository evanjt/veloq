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

/// The podium place, 1 to 3, an effort takes among the other outings over the
/// same ground, or `None` for fourth and below.
///
/// A place is one plus the number of other outings that beat the effort, so a
/// tie for second is second for both. An effort with no other outing has
/// beaten nothing and takes no place, and a tie for first beats nobody, so it
/// takes none either: `Some(1)` is exactly [`is_personal_record`].
pub fn podium_place(time_secs: f64, rivals: &[f64]) -> Option<u32> {
    if rivals.is_empty() || !time_secs.is_finite() || time_secs <= 0.0 {
        return None;
    }
    let faster = rivals
        .iter()
        .filter(|r| r.is_finite() && **r > 0.0 && time_secs - **r >= PR_TOLERANCE_SECS)
        .count() as u32;
    let place = faster + 1;
    if place == 1 {
        let best = rivals
            .iter()
            .copied()
            .filter(|r| r.is_finite() && *r > 0.0)
            .fold(None, |b: Option<f64>, r| Some(b.map_or(r, |b| b.min(r))));
        return is_personal_record(time_secs, best).then_some(1);
    }
    (place <= 3).then_some(place)
}

/// How far from a route's usual distance an attempt may be and still count
/// toward the route's record, as a fraction of that distance.
///
/// A route groups attempts whose distances differ by up to half, so a corner
/// cut or a GPS drop is a faster time over less ground, not a faster time.
/// Cycling and running attempts sit within five per cent of their route's
/// usual distance, and every other sport has the wider ten per cent until its
/// own spread is measured.
pub fn route_distance_band(sport: &str) -> f64 {
    if crate::sport::is_cycling(sport) || crate::sport::is_running(sport) {
        0.05
    } else {
        0.10
    }
}

/// The statistical median of the finite, positive distances, which is the
/// mean of the two middle values for an even count. `None` when there are
/// none.
pub fn median_distance(distances: impl IntoIterator<Item = f64>) -> Option<f64> {
    let mut sorted: Vec<f64> = distances
        .into_iter()
        .filter(|d| d.is_finite() && *d > 0.0)
        .collect();
    if sorted.is_empty() {
        return None;
    }
    sorted.sort_by(f64::total_cmp);
    let mid = sorted.len() / 2;
    Some(if sorted.len() % 2 == 1 {
        sorted[mid]
    } else {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    })
}

/// True when an attempt's distance is within the sport's band around the
/// route's usual distance. The edge is inside. A route with no usual distance
/// leaves every attempt inside.
pub fn within_route_distance_band(sport: &str, distance: f64, centre: Option<f64>) -> bool {
    let Some(centre) = centre else {
        return true;
    };
    (distance - centre).abs() <= route_distance_band(sport) * centre
}

/// The distances that count toward one bucket's record, given every timed
/// attempt's distance in the bucket (one sport, one direction): the ones
/// inside the band around the bucket's median. The median is taken over every
/// timed attempt, so the band judges each attempt against the route as it is
/// usually run.
pub fn counted_for_route_record(sport: &str, distances: &[f64]) -> Vec<bool> {
    let centre = median_distance(distances.iter().copied());
    distances
        .iter()
        .map(|d| within_route_distance_band(sport, *d, centre))
        .collect()
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

/// The best other outing in a section result's selected sport and direction.
pub fn section_record_rival(
    result: &crate::SectionPerformanceResult,
    record: &crate::SectionPerformanceRecord,
) -> Option<f64> {
    result
        .records
        .iter()
        .filter(|other| other.activity_id != record.activity_id)
        .flat_map(|other| &other.laps)
        .filter(|lap| {
            lap.direction == record.direction
                && covers_enough_for_record(lap.coverage, lap.distance, record.section_distance)
        })
        .map(|lap| lap.time)
        .filter(|time| time.is_finite() && *time > 0.0)
        .reduce(f64::min)
}

/// Whether a section's per-direction best strictly beats another outing.
pub fn is_section_record_pr(
    result: &crate::SectionPerformanceResult,
    record: &crate::SectionPerformanceRecord,
) -> bool {
    is_personal_record(record.best_time, section_record_rival(result, record))
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
    complete_traversal_sql_for("sa", "s")
}

/// A complete traversal as a `WHERE` fragment, to append after a condition:
/// not a `partial` overlap, and covering enough of the section to stand as a
/// traversal of it. The ranking, the section ledger and the encounters share
/// it, so none of them can take a fragment the record screen refuses.
pub fn complete_traversal_clause(sa: &str, s: &str) -> String {
    format!(
        " AND {sa}.direction != 'partial' AND ({})",
        complete_traversal_sql_for(sa, s)
    )
}

/// The same predicate over whichever aliases the caller joined under.
///
/// A query that reaches the junction twice, as the stale read's subquery does,
/// cannot use `sa` for both halves, and writing the `CASE` out a second time
/// is how the rule drifts from the Rust it mirrors.
pub fn complete_traversal_sql_for(sa: &str, s: &str) -> String {
    format!(
        "CASE WHEN {sa}.coverage IS NOT NULL THEN {sa}.coverage >= {MIN_SECTION_COVERAGE} \
              WHEN {s}.distance_meters IS NULL OR {s}.distance_meters <= 0 THEN 1 \
              ELSE {sa}.distance_meters >= {s}.distance_meters * {MIN_LENGTH_RATIO} END"
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn podium_places_follow_the_strictly_faster_count() {
        let others = [100.0, 110.0, 120.0, 130.0];
        assert_eq!(podium_place(95.0, &others), Some(1));
        assert_eq!(podium_place(105.0, &others), Some(2));
        assert_eq!(podium_place(115.0, &others), Some(3));
        assert_eq!(podium_place(125.0, &others), None);
        assert_eq!(podium_place(200.0, &others), None);
    }

    #[test]
    fn a_tie_for_second_is_second_for_both_and_a_tie_for_first_is_unplaced() {
        assert_eq!(podium_place(110.0, &[100.0, 110.0, 130.0]), Some(2));
        assert_eq!(podium_place(100.0, &[100.0, 110.0]), None);
    }

    #[test]
    fn a_lone_or_unmeasured_effort_takes_no_place() {
        assert_eq!(podium_place(100.0, &[]), None);
        assert_eq!(podium_place(0.0, &[90.0]), None);
        assert_eq!(podium_place(f64::NAN, &[90.0]), None);
    }

    use super::*;

    #[test]
    fn the_median_of_an_even_count_is_the_mean_of_the_middle_two() {
        assert_eq!(
            median_distance([4000.0, 5000.0, 6000.0, 9000.0]),
            Some(5500.0)
        );
        assert_eq!(median_distance([4000.0, 5000.0, 6000.0]), Some(5000.0));
        assert_eq!(median_distance([0.0, f64::NAN]), None);
    }

    #[test]
    fn the_band_is_five_per_cent_for_cycling_and_running_and_ten_otherwise() {
        assert_eq!(route_distance_band("Ride"), 0.05);
        assert_eq!(route_distance_band("Run"), 0.05);
        assert_eq!(route_distance_band("Walk"), 0.10);
    }

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
