//! Toggling route matching off clears detected ground. A section the
//! athlete drew is not detected ground, and it has no other copy.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;
use veloqrs::sections::CreateSectionParams;

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
fn clearing_routes_keeps_the_sections_the_athlete_drew() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("clear.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();

    let corpus = corpus();
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
    }
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();
    let detected = engine.get_section_summaries().len();
    assert!(detected > 0, "corpus produced no detected sections");

    let source = &corpus.through_a()[0];
    let custom = engine
        .create_section(CreateSectionParams {
            sport_type: source.sport_type.clone(),
            polyline: source.gps_points[0..40].to_vec(),
            distance_meters: 500.0,
            name: Some("Home climb".to_string()),
            source_activity_id: Some(source.id.clone()),
            start_index: Some(0),
            end_index: Some(39),
        })
        .unwrap();

    engine.clear_routes_and_sections().unwrap();

    let kept = engine.get_section_summaries();
    assert_eq!(kept.len(), 1, "the wipe kept the wrong number of sections");
    assert_eq!(kept[0].id, custom, "the drawn section did not survive");
    assert_eq!(kept[0].name.as_deref(), Some("Home climb"));
}

fn member_count(db_path: &str, section_id: &str) -> i64 {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    conn.query_row(
        "SELECT COUNT(*) FROM section_activities WHERE section_id = ?",
        [section_id],
        |row| row.get(0),
    )
    .unwrap()
}

/// A hidden section is a user decision too. Its row and members are kept so
/// enable can restore it, and toggling route matching off must not take them.
#[test]
fn clearing_routes_keeps_a_disabled_section_and_its_members() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("clear-disabled.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).unwrap();

    let corpus = corpus();
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
    }
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();

    let hidden = engine.get_section_summaries()[0].id.clone();
    let members_before = member_count(path.to_str().unwrap(), &hidden);
    assert!(members_before > 0, "section had no members to lose");
    engine.disable_section(&hidden).unwrap();

    engine.clear_routes_and_sections().unwrap();
    engine.enable_section(&hidden).unwrap();

    let restored = engine.get_section_summaries();
    assert!(
        restored.iter().any(|s| s.id == hidden),
        "the hidden section was deleted by the wipe"
    );
    assert_eq!(
        member_count(path.to_str().unwrap(), &hidden),
        members_before,
        "the hidden section came back without its members"
    );
}
