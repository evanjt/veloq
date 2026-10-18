use super::super::*;

use crate::fit::FitExerciseSet;
use crate::objects::strength::aggregate_strength_sets;
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
        exercise_sets: Vec::new(),
    }
}

const BENCH_PRESS: u16 = 0;
const SQUAT: u16 = 28;

/// A gym session seven days before the clock: bench and squats.
fn gym_session() -> (String, Vec<(String, FitExerciseSet)>) {
    let start = NOW - 7 * 86_400;
    let body = format!(
        r#"{{"id":"sample-gym","name":"Gym","type":"WeightTraining","start_date_local":"{}","moving_time":3600,"elapsed_time":3600,"icu_training_load":40.0}}"#,
        chrono::DateTime::from_timestamp(start, 0)
            .expect("a time")
            .format("%Y-%m-%dT%H:%M:%S")
    );
    let sets = [(BENCH_PRESS, 3, 60.0), (SQUAT, 5, 80.0)]
        .into_iter()
        .flat_map(|(category, count, weight_kg)| std::iter::repeat_n((category, weight_kg), count))
        .enumerate()
        .map(|(order, (category, weight_kg))| {
            (
                "sample-gym".to_string(),
                FitExerciseSet {
                    set_order: order as u32,
                    exercise_category: category,
                    exercise_name: None,
                    set_type: 0,
                    repetitions: Some(5),
                    weight_kg: Some(weight_kg),
                    duration_secs: None,
                    start_time: None,
                },
            )
        })
        .collect();
    (body, sets)
}

fn context() -> FfiWidgetContext {
    FfiWidgetContext {
        locale: "en".to_string(),
        is_metric: true,
        strings: [("demo.banner", "Sample Mode")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        ..FfiWidgetContext::default()
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
    let ctx = FfiWidgetContext {
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
    let ctx = FfiWidgetContext {
        sample: true,
        ..context()
    };
    crate::persistence::with_persistent_engine(|engine| engine.set_widget_context(&ctx))
        .expect("the engine")
        .expect("the write");

    assert!(native_snapshot_json().is_none());
    assert!(native_snapshot_json_as_of_last_sync().is_none());
}

/// Scenario: nobody is signed in and the sample library holds a gym session a
/// week back, with its sets.
///
/// Expected behaviour: the sample snapshot's strength block draws that session
/// on the body, each muscle shaded as the strength tab shades the same sets,
/// rather than an empty body under the demo label.
#[test]
fn a_sample_library_draws_its_strength_sets_on_the_body() {
    let (body, sets) = gym_session();
    let mut library = library();
    library
        .activities
        .push(("sample-gym".to_string(), NOW - 7 * 86_400, body));
    library.exercise_sets = sets.clone();

    let json = sample_snapshot_json(&library, &context(), CLOCK).expect("a snapshot");
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("JSON");

    assert_eq!(snapshot["demo"], true);
    let last30 = &snapshot["strength"]["windows"]["last30"];
    let mut drawn: Vec<(String, u64)> = last30["muscles"]
        .as_array()
        .expect("muscles")
        .iter()
        .map(|m| {
            (
                m["slug"].as_str().expect("a slug").to_string(),
                m["shade"].as_u64().expect("a shade"),
            )
        })
        .collect();
    drawn.sort();
    let mut expected: Vec<(String, u64)> = aggregate_strength_sets(&sets)
        .muscle_volumes
        .iter()
        .map(|m| (m.slug.clone(), u64::from(m.shade)))
        .collect();
    expected.sort();

    assert!(!expected.is_empty());
    assert_eq!(drawn, expected);
    assert_eq!(last30["activityCount"], 1);
    assert_eq!(last30["totalSets"], 8);
    assert_eq!(last30["owedCount"], 0);
}
