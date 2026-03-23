use super::error::{with_engine, VeloqError};
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct FitnessManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl FitnessManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn get_period_stats(&self, start_ts: i64, end_ts: i64) -> Result<crate::FfiPeriodStats, VeloqError> {
        with_engine(|e| e.get_period_stats(start_ts, end_ts))
    }

    fn get_zone_distribution(&self, sport_type: String, zone_type: String) -> Result<Vec<f64>, VeloqError> {
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

    fn get_activity_heatmap(&self, start_date: String, end_date: String) -> Result<Vec<crate::FfiHeatmapDay>, VeloqError> {
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
        with_engine(|e| {
            crate::patterns::compute_activity_patterns(&e.db, &e.activity_metrics)
        })
    }

    fn get_pattern_for_today(&self) -> Result<Option<crate::FfiActivityPattern>, VeloqError> {
        with_engine(|e| {
            crate::patterns::get_pattern_for_today(&e.db, &e.activity_metrics)
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
            let today_pattern =
                crate::patterns::get_pattern_for_today(&e.db, &e.activity_metrics);

            // Recent PRs — loop stays in Rust, never crosses FFI
            let seven_days_ago = now_ts - 7 * 86400;
            let mut recent_prs = Vec::new();
            let ride_summaries = e.get_section_summaries_for_sport("Ride");
            let run_summaries = e.get_section_summaries_for_sport("Run");
            let mut all_summaries: Vec<_> = ride_summaries
                .into_iter()
                .chain(run_summaries)
                .filter(|s| s.visit_count >= 3)
                .collect();
            all_summaries.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

            for s in all_summaries.iter().take(10) {
                if recent_prs.len() >= 3 {
                    break;
                }
                let perf = e.get_section_performances_filtered(&s.id, None);
                let best = perf
                    .best_record
                    .as_ref()
                    .or(perf.best_forward_record.as_ref());
                if let Some(record) = best {
                    if record.activity_date >= seven_days_ago {
                        let days_ago =
                            ((now_ts - record.activity_date) / 86400).max(0) as u32;
                        recent_prs.push(crate::FfiRecentPR {
                            section_id: s.id.clone(),
                            section_name: s
                                .name
                                .clone()
                                .unwrap_or_else(|| "Section".to_string()),
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
}
