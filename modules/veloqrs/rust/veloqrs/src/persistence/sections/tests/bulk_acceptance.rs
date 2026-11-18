//! Accepting and un-accepting a selection of sections is one pass over the
//! registry, however many sections the selection holds. Each registry write
//! serialises the whole registry, so a pass per section costs the selection
//! times the library.
//!
//! Scenario: two hundred auto sections held by the registry, all accepted in
//! one call and then all handed back in one call.
//! Expected behaviour: each call writes the registry once, and the registry,
//! the in-memory catalogue and the table agree afterwards.

use super::registry_admit_one::{LNG, SPACING_DEG, auto_section, line};
use crate::persistence::PersistentEngine;

const SECTIONS: usize = 200;

fn engine_holding_sections() -> (PersistentEngine, Vec<String>) {
    engine_holding(SECTIONS)
}

/// An engine whose registry holds `count` auto sections on separate ground.
pub(super) fn engine_holding(count: usize) -> (PersistentEngine, Vec<String>) {
    let mut engine = PersistentEngine::in_memory().unwrap();
    let mut ids = Vec::new();
    for k in 0..count {
        // Lines run side by side in longitude, far enough apart to share no corridor.
        let lng = LNG + (k + 1) as f64 * SPACING_DEG;
        let ride = format!("ride-{k}");
        let id = format!("auto-{k}");
        engine
            .add_activity(ride.clone(), line(lng), "Ride".into())
            .unwrap();
        engine
            .sections
            .push(auto_section(&id, line(lng), &[&ride]).into());
        ids.push(id);
    }
    engine.save_sections_with_events(&[]).unwrap();
    engine.section_identity_reseed();
    assert_eq!(engine.section_identity_visible_len(), count);
    (engine, ids)
}

fn accepted_in_table(engine: &PersistentEngine) -> i64 {
    engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE is_user_defined = 1",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn accepting_a_selection_writes_the_registry_once() {
    let (mut engine, ids) = engine_holding_sections();
    let writes_before = super::super::identity::registry_writes();

    let accepted = engine.accept_sections(&ids).unwrap();

    assert_eq!(accepted, ids);
    assert_eq!(
        super::super::identity::registry_writes() - writes_before,
        1,
        "one registry write for {SECTIONS} sections"
    );
    assert_eq!(engine.section_identity_visible_len(), 0);
    assert_eq!(accepted_in_table(&engine), SECTIONS as i64);
    assert!(engine.sections.iter().all(|s| s.is_user_defined));
}

#[test]
fn unaccepting_a_selection_writes_the_registry_once() {
    let (mut engine, ids) = engine_holding_sections();
    engine.accept_sections(&ids).unwrap();
    let writes_before = super::super::identity::registry_writes();

    engine.unaccept_sections(&ids).unwrap();

    assert_eq!(
        super::super::identity::registry_writes() - writes_before,
        1,
        "one registry write for {SECTIONS} sections"
    );
    assert_eq!(engine.section_identity_visible_len(), SECTIONS);
    assert_eq!(accepted_in_table(&engine), 0);
    assert!(engine.sections.iter().all(|s| !s.is_user_defined));
}

#[test]
fn a_selection_with_one_unfit_section_changes_nothing() {
    let (mut engine, ids) = engine_holding_sections();
    engine.accept_sections(&ids[..1]).unwrap();

    let refused = engine.accept_sections(&ids[..3]).unwrap_err();

    assert_eq!(refused, "Section is already accepted: auto-0");
    assert_eq!(accepted_in_table(&engine), 1);
    assert_eq!(engine.section_identity_visible_len(), SECTIONS - 1);
}

#[test]
fn accepting_the_same_id_twice_in_one_call_is_refused() {
    let (mut engine, ids) = engine_holding_sections();
    let twice = vec![ids[0].clone(), ids[0].clone()];

    assert!(engine.accept_sections(&twice).is_err());
    assert_eq!(accepted_in_table(&engine), 0);
}
