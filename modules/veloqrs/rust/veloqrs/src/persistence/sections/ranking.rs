//! Weighted section relevance ranking.

use chrono::Utc;

use super::super::PersistentEngine;

/// A ranked section's median has to move by this fraction before the chip
/// calls it improving or declining. Matches the feed card deadband.
const TREND_DEADBAND: f64 = 0.02;
pub(crate) const SECTION_TREND_MAX_AGE_DAYS: u32 = 28;

pub(crate) fn eligible_trend(trend: i8, days_since_last: u32, max_age_days: u32) -> Option<i8> {
    (trend != 0 && days_since_last <= max_age_days).then_some(trend)
}

// What a lap has to be before the ranking scores it: not a `partial` overlap,
// and covering enough of the section to stand as a traversal of it.
//
// The same two rules the indicators and the performances apply, and for the
// same reason. The backfill writes a lap time to any row whose end index is
// past its start, so a 200 m fragment of a 2 km section carries one, and
// without these the fragment enters the medians, takes `best_time_secs` and
// makes the trend read as a large gain, while the section screen and the feed
// badge for the same section go on showing the full lap.
use crate::persistence::records::complete_traversal_clause;

/// The same traversal join the per-sport read runs, with no sport filter and
/// the sport carried on each row, so one statement answers every sport.
const TRAVERSALS_BY_SPORT: &str =
    "SELECT s.id, s.name, sa.lap_time, am.date, am.sport_type, sa.direction,
                       sa.activity_id
                 FROM sections s
                 JOIN section_activities sa ON s.id = sa.section_id
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE sa.excluded = 0 AND sa.lap_time IS NOT NULL
                   AND s.disabled = 0 AND s.superseded_by IS NULL";

/// One section traversal, as the ranking query answers it. Rank is within one
/// sport: a run's lap and a ride's over the same ground are not comparable
/// efforts, so the rows are grouped by sport before any of them are scored.
struct TraversalRow {
    section_id: String,
    section_name: String,
    lap_time: f64,
    activity_date: i64,
    /// `same` or `reverse`, as the junction row stores it. A climb and a
    /// descent of one section are not comparable efforts.
    direction: String,
    /// The activity the traversal belongs to. The stored path matches it to a
    /// best time afterwards, so only the in-memory reference reads it.
    #[cfg_attr(not(test), allow(dead_code))]
    activity_id: String,
}

/// The chart's headline best time: the shortest time in the section's own
/// direction.
///
/// A record is a beat over the same section and direction pair, which is what
/// `persistence/records.rs` writes, so a quicker traversal the other way is a
/// different effort and cannot be the best. A section only ever ridden in
/// reverse still has a best: with no forward traversal to pick from, the rule
/// applies to the direction that exists rather than answering nothing.
fn best_time_secs(points: &[crate::FfiSectionChartPoint]) -> Option<f64> {
    let quickest = |forward_only: bool| {
        points
            .iter()
            .filter(|p| p.section_time > 0 && (!forward_only || p.direction != "reverse"))
            .map(|p| p.section_time)
            .min()
    };
    quickest(true).or_else(|| quickest(false)).map(|t| t as f64)
}

/// Marks the one point per direction that beats every other traversal of that
/// direction by time. A tie or a lone traversal marks nothing.
fn stamp_records(points: &mut [crate::FfiSectionChartPoint]) {
    for direction in ["same", "reverse"] {
        let mut order: Vec<usize> = (0..points.len())
            .filter(|&i| points[i].direction == direction && points[i].section_time > 0)
            .collect();
        order.sort_by_key(|&i| points[i].section_time);
        let (Some(&best), Some(&rival)) = (order.first(), order.get(1)) else {
            continue;
        };
        if crate::persistence::records::is_personal_record(
            points[best].section_time as f64,
            Some(points[rival].section_time as f64),
        ) {
            points[best].is_best = true;
        }
    }
}

impl PersistentEngine {
    /// Get sections ranked by weighted composite relevance score.
    ///
    /// For each section matching the sport type, computes a weighted score from:
    /// - Recency (0.35): exp(-days_since_last / 180.0), half-life ~125 days
    /// - Improvement signal (0.30): median of last 3 vs previous 3 efforts
    /// - Anomaly detection (0.20): z-score of most recent effort
    /// - Engagement (0.15): ln(traversal_count) / ln(max_traversal_count)
    ///
    /// Returns top `limit` sections sorted by relevance_score descending.
    pub fn get_ranked_sections(
        &self,
        sport_type: &str,
        limit: u32,
    ) -> Vec<crate::FfiRankedSection> {
        self.ranked_sections(sport_type, limit, None)
    }

    /// Ranked sections whose most recent traversal is at least
    /// `stale_threshold_days` old.
    ///
    /// The stale-PR insight wanted these and had nothing to ask for them with, so
    /// it took the whole ranked list for every sport with no limit and discarded
    /// all but the stale ones. The cut belongs in the query: it is one traversal
    /// join per sport per insights pass, and it grows with years of use rather
    /// than with the window asked for.
    ///
    /// The bound is on each section's latest traversal, not on the rows, because
    /// `best_time_secs` and the improvement signal are computed over every
    /// traversal a section has. Filtering rows by date would change the times.
    pub fn get_stale_ranked_sections(
        &self,
        sport_type: &str,
        stale_threshold_days: u32,
    ) -> Vec<crate::FfiRankedSection> {
        let cutoff = Utc::now().timestamp() - i64::from(stale_threshold_days) * 86_400;
        self.ranked_sections(sport_type, u32::MAX, Some(cutoff))
    }

    /// Every sport's ranked sections, from one pass over the traversal join.
    ///
    /// The ranking is per sport and stays per sport: a run's lap and a ride's
    /// over the same ground are not comparable efforts. What was per sport and
    /// need not be is the read. Asking sport by sport walked
    /// `sections`-`section_activities`-`activity_metrics` once per sport for
    /// the same rows, so the cost grew with the number of sports an athlete
    /// has rather than with the number of sections.
    ///
    /// A sport with no traversals is still answered, with an empty list, so the
    /// caller's chips do not come and go with the data.
    pub fn get_ranked_sections_by_sports(
        &self,
        sport_types: &[String],
        limit: u32,
    ) -> Vec<crate::FfiRankedSectionsBySport> {
        self.ensure_named_overlay();
        let names = self.named_overlay_cached_names();
        pooled::ranked_sections_by_sports(&self.db, sport_types, limit, &names)
    }

    fn ranked_sections(
        &self,
        sport_type: &str,
        limit: u32,
        last_traversal_at_or_before: Option<i64>,
    ) -> Vec<crate::FfiRankedSection> {
        self.ensure_named_overlay();
        let names = self.named_overlay_cached_names();
        pooled::ranked_sections(
            &self.db,
            sport_type,
            limit,
            last_traversal_at_or_before,
            &names,
        )
    }

    /// Workout-section list for the home screen. Composes `get_ranked_sections`
    /// (or a visit-count fallback) with per-section performance lookups so TS
    /// receives enriched rows in a single FFI round-trip instead of N+1 calls.
    ///
    /// Both paths answer alike: the trend is `median_window_trend` at
    /// `TREND_DEADBAND` (the median of the last three efforts against the three
    /// before, so six are needed), the last time is the newest effort, days
    /// since is zero for today, and a missing name is the localised section
    /// word.
    pub fn get_workout_sections_for_sport(
        &mut self,
        sport_type: &str,
        limit: u32,
    ) -> Vec<crate::FfiWorkoutSection> {
        self.ensure_named_overlay();
        let names = self.named_overlay_cached_names();
        let candidates = pooled::workout_candidates(&self.db, sport_type, limit, &names);
        pooled::workout_sections(candidates, |id| {
            self.get_section_performances_filtered(id, Some(sport_type))
        })
    }
}

/// The record the Today banner calls a PR, with the time it beat.
///
/// Of the two directions' records, the ones that strictly beat another outing
/// in their own direction, the most recently set. A descent is never measured
/// against climbs, and a section with no strict record has no PR to show.
fn banner_record(
    perf: &crate::SectionPerformanceResult,
) -> Option<(&crate::SectionPerformanceRecord, Option<f64>)> {
    [
        perf.best_forward_record.as_ref(),
        perf.best_reverse_record.as_ref(),
    ]
    .into_iter()
    .flatten()
    .filter(|r| crate::persistence::records::is_section_record_pr(perf, r))
    .max_by_key(|r| r.activity_date)
    .map(|r| {
        (
            r,
            crate::persistence::records::section_record_rival(perf, r),
        )
    })
}

