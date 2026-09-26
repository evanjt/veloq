//! ML-driven section relevance ranking.

use chrono::Utc;
use std::collections::HashMap;

use super::super::PersistentEngine;

/// A ranked section's median has to move by this fraction before the chip
/// calls it improving or declining. Matches the feed card deadband.
const TREND_DEADBAND: f64 = 0.02;

/// The workout screen asks for a larger move before it labels a section,
/// because it compares five-effort medians rather than three.
const WORKOUT_TREND_DEADBAND: f64 = 0.03;

/// What a lap has to be before the ranking scores it: not a `partial` overlap,
/// and covering enough of the section to stand as a traversal of it.
///
/// The same two rules the indicators and the performances apply, and for the
/// same reason. The backfill writes a lap time to any row whose end index is
/// past its start, so a 200 m fragment of a 2 km section carries one, and
/// without these the fragment enters the medians, takes `best_time_secs` and
/// makes the trend read as a large gain, while the section screen and the feed
/// badge for the same section go on showing the full lap.
fn complete_traversal_clause(sa: &str, s: &str) -> String {
    format!(
        " AND {sa}.direction != 'partial' AND ({})",
        crate::persistence::records::complete_traversal_sql_for(sa, s)
    )
}

/// The same traversal join the per-sport read runs, with no sport filter and
/// the sport carried on each row, so one statement answers every sport.
const TRAVERSALS_BY_SPORT: &str = "SELECT s.id, s.name, sa.lap_time, am.date, a.sport_type
                 FROM sections s
                 JOIN section_activities sa ON s.id = sa.section_id
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 JOIN activities a ON sa.activity_id = a.id
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
}

impl PersistentEngine {
    /// Get sections ranked by ML-driven composite relevance score.
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

    /// Every traversal the ranking scores, grouped by the sport it was ridden
    /// as. One statement, whatever the athlete's sports.
    fn traversals_by_sport(&self) -> HashMap<String, Vec<TraversalRow>> {
        pooled::traversals_by_sport(&self.db)
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

    /// One sport's traversals, scored and cut to `limit`.
    ///
    /// Separate from the read because the insights bundle takes every sport's
    /// rows out of one query and scores each sport's share: the ranking is
    /// per sport, the scan does not have to be.
    fn score_traversals(
        &self,
        rows: Vec<TraversalRow>,
        limit: u32,
    ) -> Vec<crate::FfiRankedSection> {
        self.ensure_named_overlay();
        let names = self.named_overlay_cached_names();
        pooled::score_traversals(rows, limit, &names)
    }

    /// Workout-section list for the home screen. Composes `get_ranked_sections`
    /// (or a visit-count fallback) with per-section performance lookups so TS
    /// receives enriched rows in a single FFI round-trip instead of N+1 calls.
    ///
    /// Trend threshold (>=3% change, >=5 traversals) matches the JMIR mHealth
    /// 2022 "only surface genuinely meaningful insights" guideline used by the
    /// original TS hook.
    pub fn get_workout_sections_for_sport(
        &mut self,
        sport_type: &str,
        limit: u32,
    ) -> Vec<crate::FfiWorkoutSection> {
        let ranked = self.get_ranked_sections(sport_type, limit);

        if !ranked.is_empty() {
            return ranked
                .into_iter()
                .map(|rs| {
                    let perf =
                        self.get_section_performances_filtered(&rs.section_id, Some(sport_type));
                    enrich_from_ranked(rs, perf)
                })
                .collect();
        }

        // Fallback: traversal sort over summaries, floored on outings.
        let mut summaries: Vec<_> = self
            .get_section_summaries_for_sport(sport_type)
            .into_iter()
            .filter(|s| s.activity_count >= 5)
            .collect();
        summaries.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));
        summaries.truncate(limit as usize);

        summaries
            .into_iter()
            .filter_map(|summary| {
                let perf = self.get_section_performances_filtered(&summary.id, Some(sport_type));
                if perf.records.is_empty() {
                    return None;
                }
                Some(enrich_from_summary(summary, perf))
            })
            .collect()
    }
}

