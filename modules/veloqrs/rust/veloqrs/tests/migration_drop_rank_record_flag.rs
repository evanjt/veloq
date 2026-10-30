//! Scenario: a library carrying stored section rank inputs, each with the record
//! flag the ranking used to keep, is opened by this build, once from the schema
//! the table first shipped in and once from the one just before the flag went, and
//! a new install is created.
//!
//! Expected behaviour: `section_rank_inputs` has no `latest_is_pr` column, and
//! every other field of a row that was stored reads the same as before.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const KEPT_COLUMNS: &str = "section_id, sport_type, traversal_count, last_date, \
     improvement_score, improvement_change, improvement_basis, anomaly_score, \
     best_time_secs, best_date, median_recent_secs, trend";

fn seed_rank_input(conn: &Connection) {
    conn.execute(
        "INSERT INTO section_rank_inputs
            (section_id, sport_type, traversal_count, last_date, improvement_score,
             improvement_change, improvement_basis, anomaly_score, best_time_secs,
             best_date, median_recent_secs, trend, latest_is_pr)
         VALUES ('sec-1', 'Ride', 7, 1700000000, 0.25, -12.5, 1, 0.5, 301.5,
                 1690000000.0, 320.0, -1, 1)",
        [],
    )
    .expect("store a rank input with the flag set");
}

fn stored_row(conn: &Connection) -> String {
    conn.query_row(
        &format!(
            "SELECT printf('%s|%s|%d|%d|%.3f|%.3f|%d|%.3f|%.3f|%.1f|%.3f|%d', {KEPT_COLUMNS})
             FROM section_rank_inputs WHERE section_id = 'sec-1'"
        ),
        [],
        |row| row.get(0),
    )
    .expect("the stored row survives the upgrade")
}

fn assert_flag_is_gone(conn: &Connection) {
    assert!(
        !columns_of(conn, "section_rank_inputs").contains(&"latest_is_pr".to_string()),
        "the record flag column is dropped"
    );
}

fn upgrade_from(version: u32) {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    let seed = seed_at_version(&path, version);
    seed_rank_input(&seed);
    let before = stored_row(&seed);
    drop(seed);

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), latest_version());
    assert_flag_is_gone(&conn);
    assert_eq!(stored_row(&conn), before);
}

#[test]
fn an_upgrade_from_the_schema_that_made_the_table_drops_the_flag_and_keeps_every_other_field() {
    upgrade_from(56);
}

#[test]
fn an_upgrade_from_the_schema_before_the_drop_drops_the_flag_and_keeps_every_other_field() {
    upgrade_from(78);
}

#[test]
fn a_new_install_has_no_flag() {
    let _serial = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("library.db");
    drop(PersistentEngine::new(path.to_str().unwrap()).expect("create"));

    let conn = Connection::open(&path).unwrap();
    assert_flag_is_gone(&conn);
}