fn enrich_from_ranked(
    rs: crate::FfiRankedSection,
    perf: crate::SectionPerformanceResult,
) -> crate::FfiWorkoutSection {
    if perf.records.is_empty() {
        return crate::FfiWorkoutSection {
            id: rs.section_id,
            name: section_name_or_word(rs.section_name),
            pr_time_secs: positive(rs.best_time_secs),
            previous_best_time_secs: None,
            last_time_secs: positive(rs.median_recent_secs),
            days_since_last: Some(rs.days_since_last as i32),
            pr_days_ago: None,
            trend: Some(rs.trend),
        };
    }

    let banner = banner_record(&perf);
    let pr_time_secs = banner.map(|(r, _)| r.best_time);
    let pr_days_ago = banner.map(|(r, _)| days_since_epoch(r.activity_date));
    let previous_best_time_secs = banner.and_then(|(_, rival)| rival);

    let mut sorted: Vec<_> = perf.records.clone();
    sorted.sort_by_key(|b| std::cmp::Reverse(b.activity_date));
    let last_time_secs = sorted.first().map(|r| r.best_time);
    let days_since_last = sorted.first().map(|r| days_since_epoch(r.activity_date));

    crate::FfiWorkoutSection {
        id: rs.section_id,
        name: section_name_or_word(rs.section_name),
        pr_time_secs,
        previous_best_time_secs,
        last_time_secs,
        days_since_last,
        pr_days_ago,
        trend: Some(rs.trend),
    }
}

fn enrich_from_summary(
    summary: crate::SectionSummary,
    perf: crate::SectionPerformanceResult,
) -> crate::FfiWorkoutSection {
    let banner = banner_record(&perf);
    let pr_time_secs = banner.map(|(r, _)| r.best_time);
    let pr_days_ago = banner.map(|(r, _)| days_since_epoch(r.activity_date));
    let previous_best_time_secs = banner.and_then(|(_, rival)| rival);

    let mut sorted = perf.records.clone();
    sorted.sort_by_key(|b| std::cmp::Reverse(b.activity_date));
    let last_time_secs = sorted.first().map(|r| r.best_time);
    let days_since_last = sorted.first().map(|r| days_since_epoch(r.activity_date));

    let times: Vec<f64> = sorted.iter().rev().map(|r| r.best_time).collect();
    let trend = Some(crate::trend::median_window_trend(&times, TREND_DEADBAND));

    let name = summary
        .name
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_default();
    let name = section_name_or_word(name);

    crate::FfiWorkoutSection {
        id: summary.id,
        name,
        pr_time_secs,
        previous_best_time_secs,
        last_time_secs,
        days_since_last,
        pr_days_ago,
        trend,
    }
}

fn section_name_or_word(name: String) -> String {
    if name.is_empty() {
        super::super::get_section_word()
    } else {
        name
    }
}

fn positive(v: f64) -> Option<f64> {
    (v > 0.0).then_some(v)
}

/// What the improvement term compared, kept beside the clamped score so an
/// explanation can state the real change.
pub(crate) struct ImprovementSignal {
    /// The 0..1 ranking term, 0.5 when nothing was compared.
    pub score: f64,
    /// Signed fraction of the earlier time the athlete got faster by, before
    /// clamping: +0.14 is 14% faster, -1.5 is 150% slower. Absent when fewer
    /// than three efforts exist or the earlier time is not positive.
    pub change: Option<f64>,
    pub basis: Option<crate::FfiImprovementBasis>,
}

/// Lap times in date order. Six or more compare the median of the latest three
/// with the median of the three before, three to five compare last with first.
pub(crate) fn improvement_signal(times: &[f64]) -> ImprovementSignal {
    let n = times.len();
    let (earlier, later, basis) = if n >= 6 {
        let median = |window: &[f64]| {
            let mut sorted = window.to_vec();
            sorted.sort_by(|a, b| a.total_cmp(b));
            sorted[1]
        };
        (
            median(&times[n - 6..n - 3]),
            median(&times[n - 3..]),
            crate::FfiImprovementBasis::MedianOfThree,
        )
    } else if n >= 3 {
        (
            times[0],
            times[n - 1],
            crate::FfiImprovementBasis::FirstToLast,
        )
    } else {
        return ImprovementSignal {
            score: 0.5,
            change: None,
            basis: None,
        };
    };
    if earlier > 0.0 {
        // A positive change is faster, which is improving for a time.
        let change = (earlier - later) / earlier;
        ImprovementSignal {
            score: (change.clamp(-1.0, 1.0) + 1.0) / 2.0,
            change: Some(change),
            basis: Some(basis),
        }
    } else {
        ImprovementSignal {
            score: 0.5,
            change: None,
            basis: None,
        }
    }
}

/// Freshness of a section's last traversal, the largest single term in the
/// relevance score.
///
/// 180 is the time constant, so the half-life is 180*ln2, about 125 days. A
/// fortnight-scale constant saturates within weeks, which flattens every
/// section that has gone unridden long enough to be worth resurfacing into the
/// same near-zero score and stops the term ranking anything.
pub(crate) fn recency_score(days_since_last: u32) -> f64 {
    (-f64::from(days_since_last) / 180.0).exp()
}

fn days_since_epoch(unix_seconds: i64) -> i32 {
    let now = Utc::now().timestamp();
    (((now - unix_seconds) / 86_400).max(0)) as i32
}

impl PersistentEngine {
    /// Section-detail chart payload. Iterates performance records + lap
    /// traversals already in Rust to emit one chart point per lap, plus
    /// best/avg/last summary stats and a speed-rank per point. Replaces the
    /// multiple `useMemo` passes in `useSectionChartData.ts`.
    ///
    /// `time_range_days` - 0 means "all time"; any positive value filters to
    /// activity dates within the last N days.
    /// `sport_filter` - optional sport type (e.g. "Ride") for cross-sport
    /// sections; `None` keeps everything.
    pub fn get_section_chart_data(
        &mut self,
        section_id: &str,
        time_range_days: u32,
        sport_filter: Option<&str>,
    ) -> crate::FfiSectionChartData {
        let perf = self.get_section_performances_filtered(section_id, sport_filter);
        chart_from(&perf, time_range_days)
    }
}

/// The chart the section detail screen draws, from an already-read set of
/// performances.
///
/// Pure arithmetic over `perf`, so the pooled reader and the lock holder
/// share it rather than each having a scatter of its own.
pub(crate) fn chart_from(
    perf: &crate::SectionPerformanceResult,
    time_range_days: u32,
) -> crate::FfiSectionChartData {
    chart_from_cutoff(perf, range_cutoff(time_range_days))
}

/// The earliest activity date a range admits: 0 days is all time, any other
/// value the last that many days. One cutoff serves every ranged figure on
/// the section screen, so none of them can disagree about a lap on its edge.
pub(crate) fn range_cutoff(time_range_days: u32) -> i64 {
    if time_range_days == 0 {
        i64::MIN
    } else {
        chrono::Utc::now().timestamp() - (time_range_days as i64 * 86_400)
    }
}

