//! Scenario: each on-demand verb's work, and the credential check, driven over
//! a source that records what it was asked.
//!
//! Expected behaviour: a verb makes one call, naming the activity by its id
//! upstream, on the lane a tap or a sweep asks on, and an activity with no id
//! upstream asks nothing.

use super::*;
use crate::net::recording_source::{RecordingSource, asked};
use crate::persistence::with_persistent_engine;
use crate::test_globals::{init_global_engine, serial_global_state};
use tracematch::GpsPoint;

/// A key minted on this device that no upload has named.
const UNNAMED: &str = "local-ab12";

fn run(job: impl std::future::Future<Output = Result<(), NetError>>) {
    crate::runtime::block_on(job).expect("the job settles");
}

#[test]
fn a_power_curve_asks_the_curves_once_on_the_tap_lane() {
    let _serial = serial_global_state();
    let _engine = init_global_engine("verbs_power.db");
    let source = RecordingSource::new();

    run(power_curve_job(
        crate::persistence::engine_install(),
        &source,
        "Ride".into(),
        42,
    ));

    assert_eq!(
        source.calls(),
        vec![asked(
            "power_curves",
            &["Ride", &curve_window(42)],
            Lane::Interactive
        )]
    );
}

#[test]
fn a_pace_curve_asks_the_curves_once_with_its_gap() {
    let _serial = serial_global_state();
    let _engine = init_global_engine("verbs_pace.db");
    let source = RecordingSource::new();

    run(pace_curve_job(
        crate::persistence::engine_install(),
        &source,
        "Run".into(),
        42,
        true,
    ));

    assert_eq!(
        source.calls(),
        vec![asked(
            "pace_curves",
            &["Run", &curve_window(42), "true"],
            Lane::Interactive
        )]
    );
}

#[test]
fn an_activity_body_verb_asks_once_by_its_upstream_id() {
    let _serial = serial_global_state();
    let _engine = init_global_engine("verbs_bodies.db");
    let install = crate::persistence::engine_install();

    let source = RecordingSource::new();
    run(activity_intervals_job(install, &source, "a1".into()));
    assert_eq!(
        source.calls(),
        vec![asked("intervals_body", &["a1"], Lane::Interactive)]
    );

    let source = RecordingSource::new();
    run(activity_streams_job(
        install,
        &source,
        "a1".into(),
        "watts".into(),
    ));
    assert_eq!(
        source.calls(),
        vec![asked("streams_body", &["a1", "watts"], Lane::Interactive)]
    );

    let mut source = RecordingSource::new();
    source.activity_body =
        r#"{"id":"a1","start_date_local":"2026-01-02T08:00:00","type":"Ride"}"#.into();
    run(activity_detail_job(install, &source, "a1".into()));
    assert_eq!(
        source.calls(),
        vec![asked("activity_body", &["a1"], Lane::Interactive)]
    );
}

#[test]
fn an_activity_with_no_upstream_id_asks_nothing() {
    let _serial = serial_global_state();
    let _engine = init_global_engine("verbs_unnamed.db");
    let install = crate::persistence::engine_install();
    let source = RecordingSource::new();

    run(activity_intervals_job(install, &source, UNNAMED.into()));
    run(activity_streams_job(
        install,
        &source,
        UNNAMED.into(),
        "watts".into(),
    ));
    run(activity_detail_job(install, &source, UNNAMED.into()));

    assert_eq!(source.calls(), Vec::new());
}

#[test]
fn the_time_streams_ask_each_missing_clock_once_on_the_sweep_lane() {
    let _serial = serial_global_state();
    let _engine = init_global_engine("verbs_time.db");
    let line: Vec<GpsPoint> = (0..8)
        .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
        .collect();
    with_persistent_engine(|engine| {
        engine
            .add_activity("a1".into(), line, "Ride".into())
            .expect("add activity");
    })
    .expect("engine");
    SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "k".into(), "i1".into());
    let mut source = RecordingSource::new();
    source.time_stream = (0..8).map(|i| i * 10).collect();

    run(time_streams_job(
        crate::persistence::engine_install(),
        &source,
        vec!["a1".into(), UNNAMED.into()],
    ));
    SYNC_SERVICE.clear_credentials();

    assert_eq!(
        source.calls(),
        vec![asked("time_stream", &["a1"], Lane::Backfill)]
    );
}

#[test]
fn the_credential_check_asks_the_current_athlete_on_the_tap_lane() {
    let mut source = RecordingSource::new();
    source.account = "i7".into();

    let athlete = crate::runtime::block_on(credential_athlete(&source));

    assert_eq!(athlete.expect("an answer"), Some("i7".to_string()));
    assert_eq!(
        source.calls(),
        vec![asked("current_athlete", &[], Lane::Interactive)]
    );
}

/// Scenario: a ride recorded here and uploaded is opened by the id the server
/// gave it, as a card, a notification or a deep link may name it.
///
/// Expected behaviour: the detail body lands on the row that claims that id,
/// so the ride keeps one body and one metrics row rather than gaining a
/// second under the server's id.
#[test]
fn a_detail_opened_by_the_server_id_lands_on_the_row_that_claims_it() {
    let _serial = serial_global_state();
    let _engine = init_global_engine("verbs_detail_claimed.db");
    let install = crate::persistence::engine_install();
    with_persistent_engine(|engine| {
        engine
            .upsert_activity_bodies_with_metrics(&[(
                "local-ride-1".into(),
                1_767_340_800,
                r#"{"id":"local-ride-1","start_date_local":"2026-01-02T08:00:00","type":"Ride"}"#
                    .into(),
            )])
            .expect("provisional body");
        assert!(engine.record_upload("local-ride-1", "i900").unwrap());
    })
    .expect("engine");
    let mut source = RecordingSource::new();
    source.activity_body =
        r#"{"id":"i900","start_date_local":"2026-01-02T08:00:00","type":"Ride","icu_athlete_id":"i1"}"#
            .into();

    run(activity_detail_job(install, &source, "i900".into()));

    assert_eq!(
        source.calls(),
        vec![asked("activity_body", &["i900"], Lane::Interactive)]
    );
    let keys = |table: &str| -> Vec<String> {
        with_persistent_engine(|engine| {
            let mut stmt = engine
                .db
                .prepare(&format!(
                    "SELECT activity_id FROM {table} ORDER BY activity_id"
                ))
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        })
        .expect("engine")
    };
    assert_eq!(keys("activity_bodies"), vec!["local-ride-1".to_string()]);
    assert_eq!(keys("activity_metrics"), vec!["local-ride-1".to_string()]);
    assert_eq!(
        with_persistent_engine(|engine| engine.get_activity_body("local-ride-1"))
            .expect("engine")
            .as_deref(),
        Some(
            r#"{"id":"i900","start_date_local":"2026-01-02T08:00:00","type":"Ride","icu_athlete_id":"i1"}"#
        )
    );
}
