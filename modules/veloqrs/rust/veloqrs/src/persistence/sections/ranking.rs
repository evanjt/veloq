//! ML-driven section relevance ranking.

use chrono::Utc;
use std::collections::HashMap;

use super::super::PersistentRouteEngine;

/// A ranked section's median has to move by this fraction before the chip
/// calls it improving or declining. Matches the feed card deadband.
const TREND_DEADBAND: f64 = 0.02;

/// The workout screen asks for a larger move before it labels a section,
/// because it compares five-effort medians rather than three.
const WORKOUT_TREND_DEADBAND: f64 = 0.03;

impl PersistentRouteEngine {
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
        let start = std::time::Instant::now();

        // Rank within one sport: a run's lap and a ride's over the same ground
        // are not comparable efforts.
        struct TraversalRow {
            section_id: String,
            section_name: String,
            lap_time: f64,
            activity_date: i64,
        }

        let rows: Vec<TraversalRow> = {
            let mut stmt = match self.db.prepare(
                "SELECT s.id, s.name, sa.lap_time, am.date
                 FROM sections s
                 JOIN section_activities sa ON s.id = sa.section_id
                 JOIN activity_metrics am ON sa.activity_id = am.activity_id
                 JOIN activities a ON sa.activity_id = a.id
                 WHERE a.sport_type = ? AND sa.excluded = 0 AND sa.lap_time IS NOT NULL
                   AND s.disabled = 0 AND s.superseded_by IS NULL
                 ORDER BY s.id, am.date ASC",
            ) {
                Ok(s) => s,
                Err(e) => {
                    log::error!(
                        "tracematch: [RankedSections] Failed to prepare query: {}",
                        e
                    );
                    return Vec::new();
                }
            };

            match stmt.query_map(rusqlite::params![sport_type], |row| {
                Ok(TraversalRow {
                    section_id: row.get(0)?,
                    section_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    lap_time: row.get(2)?,
                    activity_date: row.get(3)?,
                })
            }) {
                Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
                Err(e) => {
                    log::error!("tracematch: [RankedSections] Query failed: {}", e);
                    return Vec::new();
                }
            }
        };

        // Corridor names outrank generated row names on the ranked cards.
        let mut rows = rows;
        self.ensure_named_overlay();
        {
            let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
            for row in &mut rows {
                if let Some(name) = overlay.by_section.get(&row.section_id) {
                    row.section_name = name.clone();
                }
            }
        }

        if rows.is_empty() {
            log::info!(
                "tracematch: [RankedSections] No traversals found for sport_type={}",
                sport_type
            );
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

        // Find max traversal count for engagement normalization
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
                        // Normalize: cap at +/- 100% change, then map to 0..1
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
                        // Normalize: z of 0 = 0, z of 3+ = 1.0
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
                let trend = if data.times.len() >= 6 {
                    let n = data.times.len();
                    let mut recent: Vec<f64> = data.times[n - 3..].to_vec();
                    let mut previous: Vec<f64> = data.times[n - 6..n - 3].to_vec();
                    recent.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    previous.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    crate::trend::classify_time(previous[1], recent[1], TREND_DEADBAND).unwrap_or(0)
                } else if data.times.len() >= 2 {
                    let first = data.times[0];
                    let last = *data.times.last().unwrap();
                    crate::trend::classify_time(first, last, TREND_DEADBAND).unwrap_or(0)
                } else {
                    0
                };

                let latest_is_pr = if let Some(&latest) = data.times.last() {
                    crate::persistence::records::is_personal_record(latest, best_time_secs)
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
                    median_recent_secs,
                    days_since_last,
                    trend,
                    latest_is_pr,
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

        log::info!(
            "tracematch: [RankedSections] Ranked {} sections for sport_type={} in {:?} (returning top {})",
            sections.len(),
            sport_type,
            start.elapsed(),
            ranked.len()
        );

        ranked
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

impl PersistentRouteEngine {
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
                    activity_date: record.activity_date,
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
                    points.push(crate::FfiSectionChartPoint {
                        lap_id: lap.id.clone(),
                        activity_id: record.activity_id.clone(),
                        activity_name: record.activity_name.clone(),
                        activity_date: record.activity_date,
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

        points.sort_by(|a, b| a.activity_date.cmp(&b.activity_date));

        // Rank by speed descending; keep best (lowest) rank per activity.
        let mut by_speed: Vec<usize> = (0..points.len()).collect();
        by_speed.sort_by(|&a, &b| {
            points[b]
                .speed
                .partial_cmp(&points[a].speed)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let mut first_rank: std::collections::HashMap<String, u32> =
            std::collections::HashMap::new();
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

        // Fastest lap index (0 when empty).
        let best_index = by_speed.first().copied().unwrap_or(0) as u32;

        let (best_activity_id, best_time_secs, best_pace) = by_speed
            .first()
            .map(|&i| {
                let p = &points[i];
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

        let last_activity_date = points.iter().map(|p| p.activity_date).max();

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
            anomaly_score: 0.0,
            engagement_score: 0.0,
            traversal_count: 9,
            best_time_secs: 300.0,
            median_recent_secs: 320.0,
            days_since_last: 3,
            trend,
            latest_is_pr: false,
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
            direction: "forward".to_string(),
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
            straightness: None,
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
