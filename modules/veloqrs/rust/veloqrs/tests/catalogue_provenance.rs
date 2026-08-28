//! A saved catalogue records what produced it: the detection method and a
//! stable digest of the config it ran under. Without both, "two devices with
//! the same settings agree" cannot be checked on a device.

use tempfile::TempDir;
use tracematch::sections::SectionConfig;
use veloqrs::PersistentRouteEngine;
use veloqrs::persistence::sections::section_config_digest;

/// Set on the re-executed test binary so the child prints digests instead of
/// asserting.
const PROBE: &str = "VELOQ_DIGEST_PROBE";

fn mutated() -> SectionConfig {
    SectionConfig {
        min_routes: SectionConfig::default().min_routes + 1,
        ..Default::default()
    }
}

fn open(config: SectionConfig) -> (TempDir, PersistentRouteEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("provenance.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    engine.set_section_config(config);
    (dir, engine)
}

/// Saving the catalogue stamps the method and the digest of the live config.
#[test]
fn save_records_method_and_digest() {
    let config = SectionConfig {
        ..Default::default()
    };
    let expected = section_config_digest(&config);
    let (_dir, mut engine) = open(config);

    assert_eq!(engine.catalogue_detection_method(), None);
    engine.apply_sections_save(Vec::new()).expect("save");

    assert_eq!(
        engine.catalogue_detection_method().as_deref(),
        Some("unified")
    );
    assert_eq!(engine.catalogue_config_digest(), Some(expected));
}

/// A config change is visible in the stamp after the next save.
#[test]
fn digest_follows_a_config_change() {
    let (_dir, mut engine) = open(SectionConfig::default());
    engine.apply_sections_save(Vec::new()).expect("save");
    let before = engine.catalogue_config_digest().expect("digest");

    engine.set_section_config(mutated());
    engine.apply_sections_save(Vec::new()).expect("resave");
    let after = engine.catalogue_config_digest().expect("digest");

    assert_ne!(before, after, "a changed field must change the digest");
}

/// The digest is a property of the config alone, so a second process computes
/// the same string for the same config and a different one for a changed field.
#[test]
fn digest_is_stable_across_processes() {
    if std::env::var(PROBE).is_ok() {
        println!(
            "{} {}",
            section_config_digest(&SectionConfig::default()),
            section_config_digest(&mutated())
        );
        return;
    }

    let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
        .args([
            "--exact",
            "digest_is_stable_across_processes",
            "--nocapture",
        ])
        .env(PROBE, "1")
        .output()
        .expect("re-exec test binary");
    assert!(output.status.success(), "child run failed");

    let stdout = String::from_utf8(output.stdout).expect("utf8");
    let line = stdout
        .lines()
        .find(|l| l.split_whitespace().count() == 2 && l.len() == 33)
        .expect("child printed both digests");
    let (child_default, child_mutated) = line.split_once(' ').expect("two digests");

    assert_eq!(
        child_default,
        section_config_digest(&SectionConfig::default())
    );
    assert_eq!(child_mutated, section_config_digest(&mutated()));
    assert_ne!(child_default, child_mutated);
}
