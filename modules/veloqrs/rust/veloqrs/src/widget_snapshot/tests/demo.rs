use super::super::*;

use crate::persistence::wellness::WellnessRow;

// Midnight plus 53 minutes on the wall clock, the same instant the other
// snapshot tests compose at.
const NOW: i64 = 1_733_360_000;

const CLOCK: Clock = Clock {
    now_seconds: NOW,
    now_wall_seconds: NOW,
};

fn library() -> SampleLibrary {
    let day = |offset: i64| {
        chrono::DateTime::from_timestamp(NOW - offset * 86_400, 0)
            .expect("a date")
            .date_naive()
            .to_string()
    };
    SampleLibrary {
        athlete_json: r#"{"id":"sample","name":"Sample Athlete"}"#.to_string(),
        sport_settings_json: "[]".to_string(),
        wellness: (0..14)
            .rev()
            .map(|offset| WellnessRow {
                date: day(offset),
                ctl: Some(60.0 + (14 - offset) as f64),
                atl: Some(70.0),
                ramp_rate: Some(1.0),
                hrv: Some(55.0),
                resting_hr: Some(48.0),
                weight: None,
                sleep_secs: None,
                sleep_score: None,
                soreness: None,
                fatigue: None,
                stress: None,
                mood: None,
                motivation: None,
                raw: None,
            })
            .collect(),
        activities: vec![(
            "sample-1".to_string(),
            NOW - 3_000,
            format!(
                r#"{{"id":"sample-1","name":"Lunch Loop","type":"Ride","start_date_local":"{}","distance":42195.0,"moving_time":5400,"elapsed_time":5600,"total_elevation_gain":310.0,"icu_training_load":88.0}}"#,
                chrono::DateTime::from_timestamp(NOW - 3_000, 0)
                    .expect("a time")
                    .format("%Y-%m-%dT%H:%M:%S")
            ),
        )],
    }
}

fn context() -> WidgetContext {
    WidgetContext {
        locale: "en".to_string(),
        is_metric: true,
        strings: [("demo.banner", "Sample Mode")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        ..WidgetContext::default()
    }
}

/// Scenario: no account is signed in, so the widgets have no library of their
/// own to draw.
///
/// Expected behaviour: the snapshot is composed from the sample library, carries
/// the demo mark and its label, and has real numbers rather than the empty
/// prompt.
#[test]
fn a_sample_library_composes_a_marked_snapshot_with_numbers() {
    let json = sample_snapshot_json(&library(), &context(), CLOCK).expect("a snapshot");
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("JSON a widget can read");

    assert_eq!(snapshot["demo"], true);
    assert_eq!(snapshot["display"]["demoLabel"], "Sample Mode");
    assert_eq!(snapshot["emptyLibrary"], false);
    assert_eq!(snapshot["latest"]["name"], "Lunch Loop");
    assert!(snapshot["metrics"]["fitness"]["value"].as_f64().unwrap() > 0.0);
}

/// Expected behaviour: a context that says demo marks a snapshot composed from
/// the stored library, which is how demo mode labels its widgets.
#[test]
fn a_demo_context_marks_a_snapshot_of_the_stored_library() {
    let engine = crate::persistence::PersistentEngine::in_memory().expect("an engine");
    let ctx = WidgetContext {
        demo: true,
        ..context()
    };
    let json = snapshot_json(&engine.db, &ctx, CLOCK);
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("JSON");
    assert_eq!(snapshot["demo"], true);
    assert_eq!(snapshot["display"]["demoLabel"], "Sample Mode");
}

/// Expected behaviour: a snapshot of a stored library carries no mark and no
/// label, so a signed-in athlete's widgets never wear the demo words.
#[test]
fn a_snapshot_of_a_stored_library_is_not_marked() {
    let engine = crate::persistence::PersistentEngine::in_memory().expect("an engine");
    let json = snapshot_json(&engine.db, &context(), CLOCK);
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("JSON");
    assert!(snapshot.get("demo").is_none());
    assert!(snapshot["display"].get("demoLabel").is_none());
}

/// Scenario: nobody is signed in and the app has stored the context of the
/// sample it wrote, while the engine still holds the previous athlete's rows
/// from a sign-out that kept them.
///
/// Expected behaviour: a native refresh composes nothing, so the sample file
/// stands and the previous athlete's rides are not redrawn over it.
#[test]
fn a_native_refresh_leaves_a_sample_file_standing() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_sample.db");
    let ctx = WidgetContext {
        sample: true,
        ..context()
    };
    let json = serde_json::to_string(&ctx).expect("the context");
    crate::persistence::with_persistent_engine(|engine| engine.set_widget_context(&json))
        .expect("the engine")
        .expect("the write");

    assert!(native_snapshot_json().is_none());
    assert!(native_snapshot_json_as_of_last_sync().is_none());
}
