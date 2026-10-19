//! What intervals.icu speaks: its base URL, one fetcher per endpoint, the wire
//! records, and the reduction of an activity record to the metrics row.

pub mod endpoints;

pub mod wire;

use crate::governor::{Dispatch, Lane};
use crate::net::source::{Source, SourceWrites};
use crate::net::transport::{NetError, Transport};
use crate::net::types::{ActivityHistorySummary, ParsedStreams, StreamDto};
use chrono::{DateTime, Utc};
use wire::{ActivityRecord, AthleteRecord, ListedActivity, ManualActivityBody};

/// The intervals.icu API root every request is built on.
pub(crate) const BASE_URL: &str = "https://intervals.icu/api/v1";

/// One signed-in athlete on intervals.icu: the transport carrying their
/// credential and the athlete id every athlete path names.
#[derive(Clone)]
pub struct IntervalsSession {
    transport: Transport,
    athlete_id: String,
}

impl IntervalsSession {
    pub fn new(transport: Transport, athlete_id: impl Into<String>) -> Self {
        Self {
            transport,
            athlete_id: athlete_id.into(),
        }
    }

    pub fn into_parts(self) -> (Transport, String) {
        (self.transport, self.athlete_id)
    }
}

impl Source for IntervalsSession {
    fn account(&self) -> &str {
        &self.athlete_id
    }

    fn transport(&self) -> &Transport {
        &self.transport
    }

    /// Asks the profile, an endpoint a live credential always answers.
    /// intervals.icu answers 403 for the wrong resource and 401 only for a
    /// credential it will not accept, so a second 401 is the server saying so
    /// twice. A 200, a 5xx, a timeout or a connection that never opened says
    /// nothing about the credential and so confirms nothing.
    async fn confirm_rejected(&self) -> bool {
        matches!(
            endpoints::fetch_athlete_body(&self.transport, &self.athlete_id, Lane::Interactive)
                .await,
            Err(NetError::Unauthorized)
        )
    }

    fn cooldown_until(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.transport.cooldown_until(now)
    }

    fn refusal_lifts_at(&self, e: &NetError, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.transport.refusal_lifts_at(e, now)
    }

    async fn current_athlete(&self, dispatch: Dispatch) -> Result<AthleteRecord, NetError> {
        endpoints::fetch_current_athlete(&self.transport, dispatch).await
    }

