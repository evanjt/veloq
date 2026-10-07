//! The section ledger carries the event time as data, so an upgrade can write
//! a baseline row at the moment the catalogue it describes was cut rather than
//! at the moment the upgrade ran.

use tempfile::TempDir;
use veloqrs::PersistentEngine;

const BACKDATED: &str = "2024-03-01 08:15:00";

fn open() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("history.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    (dir, engine)
}

/// A backdated row lands at the time it was given, not at the clock.
#[test]
fn backdated_event_keeps_its_time() {
    let (_dir, mut engine) = open();

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
    let (_dir, mut engine) = open();

    engine
        .append_section_history_at("sec_a", "baseline", None, None, BACKDATED)
        .expect("append backdated");
    engine
        .append_section_history("sec_a", "recut", None, None)
        .expect("append live");

    let events = engine.section_history("sec_a");
    assert_eq!(events.len(), 2);
    assert!(
        events[1].at.as_str() > BACKDATED,
        "live row {} should be later than the backdated baseline",
        events[1].at
    );
}
