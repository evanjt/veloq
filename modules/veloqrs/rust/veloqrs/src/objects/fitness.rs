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
}