/// [`chart_from`] over a cutoff already taken.
pub(crate) fn chart_from_cutoff(
    perf: &crate::SectionPerformanceResult,
    cutoff_ts: i64,
) -> crate::FfiSectionChartData {
    // One FfiSectionChartPoint per lap traversal.
    let mut points: Vec<crate::FfiSectionChartPoint> = Vec::new();
    for record in &perf.records {
        if record.laps.is_empty() {
            let direction = if record.direction == "reverse" {
                "reverse"
            } else {
                "same"
            };
            if !record.best_pace.is_finite() || record.best_pace <= 0.0 {
                continue;
            }
            points.push(crate::FfiSectionChartPoint {
                lap_id: record.activity_id.clone(),
                activity_id: record.activity_id.clone(),
                activity_name: record.activity_name.clone(),
                activity_date: record.activity_date as f64,
                speed: record.best_pace,
                section_time: record.best_time.round().max(0.0) as u32,
                section_distance: record.section_distance,
                direction: direction.to_string(),
                is_best: false,
                avg_power: None,
            });
        } else {
            for lap in &record.laps {
                // A `partial` overlap is a fragment of the ground, never a
                // traversal the stats, the calendar or the record count.
                if lap.direction == "partial" {
                    continue;
                }
                let direction = if lap.direction == "reverse" {
                    "reverse"
                } else {
                    "same"
                };
                if !lap.pace.is_finite() || lap.pace <= 0.0 {
                    continue;
                }
                // The scatter marks the ring the athlete
                // reads as the fastest run. A fragment cannot hold it
                // any more than it can hold the record.
                if !crate::persistence::records::covers_enough_for_record(
                    lap.coverage,
                    lap.distance,
                    record.section_distance,
                ) {
                    continue;
                }
                points.push(crate::FfiSectionChartPoint {
                    lap_id: lap.id.clone(),
                    activity_id: record.activity_id.clone(),
                    activity_name: record.activity_name.clone(),
                    activity_date: record.activity_date as f64,
                    speed: lap.pace,
                    section_time: lap.time.round().max(0.0) as u32,
                    section_distance: if lap.distance > 0.0 {
                        lap.distance
                    } else {
                        record.section_distance
                    },
                    direction: direction.to_string(),
                    is_best: false,
                    avg_power: lap.avg_power,
                });
            }
        }
    }

    // The record is the section's, so it is judged over every included
    // traversal and only then cut to the range: a range holding no record lap
    // marks nothing.
    stamp_records(&mut points);
    points.retain(|p| p.activity_date >= cutoff_ts as f64);
    let has_reverse_runs = points.iter().any(|p| p.direction == "reverse");

    points.sort_by(|a, b| a.activity_date.total_cmp(&b.activity_date));

    let total_activities = {
        let mut ids: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for p in &points {
            ids.insert(&p.activity_id);
        }
        ids.len() as u32
    };

    let (min_speed, max_speed) = if points.is_empty() {
        (0.0, 1.0)
    } else {
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        for p in &points {
            if p.speed < min {
                min = p.speed;
            }
            if p.speed > max {
                max = p.speed;
            }
        }
        (min, max)
    };

    let last_activity_date = points
        .iter()
        .map(|p| p.activity_date)
        .max_by(f64::total_cmp);

    let best_time_secs = best_time_secs(&points);

    crate::FfiSectionChartData {
        points,
        min_speed,
        max_speed,
        has_reverse_runs,
        best_time_secs,
        last_activity_date,
        total_activities,
    }
}

/// The recency term has to separate sections across the range over which one can
/// go unridden. A fortnight-scale constant saturates within weeks, so every stale
/// section scores the same near-zero and the term stops ranking anything.
#[cfg(test)]
mod recency_decay_tests {
    use super::recency_score;

    #[test]
    fn separates_sections_across_a_year() {
        let year = recency_score(365);
        assert!(
            year > 0.05,
            "a year-old section scored {year}, too flat to rank"
        );
        for (near, far) in [(30, 90), (90, 180), (180, 365)] {
            let gap = recency_score(near) - recency_score(far);
            assert!(
                gap > 0.05,
                "{near}d and {far}d differ by only {gap}, indistinguishable"
            );
        }
    }

    #[test]
    fn decays_monotonically_from_one() {
        assert!((recency_score(0) - 1.0).abs() < f64::EPSILON);
        let mut previous = f64::INFINITY;
        for days in [0, 30, 90, 180, 365, 730] {
            let score = recency_score(days);
            assert!(score < previous, "not monotonic at {days}d");
            previous = score;
        }
    }
}

/// Every trend on the wire is the same three-way verdict `crate::trend`
/// produces: -1 declining, 0 stable, 1 improving, and absent when there is not
/// enough history to say. A label built here would be a fifth encoding of it.
#[cfg(test)]
mod workout_trend_encoding_tests {
    use super::{enrich_from_ranked, enrich_from_summary};

    fn ranked(trend: i8) -> crate::FfiRankedSection {
        crate::FfiRankedSection {
            section_id: "sec_1".to_string(),
            section_name: "Hill".to_string(),
            relevance_score: 1.0,
            recency_score: 1.0,
            improvement_score: 0.0,
            improvement_change: None,
            improvement_basis: None,
            anomaly_score: 0.0,
            engagement_score: 0.0,
            traversal_count: 9,
            best_time_secs: 300.0,
            median_recent_secs: 320.0,
            days_since_last: 3,
            trend,
            latest_is_pr: false,
            recent_efforts: Vec::new(),
            best_activity_id: None,
        }
    }

    fn empty_performances() -> crate::SectionPerformanceResult {
        crate::SectionPerformanceResult {
            records: Vec::new(),
            best_forward_record: None,
            best_reverse_record: None,
            forward_stats: None,
            reverse_stats: None,
        }
    }

    fn record(activity_date: i64, best_time: f64) -> crate::SectionPerformanceRecord {
        crate::SectionPerformanceRecord {
            activity_id: format!("act_{activity_date}"),
            activity_name: "Ride".to_string(),
            activity_date,
            laps: Vec::new(),
            lap_count: 1,
            best_time,
            best_pace: 1000.0 / best_time,
            best_forward_time: Some(best_time),
            best_reverse_time: None,
            avg_time: best_time,
            avg_pace: 1000.0 / best_time,
            direction: "same".to_string(),
            section_distance: 1000.0,
        }
    }

    /// Scenario: a record with two laps, one carrying a stored mean power and
    /// one without, beside a record with no laps at all.
    ///
    /// Expected behaviour: each lap's point carries that lap's mean watts, and
    /// the lap-less record's point carries none.
    #[test]
    fn a_point_carries_its_laps_stored_mean_power() {
        let lap = |id: &str, avg_power: Option<f64>| crate::SectionLap {
            id: id.to_string(),
            activity_id: "act_laps".to_string(),
            time: 200.0,
            pace: 5.0,
            distance: 1000.0,
            direction: "same".to_string(),
            start_index: 0,
            end_index: 10,
            avg_hr: None,
            avg_power,
            coverage: Some(1.0),
            excluded: false,
        };
        let mut perf = empty_performances();
        perf.records.push(crate::SectionPerformanceRecord {
            activity_id: "act_laps".to_string(),
            laps: vec![lap("powered", Some(245.0)), lap("unpowered", None)],
            lap_count: 2,
            ..record(1_700_000_000, 200.0)
        });
        perf.records.push(record(1_700_100_000, 210.0));

        let chart = super::chart_from(&perf, 0);

        let power: Vec<(&str, Option<f64>)> = chart
            .points
            .iter()
            .map(|p| (p.lap_id.as_str(), p.avg_power))
            .collect();
        assert_eq!(
            power,
            vec![
                ("powered", Some(245.0)),
                ("unpowered", None),
                ("act_1700100000", None)
            ]
        );
    }

    /// Scenario: a section's laps include a `partial` row long enough to pass
    /// the length rule while its coverage is unmeasured, and faster than the
    /// full laps.
    ///
    /// Expected behaviour: the chart plots the laps the stats and the record
    /// count, so the partial row is no dot, no rank 1 and no best, and the
    /// header's count, which is the chart's, matches the stats.
    #[test]
    fn a_partial_lap_is_not_plotted() {
        let lap = |id: &str, direction: &str, time: f64| crate::SectionLap {
            id: id.to_string(),
            activity_id: "act".to_string(),
            time,
            pace: 1000.0 / time,
            distance: 900.0,
            direction: direction.to_string(),
            start_index: 0,
            end_index: 10,
            avg_hr: None,
            avg_power: None,
            coverage: None,
            excluded: false,
        };
        let mut perf = empty_performances();
        perf.records.push(crate::SectionPerformanceRecord {
            laps: vec![lap("full", "same", 200.0), lap("part", "partial", 150.0)],
            lap_count: 2,
            ..record(1_700_000_000, 150.0)
        });

        let chart = super::chart_from(&perf, 0);

        let ids: Vec<&str> = chart.points.iter().map(|p| p.lap_id.as_str()).collect();
        assert_eq!(ids, vec!["full"]);
        assert_eq!(chart.best_time_secs, Some(200.0));
    }

    fn timed_record(
        activity_date: i64,
        time: f64,
        direction: &str,
    ) -> crate::SectionPerformanceRecord {
        let lap = crate::SectionLap {
            id: format!("lap_{activity_date}"),
            activity_id: format!("act_{activity_date}"),
            time,
            pace: 1000.0 / time,
            distance: 1000.0,
            direction: direction.to_string(),
            start_index: 0,
            end_index: 10,
            avg_hr: None,
            avg_power: None,
            coverage: Some(1.0),
            excluded: false,
        };
        crate::SectionPerformanceRecord {
            laps: vec![lap],
            direction: direction.to_string(),
            ..record(activity_date, time)
        }
    }

