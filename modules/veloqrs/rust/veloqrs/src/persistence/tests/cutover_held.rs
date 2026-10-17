//! Scenario: a screen asks whether the cutover holds detection, at each point
//! of a migration's life: owed and not started, running, and settled.
//!
//! Expected behaviour: one engine answer covers both ways the cutover holds
//! detection, so a run whose token has already moved on still reads as held
//! until it gives the slot back.

use std::sync::atomic::Ordering;

use crate::test_globals::{init_global_engine, serial_global_state};
use crate::with_persistent_engine;

fn insert_uncut_auto_section() {
    with_persistent_engine(|e| {
        e.db.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES ('s', 'auto', 'S', 'Ride', '[]', 400.0, 0, 1,
                '2026-01-01T00:00:00Z', 46.0, 46.1, 7.0, 7.1)",
            [],
        )
        .unwrap();
    })
    .unwrap();
}

#[test]
fn an_owed_cutover_holds_detection() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("cutover_held_owed.db");
    insert_uncut_auto_section();

    assert!(crate::ffi::is_cutover_held());
}

#[test]
fn a_running_cutover_holds_detection_once_nothing_is_owed() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("cutover_held_running.db");
    assert!(!super::cutover_pending(), "an empty catalogue owes no cut");

    assert!(super::claim_run_slot());
    let held = crate::ffi::is_cutover_held();
    super::CUTOVER_RUNNING.store(false, Ordering::SeqCst);

    assert!(held, "the run still holds the slot");
}

#[test]
fn a_settled_cutover_on_an_empty_catalogue_holds_nothing() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("cutover_held_settled.db");

    assert!(!crate::ffi::is_cutover_held());
}
