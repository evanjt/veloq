//! Scenario: the sync driven over a fake source that answers from the same
//! fixture the request-count test serves over HTTP, and records each call with
//! its arguments, its dispatch and the step running when it was made.
//!
//! Expected behaviour: the calls come in the order the steps run, a 401 is
//! confirmed through the source before anything parks, and a cancel or a
//! sign-out stops the run before the next step asks anything.

use super::sync_request_counts_tests::{
    activities_body, census_body, curve_body, detail_body, intervals_body, profile_body, ride_day,
};
use super::*;
use crate::net::intervals::wire::{
    AthleteRecord, CensusRecord, WellnessRecord, activity_counts_by_year,
};
use crate::net::types::{ActivityCensusEntry, ActivityHistorySummary, ParsedStreams, StreamDto};
use serde_json::json;

#[derive(Debug, Clone, PartialEq)]
struct Call {
    method: &'static str,
    args: Vec<String>,
    dispatch: Option<Dispatch>,
    step: Option<FfiSyncStep>,
}

/// What the fake does inside its census answer, before it answers.
#[derive(Clone, Copy, PartialEq)]
enum DuringCensus {
    Nothing,
    Cancel,
    SignOut,
}

struct FakeSource<'a> {
    svc: &'a SyncService,
    profile: serde_json::Value,
    census: serde_json::Value,
    activities: serde_json::Value,
    refuse: Option<&'static str>,
    rejected: bool,
    during_census: DuringCensus,
    calls: Mutex<Vec<Call>>,
}

impl<'a> FakeSource<'a> {
    fn new(svc: &'a SyncService) -> Self {
        Self {
            svc,
            profile: profile_body(),
            census: census_body(),
            activities: activities_body(),
            refuse: None,
            rejected: false,
            during_census: DuringCensus::Nothing,
            calls: Mutex::new(Vec::new()),
        }
    }

    fn note(
        &self,
        method: &'static str,
        args: &[&str],
        dispatch: Option<Dispatch>,
    ) -> Result<(), NetError> {
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Call {
                method,
                args: args.iter().map(|a| a.to_string()).collect(),
                dispatch,
                step: self.svc.snapshot().step,
            });
        match self.refuse {
            Some(refused) if refused == method => Err(NetError::Unauthorized),
            _ => Ok(()),
        }
    }

    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn methods(&self) -> Vec<&'static str> {
        self.calls().iter().map(|c| c.method).collect()
    }
}