fn enrich_from_ranked(
    rs: crate::FfiRankedSection,
    perf: crate::SectionPerformanceResult,
) -> crate::FfiWorkoutSection {
    if perf.records.is_empty() {
        return crate::FfiWorkoutSection {
            id: rs.section_id,
            name: if rs.section_name.is_empty() {
                String::from("Section")
            } else {
                rs.section_name
            },
            pr_time_secs: positive(rs.best_time_secs),
            previous_best_time_secs: None,
            last_time_secs: positive(rs.median_recent_secs),
            days_since_last: (rs.days_since_last > 0).then_some(rs.days_since_last as i32),
            pr_days_ago: None,
            trend: Some(rs.trend),
        };
    }

    let best = perf
        .best_record
        .as_ref()
        .or(perf.best_forward_record.as_ref());
    let pr_time_secs = best.map(|r| r.best_time);
    let pr_days_ago = best.map(|r| days_since_epoch(r.activity_date));

    let previous_best_time_secs = best.and_then(|b| {
        perf.records
            .iter()
            .filter(|r| r.activity_id != b.activity_id)
            .max_by(|a, b_rec| {
                a.best_pace
                    .partial_cmp(&b_rec.best_pace)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|r| r.best_time)
    });

    let mut sorted: Vec<_> = perf.records.clone();
    sorted.sort_by(|a, b| b.activity_date.cmp(&a.activity_date));
    let last_time_secs = sorted.first().map(|r| r.best_time);
    let days_since_last = sorted.first().map(|r| days_since_epoch(r.activity_date));

    crate::FfiWorkoutSection {
        id: rs.section_id,
        name: if rs.section_name.is_empty() {
            String::from("Section")
        } else {
            rs.section_name
        },
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
    let best = perf
        .best_record
        .as_ref()
        .or(perf.best_forward_record.as_ref());
    let pr_time_secs = best.map(|r| r.best_time);
    let pr_days_ago = best.map(|r| days_since_epoch(r.activity_date));

    let previous_best_time_secs = best.and_then(|b| {
        perf.records
            .iter()
            .filter(|r| r.activity_id != b.activity_id)
            .max_by(|a, b_rec| {
                a.best_pace
                    .partial_cmp(&b_rec.best_pace)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|r| r.best_time)
    });

    let mut sorted = perf.records.clone();
    sorted.sort_by(|a, b| b.activity_date.cmp(&a.activity_date));
    let last_time_secs = sorted.first().map(|r| r.best_time);
    let days_since_last = sorted.first().map(|r| days_since_epoch(r.activity_date));

    let trend = if sorted.len() >= 5 {
        let recent: Vec<f64> = sorted.iter().take(5).map(|r| r.best_time).collect();
        let previous: Vec<f64> = sorted.iter().skip(5).take(5).map(|r| r.best_time).collect();
        if previous.len() >= 5 {
            crate::trend::classify_time(
                median_of(&previous),
                median_of(&recent),
                WORKOUT_TREND_DEADBAND,
            )
        } else {
            None
        }
    } else {
        None
    };

    let name = summary
        .name
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| summary.id.clone());

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

fn positive(v: f64) -> Option<f64> {
    (v > 0.0).then_some(v)
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

fn median_of(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let len = sorted.len();
    if len == 0 {
        0.0
    } else if len % 2 == 1 {
        sorted[len / 2]
    } else {
        (sorted[len / 2 - 1] + sorted[len / 2]) / 2.0
    }
}

/// The chart's personal best, as an index into `points` ranked by speed.
///
/// A personal record here is a beat over the same section and direction pair,
/// which is what `persistence/records.rs` writes, so a faster traversal the
/// other way is a different effort and cannot be the best. `by_speed` is the
/// point indices already sorted fastest first.
///
/// A section only ever ridden in reverse still has a best: with no forward
/// traversal to pick from, the rule applies to the direction that exists
/// rather than answering nothing.
fn best_point_index(points: &[crate::FfiSectionChartPoint], by_speed: &[usize]) -> u32 {
    by_speed
        .iter()
        .find(|&&i| points[i].direction != "reverse")
        .or_else(|| by_speed.first())
        .copied()
        .unwrap_or(0) as u32
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
    let cutoff_ts = if time_range_days == 0 {
        i64::MIN
    } else {
        chrono::Utc::now().timestamp() - (time_range_days as i64 * 86_400)
    };

    // One FfiSectionChartPoint per lap traversal.
    let mut points: Vec<crate::FfiSectionChartPoint> = Vec::new();
    let mut has_reverse_runs = false;
    for record in &perf.records {
        if record.activity_date < cutoff_ts {
            continue;
        }
        if record.laps.is_empty() {
            let direction = if record.direction == "reverse" {
                has_reverse_runs = true;
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
                rank: 0,
            });
        } else {
            for lap in &record.laps {
                let direction = if lap.direction == "reverse" {
                    has_reverse_runs = true;
                    "reverse"
                } else {
                    "same"
                };
                if !lap.pace.is_finite() || lap.pace <= 0.0 {
                    continue;
                }
                // The scatter ranks by speed, and its rank 1 is the ring the
                // athlete reads as the fastest run. A fragment cannot hold it
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
                    rank: 0,
                });
            }
        }
    }

    points.sort_by(|a, b| a.activity_date.total_cmp(&b.activity_date));

    // Rank by speed descending; keep best (lowest) rank per activity.
    let mut by_speed: Vec<usize> = (0..points.len()).collect();
    by_speed.sort_by(|&a, &b| {
        points[b]
            .speed
            .partial_cmp(&points[a].speed)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut first_rank: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for (rank_idx, orig_idx) in by_speed.iter().enumerate() {
        let rank = (rank_idx as u32) + 1;
        first_rank
            .entry(points[*orig_idx].activity_id.clone())
            .or_insert(rank);
    }
    for point in points.iter_mut() {
        if let Some(&rank) = first_rank.get(&point.activity_id) {
            point.rank = rank;
        }
    }

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

    // Fastest lap in the section's own direction (0 when empty).
    let best_index = best_point_index(&points, &by_speed);

    let (best_activity_id, best_time_secs, best_pace) = points
        .get(best_index as usize)
        .map(|p| {
            (
                Some(p.activity_id.clone()),
                Some(p.section_time as f64),
                Some(p.speed),
            )
        })
        .unwrap_or((None, None, None));

    let average_time_secs = {
        let times: Vec<f64> = points
            .iter()
            .filter(|p| p.section_time > 0)
            .map(|p| p.section_time as f64)
            .collect();
        if times.is_empty() {
            None
        } else {
            Some(times.iter().sum::<f64>() / times.len() as f64)
        }
    };

    let last_activity_date = points
        .iter()
        .map(|p| p.activity_date)
        .max_by(f64::total_cmp);

    crate::FfiSectionChartData {
        points,
        min_speed,
        max_speed,
        best_index,
        has_reverse_runs,
        best_activity_id,
        best_time_secs,
        best_pace,
        average_time_secs,
        last_activity_date,
        total_activities,
    }
}

/// A section's three-way trend, from its traversal times oldest to newest.
///
/// The median of the last three efforts against the median of the three
/// before. Under six traversals there are not two windows to compare and the
/// verdict is stable: it used to fall back to the first effort against the
/// last, which is one day against one day, so a headwind on the first ride
/// read as a season of progress while the card said "Recent median".
pub(crate) fn section_trend(times: &[f64], deadband: f64) -> i8 {
    if times.len() < 6 {
        return 0;
    }
    let n = times.len();
    let mut recent: Vec<f64> = times[n - 3..].to_vec();
    let mut previous: Vec<f64> = times[n - 6..n - 3].to_vec();
    recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    previous.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    crate::trend::classify_time(previous[1], recent[1], deadband).unwrap_or(0)
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

/// Scenario: a section the athlete has ridden a handful of times. The card
/// says "Recent median" under a verdict that, below six traversals, compared
/// one day against one day.
///
/// Expected behaviour: the verdict is the medians the card names, and nothing
/// at all until there are two windows of three to compare.
#[cfg(test)]
mod section_trend_tests {
    use super::section_trend;

    const TWO_PERCENT: f64 = 0.02;

    #[test]
    fn five_traversals_with_a_fast_last_one_are_no_trend() {
        // 380, 400, 405, 410, 372: first against last called this improving
        // while the middle three were the athlete's slowest.
        let times = [380.0, 400.0, 405.0, 410.0, 372.0];
        assert_eq!(section_trend(&times, TWO_PERCENT), 0);
    }

    #[test]
    fn three_traversals_are_no_trend() {
        // A headwind on the first ride is not a season of progress.
        assert_eq!(section_trend(&[400.0, 395.0, 380.0], TWO_PERCENT), 0);
    }

    #[test]
    fn six_traversals_compare_the_two_medians() {
        // Medians 400 then 380, five per cent faster.
        let times = [405.0, 400.0, 395.0, 385.0, 380.0, 375.0];
        assert_eq!(section_trend(&times, TWO_PERCENT), 1);
    }

    #[test]
    fn a_rising_median_is_a_decline() {
        let times = [375.0, 380.0, 385.0, 395.0, 400.0, 405.0];
        assert_eq!(section_trend(&times, TWO_PERCENT), -1);
    }

    #[test]
    fn a_move_inside_the_deadband_is_stable() {
        // Medians 400 then 398, half a per cent.
        let times = [401.0, 400.0, 399.0, 399.0, 398.0, 397.0];
        assert_eq!(section_trend(&times, TWO_PERCENT), 0);
    }

    #[test]
    fn the_windows_are_the_newest_six_and_the_order_inside_one_does_not_matter() {
        let times = [900.0, 900.0, 405.0, 400.0, 395.0, 385.0, 380.0, 375.0];
        let shuffled = [900.0, 900.0, 400.0, 405.0, 395.0, 375.0, 380.0, 385.0];
        assert_eq!(section_trend(&times, TWO_PERCENT), 1);
        assert_eq!(section_trend(&shuffled, TWO_PERCENT), 1);
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
            anomaly_score: 0.0,
            engagement_score: 0.0,
            traversal_count: 9,
            best_time_secs: 300.0,
            best_date: None,
            median_recent_secs: 320.0,
            days_since_last: 3,
            trend,
            latest_is_pr: false,
            recent_efforts: Vec::new(),
        }
    }

    fn empty_performances() -> crate::SectionPerformanceResult {
        crate::SectionPerformanceResult {
            records: Vec::new(),
            best_record: None,
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
            avg_time: best_time,
            avg_pace: 1000.0 / best_time,
            direction: "same".to_string(),
            section_distance: 1000.0,
        }
    }

    fn summary() -> crate::SectionSummary {
        crate::SectionSummary {
            id: "sec_1".to_string(),
            section_type: "auto".to_string(),
            name: Some("Hill".to_string()),
            sport_type: "Ride".to_string(),
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

    #[test]
    fn a_ranked_verdict_reaches_the_wire_unchanged() {
        for verdict in [-1i8, 0, 1] {
            let row = enrich_from_ranked(ranked(verdict), empty_performances());
            assert_eq!(row.trend, Some(verdict));
        }
    }

    #[test]
    fn too_little_history_has_no_trend_rather_than_a_stable_one() {
        let records: Vec<_> = (0..4)
            .map(|i| record(1_700_000 + i * 86_400, 300.0))
            .collect();
        let perf = crate::SectionPerformanceResult {
            records,
            ..empty_performances()
        };
        let row = enrich_from_summary(summary(), perf);
        assert_eq!(
            row.trend, None,
            "four traversals cannot support a verdict, and 'stable' is a claim"
        );
    }

    #[test]
    fn ten_traversals_getting_faster_read_as_improving() {
        // Oldest five near 400s, most recent five near 300s: a 25% move, well
        // outside the deadband.
        let mut records = Vec::new();
        for i in 0..5 {
            records.push(record(1_700_000 + i * 86_400, 400.0));
        }
        for i in 5..10 {
            records.push(record(1_700_000 + i * 86_400, 300.0));
        }
        let perf = crate::SectionPerformanceResult {
            records,
            ..empty_performances()
        };
        assert_eq!(enrich_from_summary(summary(), perf).trend, Some(1));
    }

    /// Scenario: the chart's best ring was the fastest lap of any direction,
    /// while the PR card and the notification both filter on the PR's own
    /// direction. The two could name different attempts on the same section.
    ///
    /// Expected behaviour: a personal record is a beat over the same section
    /// and direction pair, so the ring is the fastest forward traversal.
    mod the_charts_best_takes_the_direction {
        use super::super::best_point_index;

        fn point(activity: &str, speed: f64, direction: &str) -> crate::FfiSectionChartPoint {
            crate::FfiSectionChartPoint {
                lap_id: format!("{activity}-lap"),
                activity_id: activity.to_string(),
                activity_name: activity.to_string(),
                activity_date: 1_700_000.0,
                speed,
                section_time: (1000.0 / speed) as u32,
                section_distance: 1000.0,
                direction: direction.to_string(),
                rank: 0,
            }
        }

        fn by_speed(points: &[crate::FfiSectionChartPoint]) -> Vec<usize> {
            let mut order: Vec<usize> = (0..points.len()).collect();
            order.sort_by(|&a, &b| {
                points[b]
                    .speed
                    .partial_cmp(&points[a].speed)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            order
        }

        #[test]
        fn skips_a_faster_traversal_the_other_way() {
            let points = vec![
                point("slow-forward", 4.0, "same"),
                point("fast-reverse", 9.0, "reverse"),
                point("quick-forward", 6.0, "same"),
            ];

            let best = best_point_index(&points, &by_speed(&points));
            assert_eq!(points[best as usize].activity_id, "quick-forward");
        }

        #[test]
        fn takes_the_fastest_reverse_when_nothing_went_forward() {
            let points = vec![
                point("slow-reverse", 4.0, "reverse"),
                point("fast-reverse", 9.0, "reverse"),
            ];

            let best = best_point_index(&points, &by_speed(&points));
            assert_eq!(points[best as usize].activity_id, "fast-reverse");
        }

        #[test]
        fn is_the_outright_fastest_when_every_traversal_went_forward() {
            let points = vec![point("a", 4.0, "same"), point("b", 9.0, "same")];

            let best = best_point_index(&points, &by_speed(&points));
            assert_eq!(points[best as usize].activity_id, "b");
        }

        #[test]
        fn answers_zero_for_a_section_with_no_traversals_at_all() {
            assert_eq!(best_point_index(&[], &[]), 0);
        }
    }

    #[test]
    fn ten_traversals_getting_slower_read_as_declining() {
        let mut records = Vec::new();
        for i in 0..5 {
            records.push(record(1_700_000 + i * 86_400, 300.0));
        }
        for i in 5..10 {
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

    use super::{TRAVERSALS_BY_SPORT, TREND_DEADBAND, TraversalRow, recency_score};

    /// One sport's ranked sections, optionally only the stale ones.
    ///
    /// The same traversal join either way. With a cutoff it is narrowed to the
    /// sections whose newest traversal is already that old, by a GROUP BY over
    /// the same joins, so the rows that survive are every traversal of a stale
    /// section rather than the stale traversals of every section.
    pub(crate) fn ranked_sections(
        conn: &Connection,
        sport_type: &str,
        limit: u32,
        last_traversal_at_or_before: Option<i64>,
        names: &BTreeMap<String, String>,
    ) -> Vec<crate::FfiRankedSection> {
        let start = std::time::Instant::now();

        const TRAVERSALS: &str = "SELECT s.id, s.name, sa.lap_time, am.date
                 FROM sections s
                 JOIN section_activities sa ON s.id = sa.section_id
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 JOIN activities a ON sa.activity_id = a.id
                 WHERE a.sport_type = ? AND sa.excluded = 0 AND sa.lap_time IS NOT NULL
                   AND s.disabled = 0 AND s.superseded_by IS NULL";
        // The subquery joins `sections` again under its own alias: "when was
        // this section last ridden whole" has to read the same rows the outer
        // scan scores, and a fragment arriving today would otherwise make a
        // section nobody has ridden for a year look current.
        let stale_clause = format!(
            " AND s.id IN (
                     SELECT sa2.section_id
                     FROM section_activities sa2
                     JOIN sections s2 ON s2.id = sa2.section_id
                     JOIN activity_metrics am2 ON sa2.activity_id = am2.activity_id
                     JOIN activities a2 ON sa2.activity_id = a2.id
                     WHERE a2.sport_type = ? AND sa2.excluded = 0
                       AND sa2.lap_time IS NOT NULL{}
                     GROUP BY sa2.section_id
                     HAVING MAX(am2.date) <= ?
                 )",
            complete_traversal_clause("sa2", "s2")
        );
        let complete = complete_traversal_clause("sa", "s");
        let sql = match last_traversal_at_or_before {
            Some(_) => format!("{TRAVERSALS}{complete}{stale_clause} ORDER BY s.id, am.date ASC"),
            None => format!("{TRAVERSALS}{complete} ORDER BY s.id, am.date ASC"),
        };

        let rows: Vec<TraversalRow> = {
            let mut stmt = match conn.prepare(&sql) {
                Ok(s) => s,
                Err(e) => {
                    log::error!("veloqrs: [RankedSections] Failed to prepare query: {}", e);
                    return Vec::new();
                }
            };

            let params: Vec<&dyn rusqlite::types::ToSql> = match &last_traversal_at_or_before {
                Some(cutoff) => vec![&sport_type, &sport_type, cutoff],
                None => vec![&sport_type],
            };

            match stmt.query_map(params.as_slice(), |row| {
                Ok(TraversalRow {
                    section_id: row.get(0)?,
                    section_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    lap_time: row.get(2)?,
                    activity_date: row.get(3)?,
                })
            }) {
                Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
                Err(e) => {
                    log::error!("veloqrs: [RankedSections] Query failed: {}", e);
                    return Vec::new();
                }
            }
        };

        let ranked = score_traversals(rows, limit, names);
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
    ) -> Vec<crate::FfiRankedSection> {
        let cutoff = Utc::now().timestamp() - i64::from(stale_threshold_days) * 86_400;
        ranked_sections(conn, sport_type, u32::MAX, Some(cutoff), names)
    }

    /// The ranked sections per sport, from one read of the junction table.
    pub(crate) fn ranked_sections_by_sports(
        conn: &Connection,
        sport_types: &[String],
        limit: u32,
        names: &BTreeMap<String, String>,
    ) -> Vec<crate::FfiRankedSectionsBySport> {
        let start = std::time::Instant::now();
        let mut by_sport = traversals_by_sport(conn);

        let ranked: Vec<crate::FfiRankedSectionsBySport> = sport_types
            .iter()
            .map(|sport| crate::FfiRankedSectionsBySport {
                sections: score_traversals(
                    by_sport.remove(sport).unwrap_or_default(),
                    limit,
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

    /// Every non-excluded traversal, grouped by the activity's sport.
    pub(crate) fn traversals_by_sport(conn: &Connection) -> HashMap<String, Vec<TraversalRow>> {
        let sql = format!(
            "{}{} ORDER BY s.id, am.date ASC",
            TRAVERSALS_BY_SPORT,
            complete_traversal_clause("sa", "s")
        );
        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                log::error!("veloqrs: [RankedSections] Failed to prepare query: {}", e);
                return HashMap::new();
            }
        };

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(4)?,
                TraversalRow {
                    section_id: row.get(0)?,
                    section_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    lap_time: row.get(2)?,
                    activity_date: row.get(3)?,
                },
            ))
        });

        let mut by_sport: HashMap<String, Vec<TraversalRow>> = HashMap::new();
        match rows {
            Ok(iter) => {
                for (sport, row) in iter.filter_map(|r| r.ok()) {
                    by_sport.entry(sport).or_default().push(row);
                }
            }
            Err(e) => log::error!("veloqrs: [RankedSections] Query failed: {}", e),
        }
        by_sport
    }

    /// The scoring itself, with the corridor names handed in: the engine reads
    /// them off its overlay and a pooled caller off the intent rows, and
    /// neither belongs in here.
    /// Traversals a ranked section carries for its card's graphic. Enough to
    /// read a direction off a strip, and far short of a library of laps.
    const SECTION_HISTORY_POINTS: u32 = 20;

    pub(crate) fn score_traversals(
        rows: Vec<TraversalRow>,
        limit: u32,
        names: &BTreeMap<String, String>,
    ) -> Vec<crate::FfiRankedSection> {
        // Corridor names outrank generated row names on the ranked cards.
        let mut rows = rows;
        {
            for row in &mut rows {
                if let Some(name) = names.get(&row.section_id) {
                    row.section_name = name.clone();
                }
            }
        }

        if rows.is_empty() {
            return Vec::new();
        }

        // Group traversals by section
        struct SectionData {
            name: String,
            times: Vec<f64>, // lap times in seconds, ordered by date ascending
            dates: Vec<i64>, // activity dates (unix timestamps), ascending
        }

        let mut sections: HashMap<String, SectionData> = HashMap::new();
        for row in &rows {
            let entry = sections
                .entry(row.section_id.clone())
                .or_insert_with(|| SectionData {
                    name: row.section_name.clone(),
                    times: Vec::new(),
                    dates: Vec::new(),
                });
            entry.times.push(row.lap_time);
            entry.dates.push(row.activity_date);
        }

        let now_secs = Utc::now().timestamp();

        // Find max traversal count for engagement normalisation
        let max_traversal_count = sections
            .values()
            .map(|s| s.times.len())
            .max()
            .unwrap_or(1)
            .max(2); // Ensure ln(max) > 0

        let mut ranked: Vec<crate::FfiRankedSection> = sections
            .iter()
            .map(|(section_id, data)| {
                let traversal_count = data.times.len() as u32;
                let last_date = *data.dates.last().unwrap_or(&now_secs);
                let days_since_last = crate::calendar_days_between(last_date, now_secs);

                // --- Recency score (weight 0.35) ---
                let recency_score = recency_score(days_since_last);

                // --- Improvement signal (weight 0.30) ---
                // Compare median of last 3 efforts to median of previous 3
                let improvement_score = if data.times.len() >= 6 {
                    let n = data.times.len();
                    let mut recent: Vec<f64> = data.times[n - 3..].to_vec();
                    let mut previous: Vec<f64> = data.times[n - 6..n - 3].to_vec();
                    recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    previous.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    let median_recent = recent[1];
                    let median_previous = previous[1];
                    if median_previous > 0.0 {
                        // Negative change = faster = improving (for time-based metrics)
                        // Normalise: cap at +/- 100% change, then map to 0..1
                        let pct_change = (median_previous - median_recent) / median_previous;
                        (pct_change.clamp(-1.0, 1.0) + 1.0) / 2.0
                    } else {
                        0.5 // neutral
                    }
                } else if data.times.len() >= 3 {
                    // Fewer than 6: compare last effort to first effort
                    let first = data.times[0];
                    let last = *data.times.last().unwrap();
                    if first > 0.0 {
                        let pct_change = (first - last) / first;
                        (pct_change.clamp(-1.0, 1.0) + 1.0) / 2.0
                    } else {
                        0.5
                    }
                } else {
                    0.5 // not enough data, neutral
                };

                // --- Anomaly detection (weight 0.20) ---
                // Z-score of most recent effort against all efforts
                let anomaly_score = if data.times.len() >= 3 {
                    let mean = data.times.iter().sum::<f64>() / data.times.len() as f64;
                    let variance = data.times.iter().map(|t| (t - mean).powi(2)).sum::<f64>()
                        / data.times.len() as f64;
                    let std_dev = variance.sqrt();
                    if std_dev > 0.0 {
                        let latest = *data.times.last().unwrap();
                        let z = ((latest - mean) / std_dev).abs();
                        // Normalise: z of 0 = 0, z of 3+ = 1.0
                        (z / 3.0).min(1.0)
                    } else {
                        0.0
                    }
                } else {
                    0.0 // not enough data for anomaly detection
                };

                // --- Engagement score (weight 0.15) ---
                // ln(traversal_count) / ln(max_traversal_count)
                let engagement_score = if traversal_count >= 2 && max_traversal_count >= 2 {
                    (traversal_count as f64).ln() / (max_traversal_count as f64).ln()
                } else if traversal_count >= 1 {
                    // Single traversal: small engagement score
                    0.1
                } else {
                    0.0
                };

                // --- Composite relevance score ---
                let relevance_score = 0.35 * recency_score
                    + 0.30 * improvement_score
                    + 0.20 * anomaly_score
                    + 0.15 * engagement_score;

                // --- Best time ---
                let best_time_secs = data.times.iter().cloned().fold(f64::INFINITY, f64::min);
                // The date of that fastest lap, which is what the stale-PR card
                // reads the athlete's fitness at. Ties take the earliest, since
                // that is when the standard was first set.
                let best_date = data
                    .times
                    .iter()
                    .zip(data.dates.iter())
                    .filter(|(time, _)| time.is_finite())
                    .min_by(|(a, _), (b, _)| a.total_cmp(b))
                    .map(|(_, date)| *date as f64);

                // --- Median of recent efforts ---
                let median_recent_secs = if data.times.len() >= 3 {
                    let n = data.times.len();
                    let mut recent: Vec<f64> = data.times[n.saturating_sub(3)..].to_vec();
                    recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    recent[recent.len() / 2]
                } else if !data.times.is_empty() {
                    let mut all = data.times.clone();
                    all.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    all[all.len() / 2]
                } else {
                    0.0
                };

                // --- Trend ---
                let trend = super::section_trend(&data.times, TREND_DEADBAND);

                // Judged against the best of the other traversals, so a lone
                // traversal and a tie both leave the badge off.
                let latest_is_pr = if let Some(&latest) = data.times.last() {
                    let (best, second) =
                        crate::persistence::records::best_two(data.times.iter().cloned());
                    let rival = crate::persistence::records::rival_of(latest, best, second);
                    crate::persistence::records::is_personal_record(latest, rival)
                } else {
                    false
                };

                crate::FfiRankedSection {
                    section_id: section_id.clone(),
                    section_name: data.name.clone(),
                    relevance_score,
                    recency_score,
                    improvement_score,
                    anomaly_score,
                    engagement_score,
                    traversal_count,
                    best_time_secs: if best_time_secs.is_finite() {
                        best_time_secs
                    } else {
                        0.0
                    },
                    best_date,
                    median_recent_secs,
                    days_since_last,
                    trend,
                    latest_is_pr,
                    // The scoring above already holds every traversal, to take
                    // the medians and the trend from. The card draws the tail
                    // of them, so carrying it costs the ranker one allocation
                    // rather than the list a read per card.
                    recent_efforts: crate::persistence::screens::series_tail(
                        data.times.iter().zip(data.dates.iter()),
                        SECTION_HISTORY_POINTS,
                        |(time, date)| (*time, *date as f64),
                    ),
                }
            })
            .collect();

        // Sort by relevance_score descending
        ranked.sort_by(|a, b| {
            b.relevance_score
                .partial_cmp(&a.relevance_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Limit results
        ranked.truncate(limit as usize);

        ranked
    }
}