    /// Scenario: a section ridden both ways, the reverse run quicker.
    ///
    /// Expected behaviour: the chart's best time is the quickest run in the
    /// section's own direction, and a reverse-only section still has one.
    #[test]
    fn chart_best_time_is_the_quickest_in_the_sections_direction() {
        let both = out_and_back(&[
            (1_700_000_000, 300.0, "same"),
            (1_700_100_000, 250.0, "reverse"),
            (1_700_200_000, 280.0, "same"),
        ]);
        assert_eq!(super::chart_from(&both, 0).best_time_secs, Some(280.0));

        let reverse_only = out_and_back(&[(1_700_000_000, 250.0, "reverse")]);
        assert_eq!(
            super::chart_from(&reverse_only, 0).best_time_secs,
            Some(250.0)
        );
        assert_eq!(
            super::chart_from(&out_and_back(&[]), 0).best_time_secs,
            None
        );
    }

    fn out_and_back(efforts: &[(i64, f64, &str)]) -> crate::SectionPerformanceResult {
        let records = efforts
            .iter()
            .map(|(date, time, direction)| timed_record(*date, *time, direction))
            .collect();
        crate::persistence::fitness::performances::laps::summarise(1000.0, records)
    }

    /// Scenario: a section whose only reverse pass covers a sliver of it.
    ///
    /// Expected behaviour: the chart plots no reverse point, so it does not
    /// ask for the reverse legend either; a full reverse pass does.
    #[test]
    fn a_reverse_fragment_does_not_raise_the_reverse_flag() {
        let mut perf = out_and_back(&[
            (1_700_000_000, 300.0, "same"),
            (1_700_100_000, 250.0, "reverse"),
        ]);
        assert!(super::chart_from(&perf, 0).has_reverse_runs);

        perf.records[1].laps[0].coverage = Some(0.05);
        let chart = super::chart_from(&perf, 0);
        assert!(chart.points.iter().all(|p| p.direction != "reverse"));
        assert!(!chart.has_reverse_runs);
    }

    /// Scenario: forward climbs at 550, 570 and 585 s and one reverse descent
    /// at 340 s ridden last.
    ///
    /// Expected behaviour: the descent has beaten nothing in its own
    /// direction, so the banner's PR is the best climb against the next climb.
    #[test]
    fn the_banner_pr_is_a_strict_record_in_one_direction() {
        let perf = out_and_back(&[
            (1_700_000_000, 585.0, "same"),
            (1_700_100_000, 550.0, "same"),
            (1_700_200_000, 570.0, "same"),
            (1_700_300_000, 340.0, "reverse"),
        ]);

        let row = enrich_from_summary(summary(), perf);

        assert_eq!(row.pr_time_secs, Some(550.0));
        assert_eq!(row.previous_best_time_secs, Some(570.0));
    }

    #[test]
    fn a_lone_reverse_lap_gives_no_banner_pr() {
        let perf = out_and_back(&[(1_700_000_000, 340.0, "reverse")]);

        let row = enrich_from_summary(summary(), perf);

        assert_eq!(row.pr_time_secs, None);
        assert_eq!(row.previous_best_time_secs, None);
        assert_eq!(row.pr_days_ago, None);
    }

    #[test]
    fn the_most_recently_set_record_of_the_two_directions_is_the_banner_pr() {
        let perf = out_and_back(&[
            (1_700_000_000, 600.0, "same"),
            (1_700_100_000, 550.0, "same"),
            (1_700_200_000, 400.0, "reverse"),
            (1_700_300_000, 380.0, "reverse"),
        ]);

        let row = enrich_from_summary(summary(), perf);

        assert_eq!(row.pr_time_secs, Some(380.0));
        assert_eq!(row.previous_best_time_secs, Some(400.0));
    }

    fn summary() -> crate::SectionSummary {
        crate::SectionSummary {
            id: "sec_1".to_string(),
            section_type: "auto".to_string(),
            name: Some("Hill".to_string()),
            distance_meters: 1000.0,
            visit_count: 12,
            activity_count: 12,
            representative_activity_id: None,
            confidence: 0.8,
            scale: None,
            bounds: None,
            elevation_gain_m: None,
            avg_grade_percent: None,
            elevation_loss_m: None,
            max_grade_percent: None,
            klass: None,
            is_lift: false,
            rank_score: None,
            sport_rank_score: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            sport_types: vec!["Ride".to_string()],
            is_user_defined: false,
            disabled: false,
            superseded_by: None,
        }
    }

    /// Scenario: one section's traversal times served by the ranked path and
    /// by the visit-count fallback, with no stored name, ridden today.
    ///
    /// Expected behaviour: both paths give the same trend, last time, days
    /// since and name.
    #[test]
    fn both_paths_give_the_same_row_for_the_same_times() {
        let now = chrono::Utc::now().timestamp();
        let times = [400.0, 400.0, 400.0, 380.0, 380.0, 380.0];
        let records: Vec<_> = times
            .iter()
            .enumerate()
            .map(|(i, t)| record(now - (5 - i as i64) * 86_400, *t))
            .collect();
        let perf = || crate::SectionPerformanceResult {
            records: records.clone(),
            ..empty_performances()
        };
        let mut unnamed = summary();
        unnamed.name = None;
        let fallback = enrich_from_summary(unnamed, perf());

        let mut rs = ranked(crate::trend::median_window_trend(
            &times,
            super::TREND_DEADBAND,
        ));
        rs.section_name = String::new();
        rs.section_id = "sec_1".to_string();
        let ranked_row = enrich_from_ranked(rs, perf());

        assert_eq!(fallback.trend, ranked_row.trend);
        assert_eq!(fallback.trend, Some(1));
        assert_eq!(fallback.name, ranked_row.name);
        assert_ne!(fallback.name, "sec_1");
        assert_eq!(fallback.last_time_secs, Some(380.0));
        assert_eq!(fallback.last_time_secs, ranked_row.last_time_secs);
    }

    /// Scenario: nine efforts, the newest three 5 per cent faster than the
    /// three before, which the five-effort rule needed ten records to see.
    ///
    /// Expected behaviour: the fallback reads the same improving verdict.
    #[test]
    fn nine_efforts_have_a_trend_on_the_fallback() {
        let records: Vec<_> = (0..9)
            .map(|i| record(1_700_000 + i * 86_400, if i < 6 { 400.0 } else { 380.0 }))
            .collect();
        let perf = crate::SectionPerformanceResult {
            records,
            ..empty_performances()
        };
        assert_eq!(enrich_from_summary(summary(), perf).trend, Some(1));
    }

    /// Scenario: a ranked row with no records, ridden today.
    ///
    /// Expected behaviour: zero days since, as the fallback says.
    #[test]
    fn a_section_ridden_today_is_zero_days_since_on_the_ranked_path() {
        let mut rs = ranked(0);
        rs.days_since_last = 0;
        let row = enrich_from_ranked(rs, empty_performances());
        assert_eq!(row.days_since_last, Some(0));
    }

    #[test]
    fn a_ranked_verdict_reaches_the_wire_unchanged() {
        for verdict in [-1i8, 0, 1] {
            let row = enrich_from_ranked(ranked(verdict), empty_performances());
            assert_eq!(row.trend, Some(verdict));
        }
    }

    #[test]
    fn too_little_history_reads_stable_as_the_ranked_path_does() {
        let records: Vec<_> = (0..4)
            .map(|i| record(1_700_000 + i * 86_400, 300.0))
            .collect();
        let perf = crate::SectionPerformanceResult {
            records,
            ..empty_performances()
        };
        let row = enrich_from_summary(summary(), perf);
        assert_eq!(row.trend, Some(0));
    }

    #[test]
    fn ten_traversals_getting_faster_read_as_improving() {
        // The last three at 300s against the three before at 400s: a 25% move,
        // well outside the deadband.
        let mut records = Vec::new();
        for i in 0..7 {
            records.push(record(1_700_000 + i * 86_400, 400.0));
        }
        for i in 7..10 {
            records.push(record(1_700_000 + i * 86_400, 300.0));
        }
        let perf = crate::SectionPerformanceResult {
            records,
            ..empty_performances()
        };
        assert_eq!(enrich_from_summary(summary(), perf).trend, Some(1));
    }

    /// Scenario: the chart's gold ring, the tooltip trophy and the section record
    /// were three picks by three rules.
    ///
    /// Expected behaviour: the engine stamps `is_best` on the one point that
    /// beats every other traversal of its direction by time, judged over the
    /// whole included history. A tie or a lone lap carries no stamp.
    mod the_chart_stamps_the_record {
        use super::super::chart_from_cutoff;

        fn lap(id: &str, time: f64, distance: f64, direction: &str) -> crate::SectionLap {
            crate::SectionLap {
                id: id.to_string(),
                activity_id: format!("act-{id}"),
                time,
                pace: distance / time,
                distance,
                direction: direction.to_string(),
                start_index: 0,
                end_index: 10,
                avg_hr: None,
                avg_power: None,
                coverage: None,
                excluded: false,
            }
        }

