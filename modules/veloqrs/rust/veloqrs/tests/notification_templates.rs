//! The notification templates a push handler formats with, held where a
//! process that has never run JavaScript can read them.
//!
//! `set_name_translations` is the precedent and it is the wrong half: it puts
//! two resolved words in a process global, so a handler woken with the app
//! killed reads nothing. These fifteen go to the settings table, which is why
//! the durability case below is the one that matters.
//!
//! Run: `cargo test --test notification_templates -p veloqrs`

use std::path::PathBuf;

use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn open(dir: &TempDir) -> (PathBuf, PersistentEngine) {
    let path = dir.path().join("templates.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    (path, engine)
}

fn pairs(values: &[(&str, &str)]) -> Vec<(String, String)> {
    values
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
}

/// The fifteen keys the body builder needs: the twelve under
/// `notifications.activityBody` and the three titles.
fn japanese() -> Vec<(String, String)> {
    pairs(&[
        ("notifications.activityBody.aSection", "セクション"),
        ("notifications.activityBody.routePr", "{{name}}で自己ベスト"),
        (
            "notifications.activityBody.routePrDelta",
            "{{name}}で自己ベスト（{{delta}}短縮）",
        ),
        (
            "notifications.activityBody.routePrUnnamed",
            "ルート自己ベスト",
        ),
        (
            "notifications.activityBody.routePrUnnamedDelta",
            "ルート自己ベスト（{{delta}}短縮）",
        ),
        (
            "notifications.activityBody.sectionPr",
            "{{name}}で自己ベスト",
        ),
        (
            "notifications.activityBody.sectionPrDelta",
            "{{name}}で自己ベスト（{{delta}}短縮）",
        ),
        (
            "notifications.activityBody.sectionPrCount",
            "{{count}}個のセクションで自己ベスト",
        ),
        (
            "notifications.activityBody.sectionPrMany",
            "{{name}}ほか{{count}}個で自己ベスト",
        ),
        (
            "notifications.activityBody.fasterOnRoute",
            "{{name}}でいつもより速い",
        ),
        (
            "notifications.activityBody.fasterOnRouteDelta",
            "{{name}}でいつもより速い（自己ベストまで{{delta}}）",
        ),
        ("notifications.activityBody.onRoute", "{{name}}を走行"),
        ("notifications.activityPr.title", "自己ベスト"),
        ("notifications.activityFaster.title", "好調"),
        (
            "notifications.activityRecorded.title",
            "アクティビティを記録",
        ),
    ])
}

#[test]
fn nothing_is_held_before_the_first_push() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);

    assert!(
        engine.notification_templates().expect("read").is_none(),
        "the engine answered templates it was never given"
    );
}

#[test]
fn every_template_pushed_comes_back_under_its_locale() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);

    assert!(
        engine
            .set_notification_templates("ja", &japanese())
            .expect("push"),
        "the first push wrote nothing"
    );

    let held = engine
        .notification_templates()
        .expect("read")
        .expect("held");
    assert_eq!(held.locale, "ja");
    assert_eq!(held.templates.len(), 15);
    assert_eq!(
        held.templates
            .get("notifications.activityBody.routePrDelta")
            .map(String::as_str),
        Some("{{name}}で自己ベスト（{{delta}}短縮）")
    );
    assert_eq!(
        held.templates
            .get("notifications.activityRecorded.title")
            .map(String::as_str),
        Some("アクティビティを記録")
    );
}

#[test]
fn a_second_push_of_the_same_bundle_writes_nothing() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);
    engine
        .set_notification_templates("ja", &japanese())
        .expect("seed");

    assert!(
        !engine
            .set_notification_templates("ja", &japanese())
            .expect("push"),
        "an unchanged bundle was rewritten, so every launch pays a commit"
    );
}

#[test]
fn a_locale_change_leaves_none_of_the_previous_bundle() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);
    engine
        .set_notification_templates("ja", &japanese())
        .expect("seed");

    engine
        .set_notification_templates(
            "en-AU",
            &pairs(&[("notifications.activityBody.onRoute", "On {{name}}")]),
        )
        .expect("push");

    let held = engine
        .notification_templates()
        .expect("read")
        .expect("held");
    assert_eq!(held.locale, "en-AU");
    assert_eq!(
        held.templates.len(),
        1,
        "a key from the previous locale survived the change"
    );
    assert_eq!(
        held.templates
            .get("notifications.activityBody.onRoute")
            .map(String::as_str),
        Some("On {{name}}")
    );
}

/// The case the process-global precedent cannot serve: a handler woken in a
/// process that has never run JavaScript opens the same file and reads what
/// the last push wrote.
#[test]
fn a_fresh_engine_on_the_same_file_reads_the_last_push() {
    let dir = TempDir::new().unwrap();
    let (path, engine) = open(&dir);
    engine
        .set_notification_templates("ja", &japanese())
        .expect("seed");
    drop(engine);

    let reopened = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    let held = reopened
        .notification_templates()
        .expect("read")
        .expect("held");

    assert_eq!(held.locale, "ja");
    assert_eq!(held.templates.len(), 15);
}

#[test]
fn an_empty_bundle_is_refused_rather_than_stored() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);
    engine
        .set_notification_templates("ja", &japanese())
        .expect("seed");

    assert!(
        engine.set_notification_templates("en-AU", &[]).is_err(),
        "an empty bundle was stored, so a handler would format with nothing"
    );
    let held = engine
        .notification_templates()
        .expect("read")
        .expect("held");
    assert_eq!(held.locale, "ja", "the refused push replaced the bundle");
}
