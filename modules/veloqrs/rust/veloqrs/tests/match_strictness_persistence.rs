//! Round-trip test: match strictness must survive an engine restart without
//! any TypeScript-side re-apply hook firing. Locks in the contract that
//! Rust+SQLite is the source of truth for the strictness setting.

use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;
use veloqrs::persistence::settings_keys;

#[test]
fn match_strictness_persists_across_engine_restart() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("strictness.db");
    let db_path_str = db_path.to_str().unwrap();

    // First engine: write the persisted setting through the same code path
    // that DetectionManager.set_match_strictness uses (SettingsTable upsert).
    {
        let engine = PersistentRouteEngine::new(db_path_str).unwrap();
        engine
            .set_setting(settings_keys::MATCH_MIN_MATCH_PCT, "55.0")
            .unwrap();
        engine
            .set_setting(settings_keys::MATCH_ENDPOINT_THRESHOLD, "270.0")
            .unwrap();
    }

    // Second engine on the same DB: load() must hydrate match_config from
    // the settings table before any detection runs.
    let mut engine2 = PersistentRouteEngine::new(db_path_str).unwrap();
    engine2.load().unwrap();

    assert_eq!(
        engine2.match_config_min_match_percentage(),
        55.0,
        "min_match_percentage should be hydrated from settings table"
    );
    assert_eq!(
        engine2.match_config_endpoint_threshold(),
        270.0,
        "endpoint_threshold should be hydrated from settings table"
    );
}

#[test]
fn match_strictness_falls_back_to_default_when_unset() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("strictness_default.db");

    let mut engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).unwrap();
    engine.load().unwrap();

    let default = tracematch::MatchConfig::default();
    assert_eq!(
        engine.match_config_min_match_percentage(),
        default.min_match_percentage,
    );
    assert_eq!(
        engine.match_config_endpoint_threshold(),
        default.endpoint_threshold,
    );
}

#[test]
fn unparseable_persisted_values_keep_existing_match_config() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("strictness_garbage.db");
    let db_path_str = db_path.to_str().unwrap();

    {
        let engine = PersistentRouteEngine::new(db_path_str).unwrap();
        engine
            .set_setting(settings_keys::MATCH_MIN_MATCH_PCT, "not-a-number")
            .unwrap();
    }

    let mut engine = PersistentRouteEngine::new(db_path_str).unwrap();
    engine.load().unwrap();

    let default = tracematch::MatchConfig::default();
    assert_eq!(
        engine.match_config_min_match_percentage(),
        default.min_match_percentage,
        "garbage strictness value must not corrupt the in-memory match_config"
    );
}