        fn perf(laps: Vec<(i64, crate::SectionLap)>) -> crate::SectionPerformanceResult {
            let records = laps
                .into_iter()
                .map(|(date, lap)| crate::SectionPerformanceRecord {
                    activity_id: lap.activity_id.clone(),
                    activity_name: lap.id.clone(),
                    activity_date: date,
                    laps: vec![lap],
                    lap_count: 1,
                    best_time: 1.0,
                    best_pace: 1.0,
                    best_forward_time: None,
                    best_reverse_time: None,
                    avg_time: 1.0,
                    avg_pace: 1.0,
                    direction: "same".to_string(),
                    section_distance: 400.0,
                })
                .collect();
            crate::SectionPerformanceResult {
                records,
                best_forward_record: None,
                best_reverse_record: None,
                forward_stats: None,
                reverse_stats: None,
            }
        }

        fn stamped(chart: &crate::FfiSectionChartData) -> Vec<String> {
            chart
                .points
                .iter()
                .filter(|p| p.is_best)
                .map(|p| p.lap_id.clone())
                .collect()
        }

        #[test]
        fn marks_the_shortest_time_and_not_the_fastest_speed() {
            let chart = chart_from_cutoff(
                &perf(vec![
                    (1_000, lap("a", 60.0, 400.0, "same")),
                    (2_000, lap("b", 58.0, 380.0, "same")),
                ]),
                i64::MIN,
            );
            assert_eq!(stamped(&chart), vec!["b"]);
        }

        #[test]
        fn leaves_a_tie_unmarked() {
            let chart = chart_from_cutoff(
                &perf(vec![
                    (1_000, lap("a", 60.0, 400.0, "same")),
                    (2_000, lap("b", 60.0, 400.0, "same")),
                ]),
                i64::MIN,
            );
            assert!(stamped(&chart).is_empty());
        }

        #[test]
        fn leaves_a_lone_reverse_lap_unmarked_and_marks_one_per_direction() {
            let chart = chart_from_cutoff(
                &perf(vec![
                    (1_000, lap("f1", 60.0, 400.0, "same")),
                    (2_000, lap("f2", 55.0, 400.0, "same")),
                    (3_000, lap("r1", 50.0, 400.0, "reverse")),
                ]),
                i64::MIN,
            );
            assert_eq!(stamped(&chart), vec!["f2"]);

            let chart = chart_from_cutoff(
                &perf(vec![
                    (1_000, lap("f1", 60.0, 400.0, "same")),
                    (2_000, lap("f2", 55.0, 400.0, "same")),
                    (3_000, lap("r1", 50.0, 400.0, "reverse")),
                    (4_000, lap("r2", 45.0, 400.0, "reverse")),
                ]),
                i64::MIN,
            );
            assert_eq!(stamped(&chart), vec!["f2", "r2"]);
        }

        #[test]
        fn judges_the_record_over_the_whole_history_not_the_range() {
            let records = perf(vec![
                (1_000, lap("old-record", 40.0, 400.0, "same")),
                (9_000, lap("recent-a", 60.0, 400.0, "same")),
                (9_500, lap("recent-b", 55.0, 400.0, "same")),
            ]);

            let narrow = chart_from_cutoff(&records, 5_000);
            assert_eq!(narrow.points.len(), 2);
            assert!(stamped(&narrow).is_empty());

            let all = chart_from_cutoff(&records, i64::MIN);
            assert_eq!(stamped(&all), vec!["old-record"]);
        }
    }

    #[test]
    fn ten_traversals_getting_slower_read_as_declining() {
        let mut records = Vec::new();
        for i in 0..7 {
            records.push(record(1_700_000 + i * 86_400, 300.0));
        }
        for i in 7..10 {
            records.push(record(1_700_000 + i * 86_400, 400.0));
        }
        let perf = crate::SectionPerformanceResult {
            records,
            ..empty_performances()
        };
        assert_eq!(enrich_from_summary(summary(), perf).trend, Some(-1));
    }
}

/// The ranking reads over a pooled connection. The engine methods above
/// delegate here, so the write path and the read pool score identically.
pub(crate) mod pooled {
    use std::collections::{BTreeMap, HashMap};

    use rusqlite::Connection;

    use chrono::Utc;

    use super::complete_traversal_clause;

    use super::{
        TRAVERSALS_BY_SPORT, TREND_DEADBAND, TraversalRow, improvement_signal, recency_score,
    };

    /// The sections a workout list is built over, before any performance is
    /// read: the ranked list, or when nothing ranks, the outing-floored
    /// traversal sort over summaries.
    pub(crate) enum WorkoutCandidates {
        Ranked(Vec<crate::FfiRankedSection>),
        Summaries(Vec<crate::sections::SectionSummary>),
    }

    pub(crate) fn workout_candidates(
        conn: &Connection,
        sport_type: &str,
        limit: u32,
        names: &BTreeMap<String, String>,
    ) -> WorkoutCandidates {
        let ranked = ranked_sections(conn, sport_type, limit, None, names);
        if !ranked.is_empty() {
            return WorkoutCandidates::Ranked(ranked);
        }

        // Fallback: traversal sort over summaries, floored on outings.
        let mut summaries: Vec<_> =
            crate::persistence::sections::queries::pooled::section_summaries_filtered(
                conn, None, true, names,
            )
            .into_iter()
            .filter(|s| crate::persistence::PersistentEngine::summary_covers_sport(s, sport_type))
            .filter(|s| s.activity_count >= 5)
            .collect();
        summaries.sort_by_key(|b| std::cmp::Reverse(b.visit_count));
        summaries.truncate(limit as usize);
        WorkoutCandidates::Summaries(summaries)
    }

    /// The workout rows, each candidate enriched with its performances. The
    /// lock holder reads those through its own cache and a pooled reader
    /// through the reader's, and both give the same set.
    pub(crate) fn workout_sections(
        candidates: WorkoutCandidates,
        mut performances: impl FnMut(&str) -> crate::SectionPerformanceResult,
    ) -> Vec<crate::FfiWorkoutSection> {
        match candidates {
            WorkoutCandidates::Ranked(ranked) => ranked
                .into_iter()
                .map(|rs| {
                    let perf = performances(&rs.section_id);
                    super::enrich_from_ranked(rs, perf)
                })
                .collect(),
            WorkoutCandidates::Summaries(summaries) => summaries
                .into_iter()
                .filter_map(|summary| {
                    let perf = performances(&summary.id);
                    if perf.records.is_empty() {
                        return None;
                    }
                    Some(super::enrich_from_summary(summary, perf))
                })
                .collect(),
        }
    }

    /// What the relevance score needs from one section's history in one sport.
    ///
    /// Everything but the recency, the engagement and the card's strip of
    /// recent efforts: those depend on today's date, on the other sections or
    /// on the laps the card keeps, so they are worked out when the read
    /// composes a ranked section. Stored in `section_rank_inputs`.
    pub(super) struct RankInputs {
        section_id: String,
        section_name: String,
        traversal_count: u32,
        last_date: i64,
        improvement_score: f64,
        improvement_change: Option<f64>,
        improvement_basis: Option<crate::FfiImprovementBasis>,
        anomaly_score: f64,
        best_time_secs: f64,
        best_date: Option<f64>,
        median_recent_secs: f64,
        trend: i8,
        latest_is_pr: bool,
    }

    fn basis_to_i64(basis: crate::FfiImprovementBasis) -> i64 {
        match basis {
            crate::FfiImprovementBasis::MedianOfThree => 0,
            crate::FfiImprovementBasis::FirstToLast => 1,
        }
    }

    fn basis_from_i64(value: i64) -> crate::FfiImprovementBasis {
        if value == 1 {
            crate::FfiImprovementBasis::FirstToLast
        } else {
            crate::FfiImprovementBasis::MedianOfThree
        }
    }

