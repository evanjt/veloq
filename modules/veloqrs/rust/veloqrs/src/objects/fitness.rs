use crate::persistence::with_persistent_engine;
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

    fn get_period_stats(&self, start_ts: i64, end_ts: i64) -> crate::FfiPeriodStats {
        with_persistent_engine(|e| e.get_period_stats(start_ts, end_ts)).unwrap_or(
            crate::FfiPeriodStats {
                count: 0,
                total_duration: 0,
                total_distance: 0.0,
                total_tss: 0.0,
            },
        )
    }

    fn get_weekly_comparison(&self, week_start_ts: i64) -> crate::FfiWeeklyComparison {
        with_persistent_engine(|e| e.get_weekly_comparison(week_start_ts)).unwrap_or(
            crate::FfiWeeklyComparison {
                current_week: crate::FfiPeriodStats {
                    count: 0,
                    total_duration: 0,
                    total_distance: 0.0,
                    total_tss: 0.0,
                },
                previous_week: crate::FfiPeriodStats {
                    count: 0,
                    total_duration: 0,
                    total_distance: 0.0,
                    total_tss: 0.0,
                },
                ftp_trend: crate::FfiFtpTrend {
                    latest_ftp: None,
                    latest_date: None,
                    previous_ftp: None,
                    previous_date: None,
                },
            },
        )
    }

    fn get_monthly_aggregates(
        &self,
        year: i32,
        metric: String,
    ) -> Vec<crate::FfiMonthlyAggregate> {
        with_persistent_engine(|e| e.get_monthly_aggregates(year, &metric)).unwrap_or_default()
    }

    fn get_activity_heatmap(&self, start_ts: i64, end_ts: i64) -> Vec<crate::FfiHeatmapDay> {
        with_persistent_engine(|e| e.get_activity_heatmap(start_ts, end_ts)).unwrap_or_default()
    }

    fn get_zone_distribution(&self, sport_type: String, zone_type: String) -> Vec<f64> {
        with_persistent_engine(|e| e.get_zone_distribution(&sport_type, &zone_type))
            .unwrap_or_default()
    }

    fn get_ftp_trend(&self) -> crate::FfiFtpTrend {
        with_persistent_engine(|e| e.get_ftp_trend()).unwrap_or(crate::FfiFtpTrend {
            latest_ftp: None,
            latest_date: None,
            previous_ftp: None,
            previous_date: None,
        })
    }

    fn save_pace_snapshot(
        &self,
        sport_type: String,
        critical_speed: f64,
        d_prime: Option<f64>,
        r2: Option<f64>,
        date: i64,
    ) {
        with_persistent_engine(|e| {
            e.save_pace_snapshot(&sport_type, critical_speed, d_prime, r2, date)
        });
    }

    fn get_pace_trend(&self, sport_type: String) -> crate::FfiPaceTrend {
        with_persistent_engine(|e| e.get_pace_trend(&sport_type)).unwrap_or(crate::FfiPaceTrend {
            latest_pace: None,
            latest_date: None,
            previous_pace: None,
            previous_date: None,
        })
    }

    fn get_available_sport_types(&self) -> Vec<String> {
        with_persistent_engine(|e| e.get_available_sport_types()).unwrap_or_default()
    }
}
