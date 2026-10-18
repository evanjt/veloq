//! The widget context crosses the FFI as a typed record, and the row the
//! engine stores it in stays readable for a context written as JSON before.

use super::FitnessManager;
use crate::persistence::settings::settings_keys::WIDGET_CONTEXT;
use crate::persistence::wellness::WellnessRow;
use crate::test_globals::{init_global_engine, serial_global_state};
use crate::widget_snapshot::{
    Clock, FfiWidgetContext, RecordShortcut, WidgetInsight, WidgetPalette, WidgetTheme,
};

fn context() -> FfiWidgetContext {
    FfiWidgetContext {
        locale: "en-GB".to_string(),
        is_metric: true,
        form_as_percent: true,
        strings: [
            ("metrics.form", "Form"),
            ("systemSurfaces.spoken.tonePositive", "Positive"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect(),
        theme: WidgetTheme {
            light: Some(WidgetPalette {
                background: "#F4F1EA".to_string(),
                strength_ramp: vec!["#E0E7FF".to_string(), "#6366F1".to_string()],
                ..WidgetPalette::default()
            }),
            dark: Some(WidgetPalette {
                background: "#101418".to_string(),
                ..WidgetPalette::default()
            }),
        },
        record_shortcuts: vec![RecordShortcut {
            r#type: "Kayak".to_string(),
            label: "Kayak".to_string(),
            url: "veloq://recording/Kayak?from=quickstart".to_string(),
            glyph: "water".to_string(),
        }],
        insights: vec![WidgetInsight {
            id: "pr-1".to_string(),
            category: "section_pr".to_string(),
            title: "New record".to_string(),
            subtitle: "Lighthouse climb".to_string(),
            icon: "trophy".to_string(),
            tone: "positive".to_string(),
            url: "veloq://section/s1".to_string(),
        }],
        ..FfiWidgetContext::default()
    }
}

/// The same context as the app wrote it before the record, as a JSON string.
const STORED_ROW: &str = r##"{"locale":"en-GB","isMetric":true,"formAsPercent":true,"strings":{"metrics.form":"Form","systemSurfaces.spoken.tonePositive":"Positive"},"dates":{"weekdays":[],"monthDay":{"parts":[],"months":[]},"monthDayYear":{"parts":[],"months":[]},"months":[]},"numbers":{"decimal":"","group":"","minimumGroupingDigits":0},"summaryCard":null,"theme":{"light":{"background":"#F4F1EA","strengthRamp":["#E0E7FF","#6366F1"]},"dark":{"background":"#101418"}},"recordShortcuts":[{"type":"Kayak","label":"Kayak","url":"veloq://recording/Kayak?from=quickstart","glyph":"water"}],"launcherShortcuts":[],"insights":[{"id":"pr-1","category":"section_pr","title":"New record","subtitle":"Lighthouse climb","icon":"trophy","tone":"positive","url":"veloq://section/s1"}],"demo":false,"sample":false}"##;

fn store_today_form() {
    crate::with_persistent_engine(|engine| {
        engine
            .upsert_wellness(&[WellnessRow {
                date: crate::persistence::wellness::today_iso(),
                ctl: Some(50.0),
                atl: Some(60.0),
                ramp_rate: None,
                hrv: None,
                resting_hr: None,
                weight: None,
                sleep_secs: None,
                sleep_score: None,
                soreness: None,
                fatigue: None,
                stress: None,
                mood: None,
                motivation: None,
                raw: None,
            }])
            .expect("the wellness");
    })
    .expect("the engine");
}

fn compose(ctx: FfiWidgetContext, clock: Clock) -> serde_json::Value {
    let json = FitnessManager::new()
        .compose_widget_snapshot(
            ctx,
            clock.now_seconds as f64,
            clock.now_wall_seconds as f64,
            None,
        )
        .expect("a snapshot");
    serde_json::from_str(&json).expect("JSON a widget can read")
}

/// Scenario: the athlete reads form as a share of fitness and has one insight.
///
/// Expected behaviour: the snapshot draws form as a percentage and lists the
/// insight, with its spoken tone composed here, and carries the palette and the
/// shortcut's glyph through.
#[test]
fn the_composed_snapshot_carries_what_the_record_holds() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_context_record.db");
    store_today_form();

    let snapshot = compose(context(), Clock::now());

    assert_eq!(snapshot["metrics"]["form"]["text"], "-20%");
    assert_eq!(snapshot["insights"].as_array().map(Vec::len), Some(1));
    assert_eq!(snapshot["insights"][0]["id"], "pr-1");
    assert_eq!(snapshot["insights"][0]["toneLabel"], "Positive");
    assert_eq!(snapshot["theme"]["light"]["background"], "#F4F1EA");
    assert_eq!(snapshot["theme"]["light"]["strengthRamp"][1], "#6366F1");
    assert_eq!(snapshot["theme"]["dark"]["background"], "#101418");
    assert_eq!(snapshot["recordShortcuts"][0]["glyph"], "water");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the app stored its context as a JSON string before the upgrade,
/// then a ride is pushed before the app has run again.
///
/// Expected behaviour: the worker composes from that row the snapshot the app
/// composes from the same context as a record.
#[test]
fn a_context_row_stored_as_json_composes_the_same_snapshot() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_context_upgrade.db");
    store_today_form();
    crate::with_persistent_engine(|engine| {
        engine
            .set_setting(WIDGET_CONTEXT, STORED_ROW)
            .expect("the write");
    })
    .expect("the engine");

    let clock = Clock::now();
    let mut from_row: serde_json::Value = serde_json::from_str(
        &crate::widget_snapshot::native_snapshot_json().expect("a snapshot from the row"),
    )
    .expect("JSON");
    let mut from_record = compose(context(), clock);
    from_row["generatedAt"] = serde_json::Value::Null;
    from_record["generatedAt"] = serde_json::Value::Null;

    assert_eq!(from_row, from_record);
    assert_eq!(from_row["metrics"]["form"]["text"], "-20%");
    crate::persistence::clear_persistent_engine();
}

/// Scenario: the app hands the same context over on every refresh, then the
/// athlete changes a unit.
///
/// Expected behaviour: the first and the changed context are written, the
/// repeat is not, and the stored row reads back as the record handed over.
#[test]
fn the_record_is_stored_once_per_change_and_reads_back() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("widget_context_store.db");
    let fitness = FitnessManager::new();

    assert!(fitness.set_widget_context(context()).expect("the write"));
    assert!(!fitness.set_widget_context(context()).expect("the repeat"));
    let stored = crate::persistence::read_pool::with_read_conn(|conn| {
        crate::widget_snapshot::stored_context(conn)
    })
    .flatten();
    assert_eq!(stored, Some(context()));

    let changed = FfiWidgetContext {
        is_metric: false,
        ..context()
    };
    assert!(fitness.set_widget_context(changed).expect("the change"));
    crate::persistence::clear_persistent_engine();
}