impl Source for FakeSource<'_> {
    fn account(&self) -> &str {
        "i1"
    }

    async fn confirm_rejected(&self) -> bool {
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Call {
                method: "confirm_rejected",
                args: Vec::new(),
                dispatch: None,
                step: self.svc.snapshot().step,
            });
        self.rejected
    }

    fn cooldown_until(
        &self,
        _now: chrono::DateTime<chrono::Utc>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        None
    }

    fn refusal_lifts_at(
        &self,
        _e: &NetError,
        _now: chrono::DateTime<chrono::Utc>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        None
    }

    async fn current_athlete(&self, dispatch: Dispatch) -> Result<AthleteRecord, NetError> {
        self.note("current_athlete", &[], Some(dispatch))?;
        Ok(AthleteRecord {
            id: "i1".into(),
            ..AthleteRecord::default()
        })
    }

    async fn athlete_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("athlete", &[], Some(dispatch))?;
        Ok(self.profile.to_string())
    }

    async fn sport_settings_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("sport_settings", &[], Some(dispatch))?;
        Ok("[]".into())
    }

    async fn fitness_model_events_body(&self, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("fitness_model_events", &[], Some(dispatch))?;
        Ok("[]".into())
    }

    async fn wellness(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<(WellnessRecord, String)>, NetError> {
        self.note("wellness", &[oldest, newest], Some(dispatch))?;
        Ok(Vec::new())
    }

    async fn census(
        &self,
        today: &str,
        dispatch: Dispatch,
    ) -> Result<ActivityHistorySummary, NetError> {
        match self.during_census {
            DuringCensus::Nothing => {}
            DuringCensus::Cancel => self.svc.request_cancel(),
            DuringCensus::SignOut => self.svc.clear_credentials(),
        }
        self.note("census", &[today], Some(dispatch))?;
        let acts: Vec<CensusRecord> =
            serde_json::from_value(self.census.clone()).expect("census fixture");
        Ok(ActivityHistorySummary {
            oldest: crate::net::intervals::wire::oldest_activity_date(&acts),
            counts_by_year: activity_counts_by_year(&acts),
            entries: acts.iter().map(ActivityCensusEntry::from).collect(),
        })
    }

    async fn activities(
        &self,
        oldest: &str,
        newest: &str,
        include_stats: bool,
        limit: Option<u32>,
        dispatch: Dispatch,
    ) -> Result<Vec<(ActivityRecord, String)>, NetError> {
        let limit = format!("{limit:?}");
        let stats = include_stats.to_string();
        self.note(
            "activities",
            &[oldest, newest, &stats, &limit],
            Some(dispatch),
        )?;
        endpoints::split_page(self.activities.to_string().as_bytes())
    }

    async fn activity_body(&self, upstream: &str, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("activity_body", &[upstream], Some(dispatch))?;
        Ok(detail_body().to_string())
    }

    async fn activity_bodies_in_bulk(
        &self,
        upstream: &[String],
        dispatch: Dispatch,
    ) -> Result<Vec<endpoints::BulkActivityBodies>, NetError> {
        let ids = upstream.join(",");
        self.note("bulk", &[&ids], Some(dispatch))?;
        // Left out, so each body is asked alone, as the HTTP fixture answers.
        Ok(Vec::new())
    }

    async fn streams_body(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        self.note("streams_body", &[upstream, types], Some(dispatch))?;
        Ok("[]".into())
    }

    async fn streams(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<ParsedStreams, NetError> {
        self.note("streams", &[upstream, types], Some(dispatch))?;
        Ok(ParsedStreams::default())
    }

    async fn stream_series(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<StreamDto>, NetError> {
        self.note("stream_series", &[upstream, types], Some(dispatch))?;
        Ok(Vec::new())
    }

    async fn streams_bytes(
        &self,
        upstream: &str,
        types: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<u8>, NetError> {
        self.note("streams_bytes", &[upstream, types], Some(dispatch))?;
        Ok(b"[]".to_vec())
    }

    async fn altitude(
        &self,
        upstream: &str,
        dispatch: Dispatch,
    ) -> Result<Option<ParsedStreams>, NetError> {
        self.note("altitude", &[upstream], Some(dispatch))?;
        Ok(None)
    }

    async fn time_stream(&self, upstream: &str, dispatch: Dispatch) -> Result<Vec<u32>, NetError> {
        self.note("time_stream", &[upstream], Some(dispatch))?;
        Ok(Vec::new())
    }

    async fn original_file(&self, upstream: &str, dispatch: Dispatch) -> Result<Vec<u8>, NetError> {
        self.note("original_file", &[upstream], Some(dispatch))?;
        Ok(Vec::new())
    }

    async fn intervals_body(&self, upstream: &str, dispatch: Dispatch) -> Result<String, NetError> {
        self.note("intervals_body", &[upstream], Some(dispatch))?;
        Ok(intervals_body().to_string())
    }

    async fn calendar(
        &self,
        oldest: &str,
        newest: &str,
        dispatch: Dispatch,
    ) -> Result<Vec<(String, String, String)>, NetError> {
        self.note("calendar", &[oldest, newest], Some(dispatch))?;
        Ok(Vec::new())
    }

    async fn power_curves(
        &self,
        sport: &str,
        curves: &str,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        self.note("power_curves", &[sport, curves], Some(dispatch))?;
        Ok(curve_body().to_string())
    }

    async fn pace_curves(
        &self,
        sport: &str,
        curves: &str,
        gap: bool,
        dispatch: Dispatch,
    ) -> Result<String, NetError> {
        let gap = gap.to_string();
        self.note("pace_curves", &[sport, curves, &gap], Some(dispatch))?;
        Ok(curve_body().to_string())
    }
}

fn signed_in() -> SyncService {
    let svc = SyncService::new();
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    assert!(svc.try_begin());
    svc
}

fn run(svc: &SyncService, source: &FakeSource<'_>) {
    crate::runtime::block_on(perform_sync_from(
        svc,
        crate::persistence::engine_install(),
        source,
        false,
    ));
}

fn call(
    method: &'static str,
    args: &[&str],
    dispatch: Option<Dispatch>,
    step: FfiSyncStep,
) -> Call {
    Call {
        method,
        args: args.iter().map(|a| a.to_string()).collect(),
        dispatch,
        step: Some(step),
    }
}

/// A Ride and a Run on the fixture's day, so the curve step asks more than
/// one key.
fn two_sports(source: &mut FakeSource<'_>) {
    let mut census = census_body();
    let mut run = census[0].clone();
    run["id"] = json!("a2");
    census.as_array_mut().expect("census").push(run);
    source.census = census;
    let mut activities = activities_body();
    let mut run = activities[0].clone();
    run["id"] = json!("a2");
    run["type"] = json!("Run");
    activities.as_array_mut().expect("activities").push(run);
    source.activities = activities;
}

#[test]
fn the_calls_come_in_step_order_with_their_arguments_and_lanes() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_order.db");
    let svc = signed_in();
    let source = FakeSource::new(&svc);

    run(&svc, &source);

    let today = chrono::Local::now().date_naive().to_string();
    let calls = source.calls();
    let wellness = calls
        .iter()
        .find(|c| c.method == "wellness")
        .expect("a wellness call");
    assert_eq!(wellness.args[1], today, "wellness runs through today");
    let day = ride_day();
    let expected = vec![
        call("athlete", &[], Some(PROFILE_SLICE), FfiSyncStep::Athlete),
        call(
            "sport_settings",
            &[],
            Some(PROFILE_SLICE),
            FfiSyncStep::Athlete,
        ),
        call(
            "fitness_model_events",
            &[],
            Some(PROFILE_SLICE),
            FfiSyncStep::Athlete,
        ),
        call(
            "wellness",
            &[&wellness.args[0], &today],
            Some(SYNC_REQUEST),
            FfiSyncStep::Wellness,
        ),
        call("census", &[&today], Some(SYNC_REQUEST), FfiSyncStep::Census),
        call(
            "activities",
            &[&day, &day, "true", "None"],
            Some(SYNC_REQUEST),
            FfiSyncStep::Activities,
        ),
        call("bulk", &["a1"], Some(SYNC_REQUEST), FfiSyncStep::Activities),
        call(
            "activity_body",
            &["a1"],
            Some(SYNC_REQUEST),
            FfiSyncStep::Activities,
        ),
        call(
            "streams_body",
            &["a1", DETAIL_STREAM_TYPES_KEY],
            Some(SYNC_REQUEST),
            FfiSyncStep::Activities,
        ),
        call(
            "intervals_body",
            &["a1"],
            Some(SYNC_REQUEST),
            FfiSyncStep::Activities,
        ),
        call(
            "calendar",
            &[&calendar_window().0, &calendar_window().1],
            Some(PROFILE_SLICE),
            FfiSyncStep::Calendar,
        ),
        call(
            "power_curves",
            &["Ride", &every_curve_window()],
            Some(Dispatch::from(Lane::Backfill)),
            FfiSyncStep::Curves,
        ),
    ];
    assert_eq!(calls, expected);
    let s = svc.snapshot();
    assert_eq!(s.state, SyncState::Idle);
    assert_eq!(s.completed, SYNC_STEPS);
    assert_eq!(s.last_error, None);
}

#[test]
fn a_profile_carrying_its_sport_settings_asks_for_none() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_embedded.db");
    let svc = signed_in();
    let mut source = FakeSource::new(&svc);
    source.profile = json!({"id": "i1", "name": "Ada", "sportSettings": []});

    run(&svc, &source);

    let methods = source.methods();
    assert_eq!(&methods[..2], ["athlete", "fitness_model_events"]);
    assert!(!methods.contains(&"sport_settings"));
}

#[test]
fn a_current_stored_profile_is_not_asked_for_and_every_step_still_counts() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_profile_current.db");
    let first = signed_in();
    run(&first, &FakeSource::new(&first));

    let svc = signed_in();
    let source = FakeSource::new(&svc);
    run(&svc, &source);

    let methods = source.methods();
    assert!(!methods.contains(&"athlete"), "{methods:?}");
    assert!(!methods.contains(&"sport_settings"), "{methods:?}");
    assert_eq!(svc.snapshot().completed, SYNC_STEPS);
}

