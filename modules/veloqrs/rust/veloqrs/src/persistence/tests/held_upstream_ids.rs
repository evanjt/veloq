//! Scenario: the remote search drops what the library already holds, and asks
//! the library which of the server's ids those are.
//!
//! Expected behaviour: an id a stored row claims is held, and so is one stored
//! under the server's id as its own key. An id nothing stores is not, and an
//! empty ask holds nothing.

use super::*;
use tempfile::TempDir;

fn body(id: &str) -> String {
    serde_json::json!({
        "id": id,
        "start_date_local": "2024-03-02T08:00:00",
        "type": "Ride",
        "name": "Harbour loop",
    })
    .to_string()
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|id| id.to_string()).collect()
}

#[test]
fn a_stored_activity_is_held_and_an_unstored_one_is_not() {
    let dir = TempDir::new().unwrap();
    let mut engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
    engine
        .store_activity_detail_body("i77", 1_709_366_400, &body("i77"))
        .unwrap();

    let held = engine.held_upstream_ids(&ids(&["i77", "i78"])).unwrap();

    assert_eq!(held, ["i77".to_string()].into_iter().collect());
}

#[test]
fn an_id_a_row_keyed_otherwise_claims_is_held() {
    let dir = TempDir::new().unwrap();
    let mut engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();
    engine
        .store_activity_detail_body("local-ab12", 1_709_366_400, &body("local-ab12"))
        .unwrap();
    assert!(engine.record_upload("local-ab12", "i90").unwrap());

    let held = engine.held_upstream_ids(&ids(&["i90"])).unwrap();

    assert!(held.contains("i90"), "claims by id: {held:?}");
}

#[test]
fn an_empty_ask_holds_nothing() {
    let dir = TempDir::new().unwrap();
    let engine = PersistentEngine::new(dir.path().join("routes.db").to_str().unwrap()).unwrap();

    assert!(engine.held_upstream_ids(&[]).unwrap().is_empty());
}
