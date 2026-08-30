//! The section ledger carries the event time as data, so an upgrade can write
//! a baseline row at the moment the catalogue it describes was cut rather than
//! at the moment the upgrade ran. Time-ordered reads across sections are
//! indexed.

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const BACKDATED: &str = "2024-03-01 08:15:00";

fn open() -> (TempDir, PersistentEngine, String) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("history.db");
    let db_path = path.to_str().unwrap().to_string();
    let engine = PersistentEngine::new(&db_path).expect("engine");
    (dir, engine, db_path)
}

/// A backdated row lands at the time it was given, not at the clock.
#[test]
fn backdated_event_keeps_its_time() {
    let (_dir, mut engine, _path) = open();

    engine
        .append_section_history_at("sec_a", "baseline", None, None, BACKDATED)
        .expect("append backdated");

    let events = engine.section_history("sec_a");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].at, BACKDATED);
    assert_eq!(events[0].kind, "baseline");
}

/// A live event still stamps the clock, so the backdating path is additive.
#[test]
fn live_event_stamps_now() {
    let (_dir, mut engine, _path) = open();

    engine
        .append_section_history_at("sec_a", "baseline", None, None, BACKDATED)
        .expect("append backdated");
    engine
        .append_section_history("sec_a", "recut", None, None)
        .expect("append live");

    let events = engine.section_history("sec_a");
    assert_eq!(events.len(), 2);
    assert!(
        events[1].at > BACKDATED.to_string(),
        "live row {} should be later than the backdated baseline",
        events[1].at
    );
}

/// A time-ordered read across sections uses the timestamp index rather than
/// scanning the ledger.
#[test]
fn time_ordered_reads_are_indexed() {
    let (_dir, engine, db_path) = open();
    drop(engine);

    let conn = Connection::open(&db_path).expect("reopen");
    let mut stmt = conn
        .prepare("EXPLAIN QUERY PLAN SELECT id FROM section_history WHERE at > ? ORDER BY at")
        .expect("prepare");
    let plan: String = stmt
        .query_map([BACKDATED], |row| row.get::<_, String>(3))
        .expect("query")
        .flatten()
        .collect::<Vec<_>>()
        .join(" | ");

    assert!(
        plan.contains("idx_section_history_at"),
        "expected the timestamp index, got: {plan}"
    );
}
