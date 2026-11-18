//! Hiding or showing a selection of sections is one write: every row and its
//! suppression intent land together or not at all, and the registry is written
//! once however many sections the selection holds.
//!
//! Scenario: five detected sections, three of them hidden in one call and then
//! shown again in one call.
//! Expected behaviour: the table, the intents, the in-memory catalogue and the
//! registry agree after each call, and a selection with one unknown or repeated
//! id changes nothing.

use super::bulk_acceptance::engine_holding;
use crate::persistence::PersistentEngine;

fn strings(ids: &[String]) -> Vec<String> {
    ids.to_vec()
}

fn hidden_rows(engine: &PersistentEngine) -> Vec<String> {
    let mut stmt = engine
        .db
        .prepare("SELECT id FROM sections WHERE disabled = 1 ORDER BY id")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn intent_ids(engine: &PersistentEngine) -> Vec<String> {
    let mut stmt = engine
        .db
        .prepare("SELECT id FROM section_intents WHERE kind = 'disabled' ORDER BY id")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn in_memory(engine: &PersistentEngine) -> Vec<String> {
    let mut ids: Vec<String> = engine.get_sections().iter().map(|s| s.id.clone()).collect();
    ids.sort();
    ids
}

#[test]
fn hiding_three_of_five_hides_and_records_exactly_those_three() {
    let (mut engine, ids) = engine_holding(5);
    let chosen = strings(&[ids[0].clone(), ids[2].clone(), ids[4].clone()]);

    engine.set_sections_enabled(&chosen, false).unwrap();

    assert_eq!(hidden_rows(&engine), chosen);
    assert_eq!(intent_ids(&engine), chosen);
    assert_eq!(
        in_memory(&engine),
        strings(&[ids[1].clone(), ids[3].clone()])
    );
    assert_eq!(engine.section_identity_visible_len(), 2);
}

#[test]
fn showing_them_again_clears_the_rows_and_the_intents() {
    let (mut engine, ids) = engine_holding(5);
    let chosen = strings(&[ids[0].clone(), ids[2].clone(), ids[4].clone()]);
    engine.set_sections_enabled(&chosen, false).unwrap();

    engine.set_sections_enabled(&chosen, true).unwrap();

    assert!(hidden_rows(&engine).is_empty());
    assert!(intent_ids(&engine).is_empty());
    assert_eq!(in_memory(&engine), ids);
    assert_eq!(engine.section_identity_visible_len(), 5);
}

#[test]
fn a_selection_writes_the_registry_once_each_way() {
    let (mut engine, ids) = engine_holding(5);
    let before = super::super::identity::registry_writes();

    engine.set_sections_enabled(&ids, false).unwrap();
    assert_eq!(super::super::identity::registry_writes() - before, 1);

    engine.set_sections_enabled(&ids, true).unwrap();
    assert_eq!(super::super::identity::registry_writes() - before, 2);
}

#[test]
fn an_unknown_id_refuses_the_whole_selection() {
    let (mut engine, ids) = engine_holding(5);
    let chosen = strings(&[ids[0].clone(), "nope".to_owned(), ids[1].clone()]);

    let refused = engine.set_sections_enabled(&chosen, false).unwrap_err();

    assert_eq!(refused, "Section not found: nope");
    assert!(hidden_rows(&engine).is_empty());
    assert!(intent_ids(&engine).is_empty());
    assert_eq!(in_memory(&engine), ids);
    assert_eq!(engine.section_identity_visible_len(), 5);
}

#[test]
fn an_unknown_id_refuses_showing_too() {
    let (mut engine, ids) = engine_holding(5);
    engine.set_sections_enabled(&ids[..2], false).unwrap();
    let chosen = strings(&[ids[0].clone(), "nope".to_owned()]);

    assert!(engine.set_sections_enabled(&chosen, true).is_err());

    assert_eq!(hidden_rows(&engine), strings(&ids[..2]));
    assert_eq!(intent_ids(&engine), strings(&ids[..2]));
}

#[test]
fn naming_one_id_twice_is_refused() {
    let (mut engine, ids) = engine_holding(5);
    let twice = strings(&[ids[0].clone(), ids[0].clone()]);

    let refused = engine.set_sections_enabled(&twice, false).unwrap_err();

    assert_eq!(refused, format!("Section named twice: {}", ids[0]));
    assert!(hidden_rows(&engine).is_empty());
}

#[test]
fn an_empty_selection_changes_nothing() {
    let (mut engine, ids) = engine_holding(5);
    let before = super::super::identity::registry_writes();

    engine.set_sections_enabled(&[], false).unwrap();

    assert!(hidden_rows(&engine).is_empty());
    assert_eq!(super::super::identity::registry_writes(), before);
    assert_eq!(in_memory(&engine), ids);
}

#[test]
fn hiding_one_section_is_the_one_id_case() {
    let (mut engine, ids) = engine_holding(5);

    engine.disable_section(&ids[3]).unwrap();

    assert_eq!(hidden_rows(&engine), strings(&ids[3..4]));
    assert_eq!(intent_ids(&engine), strings(&ids[3..4]));
    assert_eq!(
        engine.disable_section("nope").unwrap_err(),
        "Section not found: nope"
    );
}