#[test]
fn a_401_on_the_census_confirmed_parks_the_service() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_census_401.db");
    let svc = signed_in();
    let mut source = FakeSource::new(&svc);
    source.refuse = Some("census");
    source.rejected = true;

    run(&svc, &source);

    assert_eq!(
        source.methods(),
        [
            "athlete",
            "sport_settings",
            "fitness_model_events",
            "wellness",
            "census",
            "confirm_rejected"
        ]
    );
    assert_eq!(svc.snapshot().state, SyncState::AuthExpired);
    assert_eq!(
        svc.claim_slot().err(),
        Some(FfiStartOutcome::NotConfigured),
        "the latch refuses the next run"
    );
}

#[test]
fn a_401_on_the_census_not_confirmed_ends_idle_without_the_latch() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_census_401_once.db");
    let svc = signed_in();
    let mut source = FakeSource::new(&svc);
    source.refuse = Some("census");
    source.rejected = false;

    run(&svc, &source);

    assert_eq!(source.methods().last(), Some(&"confirm_rejected"));
    let s = svc.snapshot();
    assert_eq!(s.state, SyncState::Idle);
    assert_eq!(s.last_error_reason, Some(FfiSyncErrorReason::Unauthorized));
    assert!(svc.claim_slot().is_ok(), "no latch on one refusal");
}

