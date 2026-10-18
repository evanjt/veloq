//! A source that answers every read from what a test set on it and records
//! each call with its arguments and its dispatch, so a test can assert what a
//! caller asked rather than what reached a mock server.

use crate::governor::Dispatch;
use crate::net::endpoints::BulkActivityBodies;
use crate::net::intervals::wire::{ActivityRecord, AthleteRecord, WellnessRecord};
use crate::net::source::Source;
use crate::net::transport::NetError;
use crate::net::types::{ActivityHistorySummary, ParsedStreams, StreamDto};
use chrono::{DateTime, Utc};
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Asked {
    pub method: &'static str,
    pub args: Vec<String>,
    pub dispatch: Dispatch,
}

pub(crate) fn asked(method: &'static str, args: &[&str], dispatch: impl Into<Dispatch>) -> Asked {
    Asked {
        method,
        args: args.iter().map(|a| a.to_string()).collect(),
        dispatch: dispatch.into(),
    }
}

/// Every answer is the field of the same name. A body field holds JSON text.
pub(crate) struct RecordingSource {
    pub account: String,
    pub activity_body: String,
    pub streams: ParsedStreams,
    pub stream_series: Vec<StreamDto>,
    pub streams_bytes: Vec<u8>,
    pub altitude: Option<ParsedStreams>,
    pub time_stream: Vec<u32>,
    pub original_file: Vec<u8>,
    calls: Mutex<Vec<Asked>>,
}

impl RecordingSource {
    pub fn new() -> Self {
        Self {
            account: "i1".into(),
            activity_body: "{}".into(),
            streams: ParsedStreams::default(),
            stream_series: Vec::new(),
            streams_bytes: b"[]".to_vec(),
            altitude: None,
            time_stream: Vec::new(),
            original_file: Vec::new(),
            calls: Mutex::new(Vec::new()),
        }
    }

    pub fn calls(&self) -> Vec<Asked> {
        self.calls.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn note(&self, method: &'static str, args: &[&str], dispatch: Dispatch) {
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(asked(method, args, dispatch));
    }
}

impl Source for RecordingSource {
    fn account(&self) -> &str {
        &self.account
    }

    async fn confirm_rejected(&self) -> bool {
        false
    }

    fn cooldown_until(&self, _now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        None
    }

    fn refusal_lifts_at(&self, _e: &NetError, _now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        None
    }

    async fn current_athlete(&self, dispatch: Dispatch) -> Result<AthleteRecord, NetError> {
        self.note("current_athlete", &[], dispatch);
        Ok(AthleteRecord {
            id: self.account.clone(),
            ..AthleteRecord::default()
        })
    }

    async fn athlete_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("athlete_body", &[], dispatch);
        Ok("{}".into())
    }

    async fn sport_settings_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("sport_settings_body", &[], dispatch);
        Ok("[]".into())
    }

    async fn fitness_model_events_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("fitness_model_events_body", &[], dispatch);
        Ok("[]".into())
    }

    async fn wellness(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<(WellnessRecord, String)>, NetError> {
        self.note("wellness", &[oldest, newest], dispatch);
        Ok(Vec::new())
    }

    async fn census(
        &self,
        today: &str,
        dispatch: Dispatch,
    ) -> Result<ActivityHistorySummary, NetError> {
        self.note("census", &[today], dispatch);
        Ok(ActivityHistorySummary::default())
    }

    async fn activities(
        &self,
        oldest: &str,
        newest: &str,
        _include_stats: bool,
        _limit: Option<u32>,
        dispatch: Dispatch,
    ) -> Result<Vec<(ActivityRecord, String)>, NetError> {
        self.note("activities", &[oldest, newest], dispatch);
        Ok(Vec::new())
    }

    async fn activity_body(&self, upstream: &str, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("activity_body", &[upstream], dispatch);
        Ok(self.activity_body.clone())
    }

    async fn activity_bodies_in_bulk(
        &self,
        upstream: &[String],
        dispatch: Dispatch,
    ) -> Result<Vec<BulkActivityBodies>, NetError> {
        self.note("activity_bodies_in_bulk", &[&upstream.join(",")], dispatch);
        Ok(Vec::new())
    }

    async fn streams_body(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        self.note("streams_body", &[upstream, types], dispatch);
        Ok("[]".into())
    }

    async fn streams(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<ParsedStreams, NetError> {
        self.note("streams", &[upstream, types], dispatch);
        Ok(self.streams.clone())
    }

    async fn stream_series(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<StreamDto>, NetError> {
        self.note("stream_series", &[upstream, types], dispatch);
        Ok(self.stream_series.clone())
    }

    async fn streams_bytes(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<u8>, NetError> {
        self.note("streams_bytes", &[upstream, types], dispatch);
        Ok(self.streams_bytes.clone())
    }

    async fn altitude(
        &self,
        upstream: &str,
        dispatch: Dispatch,
    ) -> Result<Option<ParsedStreams>, NetError> {
        self.note("altitude", &[upstream], dispatch);
        Ok(self.altitude.clone())
    }

    async fn time_stream(&self, upstream: &str, dispatch: Dispatch) -> Result<Vec<u32>, NetError> {
        self.note("time_stream", &[upstream], dispatch);
        Ok(self.time_stream.clone())
    }

    async fn original_file(&self, upstream: &str, dispatch: Dispatch) -> Result<Vec<u8>, NetError> {
        self.note("original_file", &[upstream], dispatch);
        Ok(self.original_file.clone())
    }

    async fn intervals_body(&self, upstream: &str, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("intervals_body", &[upstream], dispatch);
        Ok("{}".into())
    }

    async fn calendar(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<(String, String, String)>, NetError> {
        self.note("calendar", &[oldest, newest], dispatch);
        Ok(Vec::new())
    }

    async fn power_curves(
        &self,
        sport: &str,
        curves: &str,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        self.note("power_curves", &[sport, curves], dispatch);
        Ok("{}".into())
    }

    async fn pace_curves(
        &self,
        sport: &str,
        curves: &str,
        gap: bool,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        self.note("pace_curves", &[sport, curves, &gap.to_string()], dispatch);
        Ok("{}".into())
    }
}
