//! The identity registry lives in memory as well as on disk, so wiping the
//! tables is only half of a logout. Left in place, the departing athlete's
//! grounds stay live for the debounce window and the next athlete's first
//! detect adopts their ids, names and tombstones over shared ground.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
}

#[test]
fn clear_leaves_no_registry_behind() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("identity.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");

    for a in corpus().through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add");
    }
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("apply");
    assert!(
        engine.section_identity_visible_len() > 0,
        "the corpus registered no grounds, so the wipe below proves nothing"
    );
    let first = engine.get_section_summaries();
    assert!(!first.is_empty(), "the first athlete detected nothing");
    engine
        .set_section_name(&first[0].id, Some("Departed athlete's climb"))
        .expect("name a section");

    engine.clear().expect("clear");

    assert_eq!(
        engine.section_identity_visible_len(),
        0,
        "the departing athlete's grounds are still live in the registry"
    );
    assert_eq!(
        engine.get_section_summaries().len(),
        0,
        "sections survived the wipe"
    );

    // The next athlete rides the same ground. Nothing may be adopted from it.
    for a in corpus().through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add");
    }
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("apply");

    let second = engine.get_section_summaries();
    assert!(!second.is_empty(), "the second athlete detected nothing");
    assert!(
        second
            .iter()
            .all(|s| s.name.as_deref() != Some("Departed athlete's climb")),
        "a name from the previous athlete came back over shared ground"
    );
}