    /// One section's inputs from its traversals in one sport, oldest first.
    ///
    /// Improvement, anomaly, best, median, trend and the PR badge describe the
    /// effort the athlete last made, so they read the laps in the latest lap's
    /// own direction. The count and the last date keep counting every lap.
    fn inputs_of(rows: &[&TraversalRow]) -> RankInputs {
        let latest_direction = rows.last().map(|r| r.direction.as_str());
        let (dir_times, dir_dates): (Vec<f64>, Vec<i64>) = rows
            .iter()
            .filter(|r| Some(r.direction.as_str()) == latest_direction)
            .map(|r| (r.lap_time, r.activity_date))
            .unzip();

        let improvement = improvement_signal(&dir_times);

        // Z-score of the most recent effort against the efforts in its direction
        let anomaly_score = if dir_times.len() >= 3 {
            let mean = dir_times.iter().sum::<f64>() / dir_times.len() as f64;
            let variance =
                dir_times.iter().map(|t| (t - mean).powi(2)).sum::<f64>() / dir_times.len() as f64;
            let std_dev = variance.sqrt();
            if std_dev > 0.0 {
                let latest = *dir_times.last().unwrap();
                // Normalise: z of 0 = 0, z of 3+ = 1.0
                (((latest - mean) / std_dev).abs() / 3.0).min(1.0)
            } else {
                0.0
            }
        } else {
            0.0
        };

        let best_time_secs = dir_times.iter().cloned().fold(f64::INFINITY, f64::min);
        // The date of that fastest lap, which is what the stale-PR card reads
        // the athlete's fitness at. Ties take the earliest, since that is when
        // the standard was first set.
        let best_date = dir_times
            .iter()
            .zip(dir_dates.iter())
            .filter(|(time, _)| time.is_finite())
            .min_by(|(a, _), (b, _)| a.total_cmp(b))
            .map(|(_, date)| *date as f64);

        let median_recent_secs = if dir_times.len() >= 3 {
            let n = dir_times.len();
            let mut recent: Vec<f64> = dir_times[n.saturating_sub(3)..].to_vec();
            recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            recent[recent.len() / 2]
        } else if !dir_times.is_empty() {
            let mut all = dir_times.clone();
            all.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            all[all.len() / 2]
        } else {
            0.0
        };

        // Judged against the best of the other traversals, so a lone traversal
        // and a tie both leave the badge off.
        let latest_is_pr = if let Some(&latest) = dir_times.last() {
            let (best, second) = crate::persistence::records::best_two(dir_times.iter().cloned());
            let rival = crate::persistence::records::rival_of(latest, best, second);
            crate::persistence::records::is_personal_record(latest, rival)
        } else {
            false
        };

        RankInputs {
            section_id: rows[0].section_id.clone(),
            section_name: rows[0].section_name.clone(),
            traversal_count: rows.len() as u32,
            last_date: rows.last().map(|r| r.activity_date).unwrap_or(0),
            improvement_score: improvement.score,
            improvement_change: improvement.change,
            improvement_basis: improvement.basis,
            anomaly_score,
            best_time_secs: if best_time_secs.is_finite() {
                best_time_secs
            } else {
                0.0
            },
            best_date,
            median_recent_secs,
            trend: crate::trend::median_window_trend(&dir_times, TREND_DEADBAND),
            latest_is_pr,
        }
    }

    /// The ranked section a section's inputs make, with the terms that depend
    /// on the other sections and on today.
    fn compose(
        inputs: &RankInputs,
        max_traversal_count: usize,
        now_secs: i64,
        recent_efforts: Vec<crate::FfiSeriesPoint>,
    ) -> crate::FfiRankedSection {
        let days_since_last = crate::calendar_days_between(inputs.last_date, now_secs);
        let recency_score = recency_score(days_since_last);

        // ln(traversal_count) / ln(max_traversal_count)
        let engagement_score = if inputs.traversal_count >= 2 && max_traversal_count >= 2 {
            (inputs.traversal_count as f64).ln() / (max_traversal_count as f64).ln()
        } else if inputs.traversal_count >= 1 {
            // Single traversal: small engagement score
            0.1
        } else {
            0.0
        };

        let relevance_score = 0.35 * recency_score
            + 0.30 * inputs.improvement_score
            + 0.20 * inputs.anomaly_score
            + 0.15 * engagement_score;

        crate::FfiRankedSection {
            section_id: inputs.section_id.clone(),
            section_name: inputs.section_name.clone(),
            relevance_score,
            recency_score,
            improvement_score: inputs.improvement_score,
            improvement_change: inputs.improvement_change,
            improvement_basis: inputs.improvement_basis,
            anomaly_score: inputs.anomaly_score,
            engagement_score,
            traversal_count: inputs.traversal_count,
            best_time_secs: inputs.best_time_secs,
            median_recent_secs: inputs.median_recent_secs,
            days_since_last,
            trend: inputs.trend,
            latest_is_pr: inputs.latest_is_pr,
            recent_efforts,
            best_activity_id: None,
        }
    }

