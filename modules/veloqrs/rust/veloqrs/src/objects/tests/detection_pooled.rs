//! The jobs screen polls how many activities wait for a detect. The count is
//! a query on committed rows, so a tick landing during a sync write answers
//! at once instead of stalling the JS thread for the write.

use super::*;
use crate::test_globals::{
    init_global_engine, read_while_writer_holds, seeded_global_engine, serial_global_state,
};

#[test]
fn test_awaiting_count_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("awaiting_count_under_writer.db");
    let detection = DetectionManager::new();
    assert_eq!(
        read_while_writer_holds(|| detection.awaiting_count().unwrap()),
        0
    );
}

#[test]
fn test_awaiting_count_matches_the_engine() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let detection = DetectionManager::new();
    assert_eq!(
        detection.awaiting_count().unwrap(),
        6,
        "six seeded, none detected"
    );
    crate::with_persistent_engine(|e| {
        e.save_processed_activity_ids(&["a0".to_string(), "a1".to_string()])
            .unwrap()
    })
    .unwrap();
    assert_eq!(detection.awaiting_count().unwrap(), 4);
    assert_eq!(
        u64::from(detection.awaiting_count().unwrap()),
        crate::with_persistent_engine(|e| e.activities_awaiting_detection().unwrap()).unwrap()
    );
}

fn strict_config() -> crate::FfiSectionConfig {
    crate::FfiSectionConfig {
        proximity_threshold: 33.0,
        min_section_length: 410.0,
        max_section_length: 7_000.0,
        min_activities: 4,
        divergence_threshold: 0.5,
    }
}

fn engine_config() -> crate::FfiSectionConfig {
    crate::with_persistent_engine(|e| crate::FfiSectionConfig::from(&e.section_config)).unwrap()
}

fn engine_strictness() -> (f64, f64) {
    crate::with_persistent_engine(|e| {
        (
            e.match_config.min_match_percentage,
            e.match_config.endpoint_threshold,
        )
    })
    .unwrap()
}

#[test]
fn test_get_config_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("config_under_writer.db");
    let detection = DetectionManager::new();
    detection.set_config(strict_config()).unwrap();
    let read = read_while_writer_holds(|| detection.get_config().unwrap());
    assert_eq!(read.min_activities, 4);
    assert_eq!(read.proximity_threshold, 33.0);
}

#[test]
fn test_get_match_strictness_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("strictness_under_writer.db");
    let detection = DetectionManager::new();
    detection.set_match_strictness(61.0, 150.0).unwrap();
    let read = read_while_writer_holds(|| detection.get_match_strictness().unwrap());
    assert_eq!(read.min_match_pct, 61.0);
    assert_eq!(read.endpoint_threshold, 150.0);
}

#[test]
fn test_get_change_card_support_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("change_card_under_writer.db");
    let pooled = read_while_writer_holds(crate::ffi::get_change_card_support);
    let engine = crate::with_persistent_engine(|e| e.change_card_support()).unwrap();
    assert_eq!(pooled.deterministic, engine.deterministic);
    assert_eq!(pooled.same_on_every_device, engine.same_on_every_device);
    assert!(
        pooled.ledger,
        "an empty library still answers the build's claims, not the refusal's all-false"
    );
}

#[test]
fn test_config_reads_match_the_engine_after_each_write() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("config_parity.db");
    let detection = DetectionManager::new();

    detection.set_config(strict_config()).unwrap();
    detection.set_match_strictness(61.0, 150.0).unwrap();
    assert_eq!(
        FfiSectionConfigKey::of(&detection.get_config().unwrap()),
        FfiSectionConfigKey::of(&engine_config())
    );
    let s = detection.get_match_strictness().unwrap();
    assert_eq!((s.min_match_pct, s.endpoint_threshold), engine_strictness());

    crate::with_persistent_engine(|e| e.clear().unwrap()).unwrap();
    assert_eq!(
        FfiSectionConfigKey::of(&detection.get_config().unwrap()),
        FfiSectionConfigKey::of(&engine_config()),
        "a cleared library reads the default, like the memory it resets"
    );
    let s = detection.get_match_strictness().unwrap();
    assert_eq!((s.min_match_pct, s.endpoint_threshold), engine_strictness());
}

#[test]
fn test_config_reads_a_slider_only_install_like_the_loader() {
    use crate::persistence::settings_keys as keys;
    let _guard = serial_global_state();
    let _tmp = init_global_engine("config_legacy_keys.db");
    let detection = DetectionManager::new();
    crate::with_persistent_engine(|e| {
        e.delete_setting(keys::SECTION_CONFIG_JSON).unwrap();
        e.set_setting(keys::SECTION_PROXIMITY_THRESHOLD, "41.5")
            .unwrap();
        e.set_setting(keys::SECTION_MIN_LENGTH, "620").unwrap();
        e.set_setting(keys::SECTION_MIN_ACTIVITIES, "5").unwrap();
        e.load_section_config_from_settings().unwrap();
    })
    .unwrap();
    let pooled = detection.get_config().unwrap();
    assert_eq!(pooled.proximity_threshold, 41.5);
    assert_eq!(pooled.min_section_length, 620.0);
    assert_eq!(pooled.min_activities, 5);
    assert_eq!(
        FfiSectionConfigKey::of(&pooled),
        FfiSectionConfigKey::of(&engine_config())
    );
}

#[test]
fn test_config_reads_fall_back_to_the_slider_keys_when_the_blob_is_unparseable() {
    use crate::persistence::settings_keys as keys;
    let _guard = serial_global_state();
    let _tmp = init_global_engine("config_bad_blob.db");
    let detection = DetectionManager::new();
    crate::with_persistent_engine(|e| {
        e.set_setting(keys::SECTION_CONFIG_JSON, "{not json")
            .unwrap();
        e.set_setting(keys::SECTION_MIN_ACTIVITIES, "7").unwrap();
    })
    .unwrap();
    assert_eq!(detection.get_config().unwrap().min_activities, 7);
}

/// `FfiSectionConfig` has no `PartialEq`, so compare its fields.
#[derive(Debug, PartialEq)]
struct FfiSectionConfigKey([u64; 5]);

impl FfiSectionConfigKey {
    fn of(c: &crate::FfiSectionConfig) -> Self {
        Self([
            c.proximity_threshold.to_bits(),
            c.min_section_length.to_bits(),
            c.max_section_length.to_bits(),
            u64::from(c.min_activities),
            c.divergence_threshold.to_bits(),
        ])
    }
}
