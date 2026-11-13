//! Scenario: the athlete answer is a page or an empty object, or the sport
//! settings answer is not a list, on a sync that already holds a profile.
//!
//! Expected behaviour: a body that is not a JSON object carrying the account's
//! id, or sport settings that are not a JSON array, fails the step with a
//! decode error and leaves the stored profile and sport settings as they were.
//! A valid answer after that stores both.

use super::*;
use crate::net::recording_source::RecordingSource;
use serde_json::json;

const STORED_PROFILE: &str = r#"{"id": "i1", "name": "Ada"}"#;
const STORED_SETTINGS: &str = r#"[{"types": ["Ride"], "ftp": 240}]"#;

fn seed_stored_profile() {
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_sport_settings(STORED_SETTINGS)
            .expect("seed sport settings");
        engine
            .set_athlete_profile(STORED_PROFILE)
            .expect("seed profile");
    })
    .expect("engine");
}

fn stored() -> (Option<String>, Option<String>) {
    crate::persistence::with_persistent_engine(|engine| {
        (engine.get_athlete_profile(), engine.get_sport_settings())
    })
    .expect("engine")
}

fn sync_once(source: &RecordingSource) -> Result<(), NetError> {
    crate::runtime::block_on(sync_athlete(crate::persistence::engine_install(), source))
}

fn assert_refused_and_kept(source: &RecordingSource) {
    let before = stored();

    let outcome = sync_once(source);

    assert!(
        matches!(outcome, Err(NetError::Decode(_))),
        "expected a decode error, got {outcome:?}"
    );
    assert_eq!(stored(), before);
}

#[test]
fn an_html_athlete_body_keeps_the_stored_profile_and_sport_settings() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_athlete_html.db");
    seed_stored_profile();
    let mut source = RecordingSource::new();
    source.athlete_body = "<html><body>Maintenance</body></html>".into();
    source.sport_settings_body = r#"[{"types": ["Ride"], "ftp": 999}]"#.into();

    assert_refused_and_kept(&source);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_object_athlete_body_keeps_the_stored_profile_and_sport_settings() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_athlete_empty.db");
    seed_stored_profile();
    let mut source = RecordingSource::new();
    source.athlete_body = "{}".into();
    source.sport_settings_body = r#"[{"types": ["Ride"], "ftp": 999}]"#.into();

    assert_refused_and_kept(&source);
}

#[test]
fn an_athlete_body_naming_another_athlete_keeps_the_stored_profile() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_athlete_other.db");
    seed_stored_profile();
    let mut source = RecordingSource::new();
    source.athlete_body = json!({"id": "i2", "name": "Bo", "sportSettings": []}).to_string();

    assert_refused_and_kept(&source);
}

#[test]
fn a_sport_settings_answer_that_is_not_a_list_keeps_the_stored_settings_and_profile() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_athlete_settings.db");
    seed_stored_profile();
    let mut source = RecordingSource::new();
    source.athlete_body = json!({"id": "i1", "name": "Bea"}).to_string();
    source.sport_settings_body = "<html>Maintenance</html>".into();

    assert_refused_and_kept(&source);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_valid_answer_after_a_refused_one_stores_the_profile_and_settings() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("sync_athlete_recovers.db");
    seed_stored_profile();
    let mut refused = RecordingSource::new();
    refused.athlete_body = "<html>Maintenance</html>".into();
    assert!(sync_once(&refused).is_err());

    let mut source = RecordingSource::new();
    source.athlete_body = json!({
        "id": "i1",
        "name": "Bea",
        "sportSettings": [{"types": ["Run"], "ftp": 260}]
    })
    .to_string();
    sync_once(&source).expect("a valid athlete body stores");

    let (profile, settings) = stored();
    let profile: serde_json::Value =
        serde_json::from_str(&profile.expect("profile")).expect("json");
    assert_eq!(profile["name"], "Bea");
    let settings: serde_json::Value =
        serde_json::from_str(&settings.expect("settings")).expect("json");
    assert_eq!(settings, json!([{"types": ["Run"], "ftp": 260}]));
}