    async fn athlete_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        endpoints::fetch_athlete_body(&self.transport, &self.athlete_id, dispatch).await
    }

    async fn sport_settings_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        endpoints::fetch_sport_settings_body(&self.transport, &self.athlete_id, dispatch).await
    }

    async fn fitness_model_events_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        endpoints::fetch_fitness_model_events_body(&self.transport, &self.athlete_id, dispatch)
            .await
    }

    async fn wellness(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<(wire::WellnessRecord, String)>, NetError> {
        endpoints::fetch_wellness_with_bodies(
            &self.transport,
            &self.athlete_id,
            oldest,
            newest,
            dispatch,
        )
        .await
    }

    async fn census(
        &self,
        today: &str,
        dispatch: Dispatch,
    ) -> Result<ActivityHistorySummary, NetError> {
        endpoints::fetch_activity_history_summary(
            &self.transport,
            &self.athlete_id,
            today,
            dispatch,
        )
        .await
    }

    async fn activities(
        &self,
        oldest: &str,
        newest: &str,
        include_stats: bool,
        limit: Option<u32>,
        dispatch: Dispatch,
    ) -> Result<Vec<(ActivityRecord, String)>, NetError> {
        endpoints::fetch_activities_with_bodies(
            &self.transport,
            &self.athlete_id,
            oldest,
            newest,
            include_stats,
            limit,
            dispatch,
        )
        .await
    }

    async fn activity_body(&self, upstream: &str, dispatch: Dispatch) -> Result<String, NetError> {
        endpoints::fetch_activity_body(&self.transport, upstream, dispatch).await
    }

    async fn activity_bodies_in_bulk(
        &self,
        upstream: &[String],
        dispatch: Dispatch,
    ) -> Result<Vec<endpoints::BulkActivityBodies>, NetError> {
        endpoints::fetch_activity_bodies_in_bulk(
            &self.transport,
            &self.athlete_id,
            upstream,
            dispatch,
        )
        .await
    }

    async fn streams_body(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        endpoints::fetch_streams_body(&self.transport, upstream, types, dispatch).await
    }

    async fn streams(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<ParsedStreams, NetError> {
        endpoints::fetch_streams(&self.transport, upstream, types, dispatch).await
    }

    async fn stream_series(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<StreamDto>, NetError> {
        endpoints::fetch_stream_series(&self.transport, upstream, types, dispatch).await
    }

    async fn streams_bytes(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<u8>, NetError> {
        endpoints::fetch_streams_bytes(&self.transport, upstream, types, dispatch).await
    }

    async fn altitude(
        &self,
        upstream: &str,
        dispatch: Dispatch,
    ) -> Result<Option<ParsedStreams>, NetError> {
        endpoints::fetch_altitude(&self.transport, upstream, dispatch).await
    }

    async fn time_stream(&self, upstream: &str, dispatch: Dispatch) -> Result<Vec<u32>, NetError> {
        endpoints::fetch_time_stream(&self.transport, upstream, dispatch).await
    }

    async fn original_file(&self, upstream: &str, dispatch: Dispatch) -> Result<Vec<u8>, NetError> {
        endpoints::fetch_original_file(&self.transport, upstream, dispatch).await
    }

    async fn intervals_body(&self, upstream: &str, dispatch: Dispatch) -> Result<String, NetError> {
        endpoints::fetch_intervals_body(&self.transport, upstream, dispatch).await
    }

    async fn calendar(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<(String, String, String)>, NetError> {
        endpoints::fetch_calendar_events_bodies(
            &self.transport,
            &self.athlete_id,
            oldest,
            newest,
            dispatch,
        )
        .await
    }

    async fn power_curves(
        &self,
        sport: &str,
        curves: &str,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        endpoints::fetch_power_curve_body(
            &self.transport,
            &self.athlete_id,
            sport,
            curves,
            dispatch,
        )
        .await
    }

    async fn pace_curves(
        &self,
        sport: &str,
        curves: &str,
        gap: bool,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        endpoints::fetch_pace_curve_body(
            &self.transport,
            &self.athlete_id,
            sport,
            curves,
            gap,
            dispatch,
        )
        .await
    }
}

/// Seconds in power zones Z1 to Z`count`, placed by the id the server sent. The
/// series also carries a sweet-spot entry that is not a zone, so a position would
/// put it in a zone slot whenever it is not last. An entry with no id falls back
/// to its position.
pub(crate) fn power_zone_seconds(zones: &[wire::ZoneTime], count: usize) -> Vec<u32> {
    let mut out = vec![0u32; count];
    for (position, zone) in zones.iter().enumerate() {
        let slot = match zone.id.as_deref() {
            Some(id) => id
                .strip_prefix('Z')
                .and_then(|n| n.parse::<usize>().ok())
                .and_then(|n| n.checked_sub(1)),
            None => Some(position),
        };
        if let Some(slot) = slot.filter(|&s| s < out.len()) {
            out[slot] = zone.secs.unwrap_or(0).max(0) as u32;
        }
    }
    out
}

/// One activity's metrics row from the record the page carried. The stats
/// fields ride the same response, so the row is complete when it is written
/// and nothing has to read the body back to fill it in.
pub(crate) fn activity_metrics_row(record: ActivityRecord, date: i64) -> crate::ActivityMetrics {
    crate::ActivityMetrics {
        activity_id: record.id,
        name: record.name.unwrap_or_default(),
        date,
        distance: record.distance.unwrap_or(0.0),
        moving_time: record.moving_time.unwrap_or(0).max(0) as u32,
        elapsed_time: record.elapsed_time.unwrap_or(0).max(0) as u32,
        elevation_gain: record.total_elevation_gain.unwrap_or(0.0),
        avg_hr: record.average_heartrate.map(|v| v.round() as u16),
        avg_power: record.icu_average_watts.map(|v| v.round() as u16),
        sport_type: record.activity_type.unwrap_or_else(|| "Ride".to_string()),
        training_load: record.icu_training_load,
        ftp: record.icu_ftp.map(|v| v.round().max(0.0) as u16),
        power_zone_times: record
            .icu_zone_times
            .map(|zones| power_zone_seconds(&zones, crate::persistence::fitness::ZONE_COLUMNS)),
        hr_zone_times: record
            .icu_hr_zone_times
            .map(|zones| zones.iter().map(|&s| s.max(0) as u32).collect()),
    }
}

/// The metrics row a stored activity body names. The body is parsed as the
/// activity record it was fetched as, and `id` is the row's own key rather
/// than whatever the body carries.
pub(crate) fn metrics_from_body(
    raw: &str,
    date: i64,
    id: &str,
) -> rusqlite::Result<crate::ActivityMetrics> {
    let mut record: ActivityRecord = serde_json::from_str(raw)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    record.id = id.to_string();
    Ok(activity_metrics_row(record, date))
}

impl SourceWrites for IntervalsSession {
    async fn upload_activity(
        &self,
        file_path: &str,
        filename: &str,
        details: endpoints::UploadDetails<'_>,
        dispatch: Dispatch,
    ) -> Result<Option<String>, NetError> {
        endpoints::upload_activity(
            &self.transport,
            &self.athlete_id,
            file_path,
            filename,
            details,
            dispatch,
        )
        .await
    }

    async fn create_activity(
        &self,
        activity: &ManualActivityBody,
        dispatch: Dispatch,
    ) -> Result<Option<String>, NetError> {
        endpoints::create_activity(&self.transport, &self.athlete_id, activity, dispatch).await
    }

    async fn activities_between(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<ListedActivity>, NetError> {
        endpoints::list_activities_between(
            &self.transport,
            &self.athlete_id,
            oldest,
            newest,
            dispatch,
        )
        .await
    }

    async fn update_activity_rpe(
        &self,
        upstream: &str,
        rpe: u32,
        dispatch: Dispatch,
    ) -> Result<(), NetError> {
        endpoints::update_activity_rpe(&self.transport, upstream, rpe, dispatch).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_metrics_row_carries_the_stats_the_page_fetched() {
        let record: ActivityRecord = serde_json::from_value(json!({
            "id": "a1",
            "name": "Ride",
            "type": "Ride",
            "start_date_local": "2026-01-02T08:00:00",
            "moving_time": 3600,
            "icu_training_load": 88.0,
            "icu_ftp": 250.4,
            "icu_zone_times": [{"id": "Z1", "secs": 10}, {"id": "Z2", "secs": 20}],
            "icu_hr_zone_times": [11, 22],
        }))
        .expect("record");

        let row = activity_metrics_row(record, 1_767_340_800);

        assert_eq!(row.training_load, Some(88.0));
        assert_eq!(row.ftp, Some(250));
        assert_eq!(row.power_zone_times, Some(vec![10, 20, 0, 0, 0, 0, 0]));
        assert_eq!(row.hr_zone_times, Some(vec![11, 22]));
    }

    #[test]
    fn power_zone_seconds_are_read_by_id_so_sweet_spot_never_takes_a_zone_slot() {
        let record: ActivityRecord = serde_json::from_value(json!({
            "id": "a4",
            "start_date_local": "2026-01-02T08:00:00",
            "icu_zone_times": [
                {"id": "SS", "secs": 999},
                {"id": "Z2", "secs": 20},
                {"id": "Z1", "secs": 10},
                {"id": "Z7", "secs": 70},
                {"id": "Z8", "secs": 80},
            ],
        }))
        .expect("record");

        let row = activity_metrics_row(record, 1_767_340_800);

        assert_eq!(row.power_zone_times, Some(vec![10, 20, 0, 0, 0, 0, 70]));
    }

    #[test]
    fn an_activity_with_no_stats_leaves_them_unset() {
        let record: ActivityRecord = serde_json::from_value(json!({
            "id": "a2",
            "start_date_local": "2026-01-02T08:00:00",
        }))
        .expect("record");

        let row = activity_metrics_row(record, 1_767_340_800);

        assert_eq!(row.training_load, None);
        assert_eq!(row.ftp, None);
        assert_eq!(row.power_zone_times, None);
        assert_eq!(row.hr_zone_times, None);
        assert_eq!(row.sport_type, "Ride");
    }

    // A zone series in a shape we do not model is worth less than the
    // activity, so it is dropped rather than failing the whole page.
    #[test]
    fn an_unmodelled_zone_shape_does_not_cost_the_page_its_metrics() {
        let record: ActivityRecord = serde_json::from_value(json!({
            "id": "a3",
            "start_date_local": "2026-01-02T08:00:00",
            "icu_training_load": 42.0,
            "icu_zone_times": 120,
            "icu_hr_zone_times": "nope",
        }))
        .expect("record");

        let row = activity_metrics_row(record, 1_767_340_800);

        assert_eq!(row.training_load, Some(42.0));
        assert_eq!(row.power_zone_times, None);
        assert_eq!(row.hr_zone_times, None);
    }
}
