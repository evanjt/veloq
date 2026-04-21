use super::error::{VeloqError, with_engine};
use std::collections::HashSet;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct FitnessManager {
    pub(crate) _private: (),
}

/// Per-sport-category fitness improvement used by stale-PR detection.
struct FitnessGain {
    metric: &'static str, // "power" | "pace"
    current: f64,
    previous: f64,
    gain_percent: f64,
    unit: &'static str, // "W" | "/km" | "/100m"
}

fn cycling_gain(ftp: &crate::FfiFtpTrend, min_gain_percent: f64) -> Option<FitnessGain> {
    let cur = ftp.latest_ftp? as f64;
    let prev = ftp.previous_ftp? as f64;
    if !cur.is_finite() || !prev.is_finite() || cur <= prev || prev <= 0.0 {
        return None;
    }
    let gain = ((cur - prev) / prev) * 100.0;
    if gain < min_gain_percent {
        return None;
    }
    Some(FitnessGain {
        metric: "power",
        current: cur,
        previous: prev,
        gain_percent: (gain * 10.0).round() / 10.0,
        unit: "W",
    })
}

fn pace_gain(
    pace: &crate::FfiPaceTrend,
    min_gain_percent: f64,
    unit: &'static str,
) -> Option<FitnessGain> {
    let cur = pace.latest_pace?;
    let prev = pace.previous_pace?;
    if !cur.is_finite() || !prev.is_finite() || cur <= prev || prev <= 0.0 {
        return None;
    }
    let gain = ((cur - prev) / prev) * 100.0;
    if gain < min_gain_percent {
        return None;
    }
    Some(FitnessGain {
        metric: "pace",
        current: cur,
        previous: prev,
        gain_percent: (gain * 10.0).round() / 10.0,
        unit,
    })
}

fn gain_for_sport<'a>(
    sport: &str,
    cycling: Option<&'a FitnessGain>,
    running: Option<&'a FitnessGain>,
    swimming: Option<&'a FitnessGain>,
) -> Option<&'a FitnessGain> {
    match sport {
        "Ride" | "VirtualRide" | "MountainBikeRide" | "GravelRide" | "Handcycle" | "Velomobile" => {
            cycling
        }
        "Run" | "VirtualRun" | "TrailRun" => running,
        "Swim" | "OpenWaterSwim" => swimming,
        _ => None,
    }
}

