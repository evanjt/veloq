use super::super::*;
use crate::test_globals::serial_global_state;

fn context() -> WidgetContext {
    WidgetContext {
        locale: "fr".to_string(),
        is_metric: true,
        strings: [("metrics.form", "Forme"), ("time.today", "Aujourd'hui")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        record_shortcuts: vec![RecordShortcut {
            kind: "Ride".to_string(),
            label: "Vélo".to_string(),
            url: "veloq://recording/Ride?from=quickstart".to_string(),
        }],
        ..WidgetContext::default()
    }
}

fn store_ride(id: &str, name: &str, date: i64) {
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_activity_metrics(vec![crate::ActivityMetrics {
                activity_id: id.to_string(),
                name: name.to_string(),
                date,
                distance: 42_195.0,
                moving_time: 5_400,
                elapsed_time: 5_600,
                elevation_gain: 310.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".to_string(),
                training_load: Some(88.0),
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .expect("the metrics");
    })
    .expect("the engine");
}

fn store_context(ctx: &WidgetContext) -> bool {
    let json = serde_json::to_string(ctx).expect("the context");
    crate::persistence::with_persistent_engine(|engine| engine.set_widget_context(&json))
        .expect("the engine")
        .expect("the write")
}

/// Scenario: the app stored its context on an earlier run, then a ride is
/// pushed with the app killed and the worker stores it.
///
/// Expected behaviour: the snapshot composed with no JavaScript names the new
/// ride, in the words the app stored, so the widget shows it within a minute
/// rather than on the next launch.
#[test]
fn a_pushed_ride_is_on_the_snapshot_composed_from_the_stored_context() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_native.db");
    store_context(&context());
    store_ride("i900", "Morning Ride", Clock::now().now_wall_seconds);

    let json = native_snapshot_json().expect("a snapshot");
    let snapshot: serde_json::Value = serde_json::from_str(&json).expect("JSON a widget can read");

    assert_eq!(snapshot["latest"]["activityId"], "i900");
    assert_eq!(snapshot["latest"]["name"], "Morning Ride");
    assert_eq!(snapshot["latest"]["distanceLabel"], "42.2 km");
    assert_eq!(snapshot["latest"]["dateLabel"], "Aujourd'hui");
    assert_eq!(snapshot["emptyLibrary"], false);
    assert_eq!(snapshot["locale"], "fr");
    assert_eq!(snapshot["display"]["metricLabels"]["form"], "Forme");
    assert_eq!(snapshot["recordShortcuts"][0]["label"], "Vélo");
    assert_eq!(snapshot["schemaVersion"], SCHEMA_VERSION);
    crate::persistence::clear_persistent_engine();
}

/// Scenario: a ride is pushed on an install whose app has never stored a
/// context, so there are no words to write the snapshot in.
///
/// Expected behaviour: nothing is composed and the widget keeps the file it has.
#[test]
fn with_no_stored_context_there_is_no_snapshot_to_write() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_no_context.db");
    store_ride("i900", "Morning Ride", Clock::now().now_wall_seconds);

    assert_eq!(native_snapshot_json(), None);
    crate::persistence::clear_persistent_engine();
}

#[test]
fn with_the_engine_closed_there_is_no_snapshot_to_write() {
    let _guard = serial_global_state();
    crate::persistence::clear_persistent_engine();

    assert_eq!(native_snapshot_json(), None);
}

/// A row that no longer parses, from an older or newer build, reads as no
/// context rather than as a snapshot of keys.
#[test]
fn a_stored_context_that_does_not_parse_reads_as_none() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_bad_context.db");
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_setting(
                crate::persistence::settings::settings_keys::WIDGET_CONTEXT,
                "[1, 2",
            )
            .expect("the write");
    })
    .expect("the engine");

    assert_eq!(native_snapshot_json(), None);
    crate::persistence::clear_persistent_engine();
}

/// The app hands its context over on every refresh, so the ordinary refresh
/// that changes nothing writes nothing.
#[test]
fn storing_the_same_context_twice_writes_once() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_context_write.db");

    assert!(store_context(&context()));
    assert!(!store_context(&context()));
    let mut changed = context();
    changed.is_metric = false;
    assert!(store_context(&changed));
    crate::persistence::clear_persistent_engine();
}

/// The natives read this version to decide what a snapshot carries, so a change
/// here is a change to what they decode.
#[test]
fn the_schema_is_the_one_without_a_per_day_form_zone() {
    assert_eq!(SCHEMA_VERSION, 9);
}

/// Scenario: the library is wiped for the next athlete, then a push for them
/// arrives before the app has run.
///
/// Expected behaviour: the stored context went with the library, so the worker
/// writes no widget carrying the previous athlete's sports and settings.
#[test]
fn a_wiped_library_takes_the_stored_context_with_it() {
    let _guard = serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widget_wipe.db");
    store_context(&context());
    store_ride("i900", "Morning Ride", Clock::now().now_wall_seconds);

    crate::persistence::with_persistent_engine(|engine| engine.clear().expect("the wipe"))
        .expect("the engine");

    assert_eq!(native_snapshot_json(), None);
    crate::persistence::clear_persistent_engine();
}
