//! Section ids come from the ground. A mint names the sport and the global
//! cell of the section's heart, so two devices cutting the same library
//! agree on ids, not only on lines. An older database's clock-minted ids
//! are re-keyed once, across every table that holds them.
//!
//! Scenario: a populated catalogue whose ids were written by the clock.
//! Expected behaviour: the open re-keys the section and everything keyed
//! on it (junction rows, history, geometry, pin, name intent, exclusions,
//! indicators) in one transaction, and mints the id a fresh cut would.

#![cfg(feature = "synthetic")]

mod lifecycle_support;

use lifecycle_support::*;
use rusqlite::{Connection, params};
use std::collections::BTreeSet;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;
use veloqrs::persistence::sections::content_id_for;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
}

fn count(conn: &Connection, sql: &str, id: &str) -> i64 {
    conn.query_row(sql, params![id], |r| r.get(0)).unwrap()
}

#[test]
fn a_mint_names_the_ground() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let snap = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;
    let (id, fp) = busiest_section(&snap).expect("a section");
    let expected = content_id_for(&fp.polyline, &fp.sport_type, &BTreeSet::new()).unwrap();
    assert_eq!(id, expected, "the id is the sport and the heart's cell");
    assert!(id.starts_with("s_ride_"), "got {id}");
}

#[test]
fn an_id_remint_carries_history_pins_intents_and_exclusions() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine_for(Arm::Battery);
    let snap = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;
    let (id, fp) = busiest_section(&snap).expect("a section");
    let member = fp.activity_ids.iter().next().cloned().unwrap();
    engine
        .set_section_name(&id, Some("Morning Berg"))
        .expect("name");
    engine
        .exclude_activity_from_section(&id, &member)
        .expect("exclude");
    // Last: a rename is a promotion and drops a pin, so pin after it.
    engine.revert_section_to_version(&id, 1).expect("pin");
    let history_before = engine.section_history(&id).len();
    assert!(history_before >= 2);
    drop(engine);

    // Write the id the clock would have minted, across every table, and
    // forget that the re-key ran.
    let path = dir.path().join("lifecycle.db");
    let old = "s_1700000000000__000007".to_string();
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute("PRAGMA defer_foreign_keys = ON", []).unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        for sql in [
            "UPDATE sections SET id = ?2 WHERE id = ?1",
            "UPDATE section_activities SET section_id = ?2 WHERE section_id = ?1",
            "UPDATE section_history SET section_id = ?2 WHERE section_id = ?1",
            "UPDATE section_geometry SET section_id = ?2 WHERE section_id = ?1",
            "UPDATE section_pins SET section_id = ?2 WHERE section_id = ?1",
            "UPDATE section_intents SET id = ?2 WHERE id = ?1",
        ] {
            tx.execute(sql, params![id, old]).unwrap();
        }
        tx.execute("DELETE FROM schema_info WHERE key = 'content_ids_v1'", [])
            .unwrap();
        tx.execute("DELETE FROM identity_state", []).unwrap();
        tx.commit().unwrap();
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM sections WHERE id = ?", &old),
            1
        );
    }

    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("reopen");
    engine.load().expect("load");
    let conn = Connection::open(&path).unwrap();
    for (table, column) in [
        ("sections", "id"),
        ("section_activities", "section_id"),
        ("section_history", "section_id"),
        ("section_geometry", "section_id"),
        ("section_pins", "section_id"),
        ("section_intents", "id"),
    ] {
        let sql = format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?");
        assert_eq!(
            count(&conn, &sql, &old),
            0,
            "{table} still holds the clock id"
        );
    }
    let new_id = engine
        .get_sections()
        .iter()
        .find(|s| s.id == id)
        .map(|s| s.id.clone())
        .expect("the section came back under its content id");
    assert_eq!(
        engine.pinned_section_version(&new_id),
        Some(1),
        "the pin moved"
    );
    assert_eq!(
        engine.section_history(&new_id).len(),
        history_before,
        "the history moved"
    );
    assert!(
        engine.get_excluded_activity_ids(&new_id).contains(&member),
        "the exclusion moved"
    );
    assert_eq!(
        engine
            .get_all_section_names()
            .get(&new_id)
            .map(String::as_str),
        Some("Morning Berg"),
        "the name moved"
    );
    let marker: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'content_ids_v1'",
            [],
            |r| r.get(0),
        )
        .ok();
    assert_eq!(marker.as_deref(), Some("1"), "the re-key is recorded once");
}
