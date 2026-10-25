//! Scenario: each write driven over a source that records what it was asked,
//! through the same credential step the live writes take.
//!
//! Expected behaviour: the write reaches the source with what the caller gave
//! it, unchanged, and the id the source answers comes back; a credential that
//! belongs to another athlete sends nothing.

use super::*;
use crate::net::recording_source::{RecordingSource, asked};

fn indoor_entry() -> ManualActivityBody {
    ManualActivityBody {
        activity_type: "VirtualRide".into(),
        name: "Lunch spin".into(),
        start_date_local: "2026-03-04T12:00:00".into(),
        elapsed_time: 3600,
        moving_time: Some(3500),
        distance: Some(30_000.0),
        total_elevation_gain: None,
        average_heartrate: Some(141.0),
        description: Some("legs heavy".into()),
        trainer: true,
        commute: false,
        external_id: Some("rec-7".into()),
    }
}

#[test]
fn a_manual_entry_reaches_the_source_create_with_its_body_unchanged() {
    let source = RecordingSource::new();
    let activity = indoor_entry();
    let body = serde_json::to_string(&activity).expect("the entry serialises");

    let outcome = crate::runtime::block_on(write_with(
        source.clone(),
        Some("i1".into()),
        move |s| async move { manual_activity_job(&s, &activity).await },
    ));

    assert_eq!(outcome.kind, FfiCallKind::Ok, "{}", outcome.message);
    assert_eq!(outcome.id.as_deref(), Some("a9"));
    assert_eq!(
        source.calls(),
        vec![asked("create_activity", &[&body], Lane::Interactive)]
    );
}

#[test]
fn a_credential_for_another_athlete_sends_nothing() {
    let source = RecordingSource::new();
    let activity = indoor_entry();

    let outcome = crate::runtime::block_on(write_with(
        source.clone(),
        Some("i2".into()),
        move |s| async move { manual_activity_job(&s, &activity).await },
    ));

    assert_eq!(outcome.kind, FfiCallKind::OtherAthlete);
    assert_eq!(source.calls(), Vec::new());
}

#[test]
fn an_upload_reaches_the_source_with_its_file_and_details() {
    let source = RecordingSource::new();

    let outcome = crate::runtime::block_on(write_with(source.clone(), None, move |s| async move {
        upload_file_job(
            &s,
            "/rides/r.fit",
            "r.fit",
            endpoints::UploadDetails {
                external_id: Some("rec-7"),
                name: Some("Hill reps"),
                description: None,
                paired_event_id: Some(12),
                ..Default::default()
            },
        )
        .await
    }));

    assert_eq!(outcome.kind, FfiCallKind::Ok, "{}", outcome.message);
    assert_eq!(outcome.id.as_deref(), Some("a9"));
    assert_eq!(
        source.calls(),
        vec![asked(
            "upload_activity",
            &["/rides/r.fit", "r.fit", "rec-7", "Hill reps", "", "12"],
            Lane::Interactive
        )]
    );
}

#[test]
fn a_landed_lookup_hands_the_listed_window_to_the_matcher() {
    let mut source = RecordingSource::new();
    source.listed = vec![
        ListedActivity {
            id: "a1".into(),
            external_id: Some("other".into()),
            ..ListedActivity::default()
        },
        ListedActivity {
            id: "a2".into(),
            external_id: Some("rec-7".into()),
            ..ListedActivity::default()
        },
    ];

    let outcome = crate::runtime::block_on(write_with(source.clone(), None, move |s| async move {
        landed_activity_job(&s, "2026-03-03", "2026-03-05", |listed| {
            listed
                .iter()
                .find(|a| a.external_id.as_deref() == Some("rec-7"))
                .map(|a| a.id.clone())
        })
        .await
    }));

    assert_eq!(outcome.kind, FfiCallKind::Ok, "{}", outcome.message);
    assert_eq!(outcome.id.as_deref(), Some("a2"));
    assert_eq!(
        source.calls(),
        vec![asked(
            "activities_between",
            &["2026-03-03", "2026-03-05"],
            Lane::Interactive
        )]
    );
}

#[test]
fn an_effort_names_the_activity_and_answers_its_id() {
    let source = RecordingSource::new();

    let outcome = crate::runtime::block_on(write_with(source.clone(), None, move |s| async move {
        activity_rpe_job(&s, "a5".into(), 7).await
    }));

    assert_eq!(outcome.kind, FfiCallKind::Ok, "{}", outcome.message);
    assert_eq!(outcome.id.as_deref(), Some("a5"));
    assert_eq!(
        source.calls(),
        vec![asked(
            "update_activity_rpe",
            &["a5", "7"],
            Lane::Interactive
        )]
    );
}
