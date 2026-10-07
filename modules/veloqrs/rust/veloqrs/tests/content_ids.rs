//! Section ids come from the ground. A mint names the global cell of the
//! section's heart and no sport, so two devices cutting the same library
//! agree on ids, not only on lines. An older database's clock-minted ids
//! are re-keyed once, across every table that holds them.
//!
//! Scenario: a populated catalogue whose ids were written by the clock.
//! Expected behaviour: the open re-keys the section and everything keyed
//! on it (junction rows, history, geometry, pin, name intent, exclusions,
//! the superseded pointer, the catalogue archive and its members, and the
//! section PR and trend indicators) in one transaction, and mints the id a
//! fresh cut would. An indicator of another type is left alone.

#![cfg(feature = "synthetic")]

use rusqlite::{Connection, params};
use std::collections::BTreeSet;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;
use veloqrs::persistence::sections::content_id_for;

use crate::lifecycle_support::*;

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
    let (mut engine, _dir) = fresh_engine();
    let snap = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;
    let (id, fp) = busiest_section(&snap).expect("a section");
    let expected = content_id_for(&fp.polyline, &BTreeSet::new()).unwrap();
    assert_eq!(id, expected, "the id is the heart's cell");
    let cell: Vec<&str> = id
        .strip_prefix("s_")
        .expect("the section prefix")
        .split('_')
        .collect();
    assert_eq!(
        cell.len(),
        2,
        "a latitude and a longitude and no sport, got {id}"
    );
    assert!(
        cell.iter().all(|part| part
            .trim_start_matches('-')
            .chars()
            .all(|c| c.is_ascii_digit())),
        "got {id}"
    );
}

#[test]
fn an_id_remint_carries_history_pins_intents_and_exclusions() {
    let corpus = corpus();
    let (mut engine, dir) = fresh_engine();
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
        tx.execute_batch(&format!(
            "CREATE TEMP TABLE successor AS SELECT * FROM sections WHERE id = '{id}';
             UPDATE successor SET id = 's_ride_successor', superseded_by = '{old}';
             INSERT INTO section_history (section_id, kind, details)
                 VALUES ('{old}', 'archived', '{{\"token\":\"t1\"}}');
             INSERT INTO activity_indicators
                 (activity_id, indicator_type, target_id, computed_at)
                 VALUES ('a1', 'section_pr', '{old}', 0),
                        ('a1', 'section_trend', '{old}', 0),
                        ('a1', 'route_pr', '{old}', 0);"
        ))
        .unwrap();
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
        tx.execute("INSERT INTO sections SELECT * FROM successor", [])
            .unwrap();
        tx.execute("DELETE FROM schema_info WHERE key = 'content_ids_v1'", [])
            .unwrap();
        tx.execute("DELETE FROM identity_state", []).unwrap();
        tx.commit().unwrap();
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM sections WHERE id = ?", &old),
            1
        );
    }

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
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
    for (sql, want) in [
        ("SELECT COUNT(*) FROM sections WHERE superseded_by = ?", 0),
        (
            "SELECT COUNT(*) FROM activity_indicators
             WHERE target_id = ? AND indicator_type IN ('section_pr', 'section_trend')",
            0,
        ),
        (
            "SELECT COUNT(*) FROM activity_indicators
             WHERE target_id = ? AND indicator_type = 'route_pr'",
            1,
        ),
    ] {
        assert_eq!(count(&conn, sql, &old), want, "clock id left behind: {sql}");
    }
    for (sql, want) in [
        (
            "SELECT COUNT(*) FROM section_history WHERE section_id = ? AND kind = 'archived'",
            1,
        ),
        ("SELECT COUNT(*) FROM sections WHERE superseded_by = ?", 1),
        (
            "SELECT COUNT(*) FROM activity_indicators
             WHERE target_id = ? AND indicator_type IN ('section_pr', 'section_trend')",
            2,
        ),
    ] {
        assert_eq!(count(&conn, sql, &id), want, "content id missing: {sql}");
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
        history_before + 1,
        "the history moved, the archived state written under the clock id with it"
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
