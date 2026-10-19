//! A source that answers every read and write from what a test set on it and
//! records each call with its arguments and its dispatch, so a test can assert
//! what a caller asked rather than what reached a mock server. A clone shares
//! the record, so a test keeps one while the caller takes the other.

use crate::governor::Dispatch;
use crate::net::endpoints::{BulkActivityBodies, UploadDetails};
use crate::net::intervals::wire::{
    ActivityRecord, AthleteRecord, ListedActivity, ManualActivityBody, WellnessRecord,
};
use crate::net::source::{Source, SourceWrites};
use crate::net::transport::{NetError, Transport};
use crate::net::types::{ActivityHistorySummary, ParsedStreams, StreamDto};
use chrono::{DateTime, Utc};
use std::sync::{Arc, Mutex};

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
/// A file upload and a manual entry both answer `created`.
#[derive(Clone)]
pub(crate) struct RecordingSource {
    pub account: String,
    pub activity_body: String,
    pub streams: ParsedStreams,
    pub stream_series: Vec<StreamDto>,
    pub streams_bytes: Vec<u8>,
    pub altitude: Option<ParsedStreams>,
    pub time_stream: Vec<u32>,
    pub original_file: Vec<u8>,
    pub created: Option<String>,
    pub listed: Vec<ListedActivity>,
    transport: Transport,
    calls: Arc<Mutex<Vec<Asked>>>,
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
            created: Some("a9".into()),
            listed: Vec::new(),
            transport: unreachable_transport(),
            calls: Arc::new(Mutex::new(Vec::new())),
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

/// A transport no request is sent on: a fake answers every read itself.
pub(crate) fn unreachable_transport() -> Transport {
    Transport::new(
        "http://127.0.0.1:9",
        crate::governor::AuthMethod::ApiKey("unused"),
    )
    .expect("a transport for no server")
}

impl Source for RecordingSource {
    fn account(&self) -> &str {
        &self.account
    }

    fn transport(&self) -> &Transport {
        &self.transport
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

impl SourceWrites for RecordingSource {
    /// Records the file and each detail, an unset detail as empty.
    async fn upload_activity(
        &self,
        file_path: &str,
        filename: &str,
        details: UploadDetails<'_>,
        dispatch: Dispatch,
    ) -> Result<Option<String>, NetError> {
        let paired = details
            .paired_event_id
            .map(|id| id.to_string())
            .unwrap_or_default();
        self.note(
            "upload_activity",
            &[
                file_path,
                filename,
                details.external_id.unwrap_or_default(),
                details.name.unwrap_or_default(),
                details.description.unwrap_or_default(),
                &paired,
            ],
            dispatch,
        );
        Ok(self.created.clone())
    }

    /// Records the body as the JSON that would go on the wire.
    async fn create_activity(
        &self,
        activity: &ManualActivityBody,
        dispatch: Dispatch,
    ) -> Result<Option<String>, NetError> {
        let body = serde_json::to_string(activity).expect("a manual entry serialises");
        self.note("create_activity", &[&body], dispatch);
        Ok(self.created.clone())
    }

    async fn activities_between(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<ListedActivity>, NetError> {
        self.note("activities_between", &[oldest, newest], dispatch);
        Ok(self.listed.clone())
    }

    async fn update_activity_rpe(
        &self,
        upstream: &str,
        rpe: u32,
        dispatch: Dispatch,
    ) -> Result<(), NetError> {
        self.note(
            "update_activity_rpe",
            &[upstream, &rpe.to_string()],
            dispatch,
        );
        Ok(())
    }
}
