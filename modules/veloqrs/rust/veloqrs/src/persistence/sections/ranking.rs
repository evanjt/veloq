//! ML-driven section relevance ranking.

use chrono::Utc;
use std::collections::HashMap;

use super::super::PersistentRouteEngine;

impl PersistentRouteEngine {
    /// Get sections ranked by ML-driven composite relevance score.
    ///
    /// For each section matching the sport type, computes a weighted score from:
    /// - Recency (0.35): exp(-days_since_last / 14.0), 2-week half-life
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

        // Query all sections for this sport type with their traversal data
        // Join section_activities with activity_metrics to get dates and lap times
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
                 WHERE s.sport_type = ? AND sa.excluded = 0 AND sa.lap_time IS NOT NULL
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
                // exp(-days / 14): half-life of ~2 weeks
                let recency_score = (-1.0 * days_since_last as f64 / 14.0).exp();

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
                    let median_recent = recent[1];
                    let median_previous = previous[1];
                    let pct = if median_previous > 0.0 {
                        (median_previous - median_recent) / median_previous
                    } else {
                        0.0
                    };
                    if pct > 0.02 {
                        1
                    }
                    // >2% faster = improving
                    else if pct < -0.02 {
                        -1
                    }
                    // >2% slower = declining
                    else {
                        0
                    } // within 2% = stable
                } else if data.times.len() >= 2 {
                    let first = data.times[0];
                    let last = *data.times.last().unwrap();
                    let pct = if first > 0.0 {
                        (first - last) / first
                    } else {
                        0.0
                    };
                    if pct > 0.02 {
                        1
                    } else if pct < -0.02 {
                        -1
                    } else {
                        0
                    }
                } else {
                    0
                };

                let latest_is_pr = if let Some(&latest) = data.times.last() {
                    best_time_secs.is_finite() && (latest - best_time_secs).abs() < 0.01
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
                    let perf = self.get_section_performances(&rs.section_id);
                    enrich_from_ranked(rs, perf)
                })
                .collect();
        }

        // Fallback: visit-count sort over summaries (matches prior TS fallback).
        let mut summaries: Vec<_> = self
            .get_section_summaries_for_sport(sport_type)
            .into_iter()
            .filter(|s| s.visit_count >= 5)
            .collect();
        summaries.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));
        summaries.truncate(limit as usize);

        summaries
            .into_iter()
            .filter_map(|summary| {
                let perf = self.get_section_performances(&summary.id);
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
            trend: trend_label(rs.trend),
        };
    }

    let best = perf.best_record.as_ref().or(perf.best_forward_record.as_ref());
    let pr_time_secs = best.map(|r| r.best_time);
    let pr_days_ago = best.map(|r| days_since_epoch(r.activity_date));

    let previous_best_time_secs = best.and_then(|b| {
        perf.records
            .iter()
            .filter(|r| r.activity_id != b.activity_id)
            .map(|r| r.best_time)
            .fold(None::<f64>, |acc, t| Some(acc.map_or(t, |a| a.min(t))))
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
        trend: trend_label(rs.trend),
    }
}

fn enrich_from_summary(
    summary: crate::SectionSummary,
    perf: crate::SectionPerformanceResult,
) -> crate::FfiWorkoutSection {
    let best = perf.best_record.as_ref().or(perf.best_forward_record.as_ref());
    let pr_time_secs = best.map(|r| r.best_time);
    let pr_days_ago = best.map(|r| days_since_epoch(r.activity_date));

    let previous_best_time_secs = best.and_then(|b| {
        perf.records
            .iter()
            .filter(|r| r.activity_id != b.activity_id)
            .map(|r| r.best_time)
            .fold(None::<f64>, |acc, t| Some(acc.map_or(t, |a| a.min(t))))
    });

    let mut sorted = perf.records.clone();
    sorted.sort_by(|a, b| b.activity_date.cmp(&a.activity_date));
    let last_time_secs = sorted.first().map(|r| r.best_time);
    let days_since_last = sorted.first().map(|r| days_since_epoch(r.activity_date));

    let trend = if sorted.len() >= 5 {
        let recent: Vec<f64> = sorted.iter().take(5).map(|r| r.best_time).collect();
        let previous: Vec<f64> = sorted.iter().skip(5).take(5).map(|r| r.best_time).collect();
        if previous.len() >= 5 {
            let recent_median = median_of(&recent);
            let previous_median = median_of(&previous);
            if previous_median > 0.0 {
                let change = (previous_median - recent_median) / previous_median;
                if change >= 0.03 {
                    String::from("improving")
                } else if change <= -0.03 {
                    String::from("declining")
                } else {
                    String::from("stable")
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    } else {
        String::new()
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

fn trend_label(trend: i32) -> String {
    match trend {
        t if t > 0 => String::from("improving"),
        t if t < 0 => String::from("declining"),
        _ => String::from("stable"),
    }
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
    /// `time_range_days` — 0 means "all time"; any positive value filters to
    /// activity dates within the last N days.
    /// `sport_filter` — optional sport type (e.g. "Ride") for cross-sport
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