    /// The traversals of every section the scope selects, grouped by the
    /// activity's sport, oldest first within a section. The scope is an `AND`
    /// clause over `s`, or empty for every section.
    fn try_traversals_by_sport(
        conn: &Connection,
        scope: &str,
    ) -> rusqlite::Result<HashMap<String, Vec<TraversalRow>>> {
        let sql = format!(
            "{}{}{} ORDER BY s.id, am.date ASC",
            TRAVERSALS_BY_SPORT,
            complete_traversal_clause("sa", "s"),
            scope
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(4)?,
                TraversalRow {
                    section_id: row.get(0)?,
                    section_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    lap_time: row.get(2)?,
                    activity_date: row.get(3)?,
                    direction: row.get(5)?,
                    activity_id: row.get(6)?,
                },
            ))
        })?;
        let mut by_sport: HashMap<String, Vec<TraversalRow>> = HashMap::new();
        for row in rows {
            let (sport, row) = row?;
            by_sport.entry(sport).or_default().push(row);
        }
        Ok(by_sport)
    }

    /// Every traversal of every visible section, grouped by sport. The scan
    /// the stored inputs replace, kept as the reference they are tested
    /// against.
    #[cfg(test)]
    pub(super) fn traversals_by_sport(conn: &Connection) -> HashMap<String, Vec<TraversalRow>> {
        try_traversals_by_sport(conn, "").unwrap_or_default()
    }

    /// Each section's inputs in each sport, from rows ordered by section.
    fn inputs_by_sport(by_sport: HashMap<String, Vec<TraversalRow>>) -> Vec<(String, RankInputs)> {
        let mut out = Vec::new();
        for (sport, rows) in by_sport {
            let mut start = 0;
            while start < rows.len() {
                let id = &rows[start].section_id;
                let end = rows[start..]
                    .iter()
                    .position(|r| &r.section_id != id)
                    .map_or(rows.len(), |n| start + n);
                let group: Vec<&TraversalRow> = rows[start..end].iter().collect();
                out.push((sport.clone(), inputs_of(&group)));
                start = end;
            }
        }
        out
    }

    /// The sections the triggers have marked since their rows were last
    /// written, directly or through an activity whose date or sport changed.
    const DIRTY_SECTIONS: &str = "SELECT section_id FROM section_rank_dirty
         UNION SELECT section_id FROM section_activities
               WHERE activity_id IN (SELECT activity_id FROM section_rank_dirty_activity)";

    const DIRTY_SCOPE: &str = " AND s.id IN (
         SELECT section_id FROM section_rank_dirty
         UNION SELECT section_id FROM section_activities
               WHERE activity_id IN (SELECT activity_id FROM section_rank_dirty_activity))";

    /// Whether any mark stands.
    fn anything_marked(conn: &Connection) -> rusqlite::Result<bool> {
        conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM section_rank_dirty)
                 OR EXISTS (SELECT 1 FROM section_rank_dirty_activity)",
            [],
            |r| r.get(0),
        )
    }

    /// Recompute the stored inputs of every section the triggers have marked,
    /// and clear the marks, in one savepoint. Called as a write commits, so a
    /// read finds nothing marked and never touches a traversal it does not
    /// keep.
    pub(crate) fn refresh_rank_inputs(conn: &Connection) -> rusqlite::Result<usize> {
        if !anything_marked(conn)? {
            return Ok(0);
        }
        conn.execute_batch("SAVEPOINT rank_inputs")?;
        let written = (|| -> rusqlite::Result<usize> {
            let fresh = inputs_by_sport(try_traversals_by_sport(conn, DIRTY_SCOPE)?);
            conn.execute(
                &format!("DELETE FROM section_rank_inputs WHERE section_id IN ({DIRTY_SECTIONS})"),
                [],
            )?;
            let mut insert = conn.prepare(
                "INSERT OR REPLACE INTO section_rank_inputs
                    (section_id, sport_type, traversal_count, last_date, improvement_score,
                     improvement_change, improvement_basis, anomaly_score, best_time_secs,
                     best_date, median_recent_secs, trend, latest_is_pr)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;
            for (sport, i) in &fresh {
                insert.execute(rusqlite::params![
                    i.section_id,
                    sport,
                    i.traversal_count,
                    i.last_date,
                    i.improvement_score,
                    i.improvement_change,
                    i.improvement_basis.map(basis_to_i64),
                    i.anomaly_score,
                    i.best_time_secs,
                    i.best_date,
                    i.median_recent_secs,
                    i.trend,
                    i.latest_is_pr,
                ])?;
            }
            conn.execute("DELETE FROM section_rank_dirty", [])?;
            conn.execute("DELETE FROM section_rank_dirty_activity", [])?;
            Ok(fresh.len())
        })();
        match written {
            Ok(n) => {
                conn.execute_batch("RELEASE SAVEPOINT rank_inputs")?;
                Ok(n)
            }
            Err(e) => {
                let _ = conn.execute_batch(
                    "ROLLBACK TO SAVEPOINT rank_inputs; RELEASE SAVEPOINT rank_inputs",
                );
                Err(e)
            }
        }
    }

    /// Every visible section's inputs by sport: the stored rows of the
    /// sections nothing has marked, and a fresh computation over the traversals
    /// of the ones something has.
    ///
    /// Both halves read one snapshot. A commit between them that marked a
    /// section the stored half kept would rank it twice, and one that cleared
    /// a mark the stored half skipped would drop it.
    fn read_inputs(conn: &Connection) -> HashMap<String, Vec<RankInputs>> {
        if let Err(e) = conn.execute_batch("SAVEPOINT rank_read") {
            log::error!("veloqrs: [RankedSections] Failed to open the read: {}", e);
            return read_inputs_unscoped(conn);
        }
        let by_sport = read_inputs_unscoped(conn);
        if let Err(e) = conn.execute_batch("RELEASE SAVEPOINT rank_read") {
            log::error!("veloqrs: [RankedSections] Failed to close the read: {}", e);
            let _ =
                conn.execute_batch("ROLLBACK TO SAVEPOINT rank_read; RELEASE SAVEPOINT rank_read");
        }
        by_sport
    }

    fn read_inputs_unscoped(conn: &Connection) -> HashMap<String, Vec<RankInputs>> {
        let mut by_sport: HashMap<String, Vec<RankInputs>> = HashMap::new();
        let stored = conn.prepare(&format!(
            "SELECT i.sport_type, i.section_id, s.name, i.traversal_count, i.last_date,
                    i.improvement_score, i.improvement_change, i.improvement_basis,
                    i.anomaly_score, i.best_time_secs, i.best_date, i.median_recent_secs,
                    i.trend, i.latest_is_pr
             FROM section_rank_inputs i
             JOIN sections s ON s.id = i.section_id
             WHERE s.disabled = 0 AND s.superseded_by IS NULL
               AND i.section_id NOT IN ({DIRTY_SECTIONS})"
        ));
        match stored {
            Ok(mut stmt) => {
                let rows = stmt.query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        RankInputs {
                            section_id: row.get(1)?,
                            section_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                            traversal_count: row.get(3)?,
                            last_date: row.get(4)?,
                            improvement_score: row.get(5)?,
                            improvement_change: row.get(6)?,
                            improvement_basis: row.get::<_, Option<i64>>(7)?.map(basis_from_i64),
                            anomaly_score: row.get(8)?,
                            best_time_secs: row.get(9)?,
                            best_date: row.get(10)?,
                            median_recent_secs: row.get(11)?,
                            trend: row.get(12)?,
                            latest_is_pr: row.get(13)?,
                        },
                    ))
                });
                match rows {
                    Ok(iter) => {
                        for (sport, inputs) in iter.filter_map(|r| r.ok()) {
                            by_sport.entry(sport).or_default().push(inputs);
                        }
                    }
                    Err(e) => log::error!("veloqrs: [RankedSections] Query failed: {}", e),
                }
            }
            Err(e) => log::error!("veloqrs: [RankedSections] Failed to prepare query: {}", e),
        }
        if !anything_marked(conn).unwrap_or(true) {
            return by_sport;
        }
        match try_traversals_by_sport(conn, DIRTY_SCOPE) {
            Ok(rows) => {
                for (sport, inputs) in inputs_by_sport(rows) {
                    by_sport.entry(sport).or_default().push(inputs);
                }
            }
            Err(e) => log::error!("veloqrs: [RankedSections] Query failed: {}", e),
        }
        by_sport
    }

    /// Traversals a ranked section carries for its card's graphic. Enough to
    /// read a direction off a strip, and far short of a library of laps.
    const SECTION_HISTORY_POINTS: u32 = 20;

    /// The tail of each kept section's laps in one sport, every direction,
    /// oldest first: the only part of the history a read takes, and only for
    /// the sections it returns.
    fn recent_efforts(
        conn: &Connection,
        sport: &str,
        section_ids: &[&str],
    ) -> HashMap<String, Vec<crate::FfiSeriesPoint>> {
        let mut out: HashMap<String, Vec<(f64, f64, String)>> = HashMap::new();
        for chunk in section_ids.chunks(400) {
            let marks = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT section_id, lap_time, date, activity_id FROM (
                     SELECT s.id AS section_id, sa.lap_time AS lap_time, am.date AS date,
                            sa.activity_id AS activity_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY s.id
                                ORDER BY am.date DESC, sa.activity_id DESC) AS rn
                     FROM sections s
                     JOIN section_activities sa ON s.id = sa.section_id
                     JOIN activity_metrics am ON sa.activity_id = am.activity_id
                     WHERE am.sport_type = ? AND sa.excluded = 0 AND sa.lap_time IS NOT NULL
                       AND s.id IN ({marks}){}
                 ) WHERE rn <= {SECTION_HISTORY_POINTS}
                 ORDER BY section_id, date ASC",
                complete_traversal_clause("sa", "s")
            );
            let mut params: Vec<&str> = vec![sport];
            params.extend(chunk.iter().copied());
            let mut stmt = match conn.prepare(&sql) {
                Ok(s) => s,
                Err(e) => {
                    log::error!("veloqrs: [RankedSections] Failed to prepare query: {}", e);
                    continue;
                }
            };
            let rows = stmt.query_map(rusqlite::params_from_iter(params), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            });
            match rows {
                Ok(iter) => {
                    for (id, time, date, activity) in iter.filter_map(|r| r.ok()) {
                        out.entry(id)
                            .or_default()
                            .push((time, date as f64, activity));
                    }
                }
                Err(e) => log::error!("veloqrs: [RankedSections] Query failed: {}", e),
            }
        }
        out.into_iter()
            .map(|(id, points)| {
                let tail = crate::persistence::screens::activity_series_tail(
                    points.iter(),
                    SECTION_HISTORY_POINTS,
                    |(time, date, activity)| (*time, *date, Some(activity.clone())),
                );
                (id, tail)
            })
            .collect()
    }

    /// The activity a ranked section's best time was set in: the traversal in
    /// this sport at the stored best time on the stored best date. The rank
    /// inputs keep the time and the date and not the activity, so the match is
    /// made here, for the sections a read keeps. `None` when no traversal
    /// matches, which a stale cache can cause, and never a guess.
    fn best_activity(
        conn: &Connection,
        sport: &str,
        ranked: &crate::FfiRankedSection,
        best_date: Option<f64>,
    ) -> Option<String> {
        let date = best_date?;
        conn.query_row(
            &format!(
                "SELECT sa.activity_id
                 FROM sections s
                 JOIN section_activities sa ON s.id = sa.section_id
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 WHERE s.id = ?1 AND am.sport_type = ?2 AND sa.excluded = 0
                   AND sa.lap_time = ?3 AND am.date = ?4{}
                 ORDER BY sa.activity_id
                 LIMIT 1",
                complete_traversal_clause("sa", "s")
            ),
            rusqlite::params![ranked.section_id, sport, ranked.best_time_secs, date as i64],
            |row| row.get(0),
        )
        .ok()
    }

    /// One sport's inputs scored, cut to `limit`, with the laps read for the
    /// sections that stay. With a cutoff, only the sections whose newest
    /// traversal is at least that old are scored, so the engagement term is
    /// normalised over them alone.
    fn rank_sport_with_dates(
        conn: &Connection,
        sport: &str,
        mut inputs: Vec<RankInputs>,
        limit: u32,
        last_traversal_at_or_before: Option<i64>,
        names: &BTreeMap<String, String>,
    ) -> Vec<(crate::FfiRankedSection, Option<f64>)> {
        if let Some(cutoff) = last_traversal_at_or_before {
            inputs.retain(|i| i.last_date <= cutoff);
        }
        if inputs.is_empty() {
            return Vec::new();
        }
        for i in &mut inputs {
            if let Some(name) = names.get(&i.section_id) {
                i.section_name = name.clone();
            }
        }
        inputs.sort_by(|a, b| a.section_id.cmp(&b.section_id));
        let now_secs = Utc::now().timestamp();
        // Ensure ln(max) > 0
        let max_traversal_count = inputs
            .iter()
            .map(|i| i.traversal_count as usize)
            .max()
            .unwrap_or(1)
            .max(2);

        let mut ranked: Vec<(crate::FfiRankedSection, &RankInputs)> = inputs
            .iter()
            .map(|i| (compose(i, max_traversal_count, now_secs, Vec::new()), i))
            .collect();
        ranked.sort_by(|a, b| {
            b.0.relevance_score
                .partial_cmp(&a.0.relevance_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        ranked.truncate(limit as usize);

        let kept: Vec<&str> = ranked.iter().map(|(r, _)| r.section_id.as_str()).collect();
        let mut efforts = recent_efforts(conn, sport, &kept);
        ranked
            .into_iter()
            .map(|(mut r, inputs)| {
                r.recent_efforts = efforts.remove(&r.section_id).unwrap_or_default();
                r.best_activity_id = best_activity(conn, sport, &r, inputs.best_date);
                (r, inputs.best_date)
            })
            .collect()
    }

    fn rank_sport(
        conn: &Connection,
        sport: &str,
        inputs: Vec<RankInputs>,
        limit: u32,
        last_traversal_at_or_before: Option<i64>,
        names: &BTreeMap<String, String>,
    ) -> Vec<crate::FfiRankedSection> {
        rank_sport_with_dates(
            conn,
            sport,
            inputs,
            limit,
            last_traversal_at_or_before,
            names,
        )
        .into_iter()
        .map(|(section, _)| section)
        .collect()
    }

    /// One sport's ranked sections, optionally only the stale ones.
    pub(crate) fn ranked_sections(
        conn: &Connection,
        sport_type: &str,
        limit: u32,
        last_traversal_at_or_before: Option<i64>,
        names: &BTreeMap<String, String>,
    ) -> Vec<crate::FfiRankedSection> {
        let start = std::time::Instant::now();
        let inputs = read_inputs(conn).remove(sport_type).unwrap_or_default();
        let ranked = rank_sport(
            conn,
            sport_type,
            inputs,
            limit,
            last_traversal_at_or_before,
            names,
        );
        log::info!(
            "veloqrs: [RankedSections] Ranked sport_type={} in {:?} (returning top {})",
            sport_type,
            start.elapsed(),
            ranked.len()
        );
        ranked
    }

    /// One sport's sections whose newest traversal is at least `days` old.
    pub(crate) fn stale_ranked_sections(
        conn: &Connection,
        sport_type: &str,
        stale_threshold_days: u32,
        names: &BTreeMap<String, String>,
    ) -> Vec<(crate::FfiRankedSection, Option<f64>)> {
        let cutoff = Utc::now().timestamp() - i64::from(stale_threshold_days) * 86_400;
        let inputs = read_inputs(conn).remove(sport_type).unwrap_or_default();
        rank_sport_with_dates(conn, sport_type, inputs, u32::MAX, Some(cutoff), names)
    }

    /// The ranked sections per sport, from one read of the stored inputs.
    pub(crate) fn ranked_sections_by_sports(
        conn: &Connection,
        sport_types: &[String],
        limit: u32,
        names: &BTreeMap<String, String>,
    ) -> Vec<crate::FfiRankedSectionsBySport> {
        let start = std::time::Instant::now();
        let mut by_sport = read_inputs(conn);

        let ranked: Vec<crate::FfiRankedSectionsBySport> = sport_types
            .iter()
            .map(|sport| crate::FfiRankedSectionsBySport {
                sections: rank_sport(
                    conn,
                    sport,
                    by_sport.remove(sport).unwrap_or_default(),
                    limit,
                    None,
                    names,
                ),
                sport_type: sport.clone(),
            })
            .collect();

        log::info!(
            "veloqrs: [RankedSections] Ranked {} sports from one read in {:?}",
            sport_types.len(),
            start.elapsed()
        );
        ranked
    }

    pub(crate) fn page_trends(
        conn: &Connection,
        section_ids: &[&str],
        selected_sport: Option<&str>,
    ) -> HashMap<String, i8> {
        if section_ids.is_empty() {
            return HashMap::new();
        }
        let ids: std::collections::HashSet<&str> = section_ids.iter().copied().collect();
        let now = chrono::Utc::now().timestamp();
        let mut chosen: HashMap<String, (u32, String, i8)> = HashMap::new();
        for chunk in section_ids.chunks(400) {
            let marks = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT section_id, sport_type, traversal_count, last_date, trend
                 FROM section_rank_inputs WHERE section_id IN ({marks})
                   AND section_id NOT IN ({DIRTY_SECTIONS})"
            );
            if let Ok(mut stmt) = conn.prepare(&sql) {
                if let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                }) {
                    for row in rows.flatten() {
                        keep_page_trend(&mut chosen, row, selected_sport, now);
                    }
                }
            }
        }
        if anything_marked(conn).unwrap_or(true) {
            if let Ok(rows) = try_traversals_by_sport(conn, DIRTY_SCOPE) {
                for (sport, input) in inputs_by_sport(rows) {
                    if ids.contains(input.section_id.as_str()) {
                        keep_page_trend(
                            &mut chosen,
                            (
                                input.section_id,
                                sport,
                                input.traversal_count,
                                input.last_date,
                                input.trend,
                            ),
                            selected_sport,
                            now,
                        );
                    }
                }
            }
        }
        chosen
            .into_iter()
            .map(|(id, (_, _, trend))| (id, trend))
            .collect()
    }

    fn keep_page_trend(
        chosen: &mut HashMap<String, (u32, String, i8)>,
        row: (String, String, u32, i64, i8),
        selected_sport: Option<&str>,
        now: i64,
    ) {
        let (id, sport, count, last_date, trend) = row;
        if selected_sport.is_some_and(|selected| selected != sport) {
            return;
        }
        let days = crate::calendar_days_between(last_date, now);
        let Some(trend) = super::eligible_trend(trend, days, super::SECTION_TREND_MAX_AGE_DAYS)
        else {
            return;
        };
        let entry = chosen.entry(id).or_insert((0, String::new(), trend));
        if count > entry.0 || (count == entry.0 && sport < entry.1) {
            *entry = (count, sport, trend);
        }
    }

    /// The scoring over traversals already in memory, with no stored inputs:
    /// the reference the stored path is tested against.
    #[cfg(test)]
    pub(super) fn score_traversals(
        rows: Vec<TraversalRow>,
        limit: u32,
        names: &BTreeMap<String, String>,
    ) -> Vec<crate::FfiRankedSection> {
        let mut rows = rows;
        for row in &mut rows {
            if let Some(name) = names.get(&row.section_id) {
                row.section_name = name.clone();
            }
        }
        let mut by_section: BTreeMap<String, Vec<&TraversalRow>> = BTreeMap::new();
        for row in &rows {
            by_section
                .entry(row.section_id.clone())
                .or_default()
                .push(row);
        }
        let inputs: Vec<RankInputs> = by_section.values().map(|g| inputs_of(g)).collect();
        let max_traversal_count = inputs
            .iter()
            .map(|i| i.traversal_count as usize)
            .max()
            .unwrap_or(1)
            .max(2);
        let now_secs = Utc::now().timestamp();
        let mut ranked: Vec<crate::FfiRankedSection> = inputs
            .iter()
            .map(|i| {
                let rows = &by_section[&i.section_id];
                let efforts = crate::persistence::screens::activity_series_tail(
                    rows.iter(),
                    SECTION_HISTORY_POINTS,
                    |r| {
                        (
                            r.lap_time,
                            r.activity_date as f64,
                            Some(r.activity_id.clone()),
                        )
                    },
                );
                let mut section = compose(i, max_traversal_count, now_secs, efforts);
                section.best_activity_id = i.best_date.and_then(|date| {
                    rows.iter()
                        .filter(|r| {
                            r.lap_time == i.best_time_secs && r.activity_date as f64 == date
                        })
                        .map(|r| r.activity_id.clone())
                        .min()
                });
                section
            })
            .collect();
        ranked.sort_by(|a, b| {
            b.relevance_score
                .partial_cmp(&a.relevance_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        ranked.truncate(limit as usize);
        ranked
    }
}

#[cfg(test)]
#[path = "tests/improvement_signal.rs"]
mod improvement_signal_tests;

#[cfg(test)]
#[path = "tests/rank_inputs.rs"]
mod rank_inputs_tests;

#[cfg(test)]
#[path = "tests/direction_pr.rs"]
mod direction_pr_tests;
