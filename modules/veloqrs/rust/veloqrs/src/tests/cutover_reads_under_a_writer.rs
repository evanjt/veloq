//! Scenario: a detection apply or a sync page holds the engine write lock
//! while the JS thread asks whether the migration is owed, which stored
//! streams are missing a lap time, and what the migration changed.
//!
//! Expected behaviour: each answer comes from committed rows on a pooled
//! connection and returns while the writer still holds the engine. A diff
//! row that carries legacy geometry is still trimmed, and only that read
//! takes the write lock.

use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};
use crate::with_persistent_engine;

const CUTOVER_DIFF_KEY: &str = "__detector_cutover_diff";

const LEGACY_DIFF: &str = r#"{"token":"t","counts":{"current":1,"proposed":1,"unchanged":1,"changed":0,"new":0,"gone":0},"sections":[{"id":"a"}]}"#;

fn stored_diff() -> Option<String> {
    with_persistent_engine(|e| e.get_setting(CUTOVER_DIFF_KEY).unwrap()).unwrap()
}

#[test]
fn cutover_pending_does_not_wait_for_a_writer() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("cutover_pending_under_a_writer.db");
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

    let pending = read_while_writer_holds(crate::ffi::is_cutover_pending);
    assert!(pending, "an uncut auto section is owed the migration");
}

#[test]
fn cutover_pending_is_false_for_an_empty_catalogue_under_a_writer() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("cutover_pending_empty_under_a_writer.db");

    assert!(!read_while_writer_holds(crate::ffi::is_cutover_pending));
}

#[test]
fn cutover_diff_does_not_wait_for_a_writer_when_nothing_is_owed_a_trim() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("cutover_diff_under_a_writer.db");
    let clean = r#"{"token":"t","counts":{"current":1,"proposed":1,"unchanged":1,"changed":0,"new":0,"gone":0}}"#;
    with_persistent_engine(|e| e.set_setting(CUTOVER_DIFF_KEY, clean).unwrap()).unwrap();

    let diff = read_while_writer_holds(crate::ffi::get_cutover_diff).expect("a diff");
    assert_eq!(diff.token, "t");
    assert_eq!(diff.counts.unchanged, 1);
}

#[test]
fn cutover_diff_is_none_before_the_migration_ran() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("cutover_diff_absent.db");

    assert!(read_while_writer_holds(crate::ffi::get_cutover_diff).is_none());
}

#[test]
fn cutover_diff_trims_a_legacy_payload_and_rewrites_the_row() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("cutover_diff_trim.db");
    with_persistent_engine(|e| e.set_setting(CUTOVER_DIFF_KEY, LEGACY_DIFF).unwrap()).unwrap();

    let diff = crate::ffi::get_cutover_diff().expect("a diff");
    assert_eq!(diff.counts.unchanged, 1);

    let row = stored_diff().expect("the row stays");
    assert!(
        !row.contains("\"sections\""),
        "the carried rows are dropped: {row}"
    );
    assert!(crate::ffi::get_cutover_diff().is_some());
    assert_eq!(
        stored_diff().as_deref(),
        Some(row.as_str()),
        "second read writes nothing"
    );
}

#[test]
fn start_cutover_answers_not_owed_without_waiting_for_a_writer() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("start_cutover_under_a_writer.db");

    let outcome = read_while_writer_holds(crate::ffi::start_detector_cutover);
    assert_eq!(outcome, crate::objects::FfiStartOutcome::NotOwed);
}