#[uniffi::export]
impl FitnessManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Get all activity IDs that have metrics stored (GPS and non-GPS).
    fn get_activity_metric_ids(&self) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_activity_metric_ids())
    }

    fn get_period_stats(
        &self,
        start_ts: i64,
        end_ts: i64,
    ) -> Result<crate::FfiPeriodStats, VeloqError> {
        with_engine(|e| e.get_period_stats(start_ts, end_ts))
    }

    fn get_zone_distribution(
        &self,
        sport_type: String,
        zone_type: String,
    ) -> Result<Vec<f64>, VeloqError> {
        with_engine(|e| e.get_zone_distribution(&sport_type, &zone_type))
    }

    fn get_ftp_trend(&self) -> Result<crate::FfiFtpTrend, VeloqError> {
        with_engine(|e| e.get_ftp_trend())
    }

    fn save_pace_snapshot(
        &self,
        sport_type: String,
        critical_speed: f64,
        d_prime: Option<f64>,
        r2: Option<f64>,
        date: i64,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.save_pace_snapshot(&sport_type, critical_speed, d_prime, r2, date);
        })
    }

    fn get_pace_trend(&self, sport_type: String) -> Result<crate::FfiPaceTrend, VeloqError> {
        with_engine(|e| e.get_pace_trend(&sport_type))
    }

    fn get_available_sport_types(&self) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_available_sport_types())
    }

    fn get_activity_heatmap(
        &self,
        start_date: String,
        end_date: String,
    ) -> Result<Vec<crate::FfiHeatmapDay>, VeloqError> {
        with_engine(|e| e.get_activity_heatmap(&start_date, &end_date))
    }

    fn get_summary_card_data(
        &self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
    ) -> Result<crate::FfiSummaryCardData, VeloqError> {
        with_engine(|e| crate::FfiSummaryCardData {
            current_week: e.get_period_stats(current_start, current_end),
            prev_week: e.get_period_stats(prev_start, prev_end),
            ftp_trend: e.get_ftp_trend(),
            run_pace_trend: e.get_pace_trend("Run"),
            swim_pace_trend: e.get_pace_trend("Swim"),
        })
    }

    fn get_activity_patterns(&self) -> Result<Vec<crate::FfiActivityPattern>, VeloqError> {
        with_engine(|e| crate::patterns::compute_activity_patterns(&e.db, &e.activity_metrics))
    }

    fn get_pattern_for_today(&self) -> Result<Option<crate::FfiActivityPattern>, VeloqError> {
        with_engine(|e| crate::patterns::get_pattern_for_today(&e.db, &e.activity_metrics))
    }

    /// Combined patterns query: today's pattern + full pattern set in one lock.
    /// Collapses the two-call sequence in `useActivityPatterns`.
    fn get_activity_patterns_with_today(
        &self,
    ) -> Result<crate::FfiActivityPatternsBundle, VeloqError> {
        with_engine(|e| crate::FfiActivityPatternsBundle {
            today: crate::patterns::get_pattern_for_today(&e.db, &e.activity_metrics),
            all: crate::patterns::compute_activity_patterns(&e.db, &e.activity_metrics),
        })
    }

    /// Sync a batch of wellness rows from the intervals.icu API into SQLite.
    /// Idempotent on `date`; call whenever the TS wellness query refreshes.
    fn upsert_wellness(&self, rows: Vec<crate::FfiWellnessRow>) -> Result<(), VeloqError> {
        with_engine(|e| {
            let mapped: Vec<crate::persistence::wellness::WellnessRow> = rows
                .into_iter()
                .map(|r| crate::persistence::wellness::WellnessRow {
                    date: r.date,
                    ctl: r.ctl,
                    atl: r.atl,
                    ramp_rate: r.ramp_rate,
                    hrv: r.hrv,
                    resting_hr: r.resting_hr,
                    weight: r.weight,
                    sleep_secs: r.sleep_secs,
                    sleep_score: r.sleep_score,
                    soreness: r.soreness,
                    fatigue: r.fatigue,
                    stress: r.stress,
                    mood: r.mood,
                    motivation: r.motivation,
                })
                .collect();
            e.upsert_wellness(&mapped)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Sparkline arrays (fitness/fatigue/form/hrv/rhr) over the trailing
    /// `days` window. Returns `None` until wellness has been synced at
    /// least once. Replaces the 5 parallel useMemo passes in
    /// `useSummaryCardData.ts` — TS is now a thin pass-through.
    fn get_wellness_sparklines(
        &self,
        days: u32,
    ) -> Result<Option<crate::FfiWellnessSparklines>, VeloqError> {
        with_engine(|e| {
            e.get_wellness_sparklines(days)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// HRV trend (label + averages + sparkline) over the trailing `days`
    /// window. Returns `None` when there are <5 valid HRV days. TS maps
    /// the returned label to an i18n key and renders.
    fn compute_hrv_trend(
        &self,
        days: u32,
    ) -> Result<Option<crate::FfiHrvTrend>, VeloqError> {
        with_engine(|e| {
            e.compute_hrv_trend(days)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Stale-PR opportunity detection.
    ///
    /// Pure pattern recognition: flags sections whose PR might be beatable
    /// because the user's threshold fitness (FTP for cycling, critical speed
    /// for run/swim) has improved by at least `min_gain_percent` since the
    /// PR was set, and the section hasn't been visited in `stale_threshold_days+`
    /// days. Sport-aware: cycling sections look at FTP, running at run pace,
    /// swimming at swim pace.
    ///
    /// `exclude_section_ids` is the set of section IDs already surfaced by
    /// other insights (e.g. recent section_pr cards) — we don't want to
    /// double-surface the same section in the same insights feed.
    ///
    /// Returns up to `max_opportunities` opportunities, sorted by
    /// traversal_count DESC (more-frequented sections first).
    fn find_stale_pr_opportunities(
        &self,
        stale_threshold_days: u32,
        min_gain_percent: f64,
        max_opportunities: u32,
        exclude_section_ids: Vec<String>,
    ) -> Result<Vec<crate::FfiStalePrOpportunity>, VeloqError> {
        with_engine(|e| {
            let ftp_trend = e.get_ftp_trend();
            let run_pace_trend = e.get_pace_trend("Run");
            let swim_pace_trend = e.get_pace_trend("Swim");

            let cycling = cycling_gain(&ftp_trend, min_gain_percent);
            let running = pace_gain(&run_pace_trend, min_gain_percent, "/km");
            let swimming = pace_gain(&swim_pace_trend, min_gain_percent, "/100m");

            if cycling.is_none() && running.is_none() && swimming.is_none() {
                return Vec::new();
            }

            let exclude: HashSet<String> = exclude_section_ids.into_iter().collect();
            let sport_types = e.get_available_sport_types();
            let mut opportunities: Vec<crate::FfiStalePrOpportunity> = Vec::new();

            for sport in &sport_types {
                let Some(gain) =
                    gain_for_sport(sport, cycling.as_ref(), running.as_ref(), swimming.as_ref())
                else {
                    continue;
                };

                for section in e.get_ranked_sections(sport, 100) {
                    if exclude.contains(&section.section_id) {
                        continue;
                    }
                    if section.traversal_count == 0 || !section.best_time_secs.is_finite() {
                        continue;
                    }
                    if section.days_since_last < stale_threshold_days {
                        continue;
                    }

                    opportunities.push(crate::FfiStalePrOpportunity {
                        section_id: section.section_id,
                        section_name: section.section_name,
                        best_time_secs: section.best_time_secs,
                        traversal_count: section.traversal_count,
                        fitness_metric: gain.metric.to_string(),
                        current_value: gain.current,
                        previous_value: gain.previous,
                        gain_percent: gain.gain_percent,
                        unit: gain.unit.to_string(),
                    });
                }
            }

            opportunities.sort_by(|a, b| b.traversal_count.cmp(&a.traversal_count));
            opportunities.truncate(max_opportunities as usize);
            opportunities
        })
    }

    /// Batch insights data: combines period stats, trends, patterns, and recent PRs
    /// in a single engine lock. Reduces Insights hook FFI calls from 13-16 to 1.
    fn get_insights_data(
        &self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        chronic_start: i64,
        today_start: i64,
    ) -> Result<crate::FfiInsightsData, VeloqError> {
        with_engine(|e| {
            let now_ts = current_end;

            // Period stats (4 queries, all in one engine lock)
            let current_week = e.get_period_stats(current_start, current_end);
            let previous_week = e.get_period_stats(prev_start, prev_end);
            let chronic_period = e.get_period_stats(chronic_start, prev_start);
            let today_period = e.get_period_stats(today_start, now_ts);

            // Trends
            let ftp_trend = e.get_ftp_trend();
            let run_pace_trend = e.get_pace_trend("Run");

            // Activity patterns
            let all_patterns =
                crate::patterns::compute_activity_patterns(&e.db, &e.activity_metrics);
            let today_pattern = crate::patterns::get_pattern_for_today(&e.db, &e.activity_metrics);

            // Recent PRs — loop stays in Rust, never crosses FFI
            let seven_days_ago = now_ts - 7 * 86400;
            let mut recent_prs = Vec::new();
            let sport_types = e.get_available_sport_types();
            let mut all_summaries: Vec<_> = sport_types
                .iter()
                .flat_map(|sport| e.get_section_summaries_for_sport(sport))
                .filter(|s| s.visit_count >= 3)
                .collect();
            all_summaries.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

            for s in &all_summaries {
                let perf = e.get_section_performances_filtered(&s.id, None);
                // Prefer per-direction bests: they're computed lap-by-lap and
                // line up with what the section detail page shows. The combined
                // `best_record` is each activity's minimum lap, which can pick
                // a partial / unusually short portion (yielding implausible
                // times like "1:24" for a section that's normally ~6 minutes).
                // Take the faster of forward/reverse so we mirror what the
                // user would see as "the PR" on the section detail screen.
                let best = match (
                    perf.best_forward_record.as_ref(),
                    perf.best_reverse_record.as_ref(),
                ) {
                    (Some(fwd), Some(rev)) => Some(if fwd.best_time <= rev.best_time {
                        fwd
                    } else {
                        rev
                    }),
                    (Some(fwd), None) => Some(fwd),
                    (None, Some(rev)) => Some(rev),
                    (None, None) => perf.best_record.as_ref(),
                };
                if let Some(record) = best {
                    if record.activity_date >= seven_days_ago {
                        let days_ago = crate::calendar_days_between(record.activity_date, now_ts);
                        recent_prs.push(crate::FfiRecentPR {
                            section_id: s.id.clone(),
                            section_name: s.name.clone().unwrap_or_else(|| "Section".to_string()),
                            best_time: record.best_time,
                            days_ago,
                        });
                    }
                }
            }

            crate::FfiInsightsData {
                current_week,
                previous_week,
                chronic_period,
                today_period,
                ftp_trend,
                run_pace_trend,
                all_patterns,
                today_pattern,
                recent_prs,
            }
        })
    }

    /// All data the feed screen needs in a single engine lock.
    /// Combines insights + summary card + GPS preview tracks + cached metric IDs.
    /// Reduces 20+ FFI calls to 1.
    fn get_startup_data(
        &self,
        current_start: i64,
        current_end: i64,
        prev_start: i64,
        prev_end: i64,
        chronic_start: i64,
        today_start: i64,
        preview_activity_ids: Vec<String>,
    ) -> Result<crate::FfiStartupData, VeloqError> {
        with_engine(|e| {
            let now_ts = current_end;

            // === Insights data ===
            let current_week = e.get_period_stats(current_start, current_end);
            let previous_week = e.get_period_stats(prev_start, prev_end);
            let chronic_period = e.get_period_stats(chronic_start, prev_start);
            let today_period = e.get_period_stats(today_start, now_ts);
            let ftp_trend = e.get_ftp_trend();
            let run_pace_trend = e.get_pace_trend("Run");
            let all_patterns =
                crate::patterns::compute_activity_patterns(&e.db, &e.activity_metrics);
            let today_pattern = crate::patterns::get_pattern_for_today(&e.db, &e.activity_metrics);

            // Recent PRs
            let seven_days_ago = now_ts - 7 * 86400;
            let mut recent_prs = Vec::new();
            let sport_types = e.get_available_sport_types();
            let mut all_summaries: Vec<_> = sport_types
                .iter()
                .flat_map(|sport| e.get_section_summaries_for_sport(sport))
                .filter(|s| s.visit_count >= 3)
                .collect();
            all_summaries.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

            for s in &all_summaries {
                let perf = e.get_section_performances_filtered(&s.id, None);
                // Prefer per-direction bests: they're computed lap-by-lap and
                // line up with what the section detail page shows. The combined
                // `best_record` is each activity's minimum lap, which can pick
                // a partial / unusually short portion (yielding implausible
                // times like "1:24" for a section that's normally ~6 minutes).
                // Take the faster of forward/reverse so we mirror what the
                // user would see as "the PR" on the section detail screen.
                let best = match (
                    perf.best_forward_record.as_ref(),
                    perf.best_reverse_record.as_ref(),
                ) {
                    (Some(fwd), Some(rev)) => Some(if fwd.best_time <= rev.best_time {
                        fwd
                    } else {
                        rev
                    }),
                    (Some(fwd), None) => Some(fwd),
                    (None, Some(rev)) => Some(rev),
                    (None, None) => perf.best_record.as_ref(),
                };
                if let Some(record) = best {
                    if record.activity_date >= seven_days_ago {
                        let days_ago = crate::calendar_days_between(record.activity_date, now_ts);
                        recent_prs.push(crate::FfiRecentPR {
                            section_id: s.id.clone(),
                            section_name: s.name.clone().unwrap_or_else(|| "Section".to_string()),
                            best_time: record.best_time,
                            days_ago,
                        });
                    }
                }
            }

            let insights = crate::FfiInsightsData {
                current_week: current_week.clone(),
                previous_week: previous_week.clone(),
                chronic_period,
                today_period,
                ftp_trend: ftp_trend.clone(),
                run_pace_trend: run_pace_trend.clone(),
                all_patterns,
                today_pattern,
                recent_prs,
            };

            // === Summary card data (reuses period stats + trends from insights) ===
            let swim_pace_trend = e.get_pace_trend("Swim");
            let summary_card = crate::FfiSummaryCardData {
                current_week,
                prev_week: previous_week,
                ftp_trend,
                run_pace_trend,
                swim_pace_trend,
            };

            // === GPS preview tracks (simplified ~100 points via Douglas-Peucker) ===
            // Uses route signatures instead of full GPS tracks (4000+ → ~100 points)
            let preview_tracks: Vec<crate::FfiPreviewTrack> = preview_activity_ids
                .iter()
                .filter_map(|id| {
                    let sig = e.get_signature(id)?;
                    if sig.points.is_empty() {
                        return None;
                    }
                    Some(crate::FfiPreviewTrack {
                        activity_id: id.clone(),
                        points: sig
                            .points
                            .into_iter()
                            .map(crate::FfiGpsPoint::from)
                            .collect(),
                    })
                })
                .collect();

            // === Cached metric IDs (for sync skip check) ===
            let cached_metric_ids = e.get_activity_metric_ids();

            crate::FfiStartupData {
                insights,
                summary_card,
                preview_tracks,
                cached_metric_ids,
            }
        })
    }
}

