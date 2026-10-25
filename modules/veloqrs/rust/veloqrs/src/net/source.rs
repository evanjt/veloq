//! The athlete's source of training data, as the engine asks it.
//!
//! [`Source`] holds the reads: one method per request the sync, the on-demand
//! fetches, the backfills, the track fetch and the credential check make.
//! [`SourceWrites`] holds what an upload asks: sending a file, creating an
//! entry with no file, listing a window to find what an earlier upload
//! created, and setting an effort. Each method has the parameters and answer
//! the intervals.icu endpoint has, so the bytes on the wire are the endpoint's
//! own, and a source that is not intervals.icu maps its answers into those
//! shapes as they arrive. The lane or dispatch a caller passes goes through
//! unchanged. The live implementation is the intervals.icu session, named in
//! `net/live.rs`; a test drives the sync and the writes over a fake that
//! records what it was asked.

use crate::governor::Dispatch;
use crate::net::endpoints::{BulkActivityBodies, Replacement, UploadDetails};
use crate::net::intervals::wire::{
    ActivityRecord, AthleteRecord, ListedActivity, ManualActivityBody, WellnessRecord,
};
use crate::net::transport::{NetError, Transport};
use crate::net::types::{ActivityHistorySummary, ParsedStreams, StreamDto};
use chrono::{DateTime, Utc};
use std::future::Future;

pub trait Source: Send + Sync {
    /// The athlete every request is asked on behalf of.
    fn account(&self) -> &str;

    /// The transport the requests go out on, drawing on the process governor.
    fn transport(&self) -> &Transport;

    /// Whether the source refuses the credential when asked again.
    ///
    /// One 401 is not evidence, so the caller asks this before it signs the
    /// athlete out. True only when the second answer is a refusal too.
    fn confirm_rejected(&self) -> impl Future<Output = bool> + Send;

    /// Until when a refusal from the source holds every request at `now`.
    fn cooldown_until(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>>;

    /// When the work `e` refused may be asked for again, or `None` when `e`
    /// is not a refusal.
    fn refusal_lifts_at(&self, e: &NetError, now: DateTime<Utc>) -> Option<DateTime<Utc>>;

    /// The athlete the credential belongs to, whatever `account` names.
    fn current_athlete(
        &self,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<AthleteRecord, NetError>> + Send;

    fn athlete_body(
        &self,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<String, NetError>> + Send;

    fn sport_settings_body(
        &self,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<String, NetError>> + Send;

    fn fitness_model_events_body(
        &self,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<String, NetError>> + Send;

    fn wellness(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<(WellnessRecord, String)>, NetError>> + Send;

    /// Every activity the athlete has, through `today`, in the census form.
    fn census(
        &self,
        today: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<ActivityHistorySummary, NetError>> + Send;

    fn activities(
        &self,
        oldest: &str,
        newest: &str,
        include_stats: bool,
        limit: Option<u32>,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<(ActivityRecord, String)>, NetError>> + Send;

    fn activity_body(
        &self,
        upstream: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<String, NetError>> + Send;

    /// The detail and interval bodies of up to
    /// [`crate::net::endpoints::BULK_ACTIVITIES_MAX`] activities at once.
    fn activity_bodies_in_bulk(
        &self,
        upstream: &[String],
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<BulkActivityBodies>, NetError>> + Send;

    fn streams_body(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<String, NetError>> + Send;

    fn streams(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<ParsedStreams, NetError>> + Send;

    /// The listed series as the server sent them, typed and in its own index
    /// space, with nothing reduced.
    fn stream_series(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<StreamDto>, NetError>> + Send;

    /// The streams response as its raw bytes, for a caller that decodes and
    /// measures it itself.
    fn streams_bytes(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<u8>, NetError>> + Send;

    /// The elevation series alone, `None` when the activity carries none.
    fn altitude(
        &self,
        upstream: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Option<ParsedStreams>, NetError>> + Send;

    /// Cumulative seconds at each track point, empty when there is no clock.
    fn time_stream(
        &self,
        upstream: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<u32>, NetError>> + Send;

    /// The file the activity was recorded as.
    fn original_file(
        &self,
        upstream: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<u8>, NetError>> + Send;

    fn intervals_body(
        &self,
        upstream: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<String, NetError>> + Send;

    /// `(id, start_date_local, body)` for each calendar event in the window.
    fn calendar(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<(String, String, String)>, NetError>> + Send;

    fn power_curves(
        &self,
        sport: &str,
        curves: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<String, NetError>> + Send;

    fn pace_curves(
        &self,
        sport: &str,
        curves: &str,
        gap: bool,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<String, NetError>> + Send;
}

/// What an upload asks of the source, beside the reads.
pub trait SourceWrites: Source {
    /// Send a recorded file as a new activity, answering the id it was given.
    fn upload_activity(
        &self,
        file_path: &str,
        filename: &str,
        details: UploadDetails<'_>,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Option<String>, NetError>> + Send;

    /// Create an activity with no file behind it, answering the id it was given.
    fn create_activity(
        &self,
        activity: &ManualActivityBody,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Option<String>, NetError>> + Send;

    /// The activities between two local dates, as the upload's duplicate check
    /// reads them.
    fn activities_between(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Vec<ListedActivity>, NetError>> + Send;

    /// Replace an activity's file in place, keeping the athlete's custom
    /// fields and, when asked, the intervals they edited.
    fn replace_activity_file(
        &self,
        upstream: &str,
        file_path: &str,
        filename: &str,
        keep_intervals: bool,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<Replacement, NetError>> + Send;

    /// Set the effort the athlete gave an activity.
    fn update_activity_rpe(
        &self,
        upstream: &str,
        rpe: u32,
        dispatch: Dispatch,
    ) -> impl Future<Output = Result<(), NetError>> + Send;
}
