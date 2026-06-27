//! Round-trip test: SectionConfig must survive an engine restart without
//! any TypeScript-side re-apply hook firing. Locks in the contract that
//! Rust+SQLite is the source of truth for section-detection params
//! (proximity_threshold, min_section_length, min_activities).
//!
//! Mirror of `match_strictness_persistence.rs` for the SectionConfig side
//! of the strictness slider.

use tempfile::TempDir;
use tracematch::SectionConfig;
use veloqrs::PersistentRouteEngine;
use veloqrs::persistence::settings_keys;

#[test]
fn section_config_persists_across_engine_restart() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("section_cfg.db");
    let db_path_str = db_path.to_str().unwrap();

    // First engine: write SectionConfig via set_section_config, which
    // both updates in-memory state and persists to the settings table.
    {
        let mut engine = PersistentRouteEngine::new(db_path_str).unwrap();
        engine.set_section_config(SectionConfig {
            proximity_threshold: 75.0,
            min_section_length: 350.0,
            min_activities: 5,
            ..SectionConfig::default()
        });
    }

    // Second engine on the same DB: load() must hydrate section_config
    // from the settings table before any detection runs.
    let mut engine2 = PersistentRouteEngine::new(db_path_str).unwrap();
    engine2.load().unwrap();

    assert_eq!(
        engine2.section_config_proximity_threshold(),
        75.0,
        "proximity_threshold should round-trip through SQLite"
    );
    assert_eq!(
        engine2.section_config_min_section_length(),
        350.0,
        "min_section_length should round-trip through SQLite"
    );
    assert_eq!(
        engine2.section_config_min_activities(),
        5,
        "min_activities should round-trip through SQLite"
    );
}

#[test]
fn section_config_falls_back_to_default_when_unset() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("section_cfg_default.db");

    let mut engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).unwrap();
    engine.load().unwrap();

    let default = SectionConfig::default();
    assert_eq!(
        engine.section_config_proximity_threshold(),
        default.proximity_threshold,
    );
    assert_eq!(
        engine.section_config_min_section_length(),
        default.min_section_length,
    );
    assert_eq!(
        engine.section_config_min_activities(),
        default.min_activities
    );
}

#[test]
fn unparseable_persisted_section_values_keep_existing_config() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("section_cfg_garbage.db");
    let db_path_str = db_path.to_str().unwrap();

    // Plant garbage in one key, valid value in another. Loader must
    // skip the garbage and apply the valid value.
    {
        let engine = PersistentRouteEngine::new(db_path_str).unwrap();
        engine
            .set_setting(settings_keys::SECTION_PROXIMITY_THRESHOLD, "not-a-number")
            .unwrap();
        engine
            .set_setting(settings_keys::SECTION_MIN_ACTIVITIES, "4")
            .unwrap();
    }

    let mut engine = PersistentRouteEngine::new(db_path_str).unwrap();
    engine.load().unwrap();

    let default = SectionConfig::default();
    assert_eq!(
        engine.section_config_proximity_threshold(),
        default.proximity_threshold,
        "garbage proximity value must not corrupt in-memory section_config"
    );
    assert_eq!(
        engine.section_config_min_activities(),
        4,
        "valid sibling key should still be applied"
    );
}

/// The Phase 2 contract: a user choosing a preset via DetectionManager.set_config
/// (which calls set_section_config) must see those values applied on the *next*
/// engine boot without any TS-side re-apply. This test exercises the full chain
/// at the PersistentRouteEngine layer.
#[test]
fn set_section_config_persists_and_reloads() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("section_cfg_full.db");
    let db_path_str = db_path.to_str().unwrap();

    // Mimic the user picking "Strict" preset (proximity=35, min_len=300, min_act=4).
    {
        let mut engine = PersistentRouteEngine::new(db_path_str).unwrap();
        engine.set_section_config(SectionConfig {
            proximity_threshold: 35.0,
            min_section_length: 300.0,
            min_activities: 4,
            ..SectionConfig::default()
        });
        assert_eq!(engine.section_config_proximity_threshold(), 35.0);
    }

    // App restart: engine should pick up the same values.
    let mut engine = PersistentRouteEngine::new(db_path_str).unwrap();
    engine.load().unwrap();

    assert_eq!(engine.section_config_proximity_threshold(), 35.0);
    assert_eq!(engine.section_config_min_section_length(), 300.0);
    assert_eq!(engine.section_config_min_activities(), 4);
}