#[test]
fn a_401_on_the_detail_body_still_asks_the_activitys_other_bodies() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_detail_401.db");
    let svc = signed_in();
    let mut source = FakeSource::new(&svc);
    source.refuse = Some("activity_body");
    source.rejected = true;

    run(&svc, &source);

    let methods = source.methods();
    let detail = methods
        .iter()
        .position(|m| *m == "activity_body")
        .expect("a detail call");
    assert_eq!(
        &methods[detail..],
        [
            "activity_body",
            "streams_body",
            "intervals_body",
            "confirm_rejected"
        ]
    );
}

#[test]
fn a_401_on_the_first_curve_asks_no_second() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_curve_401.db");
    let svc = signed_in();
    let mut source = FakeSource::new(&svc);
    two_sports(&mut source);
    source.refuse = Some("power_curves");
    source.rejected = true;

    run(&svc, &source);

    let methods = source.methods();
    let curve = methods
        .iter()
        .position(|m| m.ends_with("_curves"))
        .expect("a curve call");
    assert_eq!(&methods[curve..], ["power_curves", "confirm_rejected"]);
    assert_eq!(svc.snapshot().state, SyncState::AuthExpired);
}

#[test]
fn the_fixture_with_two_sports_asks_more_than_one_curve() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_two_sports.db");
    let svc = signed_in();
    let mut source = FakeSource::new(&svc);
    two_sports(&mut source);

    run(&svc, &source);

    let curves = source
        .methods()
        .into_iter()
        .filter(|m| m.ends_with("_curves"))
        .count();
    assert!(
        curves > 1,
        "the curve 401 case needs a second curve to skip"
    );
}

#[test]
fn a_cancel_inside_the_census_asks_nothing_after_it() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_cancel.db");
    let svc = signed_in();
    let mut source = FakeSource::new(&svc);
    source.during_census = DuringCensus::Cancel;

    run(&svc, &source);

    assert_eq!(source.methods().last(), Some(&"census"));
}

#[test]
fn a_sign_out_inside_the_census_asks_nothing_after_it() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_source_sign_out.db");
    let svc = signed_in();
    let mut source = FakeSource::new(&svc);
    source.during_census = DuringCensus::SignOut;

    run(&svc, &source);

    assert_eq!(source.methods().last(), Some(&"census"));
}
