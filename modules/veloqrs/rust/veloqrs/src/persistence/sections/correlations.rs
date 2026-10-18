//! Each wellness variable's relationship to attempt speed on one section.
//!
//! One point per activity per direction: the activity's fastest counted lap.
//! Laps of one activity share a wellness day, so counting each would repeat the
//! same x and inflate `n`. Which laps count is the chart's rule, so this reads
//! the chart's points and cannot disagree with the scatter about an attempt.

use std::collections::HashMap;

use crate::correlation::{Correlation, adjust_family, correlate};
use crate::{FfiCorrelation, FfiSectionCorrelation, FfiWellnessDay};

/// Complete pairs a variable needs before the panel may show a figure for it.
pub(crate) const MIN_PAIRS: usize = 10;

type Variable = (&'static str, fn(&FfiWellnessDay) -> Option<f64>);

const VARIABLES: [Variable; 12] = [
    ("ctl", |d| d.ctl),
    ("atl", |d| d.atl),
    ("hrv", |d| d.hrv),
    ("resting_hr", |d| d.resting_hr),
    ("weight", |d| d.weight),
    ("sleep_secs", |d| d.sleep_secs),
    ("sleep_score", |d| d.sleep_score),
    ("soreness", |d| d.soreness.map(f64::from)),
    ("fatigue", |d| d.fatigue.map(f64::from)),
    ("stress", |d| d.stress.map(f64::from)),
    ("mood", |d| d.mood.map(f64::from)),
    ("motivation", |d| d.motivation.map(f64::from)),
];

/// The attempt's local day. Stored dates are the athlete's wall clock read as
/// UTC, so the UTC calendar date is the day the wellness row is stamped with.
pub(crate) fn local_day(activity_date: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(activity_date, 0).map(|t| t.format("%Y-%m-%d").to_string())
}

/// Correlations for the counted attempts of `all` after `cutoff`, `same`
/// direction first. A variable no attempt of a direction has a value for is
/// left out: the athlete does not record it. A mover is labelled under Holm's
/// correction across the variables of its direction that carry an estimate.
pub(crate) fn section_correlations(
    all: &crate::SectionPerformanceResult,
    cutoff: i64,
    wellness: &[FfiWellnessDay],
) -> Vec<FfiSectionCorrelation> {
    let points = crate::persistence::sections::chart_from_cutoff(all, cutoff).points;
    let by_day: HashMap<&str, &FfiWellnessDay> =
        wellness.iter().map(|d| (d.date.as_str(), d)).collect();

    let mut out = Vec::new();
    for direction in ["same", "reverse"] {
        let mut fastest: HashMap<&str, (f64, i64)> = HashMap::new();
        for p in points
            .iter()
            .filter(|p| p.direction == direction && !p.outside_distance_band)
        {
            let entry = fastest
                .entry(p.activity_id.as_str())
                .or_insert((p.speed, p.activity_date as i64));
            if p.speed > entry.0 {
                *entry = (p.speed, p.activity_date as i64);
            }
        }
        let mut attempts: Vec<(f64, Option<&FfiWellnessDay>)> = fastest
            .into_values()
            .map(|(speed, date)| {
                let day = local_day(date);
                (speed, day.and_then(|d| by_day.get(d.as_str()).copied()))
            })
            .collect();
        // HashMap order is arbitrary and the coefficient sums floats.
        attempts.sort_by(|a, b| a.0.total_cmp(&b.0));

        let speeds: Vec<Option<f64>> = attempts.iter().map(|(s, _)| Some(*s)).collect();
        let (names, family): (Vec<&str>, Vec<Correlation>) = VARIABLES
            .iter()
            .filter_map(|(name, read)| {
                let values: Vec<Option<f64>> =
                    attempts.iter().map(|(_, d)| d.and_then(read)).collect();
                if values.iter().all(Option::is_none) {
                    return None;
                }
                Some((*name, correlate(&values, &speeds, MIN_PAIRS)))
            })
            .unzip();
        // Every variable is a test of the same speeds, so one direction's
        // variables are one family and a mover is held to the family's rate.
        let (family, family_size) = adjust_family(family);
        out.extend(
            names
                .into_iter()
                .zip(family)
                .map(|(name, result)| FfiSectionCorrelation {
                    direction: direction.to_string(),
                    variable: name.to_string(),
                    result: FfiCorrelation::from(result),
                    family_size: family_size as u32,
                }),
        );
    }
    out
}

impl From<Correlation> for FfiCorrelation {
    fn from(c: Correlation) -> Self {
        match c {
            Correlation::TooFew { n } => FfiCorrelation::TooFew { n: n as u32 },
            Correlation::Undefined { n } => FfiCorrelation::Undefined { n: n as u32 },
            Correlation::Inconclusive(e) => FfiCorrelation::Inconclusive {
                r: e.r,
                n: e.n as u32,
                low: e.low,
                high: e.high,
            },
            Correlation::Mover(e) => FfiCorrelation::Mover {
                r: e.r,
                n: e.n as u32,
                low: e.low,
                high: e.high,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SectionLap, SectionPerformanceRecord, SectionPerformanceResult};

    const DAY: i64 = 86_400;
    // 2023-11-14 22:13:20 as a wall clock read as UTC.
    const BASE: i64 = 1_700_000_000;

    fn lap(id: &str, pace: f64, direction: &str, coverage: Option<f64>) -> SectionLap {
        SectionLap {
            id: id.into(),
            activity_id: String::new(),
            time: 800.0 / pace,
            pace,
            distance: 800.0,
            direction: direction.into(),
            start_index: 0,
            end_index: 10,
            avg_hr: None,
            avg_power: None,
            coverage,
            excluded: false,
            outside_distance_band: false,
            match_percentage: None,
            is_record: false,
        }
    }

    fn record(id: &str, date: i64, laps: Vec<SectionLap>) -> SectionPerformanceRecord {
        SectionPerformanceRecord {
            activity_id: id.into(),
            activity_name: id.into(),
            activity_date: crate::WholeNumber(date),
            lap_count: laps.len() as u32,
            best_time: 0.0,
            best_pace: 0.0,
            best_forward_time: None,
            best_reverse_time: None,
            avg_time: 0.0,
            avg_pace: 0.0,
            direction: "same".into(),
            section_distance: 800.0,
            laps,
        }
    }

    fn result(records: Vec<SectionPerformanceRecord>) -> SectionPerformanceResult {
        SectionPerformanceResult {
            records,
            best_forward_record: None,
            best_reverse_record: None,
            forward_stats: None,
            reverse_stats: None,
        }
    }

    fn day(date: i64, f: impl FnOnce(&mut FfiWellnessDay)) -> FfiWellnessDay {
        let mut d = FfiWellnessDay {
            date: local_day(date).unwrap(),
            ctl: None,
            atl: None,
            ramp_rate: None,
            hrv: None,
            resting_hr: None,
            weight: None,
            sleep_secs: None,
            sleep_score: None,
            soreness: None,
            fatigue: None,
            stress: None,
            mood: None,
            motivation: None,
            sport_load: Vec::new(),
        };
        f(&mut d);
        d
    }

    /// `n` activities on successive days, speed 3.0 + 0.1 * i, hrv 50 + 2 * i
    /// (alternating offset so the series is not perfectly collinear in weight).
    fn series(n: usize) -> (SectionPerformanceResult, Vec<FfiWellnessDay>) {
        let mut records = Vec::new();
        let mut wellness = Vec::new();
        for i in 0..n {
            let date = BASE + i as i64 * DAY;
            let speed = 3.0 + 0.1 * i as f64;
            records.push(record(
                &format!("a{i}"),
                date,
                vec![lap(&format!("l{i}"), speed, "same", Some(1.0))],
            ));
            wellness.push(day(date, |d| {
                d.hrv = Some(50.0 + 2.0 * i as f64 + if i % 2 == 0 { 0.3 } else { -0.3 });
                d.weight = Some(70.0);
            }));
        }
        (result(records), wellness)
    }

    fn find<'a>(
        out: &'a [FfiSectionCorrelation],
        direction: &str,
        variable: &str,
    ) -> Option<&'a FfiCorrelation> {
        out.iter()
            .find(|c| c.direction == direction && c.variable == variable)
            .map(|c| &c.result)
    }

    #[test]
    fn twelve_attempts_whose_speed_rises_with_hrv_are_a_mover() {
        let (perf, wellness) = series(12);
        let out = section_correlations(&perf, i64::MIN, &wellness);
        match find(&out, "same", "hrv") {
            Some(FfiCorrelation::Mover { n, r, .. }) => {
                assert_eq!(*n, 12);
                assert!(*r > 0.99);
            }
            other => panic!("expected a mover, got {other:?}"),
        }
    }

    #[test]
    fn nine_attempts_are_too_few_for_every_recorded_variable() {
        let (perf, wellness) = series(9);
        let out = section_correlations(&perf, i64::MIN, &wellness);
        assert!(!out.is_empty());
        for c in &out {
            assert!(
                matches!(c.result, FfiCorrelation::TooFew { n: 9 }),
                "{} gave {:?}",
                c.variable,
                c.result
            );
        }
    }

    #[test]
    fn a_constant_weight_is_undefined() {
        let (perf, wellness) = series(12);
        let out = section_correlations(&perf, i64::MIN, &wellness);
        assert!(matches!(
            find(&out, "same", "weight"),
            Some(FfiCorrelation::Undefined { n: 12 })
        ));
    }

    #[test]
    fn a_variable_recorded_on_no_attempt_is_absent() {
        let (perf, wellness) = series(12);
        let out = section_correlations(&perf, i64::MIN, &wellness);
        assert!(find(&out, "same", "mood").is_none());
        assert!(find(&out, "same", "hrv").is_some());
    }

    #[test]
    fn several_laps_of_one_activity_make_one_pair() {
        let (mut perf, wellness) = series(10);
        // Two slower extra laps on the first activity change nothing.
        perf.records[0].laps.push(lap("x1", 2.0, "same", Some(1.0)));
        perf.records[0].laps.push(lap("x2", 2.1, "same", Some(1.0)));
        let out = section_correlations(&perf, i64::MIN, &wellness);
        assert!(matches!(
            find(&out, "same", "hrv"),
            Some(FfiCorrelation::Mover { n: 10, .. })
        ));
    }

    #[test]
    fn the_fastest_lap_of_an_activity_is_its_point() {
        let (mut perf, wellness) = series(10);
        perf.records[0]
            .laps
            .push(lap("fast", 9.0, "same", Some(1.0)));
        let with_fast = section_correlations(&perf, i64::MIN, &wellness);
        let (plain, _) = series(10);
        let without = section_correlations(&plain, i64::MIN, &wellness);
        assert_ne!(
            find(&with_fast, "same", "hrv"),
            find(&without, "same", "hrv")
        );
    }

    #[test]
    fn a_reverse_lap_never_enters_the_same_list() {
        let (mut perf, wellness) = series(10);
        for r in &mut perf.records {
            r.laps.push(lap("rev", 2.5, "reverse", Some(1.0)));
        }
        let out = section_correlations(&perf, i64::MIN, &wellness);
        assert!(matches!(
            find(&out, "same", "hrv"),
            Some(FfiCorrelation::Mover { n: 10, .. })
        ));
        // Reverse speed is constant, so it is undefined rather than a result.
        assert!(matches!(
            find(&out, "reverse", "hrv"),
            Some(FfiCorrelation::Undefined { n: 10 })
        ));
    }

    #[test]
    fn partial_and_under_covered_laps_are_skipped() {
        let (mut perf, wellness) = series(12);
        perf.records[0].laps = vec![lap("p", 3.0, "partial", Some(1.0))];
        perf.records[1].laps = vec![lap("c", 3.1, "same", Some(0.1))];
        let out = section_correlations(&perf, i64::MIN, &wellness);
        assert!(matches!(
            find(&out, "same", "hrv"),
            Some(FfiCorrelation::Mover { n: 10, .. })
        ));
    }

    /// Scenario: the same twelve variables recorded on every attempt in both
    /// directions, with ctl constant throughout.
    /// Expected behaviour: each row carries its own direction's family, the
    /// variables that carried an estimate there.
    #[test]
    fn each_direction_carries_the_size_of_its_own_family() {
        let (mut perf, mut wellness) = noise_library(7, 0.0);
        for (r, d) in perf.records.iter_mut().zip(wellness.iter_mut()) {
            r.laps.push(lap(
                "rev",
                3.0 + d.atl.unwrap() / 100.0,
                "reverse",
                Some(1.0),
            ));
        }
        // A constant ctl is undefined in both directions, so neither tests it.
        for d in &mut wellness {
            d.ctl = Some(60.0);
        }
        let out = section_correlations(&perf, i64::MIN, &wellness);
        for direction in ["same", "reverse"] {
            let rows: Vec<_> = out.iter().filter(|c| c.direction == direction).collect();
            assert_eq!(rows.len(), 12);
            assert!(rows.iter().all(|c| c.family_size == 11), "{direction}");
        }
    }

    #[test]
    fn a_family_with_too_few_pairs_has_size_zero() {
        let (perf, wellness) = series(9);
        let out = section_correlations(&perf, i64::MIN, &wellness);
        assert!(!out.is_empty());
        assert!(out.iter().all(|c| c.family_size == 0));
    }

    /// A deterministic stream of standard normal draws, so a seed names one
    /// library and the rates below are the same on every run.
    struct Noise(u64);

    impl Noise {
        fn uniform(&mut self) -> f64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^= z >> 31;
            ((z >> 11) as f64 + 0.5) / (1u64 << 53) as f64
        }

        fn normal(&mut self) -> f64 {
            let (u, v) = (self.uniform(), self.uniform());
            (-2.0 * u.ln()).sqrt() * (std::f64::consts::TAU * v).cos()
        }
    }

    /// Thirty attempts on successive days with every wellness variable drawn
    /// independently of speed, except `hrv` when `hrv_weight` is non-zero:
    /// then it carries that share of the speed's own draw.
    fn noise_library(
        seed: u64,
        hrv_weight: f64,
    ) -> (SectionPerformanceResult, Vec<FfiWellnessDay>) {
        let mut noise = Noise(seed);
        let mut records = Vec::new();
        let mut wellness = Vec::new();
        for i in 0..30 {
            let date = BASE + i as i64 * DAY;
            let pull = noise.normal();
            records.push(record(
                &format!("a{i}"),
                date,
                vec![lap(&format!("l{i}"), 4.0 + 0.3 * pull, "same", Some(1.0))],
            ));
            let mut draw = || noise.normal();
            let scale = |x: f64| (50.0 + 10.0 * x).round() as i32;
            let hrv = hrv_weight * pull + (1.0 - hrv_weight * hrv_weight).sqrt() * draw();
            wellness.push(FfiWellnessDay {
                date: local_day(date).unwrap(),
                ctl: Some(60.0 + 5.0 * draw()),
                atl: Some(70.0 + 8.0 * draw()),
                ramp_rate: None,
                hrv: Some(55.0 + 6.0 * hrv),
                resting_hr: Some(48.0 + 3.0 * draw()),
                weight: Some(70.0 + 0.8 * draw()),
                sleep_secs: Some(27_000.0 + 2_000.0 * draw()),
                sleep_score: Some(75.0 + 8.0 * draw()),
                soreness: Some(scale(draw())),
                fatigue: Some(scale(draw())),
                stress: Some(scale(draw())),
                mood: Some(scale(draw())),
                motivation: Some(scale(draw())),
                sport_load: Vec::new(),
            });
        }
        (result(records), wellness)
    }

    fn interval_excludes_zero(c: &FfiSectionCorrelation) -> bool {
        match c.result {
            FfiCorrelation::Mover { low, high, .. }
            | FfiCorrelation::Inconclusive { low, high, .. } => low > 0.0 || high < 0.0,
            _ => false,
        }
    }

    /// Scenario: twelve wellness variables with no relationship to speed,
    /// thirty attempts, over many libraries.
    /// Expected behaviour: a library shows a mover about one time in twenty,
    /// the family-wise rate, although some variable's own 95 per cent
    /// interval misses zero in close to half of them.
    #[test]
    fn noise_across_twelve_variables_is_a_mover_about_one_library_in_twenty() {
        const LIBRARIES: u64 = 400;
        let mut unadjusted = 0;
        let mut labelled = 0;
        for seed in 0..LIBRARIES {
            let (perf, wellness) = noise_library(seed, 0.0);
            let out = section_correlations(&perf, i64::MIN, &wellness);
            assert_eq!(out.len(), 12, "every variable is tested");
            if out.iter().any(interval_excludes_zero) {
                unadjusted += 1;
            }
            if out
                .iter()
                .any(|c| matches!(c.result, FfiCorrelation::Mover { .. }))
            {
                labelled += 1;
            }
        }
        let unadjusted = unadjusted as f64 / LIBRARIES as f64;
        let labelled = labelled as f64 / LIBRARIES as f64;
        assert!(
            unadjusted > 0.3,
            "the noise should fool an unadjusted reading often, it did {unadjusted}"
        );
        assert!(
            labelled <= 0.07,
            "a mover appeared in {labelled} of noise libraries"
        );
    }

    /// Scenario: one variable carries a strong relationship to speed, r about
    /// 0.8 over thirty attempts, among eleven that carry none.
    /// Expected behaviour: it is still a mover after the family is accounted
    /// for, so the correction cannot pass by labelling nothing.
    #[test]
    fn a_strong_relationship_among_noise_stays_a_mover() {
        for seed in 0..50 {
            let (perf, wellness) = noise_library(seed, 0.8);
            let out = section_correlations(&perf, i64::MIN, &wellness);
            match find(&out, "same", "hrv") {
                Some(FfiCorrelation::Mover { n: 30, .. }) => {}
                other => panic!("seed {seed}: expected a mover, got {other:?}"),
            }
        }
    }

    #[test]
    fn a_late_evening_start_joins_its_own_days_row() {
        // 23:30 on the day of BASE's midnight.
        let midnight = BASE - BASE % DAY;
        let late = midnight + 23 * 3600 + 1800;
        let mut records = Vec::new();
        let mut wellness = Vec::new();
        for i in 0..10i64 {
            let date = if i == 0 {
                late
            } else {
                midnight + (i + 1) * DAY
            };
            records.push(record(
                &format!("a{i}"),
                date,
                vec![lap("l", 3.0 + 0.1 * i as f64, "same", Some(1.0))],
            ));
            wellness.push(day(date, |d| {
                d.hrv = Some(50.0 + 2.0 * i as f64 + (i % 3) as f64)
            }));
        }
        // A row for the next day with a wild value must not be picked up.
        wellness.push(day(midnight + DAY, |d| d.hrv = Some(1000.0)));
        let out = section_correlations(&result(records), i64::MIN, &wellness);
        match find(&out, "same", "hrv") {
            Some(FfiCorrelation::Mover { n: 10, r, .. }) => assert!(*r > 0.9),
            other => panic!("got {other:?}"),
        }
    }
}
